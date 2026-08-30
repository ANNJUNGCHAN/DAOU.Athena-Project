'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_THRESHOLDS,
  buildDeterministicReport,
  buildDisabledReport,
  parseCli,
  runBenchmark,
  runPairedBenchmark,
  validateBenchmarkReport,
} = require('./benchmark-provider-sessions');

test('injected Node 1,000-turn harness measures correlated main-process boundaries only', async () => {
  const report = await buildDeterministicReport({ provider: 'claude', samples: 1_000 });

  assert.equal(report.samples, 1_000);
  assert.equal(report.successes, 1_000);
  assert.equal(report.failures, 0);
  assert.equal(report.surface, 'injected-node-harness');
  assert.equal(report.runtimeAccounting.kind, 'injected-node-session-harness');
  assert.equal(report.runtimeAccounting.sessionStarts, 1);
  assert.equal(report.runtimeAccounting.sessionStops, 1);
  assert.equal(report.runtimeAccounting.gatewayStarts, 1);
  assert.equal(report.runtimeAccounting.gatewayStops, 1);
  assert.equal(report.runtimeAccounting.warmedTurnSessionStarts, 0);
  assert.equal(report.runtimeAccounting.generations, 1);
  assert.equal(Object.hasOwn(report, 'processSpawns'), false);
  assert.ok(report.pendingRuntimeEvidence.includes('electron-runtime'));
  assert.ok(report.pendingRuntimeEvidence.includes('process-leak-scan'));
  assert.equal(report.rawSamples.length, 1_000);
  assert.equal(report.rawSamples[999].clientSubmitId, '123e4567-e89b-42d3-a456-000000001000');
  assert.match(report.rawSamples[999].turnId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(report.clockDomains, {
    main: ['mainIpcReceivedAt', 'providerWriteAt', 'providerEventAt', 'mainDispatchedAt'],
    renderer: [],
  });
  assert.deepEqual(validateBenchmarkReport(report), []);
  assert.deepEqual(Object.keys(DEFAULT_THRESHOLDS).sort(), [
    'main_ipc_to_provider_write_ms',
    'provider_event_to_main_dispatch_ms',
  ]);
  assert.equal(report.paintEvidence.status, 'pending-electron-runtime');
  assert.equal(report.timings.renderer_event_to_first_paint_ms, undefined);
  assert.equal(report.timings.renderer_submit_to_first_paint_ms, undefined);
  for (const [name, threshold] of Object.entries(DEFAULT_THRESHOLDS)) {
    assert.ok(report.timings[name].p95 <= threshold, `${name} exceeded ${threshold}`);
  }
});

test('benchmark evidence is strict, fresh, source-bound, and written to immutable per-run paths', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-provider-evidence-'));
  try {
    const options = { provider: 'claude', mode: 'deterministic', samples: 1_000, outputDirectory: directory };
    const first = await runBenchmark(options);
    const second = await runBenchmark(options);
    assert.notEqual(first.outputPath, second.outputPath);
    assert.equal(first.report.sourceClass, 'node-injected');
    assert.match(first.report.sourceRevision, /^[0-9a-f]{7,64}$/i);
    assert.match(first.report.scriptHash, /^[0-9a-f]{64}$/i);
    assert.match(first.report.configFingerprint, /^[0-9a-f]{64}$/i);
    assert.ok(Number.isFinite(Date.parse(first.report.generatedAt)));
    assert.ok(Number.isFinite(Date.parse(first.report.freshness.expiresAt)));
    assert.equal(first.report.freshness.status, 'fresh');
    const stale = structuredClone(first.report);
    stale.generatedAt = '2000-01-01T00:00:00.000Z';
    stale.freshness.expiresAt = '2000-01-01T00:01:00.000Z';
    assert.ok(validateBenchmarkReport(stale).some((entry) => entry.includes('stale')));
    const fake = structuredClone(first.report);
    delete fake.scriptHash;
    assert.ok(validateBenchmarkReport(fake).some((entry) => entry.includes('scriptHash')));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('report validation rejects missing correlation, cross-clock arithmetic, thresholds, samples, failures, and injected lifecycle drift', async () => {
  const base = await buildDeterministicReport({ provider: 'claude', samples: 1_000 });
  const bad = structuredClone(base);
  bad.rawSamples[0].turnId = '';
  bad.rawSamples[1].mainClockDomain = 'forged-clock';
  bad.timings.main_ipc_to_provider_write_ms.p95 = 16;
  bad.successes = 999;
  bad.failures = 1;
  bad.runtimeAccounting.sessionStarts = 2;
  bad.runtimeAccounting.gatewayStarts = 2;
  bad.runtimeAccounting.warmedTurnSessionStarts = 1;
  bad.timings.provider_event_to_main_dispatch_ms.max = null;

  const errors = validateBenchmarkReport(bad);
  assert.ok(errors.some((entry) => entry.includes('correlation')));
  assert.ok(errors.some((entry) => entry.includes('clock domain')));
  assert.ok(errors.some((entry) => entry.includes('threshold')));
  assert.ok(errors.some((entry) => entry.includes('success')));
  assert.ok(errors.some((entry) => entry.includes('session lifecycle')));
  assert.ok(errors.some((entry) => entry.includes('gateway lifecycle')));
  assert.ok(errors.some((entry) => entry.includes('warmed-turn session')));
  assert.ok(errors.some((entry) => entry.includes('percentile')));
});

test('CLAUDE_ONLY Codex disabled probe executes 30 selections without invoking start or fallback callbacks', () => {
  let selectionCalls = 0;
  let startCalls = 0;
  let fallbackCalls = 0;
  const report = buildDisabledReport({
    provider: 'codex', samples: 30, contractDecision: 'CLAUDE_ONLY',
    resolveSelection(input) {
      selectionCalls += 1;
      assert.equal(input.activeAccount.providerId, 'codex');
      return { ok: false, type: 'action-needed', provider: 'codex', code: 'CODEX_LIVE_DISABLED_BY_CONTRACT' };
    },
    startProvider() { startCalls += 1; },
    runFallback() { fallbackCalls += 1; },
  });
  assert.equal(report.mode, 'assert-disabled');
  assert.equal(report.actionNeeded, 30);
  assert.equal(selectionCalls, 30);
  assert.equal(startCalls, 0);
  assert.equal(fallbackCalls, 0);
  assert.equal(report.selectionCalls, 30);
  assert.equal(report.providerStartCalls, 0);
  assert.equal(report.fallbackCalls, 0);
  assert.equal(report.rawSamples.length, 30);
  assert.deepEqual(validateBenchmarkReport(report), []);
});

test('validator refuses the former fabricated arithmetic/spawn report shape', async () => {
  const report = await buildDeterministicReport({ provider: 'claude', samples: 1_000 });
  const fabricated = structuredClone(report);
  fabricated.processSpawns = 1;
  fabricated.gatewaySpawns = 1;
  fabricated.surface = 'injected-headless-electron';
  fabricated.pendingRuntimeEvidence = [];
  const errors = validateBenchmarkReport(fabricated);
  assert.ok(errors.some((entry) => entry.includes('must not claim OS process evidence')));
  assert.ok(errors.some((entry) => entry.includes('surface')));
  assert.ok(errors.some((entry) => entry.includes('explicitly pending')));
});

test('paired/live mode is rejected unless paid live execution is explicitly opted in', () => {
  assert.throws(
    () => parseCli(['--provider', 'claude', '--mode', 'paired', '--warm-samples', '30', '--cold-samples', '5'], {}),
    /explicit --allow-live/,
  );
  const parsed = parseCli([
    '--provider', 'claude', '--mode', 'paired', '--warm-samples', '30', '--cold-samples', '5', '--allow-live',
  ], {});
  assert.equal(parsed.allowLive, true);
});

test('opted-in paired runner uses A/B/B/A ordering and validates cold/warm report schema', async () => {
  const calls = [];
  const report = await runPairedBenchmark({
    provider: 'claude', allowLive: true, coldSamples: 5, warmSamples: 30,
    async liveRunner(input) {
      calls.push(`${input.temperature}:${input.lane}`);
      return {
        firstTextMs: input.lane === 'native' ? 10 : 12,
        localOverheadMs: input.lane === 'native' ? 0 : 2,
        configurationFingerprint: 'c'.repeat(64),
        processSpawned: input.lane === 'athena' && (input.temperature === 'cold' || input.index === 0),
        gatewaySpawned: input.lane === 'athena' && (input.temperature === 'cold' || input.index === 0),
      };
    },
  });
  assert.deepEqual(calls.slice(0, 4), ['cold:native', 'cold:athena', 'cold:athena', 'cold:native']);
  assert.equal(report.cold.native.rawSamples.length, 5);
  assert.equal(report.cold.athena.rawSamples.length, 5);
  assert.equal(report.warm.native.rawSamples.length, 30);
  assert.equal(report.warm.athena.rawSamples.length, 30);
  assert.equal(report.warm.athena.processSpawns, 1);
  assert.equal(report.warm.athena.gatewaySpawns, 1);
  assert.equal(report.comparison.warm.medianDegradationMs, 2);
  assert.equal(report.comparison.warm.p95DegradationMs, 2);
  assert.deepEqual(report.cold.native.rawSamples[0], {
    sequence: 1,
    sample: 1,
    lane: 'native',
    temperature: 'cold',
    configurationFingerprint: 'c'.repeat(64),
    firstTextMs: 10,
    localOverheadMs: 0,
    processSpawned: false,
    gatewaySpawned: false,
  });
  assert.deepEqual(validateBenchmarkReport(report), []);

  const forged = structuredClone(report);
  forged.warm.athena.firstTextMs.p95 += 1;
  assert.ok(validateBenchmarkReport(forged).some((entry) => entry.includes('does not match raw samples')));

  const forgedOverhead = structuredClone(report);
  forgedOverhead.cold.athena.localOverheadMs.max += 1;
  assert.ok(validateBenchmarkReport(forgedOverhead).some((entry) => entry.includes('local overhead summary')));

  const forgedComparison = structuredClone(report);
  forgedComparison.comparison.warm.medianDegradationMs += 1;
  assert.ok(validateBenchmarkReport(forgedComparison).some((entry) => entry.includes('degradation summary')));

  const forgedSpawnCount = structuredClone(report);
  forgedSpawnCount.warm.athena.processSpawns = 0;
  assert.ok(validateBenchmarkReport(forgedSpawnCount).some((entry) => entry.includes('spawn invariant')));

  const negative = structuredClone(report);
  negative.cold.native.rawSamples[0].firstTextMs = -1;
  assert.ok(validateBenchmarkReport(negative).some((entry) => entry.includes('raw sample')));

  const outOfOrder = structuredClone(report);
  [outOfOrder.cold.native.rawSamples[0].sequence, outOfOrder.cold.athena.rawSamples[0].sequence] =
    [outOfOrder.cold.athena.rawSamples[0].sequence, outOfOrder.cold.native.rawSamples[0].sequence];
  assert.ok(validateBenchmarkReport(outOfOrder).some((entry) => entry.includes('sequence')));

  const mismatched = structuredClone(report);
  mismatched.warm.native.rawSamples[0].configurationFingerprint = 'd'.repeat(64);
  assert.ok(validateBenchmarkReport(mismatched).some((entry) => entry.includes('configuration fingerprint')));
});

test('CLAUDE_ONLY refuses a fake Codex deterministic success in favor of disabled probes', async () => {
  await assert.rejects(
    runBenchmark({
      provider: 'codex', mode: 'deterministic', samples: 1_000,
      decision: { decision: 'CLAUDE_ONLY', providers: { codex: { enabled: false } } },
    }),
    /assert-disabled/,
  );
});

test('benchmark writes a sanitized report artifact and returns nonzero on validation failure', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-provider-benchmark-'));
  try {
    const ok = await runBenchmark({
      provider: 'claude', mode: 'deterministic', samples: 1_000,
      outputDirectory: directory,
    });
    assert.equal(ok.exitCode, 0);
    assert.ok(fs.existsSync(ok.outputPath));
    const serialized = fs.readFileSync(ok.outputPath, 'utf8');
    assert.doesNotMatch(serialized, /prompt|toolInput|secret/i);

    const failed = await runBenchmark({
      provider: 'claude', mode: 'deterministic', samples: 999,
      outputDirectory: directory,
    });
    assert.equal(failed.exitCode, 1);
    assert.ok(failed.errors.some((entry) => entry.includes('1,000')));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
