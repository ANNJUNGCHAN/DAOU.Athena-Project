'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MARKET_UNSUPPORTED_REASON,
  resolveGoldOrderTurn,
  createGoldOrderIntentTracker,
} = require('./gold-order-intent');

test('금현물 주문 후속 대화에서 방향·상품·수량을 보존해 티켓 초안을 만든다', () => {
  const tracker = createGoldOrderIntentTracker();

  const start = tracker.advance('conversation-a', '금현물 시장가 매수');
  assert.equal(start.status, 'collecting');
  assert.deepEqual(start.missing, ['product', 'quantity']);
  assert.deepEqual(tracker.peek('conversation-a'), {
    side: 'buy', orderType: 'market', productCode: null, quantity: null,
  });

  const product = tracker.advance('conversation-a', '금99.99 1kg');
  assert.equal(product.status, 'collecting');
  assert.deepEqual(product.missing, ['quantity']);
  assert.equal(product.state.productCode, 'M04020000');

  const ready = tracker.advance('conversation-a', '1개');
  assert.equal(ready.status, 'ready');
  assert.equal(ready.draft.operation_ref, 'base:kt50000');
  assert.deepEqual(ready.draft.next_actions, ['open_order_ticket']);
  assert.deepEqual(ready.draft.order_draft, {
    asset_kind: 'gold',
    stk_cd: 'M04020000',
    product_name: '금 99.99_1kg',
    side: 'buy',
    ord_qty: '1',
    unit: 'g',
    requested_order_type: 'market',
    execution_supported: false,
    execution_blocker: MARKET_UNSUPPORTED_REASON,
  });
  assert.deepEqual(tracker.peek('conversation-a'), {
    side: 'buy', orderType: 'market', productCode: 'M04020000', quantity: 1,
  });
});

test('대화별 주문 상태를 섞지 않는다', () => {
  const tracker = createGoldOrderIntentTracker();
  tracker.advance('a', '금현물 시장가 매수');
  tracker.advance('b', '금현물 시장가 매도');
  tracker.advance('a', '미니금 100g');
  tracker.advance('b', '금 99.99 1kg');

  const a = tracker.advance('a', '2개');
  const b = tracker.advance('b', '3개');
  assert.equal(a.draft.operation_ref, 'base:kt50000');
  assert.equal(a.draft.order_draft.stk_cd, 'M04020100');
  assert.equal(a.draft.order_draft.ord_qty, '2');
  assert.equal(b.draft.operation_ref, 'base:kt50001');
  assert.equal(b.draft.order_draft.stk_cd, 'M04020000');
  assert.equal(b.draft.order_draft.ord_qty, '3');
});

test('대화 맥락 없는 수량·상품 단독 발화는 주문으로 취급하지 않는다', () => {
  const tracker = createGoldOrderIntentTracker();
  assert.deepEqual(tracker.advance('a', '1개'), { handled: false, reason: 'not_gold_order' });
  assert.deepEqual(
    tracker.advance('a', '금 99.99 1kg'),
    { handled: false, reason: 'not_gold_order' },
  );
});

test('한 문장에 모든 값이 있으면 바로 초안을 열 수 있다', () => {
  const tracker = createGoldOrderIntentTracker();
  const ready = tracker.advance('a', '미니금 99.99 100g 4개 시장가로 매도해줘');
  assert.equal(ready.status, 'ready');
  assert.equal(ready.draft.operation_ref, 'base:kt50001');
  assert.equal(ready.draft.order_draft.stk_cd, 'M04020100');
  assert.equal(ready.draft.order_draft.ord_qty, '4');
});

test('상품·1g·방향·티켓 요청은 주문 유형을 추정하지 않고 차단 초안을 연다', () => {
  const ready = resolveGoldOrderTurn('금99.99_1kg 1g 매수 주문 티켓을 열어줘.');
  assert.equal(ready.status, 'ready');
  assert.equal(ready.state.orderType, 'unspecified');
  assert.equal(ready.payload.order_draft.stk_cd, 'M04020000');
  assert.equal(ready.payload.order_draft.ord_qty, '1');
  assert.equal(ready.payload.order_draft.unit, 'g');
  assert.equal(ready.payload.order_draft.requested_order_type, 'unspecified');
  assert.equal(ready.payload.order_draft.execution_supported, false);
  assert.equal(Object.hasOwn(ready.payload.order_draft, 'trde_tp'), false);
  assert.equal(Object.hasOwn(ready.payload.order_draft, 'ord_uv'), false);
});

test('main 금 주문 분기는 티켓 IPC만 보내고 계좌·수량·실행을 부르지 않는다', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const start = source.indexOf('const goldDraft = goldOrderIntent.resolveGoldOrderTurn(query');
  const end = source.indexOf('const goldQuote = goldQuoteIntent.resolveGoldQuoteTurn(query');
  assert.ok(start >= 0 && end > start);
  const slice = source.slice(start, end);
  assert.match(slice, /athena:selector-order-draft/);
  assert.match(slice, /modelCalls: 0/);
  assert.equal(/athena:account-list|athena:ticket-capacity|athena:order-execute/.test(slice), false);
});

test('사용자 이력의 단가 시장가와 티켓이 안보여를 같은 차단 초안으로 복구한다', () => {
  let ready = resolveGoldOrderTurn('금99.99_1kg 1g 매수 주문 티켓을 열어줘.');
  ready = resolveGoldOrderTurn('단가 시장가', ready.state);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.state.orderType, 'market');
  const marketDraft = ready.payload.order_draft;
  assert.equal(marketDraft.stk_cd, 'M04020000');
  assert.equal(marketDraft.product_name, '금 99.99_1kg');
  assert.equal(marketDraft.ord_qty, '1');
  assert.equal(marketDraft.unit, 'g');
  assert.equal(marketDraft.requested_order_type, 'market');
  assert.equal(marketDraft.execution_supported, false);
  assert.equal(marketDraft.execution_blocker, MARKET_UNSUPPORTED_REASON);
  assert.equal(Object.hasOwn(marketDraft, 'trde_tp'), false);
  assert.equal(Object.hasOwn(marketDraft, 'ord_uv'), false);
  const reopened = resolveGoldOrderTurn('티켓이 안보여', ready.state);
  assert.equal(reopened.status, 'ready');
  const reopenedDraft = reopened.payload.order_draft;
  assert.equal(reopenedDraft.stk_cd, 'M04020000');
  assert.equal(reopenedDraft.product_name, '금 99.99_1kg');
  assert.equal(reopenedDraft.ord_qty, '1');
  assert.equal(reopenedDraft.unit, 'g');
  assert.equal(reopenedDraft.requested_order_type, 'market');
  assert.equal(reopenedDraft.execution_supported, false);
  assert.equal(reopenedDraft.execution_blocker, MARKET_UNSUPPORTED_REASON);
  assert.equal(Object.hasOwn(reopenedDraft, 'trde_tp'), false);
  assert.equal(Object.hasOwn(reopenedDraft, 'ord_uv'), false);
});

test('명시한 보통 주문은 단가를 시장가로 추정하지 않고 차단 초안을 연다', () => {
  const ready = resolveGoldOrderTurn('금 99.99_1kg 1g 보통 매수');
  assert.equal(ready.status, 'ready');
  assert.equal(ready.state.orderType, 'regular');
  assert.equal(ready.payload.order_draft.requested_order_type, 'regular');
  assert.match(ready.payload.order_draft.execution_blocker, /단가/);
  assert.equal(Object.hasOwn(ready.payload.order_draft, 'trde_tp'), false);
  assert.equal(Object.hasOwn(ready.payload.order_draft, 'ord_uv'), false);
});

test('미니금 상품 표기의 100g를 주문 수량으로 오인하지 않는다', () => {
  const result = resolveGoldOrderTurn('미니금 100g 보통 매수');
  assert.equal(result.status, 'collecting');
  assert.deepEqual(result.missing, ['quantity']);
});

test('1kg 상품명과 g 주문 수량을 분리하고 bare 100g는 상품을 확정하지 않는다', () => {
  const oneKg = resolveGoldOrderTurn('금99.99_1kg 100g 보통 매수');
  assert.equal(oneKg.state.productCode, 'M04020000');
  assert.equal(oneKg.state.quantity, 100);
  const mini = resolveGoldOrderTurn('미니금 99.99_100g 1g 보통 매수');
  assert.equal(mini.state.productCode, 'M04020100');
  assert.equal(mini.state.quantity, 1);
  const pending = resolveGoldOrderTurn('금현물 시장가 매수');
  const bare = resolveGoldOrderTurn('100g', pending.state);
  assert.equal(bare.state.productCode, null);
  assert.equal(bare.state.quantity, 100);
  assert.deepEqual(bare.missing, ['product']);
});

test('정보 질문과 일반 화면 실패 문구는 금 주문으로 가로채지 않는다', () => {
  assert.equal(resolveGoldOrderTurn('보통 금현물은 어떻게 매수해?').handled, false);
  const pending = resolveGoldOrderTurn('금현물 시장가 매수');
  assert.equal(resolveGoldOrderTurn('화면이 안 보여', pending.state).handled, false);
});

test('시장가 요청을 보통 주문 코드로 암묵적 변환하지 않는다', () => {
  const tracker = createGoldOrderIntentTracker();
  const ready = tracker.advance('a', '금 99.99 1kg 1개 시장가 매수');
  const draft = ready.draft.order_draft;
  assert.equal(draft.requested_order_type, 'market');
  assert.equal(draft.execution_supported, false);
  assert.match(draft.execution_blocker, /시장가 매매구분 코드/);
  assert.equal(Object.hasOwn(draft, 'trde_tp'), false);
  assert.equal(Object.hasOwn(draft, 'ord_uv'), false);
});

test('정보가 덜 찬 요청은 질문으로 수집하고 비어 있는 티켓을 열지 않는다', () => {
  const result = resolveGoldOrderTurn('금현물 시장가 매수');
  assert.equal(result.handled, true);
  assert.equal(result.status, 'collecting');
  assert.equal(result.payload, null);
  assert.match(result.answerText, /금 상품/);
});

test('완성 상태는 명시적인 주문 화면 다시 열기에서 재사용된다', () => {
  let result = resolveGoldOrderTurn('금현물 시장가 매수');
  result = resolveGoldOrderTurn('금99.99 1kg', result.state);
  result = resolveGoldOrderTurn('1개', result.state);
  const reopened = resolveGoldOrderTurn('주문 화면 다시 열어줘', result.state);
  assert.equal(reopened.status, 'ready');
  assert.equal(reopened.payload.order_draft.stk_cd, 'M04020000');
  assert.equal(reopened.payload.order_draft.ord_qty, '1');
});

test('팝업이 열리지 않았다는 실제 실패 문구도 완성된 주문 티켓을 다시 연다', () => {
  let ready = resolveGoldOrderTurn('금현물 시장가 매수');
  ready = resolveGoldOrderTurn('금99.99 1kg', ready.state);
  ready = resolveGoldOrderTurn('1개', ready.state);

  for (const query of ['주문 화면이 안열려', '주문 팝업이 안뜬다', '주문창 안떠']) {
    const reopened = resolveGoldOrderTurn(query, ready.state);
    assert.equal(reopened.handled, true, query);
    assert.equal(reopened.status, 'ready', query);
    assert.equal(reopened.payload.operation_ref, 'base:kt50000', query);
    assert.equal(reopened.payload.order_draft.stk_cd, 'M04020000', query);
    assert.equal(reopened.payload.order_draft.ord_qty, '1', query);
  }
});

test('수량 변경 후속 문법과 파서가 개로 suffix를 같이 처리한다', () => {
  let result = resolveGoldOrderTurn('금 99.99 1kg 1개 시장가 매수');
  result = resolveGoldOrderTurn('수량은 2개로 변경해줘', result.state);
  assert.equal(result.handled, true);
  assert.equal(result.status, 'ready');
  assert.equal(result.state.quantity, 2);
  assert.equal(result.payload.order_draft.ord_qty, '2');
});

test('대기 중 무관한 발화는 삼키지 않고 상태를 지운다', () => {
  const pending = resolveGoldOrderTurn('금현물 시장가 매수');
  const unrelated = resolveGoldOrderTurn('삼성전자 시세 보여줘', pending.state);
  assert.deepEqual(unrelated, {
    handled: false, reason: 'unrelated_to_pending_order', state: null, clear: true,
  });

  const tracker = createGoldOrderIntentTracker();
  tracker.advance('a', '금현물 시장가 매수');
  assert.equal(tracker.advance('a', '삼성전자 시세 보여줘').handled, false);
  assert.equal(tracker.peek('a'), null);
});

test('취소·방향 변경만 닫힌 후속 주문 문법으로 처리한다', () => {
  let result = resolveGoldOrderTurn('금현물 시장가 매수');
  result = resolveGoldOrderTurn('매도로 변경해줘', result.state);
  assert.equal(result.state.side, 'sell');
  assert.equal(result.payload, null);
  result = resolveGoldOrderTurn('금99.99 1kg', result.state);
  result = resolveGoldOrderTurn('1개', result.state);
  assert.equal(result.payload.operation_ref, 'base:kt50001');
  const cancelled = resolveGoldOrderTurn('주문 취소해줘', result.state);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.state, null);
  assert.equal(cancelled.payload, null);
});
