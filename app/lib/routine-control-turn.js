// IIFE 스코프 격리(2026-08-18 렌더러 격리) — routine-turn.js와 같은 UMD 패턴.
(function () {
// 제어 결과 턴(Paper 보드 08 · 4330-1)의 순수 계산 — DOM은 만들지 않는다
// (chat.js가 renderControlResultTurn에서 조립). 칩을 누른 뒤 같은 방에 붙는
// 네 상태가 여기 한 표로 산다: 성공 · 거부 · 실패·재시도 · 뷰 이동.
//
// 규율(437W-1): 상태 표기만 · 한국어 단위 · 내부어 없음.
// 규율(4380-1): 보류·뷰 이동은 서버 상태가 안 바뀐다 — 빈 변경이 정상이다.
'use strict';

// 쿨다운의 한국어 단위는 이미 있는 포매터를 쓴다 — 같은 값에 두 표기가 생기면 안 된다.
const isNode = typeof module !== 'undefined' && module.exports;
const WatchNodes = isNode ? require('./watch-nodes') : window.AthenaLib.WatchNodes;

// kind → 판정 배지·색조·서버 상태 변화 여부. Paper 4330-1의 네 열이 이 표다.
const CONTROL_RESULT_KINDS = {
  success: { statusBadge: '완료', tone: 'ok', serverChanged: true },
  reject: { statusBadge: '보류', tone: 'dim', serverChanged: false },
  fail: { statusBadge: '실패', tone: 'up', serverChanged: false },
  view: { statusBadge: '완료', tone: 'ok', serverChanged: false },
};

const RETRY_CHIP = '다시 시도';

// 실패 문구는 백엔드 거절 사유의 **사용자 어투 판**이다(437Y-1) — 코드 번호는
// 화면에 올리지 않는다(R10). 지울 것을 지우고 남는 게 없으면 상태 표기 하나만 낸다.
const CODE_TOKEN_RE = /\b[A-Z][A-Z0-9]+_[A-Z0-9_]*\d[A-Z0-9_]*\b|\bcode\s*[:=]\s*\S+/gi;
const NO_REASON_LEAD = '서버가 받지 않은 요청';

function failLead(reason) {
  const text = String(reason == null ? '' : reason)
    .replace(CODE_TOKEN_RE, '')
    // 코드만 들어 있던 괄호는 빈 껍데기로 남는다 — 그것도 걷어낸다.
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s·—\-:,(\[]+/, '')
    .replace(/[\s·—\-:,()\[\]]+$/, '')
    .trim();
  return text || NO_REASON_LEAD;
}

// 사실행 한 줄(Paper 「삼성전자 88,000원 감시 · 만료 보존」 자리) — 원장 행의 값만
// 잇는다. 없는 칸은 그냥 빠진다: 모르는 것을 채우느니 짧은 줄이 낫다.
function controlFactLine(routine) {
  const r = (routine && typeof routine === 'object') ? routine : {};
  const parts = [];
  if (r.symbol) parts.push(String(r.symbol));
  if (r.note) parts.push(String(r.note));
  const cooldown = WatchNodes.cooldownLabel(r.cooldown_s);
  if (cooldown && cooldown !== '—') parts.push(`쿨다운 ${cooldown}`);
  return parts.join(' · ');
}

/** 제어 결과 이벤트 → 결과 턴 모델.
 *
 * `badge`(누른 칩 이름) · `lead`(상태 한 줄) · `fact`(원장 1:1 사실 한 줄)는
 * 부르는 쪽이 쥔 값이다 — 이 모듈은 지어내지 않고 판정만 붙인다. 실패만
 * 예외다: lead를 거절 사유에서 만들어야 코드 번호가 새지 않는다.
 */
function buildControlResultTurn(event) {
  const e = (event && typeof event === 'object') ? event : {};
  const kind = Object.prototype.hasOwnProperty.call(CONTROL_RESULT_KINDS, e.kind)
    ? e.kind : 'fail';
  const shape = CONTROL_RESULT_KINDS[kind];
  const lead = kind === 'fail' ? failLead(e.reason) : String(e.lead || '').trim();
  return {
    kind,
    badge: String(e.badge || '').trim(),
    statusBadge: shape.statusBadge,
    tone: shape.tone,
    lead,
    fact: String(e.fact || '').trim(),
    // 실패에만 다음 행동이 있다 — 나머지 셋은 이미 끝난 일이다.
    chips: kind === 'fail' ? [RETRY_CHIP] : [],
    serverChanged: shape.serverChanged,
  };
}

const __exports = {
  CONTROL_RESULT_KINDS, RETRY_CHIP, NO_REASON_LEAD,
  failLead, controlFactLine, buildControlResultTurn,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.RoutineControlTurn = __exports;
}

})();
