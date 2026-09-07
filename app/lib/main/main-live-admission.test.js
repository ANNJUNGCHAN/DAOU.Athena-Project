'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// main의 실제 진입 핸들러와 runLiveQuery를 실행한다. Electron/프로바이더 대신
// 내부 왕복만 보류해 busy 방송이 두 렌더러에 도착하기 전의 IPC 경합을 만든다.
function liveHandlers(t) {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const part = (startText, endText) => {
    const start = source.indexOf(startText);
    const end = source.indexOf(endText, start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
  };
  const handlers = {};
  const jobs = [];
  const saved = [];
  const busy = [];
  const pending = [];
  const aborted = [];
  const context = vm.createContext({
    Map, isQuitting: false, liveSubmitContexts: new Map(),
    historyConversationId: () => 'session-A',
    historySink: { saveChatMessage: (message) => { saved.push(message); return { messageId: `user-${saved.length}` }; } },
    emitHistorySaveFailed() {}, mdlog() {}, touchConversationEntry() {}, beginSessionTurn: () => null,
    broadcastLiveQueryBusy: (value) => busy.push(value),
    runLiveQueryInner: (query, expand, origin, conversationId) => new Promise((resolve, reject) => {
      jobs.push({ query, expand, origin, conversationId, resolve, reject });
    }),
    abortConversationWork: (reason) => {
      aborted.push(reason.message);
      jobs.forEach((job) => job.resolve({ ok: false, error: '중단됨' }));
    },
    shellWin: { isDestroyed: () => false, webContents: { send() {} } },
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
    jobs, saved, busy, aborted,
    submit(origin, query) {
      const channel = origin === 'orb' ? 'athena:orb-chat-submit' : 'athena__render_canvas';
      const promise = handlers[channel]({ sender: { id: origin === 'orb' ? 1 : 2 } }, { query });
      pending.push(promise);
      return promise;
    },
    abort: () => handlers['athena:abort-live-query'](),
  };
}

for (const [first, second] of [['orb', 'shell'], ['shell', 'orb']]) {
  test(`공유 질의 진입: ${first} 왕복 대기 중 ${second} IPC는 저장·실행 전에 거절한다`, async (t) => {
    const live = liveHandlers(t);
    live.submit(first, '진행 중 질문');
    const next = live.submit(second, '다른 창 질문');
    assert.equal(live.jobs.length, 1, 'provider spawn 전에도 다른 창의 질의가 진입하면 안 된다');
    assert.equal(live.saved.length, 1, '거절한 질문을 진행 중 턴으로 기록하면 안 된다');
    assert.equal((await next).ok, false);
    assert.deepEqual(live.busy, [true]);
    assert.equal(live.jobs[0].origin, first);
  });
}

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
  const first = live.submit('orb', '중단할 질문');
  live.abort();
  assert.equal(live.aborted.length, 1);
  assert.equal((await first).ok, false);
  const next = live.submit('shell', '중단 뒤 질문');
  assert.equal(live.jobs.length, 2);
  live.jobs[1].resolve({ ok: true, answerText: 'fixture' });
  assert.equal((await next).ok, true);
  assert.deepEqual(live.busy, [true, false, true, false]);
});
