'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createAitsChartPanelAdapter } = require('./aits-chart-panel');

const canvas = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
const refreshSource = canvas.slice(
  canvas.indexOf('const BOARD_CHART_REFRESH_MS'),
  canvas.indexOf('function beginBoardChartMount'),
);

async function harness() {
  const candle = (price) => ({
    time: Date.UTC(2026, 8, 9, 5, 30) / 1000,
    open: price, high: price + 10, low: price - 10, close: price, volume: 12,
  });
  const body = { period: 'min', target: 'gold', trId: 'ka50092', candles: [candle(189000)] };
  const adapter = createAitsChartPanelAdapter({ renderChart: async () => ({
    setData() {}, replaceData() {}, applyPeriod() {}, destroy() {},
  }) });
  const panel = await adapter.openPanel({}, body, {
    panelId: 'gold-refresh-test', stock: 'M04020000', interval: 5,
  });
  const nodes = { status: { textContent: '' }, badge: { textContent: '' }, change: { style: {} } };
  const host = {
    isConnected: true, hidden: false, ancestorHidden: false, dataset: {},
    closest() { return this.ancestorHidden ? {} : null; },
    querySelector(selector) {
      if (selector.includes('3HF1-0')) return nodes.status;
      if (selector.includes('2ROB-1')) return nodes.badge;
      if (selector.includes('2RO7-1')) return nodes.change;
      return null;
    },
  };
  const state = {
    boardId: '2RJ7-1', primaryPanelId: panel.panelId, surface: host,
    mountContract: {}, valuesByBoard: new Map(), values: {
      s052: '191170',
      s005: { composite: { separator: ' · ', parts: [
        { f: 'pred_pre', value: -2170 }, { f: 'flu_rt', value: -1.14 },
      ] } },
    },
  };
  const calls = [];
  const applied = [];
  const timers = new Map();
  let timerId = 0;
  let failNext = false;
  const context = vm.createContext({
    aitsChartPanels: adapter, document: { hidden: false },
    PERIOD_TO_ATHENA_UI: { min: 'MIN' },
    boardMount: { applyRealtimeSlots: (_surface, _contract, values, touched) => {
      applied.push({ price: values.s004, touched: Array.from(touched) });
    } },
    window: { athena: { invoke: async (channel, request) => {
      calls.push({ channel, ...request });
      if (failNext) { failNext = false; return { ok: false, error: 'upstream unavailable' }; }
      return { ok: true, generation: request.generation + 1, candles: [candle(189000 + calls.length * 10)] };
    } } },
    setTimeout: (fn, delay) => { assert.equal(delay, 15000); timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(refreshSource, context);
  const descriptor = { panelId: panel.panelId, body, context: { operationArgs: { tic_scope: '1' } } };
  return {
    adapter, host, state, calls, applied, nodes, timers, context, descriptor,
    start: () => context.startBoardChartRefresh(host, state, descriptor),
    fail: () => { failNext = true; },
    tick: async () => {
      const next = timers.entries().next().value;
      assert.ok(next, 'automatic refresh must schedule its next attempt');
      timers.delete(next[0]);
      await next[1]();
    },
  };
}

test('gold automatic refresh updates the real adapter and quote twice, preserving the selected interval', async () => {
  const h = await harness();
  assert.equal(h.start(), true);
  await h.tick();
  await h.tick();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls.map((x) => x.generation), [1, 2]);
  assert.deepEqual(h.calls.map((x) => x.interval), [5, 5]);
  assert.ok(h.calls.every((x) => x.channel === 'athena:refresh-chart-panel'));
  const snapshot = h.adapter.snapshot()[0];
  assert.equal(snapshot.generation, 3);
  assert.equal(snapshot.lastCandle.close, 189020);
  assert.equal(snapshot.target, 'gold');
  assert.equal(snapshot.trId, 'ka50092');
  assert.equal(h.state.values.s004, 189020);
  assert.equal(h.state.values.s006, '20260909143000');
  assert.equal(h.state.values.s005.composite.parts[0].value, -2150);
  assert.equal(h.applied.length, 2);
  assert.equal(h.nodes.change.style.color, 'var(--color-down)');
  assert.match(h.nodes.status.textContent, /마지막 갱신/);
});

test('gold refresh pauses on inactive tabs, resumes, and stops after the card is removed', async () => {
  const h = await harness();
  h.start();
  h.host.ancestorHidden = true;
  await h.tick();
  assert.equal(h.calls.length, 0);
  h.host.ancestorHidden = false;
  await h.tick();
  assert.equal(h.calls.length, 1);
  h.host.isConnected = false;
  await h.tick();
  assert.equal(h.calls.length, 1);
  assert.equal(h.timers.size, 0);
});

test('failed gold reads keep generation intact and retry without manufacturing a quote', async () => {
  const h = await harness();
  h.start();
  h.fail();
  await h.tick();
  assert.equal(h.adapter.snapshot()[0].generation, 1);
  assert.equal(h.applied.length, 0);
  assert.match(h.nodes.status.textContent, /지연/);
  await h.tick();
  assert.deepEqual(h.calls.map((x) => x.generation), [1, 1]);
  assert.equal(h.adapter.snapshot()[0].generation, 2);
});

test('gold-only polling does not start for stock boards or non-gold chart data', async () => {
  const h = await harness();
  h.state.boardId = '137X-2';
  assert.equal(h.start(), false);
  h.state.boardId = '2RJ7-1';
  h.descriptor.body.target = 'stock';
  assert.equal(h.start(), false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.calls.length, 0);
});
