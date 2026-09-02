'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSessionStore } = require('./session-store');
const { createSessionBridge, JOURNAL_BYTES, DEBOUNCE } = require('./session-bridge');

// 가짜 시계. 등록된 콜백을 모아 두고 tick(ms)으로만 시간이 흐른다.
function fakeClock(startMs = Date.parse('2026-09-03T00:00:00.000Z')) {
  let nowMs = startMs;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => new Date(nowMs).toISOString(),
    setTimer(fn, delay) {
      seq += 1;
      timers.set(seq, { fn, at: nowMs + Math.max(0, Number(delay) || 0) });
      return seq;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    tick(ms) {
      const until = nowMs + ms;
      for (;;) {
        let dueId = null;
        let due = null;
        for (const [id, timer] of timers) {
          if (timer.at > until) continue;
          if (!due || timer.at < due.at) {
            due = timer;
            dueId = id;
          }
        }
        if (!due) break;
        timers.delete(dueId);
        nowMs = due.at;
        due.fn();
      }
      nowMs = until;
    },
  };
}

function setup(t, { log } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-bridge-'));
  const store = createSessionStore({ dbPath: path.join(dir, 'athena-sessions.sqlite3') });
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const clock = fakeClock();
  const bridge = createSessionBridge({
    store,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    log: log || (() => {}),
  });
  return { store, clock, bridge };
}

function messageOf(store, sessionId, messageId) {
  return store.getSession(sessionId).messages.find((row) => row.id === messageId);
}

function spy(store, method) {
  const calls = [];
  const original = store[method].bind(store);
  store[method] = (...args) => {
    calls.push(args);
    return original(...args);
  };
  return calls;
}

test('사용자 메시지는 디바운스 없이 즉시 DB에 앉는다', (t) => {
  const { store, bridge } = setup(t);
  bridge.ensureSession({ id: 'sess_1', mode: 'chat', projectId: 'proj_a', title: '' });

  bridge.recordUserMessage({ sessionId: 'sess_1', messageId: 'm1', text: '질문' });

  const row = messageOf(store, 'sess_1', 'm1');
  assert.equal(row.role, 'user');
  assert.equal(row.text, '질문');
  assert.equal(row.done, true);
  assert.equal(bridge.pendingCount(), 0);
});

test('스토어가 던지면 recordUserMessage도 던진다 — 턴을 시작하지 않는다', () => {
  const clock = fakeClock();
  const bridge = createSessionBridge({
    store: { appendMessage() { throw new Error('디스크가 가득 찼다'); } },
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  assert.throws(
    () => bridge.recordUserMessage({ sessionId: 'sess_1', messageId: 'm1', text: '질문' }),
    /디스크가 가득 찼다/,
  );
});

test('델타 세 번은 디스크를 안 건드리고 5초 저널에 누적 전체가 써진다', (t) => {
  const { store, clock, bridge } = setup(t);
  bridge.ensureSession({ id: 'sess_1', mode: 'chat', projectId: 'proj_a' });
  bridge.beginAssistant({ sessionId: 'sess_1', messageId: 'a1' });

  bridge.journalDelta({ sessionId: 'sess_1', messageId: 'a1', text: '가' });
  bridge.journalDelta({ sessionId: 'sess_1', messageId: 'a1', text: '나' });
  bridge.journalDelta({ sessionId: 'sess_1', messageId: 'a1', text: '다', thinking: '흠' });
  assert.equal(messageOf(store, 'sess_1', 'a1').text, '');
  assert.equal(bridge.pendingCount(), 1);

  clock.tick(5000);

  const row = messageOf(store, 'sess_1', 'a1');
  assert.equal(row.text, '가나다');
  assert.equal(row.thinking, '흠');
  assert.equal(row.done, false);
  assert.equal(bridge.pendingCount(), 0);
});

test('2KB를 넘으면 타이머를 기다리지 않고 저널한다', (t) => {
  const { store, clock, bridge } = setup(t);
  bridge.ensureSession({ id: 'sess_1', mode: 'chat', projectId: 'proj_a' });
  bridge.beginAssistant({ sessionId: 'sess_1', messageId: 'a1' });

  const chunk = 'x'.repeat(JOURNAL_BYTES - 1);
  bridge.journalDelta({ sessionId: 'sess_1', messageId: 'a1', text: chunk });
  assert.equal(messageOf(store, 'sess_1', 'a1').text, '');

  bridge.journalDelta({ sessionId: 'sess_1', messageId: 'a1', text: 'yy' });
  clock.tick(0);

  assert.equal(messageOf(store, 'sess_1', 'a1').text, `${chunk}yy`);
  assert.equal(bridge.pendingCount(), 0);
});

test('턴이 끝나면 최종본·usage·done:true가 한 번에 앉고 늦은 델타는 무시된다', (t) => {
  const logged = [];
  const { store, clock, bridge } = setup(t, { log: (tag, detail) => logged.push([tag, detail]) });
  bridge.ensureSession({ id: 'sess_1', mode: 'chat', projectId: 'proj_a' });
  bridge.beginAssistant({ sessionId: 'sess_1', messageId: 'a1' });
  bridge.journalDelta({ sessionId: 'sess_1', messageId: 'a1', text: '부분' });

  bridge.finishAssistant({
    sessionId: 'sess_1',
    messageId: 'a1',
    text: '부분 그리고 끝',
    thinking: '생각 원문',
    usage: { inputTokens: 12, outputTokens: 34 },
  });

  let row = messageOf(store, 'sess_1', 'a1');
  assert.equal(row.text, '부분 그리고 끝');
  assert.equal(row.thinking, '생각 원문');
  assert.equal(row.done, true);
  assert.equal(row.error, null);
  assert.deepEqual(row.usage, { inputTokens: 12, outputTokens: 34 });

  assert.equal(bridge.journalDelta({ sessionId: 'sess_1', messageId: 'a1', text: '늦은 조각' }), false);
  clock.tick(5000);

  row = messageOf(store, 'sess_1', 'a1');
  assert.equal(row.text, '부분 그리고 끝');
  assert.equal(bridge.pendingCount(), 0);
  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], 'session-bridge');
});

test('중단해도 부분 응답이 남고 error에 이유가 적힌다', (t) => {
  const { store, bridge } = setup(t);
  bridge.ensureSession({ id: 'sess_1', mode: 'chat', projectId: 'proj_a' });
  bridge.beginAssistant({ sessionId: 'sess_1', messageId: 'a1' });
  bridge.journalDelta({ sessionId: 'sess_1', messageId: 'a1', text: '여기까지 ' });
  bridge.journalDelta({ sessionId: 'sess_1', messageId: 'a1', text: '왔다' });

  bridge.finishAssistant({ sessionId: 'sess_1', messageId: 'a1', interrupted: true });

  const row = messageOf(store, 'sess_1', 'a1');
  assert.equal(row.text, '여기까지 왔다');
  assert.equal(row.done, true);
  assert.equal(row.error, 'interrupted');
});

test('툴 단계는 즉시 쌓이고 턴 종료까지 살아남는다', (t) => {
  const { store, bridge } = setup(t);
  bridge.ensureSession({ id: 'sess_1', mode: 'chat', projectId: 'proj_a' });
  bridge.beginAssistant({ sessionId: 'sess_1', messageId: 'a1' });

  bridge.recordToolStep({ sessionId: 'sess_1', messageId: 'a1', step: { name: 'Read', status: 'start' } });
  bridge.recordToolStep({ sessionId: 'sess_1', messageId: 'a1', step: { name: 'Read', status: 'done' } });

  assert.equal(messageOf(store, 'sess_1', 'a1').toolSteps.length, 2);

  bridge.finishAssistant({ sessionId: 'sess_1', messageId: 'a1', text: '끝' });
  const row = messageOf(store, 'sess_1', 'a1');
  assert.equal(row.toolSteps.length, 2);
  assert.equal(row.toolSteps[1].status, 'done');
});

test('워크스페이스 연속 10회는 300ms 뒤 한 번만 쓰이고, 같은 값은 아예 안 쓴다', (t) => {
  const { store, clock, bridge } = setup(t);
  bridge.ensureSession({ id: 'sess_1', mode: 'backtest', projectId: 'proj_a' });
  const calls = spy(store, 'saveWorkspace');

  for (let i = 0; i < 10; i += 1) {
    bridge.saveWorkspace({ sessionId: 'sess_1', workspace: { kind: 'backtest', form: { count: i } } });
  }
  assert.equal(calls.length, 0);

  clock.tick(DEBOUNCE.workspace.wait);
  assert.equal(calls.length, 1);
  assert.deepEqual(store.getSession('sess_1').workspace.form, { count: 9 });

  bridge.saveWorkspace({ sessionId: 'sess_1', workspace: { kind: 'backtest', form: { count: 9 } } });
  clock.tick(DEBOUNCE.workspace.max);
  assert.equal(calls.length, 1);
  assert.equal(bridge.pendingCount(), 0);
});

test('계속 호출해도 maxWait 안에는 반드시 한 번 쓰인다', (t) => {
  const { store, clock, bridge } = setup(t);
  bridge.ensureSession({ id: 'sess_1', mode: 'backtest', projectId: 'proj_a' });
  const calls = spy(store, 'saveWorkspace');

  for (let i = 0; i < 4; i += 1) {
    bridge.saveWorkspace({ sessionId: 'sess_1', workspace: { kind: 'backtest', form: { count: i } } });
    clock.tick(250);
  }

  assert.equal(calls.length, 1);
  assert.deepEqual(store.getSession('sess_1').workspace.form, { count: 3 });
});

test('카드는 200ms 디바운스로 모였다가 한 번에 앉는다', (t) => {
  const { store, clock, bridge } = setup(t);
  bridge.ensureSession({ id: 'sess_1', mode: 'chat', projectId: 'proj_a' });

  bridge.saveCards({ sessionId: 'sess_1', cards: [{ cardId: 'c1', kind: 'chart', channel: 'main' }] });
  bridge.saveCards({
    sessionId: 'sess_1',
    cards: [
      { cardId: 'c1', kind: 'chart', channel: 'main' },
      { cardId: 'c2', kind: 'table', channel: 'main' },
    ],
  });
  assert.equal(store.getSession('sess_1').canvasCards.length, 0);

  clock.tick(DEBOUNCE.cards.wait);

  const cards = store.getSession('sess_1').canvasCards;
  assert.deepEqual(cards.map((card) => card.cardId), ['c1', 'c2']);
});

test('뷰포트 저장은 revision을 올리지 않는다', (t) => {
  const { store, clock, bridge } = setup(t);
  bridge.ensureSession({ id: 'sess_1', mode: 'chat', projectId: 'proj_a' });
  const before = store.getSession('sess_1').revision;

  bridge.saveViewport({ sessionId: 'sess_1', viewport: { chat: { scrollTop: 120 } } });
  clock.tick(DEBOUNCE.viewport.wait);

  const after = store.getSession('sess_1');
  assert.deepEqual(after.viewport.chat, { scrollTop: 120 });
  assert.equal(after.revision, before);
});

test('flush(sessionId)는 그 세션 대기분만, flushSync는 전부 즉시 쓴다', (t) => {
  const { store, bridge } = setup(t);
  bridge.ensureSession({ id: 'sess_1', mode: 'chat', projectId: 'proj_a' });
  bridge.ensureSession({ id: 'sess_2', mode: 'chat', projectId: 'proj_a' });
  bridge.beginAssistant({ sessionId: 'sess_1', messageId: 'a1' });
  bridge.journalDelta({ sessionId: 'sess_1', messageId: 'a1', text: '흘러가던 글' });
  bridge.saveWorkspace({ sessionId: 'sess_1', workspace: { kind: 'chat', draft: '초안' } });
  bridge.saveViewport({ sessionId: 'sess_2', viewport: { chat: { scrollTop: 9 } } });

  bridge.flush('sess_1');

  assert.equal(messageOf(store, 'sess_1', 'a1').text, '흘러가던 글');
  assert.equal(store.getSession('sess_1').workspace.draft, '초안');
  assert.deepEqual(store.getSession('sess_2').viewport.chat, {});
  assert.equal(bridge.pendingCount(), 1);

  bridge.flushSync();

  assert.deepEqual(store.getSession('sess_2').viewport.chat, { scrollTop: 9 });
  assert.equal(bridge.pendingCount(), 0);
});

test('flushSync는 스토어가 던져도 던지지 않고 로그만 남긴다', () => {
  const logged = [];
  const clock = fakeClock();
  const bridge = createSessionBridge({
    store: {
      getSession: () => null,
      saveWorkspace() { throw new Error('닫힌 DB'); },
    },
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    log: (tag, detail) => logged.push([tag, detail]),
  });
  bridge.saveWorkspace({ sessionId: 'sess_1', workspace: { kind: 'chat' } });

  assert.doesNotThrow(() => bridge.flushSync());
  assert.equal(bridge.pendingCount(), 0);
  assert.equal(logged.length, 1);
  assert.match(String(logged[0][1]), /닫힌 DB/);
});

test('두 세션이 섞여도 서로의 버퍼와 디바운스를 침범하지 않는다', (t) => {
  const { store, clock, bridge } = setup(t);
  bridge.ensureSession({ id: 'sess_1', mode: 'chat', projectId: 'proj_a' });
  bridge.ensureSession({ id: 'sess_2', mode: 'backtest', projectId: 'proj_b' });
  bridge.beginAssistant({ sessionId: 'sess_1', messageId: 'a1' });
  bridge.beginAssistant({ sessionId: 'sess_2', messageId: 'a1' });

  bridge.journalDelta({ sessionId: 'sess_1', messageId: 'a1', text: '첫째' });
  bridge.journalDelta({ sessionId: 'sess_2', messageId: 'a1', text: '둘째' });
  bridge.saveWorkspace({ sessionId: 'sess_1', workspace: { kind: 'chat', draft: '하나' } });
  bridge.saveWorkspace({ sessionId: 'sess_2', workspace: { kind: 'backtest', draft: '둘' } });
  assert.equal(bridge.pendingCount(), 4);

  clock.tick(5000);

  assert.equal(messageOf(store, 'sess_1', 'a1').text, '첫째');
  assert.equal(messageOf(store, 'sess_2', 'a1').text, '둘째');
  assert.equal(store.getSession('sess_1').workspace.draft, '하나');
  assert.equal(store.getSession('sess_2').workspace.draft, '둘');
});

test('pendingCount는 대기 중인 쓰기를 정확히 센다', (t) => {
  const { clock, bridge } = setup(t);
  bridge.ensureSession({ id: 'sess_1', mode: 'chat', projectId: 'proj_a' });
  assert.equal(bridge.pendingCount(), 0);

  bridge.beginAssistant({ sessionId: 'sess_1', messageId: 'a1' });
  assert.equal(bridge.pendingCount(), 0);

  bridge.journalDelta({ sessionId: 'sess_1', messageId: 'a1', text: '조각' });
  assert.equal(bridge.pendingCount(), 1);

  bridge.saveWorkspace({ sessionId: 'sess_1', workspace: { kind: 'chat', draft: '초안' } });
  bridge.saveCards({ sessionId: 'sess_1', cards: [{ cardId: 'c1', kind: 'chart', channel: 'main' }] });
  assert.equal(bridge.pendingCount(), 3);

  bridge.saveCards({ sessionId: 'sess_1', cards: [{ cardId: 'c1', kind: 'chart', channel: 'main' }] });
  assert.equal(bridge.pendingCount(), 3);

  clock.tick(5000);
  assert.equal(bridge.pendingCount(), 0);
});
