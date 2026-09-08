'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  createGrokAcpSession,
  buildGrokAcpArgs,
} = require('./grok-acp-session');

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.stdin.writes = [];
  child.stdin.write = (value) => {
    child.stdin.writes.push(String(value));
    return true;
  };
  return child;
}

function messages(child) {
  return child.stdin.writes.map((line) => JSON.parse(line));
}

function request(child, method) {
  return messages(child).find((message) => message.method === method);
}

function reply(child, rpc, result = {}) {
  child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result })}\n`);
}

function update(child, value) {
  child.stdout.emit('data', `${JSON.stringify({
    jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1', update: value },
  })}\n`);
}

async function tick() {
  await new Promise((resolve) => setImmediate(resolve));
}

function harness(options = {}) {
  const spawns = [];
  const kills = [];
  let pid = 40;
  const session = createGrokAcpSession({
    cwd: 'C:\\Athena\\mcp-config',
    profilePath: 'C:\\Athena\\mcp-config\\grok-profile.json',
    rules: 'Athena rules',
    mcpServers: [{ name: 'athena', command: 'python', args: ['-m', 'athena_mcp', 'serve'], env: [] }],
    spawnFn: (bin, args, spawnOptions) => {
      const child = fakeChild(pid++);
      spawns.push({ bin, args, options: spawnOptions, child });
      return child;
    },
    killFn: (child) => { kills.push(child); return Promise.resolve(); },
    rpcTimeoutMs: 100,
    timeoutMs: 100,
    ...options,
  });
  return { session, spawns, kills };
}

async function startTurn(ctx, runOptions = {}) {
  const promise = ctx.session.run({ prompt: 'hello', model: 'grok-4.6', effort: 'high', ...runOptions });
  await tick();
  const child = ctx.spawns.at(-1).child;
  const initialize = request(child, 'initialize');
  assert.ok(initialize);
  reply(child, initialize, { protocolVersion: 1, authRequired: false });
  await tick();
  const open = request(child, 'session/load') || request(child, 'session/new');
  assert.ok(open);
  reply(child, open, open.method === 'session/load' ? {} : { sessionId: 's1' });
  await tick();
  return { promise, child, prompt: request(child, 'session/prompt') };
}

test('build args use the verified agent stdio flag order', () => {
  assert.deepEqual(buildGrokAcpArgs({ model: 'grok-4.6', effort: 'high', profilePath: 'profile.json' }), [
    'agent', '--model', 'grok-4.6', '--reasoning-effort', 'high',
    '--agent-profile', 'profile.json', '--no-leader', 'stdio',
  ]);
});

test('two sequential turns share one process and one ACP session', async () => {
  const ctx = harness();
  const first = await startTurn(ctx);
  assert.equal(first.prompt.params.sessionId, 's1');
  reply(first.child, first.prompt, { stopReason: 'end_turn' });
  assert.equal((await first.promise).ok, true);

  const secondPromise = ctx.session.run({ prompt: 'again', model: 'grok-4.6', effort: 'high' });
  await tick();
  const second = messages(first.child).filter((message) => message.method === 'session/prompt')[1];
  assert.ok(second);
  reply(first.child, second, { stopReason: 'end_turn' });
  const result = await secondPromise;
  assert.equal(result.spawnedFresh, false);
  assert.equal(result.submitted, true);
  assert.equal(ctx.spawns.length, 1);
  assert.equal(messages(first.child).filter((message) => message.method === 'initialize').length, 1);
});

test('session new/load preserve rules, profile, yolo mode, and explicit MCP descriptor', async () => {
  const ctx = harness();
  const turn = await startTurn(ctx, { resumeSessionId: 'existing' });
  const loaded = request(turn.child, 'session/load');
  assert.equal(loaded.params.sessionId, 'existing');
  assert.equal(loaded.params._meta.rules, 'Athena rules');
  assert.equal(loaded.params._meta.agentProfile, 'C:\\Athena\\mcp-config\\grok-profile.json');
  assert.equal(loaded.params._meta.yoloMode, true);
  assert.equal(loaded.params.mcpServers[0].name, 'athena');
  reply(turn.child, turn.prompt, { stopReason: 'end_turn' });
  await turn.promise;
});

test('text, thought, tool result, and structured canvas stream through parser-compatible callbacks', async () => {
  const ctx = harness();
  const text = [];
  const thought = [];
  const canvas = [];
  const events = [];
  const turn = await startTurn(ctx, {
    onTextDelta: (value) => text.push(value),
    onThinkingDelta: (value) => thought.push(value),
    onCanvasResult: (value) => canvas.push(value),
    onEvent: (value) => events.push(value.type),
  });
  update(turn.child, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello ' } });
  update(turn.child, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'think' } });
  update(turn.child, {
    sessionUpdate: 'tool_call', toolCallId: 'tool-1', title: 'use_tool',
    rawInput: { tool_name: 'mcp__athena__athena__render_canvas', tool_input: { canvas_type: 'table' } },
  });
  update(turn.child, {
    sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', status: 'completed',
    structuredContent: { canvas_type: 'table', data: { rows: [] } },
  });
  update(turn.child, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world' } });
  reply(turn.child, turn.prompt, { stopReason: 'end_turn' });
  const result = await turn.promise;
  assert.deepEqual(text, ['hello ', 'world']);
  assert.deepEqual(thought, ['think']);
  assert.equal(canvas.length, 1);
  assert.equal(canvas[0].envelope.canvas_type, 'table');
  assert.deepEqual(events, ['stream_event', 'stream_event', 'assistant', 'user', 'stream_event', 'result']);
  assert.equal(result.finalResult.result, 'hello world');
  assert.equal(typeof result.metrics.firstTextMs, 'number');
});

test('reverse filesystem, terminal, and permission requests are denied', async () => {
  const ctx = harness();
  const turn = await startTurn(ctx);
  turn.child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: 81, method: 'fs/read_text_file', params: {} })}\n`);
  turn.child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: 82, method: 'terminal/create', params: {} })}\n`);
  turn.child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: 83, method: 'session/request_permission', params: {} })}\n`);
  await tick();
  const sent = messages(turn.child);
  assert.equal(sent.find((message) => message.id === 81).error.code, -32601);
  assert.equal(sent.find((message) => message.id === 82).error.code, -32601);
  assert.deepEqual(sent.find((message) => message.id === 83).result, { outcome: { outcome: 'cancelled' } });
  reply(turn.child, turn.prompt, { stopReason: 'end_turn' });
  await turn.promise;
});

test('cached token authentication occurs only when initialize requires and advertises it', async () => {
  const ctx = harness();
  const promise = ctx.session.run({ prompt: 'hello' });
  await tick();
  const child = ctx.spawns[0].child;
  const initialize = request(child, 'initialize');
  reply(child, initialize, { authRequired: true, authMethods: [{ id: 'cached_token' }] });
  await tick();
  const auth = request(child, 'authenticate');
  assert.deepEqual(auth.params, { methodId: 'cached_token' });
  reply(child, auth, {});
  await tick();
  const open = request(child, 'session/new');
  reply(child, open, { sessionId: 's1' });
  await tick();
  const prompt = request(child, 'session/prompt');
  reply(child, prompt, { stopReason: 'end_turn' });
  await promise;
});

test('abort fails a submitted turn immediately, kills the process, and never replays prompt', async () => {
  const ctx = harness();
  const controller = new AbortController();
  const deltas = [];
  const turn = await startTurn(ctx, { signal: controller.signal, onTextDelta: (value) => deltas.push(value) });
  assert.ok(turn.prompt);
  controller.abort(new Error('cancelled'));
  const result = await turn.promise;
  update(turn.child, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'late' } });
  assert.equal(result.ok, false);
  assert.equal(result.submitted, true);
  assert.equal(result.aborted, true);
  assert.equal(ctx.kills.length, 1);
  assert.equal(ctx.spawns.length, 1);
  assert.equal(messages(turn.child).filter((message) => message.method === 'session/prompt').length, 1);
  assert.deepEqual(deltas, [], '종료된 턴에는 늦은 콜백이 전달되면 안 된다');
});

test('process exit after prompt fails submitted turn and next run starts clean without replay', async () => {
  const ctx = harness();
  const first = await startTurn(ctx);
  first.child.emit('close', 7);
  const failed = await first.promise;
  assert.equal(failed.submitted, true);
  assert.equal(failed.exitCode, 7);
  assert.equal(ctx.spawns.length, 1);

  const second = await startTurn(ctx);
  assert.equal(ctx.spawns.length, 2);
  assert.deepEqual(messages(second.child).filter((message) => message.method === 'session/prompt').map((message) => message.params.prompt[0].text), ['hello']);
  reply(second.child, second.prompt, { stopReason: 'end_turn' });
  await second.promise;
});

test('identity, security, model, or effort mismatch rotates before submitting the next prompt', async () => {
  const ctx = harness();
  const first = await startTurn(ctx, { identityKey: 'acct-a', securityKey: 'cfg-a' });
  reply(first.child, first.prompt, { stopReason: 'end_turn' });
  await first.promise;
  const second = await startTurn(ctx, { identityKey: 'acct-b', securityKey: 'cfg-a' });
  assert.equal(ctx.spawns.length, 2);
  assert.equal(ctx.kills.length, 1);
  reply(second.child, second.prompt, { stopReason: 'end_turn' });
  await second.promise;
});

test('startup failure is pre-submit and does not write a prompt', async () => {
  const ctx = harness();
  const promise = ctx.session.run({ prompt: 'hello' });
  await tick();
  const child = ctx.spawns[0].child;
  child.emit('close', 3);
  const result = await promise;
  assert.equal(result.submitted, false);
  assert.equal(result.ok, false);
  assert.equal(messages(child).some((message) => message.method === 'session/prompt'), false);
});

test('turn timeout fails submitted work, kills the runtime, and never replays', async () => {
  const ctx = harness({ timeoutMs: 5 });
  const turn = await startTurn(ctx, { timeoutMs: 5 });
  const result = await turn.promise;
  assert.equal(result.submitted, true);
  assert.equal(result.timedOut, true);
  assert.equal(ctx.kills.length, 1);
  assert.equal(messages(turn.child).filter((message) => message.method === 'session/prompt').length, 1);
});

test('per-turn stdout cap fails closed and rotates the runtime', async () => {
  const ctx = harness({ maxStdoutBytes: 40 });
  const turn = await startTurn(ctx);
  update(turn.child, {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'this payload is intentionally larger than the cap' },
  });
  const result = await turn.promise;
  assert.equal(result.submitted, true);
  assert.equal(result.stdoutCapped, true);
  assert.equal(ctx.kills.length, 1);
});
