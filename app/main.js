// Athena W2 — 두 창 Electron 셸. spike/electron-glass/v2.js·v3.js 이식.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

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

// ---------- 설계 치수 (ui/round-1R/two-windows.md E3 확정안) ----------
const DESIGN = {
  canvasW: 1560, canvasH: 800,
  chatW: 1560, chatBaseH: 204, chatMaxH: 788,
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
  return { scale, screen: { sw, sh }, canvasW, canvasH, chatW, chatBaseH, chatMaxH, originX, originY };
}

let layout;
let chatWin, canvasWin, settingsWin;
let chatHeight;
let chatBottom; // 입력줄이 고정되는 화면 y좌표 — 위로만 자란다
let canvasVisible = false;

function commonWinOpts(bounds) {
  return {
    ...bounds,
    frame: false,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    // S1 실측(spike/electron-glass/RESULT.md): backgroundMaterial:'acrylic' 단독으로
    // "뒤가 비치며 블러"가 성립한다. transparent:true는 기본으로 켜지 않는다(W2 지시) —
    // 블러 없는 완전 투명만 주기 때문.
    backgroundMaterial: 'acrylic',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  };
}

async function createWindows() {
  mdlog('createWindows start');
  layout = computeLayout();
  chatBottom = layout.originY + layout.canvasH + layout.chatBaseH;
  chatHeight = layout.chatBaseH;
  mdlog('layout computed ' + JSON.stringify(layout));

  // S1에서 발견된 환경 이슈: 프로세스의 "첫 번째" show()된 창이 OS 합성에서
  // topmost로 안정적으로 올라오지 않는 경우가 있었다. 워밍업 창으로 우회.
  const warmup = new BrowserWindow({ x: 10, y: 10, width: 10, height: 10, show: false, frame: false });
  warmup.loadURL('data:text/html,<body></body>');
  mdlog('warmup created, waiting ready-to-show');
  await new Promise((r) => warmup.once('ready-to-show', r));
  mdlog('warmup ready-to-show fired');
  warmup.show();
  await wait(300);
  warmup.close();
  await wait(80);
  mdlog('warmup done, creating canvasWin');

  canvasWin = new BrowserWindow(commonWinOpts({
    x: layout.originX, y: layout.originY, width: layout.canvasW, height: layout.canvasH,
  }));
  canvasWin.loadFile('canvas.html');
  mdlog('canvasWin created + loadFile called');

  chatWin = new BrowserWindow(commonWinOpts({
    x: layout.originX, y: chatBottom - chatHeight, width: layout.chatW, height: chatHeight,
  }));
  chatWin.loadFile('chat.html');
  mdlog('chatWin created + loadFile called');

  await Promise.all([
    new Promise((r) => canvasWin.once('ready-to-show', r)),
    new Promise((r) => chatWin.once('ready-to-show', r)),
  ]);
  mdlog('both ready-to-show fired');

  // R1(W2 지시): 부팅 시 대화 창만 뜬다. 캔버스 창은 존재하되 숨어 있다(최종 크기로 생성됨, show() 안 함).
  await chatWin.webContents.executeJavaScript('1');
  mdlog('chatWin executeJavaScript done');
  chatWin.show();
  chatWin.focus();
  chatWin.moveTop();

  chatWin.webContents.send('athena:init', {
    scale: layout.scale, chatBaseH: layout.chatBaseH, chatMaxH: layout.chatMaxH,
  });

  chatWin.on('closed', () => app.quit());
  canvasWin.on('closed', () => { canvasVisible = false; });
}

// ---------- 대화 창 높이 — 위로만 자란다, 입력줄(하단)은 고정 ----------
ipcMain.on('athena:set-chat-height', (e, { height, manual }) => {
  if (!chatWin || chatWin.isDestroyed()) return;
  const clamped = Math.max(layout.chatBaseH, Math.min(layout.chatMaxH, Math.round(height)));
  if (clamped === chatHeight) return;
  chatHeight = clamped;
  const y = chatBottom - chatHeight;
  chatWin.setBounds({ x: layout.originX, y, width: layout.chatW, height: chatHeight });
  if (canvasVisible) chatWin.moveTop(); // 확장 시 캔버스 창 위로 올라탄다(two-windows.md E3-확장)
});

// ---------- 점 → 캔버스 확장/수축 (spike v2.js 이식) ----------
async function getDotScreenPoint() {
  const rect = await chatWin.webContents.executeJavaScript(
    "(() => { const r = document.getElementById('dot').getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()"
  );
  const chatBounds = chatWin.getBounds();
  return { x: chatBounds.x + rect.x, y: chatBounds.y + rect.y };
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

async function expandCanvasWindow() {
  const dotScreen = await getDotScreenPoint();
  const { cx, cy } = canvasLocalFromScreen(dotScreen);
  const rmax = rmaxFor(cx, cy);

  await new Promise((resolve) => {
    ipcMain.once('primed', resolve);
    canvasWin.webContents.send('prime-clip', { cx, cy });
  });
  canvasWin.show();
  canvasWin.moveTop();
  chatWin.moveTop();
  canvasVisible = true;

  const donePromise = new Promise((resolve) => ipcMain.once('animation-done', (e, data) => resolve(data)));
  canvasWin.webContents.send('run-animation', { cx, cy, rmax, duration: 550, mode: 'expand' });
  const result = await donePromise;
  return result;
}

async function collapseCanvasWindow() {
  if (!canvasVisible) return;
  const dotScreen = await getDotScreenPoint();
  const { cx, cy } = canvasLocalFromScreen(dotScreen);
  const rmax = rmaxFor(cx, cy);

  const donePromise = new Promise((resolve) => ipcMain.once('animation-done', (e, data) => resolve(data)));
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

// ==================== 설정 ====================
// 렌더러는 백엔드 주소도 bearer 토큰도 알지 못한다. 이 파일 안에서만 읽고 쓴다.
// 렌더러로 나가는 것은 표시용 상태({backendReachable, configured, ready, expiresAt})뿐이다.

const BACKEND_BASE_URL = (process.env.ATHENA_BACKEND_BASE_URL || 'http://127.0.0.1:8010').replace(/\/+$/, '');
const PREFS_FILE = () => path.join(app.getPath('userData'), 'settings.json');

// 비민감 값만 디스크에 쓴다. 자격증명·토큰은 절대 여기 들어오지 않는다
// (backend/athena_api/kiwoom/auth.py의 "메모리 전용" 불변식을 앱 쪽에서도 지킨다).
const PREF_DEFAULTS = { autoExpandCanvas: true, autoGrowChat: true };

function readPrefs() {
  try {
    const raw = JSON.parse(fs.readFileSync(PREFS_FILE(), 'utf8'));
    const out = { ...PREF_DEFAULTS };
    for (const key of Object.keys(PREF_DEFAULTS)) {
      if (typeof raw[key] === 'boolean') out[key] = raw[key];
    }
    return out;
  } catch {
    return { ...PREF_DEFAULTS };
  }
}

function writePrefs(patch) {
  const next = { ...readPrefs() };
  for (const key of Object.keys(PREF_DEFAULTS)) {
    if (typeof patch[key] === 'boolean') next[key] = patch[key];
  }
  try {
    fs.mkdirSync(path.dirname(PREFS_FILE()), { recursive: true });
    fs.writeFileSync(PREFS_FILE(), JSON.stringify(next, null, 2));
  } catch (err) {
    mdlog('writePrefs failed: ' + err.message);
  }
  return next;
}

function bearerToken() {
  const t = (process.env.ATHENA_LOCAL_BEARER_TOKEN || '').trim();
  return t || null;
}

async function backendRequest(method, route, body) {
  const token = bearerToken();
  if (!token) {
    return {
      ok: false,
      error: 'ATHENA_LOCAL_BEARER_TOKEN이 없다. 백엔드와 같은 값을 Electron 프로세스에도 넣어야 한다.',
    };
  }
  try {
    const res = await fetch(`${BACKEND_BASE_URL}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    let payload = null;
    try { payload = await res.json(); } catch { payload = null; }
    if (!res.ok) {
      const detail = payload && (payload.detail || payload.message);
      return { ok: false, status: res.status, error: detail ? String(detail) : `HTTP ${res.status}` };
    }
    return { ok: true, payload };
  } catch (err) {
    return { ok: false, error: err && err.name === 'TimeoutError' ? '백엔드 응답이 없다(8초 초과).' : String(err.message || err) };
  }
}

async function readOAuthStatus() {
  const r = await backendRequest('GET', '/api/v1/internal/oauth/status');
  if (!r.ok) return { backendReachable: false, configured: false, ready: false, expiresAt: null, error: r.error };
  const p = r.payload || {};
  return {
    backendReachable: true,
    configured: !!p.configured,
    ready: !!p.ready,
    expiresAt: p.expires_at || null,
  };
}

ipcMain.handle('athena:settings:status', async () => readOAuthStatus());

// 토큰 발급/폐기 — 사용자가 버튼을 눌렀을 때만. 창 열기·닫기·새로고침은 이 경로에 닿지 않는다.
// 화면에는 TR ID(au10001/au10002)를 노출하지 않는다 — 여기서만 쓴다.
ipcMain.handle('athena:settings:token', async (e, { action } = {}) => {
  if (action !== 'issue' && action !== 'revoke') {
    return { ...(await readOAuthStatus()), ok: false, error: '알 수 없는 동작이다.' };
  }
  const trId = action === 'issue' ? 'au10001' : 'au10002';
  const r = await backendRequest('POST', `/api/v1/internal/oauth/${trId}`);
  const status = await readOAuthStatus();
  if (!r.ok) return { ...status, ok: false, error: r.error };
  return { ...status, ok: true };
});

// app.getName()/getVersion()은 `electron verify.js`처럼 앱 경로가 Electron 자신일 때
// "Electron"/Electron 버전을 돌려준다(실측으로 확인 — 정보 줄이 "Electron 43.4.0 · Electron 43.4.0"이 됐다).
// package.json을 직접 읽어 셸 자신의 이름·버전을 쓴다.
function shellPackage() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  } catch {
    return { name: app.getName(), version: app.getVersion() };
  }
}

ipcMain.handle('athena:settings:info', async () => ({
  name: shellPackage().name,
  version: shellPackage().version,
  electron: process.versions.electron,
  backendBaseUrl: BACKEND_BASE_URL,
  layout: layout
    ? { canvasW: layout.canvasW, canvasH: layout.canvasH, chatW: layout.chatW, chatBaseH: layout.chatBaseH, scale: layout.scale }
    : { canvasW: DESIGN.canvasW, canvasH: DESIGN.canvasH, chatW: DESIGN.chatW, chatBaseH: DESIGN.chatBaseH, scale: 1 },
}));

ipcMain.handle('athena:settings:prefs:get', async () => readPrefs());
ipcMain.handle('athena:settings:prefs:set', async (e, patch) => {
  const next = writePrefs(patch || {});
  // 대화 창은 이 값을 읽어 동작을 바꾼다 — 설정 창이 바꾸면 즉시 알린다.
  if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send('athena:prefs-changed', next);
  return next;
});

// ---------- 설정 창 — 대화 창과도 캔버스 창과도 별개인 독립 창 ----------
// 이 창은 처음부터 안전 설정으로 태어난다: nodeIntegration:false, contextIsolation:true,
// sandbox:true. 기존 두 창(nodeIntegration:true)과 달리 preload가 노출하는 좁은 API만 쓴다.
// 높이 620 — 560에서는 '정보' 섹션 마지막 행(설계 치수)이 잘려 스크롤이 생겼다(실측).
const SETTINGS_DESIGN = { w: 720, h: 620 };

function notifyDotState(open) {
  if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send('athena:settings-window', { open });
}

function createSettingsWindow() {
  // 단일 인스턴스 — 이미 있으면 새로 만들지 않고 앞으로 가져온다.
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    settingsWin.moveTop();
    return settingsWin;
  }
  const scale = layout ? layout.scale : 1;
  const w = Math.round(SETTINGS_DESIGN.w * scale);
  const h = Math.round(SETTINGS_DESIGN.h * scale);
  // 캔버스 영역 중앙에 띄운다(캔버스가 숨어 있어도 그 자리를 기준으로 삼는다).
  const x = layout ? layout.originX + Math.round((layout.canvasW - w) / 2) : 100;
  const y = layout ? layout.originY + Math.round((layout.canvasH - h) / 2) : 100;

  settingsWin = new BrowserWindow({
    x, y, width: w, height: h,
    frame: false,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  settingsWin.loadFile('settings.html');
  settingsWin.once('ready-to-show', () => {
    settingsWin.show();
    settingsWin.focus();
    settingsWin.moveTop();
    notifyDotState(true);
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
    notifyDotState(false);
  });
  mdlog('settingsWin created');
  return settingsWin;
}

function closeSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
}

ipcMain.on('athena:open-settings', () => { createSettingsWindow(); });
ipcMain.on('athena:settings:close', () => { closeSettingsWindow(); });

// ---------- athena__render_canvas — 나중에 실제 MCP 툴 호출로 대체될 인터페이스 ----------
// 지금은 개발용 트리거(대화 창의 Enter)가 이 모양으로 호출한다.
ipcMain.handle('athena__render_canvas', async (e, { type, mock, expand }) => {
  if (expand && !canvasVisible) {
    await expandCanvasWindow();
  }
  canvasWin.webContents.send('athena:add-canvas', { type });
  return { ok: true, type, mock: !!mock };
});

// `require.main === module`은 Electron이 앱 진입점을 로드할 때 신뢰할 수 없다 —
// 실측으로 확인: `electron .`(=npm start)로 띄워도 Electron의 내부 부트스트랩
// 로더가 require.main을 이 모듈로 설정해주지 않아 항상 false였다. 그 결과
// createWindows()가 한 번도 호출되지 않아 `npm start`가 창 없이 조용히 멈추는
// 버그가 있었다(프로세스는 뜨지만 windows는 전혀 생성되지 않음 — W2 검증 중 발견).
// verify.js가 main.js를 라이브러리로 require할 때만 자동 기동을 끄도록
// 명시적 환경변수로 분기한다.
if (!process.env.ATHENA_NO_AUTOSTART) {
  app.whenReady().then(createWindows);
}

// verify.js에서 재사용 (require로 로드될 때는 자동 기동하지 않는다)
module.exports = {
  computeLayout,
  createWindows,
  expandCanvasWindow,
  collapseCanvasWindow,
  getDotScreenPoint,
  getWins: () => ({ chatWin, canvasWin }),
  getLayout: () => layout,
  // 설정 — verify.js가 백엔드 없이도 계약을 검사할 수 있게 노출한다
  readPrefs,
  writePrefs,
  readOAuthStatus,
  getBackendBaseUrl: () => BACKEND_BASE_URL,
  createSettingsWindow,
  closeSettingsWindow,
  getSettingsWin: () => settingsWin,
};
