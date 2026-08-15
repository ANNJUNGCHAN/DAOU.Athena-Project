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
let chatWin, canvasWin;
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
};
