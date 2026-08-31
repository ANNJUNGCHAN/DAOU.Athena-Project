'use strict';

const crypto = require('node:crypto');

const DEFAULT_BASE_URL = 'http://127.0.0.1:8010';
// 실제 conversation extraction은 Claude CLI 한 호출만으로도 최대 180초가 걸릴
// 수 있다. 부팅 화면의 커서/작업명은 이 동안 계속 살아 있으므로 가짜 60초 성공
// 판정을 만들지 않고, 전체 파이프라인에 5분의 명시적 watchdog만 둔다.
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_HTTP_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_FLUSH_LIMIT = 1_000;
const DEFAULT_MAX_FLUSH_ROUNDS = 100;
const ALLOWED_TRIGGERS = new Set(['boot', 'hourly']);
const POLLABLE_JOB_STATUSES = new Set(['pending', 'running', 'retry_wait']);

class ConversationGraphRefreshError extends Error {
  constructor(code, message, { cause, report, status } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ConversationGraphRefreshError';
    this.code = code;
    if (report) this.report = report;
    if (status != null) this.status = status;
  }
}

function fail(code, message, details) {
  throw new ConversationGraphRefreshError(code, message, details);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isNullableString(value) {
  return value === null || typeof value === 'string';
}

function hasStringValues(record) {
  return Object.values(record).every((value) => typeof value === 'string');
}

function computeLabelFingerprint(labels) {
  const canonicalLabels = Object.entries(labels)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([clusterId, label]) => [clusterId, label]);
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalLabels), 'utf8')
    .digest('hex');
}

function createConversationGraphBroadcastKey(report) {
  return Object.freeze({
    graphRevision: report.graph.revision,
    labelFingerprint: report.graph.labelFingerprint,
  });
}

function shouldBroadcastConversationGraph(previousKey, report) {
  const nextKey = createConversationGraphBroadcastKey(report);
  return previousKey === null
    || previousKey.graphRevision !== nextKey.graphRevision
    || previousKey.labelFingerprint !== nextKey.labelFingerprint;
}

function assertStatusShape(body) {
  const validJobStatuses = new Set(['pending', 'running', 'succeeded', 'retry_wait', 'failed']);
  if (!isRecord(body)
    || typeof body.ready !== 'boolean'
    || typeof body.ingestion_ready !== 'boolean'
    || typeof body.extraction_enabled !== 'boolean'
    || !['backend', 'external'].includes(body.ingest_schedule_owner)
    || !isNullableString(body.startup_ingestion_job_id)
    || !(body.startup_ingestion_status === null || validJobStatuses.has(body.startup_ingestion_status))
    || !isNullableString(body.startup_ingestion_detail)) {
    fail('invalid_status_shape', 'brain status response does not match BrainStatusResponse');
  }
  return body;
}

function assertJobShape(body, expectedId = null) {
  const validStatuses = new Set(['pending', 'running', 'succeeded', 'retry_wait', 'failed']);
  if (!isRecord(body)
    || typeof body.id !== 'string' || !body.id
    || body.trigger !== 'manual'
    || !validStatuses.has(body.status)
    || !isNonNegativeInteger(body.attempts)
    || typeof body.created_at !== 'string'
    || !isNullableString(body.started_at)
    || !isNullableString(body.completed_at)
    || !isNullableString(body.next_retry_at)
    || !isNullableString(body.error)) {
    fail('invalid_job_shape', 'ingestion response does not match IngestionJobResponse');
  }
  if (expectedId !== null && body.id !== expectedId) {
    fail('ingestion_job_mismatch', `requested ingestion job ${expectedId} but received ${body.id}`);
  }
  return body;
}

function assertClusterMapShape(body) {
  if (!isRecord(body)
    || !isNonNegativeInteger(body.revision)
    || !Array.isArray(body.nodes)
    || !Array.isArray(body.edges)
    || !isRecord(body.cluster_cohesion)
    || !isRecord(body.cluster_representative_labels)
    || !Array.isArray(body.edge_details)
    || !isRecord(body.cluster_ai_labels)
    || !body.nodes.every((node) => (
      isRecord(node)
      && typeof node.entity_id === 'string'
      && typeof node.name === 'string'
      && typeof node.kind === 'string'
      && Number.isInteger(node.cluster)
      && isNonNegativeInteger(node.degree)
    ))
    || !body.edges.every((edge) => (
      Array.isArray(edge)
      && edge.length === 2
      && edge.every((endpoint) => typeof endpoint === 'string')
    ))
    || !Object.values(body.cluster_cohesion).every((value) => typeof value === 'number' && Number.isFinite(value))
    || !hasStringValues(body.cluster_representative_labels)
    || !hasStringValues(body.cluster_ai_labels)
    || !body.edge_details.every((edge) => (
      isRecord(edge)
      && typeof edge.source === 'string'
      && typeof edge.target === 'string'
      && Array.isArray(edge.kinds)
      && edge.kinds.every((kind) => typeof kind === 'string')
      && typeof edge.tier === 'string'
      && typeof edge.confidence === 'string'
    ))) {
    fail('invalid_cluster_map_shape', 'cluster map response does not match ClusterMapResponse');
  }
  return body;
}

function assertFlushShape(result) {
  if (!isRecord(result)
    || !isNonNegativeInteger(result.pending)
    || !isNonNegativeInteger(result.attempted)
    || !isNonNegativeInteger(result.synced)
    || !isNonNegativeInteger(result.failed)
    || !isNonNegativeInteger(result.remaining)) {
    fail('invalid_flush_shape', 'flushPending result must contain non-negative integer counts');
  }
  return result;
}

function createConversationGraphRefresher({
  baseUrl = DEFAULT_BASE_URL,
  getBearerToken,
  flushPending,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  httpTimeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
  flushLimit = DEFAULT_FLUSH_LIMIT,
  maxFlushRounds = DEFAULT_MAX_FLUSH_ROUNDS,
} = {}) {
  if (typeof getBearerToken !== 'function') throw new TypeError('getBearerToken must be a function');
  if (typeof flushPending !== 'function') throw new TypeError('flushPending must be a function');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (typeof sleep !== 'function') throw new TypeError('sleep must be a function');
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) throw new TypeError('pollIntervalMs must be non-negative');
  if (!Number.isFinite(httpTimeoutMs) || httpTimeoutMs <= 0) throw new TypeError('httpTimeoutMs must be positive');
  if (!Number.isInteger(flushLimit) || flushLimit <= 0) throw new TypeError('flushLimit must be a positive integer');
  if (!Number.isInteger(maxFlushRounds) || maxFlushRounds <= 0) throw new TypeError('maxFlushRounds must be a positive integer');

  const normalizedBaseUrl = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  let refreshInFlight = null;
  let observeInFlight = null;

  function emptyReport(trigger, mode = 'ingest') {
    return {
      trigger,
      mode,
      scheduleOwner: null,
      flushed: 0,
      pending: 0,
      job: { id: null, status: null },
      graph: {
        revision: 0,
        nodes: 0,
        edges: 0,
        clusters: 0,
        labelFingerprint: computeLabelFingerprint({}),
      },
      warmStatus: 'pending',
    };
  }

  async function requestJson(path, { method = 'GET', token, deadline } = {}) {
    const remainingMs = Math.max(1, deadline - now());
    const requestTimeoutMs = Math.min(httpTimeoutMs, remainingMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      let response;
      try {
        response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
      } catch (error) {
        const timedOut = error && (error.name === 'AbortError' || controller.signal.aborted);
        fail(
          timedOut ? 'http_timeout' : 'request_failed',
          timedOut ? `${method} ${path} timed out` : `${method} ${path} failed`,
          { cause: error },
        );
      }
      if (!response || typeof response.ok !== 'boolean' || typeof response.json !== 'function') {
        fail('invalid_http_response', `${method} ${path} returned an invalid response object`);
      }
      if (!response.ok) {
        fail('http_error', `${method} ${path} returned HTTP ${response.status}`, { status: response.status });
      }
      try {
        return await response.json();
      } catch (error) {
        const timedOut = error && (error.name === 'AbortError' || controller.signal.aborted);
        fail(
          timedOut ? 'http_timeout' : 'invalid_json',
          timedOut ? `${method} ${path} timed out` : `${method} ${path} returned invalid JSON`,
          { cause: error },
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async function flushAll(report) {
    let previousRemaining = null;
    let hadPending = false;
    for (let round = 0; round < maxFlushRounds; round += 1) {
      const result = assertFlushShape(await flushPending({ limit: flushLimit }));
      if (round === 0) hadPending = result.pending > 0;
      report.flushed += result.synced;
      report.pending = result.remaining;
      if (result.failed > 0) {
        fail('pending_flush_incomplete', 'one or more pending chat messages failed to flush', { report });
      }
      if (result.remaining === 0) return { hadPending };
      if (result.synced === 0 || (previousRemaining !== null && result.remaining >= previousRemaining)) {
        fail('pending_flush_incomplete', 'pending chat flush made no progress', { report });
      }
      previousRemaining = result.remaining;
    }
    fail('pending_flush_incomplete', 'pending chat flush exceeded its batch limit', { report });
  }

  async function loadGraph(report, { token, deadline }) {
    const graph = assertClusterMapShape(await requestJson('/api/v1/brain/analysis/cluster-map', {
      token, deadline,
    }));
    const clusters = new Set(graph.nodes.map((node) => node.cluster).filter((cluster) => cluster >= 0)).size;
    report.graph = {
      revision: graph.revision,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      clusters,
      labelFingerprint: computeLabelFingerprint(graph.cluster_ai_labels),
    };
    report.warmStatus = graph.nodes.length === 0 && graph.edges.length === 0 ? 'ready_empty' : 'ready';
    return report;
  }

  async function runOnce({ trigger, timeoutMs }) {
    const report = emptyReport(trigger);
    const tokenValue = getBearerToken();
    const token = typeof tokenValue === 'string' ? tokenValue.trim() : '';
    if (!token) fail('auth_unavailable', 'local bearer token is unavailable', { report });
    const deadline = now() + timeoutMs;

    const status = assertStatusShape(await requestJson('/api/v1/brain/status', { token, deadline }));
    report.scheduleOwner = status.ingest_schedule_owner;
    if (!status.ready) fail('brain_not_ready', 'investment brain is not ready', { report });
    if (!status.ingestion_ready) fail('ingestion_not_ready', 'brain ingestion is not ready', { report });
    if (!status.extraction_enabled) fail('extraction_disabled', 'conversation extraction is disabled', { report });
    if (trigger === 'hourly' && status.ingest_schedule_owner === 'backend') {
      // The backend owns ingestion, so this cycle may resend pending raw chat but
      // must never enqueue a second ingestion job. Reading the warmed projection
      // keeps the open renderer current without duplicating the backend scheduler.
      report.mode = 'backend-observe';
      await flushAll(report);
      return loadGraph(report, { token, deadline });
    }

    const { hadPending } = await flushAll(report);
    const enqueued = assertJobShape(await requestJson('/api/v1/brain/ingestion/jobs', {
      method: 'POST', token, deadline,
    }));
    report.job.id = enqueued.id;
    report.job.status = enqueued.status;

    let current;
    while (true) {
      if (now() >= deadline) {
        fail('ingestion_timeout', `ingestion job ${enqueued.id} did not finish before timeout`, { report });
      }
      current = assertJobShape(await requestJson(
        `/api/v1/brain/ingestion/jobs/${encodeURIComponent(enqueued.id)}`,
        { token, deadline },
      ), enqueued.id);
      report.job.status = current.status;
      if (current.status === 'succeeded') break;
      if (current.status === 'failed') {
        fail('ingestion_failed', `ingestion job ${enqueued.id} failed`, { report });
      }
      if (!POLLABLE_JOB_STATUSES.has(current.status)) {
        fail('invalid_job_shape', `ingestion job ${enqueued.id} returned an unknown status`, { report });
      }
      await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
    }

    await loadGraph(report, { token, deadline });

    // The flush contract's synced count is the app-side evidence that pending rows
    // became source records. Combined with the cluster response it covers the
    // source/entity/relation all-zero incomplete-history case without inventing a
    // backend count endpoint that is not present in the FastAPI contract.
    if (hadPending && report.flushed === 0 && report.graph.nodes === 0 && report.graph.edges === 0) {
      report.warmStatus = 'incomplete_history';
      fail('incomplete_history', 'pending conversation history produced no sources, entities, or relations', { report });
    }
    return report;
  }

  async function observeOnce({ timeoutMs }) {
    const report = emptyReport('observer', 'observe');
    const tokenValue = getBearerToken();
    const token = typeof tokenValue === 'string' ? tokenValue.trim() : '';
    if (!token) fail('auth_unavailable', 'local bearer token is unavailable', { report });
    const deadline = now() + timeoutMs;
    const status = assertStatusShape(await requestJson('/api/v1/brain/status', { token, deadline }));
    report.scheduleOwner = status.ingest_schedule_owner;
    if (!status.ready) fail('brain_not_ready', 'investment brain is not ready', { report });
    if (!status.ingestion_ready) fail('ingestion_not_ready', 'brain ingestion is not ready', { report });
    return loadGraph(report, { token, deadline });
  }

  function run({ trigger, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!ALLOWED_TRIGGERS.has(trigger)) {
      return Promise.reject(new ConversationGraphRefreshError(
        'invalid_trigger',
        'trigger must be either boot or hourly',
      ));
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new ConversationGraphRefreshError(
        'invalid_timeout',
        'timeoutMs must be positive',
      ));
    }
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      // An observe-only read may finish first, but it never satisfies a scheduled
      // mutation. Wait for it, then always execute this refresh's own status/flush/job path.
      if (observeInFlight) await observeInFlight.catch(() => {});
      return runOnce({ trigger, timeoutMs });
    })().finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  }

  function observe({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new ConversationGraphRefreshError(
        'invalid_timeout',
        'timeoutMs must be positive',
      ));
    }
    if (refreshInFlight) return refreshInFlight;
    if (observeInFlight) return observeInFlight;
    observeInFlight = observeOnce({ timeoutMs }).finally(() => { observeInFlight = null; });
    return observeInFlight;
  }

  return {
    run,
    observe,
    isRunning: () => refreshInFlight !== null || observeInFlight !== null,
  };
}

module.exports = {
  ConversationGraphRefreshError,
  computeLabelFingerprint,
  createConversationGraphBroadcastKey,
  createConversationGraphRefresher,
  shouldBroadcastConversationGraph,
};
