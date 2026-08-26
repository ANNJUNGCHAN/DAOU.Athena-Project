// agent-sidebar-list.js 단위 테스트 — 순수 함수라 DOM 스텁이 전혀 필요 없다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { statusIconFor, isPriorityRoutine, buildAgentSidebarRows, STATUS_ICON } = require('./agent-sidebar-list');

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

test('status.paused → 주황 일시중지 아이콘(모드와 무관)', () => {
  assert.deepEqual(statusIconFor(routine({ status: 'paused', mode: 'realtime-ws' })), STATUS_ICON.paused);
  assert.deepEqual(statusIconFor(routine({ status: 'paused', mode: 'periodic' })), STATUS_ICON.paused);
  assert.equal(STATUS_ICON.paused.colorVar, '--color-warn');
});

test('draft/expired/cancelled/failed는 우선 노출 대상이 아니다(null)', () => {
  for (const status of ['draft', 'expired', 'cancelled', 'failed']) {
    assert.equal(statusIconFor(routine({ status })), null, status);
    assert.equal(isPriorityRoutine(routine({ status })), false, status);
  }
});

test('routine이 없으면 null', () => {
  assert.equal(statusIconFor(null), null);
  assert.equal(statusIconFor(undefined), null);
});

test('buildAgentSidebarRows: active/paused만 남기고 나머지는 걸러낸다', () => {
  const routines = [
    routine({ id: 'a', status: 'active', mode: 'periodic' }),
    routine({ id: 'b', status: 'draft' }),
    routine({ id: 'c', status: 'paused' }),
    routine({ id: 'd', status: 'cancelled' }),
    routine({ id: 'e', status: 'active', mode: 'realtime-ws' }),
  ];
  const rows = buildAgentSidebarRows(routines);
  assert.deepEqual(rows.map((r) => r.id), ['a', 'c', 'e']);
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
