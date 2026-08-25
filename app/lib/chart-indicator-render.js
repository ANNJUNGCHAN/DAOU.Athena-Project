// IIFE 스코프 격리(2026-08-18 렌더러 격리) — chart-indicators.js와 같은 패턴.
(function () {
'use strict';

const __dep = (path, globalKey) => {
  if (typeof module !== 'undefined' && module.exports) return require(path);
  return (window.AthenaLib || {})[globalKey];
};
const IND = __dep('./chart-indicators', 'ChartIndicators');

// ---------------------------------------------------------------------------
// 지표 렌더 스펙 — 2026-08-25.
//
// 왜 이 파일이 생겼나: chart-card.js가 지표마다 전역 변수(rsiLine, macdLine,
// macdSignalLine, macdHistSeries …)와 pane 인덱스를 손으로 관리하고 있었다.
// 그 방식으로 34종을 붙이면 같은 배선이 34벌 생기고, 이미 한 번 겪은
// "pane 0이 비면 거래량 pane이 0으로 당겨지는" 버그의 표면이 그만큼 넓어진다.
//
// 계약: 지표 하나 = 스펙 한 줄. 새 지표를 추가할 때 chart-card.js는 건드리지
// 않는다. 스펙은 "무엇을 계산하고(compute) 몇 개의 선으로 그리는가(lines)"만
// 말하고, 시리즈 생성·제거·pane 배정은 아래 createIndicatorRenderer가 한다.
//
// compute(bars, params) → { [키]: (number|null)[] }  — 길이는 bars.length.
//   * 일목균형표의 선행선처럼 bars보다 긴 배열을 돌려주면 초과분은 버린다
//     (미래 시각을 만들 수 없다 — 시간축은 bars가 소유한다).
// lines: [{ key, color, width?, style? }] — compute 결과의 키와 1:1.
// pane: 'price'(0) | 'volume'(1) | 'own'(전용 pane)
// guides: [{ value, title }] — 전용 pane의 기준선(RSI 70/30 같은 것).
// histogram: true면 첫 line을 히스토그램으로 그린다(MACD).
// ---------------------------------------------------------------------------

// 무채색 팔레트 — soul.md "유리는 끝까지 무채색". 지표 선은 신호색을 쓰지 않는다.
const L1 = '#E7E9F2';
const L2 = '#C3C8DC';
const L3 = '#9AA0BF';
const L4 = '#6F76A0';
const L5 = '#4A5080';
const BAND = 'rgba(154,160,191,0.55)';
const GUIDE = 'rgba(154,160,191,0.4)';

// 전용 pane의 최소 가독 높이. 이보다 얇으면 선이 뭉개져 정보가 아니라 장식이
// 된다 — 그 지점에서 지표를 켜는 대신 거부한다(2026-08-25 프로브 실측 대응).
//
// 44 → 80(2026-08-25 실기동 재실측). 44px는 "거부하지 않는 최소값"이었지 읽히는
// 높이가 아니었다 — 스토캐스틱·CCI를 켠 화면에서 진폭이 납작해져 교차를 못 읽었다.
// setStretchFactor가 없는 구버전 폴백에서만 쓰는 고정 높이다.
const MIN_OWN_PANE = 80;
// 가격 pane이 확보해야 하는 최소 높이. 지표를 아무리 켜도 캔들이 먼저다.
const MIN_PRICE_PANE = 120;

// pane 몫(비율). 가격이 가장 크고, 거래량과 전용 지표는 같은 몫을 나눠 갖는다.
// 지표를 켤수록 가격 pane도 함께 줄지만 항상 가장 큰 몫을 유지한다 —
// 캔들이 먼저다(TradingView 기본 배치와 같은 감각).
const PRICE_STRETCH = 10;
const VOLUME_STRETCH = 1.5;
const OWN_STRETCH = 1.5;

const closesOf = (bars) => bars.map((b) => Number(b.close));
const volumesOf = (bars) => bars.map((b) => Number(b.volume));

// 다중 기간(이평선류) — 기간 배열을 받아 선 n개를 만든다.
function multiPeriodSpec(id, pane, valuesOf, colors) {
  return {
    id,
    pane,
    dynamicLines: (params) => (params.periods || []).map((p, i) => ({
      key: `p${p}`,
      color: colors[i % colors.length],
      label: `${id === 'volMa' ? 'VMA' : id === 'ema' ? 'EMA' : 'MA'}${p}`,
    })),
    compute: (bars, params) => {
      const src = valuesOf(bars);
      const out = {};
      for (const p of params.periods || []) {
        out[`p${p}`] = id === 'ema' ? IND.ema(src, p) : IND.sma(src, p);
      }
      return out;
    },
  };
}

const SPECS = [
  // ---- 가격 pane 오버레이 ----
  multiPeriodSpec('ma', 'price', closesOf, [L1, L2, L3, L4, L5]),
  multiPeriodSpec('ema', 'price', closesOf, [L2, L4]),
  {
    id: 'boll', pane: 'price',
    lines: [{ key: 'upper', color: BAND }, { key: 'middle', color: 'rgba(154,160,191,0.9)' }, { key: 'lower', color: BAND }],
    compute: (bars, p) => IND.bollinger(closesOf(bars), p.period, p.mult),
  },
  {
    id: 'envelope', pane: 'price',
    lines: [{ key: 'upper', color: BAND }, { key: 'middle', color: L3 }, { key: 'lower', color: BAND }],
    compute: (bars, p) => IND.envelope(closesOf(bars), p.period, p.pct),
  },
  {
    id: 'priceChannel', pane: 'price',
    lines: [{ key: 'upper', color: BAND }, { key: 'lower', color: BAND }],
    compute: (bars, p) => IND.priceChannel(bars, p.period),
  },
  {
    id: 'vwap', pane: 'price',
    lines: [{ key: 'vwap', color: L2, label: 'VWAP' }],
    compute: (bars) => ({ vwap: IND.vwap(bars) }),
  },
  {
    id: 'supertrend', pane: 'price',
    lines: [{ key: 'line', color: L1, label: 'ST' }],
    compute: (bars, p) => ({ line: IND.supertrend(bars, p.period, p.mult).line }),
  },
  {
    id: 'sar', pane: 'price',
    // SAR는 점으로 읽히는 지표다 — 선을 잇지 않고 점만 찍는다.
    lines: [{ key: 'sar', color: L2, label: 'SAR', dots: true }],
    compute: (bars, p) => ({ sar: IND.parabolicSar(bars, p.step, p.max) }),
  },
  {
    id: 'ichimoku', pane: 'price',
    lines: [
      { key: 'tenkan', color: L1, label: '전환' },
      { key: 'kijun', color: L3, label: '기준' },
      { key: 'senkouA', color: BAND, label: '선행1' },
      { key: 'senkouB', color: BAND, label: '선행2' },
      { key: 'chikou', color: L5, label: '후행' },
    ],
    compute: (bars, p) => IND.ichimoku(bars, p.tenkan, p.kijun, p.senkouB),
  },
  {
    id: 'fractal', pane: 'price',
    lines: [{ key: 'up', color: L1, label: '프랙탈', dots: true }],
    // 프랙탈은 bool[] — 표시할 자리에만 그 봉의 고가/저가를 값으로 넣는다.
    compute: (bars) => {
      const f = IND.williamsFractal(bars);
      return { up: f.up.map((on, i) => (on ? bars[i].high : (f.down[i] ? bars[i].low : null))) };
    },
  },

  // ---- 거래량 pane 오버레이 ----
  multiPeriodSpec('volMa', 'volume', volumesOf, [L1, L2, L3, L4]),

  // ---- 전용 pane ----
  {
    id: 'rsi', pane: 'own', decimal: true,
    lines: [{ key: 'rsi', color: L2, label: 'RSI' }],
    guides: [{ value: 70, title: '70' }, { value: 30, title: '30' }],
    compute: (bars, p) => ({ rsi: IND.rsi(closesOf(bars), p.period) }),
  },
  {
    id: 'macd', pane: 'own', decimal: true, histogram: 'histogram',
    lines: [{ key: 'macd', color: L2, label: 'MACD' }, { key: 'signal', color: L4, label: 'Signal' }],
    compute: (bars, p) => IND.macd(closesOf(bars), p.shortP, p.longP, p.signalP),
  },
  {
    id: 'stochSlow', pane: 'own', decimal: true,
    lines: [{ key: 'k', color: L2, label: '%K' }, { key: 'd', color: L4, label: '%D' }],
    guides: [{ value: 80, title: '80' }, { value: 20, title: '20' }],
    compute: (bars, p) => IND.stochastic(bars, p.period, p.kSmooth, p.dSmooth),
  },
  {
    id: 'stochRsi', pane: 'own', decimal: true,
    lines: [{ key: 'k', color: L2, label: '%K' }, { key: 'd', color: L4, label: '%D' }],
    guides: [{ value: 80, title: '80' }, { value: 20, title: '20' }],
    compute: (bars, p) => IND.stochRsi(closesOf(bars), p.rsiP, p.stochP),
  },
  {
    id: 'dmiAdx', pane: 'own', decimal: true,
    lines: [{ key: 'plusDi', color: L1, label: '+DI' }, { key: 'minusDi', color: L4, label: '-DI' }, { key: 'adx', color: L2, label: 'ADX' }],
    guides: [{ value: 25, title: '25' }],
    compute: (bars, p) => IND.dmiAdx(bars, p.period),
  },
  {
    id: 'cci', pane: 'own', decimal: true,
    lines: [{ key: 'cci', color: L2, label: 'CCI' }],
    guides: [{ value: 100, title: '100' }, { value: -100, title: '-100' }],
    compute: (bars, p) => ({ cci: IND.cci(bars, p.period) }),
  },
  {
    id: 'williamsR', pane: 'own', decimal: true,
    lines: [{ key: 'wr', color: L2, label: '%R' }],
    guides: [{ value: -20, title: '-20' }, { value: -80, title: '-80' }],
    compute: (bars, p) => ({ wr: IND.williamsR(bars, p.period) }),
  },
  {
    id: 'mfi', pane: 'own', decimal: true,
    lines: [{ key: 'mfi', color: L2, label: 'MFI' }],
    guides: [{ value: 80, title: '80' }, { value: 20, title: '20' }],
    compute: (bars, p) => ({ mfi: IND.mfi(bars, p.period) }),
  },
  {
    id: 'rmi', pane: 'own', decimal: true,
    lines: [{ key: 'rmi', color: L2, label: 'RMI' }],
    guides: [{ value: 70, title: '70' }, { value: 30, title: '30' }],
    compute: (bars, p) => ({ rmi: IND.rmi(closesOf(bars), p.period, p.momentumP) }),
  },
  {
    id: 'bollB', pane: 'own', decimal: true,
    lines: [{ key: 'b', color: L2, label: '%B' }],
    guides: [{ value: 1, title: '1' }, { value: 0, title: '0' }],
    compute: (bars, p) => ({ b: IND.bollingerPercentB(closesOf(bars), p.period, p.mult) }),
  },
  {
    id: 'bollWidth', pane: 'own', decimal: true,
    lines: [{ key: 'w', color: L2, label: '밴드폭' }],
    compute: (bars, p) => ({ w: IND.bollingerBandwidth(closesOf(bars), p.period, p.mult) }),
  },
  {
    id: 'atr', pane: 'own', decimal: true,
    lines: [{ key: 'atr', color: L2, label: 'ATR' }],
    compute: (bars, p) => ({ atr: IND.atr(bars, p.period) }),
  },
  {
    id: 'obv', pane: 'own',
    lines: [{ key: 'obv', color: L2, label: 'OBV' }],
    compute: (bars) => ({ obv: IND.obv(bars) }),
  },
  {
    id: 'adLine', pane: 'own',
    lines: [{ key: 'ad', color: L2, label: 'A/D' }],
    compute: (bars) => ({ ad: IND.adLine(bars) }),
  },
  {
    id: 'chaikinOsc', pane: 'own', decimal: true,
    lines: [{ key: 'co', color: L2, label: '체이킨' }],
    guides: [{ value: 0, title: '0' }],
    compute: (bars, p) => ({ co: IND.chaikinOsc(bars, p.shortP, p.longP) }),
  },
  {
    id: 'intradayIntensity', pane: 'own', decimal: true,
    lines: [{ key: 'ii', color: L2, label: '일중강도' }],
    guides: [{ value: 0, title: '0' }],
    compute: (bars, p) => ({ ii: IND.intradayIntensity(bars, p.period) }),
  },
  {
    id: 'momentum', pane: 'own', decimal: true,
    lines: [{ key: 'm', color: L2, label: '모멘텀' }],
    guides: [{ value: 0, title: '0' }],
    compute: (bars, p) => ({ m: IND.momentum(closesOf(bars), p.period) }),
  },
  {
    id: 'roc', pane: 'own', decimal: true,
    lines: [{ key: 'roc', color: L2, label: 'ROC' }],
    guides: [{ value: 0, title: '0' }],
    compute: (bars, p) => ({ roc: IND.roc(closesOf(bars), p.period) }),
  },
  {
    id: 'disparity', pane: 'own', decimal: true,
    lines: [{ key: 'd', color: L2, label: '이격도' }],
    guides: [{ value: 100, title: '100' }],
    compute: (bars, p) => ({ d: IND.disparity(closesOf(bars), p.period) }),
  },
  {
    id: 'trix', pane: 'own', decimal: true,
    lines: [{ key: 't', color: L2, label: 'TRIX' }],
    guides: [{ value: 0, title: '0' }],
    compute: (bars, p) => ({ t: IND.trix(closesOf(bars), p.period) }),
  },
  {
    id: 'priceOsc', pane: 'own', decimal: true,
    lines: [{ key: 'po', color: L2, label: 'PO' }],
    guides: [{ value: 0, title: '0' }],
    compute: (bars, p) => ({ po: IND.priceOsc(closesOf(bars), p.shortP, p.longP) }),
  },
  {
    id: 'volOsc', pane: 'own', decimal: true,
    lines: [{ key: 'vo', color: L2, label: 'VO' }],
    guides: [{ value: 0, title: '0' }],
    compute: (bars, p) => ({ vo: IND.volumeOsc(bars, p.shortP, p.longP) }),
  },
  {
    id: 'massIndex', pane: 'own', decimal: true,
    lines: [{ key: 'mi', color: L2, label: '매스' }],
    guides: [{ value: 27, title: '27' }],
    compute: (bars, p) => ({ mi: IND.massIndex(bars, p.emaP, p.sumP) }),
  },

  // ---- 외부 시계열(수급 TR) ----
  // compute가 없다. 이들은 봉에서 파생되지 않고 별도 TR 조회 결과를 그대로 그린다.
  // setExternalSeries로 주입받은 {time,value}를 HistogramSeries에 직접 넣는다 —
  // bars 인덱스에 맞춰 zip하는 toLineData 경로를 타지 않는다(자기 시각을 갖는다).
  { id: 'shortSaleQty', pane: 'own', external: true, decimal: false, label: '공매도량' },
  { id: 'netBuyIndiv', pane: 'own', external: true, decimal: false, label: '개인 순매수' },
  { id: 'netBuyOrgn', pane: 'own', external: true, decimal: false, label: '기관 순매수' },
  { id: 'netBuyFrgn', pane: 'own', external: true, decimal: false, label: '외국인 순매수' },
  { id: 'intradayOrgn', pane: 'own', external: true, decimal: false, label: '장중 기관' },
  { id: 'intradayFrgn', pane: 'own', external: true, decimal: false, label: '장중 외국인' },
  { id: 'loanBalance', pane: 'own', external: true, decimal: false, label: '대차잔고' },
];

const SPEC_BY_ID = new Map(SPECS.map((s) => [s.id, s]));

// 스펙이 요구하는 선 목록 — 동적(기간 배열)이면 params로 펼친다.
function linesOf(spec, params) {
  return spec.dynamicLines ? spec.dynamicLines(params || {}) : spec.lines;
}

// 지표 배열 → lightweight-charts 데이터. null은 버리고, bars보다 긴 초과분도 버린다.
function toLineData(times, values) {
  const out = [];
  const n = Math.min(times.length, values ? values.length : 0);
  for (let i = 0; i < n; i += 1) {
    if (values[i] == null || !Number.isFinite(Number(values[i]))) continue;
    out.push({ time: times[i], value: Number(values[i]) });
  }
  return out;
}

/**
 * 레지스트리 주도 지표 렌더러.
 *
 * deps: { chart, LineSeries, HistogramSeries, LineStyle, priceFormat, decimalFormat,
 *         volumePaneIndex, ownPaneHeight, upColor, downColor, withAlpha }
 *
 * 반환 { apply(visible, params, bars), setData(bars, params, visible), legendFor(id, params), destroy() }
 */
function createIndicatorRenderer(deps) {
  const {
    chart, LineSeries, HistogramSeries, LineStyle,
    priceFormat, decimalFormat,
    volumePaneIndex = 1, ownPaneHeight = 90, volumeHeight = 80,
    // 켠 pane 전부를 담는 데 필요한 높이를 호출자에게 알린다(카드가 그만큼 자란다).
    // 종전의 getAvailableHeight(가용 높이를 물어 개수를 깎던 것)를 대체한다.
    requestHeight,
    upColor, downColor, withAlpha,
  } = deps;

  // id → { seriesByKey: Map, hist: series|null, paneIndex }
  const mounted = new Map();
  let lastSkipped = [];
  // 외부 TR에서 받아온 시계열. id → [{time, value}] 또는 null(조회 실패·없음).
  // 값이 없으면 pane을 만들지 않는다 — 빈 pane은 "켜졌는데 안 보인다"가 된다(§8).
  const externalById = new Map();

  // 조회 결과 주입. null을 주면 그 지표는 다음 apply에서 pane을 잃는다.
  function setExternalSeries(id, points) {
    if (Array.isArray(points) && points.length) externalById.set(id, points.slice());
    else externalById.delete(id);
  }

  function removeAll() {
    for (const entry of mounted.values()) {
      for (const s of entry.seriesByKey.values()) chart.removeSeries(s);
      if (entry.hist) chart.removeSeries(entry.hist);
    }
    mounted.clear();
  }

  function baseOpts(spec) {
    return {
      lineWidth: 1,
      priceFormat: spec.decimal ? decimalFormat : priceFormat,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    };
  }

  /**
   * 켜진 지표 집합에 맞춰 시리즈를 통째로 재생성한다.
   *
   * 왜 diff가 아니라 전체 재생성인가: 전용 pane 지표는 켜고 끌 때마다 pane
   * 인덱스가 바뀐다. 부분 갱신을 하면 남은 시리즈의 paneIndex가 어긋나
   * (이미 겪은) pane 당김 버그가 난다. 순서는 SPECS 배열 순으로 고정이라
   * 같은 조합이면 항상 같은 pane 배치가 나온다.
   */
  function apply(visible, params, bars) {
    removeAll();
    let nextPane = volumePaneIndex + 1;

    // 전용 pane은 개수를 제한하지 않는다(2026-08-25 토스 실측 대응).
    //
    // 종전엔 카드 높이를 고정으로 두고 남는 높이를 나눠 쓰다가, 최소 가독 높이에
    // 못 미치면 그 지표를 skipped로 거부했다. 토스증권(TradingView Charting
    // Library)을 직접 열어 지표 45종을 전수 확인한 결과 **disabled가 0건**이었다 —
    // 개수 제한이라는 개념 자체가 없고, 지표를 켜면 차트가 세로로 자란다.
    //
    // 그래서 여기서는 pane 높이를 고정값으로만 정하고, 그 합을 담을 높이를
    // 확보하는 일은 호출자(chart-card.js onHeightRequest)가 맡는다. 높이가
    // 모자라 못 그리는 경우가 사라지므로 skipped는 항상 빈 배열이다.
    const wantOwn = SPECS.filter((s) => s.pane === 'own' && visible.has(s.id));
    const ownHeight = Math.max(MIN_OWN_PANE, ownPaneHeight);
    const skipped = [];

    for (const spec of SPECS) {
      if (!visible.has(spec.id)) continue;

      // 외부 시계열 — compute도 toLineData도 타지 않는다. 주입분이 없으면
      // pane을 만들지 않고 사유를 남긴다(빈 pane 금지).
      if (spec.external) {
        const points = externalById.get(spec.id);
        if (!Array.isArray(points) || !points.length) {
          skipped.push(spec.id);
          continue;
        }
        const paneIndex = nextPane;
        nextPane += 1;
        const bar = chart.addSeries(
          HistogramSeries,
          { priceFormat: spec.decimal ? decimalFormat : priceFormat, priceLineVisible: false },
          paneIndex
        );
        // 순매수는 부호가 의미다 — 양수·음수를 색으로 가른다(캔들 등락색과 같은 관례).
        bar.setData(points.map((p) => ({
          time: p.time,
          value: Number(p.value),
          color: Number(p.value) >= 0 ? withAlpha(upColor, 0.6) : withAlpha(downColor, 0.6),
        })));
        const entry = { seriesByKey: new Map([['value', bar]]), hist: null, paneIndex, external: true };
        mounted.set(spec.id, entry);
        continue;
      }

      const p = (params && params[spec.id]) || {};
      const paneIndex = spec.pane === 'price' ? 0 : spec.pane === 'volume' ? volumePaneIndex : nextPane;
      if (spec.pane === 'own') nextPane += 1;

      const entry = { seriesByKey: new Map(), hist: null, paneIndex };

      // 히스토그램(MACD)을 먼저 만들어 선 아래에 깔리게 한다.
      if (spec.histogram) {
        entry.hist = chart.addSeries(
          HistogramSeries,
          { priceFormat: spec.decimal ? decimalFormat : priceFormat, lastValueVisible: false },
          paneIndex
        );
      }

      const lines = linesOf(spec, p) || [];
      for (const line of lines) {
        const opts = Object.assign(baseOpts(spec), { color: line.color });
        // 거래량 pane 오버레이는 거래량과 같은 스케일을 써야 한다(priceScaleId:'').
        if (spec.pane === 'volume') opts.priceScaleId = '';
        if (line.dots) { opts.lineVisible = false; opts.pointMarkersVisible = true; opts.pointMarkersRadius = 1.5; }
        entry.seriesByKey.set(line.key, chart.addSeries(LineSeries, opts, paneIndex));
      }

      // 기준선 — 첫 시리즈에 붙인다(같은 pane이면 어디 붙어도 같은 자리다).
      const first = entry.seriesByKey.values().next().value;
      // params.guides가 false면 그리지 않는다 — 기본은 켬(토스와 같다).
      if (first && spec.guides && LineStyle && p.guides !== false) {
        for (const g of spec.guides) {
          // 축 라벨을 다시 붙인다(2026-08-25 토스 실측 대응). 잠깐 껐던 이유는
          // 44px pane에서 라벨끼리 겹쳐 숫자가 뭉갰기 때문인데, 그건 pane이 좁아서
          // 생긴 증상이지 라벨이 잘못이 아니었다. 이제 pane이 최소 80px이고 카드가
          // 필요한 만큼 자라므로 겹치지 않는다. 토스도 기준선을 축에 표시하고,
          // 대신 **사용자가 끌 수 있게** 한다 — 그게 params.guides다.
          first.createPriceLine({
            price: g.value, color: GUIDE, lineStyle: LineStyle.Dashed,
            lineWidth: 1, axisLabelVisible: true, title: g.title,
          });
        }
      }
      mounted.set(spec.id, entry);
    }

    // pane 높이는 고정 px이 아니라 **비율**로 나눈다(TradingView/토스 방식).
    //
    // setHeight로 90px씩 고정하면 켠 개수가 늘 때 합이 차트 높이를 넘어 마지막
    // pane들이 잘리거나 눌린다 — 그걸 막으려고 종전엔 개수를 제한했는데, 토스는
    // 제한하지 않는다(2026-08-25 실측: 지표 45종 중 disabled 0건). 비율로 주면
    // 몇 개를 켜든 전부 화면 안에 들어가고, 가격 pane이 항상 가장 큰 몫을 갖는다.
    const panes = chart.panes();
    if (panes[0] && typeof panes[0].setStretchFactor === 'function') {
      panes[0].setStretchFactor(PRICE_STRETCH);
      if (panes[volumePaneIndex]) panes[volumePaneIndex].setStretchFactor(VOLUME_STRETCH);
      for (const entry of mounted.values()) {
        if (entry.paneIndex > volumePaneIndex && panes[entry.paneIndex]) {
          panes[entry.paneIndex].setStretchFactor(OWN_STRETCH);
        }
      }
    } else {
      // setStretchFactor가 없는 판(구버전)에서는 종전대로 고정 높이를 쓴다.
      for (const entry of mounted.values()) {
        if (entry.paneIndex > volumePaneIndex && panes[entry.paneIndex]) {
          panes[entry.paneIndex].setHeight(ownHeight);
        }
      }
      if (panes[volumePaneIndex]) panes[volumePaneIndex].setHeight(volumeHeight);
    }

    setData(bars, params, visible);
    lastSkipped = skipped;
    return { skipped, ownHeight, ownCount: wantOwn.length };
  }

  function setData(bars, params, visible) {
    if (!bars || !bars.length) return;
    const times = bars.map((b) => b.time);
    const norm = bars.map((b) => ({
      time: b.time,
      open: Number(b.open), high: Number(b.high), low: Number(b.low),
      close: Number(b.close), volume: Number(b.volume),
    }));

    for (const [id, entry] of mounted) {
      if (visible && !visible.has(id)) continue;
      // 외부 시계열은 봉이 바뀌어도 다시 계산하지 않는다 — 자기 시각을 갖고 있고
      // 값의 출처가 TR이다. 주기가 바뀌면 chart-card가 캐시를 버리고 다시 주입한다.
      if (entry.external) continue;
      const spec = SPEC_BY_ID.get(id);
      let result;
      try {
        result = spec.compute(norm, (params && params[id]) || {});
      } catch (err) {
        // 한 지표가 죽어도 차트 전체를 깨뜨리지 않는다 — 그 지표만 빈 채로 둔다.
        // 조용히 삼키지는 않는다(§8 정보 정직성).
        if (typeof console !== 'undefined') console.error(`[chart] 지표 계산 실패: ${id}`, err);
        continue;
      }
      for (const [key, series] of entry.seriesByKey) {
        series.setData(toLineData(times, result[key]));
      }
      if (entry.hist && spec.histogram) {
        const h = result[spec.histogram] || [];
        entry.hist.setData(
          times
            .map((t, i) => ({
              time: t,
              value: h[i],
              color: h[i] >= 0 ? withAlpha(upColor, 0.6) : withAlpha(downColor, 0.6),
            }))
            .filter((d) => d.value != null)
        );
      }
    }
  }

  // 범례 칩 — 켜진 가격 pane 지표의 이름·색을 돌려준다(오버레이 범례가 쓴다).
  function legendFor(visible, params) {
    const chips = [];
    for (const spec of SPECS) {
      if (spec.pane !== 'price' || !visible.has(spec.id)) continue;
      for (const line of linesOf(spec, (params && params[spec.id]) || {}) || []) {
        if (line.label) chips.push({ label: line.label, color: line.color });
      }
    }
    return chips;
  }

  return {
    apply, setData, legendFor, setExternalSeries,
    destroy: removeAll, getSkipped: () => lastSkipped.slice(), SPEC_BY_ID,
  };
}

const __exports = { createIndicatorRenderer, SPECS, SPEC_BY_ID, linesOf, toLineData };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.ChartIndicatorRender = __exports;
}

})();
