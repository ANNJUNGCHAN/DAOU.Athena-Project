'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const accountBoundDataset = require('./account-bound-dataset');
const { fetchChartPage } = require('./chart-page');

function functionSource(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const open = source.indexOf(') {', start) + 2;
  assert.ok(open > start + 1, `missing body for ${signature}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unclosed ${signature}`);
}

function loadMainAccountBoundDataCalls({ activeId, bindings, historyAccountId = activeId }) {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const calls = { chart: [], series: [], stock: [], reload: [], resolved: [] };
  const shellContents = {};
  const context = vm.createContext({
    accountBoundDataset,
    activeRestAccountId: () => activeId,
    accounts: {
      resolveBackendAlias: async ({ id }) => {
        calls.resolved.push(id);
        const backendAlias = bindings[id];
        return backendAlias ? { ok: true, accountId: id, backendAlias } : { ok: false, error: '연결 없음' };
      },
    },
    BACKEND_HTTP_BASE: 'http://backend',
    fetch: async () => { throw new Error('metadata fetch should be mocked by resolver'); },
    backendAccountAuthorization: () => 'Bearer fixture',
    shellWin: { isDestroyed: () => false, webContents: shellContents },
    chartReloadAuthority: {
      buildDataset: () => ({ accountId: historyAccountId, items: [] }),
      buildHistoryDataset: () => ({ accountId: historyAccountId, items: [{ operationRef: 'base:ka10081', args: { stk_cd: '005930' } }] }),
      acceptResult: (_request, result) => result,
    },
    runDirectRestDataset: async (_request, _expand, options) => { calls.reload.push(options); return { ok: true }; },
    chartPage: { fetchChartPage: async (options) => { calls.chart.push(options); return { ok: true, candles: [{}] }; } },
    chartSeries: { fetchChartSeries: async (options) => { calls.series.push(options); return { ok: true, series: [{}] }; } },
    restDatasetRunner: {
      refreshStockEntityIndex: async (_index, options) => { calls.stock.push(options); return 1; },
    },
  });
  vm.runInContext([
    functionSource(source, 'function createActiveBackendAccountInvoker('),
    functionSource(source, 'async function refreshActiveStockEntityIndex('),
    functionSource(source, 'async function handleChartPanelReload('),
    functionSource(source, 'async function handleChartHistoryPage('),
    functionSource(source, 'async function handleChartSeries('),
  ].join('\n'), context);
  return {
    calls,
    event: { sender: shellContents },
    chart: context.handleChartHistoryPage,
    reload: context.handleChartPanelReload,
    series: context.handleChartSeries,
    stock: context.refreshActiveStockEntityIndex,
  };
}

test('chart-page A/B는 검증된 서버 alias와 redirect 차단을 보낸다', async () => {
  for (const backendAccountAlias of ['server-a', 'server-b']) {
    const calls = [];
    const result = await fetchChartPage({
      backendBase: 'http://backend',
      backendAccountAlias,
      operationRef: 'base:ka10081',
      args: { stk_cd: '005930' },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({ candles: [{ time: '2026-09-07' }], tr_id: 'ka10081' }) };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers['X-Athena-Account'], backendAccountAlias);
    assert.equal(calls[0].options.redirect, 'error');
  }
});

test('chart-page alias 누락/형식 오류는 fetch 전에 차단한다', async () => {
  let fetches = 0;
  for (const backendAccountAlias of ['', 'LOCAL-UUID', 'server a']) {
    const result = await fetchChartPage({
      backendBase: 'http://backend', backendAccountAlias,
      operationRef: 'base:ka10081',
      fetchImpl: async () => { fetches += 1; },
    });
    assert.equal(result.ok, false);
  }
  assert.equal(fetches, 0);
});

test('chart-page redirect 거부는 데이터 성공으로 바꾸지 않는다', async () => {
  const result = await fetchChartPage({
    backendBase: 'http://backend', backendAccountAlias: 'server-a',
    operationRef: 'base:ka10081',
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'error');
      throw new TypeError('redirect disallowed');
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /redirect disallowed/);
});

test('실제 main chart/series/stock 경계는 활성 local ID를 같은 검증 alias로 바꾼다', async () => {
  for (const [activeId, backendAccountAlias] of [['local-a', 'server-a'], ['local-b', 'server-b']]) {
    const runtime = loadMainAccountBoundDataCalls({ activeId, bindings: { [activeId]: backendAccountAlias } });
    await runtime.chart(runtime.event, {});
    await runtime.series(runtime.event, { operationRef: 'base:ka10064', fields: ['frgnr_invsr'] });
    await runtime.stock({ size: 0 });
    assert.deepEqual(runtime.calls.resolved, [activeId, activeId, activeId]);
    assert.equal(runtime.calls.chart[0].backendAccountAlias, backendAccountAlias);
    assert.equal(runtime.calls.series[0].backendAccountAlias, backendAccountAlias);
    assert.equal(runtime.calls.stock[0].backendAccountAlias, backendAccountAlias);
  }
});

test('실제 main mapping 실패는 chart/series/stock 데이터 호출 전에 차단한다', async () => {
  const runtime = loadMainAccountBoundDataCalls({ activeId: 'local-missing', bindings: {} });
  assert.equal((await runtime.chart(runtime.event, {})).ok, false);
  assert.equal((await runtime.series(runtime.event, {})).ok, false);
  await assert.rejects(runtime.stock({ size: 0 }), /연결 없음/);
  assert.equal(runtime.calls.chart.length, 0);
  assert.equal(runtime.calls.series.length, 0);
  assert.equal(runtime.calls.stock.length, 0);
});

test('실제 main history는 계좌 전환 뒤에도 패널 원본 local account를 재검증한다', async () => {
  const runtime = loadMainAccountBoundDataCalls({
    activeId: 'local-b',
    historyAccountId: 'local-a',
    bindings: { 'local-a': 'server-a', 'local-b': 'server-b' },
  });
  await runtime.chart(runtime.event, {});
  assert.deepEqual(runtime.calls.resolved, ['local-a']);
  assert.equal(runtime.calls.chart[0].backendAccountAlias, 'server-a');
  await runtime.reload(runtime.event, {});
  assert.equal(runtime.calls.reload[0].accountId, 'local-a');
});
