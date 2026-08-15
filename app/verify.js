// 검증 스크립트. `npm run verify` (= electron verify.js)로 실행한다.
// main.js를 모듈로 불러와 실제 앱과 동일한 창 생성 로직을 재사용하고,
// - capturePage() 스크린샷 (app/captures/)
// - 점→캔버스 확장/수축 rAF 프레임 실측 (p50/p95/max)
// - 두 창 getBounds() 독립성
// - 접근성 3종 강제 적용 스크린샷 (CDP Emulation.setEmulatedMedia)
// 을 수행하고 app/captures/VERIFY-REPORT.json 에 원본 수치를 남긴다.

// main.js를 라이브러리로 불러올 때는 자동 기동(app.whenReady().then(createWindows))을
// 막아야 한다 — verify.js가 createWindows()를 직접, 통제된 시점에 호출한다.
process.env.ATHENA_NO_AUTOSTART = '1';

const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const CAPTURES = path.join(__dirname, 'captures');
if (!fs.existsSync(CAPTURES)) fs.mkdirSync(CAPTURES, { recursive: true });

const DEBUGLOG = path.join(CAPTURES, 'verify-debug.log');
fs.writeFileSync(DEBUGLOG, `start ${new Date().toISOString()}\n`);
function dlog(msg) { fs.appendFileSync(DEBUGLOG, `${new Date().toISOString()} ${msg}\n`); }
process.on('uncaughtException', (err) => dlog('uncaughtException: ' + (err && err.stack || err)));
process.on('unhandledRejection', (err) => dlog('unhandledRejection: ' + (err && err.stack || err)));

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function stats(timestamps) {
  const deltas = [];
  for (let i = 1; i < timestamps.length; i++) deltas.push(timestamps[i] - timestamps[i - 1]);
  const sorted = [...deltas].sort((a, b) => a - b);
  const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);
  return {
    frameCount: timestamps.length,
    p50: pct(50), p95: pct(95),
    max: sorted.length ? sorted[sorted.length - 1] : null,
    min: sorted.length ? sorted[0] : null,
  };
}

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, name), img.toPNG());
  return img.getSize();
}

async function forceMedia(win, features) {
  const wc = win.webContents;
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features });
}

async function clearMedia(win) {
  const wc = win.webContents;
  await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
  if (wc.debugger.isAttached()) wc.debugger.detach();
}

async function waitForChatReady(chatWin, timeoutMs = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ready = await chatWin.webContents.executeJavaScript(
      "!document.getElementById('app').hidden"
    );
    if (ready) return true;
    await wait(100);
  }
  return false;
}

app.whenReady().then(async () => {
  dlog('whenReady fired');
  const report = { startedAt: new Date().toISOString() };
  const mainMod = require('./main.js');
  dlog('main.js required');

  // ---------- 창 생성 (main.js와 동일 경로) ----------
  await mainMod.createWindows();
  dlog('createWindows done');
  const { chatWin, canvasWin } = mainMod.getWins();
  const layout = mainMod.getLayout();
  report.layout = layout;

  // ---------- 검증 1: 부팅 — 대화 창만 뜬다 ----------
  await wait(200);
  report.bootChatOnly = { canvasVisibleAtBoot: canvasWin.isVisible(), chatVisibleAtBoot: chatWin.isVisible() };
  dlog('before shot 01'); const s1 = await shot(chatWin, '01-boot-gauge.png'); dlog('after shot 01');
  const chatReady = await waitForChatReady(chatWin);
  dlog('chatReady done, before shot 02'); const s2 = await shot(chatWin, '02-chat-only-idle.png'); dlog('after shot 02');
  report.bootChatOnly.shots = { boot: s1, idle: s2 };
  report.bootChatOnly.chatReadyAfterBoot = chatReady;
  console.log('[verify] 검증1 완료 — 부팅 시 캔버스 창 표시 여부:', canvasWin.isVisible(), 'chatReady:', chatReady);

  // ---------- 검증 2: 점 → 캔버스 확장/수축, 프레임 실측 ----------
  const dotBefore = await mainMod.getDotScreenPoint();
  report.dotScreenPoint = dotBefore;

  dlog('before expand 1'); const expandResult = await mainMod.expandCanvasWindow(); dlog('after expand 1');
  await wait(150);
  canvasWin.webContents.send('athena:add-canvas', { type: 'stream' });
  await wait(150);
  canvasWin.webContents.send('athena:add-canvas', { type: 'reader' });
  await wait(150);
  canvasWin.webContents.send('athena:add-canvas', { type: 'table' });
  await wait(300);
  await shot(canvasWin, '03-mosaic-expanded.png');
  await shot(chatWin, '03b-chat-during-mosaic.png');

  // 보조 증거 — 실제 OS 화면 합성 캡처(best-effort). spike/electron-glass/RESULT.md가
  // 기록한 대로 이 공유 데스크톱 환경에서는 간헐적으로 실패한다. 실패해도 위의
  // capturePage() 결과가 주 증거이므로 여기서는 막지 않는다.
  try {
    const capScript = path.join(__dirname, '..', 'spike', 'electron-glass', 'scripts', 'capture.ps1');
    const cb = canvasWin.getBounds();
    execFileSync('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', capScript,
      '-x', String(cb.x), '-y', String(cb.y), '-w', String(cb.width), '-h', String(cb.height),
      '-out', path.join(CAPTURES, '03c-mosaic-OS-composited.png'),
    ], { stdio: 'pipe', windowsHide: true, timeout: 8000 });
    report.osCaptureAttempted = { ok: true };
  } catch (err) {
    report.osCaptureAttempted = { ok: false, error: String(err && err.message || err) };
    dlog('OS capture failed: ' + (err && err.message || err));
  }

  report.expand = stats(expandResult.timestamps);
  console.log('[verify] 확장 프레임 stats:', JSON.stringify(report.expand));

  await wait(400);
  dlog('before collapse 1'); const collapseResult = await mainMod.collapseCanvasWindow(); dlog('after collapse 1');
  report.collapse = stats(collapseResult.timestamps);
  console.log('[verify] 수축 프레임 stats:', JSON.stringify(report.collapse));
  await wait(200);
  await shot(chatWin, '04-collapsed-back-to-chat.png');
  report.afterCollapse = { canvasVisible: canvasWin.isVisible() };

  // ---------- 검증 3: 두 창 독립 이동/리사이즈 ----------
  const initial = { canvas: canvasWin.getBounds(), chat: chatWin.getBounds() };
  canvasWin.setBounds({ ...canvasWin.getBounds(), x: canvasWin.getBounds().x + 80 });
  await wait(150);
  const afterCanvasMove = { canvas: canvasWin.getBounds(), chat: chatWin.getBounds() };
  chatWin.setBounds({ ...chatWin.getBounds(), height: Math.min(layout.chatMaxH, chatWin.getBounds().height + 100) });
  await wait(150);
  const afterChatResize = { canvas: canvasWin.getBounds(), chat: chatWin.getBounds() };
  // 원위치
  canvasWin.setBounds({ ...canvasWin.getBounds(), x: canvasWin.getBounds().x - 80 });
  chatWin.setBounds({ x: layout.originX, y: (layout.originY + layout.canvasH + layout.chatBaseH) - layout.chatBaseH, width: layout.chatW, height: layout.chatBaseH });
  await wait(150);

  // 허용 오차 2px — Windows에서 backgroundMaterial(acrylic) 적용 시 setBounds() 요청값과
  // getBounds() 실측값 사이에 DPI 반올림으로 1px 안팎의 편차가 실측된다(기능적 결함 아님).
  const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

  report.independence = {
    initial, afterCanvasMove, afterChatResize,
    canvasMovedButChatUnchanged:
      near(afterCanvasMove.canvas.x, initial.canvas.x + 80) &&
      near(afterCanvasMove.chat.x, initial.chat.x) && near(afterCanvasMove.chat.y, initial.chat.y) &&
      near(afterCanvasMove.chat.height, initial.chat.height),
    chatResizedButCanvasUnchanged:
      near(afterChatResize.chat.height, Math.min(layout.chatMaxH, initial.chat.height + 100)) &&
      near(afterChatResize.canvas.x, afterCanvasMove.canvas.x) && near(afterChatResize.canvas.y, afterCanvasMove.canvas.y) &&
      near(afterChatResize.canvas.width, afterCanvasMove.canvas.width) && near(afterChatResize.canvas.height, afterCanvasMove.canvas.height),
  };
  console.log('[verify] 독립성 체크:', JSON.stringify(report.independence.canvasMovedButChatUnchanged), JSON.stringify(report.independence.chatResizedButCanvasUnchanged));

  // ---------- 검증 4: 접근성 3종 (CDP Emulation.setEmulatedMedia) ----------
  // 다시 캔버스를 채워서 유리 표면이 실제로 보이는 상태에서 캡처한다.
  dlog('before expand 2'); const expand2 = await mainMod.expandCanvasWindow(); dlog('after expand 2');
  canvasWin.webContents.send('athena:add-canvas', { type: 'stream' });
  canvasWin.webContents.send('athena:add-canvas', { type: 'table' });
  await wait(300);

  await forceMedia(canvasWin, [{ name: 'prefers-reduced-transparency', value: 'reduce' }]);
  await forceMedia(chatWin, [{ name: 'prefers-reduced-transparency', value: 'reduce' }]);
  await wait(150);
  await shot(canvasWin, '05-a11y-reduced-transparency-canvas.png');
  await shot(chatWin, '05-a11y-reduced-transparency-chat.png');
  await clearMedia(canvasWin);
  await clearMedia(chatWin);

  await forceMedia(canvasWin, [{ name: 'prefers-contrast', value: 'more' }]);
  await forceMedia(chatWin, [{ name: 'prefers-contrast', value: 'more' }]);
  await wait(150);
  await shot(canvasWin, '06-a11y-prefers-contrast-canvas.png');
  await shot(chatWin, '06-a11y-prefers-contrast-chat.png');
  await clearMedia(canvasWin);
  await clearMedia(chatWin);

  await forceMedia(canvasWin, [{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await forceMedia(chatWin, [{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await wait(150);
  await shot(canvasWin, '07-a11y-reduced-motion-canvas.png');
  await shot(chatWin, '07-a11y-reduced-motion-chat.png');
  await clearMedia(canvasWin);
  await clearMedia(chatWin);

  dlog('a11y shots done'); report.accessibilityShotsTaken = [
    '05-a11y-reduced-transparency-canvas.png', '05-a11y-reduced-transparency-chat.png',
    '06-a11y-prefers-contrast-canvas.png', '06-a11y-prefers-contrast-chat.png',
    '07-a11y-reduced-motion-canvas.png', '07-a11y-reduced-motion-chat.png',
  ];
  console.log('[verify] 접근성 3종 캡처 완료');

  // ---------- 검증 5: 실제 개발용 트리거(Enter) 종단간 플로우 — 3상태 + 자동 성장 ----------
  // 지금까지는 mainMod 함수를 직접 호출했다. 이번엔 사용자가 실제로 하는 행동
  // (입력 후 Enter)을 그대로 시뮬레이션해 chat.js의 상태 머신·자동 성장·
  // athena__render_canvas 트리거 전체 경로를 검증한다.
  const boundsBeforeQuery = chatWin.getBounds();
  await chatWin.webContents.executeJavaScript(`
    (() => {
      const input = document.getElementById('input');
      input.value = '삼성전자 재무제표랑 공시, 뉴스 보여줘';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })();
  `);
  await wait(350);
  await shot(chatWin, '08-e2e-1-judging.png'); // 상태 1 — 판단 중 (점 breathe, 입력 잠김)
  await wait(500);
  await shot(chatWin, '09-e2e-2-calling.png'); // 상태 2 — 호출 중 (TR 코드 누적)

  // 상태 3(완료)까지 폴링 — .turn-a가 나타날 때까지, 최대 6초
  let e2eDone = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    const found = await chatWin.webContents.executeJavaScript("!!document.querySelector('.turn-a')");
    if (found) { e2eDone = true; break; }
    await wait(150);
  }
  await wait(150);
  await shot(chatWin, '10-e2e-3-done-autogrow.png');
  await shot(canvasWin, '11-e2e-3-mosaic-from-query.png');
  const boundsAfterQuery = chatWin.getBounds();

  const finalTurnText = await chatWin.webContents.executeJavaScript(
    "(() => { const els = document.querySelectorAll('.turn-a'); return els.length ? els[els.length-1].textContent : null; })()"
  );
  const chipCount = await chatWin.webContents.executeJavaScript("document.querySelectorAll('.chip').length");

  report.e2eTrigger = {
    reachedDoneState: e2eDone,
    boundsBeforeQuery, boundsAfterQuery,
    grewTallerThanBase: boundsAfterQuery.height > layout.chatBaseH,
    finalAnswerText: finalTurnText,
    canvasChipCount: chipCount,
  };
  console.log('[verify] 검증5(E2E Enter 트리거):', JSON.stringify(report.e2eTrigger));

  // ---------- 검증 6: 그립 드래그로 수동 리사이즈 ----------
  const beforeDrag = chatWin.getBounds();
  const dragStartScreenY = layout.originY + layout.canvasH + layout.chatBaseH - 5; // 대략 그립 근처
  await chatWin.webContents.executeJavaScript(`
    (() => {
      const grip = document.getElementById('grip');
      grip.dispatchEvent(new MouseEvent('mousedown', { screenY: ${dragStartScreenY}, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { screenY: ${dragStartScreenY - 160}, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    })();
  `);
  await wait(200);
  const afterDrag = chatWin.getBounds();
  report.manualResize = {
    beforeDrag, afterDrag,
    grewByDrag: afterDrag.height > beforeDrag.height,
    bottomEdgePinned: near(beforeDrag.y + beforeDrag.height, afterDrag.y + afterDrag.height),
  };
  console.log('[verify] 검증6(수동 리사이즈):', JSON.stringify(report.manualResize));

  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(CAPTURES, 'VERIFY-REPORT.json'), JSON.stringify(report, null, 2));
  console.log('[verify] 리포트 저장:', path.join(CAPTURES, 'VERIFY-REPORT.json'));

  await wait(200);
  dlog('quitting'); app.quit();
});
