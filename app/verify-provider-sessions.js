'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const { ProviderSessionSupervisor } = require('./lib/main/provider-session-supervisor');
const {
  buildDeterministicReport,
  buildDisabledReport,
  validateEvidenceMetadata,
  withEvidenceMetadata,
} = require('./scripts/benchmark-provider-sessions');

const DEFAULT_OUTPUT_PATH = path.resolve(__dirname, '..', 'artifacts', 'provider-sessions', 'verification.json');
const DECISION_PATH = path.resolve(__dirname, 'test-fixtures', 'provider-contract', 'decision.json');

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
    provider: 'claude', accountId: 'verification-account', conversationId: 'verification-conversation',
    cwd: 'C:\\athena-verification',
    model: null, effort: null, systemPrompt: 'verification', systemPromptHash: 'a'.repeat(64),
    configGeneration: 1, securityGeneration: 1,
    mcpSnapshot: { revision: 1 }, toolPolicy: { allowed: ['Read'] },
  };
}

async function runSupervisorHardening() {
  let sessionStarts = 0;
  let sessionStops = 0;
  let active = 0;
  let maxActive = 0;
  let uuidCounter = 0;
  let deliveredEvents = 0;
  let staleContext = null;
  const adapter = {
    async start() { sessionStarts += 1; },
    async ready() {},
    async sendTurn(turn, context) {
      staleContext = context;
      active += 1;
      maxActive = Math.max(maxActive, active);
      const suffix = turn.userText.split('-').at(-1);
      if (turn.userText === 'fault-interrupted') {
        context.emit('turn_interrupted', { providerBinding: null, reason: 'fault probe' });
      } else if (turn.userText === 'fault-failed') {
        context.emit('turn_failed', { code: 'FAULT_PROBE', retryable: false, safeMessage: 'fault probe' });
      } else {
        context.emit('turn_completed', completedPayload(suffix));
      }
      active -= 1;
      return { timings: { deterministic: true } };
    },
    async interrupt() {},
    async stop() { sessionStops += 1; },
  };
  const supervisor = new ProviderSessionSupervisor({
    adapterFactory: () => adapter,
    onEvent() { deliveredEvents += 1; },
    uuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
    queueTask: (callback) => callback(),
  });
  await supervisor.start(desiredState());
  await supervisor.ready();
  for (let index = 1; index <= 500; index += 1) {
    const result = await supervisor.sendTurn({
      clientSubmitId: `123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`,
      conversationId: 'verification-conversation', origin: 'shell', userText: `soak-${index}`,
    });
    if (!result.ok) throw new Error(`hardening turn ${index} failed`);
  }
  const deliveredBeforeLateProbe = deliveredEvents;
  let staleProbeRejected = false;
  try {
    staleContext.emit('text_delta', { text: 'late stale event probe' });
  } catch (error) {
    staleProbeRejected = error && error.code === 'STALE_PROVIDER_TURN';
  }
  const staleEventsDelivered = deliveredEvents - deliveredBeforeLateProbe;
  const interrupted = await supervisor.sendTurn({
    clientSubmitId: '123e4567-e89b-42d3-a456-000000000501', conversationId: 'verification-conversation',
    origin: 'shell', userText: 'fault-interrupted',
  });
  const failed = await supervisor.sendTurn({
    clientSubmitId: '123e4567-e89b-42d3-a456-000000000502', conversationId: 'verification-conversation',
    origin: 'shell', userText: 'fault-failed',
  });
  const beforeStop = supervisor.snapshot();
  await supervisor.stop('verification_shutdown');
  const afterStop = supervisor.snapshot();
  return {
    totalTurns: 502,
    completedTurns: beforeStop.metrics.turnsCompleted,
    interruptedTurns: interrupted.interrupted === true ? 1 : 0,
    failedTurns: failed.ok === false && failed.interrupted === false ? 1 : 0,
    staleProbeInjected: true,
    staleProbeRejected,
    staleEventsDelivered,
    staleEventsDropped: beforeStop.metrics.staleEventDropped,
    runtimeAccounting: {
      kind: 'injected-node-session-harness',
      sessionStarts,
      sessionStops,
      gatewayStarts: sessionStarts,
      gatewayStops: sessionStops,
      warmedTurnSessionStarts: Math.max(0, sessionStarts - 1),
    },
    maxConcurrentTurns: maxActive,
    shutdownClean: afterStop.state === 'stopped' && afterStop.activeTurnCount === 0
      && afterStop.pendingTurnCount === 0 && sessionStops === 1,
  };
}

function validateVerificationReport(report) {
  const verifierScriptHash = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
  const errors = validateEvidenceMetadata(report, 'node-injected', verifierScriptHash);
  if (!report || report.surface !== 'injected-node-harness') errors.push('injected Node harness surface is invalid');
  if (report?.scenario === 'all' && !report.integration) errors.push('integration section is missing');
  if (report?.scenario === 'all' && !report.hardening) errors.push('hardening section is missing');
  if (report?.scenario === 'integration' && !report.integration) errors.push('integration section is missing');
  if (report?.scenario === 'hardening' && !report.hardening) errors.push('hardening section is missing');
  if (!Array.isArray(report?.pendingRuntimeEvidence)
    || !['electron-runtime', 'provider-os-process', 'gateway-os-process', 'process-leak-scan']
      .every((gate) => report.pendingRuntimeEvidence.includes(gate))) {
    errors.push('runtime and OS-process evidence must remain explicitly pending');
  }
  if (report.integration) {
    if (report.integration.correlatedSamples !== report.integration.completedTurns) errors.push('correlated sample count is invalid');
    if (report.integration.paint?.status !== 'pending-electron-runtime') errors.push('Electron paint ACK evidence must remain pending');
    const thresholds = {
      main_ipc_to_provider_write_ms: 15,
      provider_event_to_main_dispatch_ms: 10,
    };
    for (const [name, threshold] of Object.entries(thresholds)) {
      const summary = report.integration.timings?.[name];
      if (!summary || !Number.isFinite(summary.p95) || summary.p95 > threshold) errors.push(`${name} verification threshold failed`);
    }
  }
  if (report.hardening) {
    const accounting = report.hardening.runtimeAccounting;
    if (report.hardening.completedTurns !== 500 || !accounting
      || accounting.kind !== 'injected-node-session-harness' || accounting.sessionStarts !== 1
      || accounting.sessionStops !== 1 || accounting.gatewayStarts !== 1 || accounting.gatewayStops !== 1
      || accounting.warmedTurnSessionStarts !== 0
      || report.hardening.maxConcurrentTurns !== 1) errors.push('hardening injected lifecycle/FIFO invariant failed');
    if (report.hardening.interruptedTurns !== 1 || report.hardening.failedTurns !== 1) errors.push('hardening fault outcome invariant failed');
    if (report.hardening.staleProbeInjected !== true || report.hardening.staleProbeRejected !== true
      || report.hardening.staleEventsDropped < 1 || report.hardening.staleEventsDelivered !== 0) {
      errors.push('injected stale event probe failed');
    }
    if (report.hardening.shutdownClean !== true) errors.push('shutdown leak invariant failed');
  }
  const codex = report.codexDisabled;
  if (!codex || codex.samples !== 30 || codex.actionNeeded !== 30 || codex.selectionCalls !== 30
    || codex.providerStartCalls !== 0 || codex.fallbackCalls !== 0) errors.push('Codex disabled callback contract failed');
  return errors;
}

async function runInjectedNodeProviderVerification({ scenario = 'all', recordPath = null, orchestratorHoldMs = 0 } = {}) {
  if (!['integration', 'hardening', 'all'].includes(scenario)) throw new Error('scenario is invalid');
  const decision = JSON.parse(fs.readFileSync(DECISION_PATH, 'utf8'));
  if (decision.decision !== 'CLAUDE_ONLY') throw new Error('this verifier expects the pinned CLAUDE_ONLY contract');
  const benchmark = scenario === 'integration' || scenario === 'all'
    ? await buildDeterministicReport({ provider: 'claude', samples: 100 })
    : null;
  const report = withEvidenceMetadata({
    scenario,
    surface: 'injected-node-harness',
    paidQueries: 0,
    runtimeEvidence: {
      osProcessChecksExecuted: false,
      pathProvided: Boolean(recordPath),
      note: 'A record path does not prove an Electron or OS-process run.',
    },
    pendingRuntimeEvidence: ['electron-runtime', 'provider-os-process', 'gateway-os-process', 'process-leak-scan'],
    integration: benchmark ? {
      samples: benchmark.samples,
      completedTurns: benchmark.successes,
      correlatedSamples: benchmark.rawSamples.length,
      paint: { status: 'pending-electron-runtime' },
      timings: benchmark.timings,
      runtimeAccounting: benchmark.runtimeAccounting,
    } : null,
    hardening: scenario === 'hardening' || scenario === 'all' ? await runSupervisorHardening() : null,
    codexDisabled: buildDisabledReport({ provider: 'codex', samples: 30, contractDecision: decision.decision }),
  }, {
    scenario,
    provider: 'claude',
    config: { scenario, recordPathProvided: Boolean(recordPath), decision: decision.decision },
  });
  report.scriptHash = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
  if (!process.env.ATHENA_SOURCE_REVISION) report.sourceRevision = report.scriptHash;
  const errors = validateVerificationReport(report);
  report.ok = errors.length === 0;
  report.errors = errors;
  if (orchestratorHoldMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, orchestratorHoldMs));
  }
  return report;
}

function parseCli(argv, env = process.env) {
  const parsed = { scenario: 'all', outputPath: null, requireOrchestrator: false };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--require-orchestrator') parsed.requireOrchestrator = true;
    else {
      const value = argv[++index];
      if (value === undefined) throw new Error(`missing value for ${name}`);
      if (name === '--scenario') parsed.scenario = value;
      else if (name === '--output') parsed.outputPath = path.resolve(value);
      else throw new Error(`unknown option: ${name}`);
    }
  }
  if (!['integration', 'hardening', 'all'].includes(parsed.scenario)) throw new Error('--scenario is invalid');
  parsed.runId = env.ATHENA_PROVIDER_LEAK_RUN_ID || null;
  parsed.recordPath = env.ATHENA_PROVIDER_LEAK_RECORD_PATH || null;
  if (parsed.requireOrchestrator && (!parsed.runId || !parsed.recordPath)) {
    throw new Error('leak orchestrator environment is required');
  }
  parsed.orchestratorHoldMs = parsed.requireOrchestrator ? 3_000 : 0;
  return parsed;
}

async function main() {
  try {
    const options = parseCli(process.argv.slice(2));
    const report = await runInjectedNodeProviderVerification(options);
    const outputPath = options.outputPath || path.join(path.dirname(DEFAULT_OUTPUT_PATH),
      `node-injected-claude-${report.scenario}-${Date.now()}-${crypto.randomUUID()}.json`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.stdout.write(`report: ${outputPath}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`provider session verification failed: ${error && error.message ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = {
  parseCli,
  runInjectedNodeProviderVerification,
  validateVerificationReport,
};
