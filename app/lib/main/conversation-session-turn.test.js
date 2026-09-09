'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runConversationSessionTurn } = require('./conversation-session-turn');

function tick() { return new Promise((resolve) => setImmediate(resolve)); }

test('registers a cancellable handle synchronously before a queued warming run can submit', async () => {
  let handle;
  let promptSubmitted = false;
  let stopped = false;
  const session = {
    snapshot: () => ({ pid: null, state: 'warming' }),
    stop: async () => { stopped = true; },
    async run({ signal }) {
      await tick();
      if (!signal.aborted) promptSubmitted = true;
      return { ok: false, aborted: signal.aborted };
    },
  };

  const turn = runConversationSessionTurn(session, {
    prompt: 'must-not-submit',
    onSpawn: (value) => { if (!handle) handle = value; },
  });
  assert.equal(handle.pid, null);
  const stopping = handle.kill(new Error('cancel while warming'));
  assert.equal(stopped, true);
  await stopping;
  const result = await turn;
  assert.equal(result.aborted, true);
  assert.equal(promptSubmitted, false);
});

test('kill uses the injected registry stop for only the owned conversation session', async () => {
  const stopped = [];
  let firstHandle;
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = {
    snapshot: () => ({ pid: 1 }), stop() { throw new Error('registry must own stop'); },
    async run({ signal }) { await firstGate; return { ok: false, aborted: signal.aborted }; },
  };
  const second = {
    snapshot: () => ({ pid: 2 }), stop() { throw new Error('must not stop second'); },
    async run() { return { ok: true }; },
  };
  const firstTurn = runConversationSessionTurn(first, {
    prompt: 'first', onSpawn: (value) => { if (!firstHandle) firstHandle = value; },
    stopSession: async (reason) => { stopped.push({ session: first, reason }); releaseFirst(); },
  });
  const secondTurn = runConversationSessionTurn(second, {
    prompt: 'second', stopSession: async (reason) => { stopped.push({ session: second, reason }); },
  });
  await firstHandle.kill('first only');
  await Promise.all([firstTurn, secondTurn]);
  assert.equal(stopped.length, 1);
  assert.equal(stopped[0].session, first);
  assert.match(stopped[0].reason.message, /first only/);
});

test('forwards actual spawn metadata while preserving the wrapper cancellation handle', async () => {
  const callbacks = [];
  let stopReason = null;
  const session = {
    snapshot: () => ({ pid: 11, state: 'idle' }),
    async stop(reason) { stopReason = reason; },
    async run({ onSpawn }) {
      onSpawn({ pid: 22, transport: 'app-server' });
      return { ok: true };
    },
  };
  const result = await runConversationSessionTurn(session, {
    prompt: 'hello', onSpawn: (value) => callbacks.push(value),
  });
  assert.equal(result.ok, true);
  assert.equal(callbacks.length, 2);
  assert.deepEqual({ pid: callbacks[0].pid, transport: callbacks[0].transport }, { pid: 11, transport: undefined });
  assert.deepEqual({ pid: callbacks[1].pid, transport: callbacks[1].transport }, { pid: 22, transport: 'app-server' });
  assert.equal(callbacks[0].kill, callbacks[1].kill);
  await callbacks[1].kill('after spawn');
  assert.match(stopReason.message, /after spawn/);
});

test('external abort is relayed and async stop rejection is consumed before turn settles', async () => {
  const controller = new AbortController();
  let observedSignal;
  const session = {
    snapshot: () => ({ pid: 7 }),
    async stop() { throw new Error('late stop failure'); },
    async run({ signal }) {
      observedSignal = signal;
      await tick();
      return { ok: false, aborted: signal.aborted };
    },
  };
  const turn = runConversationSessionTurn(session, { prompt: 'q', signal: controller.signal });
  controller.abort(new Error('external cancel'));
  const result = await turn;
  assert.equal(observedSignal.aborted, true);
  assert.equal(result.aborted, true);
});
