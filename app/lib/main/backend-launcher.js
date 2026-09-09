'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { BACKEND_DIR, PYTHON_EXE } = require('./mcp-config');
const { killTree } = require('./proc-utils');

const HEALTH_HOST = '127.0.0.1';
const HEALTH_PORT = 8010;
const HEALTH_URL = `http://${HEALTH_HOST}:${HEALTH_PORT}/api/v1/llm/manifest`;
const HEALTH_TIMEOUT_MS = 1500;
const STARTUP_POLL_TIMEOUT_MS = 12_000;
const STARTUP_HARD_TIMEOUT_MS = 60_000;
const STARTUP_POLL_INTERVAL_MS = 500;
// self-spawn 백엔드의 stdout/stderr — 예전엔 'ignore'로 버려서 code=3(lifespan 실패)의
// 이유가 어디에도 남지 않았다(2026-09-07 실측: 자격증명 프로세스 잠금 충돌이 원인).
const BACKEND_LOG_PATH = path.join(os.homedir(), '.athena', 'logs', 'backend-uvicorn.log');
const OUTPUT_TAIL_LINES = 40;
const EXISTING_BACKEND_CHECK_ATTEMPTS = 3;
const UVICORN_ARGS = [
  '-m', 'uvicorn', 'athena_api.main:app',
  '--host', HEALTH_HOST,
  '--port', String(HEALTH_PORT),
  '--workers', '1',
];

// 순수 함수 — spawn 인자 조립. 매 호출 새 배열을 돌려준다(호출자가 변형해도 상수 오염 없음).
function buildUvicornArgs() {
  return [...UVICORN_ARGS];
}

function buildBackendEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  if (!Object.prototype.hasOwnProperty.call(baseEnv, 'ATHENA_BRAIN_ENABLED')) {
    env.ATHENA_BRAIN_ENABLED = 'true';
  }
  if (!Object.prototype.hasOwnProperty.call(baseEnv, 'ATHENA_ROUTINES_ENABLED')) {
    env.ATHENA_ROUTINES_ENABLED = 'true';
  }
  // 백테스트 모드(2026-09-02) — 앱이 띄우는 백엔드는 백테스트 서브시스템을 켠다. 이 줄이
  // 없으면 사이드바 다섯 번째 모드가 503(비활성)으로 죽어 있고, 어느 프로세스가 먼저
  // 8010을 잡느냐에 따라 켜졌다 꺼졌다 한다(2026-09-02 실측). 외부에서 명시하면 그 값을 따른다.
  if (!Object.prototype.hasOwnProperty.call(baseEnv, 'ATHENA_BACKTEST_ENABLED')) {
    env.ATHENA_BACKTEST_ENABLED = 'true';
  }
  if (!Object.prototype.hasOwnProperty.call(baseEnv, 'ATHENA_BRAIN_INGEST_SCHEDULE_OWNER')) {
    env.ATHENA_BRAIN_INGEST_SCHEDULE_OWNER = 'external';
  }
  const hasExtractionArgv = Object.prototype.hasOwnProperty.call(
    baseEnv, 'ATHENA_BRAIN_EXTRACTION_LLM_ARGV',
  );
  const hasClaudeExtractionOverride = Object.prototype.hasOwnProperty.call(
    baseEnv, 'ATHENA_BRAIN_USE_CLAUDE_CLI_EXTRACTION',
  );
  if (!hasExtractionArgv && !hasClaudeExtractionOverride) {
    // 제품 앱이 직접 띄운 backend는 대화 기반 그래프를 실제로 구성해야 한다.
    // 외부에서 띄운 backend의 환경은 건드릴 수 없으므로 brain status gate가
    // extraction_enabled=false를 정직한 degraded 원인으로 보고한다.
    env.ATHENA_BRAIN_USE_CLAUDE_CLI_EXTRACTION = 'true';
  }
  return env;
}

// 순수 판정 — 헬스 상태·venv 존재 여부만으로 무엇을 할지 결정한다. fetch/spawn과
// 분리해 net·fs 의존 없이 단위 테스트한다.
function decideAction({ healthy, venvExists }) {
  if (healthy) return 'already-running';
  if (!venvExists) return 'no-venv';
  return 'spawn';
}

function venvExists() {
  return fs.existsSync(PYTHON_EXE);
}

async function checkHealth(url = HEALTH_URL, timeoutMs = HEALTH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return !!(res && res.ok);
  } catch {
    return false; // 타임아웃·연결거부·DNS 등 전부 "안 떠 있다"로 취급 — fail-open이 아니라 스폰 판단으로 이어진다
  } finally {
    clearTimeout(timer);
  }
}

async function waitUntilHealthy(timeoutMs, intervalMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await checkHealth()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function captureChildOutput(child, logPath) {
  const tail = [];
  const streams = [child.stdout, child.stderr].filter((stream) => stream && typeof stream.on === 'function');
  if (!streams.length) return () => tail; // 파이프가 없는 child(테스트 더미)는 파일도 만들지 않는다.
  let sink = null;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    sink = fs.createWriteStream(logPath, { flags: 'a' });
    sink.on('error', () => { sink = null; });
    sink.write(`===== ${new Date().toISOString()} uvicorn spawn pid=${child.pid} =====\n`);
  } catch {
    sink = null;
  }
  const onChunk = (chunk) => {
    const text = String(chunk);
    if (sink) sink.write(text);
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      tail.push(line);
      if (tail.length > OUTPUT_TAIL_LINES) tail.shift();
    }
  };
  for (const stream of streams) stream.on('data', onChunk);
  child.once('exit', () => { if (sink) sink.end(); });
  return () => [...tail];
}

// 마지막 예외 줄 — traceback 본문(들여쓰기 줄)과 uvicorn 배너("ERROR:    Application
// startup failed.")는 건너뛰고 `XxxError: ...` 꼴의 최상위 줄만 고른다. 예외가 없이
// 죽었으면(hard deadline에 우리가 죽인 경우 등) 빈 문자열이다 — 마지막 접근 로그를
// 실패 이유처럼 보이게 하지 않는다.
function summarizeStartupFailure(lines) {
  const exceptions = lines.filter((line) => /^[A-Za-z_][\w.]*(?:Error|Exception)\b/.test(line));
  return String(exceptions[exceptions.length - 1] || '').slice(0, 300);
}

// process_lock.py의 충돌 문구 — 다른 backend가 같은 자격증명·브레인 파일을 이미 쥐고
// 기동 중이라는 뜻이다. 이때 우리가 다시 스폰해도 같은 이유로 죽으므로, 그쪽이
// 준비될 때까지 헬스만 기다린다.
function isLockContention(lines) {
  return /already (?:running|owns|holds)/i.test(lines.join('\n'));
}

// 직전 self-spawn이 기동 단계에서 죽은 기록 — ensureBackendReady 루프가 같은 실패를
// 12초마다 반복 스폰하지 않게 한다. 헬스체크가 성공하거나 hard deadline이 지나면 잊는다.
let lastStartupFailure = null;

// 우리가 스폰한 child 핸들 — 정확히 하나만 유지한다. before-quit이 이 값의
// 존재 여부로 "우리가 스폰했는가"를 판정한다(사용자 기동 인스턴스는 이 변수에
// 잡히지 않으므로 절대 안 건드린다).
let backendChild = null;
let backendReadinessWatch = null;

function cancelBackendReadinessWatch(child = null) {
  const watch = backendReadinessWatch;
  if (!watch || (child && watch.child !== child)) return false;
  watch.cancelled = true;
  if (watch.pollTimer !== null) watch.clearTimeoutFn(watch.pollTimer);
  if (watch.hardTimer !== null) watch.clearTimeoutFn(watch.hardTimer);
  backendReadinessWatch = null;
  return true;
}

function watchBackendUntilHardDeadline({
  child,
  spawnAt,
  log,
  checkHealthFn,
  killTreeFn = killTree,
  nowFn = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  pollIntervalMs = STARTUP_POLL_INTERVAL_MS,
  hardTimeoutMs = STARTUP_HARD_TIMEOUT_MS,
  deadlineAt = spawnAt + hardTimeoutMs,
}) {
  cancelBackendReadinessWatch();
  const watch = {
    child, cancelled: false, pollTimer: null, hardTimer: null, clearTimeoutFn,
  };
  backendReadinessWatch = watch;

  const isCurrent = () => !watch.cancelled
    && backendReadinessWatch === watch
    && backendChild === child;

  const retireHungChild = async () => {
    if (!isCurrent()) return;
    const healthy = await checkHealthFn();
    if (!isCurrent()) {
      if (backendReadinessWatch === watch) cancelBackendReadinessWatch(child);
      return;
    }
    if (healthy) {
      cancelBackendReadinessWatch(child);
      log(`ensureBackend: hard deadline 최종 readiness 확인 완료 — self-spawn 프로세스를 유지한다 (${nowFn() - spawnAt}ms)`);
      return;
    }
    cancelBackendReadinessWatch(child);
    if (backendChild !== child) return;
    backendChild = null;
    log(`ensureBackend: ${hardTimeoutMs}ms hard deadline 초과 — 응답 없는 self-spawn 프로세스만 정리한다`);
    killTreeFn(child);
  };

  const poll = async () => {
    if (!isCurrent()) return;
    const healthy = await checkHealthFn();
    if (!isCurrent()) return;
    if (healthy) {
      cancelBackendReadinessWatch(child);
      log(`ensureBackend: background readiness 확인 완료 — self-spawn 프로세스를 유지한다 (${nowFn() - spawnAt}ms)`);
      return;
    }
    const remainingMs = Math.max(0, deadlineAt - nowFn());
    if (remainingMs === 0) {
      await retireHungChild();
      return;
    }
    watch.pollTimer = setTimeoutFn(poll, Math.min(pollIntervalMs, remainingMs));
  };

  const remainingMs = Math.max(0, deadlineAt - nowFn());
  watch.hardTimer = setTimeoutFn(retireHungChild, remainingMs);
  watch.pollTimer = setTimeoutFn(poll, Math.min(pollIntervalMs, remainingMs));
}

// 앱 부팅 시 fire-and-forget으로 부른다(main.js — createWindows()를 막지 않는다).
// mdlog는 main.js의 파일 로거(선택) — 없으면 조용히 무시한다.
async function ensureBackend({ mdlog, _dependencies = {} } = {}) {
  const log = typeof mdlog === 'function' ? mdlog : () => {};
  const checkHealthFn = _dependencies.checkHealthFn || checkHealth;
  const venvExistsFn = _dependencies.venvExistsFn || venvExists;
  const spawnFn = _dependencies.spawnFn || spawn;
  const waitUntilHealthyFn = _dependencies.waitUntilHealthyFn || waitUntilHealthy;
  const killTreeFn = _dependencies.killTreeFn || killTree;
  const nowFn = _dependencies.nowFn || Date.now;
  const setTimeoutFn = _dependencies.setTimeoutFn || setTimeout;
  const clearTimeoutFn = _dependencies.clearTimeoutFn || clearTimeout;
  const hardTimeoutMs = _dependencies.hardTimeoutMs || STARTUP_HARD_TIMEOUT_MS;
  const pollIntervalMs = _dependencies.pollIntervalMs || STARTUP_POLL_INTERVAL_MS;
  const existingBackendCheckAttempts = _dependencies.existingBackendCheckAttempts
    || EXISTING_BACKEND_CHECK_ATTEMPTS;
  const t0 = nowFn();
  let healthy = false;
  let healthAttempt = 0;
  while (!healthy && healthAttempt < existingBackendCheckAttempts) {
    healthAttempt += 1;
    healthy = await checkHealthFn();
    if (healthy) lastStartupFailure = null;
    if (!healthy && backendChild) {
      log('ensureBackend: 기존 self-spawn 백엔드가 아직 기동 중 — 중복 스폰하지 않는다');
      return { ok: true, spawned: false, ready: false, reason: 'startup-pending' };
    }
  }
  if (!healthy && lastStartupFailure && nowFn() - lastStartupFailure.at < hardTimeoutMs) {
    if (lastStartupFailure.contention) {
      log('ensureBackend: 다른 백엔드가 잠금을 쥐고 기동 중 — 재스폰하지 않고 준비를 기다린다');
      return {
        ok: true, spawned: false, ready: false, reason: 'startup-contended', error: lastStartupFailure.summary,
      };
    }
    return {
      ok: false,
      spawned: false,
      ready: false,
      reason: 'startup-failed',
      error: `백엔드 기동 실패(code=${lastStartupFailure.code}) — ${lastStartupFailure.summary}`,
    };
  }

  const action = decideAction({ healthy, venvExists: venvExistsFn() });

  if (action === 'already-running') {
    if (backendChild) cancelBackendReadinessWatch(backendChild);
    log(`ensureBackend: 헬스체크 성공 — 이미 기동 중이라 스폰하지 않는다 (${nowFn() - t0}ms, attempt=${healthAttempt}, ${HEALTH_URL})`);
    return { ok: true, spawned: false, ready: true, reason: 'already-running' };
  }
  if (action === 'no-venv') {
    log(`ensureBackend: ${PYTHON_EXE} 없음 — backend/.venv 미설치(개발 레이아웃 전제)`);
    return { ok: false, spawned: false, ready: false, reason: 'no-venv', error: 'backend virtualenv missing' };
  }

  log(`ensureBackend: 헬스체크 실패 — 백엔드 스폰 (${PYTHON_EXE} ${buildUvicornArgs().join(' ')}, cwd=${BACKEND_DIR})`);
  const spawnAt = nowFn(); // 부팅 지연 계측(합의 계획 W1) — "스폰→manifest 200" 구간의 시작점
  let child;
  try {
    child = spawnFn(PYTHON_EXE, buildUvicornArgs(), {
      cwd: BACKEND_DIR,
      env: buildBackendEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // claude-runner.js와 같은 이유(실측, 2026-08-17) — shell:true는 Windows에서
      // 인자 재조립 중 문제가 생길 수 있다. python.exe는 실행파일이라 셸이 필요 없다.
      shell: false,
    });
  } catch (err) {
    const message = String((err && err.message) || err);
    log(`ensureBackend: 스폰 실패 — ${message}`);
    return { ok: false, spawned: false, error: message };
  }
  backendChild = child;
  lastStartupFailure = null;
  const outputTail = captureChildOutput(child, _dependencies.backendLogPath || BACKEND_LOG_PATH);
  child.on('exit', (code, signal) => {
    const lines = outputTail();
    const summary = summarizeStartupFailure(lines);
    log(`ensureBackend: 백엔드 프로세스 종료 감지 — code=${code} signal=${signal}${summary ? ` — ${summary}` : ''}`);
    // 스폰 뒤 hard deadline 안에 0이 아닌 코드로 죽었다 = 기동 단계 실패. (hard deadline
    // 초과로 우리가 죽인 경우는 retireHungChild가 backendChild를 먼저 비운다.)
    if (code !== 0 && code !== null && backendChild === child && nowFn() - spawnAt < hardTimeoutMs) {
      lastStartupFailure = { at: nowFn(), code, summary, contention: isLockContention(lines) };
    }
    cancelBackendReadinessWatch(child);
    if (backendChild === child) backendChild = null;
  });
  child.on('error', (err) => {
    log(`ensureBackend: 백엔드 프로세스 에러 — ${String((err && err.message) || err)}`);
    cancelBackendReadinessWatch(child);
    if (backendChild === child) backendChild = null;
  });

  const ready = await waitUntilHealthyFn(STARTUP_POLL_TIMEOUT_MS, STARTUP_POLL_INTERVAL_MS);
  const elapsedMs = nowFn() - t0;
  const spawnToHealthyMs = nowFn() - spawnAt;
  if (ready) {
    log(`ensureBackend: 기동 완료 — 준비까지 ${elapsedMs}ms (스폰→manifest 200: ${spawnToHealthyMs}ms)`);
  } else {
    log(`ensureBackend: ${STARTUP_POLL_TIMEOUT_MS}ms 안에 준비 확인 실패 — self-spawn 프로세스는 계속 기동한다(elapsed=${elapsedMs}ms, 스폰 이후=${spawnToHealthyMs}ms)`);
    if (backendChild === child) {
      watchBackendUntilHardDeadline({
        child, spawnAt, log, checkHealthFn, killTreeFn, nowFn,
        setTimeoutFn, clearTimeoutFn, pollIntervalMs, hardTimeoutMs,
        deadlineAt: t0 + hardTimeoutMs,
      });
    }
    return {
      ok: true, spawned: true, ready: false, reason: 'readiness-pending', elapsedMs, spawnToHealthyMs,
    };
  }
  return { ok: true, spawned: true, ready, elapsedMs, spawnToHealthyMs };
}

async function ensureBackendReady({ mdlog, onProgress, _dependencies = {} } = {}) {
  const ensureBackendFn = _dependencies.ensureBackendFn || ensureBackend;
  const nowFn = _dependencies.nowFn || Date.now;
  const sleepFn = _dependencies.sleepFn
    || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const hardTimeoutMs = _dependencies.hardTimeoutMs || STARTUP_HARD_TIMEOUT_MS;
  const pollIntervalMs = _dependencies.pollIntervalMs || STARTUP_POLL_INTERVAL_MS;
  const startedAt = nowFn();
  let lastResult = null;

  while (nowFn() - startedAt < hardTimeoutMs) {
    lastResult = await ensureBackendFn({ mdlog });
    if (!lastResult || lastResult.ok !== true) {
      return lastResult || {
        ok: false, ready: false, reason: 'backend-start-failed', error: 'backend start failed',
      };
    }
    if (lastResult.ready === true) return lastResult;

    const elapsedMs = nowFn() - startedAt;
    const remainingMs = Math.max(0, hardTimeoutMs - elapsedMs);
    if (typeof onProgress === 'function') {
      onProgress({
        elapsedMs,
        remainingMs,
        reason: lastResult.reason || 'readiness-pending',
      });
    }
    if (remainingMs === 0) break;
    await sleepFn(Math.min(pollIntervalMs, remainingMs));
  }

  return {
    ok: false,
    ready: false,
    reason: 'readiness-hard-timeout',
    error: lastResult && lastResult.error
      ? `backend readiness hard timeout — ${lastResult.error}`
      : 'backend readiness hard timeout',
    lastResult,
  };
}

// 우리가 스폰한 경우에만 트리를 끊는다 — 사용자가 별도로 기동한 인스턴스는
// backendChild에 잡히지 않으므로 이 함수는 그런 인스턴스에 대해 no-op이다.
function shutdownBackend({ killTreeFn = killTree } = {}) {
  if (backendChild) {
    cancelBackendReadinessWatch(backendChild);
    killTreeFn(backendChild);
    backendChild = null;
  }
}

// ---------- 리셋(전체 삭제) 후 재기동 — .omc/plans/plan-chat-graph-pipeline.md §2(f) ----------
// 전역 child.on('exit')(위, ensureBackend 안)은 절대 건드리지 않는다 — 여긴 그
// 훅과 별개로, 리셋 IPC 핸들러가 명시적으로 부를 때만 동작하는 **추가** 1회성
// 리스너다(같은 EventEmitter에 리스너를 여러 개 다는 것은 정상 Node 동작이라
// 기존 훅과 충돌하지 않는다). awaitChildExit은 순수 함수(어떤 EventEmitter든
// 받는다)라 실제 프로세스 없이 단위 테스트할 수 있다.
function awaitChildExit(child) {
  if (!child) return Promise.resolve(false);
  return new Promise((resolve) => {
    child.once('exit', () => resolve(true));
  });
}

// 백엔드의 POST /api/v1/brain/reset-and-restart가 200을 반환한 뒤 호출한다.
// (a) 이 프로세스가 스폰한 인스턴스가 아니면(backendChild 없음) 아무것도 하지
//     않는다 — 재기동은 그 인스턴스를 띄운 쪽(사용자 콘솔)의 몫이다. 자동 재시도
//     없음(기각 — 계획 §6 "비자가스폰 재기동 UX는 범위 밖").
// (b) 스폰한 인스턴스면 그 프로세스 자신이 이미 SIGTERM으로 죽어가는 중이다
//     (backend/athena_api/api/brain.py의 reset 라우트가 응답 flush 후 스스로
//     보낸다) — exit을 1회성으로 기다렸다가 **명시적으로** ensureBackend()를
//     다시 부른다(자동 재스폰 훅이 아니라 이 함수가 매번 의도적으로 부른다).
// ensureBackendFn은 테스트 주입 지점 — 기본값은 실제 ensureBackend다.
async function restartAfterReset({ mdlog, ensureBackendFn = ensureBackend } = {}) {
  const log = typeof mdlog === 'function' ? mdlog : () => {};
  if (!backendChild) {
    log('restartAfterReset: 이 앱이 스폰한 백엔드가 아니다 — 수동 재시작 필요');
    return { selfSpawned: false, restarted: false };
  }
  log('restartAfterReset: 자가스폰 백엔드 — 프로세스 종료를 기다린다');
  await awaitChildExit(backendChild);
  log('restartAfterReset: 종료 확인 — ensureBackend()를 명시적으로 재호출한다');
  const ensureResult = await ensureBackendFn({ mdlog });
  return { selfSpawned: true, restarted: !!(ensureResult && ensureResult.ok), ensureResult };
}

function readLocalBearerToken(backendDir) {
  const fromEnv = String(process.env.ATHENA_LOCAL_BEARER_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const envPath = path.join(backendDir || BACKEND_DIR, '.env');
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*ATHENA_LOCAL_BEARER_TOKEN\s*=\s*(.+?)\s*$/.exec(line);
      if (m) {
        const raw = m[1].replace(/^["']|["']$/g, '');
        return raw || null;
      }
    }
  } catch { /* .env 없음 — 토큰 미설정 배포(루프백 게이트) */ }
  return null;
}

module.exports = {
  readLocalBearerToken,
  HEALTH_URL,
  HEALTH_HOST,
  HEALTH_PORT,
  HEALTH_TIMEOUT_MS,
  STARTUP_POLL_TIMEOUT_MS,
  STARTUP_HARD_TIMEOUT_MS,
  STARTUP_POLL_INTERVAL_MS,
  buildUvicornArgs,
  buildBackendEnv,
  decideAction,
  venvExists,
  checkHealth,
  ensureBackend,
  ensureBackendReady,
  shutdownBackend,
  awaitChildExit,
  restartAfterReset,
  // 테스트/진단 전용 — 실제 child 핸들은 절대 노출하지 않는다(트리 kill 경로를 우회 못 하게).
  hasSpawnedChild: () => backendChild !== null,
  // 테스트 전용 — restartAfterReset의 self-spawn 분기를 실제 프로세스 없이
  // 재현하기 위한 훅(history-sink.js의 _resetBrainReadyCacheForTest와 같은 패턴).
  _setBackendChildForTest: (child) => { backendChild = child; lastStartupFailure = null; },
  BACKEND_LOG_PATH,
  summarizeStartupFailure,
  isLockContention,
};
