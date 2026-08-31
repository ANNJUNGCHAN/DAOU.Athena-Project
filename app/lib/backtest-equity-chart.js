// 자산곡선 — Paper 백테스트 보드 03(결과)·05(이력 겹쳐보기).
//
// **왜 lightweight-charts가 아니라 인라인 SVG인가.** 계획서 §8.1은 lightweight-charts를
// 적었지만, 그 라이브러리가 주는 것(캔들·십자선·주기 전환·실시간 갱신)을 자산곡선은 하나도
// 쓰지 않는다. 필요한 것은 "정해진 점들을 잇는 선 두 개와 마커 몇 개"뿐이고, 그건 좌표
// 계산 함수 하나로 끝난다. 라이브러리를 쓰면 canvas 요소 생명주기·리사이즈 옵저버·teardown이
// 따라오는데, 그 전부가 이 화면에는 없어도 되는 상태다. 게다가 SVG는 좌표를 **테스트할 수
// 있다** — DOM 없이 path 문자열을 검사하면 곡선이 맞는지 눈이 아니라 코드가 판정한다.
//
// **왜 벤치마크를 같은 축에 그리나.** 전략 곡선만 있으면 +184%가 좋은 숫자인지 알 수 없다.
// 같은 기간 매수보유가 +141%였다는 사실이 옆에 있어야 판단이 된다(계획서 §6.5 벤치마크).
(function () {
'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';

// 그리는 영역. 왼쪽 여백이 0인 이유는 y축 눈금 라벨을 곡선 위에 얹지 않고 아래 축만
// 쓰기 때문이다 — 보드 03이 y축 숫자를 그리지 않는다(비율 곡선이라 절대값이 덜 중요하다).
const PAD = { top: 12, right: 12, bottom: 22, left: 12 };

// `Number(null)`은 0이다 — 빠진 값을 0으로 읽으면 자산곡선이 바닥까지 떨어진 것처럼
// 그려진다. null/undefined/빈 문자열은 숫자가 아니라 **없는 값**으로 다룬다.
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---------- 순수 계산 (DOM 없이 검증) ----------

// 자산 시계열을 "초기 자산 대비 배수"로 정규화한다. 전략과 매수보유를 같은 축에 놓으려면
// 절대 금액이 아니라 배수여야 한다 — 초기 자금이 다르면 절대값 비교가 무의미하다.
function normalize(values) {
  const nums = values.map(toNumber).filter((v) => v !== null);
  if (!nums.length) return [];
  const base = nums[0];
  if (!base) return nums.map(() => 1);
  return nums.map((v) => v / base);
}

// 매수보유 곡선을 종가에서 만든다. 백엔드는 `buy_hold_return`(마지막 값 하나)만 주므로
// 곡선 전체는 여기서 만든다 — 종가 배열이 없으면 그리지 않는다(직선으로 지어내지 않는다).
function buyHoldSeries(closes) {
  return normalize(closes);
}

function extent(seriesList) {
  let min = Infinity;
  let max = -Infinity;
  seriesList.forEach((series) => {
    series.forEach((v) => {
      if (v < min) min = v;
      if (v > max) max = v;
    });
  });
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min === max) return { min: min - 0.5, max: max + 0.5 };
  // 위아래 5% 여유 — 곡선이 프레임에 붙으면 잘린 것처럼 보인다.
  const pad = (max - min) * 0.05;
  return { min: min - pad, max: max + pad };
}

function projector(width, height, count, range) {
  const innerW = Math.max(width - PAD.left - PAD.right, 1);
  const innerH = Math.max(height - PAD.top - PAD.bottom, 1);
  const span = range.max - range.min || 1;
  return {
    x(i) {
      return PAD.left + (count <= 1 ? innerW / 2 : (i / (count - 1)) * innerW);
    },
    y(v) {
      return PAD.top + innerH - ((v - range.min) / span) * innerH;
    },
  };
}

function pathFrom(series, project) {
  if (!series.length) return '';
  const parts = series.map((v, i) => {
    const x = project.x(i).toFixed(2);
    const y = project.y(v).toFixed(2);
    return `${i === 0 ? 'M' : 'L'}${x} ${y}`;
  });
  return parts.join(' ');
}

// 체결 표의 날짜를 자산곡선의 인덱스로 옮긴다. 곡선의 dt는 `YYYY-MM-DD`, 체결의 dt도
// 같은 서식이다(engine.py `_format_dt`). 못 찾은 체결은 **버린다** — 곡선 위 엉뚱한
// 자리에 마커를 찍느니 안 찍는 쪽이 정직하다.
function markerPoints(trades, equityDts) {
  const indexByDt = new Map();
  equityDts.forEach((dt, i) => {
    if (!indexByDt.has(dt)) indexByDt.set(dt, i);
  });
  const out = [];
  (trades || []).forEach((trade) => {
    const i = indexByDt.get(trade.dt);
    if (i === undefined) return;
    out.push({ index: i, side: trade.side, reason: trade.reason });
  });
  return out;
}

function buildGeometry(options) {
  const opts = options || {};
  const width = opts.width || 900;
  const height = opts.height || 260;
  const equity = normalize((opts.equity || []).map((p) => p.equity));
  const benchmark = opts.closes && opts.closes.length ? buyHoldSeries(opts.closes) : [];
  const range = extent([equity, benchmark].filter((s) => s.length));
  if (!range || !equity.length) {
    return { empty: true, width, height };
  }
  const project = projector(width, height, equity.length, range);
  const dts = (opts.equity || []).map((p) => p.dt);
  return {
    empty: false,
    width,
    height,
    strategyPath: pathFrom(equity, project),
    benchmarkPath: benchmark.length ? pathFrom(benchmark, project) : '',
    markers: markerPoints(opts.trades, dts).map((m) => ({
      x: project.x(m.index),
      y: project.y(equity[m.index]),
      side: m.side,
      reason: m.reason,
    })),
    firstDt: dts[0] || '',
    lastDt: dts[dts.length - 1] || '',
    midDt: dts[Math.floor(dts.length / 2)] || '',
  };
}

// 두 실행을 같은 축에 겹친다(Paper 보드 05). 길이가 다르면 짧은 쪽이 먼저 끝날 뿐
// 늘리지 않는다 — 없는 구간을 마지막 값으로 이어 붙이면 "그 기간에도 들고 있었다"는
// 거짓이 된다.
function buildOverlay(options) {
  const opts = options || {};
  const width = opts.width || 900;
  const height = opts.height || 220;
  const series = (opts.series || [])
    .map((s) => ({ label: s.label, values: normalize((s.equity || []).map((p) => p.equity)) }))
    .filter((s) => s.values.length);
  if (!series.length) return { empty: true, width, height };
  const range = extent(series.map((s) => s.values));
  const longest = Math.max(...series.map((s) => s.values.length));
  const project = projector(width, height, longest, range);
  return {
    empty: false,
    width,
    height,
    paths: series.map((s) => ({ label: s.label, d: pathFrom(s.values, project) })),
  };
}

// ---------- DOM ----------

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.keys(attrs || {}).forEach((k) => node.setAttribute(k, String(attrs[k])));
  return node;
}

function renderEquityChart(container, options) {
  const geometry = buildGeometry(options);
  while (container.firstChild) container.removeChild(container.firstChild);

  if (geometry.empty) {
    const empty = document.createElement('div');
    empty.className = 'backtest-equity-empty';
    empty.textContent = '자산곡선을 그릴 자료가 없습니다';
    container.appendChild(empty);
    return geometry;
  }

  const svg = svgEl('svg', {
    class: 'backtest-equity-svg',
    viewBox: `0 0 ${geometry.width} ${geometry.height}`,
    preserveAspectRatio: 'none',
    role: 'img',
    'aria-label': '전략과 매수보유 자산곡선',
  });

  if (geometry.benchmarkPath) {
    svg.appendChild(svgEl('path', {
      class: 'backtest-equity-benchmark', d: geometry.benchmarkPath, fill: 'none',
    }));
  }
  svg.appendChild(svgEl('path', {
    class: 'backtest-equity-strategy', d: geometry.strategyPath, fill: 'none',
  }));

  geometry.markers.forEach((m) => {
    svg.appendChild(svgEl('circle', {
      class: `backtest-equity-marker is-${m.side}`,
      cx: m.x.toFixed(2), cy: m.y.toFixed(2), r: 3.5,
    }));
  });

  container.appendChild(svg);

  const axis = document.createElement('div');
  axis.className = 'backtest-equity-axis';
  [geometry.firstDt, geometry.midDt, geometry.lastDt].forEach((label) => {
    const span = document.createElement('span');
    span.textContent = label;
    axis.appendChild(span);
  });
  container.appendChild(axis);
  return geometry;
}

function renderOverlayChart(container, options) {
  const geometry = buildOverlay(options);
  while (container.firstChild) container.removeChild(container.firstChild);
  if (geometry.empty) {
    const empty = document.createElement('div');
    empty.className = 'backtest-equity-empty';
    empty.textContent = '겹쳐 볼 자산곡선이 없습니다';
    container.appendChild(empty);
    return geometry;
  }
  const svg = svgEl('svg', {
    class: 'backtest-equity-svg',
    viewBox: `0 0 ${geometry.width} ${geometry.height}`,
    preserveAspectRatio: 'none',
    role: 'img',
    'aria-label': '두 실행의 자산곡선 겹쳐보기',
  });
  geometry.paths.forEach((p, i) => {
    svg.appendChild(svgEl('path', {
      class: `backtest-equity-overlay is-${i}`, d: p.d, fill: 'none',
    }));
  });
  container.appendChild(svg);
  return geometry;
}

const __exports = {
  PAD,
  normalize,
  buyHoldSeries,
  extent,
  projector,
  pathFrom,
  markerPoints,
  buildGeometry,
  buildOverlay,
  renderEquityChart,
  renderOverlayChart,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BacktestEquityChart = __exports;
}

})();
