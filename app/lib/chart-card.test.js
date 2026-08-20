'use strict';

// DOM/Electron 없이 검증 가능한 부분만 스모크 테스트한다 — createChartCard는
// document/lightweight-charts DOM 마운트가 필요해 node --test(순수 Node) 경로에서는
// 못 돈다. toCandleSeriesData/toVolumeSeriesData/withAlpha는 순수 함수라 분리해뒀다
// (chart-card.js 상단 주석 "순수 변환" 절 참조) — 이 스위트가 그 부분을 커버한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { toCandleSeriesData, toVolumeSeriesData, withAlpha, UP_COLOR, DOWN_COLOR, resolveInitialPeriod } = require('./chart-card');

const FIXTURE = require(path.join(__dirname, '..', 'data', 'chart-mock-ohlcv.json'));

test('chart-mock-ohlcv.json: 240 일봉, OHLC 정합(low<=open/close<=high)', () => {
  assert.equal(FIXTURE.bars.length, 240);
  for (const b of FIXTURE.bars) {
    assert.ok(b.low <= b.open && b.low <= b.close, `low가 open/close보다 커야 안 됨: ${JSON.stringify(b)}`);
    assert.ok(b.high >= b.open && b.high >= b.close, `high가 open/close보다 작으면 안 됨: ${JSON.stringify(b)}`);
    assert.ok(b.low <= b.high);
    assert.ok(b.volume > 0);
  }
});

test('toCandleSeriesData: time/open/high/low/close만 뽑고 숫자로 강제한다', () => {
  const out = toCandleSeriesData(FIXTURE.bars);
  assert.equal(out.length, FIXTURE.bars.length);
  assert.deepEqual(Object.keys(out[0]).sort(), ['close', 'high', 'low', 'open', 'time']);
  assert.equal(typeof out[0].open, 'number');
});

test('toCandleSeriesData: 결측/비정상 봉은 걸러낸다', () => {
  const out = toCandleSeriesData([
    { time: '2026-01-01', open: 100, high: 110, low: 90, close: 105 },
    { time: '2026-01-02', open: NaN, high: 110, low: 90, close: 105 },
    { time: null, open: 100, high: 110, low: 90, close: 105 },
    null,
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].time, '2026-01-01');
});

test('toCandleSeriesData: 빈/비배열 입력은 빈 배열', () => {
  assert.deepEqual(toCandleSeriesData([]), []);
  assert.deepEqual(toCandleSeriesData(null), []);
  assert.deepEqual(toCandleSeriesData(undefined), []);
});

test('toVolumeSeriesData: 상승봉은 UP_COLOR alpha 0.5, 하락봉은 DOWN_COLOR alpha 0.5', () => {
  const out = toVolumeSeriesData([
    { time: '2026-01-01', open: 100, close: 110, volume: 1000 }, // 상승
    { time: '2026-01-02', open: 110, close: 100, volume: 2000 }, // 하락
    { time: '2026-01-03', open: 100, close: 100, volume: 3000 }, // 보합 — 상승 취급(>=)
  ]);
  assert.equal(out.length, 3);
  assert.equal(out[0].color, withAlpha(UP_COLOR, 0.5));
  assert.equal(out[1].color, withAlpha(DOWN_COLOR, 0.5));
  assert.equal(out[2].color, withAlpha(UP_COLOR, 0.5));
  assert.equal(out[0].value, 1000);
});

test('withAlpha: HEX를 rgba() 문자열로 정확히 변환한다', () => {
  assert.equal(withAlpha('#FF5C5C', 0.5), 'rgba(255,92,92,0.5)');
  assert.equal(withAlpha('#4D9FFF', 0.5), 'rgba(77,159,255,0.5)');
});

test('mock 데이터에 대한 실제 변환도 산술적으로 닫힌다(전량 유지)', () => {
  const candles = toCandleSeriesData(FIXTURE.bars);
  const volumes = toVolumeSeriesData(FIXTURE.bars);
  assert.equal(candles.length, FIXTURE.bars.length);
  assert.equal(volumes.length, FIXTURE.bars.length);
});

// ---------------------------------------------------------------------------
// resolveInitialPeriod — P2a(`plan/공통화면-템플릿-실행계획-2026-08-20.md`)
// render-plan이 넘긴 initial.period를 하드코딩 'D' 대신 쓰되, 부재/미인식은
// 'D'로 안전 폴백 + 로그(수용 기준: "일/주/월/년봉 8TR에 한해서만 적용").
// ---------------------------------------------------------------------------

test('resolveInitialPeriod: D/W/M/Y는 그대로 통과시킨다', () => {
  assert.equal(resolveInitialPeriod({ period: 'D' }), 'D');
  assert.equal(resolveInitialPeriod({ period: 'W' }), 'W');
  assert.equal(resolveInitialPeriod({ period: 'M' }), 'M');
  assert.equal(resolveInitialPeriod({ period: 'Y' }), 'Y');
});

test('resolveInitialPeriod: initial 부재/period 부재는 조용히 D로 폴백(로그 없음)', () => {
  const warn = console.warn;
  let called = false;
  console.warn = () => { called = true; };
  try {
    assert.equal(resolveInitialPeriod(undefined), 'D');
    assert.equal(resolveInitialPeriod(null), 'D');
    assert.equal(resolveInitialPeriod({}), 'D');
    assert.equal(resolveInitialPeriod({ period: null }), 'D');
    assert.equal(resolveInitialPeriod({ period: '' }), 'D');
  } finally {
    console.warn = warn;
  }
  assert.equal(called, false, '단순 부재는 미인식 경고를 남기지 않는다');
});

test('resolveInitialPeriod: 미인식 값은 D로 폴백하고 경고를 남긴다', () => {
  const warn = console.warn;
  const calls = [];
  console.warn = (...args) => calls.push(args.join(' '));
  try {
    assert.equal(resolveInitialPeriod({ period: 'X' }), 'D');
  } finally {
    console.warn = warn;
  }
  assert.equal(calls.length, 1);
  assert.match(calls[0], /인식할 수 없는/);
});

test('resolveInitialPeriod: P2b(분/틱) MIN/TICK도 미인식으로 취급해 D로 폴백한다', () => {
  // 백엔드는 분/틱 4TR에 default_period를 절대 주지 않는다(의도적 비배선) —
  // 그래도 이 함수는 방어적으로 MIN/TICK을 거부한다. 구조적으로
  // pseudoIntraday()(mulberry32 의사난수)가 초기 마운트에서 절대 호출되지
  // 않는다는 것의 근거다: createChartCard가 mount 시 쓰는 유일한 주기 값이
  // 이 함수를 거치고, 그 반환값은 D/W/M/Y 중 하나로만 좁혀지기 때문이다.
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(resolveInitialPeriod({ period: 'MIN' }), 'D');
    assert.equal(resolveInitialPeriod({ period: 'TICK' }), 'D');
  } finally {
    console.warn = warn;
  }
});
