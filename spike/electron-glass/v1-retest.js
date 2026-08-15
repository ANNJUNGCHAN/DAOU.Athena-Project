// Re-test combos b and d with async (non-blocking) capture + longer settle,
// to check whether the "not responding" ghost seen in v1.js was a real acrylic
// rendering hang or an artifact of execFileSync blocking Electron's event loop.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const CAPTURES = path.join(__dirname, 'captures');
const BACKDROP_BOUNDS = { x: 80, y: 80, width: 1100, height: 750 };
const TEST_BOUNDS = { x: 260, y: 220, width: 720, height: 500 };

function captureRegionAsync(bounds, outFile) {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, 'scripts', 'capture.ps1');
    execFile('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-x', String(bounds.x), '-y', String(bounds.y),
      '-w', String(bounds.width), '-h', String(bounds.height),
      '-out', outFile
    ], (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function createBackdrop() {
  const win = new BrowserWindow({ ...BACKDROP_BOUNDS, frame: true, show: false, title: 'S1 backdrop retest' });
  win.loadFile('backdrop.html');
  return win;
}

function createTestWindow(combo) {
  const opts = { ...TEST_BOUNDS, frame: false, resizable: false, show: false, alwaysOnTop: true, backgroundColor: '#00000000' };
  if (combo === 'b') opts.backgroundMaterial = 'acrylic';
  // combo 'd': neither
  const win = new BrowserWindow(opts);
  win.loadFile('test.html', { search: `mode=${combo}` });
  return win;
}

async function runCombo(combo) {
  const win = createTestWindow(combo);
  await new Promise((resolve) => win.once('ready-to-show', resolve));
  win.show();
  win.moveTop();
  await wait(3000); // much longer settle, async capture below won't block event loop
  const outFile = path.join(CAPTURES, `S1-${combo}-retest.png`);
  await captureRegionAsync(TEST_BOUNDS, outFile);
  console.log(`[retest ${combo}] captured -> ${outFile}`);
  win.close();
  await wait(500);
}

app.whenReady().then(async () => {
  const backdrop = createBackdrop();
  await new Promise((resolve) => backdrop.once('ready-to-show', resolve));
  backdrop.show();
  await wait(600);

  for (const combo of ['b', 'd']) {
    console.log(`=== retesting combo ${combo} (async capture, 3s settle) ===`);
    await runCombo(combo);
  }

  backdrop.close();
  app.quit();
});
