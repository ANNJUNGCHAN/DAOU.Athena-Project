'use strict';

/**
 * 그래프 모드 손으로 써 보기 — 실제 Electron 셸 + 실제 백엔드 + 씨앗된 성향 그래프.
 *
 * `verify-graph-mode.js`와 기동 절차는 같다(임시 userData, 임시 브레인 SQLite, 동적
 * 루프백 포트, 실행마다 새 베어러, `seed_long_term_etf_persona.py`로 결정적 씨앗).
 * 다른 점은 하나다: 검사하고 끄는 대신 **창을 열어 둔다.** 사람이 직접 클릭한다.
 *
 * 왜 씨앗이 필요한가: 호스트의 `~/.athena/brain.sqlite3`는 비어 있어서 그대로 띄우면
 * 군집도 숨은 연관도 티어 대조도 그릴 것이 없다 — "기능이 없다"와 "그릴 게 없다"가
 * 구분되지 않는다. 이 런처는 호스트 브레인을 건드리지 않는다(임시 DB만 쓴다).
 *
 * 실행: cd app && npx electron play-graph-mode.js
 */

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const APP_DIR = __dirname;
const REPO_DIR = path.resolve(APP_DIR, '..');
const BACKEND_DIR = path.join(REPO_DIR, 'backend');
const PYTHON_EXE = path.join(BACKEND_DIR, '.venv', 'Scripts', 'python.exe');
const SEED_SCRIPT = path.join(BACKEND_DIR, 'scripts', 'seed_long_term_etf_persona.py');
const PLAY_ROOT = path.join(os.tmpdir(), 'athena-graph-play');
const BACKEND_READY_TIMEOUT_MS = 60_000;

app.disableHardwareAcceleration();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForBackendReady(url, token) {
  const started = Date.now();
  let lastError = 'no attempt';
  while (Date.now() - started < BACKEND_READY_TIMEOUT_MS) {
    try {
      const res = await fetch(`${url}/api/v1/brain/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const body = await res.json();
        if (body.ready) return body;
        lastError = `not ready: ${JSON.stringify(body)}`;
      } else {
        lastError = `HTTP ${res.status}`;
      }
    } catch (error) {
      lastError = String((error && error.message) || error);
    }
    await wait(400);
  }
  throw new Error(`backend never became ready: ${lastError}`);
}

function log(line) {
  process.stdout.write(`${line}\n`);
}

async function main() {
  if (!fs.existsSync(PYTHON_EXE)) throw new Error(`backend venv이 없다: ${PYTHON_EXE}`);

  const port = await reserveLoopbackPort();
  const backendUrl = `http://127.0.0.1:${port}`;
  const bearerToken = crypto.randomBytes(32).toString('hex');
  const userDataDir = path.join(PLAY_ROOT, 'user-data');
  const brainDbPath = path.join(PLAY_ROOT, 'brain.sqlite3');
  const chatOutboxPath = path.join(PLAY_ROOT, 'chat-outbox.sqlite3');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'athena-onboarding.json'),
    JSON.stringify({ cliDone: true, accountDone: true }, null, 2),
    'utf8',
  );

  // 매 실행 새 그래프 — 지난 실행의 DB가 남아 있으면 씨앗이 중복 적재된다.
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(`${brainDbPath}${suffix}`, { force: true }); } catch { /* 없으면 그만 */ }
  }

  log('[1/3] 성향 그래프 씨앗 중...');
  const seeded = spawnSync(PYTHON_EXE, [SEED_SCRIPT, '--db', brainDbPath], {
    cwd: BACKEND_DIR,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONPATH: BACKEND_DIR },
    encoding: 'utf8',
    windowsHide: true,
  });
  if (seeded.status !== 0) throw new Error(`페르소나 씨앗 실패: ${seeded.stderr || seeded.stdout}`);
  log(`      ${seeded.stdout.trim()}`);

  Object.assign(process.env, {
    ATHENA_NO_AUTOSTART: '1',
    ATHENA_CANVAS_SOURCE: 'live',
    ATHENA_BACKEND_URL: backendUrl,
    ATHENA_LOCAL_BEARER_TOKEN: bearerToken,
    ATHENA_BRAIN_ENABLED: 'true',
    ATHENA_BRAIN_DB_PATH: brainDbPath,
    ATHENA_BRAIN_HISTORY_DB_PATH: brainDbPath,
    ATHENA_CHAT_HISTORY_DB_PATH: chatOutboxPath,
    ATHENA_BRAIN_USE_CLAUDE_CLI_EXTRACTION: 'false',
    ATHENA_ROUTINES_ENABLED: 'false',
  });

  log(`[2/3] 백엔드 기동 중 (${backendUrl})...`);
  const backend = spawn(PYTHON_EXE, [
    '-m', 'uvicorn', 'athena_api.main:app',
    '--host', '127.0.0.1', '--port', String(port), '--workers', '1',
  ], {
    cwd: PLAY_ROOT,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONPATH: BACKEND_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  backend.stdout.on('data', () => {});
  backend.stderr.on('data', () => {});

  // 백엔드는 앱이 끝날 때만 내린다. `window-all-closed`에 손대지 않는 것이 중요하다 —
  // main.js가 그것을 일부러 no-op으로 두었고(워밍업 창이 닫히는 순간 = 그 시점의
  // "모든 창"이라 앱이 통째로 죽는다), 여기서 다시 quit을 붙이면 그 버그가 살아난다.
  // 셸 창을 닫으면 main.js의 `shellWin.on('closed')`가 app.quit()을 부른다.
  const stopBackend = () => { try { backend.kill(); } catch { /* 이미 죽었다 */ } };
  app.on('before-quit', stopBackend);
  process.on('exit', stopBackend);

  await waitForBackendReady(backendUrl, bearerToken);

  log('[3/3] 셸 기동 중...');
  app.setPath('userData', userDataDir);
  await app.whenReady();
  const mainMod = require(path.join(APP_DIR, 'main.js'));
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  if (!shellWin || shellWin.isDestroyed()) throw new Error('셸 창이 만들어지지 않았다');
  mainMod.revealShell({ focus: true });
  const wc = shellWin.webContents;

  await wc.executeJavaScript(`(() => {
    for (const id of ['boot', 'onboard', 'settings', 'order']) {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    }
    const app = document.getElementById('app');
    if (app) app.hidden = false;
    const shell = document.getElementById('shell');
    if (shell) shell.hidden = false;
    return true;
  })()`);

  // 그래프 모드로 바로 들어간다 — 이 런처의 목적이 그것이다.
  await wc.executeJavaScript(`(() => { document.getElementById('modeNavGraph').click(); return true; })()`);
  await wait(1200);

  // 지도 표면으로 가서 "움직이는 그래프"를 켠다(2026-09-02) — 평가 대상이 그것이다.
  const live = await wc.executeJavaScript(`(() => {
    document.getElementById('graphViewTab').click();
    return true;
  })()`);
  void live;
  await wait(1500);
  const liveState = await wc.executeJavaScript(`(async () => {
    const btn = document.getElementById('graphLiveToggle');
    if (!btn || btn.hidden) return { ok: false, reason: 'toggle missing or hidden', hasVis: !!window.vis };
    if (btn.getAttribute('aria-pressed') !== 'true') btn.click();
    await new Promise((r) => setTimeout(r, 2500));
    const canvasCount = document.querySelectorAll('#graphBody .graph-live-map canvas').length;
    return { ok: canvasCount > 0, pressed: btn.getAttribute('aria-pressed'), canvasCount,
             svgCount: document.querySelectorAll('#graphBody svg.graph-canvas').length };
  })()`);
  log(`      라이브 지도: ${JSON.stringify(liveState)}`);

  // 자가 확인용 스크린샷 — 화면이 실제로 그려졌는지 사람 없이도 판별한다.
  await wait(4000);
  const shot = await shellWin.webContents.capturePage();
  const shotPath = path.join(REPO_DIR, 'artifacts', 'graph-proto', 'app-live-map.png');
  fs.mkdirSync(path.dirname(shotPath), { recursive: true });
  fs.writeFileSync(shotPath, shot.toPNG());
  log(`      스크린샷: ${shotPath}`);

  log('');
  log('창이 열렸습니다. 헤더의 "움직이는 그래프" 칩으로 정적 ⇄ 라이브를 오갈 수 있습니다.');
  log('창을 닫으면 백엔드도 함께 내려갑니다.');
}

main().catch((error) => {
  process.stderr.write(`${String((error && error.stack) || error)}\n`);
  app.exit(1);
});
