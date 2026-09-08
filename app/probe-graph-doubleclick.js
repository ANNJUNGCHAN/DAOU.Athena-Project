'use strict';

/**
 * 재현 프로브 — "노드를 더블클릭하면 그냥 이미지형 그래프로 돌아간다"(2026-09-02 제보).
 *
 * vis-network의 onDoubleTap은 `doubleClick` 이벤트만 쏘고 아무 동작도 하지 않는다
 * (vis-network.js:34342 실측). 그러니 원인은 vis 밖에 있다 — 셸·Electron·우리 코드
 * 중 하나다. 추측 대신 **실제 마우스 입력**(webContents.sendInputEvent)으로 더블클릭을
 * 넣고 전후를 찍어 비교한다. 합성 MouseEvent는 vis가 쓰는 Hammer.js에 닿지 않아
 * 이 재현에 못 쓴다(같은 세션에서 실측).
 *
 * 실행: cd app && npx electron probe-graph-doubleclick.js
 */

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const APP_DIR = __dirname;
const REPO_DIR = path.resolve(APP_DIR, '..');
const BACKEND_DIR = path.join(REPO_DIR, 'backend');
const PYTHON_EXE = path.join(BACKEND_DIR, '.venv', 'Scripts', 'python.exe');
const SEED_SCRIPT = path.join(BACKEND_DIR, 'scripts', 'seed_long_term_etf_persona.py');
const OUT_DIR = path.join(REPO_DIR, 'artifacts', 'graph-proto');

app.disableHardwareAcceleration();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitReady(url, token) {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    try {
      const res = await fetch(`${url}/api/v1/brain/status`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok && (await res.json()).ready) return;
    } catch { /* 아직 */ }
    await wait(400);
  }
  throw new Error('backend never ready');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-dblclick-'));
  const userDataDir = path.join(tempRoot, 'user-data');
  const brainDbPath = path.join(tempRoot, 'brain.sqlite3');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'athena-onboarding.json'),
    JSON.stringify({ cliDone: true, accountDone: true }), 'utf8');
writeProbeModelPrefs(userDataDir);

  const seeded = spawnSync(PYTHON_EXE, [SEED_SCRIPT, '--db', brainDbPath], {
    cwd: BACKEND_DIR, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONPATH: BACKEND_DIR },
  });
  if (seeded.status !== 0) throw new Error(`씨앗 실패: ${seeded.stderr}`);

  const port = await reservePort();
  const backendUrl = `http://127.0.0.1:${port}`;
  const token = crypto.randomBytes(32).toString('hex');
  Object.assign(process.env, {
    ATHENA_NO_AUTOSTART: '1', ATHENA_CANVAS_SOURCE: 'live', ATHENA_BACKEND_URL: backendUrl,
    ATHENA_LOCAL_BEARER_TOKEN: token, ATHENA_BRAIN_ENABLED: 'true',
    ATHENA_BRAIN_DB_PATH: brainDbPath, ATHENA_BRAIN_HISTORY_DB_PATH: brainDbPath,
    ATHENA_BRAIN_USE_CLAUDE_CLI_EXTRACTION: 'false', ATHENA_ROUTINES_ENABLED: 'false',
  });
  const backend = spawn(PYTHON_EXE, ['-m', 'uvicorn', 'athena_api.main:app',
    '--host', '127.0.0.1', '--port', String(port), '--workers', '1'], {
    cwd: tempRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONPATH: BACKEND_DIR },
  });
  backend.stdout.on('data', () => {});
  backend.stderr.on('data', () => {});

  try {
    await waitReady(backendUrl, token);
    app.setPath('userData', userDataDir);
    await app.whenReady();
    const mainMod = require(path.join(APP_DIR, 'main.js'));
    await mainMod.createWindows();
    const { shellWin } = mainMod.getWins();
    mainMod.revealShell({ focus: true });
    const wc = shellWin.webContents;

    // 렌더러 오류를 전부 모은다 — 더블클릭이 예외를 던지고 있다면 여기 잡힌다.
    const consoleErrors = [];
    wc.on('console-message', (_e, level, message) => {
      if (level >= 2) consoleErrors.push(message);
    });

    await wc.executeJavaScript(`(() => {
      for (const id of ['boot','onboard','settings','order']) { const el=document.getElementById(id); if (el) el.hidden = true; }
      const a=document.getElementById('app'); if (a) a.hidden=false;
      const s=document.getElementById('shell'); if (s) s.hidden=false;
      document.getElementById('modeNavGraph').click();
      return true;
    })()`);
    await wait(1200);
    await wc.executeJavaScript(`(() => { document.getElementById('graphViewTab').click(); return true; })()`);
    await wait(6000);

    const snapshot = () => wc.executeJavaScript(`(() => {
      const frame = document.querySelector('#graphBody .graph-live-map');
      const canvas = frame ? frame.querySelector('canvas') : null;
      const body = document.getElementById('graphBody');
      const win = { w: innerWidth, h: innerHeight, maximized: outerWidth >= screen.availWidth - 4 };
      return {
        hasFrame: !!frame,
        canvasCss: canvas ? { w: Math.round(canvas.getBoundingClientRect().width), h: Math.round(canvas.getBoundingClientRect().height) } : null,
        canvasAttr: canvas ? { w: canvas.width, h: canvas.height } : null,
        bodyChildren: body ? [...body.children].map((c) => c.className || c.tagName) : null,
        bodyText: body ? body.textContent.slice(0, 120) : null,
        panelHidden: document.getElementById('graphPanel') ? document.getElementById('graphPanel').hidden : null,
        win,
      };
    })()`);

    const before = await snapshot();
    const shot = async (name) => {
      await wait(400);
      const img = await wc.capturePage();
      fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), img.toPNG());
    };
    await shot('dblclick-before');

    // 노드 하나의 화면 좌표를 잡는다. network은 클로저 안이라 직접 못 만지므로,
    // 프레임 중앙에서 가장 가까운 "노드처럼 보이는 점"을 쓰는 대신 프레임 중앙을
    // 그대로 쓴다 — 중앙에는 대개 허브 노드가 있다. 없으면 좌표만 찍히고 끝이라
    // 그것도 정보다(빈 곳 더블클릭의 동작을 재는 셈).
    const rect = await wc.executeJavaScript(`(() => {
      const f = document.querySelector('#graphBody .graph-live-map').getBoundingClientRect();
      return { x: Math.round(f.left + f.width/2), y: Math.round(f.top + f.height/2), w: Math.round(f.width), h: Math.round(f.height) };
    })()`);

    const clickAt = (x, y, clickCount) => {
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount });
      wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount });
    };
    // 진짜 더블클릭 — clickCount 1 → 2 연속.
    wc.sendInputEvent({ type: 'mouseMove', x: rect.x, y: rect.y });
    await wait(120);
    clickAt(rect.x, rect.y, 1);
    await wait(60);
    clickAt(rect.x, rect.y, 2);
    await wait(2500);

    const after = await snapshot();
    await shot('dblclick-after');

    process.stdout.write(`${JSON.stringify({ clickedAt: rect, before, after, consoleErrors }, null, 2)}\n`);
    return 0;
  } finally {
    try { backend.kill(); } catch { /* 이미 죽었다 */ }
    for (const w of BrowserWindow.getAllWindows()) { try { w.destroy(); } catch { /* ok */ } }
  }
}

main().then((c) => app.exit(c)).catch((e) => {
  process.stderr.write(`${(e && e.stack) || e}\n`);
  app.exit(1);
});
