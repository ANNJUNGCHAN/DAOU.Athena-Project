'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createProviderPaintAckRegistry, validAckPayload } = require('./provider-paint-ack');

const payload = Object.freeze({
  clientSubmitId: 'client',
  turnId: 'turn',
  sequence: 2,
  rendererSubmittedAt: 1,
  rendererReceivedAt: 2,
  rendererPaintedAt: 3,
});

function registry(events = []) {
  const value = createProviderPaintAckRegistry({
    onAccepted: (event) => events.push(['accepted', event]),
    onRejected: (event) => events.push(['rejected', event]),
  });
  value.registerTurn({
    clientSubmitId: 'client', turnId: 'turn', runtimeGeneration: 4,
    origin: 'shell', expectedWebContentsId: 11,
  });
  value.markFirstVisible('turn', 2);
  return value;
}

test('only exact sender, generation, submit, turn, and first visible sequence can ACK', () => {
  const events = [];
  assert.equal(registry(events).accept(12, payload, 4).reason, 'wrong-renderer');
  assert.equal(registry(events).accept(11, payload, 5).reason, 'stale-generation');
  assert.equal(registry(events).accept(11, { ...payload, clientSubmitId: 'other' }, 4).reason, 'wrong-submit');
  assert.equal(registry(events).accept(11, { ...payload, sequence: 3 }, 4).reason, 'wrong-sequence');
  const value = registry(events);
  const accepted = value.accept(11, payload, 4);
  assert.equal(accepted.accepted, true);
  assert.equal(value.accept(11, payload, 4).reason, 'duplicate');
  assert.equal(value.accept(11, { ...payload, rendererPaintedAt: 0 }, 4).reason, 'duplicate');
  assert.equal(events.filter(([kind]) => kind === 'accepted').length, 1);
});

test('an identifiable invalid ACK tombstones the turn and rejects a later valid ACK', () => {
  for (const [reason, sender, candidate, generation] of [
    ['wrong-renderer', 12, payload, 4],
    ['stale-generation', 11, payload, 5],
    ['wrong-submit', 11, { ...payload, clientSubmitId: 'other' }, 4],
    ['wrong-sequence', 11, { ...payload, sequence: 3 }, 4],
    ['invalid-payload', 11, { ...payload, rendererPaintedAt: 0 }, 4],
  ]) {
    const value = registry();
    assert.equal(value.accept(sender, candidate, generation).reason, reason);
    assert.deepEqual(value.accept(11, payload, 4), {
      accepted: false,
      reason: 'terminal-invalid',
      invalidReason: reason,
    });
    assert.equal(value.markFirstVisible('turn', 2), false);
  }
});

test('terminal invalid tombstones remain subject to TTL and max-turn cleanup', () => {
  let now = 100;
  const value = createProviderPaintAckRegistry({ maxTurns: 1, turnTtlMs: 10, now: () => now });
  value.registerTurn({
    clientSubmitId: 'client', turnId: 'turn-1', runtimeGeneration: 1,
    origin: 'shell', expectedWebContentsId: 1,
  });
  value.markFirstVisible('turn-1', 1);
  assert.equal(value.accept(2, { ...payload, turnId: 'turn-1', sequence: 1 }, 1).reason, 'wrong-renderer');
  value.registerTurn({
    clientSubmitId: 'client-2', turnId: 'turn-2', runtimeGeneration: 1,
    origin: 'shell', expectedWebContentsId: 1,
  });
  assert.equal(value.size(), 1);
  now = 111;
  assert.equal(value.cleanupExpired(), 1);
});

test('payload validator rejects extra keys and cross-clock inversions', () => {
  assert.equal(validAckPayload(payload), true);
  assert.equal(validAckPayload({ ...payload, runtimeGeneration: 4 }), false);
  assert.equal(validAckPayload({ ...payload, rendererPaintedAt: 0 }), false);
  assert.equal(validAckPayload({ ...payload, sequence: 0 }), false);
});

test('first visible event uses compare-and-set and cleanup is bounded', () => {
  const value = createProviderPaintAckRegistry();
  value.registerTurn({
    clientSubmitId: 'client', turnId: 'turn', runtimeGeneration: 1,
    origin: 'orb', expectedWebContentsId: 3,
  });
  assert.equal(value.markFirstVisible('turn', 7), true);
  assert.equal(value.markFirstVisible('turn', 8), false);
  assert.equal(value.size(), 1);
  assert.equal(value.cleanupTurn('turn'), true);
  assert.equal(value.size(), 0);
});

test('registry evicts oldest and expired turns without timers or unbounded growth', () => {
  let now = 100;
  const value = createProviderPaintAckRegistry({ maxTurns: 2, turnTtlMs: 10, now: () => now });
  const register = (turnId) => value.registerTurn({
    clientSubmitId: `client-${turnId}`,
    turnId,
    runtimeGeneration: 1,
    origin: 'shell',
    expectedWebContentsId: 1,
  });

  register('turn-1');
  now = 101;
  register('turn-2');
  now = 102;
  register('turn-3');
  assert.equal(value.size(), 2);
  assert.equal(value.markFirstVisible('turn-1', 1), false);
  assert.equal(value.markFirstVisible('turn-2', 1), true);

  now = 113;
  assert.equal(value.cleanupExpired(), 2);
  assert.equal(value.size(), 0);
});

test('bounded cleanup options fail closed on invalid configuration', () => {
  assert.throws(() => createProviderPaintAckRegistry({ maxTurns: 0 }), /maxTurns/);
  assert.throws(() => createProviderPaintAckRegistry({ turnTtlMs: 0 }), /turnTtlMs/);
  assert.throws(() => createProviderPaintAckRegistry({ now: null }), /now/);
});
