// §5.3.1 table 컬럼 우선순위 — 표시 시(렌더러) 절반.
// backend/scripts/generate_api.py가 생성 시(백엔드) column_priority 랭킹을
// kiwoom-common-screen-manifest.json에 굽는다(식별 컬럼 고정 + 실측 alias 빈도
// tie-break, plan/kiwoom-common-template-fit-dissonance-plan.md §5.3.1). 이 모듈은
// 그 순서를 그대로 소비해 1560px 캔버스 안에서 스크롤 없이 보이는 컬럼 범위를
// 결정적으로 접는다(fold) — 우선순위를 다시 계산하지 않는다.
//
// 픽셀폭 가정은 backend/ref/width-anchor-pixel-calibration.json과 동일해야
// 이중 확인이 일관된다: 한글/기호 14px, ASCII/숫자 8px, 컬럼 padding 24px,
// 데이터 셀 최소폭 90px. ui/palette.md에 표 셀 전용 px 값이 없어 팀리드 지시의
// 가정값을 그대로 채택한다(위 calibration 파일의 assumptions.note 참고).

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

// columns는 이미 §5.3.1 우선순위 순서로 들어온다고 가정한다(식별 컬럼 먼저,
// 나머지는 alias 빈도 내림차순) — 이 함수는 순서를 만들지 않고 그 순서 위에서
// 픽셀 폭을 누적해 접을 뿐이다. 우선순위 상위부터 누적폭이 canvasWidthPx를
// 넘기기 전까지가 visible, 그 뒤가 hidden(§5.3.1 "우선순위 상위 컬럼부터
// 픽셀 폭 추정 누적, 1560px 초과 시부터 fold"). 첫 컬럼 하나만으로 이미
// canvasWidthPx를 넘는 극단값이라도 빈 테이블을 보여주지 않도록 최소 1개는
// visible로 남긴다(정보 정직성, ui/soul.md §8 — 접힌 컬럼 수는 항상 정직하게
// 노출하되 화면 자체를 비우지는 않는다).
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

module.exports = {
  foldColumns,
  columnPixelWidth,
  labelPixelWidth,
  DEFAULT_CANVAS_WIDTH_PX,
  HANGUL_SYMBOL_CHAR_WIDTH_PX,
  ASCII_DIGIT_CHAR_WIDTH_PX,
  COLUMN_PADDING_PX,
  DATA_CELL_MIN_WIDTH_PX,
};
