'use strict';

// DOM 조립(TwoLineRow/ChangeBadge 호출부)은 document가 필요해 node --test(순수 Node)
// 경로에서는 못 돈다(card-primitives.test.js와 같은 결) — 이 스위트는 순수 판정 로직
// (어떤 필드/행을 고르는가)만 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectProfitFields, selectCurrencyRows } = require('./card-kind-계좌');

test('selectProfitFields — 손익 필드(원/율)만 원래 순서로 고른다', () => {
  const fields = [
    { key: 'tdy_lspft_amt', label: '당일투자원금', value: '10000000' }, // 원금 — 대상 아님
    { key: 'lspft2', label: '당월투자손익', value: '+182400' },
    { key: 'lspft_rt', label: '누적손익율', value: '+1.53' },
    { key: 'invt_bsamt', label: '투자기준금액', value: '12000000' }, // 기준금액 — 대상 아님
  ];
  assert.deepEqual(selectProfitFields(fields), [
    { key: 'lspft2', label: '당월투자손익', value: '+182400', unit: '원' },
    { key: 'lspft_rt', label: '누적손익율', value: '+1.53', unit: '%' },
  ]);
});

test('selectProfitFields — 값이 없는(null/undefined/빈문자) 손익 필드는 생략한다', () => {
  const fields = [
    { key: 'lspft', label: '누적투자손익', value: null },
    { key: 'lspft2', label: '당월투자손익', value: undefined },
    { key: 'tdy_lspft', label: '당일투자손익', value: '' },
  ];
  assert.deepEqual(selectProfitFields(fields), []);
});

test('selectProfitFields — 손익 필드가 하나도 없으면(다른 카드의 facts) 빈 배열', () => {
  assert.deepEqual(selectProfitFields([{ key: 'stk_nm', label: '종목명', value: '삼성전자' }]), []);
  assert.deepEqual(selectProfitFields([]), []);
  assert.deepEqual(selectProfitFields(undefined), []);
});

test('selectProfitFields — label이 없으면 key를 라벨로 대체한다', () => {
  assert.deepEqual(selectProfitFields([{ key: 'lspft', value: '100' }]), [
    { key: 'lspft', label: 'lspft', value: '100', unit: '원' },
  ]);
});

test('selectCurrencyRows — crnc_cd/fx_entr 컬럼이 없으면(다른 table 응답) null', () => {
  const columns = [{ key: 'ord_alow_amt', label: '주문가능금액' }];
  assert.equal(selectCurrencyRows(columns, [{ ord_alow_amt: '100' }]), null);
});

test('selectCurrencyRows — KRW/USD 행만 고르고 나머지 통화는 생략한다', () => {
  const columns = [{ key: 'crnc_cd' }, { key: 'fx_entr' }];
  const rows = [
    { crnc_cd: 'KRW', fx_entr: '4120500' },
    { crnc_cd: 'USD', fx_entr: '0' },
    { crnc_cd: 'JPY', fx_entr: '500000' },
  ];
  assert.deepEqual(selectCurrencyRows(columns, rows), [
    { code: 'KRW', label: '원화', amount: '4120500' },
    { code: 'USD', label: '달러', amount: '0' },
  ]);
});

test('selectCurrencyRows — 모양은 맞지만 KRW/USD 행이 없으면 빈 배열', () => {
  const columns = [{ key: 'crnc_cd' }, { key: 'fx_entr' }];
  assert.deepEqual(selectCurrencyRows(columns, [{ crnc_cd: 'JPY', fx_entr: '1000' }]), []);
});

test('selectCurrencyRows — fx_entr 값이 비어 있는 행은 생략한다', () => {
  const columns = [{ key: 'crnc_cd' }, { key: 'fx_entr' }];
  assert.deepEqual(selectCurrencyRows(columns, [{ crnc_cd: 'USD', fx_entr: null }]), []);
});
