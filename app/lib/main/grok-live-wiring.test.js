'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createConversationRuntimes } = require('./conversation-runtimes');

test('Grok 실제 팩토리는 Athena MCP와 현재 비밀 환경을 연결하고 권한 변경을 감지한다', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
  const start = source.indexOf('function getLiveGrokSession(');
  const end = source.indexOf('function stopLiveClaudeChatSession(', start);
  assert.ok(start >= 0 && end > start);
  const runtimes = createConversationRuntimes();
  let overrides = { ATHENA_MCP_ENV__example__TOKEN: 'fixture-before' };
  const revisions = new Map();
  const context = {
    liveRuntimes: runtimes,
    getLiveMcpConfig: () => ({ dir: '/fixture', configPath: '/fixture/mcp.json',
      grokConfigPath: '/fixture/grok.toml', grokProfilePath: '/fixture/profile.md' }),
    fs: { readFileSync: () => JSON.stringify({ mcpServers: { athena: {
      command: '/python', args: ['-m', 'athena_mcp', 'serve'], env: { PYTHONPATH: '/backend' },
    } } }) },
    createGrokAcpSession: (options) => ({ options, snapshot: () => ({ state: 'idle' }), stop() {} }),
    buildLiveSystemPrompt: (provider) => `rules:${provider}`,
    mcpEnv: { buildEnvOverrides: () => overrides, registryPath: () => '/fixture/registry.json' },
    canonicalHash: (value) => JSON.stringify(value),
    providerSecurityGeneration: 1,
    fileRevision: (file) => revisions.get(file) || 0,
    path, app: { getPath: () => '/userdata' },
  };
  const api = vm.runInNewContext(`${source.slice(start, end)}\n({getLiveGrokSession,liveGrokSecurityKey})`, context);
  const session = api.getLiveGrokSession('A');
  assert.equal(api.getLiveGrokSession('A'), session);
  assert.equal(session.options.rules, 'rules:grok');
  assert.equal(session.options.mcpServersFn()[0].name, 'athena');
  assert.equal(session.options.mcpServersFn()[0].env.find((item) => item.name === 'ATHENA_MCP_TOOL_NAME_STYLE').value, 'grok');
  assert.equal(session.options.envOverridesFn().ATHENA_MCP_ENV__example__TOKEN, 'fixture-before');
  assert.equal(session.options.envOverridesFn().GROK_CLAUDE_MCPS_ENABLED, '0');
  assert.equal(session.options.envOverridesFn().GROK_CURSOR_MCPS_ENABLED, '0');
  overrides = { ATHENA_MCP_ENV__example__TOKEN: 'fixture-after' };
  assert.equal(session.options.envOverridesFn().ATHENA_MCP_ENV__example__TOKEN, 'fixture-after');
  const original = api.liveGrokSecurityKey();
  for (const file of ['/fixture/registry.json', path.join('/fixture', 'consent.json'), path.join('/userdata', 'athena-secrets.json')]) {
    revisions.set(file, 1);
    assert.notEqual(api.liveGrokSecurityKey(), original);
    revisions.clear();
  }
});
