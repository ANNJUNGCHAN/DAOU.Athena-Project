'use strict';

// backtest-bridge.js 단위 테스트 — 주입식 fetchImpl로 실네트워크 없이 검증한다
// (chart-series.js 테스트 관례와 같은 자리). 핵심은 두 가지: (1) 모든 함수가
// {ok:true,data}|{ok:false,status,error} 봉투를 지키는가, (2) run()의 409가
// detail(needed_pages/est_seconds)을 잃지 않고 올라오는가(backtest-mode-plan.md §9).

const test = require('node:test');
const assert = require('node:assert/strict');
const backtestBridge = require('./backtest-bridge');

function fakeFetch(status, body) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

test('fetchPresets: 200 → {ok:true, data}', async () => {
  const res = await backtestBridge.fetchPresets({
    backendBase: 'http://x',
    fetchImpl: fakeFetch(200, { presets: [{ id: 'p1', name: '이평 교차', category: 'trend', yaml: 'x' }] }),
  });
  assert.deepEqual(res, { ok: true, data: { presets: [{ id: 'p1', name: '이평 교차', category: 'trend', yaml: 'x' }] } } );
});

test('fetchPresets: 네트워크 예외 → {ok:false, status:0, error}', async () => {
  const res = await backtestBridge.fetchPresets({
    backendBase: 'http://x',
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 0);
  assert.match(res.error, /ECONNREFUSED/);
});

test('runBacktest: 202 → {ok:true, data:{run_id}}', async () => {
  let capturedBody = null;
  const res = await backtestBridge.runBacktest({
    backendBase: 'http://x',
    fetchImpl: async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 202, json: async () => ({ run_id: 'r1' }) };
    },
    yaml: 'strategy: x',
  });
  assert.deepEqual(res, { ok: true, data: { run_id: 'r1' } });
  assert.deepEqual(capturedBody, { yaml: 'strategy: x' });
});

test('runBacktest: 409(캐시 부족) → ok:false지만 detail(needed_pages/est_seconds)을 싣는다', async () => {
  const res = await backtestBridge.runBacktest({
    backendBase: 'http://x',
    fetchImpl: fakeFetch(409, { detail: { needed_pages: 12, est_seconds: 12 } }),
    yaml: 'strategy: x',
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
  assert.deepEqual(res.detail, { needed_pages: 12, est_seconds: 12 });
});

test('runBacktest: 일반 오류(500, 문자열 detail)는 detail 없이 error 메시지만 싣는다', async () => {
  const res = await backtestBridge.runBacktest({
    backendBase: 'http://x',
    fetchImpl: fakeFetch(500, { detail: '내부 오류' }),
    yaml: 'x',
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 500);
  assert.equal(res.error, '내부 오류');
  assert.equal(res.detail, undefined);
});

test('planBacktest/backfillBacktest: backendBase/fetchImpl을 제외한 나머지 필드를 몸체로 그대로 보낸다', async () => {
  let seenPlanBody = null;
  let seenBackfillBody = null;
  await backtestBridge.planBacktest({
    backendBase: 'http://x',
    fetchImpl: async (url, opts) => { seenPlanBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({}) }; },
    stk_cd: '005930', period: 'day', adjusted: true, from_dt: '20200101', to_dt: '20260101',
  });
  assert.deepEqual(seenPlanBody, {
    stk_cd: '005930', period: 'day', adjusted: true, from_dt: '20200101', to_dt: '20260101',
  });

  await backtestBridge.backfillBacktest({
    backendBase: 'http://x',
    fetchImpl: async (url, opts) => { seenBackfillBody = JSON.parse(opts.body); return { ok: true, status: 202, json: async () => ({ job_id: 'j1' }) }; },
    stk_cd: '005930', period: 'day', adjusted: true, from_dt: '20200101', to_dt: '20260101',
  });
  assert.deepEqual(seenBackfillBody, {
    stk_cd: '005930', period: 'day', adjusted: true, from_dt: '20200101', to_dt: '20260101',
  });
});

test('fetchJobStatus/fetchRunResult/fetchRunTrades: id를 경로에 인코딩해서 부른다', async () => {
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => ({}) }; };
  await backtestBridge.fetchJobStatus({ backendBase: 'http://x', fetchImpl, job_id: 'j 1' });
  await backtestBridge.fetchRunResult({ backendBase: 'http://x', fetchImpl, run_id: 'r1' });
  await backtestBridge.fetchRunTrades({ backendBase: 'http://x', fetchImpl, run_id: 'r1' });
  assert.deepEqual(urls, [
    'http://x/api/v1/backtest/jobs/j%201',
    'http://x/api/v1/backtest/runs/r1',
    'http://x/api/v1/backtest/runs/r1/trades',
  ]);
});

test('fetchRuns: GET /api/v1/backtest/runs', async () => {
  let seenUrl = null;
  const res = await backtestBridge.fetchRuns({
    backendBase: 'http://x',
    fetchImpl: async (url) => { seenUrl = url; return { ok: true, status: 200, json: async () => ({ runs: [] }) }; },
  });
  assert.equal(seenUrl, 'http://x/api/v1/backtest/runs');
  assert.deepEqual(res, { ok: true, data: { runs: [] } });
});
