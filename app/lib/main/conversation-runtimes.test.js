'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationRuntimes } = require('./conversation-runtimes');

test('공급자가 같으면 연결을 재사용하고 바뀌면 이전 연결만 닫는다', () => {
  const rt = createConversationRuntimes();
  const claude = rt.chatSession('A', () => fakeSession(), 'claude');
  const other = rt.chatSession('B', () => fakeSession(), 'claude');
  const grok = rt.chatSession('A', () => fakeSession(), 'grok');
  assert.notEqual(grok, claude);
  assert.ok(claude.stopped instanceof Error);
  assert.equal(other.stopped, null);
  assert.equal(rt.get('A').chatSessionProviderId, 'grok');
  assert.equal(rt.chatSession('A', () => { throw new Error('must reuse'); }, 'grok'), grok);
  rt.stopAllChatSessions();
  assert.ok(grok.stopped instanceof Error);
  assert.equal(rt.get('A').chatSessionProviderId, null);
});

test('공급자가 같아도 모델·계정·보안 키가 바뀌면 다음 사용에서 세션을 교체한다', () => {
  const rt = createConversationRuntimes();
  const first = rt.chatSession('A', () => fakeSession(), 'claude', 'key-v1');
  assert.equal(rt.chatSession('A', () => { throw new Error('must reuse'); }, 'claude', 'key-v1'), first);

  const second = rt.chatSession('A', () => fakeSession(), 'claude', 'key-v2');
  assert.notEqual(second, first);
  assert.ok(first.stopped instanceof Error);
  assert.equal(rt.get('A').chatSessionKey, 'key-v2');

  rt.stopAllChatSessions();
  assert.equal(rt.get('A').chatSessionKey, null);
});

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

test('stopIdleChatSessions·clearIdleCursors는 답변 중인 대화를 건드리지 않는다', () => {
  const rt = createConversationRuntimes();
  const a = rt.chatSession('A', () => fakeSession('busy'));
  const b = rt.chatSession('B', () => fakeSession());
  rt.get('A').busyDepth = 1;
  rt.get('A').liveSessionId = 'sess-a';
  rt.get('B').liveSessionId = 'sess-b';
  rt.stopIdleChatSessions(new Error('provider switch'));
  rt.clearIdleCursors();
  assert.equal(a.stopped, null, '진행 중 A의 세션은 산다');
  assert.ok(b.stopped instanceof Error, '유휴 B의 세션은 닫힌다');
  assert.equal(rt.get('A').liveSessionId, 'sess-a');
  assert.equal(rt.get('B').liveSessionId, null);
});

test('재개 커서는 저장된 공급자·계정 소유자가 현재 요청과 같을 때만 복원한다', () => {
  const rt = createConversationRuntimes();
  const records = {
    same: { resumeSessionId: 'sess-same', resumeOwnerKey: 'claude:account-1' },
    providerMismatch: { resumeSessionId: 'sess-grok', resumeOwnerKey: 'grok:account-1' },
    accountMismatch: { resumeSessionId: 'sess-other', resumeOwnerKey: 'claude:account-2' },
    legacy: { resumeSessionId: 'sess-legacy' },
    untouched: { resumeSessionId: 'sess-untouched', resumeOwnerKey: 'codex:account-1' },
  };
  const load = (id) => records[id];

  assert.equal(rt.resolveResumeCursor('same', 'claude:account-1', load), 'sess-same');
  assert.equal(rt.resolveResumeCursor('providerMismatch', 'claude:account-1', load), null);
  assert.equal(rt.resolveResumeCursor('accountMismatch', 'claude:account-1', load), null);
  assert.equal(rt.resolveResumeCursor('legacy', 'claude:account-1', load), null);
  assert.equal(rt.peek('untouched'), null, '다른 대화는 읽거나 지우지 않는다');
});

test('이전 공급자의 늦은 완료 커서는 다음 소유자의 요청에서 거절한다', () => {
  const rt = createConversationRuntimes();
  const runtime = rt.get('A');
  runtime.liveSessionId = 'late-grok-cursor';
  runtime.liveSessionOwnerKey = 'grok:account-1';

  assert.equal(rt.resolveResumeCursor('A', 'codex:account-1', () => {
    throw new Error('이미 메모리에 있는 커서는 디스크에서 다시 읽지 않는다');
  }), null);
  assert.equal(runtime.liveSessionOwnerKey, 'codex:account-1');
  assert.equal(rt.resolveResumeCursor('A', 'codex:account-1'), null);
});

test('소유자 키를 생략한 기존 호출은 ownerless 저장 커서를 그대로 복원한다', () => {
  const rt = createConversationRuntimes();
  assert.equal(rt.resolveResumeCursor('legacy', undefined, () => ({
    resumeSessionId: 'sess-legacy',
  })), 'sess-legacy');
});

test('stopAllChatSessions는 교체 중 시작된 비동기 stop까지 기다리고 실패를 결과로 남긴다', async () => {
  const rt = createConversationRuntimes();
  let finishOldStop;
  const oldStop = new Promise((resolve, reject) => { finishOldStop = { resolve, reject }; });
  const old = fakeSession();
  old.stop = (reason) => {
    old.stopped = reason;
    return oldStop;
  };

  rt.chatSession('A', () => old, 'grok', 'account-1');
  const current = rt.chatSession('A', () => fakeSession(), 'grok', 'account-2');
  assert.ok(old.stopped instanceof Error, '계정 교체는 이전 참조를 즉시 닫기 시작한다');
  assert.equal(rt.get('A').chatSession, current, '비동기 종료 중에도 새 세션 참조는 즉시 설치된다');

  let drained = false;
  const shutdown = rt.stopAllChatSessions(new Error('앱 종료')).then((results) => {
    drained = true;
    return results;
  });
  await Promise.resolve();
  assert.equal(drained, false, '이전에 시작된 stop이 끝나기 전에는 종료 완료가 아니다');

  finishOldStop.reject(new Error('old stop failed'));
  const results = await shutdown;
  assert.equal(drained, true);
  assert.equal(results.some((result) => result.status === 'rejected'
    && result.reason.message === 'old stop failed'), true);
});

test('동기 stop 예외도 stopAllChatSessions의 rejected 결과로 보존한다', async () => {
  const rt = createConversationRuntimes();
  const session = fakeSession();
  session.stop = () => { throw new Error('sync runtime stop failed'); };
  rt.chatSession('A', () => session);

  const results = await rt.stopAllChatSessions(new Error('앱 종료'));
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[0].reason.message, 'sync runtime stop failed');
  assert.equal(rt.get('A').chatSession, null, '종료 실패와 별개로 참조는 즉시 비운다');
});
