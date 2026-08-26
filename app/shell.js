(() => {
  'use strict';

  const $shell = document.getElementById('shell');
  const $dragStrip = document.getElementById('dragStrip');
  const $winControls = document.getElementById('winControls');
  const $winMin = document.getElementById('winMin');
  const $winMax = document.getElementById('winMax');
  const $winClose = document.getElementById('winClose');

  // 영역이 등록하는 콜백. 서로 다른 <script>가 같은 문서에 살지만 모듈 경계는
  // 유지한다 — chat.js가 canvas.js의 내부 함수를 직접 부르지 않고 여기를 지난다.
  const hooks = { clearCanvases: null, openSettings: null };

  // ---------- 창 크롬 ----------
  // 부팅 연출(chat.js)이 끝나야 창이 확정된다 — 그 전에는 크롬도 셸도 없다.
  // 옛 판에서 chat.js finishBoot()가 하던 세 줄이 여기로 왔다.
  function revealChrome() {
    $shell.hidden = false;
    $dragStrip.hidden = false;
    $winControls.hidden = false;
  }

  $winMin.addEventListener('click', () => {
    window.athena.send('athena:minimize-windows');
  });

  // 2026-08-24 리프 1.2.1: □는 이제 **OS 창 최대화 토글**이다. 옛 판에서 □는
  // 대화 창의 높이를 chatBaseH↔chatMaxH로 오가게 했다 — 창 높이가 곧 대화 이력의
  // 높이였기 때문이고, 그래서 그 상태의 단일 소유자가 렌더러였다. 셸 창에서는
  // 최대화가 그냥 창 최대화이고 안의 3영역이 자기 비율대로 늘어난다. 상태의
  // 소유자는 OS이므로 main에 위임하고, 표시는 아래 syncMaxButton()이 실제 창
  // 상태에서 파생한다(버튼이 자기 기억이 아니라 창을 말하게 한다 — 정보 정직성).
  $winMax.addEventListener('click', () => {
    window.athena.send('athena:toggle-maximize');
  });

  $winClose.addEventListener('click', () => {
    window.athena.send('athena:close-windows');
  });

  // 최대화 여부는 창 크기가 워크에어리어를 꽉 채웠는지로 파생한다. main에서
  // isMaximized()를 되물어오는 채널을 새로 파지 않는 이유: 그 왕복은 비동기라
  // resize 프레임마다 한 박자 늦은 라벨을 만든다. screen 좌표는 렌더러에서
  // 직접 읽을 수 있고(window.screen.avail*), 오차 허용치 4px면 DPI 반올림을
  // 흡수한다 — 라벨 하나를 위해 IPC 표면을 늘리지 않는다.
  function syncMaxButton() {
    const t = 4;
    const maximized = Math.abs(window.outerWidth - window.screen.availWidth) <= t
      && Math.abs(window.outerHeight - window.screen.availHeight) <= t;
    $winMax.classList.toggle('is-max', maximized);
    const label = maximized ? '이전 크기로 복원' : '최대화';
    $winMax.title = label;
    $winMax.setAttribute('aria-label', label);
  }

  window.addEventListener('resize', syncMaxButton);
  syncMaxButton();

  // ---------- 창 단축키 ----------
  // 주 경로는 Windows 네이티브 Win+방향키다(main.js가 before-input-event로 직접
  // 처리한다 — WIN_ARROW_DIR). Ctrl+Alt+방향키는 보조 경로이고 같은 의미론을 쓴다:
  // ←/→는 좌/우 절반 배치, ↑은 최대화, ↓은 복원→최소화. 넷 다 창 상태라
  // main으로 넘긴다 — 옛 판에서 ↑/↓만 렌더러 로컬 함수를 부르던 이유(높이 상태의
  // 소유자가 렌더러였다)가 사라졌다.
  //
  // Ctrl+Alt 분기를 Ctrl 단독 분기(최소화)보다 먼저 검사해야 한다 — 그러지 않으면
  // 다른 Ctrl+Alt 조합에 Ctrl 로직이 샌다.
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.altKey) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        window.athena.send('athena:toggle-maximize', { force: 'maximize' });
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        window.athena.send('athena:toggle-maximize', { force: 'restore-or-minimize' });
        return;
      }
      const dir = { ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
      if (dir) {
        e.preventDefault();
        window.athena.send('athena:place-windows', { dir });
      }
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    // 2026-08-22 사용자 지시("스크롤 돌렸을 때 작았다가 커지는 것 하지 말고, UI
    // 설정에서만 글씨 크기랑 이런 걸 바꾸게 해달라"): Ctrl+=/-/0 배율 단축키와
    // Ctrl+휠 배율을 폐기했다. 크기는 설정 › 화면에서만 바뀐다.
    if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      window.athena.send('athena:minimize-windows');
    }
  });

  // ---------- 영역 간 버스 ----------
  window.AthenaShell = {
    revealChrome,
    syncMaxButton,
    // canvas.js가 등록한다. chat.js의 Esc(유휴 상태)가 부른다 — 옛 판에서 그
    // 키는 `athena:collapse-canvas` IPC로 캔버스 **창**을 닫았다. 닫을 창이
    // 없어진 뒤 남는 의미는 "쌓인 카드를 치운다"이고, 두 영역이 같은 문서에
    // 사는 지금은 IPC를 왕복할 이유가 없다.
    registerCanvasClear(fn) { hooks.clearCanvases = typeof fn === 'function' ? fn : null; },
    clearCanvases() {
      if (hooks.clearCanvases) hooks.clearCanvases();
    },
    // chat.js가 openSettings()를 등록한다 — 사이드바 계정 메뉴의 "설정" 항목
    // (Paper 보드 16)이 점·커맨드바와 동등한 진입로가 되려면 이 다리가 필요하다.
    registerOpenSettings(fn) { hooks.openSettings = typeof fn === 'function' ? fn : null; },
    openSettings() {
      if (hooks.openSettings) hooks.openSettings();
    },
  };
})();
