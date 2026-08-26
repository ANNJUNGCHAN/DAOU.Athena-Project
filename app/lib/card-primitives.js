// IIFE 스코프 격리(2026-08-18 렌더러 격리) — <script> 태그는 top-level const/function을
// 문서 전체가 공유하는 하나의 스크립트 스코프에 넣는다(facts-card.js/column-fold.js와
// 같은 문법). CJS(require)는 이 IIFE 밖에서도 동일하게 동작한다.
//
// 카드 v3(.omc/state/card-v3-plan.md §1) 공유 UI 프리미티브 9종. 포맷 헬퍼
// (formatNumeric/formatDatetime/changeTone/classifyCell)는 lib/facts-card.js를
// 그대로 가져다 쓴다 — 재정의하지 않는다. DOM을 만드는 함수는 document가 있는
// 렌더러(브라우저)에서만 호출된다 — 순수 계산 함수(비율·위치 산출)만 node --test로
// 검증한다(chart-card.js의 "순수 변환 분리" 관행과 같다).
(function () {
'use strict';

const FactsCard = typeof module !== 'undefined' && module.exports
  ? require('./facts-card')
  : window.AthenaLib.FactsCard;
const { changeTone, formatNumeric } = FactsCard;

// ---------- 순수 계산(포맷/스케일링 수학) — DOM 없이 테스트 가능 ----------

// ProportionalBar — 부호값 배열을 배열 안 최대 절대값 기준으로 0..1 비율로 스케일링한다.
// 값이 전부 0이거나 유한하지 않으면(최대 절대값 0) 전부 0 비율(막대 없음)을 돌려준다.
function proportionalRatios(values) {
  const list = (Array.isArray(values) ? values : []).map((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  });
  const max = list.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  if (max === 0) return list.map(() => 0);
  return list.map((v) => Math.abs(v) / max);
}

// RangeBar — 저가-값-고가 3점 중 value의 위치를 0..1로 계산한다. low===high(범위 없음)거나
// 세 값 중 하나라도 유한하지 않으면 null(마커를 그리지 않는다 — 지어낸 위치로 채우지 않는다).
function rangePosition(low, value, high) {
  const l = Number(low);
  const v = Number(value);
  const h = Number(high);
  if (![l, v, h].every(Number.isFinite) || h === l) return null;
  const ratio = (v - l) / (h - l);
  return Math.min(1, Math.max(0, ratio));
}

// StatusPill — 상태값을 호출부가 넘긴 톤 테이블로 판정한다(ChangeBadge와 달리 부호가
// 아니라 명시적 상태 라벨이 판정 기준). 테이블에 없는 상태는 flat(중립) 안전 폴백.
function resolveStatusTone(status, toneTable) {
  const table = toneTable && typeof toneTable === 'object' ? toneTable : {};
  return table[status] || 'flat';
}

// LadderRow — 호가 한 행의 막대 비율. maxQuantity(그 응답이 가진 레벨들의 최대 수량)
// 기준으로 0..1 스케일링한다. maxQuantity가 0/비유한이면 막대 없음(0).
function ladderRatio(quantity, maxQuantity) {
  const q = Number(quantity);
  const m = Number(maxQuantity);
  if (!Number.isFinite(q) || !Number.isFinite(m) || m <= 0) return 0;
  return Math.min(1, Math.max(0, Math.abs(q) / m));
}

// ---------- DOM 빌더 — document가 있는 렌더러에서만 호출된다 ----------

function ChangeBadge({ key, value, label } = {}) {
  const tone = changeTone(key, value);
  const el = document.createElement('span');
  el.className = `card-kit-badge-change is-${tone}`;
  el.textContent = label != null
    ? label
    : (value === null || value === undefined || value === '' ? '—' : String(value));
  return el;
}

function QuoteHeader({ price, changeKey, changeValue, name, code } = {}) {
  const el = document.createElement('div');
  el.className = 'card-kit-quote-header';
  const priceEl = document.createElement('span');
  priceEl.className = 'card-kit-quote-price';
  priceEl.textContent = formatNumeric(price);
  el.appendChild(priceEl);
  if (changeValue !== undefined) el.appendChild(ChangeBadge({ key: changeKey, value: changeValue }));
  const subline = [name, code].filter((part) => part !== undefined && part !== null && part !== '').join(' · ');
  if (subline) {
    const sub = document.createElement('div');
    sub.className = 'card-kit-quote-subline';
    sub.textContent = subline;
    el.appendChild(sub);
  }
  return el;
}

// controlled 컴포넌트 — activeIndex/onSelect만 받는다(데이터 페칭 없음, 호출부가 상태를 갖는다).
function TabSwitcher({ tabs, activeIndex = 0, onSelect } = {}) {
  const list = Array.isArray(tabs) ? tabs : [];
  const el = document.createElement('div');
  el.className = 'card-kit-tab-switcher';
  el.setAttribute('role', 'tablist');
  list.forEach((label, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `card-kit-tab${i === activeIndex ? ' is-active' : ''}`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(i === activeIndex));
    btn.textContent = label;
    if (typeof onSelect === 'function') btn.addEventListener('click', () => onSelect(i));
    el.appendChild(btn);
  });
  return el;
}

function ProportionalBar({ values, labels } = {}) {
  const list = Array.isArray(values) ? values : [];
  const ratios = proportionalRatios(list);
  const el = document.createElement('div');
  el.className = 'card-kit-bar-proportional';
  list.forEach((value, i) => {
    const row = document.createElement('div');
    row.className = 'card-kit-bar-row';
    const label = document.createElement('span');
    label.className = 'card-kit-bar-label';
    label.textContent = (labels && labels[i] != null) ? labels[i] : '';
    const track = document.createElement('span');
    track.className = 'card-kit-bar-track';
    const fill = document.createElement('span');
    const tone = changeTone(undefined, value);
    fill.className = `card-kit-bar-fill is-${tone}`;
    fill.style.width = `${Math.round(ratios[i] * 100)}%`;
    track.appendChild(fill);
    const valueEl = document.createElement('span');
    valueEl.className = 'card-kit-bar-value';
    valueEl.textContent = formatNumeric(value);
    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(valueEl);
    el.appendChild(row);
  });
  return el;
}

function RangeBar({ low, value, high, lowLabel, highLabel } = {}) {
  const el = document.createElement('div');
  el.className = 'card-kit-bar-range';
  const track = document.createElement('div');
  track.className = 'card-kit-bar-range-track';
  const position = rangePosition(low, value, high);
  if (position !== null) {
    const marker = document.createElement('span');
    marker.className = 'card-kit-bar-range-marker';
    marker.style.left = `${Math.round(position * 100)}%`;
    track.appendChild(marker);
  }
  el.appendChild(track);
  const labels = document.createElement('div');
  labels.className = 'card-kit-bar-range-labels';
  const lowEl = document.createElement('span');
  lowEl.className = 'card-kit-bar-range-low';
  lowEl.textContent = lowLabel != null ? lowLabel : formatNumeric(low);
  const highEl = document.createElement('span');
  highEl.className = 'card-kit-bar-range-high';
  highEl.textContent = highLabel != null ? highLabel : formatNumeric(high);
  labels.appendChild(lowEl);
  labels.appendChild(highEl);
  el.appendChild(labels);
  return el;
}

function RankedRow({ rank, name, value, unit } = {}) {
  const el = document.createElement('div');
  el.className = 'card-kit-row-ranked';
  const rankEl = document.createElement('span');
  rankEl.className = 'card-kit-row-ranked-badge';
  rankEl.textContent = rank !== undefined && rank !== null ? String(rank) : '—';
  const nameEl = document.createElement('span');
  nameEl.className = 'card-kit-row-ranked-name';
  nameEl.textContent = name || '—';
  const valueEl = document.createElement('span');
  valueEl.className = 'card-kit-row-ranked-value';
  valueEl.textContent = unit ? `${formatNumeric(value)}${unit}` : formatNumeric(value);
  el.appendChild(rankEl);
  el.appendChild(nameEl);
  el.appendChild(valueEl);
  return el;
}

// 좌(타이틀+서브라인) / 우(값+서브라인 or badge) 2단 압축 행. badge가 있으면 값 대신 배지를 쓴다.
function TwoLineRow({ title, titleSub, value, valueSub, badge } = {}) {
  const el = document.createElement('div');
  el.className = 'card-kit-row-two-line';
  const left = document.createElement('div');
  left.className = 'card-kit-row-two-line-left';
  const titleEl = document.createElement('div');
  titleEl.className = 'card-kit-row-two-line-title';
  titleEl.textContent = title || '';
  left.appendChild(titleEl);
  if (titleSub) {
    const sub = document.createElement('div');
    sub.className = 'card-kit-row-two-line-subline';
    sub.textContent = titleSub;
    left.appendChild(sub);
  }
  const right = document.createElement('div');
  right.className = 'card-kit-row-two-line-right';
  if (badge) {
    right.appendChild(badge);
  } else {
    const valueEl = document.createElement('div');
    valueEl.className = 'card-kit-row-two-line-value';
    valueEl.textContent = value === null || value === undefined ? '' : String(value);
    right.appendChild(valueEl);
  }
  if (valueSub) {
    const sub = document.createElement('div');
    sub.className = 'card-kit-row-two-line-subline';
    sub.textContent = valueSub;
    right.appendChild(sub);
  }
  el.appendChild(left);
  el.appendChild(right);
  return el;
}

function StatusPill({ status, label, toneTable } = {}) {
  const tone = resolveStatusTone(status, toneTable);
  const el = document.createElement('span');
  el.className = `card-kit-pill-status is-${tone}`;
  el.textContent = label != null ? label : (status || '—');
  return el;
}

// ProportionalBar(좌우 비대칭) + 가격 + ChangeBadge 1행 합성 — 호가 전용.
function LadderRow({ side, quantity, maxQuantity, price, changeKey, changeValue } = {}) {
  const el = document.createElement('div');
  el.className = `card-kit-row-ladder is-${side === 'ask' ? 'ask' : 'bid'}`;
  const bar = document.createElement('span');
  bar.className = 'card-kit-row-ladder-bar';
  bar.style.width = `${Math.round(ladderRatio(quantity, maxQuantity) * 100)}%`;
  const priceEl = document.createElement('span');
  priceEl.className = 'card-kit-row-ladder-price';
  priceEl.textContent = formatNumeric(price);
  const qtyEl = document.createElement('span');
  qtyEl.className = 'card-kit-row-ladder-qty';
  qtyEl.textContent = formatNumeric(quantity);
  el.appendChild(bar);
  el.appendChild(priceEl);
  if (changeValue !== undefined) el.appendChild(ChangeBadge({ key: changeKey, value: changeValue }));
  el.appendChild(qtyEl);
  return el;
}

const __exports = {
  // 순수 계산 — node --test 대상
  proportionalRatios,
  rangePosition,
  resolveStatusTone,
  ladderRatio,
  // DOM 빌더 — 렌더러(document 존재) 전용
  QuoteHeader,
  ChangeBadge,
  TabSwitcher,
  ProportionalBar,
  RangeBar,
  RankedRow,
  TwoLineRow,
  StatusPill,
  LadderRow,
};

// UMD 각주(2026-08-18 렌더러 격리) — facts-card.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.CardPrimitives = __exports;
}

})();
