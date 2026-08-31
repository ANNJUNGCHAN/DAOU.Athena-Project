'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createProviderVerifierTelemetry } = require('./provider-verifier-telemetry');
const {
  FIRST_PAINT_CONTRACT_REVISION,
  LIFECYCLE_TELEMETRY_REVISION,
  validateElectronManifest,
} = require('../../scripts/verify-provider-sessions-electron');

const APP_DIR = path.resolve(__dirname, '..', '..');
const MAIN_PATH = path.join(APP_DIR, 'main.js');
const FIRST_PAINT_PATH = path.join(APP_DIR, 'provider-first-paint.js');
const VERIFIER_PATH = path.join(APP_DIR, 'scripts', 'verify-provider-sessions-electron.js');
const hash = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

test('main telemetry produces v2-valid completed, interrupted, failed, rotation, and shutdown evidence', async () => {
  const verifierNonce = crypto.randomUUID();
  const telemetry = createProviderVerifierTelemetry({
    mainSourceHash: hash(MAIN_PATH),
    firstPaintSourceHash: hash(FIRST_PAINT_PATH),
  });
  const identities = {
    completed: 'submit-completed',
    interrupted: 'submit-interrupted',
    failed: 'submit-failed',
    rotation: 'rotate-1',
    shutdown: 'shutdown-1',
  };
  for (const [scenario, correlationId] of Object.entries(identities)) {
    await telemetry.beginScenario({ scenario, correlationId, verifierNonce });
  }
  telemetry.recordTerminal({
    type: 'turn_completed', clientSubmitId: identities.completed, turnId: 'turn-completed',
    runtimeGeneration: 4, payload: {},
  });
  telemetry.recordPaintAck({
    senderWebContentsId: 7,
    senderFrameUrl: 'file:///athena/app/shell.html',
    runtimeGeneration: 4,
    ackResult: { accepted: true },
    payload: { clientSubmitId: identities.completed, turnId: 'turn-completed', sequence: 1 },
  });
  telemetry.recordTerminal({
    type: 'turn_interrupted', clientSubmitId: identities.interrupted, turnId: 'turn-interrupted',
    runtimeGeneration: 4, payload: { reason: 'user' },
  });
  telemetry.recordTerminal({
    type: 'turn_failed', clientSubmitId: identities.failed, turnId: 'turn-failed',
    runtimeGeneration: 4, payload: { code: 'PROVIDER_TEST_FAILURE' },
  });
  telemetry.authorizeRotation(identities.rotation);
  telemetry.recordRotationCompletion({
    correlationId: identities.rotation,
    previousSnapshot: { runtimeGeneration: 4, ready: true, lifecycleClosed: false },
    nextSnapshot: { runtimeGeneration: 5, ready: true, lifecycleClosed: false },
  });
  telemetry.recordShutdownCompletion({
    runtimeGeneration: 5,
    stoppedSnapshot: { runtimeGeneration: 5, ready: false, lifecycleClosed: true, state: 'stopped' },
  });
  const lifecycleTelemetry = await telemetry.snapshot({ verifierNonce });
  const generatedAt = new Date();
  const manifest = {
    schemaVersion: 2,
    scenario: 'all',
    provider: 'claude',
    sourceClass: 'electron-runtime',
    sourceRevision: 'a'.repeat(40),
    scriptHash: hash(VERIFIER_PATH),
    configFingerprint: 'b'.repeat(64),
    generatedAt: generatedAt.toISOString(),
    freshness: { status: 'fresh', expiresAt: new Date(generatedAt.getTime() + 60_000).toISOString() },
    verifierNonce,
    firstPaintProduction: {
      contractRevision: FIRST_PAINT_CONTRACT_REVISION,
      sourceHash: hash(FIRST_PAINT_PATH),
    },
    scenarios: {
      completed: { clientSubmitId: identities.completed, correlationId: identities.completed, turnId: 'turn-completed' },
      interrupted: { clientSubmitId: identities.interrupted, correlationId: identities.interrupted, turnId: 'turn-interrupted' },
      failed: { clientSubmitId: identities.failed, correlationId: identities.failed, turnId: 'turn-failed', expectedCode: 'PROVIDER_TEST_FAILURE' },
      rotation: { correlationId: identities.rotation },
      shutdown: { correlationId: identities.shutdown },
    },
    paintAcks: [{
      senderWebContentsId: 7,
      senderFrameUrl: 'file:///athena/app/shell.html',
      payload: {
        clientSubmitId: identities.completed, turnId: 'turn-completed', sequence: 1,
        rendererSubmittedAt: 1, rendererReceivedAt: 2, rendererPaintedAt: 3,
      },
    }],
    lifecycleTelemetry,
  };
  assert.equal(lifecycleTelemetry.contractRevision, LIFECYCLE_TELEMETRY_REVISION);
  assert.deepEqual(validateElectronManifest(manifest), []);
});

test('telemetry rejects wrong nonce, correlation, duplicate, shallow fence, and missing completion', async () => {
  const telemetry = createProviderVerifierTelemetry({
    mainSourceHash: 'a'.repeat(64),
    firstPaintSourceHash: 'b'.repeat(64),
    snapshotWaitMs: 5,
  });
  const verifierNonce = crypto.randomUUID();
  await telemetry.beginScenario({ scenario: 'rotation', correlationId: 'rotation-1', verifierNonce });
  await assert.rejects(
    telemetry.beginScenario({ scenario: 'rotation', correlationId: 'rotation-1', verifierNonce }),
    /duplicate/i,
  );
  assert.throws(() => telemetry.authorizeRotation('wrong'), /correlation/i);
  assert.throws(() => telemetry.recordRotationCompletion({
    correlationId: 'rotation-1',
    previousSnapshot: { runtimeGeneration: 1, ready: true },
    nextSnapshot: { runtimeGeneration: 2, ready: true },
  }), /authorized/i);
  telemetry.authorizeRotation('rotation-1');
  assert.equal(telemetry.recordRotationCompletion({
    previousSnapshot: { runtimeGeneration: 1, ready: true, lifecycleClosed: false },
    nextSnapshot: { runtimeGeneration: 2, ready: true, lifecycleClosed: false },
  }), false);
  assert.throws(() => telemetry.recordRotationCompletion({
    correlationId: 'rotation-1',
    previousSnapshot: { runtimeGeneration: 1, ready: true, lifecycleClosed: false },
    nextSnapshot: { runtimeGeneration: 2, ready: false, lifecycleClosed: false },
  }), /shallow|incomplete/i);
  await assert.rejects(telemetry.snapshot({ verifierNonce: crypto.randomUUID() }), /nonce/i);
  await assert.rejects(telemetry.snapshot({ verifierNonce }), /completion/i);
});

test('unrelated queued rotation cannot consume exact verifier rotation evidence', async () => {
  const telemetry = createProviderVerifierTelemetry({
    mainSourceHash: 'a'.repeat(64), firstPaintSourceHash: 'b'.repeat(64),
  });
  const verifierNonce = crypto.randomUUID();
  await telemetry.beginScenario({
    scenario: 'rotation', correlationId: 'rotation-exact', verifierNonce,
  });
  telemetry.authorizeRotation('rotation-exact');
  assert.equal(telemetry.recordRotationCompletion({
    correlationId: 'unrelated',
    previousSnapshot: { runtimeGeneration: 3, ready: true, lifecycleClosed: false },
    nextSnapshot: { runtimeGeneration: 4, ready: true, lifecycleClosed: false },
  }), false);
  assert.equal(telemetry.recordRotationCompletion({
    correlationId: 'rotation-exact',
    previousSnapshot: { runtimeGeneration: 4, ready: true, lifecycleClosed: false },
    nextSnapshot: { runtimeGeneration: 5, ready: true, lifecycleClosed: false },
  }), true);
  const snapshot = await telemetry.snapshot({ verifierNonce });
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0].correlationId, 'rotation-exact');
  assert.equal(snapshot.events[0].previousGeneration, 4);
});

test('telemetry is explicit-scenario-only and bounded', async () => {
  const telemetry = createProviderVerifierTelemetry({
    mainSourceHash: 'a'.repeat(64), firstPaintSourceHash: 'b'.repeat(64), maxEvents: 2,
  });
  const verifierNonce = crypto.randomUUID();
  await assert.rejects(
    telemetry.beginScenario({ scenario: 'synthetic', correlationId: 'x', verifierNonce }),
    /scenario/i,
  );
  await telemetry.beginScenario({ scenario: 'failed', correlationId: 'one', verifierNonce });
  assert.equal(telemetry.recordTerminal({
    type: 'turn_failed', clientSubmitId: 'unrelated', turnId: 'turn-x',
    runtimeGeneration: 1, payload: { code: 'X' },
  }), false);
  telemetry.recordTerminal({
    type: 'turn_failed', clientSubmitId: 'one', turnId: 'turn-1',
    runtimeGeneration: 1, payload: { code: 'X' },
  });
  assert.throws(() => telemetry.recordTerminal({
    type: 'turn_failed', clientSubmitId: 'one', turnId: 'turn-1',
    runtimeGeneration: 1, payload: { code: 'X' },
  }), /duplicate/i);
});
