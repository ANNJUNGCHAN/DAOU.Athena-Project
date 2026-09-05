#!/usr/bin/env node
/**
 * 게이트 리포트 → 구현 작업 명세 변환기 (설계서 §6.4 · §7 13번).
 *
 *   node scripts/paper-gate-tasks.mjs \
 *     --report app/captures/paper-gates/PAPER-SCREENS.json \
 *     --report app/captures/paper-gates/PAPER-CARDS.json \
 *     --report app/captures/paper-gates/PAPER-MINI.json \
 *     --limit 20 --out .omc/plans/paper-tasks.json
 *
 * **작업 1개 = 보드 1장.** 한 보드에 실패가 여럿이면 한 작업으로 합친다 — 같은 보드를
 * 두 사람이 동시에 여는 것을 막는 게 이 규칙의 전부다.
 *
 * 산출은 이 저장소의 tasks JSON 형식(배열의 원소마다 key·title·size·spec·files·gates)이고,
 * 어디서 왔는지 되짚을 수 있게 `source`를 덧붙인다.
 *
 * ── 이 변환기가 하지 않는 일
 * 판정을 하지 않는다. 리포트가 실패라 적은 것만 옮긴다. 리포트를 다시 읽어 「이건 사실
 * 통과다」라고 고쳐 쓰기 시작하면 게이트가 둘이 되고 둘은 반드시 어긋난다.
 *
 * ── 실패 코드 무게 (정렬 1키)
 * 설계서 §6.4는 네 개(route_missing > phrase_missing > structure_mismatch > overflow_x)의
 * 순서만 정했다. 실제 세 게이트가 뱉는 코드는 15종이라 그 상대 순서를 지키면서 나머지를
 * 끼워 넣었다. 큰 원칙: **도달 자체가 없는 것 > 문구가 없는 것 > 구조가 다른 것 >
 * 기하가 넘치는 것 > 값이 낡은 것**. 값 부류(카드미니)가 맨 뒤인 것은 설계서 §5.2대로
 * `paper_cross_board`가 0이 되기 전에는 대장을 못 고치기 때문이다.
 *
 * ── 정렬 키를 설계서와 바꿨다 (무게가 페이지 보드 수보다 앞선다)
 * §6.4는 1키를 「같은 페이지 보드 수 내림차순」으로 적었다. 실측 311장을 그 순서로
 * 세우면 H-1 카드미니 171장이 앞을 다 채우고 `route_missing` 96장이 뒤로 밀린다.
 * 그런데 카드미니 어긋남은 §5.2가 「이 게이트는 보고만 한다」고 못 박은 부류라, 그
 * 배치를 랄프에 넘기면 아무도 못 고칠 작업 20개를 받는다. 무게를 1키로 올려 §6.4가
 * 노린 「한 파일을 여는 김에 여러 장을 닫는다」는 **같은 코드 안에서** 살렸다.
 *
 * ── files 추론
 * 코드마다 후보 경로를 만들고 **저장소에 실재하는 것만 남긴다.** 없는 경로를 적으면
 * 구현자가 없는 파일을 찾아 헤맨다. 새로 만들 파일(예: 라우트표에 줄을 더하는 것)은
 * 이미 있는 파일을 고치는 일이라 이 규칙에 걸리지 않는다.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'backend', 'ref', 'paper-ledger', 'manifest.json');

const USAGE = 'usage: node scripts/paper-gate-tasks.mjs --report <path> [--report <path>…] [--limit <n>] [--out <path>]';

// ---------------------------------------------------------------- 인자

export function parseArgs(argv) {
  const reports = [];
  let limit = null;
  let out = null;
  const value = (i) => {
    const next = argv[i + 1];
    return (!next || next.startsWith('--')) ? null : next;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--report') {
      const next = value(i);
      if (!next) return { error: '--report 뒤에 리포트 경로가 필요하다' };
      reports.push(next);
      i += 1;
    } else if (arg === '--limit') {
      const next = value(i);
      if (!next) return { error: '--limit 뒤에 개수가 필요하다' };
      if (!/^[1-9][0-9]*$/.test(next)) return { error: `--limit 은 1 이상 정수여야 한다 — ${next}` };
      limit = Number(next);
      i += 1;
    } else if (arg === '--out') {
      const next = value(i);
      if (!next) return { error: '--out 뒤에 파일 경로가 필요하다' };
      out = next;
      i += 1;
    } else {
      return { error: `모르는 인자 ${arg}` };
    }
  }
  if (!reports.length) return { error: '--report 가 최소 하나 필요하다' };
  return { reports, limit, out };
}

// ---------------------------------------------------------------- 지도·표

const ROLE_LABEL = Object.freeze({
  screen: '화면',
  contract: '계약',
  card_template: '카드',
  card_spec: '카드 규격',
  mini_card: '카드미니',
  mini_template: '카드미니 견본',
  reference: '참조',
  record: '기록',
  retired: '폐기',
});

// 페이지 → 그 페이지를 그리는 코드 (설계서 §6.4). 라우트 저작이 열게 될 파일이다.
const PAGE_CODE = Object.freeze({
  '1-0': ['app/shell.html', 'app/shell.js', 'app/lib/onboarding.js', 'app/lib/settings-cards.js'],
  'D-2': ['app/lib/graph-mode/controller.js', 'app/lib/canvas-layout.js'],
  'A-2': ['app/lib/agent-canvas.js', 'app/lib/agent-sidebar-list.js', 'app/lib/watch-nodes.js'],
  'B-2': ['app/lib/plugin-canvas.js', 'app/lib/plugin-proposal.js', 'app/lib/plugin-catalog.js'],
  'C-2': ['app/orb.js', 'app/lib/orb-mini-card.js'],
  '8-1': ['app/lib/backtest-canvas.js', 'app/lib/backtest-spec.js', 'app/lib/backtest-visual-editor.js'],
});

const templateFiles = (board) => [
  `backend/ref/card-surface-templates/${board}/paper.jsx`,
  `backend/ref/card-surface-templates/${board}/paper.tree.txt`,
  `backend/ref/card-surface-templates/${board}/slots.json`,
];
const boardHtml = (board) => `backend/ref/card-surface-templates/${board}/board.html`;
const KIUMI_LEDGER = 'backend/ref/kiumi/kiumi-ledger.jsonl';

/**
 * 실패 코드 표. weight는 정렬 2키, why는 spec 한 줄, files는 후보 경로다.
 * ctx = { board, page, templateBoard } — templateBoard는 카드미니에서 대장 보드다.
 */
const CODES = Object.freeze({
  route_missing: {
    weight: 100,
    why: '도달 절차 미정의 — 라우트표에 이 보드가 없다',
    files: (ctx) => ['app/lib/paper-screen-routes.js', ...(PAGE_CODE[ctx.page] ?? [])],
  },
  contract_no_sentence: {
    weight: 92,
    why: '계약 보드에서 대조할 문장을 한 줄도 못 뽑았다 — 원장 추출이나 제외 규칙을 본다',
    files: () => ['docs/ui/paper-card-surface-charter.md', 'app/scripts/paper-phrases.mjs'],
  },
  contract_undocumented: {
    weight: 90,
    why: 'Paper가 그린 계약 문장이 docs/ui·docs/architecture 어디에도 없다',
    files: () => ['docs/ui/paper-card-surface-charter.md'],
  },
  paper_tree_drift: {
    weight: 80,
    why: '원장 트리와 템플릿 트리가 어긋난다 — 대조의 전제가 깨졌다',
    files: (ctx) => [...templateFiles(ctx.templateBoard), 'scripts/paper_board_extract.py'],
  },
  text_multiset_drift: {
    weight: 70,
    why: '템플릿 슬롯 문구가 원장과 다르다(정적)',
    files: (ctx) => [...templateFiles(ctx.templateBoard), 'scripts/paper_board_extract.py'],
  },
  text_multiset_dom_mismatch: {
    weight: 65,
    why: '마운트한 DOM 문구가 슬롯과 다르다 — 코드가 원장 문구를 못 그린다',
    files: (ctx) => [boardHtml(ctx.templateBoard), `backend/ref/card-surface-templates/${ctx.templateBoard}/slots.json`, 'app/lib/board-mount.js'],
  },
  state_board_missing_in_dom: {
    weight: 60,
    why: '상태 보드가 DOM에 다 서지 않는다 — 상태 링크가 끊겼다',
    files: (ctx) => ['app/lib/board-mount.js', 'app/canvas.js', boardHtml(ctx.templateBoard)],
  },
  registry_stale: {
    weight: 58,
    why: '보드 레지스트리가 템플릿보다 낡았다',
    files: () => ['app/lib/board-templates.index.generated.js', 'scripts/build_board_registry.py'],
  },
  surface_geometry: {
    weight: 55,
    why: '세로 넘침·겹침 — 표면 기하가 깨졌다',
    files: (ctx) => ['app/styles/board-surface.css', boardHtml(ctx.templateBoard)],
  },
  overflow_x: {
    weight: 50,
    why: '가로 넘침 — 좁은 프리셋에서 표면이 밖으로 샌다',
    files: (ctx) => ['app/styles/board-surface.css', boardHtml(ctx.templateBoard)],
  },
  paper_cross_board: {
    weight: 45,
    why: 'Paper가 다른 보드의 값을 들고 있다 — 코드가 아니라 Paper를 고치는 작업이다',
    files: () => ['backend/ref/kiumi/README.md', 'backend/ref/kiumi/evidence/paper-ledger-divergence-20260904.json'],
  },
  missing_in_paper: {
    weight: 40,
    why: '대장에 있는 항목이 Paper 카드미니에 없다',
    files: (ctx) => [KIUMI_LEDGER, ...templateFiles(ctx.templateBoard)],
  },
  ledger_stale: {
    weight: 35,
    why: 'Paper 값이 같은 보드의 대장 값과 다르다 — 대장이 낡았다',
    files: (ctx) => [KIUMI_LEDGER, ...templateFiles(ctx.templateBoard)],
  },
  paper_form_deviation: {
    weight: 30,
    why: '같은 값을 Paper와 대장이 다른 표기로 적었다',
    files: (ctx) => [KIUMI_LEDGER, ...templateFiles(ctx.templateBoard)],
  },
  unbacked: {
    weight: 25,
    why: 'Paper 값이 어느 대장 보드에도 없다 — 출처 없는 값이다',
    files: () => [KIUMI_LEDGER, 'backend/ref/kiumi/README.md'],
  },
  annotation_drift: {
    weight: 20,
    why: 'Paper 주석 네 줄이 대장 annotation과 다르다',
    files: () => [KIUMI_LEDGER],
  },
});

const DEFAULT_CODE = Object.freeze({ weight: 10, why: '리포트가 실패로 적었다', files: () => [] });
const codeSpec = (code) => CODES[code] ?? DEFAULT_CODE;

// 리포트 이름 → 판정 명령·게이트. `gate` 필드가 정본이고 파일명은 쓰지 않는다.
const REPORTS = Object.freeze({
  'verify:paper-screens': {
    name: 'PAPER-SCREENS',
    gates: ['unit', 'verify:paper-screens'],
    rerun: (board) => `cd app && npm run verify:paper-screens -- --only ${board}`,
  },
  'verify:paper-cards-all': {
    name: 'PAPER-CARDS',
    gates: ['unit', 'verify:paper-cards-static', 'verify:paper-cards-mount'],
    rerun: (board) => `cd app && npm run verify:paper-cards-static && ATHENA_VERIFY_BOARD_IDS=${board} npm run verify:paper-cards-mount`,
  },
  'verify:paper-mini': {
    name: 'PAPER-MINI',
    gates: ['unit', 'verify:paper-mini-static'],
    rerun: () => 'cd app && npm run verify:paper-mini-static',
  },
});

const UNKNOWN_REPORT = Object.freeze({
  name: 'UNKNOWN',
  gates: ['unit'],
  rerun: () => '리포트의 gate 필드를 못 알아봤다 — 판정 명령을 손으로 적어라',
});

// ---------------------------------------------------------------- 증거 한 줄

/** 실패 하나를 사람이 읽는 한 줄로 줄인다. 코드마다 살아 있는 필드가 달라 분기한다. */
function evidenceOf(failure) {
  const bits = [];
  const texts = (list) => (list ?? []).slice(0, 3).map((item) => item.text ?? item.paper_text).filter(Boolean).join(' / ');
  if (failure.preset) bits.push(`프리셋 ${failure.preset}`);
  if (failure.code === 'overflow_x') bits.push(`${failure.overflow_x}px 넘침`);
  if (failure.code === 'surface_geometry' && failure.vertical_overflow_nodes?.length) {
    bits.push(`세로 넘침 ${failure.vertical_overflow_nodes.length}개`);
  }
  if (failure.code === 'state_board_missing_in_dom') bits.push(`상태 보드 ${failure.expected}장 중 ${failure.in_dom}장`);
  if (failure.code === 'paper_tree_drift') {
    const first = failure.divergences?.[0];
    bits.push(`${failure.divergence_count}곳 어긋남${first ? ` (첫 ${first.at}행 ${first.reason})` : ''}`);
  }
  if (failure.added?.length) bits.push(`늘어남 ${texts(failure.added)}`);
  if (failure.removed?.length) bits.push(`빠짐 ${texts(failure.removed)}`);
  if (failure.count_changed?.length) bits.push(`셈 다름 ${texts(failure.count_changed)}`);
  if (failure.sentences?.length) bits.push(`문장 「${failure.sentences[0]}」`);
  if (failure.elements?.length) bits.push(`항목 ${texts(failure.elements)}`);
  if (failure.drift?.length) bits.push(failure.drift.map((item) => item.field).join('·'));
  if (failure.text) bits.push(`「${failure.text}」${failure.label ? ` (${failure.label})` : ''}`);
  if (failure.found_in) bits.push(`대장 ${failure.found_in}`);
  return bits.join(', ');
}

// ---------------------------------------------------------------- 수집

const boardIdOf = (record) => record.board_id ?? record.paper_board ?? null;

/** 리포트 하나에서 실패한 보드를 뽑는다. templates[]도 boards[]와 같이 본다. */
export function collectRecords(report) {
  const meta = REPORTS[report.gate] ?? UNKNOWN_REPORT;
  const out = [];
  for (const record of [...(report.boards ?? []), ...(report.templates ?? [])]) {
    const failures = record.failures ?? [];
    if (!failures.length) continue;
    const board = boardIdOf(record);
    if (!board) continue;
    out.push({
      board,
      name: record.name ?? '',
      page: record.page ?? null,
      role: record.role ?? null,
      templateBoard: record.ledger_board ?? board,
      report: meta,
      failures,
    });
  }
  return out;
}

// ---------------------------------------------------------------- 정렬 키

/** 보드명 선두 번호(「07 · 주문 …」의 07). 없으면 맨 뒤로 민다. */
function leadingNumber(name) {
  const match = /^\s*(\d+)/.exec(String(name ?? ''));
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

const sizeOf = (failures) => (failures.length <= 2 ? 'S' : failures.length <= 8 ? 'M' : 'L');

// ---------------------------------------------------------------- 작업 조립

function toTask(record, { exists }) {
  const ctx = { board: record.board, page: record.page, templateBoard: record.templateBoard };
  const byWeight = [...record.failures].sort((a, b) => codeSpec(b.code).weight - codeSpec(a.code).weight);

  const codes = [];
  const lines = [];
  const files = new Set();
  if (record.page) files.add(`backend/ref/paper-ledger/${record.page}/${record.board}.json`);
  for (const failure of byWeight) {
    const spec = codeSpec(failure.code);
    const same = record.failures.filter((item) => item.code === failure.code);
    if (!codes.includes(failure.code)) {
      codes.push(failure.code);
      const count = same.length > 1 ? ` ×${same.length}` : '';
      const evidence = same.map(evidenceOf).filter(Boolean).slice(0, 2).join(' | ');
      lines.push(`${failure.code}${count} — ${spec.why}${evidence ? `. ${evidence}` : ''}`);
    }
    for (const file of spec.files(ctx)) files.add(file);
  }

  const label = ROLE_LABEL[record.role] ?? '보드';
  const spec = [
    `plan-paper-gates.md §6.4 자동 생성 — ${record.report.name}.json 이 보드 ${record.board}(${record.page ?? '페이지 미상'})를 실패로 판정했다.`,
    ...lines,
    `판정: ${record.report.rerun(record.board)} 가 이 보드를 pass 로 만들어야 한다.`,
  ].join('\n');

  return {
    key: `PAPER-${record.page ?? 'unknown'}-${record.board}`,
    title: `${label} ${record.name}`.trim(),
    size: sizeOf(record.failures),
    spec,
    files: [...files].filter((file) => exists(file)),
    gates: [...record.report.gates],
    source: {
      report: record.report.name,
      board: record.board,
      page: record.page,
      codes,
    },
  };
}

/**
 * 리포트들을 작업 배열로 바꾼다.
 * @param {object[]} reports 리포트 JSON 그대로
 * @param {object} manifest 원장 매니페스트(페이지·이름·역할 보강)
 * @param {number|null} limit 정렬 뒤 앞에서 자를 개수
 * @param {(file: string) => boolean} exists files 실재 판정(주입 — 기본은 저장소 실경로)
 */
export function buildTasks({ reports, manifest, limit = null, exists = (file) => existsSync(path.join(REPO_ROOT, file)) }) {
  const known = new Map((manifest?.boards ?? []).map((board) => [board.id, board]));

  // 한 보드가 두 리포트에 걸치면 한 작업으로 합친다.
  const merged = new Map();
  for (const report of reports) {
    for (const record of collectRecords(report)) {
      const board = known.get(record.board);
      const filled = {
        ...record,
        page: record.page ?? board?.page ?? null,
        name: record.name || board?.name || record.board,
        role: record.role ?? board?.role ?? null,
      };
      const prior = merged.get(record.board);
      if (prior) prior.failures = [...prior.failures, ...filled.failures];
      else merged.set(record.board, filled);
    }
  }

  const records = [...merged.values()];
  const pageCount = new Map();
  for (const record of records) {
    const key = record.page ?? 'unknown';
    pageCount.set(key, (pageCount.get(key) ?? 0) + 1);
  }
  const weightOf = (record) => Math.max(...record.failures.map((item) => codeSpec(item.code).weight));

  records.sort((a, b) => {
    const byWeight = weightOf(b) - weightOf(a);
    if (byWeight) return byWeight;
    const byPage = (pageCount.get(b.page ?? 'unknown') ?? 0) - (pageCount.get(a.page ?? 'unknown') ?? 0);
    if (byPage) return byPage;
    const pageName = String(a.page ?? '').localeCompare(String(b.page ?? ''));
    if (pageName) return pageName;
    const byNumber = leadingNumber(a.name) - leadingNumber(b.name);
    if (byNumber) return byNumber;
    return a.board.localeCompare(b.board);
  });

  const tasks = records.map((record) => toTask(record, { exists }));
  return limit ? tasks.slice(0, limit) : tasks;
}

// ---------------------------------------------------------------- CLI

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    process.stderr.write(`${parsed.error}\n${USAGE}\n`);
    process.exit(2);
  }
  const reports = [];
  for (const file of parsed.reports) {
    const abs = path.resolve(REPO_ROOT, file);
    if (!existsSync(abs)) {
      process.stderr.write(`리포트가 없다 — ${file}. 게이트를 먼저 돌려라.\n`);
      process.exit(2);
    }
    reports.push(JSON.parse(readFileSync(abs, 'utf8')));
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const tasks = buildTasks({ reports, manifest, limit: parsed.limit });
  const json = `${JSON.stringify(tasks, null, 2)}\n`;
  if (parsed.out) {
    const abs = path.resolve(REPO_ROOT, parsed.out);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, json, 'utf8');
    const byReport = new Map();
    for (const task of tasks) byReport.set(task.source.report, (byReport.get(task.source.report) ?? 0) + 1);
    process.stdout.write(`[paper-gate-tasks] 작업 ${tasks.length}개 → ${parsed.out}\n`);
    for (const [name, count] of byReport) process.stdout.write(`  ${name} ${count}개\n`);
  } else {
    process.stdout.write(json);
  }
}
