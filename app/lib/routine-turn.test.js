'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { describeMode, relativeText, buildTurnModel, buildToast, badgeText } = require('./routine-turn');

const FIRED = {
  type: 'routine-fired',
  routine_id: 'r1',
  symbol: '005930',
  source: 'price.change_rate',
  mode: 'realtime-ws',
  observed: 5.3,
  threshold: 5.0,
  note: '삼성전자 급등감시',
  fired_at: '2026-08-19T09:41:00+09:00',
};

test('describeMode: §8 이분법 문구', () => {
  assert.equal(describeMode('realtime-ws'), '실시간 (WS)');
  assert.equal(describeMode('periodic'), '주기 확인');
});

test('buildTurnModel(fired): 발화 배지·상대시간·방식·소스 라벨·시점 고지', () => {
  const now = Date.parse(FIRED.fired_at) + 206 * 60 * 1000; // 3시간 26분 뒤
  const m = buildTurnModel(FIRED, now);
  assert.equal(m.kind, 'fired');
  assert.ok(m.badge.endsWith('발화'));
  assert.equal(m.relative, '3시간 26분 전');
  assert.equal(m.modeText, '실시간 (WS)');
  assert.ok(m.sourceLabel.includes('묻지 않은 턴'));
  assert.ok(m.body.includes('발화 시점 기준')); // 시점 정직성
  assert.ok(m.body.includes('5.3'));
});

test('buildTurnModel: 만료·복원실패·미지 타입', () => {
  assert.equal(buildTurnModel({ type: 'routine-expired', note: 'x' }, 0).kind, 'expired');
  const rf = buildTurnModel({ type: 'routine-restore-failed', note: '감시가 비어 있다' }, 0);
  assert.equal(rf.kind, 'restore-failed');
  assert.ok(rf.body.includes('감시가 비어 있다'));
  assert.equal(buildTurnModel({ type: '???' }, 0).kind, 'unknown');
  assert.equal(buildTurnModel(null, 0).kind, 'unknown');
});

test('buildToast(fired): 방식이 제목에 들어간다', () => {
  const t = buildToast(FIRED);
  assert.ok(t.title.includes('005930'));
  assert.ok(t.title.includes('실시간 (WS)'));
});

test('relativeText: 방금·분·시간', () => {
  const base = Date.parse('2026-08-19T09:00:00+09:00');
  assert.equal(relativeText('2026-08-19T09:00:00+09:00', base + 30 * 1000), '방금');
  assert.equal(relativeText('2026-08-19T09:00:00+09:00', base + 5 * 60 * 1000), '5분 전');
  assert.equal(relativeText('bogus', base), null);
});

test('badgeText: 잘못된 시각은 발화로 강등', () => {
  assert.equal(badgeText('nope'), '발화');
});
