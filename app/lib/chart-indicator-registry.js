'use strict';

// 보조지표 35종 전수 레지스트리 — plan/chart-card-control-spec.md §3.1~3.3 순서 그대로.
// section: 'overlay'(상단 지표, 가격 pane 오버레이) | 'pane'(하단 지표, 별도 패널).
// implemented: 1판 계산 구현 여부. true 5종(ma·boll·volMa·rsi·macd) 외 30종은
// 토글 비활성 + "미구현" 배지로 노출한다 — 숨기지 않는다(정보 정직성, CLAUDE.md §4).
// params가 있는 항목만 우측 설정 패널에 입력 필드가 뜬다(구현 5종 전부 params 보유).

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

module.exports = { INDICATOR_DEFS, DEFAULT_INDICATOR_VISIBLE, defaultParamsFor };
