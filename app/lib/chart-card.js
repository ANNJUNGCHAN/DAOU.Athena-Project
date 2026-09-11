// IIFE 스코프 격리(2026-08-18 렌더러 격리) — <script> 태그는 top-level const/function을
// 문서 전체가 공유하는 하나의 스크립트 스코프에 넣는다(require()의 모듈별 격리와 다르다).
// el/sanitize 같은 흔한 이름이 파일 간에 충돌해 SyntaxError가 났다(실측, diag-isolation.js).
// CJS(require)는 이 IIFE 밖에서도 동일하게 동작한다 — Node의 모듈 래퍼가 이미 함수 스코프다.
(function () {

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
const { DEFAULT_INDICATOR_VISIBLE, defaultParamsFor, INDICATOR_DEFS } = __dep('./chart-indicator-registry', 'ChartIndicatorRegistry');
const { createIndicatorRenderer } = __dep('./chart-indicator-render', 'ChartIndicatorRender');
const { volumeProfile } = __dep('./chart-volume-profile', 'ChartVolumeProfile');
const { createAuthoringStore, periodToken } = __dep('./chart-authoring-store', 'ChartAuthoringStore');
const { createDrawingLayer } = __dep('./chart-drawings', 'ChartDrawings');
const { formatKoreanUnit } = __dep('./board-format', 'BoardFormat');

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

// 창이 가려지거나 최소화에서 막 복원된 시점에는 Chromium이 RAF를 늦출 수 있다.
// 사용자 토글의 첫 결과를 RAF에만 맡기지 않고 즉시 그린 뒤, 다음 프레임에서
// lightweight-charts 좌표를 한 번 더 읽어 레이아웃 변화를 보정한다.
function renderNowAndOnNextFrame(render, scheduleFrame) {
  if (typeof render !== 'function') throw new TypeError('chart render callback이 필요하다');
  render();
  const schedule = typeof scheduleFrame === 'function'
    ? scheduleFrame
    : (callback) => requestAnimationFrame(callback);
  return schedule(() => render());
}

// 차트 주기 재조회는 이 한도만 쓴다. canvas IPC 쪽에 같은 8초를 또 걸면
// 안쪽 타이머가 항상 먼저 발화해 바깥 분기는 죽은 코드가 된다.
const RELOAD_DEADLINE_MS = 8000;
const RELOAD_DEADLINE_ERROR = '재조회 8초 한도를 넘겼다';

function withReloadDeadline(work, options) {
  const opts = options || {};
  const ms = Number.isFinite(opts.ms) ? opts.ms : RELOAD_DEADLINE_MS;
  const message = typeof opts.message === 'string' ? opts.message : RELOAD_DEADLINE_ERROR;
  const setTimeoutImpl = typeof opts.setTimeout === 'function' ? opts.setTimeout : setTimeout;
  const clearTimeoutImpl = typeof opts.clearTimeout === 'function' ? opts.clearTimeout : clearTimeout;
  let timer;
  return Promise.race([
    work,
    new Promise((_, reject) => {
      timer = setTimeoutImpl(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => {
    clearTimeoutImpl(timer);
  });
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

function formatVolumeKo(value) {
  return formatKoreanUnit(value) || '';
}
const VOLUME_FORMAT = { type: 'custom', formatter: formatVolumeKo };

// 주기별 초기 봉 폭(px/봉) — MTS 표준 캔들 밀도. AITS
// (src/renderer/shared/vm/chart-lwc/common.ts DEFAULT_BAR_SPACING)에서 가져온 값이다.
//
// 왜 fitContent가 아닌가: fitContent는 적재된 봉 전체를 폭에 욱여넣는다. 그러면
// ① 봉 수가 많을수록 봉이 얇아져 뭉개지고 ② 이미 전부 보이므로 좌측으로 팬해도
// 나올 과거가 없다.
// MTS는 반대로 '읽기 좋은 고정 봉 폭'을 유지하고 보이는 봉 수를 폭에 맞춰 정한다.
// → barSpacing을 고정하고 scrollToRealTime()으로 우측(최신)에 정렬한다.
//   나머지 과거는 좌측 팬·휠 줌아웃으로 접근한다(적재는 전량이다).
const DEFAULT_BAR_SPACING = { TICK: 6, MIN: 6, D: 9, W: 7, M: 8, Y: 8 };
const BAR_SPACING_FALLBACK = 9;


// 장중(분·틱) 시각은 KST로 읽어야 한다. lightweight-charts는 시간대를 모르고
// epoch를 UTC로 렌더한다 — 그대로 두면 09:00~15:30 정규장이 00:00~06:30으로
// 찍힌다(2026-08-25 실서버 실측: 마지막 봉 15:30 KST가 06:30으로 보였다).
// 데이터(epoch)는 건드리지 않고 표기만 Asia/Seoul로 바꾼다.
const KST = 'Asia/Seoul';
const KST_HM = new Intl.DateTimeFormat('ko-KR', { timeZone: KST, hour: '2-digit', minute: '2-digit', hour12: false });
const KST_HMS = new Intl.DateTimeFormat('ko-KR', { timeZone: KST, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const KST_MD = new Intl.DateTimeFormat('ko-KR', { timeZone: KST, month: 'numeric', day: 'numeric' });

// epoch 초만 다룬다. 일·주·월·년 봉의 time은 'YYYY-MM-DD' 문자열이라 라이브러리
// 기본 표기가 이미 맞다 — 그때는 null을 돌려 기본 동작에 맡긴다.
function kstLabel(time, withSeconds) {
  if (typeof time !== 'number' || !Number.isFinite(time)) return null;
  const at = new Date(time * 1000);
  return (withSeconds ? KST_HMS : KST_HM).format(at);
}

// ---- 보조지표(CC-103) 색은 chart-indicator-render.js의 스펙 테이블이 갖는다.
// 여기 있던 MA_COLORS/BOLL_*/RSI_*/MACD_* 7개는 지표별 배선을 렌더러로 옮기면서
// 참조가 사라져 걷어냈다(2026-08-25). 무채색 밝기 단계 원칙은 그대로다.
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

// 분·틱은 실제 epoch 초라 전날 종가와 오늘 시세가 한 축에 붙으면 이평이
// 장 사이 공백을 가로질러 꺾인다(1분봉 실측). 30분 넘는 구멍은 세션 경계로
// 보고 마지막 연속 구간만 그린다. 일·주·월·년은 날짜 문자열이라 손대지 않는다.
const INTRADAY_SESSION_GAP_SEC = 30 * 60;

function clipIntradayToLatestSession(ohlcv, period) {
  const token = String(period || '');
  if (token !== 'MIN' && token !== 'TICK') {
    return Array.isArray(ohlcv) ? ohlcv : [];
  }
  const list = Array.isArray(ohlcv) ? ohlcv : [];
  if (list.length < 2) return list.slice();
  let start = 0;
  for (let i = 1; i < list.length; i += 1) {
    const prev = list[i - 1] && list[i - 1].time;
    const next = list[i] && list[i].time;
    if (typeof prev !== 'number' || typeof next !== 'number') continue;
    if (next - prev > INTRADAY_SESSION_GAP_SEC) start = i;
  }
  return start === 0 ? list.slice() : list.slice(start);
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
    // 분·틱 탭을 열어줄 조건은 "이 패널이 분·틱을 조회할 수 있는가"다. AITS
    // adapter가 reload 계약(chart_meta.reload_targets)에 min·tick이 있는지를 보고
    // intradayAvailable로 넘겨준다 — 그게 있으면 주기 탭을 눌렀을 때 실제로
    // ka10080/ka10079가 돈다(2026-08-25 실서버 확인: 6주기 전부 응답).
    //
    // preSampled만으로 판정하면 안 된다 — AITS adapter는 일봉 snapshot에도
    // preSampled=true를 붙인다(그건 "다시 재샘플하지 마"라는 뜻이지 "장중
    // 데이터가 있다"가 아니다). 실측으로 걸렸다(verify 검증13). 계약 정보가 없는
    // 경로(fixture 등)는 종전 판정을 그대로 쓴다 — 없는 데이터를 열지 않는다.
    intradayAvailable: o.intradayAvailable === true
      || (!!o.preSampled && (initialPeriod === 'MIN' || initialPeriod === 'TICK')),
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

  // 지표 표시 실패 안내 — 평소엔 숨어 있고 못 켠 지표가 있을 때만 나타난다.
  const indicatorNote = document.createElement('div');
  indicatorNote.className = 'fin-meta chart-mock-note';
  indicatorNote.hidden = true;
  container.appendChild(indicatorNote);

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

  // 축·크로스헤어 포매터는 createChart보다 늦게 호출되지만 선언은 먼저여야 한다
  // (클로저가 TDZ에 걸리지 않게). applyBarDensity가 주기마다 갱신한다.
  let intradayAxis = false;
  let tickSeconds = false;

  const chart = createChart(priceWrap, {
    // 크로스헤어의 시각 라벨 — 축과 같은 KST 표기를 쓴다.
    localization: {
      timeFormatter: (time) => (intradayAxis ? kstLabel(time, tickSeconds) : null),
    },
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
      // 장중 축 눈금. tickMarkType은 라이브러리가 정하는 눈금 단위로,
      // 0=Year 1=Month 2=DayOfMonth 3=Time 4=TimeWithSeconds다. 날짜 단위 눈금은
      // 날짜로, 그 아래는 KST 시각으로 찍는다. null이면 라이브러리 기본 표기다.
      tickMarkFormatter: (time, tickMarkType) => {
        if (!intradayAxis || typeof time !== 'number') return null;
        if (tickMarkType <= 2) {
          return Number.isFinite(time) ? KST_MD.format(new Date(time * 1000)) : null;
        }
        return kstLabel(time, tickMarkType === 4);
      },
    },
  });

  const SERIES_DEFS = { candle: CandlestickSeries, bar: BarSeries, line: LineSeries, area: AreaSeries };

  let currentForm = 'candle';
  let currentPeriod = initialPeriod;
  let currentInterval = 1;
  let currentAdjusted = true;
  // 주기를 바꾸면 서버가 다른 TR로 응답한다 — replaceData가 새 trId로 갱신한다.
  let currentTrId = o.trId;
  let reloadPending = false;
  let reloadFailure = null;
  // 분·틱을 요청받았는데 그 데이터가 없을 때의 사유. 봉은 일봉으로 되돌아가므로
  // 이걸 표시하지 않으면 "탭은 분인데 그려진 건 일봉"이 된다(§8 정보 정직성).
  let intradayUnavailable = initialResample.unavailable || null;
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
    { priceFormat: VOLUME_FORMAT, priceScaleId: '' },
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
  // params는 레지스트리의 **모든** 지표를 미리 채운다 — 지표가 34종으로 늘면서
  // 5종만 열거하던 방식은 새 지표를 켤 때 params[id]가 undefined가 돼 기본값이
  // 사라진다(2026-08-25 확장). 레지스트리가 단일 출처다.
  const indicatorState = {
    visible: new Set(DEFAULT_INDICATOR_VISIBLE),
    params: INDICATOR_DEFS.reduce((acc, d) => {
      acc[d.id] = defaultParamsFor(d.id);
      return acc;
    }, {}),
  };
  let volumeProfileOn = false;

  // 지표 렌더는 chart-indicator-render.js가 스펙 테이블로 통째로 관리한다.
  // 지표마다 전역 변수(maSeriesList/bollSeriesGroup/rsiLine/macdLine…)를 두던
  // 옛 방식은 34종에서 배선이 34벌이 되고, pane 인덱스를 손으로 맞춰야 해서
  // 이미 겪은 "pane 0이 비면 거래량이 당겨지는" 버그가 그만큼 넓어진다.
  const indicatorRenderer = createIndicatorRenderer({
    chart,
    LineSeries,
    HistogramSeries,
    LineStyle,
    priceFormat: PRICE_FORMAT,
    decimalFormat: DECIMAL_PRICE_FORMAT,
    volumePaneIndex: 1,
    ownPaneHeight: 90,
    volumeHeight: 80,
    // pane 높이는 비율로 나눈다 — 개수 제한도 카드 성장도 없다(render 쪽 주석).
    upColor: UP_COLOR,
    downColor: DOWN_COLOR,
    withAlpha,
  });

  // 지표 시리즈 재생성 — 켜진 조합 전체를 통째로 다시 만든다.
  // 부분 갱신을 하지 않는 이유는 chart-indicator-render.js의 apply() 주석 참조
  // (전용 pane 인덱스가 조합에 따라 바뀐다).
  function applyIndicators() {
    const res = indicatorRenderer.apply(indicatorState.visible, indicatorState.params, currentBars);
    renderOverlayLegend();
    reportSkippedIndicators(res && res.skipped);
  }

  // 높이가 모자라 못 켠 지표를 **말해준다**. 목록에서는 켜진 것처럼 보이는데
  // 화면엔 없는 상태가 제일 나쁘다(§8 정보 정직성) — 조용히 넘기지 않는다.
  // 지금은 개수 제한이 없어 항상 빈 배열이지만, 미래에 다시 거부할 일이 생기면
  // 알릴 자리가 남아 있어야 한다(조용한 누락 금지).
  function reportSkippedIndicators(skipped) {
    if (!indicatorNote) return;
    if (!skipped || !skipped.length) {
      indicatorNote.textContent = '';
      indicatorNote.hidden = true;
      return;
    }
    const labels = skipped
      .map((id) => (INDICATOR_DEFS.find((d) => d.id === id) || {}).label || id)
      .join(' · ');
    indicatorNote.hidden = false;
    indicatorNote.textContent =
      `높이가 모자라 표시하지 못한 지표 ${skipped.length}종: ${labels} — 차트를 크게 보거나 다른 지표를 끄면 나타난다`;
  }

  // 지표 데이터만 다시 계산한다(시리즈 구성은 그대로) — 봉이 바뀌었을 때.
  function recomputeIndicatorData() {
    indicatorRenderer.setData(currentBars, indicatorState.params, indicatorState.visible);
  }

  // 가격 pane 위에 겹친 지표의 이름·색 칩. 어떤 지표가 켜져 있든 렌더러가
  // 알려주는 대로 그린다(이평선 전용 하드코딩을 걷었다).
  function renderOverlayLegend() {
    overlayLegend.textContent = '';
    const chips = indicatorRenderer.legendFor(indicatorState.visible, indicatorState.params);
    for (const c of chips) {
      const chip = document.createElement('span');
      chip.className = 'chart-overlay-legend-chip';
      const dot = document.createElement('span');
      dot.className = 'chart-overlay-legend-dot';
      dot.style.background = c.color;
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(c.label));
      overlayLegend.appendChild(chip);
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
  // ---------- 과거 봉 덧붙이기(좌측 끝 도달) ----------
  // 적재분을 다 보고 왼쪽 끝에 닿으면 그 앞 구간을 한 페이지 더 받아 앞에 붙인다.
  // 화면을 교체하지 않는다 — 보고 있던 봉이 그대로 남아야 한다(아래 인덱스 보정).
  const HISTORY_TRIGGER_BARS = 12; // 왼쪽 끝에서 이만큼 남으면 미리 부른다
  let historyPending = false;
  let historyExhausted = false;
  // 연속 실패 상한. 마운트 직후 권위 등록 전 거부는 곧 회복되므로 몇 번은 봐준다.
  const HISTORY_MAX_FAILURES = 5;
  let historyFailures = 0;

  // 'YYYY-MM-DD' 또는 epoch → 'YYYYMMDD'. 커서로 쓸 수 없으면 null.
  function cursorOf(bar) {
    if (!bar || bar.time == null) return null;
    if (typeof bar.time === 'string') {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(bar.time);
      return m ? `${m[1]}${m[2]}${m[3]}` : null;
    }
    return null; // 분·틱(epoch)은 base_dt 커서가 없다 — main이 거부한다
  }

  // 왼쪽 끝 판정. range.to > 0을 함께 본다 — 마운트 직후 차트가 아직 폭을 못 잡은
  // 순간에는 from이 -1700 같은 값으로 오고(가시 구간이 데이터와 아예 안 겹친다)
  // 그걸 "끝에 닿았다"로 읽으면 초기 조회와 동시에 과거 조회가 나가 서로를
  // abort시킨다(실측: 두 요청이 영영 pending으로 남았다).
  function isNearLeftEdge(range) {
    if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) return false;
    if (range.to <= 0) return false; // 데이터와 겹치지 않는 뷰포트 — 아직 자리를 잡는 중이다
    return range.from <= HISTORY_TRIGGER_BARS;
  }

  async function requestOlderBars() {
    if (historyPending || historyExhausted) return;
    if (typeof o.onHistoryRequest !== 'function') return;
    const cursor = cursorOf(currentBars[0]);
    if (!cursor) { historyExhausted = true; return; }
    historyPending = true;
    try {
      // 실제 덧붙이기는 어댑터가 한다(prependData를 되불러 온다) — 봉의 정본은
      // 세션 body이고, 여기서만 늘리면 두 벌이 어긋난다.
      const added = Number(await o.onHistoryRequest(cursor)) || 0;
      // 한 페이지가 통째로 중복이면 더 과거가 없다는 뜻이다 — 무한 재시도를 막는다.
      if (added) historyFailures = 0;
      else historyExhausted = true;
    } catch {
      // 실패는 "과거가 없다"는 증거가 아니다. 마운트 직후에는 패널 권위가 아직
      // 등록되기 전이라 첫 요청이 거부될 수 있다(실측 2026-08-25: 페인트 확인보다
      // 자동 발화가 먼저 일어나 size=0으로 거부됐다). 여기서 영구히 잠그면 그 뒤
      // 사용자가 아무리 팬해도 과거가 영영 안 나온다 — 실제로 그렇게 막혀 있었다.
      // 대신 연속 실패만 세어 몇 번 만에 포기한다.
      historyFailures += 1;
      if (historyFailures >= HISTORY_MAX_FAILURES) historyExhausted = true;
    } finally {
      historyPending = false;
    }
  }

  // 앞쪽에 붙이고 보던 자리를 유지한다. setData는 논리 인덱스를 0부터 다시 매기므로
  // 붙인 개수만큼 가시 범위를 밀어야 화면이 제자리에 남는다. 중복 제거는 호출자
  // (어댑터)가 이미 했다 — 여기서 또 거르면 두 기준이 생긴다.
  function prependData(fresh) {
    const older = Array.isArray(fresh) ? fresh : [];
    if (!older.length) return 0;
    const range = chart.timeScale().getVisibleLogicalRange();
    currentBars = older.concat(currentBars);
    dailyBars = older.concat(dailyBars);
    setData(currentBars, { fitContent: false });
    if (range) {
      chart.timeScale().setVisibleLogicalRange({
        from: range.from + older.length, to: range.to + older.length,
      });
    }
    return older.length;
  }

  chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (volumeProfileOn) renderVolumeProfile();
    if (isNearLeftEdge(range)) requestOlderBars();
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
    applyIndicators();
    if (drawLayer) drawLayer.load(saved.drawings);
    return true;
  }

  const indicatorPanel = createIndicatorPanel({
    initial: { visible: indicatorState.visible, params: indicatorState.params, volumeProfileOn },
    callbacks: {
      onToggle: (id) => {
        applyIndicators();
        saveAuthoring();
      },
      onParamChange: (id) => {
        applyIndicators();
        saveAuthoring();
      },
      onVolumeProfileToggle: (on) => {
        volumeProfileOn = on;
        renderNowAndOnNextFrame(renderVolumeProfile);
        saveAuthoring();
      },
    },
  });

  // 봉 폭을 주기 표준값으로 고정하고 최신 봉에 정렬한다(fitContent 대체 — 위 주석).
  // 보이는 봉 수는 차트 폭이 정한다: 도킹 카드(~970px)에서 일봉 9px ≈ 107봉,
  // 전체화면(~1900px) ≈ 210봉. 적재분(240봉)이 더 많으므로 좌측 팬이 살아 있다.
  function applyBarDensity() {
    const barSpacing = DEFAULT_BAR_SPACING[currentPeriod] || BAR_SPACING_FALLBACK;
    const width = priceWrap ? priceWrap.clientWidth : 0;
    // 분·틱은 하루 안에서 봉이 갈리므로 시각을 보여야 한다. 이걸 안 켜면 시간축이
    // 전부 같은 날짜("25일")로 찍혀 봉을 구분할 수 없다(2026-08-25 실서버 실측).
    // 틱은 초까지 간다 — ka10079의 cntr_tm이 초 단위(20260825153004)다.
    intradayAxis = currentPeriod === 'MIN' || currentPeriod === 'TICK';
    tickSeconds = currentPeriod === 'TICK';
    chart.timeScale().applyOptions({ timeVisible: intradayAxis, secondsVisible: tickSeconds });
    // 적재 봉이 표준 폭으로 화면을 못 채우면 폭에 맞춘다. 년봉은 30봉뿐이라
    // 8px 고정이면 240px만 쓰고 나머지가 통째로 빈다(2026-08-25 실서버 실측).
    // 채울 수 있을 때만 고정 밀도를 쓴다 — 그때만 좌측에 팬할 과거가 남는다.
    if (width > 0 && currentBars.length * barSpacing < width) {
      chart.timeScale().fitContent();
      return;
    }
    chart.timeScale().applyOptions({ barSpacing });
    chart.timeScale().scrollToRealTime();
  }

  function setData(ohlcv, options) {
    const shouldFitContent = !options || options.fitContent !== false;
    const clipped = clipIntradayToLatestSession(ohlcv, currentPeriod);
    currentBars = clipped;
    const candleData = toCandleSeriesData(clipped);
    const volumeData = toVolumeSeriesData(clipped);
    if (currentForm === 'line' || currentForm === 'area') {
      priceSeries.setData(candleData.map((d) => ({ time: d.time, value: d.close })));
    } else {
      priceSeries.setData(candleData);
    }
    volumeSeries.setData(volumeData);
    if (shouldFitContent) applyBarDensity();
    recomputeIndicatorData();
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
    if (replacement.trId) currentTrId = replacement.trId;
    // 주기가 바뀌면 과거 조회도 새 주기 기준으로 다시 시작한다 — 이전 주기에서
    // "더 없음"으로 잠갔다고 새 주기까지 잠그면 안 된다.
    historyExhausted = false;
    historyPending = false;
    historyFailures = 0;
    if (VALID_INITIAL_PERIODS.indexOf(replacement.period) !== -1) {
      currentPeriod = replacement.period;
      currentInterval = replacement.interval || 1;
      toolbar.setPeriod(currentPeriod, currentInterval, false);
    }
    dailyBars = Array.isArray(ohlcv) ? ohlcv.slice() : [];
    currentBars = dailyBars.slice();
    setData(currentBars);
    updateNote();
  }

  // 분·틱 세션이 바뀌면 직전 장의 봉을 축에서 빼야 한다. update()는 점을
  // 지울 수 없어 시리즈를 다시 깔고 새 장 폭에 맞춘다. applyChartTick 본문에
  // setData를 두면 AITS 틱 경로 잠금이 깨지므로 여기로 뺀다.
  function beginLatestIntradaySession(candle) {
    currentBars = [candle];
    dailyBars = dailyBars.concat([candle]);
    setData(currentBars);
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
      const prev = currentBars[currentBars.length - 1];
      if (prev && typeof prev.time === 'number' && typeof candle.time === 'number'
        && candle.time - prev.time > INTRADAY_SESSION_GAP_SEC) {
        beginLatestIntradaySession(candle);
        return true;
      }
      currentBars.push(candle);
      dailyBars.push(candle);
    } else {
      return false;
    }
    if (currentForm === 'line' || currentForm === 'area') priceSeries.update({ time: price.time, value: price.close });
    else priceSeries.update(price);
    if (volume) volumeSeries.update(volume);
    recomputeIndicatorData();
    requestAnimationFrame(() => {
      renderVolumeProfile();
      if (drawLayer) drawLayer.renderAll();
    });
    return true;
  }

  // 기본 on(이평선·거래량MA) 초기 적용 — 패널·데이터 로드보다 먼저 시리즈를
  // 만들어둬야 setData()가 첫 렌더에서 바로 채운다.
  applyIndicators();

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
      ? ['서버에서 조회한 차트 데이터']
      : ['서버 보정(upd_stkpc_tp) 미연결 — 목업 동일 데이터'];
    if (intradayUnavailable) parts.push(`${intradayUnavailable} — 일봉을 그대로 보여준다`);
    if (authoringStore.enabled) parts.push('차트 설정이 이 기기에 저장되었습니다');
    if (reloadFailure) {
      parts.push(reloadFailure === '재조회 8초 한도를 넘겼다' ? '재조회 시간 초과' : `재조회 실패 — ${reloadFailure}`);
    }
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
      const result = await withReloadDeadline(o.onReloadRequest(request));
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
    const { bars, unavailable } = resample(dailyBars, period, interval);
    currentBars = bars;
    intradayUnavailable = unavailable || null;
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

  let isFullscreen = false;

  function measureAndResize() {
    requestAnimationFrame(() => {
      const rect = priceWrap.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) chart.resize(rect.width, rect.height);
      // 봉 폭은 폭 독립이라 크기가 바뀌어도 다시 잡을 필요가 없다 — 보이는 봉 수만
      // 늘고 준다. 다만 사용자가 아직 뷰포트를 안 잡았으면 최신 봉에 다시 정렬한다
      // (폭 0에서 마운트된 경우 최초 정렬이 무의미했기 때문 — autoFitObserver 주석).
      if (!viewportPinned) applyBarDensity();
      if (volumeProfileOn) renderVolumeProfile();
    });
  }

  // 마운트 시점엔 카드가 아직 그리드에 배치되기 전이라 폭이 0이다(실측 2026-08-25:
  // t=300ms까지 0, t≈800ms에 970px). 폭 0에서 setData가 부른 fitContent는 폭 0
  // 기준으로 barSpacing을 잡고, 이후 폭이 커져도 라이브러리는 우측 끝을 기준으로
  // 유지하기 때문에 240봉이 오른쪽 15%에 뭉치고 나머지가 빈 칸으로 남았다.
  // 폭은 한 번에 확정되지 않으므로(0 → 중간값 → 최종) 폭이 바뀔 때마다 다시 맞춘다.
  // 단 사용자가 스크롤·줌으로 뷰포트를 잡은 뒤에는 건드리지 않는다 — 그때부터
  // 뷰포트는 사용자 것이고, 창 크기 변화가 그걸 되돌리면 안 된다.
  let viewportPinned = false;
  let lastFitWidth = -1;
  let autoFitObserver = null;
  const pinViewport = () => { viewportPinned = true; };
  priceWrap.addEventListener('wheel', pinViewport, { passive: true });
  priceWrap.addEventListener('pointerdown', pinViewport);
  if (typeof ResizeObserver !== 'undefined') {
    autoFitObserver = new ResizeObserver(() => {
      if (viewportPinned) return;
      const width = Math.round(priceWrap.getBoundingClientRect().width);
      if (width <= 0 || width === lastFitWidth) return; // 같은 폭 재진입 = 관측 루프
      lastFitWidth = width;
      measureAndResize();
    });
    autoFitObserver.observe(priceWrap);
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
    if (autoFitObserver) { autoFitObserver.disconnect(); autoFitObserver = null; }
    priceWrap.removeEventListener('wheel', pinViewport);
    priceWrap.removeEventListener('pointerdown', pinViewport);
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

  return { chart, setForm, setData, replaceData, prependData, applyChartTick, applyPeriod, applyAdjusted, toggleFullscreen, destroy };
}

const __exports = {
  createChartCard,
  createCachedChartLibraryLoader,
  renderNowAndOnNextFrame,
  withReloadDeadline,
  RELOAD_DEADLINE_MS,
  RELOAD_DEADLINE_ERROR,
  resolveInitialPeriod,
  toCandleSeriesData,
  toVolumeSeriesData,
  clipIntradayToLatestSession,
  INTRADAY_SESSION_GAP_SEC,
  withAlpha,
  formatVolumeKo,
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
