'use strict';

const boardFormat = (typeof module !== 'undefined' && module.exports)
  ? require('./board-format')
  : (typeof window !== 'undefined' && window.AthenaLib && window.AthenaLib.BoardFormat);

const CARD_SIZE = Object.freeze({ width: 360, height: 420 });

// 키우미 미니 카드의 결정 로직 (Paper 키우미 보드 09 · 2026-09-01).
//
// 오브는 자기 화면을 가진다 — 360×420 고정 카드라 캔버스 카드를 그대로
// 못 들인다. 보드 09가 캔버스 9종(table·chart·facts·compound·event·action·
// status·reader·stream)을 미니 10종으로 받는 상한과 공통 규칙을 확정했고,
// 이 파일은 그중 **무엇을 보여주고 무엇을 접을지**만 정한다. DOM은 orb.js가
// 짓는다(그쪽은 createElement/textContent만 쓴다 — innerHTML 0건).
//
// 순수 함수만 둔 이유는 column-fold.js·facts-card.js와 같다: 상한과 고지 문구는
// 정직성 계약이라 회귀가 나면 안 되는데, DOM에 묻어두면 단위 테스트로 못 고정한다.
//
// 보드 09 공통 규칙 5가지가 여기 전부 들어 있다:
//   1. 값을 짓지 않는다   — hasValue로 걸러 행 자체를 안 만든다.
//   2. 접었으면 밝힌다     — 실제로 접었을 때만 개수를 낸다(0개 고지 금지).
//   3. 실행은 05 하나      — 여기에는 액션이 없다(주문 티켓은 orb.js 전용 경로).
//   4. 축소판이 아니다     — 캔버스 16종 렌더러를 참조하지 않는다.
//   5. innerHTML 0건       — 이 파일은 문자열만 돌려주고 마크업을 만들지 않는다.

/** 보드 09 상한표. 숫자를 바꾸면 보드 09의 상한표도 같이 바꿔야 한다. */
const LIMITS = Object.freeze({
  tableRows: 3,        // 표 — 헤더 제외 3행
  factsRows: 5,        // 사실 — 라벨·값 5행
  compoundScalars: 3,  // 복합 — 스칼라 밴드 3개
  compoundRows: 2,     // 복합 — 표 2행
  logRecords: 2,       // 이벤트·스트림 — 2건
  readerChars: 140,    // 본문 — 3줄 상당
});

/** 빈 값 판정. null·undefined·빈 문자열만 없는 값이다 — 0과 false는 값이다
 * (0을 지우면 "측정했는데 값이 없다"가 아니라 "0이다"라는 사실이 사라진다). */
function hasValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function fieldHasValue(field) {
  return !!field && hasValue(field.value);
}

function slotValueMap(surfaceContract) {
  const raw = surfaceContract && (surfaceContract.slot_values || surfaceContract.slotValues);
  if (Array.isArray(raw)) {
    return new Map(raw.filter((entry) => entry && entry.slot_id).map((entry) => [entry.slot_id, entry]));
  }
  if (raw && typeof raw === 'object') {
    return new Map(Object.entries(raw).map(([slotId, value]) => [slotId, { slot_id: slotId, value }]));
  }
  return new Map();
}

/**
 * 백엔드 표면 계약에서 카드별 고정 표시 계획을 만든다. ``paper_text``는 승인 증거일
 * 뿐 런타임 값으로 쓰지 않는다. 선택 슬롯이 이번 응답에 없으면 반드시 ``미제공``을
 * 표시해 Paper 예시값을 실제 조회값처럼 보이는 일을 막는다.
 */
function buildKiumiPlan(surfaceContract) {
  const spec = surfaceContract && surfaceContract.kiumi;
  if (!spec || spec.version !== 1 || spec.fixed !== true) return null;
  if (spec.width_px !== CARD_SIZE.width || spec.height_px !== CARD_SIZE.height) return null;
  if (!Array.isArray(spec.elements) || !spec.elements.length || !boardFormat) return null;
  const values = slotValueMap(surfaceContract);
  const elements = spec.elements.map((element) => {
    const slotId = element.source_slot_id;
    const entry = values.get(slotId);
    const format = (element.format && typeof element.format === 'object')
      ? element.format
      : ((entry && entry.format) || {});
    const formatted = boardFormat.formatSlot(format, entry ? entry.value : undefined);
    return {
      slotId,
      label: String(element.label || ''),
      role: String(element.role || 'fact'),
      band: String(element.band || 'scalar'),
      text: formatted.text,
      tone: formatted.tone || null,
      missing: formatted.missing === true,
    };
  });
  return {
    boardId: String(surfaceContract.board_id || ''),
    cardId: String(surfaceContract.card_id || ''),
    grammar: String(spec.grammar || ''),
    title: String(spec.title || ''),
    eyebrow: String(spec.eyebrow || ''),
    width: CARD_SIZE.width,
    height: CARD_SIZE.height,
    elements,
    foldNote: typeof spec.fold_note === 'string' && spec.fold_note ? spec.fold_note : null,
  };
}

/** 리스트 상한 적용의 공통 형태. 접힌 개수는 **보인 뒤 남은 것**만 센다. */
function takeWithRest(items, limit) {
  const list = Array.isArray(items) ? items : [];
  const shown = list.slice(0, limit);
  return { shown, hidden: Math.max(0, list.length - shown.length), total: list.length };
}

/** 사실(facts) — 값이 있는 필드만 5행까지. 값 없는 필드는 접힌 개수에도 안 든다
 * (없는 것을 "접었다"고 하면 그것도 지어낸 수다). */
function pickFactsRows(fields) {
  const present = (Array.isArray(fields) ? fields : []).filter(fieldHasValue);
  return takeWithRest(present, LIMITS.factsRows);
}

/** 복합(compound) — 스칼라 밴드와 표를 각각 따로 접는다. */
function pickCompound(header, rows) {
  const scalars = takeWithRest((Array.isArray(header) ? header : []).filter(fieldHasValue), LIMITS.compoundScalars);
  const table = takeWithRest(rows, LIMITS.compoundRows);
  return { scalars, table };
}

/** 이벤트·스트림 — 최근 2건. */
function pickLogRecords(records) {
  return takeWithRest(records, LIMITS.logRecords);
}

/** 본문(reader) — 첫 문단만, 그것도 140자까지. 마크다운을 해석하지 않으므로
 * 줄머리 기호만 벗겨 한 줄로 잇는다(오브에는 마크다운 렌더러가 없다). */
function clampReaderBody(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const total = text.length;
  const firstBlock = text.split(/\n{2,}/).find((block) => block.trim().length > 0) || '';
  const flattened = firstBlock
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[#>*\-+]+\s*|\d+\.\s+)/, '').trim())
    .filter(Boolean)
    .join(' ');
  if (!flattened) return { text: '', clipped: false, total };
  if (flattened.length <= LIMITS.readerChars && flattened.length === total) {
    return { text: flattened, clipped: false, total };
  }
  const cut = flattened.slice(0, LIMITS.readerChars);
  return {
    text: flattened.length > LIMITS.readerChars ? `${cut}…` : flattened,
    clipped: true,
    total,
  };
}

/** 이벤트 한 건을 한 줄로. 캔버스는 5쌍까지 붙이지만 360px에서는 3쌍이 상한이다. */
function recordLine(record) {
  if (typeof record === 'string') return record;
  if (!record || typeof record !== 'object') return '';
  return Object.entries(record)
    .filter(([, value]) => hasValue(value))
    .slice(0, 3)
    .map(([key, value]) => `${key} ${value}`)
    .join(' · ');
}

/** 스트림 시각 — canvas.js formatRecordTs와 같은 규칙이다. day 정밀도에서
 * 없는 시:분을 지어내지 않는다. */
function formatStreamTime(ts, precision) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  if (precision === 'day') return `${mm}.${dd}`;
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}.${dd} ${hh}:${mi}`;
}

/** 스트림 출처 — source가 없으면 url의 호스트만. 둘 다 없으면 빈 문자열이고,
 * 그 경우 orb.js가 출처 줄 자체를 만들지 않는다. */
function streamSource(record) {
  if (!record || typeof record !== 'object') return '';
  if (hasValue(record.source)) return String(record.source);
  if (!hasValue(record.url)) return '';
  try {
    return new URL(String(record.url)).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** 접힘 고지 문구 — 실제로 접었을 때만 문자열을 돌려준다. 아무것도 안 접혔으면
 * null이고, 호출부는 null이면 고지 자체를 안 만든다(보드 09 규칙 2). */
function foldNote(kind, counts = {}) {
  const { columns = 0, rows = 0, items = 0, scalars = 0, total = 0, shown = 0 } = counts;
  if (kind === 'table') {
    if (columns <= 0 && rows <= 0) return null;
    return `열 ${columns}개 · 행 ${rows}개를 접었습니다 — 전체는 캔버스에서`;
  }
  if (kind === 'facts') {
    if (items <= 0) return null;
    return `항목 ${items}개를 접었습니다 — 전체는 캔버스에서`;
  }
  if (kind === 'compound') {
    if (scalars <= 0 && rows <= 0) return null;
    return `스칼라 ${scalars}개 · 행 ${rows}개를 접었습니다 — 전체는 캔버스에서`;
  }
  if (kind === 'log') {
    if (total <= shown) return null;
    return `최근 ${shown}건 · ${total}건 중 — 전체는 캔버스에서`;
  }
  if (kind === 'reader') {
    if (total <= 0) return null;
    return `첫 문단만 · 전문 ${total}자는 캔버스에서`;
  }
  return null;
}

const __exports = {
  CARD_SIZE,
  LIMITS,
  hasValue,
  fieldHasValue,
  pickFactsRows,
  pickCompound,
  pickLogRecords,
  clampReaderBody,
  recordLine,
  formatStreamTime,
  streamSource,
  foldNote,
  buildKiumiPlan,
};

// UMD 각주 — facts-card.js와 같은 패턴(렌더러 격리).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.OrbMiniCard = __exports;
}
