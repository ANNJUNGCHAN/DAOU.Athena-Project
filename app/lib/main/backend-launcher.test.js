'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const {
  HEALTH_URL, HEALTH_HOST, HEALTH_PORT,
  buildUvicornArgs, buildBackendEnv, decideAction, hasSpawnedChild,
  ensureBackend, ensureBackendReady, shutdownBackend,
  awaitChildExit, restartAfterReset, _setBackendChildForTest,
  summarizeStartupFailure, isLockContention,
} = require('./backend-launcher');

function createFakeClock(startMs = 0) {
  let nowMs = startMs;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => nowMs,
    setNow: (value) => { nowMs = value; },
    setTimeoutFn: (fn, delayMs) => {
      const id = nextId++;
      timers.set(id, { at: nowMs + Math.max(0, delayMs), fn });
      return id;
    },
    clearTimeoutFn: (id) => { timers.delete(id); },
    advanceTo: async (targetMs) => {
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= targetMs)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        nowMs = timer.at;
        await timer.fn();
      }
      nowMs = targetMs;
    },
  };
}

function hardDeadlineDependencies({ clock, childFactory, healthyFn, killed }) {
  return {
    checkHealthFn: async () => healthyFn(),
    existingBackendCheckAttempts: 1,
    venvExistsFn: () => true,
    spawnFn: childFactory,
    waitUntilHealthyFn: async () => {
      clock.setNow(12_000);
      return false;
    },
    killTreeFn: (child) => killed.push(child),
    nowFn: clock.now,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  };
}

test('HEALTH_URL: 실행법과 같은 host:port(127.0.0.1:8010), llm/manifest 부트스트랩 경로', () => {
  assert.equal(HEALTH_HOST, '127.0.0.1');
  assert.equal(HEALTH_PORT, 8010);
  assert.equal(HEALTH_URL, 'http://127.0.0.1:8010/api/v1/llm/manifest');
});

test('buildUvicornArgs: 실행법과 문자 그대로 일치 — host/port/workers=1', () => {
  const args = buildUvicornArgs();
  assert.deepEqual(args, [
    '-m', 'uvicorn', 'athena_api.main:app',
    '--host', '127.0.0.1',
    '--port', '8010',
    '--workers', '1',
  ]);
});

test('buildUvicornArgs: 매 호출 새 배열 — 호출자가 변형해도 다음 호출에 영향 없다', () => {
  const a = buildUvicornArgs();
  a.push('--reload');
  const b = buildUvicornArgs();
  assert.equal(b.includes('--reload'), false);
});

test('buildBackendEnv: Electron이 스폰한 제품 백엔드는 brain/routines를 기본 활성화한다', () => {
  const env = buildBackendEnv({ PATH: 'bin' });
  assert.equal(env.PATH, 'bin');
  assert.equal(env.ATHENA_BRAIN_ENABLED, 'true');
  assert.equal(env.ATHENA_ROUTINES_ENABLED, 'true');
  assert.equal(env.ATHENA_BACKTEST_ENABLED, 'true');
  assert.equal(env.ATHENA_BRAIN_INGEST_SCHEDULE_OWNER, 'external');
  assert.equal(env.ATHENA_BRAIN_USE_CLAUDE_CLI_EXTRACTION, 'true');
  assert.ok(env.ATHENA_CLAUDE_BIN);
});

test('buildBackendEnv: 명시적인 프로세스 override는 true/false 모두 그대로 보존한다', () => {
  const env = buildBackendEnv({
    ATHENA_BRAIN_ENABLED: 'false',
    ATHENA_ROUTINES_ENABLED: 'true',
    ATHENA_BRAIN_USE_CLAUDE_CLI_EXTRACTION: 'false',
    ATHENA_BRAIN_INGEST_SCHEDULE_OWNER: 'backend',
    ATHENA_CLAUDE_BIN: 'C:\\override\\claude.exe',
    OTHER: 'value',
  });
  assert.equal(env.ATHENA_BRAIN_ENABLED, 'false');
  assert.equal(env.ATHENA_ROUTINES_ENABLED, 'true');
  assert.equal(env.ATHENA_BACKTEST_ENABLED, 'true');
  assert.equal(env.ATHENA_BRAIN_USE_CLAUDE_CLI_EXTRACTION, 'false');
  assert.equal(env.ATHENA_BRAIN_INGEST_SCHEDULE_OWNER, 'backend');
  assert.equal(env.ATHENA_CLAUDE_BIN, 'C:\\override\\claude.exe');
  assert.equal(env.OTHER, 'value');
});

test('buildBackendEnv: custom extraction argv가 있으면 Claude CLI 기본 opt-in을 추가하지 않는다', () => {
  const env = buildBackendEnv({
    ATHENA_BRAIN_EXTRACTION_LLM_ARGV: '["custom-extractor"]',
  });
  assert.equal(env.ATHENA_BRAIN_EXTRACTION_LLM_ARGV, '["custom-extractor"]');
  assert.equal(Object.hasOwn(env, 'ATHENA_BRAIN_USE_CLAUDE_CLI_EXTRACTION'), false);
});

test('decideAction: 헬스체크 성공이면 venv 여부와 무관하게 already-running — 중복 스폰 금지', () => {
  assert.equal(decideAction({ healthy: true, venvExists: true }), 'already-running');
  assert.equal(decideAction({ healthy: true, venvExists: false }), 'already-running');
});

test('decideAction: 헬스체크 실패 + venv 없음 → no-venv(조용히 스킵, 실패로 취급 안 함)', () => {
  assert.equal(decideAction({ healthy: false, venvExists: false }), 'no-venv');
});

test('decideAction: 헬스체크 실패 + venv 있음 → spawn', () => {
  assert.equal(decideAction({ healthy: false, venvExists: true }), 'spawn');
});

test('hasSpawnedChild: ensureBackend를 부르기 전에는 false — 아직 아무것도 스폰하지 않았다', () => {
  assert.equal(hasSpawnedChild(), false);
});

test('ensureBackend: 첫 manifest timeout 뒤 기존 backend가 응답하면 spawn하지 않는다', async () => {
  _setBackendChildForTest(null);
  const healthResults = [false, true];
  let spawnCount = 0;
  const result = await ensureBackend({
    _dependencies: {
      checkHealthFn: async () => healthResults.shift(),
      venvExistsFn: () => true,
      spawnFn: () => {
        spawnCount += 1;
        return new EventEmitter();
      },
      waitUntilHealthyFn: async () => true,
    },
  });

  assert.equal(result.reason, 'already-running');
  assert.equal(result.ready, true);
  assert.equal(spawnCount, 0);
  assert.equal(hasSpawnedChild(), false);
});

test('ensureBackend: 첫 두 manifest timeout 뒤 기존 backend가 응답하면 spawn하지 않는다', async () => {
  _setBackendChildForTest(null);
  const healthResults = [false, false, true];
  let spawnCount = 0;
  const result = await ensureBackend({
    _dependencies: {
      checkHealthFn: async () => healthResults.shift(),
      venvExistsFn: () => true,
      spawnFn: () => {
        spawnCount += 1;
        return new EventEmitter();
      },
      waitUntilHealthyFn: async () => true,
    },
  });

  assert.equal(result.reason, 'already-running');
  assert.equal(result.ready, true);
  assert.equal(spawnCount, 0);
  assert.equal(hasSpawnedChild(), false);
});

test('ensureBackend: 제한된 기존 backend 재확인이 모두 실패하면 정확히 한 번 spawn한다', async () => {
  _setBackendChildForTest(null);
  let healthChecks = 0;
  let spawnCount = 0;
  const child = new EventEmitter();
  const result = await ensureBackend({
    _dependencies: {
      checkHealthFn: async () => {
        healthChecks += 1;
        return false;
      },
      venvExistsFn: () => true,
      spawnFn: () => {
        spawnCount += 1;
        return child;
      },
      waitUntilHealthyFn: async () => true,
    },
  });

  assert.equal(healthChecks, 3);
  assert.equal(spawnCount, 1);
  assert.equal(result.spawned, true);
  assert.equal(result.ready, true);
  shutdownBackend({ killTreeFn: () => {} });
});

test('ensureBackend: 기존 backend 재확인 시간도 최초 ensure의 60초 상한에 포함한다', async () => {
  _setBackendChildForTest(null);
  const clock = createFakeClock();
  const child = new EventEmitter();
  const killed = [];
  let precheck = true;
  await ensureBackend({
    _dependencies: {
      checkHealthFn: async () => {
        if (precheck) clock.setNow(clock.now() + 1_000);
        return false;
      },
      venvExistsFn: () => true,
      spawnFn: () => child,
      waitUntilHealthyFn: async () => {
        precheck = false;
        clock.setNow(15_000);
        return false;
      },
      killTreeFn: (ownedChild) => killed.push(ownedChild),
      nowFn: clock.now,
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
    },
  });

  await clock.advanceTo(60_000);
  assert.deepEqual(killed, [child]);
  assert.equal(hasSpawnedChild(), false);
});

test('ensureBackendReady: 빠른 readiness 예산 뒤에도 hard deadline 안에서 같은 backend를 기다린다', async () => {
  let now = 0;
  let calls = 0;
  const progress = [];
  const result = await ensureBackendReady({
    onProgress: (entry) => progress.push(entry),
    _dependencies: {
      nowFn: () => now,
      sleepFn: async (ms) => { now += ms; },
      hardTimeoutMs: 2_000,
      pollIntervalMs: 500,
      ensureBackendFn: async () => {
        calls += 1;
        return calls < 3
          ? { ok: true, ready: false, reason: 'startup-pending' }
          : { ok: true, ready: true, reason: 'already-running' };
      },
    },
  });
  assert.equal(result.ready, true);
  assert.equal(calls, 3);
  assert.deepEqual(progress.map((entry) => entry.elapsedMs), [0, 500]);
});

test('ensureBackendReady: hard deadline까지 준비되지 않으면 terminal failure를 반환한다', async () => {
  let now = 0;
  const result = await ensureBackendReady({
    _dependencies: {
      nowFn: () => now,
      sleepFn: async (ms) => { now += ms; },
      hardTimeoutMs: 1_000,
      pollIntervalMs: 250,
      ensureBackendFn: async () => ({ ok: true, ready: false, reason: 'startup-pending' }),
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'readiness-hard-timeout');
  assert.equal(now, 1_000);
});

test('ensureBackend: readiness 예산을 넘겨도 self-spawn child를 유지하고 중복 스폰하지 않는다', async () => {
  _setBackendChildForTest(null);
  const child = new EventEmitter();
  let spawnCount = 0;
  let healthy = false;
  const dependencies = {
    checkHealthFn: async () => healthy,
    venvExistsFn: () => true,
    spawnFn: () => {
      spawnCount += 1;
      return child;
    },
    waitUntilHealthyFn: async () => false,
  };

  const timedOut = await ensureBackend({ _dependencies: dependencies });
  assert.equal(timedOut.ok, true);
  assert.equal(timedOut.ready, false);
  assert.equal(timedOut.reason, 'readiness-pending');
  assert.equal(hasSpawnedChild(), true, 'readiness timeout은 소유 child를 해제하지 않는다');
  assert.equal(spawnCount, 1);

  const pending = await ensureBackend({ _dependencies: dependencies });
  assert.deepEqual(pending, {
    ok: true, spawned: false, ready: false, reason: 'startup-pending',
  });
  assert.equal(spawnCount, 1, 'pending child가 있으면 두 번째 child를 만들지 않는다');

  healthy = true;
  const ready = await ensureBackend({ _dependencies: dependencies });
  assert.equal(ready.reason, 'already-running');
  assert.equal(ready.ready, true);
  assert.equal(spawnCount, 1, 'eventual readiness 뒤에도 새 child를 만들지 않는다');

  const killed = [];
  shutdownBackend({ killTreeFn: (ownedChild) => killed.push(ownedChild) });
  assert.deepEqual(killed, [child], '명시적 shutdown만 소유 child를 종료한다');
  assert.equal(hasSpawnedChild(), false);
});

test('ensureBackend: self-spawn child exit은 소유 상태를 정리한다', async () => {
  _setBackendChildForTest(null);
  const child = new EventEmitter();
  await ensureBackend({
    _dependencies: {
      checkHealthFn: async () => false,
      venvExistsFn: () => true,
      spawnFn: () => child,
      waitUntilHealthyFn: async () => false,
    },
  });
  assert.equal(hasSpawnedChild(), true);
  child.emit('exit', 0, null);
  assert.equal(hasSpawnedChild(), false);
});

test('ensureBackend: spawn error도 소유 상태를 정리해 이후 재시도를 막지 않는다', async () => {
  _setBackendChildForTest(null);
  const child = new EventEmitter();
  await ensureBackend({
    _dependencies: {
      checkHealthFn: async () => false,
      venvExistsFn: () => true,
      spawnFn: () => child,
      waitUntilHealthyFn: async () => false,
    },
  });
  assert.equal(hasSpawnedChild(), true);
  child.emit('error', new Error('synthetic spawn failure'));
  assert.equal(hasSpawnedChild(), false);
});

test('ensureBackend: 31초 eventual readiness는 hard deadline을 취소하고 child를 유지한다', async () => {
  _setBackendChildForTest(null);
  const clock = createFakeClock();
  const child = new EventEmitter();
  const killed = [];
  await ensureBackend({
    _dependencies: hardDeadlineDependencies({
      clock,
      childFactory: () => child,
      healthyFn: () => clock.now() >= 31_000,
      killed,
    }),
  });

  await clock.advanceTo(31_000);
  assert.equal(hasSpawnedChild(), true);
  assert.deepEqual(killed, []);
  await clock.advanceTo(60_000);
  assert.equal(hasSpawnedChild(), true, 'ready 확인 뒤 취소된 hard timer가 child를 죽이면 안 된다');
  assert.deepEqual(killed, []);
  _setBackendChildForTest(null);
});

test('ensureBackend: 60초까지 hung이면 그 child만 retire하고 다음 ensure가 재스폰할 수 있다', async () => {
  _setBackendChildForTest(null);
  const clock = createFakeClock();
  const firstChild = new EventEmitter();
  const secondChild = new EventEmitter();
  const children = [firstChild, secondChild];
  const killed = [];
  let spawnCount = 0;
  const dependencies = hardDeadlineDependencies({
    clock,
    childFactory: () => children[spawnCount++],
    healthyFn: () => false,
    killed,
  });

  await ensureBackend({ _dependencies: dependencies });
  await clock.advanceTo(60_000);
  assert.deepEqual(killed, [firstChild]);
  assert.equal(hasSpawnedChild(), false);

  const retried = await ensureBackend({
    _dependencies: {
      ...dependencies,
      waitUntilHealthyFn: async () => true,
    },
  });
  assert.equal(spawnCount, 2);
  assert.equal(retried.ready, true);
  assert.equal(hasSpawnedChild(), true);
  shutdownBackend({ killTreeFn: () => {} });
});

test('ensureBackend: exit/error가 hard deadline보다 먼저 오면 watcher를 취소한다', async () => {
  for (const eventName of ['exit', 'error']) {
    _setBackendChildForTest(null);
    const clock = createFakeClock();
    const child = new EventEmitter();
    const killed = [];
    await ensureBackend({
      _dependencies: hardDeadlineDependencies({
        clock,
        childFactory: () => child,
        healthyFn: () => false,
        killed,
      }),
    });
    clock.setNow(20_000);
    if (eventName === 'exit') child.emit('exit', 1, null);
    else child.emit('error', new Error('synthetic failure'));
    await clock.advanceTo(60_000);
    assert.deepEqual(killed, [], `${eventName} 뒤 hard watcher가 중복 kill하면 안 된다`);
    assert.equal(hasSpawnedChild(), false);
  }
});

test('shutdownBackend: hard watcher를 취소해 deadline 중복 kill을 막는다', async () => {
  _setBackendChildForTest(null);
  const clock = createFakeClock();
  const child = new EventEmitter();
  const killed = [];
  const dependencies = hardDeadlineDependencies({
    clock,
    childFactory: () => child,
    healthyFn: () => false,
    killed,
  });
  await ensureBackend({ _dependencies: dependencies });
  clock.setNow(20_000);
  shutdownBackend({ killTreeFn: dependencies.killTreeFn });
  await clock.advanceTo(60_000);
  assert.deepEqual(killed, [child]);
  assert.equal(hasSpawnedChild(), false);
});

test('ensureBackend: 59.9초 ready 재확인은 60초 hard timer를 취소해 child를 보존한다', async () => {
  _setBackendChildForTest(null);
  const clock = createFakeClock();
  const child = new EventEmitter();
  const killed = [];
  let healthy = false;
  const dependencies = hardDeadlineDependencies({
    clock,
    childFactory: () => child,
    healthyFn: () => healthy,
    killed,
  });
  await ensureBackend({ _dependencies: dependencies });
  await clock.advanceTo(59_500);

  healthy = true;
  clock.setNow(59_900);
  const ready = await ensureBackend({ _dependencies: dependencies });
  assert.equal(ready.reason, 'already-running');
  await clock.advanceTo(60_000);
  assert.deepEqual(killed, []);
  assert.equal(hasSpawnedChild(), true);
  shutdownBackend({ killTreeFn: () => {} });
});

test('hard deadline final health await 중 exit/replacement가 생기면 이전 child를 kill하지 않는다', async () => {
  for (const race of ['exit', 'replacement']) {
    _setBackendChildForTest(null);
    const clock = createFakeClock();
    const child = new EventEmitter();
    const replacement = new EventEmitter();
    const killed = [];
    let checkCount = 0;
    let resolveFinalCheck;
    let markFinalCheckStarted;
    const finalCheckStarted = new Promise((resolve) => { markFinalCheckStarted = resolve; });
    const dependencies = {
      ...hardDeadlineDependencies({
        clock,
        childFactory: () => child,
        healthyFn: () => false,
        killed,
      }),
      pollIntervalMs: 60_000,
      checkHealthFn: async () => {
        checkCount += 1;
        if (checkCount === 1) return false;
        markFinalCheckStarted();
        return new Promise((resolve) => { resolveFinalCheck = resolve; });
      },
    };
    await ensureBackend({ _dependencies: dependencies });
    const advancing = clock.advanceTo(60_000);
    await finalCheckStarted;
    if (race === 'exit') child.emit('exit', 1, null);
    else _setBackendChildForTest(replacement);
    resolveFinalCheck(false);
    await advancing;

    assert.deepEqual(killed, [], `${race} race에서 이전 child를 kill하면 안 된다`);
    assert.equal(hasSpawnedChild(), race === 'replacement');
    if (race === 'replacement') shutdownBackend({ killTreeFn: () => {} });
  }
});

// ---------- 리셋 후 재기동 — 계획 §2(f), 전역 exit 훅과 별개인 1회성 대기 ----------

test('awaitChildExit: child가 없으면 즉시 false — 기다릴 것도 없다', async () => {
  assert.equal(await awaitChildExit(null), false);
});

test('awaitChildExit: child가 exit을 emit하면 true로 resolve', async () => {
  const fake = new EventEmitter();
  const pending = awaitChildExit(fake);
  fake.emit('exit', 0, null);
  assert.equal(await pending, true);
});

test('restartAfterReset: 비자가스폰(backendChild 없음) — ensureBackend를 부르지 않고 수동 재시작 안내', async () => {
  _setBackendChildForTest(null);
  let called = false;
  const result = await restartAfterReset({
    ensureBackendFn: async () => { called = true; return { ok: true }; },
  });
  assert.deepEqual(result, { selfSpawned: false, restarted: false });
  assert.equal(called, false, 'ensureBackend가 불리면 안 된다 — 우리가 스폰하지 않은 인스턴스다');
});

test('restartAfterReset: 자가스폰 — exit을 1회성으로 기다린 뒤에만 ensureBackend를 명시적으로 재호출', async () => {
  const fakeChild = new EventEmitter();
  _setBackendChildForTest(fakeChild);
  let called = false;
  const pending = restartAfterReset({
    ensureBackendFn: async () => { called = true; return { ok: true, ready: true }; },
  });
  // exit이 나기 전에는 ensureBackend가 호출되지 않아야 한다.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(called, false);
  fakeChild.emit('exit', 0, null);
  const result = await pending;
  assert.equal(called, true);
  assert.deepEqual(result, {
    selfSpawned: true,
    restarted: true,
    ensureResult: { ok: true, ready: true },
  });
  _setBackendChildForTest(null); // 다음 테스트로 상태가 새지 않게 정리
});

test('restartAfterReset: 자가스폰이지만 재기동 실패(ensureBackend ok:false) — restarted:false로 정직하게 보고', async () => {
  const fakeChild = new EventEmitter();
  _setBackendChildForTest(fakeChild);
  const pending = restartAfterReset({
    ensureBackendFn: async () => ({ ok: false, error: '스폰 실패' }),
  });
  fakeChild.emit('exit', 1, null);
  const result = await pending;
  assert.equal(result.selfSpawned, true);
  assert.equal(result.restarted, false);
  _setBackendChildForTest(null);
});

test('readLocalBearerToken: backend/.env에서 토큰을 읽는다 (따옴표 벗김)', () => {
  const os = require('node:os');
  const fsm = require('node:fs');
  const pathm = require('node:path');
  const prev = process.env.ATHENA_LOCAL_BEARER_TOKEN;
  delete process.env.ATHENA_LOCAL_BEARER_TOKEN;
  const dir = fsm.mkdtempSync(pathm.join(os.tmpdir(), 'athena-env-'));
  fsm.writeFileSync(pathm.join(dir, '.env'), ['FOO=1', 'ATHENA_LOCAL_BEARER_TOKEN="tok-abc"', ''].join('\n'));
  const { readLocalBearerToken } = require('./backend-launcher');
  try {
    assert.equal(readLocalBearerToken(dir), 'tok-abc');
  } finally {
    if (prev == null) delete process.env.ATHENA_LOCAL_BEARER_TOKEN;
    else process.env.ATHENA_LOCAL_BEARER_TOKEN = prev;
    fsm.rmSync(dir, { recursive: true, force: true });
  }
});

test('readLocalBearerToken: .env 없음/키 없음이면 null — 루프백 게이트 배포', () => {
  const os = require('node:os');
  const fsm = require('node:fs');
  const pathm = require('node:path');
  const { readLocalBearerToken } = require('./backend-launcher');
  const prev = process.env.ATHENA_LOCAL_BEARER_TOKEN;
  delete process.env.ATHENA_LOCAL_BEARER_TOKEN;
  const empty = fsm.mkdtempSync(pathm.join(os.tmpdir(), 'athena-noenv-'));
  try {
    assert.equal(readLocalBearerToken(empty), null);
    fsm.writeFileSync(pathm.join(empty, '.env'), 'OTHER=1' + '\n');
    assert.equal(readLocalBearerToken(empty), null);
  } finally {
    if (prev == null) delete process.env.ATHENA_LOCAL_BEARER_TOKEN;
    else process.env.ATHENA_LOCAL_BEARER_TOKEN = prev;
    fsm.rmSync(empty, { recursive: true, force: true });
  }
});

test('readLocalBearerToken: 환경변수가 .env보다 앞선다', () => {
  const prev = process.env.ATHENA_LOCAL_BEARER_TOKEN;
  process.env.ATHENA_LOCAL_BEARER_TOKEN = 'from-env';
  const { readLocalBearerToken } = require('./backend-launcher');
  try {
    assert.equal(readLocalBearerToken('/no/such'), 'from-env');
  } finally {
    if (prev == null) delete process.env.ATHENA_LOCAL_BEARER_TOKEN;
    else process.env.ATHENA_LOCAL_BEARER_TOKEN = prev;
  }
});

// ---------- 기동 단계 실패의 이유 보존 + 잠금 충돌 시 재스폰 억제 (2026-09-07) ----------

function spawnedChildWithStderr() {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

async function waitForFileToContain(filePath, pattern) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (fs.existsSync(filePath) && pattern.test(fs.readFileSync(filePath, 'utf8'))) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

const LOCK_CONTENTION_STDERR = [
  'INFO:     Waiting for application startup.',
  'ERROR:    Traceback (most recent call last):',
  '  File "process_lock.py", line 41, in acquire',
  'PermissionError: [Errno 13] Permission denied',
  '',
  'The above exception was the direct cause of the following exception:',
  '',
  'Traceback (most recent call last):',
  '  File "lifespan.py", line 640, in lifespan',
  "RuntimeError: another credential-owning Athena backend is already running for account 'daeju'",
  '',
  'ERROR:    Application startup failed. Exiting.',
  '',
].join('\n');

test('summarizeStartupFailure: uvicorn 배너와 traceback 본문을 건너뛰고 실제 예외 줄을 고른다', () => {
  const lines = LOCK_CONTENTION_STDERR.split('\n').filter((line) => line.trim());
  assert.equal(
    summarizeStartupFailure(lines),
    "RuntimeError: another credential-owning Athena backend is already running for account 'daeju'",
  );
  assert.equal(isLockContention(lines), true);
  assert.equal(isLockContention(['ValueError: bad config']), false);
  assert.equal(summarizeStartupFailure([]), '');
});

test('ensureBackend: 잠금 충돌로 죽은 self-spawn 뒤에는 재스폰하지 않고 다른 백엔드의 준비를 기다린다', async () => {
  _setBackendChildForTest(null);
  const logPath = path.join(os.tmpdir(), `athena-launcher-test-${process.pid}-${Date.now()}-a.log`);
  const child = spawnedChildWithStderr();
  let now = 0;
  let healthy = false;
  let spawnCount = 0;
  const logs = [];
  const dependencies = {
    checkHealthFn: async () => healthy,
    venvExistsFn: () => true,
    spawnFn: (_exe, _args, opts) => {
      spawnCount += 1;
      assert.deepEqual(opts.stdio, ['ignore', 'pipe', 'pipe'], 'stderr를 버리지 않고 받아야 한다');
      return child;
    },
    waitUntilHealthyFn: async () => false,
    nowFn: () => now,
    backendLogPath: logPath,
  };
  try {
    const first = await ensureBackend({ mdlog: (message) => logs.push(message), _dependencies: dependencies });
    assert.equal(first.reason, 'readiness-pending');
    child.stderr.write(LOCK_CONTENTION_STDERR);
    await new Promise((resolve) => setImmediate(resolve));
    now = 15_000;
    child.emit('exit', 3, null);
    assert.equal(hasSpawnedChild(), false);
    assert.match(
      logs[logs.length - 1],
      /code=3 signal=null — RuntimeError: another credential-owning Athena backend is already running/,
      'main-debug.log 한 줄에 종료 코드와 마지막 예외가 함께 남아야 한다',
    );

    const contended = await ensureBackend({ mdlog: (message) => logs.push(message), _dependencies: dependencies });
    assert.equal(contended.ok, true);
    assert.equal(contended.ready, false);
    assert.equal(contended.reason, 'startup-contended');
    assert.match(contended.error, /already running/);
    assert.equal(spawnCount, 1, '다른 백엔드가 잠금을 쥔 동안 다시 스폰하면 같은 이유로 또 죽는다');

    healthy = true;
    const ready = await ensureBackend({ _dependencies: dependencies });
    assert.equal(ready.reason, 'already-running');
    assert.equal(ready.ready, true);
    assert.equal(await waitForFileToContain(logPath, /already running for account/), true, 'stderr는 파일에도 남는다');
  } finally {
    fs.rmSync(logPath, { force: true });
    _setBackendChildForTest(null);
  }
});

test('ensureBackend: 기동 단계에서 죽은 self-spawn은 stderr의 마지막 예외를 실패 이유로 돌려주고, hard deadline 뒤에는 다시 스폰한다', async () => {
  _setBackendChildForTest(null);
  const logPath = path.join(os.tmpdir(), `athena-launcher-test-${process.pid}-${Date.now()}-b.log`);
  const child = spawnedChildWithStderr();
  let now = 0;
  let spawnCount = 0;
  const dependencies = {
    checkHealthFn: async () => false,
    venvExistsFn: () => true,
    spawnFn: () => {
      spawnCount += 1;
      return spawnCount === 1 ? child : new EventEmitter();
    },
    waitUntilHealthyFn: async () => false,
    nowFn: () => now,
    backendLogPath: logPath,
  };
  try {
    await ensureBackend({ _dependencies: dependencies });
    child.stderr.write([
      'ERROR:    Traceback (most recent call last):',
      '  File "config.py", line 10, in <module>',
      'pydantic_core._pydantic_core.ValidationError: 1 validation error for Settings',
      'ERROR:    Application startup failed. Exiting.',
      '',
    ].join('\n'));
    await new Promise((resolve) => setImmediate(resolve));
    now = 9_000;
    child.emit('exit', 3, null);

    const failed = await ensureBackend({ _dependencies: dependencies });
    assert.equal(failed.ok, false);
    assert.equal(failed.reason, 'startup-failed');
    assert.match(failed.error, /code=3/);
    assert.match(failed.error, /ValidationError: 1 validation error for Settings/);
    assert.equal(spawnCount, 1, '같은 실패를 12초마다 반복 스폰하지 않는다');

    now = 70_000;
    const respawned = await ensureBackend({ _dependencies: dependencies });
    assert.equal(respawned.reason, 'readiness-pending');
    assert.equal(spawnCount, 2, 'hard deadline이 지나면 실패 기록을 잊고 다시 스폰할 수 있다');
  } finally {
    fs.rmSync(logPath, { force: true });
    _setBackendChildForTest(null);
  }
});

test('ensureBackend: 정상 종료(code=0)와 stderr 없는 child는 실패 기록을 남기지 않는다', async () => {
  _setBackendChildForTest(null);
  const child = new EventEmitter();
  let spawnCount = 0;
  const dependencies = {
    checkHealthFn: async () => false,
    venvExistsFn: () => true,
    spawnFn: () => {
      spawnCount += 1;
      return spawnCount === 1 ? child : new EventEmitter();
    },
    waitUntilHealthyFn: async () => false,
    backendLogPath: path.join(os.tmpdir(), `athena-launcher-test-${process.pid}-${Date.now()}-c.log`),
  };
  try {
    await ensureBackend({ _dependencies: dependencies });
    child.emit('exit', 0, null);
    const next = await ensureBackend({ _dependencies: dependencies });
    assert.equal(next.reason, 'readiness-pending');
    assert.equal(spawnCount, 2);
  } finally {
    fs.rmSync(dependencies.backendLogPath, { force: true });
    _setBackendChildForTest(null);
  }
});

test('ensureBackendReady: hard deadline 실패 메시지에 마지막 ensure 결과의 error를 싣는다', async () => {
  let now = 0;
  const result = await ensureBackendReady({
    _dependencies: {
      nowFn: () => now,
      sleepFn: async (ms) => { now += ms; },
      hardTimeoutMs: 1_000,
      pollIntervalMs: 500,
      ensureBackendFn: async () => ({
        ok: true, ready: false, reason: 'startup-contended', error: 'another backend is already running',
      }),
    },
  });
  assert.equal(result.reason, 'readiness-hard-timeout');
  assert.match(result.error, /backend readiness hard timeout — another backend is already running/);
});
