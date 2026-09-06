// 제어 제안 턴(Paper 보드 07 · 432Z-1)의 순수 계산 단위 테스트.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./routine-proposal-turn');

// 봉투는 main.js:2497이 만드는 그 모양이다(control·routineId·current·proposed·rationale·view).
const WATCH = { id: 'fx1', symbol: '005930', note: '삼성전자 88,000원 감시', cooldown_s: 300 };

test('A 작업 설정 — 리드는 대상과 바뀌는 칸이다', () => {
  const turn = P.buildProposalTurn({
    control: 'update', routineId: 'fx1', current: WATCH, proposed: { cooldown_s: 600 },
    rationale: '오늘 발화 4회 · 하루 최대 3회',
  }, {});
  assert.equal(turn.badge, '작업 설정');
  assert.equal(turn.statusPill, '제안');
  assert.equal(turn.lead, '삼성전자 88,000원 감시 — 쿨다운 300초 → 600초');
  assert.equal(turn.rationale, '근거: 오늘 발화 4회 · 하루 최대 3회');
  assert.deepEqual(turn.chips.map((c) => c.label), ['이렇게 바꿔줘', '그대로 둘게']);
});

test('A — 대상 루틴이 없으면 제안 자체가 없다(눌러도 아무 일 없는 칩을 만들지 않는다)', () => {
  assert.equal(P.buildProposalTurn({ control: 'update', proposed: { cooldown_s: 600 } }, {}), null);
});

test('A — 바뀌는 칸이 없으면 그릴 것이 없다', () => {
  assert.equal(P.buildProposalTurn({ control: 'update', routineId: 'fx1', current: WATCH, proposed: {} }, {}), null);
});

test('B 알람 — 읽지 않은 수는 알람 센터가 세어 넘긴 실값이다', () => {
  const turn = P.buildProposalTurn({ control: 'ack_all', rationale: '가장 오래된 알람 2시간 전' }, { unread: 3 });
  assert.equal(turn.badge, '알람');
  assert.equal(turn.lead, '읽지 않은 알람 3건 — 모두 읽음');
  assert.deepEqual(turn.chips.map((c) => c.label), ['모두 읽음', '그대로 둘게']);
});

test('B — 읽을 알람이 0건이면 빈 상태만 남고 칩이 없다', () => {
  const turn = P.buildProposalTurn({ control: 'ack_all' }, { unread: 0 });
  assert.equal(turn.lead, '읽지 않은 알람 없음');
  assert.deepEqual(turn.chips, []);
});

test('C 제안 채택 — 대상은 제안값에서 오고 칩은 루틴으로·보류다', () => {
  const turn = P.buildProposalTurn({
    control: 'adopt', proposed: { title: '외국인 순매수 3일 연속' }, rationale: '성향 신호 312 · 12분 전',
  }, {});
  assert.equal(turn.lead, '외국인 순매수 3일 연속 — 감시로 등록');
  assert.deepEqual(turn.chips.map((c) => c.label), ['루틴으로', '보류']);
});

test('D 뷰 이동 — 칩이 없고 상태 행 두 마디가 선다', () => {
  const turn = P.buildProposalTurn({ control: 'view', view: { tab: 'tasks', filter: 'paused' } }, {});
  assert.equal(turn.badge, '뷰 이동');
  assert.equal(turn.statusPill, '완료');
  assert.equal(turn.lead, '작업 › 일시중지');
  assert.deepEqual(turn.chips, []);
  assert.deepEqual(turn.status, ['이동함', '· 칩 없음']);
  assert.deepEqual(turn.view, { tab: 'tasks', filter: 'paused' });
});

test('D — 모르는 마디는 빠지고, 둘 다 모르면 그릴 것이 없다', () => {
  assert.equal(P.viewPath({ tab: 'tasks', filter: 'nope' }), '작업');
  assert.equal(P.buildProposalTurn({ control: 'view', view: { tab: 'nope' } }, {}), null);
});

test('E 지금 실행 — 놓친 시각은 예약 행의 next_fire_at에서 온다', () => {
  const turn = P.buildProposalTurn({
    control: 'fire', routineId: 'fx2',
    current: { id: 'fx2', note: '평일 아침 브리핑', next_fire_at: '2026-09-06T07:30:00' },
    rationale: '마지막 발화 어제 07:30',
  }, {});
  assert.equal(turn.badge, '지금 실행');
  assert.equal(turn.lead, '평일 아침 브리핑 — 07:30 놓침');
  assert.deepEqual(turn.chips.map((c) => c.label), ['지금 실행', '건너뛰기']);
});

test('Paper가 제안 턴으로 그리지 않은 제어는 턴이 되지 않는다', () => {
  for (const control of ['confirm', 'pause', 'resume', 'cancel', 'ack', 'hold', 'guard', '', null]) {
    assert.equal(P.buildProposalTurn({ control, routineId: 'fx1', current: WATCH }, {}), null);
  }
});

test('반영 리드는 결과 턴이 쓸 한 줄이다(4330-1 성공 열)', () => {
  assert.equal(P.updateAppliedLead({ cooldown_s: 600 }), '쿨다운 600초 반영');
  assert.equal(P.updateAppliedLead({ cooldown_s: 600, expires_days: 30 }), '쿨다운 600초 · 만료 30일 반영');
  assert.equal(P.updateAppliedLead({}), '');
});

test('읽음·실행 게이트가 끝난 뒤의 결과 리드도 상태 표기 하나다', () => {
  assert.equal(P.ackAppliedLead(3), '읽지 않은 알람 3건 읽음');
  assert.equal(P.ackAppliedLead(0), '');
  assert.equal(P.fireAppliedLead('2026-09-06T07:30:00'), '07:30 발화 기록');
  assert.equal(P.fireAppliedLead(null), '발화 기록');
});

test('대상 이름은 모델에 따로 실린다 — 초안 게이트가 리드를 다시 자르지 않게', () => {
  const adopt = P.buildProposalTurn({ control: 'adopt', proposed: { title: '외국인 순매수 3일 연속' } }, {});
  assert.equal(adopt.subject, '외국인 순매수 3일 연속');
  const update = P.buildProposalTurn({
    control: 'update', routineId: 'fx1', current: WATCH, proposed: { cooldown_s: 600 },
  }, {});
  assert.equal(update.subject, '삼성전자 88,000원 감시');
  assert.equal(update.current.cooldown_s, 300);
});
