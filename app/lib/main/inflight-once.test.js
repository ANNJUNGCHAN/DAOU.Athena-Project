'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOnce } = require('./inflight-once');

// 미처리 거부를 관측하려면 프로세스 기본 동작(throw) 대신 리스너로 받아야 한다.
// 리스너가 하나라도 붙으면 node는 기본 종료 동작을 쓰지 않는다.
async function collectUnhandledRejections(run) {
  const seen = [];
  const onUnhandled = (reason) => seen.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    await run();
    // 미관측 거부 판정은 마이크로태스크 배출 뒤에 일어난다.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  return seen;
}

test('진행 중 재호출은 같은 promise를 받고 팩토리는 한 번만 돈다', async () => {
  let calls = 0;
  let release;
  const once = createOnce(() => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  });
  const first = once();
  const second = once();
  assert.equal(first, second);
  assert.equal(calls, 1);
  release('ok');
  assert.equal(await first, 'ok');
});

test('성공 뒤 재호출도 팩토리를 다시 부르지 않는다', async () => {
  let calls = 0;
  const once = createOnce(async () => {
    calls += 1;
    return calls;
  });
  assert.equal(await once(), 1);
  assert.equal(await once(), 1);
  assert.equal(calls, 1);
});

test('실패 뒤 재호출은 팩토리를 다시 부른다', async () => {
  let calls = 0;
  const once = createOnce(async () => {
    calls += 1;
    if (calls === 1) throw new Error('첫 시도 실패');
    return 'second';
  });
  await assert.rejects(once(), /첫 시도 실패/);
  assert.equal(await once(), 'second');
  assert.equal(calls, 2);
});

test('실패한 promise는 호출자가 잡든 안 잡든 미처리 거부로 새지 않는다', async () => {
  const handled = await collectUnhandledRejections(async () => {
    const once = createOnce(async () => { throw new Error('창 준비 실패'); });
    await once().catch(() => {});
  });
  assert.deepEqual(handled, []);

  const unobserved = await collectUnhandledRejections(async () => {
    const once = createOnce(async () => { throw new Error('창 준비 실패'); });
    once();
  });
  assert.deepEqual(unobserved, []);
});

test('재사용 알림은 재사용일 때만 불린다', async () => {
  const reuses = [];
  const once = createOnce(async () => 'v', () => reuses.push(1));
  await once();
  assert.equal(reuses.length, 0);
  await once();
  assert.equal(reuses.length, 1);
});
