'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const accountBoundDataset = require('./account-bound-dataset');
const chartRealtime = require('./chart-realtime');
const integratedCardRealtimeSource = require('./integrated-card-realtime');

function functionSource(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const open = source.indexOf(') {', start) + 2;
  assert.ok(open > start + 1, `missing body for ${signature}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unclosed ${signature}`);
}

function createRuntime({
  activeId = 'local-a',
  bindings = { 'local-a': 'server-a' },
  resolveBackendAlias,
  useActualManager = false,
  realtimeTransport,
  fetchImpl,
} = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const calls = {
    feeds: [], fetches: [], mounts: [], updates: [], commands: [], resolved: [], rendererEvents: [], routed: [],
  };
  let currentActiveId = activeId;
  let nextUuid = 1;

  class FakeRoutineFeed {
    constructor(options) { this.options = options; calls.feeds.push(this); }
    start() { this.started = true; }
    stop() { this.stopped = true; }
  }

  class FakeCardLeaseManager {
    constructor(options) { this.options = options; }
    async mount(payload) { calls.mounts.push(payload); return { ok: true, status: 'live', bindings: [] }; }
    async update(payload) { calls.updates.push(payload); return { ok: true, status: 'live', bindings: [] }; }
    async releaseAll() { return { ok: true, pending: 0 }; }
    async handleFeedStatus() { return { ok: true }; }
    routeFrame(_frame, observedConnectionGeneration) {
      calls.routed.push(observedConnectionGeneration);
      return [];
    }
  }

  const integratedCardRealtime = {
    ...integratedCardRealtimeSource,
    CardLeaseManager: useActualManager
      ? integratedCardRealtimeSource.CardLeaseManager
      : FakeCardLeaseManager,
    createRegistrarTransport: () => realtimeTransport || ({
      acquire: async () => true,
      release: async () => true,
      reconnect: async (bindingsToReconnect) => bindingsToReconnect.map((binding) => ({ binding, ok: true })),
      command: async (operationId, args, backendAccountAlias) => {
        calls.commands.push({ operationId, args, backendAccountAlias });
        return { ok: true };
      },
    }),
    createSemanticBindingSourceProvider: () => async () => new Map(),
  };
  const context = vm.createContext({
    accountBoundDataset,
    accounts: {
      resolveBackendAlias: async (options) => {
        calls.resolved.push(options.id);
        if (resolveBackendAlias) return resolveBackendAlias(options);
        const backendAlias = bindings[options.id];
        return backendAlias
          ? { ok: true, accountId: options.id, backendAlias }
          : { ok: false, error: '조회에 사용할 서버 계좌를 먼저 연결해야 한다' };
      },
    },
    activeRestAccountId: () => currentActiveId,
    backendAccountAuthorization: () => 'Bearer fixture',
    BACKEND_HTTP_BASE: 'http://backend',
    BACKEND_WS_BASE: 'ws://backend',
    LOCAL_BEARER_TOKEN: 'fixture',
    RoutineFeed: FakeRoutineFeed,
    chartRealtime,
    orderbookRealtime: { REAL_TR_ID: '0D', parseQuoteBookFrame: () => [] },
    integratedCardRealtime,
    getIntegratedCardRegistrar: () => { throw new Error('unexpected registrar provider'); },
    fetch: async (url, init) => {
      calls.fetches.push({ url, init, body: JSON.parse(init.body) });
      if (fetchImpl) return fetchImpl(url, init, calls);
      return { ok: true, status: 200, json: async () => ({ return_code: '0' }) };
    },
    mdlog: () => {},
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(nextUuid++).padStart(12, '0')}` },
    process: { env: { ATHENA_CANVAS_SOURCE: 'live' } },
    shellWin: {
      isDestroyed: () => false,
      webContents: { send: (...args) => calls.rendererEvents.push(args) },
    },
  });
  vm.runInContext([
    'let chartRealtimeFeed = null;',
    'let chartRealtimeRegistrar = null;',
    'let orderbookRealtimeRegistrar = null;',
    'let integratedCardRealtimeManager = null;',
    'let integratedCardRealtimeTransport = null;',
    'let realtimeBackendAccountAlias = null;',
    'let realtimeAccountGeneration = 1;',
    'let realtimeFeedInstanceGeneration = 0;',
    'let realtimeFeedEpoch = 1;',
    'const realtimeCleanupBarriers = new Map();',
    'const chartRealtimePanelSymbols = new Map();',
    'const rendererRealtimeLeases = new Map();',
    functionSource(source, 'function createActiveBackendAccountInvoker('),
    functionSource(source, 'function ensureRealtimeFeed('),
    functionSource(source, 'function ensureIntegratedCardRealtimeManager()'),
    functionSource(source, 'async function withActiveRealtimeAccount('),
    functionSource(source, 'async function waitForRealtimeCleanup('),
    functionSource(source, 'async function ensureRealtimeForSymbol('),
    functionSource(source, 'async function acquireRendererRealtimeLease('),
    functionSource(source, 'function releaseRendererRealtimeLease('),
    functionSource(source, 'async function mountIntegratedCardRealtime('),
    functionSource(source, 'async function updateIntegratedCardRealtime('),
    functionSource(source, 'async function commandIntegratedCardRealtime('),
    functionSource(source, 'async function resetAccountBoundRealtime()'),
  ].join('\n'), context);
  return {
    calls,
    context,
    setActiveId(value) { currentActiveId = value; },
  };
}

function loadPreloadBridge(invoke) {
  let bridge;
  const originalLoad = Module._load;
  Module._load = function mockElectron(request, parent, isMain) {
    if (request === 'electron') {
      return {
        contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
        ipcRenderer: { invoke, send() {}, on() {}, removeListener() {} },
        webFrame: { getZoomFactor: () => 1 },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const preloadPath = require.resolve('../../preload');
    delete require.cache[preloadPath];
    require(preloadPath);
  } finally {
    Module._load = originalLoad;
  }
  return bridge;
}

test('actual main active local A/B opens the matching WS feed and sends the same verified REST header', async () => {
  for (const [activeId, backendAccountAlias] of [['local-a', 'server-a'], ['local-b', 'server-b']]) {
    const runtime = createRuntime({ activeId, bindings: { [activeId]: backendAccountAlias } });
    assert.equal(await runtime.context.ensureRealtimeForSymbol('005930'), true);
    assert.deepEqual(runtime.calls.resolved, [activeId]);
    assert.equal(runtime.calls.feeds.length, 1);
    assert.equal(runtime.calls.feeds[0].options.url, `ws://backend/api/v1/ws/stream?account=${backendAccountAlias}`);
    assert.equal(runtime.calls.fetches.length, 1);
    assert.equal(runtime.calls.fetches[0].init.headers['X-Athena-Account'], backendAccountAlias);
    assert.equal(runtime.calls.fetches[0].init.redirect, 'error');
  }
});

test('main orderbook path uses the verified active alias for feed and 0D control', async () => {
  const runtime = createRuntime({ activeId: 'local-b', bindings: { 'local-b': 'server-b' } });
  assert.equal((await runtime.context.acquireRendererRealtimeLease('orderbook', '000660')).ok, true);
  assert.equal(runtime.calls.feeds[0].options.url, 'ws://backend/api/v1/ws/stream?account=server-b');
  assert.equal(runtime.calls.fetches[0].body.data[0].type, '0D');
  assert.equal(runtime.calls.fetches[0].init.headers['X-Athena-Account'], 'server-b');
});

test('main integrated mount/update/command inject verified alias without treating renderer accountId as an alias', async () => {
  const runtime = createRuntime();
  const payload = { leaseId: 'lease-a', cardId: 'CC-01', mode: 'overview', accountId: '123-45-6789' };
  assert.equal((await runtime.context.mountIntegratedCardRealtime(payload)).ok, true);
  assert.equal((await runtime.context.updateIntegratedCardRealtime(payload)).ok, true);
  assert.equal((await runtime.context.commandIntegratedCardRealtime({
    operationId: 'ka10171', arguments: {}, accountId: 'renderer-must-not-route',
  })).ok, true);
  assert.equal(runtime.calls.mounts[0].accountId, '123-45-6789');
  assert.equal(runtime.calls.mounts[0].backendAccountAlias, 'server-a');
  assert.equal(runtime.calls.updates[0].backendAccountAlias, 'server-a');
  assert.deepEqual(runtime.calls.commands, [{ operationId: 'ka10171', args: {}, backendAccountAlias: 'server-a' }]);
  assert.equal(runtime.calls.feeds[0].options.url, 'ws://backend/api/v1/ws/stream?account=server-a');
  runtime.calls.feeds[0].options.onEvent({ trnm: 'REAL', data: [] }, { connectionEpoch: 1 });
  assert.equal(runtime.calls.routed[0] > 1, true, 'new feed must use the monotonic main connection generation');
});

test('missing or unknown mapping blocks every main realtime entry before feed or control fetch', async () => {
  const runtime = createRuntime({ bindings: {} });
  assert.equal(await runtime.context.ensureRealtimeForSymbol('005930'), false);
  assert.equal((await runtime.context.acquireRendererRealtimeLease('quote', '005930')).ok, false);
  assert.equal((await runtime.context.acquireRendererRealtimeLease('orderbook', '005930')).ok, false);
  assert.equal((await runtime.context.mountIntegratedCardRealtime({ leaseId: 'x', cardId: 'CC-03', symbol: '005930' })).ok, false);
  assert.equal((await runtime.context.commandIntegratedCardRealtime({ operationId: 'ka10171' })).ok, false);
  assert.equal(runtime.calls.feeds.length, 0);
  assert.equal(runtime.calls.fetches.length, 0);
  assert.equal(runtime.calls.mounts.length, 0);
  assert.equal(runtime.calls.commands.length, 0);
});

test('an alias result that completes after active-account reset cannot reopen the stale feed', async () => {
  let finishResolve;
  const runtime = createRuntime({
    resolveBackendAlias: ({ id }) => new Promise((resolve) => {
      finishResolve = () => resolve({ ok: true, accountId: id, backendAlias: 'server-a' });
    }),
  });
  const pending = runtime.context.ensureRealtimeForSymbol('005930');
  await new Promise((resolve) => setImmediate(resolve));
  runtime.setActiveId('local-b');
  await runtime.context.resetAccountBoundRealtime();
  finishResolve();
  assert.equal(await pending, false);
  assert.equal(runtime.calls.feeds.length, 0);
  assert.equal(runtime.calls.fetches.length, 0);
});

test('account reset stops A before B starts and ignores late callbacks from the old feed instance', async () => {
  const runtime = createRuntime({
    activeId: 'local-a', bindings: { 'local-a': 'server-a', 'local-b': 'server-b' },
  });
  assert.equal(await runtime.context.ensureRealtimeForSymbol('005930'), true);
  const oldFeed = runtime.calls.feeds[0];
  runtime.setActiveId('local-b');
  await runtime.context.resetAccountBoundRealtime();
  assert.equal(oldFeed.stopped, true);
  oldFeed.options.onEvent({
    trnm: 'REAL', data: [{ type: '0B', item: '005930', values: { 20: '090000', 10: '70000' } }],
  }, { connectionEpoch: 999 });
  oldFeed.options.onStatus({ state: 'open', connectionEpoch: 999 });
  assert.deepEqual(runtime.calls.rendererEvents, []);
  assert.equal(await runtime.context.ensureRealtimeForSymbol('000660'), true);
  assert.equal(runtime.calls.feeds.length, 2);
  assert.equal(runtime.calls.feeds[1].options.url, 'ws://backend/api/v1/ws/stream?account=server-b');
  assert.equal(runtime.calls.fetches.at(-1).init.headers['X-Athena-Account'], 'server-b');
});

test('account reset does not wait for a hung REMOVE and a different alias can register immediately', async () => {
  const runtime = createRuntime({
    activeId: 'local-a',
    bindings: { 'local-a': 'server-a', 'local-b': 'server-b' },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.trnm === 'REMOVE' && init.headers['X-Athena-Account'] === 'server-a') {
        return new Promise(() => {});
      }
      return { ok: true, status: 200, json: async () => ({ return_code: '0' }) };
    },
  });
  assert.equal((await runtime.context.acquireRendererRealtimeLease('quote', '005930')).ok, true);
  runtime.setActiveId('local-b');
  let resetDone = false;
  const resetting = runtime.context.resetAccountBoundRealtime().then(() => { resetDone = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resetDone, true, 'reset must detach without waiting for REMOVE response');
  await resetting;
  assert.equal((await runtime.context.acquireRendererRealtimeLease('quote', '000660')).ok, true);
  assert.deepEqual(runtime.calls.fetches.map((call) => [
    call.body.trnm,
    call.init.headers['X-Athena-Account'],
  ]), [
    ['REG', 'server-a'],
    ['REMOVE', 'server-a'],
    ['REG', 'server-b'],
  ]);
});

test('main account reset does not wait for integrated REG and its late success is removed under old alias', async () => {
  let finishAcquire;
  let markAcquireStarted;
  let acquireCount = 0;
  const started = new Promise((resolve) => { markAcquireStarted = resolve; });
  const controlCalls = [];
  const realtimeTransport = {
    acquire: async (binding) => {
      acquireCount += 1;
      controlCalls.push(['REG', binding.operationId, binding.backendAccountAlias]);
      if (acquireCount !== 1) return true;
      markAcquireStarted();
      return new Promise((resolve) => { finishAcquire = resolve; });
    },
    release: async (binding) => {
      controlCalls.push(['REMOVE', binding.operationId, binding.backendAccountAlias]);
      return true;
    },
    reconnect: async (bindingsToReconnect) => bindingsToReconnect.map((binding) => ({ binding, ok: true })),
    command: async () => ({ ok: true }),
  };
  const runtime = createRuntime({
    activeId: 'local-a',
    bindings: { 'local-a': 'server-a', 'local-b': 'server-b' },
    useActualManager: true,
    realtimeTransport,
  });
  const mountingA = runtime.context.mountIntegratedCardRealtime({
    leaseId: 'quote-a', cardId: 'CC-03', mode: 'quote', symbol: '005930',
  });
  await started;
  const oldFeed = runtime.calls.feeds[0];
  runtime.setActiveId('local-b');

  let resetDone = false;
  const resetting = runtime.context.resetAccountBoundRealtime().then(() => { resetDone = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resetDone, true, 'main reset must settle while old REG is still pending');
  await resetting;
  assert.equal(oldFeed.stopped, true);

  const mountedB = await runtime.context.mountIntegratedCardRealtime({
    leaseId: 'quote-b', cardId: 'CC-03', mode: 'quote', symbol: '000660',
  });
  assert.equal(mountedB.ok, true);
  assert.equal(runtime.calls.feeds.at(-1).options.url, 'ws://backend/api/v1/ws/stream?account=server-b');
  assert.deepEqual(controlCalls.slice(1), [
    ['REG', '0A', 'server-b'],
    ['REG', '0B', 'server-b'],
  ]);

  finishAcquire(true);
  const staleMount = await mountingA;
  assert.equal(staleMount.ok, false);
  assert.deepEqual(controlCalls, [
    ['REG', '0A', 'server-a'],
    ['REG', '0A', 'server-b'],
    ['REG', '0B', 'server-b'],
    ['REMOVE', '0A', 'server-a'],
  ]);
});

test('stale quote and orderbook lease tokens cannot release the new account same-symbol registrar', async () => {
  for (const kind of ['quote', 'orderbook']) {
    const runtime = createRuntime({
      activeId: 'local-a', bindings: { 'local-a': 'server-a', 'local-b': 'server-b' },
    });
    const acquiredA = await runtime.context.acquireRendererRealtimeLease(kind, '005930');
    assert.equal(acquiredA.ok, true);
    runtime.setActiveId('local-b');
    await runtime.context.resetAccountBoundRealtime();
    const acquiredB = await runtime.context.acquireRendererRealtimeLease(kind, '005930');
    assert.equal(acquiredB.ok, true);
    const beforeStaleRelease = runtime.calls.fetches.length;
    assert.equal(await runtime.context.releaseRendererRealtimeLease(kind, acquiredA.leaseToken), false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runtime.calls.fetches.length, beforeStaleRelease);
    assert.equal(await runtime.context.releaseRendererRealtimeLease(kind, acquiredB.leaseToken), true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runtime.calls.fetches.length, beforeStaleRelease + 1);
    assert.equal(runtime.calls.fetches.at(-1).body.trnm, 'REMOVE');
    assert.equal(runtime.calls.fetches.at(-1).init.headers['X-Athena-Account'], 'server-b');
  }
});

test('same backend alias waits for retired REG cleanup before the new account can register', async () => {
  let finishOldRegister;
  let markOldRegisterStarted;
  const oldRegisterStarted = new Promise((resolve) => { markOldRegisterStarted = resolve; });
  const runtime = createRuntime({
    activeId: 'local-a',
    bindings: { 'local-a': 'server-a', 'local-b': 'server-a' },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.trnm === 'REG' && !finishOldRegister) {
        markOldRegisterStarted();
        return new Promise((resolve) => {
          finishOldRegister = () => resolve({ ok: true, status: 200, json: async () => ({ return_code: '0' }) });
        });
      }
      return { ok: true, status: 200, json: async () => ({ return_code: '0' }) };
    },
  });
  const acquireA = runtime.context.acquireRendererRealtimeLease('quote', '005930');
  await oldRegisterStarted;
  runtime.setActiveId('local-b');
  await runtime.context.resetAccountBoundRealtime();
  const acquireB = runtime.context.acquireRendererRealtimeLease('quote', '005930');
  let acquireBSettled = false;
  void acquireB.finally(() => { acquireBSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.calls.fetches.length, 1, 'same-alias B REG must wait for A cleanup');
  assert.equal(acquireBSettled, false, 'same-alias acquire remains fail-closed while cleanup is permanently pending');

  finishOldRegister();
  assert.equal((await acquireA).ok, false);
  assert.equal((await acquireB).ok, true);
  assert.deepEqual(runtime.calls.fetches.map((call) => call.body.trnm), ['REG', 'REMOVE', 'REG']);
  assert.deepEqual(
    runtime.calls.fetches.map((call) => call.init.headers['X-Athena-Account']),
    ['server-a', 'server-a', 'server-a'],
  );
});

test('same backend alias waits for an in-flight renderer REMOVE before the new REG', async () => {
  let finishOldRemove;
  const runtime = createRuntime({
    activeId: 'local-a',
    bindings: { 'local-a': 'server-a', 'local-b': 'server-a' },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.trnm === 'REMOVE') {
        return new Promise((resolve) => {
          finishOldRemove = () => resolve({ ok: true, status: 200, json: async () => ({ return_code: '0' }) });
        });
      }
      return { ok: true, status: 200, json: async () => ({ return_code: '0' }) };
    },
  });
  const acquiredA = await runtime.context.acquireRendererRealtimeLease('quote', '005930');
  const releaseA = runtime.context.releaseRendererRealtimeLease('quote', acquiredA.leaseToken);
  await new Promise((resolve) => setImmediate(resolve));
  runtime.setActiveId('local-b');
  await runtime.context.resetAccountBoundRealtime();
  const acquireB = runtime.context.acquireRendererRealtimeLease('quote', '005930');
  let acquireBSettled = false;
  void acquireB.finally(() => { acquireBSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(acquireBSettled, false);
  assert.deepEqual(runtime.calls.fetches.map((call) => call.body.trnm), ['REG', 'REMOVE']);

  finishOldRemove();
  assert.equal(await releaseA, true);
  assert.equal((await acquireB).ok, true);
  assert.deepEqual(runtime.calls.fetches.map((call) => call.body.trnm), ['REG', 'REMOVE', 'REG']);
});

test('failed in-flight renderer REMOVE keeps the same alias closed with zero new REG calls', async () => {
  let finishOldRemove;
  let registerCalls = 0;
  const runtime = createRuntime({
    activeId: 'local-a',
    bindings: { 'local-a': 'server-a', 'local-b': 'server-a' },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.trnm === 'REMOVE') {
        return new Promise((resolve) => {
          finishOldRemove = () => resolve({ ok: false, status: 503, json: async () => ({}) });
        });
      }
      registerCalls += 1;
      if (registerCalls > 1) throw new Error('new same-alias REG must remain blocked');
      return { ok: true, status: 200, json: async () => ({ return_code: '0' }) };
    },
  });
  const acquiredA = await runtime.context.acquireRendererRealtimeLease('quote', '005930');
  const releaseA = runtime.context.releaseRendererRealtimeLease('quote', acquiredA.leaseToken);
  await new Promise((resolve) => setImmediate(resolve));
  runtime.setActiveId('local-b');
  await runtime.context.resetAccountBoundRealtime();
  const acquireB = runtime.context.acquireRendererRealtimeLease('quote', '005930');
  finishOldRemove();
  assert.equal(await releaseA, false);
  const blockedB = await acquireB;
  assert.equal(blockedB.ok, false);
  assert.match(blockedB.error, /정리를 확인할 수 없어/);
  assert.deepEqual(runtime.calls.fetches.map((call) => call.body.trnm), ['REG', 'REMOVE']);
});

test('failed retired cleanup keeps the same alias closed with zero new REG calls', async () => {
  let finishOldRegister;
  let markOldRegisterStarted;
  const oldRegisterStarted = new Promise((resolve) => { markOldRegisterStarted = resolve; });
  const runtime = createRuntime({
    activeId: 'local-a',
    bindings: { 'local-a': 'server-a', 'local-b': 'server-a' },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.trnm === 'REG' && !finishOldRegister) {
        markOldRegisterStarted();
        return new Promise((resolve) => {
          finishOldRegister = () => resolve({ ok: true, status: 200, json: async () => ({ return_code: '0' }) });
        });
      }
      if (body.trnm === 'REMOVE') return { ok: false, status: 503, json: async () => ({}) };
      throw new Error('new same-alias REG must remain blocked');
    },
  });
  const acquireA = runtime.context.acquireRendererRealtimeLease('quote', '005930');
  await oldRegisterStarted;
  runtime.setActiveId('local-b');
  await runtime.context.resetAccountBoundRealtime();
  const acquireB = runtime.context.acquireRendererRealtimeLease('quote', '005930');
  finishOldRegister();
  assert.equal((await acquireA).ok, false);
  const blockedB = await acquireB;
  assert.equal(blockedB.ok, false);
  assert.match(blockedB.error, /정리를 확인할 수 없어/);
  assert.deepEqual(runtime.calls.fetches.map((call) => call.body.trnm), ['REG', 'REMOVE']);
});

test('failed renderer REMOVE keeps its token so the same owner can retry successfully', async () => {
  let removeAttempts = 0;
  const runtime = createRuntime({
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.trnm === 'REMOVE') {
        removeAttempts += 1;
        return { ok: removeAttempts > 1, status: removeAttempts > 1 ? 200 : 503, json: async () => ({ return_code: '0' }) };
      }
      return { ok: true, status: 200, json: async () => ({ return_code: '0' }) };
    },
  });
  const acquired = await runtime.context.acquireRendererRealtimeLease('quote', '005930');
  assert.equal(acquired.ok, true);
  assert.equal(await runtime.context.releaseRendererRealtimeLease('quote', acquired.leaseToken), false);
  assert.equal(await runtime.context.releaseRendererRealtimeLease('quote', acquired.leaseToken), true);
  assert.equal(await runtime.context.releaseRendererRealtimeLease('quote', acquired.leaseToken), false);
  assert.deepEqual(runtime.calls.fetches.map((call) => call.body.trnm), ['REG', 'REMOVE', 'REMOVE']);
});

test('actual canvas retries the same opaque token once when renderer REMOVE fails', async () => {
  let removeAttempts = 0;
  const runtime = createRuntime({
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.trnm === 'REMOVE') {
        removeAttempts += 1;
        return { ok: removeAttempts > 1, status: removeAttempts > 1 ? 200 : 503, json: async () => ({ return_code: '0' }) };
      }
      return { ok: true, status: 200, json: async () => ({ return_code: '0' }) };
    },
  });
  const bridge = loadPreloadBridge(async (channel, payload) => {
    if (channel === 'athena:realtime-acquire') {
      return runtime.context.acquireRendererRealtimeLease('quote', payload.symbol);
    }
    if (channel === 'athena:realtime-release') {
      return runtime.context.releaseRendererRealtimeLease('quote', payload.leaseToken);
    }
    throw new Error(`unexpected channel: ${channel}`);
  });
  const canvasSource = fs.readFileSync(path.join(__dirname, '..', '..', 'canvas.js'), 'utf8');
  const destroyers = new Map();
  const canvasContext = vm.createContext({
    window: { athena: bridge },
    quoteRealtimePanels: { openPanel() {}, closePanel() {} },
    cardDestroyers: destroyers,
  });
  vm.runInContext([
    functionSource(canvasSource, 'function resolveEnvelopeSymbol('),
    functionSource(canvasSource, 'function releaseRendererRealtimeLease('),
    functionSource(canvasSource, 'function wireQuoteRealtime('),
  ].join('\n'), canvasContext);
  const card = {};
  canvasContext.wireQuoteRealtime(card, {}, { operation_args: { stk_cd: '005930' } }, () => {});
  await new Promise((resolve) => setImmediate(resolve));
  destroyers.get(card)();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(removeAttempts, 2);
  assert.deepEqual(runtime.calls.fetches.map((call) => call.body.trnm), ['REG', 'REMOVE', 'REMOVE']);
});

test('actual canvas and preload return the opaque quote lease to the original main registrar', async () => {
  const runtime = createRuntime({
    activeId: 'local-a', bindings: { 'local-a': 'server-a', 'local-b': 'server-b' },
  });
  const bridge = loadPreloadBridge(async (channel, payload) => {
    if (channel === 'athena:realtime-acquire') {
      return runtime.context.acquireRendererRealtimeLease('quote', payload.symbol);
    }
    if (channel === 'athena:realtime-release') {
      return runtime.context.releaseRendererRealtimeLease('quote', payload.leaseToken);
    }
    throw new Error(`unexpected channel: ${channel}`);
  });
  const canvasSource = fs.readFileSync(path.join(__dirname, '..', '..', 'canvas.js'), 'utf8');
  const destroyers = new Map();
  const canvasContext = vm.createContext({
    window: { athena: bridge },
    quoteRealtimePanels: { openPanel() {}, closePanel() {} },
    cardDestroyers: destroyers,
  });
  vm.runInContext([
    functionSource(canvasSource, 'function resolveEnvelopeSymbol('),
    functionSource(canvasSource, 'function releaseRendererRealtimeLease('),
    functionSource(canvasSource, 'function wireQuoteRealtime('),
  ].join('\n'), canvasContext);
  const envelope = { operation_args: { stk_cd: '005930' } };
  const cardA = {};
  canvasContext.wireQuoteRealtime(cardA, {}, envelope, () => {});
  await new Promise((resolve) => setImmediate(resolve));
  runtime.setActiveId('local-b');
  await runtime.context.resetAccountBoundRealtime();
  const cardB = {};
  canvasContext.wireQuoteRealtime(cardB, {}, envelope, () => {});
  await new Promise((resolve) => setImmediate(resolve));
  const beforeOldDestroy = runtime.calls.fetches.length;
  destroyers.get(cardA)();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.calls.fetches.length, beforeOldDestroy, 'A destroy must not remove B');
  destroyers.get(cardB)();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.calls.fetches.length, beforeOldDestroy + 1);
  assert.equal(runtime.calls.fetches.at(-1).body.trnm, 'REMOVE');
  assert.equal(runtime.calls.fetches.at(-1).init.headers['X-Athena-Account'], 'server-b');
});

test('actual canvas and preload return the opaque orderbook lease to the original main registrar', async () => {
  const runtime = createRuntime({
    activeId: 'local-a', bindings: { 'local-a': 'server-a', 'local-b': 'server-b' },
  });
  const bridge = loadPreloadBridge(async (channel, payload) => {
    if (channel === 'athena:orderbook-realtime-acquire') {
      return runtime.context.acquireRendererRealtimeLease('orderbook', payload.symbol);
    }
    if (channel === 'athena:orderbook-realtime-release') {
      return runtime.context.releaseRendererRealtimeLease('orderbook', payload.leaseToken);
    }
    throw new Error(`unexpected channel: ${channel}`);
  });
  const canvasSource = fs.readFileSync(path.join(__dirname, '..', '..', 'canvas.js'), 'utf8');
  const canvasContext = vm.createContext({
    window: { athena: bridge },
    orderbookRealtimePanels: { openPanel() {}, closePanel() {} },
    cardDestroyers: new Map(),
  });
  vm.runInContext([
    functionSource(canvasSource, 'function resolveEnvelopeSymbol('),
    functionSource(canvasSource, 'function releaseRendererRealtimeLease('),
    functionSource(canvasSource, 'function wireOrderbookRealtime('),
  ].join('\n'), canvasContext);
  const envelope = { operation_args: { stk_cd: '005930' } };
  const releaseA = canvasContext.wireOrderbookRealtime({}, {}, envelope, () => {}, {
    registerCardDestroyer: false,
  });
  await new Promise((resolve) => setImmediate(resolve));
  runtime.setActiveId('local-b');
  await runtime.context.resetAccountBoundRealtime();
  const releaseB = canvasContext.wireOrderbookRealtime({}, {}, envelope, () => {}, {
    registerCardDestroyer: false,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const beforeOldRelease = runtime.calls.fetches.length;
  assert.equal(releaseA(), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.calls.fetches.length, beforeOldRelease, 'A release must not remove B');
  assert.equal(releaseB(), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.calls.fetches.length, beforeOldRelease + 1);
  assert.equal(runtime.calls.fetches.at(-1).body.trnm, 'REMOVE');
  assert.equal(runtime.calls.fetches.at(-1).body.data[0].type, '0D');
  assert.equal(runtime.calls.fetches.at(-1).init.headers['X-Athena-Account'], 'server-b');
});
