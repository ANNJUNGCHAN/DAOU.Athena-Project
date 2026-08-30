'use strict';

function createConversationRotationQueue({
  isShuttingDown,
  shutdownError = () => Object.assign(new Error('provider lifecycle is closed'), {
    code: 'APP_SHUTTING_DOWN',
  }),
  blockAdmission,
  interrupt,
  createConversationId,
  publishConversationId,
  beginConversation,
  rotateProvider,
  enqueue,
}) {
  let tail = Promise.resolve();
  const schedule = typeof enqueue === 'function' ? enqueue : (operation) => {
    const pending = tail.then(operation, operation);
    tail = pending.catch(() => {});
    return pending;
  };
  const assertOpen = () => {
    if (isShuttingDown()) throw shutdownError();
  };

  return Object.freeze({
    begin({ projectId, verifierCorrelationId } = {}) {
      return schedule(async () => {
        assertOpen();
        await blockAdmission('conversation_rotation');
        await interrupt();
        assertOpen();
        const id = createConversationId();
        assertOpen();
        publishConversationId(id);
        const state = beginConversation({ id, projectId });
        await rotateProvider('new_conversation', Object.freeze({ verifierCorrelationId }));
        assertOpen();
        return state;
      });
    },
  });
}

function createRestartableControllerLifecycle({
  createController,
  getController,
  setController,
}) {
  let ownedController = null;
  const read = getController || (() => ownedController);
  const write = setController || ((controller) => { ownedController = controller; });

  return Object.freeze({
    current: read,
    ensure(...args) {
      let controller = read();
      if (!controller) {
        controller = createController(...args);
        write(controller);
      }
      return controller;
    },
    async stopAndDiscard(reason, expectedController = read()) {
      if (!expectedController) return false;
      try {
        await expectedController.stop(reason);
      } finally {
        if (read() === expectedController) write(null);
      }
      return true;
    },
  });
}

module.exports = { createConversationRotationQueue, createRestartableControllerLifecycle };
