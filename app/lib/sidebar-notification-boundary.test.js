'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sidebar = fs.readFileSync(path.join(__dirname, 'sidebar.js'), 'utf8');

function slice(startToken, endToken) {
  const start = sidebar.indexOf(startToken);
  const end = sidebar.indexOf(endToken, start);
  assert.ok(start >= 0 && end > start, `sidebar.js production handler missing: ${startToken}`);
  return sidebar.slice(start, end);
}

const selectNotifyRoomSource = slice(
  '  function selectNotifyRoom(id)',
  '  // 7단계(F3-FE) — 기동 시 최근 발화한 라우틴',
);
const newConversationSource = slice(
  '  function clearConversationUi()',
  "  $newChat.addEventListener('click'",
);
const notifyBridgeSource = slice(
  '  window.AthenaNotify = {',
  '  // ---------- 부트 ----------',
);

function fakeHistory(count) {
  const history = {
    firstChild: null,
    removed: 0,
    removeChild(node) {
      assert.equal(node, this.firstChild);
      this.firstChild = node.next || null;
      this.removed += 1;
    },
  };
  for (let i = 0; i < count; i += 1) history.firstChild = { next: history.firstChild };
  return history;
}

function createContext({ view = 'backtest', roomCount = 2 } = {}) {
  const order = [];
  const newCalls = [];
  const state = { view };
  const $history = fakeHistory(2);
  let bannerHidden = true;
  const $roomBanner = {
    get hidden() { return bannerHidden; },
    set hidden(value) { bannerHidden = value; order.push(`banner:${value}`); },
  };
  const rooms = Array.from({ length: roomCount }, (_, index) => ({
    id: `room-${index + 1}`,
    title: `알림 ${index + 1}`,
    firedAt: Date.parse(`2026-09-08T0${index}:00:00+09:00`),
    read: false,
  }));
  const context = vm.createContext({
    Event,
    __notifyRooms: rooms,
    window: {
      dispatchEvent(event) { order.push(`${event.type}:${state.view}`); },
      AthenaShell: { clearCanvases() { order.push('clearCanvases'); } },
      AthenaCanvasMode: {
        state,
        setView(next) { order.push(`canvas:${next}`); state.view = next; },
      },
      AthenaModeNav: { setActive(next) { order.push(`nav:${next}`); } },
      athena: {
        invoke(channel, payload) {
          order.push(`invoke:${channel}`);
          if (channel === 'athena:conversations-new') newCalls.push(payload);
          return Promise.resolve({ activeId: `conversation-${newCalls.length}` });
        },
      },
    },
    projectsCache: [{ id: 'project-1' }],
    currentProjectId: 'project-1',
    conversationsCache: [],
    activeConversationId: 'backtest-conversation',
    selectedNotifyId: null,
    $history,
    $roomBanner,
    $roomTime: { textContent: '' },
    $roomTitle: { textContent: '' },
    $input: null,
    currentMode: () => state.view,
    renderList() {},
    updateAgentBadge() {},
    updateModeCounts() {},
  });
  vm.runInContext([
    "'use strict';",
    'const notifyRooms = globalThis.__notifyRooms;',
    selectNotifyRoomSource,
    newConversationSource,
    notifyBridgeSource,
  ].join('\n'), context);
  return { context, order, newCalls, rooms, state, $history, $roomBanner };
}

test('백테스트에서 알림 방을 열면 앞 세션을 먼저 비우고 agent 새 대화를 만든 뒤 방을 표시한다', async () => {
  const harness = createContext();
  const selected = vm.runInContext("window.AthenaNotify.selectRoom('room-1')", harness.context);

  assert.equal(selected, true, 'selectRoom의 동기 boolean 계약이 유지돼야 한다');
  assert.equal(harness.$history.firstChild, null);
  assert.equal(harness.$history.removed, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.newCalls)), [
    { projectId: 'project-1', mode: 'agent' },
  ]);
  assert.equal(harness.state.view, 'agent');
  assert.equal(harness.$roomBanner.hidden, false);
  assert.ok(
    harness.order.indexOf('athena:new-conversation:backtest')
      < harness.order.indexOf('invoke:athena:conversations-new'),
    '앞 세션 flush 이벤트가 새 active id 요청보다 먼저여야 한다',
  );
  assert.ok(
    harness.order.indexOf('invoke:athena:conversations-new') < harness.order.indexOf('banner:false'),
    'clearConversationUi 뒤에 알림 배너를 적용해야 한다',
  );
  await Promise.resolve();
});

test('같은 알림 방 재선택은 대화를 유지하고 다른 방 선택만 agent 대화를 하나 더 만든다', () => {
  const harness = createContext({ view: 'agent' });
  assert.equal(vm.runInContext("window.AthenaNotify.selectRoom('missing')", harness.context), false);
  assert.equal(vm.runInContext("window.AthenaNotify.selectRoom('room-1')", harness.context), true);
  assert.equal(vm.runInContext("window.AthenaNotify.selectRoom('room-1')", harness.context), true);
  assert.equal(harness.newCalls.length, 1, '같은 방을 다시 눌러 새 대화를 중복 생성하면 안 된다');

  assert.equal(vm.runInContext("window.AthenaNotify.selectRoom('room-2')", harness.context), true);
  assert.equal(harness.newCalls.length, 2);
  assert.equal(harness.newCalls[1].projectId, 'project-1');
  assert.equal(harness.newCalls[1].mode, 'agent');
});

test('모드 네비의 실제 onSelect도 backtest 작업공간을 비운 뒤 agent 화면으로 전환한다', () => {
  const marker = '        onSelect: (view) => {';
  const start = sidebar.indexOf(marker) + '        onSelect: '.length;
  const endMarker = '\n        },\n      })';
  const end = sidebar.indexOf(endMarker, start);
  assert.ok(start > 0 && end > start, 'sidebar.js onSelect handler missing');
  const onSelectExpression = sidebar.slice(start, end + '\n        }'.length);
  const harness = createContext({ roomCount: 0 });
  Object.assign(harness.context, {
    loadAgentRoutines() {},
  });
  harness.context.window.AthenaAgentCanvas = { refresh() {} };
  vm.runInContext(`const modeOnSelect = ${onSelectExpression}; globalThis.__modeOnSelect = modeOnSelect;`, harness.context);

  vm.runInContext("__modeOnSelect('agent')", harness.context);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.newCalls)), [
    { projectId: 'project-1', mode: 'agent' },
  ]);
  assert.equal(harness.$history.firstChild, null);
  assert.ok(
    harness.order.indexOf('athena:new-conversation:backtest') < harness.order.indexOf('canvas:agent'),
    'setView 전에 앞 모드 작업공간을 flush해야 한다',
  );
});
