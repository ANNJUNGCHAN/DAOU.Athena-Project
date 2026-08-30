'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildMainMcpRuntimeSnapshot,
  buildProviderToolPolicy,
  createProviderRuntimeController,
  createProviderTurnContextRegistry,
  resolvePersistentChatEnabled,
  shouldMarkProviderCanvasVisible,
  validateMainMcpSecurityState,
} = require('./provider-runtime-bootstrap');
const { BACKEND_DIR, PYTHON_EXE, canonicalHash, createMcpRuntimeSnapshot } = require('./mcp-config');

test('process-start flag defaults cold and accepts only exact 0/1 overrides', () => {
  assert.equal(resolvePersistentChatEnabled({}, false), false);
  assert.equal(resolvePersistentChatEnabled({ ATHENA_PERSISTENT_CHAT: '1' }, false), true);
  assert.equal(resolvePersistentChatEnabled({ ATHENA_PERSISTENT_CHAT: '0' }, true), false);
  assert.equal(resolvePersistentChatEnabled({ ATHENA_PERSISTENT_CHAT: 'true' }, false), false);
});

test('cold controller does not load persistent supervisor, SDK adapter, or app-server modules', async () => {
  const loaded = [];
  const runtime = createProviderRuntimeController({
    persistentEnabled: false,
    requireFn(id) { loaded.push(id); throw new Error(`unexpected import: ${id}`); },
  });
  assert.equal(runtime.mode, 'cold');
  await runtime.start();
  await runtime.stop();
  assert.deepEqual(loaded, []);
  assert.equal(runtime.snapshot().persistentConstructed, false);
});

test('main MCP snapshot binds full revisions and exact builtin plus approved upstream inventory', () => {
  const snapshot = buildMainMcpRuntimeSnapshot({
    createSnapshot: createMcpRuntimeSnapshot,
    registry: {
      revision: 4,
      fingerprint: 'registry-fingerprint',
      servers: {
        dart: { alias: 'dart', command: 'node', args: ['server.js'], env: { TOKEN: '__ATHENA_SAFESTORAGE__' } },
        oversized: { alias: 'oversized', command: 'node', args: ['server.js'], env: {} },
      },
    },
    consent: {
      $athena: { revision: 5, fingerprint: 'consent-fingerprint' },
      dart: { approved: true, approved_tools: ['get_disclosure', 'get_company'] },
      oversized: { approved: true, approved_tools: [`tool_${'x'.repeat(64)}`] },
      blocked: { approved: true, approved_tools: ['must_not_escape'] },
    },
    claudeServers: {
      athena: {
        command: PYTHON_EXE,
        args: ['-m', 'athena_mcp', 'serve'],
        env: { PYTHONPATH: BACKEND_DIR },
      },
      unexpected: { command: 'node', args: ['untrusted'], env: { TOKEN: 'secret' } },
    },
    securityGeneration: 6,
    secretRevision: 7,
    gatewayEpochRevision: 8,
    codexConfigRevision: 9,
    disallowedTools: ['Bash'],
  });
  assert.equal(snapshot.registryRevision, 4);
  assert.equal(snapshot.registryHash, 'registry-fingerprint');
  assert.equal(snapshot.consentRevision, 5);
  assert.equal(snapshot.consentHash, 'consent-fingerprint');
  assert.equal(snapshot.secretRevision, 7);
  assert.equal(snapshot.gatewayEpochRevision, 8);
  assert.equal(snapshot.codexConfigRevision, 9);
  assert.match(snapshot.configHash, /^[a-f0-9]{64}$/);
  assert.ok(snapshot.allowedTools.includes('mcp__athena__athena_routine'));
  assert.ok(snapshot.allowedTools.includes('mcp__athena__athena_brain'));
  assert.ok(snapshot.allowedTools.includes('mcp__athena__athena_nudge_guard'));
  assert.ok(snapshot.allowedTools.includes('mcp__athena__dart__get_disclosure'));
  assert.ok(snapshot.allowedTools.includes('mcp__athena__dart__get_company'));
  assert.equal(snapshot.allowedTools.includes('mcp__athena__blocked__must_not_escape'), false);
  assert.equal(snapshot.allowedTools.some((tool) => tool.startsWith('mcp__athena__oversized__')), false);
  assert.deepEqual(snapshot.claudeServers, {
    athena: {
      command: PYTHON_EXE,
      args: ['-m', 'athena_mcp', 'serve'],
      env: { PYTHONPATH: BACKEND_DIR },
    },
  });
  assert.equal(Object.hasOwn(snapshot.claudeServers, 'unexpected'), false);
  assert.ok(Object.isFrozen(snapshot.claudeServers.athena.env));
  assert.ok(Object.isFrozen(snapshot));
});

test('main MCP snapshot rejects a modified Athena gateway command or environment', () => {
  const common = {
    createSnapshot: createMcpRuntimeSnapshot,
    registry: { servers: {} },
    consent: {},
  };
  assert.throws(() => buildMainMcpRuntimeSnapshot({
    ...common,
    claudeServers: {
      athena: {
        command: 'python',
        args: ['-m', 'athena_mcp', 'serve'],
        env: { PYTHONPATH: BACKEND_DIR },
      },
    },
  }), /gateway config/);
  assert.throws(() => buildMainMcpRuntimeSnapshot({
    ...common,
    claudeServers: {
      athena: {
        command: PYTHON_EXE,
        args: ['-m', 'athena_mcp', 'serve'],
        env: { PYTHONPATH: 'C:\\untrusted' },
      },
    },
  }), /gateway config/);
});

test('security state validation rejects missing schema and canonical fingerprint mismatches', () => {
  const servers = { dart: { alias: 'dart', command: 'node', args: [], env: {} } };
  const records = { dart: { alias: 'dart', approved: true, approved_tools: ['lookup'] } };
  const valid = {
    registry: { revision: 1, fingerprint: canonicalHash(servers), servers },
    consent: { $athena: { revision: 2, fingerprint: canonicalHash(records) }, ...records },
    canonicalHash,
  };
  assert.doesNotThrow(() => validateMainMcpSecurityState(valid));
  assert.throws(() => validateMainMcpSecurityState({ ...valid, registry: null }), /registry state/);
  assert.throws(() => validateMainMcpSecurityState({
    ...valid,
    registry: { ...valid.registry, fingerprint: '0'.repeat(64) },
  }), /fingerprint mismatch/);
  assert.throws(() => validateMainMcpSecurityState({
    ...valid,
    consent: { ...valid.consent, $athena: { revision: 2, fingerprint: 'f'.repeat(64) } },
  }), /fingerprint mismatch/);
});

test('desired-state tool policy uses the snapshot exact MCP allowlist plus approved local builtins', () => {
  const snapshot = Object.freeze({
    allowedTools: Object.freeze([
      'mcp__athena__athena_routine',
      'mcp__athena__dart__get_disclosure',
    ]),
  });
  const policy = buildProviderToolPolicy(
    snapshot,
    'mcp__athena,Task,Read,Glob',
    'Bash,Write',
  );
  assert.deepEqual(policy.allowedTools, [
    'mcp__athena__athena_routine',
    'mcp__athena__dart__get_disclosure',
    'Task',
    'Read',
    'Glob',
  ]);
  assert.equal(policy.allowedTools.includes('mcp__athena'), false);
  assert.ok(Object.isFrozen(policy.allowedTools));
});

test('per-submit context registry keeps overlapping turns isolated and drops stale events', () => {
  const contexts = createProviderTurnContextRegistry();
  const q1 = { replay: [], canvases: [] };
  const q2 = { replay: [], canvases: [] };
  contexts.set('q1', q1);
  contexts.set('q2', q2);
  contexts.get('q1').replay.push('q1-late-event');
  contexts.get('q2').canvases.push('q2-card');
  assert.deepEqual(q1, { replay: ['q1-late-event'], canvases: [] });
  assert.deepEqual(q2, { replay: [], canvases: ['q2-card'] });
  assert.equal(contexts.deleteIfSame('q1', q2), false);
  assert.equal(contexts.deleteIfSame('q1', q1), true);
  assert.equal(contexts.get('q1'), undefined);
  assert.equal(contexts.get('q2'), q2);
});

test('main marks visible subagent steps before relaying them for first-paint ownership', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  assert.match(source, /onSubagentStep\(step\)\s*\{[\s\S]*?markProviderFirstVisible\(step\);[\s\S]*?sendLiveSubagentStep\(step\);[\s\S]*?\}/);
});

test('pushed canvas side-channel result cannot claim renderer first-visible ownership', () => {
  assert.equal(shouldMarkProviderCanvasVisible({ status: 'pushed' }), false);
  assert.equal(shouldMarkProviderCanvasVisible({ status: 'returned' }), true);
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  assert.match(source, /if \(shouldMarkProviderCanvasVisible\(result\)\) markProviderFirstVisible\(metadata\);/);
});

test('controller uses the coordinator capability unchanged and passes process identity hooks to termination', async () => {
  let supervisorOptions;
  let desired;
  let terminatedOptions;
  const capability = {
    stamp: { securityGeneration: 9, epochRevision: 12 },
    buildCapabilityEnv: () => ({ TOKEN: 'one-owner' }),
    dispose() {},
  };
  class FakeSupervisor {
    constructor(options) { supervisorOptions = options; }
    async start(value) { desired = value; }
    async stop() {}
    snapshot() { return {}; }
  }
  const readCreationTime = async () => 'created';
  const commitSuccess = async () => {};
  const runtime = createProviderRuntimeController({
    persistentEnabled: true,
    readProcessCreationTime: readCreationTime,
    commitSuccess,
    requireFn(id) {
      return {
        './provider-session-supervisor': { ProviderSessionSupervisor: FakeSupervisor },
        './provider-event-router': { createProviderEventRouter: () => ({ route() {} }) },
        './claude-agent-session': { createClaudeAgentSession: () => ({}) },
        './proc-utils': { terminateTree: async (_child, options) => { terminatedOptions = options; return { ok: true }; } },
      }[id];
    },
  });
  const state = { configGeneration: 4, securityGeneration: 9 };
  await runtime.start(state, capability);
  assert.strictEqual(supervisorOptions.commitSuccess, commitSuccess);
  const generated = supervisorOptions.generationContextFactory({ desiredState: desired });
  assert.deepEqual(generated.spawnContext.buildEnv(), { TOKEN: 'one-owner' });
  const child = { pid: 44, creationTime: 'created' };
  await generated.spawnContext.registerChild(child).terminate();
  assert.equal(terminatedOptions.expectedCreationTime, 'created');
  assert.strictEqual(terminatedOptions.readCreationTime, readCreationTime);
  const restarted = supervisorOptions.generationContextFactory({ desiredState: desired });
  assert.deepEqual(restarted.spawnContext.buildEnv(), { TOKEN: 'one-owner' });
  await runtime.stop();
});

test('persistent controller routes normalized events and validates the first paint owner', async () => {
  const events = [];
  const acknowledgements = [];
  let supervisorOptions;
  class FakeSupervisor {
    constructor(options) { supervisorOptions = options; this.desired = null; }
    async start(desired) { this.desired = desired; }
    async ready() { return { provider: 'claude', runtimeGeneration: 1 }; }
    async sendTurn(request) {
      const event = {
        provider: 'claude', runtimeGeneration: 1, clientSubmitId: request.clientSubmitId,
        conversationId: request.conversationId, turnId: 'turn-1', sequence: 1,
        type: 'text_delta', payload: { text: '안녕' }, monotonicAtMs: 10,
      };
      await supervisorOptions.onEvent(event);
      await supervisorOptions.onEvent({ ...event, sequence: 2, type: 'turn_completed', payload: {
        providerBinding: { provider: 'claude', sessionId: 'session-1' },
        continuationCheckpoint: { provider: 'claude', sessionId: 'session-1', assistantMessageId: 'a1', assistantMessageHash: 'a'.repeat(64) },
        finalText: '안녕', usage: {},
      } });
      return { ok: true, turnId: 'turn-1', finalText: '안녕' };
    }
    async interrupt() { return null; }
    async rotate() { return { provider: 'claude', runtimeGeneration: 2 }; }
    async stop() {}
    snapshot() { return { state: 'ready' }; }
  }
  const fakeMetrics = {
    beginTurn() {}, mark() {}, completeTurn() {}, increment() {}, report() { return {}; },
    acknowledgePaint(value) { acknowledgements.push(value); return true; },
  };
  const runtime = createProviderRuntimeController({
    persistentEnabled: true,
    contractDecision: 'CLAUDE_ONLY',
    metrics: fakeMetrics,
    requireFn(id) {
      const modules = {
        './provider-session-supervisor': { ProviderSessionSupervisor: FakeSupervisor },
        './provider-event-router': { createProviderEventRouter: (options) => ({ route(event) { options.onTextDelta?.(event.payload.text, { clientSubmitId: event.clientSubmitId, turnId: event.turnId, sequence: event.sequence, origin: options.origin }); options.onTerminal?.(event.type, event.payload, { clientSubmitId: event.clientSubmitId, turnId: event.turnId, sequence: event.sequence, origin: options.origin }); return { accepted: true }; } }) },
        './claude-agent-session': { createClaudeAgentSession: () => ({}) },
        './proc-utils': { terminateTree: async () => ({ ok: true }) },
        './mcp-security-epoch': { createMcpSecurityEpochStore: () => ({
          publishGeneration: () => ({ buildCapabilityEnv: () => ({}), dispose() {} }),
          invalidate() {},
        }) },
      };
      if (!modules[id]) throw new Error(`unexpected module ${id}`);
      return modules[id];
    },
    callbacks: { onTextDelta: (text, meta) => events.push({ text, meta }) },
    stateDir: 'C:\\athena-test',
  });
  await runtime.start({ provider: 'claude', conversationId: 'conversation-1' });
  const result = await runtime.sendTurn({
    request: {
      clientSubmitId: '11111111-1111-4111-8111-111111111111',
      conversationId: 'conversation-1', origin: 'shell', userText: '안녕',
    },
    expectedRendererId: 7,
    rendererSubmittedAt: 1,
  });
  assert.equal(result.ok, true);
  assert.equal(events[0].meta.turnId, 'turn-1');
  assert.equal(runtime.acknowledgePaint({
    clientSubmitId: '11111111-1111-4111-8111-111111111111', turnId: 'turn-1', sequence: 1,
    rendererSubmittedAt: 1, rendererReceivedAt: 2, rendererPaintedAt: 3,
  }, 8), false);
  assert.equal(runtime.acknowledgePaint({
    clientSubmitId: '11111111-1111-4111-8111-111111111111', turnId: 'turn-1', sequence: 1,
    rendererSubmittedAt: 1, rendererReceivedAt: 2, rendererPaintedAt: 3,
  }, 7), true);
  assert.equal(acknowledgements.length, 1);
});

test('terminal submission/router tombstones are bounded and expire without timers', async () => {
  let clock = 1_000;
  let supervisorOptions;
  let turn = 0;
  class FakeSupervisor {
    constructor(options) { supervisorOptions = options; }
    async start() {}
    async ready() { return {}; }
    async sendTurn(request) {
      turn += 1;
      const turnId = `turn-${turn}`;
      await supervisorOptions.onEvent({
        provider: 'claude', runtimeGeneration: 1, clientSubmitId: request.clientSubmitId,
        conversationId: request.conversationId, turnId, sequence: 1,
        type: 'text_delta', payload: { text: 'x' }, monotonicAtMs: clock,
      });
      return { ok: true, turnId, finalText: 'x' };
    }
    async interrupt() { return null; }
    async rotate() { return {}; }
    async stop() {}
    snapshot() { return {}; }
  }
  const runtime = createProviderRuntimeController({
    persistentEnabled: true,
    maxRetainedTurns: 2,
    retentionMs: 50,
    now: () => clock,
    stateDir: 'C:\\athena-test',
    requireFn(id) {
      return {
        './provider-session-supervisor': { ProviderSessionSupervisor: FakeSupervisor },
        './provider-event-router': { createProviderEventRouter: () => ({ route() {} }) },
        './claude-agent-session': { createClaudeAgentSession: () => ({}) },
        './proc-utils': { terminateTree: async () => ({ ok: true }) },
        './mcp-security-epoch': { createMcpSecurityEpochStore: () => ({
          publishGeneration: () => ({ buildCapabilityEnv: () => ({}), dispose() {} }),
          invalidate() {},
        }) },
      }[id];
    },
  });
  await runtime.start({ conversationId: 'conversation' });
  for (let index = 1; index <= 3; index += 1) {
    await runtime.sendTurn({
      request: {
        clientSubmitId: `11111111-1111-4111-8111-11111111111${index}`,
        conversationId: 'conversation', origin: 'shell', userText: 'x',
      },
      expectedRendererId: 1,
      rendererSubmittedAt: 1,
    });
    clock += 1;
  }
  assert.equal(runtime.snapshot().retainedSubmissions, 2);
  assert.equal(runtime.snapshot().retainedRouters, 2);
  clock += 100;
  assert.equal(runtime.snapshot().retainedSubmissions, 0);
  assert.equal(runtime.snapshot().retainedRouters, 0);
});

test('admission gate rejects turns without provider writes until explicitly unblocked', async () => {
  let writes = 0;
  class FakeSupervisor {
    async start() {}
    async ready() { return {}; }
    async sendTurn() { writes += 1; return { ok: true, turnId: 'turn', finalText: 'x' }; }
    async interrupt() { return null; }
    async rotate() { return {}; }
    async stop() {}
    snapshot() { return {}; }
  }
  const runtime = createProviderRuntimeController({
    persistentEnabled: true,
    stateDir: 'C:\\athena-test',
    requireFn(id) {
      return {
        './provider-session-supervisor': { ProviderSessionSupervisor: FakeSupervisor },
        './provider-event-router': { createProviderEventRouter: () => ({ route() {} }) },
        './claude-agent-session': { createClaudeAgentSession: () => ({}) },
        './proc-utils': { terminateTree: async () => ({ ok: true }) },
        './mcp-security-epoch': { createMcpSecurityEpochStore: () => ({
          publishGeneration: () => ({ buildCapabilityEnv: () => ({}), dispose() {} }),
          invalidate() {},
        }) },
      }[id];
    },
  });
  await runtime.start({ conversationId: 'c' });
  runtime.blockNewTurns({ kind: 'allow' });
  await assert.rejects(
    runtime.sendTurn({
      request: { clientSubmitId: '11111111-1111-4111-8111-111111111111', conversationId: 'c', origin: 'shell', userText: 'x' },
      expectedRendererId: 1,
      rendererSubmittedAt: 1,
    }),
    (error) => error.code === 'PROVIDER_RUNTIME_ACTION_NEEDED' && error.actionNeeded === true,
  );
  assert.equal(writes, 0);
  assert.equal(runtime.snapshot().admissionBlocked, true);
  runtime.unblockTurns();
  await runtime.sendTurn({
    request: { clientSubmitId: '22222222-2222-4222-8222-222222222222', conversationId: 'c', origin: 'shell', userText: 'x' },
    expectedRendererId: 1,
    rendererSubmittedAt: 1,
  });
  assert.equal(writes, 1);
  assert.equal(runtime.snapshot().admissionBlocked, false);
});

test('controller rejects a turn whose conversation differs from the published desired state', async () => {
  let writes = 0;
  class FakeSupervisor {
    async start() {}
    async ready() { return {}; }
    async sendTurn() { writes += 1; return { ok: true, turnId: 'turn', finalText: 'x' }; }
    async interrupt() { return null; }
    async rotate() { return {}; }
    async stop() {}
    snapshot() { return {}; }
  }
  const runtime = createProviderRuntimeController({
    persistentEnabled: true,
    requireFn(id) {
      return {
        './provider-session-supervisor': { ProviderSessionSupervisor: FakeSupervisor },
        './provider-event-router': { createProviderEventRouter: () => ({ route() {} }) },
        './claude-agent-session': { createClaudeAgentSession: () => ({}) },
        './proc-utils': { terminateTree: async () => ({ ok: true }) },
      }[id];
    },
  });
  await runtime.start({ configGeneration: 1, securityGeneration: 1, conversationId: 'conversation-a' });

  await assert.rejects(runtime.sendTurn({
    request: {
      clientSubmitId: '11111111-1111-4111-8111-111111111111',
      conversationId: 'conversation-b', origin: 'shell', userText: 'x',
    },
    expectedRendererId: 1,
    rendererSubmittedAt: 1,
  }), (error) => error.code === 'PROVIDER_CONVERSATION_MISMATCH');
  assert.equal(writes, 0);
});

test('stop closes lifecycle immediately and permanently rejects in-flight and later start or rotate', async () => {
  let releaseStart;
  const startGate = new Promise((resolve) => { releaseStart = resolve; });
  let stopCalls = 0;
  class FakeSupervisor {
    async start() { await startGate; }
    async ready() { return {}; }
    async rotate() { return {}; }
    async stop() { stopCalls += 1; }
    snapshot() { return {}; }
  }
  const runtime = createProviderRuntimeController({
    persistentEnabled: true,
    requireFn(id) {
      return {
        './provider-session-supervisor': { ProviderSessionSupervisor: FakeSupervisor },
        './provider-event-router': { createProviderEventRouter: () => ({ route() {} }) },
        './claude-agent-session': { createClaudeAgentSession: () => ({}) },
        './proc-utils': { terminateTree: async () => ({ ok: true }) },
      }[id];
    },
  });
  const starting = runtime.start({ configGeneration: 1, securityGeneration: 1, conversationId: 'conversation-a' });
  await new Promise((resolve) => setImmediate(resolve));
  const stopping = runtime.stop('app_shutdown');
  releaseStart();

  await assert.rejects(starting, (error) => error.code === 'PROVIDER_RUNTIME_STOPPED');
  await stopping;
  await assert.rejects(
    runtime.start({ configGeneration: 2, securityGeneration: 1, conversationId: 'conversation-b' }),
    (error) => error.code === 'PROVIDER_RUNTIME_STOPPED',
  );
  await assert.rejects(
    runtime.rotate({ configGeneration: 3, securityGeneration: 1, conversationId: 'conversation-c' }, 'late'),
    (error) => error.code === 'PROVIDER_RUNTIME_STOPPED',
  );
  assert.equal(runtime.unblockTurns(), false);
  assert.equal(runtime.snapshot().admissionBlocked, true);
  assert.ok(stopCalls >= 1);
});

test('main account, cold-mutation, shutdown, and history commit boundaries are fail closed', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  assert.equal(source.includes("activeAccount || { accountId: 'claude:default'"), false);
  assert.match(source, /code: 'NO_ACTIVE_PROVIDER_ACCOUNT'/);
  assert.match(source, /coldRuntime: \{ interruptAndTerminate: terminateColdLegacyRuntime \}/);
  assert.match(source, /async function terminateColdLegacyRuntime[\s\S]*?if \(completion\) await completion;/);
  assert.match(source, /prepare: \(\) => \{[\s\S]*?isQuitting = true;[\s\S]*?blockNewTurns\('app_shutdown'\)/);
  assert.match(source, /async function runLiveQuery[\s\S]*?if \(isQuitting\)[\s\S]*?APP_SHUTTING_DOWN/);
  assert.match(source, /commitSuccess: \(result\) => historySink\.saveChatMessageAwaited/);
  const persistentBranch = source.slice(
    source.indexOf('if (persistentChatEnabled) {', source.indexOf('async function runLiveQuery')),
    source.indexOf('const legacyQueryOperation = runClaudeQuery'),
  );
  assert.equal(persistentBranch.includes("role: 'assistant'"), false);
});

test('main MCP list is read-only and conversation rotation uses the shared provider tail', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const listStart = source.indexOf('async function handleMcpList()');
  const listEnd = source.indexOf('function handleMcpStageSnippet', listStart);
  const listHandler = source.slice(listStart, listEnd);
  assert.doesNotMatch(listHandler, /migratePlaintextEnv/);
  assert.match(listHandler, /return mcpCli\.list\(\)/);

  const conversationStart = source.indexOf("ipcMain.handle('athena:conversations-new'");
  const conversationEnd = source.indexOf("ipcMain.handle('athena:account-list'", conversationStart);
  const handler = source.slice(conversationStart, conversationEnd);
  assert.match(handler, /providerConversationRotationQueue\.begin\(\{ projectId, verifierCorrelationId \}\)/);

  const queueStart = source.indexOf('const providerConversationRotationQueue');
  const queueEnd = source.indexOf('const stockEntityIndex', queueStart);
  const queue = source.slice(queueStart, queueEnd);
  const blockAt = queue.indexOf("blockNewTurns('conversation_rotation')");
  const identityAt = queue.indexOf('historyActiveConversationId = conversationId');
  const beginAt = queue.indexOf('conversations.begin({ id, projectId })');
  const rotateAt = queue.indexOf('rotatePersistentProviderInner(reason');
  assert.ok(blockAt >= 0 && blockAt < identityAt && identityAt < beginAt && beginAt < rotateAt);
  assert.match(queue, /enqueue: enqueueProviderRotation/);

  assert.match(source, /let providerRotationTail = Promise\.resolve\(\)/);
  assert.match(source, /async function rotatePersistentProviderInner[\s\S]*?await awaitProviderLifecycle\(cliAccounts\.getActiveAccount\(\)\)/);
  assert.match(source, /function enqueueProviderRotation[\s\S]*?providerRotationTail\.then/);
  assert.match(source, /function awaitProviderLifecycle[\s\S]*?assertProviderLifecycleOpen\(\)/);
  assert.match(source, /function ensureProviderRuntimeController\(\) \{\s*assertProviderLifecycleOpen\(\)/);
});

test('main never reuses a stopped terminal controller and disabled MCP publication needs no controller', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const ensureStart = source.indexOf('function ensureProviderRuntimeController()');
  const ensureEnd = source.indexOf('async function runMcpMutation', ensureStart);
  const boundary = source.slice(ensureStart, ensureEnd);

  assert.match(boundary, /providerControllerLifecycle\.stopAndDiscard\('mcp_security_mutation', fencedRuntime\)/);
  assert.match(boundary, /async startGeneration[\s\S]*?const runtime = ensureProviderRuntimeController\(\)/);
  assert.match(boundary, /async publishGeneration\(\{ started \}\) \{ providerRuntimeReady = !started\.disabled; \}/);
  assert.match(boundary, /async unblockTurns\(\) \{ providerRuntimeController\?\.unblockTurns\(\); \}/);

  const rotateStart = source.indexOf('async function rotatePersistentProviderInner');
  const rotateEnd = source.indexOf('function rotatePersistentProvider(', rotateStart);
  const rotation = source.slice(rotateStart, rotateEnd);
  assert.ok((rotation.match(/providerControllerLifecycle\.stopAndDiscard/g) || []).length >= 4);
});
