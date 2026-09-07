// live-map.js 단위 테스트 — buildEdges는 순수 함수라 vis-network 없이 잰다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildEdges, nodeFill, signatureOf, CONFIDENCE } = require('./live-map');

const THEME = { text: '#14171d', dim: '#5b6270', halo: '#ffffff', line: 'rgba(16,19,26,0.14)' };
const HIDDEN_COLOR = '#ee137b';

// 종목(군집 0) 4개 ↔ 테마(군집 1) 4개 — 실제 그래프처럼 엣지 7개가 전부
// 군집 경계를 넘는다. 옛 판은 이 7개를 모두 핑크로 칠했다.
function crossingPayload() {
  const nodes = [];
  for (let i = 0; i < 4; i += 1) nodes.push({ entity_id: `s${i}`, name: `종목${i}`, cluster: 0, degree: 2 });
  for (let i = 0; i < 4; i += 1) nodes.push({ entity_id: `t${i}`, name: `테마${i}`, cluster: 1, degree: 2 });
  const edges = [
    ['s0', 't0'], ['s1', 't1'], ['s2', 't2'], ['s3', 't3'],
    ['s0', 't1'], ['s1', 't2'], ['s2', 't3'],
  ];
  return {
    revision: 1,
    nodes,
    edges,
    edge_details: edges.map(([source, target]) => ({ source, target, confidence: 'EXTRACTED', kinds: ['co_mention'] })),
  };
}

const TOP3 = [['s0', 't0'], ['s1', 't1'], ['s2', 't2']];

test('핑크 점선은 숨은 연관 상위 3쌍에만 붙는다', () => {
  const built = buildEdges(crossingPayload(), THEME, TOP3);
  const pink = built.filter((e) => e.color.color === HIDDEN_COLOR);
  assert.equal(pink.length, 3);
  assert.deepEqual(pink.map((e) => [e.from, e.to]), TOP3);
  for (const edge of pink) {
    assert.deepEqual(edge.dashes, [6, 4]);
    assert.equal(edge.width, 2);
  }
});

test('군집을 넘어도 상위 3건 밖이면 확정성 색이다', () => {
  const built = buildEdges(crossingPayload(), THEME, TOP3);
  const rest = built.filter((e) => !TOP3.some(([a, b]) => e.from === a && e.to === b));
  assert.equal(rest.length, 4);
  for (const edge of rest) {
    assert.notEqual(edge.color.color, HIDDEN_COLOR);
    assert.equal(edge.width, 1.4);
  }
});

test('툴팁의 · 숨은 연관도 같은 셋에만 붙는다', () => {
  const built = buildEdges(crossingPayload(), THEME, TOP3);
  assert.equal(built.filter((e) => e.title.includes('· 숨은 연관')).length, 3);
});

test('넘겨준 쌍이 없으면 강조가 하나도 없다 — 숨은 연관을 아직 못 받은 상태', () => {
  const built = buildEdges(crossingPayload(), THEME, []);
  assert.equal(built.filter((e) => e.color.color === HIDDEN_COLOR).length, 0);
});

test('쌍의 방향은 가리지 않는다 — 요약이 반대로 준 쌍도 같은 엣지를 가리킨다', () => {
  const built = buildEdges(crossingPayload(), THEME, [['t0', 's0']]);
  const pink = built.filter((e) => e.color.color === HIDDEN_COLOR);
  assert.deepEqual(pink.map((e) => [e.from, e.to]), [['s0', 't0']]);
});

// ── 노드 채움 = 확정성(보드 07 2QCN-2) ──────────────────────────────────────
// 색은 계속 군집이다(보드 03·04) — 확정성은 채움의 유무와 테두리로 말한다.

test('nodeFill — 사실은 군집색으로 채운다', () => {
  const fill = nodeFill('#68BDF6', 'fact', THEME);
  assert.equal(fill.background, '#68BDF6');
  assert.equal(fill.border, '#68BDF6');
});

test('nodeFill — 불확실은 군집색을 지키고 주황 테두리로 말한다', () => {
  const fill = nodeFill('#68BDF6', 'uncertain', THEME);
  assert.equal(fill.background, '#68BDF6');
  assert.equal(fill.border, CONFIDENCE.AMBIGUOUS.color);
  assert.equal(fill.borderWidth, 3);
});

test('nodeFill — 모름은 채우지 않는다, 군집색은 테두리에 남는다', () => {
  const fill = nodeFill('#68BDF6', 'unknown', THEME);
  assert.equal(fill.background, THEME.halo);
  assert.equal(fill.border, '#68BDF6');
});

test('signatureOf — 티어가 바뀌면 지도를 다시 그린다', () => {
  const payload = crossingPayload();
  const before = signatureOf(payload, [], new Map([['s0', 'unknown']]));
  const after = signatureOf(payload, [], new Map([['s0', 'uncertain']]));
  assert.notEqual(before, after);
});
