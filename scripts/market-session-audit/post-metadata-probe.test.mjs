import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runPostMetadataProbe } from './post-metadata-probe.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

function openapi(overrides = {}) {
  const operation = (operationId, request, response) => ({
    operationId,
    requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${request}` } } } },
    responses: { 200: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${response}` } } } } },
  });
  return {
    openapi: '3.1.0',
    paths: {
      '/api/v1/llm/tools/search': { post: operation('llm_search_operations', 'SearchRequest', 'SearchResponse') },
      '/api/v1/llm/tools/describe': { post: operation('llm_describe_operation', 'DescribeRequest', 'OperationDescription') },
      ...overrides,
    },
  };
}

function response(body, url, init = {}) {
  const value = new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
  Object.defineProperty(value, 'url', { value: url });
  return value;
}

async function withDir(prefix, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('explicit execute and exact loopback origin are required before credentials or network', async () => withDir('athena-post-origin-', async (dir) => {
  let credentials = 0;
  let requests = 0;
  await assert.rejects(() => runPostMetadataProbe({ execute: false, outputDir: dir }), /EXPLICIT_EXECUTE_REQUIRED/);
  await assert.rejects(() => runPostMetadataProbe({
    execute: true,
    baseUrl: 'http://localhost:8010',
    outputDir: dir,
    readBearerFn: async () => { credentials += 1; return 'secret'; },
    fetchFn: async () => { requests += 1; },
  }));
  assert.equal(credentials, 0);
  assert.equal(requests, 0);
}));

test('OpenAPI drift blocks both POST routes before either is attempted', async () => withDir('athena-post-openapi-', async (dir) => {
  let business = 0;
  const drifted = openapi({ '/api/v1/llm/tools/search': { post: { operationId: 'wrong' } } });
  const error = await runPostMetadataProbe({
    execute: true, repoRoot: ROOT, outputDir: dir, readBearerFn: async () => 'secret',
    fetchFn: async (url) => {
      if (url.pathname === '/openapi.json') return response(drifted, url.href);
      business += 1;
      throw new Error('must not run');
    },
  }).then(() => null, (caught) => caught);
  assert.equal(error.code, 'RUNTIME_IDENTITY_MISMATCH');
  assert.equal(business, 0);
  const marker = JSON.parse(await readFile(error.outputPath, 'utf8'));
  assert.equal(marker.admission.transport_response_received, true);
  assert.equal(marker.admission.network_response_received, false);
}));

test('missing local bearer stops after source verification and before metadata fetch', async () => withDir('athena-post-noauth-', async (dir) => {
  let requests = 0;
  const error = await runPostMetadataProbe({
    execute: true, repoRoot: ROOT, outputDir: dir, readBearerFn: async () => null,
    fetchFn: async () => { requests += 1; },
  }).then(() => null, (caught) => caught);
  assert.equal(error.code, 'AUTH_UNAVAILABLE');
  assert.equal(requests, 0);
  const marker = JSON.parse(await readFile(error.outputPath, 'utf8'));
  assert.equal(marker.mode, 'in_memory_fixture');
  assert.deepEqual(marker.admission, {
    source_reads: 3, credential_reads: 1, metadata_requests: 0, business_requests: 0, transport_responses_received: 0,
    count_semantics: 'transport_adapter_invocations', transport_response_received: false, network_response_received: false,
  });
}));

test('redirect and authentication rejection stop without leaking response data or token', async () => withDir('athena-post-reject-', async (dir) => {
  for (const mode of ['redirect', 'auth']) {
    const secret = `secret-${mode}`;
    const raw = `raw-${mode}`;
    const error = await runPostMetadataProbe({
      execute: true, repoRoot: ROOT, outputDir: dir, readBearerFn: async () => secret,
      fetchFn: async (url) => {
        if (mode === 'redirect') return response({ raw }, 'http://127.0.0.1:8010/changed');
        const rejected = new Response(JSON.stringify({ raw }), { status: 401, headers: { 'content-type': 'application/json' } });
        Object.defineProperty(rejected, 'url', { value: url.href });
        return rejected;
      },
    }).then(() => null, (caught) => caught);
    const persisted = await readFile(error.outputPath, 'utf8');
    const marker = JSON.parse(persisted);
    assert.equal(marker.mode, 'in_memory_fixture');
    assert.equal(marker.admission.transport_response_received, true);
    assert.equal(marker.admission.network_response_received, false);
    assert.equal(persisted.includes(secret), false);
    assert.equal(persisted.includes(raw), false);
  }
}));

test('first eligible read-only result is described in memory while refs and raw bodies stay out of artifact', async () => withDir('athena-post-select-', async (dir) => {
  const secret = 'secret-token';
  const raw = 'private-result-text';
  const requests = [];
  const safeRef = 'detail:ka10001:current_trading';
  const { artifact, outputPath } = await runPostMetadataProbe({
    execute: true, repoRoot: ROOT, outputDir: dir, timestamp: new Date('2026-09-07T03:00:00Z'), readBearerFn: async () => secret,
    fetchFn: async (url, init) => {
      requests.push({ path: url.pathname, method: init.method, body: init.body });
      if (url.pathname === '/openapi.json') return response(openapi(), url.href);
      if (url.pathname.endsWith('/search')) {
        assert.deepEqual(JSON.parse(init.body), { query: '삼성전자 오늘 주가 얼마야?', intent: 'query', limit: 5 });
        return response({
        catalog_version: 'v', normalized_query: raw,
        results: [
          { operation_ref: 'base:kt10000', kind: 'order', generic_callable: true },
          { operation_ref: '../untrusted', kind: 'query', generic_callable: true },
          { operation_ref: safeRef, kind: 'query', generic_callable: false },
        ],
        }, url.href);
      }
      const body = JSON.parse(init.body);
      assert.equal(body.operation_ref, safeRef);
      return response({ catalog_version: 'v', operation_ref: safeRef, kind: 'query', name: raw }, url.href);
    },
  });
  assert.deepEqual(requests.map((item) => [item.path, item.method]), [
    ['/openapi.json', 'GET'],
    ['/api/v1/llm/tools/search', 'POST'],
    ['/api/v1/llm/tools/describe', 'POST'],
  ]);
  assert.equal(artifact.summary.pass_http_json_shape_only, 2);
  assert.equal(artifact.mode, 'in_memory_fixture');
  assert.equal(artifact.admission.count_semantics, 'transport_adapter_invocations');
  assert.equal(artifact.admission.transport_response_received, true);
  assert.equal(artifact.admission.network_response_received, false);
  const persisted = await readFile(outputPath, 'utf8');
  for (const forbidden of [secret, raw, safeRef, 'kt10000', '../untrusted']) assert.equal(persisted.includes(forbidden), false);
}));

test('no eligible query result blocks describe without inventing a ref', async () => withDir('athena-post-empty-', async (dir) => {
  let describe = 0;
  const { artifact } = await runPostMetadataProbe({
    execute: true, repoRoot: ROOT, outputDir: dir, readBearerFn: async () => 'secret',
    fetchFn: async (url) => {
      if (url.pathname === '/openapi.json') return response(openapi(), url.href);
      if (url.pathname.endsWith('/search')) return response({ catalog_version: 'v', normalized_query: 'x', results: [{ operation_ref: 'base:kt10000', kind: 'order', generic_callable: true }] }, url.href);
      describe += 1;
      throw new Error('must not run');
    },
  });
  assert.equal(describe, 0);
  assert.equal(artifact.admission.business_requests, 1);
  assert.equal(artifact.results[1].reason, 'NO_ELIGIBLE_READ_ONLY_REF');
}));

test('missing search results array blocks search itself while preserving the received HTTP response', async () => withDir('athena-post-search-shape-', async (dir) => {
  let describe = 0;
  const { artifact } = await runPostMetadataProbe({
    execute: true, repoRoot: ROOT, outputDir: dir, readBearerFn: async () => 'fixture-secret',
    fetchFn: async (url) => {
      if (url.pathname === '/openapi.json') return response(openapi(), url.href);
      if (url.pathname.endsWith('/search')) return response({ foo: 1 }, url.href);
      describe += 1;
      throw new Error('must not run');
    },
  });
  assert.equal(describe, 0);
  assert.deepEqual({
    verdict: artifact.results[0].verdict,
    reason: artifact.results[0].reason,
    response_received: artifact.results[0].response_received,
    http_status: artifact.results[0].http_status,
  }, {
    verdict: 'BLOCKED', reason: 'SEARCH_RESPONSE_CONTRACT_MISMATCH', response_received: true, http_status: 200,
  });
  assert.equal(artifact.results[1].reason, 'SEARCH_PREREQUISITE_FAILED');
}));

test('describe identity mismatch remains a received HTTP 200 response', async () => withDir('athena-post-describe-shape-', async (dir) => {
  const safeRef = 'base:ka10001';
  const { artifact } = await runPostMetadataProbe({
    execute: true, repoRoot: ROOT, outputDir: dir, readBearerFn: async () => 'fixture-secret',
    fetchFn: async (url) => {
      if (url.pathname === '/openapi.json') return response(openapi(), url.href);
      if (url.pathname.endsWith('/search')) return response({ results: [{ operation_ref: safeRef, kind: 'query' }] }, url.href);
      return response({ operation_ref: 'base:ka10002', kind: 'query' }, url.href);
    },
  });
  assert.equal(artifact.results[1].verdict, 'BLOCKED');
  assert.equal(artifact.results[1].reason, 'DESCRIBE_RESPONSE_CONTRACT_MISMATCH');
  assert.equal(artifact.results[1].response_received, true);
  assert.equal(artifact.results[1].http_status, 200);
  assert.equal(artifact.admission.transport_responses_received, 3);
}));

test('business HTTP failure records received response and status without treating adapter count as network proof', async () => withDir('athena-post-http-', async (dir) => {
  const raw = 'private-http-error';
  const { artifact, outputPath } = await runPostMetadataProbe({
    execute: true, repoRoot: ROOT, outputDir: dir, readBearerFn: async () => 'fixture-secret',
    fetchFn: async (url) => {
      if (url.pathname === '/openapi.json') return response(openapi(), url.href);
      return response({ raw }, url.href, { status: 500 });
    },
  });
  assert.equal(artifact.results[0].verdict, 'BLOCKED');
  assert.equal(artifact.results[0].http_status, 500);
  assert.equal(artifact.results[0].response_received, true);
  assert.equal(artifact.results[1].response_received, false);
  assert.equal(artifact.admission.transport_responses_received, 2);
  assert.equal(artifact.admission.transport_response_received, true);
  assert.equal(artifact.admission.network_response_received, false);
  assert.equal((await readFile(outputPath, 'utf8')).includes(raw), false);
}));

test('business response size and stalled body are bounded and sanitized', async () => withDir('athena-post-bounds-', async (dir) => {
  for (const mode of ['oversize', 'stall']) {
    const raw = `raw-${mode}`;
    const { artifact, outputPath } = await runPostMetadataProbe({
      execute: true, repoRoot: ROOT, outputDir: dir, timeoutMs: 25, readBearerFn: async () => 'secret',
      fetchFn: async (url) => {
        if (url.pathname === '/openapi.json') return response(openapi(), url.href);
        if (mode === 'stall') {
          const stalled = new Response(new ReadableStream({ start() {} }), { status: 200, headers: { 'content-type': 'application/json' } });
          Object.defineProperty(stalled, 'url', { value: url.href });
          return stalled;
        }
        return response({ raw: `${raw}${'x'.repeat(1_000_000)}` }, url.href);
      },
    });
    assert.equal(artifact.results[0].verdict, 'BLOCKED');
    assert.equal(artifact.results[1].reason, 'SEARCH_PREREQUISITE_FAILED');
    const persisted = await readFile(outputPath, 'utf8');
    assert.equal(persisted.includes(raw), false);
  }
}));

test('source contract drift blocks credential and network admission', async () => withDir('athena-post-source-', async (dir) => {
  const fakeRoot = path.join(dir, 'repo');
  let credentials = 0;
  let requests = 0;
  const error = await runPostMetadataProbe({
    execute: true, repoRoot: fakeRoot, outputDir: dir,
    readBearerFn: async () => { credentials += 1; return 'secret'; },
    fetchFn: async () => { requests += 1; },
  }).then(() => null, (caught) => caught);
  assert.equal(error.code, 'SOURCE_CONTRACT_UNAVAILABLE');
  assert.equal(credentials, 0);
  assert.equal(requests, 0);
}));

test('overall duration includes a slow injected credential reader and forbids transport afterward', async () => withDir('athena-post-deadline-', async (dir) => {
  let requests = 0;
  const started = Date.now();
  const error = await runPostMetadataProbe({
    execute: true, repoRoot: ROOT, outputDir: dir, maxDurationMs: 20,
    readBearerFn: async () => new Promise((resolve) => setTimeout(() => resolve('fixture-secret'), 100)),
    fetchFn: async () => { requests += 1; throw new Error('must not run'); },
  }).then(() => null, (caught) => caught);
  assert.equal(error.code, 'DURATION_LIMIT_REACHED');
  assert.equal(requests, 0);
  assert.ok(Date.now() - started < 100);
  const marker = JSON.parse(await readFile(error.outputPath, 'utf8'));
  assert.equal(marker.mode, 'in_memory_fixture');
  assert.equal(marker.admission.business_requests, 0);
  assert.equal(marker.admission.transport_response_received, false);
  assert.equal(marker.admission.network_response_received, false);
}));

test('fixture executions leave the default audit artifact directory unchanged', async () => {
  const defaultDir = path.join(ROOT, 'artifacts', 'market-session-audit', '2026-09-07');
  const names = async () => (await readdir(defaultDir)).filter((name) => name.startsWith('post-metadata-probe-')).sort();
  const before = await names();
  await withDir('athena-post-default-guard-', async (dir) => {
    const { outputPath, artifact } = await runPostMetadataProbe({
      execute: true, repoRoot: ROOT, outputDir: dir, readBearerFn: async () => 'fixture-secret',
      fetchFn: async (url) => {
        if (url.pathname === '/openapi.json') return response(openapi(), url.href);
        if (url.pathname.endsWith('/search')) return response({ results: [] }, url.href);
        throw new Error('describe must remain blocked');
      },
    });
    assert.equal(path.dirname(outputPath), dir);
    assert.equal(artifact.mode, 'in_memory_fixture');
  });
  assert.deepEqual(await names(), before);
});
