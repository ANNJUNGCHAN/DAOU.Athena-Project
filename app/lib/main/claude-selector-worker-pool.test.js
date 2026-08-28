'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  DEFAULT_POOL_SIZE,
  WARMUP_PROMPT,
  buildSelectorWorkerArgs,
  createClaudeSelectorWorkerPool,
} = require('./claude-selector-worker-pool');
const { DISALLOWED_EXECUTION_TOOLS } = require('./claude-runner');

const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function createFakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.stdin = new EventEmitter();
  child.stdin.destroyed = false;
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
  const pool = createClaudeSelectorWorkerPool({
    cwd: 'C:\\Athena',
    spawnFn: (bin, args, spawnOptions) => {
      const child = createFakeChild(nextPid++);
      spawns.push({ bin, args, options: spawnOptions, child });
      return child;
    },
    killFn: (child) => {
      kills.push({ child, spawnCount: spawns.length });
      child.stdin.destroyed = true;
    },
    quietBoundaryMs: 1,
    warmupTimeoutMs: 100,
    respawnBaseDelayMs: 1,
    respawnMaxDelayMs: 5,
    ...options,
  });
  return { pool, spawns, kills };
}

function messageAt(child, index) {
  return JSON.parse(child.stdin.writes[index]);
}

function emitResult(child, result = 'ok', extra = {}) {
  child.stdout.emit('data', `${JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
    ...extra,
  })}\n`);
}

async function warm(entries) {
  for (const { child } of entries) emitResult(child, 'OK');
  await delay(4);
}

test('default start spawns eight warming workers and promotes all eight only after warmup results', async () => {
  const { pool, spawns } = createHarness();
  pool.start();

  assert.equal(DEFAULT_POOL_SIZE, 8);
  assert.equal(spawns.length, 8);
  assert.deepEqual(pool.snapshot().workers, {
    total: 8, warming: 8, ready: 0, idle: 0, busy: 0, quiet: 0, stale: 0,
  });
  for (const entry of spawns) {
    assert.equal(entry.child.stdin.writes.length, 1);
    assert.deepEqual(messageAt(entry.child, 0), {
      type: 'user',
      message: { role: 'user', content: WARMUP_PROMPT },
      parent_tool_use_id: null,
    });
    assert.deepEqual(entry.options.stdio, ['pipe', 'pipe', 'pipe']);
  }
  await warm(spawns);
  assert.equal(pool.snapshot().workers.ready, 8);
  assert.equal(pool.snapshot().workers.idle, 8);
  pool.stop();
});

test('worker args preserve stream JSON and complete tool/MCP isolation', () => {
  assert.deepEqual(buildSelectorWorkerArgs({ model: 'claude-sonnet-5', effort: 'high' }), [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--setting-sources', '',
    '--tools', '',
    '--disallowedTools', DISALLOWED_EXECUTION_TOOLS,
    '--no-session-persistence',
    '--max-turns', '1',
    '--model', 'claude-sonnet-5',
    '--effort', 'high',
  ]);
});

test('requests stay queued until a real warmup result makes a worker ready', async () => {
  const { pool, spawns } = createHarness({ desiredSize: 2 });
  pool.start();
  const pending = pool.run({ prompt: 'real-query' });
  assert.deepEqual(spawns.map(({ child }) => child.stdin.writes.length), [1, 1]);
  assert.equal(pool.snapshot().queued, 1);

  emitResult(spawns[0].child, 'OK');
  await delay(4);
  assert.equal(spawns[0].child.stdin.writes.length, 2);
  assert.equal(messageAt(spawns[0].child, 1).message.content, 'real-query');
  emitResult(spawns[0].child, 'answer');
  assert.equal((await pending).finalResult.result, 'answer');
  pool.stop();
});

test('request timeout is absolute from enqueue and expires without any ready worker or assignment', async () => {
  const { pool, spawns } = createHarness({ desiredSize: 1, warmupTimeoutMs: 100 });
  pool.start();
  const result = await pool.run({ prompt: 'never-assigned', timeoutMs: 5 });

  assert.equal(result.timedOut, true);
  assert.equal(result.aborted, false);
  assert.equal(spawns[0].child.stdin.writes.length, 1);
  assert.equal(pool.snapshot().queued, 0);
  pool.stop();
});

test('a warmed process is reused normally without another spawn', async () => {
  const { pool, spawns } = createHarness({ desiredSize: 1 });
  pool.start();
  await warm(spawns);
  assert.equal(pool.snapshot().workers.idle, 1);

  const first = pool.run({ prompt: 'first' });
  emitResult(spawns[0].child, 'first-answer');
  assert.equal((await first).ok, true);
  await delay(4);
  const second = pool.run({ prompt: 'second' });
  emitResult(spawns[0].child, 'second-answer');
  assert.equal((await second).finalResult.result, 'second-answer');
  assert.equal(spawns.length, 1);
  assert.deepEqual(spawns[0].child.stdin.writes.map((line) => JSON.parse(line).message.content), [
    WARMUP_PROMPT, 'first', 'second',
  ]);
  pool.stop();
});

test('aborting one of four active turns resolves promptly without killing it and the next query uses a ready spare PID', async () => {
  const { pool, spawns, kills } = createHarness();
  pool.start();
  await warm(spawns);
  const controllers = Array.from({ length: 4 }, () => new AbortController());
  const active = controllers.map((controller, index) => pool.run({
    prompt: `active-${index}`,
    signal: controller.signal,
  }));
  const activePids = spawns.slice(0, 4).map(({ child }) => child.pid);

  controllers[0].abort(new Error('superseded'));
  const aborted = await active[0];
  assert.equal(aborted.aborted, true);
  assert.equal(kills.length, 0);
  assert.equal(pool.snapshot().workers.busy, 4);

  const replacementQuery = pool.run({ prompt: 'newest-query' });
  assert.equal(spawns.length, 8);
  assert.equal(spawns[4].child.stdin.writes.length, 2);
  assert.equal(activePids.includes(spawns[4].child.pid), false);
  emitResult(spawns[4].child, 'newest-answer');
  assert.equal((await replacementQuery).finalResult.result, 'newest-answer');

  emitResult(spawns[0].child, 'discard-me');
  for (let i = 1; i < 4; i += 1) emitResult(spawns[i].child, `active-answer-${i}`);
  await Promise.all(active.slice(1));
  pool.stop();
});

test('crash and timeout kill only the failed worker while queued work routes to an already-ready spare', async () => {
  const crashHarness = createHarness({ desiredSize: 3 });
  crashHarness.pool.start();
  await warm(crashHarness.spawns);
  const crashed = crashHarness.pool.run({ prompt: 'will-crash' });
  crashHarness.spawns[0].child.emit('close', 1);
  assert.equal((await crashed).ok, false);
  assert.equal(crashHarness.kills.filter(({ child }) => child === crashHarness.spawns[0].child).length, 1);
  const afterCrash = crashHarness.pool.run({ prompt: 'after-crash' });
  assert.equal(crashHarness.spawns[1].child.stdin.writes.length, 2);
  emitResult(crashHarness.spawns[1].child, 'spare-answer');
  assert.equal((await afterCrash).ok, true);
  crashHarness.pool.stop();

  const timeoutHarness = createHarness({ desiredSize: 3, timeoutMs: 5 });
  timeoutHarness.pool.start();
  await warm(timeoutHarness.spawns);
  const timedOut = await timeoutHarness.pool.run({ prompt: 'will-timeout' });
  assert.equal(timedOut.timedOut, true);
  const afterTimeout = timeoutHarness.pool.run({ prompt: 'after-timeout' });
  assert.equal(timeoutHarness.spawns[1].child.stdin.writes.length, 2);
  emitResult(timeoutHarness.spawns[1].child, 'timeout-spare-answer');
  assert.equal((await afterTimeout).ok, true);
  timeoutHarness.pool.stop();
});

test('result resolves immediately but trailing events remain isolated until the quiet boundary', async () => {
  const { pool, spawns } = createHarness({ desiredSize: 1, quietBoundaryMs: 12 });
  pool.start();
  emitResult(spawns[0].child, 'OK');
  await delay(15);
  const first = pool.run({ prompt: 'first' });
  emitResult(spawns[0].child, 'first-answer');
  assert.equal((await first).ok, true);
  const second = pool.run({ prompt: 'second' });
  assert.equal(spawns[0].child.stdin.writes.length, 2);

  await delay(6);
  spawns[0].child.stdout.emit('data', `${JSON.stringify({ type: 'assistant', message: { content: [] } })}\n`);
  await delay(8);
  assert.equal(spawns[0].child.stdin.writes.length, 2);
  await delay(8);
  assert.equal(spawns[0].child.stdin.writes.length, 3);
  emitResult(spawns[0].child, 'second-answer');
  assert.equal((await second).ok, true);
  pool.stop();
});

test('stdin error kills the old process exactly once and replaces it', async () => {
  const { pool, spawns, kills } = createHarness({ desiredSize: 1 });
  pool.start();
  await warm(spawns);
  spawns[0].child.stdin.emit('error', new Error('EPIPE'));
  spawns[0].child.emit('error', new Error('EPIPE again'));
  spawns[0].child.emit('close', 1);
  await delay(3);
  assert.equal(kills.filter(({ child }) => child === spawns[0].child).length, 1);
  assert.equal(spawns.length, 2);
  pool.stop();
});

test('warmup error and warmup timeout both kill and replace the unready worker', async () => {
  const errorHarness = createHarness({ desiredSize: 1 });
  errorHarness.pool.start();
  emitResult(errorHarness.spawns[0].child, 'warmup failed', { is_error: true, subtype: 'error' });
  assert.equal(errorHarness.kills.length, 1);
  assert.equal(errorHarness.spawns.length, 2);
  assert.equal(errorHarness.pool.snapshot().workers.ready, 0);
  errorHarness.pool.stop();

  const timeoutHarness = createHarness({ desiredSize: 1, warmupTimeoutMs: 5 });
  timeoutHarness.pool.start();
  await delay(8);
  assert.equal(timeoutHarness.kills.length, 1);
  assert.equal(timeoutHarness.spawns.length, 2);
  assert.equal(timeoutHarness.pool.snapshot().workers.warming, 1);
  timeoutHarness.pool.stop();
});

test('an is_error result is recycled only after a warmed replacement restores capacity', async () => {
  const { pool, spawns, kills } = createHarness({ desiredSize: 1 });
  pool.start();
  await warm(spawns);
  const failed = pool.run({ prompt: 'bad-turn' });
  emitResult(spawns[0].child, 'classification failed', { is_error: true, subtype: 'error' });
  assert.equal((await failed).ok, false);
  assert.equal(spawns.length, 2);
  assert.equal(kills.length, 0);

  emitResult(spawns[1].child, 'OK');
  assert.equal(kills.length, 0);
  await delay(5);
  assert.equal(kills.filter(({ child }) => child === spawns[0].child).length, 1);
  assert.equal(pool.snapshot().workers.ready, 1);
  pool.stop();
});

test('max user turns blue-green rotates only after replacement warmup succeeds', async () => {
  const { pool, spawns, kills } = createHarness({ desiredSize: 1, maxUserTurns: 2 });
  pool.start();
  await warm(spawns);
  for (const [prompt, answer] of [['one', '1'], ['two', '2']]) {
    const pending = pool.run({ prompt });
    emitResult(spawns[0].child, answer);
    assert.equal((await pending).ok, true);
    await delay(4);
  }
  assert.equal(spawns.length, 2);
  assert.equal(kills.length, 0);

  emitResult(spawns[1].child, 'OK');
  await delay(5);
  assert.equal(kills.filter(({ child }) => child === spawns[0].child).length, 1);
  assert.equal(pool.snapshot().workers.idle, 1);
  pool.stop();
});

test('hot configuration retains the entire old generation until every new worker is warm', async () => {
  const { pool, spawns, kills } = createHarness({ desiredSize: 2, model: 'old', effort: 'low' });
  pool.start();
  await warm(spawns);
  pool.configure({ model: 'new', effort: 'high' });

  assert.equal(spawns.length, 4);
  assert.equal(kills.length, 0);
  assert.equal(pool.snapshot().activation, 'warming');
  assert.equal(pool.snapshot().readyCurrent, 0);
  assert.equal(pool.snapshot().targetGeneration, 2);
  emitResult(spawns[2].child, 'OK');
  await delay(4);
  assert.equal(kills.length, 0);
  assert.equal(pool.snapshot().workers.stale, 2);

  emitResult(spawns[3].child, 'OK');
  assert.equal(kills.length, 0);
  await delay(5);
  assert.equal(kills.filter(({ child }) => [spawns[0].child, spawns[1].child].includes(child)).length, 2);
  assert.deepEqual(pool.snapshot().config, { model: 'new', effort: 'high' });
  assert.equal(pool.snapshot().activation, 'ready');
  assert.equal(pool.snapshot().readyCurrent, 2);
  assert.equal(pool.snapshot().workers.ready, 2);
  pool.stop();
});

test('failed hot configuration keeps stale workers alive but never routes new prompts to them', async () => {
  const { pool, spawns, kills } = createHarness({
    desiredSize: 2,
    model: 'old',
    effort: 'low',
    warmupTimeoutMs: 100,
  });
  pool.start();
  await warm(spawns);
  const oldChildren = spawns.slice(0, 2).map(({ child }) => child);
  pool.configure({ model: 'new', effort: 'high' });
  emitResult(spawns[2].child, 'new failed', { is_error: true, subtype: 'error' });
  emitResult(spawns[3].child, 'new failed', { is_error: true, subtype: 'error' });

  const result = await pool.run({ prompt: 'must-not-use-old', timeoutMs: 8 });
  assert.equal(result.timedOut, true);
  assert.equal(oldChildren.every((child) => child.stdin.writes.length === 1), true);
  assert.equal(kills.some(({ child }) => oldChildren.includes(child)), false);
  assert.equal(spawns.length > 4, true);
  assert.equal(pool.snapshot().activation, 'warming');
  assert.equal(pool.snapshot().readyCurrent, 0);
  assert.equal(pool.snapshot().workers.stale, 2);
  pool.stop();
});

test('A to B to C before B warm drops the intermediate warming generation and keeps only A serving until C is ready', async () => {
  const { pool, spawns, kills } = createHarness({ desiredSize: 2, model: 'A', effort: 'low' });
  pool.start();
  await warm(spawns);
  const aChildren = spawns.slice(0, 2).map(({ child }) => child);
  assert.equal(pool.snapshot().servingGeneration, 1);

  pool.configure({ model: 'B', effort: 'low' });
  const bChildren = spawns.slice(2, 4).map(({ child }) => child);
  assert.equal(pool.snapshot().workers.warming, 2);
  pool.configure({ model: 'C', effort: 'high' });
  const cEntries = spawns.slice(4, 6);

  assert.equal(bChildren.every((child) => kills.filter((entry) => entry.child === child).length === 1), true);
  assert.equal(aChildren.every((child) => kills.some((entry) => entry.child === child) === false), true);
  assert.equal(pool.snapshot().workers.total, 4);
  assert.equal(pool.snapshot().workers.stale, 2);
  assert.equal(pool.snapshot().targetGeneration, 3);
  assert.equal(pool.snapshot().servingGeneration, 1);
  assert.equal(cEntries.every(({ args }) => args.includes('C')), true);

  await warm(cEntries);
  assert.equal(aChildren.every((child) => kills.filter((entry) => entry.child === child).length === 1), true);
  assert.equal(pool.snapshot().workers.total, 2);
  assert.equal(pool.snapshot().servingGeneration, 3);
  pool.stop();
});

test('warmup failure retries with bounded anti-spin backoff and stop prevents further respawn', () => {
  const delays = [];
  const scheduled = [];
  const pool = createClaudeSelectorWorkerPool({
    cwd: 'C:\\Athena',
    desiredSize: 1,
    spawnFn: () => { throw new Error('ENOENT'); },
    setTimeoutFn: (callback, ms) => {
      delays.push(ms);
      scheduled.push(callback);
      return callback;
    },
    clearTimeoutFn: () => {},
    respawnBaseDelayMs: 10,
    respawnMaxDelayMs: 25,
  });
  pool.start();
  assert.deepEqual(delays, [10]);
  scheduled.shift()();
  assert.deepEqual(delays, [10, 20]);
  scheduled.shift()();
  assert.deepEqual(delays, [10, 20, 25]);
  pool.stop();
  scheduled.shift()();
  assert.deepEqual(delays, [10, 20, 25]);
});
