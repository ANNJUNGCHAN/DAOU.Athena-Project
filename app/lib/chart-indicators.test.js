'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sma, ema, bollinger, rsi, macd } = require('./chart-indicators');

test('sma: 워밍업 구간은 null, 이후 정확한 평균', () => {
  const out = sma([1, 2, 3, 4, 5], 3);
  assert.deepEqual(out, [null, null, 2, 3, 4]);
});

test('ema: 시드는 첫 period SMA, 이후 평활', () => {
  const out = ema([1, 2, 3, 4, 5], 3);
  assert.equal(out[0], null);
  assert.equal(out[2], 2); // 시드 = (1+2+3)/3
  // k = 0.5: out[3] = 4*0.5 + 2*0.5 = 3, out[4] = 5*0.5 + 3*0.5 = 4
  assert.equal(out[3], 3);
  assert.equal(out[4], 4);
});

test('bollinger: 중심선=SMA, 상하한 대칭', () => {
  const closes = [2, 4, 6, 8, 10];
  const { middle, upper, lower } = bollinger(closes, 5, 2);
  assert.equal(middle[4], 6);
  assert.ok(Math.abs((upper[4] - 6) - (6 - lower[4])) < 1e-9);
  assert.equal(upper[3], null); // 워밍업
});

test('rsi: 전부 상승이면 100, 워밍업 null', () => {
  const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  const out = rsi(closes, 14);
  assert.equal(out[13], null);
  assert.equal(out[14], 100);
});

test('rsi: 등락 혼합 시 0~100 범위', () => {
  const closes = [10, 11, 10, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17, 16, 18];
  const out = rsi(closes, 14);
  assert.ok(out[15] > 0 && out[15] < 100);
});

test('macd: 히스토그램 = macd - signal, 워밍업 null 유지', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
  const { macd: line, signal, histogram } = macd(closes);
  assert.equal(line[24], null); // longP(26) 워밍업
  const i = 50;
  assert.ok(Math.abs(histogram[i] - (line[i] - signal[i])) < 1e-9);
});
