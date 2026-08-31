'use strict';

const ACK_KEYS = Object.freeze([
  'clientSubmitId',
  'rendererPaintedAt',
  'rendererReceivedAt',
  'rendererSubmittedAt',
  'sequence',
  'turnId',
]);

function validAckPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (Object.keys(payload).sort().join('|') !== ACK_KEYS.join('|')) return false;
  if (typeof payload.clientSubmitId !== 'string' || !payload.clientSubmitId) return false;
  if (typeof payload.turnId !== 'string' || !payload.turnId) return false;
  if (!Number.isSafeInteger(payload.sequence) || payload.sequence < 1) return false;
  const { rendererSubmittedAt: r0, rendererReceivedAt: r1, rendererPaintedAt: r2 } = payload;
  return Number.isFinite(r0) && r0 >= 0
    && Number.isFinite(r1) && r1 >= r0
    && Number.isFinite(r2) && r2 >= r1;
}

function createProviderPaintAckRegistry({
  onAccepted = () => {},
  onRejected = () => {},
  maxTurns = 512,
  turnTtlMs = 5 * 60_000,
  now = Date.now,
} = {}) {
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1) {
    throw new TypeError('provider paint ACK maxTurns must be a positive integer');
  }
  if (!Number.isFinite(turnTtlMs) || turnTtlMs <= 0) {
    throw new TypeError('provider paint ACK turnTtlMs must be positive');
  }
  if (typeof now !== 'function') throw new TypeError('provider paint ACK now must be a function');
  const turns = new Map();

  function cleanupExpired() {
    const cutoff = now() - turnTtlMs;
    let removed = 0;
    for (const [turnId, turn] of turns) {
      if (turn.registeredAt > cutoff) break;
      turns.delete(turnId);
      removed += 1;
    }
    return removed;
  }

  function enforceBound() {
    cleanupExpired();
    while (turns.size >= maxTurns) {
      const oldestTurnId = turns.keys().next().value;
      if (oldestTurnId === undefined) break;
      turns.delete(oldestTurnId);
    }
  }

  function registerTurn({ clientSubmitId, turnId, runtimeGeneration, origin, expectedWebContentsId }) {
    if (typeof clientSubmitId !== 'string' || !clientSubmitId
      || typeof turnId !== 'string' || !turnId
      || !Number.isSafeInteger(runtimeGeneration) || runtimeGeneration < 1
      || !Number.isSafeInteger(expectedWebContentsId) || expectedWebContentsId < 1
      || !['shell', 'orb'].includes(origin)) {
      throw new TypeError('invalid provider paint turn registration');
    }
    if (turns.has(turnId)) throw new Error('duplicate provider paint turn');
    enforceBound();
    turns.set(turnId, {
      clientSubmitId, turnId, runtimeGeneration, origin, expectedWebContentsId,
      registeredAt: now(),
      firstVisibleSequence: null,
      acked: false,
      invalidReason: null,
    });
  }

  function markFirstVisible(turnId, sequence) {
    const turn = turns.get(turnId);
    if (!turn || turn.acked || turn.invalidReason
      || !Number.isSafeInteger(sequence) || sequence < 1) return false;
    if (turn.firstVisibleSequence !== null) return turn.firstVisibleSequence === sequence;
    turn.firstVisibleSequence = sequence;
    return true;
  }

  function reject(reason, turn, payload) {
    onRejected(Object.freeze({ reason, turnId: turn ? turn.turnId : null, sequence: payload?.sequence || null }));
    return Object.freeze({ accepted: false, reason });
  }

  function invalidate(reason, turn, payload) {
    if (!turn.invalidReason) turn.invalidReason = reason;
    reject(reason, turn, payload);
    return Object.freeze({ accepted: false, reason });
  }

  function accept(senderWebContentsId, payload, currentRuntimeGeneration) {
    const identifiableTurnId = payload && typeof payload === 'object' && !Array.isArray(payload)
      && typeof payload.turnId === 'string' && payload.turnId
      ? payload.turnId
      : null;
    const turn = identifiableTurnId ? turns.get(identifiableTurnId) : null;
    if (turn && turn.invalidReason) {
      reject('terminal-invalid', turn, payload);
      return Object.freeze({
        accepted: false,
        reason: 'terminal-invalid',
        invalidReason: turn.invalidReason,
      });
    }
    if (turn && turn.acked) return reject('duplicate', turn, payload);
    if (!validAckPayload(payload)) {
      return turn ? invalidate('invalid-payload', turn, payload) : reject('invalid-payload', null, payload);
    }
    if (!turn) return reject('unknown-turn', null, payload);
    if (turn.runtimeGeneration !== currentRuntimeGeneration) return invalidate('stale-generation', turn, payload);
    if (turn.expectedWebContentsId !== senderWebContentsId) return invalidate('wrong-renderer', turn, payload);
    if (turn.clientSubmitId !== payload.clientSubmitId) return invalidate('wrong-submit', turn, payload);
    if (turn.firstVisibleSequence === null || turn.firstVisibleSequence !== payload.sequence) {
      return invalidate('wrong-sequence', turn, payload);
    }
    turn.acked = true;
    const accepted = Object.freeze({
      clientSubmitId: turn.clientSubmitId,
      turnId: turn.turnId,
      sequence: payload.sequence,
      origin: turn.origin,
      rendererSubmittedAt: payload.rendererSubmittedAt,
      rendererReceivedAt: payload.rendererReceivedAt,
      rendererPaintedAt: payload.rendererPaintedAt,
    });
    onAccepted(accepted);
    return Object.freeze({ accepted: true, sample: accepted });
  }

  function cleanupTurn(turnId) {
    return turns.delete(turnId);
  }

  return Object.freeze({
    accept,
    cleanupExpired,
    cleanupTurn,
    markFirstVisible,
    registerTurn,
    size: () => turns.size,
  });
}

module.exports = { ACK_KEYS, createProviderPaintAckRegistry, validAckPayload };
