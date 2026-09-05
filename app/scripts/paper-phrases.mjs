/**
 * 화면계 보드의 「대표 문구」 후보 생성기 — Paper 원장 `texts[]`에서 fixture가 바뀌어도
 * 안 변하는 사용자 노출 문구(제목·부제·버튼·탭·섹션·안내·빈 상태)만 남긴다.
 * 산출물은 `app/lib/paper-screen-phrases.generated.js`이고, 라우트표
 * `app/lib/paper-screen-routes.js`의 `phrases[]`를 저작할 때 그 초안이 된다.
 *
 * 왜 기계가 다 못 정하나: 게이트가 문구를 재는 목적은 「Paper에 있는 라벨이 화면에도 있나」다.
 * 숫자·시각·종목명 같은 데이터 값을 문구로 넣으면 fixture가 바뀔 때마다 게이트가 깨지고,
 * 반대로 라벨을 놓치면 게이트가 공허 통과한다. 그래서 이 생성기는 **후보를 좁혀 줄 뿐**이고
 * 보드당 3~7개로 줄이는 최종 판정은 저작자가 한다(설계서 §4.2).
 *
 * 제외 규칙(설계서 §4.2 E1~E8). E1~E7은 **하드**, E8은 **연성**이다 —
 * §4.4 라우트표 신선도 검사 규칙 5가 금지하는 것이 E1~E7뿐이라서, 같은 경계를 여기서도 쓴다.
 * E8(데이터 토큰이 라벨에 붙은 줄)은 「라벨 부분만 남길지 사람이 판정」이라 버리지 않고
 * `deferred`로 미룬다. 버리면 저작자가 그런 줄이 있었다는 사실조차 못 본다.
 *
 *   E1  순수 수치·통화·증감          1,850 · +1.24% · 28,940,000원
 *   E2  시각·기간·날짜               05:42:18 · 2026-08-25 21:12:04 만료 · 08/25
 *   E3  종목코드·계좌·해시           005930 · 12345678901 · vab12cd
 *   E4  진행 카운터                  3 / 3
 *   E5  복합 데이터 줄               +1,850 · +1.24%  (데이터 토큰 2개 이상)
 *   E6  종목명·계좌 별칭             카드 slots.json이 kind:"value"로 묶은 텍스트
 *   E7  낱말 아닌 표식(폐쇄 목록)      ● ◆ ◐ ○ ▸ · — ↗ × ◌ ✓ ⚠ ▾ ≥ ❚❚
 *   E8  데이터 접미 라벨(연성)        지난 알람 3건 더 · 오늘 07:30
 *
 * ── 6보드 수동 대조(1I0-0 · 1KK-0 · ARM-0 · B57-0 · BIM-0 · BV0-0)로 고친 두 가지
 * (1) E5·E8이 세는 「데이터 토큰」을 E1 수치만이 아니라 시각·날짜·코드(E2·E3 꼴)까지로 넓혔다.
 *     안 그러면 「오늘 07:30」·「8/22 금」·「어제 07:41」이 전부 온전한 후보로 남는다.
 * (2) E7의 폐쇄 목록에 ◌ ✓ ⚠ ▾ ≥ ❚❚ 여섯을 더했다 — 화면계 보드가 설계서의 아홉
 *     글자와 같은 자리에 쓰는데 목록에 하나도 없었다. 목록 자체는 여전히 닫혀 있다.
 *
 * ── E1의 단위 목록은 설계서에 적힌 그대로(원·주·%·배·건·개·종목·억원·만주) 닫아 둔다
 * 넓히면 「다음 24시간」·「최근 30회」 같은 열 제목까지 데이터로 몰린다. 대신 「300초」·
 * 「60초마다」처럼 설정값이 후보로 새어 나온다 — 오차의 방향을 일부러 이쪽으로 잡았다.
 * 저작자는 남은 후보를 지울 수 있지만, 생성기가 지운 라벨은 저작자가 되찾을 길이 없다.
 *
 * 쓰는 법
 *   node scripts/paper-phrases.mjs                 생성물을 다시 쓴다
 *   node scripts/paper-phrases.mjs --board 1I0-0   한 보드 초안을 콘솔에 뿌린다
 *   node scripts/paper-phrases.mjs --check         생성물이 신선한지만 잰다(exit 1로 알린다)
 *
 * 성공 표지: paper phrases generation passed
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest, LEDGER_DIR } from './paper-manifest-check.mjs';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(APP_DIR, '..');

export const TEMPLATES_DIR = path.join(REPO_ROOT, 'backend', 'ref', 'card-surface-templates');
export const GENERATED_PATH = path.join(APP_DIR, 'lib', 'paper-screen-phrases.generated.js');

/** E1이 인정하는 단위. 넓히면 라벨이 데이터로 오분류된다 — 위 머리 주석 참조. */
const UNIT = '(?:원|주|%|배|건|개|종목|억원|만주)';
const NUMBER = '[+\\-−▲▼]?[\\d][\\d,.]*';

/** 한 토큰이 데이터 값인가. E1·E5·E8이 공유하는 유일한 정의다. */
export const NUMERIC_TOKEN = new RegExp(`^${NUMBER}${UNIT}?$`);

/**
 * 값 꼴 4종(E1~E4). 좁은 것부터 재서 모든 패턴이 실제로 닿게 한다 —
 * 설계서가 적은 E1→E4 순서로 재면 `^\d{6}$`(E3)·`^\d{8,}$`(E3)에 도달하기 전에
 * E1이 먼저 먹어 두 패턴이 죽은 코드가 된다. 어느 쪽이든 하드 제외라 판정은 같고
 * 달라지는 것은 진단 이름뿐이라, 이름이 맞는 순서를 골랐다.
 * `n/m`이 진행 카운터(3 / 3)와 날짜(8/22) 사이에서 모호한 것은 규칙 자체의 성질이다 —
 * 둘 다 fixture가 바꾸는 값이라 어느 이름을 붙여도 결론은 같다.
 */
const VALUE_SHAPES = [
  { code: 'E4', patterns: [/^\d+\s*\/\s*\d+$/] },
  { code: 'E2', patterns: [/^\d{1,2}:\d{2}(?::\d{2})?$/, /^\d{4}-\d{2}-\d{2}/, /^\d{8}$/] },
  { code: 'E3', patterns: [/^\d{6}$/, /^\d{8,}$/, /^v?[0-9a-f]{6,}$/] },
  { code: 'E1', patterns: [NUMERIC_TOKEN] },
];

/**
 * 이 토큰이 어떤 값 꼴인가(아니면 null). E5(2개 이상)와 E8(1개)이 이것으로 갈린다.
 * E1 수치만 세면 「오늘 07:30」·「8/22 금」처럼 시각·날짜를 낀 줄이 전부 후보로 남는다
 * (6보드 수동 대조에서 실제로 남았다). 시각·날짜·코드도 fixture가 바꾸는 값이라 같이 센다.
 */
function valueShape(token) {
  for (const rule of VALUE_SHAPES) {
    if (rule.patterns.some((re) => re.test(token))) return rule.code;
  }
  return null;
}

/** Paper 프레임 이름이 이미 CSS 클래스·DOM id를 품는다 — 라벨을 이는 이름들. */
const PROMOTED_SUFFIX = ['-title', '-head', '-kicker', '-sub', '-hint', '-label', '-tab', '-caption'];
const PROMOTED_PREFIX = ['nav-item', 'uk-btn-'];

/** 프레임 이름은 `uk-btn-primary · 계속 (…)`처럼 주석을 달고 있다 — 첫 낱말만 클래스다. */
function frameClassName(name) {
  return String(name ?? '').trim().split(/\s+/)[0] ?? '';
}

export function promotedFrame(name) {
  const cls = frameClassName(name);
  if (!cls) return false;
  if (PROMOTED_PREFIX.some((prefix) => cls.startsWith(prefix))) return true;
  if (PROMOTED_SUFFIX.some((suffix) => cls.endsWith(suffix))) return true;
  return cls.includes('-empty');
}

/**
 * E7의 폐쇄 목록. 설계서가 든 아홉 글자에 6보드 수동 대조로 본 여섯을 더했다.
 * 「글자·숫자 없는 1~2글자」로 넓히지 않는다 — 그러면 원장에 실재하는 →·+·‹ 같은
 * 한 글자 실라벨까지 하드로 버려, 이 파일이 정한 오차 방향(과다 포함 — 생성기가 지운
 * 라벨은 저작자가 되찾을 길이 없다)과 반대로 간다. 남는 표식은 저작자가 지운다.
 */
const E7_MARKS = new Set([
  '●', '◆', '◐', '○', '▸', '·', '—', '↗', '×',   // 설계서 §4.2 E7
  '◌', '✓', '⚠', '▾', '≥', '❚❚',        // 6보드 수동 대조에서 같은 자리에 쓰이는 것
]);

function tokens(text) {
  return text.split(/[\s·]+/).filter(Boolean);
}

/**
 * @param {string} text
 * @param {Set<string>} [valueTexts] E6용 — 카드 slots.json의 kind:"value" 텍스트 집합
 * @returns {{ code: string, hard: boolean } | null}
 */
export function excludeReason(text, valueTexts) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return { code: 'E0', hard: true };
  const whole = valueShape(trimmed);
  if (whole) return { code: whole, hard: true };
  const data = tokens(trimmed).filter((token) => valueShape(token));
  if (data.length >= 2) return { code: 'E5', hard: true };
  if (valueTexts && valueTexts.has(trimmed)) return { code: 'E6', hard: true };
  if (E7_MARKS.has(trimmed)) return { code: 'E7', hard: true };
  if (data.length === 1) return { code: 'E8', hard: false };
  return null;
}

/** E6의 재료. 96장 slots.json에서 값으로 묶인 텍스트를 한 집합으로 모은다(실측 약 200ms). */
export function loadValueSlotTexts(templatesDir = TEMPLATES_DIR) {
  const texts = new Set();
  for (const entry of readdirSync(templatesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(templatesDir, entry.name, 'slots.json');
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue; // slots.json이 없는 폴더는 카드 템플릿이 아니다
    }
    for (const slot of parsed.slots ?? []) {
      if (slot.kind === 'value' && slot.paper_text) texts.add(String(slot.paper_text).trim());
    }
  }
  return texts;
}

export function loadLedgerBoard(page, boardId, ledgerDir = LEDGER_DIR) {
  return JSON.parse(readFileSync(path.join(ledgerDir, page, `${boardId}.json`), 'utf8'));
}

/**
 * 보드 하나의 후보를 뽑는다.
 * @returns {{ board_id, page, name, phrases: Array<{text,count,promoted}>, deferred: Array<{text,count}>, excluded: Record<string,number> }}
 */
export function boardPhrases(ledgerBoard, options = {}) {
  const valueTexts = options.valueTexts;
  const kept = new Map();
  const deferred = new Map();
  const excluded = {};

  for (const node of ledgerBoard.texts ?? []) {
    const text = String(node.text ?? '').trim();
    const promoted = promotedFrame(node.path?.[node.path.length - 1]);
    const reason = excludeReason(text, valueTexts);
    if (reason && reason.hard) {
      excluded[reason.code] = (excluded[reason.code] ?? 0) + 1;
      continue;
    }
    const bucket = reason ? deferred : kept;
    const seen = bucket.get(text);
    if (seen) {
      seen.count += 1;
      seen.promoted = seen.promoted || promoted;
    } else {
      bucket.set(text, { text, count: 1, promoted, order: bucket.size });
    }
  }

  // 가점이 붙은 후보를 앞으로, 같은 층 안에서는 Paper 저작 순서(= 사용자 동선 순서)를 지킨다.
  const rank = (a, b) => (a.promoted === b.promoted ? a.order - b.order : (a.promoted ? -1 : 1));
  const strip = ({ text, count, promoted }) => ({ text, count, promoted });

  return {
    board_id: ledgerBoard.board_id,
    page: options.page ?? ledgerBoard.page,
    name: ledgerBoard.name,
    phrases: [...kept.values()].sort(rank).map(strip),
    deferred: [...deferred.values()].sort(rank).map(({ text, count }) => ({ text, count })),
    excluded,
  };
}

/** 매니페스트 role==="screen" 보드 전량의 후보. 생성물의 원본이다. */
export function buildPhraseIndex(options = {}) {
  const ledgerDir = options.ledgerDir ?? LEDGER_DIR;
  const manifest = options.manifest ?? loadManifest(ledgerDir);
  const valueTexts = options.valueTexts ?? loadValueSlotTexts(options.templatesDir);
  const boards = manifest.boards
    .filter((board) => board.role === 'screen')
    .sort((a, b) => (a.page === b.page ? a.id.localeCompare(b.id) : a.page.localeCompare(b.page)));
  return boards.map((board) =>
    boardPhrases(loadLedgerBoard(board.page, board.id, ledgerDir), { page: board.page, valueTexts }));
}

const json = (value) => JSON.stringify(value);

export function renderGenerated(index) {
  const lines = [
    '// 생성물 — scripts/paper-phrases.mjs가 만든다. 직접 편집하지 마라.',
    '// 원본: backend/ref/paper-ledger/<page>/<board>.json 의 texts[] (매니페스트 role==="screen")',
    '// phrases  = E1~E7을 통과한 사용자 노출 문구 후보. 라우트표 저작자가 3~7개로 줄인다.',
    '// deferred = E8(라벨에 데이터 토큰이 붙은 줄). 라벨만 떼어 쓸지는 사람이 판정한다.',
    "'use strict';",
    '',
    'const PHRASES = Object.freeze({',
  ];
  for (const entry of index) {
    lines.push(`  ${json(entry.board_id)}: Object.freeze({`);
    lines.push(`    page: ${json(entry.page)},`);
    lines.push(`    name: ${json(entry.name)},`);
    lines.push(`    phrases: Object.freeze([${entry.phrases.map((p) => json(p.text)).join(', ')}]),`);
    lines.push(`    deferred: Object.freeze([${entry.deferred.map((p) => json(p.text)).join(', ')}]),`);
    lines.push('  }),');
  }
  lines.push('});', '', 'module.exports = { PHRASES };', '');
  return lines.join('\n');
}

export function formatBoardDraft(entry) {
  const lines = [
    `[paper-phrases] ${entry.board_id} · ${entry.name} (${entry.page})`,
    `  후보 ${entry.phrases.length} · 미룸 ${entry.deferred.length} · 버림 ${Object.entries(entry.excluded).map(([code, n]) => `${code}=${n}`).join(' ') || '0'}`,
    '  phrases: [',
  ];
  for (const phrase of entry.phrases) {
    lines.push(`    ${json(phrase.text)},${phrase.promoted ? '   // 가점' : ''}${phrase.count > 1 ? `   // x${phrase.count}` : ''}`);
  }
  lines.push('  ],');
  if (entry.deferred.length) {
    lines.push('  // E8 미룸 — 라벨만 떼어 쓸지 판정하시오');
    for (const phrase of entry.deferred) lines.push(`  //   ${json(phrase.text)}`);
  }
  return lines.join('\n');
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const boardArg = process.argv.indexOf('--board');
  if (boardArg >= 0) {
    const boardId = process.argv[boardArg + 1];
    const entry = buildPhraseIndex().find((item) => item.board_id === boardId);
    if (!entry) {
      console.error(`[paper-phrases] role==="screen" 보드에 ${boardId}가 없다`);
      process.exit(2);
    }
    console.log(formatBoardDraft(entry));
    process.exit(0);
  }
  const rendered = renderGenerated(buildPhraseIndex());
  const rel = path.relative(REPO_ROOT, GENERATED_PATH).replace(/\\/g, '/');
  if (process.argv.includes('--check')) {
    const committed = readFileSync(GENERATED_PATH, 'utf8');
    if (committed === rendered) {
      console.log(`[paper-phrases] ${rel} 신선함`);
      console.log('paper phrases generation passed');
      process.exit(0);
    }
    console.error(`[paper-phrases] ${rel} 이 낡았다 — node scripts/paper-phrases.mjs 로 다시 생성하라`);
    process.exit(1);
  }
  writeFileSync(GENERATED_PATH, rendered);
  console.log(`[paper-phrases] ${rel} 를 다시 썼다`);
  console.log('paper phrases generation passed');
}
