// 카드 v3(.omc/state/card-v3-plan.md §2.3/§3 Wave 1-4 레인1) 카드종 — "차트".
// IIFE 스코프 격리 + UMD(2026-08-18 렌더러 격리, chart-card.js와 같은 패턴).
//
// 근거: .omc/state/card-v3-specs.json "차트카드" gap 분석 + Paper 목업(차트카드.png).
// 목업의 유일한 실제 gap은 툴바 행 우측의 큰 가격 텍스트("1,701,000", 등락 배지
// 없음 — 목업 실측 확인) 하나다. 캔들/거래량/주기탭/차트모양/보조지표/수정주가/
// 전체화면은 이미 다 구현돼 있고(app/lib/chart-card.js), 오히려 Paper보다 기능이
// 많다(역방향 gap, §4-7) — 손대지 않는다.
//
// 계약이 다른 카드종(다른 3곳)과 다르다: canvas_type='chart'는 renderFactsCard/
// renderMcpTable/renderCompoundCard가 아니라 canvas.js의 renderLiveChart를 거친다.
// _RENDER_PLAN_LAYOUTS={facts,table,compound}(backend/athena_api/canvas_transform.py
// L319)라 chart 도메인 TR은 이 3곳에 절대 도달하지 않는다 — 그래서 renderLiveChart
// 안에 별도 후킹이 필요했다(팀리드 승인, canvas.js renderLiveChart 참고). 그 후킹은
// REPLACE가 아니라 AUGMENT 계약이다: chart-card.js가 이미 완전한 렌더러라 대체할
// body가 없다 — 이 renderFn이 돌려주는 건 "차트 마운트 지점 위에 얹는 조각"이지
// 카드 본문 전체가 아니다. null이면 아무것도 안 얹는다(기존 렌더와 100% 동일).
//
// 등락 배지를 안 그리는 이유(의도적 축소): backend canvas_transform._CHART_FIELD_MAP
// (L24-31)은 캔들 필드를 time/open/high/low/close/volume 6개로만 좁힌다 —
// pred_pre/pred_pre_sig는 매핑 테이블에 없어 변환 단계에서 버려지고 프런트엔드
// envelope에 아예 안 실린다(추정 불가, 원본 필드 자체가 도달하지 않는다). Paper
// 목업도 마찬가지로 배지 없이 가격 숫자만 보여준다(실측) — 그러니 "가격만" 그리는
// 게 목업 재현으로도, 데이터 정직성으로도 맞는 선택이다.
(function () {
'use strict';

const __isCjs = typeof module !== 'undefined' && module.exports;
function __dep(reqPath, globalName) {
  return __isCjs ? require(reqPath) : window.AthenaLib[globalName];
}
const { QuoteHeader } = __dep('./card-primitives', 'CardPrimitives');

// 순수 함수(node --test 대상) — AITS 라이브 차트 envelope(app/lib/aits-chart-panel.js
// parseAitsChartSnapshot이 읽는 것과 같은 data.chart.candles 모양)에서 마지막 봉의
// 종가만 뽑는다. candles가 없거나 비어 있거나 close가 유한하지 않으면 null.
function extractLastClose(envelope) {
  const chart = envelope && envelope.data && envelope.data.chart;
  const candles = chart && Array.isArray(chart.candles) ? chart.candles : null;
  if (!candles || !candles.length) return null;
  const last = candles[candles.length - 1];
  const close = last && Number(last.close);
  return Number.isFinite(close) ? close : null;
}

function renderPriceAugment(price) {
  const wrap = document.createElement('div');
  wrap.className = 'card-kind-차트-quote';
  wrap.appendChild(QuoteHeader({ price }));
  return wrap;
}

// AUGMENT renderFn(envelope) → HTMLElement|null — canvas.js renderLiveChart 전용
// 계약(다른 3곳의 REPLACE 계약과 다르다, 상단 주석 참고).
function render차트(envelope) {
  const price = extractLastClose(envelope);
  if (price === null) return null;
  return renderPriceAugment(price);
}

const __exports = { extractLastClose, render차트 };
if (__isCjs) {
  module.exports = __exports;
} else {
  window.AthenaLib.CardKinds.register('차트', render차트);
}

})();
