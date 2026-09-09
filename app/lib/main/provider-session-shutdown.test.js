'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { assertSessionStopsSucceeded } = require('./provider-session-shutdown');

test('중첩 allSettled 종료 결과가 모두 성공이면 원래 결과를 돌려준다', () => {
  const results = [
    { status: 'fulfilled', value: undefined },
    { status: 'fulfilled', value: [{ status: 'fulfilled', value: { ok: true, exited: true } }] },
  ];
  assert.equal(assertSessionStopsSucceeded(results), results);
});

test('중첩 rejected 종료를 AggregateError로 표면화한다', () => {
  const stopError = new Error('stop failed');
  assert.throws(
    () => assertSessionStopsSucceeded([
      { status: 'fulfilled', value: [{ status: 'rejected', reason: stopError }] },
    ]),
    (error) => error instanceof AggregateError
      && error.errors.length === 1
      && error.errors[0] === stopError,
  );
});

test('fulfilled 값이어도 ok:false 또는 exited:false 종료 결과는 실패다', () => {
  assert.throws(
    () => assertSessionStopsSucceeded([
      { status: 'fulfilled', value: { ok: false, reason: 'registry busy' } },
      { status: 'fulfilled', value: { exited: false, pid: 42 } },
    ]),
    (error) => error instanceof AggregateError
      && error.errors.length === 2
      && error.errors[0].result.reason === 'registry busy'
      && error.errors[1].result.pid === 42,
  );
});

test('main의 cold legacy 종료는 세션 stop 실패 뒤 성공이나 다음 적용으로 진행하지 않는다', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const start = source.indexOf('async function terminateColdLegacyRuntime');
  const endMarker = source.indexOf('// Esc 중단', start);
  const end = source.lastIndexOf('}', endMarker);
  assert.ok(start >= 0 && end > start, 'main.js terminateColdLegacyRuntime source must exist');

  let aborted = false;
  const poolFailure = new Error('pool stop failed');
  const context = {
    activeLegacyQueryCompletion: null,
    stopLiveChatPools: () => Promise.resolve([
      { status: 'rejected', reason: poolFailure },
    ]),
    abortAllConversationWork: () => { aborted = true; },
    liveRuntimes: { stopAllChatSessions: () => Promise.resolve([]) },
    assertSessionStopsSucceeded,
    Error,
    Promise,
  };
  const terminateColdLegacyRuntime = vm.runInNewContext(
    `${source.slice(start, end + 1)}\nterminateColdLegacyRuntime`,
    context,
  );

  let applied = false;
  await assert.rejects(async () => {
    await terminateColdLegacyRuntime('security mutation');
    applied = true;
  }, (error) => error instanceof AggregateError && error.errors[0] === poolFailure);
  assert.equal(aborted, true);
  assert.equal(applied, false);
});
