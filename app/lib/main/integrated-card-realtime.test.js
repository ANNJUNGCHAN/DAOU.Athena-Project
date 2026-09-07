'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OPERATION_POLICIES,
  CardLeaseManager: CardLeaseManagerWithAccount,
  createBoundedShutdownCoordinator,
  createRegistrarTransport,
  createSemanticBindingSourceProvider,
  createValidatedFetch,
  normalizeFrameRows,
  publicPolicies,
  resolveLeaseBindings: resolveLeaseBindingsWithAccount,
  semanticUpdatesFor,
} = require('./integrated-card-realtime');

function resolveLeaseBindings(config) {
  return resolveLeaseBindingsWithAccount({ backendAccountAlias: 'server-a', ...config });
}

class CardLeaseManager extends CardLeaseManagerWithAccount {
  mount(config) { return super.mount({ backendAccountAlias: 'server-a', ...config }); }
  update(config) { return super.update({ backendAccountAlias: 'server-a', ...config }); }
}

function fakeTransport(overrides = {}) {
  const calls = [];
  return {
    calls,
    acquire: async (binding) => { calls.push(['REG', binding.operationId, binding.target]); return true; },
    release: async (binding) => { calls.push(['REMOVE', binding.operationId, binding.target]); return true; },
    reconnect: async (bindings) => {
      calls.push(['RECONNECT', ...bindings.map((b) => `${b.operationId}:${b.target}`)]);
      return bindings.map((binding) => ({ binding, ok: true, error: null }));
    },
    command: async () => ({ ok: true }),
    ...overrides,
  };
}

function account(leaseId, target = 'ACC-1') {
  return { leaseId, cardId: 'CC-01', mode: 'overview', accountId: target };
}

test('shutdown releases realtime before backend stop and quits exactly once', async () => {
  const calls = [];
  let finishRelease;
  const release = new Promise((resolve) => { finishRelease = resolve; });
  const coordinator = createBoundedShutdownCoordinator({
    prepare: () => calls.push('prepare'),
    releaseAll: () => { calls.push('releaseAll'); return release; },
    shutdownBackend: () => calls.push('shutdownBackend'),
    quit: () => calls.push('quit'),
    timeoutMs: 1000,
  });
  const firstEvent = { preventDefault: () => calls.push('preventDefault:first') };
  const secondEvent = { preventDefault: () => calls.push('preventDefault:second') };

  const first = coordinator.begin(firstEvent);
  const second = coordinator.begin(secondEvent);
  assert.equal(first, second);
  assert.deepEqual(calls, [
    'preventDefault:first', 'prepare', 'releaseAll', 'preventDefault:second',
  ]);
  assert.equal(calls.includes('shutdownBackend'), false);

  finishRelease({ ok: true, pending: 0 });
  await first;
  assert.deepEqual(calls, [
    'preventDefault:first', 'prepare', 'releaseAll', 'preventDefault:second',
    'shutdownBackend', 'quit',
  ]);
  assert.deepEqual(coordinator.status(), { started: true, complete: true });

  await coordinator.begin({ preventDefault: () => calls.push('preventDefault:final') });
  assert.equal(calls.filter((entry) => entry === 'releaseAll').length, 1);
  assert.equal(calls.filter((entry) => entry === 'shutdownBackend').length, 1);
  assert.equal(calls.filter((entry) => entry === 'quit').length, 1);
  assert.equal(calls.includes('preventDefault:final'), false);
});

test('23/23 WebSocket operation policy is complete, case-sensitive, and unique', () => {
  const expected = [
    '00', '04', '0A', '0B', '0C', '0D', '0E', '0F', '0G', '0H', '0I', '0J', '0U',
    '0g', '0m', '0s', '0u', '0w', '1h', 'ka10171', 'ka10172', 'ka10173', 'ka10174',
  ];
  assert.deepEqual(OPERATION_POLICIES.map((p) => p.operationId).sort(), expected.sort());
  assert.equal(new Set(OPERATION_POLICIES.map((p) => p.operationId)).size, 23);
  assert.ok(OPERATION_POLICIES.some((p) => p.operationId === '0G'));
  assert.ok(OPERATION_POLICIES.some((p) => p.operationId === '0g'));
  assert.equal(publicPolicies().length, 23);
});

test('canonical policies cover CC-04 orderbook, CC-01 balance 04, and CC-06 VI 1h', () => {
  assert.deepEqual(
    resolveLeaseBindings({ leaseId: 'b', cardId: 'CC-04', mode: 'regular', symbol: '005930' })
      .map((b) => b.operationId),
    ['0C', '0D'],
  );
  assert.ok(resolveLeaseBindings(account('a')).some((b) => b.operationId === '04'));
  assert.deepEqual(
    resolveLeaseBindings({ leaseId: 'v', cardId: 'CC-06', mode: 'vi' }).map((b) => b.operationId),
    ['1h'],
  );
});

test('verified operation_refs override generic mode and allow CC-02 account feeds', () => {
  assert.deepEqual(
    resolveLeaseBindings({
      leaseId: 'order', cardId: 'CC-02', mode: 'cash', accountId: 'ACC-1',
      verifiedOperationRefs: ['base:00', 'base:04'],
    }).map((binding) => binding.operationId),
    ['00', '04'],
  );
  assert.deepEqual(
    resolveLeaseBindings({
      leaseId: 'after', cardId: 'CC-04', mode: 'generic', symbol: '005930',
      verifiedOperationRefs: ['base:0E'],
    }).map((binding) => binding.operationId),
    ['0E'],
  );
});

test('non-WebSocket verified REST refs do not suppress canonical CC-03 chart realtime', () => {
  assert.deepEqual(
    resolveLeaseBindings({
      leaseId: 'chart', cardId: 'CC-03', mode: 'chart', symbol: '005930',
      verifiedOperationRefs: ['base:ka10060'],
    }).map((binding) => binding.operationId),
    ['0B'],
  );
});

test('frame identities normalize account 9201, security 9001/item, broadcasts, and condition seq/841', () => {
  assert.deepEqual(normalizeFrameRows({ trnm: 'REAL', data: [
    { type: '04', item: '', values: { 9201: 'ACC-1' } },
    { type: '0B', item: 'A005930', values: {} },
    { type: '0g', item: '', values: { 9001: 'Q000660' } },
    { type: '1h', item: 'irrelevant', values: {} },
  ] }).map(({ operationId, target }) => [operationId, target]), [
    ['04', 'ACC-1'], ['0B', '005930'], ['0g', '000660'], ['1h', 'irrelevant'],
  ]);
  assert.deepEqual(
    normalizeFrameRows({ trnm: 'REAL', seq: '7', values: { 841: '7', 9001: 'A005930' } })
      .map(({ operationId, target }) => [operationId, target]),
    [['ka10173', '7']],
  );
});

test('trusted binding provider accepts only the exact descriptor contract and caches per operation', async () => {
  const bindingId = 'rtb_aaaaaaaaaaaaaaaaaaaa';
  const calls = [];
  const provider = createSemanticBindingSourceProvider({
    backendBase: 'http://127.0.0.1:8010',
    token: 'local-secret',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({
          binding_version: 'semantic-realtime.v1',
          operation_id: '0D',
          source_bindings: { 10: { binding_id: bindingId, display_slot: 1 } },
        }),
      };
    },
  });

  const first = await provider('0D');
  const second = await provider('0D');
  assert.deepEqual([...first], [['10', bindingId]]);
  assert.equal(second, first);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:8010/api/v1/internal/canvas/realtime-bindings/0D');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer local-secret');

  const wrongShape = createSemanticBindingSourceProvider({
    backendBase: 'http://127.0.0.1:8010', token: 'local-secret',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        binding_version: 'semantic-realtime.v1', operation_id: '0D',
        source_bindings: { 10: bindingId },
      }),
    }),
  });
  await assert.rejects(wrongShape('0D'), /invalid semantic realtime binding entry/);
});

test('raw normalized frame becomes an opaque renderer event without wire fields', async () => {
  const bindingId = 'rtb_bbbbbbbbbbbbbbbbbbbb';
  let providerCalls = 0;
  const manager = new CardLeaseManager({
    transport: fakeTransport(),
    semanticBindingSourceProvider: async (operationId) => {
      providerCalls += 1;
      assert.ok(['0C', '0D'].includes(operationId));
      return operationId === '0D' ? new Map([['10', bindingId], ['15', 'rtb_cccccccccccccccccccc']]) : new Map();
    },
  });
  const mounted = await manager.mount({
    leaseId: 'book', cardId: 'CC-04', mode: 'regular', symbol: '005930',
    semanticBindingIds: [bindingId],
  });
  assert.equal(mounted.ok, true);
  const events = manager.routeFrame({
    trnm: 'REAL', data: [{ type: '0D', item: '005930', values: { 10: '73500', 15: '1200' } }],
  });
  assert.equal(providerCalls, 2);
  assert.deepEqual(events, [{
    leaseId: 'book', cardId: 'CC-04', mode: 'regular',
    generation: 1, connectionGeneration: 1,
    semantic_updates: [{ binding_id: bindingId, value: '73500' }],
  }]);
  const serialized = JSON.stringify(events);
  for (const forbidden of ['"row"', '"values"', '"operationId"', '"operation_ref"', '"10"', '"15"']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  manager.routeFrame({
    trnm: 'REAL', data: [{ type: '0D', item: '005930', values: { 10: '73600' } }],
  });
  assert.equal(providerCalls, 2, 'tick path must not refetch source bindings');
  assert.deepEqual(semanticUpdatesFor({ values: { 10: '1' } }, new Map([['10', bindingId]])), [
    { binding_id: bindingId, value: '1' },
  ]);
});

test('all 23 operation fixtures have an explicit frame or control normalization disposition', () => {
  const commandIds = new Set(['ka10171', 'ka10172', 'ka10174']);
  const normalized = new Set();
  for (const operation of OPERATION_POLICIES) {
    if (commandIds.has(operation.operationId)) {
      assert.notEqual(operation.behavior, 'lease');
      continue;
    }
    let frame;
    if (operation.operationId === '00' || operation.operationId === '04') {
      frame = { trnm: 'REAL', data: [{ type: operation.operationId, values: { 9201: 'ACC-1' } }] };
    } else if (operation.operationId === 'ka10173') {
      frame = { trnm: 'REAL', seq: '7', values: { 841: '7' } };
    } else if (['0s', '1h'].includes(operation.operationId)) {
      frame = { trnm: 'REAL', data: [{ type: operation.operationId, item: '' }] };
    } else {
      frame = { trnm: 'REAL', data: [{ type: operation.operationId, values: { 9001: 'A005930' } }] };
    }
    const rows = normalizeFrameRows(frame);
    assert.equal(rows.length, 1, operation.operationId);
    assert.equal(rows[0].operationId, operation.operationId);
    normalized.add(operation.operationId);
  }
  assert.equal(normalized.size + commandIds.size, 23);
});

test('visibleTargets is bounded and all target kinds fail closed on invalid identity', () => {
  assert.throws(() => resolveLeaseBindings({
    cardId: 'CC-06', mode: 'watchlist', visibleTargets: Array.from({ length: 51 }, (_, i) => String(i).padStart(6, '0')),
  }), /exceeds 50/);
  assert.throws(() => resolveLeaseBindings({ cardId: 'CC-04', mode: 'regular', symbol: '../bad' }), /invalid symbol/);
});

test('shared visible-row feeds resolve once per unique visible target', () => {
  const bindings = resolveLeaseBindings({
    leaseId: 'watch', cardId: 'CC-06', mode: 'watchlist', visibleTargets: ['005930', '005930', '000660'],
  });
  assert.deepEqual(bindings.map((b) => `${b.operationId}:${b.target}`), [
    '0B:000660', '0B:005930', '0g:000660', '0g:005930',
  ]);
});

test('mount registers once; same target across cards uses manager refcount; last unmount removes', async () => {
  const transport = fakeTransport();
  const manager = new CardLeaseManager({ transport });
  await manager.mount(account('one'));
  await manager.mount(account('two'));
  assert.deepEqual(transport.calls.filter((c) => c[0] === 'REG'), [
    ['REG', '00', 'ACC-1'], ['REG', '04', 'ACC-1'],
  ]);
  await manager.unmount('one');
  assert.equal(transport.calls.some((c) => c[0] === 'REMOVE'), false);
  await manager.unmount('two');
  assert.deepEqual(transport.calls.filter((c) => c[0] === 'REMOVE'), [
    ['REMOVE', '00', 'ACC-1'], ['REMOVE', '04', 'ACC-1'],
  ]);
});

test('same lease remount is idempotent and does not increase generation', async () => {
  const transport = fakeTransport();
  const manager = new CardLeaseManager({ transport });
  const first = await manager.mount(account('one'));
  const second = await manager.mount(account('one'));
  assert.equal(first.generation, 1);
  assert.equal(second.generation, 1);
  assert.equal(transport.calls.filter((c) => c[0] === 'REG').length, 2);
});

test('mode change with the same physical feeds advances presentation generation without re-REG', async () => {
  const transport = fakeTransport();
  const manager = new CardLeaseManager({ transport });
  await manager.mount({ leaseId: 'book', cardId: 'CC-04', mode: 'regular', symbol: '005930' });
  transport.calls.length = 0;
  const changed = await manager.update({ leaseId: 'book', cardId: 'CC-04', mode: 'composite', symbol: '005930' });
  assert.equal(changed.mode, 'composite');
  assert.equal(changed.generation, 2);
  assert.deepEqual(transport.calls, []);
});

test('target switch acquires all new feeds before releasing old feeds and advances generation', async () => {
  const transport = fakeTransport();
  const manager = new CardLeaseManager({ transport });
  await manager.mount(account('one', 'OLD'));
  transport.calls.length = 0;
  const result = await manager.update(account('one', 'NEW'));
  assert.equal(result.generation, 2);
  assert.deepEqual(transport.calls, [
    ['REG', '00', 'NEW'], ['REG', '04', 'NEW'],
    ['REMOVE', '00', 'OLD'], ['REMOVE', '04', 'OLD'],
  ]);
});

test('failed REG keeps the old target active and publishes an error state', async () => {
  const states = [];
  const transport = fakeTransport({
    acquire: async (binding) => {
      transport.calls.push(['REG', binding.operationId, binding.target]);
      return binding.target !== 'BAD';
    },
  });
  const manager = new CardLeaseManager({ transport, onState: (state) => states.push(state) });
  await manager.mount(account('one', 'GOOD'));
  const failed = await manager.update(account('one', 'BAD'));
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 'error');
  assert.match(failed.error, /REG failed/);
  assert.deepEqual(manager.status('one').bindings.map((b) => b.target), ['GOOD', 'GOOD']);
  assert.equal(states.at(-1).status, 'error');
  assert.equal(transport.calls.some((c) => c[0] === 'REMOVE' && c[2] === 'GOOD'), false);
});

test('disconnect then reconnect re-REGs active physical keys exactly once and advances generations', async () => {
  const transport = fakeTransport();
  const manager = new CardLeaseManager({ transport });
  await manager.mount(account('one'));
  await manager.mount(account('two'));
  await manager.handleFeedStatus({ state: 'disconnected' });
  const result = await manager.handleFeedStatus({ state: 'open' });
  assert.equal(result.ok, true);
  const reconnect = transport.calls.filter((c) => c[0] === 'RECONNECT');
  assert.equal(reconnect.length, 1);
  assert.deepEqual(reconnect[0].slice(1).sort(), ['00:ACC-1', '04:ACC-1']);
  assert.equal(manager.status('one').generation, 2);
  assert.equal(manager.status('two').generation, 2);
});

test('failed initial REG is not revived by a later reconnect', async () => {
  const transport = fakeTransport({ acquire: async () => false });
  const manager = new CardLeaseManager({ transport });
  const failed = await manager.mount(account('failed'));
  assert.equal(failed.status, 'error');
  await manager.handleFeedStatus({ state: 'disconnected' });
  await manager.handleFeedStatus({ state: 'open' }, 2);
  assert.equal(manager.status('failed').status, 'error');
  assert.equal(transport.calls.some((call) => call[0] === 'RECONNECT'), false);
});

test('per-binding reconnect retries only failed bindings and leaves affected lease in error', async () => {
  let pass = 0;
  const transport = fakeTransport({
    reconnect: async (bindings) => {
      pass += 1;
      transport.calls.push(['RECONNECT', ...bindings.map((b) => b.operationId)]);
      return bindings.map((binding) => ({
        binding,
        ok: binding.operationId === '00',
        error: binding.operationId === '00' ? null : `failed-${pass}`,
      }));
    },
  });
  const manager = new CardLeaseManager({ transport });
  await manager.mount(account('one'));
  await manager.handleFeedStatus({ state: 'disconnected' });
  const result = await manager.handleFeedStatus({ state: 'open' }, 2);
  assert.equal(result.ok, false);
  assert.equal(transport.calls.filter((call) => call[0] === 'RECONNECT').length, 2);
  assert.deepEqual(transport.calls.at(-1), ['RECONNECT', '04']);
  assert.equal(manager.status('one').status, 'error');
});

test('REMOVE failure returns remove-pending tombstone and reconnect retries cleanup', async () => {
  let removeAttempts = 0;
  const transport = fakeTransport({
    release: async (binding) => {
      removeAttempts += 1;
      transport.calls.push(['REMOVE', binding.operationId, binding.target]);
      return removeAttempts > 1;
    },
  });
  const manager = new CardLeaseManager({ transport });
  await manager.mount({ leaseId: 'vi', cardId: 'CC-06', mode: 'vi' });
  const pending = await manager.unmount('vi');
  assert.equal(pending.ok, false);
  assert.equal(pending.status, 'remove-pending');
  assert.equal(manager.status('vi').status, 'remove-pending');
  await manager.handleFeedStatus({ state: 'disconnected' });
  await manager.handleFeedStatus({ state: 'open' }, 2);
  assert.equal(manager.status('vi'), null);
  assert.equal(removeAttempts, 2);
});

test('releaseAll reports pending cleanup instead of false unmounted success', async () => {
  const transport = fakeTransport({ release: async () => false });
  const manager = new CardLeaseManager({ transport });
  await manager.mount({ leaseId: 'vi', cardId: 'CC-06', mode: 'vi' });
  const result = await manager.releaseAll();
  assert.equal(result.ok, false);
  assert.equal(result.pending, 1);
});

test('releaseAll does not wait for in-flight REG and late success is removed with its captured alias', async () => {
  let finishAcquire;
  let acquireStarted;
  const started = new Promise((resolve) => { acquireStarted = resolve; });
  const calls = [];
  const transport = fakeTransport({
    acquire: async (binding) => {
      calls.push(['REG', binding.operationId, binding.backendAccountAlias]);
      acquireStarted();
      return new Promise((resolve) => { finishAcquire = resolve; });
    },
    release: async (binding) => {
      calls.push(['REMOVE', binding.operationId, binding.backendAccountAlias]);
      return true;
    },
  });
  const manager = new CardLeaseManagerWithAccount({ transport });
  const mounting = manager.mount({
    leaseId: 'account-a', cardId: 'CC-01', mode: 'overview',
    accountId: 'renderer-account', backendAccountAlias: 'server-a',
  });
  await started;

  let drained = false;
  const draining = manager.releaseAll().then((result) => {
    drained = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, true, 'drain must settle without waiting for REG');
  assert.deepEqual(await draining, { ok: true, results: [], pending: 0 });
  let cleanupComplete = false;
  const cleanup = manager.whenDrained().then((ok) => { cleanupComplete = ok; return ok; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cleanupComplete, false);

  finishAcquire(true);
  const mounted = await mounting;
  assert.equal(mounted.ok, false);
  assert.match(mounted.error, /draining/);
  assert.equal(await cleanup, true);
  assert.deepEqual(calls, [
    ['REG', '00', 'server-a'],
    ['REMOVE', '00', 'server-a'],
  ]);
  assert.equal(manager.status('account-a'), null);
});

test('releaseAll removes a reconnect REG that succeeds after drain under its captured alias', async () => {
  let finishReconnect;
  let markReconnectStarted;
  let reconnectBindings;
  const started = new Promise((resolve) => { markReconnectStarted = resolve; });
  const calls = [];
  const transport = fakeTransport({
    acquire: async () => true,
    reconnect: async (bindings) => {
      reconnectBindings = bindings;
      calls.push(['RECONNECT', bindings[0].backendAccountAlias]);
      markReconnectStarted();
      return new Promise((resolve) => { finishReconnect = resolve; });
    },
    release: async (binding) => {
      calls.push(['REMOVE', binding.operationId, binding.backendAccountAlias]);
      return true;
    },
  });
  const manager = new CardLeaseManagerWithAccount({ transport });
  await manager.mount({
    leaseId: 'quote-a', cardId: 'CC-03', mode: 'quote', symbol: '005930',
    backendAccountAlias: 'server-a',
  });
  await manager.handleFeedStatus({ state: 'disconnected' });
  const reconnecting = manager.handleFeedStatus({ state: 'open' }, 2);
  await started;

  const drained = await manager.releaseAll();
  assert.equal(drained.ok, true);
  finishReconnect(reconnectBindings.map((binding) => ({ binding, ok: true })));
  assert.deepEqual(await reconnecting, { ok: false, status: 'draining' });
  assert.deepEqual(calls, [
    ['RECONNECT', 'server-a'],
    ['REMOVE', '0A', 'server-a'],
    ['REMOVE', '0B', 'server-a'],
    ['REMOVE', '0A', 'server-a'],
    ['REMOVE', '0B', 'server-a'],
  ]);
});

test('production transport force-removes every reconnect REG that succeeds after drain', async () => {
  const calls = [];
  const finishReconnects = [];
  let markReconnectsStarted;
  const reconnectsStarted = new Promise((resolve) => { markReconnectsStarted = resolve; });
  let registerCount = 0;
  const response = () => ({
    ok: true, status: 200, json: async () => ({ return_code: '0' }),
  });
  const transport = createRegistrarTransport({
    backendBase: 'http://backend',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ body, init });
      if (body.trnm !== 'REG') return response();
      registerCount += 1;
      if (registerCount <= 2) return response();
      const pending = new Promise((resolve) => { finishReconnects.push(() => resolve(response())); });
      if (finishReconnects.length === 2) markReconnectsStarted();
      return pending;
    },
  });
  const manager = new CardLeaseManagerWithAccount({ transport });
  await manager.mount({
    leaseId: 'quote-a', cardId: 'CC-03', mode: 'quote', symbol: '005930',
    backendAccountAlias: 'server-a',
  });
  await manager.handleFeedStatus({ state: 'disconnected' });
  const reconnecting = manager.handleFeedStatus({ state: 'open' }, 2);
  await reconnectsStarted;
  assert.equal((await manager.releaseAll()).ok, true);
  finishReconnects.forEach((finish) => finish());
  assert.deepEqual(await reconnecting, { ok: false, status: 'draining' });

  const removals = calls.filter((call) => call.body.trnm === 'REMOVE');
  assert.equal(removals.length, 4, 'drain REMOVE and post-reconnect force REMOVE must both be sent');
  assert.deepEqual(removals.map((call) => call.body.data[0].type), ['0A', '0B', '0A', '0B']);
  assert.deepEqual(removals.map((call) => call.init.headers['X-Athena-Account']), Array(4).fill('server-a'));
  assert.deepEqual(removals.map((call) => call.init.redirect), Array(4).fill('error'));
});

test('stale connection generation and old-target ticks are blocked', async () => {
  const transport = fakeTransport();
  const bindingId = 'rtb_dddddddddddddddddddd';
  const manager = new CardLeaseManager({
    transport,
    semanticBindingSourceProvider: async (operationId) => operationId === '0D'
      ? new Map([['10', bindingId]]) : new Map(),
  });
  const mounted = await manager.mount({
    leaseId: 'book', cardId: 'CC-04', mode: 'regular', symbol: '005930',
    semanticBindingIds: [bindingId],
  });
  const initialConnection = mounted.connectionGeneration;
  const live = manager.routeFrame({ trnm: 'REAL', data: [{ type: '0D', item: '005930', values: { 10: '1' } }] });
  assert.equal(live.length, 1);
  await manager.update({
    leaseId: 'book', cardId: 'CC-04', mode: 'regular', symbol: '000660',
    semanticBindingIds: [bindingId],
  });
  assert.deepEqual(manager.routeFrame({ trnm: 'REAL', data: [{ type: '0D', item: '005930' }] }), []);
  await manager.handleFeedStatus({ state: 'disconnected' });
  await manager.handleFeedStatus({ state: 'open' });
  assert.deepEqual(
    manager.routeFrame({ trnm: 'REAL', data: [{ type: '0D', item: '000660' }] }, initialConnection),
    [],
  );
});

test('condition realtime uses ka10173 acquire and ka10174 release bodies', async () => {
  const calls = [];
  const transport = createRegistrarTransport({
    backendBase: 'http://127.0.0.1:8010',
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ return_code: '0' }) };
    },
  });
  const manager = new CardLeaseManager({ transport });
  await manager.mount({ leaseId: 'condition', cardId: 'CC-06', mode: 'condition-search', conditionId: '7' });
  await manager.unmount('condition');
  assert.equal(calls[0].url.endsWith('/ka10173'), true);
  assert.deepEqual(calls[0].body, { trnm: 'CNSRREQ', seq: '7', search_type: '1', stex_tp: 'K' });
  assert.equal(calls[1].url.endsWith('/ka10174'), true);
  assert.deepEqual(calls[1].body, { trnm: 'CNSRCLR', seq: '7' });
});

test('condition list/general commands are allowlisted; release-command is not callable', async () => {
  const calls = [];
  const transport = createRegistrarTransport({
    backendBase: 'http://x',
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ return_code: '0' }) };
    },
  });
  assert.equal((await transport.command('ka10171', {}, 'server-a')).ok, true);
  assert.equal((await transport.command('ka10172', { conditionId: '3' }, 'server-a')).ok, true);
  assert.equal((await transport.command('ka10174', { conditionId: '3' }, 'server-a')).ok, false);
  assert.deepEqual(calls.map((c) => c.body.trnm), ['CNSRLST', 'CNSRREQ']);
});

test('renderer account target stays separate from verified backend header alias', async () => {
  const calls = [];
  const transport = createRegistrarTransport({
    backendBase: 'http://backend',
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ return_code: '0' }) };
    },
  });
  const manager = new CardLeaseManagerWithAccount({ transport });
  const mounted = await manager.mount({
    leaseId: 'account-card', cardId: 'CC-01', mode: 'overview',
    accountId: '123-45-6789', backendAccountAlias: 'server-a',
  });
  assert.equal(mounted.ok, true);
  assert.deepEqual(mounted.bindings.map((binding) => binding.target), ['123-45-6789', '123-45-6789']);
  assert.deepEqual(calls.map((call) => call.init.headers['X-Athena-Account']), ['server-a', 'server-a']);
  assert.deepEqual(calls.map((call) => call.init.redirect), ['error', 'error']);
  assert.equal(calls.some((call) => call.init.headers['X-Athena-Account'] === '123-45-6789'), false);
});

test('missing backend alias blocks lease and command before any transport fetch', async () => {
  let fetches = 0;
  const transport = createRegistrarTransport({
    backendBase: 'http://backend',
    fetchImpl: async () => { fetches += 1; },
  });
  const manager = new CardLeaseManagerWithAccount({ transport });
  const mounted = await manager.mount({ leaseId: 'missing', cardId: 'CC-04', mode: 'regular', symbol: '005930' });
  assert.equal(mounted.ok, false);
  assert.match(mounted.error, /invalid backend account alias/);
  assert.equal((await transport.command('ka10171', {}, '')).ok, false);
  assert.equal(fetches, 0);
});

test('redirect rejection stays a failed realtime command', async () => {
  const transport = createRegistrarTransport({
    backendBase: 'http://backend',
    fetchImpl: async (_url, init) => {
      assert.equal(init.redirect, 'error');
      throw new TypeError('redirect disallowed');
    },
  });
  const result = await transport.command('ka10171', {}, 'server-a');
  assert.equal(result.ok, false);
  assert.match(result.error, /redirect disallowed/);
});

test('HTTP 200 with nonzero or missing Kiwoom return_code is rejected', async () => {
  for (const body of [{ return_code: '1' }, {}, null]) {
    const validated = createValidatedFetch(async () => ({
      ok: true, status: 200, json: async () => body,
    }));
    const response = await validated('http://x', {});
    assert.equal(response.ok, false);
  }
});

test('normal registrar mount also rejects HTTP-200 nonzero return_code', async () => {
  const transport = createRegistrarTransport({
    backendBase: 'http://x',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ return_code: '17' }) }),
  });
  const manager = new CardLeaseManager({ transport });
  const result = await manager.mount({ leaseId: 'book', cardId: 'CC-04', mode: 'regular', symbol: '005930' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'error');
});

test('production registrar REMOVE nonzero ACK creates tombstone and succeeds on retry', async () => {
  const removeAttempts = new Map();
  const transport = createRegistrarTransport({
    backendBase: 'http://x',
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(init.body);
      const operationId = request.data[0].type;
      if (request.trnm === 'REMOVE') {
        removeAttempts.set(operationId, (removeAttempts.get(operationId) || 0) + 1);
      }
      const returnCode = request.trnm === 'REMOVE'
        && operationId === '0C'
        && removeAttempts.get(operationId) === 1 ? '17' : '0';
      return { ok: true, status: 200, json: async () => ({ return_code: returnCode }) };
    },
  });
  const manager = new CardLeaseManager({ transport });
  await manager.mount({ leaseId: 'book', cardId: 'CC-04', mode: 'regular', symbol: '005930' });
  const pending = await manager.unmount('book');
  assert.equal(pending.status, 'remove-pending');
  await manager.handleFeedStatus({ state: 'disconnected' });
  await manager.handleFeedStatus({ state: 'open' }, 2);
  assert.equal(manager.status('book'), null);
  assert.equal(removeAttempts.get('0C'), 2);
  assert.equal(removeAttempts.get('0D'), 1);
});
