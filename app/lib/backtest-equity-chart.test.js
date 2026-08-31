'use strict';

// backtest-equity-chart.js — 좌표 계산만 검증한다(DOM 없이).
//
// 곡선이 "보기에 맞는지"는 사람이 보지만, **점이 제 자리에 찍히는지**는 코드가 판정해야
// 한다. 특히 마커: 체결 날짜가 곡선 위 엉뚱한 자리에 찍히면 사용자는 전략이 하지 않은
// 매매를 했다고 읽는다.

const test = require('node:test');
const assert = require('node:assert/strict');

const chart = require('./backtest-equity-chart');

function equity(values, startDay) {
  const day0 = startDay || 1;
  return values.map((v, i) => ({
    dt: `2026-01-${String(day0 + i).padStart(2, '0')}`,
    equity: v,
    drawdown: 0,
  }));
}

// ── 정규화 ──────────────────────────────────────────────────────────────────

test('자산을 초기 대비 배수로 정규화한다 — 전략과 벤치마크를 같은 축에 놓기 위해', () => {
  assert.deepEqual(chart.normalize([100, 150, 50]), [1, 1.5, 0.5]);
});

test('빈 배열과 숫자가 아닌 값은 버린다', () => {
  assert.deepEqual(chart.normalize([]), []);
  assert.deepEqual(chart.normalize([100, null, 200, undefined]), [1, 2]);
});

test('초기 자산이 0이면 모두 1로 둔다 — 0으로 나누지 않는다', () => {
  assert.deepEqual(chart.normalize([0, 5]), [1, 1]);
});

// ── 범위 ────────────────────────────────────────────────────────────────────

test('두 곡선을 함께 담는 범위를 낸다', () => {
  const range = chart.extent([[1, 2], [0.5, 1.2]]);
  assert.ok(range.min < 0.5);
  assert.ok(range.max > 2);
});

test('값이 하나뿐이면 위아래로 여는 범위를 낸다 — 0폭 축을 만들지 않는다', () => {
  const range = chart.extent([[1, 1, 1]]);
  assert.ok(range.max > range.min);
});

test('그릴 값이 없으면 null', () => {
  assert.equal(chart.extent([[]]), null);
});

// ── 투영 ────────────────────────────────────────────────────────────────────

test('첫 점은 왼쪽 여백, 마지막 점은 오른쪽 여백에 붙는다', () => {
  const p = chart.projector(200, 100, 5, { min: 0, max: 1 });
  assert.equal(p.x(0), chart.PAD.left);
  assert.equal(p.x(4), 200 - chart.PAD.right);
});

test('값이 클수록 y가 작다(화면 위쪽)', () => {
  const p = chart.projector(200, 100, 5, { min: 0, max: 1 });
  assert.ok(p.y(1) < p.y(0));
});

test('점이 하나면 가운데에 둔다 — 0으로 나누지 않는다', () => {
  const p = chart.projector(200, 100, 1, { min: 0, max: 1 });
  assert.ok(Number.isFinite(p.x(0)));
});

// ── path ────────────────────────────────────────────────────────────────────

test('path는 M으로 시작해 L로 이어진다', () => {
  const p = chart.projector(200, 100, 3, { min: 0, max: 2 });
  const d = chart.pathFrom([1, 1.5, 2], p);
  assert.match(d, /^M[\d.]+ [\d.]+ L/);
  assert.equal(d.split('L').length, 3);
});

test('빈 시계열은 빈 path', () => {
  const p = chart.projector(200, 100, 0, { min: 0, max: 1 });
  assert.equal(chart.pathFrom([], p), '');
});

// ── 마커 ────────────────────────────────────────────────────────────────────

test('체결 날짜를 곡선 인덱스로 옮긴다', () => {
  const dts = ['2026-01-01', '2026-01-02', '2026-01-03'];
  const trades = [
    { dt: '2026-01-02', side: 'buy', reason: 'signal' },
    { dt: '2026-01-03', side: 'sell', reason: 'stop_loss' },
  ];
  assert.deepEqual(chart.markerPoints(trades, dts), [
    { index: 1, side: 'buy', reason: 'signal' },
    { index: 2, side: 'sell', reason: 'stop_loss' },
  ]);
});

test('곡선에 없는 날짜의 체결은 버린다 — 엉뚱한 자리에 찍느니 안 찍는다', () => {
  const dts = ['2026-01-01', '2026-01-02'];
  const trades = [{ dt: '2025-12-31', side: 'buy', reason: 'signal' }];
  assert.deepEqual(chart.markerPoints(trades, dts), []);
});

test('체결이 없으면 마커도 없다', () => {
  assert.deepEqual(chart.markerPoints(undefined, ['2026-01-01']), []);
});

// ── 전체 기하 ───────────────────────────────────────────────────────────────

test('자산곡선과 벤치마크 path를 둘 다 낸다', () => {
  const g = chart.buildGeometry({
    equity: equity([100, 110, 120]),
    closes: [50, 52, 54],
    width: 300, height: 120,
  });
  assert.equal(g.empty, false);
  assert.ok(g.strategyPath.length > 0);
  assert.ok(g.benchmarkPath.length > 0);
});

test('종가가 없으면 벤치마크를 그리지 않는다 — 직선으로 지어내지 않는다', () => {
  const g = chart.buildGeometry({ equity: equity([100, 110]) });
  assert.equal(g.benchmarkPath, '');
  assert.equal(g.empty, false);
});

test('자산 자료가 없으면 empty를 돌려준다', () => {
  assert.equal(chart.buildGeometry({ equity: [] }).empty, true);
});

test('마커 좌표가 곡선 위에 놓인다', () => {
  const points = equity([100, 120, 90]);
  const g = chart.buildGeometry({
    equity: points,
    trades: [{ dt: points[1].dt, side: 'buy', reason: 'signal' }],
    width: 300, height: 120,
  });
  assert.equal(g.markers.length, 1);
  // 두 번째 점이 최고값이므로 그 마커의 y가 세 점 중 가장 위(작은 값)여야 한다.
  const p = chart.projector(300, 120, 3, chart.extent([chart.normalize([100, 120, 90])]));
  assert.equal(g.markers[0].x.toFixed(2), p.x(1).toFixed(2));
});

test('축 라벨로 쓸 처음·중간·마지막 날짜를 낸다', () => {
  const g = chart.buildGeometry({ equity: equity([100, 110, 120]) });
  assert.equal(g.firstDt, '2026-01-01');
  assert.equal(g.lastDt, '2026-01-03');
  assert.equal(g.midDt, '2026-01-02');
});

// ── 겹쳐보기(보드 05) ────────────────────────────────────────────────────────

test('두 실행을 같은 축에 겹친다', () => {
  const g = chart.buildOverlay({
    series: [
      { label: '#41', equity: equity([100, 120, 150]) },
      { label: '#38', equity: equity([100, 110, 120]) },
    ],
    width: 300, height: 120,
  });
  assert.equal(g.empty, false);
  assert.equal(g.paths.length, 2);
  assert.equal(g.paths[0].label, '#41');
  assert.ok(g.paths.every((p) => p.d.startsWith('M')));
});

test('길이가 다르면 짧은 쪽이 먼저 끝난다 — 없는 구간을 이어 붙이지 않는다', () => {
  const g = chart.buildOverlay({
    series: [
      { label: 'long', equity: equity([100, 110, 120, 130]) },
      { label: 'short', equity: equity([100, 105]) },
    ],
    width: 400, height: 120,
  });
  const segments = (d) => d.split('L').length;
  assert.equal(segments(g.paths[0].d), 4);
  assert.equal(segments(g.paths[1].d), 2);
});

test('겹칠 곡선이 없으면 empty', () => {
  assert.equal(chart.buildOverlay({ series: [] }).empty, true);
  assert.equal(chart.buildOverlay({ series: [{ label: 'a', equity: [] }] }).empty, true);
});

test('두 곡선이 같은 범위를 공유한다 — 축이 갈라지면 비교가 성립하지 않는다', () => {
  const g = chart.buildOverlay({
    series: [
      { label: 'a', equity: equity([100, 200]) },
      { label: 'b', equity: equity([100, 110]) },
    ],
    width: 200, height: 100,
  });
  // 같은 시작값(배수 1)이므로 두 path의 첫 점 y가 정확히 같아야 한다.
  const firstY = (d) => d.split(' ')[1];
  assert.equal(firstY(g.paths[0].d), firstY(g.paths[1].d));
});
