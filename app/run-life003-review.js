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
const captureDir = path.join(__dirname, 'captures');
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
  await main.createWindows(); main.startBootReadinessForVerify();
  const { shellWin, orbWin } = main.getWins();
  const booted = await waitUntil(() => shellWin.webContents.executeJavaScript(
    "document.getElementById('boot').hidden === true"));
  if (!booted) throw new Error('LIFE-003 review shell did not finish booting');

  let localBackgroundCounter = 0;
  const localCounterTimer = setInterval(() => { localBackgroundCounter += 1; }, 40);
  const marker = bg.markerPath(reviewProfile);
  const markedBeforeClose = fs.existsSync(marker);
  const counterBeforeHide = localBackgroundCounter;
  const closeClicked = await shellWin.webContents.executeJavaScript(
    "document.getElementById('winClose').click(); true");
  const hiddenAfterClose = await waitUntil(() => !shellWin.isVisible());
  await wait(320);
  const counterAfterHide = localBackgroundCounter;
  const markedAfterClose = fs.existsSync(marker);
  const markerStat = markedAfterClose ? fs.statSync(marker) : null;
  const noticeAfterFirst = main.getBackgroundCloseNoticeStats();

  main.restoreFromBackground(); await waitUntil(() => shellWin.isVisible());
  shellWin.focus(); await wait(150);
  const nativeAltF4Sent = await sendNativeAltF4(shellWin);
  const hiddenAfterNativeAltF4 = await waitUntil(() => !shellWin.isVisible());
  const aliveAfterNativeAltF4 = !shellWin.isDestroyed() && !orbWin.isDestroyed();

  main.restoreFromBackground(); await waitUntil(() => shellWin.isVisible());
  await shellWin.webContents.executeJavaScript("document.getElementById('winClose').click()");
  const hiddenAfterSecondClose = await waitUntil(() => !shellWin.isVisible());
  const markerAfterSecond = fs.statSync(marker);
  const noticeAfterSecond = main.getBackgroundCloseNoticeStats();
  const markerUnchanged = !!markerStat && markerStat.mtimeMs === markerAfterSecond.mtimeMs
    && markerStat.size === markerAfterSecond.size;

  const expectedShowCount = markedBeforeClose ? 0 : 1;
  const basePass = closeClicked && hiddenAfterClose && counterAfterHide > counterBeforeHide
    && markedAfterClose && nativeAltF4Sent && hiddenAfterNativeAltF4 && aliveAfterNativeAltF4
    && orbWin.isVisible() && hiddenAfterSecondClose && markerUnchanged
    && noticeAfterSecond.shown === expectedShowCount
    && noticeAfterSecond.durableWrites === expectedShowCount;
  const report = {
    pass: basePass,
    profile: path.basename(reviewProfile), fixtureMode: true, autostartDisabled: true,
    liveServicesVerified: false,
    closeButton: { closeClicked, hiddenAfterClose, hiddenAfterSecondClose },
    nativeAltF4: { sent: nativeAltF4Sent, hidden: hiddenAfterNativeAltF4, processStillRunning: aliveAfterNativeAltF4 },
    localBackgroundActivity: { counterBeforeHide, counterAfterHide, increased: counterAfterHide > counterBeforeHide },
    orbVisibleWhileHidden: orbWin.isVisible(),
    firstCloseNotice: {
      notificationSupported: Notification.isSupported(), markedBeforeClose, markedAfterClose,
      markerUnchanged, afterFirst: noticeAfterFirst, afterSecond: noticeAfterSecond,
    },
    trayExit: { invoked: false, beforeQuitObserved: false },
  };
  writeReport(report);
  if (!basePass) throw new Error('LIFE-003 Electron lifecycle regression failed');

  if (process.env.ATHENA_REVIEW_EXIT_AFTER_REPORT === '1') {
    clearInterval(localCounterTimer);
    report.trayExit.invoked = true;
    app.once('before-quit', () => {
      report.trayExit.beforeQuitObserved = true;
      report.pass = basePass && report.trayExit.invoked;
      writeReport(report);
    });
    if (!main.quitFromTrayForReview()) throw new Error('tray quit menu item unavailable');
  }
}).catch((error) => { console.error(error); app.exit(1); });
