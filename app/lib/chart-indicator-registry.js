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
  {
    id: 'ichimoku',
    label: '일목균형표',
    section: 'overlay',
    implemented: true,
    defaultOn: false,
    params: [
      { key: 'tenkan', label: '전환', default: 9 },
      { key: 'kijun', label: '기준', default: 26 },
      { key: 'senkouB', label: '선행2', default: 52 },
    ],
  },
  { id: 'ichimokuCloud', label: '일목 구름', section: 'overlay', implemented: false },
  {
    id: 'sar',
    label: '파라볼릭 SAR',
    section: 'overlay',
    implemented: true,
    defaultOn: false,
    params: [
      { key: 'step', label: '가속', default: 0.02, step: 0.01 },
      { key: 'max', label: '최대', default: 0.2, step: 0.01 },
    ],
  },
  {
    id: 'ema',
    label: '지수이평선',
    section: 'overlay',
    implemented: true,
    defaultOn: false,
    params: [{ key: 'periods', label: '기간(콤마)', default: [12, 26] }],
  },
  {
    id: 'envelope',
    label: '엔벨로프',
    section: 'overlay',
    implemented: true,
    defaultOn: false,
    params: [
      { key: 'period', label: '기간', default: 20 },
      { key: 'pct', label: '이격(%)', default: 6, step: 0.5 },
    ],
  },
  {
    id: 'priceChannel',
    label: '프라이스채널',
    section: 'overlay',
    implemented: true,
    defaultOn: false,
    params: [{ key: 'period', label: '기간', default: 20 }],
  },
  {
    id: 'supertrend',
    label: '슈퍼트렌드',
    section: 'overlay',
    implemented: true,
    defaultOn: false,
    params: [
      { key: 'period', label: 'ATR 기간', default: 10 },
      { key: 'mult', label: '승수', default: 3, step: 0.1 },
    ],
  },
  { id: 'vwap', label: 'VWAP', section: 'overlay', implemented: true, defaultOn: false, params: [] },
  // 고정 VWAP는 계산기(vwap의 anchorIndexes)는 있으나 **앵커를 고르는 UI**가 없다.
  // 앵커 없이 켜면 일반 VWAP와 같은 선이 나와 두 항목이 구분되지 않는다 — 그래서
  // 계산이 아니라 상호작용이 빠진 항목으로 남긴다(2026-08-25).
  { id: 'vwapAnchor', label: '고정 VWAP', section: 'overlay', implemented: false },
  { id: 'fractal', label: '윌리엄스 프랙탈', section: 'overlay', implemented: true, defaultOn: false, params: [] },

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
    params: [{ key: 'period', label: '기간', default: 14 }, { key: 'guides', label: '기준선', default: true } ],
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
  {
    id: 'stochSlow',
    label: '스토캐스틱',
    section: 'pane',
    implemented: true,
    params: [
      { key: 'period', label: '기간', default: 14 },
      { key: 'kSmooth', label: '%K 평활', default: 3 },
      { key: 'dSmooth', label: '%D 평활', default: 3 }, { key: 'guides', label: '기준선', default: true } ],
  },
  { id: 'cci', label: 'CCI', section: 'pane', implemented: true, params: [{ key: 'period', label: '기간', default: 20 }, { key: 'guides', label: '기준선', default: true } ] },
  { id: 'williamsR', label: 'Williams %R', section: 'pane', implemented: true, params: [{ key: 'period', label: '기간', default: 14 }, { key: 'guides', label: '기준선', default: true } ] },
  { id: 'dmiAdx', label: 'DMI/ADX', section: 'pane', implemented: true, params: [{ key: 'period', label: '기간', default: 14 }, { key: 'guides', label: '기준선', default: true } ] },
  { id: 'obv', label: 'OBV', section: 'pane', implemented: true, params: [] },
  { id: 'atr', label: 'ATR', section: 'pane', implemented: true, params: [{ key: 'period', label: '기간', default: 14 }] },
  {
    id: 'bollB',
    label: '볼린저 %B',
    section: 'pane',
    implemented: true,
    params: [
      { key: 'period', label: '기간', default: 20 },
      { key: 'mult', label: '승수(σ)', default: 2, step: 0.1 }, { key: 'guides', label: '기준선', default: true } ],
  },
  {
    id: 'bollWidth',
    label: '볼린저 밴드폭',
    section: 'pane',
    implemented: true,
    params: [
      { key: 'period', label: '기간', default: 20 },
      { key: 'mult', label: '승수(σ)', default: 2, step: 0.1 },
    ],
  },
  {
    id: 'stochRsi',
    label: '스토캐스틱 RSI',
    section: 'pane',
    implemented: true,
    params: [
      { key: 'rsiP', label: 'RSI 기간', default: 14 },
      { key: 'stochP', label: '스토캐스틱 기간', default: 14 }, { key: 'guides', label: '기준선', default: true } ],
  },
  { id: 'disparity', label: '이격도', section: 'pane', implemented: true, params: [{ key: 'period', label: '기간', default: 20 }, { key: 'guides', label: '기준선', default: true } ] },
  { id: 'momentum', label: '모멘텀', section: 'pane', implemented: true, params: [{ key: 'period', label: '기간', default: 10 }, { key: 'guides', label: '기준선', default: true } ] },
  { id: 'roc', label: 'ROC', section: 'pane', implemented: true, params: [{ key: 'period', label: '기간', default: 12 }, { key: 'guides', label: '기준선', default: true } ] },
  { id: 'trix', label: '트릭스', section: 'pane', implemented: true, params: [{ key: 'period', label: '기간', default: 12 }, { key: 'guides', label: '기준선', default: true } ] },
  {
    id: 'priceOsc',
    label: '프라이스 오실레이터',
    section: 'pane',
    implemented: true,
    params: [
      { key: 'shortP', label: '단기', default: 10 },
      { key: 'longP', label: '장기', default: 20 }, { key: 'guides', label: '기준선', default: true } ],
  },
  {
    id: 'massIndex',
    label: '매스 인덱스',
    section: 'pane',
    implemented: true,
    params: [
      { key: 'emaP', label: 'EMA 기간', default: 9 },
      { key: 'sumP', label: '합계 기간', default: 25 }, { key: 'guides', label: '기준선', default: true } ],
  },
  {
    id: 'volOsc',
    label: '볼륨 오실레이터',
    section: 'pane',
    implemented: true,
    params: [
      { key: 'shortP', label: '단기', default: 5 },
      { key: 'longP', label: '장기', default: 20 }, { key: 'guides', label: '기준선', default: true } ],
  },
  { id: 'adLine', label: 'AD 라인', section: 'pane', implemented: true, params: [] },
  {
    id: 'chaikinOsc',
    label: '체이킨 오실레이터',
    section: 'pane',
    implemented: true,
    params: [
      { key: 'shortP', label: '단기', default: 3 },
      { key: 'longP', label: '장기', default: 10 }, { key: 'guides', label: '기준선', default: true } ],
  },
  { id: 'mfi', label: 'MFI', section: 'pane', implemented: true, params: [{ key: 'period', label: '기간', default: 14 }, { key: 'guides', label: '기준선', default: true } ] },
  { id: 'intradayIntensity', label: '일중 강도 지수', section: 'pane', implemented: true, params: [{ key: 'period', label: '기간', default: 21 }, { key: 'guides', label: '기준선', default: true } ] },
  // 2026-08-25 추가 — 토스 WTS 목록에만 있던 항목(Playwright 실측).
  { id: 'rmi', label: 'RMI', section: 'pane', implemented: true, params: [
    { key: 'period', label: '기간', default: 14 },
    { key: 'momentumP', label: '모멘텀', default: 5 }, { key: 'guides', label: '기준선', default: true } ] },

  // ---- 수급 지표(외부 TR) 7종 ----
  // 위 34종은 전부 로드된 봉에서 계산한다(compute(bars, params)). 아래는 다르다 —
  // 별도 TR을 조회해 받은 시계열을 그대로 그린다. 토스증권이 캔들차트 하단 지표로
  // 노출하는 항목과 1:1로 맞췄다(2026-08-25 실측).
  //
  // fieldAlias는 **반드시 명시한다.** 자동 선택을 두지 않는 이유: 계약의
  // column_priority 첫 열이 ka10060은 cur_prc(현재가), ka10014는 pred_pre(전일대비)라
  // 자동으로 고르면 수급이 아닌 값을 그린다(실측).
  //
  // trArgs는 그 TR의 input.field_allowlist가 요구하는 고정 인자다(실측):
  //   ka10014: stk_cd, tm_tp, strt_dt, end_dt
  //   ka10060: dt, stk_cd, amt_qty_tp, trde_tp, unit_tp
  //   ka10064: mrkt_tp, amt_qty_tp, trde_tp, stk_cd
  //   ka10068: strt_dt, end_dt, all_tp
  // 종목코드·날짜처럼 화면이 아는 값은 chart-card가 채운다.
  //
  // allowedPeriods: 대상 TR은 allowed_periods가 []라 주기 변종이 없다. dt 축은
  // 일봉에서만, tm 축은 분·틱에서만 의미가 선다(계획서 "명시적 범위 축소 1").
  {
    id: 'shortSaleQty', label: '일별 공매도량', section: 'pane', implemented: true,
    source: 'tr', operationRef: 'base:ka10014', fieldAlias: 'shrts_qty',
    allowedPeriods: ['D'], trArgs: { tm_tp: '1' }, params: [],
  },
  {
    id: 'netBuyIndiv', label: '일별 개인 순매수', section: 'pane', implemented: true,
    source: 'tr', operationRef: 'base:ka10060', fieldAlias: 'ind_invsr',
    allowedPeriods: ['D'], trArgs: { amt_qty_tp: '1', trde_tp: '0', unit_tp: '1000' }, params: [],
  },
  {
    id: 'netBuyOrgn', label: '일별 기관 순매수', section: 'pane', implemented: true,
    source: 'tr', operationRef: 'base:ka10060', fieldAlias: 'orgn',
    allowedPeriods: ['D'], trArgs: { amt_qty_tp: '1', trde_tp: '0', unit_tp: '1000' }, params: [],
  },
  {
    id: 'netBuyFrgn', label: '일별 외국인 순매수', section: 'pane', implemented: true,
    source: 'tr', operationRef: 'base:ka10060', fieldAlias: 'frgnr_invsr',
    allowedPeriods: ['D'], trArgs: { amt_qty_tp: '1', trde_tp: '0', unit_tp: '1000' }, params: [],
  },
  {
    id: 'intradayOrgn', label: '장중 기관 매매', section: 'pane', implemented: true,
    source: 'tr', operationRef: 'base:ka10064', fieldAlias: 'orgn',
    allowedPeriods: ['MIN', 'TICK'],
    trArgs: { mrkt_tp: '000', amt_qty_tp: '1', trde_tp: '0' }, params: [],
  },
  {
    id: 'intradayFrgn', label: '장중 외국인 매매', section: 'pane', implemented: true,
    source: 'tr', operationRef: 'base:ka10064', fieldAlias: 'frgnr_invsr',
    allowedPeriods: ['MIN', 'TICK'],
    trArgs: { mrkt_tp: '000', amt_qty_tp: '1', trde_tp: '0' }, params: [],
  },
  {
    // rmnd(잔고주수)다 — remn_amt(잔고금액)가 아니다. 스펙이 "대차잔고 수량"이라 했다.
    id: 'loanBalance', label: '일별 대차잔고', section: 'pane', implemented: true,
    source: 'tr', operationRef: 'base:ka10068', fieldAlias: 'rmnd',
    allowedPeriods: ['D'], trArgs: { all_tp: '1' }, params: [],
  },
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
