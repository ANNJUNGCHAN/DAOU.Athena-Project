'use strict';

// DOM 빌더(renderQuoteSection/renderRangeSection/render종목정보)는 document가 필요해
// node --test(순수 Node) 경로에서는 못 돈다 — 이 스위트는 판정 로직(pickPrimaryView)만
// 검증한다. ka10001의 7개 detail_group 필드는 서로 겹치지 않는다
// (backend/athena_api/generated/models.py 실측) — 각 분기가 그 전제를 그대로 반영한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const { pickPrimaryView, isValidPriceRange } = require('./card-kind-종목정보');

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

// 가격 범위 최후 방어선(팀리드 지시, 2026-08-26 카드 데모 실측 후속) — 실제 캡처된
// 값으로 재현한다: 종목정보.png가 "1일 범위 -255,500 ~ 266,500"을 그렸다. 처음엔
// 이걸 "음수 가격이라 무효"로 판정해 조각째 숨겼는데, backend 검증 결과 그 부호는
// 값의 부호가 아니라 low_pric("부호가 포함된 숫자")의 기준가 대비 방향 표기였다 —
// 정상 데이터를 표시 버그로 오판한 것이었다. isValidPriceRange는 이제 크기(절대값)
// 기준으로만 판정한다(priceMagnitude와 같은 파싱 규칙 공유) — 그래서 이 값은 이제
// 유효(255,500 <= 266,500)다.
test('isValidPriceRange — 실제 캡처된 값(-255500 ~ 266500)은 이제 유효 — 부호는 방향 표기일 뿐 값이 아니다', () => {
  assert.equal(isValidPriceRange('-255500', '266500'), true);
  assert.equal(isValidPriceRange('-256500', '+266500'), true); // +/- 둘 다 걷어낸다
});

test('isValidPriceRange — 정상 범위(둘 다 양수, low<=high)는 유효', () => {
  assert.equal(isValidPriceRange('1692000', '1714000'), true);
  assert.equal(isValidPriceRange(100, 100), true); // low===high(당일 변동 없음)도 유효
});

// 여기부터는 크기 기준으로도 진짜 깨진 데이터인 경우 — 최후 방어선은 그대로 남는다.
test('isValidPriceRange — 크기가 0이면(부호를 걷어내도 0) 무효', () => {
  assert.equal(isValidPriceRange('0', '100'), false);
  assert.equal(isValidPriceRange('100', '0'), false);
  assert.equal(isValidPriceRange('-0', '100'), false); // 부호 걷어내도 크기 0
});

test('isValidPriceRange — 부호를 걷어낸 뒤에도 저가>고가(진짜 역전)면 무효', () => {
  assert.equal(isValidPriceRange('200', '100'), false); // 부호 없이도 역전
  assert.equal(isValidPriceRange('-300000', '100000'), false); // 크기 300000 > 100000, 부호가 있어도 역전은 역전
});

test('isValidPriceRange — 비유한값(파싱 불가)은 무효', () => {
  assert.equal(isValidPriceRange('n/a', '100'), false);
  assert.equal(isValidPriceRange('100', undefined), false);
});

test('pickPrimaryView — daily_price_band에 실제 캡처된 부호 붙은 저가가 오면 이제 뷰를 돌려준다(원문 부호는 그대로 보존 — RangeBar가 렌더 시점에 걷어낸다)', () => {
  const envelope = envelopeWithFields([
    ['open_pric', '10000'], ['high_pric', '266500'], ['low_pric', '-255500'], ['base_pric', '10000'],
  ]);
  assert.deepEqual(pickPrimaryView(envelope), { kind: 'daily-range', label: '1일 범위', low: '-255500', high: '266500' });
});

test('pickPrimaryView — price_range(연중 범위)도 같은 값으로 이제 뷰를 돌려준다', () => {
  const envelope = envelopeWithFields([['oyr_hgst', '266500'], ['oyr_lwst', '-255500']]);
  assert.deepEqual(pickPrimaryView(envelope), { kind: 'year-range', label: '연중 범위', low: '-255500', high: '266500' });
});

test('pickPrimaryView — 크기 기준으로도 진짜 깨진 daily_price_band(저가 0)는 여전히 null', () => {
  const envelope = envelopeWithFields([['high_pric', '266500'], ['low_pric', '0']]);
  assert.equal(pickPrimaryView(envelope), null);
});
