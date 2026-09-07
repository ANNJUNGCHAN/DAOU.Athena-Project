import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PATHS = Object.freeze({
  inventory: 'artifacts/market-session-audit/2026-09-07/inventory-expanded-20260907.json',
  readSweeps: Object.freeze([
    'artifacts/market-session-audit/2026-09-07/read-sweep-20260907T090719KST.json',
    'artifacts/market-session-audit/2026-09-07/read-sweep-20260907T093755KST.json',
    'artifacts/market-session-audit/2026-09-07/read-sweep-20260907T102242KST.json',
  ]),
  readInputChain: 'artifacts/market-session-audit/2026-09-07/read-input-chain-20260907T131253KST.json',
  customReadSweep: 'artifacts/market-session-audit/2026-09-07/custom-read-sweep-20260907T003436-339Z.json',
  customReadChains: Object.freeze([
    'artifacts/market-session-audit/2026-09-07/custom-read-chain-live-20260907T015345-885Z.json',
    'artifacts/market-session-audit/2026-09-07/custom-read-chain-live-20260907T033434-309Z.json',
  ]),
  postMetadataProbe: 'artifacts/market-session-audit/2026-09-07/post-metadata-probe-20260907T040802-456Z.json',
  liveUis: Object.freeze([
    'artifacts/market-session-audit/2026-09-07/live-ui-2026-09-07T00-48-39-849Z-49728.json',
    'artifacts/market-session-audit/2026-09-07/live-ui-2026-09-07T03-29-36-409Z-16660.json',
  ]),
  passiveWs: 'artifacts/market-session-audit/2026-09-07/ws-passive-20260907T004108-394Z.json',
  customReadAdjudication: 'docs/audits/market-session-20260907/CUSTOM-API-DETAILS.md',
  modeFixtureDetails: 'docs/audits/market-session-20260907/MODE-FIXTURE-DETAILS.md',
  modeEvidence: Object.freeze({
    backtest: Object.freeze([
      'artifacts/market-session-audit/2026-09-07/baseline-tests/fixture-backtest-20260907-101427-1178.log',
      'artifacts/market-session-audit/2026-09-07/baseline-tests/backtest-mode-probe-20260907-101531-1952.json',
    ]),
    agent: Object.freeze([
      'artifacts/market-session-audit/2026-09-07/baseline-tests/fixture-agent-parity-20260907-101446-5313.log',
      'artifacts/market-session-audit/2026-09-07/baseline-tests/probe-agent-paper-parity-20260907-101531-1952.json',
    ]),
    session: Object.freeze([
      'artifacts/market-session-audit/2026-09-07/baseline-tests/fixture-session-restore-20260907-101506-9521.log',
    ]),
    graph: Object.freeze([
      'artifacts/market-session-audit/2026-09-07/baseline-tests/isolated-graph-mode-20260907-101545-8936.log',
      'artifacts/market-session-audit/2026-09-07/baseline-tests/isolated-graph-mode-userdir-20260907-101654-4593.log',
      'artifacts/market-session-audit/2026-09-07/baseline-tests/verify-graph-mode-20260907-101802-6015.json',
    ]),
    fullVerify: Object.freeze([
      'artifacts/market-session-audit/2026-09-07/baseline-tests/fixture-verify-full-20260907-101818-8162.log',
      'artifacts/market-session-audit/2026-09-07/baseline-tests/fixture-verify-full-npm-20260907-101939-3151.log',
      'artifacts/market-session-audit/2026-09-07/baseline-tests/VERIFY-REPORT-fixture-20260907-102211-8156.json',
    ]),
  }),
  runtimeDiscovery: 'artifacts/market-session-audit/2026-09-07/runtime-discovery-20260907T000357-672Z.json',
  paperCards: 'artifacts/market-session-audit/2026-09-07/baseline-tests/post-20260907-084326-PAPER-CARDS.json',
  paperScreens: 'artifacts/market-session-audit/2026-09-07/baseline-tests/post-20260907-084326-PAPER-SCREENS.json',
  paperMini: 'artifacts/market-session-audit/2026-09-07/baseline-tests/post-20260907-084326-PAPER-MINI.json',
  output: 'docs/audits/market-session-20260907/COVERAGE.md',
});

const ALLOWED_SWEEP_VERDICTS = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN']);
const POST_METADATA_TARGET_IDS = Object.freeze([
  'custom-api:POST:/api/v1/llm/tools/search',
  'custom-api:POST:/api/v1/llm/tools/describe',
]);
const READ_INPUT_SOURCE_IDS = Object.freeze(['base:ka01300', 'base:ka10102', 'base:ka40007', 'base:ka90001']);
const READ_INPUT_TARGET_IDS = Object.freeze(['base:ka01301', 'base:ka10039', 'base:ka10043', 'base:ka10052', 'base:ka10078', 'base:ka40001', 'base:ka90002']);

function uniqueMap(rows, keyFn, label) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) throw new Error(`${label} contains a row without an exact identity`);
    if (map.has(key)) throw new Error(`${label} contains duplicate identity: ${key}`);
    map.set(key, row);
  }
  return map;
}

function routeIdentity(route) {
  return `${String(route?.method || '').toUpperCase()} ${route?.path || ''}`;
}

function splitMethodPath(value) {
  const match = /^(\S+)\s+(.+)$/.exec(value || '');
  return match ? { method: match[1].toUpperCase(), path: match[2] } : null;
}

function screenExpectedRoute(item, sweepRow) {
  const code = String(item.source_id || '').split(':').at(-1);
  if (!code) return null;
  if (item.classification === 'read_display') return sweepRow?.route || null;
  if (item.classification === 'websocket') return { method: 'POST', path: `/api/v1/websocket/${code}` };
  if (item.classification === 'order') return { method: 'POST', path: `/api/v1/order/${code}` };
  if (item.classification === 'oauth') return { method: 'POST', path: `/api/v1/internal/oauth/${code}` };
  return null;
}

export function marketPhaseAt(isoTimestamp) {
  if (!isoTimestamp) return null;
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minute = Number(value.hour) * 60 + Number(value.minute);
  if (minute >= 8 * 60 + 30 && minute < 9 * 60) return 'PRE_OPEN_30M';
  if (minute >= 9 * 60 && minute < 15 * 60 + 30) return 'REGULAR';
  if (minute >= 15 * 60 + 30 && minute <= 16 * 60 + 30) return 'POST_CLOSE_1H';
  return 'OUTSIDE_AUDIT_WINDOW';
}

export function auditWindowStates(isoTimestamp) {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) throw new Error('valid generation timestamp is required');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minute = Number(value.hour) * 60 + Number(value.minute);
  const windows = [
    ['PRE_OPEN_30M', 8 * 60 + 30, 9 * 60],
    ['REGULAR', 9 * 60, 15 * 60 + 30],
    ['POST_CLOSE_1H', 15 * 60 + 30, 16 * 60 + 30],
  ];
  return Object.fromEntries(windows.map(([name, start, end]) => [
    name,
    minute < start ? 'NOT_DUE' : minute < end ? 'IN_PROGRESS' : 'ELAPSED_NO_BLANKET_VERDICT',
  ]));
}

function fixtureEvidence(item, maps, paths) {
  let row;
  let evidence;
  if (item.source === 'paper_board') {
    if (item.classification === 'screen' || item.classification === 'contract') {
      row = maps.screens.get(item.source_id);
      evidence = paths.paperScreens;
    } else if (item.classification === 'card_template') {
      row = maps.cards.get(item.source_id);
      evidence = paths.paperCards;
    } else if (item.classification === 'mini_card') {
      row = maps.mini.get(item.source_id);
      evidence = paths.paperMini;
    }
  } else if (item.source === 'paper_route') {
    row = maps.screens.get(item.source_id);
    evidence = paths.paperScreens;
  } else if (item.source === 'card_surface_catalog') {
    row = maps.cards.get(item.source_id);
    evidence = paths.paperCards;
  } else if (item.source === 'runtime_mini_grammar') {
    const covered = maps.miniGrammars.has(item.source_id);
    return {
      status: covered ? 'STATIC_PASS' : 'STATIC_BLOCKED',
      observed_at: maps.paperMiniGeneratedAt,
      detail: covered ? '문법 ID가 정적 mini grammar coverage에 정확히 포함됨' : '정적 mini grammar coverage에 정확한 ID 없음',
      evidence: [paths.paperMini],
    };
  } else if (item.source === 'runtime_catalog' && item.classification === 'mode') {
    const modeProof = maps.modeFixtureProof.get(item.source_id);
    if (modeProof) {
      return {
        status: 'FIXTURE_PASS',
        observed_at: null,
        detail: modeProof.detail,
        evidence: [paths.modeFixtureDetails, ...modeProof.paths],
      };
    }
  }
  if (!row) {
    return {
      status: item.executable ? 'NO_EXACT_FIXTURE_EVIDENCE' : 'NOT_APPLICABLE',
      observed_at: null,
      detail: item.executable ? '동일 source_id의 fixture 결과가 없음' : '비실행 source/reference 레코드',
      evidence: [],
    };
  }
  const raw = String(row.status || '').toLowerCase();
  const pass = raw === 'pass' || raw === 'matched';
  const fail = raw === 'fail' || raw === 'divergent';
  return {
    status: pass ? 'FIXTURE_PASS' : fail ? 'FIXTURE_FAIL' : 'FIXTURE_BLOCKED',
    observed_at: row.__generated_at,
    detail: `exact_id=${item.source_id}; result=${row.status}`,
    evidence: [evidence],
  };
}

function liveEvidence(item, maps, paths) {
  if (item.source === 'screen_definition' && item.classification === 'read_display') {
    const observations = maps.sweepObservations.get(item.source_id) || [];
    const row = observations.at(-1);
    if (!row) return { status: 'LIVE_BLOCKED', phase: null, observed_at: null, observations: [], detail: '정확한 operationRef 결과 없음', evidence: [] };
    const boundedRootObservation = row.verdict === 'PASS'
      && (row.reason === 'PASS_HTTP_JSON_DECLARED_ROOT_PRESENT' || row.reason === 'SOURCE_VALUE_OBSERVED_IN_MEMORY');
    const status = row.verdict === 'PASS'
      ? boundedRootObservation ? 'LIVE_HTTP_JSON_ROOT_OBSERVED' : 'LIVE_PASS'
      : row.verdict === 'FAIL'
        ? 'LIVE_FAIL_UNADJUDICATED'
        : row.verdict === 'BLOCKED'
          ? 'LIVE_BLOCKED'
          : 'LIVE_NOT_RUN';
    return {
      status,
      phase: row.marketPhase || null,
      observed_at: row.attemptedAt || null,
      observations: observations.map((entry) => ({
        phase: entry.marketPhase || null,
        observed_at: entry.attemptedAt || null,
        verdict: entry.verdict,
        reason: entry.reason || 'UNSPECIFIED',
        evidence_path: entry.__evidence_path,
      })),
      detail: `latest_verdict=${row.verdict}; latest_reason=${row.reason || 'UNSPECIFIED'}; observations=${observations.length}; pagination=${row.pagination || 'NOT_RECORDED'}; freshness=${row.freshness || 'NOT_RECORDED'}; ${boundedRootObservation ? 'HTTP/JSON/business code와 선언 root 또는 source 값만 관찰; 전체 schema/end-to-end/전체 페이지/현재성 검증 아님' : 'FAIL은 제품 결함 확정 전 판정 대기'}`,
      evidence: [...new Set(observations.map((entry) => entry.__evidence_path))],
    };
  }
  if (item.source === 'custom_api_route') {
    const row = maps.customLatest.get(item.id);
    if (!row) return { status: 'LIVE_BLOCKED', phase: null, observed_at: null, observations: [], detail: '정확한 custom route 결과 없음', evidence: [] };
    const phase = typeof row.market_phase === 'string' ? row.market_phase : row.market_phase?.phase || null;
    const observedAt = row.observed_at || null;
    const observations = maps.customObservations.get(item.id) || [];
    let status;
    const expectedDisabled = maps.expectedDisabledCustomIds.has(item.id)
      && row.verdict === 'FAIL'
      && row.evidence?.http_status === 503;
    if (expectedDisabled) status = 'LIVE_BLOCKED_SAFE_CONFIG';
    else if (row.attempted === false) status = 'LIVE_BLOCKED';
    else if (row.verdict === 'PASS' || row.verdict === 'PASS_HTTP_SCHEMA_ONLY') status = 'LIVE_HTTP_SCHEMA_PASS';
    else if (row.verdict === 'PASS_HTTP_JSON_SHAPE_ONLY') status = 'LIVE_HTTP_JSON_SHAPE_OBSERVED';
    else if (row.verdict === 'NOT_APPLICABLE') status = 'LIVE_RUNNER_NOT_APPLICABLE';
    else if (row.verdict === 'FAIL') status = 'LIVE_FAIL_UNADJUDICATED';
    else status = 'LIVE_BLOCKED';
    const envNote = expectedDisabled
      ? '; adjudication=DOCUMENTED_EXPECTED_DISABLED; audit 환경에서 routines 비활성화'
      : '';
    const legacySchemaNote = row.verdict === 'PASS_HTTP_SCHEMA_ONLY'
      ? '; raw verdict label only: HTTP 2xx+JSON 파싱+구조 fingerprint 관찰, OpenAPI 응답 계약/필드 의미/데이터 정확성 검증 아님'
      : '';
    const postMetadataNote = row.verdict === 'PASS_HTTP_JSON_SHAPE_ONLY'
      ? '; metadata-only: HTTP 2xx+JSON shape 관찰, 완전한 schema/필드 의미/데이터 정확성/하위 기능/UI 검증 아님'
      : '';
    return {
      status,
      phase,
      observed_at: observedAt,
      observations,
      detail: `verdict=${row.verdict}; attempted=${row.attempted ?? Boolean(observedAt)}; reason=${row.reason}; http_status=${row.evidence?.http_status ?? row.http_status ?? 'NOT_EXECUTED'}; actual_observations=${observations.filter((entry) => entry.observed_at).length}${envNote}${legacySchemaNote}${postMetadataNote}`,
      evidence: [...new Set([
        ...(expectedDisabled ? [paths.customReadAdjudication] : []),
        ...(row.__evidence_path ? [row.__evidence_path] : []),
        ...observations.map((entry) => entry.evidence_path),
      ])],
    };
  }
  if (item.source === 'screen_definition' && item.classification === 'websocket') {
    const row = maps.wsEvents.get(item.source_id);
    if (!row) return { status: 'LIVE_BLOCKED', phase: null, observed_at: null, observations: [], detail: 'passive WS exact source_id 결과 없음', evidence: [] };
    const conditionOperation = maps.wsConditionIds.has(item.source_id);
    const status = !maps.wsConnectionOk
      ? 'LIVE_WS_CONNECTION_FAIL'
      : conditionOperation ? 'LIVE_WS_CONDITION_NOT_EXECUTED' : 'LIVE_WS_EVENT_NOT_OBSERVED';
    return {
      status,
      phase: maps.wsPhase,
      observed_at: maps.wsObservedAt,
      observations: [{ phase: maps.wsPhase, observed_at: maps.wsObservedAt, verdict: row.status, reason: conditionOperation ? 'PASSIVE_NO_CONDITION_ACTION' : 'NO_REAL_EVENT', evidence_path: paths.passiveWs }],
      detail: `connection=${maps.wsConnection.status}; close_code=${maps.wsConnection.close_code}; cleanup=${maps.wsConnection.cleanup_status}; auth=${maps.wsAuthentication}; event=${row.status}; ${conditionOperation ? 'condition operation은 passive 관찰로 실행하지 않음' : 'REAL event envelope 미관찰'}`,
      evidence: [paths.passiveWs],
    };
  }
  if (item.source === 'runtime_catalog' && item.classification === 'mode') {
    const row = maps.uiModes.get(item.source_id);
    const controlOk = row.control_exists === true && row.control_enabled === true && row.control_effective === true;
    return {
      status: controlOk ? 'LIVE_UI_CONTROL_PASS_NAV_BLOCKED' : 'LIVE_UI_CONTROL_FAIL',
      phase: maps.uiPhase,
      observed_at: maps.uiObservedAt,
      observations: maps.uiModeObservations.get(item.source_id),
      detail: `control_exists=${row.control_exists}; enabled=${row.control_enabled}; effective=${row.control_effective}; navigation=${row.navigation_status}; click_not_performed${item.source_id === maps.currentUiMode ? '; current_surface_verified=true' : ''}`,
      evidence: paths.liveUis,
    };
  }
  if (item.source === 'runtime_catalog' && item.classification === 'settings') {
    const row = maps.uiSettings.get(item.source_id);
    const renderOk = row.clicked === true && row.selected === true && row.panel_rendered === true && row.panel_effective === true && maps.uiRestored;
    return {
      status: renderOk ? 'LIVE_UI_RENDER_PASS_BACKEND_READ_NOT_VERIFIED' : 'LIVE_UI_RENDER_FAIL',
      phase: maps.uiPhase,
      observed_at: maps.uiObservedAt,
      observations: maps.uiSettingObservations.get(item.source_id),
      detail: `clicked=${row.clicked}; selected=${row.selected}; rendered=${row.panel_rendered}; effective=${row.panel_effective}; restored=${maps.uiRestored}; backend_read=${row.read_status}`,
      evidence: paths.liveUis,
    };
  }
  if (item.id === 'discovery:runtime-openapi') {
    return {
      status: maps.runtimeOpenApiExact ? 'LIVE_DISCOVERY_PASS' : 'LIVE_BLOCKED',
      phase: maps.runtimePhase,
      observed_at: maps.runtimeObservedAt,
      detail: maps.runtimeOpenApiExact ? '정적 HTTP route 집합과 runtime OpenAPI 집합의 양방향 차이 0' : 'runtime OpenAPI exact reconciliation 불완전',
      evidence: [paths.runtimeDiscovery],
    };
  }
  if (item.id === 'discovery:runtime-mcp-tools-list') {
    return {
      status: 'LIVE_BLOCKED',
      phase: maps.runtimePhase,
      observed_at: maps.runtimeObservedAt,
      detail: '실제 tools/list 캡처 없음',
      evidence: [paths.runtimeDiscovery],
    };
  }
  if (item.id === 'mcp-tool:athena__render_canvas' || item.id === 'mcp-tool:athena__save_canvas') {
    return {
      status: 'LIVE_NOT_RUN',
      phase: null,
      observed_at: null,
      observations: [],
      detail: 'server.py builtin 정적 원천만 확인; 실제 MCP tools/list 또는 call 실측 없음',
      evidence: [],
    };
  }
  return {
    status: item.executable ? 'LIVE_NOT_EXECUTED' : 'NOT_APPLICABLE',
    phase: null,
    observed_at: null,
    detail: item.executable ? '현재 실행 증거와 exact ID join 없음' : '비실행 source/reference 레코드',
    evidence: [],
  };
}

function sourceEvidence(item, maps, paths) {
  if (item.source === 'screen_definition') {
    const sweepRow = maps.sweepRoute.get(item.source_id);
    const expected = screenExpectedRoute(item, sweepRow);
    const identity = expected && routeIdentity(expected);
    const found = identity && maps.generatedRoutes.has(identity);
    return {
      status: found ? 'RUNTIME_DISCOVERED_EXACT' : 'SOURCE_ONLY_BLOCKED',
      detail: found ? identity : '정확한 runtime route identity를 확인하지 못함',
      evidence: found ? [paths.runtimeDiscovery] : [],
    };
  }
  if (item.source === 'custom_api_route') {
    const expected = splitMethodPath(item.source_id);
    if (expected?.method === 'WEBSOCKET') {
      const identity = routeIdentity(expected);
      const found = maps.staticWebsocketRoutes.has(identity);
      return {
        status: found ? 'STATIC_WEBSOCKET_DECLARED' : 'SOURCE_ONLY_BLOCKED',
        detail: found ? `${identity}; OpenAPI 비대상` : '정확한 WebSocket route identity 없음',
        evidence: found ? [paths.runtimeDiscovery] : [],
      };
    }
    const identity = expected && routeIdentity(expected);
    const found = identity && maps.otherRuntimeRoutes.has(identity);
    return {
      status: found ? 'RUNTIME_DISCOVERED_EXACT' : 'SOURCE_ONLY_BLOCKED',
      detail: found ? identity : '정확한 runtime route identity를 확인하지 못함',
      evidence: found ? [paths.runtimeDiscovery] : [],
    };
  }
  return {
    status: item.executable ? 'SOURCE_DECLARED' : 'SOURCE_RECORD_ONLY',
    detail: item.source_path || 'inventory source reference',
    evidence: [],
  };
}

function remainingGap(item, fixture, live) {
  if (!item.executable) return 'N/A — 비실행 source/reference 레코드';
  const gaps = [];
  if (!fixture.status.endsWith('PASS')) gaps.push('fixture/static exact-ID 정상 증거 미완료');
  if (live.status !== 'LIVE_PASS') gaps.push('제품 기능 기준 실제 장 단계 정상 증거 미완료');
  if (!live.phase) gaps.push('실측 장 단계 없음');
  return gaps.length ? gaps.join('; ') : '없음 (fixture와 live는 각각 별도 증거로만 판정)';
}

export function reconcileCoverage({ inventory, readSweeps, readInputChain = null, customReadSweep, customReadChains, postMetadataProbe = null, customReadAdjudication = '', modeFixtureDetails = '', liveUis, passiveWs, runtimeDiscovery, paperCards, paperScreens, paperMini, paths = DEFAULT_PATHS }) {
  if (!Array.isArray(inventory?.items)) throw new Error('inventory.items is required');
  const inventoryById = uniqueMap(inventory.items, (row) => row.id, 'inventory');
  if (inventoryById.size !== inventory.items.length) throw new Error('inventory ID mismatch');

  const readInventoryIds = new Set(inventory.items
    .filter((row) => row.source === 'screen_definition' && row.classification === 'read_display')
    .map((row) => row.source_id));
  if (!Array.isArray(readSweeps) || readSweeps.length === 0) throw new Error('at least one named read sweep is required');
  const sweepObservations = new Map([...readInventoryIds].map((id) => [id, []]));
  for (let index = 0; index < readSweeps.length; index += 1) {
    const artifact = readSweeps[index];
    const evidencePath = paths.readSweeps[index];
    const artifactRows = uniqueMap(artifact?.results || [], (row) => row.operationRef, `read sweep ${index + 1}`);
    for (const [operationRef, row] of artifactRows) {
      if (!readInventoryIds.has(operationRef)) throw new Error(`read sweep source mismatch: ${operationRef}`);
      if (!ALLOWED_SWEEP_VERDICTS.has(row.verdict)) throw new Error(`unsupported sweep verdict: ${row.verdict}`);
      sweepObservations.get(operationRef).push({ ...row, __evidence_path: evidencePath });
    }
  }
  const readInputRequired = READ_INPUT_TARGET_IDS.some((id) => readInventoryIds.has(id));
  if (readInputRequired) {
    const expectedIds = [...READ_INPUT_SOURCE_IDS, ...READ_INPUT_TARGET_IDS].sort();
    if (expectedIds.some((id) => !readInventoryIds.has(id))) throw new Error('read input chain inventory exact set mismatch');
    if (readInputChain?.mode !== 'loopback_live'
      || readInputChain?.scope?.sourceOperations !== READ_INPUT_SOURCE_IDS.length
      || readInputChain?.scope?.targetOperations !== READ_INPUT_TARGET_IDS.length
      || readInputChain?.scope?.pagesPerOperation !== 1
      || readInputChain?.summary?.attempted !== expectedIds.length
      || readInputChain?.summary?.businessRequestCount !== expectedIds.length
      || readInputChain?.summary?.metadataRequestCount !== 1) throw new Error('read input chain is not approved loopback-live evidence');
    const chainRows = uniqueMap(readInputChain?.results || [], (row) => row.operationRef, 'read input chain results');
    if (chainRows.size !== expectedIds.length || expectedIds.some((id) => !chainRows.has(id))) throw new Error('read input chain result exact set mismatch');
    for (const [operationRef, row] of chainRows) {
      const source = READ_INPUT_SOURCE_IDS.includes(operationRef);
      const expectedReason = source ? 'SOURCE_VALUE_OBSERVED_IN_MEMORY' : 'PASS_HTTP_JSON_DECLARED_ROOT_PRESENT';
      if (row.role !== (source ? 'SOURCE' : 'TARGET') || row.attempted !== true || row.verdict !== 'PASS'
        || row.reason !== expectedReason || row.httpStatus !== 200 || row.returnCode !== '0' || !row.attemptedAt
        || row.pagination !== 'NOT_VERIFIED_SINGLE_PAGE' || row.freshness !== 'NOT_VERIFIED') {
        throw new Error(`read input chain result contract mismatch: ${operationRef}`);
      }
      sweepObservations.get(operationRef).push({ ...row, __evidence_path: paths.readInputChain });
    }
  }
  const missingReadIds = [...sweepObservations].filter(([, rows]) => rows.length === 0).map(([id]) => id);
  if (missingReadIds.length) {
    throw new Error(`read sweep exact union mismatch: missing=${missingReadIds.length}`);
  }
  for (const rows of sweepObservations.values()) rows.sort((a, b) => String(a.attemptedAt || '').localeCompare(String(b.attemptedAt || '')));

  const customInventoryIds = new Set(inventory.items.filter((row) => row.source === 'custom_api_route').map((row) => row.id));
  const customSweep = uniqueMap(customReadSweep?.results || [], (row) => row.id, 'custom read sweep');
  for (const [id, row] of customSweep) {
    if (!customInventoryIds.has(id) || row.source !== 'custom_api_route') throw new Error(`custom sweep source mismatch: ${id}`);
  }
  if (customSweep.size !== customInventoryIds.size) {
    throw new Error(`custom sweep exact set mismatch: inventory=${customInventoryIds.size} sweep=${customSweep.size}`);
  }
  const oldBlockedIds = new Set([...customSweep].filter(([, row]) => row.verdict === 'BLOCKED').map(([id]) => id));
  if (!Array.isArray(customReadChains) || customReadChains.length === 0 || customReadChains.length !== paths.customReadChains.length) {
    throw new Error('custom read chain history and paths are required');
  }
  const customChainRuns = customReadChains.map((artifact, index) => {
    const targets = uniqueMap(artifact?.results || [], (row) => row.id, `custom read chain ${index + 1} targets`);
    if (targets.size !== oldBlockedIds.size || [...targets.keys()].some((id) => !oldBlockedIds.has(id))) {
      throw new Error(`custom read chain target set mismatch: old_blocked=${oldBlockedIds.size} targets=${targets.size}`);
    }
    for (const [id, row] of targets) {
      if (!customInventoryIds.has(id)) throw new Error(`custom read chain source mismatch: ${id}`);
      if (row.attempted === false && row.verdict === 'PASS_HTTP_SCHEMA_ONLY') throw new Error(`unattempted custom target cannot PASS: ${id}`);
      if (row.attempted === true && !row.observed_at) throw new Error(`attempted custom target missing timestamp: ${id}`);
    }
    const sources = uniqueMap(artifact?.source_observations || [], (row) => row.id, `custom read chain ${index + 1} source observations`);
    for (const id of sources.keys()) if (!customInventoryIds.has(id)) throw new Error(`custom read chain prerequisite source mismatch: ${id}`);
    if (artifact?.request_count !== sources.size
      || artifact?.entrypoint?.business_request_count !== sources.size
      || artifact?.entrypoint?.metadata_request_count !== 1) throw new Error('custom read chain request accounting mismatch');
    return { artifact, targets, sources, evidencePath: paths.customReadChains[index] };
  });

  const customLatest = new Map([...customSweep].map(([id, row]) => [id, { ...row, __evidence_path: paths.customReadSweep }]));
  for (const run of customChainRuns) for (const [id, row] of run.targets) customLatest.set(id, { ...row, __evidence_path: run.evidencePath });
  const postRequired = POST_METADATA_TARGET_IDS.some((id) => customInventoryIds.has(id));
  let postMetadataTargets = new Map();
  if (postRequired) {
    if (POST_METADATA_TARGET_IDS.some((id) => !customInventoryIds.has(id))) throw new Error('post metadata probe inventory exact set mismatch');
    if (postMetadataProbe?.kind !== 'athena_post_metadata_probe'
      || postMetadataProbe?.mode !== 'loopback_live'
      || postMetadataProbe?.scope?.full_product_pass_claimed !== false
      || postMetadataProbe?.admission?.network_response_received !== true
      || postMetadataProbe?.admission?.metadata_requests !== 1
      || postMetadataProbe?.admission?.business_requests !== 2
      || postMetadataProbe?.admission?.transport_responses_received !== 3) {
      throw new Error('post metadata probe is not approved loopback-live evidence');
    }
    const scopeIds = [...(postMetadataProbe?.scope?.exact_ids || [])].sort();
    if (scopeIds.length !== POST_METADATA_TARGET_IDS.length || scopeIds.some((id, index) => id !== [...POST_METADATA_TARGET_IDS].sort()[index])) throw new Error('post metadata probe scope exact set mismatch');
    postMetadataTargets = uniqueMap(postMetadataProbe?.results || [], (row) => row.id, 'post metadata probe targets');
    if (postMetadataTargets.size !== POST_METADATA_TARGET_IDS.length || POST_METADATA_TARGET_IDS.some((id) => !postMetadataTargets.has(id))) throw new Error('post metadata probe result exact set mismatch');
    for (const [id, row] of postMetadataTargets) {
      if (row.attempted !== true || row.verdict !== 'PASS_HTTP_JSON_SHAPE_ONLY' || row.http_status !== 200 || row.response_received !== true || !row.observed_at) throw new Error(`post metadata probe result contract mismatch: ${id}`);
      customLatest.set(id, { ...row, reason: 'HTTP_JSON_SHAPE_SANITIZED', __evidence_path: paths.postMetadataProbe });
    }
  }
  const customObservations = new Map([...customInventoryIds].map((id) => [id, []]));
  const addCustomObservation = (id, row, role, includeUnobserved = false) => {
    if (!row?.observed_at && !includeUnobserved) return;
    const list = customObservations.get(id);
    const key = `${id}\u0000${row.observed_at || 'NOT_OBSERVED'}`;
    const existing = list.find((entry) => entry.__key === key);
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role);
      return;
    }
    const phase = typeof row.market_phase === 'string' ? row.market_phase : row.market_phase?.phase || null;
    list.push({
      __key: key,
      phase,
      observed_at: row.observed_at,
      verdict: row.verdict,
      reason: row.reason,
      roles: [role],
      evidence_path: row.__evidence_path,
    });
  };
  for (const [id, row] of customSweep) addCustomObservation(id, { ...row, __evidence_path: paths.customReadSweep }, 'baseline_target', postMetadataTargets.has(id));
  for (const run of customChainRuns) {
    for (const [id, row] of run.sources) addCustomObservation(id, { ...row, __evidence_path: run.evidencePath }, run.targets.has(id) ? 'target_source' : 'prerequisite_source');
    for (const [id, row] of run.targets) if (row.attempted) addCustomObservation(id, { ...row, __evidence_path: run.evidencePath }, 'chain_target');
  }
  for (const [id, row] of postMetadataTargets) addCustomObservation(id, { ...row, reason: 'HTTP_JSON_SHAPE_SANITIZED', __evidence_path: paths.postMetadataProbe }, 'post_metadata_target');
  for (const list of customObservations.values()) {
    list.sort((a, b) => String(a.observed_at || '').localeCompare(String(b.observed_at || '')));
    for (const entry of list) delete entry.__key;
  }
  const expectedDisabledCustomIds = new Set([
    'custom-api:GET:/api/v1/routines',
    'custom-api:GET:/api/v1/routines/briefing-budget',
    'custom-api:GET:/api/v1/routines/source-catalog',
  ]);
  for (const id of expectedDisabledCustomIds) {
    if (!customInventoryIds.has(id)) continue;
    if (!customReadAdjudication.includes(id) || !customReadAdjudication.includes('BLOCKED_SAFE_CONFIG')) {
      throw new Error(`custom adjudication evidence missing: ${id}`);
    }
  }
  for (const marker of [
    'Backtest mode | **PASS**, 5/5',
    'Agent Paper parity | **PASS**',
    'Session restore | **PASS**, 42/42',
    'Graph mode | **PASS**, 140 checks',
    'Full fixture verify | **FAIL**, 실패 단언 5건',
    'isolated-graph-mode-20260907-101545-8936.log',
    'fixture-verify-full-20260907-101818-8162.log',
  ]) {
    if (!modeFixtureDetails.includes(marker)) throw new Error(`mode fixture evidence missing marker: ${marker}`);
  }

  const revisions = [runtimeDiscovery?.revision, ...readSweeps.map((artifact) => artifact?.revision), ...(readInputRequired ? [readInputChain?.revision] : []), customReadSweep?.revision, ...customReadChains.map((artifact) => artifact?.revision), ...(postRequired ? [postMetadataProbe?.revision] : []), passiveWs?.revision].filter(Boolean);
  if (revisions.length !== readSweeps.length + customReadChains.length + 3 + (readInputRequired ? 1 : 0) + (postRequired ? 1 : 0) || new Set(revisions).size !== 1) {
    throw new Error('evidence revision mismatch or missing revision');
  }

  const websocketInventoryIds = new Set(inventory.items
    .filter((row) => row.source === 'screen_definition' && row.classification === 'websocket')
    .map((row) => row.source_id));
  const wsEvents = uniqueMap(passiveWs?.events?.source_ids || [], (row) => row.id, 'passive WS source IDs');
  if (wsEvents.size !== websocketInventoryIds.size
    || [...wsEvents.keys()].some((id) => !websocketInventoryIds.has(id))
    || passiveWs?.source_reconciliation?.exact_set_equal !== true) {
    throw new Error(`passive WS exact set mismatch: inventory=${websocketInventoryIds.size} evidence=${wsEvents.size}`);
  }

  const modeInventoryIds = new Set(inventory.items.filter((row) => row.source === 'runtime_catalog' && row.classification === 'mode').map((row) => row.source_id));
  const settingsInventoryIds = new Set(inventory.items.filter((row) => row.source === 'runtime_catalog' && row.classification === 'settings').map((row) => row.source_id));
  if (!Array.isArray(liveUis) || liveUis.length === 0 || liveUis.length !== paths.liveUis.length) throw new Error('live UI history and paths are required');
  const uiModeObservations = new Map([...modeInventoryIds].map((id) => [id, []]));
  const uiSettingObservations = new Map([...settingsInventoryIds].map((id) => [id, []]));
  let uiModes;
  let uiSettings;
  for (let index = 0; index < liveUis.length; index += 1) {
    const artifact = liveUis[index];
    uiModes = uniqueMap(artifact?.modes || [], (row) => row.id, `live UI ${index + 1} modes`);
    uiSettings = uniqueMap(artifact?.settings || [], (row) => row.id, `live UI ${index + 1} settings`);
    if (uiModes.size !== modeInventoryIds.size || [...uiModes.keys()].some((id) => !modeInventoryIds.has(id))) throw new Error(`live UI mode exact set mismatch: inventory=${modeInventoryIds.size} evidence=${uiModes.size}`);
    if (uiSettings.size !== settingsInventoryIds.size || [...uiSettings.keys()].some((id) => !settingsInventoryIds.has(id))) throw new Error(`live UI settings exact set mismatch: inventory=${settingsInventoryIds.size} evidence=${uiSettings.size}`);
    const phase = marketPhaseAt(artifact?.started_at);
    for (const [id, row] of uiModes) uiModeObservations.get(id).push({ phase, observed_at: artifact.started_at, verdict: row.navigation_status, reason: 'MODE_CLICK_NOT_PERFORMED', evidence_path: paths.liveUis[index] });
    for (const [id, row] of uiSettings) uiSettingObservations.get(id).push({ phase, observed_at: artifact.started_at, verdict: 'UI_RENDER_PASS', reason: row.read_status, evidence_path: paths.liveUis[index] });
  }
  const liveUi = liveUis.at(-1);

  const generatedRoutes = uniqueMap(runtimeDiscovery?.reconciliation?.generated_api?.routes || [], routeIdentity, 'generated runtime routes');
  const otherRuntimeRoutes = uniqueMap(runtimeDiscovery?.reconciliation?.other_runtime_api?.routes || [], routeIdentity, 'other runtime routes');
  const staticWebsocketRoutes = uniqueMap(runtimeDiscovery?.reconciliation?.static_websocket_excluded?.routes || [], routeIdentity, 'static WebSocket routes');
  const decorate = (rows, at) => rows.map((row) => ({ ...row, __generated_at: at }));
  const cards = uniqueMap(decorate(paperCards?.boards || [], paperCards?.generated_at), (row) => row.board_id, 'Paper cards');
  const screens = uniqueMap(decorate(paperScreens?.boards || [], paperScreens?.generated_at), (row) => row.board_id, 'Paper screens');
  const mini = uniqueMap(decorate(paperMini?.boards || [], paperMini?.generated_at), (row) => row.paper_board, 'Paper mini');

  const maps = {
    sweep: new Map([...sweepObservations].map(([id, rows]) => [id, rows.at(-1)])),
    sweepRoute: new Map([...sweepObservations].map(([id, rows]) => [id, [...rows].reverse().find((row) => row.route) || rows.at(-1)])),
    sweepObservations,
    customSweep,
    customLatest,
    customObservations,
    expectedDisabledCustomIds,
    wsEvents,
    wsConditionIds: new Set(['base:ka10171', 'base:ka10172', 'base:ka10173', 'base:ka10174']),
    wsPhase: passiveWs?.market?.phase || null,
    wsObservedAt: passiveWs?.observed_at || null,
    wsConnection: passiveWs?.connection || {},
    wsConnectionOk: passiveWs?.connection?.status === 'CONNECTED'
      && passiveWs?.connection?.closed === true
      && passiveWs?.connection?.close_code === 1000
      && passiveWs?.connection?.cleanup_status === 'COMPLETE',
    wsAuthentication: passiveWs?.authentication?.outcome || 'NOT_OBSERVED',
    uiModes,
    uiSettings,
    uiModeObservations,
    uiSettingObservations,
    currentUiMode: liveUi?.current_mode_surface?.id || null,
    uiRestored: Boolean(liveUi?.restoration?.settings_restored && liveUi?.restoration?.selected_setting_restored),
    uiPhase: marketPhaseAt(liveUi?.started_at),
    uiObservedAt: liveUi?.started_at || null,
    modeFixtureProof: new Map([
      ['summary', { detail: 'session restore fixture 42/42 중 chat→summary 복원 flow 확인', paths: paths.modeEvidence.session }],
      ['backtest', { detail: 'backtest mode fixture 5/5 및 session restore flow 확인', paths: [...paths.modeEvidence.backtest, ...paths.modeEvidence.session] }],
      ['agent', { detail: 'agent Paper parity fixture 실패 0, renderer console error 0', paths: paths.modeEvidence.agent }],
      ['graph', { detail: '초기 STATUS_BREAKPOINT 이력 보존 후 --user-data-dir 재시도 140/140', paths: paths.modeEvidence.graph }],
    ]),
    generatedRoutes,
    otherRuntimeRoutes,
    staticWebsocketRoutes,
    cards,
    screens,
    mini,
    miniGrammars: new Set(paperMini?.grammar_coverage?.covered || []),
    paperMiniGeneratedAt: paperMini?.generated_at || null,
    runtimeObservedAt: runtimeDiscovery?.observed_at || null,
    runtimePhase: marketPhaseAt(runtimeDiscovery?.observed_at),
    runtimeOpenApiExact: (runtimeDiscovery?.reconciliation?.generated_api?.static_only?.length || 0) === 0
      && (runtimeDiscovery?.reconciliation?.generated_api?.runtime_only?.length || 0) === 0
      && (runtimeDiscovery?.reconciliation?.diff?.static_only?.length || 0) === 0
      && (runtimeDiscovery?.reconciliation?.diff?.runtime_only?.length || 0) === 0,
  };
  const rows = inventory.items.map((item) => {
    const source = sourceEvidence(item, maps, paths);
    const fixture = fixtureEvidence(item, maps, paths);
    const live = liveEvidence(item, maps, paths);
    return {
      id: item.id,
      source: item.source,
      source_path: item.source_path,
      source_id: item.source_id,
      classification: item.classification,
      executable: item.executable,
      source_evidence: source,
      fixture_evidence: fixture,
      live_evidence: live,
      remaining_gap: remainingGap(item, fixture, live),
      evidence_paths: [...new Set([...source.evidence, ...fixture.evidence, ...live.evidence])],
    };
  });
  validateCoverage(rows, inventory.items);
  return rows;
}

export function validateCoverage(rows, inventoryItems) {
  const rowMap = uniqueMap(rows, (row) => row.id, 'coverage');
  const sourceMap = uniqueMap(inventoryItems, (row) => row.id, 'inventory');
  const missing = [...sourceMap.keys()].filter((id) => !rowMap.has(id));
  const extra = [...rowMap.keys()].filter((id) => !sourceMap.has(id));
  if (missing.length || extra.length || rows.length !== inventoryItems.length) {
    throw new Error(`coverage exact set mismatch: missing=${missing.length} extra=${extra.length}`);
  }
  for (const row of rows) {
    const source = sourceMap.get(row.id);
    if (row.source !== source.source || row.source_id !== source.source_id) {
      throw new Error(`coverage source mismatch: ${row.id}`);
    }
    if ('overall_status' in row || 'overallStatus' in row || row.combined_pass === true) {
      throw new Error(`combined PASS is forbidden: ${row.id}`);
    }
    if (row.live_evidence?.status === 'LIVE_PASS' && !row.live_evidence.observed_at) {
      throw new Error(`live PASS requires an observed timestamp: ${row.id}`);
    }
  }
  return { source_count: sourceMap.size, coverage_count: rowMap.size, missing: 0, extra: 0, duplicates: 0 };
}

function countBy(rows, getter) {
  const counts = {};
  for (const row of rows) {
    const key = getter(row);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function md(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function renderEvidencePaths(value, prefix) {
  if (Array.isArray(value)) return value.map((entry, index) => `- ${prefix}[${index}]: \`${entry}\``);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => renderEvidencePaths(entry, `${prefix}.${key}`));
  }
  return [`- ${prefix}: \`${value}\``];
}

export function renderMarkdown(rows, metadata) {
  const sourceCounts = countBy(rows, (row) => row.source_evidence.status);
  const fixtureCounts = countBy(rows, (row) => row.fixture_evidence.status);
  const liveCounts = countBy(rows, (row) => row.live_evidence.status);
  const phaseObservationCounts = countBy(
    rows.flatMap((row) => row.live_evidence.observations || []),
    (observation) => observation.phase || 'NOT_OBSERVED',
  );
  const readRows = rows.filter((row) => row.source === 'screen_definition' && row.classification === 'read_display');
  const readActualUnique = readRows.filter((row) => row.live_evidence.observations?.some((observation) => observation.observed_at)).length;
  const readNeverAttempted = readRows.length - readActualUnique;
  const readLatestCounts = countBy(readRows, (row) => row.live_evidence.status);
  const customRows = rows.filter((row) => row.source === 'custom_api_route');
  const customActualUnique = customRows.filter((row) => row.live_evidence.observations?.some((observation) => observation.observed_at)).length;
  const customLatestCounts = countBy(customRows, (row) => row.live_evidence.status);
  const customChainSummary = metadata.custom_chain || {
    initial_actual: 0,
    new_target_actual: 0,
    post_metadata_actual: 0,
    chain_runs: 0,
    business_requests: 0,
    latest_business_requests: 0,
    metadata_requests: 0,
  };
  const lines = [
    '# 장중 기능 전수 coverage reconciliation',
    '',
    `생성 시각: ${metadata.generated_at}`,
    '',
    `기준 inventory의 **${rows.length}개 source reconciliation row**를 ID별로 모두 기록했다. 이 수는 고유 제품 기능 수가 아니다. fixture/static과 live 결과를 합쳐 단일 PASS로 만들지 않는다. read-sweep의 FAIL은 제품 결함 확정 전 판정 대기이며, DATA_ABSENT는 정상 빈 결과일 수 있다. custom runner의 NOT_APPLICABLE은 제품 coverage에서 항목을 삭제하지 않는다. custom의 PASS_HTTP_SCHEMA_ONLY와 LIVE_HTTP_SCHEMA_PASS는 legacy raw verdict label로, HTTP 2xx+JSON 파싱+구조 fingerprint 관찰만 뜻한다. OpenAPI 응답 계약, 필드 의미, 데이터 정확성 검증은 아니다. 미래 장 단계는 실제 관찰 전까지 NOT_EXECUTED/NOT_OBSERVED 상태로 남는다.`,
    '',
    `Exact set: source=${metadata.validation.source_count}, coverage=${metadata.validation.coverage_count}, missing=0, extra=0, duplicates=0`,
    `Evidence guard: revision=${metadata.revision}; runtime/read/custom/passive-WS revision 일치, read union/custom/WS/UI exact membership 검증 완료`,
    '',
    '## 장 단계 시점 상태',
    '',
    ...Object.entries(metadata.window_states).map(([phase, status]) => `- ${phase}: ${status}`),
    '',
    '## 행에 억지로 귀속하지 않은 공통 실측',
    '',
    ...metadata.cross_cutting.map((entry) => `- ${entry}`),
    '',
    '## 증거 파일',
    '',
    ...Object.entries(metadata.paths).flatMap(([key, value]) => renderEvidencePaths(value, key)),
    '',
    '## 상태 집계',
    '',
    `- Source reference: ${Object.entries(sourceCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    `- Fixture/static: ${Object.entries(fixtureCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    `- Live: ${Object.entries(liveCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    `- Live observations by phase: ${Object.entries(phaseObservationCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    `- Read execution coverage: actual_unique=${readActualUnique}, never_attempted_input_blocked=${readNeverAttempted}, latest=${Object.entries(readLatestCounts).map(([k, v]) => `${k}=${v}`).join(', ')}. LIVE_HTTP_JSON_ROOT_OBSERVED는 HTTP/JSON/business code와 선언 root 관찰이며 전체 schema/end-to-end/전체 페이지/현재성 PASS가 아니다.`,
    `- Custom execution coverage: actual_unique=${customActualUnique} (initial_get=${customChainSummary.initial_actual}, chain_get_target_unique=${customChainSummary.new_target_actual}, post_metadata=${customChainSummary.post_metadata_actual}); chain_runs=${customChainSummary.chain_runs}, chain_business_requests_history=${customChainSummary.business_requests}, latest_business_requests=${customChainSummary.latest_business_requests}, metadata_requests=${customChainSummary.metadata_requests}; latest=${Object.entries(customLatestCounts).map(([k, v]) => `${k}=${v}`).join(', ')}. LIVE_HTTP_SCHEMA_PASS 수는 legacy label 집계이며 완전한 schema pass가 아니다. LIVE_HTTP_JSON_SHAPE_OBSERVED는 POST metadata handler의 HTTP/JSON shape 관찰일 뿐 하위 기능 실행이나 제품 PASS가 아니다.`,
    '',
    `## 전체 ${rows.length.toLocaleString('en-US')}행`,
    '',
    '| ID | source | source_path | source_id | class | source reference | fixture/static evidence | live execution evidence | phase / observed_at | remaining gap | evidence paths |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    const observationTimeline = row.live_evidence.observations?.length
      ? row.live_evidence.observations.map((entry) => `${entry.phase || 'NOT_OBSERVED'}@${entry.observed_at || 'NOT_OBSERVED'}:${entry.verdict}`).join('; ')
      : `${row.live_evidence.phase || 'NOT_OBSERVED'}@${row.live_evidence.observed_at || 'NOT_OBSERVED'}`;
    lines.push(`| ${md(row.id)} | ${md(row.source)} | ${md(row.source_path || 'none')} | ${md(row.source_id)} | ${md(row.classification)} | ${md(`${row.source_evidence.status}: ${row.source_evidence.detail}`)} | ${md(`${row.fixture_evidence.status}: ${row.fixture_evidence.detail}`)} | ${md(`${row.live_evidence.status}: ${row.live_evidence.detail}`)} | ${md(observationTimeline)} | ${md(row.remaining_gap)} | ${md(row.evidence_paths.join('; ') || 'none')} |`);
  }
  return `${lines.join('\n')}\n`;
}

async function loadJson(repoRoot, relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), 'utf8'));
}

export async function generateCoverage(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const paths = { ...DEFAULT_PATHS, ...(options.paths || {}) };
  const inputs = {
    inventory: await loadJson(repoRoot, paths.inventory),
    readSweeps: await Promise.all(paths.readSweeps.map((relativePath) => loadJson(repoRoot, relativePath))),
    readInputChain: await loadJson(repoRoot, paths.readInputChain),
    customReadSweep: await loadJson(repoRoot, paths.customReadSweep),
    customReadChains: await Promise.all(paths.customReadChains.map((relativePath) => loadJson(repoRoot, relativePath))),
    postMetadataProbe: await loadJson(repoRoot, paths.postMetadataProbe),
    customReadAdjudication: await readFile(path.join(repoRoot, paths.customReadAdjudication), 'utf8'),
    modeFixtureDetails: await readFile(path.join(repoRoot, paths.modeFixtureDetails), 'utf8'),
    liveUis: await Promise.all(paths.liveUis.map((relativePath) => loadJson(repoRoot, relativePath))),
    passiveWs: await loadJson(repoRoot, paths.passiveWs),
    runtimeDiscovery: await loadJson(repoRoot, paths.runtimeDiscovery),
    paperCards: await loadJson(repoRoot, paths.paperCards),
    paperScreens: await loadJson(repoRoot, paths.paperScreens),
    paperMini: await loadJson(repoRoot, paths.paperMini),
    paths,
  };
  await Promise.all(Object.values(paths.modeEvidence).flat().map((relativePath) => readFile(path.join(repoRoot, relativePath))));
  const rows = reconcileCoverage(inputs);
  const validation = validateCoverage(rows, inputs.inventory.items);
  const generatedAt = (options.now || new Date()).toISOString();
  const latestCustomReadChain = inputs.customReadChains.at(-1);
  const latestLiveUi = inputs.liveUis.at(-1);
  const chainTargetActualIds = new Set(inputs.customReadChains.flatMap((artifact) => artifact.results.filter((row) => row.attempted === true).map((row) => row.id)));
  const markdown = renderMarkdown(rows, {
    generated_at: generatedAt,
    revision: inputs.runtimeDiscovery.revision,
    custom_chain: {
      initial_actual: inputs.customReadSweep.results.filter((row) => row.observed_at).length,
      new_target_actual: chainTargetActualIds.size,
      post_metadata_actual: inputs.postMetadataProbe.results.filter((row) => row.attempted === true).length,
      chain_runs: inputs.customReadChains.length,
      business_requests: inputs.customReadChains.reduce((sum, artifact) => sum + artifact.entrypoint.business_request_count, 0),
      latest_business_requests: latestCustomReadChain.entrypoint.business_request_count,
      metadata_requests: inputs.customReadChains.reduce((sum, artifact) => sum + artifact.entrypoint.metadata_request_count, 0),
    },
    window_states: auditWindowStates(generatedAt),
    cross_cutting: [
      `live boot stock-index history: ${inputs.liveUis.map((artifact) => `${artifact.started_at}=${artifact.readiness?.tasks?.find((task) => task.id === 'stock-index')?.state || 'NOT_OBSERVED'}`).join(' -> ')}; 최신 성공은 과거 BOOT-003 결함 수정 증거가 아님`,
      'live boot alarm-bootstrap/routine-feed: DOCUMENTED_EXPECTED_DISABLED / BLOCKED_SAFE_CONFIG (감사 환경 routines 비활성화)',
      `live UI coverage declaration: routes90=${latestLiveUi.coverage?.live_routes_90}; cards96=${latestLiveUi.coverage?.live_cards_96}; mini10=${latestLiveUi.coverage?.live_mini_10}`,
      `dynamic read input chain: mode=${inputs.readInputChain.mode}; sources=${inputs.readInputChain.summary?.sources}; targets=${inputs.readInputChain.summary?.targets}; attempted=${inputs.readInputChain.summary?.attempted}; business requests=${inputs.readInputChain.summary?.businessRequestCount}; metadata requests=${inputs.readInputChain.summary?.metadataRequestCount}. target 7개는 한 페이지의 HTTP/JSON/business code와 선언 root만 관찰했고 pagination=${inputs.readInputChain.results?.[0]?.pagination}, freshness=${inputs.readInputChain.results?.[0]?.freshness}다.`,
      `passive WS: connection=${inputs.passiveWs.connection?.status}; close=${inputs.passiveWs.connection?.close_code}; cleanup=${inputs.passiveWs.connection?.cleanup_status}; auth=${inputs.passiveWs.authentication?.outcome}; REAL events=${inputs.passiveWs.events?.status}`,
      'mode/session fixture: Backtest 5/5 PASS; Agent parity 실패 0 PASS; Session restore 42/42 PASS; Graph 초기 STATUS_BREAKPOINT 후 격리 userData 재시도 140/140 PASS',
      'full fixture verify: 5 assertions FAIL (OS 알림 1, region contract 2, 격리 Claude account row 1, timing 1); 제품 live 불량으로 일괄 판정하지 않음',
      'full fixture harness history: 직접 Electron 실행은 npm_node_execpath 부재로 load 실패; 표준 npm run verify 재시도 결과를 최종 assertion 증거로 사용',
      `custom-read-chain latest: targets=${latestCustomReadChain.summary?.total}; attempted=${latestCustomReadChain.summary?.attempted}; schema_only=${latestCustomReadChain.summary?.PASS_HTTP_SCHEMA_ONLY}; blocked=${latestCustomReadChain.summary?.BLOCKED}; business requests=${latestCustomReadChain.entrypoint?.business_request_count}; metadata requests=${latestCustomReadChain.entrypoint?.metadata_request_count}`,
      `custom-read-chain history: runs=${inputs.customReadChains.length}; business requests=${inputs.customReadChains.reduce((sum, artifact) => sum + artifact.entrypoint.business_request_count, 0)}; metadata requests=${inputs.customReadChains.reduce((sum, artifact) => sum + artifact.entrypoint.metadata_request_count, 0)}. target 판정은 최신 실행으로 갱신하고 같은 ID+observed_at은 한 번만 세며 prerequisite 중복 요청을 신규 target으로 계산하지 않는다.`,
      `POST metadata probe: mode=${inputs.postMetadataProbe.mode}; exact targets=${inputs.postMetadataProbe.summary?.total}; HTTP200+JSON shape=${inputs.postMetadataProbe.summary?.pass_http_json_shape_only}; metadata requests=${inputs.postMetadataProbe.admission?.metadata_requests}; business requests=${inputs.postMetadataProbe.admission?.business_requests}; responses=${inputs.postMetadataProbe.admission?.transport_responses_received}. search/describe metadata handler만 관찰했으며 quote/resolve/render/data 정확성/UI 결과는 실행·검증하지 않았다.`,
    ],
    paths,
    validation,
  });
  const outputPath = path.join(repoRoot, paths.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, markdown, 'utf8');
  return { outputPath, rows, validation };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const result = await generateCoverage();
    console.log(`${result.outputPath} — rows=${result.rows.length} missing=0 extra=0 duplicates=0`);
  } catch (error) {
    console.error(`coverage generation failed: ${error?.message || 'unknown_error'}`);
    process.exitCode = 1;
  }
}
