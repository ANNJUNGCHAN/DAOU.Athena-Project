// S1 검증 3 — 두 창 배치. 캔버스 창 1560x800(위) + 대화 창 1560x204(아래).
// 각자 독립적으로 이동/리사이즈되는지 getBounds()로 실측 확인.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

app.on('window-all-closed', () => {});

const CAPTURES = path.join(__dirname, 'captures');
const SCREEN = { width: 1920, height: 1200 };
const CANVAS_W = 1560, CANVAS_H = 800;
const CHAT_W = 1560, CHAT_H = 204;
const FITS_FULL_SIZE = (CANVAS_H + CHAT_H) <= SCREEN.height && CANVAS_W <= SCREEN.width;
const ORIGIN_X = Math.floor((SCREEN.width - CANVAS_W) / 2);
const ORIGIN_Y = 0;

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

app.whenReady().then(async () => {
  console.log('FITS_FULL_SIZE (1560x800 + 1560x204 <= screen):', FITS_FULL_SIZE, 'screen:', SCREEN);

  // warmup: 이 환경에서 프로세스의 첫 show()된 창은 실제 데스크톱에 topmost로 합성되지 않는 경우가
  // 재현됨(다른 프로세스가 계속 포그라운드를 재요청하는 공유 세션으로 추정). 워밍업으로 우회.
  const warmup = new BrowserWindow({ x: 10, y: 10, width: 10, height: 10, show: false, frame: false });
  warmup.loadURL('data:text/html,<body></body>');
  await new Promise((r) => warmup.once('ready-to-show', r));
  warmup.show();
  await warmup.webContents.executeJavaScript('1');
  await wait(300);
  warmup.close();

  const canvasWin = new BrowserWindow({
    x: ORIGIN_X, y: ORIGIN_Y, width: CANVAS_W, height: CANVAS_H,
    frame: true, show: false, backgroundColor: '#0f1116',
    title: 'CANVAS 1560x800',
  });
  canvasWin.loadURL('data:text/html,<body style="margin:0;background:#0f1116;color:#8ecfff;font-family:sans-serif;font-size:22px;display:flex;align-items:center;justify-content:center;height:100vh">CANVAS 1560×800 (위)</body>');

  const chatWin = new BrowserWindow({
    x: ORIGIN_X, y: ORIGIN_Y + CANVAS_H, width: CHAT_W, height: CHAT_H,
    frame: true, show: false, backgroundColor: '#14161c',
    title: 'CHAT 1560x204',
  });
  chatWin.loadURL('data:text/html,<body style="margin:0;background:#14161c;color:#d8dae2;font-family:sans-serif;font-size:20px;display:flex;align-items:center;justify-content:center;height:100vh">CHAT 1560×204 (아래)</body>');

  await Promise.all([
    new Promise((r) => canvasWin.once('ready-to-show', r)),
    new Promise((r) => chatWin.once('ready-to-show', r)),
  ]);

  await canvasWin.webContents.executeJavaScript('1');
  canvasWin.show();
  canvasWin.focus();
  canvasWin.moveTop();
  await wait(200);
  await chatWin.webContents.executeJavaScript('1');
  chatWin.show();
  chatWin.focus();
  chatWin.moveTop();
  await wait(500);

  const initial = { canvas: canvasWin.getBounds(), chat: chatWin.getBounds() };
  console.log('initial bounds:', JSON.stringify(initial, null, 2));

  captureRegion(
    { x: ORIGIN_X, y: ORIGIN_Y, width: CANVAS_W, height: CANVAS_H + CHAT_H },
    path.join(CAPTURES, 'S1-v3-01-initial-layout.png')
  );
  fs.writeFileSync(path.join(CAPTURES, 'S1-v3-01-canvas-webcontents.png'), (await canvasWin.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(CAPTURES, 'S1-v3-01-chat-webcontents.png'), (await chatWin.webContents.capturePage()).toPNG());

  // 독립 이동: 캔버스 창만 오른쪽으로 120px, 대화 창은 그대로
  canvasWin.setBounds({ x: ORIGIN_X + 120, y: ORIGIN_Y, width: CANVAS_W, height: CANVAS_H });
  await wait(300);
  const afterCanvasMove = { canvas: canvasWin.getBounds(), chat: chatWin.getBounds() };
  console.log('after moving ONLY canvas +120x:', JSON.stringify(afterCanvasMove, null, 2));

  // 독립 리사이즈: 대화 창만 높이 축소 (예: 204 -> 150), 캔버스는 그대로
  chatWin.setBounds({ x: ORIGIN_X, y: ORIGIN_Y + CANVAS_H, width: CHAT_W, height: 150 });
  await wait(300);
  const afterChatResize = { canvas: canvasWin.getBounds(), chat: chatWin.getBounds() };
  console.log('after resizing ONLY chat height->150:', JSON.stringify(afterChatResize, null, 2));

  captureRegion(
    { x: ORIGIN_X, y: ORIGIN_Y, width: CANVAS_W + 120, height: CANVAS_H + 150 },
    path.join(CAPTURES, 'S1-v3-02-after-independent-move-resize.png')
  );

  const report = {
    screen: SCREEN,
    designedSizes: { canvas: { width: CANVAS_W, height: CANVAS_H }, chat: { width: CHAT_W, height: CHAT_H } },
    fitsWithoutScaling: FITS_FULL_SIZE,
    initial,
    afterCanvasMove,
    afterChatResize,
    independenceCheck: {
      canvasMovedButChatUnchanged:
        afterCanvasMove.canvas.x === initial.canvas.x + 120 &&
        afterCanvasMove.chat.x === initial.chat.x && afterCanvasMove.chat.y === initial.chat.y &&
        afterCanvasMove.chat.width === initial.chat.width && afterCanvasMove.chat.height === initial.chat.height,
      chatResizedButCanvasUnchanged:
        afterChatResize.chat.height === 150 &&
        afterChatResize.canvas.x === afterCanvasMove.canvas.x && afterChatResize.canvas.y === afterCanvasMove.canvas.y &&
        afterChatResize.canvas.width === afterCanvasMove.canvas.width && afterChatResize.canvas.height === afterCanvasMove.canvas.height,
    },
  };
  fs.writeFileSync(path.join(CAPTURES, 'S1-v3-report.json'), JSON.stringify(report, null, 2));
  console.log('=== independenceCheck ===', JSON.stringify(report.independenceCheck, null, 2));

  canvasWin.close();
  chatWin.close();
  app.quit();
});
