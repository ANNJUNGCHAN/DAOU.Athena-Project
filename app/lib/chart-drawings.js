// IIFE 스코프 격리(2026-08-18 렌더러 격리) — <script> 태그는 top-level const/function을
// 문서 전체가 공유하는 하나의 스크립트 스코프에 넣는다(require()의 모듈별 격리와 다르다).
// el/sanitize 같은 흔한 이름이 파일 간에 충돌해 SyntaxError가 났다(실측, diag-isolation.js).
// CJS(require)는 이 IIFE 밖에서도 동일하게 동작한다 — Node의 모듈 래퍼가 이미 함수 스코프다.
(function () {
'use strict';


const DRAW_COLOR = '#2962FF';

// 도구 7종 — 구현 여부 포함(§5 표 순서 그대로).
const DRAW_TOOLS = [
  { id: 'crosshair', label: '+', title: '십자선 — 미구현(후속 라운드)', implemented: false },
  { id: 'trend', label: '/', title: '추세선 — 2클릭(첫 점 후 미리보기)', implemented: true },
  { id: 'ray', label: '↗', title: '광선 — 미구현(후속 라운드)', implemented: false },
  { id: 'hline', label: '—', title: '수평선 — 1클릭 즉시 확정', implemented: true },
  { id: 'rect', label: '▭', title: '사각형 — 미구현(후속 라운드)', implemented: false },
  { id: 'ellipse', label: '◯', title: '타원 — 미구현(후속 라운드)', implemented: false },
  { id: 'fibo', label: 'F', title: '피보나치 — 미구현(후속 라운드)', implemented: false },
];

// ---------- 순수 모델 (DOM 없이 테스트 가능) ----------
function emptyDrawings() {
  return { hlines: [], lines: [] };
}

let idSeq = 0;
function nextId(prefix) {
  idSeq += 1;
  return `${prefix}-${idSeq}`;
}

// 저장 스키마 검증 — 손상 항목은 조용히 버리지 않고 개수 차이로 알 수 있게
// 유효 항목만 돌려준다(정보 정직성: 렌더는 유효분만, 저장은 유효분만 유지).
function sanitizeDrawings(raw) {
  const out = emptyDrawings();
  if (!raw || typeof raw !== 'object') return out;
  for (const h of Array.isArray(raw.hlines) ? raw.hlines : []) {
    if (h && Number.isFinite(Number(h.price))) out.hlines.push({ id: String(h.id || nextId('h')), price: Number(h.price) });
  }
  for (const l of Array.isArray(raw.lines) ? raw.lines : []) {
    const ok = l && l.a && l.b && l.a.time != null && l.b.time != null
      && Number.isFinite(Number(l.a.price)) && Number.isFinite(Number(l.b.price));
    if (ok) {
      out.lines.push({
        id: String(l.id || nextId('t')),
        a: { time: l.a.time, price: Number(l.a.price) },
        b: { time: l.b.time, price: Number(l.b.price) },
      });
    }
  }
  return out;
}

// 데이터 좌표 → 픽셀 세그먼트. 변환기(toX/toY)는 주입 — 테스트는 선형 함수를 쓴다.
// 화면 밖(변환 불가) 점이 하나라도 있으면 null(렌더 생략).
function projectLine(line, toX, toY) {
  const x1 = toX(line.a.time);
  const y1 = toY(line.a.price);
  const x2 = toX(line.b.time);
  const y2 = toY(line.b.price);
  if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
  return { x1, y1, x2, y2 };
}

// ---------- DOM 계층 (chart-card.js가 마운트) ----------
// deps: { chart, getPriceSeries(), container(priceWrap), onChange() }.
// 반환: { toolbar, setEnabled(bool), setTool(id), load(raw), toJSON(),
//         reattachPriceLines(), renderAll(), destroy() }.
function createDrawingLayer(deps) {
  const { chart, getPriceSeries, container, onChange } = deps;

  let enabled = false; // 확장 모드에서만 true
  let tool = null; // null | 'hline' | 'trend'
  let drawings = emptyDrawings();
  let pending = null; // 추세선 첫 점 {time, price}
  let priceLineHandles = []; // [{id, handle}] — 현재 priceSeries에 붙인 수평선들

  // 좌측 세로 도구바(§5 — 42px, 확장 모드에서만 보임).
  const toolbar = document.createElement('div');
  toolbar.className = 'chart-drawbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', '드로잉 도구');
  const toolBtns = {};
  for (const def of DRAW_TOOLS.filter((candidate) => candidate.implemented)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chart-drawbar-btn' + (def.implemented ? '' : ' is-unimplemented');
    b.textContent = def.label;
    b.title = def.title;
    b.setAttribute('aria-label', def.title);
    if (!def.implemented) b.disabled = true;
    else b.addEventListener('click', () => setTool(tool === def.id ? null : def.id));
    toolbar.appendChild(b);
    toolBtns[def.id] = b;
  }

  // 추세선 SVG 오버레이 — pointer-events:none(차트 조작을 가로채지 않는다).
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'chart-draw-svg');
  container.appendChild(svg);

  function setTool(next) {
    tool = next;
    pending = null;
    for (const id of Object.keys(toolBtns)) toolBtns[id].classList.toggle('is-active', id === tool);
    renderAll();
  }

  function setEnabled(on) {
    enabled = !!on;
    toolbar.classList.toggle('is-visible', enabled);
    if (!enabled) {
      // 복귀 시 미완성 점 폐기·저장 목록 보존(§5·§7).
      pending = null;
      setTool(null);
    }
  }

  // ---- 수평선: 네이티브 priceLine — 시리즈 재생성(형식 전환) 때마다 다시 붙인다.
  function reattachPriceLines() {
    priceLineHandles = [];
    const series = getPriceSeries();
    if (!series) return;
    for (const h of drawings.hlines) {
      const handle = series.createPriceLine({
        price: h.price,
        color: DRAW_COLOR,
        lineWidth: 2,
        axisLabelVisible: true,
        title: '',
      });
      priceLineHandles.push({ id: h.id, handle });
    }
  }

  function clearPriceLines() {
    const series = getPriceSeries();
    if (series) for (const { handle } of priceLineHandles) series.removePriceLine(handle);
    priceLineHandles = [];
  }

  // ---- 추세선: SVG 재투영 렌더.
  function renderAll() {
    svg.replaceChildren();
    const series = getPriceSeries();
    if (!series) return;
    const toX = (t) => chart.timeScale().timeToCoordinate(t);
    const toY = (p) => series.priceToCoordinate(p);
    const lines = pending
      ? drawings.lines.concat([{ id: 'pending', a: pending, b: pending.preview || pending }])
      : drawings.lines;
    for (const line of lines) {
      const seg = projectLine(line, toX, toY);
      if (!seg) continue;
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      el.setAttribute('x1', seg.x1);
      el.setAttribute('y1', seg.y1);
      el.setAttribute('x2', seg.x2);
      el.setAttribute('y2', seg.y2);
      el.setAttribute('stroke', DRAW_COLOR);
      el.setAttribute('stroke-width', '2');
      el.setAttribute('stroke-linecap', 'round');
      if (line.id === 'pending') el.setAttribute('stroke-dasharray', '4 4');
      svg.appendChild(el);
    }
  }

  // ---- 클릭 → 데이터 좌표. param.time은 봉 밖이면 undefined — 그 클릭은 무시
  // (조용한 좌표 발명 금지).
  function onChartClick(param) {
    // probe 전용 디버그 훅 — 프로덕션 경로에는 영향 없다(window.__drawDebug가
    // 있을 때만 기록). 실측 없이는 원인을 못 잡는 종류의 상호작용이라 남겨둔다.
    if (typeof window !== 'undefined' && Array.isArray(window.__drawDebug)) {
      window.__drawDebug.push({ enabled, tool, hasPoint: !!(param && param.point), time: param ? param.time : undefined, hasPending: !!pending });
    }
    if (!enabled || !tool || !param || !param.point || param.time == null) return;
    const series = getPriceSeries();
    if (!series) return;
    const price = series.coordinateToPrice(param.point.y);
    if (price == null || !Number.isFinite(price)) return;
    if (tool === 'hline') {
      drawings.hlines.push({ id: nextId('h'), price });
      clearPriceLines();
      reattachPriceLines();
      onChange && onChange();
    } else if (tool === 'trend') {
      if (!pending) {
        pending = { time: param.time, price };
      } else {
        drawings.lines.push({ id: nextId('t'), a: { time: pending.time, price: pending.price }, b: { time: param.time, price } });
        pending = null;
        onChange && onChange();
      }
      renderAll();
    }
  }

  function onCrosshairMove(param) {
    if (!pending || !param || !param.point || param.time == null) return;
    const series = getPriceSeries();
    if (!series) return;
    const price = series.coordinateToPrice(param.point.y);
    if (price == null) return;
    pending.preview = { time: param.time, price };
    renderAll();
  }

  function onEscape(e) {
    if (e.key === 'Escape' && pending) {
      pending = null;
      renderAll();
    }
  }

  chart.subscribeClick(onChartClick);
  chart.subscribeCrosshairMove(onCrosshairMove);
  chart.timeScale().subscribeVisibleLogicalRangeChange(renderAll);
  document.addEventListener('keydown', onEscape, true);

  function load(raw) {
    drawings = sanitizeDrawings(raw);
    clearPriceLines();
    reattachPriceLines();
    renderAll();
  }

  function toJSON() {
    return { hlines: drawings.hlines.slice(), lines: drawings.lines.slice() };
  }

  function destroy() {
    document.removeEventListener('keydown', onEscape, true);
    if (svg.parentElement) svg.remove();
    if (toolbar.parentElement) toolbar.remove();
  }

  return { toolbar, setEnabled, setTool, load, toJSON, reattachPriceLines, renderAll, destroy };
}

const __exports = {
  createDrawingLayer,
  sanitizeDrawings,
  projectLine,
  DRAW_TOOLS,
};

// UMD 각주(2026-08-18 렌더러 격리) — sanitize.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.ChartDrawings = __exports;
}

})();
