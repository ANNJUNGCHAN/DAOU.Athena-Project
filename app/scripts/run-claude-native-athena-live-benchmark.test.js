'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  createProcessLaneRunner,
  parseLiveArgs,
  runLiveComparison,
  validateLiveReport,
} = require('./run-claude-native-athena-live-benchmark');

test('live runner is paid-opt-in and runs cold5/warm30 in A/B/B/A order with identical fingerprints', async () => {
  assert.throws(() => parseLiveArgs([]), /paid opt-in/);
  const calls = [];
  const result = await runLiveComparison({
    allowPaid: true,
    coldSamples: 5,
    warmSamples: 30,
    configuration: { account: 'acct', model: 'model', effort: 'high', cwd: 'C:\\repo', mcpFingerprint: 'd'.repeat(64), promptHash: 'e'.repeat(64) },
    async runLane(input) {
      calls.push(`${input.temperature}:${input.lane}`);
      return { firstTextMs: input.lane === 'native' ? 10 : 12, configurationFingerprint: input.configurationFingerprint };
    },
  });
  assert.deepEqual(calls.slice(0, 4), ['cold:native', 'cold:athena', 'cold:athena', 'cold:native']);
  assert.equal(result.cold.native.rawSamples.length, 5);
  assert.equal(result.warm.athena.rawSamples.length, 30);
  assert.deepEqual(result.cold.native.rawSamples[0], {
    sequence: 1,
    sample: 1,
    lane: 'native',
    temperature: 'cold',
    configurationFingerprint: result.configurationFingerprint,
    firstTextMs: 10,
  });
  assert.equal(result.cold.athena.rawSamples[0].sequence, 2);
  assert.equal(result.cold.athena.rawSamples[1].sequence, 3);
  assert.equal(result.cold.native.rawSamples[1].sequence, 4);
  assert.equal(result.promptBody, undefined);
  assert.equal(result.secret, undefined);
  assert.equal(result.warm.athena.firstTextMs.max, 12);
  assert.deepEqual(validateLiveReport(result), []);
  const stale = structuredClone(result);
  stale.freshness.expiresAt = '2000-01-01T00:00:00.000Z';
  assert.ok(validateLiveReport(stale).some((entry) => entry.includes('stale')));

  const forged = structuredClone(result);
  forged.warm.native.firstTextMs.p50 += 1;
  assert.ok(validateLiveReport(forged).some((entry) => entry.includes('does not match raw samples')));

  const negative = structuredClone(result);
  negative.cold.native.rawSamples[0].firstTextMs = -1;
  assert.ok(validateLiveReport(negative).some((entry) => entry.includes('raw sample')));

  const outOfOrder = structuredClone(result);
  [outOfOrder.cold.native.rawSamples[0].sequence, outOfOrder.cold.athena.rawSamples[0].sequence] =
    [outOfOrder.cold.athena.rawSamples[0].sequence, outOfOrder.cold.native.rawSamples[0].sequence];
  assert.ok(validateLiveReport(outOfOrder).some((entry) => entry.includes('sequence')));

  const mismatched = structuredClone(result);
  mismatched.warm.athena.rawSamples[0].configurationFingerprint = 'f'.repeat(64);
  assert.ok(validateLiveReport(mismatched).some((entry) => entry.includes('configuration fingerprint')));
});

test('process lane waits through startup/log/framing output for canonical prompt-correlated model text', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  let kills = 0;
  child.kill = () => { kills += 1; };
  const times = [100, 137];
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
  assert.deepEqual(await measurement, { firstTextMs: 37, configurationFingerprint: 'a'.repeat(64) });
  assert.equal(kills, 1);
});
