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

// steps: id → { label, done, elapsedMs } 맵(호출자가 턴 하나의 수명으로 들고
// 있는다 — orb.js의 카드별 Map, chat.js의 턴별 Map).
// step: main.js가 보낸 원시 이벤트 하나.
// 반환: 이번 판정 결과 { id, label, done, timeText } — id가 없는 이벤트는
// null(호출자는 그리지 않고 무시한다).
function applyToolStep(steps, step) {
  if (!step || !step.id) return null;
  const label = step.label || '처리 중';
  const done = !!step.done;
  const timeText = done && typeof step.elapsedMs === 'number'
    ? `${(step.elapsedMs / 1000).toFixed(1)}s`
    : (done ? '—' : '');
  steps.set(step.id, { label, done, elapsedMs: step.elapsedMs });
  return { id: step.id, label, done, timeText };
}

const __exports = { applyToolStep };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.ToolStepTrack = __exports;
}

})();
