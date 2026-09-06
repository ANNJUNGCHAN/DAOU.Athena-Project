// IIFE 스코프 격리(2026-08-18 렌더러 격리) — watch-check-card.js와 같은 UMD 패턴.
(function () {
// 자동 검사 진행 패널(Paper 보드 09 · 43WD-1 › 458M-1)의 순수 계산 — DOM은 만들지
// 않는다(chat.js가 조립). 「코드가 바뀔 때마다」 다섯 줄이 무엇을 확인했는지 말하고,
// 발치에 안전 고지가 상수로 붙는다.
//
// 규율: 실값이 없는 줄은 만들지 않는다(지어내기 금지). 마크는 세 종류뿐이다 —
// ✓ 끝남 · ◐ 도는 중 · ○ 아직.
'use strict';

const MARK_DONE = '✓';
const MARK_RUNNING = '◐';
const MARK_PENDING = '○';

const HEAD_LEFT = '자동 검사';
const HEAD_RIGHT = '코드가 바뀔 때마다';

// 4597-1 원문. 검사는 계좌·주문에 손대지 않는 격리 실행이라는 사실은 백엔드
// 응답이 없어도 참이다 — 그래서 상수로 고정한다(지어낸 값이 하나도 없다).
const SANDBOX_NOTICE = '격리 실행 · 계좌·주문 접근 없음 · 30초 제한';

// 검사는 완성 봉(어제까지)에만 돈다 — 오늘 값으로 도는 1회는 켠 뒤 장중에 일어난다.
// 그래서 3/3은 검사 결과가 어떻든 늘 ○다(counted_until 계약과 같은 사실).
const LINE_TODAY = '검사 3/3 — 오늘 값으로 1회 실행';

function nodeNames(nodes) {
  return (Array.isArray(nodes) ? nodes : [])
    .map((n) => String((n && (n.title_ko || n.title_en || n.fn)) || '').trim())
    .filter((t) => t)
    .join(' · ');
}

function secondsText(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '';
  return `${(value / 1000).toFixed(1)}초`;
}

/** 검사 응답(또는 아직 도는 중) → 진행 패널 모델.
 *
 * `check`가 없거나 `pending`이면 도는 중이다 — 그때는 앞 두 줄에 쓸 값도 아직
 * 없을 수 있으므로, 부르는 쪽이 아는 것(symbol · lookback_days)만 넘긴다.
 */
function buildProgress(check) {
  const res = (check && typeof check === 'object') ? check : {};
  const pending = res.pending === true;
  const failed = !!res.error || (!pending && res.ok !== true);
  const lines = [];

  const symbol = String(res.symbol || '').trim();
  const lookback = Number(res.lookback_days);
  const hasLookback = Number.isFinite(lookback) && lookback > 0;
  // 458T-1 — 무엇을 넣고 돌렸는가. 종목·기간을 모르면 이 줄을 만들지 않는다.
  if (symbol && hasLookback) {
    lines.push({ mark: MARK_DONE, text: `입력 확인 — ${symbol} · 최근 ${lookback}일 일봉` });
  }

  // 458W-1 — 코드에서 잘라낸 함수. 노드가 없으면 개수를 지어내지 않는다.
  const nodes = Array.isArray(res.nodes) ? res.nodes : [];
  if (nodes.length) {
    const names = nodeNames(nodes);
    lines.push({
      mark: MARK_DONE,
      text: `함수 ${nodes.length}개 만듦${names ? ` — ${names}` : ''}`,
    });
  }

  // 458Z-1 — 코드가 돌았는가(문법·금지 명령·격리). 도는 중이면 ◐, 못 돌았으면 ○.
  lines.push({
    mark: pending ? MARK_RUNNING : (failed && res.error ? MARK_PENDING : MARK_DONE),
    text: '검사 1/3 — 문법 통과 · 금지 명령 없음 · 격리 실행',
  });

  // 4592-1 — 지난 N일을 돌려 본다. 끝났으면 걸린 시간을 한국어 단위로 적는다.
  const span = hasLookback ? `지난 ${lookback}일` : '지난 구간';
  if (pending) {
    lines.push({ mark: MARK_RUNNING, text: `검사 2/3 — ${span} 돌려 보는 중` });
  } else if (failed) {
    lines.push({ mark: MARK_PENDING, text: `검사 2/3 — ${span} 돌려 보기` });
  } else {
    const took = secondsText(res.duration_ms);
    lines.push({
      mark: MARK_DONE,
      text: `검사 2/3 — ${span} 돌려 봄${took ? ` · ${took}` : ''}`,
    });
  }

  // 4595-1 — 오늘 값으로 도는 1회는 켠 뒤의 일이다. 늘 ○다.
  lines.push({ mark: MARK_PENDING, text: LINE_TODAY });

  return {
    headLeft: HEAD_LEFT,
    headRight: HEAD_RIGHT,
    lines,
    notice: SANDBOX_NOTICE,
  };
}

const __exports = {
  MARK_DONE, MARK_RUNNING, MARK_PENDING,
  HEAD_LEFT, HEAD_RIGHT, SANDBOX_NOTICE, LINE_TODAY,
  nodeNames, secondsText, buildProgress,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.WatchProgressCard = __exports;
}

})();
