'use strict';

const SCENARIOS = new Set(['completed', 'interrupted', 'failed', 'rotation', 'shutdown']);
const TURN_SCENARIOS = new Set(['completed', 'interrupted', 'failed']);
const CONTRACT_REVISION = 'athena-provider-lifecycle-telemetry-v1';
const PAINT_CONTRACT_REVISION = 'provider-first-paint-double-raf-v1';

function nonEmpty(value) {
  return typeof value === 'string' && value.length > 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve, settled: false };
}

function createProviderVerifierTelemetry({
  mainSourceHash,
  firstPaintSourceHash,
  maxEvents = 16,
  snapshotWaitMs = 30_000,
} = {}) {
  if (!/^[0-9a-f]{64}$/i.test(String(mainSourceHash || ''))) {
    throw new TypeError('mainSourceHash must be a SHA-256 hash');
  }
  if (!/^[0-9a-f]{64}$/i.test(String(firstPaintSourceHash || ''))) {
    throw new TypeError('firstPaintSourceHash must be a SHA-256 hash');
  }
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1) throw new TypeError('maxEvents must be positive');
  if (!Number.isFinite(snapshotWaitMs) || snapshotWaitMs <= 0) throw new TypeError('snapshotWaitMs must be positive');

  const scenarios = new Map();
  const correlations = new Set();
  const events = [];
  let verifierNonce = null;

  function append(event) {
    if (events.length >= maxEvents) throw new Error('provider verifier telemetry event bound exceeded');
    events.push(Object.freeze(event));
  }

  function finishIfComplete(state) {
    const complete = state.scenario === 'completed'
      ? state.kinds.has('turn-terminal') && state.kinds.has('first-paint-ack-accepted')
      : state.kinds.size === 1;
    if (complete && !state.completion.settled) {
      state.completion.settled = true;
      state.completion.resolve();
    }
  }

  function scenarioForCorrelation(correlationId, allowed) {
    for (const state of scenarios.values()) {
      if (state.correlationId === correlationId && allowed.has(state.scenario)) return state;
    }
    return null;
  }

  async function beginScenario(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).sort().join('|') !== 'correlationId|scenario|verifierNonce') {
      throw new TypeError('exact verifier scenario identity is required');
    }
    const { scenario, correlationId, verifierNonce: nonce } = input;
    if (!SCENARIOS.has(scenario)) throw new Error('verifier scenario is invalid');
    if (!nonEmpty(correlationId) || !nonEmpty(nonce)) throw new Error('verifier scenario correlation and nonce are required');
    if (verifierNonce && verifierNonce !== nonce) throw new Error('verifier nonce mismatch');
    if (scenarios.has(scenario) || correlations.has(correlationId)) throw new Error('duplicate verifier scenario correlation');
    verifierNonce = nonce;
    scenarios.set(scenario, {
      scenario,
      correlationId,
      authorized: false,
      kinds: new Set(),
      completion: deferred(),
    });
    correlations.add(correlationId);
  }

  function recordTerminal(event) {
    const state = scenarioForCorrelation(event?.clientSubmitId, TURN_SCENARIOS);
    if (!state) return false;
    if (state.kinds.has('turn-terminal')) throw new Error('duplicate verifier terminal completion');
    if (!nonEmpty(event?.turnId) || !positiveInteger(event?.runtimeGeneration)) {
      throw new Error('verifier terminal completion is incomplete');
    }
    const expectedType = state.scenario === 'completed'
      ? 'turn_completed'
      : state.scenario === 'interrupted' ? 'turn_interrupted' : 'turn_failed';
    if (event.type !== expectedType) throw new Error('verifier terminal outcome does not match scenario');
    const code = event.type === 'turn_completed'
      ? 'TURN_COMPLETED'
      : event.type === 'turn_interrupted' ? 'PROVIDER_INTERRUPTED' : event.payload?.code;
    if (!nonEmpty(code)) throw new Error('verifier terminal code is missing');
    append({
      kind: 'turn-terminal',
      scenario: state.scenario,
      verifierNonce,
      correlationId: state.correlationId,
      clientSubmitId: event.clientSubmitId,
      turnId: event.turnId,
      runtimeGeneration: event.runtimeGeneration,
      outcome: state.scenario,
      code,
    });
    state.kinds.add('turn-terminal');
    finishIfComplete(state);
    return true;
  }

  function recordPaintAck({ senderWebContentsId, senderFrameUrl, runtimeGeneration, ackResult, payload } = {}) {
    const state = scenarioForCorrelation(payload?.clientSubmitId, new Set(['completed']));
    if (!state) return false;
    if (state.kinds.has('first-paint-ack-accepted')) throw new Error('duplicate verifier paint ACK completion');
    if (ackResult?.accepted !== true || !nonEmpty(payload?.turnId) || !positiveInteger(payload?.sequence)
      || !positiveInteger(runtimeGeneration) || !positiveInteger(senderWebContentsId)
      || !nonEmpty(senderFrameUrl) || !/(shell|orb)\.html(?:[?#].*)?$/i.test(senderFrameUrl)) {
      throw new Error('verifier paint ACK completion is incomplete');
    }
    append({
      kind: 'first-paint-ack-accepted',
      scenario: 'completed',
      verifierNonce,
      correlationId: state.correlationId,
      clientSubmitId: payload.clientSubmitId,
      turnId: payload.turnId,
      sequence: payload.sequence,
      runtimeGeneration,
      senderWebContentsId,
      senderFrameUrl,
      registryAccepted: true,
      doubleRafDepth: 2,
      contractRevision: PAINT_CONTRACT_REVISION,
      sourceHash: firstPaintSourceHash,
    });
    state.kinds.add('first-paint-ack-accepted');
    finishIfComplete(state);
    return true;
  }

  function authorizeRotation(correlationId) {
    const state = scenarios.get('rotation');
    if (!state || state.correlationId !== correlationId) throw new Error('rotation correlation mismatch');
    if (state.authorized) throw new Error('duplicate rotation authorization');
    state.authorized = true;
    return true;
  }

  function recordRotationCompletion({ correlationId, previousSnapshot, nextSnapshot } = {}) {
    const state = scenarios.get('rotation');
    if (!state) return false;
    if (!nonEmpty(correlationId) || correlationId !== state.correlationId) return false;
    if (!state.authorized) throw new Error('rotation completion was not authorized');
    if (state.kinds.has('runtime-rotation')) throw new Error('duplicate rotation completion');
    const previousGeneration = previousSnapshot?.runtimeGeneration;
    const nextGeneration = nextSnapshot?.runtimeGeneration;
    if (!positiveInteger(previousGeneration) || !positiveInteger(nextGeneration)
      || previousGeneration === nextGeneration || previousSnapshot?.ready !== true
      || previousSnapshot?.lifecycleClosed !== false || nextSnapshot?.ready !== true
      || nextSnapshot?.lifecycleClosed !== false) {
      throw new Error('rotation completion is shallow or incomplete');
    }
    append({
      kind: 'runtime-rotation',
      scenario: 'rotation',
      verifierNonce,
      correlationId: state.correlationId,
      previousGeneration,
      nextGeneration,
      oldRuntime: { adapterStop: 'completed', adapterDrain: 'completed', processFence: 'terminal' },
      newRuntime: { generation: nextGeneration, ready: true },
    });
    state.kinds.add('runtime-rotation');
    finishIfComplete(state);
    return true;
  }

  function recordShutdownCompletion({ runtimeGeneration, stoppedSnapshot } = {}) {
    const state = scenarios.get('shutdown');
    if (!state) return false;
    if (state.kinds.has('runtime-shutdown')) throw new Error('duplicate shutdown completion');
    if (!positiveInteger(runtimeGeneration) || stoppedSnapshot?.runtimeGeneration !== runtimeGeneration
      || stoppedSnapshot?.state !== 'stopped' || stoppedSnapshot?.ready !== false
      || stoppedSnapshot?.lifecycleClosed !== true) {
      throw new Error('shutdown completion is shallow or incomplete');
    }
    append({
      kind: 'runtime-shutdown',
      scenario: 'shutdown',
      verifierNonce,
      correlationId: state.correlationId,
      runtimeGeneration,
      adapterStop: 'completed',
      adapterDrain: 'completed',
      processFence: 'terminal',
    });
    state.kinds.add('runtime-shutdown');
    finishIfComplete(state);
    return true;
  }

  async function snapshot({ verifierNonce: nonce } = {}) {
    if (!nonEmpty(nonce) || nonce !== verifierNonce) throw new Error('verifier nonce mismatch');
    const pending = [...scenarios.values()].filter((state) => !state.completion.settled);
    if (pending.length > 0) {
      let timer;
      await Promise.race([
        Promise.all(pending.map((state) => state.completion.promise)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('verifier scenario completion is missing')), snapshotWaitMs);
        }),
      ]).finally(() => clearTimeout(timer));
    }
    return Object.freeze({
      contractRevision: CONTRACT_REVISION,
      owner: 'main',
      sourceHash: mainSourceHash,
      verifierNonce,
      events: events.map((event) => ({ ...event })),
    });
  }

  return Object.freeze({
    authorizeRotation,
    beginScenario,
    recordPaintAck,
    recordRotationCompletion,
    recordShutdownCompletion,
    recordTerminal,
    snapshot,
  });
}

module.exports = { createProviderVerifierTelemetry };
