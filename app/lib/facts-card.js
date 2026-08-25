// IIFE 스코프 격리(2026-08-18 렌더러 격리) — <script> 태그는 top-level const/function을
// 문서 전체가 공유하는 하나의 스크립트 스코프에 넣는다(canvas-layout.js/column-fold.js와
// 같은 문법). CJS(require)는 이 IIFE 밖에서도 동일하게 동작한다.
(function () {
'use strict';

const PRICE_KEYS = new Set(['cur_prc', 'high_pric', 'low_pric', 'open_pric']);
const CHANGE_KEYS = new Set(['pred_pre', 'pred_pre_sig', 'flu_rt']);
const QUANTITY_KEYS = new Set(['trde_qty', 'acc_trde_qty']);
const SYMBOL_KEYS = new Set(['stk_cd', 'stk_nm']);
const DATETIME_KEYS = new Set(['dt']);

function classifyCell(key) {
  if (PRICE_KEYS.has(key)) return 'price';
  if (CHANGE_KEYS.has(key)) return 'change';
  if (QUANTITY_KEYS.has(key)) return 'quantity';
  if (SYMBOL_KEYS.has(key)) return 'symbol';
  if (DATETIME_KEYS.has(key)) return 'datetime';
  return 'generic';
}

// 전일대비기호(pred_pre_sig) 코드 — backend/docs/KIWOOM_API_IO.md 실측 그대로:
// 1 상한가·2 상승 → up / 3 보합 → flat / 4 하한가·5 하락 → down.
const SIGN_CODE_TONE = { 1: 'up', 2: 'up', 3: 'flat', 4: 'down', 5: 'down' };

function parseSignedNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

// 등락 셀의 색 톤(soul.md §4 "등락 의미색"). pred_pre_sig는 코드표를, 그 외(pred_pre·
// flu_rt)는 값 자체의 부호를 쓴다 — 두 필드가 같은 그룹에 같이 와도 각자 자기 값으로 판정한다.
function changeTone(key, value) {
  if (key === 'pred_pre_sig') return SIGN_CODE_TONE[Number(String(value).trim())] || 'flat';
  const n = parseSignedNumber(value);
  if (n === null) return 'flat';
  if (n > 0) return 'up';
  if (n < 0) return 'down';
  return 'flat';
}

function formatNumeric(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(String(value).trim());
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString('ko-KR');
}

// 일시 — 키움 dt(YYYYMMDD 8자리) → YYYY-MM-DD. 다른 길이/형식은 원문 그대로 둔다
// (backend canvas_transform.py _format_time과 같은 신중함 — 추측으로 재구성하지 않는다).
function formatDatetime(value) {
  const text = String(value === null || value === undefined ? '' : value).trim();
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return text || '—';
}

// F1/F2(spec §3.1, case-matrix): 스칼라 ≤10은 단일 그룹, 11개 이상은 2단으로 접는다.
// 20은 실측 관측 상한(case-matrix F2)일 뿐 렌더러의 하드 제약이 아니다 — 11개 이상이면
// 항상 2단으로 접어 폭을 넘기지 않는다. 앞쪽 절반/뒤쪽 절반으로 나눠 원래 필드 순서를
// 그룹 내부에서 보존한다(재정렬 없음).
const SINGLE_GROUP_MAX = 10;

function groupFactsFields(fields) {
  const list = Array.isArray(fields) ? fields : [];
  if (list.length <= SINGLE_GROUP_MAX) return [list];
  const mid = Math.ceil(list.length / 2);
  return [list.slice(0, mid), list.slice(mid)];
}

const __exports = {
  classifyCell,
  changeTone,
  formatNumeric,
  formatDatetime,
  groupFactsFields,
  SINGLE_GROUP_MAX,
};

// UMD 각주(2026-08-18 렌더러 격리) — sanitize.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.FactsCard = __exports;
}

})();
