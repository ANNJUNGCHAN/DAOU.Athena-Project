'use strict';

const DEFAULT_RETRY_BASE_MS = 250;
const DEFAULT_RETRY_MAX_MS = 5_000;

class StockEntityIndexReadiness {
  constructor({
    index,
    refresh,
    retryBaseMs = DEFAULT_RETRY_BASE_MS,
    retryMaxMs = DEFAULT_RETRY_MAX_MS,
    onError = () => {},
    onReady = () => {},
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  }) {
    if (!index || typeof index.size !== 'number') {
      throw new TypeError('index with a numeric size is required');
    }
    if (typeof refresh !== 'function') throw new TypeError('refresh must be a function');
    if (typeof onError !== 'function') throw new TypeError('onError must be a function');
    if (typeof onReady !== 'function') throw new TypeError('onReady must be a function');

    this._index = index;
    this._refresh = refresh;
    this._retryBaseMs = Math.max(1, Number(retryBaseMs) || DEFAULT_RETRY_BASE_MS);
    this._retryMaxMs = Math.max(this._retryBaseMs, Number(retryMaxMs) || DEFAULT_RETRY_MAX_MS);
    this._onError = onError;
    this._onReady = onReady;
    this._setTimeout = setTimeoutImpl;
    this._clearTimeout = clearTimeoutImpl;
    this._started = false;
    this._retryAttempt = 0;
    this._retryTimer = null;
    this._inFlight = null;
    this._refreshController = null;
    this._waiters = new Set();
  }

  start() {
    if (this._started) return;
    this._started = true;
    void this._ensureRefresh();
  }

  stop() {
    this._started = false;
    if (this._retryTimer !== null) {
      this._clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    this._resolveWaiters(false);
    if (this._refreshController && !this._refreshController.signal.aborted) {
      this._refreshController.abort(new Error('Athena 앱 종료'));
    }
  }

  async ensureReady(timeoutMs) {
    if (this._index.size > 0) return true;

    const deadlineMs = Math.max(0, Number(timeoutMs) || 0);
    if (deadlineMs === 0) {
      void this._ensureRefresh();
      return false;
    }

    return new Promise((resolve) => {
      let settled = false;
      let deadlineTimer = null;
      const waiter = {
        finish: (ready) => {
          if (settled) return;
          settled = true;
          this._waiters.delete(waiter);
          if (deadlineTimer !== null) this._clearTimeout(deadlineTimer);
          if (!this._started && this._waiters.size === 0 && this._retryTimer !== null) {
            this._clearTimeout(this._retryTimer);
            this._retryTimer = null;
          }
          resolve(ready);
        },
      };
      this._waiters.add(waiter);
      deadlineTimer = this._setTimeout(() => waiter.finish(false), deadlineMs);
      void this._ensureRefresh();
    });
  }

  _ensureRefresh() {
    if (this._index.size > 0) return Promise.resolve(true);
    if (this._inFlight) return this._inFlight;
    if (this._retryTimer !== null) {
      this._clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }

    const controller = new AbortController();
    this._refreshController = controller;
    const inFlight = Promise.resolve()
      .then(() => this._refresh(this._index, { signal: controller.signal }))
      .then(() => this._index.size > 0 && !controller.signal.aborted)
      .catch((error) => {
        if (!(controller.signal.aborted && !this._started)) this._onError(error);
        return false;
      })
      .then((ready) => {
        if (ready) {
          this._retryAttempt = 0;
          if (this._started) {
            try {
              this._onReady({ size: this._index.size });
            } catch (error) {
              try {
                this._onError(error);
              } catch {
                // 성공한 refresh와 waiter 해제는 observer 오류와 분리한다.
              }
            }
          }
          this._resolveWaiters(true);
        } else {
          this._scheduleRetry();
        }
        return ready;
      })
      .finally(() => {
        if (this._inFlight === inFlight) this._inFlight = null;
        if (this._refreshController === controller) this._refreshController = null;
      });
    this._inFlight = inFlight;
    return inFlight;
  }

  _scheduleRetry() {
    if ((!this._started && this._waiters.size === 0) || this._index.size > 0 || this._retryTimer !== null) return;
    const delayMs = Math.min(
      this._retryMaxMs,
      this._retryBaseMs * (2 ** this._retryAttempt),
    );
    this._retryAttempt += 1;
    this._retryTimer = this._setTimeout(() => {
      this._retryTimer = null;
      if ((this._started || this._waiters.size > 0) && this._index.size === 0) void this._ensureRefresh();
    }, delayMs);
  }

  _resolveWaiters(ready) {
    for (const waiter of [...this._waiters]) waiter.finish(ready);
  }
}

function reconcileStockIndexStartupTask(startupReadiness, size) {
  if (!startupReadiness || typeof startupReadiness.snapshot !== 'function'
      || typeof startupReadiness.update !== 'function') {
    throw new TypeError('startupReadiness with snapshot and update is required');
  }
  if (!Number.isInteger(size) || size <= 0) return false;
  const task = startupReadiness.snapshot().tasks
    .find((candidate) => candidate.id === 'stock-index');
  if (!task || task.state !== 'failed') return false;
  startupReadiness.update('stock-index', {
    state: 'succeeded',
    detail: `종목 ${size}개 적재 완료`,
  });
  return true;
}

function createStockEntityIndexReadiness(options) {
  return new StockEntityIndexReadiness(options);
}

module.exports = {
  DEFAULT_RETRY_BASE_MS,
  DEFAULT_RETRY_MAX_MS,
  StockEntityIndexReadiness,
  createStockEntityIndexReadiness,
  reconcileStockIndexStartupTask,
};
