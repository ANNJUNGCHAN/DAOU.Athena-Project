'use strict';

// DOM 빌더(render보유주식)는 document가 필요해 node --test 경로에서는 못 돈다 —
// 이 스위트는 순수 함수(buildPositionLine/buildPlLabel)만 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPositionLine, buildPlLabel } = require('./card-kind-보유주식');

test('buildPositionLine — ka01690(rmnd_qty/buy_uv/evltv_prft/prft_rt) 필드명', () => {
  const line = buildPositionLine({
    stk_nm: 'SK하이닉스',
    rmnd_qty: '5',
    buy_uv: '1588000',
    evlt_amt: '8505000',
    evltv_prft: '565000',
    prft_rt: '7.10',
  });
  assert.equal(line.name, 'SK하이닉스');
  assert.equal(line.qty, '5');
  assert.equal(line.avgPrice, '1588000');
  assert.equal(line.evalAmt, '8505000');
  assert.equal(line.plAmt, '565000');
  assert.equal(line.plRate, '7.10');
});

test('buildPositionLine — kt50020 금현물(real_qty/avg_prc/est_amt/est_lspft/est_ratio) 필드명', () => {
  const line = buildPositionLine({
    stk_nm: '금 99.99_1Kg',
    real_qty: '10',
    avg_prc: '168300',
    est_amt: '1714200',
    est_lspft: '-31300',
    est_ratio: '1.80',
  });
  assert.equal(line.qty, '10');
  assert.equal(line.avgPrice, '168300');
  assert.equal(line.evalAmt, '1714200');
  assert.equal(line.plAmt, '-31300');
  assert.equal(line.plRate, '1.80');
});

test('buildPositionLine — kt00004(pl_amt/pl_rt), kt00005(cur_qty/pl_rt) 필드명도 인식한다', () => {
  const kt00004 = buildPositionLine({
    stk_nm: 'A', rmnd_qty: '1', avg_prc: '100', evlt_amt: '100', pl_amt: '5', pl_rt: '5.0',
  });
  assert.equal(kt00004.plAmt, '5');
  assert.equal(kt00004.plRate, '5.0');

  const kt00005 = buildPositionLine({
    stk_nm: 'B', cur_qty: '2', buy_uv: '200', evlt_amt: '400', evltv_prft: '10', pl_rt: '2.5',
  });
  assert.equal(kt00005.qty, '2');
  assert.equal(kt00005.plRate, '2.5');
});

test('buildPositionLine — 종목명·수량·평가금액 중 하나라도 없으면 null(행 단위 생략)', () => {
  assert.equal(buildPositionLine({ stk_nm: 'A', rmnd_qty: '1' }), null); // evlt_amt 없음
  assert.equal(buildPositionLine({ rmnd_qty: '1', evlt_amt: '1' }), null); // stk_nm 없음
  assert.equal(buildPositionLine(null), null);
});

test('buildPositionLine — 평균단가가 없어도(선택 필드) 나머지는 채워진다', () => {
  const line = buildPositionLine({ stk_nm: 'A', rmnd_qty: '1', evlt_amt: '100' });
  assert.equal(line.avgPrice, undefined);
  assert.equal(line.evalAmt, '100');
});

test('buildPlLabel — 양수 손익은 "+" 부호, 손익률과 괄호로 묶는다', () => {
  assert.equal(buildPlLabel('565000', '7.1'), '+565,000원 (7.1%)');
});

test('buildPlLabel — 음수 손익은 "-" 부호(toLocaleString이 이미 포함)', () => {
  assert.equal(buildPlLabel('-31300', '1.8'), '-31,300원 (1.8%)');
});

test('buildPlLabel — 이미 %가 붙어 있으면 중복으로 안 붙인다', () => {
  assert.equal(buildPlLabel('1000', '5%'), '+1,000원 (5%)');
});

test('buildPlLabel — 손익금액만 있고 손익률이 없으면 금액만', () => {
  assert.equal(buildPlLabel('1000', undefined), '+1,000원');
});

test('buildPlLabel — 둘 다 없으면 null(배지를 안 만든다)', () => {
  assert.equal(buildPlLabel(undefined, undefined), null);
  assert.equal(buildPlLabel(null, ''), null);
});
