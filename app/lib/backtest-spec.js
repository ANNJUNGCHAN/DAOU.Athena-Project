// 전략 스펙 편집 모델 — Paper 백테스트 보드 01(설계 폼)의 상태를 DOM 없이 들고 있는다.
//
// **왜 yaml 문자열이 아니라 객체를 들고 있나.** 이전 구현은 프리셋 yaml 뒤에 `data:`
// 블록을 문자열로 이어붙였다(buildRunYaml). 그 방식으로는 보드 01이 요구하는 것 —
// 지표 파라미터 슬라이더, 조건 추가/삭제, 손절·익절 토글, 수수료 입력 — 을 표현할 수
// 없다. 사용자가 슬라이더를 움직이면 바뀌어야 하는 것은 yaml 텍스트 안의 한 숫자이고,
// 문자열 이어붙이기로는 그 숫자에 손이 닿지 않는다.
//
// **왜 yaml 라이브러리를 안 쓰나.** 우리가 쓰는 yaml은 백엔드 `StrategySpec`이 정의한
// 고정된 모양 하나뿐이다(schema.py). 임의의 yaml을 읽는 게 아니라 우리가 만든 것만
// 다시 쓰면 되므로, 직렬화기 한 개면 충분하다 — 프런트에 파서 의존을 새로 들이지 않는다.
// 프리셋 yaml을 **읽는** 쪽은 백엔드가 이미 해주므로(GET /presets가 파싱 가능한 원문을
// 준다) 우리는 백엔드가 준 구조화 값으로 편집을 시작한다.
//
// **왜 검증이 여기 있나.** 같은 규칙을 캔버스와 테스트가 같이 써야 하고, 실행 버튼을
// 누르기 전에 사람이 무엇이 잘못됐는지 알아야 한다. 백엔드도 422로 거절하지만, 그건
// 마지막 방어선이지 사람에게 알려주는 자리가 아니다.
(function () {
'use strict';

const PERIODS = [['day', '일'], ['week', '주'], ['month', '월']];

// schema.py Operator 7종 그대로. 라벨은 조건 행을 사람 문장처럼 읽히게 한다.
const OPERATORS = [
  ['cross_above', '가 상향 돌파'],
  ['cross_below', '가 하향 돌파'],
  ['greater_than', '가 더 큼'],
  ['less_than', '가 더 작음'],
  ['greater_equal', '가 크거나 같음'],
  ['less_equal', '가 작거나 같음'],
  ['equals', '가 같음'],
];

const LOGIC_LABELS = { AND: '모두 만족 AND', OR: '하나라도 OR' };

// costs.py 기본값이 아니라 **화면 기본값**이다. 세율은 시점에 따라 바뀌고 우리가 그
// 시점의 정답을 안다고 주장할 근거가 없다(계획서 §10.3) — 그래서 화면이 이 값을
// "기본값일 뿐 사실 주장이 아닙니다"라고 함께 표기한다.
const DEFAULT_COSTS = { fee_bps: 1.5, tax_bps: 18.0, slippage_bps: 5.0 };

function todayYyyymmdd(now) {
  const d = now || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function isValidStkCd(value) {
  return /^\d{6}$/.test(String(value == null ? '' : value).trim());
}

function isValidYyyymmdd(value) {
  const s = String(value == null ? '' : value).trim();
  if (!/^\d{8}$/.test(s)) return false;
  const month = Number(s.slice(4, 6));
  const day = Number(s.slice(6, 8));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

// 프리셋(순수 전략 템플릿)에 사용자가 고른 대상·기간·비용을 얹어 편집 가능한 스펙을 만든다.
function createSpec(preset, overrides) {
  const base = {
    presetId: preset ? preset.id : null,
    name: preset ? preset.name : '새 전략',
    symbols: [],
    period: 'day',
    adjusted: true,
    fromDt: '',
    toDt: '',
    params: preset && preset.params ? JSON.parse(JSON.stringify(preset.params)) : {},
    indicators: preset && preset.indicators ? JSON.parse(JSON.stringify(preset.indicators)) : [],
    entry: preset && preset.entry
      ? JSON.parse(JSON.stringify(preset.entry))
      : { logic: 'AND', conditions: [] },
    exit: preset && preset.exit
      ? JSON.parse(JSON.stringify(preset.exit))
      : { logic: 'OR', conditions: [] },
    risk: preset && preset.risk
      ? JSON.parse(JSON.stringify(preset.risk))
      : {
        stop_loss: { enabled: false, percent: 8 },
        take_profit: { enabled: false, percent: 20 },
        position: { sizing: 'all_in' },
      },
    costs: Object.assign({}, DEFAULT_COSTS),
  };
  return Object.assign(base, overrides || {});
}

function addSymbol(spec, stkCd) {
  const code = String(stkCd || '').trim();
  if (!isValidStkCd(code) || spec.symbols.indexOf(code) !== -1) return spec;
  return Object.assign({}, spec, { symbols: spec.symbols.concat([code]) });
}

function removeSymbol(spec, stkCd) {
  return Object.assign({}, spec, { symbols: spec.symbols.filter((s) => s !== stkCd) });
}

function setParam(spec, name, value) {
  if (!spec.params[name]) return spec;
  const next = JSON.parse(JSON.stringify(spec.params));
  const p = next[name];
  const raw = Number(value);
  if (!Number.isFinite(raw)) return spec;
  // min/max 밖의 값은 자르지 않고 **잘라서 담는다** — 슬라이더가 낼 수 있는 값은
  // 범위 안뿐이지만 숫자 입력은 범위 밖을 낼 수 있고, 범위 밖 값을 그대로 보내면
  // 백엔드가 아니라 지표 계산이 이상해진다.
  const clamped = Math.min(Math.max(raw, p.min), p.max);
  p.default = p.type === 'int' ? Math.round(clamped) : clamped;
  return Object.assign({}, spec, { params: next });
}

function addCondition(spec, side, condition) {
  const group = JSON.parse(JSON.stringify(spec[side]));
  group.conditions = group.conditions.concat([condition]);
  return Object.assign({}, spec, { [side]: group });
}

function removeCondition(spec, side, index) {
  const group = JSON.parse(JSON.stringify(spec[side]));
  group.conditions = group.conditions.filter((_, i) => i !== index);
  return Object.assign({}, spec, { [side]: group });
}

function setLogic(spec, side, logic) {
  if (logic !== 'AND' && logic !== 'OR') return spec;
  const group = Object.assign({}, spec[side], { logic });
  return Object.assign({}, spec, { [side]: group });
}

// 조건이 참조할 수 있는 이름 — 지표 별칭 + 원시 열(compile.py `_RAW_COLUMNS`와 같은 목록).
function referenceNames(spec) {
  const aliases = spec.indicators.map((i) => i.alias);
  return aliases.concat(['open', 'high', 'low', 'close', 'volume']);
}

// 조건이 참조하는 이름이 아는 이름인가. 다중 출력 지표(DONCHIAN → dc_upper·dc_lower·
// dc_mid, BBANDS → bb_upper…)는 `별칭_출력` 열을 낸다 — 백엔드 compile.py가 그렇게
// 붙이고 프리셋(52주 신고가 돌파)도 그 이름을 쓴다. 화면은 출력 목록을 모르므로
// "아는 별칭_무엇"이면 통과시키고 정확한 판정은 백엔드(422)에 맡긴다(2026-09-02 실측:
// 이 규칙이 없어 52주 신고가 돌파가 폼에서 영영 실행되지 않았다).
function isKnownName(name, spec) {
  if (typeof name !== 'string') return false;
  if (referenceNames(spec).indexOf(name) !== -1) return true;
  return spec.indicators.some((i) => i.alias && name.startsWith(`${i.alias}_`));
}

// options.conditions === false 면 진입·청산 조건 검사를 건너뛴다 — 코드 경로(runPath
// 'code')는 신호를 파이썬이 만들므로 폼의 조건은 실행과 무관하다.
function validate(spec, options) {
  const checkConditions = !(options && options.conditions === false);
  const errors = [];
  if (!spec.symbols.length) errors.push('종목을 하나 이상 고르세요');
  // 백엔드 POST /runs는 종목 1개만 받는다(§2 실행당 대상 지정) — 실행 후 422로 알기 전에
  // 폼과 채팅이 먼저 알아야 한다(2026-09-02 실측: 채팅이 종목 둘을 넣어 실행이 거부됐다).
  if (spec.symbols.length > 1) errors.push('실행은 종목 1개만 지원합니다 — 하나만 남기세요');
  if (spec.symbols.some((s) => !isValidStkCd(s))) errors.push('종목코드는 6자리 숫자여야 합니다');
  if (!isValidYyyymmdd(spec.fromDt) || !isValidYyyymmdd(spec.toDt)) {
    errors.push('시작일·종료일은 YYYYMMDD 형식이어야 합니다');
  } else if (String(spec.fromDt) > String(spec.toDt)) {
    errors.push('종료일은 시작일보다 빠를 수 없습니다');
  }
  if (checkConditions) {
    if (!spec.entry.conditions.length) errors.push('진입 조건이 하나도 없습니다');
    if (!spec.exit.conditions.length) errors.push('청산 조건이 하나도 없습니다');
    ['entry', 'exit'].forEach((side) => {
      spec[side].conditions.forEach((c) => {
        if (!isKnownName(c.indicator, spec)) {
          errors.push(`${c.indicator}는 정의되지 않은 이름입니다`);
        }
        // compare_to는 숫자이거나 아는 이름이어야 한다 — 오타를 실행 전에 잡는다.
        if (typeof c.compare_to === 'string' && !isKnownName(c.compare_to, spec)) {
          errors.push(`${c.compare_to}는 정의되지 않은 이름입니다`);
        }
      });
    });
  }
  [['stop_loss', '손절'], ['take_profit', '익절']].forEach(([key, label]) => {
    const toggle = spec.risk[key];
    if (toggle && toggle.enabled && !(Number(toggle.percent) > 0)) {
      errors.push(`${label}을 켰으면 0보다 큰 비율이 필요합니다`);
    }
  });
  return errors;
}

// ---------- 초안(채팅 제안) ----------

// 채팅이 propose_spec으로 낸 patch를 스펙에 얹는다. 실행·저장은 하지 않고 **새 스펙만**
// 돌려준다 — 사람이 카드의 [적용]을 누르기 전까지 폼은 그대로다. 'preset' 키는 여기서
// 다루지 않는다: 프리셋 목록은 캔버스가 들고 있으므로 템플릿 전환은 캔버스 몫이다.
// 잘못된 값은 조용히 떨어뜨린다 — 남은 문제는 validate()가 사람에게 알린다.
function applyPatch(spec, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return spec;
  let next = spec;
  if (Array.isArray(patch.symbols)) {
    const symbols = [];
    patch.symbols.forEach((s) => {
      const code = String(s == null ? '' : s).trim();
      if (isValidStkCd(code) && symbols.indexOf(code) === -1) symbols.push(code);
    });
    next = Object.assign({}, next, { symbols });
  }
  if (PERIODS.some(([id]) => id === patch.period)) {
    next = Object.assign({}, next, { period: patch.period });
  }
  if (typeof patch.adjusted === 'boolean') next = Object.assign({}, next, { adjusted: patch.adjusted });
  if (typeof patch.fromDt === 'string') next = Object.assign({}, next, { fromDt: patch.fromDt });
  if (typeof patch.toDt === 'string') next = Object.assign({}, next, { toDt: patch.toDt });
  if (patch.params && typeof patch.params === 'object') {
    Object.keys(patch.params).forEach((name) => {
      next = setParam(next, name, patch.params[name]);
    });
  }
  if (Array.isArray(patch.indicators)) {
    const indicators = patch.indicators
      .filter((i) => i && typeof i.id === 'string' && typeof i.alias === 'string')
      .map((i) => ({
        id: i.id,
        alias: i.alias,
        params: i.params && typeof i.params === 'object' ? JSON.parse(JSON.stringify(i.params)) : {},
      }));
    next = Object.assign({}, next, { indicators });
  }
  ['entry', 'exit'].forEach((side) => {
    const group = patch[side];
    if (!group || typeof group !== 'object' || !Array.isArray(group.conditions)) return;
    const logic = group.logic === 'AND' || group.logic === 'OR' ? group.logic : next[side].logic;
    const conditions = group.conditions
      .filter((c) => c
        && typeof c.indicator === 'string'
        && OPERATORS.some(([id]) => id === c.operator)
        && (typeof c.compare_to === 'string' || typeof c.compare_to === 'number'))
      .map((c) => ({
        indicator: c.indicator,
        operator: c.operator,
        // 스키마가 compare_to를 문자열로도 받으므로 숫자 문자열('30')은 폼의 조건 추가와
        // 같은 규칙으로 숫자로 바꾼다 — 안 그러면 validate가 이름 참조로 보고 초안을 막는다.
        compare_to: typeof c.compare_to === 'string' && /^-?\d+(\.\d+)?$/.test(c.compare_to)
          ? Number(c.compare_to)
          : c.compare_to,
      }));
    next = Object.assign({}, next, { [side]: { logic, conditions } });
  });
  if (patch.risk && typeof patch.risk === 'object') {
    const risk = JSON.parse(JSON.stringify(next.risk));
    ['stop_loss', 'take_profit'].forEach((key) => {
      const toggle = patch.risk[key];
      if (!toggle || typeof toggle !== 'object') return;
      risk[key] = Object.assign({}, risk[key]);
      if (typeof toggle.enabled === 'boolean') risk[key].enabled = toggle.enabled;
      if (Number.isFinite(toggle.percent)) risk[key].percent = toggle.percent;
    });
    next = Object.assign({}, next, { risk });
  }
  if (patch.costs && typeof patch.costs === 'object') {
    const costs = Object.assign({}, next.costs);
    ['fee_bps', 'tax_bps', 'slippage_bps'].forEach((key) => {
      if (Number.isFinite(patch.costs[key])) costs[key] = patch.costs[key];
    });
    next = Object.assign({}, next, { costs });
  }
  return next;
}

// 초안 카드가 "전 → 후"를 그릴 순서와 라벨. 폼 위에서 아래로 읽히는 순서와 같다.
const DIFF_FIELDS = [
  ['name', '전략'],
  ['symbols', '종목'],
  ['period', '주기'],
  ['adjusted', '수정주가'],
  ['fromDt', '시작일'],
  ['toDt', '종료일'],
  ['params', '파라미터'],
  ['indicators', '지표'],
  ['entry', '진입 조건'],
  ['exit', '청산 조건'],
  ['risk', '리스크'],
  ['costs', '비용'],
];

function paramDefaults(params) {
  const out = {};
  Object.keys(params || {}).forEach((name) => { out[name] = params[name].default; });
  return out;
}

// 두 스펙에서 달라진 필드만 DIFF_FIELDS 순서로 돌려준다. before/after는 가공하지 않은
// 값이다(표시는 캔버스가 한다). params만은 default 값만 비교한다 — min/max/step은
// 프리셋이 정한 범위라 초안이 바꾸지 않고, 그걸 차이로 보이면 사람이 헷갈린다.
function diffFields(before, after) {
  return DIFF_FIELDS.reduce((acc, [key, label]) => {
    const a = key === 'params' ? paramDefaults(before.params) : before[key];
    const b = key === 'params' ? paramDefaults(after.params) : after[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) acc.push({ key, label, before: a, after: b });
    return acc;
  }, []);
}

// ---------- 직렬화 ----------

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function serializeParams(params) {
  const names = Object.keys(params);
  if (!names.length) return '  params: {}';
  const lines = ['  params:'];
  names.forEach((name) => {
    const p = params[name];
    lines.push(
      `    ${name}: {default: ${p.default}, min: ${p.min}, max: ${p.max}, `
      + `step: ${p.step}, type: ${p.type || 'float'}}`,
    );
  });
  return lines.join('\n');
}

function serializeIndicators(indicators) {
  if (!indicators.length) return '  indicators: []';
  const lines = ['  indicators:'];
  indicators.forEach((ind) => {
    const params = Object.keys(ind.params || {})
      .map((k) => {
        const v = ind.params[k];
        return `${k}: ${typeof v === 'string' ? quote(v) : v}`;
      })
      .join(', ');
    lines.push(`    - {id: ${ind.id}, alias: ${ind.alias}, params: {${params}}}`);
  });
  return lines.join('\n');
}

function serializeGroup(name, group) {
  const lines = [`  ${name}:`, `    logic: ${group.logic}`, '    conditions:'];
  group.conditions.forEach((c) => {
    const compare = typeof c.compare_to === 'number' ? c.compare_to : c.compare_to;
    lines.push(
      `      - {indicator: ${c.indicator}, operator: ${c.operator}, compare_to: ${compare}}`,
    );
  });
  return lines.join('\n');
}

// 편집 중인 스펙을 백엔드 `.athena.yaml v1`로 옮긴다. `data:`/`costs:`를 항상 채우는
// 것이 프리셋 원문과의 차이다 — 프리셋은 그 둘을 모르고, 실행하려면 있어야 한다.
function toYaml(spec) {
  const symbols = spec.symbols.map(quote).join(', ');
  return [
    'version: "1.0"',
    'metadata:',
    `  name: ${quote(spec.name)}`,
    'data:',
    `  symbols: [${symbols}]`,
    `  period: ${spec.period}`,
    `  adjusted: ${spec.adjusted ? 'true' : 'false'}`,
    `  from: ${quote(spec.fromDt)}`,
    `  to: ${quote(spec.toDt)}`,
    'strategy:',
    `  id: ${spec.presetId || 'custom'}`,
    serializeParams(spec.params),
    serializeIndicators(spec.indicators),
    serializeGroup('entry', spec.entry),
    serializeGroup('exit', spec.exit),
    'risk:',
    `  stop_loss:   {enabled: ${spec.risk.stop_loss.enabled}, `
      + `percent: ${spec.risk.stop_loss.percent}}`,
    `  take_profit: {enabled: ${spec.risk.take_profit.enabled}, `
      + `percent: ${spec.risk.take_profit.percent}}`,
    `  position:    {sizing: ${spec.risk.position.sizing}}`,
    'costs:',
    `  fee_bps: ${spec.costs.fee_bps}`,
    `  tax_bps: ${spec.costs.tax_bps}`,
    `  slippage_bps: ${spec.costs.slippage_bps}`,
    '',
  ].join('\n');
}

// 백엔드가 준 프리셋 yaml에서 편집에 필요한 구조를 뽑는다. 완전한 yaml 파서가 아니라
// **우리가 쓴 모양만** 읽는다 — 프리셋은 presets.py가 쓴 것이고 형식이 고정돼 있다.
function parsePresetYaml(text) {
  const out = { params: {}, indicators: [], entry: null, exit: null, risk: null };
  const lines = String(text || '').split('\n');
  let section = null;
  let group = null;
  lines.forEach((raw) => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) return;
    const paramMatch = line.match(
      /^\s{4}(\w+):\s*\{default:\s*([-\d.]+),\s*min:\s*([-\d.]+),\s*max:\s*([-\d.]+),\s*step:\s*([-\d.]+)(?:,\s*type:\s*(\w+))?\}/,
    );
    const indMatch = line.match(/^\s{4}-\s*\{id:\s*([\w]+),\s*alias:\s*([\w]+),\s*params:\s*\{(.*)\}\}/);
    const condMatch = line.match(
      /^\s{6}-\s*\{indicator:\s*([\w]+),\s*operator:\s*([\w]+),\s*compare_to:\s*([^}]+)\}/,
    );
    if (/^\s{2}params:/.test(line)) { section = 'params'; return; }
    if (/^\s{2}indicators:/.test(line)) { section = 'indicators'; return; }
    if (/^\s{2}entry:/.test(line)) { section = 'entry'; group = { logic: 'AND', conditions: [] }; out.entry = group; return; }
    if (/^\s{2}exit:/.test(line)) { section = 'exit'; group = { logic: 'OR', conditions: [] }; out.exit = group; return; }
    if (/^risk:/.test(line)) { section = 'risk'; return; }
    if (section === 'params' && paramMatch) {
      out.params[paramMatch[1]] = {
        default: Number(paramMatch[2]), min: Number(paramMatch[3]),
        max: Number(paramMatch[4]), step: Number(paramMatch[5]),
        type: paramMatch[6] || 'float',
      };
      return;
    }
    if (section === 'indicators' && indMatch) {
      const params = {};
      indMatch[3].split(',').forEach((pair) => {
        const kv = pair.split(':');
        if (kv.length < 2) return;
        const key = kv[0].trim();
        const value = kv.slice(1).join(':').trim().replace(/^["']|["']$/g, '');
        params[key] = /^[-\d.]+$/.test(value) ? Number(value) : value;
      });
      out.indicators.push({ id: indMatch[1], alias: indMatch[2], params });
      return;
    }
    if ((section === 'entry' || section === 'exit') && /^\s{4}logic:/.test(line)) {
      group.logic = line.split(':')[1].trim();
      return;
    }
    if ((section === 'entry' || section === 'exit') && condMatch) {
      const compare = condMatch[3].trim();
      group.conditions.push({
        indicator: condMatch[1],
        operator: condMatch[2],
        compare_to: /^[-\d.]+$/.test(compare) ? Number(compare) : compare,
      });
      return;
    }
    if (section === 'risk') {
      const risk = out.risk || {
        stop_loss: { enabled: false, percent: 8 },
        take_profit: { enabled: false, percent: 20 },
        position: { sizing: 'all_in' },
      };
      const m = line.match(/^\s{2}(stop_loss|take_profit):\s*\{enabled:\s*(\w+),\s*percent:\s*([-\d.]+)\}/);
      if (m) risk[m[1]] = { enabled: m[2] === 'true', percent: Number(m[3]) };
      const pm = line.match(/^\s{2}position:\s*\{sizing:\s*(\w+)\}/);
      if (pm) risk.position = { sizing: pm[1] };
      out.risk = risk;
    }
  });
  return out;
}

function presetToSpec(preset) {
  const parsed = parsePresetYaml(preset && preset.yaml);
  return createSpec({
    id: preset ? preset.id : null,
    name: preset ? preset.name : '새 전략',
    params: parsed.params,
    indicators: parsed.indicators,
    entry: parsed.entry,
    exit: parsed.exit,
    risk: parsed.risk,
  });
}

const __exports = {
  PERIODS,
  OPERATORS,
  LOGIC_LABELS,
  DEFAULT_COSTS,
  todayYyyymmdd,
  isValidStkCd,
  isValidYyyymmdd,
  createSpec,
  addSymbol,
  removeSymbol,
  setParam,
  addCondition,
  removeCondition,
  setLogic,
  referenceNames,
  validate,
  applyPatch,
  diffFields,
  toYaml,
  parsePresetYaml,
  presetToSpec,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BacktestSpec = __exports;
}

})();
