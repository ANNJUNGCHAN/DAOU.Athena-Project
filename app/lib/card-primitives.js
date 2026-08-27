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

// 가격 표시 전용 — 키움 가격류 필드는 "부호가 포함된 숫자"로 문서화된다
// (backend/athena_api/generated/models.py 실측, 예: open_pric/high_pric/low_pric/
// cur_prc 등 다수). 그 부호는 값의 부호가 아니라 기준가 대비 등락 방향 표기다 —
// backend canvas_transform._parse_price가 이미 같은 근거로 lstrip('+-')한다(주석
// 원문: "부호 접두(+/-)는 등락 표기이지 값이 아니다"). QuoteHeader의 가격/RangeBar의
// 저가·고가처럼 "그 자체로 하나의 가격을 보여주는" 자리에서만 이 부호를 걷어낸다.
// ChangeBadge(등락 배지)는 절대 이걸 거치지 않는다 — 거기서는 부호가 changeTone
// 판정의 근거라 지우면 안 된다(2026-08-26 카드 데모 실측 후 팀리드 지시로 추가 —
// 처음엔 "종목정보 카드가 음수 저가를 그린다"를 값 자체가 이상하다고 오판해
// isValidPriceRange로 통째로 숨겼는데, 실은 정상 데이터를 잘못 해석한 표시 버그였다).
//
// 배치를 formatNumeric(facts-card.js) 전역이 아니라 여기 두는 이유: formatNumeric은
// ChangeBadge/facts-grid 등 "부호가 의미를 가지는" 문맥에서도 그대로 쓰인다 — 거기를
// 건드리면 등락 표시가 깨진다. 가격 전용 소비자(QuoteHeader/RangeBar, 이 파일)에만
// 좁혀 적용하는 게 안전하다.
function priceMagnitude(raw) {
  if (raw === null || raw === undefined) return raw;
  const text = String(raw).trim();
  const stripped = text.replace(/^[+-]/, '');
  return Number.isFinite(Number(stripped)) && stripped !== '' ? stripped : raw; // 파싱 안 되면 원문 그대로
}

// envelope.data.rows 존재 여부 확인 — table 모양 응답을 다루는 여러 카드종(공매도/
// 대차거래/신용거래/주문내역)에 반복되던 조각을 하나로 모음(2026-08-26 deslop).
// rows가 없거나 배열이 아니면 빈 배열 — 호출부가 바로 .map/.filter를 걸 수 있게 한다.
function extractDataRows(envelope) {
  return envelope && envelope.data && Array.isArray(envelope.data.rows) ? envelope.data.rows : [];
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

// 오브용 미니 차트(board-33④) 종가 라인 — 값 배열을 SVG 좌표(x,y)로 바꾼다.
// x는 인덱스 균등 배치, y는 min..max를 [0,height]에 선형 매핑(값이 클수록 위 —
// 그래서 y = height - 비율*height). 값이 전부 같으면(range 0) 세로 중앙에
// 수평선을 그린다. 점이 2개 미만이면 선을 그릴 수 없어 빈 배열(호출부가
// 차트를 아예 생략한다). DOM 없이 좌표 산수만 하는 순수 함수라 chart-card.js의
// "순수 변환 분리" 관행대로 node --test로 직접 검증한다 — SVG 엘리먼트
// 생성(createElementNS)은 렌더러(orb.js)의 몫이다.
function chartLinePoints(values, { width = 336, height = 116 } = {}) {
  // v != null 먼저 거른다 — Number(null)은 0(유한값)이라 필터를 그냥 통과해
  // 없는 데이터를 "0원"으로 지어내게 된다.
  const closes = (Array.isArray(values) ? values : [])
    .filter((v) => v != null && Number.isFinite(Number(v)))
    .map(Number);
  if (closes.length < 2) return [];
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min;
  const stepX = width / (closes.length - 1);
  return closes.map((v, i) => ({
    x: i * stepX,
    y: range === 0 ? height / 2 : height - ((v - min) / range) * height,
  }));
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
  priceEl.textContent = formatNumeric(priceMagnitude(price)); // 부호는 등락 방향 표기 — 가격 자체엔 안 붙인다
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
  // 부호 걷어내기 — 위치 계산(rangePosition)도 표시(formatNumeric)도 크기(절대값)
  // 기준이어야 한다(priceMagnitude 주석 참고). 여기서 한 번만 걷어내고 둘 다에 흘린다.
  const lowMag = priceMagnitude(low);
  const highMag = priceMagnitude(high);
  const valueMag = priceMagnitude(value);
  const el = document.createElement('div');
  el.className = 'card-kit-bar-range';
  const track = document.createElement('div');
  track.className = 'card-kit-bar-range-track';
  const position = rangePosition(lowMag, valueMag, highMag);
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
  lowEl.textContent = lowLabel != null ? lowLabel : formatNumeric(lowMag);
  const highEl = document.createElement('span');
  highEl.className = 'card-kit-bar-range-high';
  highEl.textContent = highLabel != null ? highLabel : formatNumeric(highMag);
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
  priceMagnitude,
  extractDataRows,
  chartLinePoints,
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
