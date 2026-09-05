'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const checkerPath = path.join(__dirname, '..', 'scripts', 'paper-mini-static.mjs');

let mod;
const load = async () => {
  if (!mod) mod = await import(require('node:url').pathToFileURL(checkerPath).href);
  return mod;
};

let cached;
const report = async () => {
  if (!cached) cached = (await load()).checkPaperMiniStatic({ now: '2026-09-06T00:00:00.000Z' });
  return cached;
};

// ---------------------------------------------------------------- 기준선 대조

test('compareBaseline puts the evidence counts next to what we measured', async () => {
  const { compareBaseline } = await load();
  const baseline = compareBaseline({
    mini_boards: 96, matched: 10, divergent: 84, unmatched_boards: 2,
    divergent_rows: 227, missing_in_paper: 190,
  });
  assert.deepEqual(baseline.evidence, {
    compared: 96, match: 10, divergent: 84, unresolved: 2, unbacked_rows: 227, missing_elements: 190,
  });
  assert.equal(baseline.reproduced, true);
  assert.deepEqual(Object.values(baseline.deltas), [0, 0, 0, 0, 0, 0]);
});

test('compareBaseline records the delta instead of hiding it', async () => {
  const { compareBaseline } = await load();
  const baseline = compareBaseline({
    mini_boards: 96, matched: 19, divergent: 77, unmatched_boards: 0,
    divergent_rows: 212, missing_in_paper: 182,
  });
  assert.equal(baseline.reproduced, false);
  assert.equal(baseline.deltas.match, 9);
  assert.equal(baseline.deltas.divergent, -7);
  assert.ok(baseline.caveat.includes('LLM'));
});

// ---------------------------------------------------------------- 종료 코드

const shell = (over = {}) => ({
  totals: {
    paper_boards: 192, mini_boards: 96, note_boards: 96, ledger_rows: 96,
    matched: 96, divergent: 0, unmatched_boards: 0, paper_rows: 432, divergent_rows: 0,
    paper_cross_board: 0, form_deviation: 0, ledger_stale: 0, unbacked_rows: 0,
    missing_in_paper: 0, annotation_drift: 0,
  },
  checks: {
    M1_manifest: { ok: true, failures: [] },
    M2_ledger_match: { ok: true, mini_boards: 96, unmatched: 0 },
    M3_rows: { ok: true, matched: 96, divergent: 0 },
    M4_annotation: { ok: true, boards: 96, drift: 0 },
    M5_grammar_coverage: { ok: true, template_boards: 11, uncovered: [] },
  },
  baseline: null,
  gate_failures: [],
  boards: [{ paper_board: '46AX-0', status: 'matched', failures: [] }],
  ...over,
});

test('formatCliReport passes only when no board diverged and no gate failure stands', async () => {
  const { formatCliReport } = await load();
  const { exitCode, lines } = formatCliReport(shell());
  assert.equal(exitCode, 0);
  assert.ok(lines.at(-1).includes('paper mini static verification passed'));
});

test('formatCliReport fails on a divergent board and says the ledger stays untouched', async () => {
  const { formatCliReport } = await load();
  const { exitCode, lines } = formatCliReport(shell({
    boards: [{ paper_board: '46AX-0', status: 'divergent', failures: [{ code: 'ledger_stale' }] }],
  }));
  assert.equal(exitCode, 1);
  assert.ok(lines.at(-1).includes('대장은 고치지 않는다'));
});

test('formatCliReport fails on a gate failure even when every board is clean', async () => {
  const { formatCliReport } = await load();
  const { exitCode } = formatCliReport(shell({
    gate_failures: [{ code: 'grammar_uncovered', layer: 'static', uncovered: ['stream'] }],
  }));
  assert.equal(exitCode, 1);
});

// ---------------------------------------------------------------- 실제 원장 위에서

test('the gate judges all 192 H-1 mini boards against the 96-row ledger', async () => {
  const result = await report();
  assert.equal(result.totals.paper_boards, 192);
  assert.equal(result.totals.mini_boards, 96);
  assert.equal(result.totals.note_boards, 96);
  assert.equal(result.totals.ledger_rows, 96);
  assert.equal(result.boards.length, 192);
});

test('every mini board finds its ledger row by name — 주석의 board_id 오기와 무관하다', async () => {
  const result = await report();
  assert.equal(result.totals.unmatched_boards, 0);
  // 증거 파일 known_mapping_errors 2건이 이름 짝짓기에서는 바른 보드로 풀린다.
  const byId = new Map(result.boards.map((board) => [board.paper_board, board]));
  assert.equal(byId.get('46S1-0').ledger_board, '2QRP-1');
  assert.equal(byId.get('48EL-0').ledger_board, '3JT4-0');
});

test('the totals are the counted failures, not a separate tally', async () => {
  const result = await report();
  const rows = result.boards.filter((board) => board.kind === 'mini').flatMap((board) => board.failures);
  const count = (code) => rows.filter((failure) => failure.code === code).length;
  assert.equal(result.totals.paper_cross_board, count('paper_cross_board'));
  assert.equal(result.totals.ledger_stale, count('ledger_stale'));
  assert.equal(result.totals.form_deviation, count('paper_form_deviation'));
  assert.equal(result.totals.unbacked_rows, count('unbacked'));
  assert.equal(
    result.totals.divergent_rows,
    result.totals.paper_cross_board + result.totals.form_deviation
      + result.totals.ledger_stale + result.totals.unbacked_rows,
  );
  assert.equal(
    result.totals.divergent,
    result.boards.filter((board) => board.kind === 'mini' && board.status === 'divergent').length,
  );
});

test('the eleven template boards cover the ten grammars by name', async () => {
  const { MINI_GRAMMARS } = require('./paper-mini-compare');
  const result = await report();
  assert.equal(result.grammar_coverage.template_boards, 11);
  assert.deepEqual(result.grammar_coverage.covered, MINI_GRAMMARS);
  assert.deepEqual(result.grammar_coverage.uncovered, []);
  assert.deepEqual(result.grammar_coverage.unresolved, []);
});

test('the gate reports the divergence instead of touching the ledger', async () => {
  const result = await report();
  assert.equal(result.canonical_decision.source, 'paper');
  assert.ok(result.canonical_decision.rule.includes('대장을 고치지 않는다'));
  // 이 트랙의 산출물은 빨간 보드 목록이다 — 지금 그것이 실제로 나와야 한다.
  assert.ok(result.totals.divergent > 0);
  assert.ok(result.boards.some((board) => board.status === 'divergent'));
});
