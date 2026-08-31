'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  FIRST_PAINT_CONTRACT_REVISION,
  LIFECYCLE_TELEMETRY_REVISION,
  driveActualScenarios,
  parseElectronVerifierArgs,
  runElectronRuntimeVerifier,
  validateElectronManifest,
} = require('./verify-provider-sessions-electron');

const SOURCE_PATH = require.resolve('./verify-provider-sessions-electron');
const FIRST_PAINT_PATH = path.resolve(__dirname, '..', 'provider-first-paint.js');
const MAIN_PATH = path.resolve(__dirname, '..', 'main.js');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function validManifest() {
  const verifierNonce = crypto.randomUUID();
  const completed = { clientSubmitId: 'submit-complete', correlationId: 'submit-complete', turnId: 'turn-complete' };
  const interrupted = { clientSubmitId: 'submit-interrupt', correlationId: 'submit-interrupt', turnId: 'turn-interrupt' };
  const failed = { clientSubmitId: 'submit-fail', correlationId: 'submit-fail', turnId: 'turn-fail', expectedCode: 'PROVIDER_TEST_FAILURE' };
  const ack = {
    clientSubmitId: completed.clientSubmitId, turnId: completed.turnId, sequence: 1,
    rendererSubmittedAt: 1, rendererReceivedAt: 2, rendererPaintedAt: 3,
  };
  return {
    schemaVersion: 2,
    scenario: 'all',
    provider: 'claude',
    sourceClass: 'electron-runtime',
    sourceRevision: 'a'.repeat(40),
    scriptHash: sha256(SOURCE_PATH),
    configFingerprint: 'c'.repeat(64),
    generatedAt: new Date().toISOString(),
    freshness: { status: 'fresh', expiresAt: new Date(Date.now() + 60_000).toISOString() },
    verifierNonce,
    firstPaintProduction: {
      contractRevision: FIRST_PAINT_CONTRACT_REVISION,
      sourceHash: sha256(FIRST_PAINT_PATH),
    },
    scenarios: {
      completed, interrupted, failed,
      rotation: { correlationId: 'rotate-1' },
      shutdown: { correlationId: 'shutdown-1' },
    },
    paintAcks: [{
      payload: ack,
      senderWebContentsId: 7,
      senderFrameUrl: 'file:///athena/app/shell.html',
    }],
    lifecycleTelemetry: {
      contractRevision: LIFECYCLE_TELEMETRY_REVISION,
      owner: 'main',
      sourceHash: sha256(MAIN_PATH),
      verifierNonce,
      events: [
        { kind: 'turn-terminal', scenario: 'completed', verifierNonce, correlationId: completed.correlationId,
          clientSubmitId: completed.clientSubmitId, turnId: completed.turnId, runtimeGeneration: 4,
          outcome: 'completed', code: 'TURN_COMPLETED' },
        { kind: 'first-paint-ack-accepted', scenario: 'completed', verifierNonce,
          correlationId: completed.correlationId, clientSubmitId: completed.clientSubmitId,
          turnId: completed.turnId, sequence: 1, runtimeGeneration: 4,
          senderWebContentsId: 7, senderFrameUrl: 'file:///athena/app/shell.html', registryAccepted: true,
          doubleRafDepth: 2, contractRevision: FIRST_PAINT_CONTRACT_REVISION,
          sourceHash: sha256(FIRST_PAINT_PATH) },
        { kind: 'turn-terminal', scenario: 'interrupted', verifierNonce, correlationId: interrupted.correlationId,
          clientSubmitId: interrupted.clientSubmitId, turnId: interrupted.turnId, runtimeGeneration: 4,
          outcome: 'interrupted', code: 'PROVIDER_INTERRUPTED' },
        { kind: 'turn-terminal', scenario: 'failed', verifierNonce, correlationId: failed.correlationId,
          clientSubmitId: failed.clientSubmitId, turnId: failed.turnId, runtimeGeneration: 4,
          outcome: 'failed', code: failed.expectedCode },
        { kind: 'runtime-rotation', scenario: 'rotation', verifierNonce, correlationId: 'rotate-1',
          previousGeneration: 4, nextGeneration: 5,
          oldRuntime: { adapterStop: 'completed', adapterDrain: 'completed', processFence: 'terminal' },
          newRuntime: { generation: 5, ready: true } },
        { kind: 'runtime-shutdown', scenario: 'shutdown', verifierNonce, correlationId: 'shutdown-1',
          runtimeGeneration: 5, adapterStop: 'completed', adapterDrain: 'completed', processFence: 'terminal' },
      ],
    },
  };
}

test('Electron verifier accepts only explicit runtime scenarios', () => {
  assert.deepEqual(parseElectronVerifierArgs(['--scenario', 'all', '--output', 'evidence.json']), {
    scenario: 'all', outputPath: path.resolve('evidence.json'),
  });
  assert.throws(() => parseElectronVerifierArgs(['--scenario', 'fake']), /scenario/);
});

test('manifest validator accepts exact main-owned lifecycle and production first-paint evidence', () => {
  assert.deepEqual(validateElectronManifest(validManifest()), []);
});

test('manifest validator rejects shallow scenario booleans and arbitrary ok:false evidence', () => {
  const manifest = validManifest();
  manifest.scenarios.interrupted = { observed: true, ok: false };
  manifest.scenarios.failed = { observed: true, ok: false };
  assert.match(validateElectronManifest(manifest).join('; '), /interrupted.*identity|failed.*identity/);
});

test('manifest validator rejects activeId and before-quit false positives', () => {
  const manifest = validManifest();
  manifest.scenarios.rotation = { observed: true, activeId: 'conversation-2' };
  manifest.scenarios.shutdown = { observed: true, beforeQuit: true };
  assert.match(validateElectronManifest(manifest).join('; '), /rotation.*correlation|shutdown.*correlation/);
});

test('manifest validator rejects terminal code, correlation, and generation mismatches', () => {
  const manifest = validManifest();
  manifest.lifecycleTelemetry.events.find((event) => event.scenario === 'interrupted').code = 'SOME_ERROR';
  manifest.lifecycleTelemetry.events.find((event) => event.scenario === 'failed').correlationId = 'wrong';
  manifest.lifecycleTelemetry.events.find((event) => event.scenario === 'rotation').newRuntime.generation = 99;
  assert.match(validateElectronManifest(manifest).join('; '), /interruption code|failed.*telemetry|rotation.*generation/);
});

test('manifest validator rejects incomplete rotation and shutdown ownership fences', () => {
  const manifest = validManifest();
  manifest.lifecycleTelemetry.events.find((event) => event.scenario === 'rotation').oldRuntime.adapterDrain = 'pending';
  manifest.lifecycleTelemetry.events.find((event) => event.scenario === 'shutdown').processFence = 'pending';
  assert.match(validateElectronManifest(manifest).join('; '), /rotation.*stop.*drain.*fence|shutdown.*stop.*drain.*fence/);
});

test('manifest validator rejects synthetic ACKs and stale first-paint source claims', () => {
  const manifest = validManifest();
  manifest.lifecycleTelemetry.events = manifest.lifecycleTelemetry.events
    .filter((event) => event.kind !== 'first-paint-ack-accepted');
  assert.match(validateElectronManifest(manifest).join('; '), /main-accepted first-paint ACK/);

  const forged = validManifest();
  forged.firstPaintProduction.sourceHash = 'f'.repeat(64);
  forged.lifecycleTelemetry.events.find((event) => event.kind === 'first-paint-ack-accepted').sourceHash = 'f'.repeat(64);
  assert.match(validateElectronManifest(forged).join('; '), /production first-paint source hash/);
});

test('manifest validator binds telemetry to main source and ACK to an exact production renderer payload', () => {
  const manifest = validManifest();
  manifest.lifecycleTelemetry.sourceHash = 'f'.repeat(64);
  assert.match(validateElectronManifest(manifest).join('; '), /main telemetry source hash/);

  const forgedAck = validManifest();
  forgedAck.paintAcks[0].senderFrameUrl = 'file:///attacker.html';
  forgedAck.paintAcks[0].payload.forged = true;
  assert.match(validateElectronManifest(forgedAck).join('; '), /ACK provenance/);
});

test('manifest validator requires shutdown to finish the runtime generation created by rotation', () => {
  const manifest = validManifest();
  manifest.lifecycleTelemetry.events.find((event) => event.scenario === 'shutdown').runtimeGeneration = 99;
  assert.match(validateElectronManifest(manifest).join('; '), /shutdown runtime generation/);
});

test('manifest validator rejects missing and mismatched main telemetry nonces', () => {
  const missing = validManifest();
  delete missing.lifecycleTelemetry.verifierNonce;
  assert.match(validateElectronManifest(missing).join('; '), /main-owned lifecycle telemetry contract/);

  const mismatched = validManifest();
  mismatched.lifecycleTelemetry.events[0].verifierNonce = crypto.randomUUID();
  assert.match(validateElectronManifest(mismatched).join('; '), /completed main telemetry/);
});

test('actual scenario driver passes verifier nonce into the main-owned beginScenario contract', async () => {
  const calls = [];
  const verifierNonce = crypto.randomUUID();
  const electron = {
    BrowserWindow: {
      getAllWindows: () => [{
        isDestroyed: () => false,
        webContents: {
          getURL: () => 'file:///athena/app/shell.html',
          executeJavaScript: async (source) => source === 'document.readyState === "complete"'
            ? true : { ok: true, turnId: 'turn-complete' },
        },
      }],
    },
  };
  const scenarios = await driveActualScenarios({
    electron,
    lifecycleTelemetry: {
      beginScenario: async (value) => { calls.push(value); },
      waitForEvent: async (expected) => ({ ...expected }),
    },
    scenario: 'completed',
    prompt: 'runtime prompt',
    verifierNonce,
  });
  assert.deepEqual(calls, [{
    scenario: 'completed',
    correlationId: scenarios.completed.correlationId,
    verifierNonce,
  }]);
  await assert.rejects(driveActualScenarios({
    electron,
    lifecycleTelemetry: { beginScenario: async () => {} },
    scenario: 'completed',
    prompt: 'runtime prompt',
  }), /verifier nonce/);
});

test('actual shutdown waits for the correlated main stop/drain/fence event after app.quit', async () => {
  const verifierNonce = crypto.randomUUID();
  const order = [];
  const electron = {
    app: { quit() { order.push('quit'); } },
    BrowserWindow: {
      getAllWindows: () => [{
        isDestroyed: () => false,
        webContents: {
          getURL: () => 'file:///athena/app/shell.html',
          executeJavaScript: async () => true,
        },
      }],
    },
  };
  const scenarios = await driveActualScenarios({
    electron,
    lifecycleTelemetry: {
      beginScenario: async () => {},
      async waitForEvent(expected) {
        assert.equal(order[0], 'quit');
        order.push('shutdown-telemetry');
        return { ...expected };
      },
    },
    scenario: 'shutdown',
    verifierNonce,
  });
  assert.deepEqual(order, ['quit', 'shutdown-telemetry']);
  assert.ok(scenarios.shutdown.correlationId);
});

test('runtime verifier requires main-owned telemetry; a raw synthetic ACK cannot pass alone', async () => {
  const ipcMain = new EventEmitter();
  await assert.rejects(runElectronRuntimeVerifier({
    electron: { ipcMain }, scenario: 'completed', configFingerprint: 'c'.repeat(64),
    async startApplication() {},
    async driveScenarios() {
      ipcMain.emit('athena:provider-paint-ack', {
        sender: { id: 7 }, senderFrame: { url: 'file:///athena/app/shell.html' },
      }, {
        clientSubmitId: 'submit-1', turnId: 'turn-1', sequence: 1,
        rendererSubmittedAt: 1, rendererReceivedAt: 2, rendererPaintedAt: 3,
      });
      return { completed: { clientSubmitId: 'submit-1', correlationId: 'submit-1', turnId: 'turn-1' } };
    },
  }), /main-owned lifecycle telemetry/);
});

test('runtime verifier records valid injected main telemetry and ACK provenance without launching Electron', async () => {
  const ipcMain = new EventEmitter();
  let verifierNonce;
  const manifest = await runElectronRuntimeVerifier({
    electron: { ipcMain }, scenario: 'completed', configFingerprint: 'c'.repeat(64),
    async startApplication(context) {
      verifierNonce = context.verifierNonce;
      return {
        readLifecycleTelemetry: async () => ({
          contractRevision: LIFECYCLE_TELEMETRY_REVISION,
          owner: 'main',
          sourceHash: sha256(MAIN_PATH),
          verifierNonce,
          events: [
            { kind: 'turn-terminal', scenario: 'completed', verifierNonce, correlationId: 'submit-1',
              clientSubmitId: 'submit-1', turnId: 'turn-1', runtimeGeneration: 3,
              outcome: 'completed', code: 'TURN_COMPLETED' },
            { kind: 'first-paint-ack-accepted', scenario: 'completed', verifierNonce,
              correlationId: 'submit-1', clientSubmitId: 'submit-1', turnId: 'turn-1', sequence: 1,
              runtimeGeneration: 3, senderWebContentsId: 7,
              senderFrameUrl: 'file:///athena/app/shell.html', registryAccepted: true,
              doubleRafDepth: 2, contractRevision: FIRST_PAINT_CONTRACT_REVISION,
              sourceHash: sha256(FIRST_PAINT_PATH) },
          ],
        }),
      };
    },
    async driveScenarios() {
      ipcMain.emit('athena:provider-paint-ack', {
        sender: { id: 7 }, senderFrame: { url: 'file:///athena/app/shell.html' },
      }, {
        clientSubmitId: 'submit-1', turnId: 'turn-1', sequence: 1,
        rendererSubmittedAt: 1, rendererReceivedAt: 2, rendererPaintedAt: 3,
      });
      return { completed: { clientSubmitId: 'submit-1', correlationId: 'submit-1', turnId: 'turn-1' } };
    },
  });
  assert.equal(manifest.paintAcks[0].senderWebContentsId, 7);
  assert.equal(manifest.firstPaintProduction.sourceHash, sha256(FIRST_PAINT_PATH));
  assert.deepEqual(validateElectronManifest(manifest), []);
});

test('runtime verifier polls until delayed completed terminal and first-paint ACK telemetry are final', async () => {
  const ipcMain = new EventEmitter();
  let verifierNonce;
  let snapshots = 0;
  const terminal = () => ({
    kind: 'turn-terminal', scenario: 'completed', verifierNonce, correlationId: 'submit-late',
    clientSubmitId: 'submit-late', turnId: 'turn-late', runtimeGeneration: 8,
    outcome: 'completed', code: 'TURN_COMPLETED',
  });
  const accepted = () => ({
    kind: 'first-paint-ack-accepted', scenario: 'completed', verifierNonce,
    correlationId: 'submit-late', clientSubmitId: 'submit-late', turnId: 'turn-late', sequence: 1,
    runtimeGeneration: 8, senderWebContentsId: 7, senderFrameUrl: 'file:///athena/app/shell.html',
    registryAccepted: true, doubleRafDepth: 2, contractRevision: FIRST_PAINT_CONTRACT_REVISION,
    sourceHash: sha256(FIRST_PAINT_PATH),
  });
  const manifest = await runElectronRuntimeVerifier({
    electron: { ipcMain }, scenario: 'completed', configFingerprint: 'c'.repeat(64),
    telemetryTimeoutMs: 100, telemetryPollIntervalMs: 1,
    async startApplication(context) {
      verifierNonce = context.verifierNonce;
      return {
        async readLifecycleTelemetry() {
          snapshots += 1;
          return {
            contractRevision: LIFECYCLE_TELEMETRY_REVISION,
            owner: 'main', sourceHash: sha256(MAIN_PATH), verifierNonce,
            events: snapshots < 3 ? [] : [terminal(), accepted()],
          };
        },
      };
    },
    async driveScenarios() {
      ipcMain.emit('athena:provider-paint-ack', {
        sender: { id: 7 }, senderFrame: { url: 'file:///athena/app/shell.html' },
      }, {
        clientSubmitId: 'submit-late', turnId: 'turn-late', sequence: 1,
        rendererSubmittedAt: 1, rendererReceivedAt: 2, rendererPaintedAt: 3,
      });
      return { completed: { clientSubmitId: 'submit-late', correlationId: 'submit-late', turnId: 'turn-late' } };
    },
  });
  assert.ok(snapshots >= 3);
  assert.deepEqual(validateElectronManifest(manifest), []);
});

test('runtime verifier fails closed when required telemetry never reaches the bounded final snapshot', async () => {
  const ipcMain = new EventEmitter();
  let verifierNonce;
  await assert.rejects(runElectronRuntimeVerifier({
    electron: { ipcMain }, scenario: 'completed', configFingerprint: 'c'.repeat(64),
    telemetryTimeoutMs: 5, telemetryPollIntervalMs: 1,
    async startApplication(context) {
      verifierNonce = context.verifierNonce;
      return {
        readLifecycleTelemetry: async () => ({
          contractRevision: LIFECYCLE_TELEMETRY_REVISION,
          owner: 'main', sourceHash: sha256(MAIN_PATH), verifierNonce, events: [],
        }),
      };
    },
    async driveScenarios() {
      return { completed: { clientSubmitId: 'submit-missing', correlationId: 'submit-missing', turnId: 'turn-missing' } };
    },
  }), /timed out waiting for final lifecycle telemetry snapshot/);
});
