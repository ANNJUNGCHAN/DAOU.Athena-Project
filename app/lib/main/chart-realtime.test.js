'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseRealTick, parseRealFrame, buildRegisterBody, kstToEpochSec, kstTradingDate,
  createRealtimeRegistrar,
} = require('./chart-realtime');

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

test('buildRegisterBody: data[].type이 tr_id와 정확히 일치한다', () => {
  // 백엔드가 대소문자까지 일치를 요구한다(0g/0G 구분) — 여기서 어긋나면 422다.
  assert.deepEqual(buildRegisterBody(['005930']), {
    trnm: 'REG', grp_no: '1', refresh: '1', data: [{ type: '0B', item: '005930' }],
  });
});

test('createRealtimeRegistrar: 같은 종목은 한 번만 등록한다(REG는 리미터 소모)', async () => {
  const calls = [];
  const reg = createRealtimeRegistrar({
    backendBase: 'http://127.0.0.1:8010',
    fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; },
  });
  assert.equal(await reg.ensureSymbol('005930'), true);
  assert.equal(await reg.ensureSymbol('005930'), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:8010/api/v1/websocket/0B');
  assert.equal(reg.size(), 1);
});

test('createRealtimeRegistrar: 거부되면 등록으로 치지 않는다 — 다음에 다시 시도한다', async () => {
  let n = 0;
  const reg = createRealtimeRegistrar({
    backendBase: 'http://x',
    fetchImpl: async () => { n += 1; return { ok: n > 1, status: n > 1 ? 200 : 422 }; },
  });
  assert.equal(await reg.ensureSymbol('005930'), false);
  assert.equal(reg.isRegistered('005930'), false);
  assert.equal(await reg.ensureSymbol('005930'), true);
  assert.equal(n, 2);
});

test('createRealtimeRegistrar: 네트워크 실패도 조용히 성공으로 만들지 않는다', async () => {
  const reg = createRealtimeRegistrar({
    backendBase: 'http://x',
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  });
  assert.equal(await reg.ensureSymbol('005930'), false);
  assert.equal(reg.size(), 0);
});
