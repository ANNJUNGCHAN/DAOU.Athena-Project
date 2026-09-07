import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverRuntime, extractRuntimeRoutes, reconcileRoutes } from './runtime-discovery.mjs';

test('extractRuntimeRoutes keeps only method/path/operationId identities and exposes duplicates', () => {
  const routes = extractRuntimeRoutes({
    info: { title: 'must not persist' },
    paths: {
      '/api/v1/tr/stock/x': { post: { operationId: 'generated_x', requestBody: { secret: 'no' } }, parameters: [] },
      '/health': { get: { operationId: 'health', description: 'raw schema text' } },
    },
  });
  assert.deepEqual(routes, [
    { method: 'GET', path: '/health', operation_id: 'health' },
    { method: 'POST', path: '/api/v1/tr/stock/x', operation_id: 'generated_x' },
  ]);
  assert.equal(JSON.stringify(routes).includes('must not persist'), false);
  assert.equal(JSON.stringify(routes).includes('raw schema text'), false);
});

test('reconcileRoutes separates generated TR, computes bidirectional method/path diffs, and excludes WebSocket', () => {
  const result = reconcileRoutes([
    { method: 'POST', path: '/api/v1/tr/stock/x', operation_id: 'generated_x' },
    { method: 'GET', path: '/health', operation_id: 'health' },
    { method: 'GET', path: '/runtime-only', operation_id: 'runtime_only' },
    { method: 'GET', path: '/runtime-only', operation_id: 'runtime_only_duplicate' },
  ], [
    { method: 'GET', path: '/health', source_path: 'main.py' },
    { method: 'POST', path: '/static-only', source_path: 'api/x.py' },
    { method: 'WEBSOCKET', path: '/api/v1/ws/x', source_path: 'api/ws.py' },
  ], [
    { method: 'POST', path: '/api/v1/tr/stock/x', operation_id: 'generated_x' },
  ]);
  assert.equal(result.generated_api.count, 1);
  assert.equal(result.generated_api.expected_static_count, 1);
  assert.equal(result.generated_tr.count, 1);
  assert.deepEqual(result.diff.static_only, ['POST /static-only']);
  assert.deepEqual(result.diff.runtime_only, ['GET /runtime-only']);
  assert.deepEqual(result.other_runtime_api.duplicate_route_ids, ['GET /runtime-only']);
  assert.equal(result.static_websocket_excluded.status, 'NOT_APPLICABLE');
  assert.equal(result.diff.verdict, 'NOT_VERIFIED');
  assert.equal(result.diff.absence_cause, 'UNDETERMINED');
});

test('discoverRuntime performs one safe GET and persists no bearer or raw schema', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'athena-runtime-discovery-'));
  const token = 'never-persist-token';
  const calls = [];
  try {
    const { artifact, outputPath } = await discoverRuntime({
      repoRoot: dir,
      outputRoot: dir,
      now: new Date('2026-09-07T00:00:00Z'),
      bearer: token,
      gitHeadFn: async () => 'abc123',
      inventory: {
        items: [
          { source: 'custom_api_route', source_id: 'GET /health', source_path: 'main.py' },
          { source: 'custom_api_route', source_id: 'WEBSOCKET /api/v1/ws/x', source_path: 'ws.py' },
        ],
      },
      generatedRows: [],
      fetchFn: async (url, init) => {
        calls.push({ url: String(url), ...init });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            info: { description: 'sensitive raw description' },
            paths: { '/health': { get: { operationId: 'health', description: 'raw detail' } } },
          }),
        };
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].redirect, 'error');
    assert.equal(calls[0].credentials, 'omit');
    assert.equal(calls[0].headers.Authorization, `Bearer ${token}`);
    assert.equal(artifact.mcp_tools_list.status, 'NOT_VERIFIED');
    const persisted = await readFile(outputPath, 'utf8');
    for (const forbidden of [token, 'sensitive raw description', 'raw detail']) {
      assert.equal(persisted.includes(forbidden), false);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
