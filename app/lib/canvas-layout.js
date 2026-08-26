// IIFE 스코프 격리(2026-08-18 렌더러 격리) — <script> 태그는 top-level const/function을
// 문서 전체가 공유하는 하나의 스크립트 스코프에 넣는다(require()의 모듈별 격리와 다르다).
// el/sanitize 같은 흔한 이름이 파일 간에 충돌해 SyntaxError가 났다(실측, diag-isolation.js).
// CJS(require)는 이 IIFE 밖에서도 동일하게 동작한다 — Node의 모듈 래퍼가 이미 함수 스코프다.
(function () {
'use strict';

// 규칙 1 — 형상별 폭 문법(결정적 기본값). 컴팩트 형상은 반폭, 넓은 형상은 전폭.
// notice는 에러 안내라 전폭(현행 실측 유지). 미지 형상은 전폭 — 모르는 데이터의
// 최후 착지점이 자유 카드(전폭)인 것과 같은 방향의 보수적 기본값이다.
const WIDTH_GRADES = ['half', 'full'];
// facts(P4) — F1/F2 둘 다 key/value 그리드라 stream/reader와 같은 컴팩트 반폭.
// 1560px 캔버스에서 반폭(~752px)이면 F2의 2단 그룹도 나란히 여유 있게 들어간다.
// compound(P4) — 헤더 밴드 + 표 1개라 table/mcp-table과 같은 전폭.
const CARD_WIDTH_GRADE = {
  stream: 'half',
  reader: 'half',
  table: 'full',
  'mcp-table': 'full',
  chart: 'full',
  free: 'full',
  notice: 'full',
  facts: 'half',
  compound: 'full',
  event: 'full',
  action: 'half',
  status: 'half',
};

// 규칙 2 — AI 개입은 폭 등급 승격·강등만. 유효하지 않은 힌트는 조용히 문법
// 기본값으로 폴백한다 — 배치는 힌트가 있든 없든 항상 결정적이고 설명 가능하다.
function widthGradeFor(type, layoutHint) {
  if (WIDTH_GRADES.includes(layoutHint)) return layoutHint;
  return CARD_WIDTH_GRADE[type] || 'full';
}

// 규칙 3 — 턴별 큐레이션의 드롭 대상. 봉투 drop_types(canvas_type 목록)를
// 렌더러 카드 클래스로 푼다. 'table'은 픽스처 table과 실배선 mcp-table 둘 다.
// timeline은 아직 카드 분기 자체가 없다(plan.md 다음 수 6) — 빈 목록.
const DROP_TYPE_MAP = {
  stream: ['stream'],
  reader: ['reader'],
  table: ['table', 'mcp-table'],
  chart: ['chart'],
  free: ['free'],
  timeline: [],
  facts: ['facts'],
  compound: ['compound'],
  event: ['event'],
  action: ['action'],
  status: ['status'],
};

function dropTargetsFor(dropTypes) {
  if (!Array.isArray(dropTypes)) return [];
  const out = [];
  for (const t of dropTypes) {
    for (const cls of DROP_TYPE_MAP[t] || []) {
      if (!out.includes(cls)) out.push(cls);
    }
  }
  return out;
}

// 규칙 4 — 높이 예산 안전망. 총높이 ≤ 뷰포트 HEIGHT_BUDGET_FACTOR배(스크롤 한 번
// 깊이), 단 MIN_CARDS장까지는 예산과 무관하게 보장(soul.md §5-2 "카드 3개가
// 동시에 살 수 있다"). clientHeight가 0이면(창이 접혀 측정 불가) 제거하지
// 않는다 — 잘못 재서 카드를 지우는 것보다 안 지우는 쪽이 싸다(fail-safe).
const HEIGHT_BUDGET_FACTOR = 2;
const MIN_CARDS = 3;

function exceedsHeightBudget(scrollHeight, clientHeight, cardCount) {
  if (cardCount <= MIN_CARDS) return false;
  if (!(clientHeight > 0)) return false;
  return scrollHeight > HEIGHT_BUDGET_FACTOR * clientHeight;
}

const __exports = {
  MIN_CARDS,
  widthGradeFor,
  dropTargetsFor,
  exceedsHeightBudget,
};

// UMD 각주(2026-08-18 렌더러 격리) — sanitize.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.CanvasLayout = __exports;
}

})();
