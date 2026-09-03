'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { FOUNDATION_PRESENT, getAgentConsoleSessionId } = require('./agent-session');

function snapshot(activeId, conversations) {
  return { activeId, activeMode: 'chat', currentProjectId: 'default', projects: [], conversations };
}

test('세션 기반은 이미 착륙해 있다 — conversations.js가 mode를 정규화한다', () => {
  assert.equal(FOUNDATION_PRESENT, true);
});

test('활성 대화가 에이전트 모드면 그 id를 돌려준다', () => {
  const state = snapshot('c-1', [{ id: 'c-1', mode: 'agent' }, { id: 'c-2', mode: 'chat' }]);
  assert.equal(getAgentConsoleSessionId(state), 'c-1');
});

test('활성 대화가 에이전트 모드가 아니면 null이다', () => {
  const state = snapshot('c-2', [{ id: 'c-1', mode: 'agent' }, { id: 'c-2', mode: 'chat' }]);
  assert.equal(getAgentConsoleSessionId(state), null);
});

test('에이전트 대화가 둘이어도 활성 아닌 쪽은 고르지 않는다', () => {
  const state = snapshot('c-3', [
    { id: 'c-1', mode: 'agent' },
    { id: 'c-2', mode: 'agent' },
    { id: 'c-3', mode: 'chat' },
  ]);
  assert.equal(getAgentConsoleSessionId(state), null);
});
