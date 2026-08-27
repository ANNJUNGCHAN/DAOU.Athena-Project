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
const { LadderRow, ProportionalBar, QuoteHeader, ladderRatio, proportionalRatios } = CardPrimitives;
const FactsCard = typeof module !== 'undefined' && module.exports
  ? require('./facts-card')
  : window.AthenaLib.FactsCard;
const { formatNumeric } = FactsCard;

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
  // level(1-based, 배열 위치 그대로) — 실시간 0D 틱(FID 61~70/71~80, 레벨
  // 오름차순)이 이 행을 다시 찾을 때 쓴다(applyLiveTick 참고). REST 응답이
  // 일부 레벨을 빠뜨려도(if (f)) 원래 순번은 그대로 유지된다.
  shape.sell.forEach((key, i) => {
    const f = map.get(key);
    if (f) levels.push({ side: 'ask', level: i + 1, label: f.label, quantity: Number(f.value) || 0 });
  });
  shape.buy.forEach((key, i) => {
    const f = map.get(key);
    if (f) levels.push({ side: 'bid', level: i + 1, label: f.label, quantity: Number(f.value) || 0 });
  });
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
    row.dataset.hogaSide = level.side;
    row.dataset.hogaLevel = String(level.level);
    // 실시간 틱이 일부 레벨만 갱신할 때(applyLadderTick) 나머지 레벨의 "현재값"을
    // 다시 읽을 곳 — 매번 포맷된 텍스트(천단위 콤마)를 역파싱하지 않는다.
    row.dataset.hogaQty = String(level.quantity);
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

// 실시간 호가잔량(0D) 1건을 이미 그려진 조각에 이어붙인다(task #25 — 0D 소비는
// canvas.js wireOrderbookRealtime이 매 틱마다 이걸 부른다). 카드가 처음에 어느
// 조각(래더/비율바/QuoteHeader)을 그렸는지는 wrap의 클래스로 판정한다 —
// render호가가 셋 중 하나만 돌려주므로(all-or-nothing) 겹칠 일이 없다.
// quote-emphasis(QuoteHeader)는 0D에 대응 필드가 없어 갱신 대상이 없다 —
// 조용히 아무 것도 안 한다(없는 값을 지어내지 않는다).
function applyLadderTick(wrap, tick) {
  const rows = wrap.querySelectorAll('.card-kit-row-ladder');
  if (!rows.length) return;
  // maxQuantity는 이 카드의 모든 행(이번 틱이 건드리지 않은 행 포함) 기준이어야
  // 막대 비율이 서로 어긋나지 않는다 — 건드린 행만으로 다시 재면 안 건드린 행이
  // 더 큰 값을 갖고 있어도 막대가 상대적으로 과장돼 보인다(2026-08-27 실측으로
  // 잡음: 부분 갱신 틱에서 100%로 잘못 그려졌었다). 그래서 각 행에 현재 수량을
  // dataset.hogaQty로 들고 다니다가(buildLadder가 최초값을 심는다) 이번 틱 값이
  // 있으면 그걸로, 없으면 그 값 그대로 다시 쓴다.
  let touched = false;
  const quantities = Array.from(rows).map((row) => {
    const list = row.dataset.hogaSide === 'ask' ? tick.sellQuantities : tick.buyQuantities;
    const level = Number(row.dataset.hogaLevel);
    const incoming = list && Number.isFinite(level) ? list[level - 1] : null;
    if (incoming !== null && incoming !== undefined) {
      touched = true;
      return incoming;
    }
    const prior = Number(row.dataset.hogaQty);
    return Number.isFinite(prior) ? prior : 0;
  });
  // 이 카드가 그린 레벨 중 이번 틱에 하나도 없으면(예: REST 5레벨뿐인 ka10087
  // 카드에 6~10레벨만 있는 틱) 갱신하지 않는다 — 안 건드린 값을 다시 그려봐야
  // 의미가 없다.
  if (!touched) return;
  const maxQuantity = quantities.reduce((m, q) => Math.max(m, Math.abs(q)), 0);
  rows.forEach((row, i) => {
    const q = quantities[i];
    row.dataset.hogaQty = String(q);
    const bar = row.querySelector('.card-kit-row-ladder-bar');
    if (bar) bar.style.width = `${Math.round(ladderRatio(q, maxQuantity) * 100)}%`;
    const qtyEl = row.querySelector('.card-kit-row-ladder-qty');
    if (qtyEl) qtyEl.textContent = formatNumeric(q);
  });
}

function applyTotalsTick(wrap, tick) {
  if (tick.sellTotal == null || tick.buyTotal == null) return; // 지어내지 않는다
  const rows = wrap.querySelectorAll('.card-kit-bar-row');
  if (rows.length < 2) return;
  const values = [tick.sellTotal, tick.buyTotal];
  const ratios = proportionalRatios(values);
  rows.forEach((row, i) => {
    const fill = row.querySelector('.card-kit-bar-fill');
    if (fill) fill.style.width = `${Math.round(ratios[i] * 100)}%`;
    const valueEl = row.querySelector('.card-kit-bar-value');
    if (valueEl) valueEl.textContent = formatNumeric(values[i]);
  });
}

function applyLiveTick(wrap, envelope, tick) {
  if (!wrap || !tick) return;
  if (wrap.classList.contains('card-kit-hoga-ladder')) {
    applyLadderTick(wrap, tick);
    return;
  }
  if (wrap.classList.contains('card-kit-bar-proportional')) {
    applyTotalsTick(wrap, tick);
  }
}

const __exports = {
  // 순수 로직 — node --test 대상
  fieldsMap,
  detectLadderShape,
  detectTotals,
  detectQuoteEmphasis,
  render호가,
  applyLiveTick,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib.CardKinds.register('호가', render호가);
  // CardKindQuote/CardKindStockInfo와 같은 문법(card-kind-시세.js 주석) —
  // CardKinds.resolve(title)는 renderFn 하나만 돌려주는 계약이라 실시간 갱신은
  // 별도 네임스페이스로 낸다.
  window.AthenaLib.CardKindHoga = { applyLiveTick };
}

})();
