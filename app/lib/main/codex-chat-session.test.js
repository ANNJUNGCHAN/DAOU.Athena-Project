'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { CodexChatSession, legacyEvent } = require('./codex-chat-session');
const { CodexSessionError } = require('./codex-app-server-session');
const { createConversationSessionPool } = require('./conversation-session-pool');

class FakeAppSession {
  constructor() {
    this.state = 'stopped';
    this.desired = null;
    this.context = null;
    this.threadId = null;
    this.turns = [];
    this.stopCount = 0;
  }
  async start(desired, context) {
    this.desired = desired;
    this.context = context;
    this.threadId = desired.conversationThreads?.['legacy-chat'] || 'thread-new';
    this.state = 'ready';
  }
  async warmConversation() {
    if (this.warmGate) await this.warmGate;
    return { threadId: this.threadId };
  }
  async sendTurn(turn, context) {
    this.turns.push(turn);
    context.emit('turn_started', { providerTurnId: 'provider-turn' });
    context.emit('text_delta', { text: '안녕' });
    context.emit('thinking_delta', { text: '생각' });
    context.emit('tool_started', {
      toolUseId: 'tool-1', parentToolUseId: null,
      canonicalToolName: 'athena__render_canvas', providerToolName: 'mcp__athena__athena__render_canvas',
      input: { canvas_type: 'table' },
    });
    context.emit('tool_completed', {
      toolUseId: 'tool-1', canonicalToolName: 'athena__render_canvas', isError: false,
      content: '{"canvas_type":"table"}',
    });
    context.emit('canvas_result', { toolUseId: 'tool-1', status: 'success', envelope: { canvas_type: 'table' } });
    return {
      status: 'completed',
      providerBinding: { provider: 'codex', threadId: this.threadId },
      continuationCheckpoint: { provider: 'codex', turnId: 'provider-turn' },
      finalText: '안녕', usage: { input_tokens: 3 },
    };
  }
  async interrupt() { return { status: 'interrupted' }; }
  async stop() { this.stopCount += 1; this.state = 'stopped'; }
  snapshot() { return { state: this.state, pid: 4321, conversationThreads: { 'legacy-chat': this.threadId } }; }
}

function harness({ warmGate = null } = {}) {
  const sessions = [];
  const generations = [];
  let uuid = 0;
  const chat = new CodexChatSession({
    cwd: 'C:\\athena',
    runtime: { spawnGenerationAppServer() {} },
    developerInstructions: 'Athena rules',
    requiredMcpServer: { name: 'athena', requiredTools: ['mcp__athena__athena_search'] },
    mcpAudit: { validate() {} },
    generationContextFactory(keys) {
      generations.push(keys);
      return { runtimeGeneration: generations.length, spawnContext: { assertCurrent() {} } };
    },
    sessionFactory() {
      const session = new FakeAppSession();
      session.warmGate = warmGate;
      sessions.push(session);
      return session;
    },
    uuidFn: () => `turn-${++uuid}`,
    nowFn: (() => { let now = 0; return () => ++now; })(),
  });
  return { chat, sessions, generations };
}

test('snapshot remains warming until the blank thread and MCP warm step finish', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = harness({ warmGate: gate });
  const warming = h.chat.warm({ model: null, effort: null, resumeSessionId: null });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.chat.snapshot().state, 'warming');
  assert.equal(h.chat.snapshot().warm, false);
  release();
  await warming;
  assert.equal(h.chat.snapshot().state, 'idle');
});

test('warm starts one app-server, creates a blank thread, and carries secure config into desired state', async () => {
  const h = harness();
  const first = await h.chat.warm({
    model: 'gpt-5.6-sol', effort: 'medium', identityKey: 'acct', securityKey: 'security', resumeSessionId: null,
  });
  await h.chat.warm({
    model: 'gpt-5.6-sol', effort: 'medium', identityKey: 'acct', securityKey: 'security', resumeSessionId: null,
  });
  assert.equal(h.sessions.length, 1);
  assert.equal(first.warm, true);
  assert.equal(first.state, 'idle');
  assert.equal(first.lastSessionId, 'thread-new');
  assert.deepEqual(h.generations, [{ identityKey: 'acct', securityKey: 'security' }]);
  assert.equal(h.sessions[0].desired.developerInstructions, 'Athena rules');
  assert.deepEqual(h.sessions[0].desired.requiredMcpServer, {
    name: 'athena', requiredTools: ['mcp__athena__athena_search'],
  });
  assert.equal(typeof h.sessions[0].desired.mcpAudit.validate, 'function');
});

test('run reuses blank warm thread and exposes Claude-compatible callbacks and result', async () => {
  const h = harness();
  await h.chat.warm({ model: 'gpt-5.6-sol', effort: 'medium', resumeSessionId: null });
  const events = [];
  const texts = [];
  const thinking = [];
  const canvases = [];
  let spawned;
  const result = await h.chat.run({
    prompt: '질문', model: 'gpt-5.6-sol', effort: 'medium', resumeSessionId: null,
    onSpawn: (value) => { spawned = value; },
    onEvent: (value) => events.push(value),
    onTextDelta: (value) => texts.push(value),
    onThinkingDelta: (value) => thinking.push(value),
    onCanvasResult: (value) => canvases.push(value),
  });
  assert.equal(h.sessions.length, 1);
  assert.equal(spawned.pid, 4321);
  assert.deepEqual(texts, ['안녕']);
  assert.deepEqual(thinking, ['생각']);
  assert.deepEqual(canvases, [{ toolUseId: 'tool-1', status: 'success', envelope: { canvas_type: 'table' } }]);
  assert.equal(events.some((event) => event.type === 'assistant'), true);
  assert.equal(events.some((event) => event.type === 'user'), true);
  assert.equal(result.ok, true);
  assert.equal(result.finalResult.session_id, 'thread-new');
  assert.equal(result.finalResult.result, '안녕');
  assert.equal(result.spawnedFresh, false);
});

test('explicit resume cursor is used and account/security changes rotate the process', async () => {
  const h = harness();
  const first = await h.chat.run({
    prompt: 'one', model: 'gpt-5.6-sol', effort: 'medium',
    identityKey: 'acct-a', securityKey: 's1', resumeSessionId: 'thread-old',
  });
  assert.equal(first.finalResult.session_id, 'thread-old');
  assert.equal(h.sessions[0].desired.conversationThreads['legacy-chat'], 'thread-old');
  await h.chat.run({
    prompt: 'two', model: 'gpt-5.6-sol', effort: 'medium',
    identityKey: 'acct-b', securityKey: 's1', resumeSessionId: 'thread-old',
  });
  assert.equal(h.sessions.length, 2);
  assert.equal(h.sessions[0].stopCount, 1);
});

test('empty prompts do not create a process and null model settings use native defaults', async () => {
  const h = harness();
  assert.equal((await h.chat.run({ prompt: '' })).ok, false);
  const native = await h.chat.run({ prompt: 'q', model: null, effort: null });
  assert.equal(native.ok, true);
  assert.equal(h.sessions[0].desired.model, null);
  assert.equal(h.sessions[0].desired.effort, null);
});

test('legacyEvent preserves tool correlation for existing trackers', () => {
  assert.deepEqual(legacyEvent('tool_completed', {
    toolUseId: 't1', content: 'result', isError: false,
  }), {
    type: 'user', message: { content: [{
      type: 'tool_result', tool_use_id: 't1', content: 'result', is_error: false,
    }] },
  });
});

test('nested private-auth failure reaches the legacy result without generic spawn masking', async () => {
  const authError = Object.assign(new Error('Athena 계정 설정에서 Codex 로그인을 완료해 주세요.'), {
    code: 'CODEX_PRIVATE_AUTH_REQUIRED', actionNeeded: true, retryable: false,
  });
  const h = harness();
  h.chat._sessionFactory = () => ({
    async start() { throw new CodexSessionError('CODEX_SPAWN_FAILED', 'Unable to start Codex app-server', { cause: authError }); },
    async stop() {},
    snapshot() { return { state: 'failed' }; },
  });
  const result = await h.chat.run({ prompt: 'q', model: null, effort: null });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CODEX_PRIVATE_AUTH_REQUIRED');
  assert.equal(result.errorCode, 'CODEX_PRIVATE_AUTH_REQUIRED');
  assert.equal(result.actionNeeded, true);
  assert.equal(result.retryable, false);
  assert.equal(result.error, 'Athena 계정 설정에서 Codex 로그인을 완료해 주세요.');
});

test('private-auth warm failure is non-retryable so the spare pool does not storm', async () => {
  const authError = Object.assign(new Error('Athena 계정 설정에서 Codex 로그인을 완료해 주세요.'), {
    code: 'CODEX_PRIVATE_AUTH_REQUIRED', actionNeeded: true, retryable: false,
  });
  let creates = 0;
  const errors = [];
  const pool = createConversationSessionPool({
    desiredSize: 1,
    retryDelayMs: 5,
    onError: (error) => errors.push(error),
    createSession() {
      creates += 1;
      const h = harness();
      h.chat._sessionFactory = () => ({
        async start() { throw authError; },
        async stop() {},
        snapshot() { return { state: 'failed' }; },
      });
      return h.chat;
    },
  });
  pool.start();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(creates, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'CODEX_PRIVATE_AUTH_REQUIRED');
  assert.equal(pool.snapshot().retryScheduled, false);
  pool.stop();
  await pool.drain();
});
