'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { aggregatePeriod, resample, mondayOf } = require('./chart-resample');

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

test('분·틱은 봉을 지어내지 않는다 — 일봉 개수 그대로에 사유가 붙는다', () => {
  for (const [period, interval] of [['MIN', 5], ['TICK', 10]]) {
    const r = resample(FIXTURE.bars, period, interval);
    assert.equal(r.mock, false, `${period}: mock 재샘플이 살아있다`);
    assert.equal(r.bars.length, FIXTURE.bars.length, `${period}: 봉 개수가 늘었다 — 지어냈다는 뜻이다`);
    assert.deepEqual(r.bars, FIXTURE.bars, `${period}: 일봉을 그대로 돌려줘야 한다`);
    assert.ok(r.unavailable, `${period}: 사유 없이 조용히 일봉을 내주면 안 된다`);
  }
});

test('사유 문구는 무엇이 없는지 말한다 — 분과 틱을 구분한다', () => {
  assert.match(resample(FIXTURE.bars, 'MIN', 1).unavailable, /분봉 데이터/);
  assert.match(resample(FIXTURE.bars, 'TICK', 1).unavailable, /틱 데이터/);
});

test('모듈은 봉을 만드는 함수를 더 이상 내보내지 않는다', () => {
  const mod = require('./chart-resample');
  assert.equal(mod.pseudoIntraday, undefined);
});

test('resample: 통합 진입점 — D는 그대로, W/M/Y는 집계', () => {
  const d = resample(FIXTURE.bars, 'D');
  assert.equal(d.mock, false);
  assert.equal(d.unavailable, undefined);
  assert.equal(d.bars.length, FIXTURE.bars.length);

  const w = resample(FIXTURE.bars, 'W');
  assert.equal(w.mock, false);
  assert.ok(w.bars.length < FIXTURE.bars.length);
});
