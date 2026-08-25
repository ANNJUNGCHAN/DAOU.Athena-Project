// IIFE 스코프 격리(2026-08-18 렌더러 격리) — <script> 태그는 top-level const/function을
// 문서 전체가 공유하는 하나의 스크립트 스코프에 넣는다(require()의 모듈별 격리와 다르다).
// el/sanitize 같은 흔한 이름이 파일 간에 충돌해 SyntaxError가 났다(실측, diag-isolation.js).
// CJS(require)는 이 IIFE 밖에서도 동일하게 동작한다 — Node의 모듈 래퍼가 이미 함수 스코프다.
(function () {
'use strict';


const INDICATOR_DEFS = [
  // ---- 3.1·3.2 상단 지표(가격 오버레이) 12종 ----
  {
    id: 'ma',
    label: '이평선',
    section: 'overlay',
    implemented: true,
    defaultOn: true,
    params: [{ key: 'periods', label: '기간(콤마)', default: [5, 10, 20, 60, 120] }],
  },
  {
    id: 'boll',
    label: '볼린저',
    section: 'overlay',
    implemented: true,
    defaultOn: false,
    params: [
      { key: 'period', label: '기간', default: 20 },
      { key: 'mult', label: '승수(σ)', default: 2, step: 0.1 },
    ],
  },
  { id: 'ichimoku', label: '일목균형표', section: 'overlay', implemented: false },
  { id: 'ichimokuCloud', label: '일목 구름', section: 'overlay', implemented: false },
  { id: 'sar', label: 'Parabolic SAR', section: 'overlay', implemented: false },
  { id: 'ema', label: '지수이평선', section: 'overlay', implemented: false },
  { id: 'envelope', label: '엔벨로프', section: 'overlay', implemented: false },
  { id: 'priceChannel', label: '프라이스채널', section: 'overlay', implemented: false },
  { id: 'supertrend', label: '슈퍼트렌드', section: 'overlay', implemented: false },
  { id: 'vwap', label: 'VWAP', section: 'overlay', implemented: false },
  { id: 'vwapAnchor', label: '고정 VWAP', section: 'overlay', implemented: false },
  { id: 'fractal', label: '윌리엄스 프랙탈', section: 'overlay', implemented: false },

  // ---- 3.1·3.3 하단 지표(별도 패널) 23종 ----
  {
    id: 'volMa',
    label: '거래량MA',
    section: 'pane',
    implemented: true,
    defaultOn: true,
    params: [{ key: 'periods', label: '기간(콤마)', default: [5, 20, 60, 120] }],
  },
  {
    id: 'rsi',
    label: 'RSI',
    section: 'pane',
    implemented: true,
    defaultOn: false,
    params: [{ key: 'period', label: '기간', default: 14 }],
  },
  {
    id: 'macd',
    label: 'MACD',
    section: 'pane',
    implemented: true,
    defaultOn: false,
    params: [
      { key: 'shortP', label: '단기', default: 12 },
      { key: 'longP', label: '장기', default: 26 },
      { key: 'signalP', label: '시그널', default: 9 },
    ],
  },
  { id: 'stochSlow', label: '스토캐스틱 Slow', section: 'pane', implemented: false },
  { id: 'cci', label: 'CCI', section: 'pane', implemented: false },
  { id: 'williamsR', label: 'Williams %R', section: 'pane', implemented: false },
  { id: 'dmiAdx', label: 'DMI/ADX', section: 'pane', implemented: false },
  { id: 'obv', label: 'OBV', section: 'pane', implemented: false },
  { id: 'atr', label: 'ATR', section: 'pane', implemented: false },
  { id: 'bollB', label: '볼린저 %B', section: 'pane', implemented: false },
  { id: 'bollWidth', label: '볼린저 밴드폭', section: 'pane', implemented: false },
  { id: 'stochRsi', label: '스토캐스틱 RSI', section: 'pane', implemented: false },
  { id: 'disparity', label: '이격도', section: 'pane', implemented: false },
  { id: 'momentum', label: '모멘텀', section: 'pane', implemented: false },
  { id: 'roc', label: 'ROC', section: 'pane', implemented: false },
  { id: 'trix', label: '트릭스', section: 'pane', implemented: false },
  { id: 'priceOsc', label: '프라이스 오실레이터', section: 'pane', implemented: false },
  { id: 'massIndex', label: '매스 인덱스', section: 'pane', implemented: false },
  { id: 'volOsc', label: '볼륨 오실레이터', section: 'pane', implemented: false },
  { id: 'adLine', label: 'AD 라인', section: 'pane', implemented: false },
  { id: 'chaikinOsc', label: '체이킨 오실레이터', section: 'pane', implemented: false },
  { id: 'mfi', label: 'MFI', section: 'pane', implemented: false },
  { id: 'intradayIntensity', label: '일중 강도', section: 'pane', implemented: false },
];

const DEFAULT_INDICATOR_VISIBLE = INDICATOR_DEFS.filter((d) => d.defaultOn).map((d) => d.id);

function defaultParamsFor(id) {
  const def = INDICATOR_DEFS.find((d) => d.id === id);
  if (!def || !def.params) return {};
  const out = {};
  for (const p of def.params) out[p.key] = Array.isArray(p.default) ? p.default.slice() : p.default;
  return out;
}

// UMD 각주(2026-08-18 렌더러 격리) — sanitize.js와 같은 패턴.
const __exports = { INDICATOR_DEFS, DEFAULT_INDICATOR_VISIBLE, defaultParamsFor };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.ChartIndicatorRegistry = __exports;
}

})();
