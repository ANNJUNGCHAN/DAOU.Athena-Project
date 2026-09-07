'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseRealTick, parseRealFrame, buildRegisterBody, buildRemoveBody, kstToEpochSec, kstTradingDate,
  createRealtimeRegistrar: createRealtimeRegistrarWithAccount,
} = require('./chart-realtime');

function createRealtimeRegistrar(options) {
  return createRealtimeRegistrarWithAccount({ backendAccountAlias: 'server-a', ...options });
}

// 2026-08-25 09:00:00 KST = 2026-08-25 00:00:00 UTC.
const NINE_AM = Date.UTC(2026, 7, 25, 0, 0, 0) / 1000;

test('kstToEpochSec: KST 벽시계를 UTC epoch으로 바꾼다', () => {
  assert.equal(kstToEpochSec('20260825', '090000'), NINE_AM);
  assert.equal(kstToEpochSec('20260825', '153000'), NINE_AM + 6.5 * 3600);
});

test('kstToEpochSec: 형식이 틀리면 null이다 — 추측해 만들지 않는다', () => {
  assert.equal(kstToEpochSec('2026', '090000'), null);
  assert.equal(kstToEpochSec('20260825', 'abc'), null);
  assert.equal(kstToEpochSec(null, null), null);
});

test('kstTradingDate: UTC 자정 직후에도 KST 날짜를 준다', () => {
  // 2026-08-24 20:00 UTC = 2026-08-25 05:00 KST.
  assert.equal(kstTradingDate(new Date(Date.UTC(2026, 7, 24, 20, 0, 0))), '20260825');
});

test('parseRealTick: 0B 체결을 읽는다(등락 부호는 크기만 쓴다)', () => {
  const tick = parseRealTick(
    { type: '0B', item: '005930', values: { 20: '090000', 10: '-257000', 15: '+120' } },
    '20260825'
  );
  // 등락율(12)/누적거래량(13)이 프레임에 없으면 null — 지어내지 않는다.
  assert.deepEqual(tick, {
    symbol: '005930', at: NINE_AM, price: 257000, volume: 120, changeRate: null, accVolume: null,
  });
});

test('parseRealTick: 등락율(12)은 부호를 보존하고, 누적거래량(13)은 크기만 쓴다', () => {
  const tick = parseRealTick(
    { type: '0B', item: '005930', values: { 20: '090000', 10: '257000', 15: '10', 12: '-1.37', 13: '+311392' } },
    '20260825'
  );
  assert.equal(tick.changeRate, -1.37);
  assert.equal(tick.accVolume, 311392);
});

test('parseRealTick: 0B가 아니거나 값이 모자라면 null이다', () => {
  assert.equal(parseRealTick({ type: '0A', item: '005930', values: {} }, '20260825'), null);
  assert.equal(parseRealTick({ type: '0B', item: '', values: {} }, '20260825'), null);
  assert.equal(parseRealTick({ type: '0B', item: '005930', values: { 20: '090000' } }, '20260825'), null);
  // 가격 0은 체결이 아니다 — 진행봉을 0으로 끌어내리면 안 된다.
  assert.equal(parseRealTick({ type: '0B', item: '005930', values: { 20: '090000', 10: '0' } }, '20260825'), null);
});

test('parseRealFrame: REAL 프레임만 읽고 0B 아닌 행은 버린다', () => {
  const ticks = parseRealFrame({
    trnm: 'REAL',
    data: [
      { type: '0B', item: '005930', values: { 20: '090000', 10: '257000', 15: '10' } },
      { type: '0D', item: '005930', values: { 20: '090001' } },
      { type: '0B', item: '000660', values: { 20: '090002', 10: '1677500', 15: '3' } },
    ],
  }, '20260825');
  assert.equal(ticks.length, 2);
  assert.deepEqual(ticks.map((t) => t.symbol), ['005930', '000660']);
});

test('parseRealFrame: REAL이 아니면 빈 배열이다', () => {
  assert.deepEqual(parseRealFrame({ trnm: 'PING' }, '20260825'), []);
  assert.deepEqual(parseRealFrame(null, '20260825'), []);
});

test('REAL registrar A/B는 REG와 REMOVE에 같은 서버 alias와 redirect 차단을 보낸다', async () => {
  for (const backendAccountAlias of ['server-a', 'server-b']) {
    const calls = [];
    const registrar = createRealtimeRegistrarWithAccount({
      backendBase: 'http://backend', backendAccountAlias,
      fetchImpl: async (_url, options) => { calls.push(options); return { ok: true }; },
    });
    assert.equal(await registrar.acquire('005930'), true);
    assert.equal(await registrar.release('005930'), true);
    assert.deepEqual(calls.map((call) => call.headers['X-Athena-Account']), [backendAccountAlias, backendAccountAlias]);
    assert.deepEqual(calls.map((call) => call.redirect), ['error', 'error']);
  }
});

test('REAL registrar alias 누락/형식 오류는 REG/REMOVE fetch 전에 차단한다', async () => {
  let fetches = 0;
  for (const backendAccountAlias of ['', 'LOCAL-UUID', 'server a']) {
    const registrar = createRealtimeRegistrarWithAccount({
      backendBase: 'http://backend', backendAccountAlias,
      fetchImpl: async () => { fetches += 1; },
    });
    assert.equal(await registrar.acquire('005930'), false);
  }
  assert.equal(fetches, 0);
});

test('buildRegisterBody: data[].type이 tr_id와 정확히 일치한다', () => {
  // 백엔드가 대소문자까지 일치를 요구한다(0g/0G 구분) — 여기서 어긋나면 422다.
  assert.deepEqual(buildRegisterBody(['005930']), {
    trnm: 'REG', grp_no: '1', refresh: '1', data: [{ type: '0B', item: '005930' }],
  });
});

test('buildRemoveBody: trnm만 REMOVE로 바뀌고 나머지는 REG와 같은 모양이다', () => {
  // 같은 엔드포인트가 trnm만 보고 REG/REMOVE를 가른다(runtime.py 실측) — data 모양은 공유한다.
  assert.deepEqual(buildRemoveBody(['005930']), {
    trnm: 'REMOVE', grp_no: '1', refresh: '1', data: [{ type: '0B', item: '005930' }],
  });
});

test('acquire: 같은 종목은 한 번만 REG를 보낸다(REG는 리미터 소모)', async () => {
  const calls = [];
  const reg = createRealtimeRegistrar({
    backendBase: 'http://127.0.0.1:8010',
    fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; },
  });
  assert.equal(await reg.acquire('005930'), true);
  assert.equal(await reg.acquire('005930'), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:8010/api/v1/websocket/0B');
  assert.equal(calls[0].body.trnm, 'REG');
  assert.equal(reg.refCount('005930'), 2);
  assert.equal(reg.size(), 1);
});

test('acquire: 거부되면 등록으로 치지 않는다 — 다음에 다시 시도한다', async () => {
  let n = 0;
  const reg = createRealtimeRegistrar({
    backendBase: 'http://x',
    fetchImpl: async () => { n += 1; return { ok: n > 1, status: n > 1 ? 200 : 422 }; },
  });
  assert.equal(await reg.acquire('005930'), false);
  assert.equal(reg.isRegistered('005930'), false);
  assert.equal(await reg.acquire('005930'), true);
  assert.equal(n, 2);
});

test('acquire: 네트워크 실패도 조용히 성공으로 만들지 않는다', async () => {
  const reg = createRealtimeRegistrar({
    backendBase: 'http://x',
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  });
  assert.equal(await reg.acquire('005930'), false);
  assert.equal(reg.size(), 0);
});

test('acquire: 같은 종목이 REG 왕복 중에 겹쳐 들어와도 참조가 새지 않는다', async () => {
  // 실측 회귀 — REST 데이터셋 하나에 같은 종목 카드가 2장 있으면 paint ack가
  // 거의 동시에 온다. pendingRegister 없이는 둘 다 카운트를 0으로 읽고 REG를
  // 중복 발사한 뒤 마지막 쓰기가 앞선 쓰기를 덮어써 참조가 1로 무너진다.
  const calls = [];
  let resolveFetch;
  const reg = createRealtimeRegistrar({
    backendBase: 'http://x',
    fetchImpl: async (url, init) => {
      calls.push(JSON.parse(init.body));
      await new Promise((resolve) => { resolveFetch = resolve; });
      return { ok: true, status: 200 };
    },
  });
  const p1 = reg.acquire('005930'); // 카드 A — REG를 날리고 fetch가 아직 안 끝났다
  const p2 = reg.acquire('005930'); // 카드 B(같은 종목) — REG를 또 날리면 안 된다
  resolveFetch();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, true);
  assert.equal(r2, true);
  assert.equal(calls.filter((b) => b.trnm === 'REG').length, 1); // REG는 한 번만 나간다
  assert.equal(reg.refCount('005930'), 2); // 그런데 참조 2개는 둘 다 반영된다
});

test('release: 카드 2장 중 1장만 닫으면 참조가 남아 REMOVE를 안 보낸다', async () => {
  const calls = [];
  const reg = createRealtimeRegistrar({
    backendBase: 'http://x',
    fetchImpl: async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200 }; },
  });
  await reg.acquire('005930'); // 카드 A
  await reg.acquire('005930'); // 카드 B(같은 종목)
  assert.equal(await reg.release('005930'), true); // 카드 A만 닫힘
  assert.equal(reg.refCount('005930'), 1);
  assert.equal(calls.filter((b) => b.trnm === 'REMOVE').length, 0);
  assert.equal(reg.isRegistered('005930'), true); // 카드 B가 아직 스트림을 쓴다
});

test('release: 0→1→0 — 마지막 참조가 빠지는 순간에만 REMOVE를 보낸다', async () => {
  const calls = [];
  const reg = createRealtimeRegistrar({
    backendBase: 'http://x',
    fetchImpl: async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200 }; },
  });
  await reg.acquire('005930');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].trnm, 'REG');
  assert.equal(await reg.release('005930'), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].trnm, 'REMOVE');
  assert.equal(calls[1].data[0].item, '005930');
  assert.equal(reg.refCount('005930'), 0);
  assert.equal(reg.isRegistered('005930'), false);
  assert.equal(reg.size(), 0);
});

test('release: 쥔 적 없는 종목의 release는 조용히 무시한다(REMOVE 안 보냄)', async () => {
  const calls = [];
  const reg = createRealtimeRegistrar({
    backendBase: 'http://x',
    fetchImpl: async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200 }; },
  });
  assert.equal(await reg.release('005930'), false);
  assert.equal(calls.length, 0);
});

test('createRealtimeRegistrar: trId를 넘기면 그 TR로 REG/REMOVE를 보낸다(task #25 — 0D 재사용)', async () => {
  const calls = [];
  const reg = createRealtimeRegistrar({
    backendBase: 'http://127.0.0.1:8010',
    trId: '0D',
    fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; },
  });
  assert.equal(await reg.acquire('005930'), true);
  assert.equal(calls[0].url, 'http://127.0.0.1:8010/api/v1/websocket/0D');
  assert.equal(calls[0].body.data[0].type, '0D');
  assert.equal(await reg.release('005930'), true);
  assert.equal(calls[1].url, 'http://127.0.0.1:8010/api/v1/websocket/0D');
  assert.equal(calls[1].body.trnm, 'REMOVE');
});

test('createRealtimeRegistrar: 서로 다른 trId 인스턴스는 참조 계수를 공유하지 않는다', async () => {
  const calls0B = [];
  const calls0D = [];
  const reg0B = createRealtimeRegistrar({
    backendBase: 'http://x',
    fetchImpl: async (url, init) => { calls0B.push(JSON.parse(init.body)); return { ok: true, status: 200 }; },
  });
  const reg0D = createRealtimeRegistrar({
    backendBase: 'http://x',
    trId: '0D',
    fetchImpl: async (url, init) => { calls0D.push(JSON.parse(init.body)); return { ok: true, status: 200 }; },
  });
  await reg0B.acquire('005930');
  assert.equal(reg0D.isRegistered('005930'), false); // 같은 종목이어도 TR이 다르면 별개 구독이다
  assert.equal(calls0D.length, 0);
  await reg0D.acquire('005930');
  assert.equal(calls0B.length, 1);
  assert.equal(calls0D.length, 1);
});

test('release: REMOVE 실패를 호출자에게 전파하고 pending 참조를 재시도한다', async () => {
  let removeAttempts = 0;
  const reg = createRealtimeRegistrar({
    backendBase: 'http://x',
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.trnm === 'REMOVE') {
        removeAttempts += 1;
        return { ok: removeAttempts > 1, status: removeAttempts > 1 ? 200 : 500 };
      }
      return { ok: true, status: 200 };
    },
  });
  await reg.acquire('005930');
  assert.equal(await reg.release('005930'), false);
  assert.equal(reg.refCount('005930'), 1);
  assert.equal(await reg.release('005930'), true);
  assert.equal(reg.refCount('005930'), 0);
});

test('releaseAll: 진행 중 REG를 기다리지 않고 완료 시 같은 alias로 REMOVE하여 전환 누수를 막는다', async () => {
  const calls = [];
  let finishRegister;
  const reg = createRealtimeRegistrarWithAccount({
    backendBase: 'http://backend',
    backendAccountAlias: 'server-a',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ body, alias: init.headers['X-Athena-Account'] });
      if (body.trnm === 'REG') await new Promise((resolve) => { finishRegister = resolve; });
      return { ok: true, status: 200 };
    },
  });
  const acquiring = reg.acquire('005930');
  const releasing = reg.releaseAll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.map((call) => call.body.trnm), ['REG']);
  assert.equal(await releasing, false);
  assert.equal(await reg.acquire('000660'), false);
  let drained = false;
  const drainCompletion = reg.whenDrained().then((ok) => { drained = ok; return ok; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);
  finishRegister();
  assert.equal(await acquiring, false);
  assert.equal(await drainCompletion, true);
  assert.deepEqual(calls.map((call) => call.body.trnm), ['REG', 'REMOVE']);
  assert.deepEqual(calls.map((call) => call.alias), ['server-a', 'server-a']);
  assert.equal(reg.size(), 0);
});

test('whenDrained: 늦은 REG의 REMOVE 실패는 같은 alias 재사용을 허용하지 않는다', async () => {
  let finishRegister;
  const reg = createRealtimeRegistrarWithAccount({
    backendBase: 'http://backend',
    backendAccountAlias: 'server-a',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.trnm === 'REG') await new Promise((resolve) => { finishRegister = resolve; });
      return { ok: body.trnm === 'REG', status: body.trnm === 'REG' ? 200 : 503 };
    },
  });
  const acquiring = reg.acquire('005930');
  await reg.releaseAll();
  finishRegister();
  assert.equal(await acquiring, false);
  assert.equal(await reg.whenDrained(), false);
});

test('releaseAll: 이미 진행 중인 일반 REMOVE가 끝날 때까지 drain 완료를 보류한다', async () => {
  let finishRemove;
  const reg = createRealtimeRegistrar({
    backendBase: 'http://backend',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.trnm === 'REMOVE') {
        return new Promise((resolve) => {
          finishRemove = () => resolve({ ok: true, status: 200 });
        });
      }
      return { ok: true, status: 200 };
    },
  });
  assert.equal(await reg.acquire('005930'), true);
  const releasing = reg.release('005930');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await reg.releaseAll(), false);
  let drained = false;
  const drain = reg.whenDrained().then((ok) => { drained = ok; return ok; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);
  finishRemove();
  assert.equal(await releasing, true);
  assert.equal(await drain, true);
});

test('whenDrained: 진행 중인 일반 REMOVE 실패는 같은 alias 재사용을 닫는다', async () => {
  let finishRemove;
  const reg = createRealtimeRegistrar({
    backendBase: 'http://backend',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.trnm === 'REMOVE') {
        return new Promise((resolve) => {
          finishRemove = () => resolve({ ok: false, status: 503 });
        });
      }
      return { ok: true, status: 200 };
    },
  });
  assert.equal(await reg.acquire('005930'), true);
  const releasing = reg.release('005930');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await reg.releaseAll(), false);
  finishRemove();
  assert.equal(await releasing, false);
  assert.equal(await reg.whenDrained(), false);
});
