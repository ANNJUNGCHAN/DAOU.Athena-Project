// IIFE 스코프 격리(2026-08-18 렌더러 격리) — routine-turn.js와 같은 UMD 패턴.
(function () {
'use strict';

// 말걸기 가드 확인 카드(F-stage9, Paper 보드 42/BIM-0)의 순수 계산 — DOM은
// 만들지 않는다(chat.js가 renderGuardConfirmCard에서 조립). athena_nudge_guard
// propose 결과({current, proposed})를 사람이 읽는 문구로 바꾸는 로직만 여기
// 둔다 — routine-turn.js의 describeMode/buildTurnModel과 같은 자리.

const GUARD_FIELD_LABELS = {
  max_daily_nudges: '하루 최대',
  quiet_hours: '조용 시간',
  show_rationale: '근거 표시',
  learn_from_dismissals: '거절 반영 학습',
};

function guardValueText(key, settings) {
  if (!settings) return '?';
  if (key === 'max_daily_nudges') return `${settings.max_daily_nudges}회`;
  if (key === 'quiet_hours') {
    const qh = settings.quiet_hours || {};
    return `${qh.start || '?'}–${qh.end || '?'}`;
  }
  if (key === 'show_rationale') return settings.show_rationale ? '항상' : '끔';
  if (key === 'learn_from_dismissals') return settings.learn_from_dismissals ? '켬' : '끔';
  return '?';
}

// current/proposed 병합 — quiet_hours처럼 중첩 필드는 얕은 병합이 아니라
// 필드별로 합친다(모델이 start만 바꿨을 때 end가 날아가지 않게).
function mergeGuardSettings(current, proposed) {
  const merged = { ...current, ...proposed };
  merged.quiet_hours = { ...(current.quiet_hours || {}), ...((proposed && proposed.quiet_hours) || {}) };
  return merged;
}

// 실제로 값이 달라지는 필드만 "현재값 → 제안값"으로 나열한다 — 안 바뀐
// 필드는 언급하지 않는다(지어낸 비교를 만들지 않는다, P3).
function diffGuardFields(current, proposed) {
  const merged = mergeGuardSettings(current, proposed);
  const changed = [];
  for (const key of Object.keys(GUARD_FIELD_LABELS)) {
    if (!proposed || !Object.prototype.hasOwnProperty.call(proposed, key)) continue;
    const before = guardValueText(key, current);
    const after = guardValueText(key, merged);
    if (before !== after) changed.push({ key, label: GUARD_FIELD_LABELS[key], before, after });
  }
  return changed;
}

function guardConfirmBodyText(current, proposed) {
  const changes = diffGuardFields(current, proposed);
  if (!changes.length) return '지금 값과 같습니다 — 바뀌는 게 없습니다.';
  return `${changes.map((c) => `${c.label} ${c.before} → ${c.after}`).join(' · ')}로 바꿀까요?`;
}

// "근거" 각주 — Paper 목업의 "오늘 '줄여줘' 응답"과 같은 원천, 지어낸 통계
// (예: 옛 목업의 "최근 7일 발화 4건")는 뒷받침할 백엔드 집계가 없어 뺀다(P3).
// 이 턴을 촉발한 사용자 문구를 그대로 인용한다.
function guardConfirmRationale(triggerText) {
  const trimmed = String(triggerText || '').trim();
  if (!trimmed) return '근거: 이 대화에서 방금 나온 제안입니다';
  const quoted = trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
  return `근거: "${quoted}"`;
}

const __exports = {
  GUARD_FIELD_LABELS, guardValueText, mergeGuardSettings, diffGuardFields,
  guardConfirmBodyText, guardConfirmRationale,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.GuardConfirm = __exports;
}

})();
