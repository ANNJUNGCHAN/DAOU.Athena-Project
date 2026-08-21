(function () {
'use strict';

// AITS chart-panel compatibility authority for Athena.
//
// Authoritative, read-only source observed while implementing this adapter:
//   repository: C:\Projects\DAOU.AITradingSystem
//   branch: release/v1.0.0
//   commit: 50bb5e7a
//   DTO: src/shared/ipc/chart.dto.ts
//   renderer entry: src/common/show-card/show-chart/ChartCard.svelte
//   low-level controller: src/renderer/shared/vm/chart-lwc.ts
//   panel/session authority: src/renderer/screens/canvas/canvas-panel-adapter.ts
// Athena does not import that checkout at runtime.  This module pins its public
// transport-neutral contract and delegates drawing to Athena's one existing
// lightweight-charts controller (ChartCard.createChartCard).  It must never
// create an Electron BrowserWindow or a second chart renderer.

const __isCjs = typeof module !== 'undefined' && module.exports;
const AITS_CHART_RENDERER_ID = 'aits-chart-v1';
const MAX_AITS_CHART_PANELS = 6;
const VALID_PERIODS = new Set(['tick', 'min', 'day', 'week', 'month', 'year']);
const VALID_TARGETS = new Set(['stock', 'sector', 'gold']);
const VALID_TICK_KINDS = new Set(['update', 'rollover']);
const PERIOD_TO_ATHENA = Object.freeze({ tick: 'TICK', min: 'MIN', day: 'D', week: 'W', month: 'M', year: 'Y' });

const AITS_CHART_PROVENANCE = Object.freeze({
  repository: 'C:\\Projects\\DAOU.AITradingSystem',
  branch: 'release/v1.0.0',
  commit: '50bb5e7a',
  sources: Object.freeze([
    'src/shared/ipc/chart.dto.ts',
    'src/common/show-card/show-chart/ChartCard.svelte',
    'src/renderer/shared/vm/chart-lwc.ts',
    'src/renderer/screens/canvas/canvas-panel-adapter.ts',
  ]),
});

function finiteOrNull(value) {
  return value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
}

function normalizeChartCandle(value) {
  const candle = value && typeof value === 'object' ? value : {};
  const normalized = {
    time: candle.time == null ? null : String(candle.time),
    open: finiteOrNull(candle.open),
    high: finiteOrNull(candle.high),
    low: finiteOrNull(candle.low),
    close: finiteOrNull(candle.close),
    volume: finiteOrNull(candle.volume),
  };
  if (Object.prototype.hasOwnProperty.call(candle, 'turnoverAmount')) {
    normalized.turnoverAmount = finiteOrNull(candle.turnoverAmount);
  }
  if (Object.prototype.hasOwnProperty.call(candle, 'turnoverRate')) {
    normalized.turnoverRate = finiteOrNull(candle.turnoverRate);
  }
  return normalized;
}

function normalizeChartCardBody(value) {
  const body = value && typeof value === 'object' ? value : {};
  if (!VALID_PERIODS.has(body.period)) throw new Error(`AITS ChartCardBody.period 오류: ${String(body.period)}`);
  if (!VALID_TARGETS.has(body.target)) throw new Error(`AITS ChartCardBody.target 오류: ${String(body.target)}`);
  if (typeof body.trId !== 'string' || !body.trId.trim()) throw new Error('AITS ChartCardBody.trId가 비어 있다');
  return {
    period: body.period,
    target: body.target,
    trId: body.trId.trim(),
    candles: (Array.isArray(body.candles) ? body.candles : []).map(normalizeChartCandle),
  };
}

// Fixture/manual adapter only. Live REST/MCP must use parseAitsChartSnapshot()
// and may not infer period/target/trId from an operation string.
function fromAthenaChartData(data, context) {
  const source = data && typeof data === 'object' ? data : {};
  const meta = context && typeof context === 'object' ? context : {};
  return normalizeChartCardBody({
    period: source.period,
    target: source.target || meta.target,
    trId: source.trId || source.tr_id || meta.trId,
    candles: source.candles || source.bars || source.ohlcv || [],
  });
}

function requireNonemptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`AITS snapshot.${field}가 비어 있다`);
  return value;
}

function parseAitsChartSnapshot(envelope) {
  const source = envelope && typeof envelope === 'object' ? envelope : {};
  if (source.renderer_id !== AITS_CHART_RENDERER_ID) {
    throw new Error(`AITS renderer_id 불일치: ${String(source.renderer_id)}`);
  }
  const data = source.data && typeof source.data === 'object' ? source.data : {};
  const chart = data.chart && typeof data.chart === 'object' ? data.chart : null;
  if (!chart) throw new Error('AITS snapshot.data.chart가 없다');
  return {
    rendererId: AITS_CHART_RENDERER_ID,
    stock: requireNonemptyString(data.symbol, 'data.symbol'),
    body: normalizeChartCardBody(chart),
  };
}

function panelIdFor(context) {
  const meta = context && typeof context === 'object' ? context : {};
  if (meta.panelId) return String(meta.panelId);
  const correlation = meta.correlation;
  if (correlation && correlation.dataset_id && correlation.item_id && Number.isInteger(correlation.ordinal)) {
    const dataset = String(correlation.dataset_id);
    const item = String(correlation.item_id);
    return `aits:rest:${dataset.length}:${dataset}:${item.length}:${item}:${correlation.ordinal}`;
  }
  if (meta.source === 'fixture') return 'aits:fixture:chart';
  return `aits:live:${meta.target || 'stock'}:${meta.stock || 'unknown'}`;
}

function rendererOptions(body, context) {
  const meta = context || {};
  const initialPeriod = PERIOD_TO_ATHENA[body.period];
  return {
    symbol: meta.stock || meta.symbol || 'UNKNOWN',
    name: meta.name,
    trId: body.trId,
    ohlcv: body.candles,
    initial: { period: initialPeriod },
    preSampled: true,
    onReloadRequest: meta.onReloadRequest,
  };
}

function scopeIdFor(context) {
  const meta = context && typeof context === 'object' ? context : {};
  if (meta.scopeId) return String(meta.scopeId);
  if (meta.correlation && meta.correlation.dataset_id) return `rest:${String(meta.correlation.dataset_id)}`;
  return String(meta.source || 'live');
}

function createAitsChartPanelAdapter(options) {
  const opts = options || {};
  if (typeof opts.renderChart !== 'function') throw new TypeError('renderChart 함수가 필요하다');
  const maxPanels = opts.maxPanels == null ? MAX_AITS_CHART_PANELS : Number(opts.maxPanels);
  if (!Number.isInteger(maxPanels) || maxPanels < 1 || maxPanels > MAX_AITS_CHART_PANELS) {
    throw new RangeError(`AITS 차트 패널은 1..${MAX_AITS_CHART_PANELS}개만 허용한다`);
  }
  const sessions = new Map();

  function publicSession(state) {
    return {
      panelId: state.panelId,
      sessionId: state.sessionId,
      get body() { return state.body; },
      get renderer() { return state.renderer; },
      get generation() { return state.generation; },
      reload: (body, context) => reloadPanel(state.panelId, body, context),
      applyTick: (delta, context) => applyChartTick(state.panelId, delta, context),
      destroy: () => destroyPanel(state.panelId),
    };
  }

  async function settle(state) {
    if (state.mountPromise) await state.mountPromise;
    if (state.closed || !state.renderer) throw new Error(`AITS 차트 패널 세션이 닫혔다: ${state.panelId}`);
    return state;
  }

  async function reloadPanel(panelId, bodyInput, reloadContext) {
    const state = sessions.get(panelId) || {};
    const meta = reloadContext && typeof reloadContext === 'object' ? reloadContext : {};
    const requestedGeneration = meta.generation == null ? (state.nextGeneration || 1) : Number(meta.generation);
    state.nextGeneration = Math.max(state.nextGeneration || 1, requestedGeneration + 1);
    await settle(state);
    if (!Number.isInteger(requestedGeneration) || requestedGeneration <= state.generation) {
      throw new Error(`늦게 도착한 AITS reload 결과를 거부했다: ${panelId} generation=${String(requestedGeneration)}`);
    }
    const next = normalizeChartCardBody(bodyInput);
    const previousPeriod = state.body.period;
    state.body = next;
    if (typeof state.renderer.replaceData === 'function') {
      state.renderer.replaceData(next.candles, { period: PERIOD_TO_ATHENA[next.period], interval: 1 });
    } else {
      if (previousPeriod !== next.period && typeof state.renderer.applyPeriod === 'function') {
        state.renderer.applyPeriod(PERIOD_TO_ATHENA[next.period], 1);
      }
      state.renderer.setData(next.candles);
    }
    state.generation = requestedGeneration;
    state.reloads += 1;
    return publicSession(state);
  }

  async function openPanel(container, bodyInput, context) {
    const meta = context && typeof context === 'object' ? context : {};
    const panelId = panelIdFor(meta);
    if (!panelId) throw new Error('AITS panelId가 비어 있다');
    const existing = sessions.get(panelId);
    if (existing) {
      await settle(existing);
      if (existing.container !== container) {
        throw new Error(`AITS panelId가 다른 DOM 컨테이너에 중복 마운트됐다: ${panelId}`);
      }
      return reloadPanel(panelId, bodyInput, meta);
    }
    const scopeId = scopeIdFor(meta);
    if (scopeId.startsWith('rest:')) {
      const scopeCount = Array.from(sessions.values()).filter((session) => session.scopeId === scopeId).length;
      if (scopeCount >= maxPanels) throw new Error(`AITS 차트 패널은 REST dataset(${scopeId})별 최대 ${maxPanels}개다`);
    }

    const body = normalizeChartCardBody(bodyInput);
    const state = {
      panelId,
      sessionId: `${panelId}:session`,
      scopeId,
      container,
      body,
      stock: String(meta.stock || meta.symbol || ''),
      renderer: null,
      reloads: 0,
      generation: Number.isInteger(Number(meta.generation)) && Number(meta.generation) >= 1 ? Number(meta.generation) : 1,
      nextGeneration: Number.isInteger(Number(meta.generation)) && Number(meta.generation) >= 1 ? Number(meta.generation) + 1 : 2,
      closed: false,
      mountPromise: null,
    };
    sessions.set(panelId, state);
    state.mountPromise = Promise.resolve(opts.renderChart(container, rendererOptions(body, meta)))
      .then((renderer) => {
        if (!renderer || typeof renderer.setData !== 'function' || typeof renderer.destroy !== 'function') {
          throw new Error('AITS 저수준 chart renderer 계약이 올바르지 않다');
        }
        if (state.closed || sessions.get(panelId) !== state) {
          renderer.destroy();
          throw new Error(`늦게 도착한 AITS renderer를 폐기했다: ${panelId}`);
        }
        state.renderer = renderer;
        state.mountPromise = null;
        return renderer;
      })
      .catch((error) => {
        if (sessions.get(panelId) === state) sessions.delete(panelId);
        state.mountPromise = null;
        throw error;
      });
    await state.mountPromise;
    return publicSession(state);
  }

  async function applyChartTick(panelId, deltaInput, tickContext) {
    const state = await settle(sessions.get(panelId) || {});
    const delta = deltaInput && typeof deltaInput === 'object' ? deltaInput : {};
    const generation = Number(tickContext && tickContext.generation);
    if (!Number.isInteger(generation) || generation !== state.generation) return false;
    if (!VALID_TICK_KINDS.has(delta.kind)) throw new Error(`AITS ChartTickDelta.kind 오류: ${String(delta.kind)}`);
    if (String(delta.stock || '') !== state.stock) return false;
    const candle = normalizeChartCandle(delta.candle);
    const candles = state.body.candles.slice();
    if (delta.kind === 'update') {
      if (!candles.length || candles[candles.length - 1].time !== candle.time) return false;
      candles[candles.length - 1] = candle;
    } else {
      if (candles.length && candles[candles.length - 1].time === candle.time) return false;
      candles.push(candle);
    }
    state.body = Object.assign({}, state.body, { candles });
    if (typeof state.renderer.applyChartTick === 'function') {
      state.renderer.applyChartTick(delta.kind, candle);
    } else {
      state.renderer.setData(candles, { fitContent: false });
    }
    return true;
  }

  function destroyPanel(panelId) {
    const state = sessions.get(panelId);
    if (!state) return false;
    sessions.delete(panelId);
    state.closed = true;
    if (state.renderer) state.renderer.destroy();
    return true;
  }

  function destroyAll() {
    for (const panelId of Array.from(sessions.keys())) destroyPanel(panelId);
  }

  return {
    openPanel,
    reloadPanel,
    applyChartTick,
    destroyPanel,
    destroyAll,
    has: (panelId) => sessions.has(panelId),
    size: () => sessions.size,
    snapshot: () => Array.from(sessions.values()).map((state) => ({
      panelId: state.panelId,
      sessionId: state.sessionId,
      scopeId: state.scopeId,
      period: state.body.period,
      target: state.body.target,
      trId: state.body.trId,
      candleCount: state.body.candles.length,
      reloads: state.reloads,
      generation: state.generation,
      mounting: Boolean(state.mountPromise),
    })),
  };
}

const __exports = {
  AITS_CHART_RENDERER_ID,
  AITS_CHART_PROVENANCE,
  MAX_AITS_CHART_PANELS,
  normalizeChartCandle,
  normalizeChartCardBody,
  parseAitsChartSnapshot,
  fromAthenaChartData,
  panelIdFor,
  createAitsChartPanelAdapter,
};
if (__isCjs) module.exports = __exports;
else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.AitsChartPanel = __exports;
}

})();
