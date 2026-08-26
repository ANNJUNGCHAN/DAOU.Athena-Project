// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 에이전트모드 사이드바의 "작업·알람" 행 — 순수 포매팅/상태아이콘 로직만 갖는다
// (Paper 보드 39 보강본·44 원칙3). DOM은 만들지 않는다 — 그 몫은 sidebar.js다
// (기존 makeConversationItem/makeNotifyItem과 같은 자리). GET /api/v1/routines
// 실데이터를 입력으로 받는다 — 이 파일 자체는 IPC를 모른다(DI).
//
// 어떤 상태를 "우선 노출"할 것인가: active(+실시간 여부)·paused만이다.
// draft/expired/cancelled/failed는 이 사이드바가 다룰 "지금 진행 중인" 일이
// 아니다(P3 — 죽은 상태를 살아있는 것처럼 나열하지 않는다). draft 초안 행은
// 8단계(새 작업은 채팅에서)가 별도로 다룬다.

const STATUS_ICON = {
  activeRealtime: { glyph: '●', colorVar: '--color-info', label: '실시간 감시' },
  activePeriodic: { glyph: '●', colorVar: '--color-ok', label: '활성' },
  paused: { glyph: '❚❚', colorVar: '--color-warn', label: '일시중지' },
};

// 라우틴 하나의 상태 아이콘 명세. 우선 노출 대상이 아니면 null.
function statusIconFor(routine) {
  if (!routine) return null;
  if (routine.status === 'paused') return STATUS_ICON.paused;
  if (routine.status === 'active') {
    return routine.mode === 'realtime-ws' ? STATUS_ICON.activeRealtime : STATUS_ICON.activePeriodic;
  }
  return null;
}

function isPriorityRoutine(routine) {
  return statusIconFor(routine) !== null;
}

// routines 배열(athena:routines-list 응답의 data.routines) → 사이드바 행 배열.
// 제목은 백엔드가 이미 만든 note(사람이 읽는 해석문)를 그대로 쓴다 — 여기서
// 새로 지어내지 않는다.
function buildAgentSidebarRows(routines) {
  const list = Array.isArray(routines) ? routines : [];
  return list
    .filter(isPriorityRoutine)
    .map((r) => ({
      id: r.id,
      title: r.note || r.symbol || r.id,
      icon: statusIconFor(r),
    }));
}

const __exports = { STATUS_ICON, statusIconFor, isPriorityRoutine, buildAgentSidebarRows };

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.AgentSidebarList = __exports;
}

})();
