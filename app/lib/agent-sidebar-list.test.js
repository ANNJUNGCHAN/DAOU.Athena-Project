// agent-sidebar-list.js 단위 테스트 — 순수 함수라 DOM 스텁이 전혀 필요 없다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  statusIconFor, isPriorityRoutine, buildAgentSidebarRows, buildHydratedRooms, STATUS_ICON,
} = require('./agent-sidebar-list');

function routine(overrides) {
  return {
    id: 'r1',
    symbol: '005930',
    note: '005930 · 현재가 > 88000',
    status: 'active',
    mode: 'periodic',
    ...overrides,
  };
}

test('status.active + mode.periodic → 초록 활성 아이콘', () => {
  const icon = statusIconFor(routine({ status: 'active', mode: 'periodic' }));
  assert.deepEqual(icon, STATUS_ICON.activePeriodic);
  assert.equal(icon.colorVar, '--color-ok');
});

test('status.active + mode.realtime-ws → 파란 실시간 아이콘', () => {
  const icon = statusIconFor(routine({ status: 'active', mode: 'realtime-ws' }));
  assert.deepEqual(icon, STATUS_ICON.activeRealtime);
  assert.equal(icon.colorVar, '--color-info');
});

// ── 3단계(사실11⑤): schedule.daily 예약 — periodic과 구분되는 전용 아이콘 ──

test('status.active + mode.scheduled → 예약 전용 아이콘(activePeriodic이 아니다)', () => {
  const icon = statusIconFor(routine({ status: 'active', mode: 'scheduled' }));
  assert.deepEqual(icon, STATUS_ICON.activeScheduled);
  assert.notEqual(icon, STATUS_ICON.activePeriodic);
  assert.equal(icon.label, '예약');
});

test('status.paused → 주황 일시중지 아이콘(모드와 무관)', () => {
  assert.deepEqual(statusIconFor(routine({ status: 'paused', mode: 'realtime-ws' })), STATUS_ICON.paused);
  assert.deepEqual(statusIconFor(routine({ status: 'paused', mode: 'periodic' })), STATUS_ICON.paused);
  assert.equal(STATUS_ICON.paused.colorVar, '--color-warn');
});

test('expired/cancelled/failed는 우선 노출 대상이 아니다(null)', () => {
  for (const status of ['expired', 'cancelled', 'failed']) {
    assert.equal(statusIconFor(routine({ status })), null, status);
    assert.equal(isPriorityRoutine(routine({ status })), false, status);
  }
});

// ── 8단계: draft(초안) — ◌ 점선 핑크, Paper 보드 43 실측 ──

test('status.draft → 초안 아이콘(모드와 무관), 우선 노출 대상이다', () => {
  assert.deepEqual(statusIconFor(routine({ status: 'draft', mode: 'realtime-ws' })), STATUS_ICON.draft);
  assert.deepEqual(statusIconFor(routine({ status: 'draft', mode: 'periodic' })), STATUS_ICON.draft);
  assert.equal(STATUS_ICON.draft.colorVar, '--color-brand');
  assert.equal(STATUS_ICON.draft.glyph, '◌');
  assert.equal(isPriorityRoutine(routine({ status: 'draft' })), true);
});

test('routine이 없으면 null', () => {
  assert.equal(statusIconFor(null), null);
  assert.equal(statusIconFor(undefined), null);
});

test('buildAgentSidebarRows: active/paused/draft만 남기고 나머지는 걸러낸다', () => {
  const routines = [
    routine({ id: 'a', status: 'active', mode: 'periodic' }),
    routine({ id: 'b', status: 'draft' }),
    routine({ id: 'c', status: 'paused' }),
    routine({ id: 'd', status: 'cancelled' }),
    routine({ id: 'e', status: 'active', mode: 'realtime-ws' }),
  ];
  const rows = buildAgentSidebarRows(routines);
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c', 'e']);
});

test('buildAgentSidebarRows: 제목은 note를 그대로 쓴다(지어내지 않는다)', () => {
  const rows = buildAgentSidebarRows([routine({ id: 'a', note: '삼성전자 88,000 감시' })]);
  assert.equal(rows[0].title, '삼성전자 88,000 감시');
});

test('buildAgentSidebarRows: note가 없으면 symbol로, symbol도 없으면 id로 대체한다', () => {
  const rows = buildAgentSidebarRows([
    routine({ id: 'a', note: '', symbol: '005930' }),
    routine({ id: 'b', note: '', symbol: '' }),
  ]);
  assert.equal(rows[0].title, '005930');
  assert.equal(rows[1].title, 'b');
});

test('buildAgentSidebarRows: 각 행에 아이콘 명세가 실린다', () => {
  const rows = buildAgentSidebarRows([routine({ id: 'a', status: 'paused' })]);
  assert.equal(rows[0].icon, STATUS_ICON.paused);
});

test('buildAgentSidebarRows: 배열이 아니거나 비어 있으면 빈 배열', () => {
  assert.deepEqual(buildAgentSidebarRows(null), []);
  assert.deepEqual(buildAgentSidebarRows(undefined), []);
  assert.deepEqual(buildAgentSidebarRows([]), []);
});

// ── 7단계(F3-FE): 알림 방 하이드레이션 — 6단계 last_fired_at/unread로 재구성 ──

test('buildHydratedRooms: 한 번도 발화한 적 없는(last_fired_at 없음) 라우틴은 제외한다', () => {
  const routines = [
    routine({ id: 'a', last_fired_at: null, unread: false }),
    routine({ id: 'b' }), // last_fired_at 필드 자체가 없는 경우도 방어
  ];
  assert.deepEqual(buildHydratedRooms(routines), []);
});

test('buildHydratedRooms: unread를 그대로 뒤집어 read로 옮긴다(백엔드 read-marks가 유일한 진실)', () => {
  const routines = [
    routine({ id: 'a', last_fired_at: '2026-08-27T06:00:00Z', unread: true }),
    routine({ id: 'b', last_fired_at: '2026-08-27T05:00:00Z', unread: false }),
  ];
  const rooms = buildHydratedRooms(routines);
  assert.equal(rooms.find((r) => r.id === 'a').read, false, 'unread:true → read:false');
  assert.equal(rooms.find((r) => r.id === 'b').read, true, 'unread:false → read:true');
});

test('buildHydratedRooms: 제목은 note를 그대로 쓰고, sub는 지어내지 않고 빈 문자열로 둔다(P3)', () => {
  const rooms = buildHydratedRooms([
    routine({ id: 'a', note: '삼성전자 88,000 감시', last_fired_at: '2026-08-27T06:00:00Z', unread: true }),
  ]);
  assert.equal(rooms[0].title, '삼성전자 88,000 감시');
  assert.equal(rooms[0].sub, '');
});

test('buildHydratedRooms: 최신 발화 먼저로 정렬한다(handleRoutineEvent의 unshift와 같은 순서)', () => {
  const routines = [
    routine({ id: 'older', last_fired_at: '2026-08-25T06:00:00Z', unread: false }),
    routine({ id: 'newest', last_fired_at: '2026-08-27T06:00:00Z', unread: true }),
    routine({ id: 'middle', last_fired_at: '2026-08-26T06:00:00Z', unread: false }),
  ];
  assert.deepEqual(buildHydratedRooms(routines).map((r) => r.id), ['newest', 'middle', 'older']);
});

test('buildHydratedRooms: 파싱 불가능한 last_fired_at은 안전하게 걸러진다', () => {
  const routines = [routine({ id: 'a', last_fired_at: 'not-a-date', unread: true })];
  assert.deepEqual(buildHydratedRooms(routines), []);
});

test('buildHydratedRooms: 배열이 아니거나 비어 있으면 빈 배열', () => {
  assert.deepEqual(buildHydratedRooms(null), []);
  assert.deepEqual(buildHydratedRooms(undefined), []);
  assert.deepEqual(buildHydratedRooms([]), []);
});
