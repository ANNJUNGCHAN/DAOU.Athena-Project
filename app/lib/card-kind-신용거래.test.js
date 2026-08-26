'use strict';

// DOM 빌더(render신용거래)는 document가 필요해 node --test 경로에서는 못 돈다 —
// 이 스위트는 순수 함수(formatPercent/buildCreditLine)만 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatPercent, buildCreditLine } = require('./card-kind-신용거래');

test('buildCreditLine — 일자+잔고+잔고율+전일대비 전부 있는 행(ka10013)', () => {
  const line = buildCreditLine({ dt: '20260825', remn: '1204118', remn_rt: '0.16', pred_pre: '31204' });
  assert.equal(line.title, '2026-08-25');
  assert.equal(line.value, '1,204,118주');
  assert.equal(line.valueSub, '잔고율 0.16% · 전일대비 31,204');
});

test('buildCreditLine — 잔고율·전일대비가 없어도(선택 필드) 나머지는 채워진다', () => {
  const line = buildCreditLine({ dt: '20260825', remn: '1204118' });
  assert.equal(line.valueSub, null);
});

test('buildCreditLine — 일자·잔고 중 하나라도 없으면 null(행 단위 생략, kt20016/kt20017 봉투 방어)', () => {
  assert.equal(buildCreditLine({ dt: '20260825' }), null);
  assert.equal(buildCreditLine({ remn: '100' }), null);
  assert.equal(buildCreditLine(null), null);
});

test('formatPercent — %가 없으면 붙이고, 있으면 그대로', () => {
  assert.equal(formatPercent('0.16'), '0.16%');
  assert.equal(formatPercent('0.16%'), '0.16%');
  assert.equal(formatPercent(''), null);
});
