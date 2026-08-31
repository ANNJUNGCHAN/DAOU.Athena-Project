'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AsyncInputQueue } = require('./async-input-queue');

test('delivers directly to a waiting consumer without occupying bounded capacity', async () => {
  const queue = new AsyncInputQueue({ maxPending: 1 });
  const pending = queue.next();
  queue.push('first');
  assert.deepEqual(await pending, { value: 'first', done: false });
  assert.equal(queue.snapshot().pendingValues, 0);
});

test('rejects a producer when pending capacity is full', () => {
  const queue = new AsyncInputQueue({ maxPending: 1 });
  queue.push('first');
  assert.throws(() => queue.push('second'), /full/);
  assert.deepEqual(queue.snapshot(), { closed: false, pendingValues: 1, waitingConsumers: 0, maxPending: 1 });
});

test('normal close drains queued values and then ends iteration', async () => {
  const queue = new AsyncInputQueue({ maxPending: 2 });
  queue.push('first');
  queue.close();
  assert.deepEqual(await queue.next(), { value: 'first', done: false });
  assert.deepEqual(await queue.next(), { value: undefined, done: true });
  assert.throws(() => queue.push('late'), /closed/);
});

test('error close rejects waiting and future consumers', async () => {
  const queue = new AsyncInputQueue({ maxPending: 1 });
  const pending = queue.next();
  queue.close(new Error('boom'));
  await assert.rejects(pending, /boom/);
  await assert.rejects(queue.next(), /boom/);
});

test('error close discards queued values instead of delivering stale input', async () => {
  const queue = new AsyncInputQueue({ maxPending: 1 });
  queue.push('stale');
  queue.close(new Error('fenced'));
  await assert.rejects(queue.next(), /fenced/);
  assert.equal(queue.snapshot().pendingValues, 0);
});

test('validates maxPending and implements AsyncIterable', () => {
  assert.throws(() => new AsyncInputQueue({ maxPending: 0 }), /positive integer/);
  const queue = new AsyncInputQueue();
  assert.equal(queue[Symbol.asyncIterator](), queue);
});
