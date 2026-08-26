'use strict';

// DOM 빌더(renderQuoteSection/renderRangeSection/render종목정보)는 document가 필요해
// node --test(순수 Node) 경로에서는 못 돈다 — 이 스위트는 판정 로직(pickPrimaryView)만
// 검증한다. ka10001의 7개 detail_group 필드는 서로 겹치지 않는다
// (backend/athena_api/generated/models.py 실측) — 각 분기가 그 전제를 그대로 반영한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const { pickPrimaryView } = require('./card-kind-종목정보');

function envelopeWithFields(fields) {
  return { data: { fields: fields.map(([key, value]) => ({ key, value })) } };
}

test('pickPrimaryView — current_trading 모양(cur_prc 있음)은 quote 뷰, stk_nm/stk_cd는 이 그룹에 없어 undefined', () => {
  const envelope = envelopeWithFields([
    ['cur_prc', '1701000'], ['pre_sig', '2'], ['pred_pre', '23000'], ['flu_rt', '+1.37'], ['trde_qty', '311392'],
  ]);
  assert.deepEqual(pickPrimaryView(envelope), {
    kind: 'quote', price: '1701000', changeValue: '+1.37', name: undefined, code: undefined,
  });
});

test('pickPrimaryView — daily_price_band 모양(low_pric+high_pric 있음, cur_prc 없음)은 1일 범위 뷰', () => {
  const envelope = envelopeWithFields([
    ['open_pric', '1698000'], ['high_pric', '1714000'], ['low_pric', '1692000'], ['base_pric', '1700000'],
  ]);
  assert.deepEqual(pickPrimaryView(envelope), { kind: 'daily-range', label: '1일 범위', low: '1692000', high: '1714000' });
});

test('pickPrimaryView — price_range 모양(oyr_lwst+oyr_hgst 있음)은 "52주"가 아니라 정직하게 "연중 범위"로 표기한다', () => {
  const envelope = envelopeWithFields([
    ['oyr_hgst', '3002000'], ['oyr_lwst', '253000'], ['f_250hgst', '2998000'], ['f_250lwst', '260000'],
  ]);
  const view = pickPrimaryView(envelope);
  assert.equal(view.kind, 'year-range');
  assert.equal(view.label, '연중 범위');
  assert.notEqual(view.label, '52주 범위'); // 라벨-데이터 불일치 방지(gap 분석 경고 반영)
  assert.deepEqual(view, { kind: 'year-range', label: '연중 범위', low: '253000', high: '3002000' });
});

test('pickPrimaryView — identity_and_capital 모양(stk_nm/stk_cd만, 가격/범위 없음)은 null(범용 facts-grid로 폴백)', () => {
  const envelope = envelopeWithFields([
    ['stk_cd', '000660'], ['stk_nm', 'SK하이닉스'], ['setl_mm', '12'], ['fav', '5000'], ['cap', '365'], ['flo_stk', '728002365'],
  ]);
  assert.equal(pickPrimaryView(envelope), null);
});

test('pickPrimaryView — valuation/financial_performance 등 나머지 그룹도 null', () => {
  assert.equal(pickPrimaryView(envelopeWithFields([['per', '15.2'], ['eps', '1200'], ['roe', '8.1']])), null);
  assert.equal(pickPrimaryView(envelopeWithFields([['sale_amt', '1000'], ['bus_pro', '200'], ['cup_nga', '150']])), null);
});

test('pickPrimaryView — table/compound/event 모양(fields 배열 없음)이면 null(이 카드종은 관여하지 않는다)', () => {
  assert.equal(pickPrimaryView({ data: { columns: [], rows: [] } }), null);
  assert.equal(pickPrimaryView({ data: { header: [], table: {} } }), null);
  assert.equal(pickPrimaryView({}), null);
  assert.equal(pickPrimaryView(undefined), null);
});

test('pickPrimaryView — 빈 fields 배열은 null', () => {
  assert.equal(pickPrimaryView(envelopeWithFields([])), null);
});
