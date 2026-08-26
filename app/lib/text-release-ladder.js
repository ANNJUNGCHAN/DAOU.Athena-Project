// 카드 우선 표시(US-006) 텍스트 방출 사다리 — 순수 상태기계.
//
// 팀리드 확정 방출 조건(2026-08-26, 프리앰블 실측 결함 이후 강화판) — 아래 중
// 무엇이든 먼저 오면 방출한다:
//   (a) 첫 캔버스 결과 도착 — 카드 우선이 달성된 순간.
//   (b) 이번 턴의 툴 활동(검색·설명·판단 등)이 render_canvas 없이 전부 종결—
//       카드가 안 올 턴이라는 뜻이라 텍스트를 더 붙들 이유가 없다.
//   (c) 첫 텍스트 조각으로부터 2.5초 안에 툴 활동이 전혀 없었다 — 순수 대화체
//       턴(카드가 아예 필요 없는 질문)이 최초 페인트에 최대 2.5초를 한 번만
//       낸다. 프로즈 전용 턴 최초 페인트 ≤2.5s 지연은 카드 선행 절대 조건의
//       의도된 비용이다 — 값을 낮추면 "카드가 뜨는 턴인데 아직 툴 신호가 안
//       왔을 뿐"인 경우와 구분이 안 되고, 높이면 순수 대화 응답이 굼떠 보인다.
//       (2026-08-26 개정: 1.2초로는 실측 프리앰블→첫 툴콜 간격(1.1~1.3s)이
//       거의 그대로 위에 걸쳐 여유가 없었다 — E2E 재현으로 실패 재발을 잡은
//       뒤 2.5초로 넓혀 그 분포에 실질적 여유를 뒀다.)
//   (d) 턴 종료 — 호출부(chat.js)가 authoritative answerText로 덮어쓰는
//       기존 경로가 처리한다(이 모듈의 책임 밖).
// 툴 활동이 진행 중인 동안(검색/설명/판단/렌더 중 무엇이든 done:false로 남아
// 있는 동안)은 절대 방출하지 않는다 — 사용자의 "카드가 텍스트보다 절대적으로
// 먼저"라는 지시가 (a)/(b)/(c)보다 우선한다. 그동안 사용자가 보는 건 이미 있는
// 진행 표시·툴 단계 줄이다(이 모듈은 그 UI를 안 만든다).
//
// (b)의 함정(단위 테스트로 실측, 2026-08-26): "지금까지 본 단계가 전부 done"을
// 단계 하나가 끝나는 즉시 확인하면, 실제 파이프라인(검색→설명→판단→[렌더])의
// 중간 침묵 구간(실측 1.8~2.5초, probe-card-first-text.js 캡처)에서 "검색만
// 끝났고 아직 설명이 시작 전"인 순간을 "전부 종결됐다"로 오판해 너무 일찍
// 풀려버린다 — 그 뒤 진짜 render_canvas가 시작돼도 이미 풀린 상태라 카드보다
// 텍스트가 먼저 보이는, 고치려던 결함이 다른 자리에서 재발한다. 그래서 (b)는
// "정지 후 조용한 시간"으로 판정한다 — 마지막 단계가 끝난 뒤 stepQuietMs 동안
// 새 단계가 하나도 안 뜨면 그때 방출한다(관측된 단계 간 간격보다 넉넉하게 잡음).
// 새 단계가 뜨면 그 유예를 취소하고 그 단계가 끝날 때 다시 잰다.
//
// 텍스트 누적·DOM 페인트는 이 모듈의 책임이 아니다(호출부가 한다) — 이 모듈은
// "지금 방출해도 되는가"만 판정하고, 그 순간 onRelease()를 정확히 한 번 부른다.
(function () {
'use strict';

// main.js toolStepLabel()이 render_canvas 전용으로 붙이는 한글 라벨(원문
// 그대로) — chat.js의 카드 우선 판정과 같은 값을 쓴다(새 IPC를 안 만들고
// 기존 tool-step 구독의 라벨 하나로 판정한다는 원 설계 그대로).
const RENDER_CANVAS_LABEL = '카드 그리는 중';
// (c) 유예 — 사용자에게 약속하는 최초 페인트 상한. 이 값은 그대로 지연으로
// 드러나므로 낮게 고정한다(위 머리말 참고). 1200 → 2500 개정(2026-08-26):
// 실측 프리앰블→첫 툴콜 간격(1.1~1.3s)에 여유를 두기 위함, 위 머리말 참고.
const DEFAULT_GRACE_MS = 2500;
// (b) "조용해졌다" 판정 — 실측 단계 간 간격(1.8~2.5s)보다 넉넉해야 중간
// 침묵을 종결로 오판하지 않는다. (c)보다 커도 된다 — (b)는 이미 활동이
// 있었던 턴이라 "곧 카드가 뜨는 중"일 확률이 (c) 대상(활동 자체가 없는 턴)보다
// 높으므로 좀 더 기다려 줘도 손해가 아니다.
const DEFAULT_STEP_QUIET_MS = 3000;

function createTextReleaseLadder(deps) {
  const {
    onRelease,
    graceMs = DEFAULT_GRACE_MS,
    stepQuietMs = DEFAULT_STEP_QUIET_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = deps || {};
  if (typeof onRelease !== 'function') throw new Error('onRelease 콜백이 필요하다');

  let released = false;
  let sawFirstDelta = false;
  let renderCanvasSeen = false;
  let graceTimer = null; // 조건 (c) 전용
  let stepQuietTimer = null; // 조건 (b) 전용
  const stepDoneById = new Map(); // tool-step id → done(boolean). "지금 열린 활동이 있는가"만 본다.

  function allStepsDone() {
    if (stepDoneById.size === 0) return false; // 활동 자체가 없으면 "종결"이 아니라 "아직 없음"이다 — (b) 대상이 아니다.
    for (const done of stepDoneById.values()) {
      if (!done) return false;
    }
    return true;
  }

  function clearGraceTimer() {
    if (graceTimer != null) {
      clearTimeoutFn(graceTimer);
      graceTimer = null;
    }
  }

  function clearStepQuietTimer() {
    if (stepQuietTimer != null) {
      clearTimeoutFn(stepQuietTimer);
      stepQuietTimer = null;
    }
  }

  function release() {
    if (released) return;
    released = true;
    clearGraceTimer();
    clearStepQuietTimer();
    onRelease();
  }

  return {
    get released() {
      return released;
    },

    // 텍스트 조각이 올 때마다 부른다. 첫 조각에서만 유예 타이머(조건 c)를 켠다.
    onTextDelta() {
      if (released || sawFirstDelta) return;
      sawFirstDelta = true;
      graceTimer = setTimeoutFn(() => {
        graceTimer = null;
        // 타이머가 울린 시점에 툴 활동이 하나도 없었을 때만 (c)가 적용된다 —
        // 이미 검색이라도 시작됐으면 (b) 또는 (a)가 대신 판단한다(이 사다리는
        // 그 활동이 끝나기를 계속 기다린다, 방출하지 않는다).
        if (!released && stepDoneById.size === 0) release();
      }, graceMs);
    },

    // tool-step 이벤트 하나마다 부른다(step: { id, label, done }).
    onToolStep(step) {
      if (released || !step || step.id == null) return;
      stepDoneById.set(step.id, !!step.done);
      if (step.label === RENDER_CANVAS_LABEL) renderCanvasSeen = true;
      // 툴 활동이 하나라도 확인됐다 — 조건(c) "활동이 전혀 없었다"는 이번 턴에
      // 영원히 해당 없음이 됐으니 그 유예 타이머를 지운다(안 지워도 判定
      // 자체는 stepDoneById.size로 안전하지만, 안 쓸 타이머를 남겨 둘 이유가
      // 없다). 그리고 새 활동(시작이든 종결이든)이 있을 때마다 이전 "조용해짐"
      // 판정(조건 b)도 무효화한다 — 지금 막 뭔가 움직였으니 아직 조용한 게 아니다.
      clearGraceTimer();
      clearStepQuietTimer();
      if (renderCanvasSeen) return; // (b)는 render_canvas가 안 보였을 때만 — 이미 봤으면 (a)만 기다린다.
      if (allStepsDone()) {
        stepQuietTimer = setTimeoutFn(() => {
          stepQuietTimer = null;
          if (!released && !renderCanvasSeen && allStepsDone()) release();
        }, stepQuietMs);
      }
    },

    // 첫 캔버스 결과가 도착했을 때 부른다 — 조건 (a), 카드 우선의 본래 목적.
    onCanvasLanded() {
      release();
    },

    // 턴 종료 시 호출부가 정리용으로 부른다(타이머 누수 방지) — 방출 자체는
    // 안 한다(그건 authoritative overwrite의 몫, 이 모듈 책임 밖).
    dispose() {
      if (graceTimer != null) {
        clearTimeoutFn(graceTimer);
        graceTimer = null;
      }
      clearStepQuietTimer();
    },
  };
}

const __exports = {
  createTextReleaseLadder,
  RENDER_CANVAS_LABEL,
  DEFAULT_GRACE_MS,
  DEFAULT_STEP_QUIET_MS,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.TextReleaseLadder = __exports;
}

})();
