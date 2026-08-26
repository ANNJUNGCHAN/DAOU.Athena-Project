'use strict';

// DOM 조립(TwoLineRow/ChangeBadge 호출부)은 document가 필요해 node --test(순수 Node)
// 경로에서는 못 돈다(card-primitives.test.js와 같은 결) — 이 스위트는 순수 판정 로직
// (어떤 필드를 고르고 어떻게 분류하는가)만 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectAccountFacts, selectCurrencyRows } = require('./card-kind-계좌');

test('selectAccountFacts — kt00004류: 손익 필드만 있는 응답은 전부 profit으로 분류된다', () => {
  const fields = [
    { key: 'lspft2', label: '당월투자손익', value: '+182400' },
    { key: 'lspft_rt', label: '누적손익율', value: '+1.53' },
  ];
  assert.deepEqual(selectAccountFacts(fields), [
    { key: 'lspft2', label: '당월투자손익', value: '+182400', unit: '원', kind: 'profit' },
    { key: 'lspft_rt', label: '누적손익율', value: '+1.53', unit: '%', kind: 'profit' },
  ]);
});

// 2026-08-26 데모 캡처 결함 재현 — app/captures/card-demo/보유주식.png(제목 "계좌").
// kt00018:portfolio_summary(계좌평가현황요청)는 손익 필드(tot_evlt_pl/tot_prft_rt)와
// 손익이 아닌 실계좌 필드(tot_pur_amt 등)가 한 응답에 섞여 있다 — 전자만 골라내고
// 후자를 버리면 그것도 정보 손실이므로, 손익 필드가 하나라도 있으면 값이 실재하는
// 필드는 전부(kind로 구분해서) 포함해야 한다.
test('selectAccountFacts — kt00018류: 손익 필드가 있으면 같이 온 비손익 필드도 버리지 않는다', () => {
  const fields = [
    { key: 'tot_pur_amt', label: null, value: '000000172645300' },
    { key: 'tot_evlt_amt', label: null, value: '000000214456400' },
    { key: 'tot_evlt_pl', label: null, value: '000000040027357' },
    { key: 'tot_prft_rt', label: null, value: '000000023.18' },
    { key: 'prsm_dpst_aset_amt', label: null, value: '000000532960056' },
  ];
  assert.deepEqual(selectAccountFacts(fields), [
    { key: 'tot_pur_amt', label: '총매입금액', value: '000000172645300', unit: '원', kind: 'plain' },
    { key: 'tot_evlt_amt', label: '총평가금액', value: '000000214456400', unit: '원', kind: 'plain' },
    { key: 'tot_evlt_pl', label: '총평가손익금액', value: '000000040027357', unit: '원', kind: 'profit' },
    { key: 'tot_prft_rt', label: '총수익률', value: '000000023.18', unit: '%', kind: 'profit' },
    { key: 'prsm_dpst_aset_amt', label: '추정예탁자산', value: '000000532960056', unit: '원', kind: 'plain' },
  ]);
});

// 2026-08-26 추가 결함 재현 — app/captures/card-demo/계좌.png. 이 HTTP 경로는 label을
// 비우는 대신 **키 이름을 그대로 label에 채워** 보낸다(예: label:"tdy_lspft") — 옛
// 우선순위(field.label || LABEL_FALLBACK)는 field.label이 "참"이라 절대 못 걸렀다.
// 아는 키는 field.label이 뭐라고 하든 우리가 models.py로 검증한 라벨을 쓴다.
test('selectAccountFacts — 아는 키는 field.label이 키를 그대로 echo해도 검증된 한글 라벨을 쓴다', () => {
  const fields = [
    { key: 'tdy_lspft', label: 'tdy_lspft', value: '0' },
    { key: 'lspft2', label: 'lspft2', value: '0' },
    { key: 'lspft', label: 'lspft', value: '0' },
    { key: 'tdy_lspft_rt', label: 'tdy_lspft_rt', value: '0' },
    { key: 'lspft_ratio', label: 'lspft_ratio', value: '0' },
    { key: 'lspft_rt', label: 'lspft_rt', value: '0' },
  ];
  assert.deepEqual(selectAccountFacts(fields).map((r) => r.label), [
    '당일투자손익', '당월투자손익', '누적투자손익', '당일손익율', '당월손익율', '누적손익율',
  ]);
});

test('selectAccountFacts — 모르는 키는 field.label이 있으면 그걸 쓰고, 없으면 key로 물러난다', () => {
  const fields = [
    { key: 'tot_evlt_pl', label: null, value: '100' }, // 게이트를 여는 손익 필드
    { key: 'unknown_field', label: '알수없는필드라벨', value: '1' },
    { key: 'another_unknown', label: null, value: '2' },
  ];
  assert.deepEqual(selectAccountFacts(fields).map((r) => [r.key, r.label]), [
    ['tot_evlt_pl', '총평가손익금액'],
    ['unknown_field', '알수없는필드라벨'],
    ['another_unknown', 'another_unknown'],
  ]);
});

test('selectAccountFacts — 손익 필드가 하나도 없으면 null(이 렌더러가 아는 모양이 아니다)', () => {
  assert.equal(selectAccountFacts([{ key: 'tot_pur_amt', label: '총매입금액', value: '100' }]), null);
  assert.equal(selectAccountFacts([{ key: 'stk_nm', label: '종목명', value: '삼성전자' }]), null);
  assert.equal(selectAccountFacts([]), null);
  assert.equal(selectAccountFacts(undefined), null);
});

test('selectAccountFacts — 값이 없는(null/undefined/빈문자) 필드는 손익 여부와 무관하게 생략한다', () => {
  const fields = [
    { key: 'tot_evlt_pl', label: '총평가손익금액', value: '100' }, // 게이트를 여는 손익 필드
    { key: 'tot_pur_amt', label: '총매입금액', value: null },
    { key: 'tot_evlt_amt', label: '총평가금액', value: undefined },
    { key: 'prsm_dpst_aset_amt', label: '추정예탁자산', value: '' },
  ];
  assert.deepEqual(selectAccountFacts(fields), [
    { key: 'tot_evlt_pl', label: '총평가손익금액', value: '100', unit: '원', kind: 'profit' },
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
