// 백엔드(FastAPI/uvicorn) 자동 기동 — 개발 레이아웃 전제(backend/.venv가 이
// 저장소 옆에 있다는 가정, mcp-config.js의 BACKEND_DIR/PYTHON_EXE와 같은 계산).
//
// 왜 필요한가: 지금까지는 사용자가 `cd backend && .venv\Scripts\python -m uvicorn
// athena_api.main:app ...`를 손으로 먼저 띄워야 실배선(live) 왕복이 붙었다 —
// 안 띄우면 claude -p가 게이트웨이를 통해 키움 라우트를 부를 때마다 조용히 죽는다.
// 이 모듈은 앱 부팅 시 백엔드가 살아있는지 헬스체크하고, 죽어 있으면 이 앱이
// 대신 스폰한다.
//
// 지켜야 할 것:
//   - **중복 스폰 금지.** 헬스체크가 200이면(자격 없이도 200 — 실측 확인,
//     backend/api/v1/llm/manifest는 x-athena-llm-exposed:false 부트스트랩
//     엔드포인트라 인증을 요구하지 않는다) 이미 누군가(사용자가 수동 기동한
//     인스턴스 포함) 떠 있는 것이므로 절대 스폰하지 않는다. CLAUDE.md §7 —
//     uvicorn 워커는 정확히 1개, 토큰·레이트리미터·멱등성 캐시가 전부 프로세스
//     로컬이라 두 번째 인스턴스가 뜨면 그 상태들이 갈라진다.
//   - **우리가 스폰한 프로세스만 우리가 죽인다.** shutdownBackend()는 이 모듈이
//     내부에 쥔 child 핸들이 있을 때만 동작한다 — 사용자가 별도 콘솔에서 띄운
//     인스턴스는 이 앱의 생애주기와 무관하게 계속 산다.
//   - backend/.venv가 없으면(예: 이 앱만 배포된 환경) 조용히 스킵한다 — 실패로
//     취급하지 않는다. 이 기능 자체가 "저장소 옆에 backend/가 있다"는 개발
//     레이아웃을 전제한다.
'use strict';

const fs = require('fs');
const { spawn } = require('child_process');
const { BACKEND_DIR, PYTHON_EXE } = require('./mcp-config');

// backend/README.md "실행법"과 문자 그대로 일치하는 커맨드(포트·워커 수 포함) —
// CLAUDE.md §7 "uvicorn 워커는 정확히 1개".
const HEALTH_HOST = '127.0.0.1';
const HEALTH_PORT = 8010;
const HEALTH_URL = `http://${HEALTH_HOST}:${HEALTH_PORT}/api/v1/llm/manifest`;
const HEALTH_TIMEOUT_MS = 1500;
const STARTUP_POLL_TIMEOUT_MS = 12_000;
const STARTUP_POLL_INTERVAL_MS = 500;
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

// claude.exe만 죽이면 자식(uvicorn worker)이 고아로 남을 수 있다 — Windows는
// taskkill /T로 프로세스 트리를 통째로 끊는다. claude-runner.js killTree와
// 같은 패턴(app/lib/main/claude-runner.js).
function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch { /* 이미 죽어 있으면 그만 */ }
  } else {
    try { child.kill('SIGTERM'); } catch { /* 동일 */ }
  }
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

// 우리가 스폰한 child 핸들 — 정확히 하나만 유지한다. before-quit이 이 값의
// 존재 여부로 "우리가 스폰했는가"를 판정한다(사용자 기동 인스턴스는 이 변수에
// 잡히지 않으므로 절대 안 건드린다).
let backendChild = null;

// 앱 부팅 시 fire-and-forget으로 부른다(main.js — createWindows()를 막지 않는다).
// mdlog는 main.js의 파일 로거(선택) — 없으면 조용히 무시한다.
async function ensureBackend({ mdlog } = {}) {
  const log = typeof mdlog === 'function' ? mdlog : () => {};
  const t0 = Date.now();
  const healthy = await checkHealth();
  const action = decideAction({ healthy, venvExists: venvExists() });

  if (action === 'already-running') {
    log(`ensureBackend: 헬스체크 성공 — 이미 기동 중이라 스폰하지 않는다 (${Date.now() - t0}ms, ${HEALTH_URL})`);
    return { ok: true, spawned: false, reason: 'already-running' };
  }
  if (action === 'no-venv') {
    log(`ensureBackend: ${PYTHON_EXE} 없음 — backend/.venv 미설치(개발 레이아웃 전제), 스킵`);
    return { ok: true, spawned: false, reason: 'no-venv' };
  }

  log(`ensureBackend: 헬스체크 실패 — 백엔드 스폰 (${PYTHON_EXE} ${buildUvicornArgs().join(' ')}, cwd=${BACKEND_DIR})`);
  const spawnAt = Date.now(); // 부팅 지연 계측(합의 계획 W1) — "스폰→manifest 200" 구간의 시작점
  let child;
  try {
    child = spawn(PYTHON_EXE, buildUvicornArgs(), {
      cwd: BACKEND_DIR,
      stdio: 'ignore',
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
  child.on('exit', (code, signal) => {
    log(`ensureBackend: 백엔드 프로세스 종료 감지 — code=${code} signal=${signal}`);
    if (backendChild === child) backendChild = null;
  });
  child.on('error', (err) => {
    log(`ensureBackend: 백엔드 프로세스 에러 — ${String((err && err.message) || err)}`);
  });

  const ready = await waitUntilHealthy(STARTUP_POLL_TIMEOUT_MS, STARTUP_POLL_INTERVAL_MS);
  const elapsedMs = Date.now() - t0;
  const spawnToHealthyMs = Date.now() - spawnAt;
  if (ready) {
    log(`ensureBackend: 기동 완료 — 준비까지 ${elapsedMs}ms (스폰→manifest 200: ${spawnToHealthyMs}ms)`);
  } else {
    log(`ensureBackend: ${STARTUP_POLL_TIMEOUT_MS}ms 안에 준비 확인 실패 — 계속 기동 중일 수 있다(elapsed=${elapsedMs}ms, 스폰 이후=${spawnToHealthyMs}ms)`);
  }
  return { ok: true, spawned: true, ready, elapsedMs, spawnToHealthyMs };
}

// 우리가 스폰한 경우에만 트리를 끊는다 — 사용자가 별도로 기동한 인스턴스는
// backendChild에 잡히지 않으므로 이 함수는 그런 인스턴스에 대해 no-op이다.
function shutdownBackend() {
  if (backendChild) {
    killTree(backendChild);
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

module.exports = {
  HEALTH_URL,
  HEALTH_HOST,
  HEALTH_PORT,
  HEALTH_TIMEOUT_MS,
  STARTUP_POLL_TIMEOUT_MS,
  STARTUP_POLL_INTERVAL_MS,
  buildUvicornArgs,
  decideAction,
  venvExists,
  checkHealth,
  ensureBackend,
  shutdownBackend,
  awaitChildExit,
  restartAfterReset,
  // 테스트/진단 전용 — 실제 child 핸들은 절대 노출하지 않는다(트리 kill 경로를 우회 못 하게).
  hasSpawnedChild: () => backendChild !== null,
  // 테스트 전용 — restartAfterReset의 self-spawn 분기를 실제 프로세스 없이
  // 재현하기 위한 훅(history-sink.js의 _resetBrainReadyCacheForTest와 같은 패턴).
  _setBackendChildForTest: (child) => { backendChild = child; },
};
