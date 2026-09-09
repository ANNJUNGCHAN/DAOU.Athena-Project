'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MISSING_TEXT, ZERO_COLLAPSE_MIN, MYRIAD_GROUPS, UNIT_KIND, UNIT_SUFFIX,
  toNumber, formatKoreanUnit, formatTime, formatSlot, toneOf, toneColorVar, missingText, isZeroLike,
  kindOf, toneFor, normalizeSlotValue, isScalarSlotValue,
} = require('./board-format');
const registry = require('./board-template-registry');

function boardSlot(boardId, slotId) {
  return registry.contractFor(boardId).slots.find((slot) => slot.slot_id === slotId);
}

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

test('키움 0패딩·방향 부호 원문은 수량·금액·가격으로 읽힌다', () => {
  const { kiwoomWireNumber } = require('./board-format');
  assert.equal(formatSlot({ unit: 'text' }, '000000000001').text, '1');
  assert.equal(formatSlot({ unit: 'text' }, '000000269500').text, '269,500');
  const up = formatSlot({ unit: 'text' }, '+88100');
  assert.equal(up.text, '88,100');
  assert.equal(up.tone, 'up');
  assert.equal(formatSlot({ unit: 'text' }, '005930').text, '005930');
  assert.equal(formatSlot({ unit: 'krw_ko' }, '000537149609').text, '5억 3,714만');
  assert.equal(formatSlot({ unit: 'date' }, '00000000').text, '');
  assert.equal(formatSlot({ unit: 'percent', precision: 1 }, '000005938089').text, '');
  assert.equal(kiwoomWireNumber('000000000001').numeric, 1);
  assert.equal(kiwoomWireNumber('005930'), null);
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

test('가격 슬롯의 absolute는 표시 부호만 걷고 tone은 원본 Kiwoom 부호를 지킨다', () => {
  const price = formatSlot({ kind: 'number', absolute: true, tone: 'change' }, '-267750');
  assert.deepEqual(price, { text: '267,750', tone: 'down', missing: false });
  assert.equal(formatSlot({ kind: 'number' }, '-267750').text, '-267,750');
  assert.equal(formatSlot({ kind: 'number', absolute: true }, '+267750').text, '267,750');
  assert.equal(formatSlot(boardSlot('2R3M-1', 's005').format, '-267750').text, '267,750원');
  assert.equal(formatSlot(boardSlot('137X-2', 's005').format, '-267750').text, '267,750원');
});

test('정밀도·퍼센트·일자 포맷', () => {
  assert.equal(formatSlot({ kind: 'number', precision: 2 }, 14.2).text, '14.20');
  assert.equal(formatSlot({ kind: 'number' }, 12840120).text, '12,840,120');
  assert.equal(formatSlot({ kind: 'percent', sign: true, precision: 2 }, 1.24).text, '+1.24%');
  assert.equal(formatSlot({ kind: 'percent' }, -0.5).text, '-0.50%');
  assert.equal(formatSlot({ kind: 'date' }, '20260902').text, '2026-09-02');
  assert.equal(formatSlot({ kind: 'date', date_style: 'month-day' }, '20260907').text, '09-07');
  assert.equal(formatSlot({ kind: 'date', date_style: 'month-day' }, '0907').text, '0907');
  assert.equal(formatSlot({ kind: 'time' }, '150220').text, '15:02:20');
  assert.equal(formatSlot({ unit: 'time' }, '150218').text, '15:02:18');
  assert.equal(formatTime('93000'), '93000');
  assert.equal(formatTime('20260902'), '20260902');
  assert.equal(formatSlot({ unit: 'time' }, '20260909134427').text, '2026-09-09 13:44:27');
  assert.equal(formatSlot({ unit: 'time' }, '20260908153000').text, '2026-09-08 15:30:00');
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

test('의도적으로 비워 둔 슬롯은 저작된 중립 결측 문구를 쓰되 잘못된 배열에는 적용하지 않는다', () => {
  const spec = { kind: 'text', missing_text: '상태 확인 안 됨' };
  assert.deepEqual(formatSlot(spec, undefined), {
    text: '상태 확인 안 됨', tone: null, missing: true,
  });
  assert.deepEqual(formatSlot(spec, { missing: 'pending' }), {
    text: '상태 확인 안 됨', tone: null, missing: true,
  });
  assert.deepEqual(formatSlot(spec, ['정규장', '시간외']), {
    text: '미제공', tone: null, missing: true,
  });
});

test('배열/객체 관찰값은 한 슬롯 문자열로 펼치지 않고 결측으로 격리한다', () => {
  const direct = formatSlot({ unit: 'krw_ko', sign: true }, ['+267750', '+268000']);
  assert.deepEqual(direct, { text: '미제공', tone: null, missing: true });

  const wrapped = formatSlot({ unit: 'text' }, { value: ['132300', '132200'] });
  assert.deepEqual(wrapped, { text: '미제공', tone: null, missing: true });
  assert.doesNotMatch(direct.text + wrapped.text, /267750|268000|132300|,/);

  assert.deepEqual(normalizeSlotValue({ value: { current: 268000 } }), {
    value: null, missing: 'unavailable',
  });
  for (const value of ['005930', 268000, true, 1n, null]) assert.equal(isScalarSlotValue(value), true);
  for (const value of [[], {}, new Date()]) assert.equal(isScalarSlotValue(value), false);
});

test('명시적 composite는 각 part 포맷을 적용한 뒤 저작된 구분자로 조합한다', () => {
  const raw = { composite: { separator: ' · ', parts: [
    { mapping_id: 'detail:ka10001:current_trading', f: 'cur_prc', value: '+267750', format: { kind: 'number', prefix: '현재가 ' } },
    { mapping_id: 'detail:ka10001:current_trading', f: 'flu_rt', value: '+4.79', format: { kind: 'percent', sign: true, suffix: ' 기준' } },
  ] } };
  assert.deepEqual(formatSlot({}, raw), {
    text: '현재가 267,750 · +4.79% 기준', tone: null, missing: false,
  });
});

test('일반 scalar 슬롯도 저작된 prefix와 suffix를 포맷된 값 바깥에 붙인다', () => {
  assert.deepEqual(formatSlot({ kind: 'korean', prefix: '거래대금 ', suffix: '원' }, 2140000000000), {
    text: '거래대금 2조 1,400억원', tone: null, missing: false,
  });
  assert.deepEqual(formatSlot({ kind: 'number', prefix: ['가격 '] }, 67700), {
    text: '미제공', tone: null, missing: true,
  });
  assert.deepEqual(formatSlot({ kind: 'korean', scale: '백만', prefix: '거래대금 ', suffix: '원' }, 2140000), {
    text: '거래대금 2조 1,400억원', tone: null, missing: false,
  });
});

test('실제 종목 Paper 슬롯은 거래대금 문구와 유통주식 단위를 중복·배율 왜곡 없이 표시한다', () => {
  assert.equal(formatSlot(boardSlot('137X-2', 's007').format, '150220').text, '15:02:20');
  assert.equal(formatSlot(boardSlot('2R3M-1', 's007').format, '150218').text, '15:02:18');
  assert.equal(formatSlot(boardSlot('2R3M-1', 's044').format, '150220').text, '15:02:20');
  for (const slotId of ['s216', 's227', 's238']) {
    assert.equal(formatSlot(boardSlot('2R3M-1', slotId).format, '20260907').text, '09-07');
  }
  assert.equal(formatSlot(boardSlot('2R3M-1', 's019').format, 2140000).text, '2조 1,400억원');
  assert.equal(formatSlot(boardSlot('137X-2', 's019').format, 2140000).text, '거래대금 2조 1,400억원');
  assert.equal(formatSlot(boardSlot('2R3M-1', 's152').format, 4440000000).text, '4,440,000,000주');
  assert.equal(formatSlot(boardSlot('137X-2', 's059').format, 4440000000).text, '4,440,000,000주');
});

test('composite는 일부 part가 없거나 배열/객체이면 전체를 미제공으로 닫는다', () => {
  const base = { mapping_id: 'detail:ka10001:current_trading', format: { kind: 'text' } };
  for (const badPart of [
    { ...base, f: 'stk_nm', value: null },
    { ...base, f: 'stk_nm', value: ['삼성전자', '다른 종목'] },
    { ...base, f: 'stk_nm', value: { name: '삼성전자' } },
    { ...base, f: '', value: '삼성전자' },
    { mapping_id: '', f: 'stk_nm', value: '삼성전자', format: { kind: 'text' } },
    { ...base, f: 'stk_nm', value: '삼성전자', format: { kind: 'text', prefix: ['종목 '] } },
  ]) {
    const raw = { composite: { separator: ' · ', parts: [
      { ...base, f: 'stk_cd', value: '005930' }, badPart,
    ] } };
    assert.deepEqual(formatSlot({}, raw), { text: '미제공', tone: null, missing: true });
  }
});

test('composite 일부 part가 결측이면 슬롯의 저작된 중립 문구로 전체를 닫는다', () => {
  const raw = { composite: { separator: ' · ', parts: [
    { mapping_id: 'base:0B', f: 'cur_prc', value: 150850, format: { kind: 'number' } },
    { mapping_id: 'base:0B', f: 'flu_rt', value: null, format: { kind: 'percent' } },
  ] } };
  assert.deepEqual(formatSlot({ missing_text: '조회값 없음' }, raw), {
    text: '조회값 없음', tone: null, missing: true,
  });
});

test('모양이 불완전한 composite는 객체 문자열을 노출하지 않는다', () => {
  for (const raw of [
    { composite: { separator: ' · ', parts: [] } },
    { composite: { separator: null, parts: [{}, {}] } },
    { composite: ['005930', '삼성전자'] },
  ]) {
    const formatted = formatSlot({}, raw);
    assert.equal(formatted.text, '미제공');
    assert.equal(formatted.text.includes('[object Object]'), false);
  }
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
  assert.equal(
    formatSlot({ kind: 'number', suffix: '원' }, { value: 150850, text: '150,850원' }).text,
    '150,850원',
  );
  for (const [boardId, slotId, value, text] of [
    ['137X-2', 's019', 2140000, '거래대금 2.14조원'],
    ['2R3M-1', 's030', '094218', '현재가 · 09:42:18 체결'],
  ]) {
    const result = formatSlot(boardSlot(boardId, slotId).format, { value, text, tone: 'flat' });
    assert.deepEqual([result.text, result.tone], [text, 'flat']);
  }
});

test('Paper 원문을 슬롯 값으로 넣어도 접두·접미를 한 번 더 붙이지 않는다', () => {
  // 마운트 게이트는 실데이터가 없어 paper_text를 값으로 싣는다. 그 원문은 이미
  // 「150,850원」처럼 단위를 포함하고, 같은 슬롯의 format.suffix도 「원」이다.
  assert.equal(formatSlot(boardSlot('2R3M-1', 's005').format, '150,850원').text, '150,850원');
  assert.equal(formatSlot(boardSlot('2R3M-1', 's022').format, '21.2배').text, '21.2배');
  assert.equal(formatSlot(boardSlot('137X-2', 's019').format, '거래대금 2.14조원').text, '거래대금 2.14조원');
  assert.equal(
    formatSlot(boardSlot('2R3M-1', 's030').format, '현재가 · 09:42:18 체결').text,
    '현재가 · 09:42:18 체결',
  );
  // 원값 숫자는 접미를 한 번만 붙인다 — 위 가드가 생값 경로를 닫으면 안 된다.
  assert.equal(formatSlot(boardSlot('2R3M-1', 's005').format, '-267750').text, '267,750원');
  assert.equal(formatSlot(boardSlot('137X-2', 's019').format, 2140000).text, '거래대금 2조 1,400억원');
  // 「900.4조」는 이미 만 단위 표기다. suffix 「원」을 붙이면 시가총액이 「900.4조원」이 된다.
  assert.equal(formatSlot(boardSlot('137X-2', 's054').format, '900.4조').text, '900.4조');
  assert.equal(formatSlot(boardSlot('137X-2', 's067').format, '2.14조').text, '2.14조');
});

// ---------- 추출기 포맷 어휘(format.unit) 소비 ----------
//
// 추출기는 Paper 원문에서 읽은 단위를 `unit`으로 싣는다. 포맷터가 그 어휘를 모르면
// 금액·퍼센트·수량이 전부 text로 떨어져 원문 문자열이 그대로 나온다 — 값은 보이지만
// 규칙(만 단위·부호·정밀도·단위)이 통째로 빠진 채로 나온다.

test('추출기 unit 7종이 렌더러 kind로 옮겨진다', () => {
  assert.deepEqual(UNIT_KIND, {
    text: 'text', percent: 'percent', krw_ko: 'korean',
    shares: 'number', count: 'number', date: 'date', time: 'time',
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
