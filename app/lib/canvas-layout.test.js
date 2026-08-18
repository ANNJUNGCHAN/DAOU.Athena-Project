// 배치·생애주기 규칙(lib/canvas-layout.js)의 순수 로직 검증. 실행: npm test.
// 규칙 원본은 plan/canvas-taxonomy.md "배치·생애주기 규칙 (2026-08-18 확정)".
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  widthGradeFor,
  dropTargetsFor,
  exceedsHeightBudget,
  MIN_CARDS,
} = require('./canvas-layout');

test('폭 문법 기본값 — 컴팩트는 반폭, 넓은 형상은 전폭', () => {
  assert.equal(widthGradeFor('stream'), 'half');
  assert.equal(widthGradeFor('reader'), 'half');
  assert.equal(widthGradeFor('table'), 'full');
  assert.equal(widthGradeFor('mcp-table'), 'full');
  assert.equal(widthGradeFor('free'), 'full');
  assert.equal(widthGradeFor('notice'), 'full');
});

test('미지 형상은 전폭 — 자유 카드와 같은 보수적 착지', () => {
  assert.equal(widthGradeFor('timeline'), 'full');
  assert.equal(widthGradeFor('unknown-type'), 'full');
});

test('layout 힌트는 폭 등급 승격·강등만 한다', () => {
  assert.equal(widthGradeFor('stream', 'full'), 'full'); // 승격
  assert.equal(widthGradeFor('table', 'half'), 'half'); // 강등
});

test('무효 힌트는 조용히 문법 기본값으로 폴백한다', () => {
  assert.equal(widthGradeFor('stream', 'mega'), 'half');
  assert.equal(widthGradeFor('stream', null), 'half');
  assert.equal(widthGradeFor('stream', undefined), 'half');
  assert.equal(widthGradeFor('table', 42), 'full');
});

test('drop_types — table은 픽스처·실배선 둘 다 지목한다', () => {
  assert.deepEqual(dropTargetsFor(['table']), ['table', 'mcp-table']);
});

test('drop_types — 미지 값·중복은 무시, 비배열은 빈 목록', () => {
  assert.deepEqual(dropTargetsFor(['stream', 'stream', 'nope']), ['stream']);
  assert.deepEqual(dropTargetsFor('stream'), []);
  assert.deepEqual(dropTargetsFor(undefined), []);
  // timeline은 카드 분기 자체가 없어(plan.md 다음 수 6) 드롭 대상도 없다
  assert.deepEqual(dropTargetsFor(['timeline']), []);
});

test('높이 예산 — 최소 3장은 예산과 무관하게 보장(soul.md §5-2)', () => {
  assert.equal(exceedsHeightBudget(99999, 100, MIN_CARDS), false);
  assert.equal(exceedsHeightBudget(99999, 100, 2), false);
});

test('높이 예산 — 뷰포트 2배 초과 시에만 참(정확히 2배는 허용)', () => {
  assert.equal(exceedsHeightBudget(1600, 800, 4), false);
  assert.equal(exceedsHeightBudget(1601, 800, 4), true);
});

test('높이 예산 — 창이 접혀 clientHeight=0이면 제거하지 않는다(fail-safe)', () => {
  assert.equal(exceedsHeightBudget(5000, 0, 6), false);
});
