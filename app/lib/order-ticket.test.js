'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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
    reason: '시장가 매수 주문 초안 — 실행 전 내용을 확인하세요',
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
  assert.ok(ot.gateBlocker({ orderApi: false }).includes('주문 API 비활성'));
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
