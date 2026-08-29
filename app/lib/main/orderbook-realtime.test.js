'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { REAL_TR_ID, parseQuoteBookTick, parseQuoteBookFrame } = require('./orderbook-realtime');

function fid0DValues({
  time,
  expectedExecutionPrice,
  expectedExecutionQuantity,
  sellPrice = {},
  buyPrice = {},
  sellQty = {},
  buyQty = {},
  sellChange = {},
  buyChange = {},
  sellTotal,
  buyTotal,
} = {}) {
  const values = {};
  if (time !== undefined) values['21'] = time;
  if (expectedExecutionPrice !== undefined) values['23'] = expectedExecutionPrice;
  if (expectedExecutionQuantity !== undefined) values['24'] = expectedExecutionQuantity;
  for (const [level, value] of Object.entries(sellPrice)) values[String(40 + Number(level))] = value;
  for (const [level, value] of Object.entries(buyPrice)) values[String(50 + Number(level))] = value;
  for (const [level, value] of Object.entries(sellQty)) values[String(60 + Number(level))] = value;
  for (const [level, value] of Object.entries(buyQty)) values[String(70 + Number(level))] = value;
  for (const [level, value] of Object.entries(sellChange)) values[String(80 + Number(level))] = value;
  for (const [level, value] of Object.entries(buyChange)) values[String(90 + Number(level))] = value;
  if (sellTotal !== undefined) values['121'] = sellTotal;
  if (buyTotal !== undefined) values['125'] = buyTotal;
  return values;
}

test('REAL_TR_ID: 0D다', () => {
  assert.equal(REAL_TR_ID, '0D');
});

test('parseQuoteBookTick: AITS 10단 호가와 0D 예상체결 필드를 의미대로 읽는다', () => {
  const tick = parseQuoteBookTick({
    type: '0D',
    item: '005930',
    values: fid0DValues({
      time: '102418',
      expectedExecutionPrice: '+88100',
      expectedExecutionQuantity: '240',
      sellPrice: { 1: '-88200', 2: '-88300' },
      buyPrice: { 1: '+88000', 2: '+87900' },
      sellQty: { 1: '120', 2: '80' },
      buyQty: { 1: '200', 2: '150' },
      sellChange: { 1: '+17', 2: '-4' },
      buyChange: { 1: '-9', 2: '+11' },
      sellTotal: '5000',
      buyTotal: '6200',
    }),
  });

  assert.equal(tick.symbol, '005930');
  assert.equal(tick.time, '102418');
  assert.equal(tick.expectedExecutionPrice, 88100);
  assert.equal(tick.expectedExecutionQuantity, 240);
  assert.deepEqual(tick.sellPrices.slice(0, 2), [88200, 88300]);
  assert.deepEqual(tick.buyPrices.slice(0, 2), [88000, 87900]);
  assert.deepEqual(tick.sellQuantities.slice(0, 2), [120, 80]);
  assert.deepEqual(tick.buyQuantities.slice(0, 2), [200, 150]);
  assert.deepEqual(tick.sellChanges.slice(0, 2), [17, -4]);
  assert.deepEqual(tick.buyChanges.slice(0, 2), [-9, 11]);
  assert.equal(tick.sellTotal, 5000);
  assert.equal(tick.buyTotal, 6200);
  assert.equal(tick.sellPrices.length, 10);
  assert.equal(tick.buyQuantities.length, 10);
});

test('parseQuoteBookTick: 없는 FID는 null로 남겨 기존 단을 지우지 않는다', () => {
  const tick = parseQuoteBookTick({
    type: '0D',
    item: '005930',
    values: fid0DValues({ sellQty: { 1: '10' } }),
  });
  assert.equal(tick.sellQuantities[0], 10);
  assert.equal(tick.sellQuantities[1], null);
  assert.equal(tick.sellPrices[0], null);
  assert.equal(tick.buyQuantities[0], null);
  assert.equal(tick.expectedExecutionPrice, null);
  assert.equal(tick.sellTotal, null);
});

test('parseQuoteBookTick: 0D가 아니거나 종목코드가 없으면 null이다', () => {
  assert.equal(parseQuoteBookTick({ type: '0B', item: '005930', values: {} }), null);
  assert.equal(parseQuoteBookTick({ type: '0D', item: '', values: {} }), null);
  assert.equal(parseQuoteBookTick(null), null);
});

test('parseQuoteBookFrame: REAL 프레임의 0D만 추린다', () => {
  const ticks = parseQuoteBookFrame({
    trnm: 'REAL',
    data: [
      { type: '0D', item: '005930', values: fid0DValues({ sellQty: { 1: '10' } }) },
      { type: '0B', item: '005930', values: { 20: '090001', 10: '257000' } },
      { type: '0D', item: '000660', values: fid0DValues({ buyQty: { 1: '30' } }) },
    ],
  });
  assert.equal(ticks.length, 2);
  assert.deepEqual(ticks.map((tick) => tick.symbol), ['005930', '000660']);
});

test('parseQuoteBookFrame: REAL이 아니면 빈 배열이다', () => {
  assert.deepEqual(parseQuoteBookFrame({ trnm: 'PING' }), []);
  assert.deepEqual(parseQuoteBookFrame(null), []);
});
