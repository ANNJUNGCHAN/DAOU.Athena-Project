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
// 진행봉 접기 — 렌더러·메인 공용 순수 모듈(lib/chart-tick-fold.js).
const { foldTick } = __isCjs
  ? require('./chart-tick-fold')
  : window.AthenaLib.ChartTickFold;
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

// 키움 OHLCV의 +/-는 등락 표기다. JSON 숫자로 오면 부호가 가격에 남고
// 년봉 축이 0 아래로 내려간다(실측: 저가 -25,000 · 마지막 봉이 0에서 현재가까지).
function absPrice(value) {
  const n = finiteOrNull(value);
  return n == null ? null : Math.abs(n);
}

function repairOhlc(open, high, low, close) {
  if (close == null || !(close > 0)) return { open, high, low, close };
  const nextOpen = open == null || !(open > 0) ? close : open;
  let nextHigh = high == null || !(high > 0) ? Math.max(nextOpen, close) : high;
  let nextLow = low == null || !(low > 0) ? Math.min(nextOpen, close) : low;
  nextHigh = Math.max(nextHigh, nextOpen, close);
  nextLow = Math.min(nextLow, nextOpen, close);
  return { open: nextOpen, high: nextHigh, low: nextLow, close };
}

function normalizeChartTime(value, period) {
  if (value == null) return null;
  if ((period === 'tick' || period === 'min') && typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const text = String(value).trim();
  if (period !== 'tick' && period !== 'min') {
    if (period === 'year' && /^\d{4}$/.test(text)) return `${text}-01-01`;
    if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  return text;
}

function normalizeChartCandle(value, period) {
  const candle = value && typeof value === 'object' ? value : {};
  const prices = repairOhlc(
    absPrice(candle.open),
    absPrice(candle.high),
    absPrice(candle.low),
    absPrice(candle.close),
  );
  const volume = absPrice(candle.volume);
  const normalized = {
    time: normalizeChartTime(candle.time, period),
    open: prices.open,
    high: prices.high,
    low: prices.low,
    close: prices.close,
    volume,
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
    candles: (Array.isArray(body.candles) ? body.candles : []).map((candle) => normalizeChartCandle(candle, body.period)),
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
    // reload 계약에 min·tick이 있으면 분·틱 탭을 연다(canvas.js describeAitsChartPanel).
    intradayAvailable: meta.intradayAvailable === true,
    onReloadRequest: meta.onReloadRequest,
    // 좌측 끝에서 과거 페이지를 덧붙일 때 쓴다(화면 교체 아님 — prepend).
    onHistoryRequest: meta.onHistoryRequest,
    onChartLibraryReady: meta.onChartLibraryReady,
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
      // trId를 함께 넘긴다 — 주기를 바꾸면 TR도 바뀌는데(일 ka10081 → 분 ka10080)
      // 표기가 최초 TR에 고정돼 있으면 분봉을 보면서 ka10081이라고 읽힌다(§8).
      // 세분은 호출자가 준 값을 따른다(서버가 쓴 tic_scope). 1로 고정하면
      // 10분을 골라도 툴바가 1분으로 되돌아간다(canvas.js reloadExisting… 주석).
      const interval = Number(meta.interval);
      state.interval = Number.isFinite(interval) && interval > 0 ? interval : 1;
      state.renderer.replaceData(next.candles, {
        period: PERIOD_TO_ATHENA[next.period], interval: state.interval, trId: next.trId,
      });
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
      // 분·틱 세분(tic_scope). 진행봉 접기와 재조회 표기가 같은 값을 본다.
      interval: Number(meta.interval) > 0 ? Number(meta.interval) : 1,
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
    const candle = normalizeChartCandle(delta.candle, state.body.period);
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

  // 실시간 체결 1건을 해당 종목의 열린 패널마다 진행봉으로 접어 넣는다.
  // 접기를 여기 두는 이유: 마지막 봉과 주기를 아는 곳이 이 세션 상태다. 바깥에서
  // 접으려면 봉을 복제해 들고 있어야 하고, 재조회로 봉이 갈릴 때 두 벌이 어긋난다.
  // tick: {symbol, at(epoch초), price, volume}.
  async function applyRealtimeTick(tickInput) {
    const tick = tickInput && typeof tickInput === 'object' ? tickInput : null;
    if (!tick || !tick.symbol) return 0;
    let applied = 0;
    for (const state of Array.from(sessions.values())) {
      if (state.closed || !state.renderer || !state.body) continue;
      if (String(state.stock || '') !== String(tick.symbol)) continue;
      const period = PERIOD_TO_ATHENA[state.body.period];
      if (!period) continue;
      const candles = state.body.candles || [];
      const folded = foldTick(candles[candles.length - 1] || null, tick, period, state.interval || 1);
      if (!folded) continue;
      // applyChartTick이 generation·종목·kind를 다시 검사한다 — 여기서 우회하지 않는다.
      const ok = await applyChartTick(
        state.panelId,
        { kind: folded.kind, stock: state.stock, candle: folded.candle },
        { generation: state.generation }
      ).catch(() => false);
      if (ok) applied += 1;
    }
    return applied;
  }

  // 과거 페이지를 세션 body 앞에 덧붙인다. 봉의 정본은 여기이고, 렌더러는
  // 표시만 맞춘다(prependData) — 두 벌이 어긋나면 재조회·진행봉이 같이 틀어진다.
  // 반환값은 실제로 붙은 개수다. 0이면 더 과거가 없다는 뜻으로 호출자가 멈춘다.
  async function prependHistory(panelId, candlesInput) {
    const state = await settle(sessions.get(panelId) || {});
    const incoming = Array.isArray(candlesInput) ? candlesInput : [];
    if (!incoming.length) return 0;
    const known = new Set(state.body.candles.map((c) => String(c.time)));
    const fresh = [];
    for (const raw of incoming) {
      const candle = normalizeChartCandle(raw, state.body.period);
      if (candle.time == null || known.has(String(candle.time))) continue;
      known.add(String(candle.time));
      fresh.push(candle);
    }
    if (!fresh.length) return 0;
    // 서버가 최신→과거 순으로 주므로 오름차순으로 되돌린다. lightweight-charts는
    // setData에 시간 오름차순을 요구한다.
    fresh.sort((a, b) => (String(a.time) < String(b.time) ? -1 : 1));
    state.body = Object.assign({}, state.body, { candles: fresh.concat(state.body.candles) });
    if (typeof state.renderer.prependData === 'function') state.renderer.prependData(fresh);
    return fresh.length;
  }

  return {
    openPanel,
    reloadPanel,
    applyChartTick,
    applyRealtimeTick,
    prependHistory,
    destroyPanel,
    destroyAll,
    has: (panelId) => sessions.has(panelId),
    size: () => sessions.size,
    snapshot: () => Array.from(sessions.values()).map((state) => ({
      panelId: state.panelId,
      sessionId: state.sessionId,
      scopeId: state.scopeId,
      stock: state.stock,
      // 진행봉·과거조회 검증용 — 양 끝 봉만 복사해 준다(배열 전체는 안 내보낸다).
      lastCandle: state.body.candles.length
        ? Object.assign({}, state.body.candles[state.body.candles.length - 1])
        : null,
      oldestCandle: state.body.candles.length ? Object.assign({}, state.body.candles[0]) : null,
      period: state.body.period,
      interval: state.interval,
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
