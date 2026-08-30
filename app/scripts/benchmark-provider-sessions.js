'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveCodexDisabledSelection } = require('../lib/main/codex-live-disabled');
const { createProviderEventRouter } = require('../lib/main/provider-event-router');
const { createProviderRuntimeController } = require('../lib/main/provider-runtime-bootstrap');
const { createProviderRuntimeMetrics, summarize } = require('../lib/main/provider-runtime-metrics');
const { ProviderSessionSupervisor } = require('../lib/main/provider-session-supervisor');

const DEFAULT_THRESHOLDS = Object.freeze({
  main_ipc_to_provider_write_ms: 15,
  provider_event_to_main_dispatch_ms: 10,
});
const EVIDENCE_MAX_AGE_MS = 15 * 60 * 1_000;
const SOURCE_CLASS = 'node-injected';
const DETERMINISTIC_SAMPLE_COUNT = 1_000;
const DISABLED_SAMPLE_COUNT = 30;
const DEFAULT_OUTPUT_DIRECTORY = path.resolve(__dirname, '..', '..', 'artifacts', 'provider-session-benchmark');
const DECISION_PATH = path.resolve(__dirname, '..', 'test-fixtures', 'provider-contract', 'decision.json');

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new TypeError(`${label} must be a positive integer`);
  return parsed;
}

function readDecision() {
  return JSON.parse(fs.readFileSync(DECISION_PATH, 'utf8'));
}

function environmentFingerprint() {
  return Object.freeze({
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpuCount: os.cpus().length,
    cwdSha256: crypto.createHash('sha256').update(process.cwd()).digest('hex'),
  });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function currentScriptHash() {
  return sha256(fs.readFileSync(__filename));
}

function withEvidenceMetadata(report, { scenario, provider = report.provider, config = {}, sourceClass = SOURCE_CLASS } = {}) {
  const generatedAt = new Date();
  const scriptHash = currentScriptHash();
  return {
    ...report,
    schemaVersion: 2,
    scenario,
    provider,
    sourceClass,
    sourceRevision: process.env.ATHENA_SOURCE_REVISION || scriptHash,
    scriptHash,
    generatedAt: generatedAt.toISOString(),
    configFingerprint: sha256(JSON.stringify(config)),
    freshness: {
      status: 'fresh',
      maxAgeMs: EVIDENCE_MAX_AGE_MS,
      expiresAt: new Date(generatedAt.getTime() + EVIDENCE_MAX_AGE_MS).toISOString(),
    },
  };
}

function validateEvidenceMetadata(report, expectedSourceClass = SOURCE_CLASS, expectedScriptHash = currentScriptHash()) {
  const errors = [];
  if (report?.schemaVersion !== 2) errors.push('schemaVersion is invalid');
  if (!report?.scenario) errors.push('scenario is missing');
  if (!['claude', 'codex'].includes(report?.provider)) errors.push('provider is invalid');
  if (report?.sourceClass !== expectedSourceClass) errors.push('sourceClass is invalid');
  if (!/^[0-9a-f]{7,64}$/i.test(String(report?.sourceRevision || ''))) errors.push('sourceRevision is invalid');
  if (!/^[0-9a-f]{64}$/i.test(String(report?.scriptHash || ''))) errors.push('scriptHash is invalid');
  else if (report.scriptHash !== expectedScriptHash) errors.push('scriptHash does not match the verifier source');
  if (!/^[0-9a-f]{64}$/i.test(String(report?.configFingerprint || ''))) errors.push('configFingerprint is invalid');
  const generatedAt = Date.parse(report?.generatedAt);
  const expiresAt = Date.parse(report?.freshness?.expiresAt);
  if (!Number.isFinite(generatedAt) || !Number.isFinite(expiresAt)
    || report?.freshness?.status !== 'fresh' || report?.freshness?.maxAgeMs !== EVIDENCE_MAX_AGE_MS) {
    errors.push('freshness metadata is invalid');
  } else if (generatedAt > Date.now() + 5_000 || expiresAt <= Date.now()
    || expiresAt - generatedAt !== EVIDENCE_MAX_AGE_MS) {
    errors.push('evidence is stale');
  }
  return errors;
}

function timingSummary(rawSamples, name) {
  return summarize(rawSamples.map((sample) => sample.timings[name]));
}

function completedPayload(suffix) {
  return {
    providerBinding: { provider: 'claude', sessionId: `session-${suffix}` },
    continuationCheckpoint: {
      provider: 'claude', sessionId: `session-${suffix}`,
      assistantMessageId: `assistant-${suffix}`, assistantMessageHash: 'b'.repeat(64),
    },
    usage: {}, finalText: `done-${suffix}`,
  };
}

function desiredState() {
  return {
    provider: 'claude', accountId: 'benchmark-account', conversationId: 'benchmark-conversation',
    cwd: 'C:\\athena-benchmark', model: null, effort: null,
    systemPrompt: 'benchmark', systemPromptHash: 'a'.repeat(64),
    configGeneration: 1, securityGeneration: 1,
    mcpSnapshot: { revision: 1 }, toolPolicy: { allowedTools: ['Read'], disallowedTools: [] },
  };
}

function makeVisibleNode() {
  return {
    isConnected: true, hidden: false, textContent: 'visible provider response',
    querySelector: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
  };
}

async function buildDeterministicReport({ provider, samples = DETERMINISTIC_SAMPLE_COUNT } = {}) {
  if (!['claude', 'codex'].includes(provider)) throw new TypeError('provider must be claude or codex');
  if (provider !== 'claude') throw new Error('the injected Node harness only supports the enabled Claude contract');
  const sampleCount = positiveInteger(samples, 'samples');
  let sessionStarts = 0;
  let sessionStops = 0;
  let gatewayStarts = 0;
  let gatewayStops = 0;
  let uuidCounter = 0;
  const marks = new Map();
  const runtimeMetrics = createProviderRuntimeMetrics({ clock: () => performance.now(), maxSamples: sampleCount + 10 });
  const metrics = {
    beginTurn(input) {
      const observed = { ...input, m0: performance.now() };
      marks.set(input.turnId, { mainIpcReceivedAt: observed.m0 });
      runtimeMetrics.beginTurn(observed);
    },
    mark(turnId, name, value) {
      const record = marks.get(turnId);
      if (!record) return false;
      if (name === 'm3' && record.providerWriteAt === undefined) return false;
      if (name === 'm4' && record.providerEventAt === undefined) return false;
      const at = Number.isFinite(value) ? value : performance.now();
      const accepted = runtimeMetrics.mark(turnId, name, at);
      if (!accepted) return false;
      if (name === 'm2') record.providerWriteAt = at;
      if (name === 'm3') record.providerEventAt = at;
      if (name === 'm4') record.mainDispatchedAt = at;
      return true;
    },
    acknowledgePaint(payload) {
      return runtimeMetrics.acknowledgePaint(payload);
    },
    completeTurn: (...args) => runtimeMetrics.completeTurn(...args),
    increment: (...args) => runtimeMetrics.increment(...args),
    report: () => runtimeMetrics.report(),
  };
  class HarnessSupervisor extends ProviderSessionSupervisor {
    constructor(options) {
      super({
        ...options,
        now: () => performance.now(),
        uuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
      });
    }
  }
  const fakeGateway = {
    start() { gatewayStarts += 1; },
    stop() { gatewayStops += 1; },
  };
  const fakeSession = {
    async start() { sessionStarts += 1; fakeGateway.start(); },
    async ready() {},
    async sendTurn(turn, context) {
      context.emit('turn_started', {});
      await new Promise((resolve) => setImmediate(resolve));
      metrics.mark(turn.turnId, 'm2', performance.now());
      context.emit('text_delta', { text: 'visible provider response' });
      context.emit('turn_completed', completedPayload(turn.userText));
      return { timings: { harness: true } };
    },
    async interrupt() {},
    async stop() { sessionStops += 1; fakeGateway.stop(); },
  };
  const controller = createProviderRuntimeController({
    persistentEnabled: true,
    metrics,
    requireFn(request) {
      if (request === './provider-session-supervisor') return { ProviderSessionSupervisor: HarnessSupervisor };
      if (request === './provider-event-router') return { createProviderEventRouter };
      if (request === './claude-agent-session') return { createClaudeAgentSession: () => fakeSession };
      if (request === './proc-utils') return { terminateTree: async () => {} };
      throw new Error(`unexpected harness dependency: ${request}`);
    },
    callbacks: {
      onTurnBound() {},
      onTextDelta() {},
    },
  });
  await controller.start(desiredState(), {
    stamp: { securityGeneration: 1 },
    buildCapabilityEnv: () => ({}),
    dispose() {},
  });
  await controller.ready();
  for (let index = 0; index < sampleCount; index += 1) {
    const clientSubmitId = `123e4567-e89b-42d3-a456-${String(index + 1).padStart(12, '0')}`;
    const rendererSubmittedAt = performance.now();
    const result = await controller.sendTurn({
      request: { clientSubmitId, conversationId: 'benchmark-conversation', origin: 'shell', userText: String(index + 1) },
      expectedRendererId: 7,
      rendererSubmittedAt,
    });
    if (!result.ok) throw new Error(`injected harness turn ${index + 1} failed`);
  }
  const beforeStop = controller.snapshot();
  await controller.stop('benchmark_complete');
  const metricsReport = metrics.report();
  const rawSamples = metricsReport.samples.map((sample) => {
    const main = marks.get(sample.turnId);
    return Object.freeze({
      clientSubmitId: sample.clientSubmitId,
      turnId: sample.turnId,
      sequence: sample.firstVisibleEventSequence,
      outcome: sample.outcome,
      mainClockDomain: 'injected-node:main',
      main: Object.freeze({ ...main }),
      timings: Object.freeze({
        main_ipc_to_provider_write_ms: sample.main_ipc_to_provider_write_ms,
        provider_event_to_main_dispatch_ms: sample.provider_event_to_main_dispatch_ms,
        warm_submit_to_first_text_ms: sample.warm_submit_to_first_text_ms,
        local_overhead_ms: sample.main_ipc_to_provider_write_ms
          + sample.provider_event_to_main_dispatch_ms,
      }),
    });
  });
  const timingNames = [
    ...Object.keys(DEFAULT_THRESHOLDS),
    'warm_submit_to_first_text_ms',
    'local_overhead_ms',
  ];
  const timings = Object.fromEntries(timingNames.map((name) => [name, timingSummary(rawSamples, name)]));

  return withEvidenceMetadata({
    provider,
    mode: 'deterministic',
    samples: sampleCount,
    successes: sampleCount,
    failures: 0,
    surface: 'injected-node-harness',
    runtimeAccounting: {
      kind: 'injected-node-session-harness',
      sessionStarts,
      sessionStops,
      gatewayStarts,
      gatewayStops,
      warmedTurnSessionStarts: Math.max(0, sessionStarts - 1),
      generations: beforeStop.runtimeGeneration,
    },
    paintEvidence: {
      status: 'pending-electron-runtime',
    },
    pendingRuntimeEvidence: ['electron-runtime', 'provider-os-process', 'gateway-os-process', 'process-leak-scan'],
    firstTextMs: timings.warm_submit_to_first_text_ms,
    localOverheadMs: timings.local_overhead_ms,
    timings,
    thresholds: { ...DEFAULT_THRESHOLDS },
    clockDomains: {
      main: ['mainIpcReceivedAt', 'providerWriteAt', 'providerEventAt', 'mainDispatchedAt'],
      renderer: [],
    },
    environment: environmentFingerprint(),
    rawSamples,
  }, { scenario: 'node-injected-main-boundaries', provider, config: { provider, samples: sampleCount } });
}

function buildDisabledReport({
  provider,
  samples = DISABLED_SAMPLE_COUNT,
  contractDecision,
  resolveSelection = resolveCodexDisabledSelection,
  startProvider = () => { throw new Error('disabled Codex probe attempted to start a provider'); },
  runFallback = () => { throw new Error('disabled Codex probe attempted fallback'); },
} = {}) {
  if (provider !== 'codex') throw new TypeError('assert-disabled is only valid for codex');
  if (contractDecision !== 'CLAUDE_ONLY') throw new Error('Codex disabled probe requires CLAUDE_ONLY');
  const sampleCount = positiveInteger(samples, 'samples');
  let providerStartCalls = 0;
  let fallbackCalls = 0;
  const rawSamples = Array.from({ length: sampleCount }, (_, index) => {
    const selection = resolveSelection({
      activeAccount: { providerId: 'codex', accountId: `codex-disabled-${index + 1}` },
      contractDecision,
      persistentEnabled: true,
    });
    if (!selection || selection.type !== 'action-needed') {
      providerStartCalls += 1;
      startProvider(selection);
    }
    if (!selection || selection.provider !== 'codex') {
      fallbackCalls += 1;
      runFallback(selection);
    }
    return {
      sample: index + 1,
      result: selection.type,
      code: selection.code,
      selectionInvoked: true,
    };
  });
  return withEvidenceMetadata({
    provider,
    mode: 'assert-disabled',
    contractDecision,
    samples: sampleCount,
    successes: sampleCount,
    failures: 0,
    actionNeeded: sampleCount,
    surface: 'injected-node-selection-probe',
    selectionCalls: rawSamples.length,
    providerStartCalls,
    fallbackCalls,
    pendingRuntimeEvidence: ['codex-os-process-negative-probe'],
    environment: environmentFingerprint(),
    rawSamples,
  }, { scenario: 'codex-disabled-selection', provider, config: { provider, samples: sampleCount, contractDecision } });
}

function validSummary(summary) {
  return summary && Number.isSafeInteger(summary.count) && summary.count > 0
    && Number.isFinite(summary.p50) && Number.isFinite(summary.p95) && Number.isFinite(summary.max);
}

function summariesEqual(actual, expected) {
  return actual?.count === expected.count && actual?.p50 === expected.p50
    && actual?.p95 === expected.p95 && actual?.max === expected.max;
}

function validateCorrelatedSample(sample) {
  if (!sample || !sample.clientSubmitId || !sample.turnId) {
    return 'raw sample correlation key is incomplete';
  }
  if (!sample.main || sample.mainClockDomain !== 'injected-node:main') {
    return 'raw sample clock domains are invalid';
  }
  const expected = {
    main_ipc_to_provider_write_ms: sample.main.providerWriteAt - sample.main.mainIpcReceivedAt,
    provider_event_to_main_dispatch_ms: sample.main.mainDispatchedAt - sample.main.providerEventAt,
  };
  for (const [name, value] of Object.entries(expected)) {
    if (!Number.isFinite(value) || value < 0 || sample.timings?.[name] !== value) {
      return `raw sample ${name} is not a same-clock interval`;
    }
  }
  return null;
}

function validatePairedReport(report) {
  const errors = validateEvidenceMetadata(report, 'claude-live-paired');
  if (report.mode !== 'paired') return ['paired report mode is invalid'];
  if (!/^[0-9a-f]{64}$/i.test(String(report.configurationFingerprint || ''))) {
    errors.push('paired configuration fingerprint is invalid');
  }
  let expectedSequence = 0;
  for (const [temperature, expected] of [['cold', 5], ['warm', 30]]) {
    const section = report[temperature];
    if (!section || section.samples !== expected || section.successes !== expected || section.failures !== 0) {
      errors.push(`${temperature} report requires ${expected}/${expected} successes`);
      continue;
    }
    for (const lane of ['native', 'athena']) {
      if (!validSummary(section[lane]?.firstTextMs)) errors.push(`${temperature}.${lane} firstTextMs percentile is missing`);
      if (!Array.isArray(section[lane]?.rawSamples) || section[lane].rawSamples.length !== expected) {
        errors.push(`${temperature}.${lane} raw sample count is invalid`);
        continue;
      }
      for (let index = 0; index < expected; index += 1) {
        const sample = section[lane].rawSamples[index];
        if (!sample || sample.sample !== index + 1 || sample.lane !== lane || sample.temperature !== temperature
          || !Number.isFinite(sample.firstTextMs) || sample.firstTextMs < 0
          || typeof sample.processSpawned !== 'boolean' || typeof sample.gatewaySpawned !== 'boolean') {
          errors.push(`${temperature}.${lane} raw sample is invalid`);
        }
        if (sample?.configurationFingerprint !== report.configurationFingerprint) {
          errors.push(`${temperature}.${lane} raw sample configuration fingerprint is invalid`);
        }
      }
      const expectedSummary = summarize(section[lane].rawSamples.map((sample) => sample?.firstTextMs));
      if (!summariesEqual(section[lane].firstTextMs, expectedSummary)) {
        errors.push(`${temperature}.${lane} summary does not match raw samples`);
      }
    }
    for (let index = 0; index < expected; index += 1) {
      const order = index % 2 === 0 ? ['native', 'athena'] : ['athena', 'native'];
      for (const lane of order) {
        expectedSequence += 1;
        if (section?.[lane]?.rawSamples?.[index]?.sequence !== expectedSequence) {
          errors.push(`${temperature} raw sample sequence is invalid`);
        }
      }
    }
    const athenaRaw = section.athena?.rawSamples || [];
    if (athenaRaw.some((sample) => !Number.isFinite(sample?.localOverheadMs) || sample.localOverheadMs < 0)) {
      errors.push(`${temperature}.athena local overhead raw sample is invalid`);
    } else {
      const expectedOverhead = summarize(athenaRaw.map((sample) => sample.localOverheadMs));
      if (!summariesEqual(section.athena.localOverheadMs, expectedOverhead)) {
        errors.push(`${temperature}.athena local overhead summary does not match raw samples`);
      }
    }
  }
  const warmAthenaRaw = report.warm?.athena?.rawSamples || [];
  const expectedProcessSpawns = warmAthenaRaw.filter((sample) => sample.processSpawned).length;
  const expectedGatewaySpawns = warmAthenaRaw.filter((sample) => sample.gatewaySpawned).length;
  const expectedWarmedTurnSpawns = warmAthenaRaw.slice(1)
    .filter((sample) => sample.processSpawned || sample.gatewaySpawned).length;
  if (report.warm?.athena?.processSpawns !== expectedProcessSpawns
    || report.warm?.athena?.gatewaySpawns !== expectedGatewaySpawns
    || report.warm?.athena?.warmedTurnSpawns !== expectedWarmedTurnSpawns
    || expectedProcessSpawns !== 1 || expectedGatewaySpawns !== 1 || expectedWarmedTurnSpawns !== 0) {
    errors.push('warm Athena spawn invariant failed');
  }
  if (!validSummary(report.warm?.athena?.localOverheadMs)
    || !validSummary(report.cold?.athena?.localOverheadMs)) {
    errors.push('Athena local overhead percentile is missing');
  }
  const comparison = report.comparison?.warm;
  if (!comparison || !Number.isFinite(comparison.medianDegradationMs)
    || !Number.isFinite(comparison.p95DegradationMs)) {
    errors.push('warm paired degradation summary is missing');
  } else {
    const expectedMedianDegradation = report.warm.athena.firstTextMs.p50 - report.warm.native.firstTextMs.p50;
    const expectedP95Degradation = report.warm.athena.firstTextMs.p95 - report.warm.native.firstTextMs.p95;
    if (comparison.medianDegradationMs !== expectedMedianDegradation
      || comparison.p95DegradationMs !== expectedP95Degradation) {
      errors.push('warm paired degradation summary does not match raw samples');
    }
    const medianLimit = Math.max(150, report.warm.native.firstTextMs.p50 * 0.10);
    const p95Limit = Math.max(500, report.warm.native.firstTextMs.p95 * 0.20);
    if (comparison.medianDegradationMs > medianLimit) errors.push('warm median degradation threshold exceeded');
    if (comparison.p95DegradationMs > p95Limit) errors.push('warm p95 degradation threshold exceeded');
  }
  return errors;
}

function validateBenchmarkReport(report) {
  if (report?.mode === 'paired') return validatePairedReport(report);
  const errors = validateEvidenceMetadata(report);
  if (!report || !Number.isSafeInteger(report.samples) || report.samples < 1) return ['report samples are invalid'];
  if (report.successes !== report.samples || report.failures !== 0) errors.push('success rate must be 100%');
  if (!Array.isArray(report.rawSamples) || report.rawSamples.length !== report.samples) errors.push('raw sample count is invalid');

  if (report.mode === 'assert-disabled') {
    if (report.provider !== 'codex' || report.contractDecision !== 'CLAUDE_ONLY') errors.push('disabled report contract is invalid');
    if (report.samples !== DISABLED_SAMPLE_COUNT || report.actionNeeded !== report.samples) errors.push('Codex action-needed count must be 30/30');
    if (report.surface !== 'injected-node-selection-probe' || report.selectionCalls !== report.samples) {
      errors.push('Codex disabled selection probe was not executed 30 times');
    }
    if (report.providerStartCalls !== 0) errors.push('Codex disabled provider-start callback invariant failed');
    if (report.fallbackCalls !== 0) errors.push('Codex disabled fallback callback invariant failed');
    if (!report.rawSamples.every((sample) => sample.selectionInvoked === true
      && sample.result === 'action-needed' && sample.code === 'CODEX_LIVE_DISABLED_BY_CONTRACT')) {
      errors.push('Codex disabled raw selection evidence is invalid');
    }
    if (!Array.isArray(report.pendingRuntimeEvidence)
      || !report.pendingRuntimeEvidence.includes('codex-os-process-negative-probe')) {
      errors.push('Codex OS-process evidence must remain explicitly pending');
    }
    return errors;
  }

  if (report.mode !== 'deterministic') errors.push('unsupported benchmark mode');
  if (report.samples !== DETERMINISTIC_SAMPLE_COUNT) errors.push('deterministic benchmark requires exactly 1,000 samples');
  if (report.surface !== 'injected-node-harness') errors.push('deterministic surface must be the injected Node harness');
  if (Object.hasOwn(report, 'processSpawns') || Object.hasOwn(report, 'gatewaySpawns')) {
    errors.push('injected Node report must not claim OS process evidence');
  }
  const accounting = report.runtimeAccounting;
  if (!accounting || accounting.kind !== 'injected-node-session-harness') {
    errors.push('injected runtime accounting is missing');
  } else {
    if (accounting.sessionStarts !== 1 || accounting.sessionStops !== 1) errors.push('injected session lifecycle invariant failed');
    if (accounting.gatewayStarts !== 1 || accounting.gatewayStops !== 1) errors.push('injected gateway lifecycle invariant failed');
    if (accounting.warmedTurnSessionStarts !== 0) errors.push('injected warmed-turn session invariant failed');
    if (accounting.generations !== 1) errors.push('deterministic generation invariant failed');
  }
  if (!Array.isArray(report.pendingRuntimeEvidence)
    || !['electron-runtime', 'provider-os-process', 'gateway-os-process', 'process-leak-scan']
      .every((gate) => report.pendingRuntimeEvidence.includes(gate))) {
    errors.push('runtime and OS-process evidence must remain explicitly pending');
  }
  const paint = report.paintEvidence;
  if (!paint || paint.status !== 'pending-electron-runtime') errors.push('Electron paint evidence must remain pending');

  for (const sample of report.rawSamples || []) {
    const error = validateCorrelatedSample(sample);
    if (error) errors.push(error);
  }
  for (const [name, threshold] of Object.entries(DEFAULT_THRESHOLDS)) {
    const summary = report.timings?.[name];
    if (!validSummary(summary)) errors.push(`${name} percentile is missing`);
    else if (summary.p95 > threshold) errors.push(`${name} threshold exceeded: ${summary.p95} > ${threshold}`);
  }
  if (!validSummary(report.firstTextMs) || !validSummary(report.localOverheadMs)) errors.push('required percentile summary is missing');
  return [...new Set(errors)];
}

function sanitizeFileSegment(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 64);
}

function writeReport(report, outputDirectory) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const runId = `${Date.now()}-${crypto.randomUUID()}`;
  const outputPath = path.join(outputDirectory,
    `${sanitizeFileSegment(report.sourceClass)}-${sanitizeFileSegment(report.provider)}-${sanitizeFileSegment(report.mode)}-${runId}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return outputPath;
}

async function runPairedBenchmark(options) {
  if (!options.allowLive) throw new Error('paired benchmark requires explicit --allow-live');
  if (typeof options.liveRunner !== 'function') {
    throw new Error('live benchmark runner is not configured; pass --live-runner with --allow-live');
  }
  const sections = {};
  let configurationFingerprint = null;
  let sequence = 0;
  for (const [temperature, sampleCount] of [['cold', options.coldSamples], ['warm', options.warmSamples]]) {
    const lanes = { native: [], athena: [] };
    for (let index = 0; index < sampleCount; index += 1) {
      const pairOrder = index % 2 === 0 ? ['native', 'athena'] : ['athena', 'native'];
      for (const lane of pairOrder) {
        sequence += 1;
        const measurement = await options.liveRunner({ provider: options.provider, lane, temperature, index });
        if (!measurement || !Number.isFinite(measurement.firstTextMs) || measurement.firstTextMs < 0) {
          throw new Error('live runner returned an invalid measurement');
        }
        if (!/^[0-9a-f]{64}$/i.test(String(measurement.configurationFingerprint || ''))) {
          throw new Error('live runner must provide a SHA-256 configuration fingerprint');
        }
        if (configurationFingerprint === null) configurationFingerprint = measurement.configurationFingerprint;
        if (measurement.configurationFingerprint !== configurationFingerprint) {
          throw new Error('native and Athena live lanes do not share one provider configuration');
        }
        lanes[lane].push({
          sequence,
          sample: index + 1,
          lane,
          temperature,
          configurationFingerprint: measurement.configurationFingerprint,
          firstTextMs: measurement.firstTextMs,
          localOverheadMs: Number.isFinite(measurement.localOverheadMs) ? measurement.localOverheadMs : null,
          processSpawned: measurement.processSpawned === true,
          gatewaySpawned: measurement.gatewaySpawned === true,
        });
      }
    }
    sections[temperature] = {
      samples: sampleCount, successes: sampleCount, failures: 0,
      native: { firstTextMs: summarize(lanes.native.map((item) => item.firstTextMs)), rawSamples: lanes.native },
      athena: {
        firstTextMs: summarize(lanes.athena.map((item) => item.firstTextMs)), rawSamples: lanes.athena,
        localOverheadMs: summarize(lanes.athena.map((item) => item.localOverheadMs)),
        processSpawns: lanes.athena.filter((item) => item.processSpawned).length,
        gatewaySpawns: lanes.athena.filter((item) => item.gatewaySpawned).length,
        warmedTurnSpawns: 0,
      },
    };
  }
  return withEvidenceMetadata({
    provider: options.provider, mode: 'paired',
    environment: environmentFingerprint(), configurationFingerprint,
    cold: sections.cold, warm: sections.warm,
    comparison: {
      warm: {
        medianDegradationMs: sections.warm.athena.firstTextMs.p50 - sections.warm.native.firstTextMs.p50,
        p95DegradationMs: sections.warm.athena.firstTextMs.p95 - sections.warm.native.firstTextMs.p95,
      },
    },
  }, {
    scenario: 'claude-native-athena-abba',
    provider: options.provider,
    sourceClass: 'claude-live-paired',
    config: { configurationFingerprint, coldSamples: options.coldSamples, warmSamples: options.warmSamples },
  });
}

async function runBenchmark(options) {
  const decision = options.decision || readDecision();
  let report;
  if (options.mode === 'deterministic') {
    if (options.provider === 'codex' && decision.providers?.codex?.enabled !== true) {
      throw new Error('Codex is disabled by contract; run assert-disabled instead of reporting a fake live pass');
    }
    report = await buildDeterministicReport(options);
  } else if (options.mode === 'assert-disabled') {
    report = buildDisabledReport({ ...options, contractDecision: decision.decision });
  } else if (options.mode === 'paired') {
    report = await runPairedBenchmark(options);
  } else {
    throw new Error(`unsupported mode: ${options.mode}`);
  }
  const errors = validateBenchmarkReport(report);
  report.validation = { ok: errors.length === 0, errors };
  const outputPath = writeReport(report, options.outputDirectory || DEFAULT_OUTPUT_DIRECTORY);
  return { report, errors, outputPath, exitCode: errors.length === 0 ? 0 : 1 };
}

function parseCli(argv, env = process.env) {
  const options = {
    samples: DETERMINISTIC_SAMPLE_COUNT,
    warmSamples: 30,
    coldSamples: 5,
    outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
    allowLive: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--allow-live') options.allowLive = true;
    else {
      const value = argv[++index];
      if (value === undefined) throw new Error(`missing value for ${name}`);
      if (name === '--provider') options.provider = value;
      else if (name === '--mode') options.mode = value;
      else if (name === '--samples') options.samples = positiveInteger(value, 'samples');
      else if (name === '--warm-samples') options.warmSamples = positiveInteger(value, 'warm-samples');
      else if (name === '--cold-samples') options.coldSamples = positiveInteger(value, 'cold-samples');
      else if (name === '--output-directory') options.outputDirectory = path.resolve(value);
      else if (name === '--live-runner') options.liveRunnerPath = path.resolve(value);
      else throw new Error(`unknown option: ${name}`);
    }
  }
  if (!['claude', 'codex'].includes(options.provider)) throw new Error('--provider must be claude or codex');
  if (!['deterministic', 'paired', 'assert-disabled'].includes(options.mode)) throw new Error('--mode is invalid');
  if (options.mode === 'paired' && !options.allowLive && env.ATHENA_ALLOW_PAID_PROVIDER_BENCHMARK !== '1') {
    throw new Error('paired benchmark requires explicit --allow-live (paid provider queries are disabled by default)');
  }
  options.allowLive = options.allowLive || env.ATHENA_ALLOW_PAID_PROVIDER_BENCHMARK === '1';
  if (options.liveRunnerPath) {
    const loaded = require(options.liveRunnerPath);
    options.liveRunner = typeof loaded === 'function' ? loaded : loaded.runSample;
  }
  return options;
}

async function main() {
  try {
    const result = await runBenchmark(parseCli(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ ...result.report, rawSamples: undefined })}\n`);
    process.stdout.write(`report: ${result.outputPath}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`provider benchmark failed: ${error && error.message ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = {
  DEFAULT_THRESHOLDS,
  buildDeterministicReport,
  buildDisabledReport,
  parseCli,
  runBenchmark,
  runPairedBenchmark,
  validateBenchmarkReport,
  validateEvidenceMetadata,
  validatePairedReport,
  withEvidenceMetadata,
};
