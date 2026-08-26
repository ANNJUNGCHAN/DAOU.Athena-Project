// 카드 v3(.omc/state/card-v3-plan.md §2.3/§3 Wave 1-4 레인2) 카드종 — "호가".
//
// 스코프(팀리드 지시 + 실측): 호가 9분할 통합 금지 — 이 파일은 detail: 응답 하나(=카드
// 하나)의 필드만으로 그 안에서 그릴 수 있는 조각만 만든다. 다른 detail: 응답을 왕복해
// 합치지 않는다. 실측(backend/ref/kiwoom-screen-definitions.json의 scalar_field_allowlist
// 전수 확인, 2026-08-26): ka10004/ka10007/ka10087 어느 detail: 응답도 가격과 잔량을
// 같은 봉투에 함께 담지 않는다(가격 그룹과 잔량 그룹이 항상 분리돼 있다) — 그래서
// LadderRow는 이 카드 계열에서 가격 없이(잔량+막대만) 쓴다. price가 없으면
// formatNumeric(undefined)='—'로 정직하게 표시된다(facts-card.js 계약 그대로) — 값을
// 지어내지 않는다. 레벨별 등락률(%) 파생 계산은 pred_close_pric이 이 응답에 없으면
// 만들지 않는다(플랜 §3 레인2 스코프 제한).
(function () {
'use strict';

const CardPrimitives = typeof module !== 'undefined' && module.exports
  ? require('./card-primitives')
  : window.AthenaLib.CardPrimitives;
const { LadderRow, ProportionalBar, QuoteHeader } = CardPrimitives;

// ---------- 순수 로직 — 봉투 fields를 보고 이 응답이 어떤 조각인지 판정한다 ----------
// (node --test 대상: DOM 없이 검증 가능)

function fieldsMap(fields) {
  const map = new Map();
  for (const f of Array.isArray(fields) ? fields : []) {
    if (f && typeof f.key === 'string') map.set(f.key, f);
  }
  return map;
}

// 잔량 래더 조각 5종(실측, 전부 서로 다른 detail: 응답의 배타적 필드셋):
//   ka10007:bid_quantities(매도10+매수10 한 봉투) · ka10004:sell_bid_quantities(매도10만) ·
//   ka10004:buy_bid_quantities(매수10만) · ka10087:sell_bid_quantities(매도5만) ·
//   ka10087:buy_bid_quantities(매수5만)
const _LADDER_SHAPES = [
  {
    name: 'ka10007_both',
    sell: ['sel_1bid_req', 'sel_2bid_req', 'sel_3bid_req', 'sel_4bid_req', 'sel_5bid_req',
      'sel_6bid_req', 'sel_7bid_req', 'sel_8bid_req', 'sel_9bid_req', 'sel_10bid_req'],
    buy: ['buy_1bid_req', 'buy_2bid_req', 'buy_3bid_req', 'buy_4bid_req', 'buy_5bid_req',
      'buy_6bid_req', 'buy_7bid_req', 'buy_8bid_req', 'buy_9bid_req', 'buy_10bid_req'],
  },
  {
    name: 'ka10004_sell',
    sell: ['sel_fpr_req', 'sel_2th_pre_req', 'sel_3th_pre_req', 'sel_4th_pre_req', 'sel_5th_pre_req',
      'sel_6th_pre_req', 'sel_7th_pre_req', 'sel_8th_pre_req', 'sel_9th_pre_req', 'sel_10th_pre_req'],
    buy: [],
  },
  {
    name: 'ka10004_buy',
    sell: [],
    buy: ['buy_fpr_req', 'buy_2th_pre_req', 'buy_3th_pre_req', 'buy_4th_pre_req', 'buy_5th_pre_req',
      'buy_6th_pre_req', 'buy_7th_pre_req', 'buy_8th_pre_req', 'buy_9th_pre_req', 'buy_10th_pre_req'],
  },
  {
    name: 'ka10087_sell',
    sell: ['ovt_sigpric_sel_bid_qty_1', 'ovt_sigpric_sel_bid_qty_2', 'ovt_sigpric_sel_bid_qty_3',
      'ovt_sigpric_sel_bid_qty_4', 'ovt_sigpric_sel_bid_qty_5'],
    buy: [],
  },
  {
    name: 'ka10087_buy',
    sell: [],
    buy: ['ovt_sigpric_buy_bid_qty_1', 'ovt_sigpric_buy_bid_qty_2', 'ovt_sigpric_buy_bid_qty_3',
      'ovt_sigpric_buy_bid_qty_4', 'ovt_sigpric_buy_bid_qty_5'],
  },
];

// 첫 키가 있으면 그 조각으로 확정한다(같은 detail: 응답 안에서 두 조각이 섞이지 않음을
// 실측으로 확인했으므로 배타적 첫-매치면 충분하다).
function detectLadderShape(map) {
  for (const shape of _LADDER_SHAPES) {
    const first = shape.sell[0] || shape.buy[0];
    if (map.has(first)) return shape;
  }
  return null;
}

function detectTotals(map) {
  if (map.has('tot_sel_req') && map.has('tot_buy_req')) {
    return { sellKey: 'tot_sel_req', buyKey: 'tot_buy_req' };
  }
  if (map.has('sel_bid_tot_req') && map.has('buy_bid_tot_req')) {
    return { sellKey: 'sel_bid_tot_req', buyKey: 'buy_bid_tot_req' };
  }
  return null;
}

function detectQuoteEmphasis(map) {
  if (map.has('cur_prc') && map.has('flu_rt')) return { priceKey: 'cur_prc', changeKey: 'flu_rt' };
  if (map.has('ovt_sigpric_cur_prc') && map.has('ovt_sigpric_flu_rt')) {
    return { priceKey: 'ovt_sigpric_cur_prc', changeKey: 'ovt_sigpric_flu_rt' };
  }
  return null;
}

// ---------- DOM 빌더 — document가 있는 렌더러 전용 ----------

function buildLadder(map, shape) {
  const levels = [];
  for (const key of shape.sell) {
    const f = map.get(key);
    if (f) levels.push({ side: 'ask', label: f.label, quantity: Number(f.value) || 0 });
  }
  for (const key of shape.buy) {
    const f = map.get(key);
    if (f) levels.push({ side: 'bid', label: f.label, quantity: Number(f.value) || 0 });
  }
  if (!levels.length) return null;
  const maxQuantity = levels.reduce((m, l) => Math.max(m, Math.abs(l.quantity)), 0);
  const wrap = document.createElement('div');
  wrap.className = 'card-kit-hoga-ladder';
  for (const level of levels) {
    const row = LadderRow({
      side: level.side,
      quantity: level.quantity,
      maxQuantity,
      price: undefined, // 이 detail: 응답엔 가격 필드가 없다 — 지어내지 않고 '—'로 둔다.
    });
    row.title = level.label;
    wrap.appendChild(row);
  }
  return wrap;
}

function buildTotalsBar(map, totals) {
  const sellField = map.get(totals.sellKey);
  const buyField = map.get(totals.buyKey);
  return ProportionalBar({
    values: [Number(sellField.value) || 0, Number(buyField.value) || 0],
    labels: [sellField.label, buyField.label],
  });
}

function buildQuoteEmphasis(map, quote) {
  const priceField = map.get(quote.priceKey);
  const changeField = map.get(quote.changeKey);
  return QuoteHeader({
    price: priceField.value,
    changeKey: quote.changeKey,
    changeValue: changeField ? changeField.value : undefined,
  });
}

function render호가(envelope) {
  const fields = envelope && envelope.data && Array.isArray(envelope.data.fields)
    ? envelope.data.fields
    : null;
  if (!fields || !fields.length) return null; // facts 레이아웃이 아니면(예: ka50101 table) 범용 렌더러로 폴백.
  const map = fieldsMap(fields);

  const totals = detectTotals(map);
  if (totals) return buildTotalsBar(map, totals);

  const quote = detectQuoteEmphasis(map);
  if (quote) return buildQuoteEmphasis(map, quote);

  const ladderShape = detectLadderShape(map);
  if (ladderShape) return buildLadder(map, ladderShape);

  return null;
}

const __exports = {
  // 순수 로직 — node --test 대상
  fieldsMap,
  detectLadderShape,
  detectTotals,
  detectQuoteEmphasis,
  render호가,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.CardKindHoga = __exports;
  window.AthenaLib.CardKinds.register('호가', render호가);
}

})();
