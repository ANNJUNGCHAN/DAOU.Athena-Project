// IIFE 스코프 격리 — facts-card.js/ranking-axis.js와 같은 이유(렌더러 스크립트 스코프 공유).
(function () {
'use strict';

// facts-card.js의 포맷터를 그대로 재사용한다(헌장 신념 6 "숫자 규칙"의 단일 출처).
// 브라우저에서는 shell.html이 facts-card.js를 먼저 싣고, node --test에서는 require.
const factsCard = (typeof module !== 'undefined' && module.exports)
  ? require('./facts-card')
  : (typeof window !== 'undefined' && window.AthenaLib && window.AthenaLib.FactsCard);

// 결측어 3종(헌장 신념 5) — 0으로 위장하지 않고, 서로 구분한다.
const MISSING_TEXT = Object.freeze({
  unavailable: '미제공',
  pending: '집계 전',
  not_applicable: '해당 없음',
});
const DEFAULT_MISSING = 'unavailable';

// 한국어 만 단위 사다리(헌장 신념 10 "한국어 단위"). 천은 만 미만 구간의 표기이지
// 자리 묶음이 아니므로 사다리에 넣지 않는다 — 천 단위로 들어오는 응답은
// format.scale='천'으로 값을 올려 받는다.
const MYRIAD_LADDER = Object.freeze([
  Object.freeze({ unit: '조', size: 1000000000000 }),
  Object.freeze({ unit: '억', size: 100000000 }),
  Object.freeze({ unit: '만', size: 10000 }),
  Object.freeze({ unit: '', size: 1 }),
]);
const SCALE_FACTOR = Object.freeze({ 천: 1000, 만: 10000, 백만: 1000000, 억: 100000000, 조: 1000000000000 });

// 한 표기에 쓰는 자리 묶음 수 — 상위 2묶음이면 판단이 바뀌지 않는다(헌장 신념 6
// "판단이 바뀌지 않을 정밀도"). 3묶음 이상은 읽는 비용만 늘린다.
const MYRIAD_GROUPS = 2;

// ---------- 추출기 포맷 어휘 ----------
//
// 추출기(scripts/paper_board_extract.py)는 Paper 원문에서 읽은 단위를 `format.unit`으로
// 싣는다(text/percent/krw_ko/shares/count/date/time). 손으로 쓴 계약(픽스처)은 렌더러
// 어휘인 `format.kind`를 바로 쓴다. 두 어휘를 한 표로 잇고, 명시된 kind가 이긴다 —
// 같은 값이 두 경로에서 다르게 보이면 안 된다.
const UNIT_KIND = Object.freeze({
  text: 'text',
  percent: 'percent',
  krw_ko: 'korean',
  shares: 'number',
  count: 'number',
  date: 'date',
  time: 'time',
});

// 단위는 값과 함께 쓴다(헌장 신념 6). 수량 단위만 접미로 붙는다 — 금액은 만 단위
// 사다리가, 퍼센트는 kind가 이미 단위를 싣기 때문이다.
const UNIT_SUFFIX = Object.freeze({ shares: '주', count: '건' });

// 렌더러 전용 종류 — 추출기 단위에는 대응어가 없고 손으로 쓴 계약만 쓴다.
const RENDER_KIND = Object.freeze(['text', 'number', 'korean', 'percent', 'date', 'time', 'rollup']);

// 부호에서 색을 뽑는 tone 어휘. 추출기는 변화량을 'change'로, 손으로 쓴 계약은
// 'signed'로 적는다. 'neutral'은 색 없음이고, 색이 없다고 부호가 사라지지는 않는다.
const DERIVED_TONE = Object.freeze(['signed', 'change']);
const NEUTRAL_TONE = 'neutral';

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/,/g, '');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function groupText(amount) {
  return Math.abs(amount).toLocaleString('ko-KR');
}

// 12,340,000,000,000 → "12조 3,400억". 상위 2묶음만 남기고 뒤쪽 0묶음은 버린다.
function formatKoreanUnit(value) {
  const numeric = toNumber(value);
  if (numeric === null) return null;
  if (numeric === 0) return '0';
  let rest = Math.abs(numeric);
  const parts = [];
  for (const { unit, size } of MYRIAD_LADDER) {
    const group = Math.floor(rest / size);
    rest -= group * size;
    if (group === 0 && parts.length === 0) continue;
    if (parts.length >= MYRIAD_GROUPS) break;
    if (group === 0) break;
    parts.push(`${group.toLocaleString('ko-KR')}${unit}`);
  }
  if (!parts.length) parts.push(groupText(numeric));
  return `${numeric < 0 ? '-' : ''}${parts.join(' ')}`;
}

function withPrecision(numeric, precision) {
  if (!Number.isFinite(precision)) return numeric.toLocaleString('ko-KR');
  return numeric.toLocaleString('ko-KR', {
    minimumFractionDigits: precision, maximumFractionDigits: precision,
  });
}

function signPrefix(numeric, wantsSign) {
  return wantsSign && numeric > 0 ? '+' : '';
}

// 부호와 색은 항상 함께(헌장 신념 6 — 색만으로 상승·하락을 구분하지 않는다).
function toneOf(value) {
  const numeric = toNumber(value);
  if (numeric === null) return 'flat';
  if (numeric > 0) return 'up';
  if (numeric < 0) return 'down';
  return 'flat';
}

function toneColorVar(tone) {
  if (tone === 'up') return 'var(--color-up)';
  if (tone === 'down') return 'var(--color-down)';
  return null;
}

function formatTime(value) {
  const text = String(value);
  return /^\d{6}$/.test(text)
    ? `${text.slice(0, 2)}:${text.slice(2, 4)}:${text.slice(4, 6)}`
    : text;
}

function missingText(reason) {
  return MISSING_TEXT[String(reason || DEFAULT_MISSING)] || MISSING_TEXT[DEFAULT_MISSING];
}

function isScalarSlotValue(value) {
  return typeof value !== 'object' || value === null;
}

function compositeSpecOf(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const composite = raw.composite;
  return composite && typeof composite === 'object' && !Array.isArray(composite) ? composite : null;
}

function normalizeSlotValue(raw) {
  if (raw === null || raw === undefined || raw === '') return { value: null, missing: DEFAULT_MISSING };
  // 보드 슬롯은 단일 관찰값 하나를 받는다. 배열은 REST 목록/시계열이 잘못 결합된
  // 계약 위반이고 String(array)는 쉼표로 이어진 전체 목록을 한 칸에 쏟아낸다.
  // 어느 원소가 현재값인지 추정하지 않고 결측으로 닫는다.
  if (Array.isArray(raw)) return { value: null, missing: DEFAULT_MISSING };
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    if (raw.missing) return { value: null, missing: raw.missing };
    if (raw.value === null || raw.value === undefined || raw.value === '' || !isScalarSlotValue(raw.value)) {
      return { value: null, missing: DEFAULT_MISSING };
    }
    return { value: raw.value, missing: null, text: raw.text, tone: raw.tone };
  }
  return { value: raw, missing: null };
}

// 두 어휘를 한 표로 읽는다. 손으로 쓴 계약이 `kind: 'shares'`처럼 단위 이름을 쓰는
// 곳이 실제로 있어(2XA5-0/s313 등) kind도 같은 표를 거친다. 모르는 낱말은 숫자로
// 오해하지 않고 text로 떨어뜨린다 — 없는 정밀도를 만들지 않기 위해서다.
function kindOf(spec) {
  const token = spec.kind || spec.unit;
  if (UNIT_KIND[token]) return UNIT_KIND[token];
  return RENDER_KIND.includes(token) ? token : 'text';
}

// 수량 접미(주·건)는 숫자로 읽힌 값에만 붙인다. '상한가'처럼 숫자가 아닌 원문에
// 붙이면 없는 단위를 지어내는 것이 된다.
function suffixOf(spec) {
  return UNIT_SUFFIX[spec.kind] || UNIT_SUFFIX[spec.unit] || '';
}

function toneFor(spec, value) {
  if (DERIVED_TONE.includes(spec.tone)) return toneOf(value);
  return spec.tone && spec.tone !== NEUTRAL_TONE ? spec.tone : null;
}

function applyAffixes(spec, formatted) {
  if (formatted.missing) return formatted;
  if ((spec.prefix !== undefined && typeof spec.prefix !== 'string')
    || (spec.suffix !== undefined && typeof spec.suffix !== 'string')) {
    return { text: missingText(), tone: null, missing: true };
  }
  return {
    ...formatted,
    text: `${spec.prefix || ''}${formatted.text}${spec.suffix || ''}`,
  };
}

function missingResult(spec, reason, authored = false) {
  const authoredText = authored && typeof spec.missing_text === 'string'
    ? spec.missing_text.trim() : '';
  return { text: authoredText || missingText(reason), tone: null, missing: true };
}

// 슬롯 하나의 최종 표기. 반환은 항상 {text, tone} — tone은 색을 고르는 근거이고
// 색만으로는 뜻을 전하지 않으므로 부호는 text에 이미 들어 있다.
function formatSlot(format, raw) {
  const spec = format || {};
  const composite = compositeSpecOf(raw);
  if (composite) {
    const separator = composite.separator;
    const parts = composite.parts;
    if (typeof separator !== 'string' || !Array.isArray(parts) || parts.length < 2) {
      return missingResult(spec);
    }
    const texts = [];
    for (const part of parts) {
      const partFormat = part && part.format;
      if (!part || typeof part !== 'object' || Array.isArray(part)
        || typeof part.mapping_id !== 'string' || !part.mapping_id
        || typeof part.f !== 'string' || !part.f
        || !partFormat || typeof partFormat !== 'object' || Array.isArray(partFormat)) {
        return missingResult(spec);
      }
      if (part.value === null || part.value === undefined || part.value === '') {
        return missingResult(spec, DEFAULT_MISSING, true);
      }
      if (!isScalarSlotValue(part.value)) {
        return missingResult(spec);
      }
      const formatted = formatSlot(partFormat, part.value);
      if (formatted.missing) return missingResult(spec, DEFAULT_MISSING, true);
      texts.push(formatted.text);
    }
    return applyAffixes(spec, { text: texts.join(separator), tone: null, missing: false });
  }
  const normalized = normalizeSlotValue(raw);
  if (normalized.missing) {
    const explicitlyMissing = raw === null || raw === undefined || raw === ''
      || (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.missing);
    return missingResult(spec, normalized.missing, explicitlyMissing);
  }
  if (typeof normalized.text === 'string' && normalized.text) {
    return { text: normalized.text, tone: normalized.tone || null, missing: false };
  }

  const kind = kindOf(spec);
  const scale = SCALE_FACTOR[spec.scale] || 1;
  const tone = toneFor(spec, normalized.value);

  if (kind === 'text' || kind === 'rollup') {
    return applyAffixes(spec, { text: String(normalized.value), tone, missing: false });
  }
  if (kind === 'date') {
    const rawDate = String(normalized.value);
    const text = spec.date_style === 'month-day' && /^\d{8}$/.test(rawDate)
      ? `${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
      : factsCard.formatDatetime(normalized.value);
    return applyAffixes(spec, { text, tone, missing: false });
  }
  if (kind === 'time') {
    return applyAffixes(spec, { text: formatTime(normalized.value), tone, missing: false });
  }

  const numeric = toNumber(normalized.value);
  if (numeric === null) return applyAffixes(spec, { text: String(normalized.value), tone, missing: false });
  // Kiwoom 가격 필드는 방향 부호를 값에 싣는다. 가격으로 저작된 슬롯만 magnitude를
  // 표시하고, 상승·하락 tone은 위에서 원본 부호로 이미 계산한 값을 유지한다.
  const displayNumeric = spec.absolute === true ? Math.abs(numeric) : numeric;
  const scaled = displayNumeric * scale;

  if (kind === 'korean') {
    return applyAffixes(spec, {
      text: `${signPrefix(scaled, spec.sign)}${formatKoreanUnit(scaled)}`, tone, missing: false,
    });
  }
  if (kind === 'percent') {
    const precision = Number.isFinite(spec.precision) ? spec.precision : 2;
    return applyAffixes(spec, {
      text: `${signPrefix(scaled, spec.sign)}${withPrecision(scaled, precision)}%`, tone, missing: false,
    });
  }
  return applyAffixes(spec, {
    text: `${signPrefix(scaled, spec.sign)}${withPrecision(scaled, spec.precision)}${suffixOf(spec)}`,
    tone,
    missing: false,
  });
}

// H1 영값 묶음(헌장 §3.1) — 한 그룹에서 0·결측 항목이 3개 이상이면 접는다.
// 값이 생긴 항목은 그 항목만 자동으로 행으로 올라온다.
const ZERO_COLLAPSE_MIN = 3;

function isZeroLike(format, raw) {
  const normalized = normalizeSlotValue(raw);
  if (normalized.missing) return true;
  const numeric = toNumber(normalized.value);
  return numeric === 0;
}

const __exports = {
  MISSING_TEXT, MYRIAD_LADDER, SCALE_FACTOR, MYRIAD_GROUPS, ZERO_COLLAPSE_MIN,
  UNIT_KIND, UNIT_SUFFIX, RENDER_KIND, DERIVED_TONE,
  toNumber, formatKoreanUnit, formatTime, formatSlot, normalizeSlotValue, isScalarSlotValue, compositeSpecOf,
  kindOf, toneFor, applyAffixes, missingResult,
  toneOf, toneColorVar, missingText, isZeroLike,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BoardFormat = __exports;
}

})();
