'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { REAL_TR_ID, parseQuoteBookTick, parseQuoteBookFrame } = require('./orderbook-realtime');

// FID 배치 근거: backend/ref/kiwoom-tr-inventory.json '0D' 실측(2026-08-27) —
// 61~70 매도호가수량1~10, 71~80 매수호가수량1~10, 121 매도호가총잔량, 125 매수호가총잔량.
function fid0DValues({ sellQty = {}, buyQty = {}, sellTotal, buyTotal } = {}) {
  const values = {};
  for (const [level, qty] of Object.entries(sellQty)) values[String(60 + Number(level))] = qty;
  for (const [level, qty] of Object.entries(buyQty)) values[String(70 + Number(level))] = qty;
  if (sellTotal !== undefined) values['121'] = sellTotal;
  if (buyTotal !== undefined) values['125'] = buyTotal;
  return values;
}

test('REAL_TR_ID: 0D다', () => {
  assert.equal(REAL_TR_ID, '0D');
});

test('parseQuoteBookTick: 매도/매수 잔량 10레벨 + 총잔량을 읽는다', () => {
  const tick = parseQuoteBookTick({
    type: '0D',
    item: '005930',
    values: fid0DValues({
      sellQty: { 1: '120', 2: '80' },
      buyQty: { 1: '200', 2: '150' },
      sellTotal: '5000',
      buyTotal: '6200',
    }),
  });
  assert.equal(tick.symbol, '005930');
  assert.equal(tick.sellQuantities[0], 120);
  assert.equal(tick.sellQuantities[1], 80);
  assert.equal(tick.buyQuantities[0], 200);
  assert.equal(tick.buyQuantities[1], 150);
  assert.equal(tick.sellTotal, 5000);
  assert.equal(tick.buyTotal, 6200);
  assert.equal(tick.sellQuantities.length, 10);
  assert.equal(tick.buyQuantities.length, 10);
});

test('parseQuoteBookTick: 프레임에 없는 레벨은 null이다(0으로 지어내지 않는다)', () => {
  const tick = parseQuoteBookTick({
    type: '0D',
    item: '005930',
    values: fid0DValues({ sellQty: { 1: '10' } }),
  });
  assert.equal(tick.sellQuantities[0], 10);
  assert.equal(tick.sellQuantities[1], null);
  assert.equal(tick.buyQuantities[0], null);
  assert.equal(tick.sellTotal, null);
  assert.equal(tick.buyTotal, null);
});

test('parseQuoteBookTick: 0D가 아니거나 종목코드가 없으면 null이다', () => {
  assert.equal(parseQuoteBookTick({ type: '0B', item: '005930', values: {} }), null);
  assert.equal(parseQuoteBookTick({ type: '0D', item: '', values: {} }), null);
  assert.equal(parseQuoteBookTick(null), null);
});

test('parseQuoteBookFrame: REAL 프레임만 읽고 0D 아닌 행은 버린다', () => {
  const ticks = parseQuoteBookFrame({
    trnm: 'REAL',
    data: [
      { type: '0D', item: '005930', values: fid0DValues({ sellQty: { 1: '10' } }) },
      { type: '0B', item: '005930', values: { 20: '090001', 10: '257000' } },
      { type: '0D', item: '000660', values: fid0DValues({ buyQty: { 1: '30' } }) },
    ],
  });
  assert.equal(ticks.length, 2);
  assert.deepEqual(ticks.map((t) => t.symbol), ['005930', '000660']);
});

test('parseQuoteBookFrame: REAL이 아니면 빈 배열이다', () => {
  assert.deepEqual(parseQuoteBookFrame({ trnm: 'PING' }), []);
  assert.deepEqual(parseQuoteBookFrame(null), []);
});
