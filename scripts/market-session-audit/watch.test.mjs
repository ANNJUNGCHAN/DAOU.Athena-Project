import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runWatch, sleep } from './watch.mjs';

test('runWatch awaits each observation sequentially and records checkpoint actual time separately', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'athena-watch-'));
  let now = new Date('2026-09-07T08:39:00+09:00');
  let active = 0;
  let maxActive = 0;
  let sequence = 0;
  try {
    const result = await runWatch({
      outputRoot: dir,
      localDate: '2026-09-07',
      cutoff: new Date('2026-09-07T08:41:00+09:00'),
      intervalMs: 60_000,
      maxDurationMs: 10 * 60_000,
      nowFn: () => new Date(now),
      sleepFn: async (ms) => { now = new Date(now.getTime() + ms); },
      observe: async ({ now: observedAt }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        sequence += 1;
        active -= 1;
        return { artifact: { observed_at: observedAt.toISOString() }, outputPath: path.join(dir, `observer-${sequence}.json`) };
      },
    });
    assert.equal(maxActive, 1);
    assert.equal(result.state.finish_reason, 'planned_cutoff_reached');
    assert.equal(result.state.observations.length, 3);
    const checkpoint = result.state.checkpoints.find((item) => item.scheduled_for === new Date('2026-09-07T08:40:00+09:00').toISOString());
    assert.equal(checkpoint.observed_at, new Date('2026-09-07T08:40:00+09:00').toISOString());
    assert.equal(checkpoint.status, 'OBSERVED');
    assert.equal(checkpoint.lateness_ms, 0);
    const preopen = result.state.checkpoints.find((item) => item.scheduled_for === new Date('2026-09-07T08:30:00+09:00').toISOString());
    assert.equal(preopen.status, 'MISSED_BEFORE_START');
    assert.equal(preopen.observed_at, null);
    assert.equal(preopen.catchup_at, new Date('2026-09-07T08:39:00+09:00').toISOString());
    assert.equal(preopen.lateness_ms, 9 * 60_000);
    assert.notEqual(checkpoint.scheduled_for, result.state.started_at);
    assert.deepEqual(JSON.parse(await readFile(result.outputPath, 'utf8')), result.state);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runWatch rejects non-finite, negative, and out-of-range timing before observing', async () => {
  let observed = false;
  const observe = async () => { observed = true; };
  for (const options of [
    { intervalMs: -1 }, { intervalMs: Number.NaN }, { intervalMs: 999 },
    { maxDurationMs: -1 }, { maxDurationMs: Number.POSITIVE_INFINITY }, { maxDurationMs: 24 * 60 * 60_000 + 1 },
    { checkpointToleranceMs: -1 }, { checkpointToleranceMs: Number.NaN }, { checkpointToleranceMs: 15 * 60_000 + 1 },
  ]) {
    await assert.rejects(runWatch({ ...options, observe }), /must be between/);
  }
  assert.equal(observed, false);
});

test('a checkpoint sampled beyond its tolerance is LATE with explicit lateness', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'athena-watch-late-'));
  let now = new Date('2026-09-07T08:39:30+09:00');
  let sequence = 0;
  try {
    const result = await runWatch({
      outputRoot: dir,
      localDate: '2026-09-07',
      cutoff: new Date('2026-09-07T08:41:30+09:00'),
      intervalMs: 60_000,
      checkpointToleranceMs: 10_000,
      maxDurationMs: 5 * 60_000,
      nowFn: () => new Date(now),
      sleepFn: async (ms) => { now = new Date(now.getTime() + ms); },
      observe: async ({ now: observedAt }) => ({
        artifact: { observed_at: observedAt.toISOString() },
        outputPath: path.join(dir, `observer-${++sequence}.json`),
      }),
    });
    const checkpoint = result.state.checkpoints.find((item) => item.scheduled_for === new Date('2026-09-07T08:40:00+09:00').toISOString());
    assert.equal(checkpoint.status, 'LATE');
    assert.equal(checkpoint.observed_at, new Date('2026-09-07T08:40:30+09:00').toISOString());
    assert.equal(checkpoint.catchup_at, null);
    assert.equal(checkpoint.lateness_ms, 30_000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runWatch stops at max duration when the planned cutoff is outside its bounded window', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'athena-watch-max-'));
  let now = new Date('2026-09-07T09:00:00+09:00');
  try {
    const result = await runWatch({
      outputRoot: dir, localDate: '2026-09-07', cutoff: new Date('2026-09-07T16:30:00+09:00'),
      intervalMs: 60_000, maxDurationMs: 60_000,
      nowFn: () => new Date(now), sleepFn: async (ms) => { now = new Date(now.getTime() + ms); },
      observe: async ({ now: observedAt }) => ({ artifact: { observed_at: observedAt.toISOString() }, outputPath: 'safe.json' }),
    });
    assert.equal(result.state.finish_reason, 'max_duration_reached');
    assert.equal(result.state.observations.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sleep clears a pending timer when aborted', async () => {
  const controller = new AbortController();
  const waiting = sleep(60_000, controller.signal);
  controller.abort();
  await waiting;
});

test('an observation exception produces a sanitized terminal state with no fake observation', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'athena-watch-observe-fail-'));
  try {
    const result = await runWatch({
      outputRoot: dir,
      nowFn: () => new Date('2026-09-07T09:00:00+09:00'),
      observe: async () => { throw new TypeError('token=secret and private response body'); },
    });
    assert.equal(result.state.finish_reason, 'observation_failed');
    assert.ok(result.state.finished_at);
    assert.equal(result.state.observations.length, 0);
    assert.equal(result.state.failures.observation_count, 1);
    assert.deepEqual(result.state.failures.last_observation, {
      occurred_at: new Date('2026-09-07T09:00:00+09:00').toISOString(),
      error_class: 'TypeError',
    });
    const persisted = await readFile(result.outputPath, 'utf8');
    assert.equal(persisted.includes('token=secret'), false);
    assert.equal(persisted.includes('private response body'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a metadata write failure terminates and retries the terminal summary in finally', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'athena-watch-write-fail-'));
  let writes = 0;
  const persistedStates = [];
  try {
    const result = await runWatch({
      outputRoot: dir,
      nowFn: () => new Date('2026-09-07T09:00:00+09:00'),
      observe: async ({ now }) => ({ artifact: { observed_at: now.toISOString() }, outputPath: 'observer.json' }),
      persistFn: async (state) => {
        writes += 1;
        if (writes === 2) throw new Error('disk path and secret must not be persisted');
        persistedStates.push(structuredClone(state));
      },
    });
    assert.equal(writes, 3);
    assert.equal(result.state.finish_reason, 'metadata_write_failed');
    assert.ok(result.state.finished_at);
    assert.equal(result.state.observations.length, 1);
    assert.equal(result.state.failures.metadata_write_count, 1);
    assert.equal(JSON.stringify(persistedStates).includes('disk path and secret'), false);
    assert.equal(persistedStates.at(-1).finish_reason, 'metadata_write_failed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
