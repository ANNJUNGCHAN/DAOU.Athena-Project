'use strict';

class AsyncInputQueue {
  constructor({ maxPending = 1 } = {}) {
    if (!Number.isInteger(maxPending) || maxPending < 1) {
      throw new TypeError('maxPending must be a positive integer');
    }
    this._maxPending = maxPending;
    this._values = [];
    this._waiters = [];
    this._closed = false;
    this._error = null;
  }

  push(value) {
    if (this._closed) throw this._error || new Error('Async input queue is closed');
    const waiter = this._waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else {
      if (this._values.length >= this._maxPending) throw new Error('Async input queue is full');
      this._values.push(value);
    }
  }

  close(error = null) {
    if (this._closed) return;
    this._closed = true;
    this._error = error;
    if (error) this._values.length = 0;
    for (const waiter of this._waiters.splice(0)) {
      if (error) waiter.reject(error);
      else waiter.resolve({ value: undefined, done: true });
    }
  }

  next() {
    if (this._values.length) return Promise.resolve({ value: this._values.shift(), done: false });
    if (this._closed) {
      return this._error
        ? Promise.reject(this._error)
        : Promise.resolve({ value: undefined, done: true });
    }
    return new Promise((resolve, reject) => this._waiters.push({ resolve, reject }));
  }

  snapshot() {
    return Object.freeze({
      closed: this._closed,
      pendingValues: this._values.length,
      waitingConsumers: this._waiters.length,
      maxPending: this._maxPending,
    });
  }

  [Symbol.asyncIterator]() { return this; }
}

module.exports = { AsyncInputQueue };
