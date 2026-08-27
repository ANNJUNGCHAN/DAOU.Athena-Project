// theme-clusters.js 단위 테스트 — 의존을 전부 주입하므로 Electron이 필요 없다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const clusterLayout = require('./cluster-layout');
const { groupThemeClusters, shouldWarnUnnamed, renderThemeClusters } = require('./theme-clusters');
const { fakeNode, installFakeDocument, uninstallFakeDocument } = require('./fake-dom');

test.beforeEach(() => {
  installFakeDocument();
  global.window = { AthenaLib: { GraphClusterLayout: clusterLayout } };
});

test.afterEach(() => {
  uninstallFakeDocument();
  delete global.window;
});

function payload(overrides) {
  return {
    nodes: [
      { entity_id: 'a', name: 'A', kind: 'stock', cluster: 0, degree: 3 },
      { entity_id: 'b', name: 'B', kind: 'stock', cluster: 0, degree: 2 },
      { entity_id: 'c', name: 'C', kind: 'stock', cluster: 1, degree: 1 },
    ],
    ...overrides,
  };
}

// ── groupThemeClusters — cluster-layout.js의 groupByCluster와 일치하는지 ────

test('groupThemeClusters — 군집별 size가 groupByCluster와 일치한다', () => {
  const groups = clusterLayout.groupByCluster(payload().nodes);
  const clusters = groupThemeClusters(payload());
  assert.equal(clusters.length, groups.length);
  for (let i = 0; i < groups.length; i += 1) {
    assert.equal(clusters[i].cluster, groups[i].cluster);
    assert.equal(clusters[i].size, groups[i].members.length);
  }
});

test('groupThemeClusters — 이름은 항상 null이다(§0 발견1, 이름 파이프라인 없음)', () => {
  const clusters = groupThemeClusters(payload());
  assert.ok(clusters.every((c) => c.name === null));
});

test('groupThemeClusters — -1(미분류)은 테마 군집이 아니라 제외한다', () => {
  const p = payload({
    nodes: [
      { entity_id: 'a', cluster: 0 },
      { entity_id: 'b', cluster: -1 },
    ],
  });
  const clusters = groupThemeClusters(p);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].cluster, 0);
});

test('groupThemeClusters — 노드가 없으면 빈 배열', () => {
  assert.deepEqual(groupThemeClusters(payload({ nodes: [] })), []);
  assert.deepEqual(groupThemeClusters(null), []);
});

test('groupThemeClusters — cluster_cohesion이 있으면 통과시키고, 없으면 undefined', () => {
  const withCohesion = groupThemeClusters(payload({ cluster_cohesion: { 0: 0.74, 1: 0.19 } }));
  assert.equal(withCohesion.find((c) => c.cluster === 0).cohesion, 0.74);
  assert.equal(withCohesion.find((c) => c.cluster === 1).cohesion, 0.19);

  const withoutCohesion = groupThemeClusters(payload());
  assert.ok(withoutCohesion.every((c) => c.cohesion === undefined), '구버전 backend엔 필드 자체가 없다');
});

// ── shouldWarnUnnamed — 임계 규칙(§0 r5) ────────────────────────────────────

test('shouldWarnUnnamed — 0/N(전부 무명)이면 경고 미적용', () => {
  assert.equal(shouldWarnUnnamed(0, 3), false);
});

test('shouldWarnUnnamed — N/N(전부 유명)이면 경고 미적용', () => {
  assert.equal(shouldWarnUnnamed(3, 3), false);
});

test('shouldWarnUnnamed — 0 < named < total(부분 무명)이면 경고 적용', () => {
  assert.equal(shouldWarnUnnamed(1, 3), true);
  assert.equal(shouldWarnUnnamed(2, 3), true);
});

// ── renderThemeClusters — 순수 렌더 ──────────────────────────────────────────

test('renderThemeClusters — 카드마다 이름없음 배지·종목수를 그린다', () => {
  const container = fakeNode('div');
  renderThemeClusters(container, [
    { cluster: 0, size: 9, name: null, cohesion: undefined },
    { cluster: 1, size: 6, name: null, cohesion: undefined },
  ]);
  const cards = container.querySelectorAll('.theme-cluster-card');
  assert.equal(cards.length, 2);
  const badge = cards[0].querySelector('.theme-cluster-unnamed-badge');
  assert.equal(badge.textContent, '이름 없음');
  const count = cards[0].querySelector('.theme-cluster-count');
  assert.equal(count.textContent, '9종목');
});

test('renderThemeClusters — 항목이 없으면 아예 안 그린다(§0 정직한 빈 데이터)', () => {
  const container = fakeNode('div');
  renderThemeClusters(container, []);
  assert.equal(container.children.length, 0);
});

test('renderThemeClusters — 헤더에 "N개 중 M개"가 붙는다(limit 적용)', () => {
  const container = fakeNode('div');
  const clusters = [
    { cluster: 0, size: 9, name: null }, { cluster: 1, size: 6, name: null },
    { cluster: 2, size: 4, name: null }, { cluster: 3, size: 2, name: null },
  ];
  renderThemeClusters(container, clusters, { limit: 3 });
  const subtitle = container.querySelector('.theme-clusters-subtitle');
  assert.equal(subtitle.textContent, '4개 중 3개');
  assert.equal(container.querySelectorAll('.theme-cluster-card').length, 3, 'limit을 넘는 카드는 안 그린다');
});

test('renderThemeClusters — cohesion이 있으면 진행바·수치를 그린다', () => {
  const container = fakeNode('div');
  renderThemeClusters(container, [{ cluster: 0, size: 9, name: null, cohesion: 0.74 }]);
  const value = container.querySelector('.theme-cluster-cohesion');
  assert.equal(value.textContent, '응집 0.74');
  const fill = container.querySelector('.theme-cluster-bar-fill');
  assert.equal(fill.attrs.style, 'width: 74%');
});

test('renderThemeClusters — cohesion이 없으면(undefined) 진행바·수치를 생략한다', () => {
  const container = fakeNode('div');
  renderThemeClusters(container, [{ cluster: 0, size: 9, name: null, cohesion: undefined }]);
  assert.equal(container.querySelector('.theme-cluster-cohesion'), null);
  assert.equal(container.querySelector('.theme-cluster-bar'), null);
});

test('renderThemeClusters — 0/N(전부 무명)이면 경고 클래스가 안 붙는다', () => {
  const container = fakeNode('div');
  renderThemeClusters(container, [
    { cluster: 0, size: 9, name: null },
    { cluster: 1, size: 6, name: null },
  ]);
  const warnCards = container.querySelectorAll('.is-unnamed-warn');
  assert.equal(warnCards.length, 0);
});

test('renderThemeClusters — 부분 무명(모의 데이터)이면 무명 카드에만 경고 클래스가 붙는다', () => {
  const container = fakeNode('div');
  renderThemeClusters(container, [
    { cluster: 0, size: 9, name: '반도체 대형주' },
    { cluster: 1, size: 6, name: null },
  ]);
  const cards = container.querySelectorAll('.theme-cluster-card');
  assert.equal(String(cards[0].attrs.class).includes('is-unnamed-warn'), false, '이름 있는 카드는 경고 없음');
  assert.equal(String(cards[1].attrs.class).includes('is-unnamed-warn'), true, '무명 카드만 경고');
});

test('renderThemeClusters — 컨테이너가 없으면 조용히 넘어간다', () => {
  assert.equal(renderThemeClusters(null, [{ cluster: 0, size: 1 }]), null);
});

test('renderThemeClusters — 다시 그리면 이전 내용을 지운다', () => {
  const container = fakeNode('div');
  renderThemeClusters(container, [{ cluster: 0, size: 9, name: null }, { cluster: 1, size: 6, name: null }]);
  renderThemeClusters(container, [{ cluster: 0, size: 9, name: null }]);
  assert.equal(container.children.length, 1, '표가 쌓이지 않는다');
});
