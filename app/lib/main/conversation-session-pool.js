'use strict';

const DEFAULT_DESIRED_SIZE = 2;
const DEFAULT_RETRY_DELAY_MS = 1_000;

function normalizeWarmOptions(value) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('warmOptions는 객체여야 한다');
  }
  return { ...value };
}

function sameOptions(left, right) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key)
    && Object.is(left[key], right[key]));
}

function validateSession(session) {
  if (!session || typeof session !== 'object'
    || typeof session.warm !== 'function'
    || typeof session.run !== 'function'
    || typeof session.stop !== 'function') {
    throw new TypeError('createSession은 warm/run/stop 메서드가 있는 세션을 반환해야 한다');
  }
  return session;
}

class ConversationSessionPool {
  constructor({
    createSession,
    warmOptions = {},
    desiredSize = DEFAULT_DESIRED_SIZE,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    onError = null,
  } = {}) {
    if (typeof createSession !== 'function') throw new TypeError('createSession 함수가 필요하다');
    if (!Number.isInteger(desiredSize) || desiredSize < 0) {
      throw new TypeError('desiredSize는 0 이상의 정수여야 한다');
    }
    if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
      throw new TypeError('retryDelayMs는 0 이상의 유한한 수여야 한다');
    }
    if (onError !== null && typeof onError !== 'function') {
      throw new TypeError('onError는 함수여야 한다');
    }

    this._createSession = createSession;
    this._warmOptions = normalizeWarmOptions(warmOptions);
    this._desiredSize = desiredSize;
    this._retryDelayMs = Math.max(1, retryDelayMs);
    this._onError = onError;
    this._started = false;
    this._generation = 1;
    this._owned = new Set();
    this._retryTimer = null;
    this._refillScheduled = false;
    this._blockedGeneration = null;
    this._pendingTerminations = new Set();
  }

  start() {
    if (this._started) return this.snapshot();
    this._started = true;
    this._fill();
    return this.snapshot();
  }

  configure(warmOptions = {}) {
    const next = normalizeWarmOptions(warmOptions);
    if (sameOptions(next, this._warmOptions)) return this.snapshot();

    this._warmOptions = next;
    this._generation += 1;
    this._blockedGeneration = null;
    this._clearRetry();
    this._disposeOwned(new Error('conversation session pool configuration changed'));
    if (this._started) this._fill();
    return this.snapshot();
  }

  claim() {
    if (!this._started || this._owned.size === 0) return null;
    for (const entry of [...this._owned]) this._refreshReadiness(entry);
    const entries = [...this._owned];
    if (entries.length === 0) return null;
    const entry = entries.find((candidate) => candidate.state === 'ready') || entries[0];
    this._owned.delete(entry);
    entry.owned = false;
    this._scheduleRefill();
    return entry.session;
  }

  stop(reason = null) {
    this._started = false;
    this._clearRetry();
    this._refillScheduled = false;
    this._disposeOwned(reason || new Error('conversation session pool stopped'));
    return this.snapshot();
  }

  snapshot() {
    for (const entry of [...this._owned]) this._refreshReadiness(entry);
    const entries = [...this._owned];
    return {
      started: this._started,
      desiredSize: this._desiredSize,
      generation: this._generation,
      warmOptions: { ...this._warmOptions },
      owned: entries.length,
      warming: entries.filter((entry) => entry.state === 'warming').length,
      ready: entries.filter((entry) => entry.state === 'ready').length,
      retryScheduled: this._retryTimer !== null,
    };
  }

  async drain() {
    const results = [];
    while (this._pendingTerminations.size > 0) {
      const batch = [...this._pendingTerminations];
      for (const pending of batch) this._pendingTerminations.delete(pending);
      results.push(...await Promise.allSettled(batch));
    }
    return results;
  }

  _fill() {
    if (!this._started || this._blockedGeneration === this._generation) return;
    const missing = Math.max(0, this._desiredSize - this._owned.size);
    let failed = false;

    // 시도 횟수를 시작 시점의 부족분으로 고정한다. 동기 생성/예열 실패가 반복돼도
    // 같은 호출 스택에서 무한 재시도하지 않는다.
    for (let index = 0; index < missing; index += 1) {
      try {
        const session = validateSession(this._createSession());
        const entry = {
          session,
          generation: this._generation,
          state: 'warming',
          owned: true,
        };
        this._owned.add(entry);
        this._warm(entry);
      } catch (error) {
        failed = true;
        this._report(error, { phase: 'create', generation: this._generation });
        if (error && error.retryable === false) {
          this._blockRetry(this._generation);
          break;
        }
      }
    }

    if (failed) this._scheduleRetry();
  }

  _warm(entry) {
    let result;
    try {
      result = entry.session.warm({ ...this._warmOptions });
    } catch (error) {
      this._handleWarmFailure(entry, error);
      return;
    }

    if (!result || typeof result.then !== 'function') {
      this._refreshReadiness(entry, result, true);
      return;
    }

    Promise.resolve(result).then(
      (snapshot) => this._refreshReadiness(entry, snapshot, true),
      (error) => this._handleWarmFailure(entry, error),
    );
  }

  _refreshReadiness(entry, warmResult = null, completed = false) {
    if (!this._ownsCurrent(entry)) return;
    let snapshot = warmResult;
    if (typeof entry.session.snapshot === 'function') {
      try { snapshot = entry.session.snapshot(); } catch { /* warm result remains usable */ }
    }
    if (snapshot && typeof snapshot === 'object') {
      const terminal = snapshot.stopped === true
        || snapshot.state === 'failed'
        || snapshot.state === 'stopped'
        || (snapshot.state === 'down' && entry.state === 'ready');
      if (terminal) {
        this._handleWarmFailure(entry, new Error('예열된 대화 세션이 종료됐다'));
        return;
      }
      if (snapshot.warm === false) {
        entry.state = 'warming';
        return;
      }
      if (snapshot.warm === true || snapshot.state === 'ready' || snapshot.state === 'idle') {
        entry.state = 'ready';
        return;
      }
      if (snapshot.state === 'starting' || snapshot.state === 'warming'
        || snapshot.state === 'initializing' || snapshot.state === 'down') {
        entry.state = 'warming';
        return;
      }
    }
    if (completed) entry.state = 'ready';
  }

  _handleWarmFailure(entry, error) {
    // claim()으로 넘긴 세션은 더 이상 풀 소유가 아니다. adapter가 warm/run 직렬화
    // 결과를 대화 런타임에 전달하며, 풀은 종료나 교체를 시도하지 않는다.
    if (!this._ownsCurrent(entry)) return;
    this._owned.delete(entry);
    entry.owned = false;
    this._stopSession(entry.session, error);
    this._report(error, { phase: 'warm', generation: entry.generation });
    if (error && error.retryable === false) {
      this._blockRetry(entry.generation);
      return;
    }
    this._scheduleRetry();
  }

  _ownsCurrent(entry) {
    return entry.owned
      && entry.generation === this._generation
      && this._owned.has(entry)
      && this._started;
  }

  _scheduleRefill() {
    if (this._refillScheduled || !this._started) return;
    this._refillScheduled = true;
    queueMicrotask(() => {
      if (!this._refillScheduled) return;
      this._refillScheduled = false;
      this._fill();
    });
  }

  _scheduleRetry() {
    if (!this._started || this._retryTimer !== null
      || this._blockedGeneration === this._generation) return;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this._fill();
    }, this._retryDelayMs);
    if (typeof this._retryTimer.unref === 'function') this._retryTimer.unref();
  }

  _clearRetry() {
    if (this._retryTimer === null) return;
    clearTimeout(this._retryTimer);
    this._retryTimer = null;
  }

  _blockRetry(generation) {
    if (generation !== this._generation) return;
    this._blockedGeneration = generation;
    this._clearRetry();
  }

  _disposeOwned(reason) {
    for (const entry of [...this._owned]) {
      this._owned.delete(entry);
      entry.owned = false;
      this._stopSession(entry.session, reason);
    }
  }

  _stopSession(session, reason) {
    let result;
    try {
      result = session.stop(reason);
    } catch (error) {
      result = Promise.reject(error);
    }
    if (result && typeof result.then === 'function') {
      const pending = Promise.resolve(result);
      this._pendingTerminations.add(pending);
      pending.catch(() => {});
    }
  }

  _report(error, context) {
    if (!this._onError) return;
    try { this._onError(error, context); } catch { /* observer failure is isolated */ }
  }
}

function createConversationSessionPool(options) {
  return new ConversationSessionPool(options);
}

module.exports = {
  ConversationSessionPool,
  createConversationSessionPool,
  DEFAULT_DESIRED_SIZE,
  DEFAULT_RETRY_DELAY_MS,
};
