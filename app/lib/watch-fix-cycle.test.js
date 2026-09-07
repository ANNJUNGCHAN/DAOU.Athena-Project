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
    counted_through: '2026-09-04',
    lookback_days: 30,
    duration_ms: 9000,
    ok: true,
    skip_reason: null,
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

test('점 띠는 센 구간만큼이고 마지막 칸이 마지막으로 센 날이다', () => {
  const dots = Cycle.dotStrip(envelope());
  assert.equal(dots.length, 30);
  assert.equal(dots[0].date, '2026-08-06');
  assert.equal(dots[29].date, '2026-09-04');
  assert.ok(!dots.some((d) => d.date === '2026-09-05'));
});

test('띠는 검사 시각이 아니라 센 마지막 날로 창을 잡는다', () => {
  // 검사 시각은 UTC(KST 새벽이면 하루 앞) — 그래도 창은 안 밀린다.
  const dots = Cycle.dotStrip(envelope({ checked_at: '2026-09-04T21:31:00+00:00' }));
  assert.equal(dots[29].date, '2026-09-04');
  assert.deepEqual(Cycle.dotStrip(envelope({ counted_through: null })), []);
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

test('다시 검사가 안 통과하면 판정 줄도 센 값도 없다', () => {
  // 코드가 돌다 터진 검사도 노드는 채운 채 0번·빈 목록으로 온다(watch/check).
  const m = Cycle.cycleModel(envelope({
    ok: false, skip_reason: '검사 실패 — 코드가 돌지 않음',
    fires_before: 4, fires_after: 0, fires_after_dates: [],
  }));
  assert.deepEqual(m.receiptRows.map((r) => r.mark), ['1', '2']);
  assert.equal(m.before, '');
  assert.equal(m.after, '');
  assert.equal(m.afterDates, '');
  assert.deepEqual(m.dots, []);
  assert.equal(m.dotNote, '');
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

test('누락 코드 복구 문장은 루틴 식별자와 기존 감시 설정을 보존한다', () => {
  const text = Cycle.repairSeedText({
    routineId: 'routine-17',
    title: '삼성전자 거래량 급증 감시',
    reason: '감시 코드 파일 없음 — 먼저 만들기',
    symbol: '005930',
    condition: { source: 'code.watch', op: '==', value: true },
    cooldown_s: 86400,
    expires_days: 27,
    watch: {
      project_id: 'project-4', path: 'watch/volume_spike.py',
      params: { days: 3, ratio: 1.5 }, poll_interval_s: 60, lookback_days: 30,
    },
  });
  assert.match(text, /루틴 id: routine-17/);
  assert.match(text, /실패 이유: 감시 코드 파일 없음 — 먼저 만들기/);
  assert.match(text, /project_id=project-4/);
  assert.match(text, /path=watch\/volume_spike\.py/);
  assert.match(text, /symbol=005930/);
  assert.match(text, /"days":3/);
  assert.match(text, /"ratio":1\.5/);
  assert.match(text, /기존 조건과 설정은 바꾸지 말고/);
  assert.match(text, /같은 경로에 재생성해줘\. 그다음 검사/);
  assert.match(text, /검사 전에는 승인하지 마/);
});

test('누락 코드 복구에 프로젝트 id가 없으면 임의 프로젝트를 쓰지 않는 복구 안내를 붙인다', () => {
  const text = Cycle.repairSeedText({
    routineId: 'routine-18', title: '거래량 감시', reason: '감시 코드 파일 없음',
    watch: { path: 'watch/volume_spike.py', params: { days: 3 } },
  });
  assert.match(text, /현재 감시 프로젝트를 찾을 수 없음/);
  assert.match(text, /임의 프로젝트를 쓰지 말고/);
  assert.match(text, /프로젝트 만들기 또는 폴더 열기/);
});

test('남아 있는 프로젝트 id의 폴더가 사라졌으면 다시 연결한 뒤 기존 상대 경로를 쓴다', () => {
  const text = Cycle.repairSeedText({
    routineId: 'routine-19', title: '거래량 감시',
    reason: '프로젝트 폴더 없음 — 다시 연결',
    watch: { project_id: 'stale-project', path: 'watch/volume_spike.py', params: { days: 3 } },
  });
  assert.match(text, /프로젝트를 다시 연결하거나 폴더 열기로 작업 폴더부터 정한 뒤/);
  assert.match(text, /기존 상대 경로에 누락된 코드를 재생성/);
  assert.doesNotMatch(text, /누락된 코드를 같은 경로에 재생성한 뒤/);
});

test('차단된 채팅 초안은 상세의 기존 조건과 설정으로 복구 컨텍스트를 만든다', () => {
  const summary = {
    id: 'routine-20', note: '거래량 급증 감시', symbol: '005930',
    activation_blocker: '감시 코드 파일 없음 — 다시 만들기',
    cooldown_s: 300, watch: { project_id: 'stale', path: 'watch/stale.py' },
  };
  const detail = {
    symbol: '005930', condition: { source: 'code.watch', op: '==', value: true },
    cooldown_s: 86400, expires_at: '2026-10-04T00:00:00+09:00',
    watch: {
      project_id: 'project-20', path: 'watch/volume_spike.py',
      params: { days: 3, ratio: 1.5 }, poll_interval_s: 60, lookback_days: 30,
    },
  };
  assert.deepEqual(Cycle.mergeRepairContext(summary, detail), {
    repair: true,
    reason: '감시 코드 파일 없음 — 다시 만들기',
    routineId: 'routine-20',
    title: '거래량 급증 감시',
    symbol: '005930',
    watch: detail.watch,
    condition: detail.condition,
    cooldown_s: 86400,
    expires_days: undefined,
    expires_at: '2026-10-04T00:00:00+09:00',
    note: '거래량 급증 감시',
  });
});

test('검사 실패에서 시작한 복구는 검사 카드 사유를 보존한다', () => {
  const context = Cycle.mergeRepairContext({
    id: 'routine-21', note: '거래량 감시',
    activation_blocker: '감시 코드 파일 없음',
    repairReason: '검사 실패 — 감시 코드 파일 없음',
  }, {
    activation_blocker: '감시 코드 파일 없음 — 다시 만들기',
    watch: { project_id: 'p21', path: 'watch/volume.py' },
  });
  assert.equal(context.reason, '검사 실패 — 감시 코드 파일 없음');
});
