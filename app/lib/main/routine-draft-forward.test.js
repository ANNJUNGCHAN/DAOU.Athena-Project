'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appDir = path.join(__dirname, '..', '..');
const mainSource = fs.readFileSync(path.join(appDir, 'main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(appDir, 'preload.js'), 'utf8');
const chatSource = fs.readFileSync(path.join(appDir, 'chat.js'), 'utf8');

function routineDraftForwarder() {
  const start = mainSource.indexOf('function maybeForwardRoutineDraft(');
  const end = mainSource.indexOf('// 루틴 제어 제안 카드', start);
  assert.ok(start >= 0 && end > start);
  const sent = [];
  const scope = {
    ROUTINE_TOOL_NAME: 'athena_routine',
    forwardingConversationId: 'conversation-a',
    extractToolResultText: (content) => content,
    shellWin: { isDestroyed: () => false },
    shellForConversation: (conversationId) => ({
      send: (channel, payload) => sent.push({ conversationId, channel, payload }),
    }),
  };
  vm.createContext(scope);
  vm.runInContext(mainSource.slice(start, end), scope);
  return { forward: scope.maybeForwardRoutineDraft, sent };
}

test('draft tool_result는 그 결과의 초안 하나만 원래 대화로 전달한다', () => {
  const h = routineDraftForwarder();
  const routine = { id: 'draft-a', status: 'draft', mode: 'code-watch' };
  h.forward(
    { name: 'mcp__athena__athena_routine', input: { action: 'draft' } },
    { is_error: false, content: JSON.stringify(routine) },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(h.sent)), [{
    conversationId: 'conversation-a',
    channel: 'athena:routine-draft-created',
    payload: routine,
  }]);
});

test('다른 액션·실패·id 없는 결과는 초안 이벤트를 만들지 않는다', () => {
  const h = routineDraftForwarder();
  h.forward({ name: 'athena_routine', input: { action: 'propose' } }, { content: '{}' });
  h.forward({ name: 'athena_routine', input: { action: 'draft' } }, {
    is_error: true, content: JSON.stringify({ id: 'x', status: 'draft' }),
  });
  h.forward({ name: 'athena_routine', input: { action: 'draft' } }, {
    content: JSON.stringify({ status: 'draft' }),
  });
  assert.deepEqual(h.sent, []);
});

test('tracker·preload·renderer가 정확한 초안 이벤트 채널을 한 번씩 잇는다', () => {
  assert.match(mainSource, /maybeForwardRoutineDraft\(step, block\)/);
  assert.match(preloadSource, /'athena:routine-draft-created'/);
  assert.equal(chatSource.split("window.athena.on('athena:routine-draft-created'").length - 1, 1);
  assert.doesNotMatch(
    mainSource.slice(mainSource.indexOf('function maybeForwardRoutineDraft('), mainSource.indexOf('// 루틴 제어 제안 카드')),
    /routines-list/,
  );
});
