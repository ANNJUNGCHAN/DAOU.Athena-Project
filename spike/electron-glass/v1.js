// S1 검증 1 — transparent ↔ backgroundMaterial:'acrylic' 충돌 여부 실측
// 4 combos: a=transparent only, b=acrylic only, c=both, d=neither (CSS backdrop-filter only)
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const CAPTURES = path.join(__dirname, 'captures');
if (!fs.existsSync(CAPTURES)) fs.mkdirSync(CAPTURES, { recursive: true });

const BACKDROP_BOUNDS = { x: 80, y: 80, width: 1100, height: 750 };
const TEST_BOUNDS = { x: 260, y: 220, width: 720, height: 500 };

function captureRegion(bounds, outFile) {
  const script = path.join(__dirname, 'scripts', 'capture.ps1');
  execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script,
    '-x', String(bounds.x), '-y', String(bounds.y),
    '-w', String(bounds.width), '-h', String(bounds.height),
    '-out', outFile
  ], { stdio: 'inherit', windowsHide: true });
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function createBackdrop() {
  const win = new BrowserWindow({
    ...BACKDROP_BOUNDS,
    frame: true,
    show: false,
    title: 'S1 backdrop (colorful substitute — see RESULT.md)',
  });
  win.loadFile('backdrop.html');
  return win;
}

function createTestWindow(combo) {
  const opts = {
    ...TEST_BOUNDS,
    frame: false,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
  };
  if (combo === 'a') {
    opts.transparent = true;
  } else if (combo === 'b') {
    opts.backgroundMaterial = 'acrylic';
  } else if (combo === 'c') {
    opts.transparent = true;
    opts.backgroundMaterial = 'acrylic';
  }
  // combo 'd': neither transparent nor backgroundMaterial set. CSS backdrop-filter only.
  const win = new BrowserWindow(opts);
  win.loadFile('test.html', { search: `mode=${combo}` });
  return win;
}

async function runCombo(combo, log) {
  let win;
  let createErr = null;
  try {
    win = createTestWindow(combo);
  } catch (e) {
    createErr = String(e && e.stack || e);
    log.push({ combo, createErr });
    console.error(`[combo ${combo}] BrowserWindow construction threw:`, createErr);
    return;
  }
  await new Promise((resolve) => win.once('ready-to-show', resolve));
  win.show();
  win.moveTop();
  await wait(1200); // let acrylic/vibrancy settle
  const outFile = path.join(CAPTURES, `S1-${combo}.png`);
  try {
    captureRegion(TEST_BOUNDS, outFile);
  } catch (e) {
    console.error(`[combo ${combo}] screen capture failed:`, e.message);
  }
  // also capture via webContents.capturePage for comparison (renderer-only raster, no OS compositing)
  try {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(CAPTURES, `S1-${combo}-webcontents.png`), img.toPNG());
  } catch (e) {
    console.error(`[combo ${combo}] capturePage failed:`, e.message);
  }
  log.push({
    combo,
    optsUsed: {
      transparent: combo === 'a' || combo === 'c',
      backgroundMaterial: (combo === 'b' || combo === 'c') ? 'acrylic' : undefined,
    },
    createErr,
    screenCapture: outFile,
  });
  win.close();
  await wait(300);
}

app.whenReady().then(async () => {
  const log = [];
  const backdrop = createBackdrop();
  await new Promise((resolve) => backdrop.once('ready-to-show', resolve));
  backdrop.show();
  await wait(600);

  for (const combo of ['a', 'b', 'c', 'd']) {
    console.log(`=== running combo ${combo} ===`);
    await runCombo(combo, log);
  }

  fs.writeFileSync(path.join(CAPTURES, 'S1-v1-log.json'), JSON.stringify(log, null, 2));
  console.log('S1 verification 1 done. Log:', JSON.stringify(log, null, 2));
  backdrop.close();
  app.quit();
});

app.on('window-all-closed', () => {
  // keep process alive until explicit app.quit() above
});
