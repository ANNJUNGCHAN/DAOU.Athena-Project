/**
 * Paper 원장 매니페스트 불변식 게이트 — `backend/ref/paper-ledger/manifest.json`이
 * 세 전수 게이트(카드 101 · 화면계 · 카드미니 203)의 전제조건을 지키는지 정적으로 잰다.
 * Electron 없이 파일만 읽는 오라클이라 밀리초 안에 끝난다.
 *
 * 왜 필요한가: 추출기가 `page`를 스크립트 상수로 박아 넣기 때문에 원장 JSON의
 * `page` 필드는 믿을 수 없다. 게이트는 매니페스트 하나만 정본으로 믿는다 —
 * 그래서 매니페스트가 조용히 썩으면 그 위의 게이트 전부가 공허 통과한다.
 * 이 검사가 그 부류를 막는다(fail-closed).
 *
 * 불변식 6개:
 *   I1  sum(pages[].boards) == boards[].length == 449
 *   I2  페이지별 boards[] 실개수 == pages[].boards
 *   I3  role=="card_template" 집합 == card-surface-templates/index.json 101개 (정확 상등)
 *   I4  role=="retired"는 why 필수 — 사유 없는 제외 금지
 *   I5  모든 boards[].id에 대해 <page>/<id>.json 과 .tree.txt 가 실재(역방향 포함)
 *   I6  원장 JSON의 tree_summary_sha256 == sha256(같은 보드의 .tree.txt 바이트)
 * 형식 검사(위 6개의 전제): schema_version·role 폐쇄집합·id 유일·page 등록 여부.
 *
 * 성공 표지: paper manifest verification passed
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(APP_DIR, '..');

export const LEDGER_DIR = path.join(REPO_ROOT, 'backend', 'ref', 'paper-ledger');
export const CARD_INDEX_PATH = path.join(REPO_ROOT, 'backend', 'ref', 'card-surface-templates', 'index.json');
export const TOTAL_BOARDS = 449;
export const ROLES = Object.freeze([
  'screen',
  'card_template',
  'card_spec',
  'mini_template',
  'mini_card',
  'contract',
  'record',
  'reference',
  'retired',
]);

/**
 * .tree.txt 원문에서 해시 대상 바이트 후보를 고른다.
 *
 * 추출기의 개행 관례가 두 갈래다 — 444장 중 384장은 파일 원문 그대로,
 * 60장은 끝 개행 1개를 뺀 바이트로 tree_summary_sha256을 냈다. 둘 다 인정한다.
 * CR은 어느 관례에도 없다: CRLF로 저장된 원문은 정규화해 살려주지 않고
 * 그대로 실패시킨다 — 커밋된 바이트에서 재현되지 않는 해시는 무결성 필드가 아니다.
 */
function treeHashes(raw) {
  const candidates = [raw];
  if (raw.length && raw[raw.length - 1] === 0x0a) candidates.push(raw.subarray(0, -1));
  return candidates.map((buffer) => createHash('sha256').update(buffer).digest('hex'));
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function loadManifest(ledgerDir = LEDGER_DIR) {
  return readJson(path.join(ledgerDir, 'manifest.json'));
}

export function loadCardTemplateIds(indexPath = CARD_INDEX_PATH) {
  return new Set(readJson(indexPath).boards.map((board) => board.board_id));
}

/**
 * @returns {{ failures: string[], counts: Record<string, number> }}
 */
export function checkPaperManifest(options = {}) {
  const ledgerDir = options.ledgerDir ?? LEDGER_DIR;
  const manifest = options.manifest ?? loadManifest(ledgerDir);
  const cardTemplateIds = options.cardTemplateIds ?? loadCardTemplateIds(options.cardIndexPath);
  const failures = [];
  const counts = {};

  if (manifest.schema_version !== 1) {
    failures.push(`schema_version가 1이 아니다: ${JSON.stringify(manifest.schema_version)}`);
  }
  const pages = Array.isArray(manifest.pages) ? manifest.pages : [];
  const boards = Array.isArray(manifest.boards) ? manifest.boards : [];
  if (!pages.length) failures.push('pages[]가 비었다');
  if (!boards.length) failures.push('boards[]가 비었다');

  // ---------- 형식: role 폐쇄집합 · id 유일 · page 등록 ----------
  const pageIds = new Set(pages.map((page) => page.id));
  const seen = new Set();
  for (const board of boards) {
    if (!ROLES.includes(board.role)) {
      failures.push(`${board.id}: role "${board.role}"은 폐쇄집합 밖이다`);
    }
    if (seen.has(board.id)) failures.push(`${board.id}: boards[]에 중복 등록됐다`);
    seen.add(board.id);
    if (!pageIds.has(board.page)) {
      failures.push(`${board.id}: page "${board.page}"가 pages[]에 없다`);
    }
    counts[board.role] = (counts[board.role] ?? 0) + 1;
  }

  // ---------- I1 ----------
  const declared = pages.reduce((sum, page) => sum + (page.boards ?? 0), 0);
  if (declared !== TOTAL_BOARDS) {
    failures.push(`I1 sum(pages[].boards) == ${declared} (기대 ${TOTAL_BOARDS})`);
  }
  if (boards.length !== TOTAL_BOARDS) {
    failures.push(`I1 boards[].length == ${boards.length} (기대 ${TOTAL_BOARDS})`);
  }

  // ---------- I2 ----------
  const actualPerPage = new Map();
  for (const board of boards) {
    actualPerPage.set(board.page, (actualPerPage.get(board.page) ?? 0) + 1);
  }
  for (const page of pages) {
    const actual = actualPerPage.get(page.id) ?? 0;
    if (actual !== page.boards) {
      failures.push(`I2 페이지 ${page.id}: boards[] 실개수 ${actual} != 선언 ${page.boards}`);
    }
  }

  // ---------- I3 ----------
  const manifestTemplates = new Set(
    boards.filter((board) => board.role === 'card_template').map((board) => board.id),
  );
  for (const id of manifestTemplates) {
    if (!cardTemplateIds.has(id)) failures.push(`I3 ${id}: card_template인데 index.json에 없다`);
  }
  for (const id of cardTemplateIds) {
    if (!manifestTemplates.has(id)) failures.push(`I3 ${id}: index.json에 있는데 card_template이 아니다`);
  }

  // ---------- I4 ----------
  for (const board of boards) {
    if (board.role === 'retired' && !String(board.why ?? '').trim()) {
      failures.push(`I4 ${board.id}: retired인데 why가 없다`);
    }
  }

  // ---------- I5 ----------
  for (const board of boards) {
    for (const suffix of ['.json', '.tree.txt']) {
      const file = path.join(ledgerDir, String(board.page), `${board.id}${suffix}`);
      if (!existsSync(file)) failures.push(`I5 ${board.id}: 원장 파일이 없다 — ${board.page}/${board.id}${suffix}`);
    }
  }

  // ---------- I5 역방향: 원장에만 있고 매니페스트에는 없는 보드 ----------
  const registered = new Set(boards.map((board) => `${board.page}/${board.id}`));
  for (const page of pages) {
    const dir = path.join(ledgerDir, String(page.id));
    if (!existsSync(dir)) continue; // 앞의 I5가 보드별로 이미 잡았다
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.json')) continue;
      const id = entry.slice(0, -'.json'.length);
      if (!registered.has(`${page.id}/${id}`)) {
        failures.push(`I5 ${page.id}/${entry}: 원장에 있는데 매니페스트에 없다`);
      }
    }
  }

  // ---------- I6 ----------
  for (const board of boards) {
    const dir = path.join(ledgerDir, String(board.page));
    const jsonFile = path.join(dir, `${board.id}.json`);
    const treeFile = path.join(dir, `${board.id}.tree.txt`);
    if (!existsSync(jsonFile) || !existsSync(treeFile)) continue; // I5가 이미 잡았다
    const recorded = readJson(jsonFile).tree_summary_sha256;
    const raw = readFileSync(treeFile);
    if (!recorded) {
      failures.push(`I6 ${board.id}: tree_summary_sha256이 없다`);
    } else if (!treeHashes(raw).includes(recorded)) {
      const crlf = raw.includes('\r\n') ? ' (CRLF로 저장됐다)' : '';
      failures.push(`I6 ${board.id}: tree_summary_sha256이 ${board.page}/${board.id}.tree.txt 바이트에서 재현되지 않는다${crlf}`);
    }
  }

  return { failures, counts };
}

/**
 * CLI 출력과 종료코드. 실패 경로를 테스트가 부를 수 있게 순수 함수로 뽑았다.
 */
export function formatCliReport({ failures, counts }) {
  if (failures.length) {
    return {
      exitCode: 1,
      lines: ['[paper-manifest] 매니페스트 불변식 위반:', ...failures.map((failure) => '  - ' + failure)],
    };
  }
  const summary = ROLES.map((role) => `${role}=${counts[role] ?? 0}`).join(' ');
  return { exitCode: 0, lines: [`paper manifest verification passed — ${summary}`] };
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const { exitCode, lines } = formatCliReport(checkPaperManifest());
  for (const line of lines) (exitCode ? console.error : console.log)(line);
  process.exit(exitCode);
}
