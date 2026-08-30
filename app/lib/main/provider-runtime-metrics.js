'use strict';

const COUNTER_NAMES = new Set([
  'provider_process_spawn_total',
  'provider_process_exit_total',
  'provider_respawn_total',
  'provider_turn_total',
  'provider_interrupt_total',
  'provider_rotation_total',
  'stale_event_dropped_total',
  'output_limit_total',
  'mcp_generation_total',
  'fallback_turn_total',
  'paint_ack_rejected_total',
]);

const MAIN_MARKS = new Set(['m0', 'm1', 'm2', 'm3', 'm4', 'terminal']);

function finite(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be finite and non-negative`);
  return value;
}

function percentile(values, fraction) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.min(index, sorted.length - 1)];
}

function summarize(values) {
  const finiteValues = values.filter(Number.isFinite);
  return Object.freeze({
    count: finiteValues.length,
    p50: percentile(finiteValues, 0.5),
    p95: percentile(finiteValues, 0.95),
    max: finiteValues.length ? Math.max(...finiteValues) : null,
  });
}

function counterKey(name, labels) {
  const normalized = Object.entries(labels || {})
    .filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value).slice(0, 64)}`)
    .join(',');
  return `${name}{${normalized}}`;
}

function createProviderRuntimeMetrics({ clock = () => performance.now(), maxSamples = 10_000 } = {}) {
  const counters = new Map();
  const turns = new Map();
  const completed = [];

  function increment(name, labels = {}, amount = 1) {
    if (!COUNTER_NAMES.has(name)) throw new TypeError(`unknown counter: ${name}`);
    if (!Number.isSafeInteger(amount) || amount < 1) throw new TypeError('counter amount must be positive integer');
    const key = counterKey(name, labels);
    counters.set(key, (counters.get(key) || 0) + amount);
  }

  function beginTurn({ clientSubmitId, turnId, provider, origin, m0 = clock() }) {
    if (typeof clientSubmitId !== 'string' || !clientSubmitId) throw new TypeError('clientSubmitId required');
    if (typeof turnId !== 'string' || !turnId) throw new TypeError('turnId required');
    if (!['claude', 'codex'].includes(provider)) throw new TypeError('provider required');
    if (turns.has(turnId)) throw new Error('duplicate turn metrics');
    turns.set(turnId, {
      clientSubmitId,
      turnId,
      provider,
      origin: origin === 'orb' ? 'orb' : 'shell',
      marks: { m0: finite(m0, 'm0') },
      paint: null,
      outcome: null,
      firstVisibleEventSequence: null,
    });
  }

  function mark(turnId, name, value = clock()) {
    if (!MAIN_MARKS.has(name)) throw new TypeError(`unknown main mark: ${name}`);
    const turn = turns.get(turnId);
    if (!turn) return false;
    const next = finite(value, name);
    if (turn.marks[name] !== undefined) return false;
    turn.marks[name] = next;
    return true;
  }

  function acknowledgePaint({
    clientSubmitId,
    turnId,
    sequence,
    rendererSubmittedAt,
    rendererReceivedAt,
    rendererPaintedAt,
  }) {
    const turn = turns.get(turnId);
    if (!turn || turn.clientSubmitId !== clientSubmitId || turn.paint) return false;
    if (!Number.isSafeInteger(sequence) || sequence < 1) return false;
    const r0 = finite(rendererSubmittedAt, 'rendererSubmittedAt');
    const r1 = finite(rendererReceivedAt, 'rendererReceivedAt');
    const r2 = finite(rendererPaintedAt, 'rendererPaintedAt');
    if (r1 < r0 || r2 < r1) return false;
    turn.paint = { rendererSubmittedAt: r0, rendererReceivedAt: r1, rendererPaintedAt: r2 };
    turn.firstVisibleEventSequence = sequence;
    return true;
  }

  function completeTurn(turnId, outcome) {
    const turn = turns.get(turnId);
    if (!turn) return null;
    if (!['completed', 'interrupted', 'failed'].includes(outcome)) throw new TypeError('invalid outcome');
    if (turn.marks.terminal === undefined) turn.marks.terminal = finite(clock(), 'terminal');
    turn.outcome = outcome;
    const m = turn.marks;
    const paint = turn.paint;
    const sample = Object.freeze({
      clientSubmitId: turn.clientSubmitId,
      turnId,
      provider: turn.provider,
      origin: turn.origin,
      outcome,
      firstVisibleEventSequence: turn.firstVisibleEventSequence,
      main_ipc_to_provider_write_ms: m.m2 !== undefined ? m.m2 - m.m0 : null,
      provider_event_to_main_dispatch_ms: m.m4 !== undefined && m.m3 !== undefined ? m.m4 - m.m3 : null,
      warm_submit_to_first_text_ms: m.m3 !== undefined && m.m2 !== undefined ? m.m3 - m.m2 : null,
      total_turn_ms: m.terminal - m.m0,
      renderer_event_to_first_paint_ms: paint ? paint.rendererPaintedAt - paint.rendererReceivedAt : null,
      renderer_submit_to_first_paint_ms: paint ? paint.rendererPaintedAt - paint.rendererSubmittedAt : null,
    });
    completed.push(sample);
    if (completed.length > maxSamples) completed.splice(0, completed.length - maxSamples);
    turns.delete(turnId);
    increment('provider_turn_total', { provider: turn.provider, outcome });
    return sample;
  }

  function report() {
    const timingFields = [
      'main_ipc_to_provider_write_ms',
      'provider_event_to_main_dispatch_ms',
      'warm_submit_to_first_text_ms',
      'total_turn_ms',
      'renderer_event_to_first_paint_ms',
      'renderer_submit_to_first_paint_ms',
    ];
    const timings = Object.fromEntries(timingFields.map((field) => [
      field,
      summarize(completed.map((sample) => sample[field])),
    ]));
    return Object.freeze({
      counters: Object.freeze(Object.fromEntries([...counters.entries()].sort(([a], [b]) => a.localeCompare(b)))),
      timings: Object.freeze(timings),
      samples: Object.freeze(completed.slice()),
      activeTurns: turns.size,
    });
  }

  return Object.freeze({ acknowledgePaint, beginTurn, completeTurn, increment, mark, report });
}

module.exports = {
  COUNTER_NAMES,
  createProviderRuntimeMetrics,
  percentile,
  summarize,
};

