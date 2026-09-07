// map-legend.js 단위 테스트 — 의존을 전부 주입하므로 Electron이 필요 없다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  certaintyOfEntry, certaintyByEntity, renderMapLegend, ESTIMATED_NAME_CAPTION,
} = require('./map-legend');
const { fakeNode, installFakeDocument, uninstallFakeDocument } = require('./fake-dom');

test.beforeEach(() => {
  installFakeDocument();
  global.window = { AthenaLib: { GraphLiveMap: require('./live-map') } };
});

test.afterEach(() => {
  uninstallFakeDocument();
  delete global.window;
});

// ── 확정성 판정 — 성향 신호 표(summary-table.js dotClass)와 같은 규칙 ────────

test('certaintyOfEntry — 체결·잔고발 사실만 사실이다', () => {
  assert.equal(certaintyOfEntry({ confidence: 'EXTRACTED', tier: 'deterministic' }), 'fact');
  // 대화에서 뽑은 사실은 체결 기록이 아니다 — 표가 테두리만 그리는 것과 같은 판정.
  assert.equal(certaintyOfEntry({ confidence: 'EXTRACTED', tier: 'conversational' }), 'unknown');
  assert.equal(certaintyOfEntry({ confidence: 'INFERRED', tier: 'conversational' }), 'unknown');
});

test('certaintyOfEntry — 애매하다고 기록된 것은 불확실이다', () => {
  assert.equal(certaintyOfEntry({ confidence: 'AMBIGUOUS', tier: 'deterministic' }), 'uncertain');
});

test('certaintyOfEntry — 신호가 없으면 모름이다', () => {
  assert.equal(certaintyOfEntry(null), 'unknown');
  assert.equal(certaintyOfEntry({}), 'unknown');
});

test('certaintyByEntity — 한 엔티티에 여러 줄이면 불확실이 이긴다', () => {
  const by = certaintyByEntity([
    { entity_id: 'a', confidence: 'EXTRACTED', tier: 'deterministic' },
    { entity_id: 'a', confidence: 'AMBIGUOUS', tier: 'conversational' },
    { entity_id: 'b', confidence: 'INFERRED', tier: 'conversational' },
    { entity_id: 'b', confidence: 'EXTRACTED', tier: 'deterministic' },
  ]);
  assert.equal(by.get('a'), 'uncertain');
  assert.equal(by.get('b'), 'fact');
});

test('certaintyByEntity — 신호에 없는 노드는 지도가 모름으로 읽는다', () => {
  const by = certaintyByEntity([{ entity_id: 'a', confidence: 'AMBIGUOUS' }]);
  assert.equal(by.get('없는-노드'), undefined);
});

// ── 범례 — Paper 문면과 표식 ────────────────────────────────────────────────

function labels(container) {
  return container.querySelectorAll('.graph-legend-label').map((n) => n.textContent);
}

test('renderMapLegend — 보드 03·04의 여섯 줄과 보드 07의 채움 세 칸을 그린다', () => {
  const host = fakeNode('div');
  renderMapLegend(host, { clusters: [0, 1], estimatedNames: false });
  assert.deepEqual(labels(host), [
    '색 = 군집', '원 크기 = 연결 수', '사실', '추론', '불확실', '숨은 연관 — 군집을 넘는 연결',
    '사실 · 체결·잔고', '불확실', '그 밖 · 모름',
  ]);
  assert.equal(host.querySelectorAll('.graph-legend-fill-item').length, 3);
});

test('renderMapLegend — 군집 색 표식은 지도가 쓴 군집 수만큼이다', () => {
  const host = fakeNode('div');
  renderMapLegend(host, { clusters: [0, 1, 2], estimatedNames: false });
  const chips = host.querySelectorAll('.graph-legend-cluster-chip');
  assert.equal(chips.length, 3);
  // 지도와 같은 색이어야 한다 — 여기서 팔레트를 다시 구현하면 조용히 갈린다.
  const { clusterColor } = require('./live-map');
  assert.equal(chips[0].getAttribute('style'), `background: ${clusterColor(0)}`);
});

test('renderMapLegend — 확정 이름이 아니면 캡션이 한 번만 붙는다', () => {
  const host = fakeNode('div');
  renderMapLegend(host, { clusters: [0, 1], estimatedNames: true });
  const captions = host.querySelectorAll('.graph-legend-caption');
  assert.equal(captions.length, 1);
  assert.equal(captions[0].textContent, ESTIMATED_NAME_CAPTION);
});

test('renderMapLegend — 확정 이름이면 캡션이 없다', () => {
  const host = fakeNode('div');
  renderMapLegend(host, { clusters: [0], estimatedNames: false });
  assert.equal(host.querySelectorAll('.graph-legend-caption').length, 0);
});

test('renderMapLegend — 다시 그려도 쌓이지 않는다', () => {
  const host = fakeNode('div');
  renderMapLegend(host, { clusters: [0], estimatedNames: true });
  renderMapLegend(host, { clusters: [0], estimatedNames: true });
  assert.equal(host.querySelectorAll('.graph-legend').length, 1);
});
