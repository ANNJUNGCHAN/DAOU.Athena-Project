'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createConversationRotationQueue } = require('./provider-main-lifecycle');

function mainSource() {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
}

test('live turn captures one conversation id and never re-reads the mutable active id while persisting', () => {
  const source = mainSource();
  const start = source.indexOf('async function runLiveQueryInner(');
  const end = source.indexOf('// Esc 중단', start);
  const turn = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(source, /async function runLiveQuery\([^)]*turnConversationId = historyConversationId\(\)/);
  assert.match(source, /runLiveQueryInner\(query, expand, origin, turnConversationId\)/);
  assert.doesNotMatch(turn, /conversationId:\s*historyConversationId\(\)/);
  assert.ok((turn.match(/conversationId:\s*turnConversationId/g) || []).length >= 10);
  assert.doesNotMatch(turn, /touchConversationEntry\((query|question)\);/);
  assert.match(turn, /historyConversationId\(\) === turnConversationId[\s\S]*liveSessionId = result\.finalResult\.session_id/);
});

test('new conversation serializes abort, record publication, persistence, and provider rotation', async () => {
  const events = [];
  let publishedId = null;
  const queue = createConversationRotationQueue({
    isShuttingDown: () => false,
    blockAdmission: () => events.push('block'),
    interrupt: () => events.push('abort'),
    createConversationId: () => 'conversation-next',
    publishConversationId: (id) => { publishedId = id; events.push('publish'); },
    beginConversation: ({ id }) => { events.push(`begin:${id}`); return { activeId: id }; },
    rotateProvider: () => events.push(`rotate:${publishedId}`),
  });

  assert.deepEqual(await queue.begin(), { activeId: 'conversation-next' });
  assert.deepEqual(events, [
    'block',
    'abort',
    'publish',
    'begin:conversation-next',
    'rotate:conversation-next',
  ]);
});

test('metadata-only history selection cannot retarget the live record boundary', () => {
  const source = mainSource();
  const start = source.indexOf("ipcMain.handle('athena:conversations-set-active'");
  const end = source.indexOf("ipcMain.handle('athena:conversations-new'", start);
  const handler = source.slice(start, end);

  assert.doesNotMatch(handler, /conversations\.setActive/);
  assert.doesNotMatch(handler, /historyActiveConversationId\s*=/);
  assert.match(handler, /restorable:\s*false/);
});
