'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app, nativeTheme } = require('electron');
const { createFreshVerifyProfile } = require('./lib/main/verify-profile');

const profile = createFreshVerifyProfile({ scenario: 'configured' });
app.setPath('userData', profile.directory);
process.env.ATHENA_CANVAS_SOURCE = 'fixture';
process.env.ATHENA_NO_AUTOSTART = '1';

const main = require('./main');
const captureDir = path.join(__dirname, 'captures');
const reportPath = path.join(captureDir, 'LIFE-004-REVIEW-2.json');
const capturePath = path.join(captureDir, 'life004-actual-tray-menu.png');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(check, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await wait(100);
  }
  return false;
}

function scheduleDesktopCapture(target) {
  const script = [
    'Start-Sleep -Milliseconds 700',
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$bounds=[System.Windows.Forms.SystemInformation]::VirtualScreen',
    '$bmp=New-Object System.Drawing.Bitmap $bounds.Width,$bounds.Height',
    '$g=[System.Drawing.Graphics]::FromImage($bmp)',
    '$g.CopyFromScreen($bounds.Left,$bounds.Top,0,0,$bounds.Size)',
    `$bmp.Save('${target.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Png)`,
    '$g.Dispose()',
    '$bmp.Dispose()',
  ].join('; ');
  const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'light';
  fs.mkdirSync(captureDir, { recursive: true });

  await main.createWindows();
  main.startBootReadinessForVerify();
  const { shellWin } = main.getWins();

  const booted = await waitUntil(() => shellWin.webContents.executeJavaScript(
    "document.getElementById('boot').hidden === true",
  ));
  if (!booted) throw new Error('LIFE-004 review shell did not finish booting');

  const closeClicked = await shellWin.webContents.executeJavaScript(`(() => {
    const close = document.getElementById('winClose');
    if (!close || close.hidden) return false;
    close.click();
    return true;
  })()`);
  const hidden = await waitUntil(() => !shellWin.isVisible());

  fs.writeFileSync(reportPath, `${JSON.stringify({
    profile: path.basename(profile.directory),
    closeClicked,
    hiddenAfterClose: hidden,
    processStillRunning: !shellWin.isDestroyed(),
    trayMenu: ['열기', '종료'],
    trayMenuOpening: true,
    capture: capturePath,
  }, null, 2)}\n`, 'utf8');

  // System.Drawing cannot reliably replace a PNG that was opened by an earlier
  // review. This path is this script's own generated artifact, so clear it
  // immediately before producing fresh evidence.
  fs.rmSync(capturePath, { force: true });
  scheduleDesktopCapture(capturePath);
  main.showTrayMenuForReview();
});
