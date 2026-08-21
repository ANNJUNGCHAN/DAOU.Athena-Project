// query-cache.js — L1 완전일치 판정 캐시의 계약: 정규화·TTL·FIFO 상한.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  QueryCache,
  normalizeQuery,
  buildReplayJudgment,
  isReplaySafePreferredRef,
  ReplayTurnCapture,
  sanitizeCacheValue,
} = require('./query-cache');

test('normalizeQuery: 공백·대소문자·말미 문장부호만 다듬는다', () => {
  assert.equal(normalizeQuery('  삼성전자   차트 보여줘?? '), '삼성전자 차트 보여줘');
  assert.equal(normalizeQuery('Samsung Chart'), 'samsung chart');
  assert.equal(normalizeQuery(''), '');
  // 의미가 다른 문장은 다른 키 — 조사·어미를 뭉개지 않는다(L1은 완전일치다)
  assert.notEqual(normalizeQuery('삼성전자 차트'), normalizeQuery('삼전 차트'));
});

test('QueryCache: 같은 질문(정규화 동치)이 판정을 재사용한다', () => {
  let t = 0;
  const cache = new QueryCache({ clock: () => t });
  // 캐시는 judgment 형상을 모른다(불투명 저장) — P5부터 canvasType은 판정
  // 객체에 없다(operation_ref의 순수 함수라 응답값을 쓴다, fast-path.js).
  cache.set('삼성전자 차트 보여줘', { resolveQuestion: '삼성전자 차트' });
  assert.deepEqual(cache.get('  삼성전자  차트 보여줘! '), { resolveQuestion: '삼성전자 차트' });
});

test('QueryCache: TTL 만료 시 무효 — 낡은 판정을 재사용하지 않는다', () => {
  let t = 0;
  const cache = new QueryCache({ ttlMs: 1000, clock: () => t });
  cache.set('q', { resolveQuestion: 'q' });
  t = 1001;
  assert.equal(cache.get('q'), null);
});

test('QueryCache: 상한 초과 시 가장 오래된 항목부터 축출(FIFO)', () => {
  const cache = new QueryCache({ maxEntries: 2, clock: () => 0 });
  cache.set('a', { n: 1 });
  cache.set('b', { n: 2 });
  cache.set('c', { n: 3 });
  assert.equal(cache.get('a'), null);
  assert.deepEqual(cache.get('c'), { n: 3 });
});

test('QueryCache: invalidate — 실패한 판정은 반복 리플레이되지 않는다', () => {
  const cache = new QueryCache({ clock: () => 0 });
  cache.set('q', { resolveQuestion: 'q' });
  cache.invalidate('q');
  assert.equal(cache.get('q'), null);
});

test('buildReplayJudgment: canonical 조회 assertion만 보존하고 candidate_refs는 버린다', () => {
  const judgment = buildReplayJudgment({
    question: '삼성전자 오늘 주가',
    intent: 'query',
    candidate_refs: ['base:ka20001', 'base:ka10001'],
    preferred_ref: 'base:ka10001',
    detail_group: 'market_snapshot',
    response_mode: 'compact',
    arguments: { stk_cd: '005930' },
  }, {
    plan_token: 'one-time-token',
    canvas_type: 'action', // 모델 요청값은 권위가 아니다.
    data: { symbol: '005930', cur_prc: '70500' },
    caption: '삼성전자 현재가',
  }, ['table'], 'one-time-token'); // manifest 타입 + resolve 결과 토큰만 권위다.

  assert.deepEqual(judgment, {
    resolveQuestion: '삼성전자 오늘 주가',
    resolveIntent: 'query',
    resolveArgs: { stk_cd: '005930' },
    preferredRef: 'base:ka10001',
    detailGroup: 'market_snapshot',
    responseMode: 'compact',
    caption: '삼성전자 현재가',
  });
  assert.equal('data' in judgment, false);
  assert.equal('candidateRefs' in judgment, false);
  assert.equal('candidate_refs' in judgment, false);
});

test('buildReplayJudgment: optional camelCase wire aliases도 방어적으로 받는다', () => {
  const judgment = buildReplayJudgment({
    question: 'q', intent: 'auto', preferredRef: 'base:ka10001',
    detailGroup: null, responseMode: 'full',
  }, { plan_token: 'tok', canvas_type: 'free' }, ['chart'], 'tok');
  assert.equal(judgment.preferredRef, 'base:ka10001');
  assert.equal(judgment.detailGroup, null);
  assert.equal(judgment.responseMode, 'full');
});

test('buildReplayJudgment: assertion 없는 후보·주문·WS·OAuth·비조회 intent는 캐시하지 않는다', () => {
  const render = { plan_token: 'tok', canvas_type: 'table' };
  assert.equal(buildReplayJudgment({ question: 'q', intent: 'query', candidate_refs: ['base:ka10001'] }, render, ['table'], 'tok'), null);
  assert.equal(buildReplayJudgment({ question: 'q', intent: 'auto', preferred_ref: 'base:kt10000' }, render, ['action'], 'tok'), null);
  assert.equal(buildReplayJudgment({ question: 'q', intent: 'query', preferred_ref: 'ws:0B' }, render, ['event'], 'tok'), null);
  assert.equal(buildReplayJudgment({ question: 'q', intent: 'query', preferred_ref: 'oauth:token' }, render, ['status'], 'tok'), null);
  assert.equal(buildReplayJudgment({ question: 'q', intent: 'order', preferred_ref: 'base:ka10001' }, render, ['table'], 'tok'), null);
  assert.equal(isReplaySafePreferredRef('detail:ka10001:valuation'), true);
});

test('buildReplayJudgment: read-only kt 조회는 접두어가 아니라 manifest 카드로 허용한다', () => {
  const judgment = buildReplayJudgment({
    question: '예수금 조회', intent: 'auto', preferred_ref: 'base:kt00001',
  }, { plan_token: 'tok', canvas_type: 'action' }, ['table'], 'tok');
  assert.equal(judgment.preferredRef, 'base:kt00001');
});

test('buildReplayJudgment: 여러 실제 카드가 섞인 턴은 캡처 대응이 불명확해 캐시하지 않는다', () => {
  const judgment = buildReplayJudgment({
    question: '복합 조회', intent: 'query', preferred_ref: 'base:ka10001',
  }, { plan_token: 'tok', canvas_type: 'table' }, ['chart', 'table'], 'tok');
  assert.equal(judgment, null);
});

function toolUse(id, name, input) {
  return { type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } };
}

function toolResult(toolUseId, body, isError = false) {
  return {
    type: 'user',
    message: { content: [{
      type: 'tool_result', tool_use_id: toolUseId,
      content: JSON.stringify(body), is_error: isError,
    }] },
  };
}

const RESOLVE_INPUT = {
  question: '삼성전자 현재가', intent: 'query', preferred_ref: 'base:ka10001',
  response_mode: 'compact', arguments: { stk_cd: '005930' },
};

test('ReplayTurnCapture: 단일 successful resolve와 matching render만 캐시한다', () => {
  const capture = new ReplayTurnCapture();
  capture.observe(toolUse('resolve-1', 'mcp__athena__athena_resolve', RESOLVE_INPUT));
  capture.observe(toolResult('resolve-1', { plan_token: 'plan-1', operation_ref: 'base:ka10001' }));
  capture.observe(toolUse('render-1', 'mcp__athena__athena__render_canvas', {
    plan_token: 'plan-1', data: { symbol: '005930' }, caption: '현재가',
  }));

  const judgment = capture.buildJudgment(['table']);
  assert.equal(judgment.preferredRef, 'base:ka10001');
  assert.equal('data' in judgment, false);
});

test('cache snapshot recursively excludes payload, plan token, account and order data', () => {
  const cache = new QueryCache({ clock: () => 0 });
  cache.set('secure', {
    resolveQuestion: '안전한 조회',
    resolveArgs: {
      stk_cd: '005930',
      account_no: '123-45',
      nested: { order_qty: 7, ord_tp: '1', base_dt: '20260821' },
    },
    data: { cur_prc: '70500' },
    payload: { rows: [1, 2] },
    plan_token: 'one-time-secret',
    account: { id: 'sensitive' },
    orderData: { side: 'buy' },
  });
  const snapshot = cache.get('secure');
  const serialized = JSON.stringify(snapshot);
  assert.deepEqual(snapshot.resolveArgs, {
    stk_cd: '005930',
    nested: { base_dt: '20260821' },
  });
  for (const forbidden of ['70500', 'rows', 'one-time-secret', '123-45', 'sensitive', 'buy']) {
    assert.equal(serialized.includes(forbidden), false);
  }
  const cachedKeys = [];
  JSON.stringify(snapshot, (key, value) => {
    if (key) cachedKeys.push(key.toLowerCase().replace(/[^a-z0-9가-힣]/g, ''));
    return value;
  });
  assert.equal(cachedKeys.some((key) => key === 'data'
    || key === 'payload'
    || key === 'plantoken'
    || /^(?:account|acct|acnt|order)/.test(key)
    || /^ord(?!inal)/.test(key)
    || /계좌|주문/.test(key)), false);
  assert.deepEqual(sanitizeCacheValue({ ordinal: 1, order_no: 'x' }), { ordinal: 1 });
});

test('ReplayTurnCapture: successful resolve가 두 건이면 render가 하나여도 캐시하지 않는다', () => {
  const capture = new ReplayTurnCapture();
  capture.observe(toolUse('resolve-1', 'mcp__athena__athena_resolve', RESOLVE_INPUT));
  capture.observe(toolResult('resolve-1', { plan_token: 'plan-1' }));
  capture.observe(toolUse('resolve-2', 'mcp__athena__athena_resolve', RESOLVE_INPUT));
  capture.observe(toolResult('resolve-2', { plan_token: 'plan-2' }));
  capture.observe(toolUse('render-1', 'mcp__athena__athena__render_canvas', { plan_token: 'plan-2' }));
  assert.equal(capture.buildJudgment(['table']), null);
});

test('ReplayTurnCapture: resolve output과 render input의 plan_token이 다르면 캐시하지 않는다', () => {
  const capture = new ReplayTurnCapture();
  capture.observe(toolUse('resolve-1', 'mcp__athena__athena_resolve', RESOLVE_INPUT));
  capture.observe(toolResult('resolve-1', { plan_token: 'plan-A' }));
  capture.observe(toolUse('render-1', 'mcp__athena__athena__render_canvas', { plan_token: 'plan-B' }));
  assert.equal(capture.buildJudgment(['table']), null);
});
