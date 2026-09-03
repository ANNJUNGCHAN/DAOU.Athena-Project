'use strict';

// backtest-spec.js — 프리셋 왕복·편집 연산·검증·직렬화.
//
// **왕복(round-trip)이 이 파일의 중심이다.** 프리셋 yaml을 읽어 편집 스펙으로 만들고
// 다시 yaml로 쓴 결과가 백엔드가 받아들이는 모양이어야 한다. 그 고리가 끊기면 사용자가
// 슬라이더를 움직인 값이 실행에 반영되지 않고, 그 사실을 아무도 모른 채 결과만 나온다.

const test = require('node:test');
const assert = require('node:assert/strict');

const spec = require('./backtest-spec');

// presets.py `_SMA_CROSSOVER` 원문 그대로 — 백엔드가 GET /presets로 주는 값이다.
const SMA_YAML = `
version: "1.0"
metadata:
  name: SMA 골든크로스
  description: 단기 이평이 장기 이평을 상향 돌파하면 진입, 하향 돌파하면 청산
  tags: [trend, ma]
strategy:
  id: sma_crossover
  category: trend
  params:
    fast: {default: 20, min: 5, max: 60, step: 1, type: int}
    slow: {default: 60, min: 20, max: 240, step: 1, type: int}
  indicators:
    - {id: SMA, alias: ma_fast, params: {period: "$fast"}}
    - {id: SMA, alias: ma_slow, params: {period: "$slow"}}
  entry:
    logic: AND
    conditions:
      - {indicator: ma_fast, operator: cross_above, compare_to: ma_slow}
  exit:
    logic: OR
    conditions:
      - {indicator: ma_fast, operator: cross_below, compare_to: ma_slow}
risk:
  stop_loss:   {enabled: true,  percent: 8}
  take_profit: {enabled: false, percent: 20}
  position:    {sizing: all_in}
`;

const PRESET = { id: 'sma_crossover', name: 'SMA 골든크로스', yaml: SMA_YAML };

function ready() {
  let s = spec.presetToSpec(PRESET);
  s = spec.addSymbol(s, '005930');
  return Object.assign({}, s, { fromDt: '20160101', toDt: '20260828' });
}

// ── 프리셋 읽기 ──────────────────────────────────────────────────────────────

test('프리셋 yaml에서 파라미터·범위·타입을 읽는다(슬라이더의 근거)', () => {
  const parsed = spec.parsePresetYaml(SMA_YAML);
  assert.deepEqual(parsed.params.fast, { default: 20, min: 5, max: 60, step: 1, type: 'int' });
  assert.deepEqual(parsed.params.slow, { default: 60, min: 20, max: 240, step: 1, type: 'int' });
});

test('프리셋 yaml에서 지표 별칭과 $참조를 읽는다', () => {
  const parsed = spec.parsePresetYaml(SMA_YAML);
  assert.equal(parsed.indicators.length, 2);
  assert.deepEqual(parsed.indicators[0], {
    id: 'SMA', alias: 'ma_fast', params: { period: '$fast' },
  });
});

test('프리셋 yaml에서 진입·청산 조건과 AND/OR를 읽는다', () => {
  const parsed = spec.parsePresetYaml(SMA_YAML);
  assert.equal(parsed.entry.logic, 'AND');
  assert.equal(parsed.exit.logic, 'OR');
  assert.deepEqual(parsed.entry.conditions[0], {
    indicator: 'ma_fast', operator: 'cross_above', compare_to: 'ma_slow',
  });
});

test('프리셋 yaml에서 손절·익절 토글을 읽는다', () => {
  const parsed = spec.parsePresetYaml(SMA_YAML);
  assert.deepEqual(parsed.risk.stop_loss, { enabled: true, percent: 8 });
  assert.deepEqual(parsed.risk.take_profit, { enabled: false, percent: 20 });
});

test('프리셋은 종목·기간·비용을 모른다 — 스펙은 그 자리를 비워둔 채 시작한다', () => {
  const s = spec.presetToSpec(PRESET);
  assert.deepEqual(s.symbols, []);
  assert.equal(s.fromDt, '');
  // 비용만은 화면 기본값을 채운다 — 안 채우면 결과에 늘 "비용 미설정"이 붙는다.
  assert.deepEqual(s.costs, spec.DEFAULT_COSTS);
});

// ── 편집 연산 ────────────────────────────────────────────────────────────────

test('종목 추가는 중복과 형식 오류를 조용히 무시한다', () => {
  let s = spec.presetToSpec(PRESET);
  s = spec.addSymbol(s, '005930');
  s = spec.addSymbol(s, '005930');
  s = spec.addSymbol(s, '오류');
  assert.deepEqual(s.symbols, ['005930']);
});

test('종목 제거', () => {
  let s = spec.addSymbol(spec.presetToSpec(PRESET), '005930');
  s = spec.addSymbol(s, '000660');
  assert.deepEqual(spec.removeSymbol(s, '005930').symbols, ['000660']);
});

test('파라미터는 min/max 밖으로 나가지 않는다', () => {
  const s = spec.presetToSpec(PRESET);
  assert.equal(spec.setParam(s, 'fast', 999).params.fast.default, 60);
  assert.equal(spec.setParam(s, 'fast', -5).params.fast.default, 5);
});

test('int 파라미터는 정수로 담긴다', () => {
  const s = spec.presetToSpec(PRESET);
  assert.equal(spec.setParam(s, 'fast', 20.7).params.fast.default, 21);
});

test('없는 파라미터를 바꾸려 하면 스펙이 그대로다', () => {
  const s = spec.presetToSpec(PRESET);
  assert.equal(spec.setParam(s, 'nope', 3), s);
});

test('편집 연산은 원본을 바꾸지 않는다(불변)', () => {
  const s = spec.presetToSpec(PRESET);
  spec.setParam(s, 'fast', 40);
  spec.addSymbol(s, '005930');
  assert.equal(s.params.fast.default, 20);
  assert.deepEqual(s.symbols, []);
});

test('조건 추가·삭제와 AND/OR 전환', () => {
  let s = spec.presetToSpec(PRESET);
  s = spec.addCondition(s, 'entry', {
    indicator: 'close', operator: 'greater_than', compare_to: 100,
  });
  assert.equal(s.entry.conditions.length, 2);
  s = spec.setLogic(s, 'entry', 'OR');
  assert.equal(s.entry.logic, 'OR');
  s = spec.removeCondition(s, 'entry', 0);
  assert.equal(s.entry.conditions.length, 1);
  assert.equal(s.entry.conditions[0].indicator, 'close');
});

test('조건이 참조할 수 있는 이름은 지표 별칭 + 원시 5열이다', () => {
  const names = spec.referenceNames(spec.presetToSpec(PRESET));
  assert.deepEqual(names, ['ma_fast', 'ma_slow', 'open', 'high', 'low', 'close', 'volume']);
});

// ── 검증 ────────────────────────────────────────────────────────────────────

test('종목·기간이 비면 실행 전에 막는다', () => {
  const errors = spec.validate(spec.presetToSpec(PRESET));
  assert.ok(errors.some((e) => e.includes('종목')));
  assert.ok(errors.some((e) => e.includes('YYYYMMDD')));
});

test('종료일이 시작일보다 빠르면 막는다', () => {
  const s = Object.assign({}, ready(), { fromDt: '20260101', toDt: '20250101' });
  assert.ok(spec.validate(s).some((e) => e.includes('빠를 수 없습니다')));
});

test('13월·32일 같은 날짜를 통과시키지 않는다', () => {
  assert.equal(spec.isValidYyyymmdd('20261301'), false);
  assert.equal(spec.isValidYyyymmdd('20260132'), false);
  assert.equal(spec.isValidYyyymmdd('20260101'), true);
});

test('조건이 모르는 이름을 참조하면 실행 전에 잡는다', () => {
  const s = spec.addCondition(ready(), 'entry', {
    indicator: 'ma_typo', operator: 'cross_above', compare_to: 'ma_slow',
  });
  assert.ok(spec.validate(s).some((e) => e.includes('ma_typo')));
});

test('compare_to의 오타도 잡는다 — 숫자는 통과시킨다', () => {
  const bad = spec.addCondition(ready(), 'entry', {
    indicator: 'close', operator: 'greater_than', compare_to: 'nope',
  });
  assert.ok(spec.validate(bad).some((e) => e.includes('nope')));
  const good = spec.addCondition(ready(), 'entry', {
    indicator: 'close', operator: 'greater_than', compare_to: 70,
  });
  assert.deepEqual(spec.validate(good), []);
});

test('손절을 켜고 0%면 막는다', () => {
  const s = ready();
  s.risk.stop_loss = { enabled: true, percent: 0 };
  assert.ok(spec.validate(s).some((e) => e.includes('손절')));
});

test('진입·청산 조건이 하나도 없으면 막는다', () => {
  let s = ready();
  s = spec.removeCondition(s, 'entry', 0);
  s = spec.removeCondition(s, 'exit', 0);
  const errors = spec.validate(s);
  assert.ok(errors.some((e) => e.includes('진입 조건')));
  assert.ok(errors.some((e) => e.includes('청산 조건')));
});

test('제대로 채운 스펙은 오류가 없다', () => {
  assert.deepEqual(spec.validate(ready()), []);
});

// ── 초안 적용(applyPatch) ────────────────────────────────────────────────────

test('초안의 종목은 목록을 통째로 바꾼다 — 중복·형식 오류는 떨어뜨린다', () => {
  const s = spec.applyPatch(ready(), { symbols: ['000660', '000660', '오류', '035420'] });
  assert.deepEqual(s.symbols, ['000660', '035420']);
});

test('초안의 주기는 day/week/month만 받는다', () => {
  const s = ready();
  assert.equal(spec.applyPatch(s, { period: 'hour' }).period, 'day');
  assert.equal(spec.applyPatch(s, { period: 'week' }).period, 'week');
});

test('초안의 파라미터는 setParam을 거친다 — 범위 밖은 잘리고 모르는 이름은 무시된다', () => {
  const s = spec.applyPatch(ready(), { params: { fast: 999, nope: 3 } });
  assert.equal(s.params.fast.default, 60);
  assert.equal(s.params.fast.max, 60);
  assert.equal(s.params.nope, undefined);
});

test('초안의 지표는 목록을 통째로 바꾼다 — id·alias 없는 항목은 떨어뜨리고 params는 {}가 기본', () => {
  const s = spec.applyPatch(ready(), {
    indicators: [{ id: 'RSI', alias: 'rsi', params: { period: 14 } }, { id: 'EMA' }, { id: 'ATR', alias: 'atr' }],
  });
  assert.deepEqual(s.indicators, [
    { id: 'RSI', alias: 'rsi', params: { period: 14 } },
    { id: 'ATR', alias: 'atr', params: {} },
  ]);
});

test('초안의 진입 조건은 그룹을 통째로 바꾼다 — 잘못된 조건은 떨어뜨리고 logic이 이상하면 기존 것을 지킨다', () => {
  const s = spec.applyPatch(ready(), {
    entry: {
      logic: 'XOR',
      conditions: [
        { indicator: 'close', operator: 'greater_than', compare_to: 70 },
        { indicator: 'close', operator: 'above', compare_to: 70 },
        { indicator: 'close', operator: 'less_than', compare_to: { x: 1 } },
        { operator: 'less_than', compare_to: 10 },
      ],
    },
  });
  assert.equal(s.entry.logic, 'AND');
  assert.deepEqual(s.entry.conditions, [
    { indicator: 'close', operator: 'greater_than', compare_to: 70 },
  ]);
  // 청산은 건드리지 않았으니 그대로다
  assert.deepEqual(s.exit, ready().exit);
});

test('초안의 리스크는 키 단위로 깊게 합친다 — 건드리지 않은 토글은 그대로다', () => {
  const s = spec.applyPatch(ready(), { risk: { take_profit: { enabled: true } } });
  assert.deepEqual(s.risk.take_profit, { enabled: true, percent: 20 });
  assert.deepEqual(s.risk.stop_loss, { enabled: true, percent: 8 });
  assert.deepEqual(s.risk.position, { sizing: 'all_in' });
});

test('초안의 비용은 준 키만 합친다 — 숫자가 아니면 무시한다', () => {
  const s = spec.applyPatch(ready(), { costs: { fee_bps: 3, tax_bps: 'x' } });
  assert.deepEqual(s.costs, { fee_bps: 3, tax_bps: 18.0, slippage_bps: 5.0 });
});

test('초안의 compare_to가 숫자 문자열이면 숫자로 바꾼다 — 이름으로 오인돼 막히지 않게', () => {
  const s = spec.applyPatch(ready(), {
    entry: { logic: 'AND', conditions: [{ indicator: 'close', operator: 'less_than', compare_to: '30' }] },
    exit: { logic: 'AND', conditions: [{ indicator: 'close', operator: 'greater_than', compare_to: 'ma_fast' }] },
  });
  assert.deepEqual(s.entry.conditions, [{ indicator: 'close', operator: 'less_than', compare_to: 30 }]);
  assert.equal(s.exit.conditions[0].compare_to, 'ma_fast');
  assert.deepEqual(spec.validate(s), []);
});

test('preset 키는 applyPatch가 무시한다 — 프리셋 선택은 캔버스 몫이다', () => {
  const s = spec.applyPatch(ready(), { preset: 'other', fromDt: '20200101' });
  assert.equal(s.presetId, 'sma_crossover');
  assert.equal(s.name, 'SMA 골든크로스');
  assert.equal(s.fromDt, '20200101');
});

test('patch가 null이거나 객체가 아니면 같은 스펙을 돌려준다', () => {
  const s = ready();
  assert.equal(spec.applyPatch(s, null), s);
  assert.equal(spec.applyPatch(s, 'x'), s);
});

test('applyPatch는 원본을 바꾸지 않는다(불변)', () => {
  const s = ready();
  spec.applyPatch(s, {
    symbols: ['000660'], params: { fast: 10 }, risk: { stop_loss: { enabled: false } }, costs: { fee_bps: 3 },
  });
  assert.deepEqual(s.symbols, ['005930']);
  assert.equal(s.params.fast.default, 20);
  assert.equal(s.risk.stop_loss.enabled, true);
  assert.equal(s.costs.fee_bps, 1.5);
});

// ── 초안 차이(diffFields) ────────────────────────────────────────────────────

test('diffFields는 patch 순서가 아니라 고정 순서·한글 라벨로 달라진 필드만 낸다', () => {
  const before = ready();
  const after = spec.applyPatch(before, {
    costs: { fee_bps: 3 }, symbols: ['000660'], period: 'week', params: { fast: 10 },
  });
  const diff = spec.diffFields(before, after);
  assert.deepEqual(diff.map((d) => [d.key, d.label]), [
    ['symbols', '종목'], ['period', '주기'], ['params', '파라미터'], ['costs', '비용'],
  ]);
  assert.deepEqual(diff[0], { key: 'symbols', label: '종목', before: ['005930'], after: ['000660'] });
});

test('diffFields는 열두 필드를 모두 고정 순서로 낸다', () => {
  const before = ready();
  const after = Object.assign(spec.applyPatch(before, {
    symbols: ['000660'], period: 'week', adjusted: false, fromDt: '20200101', toDt: '20201231',
    params: { fast: 10 },
    indicators: [{ id: 'RSI', alias: 'rsi', params: { period: 14 } }],
    entry: { logic: 'OR', conditions: [{ indicator: 'rsi', operator: 'less_than', compare_to: 30 }] },
    exit: { logic: 'AND', conditions: [{ indicator: 'rsi', operator: 'greater_than', compare_to: 70 }] },
    risk: { take_profit: { enabled: true } },
    costs: { fee_bps: 3 },
  }), { name: '다른 전략' });
  assert.deepEqual(spec.diffFields(before, after).map((d) => [d.key, d.label]), [
    ['name', '전략'], ['symbols', '종목'], ['period', '주기'], ['adjusted', '수정주가'],
    ['fromDt', '시작일'], ['toDt', '종료일'], ['params', '파라미터'], ['indicators', '지표'],
    ['entry', '진입 조건'], ['exit', '청산 조건'], ['risk', '리스크'], ['costs', '비용'],
  ]);
});

test('diffFields의 파라미터는 default 값만 비교하고 이름→값 객체로 낸다', () => {
  const before = ready();
  const diff = spec.diffFields(before, spec.setParam(before, 'slow', 100));
  assert.deepEqual(diff, [{
    key: 'params', label: '파라미터', before: { fast: 20, slow: 60 }, after: { fast: 20, slow: 100 },
  }]);
  // 범위(min/max)만 다른 것은 차이로 치지 않는다
  const rangeOnly = JSON.parse(JSON.stringify(before));
  rangeOnly.params.fast.max = 100;
  assert.deepEqual(spec.diffFields(before, rangeOnly), []);
});

test('diffFields는 같은 스펙이면 빈 배열이다', () => {
  const s = ready();
  assert.deepEqual(spec.diffFields(s, s), []);
  assert.deepEqual(spec.diffFields(s, JSON.parse(JSON.stringify(s))), []);
});

// ── 직렬화 ──────────────────────────────────────────────────────────────────

test('yaml에 data·costs 블록이 항상 들어간다(프리셋 원문과의 차이)', () => {
  const yaml = spec.toYaml(ready());
  assert.match(yaml, /^data:$/m);
  assert.match(yaml, /symbols: \["005930"\]/);
  assert.match(yaml, /^costs:$/m);
  assert.match(yaml, /fee_bps: 1\.5/);
});

test('슬라이더로 바꾼 파라미터가 yaml에 그대로 실린다', () => {
  const s = spec.setParam(ready(), 'fast', 35);
  assert.match(spec.toYaml(s), /fast: \{default: 35,/);
});

test('지표 $참조는 따옴표를 유지한다 — 벗기면 백엔드가 이름을 못 찾는다', () => {
  assert.match(spec.toYaml(ready()), /params: \{period: "\$fast"\}/);
});

test('조건 그룹의 logic과 조건 행이 그대로 실린다', () => {
  const yaml = spec.toYaml(ready());
  assert.match(yaml, /entry:\n {4}logic: AND/);
  assert.match(yaml, /indicator: ma_fast, operator: cross_above, compare_to: ma_slow/);
});

test('숫자 compare_to는 따옴표 없이 나간다', () => {
  const s = spec.addCondition(ready(), 'entry', {
    indicator: 'close', operator: 'greater_than', compare_to: 70,
  });
  assert.match(spec.toYaml(s), /compare_to: 70\}/);
});

test('손절 토글이 yaml에 반영된다', () => {
  const s = ready();
  s.risk.stop_loss = { enabled: false, percent: 8 };
  assert.match(spec.toYaml(s), /stop_loss: {3}\{enabled: false, percent: 8\}/);
});

test('왕복: 프리셋 → 스펙 → yaml → 다시 스펙이 같은 전략을 낸다', () => {
  const first = ready();
  const yaml = spec.toYaml(first);
  const reparsed = spec.parsePresetYaml(yaml);
  assert.deepEqual(reparsed.params, first.params);
  assert.deepEqual(reparsed.indicators, first.indicators);
  assert.deepEqual(reparsed.entry, first.entry);
  assert.deepEqual(reparsed.exit, first.exit);
  assert.deepEqual(reparsed.risk, first.risk);
});

test('오늘 날짜는 YYYYMMDD 8자리다', () => {
  assert.equal(spec.todayYyyymmdd(new Date(2026, 8, 1)), '20260901');
});

// ---------- 검증: 다중 출력 지표 · 코드 경로 ----------

test('validate: 다중 출력 지표의 별칭_출력 이름은 아는 이름이다 — 52주 신고가 돌파(DONCHIAN)', () => {
  const s = Object.assign(spec.createSpec(null), {
    symbols: ['005930'], fromDt: '20240101', toDt: '20240630',
    indicators: [{ id: 'DONCHIAN', alias: 'dc', params: { period: 240 } }],
    entry: { logic: 'AND', conditions: [{ indicator: 'close', operator: 'greater_equal', compare_to: 'dc_upper' }] },
    exit: { logic: 'AND', conditions: [{ indicator: 'close', operator: 'less_equal', compare_to: 'dc_lower' }] },
  });
  assert.deepEqual(spec.validate(s), []);
  // 모르는 별칭은 여전히 잡는다.
  s.exit.conditions[0].compare_to = 'bb_lower';
  assert.deepEqual(spec.validate(s), ['bb_lower는 정의되지 않은 이름입니다']);
});

test('validate: conditions=false면 진입·청산 조건 검사를 건너뛰고 대상·기간만 본다', () => {
  const s = Object.assign(spec.createSpec(null), {
    symbols: [], fromDt: '20240101', toDt: '20240630',
    entry: { logic: 'AND', conditions: [] },
    exit: { logic: 'OR', conditions: [{ indicator: 'nope', operator: 'less_than', compare_to: 1 }] },
  });
  assert.deepEqual(spec.validate(s, { conditions: false }), ['종목을 하나 이상 고르세요']);
  assert.equal(spec.validate(s).length, 3);   // 기본은 조건까지 본다(종목·빈 진입·모르는 이름)
});

test('validate: 종목이 둘 이상이면 실행 전에 알린다 — 백엔드 /runs는 1종목만 받는다', () => {
  const s = Object.assign(spec.createSpec(null), {
    symbols: ['005930', '000660'], fromDt: '20240101', toDt: '20240630',
    entry: { logic: 'AND', conditions: [{ indicator: 'close', operator: 'greater_than', compare_to: 1 }] },
    exit: { logic: 'OR', conditions: [{ indicator: 'close', operator: 'less_than', compare_to: 1 }] },
  });
  assert.deepEqual(spec.validate(s), ['실행은 종목 1개만 지원합니다 — 하나만 남기세요']);
});

test('toYaml: 조건이 없으면 빈 목록으로 적는다 — `conditions:`는 널이라 백엔드가 거절한다', () => {
  const s = Object.assign(spec.createSpec(null), {
    symbols: ['005930'], fromDt: '20240401', toDt: '20260801',
    entry: { logic: 'AND', conditions: [] },
    exit: { logic: 'OR', conditions: [] },
  });
  const y = spec.toYaml(s);
  assert.match(y, /entry:\n\s+logic: AND\n\s+conditions: \[\]/);
  assert.match(y, /exit:\n\s+logic: OR\n\s+conditions: \[\]/);
  assert.ok(!/conditions:\s*\n\s*(exit|risk):/.test(y), '값 없는 conditions: 줄이 남으면 안 된다');
  // 조건이 있으면 예전 그대로 목록 항목으로 적는다.
  const withCond = spec.addCondition(s, 'entry', { indicator: 'close', operator: 'greater_than', compare_to: 1 });
  assert.match(spec.toYaml(withCond), /conditions:\n\s+- \{indicator: close,/);
});
