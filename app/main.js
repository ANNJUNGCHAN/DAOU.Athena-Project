const MODULE_LOAD_AT = Date.now();
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, Notification, nativeTheme, dialog, shell } = require('electron');
const { performance } = require('node:perf_hooks');
const path = require('path');
const fs = require('fs');

const onboarding = require('./lib/main/onboarding');
const cliAccounts = require('./lib/main/cli-accounts');
const accounts = require('./lib/main/accounts');
const prefs = require('./lib/main/prefs');
const backgroundClose = require('./lib/main/background-close');
const windowChromeGeometry = require('./lib/main/window-chrome-geometry');
const windowHandoff = require('./lib/main/window-handoff');
const modelPrefs = require('./lib/main/model-prefs');
const codexConfig = require('./lib/main/codex-config');
const { computeShellPlacement, clampCenterToWorkArea } = require('./lib/main/window-placement');
// 알림 오브 창(2026-08-24 리프 1.3.1) — 창 기하·옵션은 전부 저 모듈이 진다.
const orbWindow = require('./lib/main/orb-window');
const mcpCli = require('./lib/main/mcp-cli');
const mcpEnv = require('./lib/main/mcp-env');
// 플러그인 제안 — 판정부와 승인 실행부는 electron 없는 순수 모듈이 진다.
const pluginProposalForward = require('./lib/main/plugin-proposal-forward');
const { createPluginProposalRegistry } = require('./lib/main/plugin-proposal-registry');
const { CATALOG: PLUGIN_CATALOG } = require('./lib/plugin-catalog');
// 결정 D1의 실배선 — claude -p 스폰 + stream-json 파싱 + .mcp.json 생성.
const { runClaudeQuery } = require('./lib/main/claude-runner');
const { runGrokQuery } = require('./lib/main/grok-runner');
// 툴 호출 진행 단계(board-33) 라벨링에 render_canvas 판정 하나만 빌려 쓴다 —
// 파서 자체는 손대지 않는다(sendLiveToolStep 근처 주석 참고).
const streamJsonParser = require('./lib/main/stream-json-parser');
const { ensureMcpConfig, createMcpRuntimeSnapshot, canonicalHash } = require('./lib/main/mcp-config');
const { buildLivePrompt, buildLiveSystemPrompt, buildLiveTurnPrompt } = require('./lib/main/live-prompt');
// 백테스트 설계 턴 접두의 오늘 날짜(YYYYMMDD) — 렌더러와 같은 함수를 쓴다(UMD 각주라 main에서도 안전).
const { todayYyyymmdd } = require('./lib/backtest-spec');
// 상주 채팅 세션(2026-08-30 속도 작업) — 매 턴 claude -p 콜드 스폰의 고정비를
// 세션당 1회로 바꾼다(모듈 상단 주석 참고). 기본 경로는 이쪽이다.
const { createClaudeChatSession } = require('./lib/main/claude-chat-session');
// 벤더 무관 프로바이더 런타임(ATHENA_PROVIDER_RUNTIME=1일 때만 기동) — 위 상주
// 세션과 별개의 실험 경로다.
const {
  buildMainMcpRuntimeSnapshot, buildProviderToolPolicy, createProviderRuntimeController,
  createProviderTurnContextRegistry, resolvePersistentChatEnabled,
  shouldMarkProviderCanvasVisible, validateMainMcpSecurityState,
} = require('./lib/main/provider-runtime-bootstrap');
const { createProviderRuntimeMetrics } = require('./lib/main/provider-runtime-metrics');
const { createProviderPaintAckRegistry } = require('./lib/main/provider-paint-ack');
const { createProviderVerifierTelemetry } = require('./lib/main/provider-verifier-telemetry');
const {
  createConversationRotationQueue,
  createRestartableControllerLifecycle,
} = require('./lib/main/provider-main-lifecycle');
const { createMcpRuntimeCoordinator } = require('./lib/main/mcp-runtime-coordinator');
const { createMcpSecurityEpochStore } = require('./lib/main/mcp-security-epoch');
const { resolveCodexDisabledSelection } = require('./lib/main/codex-live-disabled');
const { GATEWAY_ALLOWED_TOOLS, DISALLOWED_EXECUTION_TOOLS } = require('./lib/main/claude-tool-policy');
const providerContractDecision = require('./test-fixtures/provider-contract/decision.json');
const restDatasetRunner = require('./lib/main/rest-dataset-runner');
const { RestRetryRegistry } = require('./lib/main/rest-retry-registry');
const { createStockEntityIndexReadiness } = require('./lib/main/stock-entity-index-readiness');
const { createChartFollowupTracker } = require('./lib/main/chart-followup');
const simpleChartFastPath = require('./lib/main/simple-chart-fast-path');
const selectorFastPath = require('./lib/main/selector-fast-path');
const selectorColdHedge = require('./lib/main/selector-cold-hedge');
const { createClaudeSelectorWorkerPool } = require('./lib/main/claude-selector-worker-pool');
const chartReload = require('./lib/main/chart-reload');
const chartReloadAuthority = chartReload.createChartReloadAuthority();

function isQueryOnlyRetryDataset(dataset) {
  try {
    restDatasetRunner.normalizeDataset(dataset);
    return true;
  } catch {
    return false;
  }
}

const restRetryRegistry = new RestRetryRegistry({
  isQueryOnlyDataset: isQueryOnlyRetryDataset,
});
const {
  correlationKey: restCorrelationKey,
  decidePaintAck,
  timedOutPaint,
  PENDING_MOUNT_ACK_TIMEOUT_MS,
} = require('./lib/rest-canvas-paint');
const { resolveWindowHtmlPath, waitForWindowReady } = require('./lib/main/window-readiness');
const { createOnce } = require('./lib/main/inflight-once');
const {
  StartupReadiness, StartupFailureNotifier, showStartupOsNotification,
  runStartupOrchestration, waitForInitialReadiness, classifyBrainStartupStatus,
} = require('./lib/main/startup-readiness');
const { StartupRoutineBuffer } = require('./lib/main/startup-routine-buffer');
// 목업 데이터 로더 — 렌더러 격리 이관(2026-08-18). canvas.js가 더는 fs를
// 직접 못 쓴다 — athena:load-fixture가 이 모듈을 대신 호출해준다.
const mockdata = require('./lib/main/mockdata');
// 백엔드(FastAPI/uvicorn) 자동 기동 — 헬스체크 후 죽어 있을 때만 스폰한다(중복
// 스폰 금지, lib/main/backend-launcher.js 상단 주석 참고).
const backendLauncher = require('./lib/main/backend-launcher');
// 채팅 → HistoryStore 영속 훅(.omc/plans/plan-chat-graph-pipeline.md §2(a)/(g)).
// fire-and-forget — 절대 await로 채팅 UX를 막지 않는다(모듈 상단 주석 참조).
const historySink = require('./lib/main/history-sink');
const {
  createConversationGraphBroadcastKey,
  createConversationGraphRefresher,
  shouldBroadcastConversationGraph,
} = require('./lib/main/conversation-graph-refresh');
const conversations = require('./lib/main/conversations');
const { createSessionStore } = require('./lib/main/session-store');
const { createSessionBridge } = require('./lib/main/session-bridge');
const crypto = require('crypto');

// 프로바이더 런타임 스위치 — ATHENA_PERSISTENT_CHAT은 이미 상주 채팅 세션
// (claude-chat-session.js, 기본 켜짐)의 킬 스위치라 같은 이름을 정반대 기본값으로
// 쓸 수 없다. 이 실험 경로는 자기 변수를 쓰고 기본은 꺼짐이다.
const PROVIDER_RUNTIME_DEFAULT = false;
const providerRuntimeEnabled = resolvePersistentChatEnabled(process.env, PROVIDER_RUNTIME_DEFAULT, 'ATHENA_PROVIDER_RUNTIME');

const MDEBUGLOG = path.join(__dirname, 'captures', 'main-debug.log');
function mdlog(msg) {
  try { fs.appendFileSync(MDEBUGLOG, `${new Date().toISOString()} ${msg}\n`); } catch {}
}

// Selector cold path의 claude CLI는 앱 수명 동안 8개를 상시 유지한다. 전역
// 동시 분류 상한 4개 + 이미 warm인 예비 4개라서, 취소·장애로 처리 중 worker를
// 배수하거나 교체해도 다음 허용 요청은 새 CLI spawn을 기다리지 않는다. MCP와
// 모든 도구가 닫힌 전용 프로세스라 주문·실시간 등록 같은 외부 효과는 이 풀에서
// 실행될 수 없다.
const selectorClaudePool = createClaudeSelectorWorkerPool({
  cwd: __dirname,
  timeoutMs: 12_000,
});

mdlog('module loaded, ATHENA_NO_AUTOSTART: ' + process.env.ATHENA_NO_AUTOSTART);

// ---------- 싱글 인스턴스 락 — 앱 2개 방지 ----------
// Electron의 락은 app.getPath('userData') 기준이라(Chromium ProcessSingleton),
// ATHENA_USERDATA_DIR로 프로필을 격리하는 QA 하네스(verify.js/run-cases*.js/
// probe-*.js — 전부 require('./main.js')보다 먼저 app.setPath('userData', ...)를
// 부른다)는 실앱과 별개의 락을 가진다. 즉 하네스가 떠 있어도 실앱 기동에 영향이
// 없고, 반대로 실앱이 떠 있어도 격리 프로필 하네스는 정상 기동한다.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // 같은 프로필로 이미 실행 중 — 이 프로세스는 여기서 즉시 끝낸다(fail-fast).
  // 창 생성·IPC 등록 등 나머지 모듈 로드를 진행하지 않는다.
  mdlog('requestSingleInstanceLock 실패 — 이미 실행 중, 즉시 종료');
  app.quit();
  return;
}
app.on('second-instance', () => {
  // 두 번째 실행 시도 — 기존 창을 앞으로(포커스/복원). revealShell은 아래에서
  // 정의되지만 function 선언이라 호이스팅되어 여기서도 참조 가능하다.
  mdlog('second-instance 감지 — 기존 셸 창을 앞으로');
  revealShell({ focus: true });
});

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
  // Paper 53 반응형 하한 — 330px부터 44px 아이콘 레일 + 중앙 1열 +
  // 하단 작성창으로 전환한다. 높이는 기존 카드/작성창 사용성을 지키는 값이다.
  minW: 330, minH: 480,
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
let bootWin;
let shellWin;
let bootVisualComplete = false;
let shellHandoffReady = false;
let shellHandoffVisibilityAudit = [];
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
function revealShell({ focus = true, force = false } = {}) {
  if (!shellWin || shellWin.isDestroyed()) return;
  // 부팅 handoff 전에는 사용자 표면이 bootWin이다(2026-09-02 실측: 두 번째 실행·알림
  // 클릭·캔버스 피드 등이 이 함수를 타면 부팅 창이 남은 채 셸 창이 하나 더 떴다).
  // 셸은 attemptShellHandoff()만 연다 — 여기서는 부팅 창만 앞으로 가져온다.
  // force는 부팅 없이 셸을 바로 쓰는 검증 스크립트(ATHENA_NO_AUTOSTART) 전용이다.
  if (bootWin && !bootWin.isDestroyed()) {
    if (!force) {
      mdlog(`revealShell 보류 — 부팅 handoff 전 (focus=${focus})`);
      if (focus) { bootWin.focus(); bootWin.moveTop(); }
      return;
    }
    // 런처는 handoff를 안 거치므로 부팅 창을 여기서 걷는다 — 남겨 두면 셸 아래에
    // 깔려 있다가 셸을 닫거나 숨기는 순간 다시 드러난다(2026-09-02 실측).
    bootWin.destroy();
    bootWin = null;
  }
  if (shellWin.isMinimized()) shellWin.restore();
  if (!shellWin.isVisible()) {
    if (focus) shellWin.show(); else shellWin.showInactive();
  }
  shellWin.moveTop();
  if (focus) shellWin.focus();
}

// ---------- 셸 표시 여부 → 오브 (2026-08-26 board-33/34 "상태는 둘뿐이다") ----------
// 사용자가 메인 셸을 볼 수 있으면 키우미 native 창 자체를 숨기고, 셸이 숨었거나
// 최소화됐을 때만 키우미를 표시한다. 다른 앱에 덮인 정도는 Electron isVisible()로
// 판정할 수 없으므로 셸 표시 상태로 남긴다.
//
// **창 가시성과 표시 모드는 다른 값이다**(Paper 보드 05 5EX-0) — 최소화는 창을
// 띄우지만 모드는 알림 전용(B)에 머문다. 그래서 페이로드에 둘 다 싣는다.
function isShellHidden() {
  return orbWindow.shouldShowOrbForShell(shellWin);
}

function broadcastShellVisibility() {
  if (!orbWin || orbWin.isDestroyed()) return;
  const hidden = isShellHidden();
  orbWin.webContents.send('athena:shell-visibility', {
    hidden,
    displayMode: orbWindow.orbDisplayMode(shellWin),
  });
  orbWindow.syncOrbVisibility(shellWin, orbWin);
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
    // BOOT-001 최신 결정: 정상 부팅은 OS material까지 포함해 어떤 전체 면도
    // 칠하지 않는다. 셸의 Liquid Glass는 renderer가 부팅 완료 뒤 직접 그린다.
    backgroundColor: '#00000000',
    transparent: true,
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

const createWindows = createOnce(async function createWindows() {
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
  mdlog('warmup done, creating bootWin + shellWin');

  bootWin = new BrowserWindow(commonWinOpts({
    x: layout.originX, y: layout.originY, width: layout.shellW, height: layout.shellH,
  }));
  const bootReady = waitForWindowReady(bootWin, { label: 'boot window' });
  bootWin.loadFile(resolveWindowHtmlPath(__dirname, 'shell.html'));

  shellWin = new BrowserWindow(shellWindowOpts({
    x: layout.originX, y: layout.originY, width: layout.shellW, height: layout.shellH,
  }));
  const shellReady = waitForWindowReady(shellWin, { label: 'shell window' });
  // 크기 잠금 해제(2026-08-18 사용자 지시 — "무조건 가로세로 모두 조정 가능해야
  // 한다"). 설계 치수는 부팅 기본값일 뿐 불변 계약이 아니다. 완전 잠금(min=max)이면
  // Win+↑의 OS maximize가 이벤트도 없이 무시된다는 실측(qa-win-arrow)은 여전히
  // 유효하다 — 지금은 잠금 자체가 없다. 하한만 건다.
  shellWin.setMinimumSize(DESIGN.minW, DESIGN.minH);
  shellWin.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) invalidateShellChromeGeometry({ resetGeneration: true });
  });
  shellWin.loadFile(resolveWindowHtmlPath(__dirname, 'shell.html'), { query: { shellHandoff: '1' } });
  mdlog('bootWin + WCO shellWin created + loadFile called');

  noteAppBounds(shellWin);

  await Promise.all([bootReady, shellReady]);
  mdlog('boot + shell ready-to-show fired');

  await bootWin.webContents.executeJavaScript('1');
  await shellWin.webContents.executeJavaScript('1');
  mdlog('bootWin + shellWin executeJavaScript done');
  bootWin.show();
  mdlog(`창 표시까지 ${Date.now() - MODULE_LOAD_AT} ms`);
  bootWin.focus();
  bootWin.moveTop();

  const initPayload = {
    scale: layout.scale,
    // 기본은 실배선(live)이다 — ATHENA_CANVAS_SOURCE=fixture일 때만 목업 경로를
    // 쓴다. verify.js가 이 변수를 명시적으로 세팅한다(quota를 쓰는 실제 claude -p
    // 호출을 자동 검증에서 피하려고). 사람이 쓰는 npm start는 항상 live다.
    canvasSource: process.env.ATHENA_CANVAS_SOURCE === 'fixture' ? 'fixture' : 'live',
  };
  bootWin.webContents.send('athena:init', initPayload);
  shellWin.webContents.send('athena:init', initPayload);
  broadcastShellWindowState(shellWin);

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
    enterBackground({ notice: false, source: 'native-close' });
  });

  shellWin.on('closed', () => app.quit());

  // CLI 로그인은 브라우저/콘솔에서 일어난다 — 사용자가 앱으로 돌아온 순간이
  // 갱신 시점이다. 로그인이 pollCliChangesAfterLogin의 60초 창보다 오래 걸리면
  // 목록이 안 갱신되던 실측 결함(2026-08-27)의 근본 처방.
  shellWin.on('focus', () => {
    void broadcastCliChanged({ rotateReason: 'shell_focus_reconcile' })
      .catch(reportSafeCliError);
  });

  // ---------- 알림 오브 창 (2026-08-24 리프 1.3.1) ----------
  // 셸 창 다음에 만든다 — 오브의 "더보기"가 셸을 앞으로 가져오므로 셸이 먼저 있어야 한다.
  // 창은 지금 만들되 메인 셸 handoff 전에는 보이지 않는다. 이후 shell의
  // show/hide/minimize/restore 이벤트가 키우미 표시 여부를 단일하게 결정한다.
  const orbDisplay = screen.getDisplayMatching(shellWin.getBounds());
  const created = orbWindow.createOrbWindow({
    BrowserWindow,
    appDir: __dirname,
    workArea: orbDisplay.workArea,
  });
  orbWin = created.win;
  const orbReady = waitForWindowReady(orbWin, { label: 'orb window' });
  await orbReady;
  mdlog(`orbWin created hidden at ${JSON.stringify(created.bounds)}`);

  // Alt+F4가 오브에 직접 오면 흡수한다 — 오브를 닫는 것은 앱 종료가 아니다.
  // isQuitting이면(before-quit 이후) 진짜 종료 경로이므로 막지 않는다.
  orbWin.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    orbWindow.syncOrbVisibility(shellWin, orbWin);
  });

  // 오브 창이 76px이라 렌더러 mousemove는 커서가 창 위에 있을 때만 온다 — 정작
  // 눈이 커서를 따라가야 할 "떨어져 있을 때"는 좌표가 렌더러에 아예 안 들어온다.
  // 그래서 main이 화면 전역 커서를 폴링해 오브 중심 기준 상대좌표를 밀어준다.
  orbWin.on('show', startOrbCursorPoll);
  orbWin.on('hide', stopOrbCursorPoll);
  orbWin.on('closed', stopOrbCursorPoll);

  // 셸 표시/숨김 전이마다 오브 renderer 모드와 native 창을 함께 맞춘다. 네 이벤트가
  // hideToBackground·revealShell·athena:minimize-windows·OS 복원을 전부 덮는다.
  for (const ev of ['show', 'hide', 'minimize', 'restore']) {
    shellWin.on(ev, broadcastShellVisibility);
  }
  // 부팅 중에는 bootWin이 사용자에게 보이는 메인 표면이라 키우미는 숨긴 채 둔다.
  // 실제 shell handoff 직후 attemptShellHandoff()가 첫 동기화를 수행한다.
  // ---------- 창 기본 기능 (2026-08-17) — frame:false라 OS 타이틀바가 없어 직접 배선 ----------
  // Win+방향키와 Win+Shift+방향키는 가로채지 않고 Windows 기본 Snap·모니터 이동에 맡긴다.
  wireOsSnapEvents(shellWin);

  // 루틴 알림 구독 시작(2026-08-19 능동 에이전트 P2) — fixture면 내부에서 no-op.
  startRoutineFeed();
  // 캔버스 사이드 채널 구독(2026-08-19 데이터 지름길) — 게이트웨이가 채운 카드가
  // 모델 스트림을 안 타고 이 WS로 직접 온다("캔버스 먼저, 채팅은 요약만").
  startCanvasFeed();
}, () => mdlog('createWindows reused (already started)'));

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
const feedStartupWaiters = new Map();
const feedFirstConnected = new Set();
const startupRoutineBuffer = new StartupRoutineBuffer();

function reportStartupFeedStatus(taskId, status) {
  const waiter = feedStartupWaiters.get(taskId);
  if (status && status.state === 'connected') {
    feedFirstConnected.add(taskId);
    if (waiter) {
      feedStartupWaiters.delete(taskId);
      waiter.resolve({ detail: '첫 연결 완료 · 이후 재연결은 백그라운드에서 지속' });
    }
    return;
  }
  if (feedFirstConnected.has(taskId) || !waiter || !status) return;
  if (status.state === 'unsupported') {
    waiter.context.update({ state: 'running', retryable: false, detail: '이 환경에서 WebSocket을 사용할 수 없음' });
    feedStartupWaiters.delete(taskId);
    waiter.reject(new Error('이 환경에서 WebSocket을 사용할 수 없음'));
    return;
  }
  const state = status.state === 'retrying' || status.state === 'disconnected'
    ? 'retrying'
    : 'running';
  const delay = status.retryInMs ? ` · ${status.retryInMs}ms 후 재시도` : '';
  waiter.context.update({
    state,
    detail: `${status.state}${delay}${status.detail ? ` · ${status.detail}` : ''}`,
  });
}

function shellWindowOpts(bounds) {
  return {
    ...commonWinOpts(bounds),
    frame: true,
    transparent: false,
    backgroundColor: '#f7f7f9',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#17171b',
      height: 32,
    },
  };
}

function waitForFirstFeedConnection(taskId, start, context) {
  if (feedFirstConnected.has(taskId)) {
    return Promise.resolve({ detail: '첫 연결 완료 · 재연결 감시 중' });
  }
  return new Promise((resolve, reject) => {
    const deadlineTimer = setTimeout(() => {
      const active = feedStartupWaiters.get(taskId);
      if (!active) return;
      feedStartupWaiters.delete(taskId);
      reject(new Error('실시간 피드 첫 연결 제한시간 초과'));
    }, 20_000);
    const finish = (callback) => (value) => {
      clearTimeout(deadlineTimer);
      callback(value);
    };
    feedStartupWaiters.set(taskId, {
      resolve: finish(resolve), reject: finish(reject), context, deadlineTimer,
    });
    try { start(); } catch (error) {
      const detail = String((error && error.message) || error);
      context.update({ state: 'retrying', detail: `연결 시작 실패 · ${detail}` });
      feedStartupWaiters.delete(taskId);
      reject(error);
    }
  });
}

// startRoutineFeed()의 인라인 onEvent 클로저에서 분리한 이름 있는 함수(Rev.3
// MODERATE 4) — verify.js가 module.exports의 이 함수 참조를 직접 호출해 WS 서버
// 없이 핸들러 로직만 태운다(revealShell/routineEventToFactsEnvelope와 동일 근거).
// ATHENA_CANVAS_SOURCE=fixture 게이트는 startRoutineFeed() 진입만 막을 뿐 이
// 직접 호출과는 무관하다. IPC 릴레이·OS 토스트 동작은 클로저 시절과 불변.
function handleRoutineFeedEvent(event) {
  // 근접(routine-near)은 알림이 아니라 배경 상태다 — athena:routine-event로
  // 보내지 않는다(unread·토스트·이력 경로 오염 금지). orbWin에만 얇게
  // 릴레이한다(feed-status 릴레이와 같은 자리·같은 패턴, CP3-2).
  if (event && event.type === 'routine-near') {
    if (orbWin && !orbWin.isDestroyed()) {
      orbWin.webContents.send('athena:orb-signal', {
        signal: 'watch', active: event.active, observed: event.observed, threshold: event.threshold,
      });
    }
    return;
  }
  // 부팅 handoff 전에는 렌더러가 로드돼 있어도 사용자 표면이 아직 bootWin이다.
  // 이 구간의 이벤트를 webContents.send()로 바로 흘리면 navigation/초기화 경계에서
  // 조용히 사라질 수 있으므로 버퍼에 보관하고 실제 셸이 열린 뒤 한 번만 전달한다.
  const bootHandoffPending = bootWin && !bootWin.isDestroyed() && !shellExpansionAcknowledged;
  if (bootHandoffPending) startupRoutineBuffer.addEvent(event);
  else sendRoutineEventToRenderers(event);
  // fixture 게이트(검증 결정론) — verify.js가 이 함수를 직접 부를 때 실제 OS
  // 토스트가 뜨지 않게 한다. 프로덕션에서는 fixture로 부팅하지 않으므로 무영향.
  if (event && (event.type === 'routine-fired' || event.type === 'routine-restore-failed')
      && process.env.ATHENA_CANVAS_SOURCE !== 'fixture') {
    const toast = routineTurn.buildToast(event);
    const n = new Notification({ title: toast.title, body: toast.body });
    n.on('click', () => { restoreFromBackground(); });
    n.show();
  }
  // 예약형 발화만 자동 브리핑(R1, 4단계) — 감시형(realtime-ws/periodic)은 위의
  // 알림 턴이 전부다. 실패해도 알림 경로는 이미 끝났으므로 로그만 남긴다.
  if (event && event.type === 'routine-fired' && event.mode === 'scheduled') {
    runBriefingTurnWired(event).catch((err) => {
      mdlog(`브리핑 러너 실패: ${String((err && err.message) || err)}`);
    });
  }
}

function sendRoutineEventToRenderers(event) {
  // 능동 턴은 항상 이력에 쌓인다 — 토스트를 놓쳐도 다음 열람 때 남아 있다.
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:routine-event', event);
  }
  // 같은 이벤트가 오브에도 간다(2026-08-24 리프 1.3.1). 두 표면이 같은 원장
  // 행을 각자 렌더할 뿐이고 백엔드 신규 경로는 0건이다 — 설계서 §판단서 요지.
  if (orbWin && !orbWin.isDestroyed()) {
    orbWin.webContents.send('athena:routine-event', event);
    // 발화·복원 실패는 셸이 보이는 동안에도 알림 전용 패널로 실제 화면에 선다
    // (Paper 보드 05 5FX-0 「셸이 보이는 동안 오브는 알림 전용이다」). 감시형
    // 신호는 배경 상태라 창을 띄우지 않는다.
    if (event && (event.type === 'routine-fired' || event.type === 'routine-restore-failed')) {
      orbWindow.syncOrbVisibility(shellWin, orbWin, { alert: true });
    }
  }
}

function startRoutineFeed() {
  // 검증 결정론 보호 — verify.js(fixture)에서는 능동 피드를 돌리지 않는다.
  if (process.env.ATHENA_CANVAS_SOURCE === 'fixture') return;
  if (routineFeed) return;
  routineFeed = new RoutineFeed({
    url: `${BACKEND_WS_BASE}/api/v1/ws/routines`,
    readyFeed: 'routines',
    token: LOCAL_BEARER_TOKEN, // 토큰 설정 배포는 모드 A 인증 봉투, 미설정이면 루프백 게이트
    onEvent: handleRoutineFeedEvent,
    // 알람 센터 "● WS 연결됨"(9단계, Paper 보드 40)이 재사용하는 실 신호 —
    // 이전엔 no-op이라 렌더러에 닿지 않았다(재검증에서 확인). 그대로 릴레이만.
    onStatus: (s) => {
      reportStartupFeedStatus('routine-feed', s);
      if (shellWin && !shellWin.isDestroyed()) {
        shellWin.webContents.send('athena:routine-feed-status', s);
      }
      // 오브에도 얇게 릴레이한다(board-30⑩) — main은 판단하지 않는다.
      // connected/disconnected/unsupported 중 무엇을 얼굴로 바꿀지는 orb.js가 정한다.
      if (orbWin && !orbWin.isDestroyed()) {
        orbWin.webContents.send('athena:orb-signal', { signal: 'feed-status', status: s });
      }
    },
  });
  routineFeed.start();
}

// ---------- 예약 자동 브리핑(R1, 4단계) — 독립 세션·독립 busy 카운터 ----------
// 브리핑은 사용자 턴과 세 겹으로 격리된다(briefing-runner.js 머리말 참고):
// 세션(resumeSessionId 없음), 동시성(briefingBusyDepth는 liveQueryBusyDepth와
// 별개 변수), 우선순위(사용자 질의가 killInProgressBriefing()으로 항상 선점).
const briefingRunner = require('./lib/main/briefing-runner');

let briefingBusyDepth = 0;

// athena:briefing-query-state는 **배지 갱신 전용**이다(MAJOR 2) — chat.js의
// 구독 핸들러는 이 신호로 setLocked를 절대 부르지 않는다. 입력 잠금은 사용자
// 턴 신호(athena:live-query-state)만 만든다. 발행은 결과를 아는 러너가 한다
// (busy:false에 ok/aborted 동봉 — 렌더러가 성공·실패·선점을 추측하지 않게).
function sendBriefingQueryState(state) {
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:briefing-query-state', state);
  }
}

// 순수 카운터 — 브로드캐스트는 러너의 ipc.sendQueryState 몫이다(위 주석).
const briefingBusy = {
  increment() { briefingBusyDepth += 1; },
  decrement() { briefingBusyDepth -= 1; },
  depth: () => briefingBusyDepth,
};

function sendBriefingTextDelta(text) {
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:briefing-text-delta', { text });
  }
}

function sendBriefingToolStep(step) {
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:briefing-tool-step', step);
  }
}

// verify.js 전용 DI(사실14) — 실제 CLI를 스폰하지 않는 스텁으로 러너 경로를
// 결정론으로 태우고, 스텁 호출 카운트로 실호출을 단언한다. 백엔드 왕복
// (budget/report)도 함께 바꿔칠 수 있다 — 개발 머신에 실백엔드가 떠 있어도
// 검증 결과가 흔들리지 않게. 프로덕션 코드는 아무도 부르지 않는다.
let briefingClaudeRunner = null; // null이면 실제 runClaudeQuery(아래 wired에서 대체)
let briefingBackendOverrides = null;
function setBriefingClaudeRunnerForVerify(stub, backendOverrides) {
  briefingClaudeRunner = stub;
  briefingBackendOverrides = backendOverrides || null;
}

function runBriefingTurnWired(event) {
  const { dir, configFile } = getLiveMcpConfig();
  // 툴 진행 표시는 사용자 턴과 같은 라벨 변환기를 쓰되 채널만 브리핑 전용이고,
  // 말걸기 가드 확인 카드는 전달하지 않는다(자동 턴에서 승인 카드 금지).
  const trackBriefingToolStep = createToolStepTracker(sendBriefingToolStep, { forwardNudgeGuard: false });
  const fetchBudget = (briefingBackendOverrides && briefingBackendOverrides.fetchBudget)
    || (async () => {
      // 조회 실패는 fail-open(1회분 허용) — 이벤트 자체가 백엔드발이라 백엔드가
      // 죽어 있으면 발화가 여기까지 오지도 않는다. 실제 상한 집행은 백엔드
      // (GET /briefing-budget)가 한다.
      const res = await routineHttp('GET', '/api/v1/routines/briefing-budget').catch(() => null);
      return res && res.ok ? res.data : { remaining: 1 };
    });
  const reportResult = (briefingBackendOverrides && briefingBackendOverrides.reportResult)
    || ((payload) => routineHttp(
      'POST',
      `/api/v1/routines/${encodeURIComponent(event.routine_id)}/briefing-result`,
      payload,
    ));
  return briefingRunner.runBriefingTurn({
    event,
    isUserBusy: () => liveQueryBusyDepth > 0, // 읽기 전용 — 절대 증감하지 않는다
    briefingBusy,
    fetchBudget,
    reportResult,
    ipc: {
      sendTextDelta: sendBriefingTextDelta,
      sendToolStep: sendBriefingToolStep,
      sendQueryState: sendBriefingQueryState,
    },
    claudeRunner: briefingClaudeRunner || { runClaudeQuery },
    cwd: dir,
    configFile,
    onEvent: trackBriefingToolStep,
    onCanvasResult: (r) => {
      // 카드 경로는 사용자 턴과 동일(athena:add-canvas-live) — 캔버스는 턴
      // 상태와 무관해 안전하다. pushed는 사이드 채널로 이미 도착한 카드다.
      if (r.status === 'pushed') return;
      sendLiveCanvasResult(r);
    },
  });
}

// ---------- 놓친 예약 캐치업(R1, 5단계) ----------
// 앱이 꺼져 있는 동안 지나간 예약을 기동 시 1회 감지해 채팅 카드로 물어본다.
// 자동 실행하지 않는다 — 사람이 [지금 브리핑]을 눌러야 ① catchup-fire(정식
// ledger "fired" 기록, 서버 authoritative fired_at) ② 브리핑 실행 순서로
// 이어진다(MAJOR 3 — 기록이 실행보다 먼저, 41번 이력·지표 왜곡 방지).

// 감지 시점의 라우틴 뷰 보관 — 확인 클릭 시 합성 routine-fired 이벤트의 재료
// (symbol/note/briefing_*)로 쓴다. 프로세스 로컬(재시작하면 재감지).
const missedRoutineViews = new Map();

// 셸 창·렌더러가 준비될 때까지 재시도하며 보낸다 — 백엔드가 이미 떠 있으면
// (already-running) 헬스체크가 즉시 끝나 createWindows()의 워밍업 시퀀스
// (~380ms+)보다 먼저 도달할 수 있다. 이 레이스에서 조용히 버리면 이번 세션
// 동안 캐치업 기회가 사라진다(기동 시 1회 감지라서) — 유실하지 않는다.
// 상한 후 포기: 창 자체가 안 뜨는 비정상 상황에서 영원히 들고 있지 않는다.
function sendRoutineMissed(missed) {
  const bootHandoffPending = bootWin && !bootWin.isDestroyed() && !shellExpansionAcknowledged;
  if (!bootHandoffPending && shellWin && !shellWin.isDestroyed()
      && !shellWin.webContents.isLoading()) {
    shellWin.webContents.send('athena:routine-missed', { routines: missed });
    return true;
  }
  startupRoutineBuffer.addMissed(missed);
  return false;
}

function flushStartupRoutineBuffer() {
  try {
    const result = startupRoutineBuffer.flush({
      sendEvent: sendRoutineEventToRenderers,
      sendMissed: (routines) => {
        if (!shellWin || shellWin.isDestroyed() || shellWin.webContents.isLoading()) {
          throw new Error('셸 렌더러가 아직 알림을 받을 수 없음');
        }
        shellWin.webContents.send('athena:routine-missed', { routines });
      },
    });
    if (result.events || result.missed) {
      mdlog(`부팅 중 보관 알림 전달 완료 — routine ${result.events}건, missed ${result.missed}건`);
    }
    return result;
  } catch (error) {
    mdlog(`부팅 중 보관 알림 전달 보류 — ${String((error && error.message) || error)}`);
    return { events: 0, missed: 0, pending: startupRoutineBuffer.snapshot() };
  }
}

async function checkMissedSchedules({ signal } = {}) {
  const res = await routineHttp('GET', '/api/v1/routines', undefined, { signal });
  if (!res || !res.ok) {
    throw new Error((res && res.error) || '루틴 목록 복원 상태를 확인하지 못함');
  }
  if (!res.data || !Array.isArray(res.data.routines)) {
    throw new Error('루틴 목록 응답 형식이 올바르지 않음');
  }
  const missed = res.data.routines.filter(
    (r) => r.mode === 'scheduled' && r.status === 'active' && r.missed === true,
  );
  if (!missed.length) return { routineCount: res.data.routines.length, missedCount: 0 };
  for (const r of missed) missedRoutineViews.set(r.id, r);
  sendRoutineMissed(missed);
  return { routineCount: res.data.routines.length, missedCount: missed.length };
}

function catchupFireHttp(routineId) {
  if (briefingBackendOverrides && briefingBackendOverrides.catchupFire) {
    return briefingBackendOverrides.catchupFire(routineId);
  }
  return routineHttp('POST', `/api/v1/routines/${encodeURIComponent(routineId)}/catchup-fire`);
}

ipcMain.handle('athena:routine-missed-confirm', async (_e, { id } = {}) => {
  try {
    // ① 먼저 정식 ledger 기록 — 실패(이미 처리된 409 포함)면 브리핑도 없다.
    const res = await catchupFireHttp(id);
    if (!res || !res.ok) {
      return { ok: false, status: (res && res.status) || 0, error: (res && res.error) || '캐치업 실패' };
    }
    const firedAt = res.data && res.data.fired_at;
    const view = missedRoutineViews.get(id);
    // ② 서버가 실제로 기록에 쓴 fired_at으로 합성 이벤트를 만들어 4단계 러너와
    // 같은 실행 경로를 태운다(멱등성 키·briefings 기록·시계 편차 전부 이 값 하나로 정합).
    runBriefingTurnWired({
      type: 'routine-fired',
      routine_id: id,
      symbol: view ? view.symbol : '',
      source: 'schedule.daily',
      mode: 'scheduled',
      observed: firedAt,
      note: view ? view.note : '',
      fired_at: firedAt,
      briefing_model: view ? view.briefing_model : null,
      briefing_effort: view ? view.briefing_effort : null,
    }).catch((err) => {
      mdlog(`캐치업 브리핑 실패: ${String((err && err.message) || err)}`);
    });
    missedRoutineViews.delete(id);
    return { ok: true, data: { fired_at: firedAt } };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('athena:routine-missed-skip', async (_e, { id } = {}) => {
  // 백엔드 API는 부르지 않는다(계획 명시 — 건너뛰기는 카드만 닫는다).
  // main 쪽 보관 뷰만 정리하는 수신 지점이다.
  missedRoutineViews.delete(id);
  return { ok: true };
});

app.on('will-quit', () => { if (routineFeed) routineFeed.stop(); });

// ---------- 차트 실시간 진행봉 — 키움 REAL 0B → 렌더러 ----------
// 접기(진행봉 갱신)는 렌더러가 한다(lib/chart-tick-fold.js 주석). 여기서는
// 종목 등록과 체결 전달만 맡는다. 업스트림 구독은 프로세스당 하나다.
const chartRealtime = require('./lib/main/chart-realtime');
const orderbookRealtime = require('./lib/main/orderbook-realtime');
const integratedCardRealtime = require('./lib/main/integrated-card-realtime');
// 보드 슬롯 하이드레이션 — 봉투가 못 채운 슬롯을 마운트 뒤에 한 번 더 채운다.
const boardHydrate = require('./lib/main/board-hydrate');
const chartSeries = require('./lib/main/chart-series');
// 백테스트 REST 프록시(P4, backtest-mode-plan.md §8.1) — routineHttp와 같은 원칙이지만
// main.js 밖 순수 함수라 단위 테스트(backtest-bridge.test.js)를 직접 붙일 수 있다.
const backtestBridge = require('./lib/main/backtest-bridge');

let chartRealtimeFeed = null;
let chartRealtimeRegistrar = null;
let orderbookRealtimeRegistrar = null; // 호가잔량(0D) 전용 — 0B 레지스트라와 참조를 안 섞는다(task #25)
let integratedCardRealtimeManager = null;
let integratedCardRealtimeTransport = null;
let realtimeFeedEpoch = 1;

const integratedRealtimeShutdown = integratedCardRealtime.createBoundedShutdownCoordinator({
  prepare: () => {
    isQuitting = true;
    if (providerRuntimeController) providerRuntimeController.blockNewTurns('app_shutdown');
    if (providerEpochStore) {
      try { providerEpochStore.invalidate(providerSecurityGeneration); }
      catch (error) { mdlog(`provider capability 종료 무효화 실패: ${String((error && error.message) || error)}`); }
    }
    stopOrbCursorPoll(); // 인터벌 누수 금지 — 창이 죽기 전에 정리한다
    chartReloadAuthority.clear();
    stockEntityIndexReadiness.stop();
    // 트레이로 숨겨진 동안에는 selector worker를 유지하고 실제 종료에서만 닫는다.
    selectorClaudePool.stop(new Error('Athena 앱 종료'));
    if (liveChatSession) liveChatSession.stop(new Error('Athena 앱 종료'));
    conversations.flushSync(); // 예약만 된 사이드바 상태를 마저 저장한다
    if (sessionBridge) sessionBridge.flushSync(); // 대기 중인 세션 디바운스·저널을 마저 쓴다
  },
  releaseAll: async () => {
    const shutdownRuntime = providerRuntimeController;
    const shutdownGeneration = shutdownRuntime
      ? shutdownRuntime.snapshot().runtimeGeneration
      : null;
    const realtimeRelease = integratedCardRealtimeManager
      ? integratedCardRealtimeManager.releaseAll()
      : Promise.resolve({ ok: true, pending: 0 });
    const providerStop = shutdownRuntime
      ? shutdownRuntime.stop('app_shutdown')
      : Promise.resolve();
    const [result] = await Promise.all([realtimeRelease, providerStop]);
    providerRuntimeReady = false;
    if (shutdownRuntime) {
      providerVerifierTelemetry.recordShutdownCompletion({
        runtimeGeneration: shutdownGeneration,
        stoppedSnapshot: shutdownRuntime.snapshot(),
      });
    }
    return result;
  },
  // REMOVE 요청이 끝나거나 제한 시간에 도달한 뒤에만 소유 백엔드를 종료한다.
  shutdownBackend: () => backendLauncher.shutdownBackend(),
  quit: () => app.quit(),
  onCleanupResult: (result) => {
    if (result && !result.ok) {
      mdlog(`통합 카드 REAL 종료 해제 미완료: pending=${result.pending}`);
    }
  },
  onCleanupError: (error) => {
    mdlog(`통합 카드 REAL 종료 해제 실패: ${String((error && error.message) || error)}`);
  },
  onShutdownError: (error) => {
    mdlog(`백엔드 종료 실패: ${String((error && error.message) || error)}`);
  },
});
app.on('before-quit', (event) => integratedRealtimeShutdown.begin(event));

// 경로 중립 — 호출부가 REST 데이터셋 직결(athena:rest-canvas-painted)이든 클로드
// 툴 실시간 경로(onCanvasResult, 단계 8 확장 2차)든 가리지 않는다. "종목코드를
// 아는 순간에만 등록한다"는 계약 하나만 지키면 된다. 레지스트라가 참조 계수형
// (2026-08-27)이라 어느 경로에서 불러도 acquire 1회로 셈된다 — 짝이 되는 release는
// releaseRealtimeForSymbol(카드 소멸 시점, 아래) 몫이다.
// 0B(체결)·0D(호가잔량) 둘 다 같은 업스트림 WS 소켓 하나(REAL 프레임 멀티플렉스,
// backend api/v1/ws/stream 실측)로 온다 — REG를 뭘 걸었든 소켓은 하나만 열면
// 된다. TR별 acquire(ensureRealtimeForSymbol/ensureOrderbookRealtimeForSymbol)가
// 어느 쪽이 먼저 불려도 이 하나를 공유하도록 지연 생성 + 두 파서를 한 곳에서 돌린다.
function ensureRealtimeFeed() {
  if (chartRealtimeFeed) return;
  chartRealtimeFeed = new RoutineFeed({
    url: `${BACKEND_WS_BASE}/api/v1/ws/stream`,
    token: LOCAL_BEARER_TOKEN,
    onEvent: (frame, feedMeta = {}) => {
      if (!shellWin || shellWin.isDestroyed()) return;
      // 거래일은 체결 시각(HHMMSS)에 날짜가 없어서 필요하다. 자정을 넘긴
      // 시간외 체결은 다음 날로 접히지만, 정규장 진행봉에는 영향이 없다.
      const ticks = chartRealtime.parseRealFrame(frame, chartRealtime.kstTradingDate());
      if (ticks.length) shellWin.webContents.send('athena:chart-ticks', ticks);
      const bookTicks = orderbookRealtime.parseQuoteBookFrame(frame);
      if (bookTicks.length) shellWin.webContents.send('athena:orderbook-ticks', bookTicks);
      if (integratedCardRealtimeManager) {
        const integratedTicks = integratedCardRealtimeManager.routeFrame(
          frame,
          Number(feedMeta.connectionEpoch) || realtimeFeedEpoch,
        );
        if (integratedTicks.length) {
          shellWin.webContents.send('athena:integrated-card-realtime-ticks', integratedTicks);
        }
      }
    },
    onStatus: (s) => {
      if (s && s.state) mdlog(`차트 실시간 피드: ${s.state}`);
      if (s && Number(s.connectionEpoch) >= realtimeFeedEpoch) {
        realtimeFeedEpoch = Number(s.connectionEpoch);
      }
      if (integratedCardRealtimeManager) {
        integratedCardRealtimeManager.handleFeedStatus(s, realtimeFeedEpoch).catch((error) => {
          mdlog(`통합 카드 REAL 재등록 예외: ${String((error && error.message) || error)}`);
        });
      }
    },
  });
  chartRealtimeFeed.start();
}

function getIntegratedCardRegistrar(binding) {
  if (!binding.accountId && binding.operationId === chartRealtime.REAL_TR_ID) {
    if (!chartRealtimeRegistrar) {
      chartRealtimeRegistrar = chartRealtime.createRealtimeRegistrar({
        backendBase: BACKEND_HTTP_BASE,
        fetchImpl: integratedCardRealtime.createValidatedFetch(fetch),
        mdlog,
      });
    }
    return chartRealtimeRegistrar;
  }
  if (!binding.accountId && binding.operationId === orderbookRealtime.REAL_TR_ID) {
    if (!orderbookRealtimeRegistrar) {
      orderbookRealtimeRegistrar = chartRealtime.createRealtimeRegistrar({
        backendBase: BACKEND_HTTP_BASE,
        fetchImpl: integratedCardRealtime.createValidatedFetch(fetch),
        mdlog,
        trId: orderbookRealtime.REAL_TR_ID,
      });
    }
    return orderbookRealtimeRegistrar;
  }
  return chartRealtime.createRealtimeRegistrar({
    backendBase: BACKEND_HTTP_BASE,
    fetchImpl: integratedCardRealtime.createValidatedFetch(fetch),
    mdlog,
    trId: binding.operationId,
    account: binding.accountId || null,
  });
}

function ensureIntegratedCardRealtimeManager() {
  if (integratedCardRealtimeManager) return integratedCardRealtimeManager;
  integratedCardRealtimeTransport = integratedCardRealtime.createRegistrarTransport({
    backendBase: BACKEND_HTTP_BASE,
    mdlog,
    registrarProvider: getIntegratedCardRegistrar,
  });
  integratedCardRealtimeManager = new integratedCardRealtime.CardLeaseManager({
    transport: integratedCardRealtimeTransport,
    initialConnectionGeneration: realtimeFeedEpoch,
    semanticBindingSourceProvider: integratedCardRealtime.createSemanticBindingSourceProvider({
      backendBase: BACKEND_HTTP_BASE,
      token: LOCAL_BEARER_TOKEN,
      fetchImpl: fetch,
    }),
    onState: (state) => {
      if (shellWin && !shellWin.isDestroyed()) {
        shellWin.webContents.send('athena:integrated-card-realtime-state', state);
      }
    },
  });
  return integratedCardRealtimeManager;
}

function ensureRealtimeForSymbol(code) {
  if (process.env.ATHENA_CANVAS_SOURCE === 'fixture') return; // 검증 결정론 보호
  const trimmed = String(code || '').trim();
  if (!trimmed) return;

  if (!chartRealtimeRegistrar) {
    chartRealtimeRegistrar = chartRealtime.createRealtimeRegistrar({
      backendBase: BACKEND_HTTP_BASE,
      fetchImpl: integratedCardRealtime.createValidatedFetch(fetch),
      mdlog,
    });
  }
  ensureRealtimeFeed();
  chartRealtimeRegistrar.acquire(trimmed).catch((err) => {
    mdlog(`차트 REAL 등록 예외: ${String((err && err.message) || err)}`);
  });
}

// ensureRealtimeForSymbol의 호가잔량(0D) 짝 — 종목당 열린 호가 카드가 명시적으로
// acquire/release를 낸다(athena:orderbook-realtime-acquire/-release, canvas.js
// wireOrderbookRealtime). 0B처럼 "봉투에 종목코드가 있으면 무조건 acquire"가
// 아니다 — 호가 카드가 실제로 열려 있을 때만 REG를 쓴다(리미터 절약).
function ensureOrderbookRealtimeForSymbol(code) {
  if (process.env.ATHENA_CANVAS_SOURCE === 'fixture') return; // 검증 결정론 보호
  const trimmed = String(code || '').trim();
  if (!trimmed) return;

  if (!orderbookRealtimeRegistrar) {
    orderbookRealtimeRegistrar = chartRealtime.createRealtimeRegistrar({
      backendBase: BACKEND_HTTP_BASE,
      fetchImpl: integratedCardRealtime.createValidatedFetch(fetch),
      mdlog,
      trId: orderbookRealtime.REAL_TR_ID,
    });
  }
  ensureRealtimeFeed();
  orderbookRealtimeRegistrar.acquire(trimmed).catch((err) => {
    mdlog(`호가 REAL 등록 예외: ${String((err && err.message) || err)}`);
  });
}

function releaseOrderbookRealtimeForSymbol(code) {
  if (process.env.ATHENA_CANVAS_SOURCE === 'fixture') return;
  const trimmed = String(code || '').trim();
  if (!trimmed || !orderbookRealtimeRegistrar) return;
  orderbookRealtimeRegistrar.release(trimmed).catch((err) => {
    mdlog(`호가 REAL 해제 예외: ${String((err && err.message) || err)}`);
  });
}

// ensureRealtimeForSymbol의 짝 — 카드/패널이 렌더러에서 소멸할 때 부른다(아래
// athena:realtime-release, athena:chart-panel-destroyed 두 IPC가 이걸 부른다).
// 레지스트라가 참조 계수를 들고 있으므로 여기서는 그대로 넘기기만 하면 된다 —
// 마지막 참조였는지 판단은 레지스트라 몫이다.
function releaseRealtimeForSymbol(code) {
  if (process.env.ATHENA_CANVAS_SOURCE === 'fixture') return;
  const trimmed = String(code || '').trim();
  if (!trimmed || !chartRealtimeRegistrar) return;
  chartRealtimeRegistrar.release(trimmed).catch((err) => {
    mdlog(`차트 REAL 해제 예외: ${String((err && err.message) || err)}`);
  });
}

// REST 데이터셋 직결 카드(athena:rest-canvas-painted) 전용 진입점 — "그려진 걸
// 확인한 뒤에만 REG"를 지킨다. 어느 카드종이든(시세 카드 포함, 단계 8 확장 1차)
// authority.operationArgs.stk_cd 폴백으로 종목코드가 있으면 등록된다.
//
// panelId(AITS 차트 카드만 갖는다, chart-panel-destroyed 실측)가 있으면 그
// panelId 하나당 acquire를 정확히 1회만 낸다 — 같은 패널이 재조회 등으로 paint
// ack를 또 보내도(카드 자체는 안 죽고 재사용) 참조를 중복으로 쌓지 않는다.
// 패널이 실제로 죽을 때(athena:chart-panel-destroyed) 이 맵에 적어둔 종목으로
// 정확히 1회 release한다 — chartBody.stock(여기)과 렌더러의 data.symbol(카드
// 표시용)은 서로 다른 필드라 값이 어긋날 수 있어, release는 main이 acquire 때
// 실제로 쓴 값을 그대로 재사용한다(필드 교차로 카운트가 새는 사고를 원천 차단).
// panelId가 없는 카드(표/시세 등 non-AITS 카드)는 매번 그대로 acquire한다 —
// 그쪽은 매 paint마다 makeCard가 새 DOM 카드를 만들어(재사용 없음) 늘 진짜 새
// 참조이고, 짝이 되는 release는 wireQuoteRealtime의 destroy 훅(canvas.js)이 낸다.
const chartRealtimePanelSymbols = new Map(); // panelId -> code

function ensureChartRealtime(authority, panelId) {
  const stock = authority && authority.chartBody && authority.chartBody.stock;
  const code = stock || (authority && authority.operationArgs && authority.operationArgs.stk_cd);
  const trimmed = String(code || '').trim();
  if (!trimmed) return;
  if (panelId) {
    if (chartRealtimePanelSymbols.has(panelId)) return; // 이 패널은 이미 참조를 쥐고 있다
    chartRealtimePanelSymbols.set(panelId, trimmed);
  }
  ensureRealtimeForSymbol(trimmed);
}

// 클로드 툴 실시간 경로(onCanvasResult) 전용 진입점 — 이 경로엔 페인트 왕복이
// 없어(athena:add-canvas-live는 편도) "그려진 뒤에만"을 못 지킨다. 대신 결과
// 수신 시점에 등록한다: envelope이 유효해야 카드가 뜬다는 점에서 결정적이고,
// REG는 종목당 1회 dedup이라 낭비 상한이 작다(페인트 ack가 이 경로에도
// 생기면 ensureChartRealtime과 합친다).
//
// 옛 제약은 해소됐다(2026-08-27 backend 53ece06) — canvas_kind별 envelope
// 빌더가 비대칭이라 "table" 분기(시세 카드가 쓰는 canvas_kind)에는 종목코드를
// 담을 자리가 아예 없었는데, 이제 canvas_context.symbol 봉인 게이트가 시장
// 데이터 3도메인(charts·stockinfo·quotes) 전부에서 envelope.stk_cd로 실린다
// (canvas_push.py/canvas_data.py 공통). 계좌·주문류(canvas_context 게이트 밖)는
// 여전히 이 필드가 없어 자연 배제된다 — 아래 후보 목록은 그 신규 필드를 포함해
// 여러 자리를 본다(chart는 data.symbol에도 실리는 AITS DTO 계약과 중복 커버).
function extractLiveQuoteSymbol(envelope) {
  if (!envelope) return null;
  const candidates = [
    envelope.operation_args && envelope.operation_args.stk_cd,
    envelope.operationArgs && envelope.operationArgs.stk_cd,
    envelope.stk_cd,
    envelope.data && envelope.data.stk_cd,
    envelope.data && envelope.data.symbol,
  ];
  const found = candidates.find((v) => typeof v === 'string' && v.trim());
  return found ? found.trim() : null;
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
    readyFeed: 'canvas',
    token: LOCAL_BEARER_TOKEN,
    onEvent: (envelope) => {
      if (!envelope || !envelope.canvas_type) return;
      // 옛 판은 여기서 캔버스 창을 열었다(expandCanvasWindow). 중앙 캔버스는 늘
      // 떠 있으므로 남는 의미는 "창을 앞으로"뿐이다 — 포커스는 뺏지 않는다.
      revealShell({ focus: false });
      // 실시간 등록 — 라이브 봉투의 주 통로는 onCanvasResult(MCP 결과 콜백)가
      // 아니라 이 push 사이드채널이다. 봉인된 종목코드가 있으면 여기서 건다
      // (2026-08-27 장중 QA 실측: onCanvasResult에만 걸었더니 REG 0건).
      const pushedSymbol = extractLiveQuoteSymbol(envelope);
      if (pushedSymbol) ensureRealtimeForSymbol(pushedSymbol);
      sendLiveCanvasResult({
        toolUseId: 'canvas-push',
        status: envelope.fell_back ? 'fallback' : 'success',
        envelope,
      });
    },
    onStatus: (s) => reportStartupFeedStatus('canvas-feed', s),
  });
  canvasFeed.start();
}

app.on('will-quit', () => { if (canvasFeed) canvasFeed.stop(); });

// 루틴 REST 프록시 — 렌더러는 백엔드에 직접 붙지 않는다(기존 IPC 관례).
// confirm/cancel은 **사람 클릭 전용** 경로다(실행계획 §7-6 — 모델 툴에는 없다).
// jsonBody(선택)는 JSON 직렬화해 보낸다 — briefing-result(R1, 4단계)가 첫 사용처다.
async function routineHttp(method, path, jsonBody, { signal } = {}) {
  const opts = { method, ...(signal ? { signal } : {}) };
  if (jsonBody !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(jsonBody);
  }
  const res = await fetch(`${BACKEND_HTTP_BASE}${path}`, opts);
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
  try {
    const result = await routineHttp('POST', `/api/v1/routines/${encodeURIComponent(id)}/confirm`);
    // 감시 확정 성공을 오브에 신호로 릴레이한다(board-30⑧) — 위 athena:orb-signal
    // 릴레이(797행)와 같은 원칙: main은 판단하지 않는다. 신호를 받아 언제
    // 어떤 표정으로 바꿀지는 orb.js가 정한다.
    if (result.ok && orbWin && !orbWin.isDestroyed()) {
      orbWin.webContents.send('athena:orb-signal', { signal: 'registered' });
    }
    return result;
  }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
ipcMain.handle('athena:routine-cancel', async (_e, { id }) => {
  try { return await routineHttp('POST', `/api/v1/routines/${encodeURIComponent(id)}/cancel`); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
ipcMain.handle('athena:routine-pause', async (_e, { id }) => {
  try { return await routineHttp('POST', `/api/v1/routines/${encodeURIComponent(id)}/pause`); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
ipcMain.handle('athena:routine-resume', async (_e, { id }) => {
  try { return await routineHttp('POST', `/api/v1/routines/${encodeURIComponent(id)}/resume`); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// 실행 이력 드릴인(10단계) — 6단계 GET /{id}/runs를 사람 클릭 전용 경로로 노출한다.
ipcMain.handle('athena:routine-runs', async (_e, { id }) => {
  try { return await routineHttp('GET', `/api/v1/routines/${encodeURIComponent(id)}/runs`); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// 알림 방 읽음 처리(7단계, F3-FE) — 6단계 read-marks에 남겨 재시작 후에도
// 읽음 상태가 유지되게 한다. body 없이 부르면 백엔드가 현재 시각까지 기록한다.
ipcMain.handle('athena:routine-ack', async (_e, { id }) => {
  try { return await routineHttp('POST', `/api/v1/routines/${encodeURIComponent(id)}/ack`); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// 설정 편집 적용(Step 6, 결정 a″) — 6단계 POST /{id}/update. body를 실어
// 보낸다: routineHttp가 jsonBody !== undefined일 때 JSON으로 직렬화한다
// (briefing-result가 같은 방식을 먼저 쓴다) — 그래서 fetch를 직접 부르지
// 않는다. 422(금지 필드)·404·409의 detail 번역이 routineHttp에 이미 있다.
ipcMain.handle('athena:routine-update', async (_e, { id, body } = {}) => {
  try { return await routineHttp('POST', `/api/v1/routines/${encodeURIComponent(id)}/update`, body); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// 초안 등록(Step 6, 결정 a″-1) — POST /routines/draft. 백엔드는 raw dict를
// 그대로 받으므로 여기서 모양을 손대지 않는다.
ipcMain.handle('athena:routine-draft', async (_e, { body } = {}) => {
  try { return await routineHttp('POST', '/api/v1/routines/draft', body); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// 감시 코드 검사(Step 6) — POST /routines/watch/check. 위 routine-update와 같은
// 모양이다: 렌더러가 조립한 body를 그대로 실어 보내고, 실패는 {ok:false,error}로
// 감싼다. 백엔드 실행층이 꺼져 있으면 409가 오고 detail 번역은 routineHttp 몫이다.
ipcMain.handle('athena:routine-watch-check', async (_e, { body } = {}) => {
  try { return await routineHttp('POST', '/api/v1/routines/watch/check', body); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// 감시 코드 착지(Step 6) — POST /routines/watch/code. 켜져 있는 알람이 가리키는
// 파일을 덮어쓰려 하면 백엔드가 409로 막는다(먼저 일시중지해야 한다).
ipcMain.handle('athena:routine-watch-code', async (_e, { body } = {}) => {
  try { return await routineHttp('POST', '/api/v1/routines/watch/code', body); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// 상세 조회(Step 6, 결정 d-2) — GET /{id}. 상세 패널의 설정 폼을 열 때 1회
// 불러 조건 술어·source_spec을 프리필한다(목록 뷰에는 없는 값이다). 위
// routine-runs와 같은 모양이며 body가 없다.
ipcMain.handle('athena:routine-detail', async (_e, { id }) => {
  try { return await routineHttp('GET', `/api/v1/routines/${encodeURIComponent(id)}`); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// 소스 카탈로그(Step 6, 결정 e-1) — GET /routines/source-catalog. 새 작업
// 시트는 routine_id가 없어 상세 라우트를 쓸 수 없다. 인자도 body도 없다.
ipcMain.handle('athena:routine-source-catalog', async () => {
  try { return await routineHttp('GET', '/api/v1/routines/source-catalog'); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// 발화 열람·응답 계측(F-stage5b-FE) — engagement.py로 그대로 넘긴다. "언제
// opened/replied로 볼지"의 판정은 렌더러(sidebar.js/chat.js) 몫이다(engagement.py
// 모듈 독스트링 참고) — 여기는 REST 프록시일 뿐 판정을 갖지 않는다.
ipcMain.handle('athena:routine-engagement', async (_e, { id, event } = {}) => {
  try {
    const res = await fetch(`${BACKEND_HTTP_BASE}/api/v1/routines/${encodeURIComponent(id)}/engagement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event }),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok
      ? { ok: true, data }
      : { ok: false, status: res.status, error: data.detail || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// 말걸기 가드 설정 REST 프록시(F-stage9) — routineHttp와 별개다. 라우틴별
// 목록이 아니라 전역 설정 한 벌이고(8단계 nudge_guard.py), set은 body가
// 필요해 routineHttp(body 없음 전제)를 재사용하지 않는다.
ipcMain.handle('athena:nudge-guard-get', async () => {
  try {
    const res = await fetch(`${BACKEND_HTTP_BASE}/api/v1/nudge-guard`);
    const data = await res.json().catch(() => ({}));
    return res.ok
      ? { ok: true, data }
      : { ok: false, status: res.status, error: data.detail || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});
ipcMain.handle('athena:nudge-guard-set', async (_e, body) => {
  try {
    const res = await fetch(`${BACKEND_HTTP_BASE}/api/v1/nudge-guard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok
      ? { ok: true, data }
      : { ok: false, status: res.status, error: data.detail || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// 백테스트 REST 프록시(P4, backtest-mode-plan.md §8.2) — routineHttp와 같은 원칙(렌더러는
// 백엔드에 직접 붙지 않는다). 별도 파일(lib/main/backtest-bridge.js)로 뺀 이유는 단위 테스트
// (backtest-bridge.test.js) — routineHttp는 main.js 안에 있어 직접 테스트하지 못했다.
ipcMain.handle('athena:backtest-presets', async () => {
  try { return await backtestBridge.fetchPresets({ backendBase: BACKEND_HTTP_BASE, fetchImpl: fetch }); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
ipcMain.handle('athena:backtest-plan', async (_e, body = {}) => {
  try { return await backtestBridge.planBacktest({ backendBase: BACKEND_HTTP_BASE, fetchImpl: fetch, ...body }); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
ipcMain.handle('athena:backtest-run', async (_e, body = {}) => {
  try {
    const res = await backtestBridge.runBacktest({ backendBase: BACKEND_HTTP_BASE, fetchImpl: fetch, ...body });
    attachSessionJob(res, 'run_id', 'backtest.run');
    return res;
  }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// 백필 잡 상태(수집 승인 카드가 진행률을 폴링한다).
ipcMain.handle('athena:backtest-status', async (_e, { job_id } = {}) => {
  try {
    const res = await backtestBridge.fetchJobStatus({ backendBase: BACKEND_HTTP_BASE, fetchImpl: fetch, job_id });
    syncSessionJob(job_id, res);
    return res;
  }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// 실행 상태+지표+자산곡선+stdout — running 상태가 1초 간격으로 이 채널을 폴링한다.
ipcMain.handle('athena:backtest-result', async (_e, { run_id } = {}) => {
  try {
    const res = await backtestBridge.fetchRunResult({ backendBase: BACKEND_HTTP_BASE, fetchImpl: fetch, run_id });
    syncSessionJob(run_id, res);
    return res;
  }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
ipcMain.handle('athena:backtest-trades', async (_e, { run_id } = {}) => {
  try { return await backtestBridge.fetchRunTrades({ backendBase: BACKEND_HTTP_BASE, fetchImpl: fetch, run_id }); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
ipcMain.handle('athena:backtest-runs', async () => {
  try { return await backtestBridge.fetchRuns({ backendBase: BACKEND_HTTP_BASE, fetchImpl: fetch }); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// 사람 클릭 전용 경로(계획서 §7.6/§9와 같은 원칙) — 쿼터를 태우는 백필은 모델 툴에 없다.
// 캔버스의 [수집하고 실행] 버튼 클릭에서만 이 IPC를 부른다.
ipcMain.handle('athena:backtest-backfill', async (_e, body = {}) => {
  try {
    const res = await backtestBridge.backfillBacktest({ backendBase: BACKEND_HTTP_BASE, fetchImpl: fetch, ...body });
    attachSessionJob(res, 'job_id', 'backtest.backfill');
    return res;
  }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

// 2026-09-01 전수 파리티 — Paper 보드 02·05·06·07·08·09. 전부 같은 프록시 모양이라
// 표 하나로 등록한다(핸들러마다 같은 try/catch를 스무 번 복사할 이유가 없다).
// `athena:backtest-activate`·`-deployment-create`·`-deployment-stop`은 사람 클릭 전용
// 경로다 — 모델의 MCP 툴에는 이 액션들이 없다(backtest_tools.py `_ALLOWED_ACTIONS`).
const BACKTEST_EXTRA_CHANNELS = {
  'athena:backtest-validate': backtestBridge.validateBacktest,
  'athena:backtest-coverage': backtestBridge.fetchCoverage,
  'athena:backtest-flow': backtestBridge.fetchFlow,
  // 흐름 지도(2026-09-03) — 설계의 첫 표면. 폼(yaml)이든 코드(source)든 같은 라우트다.
  'athena:backtest-map': backtestBridge.fetchMap,
  // 지도 뒤의 코드 생성 — 저장하지 않는다(소스만 돌려준다, §7.3).
  'athena:backtest-codegen': backtestBridge.fetchCodegen,
  // 새 기법 만들기(2026-09-03, 보드 20·21) — 코드 한 덩이를 노드로 자르는 길과
  // 자동 검사(차단 5 + 경고 2)를 도는 길. 둘 다 저장하지 않는다(검사의 시험 실행도
  // 이력을 남기지 않는다) — 그 경계는 백엔드가 진다.
  'athena:backtest-technique-nodes': backtestBridge.fetchTechniqueNodes,
  'athena:backtest-technique-check': backtestBridge.fetchTechniqueCheck,
  // 시각 설계 ↔ 코드 왕복(2026-09-03) — 대화형 오류 수정 계약의 요청 표면이다.
  // visual-save는 기존 버전 라우트로 간다(새 저장 경로 없음). 저장해도 활성화·실행은
  // 일어나지 않는다 — 그 경계는 백엔드가 지고, 여기서는 프록시만 한다.
  'athena:backtest-visual-registry': backtestBridge.fetchVisualRegistry,
  'athena:backtest-visual-validate': backtestBridge.validateVisual,
  'athena:backtest-visual-compile': backtestBridge.compileVisual,
  'athena:backtest-visual-question': backtestBridge.visualQuestion,
  'athena:backtest-visual-patch': backtestBridge.visualPatch,
  'athena:backtest-visual-from-spec': backtestBridge.visualFromSpec,
  'athena:backtest-visual-save': backtestBridge.saveVisualVersion,
  'athena:backtest-diagnose': backtestBridge.diagnoseBacktest,
  'athena:backtest-optimize': backtestBridge.optimizeBacktest,
  'athena:backtest-optimize-plan': backtestBridge.optimizePlan,
  'athena:backtest-strategies': backtestBridge.fetchStrategies,
  'athena:backtest-strategy-create': backtestBridge.createStrategy,
  'athena:backtest-versions': backtestBridge.fetchVersions,
  'athena:backtest-version-add': backtestBridge.addVersion,
  'athena:backtest-activate': backtestBridge.activateVersion,
  'athena:backtest-version-diff': backtestBridge.fetchVersionDiff,
  // 버전 하나의 묶음(그래프·소스맵·해시) — 이력에서 지난 시각 버전을 그대로 다시 연다(US-010).
  'athena:backtest-version-detail': backtestBridge.fetchVersionDetail,
  'athena:backtest-deployments': backtestBridge.fetchDeployments,
  'athena:backtest-deployment-create': backtestBridge.createDeployment,
  'athena:backtest-deployment-stop': backtestBridge.stopDeployment,
  'athena:backtest-deployment-arm': backtestBridge.armDeployment,
  'athena:backtest-signals': backtestBridge.fetchSignals,
  'athena:backtest-evaluate': backtestBridge.evaluateDeployment,
  // 2026-09-02 사용자 전략 등록부 — 등록·해제는 사람이 누르는 버튼이다(모델의 MCP
  // 툴에는 register_strategy만 있고 해제는 없다). 소스는 지나가지 않는다 — 등록부에
  // 남는 것은 {project_id, 상대경로, 이름}뿐이고 실행은 늘 그때의 파일을 다시 읽는다.
  'athena:backtest-user-strategies': backtestBridge.fetchUserStrategies,
  'athena:backtest-user-strategy-register': backtestBridge.registerUserStrategy,
  'athena:backtest-user-strategy-unregister': backtestBridge.unregisterUserStrategy,
};
Object.keys(BACKTEST_EXTRA_CHANNELS).forEach((channel) => {
  const call = BACKTEST_EXTRA_CHANNELS[channel];
  ipcMain.handle(channel, async (_e, body = {}) => {
    try { return await call({ backendBase: BACKEND_HTTP_BASE, fetchImpl: fetch, ...body }); }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });
});

// 프로젝트 파일 API(2026-09-02) — 코드 탭이 "내 컴퓨터의 폴더 하나"를 여는 자리다.
// 위 백테스트 채널과 같은 프록시 규칙을 쓴다 — 경로 검사는 백엔드가 진다(400/415).
const PROJECT_CHANNELS = {
  'athena:project-list': backtestBridge.listProjects,
  'athena:project-create': backtestBridge.createProject,
  'athena:project-open': backtestBridge.openProject,
  'athena:project-tree': backtestBridge.fetchProjectTree,
  'athena:project-file-read': backtestBridge.readProjectFile,
  'athena:project-file-write': backtestBridge.writeProjectFile,
  'athena:project-file-create': backtestBridge.createProjectFile,
  'athena:project-file-rename': backtestBridge.renameProjectFile,
  'athena:project-file-delete': backtestBridge.deleteProjectFile,
  // 가상환경(2026-09-02) — 만드는 것은 돈도 할당량도 지나지 않는 준비 작업이라
  // 대화가 몰아도 되는 경로다. 진행은 202가 준 job_id를 athena:backtest-status로 본다.
  'athena:project-env-get': backtestBridge.fetchProjectEnv,
  'athena:project-env-create': backtestBridge.createProjectEnv,
};
Object.keys(PROJECT_CHANNELS).forEach((channel) => {
  const call = PROJECT_CHANNELS[channel];
  ipcMain.handle(channel, async (_e, body = {}) => {
    try { return await call({ backendBase: BACKEND_HTTP_BASE, fetchImpl: fetch, ...body }); }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });
});

// 폴더는 사람이 고른다 — 렌더러가 경로를 지어내 여는 길은 없다(handlePickFiles와 같은 원칙).
ipcMain.handle('athena:project-open-dialog', async () => {
  try {
    const res = await dialog.showOpenDialog(shellWin, { properties: ['openDirectory'] });
    const picked = (res.filePaths || [])[0] || null;
    return { ok: true, data: { canceled: res.canceled || !picked, path: picked } };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

// 아래 핸들러 넷(add·pin·reveal·remove)은 35409b8에서 위 project-open-dialog 핸들러의
// 본문 *안*에 들어가 있었다 — 백테스트의 폴더 대화상자를 한 번 열기 전에는 등록조차
// 되지 않아 사이드바의 폴더 추가·고정·제거가 "No handler registered"로 죽었다
// (2026-09-05 프로브 실측). 최상위로 꺼낸다. update는 같은 날 새로 얹은 것이다.
// 사이드바 프로젝트(36·37번 보드) — 프로젝트는 폴더 하나다. 폴더는 대화상자로 사람이
// 고르고, 백엔드 레지스트리가 등록하며(같은 폴더 두 번 등록은 백엔드가 409로 막는다),
// 사이드바 레코드는 백엔드 id로 이어진다. 두 목록이 다른 id를 들면 같은 폴더가 두 얼굴이 된다.
ipcMain.handle('athena:project-add', async () => {
  let picked = null;
  try {
    const res = await dialog.showOpenDialog(shellWin, { properties: ['openDirectory'] });
    picked = res.canceled ? null : ((res.filePaths || [])[0] || null);
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  if (!picked) return { ok: true, canceled: true };
  const taken = conversations.list().projects.find((row) => row.path
    && path.resolve(row.path).toLowerCase() === path.resolve(picked).toLowerCase());
  if (taken) return { ok: false, reason: 'folder_taken', project: taken, path: picked };
  let registered = null;
  try {
    const opened = await backtestBridge.openProject({ backendBase: BACKEND_HTTP_BASE, fetchImpl: fetch, path: picked });
    registered = opened && opened.ok && opened.data && opened.data.project ? opened.data.project : null;
    if (!registered && opened && !opened.ok) mdlog(`프로젝트 백엔드 등록 실패 — ${String(opened.error || '')}`);
  } catch (e) { mdlog(`프로젝트 백엔드 등록 실패 — ${String((e && e.message) || e)}`); }
  // 백엔드가 없어도 폴더는 폴더다 — 사이드바 레코드는 만들고, id는 백엔드 것이 있으면 그것을 쓴다.
  const added = conversations.addProject({
    id: registered ? registered.id : undefined,
    path: registered ? registered.path : picked,
    label: registered ? registered.name : path.basename(picked),
  });
  return { ...added, path: picked, backendRegistered: Boolean(registered) };
});
ipcMain.handle('athena:project-pin', (_e, { id, pinned } = {}) => conversations.setProjectPinned(id, Boolean(pinned)));
// '프로젝트 수정'(29번 보드) — 이름·설명만. 폴더는 건드리지 않는다.
ipcMain.handle('athena:project-update', (_e, { id, label, description } = {}) => conversations.updateProject({ id, label, description }));
ipcMain.handle('athena:project-reveal', async (_e, { id } = {}) => {
  const project = conversations.projectById(id);
  if (!project || !project.path) return { ok: false, reason: 'no_path' };
  const error = await shell.openPath(project.path);
  return error ? { ok: false, error } : { ok: true, path: project.path };
});
// 제거는 폴더 삭제다(37번 보드) — 휴지통을 거치지 않는 영구 삭제라 이름을 그대로 다시
// 쳐야 한다. 이름이 다르면 아무것도 지우지 않는다. 폴더가 없어도 레코드는 지운다.
ipcMain.handle('athena:project-remove', async (_e, { id, confirmName } = {}) => {
  const project = conversations.projectById(id);
  if (!project) return { ok: false, reason: 'unknown_project' };
  if (typeof confirmName !== 'string' || confirmName.trim() !== project.label) return { ok: false, reason: 'name_mismatch' };
  if (project.path) {
    try { await fs.promises.rm(project.path, { recursive: true, force: true }); }
    catch (e) { return { ok: false, reason: 'rm_failed', error: String((e && e.message) || e) }; }
  }
  if (typeof backtestBridge.unregisterProject === 'function') {
    try { await backtestBridge.unregisterProject({ backendBase: BACKEND_HTTP_BASE, fetchImpl: fetch, project_id: id }); }
    catch (e) { mdlog(`프로젝트 백엔드 등록 해제 실패 — ${String((e && e.message) || e)}`); }
  }
  const removed = conversations.removeProject(id);
  if (removed && removed.ok && removed.removed) {
    const bridge = getSessionBridge();
    // 세션 본문도 함께 지운다 — 목록에서만 빼고 본문을 남기면 "지우는 주체는 사용자"가 거짓이 된다.
    if (bridge && bridge.store) for (const conversationId of removed.removed.conversationIds) bridge.store.deleteSession(conversationId);
  }
  return removed;
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

function broadcastShellWindowState(win = shellWin) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send('athena:window-state', { maximized: win.isMaximized() });
}

let shellChromeGeometry = {
  visible: false, titlebar: null, controls: null, zoomFactor: 1,
  generation: null, revision: 0,
};

function invalidateShellChromeGeometry({ resetGeneration = false } = {}) {
  shellChromeGeometry = windowChromeGeometry.hiddenGeometry(shellChromeGeometry,
    resetGeneration ? { generation: null, revision: 0 } : {});
}

function updateShellChromeGeometry(win, payload = {}) {
  if (!win || win.isDestroyed()) return false;
  const zoomFactor = win.webContents.getZoomFactor();
  const result = windowChromeGeometry.validateGeometryUpdate({
    current: shellChromeGeometry,
    payload,
    zoomFactor,
    contentBounds: win.getContentBounds(),
  });
  shellChromeGeometry = result.geometry;
  return result.accepted;
}

ipcMain.on('athena:window-chrome-geometry', (event, payload) => {
  if (!shellWin || shellWin.isDestroyed() || event.sender !== shellWin.webContents) return;
  updateShellChromeGeometry(shellWin, payload);
});

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
  win.on('resize', () => {
    invalidateShellChromeGeometry();
    queueArrange();
  });
  win.on('moved', queueArrange);
  win.on('resized', queueArrange);
  // 최대화·최소화는 이제 OS에 그대로 맡긴다(2026-08-24 리프 1.2.1).
  // 옛 판은 OS 최대화를 즉시 되돌리고(unmaximize) 대화 창의 높이 토글
  // (chatBaseH↔chatMaxH)에 위임했다 — 창 높이가 곧 대화 이력의 높이였기 때문이다.
  // 셸 창에서는 최대화가 그냥 창 최대화이고 그 안의 3영역은 자기 비율대로 늘어난다.
  // 되돌릴 이유도, 위임할 렌더러 상태도 없어졌으므로 핸들러 자체를 지웠다.
  // 최대화 상태에서는 handleForeignArrange가 조기 반환하므로(isMaximized 가드)
  // 스냅 정착이 최대화를 깨뜨리지도 않는다.
  win.on('maximize', () => {
    noteAppBounds(win);
    broadcastShellWindowState(win);
  });
  win.on('unmaximize', () => {
    noteAppBounds(win);
    broadcastShellWindowState(win);
  });
  // 작업 표시줄에서 복원되는 경로도 현재 상태를 다시 확정한다. 이벤트 payload는
  // BrowserWindow.isMaximized()에서 만들기 때문에 모니터/DPI 기하에 의존하지 않는다.
  win.on('restore', () => broadcastShellWindowState(win));

}

// ---------- 창 이동 — 네이티브 캡션(-webkit-app-region) ----------
// #dragStrip 전체는 DWM 네이티브 이동·가장자리 스냅을 유지한다. transparent 창의
// 더블클릭 제한을 보완하는 중앙 48px 센서만 no-drag이며 이동 IPC는 두지 않는다.

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
  const tx = Math.round(bounds.x + (Number(dx) || 0));
  const ty = Math.round(bounds.y + (Number(dy) || 0));
  // K4 결정(2026-08-27 질의응답) — 창 중심이 workArea 밖으로 못 나가게 자른다
  // (최소 절반은 항상 보인다). 위치 영속화가 없어 밖으로 나가면 복귀 수단이 앱
  // 재시작뿐이었다. 목적지 중심에 가장 가까운 디스플레이 기준이라 모니터 사이
  // 이동은 그대로 된다 — 클램프 산수는 window-placement.js(순수 함수)에 있다.
  const wa = screen.getDisplayNearestPoint({ x: tx + Math.round(bounds.width / 2), y: ty + Math.round(bounds.height / 2) }).workArea;
  const { x: nx, y: ny } = clampCenterToWorkArea({ x: tx, y: ty, width: bounds.width, height: bounds.height }, wa);
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

// ---------- 닫기(백그라운드 유지) + 트레이 복귀 (AT-CH-001, 2026-08-18) ----------
// 닫기 버튼은 종료가 아니다 — 셸 창을 숨기고 프로세스(세션·자격증명·감시)는 그대로
// 산다(사용자 지시 "백그라운드는 살아있음"). 숨은 창은 작업 표시줄에도 없으므로
// 복귀 경로가 반드시 필요하다 — 그게 이 트레이다(브랜드 점 아이콘, 클릭=열기).
// Alt+F4 등 OS close 이벤트도 createWindows()의 close 핸들러가 같은
// enterBackground() 경로로 흡수한다. 진짜 종료는 트레이 메뉴 "종료"뿐이다.
let tray = null;
let trayMenu = null;
let backgroundNoticeController = null;

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

function showBackgroundCloseNoticeOnce() {
  if (!backgroundNoticeController) {
    backgroundNoticeController = backgroundClose.createNoticeController({
      userDataDir: app.getPath('userData'),
      isSupported: () => {
        const allowed = process.env.ATHENA_CANVAS_SOURCE !== 'fixture'
          || process.env.ATHENA_ALLOW_FIXTURE_NOTIFICATIONS === '1';
        return allowed && (typeof Notification.isSupported !== 'function' || Notification.isSupported());
      },
      showNotification: () => {
        const notice = new Notification({
          title: 'ATHENA',
          body: 'ATHENA가 백그라운드에서 계속 실행됩니다. 완전 종료는 트레이 메뉴에서 할 수 있어요.',
        });
        notice.on('click', restoreFromBackground);
        notice.show();
      },
      log: (error, stage) => mdlog(`background-close ${stage} failed: ${String(error && error.message || error)}`),
    });
  }
  return backgroundNoticeController.showOnce();
}

const enterBackground = backgroundClose.createBackgroundEntry({
  ensureTray,
  hideShell: hideToBackground,
  ensureOrbVisible: () => orbWindow.syncOrbVisibility(shellWin, orbWin),
  showNotice: showBackgroundCloseNoticeOnce,
  log: (error, stage) => mdlog(`background-entry ${stage} failed: ${String(error && error.message || error)}`),
});

function ensureTray() {
  if (tray) return;
  tray = new Tray(buildTrayIcon());
  tray.setToolTip('Athena');
  tray.on('click', restoreFromBackground);
  trayMenu = Menu.buildFromTemplate([
    { id: 'open', label: '열기', click: restoreFromBackground },
    { type: 'separator' },
    { id: 'quit', label: '종료', click: () => app.quit() },
  ]);
  tray.setContextMenu(trayMenu);
}

function showTrayMenuForReview() {
  ensureTray();
  if (!tray || tray.isDestroyed() || !trayMenu) return false;
  // Tray.popUpContextMenu() dispatches the tray's left-click on some Windows
  // shells, which would restore the hidden app. Review the exact same native
  // Menu object at the notification-area edge instead; production tray click
  // and context-menu wiring remain completely untouched.
  const cursor = screen.getCursorScreenPoint();
  const workArea = screen.getDisplayNearestPoint(cursor).workArea;
  trayMenu.popup({
    x: workArea.x + workArea.width - 8,
    y: workArea.y + workArea.height - 8,
  });
  return true;
}

function openFromTrayForReview() {
  ensureTray();
  const openItem = trayMenu && trayMenu.getMenuItemById('open');
  if (!openItem || typeof openItem.click !== 'function') return false;
  openItem.click(openItem, shellWin, {});
  return true;
}

function quitFromTrayForReview() {
  ensureTray();
  const quitItem = trayMenu && trayMenu.getMenuItemById('quit');
  if (!quitItem || typeof quitItem.click !== 'function') return false;
  quitItem.click(quitItem, shellWin, {});
  return true;
}

app.on('will-quit', () => {
  if (tray) { tray.destroy(); tray = null; }
  trayMenu = null;
});

ipcMain.on('athena:close-windows', () => {
  enterBackground({ notice: true, source: 'close-button' });
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
  const decision = decidePaintAck(payload, {
    pendingPaint: waiter.pendingPaint || null,
    now: () => performance.now(),
  });
  if (decision.action === 'reject') {
    restPaintWaiters.delete(key);
    waiter.cleanup();
    waiter.reject(new Error(decision.message));
    return;
  }
  if (decision.action === 'defer') {
    // 차트 껍질만 붙은 첫 ack다. 첫 피드백은 이미 지켰으니 3초 한도를 풀고,
    // 마운트 결과 ack가 render_state를 확정할 때까지만 짧게 더 기다린다. 이
    // 값으로 재조회 권위·실시간 REG·데이터 카드 집계가 갈리므로 낙관값을
    // 미리 넘기지 않는다.
    waiter.pendingPaint = decision.paint;
    waiter.beginPendingMount(() => {
      restPaintWaiters.delete(key);
      waiter.cleanup();
      waiter.resolve(timedOutPaint(decision.paint));
    });
    // 카드는 이미 눈에 보인다. 첫 피드백 도달을 지금 알려 러너의 3초 마감과
    // 지연 영수증 워치독을 풀고, 미루는 것은 render_state 확정뿐이다.
    if (waiter.notifyFirstPaint) waiter.notifyFirstPaint(decision.paint);
    return;
  }
  restPaintWaiters.delete(key);
  waiter.cleanup();
  chartReloadAuthority.registerPaint(decision.paint, waiter.reloadAuthority);
  // 차트가 실제로 그려진 순간에만 실시간을 건다 — 그려지지도 않은 패널로 REG를
  // 소모하지 않는다(REG는 리미터를 먹는다). 참조 중복은 registrar와
  // chartRealtimePanelSymbols(panelId 단위)가 함께 막는다.
  ensureChartRealtime(waiter.reloadAuthority, decision.paint.panelId);
  waiter.resolve(decision.paint);
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
  // 이 패널이 실시간 참조를 쥐고 있었다면(ensureChartRealtime 주석 참고) 여기서
  // 정확히 1회 release한다 — acquire 때 실제로 쓴 종목코드를 그대로 되쓴다.
  const code = chartRealtimePanelSymbols.get(payload.panelId);
  if (code) {
    chartRealtimePanelSymbols.delete(payload.panelId);
    releaseRealtimeForSymbol(code);
  }
});

// 렌더러 카드/패널 소멸 신호(canvas.js wireQuoteRealtime의 destroy 훅) — panelId가
// 없는 카드종(표/시세 등, ensureChartRealtime 주석 참고)의 release는 여기로 온다.
// 렌더러가 넘기는 symbol은 main의 extractLiveQuoteSymbol/ensureChartRealtime과
// 같은 envelope 필드(operation_args.stk_cd 등)를 보고 뽑은 값이라 acquire 때
// 쓴 값과 어긋나지 않는다(canvas.js wireQuoteRealtime 주석 참고).
ipcMain.on('athena:realtime-release', (event, payload = {}) => {
  if (!shellWin || shellWin.isDestroyed() || event.sender !== shellWin.webContents) return;
  releaseRealtimeForSymbol(payload.symbol);
});

// 호가잔량(0D) acquire/release — 0B와 달리 카드가 직접 열고 닫는다(canvas.js
// wireOrderbookRealtime, ensureOrderbookRealtimeForSymbol 주석 참고).
ipcMain.on('athena:orderbook-realtime-acquire', (event, payload = {}) => {
  if (!shellWin || shellWin.isDestroyed() || event.sender !== shellWin.webContents) return;
  ensureOrderbookRealtimeForSymbol(payload.symbol);
});
ipcMain.on('athena:orderbook-realtime-release', (event, payload = {}) => {
  if (!shellWin || shellWin.isDestroyed() || event.sender !== shellWin.webContents) return;
  releaseOrderbookRealtimeForSymbol(payload.symbol);
});

// 6종 통합 카드용 수명주기 IPC. Renderer는 카드가 실제 마운트된 뒤 mount를,
// target/mode 변경 때 update를, DOM 제거 직전에 unmount를 invoke한다. 모든 upstream
// REG/REMOVE와 refcount 판단은 main의 CardLeaseManager가 소유한다. 이 경로는
// WebSocket 구독 제어만 허용하며 주문 mutation API에는 접근하지 않는다.
ipcMain.handle('athena:integrated-card-realtime-policy', (event) => {
  if (!shellWin || shellWin.isDestroyed() || event.sender !== shellWin.webContents) {
    return { ok: false, error: 'invalid renderer' };
  }
  return {
    ok: true,
    operationCount: integratedCardRealtime.OPERATION_POLICIES.length,
    operations: integratedCardRealtime.publicPolicies(),
  };
});

ipcMain.handle('athena:integrated-card-realtime-mount', async (event, payload = {}) => {
  if (!shellWin || shellWin.isDestroyed() || event.sender !== shellWin.webContents) {
    return { ok: false, status: 'error', error: 'invalid renderer' };
  }
  if (process.env.ATHENA_CANVAS_SOURCE === 'fixture') {
    return { ok: true, status: 'fixture-disabled', leaseId: String(payload.leaseId || '') };
  }
  ensureRealtimeFeed();
  return ensureIntegratedCardRealtimeManager().mount(payload);
});

ipcMain.handle('athena:integrated-card-realtime-update', async (event, payload = {}) => {
  if (!shellWin || shellWin.isDestroyed() || event.sender !== shellWin.webContents) {
    return { ok: false, status: 'error', error: 'invalid renderer' };
  }
  if (process.env.ATHENA_CANVAS_SOURCE === 'fixture') {
    return { ok: true, status: 'fixture-disabled', leaseId: String(payload.leaseId || '') };
  }
  ensureRealtimeFeed();
  return ensureIntegratedCardRealtimeManager().update(payload);
});

ipcMain.handle('athena:integrated-card-realtime-unmount', async (event, payload = {}) => {
  if (!shellWin || shellWin.isDestroyed() || event.sender !== shellWin.webContents) {
    return { ok: false, status: 'error', error: 'invalid renderer' };
  }
  if (!integratedCardRealtimeManager) {
    return { ok: true, status: 'unmounted', leaseId: String(payload.leaseId || '') };
  }
  return integratedCardRealtimeManager.unmount(payload.leaseId);
});

ipcMain.handle('athena:integrated-card-realtime-release-all', async (event) => {
  if (!shellWin || shellWin.isDestroyed() || event.sender !== shellWin.webContents) {
    return { ok: false, error: 'invalid renderer' };
  }
  if (!integratedCardRealtimeManager) return { ok: true, results: [], pending: 0 };
  return integratedCardRealtimeManager.releaseAll();
});

ipcMain.handle('athena:integrated-card-realtime-status', (event, payload = {}) => {
  if (!shellWin || shellWin.isDestroyed() || event.sender !== shellWin.webContents) {
    return { ok: false, error: 'invalid renderer' };
  }
  const state = integratedCardRealtimeManager
    ? integratedCardRealtimeManager.status(payload.leaseId)
    : null;
  return { ok: true, state };
});

ipcMain.handle('athena:integrated-card-realtime-command', async (event, payload = {}) => {
  if (!shellWin || shellWin.isDestroyed() || event.sender !== shellWin.webContents) {
    return { ok: false, error: 'invalid renderer' };
  }
  if (process.env.ATHENA_CANVAS_SOURCE === 'fixture') return { ok: true, data: null };
  ensureRealtimeFeed();
  ensureIntegratedCardRealtimeManager();
  return integratedCardRealtimeTransport.command(
    String(payload.operationId || ''),
    payload.arguments || {},
    payload.accountId || '',
  );
});

// 보드 슬롯 하이드레이션(읽기 전용). 봉투의 surface_contract.unbound_slots가 남았을
// 때만 렌더러가 부른다. 엔드포인트가 아직 없으면 status:'unavailable'이 오고
// 화면은 결측어를 그대로 둔다 — 없는 값을 지어내지 않는다.
ipcMain.handle('athena:canvas-board-hydrate', async (event, payload = {}) => {
  if (!shellWin || shellWin.isDestroyed() || event.sender !== shellWin.webContents) {
    return { ok: false, status: 'error', error: 'invalid renderer' };
  }
  if (process.env.ATHENA_CANVAS_SOURCE === 'fixture') {
    return { ok: false, status: 'unavailable' };
  }
  return boardHydrate.hydrateBoard({
    backendBase: BACKEND_HTTP_BASE,
    fetchImpl: fetch,
    token: LOCAL_BEARER_TOKEN,
    boardId: payload.boardId || payload.board_id,
    target: payload.target,
    account: payload.account,
  });
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
    let pendingTimer = null;
    const onAbort = () => {
      restPaintWaiters.delete(key);
      cleanup();
      reject(payload.signal && payload.signal.reason instanceof Error
        ? payload.signal.reason
        : new Error('REST 카드 표시가 중단됐다'));
    };
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (pendingTimer) clearTimeout(pendingTimer);
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
      notifyFirstPaint: typeof payload.onFirstPaint === 'function' ? payload.onFirstPaint : null,
      // 차트 껍질 ack가 도착하면 첫 피드백 한도를 풀고 마운트 결과 ack만 기다린다.
      beginPendingMount(onTimeout) {
        if (timer) { clearTimeout(timer); timer = null; }
        pendingTimer = setTimeout(onTimeout, PENDING_MOUNT_ACK_TIMEOUT_MS);
      },
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
      retryCardId: payload.retryCardId,
    });
  });
}

let liveMcpConfig = null; // 지연 생성 — app.getPath('userData')는 whenReady 이후에만 안전

function getLiveMcpConfig() {
  if (!liveMcpConfig) liveMcpConfig = ensureMcpConfig(app.getPath('userData'));
  return liveMcpConfig;
}

// 상주 채팅 세션 — 매 턴 콜드 스폰이 내던 턴당 고정비(CLI 기동 + MCP 게이트웨이
// 재스폰 + --resume 포크 + 규칙 프리앰블 재전송·이력 누적)를 세션당 1회로 바꾼다.
// 대화형 CLI(Claude Code 인터랙티브)가 빠른 조건과 같아진다.
// ATHENA_PERSISTENT_CHAT=0 이면 기존 콜드 스폰 경로로 되돌린다(킬 스위치).
let liveChatSession = null;

function persistentChatEnabled() {
  return process.env.ATHENA_PERSISTENT_CHAT !== '0';
}

function getLiveChatSession() {
  if (!liveChatSession) {
    const { dir, configFile } = getLiveMcpConfig();
    liveChatSession = createClaudeChatSession({
      cwd: dir,
      configFile,
      // 불변 규칙(live-prompt.js)은 --append-system-prompt로 세션당 1회 —
      // 턴 페이로드는 buildLiveTurnPrompt(질문만)로 가볍다.
      appendSystemPrompt: buildLiveSystemPrompt(),
    });
  }
  return liveChatSession;
}

function stopLiveClaudeChatSession(reason) {
  if (!liveChatSession) return;
  try { liveChatSession.stop(new Error(reason || 'provider switch')); } catch { /* already stopping */ }
  liveChatSession = null;
}

function resolveLiveQueryProviderId() {
  const selected = currentProviderSelection && currentProviderSelection.activeAccount;
  if (selected && selected.providerId) return selected.providerId;
  const peeked = cliAccounts.peekActiveAccount();
  return (peeked && peeked.providerId) || 'claude';
}

function noteLiveQueryProvider(providerId) {
  if (liveQueryProviderId && liveQueryProviderId !== providerId) liveSessionId = null;
  liveQueryProviderId = providerId;
  if (providerId === 'grok') stopLiveClaudeChatSession('grok_active');
}

// 캔버스 결과 하나(stream-json-parser.classifyCanvasBlock의 출력)를 캔버스
// 창으로 보낸다. 렌더러(canvas.js)가 status별로 카드를 그리거나 안내를 띄운다.
function sendLiveCanvasResult(result, metadata = null) {
  if (!shellWin || shellWin.isDestroyed()) return;
  const payload = metadata ? { ...result, ...metadata } : result;
  shellWin.webContents.send('athena:add-canvas-live', payload);
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
function sendLiveTextDelta(text, metadata = null) {
  const payload = metadata ? { text, ...metadata } : { text };
  if (shellWin && !shellWin.isDestroyed()) shellWin.webContents.send('athena:live-text-delta', payload);
  if (orbWin && !orbWin.isDestroyed()) orbWin.webContents.send('athena:live-text-delta', payload);
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

// 라벨이 없는 도구는 전부 '처리 중'으로 떨어진다(아래 toolStepLabel) — 그래서
// 그래프 모드에서 athena_brain이 실패했을 때 화면이 "처리 중 실패"라고만 말하고
// **무슨 도구가** 실패했는지는 못 말했다(2026-09-03 실사용 제보). 게이트웨이가
// 노출하는 도구는 provider-runtime-bootstrap.js의 목록 + 그래프·백테스트 도구다.
const TOOL_STEP_LABELS = {
  athena_search: '검색',
  athena_describe: '스키마 확인',
  athena_resolve: '판단 중',
  athena_call: '조회',
  athena_brain: '성향 그래프 조회',
  athena_graph_view: '그래프 화면 제어',
  athena_backtest: '백테스트',
  athena_routine: '작업·알람',
  athena_nudge_guard: '말걸기 가드',
};

function toolStepLabel(name) {
  if (streamJsonParser.isRenderCanvasToolName(name)) return '카드 그리는 중';
  // MCP 툴 이름은 mcp__<server>__<tool> 형태로 온다 — 마지막 조각만 라벨을 찾는 열쇠다.
  const base = String(name || '').split('__').pop();
  return TOOL_STEP_LABELS[base] || '처리 중';
}

const NUDGE_GUARD_TOOL_NAME = 'athena_nudge_guard';

// 말걸기 가드 확인 카드(F-stage9, Paper 보드 42/BIM-0) — athena_nudge_guard의
// propose 호출 결과(비영속, guard_settings.py 참고)를 채팅 렌더러로 흘려보낸다.
// 라우틴 승인 카드(athena_routine의 draft)와 달리 이건 아무것도 디스크에 안
// 남는다 — refreshRoutineDrafts()류 폴링으로는 발견할 수 없고, 이 tool_result
// 스트림이 유일한 신호다. orbWin에는 안 보낸다 — 가드 확정도 routine-confirm과
// 같은 원칙으로 채팅 전용 사람 액션이다(오브는 주문 집행·감시 승인을 못 부르는
// 것과 같은 이유).
function maybeForwardNudgeGuardProposal(step, resultBlock) {
  if (resultBlock.is_error === true) return;
  const base = String(step.name || '').split('__').pop();
  if (base !== NUDGE_GUARD_TOOL_NAME) return;
  if (!step.input || step.input.action !== 'propose') return;
  const text = extractToolResultText(resultBlock.content);
  if (!text) return;
  let payload;
  try { payload = JSON.parse(text); } catch { return; }
  if (!payload || typeof payload !== 'object' || !payload.current || !payload.proposed) return;
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:nudge-guard-proposed', {
      current: payload.current, proposed: payload.proposed, notice: payload.notice || null,
    });
  }
}

// 플러그인 승인 카드 — athena_plugin이 만든 제안 봉투를 셸 렌더러로 흘려보낸다.
// **여기서 대기 목록에 등록하지 않는다.** 등록은 렌더러가 모드 게이트를 통과해
// 카드를 그린 뒤 보내는 athena:plugin-noted 한 지점뿐이다 — 모드 밖에서 폐기한
// 제안이 창 복원으로 되살아나면 화면이 거짓을 말한다.
// orbWin에는 안 보낸다 — 말걸기 가드 카드와 같은 이유(채팅 전용 사람 액션)다.
function maybeForwardPluginProposal(step, resultBlock) {
  if (resultBlock.is_error === true) return;
  const text = extractToolResultText(resultBlock.content);
  if (!text) return;
  const envelope = pluginProposalForward.extractProposal(step, text);
  if (!envelope) return;
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:plugin-proposed', envelope);
  }
}

const ROUTINE_TOOL_NAME = 'athena_routine';

// 루틴 제어 제안 카드(Step 6) — athena_routine의 propose 호출 결과
// (routine_tools.py: control·routine_id·current·proposed·rationale·notice)를
// 채팅 렌더러로 흘려보낸다. 위 말걸기 가드와 같은 이유로 비영속이다 —
// propose는 목록 조회 말고 아무 백엔드 호출도 하지 않고 디스크에도 안 남으므로
// 폴링으로는 발견할 수 없고, 이 tool_result 스트림이 유일한 신호다.
// orbWin에는 안 보낸다 — 제안 확정은 routine-confirm과 같은 원칙으로 채팅
// 전용 사람 액션이다(오브는 주문 집행·감시 승인을 못 부르는 것과 같은 이유).
function maybeForwardRoutineProposal(step, resultBlock) {
  if (resultBlock.is_error === true) return;
  const base = String(step.name || '').split('__').pop();
  if (base !== ROUTINE_TOOL_NAME) return;
  if (!step.input || step.input.action !== 'propose') return;
  const text = extractToolResultText(resultBlock.content);
  if (!text) return;
  let payload;
  try { payload = JSON.parse(text); } catch { return; }
  if (!payload || typeof payload !== 'object' || typeof payload.control !== 'string') return;
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:routine-proposed', {
      control: payload.control,
      routineId: payload.routine_id || null,
      current: payload.current || null,
      proposed: payload.proposed || null,
      rationale: payload.rationale || null,
      view: (payload.view && typeof payload.view === 'object') ? payload.view : null,
      notice: payload.notice || null,
    });
  }
}

const GRAPH_VIEW_TOOL_NAME = 'athena_graph_view';

// 그래프 채팅 액션(2026-09-03) — athena_graph_view의 HTTP 무호출 액션 다섯
// (graph_view_tools.py의 navigate·select·filter·fit·propose_edit)을 셸 렌더러의
// 그래프 캔버스로 흘려보낸다. 위 백테스트 함수와 **같은 자리·같은 방식**이다:
// 도구가 delivered:"canvas" 봉투를 돌려주고, 여기서 그것만 골라 렌더러로 보낸다.
//
// 백테스트와 달리 전부 결과(tool_result)에서 읽는다 — 이 도구는 백엔드를 타지 않아
// 결과가 곧 입력의 정규화판이고, 봉투를 만드는 검증이 이미 백엔드에서 끝났다.
//
// propose_edit도 여기로 온다. **그것이 그래프를 고치지 않는다**: 렌더러가 확정 카드를
// 띄우고, 사람이 누르면 사람의 답변 문장이 평소의 채팅→추출 경로를 탄다
// (lib/graph-mode/graph-edit-proposal.js 참고). 모델에게는 카드를 누를 길이 없다.
// orbWin에는 안 보낸다 — 백테스트 액션과 같은 이유(채팅 전용 사람 액션)다.
function maybeForwardGraphChatAction(step, resultBlock) {
  if (resultBlock.is_error === true) return;
  const base = String(step.name || '').split('__').pop();
  if (base !== GRAPH_VIEW_TOOL_NAME) return;
  const text = extractToolResultText(resultBlock.content);
  if (!text) return;
  let payload;
  try { payload = JSON.parse(text); } catch { return; }
  if (!payload || typeof payload !== "object") return;
  if (payload.delivered !== 'canvas') return;
  let message = null;
  if (payload.kind === 'navigate' && typeof payload.surface === 'string') {
    message = { kind: 'navigate', surface: payload.surface };
  } else if (payload.kind === 'select' && typeof payload.entity_id === 'string') {
    message = { kind: 'select', entityId: payload.entity_id };
  } else if (payload.kind === 'filter' && payload.patch && typeof payload.patch === 'object') {
    message = { kind: 'filter', patch: payload.patch };
  } else if (payload.kind === 'fit') {
    message = { kind: 'fit' };
  } else if (payload.kind === 'edit_proposal') {
    message = {
      kind: 'edit_proposal',
      op: payload.op,
      subject: payload.subject == null ? null : payload.subject,
      object: payload.object,
      relation: payload.relation,
      // 있으면 카드가 '적용'에서 바로 지운다(2026-09-03). 없으면 카드가 예전
      // 경로(답변 문장 제출 → 수집 때 반영)를 그대로 쓴다.
      relationId: payload.relation_id == null ? null : payload.relation_id,
      // 추가·수정의 즉시 반영 재료 — 두 끝의 entity id. 이름으로 쓰지 않는 이유는
      // 백엔드 입구 주석과 같다: 오타가 새 노드가 된다.
      subjectId: payload.subject_id == null ? null : payload.subject_id,
      objectId: payload.object_id == null ? null : payload.object_id,
      reason: payload.reason == null ? null : payload.reason,
    };
  }
  if (!message) return;
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:graph-chat-action', message);
  }
}

const BACKTEST_TOOL_NAME = 'athena_backtest';

// 백테스트 채팅 액션 카드 — athena_backtest의 카드 액션 일곱(backtest_tools.py의
// propose_spec·propose_code·propose_file·navigate·propose_optimize와 시각 설계 왕복의
// visual_question·visual_patch)을 셸 렌더러의 백테스트
// 캔버스로 흘려보낸다. 캔버스는 채팅이 몰지만 폼·편집기에 실제로 들어가는 것은
// 사용자가 카드의 [적용]을 누른 뒤이고, 실행·검증·탐색 시작은 따로 눌러야 시작된다.
// orbWin에는 안 보낸다 — 말걸기 가드 카드와 같은 이유(채팅 전용 사람 액션)다.
// propose_code만 결과가 아니라 호출 입력(step.input.propose_code)에서 읽는다 —
// strategy_id가 있으면 결과는 버전 저장 응답이라 초안 본문(source)이 안 실린다.
// 시각 설계 2종(visual_question·visual_patch)만 백엔드를 부른다(/visual/question·
// /visual/patch) — 그래도 저장·활성화·실행은 없다. 막는 오류가 없으면 봉투의
// delivered가 null이라 빈 카드도 뜨지 않는다(backtest_tools.py _canvas_envelope).
// 봉투는 {kind, payload} 모양 그대로 넘긴다 — 카드가 읽는 모양으로 바꾸는 일은
// 캔버스의 onChatAction이 한다(chat.js 구독 → canvas.onChatAction → 카드 렌더).
function maybeForwardBacktestChatAction(step, resultBlock) {
  if (resultBlock.is_error === true) return;
  const base = String(step.name || '').split('__').pop();
  if (base !== BACKTEST_TOOL_NAME) return;
  if (!step.input) return;
  const action = step.input.action;
  let message = null;
  if (action === 'propose_code') {
    const input = step.input.propose_code;
    if (!input || typeof input !== 'object') return;
    const source = input.source;
    if (typeof source !== 'string' || !source.trim()) return;
    message = {
      kind: 'code_draft', source, note: input.note == null ? null : input.note,
      suggest_run: input.suggest_run === true, suggest_validate: input.suggest_validate === true,
    };
  } else if (action === 'propose_file') {
    // 새 파일은 백엔드에 없으므로 결과가 아니라 호출 입력에서 읽는다(propose_code와 같은 이유).
    // 캔버스는 이걸로 지금 파일과의 diff만 세운다 — 디스크에 쓰는 건 사람이 [적용]을 누른 뒤다.
    const input = step.input.propose_file;
    if (!input || typeof input !== 'object') return;
    const source = input.source;
    const filePath = input.path;
    if (typeof source !== 'string' || !source.trim()) return;
    if (typeof filePath !== 'string' || !filePath.trim()) return;
    message = {
      kind: 'file_draft', project_id: input.project_id, path: filePath, source,
      note: input.note == null ? null : input.note,
      suggest_run: input.suggest_run === true,
    };
  } else if (action === 'propose_spec' || action === 'navigate' || action === 'propose_optimize'
    || action === 'visual_question' || action === 'visual_patch'
    || action === 'technique_question') {
    const text = extractToolResultText(resultBlock.content);
    if (!text) return;
    let payload;
    try { payload = JSON.parse(text); } catch { return; }
    if (!payload || typeof payload !== 'object' || payload.delivered !== 'canvas') return;
    const note = payload.note == null ? null : payload.note;
    if (action === 'propose_spec') {
      const patch = payload.patch;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return;
      message = { kind: 'spec_draft', patch, note, suggest_run: payload.suggest_run === true };
    } else if (action === 'navigate' && payload.kind === 'navigate') {
      message = {
        kind: 'navigate', tab: payload.tab,
        designTab: payload.designTab == null ? null : payload.designTab,
      };
    } else if (action === 'propose_optimize' && payload.kind === 'optimize_request') {
      message = { kind: 'optimize_request', method: payload.method, note };
    } else if (action === 'visual_question' && payload.kind === 'visual_question') {
      message = { kind: 'visual_question', payload: payload.payload };
    } else if (action === 'visual_patch' && payload.kind === 'visual_patch') {
      message = { kind: 'visual_patch', payload: payload.payload };
    } else if (action === 'technique_question' && payload.kind === 'technique_question') {
      // 새 기법 만들기의 질문 카드 — visual_question과 같은 모양이다. 고른 선택지는
      // 캔버스가 채팅 입력으로 되돌려 보낸다(모델이 대신 고르지 않는다).
      message = { kind: 'technique_question', payload: payload.payload };
    }
  }
  if (!message) return;
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:backtest-chat-action', message);
  }
}

// tool_result.content는 문자열 또는 블록 배열로 온다 — athena_mcp/result.py의
// success()는 항상 [{type:'text', text: JSON 문자열}] 블록 배열을 준다(문자열
// 케이스는 방어용, stream-json-parser.js의 normalizeToolResultContent와 같은 이유).
function extractToolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const block = content.find((b) => b && b.type === 'text' && typeof b.text === 'string');
    return block ? block.text : null;
  }
  return null;
}

// tool_use_id별 시작 시각을 들고 있다가 매칭되는 tool_result가 오면 소요시간과
// 함께 완료를 알린다. runLiveQuery 호출마다 새로 만든다(왕복 하나의 수명).
//
// 서브에이전트 필터링(task #32, 실측 근거는 .omc/research/2026-08-27-
// 서브에이전트-스트림-계약.md §3) — 두 가지를 최상위 진행 라인에서 뺀다:
//   (a) 서브에이전트 내부 활동(streamJsonParser.isSubagentInternalEvent —
//       parent_tool_use_id가 그 Agent의 tool_use id인 이벤트) — 그 서브에이전트
//       자신의 Bash/mcp 호출이라 최상위 "판단 중" 라인에 섞이면 이중 표시다.
//   (b) Agent tool_use 자체(streamJsonParser.isAgentToolName) — 그 생애주기는
//       createSubagentTracker()가 하위 에이전트 도크로 따로 추적한다. 걸러도
//       완료 쪽(tool_result)은 steps에 애초에 없어 자동으로 조용히 무시된다.
// sendFn(선택)으로 송신 채널을 바꿀 수 있다 — 브리핑 턴(R1)이 라벨 변환·중복
// 방어는 그대로 쓰되 athena:briefing-tool-step으로만 내보내기 위한 주입 지점.
// forwardNudgeGuard(선택) — 말걸기 가드 확인 카드·백테스트 채팅 액션 카드는 채팅
// 전용 사람 액션이라 사용자 턴에서만 전달한다. 브리핑 턴(자동 실행)이 이 카드를
// 띄우면 사용자 승인 흐름이 자동 턴에서 새어나오는 셈이라 끈다.
function createToolStepTracker(sendFn = sendLiveToolStep, { forwardNudgeGuard = true } = {}) {
  const steps = new Map(); // tool_use_id -> { label, startedAt, name, input, elapsedMs? }
  return function trackToolStep(event) {
    if (!event || typeof event !== 'object') return;
    if (streamJsonParser.isSubagentInternalEvent(event)) return;
    if (event.type === 'assistant') {
      const content = event.message && event.message.content;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        if (block && block.type === 'tool_use' && block.id && !steps.has(block.id)) {
          if (streamJsonParser.isAgentToolName(block.name)) continue;
          const label = toolStepLabel(block.name);
          // name·input도 함께 들고 있는다 — F-stage9가 athena_nudge_guard의
          // propose 호출을 가려내는 데 쓴다(위 maybeForwardNudgeGuardProposal).
          steps.set(block.id, { label, startedAt: Date.now(), name: block.name, input: block.input });
          sendFn({ id: block.id, label, done: false, elapsedMs: null });
        }
      }
    } else if (event.type === 'user') {
      const content = event.message && event.message.content;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        if (block && block.type === 'tool_result' && block.tool_use_id) {
          const step = steps.get(block.tool_use_id);
          // 중복 tool_result 방어 — elapsedMs가 이미 있으면(=이미 done 처리)
          // 다시 안 보낸다. [F-stage9 정정] 이 조건이 뒤집혀 있어(=== undefined)
          // 사실상 모든 tool_result의 done 이벤트가 나간 적이 없었다 — 주석
          // "이미 완료 처리됨"이 원래 의도였고 조건식만 틀렸다. 나머지 로직은
          // 무수정.
          if (step && step.elapsedMs !== undefined) continue;
          if (step) {
            const elapsedMs = Date.now() - step.startedAt;
            step.elapsedMs = elapsedMs; // 재-tool_result(있을 리 없지만) 방어
            // MCP 콜드스타트는 도구 실패가 아니다(2026-09-03 실측). 세션이 막 뜨면
            // 첫 호출이 "No such tool available … still connecting"으로 즉시 깨지고,
            // 모델은 WaitForMcpServers로 기다렸다 같은 도구를 다시 부른다(live-prompt.js
            // 규칙). 그런데 화면에는 빨간 "실패"로 찍혀서 사용자가 기능이 없는 줄
            // 알았다 — 실제로 그렇게 읽었다는 제보로 이 결함을 찾았다. 숨기지는
            // 않는다(무슨 일이 있었는지는 말한다): 실패가 아니라 대기로 분류한다.
            const errorText = block.is_error ? extractToolResultText(block.content) : '';
            const stillConnecting = /still connecting|No such tool available/i.test(errorText || '');
            sendFn({
              id: block.tool_use_id,
              label: step.label,
              done: true,
              elapsedMs,
              error: !!block.is_error && !stillConnecting,
              retrying: stillConnecting,
            });
            if (forwardNudgeGuard) {
              maybeForwardNudgeGuardProposal(step, block);
              maybeForwardRoutineProposal(step, block);
              maybeForwardBacktestChatAction(step, block);
              maybeForwardGraphChatAction(step, block);
              maybeForwardPluginProposal(step, block);
            }
          }
        }
      }
    }
  };
}

// 하위 에이전트 도크(task #32, 보드04 2EZ-0/DG2-0) — Agent 생애주기 system
// 이벤트(task_started/progress/updated/notification)를 셸 렌더러로 릴레이한다.
// 분류 자체는 stream-json-parser.js의 순수 함수(classifySubagentEvent)가 맡고,
// 여기서는 last_tool_name만 카드 진행 표시와 같은 라벨표(toolStepLabel)를
// 통과시킨다 — "현재가 조회" 같은 사용자 언어로, 원문 툴 이름은 새지 않는다.
function sendLiveSubagentStep(step) {
  if (shellWin && !shellWin.isDestroyed()) shellWin.webContents.send('athena:live-subagent-step', step);
  // 오브에는 하위 에이전트 도크가 없다(board-33/34 "오브엔 팝오버·전환 UI가
  // 없다") — 셸에만 보낸다, orbWin.webContents.send 없음.
}

function createSubagentTracker() {
  return function trackSubagent(event) {
    const step = streamJsonParser.classifySubagentEvent(event);
    if (!step) return;
    if (step.subtype === 'task_progress' && step.lastToolName) {
      step.lastToolName = toolStepLabel(step.lastToolName);
    }
    sendLiveSubagentStep(step);
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
let activeLegacyQueryCompletion = null;
let activeRestRun = null;
let activeSelectorFastRun = null;

// 멀티턴(2026-08-17) — 직전 성공 왕복의 session_id. 다음 질의를 --resume으로
// 이어 이전 대화 내용(질문·답변·툴 결과)이 반영되게 한다. -p 재개는 세션을
// 포크해 새 session_id를 발급하므로 매 성공 왕복마다 갱신해야 체인이 이어진다.
// 앱 재시작 시 null — 대화는 앱 수명 단위다(디스크에 세션 키를 남기지 않는다).
let liveSessionId = null;
let liveQueryProviderId = null;

// history-sink conversation_id — **앱 세션 단위로 고정한다. liveSessionId를 쓰지 않는다.**
// 계획 §2(a)는 liveSessionId 재사용을 제안했지만 실배선 E2E가 그 전제를 뒤집었다
// (PROBE-BRAIN-CHAT-E2E.json, 2026-08-19): `claude -p --resume`은 매 성공 왕복마다
// 세션을 포크해 새 id를 발급하므로, 질의 진입 시점(role:user)과 응답 반환 시점
// (role:assistant) 사이에 liveSessionId가 바뀐다. 그 결과 **같은 한 턴의 두 메시지가
// 서로 다른 conversation_id로 갈렸다**(user 0a1fe408… / assistant 5ff6842e…) — 프로브가
// sameConversationLocator:false로 잡아낸 결함이다. 조회(GET /chats?conversation_id=)는
// 반쪽 턴만 돌려주고 그래프의 대화 묶음도 턴마다 쪼개진다.
// liveSessionId는 애초에 대화 식별자가 아니라 재개용 커서다. 한 대화의 user/
// assistant 턴은 아래 활성 id 하나를 함께 쓰고, Paper 54의 새 대화 IPC에서만
// 다음 id로 원자적으로 교체한다.
let historyActiveConversationId = crypto.randomUUID();

// 세션 저장(35~43번 보드) — 저장 타이밍은 session-bridge가, 저장소는 session-store가
// 소유한다. 스토어를 못 열면(디스크·권한) null로 두고 턴은 그대로 간다 — 사이드바
// 메타데이터처럼 세션 저장도 대화 성공의 필요조건은 아니되, 실패는 mdlog에 남긴다.
let sessionBridge = null;
function getSessionBridge() {
  if (sessionBridge !== null) return sessionBridge || null;
  try {
    const dbPath = process.env.ATHENA_SESSIONS_DB_PATH
      || path.join(app.getPath('userData'), 'athena-sessions.sqlite3');
    sessionBridge = createSessionBridge({
      store: createSessionStore({ dbPath }),
      log: (scope, error) => mdlog(`${scope} — ${String((error && error.message) || error)}`),
      onRunState: ({ sessionId, runState }) => sendSessionRunState(sessionId, runState),
    });
  } catch (error) {
    mdlog(`세션 스토어 열기 실패 — ${String((error && error.message) || error)}`);
    sessionBridge = false;
  }
  return sessionBridge || null;
}

// ---------- 실행 상태(39번 보드) ----------
// 세션의 대표 실행 상태가 바뀌면 사이드바로 흘린다 — 행의 스피너·점, 모드 옆 스피너.
function sendSessionRunState(id, runState) {
  if (shellWin && !shellWin.isDestroyed()) shellWin.webContents.send('athena:session-run-state', { id, runState });
}

// 백테스트 채널 응답에 실행 id가 있으면 지금 기록 대상 대화의 실행으로 붙인다. 렌더러가
// 어느 대화인지 말하지 않는다 — main의 기록 대상이 곧 그 실행의 주인이다.
function attachSessionJob(res, idKey, kind) {
  const id = res && res.ok && res.data && res.data[idKey];
  if (!id) return;
  const bridge = getSessionBridge();
  const sessionId = historyConversationId();
  if (!bridge || !sessionId) return;
  ensureSessionRecord(bridge, sessionId);
  bridge.attachJob({ sessionId, job: { id: String(id), kind, status: 'running' } });
}

// 폴링 응답의 status로 실행 레코드를 갱신한다(heartbeat 포함). 모르는 id는 그냥 지나간다.
function syncSessionJob(id, res) {
  if (!id || !res || !res.ok || !res.data || typeof res.data.status !== 'string') return;
  const bridge = getSessionBridge();
  if (!bridge) return;
  const patch = { status: res.data.status, heartbeatAt: new Date().toISOString() };
  if (res.data.error) patch.error = String(res.data.error);
  if (res.data.progress !== undefined) patch.progress = res.data.progress;
  bridge.updateJob({ jobId: String(id), patch });
}

// 부팅 때 지난 프로세스가 남긴 running 실행을 정리한다. 답변 턴은 그 프로세스와 함께
// 죽었으니 바로 interrupted, 백테스트는 백엔드가 따로 살아 있으니 물어보고 맞춘다
// (Orca의 warm reattach). 백엔드가 아직 안 떴으면 15초 간격으로 세 번 더 묻고 포기한다.
async function reconcileSessionJobs(attempt = 0) {
  const bridge = getSessionBridge();
  if (!bridge) return;
  let running;
  try { running = bridge.store.listJobsByStatus('running'); } catch { return; }
  let unreachable = false;
  for (const job of running) {
    if (job.kind === 'chat.turn') { bridge.updateJob({ jobId: job.id, patch: { status: 'interrupted' } }); continue; }
    const opts = { backendBase: BACKEND_HTTP_BASE, fetchImpl: fetch };
    const res = job.kind === 'backtest.backfill'
      ? await backtestBridge.fetchJobStatus({ ...opts, job_id: job.id }).catch(() => null)
      : await backtestBridge.fetchRunResult({ ...opts, run_id: job.id }).catch(() => null);
    if (res && res.ok) { syncSessionJob(job.id, res); continue; }
    if (res && res.status === 404) { bridge.updateJob({ jobId: job.id, patch: { status: 'interrupted' } }); continue; }
    unreachable = true;
  }
  if (!unreachable) return;
  if (attempt < 3) { setTimeout(() => { reconcileSessionJobs(attempt + 1).catch(() => {}); }, 15_000); return; }
  try { bridge.store.reconcileStaleJobs({ staleMs: 0 }); } catch { /* 다음 부팅에 다시 */ }
}

// 사용자 메시지를 세션에 즉시 적는다(명세 4절). 실패하면 턴을 시작하지 않는다 —
// 조용한 유실 금지. 브리지가 없으면(스토어 열기 실패) 그냥 지나간다.
function beginSessionTurn(conversationId, text, userMessageId) {
  const bridge = getSessionBridge();
  if (!bridge) return null;
  const listed = conversations.list();
  const record = listed.conversations.find((row) => row.id === conversationId) || null;
  try {
    bridge.ensureSession({
      id: conversationId,
      mode: record ? record.mode : listed.activeMode,
      projectId: record ? record.projectId : listed.currentProjectId,
      title: text,
    });
    bridge.recordUserMessage({ sessionId: conversationId, messageId: userMessageId || crypto.randomUUID(), text });
  } catch (error) {
    mdlog(`세션 저장 실패 — 턴을 시작하지 않는다: ${String((error && error.message) || error)}`);
    return '대화를 세션에 저장하지 못해 질문을 보내지 않았습니다.';
  }
  return null;
}

// 카드·워크스페이스·뷰포트 보고는 첫 턴 전에도 온다(카드가 먼저 도착하는 대화). 세션
// 행이 없으면 스토어가 조용히 버리므로, 보고를 적기 전에 이력 레코드로 세션을 만들어 둔다.
function ensureSessionRecord(sessionId) {
  const bridge = getSessionBridge();
  if (!bridge || !sessionId) return null;
  const listed = conversations.list();
  const record = listed.conversations.find((row) => row.id === sessionId) || null;
  try {
    bridge.ensureSession({
      id: sessionId,
      mode: record ? record.mode : listed.activeMode,
      projectId: record ? record.projectId : listed.currentProjectId,
      title: record ? record.title : '',
    });
  } catch (error) {
    mdlog(`세션 행 만들기 실패 — ${String((error && error.message) || error)}`);
    return null;
  }
  return bridge;
}

// 디스크 목록은 제목/프로젝트 메타데이터만 보존하고 Claude 세션/메시지 본문은
// 복원하지 않는다. 따라서 앱 시작 때 이전 activeId를 다시 기록 대상으로 쓰지
// 않고, 현재 프로젝트 안의 새 빈 대화 경계를 원자적으로 만든다.
try {
  const initialConversationState = conversations.list();
  conversations.begin({
    id: historyActiveConversationId,
    projectId: initialConversationState && initialConversationState.currentProjectId,
  });
} catch { /* 이력 메타데이터는 실질 대화 실행의 필요조건이 아니다 */ }

function historyConversationId() {
  return historyActiveConversationId;
}

// 에이전트 모드 코드 알람의 프로젝트(2026-09-03) — 감시 코드가 착지할 폴더 하나다.
// id는 백엔드 프로젝트 레지스트리의 id다(athena:project-add가 등록 결과 id로 사이드바
// 레코드를 만든다). 현재 대화의 프로젝트를 먼저 쓰고, 없으면 목록의 첫 프로젝트로
// 내려앉는다(conversations.js normalizeState가 이미 같은 폴백을 쓴다). 폴더 경로가 없는
// 기본 레코드는 레지스트리에 없는 것이라 프로젝트가 없는 것으로 본다 — 그때 접두가
// 「프로젝트 없음」을 실어 모델이 지어내지 않고 사용자에게 묻는다.
function activeAgentProject() {
  try {
    const listed = conversations.list();
    const rows = (listed && Array.isArray(listed.projects) ? listed.projects : [])
      .filter((row) => row && row.path);
    const current = rows.find((row) => row.id === (listed && listed.currentProjectId)) || rows[0] || null;
    return current ? { id: String(current.id), name: String(current.label || current.id) } : null;
  } catch { return null; }
}

function activeRestAccountId() {
  try {
    const listed = accounts.list();
    const active = listed && Array.isArray(listed.accounts)
      ? listed.accounts.find((account) => account.active)
      : null;
    return active ? String(active.id) : '';
  } catch {
    return '';
  }
}

// 이력 사이드바(리프 1.2.2) 최소 영속화 — 첫 사용자 메시지에서 제목을 뽑아
// athena-conversations.json에 적는다. historyConversationId()는 현재 선택된
// 대화 하나에 고정되며, 새 대화/기존 대화 선택 경계에서만 교체된다.
function touchConversationEntry(text, conversationId = historyConversationId()) {
  try { conversations.touch({ id: conversationId, title: text }); } catch { /* 사이드바 표시는 대화 성공의 필요조건이 아니다 */ }
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
const providerRuntimeMetrics = createProviderRuntimeMetrics();
let providerRuntimeController = null;
const providerControllerLifecycle = createRestartableControllerLifecycle({
  createController: createProviderRuntimeControllerInstance,
  getController: () => providerRuntimeController,
  setController: (controller) => { providerRuntimeController = controller; },
});
let providerRuntimeReady = false;
let providerEpochStore = null;
let providerMutationCoordinator = null;
let providerConfigGeneration = 0;
let providerSecurityGeneration = 1;
let providerRotationTail = Promise.resolve();
let currentProviderSelection = Object.freeze({
  activeAccount: null, desiredState: null, disabled: null,
});
const persistentTurnContexts = createProviderTurnContextRegistry();
let currentPersistentRuntimeGeneration = 0;

function verifierSourceHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const providerVerifierTelemetry = createProviderVerifierTelemetry({
  mainSourceHash: verifierSourceHash(__filename),
  firstPaintSourceHash: verifierSourceHash(path.join(__dirname, 'provider-first-paint.js')),
});
app.athenaProviderVerifierTelemetry = Object.freeze({
  beginScenario: providerVerifierTelemetry.beginScenario,
  snapshot: providerVerifierTelemetry.snapshot,
});

const providerPaintAckRegistry = createProviderPaintAckRegistry({
  onAccepted: (sample) => providerRuntimeMetrics.acknowledgePaint(sample),
  onRejected: () => providerRuntimeMetrics.increment('paint_ack_rejected_total'),
});

function markProviderFirstVisible(metadata) {
  if (metadata && metadata.turnId && Number.isSafeInteger(metadata.sequence)) {
    providerPaintAckRegistry.markFirstVisible(metadata.turnId, metadata.sequence);
  }
}

function handlePersistentCanvasResult(result) {
  const context = persistentTurnContexts.get(result.clientSubmitId);
  if (!context) return;
  const metadata = {
    clientSubmitId: result.clientSubmitId,
    turnId: result.turnId,
    sequence: result.sequence,
    origin: result.origin,
  };
  if (shouldMarkProviderCanvasVisible(result)) markProviderFirstVisible(metadata);
  const label = result.envelope && (result.envelope.card_title || result.envelope.caption);
  const liveSymbol = extractLiveQuoteSymbol(result.envelope);
  if (result.status === 'pushed') {
    if (result.envelope && result.envelope.canvas_type) context.canvasTypesSeen.push(result.envelope.canvas_type);
    if (label) context.canvasCaptionsSeen.push(label);
    if (liveSymbol) ensureRealtimeForSymbol(liveSymbol);
    // pushed 카드는 shell 전용 사이드채널로 이미 그려졌지만 오브 창에는 오지
    // 않는다. 오브에서 시작한 질의일 때만 같은 봉투를 한 번 전달한다.
    if (context.origin === 'orb' && orbWin && !orbWin.isDestroyed()) {
      orbWin.webContents.send('athena:orb-canvas-result', { ...result, ...metadata });
    }
    return;
  }
  if (context.expand && !context.expandTriggered) {
    context.expandTriggered = true;
    revealShell({ focus: false });
  }
  sendLiveCanvasResult(result, metadata);
  if (context.origin === 'orb' && orbWin && !orbWin.isDestroyed()) {
    orbWin.webContents.send('athena:orb-canvas-result', { ...result, ...metadata });
  }
  if (result.envelope && result.envelope.canvas_type) context.canvasTypesSeen.push(result.envelope.canvas_type);
  if (label) context.canvasCaptionsSeen.push(label);
  if (liveSymbol) ensureRealtimeForSymbol(liveSymbol);
}

function createProviderRuntimeControllerInstance(stateDir) {
  return createProviderRuntimeController({
    persistentEnabled: providerRuntimeEnabled,
    contractDecision: providerContractDecision.decision,
    stateDir,
    epochStore: providerEpochStore,
    metrics: providerRuntimeMetrics,
    commitSuccess: (result) => historySink.saveChatMessageAwaited(
      { conversationId: result.conversationId, text: result.finalText, role: 'assistant' },
      { onSaveFailed: emitHistorySaveFailed, mdlog },
    ),
    capabilityEnv: () => mcpEnv.buildEnvOverrides(),
    callbacks: {
      onTurnBound(event, binding) {
        const context = persistentTurnContexts.get(event.clientSubmitId);
        if (!context) return;
        currentPersistentRuntimeGeneration = event.runtimeGeneration;
        providerPaintAckRegistry.registerTurn({
          clientSubmitId: event.clientSubmitId,
          turnId: event.turnId,
          runtimeGeneration: event.runtimeGeneration,
          origin: context.origin,
          expectedWebContentsId: binding.expectedRendererId,
        });
      },
      onInternalEvent(event) {
        providerVerifierTelemetry.recordTerminal(event);
        const context = persistentTurnContexts.get(event.clientSubmitId);
        if (context) context.replayTurnCapture.observeProviderEvent(event);
      },
      onTextDelta(text, metadata) {
        if (!persistentTurnContexts.has(metadata.clientSubmitId)) return;
        markProviderFirstVisible(metadata);
        sendLiveTextDelta(text, metadata);
      },
      onCanvasResult: handlePersistentCanvasResult,
      onToolStep(step) {
        if (!persistentTurnContexts.has(step.clientSubmitId)) return;
        markProviderFirstVisible(step);
        sendLiveToolStep(step);
      },
      onSubagentStep(step) {
        if (!persistentTurnContexts.has(step.clientSubmitId)) return;
        markProviderFirstVisible(step);
        sendLiveSubagentStep(step);
      },
    },
  });
}

function ensureProviderRuntimeController() {
  assertProviderLifecycleOpen();
  const stateDir = path.join(app.getPath('userData'), 'provider-runtime');
  if (!providerEpochStore) providerEpochStore = createMcpSecurityEpochStore({ stateDir });
  providerRuntimeController = providerControllerLifecycle.ensure(stateDir);
  if (!providerMutationCoordinator) providerMutationCoordinator = createMcpRuntimeCoordinator({
    mode: 'persistent',
    epochStore: providerEpochStore,
    migratePlaintextEnv: () => mcpEnv.migratePlaintextEnv(),
    readSnapshot: async ({ securityGeneration, capabilityContext }) => {
      providerSecurityGeneration = securityGeneration;
      return resolveProviderDesiredState({
        gatewayEpochRevision: capabilityContext.stamp.epochRevision,
      });
    },
    enabledProviders: () => currentProviderSelection.disabled ? [] : ['claude'],
    initialSecurityGeneration: providerSecurityGeneration,
    runtime: {
      async blockNewTurns(reason) { providerRuntimeController.blockNewTurns(reason); },
      async interruptAndDrain() { await providerRuntimeController.interrupt('mcp_security_mutation'); },
      async fenceAndStop() {
        const fencedRuntime = providerRuntimeController;
        await providerControllerLifecycle.stopAndDiscard('mcp_security_mutation', fencedRuntime);
        providerRuntimeReady = false;
        return { ok: true };
      },
      async startGeneration({ snapshot, capabilityContext }) {
        if (snapshot.disabled) return { ok: true, disabled: true };
        const runtime = ensureProviderRuntimeController();
        await runtime.start(snapshot.desiredState, capabilityContext);
        await runtime.ready();
        return { ok: true };
      },
      async publishGeneration({ started }) { providerRuntimeReady = !started.disabled; },
      async unblockTurns() { providerRuntimeController?.unblockTurns(); },
    },
  });
  return providerRuntimeController;
}

async function runMcpMutation(kind, apply) {
  let applyResult = null;
  if (!providerRuntimeEnabled) {
    if (!providerMutationCoordinator) {
      providerMutationCoordinator = createMcpRuntimeCoordinator({
        mode: 'cold',
        coldRuntime: { interruptAndTerminate: terminateColdLegacyRuntime },
        migratePlaintextEnv: () => mcpEnv.migratePlaintextEnv(),
        readSnapshot: async () => {
          const { configPath } = getLiveMcpConfig();
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          return readMainMcpRuntimeSnapshot(config, 0);
        },
      });
    }
    const coordinated = await providerMutationCoordinator.mutate({
      kind,
      apply: async () => {
        applyResult = await apply();
        if (!applyResult || applyResult.ok !== true) {
          throw new Error((applyResult && applyResult.error) || 'MCP 설정 변경 실패');
        }
      },
    });
    return applyResult ? { ...applyResult, ...coordinated } : coordinated;
  }
  ensureProviderRuntimeController();
  const coordinated = await providerMutationCoordinator.mutate({
    kind,
    apply: async () => {
      applyResult = await apply();
      if (!applyResult || applyResult.ok !== true) {
        throw new Error((applyResult && applyResult.error) || 'MCP 설정 변경 실패');
      }
    },
  });
  return applyResult ? { ...applyResult, ...coordinated } : coordinated;
}

function activeAccountFromCliList(list) {
  for (const provider of (list && list.providers) || []) {
    const active = Array.isArray(provider.accounts)
      ? provider.accounts.find((account) => account && account.active === true)
      : null;
    if (active) return { accountId: active.id, providerId: provider.id };
  }
  return null;
}

function readJsonStateStrict(filePath, label) {
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); }
  catch (error) { throw new Error(`${label} state unavailable`, { cause: error }); }
  try { return JSON.parse(raw); }
  catch (error) { throw new Error(`${label} state is invalid JSON`, { cause: error }); }
}

function fileRevision(filePath) {
  try { return Math.max(0, Math.trunc(fs.statSync(filePath).mtimeMs)); }
  catch { return 0; }
}

function readMainMcpRuntimeSnapshot(config, gatewayEpochRevision) {
  const registryPath = mcpEnv.registryPath();
  const registry = readJsonStateStrict(registryPath, 'MCP registry');
  const consent = readJsonStateStrict(path.join(path.dirname(registryPath), 'consent.json'), 'MCP consent');
  validateMainMcpSecurityState({ registry, consent, canonicalHash });
  return buildMainMcpRuntimeSnapshot({
    createSnapshot: createMcpRuntimeSnapshot,
    registry,
    consent,
    claudeServers: config.mcpServers || {},
    securityGeneration: providerSecurityGeneration,
    secretRevision: fileRevision(path.join(app.getPath('userData'), 'athena-secrets.json')),
    gatewayEpochRevision,
    codexConfigRevision: fileRevision(codexConfig.configPath()),
    disallowedTools: DISALLOWED_EXECUTION_TOOLS.split(',').map((tool) => tool.trim()).filter(Boolean),
  });
}

async function resolveProviderDesiredState(options = {}) {
  const activeAccount = Object.prototype.hasOwnProperty.call(options, 'activeAccount')
    ? options.activeAccount
    : await cliAccounts.getActiveAccount();
  const resolvedAccount = activeAccount || null;
  if (!resolvedAccount) {
    const disabled = Object.freeze({
      ok: false,
      type: 'action-needed',
      provider: null,
      code: 'NO_ACTIVE_PROVIDER_ACCOUNT',
    });
    currentProviderSelection = Object.freeze({ activeAccount: null, desiredState: null, disabled });
    return currentProviderSelection;
  }
  const disabled = resolveCodexDisabledSelection({
    activeAccount: resolvedAccount,
    contractDecision: providerContractDecision.decision,
    persistentEnabled: providerRuntimeEnabled,
  });
  if (disabled) {
    currentProviderSelection = Object.freeze({ activeAccount: resolvedAccount, desiredState: null, disabled });
    return currentProviderSelection;
  }
  const { dir, configPath } = getLiveMcpConfig();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (resolvedAccount.providerId === 'grok') {
    currentProviderSelection = Object.freeze({
      activeAccount: resolvedAccount, desiredState: null, disabled: null,
    });
    return currentProviderSelection;
  }
  const { model, effort } = resolvedAccount.providerId === 'codex'
    ? codexConfig.readModelSettings()
    : modelPrefs.get().claude;
  const systemPrompt = buildLiveSystemPrompt();
  const gatewayEpochRevision = Number(options.gatewayEpochRevision);
  if (providerRuntimeEnabled && (!Number.isSafeInteger(gatewayEpochRevision) || gatewayEpochRevision < 1)) {
    throw new Error('issued gateway capability epoch is required for persistent provider startup');
  }
  const mcpSnapshot = readMainMcpRuntimeSnapshot(
    config,
    providerRuntimeEnabled ? gatewayEpochRevision : 0,
  );
  const desiredState = Object.freeze({
    provider: resolvedAccount.providerId,
    accountId: resolvedAccount.accountId,
    conversationId: historyConversationId(),
    cwd: dir,
    model,
    effort,
    systemPrompt,
    systemPromptHash: crypto.createHash('sha256').update(systemPrompt, 'utf8').digest('hex'),
    configGeneration: ++providerConfigGeneration,
    securityGeneration: providerSecurityGeneration,
    mcpSnapshot,
    toolPolicy: buildProviderToolPolicy(mcpSnapshot, GATEWAY_ALLOWED_TOOLS, DISALLOWED_EXECUTION_TOOLS),
  });
  currentProviderSelection = Object.freeze({ activeAccount: resolvedAccount, desiredState, disabled: null });
  return currentProviderSelection;
}

function providerShutdownError() {
  const error = new Error('provider lifecycle is closed because the app is shutting down');
  error.code = 'APP_SHUTTING_DOWN';
  return error;
}

function assertProviderLifecycleOpen() {
  if (isQuitting) throw providerShutdownError();
}

async function awaitProviderLifecycle(promise) {
  const result = await promise;
  assertProviderLifecycleOpen();
  return result;
}

async function rotatePersistentProviderInner(reason, options = {}) {
  // 기능이 꺼져 있으면 프로바이더 상태를 아예 건드리지 않는다. broadcastCliChanged가
  // 셸 포커스·CLI 로그인·setActive마다 이 경로를 무조건 부르는데, 여기서 계정·MCP
  // 스냅샷을 계속 재계산하면 기본 경로에 없던 일이 조용히 생긴다.
  if (!providerRuntimeEnabled) {
    const activeAccount = Object.prototype.hasOwnProperty.call(options, 'activeAccount')
      ? options.activeAccount
      : cliAccounts.peekActiveAccount();
    currentProviderSelection = Object.freeze({
      activeAccount: activeAccount || null, desiredState: null, disabled: null,
    });
    return currentProviderSelection;
  }
  assertProviderLifecycleOpen();
  const activeAccount = Object.prototype.hasOwnProperty.call(options, 'activeAccount')
    ? options.activeAccount
    : await awaitProviderLifecycle(cliAccounts.getActiveAccount());
  if (!activeAccount) {
    const disabledSelection = await awaitProviderLifecycle(
      resolveProviderDesiredState({ ...options, activeAccount: null }),
    );
    if (providerRuntimeController) {
      providerRuntimeController.blockNewTurns('no_active_provider_account');
      providerEpochStore.invalidate(providerSecurityGeneration);
      const stoppedRuntime = providerRuntimeController;
      await awaitProviderLifecycle(providerControllerLifecycle.stopAndDiscard(reason, stoppedRuntime));
      providerRuntimeReady = false;
    }
    return disabledSelection;
  }
  if (activeAccount.providerId === 'grok') {
    const grokSelection = await awaitProviderLifecycle(
      resolveProviderDesiredState({ ...options, activeAccount }),
    );
    if (providerRuntimeController) {
      providerRuntimeController.blockNewTurns('grok_cold_path');
      providerEpochStore.invalidate(providerSecurityGeneration);
      const stoppedRuntime = providerRuntimeController;
      await awaitProviderLifecycle(providerControllerLifecycle.stopAndDiscard(reason, stoppedRuntime));
      providerRuntimeReady = false;
    }
    return grokSelection;
  }
  if (activeAccount.providerId === 'codex') {
    const disabledSelection = await awaitProviderLifecycle(
      resolveProviderDesiredState({ ...options, activeAccount }),
    );
    if (disabledSelection.disabled) {
      if (providerRuntimeController) {
        providerRuntimeController.blockNewTurns('provider_disabled_by_contract');
        providerEpochStore.invalidate(providerSecurityGeneration);
        const stoppedRuntime = providerRuntimeController;
        await awaitProviderLifecycle(providerControllerLifecycle.stopAndDiscard(reason, stoppedRuntime));
        providerRuntimeReady = false;
      }
      return disabledSelection;
    }
  }
  const runtime = ensureProviderRuntimeController();
  const previousRuntimeSnapshot = runtime.snapshot();
  const capabilityContext = providerEpochStore.publishGeneration(providerSecurityGeneration);
  let selection;
  try {
    selection = await awaitProviderLifecycle(resolveProviderDesiredState({
      ...options,
      activeAccount,
      gatewayEpochRevision: capabilityContext.stamp.epochRevision,
    }));
  } catch (error) {
    capabilityContext.dispose();
    providerEpochStore.invalidate(providerSecurityGeneration);
    throw error;
  }
  if (selection.disabled) {
    capabilityContext.dispose();
    providerEpochStore.invalidate(providerSecurityGeneration);
    await awaitProviderLifecycle(providerControllerLifecycle.stopAndDiscard(reason, runtime));
    providerRuntimeReady = false;
    return selection;
  }
  try {
    if (!providerRuntimeReady) {
      await awaitProviderLifecycle(runtime.start(selection.desiredState, capabilityContext));
      await awaitProviderLifecycle(runtime.ready());
      providerRuntimeReady = true;
    } else {
      await awaitProviderLifecycle(runtime.rotate(selection.desiredState, reason, capabilityContext));
      providerVerifierTelemetry.recordRotationCompletion({
        correlationId: options.verifierCorrelationId,
        previousSnapshot: previousRuntimeSnapshot,
        nextSnapshot: runtime.snapshot(),
      });
    }
    assertProviderLifecycleOpen();
    runtime.unblockTurns();
  } catch (error) {
    capabilityContext.dispose();
    providerEpochStore.invalidate(providerSecurityGeneration);
    await providerControllerLifecycle.stopAndDiscard('provider_generation_start_failed', runtime).catch(() => {});
    providerRuntimeReady = false;
    throw error;
  }
  return selection;
}

function enqueueProviderRotation(operation) {
  const rotation = providerRotationTail.then(operation, operation);
  providerRotationTail = rotation.catch(() => {});
  return rotation;
}

function rotatePersistentProvider(reason, options = {}) {
  return enqueueProviderRotation(() => rotatePersistentProviderInner(reason, options));
}

const providerConversationRotationQueue = createConversationRotationQueue({
  isShuttingDown: () => isQuitting,
  shutdownError: providerShutdownError,
  enqueue: enqueueProviderRotation,
  blockAdmission: () => {
    if (providerRuntimeEnabled) {
      ensureProviderRuntimeController().blockNewTurns('conversation_rotation');
    }
  },
  interrupt: () => abortConversationWork(new Error('새 대화가 진행 중인 이전 작업을 대체했다')),
  createConversationId: () => crypto.randomUUID(),
  publishConversationId: (conversationId) => {
    liveSessionId = null;
    historyActiveConversationId = conversationId;
  },
  beginConversation: ({ id, projectId, mode }) => conversations.begin({ id, projectId, mode }),
  // 이력 행을 눌러 기존 대화로 돌아갈 때(41번 보드). publishConversationId가 커서를
  // 비운 뒤에 불리므로, 그 대화에 적어 둔 Claude 커서를 여기서 다시 잇는다 —
  // 다음 턴이 --resume으로 문맥까지 이어 붙는다. 커서가 없으면 백지에서 시작한다.
  selectConversation: ({ id }) => {
    const state = conversations.setActive(id);
    const record = state.conversations.find((row) => row.id === id) || null;
    liveSessionId = record && record.resumeSessionId ? record.resumeSessionId : null;
    return state;
  },
  rotateProvider: (reason, metadata) => providerRuntimeEnabled
    ? rotatePersistentProviderInner(reason, {
      verifierCorrelationId: metadata.verifierCorrelationId,
    })
    : Promise.resolve(),
});
const stockEntityIndex = new restDatasetRunner.StockEntityIndex();
let lastStockIndexErrorLogAt = 0;
const stockEntityIndexReadiness = createStockEntityIndexReadiness({
  index: stockEntityIndex,
  refresh: async (index, { signal }) => {
    const count = await restDatasetRunner.refreshStockEntityIndex(index, {
      backendBase: BACKEND_HTTP_BASE,
      signal,
    });
    mdlog(`Kiwoom 종목명 인덱스 갱신 — 종목 ${count}개`);
    return count;
  },
  onError: (error) => {
    const now = Date.now();
    if (now - lastStockIndexErrorLogAt < 30_000) return;
    lastStockIndexErrorLogAt = now;
    mdlog(`Kiwoom 종목명 인덱스 갱신 보류(재시도 예정): ${String((error && error.message) || error)}`);
  },
});
const chartFollowupTracker = createChartFollowupTracker();
const DIRECT_FEEDBACK_WATCHDOG_MS = 2200;

async function runDirectRestDataset(dataset, expand = true, overrides = {}) {
  const startedAt = performance.now();
  const turnConversationId = overrides.conversationId || historyConversationId();
  const retryAccountId = overrides.accountId == null ? activeRestAccountId() : String(overrides.accountId);
  const retryCardId = overrides.allowRetry ? crypto.randomUUID() : null;
  let retryView = null;
  if (overrides.allowRetry) {
    retryView = restRetryRegistry.beginView({ dataset, accountId: retryAccountId });
  }
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
    // 차트는 껍질이 뜬 시점('paint-pending')이 사용자가 실제로 본 첫 피드백이다 —
    // 마운트 확정 ack를 기다리다 워치독이 먼저 터지면 화면에 카드가 있는데도
    // 지연 영수증을 그리게 된다.
    if (event && (event.type === 'paint-ack' || event.type === 'paint-pending')) feedbackObserved = true;
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
        return emitRestCanvasForOrigin({ ...payload, retryCardId }, {
          expand,
          origin: overrides.origin,
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
  let retryId = null;
  if (retryView && result.retryAction && shellWin && !shellWin.isDestroyed()) {
    retryId = restRetryRegistry.issue({
      retryAction: result.retryAction,
      senderId: shellWin.webContents.id,
      conversationId: turnConversationId,
      accountId: retryAccountId,
      ...retryView,
    });
    if (retryId) {
      shellWin.webContents.send('athena:rest-retry-available', {
        retryId,
        state: result.state,
        cardId: retryCardId,
      });
    }
  }
  // retryAction에는 operation/args/account 계보가 들어 있으므로 main 밖으로 절대
  // 반환하지 않는다. 렌더러가 받는 권한은 위에서 발급한 opaque one-shot ID뿐이다.
  delete result.retryAction;
  result.retryable = Boolean(retryId);
  result.canvasResultCount = Number(result.renderedCount) || 0;
  chartFollowupTracker.observe(result, dataset);
  if (!overrides.skipHistory && !overrides.userAlreadyPersisted && dataset && dataset.question) {
    historySink.saveChatMessage(
      { conversationId: turnConversationId, text: dataset.question, role: 'user' },
      { onSaveFailed: emitHistorySaveFailed, mdlog },
    );
    touchConversationEntry(dataset.question, turnConversationId);
  }
  if (!overrides.skipHistory) {
    historySink.saveChatMessage(
      { conversationId: turnConversationId, text: result.answerText, role: 'assistant' },
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
  const result = await runDirectRestDataset(request, false, { skipHistory: true, allowRetry: true });
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

function persistLocalLiveResult(query, result, conversationId = historyConversationId()) {
  historySink.saveChatMessage(
    { conversationId, text: result.answerText, role: 'assistant' },
    { onSaveFailed: emitHistorySaveFailed, mdlog },
  );
  return result;
}

const liveSubmitContexts = new Map();

async function runLiveQuery(query, expand, origin = 'shell', turnConversationId = historyConversationId(), submit = {}) {
  if (isQuitting) {
    return {
      ok: false, type: 'action-needed', code: 'APP_SHUTTING_DOWN', source: 'live',
      error: '앱이 종료 중이라 새 질의를 시작할 수 없습니다.', answerText: null,
      canvasTypes: [], canvasCaptions: [],
    };
  }
  // 어떤 빠른 경로가 선택되든 네트워크·Selector·모델보다 먼저 사용자 원문을
  // durable outbox에 넣는다. 이후 분기들은 assistant만 한 번 저장한다.
  const historyReceipt = historySink.saveChatMessage(
    { conversationId: turnConversationId, text: query, role: 'user' },
    { onSaveFailed: emitHistorySaveFailed, mdlog },
  );
  if (historyReceipt && historyReceipt.failed) {
    return {
      ok: false,
      source: 'local',
      error: '대화 이력을 안전하게 저장하지 못해 질문을 보내지 않았습니다.',
    };
  }
  touchConversationEntry(query, turnConversationId);
  const sessionTurnError = beginSessionTurn(turnConversationId, query, historyReceipt && historyReceipt.messageId);
  if (sessionTurnError) return { ok: false, source: 'local', error: sessionTurnError };
  liveQueryBusyDepth += 1;
  if (liveQueryBusyDepth === 1) broadcastLiveQueryBusy(true);
  liveSubmitContexts.set(turnConversationId, submit);
  try {
    return await runLiveQueryInner(query, expand, origin, turnConversationId);
  } finally {
    liveSubmitContexts.delete(turnConversationId);
    liveQueryBusyDepth -= 1;
    if (liveQueryBusyDepth === 0) broadcastLiveQueryBusy(false);
  }
}

// origin — 'shell'(기본, 커맨드바) | 'orb'(오브 대화 모드). onCanvasResult가
// 오브 기원 엔벌로프만 orbWin에도 추가 relay하는 데 쓴다(board-33③④ 선행).
async function runLiveQueryInner(query, expand, origin, turnConversationId) {
  // 답변은 시작 전에 자리표시자(done:false)로 먼저 적는다 — 첫 토큰 전에 죽어도 질문은 남는다.
  const sessionAssistantId = crypto.randomUUID();
  { const bridge = getSessionBridge(); if (bridge) bridge.beginAssistant({ sessionId: turnConversationId, messageId: sessionAssistantId }); }
  const queryStartedAt = performance.now();
  const submit = liveSubmitContexts.get(turnConversationId) || {};
  // Selector 단일 dispatch도 새 질의가 선점한다. fetch 구현이 abort를 늦게
  // 관찰하더라도 run identity를 함께 검사해 이전 카드/주문 초안은 표시하지 않는다.
  if (activeSelectorFastRun) {
    activeSelectorFastRun.abort(new Error('새 질의가 이전 Selector fast path를 대체했다'));
    activeSelectorFastRun = null;
  }
  // 모드 전용 채팅(백테스트·그래프)은 모델 앞의 빠른 경로 4종(차트 후속·단순 차트·
  // REST 직결·Selector)을 전부 건너뛴다 — 넷 다 모델을 안 부르고 카드를 밀어, 모드 규율과
  // 턴 프리픽스(live-prompt.js)가 무력화된다. 그래프 모드는 이유가 하나 더 있다: 그 모드의
  // 모든 질문은 그래프 질문이라(사용자 확정) 시세 경로가 가로채면 접두가 실릴 기회조차 없다.
  const backtestMode = submit.canvasMode === 'backtest' || submit.canvasMode === 'graph';
  const chartFollowup = backtestMode ? null : chartFollowupTracker.answer(query);
  if (chartFollowup) {
    historySink.saveChatMessage(
      { conversationId: turnConversationId, text: chartFollowup.answerText, role: 'assistant' },
      { onSaveFailed: emitHistorySaveFailed, mdlog },
    );
    mdlog(`최근 차트 후속 질문 로컬 응답 — ${chartFollowup.direction} (모델/HTTP 무호출)`);
    return {
      ok: true,
      source: 'chart-followup',
      error: null,
      answerText: chartFollowup.answerText,
      canvasTypes: [],
      modelCalls: 0,
      durationMs: Math.max(0, performance.now() - queryStartedAt),
    };
  }
  chartFollowupTracker.invalidateForQuery(query);

  const simpleChartRoute = backtestMode ? { handled: false } : await simpleChartFastPath.runSimpleChartFastPath({
    query,
    index: stockEntityIndex,
    ensureReady: (timeoutMs) => stockEntityIndexReadiness.ensureReady(timeoutMs),
    buildDataset: (question, index) => restDatasetRunner.buildChartDataset(question, index, {
      idFactory: () => `rest-${crypto.randomUUID()}`,
    }),
    runDataset: (dataset) => runDirectRestDataset(dataset, expand, {
      allowRetry: true,
      conversationId: turnConversationId,
      userAlreadyPersisted: true,
      origin,
    }),
  });
  if (simpleChartRoute.handled) {
    if (!simpleChartRoute.dataset) {
      historySink.saveChatMessage(
        { conversationId: turnConversationId, text: simpleChartRoute.result.answerText, role: 'assistant' },
        { onSaveFailed: emitHistorySaveFailed, mdlog },
      );
      mdlog(simpleChartRoute.result.source === 'stock-index-not-ready'
        ? '단순 일봉 차트 대기 한도 초과 — Selector/Claude 폴백 차단'
        : '단순 일봉 차트 종목 확인 필요 — Selector/Claude 폴백 차단');
    } else {
      mdlog('단순 일봉 차트 REST 직결 — Selector/Claude 무호출');
    }
    return simpleChartRoute.result;
  }
  // 정형 질의 모델 우회 확장(2026-08-26 속도 레버) — 순서는 의미 없다(각자
  // 닫힌 문법이라 서로 안 겹친다, rest-dataset-runner.js 테스트로 고정).
  const directDataset = backtestMode ? null : restDatasetRunner.buildCompoundScreenDataset(query, stockEntityIndex, {
    idFactory: () => `rest-${crypto.randomUUID()}`,
  }) || restDatasetRunner.buildQuoteDataset(query, stockEntityIndex, {
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
    return runDirectRestDataset(directDataset, expand, {
      allowRetry: true,
      conversationId: turnConversationId,
      userAlreadyPersisted: true,
      origin,
    });
  }

  // 닫힌 7개 문법이 놓친 조회는 백엔드 Selector가 한 번에 선택·호출·inline
  // render까지 끝낸다. 애매함/인자 부족/비조회 응답만 기존 Claude 경로로 넘긴다.
  // 단순 시장가 주문은 별도 닫힌 문법에서만 intent=order로 보내고, 실행하지 않은
  // guarded 초안을 채팅 주문확인 UI에 전달한다.
  const orderDraft = selectorFastPath.buildMarketOrderDraft(query, stockEntityIndex);
  const selectorController = new AbortController();
  activeSelectorFastRun = selectorController;
  try {
    const selectorResult = backtestMode
      ? { handled: false, reason: '백테스트 모드 — 모델 경로로 넘긴다' }
      : await selectorFastPath.runSelectorFastPath({
      question: query,
      backendBase: BACKEND_HTTP_BASE,
      intent: orderDraft ? orderDraft.intent : 'auto',
      arguments: orderDraft ? orderDraft.arguments : {},
      orderDraft,
      signal: selectorController.signal,
      isCurrent: () => activeSelectorFastRun === selectorController,
      emitCanvas: (payload) => {
        if (activeSelectorFastRun !== selectorController) {
          throw new Error('교체된 Selector fast path의 늦은 카드는 표시하지 않는다');
        }
        return emitRestCanvasForOrigin(payload, {
          expand,
          origin,
          timeoutMs: Math.max(1, payload.paintDeadlineAt - performance.now()),
        });
      },
      emitOrderDraft: (payload) => {
        if (activeSelectorFastRun !== selectorController) {
          throw new Error('교체된 Selector fast path의 늦은 주문 초안은 표시하지 않는다');
        }
        if (!shellWin || shellWin.isDestroyed()) throw new Error('셸 창이 준비되지 않았다');
        if (expand) revealShell({ focus: false });
        shellWin.webContents.send('athena:selector-order-draft', payload);
      },
      persistTurn: ({ question, answerText }) => {
        historySink.saveChatMessage(
          { conversationId: turnConversationId, text: answerText, role: 'assistant' },
          { onSaveFailed: emitHistorySaveFailed, mdlog },
        );
      },
    });
    if (selectorResult.handled) {
      mdlog(`Selector 단일 dispatch 적중 — ${selectorResult.durationMs}ms (모델 무호출)`);
      return selectorResult;
    }
    if (simpleChartRoute.inferenceFallback) {
      mdlog('종목 인덱스 준비 전 Selector 직접 처리 불가 — Claude 폴백 차단');
      return persistLocalLiveResult(query, {
        ...simpleChartRoute.inferenceFallback,
        durationMs: Math.max(0, performance.now() - queryStartedAt),
      }, turnConversationId);
    }
    if (selectorResult.preflight) {
      const coldResult = await selectorColdHedge.runSelectorColdHedge({
        question: query,
        preflight: selectorResult.preflight,
        signal: selectorController.signal,
        isCurrent: () => activeSelectorFastRun === selectorController,
        classify: ({ prompt, signal }) => selectorClaudePool.run({
          prompt,
          timeoutMs: 12_000,
          signal,
        }),
        // 두 분류기는 읽기 전용이다. 첫 유효안이 정해진 뒤에만 단 하나의
        // proposal을 순차 dispatch하여 조회 외 operation의 중복 효과를 막는다.
        dispatchProposal: (proposal) => selectorFastPath.runSelectorFastPath({
          question: query,
          backendBase: BACKEND_HTTP_BASE,
          intent: proposal.intent,
          arguments: proposal.arguments,
          candidateRefs: [proposal.operation_ref],
          preferredRef: proposal.operation_ref,
          detailGroup: proposal.detail_group,
          signal: selectorController.signal,
          isCurrent: () => activeSelectorFastRun === selectorController,
          emitCanvas: (payload) => {
            if (activeSelectorFastRun !== selectorController) {
              throw new Error('교체된 Selector cold path의 늦은 카드는 표시하지 않는다');
            }
            return emitRestCanvasForOrigin(payload, {
              expand,
              origin,
              timeoutMs: Math.max(1, payload.paintDeadlineAt - performance.now()),
            });
          },
          persistTurn: ({ question, answerText }) => {
            historySink.saveChatMessage(
              { conversationId: turnConversationId, text: answerText, role: 'assistant' },
              { onSaveFailed: emitHistorySaveFailed, mdlog },
            );
          },
        }),
      });
      if (coldResult.handled) {
        mdlog(`Selector 병렬 분류 적중 — ${coldResult.operationRef || coldResult.classifiedOperationRef} (모델 2회, dispatch 1회)`);
        return coldResult;
      }
      mdlog(`Selector 병렬 분류 폴백 — ${coldResult.reason}`);
    }
    mdlog(`Selector 단일 dispatch 폴백 — ${selectorResult.reason}`);
  } catch (error) {
    if (selectorController.signal.aborted) {
      return {
        ok: false,
        source: 'selector-fast',
        error: String((selectorController.signal.reason && selectorController.signal.reason.message) || 'Selector fast path 중단'),
        answerText: null,
        canvasTypes: [],
        modelCalls: 0,
      };
    }
    if (simpleChartRoute.inferenceFallback) {
      mdlog(`종목 인덱스 준비 전 Selector 오류 — Claude 폴백 차단: ${String((error && error.message) || error)}`);
      return persistLocalLiveResult(query, {
        ...simpleChartRoute.inferenceFallback,
        durationMs: Math.max(0, performance.now() - queryStartedAt),
      }, turnConversationId);
    }
    // 계약 위반/네트워크 오류는 UI side effect 없이 기존 추론 경로로 복구한다.
    mdlog(`Selector 단일 dispatch 오류 — Claude 폴백: ${String((error && error.message) || error)}`);
  } finally {
    if (activeSelectorFastRun === selectorController) activeSelectorFastRun = null;
  }
  const { dir, configFile } = getLiveMcpConfig();

  // 빠른 경로 — 캐시된 판정이 있으면 claude -p를 스폰하지 않는다. 카드는
  // 백엔드가 사이드 채널로 밀고(캔버스 먼저), 답변은 결정론 템플릿이다.
  // 백테스트 설계 모드는 리플레이를 건너뛴다 — 리플레이는 모델을 안 부르고 카드를 밀며
  // 정형 답을 돌려주므로, "카드를 올리지 않는다"는 모드 규율과 설계 대화가 함께 깨진다
  // (캐시 키는 원문 query 그대로 둔다).
  const cachedJudgment = backtestMode ? null : liveQueryCache.get(query);
  if (cachedJudgment) {
    const replay = await fastPath.runCachedReplay({
      judgment: cachedJudgment,
      backendBase: BACKEND_HTTP_BASE,
    });
    if (replay.ok) {
      mdlog(`캐시 리플레이 적중 — ${replay.durationMs}ms (모델 무호출)`);
      historySink.saveChatMessage(
        { conversationId: turnConversationId, text: replay.answerText, role: 'assistant' },
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

  // 이전 질의 프로세스가 아직 살아 있으면 먼저 트리째 끊는다 — 새 질의가 항상 선점한다.
  if (activeLiveQuery) {
    activeLiveQuery.kill();
    activeLiveQuery = null;
  }
  // 진행 중 브리핑도 같은 원칙으로 끊는다(R1, MAJOR 2) — 사용자가 항상 이긴다
  // (scheduler.py의 "대화가 우선 — 이번 주기 양보"와 대칭, 새 동시성 모델을
  // 발명하지 않는다). 무조건 호출한다 — 카운터 게이트를 두면 예산 왕복 등
  // 카운터가 아직 0인 창의 선점 표시를 놓친다(리뷰 확정 결함). 핸들 정체성
  // 확인·선점 플래그는 briefing-runner.js가 한다 — 유휴 상태면 no-op.
  briefingRunner.killInProgressBriefing();
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
  // 툴 단계는 이벤트라 저장하고, 텍스트 청크는 저널만 한다(명세 4절).
  const trackToolStep = createToolStepTracker((step) => {
    sendLiveToolStep(step);
    const bridge = getSessionBridge();
    if (bridge) bridge.recordToolStep({ sessionId: turnConversationId, messageId: sessionAssistantId, step });
  });
  const trackSubagent = createSubagentTracker();
  const liveProviderId = resolveLiveQueryProviderId();
  noteLiveQueryProvider(liveProviderId);
  const resumeSessionId = liveSessionId;
  // 설정 화면 모델 패널(lib/main/model-prefs.js) 값 — null이면 buildArgs가
  // --model/--effort를 안 붙여 CLI 기본값을 쓴다.
  const prefsState = modelPrefs.get();
  const { model, effort } = liveProviderId === 'grok' ? prefsState.grok : prefsState.claude;
  // 턴 텍스트는 한 번만 만든다 — chat.js가 제출에 실은 canvasMode·backtestContext를
  // 그대로 넘기면 백테스트 설계 모드에서만 접두가 붙고(live-prompt.js
  // buildBacktestModePrefix), 그 외 모드는 문자열 호출과 바이트 동일하다. 캐시 키
  // (liveQueryCache)는 원문 query 그대로다.
  const liveTurnInput = {
    userText: query,
    canvasMode: submit.canvasMode,
    backtestContext: submit.backtestContext,
    graphContext: submit.graphContext,
    agentContext: { project: activeAgentProject() },
    today: todayYyyymmdd(),
  };
  const turnPrompt = buildLiveTurnPrompt(liveTurnInput);
  if (providerRuntimeEnabled && currentProviderSelection.disabled) {
    return {
      ...currentProviderSelection.disabled,
      source: 'live',
      error: 'Codex 대화 연결은 현재 사용할 수 없습니다. 계정 설정에서 Claude 또는 Grok을 선택해 주세요.',
      answerText: null,
      canvasTypes: [],
      canvasCaptions: [],
    };
  }
  if (providerRuntimeEnabled && liveProviderId !== 'grok') {
    const runtime = ensureProviderRuntimeController();
    const clientSubmitId = String(submit.clientSubmitId || '');
    const rendererSubmittedAt = Number(submit.rendererSubmittedAt);
    const expectedRendererId = Number(submit.expectedRendererId);
    const persistentTurnContext = {
      replayTurnCapture,
      canvasTypesSeen,
      canvasCaptionsSeen,
      expand: expand === true,
      expandTriggered: false,
      origin,
    };
    persistentTurnContexts.set(clientSubmitId, persistentTurnContext);
    let persistentResult;
    try {
      persistentResult = await runtime.sendTurn({
        request: {
          clientSubmitId,
          conversationId: turnConversationId,
          origin,
          userText: turnPrompt,
        },
        expectedRendererId,
        rendererSubmittedAt,
      });
    } finally {
      persistentTurnContexts.deleteIfSame(clientSubmitId, persistentTurnContext);
    }
    const answerText = persistentResult.ok ? persistentResult.finalText : null;
    const replayJudgment = persistentResult.ok
      ? replayTurnCapture.buildJudgment(canvasTypesSeen)
      : null;
    if (replayJudgment) liveQueryCache.set(query, replayJudgment);
    return {
      ok: !!persistentResult.ok,
      source: 'live',
      error: persistentResult.ok ? null : persistentResult.error,
      answerText,
      canvasTypes: [...new Set(canvasTypesSeen)],
      canvasCaptions: canvasCaptionsSeen,
      canvasResultCount: canvasTypesSeen.length,
      diagnostics: null,
      durationMs: persistentResult.timings && persistentResult.timings.totalMs,
      turnId: persistentResult.turnId,
      clientSubmitId,
    };
  }
  // 두 경로(상주 세션/콜드 스폰)가 같은 콜백을 공유한다 — 스트림 계약이 동일하다.
  const turnCallbacks = {
    onSpawn: (h) => { myHandle = h; activeLiveQuery = h; },
    // 성공 resolve 1건과 render 1건의 토큰이 정확히 같은 경우만 캐시한다.
    onEvent: (ev) => { replayTurnCapture.observe(ev); trackToolStep(ev); trackSubagent(ev); },
    onTextDelta: (text, metadata) => {
      sendLiveTextDelta(text, metadata);
      const bridge = getSessionBridge();
      if (bridge) bridge.journalDelta({ sessionId: turnConversationId, messageId: sessionAssistantId, text });
    },
    onCanvasResult: (r) => {
      const label = r.envelope && (r.envelope.card_title || r.envelope.caption);
      // 실시간 트리거 판정(P1, 2026-08-27) — card_title==='시세' 하나만 보던 옛
      // 조건은 "삼성전자 시세 보여줘"가 실제로는 detail:ka10001 → card_title
      // '종목정보' facts 카드로 라우팅되는(canvas_transform.py:865, 의도된 라우팅)
      // 자연 발화를 놓쳤다 — QA 배치 전체에서 REG 0건의 원인. extractLiveQuoteSymbol이
      // 종목코드를 뽑아내는가로 바꾼다: 이 함수가 보는 envelope.stk_cd는 backend
      // 53ece06이 시장 데이터 3도메인(charts·stockinfo·quotes)에만 봉인하므로
      // 계좌·주문 카드는 그대로 자연 배제된다.
      const liveSymbol = extractLiveQuoteSymbol(r.envelope);
      if (r.status === 'pushed') {
        // shell에는 사이드 채널로 이미 도착했으므로 다시 보내지 않는다. 다만
        // 오브 기원 질의는 그 사이드 채널을 구독하지 않으므로 오브에만 한 번 보낸다.
        if (r.envelope && r.envelope.canvas_type) canvasTypesSeen.push(r.envelope.canvas_type);
        if (label) canvasCaptionsSeen.push(label);
        if (liveSymbol) ensureRealtimeForSymbol(liveSymbol);
        if (origin === 'orb' && orbWin && !orbWin.isDestroyed()) {
          orbWin.webContents.send('athena:orb-canvas-result', r);
        }
        return;
      }
      if (expand && !expandTriggered) {
        expandTriggered = true;
        // 첫 카드가 확정된 시점에 창을 앞으로 한 번만 가져온다 — 카드마다
        // moveTop()을 반복하면 사용자가 다른 앱으로 옮겨간 뒤에도 계속 튀어나온다.
        revealShell({ focus: false });
      }
      // 셸 캔버스 적재는 origin과 무관하게 그대로 유지한다 — "대화창으로
      // 가기 → 메인 방 그대로 이어진다"(board-34) 계약이 셸·오브가 하나의
      // 캔버스 히스토리를 공유한다는 뜻이라, 오브 기원 질의라고 셸 캔버스
      // 적재를 건너뛰면 셸을 다시 열었을 때 오브에서 나온 카드가 빠진다.
      sendLiveCanvasResult(r);
      // board-33③④ 선행 — 오브 기원 질의일 때만 같은 엔벌로프를 오브 창에도
      // 추가로 relay한다(오브의 표/차트 축약 카드 렌더러가 구독, Step 9b/9c).
      if (origin === 'orb' && orbWin && !orbWin.isDestroyed()) {
        orbWin.webContents.send('athena:orb-canvas-result', r);
      }
      if (r.envelope && r.envelope.canvas_type) canvasTypesSeen.push(r.envelope.canvas_type);
      if (label) canvasCaptionsSeen.push(label);
      if (liveSymbol) ensureRealtimeForSymbol(liveSymbol);
    },
  };
  // 상주 세션(기본) — 매 턴 콜드 스폰의 고정비가 없다. 결과 형상이 동일해
  // 아래 세션 체인·캐시·저장 로직은 분기를 모른다. ATHENA_PERSISTENT_CHAT=0
  // 이면 기존 왕복(runClaudeQuery)으로 폴백한다(킬 스위치).
  let result;
  if (liveProviderId === 'grok') {
    result = await runGrokQuery({
      prompt: buildLivePrompt(liveTurnInput),
      cwd: dir,
      resumeSessionId,
      model,
      effort,
      ...turnCallbacks,
    });
  } else if (persistentChatEnabled()) {
    result = await getLiveChatSession().run({
      // 규칙은 세션 system prompt로 이미 갔다 — 턴에는 질문(+백테스트 설계 접두)만 보낸다.
      prompt: turnPrompt,
      model,
      effort,
      resumeSessionId,
      ...turnCallbacks,
    });
  } else {
    const legacyQueryOperation = runClaudeQuery({
      // 날것 질문을 그대로 넘기면 모델이 조회만 하고 캔버스를 건너뛸 수 있다 —
      // 렌더 지시·스키마 힌트로 감싼다(lib/main/live-prompt.js의 실측 근거 참조).
      prompt: buildLivePrompt(liveTurnInput),
      cwd: dir,
      configFile,
      resumeSessionId,
      model,
      effort,
      ...turnCallbacks,
    });
    // MCP 뮤테이션이 진행 중인 콜드 질의를 끊을 수 있게 완료 핸들을 남긴다
    // (terminateColdLegacyRuntime — 프로바이더 런타임 opt-in 경로에서만 쓴다).
    const legacyQueryCompletion = Promise.resolve(legacyQueryOperation).then(() => undefined, () => undefined);
    activeLegacyQueryCompletion = legacyQueryCompletion;
    try {
      result = await legacyQueryOperation;
    } finally {
      if (activeLegacyQueryCompletion === legacyQueryCompletion) activeLegacyQueryCompletion = null;
    }
  }
  if (typeof result.firstEventMs === 'number') {
    mdlog(`상주 채팅 턴 — 제출→첫 스트림 이벤트 ${Math.round(result.firstEventMs)}ms `
      + `(프로세스 ${result.spawnedFresh ? '신규 기동' : '재사용'})`);
  }

  // 내가 등록한 핸들일 때만 지운다 — 이 await 동안 새 질의가 선점해 자기 핸들을
  // 걸어뒀다면 그걸 지우면 안 된다.
  if (activeLiveQuery === myHandle) activeLiveQuery = null;

  // 멀티턴 세션 체인 갱신 — 성공 왕복의 새 session_id로 잇는다.
  if (historyConversationId() === turnConversationId
      && result.ok && result.finalResult && result.finalResult.session_id) {
    liveSessionId = result.finalResult.session_id;
    // 커서는 대화마다 따로 남긴다 — 이력 행을 다시 눌렀을 때 이 값으로 문맥을 잇는다.
    try { conversations.setResumeCursor({ id: turnConversationId, resumeSessionId: liveSessionId }); } catch { /* 커서 기록 실패는 턴 성공의 필요조건이 아니다 */ }
  } else if (historyConversationId() === turnConversationId
      && !result.ok && resumeSessionId && !result.aborted && !result.timedOut) {
    // 재개 실패 — 세션 파일이 사라졌거나 CLI가 재개를 거부했을 수 있다. 다음
    // 질의가 계속 같은 이유로 죽지 않게 세션을 버린다(fail-open은 새 대화 시작).
    liveSessionId = null;
    if (/session/i.test(String(result.error || ''))) {
      // 세션 문제로 죽은 게 분명하면 이번 질의만은 새 세션으로 1회 재시도한다 —
      // liveSessionId가 이미 null이라 재귀는 한 단계에서 끝난다.
      // origin을 반드시 실어 보낸다 — 누락하면 오브 기원 질의가 이 재시도를
      // 타는 순간 origin이 기본값 'shell'로 조용히 리셋되어, 재시도로 살아난
      // 응답의 캔버스 엔벌로프가 오브에 relay되지 않는 은닉 회귀가 된다.
      // runLiveQuery로 되돌아가면 사용자 메시지 저장이 한 번 더 돌아 이력이
      // 중복된다 — Inner로 직접 재진입한다. submit은 바깥 runLiveQuery의
      // finally가 아직 안 돌아 liveSubmitContexts에 그대로 살아 있다.
      { const bridge = getSessionBridge(); if (bridge) bridge.finishAssistant({ sessionId: turnConversationId, messageId: sessionAssistantId, interrupted: true, error: result.error || 'session_retry' }); }
      return runLiveQueryInner(query, expand, origin, turnConversationId);
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
  {
    const bridge = getSessionBridge();
    if (bridge) {
      bridge.finishAssistant({
        sessionId: turnConversationId,
        messageId: sessionAssistantId,
        text: answerText === null ? undefined : answerText,
        usage: result.finalResult && result.finalResult.usage ? result.finalResult.usage : null,
        error: result.ok ? null : String(result.error || ''),
        interrupted: !result.ok,
      });
    }
  }

  // 응답 산출 직후 role:assistant 1건 — null이면 스킵(계획 §2(a)). 여기도
  // fire-and-forget — 반환을 막지 않는다.
  if (answerText !== null) {
    historySink.saveChatMessage(
      { conversationId: turnConversationId, text: answerText, role: 'assistant' },
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
    canvasResultCount: canvasTypesSeen.length,
    diagnostics: result.diagnostics,
    durationMs: result.finalResult && result.finalResult.duration_ms,
  };
}

function abortConversationWork(reason) {
  if (activeSelectorFastRun) {
    activeSelectorFastRun.abort(reason || new Error('대화 작업을 취소했다'));
    activeSelectorFastRun = null;
  }
  if (activeRestRun) {
    activeRestRun.abort(reason || new Error('대화 작업을 취소했다'));
    activeRestRun = null;
  }
  if (activeLiveQuery) {
    activeLiveQuery.kill();
    activeLiveQuery = null;
  }
  if (providerRuntimeController && providerRuntimeEnabled) {
    void providerRuntimeController.interrupt(String((reason && reason.message) || reason || 'user_interrupt'))
      .catch((error) => mdlog(`provider interrupt 실패: ${String((error && error.message) || error)}`));
  }
}

async function terminateColdLegacyRuntime(reason = 'mcp-security-mutation') {
  const completion = activeLegacyQueryCompletion;
  abortConversationWork(new Error(reason));
  if (completion) await completion;
  return { ok: true };
}

// Esc 중단 — 렌더러의 abortToken은 UI 반영만 막는다. 프로세스는 여기서 실제로 죽인다.
ipcMain.on('athena:abort-live-query', () => {
  abortConversationWork(new Error('사용자가 진행 중인 대화 작업을 취소했다'));
});

ipcMain.on('athena:provider-paint-ack', (event, payload) => {
  const ackResult = providerPaintAckRegistry.accept(
    event.sender.id,
    payload,
    currentPersistentRuntimeGeneration,
  );
  if (ackResult.accepted) {
    providerVerifierTelemetry.recordPaintAck({
      senderWebContentsId: event.sender.id,
      senderFrameUrl: event.senderFrame?.url
        || (typeof event.sender.getURL === 'function' ? event.sender.getURL() : null),
      runtimeGeneration: currentPersistentRuntimeGeneration,
      ackResult,
      payload,
    });
  }
});

ipcMain.handle('athena__render_canvas', async (e, payload = {}) => {
  if (isQuitting) return { ok: false, type: 'action-needed', code: 'APP_SHUTTING_DOWN' };
  if (payload.source === 'rest-retry') {
    if (!shellWin || shellWin.isDestroyed() || e.sender !== shellWin.webContents) {
      return { ok: false, source: 'rest-retry', error: '유효하지 않은 재시도 요청입니다.' };
    }
    const accountId = activeRestAccountId();
    const consumed = restRetryRegistry.consume({
      retryId: payload.retryId,
      senderId: e.sender.id,
      conversationId: historyConversationId(),
      accountId,
    });
    if (!consumed) {
      return { ok: false, source: 'rest-retry', error: '재시도 권한이 만료되었거나 이미 사용되었습니다.' };
    }
    const result = await runDirectRestDataset(consumed.dataset, true, {
      allowRetry: true,
      conversationId: historyConversationId(),
      accountId,
    });
    return {
      ok: Boolean(result.ok),
      source: 'rest-retry',
      state: result.state || null,
      error: result.ok ? null : (result.error || '다시 조회하지 못했습니다.'),
      retryable: Boolean(result.retryable),
    };
  }
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
  return runLiveQuery(query, expand, 'shell', historyConversationId(), {
    clientSubmitId: payload.clientSubmitId,
    rendererSubmittedAt: payload.rendererSubmittedAt,
    expectedRendererId: e.sender.id,
    // 백테스트 설계 모드 턴 접두 재료(chat.js가 실어 보낸다) — 평범한 데이터만 넘긴다.
    canvasMode: typeof payload.canvasMode === 'string' ? payload.canvasMode : null,
    backtestContext: payload.backtestContext && typeof payload.backtestContext === 'object'
      ? payload.backtestContext : null,
    graphContext: payload.graphContext && typeof payload.graphContext === 'object'
      ? payload.graphContext : null,
  });
});

// 오브 대화 모드(2026-08-26 board-33) — 셸이 숨겨졌을 때만 오브 렌더러가 이
// 채널을 부른다(orb.js 쪽 게이트는 athena:shell-visibility). **셸 창을 앞으로
// 가져오지 않는다**(expand:false 고정) — "오브 미니 채팅은 언제나 메인 방
// 하나에만 말한다"(board-34), 카드는 셸을 열지 않고도 캔버스 사이드 채널로
// 이미 그려진다(startCanvasFeed). 파이프라인은 새로 만들지 않는다 — 셸의
// 커맨드바가 부르는 runLiveQuery와 완전히 같은 함수를 그대로 호출한다.
ipcMain.handle('athena:orb-chat-submit', async (e, payload = {}) => {
  if (isQuitting) return { ok: false, type: 'action-needed', code: 'APP_SHUTTING_DOWN' };
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
  const result = await runLiveQuery(query, false, 'orb', historyConversationId(), {
    clientSubmitId: payload.clientSubmitId,
    rendererSubmittedAt: payload.rendererSubmittedAt,
    expectedRendererId: e.sender.id,
  });
  // 셸이 나중에 다시 열려도 같은 방이 이어져 보이도록, 오브에서 오간 턴을 셸의
  // 대화 이력에도 커밋한다("대화창으로 가기 → 메인 방 그대로 이어진다", board-34).
  // 세션·이력 저장 자체는 runLiveQuery가 이미 끝냈다 — 여기서는 셸 DOM 표시만
  // 뒤늦게 채워 넣는다(셸이 숨어 있는 동안은 chat.js가 그릴 수 없었으므로).
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:orb-turn-committed', { query, result });
  }
  return result;
});


// method/body를 받는다(2026-09-03) — 사람의 직접 취소가 POST라서 필요해졌다.
// 기본값은 그대로 GET이므로 기존 호출자(전부 GET)는 한 줄도 안 바뀐다.
async function fetchBrainJson(path, { params, signal, method, payload } = {}) {
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
    const headers = { Authorization: `Bearer ${token}` };
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    res = await fetch(url, {
      ...(method ? { method } : {}),
      headers,
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      ...(signal ? { signal } : {}),
    });
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

// 그래프 모드 요약 뷰(보드 06/07)의 "숨은 연관" 섹션 — 군집 경계를 넘는 연결.
// 스텝7에서 신설(정찰 당시엔 백엔드 엔드포인트만 있고 이 IPC 배선이 없었다).
ipcMain.handle('athena:brain-surprising-connections', async (_e, { limit } = {}) => {
  const result = await fetchBrainJson('/api/v1/brain/analysis/surprising-connections', {
    params: { limit },
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, ...result.body };
});

// 사람의 직접 취소(2026-09-03) — 확정 카드의 '적용'이 부른다. 수집을 기다리지
// 않고 바로 지운다: 수집(대화를 캐는 일)과 편집(주인이 화면에서 고치는 일)은
// 다른 일이다. 모델은 이 채널에 닿지 않는다 — 렌더러의 카드만 부른다.
// 되물을 것들 카드의 '맞다' — 불확실을 사실로 올린다. 취소와 같은 이유로 즉시
// 반영한다: 답해도 "확인이 필요한 것 N건"이 줄지 않으면 같은 카드가 무한히 되묻는다.
// 사람의 직접 추가·수정(2026-09-03) — 확정 카드의 op=add|change가 부른다.
// 지우기·확인과 달리 관계를 새로 쓴다. 티어는 MANUAL이라 다음 대화 추출이 덮지 못한다.
ipcMain.handle('athena:brain-manual-relation', async (_e, payload = {}) => {
  const subjectId = typeof payload.subjectId === 'string' ? payload.subjectId.trim() : '';
  const objectId = typeof payload.objectId === 'string' ? payload.objectId.trim() : '';
  const kind = typeof payload.kind === 'string' ? payload.kind.trim() : '';
  if (!subjectId || !objectId || !kind) return { ok: false, error: '두 끝 id와 관계 이름이 필요하다' };
  const result = await fetchBrainJson('/api/v1/brain/relations/manual', {
    method: 'POST',
    payload: {
      subject_id: subjectId,
      object_id: objectId,
      kind,
      rationale: typeof payload.rationale === 'string' ? payload.rationale : null,
    },
  });
  if (!result.ok) return { ok: false, error: result.error };
  if (result.body && result.body.written && shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:brain-graph-updated', {
      revision: result.body.revision,
      trigger: 'human-manual-edit',
    });
  }
  return { ok: true, ...result.body };
});

ipcMain.handle('athena:brain-confirm-relation', async (_e, { relationId } = {}) => {
  const id = typeof relationId === 'string' ? relationId.trim() : '';
  if (!id) return { ok: false, error: 'relationId가 없다' };
  const result = await fetchBrainJson('/api/v1/brain/relations/confirmations', {
    method: 'POST',
    payload: { relation_id: id },
  });
  if (!result.ok) return { ok: false, error: result.error };
  if (result.body && result.body.changed && shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:brain-graph-updated', {
      revision: result.body.revision,
      trigger: 'human-confirmation',
    });
  }
  return { ok: true, ...result.body };
});

ipcMain.handle('athena:brain-retract-relation', async (_e, { relationId, subjectId, objectId, kind } = {}) => {
  // 두 가지 지목을 받는다(2026-09-03): 확정 카드는 relation_id를 알고, 패널의 관계
  // 목록은 (출발·도착·관계) 삼중만 안다(cluster-map의 edge_details가 그 셋만 준다).
  // id 해시는 백엔드 한 벌만 둔다 — 여기서 다시 구현하면 어긋나는 순간 조용히 실패한다.
  const id = typeof relationId === 'string' ? relationId.trim() : '';
  const subject = typeof subjectId === 'string' ? subjectId.trim() : '';
  const object = typeof objectId === 'string' ? objectId.trim() : '';
  const relKind = typeof kind === 'string' ? kind.trim() : '';
  if (!id && !(subject && object && relKind)) {
    return { ok: false, error: 'relationId 또는 (subjectId, objectId, kind)가 없다' };
  }
  const result = await fetchBrainJson('/api/v1/brain/relations/retractions', {
    method: 'POST',
    payload: id
      ? { relation_id: id }
      : { subject_id: subject, object_id: object, kind: relKind },
  });
  if (!result.ok) return { ok: false, error: result.error };
  // 지웠으면 화면을 바로 다시 읽게 한다 — 이 이벤트는 이미 canvas.js가 구독해
  // refreshConversationGraphSurfaces()를 돈다(표·지도·숨은 연관·히어로 전부).
  // broadcastConversationGraphUpdated()의 중복 방지 키를 타지 않는다: 사람이 방금
  // 누른 편집은 '같은 그래프'로 접혀서는 안 된다.
  if (result.body && result.body.removed && shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:brain-graph-updated', {
      revision: result.body.revision,
      trigger: 'human-retraction',
    });
  }
  return { ok: true, ...result.body };
});

// 엔티티 타임라인(WP-C, 그래프 후속 계획) — graph_events를 엔티티 단위로
// 조회한다. 이 스텝은 IPC 배선까지만이다(패널 UI는 후속 작업, controller.js:286
// 참고) — 아직 이 채널을 부르는 렌더러 코드는 없다.
ipcMain.handle('athena:brain-entity-timeline', async (_e, { entityId, limit } = {}) => {
  const result = await fetchBrainJson('/api/v1/brain/analysis/entity-timeline', {
    params: { entity_id: entityId, limit },
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

function purgePendingChatForPreferenceChange(mode) {
  const isEnabling = mode === 'enable';
  const actionLabel = isEnabling ? '재활성화' : '해제';
  try {
    configureConversationGraphPipeline();
    return historySink.purgePendingChatMessages();
  } catch (error) {
    mdlog(`대화 이력 수집 ${actionLabel} 실패 — 전송 전 원문 삭제 불가: ${String((error && error.message) || error)}`);
    const message = isEnabling
      ? '대화 이력 수집을 켜지 못했습니다. 수집은 OFF로 유지됩니다.'
      : '대화 이력 수집은 OFF로 유지됐지만 남은 원문을 삭제하지 못했습니다.';
    const publicError = new Error(message);
    publicError.code = 'chat-history-purge-failed';
    throw publicError;
  }
}

function handlePrefsSet(e, patch) {
  const previous = prefs.get();
  const requestedCollectChat = patch && typeof patch.collectChat === 'boolean'
    ? patch.collectChat
    : null;

  // 재활성화 전에 과거 OFF 전환에서 삭제하지 못했을 수 있는 pending 원문을
  // 반드시 먼저 지운다. 삭제가 실패하면 prefs는 아직 false이므로 stale 원문이
  // 다음 flush에서 업로드될 수 없다.
  if (previous.collectChat === false && requestedCollectChat === true) {
    try {
      const purged = purgePendingChatForPreferenceChange('enable');
      mdlog(`대화 이력 수집 재활성화 준비 — 잔여 전송 전 원문 ${purged}건 삭제`);
    } catch (error) {
      const safe = { ...previous, collectChat: false };
      if (shellWin && !shellWin.isDestroyed()) shellWin.webContents.send('athena:prefs-changed', safe);
      throw error;
    }
  }

  const next = prefs.set(patch || {});
  if (previous.collectChat && requestedCollectChat === false) {
    try {
      const purged = purgePendingChatForPreferenceChange('disable');
      mdlog(`대화 이력 수집 해제 — 전송 전 원문 ${purged}건 삭제`);
    } catch (error) {
      // prefs는 이미 false다. 다른 렌더러에도 fail-closed 상태를 먼저 방송한 뒤
      // 호출자에는 실패를 돌려 화면에서 OFF와 오류를 함께 표시한다.
      if (shellWin && !shellWin.isDestroyed()) shellWin.webContents.send('athena:prefs-changed', next);
      throw error;
    }
  }
  // 설정 카드는 셸 창 안의 같은 렌더러다(#settings 패널) — 그래도 원본과 같이
  // 명시적으로 방송한다. 다른 진입점이 생겨도 이 계약이 그대로 맞는다.
  // 유리 단계·fontSize는 캔버스 영역 텍스트에도 적용되는데, 이제 두 영역이 같은
  // 문서라 방송 1회로 둘 다 닿는다(옛 판은 창마다 한 번씩 보냈다).
  if (shellWin && !shellWin.isDestroyed()) shellWin.webContents.send('athena:prefs-changed', next);
  return next;
}

ipcMain.handle('athena:settings:prefs:get', handlePrefsGet);
ipcMain.handle('athena:settings:prefs:set', handlePrefsSet);

// exposeToModel 실반영(WP-I I4) — 렌더러 토글 값을 main prefs에 영속하고
// backend 게이트(POST /settings/expose-to-model)에 즉시 민다. POST 실패는
// {ok:false}로 알릴 뿐 로컬 토글 표시를 막지 않는다 — 브레인 준비 폴링
// (history-sink.refreshBrainReady, G-I6)이 준비 확인 시 같은 값을 재동기화한다.
ipcMain.handle('athena:settings:expose-to-model:set', async (_e, { enabled } = {}) => {
  const next = prefs.set({ exposeToModel: enabled === true });
  if (shellWin && !shellWin.isDestroyed()) shellWin.webContents.send('athena:prefs-changed', next);
  const pushed = await historySink.pushExposeToModel({ mdlog });
  return { ok: pushed, enabled: next.exposeToModel };
});

// ---------------------------------------------------------------------------
// 모델 설정(모델·추론강도) — 공급자별로 저장소가 다르다(2026-08-18 Codex 실결선).
// claude는 lib/main/model-prefs.js(athena-model.json, userData 아래) —
// 이 앱만의 설정이다. codex는 lib/main/codex-config.js($CODEX_HOME/config.toml)
// — Codex 본인의 설정 파일에 직접 쓴다, 이 앱 밖에서 codex를 쓸 때도 적용되는
// 전역 기본값이다. 검증은 각 모듈이 한다, 여기선 라우팅 + 성공 시 병합·방송만
// 담당한다(prefs와 같은 문법 — 셸 창이 같은 렌더러의 #settings 패널이라도
// 명시적으로 보낸다).
// IPC 계약: athena:model-get/-set → { claude, grok, codex } 각 {model,effort}.
// ---------------------------------------------------------------------------

function handleModelGet() {
  const { claude, grok } = modelPrefs.get();
  const { model, effort } = codexConfig.readModelSettings();
  return { claude, grok, codex: { model, effort } };
}

async function handleModelSet(e, payload = {}) {
  const { provider, patch } = payload || {};
  const result = provider === 'codex' ? codexConfig.writeModelSettings(patch || {}) : modelPrefs.set(payload);
  if (!result.ok) return result;
  const state = handleModelGet();
  let selectorActivation = null;
  if (provider === 'claude') {
    // 기존 세대를 먼저 죽이지 않는다. 풀은 새 모델 worker 세대를 모두 올린 뒤
    // 구세대를 정리한다. warming 동안의 신규 요청에는 구 모델을 섞지 않는다.
    const poolState = selectorClaudePool.configure({ model: state.claude.model, effort: 'low' });
    selectorActivation = {
      status: poolState.activation,
      targetGeneration: poolState.targetGeneration,
      servingGeneration: poolState.servingGeneration,
      readyWorkers: poolState.readyCurrent,
      desiredWorkers: poolState.desiredSize,
    };
    mdlog(`Selector Claude worker pool 모델 전환 — ${JSON.stringify(selectorActivation)}`);
    // 상주 채팅 세션도 새 모델로 백그라운드 재예열한다 — 진행 중 턴이 있으면
    // warm()이 건드리지 않고, 다음 run()이 config 불일치로 --resume 재활용한다.
    // resumeSessionId는 반드시 liveSessionId를 명시한다 — 생략하면 모듈 내부
    // 커서로 폴백하는데, 그 값이 중단된 턴의 포크를 가리킬 수 있다(아키텍트
    // 리뷰 결함 1). 대화 커서의 진실은 이 파일의 liveSessionId 하나다.
    if (persistentChatEnabled() && liveChatSession) {
      liveChatSession.warm({
        model: state.claude.model,
        effort: state.claude.effort,
        resumeSessionId: liveSessionId,
      });
    }
  }
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:model-changed', state);
  }
  if (providerRuntimeEnabled) await rotatePersistentProvider('model_settings_changed');
  return selectorActivation ? { ok: true, state, selectorActivation } : { ok: true, state };
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

function reportSafeCliError(error) {
  mdlog(`CLI 계정 상태 갱신 실패: ${String((error && error.message) || error)}`);
}

async function broadcastCliChanged({ rotateReason = null, list: suppliedList = null } = {}) {
  const list = suppliedList || await cliAccounts.list();
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:cli-changed', list);
  }
  if (rotateReason) {
    await rotatePersistentProvider(rotateReason, { activeAccount: activeAccountFromCliList(list) });
  }
  return list;
}

async function pollCliChangesAfterLogin(providerId) {
  const before = JSON.stringify(await cliAccounts.list());
  // 목록이 안 변하는 재로그인(기존 계정으로 다시 로그인)은 자격증명 파일
  // mtime 서명으로 잡는다 — 없으면 온보딩 '로그인 대기 중'이 영영 안 풀린다.
  const sigBefore = cliAccounts.credentialsSignature();
  let attempts = 0;
  let pollInFlight = false;
  const timer = setInterval(() => {
    if (pollInFlight) return;
    pollInFlight = true;
    void (async () => {
    attempts += 1;
    const now = JSON.stringify(await cliAccounts.list());
    if (now !== before || cliAccounts.credentialsSignature() !== sigBefore) {
      clearInterval(timer);
      // 로그인 = 활성 전환(2026-08-27 검토 결정)
      await cliAccounts.activateProviderCurrent(providerId);
      await broadcastCliChanged({ rotateReason: 'cli_login_completed' });
    } else if (attempts >= 30) {
      clearInterval(timer);
    }
    })().catch(reportSafeCliError).finally(() => { pollInFlight = false; });
  }, 2000);
}

async function handleCliList() {
  return cliAccounts.list();
}

async function handleCliLogin(e, { providerId } = {}) {
  const result = await cliAccounts.login(providerId);
  if (result.launched) void pollCliChangesAfterLogin(providerId).catch(reportSafeCliError);
  return result;
}

async function handleCliSetActive(e, { accountId } = {}) {
  const result = await cliAccounts.setActive(accountId);
  if (result.ok) await broadcastCliChanged({ rotateReason: 'active_provider_changed' });
  return result;
}

// 설정 모델 카드 [제거](2026-09-05, Paper 화면 18) — 활성 계정이 지워질 수 있어
// 전환과 같은 이유로 프로바이더를 회전시킨다.
async function handleCliRemove(e, { accountId } = {}) {
  const result = await cliAccounts.remove(accountId);
  if (result.ok) await broadcastCliChanged({ rotateReason: 'cli_account_removed' });
  return result;
}

ipcMain.handle('athena:cli-list', handleCliList);
ipcMain.handle('athena:cli-login', handleCliLogin);
ipcMain.handle('athena:cli-set-active', handleCliSetActive);
ipcMain.handle('athena:cli-remove', handleCliRemove);

// 키우미 메뉴 › 파일/폴더 첨부(2026-08-27, Paper 보드 45) — 경로만 돌려준다.
// 파일 내용은 여기서 읽지 않는다: 경로 텍스트가 입력줄에 붙고, 읽는 건 CLI의 몫.
async function handlePickFiles(e, { directory } = {}) {
  const properties = directory ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'];
  const res = await dialog.showOpenDialog(shellWin, { properties });
  if (res.canceled) return { ok: false, paths: [] };
  return { ok: true, paths: res.filePaths || [] };
}
ipcMain.handle('athena:pick-files', handlePickFiles);

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
ipcMain.handle('athena:conversations-list', () => {
  const listed = conversations.list();
  const bridge = getSessionBridge();
  const states = bridge ? bridge.runStates() : {};
  return {
    ...listed,
    conversations: listed.conversations.map((row) => ({ ...row, runState: states[row.id] || null })),
  };
});
// 세션 스냅샷(메시지·카드·워크스페이스·뷰포트) — 이력 행을 다시 눌렀을 때 화면을
// 되살리는 원본. 스토어에 없으면 null이고, 렌더러는 브레인 이력 조회로 폴백한다.
ipcMain.handle('athena:session-load', (_e, payload = {}) => {
  const id = payload && typeof payload.id === 'string' ? payload.id : '';
  const bridge = getSessionBridge();
  if (!id || !bridge) return null;
  return bridge.load(id);
});
// 렌더러가 보고하는 작업 환경(캔버스 카드 스택·모드 워크스페이스·뷰포트). 렌더러 DOM은
// 투영이고 쓰기 주체는 main이다 — 브리지가 디바운스해 스토어에 적는다.
// 렌더러는 세션 id를 모른다 — 기록 대상의 진실은 main의 historyConversationId()다.
ipcMain.on('athena:session-cards', (_e, payload = {}) => {
  const bridge = ensureSessionRecord(historyConversationId());
  if (bridge && payload) bridge.saveCards({ sessionId: historyConversationId(), cards: payload.cards });
});
// 렌더러는 바뀐 조각(patch)만 보낸다 — 모드마다 다른 컨트롤러가 자기 조각만 알기 때문이다.
// 병합과 kind(=그 대화의 모드) 도장은 여기서 한다. 통째로 온 workspace도 받는다(옛 계약).
const sessionWorkspaceCache = new Map();
ipcMain.on('athena:session-workspace', (_e, payload = {}) => {
  const sessionId = historyConversationId();
  const bridge = ensureSessionRecord(sessionId);
  if (!bridge || !payload) return;
  let base = sessionWorkspaceCache.get(sessionId);
  if (!base) {
    const stored = bridge.load(sessionId);
    base = stored && stored.workspace && typeof stored.workspace === 'object' ? stored.workspace : {};
  }
  const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch
    : (payload.workspace && typeof payload.workspace === 'object' ? payload.workspace : {});
  const listed = conversations.list();
  const record = listed.conversations.find((row) => row.id === sessionId) || null;
  const merged = { ...base, ...patch, kind: record ? record.mode : listed.activeMode };
  sessionWorkspaceCache.set(sessionId, merged);
  bridge.saveWorkspace({ sessionId, workspace: merged });
});
ipcMain.on('athena:session-viewport', (_e, payload = {}) => {
  const bridge = ensureSessionRecord(historyConversationId());
  if (bridge && payload) bridge.saveViewport({ sessionId: historyConversationId(), viewport: payload.viewport });
});
// 복원 — 저장된 카드 봉투를 같은 페인트 채널로 다시 흘린다(별도 렌더러 없음, 42번 보드).
// 렌더러가 캔버스를 비운 뒤에 부르므로 순서가 어긋나지 않는다. 다시 그려진 카드는
// 렌더러가 다시 보고하고, 같은 스택이 그대로 저장된다.
ipcMain.handle('athena:session-replay-cards', (_e, payload = {}) => {
  const id = payload && typeof payload.id === 'string' ? payload.id : '';
  const bridge = getSessionBridge();
  if (!id || !bridge || !shellWin || shellWin.isDestroyed()) return { replayed: 0 };
  const snapshot = bridge.load(id);
  const cards = snapshot && Array.isArray(snapshot.canvasCards) ? snapshot.canvasCards : [];
  let replayed = 0;
  for (const card of cards) {
    if (!card || !card.envelope) continue;
    if (card.channel === 'fixture') {
      shellWin.webContents.send('athena:add-canvas', { type: card.envelope.type || card.kind, sessionCardId: card.cardId });
    } else {
      shellWin.webContents.send('athena:add-canvas-live', { status: 'success', envelope: card.envelope, sessionCardId: card.cardId });
    }
    replayed += 1;
  }
  return { replayed };
});
// 과거 대화 열기(2026-09-02 사용자 지적 "대화 이력을 누르면 그 대화로 이동해야 한다").
//
// 기존 athena:brain-history-query를 재사용할 수 없다 — 그쪽은 (a) 대화가 현재 것으로
// 고정돼 있고 (b) 결과를 캔버스 카드(테이블 엔벨로프)로 밀어 넣는다. 여기는 채팅
// 화면에 과거 대화를 펼치는 것이라 목적이 다르다.
//
// **읽기 전용이다.** 메시지는 브레인 이력 DB에 conversation_id와 함께 남아 있어
// 되읽을 수 있지만, Claude 세션은 복원하지 않는다 — 이어서 말할 수 있는 척하면
// 새 메시지가 과거 제목 아래 섞인다(아래 conversations-set-active 주석과 같은 이유).
ipcMain.handle('athena:conversation-messages', async (_e, payload = {}) => {
  const id = payload && typeof payload.conversationId === 'string' ? payload.conversationId : '';
  if (!id) return { ok: false, error: '대화 id가 없다' };
  const asked = payload && Number(payload.limit);
  const limit = Number.isFinite(asked) ? Math.max(1, Math.min(500, Math.trunc(asked))) : 200;
  const result = await fetchBrainJson('/api/v1/brain/chats', {
    params: { conversation_id: id, limit },
  });
  if (!result.ok) return { ok: false, error: result.error };
  const messages = ((result.body && result.body.messages) || []).map((m) => ({
    role: m.role, text: m.text, occurredAt: m.occurred_at,
  }));
  return { ok: true, conversationId: id, isCurrent: id === historyConversationId(), messages };
});
// 이력 행을 누르면 그 대화로 실제로 돌아간다(41번 보드 "다시 누르면 그대로").
// 기록 대상 id와 Claude 커서(--resume)가 함께 바뀌므로, 새 대화 만들기와 같은
// 직렬화 큐(switchTo) 안에서만 바꾼다 — 진행 중 턴을 먼저 끊고, 프로바이더를
// 돌린 뒤, 고른 id를 발행한다. 큐 밖에서 historyActiveConversationId를 만지면
// 새 메시지가 엉뚱한 제목 아래 섞인다(main-conversation-boundary.test.js).
ipcMain.handle('athena:conversations-set-active', async (e, { id, verifierCorrelationId } = {}) => {
  const requestedId = typeof id === 'string' && id.trim() ? id.trim() : null;
  const listed = conversations.list();
  const known = requestedId && listed.conversations.some((row) => row.id === requestedId);
  if (!known) {
    return { ...listed, activeId: historyActiveConversationId, requestedId, restorable: false };
  }
  if (requestedId === historyActiveConversationId) {
    return { ...listed, activeId: historyActiveConversationId, requestedId, restorable: true, isCurrent: true };
  }
  if (verifierCorrelationId !== undefined) {
    providerVerifierTelemetry.authorizeRotation(verifierCorrelationId);
  }
  const state = await providerConversationRotationQueue.switchTo({ id: requestedId, verifierCorrelationId });
  return { ...state, requestedId, restorable: true, isCurrent: false, resumed: Boolean(liveSessionId) };
});
// Paper 54: 빈 대화는 첫 입력 전에는 목록에 만들지 않는다. 캔버스 mode는
// renderer가 그대로 보존하고, main은 새 기록 id와 프로젝트 소속만 원자적으로
// 바꾼다.
ipcMain.handle('athena:conversations-new', async (e, { projectId, mode, verifierCorrelationId } = {}) => {
  if (verifierCorrelationId !== undefined) {
    providerVerifierTelemetry.authorizeRotation(verifierCorrelationId);
  }
  return providerConversationRotationQueue.begin({ projectId, mode, verifierCorrelationId });
});

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

// 아래 다섯은 프로바이더 런타임이 꺼져 있으면 병합 전 main의 몸통 그대로 돈다.
// 켜져 있을 때만 runMcpMutation의 조정자(재기동·에폭 회전·평문 환경값 이전)를 탄다.
async function handleMcpList() {
  if (!providerRuntimeEnabled) {
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
  }
  return mcpCli.list();
}

function handleMcpStageSnippet(e, { snippet } = {}) {
  return mcpCli.stageSnippet(snippet);
}

async function handleMcpRegister(e, { staged } = {}) {
  if (!providerRuntimeEnabled) return mcpCli.register(staged);
  return runMcpMutation('register', () => mcpCli.register(staged));
}

async function handleMcpApprove(e, { alias } = {}) {
  if (!providerRuntimeEnabled) return mcpCli.approve(alias);
  return runMcpMutation('approve', () => mcpCli.approve(alias));
}

async function handleMcpRevoke(e, { alias } = {}) {
  if (!providerRuntimeEnabled) return mcpCli.revoke(alias);
  return runMcpMutation('revoke', () => mcpCli.revoke(alias));
}

function handleMcpProbe(e, { alias } = {}) {
  // probe는 실제로 upstream 서버를 spawn한다 — 그 서버 하나만의 env override를
  // 넘긴다(전체가 아니라 alias로 필터링, mcp-env.js buildEnvOverrides() 참고).
  return mcpCli.probe(alias, mcpEnv.buildEnvOverrides(alias));
}

async function handleMcpAllowTool(e, { alias, tool, allowed } = {}) {
  if (!providerRuntimeEnabled) return mcpCli.allowTool(alias, tool, allowed);
  return runMcpMutation(allowed ? 'allow' : 'disallow', () => mcpCli.allowTool(alias, tool, allowed));
}

async function handleMcpRemove(e, { alias } = {}) {
  if (!providerRuntimeEnabled) return mcpCli.remove(alias);
  return runMcpMutation('remove', () => mcpCli.remove(alias));
}

ipcMain.handle('athena:mcp-list', handleMcpList);
ipcMain.handle('athena:mcp-probe', handleMcpProbe);
// 변이 여섯은 IPC로 열지 않는다 — 렌더러 호출자가 없고, 실행의 유일한 문은
// athena:plugin-approve다. 위 함수들은 verify-settings.js가 직접 부른다.
// 감사 로그는 읽기 전용이라 실행 조정자를 거치지 않는다.
ipcMain.handle('athena:mcp-audit', () => mcpCli.auditLog());

// ---------------------------------------------------------------------------
// 플러그인 승인 — 실행은 사람이 카드를 누른 이 경로에서만 일어난다.
// 제안 툴은 읽기만 하고 아무것도 바꾸지 않는다(backend/athena_mcp/plugin_tools.py).
// ---------------------------------------------------------------------------

const pluginProposalRegistry = createPluginProposalRegistry({
  catalog: PLUGIN_CATALOG,
  executor: {
    list: () => mcpCli.list(),
    stageSnippet: (snippet) => mcpCli.stageSnippet(snippet),
    register: (staged) => mcpCli.register(staged),
    approve: (alias) => mcpCli.approve(alias),
    revoke: (alias) => mcpCli.revoke(alias),
    remove: (alias) => mcpCli.remove(alias),
    allowTool: (alias, tool, allowed) => mcpCli.allowTool(alias, tool, allowed),
    // probe만 2인자다 — 실제로 upstream 서버를 띄우므로 그 서버 하나의 env를 넘긴다.
    probe: (alias) => mcpCli.probe(alias, mcpEnv.buildEnvOverrides(alias)),
  },
});

// 모델 경로와 GUI 경로 공통의 대기 등록 지점. 응답을 기다리지 않는 단방향이라
// 카드 렌더를 막지 않는다 — 등록이 늦어도 승인 인자가 봉투 전체라 손실이 없다.
ipcMain.on('athena:plugin-noted', (e, envelope) => {
  pluginProposalRegistry.note(envelope);
});

// 승인·거부 결과는 언제나 같은 일곱 칸을 채운다 — 결과 턴이 실패 경로에서만
// 빈 칸을 만나 다른 코드를 타지 않게 한다.
function pluginResult(kind, reason, extra = {}) {
  return {
    ok: kind === 'success' || kind === 'rejected',
    kind,
    reason: reason || null,
    results: extra.results || [],
    probes: extra.probes || [],
    revision: extra.revision === undefined ? mcpCli.list().revision : extra.revision,
    runtimeEnabled: providerRuntimeEnabled,
  };
}

// 순서(게이트 → 소비 → 판번호 → 실행 → 연결 확인)는 레지스트리의 decide가
// 소유한다 — verify-plugins.js도 같은 함수를 부른다. 여기는 포장과 로그만 한다.
// handleMcp*를 재사용하지 않는다 — 그 함수들은 IPC 이벤트 인자를 받는 모양이고,
// 런타임이 켜진 빌드에서는 자기들이 다시 runMcpMutation을 불러 교착한다.
async function handlePluginApprove(e, envelope) {
  // 판번호는 한 번만 읽는다 — 게이트에서 막힌 반환도 이 값을 그대로 싣는다.
  const revision = mcpCli.list().revision;
  const decided = await pluginProposalRegistry.decide(envelope, {
    revisionNow: revision,
    runMutation: providerRuntimeEnabled ? ((run) => runMcpMutation('plugin-batch', run)) : null,
  });
  for (const row of decided.results) {
    const outcome = row.ok ? '완료' : `실패: ${row.error}${row.detail ? ` (${row.detail})` : ''}`;
    mdlog(`플러그인 승인 ${row.action} ${row.target || ''} — ${outcome}`);
  }
  if (decided.mutationError) mdlog(`플러그인 승인 반영 실패 — ${decided.mutationError}`);
  return pluginResult(decided.kind, decided.reason, {
    results: decided.results,
    probes: decided.probes,
    revision,
  });
}

// 거부는 어떤 CLI도 부르지 않는다 — 소비 표시와 대기 목록 제거뿐이다.
function handlePluginReject(e, envelope) {
  const claimed = pluginProposalRegistry.consume(envelope);
  if (!claimed.ok) return pluginResult('failed', claimed.error);
  mdlog(`플러그인 거부 ${((envelope && envelope.actions) || []).map((row) => row.action).join(' · ')}`);
  return pluginResult('rejected', null);
}

// 창 복원·모드 재진입 전용 — 미해결 봉투와 현재 판번호를 함께 돌려준다.
function handlePluginPending() {
  return pluginProposalRegistry.pending();
}

ipcMain.handle('athena:plugin-approve', handlePluginApprove);
ipcMain.handle('athena:plugin-reject', handlePluginReject);
ipcMain.handle('athena:plugin-pending', handlePluginPending);

const BRAIN_GRAPH_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const BRAIN_GRAPH_OBSERVER_INTERVAL_MS = 60 * 1000;
const BRAIN_GRAPH_REFRESH_TIMEOUT_MS = 300_000;
let conversationGraphRefresher = null;
let conversationGraphRefreshTimer = null;
let conversationGraphObserverTimer = null;
let conversationGraphScheduleOwner = null;
let lastBroadcastGraphKey = null;
let lastConversationGraphRefreshFailure = null;

function configureConversationGraphPipeline() {
  if (conversationGraphRefresher) return conversationGraphRefresher;
  historySink.configureChatHistoryStore({
    dbPath: path.join(app.getPath('userData'), 'athena-chat-outbox.sqlite3'),
  });
  conversationGraphRefresher = createConversationGraphRefresher({
    baseUrl: historySink.getBackendUrl(),
    getBearerToken: historySink.getBearerToken,
    flushPending: async (options = {}) => {
      await historySink.refreshBrainReady({ mdlog });
      return historySink.flushPendingChatMessages({
        ...options,
        onSaveFailed: emitHistorySaveFailed,
        mdlog,
      });
    },
    fetchImpl: fetch,
  });
  return conversationGraphRefresher;
}

function broadcastConversationGraphUpdated(report) {
  if (!shouldBroadcastConversationGraph(lastBroadcastGraphKey, report)) return false;
  if (!shellWin || shellWin.isDestroyed() || shellWin.webContents.isDestroyed()) return false;
  shellWin.webContents.send('athena:brain-graph-updated', {
    revision: report.graph.revision,
    labelFingerprint: report.graph.labelFingerprint,
    nodes: report.graph.nodes,
    edges: report.graph.edges,
    clusters: report.graph.clusters,
    trigger: report.trigger,
  });
  lastBroadcastGraphKey = createConversationGraphBroadcastKey(report);
  return true;
}

async function notifyConversationGraphRefreshFailure(error) {
  const code = String((error && error.code) || 'graph-refresh-failed');
  if (lastConversationGraphRefreshFailure === code) return;
  lastConversationGraphRefreshFailure = code;
  const payload = {
    title: '그래프 업데이트 실패',
    body: '대화 이력을 그래프에 반영하지 못했습니다. 다음 한 시간 주기에 다시 시도합니다.',
  };
  await Promise.allSettled([
    sendRendererStartupNotification(shellWin, payload),
    showStartupOsNotification(Notification, payload),
  ]);
}

async function runConversationGraphRefresh(trigger) {
  try {
    const report = await configureConversationGraphPipeline().run({
      trigger,
      timeoutMs: BRAIN_GRAPH_REFRESH_TIMEOUT_MS,
    });
    conversationGraphScheduleOwner = report.scheduleOwner;
    lastConversationGraphRefreshFailure = null;
    broadcastConversationGraphUpdated(report);
    mdlog(`대화 그래프 갱신 완료 — trigger=${trigger} mode=${report.mode} revision=${report.graph.revision} nodes=${report.graph.nodes} edges=${report.graph.edges}`);
    return report;
  } catch (error) {
    if (error && error.report && error.report.scheduleOwner) {
      conversationGraphScheduleOwner = error.report.scheduleOwner;
    }
    mdlog(`대화 그래프 갱신 실패 — trigger=${trigger} code=${String((error && error.code) || 'unknown')}`);
    if (trigger === 'hourly') await notifyConversationGraphRefreshFailure(error);
    throw error;
  }
}

async function observeConversationGraph() {
  try {
    const report = await configureConversationGraphPipeline().observe({
      timeoutMs: BRAIN_GRAPH_REFRESH_TIMEOUT_MS,
    });
    conversationGraphScheduleOwner = report.scheduleOwner;
    const broadcast = broadcastConversationGraphUpdated(report);
    mdlog(`대화 그래프 관찰 완료 — owner=${report.scheduleOwner} revision=${report.graph.revision} broadcast=${broadcast}`);
    return report;
  } catch (error) {
    if (error && error.report && error.report.scheduleOwner) {
      conversationGraphScheduleOwner = error.report.scheduleOwner;
    }
    mdlog(`대화 그래프 관찰 실패 — code=${String((error && error.code) || 'unknown')}`);
    throw error;
  }
}

function startHourlyConversationGraphRefresh() {
  if (conversationGraphRefreshTimer) return false;
  conversationGraphRefreshTimer = setInterval(
    () => void runConversationGraphRefresh('hourly').catch(() => {}),
    BRAIN_GRAPH_REFRESH_INTERVAL_MS,
  );
  if (typeof conversationGraphRefreshTimer.unref === 'function') {
    conversationGraphRefreshTimer.unref();
  }
  return true;
}

function startConversationGraphObserver() {
  if (conversationGraphObserverTimer) return false;
  conversationGraphObserverTimer = setInterval(() => {
    void observeConversationGraph().catch(() => {});
  }, BRAIN_GRAPH_OBSERVER_INTERVAL_MS);
  if (typeof conversationGraphObserverTimer.unref === 'function') {
    conversationGraphObserverTimer.unref();
  }
  return true;
}

function stopHourlyConversationGraphRefresh() {
  if (!conversationGraphRefreshTimer) return false;
  clearInterval(conversationGraphRefreshTimer);
  conversationGraphRefreshTimer = null;
  return true;
}

function stopConversationGraphObserver() {
  if (!conversationGraphObserverTimer) return false;
  clearInterval(conversationGraphObserverTimer);
  conversationGraphObserverTimer = null;
  return true;
}

app.on('will-quit', () => {
  stopHourlyConversationGraphRefresh();
  stopConversationGraphObserver();
  historySink.closeChatHistoryStore();
  conversationGraphRefresher = null;
});

// ---------- 부팅 준비 원장 — main이 단일 권위 상태를 소유한다 ----------
// 타이핑 애니메이션은 최소 1.92초를 보장하지만, 실제 셸 진입은 이 원장의 gate가
// 모두 성공(또는 fixture에서 명시적으로 disabled)한 뒤에만 가능하다. selector 풀과
// 장기 재연결 루프는 시작 여부만 기록하고 종료를 기다리지 않는다.
const BOOT_TASKS = [
  { id: 'mcp-env', label: '보안 환경 확인', kind: 'gate' },
  { id: 'provider-warm', label: '대화 연결 준비', kind: 'gate' },
  { id: 'backend', label: 'ATHENA 서비스 연결', kind: 'gate' },
  { id: 'stock-index', label: '종목 검색 데이터 준비', kind: 'gate' },
  { id: 'brain-ingestion', label: '대화 분석기 준비', kind: 'gate' },
  { id: 'chat-history-flush', label: '대화 이력 SQLite 반영', kind: 'gate' },
  { id: 'graph-projection', label: '대화 성향 그래프·군집 구성', kind: 'gate' },
  { id: 'alarm-bootstrap', label: '알람·루틴 복원 및 놓친 일정 확인', kind: 'gate' },
  { id: 'routine-feed', label: '알람 실시간 연결', kind: 'gate' },
  { id: 'canvas-feed', label: '그래프·캔버스 실시간 연결', kind: 'gate' },
  { id: 'fixture-readiness', label: '검증용 합성 준비 작업', kind: 'gate' },
  { id: 'background-loops', label: '주기 작업 시작', kind: 'continuous' },
];

const startupFailureNotifier = new StartupFailureNotifier();
let shellExpansionAcknowledged = false;
let startupFailureNotificationResult = { notified: false, delivered: [] };
const pendingStartupNotificationAcks = new Map();

function sendRendererStartupNotification(target, payload) {
  if (!target || target.isDestroyed() || target.webContents.isDestroyed()
    || target.webContents.isLoadingMainFrame()) return Promise.resolve(false);
  const senderId = target.webContents.id;
  if (pendingStartupNotificationAcks.has(senderId)) return Promise.resolve(false);
  return new Promise((resolve) => {
    let timer;
    const finish = (shown) => {
      const pending = pendingStartupNotificationAcks.get(senderId);
      if (!pending || pending.finish !== finish) return;
      pendingStartupNotificationAcks.delete(senderId);
      clearTimeout(timer);
      target.webContents.removeListener('destroyed', destroyed);
      resolve(shown);
    };
    const destroyed = () => finish(false);
    pendingStartupNotificationAcks.set(senderId, { finish });
    target.webContents.once('destroyed', destroyed);
    timer = setTimeout(() => finish(false), 1500);
    try {
      target.webContents.send('athena:app-notification', payload);
    } catch {
      finish(false);
    }
  });
}

function emitRestCanvasForOrigin(
  payload,
  { expand = true, timeoutMs = 3000, origin = 'shell' } = {},
) {
  // REST·Selector의 inline 응답은 WS 사이드 채널을 거치지 않는다. 따라서
  // 오브에서 시작한 턴은 메인 캔버스의 기존 paint 계약을 그대로 수행하면서,
  // 같은 권위 봉투를 오브에도 한 번 전달해야 카드미니가 빠지지 않는다.
  if (origin === 'orb' && orbWin && !orbWin.isDestroyed()
      && payload && payload.envelope) {
    orbWin.webContents.send('athena:orb-canvas-result', {
      status: 'success',
      envelope: payload.envelope,
    });
  }
  return emitRestCanvasAndWaitForPaint(payload, { expand, timeoutMs });
}

async function notifyStartupFailuresAfterExpansion(snapshot) {
  if (!shellExpansionAcknowledged) return { notified: false, delivered: [] };
  const result = await startupFailureNotifier.notify(snapshot, {
    shell: (payload) => sendRendererStartupNotification(shellWin, payload),
    orb: (payload) => sendRendererStartupNotification(orbWin, payload),
    os: (payload) => showStartupOsNotification(Notification, payload),
  });
  startupFailureNotificationResult = result;
  return result;
}

function broadcastBootReadiness(snapshot) {
  if (bootWin && !bootWin.isDestroyed()) {
    bootWin.webContents.send('athena:boot-readiness', snapshot);
  }
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('athena:boot-readiness', snapshot);
  }
}

function attemptShellHandoff() {
  if (!windowHandoff.canCompleteShellHandoff({
    bootVisualComplete, shellHandoffReady, bootWin, shellWin,
  })) return false;
  const handoffBounds = bootWin.getBounds();
  shellWin.setBounds(handoffBounds);
  noteAppBounds(shellWin);
  shellHandoffVisibilityAudit = windowHandoff.revealShellWithoutVisibleOverlap(bootWin, shellWin);
  shellWin.focus();
  shellWin.moveTop();
  flushStartupRoutineBuffer();
  bootWin.destroy();
  bootWin = null;
  broadcastShellWindowState(shellWin);
  broadcastShellVisibility();
  mdlog(`boot -> WCO shell handoff complete at ${JSON.stringify(handoffBounds)}`);
  return true;
}

const startupReadiness = new StartupReadiness({
  tasks: BOOT_TASKS,
  onChange: broadcastBootReadiness,
  onReady: (snapshot) => {
    mdlog(`부팅 gate 종결 — phase=${snapshot.phase}`);
    void notifyStartupFailuresAfterExpansion(snapshot);
  },
});

async function ensureBackendStrict(context) {
  const result = await backendLauncher.ensureBackendReady({
    mdlog,
    onProgress: ({ elapsedMs, remainingMs }) => context.update({
      state: 'waiting',
      detail: `ATHENA 서비스 준비 중 · ${Math.ceil(elapsedMs / 1_000)}초 경과 · 최대 ${Math.ceil(remainingMs / 1_000)}초 남음`,
    }),
  });
  if (!result || result.ok !== true) {
    throw new Error((result && result.error) || '백엔드 기동 실패');
  }
  if (result.reason === 'no-venv') throw new Error('백엔드 가상환경이 설치되지 않음');
  if (result.ready === false) throw new Error('백엔드 lifespan 준비를 아직 확인하지 못함');
  return { detail: result.spawned ? '백엔드 기동 및 lifespan 확인 완료' : '실행 중인 백엔드 확인 완료' };
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withDeadline(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForStockIndex(context) {
  stockEntityIndexReadiness.start();
  await waitForInitialReadiness({
    ensureReady: (timeoutMs) => stockEntityIndexReadiness.ensureReady(timeoutMs),
    maxAttempts: 6,
    attemptTimeoutMs: 2_000,
    onRetry: (attempt) => context.update({
      state: 'retrying', detail: `종목명 인덱스 적재 재시도 중 (${attempt}/6)`,
    }),
    errorMessage: '종목명 인덱스를 12초 안에 처음 적재하지 못함',
  });
  return { detail: `종목 ${stockEntityIndex.size}개 적재 완료` };
}

async function waitForBrainStartup(context) {
  // Startup ingestion uses the same Claude extraction path as graph projection;
  // a legitimate extraction may take up to 180s. Keep one shared 5-minute
  // watchdog so BOOT does not report a false failure while the real job runs.
  const deadlineAt = Date.now() + BRAIN_GRAPH_REFRESH_TIMEOUT_MS;
  for (;;) {
    if (Date.now() >= deadlineAt) throw new Error('브레인 시작 수집 제한시간(5분) 초과');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('brain status timeout')), 3_000);
    const result = await fetchBrainJson('/api/v1/brain/status', { signal: controller.signal });
    clearTimeout(timeout);
    if (!result.ok) throw new Error(result.error || '브레인 상태 조회 실패');
    const body = result.body || {};
    const classification = classifyBrainStartupStatus(body);
    if (classification.state === 'disabled') {
      return { disabled: true, detail: classification.detail };
    }
    if (classification.state === 'succeeded') {
      if (body.extraction_enabled !== true) {
        throw new Error('대화 기반 그래프 추출기가 비활성화되어 있음');
      }
      const sinkReady = await historySink.refreshBrainReady({ mdlog });
      if (!sinkReady) throw new Error('대화 이력 저장소 준비 상태를 확인하지 못함');
      return { detail: classification.detail };
    }
    if (classification.state === 'failed') throw new Error(classification.detail);
    context.update({ state: classification.state, detail: classification.detail });
    await waitMs(1_000);
  }
}

function registerLiveBootRunners(createWindowsPromise) {
  startupReadiness.setRunner('mcp-env', async () => {
    const result = await withDeadline(
      mcpEnv.migratePlaintextEnv(), 10_000, 'MCP 보안 환경 이전 제한시간 초과',
    );
    if (result.skipped.length) {
      throw new Error(`보안 저장소로 옮기지 못한 MCP 환경값 ${result.skipped.length}건`);
    }
    return { detail: result.migrated.length ? `${result.migrated.length}건 이전 완료` : '이전할 평문 환경값 없음' };
  });
  startupReadiness.setRunner('backend', ensureBackendStrict);
  startupReadiness.setRunner('provider-warm', async () => {
    // 플래그를 먼저 본다 — 뒤에 두면 기능이 꺼져 있어도 매 부팅마다 CLI 계정
    // 조회·MCP 스냅샷·시스템 프롬프트 해시를 계산하고, 이 태스크는 gate라
    // 실패하면 앱 기동 자체를 막는다.
    if (!providerRuntimeEnabled) return { disabled: true, detail: '기존 단일 요청 대화 모드' };
    const selection = await rotatePersistentProvider('startup_warmup');
    if (selection.disabled) return { disabled: true, detail: 'Codex 대화 연결은 현재 비활성화됨' };
    return { detail: '지속 대화 연결 준비 완료' };
  });
  startupReadiness.setRunner('stock-index', waitForStockIndex);
  startupReadiness.setRunner('brain-ingestion', waitForBrainStartup);
  startupReadiness.setRunner('chat-history-flush', async () => {
    const result = await historySink.flushPendingChatMessages({
      batchSize: 100,
      maxBatches: 100,
      onSaveFailed: emitHistorySaveFailed,
      mdlog,
    });
    if (result.failed > 0 || result.remaining > 0) {
      throw new Error(`보류 대화 ${result.remaining}건을 그래프 저장소에 반영하지 못함`);
    }
    return { detail: `대화 이력 ${result.synced}건 반영 · 보류 0건` };
  });
  startupReadiness.setRunner('graph-projection', async () => {
    const report = await runConversationGraphRefresh('boot');
    return {
      detail: report.warmStatus === 'ready_empty'
        ? '반영할 대화 성향 없음 · 빈 그래프 준비 완료'
        : `엔티티 ${report.graph.nodes}개 · 관계 ${report.graph.edges}개 · 군집 ${report.graph.clusters}개`,
    };
  });
  startupReadiness.setRunner('alarm-bootstrap', async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('routine bootstrap timeout')), 10_000);
    try {
      const result = await checkMissedSchedules({ signal: controller.signal });
      return { detail: `루틴 ${result.routineCount}개 복원 확인 · 놓친 일정 ${result.missedCount}개` };
    } finally {
      clearTimeout(timeout);
    }
  });
  startupReadiness.setRunner('routine-feed', async (context) => {
    await createWindowsPromise;
    return waitForFirstFeedConnection('routine-feed', startRoutineFeed, context);
  });
  startupReadiness.setRunner('canvas-feed', async (context) => {
    await createWindowsPromise;
    return waitForFirstFeedConnection('canvas-feed', startCanvasFeed, context);
  });
  startupReadiness.setRunner('background-loops', async () => {
    const { model: selectorModel } = modelPrefs.get().claude;
    selectorClaudePool.configure({ model: selectorModel, effort: 'low' });
    selectorClaudePool.start();
    mdlog(`Selector Claude worker pool 선기동 — ${JSON.stringify(selectorClaudePool.snapshot())}`);
    // 상주 채팅 세션 예열 — 첫 질문이 오기 전에 CLI + MCP 게이트웨이(및
    // upstream 연결)를 미리 끝내둔다. 첫 턴부터 콜드 스폰 고정비가 없다.
    if (persistentChatEnabled()) {
      const { model: chatModel, effort: chatEffort } = modelPrefs.get().claude;
      const chatState = getLiveChatSession().warm({ model: chatModel, effort: chatEffort });
      mdlog(`상주 채팅 세션 선기동 — ${JSON.stringify(chatState)}`);
    }
    return { detail: 'Selector pool 시작 · 주기 및 재연결 작업은 백그라운드에서 지속' };
  });
  startupReadiness.disable('fixture-readiness', '실사용 모드에서는 합성 작업을 사용하지 않음');
}

async function startLiveBoot(createWindowsPromise) {
  registerLiveBootRunners(createWindowsPromise);
  await runStartupOrchestration({
    readiness: startupReadiness,
    concurrentTaskIds: ['stock-index'],
    dependencyTaskChains: [['mcp-env', 'provider-warm']],
    dependencyTaskId: 'backend',
    dependentTaskIds: ['alarm-bootstrap', 'routine-feed', 'canvas-feed'],
    sequentialDependentTaskIds: ['brain-ingestion', 'chat-history-flush', 'graph-projection'],
    continuousTaskIds: ['background-loops'],
  });
  startHourlyConversationGraphRefresh();
  startConversationGraphObserver();
  mdlog(`대화 그래프 갱신 예약 — 1시간 action + 60초 read-only observer · owner=${conversationGraphScheduleOwner || 'unknown'}`);
}

let fixtureBootStarted = false;

function startFixtureBoot() {
  const failTask = String(process.env.ATHENA_BOOT_FIXTURE_FAIL_TASK || '').trim();
  const target = BOOT_TASKS.some((task) => task.id === failTask && task.kind === 'gate')
    ? failTask
    : 'fixture-readiness';
  const delayMs = Math.max(0, Number(process.env.ATHENA_BOOT_FIXTURE_DELAY_MS) || 0);
  const failAttempts = Math.max(0, Number(process.env.ATHENA_BOOT_FIXTURE_FAIL_ATTEMPTS) || (failTask ? 1 : 0));
  for (const task of BOOT_TASKS) {
    if (task.id !== target) startupReadiness.disable(task.id, 'fixture 모드에서 외부 작업 생략');
  }
  startupReadiness.setRunner(target, async ({ attempt }) => {
    if (delayMs) await waitMs(delayMs);
    if (attempt <= failAttempts) throw new Error('fixture 합성 실패');
    return { detail: delayMs ? `fixture 합성 지연 ${delayMs}ms 완료` : 'fixture 합성 준비 완료' };
  });
  void startupReadiness.start(target);
}

function startBootReadinessForVerify() {
  if (process.env.ATHENA_CANVAS_SOURCE !== 'fixture') {
    throw new Error('startBootReadinessForVerify는 fixture 모드에서만 사용할 수 있음');
  }
  if (fixtureBootStarted) return startupReadiness.snapshot();
  fixtureBootStarted = true;
  startFixtureBoot();
  return startupReadiness.snapshot();
}

const bootReadinessHandlers = {
  get: async (event) => {
    const senderAllowed = event && (
      (shellWin && !shellWin.isDestroyed() && event.sender === shellWin.webContents)
      || (bootWin && !bootWin.isDestroyed() && event.sender === bootWin.webContents)
      || verifyBootSenderIds.has(event.sender.id)
    );
    if (!senderAllowed) {
      throw new Error('boot readiness is available only to the shell');
    }
    return startupReadiness.snapshot();
  },
};

const verifyBootSenderIds = new Set();
const verifyBootCompletionSnapshots = new Map();

function registerVerifyBootWindow(win) {
  if (process.env.ATHENA_NO_AUTOSTART !== '1' || process.env.ATHENA_CANVAS_SOURCE !== 'fixture') {
    throw new Error('verify boot window registration is fixture-only');
  }
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    throw new Error('verify boot window must be alive');
  }
  const senderId = win.webContents.id;
  verifyBootSenderIds.add(senderId);
  win.webContents.once('destroyed', () => verifyBootSenderIds.delete(senderId));
}

ipcMain.handle('athena:boot-readiness:get', bootReadinessHandlers.get);
ipcMain.on('athena:app-notification-shown', (event) => {
  const pending = pendingStartupNotificationAcks.get(event.sender.id);
  if (pending) pending.finish(true);
});
ipcMain.on('athena:boot-complete', (event, snapshot = {}) => {
  const isProductionBoot = windowHandoff.isExpectedWindowSender(event, bootWin);
  if (!isProductionBoot && !verifyBootSenderIds.has(event.sender.id)) return;
  verifyBootCompletionSnapshots.set(event.sender.id, snapshot);
  if (!isProductionBoot) return;
  shellExpansionAcknowledged = true;
  bootVisualComplete = true;
  attemptShellHandoff();
  void notifyStartupFailuresAfterExpansion(startupReadiness.snapshot());
});
ipcMain.on('athena:shell-handoff-ready', (event) => {
  if (!windowHandoff.isExpectedWindowSender(event, shellWin)) return;
  shellHandoffReady = true;
  attemptShellHandoff();
});

if (!process.env.ATHENA_NO_AUTOSTART) {
  app.whenReady().then(() => {
    // 2026-08-22 팔레트 반전(사용자 지시 "애플 Liquid Glass 형태 그대로"):
    // Windows의 acrylic/mica는 **앱 테마**를 따라 렌더된다. 다크로 두면 재질 자체가
    // 어두워 무슨 값을 써도 검정으로 수렴한다(실측 3회 — acrylic·mica 모두).
    // 라이트로 고정해야 밝은 유리가 되고, 비활성 창에서 DWM이 떨어뜨리는 단색도
    // 검정이 아니라 밝은 값이 된다. 시스템 테마를 따라가지 않고 고정하는 이유:
    // 이 앱의 팔레트가 흰 유리 위 잉크 하나뿐이라 다크에서 성립하지 않는다.
    nativeTheme.themeSource = 'light';
    try {
      configureConversationGraphPipeline();
    } catch (error) {
      mdlog(`대화 이력 SQLite 준비 실패 — ${String((error && error.message) || error)}`);
    }
    const createWindowsPromise = createWindows();
    reconcileSessionJobs().catch((error) => mdlog(`실행 정리 실패 — ${String((error && error.message) || error)}`));
    if (process.env.ATHENA_CANVAS_SOURCE === 'fixture') startBootReadinessForVerify();
    else void startLiveBoot(createWindowsPromise);
  });
}

// verify.js에서 재사용 (require로 로드될 때는 자동 기동하지 않는다)
module.exports = {
  bootReadinessHandlers,
  notifyStartupFailuresAfterExpansion,
  getStartupFailureNotificationResult: () => ({
    notified: startupFailureNotificationResult.notified,
    delivered: [...startupFailureNotificationResult.delivered],
  }),
  startBootReadinessForVerify,
  registerVerifyBootWindow,
  getBootCompletionSnapshotForVerify: (senderId) => verifyBootCompletionSnapshots.get(senderId) || null,
  computeLayout,
  createWindows,
  // 실제 대화→outbox flush→수집 job→군집 warm-up→renderer 갱신 경로를
  // 격리 Electron E2E가 그대로 호출한다. 별도 refresher나 수동 IPC를 만들지 않는다.
  runConversationGraphRefreshForProbe: runConversationGraphRefresh,
  emitRestCanvasAndWaitForPaint,
  emitRestReceiptAndWaitForPaint,
  runDirectRestDataset,
  // 정상 상태의 창은 셸 + 알림 오브 둘이다. bootWin은 WCO 셸이 준비될 때까지만
  // 존재하는 전환 창이며, verify.js가 겹침 없는 handoff를 검사할 수 있도록 함께 노출한다.
  getWins: () => ({ bootWin, shellWin, orbWin }),
  getShellHandoffVisibilityAudit: () => shellHandoffVisibilityAudit.map((sample) => ({ ...sample })),
  routineEventToFactsEnvelope,
  getLayout: () => layout,
  // startRoutineFeed()의 onEvent와 동일한 함수 참조(Rev.3 MODERATE 4) — verify.js가
  // WS 서버 없이 routine-fired 주입에 쓴다. fixture 게이트는 startRoutineFeed()
  // 진입만 막을 뿐 이 직접 호출과는 무관하다.
  handleRoutineFeedEvent,
  // 브리핑 러너 검증 훅(AC3) — claudeRunner 스텁·백엔드 왕복 교체와 세션/카운터
  // 불변 단언용 게터. 프로덕션 경로는 아무도 부르지 않는다.
  setBriefingClaudeRunnerForVerify,
  getLiveSessionId: () => liveSessionId,
  getSessionBridge,
  reconcileSessionJobs,
  getBriefingBusyDepth: () => briefingBusyDepth,
  // 셸 창을 앞으로 — verify.js가 트레이 복귀·카드 푸시 경로를 검증할 때 쓴다.
  revealShell,
  // 트레이 클릭과 동일한 복귀 경로 — verify.js가 닫기(백그라운드 유지)를 검증할 때
  // 실제 트레이 클릭을 자동화할 수 없어 같은 함수 참조를 직접 부른다.
  restoreFromBackground,
  // LIFE-003 검증 훅 — 프로덕션의 × IPC가 호출하는 것과 같은 함수다. 최초 1회
  // 영속 마커/OS 안내를 전용 Electron 리뷰에서 확인한다.
  showBackgroundCloseNoticeOnce,
  getBackgroundCloseNoticeStats: () => backgroundNoticeController
    ? backgroundNoticeController.snapshot()
    : { attempts: 0, shown: 0, durableWrites: 0, failures: 0, memoryConsumed: false },
  // LIFE-004 실화면 검수 전용 — 프로덕션 메뉴와 별도 fixture를 만들지 않고,
  // ensureTray()가 소유한 실제 `열기 / 종료` OS 메뉴를 그대로 펼친다.
  showTrayMenuForReview,
  openFromTrayForReview,
  quitFromTrayForReview,
  // OS 배치 감지의 기준점 갱신 — verify.js가 창을 직접 setBounds로 움직이는
  // 검증에서는 그 이동이 "앱 주도"임을 이걸로 표시해야 한다. 안 하면
  // handleForeignArrange가 OS 스냅으로 오인해 창을 정착시킨다(설계된 동작).
  noteAppBounds,
  getShellChromeGeometry: () => ({ ...shellChromeGeometry }),
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
    mcpRevoke: handleMcpRevoke,
    mcpProbe: handleMcpProbe,
    mcpAllowTool: handleMcpAllowTool,
    mcpRemove: handleMcpRemove,
  },
  // probe-quote-realtime.js가 실백엔드·실클로드 없이 "클로드 툴 실시간 경로가
  // 실제로 REG를 부르는지"를 검증할 때 쓴다 — onCanvasResult는 runClaudeQuery
  // 콜백이라 진짜 왕복 없이는 못 부르지만, 이 둘은 그 콜백이 부르는 것과 같은
  // 모듈 함수라 직접 불러도 동일한 판정이 나온다.
  ensureRealtimeForSymbol,
  releaseRealtimeForSymbol,
  extractLiveQuoteSymbol,
  // 합성 0D 프레임 프로브(task #25)가 실백엔드 없이 acquire/release를 직접
  // 검증할 때 쓴다 — 위 ensureRealtimeForSymbol 각주와 같은 이유.
  ensureOrderbookRealtimeForSymbol,
  releaseOrderbookRealtimeForSymbol,
  // 하위 에이전트 도크 프로브(task #32)가 합성 stream-json 이벤트를 실제
  // runLiveQuery 왕복 없이 이 두 트래커에 직접 먹여 sendLiveToolStep/
  // sendLiveSubagentStep(→ shellWin IPC)이 올바르게 나가는지 검증할 때 쓴다.
  createToolStepTracker,
  createSubagentTracker,
};
