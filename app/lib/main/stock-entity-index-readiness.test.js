'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { StartupReadiness } = require('./startup-readiness');
const {
  createStockEntityIndexReadiness,
  reconcileStockIndexStartupTask,
} = require('./stock-entity-index-readiness');
const { recoverStockMasterReady } = require('./stock-master-client');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function manualTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeoutImpl(fn, ms) {
      const id = nextId;
      nextId += 1;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeoutImpl(id) {
      pending.delete(id);
    },
    runNext() {
      const entry = pending.entries().next().value;
      assert.ok(entry, 'expected a pending timer');
      const [id, timer] = entry;
      pending.delete(id);
      timer.fn();
      return timer.ms;
    },
    get size() {
      return pending.size;
    },
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('background refresh retries late backend failures until the index is ready', async () => {
  const index = { size: 0 };
  const timers = manualTimers();
  let calls = 0;
  const readiness = createStockEntityIndexReadiness({
    index,
    refresh: async () => {
      calls += 1;
      if (calls < 4) throw new Error('backend not ready');
      index.size = 1;
    },
    retryBaseMs: 10,
    retryMaxMs: 20,
    ...timers,
  });

  readiness.start();
  await settle();
  assert.equal(calls, 1);
  assert.equal(timers.runNext(), 10);
  await settle();
  assert.equal(calls, 2);
  assert.equal(timers.runNext(), 20);
  await settle();
  assert.equal(calls, 3);
  assert.equal(timers.runNext(), 20);
  await settle();

  assert.equal(calls, 4);
  assert.equal(index.size, 1);
  assert.equal(timers.size, 0);
});

test('concurrent ensureReady calls share one refresh', async () => {
  const index = { size: 0 };
  const pending = deferred();
  let calls = 0;
  const readiness = createStockEntityIndexReadiness({
    index,
    refresh: async () => {
      calls += 1;
      await pending.promise;
      index.size = 1;
    },
  });

  const first = readiness.ensureReady(1_000);
  const second = readiness.ensureReady(1_000);
  await settle();
  assert.equal(calls, 1);

  pending.resolve();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
});

test('ensureReady keeps waiting when an early refresh fails and a retry succeeds before the deadline', async () => {
  const index = { size: 0 };
  const errors = [];
  let calls = 0;
  const readiness = createStockEntityIndexReadiness({
    index,
    refresh: async () => {
      calls += 1;
      if (calls === 1) throw new Error('backend still warming');
      index.size = 1;
    },
    retryBaseMs: 5,
    retryMaxMs: 5,
    onError: (error) => errors.push(error.message),
  });

  assert.equal(await readiness.ensureReady(100), true);
  assert.equal(calls, 2);
  assert.deepEqual(errors, ['backend still warming']);
});

test('ensureReady returns false at its deadline without cancelling the refresh', async () => {
  const index = { size: 0 };
  const pending = deferred();
  let calls = 0;
  const readiness = createStockEntityIndexReadiness({
    index,
    refresh: async () => {
      calls += 1;
      await pending.promise;
      index.size = 1;
    },
  });

  assert.equal(await readiness.ensureReady(5), false);
  assert.equal(calls, 1);

  pending.resolve();
  await settle();
  assert.equal(await readiness.ensureReady(0), true);
  assert.equal(calls, 1);
});

test('stop clears a scheduled retry and prevents another refresh', async () => {
  const index = { size: 0 };
  const timers = manualTimers();
  let calls = 0;
  const readiness = createStockEntityIndexReadiness({
    index,
    refresh: async () => {
      calls += 1;
      throw new Error('backend unavailable');
    },
    ...timers,
  });

  readiness.start();
  await settle();
  assert.equal(timers.size, 1);

  readiness.stop();
  assert.equal(timers.size, 0);
  await settle();
  assert.equal(calls, 1);
});

test('stop aborts an in-flight refresh and resolves readiness waiters as false', async () => {
  const index = { size: 0 };
  let refreshSignal = null;
  const readiness = createStockEntityIndexReadiness({
    index,
    refresh: async (_index, options = {}) => {
      refreshSignal = options.signal || null;
      await new Promise((resolve, reject) => {
        if (!refreshSignal) return;
        refreshSignal.addEventListener('abort', () => reject(refreshSignal.reason), { once: true });
      });
    },
  });

  readiness.start();
  const waiting = readiness.ensureReady(1_000);
  await settle();
  readiness.stop();

  assert.equal(refreshSignal && refreshSignal.aborted, true);
  assert.equal(await waiting, false);
});

test('a successful refresh stops background retries', async () => {
  const index = { size: 0 };
  const timers = manualTimers();
  let calls = 0;
  const readiness = createStockEntityIndexReadiness({
    index,
    refresh: async () => {
      calls += 1;
      if (calls === 1) throw new Error('backend warming');
      index.size = 2;
    },
    ...timers,
  });

  readiness.start();
  await settle();
  assert.equal(timers.size, 1);
  timers.runNext();
  await settle();

  assert.equal(index.size, 2);
  assert.equal(timers.size, 0);
  readiness.start();
  await settle();
  assert.equal(calls, 2);
});

test('BOOT-003: a complete background refresh reconciles one failed startup task and broadcasts one revision', async () => {
  const index = { size: 0 };
  const timers = manualTimers();
  const snapshots = [];
  const startupReadiness = new StartupReadiness({
    runId: 'boot-003',
    tasks: [{ id: 'stock-index', label: '종목 검색 데이터 준비', kind: 'gate' }],
    onChange: (snapshot) => snapshots.push(snapshot),
  });
  startupReadiness.update('stock-index', {
    state: 'failed',
    detail: '종목명 인덱스를 12초 안에 처음 적재하지 못함',
  });
  const failedRevision = startupReadiness.snapshot().revision;
  let calls = 0;
  const readiness = createStockEntityIndexReadiness({
    index,
    refresh: async () => {
      calls += 1;
      if (calls === 1) throw new Error('stock-master 502');
      index.size = 3;
    },
    onReady: ({ size }) => reconcileStockIndexStartupTask(startupReadiness, size),
    ...timers,
  });

  readiness.start();
  await settle();
  timers.runNext();
  await settle();

  const recovered = startupReadiness.snapshot();
  assert.equal(recovered.revision, failedRevision + 1);
  assert.equal(recovered.phase, 'ready');
  assert.deepEqual(recovered.tasks[0], {
    id: 'stock-index',
    label: '종목 검색 데이터 준비',
    kind: 'gate',
    state: 'succeeded',
    attempt: 0,
    retryable: true,
    detail: '종목 3개 적재 완료',
  });
  assert.equal(snapshots.at(-1).revision, recovered.revision);

  readiness.start();
  await settle();
  assert.equal(startupReadiness.snapshot().revision, recovered.revision);
});

test('BOOT-003: failed SQLite startup state recovers when backend status becomes ready later', async () => {
  const startupReadiness = new StartupReadiness({
    runId: 'boot-sqlite-late-ready',
    tasks: [{ id: 'stock-index', label: '종목 검색 데이터 준비', kind: 'gate' }],
  });
  startupReadiness.update('stock-index', {
    state: 'failed', detail: 'SQLite 종목 마스터를 12초 안에 준비하지 못함',
  });
  const failedRevision = startupReadiness.snapshot().revision;
  let requests = 0;

  const status = await recoverStockMasterReady({
    backendBase: 'http://backend',
    retryBaseMs: 1,
    wait: async () => {},
    fetchImpl: async () => {
      requests += 1;
      const body = requests === 1
        ? { ready: false, size: 0, refreshedAt: null }
        : { ready: true, size: 3210, refreshedAt: 'now' };
      return { ok: true, json: async () => body };
    },
    onReady: ({ size }) => reconcileStockIndexStartupTask(startupReadiness, size),
  });

  const recovered = startupReadiness.snapshot();
  assert.equal(status.size, 3210);
  assert.equal(requests, 2);
  assert.equal(recovered.phase, 'ready');
  assert.equal(recovered.revision, failedRevision + 1);
  assert.equal(recovered.tasks[0].state, 'succeeded');
});

test('BOOT-003: a partial empty refresh never reconciles startup failure', async () => {
  const index = { size: 0 };
  const timers = manualTimers();
  let notified = 0;
  const readiness = createStockEntityIndexReadiness({
    index,
    refresh: async () => {},
    onReady: () => { notified += 1; },
    ...timers,
  });

  readiness.start();
  await settle();

  assert.equal(notified, 0);
  assert.equal(timers.size, 1);
  readiness.stop();
});

test('BOOT-003: a throwing recovery callback cannot reject readiness or schedule another refresh', async () => {
  const index = { size: 0 };
  const timers = manualTimers();
  const errors = [];
  let refreshes = 0;
  let notifications = 0;
  const readiness = createStockEntityIndexReadiness({
    index,
    refresh: async () => {
      refreshes += 1;
      index.size = 3;
    },
    onReady: () => {
      notifications += 1;
      throw new Error('synthetic broadcast failure');
    },
    onError: (error) => errors.push(error.message),
    ...timers,
  });

  readiness.start();
  const waiting = readiness.ensureReady(1_000);
  assert.equal(await waiting, true);
  await settle();

  assert.equal(refreshes, 1);
  assert.equal(notifications, 1);
  assert.deepEqual(errors, ['synthetic broadcast failure']);
  assert.equal(timers.size, 0);
  assert.equal(await readiness.ensureReady(0), true);
  readiness.start();
  await settle();
  assert.equal(notifications, 1);
});

test('BOOT-003: an aborted stale refresh after restart never reconciles startup failure', async () => {
  const startupReadiness = new StartupReadiness({
    runId: 'boot-003-negative',
    tasks: [{ id: 'stock-index', label: '종목 검색 데이터 준비', kind: 'gate' }],
  });
  startupReadiness.update('stock-index', { state: 'failed', detail: 'initial failure' });
  const failedRevision = startupReadiness.snapshot().revision;
  const index = { size: 0 };
  const pending = deferred();
  let notified = 0;
  const readiness = createStockEntityIndexReadiness({
    index,
    refresh: async () => {
      await pending.promise;
      index.size = 3;
    },
    onReady: ({ size }) => {
      notified += 1;
      reconcileStockIndexStartupTask(startupReadiness, size);
    },
  });

  readiness.start();
  await settle();
  readiness.stop();
  readiness.start();
  pending.resolve();
  await settle();

  assert.equal(notified, 0);
  assert.equal(startupReadiness.snapshot().revision, failedRevision);
  assert.equal(startupReadiness.snapshot().tasks[0].state, 'failed');

  assert.equal(reconcileStockIndexStartupTask(startupReadiness, 0), false);
  assert.equal(startupReadiness.snapshot().revision, failedRevision);
  readiness.stop();
});

test('BOOT-003: main leaves background master ownership to SQLite backend', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  assert.doesNotMatch(source, /createStockEntityIndexReadiness/);
  assert.match(source, /stockMasterClient\.waitForStockMasterReady/);
  assert.match(source, /stockMasterClient\.recoverStockMasterReady/);
  assert.match(source, /reconcileStockIndexStartupTask\(startupReadiness, size\)/);

  const broadcastStart = source.indexOf('function broadcastBootReadiness(snapshot)');
  const broadcastEnd = source.indexOf('function attemptShellHandoff()', broadcastStart);
  assert.ok(broadcastStart >= 0 && broadcastEnd > broadcastStart);
  const broadcast = source.slice(broadcastStart, broadcastEnd);
  assert.match(broadcast, /for \(const \[target, label\] of \[/);
  assert.match(broadcast, /try \{\s*target\.webContents\.send\('athena:boot-readiness', snapshot\);\s*\} catch \(error\)/);
});
