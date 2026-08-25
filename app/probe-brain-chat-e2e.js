
process.env.ATHENA_NO_AUTOSTART = '1';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const APP_DIR = __dirname;
const BACKEND_DIR = path.join(__dirname, '..', 'backend');
const PYTHON_EXE = path.join(BACKEND_DIR, '.venv', 'Scripts', 'python.exe');
// probe-boot-bounds.js와 같은 자리 — 산출물은 app/captures/에 모은다.
// (옛 경로 spike/cli-pipe/gateway/는 사라진 트리라, 쓰면 저장소 밖에 되살아났다.)
const OUT_PATH = path.join(__dirname, 'captures', 'PROBE-BRAIN-CHAT-E2E.json');

const BACKEND_PORT = 8011; // 기본(8010)과 겹치지 않는 포트 — 떠 있을 수 있는 다른 인스턴스와 충돌 회피
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const QUERY = '1+1은 얼마야? 숫자로만 짧게 대답해줘'; // 키움/카드 무관 — 텍스트 답변만 확인하면 충분
const CONVERSATION_QUERY_TIMEOUT_MS = 180_000;

// ---------- 임시 격리 경로 ----------
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-brain-e2e-'));
const brainDbPath = path.join(tmpRoot, 'brain.lbug');
const brainHistoryDbPath = path.join(tmpRoot, 'brain-history.sqlite3');
const userDataDir = path.join(tmpRoot, 'userdata');
const codexHomeDir = path.join(tmpRoot, 'codex-home');
fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(codexHomeDir, { recursive: true });
fs.writeFileSync(
  path.join(userDataDir, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }, null, 2),
  'utf-8'
);

const bearerToken = crypto.randomBytes(24).toString('hex');

process.env.CODEX_HOME = codexHomeDir; // cli-accounts.js의 detectCodex() — 실제 ~/.codex 비접촉

const report = {
  purpose: '실배선 E2E — claude -p 왕복 후 SQLite(source_records)에 chat_message user+assistant 2행 확인',
  ranAt: new Date().toISOString(),
  tmpRoot,
  backendUrl: BACKEND_URL,
  steps: {},
};

function log(msg) {
  console.log(`[probe] ${msg}`);
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function writeReportAndExit(code) {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2), 'utf-8');
  log(`report written: ${OUT_PATH}`);
  process.exitCode = code;
}

async function httpGet(url, headers) {
  const res = await fetch(url, { headers });
  let body = null;
  try { body = await res.json(); } catch { /* 본문 없음/비JSON */ }
  return { status: res.status, ok: res.ok, body };
}

let backendChild = null;
function killBackend() {
  if (!backendChild || backendChild.exitCode !== null || backendChild.signalCode !== null) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/PID', String(backendChild.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* 이미 죽어있으면 그만 */ }
  } else {
    try { backendChild.kill('SIGTERM'); } catch { /* 동일 */ }
  }
}

async function spawnBackend() {
  const env = {
    ...process.env,
    ATHENA_BRAIN_ENABLED: 'true',
    ATHENA_BRAIN_DB_PATH: brainDbPath,
    ATHENA_BRAIN_HISTORY_DB_PATH: brainHistoryDbPath,
    ATHENA_LOCAL_BEARER_TOKEN: bearerToken,
  };
  // LadybugDB 네이티브 DLL — 없으면 그래프는 강등되지만 history(sqlite)는 무관
  // (lifespan.py 주석: ingestion_ready는 history.open() 성공에만 묶인다). 그래도
  // 실측 규약대로 폴백 경로를 시도한다.
  if (!env.ATHENA_LADYBUG_DLL_DIR) {
    const fallback = 'C:\\Program Files\\Git\\mingw64\\bin';
    if (fs.existsSync(fallback)) env.ATHENA_LADYBUG_DLL_DIR = fallback;
  }

  const child = spawn(PYTHON_EXE, [
    '-m', 'uvicorn', 'athena_api.main:app',
    '--host', '127.0.0.1',
    '--port', String(BACKEND_PORT),
    '--workers', '1',
  ], {
    cwd: BACKEND_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
    env,
  });
  backendChild = child;
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.on('exit', (code, signal) => {
    log(`backend exited code=${code} signal=${signal}`);
  });

  const t0 = Date.now();
  const healthUrl = `${BACKEND_URL}/api/v1/llm/manifest`;
  let healthy = false;
  while (Date.now() - t0 < 30_000) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
      if (res.ok) { healthy = true; break; }
    } catch { /* 아직 안 떴다 */ }
    await wait(500);
  }
  return { healthy, elapsedMs: Date.now() - t0, stdoutTail: stdout.slice(-2000), stderrTail: stderr.slice(-2000) };
}

(async () => {
  let exitCode = 1;
  try {
    // ---------- 1) 백엔드 기동 ----------
    log(`spawning backend on ${BACKEND_URL} (tmp=${tmpRoot})`);
    const spawnResult = await spawnBackend();
    report.steps.backendSpawn = spawnResult;
    if (!spawnResult.healthy) {
      log('FAIL: backend did not become healthy');
      writeReportAndExit(1);
      return;
    }
    log(`backend healthy after ${spawnResult.elapsedMs}ms`);

    // ---------- 2) 브레인 상태 확인 ----------
    const statusRes = await httpGet(`${BACKEND_URL}/api/v1/brain/status`, { Authorization: `Bearer ${bearerToken}` });
    report.steps.brainStatus = statusRes;
    log(`brain/status: ${JSON.stringify(statusRes.body)}`);
    if (!statusRes.ok || !statusRes.body || statusRes.body.ingestion_ready !== true) {
      log('FAIL: ingestion_ready is not true — history save will not be attempted');
      writeReportAndExit(1);
      return;
    }

    // ---------- 3) Electron 기동 + IPC로 실질의 ----------
    process.env.ATHENA_BACKEND_URL = BACKEND_URL;
    process.env.ATHENA_LOCAL_BEARER_TOKEN = bearerToken;

    const { app } = require('electron');
    app.setPath('userData', userDataDir);
    await app.whenReady();
    log('electron ready');

    const mainMod = require(path.join(APP_DIR, 'main.js'));
    await mainMod.createWindows();
    log('windows created');
    const { shellWin } = mainMod.getWins();

    // history-sink.js의 canAttemptSave()는 brainReadyCache===true일 때만 통과한다.
    // 그 캐시는 정상 부팅 경로(main.js 하단 `if (!process.env.ATHENA_NO_AUTOSTART)`)의
    // ensureBackend().then(refreshBrainReady) fire-and-forget 훅에서만 채워지는데,
    // 이 프로브는 그 자동 기동 분기를 일부러 꺼뒀다(§backendLauncher 자동 스폰과
    // 충돌 방지) — 그래서 여기서 같은 모듈 인스턴스(require 캐시 — 절대경로가
    // main.js가 require하는 것과 동일)를 직접 불러 캐시를 명시적으로 채운다.
    // 안 하면 saveChatMessage()가 "해당 없음"으로 조용히 스킵되고(실측: 1차
    // 시도에서 rowCount=0으로 이렇게 재현됐다) POST 자체가 나가지 않는다.
    const historySink = require(path.join(APP_DIR, 'lib', 'main', 'history-sink.js'));
    const brainReady = await historySink.refreshBrainReady({ mdlog: log });
    report.steps.brainReadyCacheRefreshed = brainReady;
    log(`historySink brainReadyCache refreshed: ${brainReady}`);
    if (brainReady !== true) {
      log('FAIL: historySink brainReadyCache did not become true — save would be skipped');
      killBackend();
      writeReportAndExit(1);
      try { app.exit(1); } catch { /* ignore */ }
      return;
    }

    const startedAt = Date.now();
    const invokeScript = `window.athena.invoke('athena__render_canvas', ${JSON.stringify({ query: QUERY, expand: false })})`;
    let queryResult = null;
    let queryError = null;
    try {
      queryResult = await Promise.race([
        shellWin.webContents.executeJavaScript(invokeScript),
        wait(CONVERSATION_QUERY_TIMEOUT_MS).then(() => { throw new Error('probe-level timeout'); }),
      ]);
    } catch (err) {
      queryError = String((err && err.message) || err);
    }
    const elapsedMs = Date.now() - startedAt;
    report.steps.liveQuery = { query: QUERY, elapsedMs, result: queryResult, error: queryError };
    log(`live query done in ${elapsedMs}ms ok=${queryResult && queryResult.ok} error=${queryError}`);

    // fire-and-forget 저장이 실제 POST를 끝낼 시간을 준다(왕복 완료 후 소량의 여유).
    await wait(1500);

    // ---------- 4) SQLite 직접 조회 ----------
    // 스키마 실측(backend/athena_api/brain/history.py _SCHEMA + upsert_chat) —
    // source_records에는 role 컬럼이 없다. role은 metadata_json 안
    // {"chat": {"conversation_id", "role"}, "metadata": {...}}에 실린다.
    const pyScript = `
import json, sqlite3
path = ${JSON.stringify(brainHistoryDbPath)}
con = sqlite3.connect(path)
con.row_factory = sqlite3.Row
cur = con.cursor()
cur.execute(
    "SELECT source_id, source_kind, locator, text, metadata_json, occurred_at "
    "FROM source_records WHERE source_kind='chat_message' ORDER BY occurred_at ASC"
)
rows = [dict(r) for r in cur.fetchall()]
print(json.dumps({"rowCount": len(rows), "rows": rows}, ensure_ascii=False, default=str))
`;
    let sqliteResult = null;
    let sqliteError = null;
    try {
      const out = execFileSync(PYTHON_EXE, ['-c', pyScript], {
        cwd: BACKEND_DIR,
        encoding: 'utf-8',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
      sqliteResult = JSON.parse(out);
    } catch (err) {
      sqliteError = String((err && err.stderr && err.stderr.toString()) || (err && err.message) || err);
    }
    report.steps.sqliteQuery = { ok: sqliteResult !== null, error: sqliteError, result: sqliteResult };
    log(`sqlite query: rowCount=${sqliteResult && sqliteResult.rowCount} error=${sqliteError}`);

    // ---------- 5) 판정 ----------
    const answerNull = queryResult && queryResult.answerText === null;
    const expectedRows = answerNull ? 1 : 2;
    const rows = (sqliteResult && sqliteResult.rows) || [];
    const roles = rows.map((r) => {
      try { return JSON.parse(r.metadata_json).chat.role; } catch { return null; }
    });
    const hasUser = roles.includes('user');
    const hasAssistant = roles.includes('assistant');
    const sameLocator = rows.length >= 1 && rows.every((r) => r.locator === rows[0].locator);

    report.judgement = {
      answerTextWasNull: !!answerNull,
      expectedRowCount: expectedRows,
      actualRowCount: rows.length,
      hasUserRow: hasUser,
      hasAssistantRow: answerNull ? 'n/a (answerText was null)' : hasAssistant,
      sameConversationLocator: sameLocator,
      roles,
    };

    const pass = queryResult && queryResult.ok !== false && rows.length === expectedRows && hasUser
      && (answerNull || hasAssistant) && sameLocator;
    report.pass = !!pass;
    log(`PASS=${pass} rows=${rows.length}/${expectedRows} hasUser=${hasUser} hasAssistant=${hasAssistant} answerNull=${!!answerNull}`);

    exitCode = pass ? 0 : 1;

    // ---------- 정리 ----------
    try { app.exit(exitCode); } catch { /* 이미 종료 중일 수 있음 */ }
  } catch (err) {
    report.fatalError = String((err && err.stack) || err);
    log(`FATAL: ${report.fatalError}`);
    exitCode = 1;
  } finally {
    killBackend();
    writeReportAndExit(exitCode);
    // Electron이 app.exit()으로 이미 종료 중이 아니면 여기서 강제 종료.
    setTimeout(() => process.exit(exitCode), 500);
  }
})();
