'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { app, screen } = require('electron');
const { summarizeWindowChromeVerification } = require('./lib/main/window-chrome-verification');

process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';
process.env.ATHENA_WINDOW_DOUBLE_CLICK_METRICS = JSON.stringify({ timeMs: 180, width: 10, height: 10 });
app.setPath('userData', path.join(os.tmpdir(), `athena-life002-${crypto.randomUUID()}`));

const main = require('./main');

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
const inputAutomationErrors = [];

async function waitUntil(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await wait(25);
  }
  return false;
}

async function buttonState(win) {
  return win.webContents.executeJavaScript(`(() => {
    const button = document.getElementById('winMax');
    return {
      isMax: button.classList.contains('is-max'),
      title: button.title,
      ariaLabel: button.getAttribute('aria-label'),
    };
  })()`);
}

function windowHandle(win) {
  return win.getNativeWindowHandle().readBigUInt64LE(0).toString();
}

function sendDoubleClick(win, x, y) {
  try {
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(__dirname, 'scripts', 'send-native-double-click.ps1'),
      '-WindowHandle', windowHandle(win),
      '-X', String(Math.round(x)), '-Y', String(Math.round(y)),
    ], { stdio: 'pipe' });
    return true;
  } catch (error) {
    inputAutomationErrors.push({ action: 'synthetic-double-click', error: String(error.message || error) });
    return false;
  }
}

function sendDrag(win, start, end, { moveOnly = false } = {}) {
  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'scripts', 'send-native-drag.ps1'),
    '-WindowHandle', windowHandle(win),
    '-StartX', String(Math.round(start.x)), '-StartY', String(Math.round(start.y)),
    '-EndX', String(Math.round(end.x)), '-EndY', String(Math.round(end.y)),
  ];
  if (moveOnly) args.push('-MoveOnly');
  try {
    execFileSync('powershell.exe', args, { stdio: 'pipe' });
    return true;
  } catch (error) {
    inputAutomationErrors.push({ action: 'synthetic-drag', error: String(error.message || error) });
    return false;
  }
}

function sameBounds(a, b, tolerance = 2) {
  return ['x', 'y', 'width', 'height'].every((key) => Math.abs(a[key] - b[key]) <= tolerance);
}

async function run() {
  await app.whenReady();
  await main.createWindows();
  const { shellWin, orbWin } = main.getWins();
  if (orbWin && !orbWin.isDestroyed()) orbWin.hide();
  shellWin.show();
  shellWin.focus();
  shellWin.moveTop();
  shellWin.setAlwaysOnTop(true, 'screen-saver');
  await wait(150);

  const normalBounds = shellWin.getBounds();
  const hiddenGeometry = main.getShellChromeGeometry();
  sendDoubleClick(shellWin, normalBounds.x + 120, normalBounds.y + 13);
  await wait(300);
  const bootHiddenBlocked = !shellWin.isMaximized()
    && hiddenGeometry.visible === false;

  await shellWin.webContents.executeJavaScript(`(() => {
    document.getElementById('boot').hidden = true;
    document.querySelectorAll('.shell-overlay').forEach((overlay) => { overlay.hidden = true; });
    window.AthenaShell.revealChrome();
  })()`);
  await waitUntil(() => main.getShellChromeGeometry().visible === true);
  const workArea = screen.getDisplayMatching(normalBounds).workArea;

  shellWin.maximize();
  const apiMaxSynced = await waitUntil(async () => {
    const state = await buttonState(shellWin);
    return shellWin.isMaximized() && state.isMax
      && state.title === '이전 크기로 복원'
      && state.ariaLabel === '이전 크기로 복원';
  });
  shellWin.unmaximize();
  const apiRestoreSynced = await waitUntil(async () => {
    const state = await buttonState(shellWin);
    return !shellWin.isMaximized() && !state.isMax
      && state.title === '최대화' && state.ariaLabel === '최대화';
  });
  const apiBoundsRestored = sameBounds(shellWin.getBounds(), normalBounds);

  // A: 중앙 센서 밖의 실제 app-region:drag에서 down→점진 이동→up을 보낸다.
  const nativeStart = { x: normalBounds.x + 120, y: normalBounds.y + 13 };
  const nativeEnd = { x: nativeStart.x + 52, y: nativeStart.y + 34 };
  sendDrag(shellWin, nativeStart, nativeEnd);
  const nativeDragMoved = await waitUntil(() => {
    const moved = shellWin.getBounds();
    return Math.abs(moved.x - normalBounds.x) > 8 || Math.abs(moved.y - normalBounds.y) > 8;
  });
  await wait(350);
  const afterNativeDrag = shellWin.getBounds();
  const nativeDragPreservedSize = afterNativeDrag.width === normalBounds.width
    && afterNativeDrag.height === normalBounds.height;
  sendDrag(shellWin, nativeEnd, { x: nativeEnd.x + 60, y: nativeEnd.y + 40 }, { moveOnly: true });
  await wait(250);
  const afterReleaseMove = shellWin.getBounds();
  const releaseStopsMovement = sameBounds(afterReleaseMove, afterNativeDrag);

  shellWin.setBounds(normalBounds);
  main.noteAppBounds(shellWin);
  await wait(150);

  // 실제 SendInput으로 왼쪽·중앙·오른쪽 빈 제목 영역을 각각 최대화→복원한다.
  // 세 지점 모두 renderer sensor가 아니라 computed app-region:drag 위다.
  const pointFor = (name, bounds, geometry) => {
    const titlebar = geometry.titlebar;
    const rightEdge = geometry.controls ? geometry.controls.x - 12 : titlebar.x + titlebar.width - 12;
    const x = {
      left: titlebar.x + Math.max(20, titlebar.width * 0.12),
      center: titlebar.x + titlebar.width / 2,
      right: rightEdge,
    }[name];
    const y = titlebar.y + Math.min(titlebar.height - 3, Math.max(10, titlebar.height / 2));
    return { x: bounds.x + x, y: bounds.y + y };
  };
  const titlebarDoubleClicks = {};
  const zoomHitTestEvidence = {};
  for (const zoom of [0.5, 1, 2]) {
    shellWin.webContents.setZoomFactor(zoom);
    shellWin.webContents.send('athena:zoom-changed', { zoom });
    await waitUntil(() => Math.abs(main.getShellChromeGeometry().zoomFactor - zoom) < 0.001);
    await wait(300);
    zoomHitTestEvidence[zoom] = await shellWin.webContents.executeJavaScript(`(() => ({
      dragRegion: getComputedStyle(document.getElementById('dragStrip')).webkitAppRegion,
      titlebar: (() => { const r = document.getElementById('dragStrip').getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height }; })(),
      controls: (() => { const r = document.getElementById('winControls').getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height }; })(),
    }))()`);
    for (const name of ['left', 'center', 'right']) {
      let bounds = shellWin.getBounds();
      let geometry = main.getShellChromeGeometry();
      let point = pointFor(name, bounds, geometry);
      sendDoubleClick(shellWin, point.x, point.y);
      const maximized = await waitUntil(() => shellWin.isMaximized());
      const maxButton = await buttonState(shellWin);
      await wait(100);
      bounds = shellWin.getBounds();
      geometry = main.getShellChromeGeometry();
      point = pointFor(name, bounds, geometry);
      sendDoubleClick(shellWin, point.x, point.y);
      const restored = await waitUntil(() => !shellWin.isMaximized());
      const restoreButton = await buttonState(shellWin);
      const restoreBounds = shellWin.getBounds();
      titlebarDoubleClicks[`${zoom}:${name}`] = {
        maximized,
        restored,
        buttonSynced: maxButton.isMax && !restoreButton.isMax,
        returnedToPreMaxBounds: sameBounds(restoreBounds, normalBounds),
      };
    }
  }
  const geometryAtZoom2 = main.getShellChromeGeometry();
  sendDoubleClick(shellWin,
    normalBounds.x + geometryAtZoom2.titlebar.x + geometryAtZoom2.titlebar.width / 2,
    normalBounds.y + geometryAtZoom2.titlebar.y + geometryAtZoom2.titlebar.height + 10);
  await wait(300);
  const contentBelowBlocked = !shellWin.isMaximized();
  const controls = geometryAtZoom2.controls;
  await shellWin.webContents.executeJavaScript("document.querySelectorAll('#winControls button').forEach((button) => { button.disabled = true; })");
  sendDoubleClick(shellWin, normalBounds.x + controls.x + controls.width / 2,
    normalBounds.y + controls.y + controls.height / 2);
  await wait(300);
  const zoomedControlsBlocked = !shellWin.isMaximized();
  await shellWin.webContents.executeJavaScript("document.querySelectorAll('#winControls button').forEach((button) => { button.disabled = false; })");
  shellWin.webContents.setZoomFactor(1);
  shellWin.webContents.send('athena:zoom-changed', { zoom: 1 });
  await waitUntil(() => Math.abs(main.getShellChromeGeometry().zoomFactor - 1) < 0.001);

  // 네이티브 제목 영역을 화면 왼쪽 가장자리까지 끌어 DWM Snap을 실제 입력으로 확인.
  const edgeStartBounds = shellWin.getBounds();
  sendDrag(
    shellWin,
    { x: edgeStartBounds.x + 120, y: edgeStartBounds.y + 13 },
    { x: workArea.x + 1, y: workArea.y + Math.floor(workArea.height / 2) },
  );
  const edgeSnapObserved = await waitUntil(() => {
    const bounds = shellWin.getBounds();
    return Math.abs(bounds.x - workArea.x) <= 10
      && Math.abs(bounds.width - Math.round(workArea.width / 2)) <= 14
      && Math.abs(bounds.height - workArea.height) <= 14;
  }, 4000);
  const edgeBounds = shellWin.getBounds();

  shellWin.setBounds(normalBounds);
  main.noteAppBounds(shellWin);
  await wait(120);
  shellWin.setAlwaysOnTop(false);
  shellWin.minimize();
  const minimized = await waitUntil(() => shellWin.isMinimized());
  shellWin.restore();
  const restoredFromTaskbar = await waitUntil(() => !shellWin.isMinimized());

  const nativeButtonSynced = Object.values(titlebarDoubleClicks).every((item) => item.buttonSynced);
  const fullTitlebarDoubleClick = Object.values(titlebarDoubleClicks).every((item) => (
    item.maximized && item.restored && item.returnedToPreMaxBounds
  ));
  const nativeDragCssContract = Object.values(zoomHitTestEvidence).every((item) => item.dragRegion === 'drag');
  const automatedPassed = apiMaxSynced && apiRestoreSynced && apiBoundsRestored
    && nativeDragCssContract
    && bootHiddenBlocked && contentBelowBlocked && zoomedControlsBlocked
    && minimized && restoredFromTaskbar;
  const verification = summarizeWindowChromeVerification({
    automatedPassed,
    // SendInput/Win32 injection is automation evidence, not a physical Windows
    // interaction. These gates remain false until a human-observed run records them.
    physicalDoubleClickObserved: false,
    rightClickSystemMenuObserved: false,
    nativeDragMoved: false,
    edgeSnapObserved: false,
    winZSnapLayoutsObserved: false,
    borderResizeObserved: false,
  });
  const report = {
    ...verification,
    apiMaxSynced,
    apiRestoreSynced,
    apiBoundsRestored,
    nativeDragCssContract,
    sendInputNativeDragObserved: nativeDragMoved,
    sendInputEdgeSnapObserved: edgeSnapObserved,
    sendInputDragLeftBoundsUnchanged: nativeDragPreservedSize && releaseStopsMovement,
    sendInputDragAutomationNote: nativeDragMoved
      ? 'SendInput drag observed'
      : 'Chromium did not promote injected SendInput over app-region:drag into a DWM move loop',
    syntheticDoubleClickObserved: fullTitlebarDoubleClick,
    syntheticDoubleClickEvidence: titlebarDoubleClicks,
    syntheticDoubleClickButtonSynced: nativeButtonSynced,
    bootHiddenBlocked,
    contentBelowBlocked,
    zoomedControlsBlocked,
    minimized,
    restoredFromTaskbar,
    zoomHitTestEvidence,
    boundsEvidence: { normalBounds, afterNativeDrag, afterReleaseMove, edgeBounds, workArea },
    inputAutomationErrors,
  };
  fs.writeSync(1, `${JSON.stringify(report, null, 2)}\n`);
  app.exit(verification.passed ? 0 : 1);
}

run().catch((error) => {
  fs.writeSync(2, `${error && error.stack ? error.stack : error}\n`);
  app.exit(1);
});
