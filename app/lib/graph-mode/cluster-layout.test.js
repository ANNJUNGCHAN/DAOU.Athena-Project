// cluster-layout.js 단위 테스트 — 좌표 배치와 응집도 통과 배선을 검증한다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { layoutClusterMap, aggregateClusterEdges } = require('./cluster-layout');

const VIEWPORT = { width: 800, height: 600 };

function payload(extra) {
  return {
    revision: 4,
    nodes: [
      { entity_id: 'e:a', name: '반도체', kind: 'theme', cluster: 0, degree: 3 },
      { entity_id: 'e:b', name: '장비', kind: 'company', cluster: 0, degree: 1 },
      { entity_id: 'e:c', name: '고배당', kind: 'theme', cluster: 1, degree: 2 },
    ],
    edges: [
      ['e:a', 'e:b'],
      ['e:a', 'e:c'],
    ],
    ...extra,
  };
}

test('cluster_cohesion이 있으면 placed.clusters[i].cohesion으로 통과만 시킨다', () => {
  const layout = layoutClusterMap(
    payload({ cluster_cohesion: { 0: 1, 1: 0 } }),
    VIEWPORT
  );
  const byCluster = new Map(layout.clusters.map((c) => [c.cluster, c]));
  assert.equal(byCluster.get(0).cohesion, 1);
  assert.equal(byCluster.get(1).cohesion, 0);
});

test('cluster_cohesion 필드가 없으면 cohesion은 undefined로 폴백한다(구버전 backend 대비)', () => {
  const layout = layoutClusterMap(payload(), VIEWPORT);
  for (const cluster of layout.clusters) {
    assert.equal(cluster.cohesion, undefined);
  }
});

test('cluster_ai_labels가 있으면 placed.clusters[i].aiLabel로 통과만 시킨다 — name은 계속 비운다(G-F7)', () => {
  const layout = layoutClusterMap(
    payload({ cluster_ai_labels: { 0: '반도체 밸류체인', 1: '배당 방어' } }),
    VIEWPORT
  );
  const byCluster = new Map(layout.clusters.map((c) => [c.cluster, c]));
  assert.equal(byCluster.get(0).aiLabel, '반도체 밸류체인');
  assert.equal(byCluster.get(1).aiLabel, '배당 방어');
  for (const cluster of layout.clusters) {
    assert.equal(cluster.name, undefined, 'AI 추정 라벨이 name("이름 없음" 배지·namedCount 판정 축)을 채우면 안 된다');
  }
});

test('cluster_ai_labels가 없으면 aiLabel은 undefined로 폴백한다(휴면·실패·구버전 backend)', () => {
  const layout = layoutClusterMap(payload(), VIEWPORT);
  for (const cluster of layout.clusters) {
    assert.equal(cluster.aiLabel, undefined);
  }
});

// ── 엣지 메타데이터(스텝13, 스텝13-보정 백엔드 예외의 additive edge_details) ────

test('edge_details가 있으면 kind/tier/confidence가 해당 엣지에 실린다', () => {
  const layout = layoutClusterMap(
    payload({
      edge_details: [{ source: 'e:a', target: 'e:b', kinds: ['보유'], tier: 'deterministic', confidence: 'EXTRACTED' }],
    }),
    VIEWPORT
  );
  const ab = layout.edges.find((e) => (e.from === 'e:a' && e.to === 'e:b') || (e.from === 'e:b' && e.to === 'e:a'));
  assert.deepEqual(ab.kinds, ['보유']);
  assert.equal(ab.tier, 'deterministic');
  assert.equal(ab.confidence, 'EXTRACTED');
});

test('edge_details의 source/target 순서가 엣지와 반대여도(무향) 그대로 매칭된다', () => {
  const layout = layoutClusterMap(
    payload({ edge_details: [{ source: 'e:c', target: 'e:a', kinds: ['언급'], tier: 'conversational', confidence: 'INFERRED' }] }),
    VIEWPORT
  );
  const ac = layout.edges.find((e) => (e.from === 'e:a' && e.to === 'e:c') || (e.from === 'e:c' && e.to === 'e:a'));
  assert.equal(ac.confidence, 'INFERRED');
});

test('edge_details가 없으면(백엔드 예외 미승인/구버전) kind/tier/confidence가 전부 undefined다(§0 정책)', () => {
  const layout = layoutClusterMap(payload(), VIEWPORT);
  for (const edge of layout.edges) {
    assert.equal(edge.kinds, undefined);
    assert.equal(edge.tier, undefined);
    assert.equal(edge.confidence, undefined);
  }
});

test('edge_details에 없는 엣지는 조용히 메타데이터 없이 남는다(부분 커버리지도 안 죽는다)', () => {
  const layout = layoutClusterMap(
    payload({ edge_details: [{ source: 'e:a', target: 'e:b', kinds: ['보유'], tier: 'deterministic', confidence: 'EXTRACTED' }] }),
    VIEWPORT
  );
  const ac = layout.edges.find((e) => (e.from === 'e:a' && e.to === 'e:c') || (e.from === 'e:c' && e.to === 'e:a'));
  assert.equal(ac.confidence, undefined);
});

// ── aggregateClusterEdges(스텝11) — 개별 엔티티 엣지를 군집 쌍으로 축약 ────────

function mockPlaced(overrides) {
  // edges는 layoutClusterMap()이 이미 처리한 형태(payload의 원본 [from,to] 쌍
  // 배열이 아니라 {from,to,...} 객체 배열, cluster-layout.js:117~135 참고)다 —
  // aggregateClusterEdges()는 layoutClusterMap() 내부에서만 불리므로 이 형태를 받는다.
  return {
    revision: 1,
    nodes: [
      { entity_id: 'a', cluster: 0 },
      { entity_id: 'b', cluster: 0 },
      { entity_id: 'c', cluster: 1 },
      { entity_id: 'd', cluster: 2 },
    ],
    edges: [
      { from: 'a', to: 'c' },
      { from: 'b', to: 'c' },
      { from: 'a', to: 'd' },
    ],
    clusters: [
      { cluster: 0, size: 2, x: 100, y: 100, radius: 40 },
      { cluster: 1, size: 1, x: 300, y: 100, radius: 30 },
      { cluster: 2, size: 1, x: 100, y: 300, radius: 30 },
    ],
    ...overrides,
  };
}

test('layoutClusterMap()의 반환값에 clusterEdges가 자동으로 딸려온다(controller.js를 안 건드리고도 배선된다)', () => {
  const layout = layoutClusterMap(payload(), VIEWPORT); // e:a-e:b(같은 군집)·e:a-e:c(군집 0→1)
  assert.ok(Array.isArray(layout.clusterEdges));
  assert.equal(layout.clusterEdges.length, 1, '군집 0↔1 하나만 — e:a-e:b는 군집 내부라 군집간 엣지가 아니다');
});

test('같은 군집 쌍을 잇는 엔티티 엣지가 여러 개면 count로 축약된다(군집간 연결은 1개, count=2)', () => {
  const edges = aggregateClusterEdges(mockPlaced());
  assert.equal(edges.length, 2, '군집 0↔1(count 2), 0↔2(count 1) 두 쌍');
  const zeroOne = edges.find((e) => (e.from === 0 && e.to === 1) || (e.from === 1 && e.to === 0));
  assert.equal(zeroOne.count, 2, 'a-c, b-c 둘 다 0↔1이라 축약된다');
});

test('군집 내부 엣지는 군집간 엣지로 집계되지 않는다', () => {
  const edges = aggregateClusterEdges(mockPlaced({ edges: [{ from: 'a', to: 'b' }] })); // 둘 다 cluster 0
  assert.equal(edges.length, 0);
});

test('좌표는 군집 버블 중심(placed.clusters의 x/y)을 그대로 쓴다(새 스케일 발명 안 함, 원칙1)', () => {
  const edges = aggregateClusterEdges(mockPlaced());
  const zeroOne = edges.find((e) => (e.from === 0 && e.to === 1) || (e.from === 1 && e.to === 0));
  assert.equal(zeroOne.x1, 100);
  assert.equal(zeroOne.y1, 100);
  assert.equal(zeroOne.x2, 300);
  assert.equal(zeroOne.y2, 100);
});

test('surprisingPairs를 안 주면(현재 실제 상태) 전부 isSurprising:false다(§0 정직한 빈 데이터)', () => {
  const edges = aggregateClusterEdges(mockPlaced());
  assert.ok(edges.every((e) => e.isSurprising === false));
});

test('surprisingPairs가 겹치는 군집 쌍만 isSurprising:true가 된다', () => {
  const edges = aggregateClusterEdges(mockPlaced(), [{ source_cluster: 0, target_cluster: 1 }]);
  const zeroOne = edges.find((e) => (e.from === 0 && e.to === 1) || (e.from === 1 && e.to === 0));
  const zeroTwo = edges.find((e) => (e.from === 0 && e.to === 2) || (e.from === 2 && e.to === 0));
  assert.equal(zeroOne.isSurprising, true);
  assert.equal(zeroTwo.isSurprising, false);
});

test('nodes/edges/clusters 중 하나라도 없으면 빈 배열(터지지 않는다)', () => {
  assert.deepEqual(aggregateClusterEdges(null), []);
  assert.deepEqual(aggregateClusterEdges(mockPlaced({ edges: [] })), []);
  assert.deepEqual(aggregateClusterEdges(mockPlaced({ clusters: [] })), []);
});
