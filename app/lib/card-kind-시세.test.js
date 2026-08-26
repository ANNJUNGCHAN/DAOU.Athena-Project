'use strict';

// DOM 빌더(renderTickerTable/render시세)는 document가 필요해 node --test(순수 Node)
// 경로에서는 못 돈다(chart-card.test.js와 같은 결) — 이 스위트는 순수 함수만 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeRollingRows, extractTickRows } = require('./card-kind-시세');

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
