'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MISSING_TEXT, ZERO_COLLAPSE_MIN, MYRIAD_GROUPS, UNIT_KIND, UNIT_SUFFIX,
  toNumber, formatKoreanUnit, formatSlot, toneOf, toneColorVar, missingText, isZeroLike,
  kindOf, toneFor,
} = require('./board-format');

test('한국어 만 단위 사다리는 상위 2묶음까지만 남긴다', () => {
  assert.equal(formatKoreanUnit(900124000000000), '900조 1,240억');
  assert.equal(formatKoreanUnit(1934000000000), '1조 9,340억');
  assert.equal(formatKoreanUnit(12840000), '1,284만');
  assert.equal(formatKoreanUnit(41826300), '4,182만 6,300');
  assert.equal(formatKoreanUnit(850), '850');
  assert.equal(formatKoreanUnit(0), '0');
  assert.equal(formatKoreanUnit(-12840000), '-1,284만');
  assert.equal(MYRIAD_GROUPS, 2);
  // 조·억·만이 모두 살아 있어도 세 번째 묶음은 붙이지 않는다.
  assert.equal(formatKoreanUnit(1234567800000000), '1,234조 5,678억');
});

test('영문 단위·과학표기를 만들지 않는다 — 표기에 남는 것은 조·억·만뿐이다', () => {
  for (const value of [1e15, 5.5e12, 987654321, 1234, 0]) {
    const text = formatKoreanUnit(value);
    assert.match(text, /^-?[\d,조억만 ]+$/, `${value} → ${text}`);
    assert.doesNotMatch(text, /[eEkKmMbB]/);
  }
});

test('toNumber는 쉼표 문자열과 숫자를 받고 그 외는 null이다', () => {
  assert.equal(toNumber('12,840,120'), 12840120);
  assert.equal(toNumber(-3), -3);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('상한가'), null);
  assert.equal(toNumber(Number.NaN), null);
  assert.equal(toNumber(null), null);
});

test('부호는 텍스트에, 색은 tone에 — 색만으로 상승·하락을 구분하지 않는다', () => {
  const up = formatSlot({ kind: 'number', sign: true, tone: 'signed' }, 1850);
  assert.deepEqual([up.text, up.tone], ['+1,850', 'up']);
  const down = formatSlot({ kind: 'number', sign: true, tone: 'signed' }, -1850);
  assert.deepEqual([down.text, down.tone], ['-1,850', 'down']);
  const flat = formatSlot({ kind: 'number', sign: true, tone: 'signed' }, 0);
  assert.deepEqual([flat.text, flat.tone], ['0', 'flat']);
  assert.equal(toneColorVar('up'), 'var(--color-up)');
  assert.equal(toneColorVar('down'), 'var(--color-down)');
  assert.equal(toneColorVar('flat'), null);
  assert.equal(toneOf('-0.01'), 'down');
});

test('정밀도·퍼센트·일자 포맷', () => {
  assert.equal(formatSlot({ kind: 'number', precision: 2 }, 14.2).text, '14.20');
  assert.equal(formatSlot({ kind: 'number' }, 12840120).text, '12,840,120');
  assert.equal(formatSlot({ kind: 'percent', sign: true, precision: 2 }, 1.24).text, '+1.24%');
  assert.equal(formatSlot({ kind: 'percent' }, -0.5).text, '-0.50%');
  assert.equal(formatSlot({ kind: 'date' }, '20260902').text, '2026-09-02');
  assert.equal(formatSlot({ kind: 'korean', scale: '천' }, 1284).text, '128만 4,000');
});

test('결측 3종은 서로 구분되고 0으로 위장하지 않는다', () => {
  assert.deepEqual(MISSING_TEXT, {
    unavailable: '미제공', pending: '집계 전', not_applicable: '해당 없음',
  });
  assert.equal(formatSlot({ kind: 'number' }, null).text, '미제공');
  assert.equal(formatSlot({ kind: 'number' }, undefined).missing, true);
  assert.equal(formatSlot({ kind: 'number' }, { missing: 'pending' }).text, '집계 전');
  assert.equal(formatSlot({ kind: 'korean' }, { missing: 'not_applicable' }).text, '해당 없음');
  assert.equal(missingText('없는사유'), '미제공');
  // 0은 결측이 아니다.
  assert.equal(formatSlot({ kind: 'number' }, 0).text, '0');
  assert.equal(formatSlot({ kind: 'number' }, 0).missing, false);
});

test('isZeroLike는 0과 결측을 함께 세고(H1 모수) 값 있는 항목은 세지 않는다', () => {
  assert.equal(ZERO_COLLAPSE_MIN, 3);
  assert.equal(isZeroLike({ kind: 'number' }, 0), true);
  assert.equal(isZeroLike({ kind: 'number' }, '0'), true);
  assert.equal(isZeroLike({ kind: 'number' }, null), true);
  assert.equal(isZeroLike({ kind: 'korean' }, { missing: 'not_applicable' }), true);
  assert.equal(isZeroLike({ kind: 'number' }, 1), false);
});

test('미리 만들어진 표기(text)는 그대로 쓰고 포맷터를 다시 태우지 않는다', () => {
  const result = formatSlot({ kind: 'number' }, { value: 1, text: '익일 동일', tone: 'flat' });
  assert.deepEqual([result.text, result.tone], ['익일 동일', 'flat']);
});

// ---------- 추출기 포맷 어휘(format.unit) 소비 ----------
//
// 추출기는 Paper 원문에서 읽은 단위를 `unit`으로 싣는다. 포맷터가 그 어휘를 모르면
// 금액·퍼센트·수량이 전부 text로 떨어져 원문 문자열이 그대로 나온다 — 값은 보이지만
// 규칙(만 단위·부호·정밀도·단위)이 통째로 빠진 채로 나온다.

test('추출기 unit 7종이 렌더러 kind로 옮겨진다', () => {
  assert.deepEqual(UNIT_KIND, {
    text: 'text', percent: 'percent', krw_ko: 'korean',
    shares: 'number', count: 'number', date: 'date', time: 'date',
  });
  assert.equal(kindOf({ unit: 'krw_ko' }), 'korean');
  assert.equal(kindOf({ unit: 'shares' }), 'number');
  // 손으로 쓴 계약의 kind가 이긴다 — 픽스처와 추출물이 같은 포맷터를 쓴다.
  assert.equal(kindOf({ unit: 'text', kind: 'korean' }), 'korean');
  // 손으로 쓴 계약이 kind 자리에 단위 이름을 쓰는 곳이 실제로 있다(2XA5-0/s313).
  assert.equal(kindOf({ kind: 'shares' }), 'number');
  assert.equal(kindOf({ kind: 'count' }), 'number');
  assert.equal(kindOf({ kind: 'krw_ko' }), 'korean');
  assert.equal(formatSlot({ kind: 'shares' }, 8400000).text, '8,400,000주');
  assert.equal(formatSlot({ kind: 'count' }, 8).text, '8건');
  // 렌더러 전용 종류는 그대로 통과한다.
  for (const kind of ['number', 'korean', 'rollup']) assert.equal(kindOf({ kind }), kind);
  // 모르는 낱말은 숫자로 오해하지 않고 원문 그대로 통과시킨다.
  assert.equal(kindOf({ unit: '없는단위' }), 'text');
  assert.equal(kindOf({ kind: '없는종류' }), 'text');
  assert.equal(kindOf({}), 'text');
});

test('unit 표기 — 금액은 만 단위, 퍼센트는 %, 수량은 주·건 접미를 유지한다', () => {
  assert.equal(formatSlot({ unit: 'krw_ko', sign: false, precision: 0, tone: 'neutral' }, 124580240).text, '1억 2,458만');
  assert.equal(formatSlot({ unit: 'krw_ko', sign: true, precision: 0, tone: 'change' }, 4240900).text, '+424만 900');
  assert.equal(formatSlot({ unit: 'percent', sign: true, precision: 2, tone: 'change' }, 4.96).text, '+4.96%');
  assert.equal(formatSlot({ unit: 'percent', sign: false, precision: 1, tone: 'neutral' }, 33.3).text, '33.3%');
  assert.equal(formatSlot({ unit: 'shares', sign: false, precision: 0, tone: 'neutral' }, 250).text, '250주');
  assert.equal(formatSlot({ unit: 'count', sign: false, precision: 0, tone: 'neutral' }, 2).text, '2건');
  assert.equal(formatSlot({ unit: 'date', sign: false, precision: 0, tone: 'neutral' }, '20260902').text, '2026-09-02');
  assert.equal(formatSlot({ unit: 'time', sign: false, precision: 0, tone: 'neutral' }, '09:42:18').text, '09:42:18');
  assert.equal(formatSlot({ unit: 'text', sign: false, precision: 0, tone: 'neutral' }, '005930').text, '005930');
  assert.deepEqual(UNIT_SUFFIX, { shares: '주', count: '건' });
});

test('수량 접미는 숫자로 읽힌 값에만 붙는다 — 없는 단위를 지어내지 않는다', () => {
  assert.equal(formatSlot({ unit: 'shares' }, '상한가').text, '상한가');
  assert.equal(formatSlot({ unit: 'count' }, null).text, '미제공');
});

test("tone 'change'와 'signed'는 같은 뜻이고 'neutral'은 색 없음이다", () => {
  assert.equal(toneFor({ tone: 'change' }, -1850), 'down');
  assert.equal(toneFor({ tone: 'signed' }, 1850), 'up');
  assert.equal(toneFor({ tone: 'neutral' }, -1850), null);
  assert.equal(toneFor({}, -1850), null);
  const down = formatSlot({ unit: 'krw_ko', sign: true, precision: 0, tone: 'change' }, -24600);
  assert.deepEqual([down.text, down.tone], ['-2만 4,600', 'down']);
  assert.equal(toneColorVar(down.tone), 'var(--color-down)');
  // 색이 없어도 부호는 텍스트에 남는다.
  assert.equal(formatSlot({ unit: 'krw_ko', sign: true, tone: 'neutral' }, -24600).text, '-2만 4,600');
});
