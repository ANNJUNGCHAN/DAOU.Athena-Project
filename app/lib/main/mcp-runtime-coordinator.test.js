'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createMcpRuntimeCoordinator } = require('./mcp-runtime-coordinator');

function harness(overrides = {}) {
  const calls = [];
  const capability = {
    stamp: { securityGeneration: 1, epochRevision: 17 },
    disposeCalls: 0,
    buildCapabilityEnv() { return { SECRET: 'not-serialized' }; },
    dispose() { this.disposeCalls += 1; },
  };
  const runtime = {
    async blockNewTurns(value) { calls.push(['block', value.securityGeneration]); },
    async interruptAndDrain(value) { calls.push(['drain', value.securityGeneration]); },
    async fenceAndStop(value) { calls.push(['fence', value.securityGeneration]); return { ok: true }; },
    async startGeneration(value) { calls.push(['start', value.securityGeneration]); return { ok: true, adapter: {} }; },
    async publishGeneration(value) { calls.push(['publish', value.securityGeneration]); },
    async unblockTurns(value) { calls.push(['unblock', value.securityGeneration]); },
    ...(overrides.runtime || {}),
  };
  const epochStore = {
    invalidate(generation) { calls.push(['invalidate', generation]); },
    publishGeneration(generation) { calls.push(['mint', generation]); return capability; },
    ...(overrides.epochStore || {}),
  };
  const coordinator = createMcpRuntimeCoordinator({
    runtime,
    epochStore,
    migratePlaintextEnv: async () => { calls.push(['migrate']); return { migrated: [], skipped: [] }; },
    readSnapshot: async ({ securityGeneration } = {}) => {
      calls.push(['snapshot', securityGeneration]);
      return { securityGeneration, gatewayEpochRevision: 17 };
    },
    enabledProviders: () => ['claude'],
    ...(overrides.options || {}),
  });
  return { calls, capability, coordinator, runtime };
}

test('persistent mutation follows invalidate, fence, persist, migrate, mint, ready, publish order', async () => {
  const h = harness();
  const result = await h.coordinator.mutate({
    kind: 'disallow',
    apply: async () => { h.calls.push(['apply']); },
  });

  assert.deepEqual(result, {
    ok: true,
    persisted: true,
    fenced: true,
    runtimeApplied: true,
    securityGeneration: 1,
    error: null,
  });
  assert.deepEqual(h.calls.map(([name]) => name), [
    'block', 'invalidate', 'drain', 'fence', 'apply', 'migrate',
    'mint', 'snapshot', 'start', 'publish', 'unblock',
  ]);
});

test('coordinator hands the one minted capability unchanged to snapshot, start, and publish', async () => {
  let snapshotCapability;
  let startedCapability;
  let publishedCapability;
  const h = harness({
    runtime: {
      async startGeneration(value) {
        startedCapability = value.capabilityContext;
        return { ok: true };
      },
      async publishGeneration(value) { publishedCapability = value.capabilityContext; },
    },
    options: {
      readSnapshot: async ({ capabilityContext }) => {
        snapshotCapability = capabilityContext;
        return { gatewayEpochRevision: capabilityContext.stamp.epochRevision };
      },
    },
  });
  const result = await h.coordinator.mutate({ kind: 'allow', apply: async () => {} });
  assert.equal(result.ok, true);
  assert.strictEqual(snapshotCapability, h.capability);
  assert.strictEqual(startedCapability, h.capability);
  assert.strictEqual(publishedCapability, h.capability);
});

test('concurrent mutations are serialized and receive distinct generations', async () => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const h = harness();
  const first = h.coordinator.mutate({ kind: 'allow', apply: async () => {
    h.calls.push(['apply-first']);
    await firstGate;
  } });
  const second = h.coordinator.mutate({ kind: 'remove', apply: async () => {
    h.calls.push(['apply-second']);
  } });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.calls.some(([name]) => name === 'apply-second'), false);
  releaseFirst();
  const [a, b] = await Promise.all([first, second]);

  assert.equal(a.securityGeneration, 1);
  assert.equal(b.securityGeneration, 2);
  assert.ok(h.calls.findIndex(([name]) => name === 'unblock')
    < h.calls.findIndex(([name]) => name === 'apply-second'));
});

test('failed process fence prevents disk mutation and new generation publication', async () => {
  let applied = 0;
  const h = harness({ runtime: {
    async fenceAndStop(value) { h.calls.push(['fence', value.securityGeneration]); return { ok: false }; },
  } });
  const result = await h.coordinator.mutate({ kind: 'revoke', apply: async () => { applied += 1; } });

  assert.equal(result.ok, false);
  assert.equal(result.persisted, false);
  assert.equal(result.fenced, true);
  assert.equal(applied, 0);
  assert.equal(h.calls.some(([name]) => name === 'mint'), false);
  assert.equal(h.calls.some(([name]) => name === 'unblock'), false);
});

test('new generation start failure reports persisted-but-not-applied and stays blocked', async () => {
  const h = harness({ runtime: {
    async startGeneration(value) { h.calls.push(['start', value.securityGeneration]); return { ok: false, error: 'not ready' }; },
  } });
  const result = await h.coordinator.mutate({ kind: 'secret-update', apply: async () => {} });

  assert.equal(result.ok, false);
  assert.equal(result.persisted, true);
  assert.equal(result.fenced, true);
  assert.equal(result.runtimeApplied, false);
  assert.equal(h.capability.disposeCalls, 1);
  assert.equal(h.calls.filter(([name]) => name === 'invalidate').length, 2);
  assert.equal(h.calls.filter(([name]) => name === 'fence').length, 2);
  assert.equal(h.calls.some(([name]) => name === 'publish'), false);
  assert.equal(h.calls.some(([name]) => name === 'unblock'), false);
});

test('snapshot epoch mismatch invalidates the issued token and never starts a child', async () => {
  const h = harness({ options: {
    readSnapshot: async () => ({ gatewayEpochRevision: 999 }),
  } });
  const result = await h.coordinator.mutate({ kind: 'approve', apply: async () => {} });
  assert.equal(result.ok, false);
  assert.equal(result.persisted, true);
  assert.equal(h.capability.disposeCalls, 1);
  assert.equal(h.calls.some(([name]) => name === 'start'), false);
  assert.equal(h.calls.filter(([name]) => name === 'invalidate').length, 2);
});

test('publish failure invalidates token, fences the started child, and stays blocked', async () => {
  const h = harness({ runtime: {
    async publishGeneration() { throw new Error('publish failed'); },
  } });
  const result = await h.coordinator.mutate({ kind: 'approve', apply: async () => {} });
  assert.equal(result.ok, false);
  assert.equal(result.runtimeApplied, false);
  assert.equal(h.capability.disposeCalls, 1);
  assert.equal(h.calls.filter(([name]) => name === 'invalidate').length, 2);
  assert.equal(h.calls.filter(([name]) => name === 'fence').length, 2);
  assert.equal(h.calls.some(([name]) => name === 'unblock'), false);
});

test('cold mode terminates only legacy child and never touches epoch or supervisor', async () => {
  const calls = [];
  const coordinator = createMcpRuntimeCoordinator({
    mode: 'cold',
    coldRuntime: { async interruptAndTerminate() { calls.push('terminate'); return { ok: true }; } },
    migratePlaintextEnv: async () => { calls.push('migrate'); return { migrated: [], skipped: [] }; },
    readSnapshot: async () => { calls.push('snapshot'); return {}; },
  });
  const result = await coordinator.mutate({ kind: 'register', apply: async () => { calls.push('apply'); } });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['terminate', 'apply', 'migrate', 'snapshot']);
});

test('capability token cannot appear in coordinator snapshots or results', async () => {
  const h = harness();
  const result = await h.coordinator.mutate({ kind: 'approve', apply: async () => {} });
  const serialized = JSON.stringify({ result, snapshot: h.coordinator.snapshot() });
  assert.equal(serialized.includes('not-serialized'), false);
});

test('skipped plaintext migration fails closed before capability mint or runtime start', async () => {
  const h = harness({ options: {
    migratePlaintextEnv: async () => ({
      migrated: [],
      skipped: [{ alias: 'dart', key: 'TOKEN', reason: 'safe storage unavailable' }],
    }),
  } });

  const result = await h.coordinator.mutate({ kind: 'approve', apply: async () => {} });

  assert.equal(result.ok, false);
  assert.equal(result.persisted, true);
  assert.equal(result.runtimeApplied, false);
  assert.equal(h.calls.some(([name]) => name === 'mint'), false);
  assert.equal(h.calls.some(([name]) => name === 'start'), false);
  assert.equal(h.calls.some(([name]) => name === 'publish'), false);
  assert.equal(h.calls.some(([name]) => name === 'unblock'), false);
});

test('cold mutation does not report success when plaintext migration was skipped', async () => {
  const coordinator = createMcpRuntimeCoordinator({
    mode: 'cold',
    migratePlaintextEnv: async () => ({ migrated: [], skipped: [{ alias: 'dart', key: 'TOKEN' }] }),
    readSnapshot: async () => ({}),
  });

  const result = await coordinator.mutate({ kind: 'register', apply: async () => {} });

  assert.equal(result.ok, false);
  assert.equal(result.persisted, true);
  assert.equal(result.runtimeApplied, false);
});

// 플러그인 승인 묶음 — kind 검사는 mutate() 진입 첫 줄이라 mode와 무관하다.
// 이 kind가 없으면 첫 승인이 TypeError로 죽는다.
test('plugin-batch is an accepted mutation kind', async () => {
  const h = harness();
  const result = await h.coordinator.mutate({
    kind: 'plugin-batch',
    apply: async () => { h.calls.push(['apply']); },
  });

  assert.equal(result.ok, true);
  assert.equal(h.calls.some(([name]) => name === 'apply'), true);
});

test('unknown mutation kind is still rejected', async () => {
  const h = harness();
  await assert.rejects(
    h.coordinator.mutate({ kind: 'plugin', apply: async () => {} }),
    TypeError,
  );
});
