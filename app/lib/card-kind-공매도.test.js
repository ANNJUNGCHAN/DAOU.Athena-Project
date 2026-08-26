'use strict';

// DOM 빌더(render공매도)는 document가 필요해 node --test 경로에서는 못 돈다 —
// 이 스위트는 순수 함수(formatPercent/buildShortsaleLine)만 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatPercent, buildShortsaleLine } = require('./card-kind-공매도');

test('formatPercent — %가 없으면 붙인다(부호는 원본 값이 이미 갖고 있다)', () => {
  assert.equal(formatPercent('2.40'), '2.40%');
  assert.equal(formatPercent('-1.80'), '-1.80%');
});

test('formatPercent — 이미 %가 있으면 중복으로 안 붙인다', () => {
  assert.equal(formatPercent('2.4%'), '2.4%');
});

test('formatPercent — 빈 값은 null', () => {
  assert.equal(formatPercent(undefined), null);
  assert.equal(formatPercent(null), null);
  assert.equal(formatPercent(''), null);
});

test('buildShortsaleLine — 일자+공매도량+비중+평균단가 전부 있는 행', () => {
  const line = buildShortsaleLine({ dt: '20260825', shrts_qty: '84120', trde_wght: '2.40', shrts_avg_pric: '1694200' });
  assert.equal(line.title, '2026-08-25');
  assert.equal(line.value, '84,120주');
  assert.equal(line.valueSub, '비중 2.40% · 평균 1,694,200원');
});

test('buildShortsaleLine — 비중·평균단가가 없어도(선택 필드) 나머지는 채워진다', () => {
  const line = buildShortsaleLine({ dt: '20260825', shrts_qty: '84120' });
  assert.equal(line.value, '84,120주');
  assert.equal(line.valueSub, null);
});

test('buildShortsaleLine — 일자·공매도량 중 하나라도 없으면 null(행 단위 생략)', () => {
  assert.equal(buildShortsaleLine({ dt: '20260825' }), null); // shrts_qty 없음
  assert.equal(buildShortsaleLine({ shrts_qty: '100' }), null); // dt 없음
  assert.equal(buildShortsaleLine(null), null);
});
