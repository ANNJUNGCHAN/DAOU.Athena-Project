'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { INDICATOR_DEFS, DEFAULT_INDICATOR_VISIBLE, defaultParamsFor } = require('./chart-indicator-registry');

test('35종 전수 — 레거시 13 + 확장 22 (spec §3)', () => {
  assert.equal(INDICATOR_DEFS.length, 35);
});

test('상단 지표(overlay) 12종 · 하단 지표(pane) 23종', () => {
  const overlay = INDICATOR_DEFS.filter((d) => d.section === 'overlay');
  const pane = INDICATOR_DEFS.filter((d) => d.section === 'pane');
  assert.equal(overlay.length, 12);
  assert.equal(pane.length, 23);
});

test('구현 5종 — ma·boll·volMa·rsi·macd, 나머지 30종은 미구현', () => {
  const implemented = INDICATOR_DEFS.filter((d) => d.implemented).map((d) => d.id).sort();
  assert.deepEqual(implemented, ['boll', 'ma', 'macd', 'rsi', 'volMa'].sort());
  assert.equal(INDICATOR_DEFS.filter((d) => !d.implemented).length, 30);
});

test('id 중복 없음', () => {
  const ids = INDICATOR_DEFS.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('기본 on은 이평선·거래량MA 둘뿐', () => {
  assert.deepEqual(DEFAULT_INDICATOR_VISIBLE.sort(), ['ma', 'volMa'].sort());
});

test('미구현 지표는 params가 없다(설정 패널에 입력 필드를 만들지 않는다)', () => {
  for (const d of INDICATOR_DEFS) {
    if (!d.implemented) assert.ok(!d.params, `${d.id}는 미구현인데 params가 있다`);
  }
});

test('defaultParamsFor: 구현 지표는 기본값 객체를 돌려주고 배열은 복사본이다', () => {
  const p = defaultParamsFor('ma');
  assert.deepEqual(p.periods, [5, 10, 20, 60, 120]);
  p.periods.push(999);
  const p2 = defaultParamsFor('ma');
  assert.deepEqual(p2.periods, [5, 10, 20, 60, 120]); // 원본 오염 안 됨
});

test('defaultParamsFor: 미구현/미존재 id는 빈 객체', () => {
  assert.deepEqual(defaultParamsFor('sar'), {});
  assert.deepEqual(defaultParamsFor('no-such-id'), {});
});
