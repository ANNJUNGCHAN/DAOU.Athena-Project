// 작업공간 복원 계약(41번 보드 "다시 누르면 그대로") — 봉인할 조각과 복원 결과 판정의
// 순수 규칙 모듈이다. DOM도 IPC도 모른다.
//
// 왜 따로 두나: 봉인(무엇을 남기나)과 판정(무엇이 돌아왔나)이 캔버스 안에 섞이면
// "복원 6/6"과 "일부만 복원했습니다"가 화면 그리기 코드에서 계산돼, 값이 맞는지
// node --test로 물어볼 자리가 없어진다. 42번 보드가 정한 항목표는 여기 한 벌뿐이다.
(function () {
'use strict';

// 42번 보드 R4 "모드 전용 폼 값" — 백테스트에서 봉인하는 폼 값의 전부다.
const FORM_FIELDS = Object.freeze([
  ['symbols', '종목'],
  ['period', '주기'],
  ['fromDt', '시작일'],
  ['toDt', '종료일'],
  ['params', '파라미터'],
  ['costs', '비용'],
]);

// 41번 보드 Rule 3이 이름을 대는 단위. 이름은 Paper 3WO4-1의 어휘 그대로다 —
// 「폼·코드·로그」, 그리고 결과는 봉인이 마지막 실행 한 장뿐이라 「결과 데이터셋 1장」.
// 셋째 칸은 못 찾았다고 말할 때만 쓰는 이름이다(그대로 남은 것을 셀 때는 수량을 붙이지
// 않는다). 봉인되지 않은 항목은 판정에 끼지 않는다 — 없던 것을 "못 찾았다"고 말하면
// 그것이 거짓 안내다.
const ITEMS = Object.freeze([
  ['form', '폼'],
  ['code', '코드'],
  ['result', '결과 데이터셋', '결과 데이터셋 1장'],
  ['log', '로그'],
]);

// 42번 보드 R6 "실행 로그" — 값이 아니라 꼬리만 남긴다. 결과 데이터셋을 못 찾아도
// 로그는 그대로 남는 것이 Paper의 부분 복원 예시다.
const LOG_TAIL_CHARS = 2000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return true;
}

// 이 스펙이 실제로 값을 들고 있는 폼 칸. 비어 있는 칸은 봉인하지 않는다(빈 칸을
// 세면 "복원 6/6"이 사람이 채운 적 없는 칸까지 세어 카운트가 거짓말을 한다).
function filledFormFields(spec) {
  if (!isPlainObject(spec)) return [];
  return FORM_FIELDS.filter(([key]) => hasValue(spec[key])).map(([key]) => key);
}

function labelOf(key) {
  const row = ITEMS.find(([id]) => id === key);
  return row ? row[1] : key;
}

function missingLabelOf(key) {
  const row = ITEMS.find(([id]) => id === key);
  if (!row) return key;
  return row[2] || row[1];
}

// 마지막 글자에 받침이 있나 — 안내 문장의 조사가 이것으로 갈린다.
function hasJongseong(text) {
  const clean = String(text || '').trim();
  if (!clean) return false;
  const code = clean.charCodeAt(clean.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

function withObject(text) {
  return `${text}${hasJongseong(text) ? '을' : '를'}`;
}

function withTopic(text) {
  return `${text}${hasJongseong(text) ? '은' : '는'}`;
}

function tail(text, limit) {
  const clean = typeof text === 'string' ? text : '';
  return clean.length > limit ? clean.slice(clean.length - limit) : clean;
}

/**
 * 백테스트 작업공간 봉인. 값이 없는 조각은 null로 남긴다 — 빈 껍데기를 봉인하면
 * 복원이 그것을 "돌아온 것"으로 세어 카운트가 부풀려진다.
 */
function sealBacktest(input) {
  const src = isPlainObject(input) ? input : {};
  const spec = isPlainObject(src.spec) ? src.spec : null;
  const yaml = typeof src.yaml === 'string' ? src.yaml : '';
  const code = typeof src.codeSource === 'string' ? src.codeSource : '';
  const runId = hasValue(src.runId) ? String(src.runId) : null;
  const stdout = typeof src.stdout === 'string' ? src.stdout : '';
  const scrollTop = Number.isFinite(src.scrollTop) ? Math.max(0, Math.round(src.scrollTop)) : null;
  return {
    form: spec && yaml.trim() ? { yaml, fields: filledFormFields(spec) } : null,
    code: code.trim()
      ? {
        source: code,
        file: typeof src.codeFile === 'string' && src.codeFile ? src.codeFile : null,
        versionId: hasValue(src.versionId) ? String(src.versionId) : null,
        strategyId: hasValue(src.strategyId) ? String(src.strategyId) : null,
        runPath: src.runPath === 'code' ? 'code' : 'form',
      }
      : null,
    run: runId ? { runId } : null,
    log: stdout.trim() ? { tail: tail(stdout, LOG_TAIL_CHARS) } : null,
    scroll: scrollTop === null ? null : { top: scrollTop },
  };
}

/**
 * 봉인한 것과 실제로 되살아난 것을 맞대 41번 보드 Rule 3의 안내를 만든다.
 *
 * @param {object} sealed  봉인 봉투(sealBacktest의 산출물 모양)
 * @param {object} applied { form: string[] 되살아난 폼 칸, code, result, log: boolean }
 */
function restoreReport(sealed, applied) {
  const saved = isPlainObject(sealed) ? sealed : {};
  const got = isPlainObject(applied) ? applied : {};
  const formFields = Array.isArray(saved.form && saved.form.fields) ? saved.form.fields : [];
  const restoredFields = Array.isArray(got.form)
    ? got.form.filter((key) => formFields.indexOf(key) !== -1)
    : [];

  const items = [];
  for (const [key, label] of ITEMS) {
    if (key === 'form') {
      if (!saved.form) continue;
      items.push({
        key, label, ok: restoredFields.length === formFields.length,
        restored: restoredFields.length, sealed: formFields.length,
      });
      continue;
    }
    const box = key === 'result' ? saved.run : saved[key];
    if (!box) continue;
    items.push({ key, label, ok: Boolean(got[key]) });
  }

  const missing = items.filter((item) => !item.ok).map((item) => missingLabelOf(item.key));
  const kept = items.filter((item) => item.ok).map((item) => item.label);
  const form = saved.form
    ? { restored: restoredFields.length, sealed: formFields.length }
    : null;
  if (!missing.length) {
    // 전부 돌아왔으면 아무 말도 하지 않는다(Rule 1) — 안내 문장 자체를 만들지 않는다.
    return { items, form, partial: false, missing, kept, message: '' };
  }
  const head = `${withObject(missing.join('·'))} 찾지 못했습니다.`;
  const message = kept.length ? `${head} ${withTopic(kept.join('·'))} 그대로입니다.` : head;
  return { items, form, partial: true, missing, kept, message };
}

const __exports = {
  FORM_FIELDS,
  ITEMS,
  LOG_TAIL_CHARS,
  filledFormFields,
  labelOf,
  missingLabelOf,
  hasJongseong,
  sealBacktest,
  restoreReport,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.SessionRestore = __exports;
}

})();
