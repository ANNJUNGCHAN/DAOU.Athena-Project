'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  CodexAppServerSession,
} = require('./codex-app-server-session');
const { validateEventPayload } = require('./provider-session-contract');

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.pid = 4100;
  }
}

function createHarness({ desired = {}, generation = 7, random = () => 0.5 } = {}) {
  const child = new FakeChild();
  const requests = [];
  let carry = '';
  child.stdin.on('data', (chunk) => {
    carry += chunk.toString('utf8');
    let newline;
    while ((newline = carry.indexOf('\n')) !== -1) {
      const line = carry.slice(0, newline);
      carry = carry.slice(newline + 1);
      if (line) requests.push(JSON.parse(line));
    }
  });
  const assertCalls = [];
  let current = true;
  const generationContext = {
    runtimeGeneration: generation,
    processOwnerId: `owner-${generation}`,
    spawnContext: {
      assertCurrent() {
        assertCalls.push('assert');
        if (!current) throw new Error('stale generation');
      },
      buildEnv() { return {}; },
      registerChild() { return { async terminate() {} }; },
    },
  };
  const runtime = {
    spawnGenerationAppServer(received) {
      assert.equal(received, generationContext);
      return { child, terminationHandle: { async terminate() {} } };
    },
  };
  const session = new CodexAppServerSession({
    runtime,
    random,
    sleep: async () => {},
    requestTimeoutMs: 1000,
    startupTimeoutMs: 1000,
  });
  const events = [];
  function turnContext() {
    return {
      emit(type, payload, providerTurnId = null) {
        validateEventPayload(type, payload, 'codex');
        events.push({ type, payload, providerTurnId });
      },
    };
  }
  return {
    session,
    child,
    requests,
    events,
    desired: {
      appVersion: '0.1.0',
      model: 'gpt-5.6-sol',
      effort: 'medium',
      cwd: 'C:\\workspace',
      developerInstructions: 'Athena instructions',
      ...desired,
    },
    generationContext,
    turnContext,
    setCurrent(value) { current = value; },
    assertCalls,
  };
}

function respond(child, envelope, { newline = true } = {}) {
  child.stdout.write(JSON.stringify(envelope) + (newline ? '\n' : ''));
}

async function tick() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function startReady(harness) {
  const start = harness.session.start(harness.desired, harness.generationContext);
  await tick();
  const initialize = harness.requests.find((entry) => entry.method === 'initialize');
  assert.ok(initialize);
  respond(harness.child, { id: initialize.id, result: { userAgent: 'codex-cli/0.147.0' } });
  await start;
  assert.deepEqual(harness.requests[0], {
    id: 1,
    method: 'initialize',
    params: {
      clientInfo: { name: 'athena', title: 'Athena', version: '0.1.0' },
      capabilities: { experimentalApi: false },
    },
  });
  assert.deepEqual(harness.requests[1], { method: 'initialized' });
}

async function completeThreadStart(harness, threadId) {
  await tick();
  const request = harness.requests.findLast((entry) => entry.method === 'thread/start');
  assert.ok(request);
  respond(harness.child, { id: request.id, result: { thread: { id: threadId } } });
  return request;
}

async function completeTurn(harness, providerTurnId, status = 'completed', athenaTurnId = null) {
  await tick();
  const request = athenaTurnId === null
    ? harness.requests.findLast((entry) => entry.method === 'turn/start')
    : harness.requests.find((entry) => entry.method === 'turn/start'
      && entry.params.clientUserMessageId === athenaTurnId);
  assert.ok(request);
  respond(harness.child, { id: request.id, result: { turn: { id: providerTurnId } } });
  respond(harness.child, {
    method: 'turn/started',
    params: { turn: { id: providerTurnId, threadId: request.params.threadId, status: 'inProgress' } },
    emittedAtMs: 500,
  });
  respond(harness.child, {
    method: 'item/agentMessage/delta',
    params: { threadId: request.params.threadId, turnId: providerTurnId, delta: 'answer' },
    emittedAtMs: 100,
  });
  respond(harness.child, {
    method: 'turn/completed',
    params: { turn: { id: providerTurnId, threadId: request.params.threadId, status } },
  });
  return request;
}

test('one process owns two conversation threads and same-conversation turns stay FIFO', async () => {
  const harness = createHarness();
  await startReady(harness);

  const first = harness.session.sendTurn({ conversationId: 'c1', turnId: 'a1', userText: 'one' }, harness.turnContext());
  await completeThreadStart(harness, 'thread-c1');
  await tick();
  const second = harness.session.sendTurn({ conversationId: 'c1', turnId: 'a2', userText: 'two' }, harness.turnContext());
  const other = harness.session.sendTurn({ conversationId: 'c2', turnId: 'b1', userText: 'other' }, harness.turnContext());
  await completeThreadStart(harness, 'thread-c2');
  await tick();

  assert.equal(harness.requests.filter((entry) => entry.method === 'turn/start').length, 2);
  await completeTurn(harness, 'provider-a1', 'completed', 'a1');
  const firstResult = await first;
  await tick();
  assert.equal(harness.requests.filter((entry) => entry.method === 'turn/start').length, 3);
  await completeTurn(harness, 'provider-b1', 'completed', 'b1');
  await completeTurn(harness, 'provider-a2', 'completed', 'a2');
  await Promise.all([other, second]);

  const firstStart = harness.requests.find((entry) => entry.method === 'turn/start'
    && entry.params.clientUserMessageId === 'a1');
  const secondStart = harness.requests.find((entry) => entry.method === 'turn/start'
    && entry.params.clientUserMessageId === 'a2');
  assert.equal(firstStart.params.model, 'gpt-5.6-sol');
  assert.equal(firstStart.params.effort, 'medium');
  assert.equal('model' in secondStart.params, false);
  assert.equal('effort' in secondStart.params, false);
  assert.deepEqual(firstResult.providerBinding, { provider: 'codex', threadId: 'thread-c1' });
  assert.deepEqual(firstResult.continuationCheckpoint, { provider: 'codex', turnId: 'provider-a1' });
  assert.equal(harness.events.filter((entry) => entry.type === 'turn_completed').length, 3);
});

test('existing cursor resumes with stable {threadId} params only', async () => {
  const harness = createHarness({ desired: { conversationThreads: { c1: 'thread-existing' } } });
  await startReady(harness);
  const turn = harness.session.sendTurn({ conversationId: 'c1', turnId: 'a1', userText: 'hello' }, harness.turnContext());
  await tick();
  const resume = harness.requests.find((entry) => entry.method === 'thread/resume');
  assert.deepEqual(resume.params, { threadId: 'thread-existing' });
  assert.equal('excludeTurns' in resume.params, false);
  respond(harness.child, { id: resume.id, result: { thread: { id: 'thread-existing' } } });
  await completeTurn(harness, 'provider-a1');
  await turn;
});

test('failed turn recovers by forking at the last successful provider turn before next write', async () => {
  const harness = createHarness();
  await startReady(harness);
  const successful = harness.session.sendTurn({ conversationId: 'c1', turnId: 'a1', userText: 'safe' }, harness.turnContext());
  await completeThreadStart(harness, 'thread-c1');
  await completeTurn(harness, 'provider-success');
  await successful;

  const failed = harness.session.sendTurn({ conversationId: 'c1', turnId: 'a2', userText: 'FAILED_SENTINEL' }, harness.turnContext());
  await completeTurn(harness, 'provider-failed', 'failed');
  await assert.rejects(failed, (error) => error.code === 'CODEX_TURN_FAILED');

  const next = harness.session.sendTurn({ conversationId: 'c1', turnId: 'a3', userText: 'next' }, harness.turnContext());
  await tick();
  const fork = harness.requests.findLast((entry) => entry.method === 'thread/fork');
  assert.deepEqual(fork.params, { threadId: 'thread-c1', lastTurnId: 'provider-success' });
  assert.equal(harness.requests.findLast((entry) => entry.method === 'turn/start').params.clientUserMessageId, 'a2');
  respond(harness.child, { id: fork.id, result: { thread: { id: 'thread-recovered' } } });
  await completeTurn(harness, 'provider-next');
  const result = await next;
  assert.deepEqual(result.providerBinding, { provider: 'codex', threadId: 'thread-recovered' });
});

test('turn/start overload retries only rejected requests and keeps FIFO ownership', async () => {
  const harness = createHarness({ random: () => 0.5 });
  await startReady(harness);
  const turn = harness.session.sendTurn({ conversationId: 'c1', turnId: 'a1', userText: 'hello' }, harness.turnContext());
  await completeThreadStart(harness, 'thread-c1');
  await tick();
  let starts = harness.requests.filter((entry) => entry.method === 'turn/start');
  respond(harness.child, { id: starts[0].id, error: { code: -32001, message: 'Server overloaded; retry later.' } });
  await tick();
  starts = harness.requests.filter((entry) => entry.method === 'turn/start');
  assert.equal(starts.length, 2);
  assert.deepEqual(starts[1].params, starts[0].params);
  await completeTurn(harness, 'provider-a1');
  await turn;
});

test('non-overload rejection is not retried', async () => {
  const harness = createHarness();
  await startReady(harness);
  const turn = harness.session.sendTurn({ conversationId: 'c1', turnId: 'a1', userText: 'hello' }, harness.turnContext());
  await completeThreadStart(harness, 'thread-c1');
  await tick();
  const start = harness.requests.findLast((entry) => entry.method === 'turn/start');
  respond(harness.child, { id: start.id, error: { code: -32602, message: 'bad params' } });
  await assert.rejects(turn, (error) => error.code === 'CODEX_REQUEST_REJECTED');
  assert.equal(harness.requests.filter((entry) => entry.method === 'turn/start').length, 1);
});

test('overload received after turn/started is never retried', async () => {
  const harness = createHarness();
  await startReady(harness);
  const turn = harness.session.sendTurn({ conversationId: 'c1', turnId: 'a1', userText: 'hello' }, harness.turnContext());
  await completeThreadStart(harness, 'thread-c1');
  await tick();
  const start = harness.requests.findLast((entry) => entry.method === 'turn/start');
  respond(harness.child, {
    method: 'turn/started',
    params: { threadId: 'thread-c1', turn: { id: 'provider-a1' } },
  });
  respond(harness.child, {
    id: start.id,
    error: { code: -32001, message: 'Server overloaded; retry later.' },
  });
  await assert.rejects(turn);
  assert.equal(harness.requests.filter((entry) => entry.method === 'turn/start').length, 1);
});

test('interrupt acknowledgement is not terminal; interrupted completion resolves interrupt and turn', async () => {
  const harness = createHarness();
  await startReady(harness);
  const turn = harness.session.sendTurn({ conversationId: 'c1', turnId: 'a1', userText: 'hello' }, harness.turnContext());
  await completeThreadStart(harness, 'thread-c1');
  await tick();
  const turnStart = harness.requests.findLast((entry) => entry.method === 'turn/start');
  respond(harness.child, { id: turnStart.id, result: { turn: { id: 'provider-a1' } } });
  respond(harness.child, { method: 'turn/started', params: { turn: { id: 'provider-a1', threadId: 'thread-c1' } } });

  const interrupt = harness.session.interrupt('a1', 'user');
  await tick();
  const request = harness.requests.findLast((entry) => entry.method === 'turn/interrupt');
  assert.deepEqual(request.params, { threadId: 'thread-c1', turnId: 'provider-a1' });
  respond(harness.child, { id: request.id, result: {} });
  await tick();
  assert.equal(harness.events.some((entry) => entry.type === 'turn_interrupted'), false);
  respond(harness.child, { method: 'turn/completed', params: { turn: { id: 'provider-a1', threadId: 'thread-c1', status: 'interrupted' } } });
  const [turnResult, interruptResult] = await Promise.all([turn, interrupt]);
  assert.equal(turnResult.status, 'interrupted');
  assert.deepEqual(interruptResult, turnResult);
});

test('stale generation fences writes and late notifications', async () => {
  const harness = createHarness();
  await startReady(harness);
  harness.setCurrent(false);
  await assert.rejects(
    harness.session.sendTurn({ conversationId: 'c1', turnId: 'a1', userText: 'hello' }, harness.turnContext()),
    /stale generation/,
  );
  assert.equal(harness.requests.some((entry) => entry.method === 'thread/start'), false);
});

test('late notifications from a fenced generation cannot reach the turn context', async () => {
  const harness = createHarness();
  await startReady(harness);
  const turn = harness.session.sendTurn({ conversationId: 'c1', turnId: 'a1', userText: 'hello' }, harness.turnContext());
  await completeThreadStart(harness, 'thread-c1');
  await tick();
  const start = harness.requests.findLast((entry) => entry.method === 'turn/start');
  respond(harness.child, { id: start.id, result: { turn: { id: 'provider-a1' } } });
  respond(harness.child, { method: 'turn/started', params: { threadId: 'thread-c1', turn: { id: 'provider-a1' } } });
  const eventCount = harness.events.length;
  harness.setCurrent(false);
  respond(harness.child, {
    method: 'item/agentMessage/delta',
    params: { threadId: 'thread-c1', turnId: 'provider-a1', delta: 'STALE_SENTINEL' },
  });
  await tick();
  assert.equal(harness.events.length, eventCount);
  harness.setCurrent(true);
  harness.child.emit('close', 1, null);
  await assert.rejects(turn, (error) => error.code === 'CODEX_PROCESS_EXITED');
});

test('thread-scoped MCP pagination exact-matches stable fields without requiring pluginId', async () => {
  const harness = createHarness({
    desired: {
      expectedMcpServers: [{
        name: 'athena',
        authStatus: 'notRequired',
        tools: [{ name: 'mcp__athena__resolve' }],
        resources: [],
        resourceTemplates: [],
        serverInfo: { name: 'athena-gateway', version: '1.0.0' },
      }],
      mcpPageLimit: 1,
    },
  });
  await startReady(harness);
  const turn = harness.session.sendTurn({ conversationId: 'c1', turnId: 'a1', userText: 'hello' }, harness.turnContext());
  await completeThreadStart(harness, 'thread-c1');
  await tick();
  const configRead = harness.requests.findLast((entry) => entry.method === 'config/read');
  assert.deepEqual(configRead.params, { cwd: 'C:\\workspace', includeLayers: true });
  respond(harness.child, { id: configRead.id, result: { config: {}, layers: [] } });
  await tick();
  let list = harness.requests.findLast((entry) => entry.method === 'mcpServerStatus/list');
  assert.deepEqual(list.params, { threadId: 'thread-c1', detail: 'full', cursor: null, limit: 1 });
  respond(harness.child, {
    id: list.id,
    result: {
      data: [{
        name: 'athena', authStatus: 'notRequired',
        tools: [{ name: 'mcp__athena__resolve' }], resources: [], resourceTemplates: [],
        serverInfo: { name: 'athena-gateway', version: '1.0.0' },
      }],
      nextCursor: 'next',
    },
  });
  await tick();
  list = harness.requests.findLast((entry) => entry.method === 'mcpServerStatus/list');
  assert.deepEqual(list.params, { threadId: 'thread-c1', detail: 'full', cursor: 'next', limit: 1 });
  respond(harness.child, { id: list.id, result: { data: [], nextCursor: null } });
  await completeTurn(harness, 'provider-a1');
  await turn;
});

test('process crash rejects active requests and marks cursors for stable resume on a fresh session', async () => {
  const harness = createHarness();
  await startReady(harness);
  const turn = harness.session.sendTurn({ conversationId: 'c1', turnId: 'a1', userText: 'hello' }, harness.turnContext());
  await completeThreadStart(harness, 'thread-c1');
  await tick();
  harness.child.emit('close', 1, null);
  await assert.rejects(turn, (error) => error.code === 'CODEX_PROCESS_EXITED');
  assert.deepEqual(harness.session.snapshot().conversationThreads, { c1: 'thread-c1' });
});

test('stop terminates registered process and clears pending request correlations', async () => {
  const harness = createHarness();
  await startReady(harness);
  await harness.session.stop();
  assert.equal(harness.session.snapshot().state, 'stopped');
  assert.equal(harness.session.snapshot().pendingRequestCount, 0);
});
