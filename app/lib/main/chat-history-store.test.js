'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChatHistoryStore } = require('./chat-history-store');

function makeDbPath(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-chat-history-'));
  return { dir, dbPath: path.join(dir, 'chat-history.sqlite3') };
}

test('대화 원문과 동기화 상태를 저장하고 재시작 뒤 다시 연다', (t) => {
  const { dir, dbPath } = makeDbPath(t);
  const message = {
    messageId: 'm1', conversationId: 'c1', role: 'user',
    text: '전체 대화 원문', occurredAt: '2026-08-31T01:02:03.000Z',
  };
  let store = new ChatHistoryStore({ dbPath });
  assert.equal(store.persistMessage(message), true);
  assert.equal(store.getMessage('m1').text, '전체 대화 원문');
  assert.equal(store.getMessage('m1').sync_state, 'pending');
  store.close();

  store = new ChatHistoryStore({ dbPath });
  assert.equal(store.getMessage('m1').conversation_id, 'c1');
  assert.equal(store.countPendingMessages(), 1);
  store.markSynced('m1', '2026-08-31T01:03:00.000Z');
  assert.equal(store.getMessage('m1').sync_state, 'synced');
  assert.equal(store.countPendingMessages(), 0);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('같은 message_id는 기존 원문과 상태를 덮어쓰지 않는다', (t) => {
  const { dir, dbPath } = makeDbPath(t);
  const store = new ChatHistoryStore({ dbPath });
  assert.equal(store.persistMessage({
    messageId: 'same', conversationId: 'c1', role: 'user', text: '원본',
    occurredAt: '2026-08-31T00:00:00.000Z',
  }), true);
  assert.equal(store.persistMessage({
    messageId: 'same', conversationId: 'c2', role: 'assistant', text: '덮어쓰기 시도',
    occurredAt: '2026-08-31T00:01:00.000Z',
  }), false);
  const row = store.getMessage('same');
  assert.equal(row.text, '원본');
  assert.equal(row.conversation_id, 'c1');
  assert.equal(store.countPendingMessages(), 1);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('1만 자를 넘는 장문도 축약 없이 pending 원문으로 보존한다', () => {
  const store = new ChatHistoryStore({ dbPath: ':memory:' });
  const text = '가'.repeat(12_345);
  store.persistMessage({
    messageId: 'long', conversationId: 'c1', role: 'user', text,
    occurredAt: '2026-08-31T00:00:00.000Z',
  });
  assert.equal(store.getMessage('long').text, text);
  assert.equal(store.getMessage('long').text.length, 12_345);
  store.close();
});

test('ACK 처리하면 pending 원문을 지우고 동기화 메타데이터만 남긴다', () => {
  const store = new ChatHistoryStore({ dbPath: ':memory:' });
  store.persistMessage({
    messageId: 'ack', conversationId: 'c1', role: 'assistant', text: '전송 완료 뒤 지울 원문',
    occurredAt: '2026-08-31T00:00:00.000Z',
  });
  assert.equal(store.markSynced('ack', '2026-08-31T00:01:00.000Z'), true);
  const row = store.getMessage('ack');
  assert.equal(row.sync_state, 'synced');
  assert.equal(row.text, '');
  assert.equal(store.markSynced('ack'), false);
  store.close();
});

test('수집 해제 시 pending 원문을 모두 purge한다', () => {
  const store = new ChatHistoryStore({ dbPath: ':memory:' });
  for (const messageId of ['m1', 'm2']) {
    store.persistMessage({
      messageId, conversationId: 'c1', role: 'user', text: messageId,
      occurredAt: `2026-08-31T00:00:0${messageId === 'm1' ? '1' : '2'}.000Z`,
    });
  }
  assert.equal(store.purgePendingMessages(), 2);
  assert.equal(store.countPendingMessages(), 0);
  assert.equal(store.getMessage('m1'), null);
  store.close();
});
