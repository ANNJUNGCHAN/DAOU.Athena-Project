'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { aggregatePeriod, pseudoIntraday, resample, mondayOf } = require('./chart-resample');

const FIXTURE = require(path.join(__dirname, '..', 'data', 'chart-mock-ohlcv.json'));

test('mondayOf: 요일과 무관하게 ISO 주(월요일 시작)의 월요일을 돌려준다', () => {
  assert.equal(mondayOf('2025-08-18'), '2025-08-18'); // 월요일 자신
  assert.equal(mondayOf('2025-08-21'), '2025-08-18'); // 목요일 → 같은 주 월요일
  assert.equal(mondayOf('2025-08-24'), '2025-08-18'); // 일요일 → 그 주(전날까지)의 월요일
});

test('aggregatePeriod(주봉): OHLC 병합 — open=첫봉, close=마지막봉, high/low=최댓/최솟값, volume=합', () => {
  const bars = [
    { time: '2026-01-05', open: 100, high: 110, low: 95, close: 105, volume: 1000 }, // 월
    { time: '2026-01-06', open: 105, high: 120, low: 100, close: 115, volume: 1500 }, // 화
    { time: '2026-01-07', open: 115, high: 118, low: 90, close: 108, volume: 1200 }, // 수
  ];
  const out = aggregatePeriod(bars, 'W');
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    time: '2026-01-05',
    open: 100,
    high: 120,
    low: 90,
    close: 108,
    volume: 3700,
  });
});

test('aggregatePeriod(주봉): 경계 — 주 경계를 걸친 두 그룹으로 정확히 나뉜다(부분 주 포함)', () => {
  const bars = [
    { time: '2026-01-08', open: 108, high: 112, low: 106, close: 110, volume: 800 }, // 목 (첫 주 마지막 날)
    { time: '2026-01-12', open: 111, high: 115, low: 109, close: 113, volume: 900 }, // 월 (다음 주 시작)
    { time: '2026-01-13', open: 113, high: 116, low: 111, close: 114, volume: 700 }, // 화
  ];
  const out = aggregatePeriod(bars, 'W');
  assert.equal(out.length, 2);
  assert.equal(out[0].time, '2026-01-08'); // 그룹의 첫 봉(부분 주라 목요일 하루뿐)
  assert.equal(out[0].volume, 800);
  assert.equal(out[1].time, '2026-01-12');
  assert.deepEqual(out[1], { time: '2026-01-12', open: 111, high: 116, low: 109, close: 114, volume: 1600 });
});

test('aggregatePeriod: 빈/비배열 입력은 빈 배열', () => {
  assert.deepEqual(aggregatePeriod([], 'W'), []);
  assert.deepEqual(aggregatePeriod(null, 'W'), []);
});

test('aggregatePeriod(월봉/년봉): 실제 240봉 픽스처에서 그룹 수가 줄어들고 거래량 합이 보존된다', () => {
  const monthly = aggregatePeriod(FIXTURE.bars, 'M');
  const yearly = aggregatePeriod(FIXTURE.bars, 'Y');
  assert.ok(monthly.length > 0 && monthly.length < FIXTURE.bars.length);
  assert.ok(yearly.length > 0 && yearly.length < monthly.length);
  const totalDaily = FIXTURE.bars.reduce((s, b) => s + b.volume, 0);
  const totalMonthly = monthly.reduce((s, b) => s + b.volume, 0);
  const totalYearly = yearly.reduce((s, b) => s + b.volume, 0);
  assert.equal(totalMonthly, totalDaily);
  assert.equal(totalYearly, totalDaily);
});

test('pseudoIntraday: 결정적 — 같은 입력이면 항상 같은 출력(Math.random 미사용)', () => {
  const bar = [{ time: '2026-01-05', open: 100, high: 110, low: 95, close: 105, volume: 1000 }];
  const a = pseudoIntraday(bar, 'minute', 5);
  const b = pseudoIntraday(bar, 'minute', 5);
  assert.deepEqual(a, b);
});

test('pseudoIntraday: 세그먼트 마지막 봉의 종가는 원 일봉 종가와 같다(값이 안 새지 않는다)', () => {
  const bar = [{ time: '2026-01-05', open: 100, high: 110, low: 95, close: 105, volume: 1000 }];
  const out = pseudoIntraday(bar, 'minute', 1); // 세분=1분 → SEGMENTS_BY_INTERVAL.minute[1]=30조각
  assert.equal(out.length, 30);
  assert.equal(out[out.length - 1].close, 105);
  assert.equal(out[0].open, 100);
  for (const seg of out) {
    assert.ok(seg.low <= seg.high, `low<=high 위반: ${JSON.stringify(seg)}`);
  }
});

test('pseudoIntraday: 빈 입력은 빈 배열', () => {
  assert.deepEqual(pseudoIntraday([], 'tick', 1), []);
});

test('resample: 통합 진입점 — D는 그대로, W/M/Y는 집계, MIN/TICK은 mock=true', () => {
  const d = resample(FIXTURE.bars, 'D');
  assert.equal(d.mock, false);
  assert.equal(d.bars.length, FIXTURE.bars.length);

  const w = resample(FIXTURE.bars, 'W');
  assert.equal(w.mock, false);
  assert.ok(w.bars.length < FIXTURE.bars.length);

  const min = resample(FIXTURE.bars, 'MIN', 5);
  assert.equal(min.mock, true);
  assert.ok(min.bars.length > FIXTURE.bars.length);

  const tick = resample(FIXTURE.bars, 'TICK', 10);
  assert.equal(tick.mock, true);
  assert.ok(tick.bars.length > 0);
});
