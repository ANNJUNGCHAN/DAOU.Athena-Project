// IIFE 스코프 격리(2026-08-18 렌더러 격리) — routine-turn.js와 같은 UMD 패턴.
(function () {
'use strict';

// 오브 입력 잠금 판정 — chatBusy(오브 자신의 질의가 진행 중)와 remoteQueryBusy
// (셸의 질의가 진행 중, athena:live-query-state 브로드캐스트로 안다)가 겹칠
// 수 있어 순수 함수로 판정만 뽑는다.
//
// (2026-08-26 어드버서리얼 리뷰 결함 #1 — chat.js는 이미 athena:live-query-state를
// 구독해 "오브에서 대화 중 — 잠시 후 다시 시도하세요"로 자기 입력을 잠그는데
// orb.js는 이 이벤트를 몰랐다. 그래서 셸 질의가 도는 중에도 오브 입력이 멀쩡히
// 열려 있었고, 사용자가 거기 제출하면 main.js의 runLiveQueryInner가 "새 질의는
// 항상 선점한다"는 규칙대로 셸의 진행 중 질의를 조용히 죽이고 그 결과를 셸
// 이력에 "사용자 중단"으로 남겼다 — 두 창이 하나의 activeLiveQuery를 공유하는
// 구조라 이 잠금도 공유해야 한다. orb.js는 chat.js와 같은 원칙 — 자신이 이미
// 진행 중이면 그쪽이 우선한다 — 으로 겹침을 흡수한다.)
function resolveInputLock({ chatBusy, remoteQueryBusy }) {
  if (chatBusy) {
    // 오브 자신의 질의가 우선한다 — 원격 상태를 반영하지 않는다(진행 중
    // 문구·ESC 중단 버튼이 자기 질의 기준으로 유지된다).
    return { disabled: true, hintHidden: false, hintText: '답변 중…' };
  }
  if (remoteQueryBusy) {
    // ESC 버튼은 이 상태에서도 화면에는 남지만 눌러도 무해하다(orb.js의
    // abortChat()이 chatBusy 기준으로만 동작 — 셸의 질의를 오브에서 죽이지 않는다).
    return { disabled: true, hintHidden: false, hintText: '셸 질의 진행 중' };
  }
  return { disabled: false, hintHidden: true, hintText: null };
}

const __exports = { resolveInputLock };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.LiveQueryLock = __exports;
}

})();
