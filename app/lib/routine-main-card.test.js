'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeDescriptor, hasConfirmedMainCard, needsConfirmation, sameDescriptor,
  createConfirmationController, normalizeOpenResult, createExclusiveRenderer, createSessionClearGuard,
  conversationScopeChanged,
} = require('./routine-main-card');

const candidate = { operation_ref: 'athena_stock_quote', args: { symbol: '005930' }, title: '시세' };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('descriptor requires exact operation_ref, args and authoritative title', () => {
  assert.deepEqual(normalizeDescriptor(candidate), candidate);
  assert.equal(normalizeDescriptor({ operation_ref: 'x', title: '시세' }), null);
  assert.equal(normalizeDescriptor({ operation_ref: 'x', args: {}, title: '' }), null);
});

test('candidate gates a new draft until the main card is confirmed; legacy draft stays compatible', () => {
  assert.equal(needsConfirmation({ main_card_candidate: candidate, main_card: null }), true);
  assert.equal(needsConfirmation({ main_card_candidate: null, main_card: null }), false);
  const confirmed = { main_card_candidate: candidate, main_card: candidate, main_card_confirmed_at: '2026-09-08T01:02:03Z' };
  assert.equal(hasConfirmedMainCard(confirmed), true);
  assert.equal(needsConfirmation(confirmed), false);
  assert.equal(needsConfirmation({ ...confirmed, main_card_pending: true }), true, 'replacement candidate remains gated');
});

test('descriptor equality ignores object key order but includes operation, args and title', () => {
  assert.equal(sameDescriptor(candidate, { title: '시세', args: { symbol: '005930' }, operation_ref: 'athena_stock_quote' }), true);
  assert.equal(sameDescriptor(candidate, { ...candidate, title: '차트' }), false);
});

test('typed 네 confirms only one pending candidate in the current conversation', async () => {
  const controller = createConfirmationController();
  const calls = [];
  controller.setCurrentConversation('chat-a');
  controller.register({ conversationId: 'chat-a', routineId: 'r1', candidate, confirm: async (value) => {
    calls.push(value); return { ok: true };
  } });
  controller.register({ conversationId: 'chat-b', routineId: 'r2', candidate, confirm: async () => ({ ok: true }) });

  assert.equal((await controller.handleAffirmative('네')).handled, true);
  assert.deepEqual(calls, [candidate]);
  assert.equal((await controller.handleAffirmative('네')).handled, false, 'confirmed candidate is removed');
});

test('button confirmation removes only its exact candidate from typed-yes interception', async () => {
  const controller = createConfirmationController();
  controller.setCurrentConversation('chat-a');
  controller.register({ conversationId: 'chat-a', routineId: 'r1', candidate, confirm: async () => ({ ok: true }) });
  assert.equal(controller.remove('r1', 'chat-a', candidate), true);
  assert.equal((await controller.handleAffirmative('네')).handled, false);

  const replacement = { ...candidate, title: '차트' };
  controller.register({ conversationId: 'chat-a', routineId: 'r1', candidate: replacement, confirm: async () => ({ ok: true }) });
  assert.equal(controller.remove('r1', 'chat-a', candidate), false, 'old button cannot remove replacement');
  assert.equal((await controller.handleAffirmative('네')).handled, true);
});

test('retiring an origin-chat candidate removes it even while another chat is current', async () => {
  const controller = createConfirmationController();
  controller.setCurrentConversation('chat-a');
  controller.register({ conversationId: 'chat-a', routineId: 'r1', candidate, confirm: async () => ({ ok: true }) });
  controller.setCurrentConversation('chat-b');
  assert.equal(controller.remove('r1', 'chat-a', candidate), true);
  controller.setCurrentConversation('chat-a');
  assert.equal((await controller.handleAffirmative('네')).handled, false);
});

test('typed affirmative does not intercept unrelated text, another chat or ambiguous candidates', async () => {
  const controller = createConfirmationController();
  controller.setCurrentConversation('chat-a');
  controller.register({ conversationId: 'chat-b', routineId: 'r0', candidate, confirm: async () => ({ ok: true }) });
  assert.equal((await controller.handleAffirmative('네')).handled, false);
  controller.register({ conversationId: 'chat-a', routineId: 'r1', candidate, confirm: async () => ({ ok: true }) });
  controller.register({ conversationId: 'chat-a', routineId: 'r2', candidate, confirm: async () => ({ ok: true }) });
  assert.equal((await controller.handleAffirmative('네')).handled, false);
  assert.equal((await controller.handleAffirmative('네, 다른 카드')).handled, false);
});

test('candidate stays bound to its origin chat across navigation', async () => {
  const controller = createConfirmationController();
  let calls = 0;
  controller.setCurrentConversation('chat-a');
  controller.register({ conversationId: 'chat-a', routineId: 'r1', candidate, confirm: async () => {
    calls += 1; return { ok: true };
  } });
  controller.setCurrentConversation('chat-b');
  assert.equal((await controller.handleAffirmative('네')).handled, false);
  controller.setCurrentConversation('chat-a');
  assert.equal((await controller.handleAffirmative('네')).handled, true);
  assert.equal(calls, 1);
});

test('a different user query invalidates typed-yes interception in the current chat only', async () => {
  const controller = createConfirmationController();
  controller.setCurrentConversation('chat-a');
  controller.register({ conversationId: 'chat-a', routineId: 'r1', candidate, confirm: async () => ({ ok: true }) });
  controller.register({ conversationId: 'chat-b', routineId: 'r2', candidate, confirm: async () => ({ ok: true }) });
  controller.invalidateCurrent();
  assert.equal((await controller.handleAffirmative('네')).handled, false);
  controller.setCurrentConversation('chat-b');
  assert.equal((await controller.handleAffirmative('네')).handled, true);
});

test('typed 네 consumes a duplicate submit while confirmation is in flight', async () => {
  const controller = createConfirmationController();
  controller.setCurrentConversation('chat-a');
  let release;
  controller.register({ conversationId: 'chat-a', routineId: 'r1', candidate, confirm: () => new Promise((resolve) => { release = resolve; }) });
  const first = controller.handleAffirmative('네');
  const second = await controller.handleAffirmative('네');
  assert.deepEqual(second, { handled: true, ok: false, busy: true });
  release({ ok: true });
  assert.equal((await first).ok, true);
});

test('an older in-flight confirmation cannot delete a replacement candidate registration', async () => {
  const controller = createConfirmationController();
  controller.setCurrentConversation('chat-a');
  let release;
  controller.register({ conversationId: 'chat-a', routineId: 'r1', candidate, confirm: () => new Promise((resolve) => { release = resolve; }) });
  const first = controller.handleAffirmative('네');
  const replacement = { ...candidate, title: '차트' };
  let replacementCalls = 0;
  controller.register({ conversationId: 'chat-a', routineId: 'r1', candidate: replacement, confirm: async () => {
    replacementCalls += 1; return { ok: true };
  } });
  release({ ok: true });
  await first;
  assert.equal((await controller.handleAffirmative('네')).handled, true);
  assert.equal(replacementCalls, 1);
});

test('open result accepts one canonical canvas result and rejects incomplete responses', () => {
  const envelope = { canvas_type: 'facts', title: '시세', fields: [] };
  assert.deepEqual(normalizeOpenResult({ ok: true, conversationId: 'c1', id: 'r1', card: envelope }), {
    conversationId: 'c1', routineId: 'r1', card: { status: 'success', envelope },
  });
  assert.equal(normalizeOpenResult({ ok: true, conversationId: 'c1', id: 'r1' }), null);
});

test('exclusive renderer destroys only its late card after conversation invalidation', async () => {
  const old = { id: 'old' };
  const nextConversationCard = { id: 'next' };
  const late = { id: 'late' };
  let cards = [old];
  let release;
  const renderer = createExclusiveRenderer({
    clear: () => { cards = []; },
    render: () => new Promise((resolve) => { release = () => { cards.push(late); resolve(late); }; }),
    list: () => cards.slice(),
    destroy: (node) => { cards = cards.filter((card) => card !== node); },
  });
  const pending = renderer.renderOnly({});
  renderer.invalidate();
  cards.push(nextConversationCard);
  release();
  assert.equal(await pending, false);
  assert.deepEqual(cards, [nextConversationCard]);
});

test('exclusive renderer clears prior cards and leaves exactly its one rendered card', async () => {
  const rendered = { id: 'main' };
  let cards = [{ id: 'prior' }];
  const renderer = createExclusiveRenderer({
    clear: () => { cards = []; },
    render: async () => { cards.push(rendered, { id: 'stray' }); return rendered; },
    list: () => cards.slice(),
    destroy: (node) => { cards = cards.filter((card) => card !== node); },
  });
  assert.equal(await renderer.renderOnly({}), true);
  assert.deepEqual(cards, [rendered]);
});

test('alarm-card conversation transition preserves the old session for one clear only', () => {
  const guard = createSessionClearGuard();
  assert.equal(guard.shouldReportAfterClear(), true, 'normal clear still reports empty cards');
  guard.preserveNextClear();
  assert.equal(guard.shouldReportAfterClear(), false, 'transition clear does not overwrite old session');
  assert.equal(guard.shouldReportAfterClear(), true, 'suppression is consumed once');
});

test('unchanged conversation polling preserves a pending card render; a real scope change destroys its late node', async () => {
  const rendered = deferred();
  const destroyed = [];
  let nodes = [];
  const renderer = createExclusiveRenderer({
    clear: () => { nodes = []; },
    render: async () => {
      const node = await rendered.promise;
      nodes.push(node);
      return node;
    },
    list: () => nodes,
    destroy: (node) => {
      destroyed.push(node);
      nodes = nodes.filter((item) => item !== node);
    },
  });

  const pending = renderer.renderOnly({ id: 'routine-1' });
  assert.equal(conversationScopeChanged('chat-a', 'chat-a'), false);
  if (conversationScopeChanged('chat-a', 'chat-a')) renderer.invalidate();
  rendered.resolve({ id: 'main-card' });
  assert.equal(await pending, true);
  assert.deepEqual(destroyed, []);

  const late = deferred();
  const changedRenderer = createExclusiveRenderer({
    clear: () => {},
    render: () => late.promise,
    list: () => [],
    destroy: (node) => destroyed.push(node),
  });
  const changedPending = changedRenderer.renderOnly({ id: 'routine-2' });
  assert.equal(conversationScopeChanged('chat-a', 'chat-b'), true);
  if (conversationScopeChanged('chat-a', 'chat-b')) changedRenderer.invalidate();
  late.resolve({ id: 'late-card' });
  assert.equal(await changedPending, false);
  assert.deepEqual(destroyed, [{ id: 'late-card' }]);
});
