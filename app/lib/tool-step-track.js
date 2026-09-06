// IIFE 스코프 격리(2026-08-18 렌더러 격리) — routine-turn.js와 같은 UMD 패턴.
(function () {
'use strict';

// 툴 실행 단계 카드 — main.js가 tool_use/tool_result에서 뽑아 보내는 원시
// step 이벤트({ id, label, done, elapsedMs })를 오브·셸 채팅 양쪽이 같은
// 규칙으로 렌더링하게 만드는 순수 판정 모듈이다. main.js의 TOOL_STEP_LABELS가
// 이미 정한 한국어 라벨을 그대로 받아쓸 뿐, 여기서 라벨을 다시 짓지 않는다.
// (2026-08-26 어드버서리얼 리뷰 결함 #3 — chat.js가 athena:live-tool-step을
// 아예 안 구독해 board-04 "⑧ 실행 라인"이 셸 쪽에서만 비어 있었다. 오브가
// 이미 갖고 있던 판정을 그대로 나눠 쓴다 — 두 벌로 다시 짓지 않는다.)

// steps: id → { label, done, elapsedMs, error } 맵(호출자가 턴 하나의 수명으로
// 들고 있는다 — orb.js의 카드별 Map, chat.js의 턴별 Map).
// step: main.js가 보낸 원시 이벤트 하나. error는 옵셔널 필드(tool_result의
// is_error) — 안 보내는 호출자(진행 중 이벤트 등)는 항상 false로 취급된다.
// 반환: 이번 판정 결과 { id, label, done, timeText, error } — id가 없는
// 이벤트는 null(호출자는 그리지 않고 무시한다). label은 error일 때 "{원본
// 라벨} 실패"로 이미 조립돼 있다 — 오브·셸 두 호출자가 라벨을 각자 다시
// 짓지 않게(이 모듈이 애초에 막으려던 중복) 여기서 한 번만 짓는다.
function applyToolStep(steps, step) {
  if (!step || !step.id) return null;
  const rawLabel = step.label || '처리 중';
  const done = !!step.done;
  const error = !!step.error;
  // retrying — MCP 서버가 아직 연결 중이라 깨진 호출(2026-09-03). 도구가 없는
  // 것도 고장난 것도 아니고, 모델이 기다렸다 다시 부른다(main.js 분류 · live-prompt.js
  // 규칙). "실패"로 쓰면 사용자가 기능이 없는 줄 안다 — 실제로 그렇게 읽혔다.
  // 숨기지도 않는다: 무슨 일이 있었는지는 말한다.
  const retrying = !!step.retrying;
  const label = error ? `${rawLabel} 실패` : (retrying ? `${rawLabel} — 서버 연결 대기` : rawLabel);
  // 부제(2026-09-07, Paper 보드 10 「한미반도체 · 관계 7 · 이력 3」) — 무엇을 몇 개
  // 받았는지는 결과에만 있어서 라벨로는 못 만든다. 라벨과 같은 규율로 여기서만
  // 정한다: 안 보내는 호출자는 빈 문자열이고, 그러면 호출자가 그리지 않는다.
  const note = typeof step.note === 'string' ? step.note : '';
  const timeText = done && typeof step.elapsedMs === 'number'
    ? `${(step.elapsedMs / 1000).toFixed(1)}s`
    : (done ? '—' : '');
  steps.set(step.id, { label, done, elapsedMs: step.elapsedMs, error, retrying, note });
  return { id: step.id, label, done, timeText, error, retrying, note };
}

const __exports = { applyToolStep };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.ToolStepTrack = __exports;
}

})();
