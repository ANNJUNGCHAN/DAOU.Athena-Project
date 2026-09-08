// IIFE 스코프 격리(2026-08-18 렌더러 격리) — guard-confirm.js와 같은 UMD 패턴.
(function () {
'use strict';

const isNode = typeof module !== 'undefined' && module.exports;
const WatchNodes = isNode ? require('./watch-nodes') : window.AthenaLib.WatchNodes;
const FixCycle = isNode ? require('./watch-fix-cycle') : window.AthenaLib.WatchFixCycle;

// 검사 결과 카드(Paper 보드 10/446V-1)의 순수 계산 — DOM은 만들지 않는다
// (chat.js가 renderWatchCheckCard에서 조립). 백엔드 /routines/watch/check 응답을
// 사람이 읽는 문구로 바꾸는 로직만 여기 둔다 — routine-turn.js의 describeMode,
// guard-confirm.js의 guardConfirmBodyText와 같은 자리다.
//
// 문구 규칙(계획 R6·R8): 서술형 종결 금지, 단위는 한국어, 내부 용어 금지.
// 칩 이름은 R8이 못박은 「이 알람 승인」·「고칠 게 있어」 그대로 쓴다.

const COUNTED_UNTIL = '어제까지로 세었음 · 오늘은 진행 중';
const TAG_NEW = '새 알람';
const TAG_PASS = '검사 통과';
const TAG_FAIL = '검사 실패';
const CHIP_CONFIRM = '이 알람 승인';
const CHIP_REVISE = '고칠 게 있어';
const CHIP_RELINK = '폴더 다시 지정';

// 백엔드 runtime.code_watch_source_blocker의 「프로젝트 폴더 없음 — 다시 연결」만 참이다.
// 「프로젝트 없음 — 다시 선택」(등록 자체가 없음)은 폴더를 다시 지정해도 살지 않으니 제외.
function isProjectFolderMissing(text) {
  return /프로젝트 폴더 없음/.test(String(text || ''));
}

// 'YYYY-MM-DD' → '8/26'. 보드 10의 「마지막 8/26」 표기다. 파싱 실패는 원문
// 그대로 돌려준다 — 날짜를 지어내는 것보다 낫다(P3).
function shortDate(dt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dt || ''));
  if (!m) return String(dt || '').trim();
  return `${Number(m[2])}/${Number(m[3])}`;
}

// 노드 제목 줄 — 한국어 제목을 화살표로 잇는다. 한국어 제목이 없는 함수는
// 영어 함수명으로 대체한다(B-11의 앱 쪽 짝).
function nodeSummary(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const titles = list
    .map((n) => String((n && (n.title_ko || n.title_en || n.fn)) || '').trim())
    .filter((t) => t);
  return titles.join(' → ');
}

function lastFireDate(check) {
  if (check && check.last_fire) return check.last_fire;
  const fires = check && Array.isArray(check.fires) ? check.fires : [];
  if (!fires.length) return null;
  const last = fires[fires.length - 1];
  return (last && last.dt) || null;
}

/** 검사 응답 + 초안 행 → 카드 모델.
 * 실패(ok:false)면 승인 칩을 아예 내지 않는다 — 사람이 누를 수 없는 버튼을
 * 비활성으로 남겨 두는 것보다, 다음 행동(고치기) 하나만 보이는 게 낫다.
 */
function checkCardModel(check, draft) {
  const res = check || {};
  const row = draft || {};
  const ok = res.ok === true;
  const note = String(row.note || '').trim() || '새 알람';
  const lookback = Number(res.lookback_days);
  const lookbackText = Number.isFinite(lookback) && lookback > 0 ? lookback : 30;
  const count = Number(res.count);
  const countText = Number.isFinite(count) && count >= 0 ? count : 0;
  const last = lastFireDate(res);
  const fires = ok && Array.isArray(res.fires)
    ? res.fires.filter((fire) => fire && typeof fire.dt === 'string' && fire.dt.trim()) : [];
  // 캔버스와 같은 날짜 계산. 검사 마지막 날이 없으면 현재 날짜로 메우지 않는다.
  const fireDots = ok ? FixCycle.dotStrip({
    lookback_days: res.lookback_days, counted_through: res.counted_through,
    fires_after_dates: fires.map((fire) => fire.dt),
  }) : [];
  const fireRows = fires.map((fire) => `${shortDate(fire.dt)}${
    typeof fire.close === 'number' && Number.isFinite(fire.close)
      ? ` · 종가 ${WatchNodes.formatValue(fire.close)}` : ''
  }`);

  const nodes = Array.isArray(res.nodes) ? res.nodes : [];
  const summary = nodeSummary(nodes);
  const subtitle = nodes.length
    ? (summary ? `노드 ${nodes.length}개 · ${summary}` : `노드 ${nodes.length}개`)
    : '';

  const reason = ok ? '' : (
    String(res.reason || '').trim()
    || String((res.diagnosis && res.diagnosis.title) || '').trim()
    || '검사를 끝내지 못했음 — 다시 만들어 볼게'
  );

  const title = ok
    ? `${note} — 지난 ${lookbackText}일 ${countText}번${last ? ` · 마지막 ${shortDate(last)}` : ''}`
    : `${note} — 검사 실패`;

  // 실패 사유가 「프로젝트 폴더 없음」이면 고치기 앞에 「폴더 다시 지정」을 놓는다 —
  // 코드가 아니라 폴더 위치가 문제라, 다음 행동은 채팅이 아니라 폴더 고르기다.
  const chips = ok
    ? [
      { label: CHIP_CONFIRM, action: 'confirm', enabled: true },
      { label: CHIP_REVISE, action: 'revise', enabled: true },
    ]
    : [
      ...(isProjectFolderMissing(reason) ? [{ label: CHIP_RELINK, action: 'relink', enabled: true }] : []),
      { label: CHIP_REVISE, action: 'revise', enabled: true },
    ];

  return {
    tags: [TAG_NEW, ok ? TAG_PASS : TAG_FAIL],
    title,
    subtitle,
    countedUntil: String(res.counted_until || '').trim() || COUNTED_UNTIL,
    chips,
    failed: !ok,
    reason,
    fireDots,
    fireRows,
    // 구간 끝 날짜가 없으면 달력을 추정하지 않는다.
    dateWindowNote: ok && fires.length && !fireDots.length
      ? '검사 구간 날짜를 붙이지 못함 — 울린 날만 표시' : '',
  };
}

const __exports = {
  COUNTED_UNTIL, CHIP_CONFIRM, CHIP_REVISE, CHIP_RELINK,
  shortDate, nodeSummary, checkCardModel, isProjectFolderMissing,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.WatchCheckCard = __exports;
}

})();
