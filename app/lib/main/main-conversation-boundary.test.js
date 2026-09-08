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
  const saveCalls = [...turn.matchAll(/historySink\.saveChatMessage\(\s*\{([\s\S]*?)\}\s*,/g)];
  assert.ok(saveCalls.length > 0);
  for (const call of saveCalls) assert.match(call[1], /conversationId:\s*turnConversationId/);
  assert.doesNotMatch(turn, /touchConversationEntry\((query|question)\);/);
  // 커서는 그 턴의 대화 런타임에 적힌다(다중 대화, 2026-09-08) — 활성 대화 여부로 가리지 않는다.
  assert.match(turn, /runtime\.liveSessionId = result\.finalResult\.session_id/);
  assert.doesNotMatch(turn, /historyConversationId\(\) === turnConversationId[^\n]*\n[^\n]*session_id/);
});

test('new conversation serializes abort and provider rotation before record publication and persistence', async () => {
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
    'rotate:null',
    'publish',
    'begin:conversation-next',
  ]);
});

// 이력 행 선택은 실제 전환이다(41번 보드). 다만 기록 대상 id와 Claude 커서는
// 새 대화 만들기와 같은 직렬화 큐 안에서만 바뀌어야 한다 — 핸들러가 큐를
// 우회해 직접 대입하면 진행 중 턴의 메시지가 엉뚱한 제목 아래 섞인다.
test('history selection retargets the live record only through the serialized switch queue', () => {
  const source = mainSource();
  const start = source.indexOf("ipcMain.handle('athena:conversations-set-active'");
  const end = source.indexOf("ipcMain.handle('athena:conversations-new'", start);
  const handler = source.slice(start, end);

  assert.match(handler, /providerConversationRotationQueue\.switchTo\(/);
  assert.doesNotMatch(handler, /conversations\.setActive/);
  assert.doesNotMatch(handler, /historyActiveConversationId\s*=/);
  assert.doesNotMatch(handler, /liveSessionId\s*=/);
  // 모르는 id만 복원 불가다 — 아는 대화를 "복원 불가"로 돌려보내면 안 된다.
  assert.match(handler, /if \(!known\)[\s\S]*restorable:\s*false/);
});

test('switching to an existing conversation serializes abort and rotation, then publishes the chosen id', async () => {
  const events = [];
  let publishedId = null;
  const queue = createConversationRotationQueue({
    isShuttingDown: () => false,
    blockAdmission: (reason) => events.push(`block:${reason}`),
    interrupt: () => events.push('abort'),
    createConversationId: () => { throw new Error('switchTo must not mint a new id'); },
    publishConversationId: (id) => { publishedId = id; events.push('publish'); },
    beginConversation: () => { throw new Error('switchTo must not begin a new conversation'); },
    selectConversation: ({ id }) => { events.push(`select:${id}`); return { activeId: id }; },
    rotateProvider: (reason) => events.push(`rotate:${reason}:${publishedId}`),
  });

  assert.deepEqual(await queue.switchTo({ id: 'conversation-old' }), { activeId: 'conversation-old' });
  assert.deepEqual(events, [
    'block:conversation_switch',
    'abort',
    'rotate:switch_conversation:null',
    'publish',
    'select:conversation-old',
  ]);
  assert.equal(publishedId, 'conversation-old');
});
