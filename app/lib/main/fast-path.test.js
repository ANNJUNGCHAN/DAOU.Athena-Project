// fast-path.js — 캐시 리플레이 실행기의 계약: resolve→render-plan 2호출,
// 결정론 답변(재사용 고지 필수), 실패는 reason으로 정직 반환(폴백 유도).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReplayAnswer, runCachedReplay } = require('./fast-path');

const JUDGMENT = {
  resolveQuestion: '삼성전자 005930 일봉 차트',
  resolveArgs: { stk_cd: '005930', base_dt: '20260819', upd_stkpc_tp: '1' },
  canvasType: 'chart',
  data: { symbol: '005930', name: '삼성전자' },
  caption: '삼성전자 일봉',
};

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    for (const [suffix, responder] of routes) {
      if (url.endsWith(suffix)) return responder();
    }
    throw new Error(`unexpected url: ${url}`);
  };
  impl.calls = calls;
  return impl;
}

function jsonRes(status, body) {
  return { ok: status < 400, status, json: async () => body };
}

test('runCachedReplay: resolve→render-plan 2호출로 완결, 답변에 재사용 고지', async () => {
  const doFetch = fakeFetch([
    ['/api/v1/llm/tools/resolve', () => jsonRes(200, { plan_token: 'tok-9' })],
    ['/api/v1/canvas/render-plan', () => jsonRes(200, {
      queued: true, canvas_type: 'chart',
      summary: { rows_total: 600, rows_kept: 240, trimmed: true,
        first_time: '2025-08-25', last_time: '2026-08-19', latest_close: 247500 },
    })],
  ]);
  const result = await runCachedReplay({
    judgment: JUDGMENT, backendBase: 'http://b', fetchImpl: doFetch, clock: () => 0,
  });
  assert.equal(result.ok, true);
  assert.equal(doFetch.calls.length, 2);
  assert.equal(doFetch.calls[1].body.plan_token, 'tok-9');
  assert.equal(doFetch.calls[0].body.intent, 'auto'); // 조회 표면만
  assert.ok(result.answerText.includes('삼성전자'));
  assert.ok(result.answerText.includes('247,500'));
  assert.ok(result.answerText.includes('240봉'));
  assert.ok(result.answerText.includes('이전 해석을 재사용')); // 정직 고지 필수
  assert.ok(result.answerText.includes('전체 600봉 중')); // trimmed 고지
});

test('runCachedReplay: plan_token이 없으면 폴백 사유를 돌려준다', async () => {
  const doFetch = fakeFetch([
    ['/api/v1/llm/tools/resolve', () => jsonRes(200, { status: 'needs_arguments' })],
  ]);
  const result = await runCachedReplay({
    judgment: JUDGMENT, backendBase: 'http://b', fetchImpl: doFetch, clock: () => 0,
  });
  assert.equal(result.ok, false);
  assert.ok(result.reason.includes('plan_token'));
});

test('runCachedReplay: render-plan 실패(HTTP)도 조용히 삼키지 않는다', async () => {
  const doFetch = fakeFetch([
    ['/api/v1/llm/tools/resolve', () => jsonRes(200, { plan_token: 't' })],
    ['/api/v1/canvas/render-plan', () => jsonRes(422, { detail: '차트 변환 실패' })],
  ]);
  const result = await runCachedReplay({
    judgment: JUDGMENT, backendBase: 'http://b', fetchImpl: doFetch, clock: () => 0,
  });
  assert.equal(result.ok, false);
  assert.ok(result.reason.includes('422'));
});

test('buildReplayAnswer: table 형상도 결정론 — 행·열과 재사용 고지', () => {
  const text = buildReplayAnswer(
    { canvasType: 'table', data: {} },
    { rows_kept: 30, rows_total: 30, columns: ['a', 'b', 'c'] },
  );
  assert.ok(text.includes('30행'));
  assert.ok(text.includes('3열'));
  assert.ok(text.includes('이전 해석을 재사용'));
});
