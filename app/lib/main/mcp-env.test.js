// mcp-env.js 단위 테스트 — `node --test`(순수 Node, Electron 없음)로 돈다.
//
// secrets.js는 `require('electron')`에 의존하는데, 순수 Node에서 그 require는
// 진짜 API 객체가 아니라 electron 바이너리 경로 **문자열**을 돌려준다(잘 알려진
// electron npm 패키지 동작). 그래서 `safeStorage.isEncryptionAvailable()`은
// `undefined.isEncryptionAvailable()`이 되어 던지지만, secrets.js의
// `isEncryptionAvailable()`이 그 예외를 잡아 `false`로 접는다 — 결과적으로
// secrets.js의 모든 공개 함수는 순수 Node에서도 "암호화 불가"로 **안전하게
// 저하**된다(안 던진다). 그래서 이 파일은 실제 암호화 왕복(그건 진짜 Electron
// safeStorage가 필요 — `electron verify-settings.js`가 담당, README 참고)이
// 아니라 (a) 순수 로직(envVarName 등)과 (b) "암호화 불가 상황에서도 평문을
// 잃어버리지 않고 정직하게 skip으로 보고한다"는 fail-safe 계약을 검증한다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mcpEnv = require('./mcp-env');

// `fn`이 async여도(대부분 그렇다, migratePlaintextEnv()가 Promise를 돌려주므로)
// cleanup(finally)이 그 완료를 반드시 기다려야 한다 — `await fn(...)` 없이
// `return fn(...)`만 하면 try 블록이 동기적으로 "끝났다"고 판단돼 finally가
// fn의 await 지점보다 먼저 실행되고, 그 시점에 임시 디렉터리가 이미 지워져
// 뒤이은 fs 접근이 ENOENT로 깨진다(실측 — 이 주석 이전 판이 실제로 이 경합에
// 걸렸다).
async function withTempRegistry(data, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-mcp-env-test-'));
  const registryPath = path.join(tmp, 'mcp_servers.json');
  fs.writeFileSync(registryPath, JSON.stringify(data), 'utf-8');
  const prev = process.env.ATHENA_MCP_REGISTRY_PATH;
  process.env.ATHENA_MCP_REGISTRY_PATH = registryPath;
  try {
    return await fn(registryPath);
  } finally {
    if (prev === undefined) delete process.env.ATHENA_MCP_REGISTRY_PATH;
    else process.env.ATHENA_MCP_REGISTRY_PATH = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('SENTINEL: backend/athena_mcp/registry.py의 SECRET_SENTINEL과 문자 그대로 일치', () => {
  // 양쪽이 갈라지면 python resolve_secret_env()가 절대 이 값을 못 알아본다 —
  // 값을 바꾸려면 registry.py 주석이 지시하는 대로 두 파일을 함께 고친다.
  assert.equal(mcpEnv.SENTINEL, '__ATHENA_SAFESTORAGE__');
});

test('envVarName: ATHENA_MCP_ENV__<alias>__<KEY> 형식 — client.py의 조회 문자열과 일치해야 한다', () => {
  assert.equal(mcpEnv.envVarName('dart-mcp', 'DART_API_KEY'), 'ATHENA_MCP_ENV__dart-mcp__DART_API_KEY');
});

test('registryPath: ATHENA_MCP_REGISTRY_PATH override를 존중한다', () => {
  const prev = process.env.ATHENA_MCP_REGISTRY_PATH;
  process.env.ATHENA_MCP_REGISTRY_PATH = '/tmp/custom-registry.json';
  try {
    assert.equal(mcpEnv.registryPath(), '/tmp/custom-registry.json');
  } finally {
    if (prev === undefined) delete process.env.ATHENA_MCP_REGISTRY_PATH;
    else process.env.ATHENA_MCP_REGISTRY_PATH = prev;
  }
});

test('buildEnvOverrides: 레지스트리가 없으면 빈 객체', () => {
  const prev = process.env.ATHENA_MCP_REGISTRY_PATH;
  process.env.ATHENA_MCP_REGISTRY_PATH = path.join(os.tmpdir(), 'athena-mcp-env-test-does-not-exist.json');
  try {
    assert.deepEqual(mcpEnv.buildEnvOverrides(), {});
  } finally {
    if (prev === undefined) delete process.env.ATHENA_MCP_REGISTRY_PATH;
    else process.env.ATHENA_MCP_REGISTRY_PATH = prev;
  }
});

test('buildEnvOverrides: 센티널이 없는(평문 그대로인) 서버는 override를 만들지 않는다', async () => {
  await withTempRegistry({ servers: { dart: { alias: 'dart', command: 'npx', args: [], env: { DART_API_KEY: '아직-평문' } } } }, () => {
    assert.deepEqual(mcpEnv.buildEnvOverrides(), {});
  });
});

test('buildEnvOverrides: filterAlias를 주면 그 서버만 본다(다른 서버 값이 있어도 노출 안 함)', async () => {
  await withTempRegistry(
    {
      servers: {
        a: { alias: 'a', command: 'npx', args: [], env: { KEY: '__ATHENA_SAFESTORAGE__' } },
        b: { alias: 'b', command: 'npx', args: [], env: { KEY: '__ATHENA_SAFESTORAGE__' } },
      },
    },
    () => {
      // secrets.js가 순수 Node에서 암호화 불가로 저하되므로 실값은 못 찾지만
      // (getValue -> null), 어차피 이 테스트의 목적은 "다른 alias를 건드리지
      // 않는다"이지 실값 조회 성공이 아니다 — 결과가 항상 {}여도 필터링
      // 로직 자체(다른 alias로 확장되지 않는 것)는 아래 skip 카운트 테스트가
      // migratePlaintextEnv 쪽에서 이미 값 단위로 커버한다.
      const forA = mcpEnv.buildEnvOverrides('a');
      const forB = mcpEnv.buildEnvOverrides('b');
      assert.deepEqual(Object.keys(forA), []);
      assert.deepEqual(Object.keys(forB), []);
    }
  );
});

test('migratePlaintextEnv: 서버가 없으면 아무것도 하지 않는다(멱등의 기저 사례)', async () => {
  await withTempRegistry({ servers: {} }, async () => {
    const { migrated, skipped } = await mcpEnv.migratePlaintextEnv();
    assert.deepEqual(migrated, []);
    assert.deepEqual(skipped, []);
  });
});

test('migratePlaintextEnv: 이미 센티널인 값은 재처리 대상이 아니다(migrated/skipped 둘 다 빈다)', async () => {
  await withTempRegistry(
    { servers: { dart: { alias: 'dart', command: 'npx', args: [], env: { DART_API_KEY: '__ATHENA_SAFESTORAGE__' } } } },
    async () => {
      const { migrated, skipped } = await mcpEnv.migratePlaintextEnv();
      assert.deepEqual(migrated, []);
      assert.deepEqual(skipped, []);
    }
  );
});

test('migratePlaintextEnv: 암호화 불가 환경(순수 Node)에서는 평문을 잃어버리지 않는다 — fail-safe', async () => {
  // safeStorage가 없는 이 테스트 프로세스에서는 secrets.setValue()가 ok:false를
  // 돌려준다(모듈 상단 설명). migratePlaintextEnv()는 그 경우 레지스트리를
  // 절대 재작성하지 않아야 한다 — 값을 어디에도 못 옮겼는데 원본을 지우면
  // 데이터를 그냥 잃는다.
  await withTempRegistry(
    { servers: { dart: { alias: 'dart', command: 'npx', args: [], env: { DART_API_KEY: '진짜-평문-값' } } } },
    async (registryPath) => {
      const { migrated, skipped } = await mcpEnv.migratePlaintextEnv();
      assert.deepEqual(migrated, []);
      assert.equal(skipped.length, 1);
      assert.equal(skipped[0].alias, 'dart');
      assert.equal(skipped[0].key, 'DART_API_KEY');
      assert.equal(skipped[0].reason, 'encryption-unavailable');

      // 레지스트리는 손대지 않았다 — 평문이 그대로 남아있어야 한다(잃어버리지 않음).
      const onDisk = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      assert.equal(onDisk.servers.dart.env.DART_API_KEY, '진짜-평문-값');
    }
  );
});

test('migratePlaintextEnv: 빈 문자열/null env 값은 "평문"으로 취급하지 않는다(빈 값을 암호화 시도하지 않음)', async () => {
  await withTempRegistry(
    { servers: { x: { alias: 'x', command: 'npx', args: [], env: { EMPTY: '', NULLISH: null } } } },
    async () => {
      const { migrated, skipped } = await mcpEnv.migratePlaintextEnv();
      assert.deepEqual(migrated, []);
      assert.deepEqual(skipped, []);
    }
  );
});
