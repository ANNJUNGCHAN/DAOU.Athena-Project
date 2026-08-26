'use strict';

// DOM 빌더는 node --test 경로에서 못 돈다(card-primitives.test.js와 같은 결) — 이
// 스위트는 순수 판정 로직만 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectTrendRow,
  detectStockSummaryHeader,
  render프로그램매매,
} = require('./card-kind-프로그램매매');

test('detectTrendRow — 전체(all_*) 3필드가 다 있으면 인식, 하나라도 빠지면 null', () => {
  const shape = detectTrendRow({ all_buy: '1', all_sel: '1', all_netprps: '0' });
  assert.deepEqual(shape, { hasNdiffpro: false, hasDfrt: false });
  assert.equal(detectTrendRow({ all_buy: '1' }), null);
  assert.equal(detectTrendRow(null), null);
});

test('detectTrendRow — 비차익/차익 9컬럼이 같이 오면(ka90005/ka90010 실측) 둘 다 true', () => {
  const row = {
    all_buy: '1589495', all_sel: '947471', all_netprps: '-111016',
    ndiffpro_trde_buy: '1', ndiffpro_trde_sel: '1', ndiffpro_trde_netprps: '0',
    dfrt_trde_buy: '1', dfrt_trde_sel: '1', dfrt_trde_netprps: '0',
  };
  assert.deepEqual(detectTrendRow(row), { hasNdiffpro: true, hasDfrt: true });
});

test('detectTrendRow — 비차익만 있고 차익은 없는 행도 부분 인식한다', () => {
  const row = {
    all_buy: '1', all_sel: '1', all_netprps: '0',
    ndiffpro_trde_buy: '1', ndiffpro_trde_sel: '1', ndiffpro_trde_netprps: '0',
  };
  assert.deepEqual(detectTrendRow(row), { hasNdiffpro: true, hasDfrt: false });
});

test('detectStockSummaryHeader — ka90004 compound 헤더의 tot_2/4/5 합계 3필드', () => {
  const header = [
    { key: 'tot_1', label: '매수체결수량합계', value: '1' },
    { key: 'tot_2', label: '매수체결금액합계', value: '100' },
    { key: 'tot_4', label: '매도체결금액합계', value: '50' },
    { key: 'tot_5', label: '순매수대금합계', value: '50' },
  ];
  const map = detectStockSummaryHeader(header);
  assert.equal(map.get('tot_2').value, '100');
});

test('detectStockSummaryHeader — 합계 3필드가 다 없으면 null', () => {
  assert.equal(detectStockSummaryHeader([{ key: 'tot_1', value: '1' }]), null);
  assert.equal(detectStockSummaryHeader(undefined), null);
});

test('render프로그램매매 — rows/header 둘 다 없으면(event 등) null — all-or-nothing', () => {
  assert.equal(render프로그램매매({}), null);
  assert.equal(render프로그램매매({ data: {} }), null);
  assert.equal(render프로그램매매({ data: { rows: [] } }), null);
});

test('render프로그램매매 — 아는 모양이 아니면 null', () => {
  assert.equal(render프로그램매매({ data: { rows: [{ unknown_field: '1' }] } }), null);
  assert.equal(render프로그램매매({ data: { header: [{ key: 'unknown', value: '1' }] } }), null);
});
