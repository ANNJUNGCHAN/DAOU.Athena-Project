'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  ClaudeAgentSession,
  ProviderProcessFenceError,
  canonicalMessageHash,
  collectExactMcpTools,
  userFacingProviderError,
} = require('./claude-agent-session');
const { validateEventPayload } = require('./provider-session-contract');

test('userFacingProviderError maps weekly-limit English to Korean', () => {
  assert.equal(
    userFacingProviderError("You've hit your weekly limit · resets Sep 8, 4am (Asia/Seoul)"),
    '이번 주 모델 한도에 닿았습니다',
  );
  assert.equal(userFacingProviderError('rate_limit'), '모델 요청 한도에 닿았습니다');
  assert.equal(userFacingProviderError('Claude 응답의 durable checkpoint가 없습니다.'), 'Claude 응답의 durable checkpoint가 없습니다.');
});

test('turn failure and rate-limit warning pass through userFacingProviderError', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, 'claude-agent-session.js'), 'utf8');
  assert.match(source, /_finishFailure\(active, 'PROVIDER_PROTOCOL_ERROR', true, userFacingProviderError\(detail/);
  assert.match(source, /code: 'CLAUDE_RATE_LIMIT'[\s\S]*?safeMessage: userFacingProviderError\(/);
});

class AsyncChannel {
  constructor() {
    this.values = [];
    this.waiters = [];
    this.closed = false;
    this.error = null;
  }

  push(value) {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.values.push(value);
  }

  end() {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ value: undefined, done: true });
  }

  fail(error) {
    this.error = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  next() {
    if (this.values.length) return Promise.resolve({ value: this.values.shift(), done: false });
    if (this.error) return Promise.reject(this.error);
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  [Symbol.asyncIterator]() { return this; }
}

function assistant(uuid, sessionId, content, parentToolUseId = null) {
  return {
    type: 'assistant',
    uuid,
    session_id: sessionId,
    parent_tool_use_id: parentToolUseId,
    message: { role: 'assistant', content },
  };
}

function success(sessionId, result = 'done') {
  return {
    type: 'result', subtype: 'success', session_id: sessionId, result,
    is_error: false, usage: { input_tokens: 1, output_tokens: 2 }, modelUsage: {},
    total_cost_usd: 0, permission_denials: [],
  };
}

function failure(sessionId, message = 'failed') {
  return {
    type: 'result', subtype: 'error_during_execution', session_id: sessionId,
    is_error: true, errors: [message], usage: {}, modelUsage: {},
    total_cost_usd: 0, permission_denials: [],
  };
}

function createSdkHarness({ getSessionMessages, forkSession } = {}) {
  const starts = [];
  const warms = [];
  const sdk = {
    async startup(args) {
      const output = new AsyncChannel();
      const warm = {
        output,
        queryCalls: 0,
        input: null,
        closed: false,
        query(input) {
          this.queryCalls += 1;
          this.input = input[Symbol.asyncIterator]();
          const query = output;
          query.interruptCalls = 0;
          query.closeCalls = 0;
          query.interrupt = async () => { query.interruptCalls += 1; };
          query.close = () => { query.closeCalls += 1; output.end(); };
          warm.queryHandle = query;
          return query;
        },
        close() { this.closed = true; output.end(); },
      };
      starts.push(args);
      warms.push(warm);
      return warm;
    },
    getSessionMessages: getSessionMessages || (async () => []),
    forkSession: forkSession || (async () => ({ sessionId: 'fork-session' })),
  };
  return { sdk, starts, warms };
}

function desired(overrides = {}) {
  return {
    provider: 'claude', cwd: 'C:\\workspace', model: 'claude-sonnet', effort: 'high',
    systemPrompt: 'ATHENA RULES', configGeneration: 1, securityGeneration: 7,
    mcpSnapshot: { allowedTools: ['mcp__athena__athena_search'] },
    toolPolicy: {
      allowedTools: 'mcp__athena,Task,Read,Glob',
      disallowedTools: 'Bash,Write,Edit,NotebookEdit,Grep,WebFetch,WebSearch',
    },
    ...overrides,
  };
}

function generation() {
  let current = true;
  return {
    context: {
      runtimeGeneration: 3,
      securityGeneration: 7,
      processOwnerId: 'owner-3',
      initialProviderBinding: null,
      initialContinuationCheckpoint: null,
      spawnContext: {
        assertCurrent() { if (!current) throw new Error('stale generation'); },
        buildEnv() { return { ATHENA_TOKEN: 'secret' }; },
        registerChild() { return { terminate: async () => ({ ok: true, outcome: 'already-exited' }) }; },
      },
    },
    stale() { current = false; },
  };
}

function generationWithCursor(binding, checkpoint) {
  const value = generation();
  value.context.initialProviderBinding = binding;
  value.context.initialContinuationCheckpoint = checkpoint;
  return value;
}

function turn(id, signal = new AbortController().signal) {
  return {
    clientSubmitId: `submit-${id}`, conversationId: 'conversation-1', turnId: id,
    origin: 'shell', userText: `prompt-${id}`, signal,
  };
}

function eventCollector() {
  const events = [];
  return {
    events,
    context: {
      assertCurrent() {},
      emit(type, payload, providerTurnId = null) {
        validateEventPayload(type, payload, 'claude');
        events.push({ type, payload, providerTurnId });
      },
    },
  };
}

function fakeSpawnChild(pid = 9001) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => { child.killed = true; return true; };
  return child;
}

async function nextInput(warm) {
  for (let i = 0; i < 20 && !warm.input; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(warm.input, 'WarmQuery.query must be called');
  return (await warm.input.next()).value;
}

test('reuses one startup/WarmQuery.query/output pump across successful turns', async () => {
  const persisted = new Map();
  const harness = createSdkHarness({ getSessionMessages: async (id) => persisted.get(id) || [] });
  const session = new ClaudeAgentSession({ sdk: harness.sdk, pollIntervalMs: 1, persistenceTimeoutMs: 50 });
  await session.start(desired(), generation().context);

  const firstEvents = eventCollector();
  const firstPromise = session.sendTurn(turn('turn-1'), firstEvents.context);
  const firstInput = await nextInput(harness.warms[0]);
  assert.equal(firstInput.message.content, 'prompt-turn-1');
  harness.warms[0].output.push({ type: 'system', subtype: 'init', session_id: 'session-1' });
  const firstAssistant = assistant('assistant-1', 'session-1', [{ type: 'text', text: 'one' }]);
  harness.warms[0].output.push(firstAssistant);
  persisted.set('session-1', [{ ...firstAssistant }]);
  harness.warms[0].output.push(success('session-1', 'one'));
  const first = await firstPromise;
  await session.commitTurn('turn-1');

  const secondEvents = eventCollector();
  const secondPromise = session.sendTurn(turn('turn-2'), secondEvents.context);
  await nextInput(harness.warms[0]);
  const secondAssistant = assistant('assistant-2', 'session-1', [{ type: 'text', text: 'two' }]);
  harness.warms[0].output.push(secondAssistant);
  persisted.set('session-1', [{ ...firstAssistant }, { ...secondAssistant }]);
  harness.warms[0].output.push(success('session-1', 'two'));
  const second = await secondPromise;
  await session.commitTurn('turn-2');

  assert.equal(harness.starts.length, 1);
  assert.equal(harness.warms[0].queryCalls, 1);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.continuationCheckpoint.assistantMessageId, 'assistant-1');
  assert.equal(second.continuationCheckpoint.assistantMessageId, 'assistant-2');
  assert.deepEqual(firstEvents.events.filter((event) => event.type === 'turn_completed').length, 1);
  assert.deepEqual(secondEvents.events.filter((event) => event.type === 'turn_completed').length, 1);
  await session.stop('test');
});

test('rotation start resumes exclusively from the supervisor committed generation-context checkpoint', async () => {
  const committedMessage = { role: 'assistant', content: [{ type: 'text', text: 'committed' }] };
  const checkpoint = {
    provider: 'claude',
    sessionId: 'session-committed',
    assistantMessageId: 'assistant-committed',
    assistantMessageHash: canonicalMessageHash(committedMessage),
  };
  const harness = createSdkHarness();
  const session = new ClaudeAgentSession({ sdk: harness.sdk });
  await session.start(desired({
    providerBinding: { provider: 'claude', sessionId: 'desired-must-not-win' },
    continuationCheckpoint: { ...checkpoint, sessionId: 'desired-must-not-win' },
  }), generationWithCursor(
    { provider: 'claude', sessionId: 'session-committed' },
    checkpoint,
  ).context);

  assert.equal(harness.starts[0].options.resume, 'session-committed');
  assert.deepEqual(session.snapshot().providerBinding, { provider: 'claude', sessionId: 'session-committed' });
  assert.deepEqual(session.snapshot().continuationCheckpoint, checkpoint);
  await session.stop('test');
});

test('new-conversation generation context with both cursor fields null never resumes desired-state cursor fields', async () => {
  const fakeHash = 'a'.repeat(64);
  const harness = createSdkHarness();
  const session = new ClaudeAgentSession({ sdk: harness.sdk });
  await session.start(desired({
    providerBinding: { provider: 'claude', sessionId: 'untrusted-desired-session' },
    continuationCheckpoint: {
      provider: 'claude', sessionId: 'untrusted-desired-session',
      assistantMessageId: 'untrusted-assistant', assistantMessageHash: fakeHash,
    },
  }), generation().context);

  assert.equal(harness.starts[0].options.resume, undefined);
  assert.equal(session.snapshot().providerBinding, null);
  assert.equal(session.snapshot().continuationCheckpoint, null);
  await session.stop('test');
});

test('generation-context cursor validation rejects wrong providers, malformed hashes and inconsistent sessions before startup', async () => {
  const validCheckpoint = {
    provider: 'claude', sessionId: 'session-a', assistantMessageId: 'assistant-a', assistantMessageHash: 'b'.repeat(64),
  };
  const cases = [
    generationWithCursor({ provider: 'codex', threadId: 'thread-a' }, null).context,
    generationWithCursor({ provider: 'claude', sessionId: 'session-a' }, { ...validCheckpoint, provider: 'codex' }).context,
    generationWithCursor({ provider: 'claude', sessionId: 'session-a' }, { ...validCheckpoint, assistantMessageHash: 'not-sha256' }).context,
    generationWithCursor({ provider: 'claude', sessionId: 'session-a' }, { ...validCheckpoint, sessionId: 'session-b' }).context,
    generationWithCursor(null, validCheckpoint).context,
  ];
  for (const context of cases) {
    const harness = createSdkHarness();
    const session = new ClaudeAgentSession({ sdk: harness.sdk });
    await assert.rejects(session.start(desired(), context), /initial|Claude|checkpoint|session/i);
    assert.equal(harness.starts.length, 0);
  }
});

test('generation context must explicitly provide both initial cursor fields', async () => {
  const value = generation();
  delete value.context.initialProviderBinding;
  delete value.context.initialContinuationCheckpoint;
  const harness = createSdkHarness();
  const session = new ClaudeAgentSession({ sdk: harness.sdk });
  await assert.rejects(session.start(desired(), value.context), /initial cursor fields/i);
  assert.equal(harness.starts.length, 0);
});

test('keeps success provisional until the matching persisted assistant UUID appears', async () => {
  let reads = 0;
  const persistedAssistant = assistant('assistant-delayed', 'session-delayed', [{ type: 'text', text: 'saved' }]);
  const harness = createSdkHarness({
    getSessionMessages: async () => (++reads < 3 ? [] : [{ ...persistedAssistant }]),
  });
  const session = new ClaudeAgentSession({ sdk: harness.sdk, pollIntervalMs: 1, persistenceTimeoutMs: 100 });
  await session.start(desired(), generation().context);
  const collected = eventCollector();
  const pending = session.sendTurn(turn('delayed'), collected.context);
  await nextInput(harness.warms[0]);
  harness.warms[0].output.push(persistedAssistant);
  harness.warms[0].output.push(success('session-delayed', 'saved'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(collected.events.some((event) => event.type === 'turn_completed'), false);
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(reads, 3);
  await session.stop('test');
});

test('keeps a successful cursor provisional until supervisor commit and rolls back hidden transcript on rejection', async () => {
  const original = assistant('assistant-provisional', 'session-provisional', [{ type: 'text', text: 'not committed' }]);
  const harness = createSdkHarness({ getSessionMessages: async () => [original] });
  const session = new ClaudeAgentSession({ sdk: harness.sdk, pollIntervalMs: 1, persistenceTimeoutMs: 30 });
  await session.start(desired(), generation().context);
  const pending = session.sendTurn(turn('provisional'), eventCollector().context);
  await nextInput(harness.warms[0]);
  harness.warms[0].output.push(original);
  harness.warms[0].output.push(success('session-provisional', 'not committed'));
  const result = await pending;

  assert.equal(result.ok, true);
  assert.equal(session.snapshot().providerBinding, null);
  assert.equal(session.snapshot().continuationCheckpoint, null);
  await session.rollbackTurn('provisional');
  assert.equal(harness.starts.length, 2, 'rollback starts a clean session when no committed cursor exists');
  assert.equal(harness.starts[1].options.resume, undefined);
  assert.equal(session.snapshot().providerBinding, null);
  assert.equal(session.snapshot().continuationCheckpoint, null);
  await session.stop('test');
});

test('matching supervisor acknowledgement atomically promotes the provisional Claude cursor', async () => {
  const original = assistant('assistant-ack', 'session-ack', [{ type: 'text', text: 'committed' }]);
  const harness = createSdkHarness({ getSessionMessages: async () => [original] });
  const session = new ClaudeAgentSession({ sdk: harness.sdk, pollIntervalMs: 1, persistenceTimeoutMs: 30 });
  await session.start(desired(), generation().context);
  const pending = session.sendTurn(turn('ack'), eventCollector().context);
  await nextInput(harness.warms[0]);
  harness.warms[0].output.push(original);
  harness.warms[0].output.push(success('session-ack', 'committed'));
  await pending;
  await session.commitTurn('ack');
  assert.deepEqual(session.snapshot().providerBinding, { provider: 'claude', sessionId: 'session-ack' });
  assert.equal(session.snapshot().continuationCheckpoint.assistantMessageId, 'assistant-ack');
  await session.stop('test');
});

test('commit compensator restores the previous durable checkpoint after later history failure', async () => {
  const previous = assistant('assistant-previous', 'session-previous', [{ type: 'text', text: 'previous' }]);
  const remapped = assistant('assistant-remapped', 'session-recovered', previous.message.content);
  const committed = assistant('assistant-committed', 'session-previous', [{ type: 'text', text: 'hidden' }]);
  const forkCalls = [];
  const harness = createSdkHarness({
    getSessionMessages: async (sessionId) => {
      if (sessionId === 'session-recovered') return [remapped];
      return [previous, committed];
    },
    forkSession: async (sessionId, options) => {
      forkCalls.push({ sessionId, options });
      return { sessionId: 'session-recovered' };
    },
  });
  const previousCheckpoint = {
    provider: 'claude',
    sessionId: 'session-previous',
    assistantMessageId: 'assistant-previous',
    assistantMessageHash: canonicalMessageHash(previous.message),
  };
  const child = fakeSpawnChild(9301);
  let terminationCalls = 0;
  const gen = generationWithCursor({ provider: 'claude', sessionId: 'session-previous' }, previousCheckpoint);
  gen.context.spawnContext.registerChild = () => ({
    async terminate() {
      terminationCalls += 1;
      return { ok: true, outcome: 'forced' };
    },
  });
  const session = new ClaudeAgentSession({
    sdk: harness.sdk,
    pollIntervalMs: 1,
    persistenceTimeoutMs: 30,
    readCreationTime: () => 'creation-9301',
    spawn: () => child,
  });
  await session.start(desired(), gen.context);
  harness.starts[0].options.spawnClaudeCodeProcess({
    command: 'claude.exe', args: [], cwd: 'C:\\workspace', env: {}, signal: new AbortController().signal,
  });

  const pending = session.sendTurn(turn('committed'), eventCollector().context);
  await nextInput(harness.warms[0]);
  harness.warms[0].output.push(committed);
  harness.warms[0].output.push(success('session-previous', 'hidden'));
  assert.equal((await pending).ok, true);

  const compensation = await session.commitTurn('committed');
  assert.equal(typeof compensation.rollback, 'function');
  assert.equal(session.snapshot().continuationCheckpoint.assistantMessageId, 'assistant-committed');

  await compensation.rollback();
  assert.deepEqual(forkCalls, [{
    sessionId: 'session-previous',
    options: { dir: 'C:\\workspace', upToMessageId: 'assistant-previous' },
  }]);
  assert.equal(harness.starts.length, 2);
  assert.equal(harness.starts[1].options.resume, 'session-recovered');
  assert.equal(terminationCalls, 1, 'compensation uses the generation-owned child termination path');
  assert.deepEqual(session.snapshot().providerBinding, { provider: 'claude', sessionId: 'session-recovered' });
  assert.deepEqual(session.snapshot().continuationCheckpoint, {
    ...previousCheckpoint,
    sessionId: 'session-recovered',
    assistantMessageId: 'assistant-remapped',
  });
  await compensation.rollback();
  assert.equal(forkCalls.length, 1, 'the compensator runs at most once');
  assert.equal(harness.starts.length, 2);

  const after = session.sendTurn(turn('after-compensation'), eventCollector().context);
  const afterInput = await nextInput(harness.warms[1]);
  assert.equal(afterInput.message.content, 'prompt-after-compensation');
  await session.stop('test');
  assert.equal((await after).ok, false);
});

test('an older commit compensator cannot roll back a newer acknowledged Claude cursor', async () => {
  const firstAssistant = assistant('assistant-first', 'session-shared', [{ type: 'text', text: 'first' }]);
  const secondAssistant = assistant('assistant-second', 'session-shared', [{ type: 'text', text: 'second' }]);
  const persisted = [];
  const forkCalls = [];
  const harness = createSdkHarness({
    getSessionMessages: async () => persisted,
    forkSession: async (sessionId, options) => {
      forkCalls.push({ sessionId, options });
      return { sessionId: 'must-not-fork' };
    },
  });
  const session = new ClaudeAgentSession({ sdk: harness.sdk, pollIntervalMs: 1, persistenceTimeoutMs: 30 });
  await session.start(desired(), generation().context);

  let pending = session.sendTurn(turn('first'), eventCollector().context);
  await nextInput(harness.warms[0]);
  persisted.push(firstAssistant);
  harness.warms[0].output.push(firstAssistant);
  harness.warms[0].output.push(success('session-shared', 'first'));
  assert.equal((await pending).ok, true);
  const firstCompensation = await session.commitTurn('first');

  pending = session.sendTurn(turn('second'), eventCollector().context);
  await nextInput(harness.warms[0]);
  persisted.push(secondAssistant);
  harness.warms[0].output.push(secondAssistant);
  harness.warms[0].output.push(success('session-shared', 'second'));
  assert.equal((await pending).ok, true);
  await session.commitTurn('second');

  await firstCompensation.rollback();
  await firstCompensation.rollback();
  assert.deepEqual(forkCalls, []);
  assert.equal(harness.starts.length, 1);
  assert.deepEqual(session.snapshot().providerBinding, { provider: 'claude', sessionId: 'session-shared' });
  assert.equal(session.snapshot().continuationCheckpoint.assistantMessageId, 'assistant-second');
  await session.stop('test');
});

test('fails closed when the persisted checkpoint never appears', async () => {
  const harness = createSdkHarness();
  const session = new ClaudeAgentSession({ sdk: harness.sdk, pollIntervalMs: 1, persistenceTimeoutMs: 5 });
  await session.start(desired(), generation().context);
  const collected = eventCollector();
  const pending = session.sendTurn(turn('missing'), collected.context);
  await nextInput(harness.warms[0]);
  harness.warms[0].output.push(assistant('missing-assistant', 'missing-session', [{ type: 'text', text: 'not durable' }]));
  harness.warms[0].output.push(success('missing-session', 'not durable'));
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PROVIDER_CHECKPOINT_UNAVAILABLE');
  assert.equal(collected.events.filter((event) => event.type === 'turn_completed').length, 0);
  assert.equal(collected.events.filter((event) => event.type === 'turn_failed').length, 1);
  await session.stop('test');
});

test('forks the last durable assistant boundary before accepting another turn after failure', async () => {
  const original = assistant('assistant-ok', 'session-original', [{ type: 'text', text: 'ok' }]);
  const remapped = assistant('assistant-remapped', 'session-fork', original.message.content);
  const forkCalls = [];
  const harness = createSdkHarness({
    getSessionMessages: async (id) => id === 'session-fork' ? [remapped] : [original],
    forkSession: async (id, options) => { forkCalls.push({ id, options }); return { sessionId: 'session-fork' }; },
  });
  const session = new ClaudeAgentSession({ sdk: harness.sdk, pollIntervalMs: 1, persistenceTimeoutMs: 30 });
  await session.start(desired(), generation().context);

  let collected = eventCollector();
  let pending = session.sendTurn(turn('ok'), collected.context);
  await nextInput(harness.warms[0]);
  harness.warms[0].output.push(original);
  harness.warms[0].output.push(success('session-original', 'ok'));
  const ok = await pending;
  assert.equal(ok.ok, true);
  await session.commitTurn('ok');

  collected = eventCollector();
  pending = session.sendTurn(turn('bad'), collected.context);
  await nextInput(harness.warms[0]);
  harness.warms[0].output.push(failure('session-original', 'sentinel-failed-turn'));
  const failed = await pending;
  assert.equal(failed.ok, false);
  assert.deepEqual(forkCalls, [{ id: 'session-original', options: { dir: 'C:\\workspace', upToMessageId: 'assistant-ok' } }]);
  assert.equal(harness.starts.length, 2);
  assert.equal(harness.starts[1].options.resume, 'session-fork');
  assert.equal(session.snapshot().continuationCheckpoint.assistantMessageId, 'assistant-remapped');

  collected = eventCollector();
  pending = session.sendTurn(turn('after'), collected.context);
  const afterInput = await nextInput(harness.warms[1]);
  assert.equal(afterInput.message.content, 'prompt-after');
  assert.doesNotMatch(JSON.stringify(afterInput), /sentinel-failed-turn/);
  await session.stop('test');
  const after = await pending;
  assert.equal(after.ok, false);
});

test('fork failure emits one PROVIDER_CONTEXT_LOST terminal instead of publishing the earlier provider error', async () => {
  const root = assistant('assistant-safe', 'session-safe', [{ type: 'text', text: 'safe' }]);
  const harness = createSdkHarness({
    getSessionMessages: async () => [root],
    forkSession: async () => { throw new Error('fork unavailable'); },
  });
  const session = new ClaudeAgentSession({ sdk: harness.sdk, pollIntervalMs: 1, persistenceTimeoutMs: 30 });
  await session.start(desired(), generation().context);

  let collected = eventCollector();
  let pending = session.sendTurn(turn('safe'), collected.context);
  await nextInput(harness.warms[0]);
  harness.warms[0].output.push(root);
  harness.warms[0].output.push(success('session-safe', 'safe'));
  assert.equal((await pending).ok, true);
  await session.commitTurn('safe');

  collected = eventCollector();
  pending = session.sendTurn(turn('fork-fails'), collected.context);
  await nextInput(harness.warms[0]);
  harness.warms[0].output.push(failure('session-safe', 'provider failed'));
  const result = await pending;
  assert.equal(result.code, 'PROVIDER_CONTEXT_LOST');
  assert.deepEqual(
    collected.events.filter((event) => event.type === 'turn_failed').map((event) => event.payload.code),
    ['PROVIDER_CONTEXT_LOST'],
  );
  await session.stop('test');
});

test('uses exact SDK options and a generation-scoped PreToolUse fail-closed fence', async () => {
  const gen = generation();
  let interactiveCalls = 0;
  const harness = createSdkHarness();
  const session = new ClaudeAgentSession({
    sdk: harness.sdk,
    interactiveCanUseTool: async () => { interactiveCalls += 1; return { behavior: 'deny', message: 'operator denied' }; },
  });
  await session.start(desired(), gen.context);
  const options = harness.starts[0].options;
  assert.equal(options.effort, 'high');
  assert.deepEqual(options.settingSources, []);
  assert.equal(options.strictMcpConfig, true);
  assert.deepEqual(options.allowedTools, ['mcp__athena', 'Task', 'Read', 'Glob']);
  assert.deepEqual(options.disallowedTools, ['Bash', 'Write', 'Edit', 'NotebookEdit', 'Grep', 'WebFetch', 'WebSearch']);
  assert.deepEqual(options.tools, ['Task', 'Agent', 'Read', 'Glob']);
  assert.equal(options.permissionMode, 'default');
  assert.equal(options.systemPrompt.preset, 'claude_code');

  const hook = options.hooks.PreToolUse[0].hooks[0];
  let decision = await hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {}, tool_use_id: 't1' });
  assert.equal(decision.hookSpecificOutput.permissionDecision, 'allow');
  decision = await hook({ hook_event_name: 'PreToolUse', tool_name: 'mcp__athena__athena_search', tool_input: {}, tool_use_id: 't2' });
  assert.equal(decision.hookSpecificOutput.permissionDecision, 'allow');
  decision = await hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: {}, tool_use_id: 't-agent' });
  assert.equal(decision.hookSpecificOutput.permissionDecision, 'allow');
  decision = await hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, tool_use_id: 't3' });
  assert.equal(decision.hookSpecificOutput.permissionDecision, 'deny');
  let permission = await options.canUseTool('Read', {}, { signal: new AbortController().signal });
  assert.equal(permission.behavior, 'deny');
  assert.equal(interactiveCalls, 1);
  gen.stale();
  decision = await hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {}, tool_use_id: 't4' });
  assert.equal(decision.hookSpecificOutput.permissionDecision, 'deny');
  permission = await options.canUseTool('Read', {}, { signal: new AbortController().signal });
  assert.equal(permission.behavior, 'deny');
  assert.equal(interactiveCalls, 1);
  await session.stop('test');
});

test('interrupt waits for the SDK interrupt request and emits one interrupted terminal on result', async () => {
  const harness = createSdkHarness();
  const session = new ClaudeAgentSession({ sdk: harness.sdk, pollIntervalMs: 1, persistenceTimeoutMs: 20 });
  await session.start(desired(), generation().context);
  const collected = eventCollector();
  const pending = session.sendTurn(turn('interrupt'), collected.context);
  await nextInput(harness.warms[0]);
  await session.interrupt('interrupt', 'replacement');
  assert.equal(harness.warms[0].queryHandle.interruptCalls, 1);
  harness.warms[0].output.push(success('session-interrupt', 'partial'));
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.interrupted, true);
  assert.equal(collected.events.filter((event) => event.type === 'turn_interrupted').length, 1);
  assert.equal(collected.events.filter((event) => event.type === 'turn_completed').length, 0);
  await session.stop('test');
});

test('a pre-aborted turn is terminal without writing its prompt to the persistent input queue', async () => {
  const harness = createSdkHarness();
  const session = new ClaudeAgentSession({ sdk: harness.sdk });
  await session.start(desired(), generation().context);
  const controller = new AbortController();
  controller.abort();
  const collected = eventCollector();
  const result = await session.sendTurn(turn('already-aborted', controller.signal), collected.context);
  assert.equal(result.interrupted, true);
  assert.deepEqual(await harness.warms[0].input.next(), { value: undefined, done: true });
  assert.equal(collected.events.filter((event) => event.type === 'turn_interrupted').length, 1);
  await session.stop('test');
});

test('structured frame cap terminates the turn without emitting late deltas', async () => {
  const harness = createSdkHarness();
  const session = new ClaudeAgentSession({ sdk: harness.sdk, maxFrameBytes: 160, maxTurnBytes: 500, maxGenerationBytes: 1000 });
  await session.start(desired(), generation().context);
  const collected = eventCollector();
  const pending = session.sendTurn(turn('cap'), collected.context);
  await nextInput(harness.warms[0]);
  harness.warms[0].output.push({ type: 'stream_event', session_id: 'cap-session', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x'.repeat(500) } } });
  harness.warms[0].output.push({ type: 'stream_event', session_id: 'cap-session', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'late' } } });
  const result = await pending;
  assert.equal(result.code, 'PROVIDER_OUTPUT_LIMIT');
  assert.equal(collected.events.some((event) => event.type === 'text_delta'), false);
  assert.equal(collected.events.filter((event) => event.type === 'turn_failed').length, 1);
  await session.stop('test');
});

test('turn and generation structured-byte limits are enforced independently', async () => {
  {
    const harness = createSdkHarness();
    const session = new ClaudeAgentSession({ sdk: harness.sdk, maxFrameBytes: 10_000, maxTurnBytes: 250, maxGenerationBytes: 10_000 });
    await session.start(desired(), generation().context);
    const collected = eventCollector();
    const pending = session.sendTurn(turn('turn-limit'), collected.context);
    await nextInput(harness.warms[0]);
    const frame = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x'.repeat(40) } } };
    harness.warms[0].output.push(frame);
    harness.warms[0].output.push(frame);
    assert.equal((await pending).code, 'PROVIDER_OUTPUT_LIMIT');
    await session.stop('test');
  }

  {
    const firstAssistant = assistant('generation-one', 'generation-session', [{ type: 'text', text: 'first' }]);
    const firstResult = success('generation-session', 'first');
    const nextFrame = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'next' } } };
    const generationLimit = Buffer.byteLength(JSON.stringify(firstAssistant))
      + Buffer.byteLength(JSON.stringify(firstResult))
      + Buffer.byteLength(JSON.stringify(nextFrame)) - 1;
    const harness = createSdkHarness({ getSessionMessages: async () => [firstAssistant] });
    const session = new ClaudeAgentSession({
      sdk: harness.sdk, pollIntervalMs: 1, persistenceTimeoutMs: 30,
      maxFrameBytes: 10_000, maxTurnBytes: 10_000, maxGenerationBytes: generationLimit,
    });
    await session.start(desired(), generation().context);
    let collected = eventCollector();
    let pending = session.sendTurn(turn('generation-one'), collected.context);
    await nextInput(harness.warms[0]);
    harness.warms[0].output.push(firstAssistant);
    harness.warms[0].output.push(firstResult);
    assert.equal((await pending).ok, true);
    await session.commitTurn('generation-one');

    collected = eventCollector();
    pending = session.sendTurn(turn('generation-two'), collected.context);
    await nextInput(harness.warms[0]);
    harness.warms[0].output.push(nextFrame);
    assert.equal((await pending).code, 'PROVIDER_OUTPUT_LIMIT');
    await session.stop('test');
  }
});

test('raw stdout byte limit is independent from structured frame limits', async () => {
  const child = fakeSpawnChild();
  const harness = createSdkHarness();
  const session = new ClaudeAgentSession({
    sdk: harness.sdk,
    maxFrameBytes: 10_000, maxTurnBytes: 10_000, maxGenerationBytes: 10_000, maxRawOutputBytes: 5,
    readCreationTime: () => 'creation-9001',
    spawn: () => child,
  });
  const gen = generation();
  gen.context.spawnContext.registerChild = () => ({ terminate: async () => ({ ok: true, outcome: 'forced' }) });
  await session.start(desired(), gen.context);
  harness.starts[0].options.spawnClaudeCodeProcess({
    command: 'claude.exe', args: [], cwd: 'C:\\workspace', env: {}, signal: new AbortController().signal,
  });
  const collected = eventCollector();
  const pending = session.sendTurn(turn('raw-limit'), collected.context);
  await nextInput(harness.warms[0]);
  child.stdout.write('123456');
  const result = await pending;
  assert.equal(result.code, 'PROVIDER_OUTPUT_LIMIT');
  assert.equal(child.killed, false);
  assert.equal(session.snapshot().diagnostics.rawOutputBytes, 6);
  await session.stop('test');
});

test('active output iterator crash yields one typed terminal and restarts from the safe boundary', async () => {
  const harness = createSdkHarness();
  const session = new ClaudeAgentSession({ sdk: harness.sdk });
  await session.start(desired(), generation().context);
  const collected = eventCollector();
  const pending = session.sendTurn(turn('active-crash'), collected.context);
  await nextInput(harness.warms[0]);
  harness.warms[0].output.fail(new Error('active iterator crashed'));
  const result = await pending;
  assert.equal(result.code, 'PROVIDER_PROCESS_EXITED');
  assert.equal(result.retryable, true);
  assert.equal(harness.starts.length, 2);
  assert.deepEqual(
    collected.events.filter((event) => event.type.startsWith('turn_') && event.type !== 'turn_started').map((event) => event.type),
    ['turn_failed'],
  );
  await session.stop('test');
});

test('result followed by iterator throw cannot create a second terminal', async () => {
  const root = assistant('assistant-final', 'session-final', [{ type: 'text', text: 'final' }]);
  const harness = createSdkHarness({ getSessionMessages: async () => [root] });
  const session = new ClaudeAgentSession({ sdk: harness.sdk, pollIntervalMs: 1, persistenceTimeoutMs: 30 });
  await session.start(desired(), generation().context);
  const collected = eventCollector();
  const pending = session.sendTurn(turn('throw'), collected.context);
  await nextInput(harness.warms[0]);
  harness.warms[0].output.push(root);
  harness.warms[0].output.push(success('session-final', 'final'));
  const result = await pending;
  harness.warms[0].output.fail(new Error('late iterator throw'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.ok, true);
  assert.equal(collected.events.filter((event) => event.type.startsWith('turn_') && event.type !== 'turn_started').length, 1);
  assert.equal(session.snapshot().diagnostics.latePumpErrors, 1);
  await session.stop('test');
});

test('normalizes partial text, thinking, tool start/progress/completion and Canvas result events', async () => {
  const root = assistant('assistant-tools', 'session-tools', [{
    type: 'tool_use', id: 'tool-1', name: 'mcp__athena__athena__render_canvas', input: { plan_token: 'token' },
  }]);
  const harness = createSdkHarness({ getSessionMessages: async () => [root] });
  const session = new ClaudeAgentSession({ sdk: harness.sdk, pollIntervalMs: 1, persistenceTimeoutMs: 30 });
  await session.start(desired(), generation().context);
  const collected = eventCollector();
  const pending = session.sendTurn(turn('events'), collected.context);
  await nextInput(harness.warms[0]);
  harness.warms[0].output.push({ type: 'stream_event', session_id: 'session-tools', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } } });
  harness.warms[0].output.push({ type: 'stream_event', session_id: 'session-tools', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'reason' } } });
  harness.warms[0].output.push(root);
  harness.warms[0].output.push({ type: 'tool_progress', session_id: 'session-tools', tool_use_id: 'tool-1', elapsed_time_seconds: 1.5 });
  harness.warms[0].output.push({
    type: 'system', subtype: 'task_progress', session_id: 'session-tools', task_id: 'task-1', tool_use_id: 'agent-tool',
    description: 'Checking data', subagent_type: 'analyst', last_tool_name: 'Read',
    usage: { total_tokens: 10, tool_uses: 1, duration_ms: 250 },
  });
  harness.warms[0].output.push({
    type: 'user', session_id: 'session-tools', parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: JSON.stringify({ canvas_type: 'facts', status: 'ok' }) }] },
  });
  harness.warms[0].output.push(success('session-tools', 'done'));
  const result = await pending;
  assert.equal(result.ok, true);
  assert.deepEqual(
    collected.events.map((event) => event.type),
    ['turn_started', 'text_delta', 'thinking_delta', 'tool_started', 'tool_progress', 'subagent_updated', 'tool_completed', 'canvas_result', 'usage_updated', 'turn_completed'],
  );
  assert.equal(collected.events.find((event) => event.type === 'tool_started').payload.canonicalToolName, 'athena__render_canvas');
  assert.equal(collected.events.find((event) => event.type === 'canvas_result').payload.envelope.canvas_type, 'facts');
  await session.stop('test');
});

test('generation-owned spawn asserts, builds fresh env, registers the child, and hides Windows shells', async () => {
  const calls = [];
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => { child.killed = true; return true; };
  const gen = generation();
  let assertions = 0;
  let registered = null;
  gen.context.spawnContext.assertCurrent = () => { assertions += 1; };
  gen.context.spawnContext.buildEnv = (provider) => { calls.push(['buildEnv', provider]); return { ATHENA_TOKEN: 'fresh', ENABLE_TOOL_SEARCH: '1' }; };
  gen.context.spawnContext.registerChild = (spawned, metadata) => { registered = { spawned, metadata }; return { terminate: async () => ({ ok: true, outcome: 'already-exited' }) }; };
  const harness = createSdkHarness();
  const session = new ClaudeAgentSession({
    sdk: harness.sdk,
    readCreationTime: () => 'creation-token-1234',
    spawn(command, args, options) { calls.push(['spawn', command, args, options]); return child; },
  });
  await session.start(desired(), gen.context);
  const spawned = harness.starts[0].options.spawnClaudeCodeProcess({
    command: 'claude.exe', args: ['--sdk'], cwd: 'C:\\workspace',
    env: { PATH: 'bin', ATHENA_TOKEN: 'stale' }, signal: new AbortController().signal,
  });
  const spawnOptions = calls.find((call) => call[0] === 'spawn')[3];
  assert.ok(assertions >= 4);
  assert.equal(spawnOptions.shell, false);
  assert.equal(spawnOptions.windowsHide, true);
  assert.equal(spawnOptions.env.ATHENA_TOKEN, 'fresh');
  assert.equal(spawnOptions.env.ENABLE_TOOL_SEARCH, '0');
  assert.equal(registered.spawned, child);
  assert.deepEqual(registered.metadata, {
    provider: 'claude', runtimeGeneration: 3, processOwnerId: 'owner-3',
    expectedCreationTime: 'creation-token-1234', readCreationTime: session._readCreationTime,
  });
  assert.equal(spawned.stdin, child.stdin);
  assert.notEqual(spawned.stdout, child.stdout);
  assert.equal(Object.hasOwn(session.snapshot(), 'generationContext'), false);
  assert.doesNotMatch(JSON.stringify(session.snapshot()), /fresh|secret/);
  await session.stop('test');
});

test('exact MCP collection reads only snapshot.allowedTools and rejects non-Athena or non-exact names', () => {
  assert.deepEqual(
    [...collectExactMcpTools({
      allowedTools: ['mcp__athena__athena_search', 'mcp__athena__upstream__tool_name'],
      registryServers: { poisoned: 'mcp__other__stolen' },
      nested: { allowedToolNames: ['mcp__athena__metadata_poison'] },
    })],
    ['mcp__athena__athena_search', 'mcp__athena__upstream__tool_name'],
  );
  assert.deepEqual([...collectExactMcpTools({ nested: 'mcp__athena__ignored' })], []);
  for (const invalid of ['mcp__other__tool', 'mcp__athena', 'mcp__athena__', ' mcp__athena__tool name ']) {
    assert.throws(() => collectExactMcpTools({ allowedTools: [invalid] }), /Invalid exact Athena MCP tool name/);
  }
});

test('stop checks every registered child result and surfaces one typed aggregate fence failure', async () => {
  const children = [fakeSpawnChild(9101), fakeSpawnChild(9102)];
  const terminations = [];
  const harness = createSdkHarness();
  const gen = generation();
  gen.context.spawnContext.registerChild = (child) => ({
    async terminate() {
      terminations.push(child.pid);
      return child.pid === 9101
        ? { ok: false, outcome: 'identity-mismatch' }
        : { ok: true, outcome: 'already-exited' };
    },
  });
  const session = new ClaudeAgentSession({
    sdk: harness.sdk,
    readCreationTime: (pid) => `creation-${pid}`,
    spawn: () => children.shift(),
  });
  await session.start(desired(), gen.context);
  const spawnProcess = harness.starts[0].options.spawnClaudeCodeProcess;
  for (let index = 0; index < 2; index += 1) {
    spawnProcess({ command: 'claude.exe', args: [], cwd: 'C:\\workspace', env: {}, signal: new AbortController().signal });
  }
  await assert.rejects(session.stop('test'), (error) => {
    assert.ok(error instanceof ProviderProcessFenceError);
    assert.equal(error.code, 'PROVIDER_PROCESS_FENCE_FAILED');
    assert.equal(error.results.length, 2);
    assert.equal(error.results[0].outcome, 'identity-mismatch');
    return true;
  });
  assert.deepEqual(terminations, [9101, 9102]);
});

test('stop retains failed process-fence registrations so a later stop can retry ownership', async () => {
  const child = fakeSpawnChild(9120);
  let attempts = 0;
  const harness = createSdkHarness();
  const gen = generation();
  gen.context.spawnContext.registerChild = () => ({
    async terminate() {
      attempts += 1;
      return attempts === 1
        ? { ok: false, outcome: 'identity-mismatch' }
        : { ok: true, outcome: 'already-exited' };
    },
  });
  const session = new ClaudeAgentSession({
    sdk: harness.sdk,
    readCreationTime: () => 'creation-9120',
    spawn: () => child,
  });
  await session.start(desired(), gen.context);
  harness.starts[0].options.spawnClaudeCodeProcess({
    command: 'claude.exe', args: [], cwd: 'C:\\workspace', env: {}, signal: new AbortController().signal,
  });
  await assert.rejects(session.stop('first'), ProviderProcessFenceError);
  await session.stop('retry');
  assert.equal(attempts, 2);
});

test('recovery preserves the typed process-fence failure instead of flattening it to context loss', async () => {
  const child = fakeSpawnChild(9150);
  const harness = createSdkHarness();
  const gen = generation();
  gen.context.spawnContext.registerChild = () => ({
    terminate: async () => ({ ok: false, outcome: 'timeout' }),
  });
  const session = new ClaudeAgentSession({
    sdk: harness.sdk,
    readCreationTime: () => 'creation-9150',
    spawn: () => child,
  });
  await session.start(desired(), gen.context);
  harness.starts[0].options.spawnClaudeCodeProcess({
    command: 'claude.exe', args: [], cwd: 'C:\\workspace', env: {}, signal: new AbortController().signal,
  });
  const collected = eventCollector();
  const pending = session.sendTurn(turn('fence-failure'), collected.context);
  await nextInput(harness.warms[0]);
  harness.warms[0].output.push(failure('session-fence', 'provider failed'));
  const result = await pending;
  assert.equal(result.code, 'PROVIDER_PROCESS_FENCE_FAILED');
  assert.equal(result.retryable, false);
  assert.deepEqual(
    collected.events.filter((event) => event.type === 'turn_failed').map((event) => event.payload.code),
    ['PROVIDER_PROCESS_FENCE_FAILED'],
  );
});

test('registerChild failure waits for tree-fence cleanup and cleanup failure overrides readiness with typed error', async () => {
  for (const cleanupResult of [
    { ok: true, outcome: 'forced' },
    { ok: false, outcome: 'timeout' },
  ]) {
    const child = fakeSpawnChild(9200 + (cleanupResult.ok ? 1 : 2));
    let releaseCleanup;
    let cleanupOptions;
    const cleanup = new Promise((resolve) => { releaseCleanup = () => resolve(cleanupResult); });
    const harness = createSdkHarness();
    const sdk = {
      ...harness.sdk,
      async startup(args) {
        args.options.spawnClaudeCodeProcess({
          command: 'claude.exe', args: [], cwd: 'C:\\workspace', env: {}, signal: new AbortController().signal,
        });
        assert.fail('startup must not continue after registerChild throws');
      },
    };
    const gen = generation();
    gen.context.spawnContext.registerChild = () => { throw new Error('registration rejected'); };
    const session = new ClaudeAgentSession({
      sdk,
      spawn: () => child,
      readCreationTime: () => 'captured-creation',
      terminateProcessTree(spawned, options) {
        assert.equal(spawned, child);
        cleanupOptions = options;
        return cleanup;
      },
    });
    let settled = false;
    const started = session.start(desired(), gen.context).finally(() => { settled = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(cleanupOptions.expectedCreationTime, 'captured-creation');
    assert.equal(cleanupOptions.readCreationTime, session._readCreationTime);
    releaseCleanup();
    if (cleanupResult.ok) await assert.rejects(started, /registration rejected/);
    else await assert.rejects(started, (error) => error instanceof ProviderProcessFenceError
      && error.code === 'PROVIDER_PROCESS_FENCE_FAILED');
  }
});

test('canonical persisted-message hash sorts object keys recursively and preserves arrays', () => {
  assert.equal(
    canonicalMessageHash({ b: 2, a: { z: 1, y: [3, { b: 2, a: 1 }] } }),
    canonicalMessageHash({ a: { y: [3, { a: 1, b: 2 }], z: 1 }, b: 2 }),
  );
  assert.notEqual(canonicalMessageHash([1, 2]), canonicalMessageHash([2, 1]));
});
