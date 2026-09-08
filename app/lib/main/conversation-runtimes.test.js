'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationRuntimes } = require('./conversation-runtimes');

function fakeSession(state = 'idle') {
  const session = {
    state,
    stopped: null,
    snapshot: () => ({ state: session.state }),
    stop: (reason) => { session.stopped = reason; },
  };
  return session;
}

test('대화마다 런타임이 따로 산다 — 한 대화의 busy가 다른 대화를 잠그지 않는다', () => {
  const rt = createConversationRuntimes();
  rt.get('A').busyDepth += 1;
  assert.equal(rt.isBusy('A'), true);
  assert.equal(rt.isBusy('B'), false);
  assert.deepEqual(rt.busyIds(), ['A']);
  rt.get('B').busyDepth += 1;
  assert.deepEqual(rt.busyIds().sort(), ['A', 'B']);
  rt.get('A').busyDepth -= 1;
  assert.deepEqual(rt.busyIds(), ['B']);
});

test('재개 커서는 대화마다 따로 — 처음엔 undefined(아직 안 읽음), clearCursors는 전부 null', () => {
  const rt = createConversationRuntimes();
  assert.equal(rt.get('A').liveSessionId, undefined);
  rt.get('A').liveSessionId = 'sess-a';
  rt.get('B').liveSessionId = 'sess-b';
  assert.equal(rt.get('A').liveSessionId, 'sess-a');
  rt.clearCursors();
  assert.equal(rt.get('A').liveSessionId, null);
  assert.equal(rt.get('B').liveSessionId, null);
});

test('상주 세션은 대화마다 하나, 팩토리는 대화당 1회', () => {
  const rt = createConversationRuntimes();
  const made = [];
  const factory = (id) => { made.push(id); return fakeSession(); };
  const a1 = rt.chatSession('A', factory);
  const a2 = rt.chatSession('A', factory);
  const b = rt.chatSession('B', factory);
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.deepEqual(made, ['A', 'B']);
});

test('유휴 세션 상한 — 가장 오래 안 쓴 유휴 세션부터 닫고, 진행 중 세션은 남긴다', () => {
  let clock = 0;
  const rt = createConversationRuntimes({ maxIdleChatSessions: 2, now: () => (clock += 1) });
  const sessions = new Map();
  const factory = (id) => { const s = fakeSession(); sessions.set(id, s); return s; };
  rt.chatSession('A', factory);
  rt.chatSession('B', factory);
  rt.get('A').busyDepth = 1; // A는 진행 중 — 상한 대상이 아니다
  rt.chatSession('C', factory); // 유휴 = B, C 둘 — 상한 2 안
  assert.equal(sessions.get('B').stopped, null);
  rt.chatSession('D', factory); // 유휴 B, C가 이미 2 — 가장 오래된 B를 닫고 D를 만든다
  assert.ok(sessions.get('B').stopped instanceof Error);
  assert.equal(sessions.get('C').stopped, null);
  assert.equal(sessions.get('A').stopped, null);
  assert.equal(rt.get('B').chatSession, null);
  assert.ok(rt.get('D').chatSession);
});

test('stopAllChatSessions는 전부 닫고 참조를 비운다', () => {
  const rt = createConversationRuntimes();
  const a = rt.chatSession('A', () => fakeSession());
  const b = rt.chatSession('B', () => fakeSession());
  const reason = new Error('앱 종료');
  rt.stopAllChatSessions(reason);
  assert.equal(a.stopped, reason);
  assert.equal(b.stopped, reason);
  assert.equal(rt.get('A').chatSession, null);
  let visited = 0;
  rt.forEachChatSession(() => { visited += 1; });
  assert.equal(visited, 0);
});
