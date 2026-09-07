import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildCustomReadPlan, runCustomReadSweep } from './custom-read-sweep.mjs';

const reviewedSource = 'backend/athena_api/main.py';
const reviewedBody = await readFile(new URL('../../backend/athena_api/main.py', import.meta.url));

async function fixtureRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-custom-read-'));
  const target = path.join(root, reviewedSource);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, reviewedBody);
  return root;
}

function inventory(items) {
  return { revision: 'abc123', items: items.map(({ id, sourceId, sourcePath = reviewedSource }) => ({ id, source: 'custom_api_route', source_id: sourceId, source_path: sourcePath })) };
}

function runtimeBaseline(input, revision = 'abc123') {
  return {
    kind: 'athena_runtime_openapi_discovery',
    revision,
    reconciliation: {
      other_runtime_api: {
        routes: input.items.filter((row) => !row.source_id.startsWith('WEBSOCKET ')).map((row) => {
          const match = /^(\S+)\s+(.+)$/.exec(row.source_id);
          return { method: match[1], path: match[2], operation_id: `op:${row.id}` };
        }),
      },
    },
  };
}

test('dry run classifies every row once and fails closed for non-GET, streams, inputs, and changed source', async () => {
  const root = await fixtureRepo();
  try {
    const input = inventory([
      { id: 'get-ready', sourceId: 'GET /ready' },
      { id: 'get-by-id', sourceId: 'GET /items/{item_id}' },
      { id: 'post', sourceId: 'POST /items' },
      { id: 'ws', sourceId: 'WEBSOCKET /ws' },
      { id: 'changed', sourceId: 'GET /changed', sourcePath: 'backend/athena_api/changed.py' },
    ]);
    const { results } = await buildCustomReadPlan({ repoRoot: root, inventory: input, revision: 'abc123', runtimeBaseline: runtimeBaseline(input) });
    assert.equal(results.length, 5);
    assert.equal(new Set(results.map((row) => row.id)).size, 5);
    assert.deepEqual(results.map((row) => row.reason), [
      'DRY_RUN_RUNTIME_OPENAPI_REQUIRED',
      'MISSING_SAFE_OBSERVED_INPUT',
      'NON_GET_NOT_AUTHORIZED',
      'STREAM_PROTOCOL_EXCLUDED',
      'SOURCE_NOT_SAFETY_REVIEWED',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('execute uses loopback GET only and persists schema evidence without values or identifiers', async () => {
  const root = await fixtureRepo();
  const secret = 'never-persist-bearer';
  const privateValue = 'private-response-value';
  const calls = [];
  try {
    const report = await runCustomReadSweep({
      repoRoot: root,
      inventory: inventory([{ id: 'get-ready', sourceId: 'GET /ready' }]),
      runtimeBaseline: runtimeBaseline(inventory([{ id: 'get-ready', sourceId: 'GET /ready' }])),
      revision: 'abc123',
      execute: true,
      bearer: secret,
      rateMs: 0,
      now: new Date('2026-09-07T00:05:00Z'),
      clock: () => new Date('2026-09-07T00:05:01Z'),
      fetchFn: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify({ paths: { '/ready': { get: { operationId: 'op:get-ready', responses: { 200: { content: { 'application/json': {} } } } } } } }), { status: 200, headers: { 'content-type': 'application/json' } });
        return new Response(JSON.stringify({ ready: true, detail: privateValue, account_alias: 'do-not-store' }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.init.method === 'GET'));
    assert.ok(calls.every((call) => call.init.redirect === 'error' && call.init.credentials === 'omit'));
    assert.equal(report.results[0].verdict, 'PASS');
    const persisted = JSON.stringify(report);
    for (const forbidden of [secret, privateValue, 'do-not-store']) assert.equal(persisted.includes(forbidden), false);
    assert.equal(report.scope.full_product_pass_claimed, false);
    assert.equal(report.results[0].market_phase.phase, 'REGULAR');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('required query input is blocked unless tagged as safe observed metadata, and values are never persisted', async () => {
  const root = await fixtureRepo();
  const calls = [];
  const openapi = { paths: { '/ready': { get: { operationId: 'op:get-ready', parameters: [{ name: 'scope', in: 'query', required: true }], responses: { 200: { content: { 'application/json': {} } } } } } } };
  try {
    const common = {
      repoRoot: root,
      inventory: inventory([{ id: 'get-ready', sourceId: 'GET /ready' }]),
      runtimeBaseline: runtimeBaseline(inventory([{ id: 'get-ready', sourceId: 'GET /ready' }])),
      revision: 'abc123', execute: true, bearer: null, rateMs: 0,
      fetchFn: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify(openapi), { status: 200, headers: { 'content-type': 'application/json' } });
        return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    };
    const blocked = await runCustomReadSweep(common);
    assert.equal(blocked.results[0].reason, 'MISSING_SAFE_OBSERVED_INPUT');
    const executed = await runCustomReadSweep({ ...common, safeInputsById: { 'get-ready': { scope: { value: 'owned-value', source: 'existing_local_record' } } } });
    assert.equal(executed.results[0].verdict, 'PASS');
    assert.equal(JSON.stringify(executed).includes('owned-value'), false);
    assert.deepEqual(executed.results[0].resolved_parameters, [{ name: 'scope', in: 'query', source: 'existing_local_record' }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a path parameter executes only from tagged safe observed metadata and does not persist its value', async () => {
  const root = await fixtureRepo();
  const identifier = 'private-owned-id';
  const calls = [];
  try {
    const report = await runCustomReadSweep({
      repoRoot: root,
      inventory: inventory([{ id: 'get-by-id', sourceId: 'GET /items/{item_id}' }]),
      runtimeBaseline: runtimeBaseline(inventory([{ id: 'get-by-id', sourceId: 'GET /items/{item_id}' }])),
      revision: 'abc123', execute: true, bearer: null, rateMs: 0,
      safeInputsById: { 'get-by-id': { item_id: { value: identifier, source: 'existing_local_record' } } },
      fetchFn: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify({ paths: { '/items/{item_id}': { get: { operationId: 'op:get-by-id', parameters: [{ name: 'item_id', in: 'path', required: true }], responses: { 200: { content: { 'application/json': {} } } } } } } }), { status: 200, headers: { 'content-type': 'application/json' } });
        return new Response(JSON.stringify({ found: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    assert.equal(calls.length, 2);
    assert.ok(calls[1].url.endsWith(`/items/${identifier}`));
    assert.equal(report.results[0].verdict, 'PASS');
    assert.equal(JSON.stringify(report).includes(identifier), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('streaming responses are excluded before body consumption', async () => {
  const root = await fixtureRepo();
  try {
    const report = await runCustomReadSweep({
      repoRoot: root,
      inventory: inventory([{ id: 'get-ready', sourceId: 'GET /ready' }]),
      runtimeBaseline: runtimeBaseline(inventory([{ id: 'get-ready', sourceId: 'GET /ready' }])),
      revision: 'abc123', execute: true, bearer: null, rateMs: 0,
      fetchFn: async (url) => String(url).endsWith('/openapi.json')
        ? new Response(JSON.stringify({ paths: { '/ready': { get: { operationId: 'op:get-ready', responses: { 200: { content: { 'text/event-stream': {} } } } } } } }), { status: 200 })
        : (() => { throw new Error('stream endpoint must not be called'); })(),
    });
    assert.equal(report.results[0].reason, 'STREAMING_RESPONSE_EXCLUDED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects non-loopback or alternate-port base URLs before credential lookup or fetch', async () => {
  const root = await fixtureRepo();
  try {
    await assert.rejects(() => runCustomReadSweep({ repoRoot: root, inventory: inventory([]), revision: 'x', execute: true, baseUrl: 'https://example.com:8010' }), /http/);
    await assert.rejects(() => runCustomReadSweep({ repoRoot: root, inventory: inventory([]), revision: 'x', execute: true, baseUrl: 'http://127.0.0.1:8011' }), /8010/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('blocks a live operationId mismatch before the endpoint call', async () => {
  const root = await fixtureRepo();
  const input = inventory([{ id: 'get-ready', sourceId: 'GET /ready' }]);
  const calls = [];
  try {
    const report = await runCustomReadSweep({
      repoRoot: root, inventory: input, runtimeBaseline: runtimeBaseline(input), revision: 'abc123',
      execute: true, bearer: null, rateMs: 0,
      fetchFn: async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ paths: { '/ready': { get: { operationId: 'unexpected-live-id', responses: { 200: { content: { 'application/json': {} } } } } } } }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(report.results[0].expected_operation_id, 'op:get-ready');
    assert.equal(report.results[0].reason, 'RUNTIME_OPERATION_ID_MISMATCH');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('blocks GETs when the frozen identity baseline HEAD or exact membership differs', async () => {
  const root = await fixtureRepo();
  const input = inventory([{ id: 'get-ready', sourceId: 'GET /ready' }]);
  try {
    const wrongHead = await buildCustomReadPlan({ repoRoot: root, inventory: input, revision: 'abc123', runtimeBaseline: runtimeBaseline(input, 'other-head') });
    assert.equal(wrongHead.results[0].reason, 'RUNTIME_IDENTITY_BASELINE_HEAD_MISMATCH');
    const missingRoute = runtimeBaseline(input);
    missingRoute.reconciliation.other_runtime_api.routes = [];
    const wrongMembership = await buildCustomReadPlan({ repoRoot: root, inventory: input, revision: 'abc123', runtimeBaseline: missingRoute });
    assert.equal(wrongMembership.results[0].reason, 'RUNTIME_IDENTITY_BASELINE_MEMBERSHIP_MISMATCH');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
