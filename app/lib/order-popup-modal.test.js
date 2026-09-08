const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const chatSource = fs.readFileSync(path.join(__dirname, '..', 'chat.js'), 'utf8');
const prepareRestReceiptSurface = chatSource.match(
  /function prepareRestReceiptSurface\(\) \{[\s\S]*?\n\}/
);
const openOrderTicket = chatSource.match(
  /function openOrderTicket\(prefill\) \{[\s\S]*?\n\}/
);
const closeOrderTicket = chatSource.match(
  /function closeOrderTicket\(expectedOwner = null\) \{[\s\S]*?\n\}/
);
const isCurrentOrderTicket = chatSource.match(
  /function isCurrentOrderTicket\(owner\) \{[\s\S]*?\n\}/
);
const closeOrderTicketForConversationChange = chatSource.match(
  /function closeOrderTicketForConversationChange\(nextConversationId\) \{[\s\S]*?\n\}/
);

test('주문 모달 중 영수증 복귀는 배경 셸의 inert 잠금을 해제한다', () => {
  assert.ok(prepareRestReceiptSurface, 'prepareRestReceiptSurface source exists');
  const nodes = {
    onboard: { hidden: true },
    boot: { hidden: false },
    settings: { hidden: false },
    order: { hidden: false },
    shell: { inert: true },
    app: { hidden: false },
  };
  const context = { nodes };

  vm.runInNewContext(`
    const $onboard = nodes.onboard;
    const $boot = nodes.boot;
    const $settings = nodes.settings;
    const $order = nodes.order;
    const $shell = nodes.shell;
    const $app = nodes.app;
    let settingsOpen = false;
    let orderOpen = true;
    ${prepareRestReceiptSurface[0]}
    result = prepareRestReceiptSurface();
    finalState = { settingsOpen, orderOpen };
  `, context);

  assert.equal(context.result, true);
  assert.equal(nodes.order.hidden, true);
  assert.equal(nodes.app.hidden, false);
  assert.equal(nodes.shell.inert, false);
  assert.deepEqual(
    { ...context.finalState },
    { settingsOpen: false, orderOpen: false }
  );
});

test('지연된 A→B 전환 중에는 이전 A 화면에서 주문 티켓을 새로 열지 않는다', () => {
  assert.ok(openOrderTicket, 'openOrderTicket source exists');
  const context = {
    nodes: {
      onboard: { hidden: true },
      shell: { inert: false },
      order: { hidden: true, focus() {} },
    },
    renders: 0,
  };

  vm.runInNewContext(`
    const $onboard = nodes.onboard;
    const $shell = nodes.shell;
    const $order = nodes.order;
    let orderOpen = false;
    let switchingConversation = true;
    let displayedConversationId = 'conversation-a';
    let settingsOpen = false;
    let orderTicketRevision = 0;
    let orderTicketOwner = null;
    function renderOrderTicket() { renders += 1; }
    ${openOrderTicket[0]}
    openOrderTicket({ symbol: '005930' });
    snapshot = { orderOpen, orderTicketRevision, orderTicketOwner };
  `, context);

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.snapshot)),
    { orderOpen: false, orderTicketRevision: 0, orderTicketOwner: null }
  );
  assert.equal(context.renders, 0);
  assert.equal(context.nodes.order.hidden, true);
});

test('열린 주문 티켓은 실제 소유 대화가 바뀌면 닫히고 무효화된다', () => {
  assert.ok(closeOrderTicket, 'closeOrderTicket source exists');
  assert.ok(closeOrderTicketForConversationChange, 'owner change guard source exists');
  const context = {
    nodes: {
      orderBody: { replaceChildrenCalls: 0, replaceChildren() { this.replaceChildrenCalls += 1; } },
      order: { hidden: false },
      shell: { inert: true },
      input: { focusCalls: 0, focus() { this.focusCalls += 1; } },
    },
  };

  vm.runInNewContext(`
    const $orderBody = nodes.orderBody;
    const $order = nodes.order;
    const $shell = nodes.shell;
    const $input = nodes.input;
    let displayedConversationId = 'conversation-a';
    let orderOpen = true;
    let orderTicketRevision = 7;
    let orderTicketOwner = { conversationId: 'conversation-a', revision: 7 };
    ${closeOrderTicket[0]}
    ${closeOrderTicketForConversationChange[0]}
    closeOrderTicketForConversationChange('conversation-a');
    sameOwnerSnapshot = { orderOpen, orderTicketRevision, orderTicketOwner };
    closeOrderTicketForConversationChange('conversation-b');
    snapshot = { orderOpen, orderTicketRevision, orderTicketOwner };
  `, context);

  assert.equal(context.sameOwnerSnapshot.orderOpen, true);
  assert.equal(context.sameOwnerSnapshot.orderTicketRevision, 7);
  assert.equal(context.nodes.orderBody.replaceChildrenCalls, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.snapshot)),
    { orderOpen: false, orderTicketRevision: 8, orderTicketOwner: null }
  );
  assert.equal(context.nodes.order.hidden, true);
  assert.equal(context.nodes.shell.inert, false);
  assert.equal(context.nodes.orderBody.replaceChildrenCalls, 1);
});

test('같은 대화와 렌더 리비전의 사용자 클릭만 주문 실행 직전 검증을 통과한다', () => {
  assert.ok(isCurrentOrderTicket, 'isCurrentOrderTicket source exists');
  const context = {};

  vm.runInNewContext(`
    let displayedConversationId = 'conversation-a';
    let orderOpen = true;
    let orderTicketRevision = 3;
    const owner = { conversationId: 'conversation-a', revision: 3 };
    let orderTicketOwner = owner;
    ${isCurrentOrderTicket[0]}
    sameOwner = isCurrentOrderTicket(owner);
    displayedConversationId = 'conversation-b';
    changedOwner = isCurrentOrderTicket(owner);
  `, context);

  assert.equal(context.sameOwner, true);
  assert.equal(context.changedOwner, false);
  assert.match(
    chatSource,
    /if \(!isCurrentOrderTicket\(owner\)\) \{\s*closeOrderTicket\(owner\);\s*return;\s*\}\s*const res = await window\.athena\.invoke\('athena:order-execute'/
  );
  assert.match(
    chatSource,
    /if \(!switched \|\| !switched\.restorable\) return false;\s*if \(switched\.isCurrent\) return true;[\s\S]*?closeOrderTicketForConversationChange\(conv\.id\);/
  );
});
