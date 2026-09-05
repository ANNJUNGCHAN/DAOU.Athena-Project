// IIFE 스코프 격리(2026-08-18 렌더러 격리) — sidebar-mode-nav.js와 같은 패턴.
(function () {
'use strict';

// 사이드바 프로젝트 행의 "무엇을 보일까"만 정한다 — DOM은 한 줄도 만들지 않는다.
// 그리는 몫은 sidebar.js이고, 여기 있는 것은 전부 순수 함수라 렌더러 없이
// node:test로 검증된다(session-history-view.js와 같은 자리).
//
// 37번 보드가 확정한 것 둘:
//   · ⋯ 는 셋뿐이다(고정·탐색기에서 열기·프로젝트 제거). 편집·작업 트리·보관은 없다.
//   · 제거는 폴더를 지우는 영구 삭제라 이름을 그대로 다시 쳐야 열린다.
// 38번 보드가 확정한 것 하나: 펜은 "프로젝트 수정"이 아니라 새 대화창이고,
// 어느 모드로 열지를 사람이 고른다.

// 모드 어휘(레코드) → 화면 어휘(view). 다리의 주인은 session-snapshot.js지만
// 그 모듈은 chat↔summary 한 쌍만 안다 — 여기서는 고를 다섯을 순서대로 나열할
// 뿐이라 그 매핑을 다시 계산하지 않고 표로 적는다.
const MODE_CHOICES = Object.freeze([
  Object.freeze({ mode: 'chat', view: 'summary', label: '대화', hint: '결과 카드가 쌓이는 기본 창' }),
  Object.freeze({ mode: 'graph', view: 'graph', label: '그래프', hint: '성향·엔티티·근거를 보는 지도' }),
  Object.freeze({ mode: 'agent', view: 'agent', label: '에이전트', hint: '감시·예약 작업을 관제' }),
  Object.freeze({ mode: 'plugin', view: 'plugin', label: '플러그인', hint: '설치·권한·MCP 캔버스' }),
  Object.freeze({ mode: 'backtest', view: 'backtest', label: '백테스트', hint: '전략 폼·코드·결과 캔버스' }),
]);

const DEFAULT_PROJECT_ID = 'default'; // conversations.js DEFAULT_PROJECT_ID와 같은 값.

// 비활성은 이유를 함께 낸다 — 왜 못 누르는지 없이 회색으로만 두면 사람이 고장으로 읽는다.
// 항목마다 결과를 한 줄로 붙인다(37번 보드 "메뉴를 늘리지 않는 대신, 셋 각각의 결과를
// 분명히 적는다") — 고정만 순서를 되돌리는 쪽 문장이 따로 있다.
function menuItemsFor(project) {
  const row = project || {};
  return [
    {
      key: 'pin',
      label: row.pinned ? '고정 해제' : '최상단 고정',
      hint: row.pinned ? '목록 맨 위에서 내립니다' : '목록 맨 위에 붙여 둡니다',
    },
    {
      key: 'reveal',
      label: '탐색기에서 열기',
      hint: '이 프로젝트 폴더를 창으로 엽니다',
      disabled: !row.path,
      reason: '폴더가 연결되지 않은 프로젝트입니다',
    },
    {
      key: 'remove',
      label: '프로젝트 제거',
      hint: '폴더와 그 안의 파일을 지웁니다',
      danger: true,
      disabled: row.id === DEFAULT_PROJECT_ID,
      reason: '기본 프로젝트는 지울 수 없습니다',
    },
  ];
}

function modeChoices() {
  return MODE_CHOICES.map((choice) => ({ ...choice }));
}

// 이름이 정확히 같을 때만 연다. 앞뒤 공백만 털고(입력창에서 흔한 실수) 그 외의
// 관대함은 없다 — main.js athena:project-remove의 판정과 같은 규칙이라야
// 화면에서 열린 버튼이 백엔드에서 name_mismatch로 튕기지 않는다.
function removeConfirmState(project, typed) {
  const label = (project && typeof project.label === 'string') ? project.label : '';
  const input = typeof typed === 'string' ? typed.trim() : '';
  if (label && input === label) return { canRemove: true, hint: '' };
  return { canRemove: false, hint: `"${label}"를 그대로 입력해야 지울 수 있습니다` };
}

const __exports = { MODE_CHOICES, menuItemsFor, modeChoices, removeConfirmState };

// UMD 각주(2026-08-18 렌더러 격리) — sidebar-mode-nav.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.SidebarProjectMenu = __exports;
}

})();
