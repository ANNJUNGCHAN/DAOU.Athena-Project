'use strict';

// DOM 빌더(LadderRow/ProportionalBar/QuoteHeader 호출부)는 document가 필요해
// node --test 경로에서는 못 돈다(card-primitives.test.js와 같은 결) — 이 스위트는
// 순수 판정 로직(어떤 detail: 응답 조각인지)만 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fieldsMap,
  detectLadderShape,
  detectTotals,
  detectQuoteEmphasis,
  render호가,
} = require('./card-kind-호가');

function facts(pairs) {
  return Object.entries(pairs).map(([key, value]) => ({ key, label: `라벨:${key}`, value }));
}

test('fieldsMap — key로 조회 가능한 Map을 만든다(값 없는 항목은 무시)', () => {
  const map = fieldsMap(facts({ a: '1', b: '2' }));
  assert.equal(map.get('a').value, '1');
  assert.equal(map.size, 2);
  assert.deepEqual([...fieldsMap(undefined).keys()], []);
  assert.deepEqual([...fieldsMap([null, { value: '1' }]).keys()], []); // key 없는 항목은 건너뜀
});

test('detectTotals — ka10007/ka10004 공용 tot_sel_req/tot_buy_req', () => {
  const map = fieldsMap(facts({ tot_sel_req: '12033', tot_buy_req: '26809' }));
  assert.deepEqual(detectTotals(map), { sellKey: 'tot_sel_req', buyKey: 'tot_buy_req' });
});

test('detectTotals — ka10087 전용 sel_bid_tot_req/buy_bid_tot_req', () => {
  const map = fieldsMap(facts({ sel_bid_tot_req: '1', buy_bid_tot_req: '2' }));
  assert.deepEqual(detectTotals(map), { sellKey: 'sel_bid_tot_req', buyKey: 'buy_bid_tot_req' });
});

test('detectTotals — 둘 다 없으면 null(범용 렌더러로 폴백)', () => {
  assert.equal(detectTotals(fieldsMap(facts({ stk_cd: '005930' }))), null);
  assert.equal(detectTotals(fieldsMap(facts({ tot_sel_req: '1' }))), null); // 짝 없이 하나만
});

test('detectQuoteEmphasis — ka10007(cur_prc/flu_rt)', () => {
  const map = fieldsMap(facts({ cur_prc: '1699000', flu_rt: '+1.25' }));
  assert.deepEqual(detectQuoteEmphasis(map), { priceKey: 'cur_prc', changeKey: 'flu_rt' });
});

test('detectQuoteEmphasis — ka10087(ovt_sigpric_cur_prc/ovt_sigpric_flu_rt)', () => {
  const map = fieldsMap(facts({ ovt_sigpric_cur_prc: '1699000', ovt_sigpric_flu_rt: '+1.25' }));
  assert.deepEqual(detectQuoteEmphasis(map), { priceKey: 'ovt_sigpric_cur_prc', changeKey: 'ovt_sigpric_flu_rt' });
});

test('detectQuoteEmphasis — 없으면 null', () => {
  assert.equal(detectQuoteEmphasis(fieldsMap(facts({ stk_cd: '005930' }))), null);
});

test('detectLadderShape — ka10007 매도+매수 20필드 한 봉투', () => {
  const map = fieldsMap(facts({ sel_1bid_req: '10', buy_1bid_req: '20' }));
  assert.equal(detectLadderShape(map).name, 'ka10007_both');
});

test('detectLadderShape — ka10004 매도전용/매수전용은 서로 다른 조각', () => {
  assert.equal(detectLadderShape(fieldsMap(facts({ sel_fpr_req: '1' }))).name, 'ka10004_sell');
  assert.equal(detectLadderShape(fieldsMap(facts({ buy_fpr_req: '1' }))).name, 'ka10004_buy');
});

test('detectLadderShape — ka10087 매도전용/매수전용(5레벨)', () => {
  assert.equal(
    detectLadderShape(fieldsMap(facts({ ovt_sigpric_sel_bid_qty_1: '1' }))).name,
    'ka10087_sell'
  );
  assert.equal(
    detectLadderShape(fieldsMap(facts({ ovt_sigpric_buy_bid_qty_1: '1' }))).name,
    'ka10087_buy'
  );
});

test('detectLadderShape — 매칭 없으면 null', () => {
  assert.equal(detectLadderShape(fieldsMap(facts({ stk_nm: '삼성전자' }))), null);
});

test('render호가 — facts 필드가 없으면(table/event 등) null — all-or-nothing', () => {
  assert.equal(render호가({}), null);
  assert.equal(render호가({ data: {} }), null);
  assert.equal(render호가({ data: { rows: [], columns: [] } }), null); // ka50101(table) 경로
});

test('render호가 — 아는 조각이 하나도 없으면 null(예: identity/session 디테일)', () => {
  const envelope = { data: { fields: facts({ stk_nm: '삼성전자', stk_cd: '005930' }) } };
  assert.equal(render호가(envelope), null);
});
