import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildChainPlan, loadSources, parseArgs, runChain, validateOpenApi } from './read-input-chain.mjs';

const clone = value => structuredClone(value);

async function realSources() { return loadSources(); }

function openApiFor(plan) {
  const paths = {};
  for (const chain of plan.chains) {
    for (const op of [{ trId: chain.sourceTrId, route: chain.route, payload: chain.payload }, ...chain.targets]) {
      const payload = op.payload || op.basePayload || {};
      const required = [...Object.keys(payload), ...(op.dependencyField ? [op.dependencyField] : [])];
      paths[op.route.path] = { post: { operationId: op.route.operationId, 'x-kiwoom-tr-id': op.trId, requestBody: { content: { 'application/json': { schema: { required } } } } } };
    }
  }
  return { paths };
}

function sourceBody(operationRef, empty = false) {
  if (operationRef === 'base:ka01300') return { return_code: '0', nofi: empty ? [] : [{ gcod: 'A01' }] };
  if (operationRef === 'base:ka10102') return { return_code: '0', list: empty ? [] : [{ code: 'B02' }] };
  if (operationRef === 'base:ka40007') return { return_code: '0', etfobjt_idex_cd: empty ? '' : 'C03' };
  return { return_code: '0', thema_grp: empty ? [] : [{ thema_grp_cd: 'D00004' }] };
}

function targetBody(target) {
  const root = target.responseRoots[0];
  return { return_code: '0', [root]: [] };
}

test('real source contracts resolve exactly four sources and seven targets', async () => {
  const plan = buildChainPlan(await realSources(), new Date('2026-09-07T01:00:00Z'));
  assert.equal(plan.chains.length, 4);
  assert.equal(plan.chains.reduce((sum, chain) => sum + chain.targets.length, 0), 7);
  assert.deepEqual(plan.chains.map(chain => chain.sourceRef), ['base:ka01300', 'base:ka10102', 'base:ka40007', 'base:ka90001']);
});

test('source path and target field contract drift fail closed', async () => {
  const sources = await realSources();
  const pathDrift = clone(sources);
  const def = pathDrift.definitions.definitions.find(item => item.operation_ref === 'base:ka01300');
  def.data.containers[0].fields.find(field => field.alias === 'gcod').path = '$.wrong[*].gcod';
  assert.throws(() => buildChainPlan(pathDrift), /source response path contract mismatch/);

  const fieldDrift = clone(sources);
  const op = (Array.isArray(fieldDrift.inventory) ? fieldDrift.inventory : fieldDrift.inventory.operations).find(item => item.id === 'ka01301');
  op.req_body.find(field => String(field.element).includes('arn_grp_id')).length = '4';
  assert.throws(() => buildChainPlan(fieldDrift), /target field contract mismatch/);
});

test('unsafe route and OpenAPI required-field drift fail closed', async () => {
  const sources = await realSources();
  const unsafe = clone(sources);
  unsafe.manifest.mappings.find(item => item.operation_ref === 'base:ka01300').route.path = '/api/v1/order/ka01300';
  assert.throws(() => buildChainPlan(unsafe), /source contract mismatch|unsafe source route|unsafe read_display route/);

  const plan = buildChainPlan(sources);
  const spec = openApiFor(plan);
  spec.paths['/api/v1/tr/watchlist/ka01301'].post.requestBody.content['application/json'].schema.required.push('invented');
  assert.throws(() => validateOpenApi(spec, plan), /OpenAPI required fields mismatch/);
  const removed = openApiFor(plan);
  removed.paths['/api/v1/tr/watchlist/ka01301'].post.requestBody.content['application/json'].schema.required = [];
  assert.throws(() => validateOpenApi(removed, plan), /OpenAPI required fields mismatch|dependency field missing/);
});

test('traversal, query, fragment, percent encoding, and backslash route mutations fail before fetch or credential access', async () => {
  const mutations = [
    '/api/v1/tr/../order/ka01300',
    '/api/v1/tr/watchlist/ka01300?next=/order',
    '/api/v1/tr/watchlist/ka01300#fragment',
    '/api/v1/tr/watchlist/%6b%61%30%31%33%30%30',
    '/api/v1/tr\\watchlist\\ka01300',
  ];
  for (const route of mutations) {
    const sources = clone(await realSources());
    sources.manifest.mappings.find(item => item.operation_ref === 'base:ka01300').route.path = route;
    let fetches = 0;
    let tokenReads = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { fetches += 1; throw new Error('must not fetch'); };
    try {
      await assert.rejects(runChain({ execute: true, baseUrl: 'http://127.0.0.1:8010' }, sources, { tokenReader: () => { tokenReads += 1; return 'token'; } }), /unsafe|route/);
      assert.equal(fetches, 0);
      assert.equal(tokenReads, 0);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test('missing manifest operation ID fails before fetch or credential access', async () => {
  const sources = clone(await realSources());
  delete sources.manifest.mappings.find(item => item.operation_ref === 'base:ka01300').route.operation_id;
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  let tokenReads = 0;
  globalThis.fetch = async () => { fetches += 1; throw new Error('must not fetch'); };
  try {
    await assert.rejects(runChain({ execute: true, baseUrl: 'http://127.0.0.1:8010' }, sources, { tokenReader: () => { tokenReads += 1; return 'token'; } }), /unsafe exact route/);
    assert.equal(fetches, 0);
    assert.equal(tokenReads, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('dry run performs zero network and zero token reads', async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  let tokenReads = 0;
  globalThis.fetch = async () => { fetches += 1; throw new Error('must not fetch'); };
  try {
    const report = await runChain({ execute: false, baseUrl: 'http://127.0.0.1:8010', now: new Date('2026-09-07T01:00:00Z') }, await realSources(), { tokenReader: () => { tokenReads += 1; return 'x'; }, revision: 'test' });
    assert.equal(report.summary.notRun, 11);
    assert.equal(fetches, 0);
    assert.equal(tokenReads, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('CLI dry run writes only a sanitized report into an audit-owned temp directory', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'athena-read-input-chain-test-'));
  try {
    const result = spawnSync(process.execPath, [new URL('./read-input-chain.mjs', import.meta.url).pathname.slice(1), '--output-dir', outputDir, '--now', '2026-09-07T01:00:00Z'], {
      encoding: 'utf8',
      env: { ...process.env, ATHENA_BACKEND_URL: 'http://127.0.0.1:8010', ATHENA_LOCAL_BEARER_TOKEN: 'fixture-token-must-not-be-read' },
    });
    assert.equal(result.status, 0, result.stderr);
    const files = await readdir(outputDir);
    assert.equal(files.length, 1);
    const report = await readFile(path.join(outputDir, files[0]), 'utf8');
    assert.equal(JSON.parse(report).summary.notRun, 11);
    assert.ok(!report.includes('fixture-token-must-not-be-read'));
    assert.ok(!result.stdout.includes('fixture-token-must-not-be-read'));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('invalid base URL is rejected before network and token access', async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  let tokenReads = 0;
  globalThis.fetch = async () => { fetches += 1; throw new Error('must not fetch'); };
  try {
    await assert.rejects(runChain({ execute: true, baseUrl: 'https://127.0.0.1:8010' }, await realSources(), { tokenReader: () => { tokenReads += 1; return 'x'; } }), /loopback/);
    assert.equal(fetches, 0);
    assert.equal(tokenReads, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('successful chain attempts four sources and seven targets without persisting derived values', async () => {
  const sources = await realSources();
  const plan = buildChainPlan(sources, new Date('2026-09-07T01:00:00Z'));
  const openapi = openApiFor(plan);
  const sourceByPath = new Map(plan.chains.map(chain => [chain.route.path, chain]));
  const targetByPath = new Map(plan.chains.flatMap(chain => chain.targets.map(target => [target.route.path, target])));
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify(openapi), { status: 200 });
    const pathname = new URL(url).pathname;
    bodies.push(JSON.parse(options.body));
    const chain = sourceByPath.get(pathname);
    return new Response(JSON.stringify(chain ? sourceBody(chain.sourceRef) : targetBody(targetByPath.get(pathname))), { status: 200 });
  };
  try {
    const report = await runChain({ execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, requestTimeoutMs: 1000, overallTimeoutMs: 10000, now: new Date('2026-09-07T01:00:00Z') }, sources, { tokenReader: () => 'test-token', revision: 'test' });
    assert.equal(report.summary.businessRequestCount, 11);
    assert.equal(report.summary.attempted, 11);
    assert.equal(report.summary.pass, 11);
    assert.equal(report.results.filter(item => item.reason === 'PASS_HTTP_JSON_DECLARED_ROOT_PRESENT').length, 7);
    const serialized = JSON.stringify(report);
    for (const value of ['A01', 'B02', 'C03', 'D00004', 'test-token']) assert.ok(!serialized.includes(value));
    assert.ok(bodies.some(body => body.arn_grp_id === 'A01'));
    assert.ok(bodies.some(body => body.etfobjt_idex_cd === 'C03'));
  } finally { globalThis.fetch = originalFetch; }
});

test('empty dependency blocks only its dependents and never invents an identifier', async () => {
  const sources = await realSources();
  const plan = buildChainPlan(sources);
  const sourceByPath = new Map(plan.chains.map(chain => [chain.route.path, chain]));
  const targetByPath = new Map(plan.chains.flatMap(chain => chain.targets.map(target => [target.route.path, target])));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify(openApiFor(plan)), { status: 200 });
    const chain = sourceByPath.get(new URL(url).pathname);
    return new Response(JSON.stringify(chain ? sourceBody(chain.sourceRef, chain.sourceRef === 'base:ka10102') : targetBody(targetByPath.get(new URL(url).pathname))), { status: 200 });
  };
  try {
    const report = await runChain({ execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, requestTimeoutMs: 1000, overallTimeoutMs: 10000 }, sources, { tokenReader: () => 'token', revision: 'test' });
    assert.equal(report.summary.businessRequestCount, 7);
    assert.equal(report.results.filter(item => item.reason === 'BLOCKED_SOURCE_VALUE_NOT_AVAILABLE').length, 4);
    assert.equal(report.results.filter(item => item.operationRef.startsWith('base:ka100') && item.attempted).length, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('authentication failure stops every subsequent business request', async () => {
  const sources = await realSources();
  const plan = buildChainPlan(sources);
  const originalFetch = globalThis.fetch;
  let business = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify(openApiFor(plan)), { status: 200 });
    business += 1;
    return new Response(JSON.stringify({ detail: 'do not persist this message' }), { status: 401 });
  };
  try {
    const report = await runChain({ execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, requestTimeoutMs: 1000, overallTimeoutMs: 10000 }, sources, { tokenReader: () => 'token', revision: 'test' });
    assert.equal(business, 1);
    assert.equal(report.summary.businessRequestCount, 1);
    assert.equal(report.results.filter(item => item.reason === 'BLOCKED_AUTH_NOT_ATTEMPTED').length, 10);
    assert.ok(!JSON.stringify(report).includes('do not persist'));
  } finally { globalThis.fetch = originalFetch; }
});

test('injected lower request budget proves the hard stop without raising the production cap', async () => {
  const sources = await realSources();
  const plan = buildChainPlan(sources);
  const sourceByPath = new Map(plan.chains.map(chain => [chain.route.path, chain]));
  const targetByPath = new Map(plan.chains.flatMap(chain => chain.targets.map(target => [target.route.path, target])));
  const originalFetch = globalThis.fetch;
  let business = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify(openApiFor(plan)), { status: 200 });
    business += 1;
    const pathname = new URL(url).pathname;
    const chain = sourceByPath.get(pathname);
    return new Response(JSON.stringify(chain ? sourceBody(chain.sourceRef) : targetBody(targetByPath.get(pathname))), { status: 200 });
  };
  try {
    await assert.rejects(runChain({ execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, requestTimeoutMs: 1000, overallTimeoutMs: 10000 }, sources, { tokenReader: () => 'token', requestLimit: 5, revision: 'test' }), /REQUEST_BUDGET_EXCEEDED/);
    assert.equal(business, 5);
  } finally { globalThis.fetch = originalFetch; }
});

test('report redacts provider bodies, cursors, account-like fields, and dependency values', async () => {
  const sources = await realSources();
  const plan = buildChainPlan(sources);
  const sourceByPath = new Map(plan.chains.map(chain => [chain.route.path, chain]));
  const targetByPath = new Map(plan.chains.flatMap(chain => chain.targets.map(target => [target.route.path, target])));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify(openApiFor(plan)), { status: 200 });
    const chain = sourceByPath.get(new URL(url).pathname);
    const body = chain ? sourceBody(chain.sourceRef) : { ...targetBody(targetByPath.get(new URL(url).pathname)), return_code: '17', return_msg: 'secret@example.com', acct_no: '12345678' };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'next-key': 'private-cursor' } });
  };
  try {
    const report = await runChain({ execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, requestTimeoutMs: 1000, overallTimeoutMs: 10000 }, sources, { tokenReader: () => 'private-token', revision: 'test' });
    const serialized = JSON.stringify(report);
    for (const secret of ['secret@example.com', '12345678', 'private-cursor', 'private-token', 'D00004']) assert.ok(!serialized.includes(secret));
  } finally { globalThis.fetch = originalFetch; }
});

test('untrusted return-code text is reduced to a fixed marker', async () => {
  const sources = await realSources();
  const plan = buildChainPlan(sources);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify(openApiFor(plan)), { status: 200 });
    return new Response(JSON.stringify({ return_code: 'secret@example.com' }), { status: 200 });
  };
  try {
    const report = await runChain({ execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, requestTimeoutMs: 1000, overallTimeoutMs: 10000 }, sources, { tokenReader: () => 'token', revision: 'test' });
    assert.equal(report.results[0].returnCode, 'INVALID');
    assert.ok(!JSON.stringify(report).includes('secret@example.com'));
  } finally { globalThis.fetch = originalFetch; }
});

test('CLI limits timeouts and forbids synthetic live timestamps', () => {
  assert.throws(() => parseArgs(['--execute', '--now', '2026-09-07T01:00:00Z']), /not allowed/);
  assert.throws(() => parseArgs(['--request-timeout-ms', '5001']), /between 1 and 5000/);
  assert.throws(() => parseArgs(['--overall-timeout-ms', '60001']), /between 1 and 60000/);
  assert.throws(() => parseArgs(['--rate-ms', '61000']), /between 0 and 5000/);
});

test('rate delay cannot consume or exceed the remaining overall deadline', async () => {
  const sources = await realSources();
  const plan = buildChainPlan(sources);
  const sourceByPath = new Map(plan.chains.map(chain => [chain.route.path, chain]));
  const originalFetch = globalThis.fetch;
  let sleeps = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify(openApiFor(plan)), { status: 200 });
    const chain = sourceByPath.get(new URL(url).pathname);
    return new Response(JSON.stringify(sourceBody(chain.sourceRef)), { status: 200 });
  };
  try {
    await assert.rejects(runChain({ execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 20, requestTimeoutMs: 5, overallTimeoutMs: 10 }, sources, { tokenReader: () => 'token', sleep: async () => { sleeps += 1; }, revision: 'test' }), /OVERALL_TIMEOUT_BEFORE_RATE_DELAY/);
    assert.equal(sleeps, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('implementation has a hard request cap and no order or OAuth route literals', async () => {
  const source = await readFile(new URL('./read-input-chain.mjs', import.meta.url), 'utf8');
  assert.match(source, /const REQUEST_LIMIT = 20/);
  assert.doesNotMatch(source, /\/api\/v1\/(?:order|oauth)\//i);
});
