'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  buildChatSessionArgs,
  createClaudeChatSession,
} = require('./claude-chat-session');
const { GATEWAY_ALLOWED_TOOLS, DISALLOWED_EXECUTION_TOOLS } = require('./claude-runner');
const { buildLivePrompt, buildLiveSystemPrompt, buildLiveTurnPrompt } = require('./live-prompt');

const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function createFakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.stdin = new EventEmitter();
  child.stdin.writes = [];
  child.stdin.write = (value) => {
    child.stdin.writes.push(String(value));
    return true;
  };
  return child;
}

function createHarness(options = {}) {
  const spawns = [];
  const kills = [];
  let nextPid = 100;
  const session = createClaudeChatSession({
    cwd: 'C:\\Athena',
    configFile: '.mcp.json',
    spawnFn: (bin, args, spawnOptions) => {
      const child = createFakeChild(nextPid++);
      spawns.push({ bin, args, options: spawnOptions, child });
      return child;
    },
    killFn: (child) => { kills.push(child); },
    envOverridesFn: () => ({ FAKE_OVERRIDE: '1' }),
    quietBoundaryMs: 1,
    respawnBaseDelayMs: 1,
    respawnMaxDelayMs: 5,
    ...options,
  });
  return { session, spawns, kills };
}

function lastChild(spawns) {
  return spawns[spawns.length - 1].child;
}

function messageAt(child, index) {
  return JSON.parse(child.stdin.writes[index]);
}

function emitLine(child, event) {
  child.stdout.emit('data', `${JSON.stringify(event)}\n`);
}

function emitResult(child, result = '답', extra = {}) {
  emitLine(child, { type: 'result', subtype: 'success', is_error: false, result, ...extra });
}

test('buildChatSessionArgs — 전체 옵션이 정확한 순서로 붙는다', () => {
  assert.deepEqual(buildChatSessionArgs({
    configFile: '.mcp.json',
    appendSystemPrompt: '규칙 전문',
    model: 'claude-sonnet-5',
    effort: 'high',
    resumeSessionId: 'sess-9',
  }), [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--mcp-config', '.mcp.json',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--allowedTools', GATEWAY_ALLOWED_TOOLS,
    '--disallowedTools', DISALLOWED_EXECUTION_TOOLS,
    '--append-system-prompt', '규칙 전문',
    '--model', 'claude-sonnet-5',
    '--effort', 'high',
    '--resume', 'sess-9',
  ]);
});

test('buildChatSessionArgs — 선택 옵션이 없으면 인자 자체가 빠진다', () => {
  const args = buildChatSessionArgs({ configFile: '.mcp.json' });
  for (const flag of ['--append-system-prompt', '--model', '--effort', '--resume']) {
    assert.equal(args.includes(flag), false, `${flag}가 없어야 한다`);
  }
});

test('live-prompt 분리 — 레거시 buildLivePrompt는 규칙+턴의 합성과 바이트 동일', () => {
  const q = '삼성전자 시세 보여줘';
  assert.equal(buildLivePrompt(q), `${buildLiveSystemPrompt()}\n\n${buildLiveTurnPrompt(q)}`);
  assert.equal(buildLiveTurnPrompt(q), `사용자 질문:\n${q}`);
  // 규칙 전문에는 질문 프레이밍이 없다 — 세션당 1회 system prompt로만 쓰인다.
  assert.equal(buildLiveSystemPrompt().includes('사용자 질문:'), false);
  assert.equal(buildLiveSystemPrompt().includes('아래 사용자 질문에 답하라'), true);
});

test('warm()은 1회만 스폰하고 env/옵션을 계약대로 넘긴다', () => {
  const { session, spawns } = createHarness({ appendSystemPrompt: '규칙' });
  session.warm({ model: 'm1', effort: 'low' });
  session.warm({ model: 'm1', effort: 'low' });
  assert.equal(spawns.length, 1);
  const entry = spawns[0];
  assert.deepEqual(entry.options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.equal(entry.options.env.FAKE_OVERRIDE, '1');
  assert.equal(entry.options.env.ENABLE_TOOL_SEARCH, '0');
  assert.equal(entry.options.shell, false);
  assert.equal(entry.args.includes('--append-system-prompt'), true);
  assert.equal(entry.args[entry.args.indexOf('--model') + 1], 'm1');
  assert.equal(session.snapshot().running, true);
});

test('run() — user 메시지 JSONL을 쓰고 result 이벤트로 resolve, 프로세스 재사용', async () => {
  const { session, spawns } = createHarness();
  session.warm({});
  const child = lastChild(spawns);

  const p1 = session.run({ prompt: '사용자 질문:\n첫 질문' });
  assert.deepEqual(messageAt(child, 0), {
    type: 'user',
    message: { role: 'user', content: '사용자 질문:\n첫 질문' },
    parent_tool_use_id: null,
  });
  emitResult(child, '첫 답', { session_id: 'sess-1', duration_ms: 42 });
  const r1 = await p1;
  assert.equal(r1.ok, true);
  assert.equal(r1.finalResult.result, '첫 답');
  assert.equal(r1.finalResult.session_id, 'sess-1');
  assert.equal(r1.spawnedFresh, false);
  assert.equal(typeof r1.firstEventMs, 'number');
  assert.equal(session.lastSessionId(), 'sess-1');

  await delay(4); // quiet 경계 통과
  const p2 = session.run({ prompt: '사용자 질문:\n둘째 질문' });
  assert.equal(spawns.length, 1, '같은 프로세스를 재사용해야 한다');
  assert.equal(child.stdin.writes.length, 2);
  emitResult(child, '둘째 답', { session_id: 'sess-1' });
  assert.equal((await p2).finalResult.result, '둘째 답');
});

test('quiet 창(잔여 조각 대기) 중 연속 질의도 같은 프로세스를 쓴다', async () => {
  const { session, spawns } = createHarness({ quietBoundaryMs: 1000 });
  session.warm({});
  const child = lastChild(spawns);
  const p1 = session.run({ prompt: 'q1' });
  emitResult(child, 'a1');
  await p1;
  // quiet 타이머(1000ms)가 아직 안 끝난 시점의 재질의
  const p2 = session.run({ prompt: 'q2' });
  assert.equal(spawns.length, 1);
  assert.equal(child.stdin.writes.length, 2);
  emitResult(child, 'a2');
  assert.equal((await p2).finalResult.result, 'a2');
});

test('예열 없이 run()하면 즉시 스폰하고 resumeSessionId를 --resume으로 쓴다', async () => {
  const { session, spawns } = createHarness();
  const p = session.run({ prompt: 'q', resumeSessionId: 'prev-7' });
  assert.equal(spawns.length, 1);
  const { args, child } = spawns[0];
  assert.equal(args[args.indexOf('--resume') + 1], 'prev-7');
  emitResult(child, 'a');
  const r = await p;
  assert.equal(r.ok, true);
  assert.equal(r.spawnedFresh, true);
});

test('onTextDelta·onCanvasResult·onEvent가 턴 스트림에서 전달된다', async () => {
  const { session, spawns } = createHarness();
  session.warm({});
  const child = lastChild(spawns);
  const deltas = [];
  const canvases = [];
  const events = [];
  const p = session.run({
    prompt: 'q',
    onTextDelta: (t) => deltas.push(t),
    onCanvasResult: (r) => canvases.push(r),
    onEvent: (e) => events.push(e.type),
  });
  emitLine(child, {
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '조각' } },
  });
  emitLine(child, {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__athena__athena__render_canvas', input: {} }] },
  });
  emitLine(child, {
    type: 'user',
    message: {
      content: [{
        type: 'tool_result',
        tool_use_id: 't1',
        content: JSON.stringify({ canvas_type: 'table', data: {} }),
      }],
    },
  });
  emitResult(child, '끝');
  await p;
  assert.deepEqual(deltas, ['조각']);
  assert.equal(canvases.length, 1);
  assert.equal(canvases[0].status, 'success');
  assert.equal(canvases[0].envelope.canvas_type, 'table');
  assert.deepEqual(events, ['stream_event', 'assistant', 'user', 'result']);
});

test('kill 핸들 — aborted로 즉시 resolve하고 프로세스를 죽인 뒤 백그라운드 재예열한다', async () => {
  const { session, spawns, kills } = createHarness();
  session.warm({});
  const child = lastChild(spawns);
  emitLine(child, { type: 'system', subtype: 'init', session_id: 'sess-5' });
  let handle = null;
  const p = session.run({ prompt: 'q', onSpawn: (h) => { handle = h; } });
  handle.kill();
  const r = await p;
  assert.equal(r.aborted, true);
  assert.equal(r.ok, false);
  assert.equal(kills.length, 1);
  await delay(10); // respawnBaseDelayMs(1ms) 경과
  assert.equal(spawns.length, 2, '백그라운드 재예열이 있어야 한다');
  const args = spawns[1].args;
  assert.equal(args[args.indexOf('--resume') + 1], 'sess-5', '마지막 session_id로 문맥을 복구한다');
});

test('signal abort — aborted:true, reason 메시지 유지', async () => {
  const { session, spawns } = createHarness();
  session.warm({});
  const controller = new AbortController();
  const p = session.run({ prompt: 'q', signal: controller.signal });
  controller.abort(new Error('사용자가 취소했다'));
  const r = await p;
  assert.equal(r.aborted, true);
  assert.equal(r.error, '사용자가 취소했다');
  assert.equal(spawns.length, 1);
});

test('턴 타임아웃 — timedOut:true, 프로세스 교체', async () => {
  const { session, kills } = createHarness();
  session.warm({});
  const r = await session.run({ prompt: 'q', timeoutMs: 5 });
  assert.equal(r.timedOut, true);
  assert.equal(r.ok, false);
  assert.equal(kills.length, 1);
});

test('턴 중 프로세스 close — exitCode 실은 실패 결과 + 재예열', async () => {
  const { session, spawns } = createHarness();
  session.warm({});
  const child = lastChild(spawns);
  const p = session.run({ prompt: 'q' });
  child.stderr.emit('data', '치명적 오류\n');
  child.emit('close', 1);
  const r = await p;
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
  assert.equal(r.stderr, '치명적 오류\n');
  await delay(10);
  assert.equal(spawns.length, 2, '죽은 프로세스는 재예열된다');
});

test('model/effort 변경 — 프로세스를 교체하고 --resume으로 문맥을 잇는다', async () => {
  const { session, spawns } = createHarness();
  session.warm({ model: 'm1' });
  const first = lastChild(spawns);
  const p1 = session.run({ prompt: 'q1', model: 'm1' });
  emitResult(first, 'a1', { session_id: 'sess-2' });
  await p1;
  await delay(4);

  const p2 = session.run({ prompt: 'q2', model: 'm2', resumeSessionId: 'sess-2' });
  assert.equal(spawns.length, 2, '설정이 바뀌면 새로 스폰한다');
  const { args, child } = spawns[1];
  assert.equal(args[args.indexOf('--model') + 1], 'm2');
  assert.equal(args[args.indexOf('--resume') + 1], 'sess-2');
  emitResult(child, 'a2');
  assert.equal((await p2).finalResult.result, 'a2');
});

test('선점 — busy 중 새 run()이 오면 이전 턴은 aborted, 새 프로세스에서 처리', async () => {
  const { session, spawns } = createHarness();
  session.warm({});
  const p1 = session.run({ prompt: 'q1' });
  const p2 = session.run({ prompt: 'q2' });
  const r1 = await p1;
  assert.equal(r1.aborted, true);
  assert.equal(spawns.length, 2);
  emitResult(lastChild(spawns), 'a2');
  assert.equal((await p2).finalResult.result, 'a2');
});

test('stop() — 진행 중 턴은 aborted, 이후 재예열도 run()도 없다', async () => {
  const { session, spawns, kills } = createHarness();
  session.warm({});
  const p = session.run({ prompt: 'q' });
  session.stop(new Error('앱 종료'));
  const r = await p;
  assert.equal(r.aborted, true);
  assert.equal(kills.length, 1);
  await delay(10);
  assert.equal(spawns.length, 1, 'stop 후 재예열 금지');
  const dead = await session.run({ prompt: 'q2' });
  assert.equal(dead.aborted, true);
});

test('빈 질의는 스폰 없이 거부한다', async () => {
  const { session, spawns } = createHarness();
  const r = await session.run({ prompt: '   ' });
  assert.equal(r.ok, false);
  assert.equal(r.error, '질의가 비어 있다');
  assert.equal(spawns.length, 0);
});
