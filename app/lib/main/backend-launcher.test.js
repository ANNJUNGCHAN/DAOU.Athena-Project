'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const {
  HEALTH_URL, HEALTH_HOST, HEALTH_PORT,
  buildUvicornArgs, buildBackendEnv, decideAction, hasSpawnedChild,
  awaitChildExit, restartAfterReset, _setBackendChildForTest,
} = require('./backend-launcher');

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
  assert.deepEqual(buildBackendEnv({ PATH: 'bin' }), {
    PATH: 'bin', ATHENA_BRAIN_ENABLED: 'true', ATHENA_ROUTINES_ENABLED: 'true',
  });
});

test('buildBackendEnv: 명시적인 프로세스 override는 true/false 모두 그대로 보존한다', () => {
  const env = buildBackendEnv({
    ATHENA_BRAIN_ENABLED: 'false', ATHENA_ROUTINES_ENABLED: 'true', OTHER: 'value',
  });
  assert.equal(env.ATHENA_BRAIN_ENABLED, 'false');
  assert.equal(env.ATHENA_ROUTINES_ENABLED, 'true');
  assert.equal(env.OTHER, 'value');
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
  const dir = fsm.mkdtempSync(pathm.join(os.tmpdir(), 'athena-env-'));
  fsm.writeFileSync(pathm.join(dir, '.env'), ['FOO=1', 'ATHENA_LOCAL_BEARER_TOKEN="tok-abc"', ''].join('\n'));
  const { readLocalBearerToken } = require('./backend-launcher');
  assert.equal(readLocalBearerToken(dir), 'tok-abc');
  fsm.rmSync(dir, { recursive: true, force: true });
});

test('readLocalBearerToken: .env 없음/키 없음이면 null — 루프백 게이트 배포', () => {
  const os = require('node:os');
  const fsm = require('node:fs');
  const pathm = require('node:path');
  const { readLocalBearerToken } = require('./backend-launcher');
  const empty = fsm.mkdtempSync(pathm.join(os.tmpdir(), 'athena-noenv-'));
  assert.equal(readLocalBearerToken(empty), null);
  fsm.writeFileSync(pathm.join(empty, '.env'), 'OTHER=1' + '\n');
  assert.equal(readLocalBearerToken(empty), null);
  fsm.rmSync(empty, { recursive: true, force: true });
});
