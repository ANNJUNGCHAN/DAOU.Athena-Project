(function installProviderFirstPaint(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory;
    return;
  }
  if (!root || root.AthenaProviderFirstPaint) return;
  Object.defineProperty(root, 'AthenaProviderFirstPaint', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: factory(root),
  });
}(typeof window !== 'undefined' ? window : null, function createProviderFirstPaint(root, options) {
  'use strict';

  options = options || {};
  const pendingSubmits = new Map();
  const turns = new Map();
  const OWNER_BY_ORIGIN = Object.freeze({ shell: new Set(['chat', 'canvas']), orb: new Set(['orb']) });
  const maxRetained = Number.isSafeInteger(options.maxRetained) && options.maxRetained > 0
    ? options.maxRetained
    : 512;
  const retentionMs = Number.isFinite(options.retentionMs) && options.retentionMs >= 0
    ? options.retentionMs
    : 5 * 60_000;
  const wallClock = typeof options.now === 'function' ? options.now : Date.now;
  let claimCounter = 0;
  let ackCount = 0;
  let duplicateFailures = 0;
  let invalidFailures = 0;
  let timedOutSubmits = 0;

  function finite(value) {
    return Number.isFinite(value) && value >= 0;
  }

  function validOrigin(origin) {
    return origin === 'shell' || origin === 'orb';
  }

  function visibleNode(node) {
    try {
      if (!node || node.isConnected !== true) return false;
      const text = String(node.textContent || '').trim();
      const hasVisualChild = typeof node.querySelector === 'function'
        && Boolean(node.querySelector('canvas,svg,img,table,[data-provider-visible="true"]'));
      if (!text && !hasVisualChild) return false;
      if (node.hidden === true) return false;
      if (typeof root.getComputedStyle === 'function') {
        const style = root.getComputedStyle(node);
        if (!style || style.display === 'none' || style.visibility === 'hidden'
            || Number(style.opacity) === 0) return false;
      }
      if (typeof node.getBoundingClientRect !== 'function') return false;
      const rect = node.getBoundingClientRect();
      if (!rect || !finite(rect.width) || !finite(rect.height)
          || rect.width === 0 || rect.height === 0) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  function terminalRecord(record, state, terminalAt) {
    return Object.freeze({
      state,
      clientSubmitId: record.clientSubmitId,
      turnId: record.turnId,
      sequence: record.sequence,
      origin: record.origin,
      owner: record.owner,
      createdAt: record.createdAt,
      terminalAt,
    });
  }

  function markInvalid(record, at = wallClock()) {
    const current = turns.get(record.turnId);
    if (current && current.state !== 'claimed') return false;
    pendingSubmits.delete(record.clientSubmitId);
    turns.set(record.turnId, terminalRecord(record, 'invalid', at));
    invalidFailures += 1;
    return true;
  }

  function deleteTurn(turnId) {
    const current = turns.get(turnId);
    if (current && current.clientSubmitId) pendingSubmits.delete(current.clientSubmitId);
    return turns.delete(turnId);
  }

  function expirePending(clientSubmitId, timedOut, at) {
    if (!pendingSubmits.delete(clientSubmitId)) return;
    if (timedOut) timedOutSubmits += 1;
    for (const turn of turns.values()) {
      if (turn.clientSubmitId === clientSubmitId && turn.state === 'claimed') markInvalid(turn, at);
    }
  }

  function pruneRetained() {
    const now = wallClock();
    const cutoff = now - retentionMs;
    for (const [turnId, turn] of turns) {
      if (turn.state !== 'claimed' && turn.terminalAt <= cutoff) turns.delete(turnId);
    }
    for (const [clientSubmitId, pending] of pendingSubmits) {
      if (pending.createdAt <= cutoff) expirePending(clientSubmitId, true, now);
    }
    for (const turn of turns.values()) {
      if (turn.state === 'claimed'
          && (turn.createdAt <= cutoff || !pendingSubmits.has(turn.clientSubmitId))) {
        markInvalid(turn, now);
      }
    }
    while (pendingSubmits.size > maxRetained) {
      expirePending(pendingSubmits.keys().next().value, false, now);
    }
    while (turns.size > maxRetained) turns.delete(turns.keys().next().value);
  }

  function registerSubmit({ clientSubmitId, rendererSubmittedAt, origin } = {}) {
    pruneRetained();
    if (typeof clientSubmitId !== 'string' || !clientSubmitId
        || !finite(rendererSubmittedAt) || !validOrigin(origin)) return false;
    if (pendingSubmits.has(clientSubmitId)) return false;
    pendingSubmits.set(clientSubmitId, Object.freeze({
      rendererSubmittedAt,
      origin,
      createdAt: wallClock(),
    }));
    pruneRetained();
    return pendingSubmits.has(clientSubmitId);
  }

  function acknowledge(record, token) {
    root.requestAnimationFrame(() => root.requestAnimationFrame(() => {
      pruneRetained();
      const current = turns.get(record.turnId);
      if (!current || current.state !== 'claimed' || current.token !== token) return;
      const pending = pendingSubmits.get(record.clientSubmitId);
      const rendererPaintedAt = root.performance.now();
      if (!visibleNode(record.node)
          || !pending
          || pending.origin !== record.origin
          || !finite(rendererPaintedAt)
          || rendererPaintedAt < record.rendererReceivedAt) {
        markInvalid(current);
        return;
      }
      const payload = Object.freeze({
        clientSubmitId: record.clientSubmitId,
        turnId: record.turnId,
        sequence: record.sequence,
        rendererSubmittedAt: pending.rendererSubmittedAt,
        rendererReceivedAt: record.rendererReceivedAt,
        rendererPaintedAt,
      });
      turns.set(record.turnId, terminalRecord(record, 'acked', wallClock()));
      pendingSubmits.delete(record.clientSubmitId);
      ackCount += 1;
      root.athena.send('athena:provider-paint-ack', payload);
    }));
  }

  function invalidCandidate({ clientSubmitId, turnId, sequence, origin, owner }) {
    const record = {
      state: 'claimed',
      clientSubmitId: typeof clientSubmitId === 'string' ? clientSubmitId : null,
      turnId,
      sequence: Number.isSafeInteger(sequence) ? sequence : null,
      origin: validOrigin(origin) ? origin : null,
      owner: typeof owner === 'string' ? owner : null,
      createdAt: wallClock(),
    };
    markInvalid(record);
  }

  function claimFirstVisible({
    clientSubmitId,
    turnId,
    sequence,
    origin,
    owner,
    node,
    rendererReceivedAt,
  } = {}) {
    pruneRetained();
    if (typeof turnId !== 'string' || !turnId) {
      invalidFailures += 1;
      return false;
    }

    const current = turns.get(turnId);
    if (current) {
      if (current.state === 'claimed'
          && ((!pendingSubmits.has(current.clientSubmitId))
            || clientSubmitId !== current.clientSubmitId
            || origin !== current.origin
            || (Number.isSafeInteger(sequence) && sequence < current.sequence))) {
        markInvalid(current);
      } else {
        duplicateFailures += 1;
      }
      return false;
    }

    const pending = pendingSubmits.get(clientSubmitId);
    const owners = validOrigin(origin) ? OWNER_BY_ORIGIN[origin] : null;
    if (!pending
        || pending.origin !== origin
        || !owners
        || !owners.has(owner)
        || !Number.isSafeInteger(sequence)
        || sequence < 1
        || !finite(rendererReceivedAt)
        || rendererReceivedAt < pending.rendererSubmittedAt
        || !visibleNode(node)) {
      invalidCandidate({ clientSubmitId, turnId, sequence, origin, owner });
      return false;
    }

    const token = `${turnId}:${++claimCounter}`;
    const record = Object.freeze({
      state: 'claimed', token, clientSubmitId, turnId, sequence,
      origin, owner, node, rendererReceivedAt, createdAt: wallClock(),
    });
    turns.set(turnId, record);
    acknowledge(record, token);
    return true;
  }

  function invalidateTurn(turnId) {
    const current = turns.get(turnId);
    if (!current || current.state !== 'claimed') return false;
    return markInvalid(current);
  }

  function cleanupTurn(turnId) {
    return deleteTurn(turnId);
  }

  function snapshot() {
    pruneRetained();
    let claimed = 0;
    let acked = 0;
    let invalid = 0;
    for (const turn of turns.values()) {
      if (turn.state === 'claimed') claimed += 1;
      else if (turn.state === 'acked') acked += 1;
      else if (turn.state === 'invalid') invalid += 1;
    }
    return Object.freeze({
      pendingSubmits: pendingSubmits.size,
      turns: turns.size,
      claimed,
      acked,
      invalid,
      ackCount,
      duplicateFailures,
      invalidFailures,
      timedOutSubmits,
    });
  }

  return Object.freeze({ claimFirstVisible, cleanupTurn, invalidateTurn, registerSubmit, snapshot });
}));
