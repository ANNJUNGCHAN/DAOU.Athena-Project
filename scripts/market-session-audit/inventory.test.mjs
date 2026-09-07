import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { buildInventory, REPO_ROOT } from './inventory.mjs';

const require = createRequire(import.meta.url);

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(REPO_ROOT, relativePath), 'utf8'));
}

test('inventory counts every source record and starts every item as NOT_RUN with split evidence', async () => {
  const [inventory, definitions, assignments, paper, cards] = await Promise.all([
    buildInventory({ now: new Date('2026-09-07T00:00:00Z') }),
    json('backend/ref/kiwoom-screen-definitions.json'),
    json('backend/ref/kiwoom-capability-assignment.json'),
    json('backend/ref/paper-ledger/manifest.json'),
    json('backend/ref/card-surface-templates/index.json'),
  ]);
  assert.equal(inventory.counts.by_source.screen_definition, definitions.definitions.length);
  assert.equal(inventory.counts.by_source.capability_assignment, assignments.capabilities.length);
  assert.equal(inventory.counts.by_source.paper_board, paper.boards.length);
  assert.equal(inventory.counts.by_source.card_surface_catalog, cards.boards.length);
  assert.equal(inventory.counts.total_items, inventory.items.length);
  assert.equal(inventory.counts.missing_result_status, 0);
  assert.equal(inventory.counts.missing_coverage_slot_status, 0);
  assert.equal(
    (inventory.counts.result_statuses.NOT_RUN || 0) + (inventory.counts.result_statuses.BLOCKED || 0) + (inventory.counts.result_statuses.NOT_APPLICABLE || 0),
    inventory.items.length,
  );
  assert.equal(new Set(inventory.items.map((item) => item.id)).size, inventory.items.length);
  for (const item of inventory.items) {
    assert.ok(['NOT_RUN', 'BLOCKED', 'NOT_APPLICABLE'].includes(item.result.verdict));
    if (!item.executable) assert.equal(item.result.verdict, 'NOT_APPLICABLE');
    assert.deepEqual(Object.keys(item.result.evidence).sort(), ['fixture', 'live']);
    assert.ok(Array.isArray(item.result.evidence.live));
    assert.ok(Array.isArray(item.result.evidence.fixture));
    assert.equal(item.coverage_slots.length, item.market_phases.length * item.state_variants.length);
    assert.ok(item.coverage_slots.every((slot) => slot.evidence && Array.isArray(slot.evidence.live) && Array.isArray(slot.evidence.fixture)));
    assert.ok(item.coverage_slots.every((slot) => slot.applicability === (item.executable ? 'UNASSESSED' : 'NOT_APPLICABLE')));
  }
});

test('row and candidate-slot counts explicitly refuse to claim a unique product-function denominator', async () => {
  const inventory = await buildInventory({ now: new Date('2026-09-07T00:00:00Z') });
  assert.equal(inventory.counts.unique_product_function_count, null);
  assert.match(inventory.count_semantics.total_source_reconciliation_rows, /not a unique product-function denominator/);
  assert.match(inventory.count_semantics.candidate_phase_state_slots, /applicability remains UNASSESSED/);
});

test('dynamic IPC registrations remain explicit BLOCKED discovery rows', async () => {
  const inventory = await buildInventory({ now: new Date('2026-09-07T00:00:00Z') });
  const blocked = inventory.items.filter((item) => item.source === 'ipc_dynamic_unresolved');
  assert.equal(blocked.length, inventory.counts.ipc_dynamic_registrations_unresolved);
  assert.ok(blocked.every((item) => item.result.verdict === 'BLOCKED' && item.check.automation === 'BLOCKED_DISCOVERY'));
});

test('runtime OpenAPI and MCP reconciliation remain BLOCKED until captured from a matching live revision', async () => {
  const inventory = await buildInventory({ now: new Date('2026-09-07T00:00:00Z') });
  const blocked = inventory.items.filter((item) => item.source === 'runtime_discovery_unresolved');
  assert.deepEqual(blocked.map((item) => item.source_id).sort(), ['runtime-mcp-tools-list', 'runtime-openapi']);
  assert.ok(blocked.every((item) => item.result.verdict === 'BLOCKED' && item.check.automation === 'BLOCKED_DISCOVERY'));
});

test('expanded inventory adds the two server-defined canvas MCP builtins without losing the immutable baseline IDs', async () => {
  const [inventory, baseline] = await Promise.all([
    buildInventory({ now: new Date('2026-09-07T00:00:00Z') }),
    json('artifacts/market-session-audit/2026-09-07/inventory.json'),
  ]);
  const baselineIds = new Set(baseline.items.map((item) => item.id));
  const expandedIds = new Set(inventory.items.map((item) => item.id));
  const added = [...expandedIds].filter((id) => !baselineIds.has(id)).sort();
  assert.equal([...baselineIds].filter((id) => !expandedIds.has(id)).length, 0);
  assert.deepEqual(added, ['mcp-tool:athena__render_canvas', 'mcp-tool:athena__save_canvas']);
  assert.equal(inventory.items.length, baseline.items.length + 2);
  assert.equal(inventory.counts.mcp_tools, 12);
  for (const id of added) {
    const item = inventory.items.find((entry) => entry.id === id);
    assert.equal(item.source, 'mcp_tool');
    assert.equal(item.source_path, 'backend/athena_mcp/server.py');
    assert.equal(item.result.verdict, 'NOT_RUN');
  }
});

test('reconciliation is computed bidirectionally and classifies capability exclusions explicitly', async () => {
  const inventory = await buildInventory({ now: new Date('2026-09-07T00:00:00Z') });
  const reconciliation = inventory.reconciliation;
  assert.deepEqual(reconciliation.definitions_vs_capabilities.only_assignments, []);
  assert.equal(reconciliation.definitions_vs_capabilities.exact_after_declared_exclusions, true);
  assert.deepEqual(
    reconciliation.definitions_vs_capabilities.only_definitions.sort(),
    inventory.items.filter((item) => item.source === 'screen_definition' && item.classification === 'oauth').map((item) => item.source_id).sort(),
  );
  assert.deepEqual(reconciliation.definitions_vs_common_manifest.only_definitions, []);
  assert.deepEqual(reconciliation.definitions_vs_common_manifest.only_manifest, []);
  assert.equal(reconciliation.definitions_vs_common_manifest.exact_set_equal, true);
  assert.deepEqual(reconciliation.paper_cards_vs_card_catalog.paper_only, []);
  assert.deepEqual(reconciliation.paper_cards_vs_card_catalog.catalog_only, []);
  assert.equal(reconciliation.paper_cards_vs_card_catalog.exact_set_equal, true);
  assert.deepEqual(reconciliation.paper_mini_vs_ledger.paper_only, []);
  assert.deepEqual(reconciliation.paper_mini_vs_ledger.ledger_pairs_missing_from_paper, []);
  assert.equal(reconciliation.paper_mini_vs_ledger.exact_set_equal, true);
  assert.equal(reconciliation.runtime_mini_vs_grammar_catalog.exact_set_equal, true);
  assert.deepEqual(reconciliation.runtime_mini_vs_grammar_catalog.duplicate_runtime_grammars, []);
  assert.ok(Array.isArray(reconciliation.paper_screens_vs_routes.boards_without_routes));
  assert.ok(Array.isArray(reconciliation.paper_screens_vs_routes.routes_without_boards));
});

test('catalog inventory never persists configured user query text', async () => {
  const inventory = await buildInventory({ now: new Date('2026-09-07T00:00:00Z') });
  const liveCatalog = require(path.join(REPO_ROOT, 'app/lib/live-full-catalog.js'));
  const serialized = JSON.stringify(inventory);
  for (const check of liveCatalog.LIVE_QUERIES) {
    assert.equal(serialized.includes(check.question), false);
    assert.ok(inventory.items.some((item) => item.id === `catalog:live-check:${check.id}`));
  }
});
