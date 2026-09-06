// IIFE 스코프 격리(2026-08-18 렌더러 격리) — watch-check-card.js와 같은 UMD 패턴.
(function () {
'use strict';

// 코드 알람 노드 카드(Paper 보드 10·11·12)의 순수 계산 — DOM은 만들지 않는다
// (agent-canvas.js가 renderDetail에서 조립). 백엔드 상세 응답의 watch/last_run/
// last_check 값을 사람이 읽는 문구로 바꾸는 로직만 여기 둔다 —
// lib/watch-check-card.js가 채팅 쪽에서 하는 일과 같은 자리다.
//
// 문구 규칙(계획 R6·R7·R8): 서술형 종결 금지, 단위는 한국어, 내부 용어 금지.
// 카드 문법은 R7이 못박은 순서 그대로 — 한국어 제목 / 영어 함수명 작게 /
// 「들어감」 행들 / 구분선 / 「나옴」 굵게.

const DASH = '—';
const LABEL_IN = '들어감';
const LABEL_OUT = '나옴';
const BADGE_CHANGED = '방금 바뀜';
const BADGE_UNUSED = '이번엔 안 쓰임';
const CHIP_ODD = '이상해요';
const CHIP_ASK = '물어볼게요';
const CODE_COLLAPSED = '코드 · 참고 · 펼치기';
const CODE_EXPANDED = '코드 · 참고 · 접기';
const COUNTED_UNTIL = '어제까지로 세었음 · 오늘은 진행 중';
const KIND_LABEL = '코드 감시';

// 1234567.5 → '1,234,568' 꼴. 값이 없으면 지어내지 않고 '—'로 남긴다(P3).
// 「배」·「만주」 같은 단위는 백엔드가 준 문자열에만 있다 — 여기서 붙이지 않는다.
function formatValue(v) {
  if (v === null || v === undefined) return DASH;
  if (typeof v === 'boolean') return v ? '참' : '거짓';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return DASH;
    const rounded = Number.isInteger(v) ? v : Math.round(v * 100) / 100;
    const [intPart, frac] = String(Math.abs(rounded)).split('.');
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${rounded < 0 ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
  }
  if (Array.isArray(v)) {
    const parts = v.map(formatValue).filter((s) => s !== DASH);
    return parts.length ? parts.join(', ') : DASH;
  }
  const text = String(v).trim();
  return text || DASH;
}

// 확인 주기(분) — 백엔드가 초로 준다. 모르면 보드 12의 기본값 1분
// (chat.js watchPollMinutes와 같은 규칙 — 두 화면이 다른 수를 말하면 안 된다).
function pollMinutes(watch) {
  const sec = Number((watch && watch.poll_interval_s) || 0);
  return Number.isFinite(sec) && sec >= 60 ? Math.round(sec / 60) : 1;
}

// 쿨다운(보드 10·12 「쿨다운 1일」) — 백엔드는 초로 준다. 나누어떨어지는 가장 큰
// 한국어 단위 하나만 쓰고, 안 떨어지면 초 그대로 남긴다(반올림으로 값을 바꾸지 않는다).
function cooldownLabel(seconds) {
  if (seconds === null || seconds === undefined || seconds === '') return DASH;
  const sec = Number(seconds);
  if (!Number.isFinite(sec) || sec < 0) return DASH;
  if (sec < 60) return `${sec}초`;
  for (const [unit, suffix] of [[86400, '일'], [3600, '시간'], [60, '분']]) {
    if (sec % unit === 0) return `${sec / unit}${suffix}`;
  }
  return `${sec}초`;
}

// 목록 행의 두 번째 줄(보드 12) — 「주기 확인」으로 떨어지면 안 된다(A-1).
function watchSubLabel(watch) {
  return `${KIND_LABEL} · 장중 ${pollMinutes(watch)}분마다`;
}

// 상세 머리 오른쪽(보드 12 「코드 감시 · v2」) — 해시 앞 6글자를 버전으로 쓴다.
// 해시가 없으면 갈래 이름만 남긴다(지어낸 버전 번호를 붙이지 않는다).
function versionLabel(watch) {
  const hash = String((watch && watch.version_hash) || '').trim();
  return hash ? `${KIND_LABEL} · v${hash.slice(0, 6)}` : KIND_LABEL;
}

// 노드 카드 모델 — 백엔드 노드 한 개당 한 장. 한국어 제목이 없으면 영어
// 함수명으로 대체한다(B-11의 앱 쪽 짝, watch-check-card.nodeSummary와 같은 규칙).
function nodeCards(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  return list.map((n) => {
    const node = n || {};
    const fn = String(node.fn || '').trim();
    const inputs = Array.isArray(node.inputs) ? node.inputs : [];
    return {
      fn,
      titleKo: String(node.title_ko || '').trim() || String(node.title_en || '').trim() || fn,
      titleEn: String(node.title_en || '').trim() || fn,
      inputs: inputs.map((row) => ({
        name: String((row && row.name) || '').trim(),
        value: formatValue(row && row.value),
      })),
      output: formatValue(node.output),
      unused: node.unused === true || node.called === false,
      changed: node.changed === true,
    };
  });
}

// 'YYYY-MM-DDTHH:MM' → '15:31'. 파싱 실패는 빈 문자열 — 시각을 지어내지 않는다.
function clockLabel(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 만료 행(보드 12 「만료 2026-10-03」) — 날짜만, 시각은 안 쓴다.
function dayLabel(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 'YYYY-MM-DD' → '8/26'(보드 10 「마지막 8/26」). watch-check-card.shortDate와
// 같은 규칙이지만 그 파일은 채팅 전용이라 서로 부르지 않는다.
function shortDate(dt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dt || ''));
  if (!m) return String(dt || '').trim();
  return `${Number(m[2])}/${Number(m[3])}`;
}

// 초안 상세의 검사 요약 한 줄 — 「지난 30일 4번 · 마지막 8/26」.
// 검사를 아직 안 돌렸으면 빈 문자열(0번이라고 단정하지 않는다, P3).
function checkSummary(check) {
  if (!check) return '';
  const count = Number(check.count);
  if (!Number.isFinite(count)) return '';
  const lookback = Number(check.lookback_days);
  const days = Number.isFinite(lookback) && lookback > 0 ? lookback : 30;
  const fires = Array.isArray(check.fires) ? check.fires : [];
  const last = check.last_fire || (fires.length ? fires[fires.length - 1].dt : null);
  return `지난 ${days}일 ${count}번${last ? ` · 마지막 ${shortDate(last)}` : ''}`;
}

const __exports = {
  DASH, LABEL_IN, LABEL_OUT, BADGE_CHANGED, BADGE_UNUSED,
  CHIP_ODD, CHIP_ASK, CODE_COLLAPSED, CODE_EXPANDED, COUNTED_UNTIL, KIND_LABEL,
  formatValue, pollMinutes, cooldownLabel, watchSubLabel, versionLabel, nodeCards,
  clockLabel, dayLabel, shortDate, checkSummary,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.WatchNodes = __exports;
}

})();
