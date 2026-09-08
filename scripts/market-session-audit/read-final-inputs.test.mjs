import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan, loadSources, parseArgs, runProbe, validateOpenApi } from './read-final-inputs.mjs';

const clone = value => structuredClone(value);
const sources = () => loadSources();

function openApiFor(plan) {
  const paths = {};
  for (const op of plan.operations) {
    paths[op.route.path] = { post: { operationId: op.route.operationId, 'x-kiwoom-tr-id': op.trId, requestBody: { content: { 'application/json': { schema: { type: 'object', required: [...op.required], properties: Object.fromEntries(op.allowed.map(field => [field, { type: 'string' }])) } } } } } };
  }
  return { paths };
}

function targetBody(ref) {
  if (ref === 'base:ka10088') return { return_code: 0, osop: [] };
  if (ref.endsWith('margin_order_capacity')) return { profa_20ord_alow_amt: '1' };
  if (ref.endsWith('cash_and_withdrawal_capacity')) return { ord_alowa: '1' };
  if (ref.endsWith('purchase_settlement')) return { pur_amt: '1' };
  return { return_code: 0, elwlpposs_daly_trnsn: [] };
}

function fakeFetch(plan, options = {}) {
  const calls = [];
  const byPath = new Map(plan.operations.map(op => [op.route.path, op]));
  const fetchImpl = async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    calls.push({ pathname, init });
    if (pathname === '/openapi.json') return new Response(JSON.stringify(openApiFor(plan)), { status: 200 });
    if (pathname === '/ready/accounts') return new Response(JSON.stringify(options.readiness || { default: 'ready-main', accounts: { 'ready-main': { ready: true } } }), { status: 200 });
    const op = byPath.get(pathname);
    if (!op) throw new Error(`unexpected path ${pathname}`);
    if (options.statusByRef?.[op.ref]) return new Response(JSON.stringify({ detail: 'provider-private-message' }), { status: options.statusByRef[op.ref] });
    if (options.firstBusinessStatus && calls.filter(call => call.init.method === 'POST').length === 1) return new Response(JSON.stringify({ detail: 'provider-private-message' }), { status: options.firstBusinessStatus });
    if (op.ref === 'base:ka10075') return new Response(JSON.stringify({ return_code: 0, oso: options.noOrders ? [] : [{ ord_no: '7654321', oso_qty: '3', acnt_no: 'secret-account' }] }), { status: 200 });
    if (op.ref === 'detail:ka10004:sell_bid_prices') return new Response(JSON.stringify({ sel_fpr_bid: options.noAsk ? '' : '+72,300' }), { status: 200 });
    if (op.ref === 'detail:ka10001:current_trading') return new Response(JSON.stringify({ cur_prc: '-71900' }), { status: 200 });
    return new Response(JSON.stringify(targetBody(op.ref)), { status: 200 });
  };
  return { fetchImpl, calls };
}

const liveOptions = { execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, requestTimeoutMs: 1000, overallTimeoutMs: 10000, now: new Date('2026-09-07T01:00:00Z') };

test('real contracts produce exactly five targets and exact read routes', async () => {
  const plan = buildPlan(await sources(), new Date('2026-09-07T01:00:00Z'));
  assert.equal(plan.operations.filter(op => op.role === 'TARGET').length, 5);
  assert.equal(plan.baseDate, '20260907');
  assert.ok(plan.operations.every(op => op.route.path.startsWith('/api/v1/tr/')));
  assert.ok(plan.operations.every(op => !/[?#%\\]|\.\./.test(op.route.path)));
});

test('manifest route traversal and missing operation ID fail before token or fetch', async () => {
  for (const mutation of [
    route => { route.path = '/api/v1/tr/../order/ka10075'; },
    route => { route.path += '?unsafe=1'; },
    route => { delete route.operation_id; },
  ]) {
    const source = clone(await sources());
    const route = source.manifest.mappings.find(item => item.operation_ref === 'base:ka10075').route;
    mutation(route);
    let fetches = 0;
    let tokenReads = 0;
    await assert.rejects(runProbe(liveOptions, source, { fetchImpl: async () => { fetches += 1; }, tokenReader: () => { tokenReads += 1; return 'x'; } }), /unsafe exact route/);
    assert.equal(fetches, 0);
    assert.equal(tokenReads, 0);
  }
});

test('source inventory, screen read-only, and ELW sibling drift fail closed', async () => {
  const required = clone(await sources());
  required.inventory.find(item => item.id === 'ka10075').req_body.find(item => item.element === 'stex_tp').required = 'N';
  assert.throws(() => buildPlan(required), /inventory required fields mismatch/);
  const extraRequired = clone(await sources());
  extraRequired.inventory.find(item => item.id === 'ka10075').req_body.find(item => item.element === 'stk_cd').required = 'Y';
  assert.throws(() => buildPlan(extraRequired), /inventory required fields mismatch/);
  const screen = clone(await sources());
  screen.definitions.definitions.find(item => item.operation_ref === 'base:ka10088').input.read_only = false;
  assert.throws(() => buildPlan(screen), /read-only screen contract/);
  const sibling = clone(await sources());
  sibling.inventory.find(item => item.id === 'ka30004').req_body.find(item => item.element === 'bsis_aset_cd').desc = 'no declared values';
  assert.throws(() => buildPlan(sibling), /underlying-code contract drift/);
  const responsePath = clone(await sources());
  responsePath.definitions.definitions.find(item => item.operation_ref === 'base:ka10075').data.containers[0].fields.find(item => item.alias === 'ord_no').path = '$.wrong[*].ord_no';
  assert.throws(() => buildPlan(responsePath), /response path contract drift/);
});

test('OpenAPI operation, required fields, and request properties must match exactly', async () => {
  const plan = buildPlan(await sources());
  const missingId = openApiFor(plan);
  delete missingId.paths['/api/v1/tr/account/ka10075'].post.operationId;
  assert.throws(() => validateOpenApi(missingId, plan), /route contract mismatch/);
  const removedRequired = openApiFor(plan);
  removedRequired.paths['/api/v1/tr/account/ka10088'].post.requestBody.content['application/json'].schema.required = [];
  assert.throws(() => validateOpenApi(removedRequired, plan), /required fields mismatch/);
  const inventedProperty = openApiFor(plan);
  inventedProperty.paths['/api/v1/tr/elw/ka30003'].post.requestBody.content['application/json'].schema.properties.invented = { type: 'string' };
  assert.throws(() => validateOpenApi(inventedProperty, plan), /request properties mismatch/);
});

test('dry run performs zero network and credential/account reads', async () => {
  let fetches = 0;
  let tokenReads = 0;
  let accountReads = 0;
  const report = await runProbe({ ...liveOptions, execute: false }, await sources(), { fetchImpl: async () => { fetches += 1; }, tokenReader: () => { tokenReads += 1; }, accountReader: () => { accountReads += 1; } });
  assert.deepEqual([fetches, tokenReads, accountReads], [0, 0, 0]);
  assert.equal(report.summary.targetCount, 5);
  assert.equal(report.results.every(item => item.reason === 'DRY_RUN'), true);
});

test('success binds every business call to one ready alias and never persists private values', async () => {
  const plan = buildPlan(await sources());
  const fake = fakeFetch(plan);
  const report = await runProbe(liveOptions, await sources(), { ...fake, tokenReader: () => 'private-token', accountReader: () => 'ready-main', revision: 'test' });
  assert.equal(report.summary.businessRequestCount, 7);
  assert.equal(report.summary.targetPass, 5);
  const business = fake.calls.filter(call => call.init.method === 'POST');
  assert.equal(business.length, 7);
  assert.ok(business.every(call => call.init.headers['X-Athena-Account'] === 'ready-main'));
  assert.ok(business.every(call => call.init.headers.Authorization === 'Bearer private-token'));
  const capacityBodies = business.filter(call => call.pathname.includes('/kt00010/')).map(call => JSON.parse(call.init.body));
  assert.equal(capacityBodies.length, 3);
  assert.ok(capacityBodies.every(body => body.stk_cd === '005930' && body.trde_tp === '2' && body.uv === '72300'));
  const serialized = JSON.stringify(report);
  for (const privateValue of ['private-token', 'ready-main', '7654321', '72300', 'secret-account']) assert.ok(!serialized.includes(privateValue));
  assert.equal(report.scenario.uvMeaning, 'HYPOTHETICAL_CAPACITY_SCENARIO_PRICE');
  assert.equal(report.scenario.freshness, 'NOT_VERIFIED_NO_SOURCE_TIMESTAMP_CONTRACT');
  assert.equal(report.revision, 'test');
  assert.ok(report.results.filter(item => item.attempted).every(item => item.attemptedAt && item.marketPhase?.timezone === 'Asia/Seoul'));
  assert.ok(report.results.filter(item => item.operationRef.startsWith('detail:')).every(item => item.returnCode === 'NOT_EXPOSED_BY_DETAIL_PROJECTION'));
});

test('projected quote success omits return code while raw business and empty bodies fail closed', async () => {
  const plan = buildPlan(await sources());
  for (const projectedBody of [
    { return_code: '17', return_msg: 'private upstream failure', sel_fpr_bid: '+72300' },
    {},
  ]) {
    const fake = fakeFetch(plan);
    const original = fake.fetchImpl;
    fake.fetchImpl = async (url, init) => {
      if (new URL(url).pathname === '/api/v1/tr/quotes/ka10004/detail/sell_bid_prices') return new Response(JSON.stringify(projectedBody), { status: 200 });
      return original(url, init);
    };
    const report = await runProbe(liveOptions, await sources(), { ...fake, tokenReader: () => 'token', revision: 'test' });
    const quote = report.results.find(item => item.operationRef === 'detail:ka10004:sell_bid_prices');
    assert.equal(quote.verdict, 'BLOCKED');
    if (Object.hasOwn(projectedBody, 'return_code')) assert.equal(quote.reason, 'DETAIL_PROJECTION_BUSINESS_OR_CONTRACT_FAILURE');
    else assert.equal(quote.reason, 'SOURCE_VALUE_NOT_AVAILABLE');
    assert.ok(!JSON.stringify(report).includes('private upstream failure'));
  }
});

test('no existing order blocks ka10088 without generating an order', async () => {
  const plan = buildPlan(await sources());
  const fake = fakeFetch(plan, { noOrders: true });
  const report = await runProbe(liveOptions, await sources(), { ...fake, tokenReader: () => 'token' });
  const orderDetail = report.results.find(item => item.operationRef === 'base:ka10088');
  assert.equal(orderDetail.attempted, false);
  assert.equal(orderDetail.reason, 'NO_EXISTING_UNFILLED_ORDER');
  assert.equal(report.summary.businessRequestCount, 6);
  assert.ok(fake.calls.every(call => !call.pathname.startsWith('/api/v1/order/')));
});

test('zero or negative unfilled quantity never supplies ka10088', async () => {
  for (const osoQty of ['0', '-3']) {
    const plan = buildPlan(await sources());
    const fake = fakeFetch(plan);
    const original = fake.fetchImpl;
    fake.fetchImpl = async (url, init) => {
      if (new URL(url).pathname === '/api/v1/tr/account/ka10075') return new Response(JSON.stringify({ return_code: 0, oso: [{ ord_no: '7654321', oso_qty: osoQty }] }), { status: 200 });
      return original(url, init);
    };
    const report = await runProbe(liveOptions, await sources(), { ...fake, tokenReader: () => 'token' });
    assert.equal(report.results.find(item => item.operationRef === 'base:ka10088').attempted, false);
    assert.ok(fake.calls.every(call => call.pathname !== '/api/v1/tr/account/ka10088'));
  }
});

test('missing ask uses one current-price fallback and remains within eight business calls', async () => {
  const plan = buildPlan(await sources());
  const fake = fakeFetch(plan, { noAsk: true });
  const report = await runProbe(liveOptions, await sources(), { ...fake, tokenReader: () => 'token' });
  assert.equal(report.summary.businessRequestCount, 8);
  assert.equal(report.summary.targetPass, 5);
  assert.equal(report.scenario.priceSource, 'CURRENT_PRICE_FALLBACK');
  assert.ok(fake.calls.some(call => call.pathname.endsWith('/ka10001/detail/current_trading')));
});

test('unready or mismatched account stops before credential and business access', async () => {
  const plan = buildPlan(await sources());
  const fake = fakeFetch(plan, { readiness: { default: 'not-ready', accounts: { 'not-ready': { ready: false } } } });
  let tokenReads = 0;
  await assert.rejects(runProbe(liveOptions, await sources(), { ...fake, tokenReader: () => { tokenReads += 1; return 'token'; } }), /NO_SELECTED_READY_ACCOUNT/);
  assert.equal(tokenReads, 0);
  assert.equal(fake.calls.filter(call => call.init.method === 'POST').length, 0);
});

test('first authentication failure stops all remaining business calls and redacts provider text', async () => {
  const plan = buildPlan(await sources());
  const fake = fakeFetch(plan, { firstBusinessStatus: 401 });
  const report = await runProbe(liveOptions, await sources(), { ...fake, tokenReader: () => 'token' });
  assert.equal(report.summary.businessRequestCount, 1);
  assert.equal(report.summary.targetAttempted, 0);
  assert.ok(!JSON.stringify(report).includes('provider-private-message'));
});

test('later source or target authentication failure blocks every subsequent business request', async () => {
  const cases = [
    { ref: 'detail:ka10004:sell_bid_prices', failingPath: '/api/v1/tr/quotes/ka10004/detail/sell_bid_prices', expectedPosts: 3, remainingTargets: 4 },
    { ref: 'detail:kt00010:margin_order_capacity', failingPath: '/api/v1/tr/account/kt00010/detail/margin_order_capacity', expectedPosts: 4, remainingTargets: 3 },
  ];
  for (const scenario of cases) {
    const plan = buildPlan(await sources());
    const fake = fakeFetch(plan, { statusByRef: { [scenario.ref]: 403 } });
    const report = await runProbe(liveOptions, await sources(), { ...fake, tokenReader: () => 'token' });
    const posts = fake.calls.filter(call => call.init.method === 'POST');
    assert.equal(posts.length, scenario.expectedPosts);
    assert.equal(posts.at(-1).pathname, scenario.failingPath);
    if (scenario.ref.startsWith('detail:kt00010:')) {
      const failed = report.results.find(item => item.operationRef === scenario.ref);
      assert.deepEqual({ attempted: failed.attempted, verdict: failed.verdict, reason: failed.reason }, { attempted: true, verdict: 'BLOCKED', reason: 'AUTH_FAILURE' });
    }
    assert.equal(report.results.filter(item => item.role === 'TARGET' && item.reason === 'AUTH_FAILURE_NOT_ATTEMPTED').length, scenario.remainingTargets);
    assert.ok(!JSON.stringify(report).includes('provider-private-message'));
  }
});

test('metadata and business response size caps fail closed', async () => {
  const plan = buildPlan(await sources());
  let tokenReads = 0;
  const oversizedOpenApi = async url => {
    if (new URL(url).pathname === '/openapi.json') return new Response('{}', { status: 200, headers: { 'content-length': String(8 * 1024 * 1024 + 1) } });
    throw new Error('must stop at OpenAPI');
  };
  await assert.rejects(runProbe(liveOptions, await sources(), { fetchImpl: oversizedOpenApi, tokenReader: () => { tokenReads += 1; return 'token'; } }), /RESPONSE_SIZE_LIMIT_EXCEEDED/);
  assert.equal(tokenReads, 0);
  const businessFake = fakeFetch(plan);
  const fetchImpl = async (url, init) => {
    if (init?.method === 'POST') return new Response('{}', { status: 200, headers: { 'content-length': String(1024 * 1024 + 1) } });
    return businessFake.fetchImpl(url, init);
  };
  const report = await runProbe(liveOptions, await sources(), { fetchImpl, tokenReader: () => 'token' });
  assert.ok(report.results.some(item => item.reason === 'RESPONSE_SIZE_LIMIT_EXCEEDED'));
});

test('request budget and remaining deadline stop before another request or sleep', async () => {
  const plan = buildPlan(await sources());
  const budgetFake = fakeFetch(plan);
  const budgetReport = await runProbe(liveOptions, await sources(), { ...budgetFake, tokenReader: () => 'token', requestLimit: 2 });
  assert.equal(budgetReport.summary.businessRequestCount, 2);
  assert.ok(budgetReport.results.some(item => item.reason === 'REQUEST_BUDGET_EXCEEDED'));
  const deadlineFake = fakeFetch(plan);
  let sleeps = 0;
  const deadlineReport = await runProbe({ ...liveOptions, rateMs: 20, overallTimeoutMs: 10 }, await sources(), { ...deadlineFake, tokenReader: () => 'token', sleep: async () => { sleeps += 1; } });
  assert.equal(sleeps, 0);
  assert.ok(deadlineReport.results.some(item => item.reason === 'OVERALL_TIMEOUT_BEFORE_RATE_DELAY'));
  const cannotRaiseFake = fakeFetch(plan, { noAsk: true });
  const cannotRaise = await runProbe(liveOptions, await sources(), { ...cannotRaiseFake, tokenReader: () => 'token', requestLimit: 99 });
  assert.equal(cannotRaise.summary.businessRequestCount, 8);
});

test('CLI validates limits and dry-run report is sanitized in an audit-owned temp directory', async () => {
  assert.throws(() => parseArgs(['--execute', '--now', '2026-09-07T01:00:00Z']), /not allowed/);
  assert.throws(() => parseArgs(['--request-timeout-ms', '5001']), /between 1 and 5000/);
  assert.throws(() => parseArgs(['--overall-timeout-ms', '60001']), /between 1 and 60000/);
  assert.throws(() => parseArgs(['--rate-ms', '5001']), /between 0 and 5000/);
  const outputDir = await mkdtemp(path.join(tmpdir(), 'athena-final-inputs-'));
  try {
    const script = fileURLToPath(new URL('./read-final-inputs.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [script, '--output-dir', outputDir, '--now', '2026-09-07T01:00:00Z'], { encoding: 'utf8', env: { ...process.env, ATHENA_LOCAL_BEARER_TOKEN: 'must-not-read', ATHENA_AUDIT_ACCOUNT_ALIAS: 'must-not-read-alias' } });
    assert.equal(run.status, 0, run.stderr);
    const files = await readdir(outputDir);
    assert.equal(files.length, 1);
    const content = await readFile(path.join(outputDir, files[0]), 'utf8');
    const parsed = JSON.parse(content);
    assert.equal(parsed.summary.targetCount, 5);
    assert.match(parsed.revision, /^[0-9a-f]{40}$/);
    assert.equal(parsed.marketPhaseAtStart.timezone, 'Asia/Seoul');
    assert.ok(!content.includes('must-not-read'));
    assert.ok(!run.stdout.includes('must-not-read'));
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});

test('implementation contains the hard cap and no order/OAuth endpoint literal', async () => {
  const code = await readFile(new URL('./read-final-inputs.mjs', import.meta.url), 'utf8');
  assert.match(code, /const REQUEST_LIMIT = 8/);
  assert.doesNotMatch(code, /['"]\/api\/v1\/(?:order|internal\/oauth)\//i);
  assert.doesNotMatch(code, /X-Athena-Confirm|Idempotency-Key/);
});
