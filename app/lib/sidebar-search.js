// 사이드바 검색 결과 패널의 순수 계산 — DOM은 만들지 않는다(lib/sidebar.js가
// 조립한다). lib/sidebar-mode-nav.js와 같은 규율이다.
//
// Paper 2V27-1 검색 패널이 요구하는 것은 세 가지다: 그룹 머리에 **건수**,
// 행 오른쪽에 **언제**, 발치에 **키보드 안내와 총 건수**. 결과가 없는 그룹은
// 만들지 않는다 — 「캔버스 카드 0건」은 지어낸 문장이다.
(function () {
'use strict';

const HINT = '↑↓ 이동 · Enter 열기 · Esc 닫기';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

// Paper가 쓰는 상대시각은 `오늘 HH:MM`과 `어제` 둘이다. 그보다 오래된 것은
// 상대시각으로 말할 수 없으므로 실제 날짜를 그대로 낸다(지어내지 않는다).
function relativeWhen(iso, now) {
  const at = new Date(iso);
  const base = new Date(now);
  if (Number.isNaN(at.getTime()) || Number.isNaN(base.getTime())) return null;
  if (sameDay(at, base)) return `오늘 ${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  const yesterday = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1);
  if (sameDay(at, yesterday)) return '어제';
  return `${at.getMonth() + 1}월 ${at.getDate()}일`;
}

function matches(text, needle) {
  return String(text == null ? '' : text).toLowerCase().includes(needle);
}

function buildSearchResults(input) {
  const src = input || {};
  const query = String(src.query == null ? '' : src.query).trim().toLowerCase();
  if (!query) return { groups: [], total: 0, hint: HINT };

  const conversations = Array.isArray(src.conversations) ? src.conversations : [];
  const cards = Array.isArray(src.cards) ? src.cards : [];
  const now = src.now == null ? Date.now() : src.now;

  const conversationRows = conversations
    .filter((conversation) => conversation && matches(conversation.title, query))
    .map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      when: relativeWhen(conversation.updatedAt, now),
    }));
  // 캔버스 카드는 지금 보고 있는 대화의 카드다 — 그래서 언제는 늘 `이 대화`다.
  const cardRows = cards
    .filter((card) => card && matches(card.title, query))
    .map((card) => ({ id: card.id || null, title: card.title, when: '이 대화' }));

  const groups = [];
  if (conversationRows.length) groups.push({ kind: 'conversation', label: `대화 ${conversationRows.length}건`, rows: conversationRows });
  if (cardRows.length) groups.push({ kind: 'card', label: `캔버스 카드 ${cardRows.length}건`, rows: cardRows });

  return {
    groups,
    total: groups.reduce((sum, group) => sum + group.rows.length, 0),
    hint: HINT,
  };
}

const __exports = { buildSearchResults, relativeWhen, HINT };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.SidebarSearch = __exports;
}

})();
