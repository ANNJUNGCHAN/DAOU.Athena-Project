import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPERATIONS, STRATEGY_SOURCE, STRATEGY_YAML, parseArgs, runProbe, validateOpenApi } from './custom-compute-probe.mjs';

function openApi() {
  return { paths: Object.fromEntries(OPERATIONS.map(op => [op.route, { post: { operationId: op.operationId, requestBody: { content: { 'application/json': { schema: { additionalProperties: true, type: 'object', title: 'Body' } } } } } }])) };
}

const graph = { graph_version: '1', nodes: [{ id: 'param-fast' }], edges: [] };
function bodyFor(id) {
  const bodies = {
    backtest_validate: { ok: true, errors: [] },
    backtest_flow: { nodes: [{ stage: 'prepare' }], params: ['fast'], app_after: [] },
    backtest_map: { source_kind: 'spec', nodes: [{ id: 'params' }], code: { matches_map: true } },
    backtest_codegen: { source: 'def signals(df, p):\n    return df', lines: 2 },
    backtest_diagnose: { line: 10, why: 'fixture diagnosis', suggestion: { new_source: 'safe candidate' } },
    backtest_optimize_plan: { combinations: 6, max_combinations: 10000, over_limit: false, values_per_param: { fast: 4, slow: 4 } },
    technique_nodes: { granularity: 'stage', nodes: [{ id: 'prepare' }], flows: {}, error: null },
    visual_from_spec: { graph, hashes: { graph_hash: 'a'.repeat(64), compiler_version: 'test' } },
    visual_validate: { valid: true, diagnostics: [], hashes: { graph_hash: 'a'.repeat(64) } },
    visual_compile: { executable: true, saved: false, source: 'def signals(df, p): pass', source_map: { kind: 'authoritative' }, hashes: { graph_hash: 'a'.repeat(64) } },
    visual_question: { question: null },
    visual_patch: { applied: false, graph_patch: [{ op: 'replace', path: '/nodes/0', value: {} }], patch_id: 'patch-fixture' },
  };
  return bodies[id];
}

function fake(options = {}) {
  const calls = [];
  const byPath = new Map(OPERATIONS.map(op => [op.route, op]));
  const fetchImpl = async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    calls.push({ pathname, init });
    if (pathname === '/openapi.json') return new Response(JSON.stringify(options.openapi || openApi()), { status: 200 });
    const op = byPath.get(pathname);
    if (!op) throw new Error(`unexpected ${pathname}`);
    if (options.authAt === op.id) return new Response('{}', { status: 401 });
    return new Response(JSON.stringify(options.bodyAt?.[op.id] ?? bodyFor(op.id)), { status: options.statusAt?.[op.id] || 200 });
  };
  return { fetchImpl, calls };
}

const REGULAR_AT = new Date('2026-09-07T05:30:00Z');
const opts = { execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, requestTimeoutMs: 1000, overallTimeoutMs: 10000, now: REGULAR_AT };

test('scope is exactly twelve side-effect-free compute POST routes', () => {
  assert.equal(OPERATIONS.length, 12);
  assert.ok(OPERATIONS.length <= 16);
  assert.equal(new Set(OPERATIONS.map(op => op.route)).size, 12);
  assert.ok(OPERATIONS.every(op => op.route.startsWith('/api/v1/backtest/')));
  assert.ok(OPERATIONS.every(op => !/\/runs|\/optimize$|\/data\/backfill|\/strategies|\/deployments|\/canvas|\/order/.test(op.route)));
});

test('OpenAPI path, sole method, operation ID, and generic body schema are exact', () => {
  validateOpenApi(openApi());
  const drift = openApi();
  drift.paths[OPERATIONS[0].route].get = {};
  assert.throws(() => validateOpenApi(drift), /OpenAPI contract mismatch/);
  const schemaDrift = openApi();
  schemaDrift.paths[OPERATIONS[1].route].post.requestBody.content['application/json'].schema.required = ['source'];
  assert.throws(() => validateOpenApi(schemaDrift), /OpenAPI contract mismatch/);
});

test('dry run performs zero network and credential reads', async () => {
  let fetches = 0;
  let tokens = 0;
  const report = await runProbe({ ...opts, execute: false }, { fetchImpl: async () => { fetches += 1; }, tokenReader: () => { tokens += 1; } });
  assert.deepEqual([fetches, tokens], [0, 0]);
  assert.equal(report.summary.targetCount, 12);
  assert.equal(report.results.every(row => row.reason === 'DRY_RUN'), true);
});

test('successful probe exercises all compute routes with semantic checks and sanitized evidence', async () => {
  const transport = fake();
  const report = await runProbe(opts, { ...transport, tokenReader: () => 'private-token', revision: 'test', clock: () => REGULAR_AT });
  assert.equal(report.summary.attempted, 12);
  assert.equal(report.summary.pass, 12);
  assert.equal(report.summary.businessRequests, 12);
  assert.equal(report.summary.metadataRequests, 1);
  const posts = transport.calls.filter(call => call.init.method === 'POST');
  assert.equal(posts.length, 12);
  assert.ok(posts.every(call => call.init.headers.Authorization === 'Bearer private-token'));
  const mapPayload = JSON.parse(posts.find(call => call.pathname.endsWith('/backtest/map')).init.body);
  assert.equal(Object.hasOwn(mapPayload, 'run_id'), false);
  const patchPayload = JSON.parse(posts.find(call => call.pathname.endsWith('/visual/patch')).init.body);
  assert.equal(patchPayload.intent.ops[0].kind, 'set_param');
  assert.equal(Object.hasOwn(patchPayload, 'base_version_id'), false);
  assert.ok(report.results.every(row => row.attemptedAt && row.marketPhase?.phase === 'REGULAR'));
  const serialized = JSON.stringify(report);
  for (const secret of ['private-token', STRATEGY_YAML, STRATEGY_SOURCE, 'df.close - df.atr', 'safe candidate']) assert.ok(!serialized.includes(secret));
  assert.equal(report.fixture.rawFixturePersisted, false);
  assert.equal(report.fixture.marketDataIncluded, false);
});

test('injected per-call clock preserves closing and post-close phase evidence', async () => {
  for (const [instant, expectedPhase] of [
    ['2026-09-07T06:25:00Z', 'CLOSING_AUCTION'],
    ['2026-09-07T06:35:00Z', 'POSTCLOSE'],
  ]) {
    const transport = fake();
    const report = await runProbe(opts, { ...transport, tokenReader: () => 'token', revision: 'test', clock: () => new Date(instant) });
    assert.equal(report.summary.pass, 12);
    assert.ok(report.results.every(row => row.marketPhase?.phase === expectedPhase));
  }
});

test('semantic mismatch blocks only the observed route without persisting response content', async () => {
  const transport = fake({ bodyAt: { backtest_diagnose: { why: 'private response without required shape' } } });
  const report = await runProbe(opts, { ...transport, tokenReader: () => 'token', revision: 'test' });
  const row = report.results.find(item => item.operationId === 'backtest_diagnose');
  assert.equal(row.verdict, 'BLOCKED');
  assert.equal(row.reason, 'HTTP_OR_SEMANTIC_CONTRACT_FAILURE');
  assert.ok(!JSON.stringify(report).includes('private response'));
});

test('authentication failure stops every subsequent compute POST', async () => {
  const transport = fake({ authAt: 'backtest_codegen' });
  const report = await runProbe(opts, { ...transport, tokenReader: () => 'token', revision: 'test' });
  assert.equal(transport.calls.filter(call => call.init.method === 'POST').length, 4);
  assert.equal(report.results.find(row => row.operationId === 'backtest_codegen').reason, 'AUTH_FAILURE');
  assert.equal(report.results.filter(row => row.reason === 'AUTH_FAILURE_NOT_ATTEMPTED').length, 8);
});

test('non-JSON and oversized authentication failures stop before response parsing', async () => {
  for (const response of [
    new Response('not-json', { status: 401, headers: { 'content-type': 'text/plain' } }),
    new Response('x', { status: 403, headers: { 'content-length': String(1024 * 1024 + 1) } }),
  ]) {
    const transport = fake();
    let returnedAuth = false;
    const fetchImpl = async (url, init) => {
      if (init?.method === 'POST' && !returnedAuth) { returnedAuth = true; return response; }
      return transport.fetchImpl(url, init);
    };
    const report = await runProbe(opts, { fetchImpl, tokenReader: () => 'token', revision: 'test' });
    assert.equal(report.summary.businessRequests, 1);
    assert.equal(report.results[0].reason, 'AUTH_FAILURE');
    assert.equal(report.results.filter(row => row.reason === 'AUTH_FAILURE_NOT_ATTEMPTED').length, 11);
  }
});

test('visual results remain bound to the canonical graph hash and nonempty patch ID', async () => {
  const mismatch = fake({ bodyAt: {
    visual_validate: { ...bodyFor('visual_validate'), hashes: { graph_hash: 'b'.repeat(64) } },
    visual_compile: { ...bodyFor('visual_compile'), hashes: { graph_hash: 'b'.repeat(64) } },
    visual_patch: { ...bodyFor('visual_patch'), patch_id: '' },
  } });
  const report = await runProbe(opts, { ...mismatch, tokenReader: () => 'token', revision: 'test' });
  for (const id of ['visual_validate', 'visual_compile', 'visual_patch']) {
    assert.equal(report.results.find(row => row.operationId === id).verdict, 'BLOCKED');
  }

  const empty = fake({ bodyAt: { visual_from_spec: { graph, hashes: { graph_hash: '' } } } });
  const emptyReport = await runProbe(opts, { ...empty, tokenReader: () => 'token', revision: 'test' });
  assert.equal(emptyReport.results.find(row => row.operationId === 'visual_from_spec').verdict, 'BLOCKED');
  assert.equal(emptyReport.results.filter(row => row.reason === 'VISUAL_GRAPH_DEPENDENCY_MISSING').length, 4);
});

test('unsafe base and OpenAPI drift fail before credential or business access', async () => {
  let tokens = 0;
  await assert.rejects(runProbe({ ...opts, baseUrl: 'http://127.0.0.1:8010/api/v1/order' }, { tokenReader: () => { tokens += 1; } }), /base URL/);
  const drift = openApi();
  drift.paths[OPERATIONS[0].route].post.operationId = 'wrong';
  const transport = fake({ openapi: drift });
  await assert.rejects(runProbe(opts, { ...transport, tokenReader: () => { tokens += 1; return 'token'; } }), /OpenAPI contract mismatch/);
  assert.equal(tokens, 0);
  assert.equal(transport.calls.filter(call => call.init.method === 'POST').length, 0);
});

test('OpenAPI and business response size limits fail closed without persisting bodies', async () => {
  let tokens = 0;
  const hugeMetadata = async () => new Response('{}', { status: 200, headers: { 'content-length': String(8 * 1024 * 1024 + 1) } });
  await assert.rejects(runProbe(opts, { fetchImpl: hugeMetadata, tokenReader: () => { tokens += 1; return 'token'; } }), /RESPONSE_SIZE_LIMIT_EXCEEDED/);
  assert.equal(tokens, 0);
  const transport = fake();
  const fetchImpl = async (url, init) => {
    if (init?.method === 'POST') return new Response('{"private":"body"}', { status: 200, headers: { 'content-length': String(1024 * 1024 + 1) } });
    return transport.fetchImpl(url, init);
  };
  const report = await runProbe(opts, { fetchImpl, tokenReader: () => 'token', revision: 'test' });
  assert.equal(report.results.every(row => row.verdict === 'BLOCKED'), true);
  assert.equal(report.results.filter(row => row.reason === 'RESPONSE_SIZE_LIMIT_EXCEEDED').length, 8);
  assert.equal(report.results.filter(row => row.reason === 'VISUAL_GRAPH_DEPENDENCY_MISSING').length, 4);
  assert.ok(!JSON.stringify(report).includes('private'));
});

test('CLI limits and dry-run artifact remain private and revision-bound', async () => {
  assert.throws(() => parseArgs(['--execute', '--now', '2026-09-07T00:00:00Z']), /forbidden/);
  assert.throws(() => parseArgs(['--request-timeout-ms', '5001']), /between 1 and 5000/);
  assert.throws(() => parseArgs(['--overall-timeout-ms', '60001']), /between 1 and 60000/);
  const dir = await mkdtemp(path.join(tmpdir(), 'athena-compute-probe-'));
  try {
    const script = fileURLToPath(new URL('./custom-compute-probe.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [script, '--output-dir', dir, '--now', '2026-09-07T05:30:00Z'], { encoding: 'utf8', env: { ...process.env, ATHENA_LOCAL_BEARER_TOKEN: 'must-not-read' } });
    assert.equal(run.status, 0, run.stderr);
    const files = await readdir(dir);
    assert.equal(files.length, 1);
    const artifact = await readFile(path.join(dir, files[0]), 'utf8');
    assert.match(JSON.parse(artifact).revision, /^[0-9a-f]{40}$/);
    assert.ok(!artifact.includes('must-not-read'));
    assert.ok(!artifact.includes(STRATEGY_SOURCE));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('implementation has hard request cap and no execution or persistence route literal', async () => {
  const code = await readFile(new URL('./custom-compute-probe.mjs', import.meta.url), 'utf8');
  assert.match(code, /const MAX_BUSINESS = 16/);
  assert.doesNotMatch(code, /['"]\/api\/v1\/(?:order|canvas)|['"]\/api\/v1\/backtest\/(?:runs|optimize|data\/backfill|strategies|deployments)['"]/);
  assert.doesNotMatch(code, /X-Athena-Confirm|Idempotency-Key/);
});
