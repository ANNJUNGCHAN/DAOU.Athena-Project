'use strict';

/**
 * F-17 — "모델 → MCP 도구 → 백엔드" 전 구간을 실제로 도는 유일한 하네스.
 *
 * 왜 필요한가: `verify-graph-mode.js`는 이 구간을 **한 번도 타지 않는다.**
 *   · 10구역(노드 설명 조회)은 백엔드 REST를 직접 fetch한다(§857·§877).
 *   · 11구역(채팅 → 그래프 제어)은 `wc.send('athena:graph-chat-action', …)`으로
 *     IPC 봉투를 직접 주입한다(§949).
 * 둘 다 도구를 건너뛰고 그 **결과 모양**만 잰다. 그래서 2026-09-03 실사용에서
 * 도구 호출이 실제로 실패하는 동안에도 110개 검사가 전부 초록이었다.
 *
 * 이 프로브는 사람이 채팅에 치는 것과 같은 경로로 들어간다(athena:chat-submit →
 * dispatchUserQuery → claude → mcp__athena__athena_graph_view → 백엔드 →
 * tool_result → main.js maybeForwardGraphChatAction → 렌더러). 그래서 **느리고
 * 모델 의존적이다** — 단위 테스트가 아니라 프로브인 이유다. 판정은 모델의 말이
 * 아니라 ① 화면이 실제로 바뀌었는가 ② 그 도구의 진행 단계가 떴는가 둘로만 한다.
 *
 * 실행: cd app && npx electron probe-graph-model-tool-path.js
 * 산출: artifacts/graph-mode/probe-graph-model-tool-path.json
 */

const { app } = require('electron');
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
const PROBE_ROOT = path.join(os.tmpdir(), 'athena-graph-tool-path-probe');
const OUT_DIR = path.join(REPO_DIR, 'artifacts', 'graph-mode');
const BACKEND_READY_TIMEOUT_MS = 60_000;
// 모델 왕복이라 넉넉하게 — 실측 6~30초. 넘으면 "느린 것"과 "안 되는 것"을 가르지
// 못하므로 타임아웃 자체를 실패로 적는다(조용히 통과시키지 않는다).
const TURN_TIMEOUT_MS = 120_000;

app.disableHardwareAcceleration();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (line) => process.stdout.write(`${line}\n`);

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForBackendReady(url, token) {
  const started = Date.now();
  let lastError = 'no attempt';
  while (Date.now() - started < BACKEND_READY_TIMEOUT_MS) {
    try {
      const res = await fetch(`${url}/api/v1/brain/status`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const body = await res.json();
        if (body.ready) return body;
        lastError = `not ready: ${JSON.stringify(body)}`;
      } else lastError = `HTTP ${res.status}`;
    } catch (error) { lastError = String((error && error.message) || error); }
    await wait(400);
  }
  throw new Error(`백엔드가 시간 안에 준비되지 않았다: ${lastError}`);
}

// 사람이 입력창에 치고 Enter를 누른 것과 같은 경로(chat.js §3940 수신부).
const submitJs = (text) => `(() => {
  document.dispatchEvent(new CustomEvent('athena:chat-submit', { detail: { text: ${JSON.stringify(text)} } }));
  return true;
})()`;

// 턴이 끝났는가 — 잠금 힌트가 사라지면 끝이다(setLocked(false), chat.js §860).
const IDLE = `(() => {
  const hint = document.getElementById('lockHint');
  return { ok: !!hint && hint.hidden === true };
})()`;

// 이 턴에 뜬 도구 단계의 라벨들 + 화면 상태. 라벨은 main.js TOOL_STEP_LABELS가
// 준다 — '처리 중'이면 라벨 없는 도구라는 뜻이다(F-18에서 그것도 고쳤다).
const SNAPSHOT = `(() => {
  const st = (window.AthenaCanvasMode && window.AthenaCanvasMode.state) || {};
  return {
    toolLabels: Array.from(document.querySelectorAll('#history .progress-tool-step-label'))
      .map((e) => e.textContent),
    failedSteps: Array.from(document.querySelectorAll('#history .progress-tool-step'))
      .filter((e) => /실패/.test(e.textContent || '')).map((e) => e.textContent.trim()),
    view: st.view,
    surface: st.surface,
    selectedEntityId: st.selectedEntityId || null,
    answerText: (() => {
      const turns = document.querySelectorAll('#history .turn-a');
      const last = turns[turns.length - 1];
      return last ? last.textContent.trim().slice(0, 200) : '';
    })(),
  };
})()`;

async function runTurn(wc, text) {
  await wc.executeJavaScript(submitJs(text));
  const started = Date.now();
  // 잠금이 걸리기까지 잠깐 기다린다 — 바로 IDLE을 보면 시작 전 상태를 끝으로 읽는다.
  await wait(1500);
  while (Date.now() - started < TURN_TIMEOUT_MS) {
    const idle = await wc.executeJavaScript(IDLE);
    if (idle.ok) return { timedOut: false, elapsedMs: Date.now() - started };
    await wait(1000);
  }
  return { timedOut: true, elapsedMs: Date.now() - started };
}

async function main() {
  if (!fs.existsSync(PYTHON_EXE)) throw new Error(`backend venv이 없다: ${PYTHON_EXE}`);
  const port = await reserveLoopbackPort();
  const backendUrl = `http://127.0.0.1:${port}`;
  const bearerToken = crypto.randomBytes(32).toString('hex');
  const userDataDir = path.join(PROBE_ROOT, 'user-data');
  const brainDbPath = path.join(PROBE_ROOT, 'brain.sqlite3');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'athena-onboarding.json'),
    JSON.stringify({ cliDone: true, accountDone: true }, null, 2), 'utf8',
  );
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(`${brainDbPath}${suffix}`, { force: true }); } catch { /* 없으면 그만 */ }
  }

  log('[1/3] 성향 그래프 씨앗 중...');
  const seeded = spawnSync(PYTHON_EXE, [SEED_SCRIPT, '--db', brainDbPath], {
    cwd: BACKEND_DIR,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONPATH: BACKEND_DIR },
    encoding: 'utf8', windowsHide: true,
  });
  if (seeded.status !== 0) throw new Error(`페르소나 씨앗 실패: ${seeded.stderr || seeded.stdout}`);

  Object.assign(process.env, {
    ATHENA_NO_AUTOSTART: '1',
    ATHENA_CANVAS_SOURCE: 'live',
    ATHENA_BACKEND_URL: backendUrl,
    ATHENA_LOCAL_BEARER_TOKEN: bearerToken,
    ATHENA_BRAIN_ENABLED: 'true',
    ATHENA_BRAIN_DB_PATH: brainDbPath,
    ATHENA_BRAIN_HISTORY_DB_PATH: brainDbPath,
    ATHENA_CHAT_HISTORY_DB_PATH: path.join(PROBE_ROOT, 'chat-outbox.sqlite3'),
    ATHENA_BRAIN_USE_CLAUDE_CLI_EXTRACTION: 'false',
    ATHENA_ROUTINES_ENABLED: 'false',
  });

  log(`[2/3] 백엔드 기동 중 (${backendUrl})...`);
  const backend = spawn(PYTHON_EXE, [
    '-m', 'uvicorn', 'athena_api.main:app', '--host', '127.0.0.1', '--port', String(port), '--workers', '1',
  ], {
    cwd: PROBE_ROOT,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONPATH: BACKEND_DIR },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  backend.stdout.on('data', () => {});
  backend.stderr.on('data', () => {});
  const stopBackend = () => { try { backend.kill(); } catch { /* 이미 죽었다 */ } };
  app.on('before-quit', stopBackend);
  process.on('exit', stopBackend);
  await waitForBackendReady(backendUrl, bearerToken);
  await fetch(`${backendUrl}/api/v1/settings/expose-to-model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearerToken}` },
    body: JSON.stringify({ enabled: true }),
  });

  log('[3/3] 셸 기동 중...');
  app.setPath('userData', userDataDir);
  await app.whenReady();
  const mainMod = require(path.join(APP_DIR, 'main.js'));
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  if (!shellWin || shellWin.isDestroyed()) throw new Error('셸 창이 만들어지지 않았다');
  const wc = shellWin.webContents;

  await wc.executeJavaScript(`(() => {
    for (const id of ['boot', 'onboard', 'settings', 'order']) {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    }
    document.getElementById('app').hidden = false;
    document.getElementById('shell').hidden = false;
    return true;
  })()`);
  await wait(1200);
  await wc.executeJavaScript(`(() => { document.getElementById('modeNavGraph').click(); return true; })()`);
  await wait(1800);

  const problems = [];
  const results = [];

  // 시나리오 — 각각 **모델이 도구를 부르지 않으면 통과할 수 없는** 것만 고른다.
  // "설명해줘" 같은 질문은 모델이 말로만 답해도 그럴듯해서 판정이 안 된다.
  const scenarios = [
    {
      name: '지도로 옮기기(athena_graph_view action=navigate)',
      text: '지도로 바꿔줘',
      expectLabel: '그래프 화면 제어',
      check: (s) => s.surface === 'map',
      why: 'state.surface가 map이 되어야 한다 — 말로만 답하면 안 바뀐다',
    },
    {
      name: '기간 좁히기(athena_graph_view action=filter)',
      text: '최근 30일로 좁혀줘',
      expectLabel: '그래프 화면 제어',
      check: () => true, // 아래에서 prefs를 따로 읽는다
      why: '헤더 칩이 30일로 바뀌어야 한다',
      after: async () => {
        const prefs = await wc.executeJavaScript(
          '(() => window.AthenaLib.GraphModePrefs.readPrefs())()',
        );
        return { pass: prefs.windowDays === 30, detail: prefs };
      },
    },
    {
      name: '노드 설명 조회(athena_brain action=entity)',
      text: '삼성화재에 대해 그래프가 뭘 알고 있어?',
      expectLabel: '성향 그래프 조회',
      check: () => true,
      why: '도구 단계가 떠야 한다 — 모델이 지어내면 이 단계가 없다',
    },
  ];

  for (const sc of scenarios) {
    log('');
    log(`=== ${sc.name} ===`);
    const before = await wc.executeJavaScript(SNAPSHOT);
    const turn = await runTurn(wc, sc.text);
    const after = await wc.executeJavaScript(SNAPSHOT);
    const newLabels = after.toolLabels.slice(before.toolLabels.length);

    const checks = [];
    checks.push(['턴이 끝났다', !turn.timedOut, `${Math.round(turn.elapsedMs / 1000)}s`]);
    checks.push([
      `도구 단계 "${sc.expectLabel}"이 떴다`,
      newLabels.includes(sc.expectLabel),
      newLabels,
    ]);
    // 이 턴에 **새로** 생긴 실패만 센다. 예전 판은 #history 전체를 훑어서 1번
    // 시나리오의 실패를 2·3번에서도 계속 다시 세 거짓 실패를 냈다.
    const newFailures = after.failedSteps.slice(before.failedSteps.length);
    checks.push(['이 턴에 실패한 도구 단계가 없다', newFailures.length === 0, newFailures]);
    checks.push([sc.why, sc.check(after), { surface: after.surface, view: after.view }]);
    if (sc.after) {
      const extra = await sc.after();
      checks.push([`${sc.why}(실값)`, extra.pass, extra.detail]);
    }

    for (const [name, ok, detail] of checks) {
      log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
      if (!ok) problems.push(`${sc.name} / ${name}`);
    }
    log(`         모델의 답: ${JSON.stringify(after.answerText.slice(0, 120))}`);
    results.push({ scenario: sc.name, elapsedMs: turn.elapsedMs, newLabels, after });
  }

  log('');
  log('=== 요약 ===');
  log(`  ${problems.length ? `실패 ${problems.length}건` : '전부 통과'}`);
  for (const p of problems) log(`    · ${p}`);

  const outPath = path.join(OUT_DIR, 'probe-graph-model-tool-path.json');
  fs.writeFileSync(outPath, JSON.stringify({ problems, results }, null, 2), 'utf8');
  log(`  기록: ${outPath}`);

  app.quit();
  process.exit(problems.length ? 1 : 0);
}

main().catch((err) => {
  log(`프로브 실패: ${err && err.stack ? err.stack : err}`);
  try { app.quit(); } catch { /* 이미 죽었다 */ }
  process.exit(1);
});
