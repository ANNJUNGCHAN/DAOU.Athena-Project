// cluster-layout.js 단위 테스트 — 좌표 배치와 응집도 통과 배선을 검증한다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { layoutClusterMap } = require('./cluster-layout');

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
