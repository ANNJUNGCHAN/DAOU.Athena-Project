/**
 * 카드 템플릿 96장 정적 대조 게이트 — Paper 원장이 말하는 카드와
 * `backend/ref/card-surface-templates/`가 들고 있는 카드가 같은 것인지 electron 없이 잰다.
 *
 * 3자 대조 사슬(설계서 §2.3) 중 구간 A·B를 이 스크립트가 맡는다.
 * 마운트 충실도(구간 C)는 `verify:paper-cards-mount`가 따로 재고,
 * 이 파일은 그 리포트와 같은 파일(`app/captures/paper-gates/PAPER-CARDS.json`)에 정적 층을 쓴다.
 * 쓸 때는 통째로 덮지 않고 `paper-cards-report.js`가 정적 층만 갈아 끼운다 —
 * 층이 서로를 지우면 리포트 내용이 「어느 게이트가 마지막에 돌았나」로 정해진다.
 *
 * 검사 6종:
 *   S1  매니페스트 불변식 — paper-manifest-check.mjs를 그대로 부른다(I1~I6, index.json 상등 포함)
 *   S2  원장 text_multiset == slots.json text_multiset (정확 상등)
 *   S3  상태 링크 폐포 — slots.state_controls.marks[].boards[] 대상이 전부 96 색인 안
 *   S4  Paper 트리 드리프트 — 원장 .tree.txt 와 템플릿 paper.tree.txt 대조
 *   S5  레지스트리 드리프트 — `python scripts/paper_board_extract.py --check` (--no-python으로 생략)
 *   S6  색인 대칭 — board-templates.index.generated.js == 96 + fixture-quote
 *
 * ── S2를 완화하지 않는 이유 (설계서 §8 4번)
 * 원장의 text_multiset은 **보드 전체**를, slots.json은 **카드 표면 노드 아래**를 센다.
 * 그래서 보드 머리글 텍스트가 원장에만 있는 보드가 생긴다. 그럼에도 상등을 느슨하게 풀지 않는다 —
 * 어긋난 보드마다 어느 텍스트가 어느 슬롯·어느 원장 노드에서 왔는지를 리포트에 적어
 * 사람이 원인을 갈라내게 한다. 상등을 풀면 게이트가 조용히 거짓말한다.
 *
 * ── S4가 설계서 §3.2의 해시 식을 그대로 쓰지 않는 이유
 * §3.2는 `ledger.tree_summary_sha256` vs `sha256(normalize(paper.tree.txt))`를 지시하고
 * 정규화로 CRLF·후행 공백·후행 개행만 든다. 그 식은 96장 전부에서 **구조적으로** 실패한다(실측 0/96):
 *   (1) 뿌리가 다르다 — 원장 트리는 보드(아트보드)에서, 템플릿 트리는 표면 노드에서 시작한다.
 *   (2) 기하가 다르다 — 원장은 fit-content 붕괴로 0×0을 적은 노드가 많다.
 *       설계서 §8 3번이 "게이트가 원장 height로 어떤 판정도 하면 안 된다"고 못 박았다.
 *   (3) 이름 절단 폭이 다르다 — 템플릿 추출기는 노드 이름을 `…`로 자르고 원장은 안 자른다.
 *   (4) 개행 표기가 다르다 — 템플릿은 텍스트 안 개행을 `\n` 두 글자로, 원장은 실제 개행으로 쓴다.
 * 이 넷은 Paper 내용의 차이가 아니라 **추출기 표기의 차이**다. 해시로 재면 판정이 전부 빨개져
 * 진짜 드리프트가 묻힌다(§6.4 작업 변환기가 96개 헛 작업을 낳는다).
 * 그래서 양쪽을 같은 정규형(깊이·종류·노드id·텍스트 + 절단 허용 이름)으로 접은 뒤 레코드 단위로 맞댄다.
 * 접어 없앤 것은 전부 표기이고, Paper 내용(노드 id·계층·텍스트)은 하나도 안 버린다.
 *
 * 성공 표지: paper cards static verification passed
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPaperManifest, loadManifest, LEDGER_DIR, CARD_INDEX_PATH } from './paper-manifest-check.mjs';

// 두 층이 같은 파일에 쓰는 병합 규칙은 CJS 한 곳에 있다(마운트 프로브도 이것을 쓴다).
const require_ = createRequire(import.meta.url);
const { mergeStaticLayer } = require_('../lib/paper-cards-report.js');
const { parseTreeRecords } = require_('../lib/paper-tree.js');

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(APP_DIR, '..');

export const TEMPLATES_DIR = path.join(REPO_ROOT, 'backend', 'ref', 'card-surface-templates');
export const GENERATED_INDEX_PATH = path.join(APP_DIR, 'lib', 'board-templates.index.generated.js');
export const REPORT_PATH = path.join(APP_DIR, 'captures', 'paper-gates', 'PAPER-CARDS.json');
export const FIXTURE_BOARD_ID = 'fixture-quote';

/**
 * 보드에 붙는 실패 코드. 설계서 §3.7 폐쇄집합의 부분집합에 `state_link_unresolved`
 * 하나를 더한다 — §3.7은 상태 링크의 **런타임** 실패(`state_board_missing_in_dom`)만
 * 어휘로 뒀고 정적 폐포가 깨진 경우의 코드가 없다. 코드를 안 주면 실패가 이름 없이 흘러
 * §6.4 변환기가 못 읽는다. 보드에 안 붙는 게이트 전체 실패는 `gate_failures[]`가 따로 받는다
 * (`manifest_broken` · `registry_stale` · `index_asymmetry` — 뒤 하나도 같은 이유로 새로 둔다).
 */
export const STATIC_FAILURE_CODES = Object.freeze([
  'ledger_missing',
  'text_multiset_drift',
  'state_link_unresolved',
  'paper_tree_drift',
]);

// ---------------------------------------------------------------- 트리 정규형

// 파서 본체는 `app/lib/paper-tree.js` 한 곳에 있다 — 카드미니 게이트의 CJS 프로브도
// 같은 트리를 읽어야 하고, 파서를 복사하면 두 게이트가 서로 다른 트리를 보게 된다.
export { parseTreeRecords };

/** `rootId` 노드와 그 아래 전부를 잘라 온다. 없으면 null. */
export function subtreeAt(records, rootId) {
  const start = records.findIndex((record) => record.id === rootId);
  if (start < 0) return null;
  const base = records[start].depth;
  const subtree = [records[start]];
  for (let i = start + 1; i < records.length && records[i].depth > base; i += 1) subtree.push(records[i]);
  return subtree.map((record) => ({ ...record, depth: record.depth - base }));
}

/** 한쪽이 `…`로 잘린 이름끼리는 잘린 앞부분만 맞춘다 — 추출기 절단 폭 차이는 내용 차이가 아니다. */
export function nameMatches(a, b) {
  if (a === b) return true;
  const stem = (value) => (value.endsWith('…') ? value.slice(0, -1) : null);
  const stemA = stem(a);
  const stemB = stem(b);
  return (stemA !== null && b.startsWith(stemA)) || (stemB !== null && a.startsWith(stemB));
}

/**
 * 정규형 레코드 두 줄기를 맞댄다. 어긋난 자리를 순서대로 돌려준다(호출자가 잘라 쓴다).
 * @returns {{at:number, reason:string, template:object|null, ledger:object|null}[]}
 */
export function diffTreeRecords(templateRecords, ledgerRecords) {
  const divergences = [];
  const length = Math.max(templateRecords.length, ledgerRecords.length);
  for (let i = 0; i < length; i += 1) {
    const template = templateRecords[i] ?? null;
    const ledger = ledgerRecords[i] ?? null;
    if (!template || !ledger) {
      divergences.push({ at: i, reason: template ? 'ledger_shorter' : 'template_shorter', template, ledger });
      continue;
    }
    let reason = null;
    if (template.id !== ledger.id) reason = 'node_id';
    else if (template.kind !== ledger.kind) reason = 'kind';
    else if (template.depth !== ledger.depth) reason = 'depth';
    else if (template.text !== ledger.text) reason = 'text';
    else if (!nameMatches(template.name, ledger.name)) reason = 'name';
    if (reason) divergences.push({ at: i, reason, template, ledger });
  }
  return divergences;
}

// ------------------------------------------------------------ 텍스트 다중집합

/**
 * 다중집합 두 개를 `added`/`removed`/`count_changed` 3분류로 가른다(설계서 §3.7).
 * `added`는 slots 쪽에만, `removed`는 원장 쪽에만 있는 텍스트다.
 */
export function diffTextMultiset(ledgerMultiset, slotsMultiset) {
  const added = [];
  const removed = [];
  const countChanged = [];
  for (const text of new Set([...Object.keys(ledgerMultiset), ...Object.keys(slotsMultiset)])) {
    const ledgerCount = ledgerMultiset[text] ?? 0;
    const slotsCount = slotsMultiset[text] ?? 0;
    if (ledgerCount === slotsCount) continue;
    if (!ledgerCount) added.push({ text, count: slotsCount });
    else if (!slotsCount) removed.push({ text, count: ledgerCount });
    else countChanged.push({ text, ledger: ledgerCount, slots: slotsCount });
  }
  const byText = (a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0);
  return { added: added.sort(byText), removed: removed.sort(byText), count_changed: countChanged.sort(byText) };
}

/** 어긋난 텍스트가 어느 슬롯·어느 원장 노드에서 왔는지 짚는다 — 「어느 슬롯이 왜 다른지」. */
function locateText(text, slots, ledgerTexts) {
  return {
    slots: slots.filter((slot) => slot.paper_text === text)
      .map((slot) => ({ slot_id: slot.slot_id, node_id: slot.node_id, region: slot.region, kind: slot.kind })),
    ledger_nodes: ledgerTexts.filter((node) => node.text === text)
      .map((node) => ({ node_id: node.id, path: node.path })),
  };
}

// ------------------------------------------------------------------ 검사 본체

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function loadGeneratedBoardIds(file) {
  return Object.keys(createRequire(import.meta.url)(file).BOARD_CARD ?? {});
}

/**
 * 정적 6종을 전부 돌리고 §3.7 리포트 객체를 만든다.
 * @param {{ledgerDir?:string, templatesDir?:string, cardIndexPath?:string,
 *          generatedIndexPath?:string, repoRoot?:string, runPython?:boolean,
 *          now?:string}} options
 */
export function checkPaperCardsStatic(options = {}) {
  const ledgerDir = options.ledgerDir ?? LEDGER_DIR;
  const templatesDir = options.templatesDir ?? TEMPLATES_DIR;
  const cardIndexPath = options.cardIndexPath ?? CARD_INDEX_PATH;
  const generatedIndexPath = options.generatedIndexPath ?? GENERATED_INDEX_PATH;
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const runPython = options.runPython ?? true;

  const manifestPath = path.join(ledgerDir, 'manifest.json');
  const manifest = loadManifest(ledgerDir);
  const cardIndex = readJson(cardIndexPath);
  const indexIds = new Set(cardIndex.boards.map((board) => board.board_id));
  const pageOf = new Map(manifest.boards.map((board) => [board.id, String(board.page)]));

  // ---------- S1 매니페스트 ----------
  const manifestResult = checkPaperManifest({ ledgerDir, manifest, cardTemplateIds: indexIds });
  const S1 = { ok: manifestResult.failures.length === 0, failures: manifestResult.failures };

  const boards = [];
  const s2Failed = [];
  const s3Unresolved = [];
  const s4Failed = [];
  let stateMarks = 0;
  let stateTargets = 0;

  for (const entry of cardIndex.boards) {
    const boardId = entry.board_id;
    const record = { board_id: boardId, card_id: entry.card_id, name: entry.name, status: 'pass', failures: [] };
    boards.push(record);

    const page = pageOf.get(boardId);
    const ledgerJson = page ? path.join(ledgerDir, page, `${boardId}.json`) : null;
    const ledgerTree = page ? path.join(ledgerDir, page, `${boardId}.tree.txt`) : null;
    const slotsPath = path.join(templatesDir, boardId, 'slots.json');
    const templateTree = path.join(templatesDir, boardId, 'paper.tree.txt');

    const missing = [];
    if (!page) missing.push('manifest에 이 보드가 없다');
    for (const file of [ledgerJson, ledgerTree, slotsPath, templateTree]) {
      if (file && !existsSync(file)) missing.push(path.relative(repoRoot, file).replace(/\\/g, '/'));
    }
    if (missing.length) {
      record.failures.push({ code: 'ledger_missing', layer: 'static', missing });
      record.status = 'fail';
      continue;
    }

    const ledger = readJson(ledgerJson);
    const slots = readJson(slotsPath);

    // ---------- S2 텍스트 다중집합 ----------
    const drift = diffTextMultiset(ledger.text_multiset ?? {}, slots.text_multiset ?? {});
    if (drift.added.length || drift.removed.length || drift.count_changed.length) {
      s2Failed.push(boardId);
      record.status = 'fail';
      record.failures.push({
        code: 'text_multiset_drift',
        layer: 'static',
        added: drift.added.map((item) => ({ ...item, where: locateText(item.text, slots.slots ?? [], ledger.texts ?? []) })),
        removed: drift.removed.map((item) => ({ ...item, where: locateText(item.text, slots.slots ?? [], ledger.texts ?? []) })),
        count_changed: drift.count_changed.map((item) => ({ ...item, where: locateText(item.text, slots.slots ?? [], ledger.texts ?? []) })),
      });
    }

    // ---------- S3 상태 링크 폐포 ----------
    for (const mark of slots.state_controls?.marks ?? []) {
      stateMarks += 1;
      for (const target of mark.boards ?? []) {
        stateTargets += 1;
        if (indexIds.has(target)) continue;
        s3Unresolved.push({ board_id: boardId, control: mark.control, target });
        record.status = 'fail';
        record.failures.push({ code: 'state_link_unresolved', layer: 'static', control: mark.control, target });
      }
    }

    // ---------- S4 Paper 트리 드리프트 ----------
    const templateRecords = parseTreeRecords(readFileSync(templateTree, 'utf8'));
    const ledgerRecords = parseTreeRecords(readFileSync(ledgerTree, 'utf8'));
    const rootId = templateRecords[0]?.id ?? null;
    const ledgerSubtree = rootId ? subtreeAt(ledgerRecords, rootId) : null;
    if (!ledgerSubtree) {
      s4Failed.push(boardId);
      record.status = 'fail';
      record.failures.push({ code: 'paper_tree_drift', layer: 'static', reason: 'root_absent', root: rootId });
    } else {
      const divergences = diffTreeRecords(templateRecords, ledgerSubtree);
      if (divergences.length) {
        s4Failed.push(boardId);
        record.status = 'fail';
        record.failures.push({
          code: 'paper_tree_drift',
          layer: 'static',
          template_records: templateRecords.length,
          ledger_records: ledgerSubtree.length,
          divergences: divergences.slice(0, 5).map((item) => ({
            at: item.at,
            reason: item.reason,
            template: item.template && { kind: item.template.kind, node_id: item.template.id, name: item.template.name, text: item.template.text },
            ledger: item.ledger && { kind: item.ledger.kind, node_id: item.ledger.id, name: item.ledger.name, text: item.ledger.text },
          })),
          divergence_count: divergences.length,
        });
      }
    }
  }

  const S2 = { ok: s2Failed.length === 0, failed_boards: s2Failed };
  const S3 = {
    ok: s3Unresolved.length === 0,
    marks: stateMarks,
    targets: stateTargets,
    unresolved: s3Unresolved,
  };
  const S4 = { ok: s4Failed.length === 0, failed_boards: s4Failed };

  // ---------- S5 레지스트리 드리프트 ----------
  let S5;
  if (!runPython) {
    S5 = { ok: true, skipped: true, why: '--no-python' };
  } else {
    const run = spawnSync('python', ['scripts/paper_board_extract.py', '--check'], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
    });
    const ok = !run.error && run.status === 0;
    S5 = {
      ok,
      skipped: false,
      command: 'python scripts/paper_board_extract.py --check',
      exit_code: run.error ? null : run.status,
      ...(ok ? {} : { stderr_tail: String(run.stderr ?? run.error?.message ?? '').split('\n').slice(-8).join('\n') }),
    };
  }

  // ---------- S6 색인 대칭 ----------
  const generatedIds = new Set(loadGeneratedBoardIds(generatedIndexPath));
  const expected = new Set([...indexIds, FIXTURE_BOARD_ID]);
  const extra = [...generatedIds].filter((id) => !expected.has(id)).sort();
  const absent = [...expected].filter((id) => !generatedIds.has(id)).sort();
  const S6 = { ok: extra.length === 0 && absent.length === 0, generated: generatedIds.size, expected: expected.size, extra, absent };

  // 보드에 귀속되지 않는 게이트 전체 실패(§3.7 `manifest_broken` · `registry_stale`).
  // 보드 0장이 빨개도 이것들이 서면 게이트는 선다 — 전제가 깨진 판정은 공허 통과이기 때문이다.
  const gateFailures = [];
  if (!S1.ok) gateFailures.push({ code: 'manifest_broken', layer: 'static', failures: S1.failures });
  if (!S5.ok) gateFailures.push({ code: 'registry_stale', layer: 'static', exit_code: S5.exit_code });
  if (!S6.ok) gateFailures.push({ code: 'index_asymmetry', layer: 'static', extra, absent });

  const failedBoards = boards.filter((board) => board.status === 'fail');
  return {
    schema_version: 1,
    gate: 'verify:paper-cards-static',
    generated_at: options.now ?? new Date().toISOString(),
    manifest_sha256: createHash('sha256').update(readFileSync(manifestPath)).digest('hex'),
    totals: {
      boards: cardIndex.boards.length,
      pass: cardIndex.boards.length - failedBoards.length,
      fail: failedBoards.length,
      static_fail: failedBoards.length,
      mount_fail: null,
    },
    gate_failures: gateFailures,
    static: {
      S1_manifest: S1,
      S2_text_multiset: S2,
      S3_state_links: S3,
      S4_paper_tree: S4,
      S5_registry_drift: S5,
      S6_index_symmetry: S6,
    },
    boards,
  };
}

/** CLI 출력과 종료코드. 실패 경로를 테스트가 부를 수 있게 순수 함수로 뽑았다. */
export function formatCliReport(report, reportPath = REPORT_PATH) {
  const rel = path.relative(REPO_ROOT, reportPath).replace(/\\/g, '/');
  const s = report.static;
  const lines = [
    `[paper-cards-static] 보드 ${report.totals.boards}장 · 통과 ${report.totals.pass} · 실패 ${report.totals.fail}`,
    `  S1 매니페스트     ${s.S1_manifest.ok ? 'ok' : `실패 ${s.S1_manifest.failures.length}건`}`,
    `  S2 텍스트 다중집합 ${s.S2_text_multiset.ok ? 'ok' : `어긋난 보드 ${s.S2_text_multiset.failed_boards.join(', ')}`}`,
    `  S3 상태 링크      ${s.S3_state_links.ok ? `ok (마크 ${s.S3_state_links.marks} · 대상 ${s.S3_state_links.targets} · 미해소 0)` : `미해소 ${s.S3_state_links.unresolved.length}건`}`,
    `  S4 Paper 트리     ${s.S4_paper_tree.ok ? 'ok' : `어긋난 보드 ${s.S4_paper_tree.failed_boards.join(', ')}`}`,
    `  S5 레지스트리     ${s.S5_registry_drift.skipped ? '건너뜀 (--no-python)' : s.S5_registry_drift.ok ? 'ok' : `exit ${s.S5_registry_drift.exit_code}`}`,
    `  S6 색인 대칭      ${s.S6_index_symmetry.ok ? `ok (${s.S6_index_symmetry.generated})` : `초과 ${s.S6_index_symmetry.extra.join(', ')} · 누락 ${s.S6_index_symmetry.absent.join(', ')}`}`,
    `  리포트 ${rel}`,
  ];
  if (report.totals.static_fail === 0 && report.gate_failures.length === 0) {
    return { exitCode: 0, lines: [...lines, 'paper cards static verification passed'] };
  }
  return { exitCode: 1, lines };
}

export function writeReport(report, reportPath = REPORT_PATH) {
  mkdirSync(path.dirname(reportPath), { recursive: true });
  const existing = existsSync(reportPath) ? readJson(reportPath) : null;
  writeFileSync(reportPath, JSON.stringify(mergeStaticLayer(existing, report), null, 2) + '\n');
  return reportPath;
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const report = checkPaperCardsStatic({ runPython: !process.argv.includes('--no-python') });
  writeReport(report);
  const { exitCode, lines } = formatCliReport(report);
  for (const line of lines) (exitCode ? console.error : console.log)(line);
  process.exit(exitCode);
}
