'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clusterStats, suggestedCount } = require('./empty-canvas');

test('clusterStats — 노드 수와 군집 수(배정된 것만)를 센다', () => {
  const nodes = [
    { entity_id: 'a', cluster: 0 },
    { entity_id: 'b', cluster: 0 },
    { entity_id: 'c', cluster: 1 },
    { entity_id: 'd', cluster: -1 }, // 미배정 — 군집 수에서 제외
  ];
  assert.deepEqual(clusterStats(nodes), { entities: 4, clusters: 2 });
});

test('clusterStats — 노드가 없으면 null (0을 보여주지 않는다)', () => {
  assert.equal(clusterStats([]), null);
  assert.equal(clusterStats(undefined), null);
  assert.equal(clusterStats(null), null);
});

test('clusterStats — 모두 미배정이면 군집 0', () => {
  assert.deepEqual(clusterStats([{ cluster: -1 }, { cluster: -1 }]), { entities: 2, clusters: 0 });
});

test('suggestedCount — questions 길이를 그대로 돌려준다', () => {
  assert.equal(suggestedCount([{ question: 'a' }, { question: 'b' }]), 2);
});

test('suggestedCount — 빈 배열·비배열은 null (0건 힌트를 보이지 않는다)', () => {
  assert.equal(suggestedCount([]), null);
  assert.equal(suggestedCount(undefined), null);
  assert.equal(suggestedCount(null), null);
});
