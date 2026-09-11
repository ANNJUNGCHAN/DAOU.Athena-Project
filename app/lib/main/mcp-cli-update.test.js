'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = require('./mcp-cli');

test('실제 CLI 수정은 동일 별칭과 권한을 보존하고 목록에는 비밀값을 노출하지 않는다', async () => {
  const previous = process.env.ATHENA_MCP_REGISTRY_PATH;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-snippet-update-'));
  process.env.ATHENA_MCP_REGISTRY_PATH = path.join(dir, 'mcp_servers.json');
  try {
    const original = JSON.stringify({ mcpServers: { editable: { command: 'node', args: ['old-server.js'], env: { TOKEN: 'fixture-private-value' } } } });
    assert.equal((await cli.stageSnippet(original)).ok, true);
    assert.equal((await cli.approve('editable')).ok, true);
    assert.equal((await cli.allowTool('editable', 'read_data', true)).ok, true);
    const before = cli.list();
    assert.ok(!JSON.stringify(before).includes('fixture-private-value'));
    const config = JSON.parse(before.servers[0].configSnippet);
    assert.equal(config.mcpServers.editable.env.TOKEN, '__ATHENA_KEEP_ENV__:TOKEN');
    config.mcpServers.editable.args = ['new-server.js'];
    config.mcpServers.editable.env = { NEW_TOKEN: '__ATHENA_SAFESTORAGE__' };
    assert.equal((await cli.updateSnippet('editable', JSON.stringify(config))).ok, true);
    const after = cli.list();
    assert.equal(after.servers.length, 1);
    assert.equal(after.servers[0].alias, 'editable');
    assert.equal(after.servers[0].approved, true);
    assert.equal(after.servers[0].toolCount, 1);
    assert.equal(after.servers[0].argsPreview, 'new-server.js');
    assert.equal(after.servers[0].health, 'unknown');
    assert.ok(after.revision > before.revision);
    const consent = JSON.parse(fs.readFileSync(path.join(dir, 'consent.json'), 'utf8'));
    assert.deepEqual(consent.editable.approved_tools, ['read_data']);
    assert.equal(consent.editable.full_command_text, 'node new-server.js');
    const persisted = fs.readFileSync(process.env.ATHENA_MCP_REGISTRY_PATH, 'utf8');
    assert.ok(!persisted.includes('fixture-private-value'));
    assert.equal((await cli.updateSnippet('editable', JSON.stringify({ mcpServers: { different: { command: 'node' } } }))).ok, false);
    assert.equal(fs.readFileSync(process.env.ATHENA_MCP_REGISTRY_PATH, 'utf8'), persisted);
  } finally {
    if (previous === undefined) delete process.env.ATHENA_MCP_REGISTRY_PATH;
    else process.env.ATHENA_MCP_REGISTRY_PATH = previous;
  }
});
