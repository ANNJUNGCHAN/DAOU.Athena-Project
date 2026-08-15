const { app, BrowserWindow } = require('electron');
const path = require('path');
const { execFileSync } = require('child_process');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    x: 180, y: 860, width: 1560, height: 204,
    frame: false, resizable: false, show: false,
    transparent: true, backgroundColor: '#00000000',
  });
  win.loadFile('chat.html');
  await new Promise((r) => win.once('ready-to-show', r));
  win.show();
  console.log('requested bounds:', { x: 180, y: 860, width: 1560, height: 204 });
  console.log('actual getBounds():', win.getBounds());
  console.log('actual getContentBounds():', win.getContentBounds());
  await new Promise((r) => setTimeout(r, 500));
  const script = path.join(__dirname, 'scripts', 'capture.ps1');
  execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-x', '0', '-y', '0', '-w', '1920', '-h', '1200',
    '-out', path.join(__dirname, 'captures', 'S1-align-fullscreen.png')
  ], { stdio: 'inherit' });
  app.quit();
});
