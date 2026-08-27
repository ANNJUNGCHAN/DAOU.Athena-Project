const MODULE_LOAD_AT = Date.now();
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, Notification, nativeTheme } = require('electron');
const { performance } = require('node:perf_hooks');
const path = require('path');
const fs = require('fs');

const onboarding = require('./lib/main/onboarding');
const cliAccounts = require('./lib/main/cli-accounts');
const accounts = require('./lib/main/accounts');
const prefs = require('./lib/main/prefs');
const modelPrefs = require('./lib/main/model-prefs');
const codexConfig = require('./lib/main/codex-config');
const { computeShellPlacement } = require('./lib/main/window-placement');
// 알림 오브 창(2026-08-24 리프 1.3.1) — 창 기하·옵션은 전부 저 모듈이 진다.
const orbWindow = require('./lib/main/orb-window');
const mcpCli = require('./lib/main/mcp-cli');
const mcpEnv = require('./lib/main/mcp-env');
// 결정 D1의 실배선 — claude -p 스폰 + stream-json 파싱 + .mcp.json 생성.
const { runClaudeQuery } = require('./lib/main/claude-runner');
// 툴 호출 진행 단계(board-33) 라벨링에 render_canvas 판정 하나만 빌려 쓴다 —
// 파서 자체는 손대지 않는다(sendLiveToolStep 근처 주석 참고).
const streamJsonParser = require('./lib/main/stream-json-parser');
const { ensureMcpConfig } = require('./lib/main/mcp-config');
const { buildLivePrompt } = require('./lib/main/live-prompt');
const restDatasetRunner = require('./lib/main/rest-dataset-runner');
const chartReload = require('./lib/main/chart-reload');
const chartReloadAuthority = chartReload.createChartReloadAuthority();
const { correlationKey: restCorrelationKey } = require('./lib/rest-canvas-paint');
const { resolveWindowHtmlPath, waitForWindowReady } = require('./lib/main/window-readiness');
// 목업 데이터 로더 — 렌더러 격리 이관(2026-08-18). canvas.js가 더는 fs를
// 직접 못 쓴다 — athena:load-fixture가 이 모듈을 대신 호출해준다.
const mockdata = require('./lib/main/mockdata');
// 백엔드(FastAPI/uvicorn) 자동 기동 — 헬스체크 후 죽어 있을 때만 스폰한다(중복
// 스폰 금지, lib/main/backend-launcher.js 상단 주석 참고).
const backendLauncher = require('./lib/main/backend-launcher');
// 채팅 → HistoryStore 영속 훅(.omc/plans/plan-chat-graph-pipeline.md §2(a)/(g)).
// fire-and-forget — 절대 await로 채팅 UX를 막지 않는다(모듈 상단 주석 참조).
const historySink = require('./lib/main/history-sink');
const conversations = require('./lib/main/conversations');
const crypto = require('crypto');

const MDEBUGLOG = path.join(__dirname, 'captures', 'main-debug.log');
function mdlog(msg) {
  try { fs.appendFileSync(MDEBUGLOG, `${new Date().toISOString()} ${msg}\n`); } catch {}
}

mdlog('module loaded, ATHENA_NO_AUTOSTART: ' + process.env.ATHENA_NO_AUTOSTART);

// v2.js/v3.js와 동일 패턴 — 반드시 빈 핸들러여야 한다. 리스너 자체가 없으면
// Electron이 조용히 app.quit()해버리는 버그가 있다(S1 RESULT.md). 그렇다고
// 여기서 app.quit()을 호출하면 워밍업 창이 닫히는 순간(=그 시점의 "모든 창")
// 앱 전체가 죽는다 — 실제로 이 버그를 여기서 재현했다. 종료는 실제 창(셸 창)의
// 'closed' 이벤트에서만 한다.
app.on('window-all-closed', () => {
  mdlog('window-all-closed fired (no-op)');
});

// 진짜 종료(트레이 "종료", verify 하네스의 app.quit())를 표시하는 플래그.
// 2026-08-26부터 셸의 OS 레벨 닫기(Alt+F4)도 종료가 아니라 백그라운드 숨김이다 —
// 창 제어 ×(athena:close-windows)와 동일 동작. 오브 대화 모드(보드 33)가 셸 숨김을
// 전제로 하는데 Alt+F4가 앱을 통째로 죽이면 진입로 하나가 함정이 된다.
// 셸·오브 두 창의 'close'가 모두 이 플래그를 보고 종료/숨김을 가른다.
let isQuitting = false;
app.on('before-quit', () => {
  isQuitting = true;
  stopOrbCursorPoll(); // 인터벌 누수 금지 — 창이 죽기 전에 정리한다
  chartReloadAuthority.clear();
  // 우리가 스폰했을 때만 죽인다(backend-launcher.js의 backendChild 판정) — 사용자가
  // 별도 콘솔에서 수동 기동한 백엔드 인스턴스는 이 앱의 생애주기와 무관하게 산다.
  backendLauncher.shutdownBackend();
});

// ---------- 설계 치수 (Codex형 셸 창, 2026-08-24 리프 1.2.1) ----------
// 옛 판은 창 짝의 치수였다 — 캔버스 1120×580 위에 대화 창 640×176이 얹혔고,
// 대화 창은 캔버스 폭의 중앙에 정렬됐다(chatOriginX). 창이 하나가 되면서 그 세
// 치수가 **한 창의 폭·높이**로 접힌다:
//   폭 1520 = 중앙 캔버스 1120 + 우측 채팅 400(계약 폭, GLOSSARY §1).
//   높이 760 = 옛 캔버스 580 + 대화 창 176 + 크롬 여백. 채팅 영역은 이 높이를
//   그대로 쓰고 안에서 스크롤한다 — 창 높이로 자라던 auto-grow는 사라졌다.
// 좌측 이력 사이드바 268px(리프 1.2.2)이 붙으면 폭이 1788로 올라간다. 그때
// DESIGN을 고치는 것이 그 리프의 일이다 — 지금 미리 자리를 비워두지 않는다.
//
// 2026-08-22 축소 이력은 그대로 유효하다: 이 치수는 DIP라 배율 1.5 디스플레이에서
// 물리 픽셀로 1.5배가 된다. 화면이 설계 치수보다 작으면 비율 축소한다.
const DESIGN = {
  shellW: 1520, shellH: 760,
  // 하한 — 캔버스가 카드 1장을 담고 채팅 400px이 성립하는 최소 면적.
  minW: 900, minH: 480,
};

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function computeLayout() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  let scale = 1;
  if (DESIGN.shellW > sw || DESIGN.shellH > sh) {
    scale = Math.min(sw / DESIGN.shellW, sh / DESIGN.shellH, 1);
    console.log(`[layout] 화면(${sw}x${sh})이 설계 치수(${DESIGN.shellW}x${DESIGN.shellH})보다 작다 — 비율 축소 scale=${scale.toFixed(4)}`);
  } else {
    console.log(`[layout] 화면(${sw}x${sh})이 설계 치수를 그대로 수용 — 축소 없음`);
  }
  const shellW = Math.round(DESIGN.shellW * scale);
  const shellH = Math.round(DESIGN.shellH * scale);
  const originX = Math.floor((sw - shellW) / 2);
  const originY = Math.max(0, Math.floor((sh - shellH) / 2));
  return { scale, screen: { sw, sh }, shellW, shellH, originX, originY };
}

let layout;
let shellWin;
// 알림 오브 창 — 데스크톱 구석 상시 원형 창(GLOSSARY §1). 셸 창과 함께 OS 창 2개를
// 이룬다. orbExpanded/orbAnchor는 접힘↔펼침 왕복의 기준점이다 — 펼칠 때 계산한
// anchor를 들고 있어야 접을 때 오브를 정확히 제자리로 되돌린다(안 그러면 왕복할
// 때마다 오브가 화면을 조금씩 기어간다, orb-window.test.js가 이 불변을 고정한다).
let orbWin;
let orbExpanded = false;
let orbAnchor = 'bottom-right';

// ---------- 오브 커서 추적 — main 폴링 (2026-08-25) ----------
// 오브 창은 76px밖에 안 된다. 렌더러 mousemove는 커서가 그 76px 위에 있을 때만
// 발생하므로, "커서가 오브에서 떨어져 있고 그 방향을 오브가 눈으로 좇아야 하는"
// 정작 필요한 구간에는 이벤트가 전혀 안 들어온다. 그래서 main이
// screen.getCursorScreenPoint()를 직접 폴링해 오브 창 중심 기준 상대좌표를
// 계산해 밀어준다 — 렌더러 이벤트에 기댈 수 없는 구조적 한계의 우회다.
const ORB_CURSOR_POLL_MS = 60;
let orbCursorPollTimer = null;
let lastSentOrbCursor = null; // { dx, dy } — 억제 판정 기준

function stopOrbCursorPoll() {
  if (!orbCursorPollTimer) return;
  clearInterval(orbCursorPollTimer);
  orbCursorPollTimer = null;
  lastSentOrbCursor = null;
  // 폴링을 멈춘다는 것은 렌더러 입장에서 "커서 없음"이다 — 직전 좌표가 화면에
  // 남아 눈이 엉뚱한 방향을 보고 굳는 것을 막는다.
  if (orbWin && !orbWin.isDestroyed()) orbWin.webContents.send('athena:orb-cursor', null);
}

function startOrbCursorPoll() {
  if (orbCursorPollTimer) return; // 이미 돌고 있다 — 중복 인터벌 금지
  if (!orbWin || orbWin.isDestroyed() || !orbWin.isVisible()) return;
  orbCursorPollTimer = setInterval(() => {
    if (!orbWin || orbWin.isDestroyed() || !orbWin.isVisible()) {
      stopOrbCursorPoll();
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const bounds = orbWin.getBounds(); // 사용자가 오브를 끌면 매 틱 위치가 바뀐다
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const dx = cursor.x - centerX;
    const dy = cursor.y - centerY;
    // backgroundThrottling:false + alwaysOnTop 상주 창이라 60ms마다 무조건 쏘면
    // 그 자체로 상시 IPC 비용이 쌓인다 — 1px 미만 변화는 그냥 버린다.
    if (
      lastSentOrbCursor
      && Math.abs(dx - lastSentOrbCursor.dx) < 1
      && Math.abs(dy - lastSentOrbCursor.dy) < 1
    ) {
      return;
    }
    lastSentOrbCursor = { dx, dy };
    orbWin.webContents.send('athena:orb-cursor', { dx, dy, dist: Math.hypot(dx, dy) });
  }, ORB_CURSOR_POLL_MS);
}

// 셸 창을 사용자 앞으로 가져온다. 옛 판의 expandCanvasWindow()가 하던 "카드가
// 생겼으니 캔버스를 연다"의 자리를 대신한다 — 캔버스는 늘 떠 있으므로 열 것이
// 없고, 남는 의미는 **창을 앞으로**뿐이다. focus:false는 REST 직결 경로가 쓴다
// (3초 예산 안에서 사용자 포커스를 뺏지 않고 표면만 드러낸다).
function revealShell({ focus = true } = {}) {
  if (!shellWin || shellWin.isDestroyed()) return;
  if (shellWin.isMinimized()) shellWin.restore();
  if (!shellWin.isVisible()) {
    if (focus) shellWin.show(); else shellWin.showInactive();
  }
  shellWin.moveTop();
  if (focus) shellWin.focus();
}

// ---------- 셸 표시 여부 → 오브 (2026-08-26 board-33/34 "상태는 둘뿐이다") ----------
// 오브의 대화 모드는 셸이 숨겨졌는지 하나로 결정된다. 판정은 isVisible()이지만
// **최소화는 예외다** — 작업 표시줄에 남아 있으면 아직 셸을 쓰는 중이라고 본다
// (board-34 "예외·최소화"). 가려짐(다른 앱에 덮임)은 따로 판정하지 않는다 —
// 그 경우 isVisible()이 그대로 true라 자연히 셸 표시로 남는다(board-34 "예외·가려짐").
function isShellHidden() {
  if (!shellWin || shellWin.isDestroyed()) return false;
  return !shellWin.isVisible() && !shellWin.isMinimized();
}

function broadcastShellVisibility() {
  if (!orbWin || orbWin.isDestroyed()) return;
  orbWin.webContents.send('athena:shell-visibility', { hidden: isShellHidden() });
}

function commonWinOpts(bounds) {
  return {
    ...bounds,
    frame: false,
    // 2026-08-18 실측(qa-win-arrow.json): resizable:false에서는 Win+←/→/↑가 OS에
    // 선점돼 before-input-event에 아예 안 온다(mdlog 도달 0건 — Win+↓ 최소화만
    // OS가 실행). Windows 스냅(Win+방향키)이 이 앱에서 통하려면 창이 OS 스냅
    // 대상이어야 하므로 resizable:true다.
    // 2026-08-18 2차(사용자 지시): 크기 잠금(min=max)을 걷어냈다 — **가로·세로
    // 자유 리사이즈**가 사양이다. 하한(setMinimumSize)만 남기고 상한은
    // 없다. OS 스냅과 사용자 리사이즈의 구분은 handleForeignArrange의 반절 스냅
    // 기하 판별(looksLikeOsSnapHalf)이 맡는다.
    resizable: true,
    show: false,
    // alwaysOnTop을 걸지 않는다(2026-08-17 결정) — 스파이크 시절 값이었지만, 다른
    // 앱 위에 영구히 떠서 "창을 내릴 수 없다"는 실사용 문제가 됐다. z순서는 OS에
    // 맡긴다. 짝 z순서를 유지하던 focus/restore 핸들러는 창이 하나가 되면서
    // 사라졌다(리프 1.2.1). 알림 오브 창(1.3.1)은 예외로 alwaysOnTop을 건다.
    backgroundColor: '#00000000',
    transparent: process.env.ATHENA_WINDOW_MATERIAL ? false : true,
    ...(process.env.ATHENA_WINDOW_MATERIAL
      ? { backgroundMaterial: process.env.ATHENA_WINDOW_MATERIAL }
      : {}),
    // 렌더러 격리(2026-08-18, 클로드 데스크탑 방식) — nodeIntegration:false +
    // contextIsolation:true + preload.js의 contextBridge 다리만 남긴다.
    // sandbox:true도 켠 채로 동작한다(preload가 require('electron')만 쓴다 —
    // 실측: npm test 110건 + npm run verify 전체 통과, 흔들리면 여기 주석에 사유를 남기고 끈다).
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      // 2026-08-19 QA 결함 #2 원인 격리 — 셸 창은 배경으로 물러난 채로도 실시간
      // 데이터를 갱신해야 한다(다른 앱을 쓰는 동안 감시가 돈다).
      // 기본값(true)에서는 배경/비포커스 창의 컴포지터 프레임 생성이 스로틀돼
      // capturePage()가 hide()→show() 직후 몇 프레임을 묵은 프레임으로 돌려줄
      // 수 있다(verify.js 19/20 캡처가 검증9d의 배경 전환 이후 검증10 시점
      // 프레임에 고정된 채 안 바뀐 실측 — DOM/JS 상태는 매번 옳았는데 캡처만
      // 굳어 있었다, 즉 렌더 실패가 아니라 캡처 스로틀링이었다). 실사용에서도
      // 같은 스로틀이 "캔버스 창이 배경에 있는 동안 실시간 데이터가 안 갱신되는
      // 것처럼 보이는" 잠재 결함이라 검증 스크립트뿐 아니라 여기(생성 옵션)에서
      // 고친다.
      backgroundThrottling: false,
    },
  };
}

async function createWindows() {
  mdlog('createWindows start');
  layout = computeLayout();
  mdlog('layout computed ' + JSON.stringify(layout));

  // S1에서 발견된 환경 이슈: 프로세스의 "첫 번째" show()된 창이 OS 합성에서
  // topmost로 안정적으로 올라오지 않는 경우가 있었다. 워밍업 창으로 우회.
  const warmup = new BrowserWindow({ x: 10, y: 10, width: 10, height: 10, show: false, frame: false });
  const warmupReady = waitForWindowReady(warmup, { label: 'warmup window' });
  warmup.loadURL('data:text/html,<body></body>');
  mdlog('warmup created, waiting ready-to-show');
  await warmupReady;
  mdlog('warmup ready-to-show fired');
  warmup.show();
  await wait(300);
  warmup.close();
  await wait(80);
  mdlog('warmup done, creating shellWin');

  shellWin = new BrowserWindow(commonWinOpts({
    x: layout.originX, y: layout.originY, width: layout.shellW, height: layout.shellH,
  }));
  const shellReady = waitForWindowReady(shellWin, { label: 'shell window' });
  // 크기 잠금 해제(2026-08-18 사용자 지시 — "무조건 가로세로 모두 조정 가능해야
  // 한다"). 설계 치수는 부팅 기본값일 뿐 불변 계약이 아니다. 완전 잠금(min=max)이면
  // Win+↑의 OS maximize가 이벤트도 없이 무시된다는 실측(qa-win-arrow)은 여전히
  // 유효하다 — 지금은 잠금 자체가 없다. 하한만 건다.
  shellWin.setMinimumSize(DESIGN.minW, DESIGN.minH);
  shellWin.loadFile(resolveWindowHtmlPath(__dirname, 'shell.html'));
  mdlog('shellWin created + loadFile called');

  noteAppBounds(shellWin);

  await shellReady;
  mdlog('shell ready-to-show fired');

  await shellWin.webContents.executeJavaScript('1');
  mdlog('shellWin executeJavaScript done');
  shellWin.show();
  mdlog(`창 표시까지 ${Date.now() - MODULE_LOAD_AT} ms`);
  shellWin.focus();
  shellWin.moveTop();

  shellWin.webContents.send('athena:init', {
    scale: layout.scale,
    // 기본은 실배선(live)이다 — ATHENA_CANVAS_SOURCE=fixture일 때만 목업 경로를
    // 쓴다. verify.js가 이 변수를 명시적으로 세팅한다(quota를 쓰는 실제 claude -p
    // 호출을 자동 검증에서 피하려고). 사람이 쓰는 npm start는 항상 live다.
    canvasSource: process.env.ATHENA_CANVAS_SOURCE === 'fixture' ? 'fixture' : 'live',
  });

  // 2026-08-26 board-33 오브 대화 진단 후속 — 셸의 OS 레벨 닫기(Alt+F4 등,
  // 커스텀 #winClose 버튼을 거치지 않는 경로)도 종료가 아니라 백그라운드
  // 숨김이어야 한다. 위 주석(58줄)의 옛 결정("셸 창의 닫기는 곧 종료다")을
  // 뒤집는다 — #winClose만 숨기고 Alt+F4는 앱을 통째로 죽이던 비대칭이
  // "오브랑 대화가 안 된다"는 실사용 신고의 유력 원인이었다(사용자가 습관적
  // Alt+F4로 종료해버리면 애초에 셸 숨김 상태에 진입할 수가 없다). 진짜 종료는
  // 트레이 메뉴("종료")로만 하도록 좁힌다 — isQuitting은 그 경로(app.quit())가
  // 먼저 세운 뒤에야 닫기를 통과시킨다(오브 창의 close 핸들러와 같은 패턴).
  shellWin.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    ensureTray(); // 숨기기 전에 복귀 경로부터 확보한다 — athena:close-windows와 동일한 순서
    hideToBackground();
  });

  shellWin.on('closed', () => app.quit());

  // ---------- 알림 오브 창 (2026-08-24 리프 1.3.1) ----------
  // 셸 창 다음에 만든다 — 오브의 "더보기"가 셸을 앞으로 가져오므로 셸이 먼저 있어야 한다.
  // 부팅 시 곧바로 보인다: 상시 표시가 사양이고(GLOSSARY §1), 숨어 있으면 알림이
  // 와도 사용자가 볼 표면이 없다.
  const orbDisplay = screen.getDisplayMatching(shellWin.getBounds());
  const created = orbWindow.createOrbWindow({
    BrowserWindow,
    appDir: __dirname,
    workArea: orbDisplay.workArea,
  });
  orbWin = created.win;
  const orbReady = waitForWindowReady(orbWin, { label: 'orb window' });
  await orbReady;
  orbWin.showInactive(); // 포커스를 뺏지 않는다 — 셸 창이 방금 focus()를 가져갔다
  mdlog(`orbWin created + shown at ${JSON.stringify(created.bounds)}`);

  // Alt+F4가 오브에 직접 오면 흡수한다 — 오브를 닫는 것은 앱 종료가 아니다.
  // isQuitting이면(before-quit 이후) 진짜 종료 경로이므로 막지 않는다.
  orbWin.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    orbWin.hide();
  });

  // 오브 창이 76px이라 렌더러 mousemove는 커서가 창 위에 있을 때만 온다 — 정작
  // 눈이 커서를 따라가야 할 "떨어져 있을 때"는 좌표가 렌더러에 아예 안 들어온다.
  // 그래서 main이 화면 전역 커서를 폴링해 오브 중심 기준 상대좌표를 밀어준다.
  orbWin.on('show', startOrbCursorPoll);
  orbWin.on('hide', stopOrbCursorPoll);
  orbWin.on('closed', stopOrbCursorPoll);
  startOrbCursorPoll(); // showInactive() 직후라 이미 보이는 상태 — hide 전까지 돈다

  // 셸 표시/숨김 전이마다 오브에 알린다(board-33/34). show/hide/minimize/restore
  // 네 이벤트가 hideToBackground·revealShell·athena:minimize-windows·OS 복원을
  // 전부 덮는다 — 새 판정 지점을 늘리지 않고 기존 창 수명 이벤트에 얹는다.
  for (const ev of ['show', 'hide', 'minimize', 'restore']) {
    shellWin.on(ev, broadcastShellVisibility);
  }
  broadcastShellVisibility(); // 부팅 직후 초기 상태 — 셸이 막 show()된 뒤라 '표시'다

  // ---------- 창 기본 기능 (2026-08-17) — frame:false라 OS 타이틀바가 없어 직접 배선 ----------
  // Win+방향키(2026-08-18) — OS 창 스냅과 같은 손버릇. globalShortcut은 다른 앱과
  // 전역 충돌 위험이 있어 쓰지 않고(electron#9206), 창의 webContents에
  // before-input-event로만 건다 — OS(Windows 자체 스냅)가 먼저 먹으면 이벤트가
  // 그냥 안 올 뿐이라 무해하다.
  wireWindowsKeyShortcuts(shellWin);
  wireOsSnapEvents(shellWin);

  // 루틴 알림 구독 시작(2026-08-19 능동 에이전트 P2) — fixture면 내부에서 no-op.
  startRoutineFeed();
  // 캔버스 사이드 채널 구독(2026-08-19 데이터 지름길) — 게이트웨이가 채운 카드가
  // 모델 스트림을 안 타고 이 WS로 직접 온다("캔버스 먼저, 채팅은 요약만").
  startCanvasFeed();
}

// ---------- 루틴 알림 — 백엔드 WS 구독 → 토스트 + 능동 턴 (실행계획 P2) ----------
// 백엔드가 상시 감시(파수꾼)를 돌리고, 앱은 표시만 담당한다. 본문은 결정론
// 템플릿(lib/routine-turn.js — LLM 0)이라 지어낼 수 없다.
const { RoutineFeed } = require('./lib/main/routine-feed');
const routineTurn = require('./lib/routine-turn');

const BACKEND_HTTP_BASE = process.env.ATHENA_BACKEND_URL || 'http://127.0.0.1:8010';
const BACKEND_WS_BASE = BACKEND_HTTP_BASE.replace(/^http/, 'ws');

// 로컬 베어러 토큰 — backend/.env 설정 배포에서 WS 피드(루틴·캔버스) 인증과
// history-sink(브레인 저장)가 이것을 쓴다. 메모리에만 존재(로깅 금지).
if (!process.env.ATHENA_LOCAL_BEARER_TOKEN) {
  const localToken = backendLauncher.readLocalBearerToken();
  if (localToken) process.env.ATHENA_LOCAL_BEARER_TOKEN = localToken;
}
const LOCAL_BEARER_TOKEN = process.env.ATHENA_LOCAL_BEARER_TOKEN || null;

let routineFeed = null;

function startRoutineFeed() {
  // 검증 결정론 보호 — verify.js(fixture)에서는 능동 피드를 돌리지 않는다.
  if (process.env.ATHENA_CANVAS_SOURCE === 'fixture') return;
  if (routineFeed) return;
  routineFeed = new RoutineFeed({
    url: `${BACKEND_WS_BASE}/api/v1/ws/routines`,
    token: LOCAL_BEARER_TOKEN, // 토큰 설정 배포는 모드 A 인증 봉투, 미설정이면 루프백 게이트
    onEvent: (event) => {
      // 능동 턴은 항상 이력에 쌓인다 — 토스트를 놓쳐도 다음 열람 때 남아 있다.
      if (shellWin && !shellWin.isDestroyed()) {
        shellWin.webContents.send('athena:routine-event', event);
      }
      // 같은 이벤트가 오브에도 간다(2026-08-24 리프 1.3.1). 두 표면이 같은 원장
      // 행을 각자 렌더할 뿐이고 백엔드 신규 경로는 0건이다 — 설계서 §판단서 요지.
      if (orbWin && !orbWin.isDestroyed()) {
        orbWin.webContents.send('athena:routine-event', event);
      }
      if (event && (event.type === 'routine-fired' || event.type === 'routine-restore-failed')) {
        const toast = routineTurn.buildToast(event);
        const n = new Notification({ title: toast.title, body: toast.body });
        n.on('click', () => { restoreFromBackground(); });
        n.show();
      }
    },
    onStatus: () => {},
  });
  routineFeed.start();
}

app.on('will-quit', () => { if (routineFeed) routineFeed.stop(); });

// ---------- 차트 실시간 진행봉 — 키움 REAL 0B → 렌더러 ----------
// 접기(진행봉 갱신)는 렌더러가 한다(lib/chart-tick-fold.js 주석). 여기서는
// 종목 등록과 체결 전달만 맡는다. 업스트림 구독은 프로세스당 하나다.
const chartRealtime = require('./lib/main/chart-realtime');
const chartSeries = require('./lib/main/chart-series');

let chartRealtimeFeed = null;
let chartRealtimeRegistrar = null;

// 차트 전용이 아니다 — authority.operationArgs.stk_cd 폴백 덕에 종목코드가 있는
// REST 데이터셋 카드라면 어느 카드종이든(시세 카드 포함, 단계 8 확장) 여기서
// 등록된다. 호출부(athena:rest-canvas-painted)도 canvas_type을 안 가린다 —
// "그려진 걸 확인한 뒤에만 REG" 원칙만 카드종 공통이면 된다.
function ensureChartRealtime(authority) {
  if (process.env.ATHENA_CANVAS_SOURCE === 'fixture') return; // 검증 결정론 보호
  const stock = authority && authority.chartBody && authority.chartBody.stock;
  const code = String(stock || (authority && authority.operationArgs && authority.operationArgs.stk_cd) || '').trim();
  if (!code) return;

  if (!chartRealtimeRegistrar) {
    chartRealtimeRegistrar = chartRealtime.createRealtimeRegistrar({
      backendBase: BACKEND_HTTP_BASE,
      mdlog,
    });
  }
  if (!chartRealtimeFeed) {
    chartRealtimeFeed = new RoutineFeed({
      url: `${BACKEND_WS_BASE}/api/v1/ws/stream`,
      token: LOCAL_BEARER_TOKEN,
      onEvent: (frame) => {
        if (!shellWin || shellWin.isDestroyed()) return;
        // 거래일은 체결 시각(HHMMSS)에 날짜가 없어서 필요하다. 자정을 넘긴
        // 시간외 체결은 다음 날로 접히지만, 정규장 진행봉에는 영향이 없다.
        const ticks = chartRealtime.parseRealFrame(frame, chartRealtime.kstTradingDate());
        if (!ticks.length) return;
        shellWin.webContents.send('athena:chart-ticks', ticks);
      },
      onStatus: (s) => { if (s && s.state) mdlog(`차트 실시간 피드: ${s.state}`); },
    });
    chartRealtimeFeed.start();
  }
  chartRealtimeRegistrar.ensureSymbol(code).catch((err) => {
    mdlog(`차트 REAL 등록 예외: ${String((err && err.message) || err)}`);
  });
}

app.on('will-quit', () => { if (chartRealtimeFeed) chartRealtimeFeed.stop(); });

// ---------- 캔버스 사이드 채널 — 백엔드 WS 구독 → 카드 직접 렌더 (데이터 지름길) ----------
// render_canvas(plan_token) 경로에서 게이트웨이가 채운 봉투는 모델 스트림(툴 결과)
// 대신 이 채널로 온다 — CLI 잘림 한도와 무관하고, 모델이 답을 쓰는 동안 카드가
// 먼저 뜬다(2026-08-19 사용자 지시 "캔버스 우선 구성 → 필요 정보만 뽑아 답변").
let canvasFeed = null;

function startCanvasFeed() {
  if (process.env.ATHENA_CANVAS_SOURCE === 'fixture') return; // 검증 결정론 보호
  if (canvasFeed) return;
  canvasFeed = new RoutineFeed({
    url: `${BACKEND_WS_BASE}/api/v1/ws/canvas`,
    token: LOCAL_BEARER_TOKEN,
    onEvent: (envelope) => {
      if (!envelope || !envelope.canvas_type) return;
      // 옛 판은 여기서 캔버스 창을 열었다(expandCanvasWindow). 중앙 캔버스는 늘
      // 떠 있으므로 남는 의미는 "창을 앞으로"뿐이다 — 포커스는 뺏지 않는다.
      revealShell({ focus: false });
      sendLiveCanvasResult({
        toolUseId: 'canvas-push',
        status: envelope.fell_back ? 'fallback' : 'success',
        envelope,
      });
    },
    onStatus: () => {},
  });
  canvasFeed.start();
}

app.on('will-quit', () => { if (canvasFeed) canvasFeed.stop(); });

// 루틴 REST 프록시 — 렌더러는 백엔드에 직접 붙지 않는다(기존 IPC 관례).
// confirm/cancel은 **사람 클릭 전용** 경로다(실행계획 §7-6 — 모델 툴에는 없다).
async function routineHttp(method, path) {
  const res = await fetch(`${BACKEND_HTTP_BASE}${path}`, { method });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, error: body.detail || `HTTP ${res.status}` };
  }
  return { ok: true, data: body };
}

ipcMain.handle('athena:order-execute', async (_e, { trId, body, idempotencyKey }) => {
  if (!/^kt1000[01]$/.test(String(trId))) {
    return { ok: false, status: 0, error: '허용되지 않는 주문 TR' };
  }
  try {
    const res = await fetch(`${BACKEND_HTTP_BASE}/api/v1/order/${trId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Athena-Confirm': 'true',
        'Idempotency-Key': String(idempotencyKey || ''),
        Authorization: `Bearer ${process.env.ATHENA_LOCAL_BEARER_TOKEN || ''}`,
      },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok
      ? { ok: true, status: res.status, data }
      : { ok: false, status: res.status, error: data.detail || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('athena:routines-list', async () => {
  try { return await routineHttp('GET', '/api/v1/routines'); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
ipcMain.handle('athena:routine-confirm', async (_e, { id }) => {
  try { return await routineHttp('POST', `/api/v1/routines/${encodeURIComponent(id)}/confirm`); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
ipcMain.handle('athena:routine-cancel', async (_e, { id }) => {
  try { return await routineHttp('POST', `/api/v1/routines/${encodeURIComponent(id)}/cancel`); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

// ---------- OS 스냅 이벤트 정착 (2026-08-18 승급 — qa-win-arrow.json 실측 근거) ----------
// resizable:true 승급으로 Windows가 Win+←/→(스냅)·Win+↑(최대화)·Win+↓(최소화)를
// 직접 실행하게 됐다. 그 결과 이벤트를 받아 앱이 의미론을 정착시킨다:
//   moved/resized → 반절 스냅 기하면 placeWindows(left/right)로 우리 레이아웃에
//                   정착(크기 불변). 아니면 사용자 리사이즈·이동으로 그냥 수용한다.
//   maximize      → OS 최대화를 그대로 둔다(아래 wireOsSnapEvents 주석 참조).
//   minimize      → 창이 하나라 짝 맞춤이 필요 없다 — OS에 맡긴다.
// settlingSnap 가드: placeWindows의 setBounds가 다시 moved를 발화시키는 재진입을 막는다.
let settlingSnap = false;

// 앱이 마지막으로 지정한 bounds. 여기서 벗어난 moved/resized는 전부 OS 주도
// (Win+←/→ 스냅 등)다 — frame:false라 사용자가 OS 경로로 창을 움직일 방법은
// 스냅과 네이티브 캡션 드래그뿐이고, 앱 주도 이동(placeWindows·centerWindows)은
// 전부 이 맵을 갱신하고 지나간다. win.snapped는 크기 잠금 창에서 안 선다는 것이
// 실측됐다(2026-08-18 qa-win-arrow 2차) — 그래서 스냅 플래그가 아니라 기대 좌표
// 대조로 감지한다.
const expectedBounds = new Map();

function noteAppBounds(win) {
  if (win && !win.isDestroyed()) expectedBounds.set(win, win.getBounds());
}

function boundsDiffer(a, b) {
  return !a || !b || Math.abs(a.x - b.x) > 2 || Math.abs(a.y - b.y) > 2
    || Math.abs(a.width - b.width) > 2 || Math.abs(a.height - b.height) > 2;
}

// 반절 스냅 기하 판별(2026-08-18 자유 리사이즈 승급) — Win+←/→ 스냅의 결과는
// "높이≈workArea 전체, 폭≈절반, 좌/우 가장자리 접변"이라는 뚜렷한 기하를 남긴다.
// 이 기하와 일치할 때만 OS 스냅으로 판정한다. 이전 판은 기대 좌표에서 벗어난
// 모든 변화를 스냅으로 정착시켰는데, 자유 리사이즈가 열린 뒤에는 그 대다수가
// 사용자 모서리 리사이즈라 — 정착이 곧 "방금 조절한 크기를 설계 치수로 되돌리는
// 버그"가 된다.
function looksLikeOsSnapHalf(actual, wa) {
  const t = 8;
  const nearlyFullH = Math.abs(actual.height - wa.height) <= t;
  const nearlyHalfW = Math.abs(actual.width - Math.round(wa.width / 2)) <= t;
  const atLeft = Math.abs(actual.x - wa.x) <= t;
  const atRight = Math.abs((actual.x + actual.width) - (wa.x + wa.width)) <= t;
  return nearlyFullH && nearlyHalfW && (atLeft || atRight);
}

function handleForeignArrange(win) {
  if (settlingSnap) return;
  if (!win || win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
  const actual = win.getBounds();
  const prev = expectedBounds.get(win);
  if (!boundsDiffer(prev, actual)) return;
  const display = screen.getDisplayMatching(actual);
  const wa = display.workArea;
  if (!looksLikeOsSnapHalf(actual, wa)) {
    // 네이티브 캡션 드래그(순수 이동)든 모서리 리사이즈든, 창이 하나면 결론이
    // 같다 — 새 위치·크기를 그대로 수용하고 기준점만 갱신한다. 옛 판의 짝 팔로우
    // 분기와 대화 창 높이 앵커 분기는 리프 1.2.1에서 사라졌다.
    noteAppBounds(win);
    return;
  }
  const dir = (actual.x + actual.width / 2) < (wa.x + wa.width / 2) ? 'left' : 'right';
  mdlog(`os-arrange 감지(shell): ${JSON.stringify(actual)} -> ${dir} 정착`);
  settlingSnap = true;
  try { placeWindows(dir); } finally {
    setTimeout(() => { settlingSnap = false; }, 250);
  }
}

function wireOsSnapEvents(win) {
  // 키보드 스냅(Win+←/→)은 드래그 모달 루프가 없어 과거형 이벤트(moved/resized)가
  // 안 온다(2026-08-18 3차 실측 — 스냅됐는데 정착 로그 0건). 현재형(move/resize)을
  // 디바운스로 받아 OS 배치가 끝난 뒤 한 번만 판정한다. 앱 주도 setBounds도 같은
  // 이벤트를 쏘지만 expectedBounds 대조(handleForeignArrange)가 걸러낸다.
  let arrangeTimer = null;
  const queueArrange = () => {
    if (settlingSnap || win.isMaximized()) return;
    clearTimeout(arrangeTimer);
    arrangeTimer = setTimeout(() => handleForeignArrange(win), 120);
  };
  win.on('move', queueArrange);
  win.on('resize', queueArrange);
  win.on('moved', queueArrange);
  win.on('resized', queueArrange);
  // 최대화·최소화는 이제 OS에 그대로 맡긴다(2026-08-24 리프 1.2.1).
  // 옛 판은 OS 최대화를 즉시 되돌리고(unmaximize) 대화 창의 높이 토글
  // (chatBaseH↔chatMaxH)에 위임했다 — 창 높이가 곧 대화 이력의 높이였기 때문이다.
  // 셸 창에서는 최대화가 그냥 창 최대화이고 그 안의 3영역은 자기 비율대로 늘어난다.
  // 되돌릴 이유도, 위임할 렌더러 상태도 없어졌으므로 핸들러 자체를 지웠다.
  // 최대화 상태에서는 handleForeignArrange가 조기 반환하므로(isMaximized 가드)
  // 스냅 정착이 최대화를 깨뜨리지도 않는다.
  win.on('maximize', () => noteAppBounds(win));
  win.on('unmaximize', () => noteAppBounds(win));
}

// ---------- 창 이동 — 네이티브 캡션(-webkit-app-region) (2026-08-19 표준화) ----------
// 구판은 렌더러 mousedown → 커서 폴링(athena:window-drag)으로 창을 옮겼다 —
// 지연·비네이티브 감각·가장자리 끌기 스냅 부재로 폐기(사용자 지시 "평범한
// 앱처럼"). 드래그 손잡이는 CSS가 선언한다: 셸 창 상단 타이틀바 #dragStrip과
// 설정/주문 헤더(shell.css·chat.css). 이동 자체는 OS(DWM)가 수행하므로 네이티브
// 타이틀바와 같은 감각이고 가장자리 끌기 스냅도 함께 생겼다. 본문(.history·
// .grid)은 손잡이가 아니다 — 텍스트 선택·스크롤이 본연의 동작이다.
// 구판의 DPI 성장 버그(5e0a9ab)는 폴링 경로 자체가 사라져 소멸 — 검증11이 회귀
// 가드를 계승한다.

// ---------- 최소화(창 내리기) ----------
ipcMain.on('athena:minimize-windows', () => {
  if (shellWin && !shellWin.isDestroyed()) shellWin.minimize();
});

// ---------- 창 배치(스냅) — Windows 표준 창 단축키 의미론 (2026-08-18, 최종 정본) ----------
// 목표는 자체 조합이 아니라 **Win+방향키가 이 앱에서 OS 표준 창 단축키와 같은
// 뜻으로 통하는 것**이다. 매핑은 Windows 의미론을 그대로 따른다:
//   Win+←/→ = 셸 창을 현재 디스플레이 workArea 좌/우 절반에 배치(크기 불변).
//   Win+↑   = 최대화.
//   Win+↓   = 최대화 상태면 복원, 아니면 최소화 — Windows의 "restore-then-minimize".
//
// 좌우 배치의 좌표 계산은 lib/main/window-placement.js(순수 함수, Electron
// 의존 없음, 단위 테스트됨)로 뺐다 — 결과를 그대로 setBounds에 먹인다. 크기는
// 항상 명시적으로 재지정한다(setBounds({x,y,width,height})) — x/y만 옮기는
// setPosition()은 DPI 배율 화면에서 반올림이 누적돼 창이 자라는 버그가 있었다
// (커밋 5e0a9ab, 드래그 폴링 L249-254와 같은 이유).
//
// 스냅은 **현재 창 크기를 유지한다**. 부팅 설계 치수로 되감지 않는다 — 사용자가
// 방금 조절한 크기를 배치가 덮어쓰면 그게 곧 버그다(2026-08-18 자유 리사이즈 승급).
function placeWindows(dir) {
  if (!shellWin || shellWin.isDestroyed()) return;
  if (dir !== 'left' && dir !== 'right') return; // up/down은 아래 wireWindowsKeyShortcuts

  const current = shellWin.getBounds();
  const display = screen.getDisplayMatching(current);
  const placement = computeShellPlacement(dir, display.workArea, {
    width: current.width, height: current.height,
  });
  shellWin.setBounds(placement.bounds);
  noteAppBounds(shellWin);
}

ipcMain.on('athena:place-windows', (e, { dir } = {}) => placeWindows(dir));

// 창 최대화 — 창 제어 □ 버튼(force 없음)과 Ctrl+Alt+↑/↓(force 지정)가 공유한다.
// Win+↑/↓는 before-input-event가 같은 의미론으로 직접 처리한다(wireWindowsKeyShortcuts).
ipcMain.on('athena:toggle-maximize', (e, { force } = {}) => {
  if (!shellWin || shellWin.isDestroyed()) return;
  if (force === 'maximize') { shellWin.maximize(); return; }
  if (force === 'restore-or-minimize') {
    if (shellWin.isMaximized()) shellWin.unmaximize(); else shellWin.minimize();
    return;
  }
  if (shellWin.isMaximized()) shellWin.unmaximize(); else shellWin.maximize();
});

// ---------- 알림 오브 — 접힘/펼침, 더보기 (2026-08-24 리프 1.3.1) ----------
// 창 크기 변경을 main이 하는 이유: 기하가 **화면 좌표**에 묶여 있다. 오브 원은
// 펼쳐도 화면에서 안 움직여야 하고(패널이 안쪽으로 자란다), 그 방향은 오브가
// 지금 어느 사분면에 있느냐로 정해진다 — 렌더러는 자기 창의 화면 좌표를 모른다.
// height는 board-33(400 기본 · 콘텐츠 따라 가변 · 640 상한)을 위한 추가
// 필드다 — 새 채널이 아니라 기존 orb-toggle 계약에 얹었다(오브가 얻는 IPC를
// 늘리지 않는다는 제약과 맞추려는 선택). 얼굴(#orb)은 anchor로 화면에 고정돼
// 있어 높이가 바뀌어도 새로 계산할 게 없다 — 패널만 anchor 반대쪽으로 자란다.
function clampPanelHeight(height) {
  const n = Number.isFinite(height) ? height : orbWindow.EXPANDED_HEIGHT;
  return Math.min(orbWindow.EXPANDED_HEIGHT_MAX, Math.max(orbWindow.EXPANDED_HEIGHT, n));
}

ipcMain.on('athena:orb-toggle', (e, { expanded, height } = {}) => {
  if (!orbWin || orbWin.isDestroyed()) return;
  const next = !!expanded;
  const targetHeight = clampPanelHeight(height);

  if (next === orbExpanded) {
    // 이미 펼쳐진 채로 콘텐츠 높이만 바뀐 요청이다 — 접힘/펼침 자체는 아무
    // 일도 안 하므로 athena:orb-state는 다시 보내지 않는다(펼침 여부가 안
    // 바뀌었는데 보내면 렌더러가 또 한 번 unread를 확인 처리한다).
    if (next && orbWin.getBounds().height !== targetHeight) {
      const workArea = screen.getDisplayMatching(orbWin.getBounds()).workArea;
      const orbBounds = orbWindow.computeCollapsedBounds(orbWin.getBounds(), orbAnchor);
      const plan = orbWindow.computeExpandedBounds(orbBounds, workArea, { height: targetHeight });
      orbWindow.applyOrbBounds(orbWin, plan.bounds);
    }
    return;
  }

  if (next) {
    const workArea = screen.getDisplayMatching(orbWin.getBounds()).workArea;
    const plan = orbWindow.computeExpandedBounds(orbWin.getBounds(), workArea, { height: targetHeight });
    orbAnchor = plan.anchor;
    orbWindow.applyOrbBounds(orbWin, plan.bounds);
  } else {
    // 접을 때는 펼칠 때 쓴 anchor를 그대로 되쓴다 — 다시 계산하면 창이 이미
    // 커진 상태의 중심으로 사분면을 판정해 다른 답이 나올 수 있다.
    orbWindow.applyOrbBounds(
      orbWin,
      orbWindow.computeCollapsedBounds(orbWin.getBounds(), orbAnchor),
    );
  }
  orbExpanded = next;
  // 창 크기가 실제로 바뀐 뒤에 알린다 — 먼저 알리면 창보다 큰 패널이 한 프레임 잘린다.
  orbWin.webContents.send('athena:orb-state', { expanded: next, anchor: orbAnchor });
});

/**
 * 능동 턴 이벤트를 기존 `facts` 봉투로 접는다 — **신규 카드 타입 0개**
 * (main.js chatsToTableEnvelope와 같은 문법). 값은 이벤트 원장 행 그대로이고
 * 없는 필드는 줄을 만들지 않는다 — 빈 값을 채우면 "측정했는데 값이 없다"로 읽힌다.
 */
function routineEventToFactsEnvelope(event) {
  const candidates = [
    ['stk_cd', '종목', event.symbol],
    ['observed', '관측값', event.observed],
    ['threshold', '임계', event.threshold],
    ['source', '소스', event.source],
    ['mode', '감시 방식', event.mode ? routineTurn.describeMode(event.mode) : null],
    ['fired_at', '발화 시각', event.fired_at],
    ['routine', '루틴', event.note || event.routine_id],
  ];
  return {
    canvas_type: 'facts',
    // 시점 고지 — 캔버스에 쌓인 뒤에도 이 값이 발화 시점 기준임을 카드가 스스로 말한다.
    caption: '감시 발화 — 값은 발화 시점 기준입니다',
    fell_back: false,
    data: {
      fields: candidates
        .filter(([, , value]) => value !== null && value !== undefined && value !== '')
        .map(([key, label, value]) => ({ key, label, value: String(value) })),
    },
  };
}

// "더보기" · "대화창으로 가기" — 오브에서 셸로 가는 유일한 경로. 셸을 앞으로
// 가져오고, 알림에서 왔으면 대표 카드도 중앙 캔버스에 쌓는다. **주문은 여기서도
// 집행되지 않는다**(확정 결정 3) — 이 핸들러가 하는 일은 창을 올리고(+선택적으로
// 카드를 그리고) 끝이다.
// 2026-08-26 board-33/34 — event 없이도 부른다("대화창으로 가기"는 카드가 없다,
// 대화는 이미 같은 셸 세션에 이어져 있으므로 창만 앞으로 가져오면 된다).
ipcMain.on('athena:orb-open-shell', (e, { event } = {}) => {
  revealShell({ focus: true });
  if (event && typeof event === 'object') {
    sendLiveCanvasResult({ status: 'success', envelope: routineEventToFactsEnvelope(event) });
  }
});

// ---------- 오브 드래그 (2026-08-26 board-32) ----------
// orb.js가 pointermove의 movementX/Y(창 위치와 무관한 원시 이동량)를 그대로
// 보낸다 — main은 현재 getBounds()에 더해서 setPosition할 뿐이다. 오브 창은
// resizable:false지만 이건 이동이지 크기 변경이 아니라서 orb-window.js의
// applyOrbBounds(resizable 토글)가 필요 없다 — setPosition은 그대로 먹는다.
// anchor는 여기서 갱신하지 않는다 — 다음 펼침 때 orbWindow.computeExpandedBounds가
// orbWin.getBounds()를 다시 읽어 사분면을 새로 판정하므로 옮긴 자리에서도 저절로 맞는다.
ipcMain.on('athena:orb-drag-move', (e, { dx, dy } = {}) => {
  if (!orbWin || orbWin.isDestroyed()) return;
  const bounds = orbWin.getBounds();
  const nx = Math.round(bounds.x + (Number(dx) || 0));
  const ny = Math.round(bounds.y + (Number(dy) || 0));
  if (nx === bounds.x && ny === bounds.y) return;
  orbWin.setPosition(nx, ny);
});

// ---------- 셸 → 오브 실신호 릴레이 (2026-08-26 board-32) ----------
// chat.js가 input:focus/blur·질의 시작/끝·턴 완료를 보내면 그대로 오브에 되쏜다.
// 판단은 여기서 하지 않는다 — 얼굴을 언제 무엇으로 바꿀지는 orb.js가 정한다
// (routine-event를 그대로 릴레이만 하던 기존 패턴과 같다).
ipcMain.on('athena:orb-signal', (e, payload = {}) => {
  if (orbWin && !orbWin.isDestroyed()) orbWin.webContents.send('athena:orb-signal', payload);
});

// 기본 위치 복귀("center") — 셸 창을 부팅 좌표·부팅 치수로 되돌린다. 어떤 키·IPC
// 채널에도 매지 않는다(2026-08-18 Windows 표준 의미론 재정의로 Win+↑ 자리를
// 최대화가 가져갔다). verify.js 검증14가 직접 호출해 회귀를 잡는다.
function centerWindows() {
  if (!shellWin || shellWin.isDestroyed()) return;
  shellWin.setBounds({
    x: layout.originX, y: layout.originY, width: layout.shellW, height: layout.shellH,
  });
  noteAppBounds(shellWin);
}

// Win+방향키 — 1차 구현(보너스 아님, 주 경로). meta는 Windows 키(Electron의
// input.meta가 Windows에서 Win 키를 가리킨다). OS가 이 조합을 먼저 가로채면
// (실제 Windows 창 스냅) 이 핸들러엔 이벤트가 아예 안 온다 — 조합별 도달
// 여부를 mdlog로 남겨 QA 실측이 OS 선점 여부를 판정하게 한다(globalShortcut은
// 전역 충돌 위험 때문에 안 쓴다).
const WIN_ARROW_DIR = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

function wireWindowsKeyShortcuts(win) {
  win.webContents.on('before-input-event', (event, input) => {
    if (!input.meta || input.type !== 'keyDown') return;
    const dir = WIN_ARROW_DIR[input.key];
    if (!dir) return;
    mdlog(`win+arrow 도달: ${input.key} -> ${dir}`);
    event.preventDefault();
    if (dir === 'left' || dir === 'right') {
      placeWindows(dir);
      return;
    }
    if (!shellWin || shellWin.isDestroyed()) return;
    if (dir === 'up') {
      shellWin.maximize();
      return;
    }
    // Windows의 restore-then-minimize — 최대화 상태면 복원부터, 아니면 내린다.
    if (shellWin.isMaximized()) shellWin.unmaximize();
    else shellWin.minimize();
  });
}

// ---------- 닫기(백그라운드 유지) + 트레이 복귀 (AT-CH-001, 2026-08-18) ----------
// 닫기 버튼은 종료가 아니다 — 셸 창을 숨기고 프로세스(세션·자격증명·감시)는 그대로
// 산다(사용자 지시 "백그라운드는 살아있음"). 숨은 창은 작업 표시줄에도 없으므로
// 복귀 경로가 반드시 필요하다 — 그게 이 트레이다(브랜드 점 아이콘, 클릭=열기).
// Alt+F4 등 OS close 이벤트는 가로채지 않는다 — 그쪽은 여전히 진짜 종료다
// (셸 창 'closed' → app.quit()). 트레이 메뉴 "종료"도 같은 길로 나간다.
let tray = null;

// 이미지 에셋 없이 브랜드 점(#EE137B)을 16×16 비트맵으로 직접 그린다 — 대화 창의
// 점(.dot)과 같은 시각 언어다. BGRA + 프리멀티플라이(합성 시 검은 테두리 방지).
function buildTrayIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const r = 6.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - c, y - c) + 0.5)); // 1px 안티앨리어스
      const i = (y * size + x) * 4;
      buf[i] = Math.round(0x7b * a); // B
      buf[i + 1] = Math.round(0x13 * a); // G
      buf[i + 2] = Math.round(0xee * a); // R
      buf[i + 3] = Math.round(255 * a); // A
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function restoreFromBackground() {
  revealShell({ focus: true });
}

function hideToBackground() {
  if (shellWin && !shellWin.isDestroyed()) shellWin.hide();
}

function ensureTray() {
  if (tray) return;
  tray = new Tray(buildTrayIcon());
  tray.setToolTip('Athena');
  tray.on('click', restoreFromBackground);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '열기', click: restoreFromBackground },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]));
}

app.on('will-quit', () => {
  if (tray) { tray.destroy(); tray = null; }
});

ipcMain.on('athena:close-windows', () => {
  ensureTray(); // 숨기기 전에 복귀 경로부터 확보한다 — 순서가 안전장치다
  hideToBackground();
});

// ---------- 줌(화면 확대/축소) — Ctrl+= / Ctrl+- / Ctrl+0 / Ctrl+휠 ----------
// 창 크기는 그대로 두고 콘텐츠 배율만 바꾼다(브라우저 줌과 같은 문법).
let uiZoom = 1;

function applyUiZoom(dir) {
  const next = dir === 'reset' ? 1 : uiZoom * (dir === 'in' ? 1.1 : 1 / 1.1);
  uiZoom = Math.min(2, Math.max(0.5, Math.round(next * 100) / 100));
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.setZoomFactor(uiZoom);
    shellWin.webContents.send('athena:zoom-changed', { zoom: uiZoom });
  }
}

ipcMain.on('athena:zoom', (e, { dir } = {}) => applyUiZoom(dir));

ipcMain.on('athena:highlight-canvas', (e, type) => {
  if (shellWin && !shellWin.isDestroyed()) shellWin.webContents.send('athena:highlight-canvas', type);
});

const restPaintWaiters = new Map();
const restReceiptWaiters = new Map();

ipcMain.on('athena:rest-canvas-painted', (event, payload = {}) => {
  if (!shellWin || shellWin.isDestroyed() || event.sender !== shellWin.webContents) return;
  const key = restCorrelationKey({
    dataset_id: payload.dataset_id,
    item_id: payload.item_id,
    ordinal: payload.ordinal,
  });
  const waiter = key && restPaintWaiters.get(key);
  if (!waiter) return;
  restPaintWaiters.delete(key);
  waiter.cleanup();
  if (!payload.verified_visible) {
    waiter.reject(new Error(payload.error || 'REST 카드가 실제 표시되지 않았다'));
    return;
  }
  const paintResult = {
    verifiedVisible: true,
    visiblePaintAt: performance.now(),
    inlineToDomMs: Number(payload.inline_to_dom_ms) || 0,
    inlineToChartImportMs: payload.inline_to_chart_import_ms == null ? null : Number(payload.inline_to_chart_import_ms),
    chartImportToDomMs: payload.chart_import_to_dom_ms == null ? null : Number(payload.chart_import_to_dom_ms),
    domToPaintAckMs: Number(payload.dom_to_paint_ack_ms) || 0,
    renderState: payload.render_state || null,
    rendererId: payload.renderer_id || null,
    panelId: payload.panel_id || null,
    generation: payload.generation != null && Number.isInteger(Number(payload.generation)) ? Number(payload.generation) : null,
    rect: payload.rect || null,
  };
  chartReloadAuthority.registerPaint(paintResult, waiter.reloadAuthority);
  // 차트가 실제로 그려진 순간에만 실시간을 건다 — 그려지지도 않은 패널로 REG를
  // 소모하지 않는다(REG는 리미터를 먹는다). 종목당 1회는 registrar가 보장한다.
  ensureChartRealtime(waiter.reloadAuthority);
  waiter.resolve(paintResult);
});

ipcMain.on('athena:rest-receipt-painted', (event, payload = {}) => {
  if (!shellWin || shellWin.isDestroyed() || event.sender !== shellWin.webContents) return;
  const receiptId = String(payload.receipt_id || '');
  const waiter = restReceiptWaiters.get(receiptId);
  if (!waiter) return;
  restReceiptWaiters.delete(receiptId);
  waiter.cleanup();
  if (!payload.verified_visible) {
    waiter.reject(new Error(payload.error || 'REST 영수증이 실제 표시되지 않았다'));
    return;
  }
  waiter.resolve({ verifiedVisible: true, visiblePaintAt: performance.now(), rect: payload.rect || null });
});

ipcMain.on('athena:chart-panel-destroyed', (event, payload = {}) => {
  if (!shellWin || shellWin.isDestroyed() || event.sender !== shellWin.webContents) return;
  chartReloadAuthority.unregister(payload.panelId);
});

function emitRestReceiptAndWaitForPaint(text, { timeoutMs = 3000 } = {}) {
  if (!shellWin || shellWin.isDestroyed()) return Promise.reject(new Error('셸 창이 준비되지 않았다'));
  revealShell({ focus: true });
  const receiptId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      restReceiptWaiters.delete(receiptId);
      reject(new Error('REST 영수증 paint ack 3초 제한을 넘겼다'));
    }, timeoutMs);
    const cleanup = () => clearTimeout(timer);
    restReceiptWaiters.set(receiptId, { resolve, reject, cleanup });
    shellWin.webContents.send('athena:add-rest-receipt', { receiptId, text });
  });
}

async function emitRestCanvasAndWaitForPaint(payload, { expand = true, timeoutMs = 3000 } = {}) {
  if (!shellWin || shellWin.isDestroyed()) throw new Error('셸 창이 준비되지 않았다');
  // The direct REST lane has a hard three-second feedback budget. Reveal the
  // already-loaded surface without changing application focus. The renderer
  // uses backgroundThrottling:false and the paint contract itself verifies a
  // visible, nonzero card followed by two animation frames.
  if (expand) revealShell({ focus: false });
  const correlation = payload && payload.envelope && payload.envelope.correlation;
  const key = restCorrelationKey(correlation);
  if (!key) throw new Error('REST 카드 correlation이 완전하지 않다');
  if (restPaintWaiters.has(key)) throw new Error('같은 REST 카드 paint ack가 이미 대기 중이다');
  return new Promise((resolve, reject) => {
    let timer = null;
    const onAbort = () => {
      restPaintWaiters.delete(key);
      cleanup();
      reject(payload.signal && payload.signal.reason instanceof Error
        ? payload.signal.reason
        : new Error('REST 카드 표시가 중단됐다'));
    };
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (payload.signal) payload.signal.removeEventListener('abort', onAbort);
    };
    timer = setTimeout(() => {
      restPaintWaiters.delete(key);
      cleanup();
      reject(new Error('REST 카드 paint ack 3초 제한을 넘겼다'));
    }, timeoutMs);
    if (payload.signal) payload.signal.addEventListener('abort', onAbort, { once: true });
    const chart = payload && payload.envelope && payload.envelope.data && payload.envelope.data.chart;
    restPaintWaiters.set(key, {
      resolve,
      reject,
      cleanup,
      reloadAuthority: {
        correlation,
        operationRef: payload.operationRef,
        operationArgs: payload.operationArgs,
        chartBody: chart,
        chartMeta: payload && payload.envelope && payload.envelope.data && payload.envelope.data.chart_meta,
      },
    });
    shellWin.webContents.send('athena:add-rest-canvas', {
      envelope: payload.envelope,
      operationRef: payload.operationRef,
      operationArgs: payload.operationArgs,
      canvasType: payload.canvasType,
    });
  });
}

let liveMcpConfig = null; // 지연 생성 — app.getPath('userData')는 whenReady 이후에만 안전

function getLiveMcpConfig() {
  if (!liveMcpConfig) liveMcpConfig = ensureMcpConfig(app.getPath('userData'));
  return liveMcpConfig;
}

// 캔버스 결과 하나(stream-json-parser.classifyCanvasBlock의 출력)를 캔버스
// 창으로 보낸다. 렌더러(canvas.js)가 status별로 카드를 그리거나 안내를 띄운다.
function sendLiveCanvasResult(result) {
  if (!shellWin || shellWin.isDestroyed()) return;
  shellWin.webContents.send('athena:add-canvas-live', result);
  // 채팅 영역의 3상태 표시가 실제 진행을 보여줄 수 있도록 카드 하나가 뜰 때마다
  // 알린다 — 43초짜리 왕복 동안 조용히 멈춘 것처럼 보이면 안 된다(오케스트레이터 지시).
  // 두 채널은 같은 렌더러의 서로 다른 영역이 받는다(shell.html — 캔버스 영역은
  // canvas.js가, 채팅 영역은 chat.js가 구독한다).
  shellWin.webContents.send('athena:live-canvas-added', { status: result.status });
}

// 답변 텍스트 조각(claude-runner.js의 onTextDelta) — 채팅 버블에 실시간으로
// 이어붙일 델타 하나. 셸의 채팅 영역(chat.js)과 오브의 대화 모드(orb.js, board-33)가
// 같은 채널을 구독한다 — 둘이 동시에 질의를 돌리는 일은 없으므로(board-34 "상태는
// 둘뿐이다") 무조건 relay해도 엉뚱한 창이 남의 조각을 먹는 사고가 안 난다.
function sendLiveTextDelta(text) {
  if (shellWin && !shellWin.isDestroyed()) shellWin.webContents.send('athena:live-text-delta', { text });
  if (orbWin && !orbWin.isDestroyed()) orbWin.webContents.send('athena:live-text-delta', { text });
}

// 추론 조각 — 미리보기 전용이다(chat.js/orb.js가 답변 첫 조각이나 턴 종료에서 지운다).
// 여기서도 이력에 저장하지 않는다 — historySink는 finalResult.result만 다룬다.
function sendLiveThinkingDelta(text) {
  if (shellWin && !shellWin.isDestroyed()) shellWin.webContents.send('athena:live-thinking-delta', { text });
  if (orbWin && !orbWin.isDestroyed()) orbWin.webContents.send('athena:live-thinking-delta', { text });
}

// 툴 호출 진행 단계(2026-08-26 board-33) — StreamJsonSession이 이미 넘겨주는
// 원시 이벤트(assistant의 tool_use 블록 시작 / user의 tool_result 블록 종료)에서
// 뽑는다. 새 파서 채널을 만들지 않는다 — runLiveQuery의 onEvent 콜백 하나가
// 판정도 겸한다(아래 trackToolStep). 화면에는 한국어 라벨만 낸다 — 원문 TR/툴
// id는 절대 새지 않는다(오케스트레이터 지시).
function sendLiveToolStep(step) {
  if (shellWin && !shellWin.isDestroyed()) shellWin.webContents.send('athena:live-tool-step', step);
  if (orbWin && !orbWin.isDestroyed()) orbWin.webContents.send('athena:live-tool-step', step);
}

const TOOL_STEP_LABELS = {
  athena_search: '검색',
  athena_describe: '스키마 확인',
  athena_resolve: '판단 중',
  athena_call: '조회',
};

function toolStepLabel(name) {
  if (streamJsonParser.isRenderCanvasToolName(name)) return '카드 그리는 중';
  // MCP 툴 이름은 mcp__<server>__<tool> 형태로 온다 — 마지막 조각만 라벨을 찾는 열쇠다.
  const base = String(name || '').split('__').pop();
  return TOOL_STEP_LABELS[base] || '처리 중';
}

// tool_use_id별 시작 시각을 들고 있다가 매칭되는 tool_result가 오면 소요시간과
// 함께 완료를 알린다. runLiveQuery 호출마다 새로 만든다(왕복 하나의 수명).
function createToolStepTracker() {
  const steps = new Map(); // tool_use_id -> { label, startedAt }
  return function trackToolStep(event) {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'assistant') {
      const content = event.message && event.message.content;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        if (block && block.type === 'tool_use' && block.id && !steps.has(block.id)) {
          const label = toolStepLabel(block.name);
          steps.set(block.id, { label, startedAt: Date.now() });
          sendLiveToolStep({ id: block.id, label, done: false, elapsedMs: null });
        }
      }
    } else if (event.type === 'user') {
      const content = event.message && event.message.content;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        if (block && block.type === 'tool_result' && block.tool_use_id) {
          const step = steps.get(block.tool_use_id);
          if (step && step.elapsedMs === undefined) continue; // 이미 완료 처리됨
          if (step) {
            const elapsedMs = Date.now() - step.startedAt;
            step.elapsedMs = elapsedMs; // 재-tool_result(있을 리 없지만) 방어
            sendLiveToolStep({ id: block.tool_use_id, label: step.label, done: true, elapsedMs, error: !!block.is_error });
          }
        }
      }
    }
  };
}

// 질의 왕복이 실제로 도는 동안 셸·오브 양쪽 입력을 함께 잠근다(2026-08-26
// board-33 "단일 실행 잠금은 공유한다"). runLiveQuery 하나가 재귀 재시도할 수
// 있으므로(세션 재개 실패 1회 재시도) 카운터로 겹침을 흡수한다 — 두 번째
// 재귀에서 false로 떨어졌다가 바깥 호출이 끝나기도 전에 다시 열리면 안 된다.
let liveQueryBusyDepth = 0;

function broadcastLiveQueryBusy(busy) {
  if (shellWin && !shellWin.isDestroyed()) shellWin.webContents.send('athena:live-query-state', { busy });
  if (orbWin && !orbWin.isDestroyed()) orbWin.webContents.send('athena:live-query-state', { busy });
}

// 지금 떠 있는 실배선 claude 프로세스의 kill 핸들. 정확히 하나만 유지한다 —
// Esc 후 재질의로 프로세스가 쌓이던 갭(README "다중 세션도 없다")의 해소.
let activeLiveQuery = null;
let activeRestRun = null;

// 멀티턴(2026-08-17) — 직전 성공 왕복의 session_id. 다음 질의를 --resume으로
// 이어 이전 대화 내용(질문·답변·툴 결과)이 반영되게 한다. -p 재개는 세션을
// 포크해 새 session_id를 발급하므로 매 성공 왕복마다 갱신해야 체인이 이어진다.
// 앱 재시작 시 null — 대화는 앱 수명 단위다(디스크에 세션 키를 남기지 않는다).
let liveSessionId = null;

// history-sink conversation_id — **앱 세션 단위로 고정한다. liveSessionId를 쓰지 않는다.**
// 계획 §2(a)는 liveSessionId 재사용을 제안했지만 실배선 E2E가 그 전제를 뒤집었다
// (PROBE-BRAIN-CHAT-E2E.json, 2026-08-19): `claude -p --resume`은 매 성공 왕복마다
// 세션을 포크해 새 id를 발급하므로, 질의 진입 시점(role:user)과 응답 반환 시점
// (role:assistant) 사이에 liveSessionId가 바뀐다. 그 결과 **같은 한 턴의 두 메시지가
// 서로 다른 conversation_id로 갈렸다**(user 0a1fe408… / assistant 5ff6842e…) — 프로브가
// sameConversationLocator:false로 잡아낸 결함이다. 조회(GET /chats?conversation_id=)는
// 반쪽 턴만 돌려주고 그래프의 대화 묶음도 턴마다 쪼개진다.
// liveSessionId는 애초에 대화 식별자가 아니라 재개용 커서다. 위 843행 주석이 이미
// "대화는 앱 수명 단위다"라고 적고 있으니, 대화 id는 앱 세션에 고정하는 게 맞다.
const historyAppSessionId = crypto.randomUUID();

function historyConversationId() {
  return historyAppSessionId;
}

// 이력 사이드바(리프 1.2.2) 최소 영속화 — 첫 사용자 메시지에서 제목을 뽑아
// athena-conversations.json에 적는다. historyConversationId()는 그대로 앱
// 세션 고정이라 이 호출은 매번 같은 id를 touch할 뿐이다(conversations.js
// 상단 주석 참고 — 재생 기능은 없다).
function touchConversationEntry(text) {
  try { conversations.touch({ id: historyConversationId(), title: text }); } catch { /* 사이드바 표시는 대화 성공의 필요조건이 아니다 */ }
}

// 저장 실패를 렌더러의 "기록 안 됨" 배지로 전달(계획 §2(g), 함정 ⑫ — messageId/role만
// 싣고 본문은 절대 넘기지 않는다).
function emitHistorySaveFailed({ messageId, role }) {
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:history-save-failed', { messageId, role });
  }
}

// 시맨틱 캐시 + 리플레이(2026-08-19 "아직 느리다") — 같은 질문 2회차부터 모델을
// 태우지 않는다. 판정만 재사용, 데이터는 매번 새로 조회(query-cache.js/fast-path.js).
const { QueryCache, ReplayTurnCapture } = require('./lib/main/query-cache');
const fastPath = require('./lib/main/fast-path');
const liveQueryCache = new QueryCache();
const stockEntityIndex = new restDatasetRunner.StockEntityIndex();
const DIRECT_FEEDBACK_WATCHDOG_MS = 2200;

async function runDirectRestDataset(dataset, expand = true, overrides = {}) {
  const startedAt = performance.now();
  const ownController = overrides.signal ? null : new AbortController();
  if (!overrides.signal && activeRestRun) activeRestRun.abort(new Error('새 REST 데이터셋 요청이 이전 요청을 대체했다'));
  if (ownController) activeRestRun = ownController;
  let feedbackObserved = false;
  let watchdogReceipt = null;
  const shouldPaintReceipt = !overrides.emitCanvas;
  const feedbackWatchdog = shouldPaintReceipt ? setTimeout(() => {
    if (feedbackObserved) return;
    watchdogReceipt = emitRestReceiptAndWaitForPaint(
      '조회가 지연되어 아직 화면 데이터를 표시하지 못했습니다.',
      { timeoutMs: Math.max(1, 3000 - DIRECT_FEEDBACK_WATCHDOG_MS) },
    ).then((paint) => ({ paint, error: null }), (error) => ({ paint: null, error }));
  }, DIRECT_FEEDBACK_WATCHDOG_MS) : null;
  const handleDirectEvent = (event) => {
    if (event && event.type === 'paint-ack') feedbackObserved = true;
    if (typeof overrides.onEvent === 'function') overrides.onEvent(event);
  };
  let result;
  try {
    result = await restDatasetRunner.runRestDataset({
      dataset,
      backendBase: BACKEND_HTTP_BASE,
      fetchImpl: overrides.fetchImpl,
      signal: overrides.signal || ownController.signal,
      hardSignal: overrides.hardSignal,
      onEvent: handleDirectEvent,
      emitCanvas: overrides.emitCanvas || ((payload) => {
        if (ownController && activeRestRun !== ownController) {
          throw new Error('교체된 REST 데이터셋의 늦은 카드는 표시하지 않는다');
        }
        return emitRestCanvasAndWaitForPaint(payload, {
          expand,
          timeoutMs: Math.max(1, payload.paintDeadlineAt - performance.now()),
        });
      }),
    });
  } finally {
    if (feedbackWatchdog) clearTimeout(feedbackWatchdog);
    if (activeRestRun === ownController) activeRestRun = null;
  }
  const watchdogOutcome = watchdogReceipt ? await watchdogReceipt : null;
  if (watchdogOutcome && watchdogOutcome.paint) {
    result.answerPaintedByMain = true;
    result.feedbackOk = true;
    result.firstFeedbackMs = Math.max(0, watchdogOutcome.paint.visiblePaintAt - startedAt);
  } else if (!result.renderedCount && shouldPaintReceipt) {
    try {
      const paint = await emitRestReceiptAndWaitForPaint(result.answerText, {
        timeoutMs: Math.max(1, 3000 - (performance.now() - startedAt)),
      });
      result.answerPaintedByMain = true;
      result.feedbackOk = true;
      result.firstFeedbackMs = Math.max(0, paint.visiblePaintAt - startedAt);
    } catch (error) {
      result.answerPaintedByMain = false;
      result.feedbackOk = false;
      result.feedbackError = String((error && error.message) || error);
    }
  } else if (watchdogOutcome && watchdogOutcome.error && !result.feedbackOk) {
    result.feedbackError = String((watchdogOutcome.error && watchdogOutcome.error.message) || watchdogOutcome.error);
  }
  if (!overrides.skipHistory && dataset && dataset.question) {
    historySink.saveChatMessage(
      { conversationId: historyConversationId(), text: dataset.question, role: 'user' },
      { onSaveFailed: emitHistorySaveFailed, mdlog },
    );
    touchConversationEntry(dataset.question);
  }
  if (!overrides.skipHistory) {
    historySink.saveChatMessage(
      { conversationId: historyConversationId(), text: result.answerText, role: 'assistant' },
      { onSaveFailed: emitHistorySaveFailed, mdlog },
    );
  }
  return result;
}

async function handleChartPanelReload(event, payload) {
  if (!shellWin || shellWin.isDestroyed() || event.sender !== shellWin.webContents) {
    throw new Error('AITS chart reload는 셸 창에서만 허용된다');
  }
  const request = chartReloadAuthority.buildDataset(payload);
  const result = await runDirectRestDataset(request, false, { skipHistory: true });
  return chartReloadAuthority.acceptResult(request, result);
}

ipcMain.handle('athena:reload-chart-panel', handleChartPanelReload);

// 과거 페이지 조회 — 카드를 갈아치우지 않고 앞쪽에 덧붙일 봉만 돌려준다.
// emitCanvas를 가로채 사이드 채널 푸시를 막는다(푸시하면 렌더러가 패널을
// 과거 구간으로 통째로 교체해버린다 — 우리가 원하는 건 prepend다).
async function handleChartHistoryPage(event, payload) {
  if (!shellWin || shellWin.isDestroyed() || event.sender !== shellWin.webContents) {
    throw new Error('AITS chart history는 셸 창에서만 허용된다');
  }
  // 계약(reload_targets[period].request_fields)에 맞춰 인자를 고르고 base_dt만
  // 커서로 바꾸는 일은 그대로 chart-reload가 한다 — 여기서 필드를 지어내지 않는다.
  const request = chartReloadAuthority.buildHistoryDataset(payload);
  const item = request.items[0];

  // 렌더 파이프라인(runDirectRestDataset)을 타지 않는다. 그 경로는 activeRestRun을
  // 공유해 진행 중인 조회를 abort시키고 캔버스 배달·패널 권위 수명에 엮인다 —
  // 과거 조회는 화면을 그리는 일이 아니라 봉만 가져오는 일이라 그 전부가 부작용이다
  // (실측 2026-08-25: 자동 발화 시 두 요청이 서로를 취소해 영영 pending으로 남았다).
  let res;
  try {
    res = await fetch(`${BACKEND_HTTP_BASE}/api/v1/canvas/chart-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation_ref: item.operationRef, args: item.args }),
    });
  } catch (err) {
    return { ok: false, error: `과거 조회 실패 — ${String((err && err.message) || err)}`, candles: [] };
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    return {
      ok: false,
      error: `과거 조회 거부(HTTP ${res.status})${detail && detail.detail ? ` — ${detail.detail}` : ''}`,
      candles: [],
    };
  }
  const body = await res.json().catch(() => null);
  const candles = body && Array.isArray(body.candles) ? body.candles : [];
  if (!candles.length) return { ok: false, error: '과거 봉이 없다', candles: [] };
  return { ok: true, candles, trId: body.tr_id || null };
}

ipcMain.handle('athena:chart-history-page', handleChartHistoryPage);

// 수급 시계열 조회 — 지표를 켤 때만 부른다(켜지 않은 지표의 TR을 미리 당기지 않는다).
// 한 TR의 여러 열을 한 번에 받아 렌더러가 분류별 pane을 만든다.
async function handleChartSeries(event, payload) {
  if (!shellWin || shellWin.isDestroyed() || event.sender !== shellWin.webContents) {
    throw new Error('수급 시계열 조회는 셸 창에서만 허용된다');
  }
  const input = payload && typeof payload === 'object' ? payload : {};
  return chartSeries.fetchChartSeries({
    backendBase: BACKEND_HTTP_BASE,
    operationRef: input.operationRef,
    args: input.args,
    fields: input.fields,
    baseDt: input.baseDt,
  });
}

ipcMain.handle('athena:chart-series', handleChartSeries);

async function runLiveQuery(query, expand) {
  liveQueryBusyDepth += 1;
  if (liveQueryBusyDepth === 1) broadcastLiveQueryBusy(true);
  try {
    return await runLiveQueryInner(query, expand);
  } finally {
    liveQueryBusyDepth -= 1;
    if (liveQueryBusyDepth === 0) broadcastLiveQueryBusy(false);
  }
}

async function runLiveQueryInner(query, expand) {
  // 정형 질의 모델 우회 확장(2026-08-26 속도 레버) — 순서는 의미 없다(각자
  // 닫힌 문법이라 서로 안 겹친다, rest-dataset-runner.js 테스트로 고정).
  const directDataset = restDatasetRunner.buildQuoteDataset(query, stockEntityIndex, {
    idFactory: () => `rest-${crypto.randomUUID()}`,
  }) || restDatasetRunner.buildChartDataset(query, stockEntityIndex, {
    idFactory: () => `rest-${crypto.randomUUID()}`,
  }) || restDatasetRunner.buildOrderBookDataset(query, stockEntityIndex, {
    idFactory: () => `rest-${crypto.randomUUID()}`,
  }) || restDatasetRunner.buildInvestorFlowDataset(query, stockEntityIndex, {
    idFactory: () => `rest-${crypto.randomUUID()}`,
  }) || restDatasetRunner.buildTradingSourceDataset(query, stockEntityIndex, {
    idFactory: () => `rest-${crypto.randomUUID()}`,
  }) || restDatasetRunner.buildStockInfoDataset(query, stockEntityIndex, {
    idFactory: () => `rest-${crypto.randomUUID()}`,
  }) || restDatasetRunner.buildProgramTradeDataset(query, {
    idFactory: () => `rest-${crypto.randomUUID()}`,
  });
  if (directDataset) {
    mdlog('Kiwoom REST 직결 화면 경로 선택 — 모델/MCP/WS 무호출');
    return runDirectRestDataset(directDataset, expand);
  }
  const { dir, configFile } = getLiveMcpConfig();

  // 빠른 경로 — 캐시된 판정이 있으면 claude -p를 스폰하지 않는다. 카드는
  // 백엔드가 사이드 채널로 밀고(캔버스 먼저), 답변은 결정론 템플릿이다.
  const cachedJudgment = liveQueryCache.get(query);
  if (cachedJudgment) {
    const replay = await fastPath.runCachedReplay({
      judgment: cachedJudgment,
      backendBase: BACKEND_HTTP_BASE,
    });
    if (replay.ok) {
      mdlog(`캐시 리플레이 적중 — ${replay.durationMs}ms (모델 무호출)`);
      historySink.saveChatMessage(
        { conversationId: historyConversationId(), text: query, role: 'user' },
        { onSaveFailed: emitHistorySaveFailed, mdlog },
      );
      touchConversationEntry(query);
      historySink.saveChatMessage(
        { conversationId: historyConversationId(), text: replay.answerText, role: 'assistant' },
        { onSaveFailed: emitHistorySaveFailed, mdlog },
      );
      return {
        ok: true,
        source: 'live-cache',
        error: null,
        answerText: replay.answerText,
        // 요청값(캐시된 판정)이 아니라 응답값(manifest가 실제로 정한 카드
        // 종류) — P5부터 캐시 판정 객체가 canvasType을 안 들고 있다.
        canvasTypes: [replay.canvasType],
        diagnostics: null,
        durationMs: replay.durationMs,
      };
    }
    // 리플레이 실패 — 낡은 판정일 수 있다. 무효화하고 정상 경로로 폴백한다.
    liveQueryCache.invalidate(query);
    mdlog(`캐시 리플레이 실패 — 정상 경로 폴백: ${replay.reason}`);
  }

  // 사용자 질의 진입 직후 role:user 1건 — fire-and-forget(호출을 await하지 않는다).
  historySink.saveChatMessage(
    { conversationId: historyConversationId(), text: query, role: 'user' },
    { onSaveFailed: emitHistorySaveFailed, mdlog },
  );
  touchConversationEntry(query);

  // 이전 질의 프로세스가 아직 살아 있으면 먼저 트리째 끊는다 — 새 질의가 항상 선점한다.
  if (activeLiveQuery) {
    activeLiveQuery.kill();
    activeLiveQuery = null;
  }
  let myHandle = null;

  // 첫 카드가 실제로 확정된 시점에만 연다(목업 시절과 같은 문법 — expand:!opened).
  // 질의가 카드를 하나도 만들지 않고 텍스트 답변만으로 끝나는 경우가 실배선에서는
  // 실제로 가능하다 — 그때 빈 유리창을 열어두지 않는다.
  let expandTriggered = false;
  const canvasTypesSeen = [];
  // 결과물 도크(단계 8, board 25Q-0 "④ 결과물·출처 도크")용 — 카드별 표시
  // 이름(card_title 있으면 그거, 없으면 caption)을 턴 등장 순서 그대로 모은다.
  // 새 라벨을 짓지 않는다 — 이미 canvas.js가 카드 제목에 쓰는 값 그대로다.
  const canvasCaptionsSeen = [];
  // 판정 캡처(시맨틱 캐시 재료) — tool_use_id로 resolve 결과 토큰과 render 입력
  // 토큰을 상관시킨다. 마지막 입력끼리 우연히 결합하지 않는다.
  const replayTurnCapture = new ReplayTurnCapture();
  const trackToolStep = createToolStepTracker();
  const resumeSessionId = liveSessionId;
  // 설정 화면 모델 패널(lib/main/model-prefs.js) 값 — null이면 buildArgs가
  // --model/--effort를 안 붙여 claude CLI 기본값을 쓴다.
  const { model, effort } = modelPrefs.get().claude;
  const result = await runClaudeQuery({
    // 날것 질문을 그대로 넘기면 모델이 조회만 하고 캔버스를 건너뛸 수 있다 —
    // 렌더 지시·스키마 힌트로 감싼다(lib/main/live-prompt.js의 실측 근거 참조).
    prompt: buildLivePrompt(query),
    cwd: dir,
    configFile,
    resumeSessionId,
    model,
    effort,
    onSpawn: (h) => { myHandle = h; activeLiveQuery = h; },
    // 성공 resolve 1건과 render 1건의 토큰이 정확히 같은 경우만 캐시한다.
    onEvent: (ev) => { replayTurnCapture.observe(ev); trackToolStep(ev); },
    onTextDelta: sendLiveTextDelta,
    onThinkingDelta: sendLiveThinkingDelta,
    onCanvasResult: (r) => {
      const label = r.envelope && (r.envelope.card_title || r.envelope.caption);
      if (r.status === 'pushed') {
        // 카드는 사이드 채널(startCanvasFeed)로 이미 도착했다 — 여기선 집계만.
        if (r.envelope && r.envelope.canvas_type) canvasTypesSeen.push(r.envelope.canvas_type);
        if (label) canvasCaptionsSeen.push(label);
        return;
      }
      if (expand && !expandTriggered) {
        expandTriggered = true;
        // 첫 카드가 확정된 시점에 창을 앞으로 한 번만 가져온다 — 카드마다
        // moveTop()을 반복하면 사용자가 다른 앱으로 옮겨간 뒤에도 계속 튀어나온다.
        revealShell({ focus: false });
      }
      sendLiveCanvasResult(r);
      if (r.envelope && r.envelope.canvas_type) canvasTypesSeen.push(r.envelope.canvas_type);
      if (label) canvasCaptionsSeen.push(label);
    },
  });

  // 내가 등록한 핸들일 때만 지운다 — 이 await 동안 새 질의가 선점해 자기 핸들을
  // 걸어뒀다면 그걸 지우면 안 된다.
  if (activeLiveQuery === myHandle) activeLiveQuery = null;

  // 멀티턴 세션 체인 갱신 — 성공 왕복의 새 session_id로 잇는다.
  if (result.ok && result.finalResult && result.finalResult.session_id) {
    liveSessionId = result.finalResult.session_id;
  } else if (!result.ok && resumeSessionId && !result.aborted && !result.timedOut) {
    // 재개 실패 — 세션 파일이 사라졌거나 CLI가 재개를 거부했을 수 있다. 다음
    // 질의가 계속 같은 이유로 죽지 않게 세션을 버린다(fail-open은 새 대화 시작).
    liveSessionId = null;
    if (/session/i.test(String(result.error || ''))) {
      // 세션 문제로 죽은 게 분명하면 이번 질의만은 새 세션으로 1회 재시도한다 —
      // liveSessionId가 이미 null이라 재귀는 한 단계에서 끝난다.
      return runLiveQuery(query, expand);
    }
  }

  // finalResult.result는 claude -p의 마지막 assistant 텍스트다(RESULT.md의
  // type:"result" 이벤트) — 목업 시절의 정형화된 "캔버스 창에 ~ 띄웠습니다"
  // 문장 대신, 실제로 Claude가 쓴 답변을 그대로 보여준다.
  // 판정 저장(시맨틱 캐시) — successful resolve 1건과 같은 plan_token의 render
  // 1건이 실제로 일어난 왕복만.
  // 같은 질문 2회차부터 모델 무호출 리플레이의 재료가 된다(runLiveQuery 진입부).
  // backend manifest가 돌려준 실제 canvas_type(chart/table)은 캐시 대상 여부를
  // 거르는 그때그때의 필터일 뿐, 저장하는 판정 객체에는 담지 않는다 — 카드
  // 종류는 이제 operation_ref의 순수 함수라(P5, canvas_push.py) 재생 시점에
  // 백엔드가 다시 정하므로 캐싱이 불필요하다(fast-path.js가 응답값을 쓴다).
  const replayJudgment = result.ok
    ? replayTurnCapture.buildJudgment(canvasTypesSeen)
    : null;
  if (replayJudgment) liveQueryCache.set(query, replayJudgment);

  const answerText = result.finalResult && typeof result.finalResult.result === 'string'
    ? result.finalResult.result
    : null;

  // 응답 산출 직후 role:assistant 1건 — null이면 스킵(계획 §2(a)). 여기도
  // fire-and-forget — 반환을 막지 않는다.
  if (answerText !== null) {
    historySink.saveChatMessage(
      { conversationId: historyConversationId(), text: answerText, role: 'assistant' },
      { onSaveFailed: emitHistorySaveFailed, mdlog },
    );
  }

  return {
    ok: !!result.ok,
    source: 'live',
    error: result.ok ? null : (result.error || `claude 종료 코드 ${result.exitCode}`),
    answerText,
    canvasTypes: [...new Set(canvasTypesSeen)],
    canvasCaptions: canvasCaptionsSeen,
    diagnostics: result.diagnostics,
    durationMs: result.finalResult && result.finalResult.duration_ms,
  };
}

// Esc 중단 — 렌더러의 abortToken은 UI 반영만 막는다. 프로세스는 여기서 실제로 죽인다.
ipcMain.on('athena:abort-live-query', () => {
  if (activeRestRun) {
    activeRestRun.abort(new Error('사용자가 REST 데이터셋 요청을 취소했다'));
  }
  if (activeLiveQuery) {
    activeLiveQuery.kill();
    activeLiveQuery = null;
  }
});

ipcMain.handle('athena__render_canvas', async (e, payload = {}) => {
  if (payload.source === 'rest-dataset') {
    return runDirectRestDataset(payload.dataset, payload.expand !== false);
  }
  if (payload.source === 'fixture') {
    // 기존 목업 경로 — 그대로 보존한다. type만 알면 되고 실제 텍스트는 안 쓴다.
    const { type, expand } = payload;
    if (expand) revealShell({ focus: false });
    shellWin.webContents.send('athena:add-canvas', { type });
    return { ok: true, source: 'fixture', type };
  }
  const { query, expand } = payload;
  if (!query || !String(query).trim()) {
    return { ok: false, source: 'live', error: '질의가 비어 있다' };
  }
  return runLiveQuery(query, expand);
});

// 오브 대화 모드(2026-08-26 board-33) — 셸이 숨겨졌을 때만 오브 렌더러가 이
// 채널을 부른다(orb.js 쪽 게이트는 athena:shell-visibility). **셸 창을 앞으로
// 가져오지 않는다**(expand:false 고정) — "오브 미니 채팅은 언제나 메인 방
// 하나에만 말한다"(board-34), 카드는 셸을 열지 않고도 캔버스 사이드 채널로
// 이미 그려진다(startCanvasFeed). 파이프라인은 새로 만들지 않는다 — 셸의
// 커맨드바가 부르는 runLiveQuery와 완전히 같은 함수를 그대로 호출한다.
ipcMain.handle('athena:orb-chat-submit', async (e, payload = {}) => {
  const query = payload && typeof payload.query === 'string' ? payload.query.trim() : '';
  if (!query) return { ok: false, source: 'live', error: '질의가 비어 있다' };
  // 2026-08-26 어드버서리얼 리뷰 결함 #1 — runLiveQueryInner의 "새 질의가 항상
  // 선점한다"(활성 프로세스 kill)는 같은 창의 재질의를 가정한 안전장치였는데,
  // 오브가 부르면 셸이 이미 돌리고 있던 질의를 조용히 죽이고 그 결과를
  // claude-runner.js가 "사용자 중단"으로 셸 이력에 남긴다(killedBy:'abort' 딱지가
  // 출처를 안 가린다) — 셸을 숨기고 오브로 넘어가는 전이가 board-33/34에서
  // 정상 동작이라 이 레이스는 실제로 밟힌다. orb.js가 athena:live-query-state를
  // 구독해 진행 중이면 입력 자체를 잠그지만(1차 방어, live-query-lock.js), 그
  // 잠금과 이 제출 사이의 레이스까지 막으려면 여기서도 거부해야 한다(2차 방어
  // — 죽이지 않는다). liveQueryBusyDepth로 판정한다 — activeLiveQuery만 보면
  // REST 직결 fast-path(클로드 프로세스 없이 도는 구간이라 activeLiveQuery가
  // null이다)의 레이스를 놓친다.
  if (liveQueryBusyDepth > 0) {
    return { ok: false, source: 'live', error: '셸 질의 진행 중 — 잠시 후 다시 시도하라' };
  }
  const result = await runLiveQuery(query, false);
  // 셸이 나중에 다시 열려도 같은 방이 이어져 보이도록, 오브에서 오간 턴을 셸의
  // 대화 이력에도 커밋한다("대화창으로 가기 → 메인 방 그대로 이어진다", board-34).
  // 세션·이력 저장 자체는 runLiveQuery가 이미 끝냈다 — 여기서는 셸 DOM 표시만
  // 뒤늦게 채워 넣는다(셸이 숨어 있는 동안은 chat.js가 그릴 수 없었으므로).
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:orb-turn-committed', { query, result });
  }
  return result;
});


async function fetchBrainJson(path, { params } = {}) {
  const token = historySink.getBearerToken();
  if (!token) return { ok: false, error: '로컬 베어러 토큰이 설정되지 않았다' };
  const url = new URL(path, historySink.getBackendUrl());
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (err) {
    return { ok: false, error: `요청 실패 — ${String((err && err.message) || err)}` };
  }
  if (!res.ok) return { ok: false, error: `백엔드 응답 ${res.status}`, status: res.status };
  const body = await res.json().catch(() => null);
  return { ok: true, body };
}

ipcMain.handle('athena:brain-status', async () => {
  const result = await fetchBrainJson('/api/v1/brain/status');
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, ...result.body };
});

// 그래프 모드가 그릴 군집 지도(leaf 8 / W2-3). 백엔드가 군집을 캐시하므로 왕복이
// 싸고, 렌더러는 리비전이 그대로면 다시 그리지 않는다.
ipcMain.handle('athena:brain-cluster-map', async () => {
  const result = await fetchBrainJson('/api/v1/brain/analysis/cluster-map');
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, ...result.body };
});

// 그래프 모드 요약 뷰(보드 07)가 그릴 성향 신호 상위 N — 군집 지도와 달리 대상별
// 관계·근거·보강 수까지 담는다(brain.py get_brain_profile_summary). limit은
// 렌더러가 넘긴다 — 보드 07은 "상위 5"라 기본값(50)을 그대로 쓰면 안 맞는다.
ipcMain.handle('athena:brain-profile-summary', async (_e, { limit, windowDays } = {}) => {
  const result = await fetchBrainJson('/api/v1/brain/profile-summary', {
    params: { limit, window_days: windowDays },
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, ...result.body };
});

// 캔버스 빈 상태(보드 05)의 "확인이 필요한 것 N건" 힌트 — 되물을 것들(불확실하다고
// 기록된 관계) 개수만 쓴다. 읽기 전용이다.
ipcMain.handle('athena:brain-suggested-questions', async (_e, { limit } = {}) => {
  const result = await fetchBrainJson('/api/v1/brain/analysis/suggested-questions', {
    params: { limit },
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, ...result.body };
});

// ④ 공통 테이블 카드 봉투로 접는다 — canvas.js의 renderMcpTable(envelope)이
// 이미 그리는 {canvas_type:'table', data:{columns,rows}} 그대로다. 신규 카드
// 타입은 0개(계획 §2(d) "신규 카드 타입 0개").
function chatsToTableEnvelope(messages) {
  return {
    canvas_type: 'table',
    caption: '채팅 이력',
    fell_back: false,
    data: {
      columns: [
        { key: 'occurred_at', label: '시각' },
        { key: 'role', label: '역할' },
        { key: 'text', label: '내용' },
      ],
      rows: messages.map((m) => ({
        occurred_at: m.occurred_at,
        role: m.role,
        text: m.text,
      })),
    },
  };
}

function profileSummaryToTableEnvelope(entries) {
  return {
    canvas_type: 'table',
    caption: '투자 성향 요약',
    fell_back: false,
    data: {
      columns: [
        { key: 'entity_name', label: '대상' },
        { key: 'relation_kind', label: '관계' },
        { key: 'claim_count', label: '관측 수(90일)' },
        { key: 'latest_observed_at', label: '최신 관측일' },
        { key: 'average_confidence', label: '평균 확신도' },
      ],
      rows: entries.map((e2) => ({
        entity_name: e2.entity_name,
        relation_kind: e2.relation_kind,
        claim_count: e2.claim_count,
        latest_observed_at: e2.latest_observed_at,
        average_confidence: e2.average_confidence,
      })),
    },
  };
}

ipcMain.handle('athena:brain-history-query', async (e, payload = {}) => {
  const kind = payload.kind === 'profile-summary' ? 'profile-summary' : 'chats';
  const params = kind === 'chats'
    ? { conversation_id: historyConversationId(), limit: 100 }
    : { window_days: 90, limit: 50 };
  const result = await fetchBrainJson(`/api/v1/brain/${kind}`, { params });
  if (!result.ok) return { ok: false, error: result.error };
  const envelope = kind === 'chats'
    ? chatsToTableEnvelope((result.body && result.body.messages) || [])
    : profileSummaryToTableEnvelope((result.body && result.body.entries) || []);
  if (payload.expand) revealShell({ focus: false });
  sendLiveCanvasResult({ status: 'success', envelope });
  return { ok: true, count: envelope.data.rows.length };
});

// 전체 삭제(계획 §2(f)) — 백엔드가 teardown→파일 삭제→200 flush 후 스스로
// SIGTERM을 보낸다(brain.py post_brain_reset_and_restart). 여기는 그 200을
// 받은 뒤 (a) 이 앱이 스폰한 인스턴스인지 판정 (b) 스폰했다면 종료를 1회성으로
// 기다렸다가 명시적으로 ensureBackend()를 재호출한다 — backend-launcher.js의
// restartAfterReset()이 그 순서를 캡슐화한다(전역 exit 훅은 무변경).
ipcMain.handle('athena:brain-reset', async () => {
  const token = historySink.getBearerToken();
  if (!token) return { ok: false, error: '로컬 베어러 토큰이 설정되지 않았다' };
  let res;
  try {
    res = await fetch(`${historySink.getBackendUrl()}/api/v1/brain/reset-and-restart`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    return { ok: false, error: `요청 실패 — ${String((err && err.message) || err)}` };
  }
  if (!res.ok) return { ok: false, error: `백엔드 응답 ${res.status}` };
  const body = await res.json().catch(() => null);

  const restart = await backendLauncher.restartAfterReset({ mdlog });
  // 재기동된 백엔드는 처음엔 새 빈 브레인이다 — history-sink의 캐시된
  // brainReadyCache가 리셋 전 값(true)을 그대로 물고 있으면 다음 채팅 저장
  // 시도가 아직 안 열린 store를 향할 수 있다. fire-and-forget으로 재확인한다.
  historySink.refreshBrainReady({ mdlog }).catch(() => {});
  return {
    ok: true,
    selfSpawned: restart.selfSpawned,
    restarted: restart.restarted,
    deletedFiles: (body && body.deleted_files) || [],
  };
});

// ---------------------------------------------------------------------------
// 온보딩 (AT-SY-002/003)
// ---------------------------------------------------------------------------

function handleOnboardingState() {
  return onboarding.getState();
}

function handleOnboardingAdvance(e, { step } = {}) {
  return onboarding.advance(step);
}

ipcMain.handle('athena:onboarding-state', handleOnboardingState);
ipcMain.handle('athena:onboarding-advance', handleOnboardingAdvance);


function handlePrefsGet() {
  return prefs.get();
}

function handlePrefsSet(e, patch) {
  const next = prefs.set(patch || {});
  // 설정 카드는 셸 창 안의 같은 렌더러다(#settings 패널) — 그래도 원본과 같이
  // 명시적으로 방송한다. 다른 진입점이 생겨도 이 계약이 그대로 맞는다.
  // 유리 단계·fontSize는 캔버스 영역 텍스트에도 적용되는데, 이제 두 영역이 같은
  // 문서라 방송 1회로 둘 다 닿는다(옛 판은 창마다 한 번씩 보냈다).
  if (shellWin && !shellWin.isDestroyed()) shellWin.webContents.send('athena:prefs-changed', next);
  return next;
}

ipcMain.handle('athena:settings:prefs:get', handlePrefsGet);
ipcMain.handle('athena:settings:prefs:set', handlePrefsSet);

// ---------------------------------------------------------------------------
// 모델 설정(모델·추론강도) — 공급자별로 저장소가 다르다(2026-08-18 Codex 실결선).
// claude는 lib/main/model-prefs.js(athena-model.json, userData 아래) —
// 이 앱만의 설정이다. codex는 lib/main/codex-config.js($CODEX_HOME/config.toml)
// — Codex 본인의 설정 파일에 직접 쓴다, 이 앱 밖에서 codex를 쓸 때도 적용되는
// 전역 기본값이다. 검증은 각 모듈이 한다, 여기선 라우팅 + 성공 시 병합·방송만
// 담당한다(prefs와 같은 문법 — 셸 창이 같은 렌더러의 #settings 패널이라도
// 명시적으로 보낸다).
// IPC 계약은 그대로: athena:model-get/-set → { claude: {model,effort},
// codex: {model,effort} }.
// ---------------------------------------------------------------------------

function handleModelGet() {
  const { claude } = modelPrefs.get();
  const { model, effort } = codexConfig.readModelSettings();
  return { claude, codex: { model, effort } };
}

function handleModelSet(e, payload = {}) {
  const { provider, patch } = payload || {};
  const result = provider === 'codex' ? codexConfig.writeModelSettings(patch || {}) : modelPrefs.set(payload);
  if (!result.ok) return result;
  const state = handleModelGet();
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:model-changed', state);
  }
  return { ok: true, state };
}

ipcMain.handle('athena:model-get', handleModelGet);
ipcMain.handle('athena:model-set', handleModelSet);

// ---------------------------------------------------------------------------
// 픽스처 로더 (2026-08-18 렌더러 격리 이관) — canvas.js의 목업 카드 3종
// (stream/reader/table) + 차트 카드가 쓰던 lib/mockdata.js의 fs 읽기를
// main으로 옮겼다. source:'fixture' 경로에서만 쓰인다(verify.js 전용).
// ---------------------------------------------------------------------------
function handleLoadFixture(e, { kind } = {}) {
  return mockdata.loadFixture(kind);
}

ipcMain.handle('athena:load-fixture', handleLoadFixture);

// ---------------------------------------------------------------------------
// CLI 계정 (AT-SY-002)
// ---------------------------------------------------------------------------

function broadcastCliChanged() {
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:cli-changed', cliAccounts.list());
  }
}

function pollCliChangesAfterLogin() {
  const before = JSON.stringify(cliAccounts.list());
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    const now = JSON.stringify(cliAccounts.list());
    if (now !== before) {
      clearInterval(timer);
      broadcastCliChanged();
    } else if (attempts >= 30) {
      clearInterval(timer);
    }
  }, 2000);
}

function handleCliList() {
  return cliAccounts.list();
}

async function handleCliLogin(e, { providerId } = {}) {
  const result = await cliAccounts.login(providerId);
  if (result.launched) pollCliChangesAfterLogin();
  return result;
}

function handleCliSetActive(e, { accountId } = {}) {
  const result = cliAccounts.setActive(accountId);
  if (result.ok) broadcastCliChanged();
  return result;
}

ipcMain.handle('athena:cli-list', handleCliList);
ipcMain.handle('athena:cli-login', handleCliLogin);
ipcMain.handle('athena:cli-set-active', handleCliSetActive);

// ---------------------------------------------------------------------------
// 계좌 (AT-SY-003, AT-ST-001/002/003, AT-CV-OAUTH)
// ---------------------------------------------------------------------------

function handleAccountList() {
  return accounts.list();
}

async function handleAccountRegister(e, payload = {}) {
  // payload = { alias, appKey, secretKey } — 값은 여기서 accounts.register()로
  // 그대로 전달될 뿐, main.js의 어떤 변수에도 남지 않는다. mdlog()에 절대
  // 넘기지 않는다(비밀값 로깅 금지 — AT-ST-007).
  return accounts.register(payload);
}

function handleAccountSetActive(e, { id } = {}) {
  return accounts.setActive(id);
}

function handleAccountRemove(e, { id } = {}) {
  return accounts.remove(id);
}

function handleOrderApiSet(e, { id, enabled } = {}) {
  return accounts.orderApiSet(id, enabled);
}

function handleAuthTokenStatus(e, { id } = {}) {
  return accounts.tokenStatus(id);
}

function handleAuthTokenRefresh(e, { id } = {}) {
  return accounts.tokenRefresh(id);
}

function handleAuthTokenRevoke(e, { id } = {}) {
  return accounts.tokenRevoke(id);
}

// 이력 사이드바(리프 1.2.2) — athena:conversations-list -> { activeId, conversations }
ipcMain.handle('athena:conversations-list', () => conversations.list());
// 사이드바 항목 클릭의 선택 상태만 저장한다(재생 없음 — conversations.js 주석).
ipcMain.handle('athena:conversations-set-active', (e, { id } = {}) => conversations.setActive(id));

ipcMain.handle('athena:account-list', handleAccountList);
ipcMain.handle('athena:account-register', handleAccountRegister);
ipcMain.handle('athena:account-set-active', handleAccountSetActive);
ipcMain.handle('athena:account-remove', handleAccountRemove);
ipcMain.handle('athena:order-api-set', handleOrderApiSet);
ipcMain.handle('athena:auth-token-status', handleAuthTokenStatus);
ipcMain.handle('athena:auth-token-refresh', handleAuthTokenRefresh);
ipcMain.handle('athena:auth-token-revoke', handleAuthTokenRevoke);

accounts.onTokenChange((payload) => {
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:auth-token-changed', payload);
  }
});

// ---------------------------------------------------------------------------
// MCP (AT-ST-004/005/006) — backend/athena_mcp CLI를 감싼다, 재구현하지 않는다.
// ---------------------------------------------------------------------------

async function handleMcpList() {
  try {
    const { migrated, skipped } = await mcpEnv.migratePlaintextEnv();
    if (migrated.length) {
      mdlog(`mcp-env 마이그레이션: ${migrated.length}건 (${migrated.map((m) => `${m.alias}.${m.key}`).join(', ')})`);
    }
    if (skipped.length) {
      mdlog(`mcp-env 마이그레이션 스킵: ${skipped.map((s) => `${s.alias}.${s.key}: ${s.reason}`).join('; ')}`);
    }
  } catch (err) {
    mdlog(`mcp-env 마이그레이션 실패: ${String((err && err.message) || err)}`);
  }
  return mcpCli.list();
}

function handleMcpStageSnippet(e, { snippet } = {}) {
  return mcpCli.stageSnippet(snippet);
}

function handleMcpRegister(e, { staged } = {}) {
  return mcpCli.register(staged);
}

function handleMcpApprove(e, { alias } = {}) {
  return mcpCli.approve(alias);
}

function handleMcpProbe(e, { alias } = {}) {
  // probe는 실제로 upstream 서버를 spawn한다 — 그 서버 하나만의 env override를
  // 넘긴다(전체가 아니라 alias로 필터링, mcp-env.js buildEnvOverrides() 참고).
  return mcpCli.probe(alias, mcpEnv.buildEnvOverrides(alias));
}

function handleMcpAllowTool(e, { alias, tool, allowed } = {}) {
  return mcpCli.allowTool(alias, tool, allowed);
}

function handleMcpRemove(e, { alias } = {}) {
  return mcpCli.remove(alias);
}

ipcMain.handle('athena:mcp-list', handleMcpList);
ipcMain.handle('athena:mcp-stage-snippet', handleMcpStageSnippet);
ipcMain.handle('athena:mcp-register', handleMcpRegister);
ipcMain.handle('athena:mcp-approve', handleMcpApprove);
ipcMain.handle('athena:mcp-probe', handleMcpProbe);
ipcMain.handle('athena:mcp-allow-tool', handleMcpAllowTool);
ipcMain.handle('athena:mcp-remove', handleMcpRemove);

if (!process.env.ATHENA_NO_AUTOSTART) {
  app.whenReady().then(() => {
    // 2026-08-22 팔레트 반전(사용자 지시 "애플 Liquid Glass 형태 그대로"):
    // Windows의 acrylic/mica는 **앱 테마**를 따라 렌더된다. 다크로 두면 재질 자체가
    // 어두워 무슨 값을 써도 검정으로 수렴한다(실측 3회 — acrylic·mica 모두).
    // 라이트로 고정해야 밝은 유리가 되고, 비활성 창에서 DWM이 떨어뜨리는 단색도
    // 검정이 아니라 밝은 값이 된다. 시스템 테마를 따라가지 않고 고정하는 이유:
    // 이 앱의 팔레트가 흰 유리 위 잉크 하나뿐이라 다크에서 성립하지 않는다.
    nativeTheme.themeSource = 'light';
    createWindows();
    mcpEnv.migratePlaintextEnv().catch((err) => {
      mdlog(`부팅 시 mcp-env 마이그레이션 실패: ${String((err && err.message) || err)}`);
    });
    // 백엔드 자동 기동 — fire-and-forget, createWindows()를 막지 않는다. 이미
    // 떠 있으면(사용자가 수동 기동) 손대지 않는다 — backend-launcher.js의
    // 헬스체크 우선 판정이 중복 스폰을 막는다.
    backendLauncher.ensureBackend({ mdlog })
      .then(async () => {
        historySink.refreshBrainReady({ mdlog });
        try {
          const count = await restDatasetRunner.refreshStockEntityIndex(stockEntityIndex, {
            backendBase: BACKEND_HTTP_BASE,
          });
          mdlog(`Kiwoom 종목명 인덱스 갱신 — 종목 ${count}개`);
        } catch (err) {
          // 인덱스가 없으면 이름과 코드 질의 모두 기존 경로로 abstain한다.
          // snapshot에 없는 6자리 코드를 신뢰하거나 추측해 만들어내지 않는다.
          mdlog(`Kiwoom 종목명 인덱스 갱신 보류: ${String((err && err.message) || err)}`);
        }
      })
      .catch((err) => {
        mdlog(`ensureBackend 실패: ${String((err && err.message) || err)}`);
      });
  });
}

// verify.js에서 재사용 (require로 로드될 때는 자동 기동하지 않는다)
module.exports = {
  computeLayout,
  createWindows,
  emitRestCanvasAndWaitForPaint,
  emitRestReceiptAndWaitForPaint,
  runDirectRestDataset,
  // 창은 둘이다 — 셸 창 + 알림 오브 창(2026-08-24 리프 1.3.1로 GLOSSARY §1의
  // "창은 둘"이 실제로 성립했다).
  getWins: () => ({ shellWin, orbWin }),
  routineEventToFactsEnvelope,
  getLayout: () => layout,
  // 셸 창을 앞으로 — verify.js가 트레이 복귀·카드 푸시 경로를 검증할 때 쓴다.
  revealShell,
  // 트레이 클릭과 동일한 복귀 경로 — verify.js가 닫기(백그라운드 유지)를 검증할 때
  // 실제 트레이 클릭을 자동화할 수 없어 같은 함수 참조를 직접 부른다.
  restoreFromBackground,
  // OS 배치 감지의 기준점 갱신 — verify.js가 창을 직접 setBounds로 움직이는
  // 검증에서는 그 이동이 "앱 주도"임을 이걸로 표시해야 한다. 안 하면
  // handleForeignArrange가 OS 스냅으로 오인해 창을 정착시킨다(설계된 동작).
  noteAppBounds,
  // 창 배치 — verify.js 검증14(창 배치)가 좌/우/센터를 직접 구동한다. 위/아래는
  // 이제 OS 최대화·복원이라 검증14가 maximize()/unmaximize()를 직접 잰다.
  placeWindows,
  centerWindows,
  // 설정·온보딩 IPC 핸들러 — 실제 ipcMain.handle에 연결된 것과 동일한 함수
  // 참조다(테스트용 별도 mock이 아니다). 검증 스크립트가 렌더러/IPC 왕복 없이
  // 직접 호출해 반환 모양을 확인할 수 있게 노출한다.
  settingsHandlers: {
    onboardingState: handleOnboardingState,
    onboardingAdvance: handleOnboardingAdvance,
    prefsGet: handlePrefsGet,
    prefsSet: handlePrefsSet,
    modelGet: handleModelGet,
    modelSet: handleModelSet,
    loadFixture: handleLoadFixture,
    cliList: handleCliList,
    cliLogin: handleCliLogin,
    cliSetActive: handleCliSetActive,
    accountList: handleAccountList,
    accountRegister: handleAccountRegister,
    accountSetActive: handleAccountSetActive,
    accountRemove: handleAccountRemove,
    orderApiSet: handleOrderApiSet,
    authTokenStatus: handleAuthTokenStatus,
    authTokenRefresh: handleAuthTokenRefresh,
    authTokenRevoke: handleAuthTokenRevoke,
    mcpList: handleMcpList,
    mcpStageSnippet: handleMcpStageSnippet,
    mcpRegister: handleMcpRegister,
    mcpApprove: handleMcpApprove,
    mcpProbe: handleMcpProbe,
    mcpAllowTool: handleMcpAllowTool,
    mcpRemove: handleMcpRemove,
  },
};
