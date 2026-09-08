const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SelectorFastPathError,
  buildMarketOrderDraft,
  runSelectorFastPath: runSelectorFastPathWithAccount,
} = require('./selector-fast-path');

function runSelectorFastPath(options) {
  return runSelectorFastPathWithAccount({ backendAccountAlias: 'server-a', ...options });
}

function inlineBody(request, overrides = {}) {
  const correlation = {
    dataset_id: request.dataset_id,
    item_id: request.item_id,
    ordinal: request.ordinal,
  };
  return {
    delivery: 'inline',
    queued: false,
    status: 'rendered',
    operation_ref: 'detail:ka10001:current_trading',
    canvas_type: 'facts',
    screen_id: 'stock-price',
    correlation,
    envelope: {
      canvas_type: 'facts',
      screen_id: 'stock-price',
      correlation,
      state: 'data',
    },
    ...overrides,
  };
}

test('query success performs one HTTP request, paints, persists, and reports zero model calls', async () => {
  const requests = [];
  const painted = [];
  const persisted = [];
  const result = await runSelectorFastPath({
    question: '삼성전자 현재가와 거래량 보여줘',
    backendBase: 'http://127.0.0.1:8010',
    idFactory: (() => { const values = ['dataset', 'item']; return () => values.shift(); })(),
    fetchImpl: async (url, options) => {
      const request = JSON.parse(options.body);
      requests.push({ url, options, request });
      return { ok: true, status: 200, json: async () => inlineBody(request) };
    },
    emitCanvas: async (payload) => {
      painted.push(payload);
      return { visiblePaintAt: 10 };
    },
    persistTurn: async (turn) => persisted.push(turn),
    clock: (() => { let value = 0; return () => ++value; })(),
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://127.0.0.1:8010/api/v1/selector/dispatch');
  assert.equal(requests[0].options.headers['X-Athena-Account'], 'server-a');
  assert.equal(requests[0].options.redirect, 'error');
  assert.deepEqual(requests[0].request, {
    question: '삼성전자 현재가와 거래량 보여줘',
    intent: 'auto',
    candidate_refs: [],
    arguments: {},
    response_mode: 'auto',
    continuation: { cont_yn: 'N', next_key: null },
    dataset_id: 'selector-dataset',
    item_id: 'selector-item',
    ordinal: 1,
    deadline_ms: 2700,
  });
  assert.equal(painted.length, 1);
  assert.equal(painted[0].operationRef, 'detail:ka10001:current_trading');
  assert.equal(persisted.length, 1);
  assert.equal(result.handled, true);
  assert.equal(result.source, 'selector-fast');
  assert.equal(result.modelCalls, 0);
});

test('서버 alias가 없으면 query·guarded draft·websocket selector fetch를 호출하지 않는다', async () => {
  let fetches = 0;
  for (const intent of ['auto', 'order', 'websocket']) {
    const result = await runSelectorFastPathWithAccount({
      question: '삼성전자 요청',
      backendBase: 'http://backend',
      intent,
      fetchImpl: async () => { fetches += 1; },
    });
    assert.deepEqual(result, { handled: false, reason: 'missing_backend_account_alias' });
  }
  assert.equal(fetches, 0);
});

test('계좌 A/B selector dispatch는 명시 alias와 redirect 차단을 유지한다', async () => {
  for (const backendAccountAlias of ['server-a', 'server-b']) {
    const requests = [];
    const result = await runSelectorFastPathWithAccount({
      question: '삼성전자 현재가 보여줘',
      backendBase: 'http://backend',
      backendAccountAlias,
      idFactory: (() => { const values = ['dataset', 'item']; return () => values.shift(); })(),
      fetchImpl: async (_url, options) => {
        const request = JSON.parse(options.body);
        requests.push(options);
        return { ok: true, status: 200, json: async () => inlineBody(request) };
      },
    });
    assert.equal(result.handled, true);
    assert.equal(requests[0].headers['X-Athena-Account'], backendAccountAlias);
    assert.equal(requests[0].redirect, 'error');
  }
});

test('selector redirect가 거부되면 카드와 이력을 만들지 않는다', async () => {
  let painted = 0;
  let persisted = 0;
  await assert.rejects(runSelectorFastPath({
    question: '삼성전자 현재가 보여줘',
    backendBase: 'http://backend',
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'error');
      throw new TypeError('redirect disallowed');
    },
    emitCanvas: async () => { painted += 1; },
    persistTurn: async () => { persisted += 1; },
  }), /redirect disallowed/);
  assert.equal(painted, 0);
  assert.equal(persisted, 0);
});

test('expected miss falls through without paint or history side effects', async () => {
  let painted = 0;
  let persisted = 0;
  const result = await runSelectorFastPath({
    question: '삼성전자와 하이닉스 비교해줘',
    backendBase: 'http://backend',
    fetchImpl: async () => ({ ok: false, status: 409 }),
    emitCanvas: async () => { painted += 1; },
    persistTurn: async () => { persisted += 1; },
  });
  assert.deepEqual(result, { handled: false, reason: 'http_409' });
  assert.equal(painted, 0);
  assert.equal(persisted, 0);
});

test('needs_inference returns a bounded token-free preflight for the cold hedge', async () => {
  const candidates = [
    { operation_ref: 'base:ka10001', kind: 'query', required_arguments: ['stk_cd'] },
    { operation_ref: 'detail:ka10001:current_trading', kind: 'detail', required_arguments: ['stk_cd'] },
    { operation_ref: 'base:ka10002', kind: 'query' },
    { operation_ref: 'base:ka10003', kind: 'query' },
  ];
  const result = await runSelectorFastPath({
    question: '삼성전자 거래 정보',
    backendBase: 'http://backend',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'needs_inference', catalog_version: 'v1', candidates }),
    }),
  });
  assert.equal(result.handled, false);
  assert.equal(result.reason, 'needs_inference');
  assert.equal(result.preflight.catalog_version, 'v1');
  assert.equal(result.preflight.candidates.length, 3);
  assert.equal(Object.hasOwn(result.preflight, 'plan_token'), false);
});

test('plan_token key is rejected even when its value is null', async () => {
  await assert.rejects(
    runSelectorFastPath({
      question: '삼성전자 현재가 보여줘',
      backendBase: 'http://backend',
      idFactory: (() => { const values = ['dataset', 'item']; return () => values.shift(); })(),
      fetchImpl: async (_url, options) => {
        const request = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => inlineBody(request, { plan_token: null }),
        };
      },
    }),
    (error) => error instanceof SelectorFastPathError
      && error.code === 'unexpected_plan_token',
  );
});

test('cold retry sends an exact preferred operation and rejects a different result', async () => {
  const requests = [];
  await assert.rejects(
    runSelectorFastPath({
      question: '삼성전자 호가 잔량을 보여줘',
      backendBase: 'http://backend',
      preferredRef: 'detail:ka10004:buy_bid_prices',
      candidateRefs: ['detail:ka10004:buy_bid_prices'],
      arguments: { stk_cd: '005930' },
      idFactory: (() => { const values = ['dataset', 'item']; return () => values.shift(); })(),
      fetchImpl: async (_url, options) => {
        const request = JSON.parse(options.body);
        requests.push({ request, options });
        return {
          ok: true,
          status: 200,
          json: async () => inlineBody(request, {
            operation_ref: 'detail:ka10004:sell_bid_prices',
          }),
        };
      },
    }),
    (error) => error instanceof SelectorFastPathError
      && error.code === 'preferred_operation_mismatch',
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].request.preferred_ref, 'detail:ka10004:buy_bid_prices');
  assert.equal(requests[0].options.headers['X-Athena-Account'], 'server-a');
  assert.equal(requests[0].options.redirect, 'error');
});

test('inline error state is painted once and never retried through the model path', async () => {
  let painted = 0;
  const result = await runSelectorFastPath({
    question: '삼성전자 현재가 보여줘',
    backendBase: 'http://backend',
    idFactory: (() => { const values = ['dataset', 'item']; return () => values.shift(); })(),
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => inlineBody(request, {
          status: 'error_rendered',
          code: 'UPSTREAM_TIMEOUT',
          envelope: {
            canvas_type: 'facts',
            screen_id: 'stock-price',
            correlation: {
              dataset_id: request.dataset_id,
              item_id: request.item_id,
              ordinal: request.ordinal,
            },
            state: 'timeout',
          },
        }),
      };
    },
    emitCanvas: async () => {
      painted += 1;
      return { visiblePaintAt: 10 };
    },
  });
  assert.equal(result.handled, true);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'UPSTREAM_TIMEOUT');
  assert.equal(result.modelCalls, 0);
  assert.equal(painted, 1);
});

test('aborted or superseded late response is ignored before paint', async () => {
  const controller = new AbortController();
  const abortReason = new Error('superseded');
  let resolveResponse;
  let painted = 0;
  let current = true;
  const pending = runSelectorFastPath({
    question: '삼성전자 설명해줘',
    backendBase: 'http://backend',
    signal: controller.signal,
    isCurrent: () => current,
    idFactory: (() => { const values = ['dataset', 'item']; return () => values.shift(); })(),
    fetchImpl: async (_url, options) => new Promise((resolve) => {
      const request = JSON.parse(options.body);
      resolveResponse = () => resolve({ ok: true, status: 200, json: async () => inlineBody(request) });
    }),
    emitCanvas: async () => { painted += 1; },
  });
  current = false;
  controller.abort(abortReason);
  resolveResponse();
  await assert.rejects(pending, (error) => error === abortReason);
  assert.equal(painted, 0);
});

test('dispatch deadline aborts a request that hangs before response headers', async () => {
  let painted = 0;
  let persisted = 0;
  await assert.rejects(
    runSelectorFastPath({
      question: '삼성전자 현재가 보여줘',
      backendBase: 'http://backend',
      deadlineMs: 20,
      fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      }),
      emitCanvas: async () => { painted += 1; },
      persistTurn: async () => { persisted += 1; },
    }),
    (error) => error instanceof SelectorFastPathError && error.code === 'dispatch_timeout',
  );
  assert.equal(painted, 0);
  assert.equal(persisted, 0);
});

test('dispatch deadline aborts a response whose JSON body hangs', async () => {
  const orderDraft = {
    intent: 'order',
    expectedOperationRef: 'base:kt10000',
    arguments: { dmst_stex_tp: 'KRX', stk_cd: '005930', ord_qty: '10', trde_tp: '3' },
    side: 'buy',
  };
  let fetches = 0;
  let emitted = 0;
  let persisted = 0;
  await assert.rejects(
    runSelectorFastPath({
      question: '삼성전자 10주 시장가로 매수해줘',
      backendBase: 'http://backend',
      intent: orderDraft.intent,
      arguments: orderDraft.arguments,
      orderDraft,
      deadlineMs: 20,
      fetchImpl: async (_url, options) => {
        fetches += 1;
        return {
          ok: true,
          status: 200,
          json: async () => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
          }),
        };
      },
      emitOrderDraft: async () => { emitted += 1; },
      persistTurn: async () => { persisted += 1; },
    }),
    (error) => error instanceof SelectorFastPathError && error.code === 'dispatch_timeout',
  );
  assert.equal(fetches, 1);
  assert.equal(emitted, 0);
  assert.equal(persisted, 0);
});

test('successful dispatch removes caller abort propagation and its deadline timer', async () => {
  const controller = new AbortController();
  let dispatchSignal;
  const result = await runSelectorFastPath({
    question: '삼성전자 현재가 보여줘',
    backendBase: 'http://backend',
    deadlineMs: 20,
    signal: controller.signal,
    idFactory: (() => { const values = ['dataset', 'item']; return () => values.shift(); })(),
    fetchImpl: async (_url, options) => {
      dispatchSignal = options.signal;
      const request = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => inlineBody(request) };
    },
  });

  assert.equal(result.handled, true);
  controller.abort(new Error('late caller abort'));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(dispatchSignal.aborted, false);
});

test('malformed successful response is rejected before paint', async () => {
  let painted = 0;
  await assert.rejects(
    runSelectorFastPath({
      question: '삼성전자 설명해줘',
      backendBase: 'http://backend',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ delivery: 'inline', status: 'rendered', operation_ref: 'base:kt10000' }),
      }),
      emitCanvas: async () => { painted += 1; },
    }),
    (error) => error instanceof SelectorFastPathError && error.code === 'invalid_inline_response',
  );
  assert.equal(painted, 0);
});

test('closed market-order grammar dispatches guarded draft without execution', async () => {
  const index = {
    resolveQuery: (text) => text === '삼성전자'
      ? { code: '005930', kind: 'stock', market: '0' }
      : null,
    aliasesForEntity: () => ['삼성전자', '005930'],
  };
  const draft = buildMarketOrderDraft('삼성전자 10주 시장가로 매수해줘', index);
  assert.deepEqual(draft, {
    intent: 'order',
    expectedOperationRef: 'base:kt10000',
    arguments: { dmst_stex_tp: 'KRX', stk_cd: '005930', ord_qty: '10', trde_tp: '3' },
    side: 'buy',
  });

  const emitted = [];
  const result = await runSelectorFastPath({
    question: '삼성전자 10주 시장가로 매수해줘',
    backendBase: 'http://backend',
    intent: draft.intent,
    arguments: draft.arguments,
    orderDraft: draft,
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      assert.equal(request.intent, 'order');
      assert.deepEqual(request.arguments, draft.arguments);
      assert.equal(options.headers['X-Athena-Account'], 'server-a');
      assert.equal(options.redirect, 'error');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'guarded',
          operation_ref: 'base:kt10000',
          card_title: '주문',
          order_draft: draft.arguments,
        }),
      };
    },
    emitOrderDraft: async (payload) => emitted.push(payload),
  });
  assert.equal(result.handled, true);
  assert.equal(result.guardedOrder, true);
  assert.equal(result.modelCalls, 0);
  assert.deepEqual(emitted, [{
    status: 'guarded',
    operation_ref: 'base:kt10000',
    card_title: '주문',
    order_draft: { dmst_stex_tp: 'KRX', stk_cd: '005930', ord_qty: '10', trde_tp: '3', side: 'buy' },
  }]);
  assert.equal(buildMarketOrderDraft('삼성전자와 하이닉스 10주 매수해줘', index), null);
  assert.equal(buildMarketOrderDraft('삼성전자 10주 매수해줘', index), null);
  assert.equal(buildMarketOrderDraft('삼성전자 10만원어치 매수해줘', index), null);
  assert.equal(buildMarketOrderDraft('삼성전자 100001주 매수해줘', index), null);
});

test('explicit websocket acknowledgement paints the mapped family event card once', async () => {
  const painted = [];
  const persisted = [];
  const result = await runSelectorFastPath({
    question: '삼성전자 호가 실시간 연결해줘',
    backendBase: 'http://backend',
    intent: 'websocket',
    preferredRef: 'base:0D',
    candidateRefs: ['base:0D'],
    arguments: {
      trnm: 'REG',
      grp_no: '1',
      refresh: '1',
      data: [{ type: '0D', item: '005930' }],
    },
    idFactory: (() => { const values = ['ws-dataset', 'ws-item']; return () => values.shift(); })(),
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      assert.equal(options.headers['X-Athena-Account'], 'server-a');
      assert.equal(options.redirect, 'error');
      const correlation = {
        dataset_id: request.dataset_id,
        item_id: request.item_id,
        ordinal: request.ordinal,
      };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'acknowledged',
          operation_ref: 'base:0D',
          card_title: '호가',
          canvas_type: 'event',
          correlation,
          envelope: {
            canvas_type: 'event',
            card_title: '호가',
            caption: '실시간 연결 상태',
            correlation,
            data: { lifecycle: 'connected', state_label: '실시간 연결됨', records: [] },
          },
          acknowledgement: { command: 'REG' },
        }),
      };
    },
    emitCanvas: async (payload) => {
      painted.push(payload);
      return { visiblePaintAt: 10 };
    },
    persistTurn: async (turn) => persisted.push(turn),
  });

  assert.equal(result.handled, true);
  assert.equal(result.websocketAcknowledged, true);
  assert.equal(result.operationRef, 'base:0D');
  assert.deepEqual(result.canvasCaptions, ['호가']);
  assert.equal(painted.length, 1);
  assert.equal(painted[0].canvasType, 'event');
  assert.equal(painted[0].envelope.card_title, '호가');
  assert.equal(persisted.length, 1);
});
