// 차트 카드(CC-101 + CC-102) — CompoundCard(charts) 위 시계열 렌즈의 첫 렌더러.
// 계약: plan/chart-card-control-spec.md(컨트롤 실측) · plan/chart-lens-spec.md §4·§6
// (저작 계층, 카드 신설 없음 — 이 파일은 makeCard('chart', …) 하나를 추가할 뿐
// 새 카드 종류를 만들지 않는다).
//
// CC-101 범위: 캔들 차트 본체 + 거래량 하위 pane. CC-102가 이 라운드에서
// 얹은 것: 툴바(§0 — 주기 탭·세분·차트모양·수정주가·전체화면), 주기별 실제
// 재샘플(lib/chart-resample.js), 전체화면(카드가 그리드를 전체 점유 — §7의
// OS position:fixed 전체화면과 다른 "두 창 원칙" 적응, 아래 toggleFullscreen
// 참고). 보조지표(§3)·매물대(§4)·드로잉(§5)·크로스헤어 수치조회창(§8)은 이
// 라운드에도 포함하지 않는다 — 툴바에 ∿ 자리만 비활성 버튼으로 남겨 CC-103이
// 확장하게 한다.
//
// lightweight-charts 5.2.1은 ESM 전용(exports 필드에 "require" 조건 없음,
// package.json 실측: `"exports": {".": {"...": {"import": "..."}}}`). 이 앱은
// CommonJS(require) 관례를 쓰므로(canvas.js 등) 정적 require로 못 부른다 —
// Node/Electron(nodeIntegration:true) 양쪽에서 CJS 모듈 안의 동적 import()는
// 지원된다(실측: `node -e "(async()=>{await import('lightweight-charts')})()"`
// 정상 동작, Object.keys에 createChart/CandlestickSeries/HistogramSeries 확인됨).
// 그래서 createChartCard는 async 함수이고, 로드는 지연 import로 처리한다.
//
// 좌하단에 뜨는 작은 로고는 버그가 아니다 — lightweight-charts Apache-2.0 라이선스가
// 요구하는 TradingView attribution(layout.attributionLogo, 기본 true)이다.
// 실측으로 확인(probe-chart-card.js 캡처, elementFromPoint로 캔버스 픽셀임을
// 확인 — DOM 오버레이가 아니다). 대체 표기 없이 끄면 라이선스 위반이라 그대로 둔다.

const { createChartToolbar } = require('./chart-toolbar');
const { resample } = require('./chart-resample');

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

// ---------- 카드 마운트 (DOM 필요) ----------
// container: 카드 본문 DOM 노드(canvas.js의 chartBody — .chart-card-body).
// opts: {symbol, name, ohlcv}. ohlcv는 항상 일봉(D) 배열로 받는다 — 주/월/년/
// 분/틱은 이 함수 안에서 chart-resample.js로 그때그때 파생한다(원본 일봉은
// 절대 버리지 않는다, 주기 전환을 몇 번 오가도 정밀도 손실이 없다).
// 반환: {chart, setForm(candle|bar|line|area), setData(ohlcv), destroy}.
async function createChartCard(container, opts) {
  const o = opts || {};
  const { createChart, CandlestickSeries, BarSeries, LineSeries, AreaSeries, HistogramSeries, CrosshairMode } =
    await import('lightweight-charts');

  const dailyBars = Array.isArray(o.ohlcv) ? o.ohlcv : [];

  const toolbar = createChartToolbar({
    initial: { period: 'D', interval: 1, form: 'candle', adjusted: true },
    callbacks: {
      onPeriodChange: (period, interval) => applyPeriod(period, interval),
      onFormChange: (form) => setForm(form),
      onAdjustedToggle: (adjustedOn) => applyAdjusted(adjustedOn),
      onFullscreenToggle: () => toggleFullscreen(),
    },
  });
  container.appendChild(toolbar.element);

  const adjustedNote = document.createElement('div');
  adjustedNote.className = 'fin-meta chart-mock-note';
  container.appendChild(adjustedNote);

  const priceWrap = document.createElement('div');
  priceWrap.className = 'chart-price-pane';
  container.appendChild(priceWrap);

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
  let currentPeriod = 'D';
  let currentInterval = 1;
  let currentAdjusted = true;
  let currentMockResample = false;
  let currentBars = dailyBars;
  let priceSeries = null;
  let volumeSeries = null;

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

  function setData(ohlcv) {
    const candleData = toCandleSeriesData(ohlcv);
    const volumeData = toVolumeSeriesData(ohlcv);
    if (currentForm === 'line' || currentForm === 'area') {
      priceSeries.setData(candleData.map((d) => ({ time: d.time, value: d.close })));
    } else {
      priceSeries.setData(candleData);
    }
    volumeSeries.setData(volumeData);
    chart.timeScale().fitContent();
  }

  function setForm(form) {
    if (!SERIES_DEFS[form]) return;
    currentForm = form;
    buildPriceSeries(form);
    if (currentBars && currentBars.length) setData(currentBars);
  }

  // 정직 표기(fin-meta 관례) — 수정주가는 백엔드 미연결이라 토글해도 실제
  // 서버 보정값이 오지 않는다(§6). 분/틱은 일봉에서 만든 결정적 의사 재샘플이다
  // (chart-resample.js). 둘 다 항상 정확한 현재 상태를 보여준다 — 토글 직후만
  // 반짝하고 사라지는 표기가 아니다(soul.md §8 정보 정직성).
  function updateNote() {
    const parts = ['서버 보정(upd_stkpc_tp) 미연결 — 목업 동일 데이터'];
    if (currentMockResample) parts.push('분/틱은 일봉에서 만든 결정적 의사 재샘플 — 실제 장중 분포 아님');
    adjustedNote.textContent = parts.join(' · ');
  }

  // 주기 탭·세분 전환 — 원본 일봉(dailyBars)에서 매번 새로 파생한다(누적 오차 없음).
  function applyPeriod(period, interval) {
    currentPeriod = period;
    currentInterval = interval;
    const { bars, mock } = resample(dailyBars, period, interval);
    currentBars = bars;
    currentMockResample = mock;
    setData(currentBars);
    updateNote();
  }

  // 수정주가 토글 — §6: 클라이언트 보정 계산 없음, 서버가 보정 시계열을 준다.
  // 이 앱은 백엔드 미연결이라 "재조회"를 같은 파이프라인 재실행으로 흉내만
  // 내고(mock 재로드), 그 사실을 note에 정직하게 남긴다.
  function applyAdjusted(adjustedOn) {
    currentAdjusted = adjustedOn;
    applyPeriod(currentPeriod, currentInterval);
  }

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
    // 진입·복귀 둘 다 재측정한다 — 복귀만 요구되지만(§7) 그리드 점유 진입도
    // 카드 높이가 바뀌는 순간이라 같은 처리가 필요하다(실측: 진입 직후에도
    // autoSize의 ResizeObserver가 트랜지션 중간값을 잡아 캔버스가 찌그러짐).
    measureAndResize();
  }

  function destroy() {
    toolbar.destroy();
    const card = container.closest('.card');
    const grid = container.closest('.grid');
    if (card) card.classList.remove('is-expanded');
    if (grid) grid.classList.remove('has-expanded');
    chart.remove();
    if (priceWrap.parentElement) priceWrap.remove();
  }

  return { chart, setForm, setData, applyPeriod, applyAdjusted, toggleFullscreen, destroy };
}

module.exports = {
  createChartCard,
  toCandleSeriesData,
  toVolumeSeriesData,
  withAlpha,
  UP_COLOR,
  DOWN_COLOR,
  NAVY_COLOR,
  GRID_COLOR,
  CROSSHAIR_COLOR,
  AXIS_TEXT_COLOR,
  PRICE_FORMAT,
};
