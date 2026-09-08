'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ensureMcpConfig,
  createMcpRuntimeSnapshot,
  BACKEND_DIR,
  PYTHON_EXE,
  SECRET_SENTINEL,
} = require('./mcp-config');

test('ensureMcpConfig: userData 아래에 claude -p가 읽을 수 있는 .mcp.json을 쓴다', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-mcp-config-test-'));
  try {
    const { dir, configFile, configPath, grokConfigPath } = ensureMcpConfig(tmp);
    assert.equal(dir, path.join(tmp, 'mcp-config'));
    assert.equal(configFile, '.mcp.json');
    assert.equal(configPath, path.join(dir, '.mcp.json'));
    assert.equal(grokConfigPath, path.join(dir, '.grok', 'config.toml'));
    assert.ok(fs.existsSync(configPath));
    assert.ok(fs.existsSync(grokConfigPath));

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.ok(written.mcpServers.athena);
    assert.equal(written.mcpServers.athena.command, PYTHON_EXE);
    assert.deepEqual(written.mcpServers.athena.args, ['-m', 'athena_mcp', 'serve']);
    assert.equal(written.mcpServers.athena.env.PYTHONPATH, BACKEND_DIR);

    const grokToml = fs.readFileSync(grokConfigPath, 'utf-8');
    assert.match(grokToml, /\[mcp_servers\.athena\]/);
    assert.ok(grokToml.includes(JSON.stringify(PYTHON_EXE)));
    assert.ok(grokToml.includes(JSON.stringify(BACKEND_DIR)));
    assert.match(grokToml, /ATHENA_MCP_TOOL_NAME_STYLE = "grok"/);
    assert.match(grokToml, /enabled = true/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('ensureMcpConfig: 두 번 불러도(재실행) 최신 경로로 덮어써진다', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-mcp-config-test2-'));
  try {
    const first = ensureMcpConfig(tmp);
    fs.writeFileSync(first.configPath, '{"stale":true}', 'utf-8'); // 오염시킨다
    const second = ensureMcpConfig(tmp);
    const written = JSON.parse(fs.readFileSync(second.configPath, 'utf-8'));
    assert.ok(written.mcpServers.athena); // 오염된 값이 아니라 다시 정상 형상으로 덮어써졌다
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('McpRuntimeSnapshot: revisions, fingerprints, tool policy를 immutable snapshot으로 만든다', () => {
  const snapshot = createMcpRuntimeSnapshot({
    securityGeneration: 7,
    registry: {
      revision: 2,
      fingerprint: 'registry-hash',
      servers: [{
        alias: 'dart', command: 'npx', args: ['-y', 'dart'],
        env: { DART_API_KEY: SECRET_SENTINEL },
      }],
    },
    claudeServers: {
      athena: {
        command: PYTHON_EXE,
        args: ['-m', 'athena_mcp', 'serve'],
        env: { PYTHONPATH: BACKEND_DIR },
      },
      unexpected: {
        command: 'npx', args: ['untrusted-upstream'], env: { API_KEY: 'must-not-leak' },
      },
    },
    consent: { revision: 3, fingerprint: 'consent-hash' },
    secretRevision: 4,
    gatewayEpochRevision: 5,
    codexConfigRevision: 6,
    allowedTools: ['mcp__athena__z', 'mcp__athena__a', 'mcp__athena__a'],
    disallowedTools: ['Write'],
  });

  assert.equal(snapshot.securityGeneration, 7);
  assert.equal(snapshot.registryRevision, 2);
  assert.equal(snapshot.registryHash, 'registry-hash');
  assert.deepEqual(snapshot.allowedTools, ['mcp__athena__a', 'mcp__athena__z']);
  assert.deepEqual(snapshot.claudeServers, {
    athena: {
      command: PYTHON_EXE,
      args: ['-m', 'athena_mcp', 'serve'],
      env: { PYTHONPATH: BACKEND_DIR },
    },
  });
  assert.deepEqual(Object.keys(snapshot.claudeServers), ['athena']);
  assert.deepEqual(snapshot.registryServers[0].envKeys, ['DART_API_KEY']);
  assert.deepEqual(snapshot.registryServers[0].secretEnvKeys, ['DART_API_KEY']);
  assert.equal(Object.hasOwn(snapshot.registryServers[0], 'args'), false);
  assert.match(snapshot.configHash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.claudeServers));
  assert.ok(Object.isFrozen(snapshot.claudeServers.athena));
  assert.ok(Object.isFrozen(snapshot.claudeServers.athena.env));
  assert.ok(Object.isFrozen(snapshot.registryServers));
  assert.ok(Object.isFrozen(snapshot.registryServers[0]));
});

test('McpRuntimeSnapshot: env secret values and capability tokens are never serialized', () => {
  const secret = 'sk-never-serialize';
  const capability = 'capability-never-serialize';
  const snapshot = createMcpRuntimeSnapshot({
    registry: {
      revision: 1,
      fingerprint: 'r',
      servers: [{ alias: 'x', command: 'node', args: ['--token', secret], env: { TOKEN: secret } }],
    },
    claudeServers: {
      athena: {
        command: PYTHON_EXE,
        args: ['-m', 'athena_mcp', 'serve'],
        env: {
          PYTHONPATH: BACKEND_DIR,
          ATHENA_MCP_GATEWAY_CAPABILITY_TOKEN: capability,
          API_KEY: secret,
        },
      },
    },
    consent: { revision: 1, fingerprint: 'c' },
    gatewayCapabilityToken: capability,
    allowedTools: [],
    disallowedTools: [],
  });
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes(capability), false);
  assert.deepEqual(snapshot.claudeServers.athena.env, { PYTHONPATH: BACKEND_DIR });
  assert.deepEqual(snapshot.registryServers[0].envKeys, ['TOKEN']);
  assert.deepEqual(snapshot.registryServers[0].secretEnvKeys, []);
});

test('McpRuntimeSnapshot: canonical configHash is order-independent', () => {
  const common = {
    registry: { revision: 1, fingerprint: 'r' },
    consent: { revision: 1, fingerprint: 'c' },
  };
  const first = createMcpRuntimeSnapshot({
    ...common,
    registry: {
      ...common.registry,
      servers: [
      { alias: 'b', command: 'b', env: { Z: SECRET_SENTINEL, A: SECRET_SENTINEL } },
      { alias: 'a', command: 'a', env: {} },
      ],
    },
    claudeServers: {
      athena: {
        command: PYTHON_EXE,
        args: ['-m', 'athena_mcp', 'serve'],
        env: { PYTHONPATH: BACKEND_DIR },
      },
    },
    allowedTools: ['z', 'a'],
    disallowedTools: ['Write', 'Bash'],
  });
  const second = createMcpRuntimeSnapshot({
    ...common,
    registry: {
      ...common.registry,
      servers: [
      { alias: 'a', command: 'a', env: {} },
      { alias: 'b', command: 'b', env: { A: SECRET_SENTINEL, Z: SECRET_SENTINEL } },
      ],
    },
    claudeServers: {
      athena: {
        env: { PYTHONPATH: BACKEND_DIR },
        args: ['-m', 'athena_mcp', 'serve'],
        command: PYTHON_EXE,
      },
    },
    allowedTools: ['a', 'z'],
    disallowedTools: ['Bash', 'Write'],
  });
  assert.equal(first.configHash, second.configHash);
});

test('McpRuntimeSnapshot: tampered Athena gateway command or args fail closed', () => {
  assert.throws(() => createMcpRuntimeSnapshot({
    claudeServers: {
      athena: {
        command: 'npx',
        args: ['untrusted-upstream'],
        env: { PYTHONPATH: BACKEND_DIR },
      },
    },
  }), /app-owned contract/);
});
