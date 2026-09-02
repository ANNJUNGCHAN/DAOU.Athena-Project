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

  // 모델 노출 게이트를 직접 켠다(2026-09-02).
  //
  // 백엔드는 안전측으로 expose_to_model=False로 시작하고(lifespan.py), 앱은 저장된
  // prefs 값(기본 true)을 **브레인 준비를 확인한 자리**에서 밀어 넣는다
  // (history-sink.refreshBrainReady → pushExposeToModel). 그런데 그 자리로 가는
  // 시작 경로(main.js waitForBrainStartup)는 `extraction_enabled === true`를 먼저
  // 요구한다 — 이 런처는 추출기를 끄고 띄우므로(그래프는 씨앗 스크립트가 넣는다)
  // 그 push가 한 번도 안 돈다. 결과: 화면 토글은 "켜짐"인데 실제 게이트는 닫혀 있고,
  // 채팅이 athena_brain을 부르면 503을 받아 "노출이 꺼져 있다"고 답한다(실측).
  //
  // 여기서 켜는 것은 런처의 몫이다 — 씨앗된 페르소나는 실사용자 데이터가 아니다.
  const exposeRes = await fetch(`${backendUrl}/api/v1/settings/expose-to-model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearerToken}` },
    body: JSON.stringify({ enabled: true }),
  });
  log(`      모델 노출 게이트: ${exposeRes.ok ? '켜짐' : `실패(HTTP ${exposeRes.status})`}`);

  log('[3/3] 셸 기동 중...');
  app.setPath('userData', userDataDir);
  await app.whenReady();
  const mainMod = require(path.join(APP_DIR, 'main.js'));
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  if (!shellWin || shellWin.isDestroyed()) throw new Error('셸 창이 만들어지지 않았다');
  mainMod.revealShell({ focus: true, force: true });
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

  // 지도 표면으로 간다 — 군집 지도는 라이브 렌더러 하나뿐이라 켤 토글이 없다.
  await wc.executeJavaScript(`(() => { document.getElementById('graphViewTab').click(); return true; })()`);
  await wait(2500);
  const liveState = await wc.executeJavaScript(`(() => {
    const frame = document.querySelector('#graphBody .graph-live-map');
    const canvas = frame ? frame.querySelector('canvas') : null;
    if (!canvas) return { ok: false, reason: 'live map canvas missing', hasVis: !!window.vis };
    const rect = frame.getBoundingClientRect();
    return {
      ok: true,
      // 네모 창(프레임)의 화면 크기. 확대해도 이 값이 안 변하는 것이 Neo4j 계약이다.
      frame: { w: Math.round(rect.width), h: Math.round(rect.height) },
      borderTop: getComputedStyle(frame).borderTopWidth,
      overflow: getComputedStyle(frame).overflow,
      svgCount: document.querySelectorAll('#graphBody svg.graph-canvas').length,
    };
  })()`);
  log(`      라이브 지도: ${JSON.stringify(liveState)}`);

  // 그래프 모드 채팅이 실제로 그래프를 보는지(2026-09-02) — 노드를 하나 고른 뒤
  // chat.js가 턴에 실어 보낼 컨텍스트를 그대로 찍는다. 여기가 비어 있으면 모델은
  // 다시 "종목 시세·차트 중 어느 쪽이냐"고 되묻는다.
  const chatContext = await wc.executeJavaScript(`(() => {
    const mode = window.AthenaCanvasMode;
    if (!mode || typeof mode.getContext !== 'function') return { ok: false, reason: 'getContext 없음' };
    const nodes = (window.__athenaGraphProbeNodes || []);
    const ctx = mode.getContext();
    return {
      ok: true,
      surface: ctx.surface,
      available: ctx.available,
      counts: ctx.counts,
      clusters: ctx.clusters.length,
      topSignals: ctx.topSignals.length,
      hiddenLinks: ctx.hiddenLinks.length,
      selected: ctx.selected ? ctx.selected.name : null,
      firstSignal: ctx.topSignals[0] ? ctx.topSignals[0].name : null,
      nodes: nodes.length,
    };
  })()`);
  log(`      채팅에 실리는 그래프 컨텍스트: ${JSON.stringify(chatContext)}`);

  // 배너 CTA가 실제로 채팅 입력에 문장을 심는지(2026-09-02) — 옛 판은 포커스만 줘서
  // 눌러도 아무 일이 없었다. 요약 표면으로 갔다가 눌러 보고, 원래 표면으로 돌아온다.
  const ctaSeed = await wc.executeJavaScript(`(async () => {
    document.getElementById('graphHeaderSummaryTab').click();
    await new Promise((r) => setTimeout(r, 1200));
    const cta = document.querySelector('#graphConfirmBanner .confirm-banner-cta');
    if (!cta) return { ok: false, reason: '확인 필요 배너가 없다(확인할 것이 0건일 수 있다)' };
    const before = document.getElementById('input').value;
    cta.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const after = document.getElementById('input').value;
    document.getElementById('graphViewTab').click();
    return { ok: after !== before && after.length > 0, before, after };
  })()`);
  log(`      배너 CTA가 심은 문장: ${JSON.stringify(ctaSeed)}`);

  // 입력창이 긴 글에서 자라는지(2026-09-02) — <input>이던 시절엔 한 줄에 갇혀
  // 가로로만 스크롤됐다. 한 줄 높이 / 긴 글 높이 / 상한을 함께 잰다.
  const grow = await wc.executeJavaScript(`(async () => {
    const el = document.getElementById('input');
    const row = document.querySelector('.input-row');
    const h = () => Math.round(el.getBoundingClientRect().height);
    const rowH = () => Math.round(row.getBoundingClientRect().height);
    el.value = '한 줄';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const one = { input: h(), row: rowH() };
    el.value = Array.from({ length: 6 }, (_, i) => '이건 긴 글입니다 ' + i).join(' 그리고 ');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const many = { input: h(), row: rowH() };
    el.value = Array.from({ length: 80 }, () => '아주 긴 글').join(' ');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const huge = { input: h(), row: rowH() };
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const reset = { input: h(), row: rowH() };
    return {
      tag: el.tagName,
      one, many, huge, reset,
      grew: many.input > one.input,
      capped: huge.input <= 168 + 1,
      shrankBack: reset.input === one.input,
    };
  })()`);
  log(`      입력창 자람: ${JSON.stringify(grow)}`);

  // 말풍선이 공백 없는 긴 글에서 상자를 뚫는지(2026-09-02 제보) — 가짜 턴을 하나
  // 붙여 실제로 재고 걷어낸다. 답변 쪽(.turn-a)에도 같은 규칙이 있는지 함께 본다.
  const bubble = await wc.executeJavaScript(`(() => {
    const history = document.getElementById('history');
    const line = document.createElement('div');
    line.className = 'turn';
    const q = document.createElement('div');
    q.className = 'turn-q';
    q.textContent = 'd' + 'f' + 's'.repeat(120);
    const a = document.createElement('div');
    a.className = 'turn-a';
    a.textContent = 'x'.repeat(200);
    line.appendChild(q); line.appendChild(a);
    history.appendChild(line);
    const m = (el) => {
      const r = el.getBoundingClientRect();
      return {
        w: Math.round(r.width),
        overflows: el.scrollWidth > el.clientWidth + 1,
        wrap: getComputedStyle(el).overflowWrap,
      };
    };
    const out = { q: m(q), a: m(a) };
    history.removeChild(line);
    return out;
  })()`);
  log(`      말풍선 줄바꿈: ${JSON.stringify(bubble)}`);

  // 자가 확인용 스크린샷 — 화면이 실제로 그려졌는지 사람 없이도 판별한다.
  await wait(4000);
  const shot = await shellWin.webContents.capturePage();
  const shotPath = path.join(REPO_DIR, 'artifacts', 'graph-proto', 'app-live-map.png');
  fs.mkdirSync(path.dirname(shotPath), { recursive: true });
  fs.writeFileSync(shotPath, shot.toPNG());
  log(`      스크린샷: ${shotPath}`);

  log('');
  log('창이 열렸습니다. 노드를 끌어 옮기고, 휠 또는 Ctrl+휠로 확대해 보세요.');
  log('창을 닫으면 백엔드도 함께 내려갑니다.');
}

main().catch((error) => {
  process.stderr.write(`${String((error && error.stack) || error)}\n`);
  app.exit(1);
});
