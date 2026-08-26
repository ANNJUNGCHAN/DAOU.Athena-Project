// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 사이드바 상단 모드 네비(Paper 보드 37/44) — 대화·그래프·에이전트 3항목의
// active/inactive 표시와 클릭 배선만 갖는다. "지금 무엇을 보고 있는가"의
// 진짜 소유자는 graph-mode/controller.js의 applyVisibility()다(P4, 그 파일
// 주석 참고) — 이 모듈은 전역 AthenaGraphMode를 직접 참조하지 않고, 클릭을
// 호출자가 주입한 onSelect로 위임할 뿐이다(ADR Q3 — 신규 코드는 지역 이름만
// 쓴다). #dot는 이제 상태표시 전용이라(리프 1.2.2) 모드를 바꾸는 경로가 이
// 네비 하나뿐이다 — 그래서 클릭 시점에 로컬로 active를 반영해도 다른 경로와
// 어긋날 일이 없다.

function createSidebarModeNav(deps) {
  const { items, onSelect } = deps || {};
  const keys = items ? Object.keys(items) : [];

  function setActive(view) {
    for (const key of keys) {
      const el = items[key];
      if (!el) continue;
      const active = key === view;
      el.className = active ? 'sidebar-mode-item is-active' : 'sidebar-mode-item';
      if (typeof el.setAttribute === 'function') {
        el.setAttribute('aria-pressed', active ? 'true' : 'false');
      }
    }
  }

  for (const key of keys) {
    const el = items[key];
    if (!el || typeof el.addEventListener !== 'function') continue;
    el.addEventListener('click', () => {
      setActive(key);
      if (typeof onSelect === 'function') onSelect(key);
    });
  }

  return { setActive };
}

const __exports = { createSidebarModeNav };

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.SidebarModeNav = __exports;
}

})();
