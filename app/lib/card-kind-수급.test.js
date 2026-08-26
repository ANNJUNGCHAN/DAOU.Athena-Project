'use strict';

// DOM 빌더는 node --test 경로에서 못 돈다(card-primitives.test.js와 같은 결) — 이
// 스위트는 순수 판정 로직(어느 TR 행 모양인지)만 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectStockInvestorSplit,
  detectContinuousTrade,
  detectForeignDaily,
  detectGoldInvestor,
  detectShape,
  render수급,
} = require('./card-kind-수급');

test('detectStockInvestorSplit — ka10061 개인/외국인/기관 3필드(Paper 목업과 동일 모양)', () => {
  const row = { ind_invsr: '500618', frgnr_invsr: '-1351370', orgn: '850752', fnnc_invt: '1' };
  assert.equal(detectStockInvestorSplit(row), true);
  assert.equal(detectStockInvestorSplit({ ind_invsr: '1', frgnr_invsr: '1' }), false); // orgn 없음
  assert.equal(detectStockInvestorSplit(null), false);
});

test('detectContinuousTrade — ka10131 종목별 순위 행(stk_nm+기관/외국인 순매매)', () => {
  const row = { stk_nm: '삼성전자', orgn_nettrde_amt: '100', frgnr_nettrde_amt: '-50', rank: '1' };
  assert.equal(detectContinuousTrade(row), true);
  assert.equal(detectContinuousTrade({ stk_nm: '삼성전자' }), false); // 짝 필드 없음
  assert.equal(detectContinuousTrade(null), false);
});

test('detectForeignDaily — ka10008 종목 하나의 일자별 외국인 변동', () => {
  const row = { dt: '20260825', chg_qty: '-1200', frgnr_limit_irds: '10' };
  assert.equal(detectForeignDaily(row), true);
  assert.equal(detectForeignDaily({ dt: '20260825' }), false);
});

test('detectGoldInvestor — ka52301 매수/매도/순매수 금액 3필드', () => {
  const row = { all_dfrt_trst_buy_amt: '10', all_dfrt_trst_sell_amt: '20', all_dfrt_trst_netprps_amt: '-10' };
  assert.equal(detectGoldInvestor(row), true);
  assert.equal(detectGoldInvestor({ all_dfrt_trst_buy_amt: '10' }), false);
});

test('detectShape — 첫 행으로 넷 중 하나를 정확히 고른다', () => {
  assert.equal(
    detectShape([{ ind_invsr: '1', frgnr_invsr: '1', orgn: '1' }]),
    'stock_investor_split'
  );
  assert.equal(detectShape([{ stk_nm: 'x', orgn_nettrde_amt: '1', frgnr_nettrde_amt: '1' }]), 'continuous_trade');
  assert.equal(detectShape([{ dt: '1', chg_qty: '1', frgnr_limit_irds: '1' }]), 'foreign_daily');
  assert.equal(
    detectShape([{ all_dfrt_trst_buy_amt: '1', all_dfrt_trst_sell_amt: '1', all_dfrt_trst_netprps_amt: '1' }]),
    'gold_investor'
  );
});

test('detectShape — 빈 배열/모르는 모양은 null', () => {
  assert.equal(detectShape([]), null);
  assert.equal(detectShape(null), null);
  assert.equal(detectShape([{ unknown_field: '1' }]), null);
});

test('render수급 — rows가 없으면(facts/compound 등 다른 레이아웃) null — all-or-nothing', () => {
  assert.equal(render수급({}), null);
  assert.equal(render수급({ data: {} }), null);
  assert.equal(render수급({ data: { rows: [] } }), null);
});

test('render수급 — 아는 모양이 아니면 null', () => {
  assert.equal(render수급({ data: { rows: [{ unknown_field: '1' }] } }), null);
});
