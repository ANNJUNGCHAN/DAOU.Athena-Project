'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  DISABLED_FEATURES,
  buildCodexAppServerArgs,
  createCodexChatRuntime,
  createMcpAudit,
  resolveCodexExecutable,
} = require('./codex-chat-runtime');

const USER_DATA = 'C:\\AthenaData';
const CWD = 'C:\\AthenaData\\mcp-config';
const NATIVE = 'C:\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe';
const GATEWAY = Object.freeze({
  command: 'C:\\Athena\\python.exe',
  args: ['-m', 'athena_mcp', 'serve'],
  env: { PYTHONPATH: 'C:\\Athena\\backend' },
});
const TOOLS = Object.freeze([
  'mcp__athena__athena_search',
  'mcp__athena__dart__get_company',
]);

test('resolveCodexExecutable resolves the native binary behind a Windows npm shim', () => {
  const executable = resolveCodexExecutable({
    platform: 'win32',
    env: {},
    spawnSyncImpl(command, args, options) {
      assert.deepEqual([command, args, options.shell], ['where', ['codex'], false]);
      return { status: 0, stdout: 'C:\\npm\\codex.cmd\r\nC:\\npm\\codex.ps1\r\n' };
    },
    existsSync(candidate) { return candidate === NATIVE; },
  });
  assert.equal(executable, NATIVE);
});

test('resolveCodexExecutable fails closed when Windows only exposes non-native shims', () => {
  assert.throws(() => resolveCodexExecutable({
    platform: 'win32',
    env: {},
    spawnSyncImpl: () => ({ status: 0, stdout: 'C:\\npm\\codex.cmd\r\n' }),
    existsSync: () => false,
  }), (error) => error.code === 'CODEX_EXECUTABLE_NOT_FOUND' && error.actionNeeded === true);
});

test('resolveCodexExecutable uses the APPDATA npm package when PATH probing is unavailable', () => {
  assert.equal(resolveCodexExecutable({
    platform: 'win32',
    env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' },
    spawnSyncImpl: () => { throw new Error('where unavailable'); },
    existsSync: (candidate) => candidate.endsWith('\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe'),
  }), 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe');
});

test('app-server args isolate the Athena gateway and disable non-MCP capabilities', () => {
  const args = buildCodexAppServerArgs({ gateway: GATEWAY, allowedTools: TOOLS });
  assert.deepEqual(args.slice(0, 4), ['app-server', '--strict-config', '--listen', 'stdio://']);
  for (const feature of DISABLED_FEATURES) {
    const position = args.findIndex((entry, index) => entry === '--disable' && args[index + 1] === feature);
    assert.notEqual(position, -1, `missing disabled feature ${feature}`);
  }
  assert.ok(args.includes('web_search="disabled"'));
  const mcpOverride = args.find((entry) => entry.startsWith('mcp_servers='));
  assert.match(mcpOverride, /^mcp_servers=\{ athena = \{/);
  assert.match(mcpOverride, /enabled_tools = \["athena_search", "dart__get_company"\]/);
  assert.match(mcpOverride, /required = true/);
  assert.equal(args.includes('--stdio'), false);
});

test('runtime requires private Athena Codex authentication before spawning', () => {
  let spawned = false;
  const built = createCodexChatRuntime({
    userDataPath: USER_DATA,
    cwd: CWD,
    gateway: GATEWAY,
    allowedTools: TOOLS,
    securityKeyFn: () => 'security-1',
    identityKeyFn: () => 'codex:athena-runtime',
    platform: 'win32',
    env: { ATHENA_CODEX_BIN: NATIVE },
    fsImpl: { existsSync: () => false },
    spawnImpl: () => { spawned = true; },
  });
  const context = built.generationContextFactory();
  assert.throws(
    () => built.runtime.spawnGenerationAppServer(context),
    (error) => error.code === 'CODEX_PRIVATE_AUTH_REQUIRED'
      && error.actionNeeded === true
      && error.retryable === false
      && error.runtimeHome === path.join(USER_DATA, 'codex-runtime')
      && error.message === 'Athena 계정 설정에서 Codex 로그인을 완료해 주세요.',
  );
  assert.equal(spawned, false);
});

test('runtime spawns native Codex without a shell and registers fenced tree termination', async () => {
  const authPath = path.join(USER_DATA, 'codex-runtime', 'auth.json');
  const child = { pid: 42, stdin: {}, stdout: {}, stderr: {} };
  const spawnCalls = [];
  const terminations = [];
  let securityKey = 'security-1';
  const built = createCodexChatRuntime({
    userDataPath: USER_DATA,
    cwd: CWD,
    gateway: GATEWAY,
    allowedTools: TOOLS,
    securityKeyFn: () => securityKey,
    identityKeyFn: () => 'codex:athena-runtime',
    envOverridesFn: () => ({ ATHENA_MCP_ENV__dart__TOKEN: 'secret' }),
    platform: 'win32',
    env: { ATHENA_CODEX_BIN: NATIVE, BASE: '1' },
    fsImpl: { existsSync: (candidate) => candidate === authPath },
    spawnImpl(command, args, options) {
      spawnCalls.push({ command, args, options });
      return child;
    },
    terminateTreeFn: async (target, options) => {
      terminations.push({ target, options });
      return { ok: true, outcome: 'forced' };
    },
  });
  const context = built.generationContextFactory({
    runtimeGeneration: 7,
    processOwnerId: 'owner-7',
  });
  const spawned = built.runtime.spawnGenerationAppServer(context);
  assert.equal(spawned.child, child);
  assert.equal(spawnCalls[0].command, NATIVE);
  assert.deepEqual(spawnCalls[0].args, [...built.appServerArgs]);
  assert.equal(spawnCalls[0].options.shell, false);
  assert.equal(spawnCalls[0].options.cwd, CWD);
  assert.equal(spawnCalls[0].options.env.CODEX_HOME, path.join(USER_DATA, 'codex-runtime'));
  assert.equal(spawnCalls[0].options.env.ATHENA_MCP_ENV__dart__TOKEN, 'secret');
  assert.deepEqual(await spawned.terminationHandle.terminate(), { ok: true, outcome: 'forced' });
  assert.equal(terminations[0].target, child);
  assert.throws(() => context.spawnContext.assertCurrent(), /stale Codex chat generation/);

  const next = built.generationContextFactory();
  securityKey = 'security-2';
  assert.throws(() => next.spawnContext.buildEnv('codex'), /stale Codex chat generation/);
});

test('sessionOptions are ready for createCodexChatSession and carry explicit MCP audit', () => {
  const built = createCodexChatRuntime({
    userDataPath: USER_DATA,
    cwd: CWD,
    gateway: GATEWAY,
    allowedTools: TOOLS,
    securityKeyFn: () => 'security-1',
    identityKeyFn: () => 'codex:athena-runtime',
    platform: 'win32',
    env: { ATHENA_CODEX_BIN: NATIVE },
    fsImpl: { existsSync: () => true },
  });
  assert.equal(built.sessionOptions.runtime, built.runtime);
  assert.equal(built.sessionOptions.generationContextFactory, built.generationContextFactory);
  assert.equal(built.sessionOptions.cwd, CWD);
  assert.equal(built.sessionOptions.requiredMcpServer, built.mcpAudit.requiredMcpServer);
  assert.deepEqual(built.mcpAudit.requiredMcpServer, {
    name: 'athena',
    requiredTools: ['athena_search', 'dart__get_company'],
  });
});

test('MCP audit validates effective config, server, and exact approved tool inventory', () => {
  const audit = createMcpAudit(TOOLS, GATEWAY);
  const disabledFeatures = Object.fromEntries(DISABLED_FEATURES.map((feature) => [feature, false]));
  const valid = {
    configAudit: { config: {
      web_search: 'disabled',
      features: disabledFeatures,
      mcp_servers: { athena: { ...GATEWAY, enabled_tools: ['athena_search', 'dart__get_company'], required: true } },
    }, layers: [] },
    servers: [{
      name: 'athena',
      tools: {
        mcp__athena__athena_search: { description: 'search' },
        dart__get_company: { description: 'company' },
      },
    }],
  };
  assert.equal(audit.validate(valid), true);
  assert.throws(
    () => audit.validate({ ...valid, configAudit: { config: { mcp_servers: { athena: {}, extra: {} } } } }),
    (error) => error.code === 'CODEX_MCP_CONFIG_MISMATCH',
  );
  assert.throws(
    () => audit.validate({
      ...valid,
      configAudit: { config: { mcp_servers: { athena: { ...GATEWAY, command: 'other.exe' } } } },
    }),
    (error) => error.code === 'CODEX_MCP_CONFIG_MISMATCH',
  );
  assert.throws(
    () => audit.validate({ ...valid, servers: [{ name: 'athena', tools: [{ name: 'athena_search' }] }] }),
    (error) => error.code === 'CODEX_MCP_TOOL_INVENTORY_MISMATCH',
  );
});

test('gateway-wide policy admits dynamic Athena tools but rejects an empty inventory', () => {
  const audit = createMcpAudit('mcp__athena,Task,Read,Glob', GATEWAY);
  const args = buildCodexAppServerArgs({ gateway: GATEWAY, allowedTools: 'mcp__athena,Task,Read,Glob' });
  assert.equal(args.find((entry) => entry.startsWith('mcp_servers=')).includes('enabled_tools'), false);
  const configAudit = { config: {
    web_search: 'disabled',
    features: Object.fromEntries(DISABLED_FEATURES.map((feature) => [feature, false])),
    mcp_servers: { athena: { ...GATEWAY, required: true } },
  } };
  assert.equal(audit.validate({
    configAudit,
    servers: [{ name: 'athena', tools: { new_plugin__dynamic_tool: { description: 'dynamic' } } }],
  }), true);
  assert.throws(
    () => audit.validate({ configAudit, servers: [{ name: 'athena', tools: [] }] }),
    (error) => error.code === 'CODEX_MCP_TOOL_INVENTORY_MISMATCH',
  );
  assert.throws(
    () => audit.validate({
      configAudit: { config: { ...configAudit.config, web_search: 'live' } },
      servers: [{ name: 'athena', tools: { athena_search: {} } }],
    }),
    (error) => error.code === 'CODEX_BUILTIN_POLICY_MISMATCH',
  );
});
