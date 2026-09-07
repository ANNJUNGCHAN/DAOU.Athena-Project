import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { assertLoopbackBaseUrl, buildReadPlan, marketPhase, parseArgs, runSweep } from './read-sweep.mjs';

function fixtureSources(requiredFields = []) {
  const request = requiredFields.map(([element, desc]) => ({ element, desc, required: 'Y' }));
  return {
    manifest: {
      mappings: [{
        classification: { category: 'read_display', read: true },
        mapping_type: 'base', operation_ref: 'base:ka10001',
        operation: { tr_id: 'ka10001', kind: 'query' },
        route: { method: 'POST', path: '/api/v1/tr/stockinfo/ka10001', operation_id: 'post_query_stockinfo_ka10001' },
      }],
    },
    definitions: { definitions: [{ category: 'read_display', operation_ref: 'base:ka10001', data: { time: { basis: 'declared_response_field', field_path: '$.dt' } } }] },
    inventory: [{ id: 'ka10001', name: '주식기본정보요청', subcat: '종목정보', req_body: request }],
  };
}

const OPERATION_SPECIFIC_CONTRACTS = [
  ['ka10019', [['tm_tp', '1', '1:분전, 2:일전'], ['tm', '2', '분 혹은 일입력']]],
  ['ka10021', [['tm_tp', '2', '분 입력']]],
  ['ka10022', [['tm_tp', '2', '분 입력']]],
  ['ka10025', [['prpscnt', '2', '숫자입력']]],
];

function operationSpecificFixtureSources() {
  const sources = { manifest: { mappings: [] }, definitions: { definitions: [] }, inventory: [] };
  for (const [id, fields] of OPERATION_SPECIFIC_CONTRACTS) {
    const operationRef = `base:${id}`;
    sources.manifest.mappings.push({ classification: { category: 'read_display', read: true }, mapping_type: 'base', operation_ref: operationRef, operation: { tr_id: id, kind: 'query' }, route: { method: 'POST', path: `/api/v1/tr/ranking/${id}`, operation_id: `post_query_ranking_${id}` } });
    sources.definitions.definitions.push({ category: 'read_display', operation_ref: operationRef, data: { time: { basis: 'not_declared', field_path: null } } });
    sources.inventory.push({ id, name: id, subcat: '순위정보', req_body: fields.map(([element, length, desc]) => ({ element, length, desc, required: 'Y' })) });
  }
  return sources;
}

test('read plan requires both read_display sources and builds only the safe /api/v1/tr route', () => {
  const plan = buildReadPlan({ ...fixtureSources([['stk_cd', '거래소별 종목코드']]), now: new Date('2026-09-07T01:00:00Z') });
  assert.equal(plan.sourceCounts.uniqueOperationRefs, 1);
  assert.equal(plan.operations[0].planStatus, 'ELIGIBLE');
  assert.deepEqual(plan.operations[0].payload, { stk_cd: '005930' });
  const unsafe = fixtureSources([]);
  unsafe.manifest.mappings[0].route.path = '/api/v1/order/ka10001';
  assert.throws(() => buildReadPlan({ ...unsafe }), /unsafe read_display route/);
  const duplicate = fixtureSources([]);
  duplicate.manifest.mappings.push({ ...duplicate.manifest.mappings[0] });
  assert.throws(() => buildReadPlan({ ...duplicate }), /duplicate read_display operation_ref in route manifest/);
});

test('unknown or runtime-derived required input is blocked with field-level evidence', () => {
  const plan = buildReadPlan({ ...fixtureSources([['arn_grp_id', 'ka01300 응답 결과의 gcod값을 입력']]) });
  assert.equal(plan.operations[0].planStatus, 'BLOCKED_INPUT');
  assert.deepEqual(plan.operations[0].missing.map(item => item.field), ['arn_grp_id']);
  assert.match(plan.operations[0].missing[0].contract, /ka01300/);
});

test('only the four exact operation contracts receive fixed safe inputs and provenance', () => {
  const sources = operationSpecificFixtureSources();
  const plan = buildReadPlan({ ...sources, now: new Date('2026-09-07T01:00:00Z') });
  assert.deepEqual(plan.operations.map(item => item.payload), [
    { tm_tp: '1', tm: '1' },
    { tm_tp: '1' },
    { tm_tp: '1' },
    { prpscnt: '1' },
  ]);
  assert.deepEqual(plan.operations.map(item => item.inputEvidence.map(evidence => evidence.source)), [
    ['ka10019_contract_one_minute', 'ka10019_contract_one_minute'],
    ['ka10021_contract_one_minute'],
    ['ka10022_contract_one_minute'],
    ['ka10025_contract_minimum_positive_count'],
  ]);

  const unrelated = fixtureSources([['tm_tp', '분 입력'], ['prpscnt', '숫자입력']]);
  assert.equal(buildReadPlan({ ...unrelated }).operations[0].planStatus, 'BLOCKED_INPUT');
});

for (const [id] of OPERATION_SPECIFIC_CONTRACTS) {
  test(`${id} stays blocked when its dedicated contract drifts`, () => {
    const mutations = [
    ['required flag', fields => { fields[0].required = 'N'; }],
    ['field removal', fields => { fields.splice(0, 1); }],
    ['length', fields => { fields[0].length = '9'; }],
    ['description', fields => { fields[0].desc += ' drift'; }],
    ];
    for (const [label, mutate] of mutations) {
      const drifted = operationSpecificFixtureSources();
      mutate(drifted.inventory.find(item => item.id === id).req_body);
      const operation = buildReadPlan({ ...drifted }).operations.find(item => item.trId === id);
      assert.equal(operation.planStatus, 'BLOCKED_INPUT', `${id} ${label}`);
      assert.match(operation.missing[0].reason, /operation-specific safe input contract mismatch/, `${id} ${label}`);
    }
  });
}

test('authoritative full plan keeps 264 sources with 252 eligible and 12 dynamically blocked', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../backend/ref/kiwoom-common-screen-manifest.json', import.meta.url), 'utf8'));
  const definitions = JSON.parse(readFileSync(new URL('../../backend/ref/kiwoom-screen-definitions.json', import.meta.url), 'utf8'));
  const inventory = JSON.parse(readFileSync(new URL('../../backend/ref/kiwoom-tr-inventory.json', import.meta.url), 'utf8'));
  const plan = buildReadPlan({ manifest, definitions, inventory, now: new Date('2026-09-07T01:00:00Z') });
  assert.equal(plan.sourceCounts.uniqueOperationRefs, 264);
  assert.equal(plan.operations.filter(item => item.planStatus === 'ELIGIBLE').length, 252);
  assert.deepEqual(plan.operations.filter(item => item.planStatus === 'BLOCKED_INPUT').map(item => item.operationRef), [
    'base:ka01301',
    'base:ka10039',
    'base:ka10043',
    'base:ka10052',
    'base:ka10078',
    'base:ka10088',
    'base:ka30003',
    'base:ka40001',
    'base:ka90002',
    'detail:kt00010:margin_order_capacity',
    'detail:kt00010:cash_and_withdrawal_capacity',
    'detail:kt00010:purchase_settlement',
  ]);
});

test('dry run never fetches and accounts for every allowlisted operation', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('fetch must not run'); };
  try {
    const report = await runSweep({ execute: false, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, timeoutMs: 10, now: new Date('2026-09-07T01:00:00Z') }, fixtureSources([['stk_cd', '거래소별 종목코드']]));
    assert.equal(report.mode, 'registry_dry_run');
    assert.equal(report.summary.sourceOperationCount, 1);
    assert.equal(report.summary.eligibleInputCount, 1);
    assert.equal(report.summary.blockedInputCount, 0);
    assert.equal(report.summary.verdicts.NOT_RUN, 1);
    assert.equal(report.sources.fixturesMixedWithLive, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('operation filter preserves full source proof and records the selected request actual clock', async () => {
  const sources = fixtureSources([]);
  sources.manifest.mappings.push({
    ...sources.manifest.mappings[0],
    operation_ref: 'detail:ka10001:more',
    route: { ...sources.manifest.mappings[0].route, path: '/api/v1/tr/stockinfo/ka10001/detail/more', operation_id: 'post_tr_stockinfo_ka10001_detail_more' },
  });
  sources.definitions.definitions.push({ category: 'read_display', operation_ref: 'detail:ka10001:more', data: { time: { basis: 'declared_response_field', field_path: '$.dt' } } });
  const instants = [new Date('2026-09-07T00:00:00Z'), new Date('2026-09-07T00:10:00Z')];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify({ paths: {
      '/api/v1/tr/stockinfo/ka10001': { post: { operationId: 'post_query_stockinfo_ka10001', 'x-kiwoom-tr-id': 'ka10001', requestBody: { content: { 'application/json': { schema: {} } } } } },
      '/api/v1/tr/stockinfo/ka10001/detail/more': { post: { operationId: 'post_tr_stockinfo_ka10001_detail_more', 'x-kiwoom-tr-id': 'ka10001', requestBody: { content: { 'application/json': { schema: {} } } } } },
    } }), { status: 200 });
    assert.match(String(url), /\/detail\/more$/);
    return new Response(JSON.stringify({ return_code: '0', dt: '20260907', value: '1' }), { status: 200, headers: { 'cont-yn': 'N' } });
  };
  try {
    const report = await runSweep({
      execute: true,
      baseUrl: 'http://127.0.0.1:8010',
      rateMs: 0,
      timeoutMs: 1000,
      maxPages: 1,
      onlyOperationRefs: ['detail:ka10001:more'],
      clock: () => instants.shift(),
    }, sources);
    assert.equal(report.summary.sourceOperationCount, 2);
    assert.equal(report.summary.selectedOperationCount, 1);
    assert.deepEqual(report.scope.allSourceOperationRefs, ['base:ka10001', 'detail:ka10001:more']);
    assert.deepEqual(report.results.map(item => item.operationRef), ['detail:ka10001:more']);
    assert.equal(report.results[0].attemptedAt, '2026-09-07T00:10:00.000Z');
    assert.equal(report.results[0].marketPhase, 'REGULAR');
    assert.equal(instants.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('duplicate, unknown, and non-read operation filters fail before network access', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error('must not fetch'); };
  const options = { execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, timeoutMs: 1000, maxPages: 1 };
  try {
    await assert.rejects(runSweep({ ...options, onlyOperationRefs: ['base:ka10001', 'base:ka10001'] }, fixtureSources([])), /duplicate --only-operation-ref/);
    await assert.rejects(runSweep({ ...options, onlyOperationRefs: ['base:missing'] }, fixtureSources([])), /unknown or non-read operation_ref/);
    await assert.rejects(runSweep({ ...options, onlyOperationRefs: ['base:kt10000'] }, fixtureSources([])), /unknown or non-read operation_ref/);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CLI rejects synthetic --now for live execution and parses repeatable filters', () => {
  assert.throws(() => parseArgs(['--execute', '--now', '2026-09-07T00:00:00Z']), /--now is not allowed with --execute/);
  assert.deepEqual(parseArgs(['--only-operation-ref', 'base:ka10001', '--only-operation-ref', 'detail:ka10001:more']).onlyOperationRefs, ['base:ka10001', 'detail:ka10001:more']);
});

test('execute validates live OpenAPI, redacts response values, and distinguishes business failures', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/openapi.json')) {
      return new Response(JSON.stringify({ paths: { '/api/v1/tr/stockinfo/ka10001': { post: { operationId: 'post_query_stockinfo_ka10001', 'x-kiwoom-tr-id': 'ka10001', requestBody: { content: { 'application/json': { schema: { required: ['stk_cd'] } } } } } } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ return_code: '17', return_msg: '조회 조건 오류', acct_no: '12345678' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const report = await runSweep({ execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, timeoutMs: 1000, now: new Date('2026-09-07T01:00:00Z') }, fixtureSources([['stk_cd', '거래소별 종목코드']]));
    assert.deepEqual(calls, ['http://127.0.0.1:8010/openapi.json', 'http://127.0.0.1:8010/api/v1/tr/stockinfo/ka10001']);
    assert.equal(report.results[0].verdict, 'FAIL');
    assert.equal(report.results[0].reason, 'BUSINESS_RETURN_CODE');
    assert.equal(report.results[0].returnCode, '17');
    assert.ok(!JSON.stringify(report).includes('12345678'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('auth failure stops subsequent live reads instead of retrying credentials', async () => {
  const sources = fixtureSources([]);
  sources.manifest.mappings.push({ ...sources.manifest.mappings[0], operation_ref: 'detail:ka10001:more', route: { ...sources.manifest.mappings[0].route, path: '/api/v1/tr/stockinfo/ka10001/detail/more', operation_id: 'post_tr_stockinfo_ka10001_detail_more' } });
  sources.definitions.definitions.push({ category: 'read_display', operation_ref: 'detail:ka10001:more', data: { time: { basis: 'declared_response_field', field_path: '$.dt' } } });
  const originalFetch = globalThis.fetch;
  let liveCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify({ paths: {
      '/api/v1/tr/stockinfo/ka10001': { post: { operationId: 'post_query_stockinfo_ka10001', 'x-kiwoom-tr-id': 'ka10001', requestBody: { content: { 'application/json': { schema: {} } } } } },
      '/api/v1/tr/stockinfo/ka10001/detail/more': { post: { operationId: 'post_tr_stockinfo_ka10001_detail_more', 'x-kiwoom-tr-id': 'ka10001', requestBody: { content: { 'application/json': { schema: {} } } } } },
    } }), { status: 200 });
    liveCalls += 1;
    return new Response(JSON.stringify({ detail: 'Bearer authentication required' }), { status: 401 });
  };
  try {
    const report = await runSweep({ execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, timeoutMs: 1000, now: new Date('2026-09-07T01:00:00Z') }, sources);
    assert.equal(liveCalls, 1);
    assert.equal(report.results[0].reason, 'BLOCKED_AUTH');
    assert.equal(report.results[1].reason, 'BLOCKED_AUTH_NOT_ATTEMPTED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('market-live response without a source date cannot become PASS', async () => {
  const sources = fixtureSources([]);
  sources.inventory[0].name = '주식호가요청';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify({ paths: {
      '/api/v1/tr/stockinfo/ka10001': { post: { operationId: 'post_query_stockinfo_ka10001', 'x-kiwoom-tr-id': 'ka10001', requestBody: { content: { 'application/json': { schema: {} } } } } },
    } }), { status: 200 });
    return new Response(JSON.stringify({ return_code: '0', cur_prc: '70000' }), { status: 200, headers: { 'cont-yn': 'N' } });
  };
  try {
    const report = await runSweep({ execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, timeoutMs: 1000, maxPages: 2, now: new Date('2026-09-07T01:00:00Z') }, sources);
    assert.equal(report.results[0].freshness.state, 'NOT_VERIFIED_NO_VALID_SOURCE_DATE');
    assert.equal(report.results[0].verdict, 'BLOCKED');
    assert.equal(report.results[0].reason, 'BLOCKED_FRESHNESS_NOT_VERIFIED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('pagination follows unique next keys and only passes after the terminal page', async () => {
  const sources = fixtureSources([]);
  sources.inventory[0].name = '주식호가요청';
  const originalFetch = globalThis.fetch;
  let page = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify({ paths: {
      '/api/v1/tr/stockinfo/ka10001': { post: { operationId: 'post_query_stockinfo_ka10001', 'x-kiwoom-tr-id': 'ka10001', requestBody: { content: { 'application/json': { schema: {} } } } } },
    } }), { status: 200 });
    page += 1;
    if (page === 1) {
      assert.equal(options.headers['cont-yn'], undefined);
      return new Response(JSON.stringify({ return_code: '0', dt: '20260907', rows: [{ value: '1' }] }), { status: 200, headers: { 'cont-yn': 'Y', 'next-key': 'opaque-next-key' } });
    }
    assert.equal(options.headers['cont-yn'], 'Y');
    assert.equal(options.headers['next-key'], 'opaque-next-key');
    return new Response(JSON.stringify({ return_code: '0', dt: '20260907', rows: [{ value: '2' }] }), { status: 200, headers: { 'cont-yn': 'N' } });
  };
  try {
    const report = await runSweep({ execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, timeoutMs: 1000, maxPages: 2, now: new Date('2026-09-07T01:00:00Z') }, sources);
    assert.equal(page, 2);
    assert.equal(report.results[0].pagination.state, 'COMPLETE');
    assert.equal(report.results[0].pagination.pagesFetched, 2);
    assert.equal(report.results[0].verdict, 'BLOCKED');
    assert.equal(report.results[0].reason, 'BLOCKED_FRESHNESS_NOT_VERIFIED');
    assert.ok(!JSON.stringify(report).includes('opaque-next-key'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unfinished pagination is BLOCKED and untrusted response text is never persisted', async () => {
  const sources = fixtureSources([]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify({ paths: {
      '/api/v1/tr/stockinfo/ka10001': { post: { operationId: 'post_query_stockinfo_ka10001', 'x-kiwoom-tr-id': 'ka10001', requestBody: { content: { 'application/json': { schema: {} } } } } },
    } }), { status: 200 });
    return new Response(JSON.stringify({ return_code: '0', return_msg: 'secret@example.com eyJhbGciOiJIUzI1NiJ9.payload.signature', dt: '20260907', date: 'secret@example.com', rows: [{ value: '1' }] }), { status: 200, headers: { 'cont-yn': 'Y', 'next-key': 'secret@example.com' } });
  };
  try {
    const report = await runSweep({ execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, timeoutMs: 1000, maxPages: 1, now: new Date('2026-09-07T01:00:00Z') }, sources);
    assert.equal(report.results[0].verdict, 'BLOCKED');
    assert.equal(report.results[0].reason, 'BLOCKED_PAGINATION_NOT_VERIFIED');
    assert.equal(report.results[0].pagination.state, 'INCOMPLETE_PAGE_LIMIT');
    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes('secret@example.com'));
    assert.ok(!serialized.includes('eyJhbGci'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('future source dates are rejected instead of treated as fresh', async () => {
  const sources = fixtureSources([]);
  sources.inventory[0].name = '주식호가요청';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify({ paths: {
      '/api/v1/tr/stockinfo/ka10001': { post: { operationId: 'post_query_stockinfo_ka10001', 'x-kiwoom-tr-id': 'ka10001', requestBody: { content: { 'application/json': { schema: {} } } } } },
    } }), { status: 200 });
    return new Response(JSON.stringify({ return_code: '0', dt: '20260908', rows: [{ value: '1' }] }), { status: 200, headers: { 'cont-yn': 'N' } });
  };
  try {
    const report = await runSweep({ execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, timeoutMs: 1000, maxPages: 1, now: new Date('2026-09-07T01:00:00Z') }, sources);
    assert.equal(report.results[0].freshness.state, 'NOT_VERIFIED_NO_EXPECTED_DATE_POLICY');
    assert.equal(report.results[0].freshness.sourceDateRelation, 'AFTER_CURRENT_KST_DATE');
    assert.equal(report.results[0].verdict, 'BLOCKED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('old chart-style source dates stay blocked without an explicit expected-date policy', async () => {
  const sources = fixtureSources([]);
  sources.inventory[0].name = '주식분봉차트조회요청';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify({ paths: {
      '/api/v1/tr/stockinfo/ka10001': { post: { operationId: 'post_query_stockinfo_ka10001', 'x-kiwoom-tr-id': 'ka10001', requestBody: { content: { 'application/json': { schema: {} } } } } },
    } }), { status: 200 });
    return new Response(JSON.stringify({ return_code: '0', dt: '20200101', rows: [{ value: '1' }] }), { status: 200, headers: { 'cont-yn': 'N' } });
  };
  try {
    const report = await runSweep({ execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, timeoutMs: 1000, maxPages: 1, now: new Date('2026-09-07T01:00:00Z') }, sources);
    assert.equal(report.results[0].freshness.state, 'NOT_VERIFIED_NO_EXPECTED_DATE_POLICY');
    assert.equal(report.results[0].freshness.sourceDateRelation, 'BEFORE_CURRENT_KST_DATE');
    assert.equal(report.results[0].verdict, 'BLOCKED');
    assert.equal(report.results[0].reason, 'BLOCKED_FRESHNESS_NOT_VERIFIED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('each operation records its actual request phase when a sweep crosses market boundaries', async () => {
  const sources = fixtureSources([]);
  sources.manifest.mappings.push({ ...sources.manifest.mappings[0], operation_ref: 'detail:ka10001:more', route: { ...sources.manifest.mappings[0].route, path: '/api/v1/tr/stockinfo/ka10001/detail/more', operation_id: 'post_tr_stockinfo_ka10001_detail_more' } });
  sources.definitions.definitions.push({ category: 'read_display', operation_ref: 'detail:ka10001:more', data: { time: { basis: 'declared_response_field', field_path: '$.dt' } } });
  const instants = [new Date('2026-09-06T23:59:00Z'), new Date('2026-09-07T00:00:00Z')];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify({ paths: {
      '/api/v1/tr/stockinfo/ka10001': { post: { operationId: 'post_query_stockinfo_ka10001', 'x-kiwoom-tr-id': 'ka10001', requestBody: { content: { 'application/json': { schema: {} } } } } },
      '/api/v1/tr/stockinfo/ka10001/detail/more': { post: { operationId: 'post_tr_stockinfo_ka10001_detail_more', 'x-kiwoom-tr-id': 'ka10001', requestBody: { content: { 'application/json': { schema: {} } } } } },
    } }), { status: 200 });
    return new Response(JSON.stringify({ return_code: '0', dt: '20260907', value: '1' }), { status: 200, headers: { 'cont-yn': 'N' } });
  };
  try {
    const report = await runSweep({ execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, timeoutMs: 1000, maxPages: 1, now: new Date('2026-09-06T23:58:00Z'), clock: () => instants.shift() }, sources);
    assert.equal(report.marketPhaseScope, 'SWEEP_START_ONLY');
    assert.deepEqual(report.results.map(item => item.marketPhase), ['PRE_OPEN_30M', 'REGULAR']);
    assert.deepEqual(report.results.map(item => item.attemptedAt), ['2026-09-06T23:59:00.000Z', '2026-09-07T00:00:00.000Z']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('redirect boundary failures use the operation request timestamp and persist no raw error text', async () => {
  const sources = fixtureSources([]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify({ paths: {
      '/api/v1/tr/stockinfo/ka10001': { post: { operationId: 'post_query_stockinfo_ka10001', 'x-kiwoom-tr-id': 'ka10001', requestBody: { content: { 'application/json': { schema: {} } } } } },
    } }), { status: 200 });
    const response = new Response('{}', { status: 200 });
    Object.defineProperty(response, 'url', { value: 'http://127.0.0.1:8010/api/v1/order/secret@example.com' });
    return response;
  };
  try {
    const requestTime = new Date('2026-09-06T23:59:00Z');
    const report = await runSweep({ execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, timeoutMs: 1000, maxPages: 1, now: new Date('2026-09-06T23:58:00Z'), clock: () => requestTime }, sources);
    assert.equal(report.results[0].attemptedAt, requestTime.toISOString());
    assert.equal(report.results[0].marketPhase, 'PRE_OPEN_30M');
    assert.equal(report.results[0].reason, 'TRANSPORT_ERROR');
    assert.ok(!JSON.stringify(report).includes('secret@example.com'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('freshness observes only the declared response path and ignores unrelated current dates', async () => {
  const sources = fixtureSources([]);
  sources.definitions.definitions[0].data.time.field_path = '$.expected[*].dt';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify({ paths: {
      '/api/v1/tr/stockinfo/ka10001': { post: { operationId: 'post_query_stockinfo_ka10001', 'x-kiwoom-tr-id': 'ka10001', requestBody: { content: { 'application/json': { schema: {} } } } } },
    } }), { status: 200 });
    return new Response(JSON.stringify({ return_code: '0', dt: '20260907', expected: [{ dt: '20200101', value: '1' }] }), { status: 200, headers: { 'cont-yn': 'N' } });
  };
  try {
    const report = await runSweep({ execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, timeoutMs: 1000, maxPages: 1, now: new Date('2026-09-07T01:00:00Z') }, sources);
    assert.equal(report.results[0].freshness.state, 'NOT_VERIFIED_NO_EXPECTED_DATE_POLICY');
    assert.equal(report.results[0].freshness.sourceDateRelation, 'BEFORE_CURRENT_KST_DATE');
    assert.equal(report.results[0].verdict, 'BLOCKED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('invalid cont-yn is stored only as INVALID and blocks completion', async () => {
  const sources = fixtureSources([]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify({ paths: {
      '/api/v1/tr/stockinfo/ka10001': { post: { operationId: 'post_query_stockinfo_ka10001', 'x-kiwoom-tr-id': 'ka10001', requestBody: { content: { 'application/json': { schema: {} } } } } },
    } }), { status: 200 });
    return new Response(JSON.stringify({ return_code: '0', dt: '20260907', value: '1' }), { status: 200, headers: { 'cont-yn': 'secret@example.com' } });
  };
  try {
    const report = await runSweep({ execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, timeoutMs: 1000, maxPages: 1, now: new Date('2026-09-07T01:00:00Z') }, sources);
    assert.equal(report.results[0].pagination.state, 'INCOMPLETE_INVALID_CONT_YN');
    assert.equal(report.results[0].pagination.pages[0].continuation.contYn, 'INVALID');
    assert.equal(report.results[0].verdict, 'BLOCKED');
    assert.equal(report.results[0].reason, 'BLOCKED_PAGINATION_NOT_VERIFIED');
    assert.ok(!JSON.stringify(report).includes('secret@example.com'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('missing cont-yn is contract drift and cannot be treated as terminal N', async () => {
  const sources = fixtureSources([]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify({ paths: {
      '/api/v1/tr/stockinfo/ka10001': { post: { operationId: 'post_query_stockinfo_ka10001', 'x-kiwoom-tr-id': 'ka10001', requestBody: { content: { 'application/json': { schema: {} } } } } },
    } }), { status: 200 });
    return new Response(JSON.stringify({ return_code: '0', dt: '20260907', value: '1' }), { status: 200 });
  };
  try {
    const report = await runSweep({ execute: true, baseUrl: 'http://127.0.0.1:8010', rateMs: 0, timeoutMs: 1000, maxPages: 1, now: new Date('2026-09-07T01:00:00Z') }, sources);
    assert.equal(report.results[0].pagination.state, 'INCOMPLETE_INVALID_CONT_YN');
    assert.equal(report.results[0].pagination.pages[0].continuation.contYn, 'INVALID');
    assert.equal(report.results[0].reason, 'BLOCKED_PAGINATION_NOT_VERIFIED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('base URL and KST market phases are fail-closed', () => {
  assert.equal(assertLoopbackBaseUrl('http://localhost:8010'), 'http://localhost:8010');
  assert.throws(() => assertLoopbackBaseUrl('https://example.com'), /loopback/);
  assert.throws(() => assertLoopbackBaseUrl('https://127.0.0.1:8010'), /loopback/);
  assert.throws(() => assertLoopbackBaseUrl('http://127.0.0.1:8011'), /port 8010/);
  assert.throws(() => assertLoopbackBaseUrl('http://user:pass@127.0.0.1:8010'), /unauthenticated/);
  assert.throws(() => assertLoopbackBaseUrl('http://127.0.0.1:8010/api/v1'), /path/);
  assert.equal(marketPhase(new Date('2026-09-07T00:10:00Z')), 'REGULAR');
  assert.equal(marketPhase(new Date('2026-09-07T06:45:00Z')), 'POST_CLOSE_1H');
});

test('invalid base URL is rejected before token lookup or network access', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.ATHENA_LOCAL_BEARER_TOKEN;
  let fetchCalls = 0;
  process.env.ATHENA_LOCAL_BEARER_TOKEN = 'must-not-be-used';
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error('must not fetch'); };
  try {
    await assert.rejects(
      runSweep({ execute: true, baseUrl: 'https://127.0.0.1:8010', rateMs: 0, timeoutMs: 1000, maxPages: 1 }, fixtureSources([])),
      /loopback HTTP on port 8010/,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.ATHENA_LOCAL_BEARER_TOKEN;
    else process.env.ATHENA_LOCAL_BEARER_TOKEN = originalToken;
  }
});
