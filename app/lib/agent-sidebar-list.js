// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 에이전트모드 사이드바의 "작업·알람" 행 — 순수 포매팅/상태아이콘 로직만 갖는다
// (Paper 보드 39 보강본·44 원칙3). DOM은 만들지 않는다 — 그 몫은 sidebar.js다
// (기존 makeConversationItem/makeNotifyItem과 같은 자리). GET /api/v1/routines
// 실데이터를 입력으로 받는다 — 이 파일 자체는 IPC를 모른다(DI).
//
// 어떤 상태를 "우선 노출"할 것인가: active(+실시간 여부)·paused·draft다.
// expired/cancelled/failed는 이 사이드바가 다룰 "지금 진행 중인" 일이
// 아니다(P3 — 죽은 상태를 살아있는 것처럼 나열하지 않는다). draft 초안 행은
// 8단계(새 작업은 채팅에서)가 여기서 다룬다 — ◌ 점선 핑크(Paper 보드 43 실측).

const STATUS_ICON = {
  activeRealtime: { glyph: '●', colorVar: '--color-info', label: '실시간 감시' },
  activePeriodic: { glyph: '●', colorVar: '--color-ok', label: '활성' },
  // 3단계(사실11⑤) — schedule.daily 예약이 활성화됐을 때 periodic 감시와
  // 구분되는 전용 아이콘. 색은 periodic과 같게 두되(39번 리스트 쪽은 라벨
  // 텍스트로도 구분된다) 라벨을 "예약"으로 갈라 사이드바에서 혼동을 막는다.
  activeScheduled: { glyph: '●', colorVar: '--color-ok', label: '예약' },
  paused: { glyph: '❚❚', colorVar: '--color-warn', label: '일시중지' },
  draft: { glyph: '◌', colorVar: '--color-brand', label: '초안' },
};

// 라우틴 하나의 상태 아이콘 명세. 우선 노출 대상이 아니면 null.
function statusIconFor(routine) {
  if (!routine) return null;
  if (routine.status === 'draft') return STATUS_ICON.draft;
  if (routine.status === 'paused') return STATUS_ICON.paused;
  if (routine.status === 'active') {
    if (routine.mode === 'realtime-ws') return STATUS_ICON.activeRealtime;
    if (routine.mode === 'scheduled') return STATUS_ICON.activeScheduled;
    return STATUS_ICON.activePeriodic;
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

// 알림 방 하이드레이션(7단계, F3-FE) — GET /api/v1/routines 응답의
// last_fired_at·unread(6단계, read-marks 단일 패스 집계)로 sidebar.js의
// notifyRooms(세션 메모리, 재시작하면 원래 비었다)를 다시 채운다. 한 번이라도
// 발화한(last_fired_at이 있는) 라우틴만 대상이고, read는 백엔드의 unread를
// 그대로 뒤집는다 — 이 함수 자신은 read-marks를 다시 계산하지 않는다(P4, 단일
// 소유자는 여전히 백엔드다). sub는 실시간 이벤트 필드(symbol·observed)가
// 요약 뷰엔 없어 빈 문자열로 정직하게 둔다(handleRoutineEvent의 sub와 달리
// 지어낼 근거가 없다, P3). 결과는 최신 발화 먼저로 정렬한다(handleRoutineEvent가
// unshift로 쌓는 순서와 같다).
function buildHydratedRooms(routines) {
  const list = Array.isArray(routines) ? routines : [];
  return list
    .filter((r) => r && typeof r.last_fired_at === 'string')
    .map((r) => ({
      id: r.id,
      title: r.note || r.symbol || r.id,
      sub: '',
      firedAt: Date.parse(r.last_fired_at),
      read: !r.unread,
      // 알람 센터(Paper 보드 02)가 갈래별 아이콘을 고를 때 쓴다 — 실시간
      // 이벤트 경로(handleRoutineEvent)가 event.mode로 넣는 것과 같은 값이다.
      mode: typeof r.mode === 'string' ? r.mode : '',
    }))
    .filter((r) => Number.isFinite(r.firedAt))
    .sort((a, b) => b.firedAt - a.firedAt);
}

const __exports = {
  STATUS_ICON, statusIconFor, isPriorityRoutine, buildAgentSidebarRows, buildHydratedRooms,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.AgentSidebarList = __exports;
}

})();
