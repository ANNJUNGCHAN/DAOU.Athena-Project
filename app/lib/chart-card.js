// 차트 카드(CC-101) — CompoundCard(charts) 위 시계열 렌즈의 첫 렌더러.
// 계약: plan/chart-card-control-spec.md(컨트롤 실측) · plan/chart-lens-spec.md §4·§6
// (저작 계층, 카드 신설 없음 — 이 파일은 makeCard('chart', …) 하나를 추가할 뿐
// 새 카드 종류를 만들지 않는다).
//
// 1판 범위(CC-101): 캔들 차트 본체 + 거래량 하위 pane만 실동작. 툴바(§0, CC-102
// 소관)·보조지표(§3)·매물대(§4)·드로잉(§5)·수정주가(§6)·전체화면(§7)·크로스헤어
// 수치조회창(§8)은 이 라운드에 포함하지 않는다 — setForm 자리만 남겨 CC-102가
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

const UP_COLOR = '#FF5C5C';
const DOWN_COLOR = '#4D9FFF';
const GRID_COLOR = 'rgba(120,128,140,0.12)';
const CROSSHAIR_COLOR = 'rgba(120,128,140,0.6)';
const AXIS_TEXT_COLOR = '#6B7480';

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
// container: 카드 본문 DOM 노드. opts: {symbol, name, ohlcv}.
// 반환: {chart, setForm(candle|bar|line|area), setData(ohlcv), destroy}.
// setForm은 1판에서 candle만 실동작하고 나머지는 자리만 예약한다(§2, CC-102 확장).
async function createChartCard(container, opts) {
  const o = opts || {};
  const { createChart, CandlestickSeries, BarSeries, LineSeries, AreaSeries, HistogramSeries, CrosshairMode } =
    await import('lightweight-charts');

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
  let priceSeries = null;
  let volumeSeries = null;

  function buildPriceSeries(form) {
    if (priceSeries) {
      chart.removeSeries(priceSeries);
      priceSeries = null;
    }
    const def = SERIES_DEFS[form] || SERIES_DEFS.candle;
    if (form === 'candle') {
      priceSeries = chart.addSeries(def, {
        upColor: UP_COLOR,
        downColor: DOWN_COLOR,
        borderUpColor: UP_COLOR,
        borderDownColor: DOWN_COLOR,
        wickUpColor: UP_COLOR,
        wickDownColor: DOWN_COLOR,
        borderVisible: true,
      });
    } else if (form === 'bar') {
      priceSeries = chart.addSeries(def, { upColor: UP_COLOR, downColor: DOWN_COLOR });
    } else {
      // line/area — 1판은 자리만 예약(CC-102가 실동작 확장). candle과 같은
      // 데이터를 넣으면 lightweight-charts가 종가만 뽑아 그린다.
      priceSeries = chart.addSeries(def, { color: UP_COLOR, lineColor: UP_COLOR, topColor: withAlpha(UP_COLOR, 0.3), bottomColor: withAlpha(UP_COLOR, 0) });
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
    if (o.ohlcv) setData(o.ohlcv);
  }

  if (o.ohlcv) setData(o.ohlcv);

  function destroy() {
    chart.remove();
    if (priceWrap.parentElement) priceWrap.remove();
  }

  return { chart, setForm, setData, destroy };
}

module.exports = {
  createChartCard,
  toCandleSeriesData,
  toVolumeSeriesData,
  withAlpha,
  UP_COLOR,
  DOWN_COLOR,
  GRID_COLOR,
  CROSSHAIR_COLOR,
  AXIS_TEXT_COLOR,
};
