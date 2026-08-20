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
  resolveArgs: { stk_cd: '005930', base_dt: '20260819', upd_stkpc_tp: '1' },
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
  assert.equal(result.canvasType, 'chart'); // 응답값을 그대로 노출(main.js가 canvasTypes에 씀)
  assert.ok(result.answerText.includes('삼성전자'));
  assert.ok(result.answerText.includes('247,500'));
  assert.ok(result.answerText.includes('240봉'));
  assert.ok(result.answerText.includes('이전 해석을 재사용')); // 정직 고지 필수
  assert.ok(result.answerText.includes('전체 600봉 중')); // trimmed 고지
});

test('runCachedReplay: render-plan 요청에 canvas_type 필드를 싣지 않는다', async () => {
  // P5 — judgment에 canvasType이 없으므로 보낼 값 자체가 없다. 백엔드
  // (canvas_push.py::RenderPlanRequest)가 이제 선택 필드로 받아들인다.
  const doFetch = fakeFetch([
    ['/api/v1/llm/tools/resolve', () => jsonRes(200, { plan_token: 'tok-1' })],
    ['/api/v1/canvas/render-plan', () => jsonRes(200, {
      queued: true, canvas_type: 'table', summary: { rows_kept: 5, columns: ['a'] },
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
      summary: { rows_kept: 12, rows_total: 12, columns: ['종목', '등락률'] },
    })],
  ]);
  const result = await runCachedReplay({
    judgment: JUDGMENT, backendBase: 'http://b', fetchImpl: doFetch, clock: () => 0,
  });
  assert.equal(result.ok, true);
  assert.ok(result.answerText.includes('12행'));
  assert.ok(result.answerText.includes('2열'));
  assert.ok(!result.answerText.includes('차트')); // chart 문구로 잘못 새지 않는다
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
    'table', {},
    { rows_kept: 30, rows_total: 30, columns: ['a', 'b', 'c'] },
  );
  assert.ok(text.includes('30행'));
  assert.ok(text.includes('3열'));
  assert.ok(text.includes('이전 해석을 재사용'));
});
