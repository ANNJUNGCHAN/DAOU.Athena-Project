'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyRealtimeTick, canonicalCoveragePath, flattenSourceData, normalizeOccurrences, valueAtPath,
} = require('./semantic-detail-sheet');

test('full source data is flattened without dropping arrays or empty containers', () => {
  const rows = flattenSourceData({ price: 10, levels: [{ qty: 3 }], empty: [] });
  assert.deepEqual(rows.map((row) => row.jsonPath), ['$.price', '$.levels[0].qty', '$.empty']);
});

test('field contract preserves duplicate path occurrences by explicit id and ordinal', () => {
  const rows = normalizeOccurrences({
    operation_ref: 'base:ka10173',
    source_data: { trnm: 'A' },
    field_contract: [
      { occurrence_id: 'trnm-1', json_path: '$.trnm', ordinal: 1, alias: 'trnm' },
      { occurrence_id: 'trnm-2', json_path: '$.trnm', ordinal: 2, alias: 'trnm' },
    ],
  });
  assert.deepEqual(rows.map((row) => row.occurrenceId), ['trnm-1', 'trnm-2']);
  assert.deepEqual(rows.map((row) => row.value), ['A', 'A']);
});

test('canonical backend wrapper resolves contract paths against lossless raw response', () => {
  const [row] = normalizeOccurrences({
    operation_ref: 'base:test',
    data: { price: 'projected' },
    raw_data: { price: 'raw' },
    source_data: { operation_ref: 'base:test', data: { price: 'raw' }, continuation: null },
    field_contract: [{ occurrence_id: 'price-1', json_path: '$.price', ordinal: 1, alias: 'price' }],
  });
  assert.equal(row.value, 'raw');
});

test('wildcard contract covers every concrete array row without duplicate fallback rows', () => {
  const rows = normalizeOccurrences({
    operation_ref: 'base:account',
    raw_data: { data: [{ alias: 'A', extra: 1 }, { alias: 'B', extra: 2 }] },
    field_contract: [
      { occurrence_id: 'alias-schema', json_path: '$.data[].alias', ordinal: 1, alias: 'alias' },
    ],
  });
  assert.equal(rows.filter((row) => row.jsonPath === '$.data[].alias').length, 1);
  assert.deepEqual(rows.find((row) => row.occurrenceId === 'alias-schema').value, ['A', 'B']);
  assert.deepEqual(
    rows.filter((row) => row.alias === 'extra').map((row) => row.jsonPath),
    ['$.data[0].extra', '$.data[1].extra'],
  );
  assert.equal(new Set(rows.map((row) => row.occurrenceId)).size, rows.length);
});

test('coverage canonicalization does not alter concrete display paths', () => {
  assert.equal(canonicalCoveragePath('$.data[12].values[3].price'), '$.data[].values[].price');
  assert.equal(canonicalCoveragePath('$.data[0]["10"]'), '$.data[].10');
  assert.equal(canonicalCoveragePath("$.data[1]['924']"), '$.data[].924');
  assert.equal(canonicalCoveragePath('$["20stk_ord_alow_amt"]'), '$.20stk_ord_alow_amt');
  assert.equal(canonicalCoveragePath('$["100stk_ord_alow_amt"]'), '$.100stk_ord_alow_amt');
  assert.equal(canonicalCoveragePath('$["escaped\\"alias"]'), '$.escaped"alias');
  const rows = normalizeOccurrences({ operation_ref: 'base:x', raw_data: { data: [{ extra: 1 }] }, field_contract: [] });
  assert.equal(rows[0].jsonPath, '$.data[0].extra');
  assert.equal(rows[0].occurrenceId, 'base:x:$.data[0].extra:1');
});

test('numeric alias bracket paths are covered by wildcard dot-form contracts once', () => {
  const rows = normalizeOccurrences({
    operation_ref: 'base:account',
    raw_data: { data: [{ '10': 'A' }, { '10': 'B' }] },
    field_contract: [{ occurrence_id: 'numeric-10', json_path: '$.data[].10', ordinal: 1, alias: '10' }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].occurrenceId, 'numeric-10');
  assert.deepEqual(rows[0].value, ['A', 'B']);
});

test('digit-prefixed alphanumeric aliases match dot-form contracts without fallback duplicates', () => {
  const rows = normalizeOccurrences({
    operation_ref: 'base:account',
    raw_data: { '20stk_ord_alow_amt': '20', '100stk_ord_alow_amt': '100' },
    field_contract: [
      { occurrence_id: 'allow-20', json_path: '$.20stk_ord_alow_amt', ordinal: 1, alias: '20stk_ord_alow_amt' },
      { occurrence_id: 'allow-100', json_path: '$.100stk_ord_alow_amt', ordinal: 1, alias: '100stk_ord_alow_amt' },
    ],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.value), ['20', '100']);
});

test('official opaque 924 fields retain raw alias and honest missing-name label', () => {
  const [row] = normalizeOccurrences({
    operation_ref: 'base:test', source_data: { '924': 'wire-value' },
    field_contract: [{ occurrence_id: 'opaque-924', json_path: '$["924"]', alias: '924', official_opaque: true }],
  });
  assert.equal(row.alias, '924');
  assert.equal(row.label, '공식 명칭 미제공');
  assert.equal(row.value, 'wire-value');
});

test('951 uses its official 예수금 label rather than opaque fallback', () => {
  const [row] = normalizeOccurrences({
    operation_ref: 'base:test', source_data: { '951': '100000' },
    field_contract: [{ occurrence_id: 'official-951', json_path: '$["951"]', alias: '951', label: '예수금', semantic_status: 'official' }],
  });
  assert.equal(row.label, '예수금');
  assert.equal(row.officialOpaque, false);
});

test('json path resolver supports dot, indexed/wildcard arrays, and quoted numeric aliases', () => {
  const source = { data: [{ qty: 7 }], '951': 'x' };
  assert.equal(valueAtPath(source, '$.data[0].qty'), 7);
  assert.deepEqual(valueAtPath({ data: [{ qty: 7 }, { qty: 9 }] }, '$.data[].qty'), [7, 9]);
  assert.equal(valueAtPath(source, '$["951"]'), 'x');
});

test('accepted realtime tick visibly updates active section and matching raw detail alias', () => {
  const makeElement = () => ({
    className: '', dataset: {}, children: [], textContent: '', hidden: false,
    appendChild(child) { this.children.push(child); return child; },
    prepend(child) { this.children.unshift(child); this.strip = child; },
    replaceChildren(...children) { this.children = children; },
    querySelector(selector) { return selector === '.integrated-realtime-strip' ? (this.strip || null) : null; },
    classList: { add() {} },
  });
  const panel = makeElement();
  const value = makeElement();
  const row = makeElement();
  row.dataset.fieldAlias = '10';
  row.querySelector = (selector) => selector === '.semantic-detail-value' ? value : null;
  const root = makeElement();
  root.querySelectorAll = (selector) => selector === '.integrated-card-panel' ? [panel] : [row];
  global.document = { createElement: makeElement };
  try {
    const updated = applyRealtimeTick(root, {
      operationId: '0D', target: '005930', row: { values: { '10': '150840', '121': '22' } },
    });
    assert.equal(updated, 1);
    assert.equal(value.textContent, '150840');
    assert.equal(panel.children[0].dataset.operationId, '0D');
    assert.ok(panel.children[0].children.some((item) => item.textContent === '121 22'));
  } finally {
    delete global.document;
  }
});
