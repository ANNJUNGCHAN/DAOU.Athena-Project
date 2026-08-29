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
  detectStockNetFlow,
  detectForeignInstitutionRanking,
  detectInstitutionForeignDaily,
  extractFlowRows,
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

test('신규 수급 5종의 실측 행 모양을 전용 수급 화면으로 판정한다', () => {
  const cases = [
    [{ stk_cd: '005930', stk_nm: '삼성전자', buy_qty: '100', sel_qty: '80', netslmt: '20' }, 'stock_net_flow'],
    [{ stk_cd: '005930', stk_nm: '삼성전자', netprps_qty: '20', netprps_amt: '1762000' }, 'stock_net_flow'],
    [{ stk_cd: '005930', stk_nm: '삼성전자', buy_qty: '100', sell_qty: '80', netprps_qty: '20' }, 'stock_net_flow'],
    [{
      for_netslmt_stk_nm: '삼성전자', for_netslmt_qty: '100',
      for_netprps_stk_nm: 'SK하이닉스', for_netprps_qty: '90',
      orgn_netslmt_stk_nm: 'NAVER', orgn_netslmt_qty: '80',
      orgn_netprps_stk_nm: '카카오', orgn_netprps_qty: '70',
    }, 'foreign_institution_ranking'],
    [{ dt: '20260828', orgn_daly_nettrde_qty: '100', for_daly_nettrde_qty: '-50' }, 'institution_foreign_daily'],
  ];
  for (const [row, shape] of cases) assert.equal(detectShape([row]), shape);
  assert.equal(detectStockNetFlow(cases[0][0]), true);
  assert.equal(detectForeignInstitutionRanking(cases[3][0]), true);
  assert.equal(detectInstitutionForeignDaily(cases[4][0]), true);
});

test('extractFlowRows — ka10045 compound의 table rows를 잃지 않는다', () => {
  const rows = [{ dt: '20260828', orgn_daly_nettrde_qty: '100', for_daly_nettrde_qty: '-50' }];
  assert.deepEqual(extractFlowRows({ data: { header: [], table: { columns: [], rows } } }), rows);
});

test('render수급 — rows가 없으면(facts/compound 등 다른 레이아웃) null — all-or-nothing', () => {
  assert.equal(render수급({}), null);
  assert.equal(render수급({ data: {} }), null);
  assert.equal(render수급({ data: { rows: [] } }), null);
});

test('render수급 — 아는 모양이 아니면 null', () => {
  assert.equal(render수급({ data: { rows: [{ unknown_field: '1' }] } }), null);
});
