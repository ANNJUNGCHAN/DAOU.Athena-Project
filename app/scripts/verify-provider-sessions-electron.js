'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCENARIOS = Object.freeze(['completed', 'interrupted', 'failed', 'rotation', 'shutdown']);
const MAX_AGE_MS = 15 * 60 * 1_000;
const FIRST_PAINT_CONTRACT_REVISION = 'provider-first-paint-double-raf-v1';
const LIFECYCLE_TELEMETRY_REVISION = 'athena-provider-lifecycle-telemetry-v1';
const FIRST_PAINT_PATH = path.resolve(__dirname, '..', 'provider-first-paint.js');
const MAIN_PATH = path.resolve(__dirname, '..', 'main.js');
const PAINT_ACK_KEYS = Object.freeze([
  'clientSubmitId', 'rendererPaintedAt', 'rendererReceivedAt',
  'rendererSubmittedAt', 'sequence', 'turnId',
]);

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parseElectronVerifierArgs(argv) {
  const parsed = { scenario: 'all', outputPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[++index];
    if (value === undefined) throw new Error(`missing value for ${name}`);
    if (name === '--scenario') parsed.scenario = value;
    else if (name === '--output') parsed.outputPath = path.resolve(value);
    else throw new Error(`unknown option: ${name}`);
  }
  if (parsed.scenario !== 'all' && !SCENARIOS.includes(parsed.scenario)) throw new Error('scenario is invalid');
  return parsed;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.length > 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validIdentity(value) {
  return value && nonEmpty(value.clientSubmitId) && nonEmpty(value.correlationId) && nonEmpty(value.turnId);
}

function matchingEvents(manifest, predicate) {
  const events = Array.isArray(manifest?.lifecycleTelemetry?.events)
    ? manifest.lifecycleTelemetry.events : [];
  return events.filter(predicate);
}

function exactEvent(manifest, scenario, kind, correlationId) {
  const events = matchingEvents(manifest, (event) => event?.scenario === scenario
    && event?.kind === kind && event?.verifierNonce === manifest?.verifierNonce
    && event?.correlationId === correlationId);
  return events.length === 1 ? events[0] : null;
}

function completeFence(value) {
  return value?.adapterStop === 'completed'
    && value?.adapterDrain === 'completed'
    && value?.processFence === 'terminal';
}

function validateTerminalScenario(manifest, scenario, outcome, expectedCode, errors) {
  const evidence = manifest?.scenarios?.[scenario];
  if (!validIdentity(evidence)) {
    errors.push(`${scenario} scenario identity is missing`);
    return null;
  }
  const event = exactEvent(manifest, scenario, 'turn-terminal', evidence.correlationId);
  if (!event || event.clientSubmitId !== evidence.clientSubmitId || event.turnId !== evidence.turnId
    || event.outcome !== outcome || !positiveInteger(event.runtimeGeneration)) {
    errors.push(`${scenario} main telemetry does not match the exact turn and correlation`);
    return null;
  }
  if (event.code !== expectedCode) {
    errors.push(scenario === 'interrupted'
      ? 'interrupted scenario interruption code is invalid'
      : `${scenario} scenario terminal code is invalid`);
    return null;
  }
  return event;
}

function validateCompletedPaint(manifest, completed, terminal, errors) {
  if (!completed || !terminal) return;
  const productionHash = fs.existsSync(FIRST_PAINT_PATH) ? sha256File(FIRST_PAINT_PATH) : null;
  if (manifest?.firstPaintProduction?.contractRevision !== FIRST_PAINT_CONTRACT_REVISION) {
    errors.push('production first-paint contract revision is invalid');
  }
  if (!productionHash || manifest?.firstPaintProduction?.sourceHash !== productionHash) {
    errors.push('production first-paint source hash is invalid');
  }
  const accepted = exactEvent(manifest, 'completed', 'first-paint-ack-accepted', completed.correlationId);
  if (!accepted || accepted.clientSubmitId !== completed.clientSubmitId || accepted.turnId !== completed.turnId
    || accepted.runtimeGeneration !== terminal.runtimeGeneration || accepted.registryAccepted !== true
    || accepted.doubleRafDepth !== 2 || accepted.contractRevision !== FIRST_PAINT_CONTRACT_REVISION
    || accepted.sourceHash !== productionHash || !positiveInteger(accepted.sequence)
    || !positiveInteger(accepted.senderWebContentsId) || !nonEmpty(accepted.senderFrameUrl)) {
    errors.push('completed scenario requires a main-accepted first-paint ACK bound to the production double-rAF contract');
    return;
  }
  const raw = Array.isArray(manifest?.paintAcks) ? manifest.paintAcks.filter((record) => {
    const payload = record?.payload;
    return record.senderWebContentsId === accepted.senderWebContentsId
      && record.senderFrameUrl === accepted.senderFrameUrl
      && /\/(shell|orb)\.html(?:[?#].*)?$/i.test(record.senderFrameUrl)
      && payload && Object.keys(payload).sort().join('|') === PAINT_ACK_KEYS.join('|')
      && payload?.clientSubmitId === completed.clientSubmitId
      && payload?.turnId === completed.turnId
      && payload?.sequence === accepted.sequence
      && Number.isFinite(payload.rendererSubmittedAt) && payload.rendererSubmittedAt >= 0
      && Number.isFinite(payload.rendererReceivedAt) && payload.rendererReceivedAt >= payload.rendererSubmittedAt
      && Number.isFinite(payload.rendererPaintedAt) && payload.rendererPaintedAt >= payload.rendererReceivedAt;
  }) : [];
  if (raw.length !== 1) errors.push('completed scenario ACK provenance is missing or ambiguous');
}

function validateElectronManifest(manifest) {
  const errors = [];
  if (manifest?.schemaVersion !== 2) errors.push('schemaVersion is invalid');
  if (manifest?.provider !== 'claude' || manifest?.sourceClass !== 'electron-runtime') {
    errors.push('provider/source class is invalid');
  }
  for (const field of ['sourceRevision', 'scriptHash', 'configFingerprint']) {
    const minimum = field === 'sourceRevision' ? 7 : 64;
    if (!new RegExp(`^[0-9a-f]{${minimum},64}$`, 'i').test(String(manifest?.[field] || ''))) {
      errors.push(`${field} is invalid`);
    }
  }
  if (manifest?.scriptHash !== sha256File(__filename)) {
    errors.push('scriptHash does not match the Electron verifier source');
  }
  const generatedAt = Date.parse(manifest?.generatedAt);
  const expiresAt = Date.parse(manifest?.freshness?.expiresAt);
  if (!Number.isFinite(generatedAt) || !Number.isFinite(expiresAt)
    || manifest?.freshness?.status !== 'fresh' || expiresAt <= Date.now()
    || generatedAt > Date.now() + 5_000 || expiresAt - generatedAt > MAX_AGE_MS) {
    errors.push('Electron evidence is stale');
  }
  if (!nonEmpty(manifest?.verifierNonce)) errors.push('verifier nonce is missing');
  if (manifest?.lifecycleTelemetry?.contractRevision !== LIFECYCLE_TELEMETRY_REVISION
    || manifest?.lifecycleTelemetry?.owner !== 'main'
    || manifest?.lifecycleTelemetry?.verifierNonce !== manifest?.verifierNonce
    || !Array.isArray(manifest?.lifecycleTelemetry?.events)) {
    errors.push('main-owned lifecycle telemetry contract is invalid');
  }
  if (manifest?.lifecycleTelemetry?.sourceHash !== sha256File(MAIN_PATH)) {
    errors.push('main telemetry source hash is invalid');
  }

  const required = manifest?.scenario === 'all' ? SCENARIOS : [manifest?.scenario];
  for (const scenario of required) {
    if (!SCENARIOS.includes(scenario)) errors.push(`${scenario || 'scenario'} is invalid`);
  }

  if (required.includes('completed')) {
    const evidence = manifest?.scenarios?.completed;
    const terminal = validateTerminalScenario(manifest, 'completed', 'completed', 'TURN_COMPLETED', errors);
    validateCompletedPaint(manifest, evidence, terminal, errors);
  }
  if (required.includes('interrupted')) {
    validateTerminalScenario(manifest, 'interrupted', 'interrupted', 'PROVIDER_INTERRUPTED', errors);
  }
  if (required.includes('failed')) {
    const evidence = manifest?.scenarios?.failed;
    if (!nonEmpty(evidence?.expectedCode) || evidence.expectedCode === 'PROVIDER_INTERRUPTED') {
      errors.push('failed scenario expected code is invalid');
    } else {
      validateTerminalScenario(manifest, 'failed', 'failed', evidence.expectedCode, errors);
    }
  }
  let rotationGeneration = null;
  if (required.includes('rotation')) {
    const evidence = manifest?.scenarios?.rotation;
    if (!nonEmpty(evidence?.correlationId)) {
      errors.push('rotation scenario correlation is missing');
    } else {
      const event = exactEvent(manifest, 'rotation', 'runtime-rotation', evidence.correlationId);
      if (!event) errors.push('rotation main telemetry is missing');
      else {
        if (!positiveInteger(event.previousGeneration) || !positiveInteger(event.nextGeneration)
          || event.previousGeneration === event.nextGeneration
          || event.newRuntime?.generation !== event.nextGeneration || event.newRuntime?.ready !== true) {
          errors.push('rotation runtime generation transition is invalid');
        } else rotationGeneration = event.nextGeneration;
        if (!completeFence(event.oldRuntime)) {
          errors.push('rotation old runtime stop, drain, and fence are incomplete');
        }
      }
    }
  }
  if (required.includes('shutdown')) {
    const evidence = manifest?.scenarios?.shutdown;
    if (!nonEmpty(evidence?.correlationId)) {
      errors.push('shutdown scenario correlation is missing');
    } else {
      const event = exactEvent(manifest, 'shutdown', 'runtime-shutdown', evidence.correlationId);
      if (!event || !positiveInteger(event.runtimeGeneration)) errors.push('shutdown main telemetry is missing');
      else {
        if (rotationGeneration !== null && event.runtimeGeneration !== rotationGeneration) {
          errors.push('shutdown runtime generation does not match the rotated runtime');
        }
        if (!completeFence(event)) errors.push('shutdown runtime stop, drain, and fence are incomplete');
      }
    }
  }
  return errors;
}

function telemetryEventMatches(event, expected) {
  return event?.kind === expected.kind
    && event?.scenario === expected.scenario
    && event?.correlationId === expected.correlationId
    && event?.verifierNonce === expected.verifierNonce;
}

async function waitForTelemetryEvent(telemetry, expected, { timeoutMs = 30_000, pollIntervalMs = 25 } = {}) {
  if (!positiveInteger(timeoutMs) || !positiveInteger(pollIntervalMs)) {
    throw new TypeError('telemetry wait bounds must be positive integers');
  }
  if (!nonEmpty(expected?.verifierNonce) || !nonEmpty(expected?.correlationId)
    || !nonEmpty(expected?.scenario) || !nonEmpty(expected?.kind)) {
    throw new Error('telemetry event correlation is incomplete');
  }
  if (typeof telemetry?.waitForEvent === 'function') {
    let timer;
    try {
      const event = await Promise.race([
        Promise.resolve(telemetry.waitForEvent(expected)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`timed out waiting for ${expected.kind}`)), timeoutMs);
        }),
      ]);
      if (!telemetryEventMatches(event, expected)) {
        throw new Error(`main telemetry returned an uncorrelated ${expected.kind} event`);
      }
      return event;
    } finally {
      clearTimeout(timer);
    }
  }
  if (typeof telemetry?.snapshot !== 'function') {
    throw new Error('main-owned lifecycle telemetry cannot wait for events');
  }
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const snapshot = await telemetry.snapshot({ verifierNonce: expected.verifierNonce });
    const event = Array.isArray(snapshot?.events)
      ? snapshot.events.find((candidate) => telemetryEventMatches(candidate, expected)) : null;
    if (event) return event;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${expected.kind}`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, deadline - Date.now())));
  }
}

function requiredTelemetryEvents(scenario, scenarios, verifierNonce) {
  const required = scenario === 'all' ? SCENARIOS : [scenario];
  const events = [];
  for (const name of required) {
    const correlationId = scenarios?.[name]?.correlationId;
    if (!nonEmpty(correlationId)) throw new Error(`${name} scenario correlation is missing`);
    if (name === 'completed') {
      events.push({ kind: 'turn-terminal', scenario: name, correlationId, verifierNonce });
      events.push({ kind: 'first-paint-ack-accepted', scenario: name, correlationId, verifierNonce });
    } else if (name === 'interrupted' || name === 'failed') {
      events.push({ kind: 'turn-terminal', scenario: name, correlationId, verifierNonce });
    } else if (name === 'rotation') {
      events.push({ kind: 'runtime-rotation', scenario: name, correlationId, verifierNonce });
    } else if (name === 'shutdown') {
      events.push({ kind: 'runtime-shutdown', scenario: name, correlationId, verifierNonce });
    }
  }
  return events;
}

async function waitForRequiredTelemetry(telemetry, scenario, scenarios, verifierNonce, options) {
  if (typeof telemetry?.snapshot !== 'function') {
    throw new Error('main-owned lifecycle telemetry snapshot is unavailable');
  }
  const { timeoutMs = 30_000, pollIntervalMs = 25 } = options || {};
  if (!positiveInteger(timeoutMs) || !positiveInteger(pollIntervalMs)) {
    throw new TypeError('telemetry wait bounds must be positive integers');
  }
  const required = requiredTelemetryEvents(scenario, scenarios, verifierNonce);
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const snapshot = await telemetry.snapshot({ verifierNonce });
    const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
    if (required.every((expected) => events.some((event) => telemetryEventMatches(event, expected)))) {
      return snapshot;
    }
    if (Date.now() >= deadline) throw new Error('timed out waiting for final lifecycle telemetry snapshot');
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, deadline - Date.now())));
  }
}

async function announceScenario(telemetry, scenario, correlationId, verifierNonce) {
  if (typeof telemetry?.beginScenario !== 'function') {
    throw new Error('main-owned lifecycle telemetry cannot correlate verifier scenarios');
  }
  if (!nonEmpty(verifierNonce)) throw new Error('verifier nonce is required for scenario correlation');
  await telemetry.beginScenario({ scenario, correlationId, verifierNonce });
}

async function driveActualScenarios({ electron, lifecycleTelemetry, scenario, prompt, failedPrompt, failedCode,
  verifierNonce, telemetryTimeoutMs = 30_000, telemetryPollIntervalMs = 25 }) {
  const required = scenario === 'all' ? SCENARIOS : [scenario];
  const windows = electron.BrowserWindow.getAllWindows();
  const shell = windows.find((window) => !window.isDestroyed() && window.webContents.getURL().includes('shell.html'));
  if (!shell) throw new Error('Athena shell window is unavailable');
  await shell.webContents.executeJavaScript('document.readyState === "complete"');
  const invoke = (channel, payload) => shell.webContents.executeJavaScript(
    `window.athena.invoke(${JSON.stringify(channel)}, ${JSON.stringify(payload)})`, true,
  );
  const observed = Object.create(null);
  if (required.includes('completed')) {
    if (!prompt) throw new Error('ATHENA_PROVIDER_VERIFIER_PROMPT is required');
    const correlationId = crypto.randomUUID();
    await announceScenario(lifecycleTelemetry, 'completed', correlationId, verifierNonce);
    const result = await invoke('athena__render_canvas', {
      query: prompt, expand: false, clientSubmitId: correlationId, rendererSubmittedAt: performance.now(),
    });
    if (!result?.ok || !nonEmpty(result.turnId)) throw new Error('completed scenario did not complete');
    observed.completed = { clientSubmitId: correlationId, correlationId, turnId: result.turnId };
    await waitForTelemetryEvent(lifecycleTelemetry,
      { kind: 'turn-terminal', scenario: 'completed', correlationId, verifierNonce },
      { timeoutMs: telemetryTimeoutMs, pollIntervalMs: telemetryPollIntervalMs });
    await waitForTelemetryEvent(lifecycleTelemetry,
      { kind: 'first-paint-ack-accepted', scenario: 'completed', correlationId, verifierNonce },
      { timeoutMs: telemetryTimeoutMs, pollIntervalMs: telemetryPollIntervalMs });
  }
  if (required.includes('interrupted')) {
    if (!prompt) throw new Error('ATHENA_PROVIDER_VERIFIER_PROMPT is required');
    const correlationId = crypto.randomUUID();
    await announceScenario(lifecycleTelemetry, 'interrupted', correlationId, verifierNonce);
    const pending = invoke('athena__render_canvas', {
      query: prompt, expand: false, clientSubmitId: correlationId, rendererSubmittedAt: performance.now(),
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    await shell.webContents.executeJavaScript("window.athena.send('athena:abort-live-query')", true);
    const result = await pending;
    if (!nonEmpty(result?.turnId)) throw new Error('interrupted scenario turn identity is missing');
    observed.interrupted = { clientSubmitId: correlationId, correlationId, turnId: result.turnId };
    await waitForTelemetryEvent(lifecycleTelemetry,
      { kind: 'turn-terminal', scenario: 'interrupted', correlationId, verifierNonce },
      { timeoutMs: telemetryTimeoutMs, pollIntervalMs: telemetryPollIntervalMs });
  }
  if (required.includes('failed')) {
    if (!failedPrompt || !nonEmpty(failedCode)) {
      throw new Error('ATHENA_PROVIDER_VERIFIER_FAILED_PROMPT and ATHENA_PROVIDER_VERIFIER_FAILED_CODE are required');
    }
    const correlationId = crypto.randomUUID();
    await announceScenario(lifecycleTelemetry, 'failed', correlationId, verifierNonce);
    const result = await invoke('athena__render_canvas', {
      query: failedPrompt, expand: false, clientSubmitId: correlationId, rendererSubmittedAt: performance.now(),
    });
    if (!nonEmpty(result?.turnId)) throw new Error('failed scenario turn identity is missing');
    observed.failed = { clientSubmitId: correlationId, correlationId, turnId: result.turnId, expectedCode: failedCode };
    await waitForTelemetryEvent(lifecycleTelemetry,
      { kind: 'turn-terminal', scenario: 'failed', correlationId, verifierNonce },
      { timeoutMs: telemetryTimeoutMs, pollIntervalMs: telemetryPollIntervalMs });
  }
  if (required.includes('rotation')) {
    const correlationId = crypto.randomUUID();
    await announceScenario(lifecycleTelemetry, 'rotation', correlationId, verifierNonce);
    await invoke('athena:conversations-new', { verifierCorrelationId: correlationId });
    observed.rotation = { correlationId };
    await waitForTelemetryEvent(lifecycleTelemetry,
      { kind: 'runtime-rotation', scenario: 'rotation', correlationId, verifierNonce },
      { timeoutMs: telemetryTimeoutMs, pollIntervalMs: telemetryPollIntervalMs });
  }
  if (required.includes('shutdown')) {
    const correlationId = crypto.randomUUID();
    await announceScenario(lifecycleTelemetry, 'shutdown', correlationId, verifierNonce);
    observed.shutdown = { correlationId };
    electron.app.quit();
    await waitForTelemetryEvent(lifecycleTelemetry,
      { kind: 'runtime-shutdown', scenario: 'shutdown', correlationId, verifierNonce },
      { timeoutMs: telemetryTimeoutMs, pollIntervalMs: telemetryPollIntervalMs });
  }
  return observed;
}

function resolveLifecycleTelemetry({ electron, applicationHandle, readLifecycleTelemetry }) {
  if (typeof readLifecycleTelemetry === 'function') {
    return { snapshot: readLifecycleTelemetry, beginScenario: null };
  }
  if (typeof applicationHandle?.readLifecycleTelemetry === 'function') {
    return {
      snapshot: applicationHandle.readLifecycleTelemetry.bind(applicationHandle),
      beginScenario: typeof applicationHandle.beginVerifierScenario === 'function'
        ? applicationHandle.beginVerifierScenario.bind(applicationHandle) : null,
      waitForEvent: typeof applicationHandle.waitForTelemetryEvent === 'function'
        ? applicationHandle.waitForTelemetryEvent.bind(applicationHandle) : null,
    };
  }
  const telemetry = electron?.app?.athenaProviderVerifierTelemetry;
  if (typeof telemetry?.snapshot === 'function') return telemetry;
  throw new Error('main-owned lifecycle telemetry is unavailable');
}

async function runElectronRuntimeVerifier({ electron, startApplication, driveScenarios = driveActualScenarios,
  readLifecycleTelemetry, scenario = 'all', timeoutMs = 120_000, prompt, failedPrompt, failedCode,
  configFingerprint, telemetryTimeoutMs = 30_000, telemetryPollIntervalMs = 25 }) {
  if (!electron?.ipcMain || typeof startApplication !== 'function' || typeof driveScenarios !== 'function') {
    throw new TypeError('Electron runtime dependencies are required');
  }
  const verifierNonce = crypto.randomUUID();
  const paintAcks = [];
  const onPaintAck = (event, payload) => {
    paintAcks.push({
      payload,
      senderWebContentsId: event?.sender?.id,
      senderFrameUrl: event?.senderFrame?.url || (typeof event?.sender?.getURL === 'function' ? event.sender.getURL() : null),
    });
  };
  electron.ipcMain.on('athena:provider-paint-ack', onPaintAck);
  try {
    const applicationHandle = await startApplication({ scenario, verifierNonce });
    const lifecycleTelemetry = resolveLifecycleTelemetry({ electron, applicationHandle, readLifecycleTelemetry });
    let timeout;
    let scenarios;
    try {
      scenarios = await Promise.race([
        driveScenarios({ electron, lifecycleTelemetry, scenario, prompt, failedPrompt, failedCode, verifierNonce,
          telemetryTimeoutMs, telemetryPollIntervalMs }),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Electron verifier timed out')), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    const lifecycleSnapshot = await waitForRequiredTelemetry(lifecycleTelemetry, scenario, scenarios, verifierNonce,
      { timeoutMs: telemetryTimeoutMs, pollIntervalMs: telemetryPollIntervalMs });
    const generatedAt = new Date();
    const scriptHash = sha256File(__filename);
    return {
      schemaVersion: 2,
      scenario,
      provider: 'claude',
      sourceClass: 'electron-runtime',
      sourceRevision: process.env.ATHENA_SOURCE_REVISION || scriptHash,
      scriptHash,
      configFingerprint: configFingerprint || '',
      generatedAt: generatedAt.toISOString(),
      freshness: { status: 'fresh', expiresAt: new Date(generatedAt.getTime() + MAX_AGE_MS).toISOString() },
      verifierNonce,
      firstPaintProduction: {
        contractRevision: FIRST_PAINT_CONTRACT_REVISION,
        sourceHash: sha256File(FIRST_PAINT_PATH),
      },
      scenarios,
      paintAcks,
      lifecycleTelemetry: lifecycleSnapshot,
    };
  } finally {
    if (typeof electron.ipcMain.off === 'function') {
      electron.ipcMain.off('athena:provider-paint-ack', onPaintAck);
    } else if (typeof electron.ipcMain.removeListener === 'function') {
      electron.ipcMain.removeListener('athena:provider-paint-ack', onPaintAck);
    }
  }
}

async function main() {
  const options = parseElectronVerifierArgs(process.argv.slice(2));
  const electron = require('electron');
  const manifest = await runElectronRuntimeVerifier({
    electron,
    scenario: options.scenario,
    startApplication: async () => { require('../main'); },
    prompt: process.env.ATHENA_PROVIDER_VERIFIER_PROMPT,
    failedPrompt: process.env.ATHENA_PROVIDER_VERIFIER_FAILED_PROMPT,
    failedCode: process.env.ATHENA_PROVIDER_VERIFIER_FAILED_CODE,
    configFingerprint: process.env.ATHENA_PROVIDER_CONFIG_FINGERPRINT,
  });
  const errors = validateElectronManifest(manifest);
  if (errors.length) throw new Error(errors.join('; '));
  const outputPath = options.outputPath || path.resolve(__dirname, '..', '..', 'artifacts', 'provider-sessions',
    `electron-runtime-claude-${options.scenario}-${Date.now()}-${crypto.randomUUID()}.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`report: ${outputPath}\n`);
}

if (require.main === module) void main().catch((error) => {
  process.stderr.write(`Electron provider verifier failed: ${error.message}\n`);
  process.exitCode = 1;
});

module.exports = {
  FIRST_PAINT_CONTRACT_REVISION,
  LIFECYCLE_TELEMETRY_REVISION,
  driveActualScenarios,
  parseElectronVerifierArgs,
  runElectronRuntimeVerifier,
  validateElectronManifest,
};
