'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { describeMode, relativeText, buildTurnModel, buildToast, badgeText, exceedRatio } = require('./routine-turn');

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

test('buildTurnModel(fired): 보드 37 구조 분해 — 종목·본문·고지·감시 조건 1행', () => {
  const m = buildTurnModel(FIRED, Date.parse(FIRED.fired_at));
  assert.equal(m.symbolText, '005930');
  assert.ok(m.bodyText.includes('관측값 5.3'));
  assert.ok(m.bodyText.includes('임계 5'));
  assert.ok(m.bodyNote.includes('발화 시점 기준'));
  // 단일 조건 페이로드 → 정직한 1행: 라벨은 note(원장 소스), 값은 관측값, 충족 확정.
  assert.equal(m.conditions.length, 1);
  assert.deepEqual(m.conditions[0], { met: true, label: '삼성전자 급등감시', value: '5.3' });
});

test('buildTurnModel(fired): note 없으면 조건 라벨은 routine_id로 강등', () => {
  const m = buildTurnModel({ ...FIRED, note: '' }, 0);
  assert.equal(m.conditions[0].label, 'r1');
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

test('exceedRatio: 경계·0·비수치·부호 — 급변 판정(board-31⑤)', () => {
  assert.equal(exceedRatio(7.5, 5), true); // 1.5배 경계값 — 참
  assert.equal(exceedRatio(7.49, 5), false); // 경계 살짝 미만
  assert.equal(exceedRatio(5, 0), false); // 임계 0 — 나눗셈 불능
  assert.equal(exceedRatio('bogus', 5), false); // 비수치 관측값
  assert.equal(exceedRatio(5, 'bogus'), false); // 비수치 임계
  assert.equal(exceedRatio(null, 5), false);
  assert.equal(exceedRatio(undefined, 5), false);
  assert.equal(exceedRatio(-7.5, -5), true); // 부호가 같아도 배율은 절댓값으로 본다(급락 감시)
});
