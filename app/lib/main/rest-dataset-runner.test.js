'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MAX_CONCURRENCY,
  STOCK_ENTITY_RESOLVER_ADAPTER_VERSION,
  REVIEWED_MARKET_ENTITY_KIND,
  StockEntityIndex,
  buildQuoteDataset,
  buildChartDataset,
  buildOrderBookDataset,
  buildInvestorFlowDataset,
  buildTradingSourceDataset,
  buildStockInfoDataset,
  buildProgramTradeDataset,
  refreshStockEntityIndex,
  normalizeDataset,
  normalizeRecommendations,
  runRestDataset,
} = require('./rest-dataset-runner');

const RESOLVER_VECTOR_PATH = path.resolve(
  __dirname,
  '../../../backend/tests/fixtures/stock_entity_resolver_conformance.json',
);
const RESOLVER_VECTOR = JSON.parse(fs.readFileSync(RESOLVER_VECTOR_PATH, 'utf8'));

function resolverRecords() {
  return RESOLVER_VECTOR.records.map((record) => ({
    ...record,
    market: RESOLVER_VECTOR.record_markets[record.code],
  }));
}

function response(body, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function canonicalInline(request, operationRef, envelopeData = { fields: [] }, extra = {}) {
  const correlation = {
    dataset_id: request.dataset_id,
    item_id: request.item_id,
    ordinal: request.ordinal,
  };
  return {
    delivery: 'inline',
    queued: false,
    status: 'rendered',
    operation_ref: operationRef,
    canvas_type: 'facts',
    screen_id: 'facts-test-screen',
    correlation,
    envelope: {
      canvas_type: 'facts',
      screen_id: 'facts-test-screen',
      fell_back: false,
      fallback_reason: null,
      caption: null,
      data: envelopeData,
      layout: null,
      drop_types: [],
      correlation,
    },
    receipt: {
      pushed: true,
      delivery: 'inline',
      canvas_type: 'facts',
      fell_back: false,
      fallback_reason: null,
      trimmed: false,
      partial: false,
      cache_reused: false,
    },
    timing: { server_ms: 5, call_ms: 3, transform_ms: 1, delivery_ms: 1 },
    next_actions: [],
    ...extra,
  };
}

function dataset(count = 1) {
  return {
    datasetId: 'd-1',
    question: '005930 현재가',
    items: Array.from({ length: count }, (_, index) => ({
      itemId: `i-${index + 1}`,
      ordinal: index + 1,
      operationRef: index ? `base:ka10${String(99 + index).padStart(3, '0')}` : 'detail:ka10001:current_trading',
      args: { stk_cd: String(5930 + index).padStart(6, '0') },
    })),
  };
}

function successfulFetch({ dataByOrdinal } = {}) {
  const calls = [];
  const operationByPlan = new Map();
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    if (url.endsWith('/resolve')) {
      const planToken = `plan-${calls.length}`;
      operationByPlan.set(planToken, body.question);
      return response({ plan_token: planToken });
    }
    const operationRef = operationByPlan.get(body.plan_token);
    return response(canonicalInline(body, operationRef, dataByOrdinal && dataByOrdinal[body.ordinal]));
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('exact direct lane uses only resolve and inline render-plan, then emits paint ack', async () => {
  const fetchImpl = successfulFetch({ dataByOrdinal: { 1: { fields: [{ key: 'cur_prc', label: '현재가', value: '73500' }] } } });
  const emitted = [];
  const result = await runRestDataset({
    dataset: dataset(),
    backendBase: 'http://backend',
    fetchImpl,
    emitCanvas: async (payload) => {
      emitted.push(payload);
      return {
        verifiedVisible: true, visiblePaintAt: payload.requestStartedAt + 25,
        inlineToChartImportMs: 0, chartImportToDomMs: 2, inlineToDomMs: 2, domToPaintAckMs: 3,
      };
    },
  });
  assert.equal(result.ok, true);
  assert.ok(Math.abs(result.firstCanvasMs - 25) < 1e-9,
    `firstCanvasMs must be approximately 25ms, got ${result.firstCanvasMs}`);
  assert.equal(result.answerText, '캔버스에 표시했습니다.');
  assert.equal(result.answer.modelCalls, 0);
  assert.equal(result.answer.payloadTokensLeaked, false);
  assert.equal(result.forbiddenCalls.mcp, 0);
  assert.equal(result.forbiddenCalls.claude, 0);
  assert.equal(result.forbiddenCalls.ws, 0);
  assert.deepEqual(fetchImpl.calls.map((call) => new URL(call.url).pathname), [
    '/api/v1/llm/tools/resolve',
    '/api/v1/canvas/render-plan',
  ]);
  assert.equal(fetchImpl.calls[1].body.delivery, 'inline');
  assert.equal(fetchImpl.calls[0].body.question, 'detail:ka10001:current_trading');
  assert.equal(fetchImpl.calls[0].body.intent, 'query');
  assert.equal('preferred_ref' in fetchImpl.calls[0].body, false);
  assert.equal('candidate_refs' in fetchImpl.calls[0].body, false);
  assert.equal('canvas_type' in fetchImpl.calls[1].body, false);
  assert.equal('data' in fetchImpl.calls[1].body, false);
  assert.equal(emitted[0].envelope.data.fields[0].value, '73500');
  assert.equal(result.answerText.includes('73500'), false);
  assert.equal(result.answerText.includes('현재가'), false);
  assert.deepEqual(result.canvases[0].stageMs, {
    requestToInlineMs: result.canvases[0].stageMs.requestToInlineMs,
    inlineToChartImportMs: 0,
    chartImportToDomMs: 2,
    inlineToDomMs: 2,
    domToPaintAckMs: 3,
    totalMs: result.canvases[0].stageMs.totalMs,
  });
});

test('visible AITS renderer error is feedback, never a successful data canvas', async () => {
  const result = await runRestDataset({
    dataset: dataset(),
    backendBase: 'http://backend',
    fetchImpl: successfulFetch(),
    emitCanvas: async (payload) => ({
      verifiedVisible: true,
      visiblePaintAt: payload.requestStartedAt + 20,
      renderState: 'error',
      rendererId: 'aits-chart-v1',
      panelId: 'panel-1',
      generation: 1,
    }),
  });
  assert.equal(result.feedbackOk, true);
  assert.equal(result.ok, false);
  assert.equal(result.dataCanvasCount, 0);
  assert.equal(result.canvases[0].renderState, 'error');
  assert.equal(result.canvases[0].rendererId, 'aits-chart-v1');
  assert.equal(result.canvases[0].panelId, 'panel-1');
  assert.equal(result.canvases[0].generation, 1);
});

test('render-plan deadline uses the remaining three-second budget with paint reserve', async () => {
  let now = 10_000;
  let renderRequest = null;
  const input = dataset();
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/resolve')) {
      now += 350;
      return response({ plan_token: 'p-budget' });
    }
    renderRequest = body;
    return response(canonicalInline(body, input.items[0].operationRef));
  };
  const result = await runRestDataset({
    dataset: input,
    backendBase: 'http://backend',
    fetchImpl,
    clock: () => now,
    emitCanvas: async () => ({ verifiedVisible: true, visiblePaintAt: now + 20 }),
  });
  assert.equal(result.ok, true);
  assert.equal(renderRequest.deadline_ms, 1500);
});

test('render-plan deadline never drops below the backend minimum', async () => {
  let now = 20_000;
  let renderRequest = null;
  const input = dataset();
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/resolve')) {
      now += 2950;
      return response({ plan_token: 'p-min-budget' });
    }
    renderRequest = body;
    return response(canonicalInline(body, input.items[0].operationRef));
  };
  await runRestDataset({
    dataset: input,
    backendBase: 'http://backend',
    fetchImpl,
    clock: () => now,
    emitCanvas: async () => ({ verifiedVisible: true, visiblePaintAt: now + 20 }),
  });
  assert.equal(renderRequest.deadline_ms, 100);
});

test('primary admission control paints normal data but turns slower work into an authoritative timeout before 3s', async () => {
  async function runProfile(latencyMs) {
    const input = dataset();
    let renderDeadline = null;
    let emitted = 0;
    const fetchImpl = async (url, options) => {
      const body = JSON.parse(options.body);
      if (url.endsWith('/resolve')) return response({ plan_token: `p-${latencyMs}` });
      renderDeadline = body.deadline_ms;
      if (latencyMs <= body.deadline_ms) {
        return response(canonicalInline(body, input.items[0].operationRef));
      }
      const correlation = { dataset_id: body.dataset_id, item_id: body.item_id, ordinal: body.ordinal };
      return response({
        delivery: 'inline', queued: false, status: 'error_rendered', code: 'UPSTREAM_TIMEOUT',
        operation_ref: input.items[0].operationRef, canvas_type: 'facts', screen_id: 'facts-test-screen',
        correlation,
        envelope: {
          canvas_type: 'facts', screen_id: 'facts-test-screen', state: 'timeout',
          fell_back: false, fallback_reason: null, caption: null, layout: null, drop_types: [],
          correlation, error: { code: 'UPSTREAM_TIMEOUT', retryable: true },
        },
        receipt: {
          pushed: true, delivery: 'inline', canvas_type: 'facts', screen_id: 'facts-test-screen',
          state: 'timeout', error_code: 'UPSTREAM_TIMEOUT',
        },
        timing: { server_ms: body.deadline_ms }, next_actions: [],
      });
    };
    const result = await runRestDataset({
      dataset: input,
      backendBase: 'http://backend',
      fetchImpl,
      emitCanvas: async (payload) => {
        emitted += 1;
        return { verifiedVisible: true, visiblePaintAt: payload.requestStartedAt + renderDeadline + 100 };
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { result, renderDeadline, emitted };
  }

  const fast = await runProfile(1200);
  assert.equal(fast.renderDeadline, 1500);
  assert.equal(fast.result.dataCanvasCount, 1);
  assert.equal(fast.result.firstCanvasMs, 1600);

  const slow = await runProfile(2400);
  assert.equal(slow.renderDeadline, 1500);
  assert.equal(slow.result.dataCanvasCount, 0);
  assert.equal(slow.result.stateCanvasCount, 1);
  assert.equal(slow.result.canvases[0].state, 'timeout');
  assert.equal(slow.result.firstFeedbackMs, 1600);
  assert.equal(slow.emitted, 1);
  assert.equal(slow.result.lateCanvases, 0);

  const overDeadline = await runProfile(3001);
  assert.equal(overDeadline.renderDeadline, 1500);
  assert.equal(overDeadline.result.dataCanvasCount, 0);
  assert.equal(overDeadline.result.stateCanvasCount, 1);
  assert.equal(overDeadline.result.canvases[0].state, 'timeout');
  assert.equal(overDeadline.result.firstFeedbackMs, 1600);
  assert.equal(overDeadline.emitted, 1);
  assert.equal(overDeadline.result.lateCanvases, 0);
});

test('HTTP failures preserve backend status, code and detail for diagnostics', async () => {
  const input = dataset();
  const fetchImpl = async (url) => {
    if (url.endsWith('/resolve')) return response({ plan_token: 'p-http-detail' });
    return response({ detail: { code: 'CANVAS_COVERAGE_MISSING', message: 'screen mapping unavailable' } }, 422);
  };
  const result = await runRestDataset({
    dataset: input,
    backendBase: 'http://backend',
    fetchImpl,
  });
  assert.equal(result.errors[0].code, 'render-plan_http');
  assert.equal(result.errors[0].httpStatus, 422);
  assert.equal(result.errors[0].backendCode, 'CANVAS_COVERAGE_MISSING');
  assert.equal(result.errors[0].backendMessage, 'screen mapping unavailable');
  assert.match(result.errors[0].message, /CANVAS_COVERAGE_MISSING/);
});

test('generic dataset questions with one through six screens mint every item by exact operation identity', async () => {
  for (let count = 1; count <= 6; count += 1) {
    const input = dataset(count);
    input.question = '서로 다른 화면을 한 번에 보여주는 일반 설명형 데이터셋 질문';
    const fetchImpl = successfulFetch();
    const result = await runRestDataset({
      dataset: input,
      backendBase: 'http://backend',
      fetchImpl,
      emitCanvas: async (payload) => ({
        verifiedVisible: true,
        visiblePaintAt: payload.requestStartedAt + payload.ordinal,
      }),
    });
    const resolves = fetchImpl.calls.filter((call) => call.url.endsWith('/resolve'));
    assert.equal(result.canvases.length, count);
    assert.deepEqual(resolves.map((call) => call.body.question), input.items.map((item) => item.operationRef));
    assert.equal(resolves.every((call) => call.body.intent === 'query'), true);
    assert.equal(resolves.every((call) => !('preferred_ref' in call.body) && !('candidate_refs' in call.body)), true);
  }
});

test('primary paints before secondary pool starts and remaining concurrency never exceeds 3', async () => {
  const input = dataset(6);
  let active = 0;
  let maxActive = 0;
  const events = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/resolve')) return response({ plan_token: `p-${body.question}` });
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, body.ordinal === 1 ? 2 : 15));
    active -= 1;
    const operationRef = input.items[body.ordinal - 1].operationRef;
    return response(canonicalInline(body, operationRef));
  };
  const result = await runRestDataset({
    dataset: input,
    backendBase: 'http://backend',
    fetchImpl,
    emitCanvas: async (payload) => {
      events.push(`paint-${payload.ordinal}`);
      return { verifiedVisible: true, visiblePaintAt: payload.requestStartedAt + 20 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(events[0], 'paint-1');
  assert.equal(maxActive <= MAX_CONCURRENCY, true);
  assert.equal(result.renderedCount, 6);
});

test('secondary cards receive independent bounded paint deadlines after first feedback', async () => {
  const input = dataset(6);
  let now = 30_000;
  const payloads = [];
  const result = await runRestDataset({
    dataset: input,
    backendBase: 'http://backend',
    fetchImpl: successfulFetch(),
    clock: () => now,
    emitCanvas: async (payload) => {
      payloads.push(payload);
      if (payload.ordinal === 1) now += 2800;
      return { verifiedVisible: true, visiblePaintAt: now };
    },
  });
  assert.equal(result.renderedCount, 6);
  assert.equal(payloads[0].firstFeedbackPending, true);
  assert.equal(payloads[0].paintDeadlineAt, payloads[0].requestStartedAt + 3000);
  for (const payload of payloads.slice(1)) {
    assert.equal(payload.firstFeedbackPending, false);
    assert.equal(payload.paintDeadlineAt, payload.inlineAt + 3000);
    assert.equal(payload.paintDeadlineAt > payload.requestStartedAt + 3000, true);
  }
});

test('slow primary does not consume secondary render-plan budgets or data results', async () => {
  const input = dataset(6);
  let now = 40_000;
  const renderDeadlines = [];
  const operationByPlan = new Map();
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/resolve')) {
      const planToken = `p-${body.question}`;
      operationByPlan.set(planToken, body.question);
      return response({ plan_token: planToken });
    }
    renderDeadlines.push({ ordinal: body.ordinal, deadlineMs: body.deadline_ms });
    return response(canonicalInline(body, operationByPlan.get(body.plan_token)));
  };
  const result = await runRestDataset({
    dataset: input,
    backendBase: 'http://backend',
    fetchImpl,
    clock: () => now,
    emitCanvas: async (payload) => {
      if (payload.ordinal === 1) now += 2800;
      return { verifiedVisible: true, visiblePaintAt: now };
    },
  });
  assert.equal(result.dataCanvasCount, 6);
  assert.equal(renderDeadlines.find((item) => item.ordinal === 1).deadlineMs, 1500);
  assert.deepEqual(
    renderDeadlines.filter((item) => item.ordinal > 1).map((item) => item.deadlineMs),
    [2700, 2700, 2700, 2700, 2700],
  );
});

test('single-flight reuses one physical Kiwoom call while preserving distinct card correlation', async () => {
  const input = dataset(2);
  input.items[1].operationRef = input.items[0].operationRef;
  input.items[1].args = { ...input.items[0].args };
  const fetchImpl = successfulFetch();
  const emitted = [];
  const result = await runRestDataset({
    dataset: input,
    backendBase: 'http://backend',
    fetchImpl,
    emitCanvas: async (payload) => {
      emitted.push(payload);
      return { verifiedVisible: true, visiblePaintAt: payload.requestStartedAt + 20 };
    },
  });
  assert.equal(result.physicalCalls, 1);
  assert.equal(fetchImpl.calls.length, 2);
  assert.deepEqual(emitted.map((item) => item.itemId), ['i-1', 'i-2']);
  assert.deepEqual(emitted.map((item) => item.envelope.correlation.ordinal), [1, 2]);
});

test('partial failure is truthful and never uses the success receipt', async () => {
  const input = dataset(2);
  let renderCount = 0;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/resolve')) return response({ plan_token: `p-${body.question}` });
    renderCount += 1;
    if (renderCount === 2) return response({ detail: 'upstream failed' }, 503);
    return response(canonicalInline(body, input.items[0].operationRef));
  };
  const result = await runRestDataset({
    dataset: input,
    backendBase: 'http://backend',
    fetchImpl,
    emitCanvas: async (payload) => ({ verifiedVisible: true, visiblePaintAt: payload.requestStartedAt + 20 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.renderedCount, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.answerText, /일부 결과/);
  assert.notEqual(result.answerText, '캔버스에 표시했습니다.');
});

test('first-canvas deadline exposes an explicit retryable timeout and retry advances dataset generation', async () => {
  const input = dataset();
  input.firstCanvasDeadlineMs = 10;
  let emitted = 0;
  const fetchImpl = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  const result = await runRestDataset({
    dataset: input,
    backendBase: 'http://backend',
    fetchImpl,
    emitCanvas: async () => { emitted += 1; },
    retryIdFactory: () => 'd-retry-1',
  });
  assert.equal(result.ok, false);
  assert.equal(emitted, 0);
  assert.equal(result.state, 'timeout');
  assert.equal(result.retryable, true);
  assert.deepEqual(result.localState, {
    state: 'timeout',
    errorCode: 'LOCAL_FIRST_CANVAS_TIMEOUT',
    retryable: true,
  });
  assert.match(result.answerText, /시간이 초과/);
  assert.equal(result.retryAction.type, 'retry-rest-dataset');
  assert.equal(result.retryAction.dataset.datasetId, 'd-retry-1');
  assert.equal(result.retryAction.dataset.generation, 2);
  assert.equal(result.retryAction.dataset.items[0].itemId, 'd-retry-1-1');

  const retryFetch = successfulFetch();
  const retried = await runRestDataset({
    dataset: result.retryAction.dataset,
    backendBase: 'http://backend',
    fetchImpl: retryFetch,
    emitCanvas: async (payload) => ({
      verifiedVisible: true,
      visiblePaintAt: payload.requestStartedAt + 5,
      generation: result.retryAction.dataset.generation,
    }),
  });
  assert.equal(retried.ok, true);
  assert.equal(retried.datasetId, 'd-retry-1');
  assert.equal(retried.generation, 2);
  assert.equal(retried.canvases[0].generation, 2);
  assert.equal(retryFetch.calls[1].body.dataset_id, 'd-retry-1');
  assert.equal(retried.retryAction, null);
});

test('fetch failure before the first card is an explicit retryable local error', async () => {
  const result = await runRestDataset({
    dataset: dataset(),
    backendBase: 'http://backend',
    fetchImpl: async () => { throw new Error('network unavailable'); },
    retryIdFactory: () => 'd-retry-error',
  });
  assert.equal(result.renderedCount, 0);
  assert.equal(result.state, 'error');
  assert.equal(result.retryable, true);
  assert.equal(result.localState.errorCode, 'LOCAL_REQUEST_FAILED');
  assert.equal(result.retryAction.dataset.datasetId, 'd-retry-error');
  assert.equal(result.retryAction.dataset.generation, 2);
  assert.equal(result.retryAction.verifiedQueryOnly, false);
  assert.match(result.answerText, /오류가 발생/);
});

test('retry authority is granted only after every query operation receives a signed plan', async () => {
  const input = dataset();
  input.firstCanvasDeadlineMs = 10;
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/resolve')) return response({ plan_token: 'signed-query-plan' });
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  };
  const result = await runRestDataset({
    dataset: input,
    backendBase: 'http://backend',
    fetchImpl,
    retryIdFactory: () => 'd-retry-signed',
  });
  assert.equal(result.state, 'timeout');
  assert.equal(result.retryAction.verifiedQueryOnly, true);
});

test('user cancellation falls back to cancelled only when no authoritative response arrives', async () => {
  const controller = new AbortController();
  controller.abort(new Error('user cancelled'));
  const result = await runRestDataset({
    dataset: dataset(),
    backendBase: 'http://backend',
    signal: controller.signal,
    fetchImpl: async () => { throw new Error('transport closed before response'); },
    retryIdFactory: () => 'd-retry-cancelled',
  });
  assert.equal(result.renderedCount, 0);
  assert.equal(result.state, 'cancelled');
  assert.equal(result.localState.errorCode, 'LOCAL_REQUEST_CANCELLED');
  assert.equal(result.retryAction.dataset.datasetId, 'd-retry-cancelled');
  assert.match(result.answerText, /취소/);
});

test('authoritative timeout state is painted in the same dataset slot and counts as feedback, not data', async () => {
  const input = dataset();
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/resolve')) return response({ plan_token: 'p-timeout' });
    const correlation = { dataset_id: body.dataset_id, item_id: body.item_id, ordinal: body.ordinal };
    return response({
      delivery: 'inline', queued: false, status: 'error_rendered', code: 'UPSTREAM_TIMEOUT',
      operation_ref: input.items[0].operationRef, canvas_type: 'facts', screen_id: 'facts-current-trading',
      correlation,
      envelope: {
        canvas_type: 'facts', screen_id: 'facts-current-trading', state: 'timeout',
        fell_back: false, fallback_reason: null, caption: null, layout: null, drop_types: [],
        correlation, error: { code: 'UPSTREAM_TIMEOUT', retryable: true },
      },
      receipt: { pushed: true, delivery: 'inline', canvas_type: 'facts', state: 'timeout', error_code: 'UPSTREAM_TIMEOUT' },
      timing: { server_ms: 2700 }, next_actions: [],
    });
  };
  const emitted = [];
  const result = await runRestDataset({
    dataset: input,
    backendBase: 'http://backend',
    fetchImpl,
    emitCanvas: async (payload) => {
      emitted.push(payload);
      return { verifiedVisible: true, visiblePaintAt: payload.requestStartedAt + 2750 };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.feedbackOk, true);
  assert.equal(result.firstFeedbackMs, 2750);
  assert.equal(result.firstCanvasMs, null);
  assert.equal(result.dataCanvasCount, 0);
  assert.equal(result.stateCanvasCount, 1);
  assert.equal(result.canvases[0].renderState, 'timeout');
  assert.equal(result.canvases[0].rendererId, null);
  assert.equal(result.canvases[0].panelId, null);
  assert.equal(result.canvases[0].generation, null);
  assert.equal(emitted[0].envelope.state, 'timeout');
  assert.match(result.answerText, /시간 초과 상태/);
  assert.equal(result.answerText.includes('73500'), false);
});

test('user cancellation keeps the request long enough to preserve authoritative screen identity, then paints cancelled state', async () => {
  const input = dataset();
  const controller = new AbortController();
  let renderSignalWasAborted = null;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/resolve')) return response({ plan_token: 'p-cancel' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    renderSignalWasAborted = options.signal.aborted;
    return response(canonicalInline(body, input.items[0].operationRef));
  };
  const emitted = [];
  setTimeout(() => controller.abort(new Error('cancel')), 1);
  const result = await runRestDataset({
    dataset: input,
    backendBase: 'http://backend',
    fetchImpl,
    signal: controller.signal,
    emitCanvas: async (payload) => {
      emitted.push(payload);
      return { verifiedVisible: true, visiblePaintAt: payload.requestStartedAt + 25 };
    },
  });
  assert.equal(renderSignalWasAborted, false);
  assert.equal(result.feedbackOk, true);
  assert.equal(result.dataCanvasCount, 0);
  assert.equal(result.stateCanvasCount, 1);
  assert.equal(emitted[0].envelope.screen_id, 'facts-test-screen');
  assert.equal(emitted[0].envelope.state, 'cancelled');
  assert.equal('data' in emitted[0].envelope, false);
  assert.equal(result.state, 'cancelled');
  assert.equal(result.localState, null);
  assert.equal(result.retryable, true);
});

test('hard abort cancels the in-flight fetch, emits no late card, and the next dataset stays clean', async () => {
  const hardController = new AbortController();
  let fetchSawAbort = false;
  let emitted = 0;
  const hangingFetch = async (url, options) => {
    if (url.endsWith('/resolve')) return response({ plan_token: 'p-hard-abort' });
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        fetchSawAbort = true;
        reject(options.signal.reason);
      }, { once: true });
    });
  };
  const running = runRestDataset({
    dataset: dataset(),
    backendBase: 'http://backend',
    fetchImpl: hangingFetch,
    hardSignal: hardController.signal,
    emitCanvas: async () => { emitted += 1; return { verifiedVisible: true }; },
  });
  setTimeout(() => hardController.abort(new Error('benchmark watchdog')), 2);
  const aborted = await running;
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(fetchSawAbort, true);
  assert.equal(emitted, 0);
  assert.equal(aborted.renderedCount, 0);

  const clean = await runRestDataset({
    dataset: { ...dataset(), datasetId: 'd-next' },
    backendBase: 'http://backend',
    fetchImpl: successfulFetch(),
    emitCanvas: async (payload) => ({ verifiedVisible: true, visiblePaintAt: payload.requestStartedAt + 20 }),
  });
  assert.equal(clean.ok, true);
  assert.equal(clean.canvases.length, 1);
  assert.equal(clean.canvases[0].correlation.dataset_id, 'd-next');
});

test('validation rejects over-six, caller presentation, order, OAuth, split-original and unknown refs', () => {
  assert.throws(() => normalizeDataset(dataset(7)), /1~6개/);
  const withType = dataset();
  withType.items[0].canvasType = 'table';
  assert.throws(() => normalizeDataset(withType), /canvas_type/);
  for (const operationRef of ['base:kt10000', 'base:au10001', 'base:00', 'base:ka10001', 'base:not-real', 'base:0D']) {
    const invalid = dataset();
    invalid.items[0].operationRef = operationRef;
    assert.throws(() => normalizeDataset(invalid), /조회 전용/);
  }
});

test('six fail-closed dataset shapes return immediate truthful receipts without transport calls', async () => {
  const invalidRequests = [
    { reason: 'order_api', operation_ref: 'base:kt10000' },
    { reason: 'oauth_api', operation_ref: 'base:au10001' },
    { reason: 'websocket_api', operation_ref: 'base:00' },
    { reason: 'missing_manifest', operation_ref: 'base:not-real' },
    { reason: 'caller_canvas_type', canvas_type_override: 'free' },
    { reason: 'missing_required_field', operation_ref: 'base:ka10001' },
  ];
  let transportCalls = 0;
  for (const [index, invalidRequest] of invalidRequests.entries()) {
    const result = await runRestDataset({
      dataset: {
        ...dataset(),
        datasetId: `rejected-${index + 1}`,
        invalid_request: invalidRequest,
      },
      fetchImpl: async () => { transportCalls += 1; },
    });
    assert.equal(result.rejected, true);
    assert.equal(result.renderedCount, 0);
    assert.equal(result.answer.delivery, 'separate');
    assert.match(result.answerText, /지원하지 않는 요청/);
  }
  assert.equal(transportCalls, 0);
});

test('fixture-shaped input is accepted without mutating the fixture contract', () => {
  const normalized = normalizeDataset({
    id: 'rest-001',
    question: '삼성전자 현재 시세',
    operations: [{ operation_ref: 'detail:ka10001:current_trading', args: { stk_cd: '005930' } }],
    first_canvas_deadline_ms: 3000,
  });
  assert.equal(normalized.datasetId, 'rest-001');
  assert.equal(normalized.items[0].itemId, 'rest-001-1');
});

test('stock entity index consumes the shared Python/JS conformance vector at a stable adapter version', () => {
  const index = new StockEntityIndex();
  index.replace(resolverRecords());
  assert.equal(RESOLVER_VECTOR.adapter_version, STOCK_ENTITY_RESOLVER_ADAPTER_VERSION);
  assert.equal(RESOLVER_VECTOR.schema_version, 2);
  assert.deepEqual(RESOLVER_VECTOR.market_kinds, REVIEWED_MARKET_ENTITY_KIND);
  assert.equal(index.adapterVersion, RESOLVER_VECTOR.adapter_version);
  for (const vectorCase of RESOLVER_VECTOR.cases) {
    const resolution = index.resolveQuery(vectorCase.question);
    assert.equal(
      resolution?.code || null,
      vectorCase.expected_code,
      vectorCase.id,
    );
    assert.equal(resolution?.kind || null, vectorCase.expected_kind || null, `${vectorCase.id}: kind`);
  }
});

test('resolveQuery 메모는 같은 질의를 재사용하고 replace()로만 무효화된다', () => {
  const index = new StockEntityIndex();
  index.replace([{ code: '005930', name: '삼성전자', market: '0' }]);
  const first = index.resolveQuery('삼성전자 현재가');
  assert.equal(first.code, '005930');
  assert.equal(index.resolveQuery('삼성전자 현재가'), first);
  assert.ok(Object.isFrozen(first));

  index.replace([{ code: '015760', name: '한국전력', market: '0' }]);
  assert.equal(index.resolveQuery('삼성전자 현재가'), null);
  assert.equal(index.resolveQuery('한국전력 현재가')?.code, '015760');
});

test('quote binder keeps entity resolution separate from quote intent routing', () => {
  const index = new StockEntityIndex();
  index.replace(resolverRecords());
  for (const id of ['non-quote-context', 'identity-context', 'chart-context', 'order-context']) {
    const vectorCase = RESOLVER_VECTOR.cases.find((item) => item.id === id);
    assert.equal(index.resolveQuery(vectorCase.question)?.code, '123456', `${id}: entity`);
    assert.equal(buildQuoteDataset(vectorCase.question, index), null, `${id}: quote route`);
  }
});

test('quote binder uses a closed standalone grammar and rejects every residual semantic token', () => {
  const index = new StockEntityIndex();
  index.replace([
    { code: '005930', name: '삼성전자', aliases: ['Samsung Electronics'], market: '0' },
    { code: '015760', name: '한국전력', market: '0' },
  ]);

  for (const standaloneQuestion of [
    '삼성전자 현재가',
    '삼성전자 현재가 알려줘',
    '005930 현재가',
    '005930 오늘 주가',
    '005930 주가 얼마',
    'Samsung Electronics current price',
    'current stock price for Samsung Electronics please',
  ]) {
    const standalone = buildQuoteDataset(standaloneQuestion, index, {
      idFactory: () => 'standalone-quote',
    });
    assert.equal(standalone.datasetId, 'standalone-quote', standaloneQuestion);
    assert.equal(standalone.items[0].operationRef, 'detail:ka10001:current_trading', standaloneQuestion);
    assert.deepEqual(standalone.items[0].args, { stk_cd: '005930' }, standaloneQuestion);
  }

  for (const residualContext of [
    '한국전력의 거래원 조회에서 현재가와 거래량 요약만 보여줘',
    '한국전력 회원사 현황과 현재가',
    '한국전력 brokerage activity and current price',
    '한국전력 selling members and current price',
    '삼성전자 현재가와 미상 의미를 함께',
    '삼성전자 말고 한국전력 현재가',
    '삼성전자와 한국전력 현재가 비교',
  ]) {
    assert.equal(buildQuoteDataset(residualContext, index), null, residualContext);
  }
});

test('chart binder uses a closed standalone grammar and rejects every residual semantic token', () => {
  const index = new StockEntityIndex();
  index.replace([
    { code: '005930', name: '삼성전자', aliases: ['Samsung Electronics'], market: '0' },
    { code: '015760', name: '한국전력', market: '0' },
    { code: '069500', name: 'KODEX 200', market: '8' },
  ]);

  for (const standaloneQuestion of [
    '삼성전자 차트',
    '삼성전자 차트 보여줘',
    '삼성전자 일봉',
    '삼성전자 일봉 차트',
    '삼성전자 일봉차트 보여줘',
    '삼성전자 주가 차트 보여줘',
    '삼성전자 주식 차트 확인해줘',
    '005930 차트 그려줘',
    '005930 일봉 차트 띄워줘',
  ]) {
    const bound = buildChartDataset(standaloneQuestion, index, { idFactory: () => 'standalone-chart' });
    assert.equal(bound.datasetId, 'standalone-chart', standaloneQuestion);
    assert.equal(bound.items[0].operationRef, 'base:ka10081', standaloneQuestion);
    assert.equal(bound.items[0].args.stk_cd, '005930', standaloneQuestion);
    assert.equal(bound.items[0].args.upd_stkpc_tp, '1', standaloneQuestion);
    assert.match(bound.items[0].args.base_dt, /^\d{8}$/, standaloneQuestion);
  }

  for (const residualContext of [
    '삼성전자 주봉 차트', // 다른 TR — 일봉 문법에서 의도적으로 미매치
    '삼성전자 시세', // 현재가 문법 영역 — 차트 문법과 겹치지 않는다
    '삼성전자 호가', // 다른 화면 — 차트 fast-path 대상 아님
    '삼성전자 차트 분석해줘', // "분석"은 정중어 목록 밖 — 모델 경로로
    '삼성전자와 한국전력 차트 비교',
    '삼성전자 말고 한국전력 차트',
    'KODEX 200 차트', // etf는 buildQuoteDataset과 동일하게 kind 제한
  ]) {
    assert.equal(buildChartDataset(residualContext, index), null, residualContext);
  }

  // 주문류 의도는 애초에 차트 문법에 없는 단어라 매치될 수 없다 — 명시적으로 확인.
  for (const orderLike of ['삼성전자 매수', '삼성전자 100주 매수 주문', '삼성전자 매도해줘']) {
    assert.equal(buildChartDataset(orderLike, index), null, orderLike);
  }
});

test('order book binder uses a closed standalone grammar and rejects every residual semantic token', () => {
  const index = new StockEntityIndex();
  index.replace([
    { code: '005930', name: '삼성전자', aliases: ['Samsung Electronics'], market: '0' },
    { code: '015760', name: '한국전력', market: '0' },
    { code: '069500', name: 'KODEX 200', market: '8' },
  ]);

  for (const standaloneQuestion of [
    '삼성전자 호가',
    '삼성전자 호가 보여줘',
    '삼성전자 호가 조회해줘',
    '005930 호가',
    '005930 호가 알려줘',
  ]) {
    const bound = buildOrderBookDataset(standaloneQuestion, index, { idFactory: () => 'standalone-orderbook' });
    assert.equal(bound.datasetId, 'standalone-orderbook', standaloneQuestion);
    assert.equal(bound.items[0].operationRef, 'detail:ka10004:aggregate_totals', standaloneQuestion);
    assert.deepEqual(bound.items[0].args, { stk_cd: '005930' }, standaloneQuestion);
  }

  for (const residualContext of [
    '삼성전자 차트', // 다른 문법 영역
    '삼성전자 현재가', // 다른 문법 영역
    '삼성전자 호가 분석해줘', // "분석"은 정중어 목록 밖
    '삼성전자와 한국전력 호가 비교',
    '삼성전자 말고 한국전력 호가',
    'KODEX 200 호가', // etf는 다른 grammar와 동일하게 kind 제한
  ]) {
    assert.equal(buildOrderBookDataset(residualContext, index), null, residualContext);
  }

  for (const orderLike of ['삼성전자 매수', '삼성전자 100주 매수 주문', '삼성전자 매도해줘']) {
    assert.equal(buildOrderBookDataset(orderLike, index), null, orderLike);
  }
});

test('investor flow binder uses a closed standalone grammar and rejects every residual semantic token', () => {
  const index = new StockEntityIndex();
  index.replace([
    { code: '005930', name: '삼성전자', aliases: ['Samsung Electronics'], market: '0' },
    { code: '015760', name: '한국전력', market: '0' },
    { code: '069500', name: 'KODEX 200', market: '8' },
  ]);

  for (const standaloneQuestion of [
    '삼성전자 수급',
    '삼성전자 수급 보여줘',
    '삼성전자 외국인 매매',
    '삼성전자 외국인 매매 동향',
    '삼성전자 기관 매매',
    '삼성전자 기관 매매 동향 알려줘',
    '005930 수급',
  ]) {
    const bound = buildInvestorFlowDataset(standaloneQuestion, index, { idFactory: () => 'standalone-investor-flow' });
    assert.equal(bound.datasetId, 'standalone-investor-flow', standaloneQuestion);
    assert.equal(bound.items[0].operationRef, 'base:ka10061', standaloneQuestion);
    assert.equal(bound.items[0].args.stk_cd, '005930', standaloneQuestion);
    assert.equal(bound.items[0].args.amt_qty_tp, '1', standaloneQuestion);
    assert.equal(bound.items[0].args.trde_tp, '0', standaloneQuestion);
    assert.equal(bound.items[0].args.unit_tp, '1000', standaloneQuestion);
    assert.match(bound.items[0].args.strt_dt, /^\d{8}$/, standaloneQuestion);
    assert.equal(bound.items[0].args.strt_dt, bound.items[0].args.end_dt, standaloneQuestion);
  }

  for (const residualContext of [
    '삼성전자 거래원', // 다른 문법 영역
    '삼성전자 개인 매매', // "개인"은 문법 밖 — 불확실하면 미매치
    '삼성전자 수급 분석해줘', // "분석"은 정중어 목록 밖
    '삼성전자와 한국전력 수급 비교',
    '삼성전자 말고 한국전력 수급',
    'KODEX 200 수급', // etf는 다른 grammar와 동일하게 kind 제한
  ]) {
    assert.equal(buildInvestorFlowDataset(residualContext, index), null, residualContext);
  }

  for (const orderLike of ['삼성전자 매수', '삼성전자 100주 매수 주문', '삼성전자 매도해줘']) {
    assert.equal(buildInvestorFlowDataset(orderLike, index), null, orderLike);
  }
});

test('trading source binder uses a closed standalone grammar and rejects every residual semantic token', () => {
  const index = new StockEntityIndex();
  index.replace([
    { code: '005930', name: '삼성전자', aliases: ['Samsung Electronics'], market: '0' },
    { code: '015760', name: '한국전력', market: '0' },
    { code: '069500', name: 'KODEX 200', market: '8' },
  ]);

  for (const standaloneQuestion of [
    '삼성전자 거래원',
    '삼성전자 거래원 보여줘',
    '삼성전자 거래원 알려줘',
    '005930 거래원',
  ]) {
    const bound = buildTradingSourceDataset(standaloneQuestion, index, { idFactory: () => 'standalone-trading-source' });
    assert.equal(bound.datasetId, 'standalone-trading-source', standaloneQuestion);
    assert.equal(bound.items[0].operationRef, 'base:ka10038', standaloneQuestion);
    assert.deepEqual(bound.items[0].args, { stk_cd: '005930', qry_tp: '2' }, standaloneQuestion);
  }

  for (const residualContext of [
    '삼성전자 수급', // 다른 문법 영역
    '삼성전자 거래원 분석해줘', // "분석"은 정중어 목록 밖
    '삼성전자와 한국전력 거래원 비교',
    '삼성전자 말고 한국전력 거래원',
    'KODEX 200 거래원', // etf는 다른 grammar와 동일하게 kind 제한
  ]) {
    assert.equal(buildTradingSourceDataset(residualContext, index), null, residualContext);
  }

  for (const orderLike of ['삼성전자 매수', '삼성전자 100주 매수 주문', '삼성전자 매도해줘']) {
    assert.equal(buildTradingSourceDataset(orderLike, index), null, orderLike);
  }
});

test('stock info binder uses a closed standalone grammar and rejects every residual semantic token', () => {
  const index = new StockEntityIndex();
  index.replace([
    { code: '005930', name: '삼성전자', aliases: ['Samsung Electronics'], market: '0' },
    { code: '015760', name: '한국전력', market: '0' },
    { code: '069500', name: 'KODEX 200', market: '8' },
  ]);

  for (const standaloneQuestion of [
    '삼성전자 종목정보',
    '삼성전자 종목정보 보여줘',
    '삼성전자 기업정보',
    '삼성전자 기업정보 알려줘',
    '005930 종목정보',
  ]) {
    const bound = buildStockInfoDataset(standaloneQuestion, index, { idFactory: () => 'standalone-stockinfo' });
    assert.equal(bound.datasetId, 'standalone-stockinfo', standaloneQuestion);
    assert.equal(bound.items[0].operationRef, 'base:ka10100', standaloneQuestion);
    assert.deepEqual(bound.items[0].args, { stk_cd: '005930' }, standaloneQuestion);
  }

  for (const residualContext of [
    '삼성전자 현재가', // 다른 문법 영역
    '삼성전자 종목정보 분석해줘', // "분석"은 정중어 목록 밖
    '삼성전자와 한국전력 종목정보 비교',
    '삼성전자 말고 한국전력 종목정보',
    'KODEX 200 종목정보', // etf는 다른 grammar와 동일하게 kind 제한
  ]) {
    assert.equal(buildStockInfoDataset(residualContext, index), null, residualContext);
  }

  for (const orderLike of ['삼성전자 매수', '삼성전자 100주 매수 주문', '삼성전자 매도해줘']) {
    assert.equal(buildStockInfoDataset(orderLike, index), null, orderLike);
  }
});

test('program trade binder uses a closed market-wide grammar with no entity resolution', () => {
  for (const standaloneQuestion of [
    '프로그램매매',
    '프로그램매매 동향',
    '프로그램매매 보여줘',
    '프로그램매매 동향 알려줘',
  ]) {
    const bound = buildProgramTradeDataset(standaloneQuestion, { idFactory: () => 'standalone-program-trade' });
    assert.equal(bound.datasetId, 'standalone-program-trade', standaloneQuestion);
    assert.equal(bound.items[0].operationRef, 'base:ka90005', standaloneQuestion);
    assert.deepEqual(bound.items[0].args, {
      date: bound.items[0].args.date,
      amt_qty_tp: '1',
      mrkt_tp: 'P00101',
      min_tic_tp: '1',
      stex_tp: '1',
    }, standaloneQuestion);
    assert.match(bound.items[0].args.date, /^\d{8}$/, standaloneQuestion);
  }

  for (const residualContext of [
    '삼성전자 프로그램매매', // 종목명이 남아 있으면 이 문법(시장 전체) 밖
    '프로그램매매 분석해줘', // "분석"은 정중어 목록 밖
    '코스닥 프로그램매매', // 시장 지정은 닫힌 문법 밖(불확실하면 미매치)
  ]) {
    assert.equal(buildProgramTradeDataset(residualContext), null, residualContext);
  }

  for (const orderLike of ['삼성전자 매수', '삼성전자 100주 매수 주문', '삼성전자 매도해줘']) {
    assert.equal(buildProgramTradeDataset(orderLike), null, orderLike);
  }
});

test('resolved entity code remains exact through quote dataset and resolve control plane', async () => {
  const index = new StockEntityIndex();
  index.replace(resolverRecords());
  const bindings = [
    ['새로운회사 오늘 주가 얼마야?', 'name-binding'],
    ['123456 오늘 주가', 'code-binding'],
  ];
  const operations = [];
  for (const [question, datasetId] of bindings) {
    const bound = buildQuoteDataset(question, index, { idFactory: () => datasetId });
    assert.equal(bound.items[0].args.stk_cd, '123456');
    assert.equal(bound.items[0].operationRef, 'detail:ka10001:current_trading');
    const fetchImpl = successfulFetch();
    const result = await runRestDataset({
      dataset: bound,
      backendBase: 'http://backend',
      fetchImpl,
      emitCanvas: async (payload) => ({
        verifiedVisible: true,
        visiblePaintAt: payload.requestStartedAt + 10,
      }),
    });
    assert.equal(result.ok, true);
    const resolveRequest = fetchImpl.calls[0].body;
    assert.equal(resolveRequest.question, bound.items[0].operationRef);
    assert.equal(resolveRequest.arguments.stk_cd, bound.items[0].args.stk_cd);
    operations.push(resolveRequest.question);
  }
  assert.deepEqual(operations, [
    'detail:ka10001:current_trading',
    'detail:ka10001:current_trading',
  ]);
});

test('unsafe or non-quote resolver vectors mint neither a quote dataset nor a plan', async () => {
  const index = new StockEntityIndex();
  index.replace(resolverRecords());
  let controlPlaneCalls = 0;
  for (const id of ['name-code-mutation', 'ambiguous-name', 'two-issuers', 'two-explicit-codes', 'negation', 'comparison', 'non-quote-context']) {
    const vectorCase = RESOLVER_VECTOR.cases.find((item) => item.id === id);
    const bound = buildQuoteDataset(vectorCase.question, index);
    assert.equal(bound, null, id);
    if (bound) {
      await runRestDataset({
        dataset: bound,
        backendBase: 'http://backend',
        fetchImpl: async () => {
          controlPlaneCalls += 1;
          throw new Error('unsafe binding reached the control plane');
        },
      });
    }
  }
  assert.equal(controlPlaneCalls, 0);
});

test('ETF, unknown code, intent uncertainty, and unknown market never bind the stock quote operation', async () => {
  const index = new StockEntityIndex();
  index.replace([
    { code: '123456', name: '새로운회사', market: '0' },
    { code: '333333', name: '펀드회사', market: '8' },
    { code: '444444', name: '미지시장회사', market: '99' },
  ]);
  assert.deepEqual(index.resolveQuery('123456 현재가'), {
    code: '123456', kind: 'stock', market: '0', source: 'explicit-code',
  });
  assert.equal(index.resolveQuery('333333 현재가')?.kind, 'etf');
  assert.equal(index.resolveQuery('999999 현재가'), null);
  assert.equal(index.resolveQuery('미지시장회사 현재가'), null);
  assert.equal(buildQuoteDataset('펀드회사 오늘 주가', index), null);
  assert.equal(buildQuoteDataset('333333 오늘 주가', index), null);
  assert.equal(buildQuoteDataset('999999 오늘 주가', index), null);
  assert.equal(buildQuoteDataset('새로운회사에 대해 설명해줘', index), null);
  assert.equal(buildQuoteDataset('없는회사 오늘 주가', index), null);

  const refreshed = new StockEntityIndex();
  const fetches = [];
  await refreshStockEntityIndex(refreshed, {
    backendBase: 'http://backend',
    markets: ['0', '10', '8', '99'],
    wait: async () => {},
    fetchImpl: async (_url, options) => {
      const market = JSON.parse(options.body).mrkt_tp;
      fetches.push(market);
      return response({ list: [{
        code: `${Number(market) + 1}`.padStart(6, '0'),
        name: `시장${market}`,
        marketCode: market,
      }] });
    },
  });
  assert.deepEqual(fetches, ['0', '10', '8']);
  assert.equal(refreshed.resolveQuery('시장0 현재가')?.kind, 'stock');
  assert.equal(refreshed.resolveQuery('시장10 현재가')?.kind, 'stock');
  assert.equal(refreshed.resolveQuery('시장8 현재가')?.kind, 'etf');
});

test('stock-master refresh publishes one atomic returned-market snapshot and deduplicates aggregate overlap', async () => {
  const index = new StockEntityIndex();
  index.replace([
    { code: '111111', name: '기존종목', market: '0' },
    { code: '069500', name: 'KODEX 200', market: '8' },
  ]);
  let releaseLast;
  let reachedLast;
  const lastBlocked = new Promise((resolve) => { reachedLast = resolve; });
  const lastRelease = new Promise((resolve) => { releaseLast = resolve; });

  const refresh = refreshStockEntityIndex(index, {
    backendBase: 'http://backend',
    wait: async () => {},
    fetchImpl: async (_url, options) => {
      const market = JSON.parse(options.body).mrkt_tp;
      if (market === '8') {
        reachedLast();
        await lastRelease;
      }
      const lists = {
        0: [
          { code: '222222', name: '신규코스피', marketCode: '0' },
          // 시장 0 응답은 aggregate다. 반환 marketCode=8이 권위다.
          { code: '069500', name: 'KODEX 200', marketCode: '8' },
        ],
        10: [{ code: '333333', name: '신규코스닥', marketCode: '10' }],
        8: [{ code: '069500', name: 'KODEX 200', marketCode: '8' }],
      };
      return response({ list: lists[market] });
    },
  });

  await lastBlocked;
  assert.equal(index.resolveQuery('기존종목 현재가')?.code, '111111');
  assert.equal(index.resolveQuery('신규코스피 현재가'), null);
  assert.equal(index.resolveQuery('KODEX 200 현재가')?.kind, 'etf');
  assert.equal(buildQuoteDataset('KODEX 200 현재가', index), null);

  releaseLast();
  assert.equal(await refresh, 3);
  assert.equal(index.resolveQuery('기존종목 현재가'), null);
  assert.equal(index.resolveQuery('신규코스피 현재가')?.kind, 'stock');
  assert.equal(index.resolveQuery('KODEX 200 현재가')?.kind, 'etf');
  assert.equal(buildQuoteDataset('KODEX 200 현재가', index), null);
  assert.equal(buildQuoteDataset('신규코스피 현재가', index)?.items[0].args.stk_cd, '222222');
});

test('stock-master refresh excludes conflicting identity metadata instead of choosing a response order', async () => {
  const index = new StockEntityIndex();
  const size = await refreshStockEntityIndex(index, {
    backendBase: 'http://backend',
    wait: async () => {},
    fetchImpl: async (_url, options) => {
      const market = JSON.parse(options.body).mrkt_tp;
      const lists = {
        0: [{ code: '555555', name: '충돌A', marketCode: '0' }],
        10: [{ code: '555555', name: '충돌B', marketCode: '10' }],
        8: [],
      };
      return response({ list: lists[market] });
    },
  });
  assert.equal(size, 0);
  assert.equal(index.resolveQuery('555555 현재가'), null);
  assert.equal(index.resolveQuery('충돌A 현재가'), null);
  assert.equal(index.resolveQuery('충돌B 현재가'), null);
});

test('stock-master fetch or response validation failure preserves the prior snapshot', async () => {
  const index = new StockEntityIndex();
  index.replace([{ code: '005930', name: '삼성전자', market: '0' }]);

  await assert.rejects(refreshStockEntityIndex(index, {
    backendBase: 'http://backend',
    wait: async () => {},
    fetchImpl: async (_url, options) => {
      const market = JSON.parse(options.body).mrkt_tp;
      if (market === '10') throw new Error('upstream unavailable');
      return response({ list: [{ code: '222222', name: '미게시종목', marketCode: market }] });
    },
  }), /upstream unavailable/);
  assert.equal(index.resolveQuery('삼성전자 현재가')?.code, '005930');
  assert.equal(index.resolveQuery('미게시종목 현재가'), null);

  await assert.rejects(refreshStockEntityIndex(index, {
    backendBase: 'http://backend',
    wait: async () => {},
    fetchImpl: async () => response({ unexpected: [] }),
  }), /stock-master/i);
  assert.equal(index.resolveQuery('삼성전자 현재가')?.code, '005930');
  assert.equal(buildQuoteDataset('삼성전자 현재가', index)?.items[0].args.stk_cd, '005930');
});

test('stock-master refresh forwards cancellation to fetch and aborts an inter-market wait', async () => {
  const index = new StockEntityIndex();
  index.replace([{ code: '005930', name: '삼성전자', market: '0' }]);
  const controller = new AbortController();
  let fetchCalls = 0;
  let releaseWait;
  const waitStarted = new Promise((resolve) => { releaseWait = resolve; });

  const refresh = refreshStockEntityIndex(index, {
    backendBase: 'http://backend',
    signal: controller.signal,
    wait: async () => {
      releaseWait();
      await new Promise(() => {});
    },
    fetchImpl: async (_url, options) => {
      fetchCalls += 1;
      assert.equal(options.signal, controller.signal);
      return response({ list: [{ code: '222222', name: '미게시종목', marketCode: '0' }] });
    },
  });

  await waitStarted;
  controller.abort(new Error('앱 종료'));
  await assert.rejects(refresh, /앱 종료/);
  assert.equal(fetchCalls, 1);
  assert.equal(index.resolveQuery('삼성전자 현재가')?.code, '005930');
  assert.equal(index.resolveQuery('미게시종목 현재가'), null);
});

test('recommendations accept only predeclared safe query actions, dedupe, and cap at three', () => {
  const actions = normalizeRecommendations([
    { follow_up_id: 'a', label: '이전 기간 보기', query: '이전 기간 보여줘', target_intent: 'query', operation_ref: 'base:ka10081' },
    { follow_up_id: 'a', label: '중복', query: '중복' },
    { follow_up_id: 'b', label: '매수 주문', query: '1주 매수해줘', target_intent: 'query' },
    { follow_up_id: 'c', label: '다른 지표', query: '다른 지표 보여줘', target_intent: 'query', operation_ref: 'base:ka10003' },
    { follow_up_id: 'd', label: '비교', query: '직전과 비교해줘', target_intent: 'query', operation_ref: 'detail:ka10001:current_trading' },
    { follow_up_id: 'e', label: '추가', query: '추가 항목', target_intent: 'query', operation_ref: 'base:ka10100' },
  ]);
  assert.deepEqual(actions.map((item) => item.id), ['a', 'c', 'd']);
});
