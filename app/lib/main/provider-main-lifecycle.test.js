'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createConversationRotationQueue,
  createRestartableControllerLifecycle,
} = require('./provider-main-lifecycle');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('concurrent new conversations serialize block, interrupt, rotation, publication, and begin', async () => {
  const events = [];
  const firstRotation = deferred();
  let id = 0;
  let activeId = 'initial';
  const queue = createConversationRotationQueue({
    isShuttingDown: () => false,
    blockAdmission: () => events.push('block'),
    interrupt: () => events.push('interrupt'),
    createConversationId: () => `conversation-${++id}`,
    publishConversationId: (nextId) => { activeId = nextId; events.push(`publish:${nextId}`); },
    beginConversation: ({ id: nextId, projectId }) => {
      events.push(`begin:${nextId}:${projectId}`);
      return { activeId: nextId };
    },
    rotateProvider: async (reason) => {
      events.push(`rotate:${reason}`);
      if (events.filter((event) => event === `rotate:${reason}`).length === 1) await firstRotation.promise;
    },
  });

  const a = queue.begin({ projectId: 'A' });
  const b = queue.begin({ projectId: 'B' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [
    'block', 'interrupt', 'rotate:new_conversation',
  ]);
  assert.equal(activeId, 'initial');
  firstRotation.resolve();
  assert.deepEqual(await Promise.all([a, b]), [
    { activeId: 'conversation-1' },
    { activeId: 'conversation-2' },
  ]);
  assert.deepEqual(events, [
    'block', 'interrupt', 'rotate:new_conversation',
    'publish:conversation-1', 'begin:conversation-1:A',
    'block', 'interrupt', 'rotate:new_conversation',
    'publish:conversation-2', 'begin:conversation-2:B',
  ]);
});

test('conversation queue carries verifier correlation through an already-queued unrelated rotation', async () => {
  const events = [];
  let tail = Promise.resolve();
  const enqueue = (operation) => {
    const pending = tail.then(operation, operation);
    tail = pending.catch(() => {});
    return pending;
  };
  const releaseUnrelated = deferred();
  const unrelated = enqueue(async () => {
    events.push(['unrelated', null]);
    await releaseUnrelated.promise;
  });
  const queue = createConversationRotationQueue({
    enqueue,
    isShuttingDown: () => false,
    blockAdmission: () => {},
    interrupt: () => {},
    createConversationId: () => 'conversation-verifier',
    publishConversationId: () => {},
    beginConversation: () => ({ ok: true }),
    rotateProvider: (reason, metadata) => events.push([reason, metadata.verifierCorrelationId]),
  });
  const verifier = queue.begin({ projectId: 'A', verifierCorrelationId: 'rotate-exact' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [['unrelated', null]]);
  releaseUnrelated.resolve();
  await Promise.all([unrelated, verifier]);
  assert.deepEqual(events, [
    ['unrelated', null],
    ['new_conversation', 'rotate-exact'],
  ]);
});

test('conversation rotation rejects shutdown without publishing after provider rotation', async () => {
  let shuttingDown = false;
  let published = 0;
  const rotation = deferred();
  const queue = createConversationRotationQueue({
    isShuttingDown: () => shuttingDown,
    shutdownError: () => Object.assign(new Error('shutdown'), { code: 'APP_SHUTTING_DOWN' }),
    blockAdmission: () => {},
    interrupt: () => {},
    createConversationId: () => 'conversation-1',
    publishConversationId: () => { published += 1; },
    beginConversation: () => ({ ok: true }),
    rotateProvider: () => rotation.promise,
  });

  const pending = queue.begin({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(published, 0);
  shuttingDown = true;
  rotation.resolve();
  await assert.rejects(pending, (error) => error.code === 'APP_SHUTTING_DOWN');

  const blocked = queue.begin({});
  await assert.rejects(blocked, (error) => error.code === 'APP_SHUTTING_DOWN');
  assert.equal(published, 0);
});

test('provider rotation failure leaves conversation publication and persistence unchanged', async () => {
  let published = 0;
  let begun = 0;
  const queue = createConversationRotationQueue({
    isShuttingDown: () => false,
    blockAdmission: () => {},
    interrupt: () => {},
    createConversationId: () => 'conversation-rejected',
    publishConversationId: () => { published += 1; },
    beginConversation: () => { begun += 1; return { ok: true }; },
    rotateProvider: async () => { throw new Error('rotation failed'); },
  });

  await assert.rejects(queue.begin({}), /rotation failed/);
  assert.equal(published, 0);
  assert.equal(begun, 0);
});

test('stopped controller is discarded and mutation, logout, or disabled restart constructs fresh runtime', async () => {
  for (const reason of ['mcp_security_mutation', 'logout', 'provider_disabled_by_contract']) {
    const instances = [];
    const lifecycle = createRestartableControllerLifecycle({
      createController: () => {
        const instance = {
          id: instances.length + 1,
          starts: 0,
          stops: 0,
          async start() { this.starts += 1; },
          async ready() {},
          async stop() { this.stops += 1; },
        };
        instances.push(instance);
        return instance;
      },
    });
    const first = lifecycle.ensure();
    await first.start();
    await first.ready();
    await lifecycle.stopAndDiscard(reason);
    const second = lifecycle.ensure();
    await second.start();
    await second.ready();
    assert.notEqual(second, first);
    assert.equal(first.stops, 1);
    assert.equal(second.starts, 1);
  }
});
