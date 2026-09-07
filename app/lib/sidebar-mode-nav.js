// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 사이드바 상단 모드 네비(Paper 보드 37/44) — 대화·그래프·에이전트 3항목의
// active/inactive 표시와 클릭 배선만 갖는다. "지금 무엇을 보고 있는가"의
// 진짜 소유자는 graph-mode/controller.js의 applyVisibility()다(P4, 그 파일
// 주석 참고) — 이 모듈은 전역 AthenaCanvasMode를 직접 참조하지 않고, 클릭을
// 호출자가 주입한 onSelect로 위임할 뿐이다(ADR Q3 — 신규 코드는 지역 이름만
// 쓴다). #dot는 이제 상태표시 전용이라(리프 1.2.2) 모드를 바꾸는 경로가 이
// 네비 하나뿐이다 — 그래서 클릭 시점에 로컬로 active를 반영해도 다른 경로와
// 어긋날 일이 없다.

function createSidebarModeNav(deps) {
  const { items, badge, watch, counts, onSelect } = deps || {};
  const keys = items ? Object.keys(items) : [];

  function setActive(view) {
    for (const key of keys) {
      const el = items[key];
      if (!el) continue;
      const active = key === view;
      // has-running(실행 중 스피너)은 모드 클릭과 무관한 상태다 — 통째로 덮어쓰면
      // 다른 모드를 눌렀을 때 도는 스피너가 꺼진다. 그 클래스만 살려서 다시 쓴다.
      const running = /\bhas-running\b/.test(String(el.className || ''));
      el.className = `sidebar-mode-item${active ? ' is-active' : ''}${running ? ' has-running' : ''}`;
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

  // 에이전트 항목의 상시 배지 = 알람 센터 미확인 수(원칙2, Paper 보드 44).
  // 호출자(lib/sidebar.js)가 notifyRooms의 !read 개수를 세어 넘긴다 — 이
  // 모듈은 그 숫자를 렌더만 할 뿐, 알림 데이터 자체를 소유하지 않는다.
  // 0이면 숨긴다(없는 미확인을 있다고 표시하지 않는다, P3).
  function setBadgeCount(count) {
    if (!badge) return;
    const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    if (n <= 0) {
      badge.hidden = true;
      badge.textContent = '';
      return;
    }
    badge.hidden = false;
    badge.textContent = String(n);
  }

  // 스트립을 걷어내며 약속한 「감시 N」(OBS-012). 미확인 알람 배지와 자리가 다르다.
  // 0이면 숨긴다.
  function setWatchCount(count) {
    if (!watch) return;
    const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    if (n <= 0) {
      watch.hidden = true;
      watch.textContent = '';
      return;
    }
    watch.hidden = false;
    watch.textContent = `감시 ${n}`;
  }

  // 모드별 대화 수(세션 명세 §3-1의 "이력의 머리는 다섯 모드") — 호출자가
  // session-history-view.js로 센 숫자를 넘긴다. 이 모듈은 숫자만 렌더한다.
  // 0이거나 없으면 그 자리를 숨긴다(없는 이력을 있다고 표시하지 않는다, P3).
  function setCounts(map) {
    if (!counts) return;
    const source = (map && typeof map === 'object') ? map : {};
    for (const key of Object.keys(counts)) {
      const el = counts[key];
      if (!el) continue;
      const raw = source[key];
      const n = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
      if (n <= 0) {
        el.hidden = true;
        el.textContent = '';
        continue;
      }
      el.hidden = false;
      el.textContent = String(n);
    }
  }

  // 실행 중 표시는 스피너 하나로 통일한다(사용자 확정 2026-09-02) — 초록 점은
  // 쓰지 않는다. 스피너를 그리는 건 CSS의 몫이라 여기서는 상태 클래스와
  // aria-busy만 남긴다. 모르는 키는 그릴 자리가 없으니 조용히 무시한다.
  function setRunning(map) {
    const source = (map && typeof map === 'object') ? map : {};
    for (const key of keys) {
      const el = items[key];
      if (!el) continue;
      const running = !!source[key];
      const classes = String(el.className || '').split(' ').filter((c) => c && c !== 'has-running');
      if (running) classes.push('has-running');
      el.className = classes.join(' ');
      if (typeof el.setAttribute === 'function') {
        el.setAttribute('aria-busy', running ? 'true' : 'false');
      }
    }
  }

  return { setActive, setBadgeCount, setWatchCount, setCounts, setRunning };
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
