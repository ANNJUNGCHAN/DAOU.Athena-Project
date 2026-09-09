'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createConversationRuntimes } = require('./conversation-runtimes');
const { createConversationSessionPool } = require('./conversation-session-pool');
const { runConversationSessionTurn } = require('./conversation-session-turn');
const { createCodexChatRuntime } = require('./codex-chat-runtime');
const { createCodexChatSession } = require('./codex-chat-session');
const { GATEWAY_ALLOWED_TOOLS } = require('./claude-tool-policy');
const { assertSessionStopsSucceeded } = require('./provider-session-shutdown');

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function loadHarness({ providerId = 'claude', sessionFactory = null } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
  const start = source.indexOf('const liveChatPools = new Map();');
  const end = source.indexOf('function liveGrokSecurityKey()', start);
  assert.ok(start >= 0 && end > start, 'main.js provider chat pool block must exist');

  const state = {
    providerId,
    accountId: `${providerId}-account`,
    securityKey: 'security-v1',
    models: {
      claude: { model: 'claude-model', effort: 'high' },
      grok: { model: 'grok-model', effort: 'medium' },
    },
    codex: { model: 'codex-model', effort: 'xhigh' },
  };
  const made = { claude: [], grok: [], codex: [] };
  let codexReads = 0;

  function makeSession(id) {
    const session = sessionFactory ? sessionFactory(id) : {
      providerId: id,
      warmCalls: [],
      stopCalls: [],
      warm(options) { this.warmCalls.push(options); },
      run() {},
      stop(reason) { this.stopCalls.push(reason); },
      snapshot: () => ({ state: 'idle' }),
    };
    if (!session.providerId) session.providerId = id;
    made[id].push(session);
    return session;
  }

  const context = {
    createConversationSessionPool,
    runConversationSessionTurn,
    assertSessionStopsSucceeded,
    createLiveChatSessionForConversation: () => makeSession('claude'),
    createLiveGrokChatSession: () => makeSession('grok'),
    createLiveCodexChatSession: () => makeSession('codex'),
    currentProviderSelection: { activeAccount: { providerId, accountId: state.accountId } },
    cliAccounts: { peekActiveAccount: () => null },
    modelPrefs: { get: () => state.models },
    codexConfig: { readModelSettings: () => { codexReads += 1; return state.codex; } },
    liveGrokSecurityKey: () => state.securityKey,
    liveRuntimes: createConversationRuntimes(),
    canonicalHash: (value) => JSON.stringify(value),
    isQuitting: false,
    process: { env: {} },
    persistentChatEnabled: () => true,
    resolveLiveQueryProviderId: () => state.providerId,
    mdlog: () => {},
  };
  const api = vm.runInNewContext(`${source.slice(start, end)}\n({
    liveProviderWarmOptions, createLiveProviderChatSession, prepareLiveChatPool,
    getLiveProviderChatSession, runLiveProviderChatTurn, stopLiveChatPools,
  })`, context);

  return {
    api,
    context,
    state,
    made,
    runtimes: context.liveRuntimes,
    codexReads: () => codexReads,
    select(id) {
      state.providerId = id;
      state.accountId = `${id}-account`;
      context.currentProviderSelection = {
        activeAccount: { providerId: id, accountId: state.accountId },
      };
    },
  };
}

test('main Codex 팩토리는 실제 gateway 권한 문자열을 runtime에 전달하고 로그인 필요 코드를 보존한다', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
  const start = source.indexOf('function createLiveCodexChatSession()');
  const end = source.indexOf('const liveChatPools = new Map();', start);
  assert.ok(start >= 0 && end > start, 'main.js Codex chat factory must exist');
  const gateway = {
    command: '/fixture/python',
    args: ['-m', 'athena_mcp', 'serve'],
    env: { PYTHONPATH: '/fixture/backend' },
  };
  let builtRuntime = null;
  let receivedSessionOptions = null;
  const context = {
    getLiveMcpConfig: () => ({ dir: '/fixture/project', configPath: '/fixture/mcp.json' }),
    fs: { readFileSync: () => JSON.stringify({ mcpServers: { athena: gateway } }) },
    app: { getPath: () => '/fixture/userdata' },
    GATEWAY_ALLOWED_TOOLS,
    createCodexChatRuntime: (options) => {
      builtRuntime = createCodexChatRuntime({
        ...options,
        fsImpl: { existsSync: () => false },
        spawnImpl: () => { throw new Error('private auth gate must run before spawn'); },
        spawnSyncImpl: () => ({ status: 1, stdout: '' }),
        terminateTreeFn: async () => {},
        env: { ATHENA_CODEX_BIN: '/fixture/codex.exe' },
        platform: 'win32',
      });
      return builtRuntime;
    },
    createCodexChatSession: (options) => {
      receivedSessionOptions = options;
      return createCodexChatSession(options);
    },
    mcpEnv: { buildEnvOverrides: () => ({ ATHENA_TOKEN: 'fixture' }) },
    liveGrokSecurityKey: () => 'security-v1',
    currentProviderSelection: { activeAccount: { providerId: 'codex', accountId: 'codex-account' } },
    cliAccounts: { peekActiveAccount: () => null },
    buildLiveSystemPrompt: (provider) => `rules:${provider}`,
  };
  const factory = vm.runInNewContext(`${source.slice(start, end)}\ncreateLiveCodexChatSession`, context);
  const session = factory();

  assert.ok(builtRuntime, 'actual createCodexChatRuntime accepted main payload');
  assert.equal(receivedSessionOptions.developerInstructions, 'rules:codex');
  assert.deepEqual(builtRuntime.mcpAudit.requiredMcpServer, { name: 'athena', requiredTools: [] });
  const mcpOverride = builtRuntime.appServerArgs.find((arg) => arg.startsWith('mcp_servers='));
  assert.match(mcpOverride, /athena/);
  assert.doesNotMatch(mcpOverride, /Task|Read|Glob/);

  await assert.rejects(
    session.warm({ model: 'codex-model', effort: 'high', identityKey: 'codex-account', securityKey: 'security-v1' }),
    (error) => error.code === 'CODEX_PRIVATE_AUTH_REQUIRED'
      && error.actionNeeded === true
      && error.retryable === false
      && /Codex 로그인/.test(error.message),
  );
  const result = await session.run({
    prompt: '로그인 경계 확인', model: 'codex-model', effort: 'high',
    identityKey: 'codex-account', securityKey: 'security-v1',
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'CODEX_PRIVATE_AUTH_REQUIRED');
  assert.match(result.error, /Codex 로그인/);
});

test('Claude·Grok·Codex는 선택된 공급자만 blank session 두 개를 예열한다', () => {
  const harness = loadHarness();
  for (const providerId of ['claude', 'grok', 'codex']) {
    harness.select(providerId);
    const before = Object.fromEntries(Object.entries(harness.made).map(([id, rows]) => [id, rows.length]));
    const pool = harness.api.prepareLiveChatPool(providerId);
    const snapshot = pool.snapshot();

    assert.equal(snapshot.desiredSize, 2);
    assert.equal(snapshot.owned, 2);
    assert.equal(snapshot.ready, 2);
    assert.equal(harness.made[providerId].length, before[providerId] + 2);
    for (const otherId of ['claude', 'grok', 'codex'].filter((id) => id !== providerId)) {
      assert.equal(harness.made[otherId].length, before[otherId], `${providerId} 예열 중 ${otherId} 팩토리를 쓰지 않는다`);
    }
    assert.ok(harness.made[providerId].slice(-2).every((session) => (
      session.warmCalls.length === 1 && session.warmCalls[0].resumeSessionId === null
    )));
  }

  assert.ok(harness.codexReads() >= 1);
  assert.ok(harness.made.codex.every((session) => (
    session.warmCalls[0].model === 'codex-model' && session.warmCalls[0].effort === 'xhigh'
  )));
});

test('서로 다른 대화는 같은 공급자의 서로 다른 spare를 임대하고 각자 재사용한다', async () => {
  const harness = loadHarness({ providerId: 'grok' });
  harness.select('grok');

  const firstA = harness.api.getLiveProviderChatSession('A', 'grok');
  const secondA = harness.api.getLiveProviderChatSession('A', 'grok');
  const firstB = harness.api.getLiveProviderChatSession('B', 'grok');
  assert.equal(secondA, firstA);
  assert.notEqual(firstB, firstA);
  assert.equal(firstA.providerId, 'grok');
  assert.equal(firstB.providerId, 'grok');
  assert.equal(harness.made.claude.length, 0);
  assert.equal(harness.made.codex.length, 0);
  assert.equal(harness.made.grok.length, 2, '동기 claim 경로에서 과잉 생성하지 않는다');

  await flush();
  assert.equal(harness.made.grok.length, 4, '두 임대 뒤 spare 두 개만 비동기 보충한다');
});

test('모델·보안 설정 교체는 spare를 즉시 회전하고 임대 세션은 다음 사용 때 교체한다', async () => {
  const harness = loadHarness();
  const leased = harness.api.getLiveProviderChatSession('A', 'claude');
  const oldSpare = harness.made.claude.find((session) => session !== leased);

  harness.state.models.claude = { model: 'claude-model-v2', effort: 'low' };
  harness.state.securityKey = 'security-v2';
  const rotated = harness.api.prepareLiveChatPool('claude');
  assert.equal(oldSpare.stopCalls.length, 1);
  assert.equal(leased.stopCalls.length, 0, '풀 설정 회전은 임대 세션을 닫지 않는다');
  assert.equal(rotated.snapshot().owned, 2);
  assert.ok(harness.made.claude.slice(2).every((session) => (
    session.warmCalls[0].model === 'claude-model-v2'
      && session.warmCalls[0].securityKey === 'security-v2'
  )));

  const replacement = harness.api.getLiveProviderChatSession('A', 'claude');
  assert.notEqual(replacement, leased);
  assert.equal(leased.stopCalls.length, 1, '대화가 다시 쓰일 때 이전 session key를 폐기한다');

  await flush();
  assert.equal(rotated.snapshot().owned, 2);
});

test('pool 종료는 spare만 닫고 임대 세션은 conversation runtime이 별도로 종료한다', async () => {
  const harness = loadHarness({ providerId: 'codex' });
  harness.select('codex');
  const leased = harness.api.getLiveProviderChatSession('A', 'codex');
  const spare = harness.made.codex.find((session) => session !== leased);
  const reason = new Error('app shutdown');

  harness.api.stopLiveChatPools(reason);
  assert.equal(spare.stopCalls[0], reason);
  assert.equal(leased.stopCalls.length, 0);
  await flush();
  assert.equal(harness.made.codex.length, 2, '중단된 pool의 예약 refill은 실행되지 않는다');

  harness.runtimes.stopAllChatSessions(reason);
  assert.equal(leased.stopCalls[0], reason);
});

test('Grok·Codex는 warming 중 취소하면 해당 임대만 제거하고 다음 질문에 다른 spare를 준다', async () => {
  for (const providerId of ['grok', 'codex']) {
    const sessions = [];
    const harness = loadHarness({
      providerId,
      sessionFactory: (id) => {
        let releaseWarm;
        const warmGate = new Promise((resolve) => { releaseWarm = resolve; });
        const session = {
          providerId: id,
          promptSubmitted: false,
          stopCalls: [],
          warm: () => warmGate,
          async run({ signal }) {
            await warmGate;
            if (!signal.aborted) this.promptSubmitted = true;
            return { ok: false, aborted: signal.aborted };
          },
          stop(reason) {
            this.stopCalls.push(reason);
            releaseWarm();
            return Promise.resolve();
          },
          snapshot: () => ({ state: 'warming', pid: null }),
        };
        sessions.push(session);
        return session;
      },
    });
    harness.select(providerId);
    let cancelHandle = null;
    const turn = harness.api.runLiveProviderChatTurn(providerId, 'A', {
      prompt: 'submit하면 안 되는 질문',
      onSpawn: (handle) => { if (!cancelHandle) cancelHandle = handle; },
    });
    assert.ok(cancelHandle, `${providerId}는 warming 중에도 취소 핸들을 즉시 제공한다`);
    const cancelled = sessions[0];
    await cancelHandle.kill(new Error('warming cancel'));
    const result = await turn;
    assert.equal(result.aborted, true);
    assert.equal(cancelled.promptSubmitted, false);
    assert.equal(cancelled.stopCalls.length, 1);

    const replacement = harness.api.getLiveProviderChatSession('A', providerId);
    assert.notEqual(replacement, cancelled);
    assert.equal(replacement.providerId, providerId);

    harness.api.stopLiveChatPools(new Error('test cleanup'));
    await harness.runtimes.stopAllChatSessions(new Error('test cleanup'));
  }
});
