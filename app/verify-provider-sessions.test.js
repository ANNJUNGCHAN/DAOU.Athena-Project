'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  parseCli,
  runInjectedNodeProviderVerification,
  validateVerificationReport,
} = require('./verify-provider-sessions');

test('injected Node harness verifies first-paint, 500-turn hardening, stale rejection, shutdown, and disabled Codex callbacks', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-provider-verify-'));
  const recordPath = path.join(directory, 'providers.ndjson');
  try {
    const report = await runInjectedNodeProviderVerification({ scenario: 'all', recordPath });
    assert.equal(report.ok, true);
    assert.equal(report.surface, 'injected-node-harness');
    assert.equal(report.sourceClass, 'node-injected');
    assert.match(report.sourceRevision, /^[0-9a-f]{7,64}$/i);
    assert.match(report.scriptHash, /^[0-9a-f]{64}$/i);
    assert.match(report.configFingerprint, /^[0-9a-f]{64}$/i);
    assert.equal(report.freshness.status, 'fresh');
    assert.equal(report.runtimeEvidence.osProcessChecksExecuted, false);
    assert.ok(report.pendingRuntimeEvidence.includes('electron-runtime'));
    assert.ok(report.pendingRuntimeEvidence.includes('provider-os-process'));
    assert.equal(report.integration.completedTurns, 100);
    assert.equal(report.integration.paint.status, 'pending-electron-runtime');
    assert.equal(report.hardening.completedTurns, 500);
    assert.equal(report.hardening.staleProbeInjected, true);
    assert.equal(report.hardening.staleProbeRejected, true);
    assert.equal(report.hardening.staleEventsDelivered, 0);
    assert.ok(report.hardening.staleEventsDropped >= 1);
    assert.equal(report.hardening.shutdownClean, true);
    assert.equal(report.codexDisabled.samples, 30);
    assert.equal(report.codexDisabled.actionNeeded, 30);
    assert.equal(report.codexDisabled.selectionCalls, 30);
    assert.equal(report.codexDisabled.providerStartCalls, 0);
    assert.equal(report.codexDisabled.fallbackCalls, 0);
    assert.deepEqual(validateVerificationReport(report), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('verification validator fails closed on missing scenario sections and stale evidence', async () => {
  const report = await runInjectedNodeProviderVerification({ scenario: 'all' });
  const missing = structuredClone(report);
  delete missing.hardening;
  assert.ok(validateVerificationReport(missing).some((entry) => entry.includes('hardening')));
  const stale = structuredClone(report);
  stale.generatedAt = '2000-01-01T00:00:00.000Z';
  stale.freshness.expiresAt = '2000-01-01T00:01:00.000Z';
  assert.ok(validateVerificationReport(stale).some((entry) => entry.includes('stale')));
});

test('verification requires the leak orchestrator environment when requested', () => {
  assert.throws(
    () => parseCli(['--scenario', 'all', '--require-orchestrator'], {}),
    /leak orchestrator environment/,
  );
  const parsed = parseCli(['--scenario', 'integration', '--require-orchestrator'], {
    ATHENA_PROVIDER_LEAK_RUN_ID: 'run-1',
    ATHENA_PROVIDER_LEAK_RECORD_PATH: 'C:\\temp\\providers.ndjson',
  });
  assert.equal(parsed.recordPath, 'C:\\temp\\providers.ndjson');
});

test('verification validator rejects paint/correlation, hardening, shutdown, and Codex disabled drift', async () => {
  const report = await runInjectedNodeProviderVerification({ scenario: 'all' });
  const bad = structuredClone(report);
  bad.integration.paint.status = 'passed-with-fake-raf';
  bad.integration.correlatedSamples = 99;
  bad.hardening.staleEventsDelivered = 1;
  bad.hardening.shutdownClean = false;
  bad.codexDisabled.actionNeeded = 29;
  bad.codexDisabled.providerStartCalls = 1;
  bad.codexDisabled.fallbackCalls = 1;
  const errors = validateVerificationReport(bad);
  assert.ok(errors.some((entry) => entry.includes('paint ACK')));
  assert.ok(errors.some((entry) => entry.includes('correlated')));
  assert.ok(errors.some((entry) => entry.includes('stale event')));
  assert.ok(errors.some((entry) => entry.includes('shutdown')));
  assert.ok(errors.some((entry) => entry.includes('Codex')));
});

test('verification cannot relabel injected evidence as Electron/OS-process proof or hardcode a stale pass', async () => {
  const report = await runInjectedNodeProviderVerification({ scenario: 'all' });
  const bad = structuredClone(report);
  bad.surface = 'injected-headless-electron';
  bad.pendingRuntimeEvidence = [];
  bad.hardening.staleProbeInjected = false;
  bad.hardening.staleProbeRejected = false;
  bad.hardening.staleEventsDropped = 0;
  const errors = validateVerificationReport(bad);
  assert.ok(errors.some((entry) => entry.includes('surface')));
  assert.ok(errors.some((entry) => entry.includes('explicitly pending')));
  assert.ok(errors.some((entry) => entry.includes('stale event probe')));
});
