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
const KEEP_ENV_PREFIX = '__ATHENA_KEEP_ENV__:';

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

function readRegistryStrict() {
  const registry = JSON.parse(fs.readFileSync(registryPath(), 'utf-8'));
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)
    || !registry.servers || typeof registry.servers !== 'object' || Array.isArray(registry.servers)) {
    throw new TypeError('invalid MCP registry state');
  }
  return registry;
}

function unredactedMigrationKeys(registry, alias, keys) {
  const env = registry && registry.servers && registry.servers[alias]
    && registry.servers[alias].env;
  return keys.filter((key) => !env || env[key] !== SENTINEL);
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
  const registry = readRegistryStrict();
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
      const unredacted = new Set(unredactedMigrationKeys(readRegistryStrict(), alias, encryptedKeys));
      migrated.push(...encryptedKeys
        .filter((key) => !unredacted.has(key))
        .map((key) => ({ alias, key })));
      skipped.push(...encryptedKeys
        .filter((key) => unredacted.has(key))
        .map((key) => ({ alias, key, reason: 'registry redaction was not durably committed' })));
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

function parseEditableSnippet(alias, rawSnippet) {
  let parsed;
  try {
    parsed = JSON.parse(String(rawSnippet || ''));
  } catch {
    throw new TypeError('스니펫이 유효한 JSON이 아니다');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || Object.keys(parsed).length !== 1 || !Object.prototype.hasOwnProperty.call(parsed, 'mcpServers')) {
    throw new TypeError('스니펫의 최상위 키는 mcpServers 하나여야 한다');
  }
  const servers = parsed && parsed.mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)
    || Object.keys(servers).length !== 1 || !Object.prototype.hasOwnProperty.call(servers, alias)) {
    throw new TypeError(`mcpServers에는 기존 별칭 ${alias} 항목 하나만 있어야 한다`);
  }
  const config = servers[alias];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('서버 설정은 객체여야 한다');
  }
  const unsupported = Object.keys(config).filter((key) => !['command', 'args', 'env'].includes(key));
  if (unsupported.length) throw new TypeError(`지원하지 않는 서버 설정 키가 있다: ${unsupported.join(', ')}`);
  if (typeof config.command !== 'string' || !config.command.trim()) throw new TypeError('command가 필요하다');
  const args = config.args == null ? [] : config.args;
  const env = config.env == null ? {} : config.env;
  if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) throw new TypeError('args는 문자열 배열이어야 한다');
  if (!env || typeof env !== 'object' || Array.isArray(env)
    || Object.entries(env).some(([key, value]) => typeof key !== 'string' || typeof value !== 'string')) {
    throw new TypeError('env는 문자열 값 객체여야 한다');
  }
  return { command: config.command, args, env };
}

// 편집 스니펫의 평문은 먼저 safeStorage에 암호화하고 Python에는 센티널만 넘긴다.
// 적용 실패 시 이번 호출이 건드린 암호값을 이전 상태로 되돌린다.
async function updateSnippet(alias, rawSnippet, applyUpdate, secretStore = secrets, registryReader = readRegistryStrict) {
  if (typeof applyUpdate !== 'function') return { ok: false, error: 'MCP 수정 실행기가 없다' };
  let config;
  let registry;
  try {
    config = parseEditableSnippet(alias, rawSnippet);
    registry = registryReader();
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
  const oldEntry = Object.prototype.hasOwnProperty.call(registry.servers, alias)
    ? registry.servers[alias] : null;
  if (!oldEntry) return { ok: false, error: '등록되지 않은 MCP 별칭이다' };
  const namespace = SECRET_NAMESPACE_PREFIX + alias;
  const planned = [];
  for (const [newKey, supplied] of Object.entries(config.env)) {
    let value = supplied;
    if (supplied.startsWith(KEEP_ENV_PREFIX)) {
      const oldKey = supplied.slice(KEEP_ENV_PREFIX.length);
      if (!oldKey) return { ok: false, error: `${newKey}의 기존 값 참조가 비어 있다` };
      const oldEnv = oldEntry.env || {};
      if (!Object.prototype.hasOwnProperty.call(oldEnv, oldKey)) {
        return { ok: false, error: `${oldKey}의 기존 비밀값을 찾지 못했다` };
      }
      const oldStored = oldEnv[oldKey];
      try {
        value = oldStored === SENTINEL ? secretStore.getValue(namespace, oldKey) : oldStored;
      } catch {
        return { ok: false, error: `${oldKey}의 기존 비밀값을 안전하게 읽지 못했다` };
      }
      if (value == null) return { ok: false, error: `${oldKey}의 기존 비밀값을 찾지 못했다` };
    }
    planned.push({ key: newKey, value });
  }

  const backups = new Map();
  function rollback() {
    let ok = true;
    for (const [key, previous] of backups) {
      try {
        if (previous == null) secretStore.deleteValue(namespace, key);
        else if (!secretStore.setValue(namespace, key, previous).ok) ok = false;
      } catch {
        ok = false;
      }
    }
    return ok;
  }
  for (const item of planned) {
    let saved;
    try {
      backups.set(item.key, secretStore.getValue(namespace, item.key));
      saved = secretStore.setValue(namespace, item.key, item.value);
    } catch {
      saved = { ok: false };
    }
    if (!saved.ok) {
      const restored = rollback();
      return { ok: false, error: restored
        ? '비밀값을 안전하게 암호화하지 못했다'
        : '비밀값 암호화와 이전 값 복구에 실패했다' };
    }
  }
  const internal = JSON.stringify({
    mcpServers: {
      [alias]: {
        command: config.command,
        args: config.args,
        env: Object.fromEntries(planned.map(({ key }) => [key, SENTINEL])),
      },
    },
  });
  let result;
  try {
    result = await applyUpdate(alias, internal);
  } catch {
    result = { ok: false, error: 'MCP 스니펫 적용 중 오류가 발생했다' };
  }
  if (!result || !result.ok) {
    const restored = rollback();
    if (!restored) return { ok: false, error: 'MCP 반영 실패 후 비밀값 복구에도 실패했다' };
    return result || { ok: false, error: 'MCP 스니펫을 반영하지 못했다' };
  }
  const retained = new Set(planned.map(({ key }) => key));
  for (const oldKey of Object.keys(oldEntry.env || {})) {
    if (!retained.has(oldKey)) {
      // 레지스트리 반영은 이미 성공했다. 오래된 암호 항목 정리에 실패해도
      // 적용 실패로 거짓 보고하거나 새 설정을 깨뜨리지 않는다.
      try { secretStore.deleteValue(namespace, oldKey); } catch { /* encrypted orphan */ }
    }
  }
  return { ok: true, alias };
}

module.exports = {
  SENTINEL,
  envVarName,
  migratePlaintextEnv,
  buildEnvOverrides,
  updateSnippet,
  registryPath,
  unredactedMigrationKeys,
  KEEP_ENV_PREFIX,
};
