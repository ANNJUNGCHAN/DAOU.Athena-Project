'use strict';

const MARKET_KIND = Object.freeze({ '0': 'stock', '10': 'stock', '8': 'etf' });
const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_REQUEST_TIMEOUT_MS = 2_700;
const DEFAULT_RECOVERY_RETRY_BASE_MS = 1_000;
const DEFAULT_RECOVERY_RETRY_MAX_MS = 10_000;

class StockMasterClientError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StockMasterClientError';
    this.code = code;
  }
}

async function readJson(response, label) {
  if (!response || response.ok !== true) {
    throw new StockMasterClientError(`${label}_http`, `${label} 요청에 실패했다`);
  }
  try {
    return await response.json();
  } catch {
    throw new StockMasterClientError(`${label}_json`, `${label} 응답이 JSON이 아니다`);
  }
}

function abortError(signal, label) {
  if (signal && signal.reason instanceof Error && signal.reason.name === 'AbortError') return signal.reason;
  const message = signal && signal.reason instanceof Error
    ? signal.reason.message
    : `${label} 요청이 중단됐다`;
  const error = new StockMasterClientError(`${label}_aborted`, message);
  error.name = 'AbortError';
  return error;
}

function supersededError() {
  const error = new StockMasterClientError('stock_master_superseded', '새 질의가 이전 SQLite 종목 검색을 대체했다');
  error.name = 'AbortError';
  return error;
}

async function withRequestDeadline(run, { timeoutMs, signal, label }) {
  if (signal && signal.aborted) throw abortError(signal, label);
  const controller = new AbortController();
  const deadlineMs = Math.max(1, Number(timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS);
  let timer;
  let onAbort;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new StockMasterClientError(`${label}_timeout`, `${label} 요청 제한시간을 초과했다`);
      controller.abort(error);
      reject(error);
    }, deadlineMs);
  });
  const cancellation = new Promise((_, reject) => {
    if (!signal) return;
    onAbort = () => {
      const error = abortError(signal, label);
      controller.abort(error);
      reject(error);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([run(controller.signal), timeout, cancellation]);
  } finally {
    clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}

function normalizeStatus(body) {
  if (!body || typeof body !== 'object' || typeof body.ready !== 'boolean') {
    throw new StockMasterClientError('stock_master_status_shape', '종목 마스터 상태 응답 형식이 올바르지 않다');
  }
  const size = Number(body.size);
  if (!Number.isSafeInteger(size) || size < 0 || body.ready !== (size > 0)) {
    throw new StockMasterClientError('stock_master_status_shape', '종목 마스터 상태와 행 수가 일치하지 않는다');
  }
  const refreshedAt = body.refreshedAt === null ? null : String(body.refreshedAt || '').trim();
  if (body.refreshedAt !== null && !refreshedAt) {
    throw new StockMasterClientError('stock_master_status_shape', '종목 마스터 갱신 시각이 올바르지 않다');
  }
  return Object.freeze({ ready: body.ready, size, refreshedAt });
}

function normalizeResolution(body) {
  if (!body || typeof body !== 'object' || typeof body.ready !== 'boolean') {
    throw new StockMasterClientError('stock_master_resolve_shape', '종목 검색 응답 형식이 올바르지 않다');
  }
  if (body.instrument === null) return Object.freeze({ ready: body.ready, instrument: null });
  const instrument = body.instrument;
  if (!instrument || typeof instrument !== 'object' || Array.isArray(instrument)) {
    throw new StockMasterClientError('stock_master_resolve_shape', '종목 검색 결과 형식이 올바르지 않다');
  }
  const code = String(instrument.code || '').trim();
  const name = String(instrument.name || '').trim();
  const marketCode = String(instrument.marketCode ?? '').trim();
  const kind = String(instrument.kind || '').trim();
  if (!body.ready || !/^\d{6}$/.test(code) || !name || MARKET_KIND[marketCode] !== kind) {
    throw new StockMasterClientError('stock_master_resolve_shape', '종목 검색 결과의 신원 정보가 올바르지 않다');
  }
  return Object.freeze({
    ready: true,
    instrument: Object.freeze({ code, name, marketCode, kind }),
  });
}

async function fetchStockMasterStatus({
  backendBase,
  fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  return withRequestDeadline(async (requestSignal) => {
    const response = await fetchImpl(`${backendBase}/api/v1/instruments/status`, {
      method: 'GET', redirect: 'error', signal: requestSignal,
    });
    return normalizeStatus(await readJson(response, 'stock-master-status'));
  }, { timeoutMs, signal, label: 'stock-master-status' });
}

async function resolveStockMasterQuery(question, {
  backendBase,
  fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  return withRequestDeadline(async (requestSignal) => {
    const response = await fetchImpl(`${backendBase}/api/v1/instruments/resolve`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: String(question || '') }),
      signal: requestSignal,
    });
    return normalizeResolution(await readJson(response, 'stock-master-resolve'));
  }, { timeoutMs, signal, label: 'stock-master-resolve' });
}

async function resolveCurrentStockMasterQuery(question, {
  runtime,
  shutdownSignal,
  ...requestOptions
} = {}) {
  if (!runtime || typeof runtime !== 'object') throw new TypeError('runtime is required');
  if (runtime.activeStockMasterLookup) runtime.activeStockMasterLookup.abort(supersededError());
  const controller = new AbortController();
  runtime.activeStockMasterLookup = controller;
  let onShutdown;
  if (shutdownSignal) {
    onShutdown = () => controller.abort(abortError(shutdownSignal, 'stock-master-resolve'));
    if (shutdownSignal.aborted) onShutdown();
    else shutdownSignal.addEventListener('abort', onShutdown, { once: true });
  }
  try {
    const result = await resolveStockMasterQuery(question, {
      ...requestOptions,
      signal: controller.signal,
    });
    if (runtime.activeStockMasterLookup !== controller || controller.signal.aborted) {
      throw supersededError();
    }
    return result;
  } finally {
    if (shutdownSignal && onShutdown) shutdownSignal.removeEventListener('abort', onShutdown);
    if (runtime.activeStockMasterLookup === controller) runtime.activeStockMasterLookup = null;
  }
}

async function waitForStockMasterReady({
  backendBase,
  fetchImpl = globalThis.fetch,
  timeoutMs,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  signal,
} = {}) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  do {
    if (signal && signal.aborted) return null;
    try {
      const remainingBeforeRequest = Math.max(1, deadline - Date.now());
      const status = await fetchStockMasterStatus({
        backendBase,
        fetchImpl,
        signal,
        timeoutMs: Math.min(DEFAULT_REQUEST_TIMEOUT_MS, remainingBeforeRequest),
      });
      if (status.ready) return status;
    } catch {
      // 백엔드 부팅 직후의 짧은 연결 공백은 같은 제한시간 안에서 다시 확인한다.
    }
    if (signal && signal.aborted) return null;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await wait(Math.min(Math.max(1, pollIntervalMs), remaining));
  } while (Date.now() <= deadline);
  return null;
}

function waitForRecoveryPoll(ms, signal, wait) {
  if (signal && signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = () => finish(false);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(wait(ms)).then(() => finish(true), () => finish(true));
  });
}

async function recoverStockMasterReady({
  backendBase,
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  retryBaseMs = DEFAULT_RECOVERY_RETRY_BASE_MS,
  retryMaxMs = DEFAULT_RECOVERY_RETRY_MAX_MS,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  signal,
  onReady = () => true,
} = {}) {
  if (typeof onReady !== 'function') throw new TypeError('onReady must be a function');
  const baseMs = Math.max(1, Number(retryBaseMs) || DEFAULT_RECOVERY_RETRY_BASE_MS);
  const maxMs = Math.max(baseMs, Number(retryMaxMs) || DEFAULT_RECOVERY_RETRY_MAX_MS);
  let attempt = 0;
  while (!(signal && signal.aborted)) {
    try {
      const status = await fetchStockMasterStatus({
        backendBase,
        fetchImpl,
        signal,
        timeoutMs: requestTimeoutMs,
      });
      if (status.ready && await onReady(status) !== false) return status;
    } catch {
      if (signal && signal.aborted) return null;
    }
    const delayMs = Math.min(maxMs, baseMs * (2 ** Math.min(attempt, 16)));
    attempt += 1;
    if (!await waitForRecoveryPoll(delayMs, signal, wait)) return null;
  }
  return null;
}

function createQueryScopedIndex(IndexClass, resolution) {
  const index = new IndexClass();
  const instrument = resolution && resolution.instrument;
  if (instrument) {
    index.replace([{
      code: instrument.code,
      name: instrument.name,
      market: instrument.marketCode,
    }]);
  }
  return index;
}

module.exports = {
  DEFAULT_REQUEST_TIMEOUT_MS,
  StockMasterClientError,
  createQueryScopedIndex,
  fetchStockMasterStatus,
  recoverStockMasterReady,
  resolveCurrentStockMasterQuery,
  resolveStockMasterQuery,
  waitForStockMasterReady,
};
