'use strict';

// DOM 빌더(renderPriceAugment/render차트)는 document가 필요해 node --test(순수 Node)
// 경로에서는 못 돈다 — 이 스위트는 extractLastClose(순수 함수)만 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractLastClose } = require('./card-kind-차트');

test('extractLastClose — data.chart.candles 마지막 봉의 close를 숫자로 돌려준다', () => {
  const envelope = {
    data: {
      chart: {
        candles: [
          { time: '2026-08-24', open: 1690000, high: 1700000, low: 1685000, close: 1695000 },
          { time: '2026-08-25', open: 1695000, high: 1714000, low: 1692000, close: 1701000 },
        ],
      },
    },
  };
  assert.equal(extractLastClose(envelope), 1701000);
});

test('extractLastClose — close가 문자열이어도 숫자로 파싱한다', () => {
  const envelope = { data: { chart: { candles: [{ close: '1701000' }] } } };
  assert.equal(extractLastClose(envelope), 1701000);
});

test('extractLastClose — candles가 없거나 비어 있으면 null', () => {
  assert.equal(extractLastClose({ data: { chart: {} } }), null);
  assert.equal(extractLastClose({ data: { chart: { candles: [] } } }), null);
  assert.equal(extractLastClose({ data: {} }), null);
  assert.equal(extractLastClose({}), null);
  assert.equal(extractLastClose(undefined), null);
});

test('extractLastClose — 마지막 봉의 close가 비유한값이면 null(지어내지 않는다)', () => {
  assert.equal(extractLastClose({ data: { chart: { candles: [{ close: 'n/a' }] } } }), null);
  assert.equal(extractLastClose({ data: { chart: { candles: [{ close: undefined }] } } }), null); // Number(undefined)=NaN(Number(null)=0과 다름)
});
