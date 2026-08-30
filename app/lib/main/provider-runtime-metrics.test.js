'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createProviderRuntimeMetrics, percentile, summarize } = require('./provider-runtime-metrics');

test('nearest-rank percentiles are calculated from complete correlated samples', () => {
  assert.equal(percentile([1, 2, 3, 4, 100], 0.95), 100);
  assert.deepEqual(summarize([1, 2, 3, 4]), { count: 4, p50: 2, p95: 4, max: 4 });
});

test('main and renderer clocks are never subtracted from each other', () => {
  let now = 100;
  const metrics = createProviderRuntimeMetrics({ clock: () => now });
  metrics.beginTurn({ clientSubmitId: 'client-1', turnId: 'turn-1', provider: 'claude', origin: 'shell' });
  metrics.mark('turn-1', 'm2', 110);
  metrics.mark('turn-1', 'm3', 140);
  metrics.mark('turn-1', 'm4', 145);
  assert.equal(metrics.acknowledgePaint({
    clientSubmitId: 'client-1', turnId: 'turn-1', sequence: 2,
    rendererSubmittedAt: 10_000, rendererReceivedAt: 10_020, rendererPaintedAt: 10_050,
  }), true);
  now = 180;
  const sample = metrics.completeTurn('turn-1', 'completed');

  assert.equal(sample.main_ipc_to_provider_write_ms, 10);
  assert.equal(sample.provider_event_to_main_dispatch_ms, 5);
  assert.equal(sample.warm_submit_to_first_text_ms, 30);
  assert.equal(sample.renderer_event_to_first_paint_ms, 30);
  assert.equal(sample.renderer_submit_to_first_paint_ms, 50);
  assert.equal(sample.total_turn_ms, 80);
});

test('paint ACK is exact-turn, exact-submit, ordered, and first-writer only', () => {
  const metrics = createProviderRuntimeMetrics();
  metrics.beginTurn({ clientSubmitId: 'client', turnId: 'turn', provider: 'claude' });
  const valid = { clientSubmitId: 'client', turnId: 'turn', sequence: 1, rendererSubmittedAt: 1, rendererReceivedAt: 2, rendererPaintedAt: 3 };
  assert.equal(metrics.acknowledgePaint({ ...valid, clientSubmitId: 'wrong' }), false);
  assert.equal(metrics.acknowledgePaint({ ...valid, rendererReceivedAt: 4 }), false);
  assert.equal(metrics.acknowledgePaint(valid), true);
  assert.equal(metrics.acknowledgePaint({ ...valid, sequence: 2 }), false);
});

test('report contains no prompt, response, cwd, token, or secret labels', () => {
  const metrics = createProviderRuntimeMetrics({ clock: () => 1 });
  metrics.increment('provider_process_spawn_total', { provider: 'claude' });
  const serialized = JSON.stringify(metrics.report());
  for (const forbidden of ['prompt', 'response', 'cwd', 'secret', 'token']) {
    assert.equal(serialized.toLowerCase().includes(forbidden), false);
  }
});

test('unknown counters and duplicate turn identities fail closed', () => {
  const metrics = createProviderRuntimeMetrics();
  assert.throws(() => metrics.increment('arbitrary_metric'), /unknown counter/);
  metrics.beginTurn({ clientSubmitId: 'c', turnId: 't', provider: 'codex' });
  assert.throws(() => metrics.beginTurn({ clientSubmitId: 'c2', turnId: 't', provider: 'codex' }), /duplicate/);
});

