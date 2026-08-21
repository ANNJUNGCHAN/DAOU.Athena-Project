// Athena W2 — 두 창 Electron 셸. spike/electron-glass/v2.js·v3.js 이식.
// 부팅 지연 계측(합의 계획 W1) — 이 모듈이 로드되는 순간을 기준점으로 삼는다.
// require()들도 이 시각 이후 비용이므로, "창 표시까지" 수치는 require 체인
// 전체를 포함한다(가장 이른 지점에서 찍어야 실제 부팅 지연을 반영한다).
const MODULE_LOAD_AT = Date.now();
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, Notification } = require('electron');
const { performance } = require('node:perf_hooks');
const path = require('path');
const fs = require('fs');

// 설정·온보딩 화면군의 메인 프로세스 절반 (plan/paper-specs/00-통합-계획.md).
// 비밀값은 secrets.js 밖으로 절대 안 나간다 — accounts.js가 내부적으로만 쓴다.
const onboarding = require('./lib/main/onboarding');
const cliAccounts = require('./lib/main/cli-accounts');
const accounts = require('./lib/main/accounts');
const prefs = require('./lib/main/prefs');
const modelPrefs = require('./lib/main/model-prefs');
const codexConfig = require('./lib/main/codex-config');
const { computePlacement } = require('./lib/main/window-placement');
const mcpCli = require('./lib/main/mcp-cli');
const mcpEnv = require('./lib/main/mcp-env');
// 결정 D1의 실배선 — claude -p 스폰 + stream-json 파싱 + .mcp.json 생성.
const { runClaudeQuery } = require('./lib/main/claude-runner');
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
const crypto = require('crypto');

const MDEBUGLOG = path.join(__dirname, 'captures', 'main-debug.log');
function mdlog(msg) {
  try { fs.appendFileSync(MDEBUGLOG, `${new Date().toISOString()} ${msg}\n`); } catch {}
}

mdlog('module loaded, ATHENA_NO_AUTOSTART: ' + process.env.ATHENA_NO_AUTOSTART);

// v2.js/v3.js와 동일 패턴 — 반드시 빈 핸들러여야 한다. 리스너 자체가 없으면
// Electron이 조용히 app.quit()해버리는 버그가 있다(S1 RESULT.md). 그렇다고
// 여기서 app.quit()을 호출하면 워밍업 창이 닫히는 순간(=그 시점의 "모든 창")
// 앱 전체가 죽는다 — 실제로 이 버그를 여기서 재현했다. 종료는 실제 창(chatWin)의
// 'closed' 이벤트에서만 한다.
app.on('window-all-closed', () => {
  mdlog('window-all-closed fired (no-op)');
});

// OS 레벨 종료(Alt+F4, 트레이 "종료", verify 하네스의 app.quit())와 캔버스 창의
// 개별 OS 닫기(Alt+F4를 캔버스 창에 대고 누르는 경우)를 구분하는 플래그.
// frame:false는 Alt+F4를 못 막는다 — canvasWin의 'close' 핸들러가 이 플래그를
// 보고 진짜 종료 중이 아니면 preventDefault()로 백그라운드 전환으로 돌린다.
let isQuitting = false;
app.on('before-quit', () => {
  isQuitting = true;
  chartReloadAuthority.clear();
  // 우리가 스폰했을 때만 죽인다(backend-launcher.js의 backendChild 판정) — 사용자가
  // 별도 콘솔에서 수동 기동한 백엔드 인스턴스는 이 앱의 생애주기와 무관하게 산다.
  backendLauncher.shutdownBackend();
});

// ---------- 설계 치수 (ui/round-1R/two-windows.md E3 확정안 + 정정 4) ----------
// 2026-08-19 AT-CH-001R(사용자 지시, Paper 47쪽): 대화 창을 전폭 바(1560×204)에서
// 컴팩트 커맨드 카드(900×248)로. 폭이 canvasW와 달라지므로 대화 창은 캔버스 창
// 폭의 중앙에 정렬한다(chatOriginX). 248 = 그립 14 + 이력 ~86 + 입력줄 52 +
// 컨트롤 스트립 48 + 여백.
const DESIGN = {
  canvasW: 1560, canvasH: 800,
  chatW: 900, chatBaseH: 248, chatMaxH: 788,
};

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function computeLayout() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const neededW = DESIGN.canvasW;
  const neededH = DESIGN.canvasH + DESIGN.chatBaseH;
  let scale = 1;
  if (neededW > sw || neededH > sh) {
    scale = Math.min(sw / neededW, sh / neededH, 1);
    console.log(`[layout] 화면(${sw}x${sh})이 설계 치수(${neededW}x${neededH})보다 작다 — 비율 축소 scale=${scale.toFixed(4)}`);
  } else {
    console.log(`[layout] 화면(${sw}x${sh})이 설계 치수를 그대로 수용 — 축소 없음`);
  }
  const canvasW = Math.round(DESIGN.canvasW * scale);
  const canvasH = Math.round(DESIGN.canvasH * scale);
  const chatBaseH = Math.round(DESIGN.chatBaseH * scale);
  const chatMaxH = Math.round(DESIGN.chatMaxH * scale);
  const chatW = Math.round(DESIGN.chatW * scale);
  const originX = Math.floor((sw - canvasW) / 2);
  const originY = Math.max(0, Math.floor((sh - (canvasH + chatBaseH)) / 2));
  // 대화 창 x — chatW가 canvasW보다 좁아진 뒤(AT-CH-001R)로는 캔버스 폭의 중앙.
  const chatOriginX = originX + Math.floor((canvasW - chatW) / 2);
  return { scale, screen: { sw, sh }, canvasW, canvasH, chatW, chatBaseH, chatMaxH, originX, originY, chatOriginX };
}

let layout;
let chatWin, canvasWin;
let chatHeight;
let chatBottom; // 입력줄이 고정되는 화면 y좌표 — 위로만 자란다
let chatX; // 대화 창 x — 사용자가 창을 끌어 옮기면 갱신된다(setChatHeight가 되돌리지 않게)
let canvasVisible = false;

// 사용자가 창을 끌어 옮기거나(드래그), placeWindows()로 스냅하면 높이 앵커를
// 새 위치로 갱신한다 — 안 하면 다음 setChatHeight가 창을 부팅 좌표로 되돌린다.
// createWindows()의 'move'/'resize' 이벤트가 이걸 부른다(모듈 스코프로 뺀 이유는
// placeWindows()가 setBounds() 뒤에 명시적으로도 불러야 해서다 — 이벤트가
// 실제로 도는지 보장이 없는 환경 대비 안전망).
function syncChatAnchor() {
  if (!chatWin || chatWin.isDestroyed() || chatWin.isMinimized()) return;
  const b = chatWin.getBounds();
  chatX = b.x;
  chatBottom = b.y + b.height;
}

function commonWinOpts(bounds) {
  return {
    ...bounds,
    frame: false,
    // 2026-08-18 실측(qa-win-arrow.json): resizable:false에서는 Win+←/→/↑가 OS에
    // 선점돼 before-input-event에 아예 안 온다(mdlog 도달 0건 — Win+↓ 최소화만
    // OS가 실행). Windows 스냅(Win+방향키)이 이 앱에서 통하려면 창이 OS 스냅
    // 대상이어야 하므로 resizable:true다.
    // 2026-08-18 2차(사용자 지시): 크기 잠금(min=max)을 걷어냈다 — **두 창 모두
    // 가로·세로 자유 리사이즈**가 사양이다. 하한(setMinimumSize)만 남기고 상한은
    // 없다. OS 스냅과 사용자 리사이즈의 구분은 handleForeignArrange의 반절 스냅
    // 기하 판별(looksLikeOsSnapHalf)이 맡는다.
    resizable: true,
    show: false,
    // alwaysOnTop을 걸지 않는다(2026-08-17 결정) — 스파이크 시절 값이었지만, 다른
    // 앱 위에 영구히 떠서 "창을 내릴 수 없다"는 실사용 문제가 됐다. z순서는 OS에
    // 맡기고, 두 창끼리의 짝(캔버스 위에 대화 창)은 focus/restore 핸들러의
    // moveTop()으로만 유지한다(createWindows 하단).
    backgroundColor: '#00000000',
    // S1 실측(spike/electron-glass/RESULT.md): backgroundMaterial:'acrylic' 단독으로
    // "뒤가 비치며 블러"가 성립한다. transparent:true는 기본으로 켜지 않는다(W2 지시) —
    // 블러 없는 완전 투명만 주기 때문.
    backgroundMaterial: 'acrylic',
    // 렌더러 격리(2026-08-18, 클로드 데스크탑 방식) — nodeIntegration:false +
    // contextIsolation:true + preload.js의 contextBridge 다리만 남긴다.
    // sandbox:true도 켠 채로 동작한다(preload가 require('electron')만 쓴다 —
    // 실측: npm test 110건 + npm run verify 전체 통과, 흔들리면 여기 주석에 사유를 남기고 끈다).
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      // 2026-08-19 QA 결함 #2 원인 격리 — 두 창은 서로 포커스를 주고받는 게
      // 정상 사용 패턴이다(대화 창에 타이핑하는 동안 캔버스 창은 배경에 있다).
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
  chatBottom = layout.originY + layout.canvasH + layout.chatBaseH;
  chatX = layout.chatOriginX;
  chatHeight = layout.chatBaseH;
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
  mdlog('warmup done, creating canvasWin');

  canvasWin = new BrowserWindow(commonWinOpts({
    x: layout.originX, y: layout.originY, width: layout.canvasW, height: layout.canvasH,
  }));
  const canvasReady = waitForWindowReady(canvasWin, { label: 'canvas window' });
  // 크기 잠금 해제(2026-08-18 사용자 지시 — "무조건 가로세로 모두 조정 가능해야
  // 한다"). E3 치수(1560×800)는 부팅 기본값일 뿐 불변 계약이 아니다. 하한은
  // 카드 1장 + 여백이 성립하는 최소 면적.
  canvasWin.setMinimumSize(480, 320);
  canvasWin.loadFile(resolveWindowHtmlPath(__dirname, 'canvas.html'));
  mdlog('canvasWin created + loadFile called');

  chatWin = new BrowserWindow(commonWinOpts({
    x: chatX, y: chatBottom - chatHeight, width: layout.chatW, height: chatHeight,
  }));
  const chatReady = waitForWindowReady(chatWin, { label: 'chat window' });
  // 채팅창도 폭·높이 모두 유동이다(2026-08-18 사용자 지시). 상한을 걸지 않는다 —
  // chatBaseH~chatMaxH는 자동 성장(setChatHeight)의 가동 범위일 뿐이고, 사용자가
  // OS 모서리 리사이즈로 그 밖에 두면 handleForeignArrange가 수용하고 렌더러에
  // manualOverride를 알린다(athena:manual-resize). 하한은 그립+입력줄이 성립하는
  // 크기. 완전 잠금(min=max)이면 Win+↑의 OS maximize가 이벤트도 없이 무시된다는
  // 실측(qa-win-arrow)은 여전히 유효하다 — 지금은 잠금 자체가 없다.
  chatWin.setMinimumSize(480, Math.min(160, layout.chatBaseH));
  chatWin.loadFile(resolveWindowHtmlPath(__dirname, 'chat.html'));
  mdlog('chatWin created + loadFile called');

  noteAppBounds(canvasWin);
  noteAppBounds(chatWin);

  await Promise.all([canvasReady, chatReady]);
  mdlog('both ready-to-show fired');

  // R1(W2 지시): 부팅 시 대화 창만 뜬다. 캔버스 창은 존재하되 숨어 있다(최종 크기로 생성됨, show() 안 함).
  await chatWin.webContents.executeJavaScript('1');
  mdlog('chatWin executeJavaScript done');
  chatWin.show();
  mdlog(`창 표시까지 ${Date.now() - MODULE_LOAD_AT} ms`);
  chatWin.focus();
  chatWin.moveTop();

  chatWin.webContents.send('athena:init', {
    scale: layout.scale, chatBaseH: layout.chatBaseH, chatMaxH: layout.chatMaxH,
    // 기본은 실배선(live)이다 — ATHENA_CANVAS_SOURCE=fixture일 때만 목업 경로를
    // 쓴다. verify.js가 이 변수를 명시적으로 세팅한다(quota를 쓰는 실제 claude -p
    // 호출을 자동 검증에서 피하려고). 사람이 쓰는 npm start는 항상 live다.
    canvasSource: process.env.ATHENA_CANVAS_SOURCE === 'fixture' ? 'fixture' : 'live',
  });

  chatWin.on('closed', () => app.quit());
  // Alt+F4 등 OS 닫기가 캔버스 창에 직접 오면(원래는 프레임이 없어 막을 방법이
  // 없었다 — 창이 재생성 없이 그냥 사라졌다) hideToBackground()와 같은 의미론으로
  // 흡수한다: 숨기고 canvasVisible=false, 트레이로 복귀 가능한 상태를 유지한다.
  // isQuitting이면(before-quit 이후) 진짜 종료 경로이므로 막지 않는다.
  canvasWin.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    canvasWin.hide();
    canvasVisible = false;
  });
  canvasWin.on('closed', () => { canvasVisible = false; });

  // ---------- 창 기본 기능 (2026-08-17) — frame:false라 OS 타이틀바가 없어 직접 배선 ----------
  // syncChatAnchor는 모듈 스코프 함수(위 정의)다. setChatHeight 자신의 setBounds도
  // 이 핸들러를 지나가지만 y = chatBottom - height라 재계산값이 같다(무해).
  chatWin.on('move', syncChatAnchor);
  chatWin.on('resize', syncChatAnchor);

  // alwaysOnTop이 없어졌으므로 두 창의 짝(캔버스 위에 대화 창)은 여기서만 유지한다.
  chatWin.on('focus', () => {
    if (canvasVisible && canvasWin && !canvasWin.isDestroyed() && !canvasWin.isMinimized()) {
      canvasWin.moveTop();
      chatWin.moveTop();
    }
  });
  canvasWin.on('focus', () => {
    if (chatWin && !chatWin.isDestroyed() && !chatWin.isMinimized()) chatWin.moveTop();
  });

  // 한쪽을 작업 표시줄에서 복원하면 나머지도 같이 올라온다 — 짝이 갈라지지 않는다.
  chatWin.on('restore', () => {
    if (canvasVisible && canvasWin && !canvasWin.isDestroyed() && canvasWin.isMinimized()) {
      canvasWin.restore();
      canvasWin.moveTop();
      chatWin.moveTop();
    }
  });
  canvasWin.on('restore', () => {
    if (chatWin && !chatWin.isDestroyed() && chatWin.isMinimized()) chatWin.restore();
    if (chatWin && !chatWin.isDestroyed()) chatWin.moveTop();
  });

  // Win+방향키 보너스 경로(2026-08-18) — OS 창 스냅과 같은 손버릇으로 두 창
  // 짝을 옮긴다. globalShortcut은 다른 앱과 전역 충돌 위험이 있어 쓰지 않고
  // (electron#9206), 각 창의 webContents에 before-input-event로만 건다 —
  // OS(Windows 자체 스냅)가 먼저 먹으면 이벤트가 그냥 안 올 뿐이라 무해하다.
  wireWindowsKeyShortcuts(chatWin);
  wireWindowsKeyShortcuts(canvasWin);
  wireOsSnapEvents(chatWin);
  wireOsSnapEvents(canvasWin);

  // 상단 모서리는 그립 우선(2026-08-19 결정, 질의응답) — 채팅창 상단 10px에서
  // 앱 손잡이(#grip: 클램프·유리 보간)와 OS 네이티브 엣지 리사이즈(무제한·무보간)가
  // 같은 픽셀을 놓고 경합하던 비결정성 해소. will-resize의 edge 인자로 순수 상단발
  // 리사이즈만 막는다 — 좌/우/아래와 모서리(대각)는 네이티브 자유 리사이즈 유지.
  // setBounds에는 이 이벤트가 오지 않으므로(Electron 문서) 그립 경로는 영향 없다.
  chatWin.on('will-resize', (event, newBounds, details) => {
    if (details && details.edge === 'top') event.preventDefault();
  });

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
      if (chatWin && !chatWin.isDestroyed()) {
        chatWin.webContents.send('athena:routine-event', event);
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
      if (!canvasVisible) {
        expandCanvasWindow().catch((err) => mdlog(`expandCanvasWindow(캔버스 푸시) 실패: ${String((err && err.message) || err)}`));
      }
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

// 주문 집행 프록시(P4) — 기존 3중 게이트 라우트로의 단일 전달. **무재시도**:
// 타임아웃·오류 어느 쪽도 재전송하지 않는다(중복 주문 방지 — CLAUDE.md §1).
// 로컬 베어러는 이 앱이 보관하지 않는다 — 미설정 배포에서는 백엔드가 정직하게
// 거부하고 그 상태가 티켓에 그대로 표시된다.
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
// 직접 실행하게 됐다. OS는 포커스 창 하나만 움직이므로, 그 결과 이벤트를 받아
// 앱이 짝·의미론을 정착시킨다:
//   moved + win.snapped  → OS가 어느 절반에 스냅했는지 판정해 placeWindows(left/right)로
//                          짝 전체를 그 절반의 우리 레이아웃으로 정착(크기 불변).
//   maximize             → 즉시 unmaximize하고 athena:window-key {dir:'up'}으로 렌더러의
//                          최대화 토글(□ 버튼과 동일 경로 — 모드 가드 포함)에 위임.
//   minimize             → 짝 창도 함께 내린다(복원 짝맞춤은 기존 restore 핸들러).
// settlingSnap 가드: placeWindows의 setBounds가 다시 moved를 발화시키는 재진입을 막는다.
let settlingSnap = false;

// 앱이 마지막으로 지정한 bounds. 여기서 벗어난 moved/resized는 전부 OS 주도
// (Win+←/→ 스냅 등)다 — frame:false라 사용자가 OS 경로로 창을 움직일 방법은
// 스냅뿐이고, 앱 주도 이동(드래그 폴링·setChatHeight·placeWindows·centerWindows)은
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
    noteAppBounds(win);
    // 순수 이동(크기 불변) = 네이티브 캡션 드래그(2026-08-19 표준화). 창 짝은
    // 한 몸이다 — OS는 잡힌 창 하나만 옮기므로 상대 창을 같은 델타로 정착시킨다
    // (Win+←/→ 스냅 정착과 같은 문법). 상대 창 이동은 noteAppBounds로 앱 주도
    // 표시를 하므로 서로를 되따라가는 재귀가 없다.
    const pureMove = prev
      && Math.abs(actual.width - prev.width) <= 2
      && Math.abs(actual.height - prev.height) <= 2;
    if (pureMove) {
      const dx = actual.x - prev.x;
      const dy = actual.y - prev.y;
      const other = win === chatWin ? canvasWin : chatWin;
      if (other && !other.isDestroyed() && !other.isMinimized() && (dx !== 0 || dy !== 0)) {
        const ob = other.getBounds();
        other.setBounds({ x: ob.x + dx, y: ob.y + dy, width: ob.width, height: ob.height });
        noteAppBounds(other);
      }
      syncChatAnchor();
      mdlog(`창 드래그 정착(${win === chatWin ? 'chat' : 'canvas'}): 짝 팔로우 (${dx},${dy})`);
      return;
    }
    // 사용자 모서리 리사이즈(또는 OS 주도의 기타 변형) — 새 크기·위치를 그대로
    // 수용한다. 대화 창이면 높이 앵커·수동 상태를 함께 정리한다: 높이 상태의
    // 소유자는 렌더러이므로(chat.js) manualOverride를 켜라고 알려 자동 성장이
    // 방금의 사용자 크기를 덮어쓰지 않게 한다.
    if (win === chatWin) {
      chatHeight = actual.height;
      syncChatAnchor();
      chatWin.webContents.send('athena:manual-resize');
    }
    return;
  }
  const dir = (actual.x + actual.width / 2) < (wa.x + wa.width / 2) ? 'left' : 'right';
  mdlog(`os-arrange 감지(${win === chatWin ? 'chat' : 'canvas'}): ${JSON.stringify(actual)} -> ${dir} 정착`);
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
  win.on('maximize', () => {
    if (settlingSnap) return;
    settlingSnap = true;
    mdlog('os-maximize 감지 — unmaximize 후 렌더러 최대화 토글 위임');
    // unmaximize()의 복원 setBounds는 비동기다 — 위임을 먼저 보내면 렌더러의
    // 토글 setBounds를 복원이 나중에 덮어써 "2회차 토글이 안 먹는" 경쟁이
    // 실측됐다(3차 afterUp2). 복원(unmaximize 이벤트)이 끝난 뒤에 위임한다.
    win.once('unmaximize', () => {
      setTimeout(() => {
        noteAppBounds(win);
        if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send('athena:window-key', { dir: 'up' });
      }, 80);
    });
    try { win.unmaximize(); } finally {
      setTimeout(() => { settlingSnap = false; }, 400);
    }
  });
  win.on('minimize', () => {
    // Win+↓(또는 작업 표시줄)로 한쪽만 내려가면 짝도 같이 내린다. minimize()는
    // 이미 내려간 창에는 no-op이라 상호 발화가 무한 재귀하지 않는다.
    const other = win === chatWin ? canvasWin : chatWin;
    if (win === canvasWin && !canvasVisible) return;
    if (other && !other.isDestroyed() && !other.isMinimized()) {
      if (other === canvasWin && !canvasVisible) return;
      other.minimize();
    }
  });
}

// ---------- 창 이동 — 네이티브 캡션(-webkit-app-region) (2026-08-19 표준화) ----------
// 구판은 렌더러 mousedown → 커서 폴링(athena:window-drag)으로 창을 옮겼다 —
// 지연·비네이티브 감각·가장자리 끌기 스냅 부재로 폐기(사용자 지시 "평범한
// 앱처럼"). 드래그 손잡이는 CSS가 선언한다: 대화 창 컨트롤 스트립·설정/주문
// 헤더(chat.css), 캔버스 상단 스트립 #dragStrip(canvas.css). 이동 자체는
// OS(DWM)가 수행하므로 네이티브 타이틀바와 같은 감각이고 가장자리 끌기 스냅도
// 함께 생겼다. 본문(.history)은 더 이상 손잡이가 아니다 — 텍스트 선택 복원.
// OS가 옮기는 건 잡힌 창 하나뿐이므로, 짝 정착은 handleForeignArrange의
// 순수 이동 분기가 맡는다(위 참조). 구판의 DPI 성장 버그(5e0a9ab)는 폴링
// 경로 자체가 사라져 소멸 — 검증11이 회귀 가드를 계승한다.

// ---------- 최소화(창 내리기) — 두 창을 한 몸으로 내린다. 복원은 restore 핸들러가 짝 맞춘다 ----------
ipcMain.on('athena:minimize-windows', () => {
  if (canvasVisible && canvasWin && !canvasWin.isDestroyed()) canvasWin.minimize();
  if (chatWin && !chatWin.isDestroyed()) chatWin.minimize();
});

// ---------- 창 배치(스냅) — Windows 표준 창 단축키 의미론 (2026-08-18, 최종 정본) ----------
// 목표는 자체 조합이 아니라 **Win+방향키가 이 앱에서 OS 표준 창 단축키와 같은
// 뜻으로 통하는 것**이다. 매핑은 Windows 의미론을 그대로 따른다:
//   Win+←/→ = 창 짝을 현재 디스플레이 workArea 좌/우 절반에 배치(크기 불변).
//   Win+↑   = 최대화 토글(창 제어 □ 버튼과 동일 동작 — chatBaseH↔chatMaxH).
//   Win+↓   = 최대화 상태면 복원(chatBaseH로), 아니면 두 창 최소화 — Windows의
//             "restore-then-minimize" 의미론.
//
// **높이 상태(auto-grow·manualOverride·□ 버튼 상태)의 단일 소유자는 렌더러다**
// (chat.js). main이 setChatHeight()를 직접 불러 ↑/↓를 처리하면(구판) 그 상태들과
// 어긋난다 — 예: Win+↑로 최대화해도 chat.js의 manualOverride가 안 켜져서, 다음
// 내용 변화에 자동 성장이 끼어들어 방금 최대화한 창을 자연 높이로 되감는다.
// 그래서 ↑/↓는 main이 직접 처리하지 않고 `athena:window-key`로 chatWin에 위임한다
// — chat.js가 □ 버튼과 똑같은 로컬 함수(toggleMaxHeight/restoreOrMinimize)를 탄다
// (2026-08-18 팀리드 지시). ←/→는 렌더러 상태와 무관한 순수 위치 이동이라 main이
// 여기서 직접 처리한다.
//
// 좌우 배치의 좌표 계산은 lib/main/window-placement.js(순수 함수, Electron
// 의존 없음, 단위 테스트됨)로 뺐다 — 결과를 그대로 setBounds에 먹인다. 크기는
// 항상 명시적으로 재지정한다(setBounds({x,y,width,height})) — x/y만 옮기는
// setPosition()은 DPI 배율 화면에서 반올림이 누적돼 창이 자라는 버그가 있었다
// (커밋 5e0a9ab, 드래그 폴링 L249-254와 같은 이유).
//
// 캔버스 창이 숨김 상태(canvasVisible=false)여도 setBounds()는 숨은 창을
// 보이게 만들지 않는다 — 좌표만 갱신돼 다음 dot 확장이 새 위치 기준으로 열린다.
//
// 창 생성 옵션(commonWinOpts — resizable:false 등)은 이 단계에서 건드리지
// 않는다 — before-input-event가 실측으로 안 오는 것으로 판명되면 스냅
// 대상화(thickFrame, setMinimumSize/setMaximumSize 등)를 시도할 여지를 남긴다.
// 그래서 이 배치 로직 전체를 창 생성과 독립된 함수로만 유지한다.
function placeWindows(dir) {
  if (!chatWin || chatWin.isDestroyed()) return;
  if (dir !== 'left' && dir !== 'right') return; // up/down은 렌더러가 처리한다 — 위 주석 참고
  if (!canvasWin || canvasWin.isDestroyed()) return;

  const display = screen.getDisplayMatching(chatWin.getBounds());
  const placement = computePlacement(dir, display.workArea, {
    canvasW: layout.canvasW, canvasH: layout.canvasH,
    chatW: layout.chatW, chatBaseH: layout.chatBaseH, chatHeight,
  });
  canvasWin.setBounds(placement.canvasBounds);
  chatWin.setBounds(placement.chatBounds);
  noteAppBounds(canvasWin);
  noteAppBounds(chatWin);
  chatBottom = placement.chatBottom;
  chatX = placement.chatX;
  syncChatAnchor();
}

ipcMain.on('athena:place-windows', (e, { dir } = {}) => placeWindows(dir));

// 기본 위치 복귀("center") — Win+↑/Ctrl+Alt+↑의 옛 의미론이었다(창 짝을 부팅
// 좌표로 되돌린다). 2026-08-18 Windows 표준 의미론 재정의로 그 자리는 최대화
// 토글이 대신하지만, 위치 리셋 자체는 나중에 다시 쓸 수 있어 함수로 남겨둔다
// (팀리드 지시) — 지금은 어떤 키·IPC 채널에도 매지 않는다.
function centerWindows() {
  if (!chatWin || chatWin.isDestroyed() || !canvasWin || canvasWin.isDestroyed()) return;
  canvasWin.setBounds({ x: layout.originX, y: layout.originY, width: layout.canvasW, height: layout.canvasH });
  const bottom = layout.originY + layout.canvasH + layout.chatBaseH;
  chatWin.setBounds({ x: layout.chatOriginX, y: bottom - chatHeight, width: layout.chatW, height: chatHeight });
  noteAppBounds(canvasWin);
  noteAppBounds(chatWin);
  chatBottom = bottom;
  chatX = layout.chatOriginX;
  syncChatAnchor();
}

// Win+방향키 — 1차 구현(보너스 아님, 주 경로). meta는 Windows 키(Electron의
// input.meta가 Windows에서 Win 키를 가리킨다). OS가 이 조합을 먼저 가로채면
// (실제 Windows 창 스냅) 이 핸들러엔 이벤트가 아예 안 온다 — 조합별 도달
// 여부를 mdlog로 남겨 QA 실측이 OS 선점 여부를 판정하게 한다(globalShortcut은
// 전역 충돌 위험 때문에 안 쓴다). chatWin·canvasWin 둘 다에 걸리므로(아래
// createWindows) 어느 창에서 눌려도 `win`이 아니라 모듈 스코프 `chatWin`으로
// 위임한다 — 높이 상태는 항상 대화 창 쪽에 있다.
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
    if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send('athena:window-key', { dir });
  });
}

// ---------- 닫기(백그라운드 유지) + 트레이 복귀 (AT-CH-001, 2026-08-18) ----------
// 닫기 버튼은 종료가 아니다 — 두 창을 숨기고 프로세스(세션·자격증명·감시)는 그대로
// 산다(사용자 지시 "백그라운드는 살아있음"). 숨은 창은 작업 표시줄에도 없으므로
// 복귀 경로가 반드시 필요하다 — 그게 이 트레이다(브랜드 점 아이콘, 클릭=열기).
// Alt+F4 등 OS close 이벤트는 가로채지 않는다 — 그쪽은 여전히 진짜 종료다
// (chatWin 'closed' → app.quit()). 트레이 메뉴 "종료"도 같은 길로 나간다.
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
  if (!chatWin || chatWin.isDestroyed()) return;
  // 캔버스가 세션에서 열려 있던 상태였다면 짝으로 같이 돌아온다 — 캔버스 먼저,
  // 대화 창이 위로(two-windows.md E3 z순서 계약).
  if (canvasVisible && canvasWin && !canvasWin.isDestroyed()) {
    if (canvasWin.isMinimized()) canvasWin.restore();
    canvasWin.show();
  }
  if (chatWin.isMinimized()) chatWin.restore();
  chatWin.show();
  chatWin.focus();
  chatWin.moveTop();
}

function hideToBackground() {
  if (canvasVisible && canvasWin && !canvasWin.isDestroyed()) canvasWin.hide();
  if (chatWin && !chatWin.isDestroyed()) chatWin.hide();
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

// ---------- 줌(화면 확대/축소) — 두 창 동기, Ctrl+= / Ctrl+- / Ctrl+0 / Ctrl+휠 ----------
// 창 크기는 그대로 두고 콘텐츠 배율만 바꾼다(브라우저 줌과 같은 문법). 렌더러의
// CSS px 좌표 계약이 배율만큼 어긋나는 지점은 정확히 세 곳이고 각자 보정한다:
//   높이 측정(chat.js measureNeededHeight) · 점 좌표(getDotScreenPoint) ·
//   확장 애니메이션 클립 좌표(canvas.js prime-clip/run-animation).
let uiZoom = 1;

function applyUiZoom(dir) {
  const next = dir === 'reset' ? 1 : uiZoom * (dir === 'in' ? 1.1 : 1 / 1.1);
  uiZoom = Math.min(2, Math.max(0.5, Math.round(next * 100) / 100));
  for (const w of [chatWin, canvasWin]) {
    if (w && !w.isDestroyed()) w.webContents.setZoomFactor(uiZoom);
  }
  // 배율이 바뀌면 필요한 창 높이도 바뀐다 — 렌더러가 다시 재고 요청하게 알린다.
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.webContents.send('athena:zoom-changed', { zoom: uiZoom });
  }
}

ipcMain.on('athena:zoom', (e, { dir } = {}) => applyUiZoom(dir));

// ---------- 대화 창 높이 — 위로만 자란다, 입력줄(하단)은 고정 ----------
// setChatHeight()로 뽑아낸 이유: 온보딩 완료 시("athena:onboarding-advance"가
// done:true를 돌려줄 때) 메인 프로세스가 렌더러의 요청 없이 스스로 창을
// 기본 높이로 되돌려야 한다(IPC 계약 — "when done is true, main returns the
// chat window to base height itself"). 기존 수동 리사이즈 핸들러와 정확히
// 같은 clamp·이동 로직을 공유한다.
function setChatHeight(height, { manual = false } = {}) {
  if (!chatWin || chatWin.isDestroyed()) return;
  // 수동 요청(그립 드래그·□ 복원)은 표준 최대(chatMaxH)를 넘어 workArea까지
  // 허용한다(2026-08-19 결정 — □ 토글이 "마지막 수동 높이"를 기억·복원하는
  // Windows 복원 사각형 의미론. OS 엣지 리사이즈로 chatMaxH를 넘긴 크기를 앱
  // 경로가 복원할 수 있어야 한다). 자동 성장은 여전히 chatMaxH 캡 — 내용이
  // 길다고 창이 화면을 다 먹으면 안 된다.
  const maxH = manual
    ? Math.max(layout.chatMaxH, screen.getDisplayMatching(chatWin.getBounds()).workArea.height)
    : layout.chatMaxH;
  const clamped = Math.max(layout.chatBaseH, Math.min(maxH, Math.round(height)));
  if (clamped === chatHeight) return;
  chatHeight = clamped;
  const y = chatBottom - chatHeight;
  // 폭은 더 이상 설계 상수가 아니다(2026-08-18 자유 리사이즈) — 자동 성장·모드
  // 전환이 사용자가 넓힌 폭을 layout.chatW로 되감으면 안 된다. 현재 폭을 유지한다.
  chatWin.setBounds({ x: chatX, y, width: chatWin.getBounds().width, height: chatHeight });
  noteAppBounds(chatWin);
  if (canvasVisible) chatWin.moveTop(); // 확장 시 캔버스 창 위로 올라탄다(two-windows.md E3-확장)
}

ipcMain.on('athena:set-chat-height', (e, { height, manual }) => setChatHeight(height, { manual: !!manual }));

// ---------- 점 → 캔버스 확장/수축 (spike v2.js 이식) ----------
async function getDotScreenPoint() {
  if (!chatWin || chatWin.isDestroyed()) return null;
  const rect = await chatWin.webContents.executeJavaScript(
    "(() => { const r = document.getElementById('dot').getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()"
  );
  const chatBounds = chatWin.getBounds();
  // getBoundingClientRect는 CSS px, 창 bounds는 물리 px — 줌 배율만큼 벌어진다.
  const zf = chatWin.webContents.getZoomFactor();
  return { x: chatBounds.x + rect.x * zf, y: chatBounds.y + rect.y * zf };
}

function canvasLocalFromScreen(pt) {
  const cb = canvasWin.getBounds();
  return { cx: pt.x - cb.x, cy: pt.y - cb.y };
}

function rmaxFor(cx, cy) {
  const cb = canvasWin.getBounds();
  const corners = [[0, 0], [cb.width, 0], [0, cb.height], [cb.width, cb.height]];
  return Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy)));
}

function waitForCanvasIpc(channel, timeoutMs) {
  return new Promise((resolve, reject) => {
    const onMessage = (event, data) => {
      if (!canvasWin || canvasWin.isDestroyed() || event.sender !== canvasWin.webContents) return;
      cleanup();
      resolve(data);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${channel} IPC timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      ipcMain.removeListener(channel, onMessage);
    };
    ipcMain.on(channel, onMessage);
  });
}

async function expandCanvasWindow() {
  if (!chatWin || chatWin.isDestroyed() || !canvasWin || canvasWin.isDestroyed()) return null;
  const dotScreen = await getDotScreenPoint();
  if (!dotScreen) return null;
  const { cx, cy } = canvasLocalFromScreen(dotScreen);
  const rmax = rmaxFor(cx, cy);

  const primed = waitForCanvasIpc('primed', 750);
  canvasWin.webContents.send('prime-clip', { cx, cy });
  await primed;
  canvasWin.show();
  canvasWin.moveTop();
  chatWin.moveTop();
  canvasVisible = true;

  const donePromise = waitForCanvasIpc('animation-done', 1250);
  canvasWin.webContents.send('run-animation', { cx, cy, rmax, duration: 550, mode: 'expand' });
  const result = await donePromise;
  return result;
}

async function collapseCanvasWindow() {
  if (!canvasVisible) return;
  if (!chatWin || chatWin.isDestroyed() || !canvasWin || canvasWin.isDestroyed()) return null;
  const dotScreen = await getDotScreenPoint();
  if (!dotScreen) return null;
  const { cx, cy } = canvasLocalFromScreen(dotScreen);
  const rmax = rmaxFor(cx, cy);

  const donePromise = waitForCanvasIpc('animation-done', 1250);
  canvasWin.webContents.send('run-animation', { cx, cy, rmax, duration: 550, mode: 'collapse' });
  const result = await donePromise;
  canvasWin.hide();
  canvasWin.webContents.send('athena:clear-canvases');
  canvasVisible = false;
  return result;
}

ipcMain.on('athena:collapse-canvas', () => { collapseCanvasWindow(); });
ipcMain.on('athena:highlight-canvas', (e, type) => {
  if (canvasVisible) canvasWin.webContents.send('athena:highlight-canvas', type);
});

const restPaintWaiters = new Map();
const restReceiptWaiters = new Map();

ipcMain.on('athena:rest-canvas-painted', (event, payload = {}) => {
  if (!canvasWin || canvasWin.isDestroyed() || event.sender !== canvasWin.webContents) return;
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
  waiter.resolve(paintResult);
});

ipcMain.on('athena:rest-receipt-painted', (event, payload = {}) => {
  if (!chatWin || chatWin.isDestroyed() || event.sender !== chatWin.webContents) return;
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
  if (!canvasWin || canvasWin.isDestroyed() || event.sender !== canvasWin.webContents) return;
  chartReloadAuthority.unregister(payload.panelId);
});

function emitRestReceiptAndWaitForPaint(text, { timeoutMs = 3000 } = {}) {
  if (!chatWin || chatWin.isDestroyed()) return Promise.reject(new Error('대화 창이 준비되지 않았다'));
  if (chatWin.isMinimized()) chatWin.restore();
  chatWin.show();
  chatWin.moveTop();
  chatWin.focus();
  const receiptId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      restReceiptWaiters.delete(receiptId);
      reject(new Error('REST 영수증 paint ack 3초 제한을 넘겼다'));
    }, timeoutMs);
    const cleanup = () => clearTimeout(timer);
    restReceiptWaiters.set(receiptId, { resolve, reject, cleanup });
    chatWin.webContents.send('athena:add-rest-receipt', { receiptId, text });
  });
}

async function emitRestCanvasAndWaitForPaint(payload, { expand = true, timeoutMs = 3000 } = {}) {
  if (!canvasWin || canvasWin.isDestroyed()) throw new Error('캔버스 창이 준비되지 않았다');
  // The direct REST lane has a hard three-second feedback budget. Reveal the
  // already-loaded surface immediately; the normal dot toggle retains its
  // decorative 550ms materialisation animation.
  if (expand && !canvasVisible) {
    canvasWin.show();
    canvasWin.moveTop();
    if (chatWin && !chatWin.isDestroyed()) chatWin.moveTop();
    canvasVisible = true;
  }
  // Recover a minimized surface without changing application focus. The
  // renderer uses backgroundThrottling:false and the paint contract itself
  // verifies a visible, nonzero card followed by two animation frames.
  if (canvasWin.isMinimized()) canvasWin.restore();
  if (!canvasWin.isVisible()) canvasWin.showInactive();
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
    canvasWin.webContents.send('athena:add-rest-canvas', {
      envelope: payload.envelope,
      operationRef: payload.operationRef,
      operationArgs: payload.operationArgs,
      canvasType: payload.canvasType,
    });
  });
}

// ---------- athena__render_canvas — 결정 D1의 실배선 + 명시적 픽스처 어댑터 ----------
// 두 경로가 여기서 갈린다(plan/kiwoom-common-screen-handoff.md §6 — HTTP/WebSocket
// adapter와 명시적 fixture adapter를 분리하라는 지시 그대로):
//   source:'fixture' → 기존 목업 경로. spike/captures/*.json을 lib/mockdata.js가
//                       읽는다. **명시적으로 선택했을 때만** 탄다 — verify.js가
//                       ATHENA_CANVAS_SOURCE=fixture로 이 경로를 강제해서 quota
//                       없이 결정론적으로 검증한다.
//   그 외(기본값)      → 실배선. claude -p를 스폰해 실제 게이트웨이를 왕복한다.
let liveMcpConfig = null; // 지연 생성 — app.getPath('userData')는 whenReady 이후에만 안전

function getLiveMcpConfig() {
  if (!liveMcpConfig) liveMcpConfig = ensureMcpConfig(app.getPath('userData'));
  return liveMcpConfig;
}

// 캔버스 결과 하나(stream-json-parser.classifyCanvasBlock의 출력)를 캔버스
// 창으로 보낸다. 렌더러(canvas.js)가 status별로 카드를 그리거나 안내를 띄운다.
function sendLiveCanvasResult(result) {
  if (canvasWin && !canvasWin.isDestroyed()) {
    canvasWin.webContents.send('athena:add-canvas-live', result);
  }
  if (chatWin && !chatWin.isDestroyed()) {
    // 대화 창의 3상태 표시가 실제 진행을 보여줄 수 있도록 카드 하나가 뜰 때마다
    // 알린다 — 43초짜리 왕복 동안 조용히 멈춘 것처럼 보이면 안 된다(오케스트레이터 지시).
    chatWin.webContents.send('athena:live-canvas-added', { status: result.status });
  }
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

// 저장 실패를 렌더러의 "기록 안 됨" 배지로 전달(계획 §2(g), 함정 ⑫ — messageId/role만
// 싣고 본문은 절대 넘기지 않는다).
function emitHistorySaveFailed({ messageId, role }) {
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.webContents.send('athena:history-save-failed', { messageId, role });
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
  if (!canvasWin || canvasWin.isDestroyed() || event.sender !== canvasWin.webContents) {
    throw new Error('AITS chart reload는 캔버스 창에서만 허용된다');
  }
  const request = chartReloadAuthority.buildDataset(payload);
  const result = await runDirectRestDataset(request, false, { skipHistory: true });
  return chartReloadAuthority.acceptResult(request, result);
}

ipcMain.handle('athena:reload-chart-panel', handleChartPanelReload);

async function runLiveQuery(query, expand) {
  const directDataset = restDatasetRunner.buildQuoteDataset(query, stockEntityIndex, {
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
  // 판정 캡처(시맨틱 캐시 재료) — tool_use_id로 resolve 결과 토큰과 render 입력
  // 토큰을 상관시킨다. 마지막 입력끼리 우연히 결합하지 않는다.
  const replayTurnCapture = new ReplayTurnCapture();
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
    onEvent: (ev) => replayTurnCapture.observe(ev),
    onCanvasResult: (r) => {
      if (r.status === 'pushed') {
        // 카드는 사이드 채널(startCanvasFeed)로 이미 도착했다 — 여기선 집계만.
        if (r.envelope && r.envelope.canvas_type) canvasTypesSeen.push(r.envelope.canvas_type);
        return;
      }
      if (expand && !expandTriggered && !canvasVisible) {
        expandTriggered = true;
        // fire-and-forget — 카드 전송을 막지 않는다. 실패는 콘솔에 안 뜨고
        // 조용히 삼켜지던 unhandledRejection이었다 — mdlog로 남긴다.
        expandCanvasWindow().catch((err) => mdlog(`expandCanvasWindow 실패: ${String((err && err.message) || err)}`));
      }
      sendLiveCanvasResult(r);
      if (r.envelope && r.envelope.canvas_type) canvasTypesSeen.push(r.envelope.canvas_type);
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
    if (expand && !canvasVisible) await expandCanvasWindow();
    canvasWin.webContents.send('athena:add-canvas', { type });
    return { ok: true, source: 'fixture', type };
  }
  const { query, expand } = payload;
  if (!query || !String(query).trim()) {
    return { ok: false, source: 'live', error: '질의가 비어 있다' };
  }
  return runLiveQuery(query, expand);
});

// ---------------------------------------------------------------------------
// 채팅→그래프 파이프라인 단계 5 — 커맨드바 HISTORY_COMMAND + 설정 모드
// "성향・이력"(.omc/plans/plan-chat-graph-pipeline.md §2(e)/(f)). LLM을 거치지
// 않는다 — chat.js가 정규식으로 직접 가로챈 뒤 이 IPC로 backend를 조회/조작한다.
// history-sink.js가 이미 쥔 backend URL·bearer 토큰 접근을 그대로 재사용한다
// (CLAUDE.md §0 "자격증명은 프로세스 메모리에만" — 여기서 새로 읽지 않는다).
// ---------------------------------------------------------------------------

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
  if (payload.expand && !canvasVisible) await expandCanvasWindow();
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
  const result = onboarding.advance(step);
  if (result.done) setChatHeight(layout.chatBaseH); // 계약: main이 스스로 기본 높이로 되돌린다
  return result;
}

ipcMain.handle('athena:onboarding-state', handleOnboardingState);
ipcMain.handle('athena:onboarding-advance', handleOnboardingAdvance);

// ---------------------------------------------------------------------------
// 화면 설정 (autoExpandCanvas/autoGrowChat) — 복구된 baa7e0e 계약(2026-08-18,
// app/README.md L599-608 참조). IPC 채널 이름·set 시 chatWin 브로드캐스트는
// 원본 그대로다 — 저장 파일명만 athena-prefs.json 관례로 바꿨다(lib/main/prefs.js).
// ---------------------------------------------------------------------------

function handlePrefsGet() {
  return prefs.get();
}

function handlePrefsSet(e, patch) {
  const next = prefs.set(patch || {});
  // 설정 카드는 대화 창 안의 같은 렌더러다(#settings 패널) — 그래도 원본과 같이
  // chatWin에 명시적으로 방송한다. 다른 진입점이 생겨도 이 계약이 그대로 맞는다.
  if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send('athena:prefs-changed', next);
  // fontSize(2026-08-19)는 캔버스 창 텍스트에도 적용된다 — 두 창 모두에 방송.
  if (canvasWin && !canvasWin.isDestroyed()) canvasWin.webContents.send('athena:prefs-changed', next);
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
// 담당한다(prefs와 같은 문법 — chatWin이 같은 렌더러의 #settings 패널이라도
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
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.webContents.send('athena:model-changed', state);
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
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.webContents.send('athena:cli-changed', cliAccounts.list());
  }
}

// 로그인은 사용자가 별도 콘솔 창에서 완료한다(브라우저 로그인 연동 방식 자체가
// 스펙 미정 — plan/paper-specs/AT-SY-002-온보딩-CLI연결.md §Open questions 4).
// 이 프로세스는 완료 시점을 콜백으로 알 방법이 없으므로, 로그인 창을 띄운
// 뒤 최대 60초간 2초 간격으로 목록을 다시 훑어(detectAndMerge) 변화가 보이면
// 그때 한 번 athena:cli-changed를 쏜다 — 진짜 이벤트 기반 알림이 아니라
// 최선 노력의 폴링이다. 정확한 콜백 메커니즘은 §7-3 열린 질문으로 남는다.
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

ipcMain.handle('athena:account-list', handleAccountList);
ipcMain.handle('athena:account-register', handleAccountRegister);
ipcMain.handle('athena:account-set-active', handleAccountSetActive);
ipcMain.handle('athena:account-remove', handleAccountRemove);
ipcMain.handle('athena:order-api-set', handleOrderApiSet);
ipcMain.handle('athena:auth-token-status', handleAuthTokenStatus);
ipcMain.handle('athena:auth-token-refresh', handleAuthTokenRefresh);
ipcMain.handle('athena:auth-token-revoke', handleAuthTokenRevoke);

accounts.onTokenChange((payload) => {
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.webContents.send('athena:auth-token-changed', payload);
  }
});

// ---------------------------------------------------------------------------
// MCP (AT-ST-004/005/006) — backend/athena_mcp CLI를 감싼다, 재구현하지 않는다.
// ---------------------------------------------------------------------------

// SECURITY.md §6 — mcp-list 호출마다 평문 env를 발견하면 마이그레이션한다.
// migratePlaintextEnv()는 멱등이라(이미 센티널이면 즉시 no-op) 매번 불러도
// 비용이 거의 없다. 마이그레이션 실패(예: safeStorage 불가)는 리스트 자체를
// 막지 않는다 — 평문 상태로라도 서버 목록은 계속 보여야 한다.
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

// `require.main === module`은 Electron이 앱 진입점을 로드할 때 신뢰할 수 없다 —
// 실측으로 확인: `electron .`(=npm start)로 띄워도 Electron의 내부 부트스트랩
// 로더가 require.main을 이 모듈로 설정해주지 않아 항상 false였다. 그 결과
// createWindows()가 한 번도 호출되지 않아 `npm start`가 창 없이 조용히 멈추는
// 버그가 있었다(프로세스는 뜨지만 windows는 전혀 생성되지 않음 — W2 검증 중 발견).
// verify.js가 main.js를 라이브러리로 require할 때만 자동 기동을 끄도록
// 명시적 환경변수로 분기한다.
// 부팅 시에도 한 번 마이그레이션을 시도한다(SECURITY.md §6) — 설정 화면을
// 한 번도 안 열어 mcp-list가 호출되지 않아도, claude -p의 첫 왕복 전에 최대한
// 일찍 평문을 지운다. createWindows()를 막지 않는다 — fire-and-forget이고
// 실패해도(멱등이라 다음 mcp-list/부팅에서 재시도된다) 창 생성과 무관하다.
if (!process.env.ATHENA_NO_AUTOSTART) {
  app.whenReady().then(() => {
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
  expandCanvasWindow,
  collapseCanvasWindow,
  emitRestCanvasAndWaitForPaint,
  emitRestReceiptAndWaitForPaint,
  runDirectRestDataset,
  getStockEntityIndex: () => stockEntityIndex,
  getDotScreenPoint,
  getWins: () => ({ chatWin, canvasWin }),
  getLayout: () => layout,
  // 트레이 클릭과 동일한 복귀 경로 — verify.js가 닫기(백그라운드 유지)를 검증할 때
  // 실제 트레이 클릭을 자동화할 수 없어 같은 함수 참조를 직접 부른다.
  restoreFromBackground,
  // OS 배치 감지의 기준점 갱신 — verify.js가 창을 직접 setBounds로 움직이는
  // 검증(독립성 등)에서는 그 이동이 "앱 주도"임을 이걸로 표시해야 한다. 안 하면
  // handleForeignArrange가 OS 스냅으로 오인해 짝을 정착시킨다(설계된 동작).
  noteAppBounds,
  // 창 배치 — verify.js 검증14(창 배치)가 좌/우/센터를 직접 구동한다. 위/아래는
  // 렌더러가 소유하므로(위 주석) chatWin에 athena:window-key를 보내 검증한다.
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
