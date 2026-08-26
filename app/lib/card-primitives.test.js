'use strict';

// DOM 빌더(QuoteHeader/ChangeBadge/...)는 document가 필요해 node --test(순수 Node) 경로에서는
// 못 돈다(chart-card.test.js와 같은 결) — 이 스위트는 순수 계산(스케일링/위치 산출)만 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  proportionalRatios,
  rangePosition,
  resolveStatusTone,
  ladderRatio,
  priceMagnitude,
} = require('./card-primitives');

test('proportionalRatios — 최대 절대값 기준으로 0..1 스케일링한다', () => {
  assert.deepEqual(proportionalRatios([10, -20, 5]), [0.5, 1, 0.25]);
  assert.deepEqual(proportionalRatios([-4, 4]), [1, 1]);
});

test('proportionalRatios — 전부 0이면(스케일 기준 없음) 전부 0 비율', () => {
  assert.deepEqual(proportionalRatios([0, 0, 0]), [0, 0, 0]);
});

test('proportionalRatios — 비배열/비유한값은 0으로 안전 처리', () => {
  assert.deepEqual(proportionalRatios(undefined), []);
  assert.deepEqual(proportionalRatios(['a', 10, null]), [0, 1, 0]);
});

test('rangePosition — low-value-high 3점 위치를 0..1로 계산한다', () => {
  assert.equal(rangePosition(0, 50, 100), 0.5);
  assert.equal(rangePosition(100, 100, 200), 0);
  assert.equal(rangePosition(100, 200, 200), 1);
});

test('rangePosition — 값이 범위를 벗어나면 0..1로 클램프한다(지어낸 값으로 넘치지 않음)', () => {
  assert.equal(rangePosition(0, -10, 100), 0);
  assert.equal(rangePosition(0, 150, 100), 1);
});

test('rangePosition — low===high(범위 없음)나 비유한값은 null(마커 생략)', () => {
  assert.equal(rangePosition(100, 100, 100), null);
  assert.equal(rangePosition(0, 'n/a', 100), null);
  assert.equal(rangePosition(undefined, 50, 100), null); // Number(undefined)=NaN(Number(null)=0과 다름)
});

test('resolveStatusTone — 호출부 톤 테이블로 상태를 판정한다', () => {
  const toneTable = { 체결대기: 'warn', 완료: 'up' };
  assert.equal(resolveStatusTone('체결대기', toneTable), 'warn');
  assert.equal(resolveStatusTone('완료', toneTable), 'up');
});

test('resolveStatusTone — 테이블에 없는 상태/빈 테이블은 flat 안전 폴백', () => {
  assert.equal(resolveStatusTone('알수없음', { 완료: 'up' }), 'flat');
  assert.equal(resolveStatusTone('완료', undefined), 'flat');
  assert.equal(resolveStatusTone('완료', null), 'flat');
});

test('ladderRatio — maxQuantity 기준 0..1 비율', () => {
  assert.equal(ladderRatio(50, 100), 0.5);
  assert.equal(ladderRatio(100, 100), 1);
  assert.equal(ladderRatio(-30, 100), 0.3); // 절대값 기준
});

test('ladderRatio — maxQuantity가 0/음수/비유한이면 막대 없음(0)', () => {
  assert.equal(ladderRatio(50, 0), 0);
  assert.equal(ladderRatio(50, -10), 0);
  assert.equal(ladderRatio(50, 'n/a'), 0);
  assert.equal(ladderRatio('n/a', 100), 0);
});

// 팀리드 지시(2026-08-26 카드 데모 실측 후속) — 키움 가격류 필드는 "부호가 포함된
// 숫자"인데 그 부호는 기준가 대비 방향 표기이지 값의 부호가 아니다(backend
// canvas_transform._parse_price와 같은 근거). QuoteHeader/RangeBar 같은 가격 표시
// 전용 소비자에서만 부호를 걷어낸다.
test('priceMagnitude — 실제 캡처된 값 그대로: 음수/양수 부호를 걷어내 크기만 남긴다', () => {
  assert.equal(priceMagnitude('-255500'), '255500');
  assert.equal(priceMagnitude('-256500'), '256500');
  assert.equal(priceMagnitude('+266500'), '266500');
});

test('priceMagnitude — 부호 없는 값은 그대로', () => {
  assert.equal(priceMagnitude('266500'), '266500');
  assert.equal(priceMagnitude(266500), '266500');
});

test('priceMagnitude — null/undefined는 그대로 통과(포맷 헬퍼의 "값 없음" 처리에 맡긴다)', () => {
  assert.equal(priceMagnitude(null), null);
  assert.equal(priceMagnitude(undefined), undefined);
});

test('priceMagnitude — 부호를 걷어내도 숫자로 안 읽히면(코드값 등) 원문 그대로 — 지어내지 않는다', () => {
  assert.equal(priceMagnitude('-KRX001'), '-KRX001');
  assert.equal(priceMagnitude('n/a'), 'n/a');
  assert.equal(priceMagnitude(''), '');
});
