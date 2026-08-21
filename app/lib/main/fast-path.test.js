// fast-path.js — 캐시 리플레이 실행기의 계약: resolve→render-plan 2호출,
// 결정론 답변(재사용 고지 필수), 실패는 reason으로 정직 반환(폴백 유도).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReplayAnswer, runCachedReplay } = require('./fast-path');

// P5(2026-08-20)부터 judgment는 canvasType을 담지 않는다 — 카드 종류는
// operation_ref의 순수 함수라 백엔드가 render-plan 응답으로 돌려준다.
const JUDGMENT = {
  resolveQuestion: '삼성전자 005930 일봉 차트',
  resolveIntent: 'query',
  resolveArgs: { stk_cd: '005930', base_dt: '20260819', upd_stkpc_tp: '1' },
  preferredRef: 'base:ka10081',
  detailGroup: null,
  responseMode: 'full',
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
      receipt: { pushed: true, delivery: 'side_channel', canvas_type: 'chart', trimmed: true, cache_reused: true },
    })],
  ]);
  const result = await runCachedReplay({
    judgment: JUDGMENT, backendBase: 'http://b', fetchImpl: doFetch, clock: () => 0,
  });
  assert.equal(result.ok, true);
  assert.equal(doFetch.calls.length, 2);
  assert.equal(doFetch.calls[1].body.plan_token, 'tok-9');
  assert.equal('data' in doFetch.calls[1].body, false);
  assert.equal(doFetch.calls[0].body.intent, 'query'); // 저장한 조회 intent 유지
  assert.equal(doFetch.calls[0].body.preferred_ref, 'base:ka10081');
  assert.equal(doFetch.calls[0].body.detail_group, null);
  assert.equal(doFetch.calls[0].body.response_mode, 'full');
  assert.equal('candidate_refs' in doFetch.calls[0].body, false);
  assert.equal(result.canvasType, 'chart'); // 응답값을 그대로 노출(main.js가 canvasTypes에 씀)
  assert.equal(result.answerText, '캔버스에 표시했습니다. 이전 해석을 재사용했고 데이터는 새로 조회했습니다.');
  assert.equal(result.answerText.includes('삼성전자'), false);
  assert.equal(result.answerText.includes('247,500'), false);
  assert.equal(result.answerText.includes('240봉'), false);
});

test('runCachedReplay: cached payload and sensitive extras are never sent to render-plan', async () => {
  const doFetch = fakeFetch([
    ['/api/v1/llm/tools/resolve', () => jsonRes(200, { plan_token: 'fresh-token' })],
    ['/api/v1/canvas/render-plan', () => jsonRes(200, {
      queued: true, canvas_type: 'chart', receipt: { pushed: true, canvas_type: 'chart' },
    })],
  ]);
  await runCachedReplay({
    judgment: {
      ...JUDGMENT,
      resolveArgs: { ...JUDGMENT.resolveArgs, account_no: '123-45', order_qty: 3 },
      data: { price: '70500' },
      payload: { rows: ['secret'] },
      plan_token: 'stale-token',
      account: { number: '123-45' },
      orderData: { side: 'buy' },
    },
    backendBase: 'http://b',
    fetchImpl: doFetch,
    clock: () => 0,
  });
  assert.deepEqual(doFetch.calls[1].body, {
    plan_token: 'fresh-token',
    caption: '삼성전자 일봉',
  });
  assert.deepEqual(doFetch.calls[0].body.arguments, JUDGMENT.resolveArgs);
});

test('runCachedReplay: render-plan 요청에 canvas_type 필드를 싣지 않는다', async () => {
  // P5 — judgment에 canvasType이 없으므로 보낼 값 자체가 없다. 백엔드
  // (canvas_push.py::RenderPlanRequest)가 이제 선택 필드로 받아들인다.
  const doFetch = fakeFetch([
    ['/api/v1/llm/tools/resolve', () => jsonRes(200, { plan_token: 'tok-1' })],
    ['/api/v1/canvas/render-plan', () => jsonRes(200, {
      queued: true, canvas_type: 'table', receipt: { pushed: true, canvas_type: 'table' },
    })],
  ]);
  await runCachedReplay({
    judgment: JUDGMENT, backendBase: 'http://b', fetchImpl: doFetch, clock: () => 0,
  });
  assert.equal('canvas_type' in doFetch.calls[1].body, false);
});

test('runCachedReplay: 캐시가 낡은 카드 종류를 몰라도 응답값으로 정확한 문구를 만든다', async () => {
  // 판정 저장 시점의 모델 선택은 이제 캐시에 없다 — manifest가 재분류해도
  // (예: 재생성 이후 chart→table로 바뀌어도) 응답값 기준으로 정확히 답한다.
  const doFetch = fakeFetch([
    ['/api/v1/llm/tools/resolve', () => jsonRes(200, { plan_token: 'tok-2' })],
    ['/api/v1/canvas/render-plan', () => jsonRes(200, {
      queued: true, canvas_type: 'table',
      receipt: { pushed: true, canvas_type: 'table' },
    })],
  ]);
  const result = await runCachedReplay({
    judgment: JUDGMENT, backendBase: 'http://b', fetchImpl: doFetch, clock: () => 0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.answerText, '캔버스에 표시했습니다. 이전 해석을 재사용했고 데이터는 새로 조회했습니다.');
  assert.equal(result.answerText.includes('12행'), false);
  assert.equal(result.answerText.includes('종목'), false);
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

test('runCachedReplay: stale canonical assertion 거부는 폴백 사유로 반환하고 렌더하지 않는다', async () => {
  const doFetch = fakeFetch([
    ['/api/v1/llm/tools/resolve', () => jsonRes(409, { detail: 'preferred_ref mismatch' })],
  ]);
  const result = await runCachedReplay({
    judgment: JUDGMENT, backendBase: 'http://b', fetchImpl: doFetch, clock: () => 0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'resolve HTTP 409');
  assert.equal(doFetch.calls.length, 1);
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

test('buildReplayAnswer: 성공 영수증은 데이터 행·열·값을 입력받지도 노출하지도 않는다', () => {
  const text = buildReplayAnswer();
  assert.equal(text, '캔버스에 표시했습니다. 이전 해석을 재사용했고 데이터는 새로 조회했습니다.');
  assert.equal(text.includes('30행'), false);
  assert.equal(text.includes('3열'), false);
});
