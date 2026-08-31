'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  createProcessLaneRunner,
  parseLiveArgs,
  runLiveComparison,
  validateSessionContinuity,
  validateLiveReport,
} = require('./run-claude-native-athena-live-benchmark');

test('arbitrary callback cannot mint claude-live-paired evidence from matching scalar identities', async () => {
  assert.throws(() => parseLiveArgs([]), /paid opt-in/);
  const calls = [];
  await assert.rejects(runLiveComparison({
    allowPaid: true,
    coldSamples: 5,
    warmSamples: 30,
    configuration: { account: 'acct', model: 'model', effort: 'high', cwd: 'C:\\repo', mcpFingerprint: 'd'.repeat(64), promptHash: 'e'.repeat(64) },
    async runLane(input) {
      calls.push(`${input.temperature}:${input.lane}`);
      const laneOffset = input.lane === 'native' ? 1000 : 2000;
      const warm = input.temperature === 'warm';
      return {
        firstTextMs: 10,
        configurationFingerprint: input.configurationFingerprint,
        processId: warm ? laneOffset : laneOffset + input.index + 1,
        processCreationTime: warm ? `${input.lane}-warm-start` : `${input.lane}-cold-start-${input.index + 1}`,
        sessionId: warm ? `${input.lane}-warm-session` : `${input.lane}-cold-${input.index + 1}`,
        generation: warm ? 7 : input.index + 1,
        sessionReused: warm && input.index > 0,
        liveReceipt: Object.freeze({}),
      };
    },
  }), /invalid or mismatched evidence/);
  assert.deepEqual(calls, ['cold:native']);
  assert.ok(validateLiveReport({}).some((entry) => entry.includes('runner-owned observation receipts')));
});

test('continuity compares process instances and sessions separately from generation', () => {
  const sample = (processId, processCreationTime, sessionId, generation, sessionReused) => ({
    processId, processCreationTime, sessionId, generation, sessionReused,
  });
  assert.deepEqual(validateSessionContinuity([
    sample(10, 'a', 's1', 1, false),
    sample(10, 'a', 's1', 2, false),
  ], 'cold'), ['cold samples must each use a distinct process instance and provider session']);
  assert.deepEqual(validateSessionContinuity([
    sample(10, 'a', 's1', 1, false),
    sample(11, 'b', 's1', 1, false),
  ], 'cold'), ['cold samples must each use a distinct process instance and provider session']);
  assert.deepEqual(validateSessionContinuity([
    sample(10, 'a', 'warm', 7, false),
    sample(10, 'a', 'warm', 7, true),
  ], 'warm'), []);
  assert.ok(validateSessionContinuity([
    sample(10, 'a', 'warm', 7, false),
    sample(10, 'b', 'warm', 7, true),
  ], 'warm').some((entry) => entry.includes('one process')));
});

test('process lane waits through startup/log/framing output for canonical prompt-correlated model text', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.pid = 4321;
  let kills = 0;
  child.kill = () => { kills += 1; };
  const times = [100];
  const runner = createProcessLaneRunner({
    commands: { native: { file: 'claude', args: ['-p'] } },
    promptText: 'redacted prompt',
    spawnProcess() { return child; },
    now() { return times.shift(); },
  });
  let settled = false;
  const measurement = runner({
    lane: 'native',
    temperature: 'cold',
    index: 0,
    configurationFingerprint: 'a'.repeat(64),
    configuration: { cwd: 'C:\\repo' },
  }).then((value) => { settled = true; return value; });

  child.stdout.write(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' })}\n`);
  child.stdout.write('provider startup log that is not a protocol frame\n');
  child.stdout.write(`${JSON.stringify({ type: 'stream_event', event: { type: 'message_start' } })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: 'stream_event', session_id: 's1', parent_tool_use_id: 'subagent-tool',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'nested activity' } },
  })}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(kills, 0);

  child.stdout.write(`${JSON.stringify({
    type: 'stream_event', session_id: 's1',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'model answer' } },
  })}\n`);
  await assert.rejects(measurement, /lacks observed process, session, or provider generation identity/);
  assert.equal(kills, 1);

  await assert.rejects(runner({
    lane: 'native',
    temperature: 'warm',
    index: 0,
    configurationFingerprint: 'a'.repeat(64),
    configuration: { cwd: 'C:\\repo' },
  }), /cannot prove persistent warm session continuity/);
  assert.equal(kills, 1);
});

test('in-tree runner observes an actual child process, session id, and provider generation', async () => {
  const frames = [
    { type: 'system', subtype: 'init', session_id: 'observed-session', provider_generation: 4 },
    {
      type: 'stream_event', session_id: 'observed-session', provider_generation: 4,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'observed text' } },
    },
  ];
  const source = `for (const frame of ${JSON.stringify(frames)}) process.stdout.write(JSON.stringify(frame) + '\\n'); setTimeout(() => {}, 5000);`;
  const runner = createProcessLaneRunner({
    commands: { native: { file: process.execPath, args: ['-e', source] } },
    promptText: 'fixture prompt',
  });
  const measurement = await runner({
    lane: 'native',
    temperature: 'cold',
    index: 0,
    configurationFingerprint: 'a'.repeat(64),
    configuration: { cwd: process.cwd() },
  });

  assert.equal(measurement.sessionId, 'observed-session');
  assert.equal(measurement.generation, 4);
  assert.ok(Number.isInteger(measurement.processId));
  assert.ok(measurement.processCreationTime.length > 0);
  assert.equal(Object.keys(measurement.liveReceipt).length, 0);
});
