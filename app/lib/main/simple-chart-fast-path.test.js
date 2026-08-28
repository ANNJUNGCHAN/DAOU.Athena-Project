'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isSimpleDailyChartQuery,
  runSimpleChartFastPath,
} = require('./simple-chart-fast-path');

test('routes a simple named-stock chart through the direct runner after bounded index readiness', async () => {
  const index = {
    size: 0,
    resolveQuery: () => ({ code: '005930', kind: 'stock', market: '0' }),
  };
  const calls = { ensure: 0, build: 0, run: 0 };
  const expectedDataset = { question: '삼성전자 차트 보여줘', items: [{ operationRef: 'base:ka10081' }] };
  const expectedResult = { ok: true, source: 'rest-dataset', modelCalls: 0 };

  const routed = await runSimpleChartFastPath({
    query: '삼성전자 차트 보여줘',
    index,
    readyTimeoutMs: 5_000,
    ensureReady: async (timeoutMs) => {
      calls.ensure += 1;
      assert.equal(timeoutMs, 5_000);
      index.size = 1;
      return true;
    },
    buildDataset: (query, receivedIndex) => {
      calls.build += 1;
      assert.equal(query, '삼성전자 차트 보여줘');
      assert.equal(receivedIndex, index);
      return expectedDataset;
    },
    runDataset: async (dataset) => {
      calls.run += 1;
      assert.equal(dataset, expectedDataset);
      return expectedResult;
    },
  });

  assert.deepEqual(calls, { ensure: 1, build: 1, run: 1 });
  assert.equal(routed.handled, true);
  assert.equal(routed.dataset, expectedDataset);
  assert.equal(routed.result, expectedResult);
});

test('returns a local readiness response instead of falling through when the index misses its deadline', async () => {
  const calls = { build: 0, run: 0 };
  const routed = await runSimpleChartFastPath({
    query: '삼성전자 차트 보여줘',
    index: { size: 0 },
    ensureReady: async () => false,
    buildDataset: () => { calls.build += 1; },
    runDataset: async () => { calls.run += 1; },
  });

  assert.deepEqual(calls, { build: 0, run: 0 });
  assert.equal(routed.handled, false);
  assert.equal(routed.reason, 'stock-index-not-ready');
  assert.equal(routed.inferenceFallback.ok, true);
  assert.equal(routed.inferenceFallback.source, 'stock-index-not-ready');
  assert.equal(routed.inferenceFallback.modelCalls, 0);
  assert.equal(routed.inferenceFallback.error, null);
  assert.match(routed.inferenceFallback.answerText, /종목 정보를 준비/);
});

test('keeps a confirmed stock or explicit stock code out of Selector and Claude when binding still fails', async () => {
  let runCalls = 0;
  const routed = await runSimpleChartFastPath({
    query: '999999 차트 보여줘',
    index: { size: 1, resolveQuery: () => null },
    ensureReady: async () => assert.fail('ready index must not wait'),
    buildDataset: () => null,
    runDataset: async () => { runCalls += 1; },
  });

  assert.equal(runCalls, 0);
  assert.equal(routed.handled, true);
  assert.equal(routed.result.ok, true);
  assert.equal(routed.result.source, 'chart-entity-unresolved');
  assert.equal(routed.result.modelCalls, 0);
  assert.match(routed.result.answerText, /정확한 종목명|6자리 종목코드/);
});

test('does not intercept ETF or general chart requests that the stock binder rejects', async () => {
  for (const [query, entity] of [
    ['KODEX 200 차트', { code: '069500', kind: 'etf', market: '8' }],
    ['매출 차트 보여줘', null],
  ]) {
    const routed = await runSimpleChartFastPath({
      query,
      index: { size: 2, resolveQuery: () => entity },
      ensureReady: async () => assert.fail('ready index must not wait'),
      buildDataset: () => null,
      runDataset: async () => assert.fail('must not run a stock chart'),
    });
    assert.equal(routed.handled, false, query);
  }
});

test('does not claim ETF or general chart requests while the stock index is unavailable', async () => {
  for (const query of ['KODEX 200 차트', '매출 차트 보여줘']) {
    const routed = await runSimpleChartFastPath({
      query,
      index: { size: 0, resolveQuery: () => null },
      ensureReady: async () => false,
      buildDataset: () => assert.fail('unready index must not bind'),
      runDataset: async () => assert.fail('unready index must not run'),
    });
    assert.equal(routed.handled, false, query);
    assert.equal(routed.reason, 'stock-index-not-ready', query);
    assert.equal(routed.inferenceFallback.source, 'stock-index-not-ready', query);
  }
});

test('abstains without waiting for non-simple or analysis-heavy chart questions', async () => {
  let readinessCalls = 0;
  for (const query of [
    '삼성전자 왜 떨어졌어?',
    '삼성전자 차트 분석해줘',
    '삼성전자와 SK하이닉스 차트 비교해줘',
    '삼성전자 분봉 차트 보여줘',
    '삼성전자 뉴스 보여줘',
    '안녕하세요',
  ]) {
    const routed = await runSimpleChartFastPath({
      query,
      index: { size: 0 },
      ensureReady: async () => { readinessCalls += 1; return false; },
      buildDataset: () => null,
      runDataset: async () => assert.fail('must not run a dataset'),
    });
    assert.equal(routed.handled, false, query);
  }
  assert.equal(readinessCalls, 0);
});

test('recognizes the narrow daily-chart display grammar', () => {
  for (const query of [
    '삼성전자 차트 보여줘',
    '005930 일봉 보여 줘',
    '삼성전자 일봉 차트',
    '005930 일봉 차트 띄워줘',
    '삼성전자 차트 좀 확인해 주세요',
  ]) {
    assert.equal(isSimpleDailyChartQuery(query), true, query);
  }
  for (const query of ['삼성전자 주봉 차트', '삼성전자 차트 왜 이래?', '차트 보여줘']) {
    assert.equal(isSimpleDailyChartQuery(query), false, query);
  }
});
