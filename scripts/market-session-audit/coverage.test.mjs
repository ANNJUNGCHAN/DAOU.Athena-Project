import assert from 'node:assert/strict';
import test from 'node:test';
import { auditWindowStates, marketPhaseAt, reconcileCoverage, renderMarkdown, validateCoverage } from './coverage.mjs';

function sourceItem(overrides = {}) {
  return {
    id: 'operation:base:ka1',
    source: 'screen_definition',
    source_path: 'definitions.json',
    source_id: 'base:ka1',
    classification: 'read_display',
    executable: true,
    ...overrides,
  };
}

function inputs(items = [sourceItem()]) {
  return {
    inventory: { items },
    readSweeps: [{
      revision: 'abc123',
      results: [{
        operationRef: 'base:ka1',
        route: { method: 'POST', path: '/api/v1/tr/stock/ka1' },
        verdict: 'BLOCKED',
        reason: 'BLOCKED_FRESHNESS_NOT_VERIFIED',
        attemptedAt: '2026-09-07T00:01:00Z',
        marketPhase: 'PRE_OPEN_30M',
      }],
    }],
    readInputChain: null,
    finalReadInputs: null,
    customReadSweep: { revision: 'abc123', results: [] },
    customReadChains: [{
      revision: 'abc123',
      request_count: 0,
      summary: { total: 0, attempted: 0, PASS_HTTP_SCHEMA_ONLY: 0, BLOCKED: 0 },
      source_observations: [],
      results: [],
      entrypoint: { business_request_count: 0, metadata_request_count: 1 },
    }],
    postMetadataProbe: null,
    customComputeProbe: null,
    mcpBuiltinsProbe: null,
    activeWsHistory: null,
    customReadAdjudication: '',
    modeFixtureDetails: [
      'Backtest mode | **PASS**, 5/5',
      'Agent Paper parity | **PASS**',
      'Session restore | **PASS**, 42/42',
      'Graph mode | **PASS**, 140 checks',
      'Full fixture verify | **FAIL**, 실패 단언 5건',
      'isolated-graph-mode-20260907-101545-8936.log',
      'fixture-verify-full-20260907-101818-8162.log',
    ].join('\n'),
    liveUis: [{
      started_at: '2026-09-07T00:48:00Z',
      modes: [],
      settings: [],
      current_mode_surface: { id: null },
      restoration: {},
    }],
    passiveWs: {
      revision: 'abc123',
      observed_at: '2026-09-07T00:41:00Z',
      market: { phase: 'REGULAR' },
      source_reconciliation: { exact_set_equal: true },
      authentication: { outcome: 'NOT_REJECTED_NO_ACK' },
      connection: { status: 'CONNECTED', closed: true, close_code: 1000, cleanup_status: 'COMPLETE' },
      events: { source_ids: [] },
    },
    runtimeDiscovery: {
      revision: 'abc123',
      observed_at: '2026-09-07T00:00:00Z',
      reconciliation: {
        generated_api: { routes: [{ method: 'POST', path: '/api/v1/tr/stock/ka1' }], static_only: [], runtime_only: [] },
        other_runtime_api: { routes: [] },
        static_websocket_excluded: { routes: [] },
        diff: { static_only: [], runtime_only: [] },
      },
    },
    paperCards: { boards: [] },
    paperScreens: { boards: [] },
    paperMini: { boards: [], grammar_coverage: { covered: [] } },
    paths: {
      inventory: 'inventory.json',
      readSweeps: ['sweep.json'],
      readInputChain: 'read-input-chain.json',
      finalReadInputs: ['outside-final-read.json', 'regular-final-read.json'],
      customReadSweep: 'custom.json',
      customReadChains: ['custom-chain.json'],
      postMetadataProbe: 'approved-post.json',
      customComputeProbe: 'approved-compute.json',
      mcpBuiltinsProbe: 'mcp-protocol.json',
      activeWsHistory: ['active-ws-blocked.json', 'active-ws-fresh.json'],
      customReadAdjudication: 'custom-details.md',
      modeFixtureDetails: 'mode-details.md',
      modeEvidence: { backtest: [], agent: [], session: [], graph: [], fullVerify: [] },
      liveUis: ['ui.json'],
      passiveWs: 'ws.json',
      runtimeDiscovery: 'runtime.json',
      paperCards: 'cards.json',
      paperScreens: 'screens.json',
      paperMini: 'mini.json',
    },
  };
}

test('reconciles one output row per exact inventory ID without a combined PASS', () => {
  const rows = reconcileCoverage(inputs());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_evidence.status, 'RUNTIME_DISCOVERED_EXACT');
  assert.equal(rows[0].live_evidence.status, 'LIVE_BLOCKED');
  assert.equal('overall_status' in rows[0], false);
});

test('rejects duplicate inventory IDs', () => {
  assert.throws(() => reconcileCoverage(inputs([sourceItem(), sourceItem()])), /duplicate identity/);
});

test('rejects missing coverage rows and source mismatches', () => {
  const source = [sourceItem()];
  assert.throws(() => validateCoverage([], source), /exact set mismatch/);
  const row = reconcileCoverage(inputs())[0];
  assert.throws(() => validateCoverage([{ ...row, source_id: 'base:other' }], source), /source mismatch/);
});

test('rejects a fabricated combined PASS field', () => {
  const source = [sourceItem()];
  const row = reconcileCoverage(inputs())[0];
  assert.throws(() => validateCoverage([{ ...row, overall_status: 'PASS' }], source), /combined PASS is forbidden/);
});

test('does not convert fixture evidence or route discovery into live PASS', () => {
  const item = sourceItem({
    id: 'card-board:C1',
    source: 'card_surface_catalog',
    source_id: 'C1',
    classification: 'CC-01',
  });
  const data = inputs([item]);
  data.readSweeps[0].results = [];
  data.runtimeDiscovery.reconciliation.generated_api.routes = [];
  data.paperCards = { generated_at: '2026-09-07T00:00:00Z', boards: [{ board_id: 'C1', status: 'pass' }] };
  const [row] = reconcileCoverage(data);
  assert.equal(row.fixture_evidence.status, 'FIXTURE_PASS');
  assert.equal(row.live_evidence.status, 'LIVE_NOT_EXECUTED');
  assert.match(row.remaining_gap, /실제 장 단계/);
});

test('a partial later read sweep preserves the earlier observation and both phases', () => {
  const data = inputs();
  data.readSweeps.push({
    revision: 'abc123',
    results: [{
      operationRef: 'base:ka1',
      route: { method: 'POST', path: '/api/v1/tr/stock/ka1' },
      verdict: 'FAIL',
      reason: 'DATA_ABSENT',
      attemptedAt: '2026-09-07T00:35:00Z',
      marketPhase: 'REGULAR',
    }],
  });
  data.paths.readSweeps.push('sweep-regular.json');
  const [row] = reconcileCoverage(data);
  assert.equal(row.live_evidence.status, 'LIVE_FAIL_UNADJUDICATED');
  assert.deepEqual(row.live_evidence.observations.map((entry) => entry.phase), ['PRE_OPEN_30M', 'REGULAR']);
  assert.deepEqual(row.evidence_paths, ['runtime.json', 'sweep.json', 'sweep-regular.json']);
});

test('renders structured baseline pagination and freshness states without object coercion or PASS promotion', () => {
  const data = inputs();
  data.readSweeps[0].results[0].pagination = {
    state: 'INCOMPLETE_PAGE_LIMIT',
    pagesFetched: 5,
    maxPages: 5,
    pages: [{ page: 1 }],
  };
  data.readSweeps[0].results[0].freshness = {
    state: 'NOT_VERIFIED_NO_EXPECTED_DATE_POLICY',
    sourceDateRelation: 'CURRENT_KST_DATE',
  };
  const [row] = reconcileCoverage(data);
  assert.equal(row.live_evidence.status, 'LIVE_BLOCKED');
  assert.match(row.live_evidence.detail, /pagination=state=INCOMPLETE_PAGE_LIMIT, pages=5\/5/);
  assert.match(row.live_evidence.detail, /freshness=state=NOT_VERIFIED_NO_EXPECTED_DATE_POLICY, relation=CURRENT_KST_DATE/);
  assert.doesNotMatch(row.live_evidence.detail, /\[object Object\]/);
});

test('accepts only the exact loopback-live dynamic read chain and keeps pagination and freshness unverified', () => {
  const sources = ['base:ka01300', 'base:ka10102', 'base:ka40007', 'base:ka90001'];
  const targets = ['base:ka01301', 'base:ka10039', 'base:ka10043', 'base:ka10052', 'base:ka10078', 'base:ka40001', 'base:ka90002'];
  const ids = [...sources, ...targets];
  const items = ids.map((id) => sourceItem({ id: `operation:${id}`, source_id: id }));
  const data = inputs(items);
  data.readSweeps[0].results = ids.map((operationRef) => ({
    operationRef,
    route: { method: 'POST', path: `/api/v1/tr/stock/${operationRef.split(':').at(-1)}` },
    verdict: 'BLOCKED', reason: 'MISSING_SAFE_OBSERVED_INPUT', attemptedAt: null, marketPhase: null,
  }));
  data.runtimeDiscovery.reconciliation.generated_api.routes = [...new Map(data.readSweeps[0].results.map((row) => [`${row.route.method} ${row.route.path}`, row.route])).values()];
  data.readInputChain = {
    revision: 'abc123', mode: 'loopback_live',
    scope: { sourceOperations: 4, targetOperations: 7, pagesPerOperation: 1 },
    summary: { attempted: 11, businessRequestCount: 11, metadataRequestCount: 1 },
    results: ids.map((operationRef, index) => {
      const source = sources.includes(operationRef);
      return {
        operationRef, role: source ? 'SOURCE' : 'TARGET', attempted: true,
        attemptedAt: `2026-09-07T04:12:${String(40 + index).padStart(2, '0')}Z`, marketPhase: 'REGULAR',
        httpStatus: 200, returnCode: '0', verdict: 'PASS',
        reason: source ? 'SOURCE_VALUE_OBSERVED_IN_MEMORY' : 'PASS_HTTP_JSON_DECLARED_ROOT_PRESENT',
        pagination: 'NOT_VERIFIED_SINGLE_PAGE', freshness: 'NOT_VERIFIED',
      };
    }),
  };
  const rows = reconcileCoverage(data);
  const targetRows = rows.filter((row) => targets.includes(row.source_id));
  assert.equal(targetRows.length, 7);
  assert.ok(targetRows.every((row) => row.source_evidence.status === 'RUNTIME_DISCOVERED_EXACT'));
  assert.ok(targetRows.every((row) => row.live_evidence.status === 'LIVE_HTTP_JSON_ROOT_OBSERVED'));
  assert.ok(targetRows.every((row) => row.live_evidence.observations.length === 2));
  assert.ok(targetRows.every((row) => /전체 schema\/end-to-end\/전체 페이지\/현재성 검증 아님/.test(row.live_evidence.detail)));
  data.readInputChain = { ...data.readInputChain, mode: 'in_memory_fixture' };
  assert.throws(() => reconcileCoverage(data), /not approved loopback-live evidence/);
});

test('merges the two explicit final read-input runs without promoting code 20 or an unattempted order target', () => {
  const sourceIds = ['base:ka10075', 'detail:ka10004:sell_bid_prices', 'detail:ka10001:current_trading'];
  const targetIds = [
    'base:ka10088',
    'detail:kt00010:margin_order_capacity',
    'detail:kt00010:cash_and_withdrawal_capacity',
    'detail:kt00010:purchase_settlement',
    'base:ka30003',
  ];
  const allIds = [...sourceIds, ...targetIds];
  const data = inputs(allIds.map((id) => sourceItem({ id: `operation:${id}`, source_id: id })));
  data.readSweeps[0].results = allIds.map((operationRef) => ({
    operationRef,
    route: { method: 'POST', path: `/api/v1/tr/stock/${operationRef.split(':')[1]}` },
    verdict: 'BLOCKED', reason: 'MISSING_SAFE_OBSERVED_INPUT', attemptedAt: null, marketPhase: null,
  }));
  data.runtimeDiscovery.reconciliation.generated_api.routes = [...new Map(data.readSweeps[0].results.map((row) => [`${row.route.method} ${row.route.path}`, row.route])).values()];
  const common = {
    schemaVersion: 1,
    mode: 'loopback_live',
    scope: { targetCount: 5, businessRequestLimit: 8, orderSideEffects: 'FORBIDDEN' },
    scenario: { side: 'BUY', uvMeaning: 'HYPOTHETICAL_CAPACITY_SCENARIO_PRICE', freshness: 'NOT_VERIFIED_NO_SOURCE_TIMESTAMP_CONTRACT' },
  };
  const outsideResult = (operationRef) => ({
    operationRef,
    role: targetIds.includes(operationRef) ? 'TARGET' : 'SOURCE',
    attempted: sourceIds.includes(operationRef) || operationRef === 'base:ka30003',
    verdict: operationRef === 'base:ka30003' ? 'PASS' : 'BLOCKED',
    reason: operationRef === 'base:ka30003' ? 'PASS_HTTP_JSON_DECLARED_ROOT_PRESENT'
      : operationRef === 'base:ka10088' ? 'NO_EXISTING_UNFILLED_ORDER' : 'HTTP_OR_RETURN_CODE_FAILURE',
    ...(operationRef === 'base:ka30003' ? { httpStatus: 200, returnCode: '0', pagination: 'NOT_VERIFIED_SINGLE_PAGE' } : {}),
    ...(sourceIds.includes(operationRef) ? { httpStatus: 200, returnCode: 'INVALID' } : {}),
  });
  data.finalReadInputs = [{
    ...common, revision: null, observedAt: '2026-09-07T05:04:27.820Z',
    summary: { targetAttempted: 1, businessRequestCount: 4, metadataRequestCount: 2 },
    results: allIds.map(outsideResult),
  }, {
    ...common, revision: 'abc123', observedAt: '2026-09-07T05:22:13.463Z',
    summary: { targetAttempted: 4, businessRequestCount: 6, metadataRequestCount: 2 },
    results: [
      { operationRef: 'base:ka10075', role: 'SOURCE_ORDER_HISTORY', attempted: true, attemptedAt: '2026-09-07T05:22:13.801Z', verdict: 'BLOCKED', reason: 'SOURCE_VALUE_NOT_AVAILABLE', httpStatus: 200, returnCode: '0' },
      { operationRef: 'base:ka10088', role: 'TARGET', attempted: false, verdict: 'BLOCKED', reason: 'NO_EXISTING_UNFILLED_ORDER' },
      { operationRef: 'detail:ka10004:sell_bid_prices', role: 'SOURCE_BEST_ASK', attempted: true, attemptedAt: '2026-09-07T05:22:14.137Z', verdict: 'PASS', reason: 'SOURCE_VALUE_OBSERVED_IN_MEMORY', httpStatus: 200, returnCode: 'NOT_EXPOSED_BY_DETAIL_PROJECTION' },
      ...targetIds.filter((id) => id.startsWith('detail:kt00010:')).map((operationRef, index) => ({ operationRef, role: 'TARGET', attempted: true, attemptedAt: `2026-09-07T05:22:${14 + index}.436Z`, marketPhase: { phase: 'REGULAR' }, verdict: 'BLOCKED', reason: 'DETAIL_PROJECTION_BUSINESS_OR_CONTRACT_FAILURE', httpStatus: 200, returnCode: '20', pagination: 'NOT_VERIFIED_SINGLE_PAGE' })),
      { operationRef: 'base:ka30003', role: 'TARGET', attempted: true, attemptedAt: '2026-09-07T05:22:16.756Z', marketPhase: { phase: 'REGULAR' }, verdict: 'PASS', reason: 'PASS_HTTP_JSON_DECLARED_ROOT_PRESENT', httpStatus: 200, returnCode: '0', pagination: 'NOT_VERIFIED_SINGLE_PAGE' },
    ],
  }];

  const rows = reconcileCoverage(data);
  const byId = new Map(rows.map((row) => [row.source_id, row]));
  assert.equal(byId.get('base:ka30003').live_evidence.status, 'LIVE_HTTP_JSON_ROOT_OBSERVED');
  assert.ok(targetIds.filter((id) => id.startsWith('detail:kt00010:')).every((id) => byId.get(id).live_evidence.status === 'LIVE_BLOCKED'));
  assert.ok(targetIds.filter((id) => id.startsWith('detail:kt00010:')).every((id) => /latest_reason=DETAIL_PROJECTION_BUSINESS_OR_CONTRACT_FAILURE/.test(byId.get(id).live_evidence.detail)));
  assert.ok(targetIds.filter((id) => id.startsWith('detail:kt00010:')).every((id) => byId.get(id).live_evidence.observations.at(-1).phase === 'REGULAR'));
  assert.equal(byId.get('base:ka10088').live_evidence.observed_at, null);
  assert.ok(byId.get('base:ka10088').live_evidence.observations.every((entry) => entry.observed_at === null));
  const firstHarnessObservation = byId.get('detail:ka10001:current_trading').live_evidence.observations.at(-1);
  assert.equal(firstHarnessObservation.timestamp_basis, 'ARTIFACT_LEVEL_ONLY_NO_PER_RESULT_TIMESTAMP');
  assert.equal(firstHarnessObservation.adjudication, 'HARNESS_RETURN_CODE_EXTRACTION_BUG_NOT_PROVIDER_FAILURE');
  assert.match(byId.get('detail:ka10001:current_trading').live_evidence.detail, /HARNESS_RETURN_CODE_EXTRACTION_BUG_NOT_PROVIDER_FAILURE/);

  data.finalReadInputs[1] = { ...data.finalReadInputs[1], mode: 'in_memory_fixture' };
  assert.throws(() => reconcileCoverage(data), /not approved loopback-live evidence/);
});

test('custom runner NOT_APPLICABLE remains product coverage with an explicit live gap', () => {
  const item = sourceItem({
    id: 'custom-api:POST:/mutate',
    source: 'custom_api_route',
    source_id: 'POST /mutate',
    classification: 'mutation_or_query_post',
  });
  const data = inputs([item]);
  data.readSweeps[0].results = [];
  data.customReadSweep.results = [{
    id: item.id,
    source: 'custom_api_route',
    verdict: 'NOT_APPLICABLE',
    reason: 'NON_GET_NOT_AUTHORIZED',
    observed_at: null,
    market_phase: { phase: 'REGULAR' },
    evidence: {},
  }];
  data.runtimeDiscovery.reconciliation.generated_api.routes = [];
  data.runtimeDiscovery.reconciliation.other_runtime_api.routes = [{ method: 'POST', path: '/mutate' }];
  const [row] = reconcileCoverage(data);
  assert.equal(row.executable, true);
  assert.equal(row.live_evidence.status, 'LIVE_RUNNER_NOT_APPLICABLE');
  assert.match(row.remaining_gap, /제품 기능 기준/);
});

test('isolated MCP protocol metadata upgrades source evidence while function execution remains NOT_RUN', () => {
  const items = ['athena__render_canvas', 'athena__save_canvas'].map((tool) => sourceItem({
    id: `mcp-tool:${tool}`,
    source: 'mcp_tool',
    source_path: 'backend/athena_mcp/server.py',
    source_id: tool,
    classification: 'tool',
  }));
  const data = inputs(items);
  data.readSweeps[0].results = [];
  data.runtimeDiscovery.reconciliation.generated_api.routes = [];
  data.mcpBuiltinsProbe = {
    kind: 'athena_mcp_builtins_protocol_probe', mode: 'isolated_stdio_protocol', verdict: 'PASS_PROTOCOL_METADATA_ONLY',
    scope: { initialize_count: 1, list_tools_count: 1, call_tool_count: 0, provider_processes_authorized: 0, user_registry_read: false, user_runtime_proven: false, upstream_connectivity_proven: false },
    isolation: { source_pin_count: 13, sdk_stdio_source_pin_verified: true },
    observation: {
      tool_count: 2, action_metadata_count: 0, exact_name_set_match: true, expected_action_count_match: true,
      name_fingerprint_sha256: 'dc90701f8e7fcdea6528404725892c545596cbc8f45d6bba7e61fd26d368f5c2',
      schema_fingerprint_sha256: '0e5bd7c6e0f9649df5b7a8ad1b79e8f577d1dfbd199f340e33018f4916f65195', schema_fingerprint_match: true,
    },
    cleanup: { sdk_context_cleanup_complete: true, os_process_exit_independently_verified: false },
  };
  const rows = reconcileCoverage(data);
  assert.deepEqual(rows.map((row) => row.id), ['mcp-tool:athena__render_canvas', 'mcp-tool:athena__save_canvas']);
  assert.ok(rows.every((row) => row.source_evidence.status === 'PROTOCOL_METADATA_MATCHED'));
  assert.ok(rows.every((row) => row.source_evidence.evidence[0] === 'mcp-protocol.json'));
  assert.ok(rows.every((row) => row.live_evidence.status === 'LIVE_NOT_RUN'));
  assert.ok(rows.every((row) => row.live_evidence.observed_at === null && row.live_evidence.evidence.length === 0));
  assert.ok(rows.every((row) => /tool call\/기능 실행 실측 없음/.test(row.live_evidence.detail)));
  data.mcpBuiltinsProbe = { ...data.mcpBuiltinsProbe, mode: 'user_gateway' };
  assert.throws(() => reconcileCoverage(data), /not approved isolated protocol metadata evidence/);
});

test('MCP action schema metadata does not become action execution evidence', () => {
  const item = sourceItem({
    id: 'mcp-action:athena_brain:questions', source: 'mcp_tool_action',
    source_path: 'backend/athena_mcp/brain_tools.py', source_id: 'athena_brain:questions', classification: 'tool_action',
  });
  const data = inputs([item]);
  data.readSweeps[0].results = [];
  data.runtimeDiscovery.reconciliation.generated_api.routes = [];
  data.mcpBuiltinsProbe = {
    kind: 'athena_mcp_builtins_protocol_probe', mode: 'isolated_stdio_protocol', verdict: 'PASS_PROTOCOL_METADATA_ONLY',
    scope: { initialize_count: 1, list_tools_count: 1, call_tool_count: 0, provider_processes_authorized: 0, user_registry_read: false, user_runtime_proven: false, upstream_connectivity_proven: false },
    isolation: { source_pin_count: 13, sdk_stdio_source_pin_verified: true },
    observation: {
      tool_count: 0, action_metadata_count: 1, exact_name_set_match: true, expected_action_count_match: true,
      name_fingerprint_sha256: 'dc90701f8e7fcdea6528404725892c545596cbc8f45d6bba7e61fd26d368f5c2',
      schema_fingerprint_sha256: '0e5bd7c6e0f9649df5b7a8ad1b79e8f577d1dfbd199f340e33018f4916f65195', schema_fingerprint_match: true,
    },
    cleanup: { sdk_context_cleanup_complete: true, os_process_exit_independently_verified: false },
  };
  const [row] = reconcileCoverage(data);
  assert.equal(row.source_evidence.status, 'PROTOCOL_METADATA_MATCHED');
  assert.match(row.source_evidence.detail, /action schema fingerprint/);
  assert.equal(row.live_evidence.status, 'LIVE_NOT_EXECUTED');
  assert.equal(row.live_evidence.observed_at, null);
});

test('accepts only approved loopback-live POST metadata evidence and preserves the earlier NOT_APPLICABLE record', () => {
  const ids = [
    'custom-api:POST:/api/v1/llm/tools/search',
    'custom-api:POST:/api/v1/llm/tools/describe',
  ];
  const items = ids.map((id) => sourceItem({ id, source: 'custom_api_route', source_id: `POST ${id.split('POST:')[1]}`, classification: 'mutation_or_query_post' }));
  const data = inputs(items);
  data.readSweeps[0].results = [];
  data.runtimeDiscovery.reconciliation.generated_api.routes = [];
  data.runtimeDiscovery.reconciliation.other_runtime_api.routes = ids.map((id) => ({ method: 'POST', path: id.split('POST:')[1] }));
  data.customReadSweep.results = ids.map((id) => ({ id, source: 'custom_api_route', verdict: 'NOT_APPLICABLE', reason: 'NON_GET_NOT_AUTHORIZED', observed_at: null, market_phase: null, evidence: null }));
  data.postMetadataProbe = {
    kind: 'athena_post_metadata_probe', revision: 'abc123', mode: 'loopback_live',
    scope: { exact_ids: ids, full_product_pass_claimed: false },
    admission: { network_response_received: true, metadata_requests: 1, business_requests: 2, transport_responses_received: 3 },
    results: ids.map((id, index) => ({ id, attempted: true, verdict: 'PASS_HTTP_JSON_SHAPE_ONLY', observed_at: `2026-09-07T04:08:0${index + 2}Z`, market_phase: { phase: 'REGULAR' }, http_status: 200, response_received: true })),
  };
  const rows = reconcileCoverage(data);
  assert.ok(rows.every((row) => row.live_evidence.status === 'LIVE_HTTP_JSON_SHAPE_OBSERVED'));
  assert.ok(rows.every((row) => row.live_evidence.observations.length === 2));
  assert.ok(rows.every((row) => row.live_evidence.observations[0].verdict === 'NOT_APPLICABLE' && row.live_evidence.observations[0].observed_at === null));
  assert.ok(rows.every((row) => row.live_evidence.observations[1].verdict === 'PASS_HTTP_JSON_SHAPE_ONLY'));
  assert.ok(rows.every((row) => /하위 기능\/UI 검증 아님/.test(row.live_evidence.detail)));
  data.postMetadataProbe = { ...data.postMetadataProbe, mode: 'in_memory_fixture' };
  assert.throws(() => reconcileCoverage(data), /not approved loopback-live evidence/);
});

test('maps the exact 12 compute POST contracts above the original non-GET snapshot without promoting UI, graph execution, or persistence', () => {
  const routes = [
    '/api/v1/backtest/validate', '/api/v1/backtest/flow', '/api/v1/backtest/map', '/api/v1/backtest/codegen',
    '/api/v1/backtest/diagnose', '/api/v1/backtest/optimize/plan', '/api/v1/backtest/technique/nodes',
    '/api/v1/backtest/visual/from-spec', '/api/v1/backtest/visual/validate', '/api/v1/backtest/visual/compile',
    '/api/v1/backtest/visual/question', '/api/v1/backtest/visual/patch',
  ];
  const ids = routes.map((route) => `custom-api:POST:${route}`);
  const data = inputs(ids.map((id, index) => sourceItem({ id, source: 'custom_api_route', source_id: `POST ${routes[index]}`, classification: 'mutation_or_query_post' })));
  data.readSweeps[0].results = [];
  data.runtimeDiscovery.reconciliation.generated_api.routes = [];
  data.runtimeDiscovery.reconciliation.other_runtime_api.routes = routes.map((route) => ({ method: 'POST', path: route }));
  data.customReadSweep.results = ids.map((id) => ({ id, source: 'custom_api_route', verdict: 'NOT_APPLICABLE', reason: 'NON_GET_NOT_AUTHORIZED', observed_at: null, market_phase: null, evidence: {} }));
  data.customComputeProbe = {
    schemaVersion: 1, kind: 'athena_custom_compute_probe', mode: 'loopback_live', revision: 'abc123',
    observedAt: '2026-09-07T06:13:05.829Z', marketPhaseAtStart: { phase: 'REGULAR' },
    fixture: {
      source: 'REPO_TEST_AND_PRESET_DERIVED_EXPLICIT_AUDIT_FIXTURE',
      yamlSha256: 'a'.repeat(64), pythonSha256: 'b'.repeat(64), diagnosePythonSha256: 'c'.repeat(64),
      rawFixturePersisted: false, marketDataIncluded: false,
    },
    scope: { targetCount: 12, businessRequestLimit: 16, sideEffects: 'FORBIDDEN', providerCalls: 'FORBIDDEN', optimizerExecution: 'FORBIDDEN' },
    results: routes.map((route, index) => ({
      operationId: `op-${index}`, method: 'POST', route, attempted: true,
      attemptedAt: `2026-09-07T06:13:${String(6 + Math.floor(index / 6)).padStart(2, '0')}.${String(index).padStart(3, '0')}Z`,
      marketPhase: { phase: 'REGULAR' }, httpStatus: 200, verdict: 'PASS', reason: 'PASS_HTTP_JSON_SEMANTIC_CONTRACT',
    })),
    summary: { targetCount: 12, attempted: 12, pass: 12, blocked: 0, businessRequests: 12, metadataRequests: 1 },
  };

  const rows = reconcileCoverage(data);
  assert.equal(rows.length, 12);
  assert.ok(rows.every((row) => row.live_evidence.status === 'LIVE_HTTP_JSON_SEMANTIC_CONTRACT_OBSERVED'));
  assert.ok(rows.every((row) => row.live_evidence.observations.length === 2));
  assert.ok(rows.every((row) => row.live_evidence.observations[0].verdict === 'NOT_APPLICABLE' && row.live_evidence.observations[0].observed_at === null));
  assert.ok(rows.every((row) => /UI\/graph 실행\/optimizer 실행\/지속화/.test(row.live_evidence.detail)));
  assert.ok(rows.every((row) => !/LIVE_PASS/.test(row.live_evidence.status)));

  data.customComputeProbe = { ...data.customComputeProbe, results: data.customComputeProbe.results.slice(1) };
  assert.throws(() => reconcileCoverage(data), /result exact set mismatch/);
});

test('merges custom chain targets and prerequisite reads without counting one request twice', () => {
  const source = sourceItem({ id: 'custom-api:GET:/source', source: 'custom_api_route', source_id: 'GET /source', classification: 'read' });
  const target = sourceItem({ id: 'custom-api:GET:/target/{id}', source: 'custom_api_route', source_id: 'GET /target/{id}', classification: 'read' });
  const data = inputs([source, target]);
  data.readSweeps[0].results = [];
  data.runtimeDiscovery.reconciliation.generated_api.routes = [];
  data.runtimeDiscovery.reconciliation.other_runtime_api.routes = [
    { method: 'GET', path: '/source' },
    { method: 'GET', path: '/target/{id}' },
  ];
  data.customReadSweep.results = [
    { id: source.id, source: 'custom_api_route', verdict: 'PASS', reason: 'HTTP_RESPONSE_SANITIZED', observed_at: '2026-09-07T00:30:00Z', market_phase: { phase: 'REGULAR' }, evidence: { http_status: 200 } },
    { id: target.id, source: 'custom_api_route', verdict: 'BLOCKED', reason: 'MISSING_SAFE_OBSERVED_INPUT', observed_at: null, market_phase: null, evidence: {} },
  ];
  const timestamp = '2026-09-07T01:00:00Z';
  data.customReadChains = [{
    revision: 'abc123',
    request_count: 2,
    summary: { total: 1, attempted: 1, PASS_HTTP_SCHEMA_ONLY: 1, BLOCKED: 0 },
    source_observations: [
      { id: source.id, verdict: 'PASS_HTTP_SCHEMA_ONLY', reason: 'HTTP_RESPONSE_SANITIZED', observed_at: timestamp, market_phase: { phase: 'REGULAR' } },
      { id: target.id, verdict: 'PASS_HTTP_SCHEMA_ONLY', reason: 'HTTP_RESPONSE_SANITIZED', observed_at: timestamp, market_phase: { phase: 'REGULAR' } },
    ],
    results: [{ id: target.id, attempted: true, verdict: 'PASS_HTTP_SCHEMA_ONLY', reason: 'HTTP_RESPONSE_SANITIZED', observed_at: timestamp, market_phase: { phase: 'REGULAR' }, evidence: { http_status: 200 } }],
    entrypoint: { business_request_count: 2, metadata_request_count: 1 },
  }];
  const rows = reconcileCoverage(data);
  const sourceRow = rows.find((row) => row.id === source.id);
  const targetRow = rows.find((row) => row.id === target.id);
  assert.equal(sourceRow.live_evidence.observations.length, 2);
  assert.equal(targetRow.live_evidence.observations.length, 1);
  assert.deepEqual(targetRow.live_evidence.observations[0].roles.sort(), ['chain_target', 'target_source']);
  assert.equal(targetRow.live_evidence.status, 'LIVE_HTTP_SCHEMA_PASS');
});

test('preserves custom chain history while the latest run controls the current verdict', () => {
  const target = sourceItem({ id: 'custom-api:GET:/target/{id}', source: 'custom_api_route', source_id: 'GET /target/{id}', classification: 'read' });
  const data = inputs([target]);
  data.readSweeps[0].results = [];
  data.runtimeDiscovery.reconciliation.generated_api.routes = [];
  data.runtimeDiscovery.reconciliation.other_runtime_api.routes = [{ method: 'GET', path: '/target/{id}' }];
  data.customReadSweep.results = [{ id: target.id, source: 'custom_api_route', verdict: 'BLOCKED', reason: 'MISSING_SAFE_OBSERVED_INPUT', observed_at: null, market_phase: null, evidence: {} }];
  const oldAt = '2026-09-07T01:00:00Z';
  const newAt = '2026-09-07T03:00:00Z';
  const chain = (observedAt, verdict, reason, httpStatus) => ({
    revision: 'abc123', request_count: 1,
    summary: { total: 1, attempted: 1, PASS_HTTP_SCHEMA_ONLY: verdict === 'PASS_HTTP_SCHEMA_ONLY' ? 1 : 0, BLOCKED: verdict === 'BLOCKED' ? 1 : 0 },
    source_observations: [{ id: target.id, verdict, reason, observed_at: observedAt, market_phase: { phase: 'REGULAR' } }],
    results: [{ id: target.id, attempted: true, verdict, reason, observed_at: observedAt, market_phase: { phase: 'REGULAR' }, evidence: { http_status: httpStatus } }],
    entrypoint: { business_request_count: 1, metadata_request_count: 1 },
  });
  data.customReadChains = [
    chain(oldAt, 'BLOCKED', 'SOURCE_HTTP_STATUS', 404),
    chain(newAt, 'PASS_HTTP_SCHEMA_ONLY', 'HTTP_RESPONSE_SANITIZED', 200),
  ];
  data.paths.customReadChains = ['old-chain.json', 'new-chain.json'];
  const [row] = reconcileCoverage(data);
  assert.equal(row.live_evidence.status, 'LIVE_HTTP_SCHEMA_PASS');
  assert.equal(row.live_evidence.observed_at, newAt);
  assert.deepEqual(row.live_evidence.observations.map((entry) => entry.observed_at), [oldAt, newAt]);
  assert.deepEqual(row.live_evidence.evidence, ['new-chain.json', 'old-chain.json']);
});

test('rejects an unattempted custom chain target promoted to schema PASS', () => {
  const target = sourceItem({ id: 'custom-api:GET:/target/{id}', source: 'custom_api_route', source_id: 'GET /target/{id}', classification: 'read' });
  const data = inputs([target]);
  data.readSweeps[0].results = [];
  data.runtimeDiscovery.reconciliation.generated_api.routes = [];
  data.runtimeDiscovery.reconciliation.other_runtime_api.routes = [{ method: 'GET', path: '/target/{id}' }];
  data.customReadSweep.results = [{ id: target.id, source: 'custom_api_route', verdict: 'BLOCKED', reason: 'MISSING_SAFE_OBSERVED_INPUT', observed_at: null, market_phase: null, evidence: {} }];
  data.customReadChains[0].results = [{ id: target.id, attempted: false, verdict: 'PASS_HTTP_SCHEMA_ONLY', reason: 'INVALID_PROMOTION' }];
  assert.throws(() => reconcileCoverage(data), /unattempted custom target cannot PASS/);
});

test('maps passive WS evidence to exact IDs while keeping events and condition actions unexecuted', () => {
  const item = sourceItem({
    id: 'operation:base:ka10171',
    source_id: 'base:ka10171',
    classification: 'websocket',
  });
  const data = inputs([item]);
  data.readSweeps[0].results = [];
  data.runtimeDiscovery.reconciliation.generated_api.routes = [{ method: 'POST', path: '/api/v1/websocket/ka10171' }];
  data.passiveWs.events.source_ids = [{ id: 'base:ka10171', status: 'NOT_OBSERVED', event_count: 0 }];
  const [row] = reconcileCoverage(data);
  assert.equal(row.live_evidence.status, 'LIVE_WS_CONDITION_NOT_EXECUTED');
  assert.match(row.live_evidence.detail, /auth=NOT_REJECTED_NO_ACK/);
  assert.match(row.remaining_gap, /실제 장 단계/);
});

test('preserves the blocked 0B history and maps the latest fresh event without claiming cleanup, REG causality, or the other 22 sources', () => {
  const websocketIds = ['00', '04', '0A', '0B', '0C', '0D', '0E', '0F', '0G', '0H', '0I', '0J', '0U', '0g', '0m', '0s', '0u', '0w', '1h', 'ka10171', 'ka10172', 'ka10173', 'ka10174'].map((id) => `base:${id}`);
  const stream = sourceItem({
    id: 'custom-api:WEBSOCKET:/api/v1/ws/stream', source: 'custom_api_route',
    source_id: 'WEBSOCKET /api/v1/ws/stream', classification: 'websocket',
  });
  const data = inputs([
    ...websocketIds.map((id) => sourceItem({ id: `operation:${id}`, source_id: id, classification: 'websocket' })),
    stream,
  ]);
  data.readSweeps[0].results = [];
  data.runtimeDiscovery.reconciliation.generated_api.routes = websocketIds.map((id) => ({ method: 'POST', path: `/api/v1/websocket/${id.split(':')[1]}` }));
  data.runtimeDiscovery.reconciliation.static_websocket_excluded.routes = [{ method: 'WEBSOCKET', path: '/api/v1/ws/stream' }];
  data.customReadSweep.results = [{ id: stream.id, source: 'custom_api_route', verdict: 'NOT_APPLICABLE', reason: 'NON_GET_NOT_AUTHORIZED', observed_at: null, market_phase: null, evidence: {} }];
  data.passiveWs.events.source_ids = websocketIds.map((id) => ({ id, status: 'NOT_OBSERVED' }));
  const blockedParserRun = {
    schema_version: 1, kind: 'athena_active_ws_stock_probe', revision: 'abc123', mode: 'EXECUTE',
    observed_at: '2026-09-07T05:28:15.996Z', market: { phase: 'REGULAR' },
    target: { tr_id: '0B', item: '005930' },
    source_reconciliation: { expected_count: 23, exact_set_equal: true },
    control: { reg_requests: 1, reg_status: 'CONTROL_ACK', remove_requests: 1, cleanup_status: 'CLEANUP_API_ZERO_ACK_OR_SYNTHETIC', upstream_remove_ack_verified: false },
    events: { status: 'BLOCKED_NO_LIVE_EVENT', counts: { real_envelope: 159, invalid_time: 288, valid: 0 } },
    socket: { owned_socket_only: true, close_status: 'OWNED_SOCKET_CLOSED' },
    safety: { other_tr_sent: false, condition_sent: false, order_sent: false },
    verdict: 'BLOCKED_NO_LIVE_EVENT',
  };
  const freshEventRun = {
    ...blockedParserRun,
    observed_at: '2026-09-07T05:46:09.218Z',
    events: {
      status: 'OBSERVED_VALID',
      counts: { real_envelope: 23, baseline_matching: 42, matching_row: 1, invalid_time: 0, stale: 0, valid: 1 },
      identity_match: true,
      time_shape_valid: true,
      fresh_within_120s: true,
      freshness_bucket: '<=5s',
    },
    verdict: 'PASS_WITH_CLEANUP_UNVERIFIED',
  };
  data.activeWsHistory = [blockedParserRun, freshEventRun];

  const rows = reconcileCoverage(data);
  const active0B = rows.find((row) => row.source_id === 'base:0B');
  const other = rows.find((row) => row.source_id === 'base:0A');
  const customStream = rows.find((row) => row.id === stream.id);
  assert.equal(active0B.live_evidence.status, 'LIVE_WS_FRESH_EVENT_OBSERVED_CLEANUP_UNVERIFIED');
  assert.equal(active0B.live_evidence.observations.length, 2);
  assert.deepEqual(active0B.live_evidence.observations.map((entry) => entry.verdict), ['BLOCKED_NO_LIVE_EVENT', 'PASS_WITH_CLEANUP_UNVERIFIED']);
  assert.match(active0B.live_evidence.detail, /REAL envelopes=23/);
  assert.match(active0B.live_evidence.detail, /baseline_matching_before_REG=42/);
  assert.match(active0B.live_evidence.detail, /valid_fresh=1/);
  assert.match(active0B.live_evidence.detail, /baseline 42건은 REG 인과성 증거가 아님/);
  assert.match(active0B.live_evidence.detail, /다른 22개 source는 실행하지 않음/);
  assert.equal(customStream.live_evidence.status, 'LIVE_WS_FRESH_EVENT_OBSERVED_CLEANUP_UNVERIFIED');
  assert.equal(customStream.live_evidence.observations.length, 2);
  assert.match(customStream.live_evidence.detail, /custom REST execution 집계와 별도/);
  assert.doesNotMatch(customStream.live_evidence.detail, /custom REST \d+개/);
  assert.notEqual(other.live_evidence.status, 'LIVE_WS_FRESH_EVENT_OBSERVED_CLEANUP_UNVERIFIED');
  assert.equal(other.live_evidence.observations.length, 1);

  data.activeWsHistory[1] = { ...freshEventRun, control: { ...freshEventRun.control, upstream_remove_ack_verified: true } };
  assert.throws(() => reconcileCoverage(data), /not approved bounded evidence/);
});

test('keeps case-sensitive WebSocket source IDs such as 0G and 0g distinct', () => {
  const items = ['0G', '0g'].map((code) => sourceItem({
    id: `operation:base:${code}`,
    source_id: `base:${code}`,
    classification: 'websocket',
  }));
  const data = inputs(items);
  data.readSweeps[0].results = [];
  data.runtimeDiscovery.reconciliation.generated_api.routes = items.map((item) => ({
    method: 'POST',
    path: `/api/v1/websocket/${item.source_id.split(':').at(-1)}`,
  }));
  data.passiveWs.events.source_ids = items.map((item) => ({ id: item.source_id, status: 'NOT_OBSERVED', event_count: 0 }));
  const rows = reconcileCoverage(data);
  assert.deepEqual(rows.map((row) => row.source_id), ['base:0G', 'base:0g']);
  assert.equal(new Set(rows.map((row) => row.id)).size, 2);
});

test('maps only the exact live UI mode and settings catalog IDs', () => {
  const items = [
    sourceItem({ id: 'catalog:mode:summary', source: 'runtime_catalog', source_id: 'summary', classification: 'mode' }),
    sourceItem({ id: 'catalog:settings:screen', source: 'runtime_catalog', source_id: 'screen', classification: 'settings' }),
  ];
  const data = inputs(items);
  data.readSweeps[0].results = [];
  data.runtimeDiscovery.reconciliation.generated_api.routes = [];
  data.liveUis[0].current_mode_surface.id = 'summary';
  data.liveUis[0].modes = [{ id: 'summary', control_exists: true, control_enabled: true, control_effective: true, navigation_status: 'BLOCKED_NAV_CREATES_HISTORY' }];
  data.liveUis[0].settings = [{ id: 'screen', clicked: true, selected: true, panel_rendered: true, panel_effective: true, read_status: 'BACKEND_READ_NOT_VERIFIED' }];
  data.liveUis[0].restoration = { settings_restored: true, selected_setting_restored: true };
  data.liveUis.push({
    started_at: '2026-09-07T03:29:36Z',
    modes: [{ id: 'summary', control_exists: true, control_enabled: true, control_effective: true, navigation_status: 'BLOCKED_NAV_CREATES_HISTORY' }],
    settings: [{ id: 'screen', clicked: true, selected: true, panel_rendered: true, panel_effective: true, read_status: 'BACKEND_READ_NOT_VERIFIED' }],
    current_mode_surface: { id: 'summary' },
    restoration: { settings_restored: true, selected_setting_restored: true },
  });
  data.paths.liveUis.push('ui-latest.json');
  const rows = reconcileCoverage(data);
  assert.equal(rows[0].fixture_evidence.status, 'FIXTURE_PASS');
  assert.equal(rows[0].live_evidence.status, 'LIVE_UI_CONTROL_PASS_NAV_BLOCKED');
  assert.equal(rows[1].live_evidence.status, 'LIVE_UI_RENDER_PASS_BACKEND_READ_NOT_VERIFIED');
  assert.equal(rows[0].live_evidence.observations.length, 2);
  assert.deepEqual(rows[0].live_evidence.evidence, ['ui.json', 'ui-latest.json']);
  assert.equal(rows.some((row) => row.live_evidence.status === 'LIVE_PASS'), false);
});

test('renders every row and states that the inventory count is not a unique feature count', () => {
  const rows = reconcileCoverage(inputs());
  const text = renderMarkdown(rows, {
    generated_at: '2026-09-07T00:00:00Z',
    revision: 'abc123',
    window_states: auditWindowStates('2026-09-07T00:00:00Z'),
    cross_cutting: [],
    paths: inputs().paths,
    validation: { source_count: 1, coverage_count: 1 },
  });
  assert.match(text, /고유 제품 기능 수가 아니다/);
  assert.match(text, /operation:base:ka1/);
  assert.doesNotMatch(text, /overall.*PASS/i);
});

test('derives the actual KST audit phase from each evidence timestamp', () => {
  assert.equal(marketPhaseAt('2026-09-06T23:59:00Z'), 'PRE_OPEN_30M');
  assert.equal(marketPhaseAt('2026-09-07T00:03:57Z'), 'REGULAR');
  assert.equal(marketPhaseAt('2026-09-07T06:40:00Z'), 'POST_CLOSE_1H');
  assert.equal(marketPhaseAt('2026-09-07T08:00:00Z'), 'OUTSIDE_AUDIT_WINDOW');
});

test('marks future KST audit windows NOT_DUE without inventing observations', () => {
  assert.deepEqual(auditWindowStates('2026-09-07T00:03:57Z'), {
    PRE_OPEN_30M: 'ELAPSED_NO_BLANKET_VERDICT',
    REGULAR: 'IN_PROGRESS',
    POST_CLOSE_1H: 'NOT_DUE',
  });
});
