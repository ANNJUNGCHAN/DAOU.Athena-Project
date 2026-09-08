'use strict';

/**
 * F-22 원인 규명 프로브 — "그래프 모드에서 '대화'를 눌러도 안 나가진다"(2026-09-03 실사용 제보).
 *
 * 왜 따로 필요한가: `verify-graph-mode.js` 13구역은 같은 버튼(#modeNavSummary)을
 * 눌러 **통과**한다. 그런데 실앱에서는 재기동 직후 깨끗한 상태에서도 재현된다.
 * 차이는 "무엇을 하다가 나가느냐"밖에 없다 — 그래서 이탈 직전 상태를 네 갈래로
 * 갈라 각각 이탈을 시도하고, state와 DOM을 함께 찍는다.
 *
 * state.view만 보면 안 되는 이유: 가시성의 소유자는 applyVisibility() 하나인데
 * (controller.js §325) 그것이 안 불린 것인지, 불렸는데 state가 안 바뀐 것인지,
 * state는 바뀌었는데 DOM이 안 따라온 것인지가 서로 다른 결함이다.
 *
 * 기동 절차는 play-graph-mode.js와 같다(임시 userData, 임시 브레인 SQLite, 동적
 * 루프백 포트, 실행마다 새 베어러, seed_long_term_etf_persona.py로 결정적 씨앗).
 *
 * 실행: cd app && npx electron probe-graph-mode-exit.js
 */

const { app } = require('electron');
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
const PROBE_ROOT = path.join(os.tmpdir(), 'athena-graph-exit-probe');
const BACKEND_READY_TIMEOUT_MS = 60_000;

app.disableHardwareAcceleration();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(line) {
  process.stdout.write(`${line}\n`);
}

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

// play-graph-mode.js와 같은 준비 신호를 쓴다 — 포트가 열린 것(/health)과 브레인이
// 읽을 수 있는 것(/brain/status의 ready)은 다르고, 이 프로브가 기다려야 하는 것은
// 후자다. 실패하면 마지막 사유를 그대로 싣는다("시간 안에 안 됐다"만으로는 못 고친다).
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
      } else {
        lastError = `HTTP ${res.status}`;
      }
    } catch (error) {
      lastError = String((error && error.message) || error);
    }
    await wait(400);
  }
  throw new Error(`백엔드가 시간 안에 준비되지 않았다: ${lastError}`);
}

// 이탈 직후 한 장의 사진. state(진실)와 DOM(보이는 것)을 같이 찍어야 셋 중
// 어느 층에서 끊겼는지 갈린다.
const SNAPSHOT = `(() => {
  const st = (window.AthenaCanvasMode && window.AthenaCanvasMode.state) || {};
  const h = (id) => { const el = document.getElementById(id); return el ? el.hidden : 'MISSING'; };
  return {
    view: st.view === undefined ? 'NO_STATE' : st.view,
    surface: st.surface === undefined ? 'NO_STATE' : st.surface,
    dom: {
      mosaic: h('mosaic'),
      graphCanvas: h('graphCanvas'),
      summaryTable: h('graphSummaryTable'),
      graphSettings: h('graphSettingsCanvas'),
      chatHead: h('chatModeHead'),
    },
    navActive: Array.from(document.querySelectorAll('.sidebar-mode-item.is-active')).map((e) => e.id),
    canvasRegionMode: (document.getElementById('canvasRegion') || {}).dataset
      ? document.getElementById('canvasRegion').dataset.mode : null,
  };
})()`;

// 이탈이 성공했다는 것의 정의 — 그래프 표면 셋이 전부 숨고, 대화 캔버스가 보이고,
// 그래프 채팅 헤더도 숨는다(verify-graph-mode.js 13구역과 같은 기준).
function exited(snap) {
  return snap.view === 'summary'
    && snap.dom.graphCanvas === true
    && snap.dom.summaryTable === true
    && snap.dom.graphSettings === true
    && snap.dom.mosaic === false
    && snap.dom.chatHead === true;
}

async function main() {
  if (!fs.existsSync(PYTHON_EXE)) throw new Error(`backend venv이 없다: ${PYTHON_EXE}`);

  const port = await reserveLoopbackPort();
  const backendUrl = `http://127.0.0.1:${port}`;
  const bearerToken = crypto.randomBytes(32).toString('hex');
  const userDataDir = path.join(PROBE_ROOT, 'user-data');
  const brainDbPath = path.join(PROBE_ROOT, 'brain.sqlite3');
  const chatOutboxPath = path.join(PROBE_ROOT, 'chat-outbox.sqlite3');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'athena-onboarding.json'),
    JSON.stringify({ cliDone: true, accountDone: true }, null, 2),
    'utf8',
  );
writeProbeModelPrefs(userDataDir);
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(`${brainDbPath}${suffix}`, { force: true }); } catch { /* 없으면 그만 */ }
  }

  // 모드별 대화를 심는다(lib/main/conversations.js normalizeState 스키마). 대화 행은
  // 첫 사용자 메시지에 생기므로(touch()) 모델을 부르지 않고서는 목록이 늘 비어 있고,
  // 그러면 "목록이 모드로 갈리는가"를 아예 잴 수 없다 — 그 판정만 SKIP으로 남았다.
  // 상태 파일을 직접 써서 잴 수 있게 만든다.
  const seededConversations = [
    { id: 'seed-chat-1', title: '씨앗 대화 1', mode: 'chat' },
    { id: 'seed-chat-2', title: '씨앗 대화 2', mode: 'chat' },
    { id: 'seed-graph-1', title: '씨앗 그래프 1', mode: 'graph' },
    { id: 'seed-backtest-1', title: '씨앗 백테스트 1', mode: 'backtest' },
  ];
  const seedIso = '2026-09-03T00:00:00.000Z';
  fs.writeFileSync(
    path.join(userDataDir, 'athena-conversations.json'),
    JSON.stringify({
      version: 2,
      activeId: null,
      activeMode: 'chat',
      currentProjectId: 'default',
      projects: [{ id: 'default', label: '기본 프로젝트' }],
      conversations: seededConversations.map((c) => ({
        ...c, createdAt: seedIso, updatedAt: seedIso, projectId: 'default', resumeSessionId: null,
      })),
    }, null, 2),
    'utf8',
  );
  const EXPECTED_RECENT = { summary: 2, graph: 1, backtest: 1 };

  log('[1/3] 성향 그래프 씨앗 중...');
  const seeded = spawnSync(PYTHON_EXE, [SEED_SCRIPT, '--db', brainDbPath], {
    cwd: BACKEND_DIR,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONPATH: BACKEND_DIR },
    encoding: 'utf8',
    windowsHide: true,
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
    ATHENA_CHAT_HISTORY_DB_PATH: chatOutboxPath,
    ATHENA_BRAIN_USE_CLAUDE_CLI_EXTRACTION: 'false',
    ATHENA_ROUTINES_ENABLED: 'false',
  });

  log(`[2/3] 백엔드 기동 중 (${backendUrl})...`);
  const backend = spawn(PYTHON_EXE, [
    '-m', 'uvicorn', 'athena_api.main:app',
    '--host', '127.0.0.1', '--port', String(port), '--workers', '1',
  ], {
    cwd: PROBE_ROOT,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONPATH: BACKEND_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
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
    const app = document.getElementById('app');
    if (app) app.hidden = false;
    const shell = document.getElementById('shell');
    if (shell) shell.hidden = false;
    return true;
  })()`);
  await wait(1500);

  const results = [];

  // 이탈 시도 한 번 = 그래프 진입 → (준비 동작) → '대화' 클릭 → 사진.
  async function scenario(name, prepareJs, prepareWaitMs) {
    // 매번 같은 출발선으로 되돌린다 — 앞 시나리오의 잔재가 다음 판정을 오염시키면
    // "어느 상태에서 깨지는가"라는 이 프로브의 질문 자체가 무의미해진다.
    await wc.executeJavaScript(`(() => { document.getElementById('modeNavSummary').click(); return true; })()`);
    await wait(600);
    await wc.executeJavaScript(`(() => { document.getElementById('modeNavGraph').click(); return true; })()`);
    await wait(1500);
    const entered = await wc.executeJavaScript(SNAPSHOT);

    if (prepareJs) {
      try {
        await wc.executeJavaScript(prepareJs);
      } catch (err) {
        log(`      [${name}] 준비 동작 실패: ${err && err.message}`);
      }
      await wait(prepareWaitMs || 800);
    }
    const before = await wc.executeJavaScript(SNAPSHOT);

    await wc.executeJavaScript(`(() => { document.getElementById('modeNavSummary').click(); return true; })()`);
    await wait(1200);
    const after = await wc.executeJavaScript(SNAPSHOT);

    const ok = exited(after);
    results.push({ name, ok, entered, before, after });
    log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) {
      log(`        진입 직후: ${JSON.stringify(entered)}`);
      log(`        이탈 직전: ${JSON.stringify(before)}`);
      log(`        이탈 직후: ${JSON.stringify(after)}`);
    }
  }

  log('');
  log('=== 이탈 시나리오 ===');

  // S1 — 하네스가 재는 그 경로. 여기가 깨지면 코드 자체가 문제다.
  await scenario('S1 진입 직후 바로 이탈(하네스와 동일)', null, 0);

  // S2 — 지도 서브뷰까지 간 뒤 이탈. surface가 map일 때만 깨질 수 있다.
  await scenario('S2 지도 서브뷰에서 이탈',
    `(() => { document.getElementById('graphViewTab').click(); return true; })()`, 2500);

  // S3 — 수집·노출 서브뷰에서 이탈.
  await scenario('S3 수집·노출 서브뷰에서 이탈',
    `(() => { document.getElementById('graphHeaderSettingsTab').click(); return true; })()`, 1500);

  // S4 — 노드를 골라 공통 패널을 열어 둔 채 이탈. 선택 상태가 남으면 깨질 수 있다.
  await scenario('S4 노드 선택(패널 열림) 상태에서 이탈', `(async () => {
    document.getElementById('graphHeaderSummaryTab').click();
    await new Promise((r) => setTimeout(r, 1200));
    const row = document.querySelector('#graphSummaryTable [data-entity-id]');
    if (row) row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return !!row;
  })()`, 1200);

  // S5 — 과거 대화를 복원한 뒤 이탈. 복원은 setView/setActive를 스스로 부른다
  // (chat.js restoreConversation) — 그 경로가 state를 어긋나게 두는지 본다.
  await scenario('S5 과거 대화 복원 후 이탈', `(async () => {
    const list = await window.athena.invoke('athena:conversations-list').catch(() => null);
    const convs = (list && Array.isArray(list.conversations)) ? list.conversations : [];
    if (!convs.length) return 'NO_CONVERSATIONS';
    await window.AthenaShell.openConversation({ id: convs[0].id, title: convs[0].title });
    return 'OPENED';
  })()`, 1500);

  // ── 채팅 쪽 이탈(F-1) ──────────────────────────────────────────────────────
  // 위 다섯이 다 통과해도 사용자는 "안 바뀐다"고 말했다. 캔버스만 보면 바뀌었고,
  // 그 사람이 보고 있던 것은 **채팅 기둥과 좌측 대화 목록**이었다. 모드를 바꿔도
  // 같은 스레드가 그대로 이어지면 화면 절반은 아직 그래프 모드다 — 그것을 잰다.
  log('');
  log('=== 채팅·대화목록 이탈 ===');

  // 사이드바 목록의 컨테이너는 #sidebarList다(lib/sidebar.js §20). listedCount는
  // IPC가 준 전체 건수(모드 무관)이고 recentCount가 실제로 그려진 것 — 모드 필터를
  // 재려면 후자를 봐야 한다.
  const CHAT_SNAPSHOT = `(async () => {
    const list = await window.athena.invoke('athena:conversations-list').catch(() => null);
    return {
      turns: document.querySelectorAll('#history .turn').length,
      historyText: (document.getElementById('history') || {}).textContent
        ? document.getElementById('history').textContent.trim().slice(0, 60) : '',
      activeId: list && list.activeId ? String(list.activeId) : null,
      listedCount: list && Array.isArray(list.conversations) ? list.conversations.length : null,
      recentCount: document.querySelectorAll('#sidebarList .sidebar-recent-conversation').length,
      recentTitles: Array.from(document.querySelectorAll('#sidebarList .sidebar-recent-conversation'))
        .map((e) => e.title),
      chatHeadHidden: (document.getElementById('chatModeHead') || {}).hidden,
    };
  })()`;

  await wc.executeJavaScript(`(() => { document.getElementById('modeNavSummary').click(); return true; })()`);
  await wait(600);
  await wc.executeJavaScript(`(() => { document.getElementById('modeNavGraph').click(); return true; })()`);
  await wait(1500);
  // 그래프 모드에서 턴 하나를 만든다 — 모델을 부르지 않고 DOM으로만 심는다.
  // 이 프로브가 재려는 것은 "모드를 나가면 이 턴이 사라지는가"이지 모델의 답이 아니다.
  await wc.executeJavaScript(`(() => {
    const h = document.getElementById('history');
    const line = document.createElement('div');
    line.className = 'turn';
    const q = document.createElement('div');
    q.className = 'turn-q';
    q.textContent = '그래프 모드에서 심은 턴';
    line.appendChild(q);
    h.appendChild(line);
    return true;
  })()`);
  await wait(300);
  const chatInGraph = await wc.executeJavaScript(CHAT_SNAPSHOT);

  await wc.executeJavaScript(`(() => { document.getElementById('modeNavSummary').click(); return true; })()`);
  await wait(1200);
  const chatAfterExit = await wc.executeJavaScript(CHAT_SNAPSHOT);

  const threadCarriedOver = chatAfterExit.turns === chatInGraph.turns
    && chatAfterExit.turns > 0;
  log(`  ${threadCarriedOver ? 'FAIL' : 'PASS'}  모드를 나가면 채팅 스레드가 갈린다`);
  log(`        그래프 모드: ${JSON.stringify(chatInGraph)}`);
  log(`        대화 모드  : ${JSON.stringify(chatAfterExit)}`);

  // 씨앗한 그래프 대화는 1건, 대화 모드 대화는 2건이라 모드를 나가면 그려진
  // 목록이 반드시 달라진다. 같으면 목록이 모드 경계를 안 따르는 것이다.
  const listChanged = chatAfterExit.recentCount !== chatInGraph.recentCount;
  log(`  ${listChanged ? 'PASS' : 'FAIL'}  모드를 나가면 대화 목록이 그 모드 것으로 갈린다`);

  results.push({
    name: '채팅·대화목록 이탈',
    ok: !threadCarriedOver && listChanged,
    chatInGraph,
    chatAfterExit,
  });

  // ── 대화 목록이 모드로 갈리는가 ────────────────────────────────────────────
  // 씨앗한 네 대화(대화 2 · 그래프 1 · 백테스트 1)를 놓고 모드를 옮겨 다니며
  // '최근' 섹션에 몇 개가 그려지는지 센다. 프로젝트 투영은 접혀 있을 수 있어
  // 따로 센다(둘 다 같은 filtered를 쓰므로 같은 경계를 따라야 한다).
  log('');
  log('=== 대화 목록 모드 필터 ===');
  const LIST_SNAPSHOT = `(() => ({
    recent: document.querySelectorAll('#sidebarList .sidebar-recent-conversation').length,
    project: document.querySelectorAll('#sidebarList .sidebar-project-conversation').length,
    titles: Array.from(document.querySelectorAll('#sidebarList .sidebar-recent-conversation'))
      .map((e) => e.title),
  }))()`;
  let listOk = true;
  for (const [view, expected] of Object.entries(EXPECTED_RECENT)) {
    await wc.executeJavaScript(`(() => { document.getElementById('modeNav${
      view === 'summary' ? 'Summary' : view.charAt(0).toUpperCase() + view.slice(1)
    }').click(); return true; })()`);
    await wait(1200);
    const snap = await wc.executeJavaScript(LIST_SNAPSHOT);
    const ok = snap.recent === expected;
    if (!ok) listOk = false;
    log(`  ${ok ? 'PASS' : 'FAIL'}  ${view} 모드의 '최근'은 ${expected}개 — 실제 ${snap.recent}개 ${JSON.stringify(snap.titles)}`);
  }
  results.push({ name: '대화 목록 모드 필터', ok: listOk });

  log('');
  log('=== 요약 ===');
  const failed = results.filter((r) => !r.ok);
  log(`  ${results.length - failed.length}/${results.length} 통과`);
  if (failed.length) log(`  실패: ${failed.map((r) => r.name).join(' · ')}`);

  const outPath = path.join(REPO_DIR, 'artifacts', 'graph-mode', 'probe-graph-mode-exit.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ results }, null, 2), 'utf8');
  log(`  기록: ${outPath}`);

  app.quit();
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  log(`프로브 실패: ${err && err.stack ? err.stack : err}`);
  try { app.quit(); } catch { /* 이미 죽었다 */ }
  process.exit(1);
});
