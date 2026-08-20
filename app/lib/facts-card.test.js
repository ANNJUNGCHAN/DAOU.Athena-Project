// FactsCard/CompoundCard 순수 로직(lib/facts-card.js) 검증. 실행: npm test.
// 규칙 원본: plan/kiwoom-common-screen-spec.md §4(셀 프리미티브 5종),
// plan/kiwoom-common-screen-case-matrix.md(F1/F2 경계).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyCell,
  changeTone,
  formatNumeric,
  formatDatetime,
  groupFactsFields,
  SINGLE_GROUP_MAX,
} = require('./facts-card');

test('classifyCell — 셀 프리미티브 5종은 spec §4 alias 그대로 분류된다', () => {
  assert.equal(classifyCell('cur_prc'), 'price');
  assert.equal(classifyCell('high_pric'), 'price');
  assert.equal(classifyCell('low_pric'), 'price');
  assert.equal(classifyCell('open_pric'), 'price');
  assert.equal(classifyCell('pred_pre'), 'change');
  assert.equal(classifyCell('pred_pre_sig'), 'change');
  assert.equal(classifyCell('flu_rt'), 'change');
  assert.equal(classifyCell('trde_qty'), 'quantity');
  assert.equal(classifyCell('acc_trde_qty'), 'quantity');
  assert.equal(classifyCell('stk_cd'), 'symbol');
  assert.equal(classifyCell('stk_nm'), 'symbol');
  assert.equal(classifyCell('dt'), 'datetime');
});

test('classifyCell — 미지 필드는 generic(개별 렌더러를 새로 만들지 않는다)', () => {
  assert.equal(classifyCell('corp_code'), 'generic');
  assert.equal(classifyCell(undefined), 'generic');
});

test('changeTone — pred_pre_sig는 코드표(1·2=up, 3=flat, 4·5=down)', () => {
  assert.equal(changeTone('pred_pre_sig', '1'), 'up');
  assert.equal(changeTone('pred_pre_sig', '2'), 'up');
  assert.equal(changeTone('pred_pre_sig', '3'), 'flat');
  assert.equal(changeTone('pred_pre_sig', '4'), 'down');
  assert.equal(changeTone('pred_pre_sig', '5'), 'down');
  assert.equal(changeTone('pred_pre_sig', '9'), 'flat'); // 미지 코드는 flat 안전 폴백
});

test('changeTone — pred_pre/flu_rt는 값의 부호를 쓴다(부호 접두 문자열 포함)', () => {
  assert.equal(changeTone('pred_pre', '+1500'), 'up');
  assert.equal(changeTone('pred_pre', '-800'), 'down');
  assert.equal(changeTone('pred_pre', '0'), 'flat');
  assert.equal(changeTone('flu_rt', '2.15'), 'up');
  assert.equal(changeTone('flu_rt', '-1.02'), 'down');
  assert.equal(changeTone('flu_rt', 'n/a'), 'flat'); // 파싱 실패 → flat 안전 폴백
});

test('formatNumeric — 천단위 구분, 숫자로 안 읽히면 원문 그대로', () => {
  assert.equal(formatNumeric('71400'), '71,400');
  assert.equal(formatNumeric(18402113), '18,402,113');
  assert.equal(formatNumeric(null), '—');
  assert.equal(formatNumeric(''), '—');
  assert.equal(formatNumeric('KRX-001'), 'KRX-001'); // 코드값 — 지어낸 숫자로 덮지 않는다
});

test('formatDatetime — YYYYMMDD → YYYY-MM-DD, 그 외 형식은 원문 유지', () => {
  assert.equal(formatDatetime('20260819'), '2026-08-19');
  assert.equal(formatDatetime('2026-08-19'), '2026-08-19');
  assert.equal(formatDatetime(''), '—');
  assert.equal(formatDatetime(null), '—');
});

test('groupFactsFields — F1: 스칼라 ≤10은 단일 그룹', () => {
  const fields = Array.from({ length: 10 }, (_, i) => ({ key: `f${i}`, value: i }));
  const groups = groupFactsFields(fields);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 10);
  assert.equal(SINGLE_GROUP_MAX, 10);
});

test('groupFactsFields — F2: 11개 이상은 2단으로 접히고 순서를 보존한다', () => {
  const fields = Array.from({ length: 18 }, (_, i) => ({ key: `f${i}`, value: i }));
  const groups = groupFactsFields(fields);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].length + groups[1].length, 18);
  assert.equal(groups[0][0].key, 'f0'); // 재정렬 없음 — 앞 절반이 그룹1
  assert.equal(groups[1][groups[1].length - 1].key, 'f17');
});

test('groupFactsFields — 경계값 11개(F2 하한)도 2단으로 접힌다', () => {
  const fields = Array.from({ length: 11 }, (_, i) => ({ key: `f${i}` }));
  assert.equal(groupFactsFields(fields).length, 2);
});

test('groupFactsFields — 빈 배열/비배열 입력은 빈 단일 그룹', () => {
  assert.deepEqual(groupFactsFields([]), [[]]);
  assert.deepEqual(groupFactsFields(undefined), [[]]);
});
