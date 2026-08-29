'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pc = require('./protected-cards');

const FIRED = {
  type: 'routine-fired', routine_id: 'r1', symbol: '005930', mode: 'realtime-ws',
  observed: 199400, threshold: 200000, note: '삼성전자 저가감시',
  fired_at: '2026-08-19T09:41:00+09:00',
};

test('buildRoutineFiredEventCard: 발화만 event 카드가 된다 — 만료·복원실패는 null', () => {
  const built = pc.buildRoutineFiredEventCard(FIRED);
  assert.equal(built.status, 'success');
  assert.equal(built.envelope.canvas_type, 'event');
  assert.equal(built.envelope.fell_back, false);
  assert.ok(built.envelope.caption.includes('삼성전자 저가감시'));
  assert.equal(built.envelope.data.lifecycle, 'fired');
  assert.equal(built.envelope.data.records.length, 1);
  assert.deepEqual(built.envelope.data.records[0], {
    종목: '005930', 관측값: 199400, 임계값: 200000, 발화시각: '2026-08-19T09:41:00+09:00',
  });
  assert.equal(pc.buildRoutineFiredEventCard({ type: 'routine-expired' }), null);
  assert.equal(pc.buildRoutineFiredEventCard({ type: 'routine-restore-failed' }), null);
  assert.equal(pc.buildRoutineFiredEventCard(null), null);
});

test('buildAuthTokenStatusCard: ready — configured·ready 참, 만료시각 유도', () => {
  const now = Date.parse('2026-08-26T10:00:00+09:00');
  const built = pc.buildAuthTokenStatusCard({ state: 'ready', expiresInSec: 3600 }, now);
  assert.equal(built.envelope.canvas_type, 'status');
  assert.equal(built.envelope.data.lifecycle, 'ready');
  assert.equal(built.envelope.data.ready, true);
  assert.equal(built.envelope.data.configured, true);
  assert.equal(built.envelope.data.expires_at, new Date(now + 3600 * 1000).toISOString());
});

test('buildAuthTokenStatusCard: needed — configured·ready 거짓, 만료시각 없음(지어내지 않는다)', () => {
  const built = pc.buildAuthTokenStatusCard({ state: 'needed', expiresInSec: 0 });
  assert.equal(built.envelope.data.lifecycle, 'needed');
  assert.equal(built.envelope.data.ready, false);
  assert.equal(built.envelope.data.configured, false);
  assert.equal('expires_at' in built.envelope.data, false);
});

test('buildAuthTokenStatusCard: expired/refreshing — configured 참(한 번은 발급됐다는 증거)', () => {
  const expired = pc.buildAuthTokenStatusCard({ state: 'expired', expiresInSec: 0 });
  assert.equal(expired.envelope.data.configured, true);
  assert.equal(expired.envelope.data.ready, false);
  assert.equal('expires_at' in expired.envelope.data, false);

  const refreshing = pc.buildAuthTokenStatusCard({ state: 'refreshing', expiresInSec: 0 });
  assert.equal(refreshing.envelope.data.configured, true);
  assert.equal(refreshing.envelope.data.ready, false);
});

test('buildAuthTokenStatusCard: payload 없으면 needed로 물러선다', () => {
  const built = pc.buildAuthTokenStatusCard(null);
  assert.equal(built.envelope.data.lifecycle, 'needed');
});

const BUY_KT10000 = { trId: 'kt10000', body: { dmst_stex_tp: 'KRX', stk_cd: '005930', ord_qty: '20', trde_tp: '3' } };

test('buildOrderActionCard: done — 실측 kt10000/kt10001 응답 필드만 영수증에 싣는다', () => {
  const built = pc.buildOrderActionCard({
    ...BUY_KT10000,
    outcome: 'done',
    response: { ok: true, status: 200, data: { ord_no: '0000123', dmst_stex_tp: 'KRX' } },
  });
  assert.equal(built.envelope.canvas_type, 'action');
  assert.equal(built.envelope.card_title, '주문');
  assert.equal(built.envelope.data.lifecycle, 'done');
  assert.equal(built.envelope.data.state_label, '체결 완료');
  assert.deepEqual(built.envelope.data.order, {
    stk_cd: '005930', ord_qty: '20', side: '매수',
  });
  assert.deepEqual(built.envelope.data.receipt, { ord_no: '0000123', dmst_stex_tp: 'KRX' });
  assert.ok(built.envelope.caption.includes('005930'));
  assert.ok(built.envelope.caption.includes('매수'));
});

test('buildOrderActionCard: in_doubt/failed — 없는 영수증을 지어내지 않는다(빈 객체)', () => {
  const inDoubt = pc.buildOrderActionCard({
    ...BUY_KT10000, outcome: 'in_doubt', response: { ok: false, status: 409, error: 'conflict' },
  });
  assert.equal(inDoubt.envelope.data.lifecycle, 'in_doubt');
  assert.deepEqual(inDoubt.envelope.data.receipt, {});

  const failed = pc.buildOrderActionCard({
    ...BUY_KT10000, outcome: 'failed', response: { ok: false, status: 503, error: 'HTTP 503' },
  });
  assert.equal(failed.envelope.data.lifecycle, 'failed');
  assert.deepEqual(failed.envelope.data.receipt, {});
});

test('buildOrderActionCard: needs_confirm은 failed로 접는다 — chat.js 상태줄과 같은 3분기', () => {
  const built = pc.buildOrderActionCard({
    ...BUY_KT10000, outcome: 'needs_confirm', response: { ok: false, status: 428, error: 'confirm' },
  });
  assert.equal(built.envelope.data.lifecycle, 'failed');
});

test('buildOrderActionCard: 매도(kt10001) 캡션', () => {
  const built = pc.buildOrderActionCard({
    trId: 'kt10001',
    body: { dmst_stex_tp: 'KRX', stk_cd: '000660', ord_qty: '5', trde_tp: '3' },
    outcome: 'done',
    response: { ok: true, status: 200, data: { ord_no: '0000456', dmst_stex_tp: 'KRX' } },
  });
  assert.ok(built.envelope.caption.includes('000660'));
  assert.ok(built.envelope.caption.includes('매도'));
});
