'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ConversationGraphRefreshError,
  computeLabelFingerprint,
  createConversationGraphBroadcastKey,
  createConversationGraphRefresher,
  shouldBroadcastConversationGraph,
} = require('./conversation-graph-refresh');

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function readyStatus(overrides = {}) {
  return {
    ready: true,
    ingestion_ready: true,
    extraction_enabled: true,
    ingest_schedule_owner: 'external',
    startup_ingestion_job_id: 'startup-1',
    startup_ingestion_status: 'succeeded',
    startup_ingestion_detail: null,
    ...overrides,
  };
}

function job(status, overrides = {}) {
  return {
    id: 'job-1',
    trigger: 'manual',
    status,
    attempts: 1,
    created_at: '2026-08-31T00:00:00Z',
    started_at: status === 'pending' ? null : '2026-08-31T00:00:01Z',
    completed_at: status === 'succeeded' || status === 'failed' ? '2026-08-31T00:00:02Z' : null,
    next_retry_at: status === 'retry_wait' ? '2026-08-31T00:00:03Z' : null,
    error: status === 'failed' ? 'ingestion_failed' : null,
    ...overrides,
  };
}

function clusterMap(overrides = {}) {
  return {
    revision: 7,
    nodes: [
      { entity_id: 'stock:005930', name: '삼성전자', kind: 'stock', cluster: 0, degree: 1 },
      { entity_id: 'theme:semiconductor', name: '반도체', kind: 'theme', cluster: 0, degree: 1 },
    ],
    edges: [['stock:005930', 'theme:semiconductor']],
    cluster_cohesion: { 0: 0.8 },
    cluster_representative_labels: { 0: '반도체' },
    edge_details: [{
      source: 'stock:005930', target: 'theme:semiconductor', kinds: ['interested_in'], tier: 'chat', confidence: '0.9',
    }],
    cluster_ai_labels: {},
    ...overrides,
  };
}

function createFetchScript(steps, seen) {
  return async (url, init = {}) => {
    seen.push({ url, init });
    const step = steps.shift();
    assert.ok(step, `unexpected request ${init.method || 'GET'} ${url}`);
    assert.match(url, step.path);
    assert.equal(init.method || 'GET', step.method || 'GET');
    return jsonResponse(step.body, { status: step.status });
  };
}

test('boot refresh flushes every pending batch, polls retry_wait, warms clusters, and reports exact graph shape', async () => {
  const seen = [];
  const flushes = [
    { pending: 3, attempted: 2, synced: 2, failed: 0, remaining: 1 },
    { pending: 1, attempted: 1, synced: 1, failed: 0, remaining: 0 },
  ];
  const refresher = createConversationGraphRefresher({
    baseUrl: 'http://127.0.0.1:9123/',
    getBearerToken: () => 'local-token',
    flushPending: async () => flushes.shift(),
    fetchImpl: createFetchScript([
      { path: /\/api\/v1\/brain\/status$/, body: readyStatus() },
      { path: /\/api\/v1\/brain\/ingestion\/jobs$/, method: 'POST', body: job('pending') },
      { path: /\/api\/v1\/brain\/ingestion\/jobs\/job-1$/, body: job('retry_wait') },
      { path: /\/api\/v1\/brain\/ingestion\/jobs\/job-1$/, body: job('running', { attempts: 2 }) },
      { path: /\/api\/v1\/brain\/ingestion\/jobs\/job-1$/, body: job('succeeded', { attempts: 2 }) },
      { path: /\/api\/v1\/brain\/analysis\/cluster-map$/, body: clusterMap() },
    ], seen),
    sleep: async () => {},
    now: (() => { let value = 0; return () => value += 10; })(),
    pollIntervalMs: 1,
  });

  const report = await refresher.run({ trigger: 'boot', timeoutMs: 5_000 });

  assert.deepEqual(report, {
    trigger: 'boot',
    mode: 'ingest',
    scheduleOwner: 'external',
    flushed: 3,
    pending: 0,
    job: { id: 'job-1', status: 'succeeded' },
    graph: {
      revision: 7,
      nodes: 2,
      edges: 1,
      clusters: 1,
      labelFingerprint: computeLabelFingerprint({}),
    },
    warmStatus: 'ready',
  });
  assert.deepEqual(seen.map(({ url, init }) => [init.method || 'GET', new URL(url).pathname]), [
    ['GET', '/api/v1/brain/status'],
    ['POST', '/api/v1/brain/ingestion/jobs'],
    ['GET', '/api/v1/brain/ingestion/jobs/job-1'],
    ['GET', '/api/v1/brain/ingestion/jobs/job-1'],
    ['GET', '/api/v1/brain/ingestion/jobs/job-1'],
    ['GET', '/api/v1/brain/analysis/cluster-map'],
  ]);
  for (const { init } of seen) assert.equal(init.headers.Authorization, 'Bearer local-token');
});

test('empty new profile is a successful ready_empty warm state', async () => {
  const seen = [];
  const refresher = createConversationGraphRefresher({
    getBearerToken: () => 'token',
    flushPending: async () => ({ pending: 0, attempted: 0, synced: 0, failed: 0, remaining: 0 }),
    fetchImpl: createFetchScript([
      { path: /\/status$/, body: readyStatus() },
      { path: /\/ingestion\/jobs$/, method: 'POST', body: job('succeeded') },
      { path: /\/ingestion\/jobs\/job-1$/, body: job('succeeded') },
      { path: /\/analysis\/cluster-map$/, body: clusterMap({ revision: 0, nodes: [], edges: [], cluster_cohesion: {}, cluster_representative_labels: {}, edge_details: [] }) },
    ], seen),
  });

  const report = await refresher.run({ trigger: 'hourly' });
  assert.equal(report.trigger, 'hourly');
  assert.equal(report.scheduleOwner, 'external');
  assert.equal(report.warmStatus, 'ready_empty');
  assert.deepEqual(report.graph, {
    revision: 0,
    nodes: 0,
    edges: 0,
    clusters: 0,
    labelFingerprint: computeLabelFingerprint({}),
  });
});

test('same graph revision broadcasts when opaque label fingerprint changes, then dedupes identical labels', () => {
  const emptyLabels = {
    graph: { revision: 7, labelFingerprint: computeLabelFingerprint({}) },
  };
  const labeled = {
    graph: {
      revision: 7,
      labelFingerprint: computeLabelFingerprint({ 1: '배당 방어', 0: '반도체 밸류체인' }),
    },
  };
  const sameLabelsDifferentOrder = {
    graph: {
      revision: 7,
      labelFingerprint: computeLabelFingerprint({ 0: '반도체 밸류체인', 1: '배당 방어' }),
    },
  };

  assert.equal(shouldBroadcastConversationGraph(null, emptyLabels), true);
  const emptyKey = createConversationGraphBroadcastKey(emptyLabels);
  assert.equal(shouldBroadcastConversationGraph(emptyKey, labeled), true);
  const labeledKey = createConversationGraphBroadcastKey(labeled);
  assert.equal(shouldBroadcastConversationGraph(labeledKey, sameLabelsDifferentOrder), false);
  assert.notEqual(emptyKey.labelFingerprint, labeledKey.labelFingerprint);
  assert.match(labeledKey.labelFingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(labeledKey.labelFingerprint, /반도체|배당/);
});

test('backend-owned hourly cycle flushes raw chat and observes the graph without an ingestion POST', async () => {
  let flushed = false;
  const seen = [];
  const refresher = createConversationGraphRefresher({
    getBearerToken: () => 'token',
    flushPending: async () => {
      flushed = true;
      return { pending: 1, attempted: 1, synced: 1, failed: 0, remaining: 0 };
    },
    fetchImpl: createFetchScript([
      { path: /\/status$/, body: readyStatus({ ingest_schedule_owner: 'backend' }) },
      { path: /\/analysis\/cluster-map$/, body: clusterMap() },
    ], seen),
  });

  const report = await refresher.run({ trigger: 'hourly' });
  assert.equal(flushed, true);
  assert.equal(report.mode, 'backend-observe');
  assert.equal(report.scheduleOwner, 'backend');
  assert.equal(report.flushed, 1);
  assert.equal(report.job.id, null);
  assert.deepEqual(seen.map(({ url, init }) => [init.method || 'GET', new URL(url).pathname]), [
    ['GET', '/api/v1/brain/status'],
    ['GET', '/api/v1/brain/analysis/cluster-map'],
  ]);
});

test('boot refresh may run against a backend-owned scheduler and reports the owner', async () => {
  const refresher = createConversationGraphRefresher({
    getBearerToken: () => 'token',
    flushPending: async () => ({ pending: 0, attempted: 0, synced: 0, failed: 0, remaining: 0 }),
    fetchImpl: createFetchScript([
      { path: /\/status$/, body: readyStatus({ ingest_schedule_owner: 'backend' }) },
      { path: /\/ingestion\/jobs$/, method: 'POST', body: job('succeeded') },
      { path: /\/ingestion\/jobs\/job-1$/, body: job('succeeded') },
      { path: /\/analysis\/cluster-map$/, body: clusterMap() },
    ], []),
  });

  const report = await refresher.run({ trigger: 'boot' });
  assert.equal(report.mode, 'ingest');
  assert.equal(report.scheduleOwner, 'backend');
  assert.equal(report.warmStatus, 'ready');
});

test('observe is read-only and a following external hourly refresh still enqueues its own job', async () => {
  const seen = [];
  let releaseObservation;
  const observationGate = new Promise((resolve) => { releaseObservation = resolve; });
  let statusCalls = 0;
  const refresher = createConversationGraphRefresher({
    getBearerToken: () => 'token',
    flushPending: async () => ({ pending: 0, attempted: 0, synced: 0, failed: 0, remaining: 0 }),
    fetchImpl: async (url, init = {}) => {
      seen.push([init.method || 'GET', new URL(url).pathname]);
      if (url.endsWith('/status')) {
        statusCalls += 1;
        if (statusCalls === 1) await observationGate;
        return jsonResponse(readyStatus());
      }
      if (url.endsWith('/analysis/cluster-map')) return jsonResponse(clusterMap());
      if (url.endsWith('/ingestion/jobs') && init.method === 'POST') return jsonResponse(job('succeeded'));
      if (url.endsWith('/ingestion/jobs/job-1')) return jsonResponse(job('succeeded'));
      throw new Error(`unexpected request ${init.method || 'GET'} ${url}`);
    },
  });

  const observation = refresher.observe();
  const refresh = refresher.run({ trigger: 'hourly' });
  releaseObservation();
  const observed = await observation;
  const refreshed = await refresh;

  assert.equal(observed.mode, 'observe');
  assert.equal(refreshed.mode, 'ingest');
  assert.equal(seen.filter(([method, path]) => method === 'POST' && path.endsWith('/ingestion/jobs')).length, 1);
  assert.equal(statusCalls, 2, 'refresh must run its own status/action after the observer finishes');
});

test('external-owner observer only reads status and cluster map without flushing or enqueueing', async () => {
  const seen = [];
  let flushCalls = 0;
  const refresher = createConversationGraphRefresher({
    getBearerToken: () => 'token',
    flushPending: async () => {
      flushCalls += 1;
      throw new Error('observer must not flush chat');
    },
    fetchImpl: createFetchScript([
      { path: /\/status$/, body: readyStatus({ ingest_schedule_owner: 'external' }) },
      {
        path: /\/analysis\/cluster-map$/,
        body: clusterMap({ cluster_ai_labels: { 0: '반도체 밸류체인' } }),
      },
    ], seen),
  });

  const report = await refresher.observe();

  assert.equal(report.mode, 'observe');
  assert.equal(report.scheduleOwner, 'external');
  assert.equal(flushCalls, 0);
  assert.deepEqual(seen.map(({ url, init }) => [init.method || 'GET', new URL(url).pathname]), [
    ['GET', '/api/v1/brain/status'],
    ['GET', '/api/v1/brain/analysis/cluster-map'],
  ]);
  assert.match(report.graph.labelFingerprint, /^[a-f0-9]{64}$/);
});

test('status must explicitly enable ready, ingestion, and extraction before flushing', async () => {
  for (const [field, code] of [
    ['ready', 'brain_not_ready'],
    ['ingestion_ready', 'ingestion_not_ready'],
    ['extraction_enabled', 'extraction_disabled'],
  ]) {
    let flushed = false;
    const refresher = createConversationGraphRefresher({
      getBearerToken: () => 'token',
      flushPending: async () => { flushed = true; },
      fetchImpl: async () => jsonResponse(readyStatus({ [field]: false })),
    });
    await assert.rejects(
      refresher.run({ trigger: 'boot' }),
      (error) => error instanceof ConversationGraphRefreshError && error.code === code,
    );
    assert.equal(flushed, false);
  }
});

test('pending history with zero flushed sources and an empty graph fails as incomplete_history', async () => {
  const steps = [
    { path: /\/status$/, body: readyStatus() },
    { path: /\/ingestion\/jobs$/, method: 'POST', body: job('succeeded') },
    { path: /\/ingestion\/jobs\/job-1$/, body: job('succeeded') },
    { path: /\/analysis\/cluster-map$/, body: clusterMap({ revision: 0, nodes: [], edges: [], cluster_cohesion: {}, cluster_representative_labels: {}, edge_details: [] }) },
  ];
  const refresher = createConversationGraphRefresher({
    getBearerToken: () => 'token',
    flushPending: async () => ({ pending: 2, attempted: 0, synced: 0, failed: 0, remaining: 0 }),
    fetchImpl: createFetchScript(steps, []),
  });

  await assert.rejects(
    refresher.run({ trigger: 'boot' }),
    (error) => error.code === 'incomplete_history' && error.report.pending === 0,
  );
});

test('flush cannot silently finish with failed or remaining messages', async () => {
  const refresher = createConversationGraphRefresher({
    getBearerToken: () => 'token',
    flushPending: async () => ({ pending: 1, attempted: 1, synced: 0, failed: 1, remaining: 1 }),
    fetchImpl: async () => jsonResponse(readyStatus()),
  });
  await assert.rejects(refresher.run({ trigger: 'hourly' }), (error) => (
    error.code === 'pending_flush_incomplete' && error.report.pending === 1
  ));
});

test('failed jobs and poll timeout are terminal failures, while retry_wait remains pollable', async () => {
  for (const scenario of [
    { final: job('failed'), code: 'ingestion_failed', now: () => 0 },
    {
      final: job('retry_wait'),
      code: 'ingestion_timeout',
      now: (() => { let calls = 0; return () => (++calls < 7 ? 0 : 100); })(),
    },
  ]) {
    const seen = [];
    const refresher = createConversationGraphRefresher({
      getBearerToken: () => 'token',
      flushPending: async () => ({ pending: 0, attempted: 0, synced: 0, failed: 0, remaining: 0 }),
      fetchImpl: createFetchScript([
        { path: /\/status$/, body: readyStatus() },
        { path: /\/ingestion\/jobs$/, method: 'POST', body: job('pending') },
        { path: /\/ingestion\/jobs\/job-1$/, body: scenario.final },
      ], seen),
      sleep: async () => {},
      now: scenario.now,
      pollIntervalMs: 1,
    });
    await assert.rejects(
      refresher.run({ trigger: 'boot', timeoutMs: 50 }),
      (error) => error.code === scenario.code,
    );
    assert.equal(seen.length, 3, `${scenario.code} must inspect the exact enqueued job`);
  }
});

test('HTTP, auth, response shape, and trigger validation fail closed', async () => {
  assert.throws(
    () => createConversationGraphRefresher({ flushPending: async () => ({}) }),
    /getBearerToken/,
  );

  const noToken = createConversationGraphRefresher({
    getBearerToken: () => '',
    flushPending: async () => ({}),
    fetchImpl: async () => { throw new Error('must not fetch'); },
  });
  await assert.rejects(noToken.run({ trigger: 'boot' }), (error) => error.code === 'auth_unavailable');
  await assert.rejects(noToken.run({ trigger: 'manual' }), (error) => error.code === 'invalid_trigger');

  const httpFailure = createConversationGraphRefresher({
    getBearerToken: () => 'token',
    flushPending: async () => ({}),
    fetchImpl: async () => jsonResponse({ detail: 'down' }, { status: 503 }),
  });
  await assert.rejects(httpFailure.run({ trigger: 'boot' }), (error) => error.code === 'http_error' && error.status === 503);

  const malformed = createConversationGraphRefresher({
    getBearerToken: () => 'token',
    flushPending: async () => ({}),
    fetchImpl: async () => jsonResponse({ ready: true }),
  });
  await assert.rejects(malformed.run({ trigger: 'boot' }), (error) => error.code === 'invalid_status_shape');
});

test('per-request timeout aborts stalled HTTP and malformed cluster maps fail closed', async () => {
  const stalled = createConversationGraphRefresher({
    getBearerToken: () => 'token',
    flushPending: async () => ({}),
    httpTimeoutMs: 5,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
  });
  await assert.rejects(stalled.run({ trigger: 'boot' }), (error) => error.code === 'http_timeout');

  const malformedCluster = createConversationGraphRefresher({
    getBearerToken: () => 'token',
    flushPending: async () => ({ pending: 0, attempted: 0, synced: 0, failed: 0, remaining: 0 }),
    fetchImpl: createFetchScript([
      { path: /\/status$/, body: readyStatus() },
      { path: /\/ingestion\/jobs$/, method: 'POST', body: job('succeeded') },
      { path: /\/ingestion\/jobs\/job-1$/, body: job('succeeded') },
      { path: /\/analysis\/cluster-map$/, body: { revision: 1, nodes: 'not-an-array' } },
    ], []),
  });
  await assert.rejects(
    malformedCluster.run({ trigger: 'hourly' }),
    (error) => error.code === 'invalid_cluster_map_shape',
  );
});

test('single-flight shares one physical refresh between overlapping boot/hourly callers', async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let statusCalls = 0;
  const refresher = createConversationGraphRefresher({
    getBearerToken: () => 'token',
    flushPending: async () => ({ pending: 0, attempted: 0, synced: 0, failed: 0, remaining: 0 }),
    fetchImpl: async (url, init = {}) => {
      if (url.endsWith('/status')) {
        statusCalls += 1;
        await blocked;
        return jsonResponse(readyStatus());
      }
      if ((init.method || 'GET') === 'POST') return jsonResponse(job('succeeded'));
      if (url.includes('/ingestion/jobs/')) return jsonResponse(job('succeeded'));
      return jsonResponse(clusterMap({ nodes: [], edges: [], cluster_cohesion: {}, edge_details: [] }));
    },
  });

  const first = refresher.run({ trigger: 'boot' });
  const second = refresher.run({ trigger: 'hourly' });
  assert.equal(first, second);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.equal(a.trigger, 'boot');
  assert.equal(statusCalls, 1);
});
