'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isEntityCall, extractEntityDetail, entityStepNote } = require('./brain-entity-forward');

const RESOLVED = {
  revision: 12,
  query: '한미반도체',
  resolved: true,
  entity_id: 'e:hanmi',
  kind: 'security',
  name: '한미반도체',
  degree: 7,
  relations: [{ relation_id: 'r1' }, { relation_id: 'r2' }],
  timeline: [{ seq: 3 }, { seq: 2 }, { seq: 1 }],
  candidates: [],
};

test('isEntityCall — 아테나 게이트웨이의 athena_brain action=entity만 받는다', () => {
  assert.equal(isEntityCall({ name: 'athena_brain', input: { action: 'entity' } }), true);
  assert.equal(isEntityCall({ name: 'mcp__athena__athena_brain', input: { action: 'entity' } }), true);
  assert.equal(isEntityCall({ name: 'athena_brain', input: { action: 'profile' } }), false);
  assert.equal(isEntityCall({ name: 'mcp__other__athena_brain', input: { action: 'entity' } }), false);
  assert.equal(isEntityCall({ name: 'athena_brain' }), false);
  assert.equal(isEntityCall(null), false);
});

test('extractEntityDetail — 찾은 노드의 응답만 넘긴다', () => {
  const step = { name: 'athena_brain', input: { action: 'entity' } };
  assert.deepEqual(extractEntityDetail(step, JSON.stringify(RESOLVED)), RESOLVED);
});

test('extractEntityDetail — 못 찾았거나 후보만 온 응답은 안 넘긴다(되묻는 것은 모델의 일)', () => {
  const step = { name: 'athena_brain', input: { action: 'entity' } };
  const ambiguous = { revision: 1, query: '삼성', resolved: false, candidates: [{ name: '삼성전자' }] };
  assert.equal(extractEntityDetail(step, JSON.stringify(ambiguous)), null);
  assert.equal(extractEntityDetail(step, JSON.stringify({ resolved: true })), null);
});

test('extractEntityDetail — JSON이 아니거나 다른 액션이면 조용히 버린다', () => {
  const step = { name: 'athena_brain', input: { action: 'entity' } };
  assert.equal(extractEntityDetail(step, '조회에 실패했다'), null);
  assert.equal(extractEntityDetail({ name: 'athena_brain', input: { action: 'profile' } },
    JSON.stringify(RESOLVED)), null);
});

test('entityStepNote — 부제는 대상과 연결 수·이력 수다', () => {
  assert.equal(entityStepNote(RESOLVED), '한미반도체 · 관계 7 · 이력 3');
});

test('entityStepNote — 관계 수는 잘린 목록 길이가 아니라 연결 수다(패널 머리와 한 말)', () => {
  const hub = { ...RESOLVED, degree: 57, relations: new Array(30).fill({ relation_id: 'r' }) };
  assert.equal(entityStepNote(hub), '한미반도체 · 관계 57 · 이력 3');
});

test('entityStepNote — 없는 개수는 지어내지 않고 그 절을 뺀다', () => {
  assert.equal(entityStepNote({ name: '고배당', degree: 0, timeline: [] }), '고배당');
  assert.equal(entityStepNote({ entity_id: 'e:x', degree: 1, timeline: [] }), 'e:x · 관계 1');
  assert.equal(entityStepNote(null), '');
});
