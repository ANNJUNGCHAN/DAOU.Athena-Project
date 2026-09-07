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
      customReadSweep: 'custom.json',
      customReadChains: ['custom-chain.json'],
      postMetadataProbe: 'approved-post.json',
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
  data.runtimeDiscovery.reconciliation.generated_api.routes = data.readSweeps[0].results.map((row) => row.route);
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

test('server-defined canvas MCP builtins remain NOT_RUN until the MCP protocol is observed', () => {
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
  const rows = reconcileCoverage(data);
  assert.deepEqual(rows.map((row) => row.id), ['mcp-tool:athena__render_canvas', 'mcp-tool:athena__save_canvas']);
  assert.ok(rows.every((row) => row.source_evidence.status === 'SOURCE_DECLARED'));
  assert.ok(rows.every((row) => row.live_evidence.status === 'LIVE_NOT_RUN'));
  assert.ok(rows.every((row) => row.live_evidence.observed_at === null && row.live_evidence.evidence.length === 0));
  assert.ok(rows.every((row) => /tools\/list 또는 call 실측 없음/.test(row.live_evidence.detail)));
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
