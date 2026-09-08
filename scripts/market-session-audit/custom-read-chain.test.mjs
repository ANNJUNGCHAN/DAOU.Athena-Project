import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildCustomReadChainPlan, chainDefinitions, runCustomReadChain } from './custom-read-chain.mjs';

const extraRequired = {
  '/api/v1/backtest/data/coverage': [
    { name: 'stk_cd', in: 'query', required: true },
    { name: 'period', in: 'query', required: true },
    { name: 'adjusted', in: 'query', required: true },
  ],
  '/api/v1/backtest/strategies/{strategy_id}/diff': [
    { name: 'base', in: 'query', required: true },
    { name: 'head', in: 'query', required: true },
  ],
  '/api/v1/brain/chats': [{ name: 'conversation_id', in: 'query', required: true }],
  '/api/v1/brain/analysis/entity-timeline': [{ name: 'entity_id', in: 'query', required: true }],
  '/api/v1/brain/analysis/entity-detail': [{ name: 'entity', in: 'query', required: true }],
  '/api/v1/projects/{project_id}/file': [{ name: 'path', in: 'query', required: true }],
};

const openapiFor = (plan) => ({
  paths: Object.fromEntries([...plan.byId.values()].filter((item) => item.method === 'GET').map((item) => [item.route_template, {
    get: {
      operationId: item.expected_operation_id,
      parameters: [
        ...[...item.route_template.matchAll(/\{([^}]+)\}/g)].map((match) => ({ name: match[1], in: 'path', required: true })),
        ...(extraRequired[item.route_template] || []),
      ],
      responses: { 200: { content: { 'application/json': {} } } },
    },
  }])),
});

test('chain target set is exactly the 20 blocked custom GET IDs', async () => {
  const definitions = chainDefinitions();
  assert.equal(definitions.length, 20);
  assert.equal(new Set(definitions.map((item) => item.id)).size, 20);
  const plan = await buildCustomReadChainPlan();
  assert.equal(plan.results.length, 20);
  assert.equal(plan.results.filter((item) => item.status === 'READY_FOR_REVIEW').length, 17);
  assert.equal(plan.results.filter((item) => item.reason === 'NO_SAFE_EXISTING_LIST_SOURCE').length, 3);
  assert.equal(plan.identityBaseline.status, 'VERIFIED');
  const liveSweep = JSON.parse(await readFile(new URL('../../artifacts/market-session-audit/2026-09-07/custom-read-sweep-20260907T003436-339Z.json', import.meta.url), 'utf8'));
  const actualBlocked = liveSweep.results.filter((item) => item.verdict === 'BLOCKED').map((item) => item.id).sort();
  assert.deepEqual(definitions.map((item) => item.id).sort(), actualBlocked);
});

test('dry run performs no network calls and persists no selected values', async () => {
  let calls = 0;
  const report = await runCustomReadChain({ execute: false, fetchFn: async () => { calls += 1; throw new Error('must not fetch'); } });
  assert.equal(calls, 0);
  assert.equal(report.summary.total, 20);
  assert.equal(report.summary.NOT_RUN, 17);
  assert.equal(report.summary.BLOCKED, 3);
  assert.equal(report.scope.selected_values_persisted, false);
});

test('existing run IDs flow only in memory from list GET to target GET', async () => {
  const plan = await buildCustomReadChainPlan();
  const openapi = openapiFor(plan);
  const secretId = 'private-run-id';
  const calls = [];
  const report = await runCustomReadChain({
    execute: true, openapi, bearer: 'private-token', maxRequests: 40,
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), init });
      const pathname = new URL(url).pathname;
      if (pathname === '/api/v1/backtest/runs') return new Response(JSON.stringify({ runs: [{ run_id: secretId }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (pathname.includes('/api/v1/backtest/runs/')) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.ok(calls.every((call) => call.init.method === 'GET' && call.init.redirect === 'error' && call.init.credentials === 'omit'));
  assert.ok(calls.some((call) => call.url.includes(secretId)));
  assert.equal(JSON.stringify(report).includes(secretId), false);
  assert.equal(JSON.stringify(report).includes('private-token'), false);
});

test('empty source lists block targets without issuing fabricated target calls', async () => {
  const plan = await buildCustomReadChainPlan();
  const openapi = openapiFor(plan);
  const calls = [];
  const report = await runCustomReadChain({
    execute: true, openapi, bearer: null, maxRequests: 40,
    fetchFn: async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ runs: [], strategies: [], deployments: [], conversations: [], nodes: [], operations: [], projects: [], notice: null, routines: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(report.results.filter((item) => item.verdict === 'BLOCKED').length, 20);
  assert.ok(report.results.some((item) => item.reason === 'BLOCKED_NO_EXISTING_RECORD'));
  assert.equal(calls.some((url) => /\{[^}]+\}/.test(url)), false);
});

test('project targets skip a stale first record and use the viable existing project', async () => {
  const plan = await buildCustomReadChainPlan();
  const openapi = openapiFor(plan);
  const staleId = 'private-project-a-stale';
  const viableId = 'private-project-z-viable';
  const calls = [];
  const report = await runCustomReadChain({
    execute: true, openapi, bearer: null, maxRequests: 40,
    fetchFn: async (url) => {
      calls.push(String(url));
      const pathname = new URL(url).pathname;
      if (pathname === '/api/v1/projects') {
        return new Response(JSON.stringify({
          notice: null,
          projects: [
            { id: staleId, exists: false, kind: 'managed' },
            { id: viableId, exists: true, kind: 'external' },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (pathname.endsWith('/tree')) {
        return new Response(JSON.stringify({ entries: [{ path: 'private-strategy.py', py: true, is_dir: false }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ runs: [], strategies: [], deployments: [], conversations: [], nodes: [], operations: [], routines: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const projectTargetCalls = calls.filter((url) => new URL(url).pathname.startsWith('/api/v1/projects/'));
  assert.equal(projectTargetCalls.length, 3);
  assert.ok(projectTargetCalls.every((url) => decodeURIComponent(new URL(url).pathname).includes(viableId)));
  assert.ok(projectTargetCalls.every((url) => !decodeURIComponent(new URL(url).pathname).includes(staleId)));
  assert.equal(report.results.filter((item) => item.id.includes('/projects/{project_id}') && item.verdict === 'PASS_HTTP_SCHEMA_ONLY').length, 3);
  assert.equal(JSON.stringify(report).includes(staleId), false);
  assert.equal(JSON.stringify(report).includes(viableId), false);
});

test('project targets fail closed when every registered project is stale', async () => {
  const plan = await buildCustomReadChainPlan();
  const openapi = openapiFor(plan);
  const staleId = 'private-project-only-stale';
  const calls = [];
  const report = await runCustomReadChain({
    execute: true, openapi, bearer: null, maxRequests: 40,
    fetchFn: async (url) => {
      calls.push(String(url));
      const pathname = new URL(url).pathname;
      if (pathname === '/api/v1/projects') {
        return new Response(JSON.stringify({ notice: null, projects: [{ id: staleId, exists: false, kind: 'managed' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ runs: [], strategies: [], deployments: [], conversations: [], nodes: [], operations: [], routines: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const projectResults = report.results.filter((item) => item.id.includes('/projects/{project_id}'));
  assert.equal(projectResults.length, 3);
  assert.ok(projectResults.every((item) => item.verdict === 'BLOCKED' && item.reason === 'BLOCKED_NO_VIABLE_PROJECT' && item.attempted === false));
  assert.equal(calls.some((url) => new URL(url).pathname.startsWith('/api/v1/projects/')), false);
  assert.equal(JSON.stringify(report).includes(staleId), false);
});

test('project targets fail closed when the project registry reports a notice', async () => {
  const plan = await buildCustomReadChainPlan();
  const openapi = openapiFor(plan);
  const privateId = 'private-project-hidden-by-notice';
  const calls = [];
  const report = await runCustomReadChain({
    execute: true, openapi, bearer: null, maxRequests: 40,
    fetchFn: async (url) => {
      calls.push(String(url));
      const pathname = new URL(url).pathname;
      if (pathname === '/api/v1/projects') {
        return new Response(JSON.stringify({
          notice: 'registry recovery required',
          projects: [{ id: privateId, exists: true, kind: 'managed' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ runs: [], strategies: [], deployments: [], conversations: [], nodes: [], operations: [], routines: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const projectResults = report.results.filter((item) => item.id.includes('/projects/{project_id}'));
  assert.equal(projectResults.length, 3);
  assert.ok(projectResults.every((item) => item.verdict === 'BLOCKED' && item.reason === 'BLOCKED_SOURCE_CONTRACT_MISMATCH' && item.attempted === false));
  assert.equal(calls.filter((url) => new URL(url).pathname === '/api/v1/projects').length, 1);
  assert.equal(calls.some((url) => new URL(url).pathname.startsWith('/api/v1/projects/')), false);
  assert.equal(JSON.stringify(report).includes(privateId), false);
  assert.equal(JSON.stringify(report).includes('registry recovery required'), false);
});

test('runtime operation identity mismatch blocks before fetch and limits are validated', async () => {
  const plan = await buildCustomReadChainPlan();
  const openapi = openapiFor(plan);
  openapi.paths['/api/v1/backtest/runs'].get.operationId = 'unexpected';
  const calls = [];
  const report = await runCustomReadChain({ execute: true, openapi, bearer: null, fetchFn: async (url) => { calls.push(String(url)); throw new Error('transport failure'); } });
  assert.equal(calls.length, 0);
  assert.equal(report.request_count, 0);
  assert.equal(report.openapi_preflight.reason, 'RUNTIME_IDENTITY_MISMATCH');
  await assert.rejects(() => runCustomReadChain({ execute: true, openapi, maxRequests: 41 }), /between 1 and 40/);
  await assert.rejects(() => runCustomReadChain({ execute: true, openapi, timeoutMs: 10_001 }), /between 100 and 10000/);
});

test('diff selects two existing versions deterministically and never persists either ID', async () => {
  const plan = await buildCustomReadChainPlan();
  const openapi = openapiFor(plan);
  const values = ['private-version-z', 'private-version-a'];
  const calls = [];
  const report = await runCustomReadChain({
    execute: true, openapi, bearer: null, maxRequests: 40,
    fetchFn: async (url) => {
      calls.push(String(url));
      const parsed = new URL(url);
      if (parsed.pathname === '/api/v1/backtest/strategies') return new Response(JSON.stringify({ strategies: [{ id: 'private-strategy' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (parsed.pathname.endsWith('/versions')) return new Response(JSON.stringify({ versions: values.map((id) => ({ id })) }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const diffCall = calls.find((url) => new URL(url).pathname.endsWith('/diff'));
  assert.ok(diffCall);
  assert.equal(new URL(diffCall).searchParams.get('base'), 'private-version-a');
  assert.equal(new URL(diffCall).searchParams.get('head'), 'private-version-z');
  for (const value of [...values, 'private-strategy']) assert.equal(JSON.stringify(report).includes(value), false);
});

test('target HTTP errors preserve attempted time and bounded reasons', async () => {
  const plan = await buildCustomReadChainPlan();
  const openapi = openapiFor(plan);
  const clock = () => new Date('2026-09-07T01:20:00Z');
  const httpReport = await runCustomReadChain({
    execute: true, openapi, bearer: null, maxRequests: 40, clock,
    fetchFn: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/api/v1/backtest/deployments') return new Response(JSON.stringify({ deployments: [{ id: 'd', stk_cd: 'x', period: 'D', adjusted: false }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (pathname === '/api/v1/backtest/data/coverage') return new Response(JSON.stringify({ detail: 'private-error' }), { status: 500, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const coverage = httpReport.results.find((item) => item.id.endsWith('/backtest/data/coverage'));
  assert.equal(coverage.attempted, true);
  assert.equal(coverage.observed_at, '2026-09-07T01:20:00.000Z');
  assert.equal(coverage.evidence.http_status, 500);
  assert.equal(JSON.stringify(httpReport).includes('private-error'), false);
});

test('duration aborts preserve attempted time and bounded reasons without wall-clock timing', async (t) => {
  const plan = await buildCustomReadChainPlan();
  const openapi = openapiFor(plan);
  t.mock.method(globalThis, 'setTimeout', (callback) => {
    queueMicrotask(callback);
    return 1;
  });
  t.mock.method(globalThis, 'clearTimeout', () => {});
  const durationReport = await runCustomReadChain({
    execute: true, openapi, bearer: null, maxDurationMs: 100, timeoutMs: 10_000,
    fetchFn: async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('hidden'), { name: 'AbortError' })), { once: true })),
  });
  assert.ok(durationReport.source_observations.some((item) => item.reason === 'DURATION_LIMIT_REACHED'));
  assert.ok(durationReport.source_observations.filter((item) => item.reason === 'DURATION_LIMIT_REACHED').every((item) => item.observed_at));
});

test('response URL changes and oversized JSON are explicit and never persist raw content', async () => {
  const plan = await buildCustomReadChainPlan();
  const openapi = openapiFor(plan);
  const huge = 'private-large-body'.repeat(70_000);
  let first = true;
  const report = await runCustomReadChain({
    execute: true, openapi, bearer: null, maxRequests: 40,
    fetchFn: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/api/v1/backtest/runs' && first) {
        first = false;
        const response = new Response(JSON.stringify({ runs: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
        Object.defineProperty(response, 'url', { value: 'http://127.0.0.1:8010/different' });
        return response;
      }
      if (pathname === '/api/v1/backtest/deployments') return new Response(JSON.stringify({ deployments: [{ id: 'd', stk_cd: 'x', period: 'D', adjusted: false }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (pathname === '/api/v1/backtest/data/coverage') return new Response(JSON.stringify({ value: huge }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.ok(report.source_observations.some((item) => item.reason === 'RESPONSE_URL_CHANGED'));
  assert.ok(report.results.some((item) => item.reason === 'RESPONSE_TOO_LARGE'));
  assert.equal(JSON.stringify(report).includes('private-large-body'), false);
});

test('missing default credential and first 401 stop all business requests fail closed', async () => {
  const plan = await buildCustomReadChainPlan();
  const openapi = openapiFor(plan);
  let calls = 0;
  const unavailable = await runCustomReadChain({ execute: true, openapi, readBearerFn: async () => null, fetchFn: async () => { calls += 1; throw new Error('must not fetch'); } });
  assert.equal(calls, 0);
  assert.equal(unavailable.request_count, 0);
  assert.ok(unavailable.results.filter((item) => item.status !== 'BLOCKED').every((item) => item.reason === 'AUTH_UNAVAILABLE'));

  const rejected = await runCustomReadChain({
    execute: true, openapi, bearer: 'private-token',
    fetchFn: async () => {
      calls += 1;
      return new Response(JSON.stringify({ detail: 'private-auth-message' }), { status: 401, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(rejected.request_count, 1);
  assert.equal(calls, 1);
  assert.ok(rejected.source_observations.some((item) => item.reason === 'AUTH_REJECTED' && item.observed_at));
  assert.equal(JSON.stringify(rejected).includes('private-auth-message'), false);
  assert.equal(JSON.stringify(rejected).includes('private-token'), false);
});

test('chat, file, and environment response strings remain memory-only', async () => {
  const plan = await buildCustomReadChainPlan();
  const openapi = openapiFor(plan);
  const secrets = ['private-conversation-id', 'private-chat-text', 'private-project-id', 'private-file.py', 'private-file-body', 'private-python-path'];
  const report = await runCustomReadChain({
    execute: true, openapi, bearer: 'private-token', maxRequests: 40,
    fetchFn: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/api/v1/brain/conversations') return new Response(JSON.stringify({ conversations: [{ conversation_id: secrets[0] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (pathname === '/api/v1/brain/chats') return new Response(JSON.stringify({ messages: [{ text: secrets[1] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (pathname === '/api/v1/projects') return new Response(JSON.stringify({ notice: null, projects: [{ id: secrets[2], exists: true, kind: 'managed' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (pathname.endsWith('/tree')) return new Response(JSON.stringify({ entries: [{ path: secrets[3], py: true, is_dir: false }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (pathname.endsWith('/file')) return new Response(JSON.stringify({ path: secrets[3], text: secrets[4] }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (pathname.endsWith('/env')) return new Response(JSON.stringify({ python: secrets[5], packages: { private_package: '1' } }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ runs: [], strategies: [], deployments: [], nodes: [], operations: [], routines: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const persisted = JSON.stringify(report);
  for (const secret of [...secrets, 'private_package', 'private-token']) assert.equal(persisted.includes(secret), false);
});

test('external or alternate-port origins are rejected before credential access and network calls', async () => {
  await assert.rejects(() => runCustomReadChain({ execute: true, baseUrl: 'https://example.com:8010' }), /http/);
  await assert.rejects(() => runCustomReadChain({ execute: true, baseUrl: 'http://127.0.0.1:8011' }), /8010/);
});

test('predecessor values cannot choose a route or traverse a path and are absent from artifacts', async () => {
  const plan = await buildCustomReadChainPlan();
  const openapi = openapiFor(plan);
  const maliciousProject = '../../outside-project';
  const maliciousFile = '../../secret.py';
  const calls = [];
  const report = await runCustomReadChain({
    execute: true, openapi, bearer: null, maxRequests: 40,
    fetchFn: async (url) => {
      calls.push(String(url));
      const parsed = new URL(url);
      if (parsed.pathname === '/api/v1/projects') return new Response(JSON.stringify({ notice: null, projects: [{ id: maliciousProject, exists: true, kind: 'external' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (parsed.pathname.endsWith('/tree')) return new Response(JSON.stringify({ entries: [{ path: maliciousFile, py: true, is_dir: false }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const projectCalls = calls.filter((url) => url.includes('/api/v1/projects/'));
  assert.ok(projectCalls.length > 0);
  assert.equal(projectCalls.some((url) => url.includes('/../') || url.includes('path=../')), false);
  assert.ok(projectCalls.some((url) => url.includes('..%2F..%2Foutside-project')));
  assert.equal(JSON.stringify(report).includes(maliciousProject), false);
  assert.equal(JSON.stringify(report).includes(maliciousFile), false);
});
