'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createConversationRuntimes } = require('./conversation-runtimes');

// main의 실제 진입 핸들러와 runLiveQuery를 실행한다. Electron/프로바이더 대신
// 내부 왕복만 보류해 busy 방송이 두 렌더러에 도착하기 전의 IPC 경합을 만든다.
// 다중 대화(2026-09-08) — 활성 대화는 setActive로 바꾸고, 오브는 자기 대화(session-orb)에서 돈다.
function liveHandlers(t) {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const part = (startText, endText) => {
    const start = source.indexOf(startText);
    const end = source.indexOf(endText, start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
  };
  const handlers = {};
  let activeConversationId = 'session-A';
  const knownConversations = new Set(['session-A', 'session-B']);
  const jobs = [];
  const saved = [];
  const busy = [];
  const pending = [];
  const aborted = [];
  const abortedIds = [];
  const orbWebContents = { id: 1, send() {} };
  const shellWebContents = { id: 2, send() {} };
  const context = vm.createContext({
    Map, isQuitting: false, liveSubmitContexts: new Map(), createConversationRuntimes,
    crypto: { randomUUID: () => 'session-orb' },
    historyConversationId: () => activeConversationId,
    knownConversation: (id) => knownConversations.has(id),
    historySink: { saveChatMessage: (message) => { saved.push(message); return { messageId: `user-${saved.length}` }; } },
    emitHistorySaveFailed() {}, mdlog() {}, touchConversationEntry() {}, beginSessionTurn: () => null,
    broadcastLiveQueryBusy: (value) => busy.push(value),
    runLiveQueryInner: (query, expand, origin, conversationId) => new Promise((resolve, reject) => {
      jobs.push({ query, expand, origin, conversationId, resolve, reject });
    }),
    abortConversationWork: (reason, conversationId) => {
      aborted.push(reason.message);
      abortedIds.push(conversationId);
      jobs.filter((job) => job.conversationId === conversationId).forEach((job) => job.resolve({ ok: false, error: '중단됨' }));
    },
    orbWin: { isDestroyed: () => false, webContents: orbWebContents },
    shellWin: { isDestroyed: () => false, webContents: shellWebContents },
    ipcMain: {
      handle: (name, handler) => { handlers[name] = handler; },
      on: (name, handler) => { handlers[name] = handler; },
    },
  });
  vm.runInContext([
    part('let liveQueryBusyDepth =', 'function broadcastLiveQueryBusy('),
    part('async function runLiveQuery(', '// origin —'),
    part("ipcMain.on('athena:abort-live-query'", "ipcMain.on('athena:provider-paint-ack'"),
    part("ipcMain.handle('athena__render_canvas'", '// 화면계 게이트 전용'),
    part("ipcMain.handle('athena:orb-chat-submit'", '// method/body를 받는다'),
  ].join('\n'), context);
  t.after(async () => {
    jobs.forEach((job) => job.resolve({ ok: true, answerText: 'fixture' }));
    await Promise.allSettled(pending);
  });
  return {
    jobs, saved, busy, aborted, abortedIds,
    setActive(id) { activeConversationId = id; },
    submit(origin, query, conversationId) {
      const channel = origin === 'orb' ? 'athena:orb-chat-submit' : 'athena__render_canvas';
      const sender = origin === 'orb' ? orbWebContents : shellWebContents;
      const promise = handlers[channel]({ sender }, conversationId ? { query, conversationId } : { query });
      pending.push(promise);
      return promise;
    },
    abort(origin = 'shell', conversationId) {
      const sender = origin === 'orb' ? orbWebContents
        : (origin === 'shell' ? shellWebContents : { id: 99 });
      return handlers['athena:abort-live-query']({ sender }, conversationId ? { conversationId } : undefined);
    },
  };
}

// 키우미(오브)는 별도 대화다(2026-09-08 사용자 확정) — 셸의 어느 대화가 돌아도 오브는 자기 대화에서
// 병렬로 돈다. 거절은 같은 대화의 재질의(오브 대화가 이미 답변 중)에만 남는다.
for (const [first, second] of [['orb', 'shell'], ['shell', 'orb']]) {
  test(`병렬 진입: ${first} 왕복 대기 중 ${second} IPC는 자기 대화에서 함께 돈다`, async (t) => {
    const live = liveHandlers(t);
    live.submit(first, '진행 중 질문');
    const next = live.submit(second, '다른 창 질문');
    assert.equal(live.jobs.length, 2, '두 창의 턴이 함께 살아야 한다');
    assert.equal(live.saved.length, 2);
    assert.deepEqual(
      live.jobs.map((job) => job.conversationId),
      first === 'orb' ? ['session-orb', 'session-A'] : ['session-A', 'session-orb'],
    );
    assert.deepEqual(live.busy, [true, true]);
    live.jobs[1].resolve({ ok: true, answerText: 'fixture' });
    assert.equal((await next).ok, true);
  });
}

test('오브 진입: 오브 대화가 이미 답변 중이면 두 번째 오브 질의는 저장·실행 전에 거절한다', async (t) => {
  const live = liveHandlers(t);
  live.submit('orb', '첫 오브 질문');
  const next = live.submit('orb', '겹친 오브 질문');
  assert.equal(live.jobs.length, 1);
  assert.equal(live.saved.length, 1);
  assert.equal((await next).ok, false);
});

test('공유 질의 진입: 기존 셸의 재질의는 내부 선점 경로에 계속 전달한다', (t) => {
  const live = liveHandlers(t);
  live.submit('shell', '첫 셸 질문');
  live.submit('shell', '바꾼 셸 질문');
  assert.deepEqual(live.jobs.map((job) => job.query), ['첫 셸 질문', '바꾼 셸 질문']);
  assert.equal(live.saved.length, 2);
});

for (const outcome of ['success', 'failure', 'throw']) {
  test(`공유 질의 진입: 오브 ${outcome} 뒤 finally가 잠금을 풀어 셸 재질의를 받는다`, async (t) => {
    const live = liveHandlers(t);
    const first = live.submit('orb', '첫 질문');
    if (outcome === 'throw') {
      const rejected = assert.rejects(first, /fixture failure/);
      live.jobs[0].reject(new Error('fixture failure'));
      await rejected;
    } else {
      live.jobs[0].resolve({ ok: outcome === 'success', answerText: 'fixture' });
      await first;
    }
    const next = live.submit('shell', '이어지는 질문');
    assert.equal(live.jobs.length, 2);
    live.jobs[1].resolve({ ok: true, answerText: 'fixture' });
    assert.equal((await next).ok, true);
    assert.deepEqual(live.busy, [true, false, true, false]);
  });
}

test('공유 질의 진입: 기존 Esc 중단 IPC와 중단 후 셸 재질의를 보존한다', async (t) => {
  const live = liveHandlers(t);
  const first = live.submit('shell', '중단할 질문');
  live.abort('shell');
  assert.equal(live.aborted.length, 1);
  assert.equal((await first).ok, false);
  const next = live.submit('shell', '중단 뒤 질문');
  assert.equal(live.jobs.length, 2);
  live.jobs[1].resolve({ ok: true, answerText: 'fixture' });
  assert.equal((await next).ok, true);
  assert.deepEqual(live.busy, [true, false, true, false]);
});

// ---------- 다중 대화(2026-09-08) — 잠금·선점은 같은 대화 안에서만 ----------
test('다중 대화: 다른 대화의 질의는 진행 중 턴을 거절하지도 선점하지도 않고 동시에 돈다', async (t) => {
  const live = liveHandlers(t);
  const first = live.submit('shell', 'A 대화 질문');
  live.setActive('session-B');
  const second = live.submit('shell', 'B 대화 질문');
  assert.equal(live.jobs.length, 2, '두 대화의 턴이 함께 살아야 한다');
  assert.deepEqual(live.jobs.map((job) => job.conversationId), ['session-A', 'session-B']);
  assert.deepEqual(live.busy, [true, true], '대화마다 busy 진입을 방송한다');
  live.jobs[1].resolve({ ok: true, answerText: 'B' });
  assert.equal((await second).ok, true);
  assert.deepEqual(live.busy, [true, true, false], 'B가 끝나도 A는 계속 busy다');
  live.jobs[0].resolve({ ok: true, answerText: 'A' });
  assert.equal((await first).ok, true);
  assert.deepEqual(live.busy, [true, true, false, false]);
});

test('다중 대화: 제출에 실린 대화 id가 활성 대화와 다르면 그 대화로 턴을 연다(전환 찰나의 경합)', (t) => {
  const live = liveHandlers(t);
  live.submit('shell', 'B에서 친 질문', 'session-B');
  assert.equal(live.jobs[0].conversationId, 'session-B');
  assert.equal(live.saved[0].conversationId, 'session-B');
  live.submit('shell', '모르는 id는 활성 대화로', 'session-unknown');
  assert.equal(live.jobs[1].conversationId, 'session-A');
});

test('다중 대화: Esc 중단은 그 대화의 턴만 끊는다', async (t) => {
  const live = liveHandlers(t);
  const a = live.submit('shell', 'A 질문');
  live.setActive('session-B');
  const b = live.submit('shell', 'B 질문');
  live.abort('shell', 'session-A');
  assert.deepEqual(live.abortedIds, ['session-A']);
  assert.equal((await a).ok, false);
  live.jobs[1].resolve({ ok: true, answerText: 'B' });
  assert.equal((await b).ok, true);
});

test('다중 대화: payload 없는 오브 중단은 셸이 아니라 오브 대화만 끊는다', async (t) => {
  const live = liveHandlers(t);
  const orb = live.submit('orb', '오브 질문');
  const shell = live.submit('shell', '셸 질문');
  live.abort('orb');
  assert.deepEqual(live.abortedIds, ['session-orb']);
  assert.equal((await orb).ok, false);
  live.jobs[1].resolve({ ok: true, answerText: '셸' });
  assert.equal((await shell).ok, true);
});

test('다중 대화: 오브 payload가 셸 대화를 가리켜도 오브 대화만 끊는다', async (t) => {
  const live = liveHandlers(t);
  const orb = live.submit('orb', '오브 질문');
  const shell = live.submit('shell', '셸 질문');
  live.abort('orb', 'session-A');
  assert.deepEqual(live.abortedIds, ['session-orb']);
  assert.equal((await orb).ok, false);
  live.jobs[1].resolve({ ok: true, answerText: '셸' });
  assert.equal((await shell).ok, true);
});

test('다중 대화: 알 수 없는 송신자와 셸의 오브 대화 위조는 진행 중 턴을 끊지 않는다', async (t) => {
  const live = liveHandlers(t);
  const orb = live.submit('orb', '오브 질문');
  const shell = live.submit('shell', '셸 질문');
  live.abort('unknown', 'session-A');
  live.abort('shell', 'session-orb');
  assert.deepEqual(live.abortedIds, []);
  live.jobs[0].resolve({ ok: true, answerText: '오브' });
  live.jobs[1].resolve({ ok: true, answerText: '셸' });
  assert.equal((await orb).ok, true);
  assert.equal((await shell).ok, true);
});

test('다중 대화: 셸이 대화를 갈아타도 오브 대화의 턴은 그대로 돈다', async (t) => {
  const live = liveHandlers(t);
  const orb = live.submit('orb', '오브 질문');
  live.setActive('session-B');
  const b = live.submit('shell', 'B 질문');
  assert.equal(live.jobs.length, 2);
  assert.deepEqual(live.jobs.map((job) => job.conversationId), ['session-orb', 'session-B']);
  live.jobs[0].resolve({ ok: true, answerText: '오브' });
  live.jobs[1].resolve({ ok: true, answerText: 'B' });
  assert.equal((await orb).ok, true);
  assert.equal((await b).ok, true);
});
