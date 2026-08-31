'use strict';

const crypto = require('node:crypto');

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 256;
const RETRY_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function datasetLineageId(dataset) {
  const items = Array.isArray(dataset && dataset.items) ? dataset.items : [];
  const identity = items.map((item) => ({
    operationRef: item.operationRef || item.operation_ref,
    args: stableValue(item.args || {}),
  }));
  return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

class RestRetryRegistry {
  constructor({
    clock = Date.now,
    randomBytes = crypto.randomBytes,
    ttlMs = DEFAULT_TTL_MS,
    maxEntries = DEFAULT_MAX_ENTRIES,
    isQueryOnlyDataset,
  } = {}) {
    if (typeof isQueryOnlyDataset !== 'function') throw new TypeError('isQueryOnlyDataset이 필요하다');
    this.clock = clock;
    this.randomBytes = randomBytes;
    this.ttlMs = ttlMs;
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError('maxEntries는 1 이상의 정수여야 한다');
    this.maxEntries = maxEntries;
    this.isQueryOnlyDataset = isQueryOnlyDataset;
    this.entries = new Map();
    this.latestViewGeneration = new Map();
  }

  beginView({ dataset, accountId = '' }) {
    if (!this.isQueryOnlyDataset(dataset)) throw new Error('조회 전용 데이터셋만 재시도 계보를 만들 수 있다');
    const lineageId = datasetLineageId(dataset);
    const key = `${String(accountId)}:${lineageId}`;
    const now = this.clock();
    for (const [retryId, entry] of this.entries) {
      if (entry.expiresAt <= now || `${entry.accountId}:${entry.lineageId}` === key) {
        this.entries.delete(retryId);
      }
    }
    const viewGeneration = (this.latestViewGeneration.get(key) || 0) + 1;
    this.latestViewGeneration.set(key, viewGeneration);
    return { lineageId, viewGeneration };
  }

  issue({ retryAction, senderId, conversationId, accountId = '', lineageId, viewGeneration }) {
    const dataset = retryAction && retryAction.dataset;
    if (!retryAction || retryAction.type !== 'retry-rest-dataset'
      || retryAction.verifiedQueryOnly !== true
      || !this.isQueryOnlyDataset(dataset)) return null;
    if (!Number.isInteger(senderId) || senderId < 1 || !conversationId || !lineageId
      || !Number.isInteger(viewGeneration) || viewGeneration < 1) return null;
    const key = `${String(accountId)}:${lineageId}`;
    if (this.latestViewGeneration.get(key) !== viewGeneration) return null;
    if (datasetLineageId(dataset) !== lineageId) return null;

    const now = this.clock();
    for (const [existingId, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(existingId);
    }
    while (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
    const retryId = this.randomBytes(32).toString('base64url');
    if (!RETRY_ID_PATTERN.test(retryId)) throw new Error('retryId 생성기가 32-byte base64url capability를 만들지 않았다');
    this.entries.set(retryId, {
      dataset: clone(dataset),
      senderId,
      conversationId: String(conversationId),
      accountId: String(accountId),
      lineageId,
      viewGeneration,
      expiresAt: now + this.ttlMs,
    });
    return retryId;
  }

  consume({ retryId, senderId, conversationId, accountId = '' }) {
    if (typeof retryId !== 'string' || retryId.length !== 43 || !RETRY_ID_PATTERN.test(retryId)) return null;
    const id = retryId;
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (entry.expiresAt <= this.clock()) {
      this.entries.delete(id);
      return null;
    }
    const key = `${String(accountId)}:${entry.lineageId}`;
    if (entry.senderId !== senderId
      || entry.conversationId !== String(conversationId || '')
      || entry.accountId !== String(accountId)
      || this.latestViewGeneration.get(key) !== entry.viewGeneration
      || datasetLineageId(entry.dataset) !== entry.lineageId
      || !this.isQueryOnlyDataset(entry.dataset)) return null;

    // JS main 프로세스의 단일 이벤트 루프에서 검증 직후 먼저 제거한다. 이후 실행이
    // await에 들어가기 전에 one-shot 소유권이 끝나므로 double-click/replay가 닫힌다.
    this.entries.delete(id);
    return {
      dataset: clone(entry.dataset),
      lineageId: entry.lineageId,
      viewGeneration: entry.viewGeneration,
    };
  }
}

module.exports = {
  DEFAULT_TTL_MS,
  DEFAULT_MAX_ENTRIES,
  RETRY_ID_PATTERN,
  RestRetryRegistry,
  datasetLineageId,
};
