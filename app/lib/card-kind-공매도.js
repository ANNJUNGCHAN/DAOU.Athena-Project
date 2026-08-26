// 카드 v3(.omc/state/card-v3-plan.md §2.3, US-004 잔여 4종) 카드종 — "공매도".
// IIFE 스코프 격리 + UMD 각주(card-primitives.js와 같은 패턴).
//
// 실측 근거: .omc/state/card-v3-wave5-specs.json[2](공매도카드 gap 분석),
// backend/athena_api/generated/models.py(Ka10014ResponseShrtsTrnsnItem) —
// dt/shrts_qty/trde_wght/shrts_avg_pric 전부 실재. base:ka10014 단일 TR,
// domain=shortsale → 이 카드 타이틀로 귀결되는 TR이 이것 하나뿐이라(gap 분석
// "SHORTSALE 1"과 일치) 매수/매도 같은 다중 detail_group 분기 없이 바로 큐레이션한다.
//
// 생략(구현 안 함, .omc/state/phase3-list.md 기록): "1 API" 배지 — makeCard()에
// API 호출수 배지 UI 자체가 앱에 없다(다른 레인 전부 동일 판정). SHORTSALE 도메인
// 그룹/TR 카탈로그 행은 Paper 문서 전용(카드-TR 보드 표현 규칙, 사용자 확정) —
// 런타임 렌더 대상이 아니다.
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

// row(일별 공매도 추이 한 행) → 렌더용 모델 | null(일자·공매도량 중 하나라도
// 없으면 이 행을 생략한다 — 핵심 식별 필드 없이 반쪽으로 안 그린다).
function buildShortsaleLine(row) {
  if (!row) return null;
  const dt = row.dt;
  const qty = row.shrts_qty;
  if (dt === undefined || dt === null || dt === '') return null;
  if (qty === undefined || qty === null || qty === '') return null;

  const parts = [];
  const weight = formatPercent(row.trde_wght);
  if (weight) parts.push(`비중 ${weight}`);
  if (row.shrts_avg_pric !== undefined && row.shrts_avg_pric !== null && row.shrts_avg_pric !== '') {
    parts.push(`평균 ${formatNumeric(row.shrts_avg_pric)}원`);
  }

  return {
    title: formatDatetime(dt),
    value: `${formatNumeric(qty)}주`,
    valueSub: parts.join(' · ') || null,
  };
}

function render공매도(envelope) {
  const lines = extractDataRows(envelope).map(buildShortsaleLine).filter(Boolean);
  if (!lines.length) return null;

  const wrap = document.createElement('div');
  wrap.className = 'card-kind-공매도-list';
  for (const line of lines) {
    wrap.appendChild(TwoLineRow({ title: line.title, value: line.value, valueSub: line.valueSub }));
  }
  return wrap;
}

const __exports = { formatPercent, buildShortsaleLine, render공매도 };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib.CardKinds.register('공매도', render공매도);
}

})();
