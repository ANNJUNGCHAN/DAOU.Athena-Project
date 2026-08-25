'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const secrets = require('./secrets');
const { BACKEND_DIR, PYTHON_EXE } = require('./mcp-config');

// backend/athena_mcp/registry.py의 SECRET_SENTINEL과 문자 그대로 일치해야 한다.
const SENTINEL = '__ATHENA_SAFESTORAGE__';
const SECRET_NAMESPACE_PREFIX = 'mcp-env:';

function registryPath() {
  return process.env.ATHENA_MCP_REGISTRY_PATH || path.join(os.homedir(), '.athena', 'mcp_servers.json');
}

function readRegistry() {
  try {
    return JSON.parse(fs.readFileSync(registryPath(), 'utf-8'));
  } catch {
    return { servers: {} };
  }
}

function envVarName(alias, key) {
  return `ATHENA_MCP_ENV__${alias}__${key}`;
}

// `redact-env` 서브커맨드만 부르는 최소 spawn 헬퍼. mcp-cli.js의 runCli()와
// 의도적으로 별개다(위 모듈 설명의 순환 회피 이유).
function runRedactEnv(alias, keys) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(PYTHON_EXE, ['-m', 'athena_mcp', 'redact-env', alias, ...keys], {
        cwd: BACKEND_DIR,
        env: { ...process.env, PYTHONPATH: BACKEND_DIR },
        windowsHide: true,
      });
    } catch (err) {
      resolve({ ok: false, error: String((err && err.message) || err) });
      return;
    }
    let stderr = '';
    child.stdout.on('data', () => {}); // 사람용 출력, 여기선 안 씀
    child.stderr.on('data', (c) => { stderr += c.toString('utf-8'); });
    child.on('error', (err) => resolve({ ok: false, error: String((err && err.message) || err) }));
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: (stderr.split(/\r?\n/).find((l) => l.trim()) || '').trim() || `종료 코드 ${code}` });
    });
  });
}

// 평문 env 값을 발견하면 secrets.js로 옮기고 레지스트리를 센티널로 재작성한다.
// **멱등**이다 — 이미 센티널이거나 빈 값이면 아무것도 하지 않는다. 값 자체는
// 반환값에 절대 담지 않는다(alias/key만).
async function migratePlaintextEnv() {
  const registry = readRegistry();
  const migrated = [];
  const skipped = [];

  for (const [alias, entry] of Object.entries(registry.servers || {})) {
    const env = entry.env || {};
    const plainKeys = Object.keys(env).filter((k) => {
      const v = env[k];
      return v != null && v !== '' && v !== SENTINEL;
    });
    if (!plainKeys.length) continue;

    const encryptedKeys = [];
    for (const key of plainKeys) {
      const result = secrets.setValue(SECRET_NAMESPACE_PREFIX + alias, key, env[key]);
      if (result.ok) {
        encryptedKeys.push(key);
      } else {
        // safeStorage.isEncryptionAvailable()이 false인 경우 등 — 평문을 그대로
        // 두고(데이터 손실 방지) 조용히 넘어가지 않고 보고한다.
        skipped.push({ alias, key, reason: result.error });
      }
    }
    if (!encryptedKeys.length) continue;

    const redacted = await runRedactEnv(alias, encryptedKeys);
    if (redacted.ok) {
      migrated.push(...encryptedKeys.map((key) => ({ alias, key })));
    } else {
      // secrets.js엔 이미 암호화 저장됐는데 레지스트리 치환만 실패했다 —
      // 평문이 디스크에 남아있으므로 다음 호출에서 다시 시도된다(멱등, 값은
      // 이미 secrets.js에 있으니 덮어써도 안전).
      skipped.push(...encryptedKeys.map((key) => ({ alias, key, reason: redacted.error })));
    }
  }

  return { migrated, skipped };
}

// claude/python spawn env에 얹을 override 객체를 만든다. `filterAlias`를 주면
// 그 서버의 키만 포함한다(probe처럼 서버 하나만 다루는 호출의 노출 최소화).
// 생략하면 등록된 전체 서버 분을 담는다(claude -p는 게이트웨이가 한 번에
// 여러 서버를 spawn하므로 전체가 필요하다).
//
// 반환값은 호출자가 spawn() 옵션의 env로 바로 쓰고 버려야 한다 — 변수에
// 오래 담아두지 않는다(secrets.js와 같은 원칙, 모듈 docstring 참고).
function buildEnvOverrides(filterAlias) {
  const registry = readRegistry();
  const overrides = {};
  for (const [alias, entry] of Object.entries(registry.servers || {})) {
    if (filterAlias && alias !== filterAlias) continue;
    const env = entry.env || {};
    for (const key of Object.keys(env)) {
      if (env[key] !== SENTINEL) continue;
      const value = secrets.getValue(SECRET_NAMESPACE_PREFIX + alias, key);
      if (value != null) {
        overrides[envVarName(alias, key)] = value;
      }
      // 못 찾아도 여기서 에러 내지 않는다 — 실제 fail-closed는 python 쪽
      // resolve_secret_env()가 MissingSecretEnvError로 그 서버 spawn만 명확히
      // 실패시킨다(다른 서버까지 막지 않는다, client.py의 서버별 격리 원칙과 일치).
    }
  }
  return overrides;
}

module.exports = {
  SENTINEL,
  envVarName,
  migratePlaintextEnv,
  buildEnvOverrides,
  registryPath,
};
