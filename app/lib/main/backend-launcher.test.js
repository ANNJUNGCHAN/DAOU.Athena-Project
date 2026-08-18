// backend-launcher.js의 순수 부분(인자 조립·스폰 판정)만 테스트한다. ensureBackend/
// checkHealth는 실제 fetch·spawn을 쓰므로 여기서 부르지 않는다(네트워크·프로세스
// 의존 — CLAUDE.md §9 "재현 → 원인 격리"는 결정론적 단위 테스트가 아니라 QA 실측의 몫).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HEALTH_URL, HEALTH_HOST, HEALTH_PORT,
  buildUvicornArgs, decideAction, hasSpawnedChild,
} = require('./backend-launcher');

test('HEALTH_URL: backend/README.md 실행법과 같은 host:port(127.0.0.1:8010), llm/manifest 부트스트랩 경로', () => {
  assert.equal(HEALTH_HOST, '127.0.0.1');
  assert.equal(HEALTH_PORT, 8010);
  assert.equal(HEALTH_URL, 'http://127.0.0.1:8010/api/v1/llm/manifest');
});

test('buildUvicornArgs: backend/README.md 실행법과 문자 그대로 일치 — host/port/workers=1', () => {
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
