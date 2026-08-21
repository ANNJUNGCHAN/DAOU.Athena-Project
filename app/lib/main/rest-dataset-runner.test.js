'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MAX_CONCURRENCY,
  STOCK_ENTITY_RESOLVER_ADAPTER_VERSION,
  StockEntityIndex,
  buildQuoteDataset,
  normalizeDataset,
  normalizeRecommendations,
  runRestDataset,
} = require('./rest-dataset-runner');

const RESOLVER_VECTOR_PATH = path.resolve(
  __dirname,
  '../../../backend/tests/fixtures/stock_entity_resolver_conformance.json',
);
const RESOLVER_VECTOR = JSON.parse(fs.readFileSync(RESOLVER_VECTOR_PATH, 'utf8'));

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

test('first-canvas deadline aborts a hung request and emits no late card', async () => {
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
  });
  assert.equal(result.ok, false);
  assert.equal(emitted, 0);
  assert.match(result.answerText, /표시하지 못했습니다/);
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
  index.replace(RESOLVER_VECTOR.records);
  assert.equal(RESOLVER_VECTOR.adapter_version, STOCK_ENTITY_RESOLVER_ADAPTER_VERSION);
  assert.equal(index.adapterVersion, RESOLVER_VECTOR.adapter_version);
  for (const vectorCase of RESOLVER_VECTOR.cases) {
    assert.equal(
      index.resolveQuery(vectorCase.question)?.code || null,
      vectorCase.expected_code,
      vectorCase.id,
    );
  }
});

test('quote binder keeps entity resolution separate from quote intent routing', () => {
  const index = new StockEntityIndex();
  index.replace(RESOLVER_VECTOR.records);
  for (const id of ['non-quote-context', 'identity-context', 'chart-context', 'order-context']) {
    const vectorCase = RESOLVER_VECTOR.cases.find((item) => item.id === id);
    assert.equal(index.resolveQuery(vectorCase.question)?.code, '123456', `${id}: entity`);
    assert.equal(buildQuoteDataset(vectorCase.question, index), null, `${id}: quote route`);
  }
});

test('resolved entity code remains exact through quote dataset and resolve control plane', async () => {
  const index = new StockEntityIndex();
  index.replace(RESOLVER_VECTOR.records);
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
  index.replace(RESOLVER_VECTOR.records);
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

test('binder abstains when intent or entity is uncertain', () => {
  const index = new StockEntityIndex();
  index.replace([{ code: '123456', name: '새로운회사' }]);
  assert.equal(buildQuoteDataset('새로운회사에 대해 설명해줘', index), null);
  assert.equal(buildQuoteDataset('없는회사 오늘 주가', index), null);
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
