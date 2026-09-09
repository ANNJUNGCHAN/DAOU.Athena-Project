'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationSessionPool } = require('./conversation-session-pool');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function fakeSession({ warmResult, snapshot, stopResult } = {}) {
  const session = {
    warmCalls: [],
    stopCalls: [],
    warm(options) {
      this.warmCalls.push(options);
      return typeof warmResult === 'function' ? warmResult() : warmResult;
    },
    run() {},
    stop(reason) {
      this.stopCalls.push(reason);
      return typeof stopResult === 'function' ? stopResult() : stopResult;
    },
  };
  if (snapshot) session.snapshot = snapshot;
  return session;
}

test('start는 원하는 수를 병렬 예열하고 동기·비동기 warm을 모두 받는다', async () => {
  const pending = deferred();
  const sessions = [
    fakeSession({ warmResult: pending.promise }),
    fakeSession({ warmResult: { running: true } }),
  ];
  const pool = createConversationSessionPool({
    desiredSize: 2,
    warmOptions: { model: 'shared-model' },
    createSession: () => sessions.shift(),
  });

  assert.deepEqual(pool.start(), {
    started: true,
    desiredSize: 2,
    generation: 1,
    warmOptions: { model: 'shared-model' },
    owned: 2,
    warming: 1,
    ready: 1,
    retryScheduled: false,
  });
  pending.resolve();
  await flush();
  assert.equal(pool.snapshot().ready, 2);
});

test('claim은 ready를 우선 동기 이전하고 보충 작업을 한 번만 예약한다', async () => {
  const firstPending = deferred();
  const made = [];
  const pool = createConversationSessionPool({
    desiredSize: 2,
    createSession: () => {
      const session = fakeSession({ warmResult: made.length === 0 ? firstPending.promise : undefined });
      made.push(session);
      return session;
    },
  });
  pool.start();

  assert.equal(pool.claim(), made[1], '예열 완료된 spare를 먼저 넘긴다');
  assert.equal(pool.claim(), made[0], 'ready가 없으면 warming spare도 즉시 넘긴다');
  assert.equal(pool.claim(), null);
  assert.equal(made.length, 2, 'claim 호출 스택에서는 새 세션을 만들지 않는다');

  await flush();
  assert.equal(made.length, 4);
  assert.equal(pool.snapshot().owned, 2);
  firstPending.reject(new Error('transferred warm failed'));
  await flush();
  assert.equal(made[0].stopCalls.length, 0, '이전된 세션은 warm 실패 뒤에도 풀에서 닫지 않는다');
  assert.equal(pool.snapshot().owned, 2);
});

test('Claude식 동기 warm snapshot은 init 신호 전까지 warming으로 보고 동적으로 갱신한다', () => {
  let initialized = false;
  const session = fakeSession({
    warmResult: { state: 'idle', warm: false },
    snapshot: () => ({ state: 'idle', warm: initialized }),
  });
  const pool = createConversationSessionPool({
    desiredSize: 1,
    createSession: () => session,
  });
  pool.start();
  assert.equal(pool.snapshot().warming, 1);
  assert.equal(pool.snapshot().ready, 0);

  initialized = true;
  assert.equal(pool.snapshot().warming, 0);
  assert.equal(pool.snapshot().ready, 1);
});

test('ready 뒤 down이 된 stale spare는 claim하지 않고 제거한 뒤 지연 보충한다', () => {
  let state = 'idle';
  const stale = fakeSession({ snapshot: () => ({ state }) });
  const healthy = fakeSession({ snapshot: () => ({ state: 'idle' }) });
  const sessions = [stale, healthy];
  const pool = createConversationSessionPool({
    desiredSize: 2,
    retryDelayMs: 1_000,
    createSession: () => sessions.shift(),
  });
  pool.start();
  assert.equal(pool.snapshot().ready, 2);

  state = 'down';
  assert.equal(pool.claim(), healthy);
  assert.equal(stale.stopCalls.length, 1);
  assert.equal(pool.snapshot().owned, 0);
  assert.equal(pool.snapshot().retryScheduled, true);
  pool.stop();
});

test('configure는 값이 바뀔 때 owned spare만 교체하고 claimed 세션은 유지한다', async () => {
  const made = [];
  const pool = createConversationSessionPool({
    desiredSize: 2,
    warmOptions: { model: 'old', effort: 'low' },
    createSession: () => {
      const session = fakeSession();
      made.push(session);
      return session;
    },
  });
  pool.start();
  const claimed = pool.claim();

  pool.configure({ model: 'old', effort: 'low' });
  assert.equal(made.length, 2, '동일 설정은 세대를 교체하지 않는다');
  pool.configure({ model: 'new', effort: 'high' });
  assert.equal(pool.snapshot().generation, 2);
  assert.equal(claimed.stopCalls.length, 0);
  assert.equal(made[0] === claimed ? made[1].stopCalls.length : made[0].stopCalls.length, 1);
  assert.equal(pool.snapshot().owned, 2);
  assert.ok(made.slice(2).every((session) => session.warmCalls[0].model === 'new'));

  await flush();
  assert.equal(pool.snapshot().owned, 2, 'claim이 예약한 이전 세대 refill도 상한을 넘기지 않는다');
});

test('owned warm 실패는 세션을 닫고 단일 지연 재시도로 복구한다', async () => {
  const errors = [];
  let made = 0;
  const sessions = [];
  const pool = createConversationSessionPool({
    desiredSize: 2,
    retryDelayMs: 10,
    onError: (error, context) => errors.push({ error, context }),
    createSession: () => {
      made += 1;
      const session = fakeSession({
        warmResult: made <= 2 ? Promise.reject(new Error(`warm ${made}`)) : undefined,
      });
      sessions.push(session);
      return session;
    },
  });
  pool.start();
  await flush();

  assert.equal(made, 2, '실패 직후 같은 스택에서 재생성하지 않는다');
  assert.equal(pool.snapshot().owned, 0);
  assert.equal(pool.snapshot().retryScheduled, true);
  assert.equal(errors.length, 2);
  assert.ok(sessions.slice(0, 2).every((session) => session.stopCalls.length === 1));

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(made, 4);
  assert.equal(pool.snapshot().ready, 2);
  assert.equal(pool.snapshot().retryScheduled, false);
});

test('재시도 불가 인증 오류는 현재 설정 세대를 차단하고 설정 변경 뒤에만 다시 예열한다', async () => {
  const errors = [];
  let made = 0;
  const authError = Object.assign(new Error('login required'), { retryable: false });
  const pool = createConversationSessionPool({
    desiredSize: 1,
    retryDelayMs: 5,
    warmOptions: { identityKey: 'account-v1' },
    onError: (error) => errors.push(error),
    createSession: () => {
      made += 1;
      return fakeSession({ warmResult: made === 1 ? Promise.reject(authError) : undefined });
    },
  });
  pool.start();
  await flush();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(made, 1, '인증 오류 뒤 주기적으로 세션을 다시 만들지 않는다');
  assert.equal(errors.length, 1);
  assert.equal(pool.snapshot().retryScheduled, false);
  assert.equal(pool.claim(), null, '빈 풀은 호출자가 직접 만든 세션으로 오류를 표면화하게 한다');

  pool.start();
  assert.equal(made, 1, '같은 설정의 start는 차단된 세대를 재시도하지 않는다');
  pool.configure({ identityKey: 'account-v2' });
  assert.equal(made, 2);
  assert.equal(pool.snapshot().ready, 1);
});

test('동기 create/warm 실패도 한 fill당 부족분만 시도한다', () => {
  let creates = 0;
  const pool = createConversationSessionPool({
    desiredSize: 3,
    retryDelayMs: 1_000,
    createSession: () => {
      creates += 1;
      if (creates === 1) throw new Error('create failed');
      return fakeSession({ warmResult: () => { throw new Error('warm failed'); } });
    },
  });
  pool.start();
  assert.equal(creates, 3);
  assert.equal(pool.snapshot().owned, 0);
  assert.equal(pool.snapshot().retryScheduled, true);
  pool.stop();
});

test('stop은 timer와 owned warming 세션을 정리하고 늦은 실패로 보충하지 않는다', async () => {
  const pending = deferred();
  const sessions = [];
  const pool = createConversationSessionPool({
    desiredSize: 2,
    createSession: () => {
      const session = fakeSession({ warmResult: pending.promise });
      sessions.push(session);
      return session;
    },
  });
  pool.start();
  pool.stop(new Error('app shutdown'));
  assert.equal(pool.snapshot().owned, 0);
  assert.ok(sessions.every((session) => session.stopCalls.length === 1));

  pending.reject(new Error('late warm rejection'));
  await flush();
  assert.equal(sessions.length, 2);
  assert.equal(pool.snapshot().retryScheduled, false);
});

test('drain은 설정 회전과 stop이 시작한 비동기 세션 종료가 모두 끝날 때까지 기다린다', async () => {
  const stops = [];
  const sessions = [];
  const pool = createConversationSessionPool({
    desiredSize: 2,
    warmOptions: { model: 'v1' },
    createSession: () => {
      const pendingStop = deferred();
      stops.push(pendingStop);
      const session = fakeSession({ stopResult: pendingStop.promise });
      sessions.push(session);
      return session;
    },
  });
  pool.start();

  pool.configure({ model: 'v2' });
  assert.equal(sessions.length, 4);
  assert.ok(sessions.slice(0, 2).every((session) => session.stopCalls.length === 1));
  let rotationDrained = false;
  const rotationDrain = pool.drain().then((results) => {
    rotationDrained = true;
    return results;
  });
  await flush();
  assert.equal(rotationDrained, false);
  stops[0].resolve('first stopped');
  await flush();
  assert.equal(rotationDrained, false);
  stops[1].resolve('second stopped');
  const rotationResults = await rotationDrain;
  assert.equal(rotationResults.length, 2);
  assert.ok(rotationResults.every((result) => result.status === 'fulfilled'));

  pool.stop(new Error('app shutdown'));
  assert.ok(sessions.slice(2).every((session) => session.stopCalls.length === 1));
  let shutdownDrained = false;
  const shutdownDrain = pool.drain().then((results) => {
    shutdownDrained = true;
    return results;
  });
  await flush();
  assert.equal(shutdownDrained, false);
  stops[2].resolve();
  stops[3].resolve();
  const shutdownResults = await shutdownDrain;
  assert.equal(shutdownDrained, true);
  assert.equal(shutdownResults.length, 2);
});

test('동기 stop 예외도 drain의 rejected 결과로 보존한다', async () => {
  const pool = createConversationSessionPool({
    desiredSize: 1,
    createSession: () => fakeSession({
      stopResult: () => { throw new Error('sync stop failed'); },
    }),
  });
  pool.start();
  pool.stop(new Error('app shutdown'));

  const results = await pool.drain();
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[0].reason.message, 'sync stop failed');
});

test('잘못된 팩토리 결과는 오류로 보고 예비 세션 상한을 지킨다', () => {
  const errors = [];
  const pool = createConversationSessionPool({
    desiredSize: 2,
    retryDelayMs: 1_000,
    createSession: () => ({}),
    onError: (error, context) => errors.push({ error, context }),
  });
  pool.start();
  assert.equal(pool.snapshot().owned, 0);
  assert.equal(errors.length, 2);
  assert.ok(errors.every(({ context }) => context.phase === 'create'));
  pool.stop();
});
