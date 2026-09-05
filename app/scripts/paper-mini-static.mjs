/**
 * 카드미니 실카드 192장 정적 대조 게이트 — Paper H-1이 말하는 카드미니와
 * `backend/ref/kiumi/kiumi-ledger.jsonl` 96행이 같은 것을 말하는지 electron 없이 잰다.
 *
 * 192 = `mini/` 96장(카드 자체) + `note/` 96장(같은 카드의 주석). 둘은 짝이다 —
 * 이름의 접두만 다르고 나머지가 같다(실측 mini-only 0 · note-only 0).
 *
 * 검사 5종:
 *   M1  매니페스트 불변식 — paper-manifest-check.mjs 를 그대로 부른다(전제가 깨지면 fail-closed)
 *   M2  보드 ↔ 대장 짝짓기 — `mini/<source_board>` 이름으로 96행 전부가 맞는가
 *   M3  실카드 행 대조 — Paper 행의 값을 대장 행과 맞대고 설계서 §5.2의 네 부류로 가른다
 *   M4  주석 대조 — `note/` 보드 네 줄이 대장 `annotation`과 같은가
 *   M5  견본 문법 커버리지(이름 층) — `template/*` 11장이 문법 10종을 덮는가
 *
 * ── 정본 결정 규칙(설계서 §5.2) — 이 게이트가 절대 하지 않는 일
 * 사용자 지시는 「Paper가 정본」이다. 그래도 이 게이트는 **대장을 고치지 않고 고치라고도
 * 하지 않는다.** 어긋남을 세어 네 부류로 가르고 리포트에 남길 뿐이다.
 * `paper_cross_board`(Paper가 다른 보드의 값을 들고 있다)가 0이 되기 전에 Paper를 대장에
 * 반영하면 지금 도는 앱을 망가뜨린다 — `backend/ref/kiumi/README.md`가 적은 순서 그대로다.
 *
 * ── 왜 빨간 게이트인가
 * 지금 대장과 Paper는 실제로 어긋나 있다. 이 스크립트는 그것을 초록으로 만들지 않는다.
 * 어긋난 보드가 하나라도 있으면 exit 1이고, 그 목록이 이 게이트의 산출물이다(설계서 §6.3:
 * `paper_cross_board`가 0이 된 뒤에야 pre-push로 승격한다).
 *
 * ── 증거 파일 84/227/190/2 재현에 대하여
 * `backend/ref/kiumi/evidence/paper-ledger-divergence-20260904.json`은 스스로
 * "Row extraction was done by LLM agents reading rendered JSX, not by a deterministic parser.
 * Treat counts as a strong signal, not a hash." 라고 적어 뒀다. 그래서 이 게이트는 그 수치에
 * 자신을 맞추지 않는다 — 결정론적으로 재고, 잰 값과 증거 값을 `baseline`에 나란히 적어
 * 차이를 사람이 보게 한다. 수치를 맞추려고 규칙을 비틀면 게이트가 조용히 거짓말한다.
 *
 * 성공 표지: paper mini static verification passed
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPaperManifest, loadManifest, LEDGER_DIR } from './paper-manifest-check.mjs';

const require_ = createRequire(import.meta.url);
const { parseTreeRecords } = require_('../lib/paper-tree.js');
const { mergeStaticLayer } = require_('../lib/paper-mini-report.js');
const {
  paperMiniRows, buildTextIndex, compareMiniCard, compareMiniNote,
  templateGrammarOf, grammarCoverage,
} = require_('../lib/paper-mini-compare.js');

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(APP_DIR, '..');

export const TEMPLATES_DIR = path.join(REPO_ROOT, 'backend', 'ref', 'card-surface-templates');
export const KIUMI_LEDGER_PATH = path.join(REPO_ROOT, 'backend', 'ref', 'kiumi', 'kiumi-ledger.jsonl');
export const EVIDENCE_PATH = path.join(
  REPO_ROOT, 'backend', 'ref', 'kiumi', 'evidence', 'paper-ledger-divergence-20260904.json',
);
export const REPORT_PATH = path.join(APP_DIR, 'captures', 'paper-gates', 'PAPER-MINI.json');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** 대장 96행. */
export function loadKiumiLedger(ledgerPath = KIUMI_LEDGER_PATH) {
  return readFileSync(ledgerPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

/** 카드 표면 96장의 텍스트 역색인. `slots.json`의 `text_multiset` 키가 그 보드의 Paper 텍스트다. */
export function loadTextIndex(records, templatesDir = TEMPLATES_DIR) {
  const slotsByBoard = new Map();
  const entries = [];
  for (const record of records) {
    const file = path.join(templatesDir, record.board_id, 'slots.json');
    const texts = existsSync(file) ? Object.keys(readJson(file).text_multiset || {}) : [];
    const set = new Set(texts.map((text) => text.trim()).filter(Boolean));
    slotsByBoard.set(record.board_id, set);
    entries.push({ board_id: record.board_id, texts: set });
  }
  return { index: buildTextIndex(entries), slotsByBoard };
}

function ledgerTree(ledgerDir, board) {
  return parseTreeRecords(readFileSync(path.join(ledgerDir, board.page, `${board.id}.tree.txt`), 'utf8'));
}

function ledgerTexts(ledgerDir, board) {
  return readJson(path.join(ledgerDir, board.page, `${board.id}.json`)).texts.map((entry) => entry.text);
}

/** 리포트 보드 항목 하나. 실패 목록이 상태를 정한다 — 상태는 언제나 목록의 함수다. */
function sealBoard(entry) {
  return { ...entry, status: entry.failures.length ? 'divergent' : 'matched' };
}

/**
 * 정적 층 전체를 판정한다.
 * @returns {object} PAPER-MINI.json 정적 층 리포트
 */
export function checkPaperMiniStatic(options = {}) {
  const ledgerDir = options.ledgerDir ?? LEDGER_DIR;
  const manifest = options.manifest ?? loadManifest(ledgerDir);
  const records = options.records ?? loadKiumiLedger(options.kiumiLedgerPath);
  const M1 = checkPaperManifest({ ledgerDir, manifest });

  const { index, slotsByBoard } = loadTextIndex(records, options.templatesDir);
  const bySourceBoard = new Map(records.map((record) => [`mini/${record.source_board}`, record]));
  const grammarByBoardId = new Map(records.map((record) => [record.board_id, record.grammar]));

  const miniBoards = manifest.boards.filter((board) => board.role === 'mini_card' && board.name.startsWith('mini/'));
  const noteBoards = manifest.boards.filter((board) => board.role === 'mini_card' && board.name.startsWith('note/'));
  const boards = [];
  const codeCounts = {};
  let paperRowTotal = 0;
  let missingTotal = 0;
  let unmatched = 0;

  for (const board of miniBoards) {
    const record = bySourceBoard.get(board.name);
    if (!record) {
      unmatched += 1;
      boards.push(sealBoard({
        paper_board: board.id, kind: 'mini', name: board.name, ledger_board: null,
        failures: [{ code: 'ledger_unmatched', layer: 'static' }],
      }));
      continue;
    }
    const rows = paperMiniRows(ledgerTree(ledgerDir, board));
    const result = compareMiniCard({
      rows, record, ownSlots: slotsByBoard.get(record.board_id) || new Set(), index,
    });
    paperRowTotal += result.paper_rows;
    missingTotal += result.missing_in_paper.length;
    const failures = result.rows.map((row) => ({ ...row, layer: 'static' }));
    for (const row of result.rows) codeCounts[row.code] = (codeCounts[row.code] || 0) + 1;
    if (result.missing_in_paper.length) {
      failures.push({ code: 'missing_in_paper', layer: 'static', elements: result.missing_in_paper });
    }
    boards.push(sealBoard({
      paper_board: board.id, kind: 'mini', name: board.name, ledger_board: record.board_id,
      grammar: record.grammar, paper_rows: result.paper_rows, failures,
    }));
  }

  let noteDrift = 0;
  for (const board of noteBoards) {
    const record = bySourceBoard.get(`mini/${board.name.slice('note/'.length)}`);
    if (!record) {
      unmatched += 1;
      boards.push(sealBoard({
        paper_board: board.id, kind: 'note', name: board.name, ledger_board: null,
        failures: [{ code: 'ledger_unmatched', layer: 'static' }],
      }));
      continue;
    }
    const result = compareMiniNote({ texts: ledgerTexts(ledgerDir, board), record });
    const failures = result.drift.length
      ? [{ code: 'annotation_drift', layer: 'static', drift: result.drift }]
      : [];
    if (failures.length) noteDrift += 1;
    boards.push(sealBoard({
      paper_board: board.id, kind: 'note', name: board.name, ledger_board: record.board_id, failures,
    }));
  }

  const templates = manifest.boards
    .filter((board) => board.role === 'mini_template')
    .map((board) => ({ board_id: board.id, name: board.name, grammar: templateGrammarOf(board.name, grammarByBoardId) }));
  const coverage = grammarCoverage(templates);

  const miniJudged = boards.filter((board) => board.kind === 'mini');
  const matched = miniJudged.filter((board) => board.status === 'matched').length;
  const divergent = miniJudged.length - matched;
  const totals = {
    paper_boards: boards.length,
    mini_boards: miniJudged.length,
    note_boards: noteBoards.length,
    ledger_rows: records.length,
    matched,
    divergent,
    unmatched_boards: unmatched,
    paper_rows: paperRowTotal,
    divergent_rows: Object.values(codeCounts).reduce((sum, count) => sum + count, 0),
    paper_cross_board: codeCounts.paper_cross_board || 0,
    form_deviation: codeCounts.paper_form_deviation || 0,
    ledger_stale: codeCounts.ledger_stale || 0,
    unbacked_rows: codeCounts.unbacked || 0,
    missing_in_paper: missingTotal,
    annotation_drift: noteDrift,
  };

  const gateFailures = [];
  if (M1.failures.length) gateFailures.push({ code: 'manifest_broken', layer: 'static', failures: M1.failures });
  if (unmatched) gateFailures.push({ code: 'ledger_unmatched', layer: 'static', boards: unmatched });
  if (!coverage.ok) {
    gateFailures.push({ code: 'grammar_uncovered', layer: 'static', uncovered: coverage.uncovered });
  }

  return {
    gate: 'verify:paper-mini-static',
    generated_at: options.now ?? new Date().toISOString(),
    canonical_decision: {
      source: 'paper',
      note: '사용자 지시 2026-09-05',
      conflict: 'backend/ref/kiumi/README.md 2026-09-04 실측은 대장 우위로 판단',
      rule: 'paper_cross_board가 0이 되기 전에는 대장을 고치지 않는다 — 이 게이트는 보고만 한다',
    },
    totals,
    baseline: compareBaseline(totals, options.evidencePath),
    grammar_coverage: coverage,
    checks: {
      M1_manifest: { ok: M1.failures.length === 0, failures: M1.failures },
      M2_ledger_match: { ok: unmatched === 0, mini_boards: miniJudged.length, unmatched },
      M3_rows: { ok: divergent === 0, matched, divergent },
      M4_annotation: { ok: noteDrift === 0, boards: noteBoards.length, drift: noteDrift },
      M5_grammar_coverage: coverage,
    },
    gate_failures: gateFailures,
    boards,
  };
}

/**
 * 증거 파일의 실측치와 이번 측정을 나란히 놓는다. 게이트는 여기서 실패하지 않는다 —
 * 증거 파일 스스로가 "counts as a strong signal, not a hash"라고 적었고, 그 수치에
 * 자신을 맞추면 규칙이 아니라 답을 고르는 것이 된다.
 */
export function compareBaseline(totals, evidencePath = EVIDENCE_PATH) {
  if (!existsSync(evidencePath)) return { evidence: null, measured: null, reproduced: null };
  const evidence = readJson(evidencePath).counts;
  const measured = {
    compared: totals.mini_boards,
    match: totals.matched,
    divergent: totals.divergent,
    unresolved: totals.unmatched_boards,
    unbacked_rows: totals.divergent_rows,
    missing_elements: totals.missing_in_paper,
  };
  const deltas = Object.fromEntries(
    Object.keys(evidence).map((key) => [key, (measured[key] ?? 0) - evidence[key]]),
  );
  return {
    source: path.relative(REPO_ROOT, evidencePath).replace(/\\/g, '/'),
    caveat: '증거 파일은 LLM이 JSX를 읽어 센 값이다 — 결정론적 재현 대상이 아니다',
    evidence,
    measured,
    deltas,
    reproduced: Object.values(deltas).every((delta) => delta === 0),
  };
}

/** CLI 출력과 종료코드. 실패 경로를 테스트가 부를 수 있게 순수 함수로 뽑았다. */
export function formatCliReport(report, reportPath = REPORT_PATH) {
  const rel = path.relative(REPO_ROOT, reportPath).replace(/\\/g, '/');
  const t = report.totals;
  const c = report.checks;
  const lines = [
    `[paper-mini-static] 보드 ${t.paper_boards}장(실카드 ${t.mini_boards} · 주석 ${t.note_boards}) · 대장 ${t.ledger_rows}행`,
    `  M1 매니페스트   ${c.M1_manifest.ok ? 'ok' : `실패 ${c.M1_manifest.failures.length}건`}`,
    `  M2 짝짓기       ${c.M2_ledger_match.ok ? 'ok' : `못 찾은 보드 ${c.M2_ledger_match.unmatched}장`}`,
    `  M3 행 대조      일치 ${t.matched} · 어긋남 ${t.divergent} (행 ${t.paper_rows}개 중 ${t.divergent_rows}개)`,
    `     paper_cross_board ${t.paper_cross_board} · form_deviation ${t.form_deviation} · ledger_stale ${t.ledger_stale} · unbacked ${t.unbacked_rows}`,
    `     대장에만 있는 element ${t.missing_in_paper}개`,
    `  M4 주석 대조    ${c.M4_annotation.ok ? 'ok' : `어긋난 주석 ${t.annotation_drift}장`}`,
    `  M5 문법 커버리지 ${c.M5_grammar_coverage.ok ? `ok (견본 ${c.M5_grammar_coverage.template_boards}장이 10종)` : `못 덮은 문법 ${c.M5_grammar_coverage.uncovered.join(', ')}`}`,
  ];
  if (report.baseline && report.baseline.evidence) {
    const { evidence, measured } = report.baseline;
    lines.push(
      `  기준선 대조 (${report.baseline.source})`,
      `     증거 match ${evidence.match} · divergent ${evidence.divergent} · unresolved ${evidence.unresolved} · rows ${evidence.unbacked_rows} · missing ${evidence.missing_elements}`,
      `     측정 match ${measured.match} · divergent ${measured.divergent} · unresolved ${measured.unresolved} · rows ${measured.unbacked_rows} · missing ${measured.missing_elements}`,
      `     재현 ${report.baseline.reproduced ? '일치' : '불일치 — 증거는 LLM 실측이라 해시가 아니다(리포트 baseline.deltas 참조)'}`,
    );
  }
  lines.push(`  리포트 ${rel}`);
  const failed = report.boards.filter((board) => board.status === 'divergent');
  if (!failed.length && !report.gate_failures.length) {
    return { exitCode: 0, lines: [...lines, 'paper mini static verification passed'] };
  }
  return {
    exitCode: 1,
    lines: [...lines, `  어긋난 보드 ${failed.length}장 — 정본 결정 규칙 §5.2에 따라 대장은 고치지 않는다`],
  };
}

export function writeReport(report, reportPath = REPORT_PATH) {
  mkdirSync(path.dirname(reportPath), { recursive: true });
  const existing = existsSync(reportPath) ? readJson(reportPath) : null;
  const merged = mergeStaticLayer(existing, report);
  merged.manifest_sha256 = createHash('sha256')
    .update(readFileSync(path.join(LEDGER_DIR, 'manifest.json'))).digest('hex');
  writeFileSync(reportPath, JSON.stringify(merged, null, 2) + '\n');
  return reportPath;
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const report = checkPaperMiniStatic();
  writeReport(report);
  const { exitCode, lines } = formatCliReport(report);
  for (const line of lines) (exitCode ? console.error : console.log)(line);
  process.exit(exitCode);
}
