// 카드 v3(.omc/state/card-v3-plan.md §2.3/§3 Wave 1-4 레인1) 카드종 — "종목정보".
// IIFE 스코프 격리 + UMD(2026-08-18 렌더러 격리, chart-card.js와 같은 패턴).
//
// 근거: .omc/state/card-v3-specs.json "12d 종목정보카드" gap 분석 + Paper 목업
// (종목정보카드.png) + backend/athena_api/generated/models.py의 Ka10001*Response 7종
// (identity_and_capital/market_scale_and_ownership/price_range/valuation/
// financial_performance/daily_price_band/current_trading) 필드 실측.
//
// 핵심 사실: ka10001은 "7분할" — 조회당 7개 그룹 중 **하나**의 필드만 이 envelope에
// 실린다(전부 합쳐진 envelope은 없다). Paper 목업은 가격+등락배지 / 1일범위 / 52주범위 /
// 랭크타일 2개를 한 프레임에 합쳐 그리지만, 그건 이 카드가 소유한 여러 TR 응답을
// "합쳤을 때 나올 법한 이상적 프리뷰"이지 실제 단일 응답이 아니다 — 여러 TR을 하나로
// 합성하는 건 "1 TR = 1 카드" 컨벤션 위반(§4-3, 이번 계획 스코프 밖)이라 하지 않는다.
// 그래서 이 렌더러는 "지금 이 envelope에 어떤 그룹의 필드가 실려 있는가"를 판정해
// **그 그룹에 맞는 조각 하나만** 그린다(all-or-nothing은 조각 단위로 적용) — 다른 그룹의
// 필드가 필요한 조각은 만들지 않는다.
//
// 분기별 근거:
// - current_trading(cur_prc/flu_rt 등) → QuoteHeader. stk_nm/stk_cd는 이 그룹에 없어
//   (identity_and_capital 소유) 서브라인 없이 가격+배지만 뜬다 — 지어내지 않는다.
// - daily_price_band(low_pric/high_pric 등) → "1일 범위" RangeBar. 같은 그룹에 현재가가
//   없어 점 마커는 못 그린다(마커=현재가 위치인데 이 응답엔 현재가가 없다) — 라벨 없는
//   범위만 그린다(필드 단위 생략, §4-1). low/high는 크기(절대값) 기준으로 0 이하이거나
//   역전(low>high)이면 안 그린다(isValidPriceRange) — 진짜 깨진 데이터만 걸러내는
//   최후 방어선이다. 2026-08-26 카드 데모 실측: 처음엔 "1일 범위 -255,500 ~ 266,500"을
//   음수 가격이라 오판해 통째로 숨겼는데, 그 부호는 값의 부호가 아니라 기준가 대비
//   방향 표기였다(low_pric은 "부호가 포함된 숫자", card-primitives.js priceMagnitude
//   주석 참고) — 정상 데이터를 표시 버그로 착각한 것이었다. RangeBar가 이제
//   priceMagnitude로 부호를 걷어내고 그리므로, 여기 가드는 그 뒤(크기 기준)에서
//   0 이하·역전 같은 진짜 이상값만 잡는다.
// - price_range(oyr_lwst/oyr_hgst 등) → "연중 범위" RangeBar. Paper는 "52주 범위"라
//   쓰지만 gap 분석 실측대로 이 필드는 정확히 rolling 52주가 아니라 연중(달력연도)
//   최저/최고다 — "52주"라고 라벨을 붙이면 정보 정직성(soul.md §8) 위반이라 있는
//   그대로 "연중 범위"로 표기한다. 같은 isValidPriceRange 가드가 적용된다.
// - 거래대금 1위/체결강도 랭크 타일 — 이 카드가 소유한 6개 TR 전체에 랭킹/체결강도
//   필드가 없다(backend 미실재, gap 분석 확인) — 프리미티브 목록에도 애초에 없다
//   (RankTile은 plan §1에서 제외됨). 구현하지 않는다.
// - identity_and_capital/valuation/financial_performance/market_scale_and_ownership 및
//   ka10099/ka10100/ka10101/ka10102(table)/0g(event) — 이 카드에 특화된 시각 이득이
//   없어(facts-grid가 라벨:값 나열로 이미 충분히 정직하게 보여준다) null로 범용
//   렌더러에 맡긴다.
(function () {
'use strict';

const __isCjs = typeof module !== 'undefined' && module.exports;
function __dep(reqPath, globalName) {
  return __isCjs ? require(reqPath) : window.AthenaLib[globalName];
}
const { QuoteHeader, RangeBar, priceMagnitude } = __dep('./card-primitives', 'CardPrimitives');

// 가격 범위 최후 방어선(팀리드 지시로 2026-08-26 카드 데모 실측 뒤 크기 기준으로
// 완화 — card-primitives.js priceMagnitude 주석 참고: "-255500"의 부호는 값이 아니라
// 기준가 대비 방향 표기라 크기(255500)는 정상이다). 여기서는 RangeBar가 그리는 부호
// 걷어낸 크기가 정말로 말이 되는지만 본다 — 0 이하이거나 저가>고가(역전)면 진짜 깨진
// 데이터이므로 이 조각 전체를 안 그린다(필드 하나만 죽이지 않고 조각째 폴백,
// all-or-nothing). 순수 함수(node --test 대상) — priceMagnitude와 같은 파싱 규칙을
// 공유해 "부호 걷어내기"를 두 곳에서 따로 구현하지 않는다.
function isValidPriceRange(low, high) {
  const l = Number(priceMagnitude(low));
  const h = Number(priceMagnitude(high));
  return Number.isFinite(l) && Number.isFinite(h) && l > 0 && h > 0 && l <= h;
}

function fieldMap(envelope) {
  const fields = envelope && envelope.data && Array.isArray(envelope.data.fields) ? envelope.data.fields : null;
  if (!fields) return null; // facts 모양이 아니면(table/compound/event) 이 카드종은 관여하지 않는다
  const map = new Map();
  for (const f of fields) {
    if (f && f.key !== undefined) map.set(f.key, f.value);
  }
  return map;
}

// 순수 함수(node --test 대상) — envelope 하나가 어느 ka10001 그룹인지 판정하고, 그
// 그룹에 맞는 조각 하나를 기술한다. 판정 순서: current_trading → daily_price_band →
// price_range → (매치 없음, null). 세 그룹 필드는 서로 겹치지 않는다(모델 실측 확인).
function pickPrimaryView(envelope) {
  const map = fieldMap(envelope);
  if (!map) return null;
  if (map.has('cur_prc')) {
    return {
      kind: 'quote',
      price: map.get('cur_prc'),
      changeValue: map.has('flu_rt') ? map.get('flu_rt') : undefined,
      name: map.has('stk_nm') ? map.get('stk_nm') : undefined,
      code: map.has('stk_cd') ? map.get('stk_cd') : undefined,
    };
  }
  if (map.has('low_pric') && map.has('high_pric')) {
    const low = map.get('low_pric');
    const high = map.get('high_pric');
    if (!isValidPriceRange(low, high)) return null; // 음수/0/역전 — 오해를 부르는 막대를 그리지 않는다
    return { kind: 'daily-range', label: '1일 범위', low, high };
  }
  if (map.has('oyr_lwst') && map.has('oyr_hgst')) {
    const low = map.get('oyr_lwst');
    const high = map.get('oyr_hgst');
    if (!isValidPriceRange(low, high)) return null;
    return { kind: 'year-range', label: '연중 범위', low, high };
  }
  return null;
}

function renderQuoteSection(view) {
  return QuoteHeader({
    price: view.price,
    changeKey: 'flu_rt',
    changeValue: view.changeValue,
    name: view.name,
    code: view.code,
  });
}

function renderRangeSection(view) {
  const wrap = document.createElement('div');
  wrap.className = 'card-kind-종목정보-range';
  const label = document.createElement('div');
  label.className = 'card-kind-종목정보-range-label';
  label.textContent = view.label;
  wrap.appendChild(label);
  wrap.appendChild(RangeBar({ low: view.low, high: view.high }));
  return wrap;
}

// all-or-nothing renderFn(envelope) → HTMLElement|null (card-kinds.js 계약).
function render종목정보(envelope) {
  const view = pickPrimaryView(envelope);
  if (!view) return null;
  if (view.kind === 'quote') return renderQuoteSection(view);
  return renderRangeSection(view);
}

const __exports = { pickPrimaryView, isValidPriceRange, render종목정보 };
if (__isCjs) {
  module.exports = __exports;
} else {
  window.AthenaLib.CardKinds.register('종목정보', render종목정보);
}

})();
