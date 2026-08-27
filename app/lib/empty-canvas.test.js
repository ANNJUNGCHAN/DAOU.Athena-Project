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

test('pickEmptyCopy — 시드로 결정적이고, 시간대 문구가 풀에 들어온다', () => {
  const { pickEmptyCopy } = require('./empty-canvas');
  // seed 0 → 항상 기본 문구
  assert.equal(pickEmptyCopy({ hour: 10, seed: 0 }).title, '무엇이든 물어보세요');
  // seed 1 → 장중(9~16시) 문구
  assert.equal(pickEmptyCopy({ hour: 10, seed: 1 }).title, '지금 시장이 움직이고 있습니다');
  // 같은 입력은 같은 결과 — 회전은 시드가 만든다
  assert.deepEqual(pickEmptyCopy({ hour: 10, seed: 1 }), pickEmptyCopy({ hour: 10, seed: 1 }));
});

test('pickEmptyCopy — 성향 라벨은 있을 때만 풀에 들어온다(없는 성향을 지어내지 않는다)', () => {
  const { pickEmptyCopy } = require('./empty-canvas');
  // hour 없음 + 성향 없음 → 풀은 기본 문구 하나뿐
  assert.equal(pickEmptyCopy({ seed: 7 }).title, '무엇이든 물어보세요');
  // 성향 라벨이 있으면 seed 2(풀 3번째)가 성향 문구를 고른다
  const c = pickEmptyCopy({ hour: 10, profileTop: '반도체 대형주', seed: 2 });
  assert.equal(c.title, '반도체 대형주 쪽, 요즘 자주 보시죠?');
});
