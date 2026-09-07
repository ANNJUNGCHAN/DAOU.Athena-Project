'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ot = require('./order-ticket');

const FIRED = {
  type: 'routine-fired', routine_id: 'r1', symbol: '005930', mode: 'realtime-ws',
  observed: 199400, threshold: 200000, note: '삼성전자 저가감시',
  fired_at: '2026-08-19T09:41:00+09:00',
};

test('buildPrefill: 발화 이벤트에서 값·사유만 채운다 — 방향·수량은 사람 몫', () => {
  const p = ot.buildPrefill(FIRED);
  assert.equal(p.symbol, '005930');
  assert.ok(p.reason.includes('삼성전자 저가감시'));
  assert.equal(ot.buildPrefill({ type: 'routine-expired' }), null);
});

test('buildSelectorOrderPrefill: guarded 현금 주식 시장가 초안만 티켓 값으로 바꾼다', () => {
  const buy = ot.buildSelectorOrderPrefill({
    status: 'guarded',
    operation_ref: 'base:kt10000',
    order_draft: {
      dmst_stex_tp: 'KRX', stk_cd: '005930', ord_qty: '10', trde_tp: '3', side: 'buy',
    },
  });
  assert.deepEqual(buy, {
    symbol: '005930', side: 'buy', qty: 10, orderType: 'market',
    reason: '시장가 구매 주문 초안 — 실행 전 내용을 확인하세요',
  });
  assert.equal(ot.buildSelectorOrderPrefill({
    status: 'guarded',
    operation_ref: 'base:kt10001',
    order_draft: {
      dmst_stex_tp: 'KRX', stk_cd: '000660', ord_qty: 4, trde_tp: '3', side: 'sell',
    },
  }).side, 'sell');
});

test('buildSelectorOrderPrefill: 실행 부작용 없이 unsupported·invalid 주문을 fail-closed 한다', () => {
  let executions = 0;
  const unsupported = {
    status: 'guarded', operation_ref: 'base:kt10003',
    order_draft: { dmst_stex_tp: 'KRX', stk_cd: '005930', ord_qty: '1', trde_tp: '3' },
    execute: () => { executions += 1; },
  };
  assert.equal(ot.buildSelectorOrderPrefill(unsupported), null);
  assert.equal(ot.buildSelectorOrderPrefill({
    ...unsupported, operation_ref: 'base:kt10000',
    order_draft: { ...unsupported.order_draft, trde_tp: '0' },
  }), null);
  assert.equal(ot.buildSelectorOrderPrefill({
    operation_ref: 'base:kt10000', order_draft: unsupported.order_draft,
  }), null);
  assert.equal(ot.buildSelectorOrderPrefill({
    ...unsupported, operation_ref: 'base:kt10000',
    order_draft: { ...unsupported.order_draft, stk_cd: '5930' },
  }), null);
  assert.equal(ot.buildSelectorOrderPrefill({
    ...unsupported, operation_ref: 'base:kt10000',
    order_draft: { ...unsupported.order_draft, ord_qty: '0' },
  }), null);
  assert.equal(ot.buildSelectorOrderPrefill({
    ...unsupported, operation_ref: 'base:kt10000',
    order_draft: { ...unsupported.order_draft, side: 'sell' },
  }), null);
  assert.equal(executions, 0);
});

test('gateBlocker: 주문 API 비활성이면 정직한 사유를 준다', () => {
  assert.ok(ot.gateBlocker(null).includes('백엔드'));
  assert.ok(ot.gateBlocker({ orderApi: false }).includes('주문 API가 OFF'));
  assert.equal(ot.gateBlocker({ orderApi: true }), null);
});

test('buildOrderPayload: kt10000/kt10001 실측 필드·시장가 고정', () => {
  const buy = ot.buildOrderPayload({ symbol: '005930', qty: 20, side: 'buy' });
  assert.equal(buy.tr_id, 'kt10000');
  assert.deepEqual(buy.body, { dmst_stex_tp: 'KRX', stk_cd: '005930', ord_qty: '20', trde_tp: '3' });
  assert.equal(ot.buildOrderPayload({ symbol: '005930', qty: 1, side: 'sell' }).tr_id, 'kt10001');
});

test('buildOrderPayload: 무효 입력 거부', () => {
  assert.throws(() => ot.buildOrderPayload({ symbol: '5930', qty: 1, side: 'buy' }));
  assert.throws(() => ot.buildOrderPayload({ symbol: '005930', qty: 0, side: 'buy' }));
  assert.throws(() => ot.buildOrderPayload({ symbol: '005930', qty: 1.5, side: 'buy' }));
  assert.throws(() => ot.buildOrderPayload({ symbol: '005930', qty: 1, side: null }));
});

test('interpretExecuteStatus: 409=IN_DOUBT(재전송 금지) · 428=확인 필요', () => {
  assert.equal(ot.interpretExecuteStatus(200), 'done');
  assert.equal(ot.interpretExecuteStatus(409), 'in_doubt');
  assert.equal(ot.interpretExecuteStatus(428), 'needs_confirm');
  assert.equal(ot.interpretExecuteStatus(503), 'failed');
});

test('상태기계: in_doubt·done은 종결 — 재실행 전이 불가', () => {
  const t = ot.createTicket(ot.buildPrefill(FIRED));
  ot.transition(t, 'executing');
  ot.transition(t, 'in_doubt');
  assert.throws(() => ot.transition(t, 'executing')); // 중복 주문 방지
  const t2 = ot.createTicket(null);
  ot.transition(t2, 'executing');
  ot.transition(t2, 'failed');
  ot.transition(t2, 'executing'); // 명시적 재시도만 허용(새 멱등키)
});

test('428 확인 요청은 실패로 접지 않고 게이트로 돌아간다', () => {
  assert.equal(ot.ticketStateAfterExecute('needs_confirm'), 'needs_confirm');
  assert.equal(ot.ticketStateAfterExecute('done'), 'done');
  assert.equal(ot.ticketStateAfterExecute('in_doubt'), 'in_doubt');
  assert.equal(ot.ticketStateAfterExecute('failed'), 'failed');
  assert.equal(ot.ticketStateAfterExecute('other'), 'failed');
  const t = ot.createTicket(null);
  ot.transition(t, 'executing');
  ot.transition(t, 'needs_confirm');
  assert.equal(t.state, 'needs_confirm');
  ot.transition(t, 'executing');
  assert.match(ot.executeOutcomeCopy('needs_confirm'), /확인 요청/);
  assert.equal(ot.executeOutcomeCopy('needs_confirm').includes('실행 실패'), false);
  assert.match(ot.executeOutcomeCopy('failed', { status: 503, error: 'down' }), /실행 실패: down/);
});

test('createTicket: 안전한 방향·수량 프리필만 review 상태에 반영한다', () => {
  const safe = ot.createTicket({ side: 'buy', qty: 10 });
  assert.equal(safe.state, 'review');
  assert.equal(safe.side, 'buy');
  assert.equal(safe.qty, 10);
  const unsafe = ot.createTicket({ side: 'short', qty: 0 });
  assert.equal(unsafe.side, null);
  assert.equal(unsafe.qty, null);
});

test('newIdempotencyKey: 호출마다 다르다', () => {
  const a = ot.newIdempotencyKey(() => 0.1);
  const b = ot.newIdempotencyKey(() => 0.9);
  assert.notEqual(a, b);
  assert.ok(a.startsWith('ticket-'));
});

test('총 주문 금액은 수량 × 관측값 추정이고 라벨에 추정을 남긴다', () => {
  assert.deepEqual(ot.estimateOrderTotal({ qty: 10, observed: 88100 }), {
    label: '총 주문 금액 (시장가 추정)', text: '약 881,000원',
  });
});

test('관측값이 없으면 총액 행을 만들지 않는다 — 0원을 지어내지 않는다', () => {
  assert.equal(ot.estimateOrderTotal({ qty: 10, observed: null }), null);
  assert.equal(ot.estimateOrderTotal({ qty: 10 }), null);
  assert.equal(ot.estimateOrderTotal({ qty: 10, observed: '없음' }), null);
});

test('수량이 0이면 총액 행이 없다', () => {
  assert.equal(ot.estimateOrderTotal({ qty: 0, observed: 88100 }), null);
  assert.equal(ot.estimateOrderTotal({ qty: '', observed: 88100 }), null);
});

test('가격 행은 시장가 고정을 세그먼트와 읽기값으로 드러낸다', () => {
  assert.deepEqual(ot.priceRowModel(), {
    segments: ['지정가', '시장가'],
    selected: '시장가',
    readout: '시장가 체결',
    limitEnabled: false,
  });
});

test('수량 칩은 Paper 1OP-0 넷이다 — 10% · 25% · 50% · 최대', () => {
  const model = ot.qtyChipModel({ side: 'buy', observed: 88100, buyingPower: 8810000 });
  assert.deepEqual(model.chips.map((chip) => chip.label), ['10%', '25%', '50%', '최대']);
  assert.equal(model.unit, '주');
  assert.deepEqual(model.chips.map((chip) => chip.qty), [10, 25, 50, 100]);
  assert.equal(model.chips.every((chip) => chip.enabled), true);
});

test('매수 칩은 관측가로 나누고 내림한다 — 1주 미만은 비활성', () => {
  const model = ot.qtyChipModel({ side: 'buy', observed: 88100, buyingPower: 50000 });
  assert.equal(model.chips[0].enabled, false);
  assert.equal(model.chips[0].qty, null);
  assert.match(model.chips[0].reason, /1주 미만/);
});

test('매도 칩은 보유 수량의 비율이다 — 잔고를 지어내지 않는다', () => {
  const known = ot.qtyChipModel({ side: 'sell', holdings: 40 });
  assert.deepEqual(known.chips.map((chip) => chip.qty), [4, 10, 20, 40]);
  const unknown = ot.qtyChipModel({ side: 'sell' });
  assert.equal(unknown.chips.every((chip) => chip.enabled === false), true);
  assert.match(unknown.chips[0].reason, /보유 수량/);
  assert.equal(unknown.chips.every((chip) => chip.qty === null), true);
});

test('매수여력·방향·관측가가 없으면 칩은 그리되 수량을 짓지 않는다', () => {
  const noSide = ot.qtyChipModel({});
  assert.equal(noSide.chips.length, 4);
  assert.match(noSide.chips[0].reason, /방향/);
  const noCash = ot.qtyChipModel({ side: 'buy', observed: 88100 });
  assert.match(noCash.chips[3].reason, /매수 가능 금액/);
  const noPrice = ot.qtyChipModel({ side: 'buy', buyingPower: 8810000 });
  assert.match(noPrice.chips[0].reason, /관측가/);
});

test('수량 칩은 10만 주 상한이다', () => {
  const buy = ot.qtyChipModel({ side: 'buy', observed: 1, buyingPower: 200000 });
  assert.equal(buy.chips[3].qty, 100000);
  const sell = ot.qtyChipModel({ side: 'sell', holdings: 200000 });
  assert.equal(sell.chips[3].qty, 100000);
});

test('셸 티켓은 수량 칩을 모델에서 그린다', () => {
  const chat = fs.readFileSync(path.join(__dirname, '..', 'chat.js'), 'utf8');
  assert.match(chat, /qtyChipModel\(/);
  assert.match(chat, /ticket-qty-chips/);
  assert.match(chat, /chip\.label/);
  assert.match(chat, /qtyChips\.title/);
  const routes = fs.readFileSync(path.join(__dirname, 'paper-screen-routes.js'), 'utf8');
  assert.match(routes, /selector: 'span\.ticket-seg', equals: 2/);
  assert.match(routes, /selector: '\.ticket-qty-chips button\.ticket-seg', equals: 4/);
  assert.doesNotMatch(routes, /selector: '\.ticket-seg', equals: 2/);
});

test('실주문 본문은 여전히 trde_tp 3(시장가) 고정이다', () => {
  // 가격 행이 지정가 세그먼트를 그린다고 주문 본문이 바뀌면 UI가 거짓말이 된다.
  for (const side of ['buy', 'sell']) {
    const p = ot.buildOrderPayload({ symbol: '005930', qty: 3, side });
    assert.equal(p.body.trde_tp, '3');
    assert.equal(p.body.dmst_stex_tp, 'KRX');
  }
  assert.equal(ot.priceRowModel().limitEnabled, false);
});
