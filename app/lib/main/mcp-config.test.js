'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureMcpConfig, BACKEND_DIR, PYTHON_EXE } = require('./mcp-config');

test('ensureMcpConfig: userData 아래에 claude -p가 읽을 수 있는 .mcp.json을 쓴다', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-mcp-config-test-'));
  try {
    const { dir, configFile, configPath } = ensureMcpConfig(tmp);
    assert.equal(dir, path.join(tmp, 'mcp-config'));
    assert.equal(configFile, '.mcp.json');
    assert.equal(configPath, path.join(dir, '.mcp.json'));
    assert.ok(fs.existsSync(configPath));

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    // spike/cli-pipe/gateway/.mcp.json과 같은 형상 — 서버 키는 "athena"
    assert.ok(written.mcpServers.athena);
    assert.equal(written.mcpServers.athena.command, PYTHON_EXE);
    assert.deepEqual(written.mcpServers.athena.args, ['-m', 'athena_mcp', 'serve']);
    assert.equal(written.mcpServers.athena.env.PYTHONPATH, BACKEND_DIR);
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
