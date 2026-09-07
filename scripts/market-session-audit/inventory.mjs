import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(THIS_DIR, '..', '..');

const SOURCES = Object.freeze({
  definitions: 'backend/ref/kiwoom-screen-definitions.json',
  assignments: 'backend/ref/kiwoom-capability-assignment.json',
  commonManifest: 'backend/ref/kiwoom-common-screen-manifest.json',
  paperManifest: 'backend/ref/paper-ledger/manifest.json',
  cardIndex: 'backend/ref/card-surface-templates/index.json',
  miniLedger: 'backend/ref/kiumi/kiumi-ledger.jsonl',
  routes: 'app/lib/paper-screen-routes.js',
  liveCatalog: 'app/lib/live-full-catalog.js',
  pluginCatalog: 'app/lib/plugin-catalog.js',
  miniRuntime: 'app/lib/paper-screen-routes.js',
  miniGrammar: 'app/lib/paper-mini-compare.js',
  customApiDir: 'backend/athena_api/api',
  serviceApi: 'backend/athena_api/main.py',
  mcpDir: 'backend/athena_mcp',
  mcpServer: 'backend/athena_mcp/server.py',
  ipcMain: 'app/main.js',
});

async function json(repoRoot, relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), 'utf8'));
}

function countBy(items, keyFn) {
  return Object.fromEntries([...items.reduce((map, item) => {
    const key = String(keyFn(item) ?? 'unknown');
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function difference(left, right) {
  const other = new Set(right);
  return [...new Set(left)].filter((id) => !other.has(id)).sort();
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) (seen.has(value) ? repeated : seen).add(value);
  return [...repeated].sort();
}

function baseItem({ id, source, sourcePath, sourceId, classification, marketPhases, prerequisite, method, expected, automation, executable = true, pagination = false, initialVerdict = null, initialReason = null }) {
  const verdict = initialVerdict || (executable ? 'NOT_RUN' : 'NOT_APPLICABLE');
  const stateVariants = ['normal', 'empty', 'loading', 'error', 'blocked', 'expired', 'approval'];
  const reason = initialReason || (executable ? 'awaiting_market_session_audit' : 'source_record_is_not_an_executable_product_function');
  return {
    id, source, source_path: sourcePath, source_id: sourceId, classification,
    executable,
    market_phases: marketPhases,
    state_variants: stateVariants,
    coverage_slots: marketPhases.flatMap((phase) => stateVariants.map((state) => ({
      id: `${id}@${phase}/${state}`,
      phase,
      state,
      applicability: executable ? 'UNASSESSED' : 'NOT_APPLICABLE',
      applicability_basis: executable ? 'candidate_axis_requires_source_or_runtime_confirmation' : 'non_executable_source_record',
      verdict,
      observed_at: null,
      environment: null,
      evidence: { live: [], fixture: [] },
      reason,
      defect_ids: [],
    }))),
    prerequisite,
    check: { method, automation },
    safe_inputs: { status: executable ? 'UNASSIGNED' : 'NOT_APPLICABLE', values: null },
    pagination: { status: pagination ? 'UNASSIGNED' : 'NOT_APPLICABLE', values: null },
    expected,
    result: {
      verdict, observed_at: null, environment: null, observation: null,
      evidence: { live: [], fixture: [] },
      reason,
      defect_ids: [],
    },
  };
}

function runtimeMiniGrammar(envelope) {
  if (envelope.canvas_type === 'facts' && envelope.card_title === '주문 티켓') return 'order_ticket';
  if (envelope.canvas_type === 'action' && envelope.card_title === '주문 확인') return 'order_confirm';
  if (envelope.canvas_type === 'status') return 'auth';
  return envelope.canvas_type;
}

async function loadRuntimeMini(repoRoot) {
  const filename = path.join(repoRoot, SOURCES.miniRuntime);
  const source = await readFile(filename, 'utf8');
  const exposed = source.replace(
    'module.exports = { ROUTES, STEP_KINDS, STRUCTURE_KINDS };',
    'module.exports = { ROUTES, STEP_KINDS, STRUCTURE_KINDS, MINI_CARD_ENVELOPES };',
  );
  const context = { module: { exports: {} }, exports: {} };
  vm.runInNewContext(exposed, context, { filename, timeout: 1_000 });
  return context.module.exports.MINI_CARD_ENVELOPES;
}

function apiRoutesFromSource(text, relativePath) {
  const prefix = /APIRouter\(\s*prefix\s*=\s*(["'])(.*?)\1/.exec(text)?.[2] || '';
  const routes = [];
  const matcher = /@(?:app|router)\.(get|post|put|delete|patch|websocket)\(\s*(["'])(.*?)\2/gms;
  for (let match = matcher.exec(text); match; match = matcher.exec(text)) {
    routes.push({ method: match[1].toUpperCase(), path: `${prefix}${match[3]}` || '/', source_path: relativePath });
  }
  return routes;
}

async function loadCustomApiRoutes(repoRoot) {
  const apiDir = path.join(repoRoot, SOURCES.customApiDir);
  const files = (await readdir(apiDir)).filter((name) => name.endsWith('.py') && name !== '__init__.py').sort();
  const all = [];
  for (const file of files) {
    const relative = `${SOURCES.customApiDir}/${file}`;
    all.push(...apiRoutesFromSource(await readFile(path.join(repoRoot, relative), 'utf8'), relative));
  }
  all.push(...apiRoutesFromSource(await readFile(path.join(repoRoot, SOURCES.serviceApi), 'utf8'), SOURCES.serviceApi));
  return all;
}

async function loadMcpTools(repoRoot) {
  const dir = path.join(repoRoot, SOURCES.mcpDir);
  const files = (await readdir(dir)).filter((name) => name.endsWith('_tools.py')).sort();
  const tools = [];
  for (const file of files) {
    const relative = `${SOURCES.mcpDir}/${file}`;
    const text = await readFile(path.join(repoRoot, relative), 'utf8');
    const constants = new Map([...text.matchAll(/^([A-Z][A-Z0-9_]*_TOOL)\s*=\s*(["'])(.*?)\2/gm)].map((match) => [match[1], match[3]]));
    const referenced = new Set([...text.matchAll(/name\s*=\s*([A-Z][A-Z0-9_]*_TOOL)\b/g)].map((match) => match[1]));
    for (const name of referenced) {
      if (constants.has(name)) tools.push({ tool: constants.get(name), action: null, source_path: relative });
    }
    if (text.includes('for name in SELECTOR_TOOL_NAMES')) {
      for (const [name, value] of constants) if (name !== 'SELECTOR_TOOL') tools.push({ tool: value, action: null, source_path: relative });
    }
    const actionBlock = /_ALLOWED_ACTIONS[^=]*=\s*\(\s*\r?\n([\s\S]*?)^\)/m.exec(text)?.[1]
      || /_ALLOWED_ACTIONS[^=]*=\s*\(([^\r\n]*)\)/.exec(text)?.[1]
      || /["']action["']\s*:\s*\{[\s\S]*?["']enum["']\s*:\s*\[([\s\S]*?)\]/.exec(text)?.[1]
      || '';
    const actions = [...actionBlock.matchAll(/(["'])(.*?)\1/g)].map((match) => match[2]);
    const fileTools = tools.filter((item) => item.source_path === relative);
    if (actions.length && fileTools.length === 1) {
      for (const action of actions) tools.push({ tool: fileTools[0].tool, action, source_path: relative });
    }
  }
  const serverText = await readFile(path.join(repoRoot, SOURCES.mcpServer), 'utf8');
  for (const constantName of ['RENDER_CANVAS_TOOL', 'SAVE_CANVAS_TOOL']) {
    const definition = new RegExp(`^${constantName}\\s*=\\s*(["'])(.*?)\\1`, 'm').exec(serverText);
    const registered = new RegExp(`name\\s*=\\s*${constantName}\\b`).test(serverText);
    if (!definition || !registered) throw new Error(`MCP builtin source contract missing: ${constantName}`);
    tools.push({ tool: definition[2], action: null, source_path: SOURCES.mcpServer });
  }
  return [...new Map(tools.map((item) => [`${item.tool}:${item.action || ''}`, item])).values()];
}

async function loadIpcChannels(repoRoot) {
  const text = await readFile(path.join(repoRoot, SOURCES.ipcMain), 'utf8');
  const items = [...text.matchAll(/ipcMain\.(handle|on)\(\s*(["'])(.*?)\2/g)].map((match) => ({ kind: match[1], channel: match[3] }));
  const registrations = [...text.matchAll(/ipcMain\.(?:handle|on)\(/g)].length;
  return { items: [...new Map(items.map((item) => [`${item.kind}:${item.channel}`, item])).values()], unresolved_dynamic_registrations: registrations - items.length };
}

function operationItem(definition) {
  const category = definition.category || 'unknown';
  const automatic = category === 'read_display' || category === 'websocket';
  const phases = category === 'websocket'
    ? ['PREOPEN', 'REGULAR', 'CLOSING_AUCTION', 'POSTCLOSE']
    : ['PREOPEN', 'REGULAR', 'POSTCLOSE'];
  return baseItem({
    id: `operation:${definition.mapping_id}`,
    source: 'screen_definition', sourcePath: SOURCES.definitions,
    sourceId: definition.mapping_id, classification: category, marketPhases: phases,
    prerequisite: category === 'oauth' ? 'configured provider authentication' : 'backend ready and required account/data entitlement',
    method: category === 'websocket' ? 'bounded owned subscription, receive, remove, reconnect' : category === 'read_display' ? 'safe read request and rendered output validation' : 'contract and isolated UI validation only',
    expected: category === 'order' ? 'order path remains excluded from automatic live execution' : category === 'oauth' ? 'authentication state is reported without token mutation' : 'operation returns source-labelled data or an explicit blocked/error state',
    automation: automatic ? 'SAFE_READ_OR_OWNED_SUBSCRIPTION' : 'MANUAL_OR_ISOLATED_ONLY',
  });
}

export async function buildInventory(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const [definitionsDoc, assignmentsDoc, commonManifest, paperManifest, cardIndex, miniText, runtimeMini, customApiRoutes, mcpTools, ipc] = await Promise.all([
    json(repoRoot, SOURCES.definitions), json(repoRoot, SOURCES.assignments),
    json(repoRoot, SOURCES.commonManifest), json(repoRoot, SOURCES.paperManifest),
    json(repoRoot, SOURCES.cardIndex), readFile(path.join(repoRoot, SOURCES.miniLedger), 'utf8'),
    loadRuntimeMini(repoRoot), loadCustomApiRoutes(repoRoot), loadMcpTools(repoRoot), loadIpcChannels(repoRoot),
  ]);
  const routes = require(path.join(repoRoot, SOURCES.routes)).ROUTES;
  const liveCatalog = require(path.join(repoRoot, SOURCES.liveCatalog));
  const pluginCatalog = require(path.join(repoRoot, SOURCES.pluginCatalog));
  const miniLedger = miniText.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

  const operationItems = definitionsDoc.definitions.map(operationItem);
  const capabilityItems = assignmentsDoc.capabilities.map((capability) => baseItem({
    id: `capability:${capability.capability_id}`,
    source: 'capability_assignment', sourcePath: SOURCES.assignments,
    sourceId: capability.capability_id, classification: 'capability',
    marketPhases: ['PREOPEN', 'REGULAR', 'POSTCLOSE'],
    prerequisite: 'all assigned operations inventoried',
    method: 'aggregate assigned operation verdicts without replacing ID-level checks',
    expected: 'every assigned mapping ID has its own evidence and verdict', automation: 'AGGREGATE_ONLY',
  }));
  const paperBoardItems = paperManifest.boards.map((board) => baseItem({
    id: `paper-board:${board.id}`, source: 'paper_board', sourcePath: SOURCES.paperManifest,
    sourceId: board.id, classification: board.role, marketPhases: ['PREOPEN', 'REGULAR', 'POSTCLOSE'],
    prerequisite: 'Electron surface available at the board route or explicitly classified as non-runtime reference',
    method: board.role === 'screen' ? 'navigate and validate normal plus declared state variants' : 'static/runtime parity appropriate to board role',
    expected: 'Paper board is accounted for with runtime, fixture, static, or not-applicable evidence', automation: 'ROLE_DEPENDENT',
    executable: !['reference', 'retired', 'contract', 'record'].includes(board.role),
  }));
  const routeItems = routes.map((route) => baseItem({
    id: `paper-route:${route.board}`, source: 'paper_route', sourcePath: SOURCES.routes,
    sourceId: route.board, classification: route.window || 'unknown',
    marketPhases: ['PREOPEN', 'REGULAR', 'POSTCLOSE'], prerequisite: `${route.window || 'target'} window running`,
    method: 'execute declared route steps and validate declared phrases/structure',
    expected: 'route reaches its board and all declared checks pass',
    automation: route.reach?.some((step) => step.do === 'ipc-fixture') ? 'FIXTURE_ROUTE' : 'RUNTIME_ROUTE',
  }));
  const cardItems = cardIndex.boards.map((board) => baseItem({
    id: `card-board:${board.board_id}`, source: 'card_surface_catalog', sourcePath: SOURCES.cardIndex,
    sourceId: board.board_id, classification: board.card_id || 'card', marketPhases: ['PREOPEN', 'REGULAR', 'POSTCLOSE'],
    prerequisite: 'card template loaded and a compatible operation result available',
    method: 'static contract validation followed by rendered card and source timestamp validation',
    expected: 'registered card board renders without silent fallback', automation: 'STATIC_AND_RUNTIME',
  }));
  const miniItems = miniLedger.map((row) => baseItem({
    id: `kiumi-mini:${row.board_id}`, source: 'kiumi_mini_ledger', sourcePath: SOURCES.miniLedger,
    sourceId: row.board_id, classification: row.grammar || 'unknown', marketPhases: ['PREOPEN', 'REGULAR', 'POSTCLOSE'],
    prerequisite: 'mini card host and corresponding source card available',
    method: 'compare ledger, Paper mini/note pair, rendered compact card, and live source state separately',
    expected: 'mini card preserves the registered source board semantics and exposes stale/error state', automation: 'STATIC_AND_RUNTIME',
  }));
  const runtimeMiniItems = runtimeMini.map((envelope, index) => {
    const grammar = runtimeMiniGrammar(envelope);
    return baseItem({
      id: `runtime-mini:${grammar}`, source: 'runtime_mini_grammar', sourcePath: SOURCES.miniRuntime,
      sourceId: grammar, classification: grammar, marketPhases: ['PREOPEN', 'REGULAR', 'POSTCLOSE'],
      prerequisite: 'Orb mini host and a successful non-fallback canvas envelope',
      method: `render runtime mini envelope branch ${index + 1} and validate compact-state behavior`,
      expected: 'the runtime renderer selects the matching mini grammar without generic fallback', automation: 'FIXTURE_AND_LIVE_ENVELOPE',
    });
  });

  const customApiItems = customApiRoutes.map((route) => {
    const readOnly = route.method === 'GET';
    const websocket = route.method === 'WEBSOCKET';
    return baseItem({
      id: `custom-api:${route.method}:${route.path}`, source: 'custom_api_route', sourcePath: route.source_path,
      sourceId: `${route.method} ${route.path}`, classification: websocket ? 'websocket' : readOnly ? 'read' : 'mutation_or_query_post',
      marketPhases: ['PREOPEN', 'REGULAR', 'POSTCLOSE'], prerequisite: 'backend route enabled and required authentication available',
      method: websocket ? 'owned subscription lifecycle only' : readOnly ? 'safe GET with bounded pagination/input' : 'isolated contract/UI test until explicitly allowlisted',
      expected: readOnly || websocket ? 'route returns an explicit state with source-labelled evidence' : 'route remains blocked from automatic live mutation',
      automation: websocket ? 'OWNED_SUBSCRIPTION_ONLY' : readOnly ? 'SAFE_GET' : 'MANUAL_OR_ISOLATED_ONLY',
      pagination: /runs|strategies|projects|conversations|entities|relations|catalog/.test(route.path),
    });
  });
  const mcpItems = mcpTools.map((tool) => baseItem({
    id: tool.action ? `mcp-action:${tool.tool}:${tool.action}` : `mcp-tool:${tool.tool}`,
    source: tool.action ? 'mcp_tool_action' : 'mcp_tool', sourcePath: tool.source_path,
    sourceId: tool.action ? `${tool.tool}:${tool.action}` : tool.tool,
    classification: tool.action ? 'tool_action' : 'tool', marketPhases: ['PREOPEN', 'REGULAR', 'POSTCLOSE'],
    prerequisite: 'Athena MCP server connected and required backend capability ready',
    method: 'invoke with assigned safe input and verify tool result plus rendered consequence',
    expected: 'tool returns a grounded result or an explicit blocked/error state', automation: 'SAFE_INPUT_REQUIRED',
  }));
  const ipcItems = ipc.items.map((entry) => {
    const mutationLike = /order|register|remove|set|approve|reject|reset|execute|run|backfill|confirm|cancel|pause|resume|update|add|delete|rename|arm|deploy/i.test(entry.channel);
    return baseItem({
      id: `ipc:${entry.kind}:${entry.channel}`, source: 'ipc_channel', sourcePath: SOURCES.ipcMain,
      sourceId: entry.channel, classification: `${entry.kind}:${mutationLike ? 'mutation_or_control' : 'read_or_lifecycle'}`,
      marketPhases: ['PREOPEN', 'REGULAR', 'POSTCLOSE'], prerequisite: 'Electron main and renderer bridge running',
      method: mutationLike ? 'UI/contract isolation until explicitly allowlisted' : 'invoke through the product UI and validate response/state',
      expected: mutationLike ? 'channel is not automatically invoked against live state' : 'channel completes or exposes an explicit error state',
      automation: mutationLike ? 'MANUAL_OR_ISOLATED_ONLY' : 'UI_READ_OR_LIFECYCLE',
    });
  });
  const unresolvedIpcItems = Array.from({ length: ipc.unresolved_dynamic_registrations }, (_, index) => baseItem({
    id: `ipc-dynamic-unresolved:${index + 1}`, source: 'ipc_dynamic_unresolved', sourcePath: SOURCES.ipcMain,
    sourceId: `dynamic-registration-${index + 1}`, classification: 'discovery_gap',
    marketPhases: ['PREOPEN', 'REGULAR', 'POSTCLOSE'], prerequisite: 'resolve the channel-producing loop or variable registration',
    method: 'map the dynamic registration to its finite source catalog before execution',
    expected: 'every dynamic registration expands to unique channel IDs', automation: 'BLOCKED_DISCOVERY',
    initialVerdict: 'BLOCKED', initialReason: 'dynamic_ipc_registration_not_expanded',
  }));
  const runtimeDiscoveryItems = [
    ['runtime-openapi', 'runtime_openapi_reconciliation', '/openapi.json'],
    ['runtime-mcp-tools-list', 'runtime_mcp_tools_reconciliation', 'tools/list'],
  ].map(([sourceId, classification, method]) => baseItem({
    id: `discovery:${sourceId}`, source: 'runtime_discovery_unresolved', sourcePath: null,
    sourceId, classification, marketPhases: ['PREOPEN', 'REGULAR', 'POSTCLOSE'],
    prerequisite: 'matching running revision and authenticated runtime available',
    method: `capture ${method} IDs and compare bidirectionally with the static inventory`,
    expected: 'runtime and static source IDs are reconciled without silently dropping dynamic entries',
    automation: 'BLOCKED_DISCOVERY', initialVerdict: 'BLOCKED', initialReason: 'runtime_reconciliation_not_yet_captured',
  }));

  const catalogItems = [
    ...liveCatalog.MODES.map((mode) => ['mode', mode.view, mode.label]),
    ...liveCatalog.SETTINGS_NAV.map((item) => ['settings', item.key, item.label]),
    ...liveCatalog.LIVE_QUERIES.map((item) => ['live-check', item.id, item.id]),
    ...pluginCatalog.CATALOG.map((item) => ['plugin', item.id, item.name || item.id]),
  ].map(([kind, id, label]) => baseItem({
    id: `catalog:${kind}:${id}`, source: 'runtime_catalog',
    sourcePath: kind === 'plugin' ? SOURCES.pluginCatalog : SOURCES.liveCatalog,
    sourceId: id, classification: kind, marketPhases: ['PREOPEN', 'REGULAR', 'POSTCLOSE'],
    prerequisite: kind === 'plugin' ? 'plugin surface available' : 'Athena shell running',
    method: kind === 'live-check' ? 'execute catalogued check without persisting the user query text' : 'navigate and validate catalogued destination/state',
    expected: `${kind} catalog entry ${label} is accounted for`, automation: kind === 'plugin' ? 'READ_ONLY_UI' : 'CATALOG_DEFINED',
  }));

  const definitionIds = definitionsDoc.definitions.map((item) => item.mapping_id);
  const assignedIds = assignmentsDoc.capabilities.flatMap((item) => item.mapping_ids);
  const commonIds = commonManifest.mappings.map((item) => item.mapping_id);
  const paperScreenIds = paperManifest.boards.filter((item) => item.role === 'screen').map((item) => item.id);
  const routeIds = routes.map((item) => item.board);
  const paperCardIds = paperManifest.boards.filter((item) => item.role === 'card_template').map((item) => item.id);
  const cardIds = cardIndex.boards.map((item) => item.board_id);
  const paperMiniNames = paperManifest.boards.filter((item) => item.role === 'mini_card').map((item) => item.name);
  const expectedMiniNames = miniLedger.flatMap((item) => [`mini/${item.source_board}`, `note/${item.source_board}`]);

  const miniGrammarCatalog = require(path.join(repoRoot, SOURCES.miniGrammar)).MINI_GRAMMARS;
  const runtimeMiniGrammars = runtimeMini.map(runtimeMiniGrammar);
  const items = [...operationItems, ...capabilityItems, ...paperBoardItems, ...routeItems, ...cardItems, ...miniItems, ...runtimeMiniItems, ...catalogItems, ...customApiItems, ...mcpItems, ...ipcItems, ...unresolvedIpcItems, ...runtimeDiscoveryItems];
  const resultStatusCounts = countBy(items, (item) => item.result?.verdict || 'MISSING');
  const coverageSlots = items.flatMap((item) => item.coverage_slots || []);
  const definitionsOnly = difference(definitionIds, assignedIds);
  const assignmentOnly = difference(assignedIds, definitionIds);
  const expectedCapabilityExclusions = definitionsDoc.definitions
    .filter((item) => (assignmentsDoc.excluded_categories || []).includes(item.category))
    .map((item) => item.mapping_id).sort();
  return {
    schema_version: 1,
    generated_at: (options.now || new Date()).toISOString(),
    revision: options.revision || null,
    default_result: 'NOT_RUN',
    sources: Object.values(SOURCES),
    counts: {
      total_items: items.length,
      total_source_reconciliation_rows: items.length,
      unique_product_function_count: null,
      by_source: countBy(items, (item) => item.source),
      operation_categories: countBy(definitionsDoc.definitions, (item) => item.category),
      paper_board_roles: countBy(paperManifest.boards, (item) => item.role),
      paper_route_windows: countBy(routes, (item) => item.window),
      mini_grammars: countBy(miniLedger, (item) => item.grammar),
      runtime_mini_grammars: countBy(runtimeMiniItems, (item) => item.classification),
      custom_api_methods: countBy(customApiRoutes, (item) => item.method),
      custom_api_routes_excluding_service: customApiRoutes.filter((item) => item.source_path !== SOURCES.serviceApi).length,
      service_api_routes: customApiRoutes.filter((item) => item.source_path === SOURCES.serviceApi).length,
      mcp_tools: mcpItems.filter((item) => item.source === 'mcp_tool').length,
      mcp_tool_actions: mcpItems.filter((item) => item.source === 'mcp_tool_action').length,
      ipc_channels: ipcItems.length,
      ipc_dynamic_registrations_unresolved: ipc.unresolved_dynamic_registrations,
      executable_items: items.filter((item) => item.executable).length,
      non_executable_source_records: items.filter((item) => !item.executable).length,
      result_statuses: resultStatusCounts,
      missing_result_status: resultStatusCounts.MISSING || 0,
      coverage_slots_total: coverageSlots.length,
      candidate_phase_state_slots: coverageSlots.length,
      coverage_slot_statuses: countBy(coverageSlots, (slot) => slot.verdict || 'MISSING'),
      missing_coverage_slot_status: coverageSlots.filter((slot) => !slot.verdict).length,
      phase_slot_assignments: countBy(coverageSlots, (slot) => slot.phase),
      state_slot_assignments: countBy(coverageSlots, (slot) => slot.state),
    },
    count_semantics: {
      total_source_reconciliation_rows: 'rows from overlapping code, Paper, catalog, API, MCP, and IPC sources; not a unique product-function denominator',
      candidate_phase_state_slots: 'audit candidates only; applicability remains UNASSESSED until source or runtime evidence classifies the state',
      executable_items: 'source rows requiring some validation; overlapping representations remain separate',
      non_executable_source_records: 'reference, retired, contract, and record Paper rows excluded from executable-function coverage',
    },
    reconciliation: {
      definitions_vs_capabilities: {
        definition_count: definitionIds.length, assigned_count: assignedIds.length,
        only_definitions: definitionsOnly, only_assignments: assignmentOnly,
        duplicate_definition_ids: duplicates(definitionIds), duplicate_assignment_ids: duplicates(assignedIds),
        expected_exclusions: expectedCapabilityExclusions,
        exact_after_declared_exclusions: assignmentOnly.length === 0
          && duplicates(definitionIds).length === 0
          && duplicates(assignedIds).length === 0
          && JSON.stringify(definitionsOnly) === JSON.stringify(expectedCapabilityExclusions),
      },
      definitions_vs_common_manifest: {
        definition_count: definitionIds.length, manifest_count: commonIds.length,
        only_definitions: difference(definitionIds, commonIds), only_manifest: difference(commonIds, definitionIds),
        exact_set_equal: difference(definitionIds, commonIds).length === 0 && difference(commonIds, definitionIds).length === 0,
      },
      paper_screens_vs_routes: {
        screen_board_count: paperScreenIds.length, route_count: routeIds.length,
        boards_without_routes: difference(paperScreenIds, routeIds), routes_without_boards: difference(routeIds, paperScreenIds),
      },
      paper_cards_vs_card_catalog: {
        paper_count: paperCardIds.length, catalog_count: cardIds.length,
        paper_only: difference(paperCardIds, cardIds), catalog_only: difference(cardIds, paperCardIds),
        exact_set_equal: difference(paperCardIds, cardIds).length === 0 && difference(cardIds, paperCardIds).length === 0,
      },
      paper_mini_vs_ledger: {
        paper_count: paperMiniNames.length, expected_from_ledger_count: expectedMiniNames.length,
        paper_only: difference(paperMiniNames, expectedMiniNames), ledger_pairs_missing_from_paper: difference(expectedMiniNames, paperMiniNames),
        exact_set_equal: difference(paperMiniNames, expectedMiniNames).length === 0 && difference(expectedMiniNames, paperMiniNames).length === 0,
      },
      runtime_mini_vs_grammar_catalog: {
        runtime_count: runtimeMiniGrammars.length, grammar_catalog_count: miniGrammarCatalog.length,
        runtime_only: difference(runtimeMiniGrammars, miniGrammarCatalog),
        catalog_missing_from_runtime: difference(miniGrammarCatalog, runtimeMiniGrammars),
        duplicate_runtime_grammars: duplicates(runtimeMiniGrammars),
        exact_set_equal: difference(runtimeMiniGrammars, miniGrammarCatalog).length === 0
          && difference(miniGrammarCatalog, runtimeMiniGrammars).length === 0
          && duplicates(runtimeMiniGrammars).length === 0,
      },
    },
    items,
  };
}

export async function writeInventory(options = {}) {
  const inventory = await buildInventory(options);
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const outputPath = path.resolve(options.outputPath || path.join(repoRoot, 'artifacts', 'market-session-audit', '2026-09-07', 'inventory.json'));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(inventory, null, 2) + '\n', 'utf8');
  return { inventory, outputPath };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const outputIndex = process.argv.indexOf('--output');
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  const { inventory, outputPath: written } = await writeInventory({ outputPath });
  console.log(`${written} — items=${inventory.counts.total_items} executable=${inventory.counts.executable_items} NOT_RUN=${inventory.counts.result_statuses.NOT_RUN || 0} BLOCKED=${inventory.counts.result_statuses.BLOCKED || 0} NOT_APPLICABLE=${inventory.counts.result_statuses.NOT_APPLICABLE || 0}`);
  for (const [name, result] of Object.entries(inventory.reconciliation)) {
    const missing = Object.entries(result).filter(([key]) => /only|without|missing/.test(key)).reduce((sum, [, value]) => sum + value.length, 0);
    console.log(`${name}: gaps=${missing}`);
  }
}
