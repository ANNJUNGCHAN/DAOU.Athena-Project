'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  AITS_CHART_RENDERER_ID,
  AITS_CHART_PROVENANCE,
  MAX_AITS_CHART_PANELS,
  normalizeChartCandle,
  normalizeChartCardBody,
  parseAitsChartSnapshot,
  fromAthenaChartData,
  panelIdFor,
  createAitsChartPanelAdapter,
} = require('./aits-chart-panel');

function candle(time, close) {
  return { time, open: close - 1, high: close + 1, low: close - 2, close, volume: close * 10 };
}

function body(overrides) {
  return Object.assign({ period: 'day', target: 'stock', trId: 'ka10081', candles: [candle('2026-08-20', 100)] }, overrides);
}

function fakeRendererLog() {
  const calls = [];
  return {
    calls,
    factory: async (container, options) => {
      const renderer = {
        container,
        options,
        setData: (bars, opts) => calls.push(['setData', bars, opts]),
        replaceData: (bars, opts) => calls.push(['replaceData', bars, opts]),
        applyPeriod: (period, interval) => calls.push(['applyPeriod', period, interval]),
        applyChartTick: (kind, bar) => calls.push(['applyChartTick', kind, bar]),
        destroy: () => calls.push(['destroy']),
      };
      calls.push(['render', container, options]);
      return renderer;
    },
  };
}

test('AITS authoritative provenance is pinned without runtime checkout dependency', () => {
  assert.equal(AITS_CHART_PROVENANCE.repository, 'C:\\Projects\\DAOU.AITradingSystem');
  assert.equal(AITS_CHART_PROVENANCE.branch, 'release/v1.0.0');
  assert.equal(AITS_CHART_PROVENANCE.commit, '50bb5e7a');
  assert.deepEqual(AITS_CHART_PROVENANCE.sources, [
    'src/shared/ipc/chart.dto.ts',
    'src/common/show-card/show-chart/ChartCard.svelte',
    'src/renderer/shared/vm/chart-lwc.ts',
    'src/renderer/screens/canvas/canvas-panel-adapter.ts',
  ]);
  assert.equal(Object.isFrozen(AITS_CHART_PROVENANCE), true);
  assert.equal(Object.isFrozen(AITS_CHART_PROVENANCE.sources), true);
});

test('ChartCandle/ChartCardBody normalization matches the AITS DTO shape', () => {
  assert.deepEqual(normalizeChartCandle({
    time: 20260821, open: '10', high: 12, low: 9, close: 11, volume: '100', turnoverAmount: '999', turnoverRate: null,
  }), {
    time: '20260821', open: 10, high: 12, low: 9, close: 11, volume: 100, turnoverAmount: 999, turnoverRate: null,
  });
  assert.deepEqual(normalizeChartCardBody(body()).candles[0], candle('2026-08-20', 100));
  assert.throws(() => normalizeChartCardBody(body({ period: 'quarter' })), /period/);
  assert.throws(() => normalizeChartCardBody(body({ target: 'coin' })), /target/);
  assert.throws(() => normalizeChartCardBody(body({ trId: '' })), /trId/);
});

test('fixture adapter requires explicit period/target/trId without operation inference', () => {
  const chart = fromAthenaChartData({ period: 'week', target: 'sector', trId: 'ka20005', bars: [candle('2026-08-20', 100)] });
  assert.equal(chart.period, 'week');
  assert.equal(chart.target, 'sector');
  assert.equal(chart.trId, 'ka20005');
  assert.equal(chart.candles.length, 1);
  assert.throws(() => fromAthenaChartData({ bars: [] }, { operationRef: 'base:ka20005' }), /period/);
});

test('live envelope accepts only authoritative renderer_id + data.symbol + data.chart', () => {
  const envelope = {
    renderer_id: AITS_CHART_RENDERER_ID,
    data: { symbol: '101V6000', chart: body({ period: 'min', target: 'sector', trId: 'ka20005' }) },
  };
  assert.deepEqual(parseAitsChartSnapshot(envelope), {
    rendererId: AITS_CHART_RENDERER_ID,
    stock: '101V6000',
    body: normalizeChartCardBody(envelope.data.chart),
  });
  assert.throws(() => parseAitsChartSnapshot({ ...envelope, renderer_id: 'legacy-chart' }), /renderer_id 불일치/);
  assert.throws(() => parseAitsChartSnapshot({ renderer_id: AITS_CHART_RENDERER_ID, data: { symbol: 'x' } }), /data.chart/);
  assert.throws(() => parseAitsChartSnapshot({ renderer_id: AITS_CHART_RENDERER_ID, data: { chart: body() } }), /data.symbol/);
});

test('panelId is stable for REST correlation, live stock, and fixture', () => {
  const correlation = { dataset_id: 'd', item_id: 'i', ordinal: 3 };
  assert.equal(panelIdFor({ correlation }), panelIdFor({ correlation }));
  assert.equal(panelIdFor({ source: 'live', target: 'stock', stock: '005930' }), 'aits:live:stock:005930');
  assert.equal(panelIdFor({ source: 'fixture' }), 'aits:fixture:chart');
  assert.notEqual(
    panelIdFor({ correlation: { dataset_id: 'a-b', item_id: 'c', ordinal: 1 } }),
    panelIdFor({ correlation: { dataset_id: 'a', item_id: 'b-c', ordinal: 1 } })
  );
});

test('tick/min snapshots mount pre-sampled without D fallback or pseudo resample', async () => {
  const log = fakeRendererLog();
  const adapter = createAitsChartPanelAdapter({ renderChart: log.factory });
  const epoch = 1787274900;
  await adapter.openPanel({}, body({ period: 'tick', trId: 'ka10079', candles: [candle(epoch, 100)] }), { panelId: 'tick', stock: '005930' });
  await adapter.openPanel({}, body({ period: 'min', trId: 'ka10080', candles: [candle(epoch, 100)] }), { panelId: 'min', stock: '005930' });
  const renders = log.calls.filter((call) => call[0] === 'render');
  assert.equal(renders[0][2].initial.period, 'TICK');
  assert.equal(renders[1][2].initial.period, 'MIN');
  assert.equal(renders[0][2].preSampled, true);
  assert.equal(renders[1][2].preSampled, true);
  assert.equal(renders[0][2].ohlcv[0].time, epoch);
  assert.equal(renders[1][2].ohlcv[0].time, epoch);
});

test('same panel period reload reuses one renderer and one session', async () => {
  const log = fakeRendererLog();
  const adapter = createAitsChartPanelAdapter({ renderChart: log.factory });
  const container = {};
  const first = await adapter.openPanel(container, body(), { panelId: 'chart-1', stock: '005930' });
  const second = await adapter.openPanel(container, body({ period: 'week', trId: 'ka10082', candles: [candle('2026-08-13', 110)] }), { panelId: 'chart-1', stock: '005930' });
  assert.equal(first.sessionId, second.sessionId);
  assert.equal(log.calls.filter((call) => call[0] === 'render').length, 1);
  // trId도 함께 넘어간다 — 주기가 바뀌면 TR도 바뀌므로(일 ka10081 → 주 ka10082)
  // 렌더러가 정직 표기를 새 TR로 갱신할 수 있어야 한다.
  assert.deepEqual(log.calls.find((call) => call[0] === 'replaceData')[2], { period: 'W', interval: 1, trId: 'ka10082' });
  assert.equal(log.calls.filter((call) => call[0] === 'replaceData').length, 1);
  assert.equal(second.body.trId, 'ka10082');
  assert.equal(adapter.snapshot()[0].reloads, 1);
});

test('renderer receives authoritative UI reload callback without local period inference', async () => {
  const log = fakeRendererLog();
  const onReloadRequest = async () => ({ ok: true });
  const adapter = createAitsChartPanelAdapter({ renderChart: log.factory });
  await adapter.openPanel({}, body(), { panelId: 'ui-reload', stock: '005930', onReloadRequest });
  const render = log.calls.find((call) => call[0] === 'render');
  assert.equal(render[2].onReloadRequest, onReloadRequest);
});

test('six-panel cap is isolated per REST dataset/surface', async () => {
  const log = fakeRendererLog();
  const adapter = createAitsChartPanelAdapter({ renderChart: log.factory });
  for (let i = 0; i < 6; i += 1) {
    await adapter.openPanel({}, body(), {
      correlation: { dataset_id: 'dataset-a', item_id: `a-${i}`, ordinal: i + 1 }, stock: `a-${i}`,
    });
  }
  await assert.rejects(() => adapter.openPanel({}, body(), {
    correlation: { dataset_id: 'dataset-a', item_id: 'a-7', ordinal: 7 }, stock: 'a-7',
  }), /REST dataset\(rest:dataset-a\).*최대 6개/);
  await adapter.openPanel({}, body(), {
    correlation: { dataset_id: 'dataset-b', item_id: 'b-1', ordinal: 1 }, stock: 'b-1',
  });
  await adapter.openPanel({}, body(), { source: 'fixture', panelId: 'fixture-independent', stock: 'fixture' });
  assert.equal(adapter.size(), 8);
});

test('reload generation rejects a stale late result', async () => {
  const log = fakeRendererLog();
  const adapter = createAitsChartPanelAdapter({ renderChart: log.factory });
  const session = await adapter.openPanel({}, body(), { panelId: 'generation', stock: '005930', generation: 4 });
  await session.reload(body({ trId: 'ka10082', period: 'week' }), { generation: 6 });
  assert.equal(session.generation, 6);
  assert.equal(session.body.trId, 'ka10082');
  assert.equal(log.calls.filter((call) => call[0] === 'replaceData').length, 1);
});

test('MCP/fixture panels do not consume a REST dataset quota', async () => {
  const log = fakeRendererLog();
  const adapter = createAitsChartPanelAdapter({ renderChart: log.factory });
  for (let i = 0; i < MAX_AITS_CHART_PANELS; i += 1) {
    await adapter.openPanel({}, body(), { panelId: `chart-${i}`, stock: String(i) });
  }
  await adapter.openPanel({}, body(), { panelId: 'chart-6', stock: '6' });
  assert.equal(adapter.size(), 7);
  assert.equal(log.calls.filter((call) => call[0] === 'render').length, 7);
});

test('ChartTickDelta updates/rolls over in-place, preserving renderer identity', async () => {
  const log = fakeRendererLog();
  const adapter = createAitsChartPanelAdapter({ renderChart: log.factory });
  const session = await adapter.openPanel({}, body(), { panelId: 'tick-panel', stock: '005930' });
  assert.equal(await session.applyTick({ kind: 'update', stock: '000660', candle: candle('2026-08-20', 101) }, { generation: 1 }), false);
  assert.equal(await session.applyTick({ kind: 'update', stock: '005930', candle: candle('2026-08-20', 101) }, { generation: 0 }), false);
  assert.equal(await session.applyTick({ kind: 'update', stock: '005930', candle: candle('2026-08-20', 101) }, { generation: 1 }), true);
  assert.equal(await session.applyTick({ kind: 'rollover', stock: '005930', candle: candle('2026-08-21', 102) }, { generation: 1 }), true);
  assert.equal(log.calls.filter((call) => call[0] === 'render').length, 1);
  assert.deepEqual(log.calls.filter((call) => call[0] === 'applyChartTick').map((call) => call[1]), ['update', 'rollover']);
  assert.equal(session.body.candles.length, 2);
  assert.equal(session.body.candles[0].close, 101);
});

test('reload replaces controller authority before a following tick delta', async () => {
  const log = fakeRendererLog();
  const adapter = createAitsChartPanelAdapter({ renderChart: log.factory });
  const session = await adapter.openPanel({}, body(), { panelId: 'replace-then-tick', stock: '005930' });
  await session.reload(body({ candles: [candle('2026-08-21', 200)] }));
  assert.equal(await session.applyTick({ kind: 'update', stock: '005930', candle: candle('2026-08-21', 201) }, { generation: session.generation }), true);
  assert.equal(session.body.candles[0].close, 201);
  const replaceIndex = log.calls.findIndex((call) => call[0] === 'replaceData');
  const tickIndex = log.calls.findIndex((call) => call[0] === 'applyChartTick');
  assert.ok(replaceIndex >= 0 && tickIndex > replaceIndex);
});

test('destroy during async mount disposes the late renderer and leaves no session', async () => {
  let resolveRenderer;
  let destroys = 0;
  const adapter = createAitsChartPanelAdapter({
    renderChart: () => new Promise((resolve) => { resolveRenderer = resolve; }),
  });
  const opening = adapter.openPanel({}, body(), { panelId: 'late', stock: '005930' });
  assert.equal(adapter.destroyPanel('late'), true);
  resolveRenderer({ setData() {}, destroy() { destroys += 1; } });
  await assert.rejects(opening, /늦게 도착한/);
  assert.equal(destroys, 1);
  assert.equal(adapter.size(), 0);
});

test('concurrent same-panel reload waits for one mount and never creates a duplicate renderer', async () => {
  let resolveRenderer;
  let renderCount = 0;
  const calls = [];
  const adapter = createAitsChartPanelAdapter({
    renderChart: () => {
      renderCount += 1;
      return new Promise((resolve) => { resolveRenderer = () => resolve({
        setData() {},
        replaceData: (bars) => calls.push(bars),
        destroy() {},
      }); });
    },
  });
  const container = {};
  const first = adapter.openPanel(container, body(), { panelId: 'one-mount', stock: '005930', generation: 1 });
  const second = adapter.openPanel(container, body({ candles: [candle('2026-08-21', 200)] }), { panelId: 'one-mount', stock: '005930', generation: 2 });
  resolveRenderer();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(renderCount, 1);
  assert.equal(a.sessionId, b.sessionId);
  assert.equal(b.generation, 2);
  assert.equal(calls.length, 1);
});

test('all Athena chart entry points are statically locked to the AITS adapter', () => {
  const canvas = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'shell.html'), 'utf8');
  const lowLevel = fs.readFileSync(path.join(__dirname, 'chart-card.js'), 'utf8');
  assert.match(canvas, /createAitsChartPanelAdapter\(\{ renderChart: createChartCard, maxPanels: 6 \}\)/);
  assert.equal((canvas.match(/createChartCard\(/g) || []).length, 0, 'entry point must not call low-level renderer directly');
  assert.match(canvas, /async function renderLiveChart[\s\S]*mountAitsChartPanel/);
  assert.match(canvas, /async function renderChartCard[\s\S]*mountAitsChartPanel/);
  assert.match(canvas, /athena:add-rest-canvas[\s\S]*addLiveCard/);
  assert.match(canvas, /athena:add-canvas-live[\s\S]*addLiveCard/);
  assert.ok(html.indexOf('lib/chart-card.js') < html.indexOf('lib/aits-chart-panel.js'));
  assert.ok(html.indexOf('lib/aits-chart-panel.js') < html.indexOf('<script src="canvas.js"'));
  // shell.js는 canvas.js보다 먼저 와야 한다 — canvas.js가 window.AthenaShell을 쓴다.
  assert.ok(html.indexOf('<script src="shell.js"') < html.indexOf('<script src="canvas.js"'));
  assert.doesNotMatch(canvas, /new\s+BrowserWindow/);
  assert.match(canvas, /render_state: card[\s\S]*renderer_id:[\s\S]*panel_id:[\s\S]*generation:/);
  assert.match(canvas, /renderRestStateCard[\s\S]*dataset\.renderState = envelope\.state === 'timeout' \? 'timeout' : 'error'/);
  assert.match(canvas, /renderer_id: null,[\s\S]*panel_id: null,[\s\S]*generation: null/);
  assert.match(canvas, /function enforceHeightBudget[\s\S]*destroyCard\(cards\[0\]\)/);
  assert.match(canvas, /cardDestroyers\.set\(card,[\s\S]*athena:chart-panel-destroyed/);
  assert.match(canvas, /athena:reload-chart-panel/);
  assert.match(canvas, /beforeunload[\s\S]*aitsChartPanels\.destroyAll/);
  assert.match(lowLevel, /function replaceData[\s\S]*dailyBars = [\s\S]*currentBars = dailyBars\.slice/);
  const tickBody = lowLevel.slice(lowLevel.indexOf('function applyChartTick'), lowLevel.indexOf('// 기본 on'));
  assert.match(tickBody, /priceSeries\.update/);
  assert.match(tickBody, /volumeSeries\.update/);
  assert.doesNotMatch(tickBody, /setData\(/);
  assert.match(lowLevel, /onPeriodChange: \(period, interval\) => requestAuthoritativeReload/);
  assert.match(lowLevel, /onAdjustedToggle: \(adjustedOn\) => requestAuthoritativeReload/);
  assert.match(lowLevel, /const __loadChartLibrary = createCachedChartLibraryLoader/);
  assert.match(lowLevel, /if \(!__isCjs && typeof document !== 'undefined'\)[\s\S]*__loadChartLibrary\(\)/);
  assert.match(lowLevel, /await __loadChartLibrary\(\)/);
});
