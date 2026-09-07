// IIFE 스코프 격리(2026-08-18 렌더러 격리) — watch-progress-card.js와 같은 UMD 패턴.
(function () {
'use strict';

// 새 알람 만들기 채팅 카드(Paper 보드 09 · 43WD-1 › 459N-1·459S-1·45A6-1)의
// 순수 계산 — DOM은 만들지 않는다(chat.js가 조립). 함수 이름 목록이 없으면
// 영수증을 만들지 않는다(개수를 지어내지 않는다).

const POLL_FOOTNOTE = '고르지 않고 그냥 말해도 됨 — "점심 지나서만 봐줘" 같은 문장도 그대로 반영';

const POLL_QUESTION = Object.freeze({
  kind: 'poll',
  tags: Object.freeze(['새 알람', '질문 2/3']),
  question: '언제 확인할까요? — 하나만 고르면 됩니다',
  choices: Object.freeze(['장중 1분마다', '장 마감 후 한 번']),
  footnote: POLL_FOOTNOTE,
});

const COOLDOWN_QUESTION = Object.freeze({
  kind: 'cooldown',
  tags: Object.freeze(['다음']),
  question: '얼마나 자주 울려도 될까요? — 쿨다운을 정합니다',
  choices: Object.freeze([]),
  footnote: POLL_FOOTNOTE,
});

function titlesOf(nodes) {
  return (Array.isArray(nodes) ? nodes : [])
    .map((name) => String(name || '').trim())
    .filter((name) => name);
}

function buildReceipt(nodes) {
  const titles = titlesOf(nodes);
  if (!titles.length) return null;
  const count = titles.length;
  return {
    badge: `+${count}`,
    title: `함수 ${count}개 만듦`,
    chain: titles.join(' → '),
    text: `함수 ${count}개 만듦 · ${titles.join(' → ')}`,
  };
}

const __exports = {
  POLL_QUESTION, COOLDOWN_QUESTION, POLL_FOOTNOTE,
  titlesOf, buildReceipt,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.WatchCreateCard = __exports;
}

})();
