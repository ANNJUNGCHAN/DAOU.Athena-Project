'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { StockEntityIndex } = require('./rest-dataset-runner');
const { buildMarketOrderDraft } = require('./selector-fast-path');
const {
  createQueryScopedIndex,
  fetchStockMasterStatus,
  recoverStockMasterReady,
  resolveCurrentStockMasterQuery,
  resolveStockMasterQuery,
  waitForStockMasterReady,
} = require('./stock-master-client');

function jsonResponse(body) {
  return { ok: true, json: async () => body };
}

test('SQLite 종목 검색은 질문 한 건만 백엔드에 보내고 계좌 헤더를 요구하지 않는다', async () => {
  const calls = [];
  const resolution = await resolveStockMasterQuery('삼성전자 차트 보여줘', {
    backendBase: 'http://backend',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        ready: true,
        instrument: { code: '005930', name: '삼성전자', marketCode: '0', kind: 'stock' },
      });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://backend/api/v1/instruments/resolve');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers['X-Athena-Account'], undefined);
  assert.deepEqual(JSON.parse(calls[0].options.body), { question: '삼성전자 차트 보여줘' });
  assert.equal(resolution.instrument.code, '005930');
});

test('질의 범위 인덱스는 SQLite가 찾은 한 종목만 기존 닫힌 문법에 제공한다', () => {
  const index = createQueryScopedIndex(StockEntityIndex, {
    ready: true,
    instrument: { code: '005930', name: '삼성전자', marketCode: '0', kind: 'stock' },
  });

  assert.equal(index.size, 1);
  assert.equal(index.resolveQuery('삼성전자 차트').code, '005930');
  assert.equal(index.resolveQuery('005930 차트').code, '005930');
  assert.equal(index.resolveQuery('SK하이닉스 차트'), null);
  assert.equal(buildMarketOrderDraft('삼성전자 3주 시장가 매수', index).arguments.stk_cd, '005930');
  assert.equal(buildMarketOrderDraft('삼성전자 우선주 3주 시장가 매수', index), null);
});

test('준비됐지만 검색 결과가 없으면 빈 질의 인덱스를 만든다', async () => {
  const resolution = await resolveStockMasterQuery('없는 종목', {
    backendBase: 'http://backend',
    fetchImpl: async () => jsonResponse({ ready: true, instrument: null }),
  });
  const index = createQueryScopedIndex(StockEntityIndex, resolution);
  assert.equal(resolution.ready, true);
  assert.equal(index.size, 0);
});

test('시장과 종목 종류가 충돌한 응답은 사용하지 않는다', async () => {
  await assert.rejects(resolveStockMasterQuery('삼성전자', {
    backendBase: 'http://backend',
    fetchImpl: async () => jsonResponse({
      ready: true,
      instrument: { code: '005930', name: '삼성전자', marketCode: '0', kind: 'etf' },
    }),
  }), /신원 정보/);
});

test('부팅 준비는 SQLite 상태만 폴링하고 전체 종목 API를 호출하지 않는다', async () => {
  let requests = 0;
  const status = await waitForStockMasterReady({
    backendBase: 'http://backend', timeoutMs: 100, pollIntervalMs: 1, wait: async () => {},
    fetchImpl: async (url, options) => {
      requests += 1;
      assert.equal(url, 'http://backend/api/v1/instruments/status');
      assert.equal(options.method, 'GET');
      return jsonResponse(requests === 1
        ? { ready: false, size: 0, refreshedAt: null }
        : { ready: true, size: 3210, refreshedAt: '2026-09-08T00:00:00Z' });
    },
  });
  assert.equal(requests, 2);
  assert.equal(status.size, 3210);
  assert.equal((await fetchStockMasterStatus({
    backendBase: 'http://backend',
    fetchImpl: async () => jsonResponse({ ready: true, size: 1, refreshedAt: 'now' }),
  })).ready, true);
});

test('멈춘 상태 요청은 부팅 제한시간 안에 중단된다', async () => {
  const startedAt = Date.now();
  const status = await waitForStockMasterReady({
    backendBase: 'http://backend',
    timeoutMs: 15,
    pollIntervalMs: 1,
    fetchImpl: async () => new Promise(() => {}),
  });
  assert.equal(status, null);
  assert.ok(Date.now() - startedAt < 250);
});

test('늦은 SQLite 준비 회복은 준비 성공 때 멈추고 종료 signal은 대기를 즉시 끝낸다', async () => {
  let requests = 0;
  const waits = [];
  const recovered = await recoverStockMasterReady({
    backendBase: 'http://backend',
    retryBaseMs: 1,
    retryMaxMs: 2,
    wait: async (ms) => { waits.push(ms); },
    fetchImpl: async () => {
      requests += 1;
      return jsonResponse(requests < 3
        ? { ready: false, size: 0, refreshedAt: null }
        : { ready: true, size: 3210, refreshedAt: 'now' });
    },
  });
  assert.equal(recovered.size, 3210);
  assert.equal(requests, 3);
  assert.deepEqual(waits, [1, 2]);

  const controller = new AbortController();
  const pending = recoverStockMasterReady({
    backendBase: 'http://backend',
    signal: controller.signal,
    fetchImpl: async () => jsonResponse({ ready: false, size: 0, refreshedAt: null }),
    wait: () => new Promise(() => {}),
  });
  controller.abort(new Error('Athena 앱 종료'));
  assert.equal(await pending, null);
});

test('앱 종료 signal은 진행 중인 종목 검색을 중단한다', async () => {
  const controller = new AbortController();
  const pending = resolveStockMasterQuery('삼성전자', {
    backendBase: 'http://backend',
    timeoutMs: 5_000,
    signal: controller.signal,
    fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });
  controller.abort(new Error('Athena 앱 종료'));
  await assert.rejects(pending, /Athena 앱 종료/);
});

test('늦게 끝난 이전 질의는 다음 질의의 종목 결과를 덮거나 빌더에 도달하지 않는다', async () => {
  const runtime = {};
  let finishFirst;
  const firstFetch = new Promise((resolve) => { finishFirst = resolve; });
  const first = resolveCurrentStockMasterQuery('삼성전자 차트', {
    runtime,
    backendBase: 'http://backend',
    fetchImpl: async () => firstFetch,
  });
  const firstRejected = assert.rejects(first, (error) => error.code === 'stock_master_superseded');
  const second = resolveCurrentStockMasterQuery('SK하이닉스 차트', {
    runtime,
    backendBase: 'http://backend',
    fetchImpl: async () => jsonResponse({
      ready: true,
      instrument: { code: '000660', name: 'SK하이닉스', marketCode: '0', kind: 'stock' },
    }),
  });

  const secondResolution = await second;
  finishFirst(jsonResponse({
    ready: true,
    instrument: { code: '005930', name: '삼성전자', marketCode: '0', kind: 'stock' },
  }));
  await firstRejected;
  const index = createQueryScopedIndex(StockEntityIndex, secondResolution);
  assert.equal(index.resolveQuery('SK하이닉스 차트').code, '000660');
  assert.equal(index.resolveQuery('삼성전자 차트'), null);
});

test('production main은 전체 종목 메모리 refresh 없이 SQLite 질의 조회를 연결한다', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  assert.doesNotMatch(source, /new restDatasetRunner\.StockEntityIndex\(\)/);
  assert.doesNotMatch(source, /restDatasetRunner\.refreshStockEntityIndex/);
  assert.doesNotMatch(source, /stockEntityIndexReadiness/);
  assert.match(source, /stockMasterClient\.resolveCurrentStockMasterQuery\(query/);
  assert.match(source, /stockMasterClient\.createQueryScopedIndex\(/);
  assert.match(source, /stockMasterClient\.waitForStockMasterReady\(/);
  const turnStart = source.indexOf('async function runLiveQueryInnerBody(');
  const lookup = source.indexOf('stockMasterClient.resolveCurrentStockMasterQuery(query', turnStart);
  const priorAbort = source.indexOf('runtime.activeStockMasterLookup.abort', turnStart);
  assert.ok(turnStart >= 0 && priorAbort > turnStart && priorAbort < lookup);
});
