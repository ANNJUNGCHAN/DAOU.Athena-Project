// IIFE 스코프 격리(2026-08-18 렌더러 격리) — card-kinds.js/facts-card.js와 같은 문법.
//
// Paper 카드 전용 배선 판정 — canvas.js의 addLiveCard가 봉투 하나를 어느 표면으로
// 보낼지 정하는 규칙을 한 곳에 모은다. canvas.js는 shell.html 안에서만 도는 렌더러
// 스크립트라 node --test로 못 잡는다. 그래서 "어떤 봉투가 레거시 범용 카드로
// 떨어져도 되는가"라는 이 프로젝트의 핵심 계약만 여기로 떼어내 단위 테스트한다.
//
// 계약: 키움 봉투(canonical operation_ref를 실은 봉투)는 CC-01..CC-06 통합 카드나
// semantic workspace로만 그린다. 백엔드 canvas_push가 canonical operation_ref에
// 대해 항상 카드 계약을 파생해 붙이므로(backend/athena_api/api/canvas_push.py),
// 키움 봉투인데 계약이 없다면 그건 회귀다 — 조용히 범용 표로 대체하지 않고
// 'blocked'을 돌려 호출부가 원인을 드러내게 한다.
(function () {
'use strict';

function operationRefOf(envelope) {
  if (!envelope) return '';
  const ref = envelope.operation_ref;
  return typeof ref === 'string' ? ref.trim() : '';
}

// 키움 파이프라인에서 온 봉투인가. operation_ref가 유일한 판별자다 — card_id는
// 계약이 붙은 뒤에만 생기므로 여기서 쓰면 순환 판정이 된다.
function isKiwoomEnvelope(envelope) {
  return Boolean(operationRefOf(envelope));
}

// 'integrated' | 'workspace' | 'blocked' | 'generic'
function paperCardRoute(envelope, surfaces) {
  if (!envelope) return 'generic';
  const integrated = surfaces && surfaces.integratedCardSurface;
  const workspace = surfaces && surfaces.semanticWorkspace;
  if (integrated && integrated.integratedDefinition(envelope)) return 'integrated';
  if (workspace && workspace.isTaskCanvasEnvelope(envelope)) return 'workspace';
  if (isKiwoomEnvelope(envelope)) return 'blocked';
  return 'generic';
}

function blockedReason(envelope) {
  return `카드 계약이 없는 키움 응답이다 — ${operationRefOf(envelope)}. 범용 카드로 대체하지 않는다.`;
}

const __exports = { isKiwoomEnvelope, operationRefOf, paperCardRoute, blockedReason };

// UMD 각주(2026-08-18 렌더러 격리) — card-kinds.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.PaperCardRouting = __exports;
}

})();
