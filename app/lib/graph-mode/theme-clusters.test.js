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

test('groupThemeClusters — 대표는 지도와 같은 규칙(최대 차수)으로 고른 멤버 이름이다', () => {
  // 백엔드의 cluster_representative_labels("… 외 N종목 · security")는 설명 문장이라
  // 카드 제목에 쓰기엔 길고 raw kind가 섞인다 — 같은 payload의 degree/name으로
  // 지도와 같은 이름 하나를 고른다(두 화면이 같은 군집을 같은 이름으로 부른다).
  const grouped = groupThemeClusters(payload());
  const first = grouped.find((c) => c.cluster === 0);
  assert.ok(first.representative, 'cluster 0에 대표 이름이 붙는다');

  // 이름이 하나도 없는(구버전) payload면 백엔드 라벨로 폴백한다.
  const nameless = groupThemeClusters({
    nodes: [{ entity_id: 'x', name: '', kind: 'security', cluster: 0, degree: 1 }],
    cluster_representative_labels: { 0: '한미반도체 외 1종목 · security' },
  });
  assert.equal(nameless[0].representative, '한미반도체 외 1종목 · security');
});

test('groupThemeClusters — representative가 있어도 name은 여전히 null이다(§0 발견1, 별도 필드)', () => {
  const clusters = groupThemeClusters(payload({
    cluster_representative_labels: { 0: '한미반도체 외 1종목 · stock', 1: 'C · stock' },
  }));
  assert.ok(clusters.every((c) => c.name === null));
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

test('renderThemeClusters — 단서가 하나도 없으면 "이름 없는 군집"으로 떨어지고 종목수를 그린다', () => {
  const container = fakeNode('div');
  renderThemeClusters(container, [
    { cluster: 0, size: 9, name: null, cohesion: undefined },
    { cluster: 1, size: 6, name: null, cohesion: undefined },
  ]);
  const cards = container.querySelectorAll('.theme-cluster-card');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].querySelector('.theme-cluster-name').textContent, '이름 없는 군집');
  assert.equal(cards[0].querySelector('.theme-cluster-unnamed-badge'), null, '추정이 아니라 없는 것이다');
  assert.equal(cards[0].querySelector('.theme-cluster-count').textContent, '9종목');
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

test('renderThemeClusters — 이름이 없으면 대표 이름이 제목이 되고 "추정"으로 신호한다', () => {
  const container = fakeNode('div');
  renderThemeClusters(container, [
    { cluster: 0, size: 2, name: null, representative: '한미반도체' },
  ]);
  const card = container.querySelector('.theme-cluster-card');
  assert.equal(card.querySelector('.theme-cluster-name').textContent, '한미반도체');
  assert.equal(card.querySelector('.theme-cluster-unnamed-badge').textContent, '추정');
  assert.ok(String(card.querySelector('.theme-cluster-name').attrs.class).includes('is-estimated'));
});

test('renderThemeClusters — representative가 없으면(undefined, 구버전 backend) 서브텍스트를 생략한다', () => {
  const container = fakeNode('div');
  renderThemeClusters(container, [{ cluster: 0, size: 9, name: null, representative: undefined }]);
  assert.equal(container.querySelector('.theme-cluster-representative'), null);
});

// 회귀 가드(사용자 확정) — 대표 설명은 name과 분리된 필드다. representative가
// 있어도 "이름 없음" 배지·shouldWarnUnnamed 임계 판정은 절대 안 바뀐다.
test('renderThemeClusters — 대표 이름을 써도 경고 판정은 여전히 name 유무로만 갈린다', () => {
  const container = fakeNode('div');
  renderThemeClusters(container, [
    { cluster: 0, size: 9, name: '반도체 대형주', representative: undefined },
    { cluster: 1, size: 6, name: null, representative: '한미반도체' },
  ]);
  const cards = container.querySelectorAll('.theme-cluster-card');
  assert.equal(cards[0].querySelector('.theme-cluster-name').textContent, '반도체 대형주');
  assert.equal(cards[0].querySelector('.theme-cluster-unnamed-badge'), null, '확정 이름엔 추정 배지가 없다');
  assert.equal(cards[1].querySelector('.theme-cluster-unnamed-badge').textContent, '추정');
  // 경고 클래스는 대표 이름 유무가 아니라 name 유무로만 갈린다(§0 r5).
  assert.equal(String(cards[0].attrs.class).includes('is-unnamed-warn'), false);
  assert.equal(String(cards[1].attrs.class).includes('is-unnamed-warn'), true);
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

// ── AI 추정 라벨(WP-F F6) ───────────────────────────────────────────────────

test('groupThemeClusters — cluster_ai_labels가 있으면 aiLabel로 통과시키고, 없으면 undefined', () => {
  const withAi = groupThemeClusters(payload({
    cluster_ai_labels: { 0: '반도체 밸류체인' },
  }));
  assert.equal(withAi.find((c) => c.cluster === 0).aiLabel, '반도체 밸류체인');
  assert.equal(withAi.find((c) => c.cluster === 1).aiLabel, undefined, '라벨 없는 군집은 undefined');
  const withoutAi = groupThemeClusters(payload());
  assert.ok(withoutAi.every((c) => c.aiLabel === undefined), '휴면·구버전 backend엔 필드 자체가 없다');
});

test('renderThemeClusters — aiLabel이 대표 이름보다 앞선다(더 의미적인 단서다)', () => {
  const container = fakeNode('div');
  renderThemeClusters(container, [
    { cluster: 0, size: 2, name: null, aiLabel: '반도체 밸류체인', representative: '한미반도체' },
    { cluster: 1, size: 3, name: null, aiLabel: undefined, representative: 'KB금융' },
  ]);
  const cards = container.querySelectorAll('.theme-cluster-card');
  assert.equal(cards[0].querySelector('.theme-cluster-name').textContent, '반도체 밸류체인');
  assert.equal(cards[1].querySelector('.theme-cluster-name').textContent, 'KB금융');
  assert.deepEqual(
    cards.map((c) => c.querySelector('.theme-cluster-unnamed-badge').textContent),
    ['추정', '추정'],
    '둘 다 확정 이름이 아니다',
  );
});

// 회귀 가드(G-F7) — aiLabel은 name을 대체하지 않는다. 라벨이 있어도 "이름 없음"
// 배지·shouldWarnUnnamed 판정은 계속 name만 본다.
test('renderThemeClusters — aiLabel이 있어도 "이름 없음" 배지·경고 판정은 안 바뀐다', () => {
  const container = fakeNode('div');
  renderThemeClusters(container, [
    { cluster: 0, size: 2, name: null, aiLabel: '반도체 밸류체인' },
  ]);
  const card = container.querySelectorAll('.theme-cluster-card')[0];
  assert.ok(card.querySelector('.theme-cluster-unnamed-badge'), '이름 없음 배지는 그대로다');
});
