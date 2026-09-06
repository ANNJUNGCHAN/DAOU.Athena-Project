/**
 * 라우트표 신선도 게이트 — `app/lib/paper-screen-routes.js`가 참조하는 DOM id·IPC
 * 채널·보드 id·대표 문구가 현행 앱과 Paper 원장에 실재하는지 정적으로 대조한다.
 * Electron 없이 파일만 읽는 오라클이라 밀리초 안에 끝난다(설계서 §4.4).
 *
 * 왜 필요한가: `check-harness-freshness.mjs`의 머리 주석이 적은 그 문제다 —
 * 설계가 바뀌면 하네스가 사라진 요소를 계속 참조하면서 "항상 실패" 또는 "공허 통과"로
 * 조용히 거짓말한다. 화면계 게이트는 그 위험이 더 크다: 라우트표는 106장까지 자랄
 * 저작물이고, 전수 프로브는 분 단위라 아무도 매 push에 돌리지 않는다. 표가 썩는 것을
 * 표만 읽어서 잡는 이 게이트가 없으면, 오타 하나가 영원히 안 닫히는 빨간 보드가 된다.
 *
 * 검사 6종(설계서 §4.4).
 *   1) `root`·`reach[].selector`·`structure[].selector`의 DOM id 리터럴이
 *      app/shell.html 또는 app/orb.html에 실재
 *   2) `reach[].channel`(ipc-fixture·ipc-hang·send)이 preload.js 허용 Set 또는 main.js 등록에 실재
 *   3) `board`가 매니페스트 role=="screen" 부분집합이고 중복 없음
 *   4) `phrases[]`가 그 보드 원장 `texts[]`에 실재 — 저작자 오타가 영원한 빨간 보드가
 *      되는 것을 막는다
 *   5) `phrases[]`가 E1~E7(하드 제외)에 걸리지 않는다 — 데이터 값을 문구로 넣는 실수 차단
 *   6) `eval` 스텝에 `why`가 있다
 *
 * 실행: node scripts/gates/check-paper-routes.mjs
 * 성공 표지: paper routes freshness verification passed
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 훅(저장소 뿌리)과 app/ 양쪽에서 불려도 같은 파일을 읽게 스크립트 위치에서 뿌리를 잡는다.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');

const { loadManifest, LEDGER_DIR } = await import(
  pathToFileURL(path.join(APP, 'scripts', 'paper-manifest-check.mjs')).href);
const { excludeReason, loadValueSlotTexts } = await import(
  pathToFileURL(path.join(APP, 'scripts', 'paper-phrases.mjs')).href);

/** 마크업이 직접 적은 DOM id. 규칙 1의 대조 원본이다. */
export function markupIds(htmlSources) {
  const ids = new Set();
  for (const html of htmlSources) {
    for (const match of html.matchAll(/id="([^"]+)"/g)) ids.add(match[1]);
  }
  return ids;
}

/**
 * 실재하는 IPC 채널. preload.js 허용 Set과 main.js 등록·발신을 한 집합으로 본다
 * (check-harness-freshness.mjs 규칙 2와 같은 오라클).
 */
export function knownChannels(sources) {
  const channels = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/['"`](athena:[a-z0-9-]+)['"`]/g)) channels.add(match[1]);
  }
  return channels;
}

/** 셀렉터 문자열에서 `#id` 리터럴만 뽑는다. */
function idLiterals(selector) {
  return [...String(selector ?? '').matchAll(/#([A-Za-z][\w-]*)/g)].map((match) => match[1]);
}

/**
 * 라우트표를 대조 원본과 맞댄다. 파일을 읽지 않는 순수 함수라 단위 테스트가
 * 일부러 틀린 표를 먹여 각 규칙이 실제로 잡는지 잰다.
 *
 * @param {object} input
 * @param {Array<object>} input.routes
 * @param {Set<string>} input.ids            규칙 1 — 마크업 DOM id
 * @param {Set<string>} input.channels       규칙 2 — 실재 IPC 채널
 * @param {Map<string, string>} input.screenBoards  규칙 3 — role=="screen" 보드 → 페이지
 * @param {(boardId: string) => Set<string>} input.ledgerTexts 규칙 4 — 보드 원장 텍스트
 * @param {Set<string>} [input.valueTexts]   규칙 5 — E6용 카드 값 슬롯 텍스트
 * @returns {string[]} 실패 줄. 비면 통과다.
 */
export function checkPaperRoutes(input) {
  const { routes, ids, channels, screenBoards, ledgerTexts, valueTexts } = input;
  const failures = [];
  const seen = new Set();

  for (const route of routes) {
    const where = `route ${route.board}`;

    // 3) 보드 id — 매니페스트가 화면이라고 부르는 것만, 한 번씩만
    if (!screenBoards.has(route.board)) {
      failures.push(`${where}: 매니페스트 role=="screen"에 없는 보드다`);
    } else if (seen.has(route.board)) {
      failures.push(`${where}: 라우트가 두 번 있다`);
    }
    seen.add(route.board);

    // 1) DOM id 리터럴
    const selectors = [route.root, ...route.reach.map((step) => step.selector),
      ...route.structure.map((check) => check.selector)];
    for (const selector of selectors.filter(Boolean)) {
      for (const id of idLiterals(selector)) {
        if (!ids.has(id)) failures.push(`${where}: 마크업에 없는 DOM id '#${id}' — ${selector}`);
      }
    }

    // 2) IPC 채널 · 6) eval의 why
    for (const step of route.reach) {
      if (step.channel && !channels.has(step.channel)) {
        failures.push(`${where}: 미등록 IPC 채널 '${step.channel}'`);
      }
      if (step.do === 'eval' && !String(step.why ?? '').trim()) {
        failures.push(`${where}: eval 스텝에 why가 없다 — 탈출구는 사유를 적어야 쓴다`);
      }
    }

    // 4)·5) 대표 문구 — 원장에 실재하고, 데이터 값이 아니다
    if (screenBoards.has(route.board)) {
      const texts = ledgerTexts(route.board);
      for (const phrase of route.phrases) {
        if (!texts.has(phrase)) {
          failures.push(`${where}: 원장에 없는 문구 ${JSON.stringify(phrase)}`);
        }
        const reason = excludeReason(phrase, valueTexts);
        if (reason && reason.hard) {
          failures.push(`${where}: ${reason.code}에 걸린 데이터 값을 문구로 썼다 ${JSON.stringify(phrase)}`);
        }
      }
    }
  }
  return failures;
}

function read(relative) {
  const file = path.join(ROOT, relative);
  if (!existsSync(file)) throw new Error(`대조 원본이 없다: ${relative}`);
  return readFileSync(file, 'utf8');
}

export function runGate() {
  const { ROUTES } = createRequire(import.meta.url)(path.join(APP, 'lib', 'paper-screen-routes.js'));
  const manifest = loadManifest();
  const screenBoards = new Map(manifest.boards
    .filter((board) => board.role === 'screen')
    .map((board) => [board.id, board.page]));
  const ledgerCache = new Map();
  const ledgerTexts = (boardId) => {
    if (!ledgerCache.has(boardId)) {
      const file = path.join(LEDGER_DIR, screenBoards.get(boardId), `${boardId}.json`);
      const board = JSON.parse(readFileSync(file, 'utf8'));
      ledgerCache.set(boardId, new Set(board.texts.map((node) => String(node.text).trim())));
    }
    return ledgerCache.get(boardId);
  };

  const failures = checkPaperRoutes({
    routes: ROUTES,
    ids: markupIds([read('app/shell.html'), read('app/orb.html')]),
    channels: knownChannels([read('app/preload.js'), read('app/main.js')]),
    screenBoards,
    ledgerTexts,
    valueTexts: loadValueSlotTexts(),
  });
  return { routes: ROUTES.length, screens: screenBoards.size, failures };
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const { routes, screens, failures } = runGate();
  if (failures.length) {
    console.error(`[paper-routes] 실패 ${failures.length}건:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`라우트 ${routes}장 대조 통과 · 화면계 ${screens}장 중 ${screens - routes}장은 아직 라우트가 없다`);
  console.log('paper routes freshness verification passed');
}
