'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStockEntityIndexReadiness } = require('./stock-entity-index-readiness');

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
