'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CLARIFICATION, resolveGoldQuoteTurn } = require('./gold-quote-intent');

test('금현물 일반 시세는 상품을 고르지 않고 로컬 질문으로 멈춘다', () => {
  const result = resolveGoldQuoteTurn('금현물 시세 알려줘');
  assert.deepEqual(result, {
    handled: true,
    status: 'collecting',
    state: { awaitingProduct: true },
    routeQuery: null,
    answerText: CLARIFICATION,
  });
  assert.match(result.answerText, /금 99\.99_1kg/);
  assert.match(result.answerText, /미니금 99\.99_100g/);
});

test('후속 1kg 선택은 명시적 상품코드 시세 질의로 기존 Selector에 넘긴다', () => {
  const pending = resolveGoldQuoteTurn('금현물 시세 알려줘');
  const selected = resolveGoldQuoteTurn('금99.99 1kg', pending.state);
  assert.equal(selected.handled, false);
  assert.equal(selected.status, 'selected');
  assert.equal(selected.state, null);
  assert.equal(selected.productCode, 'M04020000');
  assert.equal(selected.routeQuery, '금 상품코드 M04020000의 현재 시세를 알려줘');
});

test('후속 미니금 선택은 미니금 상품코드를 명시한다', () => {
  const selected = resolveGoldQuoteTurn('미니금 100g', { awaitingProduct: true });
  assert.equal(selected.productCode, 'M04020100');
  assert.match(selected.routeQuery, /M04020100/);
});

test('명시된 금 상품 시세와 주문 요청은 일반 시세 확인 질문이 가로채지 않는다', () => {
  for (const query of [
    '금 99.99 1kg 시세 알려줘',
    '미니금 현재가 알려줘',
    '금현물 시장가 매수',
  ]) {
    assert.equal(resolveGoldQuoteTurn(query).handled, false, query);
  }
});

test('대기 중 무관한 발화는 상태를 지우고 일반 라우팅으로 넘긴다', () => {
  assert.deepEqual(resolveGoldQuoteTurn('삼성전자 시세 알려줘', { awaitingProduct: true }), {
    handled: false,
    reason: 'unrelated_to_pending_gold_quote',
    state: null,
    clear: true,
  });
});

test('main은 금 주문을 우선하고 일반 시세 질문만 로컬 응답한 뒤 선택 질의를 Selector로 넘긴다', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const orderAt = source.indexOf('goldOrderIntent.resolveGoldOrderTurn(query');
  const quoteAt = source.indexOf('goldQuoteIntent.resolveGoldQuoteTurn(query');
  const selectorAt = source.indexOf('stockMasterClient.resolveCurrentStockMasterQuery(query', quoteAt);
  assert.ok(orderAt >= 0 && quoteAt > orderAt && selectorAt > quoteAt);
  assert.match(source.slice(orderAt, quoteAt), /runtime\.pendingGoldQuote = null/);
  assert.match(source.slice(quoteAt, selectorAt), /source: 'gold-quote-clarification'/);
  assert.match(source.slice(quoteAt, selectorAt), /modelCalls: 0/);
  assert.match(source.slice(quoteAt, selectorAt), /if \(goldQuote\.routeQuery\) query = goldQuote\.routeQuery/);
});
