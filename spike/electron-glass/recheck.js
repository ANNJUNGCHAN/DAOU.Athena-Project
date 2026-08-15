const { app, BrowserWindow } = require('electron');
const path = require('path');
const { execFileSync } = require('child_process');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ x: 80, y: 80, width: 1100, height: 750, frame: true, show: false, backgroundColor: '#00ff00' });
  win.loadURL('data:text/html,<body style="background:lime;font-size:60px">RECHECK</body>');
  await new Promise((r) => win.once('ready-to-show', r));
  win.show();
  await new Promise((r) => setTimeout(r, 1200));
  execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File',
    path.join(__dirname, 'scripts', 'capture.ps1'),
    '-x', '0', '-y', '0', '-w', '1920', '-h', '1200',
    '-out', path.join(__dirname, 'captures', 'S1-recheck.png')
  ], { stdio: 'inherit', windowsHide: true });
  app.quit();
});
