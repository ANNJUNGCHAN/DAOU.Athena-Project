'use strict';

// DOM 빌더(renderTickerTable/render시세)는 document가 필요해 node --test(순수 Node)
// 경로에서는 못 돈다(chart-card.test.js와 같은 결) — 이 스위트는 순수 함수만 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeRollingRows, extractTickRows, formatTickPrice, bufferKeyFor } = require('./card-kind-시세');

test('mergeRollingRows — 새 행을 앞쪽(최신행 우선)에 병합한다', () => {
  const existing = [{ cntr_tm: '093001', cntr_pric: '100' }];
  const incoming = [{ cntr_tm: '093010', cntr_pric: '101' }];
  const merged = mergeRollingRows(existing, incoming, 20);
  assert.deepEqual(merged, [
    { cntr_tm: '093010', cntr_pric: '101' },
    { cntr_tm: '093001', cntr_pric: '100' },
  ]);
});

test('mergeRollingRows — 같은 체결시간+체결가+체결량 행은 중복 삽입하지 않는다(재조회 흡수)', () => {
  const existing = [{ cntr_tm: '093001', cntr_pric: '100', cntr_qty: '5' }];
  const incoming = [{ cntr_tm: '093001', cntr_pric: '100', cntr_qty: '5' }];
  assert.deepEqual(mergeRollingRows(existing, incoming, 20), existing);
});

test('mergeRollingRows — maxRows로 잘라 무한 누적을 막는다', () => {
  const existing = Array.from({ length: 5 }, (_, i) => ({ cntr_tm: `row${i}` }));
  const incoming = [{ cntr_tm: 'newest' }];
  const merged = mergeRollingRows(existing, incoming, 3);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].cntr_tm, 'newest');
});

test('mergeRollingRows — 비배열 입력은 안전하게 빈 배열로 취급', () => {
  assert.deepEqual(mergeRollingRows(undefined, undefined, 5), []);
  assert.deepEqual(mergeRollingRows(null, [{ cntr_tm: 'a' }], 5), [{ cntr_tm: 'a' }]);
});

test('extractTickRows — 4개 필수 컬럼(체결가/체결량/등락률/거래량)이 모두 있어야 rows를 돌려준다', () => {
  const envelope = {
    data: {
      columns: [
        { key: 'cntr_pric' }, { key: 'cntr_qty' }, { key: 'flu_rt' }, { key: 'acc_trde_qty' },
      ],
      rows: [{ cntr_pric: '1701000', cntr_qty: '11', flu_rt: '+1.37', acc_trde_qty: '311392' }],
    },
  };
  assert.equal(extractTickRows(envelope), envelope.data.rows);
});

test('extractTickRows — all-or-nothing: 필수 컬럼 중 하나라도 없으면 null(범용 렌더러로 폴백)', () => {
  const envelope = {
    data: {
      columns: [{ key: 'cntr_pric' }, { key: 'cntr_qty' }], // flu_rt/acc_trde_qty 없음
      rows: [{ cntr_pric: '1701000', cntr_qty: '11' }],
    },
  };
  assert.equal(extractTickRows(envelope), null);
});

test('extractTickRows — table 모양이 아니거나(columns/rows 없음) 빈 rows면 null', () => {
  assert.equal(extractTickRows({ data: { fields: [] } }), null); // facts 모양(예: ka50100)
  assert.equal(extractTickRows({ data: { columns: [], rows: [] } }), null);
  assert.equal(extractTickRows({}), null);
  assert.equal(extractTickRows(undefined), null);
});

// 체결가 부호 수정(팀리드 지시, 2026-08-26 카드 데모 후속) — cntr_pric도 키움 "부호가
// 포함된 숫자"라 부호는 기준가 대비 방향 표기이지 체결가의 부호가 아니다
// (card-primitives.js priceMagnitude와 같은 근거, 신호 붙은 실제 fixture로 검증).
test('formatTickPrice — 신호 붙은 체결가는 부호를 걷어내고 콤마 포맷한다', () => {
  assert.equal(formatTickPrice('-255500'), '255,500');
  assert.equal(formatTickPrice('+266500'), '266,500');
});

test('formatTickPrice — 부호 없는 체결가는 그대로 콤마 포맷', () => {
  assert.equal(formatTickPrice('1701000'), '1,701,000');
});

test('formatTickPrice — 값이 없으면 formatNumeric의 안전 폴백("—")', () => {
  assert.equal(formatTickPrice(null), '—');
  assert.equal(formatTickPrice(undefined), '—');
});

// 회귀 가드(2026-08-27, 6종목 동시 실시간 프로브에서 실측) — dataset_id만 쓰면 한
// 데이터셋 배치 안의 서로 다른 카드(예: 시세 6종목 일괄 조회)가 링버퍼를 같이 써서
// 행이 섞인다. item_id까지 넣어야 카드별로 격리된다.
test('bufferKeyFor — 같은 dataset_id라도 item_id가 다르면 다른 키(6종목 동시 격리)', () => {
  const a = bufferKeyFor({ correlation: { dataset_id: 'ds1', item_id: 'item-0', ordinal: 1 } });
  const b = bufferKeyFor({ correlation: { dataset_id: 'ds1', item_id: 'item-1', ordinal: 2 } });
  assert.notEqual(a, b);
  assert.equal(a, 'ds:ds1:item-0');
  assert.equal(b, 'ds:ds1:item-1');
});

test('bufferKeyFor — item_id 없는 옛 단일 항목 배치는 dataset_id만으로 키를 만든다', () => {
  assert.equal(bufferKeyFor({ correlation: { dataset_id: 'ds1' } }), 'ds:ds1');
});

test('bufferKeyFor — correlation이 없으면 싱글턴 키(단발 라이브 조회)', () => {
  assert.equal(bufferKeyFor({}), '__single__');
  assert.equal(bufferKeyFor(null), '__single__');
});
