'use strict';

// 화면계 전수 게이트 — `verify:paper-screens` (설계서 §4).
//
// 매니페스트가 화면이라 부른 보드 103장 + 계약 보드 12장을 한 번에 판정한다.
//
//   화면 보드  라우트표(app/lib/paper-screen-routes.js)대로 실앱을 조작해 도달한 뒤,
//              그 보드의 대표 문구가 **눈에 보이는 자리에** 있고 구조 셈이 맞는지 잰다.
//              라우트가 없는 보드는 `route_missing` 실패다 — skip이 아니다. 「도달 절차가
//              없는 보드는 미구현으로 실패한다」가 이 게이트의 핵심이고(설계서 §9),
//              그래서 리포트가 곧 남은 작업 목록이 된다.
//   계약 보드  화면이 아니라 계약 문서라 DOM 대조가 불가능하다. 원장에서 계약 문장을
//              뽑아 docs/ui·docs/architecture에 실재하는지 문자열로 잰다(§4.6).
//
// 판정·래칫·리포트 조립은 lib/paper-screens-report.js가 한다(electron 없이 단위
// 테스트가 붙는 자리). 이 파일은 창을 몰고 DOM을 재는 일만 한다.
//
// ── 왜 라우트마다 창을 다시 읽는가
// 앞 라우트가 남긴 화면 상태(열린 설정 오버레이·드릴인·모드)가 다음 라우트의 가시
// 판정을 오염시킨다. 되돌리는 절차를 라우트마다 저작하게 하면 빠뜨리기 쉬우니
// 러너가 매번 렌더러를 새로 읽어 같은 출발선을 만든다(§4.1 「격리는 러너 몫」).
//
// ── ipc-fixture 는 원 핸들러를 스냅샷하고 되돌린다
// main.js가 등록하는 순간을 가로채 원 핸들러를 적어 두고(recordIpcHandlers), 라우트가
// 끝나면 정확히 그것으로 되돌린다. 안 되돌리면 갈아끼운 채널이 다음 라우트로 샌다 —
// `athena:account-list`는 설정 화면만이 아니라 사이드바 배지·온보딩도 읽는다.
//
// ── 재는 것은 가시 텍스트뿐이다
// `checkVisibility()`로 hidden 서브트리·display:none·visibility:hidden을 뺀다.
// textContent로 재면 에이전트 캔버스처럼 뷰 넷을 다 만들어 두고 hidden만 토글하는
// 화면에서 도달 절차가 판정에 아무 영향을 못 준다 — 라우트표 머리 주석이 적은 그 이유다.
//
// 쓰는 법
//   npm run verify:paper-screens                    전수
//   npm run verify:paper-screens -- --only 1KK-0    한 보드
//   npm run verify:paper-screens -- --bless         통과 집합을 래칫에 잠근다
//   npm run verify:paper-screens -- --bless --allow-shrink --why "<사유>"
//
// 성공 표지: paper screens verification passed

process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { ROUTES } = require('./lib/paper-screen-routes.js');
const { MODES } = require('./lib/live-full-catalog.js');
const {
  blessRatchet,
  contractRecord,
  contractSentences,
  formatScreensCliReport,
  judgeRatchet,
  routeFailures,
  routeMissingRecord,
} = require('./lib/paper-screens-report.js');

const APP = __dirname;
const ROOT = path.resolve(APP, '..');
const LEDGER_DIR = path.join(ROOT, 'backend', 'ref', 'paper-ledger');
const RATCHET_PATH = path.join(APP, 'lib', 'paper-screens-ratchet.json');
const REPORT_PATH = path.join(APP, 'captures', 'paper-gates', 'PAPER-SCREENS.json');
const DOC_PATHS = [path.join(ROOT, 'docs', 'ui', 'paper-card-surface-charter.md')];
for (const name of fs.readdirSync(path.join(ROOT, 'docs', 'architecture'))) {
  if (name.endsWith('.md')) DOC_PATHS.push(path.join(ROOT, 'docs', 'architecture', name));
}

// 검증 전용 프로필 — 이 머신의 개인 상태(계좌·온보딩·비밀값)에 기대지 않는다.
const PROFILE = path.join(APP, '.probe-paper-screens-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- CLI ----------

/** 인자 오타를 게이트 실패와 안 헷갈리게 exit 2로 가른다(run-verify-suite.js의 선례). */
class UsageError extends Error {}

function parseArgs(argv) {
  const args = { only: null, bless: false, allowShrink: false, why: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--only') args.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--bless') args.bless = true;
    else if (arg === '--allow-shrink') args.allowShrink = true;
    else if (arg === '--why') args.why = String(argv[++i] || '');
    else if (arg.startsWith('--')) throw new UsageError(`모르는 인자 ${arg}`);
  }
  // 부분 실행으로 잠금을 갱신하면 안 돈 보드가 통째로 빠진다. 애초에 거절한다.
  if (args.bless && args.only) throw new UsageError('--bless 는 전수 실행에서만 쓴다 (--only 와 같이 못 쓴다)');
  return args;
}

// ---------- IPC 픽스처 격리 ----------

const ORIGINAL_HANDLERS = new Map();
function recordIpcHandlers() {
  const original = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => {
    ORIGINAL_HANDLERS.set(channel, listener);
    return original(channel, listener);
  };
  return original;
}
const rawHandle = recordIpcHandlers();

function applyFixture(channel, data) {
  ipcMain.removeHandler(channel);
  rawHandle(channel, async () => data);
}

function restoreFixture(channel) {
  ipcMain.removeHandler(channel);
  const original = ORIGINAL_HANDLERS.get(channel);
  if (original) rawHandle(channel, original);
}

// ---------- 렌더러 조작 ----------

const WINDOW_READY = Object.freeze({
  // 셸은 부팅 창이 물러나고 #app이 드러나면 준비된 것이다(probe-agent-paper-parity.js와 같은 신호).
  shell: "document.getElementById('app') && !document.getElementById('app').hidden",
  orb: "!!document.getElementById('orbRoot')",
  // 부팅 창은 부팅 스크립트가 돌기 시작한 것이 준비다. 셸처럼 #app이 드러나기를
  // 기다리면 그때는 이미 부팅이 끝나 잴 것이 없다 — 단계는 boot-hold가 세운다.
  boot: "!!document.getElementById('boot') && !!document.getElementById('boot').dataset.startedAt",
});

async function waitReady(win, kind) {
  for (let i = 0; i < 150; i += 1) {
    const ready = await win.webContents.executeJavaScript(`(() => ${WINDOW_READY[kind]})()`);
    if (ready) return;
    await wait(100);
  }
  throw new Error(`${kind} 창이 15초 안에 준비되지 않았다`);
}

const settle = (win) => win.webContents.executeJavaScript(
  'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');

// 누를 것이 아직 없는 것과 영영 없는 것은 다르다. 설정 오버레이·에이전트 드릴인은
// IPC 왕복 뒤에 그려지므로 한 번 훑고 없다고 단정하면 라우트가 시계에 좌우된다
// (실측: OJ-0이 같은 코드로 통과와 실패를 오갔다). 2초까지 기다렸는데도 없으면
// 그때는 도달 절차가 깨진 것이다 — verify.js가 쓰는 폴링과 같은 관례.
async function actWhenPresent(win, selector, action, missing, timeoutMs = 2000) {
  const literal = JSON.stringify(selector);
  for (let waited = 0; waited <= timeoutMs; waited += 100) {
    const acted = await win.webContents.executeJavaScript(`(() => {
      const el = document.querySelector(${literal});
      if (!el) return false;
      ${action}
      return true;
    })()`);
    if (acted) return;
    await wait(100);
  }
  throw new Error(`${missing}: ${selector}`);
}

const clickWhenPresent = (win, selector) => actWhenPresent(win, selector, 'el.click();', '누를 것이 없다');

// hover는 진짜 포인터가 없다 — 앱이 듣는 두 이벤트를 그대로 쏜다. mouseenter는 버블하지
// 않으므로 요소 자신에게 보내야 한다(sidebar.js가 행에 직접 건 리스너가 그것이다).
const hoverWhenPresent = (win, selector) => actWhenPresent(
  win,
  selector,
  "el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));"
  + "el.dispatchEvent(new MouseEvent('mouseenter'));",
  '포인터를 올릴 것이 없다',
);

async function runStep(win, step) {
  switch (step.do) {
    case 'click':
      await clickWhenPresent(win, step.selector);
      return;
    case 'hover':
      await hoverWhenPresent(win, step.selector);
      return;
    case 'mode': {
      const mode = MODES.find((entry) => entry.view === step.view);
      if (!mode) throw new Error(`모드 ${step.view}가 없다`);
      const clicked = await win.webContents.executeJavaScript(`(() => {
        const el = document.getElementById(${JSON.stringify(mode.navId)});
        if (!el) return false;
        el.click();
        return true;
      })()`);
      if (!clicked) throw new Error(`모드 네비 #${mode.navId}가 없다`);
      return;
    }
    case 'command-bar': {
      // verify.js:111-119 openSettingsViaCommandBar 와 같은 자극.
      const sent = await win.webContents.executeJavaScript(`(() => {
        const el = document.getElementById('input');
        if (!el) return false;
        el.value = ${JSON.stringify(step.text)};
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return true;
      })()`);
      if (!sent) throw new Error('커맨드바 #input이 없다');
      return;
    }
    case 'boot-hold': {
      // 부팅 창을 `?bootHoldChars=N`으로 다시 읽어 그 단계에 세운다(chat.js의
      // 같은 이름 블록). 러너의 재읽기만으로는 다섯 단계가 전부 마지막 프레임으로
      // 수렴한다 — 부팅은 시간축이라 도달한 뒤에 되돌아갈 클릭이 없다.
      const url = new URL(win.webContents.getURL());
      url.searchParams.set('bootHoldChars', String(step.chars));
      await win.loadURL(url.href);
      return;
    }
    case 'ipc-fixture':
      applyFixture(step.channel, step.data);
      return;
    case 'envelope':
      // verify.js:2882 liveEnvelope 와 같은 봉투.
      win.webContents.send('athena:add-canvas-live', {
        status: 'success',
        envelope: { fell_back: false, fallback_reason: null, layout: null, drop_types: [], ...step.data },
      });
      return;
    case 'send':
      // main이 밀어 주는 이벤트를 그대로 쏜다 — 능동 턴(athena:routine-event)처럼
      // 이벤트로만 그려지는 화면은 클릭으로 도달할 길이 없다. 되돌릴 것은 없다:
      // 라우트마다 창을 다시 읽으므로 남긴 DOM이 다음 라우트로 새지 않는다.
      win.webContents.send(step.channel, step.data);
      return;
    case 'wait':
      await wait(step.ms);
      return;
    case 'settle':
      await settle(win);
      return;
    case 'eval':
      await win.webContents.executeJavaScript(step.js);
      return;
    default:
      throw new Error(`어휘 밖 스텝 ${step.do}`);
  }
}

/**
 * root 아래의 **가시** 텍스트와 구조 셈을 한 번에 잰다.
 * 텍스트 노드마다 부모의 `checkVisibility()`를 물어 hidden 서브트리를 뺀다 —
 * innerText 는 root 자체가 안 그려질 때 textContent 로 되돌아가 공허 통과를 만든다.
 */
function measureScript(route) {
  return `(() => {
    const root = document.querySelector(${JSON.stringify(route.root)});
    if (!root) return { root_found: false, root_visible: false, visible_text: '', structure: [] };
    const visible = (el) => !!el && el.checkVisibility({ checkVisibilityCSS: true });
    if (!visible(root)) return { root_found: true, root_visible: false, visible_text: '', structure: [] };
    const parts = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue.trim();
      if (!text || !visible(node.parentElement)) continue;
      parts.push(text);
    }
    const structure = ${JSON.stringify(route.structure)}.map((check, index) => {
      const found = Array.from(root.querySelectorAll(check.selector)).filter(visible);
      return {
        index,
        actual: check.what === 'order' ? found.map((el) => el.textContent.trim()) : found.length,
      };
    });
    return { root_found: true, root_visible: true, visible_text: parts.join('\\n'), structure };
  })()`;
}

async function probeRoute(wins, route) {
  const win = wins[route.window];
  const fixtured = new Set();
  try {
    if (!win) throw new Error(`${route.window} 창이 없다`);
    win.webContents.reload();
    await waitReady(win, route.window);
    await settle(win);
    for (const [index, step] of route.reach.entries()) {
      if (step.do === 'ipc-fixture') fixtured.add(step.channel);
      try {
        await runStep(win, step);
      } catch (error) {
        return { reach_error: { step: index + 1, verb: step.do, message: String(error.message || error) } };
      }
    }
    // 도달 뒤 화면은 IPC 왕복만큼 늦게 채워진다(설정 패널·에이전트 드릴인). 한 번만
    // 재고 단정하면 같은 코드가 통과와 실패를 오간다 — 실측으로 겪은 그것이다. 그래서
    // 통과할 때까지 2초까지 다시 잰다. 늘리지 않는다: 2초 안에 안 그려지는 화면은
    // 「도달 절차가 그 상태를 만들지 못한다」로 읽는 것이 맞다.
    let measured = null;
    for (let waited = 0; waited <= 2000; waited += 100) {
      measured = { reach_error: null, ...await win.webContents.executeJavaScript(measureScript(route)) };
      if (!routeFailures(route, measured).length) break;
      await wait(100);
    }
    return measured;
  } finally {
    for (const channel of fixtured) restoreFixture(channel);
  }
}

// ---------- 실행 ----------

function readLedger(page, boardId) {
  return JSON.parse(fs.readFileSync(path.join(LEDGER_DIR, page, `${boardId}.json`), 'utf8'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  // 전제가 깨진 채 도는 전수 실행은 아무 말도 못 한다(설계서 §4.5 판정표).
  // 매니페스트 불변식과 라우트표 신선도를 먼저 정적으로 확인한다.
  const { checkPaperManifest } = await import(
    pathToFileURL(path.join(APP, 'scripts', 'paper-manifest-check.mjs')).href);
  const routesGate = await import(
    pathToFileURL(path.join(ROOT, 'scripts', 'gates', 'check-paper-routes.mjs')).href);
  const { excludeReason } = await import(
    pathToFileURL(path.join(APP, 'scripts', 'paper-phrases.mjs')).href);

  const manifestResult = checkPaperManifest();
  const routesResult = routesGate.runGate();
  const blockers = [
    ...manifestResult.failures.map((failure) => `manifest: ${failure}`),
    ...routesResult.failures.map((failure) => `routes: ${failure}`),
  ];
  if (blockers.length) {
    console.error(`[paper-screens] 전제 실패 ${blockers.length}건 — 전수 판정을 시작하지 않는다:`);
    for (const blocker of blockers) console.error(`  - ${blocker}`);
    app.exit(1);
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(LEDGER_DIR, 'manifest.json'), 'utf8'));
  const screens = manifest.boards.filter((board) => board.role === 'screen');
  const contracts = manifest.boards.filter((board) => board.role === 'contract');
  const universe = screens.length + contracts.length;

  const ratchet = JSON.parse(fs.readFileSync(RATCHET_PATH, 'utf8'));
  if (ratchet.target_boards !== universe) {
    console.error(`[paper-screens] 래칫의 target_boards ${ratchet.target_boards} != 원장 ${universe}장 — 전제가 깨졌다`);
    app.exit(1);
    return;
  }

  const wanted = args.only ? new Set(args.only) : null;
  const selectedScreens = screens.filter((board) => !wanted || wanted.has(board.id));
  const selectedContracts = contracts.filter((board) => !wanted || wanted.has(board.id));
  if (wanted) {
    const known = new Set([...screens, ...contracts].map((board) => board.id));
    const unknown = args.only.filter((id) => !known.has(id));
    if (unknown.length) throw new UsageError(`--only: 화면·계약 보드가 아니다 — ${unknown.join(', ')}`);
  }

  const routeOf = new Map(ROUTES.map((route) => [route.board, route]));
  const boards = [];

  // ---------- 계약 12장 — 창이 필요 없다 ----------
  const docs = DOC_PATHS.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const isHardExcluded = (text) => {
    const reason = excludeReason(text);
    return !!(reason && reason.hard);
  };
  for (const board of selectedContracts) {
    const ledger = readLedger(board.page, board.id);
    boards.push(contractRecord(board, contractSentences(ledger.texts, isHardExcluded), docs));
  }

  // ---------- 화면 — 라우트가 있는 것만 창을 몬다 ----------
  const routed = selectedScreens.filter((board) => routeOf.has(board.id));
  for (const board of selectedScreens.filter((entry) => !routeOf.has(entry.id))) {
    boards.push(routeMissingRecord(board));
  }

  let wins = { boot: null, shell: null, orb: null };
  if (routed.length) {
    await app.whenReady();
    const mainMod = require('./main.js');
    await mainMod.createWindows();
    // bootWin은 부팅 단계 보드가 사는 창이다 — 부팅이 끝나야 셸로 넘어가므로
    // (main.js attemptShellHandoff) 부팅이 서 있는 동안에만 살아 있다.
    const { bootWin, shellWin, orbWin } = mainMod.getWins();
    wins = { boot: bootWin, shell: shellWin, orb: orbWin };
    await waitReady(shellWin, 'shell');
  }

  for (const board of routed) {
    const route = routeOf.get(board.id);
    const measured = await probeRoute(wins, route);
    const failures = routeFailures(route, measured);
    const record = {
      board_id: board.id,
      page: board.page,
      name: board.name,
      role: 'screen',
      status: failures.length ? 'fail' : 'pass',
      failures,
    };
    if (!failures.length) {
      record.measured = {
        phrases: route.phrases.length,
        structure: route.structure.length,
        visible_text_length: measured.visible_text.length,
      };
    }
    console.log(`  ${record.status === 'pass' ? 'ok  ' : 'FAIL'} ${board.id} · ${board.name}`);
    boards.push(record);
  }

  // ---------- 판정 ----------
  const order = new Map([...screens, ...contracts].map((board, index) => [board.id, index]));
  boards.sort((a, b) => order.get(a.board_id) - order.get(b.board_id));
  const failed = boards.filter((board) => board.status === 'fail');
  const contractBoards = boards.filter((board) => board.role === 'contract');
  const selection = { canonical: !args.only, boards: boards.length };
  const verdict = judgeRatchet(ratchet, boards, selection);

  const runtime = {
    schema_version: 1,
    gate: 'verify:paper-screens',
    generated_at: new Date().toISOString(),
    selection,
    elapsed_ms: Date.now() - startedAt,
    totals: {
      boards: boards.length,
      pass: boards.length - failed.length,
      fail: failed.length,
      route_missing: boards.filter((board) => board.failures.some((f) => f.code === 'route_missing')).length,
      contract: contractBoards.length,
      contract_fail: contractBoards.filter((board) => board.status === 'fail').length,
    },
    ratchet: {
      file: path.relative(ROOT, RATCHET_PATH).replace(/\\/g, '/'),
      passing_count: ratchet.passing.length,
      regressions: verdict.regressions,
      newly_passing: verdict.newly_passing,
      missing: verdict.missing,
    },
    boards,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(runtime, null, 2)}\n`);

  if (args.bless) {
    const result = blessRatchet(ratchet, boards, {
      allowShrink: args.allowShrink,
      why: args.why,
      targetBoards: universe,
    });
    if (result.error) {
      console.error(`[ratchet] ${result.error}`);
      app.exit(1);
      return;
    }
    fs.writeFileSync(RATCHET_PATH, `${JSON.stringify(result.next, null, 2)}\n`);
    console.log(`[ratchet] 잠금 ${result.next.passing_count}장`
      + `${result.added.length ? ` · 추가 ${result.added.join(', ')}` : ''}`
      + `${result.removed.length ? ` · 제거 ${result.removed.join(', ')}` : ''}`);
    app.exit(0);
    return;
  }

  const { exitCode, lines } = formatScreensCliReport(
    runtime,
    verdict,
    path.relative(ROOT, REPORT_PATH).replace(/\\/g, '/'),
  );
  for (const line of lines) (exitCode ? console.error : console.log)(line);
  app.exit(exitCode);
}

main().catch((error) => {
  if (error instanceof UsageError) {
    console.error(`[paper-screens] ${error.message}`);
    app.exit(2);
    return;
  }
  console.error(error);
  app.exit(1);
});
