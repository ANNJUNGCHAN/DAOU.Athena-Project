'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('new conversation aborts prior work, drops the resume cursor, and rotates the record id in order', () => {
  const source = mainSource();
  const start = source.indexOf("ipcMain.handle('athena:conversations-new'");
  const end = source.indexOf("ipcMain.handle('athena:account-list'", start);
  const handler = source.slice(start, end);

  const abortAt = handler.indexOf('abortConversationWork(');
  const resetAt = handler.indexOf('liveSessionId = null');
  const rotateAt = handler.indexOf('historyActiveConversationId = crypto.randomUUID()');
  const beginAt = handler.indexOf('conversations.begin(');
  assert.ok(abortAt >= 0 && abortAt < resetAt && resetAt < rotateAt && rotateAt < beginAt);
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
