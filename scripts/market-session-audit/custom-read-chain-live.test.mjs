import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runCustomReadChainLive } from './custom-read-chain-live.mjs';

function responseWithUrl(body, init, url = '') {
  const response = new Response(body, init);
  if (url) Object.defineProperty(response, 'url', { value: url });
  return response;
}

test('invalid base and missing token fail before metadata or business fetch', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'athena-chain-live-auth-'));
  let reads = 0;
  let fetches = 0;
  try {
    await assert.rejects(() => runCustomReadChainLive({
      execute: true, baseUrl: 'https://example.com:8010', outputDir: dir,
      readBearerFn: async () => { reads += 1; return 'private'; },
      fetchFn: async () => { fetches += 1; },
    }), /http/);
    assert.equal(reads, 0);
    assert.equal(fetches, 0);
    const error = await runCustomReadChainLive({
      execute: true, outputDir: dir, readBearerFn: async () => null,
      fetchFn: async () => { fetches += 1; },
    }).then(() => null, (caught) => caught);
    assert.equal(error.code, 'AUTH_UNAVAILABLE');
    assert.equal(fetches, 0);
    const marker = await readFile(error.outputPath, 'utf8');
    assert.equal(marker.includes('AUTH_UNAVAILABLE'), true);
    assert.equal(marker.includes('private'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('OpenAPI redirect, non-JSON, and 8 MiB oversize failures issue zero business requests', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'athena-chain-live-openapi-'));
  const cases = [
    () => responseWithUrl('{"private-openapi-body":true}', { status: 200, headers: { 'content-type': 'application/json' } }, 'http://127.0.0.1:8010/different'),
    () => responseWithUrl('private-openapi-body', { status: 200, headers: { 'content-type': 'text/plain' } }),
    () => responseWithUrl(JSON.stringify({ private: `private-openapi-body${'x'.repeat(8 * 1024 * 1024)}` }), { status: 200, headers: { 'content-type': 'application/json' } }),
  ];
  try {
    for (const makeResponse of cases) {
      let metadata = 0;
      let business = 0;
      const error = await runCustomReadChainLive({
        execute: true,
        outputDir: dir,
        readBearerFn: async () => 'private-token',
        fetchFn: async () => { metadata += 1; return makeResponse(); },
        runChainFn: async () => { business += 1; },
      }).then(() => null, (caught) => caught);
      assert.ok(error?.code);
      assert.equal(metadata, 1);
      assert.equal(business, 0);
      const marker = await readFile(error.outputPath, 'utf8');
      for (const forbidden of ['private-token', 'private-openapi-body']) assert.equal(marker.includes(forbidden), false);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('valid OpenAPI above the former 1 MB cap reaches the business preflight once', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'athena-chain-live-expanded-'));
  const rawOpenApi = `private-openapi-body${'x'.repeat(1_100_000)}`;
  let business = 0;
  try {
    const { outputPath } = await runCustomReadChainLive({
      execute: true,
      outputDir: dir,
      readBearerFn: async () => 'private-token',
      fetchFn: async () => responseWithUrl(JSON.stringify({ openapi: '3.1.0', info: { description: rawOpenApi }, paths: {} }), { status: 200, headers: { 'content-type': 'application/json' } }),
      runChainFn: async () => {
        business += 1;
        return { mode: 'loopback_live', request_count: 0, summary: { total: 20, attempted: 0 }, results: [] };
      },
    });
    assert.equal(business, 1);
    const persisted = await readFile(outputPath, 'utf8');
    for (const forbidden of ['private-token', 'private-openapi-body']) assert.equal(persisted.includes(forbidden), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('OpenAPI timeout covers a body that stalls after headers', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'athena-chain-live-stall-'));
  let business = 0;
  try {
    await assert.rejects(() => runCustomReadChainLive({
      execute: true,
      outputDir: dir,
      openApiTimeoutMs: 25,
      readBearerFn: async () => 'private-token',
      fetchFn: async () => responseWithUrl(new ReadableStream({ start() {} }), { status: 200, headers: { 'content-type': 'application/json' } }),
      runChainFn: async () => { business += 1; },
    }), (error) => error.code === 'OPENAPI_TIMEOUT');
    assert.equal(business, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('artifact preparation failure prevents credential and network access', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'athena-chain-live-prepare-'));
  const fileAsDirectory = path.join(dir, 'occupied');
  await writeFile(fileAsDirectory, 'occupied', 'utf8');
  let reads = 0;
  let fetches = 0;
  try {
    await assert.rejects(() => runCustomReadChainLive({
      execute: true,
      outputDir: fileAsDirectory,
      readBearerFn: async () => { reads += 1; return 'private-token'; },
      fetchFn: async () => { fetches += 1; },
    }), (error) => error.code === 'ARTIFACT_PREPARATION_FAILED');
    assert.equal(reads, 0);
    assert.equal(fetches, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('valid OpenAPI is passed once with the same in-memory bearer and only sanitized report is persisted', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'athena-chain-live-valid-'));
  const token = 'private-live-token';
  const rawOpenApi = 'private-openapi-description';
  let chainCalls = 0;
  try {
    const { artifact, outputPath } = await runCustomReadChainLive({
      execute: true,
      outputDir: dir,
      timestamp: new Date('2026-09-07T01:30:00Z'),
      readBearerFn: async () => token,
      fetchFn: async (_url, init) => {
        assert.equal(init.method, 'GET');
        assert.equal(init.redirect, 'error');
        assert.equal(init.credentials, 'omit');
        assert.equal(init.headers.Authorization, `Bearer ${token}`);
        return responseWithUrl(JSON.stringify({ openapi: '3.1.0', info: { description: rawOpenApi }, paths: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
      runChainFn: async (options) => {
        chainCalls += 1;
        assert.equal(options.bearer, token);
        assert.equal(options.openapi.info.description, rawOpenApi);
        assert.equal(options.timeoutMs, 5_000);
        assert.equal(options.maxRequests, 32);
        assert.equal(options.maxDurationMs, 60_000);
        return { mode: 'loopback_live', request_count: 4, summary: { total: 20, attempted: 4 }, results: [{ id: 'safe-id', verdict: 'BLOCKED' }] };
      },
    });
    assert.equal(chainCalls, 1);
    assert.equal(artifact.entrypoint.metadata_request_count, 1);
    assert.equal(artifact.entrypoint.business_request_count, 4);
    const persisted = await readFile(outputPath, 'utf8');
    for (const forbidden of [token, rawOpenApi]) assert.equal(persisted.includes(forbidden), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('final artifact write failure preserves a sanitized marker in the reserved file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'athena-chain-live-write-'));
  const token = 'private-live-token';
  const rawOpenApi = 'private-openapi-description';
  try {
    const error = await runCustomReadChainLive({
      execute: true,
      outputDir: dir,
      readBearerFn: async () => token,
      fetchFn: async () => responseWithUrl(JSON.stringify({ openapi: '3.1.0', info: { description: rawOpenApi }, paths: {} }), { status: 200, headers: { 'content-type': 'application/json' } }),
      runChainFn: async () => ({ mode: 'loopback_live', request_count: 4, summary: { total: 20, attempted: 4 }, results: [] }),
      writeArtifactFn: async () => { throw new Error('raw private write error'); },
    }).then(() => null, (caught) => caught);
    assert.equal(error.code, 'ARTIFACT_WRITE_FAILED');
    const markerText = await readFile(error.outputPath, 'utf8');
    const marker = JSON.parse(markerText);
    assert.equal(marker.kind, 'custom_read_chain_live_failure');
    assert.equal(marker.reason, 'ARTIFACT_WRITE_FAILED');
    assert.equal(marker.metadata_request_count, 1);
    assert.equal(marker.business_request_count, 4);
    for (const forbidden of [token, rawOpenApi, 'raw private write error']) assert.equal(markerText.includes(forbidden), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('explicit execute is mandatory', async () => {
  await assert.rejects(() => runCustomReadChainLive({ execute: false }), (error) => error.code === 'EXPLICIT_EXECUTE_REQUIRED');
});
