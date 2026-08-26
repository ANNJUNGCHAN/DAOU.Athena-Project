'use strict';

// DOM 조립(TwoLineRow/ChangeBadge 호출부)은 document가 필요해 node --test(순수 Node)
// 경로에서는 못 돈다(card-primitives.test.js와 같은 결) — 이 스위트는 순수 판정 로직
// (ka10095 모양 판별 + 행 선별)만 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectWatchlistRows } = require('./card-kind-관심종목');

const KA10095_COLUMNS = [
  { key: 'stk_cd' }, { key: 'stk_nm' }, { key: 'cur_prc' },
  { key: 'pred_pre' }, { key: 'pred_pre_sig' }, { key: 'flu_rt' },
];

test('selectWatchlistRows — stk_nm/cur_prc 컬럼이 없으면(ka01300/ka01301 등) null', () => {
  const columns = [{ key: 'gcod' }, { key: 'name' }];
  assert.equal(selectWatchlistRows(columns, [{ gcod: '1', name: '관심그룹1' }]), null);
});

test('selectWatchlistRows — ka10095 모양이면 이름·가격·등락을 골라낸다', () => {
  const rows = [
    { stk_cd: '000660', stk_nm: 'SK하이닉스', cur_prc: '+1701000', pred_pre: '+24000', pred_pre_sig: '2', flu_rt: '+1.43' },
  ];
  assert.deepEqual(selectWatchlistRows(KA10095_COLUMNS, rows), [
    {
      name: 'SK하이닉스', code: '000660', price: '+1701000',
      change: { signValue: '2', amount: '+24000', rate: '+1.43' },
    },
  ]);
});

test('selectWatchlistRows — 종목명·현재가가 없는 행은 생략한다(§4 원칙 1)', () => {
  const rows = [
    { stk_cd: '005930', stk_nm: '', cur_prc: '259500' },
    { stk_cd: '009150', stk_nm: '삼성전기', cur_prc: null },
    { stk_cd: '005935', stk_nm: '삼성전자우', cur_prc: '68500' },
  ];
  assert.deepEqual(selectWatchlistRows(KA10095_COLUMNS, rows), [
    { name: '삼성전자우', code: '005935', price: '68500', change: null },
  ]);
});

test('selectWatchlistRows — 등락 필드가 없으면 change:null(지어내지 않는다)', () => {
  const rows = [{ stk_cd: '005930', stk_nm: '삼성전자', cur_prc: '259500' }];
  assert.deepEqual(selectWatchlistRows(KA10095_COLUMNS, rows), [
    { name: '삼성전자', code: '005930', price: '259500', change: null },
  ]);
});

test('selectWatchlistRows — 유효한 행이 하나도 없으면 빈 배열', () => {
  assert.deepEqual(selectWatchlistRows(KA10095_COLUMNS, [{ stk_nm: '', cur_prc: '' }]), []);
  assert.deepEqual(selectWatchlistRows(KA10095_COLUMNS, []), []);
});
