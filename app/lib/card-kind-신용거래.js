// 카드 v3(.omc/state/card-v3-plan.md §2.3, US-004 잔여 4종) 카드종 — "신용거래".
// IIFE 스코프 격리 + UMD 각주(card-primitives.js와 같은 패턴).
//
// 실측 근거: .omc/state/card-v3-wave5-specs.json[1](신용거래카드 gap 분석) — 이
// 카드 타이틀로 귀결되는 TR이 3개(ka10013 table / kt20016 compound / kt20017
// facts)라, canvas.js의 renderMcpTable/renderCompoundCard/renderFactsCard 세
// 훅 전부가 같은 title로 이 렌더러를 부른다. 큐레이션은 ka10013(table 모양,
// envelope.data.rows)만 한다 — kt20016/kt20017은 gap 분석에서 축약 필요성이
// 확인되지 않았다(이미 CompoundCard/FactsCard 범용 렌더로 충분). envelope에
// rows가 없으면(=ka10013이 아니면) null을 돌려줘 그 두 TR은 항상 기존 범용
// 렌더 그대로 나간다 — 같은 title을 공유해도 서로 다른 봉투 모양을 침범하지 않는다.
//
// 필드(backend/athena_api/generated/models.py Ka10013ResponseCrdTrdeTrendItem):
// dt/remn/remn_rt/pred_pre 전부 실재. Paper 라벨 "신용잔고"/"증감"은 실제 필드
// 설명("잔고"/"전일대비")의 의역이라(gap 분석 명시) 여기서는 필드 원 설명에
// 가까운 라벨을 쓴다 — 없는 의미를 붙이지 않는다.
//
// 생략(구현 안 함, .omc/state/phase3-list.md 기록): "3 API" 배지·STOCKINFO TR
// 범례 목록·"3개 TR을 한 카드로 합성" 그 자체 — Paper의 합성 카드 개념은 사용자
// 확정 "1 TR = 1 카드" 규칙과 정면충돌한다(gap 분석 결론과 동일).
(function () {
'use strict';

const CardPrimitives = typeof module !== 'undefined' && module.exports
  ? require('./card-primitives')
  : window.AthenaLib.CardPrimitives;
const FactsCard = typeof module !== 'undefined' && module.exports
  ? require('./facts-card')
  : window.AthenaLib.FactsCard;
const { TwoLineRow, extractDataRows } = CardPrimitives;
const { formatNumeric, formatDatetime, formatPercent } = FactsCard;

// row(ka10013 신용매매동향 한 행) → 렌더용 모델 | null(일자·잔고 중 하나라도
// 없으면 이 행을 생략한다).
function buildCreditLine(row) {
  if (!row) return null;
  const dt = row.dt;
  const balance = row.remn;
  if (dt === undefined || dt === null || dt === '') return null;
  if (balance === undefined || balance === null || balance === '') return null;

  const parts = [];
  const rate = formatPercent(row.remn_rt);
  if (rate) parts.push(`잔고율 ${rate}`);
  if (row.pred_pre !== undefined && row.pred_pre !== null && row.pred_pre !== '') {
    parts.push(`전일대비 ${formatNumeric(row.pred_pre)}`);
  }

  return {
    title: formatDatetime(dt),
    value: `${formatNumeric(balance)}주`,
    valueSub: parts.join(' · ') || null,
  };
}

function render신용거래(envelope) {
  const lines = extractDataRows(envelope).map(buildCreditLine).filter(Boolean);
  if (!lines.length) return null; // ka10013이 아니거나(kt20016/kt20017) 핵심 필드가 없으면 범용 렌더로 폴백

  const wrap = document.createElement('div');
  wrap.className = 'card-kind-신용거래-list';
  for (const line of lines) {
    wrap.appendChild(TwoLineRow({ title: line.title, value: line.value, valueSub: line.valueSub }));
  }
  return wrap;
}

const __exports = { formatPercent, buildCreditLine, render신용거래 };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib.CardKinds.register('신용거래', render신용거래);
}

})();
