'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AITS_CHART_RENDERER_ID, createChartReloadAuthority } = require('./chart-reload');
const { runRestDataset } = require('./rest-dataset-runner');

function authority() {
  const reload = createChartReloadAuthority({ today: () => '20260821' });
  assert.equal(reload.registerPaint({
    renderState: 'data', rendererId: AITS_CHART_RENDERER_ID, panelId: 'panel-1', generation: 4,
  }, {
    correlation: { dataset_id: 'dataset-1', item_id: 'item-1', ordinal: 1 },
    operationRef: 'base:ka10081',
    operationArgs: { stk_cd: '005930', base_dt: '20260821', upd_stkpc_tp: '1' },
    chartBody: { period: 'day', target: 'stock', trId: 'ka10081', candles: [] },
    chartMeta: {
      series_scope: 'standard', reload_group: 'stock',
      reload_targets: {
        day: { operation_ref: 'base:ka10081', request_fields: ['stk_cd', 'base_dt', 'upd_stkpc_tp'] },
        week: { operation_ref: 'base:ka10082', request_fields: ['stk_cd', 'base_dt', 'upd_stkpc_tp'] },
        min: { operation_ref: 'base:ka10080', request_fields: ['stk_cd', 'tic_scope', 'upd_stkpc_tp', 'base_dt'] },
      },
    },
  }), true);
  return reload;
}

test('period reload maps through authoritative AITS contract and preserves exact args/panel identity', () => {
  const reload = authority();
  const dataset = reload.buildDataset({ panelId: 'panel-1', generation: 4, period: 'W', interval: 1, adjusted: true });
  assert.equal(dataset.items[0].operationRef, 'base:ka10082');
  assert.deepEqual(dataset.items[0].args, { stk_cd: '005930', base_dt: '20260821', upd_stkpc_tp: '1' });
  assert.deepEqual(dataset.expected, {
    panelId: 'panel-1', generation: 5, period: 'week', operationRef: 'base:ka10082',
    reloadGroup: 'stock', seriesScope: 'standard',
  });
});

test('intraday and adjusted reload produce fresh exact request arguments without accepting stale generation', () => {
  const reload = authority();
  const dataset = reload.buildDataset({ panelId: 'panel-1', generation: 4, period: 'MIN', interval: 3, adjusted: false });
  assert.equal(dataset.items[0].operationRef, 'base:ka10080');
  assert.equal(dataset.items[0].args.tic_scope, '3');
  assert.equal(dataset.items[0].args.upd_stkpc_tp, '0');
  assert.throws(() => reload.buildDataset({ panelId: 'panel-1', generation: 3, period: 'D' }), /generation/);
});

function goldAuthority({ panelId, operationRef, seriesScope, reloadGroup, reloadTargets }) {
  const reload = createChartReloadAuthority({ today: () => '20260821' });
  assert.equal(reload.registerPaint({
    renderState: 'data', rendererId: AITS_CHART_RENDERER_ID, panelId, generation: 1,
  }, {
    correlation: { dataset_id: `d-${panelId}`, item_id: 'gold', ordinal: 1 },
    operationRef,
    operationArgs: { stk_cd: 'M04020000', tic_scope: '1', upd_stkpc_tp: '1' },
    chartBody: {
      period: operationRef.endsWith('79') || operationRef.endsWith('91') ? 'tick' : 'min',
      target: 'gold', trId: operationRef.replace(/^base:/, ''), candles: [],
    },
    chartMeta: { series_scope: seriesScope, reload_group: reloadGroup, reload_targets: reloadTargets },
  }), true);
  return reload;
}

test('gold generic reload group stays on ka50079/ka50080 and never crosses into today operations', () => {
  const reload = goldAuthority({
    panelId: 'gold-generic', operationRef: 'base:ka50079', seriesScope: 'generic', reloadGroup: 'gold-generic',
    reloadTargets: {
      tick: { operation_ref: 'base:ka50079', request_fields: ['stk_cd', 'tic_scope', 'upd_stkpc_tp'] },
      min: { operation_ref: 'base:ka50080', request_fields: ['stk_cd', 'tic_scope', 'upd_stkpc_tp'] },
    },
  });
  assert.equal(reload.buildDataset({ panelId: 'gold-generic', generation: 1, period: 'MIN' }).items[0].operationRef, 'base:ka50080');
  assert.throws(() => reload.buildDataset({ panelId: 'gold-generic', generation: 1, period: 'D' }), /계약이 없다/);
});

test('gold today reload group stays on ka50091/ka50092 and never selects generic operations', () => {
  const reload = goldAuthority({
    panelId: 'gold-today', operationRef: 'base:ka50091', seriesScope: 'today', reloadGroup: 'gold-today',
    reloadTargets: {
      tick: { operation_ref: 'base:ka50091', request_fields: ['stk_cd', 'tic_scope'] },
      min: { operation_ref: 'base:ka50092', request_fields: ['stk_cd', 'tic_scope'] },
    },
  });
  const dataset = reload.buildDataset({ panelId: 'gold-today', generation: 1, period: 'MIN', adjusted: false });
  assert.equal(dataset.items[0].operationRef, 'base:ka50092');
  assert.equal('upd_stkpc_tp' in dataset.items[0].args, false);
  assert.equal(dataset.expected.reloadGroup, 'gold-today');
});

test('ambiguous or cross-family signed reload metadata fails closed at registration', () => {
  const reload = createChartReloadAuthority();
  assert.equal(reload.registerPaint({
    renderState: 'data', rendererId: AITS_CHART_RENDERER_ID, panelId: 'ambiguous', generation: 1,
  }, {
    correlation: { dataset_id: 'd', item_id: 'i', ordinal: 1 },
    operationRef: 'base:ka50091', operationArgs: { stk_cd: 'M04020000' },
    chartBody: { period: 'tick', target: 'gold', trId: 'ka50091', candles: [] },
    chartMeta: {
      series_scope: 'today', reload_group: 'gold-today',
      reload_targets: { min: { operation_ref: 'base:ka50080', request_fields: ['stk_cd'] } },
    },
  }), false);
  assert.equal(reload.has('ambiguous'), false);
});

test('only a real data chart session registers reload authority and exact result is required', () => {
  const reload = createChartReloadAuthority({ today: () => '20260821' });
  const source = {
    correlation: { dataset_id: 'd', item_id: 'i', ordinal: 1 },
    operationRef: 'base:ka10081', operationArgs: { stk_cd: '005930' },
    chartBody: { period: 'day', target: 'stock', trId: 'ka10081', candles: [] },
  };
  assert.equal(reload.registerPaint({ renderState: 'timeout', rendererId: null, panelId: null, generation: null }, source), false);
  assert.equal(reload.has('panel-1'), false);
  // 껍질만 뜬 차트('loading')와 마운트 결과를 못 받은 차트('timeout')는 완전한
  // 패널 신원을 실어 와도 재조회 권위를 얻지 못한다.
  const shellOnly = {
    rendererId: AITS_CHART_RENDERER_ID, panelId: 'panel-1', generation: 4,
  };
  assert.equal(reload.registerPaint({ ...shellOnly, renderState: 'loading' }, source), false);
  assert.equal(reload.registerPaint({ ...shellOnly, renderState: 'timeout' }, source), false);
  assert.equal(reload.has('panel-1'), false);
  const active = authority();
  const request = active.buildDataset({ panelId: 'panel-1', generation: 4, period: 'D' });
  assert.throws(() => active.acceptResult(request, { ok: false, canvases: [] }), /데이터 카드/);
  const acceptedCanvas = {
    renderState: 'data', isDataCanvas: true, operationRef: 'base:ka10081',
    rendererId: AITS_CHART_RENDERER_ID, panelId: 'panel-1', generation: 5,
    envelope: {
      renderer_id: AITS_CHART_RENDERER_ID,
      data: {
        chart: { period: 'day', target: 'stock', trId: 'ka10081', candles: [] },
        chart_meta: {
          series_scope: 'standard', reload_group: 'stock',
          reload_targets: { day: { operation_ref: 'base:ka10081', request_fields: ['stk_cd'] } },
        },
      },
    },
  };
  assert.deepEqual(active.acceptResult(request, { ok: true, canvases: [acceptedCanvas] }),
    { ok: true, panelId: 'panel-1', generation: 5 });
  assert.throws(() => active.acceptResult(request, {
    ok: true,
    canvases: [{ ...acceptedCanvas, operationRef: 'base:ka10082' }],
  }), /operation 계약/);
});

test('an accepted toolbar reload mints a fresh one-use resolve token before render-plan', async () => {
  const reload = authority();
  const resolveTokens = [];
  const renderedTokens = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/resolve')) {
      const token = `fresh-${resolveTokens.length + 1}`;
      resolveTokens.push(token);
      return { ok: true, status: 200, json: async () => ({ plan_token: token }) };
    }
    renderedTokens.push(body.plan_token);
    const correlation = { dataset_id: body.dataset_id, item_id: body.item_id, ordinal: body.ordinal };
    return { ok: true, status: 200, json: async () => ({
      delivery: 'inline', queued: false, status: 'rendered', operation_ref: 'base:ka10082',
      canvas_type: 'chart', screen_id: 'chart-screen', correlation,
      envelope: {
        renderer_id: AITS_CHART_RENDERER_ID, canvas_type: 'chart', screen_id: 'chart-screen',
        fell_back: false, fallback_reason: null, caption: null, layout: null, drop_types: [], correlation,
        data: {
          symbol: '005930', chart: { period: 'week', target: 'stock', trId: 'ka10082', candles: [] },
          chart_meta: {
            series_scope: 'standard', reload_group: 'stock',
            reload_targets: { week: { operation_ref: 'base:ka10082', request_fields: ['stk_cd', 'base_dt', 'upd_stkpc_tp'] } },
          },
        },
      },
      receipt: { pushed: true, delivery: 'inline', canvas_type: 'chart' },
      timing: {}, next_actions: [],
    }) };
  };
  const request = reload.buildDataset({ panelId: 'panel-1', generation: 4, period: 'W', adjusted: true });
  const result = await runRestDataset({
    dataset: request,
    backendBase: 'http://backend',
    fetchImpl,
    emitCanvas: async (payload) => ({
      verifiedVisible: true, visiblePaintAt: payload.requestStartedAt + 10,
      renderState: 'data', rendererId: AITS_CHART_RENDERER_ID, panelId: 'panel-1', generation: 5,
    }),
  });
  assert.deepEqual(reload.acceptResult(request, result), { ok: true, panelId: 'panel-1', generation: 5 });
  assert.deepEqual(resolveTokens, ['fresh-1']);
  assert.deepEqual(renderedTokens, ['fresh-1']);
  assert.equal(result.physicalCalls, 1);
});

test('destroyed panels lose reload authority and repeated registrations stay bounded', () => {
  const reload = authority();
  assert.equal(reload.size(), 1);
  assert.equal(reload.unregister('panel-1'), true);
  assert.equal(reload.size(), 0);
  assert.throws(() => reload.buildDataset({ panelId: 'panel-1', generation: 4, period: 'D' }), /권위가 없는/);

  for (let index = 0; index < 8; index += 1) {
    assert.equal(reload.registerPaint({
      renderState: 'data', rendererId: AITS_CHART_RENDERER_ID, panelId: `bounded-${index}`, generation: 1,
    }, {
      correlation: { dataset_id: `d-${index}`, item_id: 'i', ordinal: 1 },
      operationRef: 'base:ka10081', operationArgs: { stk_cd: '005930' },
      chartBody: { period: 'day', target: 'stock', trId: 'ka10081', candles: [] },
      chartMeta: {
        series_scope: 'standard', reload_group: 'stock',
        reload_targets: { day: { operation_ref: 'base:ka10081', request_fields: ['stk_cd'] } },
      },
    }), true);
  }
  assert.equal(reload.size(), 6);
  assert.equal(reload.has('bounded-0'), false);
  reload.clear();
  assert.equal(reload.size(), 0);
});
