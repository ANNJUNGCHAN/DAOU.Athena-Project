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
  selectConversation,
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
    // mode: 새 대화가 어느 모드에서 시작됐는가(35·40번 보드 — 대화는 모드에 묶인다).
    // 사이드바가 보내는 view 어휘 그대로 넘기고, 어휘 변환은 conversations.begin이 한다.
    begin({ projectId, mode, verifierCorrelationId } = {}) {
      return schedule(async () => {
        assertOpen();
        await blockAdmission('conversation_rotation');
        await interrupt();
        assertOpen();
        const id = createConversationId();
        assertOpen();
        await rotateProvider('new_conversation', Object.freeze({ verifierCorrelationId }));
        assertOpen();
        publishConversationId(id);
        const state = beginConversation({ id, projectId, mode });
        return state;
      });
    },
    // 이력 행을 눌러 기존 대화로 돌아간다(41번 보드). begin과 같은 직렬화 안에서
    // 돈다 — 새 대화 만들기와 기존 대화 열기가 서로를 앞지르면 기록 대상 id가
    // 엇갈린다. 새 id를 만들지 않고 고른 id를 그대로 발행하며, 커서(resume)는
    // selectConversation이 돌려주는 레코드에서 호출자가 잇는다.
    switchTo({ id, verifierCorrelationId } = {}) {
      return schedule(async () => {
        assertOpen();
        await blockAdmission('conversation_switch');
        await interrupt();
        assertOpen();
        await rotateProvider('switch_conversation', Object.freeze({ verifierCorrelationId }));
        assertOpen();
        publishConversationId(id);
        return typeof selectConversation === 'function' ? selectConversation({ id }) : null;
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
