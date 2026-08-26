// IIFE 스코프 격리(2026-08-18 렌더러 격리) — facts-card.js/column-fold.js와 같은 문법.
//
// 카드 v3(.omc/state/card-v3-plan.md §2.1) 카드종 레지스트리 — card_title(Paper 16종
// 고정 이름 중 하나) → 전용 body 렌더 함수. canvas.js의 3대 범용 렌더러
// (renderFactsCard/renderMcpTable/renderCompoundCard)가 title을 이미 계산한 뒤
// resolve()로 조회한다 — 새 canvas_type이나 새 makeCard 변형은 만들지 않는다(§2).
//
// all-or-nothing 계약: register()로 등록하는 renderFn은 (envelope) => HTMLElement | null
// 시그니처다. 특수 레이아웃에 필요한 핵심 필드가 envelope에 없으면 반드시 null을
// 돌려준다 — 절반만 그리다 만 카드를 만들지 않는다. null이면 호출부(canvas.js 후킹
// 지점)가 기존 범용 body 빌드 코드로 그대로 폴백한다(§2.2/§4-2).
(function () {
'use strict';

const registry = new Map();

function register(title, renderFn) {
  registry.set(title, typeof renderFn === 'function' ? renderFn : () => null);
}

function resolve(title) {
  if (!title) return undefined;
  return registry.get(title);
}

const __exports = { register, resolve };

// UMD 각주(2026-08-18 렌더러 격리) — facts-card.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.CardKinds = __exports;
}

})();
