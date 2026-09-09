(() => {
'use strict';

const ROOT_BOARD = '13K0-2';
const AFTER_HOURS_BOARD = '2YNQ-0';
const FILTER_BOARDS = Object.freeze({
  '4A9H-1': 'market',
  '4AGN-1': 'direction',
  '4ANS-1': 'marketCap',
  '4AUX-1': 'liquidity',
});
const FAMILY = new Set([
  ROOT_BOARD, AFTER_HOURS_BOARD,
  '4A9H-1', '4AGN-1', '4ANS-1', '4AUX-1', '4B22-1',
  '2X5N-0', '2XG6-0', '2XKO-0', '2XP6-0',
  '2XTO-0', '2YA8-0', '2YEQ-0', '2YJ8-0',
]);

const SELECTIONS = Object.freeze({
  '4A9H-1': Object.freeze({
    KOSPI: Object.freeze({ criteria: { market: '001' } }),
    KOSDAQ: Object.freeze({ criteria: { market: '101' } }),
    'KRX 전체': Object.freeze({ criteria: { market: '000' } }),
  }),
  '4AGN-1': Object.freeze({
    '등락 전체': Object.freeze({ criteria: { direction: 'all' } }),
    상승만: Object.freeze({ criteria: { direction: 'up' }, boardId: '2XKO-0' }),
    하락만: Object.freeze({ criteria: { direction: 'down' }, boardId: '2XKO-0' }),
  }),
  // 현재 순위 TR에는 시가총액 조건도 시가총액 값도 없다. 항목은 클릭에 응답하되
  // 결과가 걸러졌다고 꾸미지 않고, 지원하지 않는 이유를 화면에 분명히 알린다.
  '4ANS-1': Object.freeze({
    '시가총액 전체': Object.freeze({ criteria: { marketCap: 'all' } }),
    대형주: Object.freeze({ unavailable: '현재 종목 찾기 조회는 시가총액 조건을 지원하지 않습니다.' }),
    '중·소형주': Object.freeze({ unavailable: '현재 종목 찾기 조회는 시가총액 조건을 지원하지 않습니다.' }),
  }),
  '4AUX-1': Object.freeze({
    '유동성 정상': Object.freeze({ criteria: { liquidity: 'normal' } }),
    '관리·경고 제외': Object.freeze({ criteria: { liquidity: 'normal' } }),
    '전체 포함': Object.freeze({ criteria: { liquidity: 'all' } }),
  }),
});

function isFamilyBoard(boardId) {
  return FAMILY.has(String(boardId || ''));
}

function isFilterBoard(boardId) {
  return Object.prototype.hasOwnProperty.call(FILTER_BOARDS, String(boardId || ''));
}

function linksFor(boardId, links) {
  const source = Array.isArray(links) ? links.filter(Boolean) : [];
  if (!isFamilyBoard(boardId)) return source;
  const additions = [
    { control: '거래대금', board_id: ROOT_BOARD },
    { control: '정규장', board_id: ROOT_BOARD },
    { control: '시간외 단일가', board_id: AFTER_HOURS_BOARD },
    { control: 'KOSPI', board_id: '4A9H-1' },
    { control: '등락 전체', board_id: '4AGN-1' },
    { control: '시가총액 전체', board_id: '4ANS-1' },
    { control: '유동성 정상', board_id: '4AUX-1' },
  ];
  const out = source.slice();
  const seen = new Set(out.map((link) => `${link.control}\u0000${link.board_id}`));
  for (const link of additions) {
    const key = `${link.control}\u0000${link.board_id}`;
    if (!seen.has(key)) out.push(link);
  }
  return out;
}

function initialCriteria(target, boardId = ROOT_BOARD) {
  const source = target && typeof target === 'object' && !Array.isArray(target) ? target : {};
  const includesAll = String(boardId) === ROOT_BOARD
    ? String(source.mang_stk_incls) === '1'
    : String(source.mang_stk_incls) === '0';
  return {
    market: ['000', '001', '101'].includes(String(source.mrkt_tp))
      ? String(source.mrkt_tp) : '001',
    direction: 'all',
    liquidity: includesAll ? 'all' : 'normal',
    session: String(source.mrkt_open_tp) === '3' ? 'afterHours' : 'regular',
  };
}

function targetFor(target, criteria, boardId) {
  const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  const selected = criteria || initialCriteria(out, boardId);
  out.mrkt_tp = selected.market || '001';
  // ka10030의 포함값은 0, ka10032의 포함값은 1이다. 서로 뜻이 반대라서
  // 현재 보드가 실제로 쓰는 TR 기준으로만 보낸다.
  if (String(boardId) === ROOT_BOARD) {
    out.mang_stk_incls = selected.liquidity === 'all' ? '1' : '0';
  } else {
    out.mang_stk_incls = selected.liquidity === 'all' ? '0' : '1';
  }
  if (String(boardId) === '2XKO-0') {
    out.sort_tp = selected.direction === 'down' ? '3' : '1';
  }
  if (String(boardId) === '2X5N-0' || isFilterBoard(boardId)) {
    out.mrkt_open_tp = selected.session === 'afterHours' ? '3' : '1';
  }
  return out;
}

function selectionFor(boardId, label) {
  const selections = SELECTIONS[String(boardId || '')];
  return selections ? selections[String(label || '').trim()] || null : null;
}

function selectionLabels(boardId) {
  return Object.keys(SELECTIONS[String(boardId || '')] || {});
}

function selectionOwner(surface, label) {
  if (!surface || typeof surface.querySelectorAll !== 'function') return null;
  for (const node of surface.querySelectorAll('*')) {
    if (node.childElementCount !== 0 || String(node.textContent || '').trim() !== label) continue;
    const row = typeof node.closest === 'function' ? node.closest('[data-name^="줄 ·"]') : null;
    if (row) return row;
  }
  return null;
}

function criteriaAfter(criteria, selection) {
  return { ...(criteria || {}), ...((selection && selection.criteria) || {}) };
}

function transitionFor(control, targetBoard, currentBoard, returnBoard) {
  const label = String(control || '').trim();
  if (label === '정규장') {
    return { boardId: returnBoard && !isFilterBoard(returnBoard) && returnBoard !== AFTER_HOURS_BOARD
      ? returnBoard : ROOT_BOARD,
      criteria: { session: 'regular' } };
  }
  if (label === '시간외 단일가') {
    return { boardId: AFTER_HOURS_BOARD, criteria: { session: 'afterHours' } };
  }
  if (isFilterBoard(targetBoard)) {
    return { boardId: String(targetBoard), returnBoard: String(currentBoard || ROOT_BOARD) };
  }
  return { boardId: String(targetBoard || '') };
}

const exports_ = {
  ROOT_BOARD, AFTER_HOURS_BOARD, FILTER_BOARDS,
  isFamilyBoard, isFilterBoard, linksFor, initialCriteria, targetFor,
  selectionFor, selectionLabels, selectionOwner, criteriaAfter, transitionFor,
};

if (typeof module !== 'undefined' && module.exports) module.exports = exports_;
else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.RankingBoardControls = exports_;
}
})();
