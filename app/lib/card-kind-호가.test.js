'use strict';

// DOM 빌더(LadderRow/ProportionalBar/QuoteHeader 호출부)는 document가 필요해
// node --test 경로에서는 못 돈다(card-primitives.test.js와 같은 결) — 이 스위트는
// 순수 판정 로직(어떤 detail: 응답 조각인지)만 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  fieldsMap,
  detectLadderShape,
  detectTotals,
  detectQuoteEmphasis,
  buildOrderbookState,
  mergeTickIntoState,
  mergeTicks,
  supportsLive0D,
  visibleLevels,
  visibleColumns,
  render호가,
} = require('./card-kind-호가');

test('supportsLive0D — 정규장 0D 카드만 Canvas 구독을 허용한다', () => {
  assert.equal(supportsLive0D({ __athenaOrderbookState: { liveSource: '0D' } }), true);
  assert.equal(supportsLive0D({ __athenaOrderbookState: { liveSource: null } }), false);
  assert.equal(supportsLive0D(null), false);
});

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

test('detectTotals — ka10004 시간외 합계 ovt_sel_req/ovt_buy_req', () => {
  const map = fieldsMap(facts({ ovt_sel_req: '1200', ovt_buy_req: '1400' }));
  assert.deepEqual(detectTotals(map), { sellKey: 'ovt_sel_req', buyKey: 'ovt_buy_req' });
});

test('detectTotals — ka10087 전용 sel_bid_tot_req/buy_bid_tot_req', () => {
  const map = fieldsMap(facts({ sel_bid_tot_req: '1', buy_bid_tot_req: '2' }));
  assert.deepEqual(detectTotals(map), { sellKey: 'sel_bid_tot_req', buyKey: 'buy_bid_tot_req' });
});

test('detectTotals — ka10087 응답에 정규장·시간외 합계가 함께 있으면 시간외을 선택한다', () => {
  const map = fieldsMap(facts({
    sel_bid_tot_req: '9999',
    buy_bid_tot_req: '8888',
    ovt_sigpric_sel_bid_tot_req: '1200',
    ovt_sigpric_buy_bid_tot_req: '1400',
  }));
  assert.deepEqual(detectTotals(map), {
    sellKey: 'ovt_sigpric_sel_bid_tot_req',
    buyKey: 'ovt_sigpric_buy_bid_tot_req',
  });
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

test('buildOrderbookState — identity projection도 통합 호가창의 종목 헤더로 유지한다', () => {
  const state = buildOrderbookState(facts({ stk_nm: '삼성전자', stk_cd: '005930' }));
  assert.equal(state.name, '삼성전자');
  assert.equal(state.symbol, '005930');
  assert.equal(state.focus, '종목 식별');
});

test('buildOrderbookState — 분리된 가격 detail도 통합 10단의 정확한 레벨을 채운다', () => {
  const state = buildOrderbookState(facts({
    sel_10th_pre_bid: '-89000',
    sel_fpr_bid: '-88100',
    buy_fpr_bid: '+88000',
    buy_10th_pre_bid: '+87100',
  }));
  assert.equal(state.asks[9].price, 89000);
  assert.equal(state.asks[0].price, 88100);
  assert.equal(state.bids[0].price, 88000);
  assert.equal(state.bids[9].price, 87100);
  assert.equal(state.focus, '가격축');
});

test('buildOrderbookState — 잔량/증감/총잔량 detail도 같은 상태 모델을 채운다', () => {
  const state = buildOrderbookState(facts({
    sel_fpr_req: '120',
    sel_1th_pre_req_pre: '+17',
    buy_fpr_req: '200',
    buy_1th_pre_req_pre: '-9',
    tot_sel_req: '5000',
    tot_buy_req: '6200',
  }));
  assert.equal(state.asks[0].quantity, 120);
  assert.equal(state.asks[0].change, 17);
  assert.equal(state.bids[0].quantity, 200);
  assert.equal(state.bids[0].change, -9);
  assert.equal(state.sellTotal, 5000);
  assert.equal(state.buyTotal, 6200);
});

test('buildOrderbookState — ka10007 가격·잔량·증감·건수·LP 잔량을 통합 10단에 정확히 배치한다', () => {
  const state = buildOrderbookState(facts({
    sel_10bid: '-89000',
    sel_1bid: '-88100',
    sel_1bid_req: '120',
    sel_1bid_jub_pre: '+17',
    sel_1bid_cnt: '4',
    lpsel_1bid_req: '35',
    buy_1bid: '+88000',
    buy_10bid: '+87100',
    buy_1bid_req: '200',
    buy_1bid_jub_pre: '-9',
    buy_1bid_cnt: '6',
    lpbuy_1bid_req: '48',
  }));
  assert.equal(state.asks[9].price, 89000);
  assert.deepEqual(state.asks[0], { level: 1, price: 88100, quantity: 120, change: 17, count: 4, auxQuantity: 35 });
  assert.deepEqual(state.bids[0], { level: 1, price: 88000, quantity: 200, change: -9, count: 6, auxQuantity: 48 });
  assert.equal(state.bids[9].price, 87100);
  assert.equal(state.focus, 'LP 잔량');
});

test('buildOrderbookState — 건수와 총잔량 projection의 포커스를 구분한다', () => {
  assert.equal(buildOrderbookState(facts({ sel_1bid_cnt: '4' })).focus, '주문 건수');
  assert.equal(buildOrderbookState(facts({ tot_sel_req: '5000', tot_buy_req: '6200' })).focus, '총잔량');
});

test('buildOrderbookState — ka10007 session의 REST 예상체결가·수량을 seed한다', () => {
  const state = buildOrderbookState(facts({ exp_cntr_pric: '+88100', exp_cntr_qty: '240' }));
  assert.equal(state.expectedExecutionPrice, 88100);
  assert.equal(state.expectedExecutionQuantity, 240);
  assert.equal(state.focus, '예상체결');
});

test('buildOrderbookState — ka10004 after_hours_totals는 시간외 요약으로 고정하고 0D를 받지 않는다', () => {
  const state = buildOrderbookState(
    facts({ ovt_sel_req: '1200', ovt_buy_req: '1400' }),
    'kiwoom_rest:detail:ka10004:after_hours_totals'
  );
  assert.equal(state.marketMode, 'after-hours-summary');
  assert.equal(state.depth, 0);
  assert.equal(state.liveSource, null);
  assert.equal(state.focus, '총잔량');
  assert.equal(state.sellTotal, 1200);
  assert.equal(state.buyTotal, 1400);
});

test('buildOrderbookState — ka10087은 시간외 5단 REST 모드로 고정한다', () => {
  const state = buildOrderbookState(facts({
    ovt_sigpric_sel_bid_5: '88500',
    ovt_sigpric_sel_bid_1: '88100',
    ovt_sigpric_buy_bid_1: '88000',
    ovt_sigpric_buy_bid_5: '87600',
  }));
  assert.equal(state.marketMode, 'after-hours');
  assert.equal(state.depth, 5);
  assert.equal(state.liveSource, null);
  assert.equal(state.asks[4].price, 88500);
  assert.equal(state.bids[0].price, 88000);
});

test('buildOrderbookState — ka10087 snapshot_time은 operation_ref로 시간외 모드를 판단한다', () => {
  const state = buildOrderbookState(
    facts({ bid_req_base_tm: '160001' }),
    'kiwoom_rest:detail:ka10087:snapshot_time'
  );
  assert.equal(state.marketMode, 'after-hours');
  assert.equal(state.depth, 5);
  assert.equal(state.liveSource, null);
});

test('mergeTickIntoState — 0D의 값 있는 칸만 REST 스냅샷 위에 병합한다', () => {
  const state = buildOrderbookState(facts({ sel_fpr_bid: '88100', sel_fpr_req: '120' }));
  mergeTickIntoState(state, {
    sellPrices: [88200, null],
    sellQuantities: [145, null],
    buyPrices: [88000],
    currentPrice: 88100,
    expectedExecutionPrice: 88050,
    expectedExecutionQuantity: 240,
    time: '102418',
  });
  assert.equal(state.asks[0].price, 88200);
  assert.equal(state.asks[0].quantity, 145);
  assert.equal(state.asks[1].price, null);
  assert.equal(state.bids[0].price, 88000);
  assert.equal(state.currentPrice, 88100);
  assert.equal(state.expectedExecutionPrice, 88050);
  assert.equal(state.expectedExecutionQuantity, 240);
  assert.equal(state.time, '102418');
});

test('mergeTickIntoState — 시간외 5단 REST는 정규장 0D로 덮어쓰지 않는다', () => {
  const state = buildOrderbookState(facts({ ovt_sigpric_sel_bid_1: '88100' }));
  mergeTickIntoState(state, { sellPrices: [99000], expectedExecutionPrice: 99000 });
  assert.equal(state.asks[0].price, 88100);
  assert.equal(state.expectedExecutionPrice, null);
});

test('mergeTicks — 한 프레임 안의 여러 틱은 최신 non-null 값으로 합친다', () => {
  const merged = mergeTicks(
    { sellPrices: [88100, 88200], sellQuantities: [100, 200], currentPrice: 88000 },
    { sellPrices: [null, 88300], sellQuantities: [120, null], currentPrice: null }
  );
  assert.deepEqual(merged.sellPrices.slice(0, 2), [88100, 88300]);
  assert.deepEqual(merged.sellQuantities.slice(0, 2), [120, 200]);
  assert.equal(merged.currentPrice, 88000);
});


// --- 좁은 창 반응형 (Paper 15Y5-2 · 카드 표면 헌장 11조) -------------------------

test('좁은 폭에서는 표시 단수가 10단에서 줄어든다', () => {
  assert.equal(visibleLevels({ marketMode: 'regular', width: 390 }), 3);
  assert.equal(visibleLevels({ marketMode: 'regular', width: 500 }), 5);
  assert.equal(visibleLevels({ marketMode: 'regular', width: 600 }), 10);
  // 폭을 아직 못 잰 첫 페인트는 줄이지 않는다 — 0단으로 붕괴하면 안 된다.
  assert.equal(visibleLevels({ marketMode: 'regular', width: 0 }), 10);
  assert.equal(visibleLevels({ marketMode: 'regular' }), 10);
});

test('단수 축소는 marketMode를 바꾸지 않는다', () => {
  const state = buildOrderbookState(facts({ sel_fpr_bid: '88200', buy_fpr_bid: '88100' }));
  assert.equal(state.marketMode, 'regular');
  assert.equal(visibleLevels({ marketMode: state.marketMode, width: 390 }), 3);
  assert.equal(state.marketMode, 'regular');
  assert.equal(state.depth, 10);
  // 시간외 5단은 넓어져도 5단을 넘지 않는다.
  assert.equal(visibleLevels({ marketMode: 'after-hours', width: 900 }), 5);
  assert.equal(visibleLevels({ marketMode: 'after-hours-summary', width: 900 }), 0);
});

test('좁은 폭에서는 가격·잔량 2열만 남는다', () => {
  assert.deepEqual(visibleColumns({ width: 390 }), ['price', 'qty']);
  assert.deepEqual(visibleColumns({ width: 600 }), ['count', 'qty', 'change', 'price', 'bar']);
  assert.deepEqual(visibleColumns({}), ['count', 'qty', 'change', 'price', 'bar']);
});

test('호가 행 글자는 12px 이상이다 — 헌장 11조', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'card-kind-hoga.css'), 'utf8');
  const rules = css.match(/\.card-kit-hoga-live-row \{[^}]*\}/g) || [];
  const sizes = rules.map((rule) => rule.match(/font-size:\s*(\d+)px/)).filter(Boolean);
  assert.ok(sizes.length, '행 font-size가 없다');
  for (const size of sizes) {
    assert.ok(Number(size[1]) >= 12, `행 글자가 ${size[1]}px다 — 판단 텍스트는 12px 이상`);
  }
});

test('호가 CSS에 컨테이너 폭 규칙이 있다', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'card-kind-hoga.css'), 'utf8');
  assert.match(css, /container-type:\s*inline-size/);
  assert.match(css, /@container[^{]*max-width/);
});
