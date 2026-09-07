'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchChartSeries } = require('./chart-series');

test('series-page A/B는 검증된 서버 alias와 redirect 차단을 보낸다', async () => {
  for (const backendAccountAlias of ['server-a', 'server-b']) {
    const calls = [];
    const result = await fetchChartSeries({
      backendBase: 'http://backend', backendAccountAlias,
      operationRef: 'base:ka10064', fields: ['frgnr_invsr'],
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({ series: [{ field: 'frgnr_invsr', points: [{ time: 1, value: 2 }] }] }) };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers['X-Athena-Account'], backendAccountAlias);
    assert.equal(calls[0].options.redirect, 'error');
  }
});

test('series-page alias 누락/형식 오류는 fetch 전에 차단한다', async () => {
  let fetches = 0;
  for (const backendAccountAlias of ['', 'LOCAL-UUID', 'server a']) {
    const result = await fetchChartSeries({
      backendBase: 'http://backend', backendAccountAlias,
      operationRef: 'base:ka10064', fields: ['frgnr_invsr'],
      fetchImpl: async () => { fetches += 1; },
    });
    assert.equal(result.ok, false);
  }
  assert.equal(fetches, 0);
});

test('series-page redirect 거부는 빈 성공으로 바꾸지 않는다', async () => {
  const result = await fetchChartSeries({
    backendBase: 'http://backend', backendAccountAlias: 'server-a',
    operationRef: 'base:ka10064', fields: ['frgnr_invsr'],
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'error');
      throw new TypeError('redirect disallowed');
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /redirect disallowed/);
});
