// S1 검증 2 — 점 → 캔버스 확장 모션. 창 크기는 애니메이션하지 않는다.
// 캔버스 창은 처음부터 최종 크기(1560x800)로 존재, show/hide만 한다.
// 실제 스크린 좌표의 "점"에서 clip-path circle 마스크로 확장, blur 변조 동시 적용.
// requestAnimationFrame 타임스탬프를 수집해 p50/p95/최악 프레임 간격을 실측한다.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const CAPTURES = path.join(__dirname, 'captures');
if (!fs.existsSync(CAPTURES)) fs.mkdirSync(CAPTURES, { recursive: true });

const SCREEN = { width: 1920, height: 1200 }; // measured via PowerShell earlier
// 실측 결과: 이 실행 환경에서는 창 top-edge y좌표가 대략 700~800px 지점을 넘어가면
// 실제 OS 데스크톱 화면에 topmost로 합성되지 않는 현상이 재현됨(alwaysOnTop 무관, check-zorder.js로 격리 검증).
// 원인은 이 세션이 공유 대화형 데스크톱이라는 점으로 추정되나 확정하지 못했음 — RESULT.md "막힌 것" 참조.
// 따라서 검증2(온스크린 캡처)에 한해 캔버스+대화창 레이아웃을 0.7배로 축소해 대화창 top-edge를 안전 구간(<700) 안에 둔다.
// 폭(1560)은 문제가 아니었으므로 그대로 유지, 세로만 축소한다. 실제 설계 치수는 1560x800 / 1560x204 그대로다 — 이건 캡처 검증용 축소일 뿐.
const SCALE = 0.7;
const CANVAS_W = 1560, CANVAS_H = Math.round(800 * SCALE); // 560
const CHAT_W = 1560, CHAT_H = Math.round(204 * SCALE); // 143
const ORIGIN_X = Math.floor((SCREEN.width - CANVAS_W) / 2);
const ORIGIN_Y = 0;

const CANVAS_BOUNDS = { x: ORIGIN_X, y: ORIGIN_Y, width: CANVAS_W, height: CANVAS_H };
const CHAT_BOUNDS = { x: ORIGIN_X, y: ORIGIN_Y + CANVAS_H, width: CHAT_W, height: CHAT_H };
const DOT_LOCAL = { x: Math.floor(CHAT_W / 2) - 700, y: 24 }; // near seam, left-ish per chat.html layout (dot is ~28px from left of a flex row); recomputed below more precisely

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function captureRegion(bounds, outFile) {
  const script = path.join(__dirname, 'scripts', 'capture.ps1');
  execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script,
    '-x', String(bounds.x), '-y', String(bounds.y),
    '-w', String(bounds.width), '-h', String(bounds.height),
    '-out', outFile
  ], { stdio: 'inherit', windowsHide: true });
}

app.on('window-all-closed', () => {
  // warmup 창을 닫는 순간 다른 창이 아직 없으면 Electron 기본 동작으로 앱이 조용히 종료됨.
  // 명시적으로 막는다 (v1.js와 동일 패턴).
});

const DEBUGLOG = path.join(__dirname, 'captures', 'v2-debug.log');
fs.writeFileSync(DEBUGLOG, `start ${new Date().toISOString()}\n`);
function dlog(msg) { fs.appendFileSync(DEBUGLOG, `${new Date().toISOString()} ${msg}\n`); }

app.whenReady().then(async () => {
  dlog('whenReady fired');
  // 실측 발견: 이 환경에서는 프로세스가 만든 "첫 번째" show()된 창은 실제 데스크톱 화면에
  // topmost로 합성되지 않는 경우가 재현됨(Windows 포그라운드 활성화 제한 추정, check-zorder.js로 격리 검증).
  // 두 번째 이후 창은 성공. 더미 창을 하나 먼저 띄웠다 닫아 "첫 시도"를 소모한다.
  const warmup = new BrowserWindow({ x: 10, y: 10, width: 10, height: 10, show: false, frame: false });
  warmup.loadURL('data:text/html,<body></body>');
  await new Promise((r) => warmup.once('ready-to-show', r));
  warmup.show();
  await wait(1800); // 실측: 프로세스 시작 후 일정 유예시간이 지나야 후속 창의 topmost 승격이 안정적으로 성공함 (Windows 포그라운드 활성화 유예 추정)
  warmup.close();
  await wait(100);

  const chatWin = new BrowserWindow({
    ...CHAT_BOUNDS, frame: false, resizable: false, show: false,
    transparent: true, backgroundColor: '#00000000', alwaysOnTop: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  chatWin.loadFile('chat.html');

  const canvasWin = new BrowserWindow({
    ...CANVAS_BOUNDS, frame: false, resizable: false, show: false,
    transparent: true, backgroundColor: '#00000000', alwaysOnTop: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  canvasWin.loadFile('canvas.html');

  await Promise.all([
    new Promise((r) => chatWin.once('ready-to-show', r)),
    new Promise((r) => canvasWin.once('ready-to-show', r)),
  ]);

  // R1: 부팅 시 대화 창만 보인다.
  await chatWin.webContents.executeJavaScript('1'); // renderer를 한 번 깨워 활성화 승격을 유도 (실측 기반 워크어라운드)
  chatWin.show();
  chatWin.focus();
  chatWin.moveTop();
  await wait(400);
  dlog('before captureRegion chat-only');
  captureRegion(CHAT_BOUNDS, path.join(CAPTURES, 'S1-v2-00-chat-only.png'));
  dlog('after captureRegion chat-only, before capturePage');
  const chatImg = await chatWin.webContents.capturePage();
  dlog('after capturePage, size=' + JSON.stringify(chatImg.getSize()));
  fs.writeFileSync(path.join(CAPTURES, 'S1-v2-00-chat-only-webcontents.png'), chatImg.toPNG());
  dlog('after writeFileSync webcontents png');

  // dot의 실제 로컬 좌표를 DOM에서 읽어 화면좌표로 환산한다 (하드코딩 금지)
  const dotRect = await chatWin.webContents.executeJavaScript(
    "(() => { const r = document.getElementById('dot').getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()"
  );
  const dotScreen = { x: CHAT_BOUNDS.x + dotRect.x, y: CHAT_BOUNDS.y + dotRect.y };
  const cx = dotScreen.x - CANVAS_BOUNDS.x;
  const cy = dotScreen.y - CANVAS_BOUNDS.y; // will be > CANVAS_H (dot sits below canvas window, in chat window)
  const corners = [
    [0, 0], [CANVAS_W, 0], [0, CANVAS_H], [CANVAS_W, CANVAS_H],
  ];
  const rmax = Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy)));

  console.log('dot screen coords:', dotScreen, 'canvas-local:', { cx, cy }, 'rmax:', rmax);

  // prime clip to r=0 before showing canvas window (no flash of full content)
  await new Promise((resolve) => {
    ipcMain.once('primed', resolve);
    canvasWin.webContents.send('prime-clip', { cx, cy });
  });
  canvasWin.show();
  canvasWin.moveTop();
  await wait(150);

  const DURATION = 550;
  const results = {};

  // EXPAND
  const expandPromise = new Promise((resolve) => {
    ipcMain.once('animation-done', (e, data) => resolve(data));
  });
  canvasWin.webContents.send('run-animation', { cx, cy, rmax, duration: DURATION, mode: 'expand' });
  results.expand = await expandPromise;

  await wait(300);
  captureRegion(
    { x: ORIGIN_X, y: ORIGIN_Y, width: CANVAS_W, height: CANVAS_H + CHAT_H },
    path.join(CAPTURES, 'S1-v2-01-expanded-full.png')
  );
  fs.writeFileSync(path.join(CAPTURES, 'S1-v2-01-expanded-webcontents.png'), (await canvasWin.webContents.capturePage()).toPNG());

  await wait(500);

  // COLLAPSE (역방향, 참고용)
  const collapsePromise = new Promise((resolve) => {
    ipcMain.once('animation-done', (e, data) => resolve(data));
  });
  canvasWin.webContents.send('run-animation', { cx, cy, rmax, duration: DURATION, mode: 'collapse' });
  results.collapse = await collapsePromise;

  await wait(200);
  captureRegion(CHAT_BOUNDS, path.join(CAPTURES, 'S1-v2-02-collapsed-back-to-chat.png'));

  // compute stats
  function stats(timestamps) {
    const deltas = [];
    for (let i = 1; i < timestamps.length; i++) deltas.push(timestamps[i] - timestamps[i - 1]);
    const sorted = [...deltas].sort((a, b) => a - b);
    const pct = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null;
    return {
      frameCount: timestamps.length,
      deltaCount: deltas.length,
      p50: pct(50),
      p95: pct(95),
      max: sorted.length ? sorted[sorted.length - 1] : null,
      min: sorted.length ? sorted[0] : null,
      mean: deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null,
      raw_deltas_ms: deltas,
    };
  }

  const output = {
    meta: {
      canvasBounds: CANVAS_BOUNDS,
      chatBounds: CHAT_BOUNDS,
      dotScreen, dotCanvasLocal: { cx, cy }, rmax, durationMs: DURATION,
      note: '캔버스 창은 처음부터 1560x800로 생성, show() 1회만 호출. 애니메이션은 clip-path circle 반경 + backdrop-filter blur 변조. setBounds 미사용.',
    },
    expand: stats(results.expand.timestamps),
    collapse: stats(results.collapse.timestamps),
  };
  fs.writeFileSync(path.join(CAPTURES, 'S1-frames.json'), JSON.stringify(output, null, 2));
  console.log('=== EXPAND stats ===', JSON.stringify({ p50: output.expand.p50, p95: output.expand.p95, max: output.expand.max, frameCount: output.expand.frameCount }, null, 2));
  console.log('=== COLLAPSE stats ===', JSON.stringify({ p50: output.collapse.p50, p95: output.collapse.p95, max: output.collapse.max, frameCount: output.collapse.frameCount }, null, 2));

  chatWin.close();
  canvasWin.close();
  app.quit();
});
