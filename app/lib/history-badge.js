(function () {

// lineEl(질문 또는 답변 turn div)에 배지 하나를 붙인다. 기존 `.turn-meta`(트레이스
// 라인)가 있으면 거기 부속으로 넣고, 없으면(사용자 질문 줄) 새로 만든다 — 새 유리
// 레이어·토스트·모달·애니메이션은 추가하지 않는다(soul.md §7). innerHTML 미사용
// (textContent만, 함정 ⑪). 아직 문서에 붙지 않은 줄(비동기 레이스)에는 안 붙인다 —
// 호출부(createSaveFailedRouter)가 pending 처리로 그 경우를 흡수한다.
function appendSaveFailedBadge(lineEl) {
  if (!lineEl || !lineEl.isConnected) return false;
  let meta = lineEl.querySelector('.turn-meta');
  if (!meta) {
    meta = document.createElement('div');
    meta.className = 'turn-meta';
    lineEl.appendChild(meta);
  }
  const badge = document.createElement('span');
  badge.className = 'save-failed-badge';
  badge.textContent = '기록 안 됨';
  meta.appendChild(badge);
  return true;
}

// 실배선은 활성 질의가 항상 정확히 하나(main.js activeLiveQuery 선점 규칙)이므로,
// 턴마다 새로 구독/해제하지 않고 "지금 이 턴의 줄"만 가리키는 상태머신 하나로
// role:user/assistant 실패 이벤트를 해당 줄에 매칭한다. main은 role:user를
// 진입 직후, role:assistant를 응답 산출 직후 보내므로 assistant 실패가 aLine
// 생성보다 먼저 도착할 수 있다 — pendingAssistantBadge로 흡수한다.
function createSaveFailedRouter() {
  let currentUserLine = null;
  let currentAssistantLine = null;
  let pendingAssistantBadge = false;

  return {
    // 새 턴이 시작될 때(사용자 질문 줄이 막 만들어졌을 때) 호출한다.
    startTurn(qLine) {
      currentUserLine = qLine;
      currentAssistantLine = null;
      pendingAssistantBadge = false;
    },
    // 답변 줄이 문서에 완전히 붙은 뒤 호출한다.
    setAssistantLine(aLine) {
      currentAssistantLine = aLine;
      if (pendingAssistantBadge) {
        appendSaveFailedBadge(aLine);
        pendingAssistantBadge = false;
      }
    },
    // athena:history-save-failed 페이로드({messageId, role})를 받아 처리한다.
    handleFailure(payload) {
      const role = payload && payload.role;
      if (role === 'user') {
        appendSaveFailedBadge(currentUserLine);
      } else if (role === 'assistant') {
        if (currentAssistantLine) appendSaveFailedBadge(currentAssistantLine);
        else pendingAssistantBadge = true;
      }
    },
    // 테스트 전용 — 내부 상태 관찰.
    _debugState() {
      return { currentUserLine, currentAssistantLine, pendingAssistantBadge };
    },
  };
}

const __exports = { appendSaveFailedBadge, createSaveFailedRouter };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.HistoryBadge = __exports;
}

})();
