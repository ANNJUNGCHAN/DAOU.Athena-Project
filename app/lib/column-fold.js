// IIFE 스코프 격리(2026-08-18 렌더러 격리) — <script> 태그는 top-level const/function을
// 문서 전체가 공유하는 하나의 스크립트 스코프에 넣는다(require()의 모듈별 격리와 다르다).
// el/sanitize 같은 흔한 이름이 파일 간에 충돌해 SyntaxError가 났다(실측, diag-isolation.js).
// CJS(require)는 이 IIFE 밖에서도 동일하게 동작한다 — Node의 모듈 래퍼가 이미 함수 스코프다.
(function () {

const HANGUL_SYMBOL_CHAR_WIDTH_PX = 14;
const ASCII_DIGIT_CHAR_WIDTH_PX = 8;
const COLUMN_PADDING_PX = 24;
const DATA_CELL_MIN_WIDTH_PX = 90;
const DEFAULT_CANVAS_WIDTH_PX = 1560;

function labelPixelWidth(label) {
  let width = 0;
  for (const ch of String(label || '')) {
    width += ch.charCodeAt(0) <= 127 ? ASCII_DIGIT_CHAR_WIDTH_PX : HANGUL_SYMBOL_CHAR_WIDTH_PX;
  }
  return width;
}

function columnPixelWidth(label) {
  return Math.max(labelPixelWidth(label), DATA_CELL_MIN_WIDTH_PX) + COLUMN_PADDING_PX;
}

function foldColumns(columns, canvasWidthPx = DEFAULT_CANVAS_WIDTH_PX) {
  const list = Array.isArray(columns) ? columns : [];
  const visible = [];
  const hidden = [];
  let accumulatedPx = 0;
  for (const column of list) {
    const label = column && (column.label != null ? column.label : column.key);
    const width = columnPixelWidth(label);
    if (visible.length === 0 || accumulatedPx + width <= canvasWidthPx) {
      visible.push(column);
      accumulatedPx += width;
    } else {
      hidden.push(column);
    }
  }
  return { visible, hidden, canvasWidthPx, usedPx: accumulatedPx };
}

const __exports = {
  foldColumns,
  columnPixelWidth,
  labelPixelWidth,
  DEFAULT_CANVAS_WIDTH_PX,
  HANGUL_SYMBOL_CHAR_WIDTH_PX,
  ASCII_DIGIT_CHAR_WIDTH_PX,
  COLUMN_PADDING_PX,
  DATA_CELL_MIN_WIDTH_PX,
};

// UMD 각주(2026-08-18 렌더러 격리) — sanitize.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.ColumnFold = __exports;
}

})();
