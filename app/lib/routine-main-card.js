(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.AthenaLib = root.AthenaLib || {};
    root.AthenaLib.RoutineMainCard = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizeDescriptor(value) {
    if (!isPlainObject(value)) return null;
    const operationRef = typeof value.operation_ref === 'string' ? value.operation_ref.trim() : '';
    const title = typeof value.title === 'string' ? value.title.trim() : '';
    if (!operationRef || !title || !isPlainObject(value.args)) return null;
    return { operation_ref: operationRef, args: value.args, title };
  }

  function hasConfirmedMainCard(routine) {
    return !!(routine && normalizeDescriptor(routine.main_card) && routine.main_card_confirmed_at);
  }

  function descriptorSignature(value) {
    const descriptor = normalizeDescriptor(value);
    if (!descriptor) return null;
    const sortValue = (input) => {
      if (Array.isArray(input)) return input.map(sortValue);
      if (!isPlainObject(input)) return input;
      return Object.keys(input).sort().reduce((out, key) => {
        out[key] = sortValue(input[key]);
        return out;
      }, {});
    };
    return JSON.stringify(sortValue(descriptor));
  }

  function sameDescriptor(a, b) {
    const left = descriptorSignature(a);
    return left !== null && left === descriptorSignature(b);
  }

  // 새 초안은 후보가 있으면 사람이 카드를 확정해야 켤 수 있다. 후보 자체가 없는
  // 레거시 REST 초안은 이 프런트 게이트가 새로 막지 않는다.
  function needsConfirmation(routine) {
    const hasCandidate = !!normalizeDescriptor(routine && routine.main_card_candidate);
    if (!hasCandidate) return false;
    if (routine && routine.main_card_pending === true) return true;
    return !hasConfirmedMainCard(routine);
  }

  function affirmative(text) {
    return /^\s*네[.!]?\s*$/.test(String(text || ''));
  }

  function createConfirmationController() {
    let currentConversationId = null;
    const pending = new Map();

    function setCurrentConversation(id) {
      currentConversationId = id == null || String(id).trim() === '' ? null : String(id);
    }

    function register({ conversationId, routineId, candidate, confirm }) {
      const descriptor = normalizeDescriptor(candidate);
      const cid = conversationId == null ? currentConversationId : String(conversationId);
      if (!cid || routineId == null || !descriptor || typeof confirm !== 'function') return false;
      pending.set(`${cid}\u0000${routineId}`, {
        conversationId: cid,
        routineId,
        candidate: descriptor,
        confirm,
        inFlight: false,
      });
      return true;
    }

    function remove(routineId, conversationId, expectedCandidate) {
      const cid = conversationId == null ? currentConversationId : String(conversationId);
      if (!cid) return false;
      const key = `${cid}\u0000${routineId}`;
      const entry = pending.get(key);
      if (!entry) return false;
      if (expectedCandidate && !sameDescriptor(entry.candidate, expectedCandidate)) return false;
      return pending.delete(key);
    }

    function invalidateCurrent() {
      for (const [key] of currentEntries()) pending.delete(key);
    }

    function currentEntries() {
      if (!currentConversationId) return [];
      const prefix = `${currentConversationId}\u0000`;
      return Array.from(pending.entries()).filter(([key]) => key.startsWith(prefix));
    }

    async function handleAffirmative(text) {
      if (!affirmative(text)) return { handled: false };
      const entries = currentEntries();
      if (entries.length !== 1) return { handled: false };
      const [key, entry] = entries[0];
      // 두 번 Enter를 눌러도 두 번째 요청을 모델로 흘리지 않고 같은 사람 확인의
      // 진행 중 상태로 소비한다.
      if (entry.inFlight) return { handled: true, ok: false, busy: true };
      entry.inFlight = true;
      try {
        const result = await entry.confirm(entry.candidate);
        if (result && result.ok && pending.get(key) === entry) pending.delete(key);
        return { handled: true, ok: !!(result && result.ok), result };
      } finally {
        const stillPending = pending.get(key);
        if (stillPending) stillPending.inFlight = false;
      }
    }

    return { setCurrentConversation, register, remove, invalidateCurrent, handleAffirmative };
  }

  function normalizeOpenResult(result) {
    if (!result || result.ok !== true) return null;
    const conversationId = typeof result.conversationId === 'string' ? result.conversationId.trim() : '';
    const routineId = result.id == null ? '' : String(result.id);
    if (!conversationId || !routineId || !result.card || typeof result.card !== 'object') return null;
    const card = result.card.envelope
      ? result.card
      : { status: 'success', envelope: result.card };
    return { conversationId, routineId, card };
  }

  function createExclusiveRenderer({ clear, render, list, destroy, onRendered }) {
    let generation = 0;
    function invalidate() { generation += 1; }
    async function renderOnly(result) {
      clear();
      const mine = ++generation;
      const node = await render(result);
      if (!node) return false;
      if (mine !== generation) {
        destroy(node);
        return false;
      }
      for (const other of list()) {
        if (other !== node) destroy(other);
      }
      if (typeof onRendered === 'function') onRendered(node, result);
      return list().length === 1 && list()[0] === node;
    }
    return { invalidate, renderOnly };
  }

  function createSessionClearGuard() {
    let preserveNext = false;
    return {
      preserveNextClear() { preserveNext = true; },
      shouldReportAfterClear() {
        const shouldReport = !preserveNext;
        preserveNext = false;
        return shouldReport;
      },
    };
  }

  function conversationScopeChanged(previousId, nextId) {
    return (previousId || null) !== (nextId || null);
  }

  return {
    normalizeDescriptor,
    descriptorSignature,
    sameDescriptor,
    hasConfirmedMainCard,
    needsConfirmation,
    affirmative,
    createConfirmationController,
    normalizeOpenResult,
    createExclusiveRenderer,
    createSessionClearGuard,
    conversationScopeChanged,
  };
});
