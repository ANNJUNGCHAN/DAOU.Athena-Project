// 모드 귀속 창 계약 중 H2(모드 인지) 하나만 지는 어댑터.
//
// 오늘 셸에는 모드 전용 창이 없다 — 채팅도 상주 세션도 전역 1개다. 그래서
// "지금 어느 모드인가"는 새 이벤트나 새 채널이 아니라 **동기 읽기**로 얻는다:
// lib/graph-mode/controller.js의 applyVisibility()가 캔버스 영역에 현재 모드
// 라벨을 이미 써 두기 때문이다(plugin · graph · chat · agent · backtest).
//
// **첫 페인트 전에는 undefined다. undefined는 플러그인 모드가 아니다** —
// 호출부는 이때 제안을 모드 밖과 똑같이 폐기한다(추측해서 그리지 않는다).
//
// 인프라 트랙이 실제 모드 귀속 창을 내놓으면 이 함수 안만 바꾼다. 호출부
// (canvas.js · chat.js)는 손대지 않는다.
(function () {
'use strict';

function currentMode() {
  if (typeof document === 'undefined' || !document || typeof document.getElementById !== 'function') return undefined;
  const region = document.getElementById('canvasRegion');
  if (!region || !region.dataset) return undefined;
  return region.dataset.mode;
}

const __exports = { currentMode };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.PluginModeAdapter = __exports;
}

})();
