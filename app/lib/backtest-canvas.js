// 백테스트 모드 캔버스 — P1 모드 골격(backtest-mode-plan.md §3.2/§8.1).
//
// 이번 단계는 정직한 빈 상태 하나뿐이다. 폼·코드·결과·이력 4표면(§8.1)과
// 백엔드·IPC 배선(P2~P4)은 이번 범위가 아니다 — 없는 기능을 있는 것처럼
// 보이는 버튼·목업 데이터를 미리 그리지 않는다(P3 정책, plugin-canvas.js
// 머리말과 같은 태도).
(function () {
'use strict';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// mount()/refresh() 둘 다 이 한 화면만 그린다 — 지금은 상태가 없어(백엔드
// 미배선) 매번 같은 내용이다. 나중에 실제 상태(잡 목록 등)가 생기면 refresh()가
// 그 상태로 다시 그리는 진짜 일을 하게 된다.
function renderEmptyState(container) {
  clear(container);
  const wrap = el('div', 'backtest-canvas-empty');
  wrap.appendChild(el('div', 'backtest-canvas-empty-title', '백테스트'));
  wrap.appendChild(el('div', 'backtest-canvas-empty-sub',
    '전략 설계와 실행은 다음 단계에서 연결됩니다 — 아직 백엔드가 붙지 않았습니다.'));
  container.appendChild(wrap);
}

function createBacktestCanvas(options) {
  const deps = options || {};
  const container = deps.container;
  if (!container) {
    return { mount() {}, refresh() {} };
  }

  function mount() {
    renderEmptyState(container);
  }

  function refresh() {
    renderEmptyState(container);
  }

  return { mount, refresh };
}

const __exports = { createBacktestCanvas };

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BacktestCanvas = __exports;
}

})();
