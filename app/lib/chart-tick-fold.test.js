'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { foldTick, slotStartSec, isoDateOfSlot } = require('./chart-tick-fold');

// 2026-08-25 09:00:00 KST = 2026-08-25 00:00:00 UTC.
const NINE_AM = Date.UTC(2026, 7, 25, 0, 0, 0) / 1000;
const tick = (at, price, volume) => ({ symbol: '005930', at, price, volume });

test('slotStartSec: 분봉은 세분 단위로 내림한다', () => {
  assert.equal(slotStartSec(NINE_AM + 90, 'MIN', 1), NINE_AM + 60);
  assert.equal(slotStartSec(NINE_AM + 90, 'MIN', 5), NINE_AM);
  assert.equal(slotStartSec(NINE_AM + 61 * 60, 'MIN', 30), NINE_AM + 60 * 60);
});

test('slotStartSec: 틱은 체결 하나가 곧 봉이다', () => {
  assert.equal(slotStartSec(NINE_AM + 7, 'TICK', 1), NINE_AM + 7);
});

test('slotStartSec: 일봉은 KST 자정으로 자른다 — 09:00과 15:30은 같은 봉이다', () => {
  assert.equal(slotStartSec(NINE_AM, 'D', 1), slotStartSec(NINE_AM + 6.5 * 3600, 'D', 1));
  assert.equal(isoDateOfSlot(slotStartSec(NINE_AM, 'D', 1)), '2026-08-25');
});

test('foldTick: 직전 봉이 없으면 rollover로 새 봉을 연다', () => {
  const out = foldTick(null, tick(NINE_AM, 257000, 10), 'MIN', 1);
  assert.equal(out.kind, 'rollover');
  assert.deepEqual(out.candle, {
    time: NINE_AM, open: 257000, high: 257000, low: 257000, close: 257000, volume: 10,
  });
});

test('foldTick: 같은 슬롯이면 update — 고저를 넓히고 거래량을 누적한다', () => {
  const prev = { time: NINE_AM, open: 257000, high: 257000, low: 257000, close: 257000, volume: 10 };
  const up = foldTick(prev, tick(NINE_AM + 30, 258000, 5), 'MIN', 1);
  assert.equal(up.kind, 'update');
  assert.deepEqual(up.candle, {
    time: NINE_AM, open: 257000, high: 258000, low: 257000, close: 258000, volume: 15,
  });
  const down = foldTick(up.candle, tick(NINE_AM + 40, 255000, 3), 'MIN', 1);
  assert.deepEqual(down.candle, {
    time: NINE_AM, open: 257000, high: 258000, low: 255000, close: 255000, volume: 18,
  });
});

test('foldTick: 슬롯이 넘어가면 rollover — 시가는 그 체결가다', () => {
  const prev = { time: NINE_AM, open: 257000, high: 258000, low: 255000, close: 255000, volume: 18 };
  const out = foldTick(prev, tick(NINE_AM + 61, 256000, 4), 'MIN', 1);
  assert.equal(out.kind, 'rollover');
  assert.deepEqual(out.candle, {
    time: NINE_AM + 60, open: 256000, high: 256000, low: 256000, close: 256000, volume: 4,
  });
});

test('foldTick: 일봉은 문자열 날짜 봉을 갱신한다(같은 표현끼리 비교)', () => {
  const prev = { time: '2026-08-25', open: 249000, high: 258000, low: 245000, close: 257000, volume: 21617407 };
  const out = foldTick(prev, tick(NINE_AM + 6 * 3600, 259000, 100), 'D', 1);
  assert.equal(out.kind, 'update');
  assert.equal(out.candle.time, '2026-08-25');
  assert.equal(out.candle.high, 259000);
  assert.equal(out.candle.open, 249000);
  assert.equal(out.candle.volume, 21617507);
});

test('foldTick: 체결이 없거나 가격이 0이면 null이다', () => {
  assert.equal(foldTick(null, null, 'MIN', 1), null);
  assert.equal(foldTick(null, tick(NINE_AM, 0, 1), 'MIN', 1), null);
  assert.equal(foldTick(null, tick(NaN, 257000, 1), 'MIN', 1), null);
});
