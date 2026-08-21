// IIFE 스코프 격리(2026-08-18 렌더러 격리) — <script> 태그는 top-level const/function을
// 문서 전체가 공유하는 하나의 스크립트 스코프에 넣는다(require()의 모듈별 격리와 다르다).
// el/sanitize 같은 흔한 이름이 파일 간에 충돌해 SyntaxError가 났다(실측, diag-isolation.js).
// CJS(require)는 이 IIFE 밖에서도 동일하게 동작한다 — Node의 모듈 래퍼가 이미 함수 스코프다.
(function () {
// 차트 카드(CC-101 + CC-102 + CC-103) — CompoundCard(charts) 위 시계열 렌즈의
// 첫 렌더러. 계약: plan/chart-card-control-spec.md(컨트롤 실측) ·
// plan/chart-lens-spec.md §4·§6 (저작 계층, 카드 신설 없음 — 이 파일은
// makeCard('chart', …) 하나를 추가할 뿐 새 카드 종류를 만들지 않는다).
//
// CC-101 범위: 캔들 차트 본체 + 거래량 하위 pane. CC-102가 얹은 것: 툴바(§0 —
// 주기 탭·세분·차트모양·수정주가·전체화면), 주기별 실제 재샘플
// (lib/chart-resample.js), 전체화면(카드가 그리드를 전체 점유 — §7의 OS
// position:fixed 전체화면과 다른 "두 창 원칙" 적응, 아래 toggleFullscreen
// 참고). CC-103이 얹은 것: 보조지표 패널(§3, ∿▾ — lib/chart-indicator-panel.js
// + lib/chart-indicator-registry.js, 35종 전수 노출·5종 계산 구현) · 매물대
// 오버레이(§4, lib/chart-volume-profile.js 계산을 가격 pane 위 DOM 오버레이로
// 렌더). 드로잉(§5)·크로스헤어 수치조회창(§8)은 이 라운드에도 포함하지 않는다.
//
// lightweight-charts 5.2.1은 ESM 전용(exports 필드에 "require" 조건 없음,
// package.json 실측: `"exports": {".": {"...": {"import": "..."}}}`). 이 앱은
// CommonJS(require) 관례를 쓰므로(canvas.js 등) 정적 require로 못 부른다 —
// Node/Electron(nodeIntegration:true) 양쪽에서 CJS 모듈 안의 동적 import()는
// 지원된다(실측: `node -e "(async()=>{await import('lightweight-charts')})()"`
// 정상 동작, Object.keys에 createChart/CandlestickSeries/HistogramSeries 확인됨).
// 그래서 createChartCard는 async 함수다. 다만 첫 REST 차트의 3초 paint budget을
// import cold-start에 쓰지 않도록 이 스크립트가 로드될 때 단 하나의 cached import를
// 시작하고, 모든 createChartCard 호출이 같은 Promise를 기다린다.
//
// 좌하단에 뜨는 작은 로고는 버그가 아니다 — lightweight-charts Apache-2.0 라이선스가
// 요구하는 TradingView attribution(layout.attributionLogo, 기본 true)이다.
// 실측으로 확인(probe-chart-card.js 캡처, elementFromPoint로 캔버스 픽셀임을
// 확인 — DOM 오버레이가 아니다). 대체 표기 없이 끄면 라이선스 위반이라 그대로 둔다.

// UMD 헤드(2026-08-18 렌더러 격리) — node --test(CommonJS)면 require, <script>
// 태그 전역 로딩(nodeIntegration:false)이면 window.AthenaLib를 쓴다. 8개
// 의존 모두 같은 분기라 헬퍼 하나로 묶는다(chart-card.js만 의존이 이만큼 많다).
const __isCjs = typeof module !== 'undefined' && module.exports;
function __dep(reqPath, globalName) {
  return __isCjs ? require(reqPath) : window.AthenaLib[globalName];
}
const { createChartToolbar } = __dep('./chart-toolbar', 'ChartToolbar');
const { resample } = __dep('./chart-resample', 'ChartResample');
const { createIndicatorPanel } = __dep('./chart-indicator-panel', 'ChartIndicatorPanel');
const { DEFAULT_INDICATOR_VISIBLE, defaultParamsFor } = __dep('./chart-indicator-registry', 'ChartIndicatorRegistry');
const { sma, bollinger, rsi, macd } = __dep('./chart-indicators', 'ChartIndicators');
const { volumeProfile } = __dep('./chart-volume-profile', 'ChartVolumeProfile');
const { createAuthoringStore, periodToken } = __dep('./chart-authoring-store', 'ChartAuthoringStore');
const { createDrawingLayer } = __dep('./chart-drawings', 'ChartDrawings');

// lightweight-charts는 5.2.1부터 ESM 전용이라 동적 import()로만 부를 수 있다
// (아래 createChartCard 안 주석 참고). nodeIntegration:true였을 때는 bare
// specifier('lightweight-charts')를 Electron이 Node 해석 규칙으로 풀어줬지만,
// nodeIntegration:false 아래서는 브라우저의 HTML 모듈 해석 규칙만 적용되어
// bare specifier가 안 풀린다(import map도 안 씀 — CLAUDE.md 지시 "번들러 금지"와
// 같은 결로 최소 개입). document.currentScript.src로 이 파일 자신의 URL을
// 잡아 node_modules 상대 경로를 계산한다 — canvas.html의 document base URL에
// 기대지 않는 방식이라 <script> 태그 로드 순서와 무관하게 항상 맞다.
// standalone 빌드를 쓴다 — 일반 production.mjs는 fancy-canvas를 bare
// specifier로 import해서(package.json dependencies), nodeIntegration:false
// 아래 브라우저 ESM 해석기가 못 푼다("Failed to resolve module specifier
// fancy-canvas" — 실측, diag-chart.js). standalone.production.mjs는 그
// 의존성까지 번들에 넣어 외부 import가 0건이다(실측: grep으로 확인).
const __LIGHTWEIGHT_CHARTS_URL = (() => {
  if (typeof document === 'undefined' || !document.currentScript) return 'lightweight-charts';
  return new URL('../node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.mjs', document.currentScript.src).href;
})();

function createCachedChartLibraryLoader(importer, clock) {
  if (typeof importer !== 'function') throw new TypeError('chart library importer가 필요하다');
  const now = typeof clock === 'function' ? clock : () => (
    typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
  );
  let promise = null;
  return function loadChartLibrary() {
    if (!promise) {
      promise = Promise.resolve().then(importer).then((library) => ({ library, readyAt: now() }));
    }
    return promise;
  };
}

const __loadChartLibrary = createCachedChartLibraryLoader(() => import(__LIGHTWEIGHT_CHARTS_URL));
// 실제 renderer에서는 canvas.html이 chart-card.js를 읽는 즉시 prewarm한다. Node의
// 순수 단위 테스트는 ESM/DOM 라이브러리를 불필요하게 로드하지 않는다.
if (!__isCjs && typeof document !== 'undefined') {
  void __loadChartLibrary().catch(() => {});
}

const UP_COLOR = '#FF5C5C';
const DOWN_COLOR = '#4D9FFF';
// 라인·영역의 중립색(CC-102 §2) — 등락색(UP/DOWN)을 재사용하지 않는다.
// tokens.css --color-navy와 같은 값(#9B9FE6).
const NAVY_COLOR = '#9B9FE6';
const GRID_COLOR = 'rgba(120,128,140,0.12)';
const CROSSHAIR_COLOR = 'rgba(120,128,140,0.6)';
const AXIS_TEXT_COLOR = '#6B7480';
// 가격축은 원 단위 정수로 — CC-101 이월 폴리시(팀 리드 지시, CC-102 인수 조건).
const PRICE_FORMAT = { type: 'price', precision: 0, minMove: 1 };

// ---- 보조지표(CC-103) 색 — 이평선·거래량MA는 "서로 구분되는 무채색 계열"
// (spec §3.1) — 액센트 색 없음 원칙(soul.md)과 같은 결. 밝기 단계로만 구분한다.
const MA_COLORS = ['#E7E9F2', '#C3C8DC', '#9AA0BF', '#6F76A0', '#4A5080'];
const BOLL_BAND_COLOR = 'rgba(154,160,191,0.55)';
const BOLL_MID_COLOR = 'rgba(154,160,191,0.9)';
const RSI_COLOR = '#C3C8DC';
const RSI_GUIDE_COLOR = 'rgba(154,160,191,0.4)';
const MACD_LINE_COLOR = '#C3C8DC';
const MACD_SIGNAL_COLOR = '#6F76A0';
const DECIMAL_PRICE_FORMAT = { type: 'price', precision: 2, minMove: 0.01 };

// ---------- 순수 변환 (DOM 없이 테스트 가능) ----------
// ohlcv: [{time,open,high,low,close,volume}, ...] (app/data/chart-mock-ohlcv.json
// 의 bars 그대로, 혹은 향후 실데이터 어댑터가 같은 형상으로 넘겨줄 것) →
// lightweight-charts 캔들/거래량 시리즈 데이터로 변환한다.
function toCandleSeriesData(ohlcv) {
  const list = Array.isArray(ohlcv) ? ohlcv : [];
  return list
    .filter((b) => b && b.time != null && isFinite(b.open) && isFinite(b.high) && isFinite(b.low) && isFinite(b.close))
    .map((b) => ({
      time: b.time,
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
    }));
}

// 거래량 히스토그램 — 등락색(alpha 0.5), 상승/하락은 종가-시가 부호로 판정
// (부록 C.3 관례: 캔들과 같은 등락 기준을 그대로 쓴다).
function toVolumeSeriesData(ohlcv) {
  const list = Array.isArray(ohlcv) ? ohlcv : [];
  return list
    .filter((b) => b && b.time != null && isFinite(b.volume))
    .map((b) => ({
      time: b.time,
      value: Number(b.volume),
      color: Number(b.close) >= Number(b.open) ? withAlpha(UP_COLOR, 0.5) : withAlpha(DOWN_COLOR, 0.5),
    }));
}

function withAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// AITS ChartCardBody.period를 Athena 툴바 토큰으로 받은 값만 신뢰한다. D/W/M/Y와
// 실제 분·틱 snapshot을 뜻하는 MIN/TICK을 허용하고, 그 외 값은 D로 fail-safe한다.
// AITS adapter는 preSampled=true를 함께 넘겨 실제 분·틱 봉을 의사 재샘플하지 않는다.
const VALID_INITIAL_PERIODS = ['D', 'W', 'M', 'Y', 'MIN', 'TICK'];
function resolveInitialPeriod(initial) {
  const requested = initial && initial.period;
  if (!requested) return 'D';
  if (VALID_INITIAL_PERIODS.indexOf(requested) === -1) {
    console.warn(`[chart-card] 인식할 수 없는 initial.period=${JSON.stringify(requested)} — 'D'로 폴백`);
    return 'D';
  }
  return requested;
}

// ---------- 카드 마운트 (DOM 필요) ----------
// container: 카드 본문 DOM 노드(canvas.js의 chartBody — .chart-card-body).
// opts: {symbol, name, ohlcv, initial, preSampled}. 기존 fixture는 일봉 원본에서
// 클라이언트 재샘플한다. AITS adapter는 해당 TR이 이미 만든 canonical candles를
// preSampled=true로 전달하므로 분·틱을 포함해 최초 봉을 그대로 그린다.
// 반환: {chart, setForm(candle|bar|line|area), setData(ohlcv), replaceData(ohlcv),
// applyChartTick(update|rollover, candle), destroy}. applyChartTick은 AITS
// ChartTickDelta의 진행봉 경로이며 현재 줌·팬 viewport를 보존한다.
async function createChartCard(container, opts) {
  const o = opts || {};
  const loaded = await __loadChartLibrary();
  if (typeof o.onChartLibraryReady === 'function') o.onChartLibraryReady(loaded.readyAt);
  const { createChart, CandlestickSeries, BarSeries, LineSeries, AreaSeries, HistogramSeries, CrosshairMode, LineStyle } =
    loaded.library;

  let dailyBars = Array.isArray(o.ohlcv) ? o.ohlcv.slice() : [];
  // 초기 주기가 'D'가 아니면 최초 렌더부터 실제로 리샘플된 봉을 보여준다 — 툴바
  // 탭만 'W'로 표시하고 데이터는 일봉 그대로면 정보 정직성(§8) 위반이다.
  const initialPeriod = resolveInitialPeriod(o.initial);
  const initialResample = o.preSampled
    ? { bars: dailyBars.slice(), mock: false }
    : resample(dailyBars, initialPeriod, 1);

  const toolbar = createChartToolbar({
    initial: { period: initialPeriod, interval: 1, form: 'candle', adjusted: true },
    callbacks: {
      onPeriodChange: (period, interval) => requestAuthoritativeReload({ period, interval, adjusted: currentAdjusted }),
      onFormChange: (form) => setForm(form),
      onAdjustedToggle: (adjustedOn) => requestAuthoritativeReload({ period: currentPeriod, interval: currentInterval, adjusted: adjustedOn }),
      onFullscreenToggle: () => toggleFullscreen(),
      onIndicatorButtonClick: (anchorBtn) => indicatorPanel.open(anchorBtn),
    },
  });
  container.appendChild(toolbar.element);

  const adjustedNote = document.createElement('div');
  adjustedNote.className = 'fin-meta chart-mock-note';
  container.appendChild(adjustedNote);

  const priceWrap = document.createElement('div');
  priceWrap.className = 'chart-price-pane';
  container.appendChild(priceWrap);

  // 오버레이 2종(CC-103) — lightweight-charts 캔버스 위에 얹는 DOM 레이어다.
  // pointer-events:none이라 크로스헤어·줌·드래그를 가로채지 않는다.
  const overlayLegend = document.createElement('div');
  overlayLegend.className = 'chart-overlay-legend';
  priceWrap.appendChild(overlayLegend);

  const vpOverlay = document.createElement('div');
  vpOverlay.className = 'chart-volume-profile-overlay';
  priceWrap.appendChild(vpOverlay);

  // TradingView attribution(위 주석, 라이선스 요구) 로고는 캔버스 픽셀이라 CSS로
  // 가리거나 지울 수 없다(그러면 라이선스 위반) — 하지만 기본 위치(좌하단)가
  // 거래량 pane(1) 바닥과 겹쳐 배경 없이 막대 위에 얹힌다(2026-08-19 QA 결함
  // #3). 로고 자리에만 작은 스크림을 깔아 데이터와 분리한다. pointer-events:none
  // 이라 로고 클릭(라이선스가 요구하는 링크)은 그대로 캔버스로 통과한다.
  const attributionScrim = document.createElement('div');
  attributionScrim.className = 'chart-attribution-scrim';
  attributionScrim.setAttribute('aria-hidden', 'true');
  priceWrap.appendChild(attributionScrim);

  const chart = createChart(priceWrap, {
    autoSize: true,
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: AXIS_TEXT_COLOR,
    },
    grid: {
      vertLines: { color: GRID_COLOR },
      horzLines: { color: GRID_COLOR },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: CROSSHAIR_COLOR, labelBackgroundColor: CROSSHAIR_COLOR },
      horzLine: { color: CROSSHAIR_COLOR, labelBackgroundColor: CROSSHAIR_COLOR },
    },
    rightPriceScale: {
      borderColor: GRID_COLOR,
    },
    // 좌측 가격축은 쓰지 않는다 — 가격축은 우측 하나뿐이다(§0 "가격축 우측").
    leftPriceScale: {
      visible: false,
    },
    timeScale: {
      borderColor: GRID_COLOR,
    },
  });

  const SERIES_DEFS = { candle: CandlestickSeries, bar: BarSeries, line: LineSeries, area: AreaSeries };

  let currentForm = 'candle';
  let currentPeriod = initialPeriod;
  let currentInterval = 1;
  let currentAdjusted = true;
  let reloadPending = false;
  let reloadFailure = null;
  let currentMockResample = initialResample.mock;
  let currentBars = initialResample.bars;
  let priceSeries = null;
  let volumeSeries = null;
  let drawLayer = null; // CC-105 — buildPriceSeries보다 늦게 만들어져서 let 선언

  // 가격 pane(0)과 거래량 pane(1) 분리는 CC-101 계약이다(부록 C.3). 형식 전환마다
  // 가격 시리즈를 통째로 갈아끼우는데(candle↔bar↔line↔area는 addSeries()로만
  // 만들 수 있고 옵션 갱신으로는 시리즈 종류를 못 바꾼다), removeSeries()로 pane
  // 0의 유일한 시리즈를 먼저 지우면 그 순간 pane 0이 비어 lightweight-charts가
  // 빈 pane을 자동 정리한다(addPane(preserveEmptyPane) 문서 참고) — 그러면 pane
  // 1(거래량)이 0으로 당겨지고, 이어서 만든 새 가격 시리즈가 paneIndex 생략(기본
  // 0)으로 그 자리에 겹쳐 그려진다(CC-102 실사용 회귀로 실측). 새 시리즈를 먼저
  // pane 0에 명시적으로 만들어 pane 0을 한 번도 비우지 않고, 거래량 paneIndex도
  // 항상 명시해 방어한다.
  function buildPriceSeries(form) {
    const def = SERIES_DEFS[form] || SERIES_DEFS.candle;
    let next;
    if (form === 'candle') {
      next = chart.addSeries(def, {
        upColor: UP_COLOR,
        downColor: DOWN_COLOR,
        borderUpColor: UP_COLOR,
        borderDownColor: DOWN_COLOR,
        wickUpColor: UP_COLOR,
        wickDownColor: DOWN_COLOR,
        borderVisible: true,
        priceFormat: PRICE_FORMAT,
      }, 0);
    } else if (form === 'bar') {
      // 바 = 등락색(§2 표) — 캔들과 같은 UP/DOWN을 그대로 쓴다.
      next = chart.addSeries(def, { upColor: UP_COLOR, downColor: DOWN_COLOR, priceFormat: PRICE_FORMAT }, 0);
    } else {
      // 라인·영역 = 중립 네이비(§2 표) — 등락색 재사용 금지, NAVY_COLOR 고정.
      next = chart.addSeries(def, {
        color: NAVY_COLOR,
        lineColor: NAVY_COLOR,
        topColor: withAlpha(NAVY_COLOR, 0.3),
        bottomColor: withAlpha(NAVY_COLOR, 0),
        priceFormat: PRICE_FORMAT,
      }, 0);
    }
    if (priceSeries) chart.removeSeries(priceSeries); // 새 시리즈가 이미 pane 0을 차지한 뒤 지운다 — pane 0이 비는 순간이 없다.
    priceSeries = next;
    // 방어적 재확인 — 위 순서 보장과 별개로, 거래량이 실제로 pane 1에 있는지
    // paneIndex()로 다시 읽어 아니면 되돌린다(ISeriesApi.moveToPane).
    if (volumeSeries && typeof volumeSeries.paneIndex === 'function' && volumeSeries.paneIndex() !== 1) {
      volumeSeries.moveToPane(1);
    }
    if (chart.panes()[1]) chart.panes()[1].setHeight(80);
    // 수평선(priceLine)은 시리즈 소속이라 재생성 때 같이 사라진다 — 다시 붙인다(CC-105).
    if (drawLayer) {
      drawLayer.reattachPriceLines();
      drawLayer.renderAll();
    }
    return priceSeries;
  }

  volumeSeries = chart.addSeries(
    HistogramSeries,
    { priceFormat: { type: 'volume' }, priceScaleId: '' },
    1 // 거래량은 가격 pane과 분리된 하위 pane(paneIndex 1)
  );
  chart.panes()[1] && chart.panes()[1].setHeight(80);
  // pane 1(거래량)도 좌측 스케일을 명시적으로 끈다(pane 0의 leftPriceScale 옵션은
  // pane별 스케일에 상속되지 않는다).
  chart.priceScale('left', 1).applyOptions({ visible: false });

  buildPriceSeries(currentForm);

  // ---------- 드로잉 1판(CC-105) — 확장 모드 게이트, 수평선·추세선 ----------
  drawLayer = createDrawingLayer({
    chart,
    getPriceSeries: () => priceSeries,
    container: priceWrap,
    onChange: () => saveAuthoring(),
  });
  priceWrap.appendChild(drawLayer.toolbar);

  // ---------- 보조지표 패널(CC-103) — spec §3·§4 ----------
  // indicatorState.visible/params는 chart-indicator-panel.js와 공유하는 같은
  // 객체다(참조 공유, 복제 아님) — 패널이 토글·파라미터를 직접 갱신하고, 여기는
  // "무엇이 바뀌었는지"만 콜백으로 받아 해당 시리즈군을 재생성한다.
  const indicatorState = {
    visible: new Set(DEFAULT_INDICATOR_VISIBLE),
    params: {
      ma: defaultParamsFor('ma'),
      boll: defaultParamsFor('boll'),
      volMa: defaultParamsFor('volMa'),
      rsi: defaultParamsFor('rsi'),
      macd: defaultParamsFor('macd'),
    },
  };
  let volumeProfileOn = false;

  let maSeriesList = []; // [{period, series}]
  let bollSeriesGroup = null; // {upper, middle, lower}
  let volMaSeriesList = []; // [{period, series}] — 거래량 pane(1) 위 오버레이
  let rsiLine = null;
  let macdLine = null;
  let macdSignalLine = null;
  let macdHistSeries = null;

  function refreshExtraPaneHeights() {
    if (chart.panes()[1]) chart.panes()[1].setHeight(80);
    if (rsiLine && typeof rsiLine.paneIndex === 'function') {
      const idx = rsiLine.paneIndex();
      if (chart.panes()[idx]) chart.panes()[idx].setHeight(90);
    }
    if (macdLine && typeof macdLine.paneIndex === 'function') {
      const idx = macdLine.paneIndex();
      if (chart.panes()[idx]) chart.panes()[idx].setHeight(90);
    }
  }

  function renderOverlayLegend() {
    overlayLegend.textContent = '';
    if (!indicatorState.visible.has('ma')) return;
    const periods = indicatorState.params.ma.periods;
    for (let i = 0; i < periods.length; i += 1) {
      const chip = document.createElement('span');
      chip.className = 'chart-overlay-legend-chip';
      const dot = document.createElement('span');
      dot.className = 'chart-overlay-legend-dot';
      dot.style.background = MA_COLORS[i % MA_COLORS.length];
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(`MA${periods[i]}`));
      overlayLegend.appendChild(chip);
    }
  }

  // 이평선·볼린저 — 가격 pane(0) 위 라인. 파라미터/토글이 바뀔 때마다 통째로
  // 지우고 다시 만든다(개수가 늘거나 줄 수 있어 diff보다 재생성이 단순하다).
  function applyOverlayIndicators() {
    for (const { series } of maSeriesList) chart.removeSeries(series);
    maSeriesList = [];
    if (indicatorState.visible.has('ma')) {
      const periods = indicatorState.params.ma.periods;
      for (let i = 0; i < periods.length; i += 1) {
        const series = chart.addSeries(
          LineSeries,
          { color: MA_COLORS[i % MA_COLORS.length], lineWidth: 1, priceFormat: PRICE_FORMAT, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false },
          0
        );
        maSeriesList.push({ period: periods[i], series });
      }
    }
    if (bollSeriesGroup) {
      chart.removeSeries(bollSeriesGroup.upper);
      chart.removeSeries(bollSeriesGroup.middle);
      chart.removeSeries(bollSeriesGroup.lower);
      bollSeriesGroup = null;
    }
    if (indicatorState.visible.has('boll')) {
      const bandOpts = { lineWidth: 1, priceFormat: PRICE_FORMAT, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false };
      bollSeriesGroup = {
        upper: chart.addSeries(LineSeries, Object.assign({ color: BOLL_BAND_COLOR }, bandOpts), 0),
        middle: chart.addSeries(LineSeries, Object.assign({ color: BOLL_MID_COLOR }, bandOpts), 0),
        lower: chart.addSeries(LineSeries, Object.assign({ color: BOLL_BAND_COLOR }, bandOpts), 0),
      };
    }
    renderOverlayLegend();
    recomputeOverlayData();
  }

  // 거래량MA — 거래량 pane(1) 위 오버레이(같은 스케일, priceScaleId:'').
  function applyVolMaIndicator() {
    for (const { series } of volMaSeriesList) chart.removeSeries(series);
    volMaSeriesList = [];
    if (indicatorState.visible.has('volMa')) {
      const periods = indicatorState.params.volMa.periods;
      for (let i = 0; i < periods.length; i += 1) {
        const series = chart.addSeries(
          LineSeries,
          { color: MA_COLORS[i % MA_COLORS.length], lineWidth: 1, priceScaleId: '', crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false },
          1
        );
        volMaSeriesList.push({ period: periods[i], series });
      }
    }
    refreshExtraPaneHeights();
    recomputeVolMaData();
  }

  // RSI·MACD — 별도 pane. 부분 토글이 pane 인덱스를 뒤섞지 않도록(CC-102 pane
  // 분리 계약 연장) 항상 고정 순서(RSI→MACD)로 둘 다 통째로 재생성한다.
  function applyPaneIndicators() {
    if (rsiLine) { chart.removeSeries(rsiLine); rsiLine = null; }
    if (macdLine) { chart.removeSeries(macdLine); macdLine = null; }
    if (macdSignalLine) { chart.removeSeries(macdSignalLine); macdSignalLine = null; }
    if (macdHistSeries) { chart.removeSeries(macdHistSeries); macdHistSeries = null; }

    let paneIdx = 2; // 0=가격 1=거래량
    if (indicatorState.visible.has('rsi')) {
      rsiLine = chart.addSeries(
        LineSeries,
        { color: RSI_COLOR, lineWidth: 1, priceFormat: DECIMAL_PRICE_FORMAT, crosshairMarkerVisible: false, lastValueVisible: false },
        paneIdx
      );
      rsiLine.createPriceLine({ price: 70, color: RSI_GUIDE_COLOR, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: '70' });
      rsiLine.createPriceLine({ price: 30, color: RSI_GUIDE_COLOR, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: '30' });
      paneIdx += 1;
    }
    if (indicatorState.visible.has('macd')) {
      macdHistSeries = chart.addSeries(HistogramSeries, { priceFormat: DECIMAL_PRICE_FORMAT, lastValueVisible: false }, paneIdx);
      macdLine = chart.addSeries(LineSeries, { color: MACD_LINE_COLOR, lineWidth: 1, priceFormat: DECIMAL_PRICE_FORMAT, crosshairMarkerVisible: false, lastValueVisible: false }, paneIdx);
      macdSignalLine = chart.addSeries(LineSeries, { color: MACD_SIGNAL_COLOR, lineWidth: 1, priceFormat: DECIMAL_PRICE_FORMAT, crosshairMarkerVisible: false, lastValueVisible: false }, paneIdx);
      paneIdx += 1;
    }
    refreshExtraPaneHeights();
    recomputePaneIndicatorData();
  }

  // 지표 배열(워밍업 null 포함) → lightweight-charts 라인 데이터. null은 버린다.
  function toLineData(times, values) {
    return times.map((t, i) => ({ time: t, value: values[i] })).filter((d) => d.value != null);
  }

  function recomputeOverlayData() {
    if (!currentBars.length) return;
    const closes = currentBars.map((b) => Number(b.close));
    const times = currentBars.map((b) => b.time);
    for (const { period, series } of maSeriesList) {
      series.setData(toLineData(times, sma(closes, period)));
    }
    if (bollSeriesGroup) {
      const { upper, middle, lower } = bollinger(closes, indicatorState.params.boll.period, indicatorState.params.boll.mult);
      bollSeriesGroup.upper.setData(toLineData(times, upper));
      bollSeriesGroup.middle.setData(toLineData(times, middle));
      bollSeriesGroup.lower.setData(toLineData(times, lower));
    }
  }

  function recomputeVolMaData() {
    if (!currentBars.length) return;
    const volumes = currentBars.map((b) => Number(b.volume));
    const times = currentBars.map((b) => b.time);
    for (const { period, series } of volMaSeriesList) {
      series.setData(toLineData(times, sma(volumes, period)));
    }
  }

  function recomputePaneIndicatorData() {
    if (!currentBars.length) return;
    const closes = currentBars.map((b) => Number(b.close));
    const times = currentBars.map((b) => b.time);
    if (rsiLine) {
      rsiLine.setData(toLineData(times, rsi(closes, indicatorState.params.rsi.period)));
    }
    if (macdLine) {
      const p = indicatorState.params.macd;
      const { macd: line, signal, histogram } = macd(closes, p.shortP, p.longP, p.signalP);
      macdLine.setData(toLineData(times, line));
      macdSignalLine.setData(toLineData(times, signal));
      macdHistSeries.setData(
        times
          .map((t, i) => ({ time: t, value: histogram[i], color: histogram[i] >= 0 ? withAlpha(UP_COLOR, 0.6) : withAlpha(DOWN_COLOR, 0.6) }))
          .filter((d) => d.value != null)
      );
    }
  }

  // 매물대(§4) — 독립 차트가 아니다. 가격 pane 우측 34% 오버레이(절대배치
  // 수평 히스토그램, pointer-events:none). priceSeries.priceToCoordinate()로
  // 가격→픽셀을 얻어 그린다 — 스크롤/줌으로 가격축이 오토스케일되면 값도 따라
  // 움직여야 해서(§4 "주기 전환·데이터 변경 시 재계산") visibleLogicalRange
  // 변경도 구독한다(아래).
  function renderVolumeProfile() {
    if (!volumeProfileOn) {
      vpOverlay.style.display = 'none';
      vpOverlay.textContent = '';
      return;
    }
    if (!currentBars.length) {
      vpOverlay.style.display = 'none';
      return;
    }
    const rows = currentBars.map((b) => ({ high: Number(b.high), low: Number(b.low), close: Number(b.close), volume: Number(b.volume) }));
    const { buckets, pocIndex } = volumeProfile(rows);
    vpOverlay.textContent = '';
    if (!buckets.length) {
      vpOverlay.style.display = 'none';
      return;
    }
    vpOverlay.style.display = 'block';
    const maxVol = Math.max.apply(null, buckets.map((b) => b.volume).concat([1]));
    for (let i = 0; i < buckets.length; i += 1) {
      const bucket = buckets[i];
      const yHigh = priceSeries.priceToCoordinate(bucket.high);
      const yLow = priceSeries.priceToCoordinate(bucket.low);
      if (yHigh == null || yLow == null) continue;
      const top = Math.min(yHigh, yLow);
      const height = Math.max(1, Math.abs(yLow - yHigh));
      const widthPct = (bucket.volume / maxVol) * 100;
      const bar = document.createElement('div');
      bar.className = 'chart-vp-bar' + (i === pocIndex ? ' is-poc' : '');
      bar.style.top = `${top}px`;
      bar.style.height = `${height}px`;
      bar.style.width = `${widthPct}%`;
      vpOverlay.appendChild(bar);
    }
  }
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
    if (volumeProfileOn) renderVolumeProfile();
  });

  // ---------- 저작 상태 영속(CC-104) — chart-lens-spec §3 ----------
  // 4종(지표 on/off+파라미터·차트형식·매물대·드로잉[CC-105])을 종목×주기 키
  // (chart.authoring.{symbol}.{token})로 저장·복원한다. 저장소는 렌더러
  // localStorage 1판(백엔드 영속은 후속 라운드 — note에 정직 표기). probe·테스트가
  // 저장소를 주입할 수 있게 opts.authoringStorage를 받는다.
  const authoringStore = createAuthoringStore(
    o.authoringStorage !== undefined
      ? o.authoringStorage
      : (typeof localStorage !== 'undefined' ? localStorage : null)
  );
  const symbol = o.symbol || 'UNKNOWN';

  function saveAuthoring() {
    authoringStore.save(symbol, periodToken(currentPeriod, currentInterval), {
      form: currentForm,
      volumeProfileOn,
      visible: indicatorState.visible,
      params: indicatorState.params,
      drawings: drawLayer ? drawLayer.toJSON() : [],
    });
  }

  // 저장된 상태를 실제 화면에 반영한다. 없으면(null) 아무것도 안 한다 — 처음
  // 방문하는 주기는 현재 상태를 상속한다(리셋보다 자연스럽다는 판단, 상속된
  // 상태는 다음 변경 때 그 주기 키로 저장된다).
  function applyAuthoring(saved) {
    if (!saved) return false;
    if (SERIES_DEFS[saved.form] && saved.form !== currentForm) {
      currentForm = saved.form;
      toolbar.state.form = saved.form;
      buildPriceSeries(saved.form);
    }
    indicatorState.visible.clear();
    for (const id of saved.indicators.visible) indicatorState.visible.add(id);
    for (const id of Object.keys(indicatorState.params)) {
      if (saved.indicators.params[id]) {
        indicatorState.params[id] = Object.assign({}, indicatorState.params[id], saved.indicators.params[id]);
      }
    }
    volumeProfileOn = !!saved.volumeProfileOn;
    indicatorPanel.syncFromState(volumeProfileOn);
    applyOverlayIndicators();
    applyVolMaIndicator();
    applyPaneIndicators();
    if (drawLayer) drawLayer.load(saved.drawings);
    return true;
  }

  const indicatorPanel = createIndicatorPanel({
    initial: { visible: indicatorState.visible, params: indicatorState.params, volumeProfileOn },
    callbacks: {
      onToggle: (id) => {
        if (id === 'ma' || id === 'boll') applyOverlayIndicators();
        else if (id === 'volMa') applyVolMaIndicator();
        else if (id === 'rsi' || id === 'macd') applyPaneIndicators();
        saveAuthoring();
      },
      onParamChange: (id) => {
        if (id === 'ma' || id === 'boll') applyOverlayIndicators();
        else if (id === 'volMa') applyVolMaIndicator();
        else if (id === 'rsi' || id === 'macd') applyPaneIndicators();
        saveAuthoring();
      },
      onVolumeProfileToggle: (on) => {
        volumeProfileOn = on;
        requestAnimationFrame(() => renderVolumeProfile());
        saveAuthoring();
      },
    },
  });

  function setData(ohlcv, options) {
    const shouldFitContent = !options || options.fitContent !== false;
    const candleData = toCandleSeriesData(ohlcv);
    const volumeData = toVolumeSeriesData(ohlcv);
    if (currentForm === 'line' || currentForm === 'area') {
      priceSeries.setData(candleData.map((d) => ({ time: d.time, value: d.close })));
    } else {
      priceSeries.setData(candleData);
    }
    volumeSeries.setData(volumeData);
    if (shouldFitContent) chart.timeScale().fitContent();
    recomputeOverlayData();
    recomputeVolMaData();
    recomputePaneIndicatorData();
    // priceToCoordinate()는 fitContent() 이후 렌더가 실제로 갱신돼야 정확하다
    // (같은 틱에서 읽으면 이전 스케일값을 돌려줄 수 있다 — 실측 방어).
    requestAnimationFrame(() => {
      renderVolumeProfile();
      if (drawLayer) drawLayer.renderAll(); // 추세선 재투영(주기 전환·데이터 갱신)
    });
  }

  // AITS CARD_SET/same-panel reload 권위 경로. 화면 시리즈만 바꾸는 setData와
  // 달리 이후 주기 전환·tick delta가 참조하는 controller 기준 배열도 함께
  // 교체한다. 전달된 ChartCardBody.candles는 이미 해당 주기의 canonical
  // snapshot이므로 여기서 다시 재샘플하지 않는다.
  function replaceData(ohlcv, options) {
    const replacement = options && typeof options === 'object' ? options : {};
    if (VALID_INITIAL_PERIODS.indexOf(replacement.period) !== -1) {
      currentPeriod = replacement.period;
      currentInterval = replacement.interval || 1;
      toolbar.setPeriod(currentPeriod, currentInterval, false);
    }
    dailyBars = Array.isArray(ohlcv) ? ohlcv.slice() : [];
    currentBars = dailyBars.slice();
    currentMockResample = false;
    setData(currentBars);
    updateNote();
  }

  // AITS ChartTickDelta 호환 경로. update는 같은 시각 슬롯의 마지막 봉 교체,
  // rollover는 새 봉 append다. renderer/series를 다시 만들지 않고 fitContent도
  // 호출하지 않으므로 진행봉 수신 전의 줌·팬 viewport가 유지된다.
  function applyChartTick(kind, candle) {
    const price = toCandleSeriesData([candle])[0];
    const volume = toVolumeSeriesData([candle])[0];
    if (!price) return false;
    if (kind === 'update') {
      if (!currentBars.length) return false;
      currentBars[currentBars.length - 1] = candle;
      if (dailyBars.length) dailyBars[dailyBars.length - 1] = candle;
    } else if (kind === 'rollover') {
      currentBars.push(candle);
      dailyBars.push(candle);
    } else {
      return false;
    }
    if (currentForm === 'line' || currentForm === 'area') priceSeries.update({ time: price.time, value: price.close });
    else priceSeries.update(price);
    if (volume) volumeSeries.update(volume);
    recomputeOverlayData();
    recomputeVolMaData();
    recomputePaneIndicatorData();
    requestAnimationFrame(() => {
      renderVolumeProfile();
      if (drawLayer) drawLayer.renderAll();
    });
    return true;
  }

  // 기본 on(이평선·거래량MA) 초기 적용 — 패널·데이터 로드보다 먼저 시리즈를
  // 만들어둬야 setData()가 첫 렌더에서 바로 채운다.
  applyOverlayIndicators();
  applyVolMaIndicator();

  function setForm(form) {
    if (!SERIES_DEFS[form]) return;
    currentForm = form;
    buildPriceSeries(form);
    if (currentBars && currentBars.length) setData(currentBars);
    saveAuthoring();
  }

  // 정직 표기(fin-meta 관례) — AITS canonical snapshot은 수정주가/주기 변경 때
  // REST control-plane을 새로 왕복한다. fixture만 로컬 재샘플임을 표시한다.
  function updateNote() {
    const parts = o.preSampled
      ? [`AITS ${o.trId || 'chart'} canonical snapshot`]
      : ['서버 보정(upd_stkpc_tp) 미연결 — 목업 동일 데이터'];
    if (currentMockResample) parts.push('분/틱은 일봉에서 만든 결정적 의사 재샘플 — 실제 장중 분포 아님');
    if (authoringStore.enabled) parts.push('저작 상태 로컬 저장 1판 — 백엔드 영속은 후속 라운드');
    if (reloadFailure) parts.push(`재조회 실패 — ${reloadFailure}`);
    adjustedNote.textContent = parts.join(' · ');
  }

  async function requestAuthoritativeReload(request) {
    const previous = { period: currentPeriod, interval: currentInterval, adjusted: currentAdjusted };
    if (reloadPending || typeof o.onReloadRequest !== 'function') {
      toolbar.setPeriod(previous.period, previous.interval, false);
      toolbar.setAdjusted(previous.adjusted);
      reloadFailure = reloadPending ? '이전 재조회가 진행 중이다' : 'REST reload 권위가 없다';
      updateNote();
      return false;
    }
    reloadPending = true;
    reloadFailure = null;
    try {
      const result = await o.onReloadRequest(request);
      if (!result || result.ok !== true) throw new Error((result && result.error) || 'reload가 완료되지 않았다');
      currentAdjusted = request.adjusted !== false;
      toolbar.setAdjusted(currentAdjusted);
      return true;
    } catch (error) {
      toolbar.setPeriod(previous.period, previous.interval, false);
      toolbar.setAdjusted(previous.adjusted);
      reloadFailure = String((error && error.message) || error);
      updateNote();
      return false;
    } finally {
      reloadPending = false;
    }
  }

  // 주기 탭·세분 전환 — 원본 일봉(dailyBars)에서 매번 새로 파생한다(누적 오차 없음).
  // 저작 상태는 주기별 독립이다(CC-104): 떠나는 주기의 상태를 저장하고, 도착한
  // 주기에 저장분이 있으면 복원한다(없으면 현재 상태 상속 — applyAuthoring 주석).
  function applyPeriod(period, interval) {
    saveAuthoring(); // 떠나는 주기의 상태를 그 주기 키로 확정
    currentPeriod = period;
    currentInterval = interval;
    const { bars, mock } = resample(dailyBars, period, interval);
    currentBars = bars;
    currentMockResample = mock;
    applyAuthoring(authoringStore.load(symbol, periodToken(period, interval)));
    setData(currentBars);
    updateNote();
  }

  // 프로그래밍 API/fixture 호환 경로. 사용자 toolbar 토글은 위의
  // requestAuthoritativeReload를 통해서만 서버 snapshot을 교체한다.
  function applyAdjusted(adjustedOn) {
    currentAdjusted = adjustedOn;
    toolbar.setAdjusted(currentAdjusted);
    applyPeriod(currentPeriod, currentInterval);
  }

  // 마운트 시 복원(CC-104) — 이 종목×주기에 저장된 저작 상태가 있으면 기본값
  // 대신 그걸 쓴다(위의 기본 on 적용을 덮어쓴다).
  applyAuthoring(authoringStore.load(symbol, periodToken(currentPeriod, currentInterval)));

  if (dailyBars.length) {
    setData(currentBars);
    updateNote();
  }

  // ---------- 전체화면(§7) — "두 창 원칙" 적응 ----------
  // spec 원문은 OS `position:fixed; inset:0`(브라우저/일반 웹앱 관례)이지만,
  // Athena는 창이 둘뿐이라는 원칙(CLAUDE.md §2)이 위에 있다 — 새 창도, OS
  // 전체화면도 쓰지 않는다. 대신 캔버스 창(그리드) 안에서 이 카드가
  // grid-column을 전체로 넓히고 다른 카드를 숨기는 "그리드 점유"로 같은
  // 사용자 목표(크게 보고 싶다)를 이룬다 — canvas.css .card.is-expanded /
  // .grid.has-expanded.
  let isFullscreen = false;

  function measureAndResize() {
    requestAnimationFrame(() => {
      const rect = priceWrap.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) chart.resize(rect.width, rect.height);
      chart.timeScale().fitContent();
      if (volumeProfileOn) renderVolumeProfile();
    });
  }

  function toggleFullscreen() {
    const card = container.closest('.card');
    const grid = container.closest('.grid');
    if (!card) return;
    isFullscreen = !isFullscreen;
    card.classList.toggle('is-expanded', isFullscreen);
    if (grid) grid.classList.toggle('has-expanded', isFullscreen);
    toolbar.setFullscreenLabel(isFullscreen);
    // 드로잉 게이트(CC-105) — 확장 모드에서만 도구바·입력 활성. 복귀 시
    // 미완성 점 폐기·저장 목록 보존은 layer가 setEnabled(false)에서 처리.
    if (drawLayer) drawLayer.setEnabled(isFullscreen);
    // 진입·복귀 둘 다 재측정한다 — 복귀만 요구되지만(§7) 그리드 점유 진입도
    // 카드 높이가 바뀌는 순간이라 같은 처리가 필요하다(실측: 진입 직후에도
    // autoSize의 ResizeObserver가 트랜지션 중간값을 잡아 캔버스가 찌그러짐).
    measureAndResize();
  }

  function destroy() {
    toolbar.destroy();
    indicatorPanel.destroy();
    if (drawLayer) drawLayer.destroy();
    const card = container.closest('.card');
    const grid = container.closest('.grid');
    if (card) card.classList.remove('is-expanded');
    if (grid) grid.classList.remove('has-expanded');
    chart.remove();
    if (priceWrap.parentElement) priceWrap.remove();
  }

  return { chart, setForm, setData, replaceData, applyChartTick, applyPeriod, applyAdjusted, toggleFullscreen, destroy };
}

// 외부 소비자는 canvas.js(createChartCard)와 chart-card.test.js(순수 변환 + 등락색
// + resolveInitialPeriod, P2a) 뿐이다 — 나머지 상수는 내부 구현 세부라 내보내지
// 않는다(deslop 2026-08-18).
const __exports = {
  createChartCard,
  createCachedChartLibraryLoader,
  resolveInitialPeriod,
  toCandleSeriesData,
  toVolumeSeriesData,
  withAlpha,
  UP_COLOR,
  DOWN_COLOR,
};
if (__isCjs) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.ChartCard = __exports;
}

})();
