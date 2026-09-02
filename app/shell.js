(() => {
  'use strict';

  const $shell = document.getElementById('shell');
  const $dragStrip = document.getElementById('dragStrip');
  const $winControls = document.getElementById('winControls');
  const $winMin = document.getElementById('winMin');
  const $winMax = document.getElementById('winMax');
  const $winClose = document.getElementById('winClose');
  const nativeWindowControls = Boolean(window.location
    && /(?:^|[?&])shellHandoff=1(?:&|$)/.test(window.location.search || ''));
  if (document.documentElement && document.documentElement.classList) {
    document.documentElement.classList.toggle('uses-native-window-controls', nativeWindowControls);
  }

  // 영역이 등록하는 콜백. 서로 다른 <script>가 같은 문서에 살지만 모듈 경계는
  // 유지한다 — chat.js가 canvas.js의 내부 함수를 직접 부르지 않고 여기를 지난다.
  const hooks = {
    clearCanvases: null, openSettings: null, seedChatInput: null,
    // 과거 대화 열기(2026-09-02) — sidebar.js가 부르고 chat.js가 등록한다.
    // seedChatInput과 같은 이유로 여기를 지난다: 사이드바가 chat.js의 $history를
    // 직접 만지면 모듈 경계가 무너진다.
    openConversation: null,
    // 되물을 것들 카드(2026-09-02) — canvas.js의 확인 필요 배너가 부르고 chat.js가 등록한다.
    openBrainQuestions: null,
  };
  const chromeGeometryGeneration = window.crypto?.randomUUID?.()
    || `${performance.timeOrigin}-${Math.random()}`;
  let chromeGeometryRevision = 0;
  let chromeZoomFactor = 1;

  // ---------- 창 크롬 ----------
  function chromeRect(element) {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  function publishWindowChromeGeometry() {
    const titlebarStyle = window.getComputedStyle($dragStrip);
    const controlsStyle = window.getComputedStyle($winControls);
    const visible = !$dragStrip.hidden && titlebarStyle.display !== 'none'
      && titlebarStyle.visibility !== 'hidden';
    const overlayRect = nativeWindowControls
      ? window.navigator?.windowControlsOverlay?.getTitlebarAreaRect?.()
      : null;
    const titlebar = overlayRect && overlayRect.width > 0 && overlayRect.height > 0
      ? { x: overlayRect.x, y: overlayRect.y, width: overlayRect.width, height: overlayRect.height }
      : chromeRect($dragStrip);
    const nativeControls = overlayRect && overlayRect.right < window.innerWidth
      ? {
        x: overlayRect.right,
        y: overlayRect.y,
        width: window.innerWidth - overlayRect.right,
        height: overlayRect.height,
      }
      : null;
    window.athena.send('athena:window-chrome-geometry', {
      generation: chromeGeometryGeneration,
      revision: ++chromeGeometryRevision,
      zoomFactor: chromeZoomFactor,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      visible,
      titlebar,
      controls: nativeControls || (
        !$winControls.hidden && controlsStyle.display !== 'none'
        && controlsStyle.visibility !== 'hidden' ? chromeRect($winControls) : null
      ),
    });
  }

  function publishWindowChromeGeometryAfterLayout() {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(publishWindowChromeGeometry);
    } else {
      publishWindowChromeGeometry();
    }
  }

  // 부팅 연출(chat.js)이 끝나야 창이 확정된다 — 그 전에는 크롬도 셸도 없다.
  // 옛 판에서 chat.js finishBoot()가 하던 세 줄이 여기로 왔다.
  function revealChrome() {
    $shell.hidden = false;
    $dragStrip.hidden = false;
    $winControls.hidden = nativeWindowControls;
    publishWindowChromeGeometryAfterLayout();
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

  // 프레임리스 창도 최대화 상태의 소유자는 OS다. 멀티 모니터·DPI·작업 표시줄
  // 위치에 따라 outerWidth/availWidth 기하 비교는 오판할 수 있으므로 main의
  // BrowserWindow maximize/unmaximize 이벤트에서 보낸 권위 있는 상태만 그린다.
  function syncMaxButton({ maximized = false } = {}) {
    $winMax.classList.toggle('is-max', maximized);
    const label = maximized ? '이전 크기로 복원' : '최대화';
    $winMax.title = label;
    $winMax.setAttribute('aria-label', label);
  }

  window.athena.on('athena:window-state', syncMaxButton);
  window.athena.on('athena:zoom-changed', ({ zoom } = {}) => {
    if (Number.isFinite(zoom) && zoom > 0) chromeZoomFactor = zoom;
    publishWindowChromeGeometryAfterLayout();
  });
  window.addEventListener('resize', publishWindowChromeGeometryAfterLayout);
  syncMaxButton({ maximized: false });
  publishWindowChromeGeometryAfterLayout();

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
    usesNativeWindowControls: nativeWindowControls,
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
    // chat.js가 등록한다 — 시트 없이 채팅 입력에 시작 문장을 심고 포커스만
    // 옮기는 43번 "새 작업은 채팅에서" 원칙의 공용 진입로다(7단계 제안 카드
    // "추가"가 첫 사용처. sidebar.js의 selectRoutineItem처럼 $input을 직접
    // 참조하지 않는 영역이 이 다리를 쓴다).
    registerSeedChatInput(fn) { hooks.seedChatInput = typeof fn === 'function' ? fn : null; },
    seedChatInput(text) {
      if (hooks.seedChatInput) hooks.seedChatInput(text);
    },
    // 과거 대화 열기 — chat.js가 등록한다. 돌려주는 값은 열었는지 여부다
    // (거절될 수 있다: 답변 중이면 화면을 갈아치우지 않는다).
    registerOpenConversation(fn) { hooks.openConversation = typeof fn === 'function' ? fn : null; },
    openConversation(conv) {
      return hooks.openConversation ? hooks.openConversation(conv) : false;
    },
    // 되물을 것들 카드를 연다. 돌려주는 값은 열었는지 여부다(물을 것이 없거나
    // 답변 중이면 열지 않는다) — 부른 쪽이 대신 다른 안내를 할 수 있어야 한다.
    registerOpenBrainQuestions(fn) { hooks.openBrainQuestions = typeof fn === 'function' ? fn : null; },
    openBrainQuestions() {
      return hooks.openBrainQuestions ? hooks.openBrainQuestions() : false;
    },
  };
})();
