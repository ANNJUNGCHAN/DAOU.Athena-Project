'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { app, nativeTheme, Notification } = require('electron');
const reviewProfile = process.env.ATHENA_USERDATA_DIR
  || fs.mkdtempSync(path.join(os.tmpdir(), 'athena-life003-review-'));
app.setPath('userData', path.resolve(reviewProfile));
process.env.ATHENA_CANVAS_SOURCE = 'fixture';
process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_ALLOW_FIXTURE_NOTIFICATIONS = '1';
const main = require('./main');
const bg = require('./lib/main/background-close');
const { captureRoot } = require('./lib/probe-captures');
const captureDir = captureRoot(__dirname);
const reportPath = path.join(captureDir, 'LIFE-003-REVIEW.json');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(check, timeoutMs = 8000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) { if (await check()) return true; await wait(80); }
  return false;
}
function writeReport(report) { fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8'); }
function sendNativeAltF4(shellWin) {
  const script = path.join(__dirname, 'scripts', 'send-native-alt-f4.ps1');
  const nativeHandle = shellWin.getNativeWindowHandle();
  const handle = process.arch === 'x64'
    ? nativeHandle.readBigUInt64LE(0).toString()
    : String(nativeHandle.readUInt32LE(0));
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-WindowHandle', handle], {
      windowsHide: true, stdio: 'ignore',
    });
    const timer = setTimeout(() => { child.kill(); resolve(false); }, 5000);
    child.once('exit', (code) => { clearTimeout(timer); resolve(code === 0); });
    child.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}
app.whenReady().then(async () => {
  nativeTheme.themeSource = 'light'; fs.mkdirSync(captureDir, { recursive: true });
  await main.createWindows();
  const { bootWin, shellWin, orbWin } = main.getWins();
  let orbShowEvents = 0;
  orbWin.on('show', () => { orbShowEvents += 1; });
  const bootVisibleBeforeHandoff = !!bootWin && bootWin.isVisible();
  const shellHiddenBeforeHandoff = !shellWin.isVisible();
  const orbHiddenBeforeHandoff = !orbWin.isVisible();
  main.startBootReadinessForVerify();
  const booted = await waitUntil(() => shellWin.webContents.executeJavaScript(
    "document.getElementById('boot').hidden === true"));
  if (!booted) throw new Error('LIFE-003 review shell did not finish booting');

  const shellVisibleAfterHandoff = await waitUntil(
    () => shellWin.isVisible() && !shellWin.isMinimized(),
  );
  const orbHiddenAfterHandoff = await waitUntil(() => !orbWin.isVisible());
  shellWin.minimize();
  const shellMinimized = await waitUntil(() => shellWin.isMinimized());
  const orbVisibleWhileMinimized = await waitUntil(() => orbWin.isVisible());
  shellWin.restore();
  const shellRestoredAfterMinimize = await waitUntil(
    () => shellWin.isVisible() && !shellWin.isMinimized(),
  );
  const orbHiddenAfterRestore = await waitUntil(() => !orbWin.isVisible());

  let localBackgroundCounter = 0;
  const localCounterTimer = setInterval(() => { localBackgroundCounter += 1; }, 40);
  const marker = bg.markerPath(reviewProfile);
  const markedBeforeClose = fs.existsSync(marker);
  const counterBeforeHide = localBackgroundCounter;
  const closeClicked = await shellWin.webContents.executeJavaScript(
    "document.getElementById('winClose').click(); true");
  const hiddenAfterClose = await waitUntil(() => !shellWin.isVisible());
  const orbVisibleAfterClose = await waitUntil(() => orbWin.isVisible());
  let orbCloseEventObserved = false;
  let orbCloseDefaultPrevented = false;
  orbWin.once('close', (event) => {
    orbCloseEventObserved = true;
    orbCloseDefaultPrevented = event.defaultPrevented;
  });
  orbWin.close();
  const orbCloseSuppressedWhileShellHidden = await waitUntil(
    () => orbCloseEventObserved && !orbWin.isDestroyed() && orbWin.isVisible(),
  );
  await wait(320);
  const counterAfterHide = localBackgroundCounter;
  const markedAfterClose = fs.existsSync(marker);
  const markerStat = markedAfterClose ? fs.statSync(marker) : null;
  const noticeAfterFirst = main.getBackgroundCloseNoticeStats();

  const orbOpenShellIpcSubmitted = await orbWin.webContents.executeJavaScript(
    "window.athena.send('athena:orb-open-shell', {}); true",
  );
  const restoredThroughOrbIpc = await waitUntil(
    () => shellWin.isVisible() && !shellWin.isMinimized() && !orbWin.isVisible(),
  );
  const shellVisibleAfterOrbIpc = shellWin.isVisible() && !shellWin.isMinimized();
  const orbHiddenAfterOrbIpc = !orbWin.isVisible();
  const closeClickedAfterOrbIpc = await shellWin.webContents.executeJavaScript(
    "document.getElementById('winClose').click(); true",
  );
  const hiddenForTrayRestore = await waitUntil(() => !shellWin.isVisible());
  const orbVisibleForTrayRestore = await waitUntil(() => orbWin.isVisible());

  const trayOpenInvokedAfterClose = main.openFromTrayForReview();
  const restoredAfterClose = await waitUntil(
    () => shellWin.isVisible() && !shellWin.isMinimized() && !orbWin.isVisible(),
  );
  shellWin.focus(); await wait(150);
  const nativeAltF4Sent = await sendNativeAltF4(shellWin);
  const hiddenAfterNativeAltF4 = await waitUntil(() => !shellWin.isVisible());
  const orbVisibleAfterNativeAltF4 = await waitUntil(() => orbWin.isVisible());
  const aliveAfterNativeAltF4 = !shellWin.isDestroyed() && !orbWin.isDestroyed();

  const trayOpenInvokedAfterNativeAltF4 = main.openFromTrayForReview();
  const restoredAfterNativeAltF4 = await waitUntil(
    () => shellWin.isVisible() && !shellWin.isMinimized() && !orbWin.isVisible(),
  );
  await shellWin.webContents.executeJavaScript("document.getElementById('winClose').click()");
  const hiddenAfterSecondClose = await waitUntil(() => !shellWin.isVisible());
  const orbVisibleAfterSecondClose = await waitUntil(() => orbWin.isVisible());
  const markerAfterSecond = fs.statSync(marker);
  const noticeAfterSecond = main.getBackgroundCloseNoticeStats();
  const markerUnchanged = !!markerStat && markerStat.mtimeMs === markerAfterSecond.mtimeMs
    && markerStat.size === markerAfterSecond.size;

  const expectedShowCount = markedBeforeClose ? 0 : 1;
  const basePass = bootVisibleBeforeHandoff && shellHiddenBeforeHandoff && orbHiddenBeforeHandoff
    && shellVisibleAfterHandoff && orbHiddenAfterHandoff
    && shellMinimized && orbVisibleWhileMinimized
    && shellRestoredAfterMinimize && orbHiddenAfterRestore
    && closeClicked && hiddenAfterClose && orbVisibleAfterClose
    && orbCloseEventObserved && orbCloseDefaultPrevented && orbCloseSuppressedWhileShellHidden
    && counterAfterHide > counterBeforeHide
    && orbOpenShellIpcSubmitted && restoredThroughOrbIpc
    && shellVisibleAfterOrbIpc && orbHiddenAfterOrbIpc
    && closeClickedAfterOrbIpc && hiddenForTrayRestore && orbVisibleForTrayRestore
    && markedAfterClose && trayOpenInvokedAfterClose && restoredAfterClose
    && nativeAltF4Sent && hiddenAfterNativeAltF4 && orbVisibleAfterNativeAltF4
    && aliveAfterNativeAltF4 && trayOpenInvokedAfterNativeAltF4 && restoredAfterNativeAltF4
    && hiddenAfterSecondClose && orbVisibleAfterSecondClose && markerUnchanged
    && noticeAfterSecond.shown === expectedShowCount
    && noticeAfterSecond.durableWrites === expectedShowCount;
  const report = {
    pass: basePass,
    profile: path.basename(reviewProfile), fixtureMode: true, autostartDisabled: true,
    liveServicesVerified: false,
    visibilityPolicy: {
      bootVisibleBeforeHandoff,
      shellHiddenBeforeHandoff,
      orbHiddenBeforeHandoff,
      shellVisibleAfterHandoff,
      orbHiddenAfterHandoff,
      shellMinimized,
      orbVisibleWhileMinimized,
      shellRestoredAfterMinimize,
      orbHiddenAfterRestore,
      shellVisibleAfterOrbIpc,
      orbHiddenAfterOrbIpc,
      restoredAfterClose,
      orbVisibleAfterNativeAltF4,
      restoredAfterNativeAltF4,
      orbVisibleAfterSecondClose,
    },
    orbCloseWhileShellHidden: {
      eventObserved: orbCloseEventObserved,
      defaultPrevented: orbCloseDefaultPrevented,
      remainedVisible: orbCloseSuppressedWhileShellHidden,
    },
    orbOpenShellIpc: {
      channel: 'athena:orb-open-shell',
      rendererSubmitted: orbOpenShellIpcSubmitted,
      restored: restoredThroughOrbIpc,
      shellVisible: shellVisibleAfterOrbIpc,
      orbHidden: orbHiddenAfterOrbIpc,
      returnedToBackgroundForTray: hiddenForTrayRestore && orbVisibleForTrayRestore,
    },
    trayRestore: {
      afterCloseInvoked: trayOpenInvokedAfterClose,
      afterNativeAltF4Invoked: trayOpenInvokedAfterNativeAltF4,
    },
    closeButton: { closeClicked, hiddenAfterClose, hiddenAfterSecondClose },
    nativeAltF4: { sent: nativeAltF4Sent, hidden: hiddenAfterNativeAltF4, processStillRunning: aliveAfterNativeAltF4 },
    localBackgroundActivity: { counterBeforeHide, counterAfterHide, increased: counterAfterHide > counterBeforeHide },
    orbVisibleWhileHidden: orbWin.isVisible(),
    firstCloseNotice: {
      notificationSupported: Notification.isSupported(), markedBeforeClose, markedAfterClose,
      markerUnchanged, afterFirst: noticeAfterFirst, afterSecond: noticeAfterSecond,
    },
    trayExit: {
      invoked: false,
      beforeQuitObserved: false,
      orbShowEventsBeforeQuit: null,
      orbShowEventsAfterQuit: null,
      orbDestroyedAtWillQuit: false,
    },
  };
  writeReport(report);
  if (!basePass) throw new Error('LIFE-003 Electron lifecycle regression failed');

  if (process.env.ATHENA_REVIEW_EXIT_AFTER_REPORT === '1') {
    clearInterval(localCounterTimer);
    report.trayExit.invoked = true;
    report.trayExit.orbShowEventsBeforeQuit = orbShowEvents;
    app.once('before-quit', () => {
      report.trayExit.beforeQuitObserved = true;
    });
    app.once('will-quit', () => {
      report.trayExit.orbShowEventsAfterQuit = orbShowEvents
        - report.trayExit.orbShowEventsBeforeQuit;
      report.trayExit.orbDestroyedAtWillQuit = orbWin.isDestroyed();
      report.pass = basePass && report.trayExit.invoked && report.trayExit.beforeQuitObserved
        && report.trayExit.orbShowEventsAfterQuit === 0
        && report.trayExit.orbDestroyedAtWillQuit;
      writeReport(report);
    });
    if (!main.quitFromTrayForReview()) throw new Error('tray quit menu item unavailable');
  }
}).catch((error) => { console.error(error); app.exit(1); });
