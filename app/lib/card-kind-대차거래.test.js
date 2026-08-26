'use strict';

// DOM 빌더(render대차거래)는 document가 필요해 node --test 경로에서는 못 돈다 —
// 이 스위트는 순수 함수(buildLendingLine)만 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLendingLine } = require('./card-kind-대차거래');

test('buildLendingLine — 일자 기준 행(ka10068/ka20068 공유 필드)', () => {
  const line = buildLendingLine({ dt: '20260825', rmnd: '8204551', dbrt_trde_cntrcnt: '412080', dbrt_trde_rpy: '128441' });
  assert.equal(line.title, '2026-08-25');
  assert.equal(line.value, '8,204,551주');
  assert.equal(line.valueSub, '체결 412,080주 · 상환 128,441주');
});

test('buildLendingLine — 종목 기준 행(ka90012, dt 없이 stk_nm으로 식별)', () => {
  const line = buildLendingLine({ stk_nm: '삼성전자', stk_cd: '005930', rmnd: '500000', dbrt_trde_cntrcnt: '10000', dbrt_trde_rpy: '5000' });
  assert.equal(line.title, '삼성전자');
  assert.equal(line.value, '500,000주');
  assert.equal(line.valueSub, '체결 10,000주 · 상환 5,000주');
});

test('buildLendingLine — 체결·상환이 없어도(선택 필드) 나머지는 채워진다', () => {
  const line = buildLendingLine({ dt: '20260825', rmnd: '100' });
  assert.equal(line.valueSub, null);
});

test('buildLendingLine — 잔고가 없으면 null(핵심 필드 없이 생략)', () => {
  assert.equal(buildLendingLine({ dt: '20260825' }), null);
  assert.equal(buildLendingLine({ stk_nm: '삼성전자' }), null);
});

test('buildLendingLine — 일자도 종목명도 없으면 null(식별 불가, ka10069 compound 헤더 방어)', () => {
  assert.equal(buildLendingLine({ rmnd: '100', dbrt_trde_cntrcnt: '10' }), null);
  assert.equal(buildLendingLine(null), null);
});
