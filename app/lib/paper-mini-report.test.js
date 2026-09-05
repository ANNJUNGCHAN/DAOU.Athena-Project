'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { mergeStaticLayer, mergeTemplateLayer } = require('./paper-mini-report');

// PAPER-MINI.json은 게이트 둘이 함께 쓰는 파일 하나다. 지키는 것은 하나 — 어느 쪽이
// 나중에 돌아도 상대 층 판정이 남는가(비파괴).

const staticReport = (over = {}) => ({
  generated_at: '2026-09-06T00:00:00.000Z',
  canonical_decision: { source: 'paper' },
  totals: { paper_boards: 192, matched: 19 },
  baseline: { reproduced: false },
  grammar_coverage: { ok: true, covered: ['auth'], uncovered: [] },
  gate_failures: [],
  boards: [{ paper_board: '46AX-0', status: 'divergent', failures: [{ code: 'ledger_stale' }] }],
  ...over,
});

const templateRun = (over = {}) => ({
  generated_at: '2026-09-06T01:00:00.000Z',
  rendered: 11,
  elapsed_ms: 42000,
  grammar_coverage: { ok: false, covered: ['auth'], uncovered: ['stream'] },
  gate_failures: [{ code: 'grammar_uncovered', layer: 'template', uncovered: ['stream'] }],
  templates: [{ paper_board: '45SE-0', grammar: 'auth', status: 'pass' }],
  ...over,
});

test('mergeStaticLayer keeps the template layer a previous run wrote', () => {
  const first = mergeTemplateLayer(null, templateRun());
  const merged = mergeStaticLayer(first, staticReport());
  assert.equal(merged.templates.length, 1);
  assert.equal(merged.layers.template.gate, 'verify:paper-mini-template');
  assert.equal(merged.layers.static.boards, 1);
  assert.equal(merged.boards[0].paper_board, '46AX-0');
});

test('mergeTemplateLayer keeps the board verdicts the static layer wrote', () => {
  const first = mergeStaticLayer(null, staticReport());
  const merged = mergeTemplateLayer(first, templateRun());
  assert.equal(merged.boards.length, 1);
  assert.equal(merged.totals.paper_boards, 192);
  assert.equal(merged.baseline.reproduced, false);
  assert.equal(merged.canonical_decision.source, 'paper');
});

test('the runtime grammar coverage wins over the static one — 이름이 덮는 것과 그려지는 것은 다르다', () => {
  const merged = mergeTemplateLayer(mergeStaticLayer(null, staticReport()), templateRun());
  assert.deepEqual(merged.grammar_coverage.uncovered, ['stream']);
});

test('a template rerun replaces its own gate failures and nothing else', () => {
  const withFailure = mergeTemplateLayer(mergeStaticLayer(null, staticReport({
    gate_failures: [{ code: 'manifest_broken', layer: 'static' }],
  })), templateRun());
  assert.deepEqual(withFailure.gate_failures.map((f) => f.code), ['manifest_broken', 'grammar_uncovered']);
  const clean = mergeTemplateLayer(withFailure, templateRun({ gate_failures: [] }));
  assert.deepEqual(clean.gate_failures.map((f) => f.code), ['manifest_broken']);
});

test('a file written by an older schema is not trusted as a base', () => {
  const merged = mergeStaticLayer({ schema_version: 0, boards: [{ paper_board: '옛것' }] }, staticReport());
  assert.deepEqual(merged.boards.map((board) => board.paper_board), ['46AX-0']);
  assert.deepEqual(merged.templates, []);
});
