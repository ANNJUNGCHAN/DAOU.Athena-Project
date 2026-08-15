const { app, BrowserWindow } = require('electron');
const path = require('path');
const { execFileSync } = require('child_process');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    x: 180, y: 700, width: 1560, height: 204,
    frame: true, show: false, backgroundColor: '#ff0000',
    title: 'ZORDER TEST — y:700',
  });
  win.loadURL('data:text/html,<body style="background:red;color:white;font-size:40px">Z-ORDER TEST</body>');
  await new Promise((r) => win.once('ready-to-show', r));
  win.show();
  win.setAlwaysOnTop(true, 'screen-saver', 1);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.focus();
  win.moveTop();
  console.log('isVisible:', win.isVisible(), 'isFocused:', win.isFocused(), 'isAlwaysOnTop:', win.isAlwaysOnTop());
  console.log('bounds:', win.getBounds());
  await new Promise((r) => setTimeout(r, 800));
  const script = path.join(__dirname, 'scripts', 'capture.ps1');
  execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script,
    '-x', '0', '-y', '0', '-w', '1920', '-h', '1200',
    '-out', path.join(__dirname, 'captures', 'S1-zorder-opaque.png')
  ], { stdio: 'inherit', windowsHide: true });
  win.close();
  app.quit();
});
