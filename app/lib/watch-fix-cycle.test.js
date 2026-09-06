'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Cycle = require('./watch-fix-cycle');

// 봉투는 백엔드 `_detail_view`의 fix_cycle 그대로다(routines/revisions.fix_cycle).
function envelope(over) {
  return Object.assign({
    fix_count: 2,
    past_count: 1,
    checked_at: '2026-09-05T06:31:00+00:00',
    lookback_days: 30,
    duration_ms: 9000,
    fires_before: 4,
    fires_after: 2,
    fires_before_dates: ['2026-08-12', '2026-08-19', '2026-08-26', '2026-09-01'],
    fires_after_dates: ['2026-08-12', '2026-08-26'],
    changes: [
      { label: '평균 일수', before: '3일', after: '5일' },
      { label: '배수', before: '1.5배', after: '2.0배' },
    ],
    changed_nodes: 2,
    can_rollback: true,
  }, over || {});
}

test('고친 적 없으면 모델이 없다', () => {
  assert.equal(Cycle.cycleModel(null), null);
  assert.equal(Cycle.cycleModel(undefined), null);
});

test('재검사 머리는 센 구간과 걸린 시간을 말한다', () => {
  const m = Cycle.cycleModel(envelope());
  assert.equal(m.recheckTitle, '다시 검사 · 지난 30일');
  assert.equal(m.recheckMeta, '자동 · 9초');
  assert.equal(m.before, '4번');
  assert.equal(m.after, '2번 울림');
  assert.equal(m.afterDates, '8/12 · 8/26');
});

test('센 값이 없으면 그 줄을 지어내지 않는다', () => {
  const m = Cycle.cycleModel(envelope({
    fires_before: null, fires_after: null, duration_ms: null, lookback_days: null,
  }));
  assert.equal(m.before, '');
  assert.equal(m.after, '');
  assert.equal(m.recheckTitle, '다시 검사');
  assert.equal(m.recheckMeta, '자동');
  assert.deepEqual(m.dots, []);
  assert.equal(m.dotNote, '');
});

test('점 띠는 센 구간만큼이고 어제까지다', () => {
  const dots = Cycle.dotStrip(envelope());
  assert.equal(dots.length, 30);
  assert.equal(dots[0].date, '2026-08-06');
  assert.equal(dots[29].date, '2026-09-04');
  assert.ok(!dots.some((d) => d.date === '2026-09-05'));
});

test('고치기 전에만 울린 날이 회색이고 지금도 울리는 날은 표시다', () => {
  const dots = Cycle.dotStrip(envelope());
  const by = Object.fromEntries(dots.map((d) => [d.date, d.state]));
  assert.equal(by['2026-08-12'], Cycle.DOT_FIRED);
  assert.equal(by['2026-08-26'], Cycle.DOT_FIRED);
  assert.equal(by['2026-08-19'], Cycle.DOT_SILENCED);
  assert.equal(by['2026-09-01'], Cycle.DOT_SILENCED);
  assert.equal(by['2026-08-20'], Cycle.DOT_QUIET);
});

test('회색 칸 수는 세어 본 값이다', () => {
  assert.equal(
    Cycle.cycleModel(envelope()).dotNote,
    '회색 2칸은 고치기 전에 울렸던 날 · 이제는 안 울림',
  );
  const none = Cycle.cycleModel(envelope({
    fires_before_dates: ['2026-08-12'], fires_after_dates: ['2026-08-12'],
  }));
  assert.equal(none.dotNote, '');
});

test('영수증은 바뀐 칸을 번호로 세고 마지막에 판정을 붙인다', () => {
  const m = Cycle.cycleModel(envelope());
  assert.equal(m.receiptTitle, '한 바퀴 영수증 · 2번째 고침');
  assert.deepEqual(m.receiptRows.map((r) => r.mark), ['1', '2', '✓']);
  assert.equal(m.receiptRows[0].text, '평균 일수 3일 → 5일');
  assert.equal(m.receiptRows[1].text, '배수 1.5배 → 2.0배');
  assert.equal(m.receiptRows[2].text, '다시 검사 통과 · 노드 2개 다시 그림');
});

test('바뀐 칸이 없으면 판정 줄도 없다', () => {
  const m = Cycle.cycleModel(envelope({ changes: [], changed_nodes: 0 }));
  assert.deepEqual(m.receiptRows, []);
});

test('지난 고침이 없으면 그 문이 안 선다', () => {
  assert.equal(Cycle.cycleModel(envelope()).pastLabel, '지난 고침 1건');
  assert.equal(Cycle.cycleModel(envelope({ past_count: 0 })).pastLabel, '');
});

test('되돌릴 수 없다고 온 봉투는 문을 안 연다', () => {
  assert.equal(Cycle.cycleModel(envelope({ can_rollback: false })).canRollback, false);
});

test('순환 띠 문구는 봉투와 무관하게 늘 같다', () => {
  const m = Cycle.cycleModel(envelope());
  assert.equal(m.chip, '순환');
  assert.equal(m.cycleText, '물어봄 → 고침 → 검사 → 다시 그림 · 한 바퀴 끝');
  assert.equal(m.note, '코드는 AI가, 판단은 사람이 · 승인 전까지 실행 없음');
});

test('걸린 시간이 0.5초 미만이면 초를 말하지 않는다', () => {
  assert.equal(Cycle.secondsLabel(400), '');
  assert.equal(Cycle.secondsLabel(9000), '9초');
  assert.equal(Cycle.secondsLabel(null), '');
});

test('지난 고침 목록은 시각과 그때 센 울림만 말한다', () => {
  const rows = Cycle.historyRows([
    { fixed_at: '2026-09-04T01:00:00+00:00', fire_count: 6 },
    { fixed_at: '', fire_count: null },
  ]);
  assert.deepEqual(rows, [{ when: '9/4', fires: '6번 울림' }, { when: '', fires: '' }]);
  assert.deepEqual(Cycle.historyRows(null), []);
});
