const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const chatSource = fs.readFileSync(path.join(__dirname, '..', 'chat.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function functionSource(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const open = source.indexOf('{', start);
  assert.ok(open > start, `missing body for ${signature}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unclosed ${signature}`);
}
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
    orderBody: { replaceChildren() {} },
    shell: { inert: true },
    app: { hidden: false },
    input: { focus() {} },
  };
  const context = { nodes };

  vm.runInNewContext(`
    const $onboard = nodes.onboard;
    const $boot = nodes.boot;
    const $settings = nodes.settings;
    const $order = nodes.order;
    const $orderBody = nodes.orderBody;
    const $shell = nodes.shell;
    const $app = nodes.app;
    const $input = nodes.input;
    let settingsOpen = false;
    let orderOpen = true;
    let orderTicketRevision = 4;
    let orderTicketOwner = { conversationId: 'conversation-a', revision: 4 };
    ${closeOrderTicket[0]}
    ${prepareRestReceiptSurface[0]}
    result = prepareRestReceiptSurface();
    finalState = { settingsOpen, orderOpen, orderTicketRevision, orderTicketOwner };
  `, context);

  assert.equal(context.result, true);
  assert.equal(nodes.order.hidden, true);
  assert.equal(nodes.app.hidden, false);
  assert.equal(nodes.shell.inert, false);
  assert.deepEqual(
    { ...context.finalState },
    { settingsOpen: false, orderOpen: false, orderTicketRevision: 5, orderTicketOwner: null }
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

test('A 주문 응답이 지연돼 B로 전환돼도 결과는 실행 당시 A 세션으로 라우팅된다', async () => {
  let resolveFetch;
  const fetchResult = new Promise((resolve) => { resolveFetch = resolve; });
  let activeConversationId = 'conversation-b';
  let fetchCalls = 0;
  const published = [];
  const context = vm.createContext({
    BACKEND_HTTP_BASE: 'http://backend.test',
    process: { env: {} },
    orderTicket: { interpretExecuteStatus: () => 'done' },
    protectedCards: { buildOrderActionCard: (value) => ({ status: 'success', envelope: value }) },
  });
  vm.runInContext(functionSource(mainSource, 'async function executeOrderRequest('), context);

  const rejected = await context.executeOrderRequest({
    trId: 'kt10000',
    body: { stk_cd: '005930', ord_qty: '1' },
    idempotencyKey: 'stale-ticket-a',
    conversationId: 'conversation-a',
  }, {
    fetchImpl: () => { fetchCalls += 1; return fetchResult; },
    activeConversationId: () => activeConversationId,
    publishResult: (result, metadata) => published.push({ result, metadata }),
  });
  assert.equal(rejected.ok, false);
  assert.equal(fetchCalls, 0);
  assert.equal(published.length, 0);

  activeConversationId = 'conversation-a';
  const pending = context.executeOrderRequest({
    trId: 'kt10000',
    body: { stk_cd: '005930', ord_qty: '1' },
    idempotencyKey: 'ticket-a',
    conversationId: 'conversation-a',
  }, {
    fetchImpl: () => { fetchCalls += 1; return fetchResult; },
    activeConversationId: () => activeConversationId,
    publishResult: (result, metadata) => published.push({ result, metadata }),
  });
  activeConversationId = 'conversation-b';
  resolveFetch({ ok: true, status: 200, json: async () => ({ ord_no: 'A-1' }) });
  const response = await pending;

  assert.equal(response.ok, true);
  assert.equal(fetchCalls, 1);
  assert.equal(published.length, 1);
  assert.equal(published[0].metadata.conversationId, 'conversation-a');
  assert.equal(published[0].result.envelope.response.data.ord_no, 'A-1');
  assert.doesNotMatch(chatSource, /addLiveCard\(protectedCardsLib\.buildOrderActionCard/);
});
