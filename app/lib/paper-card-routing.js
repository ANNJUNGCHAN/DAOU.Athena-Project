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

// 보드 표면이 가로채면 안 되는 봉투 — 앱 렌더러가 primary인 봉투.
// card-surface-implementation-plan.md D1: "예외 = 호가 사다리·AITS 차트(Paper 보드가 앱
// 렌더러를 담은 자리, 삭제 금지)". 보드가 앱 렌더러를 품는 길은 slots.json
// primary.renderer인데(2026-09-05 현재 32S7-0 하나만 선언), 나머지 보드는
// renderer=null이고 board-mount에도 마운트 경로가 없다. 그 상태로 가로채면
// 라이브 차트·호가 래더가 정적 Paper 목업으로 바뀐다(2026-09-04 병합 검증 실측).
//
// 판정 축은 recipe가 아니라 렌더러다. recipe는 제품 화면 종류라, 시세 op가 차트
// recipe를 빌려 쓰면(view_recipe_registry.OPERATION_RECIPE_OVERRIDES) 그대로 "앱
// 렌더러 보호"로 새어 들어가 그 봉투가 자기 Paper 보드를 영영 못 받는다
// (detail:ka10001:current_trading → 137X-2 상실, 2026-09-05 실측).
const APP_PRIMARY_RENDERERS = new Set(['aits-chart-v1']);

// renderer_id를 안 싣는 옛 봉투·픽스처 대비 안전망. 정본은
// backend/ref/kiwoom-common-screen-manifest.json에서 presentation.renderer_id가
// 'aits-chart-v1'인 전집합(19개)이고, 이 목록이 manifest와 어긋나면
// paper-card-routing.test.js가 깬다. 문자열 패턴으로 넓히지 않는다 —
// /^base:ka1008[1-5]$/는 차트가 아닌 ka10084·ka10085까지 삼켰다.
const APP_PRIMARY_CHART_OPS = new Set([
  'base:ka10079', 'base:ka10080', 'base:ka10081', 'base:ka10082', 'base:ka10083',
  'base:ka10094', 'base:ka20004', 'base:ka20005', 'base:ka20006', 'base:ka20007',
  'base:ka20008', 'base:ka20019', 'base:ka50079', 'base:ka50080', 'base:ka50081',
  'base:ka50082', 'base:ka50083', 'base:ka50091', 'base:ka50092',
]);

// 임시 예외 — 호가 사다리·주문 티켓 보드에는 아직 앱 렌더러를 품는 마운트 지점이
// 없다. 정본은 backend/ref/kiwoom-capability-assignment.json의 capability
// 'orderbook'(31개)·'order'(12개)이고, 이 두 목록이 그 파일과 어긋나면
// paper-card-routing.test.js가 깬다. card_title로는 대신할 수 없다 — 실제 값은
// 신용거래 주문 4종이 '신용거래', 호가 detail 3종이 '시세'라 예외에서 새고,
// 실시간 접수 통보(base:00)는 계좌 카드인데도 '주문'이라 자기 보드를 잃는다
// (2026-09-06 전수 대조 실측). 보드가 마운트 지점을 갖추면(계획서 C4) 이 두 집합과
// preservesAppPrimary 마지막 return을 함께 지운다(그 자리는 false가 된다).
const APP_PRIMARY_ORDERBOOK_OPS = new Set([
  'base:0C', 'base:0D', 'base:0E', 'base:ka50101', 'detail:ka10004:after_hours_totals',
  'detail:ka10004:aggregate_totals', 'detail:ka10004:buy_bid_changes',
  'detail:ka10004:buy_bid_prices', 'detail:ka10004:buy_bid_quantities',
  'detail:ka10004:sell_bid_changes', 'detail:ka10004:sell_bid_prices',
  'detail:ka10004:sell_bid_quantities', 'detail:ka10004:snapshot_time',
  'detail:ka10007:bid_changes', 'detail:ka10007:bid_prices', 'detail:ka10007:bid_quantities',
  'detail:ka10007:expected_market', 'detail:ka10007:identity',
  'detail:ka10007:liquidity_provider', 'detail:ka10007:order_counts',
  'detail:ka10007:session', 'detail:ka10007:totals', 'detail:ka10087:aggregate_totals',
  'detail:ka10087:buy_bid_changes', 'detail:ka10087:buy_bid_prices',
  'detail:ka10087:buy_bid_quantities', 'detail:ka10087:sell_bid_changes',
  'detail:ka10087:sell_bid_prices', 'detail:ka10087:sell_bid_quantities',
  'detail:ka10087:snapshot_time', 'detail:ka10087:trading_summary',
]);
const APP_PRIMARY_ORDER_OPS = new Set([
  'base:kt10000', 'base:kt10001', 'base:kt10002', 'base:kt10003', 'base:kt10006',
  'base:kt10007', 'base:kt10008', 'base:kt10009', 'base:kt50000', 'base:kt50001',
  'base:kt50002', 'base:kt50003',
]);

function preservesAppPrimary(envelope) {
  if (!envelope) return false;
  const renderer = typeof envelope.renderer_id === 'string' ? envelope.renderer_id : '';
  if (APP_PRIMARY_RENDERERS.has(renderer)) return true;
  // REST 직행 차트 봉투는 renderer_id가 비어 있어도 AITS가 primary다. 보드 HTML을
  // 먼저 붙이면 3초 paint ack를 넘긴다(실앱 live-full QA-CHART 실측).
  if (envelope.canvas_type === 'chart' && !envelope.fell_back) return true;
  const ref = operationRefOf(envelope);
  if (APP_PRIMARY_CHART_OPS.has(ref)) return true;
  return APP_PRIMARY_ORDERBOOK_OPS.has(ref) || APP_PRIMARY_ORDER_OPS.has(ref);
}
function blockedReason(envelope) {
  return `카드 계약이 없는 키움 응답이다 — ${operationRefOf(envelope)}. 범용 카드로 대체하지 않는다.`;
}

const __exports = {
  isKiwoomEnvelope, operationRefOf, paperCardRoute, blockedReason, preservesAppPrimary,
  APP_PRIMARY_RENDERERS, APP_PRIMARY_CHART_OPS,
  APP_PRIMARY_ORDERBOOK_OPS, APP_PRIMARY_ORDER_OPS,
};

// UMD 각주(2026-08-18 렌더러 격리) — card-kinds.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.PaperCardRouting = __exports;
}

})();
