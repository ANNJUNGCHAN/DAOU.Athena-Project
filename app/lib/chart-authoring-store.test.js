'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  periodToken,
  authoringKey,
  serializeAuthoring,
  deserializeAuthoring,
  createAuthoringStore,
} = require('./chart-authoring-store');

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    _map: map,
  };
}

test('periodToken: 일·주·월·년은 그대로, 분·틱은 세분을 붙인다', () => {
  assert.equal(periodToken('D', 1), 'D');
  assert.equal(periodToken('MIN', 3), 'MIN3');
  assert.equal(periodToken('TICK', 5), 'TICK5');
});

test('authoringKey: chart.authoring.{symbol}.{token}', () => {
  assert.equal(authoringKey('005930', 'D'), 'chart.authoring.005930.D');
  assert.equal(authoringKey('005930', 'MIN3'), 'chart.authoring.005930.MIN3');
});

test('직렬화 왕복 — 4종 상태가 보존된다', () => {
  const state = {
    form: 'bar',
    volumeProfileOn: true,
    visible: new Set(['ma', 'boll']),
    params: { ma: { periods: [5, 20] }, boll: { period: 20, mult: 2 } },
    drawings: [],
  };
  const restored = deserializeAuthoring(JSON.stringify(serializeAuthoring(state)));
  assert.equal(restored.form, 'bar');
  assert.equal(restored.volumeProfileOn, true);
  assert.deepEqual(restored.indicators.visible.sort(), ['boll', 'ma']);
  assert.deepEqual(restored.indicators.params.boll, { period: 20, mult: 2 });
});

test('스키마 화이트리스트 — 직렬화 결과에 지표·형식·매물대·드로잉 외 키가 없다', () => {
  const out = serializeAuthoring({
    form: 'candle',
    visible: new Set(['ma']),
    params: {},
    apiKey: 'SECRET', // 이런 키가 들어와도
    account: '1234',
  });
  assert.deepEqual(Object.keys(out).sort(), ['drawings', 'form', 'indicators', 'v', 'volumeProfileOn']);
});

test('역직렬화 가드 — 손상 JSON·버전 불일치·형 오류는 null', () => {
  assert.equal(deserializeAuthoring('not json{'), null);
  assert.equal(deserializeAuthoring(JSON.stringify({ v: 99, form: 'candle', indicators: { visible: [] } })), null);
  assert.equal(deserializeAuthoring(JSON.stringify({ v: 1, form: 'pie', indicators: { visible: [] } })), null);
  assert.equal(deserializeAuthoring(null), null);
});

test('store: 주기별 독립 저장·복원 — D와 W가 서로를 덮지 않는다', () => {
  const store = createAuthoringStore(memoryStorage());
  store.save('005930', 'D', { form: 'bar', volumeProfileOn: true, visible: new Set(['ma', 'boll']), params: {} });
  store.save('005930', 'W', { form: 'candle', volumeProfileOn: false, visible: new Set(['ma']), params: {} });
  const d = store.load('005930', 'D');
  const w = store.load('005930', 'W');
  assert.equal(d.form, 'bar');
  assert.equal(d.volumeProfileOn, true);
  assert.deepEqual(d.indicators.visible.sort(), ['boll', 'ma']);
  assert.equal(w.form, 'candle');
  assert.equal(w.volumeProfileOn, false);
});

test('store: storage가 없으면 비활성 — load null·save false', () => {
  const store = createAuthoringStore(null);
  assert.equal(store.enabled, false);
  assert.equal(store.load('005930', 'D'), null);
  assert.equal(store.save('005930', 'D', {}), false);
});
