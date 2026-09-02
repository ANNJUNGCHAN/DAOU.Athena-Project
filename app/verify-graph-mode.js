'use strict';

/**
 * 그래프 모드 전수 검증 — 실제 Electron 셸 + 실제 백엔드 + 실제 성향 그래프.
 *
 * 단위 테스트(1,900여 건)는 "이 함수가 이 값을 돌려준다"까지 증명한다. 이 하네스가
 * 증명하는 것은 그다음이다: **진짜 백엔드가 준 진짜 그래프를 프로덕션 셸이 그리고,
 * 클릭·드래그·필터·채팅이 실제로 화면을 바꾼다.** 그래서 순수 함수는 여기서 다시
 * 재지 않는다 — 통합에서만 드러나는 것만 잰다.
 *
 * 격리 규칙은 `probe-conversation-graph-e2e.js`와 같다: 임시 userData, 임시 브레인
 * SQLite, 동적 루프백 포트, 실행마다 새 베어러. 그래프는
 * `backend/scripts/seed_long_term_etf_persona.py`가 결정적으로 씨앗한다(장기·ETF·
 * 중대형주 페르소나) — 그래야 "기능이 안 보인다"와 "그릴 게 없다"가 구분된다.
 *
 * 실행: cd app && npx electron verify-graph-mode.js
 * 산출: artifacts/graph-mode/verify-graph-mode.json + 단계별 스크린샷
 */

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const APP_DIR = __dirname;
const REPO_DIR = path.resolve(APP_DIR, '..');
const BACKEND_DIR = path.join(REPO_DIR, 'backend');
const PYTHON_EXE = path.join(BACKEND_DIR, '.venv', 'Scripts', 'python.exe');
const SEED_SCRIPT = path.join(BACKEND_DIR, 'scripts', 'seed_long_term_etf_persona.py');
const ARTIFACT_DIR = path.join(REPO_DIR, 'artifacts', 'graph-mode');
const BACKEND_READY_TIMEOUT_MS = 60_000;
const RENDER_TIMEOUT_MS = 20_000;

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
app.disableHardwareAcceleration();

const steps = [];
const failures = [];
let currentSection = '(시작 전)';

function section(name) {
  currentSection = name;
  steps.push({ section: name, name: `── ${name} ──`, ok: true, detail: null });
}

function check(name, condition, detail) {
  const ok = Boolean(condition);
  const row = { section: currentSection, name, ok, detail: detail === undefined ? null : detail };
  steps.push(row);
  if (!ok) failures.push(row);
  return ok;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForBackendReady(url, token) {
  const started = Date.now();
  let lastError = 'no attempt';
  while (Date.now() - started < BACKEND_READY_TIMEOUT_MS) {
    try {
      const res = await fetch(`${url}/api/v1/brain/status`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const body = await res.json();
        if (body.ready) return body;
        lastError = `not ready: ${JSON.stringify(body)}`;
      } else lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = String((error && error.message) || error);
    }
    await wait(400);
  }
  throw new Error(`backend never became ready: ${lastError}`);
}

/** 렌더러에서 조건이 참이 될 때까지 폴링한다. `expression`은 {ok, ...}를 돌려준다. */
async function waitForRenderer(wc, expression, label, timeoutMs = RENDER_TIMEOUT_MS) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await wc.executeJavaScript(wrapForDiagnosis(expression, false));
    if (last && last.ok) return last;
    // 페이지가 던졌으면 더 기다릴 이유가 없다 — 같은 예외가 반복될 뿐이다.
    if (last && last.__error) throw new Error(`${label} — 페이지 예외: ${last.__error}`);
    await wait(200);
  }
  throw new Error(`${label} — 시간 초과. 마지막 상태: ${JSON.stringify(last)}`);
}

// 페이지에서 던진 예외를 **데이터로** 돌려받는다.
//
// 안 감싸면 executeJavaScript가 "Script failed to execute"만 던지고 하네스가 통째로
// 죽는다 — 어느 블록이 왜 터졌는지 알 수 없어 반복이 눈먼 작업이 된다(1회차 실측).
// 예외를 {ok:false, __error}로 바꿔 그 자리의 check가 스택을 그대로 남기게 한다.
function wrapForDiagnosis(expression, asyncBody) {
  const head = asyncBody ? 'async () =>' : '() =>';
  return `(${head} { try { ${expression} } catch (e) { `
    + 'return { ok: false, __error: String((e && e.stack) || e).slice(0, 600) }; } })()';
}

const evaluate = (wc, expression) => wc.executeJavaScript(wrapForDiagnosis(expression, false));
const evaluateAsync = (wc, expression) => wc.executeJavaScript(wrapForDiagnosis(expression, true));

/** 페이지 예외를 실패로 기록하고 계속 갈지 알려준다. */
function pageOk(name, result) {
  if (result && result.__error) {
    check(`${name} — 페이지 예외`, false, result.__error);
    return false;
  }
  return true;
}

/** 한 구역이 터져도 나머지를 계속 잰다 — 첫 실패에서 멈추면 한 바퀴에 하나만 고친다. */
async function runSection(name, fn) {
  section(name);
  try {
    await fn();
  } catch (error) {
    check(`${name} — 구역 중단`, false, String((error && error.message) || error).slice(0, 400));
  }
}

async function capture(wc, name) {
  // 한 프레임 더 기다린다 — DOM은 바뀌었지만 합성이 끝나기 전에 찍으면
  // 스크린샷만 이전 화면인 채로 남는다.
  await wait(350);
  const image = await wc.capturePage();
  const file = path.join(ARTIFACT_DIR, `${name}.png`);
  fs.writeFileSync(file, image.toPNG());
  steps.push({ section: currentSection, name: `capture:${name}`, ok: true, detail: file });
  return file;
}

async function main() {
  const port = await reserveLoopbackPort();
  const backendUrl = `http://127.0.0.1:${port}`;
  const bearerToken = crypto.randomBytes(32).toString('hex');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-verify-graph-'));
  const userDataDir = path.join(tempRoot, 'user-data');
  const brainDbPath = path.join(tempRoot, 'brain.sqlite3');
  const chatOutboxPath = path.join(tempRoot, 'chat-outbox.sqlite3');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'athena-onboarding.json'),
    JSON.stringify({ cliDone: true, accountDone: true }, null, 2),
    'utf8',
  );

  if (!fs.existsSync(PYTHON_EXE)) throw new Error(`backend venv이 없다: ${PYTHON_EXE}`);

  section('0. 기동');
  const seeded = spawnSync(PYTHON_EXE, [SEED_SCRIPT, '--db', brainDbPath], {
    cwd: BACKEND_DIR,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONPATH: BACKEND_DIR },
    encoding: 'utf8',
    windowsHide: true,
  });
  if (seeded.status !== 0) throw new Error(`페르소나 씨앗 실패: ${seeded.stderr || seeded.stdout}`);
  const seedStats = JSON.parse(seeded.stdout);
  check('페르소나 그래프가 충분히 크다', seedStats.entities >= 30 && seedStats.relations >= 60, seedStats);

  Object.assign(process.env, {
    ATHENA_NO_AUTOSTART: '1',
    ATHENA_CANVAS_SOURCE: 'live',
    ATHENA_BACKEND_URL: backendUrl,
    ATHENA_LOCAL_BEARER_TOKEN: bearerToken,
    ATHENA_BRAIN_ENABLED: 'true',
    ATHENA_BRAIN_DB_PATH: brainDbPath,
    ATHENA_BRAIN_HISTORY_DB_PATH: brainDbPath,
    ATHENA_CHAT_HISTORY_DB_PATH: chatOutboxPath,
    ATHENA_BRAIN_USE_CLAUDE_CLI_EXTRACTION: 'false',
    ATHENA_ROUTINES_ENABLED: 'false',
  });

  const backend = spawn(PYTHON_EXE, [
    '-m', 'uvicorn', 'athena_api.main:app',
    '--host', '127.0.0.1', '--port', String(port), '--workers', '1',
  ], {
    cwd: tempRoot,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONPATH: BACKEND_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const backendLog = [];
  backend.stdout.on('data', (c) => backendLog.push(String(c)));
  backend.stderr.on('data', (c) => backendLog.push(String(c)));

  try {
    const status = await waitForBackendReady(backendUrl, bearerToken);
    check('백엔드가 브레인 준비 상태로 뜬다', status.ready === true, status);

    // 모델 노출 게이트 — §9가 그래프 접두를 재려면 열려 있어야 한다. 앱의 시작 경로는
    // 추출기 준비를 먼저 요구하는데 이 하네스는 추출기를 끄고 띄우므로(그래프는 씨앗
    // 스크립트가 넣는다) 그 push가 안 돈다. 여기서 직접 켠다 — 씨앗 페르소나는
    // 실사용자 데이터가 아니다.
    const exposeRes = await fetch(`${backendUrl}/api/v1/settings/expose-to-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearerToken}` },
      body: JSON.stringify({ enabled: true }),
    });
    check('모델 노출 게이트를 켰다', exposeRes.ok, exposeRes.status);

    app.setPath('userData', userDataDir);
    await app.whenReady();
    const mainMod = require(path.join(APP_DIR, 'main.js'));
    await mainMod.createWindows();
    const { shellWin } = mainMod.getWins();
    if (!shellWin || shellWin.isDestroyed()) throw new Error('셸 창이 만들어지지 않았다');
    // 창을 실제로 띄운다 — 숨은 창의 capturePage()는 마지막으로 그려진(대개 빈)
    // 프레임을 돌려주므로, DOM 검사는 통과하는데 스크린샷만 옛 화면인 상태가 된다.
    // force는 부팅 handoff를 건너뛰는 검증 스크립트 전용 인자다.
    mainMod.revealShell({ focus: true, force: true });
    const wc = shellWin.webContents;

    // 렌더러 콘솔 오류를 전부 모은다(§11) — 화면이 그려져도 예외가 나면 실패다.
    const consoleErrors = [];
    wc.on('console-message', (_e, level, message) => {
      if (level >= 2) consoleErrors.push(String(message).slice(0, 300));
    });

    await evaluate(wc, `
      for (const id of ['boot', 'onboard', 'settings', 'order']) {
        const el = document.getElementById(id);
        if (el) el.hidden = true;
      }
      const app = document.getElementById('app');
      if (app) app.hidden = false;
      const shell = document.getElementById('shell');
      if (shell) shell.hidden = false;
      return { ok: true };
    `);

    // 구역 하나가 터져도 나머지를 계속 잰다 — 첫 실패에서 멈추면 한 바퀴에 결함
    // 하나만 고치게 되고, 반복 횟수가 결함 수만큼 늘어난다.
    try {
    // ── 1. 모드 진입 · 배타 가시성 ─────────────────────────────────────────
    section('1. 모드 진입 · 배타 가시성');
    const navVisible = await evaluate(wc, `
      const nav = document.getElementById('modeNavGraph');
      return { ok: true, exists: !!nav, hidden: nav ? nav.hidden : null };
    `);
    check('그래프 모드 진입로가 상시 보인다', navVisible.exists && navVisible.hidden === false, navVisible);

    await evaluate(wc, `document.getElementById('modeNavGraph').click(); return { ok: true };`);
    const summary = await waitForRenderer(wc, `
      const rows = [...document.querySelectorAll('#graphSummaryTableArea .summary-row')];
      const hero = document.querySelector('#graphSummaryHero .summary-hero');
      const q = (s) => document.querySelector(s);
      const t = (s) => (q(s) ? q(s).textContent : null);
      return {
        ok: rows.length > 0 && !!hero,
        rowCount: rows.length,
        rowsHaveId: rows.every((r) => !!r.getAttribute('data-entity-id')),
        rowsAreButtons: rows.every((r) => r.getAttribute('role') === 'button' && r.getAttribute('tabindex') === '0'),
        heroStats: [...document.querySelectorAll('.summary-hero-stat-value')].map((n) => n.textContent),
        heroLabel: t('.summary-hero-label'),
        heroScope: t('.summary-hero-scope'),
        totalText: t('.summary-table-total'),
        subtitle: t('.summary-table-subtitle'),
        ariaLabel: q('.summary-table') ? q('.summary-table').getAttribute('aria-label') : null,
        themes: document.querySelectorAll('#graphThemeClusters .theme-cluster-card').length,
        themeTitles: [...document.querySelectorAll('#graphThemeClusters .theme-cluster-name')].map((n) => n.textContent),
        estimatedPairs: [...document.querySelectorAll('#graphThemeClusters .theme-cluster-card')]
          .map((c) => [!!c.querySelector('.theme-cluster-name.is-estimated'), !!c.querySelector('.theme-cluster-unnamed-badge')]),
        warnCount: document.querySelectorAll('#graphThemeClusters .is-unnamed-warn, #graphThemeClusters .is-warn').length,
        hiddenRows: document.querySelectorAll('#graphHiddenLinks .hidden-link-row').length,
        hiddenScores: [...document.querySelectorAll('#graphHiddenLinks .hidden-link-score')].map((n) => n.textContent),
        bannerHidden: document.getElementById('graphConfirmBanner').hidden,
        bannerTitle: t('#graphConfirmBanner .confirm-banner-title'),
        chatHeadVisible: !document.getElementById('chatModeHead').hidden,
        chatHeadTitle: t('#chatModeHead .chat-mode-head-title'),
        surfaces: {
          mosaic: document.getElementById('mosaic').hidden,
          summaryTable: document.getElementById('graphSummaryTable').hidden,
          map: document.getElementById('graphCanvas').hidden,
          settings: document.getElementById('graphSettingsCanvas').hidden,
          agent: document.getElementById('agentCanvas').hidden,
          plugin: document.getElementById('pluginCanvas').hidden,
          backtest: document.getElementById('backtestCanvas').hidden,
        },
      };
    `, '요약 표면 첫 렌더');

    const visible = Object.entries(summary.surfaces).filter(([, h]) => h === false).map(([k]) => k);
    check('캔버스 표면이 정확히 하나만 보인다', visible.length === 1 && visible[0] === 'summaryTable', visible);
    check('그래프 모드 채팅 헤더가 뜬다', summary.chatHeadVisible === true, summary.chatHeadTitle);
    check('채팅 헤더 문구가 그래프 모드용이다', summary.chatHeadTitle === '그래프에게 묻기', summary.chatHeadTitle);

    // ── 2. 요약 표면 ───────────────────────────────────────────────────────
    section('2. 요약 표면');
    check('성향 신호 행이 그려진다', summary.rowCount > 0, summary.rowCount);
    check('모든 행에 data-entity-id가 있다', summary.rowsHaveId === true, summary.rowsHaveId);
    check('모든 행이 키보드로 닿는다(role=button · tabindex=0)', summary.rowsAreButtons === true, summary.rowsAreButtons);
    check('표 aria-label이 실제 행 수를 말한다',
      summary.ariaLabel === `성향 신호 ${summary.rowCount}건`, { aria: summary.ariaLabel, rows: summary.rowCount });
    check('부제 "상위 N"이 실제 행 수와 같다',
      summary.subtitle === `상위 ${summary.rowCount}`, { subtitle: summary.subtitle, rows: summary.rowCount });
    check('"전체 N개"가 상위보다 큰 실값이다',
      /^전체 \d+개$/.test(summary.totalText || '')
        && Number(String(summary.totalText).replace(/\D/g, '')) > summary.rowCount,
      summary.totalText);
    check('히어로 라벨이 Paper 문구다', summary.heroLabel === '지금 읽히는 성향', summary.heroLabel);
    check('히어로가 사실/추론/불확실 3종 %를 보여준다', summary.heroStats.length === 3, summary.heroStats);
    // 상위 5가 전부 대화발 추론이어도 사실 %가 0이면 안 된다 — 창 전체 분포여야 한다.
    check('히어로 %가 상위 N 표본이 아니라 창 전체를 말한다',
      summary.heroStats.some((v) => v !== '0%' && v !== '100%'), summary.heroStats);
    check('히어로 부제가 군집 수·신호 수를 실값으로 쓴다',
      /테마 군집 \d+개 · 성향 신호 \d+개/.test(summary.heroScope || ''), summary.heroScope);
    check('테마 군집 카드가 보인다', summary.themes > 0, summary.themeTitles);
    check('추정 이름에는 "추정" 배지가 항상 함께 붙는다',
      summary.estimatedPairs.every((pair) => pair[0] === pair[1]), summary.estimatedPairs);
    check('전부 무명인 현재 데이터에서 무명 경고가 켜지지 않는다', summary.warnCount === 0, summary.warnCount);
    check('숨은 연관 행이 보인다', summary.hiddenRows > 0, summary.hiddenRows);
    check('숨은 연관 점수는 상대 표기다(절대 점수 금지)',
      summary.hiddenScores.every((t) => /^상대 \d+\.\d$/.test(t)), summary.hiddenScores);
    check('확인 필요 배너가 실개수로 뜬다',
      summary.bannerHidden === false && /^확인이 필요한 것 \d+건$/.test(summary.bannerTitle || ''),
      { hidden: summary.bannerHidden, title: summary.bannerTitle });
    await capture(wc, '01-summary');

    // ── 3. 필터 ────────────────────────────────────────────────────────────
    section('3. 필터');
    // 기간 칩이 **백엔드 창에 실제로 걸리는지**를 IPC 인자로 잡는다. 옛 결함:
    // canvas.js가 windowDays를 버려 "최근 30일"을 골라도 표가 기본 창을 봤다.
    // 페이지에서 window.athena.invoke를 감싸 스파이를 심으려 했지만 contextBridge로
    // 노출된 객체는 **동결**돼 있어 패치가 조용히 무시됐다(1회차 실측: calls []).
    // 백엔드 접근 로그가 유일하게 거짓말할 수 없는 자리다.
    const logMark = backendLog.length;
    const windowWiring = await evaluateAsync(wc, `
      const sel = document.getElementById('summaryWindowFilter');
      sel.value = '30';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 2800));
      const mapSel = document.getElementById('graphWindowFilter');
      return {
        ok: true,
        chipValue: sel.value,
        chipLabel: [...sel.options].find((o) => o.selected).textContent,
        mapChipValue: mapSel ? mapSel.value : null,
        narrowed: sel.classList.contains('is-narrowed'),
      };
    `);
    pageOk('기간 칩 조작', windowWiring);
    const sinceChange = backendLog.slice(logMark).join('');
    const profileCalls = [...sinceChange.matchAll(/profile-summary\?([^\s"]*)/g)].map((m) => m[1]);
    check('기간 칩이 값을 바꾼다',
      windowWiring.chipValue === '30' && windowWiring.chipLabel === '최근 30일', windowWiring.chipLabel);
    check('두 헤더의 기간 칩이 같은 값을 본다', windowWiring.mapChipValue === '30', windowWiring.mapChipValue);
    check('기본값이 아닌 필터가 시각적으로 표시된다', windowWiring.narrowed === true, windowWiring.narrowed);
    // 옛 결함: canvas.js가 windowDays를 버려 "최근 30일"을 골라도 표는 기본 창을 봤다.
    // 두 표면이 다른 창을 보는 상태였다(지도·전체 캐시는 제대로 넘기고 있었다).
    check('기간 칩이 백엔드 창에 실제로 걸린다(백엔드가 window_days=30을 받는다)',
      profileCalls.length > 0 && profileCalls.every((q) => q.includes('window_days=30')),
      profileCalls);

    const sortResult = await evaluateAsync(wc, `
      const win = document.getElementById('summaryWindowFilter');
      win.value = '365'; win.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 2200));
      const names = () => [...document.querySelectorAll('#graphSummaryTableArea .summary-row-name')].map((n) => n.textContent);
      const before = names();
      const sel = document.getElementById('summarySortFilter');
      sel.value = 'recent'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 2200));
      return { ok: true, label: [...sel.options].find((o) => o.selected).textContent, before, after: names() };
    `);
    check('정렬 칩이 "최근 순"으로 바뀐다', sortResult.label === '최근 순', sortResult.label);
    check('정렬을 바꾸면 표 순서가 실제로 달라진다',
      JSON.stringify(sortResult.before) !== JSON.stringify(sortResult.after),
      { before: sortResult.before.slice(0, 3), after: sortResult.after.slice(0, 3) });
    await evaluateAsync(wc, `
      const sel = document.getElementById('summarySortFilter');
      sel.value = 'reinforcement'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 1600));
      return { ok: true };
    `);
    await capture(wc, '02-filters');

    // ── 4. 행 선택 → 공통 패널 ─────────────────────────────────────────────
    section('4. 행 선택 → 공통 패널');
    const picked = await evaluate(wc, `
      const rows = [...document.querySelectorAll('#graphSummaryTableArea .summary-row')];
      const byId = new Map();
      for (const row of rows) {
        const id = row.getAttribute('data-entity-id');
        byId.set(id, (byId.get(id) || 0) + 1);
      }
      // 티어가 둘인 행(말과 행동이 어긋나는 신호)을 골라 대조 카드를 실제로 띄운다.
      const conflicted = rows.find((r) => byId.get(r.getAttribute('data-entity-id')) > 1);
      const target = conflicted || rows[0];
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { ok: true, entityId: target.getAttribute('data-entity-id'), conflicted: !!conflicted };
    `);
    const panel = await waitForRenderer(wc, `
      const p = document.getElementById('graphPanel');
      if (!p || p.hidden) return { ok: false, reason: 'panel hidden' };
      const t = (s) => (p.querySelector(s) ? p.querySelector(s).textContent : null);
      return {
        ok: true,
        name: t('.panel-name'),
        kindBadge: t('.panel-kind-badge'),
        sub: t('.panel-header-row2'),
        tabs: [...p.querySelectorAll('.panel-tab')].map((n) => n.textContent),
        activeTab: t('.panel-tab.is-active'),
        contrastTitle: t('.panel-tier-contrast-title'),
        divider: t('.panel-tier-divider'),
        tierLabels: [...p.querySelectorAll('.panel-tier-label')].map((n) => n.textContent),
        tierBodies: p.querySelectorAll('.panel-tier-body').length,
        ctaLead: t('.panel-cta-lead'),
        cta: t('.panel-cta'),
        rowHighlighted: !!document.querySelector('#graphSummaryTableArea .summary-row.is-selected'),
      };
    `, '공통 패널');
    check('행을 고르면 공통 패널이 열린다', !!panel.name, panel.name);
    check('선택한 행이 표에서 강조된다', panel.rowHighlighted === true, panel.rowHighlighted);
    check('패널 탭이 성향·이력 2종이고 성향이 활성이다',
      JSON.stringify(panel.tabs) === JSON.stringify(['성향', '이력']) && panel.activeTab === '성향',
      { tabs: panel.tabs, active: panel.activeTab });
    check('선택 헤더 부제가 보강 횟수를 말한다', /보강 \d+회/.test(panel.sub || ''), panel.sub);
    check('티어 카드가 근거 문장을 보여준다', panel.tierBodies > 0, panel.tierBodies);
    if (picked.conflicted) {
      check('두 출처가 다르면 대조 제목과 어긋남 구분자가 뜬다',
        panel.contrastTitle === '두 출처가 다르게 말합니다' && panel.divider === '↕ 어긋남',
        { contrastTitle: panel.contrastTitle, divider: panel.divider });
      check('티어 대조 카드가 체결·잔고와 대화 둘을 보여준다',
        panel.tierLabels.includes('체결·잔고') && panel.tierLabels.includes('대화'), panel.tierLabels);
      check('CTA 리드인이 아직 답하지 않았음을 알린다',
        panel.ctaLead === '어느 쪽이 실제에 가까운지 아직 답하지 않으셨습니다.', panel.ctaLead);
    } else {
      check('출처가 하나면 없는 갈등을 만들지 않는다',
        !panel.contrastTitle && !panel.divider, { contrastTitle: panel.contrastTitle, divider: panel.divider });
    }
    // 패널 CTA가 실제 질문을 심는다 — 옛 결함: 입력창 포커스만 줬다.
    const panelCta = await evaluate(wc, `
      const input = document.getElementById('input');
      input.value = '';
      document.querySelector('#graphPanel .panel-cta').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { ok: true, after: input.value };
    `);
    check('패널 CTA가 채팅에 실제 질문을 심는다', (panelCta.after || '').length > 0, panelCta.after);
    await capture(wc, '03-panel');

    const cleared = await evaluate(wc, `
      document.getElementById('input').value = '';
      document.querySelector('#graphPanel .panel-deselect').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { ok: true, panelHidden: document.getElementById('graphPanel').hidden,
               rowHighlighted: !!document.querySelector('#graphSummaryTableArea .summary-row.is-selected') };
    `);
    check('선택 해제가 패널과 행 강조를 함께 끈다',
      cleared.panelHidden === true && cleared.rowHighlighted === false, cleared);

    // ── 5. 라이브 군집 지도 ────────────────────────────────────────────────
    section('5. 라이브 군집 지도');
    await evaluate(wc, `document.getElementById('graphViewTab').click(); return { ok: true };`);
    const map = await waitForRenderer(wc, `
      const frame = document.querySelector('#graphBody .graph-live-map');
      const canvas = frame && frame.querySelector('canvas');
      if (!frame || !canvas) return { ok: false, hasFrame: !!frame, hasCanvas: !!canvas, hasVis: !!window.vis };
      const rect = frame.getBoundingClientRect();
      const cs = getComputedStyle(frame);
      return {
        ok: rect.width > 0 && rect.height > 0,
        frame: { w: Math.round(rect.width), h: Math.round(rect.height) },
        border: cs.borderTopWidth, overflow: cs.overflow,
        staticSvg: document.querySelectorAll('#graphBody svg.graph-canvas').length,
        headerMeta: document.getElementById('graphHeaderMeta').textContent,
        summaryHidden: document.getElementById('graphSummaryTable').hidden,
        settingsHidden: document.getElementById('graphSettingsCanvas').hidden,
      };
    `, '라이브 지도');
    check('네모 프레임이 실제 크기를 갖는다', map.frame.w > 0 && map.frame.h > 0, map.frame);
    check('프레임이 테두리와 클리핑을 갖는다(벽이 아니라 창틀)',
      map.border !== '0px' && map.overflow === 'hidden', { border: map.border, overflow: map.overflow });
    check('폐기한 정적 SVG 렌더러가 되살아나지 않았다', map.staticSvg === 0, map.staticSvg);
    check('헤더 메타가 군집·엔티티·미분류를 실값으로 쓴다',
      /^군집 \d+개 · 엔티티 \d+ · 미분류 \d+$/.test(map.headerMeta || ''), map.headerMeta);
    check('3중 배타 — 요약·수집노출은 숨는다', map.summaryHidden && map.settingsHidden, map);

    // 확대해도 프레임 크기가 안 변한다(Neo4j 계약).
    const zoom = await evaluateAsync(wc, `
      // 프레임 노드를 붙잡아 두지 않고 **매번 다시 물어본다**. 라이브 지도는 payload
      // 서명이 바뀌면 host를 destroy하고 새로 만들어서, 잡아둔 노드가 떨어져 나가면
      // getBoundingClientRect()가 0×0을 준다(2회차 실측: after {w:0,h:0}로 오진).
      const rect = () => {
        const f = document.querySelector('#graphBody .graph-live-map');
        if (!f) return null;
        const r = f.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      };
      const before = rect();
      const canvas = document.querySelector('#graphBody .graph-live-map canvas');
      if (!before || !canvas) return { ok: false, reason: '지도 프레임이 없다', before };
      const cr = canvas.getBoundingClientRect();
      for (let i = 0; i < 4; i++) {
        canvas.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true, cancelable: true,
          clientX: cr.left + cr.width / 2, clientY: cr.top + cr.height / 2,
          deltaY: -120, ctrlKey: true,
        }));
      }
      await new Promise((res) => setTimeout(res, 600));
      const after = rect();
      return {
        ok: true,
        stable: !!after && before.w === after.w && before.h === after.h,
        before, after,
      };
    `);
    pageOk('확대 조작', zoom);
    check('확대해도 프레임 크기가 안 변한다', zoom.stable === true, zoom);
    await capture(wc, '04-map');

    // 노드 선택 — 캔버스는 클릭 좌표가 물리로 흔들리므로 렌더러 무관 진입점으로 잰다.
    const nodeSelect = await evaluateAsync(wc, `
      const cm = await window.athena.invoke('athena:brain-cluster-map');
      const nodes = (cm && cm.nodes) || [];
      const hub = nodes.slice().sort((a, b) => b.degree - a.degree)[0];
      if (!hub) return { ok: false, reason: 'cluster-map에 노드가 없다' };
      window.AthenaCanvasMode.selectNode(hub.entity_id);
      await new Promise((r) => setTimeout(r, 700));
      const p = document.getElementById('graphPanel');
      const t = (s) => (p.querySelector(s) ? p.querySelector(s).textContent : null);
      return {
        ok: true,
        hubName: hub.name, hubDegree: hub.degree,
        panelHidden: p.hidden,
        panelName: t('.panel-name'),
        sub: t('.panel-header-row2'),
        relations: p.querySelectorAll('.panel-relation-row').length,
        staticSvg: document.querySelectorAll('#graphBody svg.graph-canvas').length,
        frameStill: !!document.querySelector('#graphBody .graph-live-map'),
      };
    `);
    check('지도 노드를 고르면 같은 공통 패널이 열린다',
      nodeSelect.panelHidden === false && nodeSelect.panelName === nodeSelect.hubName,
      { panel: nodeSelect.panelName, node: nodeSelect.hubName });
    check('노드 부제가 군집·연결 수를 말한다',
      /군집/.test(nodeSelect.sub || '') && /연결 \d+/.test(nodeSelect.sub || ''), nodeSelect.sub);
    check('노드 관계 목록이 그려진다', nodeSelect.relations > 0, nodeSelect.relations);
    // 회귀 가드 — 선택이 정적 렌더러를 되살려 지도를 옛 그림으로 덮어쓴 결함이 있었다.
    check('노드 선택이 정적 렌더러를 되살리지 않는다',
      nodeSelect.staticSvg === 0 && nodeSelect.frameStill === true, nodeSelect);
    await capture(wc, '05-map-node-selected');

    const degreeFilter = await evaluateAsync(wc, `
      const before = window.AthenaCanvasMode.getContext().counts;
      const sel = document.getElementById('graphDegreeFilter');
      sel.value = '3'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 2600));
      const after = window.AthenaCanvasMode.getContext().counts;
      const note = document.querySelector('#graphBody .graph-mode-unavailable');
      return {
        ok: true,
        label: [...sel.options].find((o) => o.selected).textContent,
        narrowed: sel.classList.contains('is-narrowed'),
        before, after,
        note: note ? note.textContent : null,
        panelHidden: document.getElementById('graphPanel').hidden,
      };
    `);
    check('최소 연결 수 칩 라벨이 "연결 N개 이상"이다', degreeFilter.label === '연결 3개 이상', degreeFilter.label);
    check('최소 연결 수 필터가 실제로 노드를 줄인다',
      degreeFilter.after.entities < degreeFilter.before.entities,
      { before: degreeFilter.before.entities, after: degreeFilter.after.entities });
    if (degreeFilter.after.entities === 0) {
      check('필터가 화면을 비우면 무엇이 걸렸는지 적는다',
        /완화해 보세요/.test(degreeFilter.note || ''), degreeFilter.note);
      check('사라진 노드의 패널은 함께 닫힌다', degreeFilter.panelHidden === true, degreeFilter.panelHidden);
    }
    await capture(wc, '06-degree-filter');
    await evaluateAsync(wc, `
      const sel = document.getElementById('graphDegreeFilter');
      sel.value = '0'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 2200));
      return { ok: true };
    `);

    // ── 6. 수집·노출 ───────────────────────────────────────────────────────
    section('6. 수집·노출');
    await evaluate(wc, `document.getElementById('graphHeaderSettingsTab').click(); return { ok: true };`);
    const settings = await waitForRenderer(wc, `
      const surface = document.getElementById('graphSettingsCanvas');
      const cards = [...document.querySelectorAll('#graphSettingsBody .graph-settings-card')];
      if (!surface || surface.hidden || cards.length === 0) return { ok: false, cards: cards.length };
      const t = (s) => (document.querySelector(s) ? document.querySelector(s).textContent : null);
      return {
        ok: true,
        cards: cards.length,
        toggles: document.querySelectorAll('#graphSettingsBody .graph-settings-toggle').length,
        sourceLabels: [...document.querySelectorAll('#graphSettingsBody .graph-settings-source-label')].map((n) => n.textContent),
        badge: t('#graphSettingsBody .graph-settings-badge'),
        asides: [...document.querySelectorAll('#graphSettingsBody .graph-settings-row-aside')].map((n) => n.textContent),
        envVar: t('#graphSettingsBody .graph-settings-envvar'),
        danger: !!document.querySelector('#graphSettingsBody .graph-settings-danger'),
        interval: !!document.querySelector('#graphSettingsBody .graph-settings-interval-select'),
        summaryHidden: document.getElementById('graphSummaryTable').hidden,
        mapHidden: document.getElementById('graphCanvas').hidden,
        panelHidden: document.getElementById('graphPanel').hidden,
      };
    `, '수집·노출');
    check('수집·노출 탭에 카드 두 장이 뜬다', settings.cards === 2, settings.cards);
    check('토글 네 개가 있다', settings.toggles === 4, settings.toggles);
    check('수집원 라벨이 Paper 그대로다',
      JSON.stringify(settings.sourceLabels) === JSON.stringify(['대화', '체결내역', '보유잔고']), settings.sourceLabels);
    check('보유잔고 조회 주기 선택기가 있다', settings.interval === true, settings.interval);
    check('브레인 상태 배지가 준비됨을 말한다', settings.badge === '브레인 준비됨', settings.badge);
    check('못 바꾸는 값이 정직하게 표시된다',
      JSON.stringify(settings.asides) === JSON.stringify(['설정 파일', '제공 안 함']), settings.asides);
    check('배치 주기 환경변수 이름이 노출된다',
      String(settings.envVar || '').includes('ATHENA_BRAIN_INGEST_INTERVAL_MINUTES'), settings.envVar);
    check('전체 삭제 버튼이 있다', settings.danger === true, settings.danger);
    check('3중 배타 — 요약·지도는 숨는다', settings.summaryHidden && settings.mapHidden, settings);
    check('수집·노출에서는 노드 패널을 접는다', settings.panelHidden === true, settings.panelHidden);

    const toggled = await evaluate(wc, `
      const key = 'athena.graphSettings.prefs';
      const read = () => JSON.parse(localStorage.getItem(key) || '{}');
      const toggles = [...document.querySelectorAll('#graphSettingsBody .graph-settings-toggle')];
      const before = read();
      toggles[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const after = read();
      toggles[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const restored = read();
      return { ok: true, before: before.collectFills, after: after.collectFills, restored: restored.collectFills };
    `);
    check('체결내역 토글이 실제로 저장되고 되돌아온다',
      toggled.after === false && toggled.restored === true, toggled);

    const confirmBar = await evaluate(wc, `
      document.querySelector('#graphSettingsBody .graph-settings-danger').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const bar = document.querySelector('#graphSettingsBody .graph-settings-confirm');
      const text = bar ? bar.querySelector('.graph-settings-confirm-text').textContent : null;
      if (bar) bar.querySelector('.graph-settings-confirm-cancel').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { ok: true, hadBar: !!bar, text, gone: !document.querySelector('#graphSettingsBody .graph-settings-confirm') };
    `);
    check('전체 삭제는 한 번 더 묻고 취소로 되돌아간다',
      confirmBar.hadBar === true && confirmBar.gone === true, confirmBar);
    check('삭제 확인 문구가 되돌릴 수 없음을 밝힌다',
      /되돌릴 수 없습니다/.test(confirmBar.text || ''), confirmBar.text);
    await capture(wc, '07-collection-settings');

    // ── 7. 되물을 것들 카드 ────────────────────────────────────────────────
    section('7. 되물을 것들 카드');
    await evaluate(wc, `document.getElementById('graphHeaderSummaryTab').click(); return { ok: true };`);
    await wait(1600);
    const bannerCount = Number(String(summary.bannerTitle || '').replace(/\D/g, ''));
    const card = await evaluateAsync(wc, `
      document.getElementById('input').value = '';
      const cta = document.querySelector('#graphConfirmBanner .confirm-banner-cta');
      if (!cta) return { ok: false, reason: '확인 필요 배너가 없다' };
      cta.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 1400));
      const host = document.getElementById('brainQuestionCard');
      if (!host || host.hidden) {
        return { ok: false, reason: '카드가 안 떴다', seeded: document.getElementById('input').value.slice(0, 40) };
      }
      const read = () => ({
        title: host.querySelector('.question-card-title').textContent,
        progress: host.querySelector('.question-card-progress').textContent,
        context: host.querySelector('.question-card-context').textContent,
        note: host.querySelector('.question-card-note').textContent,
        buttons: [...host.querySelectorAll('.question-card-btn')].map((b) => b.textContent),
        keys: [...host.querySelectorAll('.question-card-key')].map((k) => k.textContent),
      });
      const first = read();
      // Esc = 건너뛰기(레퍼런스 화면의 키 계약)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 350));
      const second = host.hidden ? null : read();
      let guard = 0;
      while (!host.hidden && guard++ < 12) {
        const skip = [...host.querySelectorAll('.question-card-btn')].find((b) => b.textContent.startsWith('건너뛰기'));
        if (!skip) break;
        skip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 220));
      }
      return { ok: true, first, second, closed: host.hidden, inputAfter: document.getElementById('input').value };
    `);
    if (card.ok) {
      check('배너 CTA가 되물을 것들 카드를 띄운다', true, card.first.progress);
      check('카드 진행 표시가 "i / n" 꼴이다', /^\d+ \/ \d+$/.test(card.first.progress), card.first.progress);
      check('카드 총 건수가 배너 건수와 일치한다',
        Number(card.first.progress.split(' / ')[1]) === bannerCount,
        { progress: card.first.progress, banner: summary.bannerTitle });
      check('선택지가 건너뛰기·아니다·맞다 3종이다',
        JSON.stringify(card.first.buttons) === JSON.stringify(['건너뛰기Esc', '아니다', '맞다Ctrl Enter']),
        card.first.buttons);
      check('단축키 힌트가 Esc·Ctrl Enter 둘이다',
        JSON.stringify(card.first.keys) === JSON.stringify(['Esc', 'Ctrl Enter']), card.first.keys);
      check('답의 행선지를 카드가 밝힌다',
        card.first.note === '답하면 채팅으로 보내지고, 그 답이 그래프를 갱신합니다.', card.first.note);
      check('원시 관계명·프로필 id가 화면에 새지 않는다',
        !/interested_in|relates_to|prefers|belongs_to|exposed_to|default →/.test(`${card.first.title}${card.first.context}`),
        { title: card.first.title, context: card.first.context });
      check('Esc가 다음 질문으로 넘긴다',
        !!(card.second && card.second.progress !== card.first.progress),
        { first: card.first.progress, second: card.second && card.second.progress });
      check('끝까지 답하면 카드가 닫힌다', card.closed === true, card.closed);
      check('전부 건너뛰면 아무것도 제출하지 않는다', card.inputAfter === '', card.inputAfter);
    } else {
      check('배너 CTA가 되물을 것들 카드를 띄운다', false, card);
    }
    await capture(wc, '08-question-card');

    // ── 8. 과거 대화 이동 ──────────────────────────────────────────────────
    section('8. 과거 대화 이동');
    const past = await evaluateAsync(wc, `
      const list = await window.athena.invoke('athena:conversations-list').catch(() => null);
      const convs = (list && Array.isArray(list.conversations)) ? list.conversations : [];
      if (!convs.length) return { ok: false, reason: '저장된 대화가 없다(이 하네스는 채팅 턴을 돌리지 않는다)' };
      const target = convs[0];
      const res = await window.athena.invoke('athena:conversation-messages', { conversationId: target.id })
        .catch((e) => ({ ok: false, error: String(e && e.message) }));
      const opened = await window.AthenaShell.openConversation({ id: target.id, title: target.title });
      await new Promise((r) => setTimeout(r, 600));
      const banner = document.querySelector('#history .past-banner');
      const out = {
        ok: true,
        channelOk: !!(res && res.ok),
        opened,
        bannerShown: !!banner,
        bannerNote: banner ? banner.querySelector('.past-banner-note').textContent : null,
        inputLocked: document.getElementById('input').disabled,
      };
      const back = banner && banner.querySelector('.past-banner-back');
      if (back) back.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 450));
      out.restored = !document.querySelector('#history .past-banner') && !document.getElementById('input').disabled;
      return out;
    `);
    if (past.ok) {
      check('과거 대화 메시지 조회 채널이 답한다', past.channelOk === true, past.channelOk);
      check('과거 대화를 열면 배너가 뜬다', past.bannerShown === true, past.bannerShown);
      check('배너가 읽기 전용임을 밝힌다', /읽기 전용/.test(past.bannerNote || ''), past.bannerNote);
      check('과거 대화에서는 입력이 잠긴다', past.inputLocked === true, past.inputLocked);
      check('[현재 대화로]가 원상 복구한다', past.restored === true, past.restored);
    } else {
      steps.push({ section: currentSection, name: '실 대화 목록으로는 못 잼', ok: true, detail: past.reason });
    }

    // 목록에 대화가 있든 없든 **렌더 경로 자체**는 항상 잰다. 합성 id로 열면 메시지가
    // 0건인데, 그건 실사용에서도 일어나는 경우다(이력 저장이 붙기 전에 만들어진 대화).
    // 그때 화면이 "없다"고 정직하게 말하는지가 이 구역의 핵심 계약이다.
    const synthetic = await evaluateAsync(wc, `
      const before = document.getElementById('history').childNodes.length;
      const opened = await window.AthenaShell.openConversation({
        id: 'verify-graph-mode-synthetic', title: '검증용 합성 대화',
      });
      await new Promise((r) => setTimeout(r, 600));
      const banner = document.querySelector('#history .past-banner');
      const out = {
        ok: true,
        opened,
        bannerTitle: banner ? banner.querySelector('.past-banner-title').textContent : null,
        emptyNote: document.querySelector('#history .past-empty')
          ? document.querySelector('#history .past-empty').textContent : null,
        inputLocked: document.getElementById('input').disabled,
        turnsShown: document.querySelectorAll('#history .turn').length,
      };
      const back = banner && banner.querySelector('.past-banner-back');
      if (back) back.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 450));
      out.restoredCount = document.getElementById('history').childNodes.length;
      out.beforeCount = before;
      out.bannerGone = !document.querySelector('#history .past-banner');
      out.inputFree = !document.getElementById('input').disabled;
      return out;
    `);
    pageOk('합성 대화 열기', synthetic);
    check('과거 대화 열기가 성공을 보고한다', synthetic.opened === true, synthetic.opened);
    check('배너 제목에 그 대화 이름이 들어간다',
      /검증용 합성 대화/.test(synthetic.bannerTitle || ''), synthetic.bannerTitle);
    check('메시지가 0건이면 정직하게 없다고 말한다',
      synthetic.emptyNote === '이 대화에는 저장된 메시지가 없습니다.', synthetic.emptyNote);
    check('메시지가 0건이면 가짜 턴을 그리지 않는다', synthetic.turnsShown === 0, synthetic.turnsShown);
    check('과거 대화에서는 입력이 잠긴다', synthetic.inputLocked === true, synthetic.inputLocked);
    check('[현재 대화로]가 배너를 걷고 입력을 푼다',
      synthetic.bannerGone === true && synthetic.inputFree === true, synthetic);
    // 살아 있는 대화의 DOM을 노드째 보관해 되돌린다 — 문자열로 보관하면 진행 중 턴에
    // 걸린 리스너·타이머 참조가 끊긴다. 개수 복원이 그 계약의 관찰 가능한 증거다.
    check('살아 있는 화면이 노드 수까지 그대로 복원된다',
      synthetic.restoredCount === synthetic.beforeCount,
      { before: synthetic.beforeCount, after: synthetic.restoredCount });
    await capture(wc, '09-past-conversation');

    // ── 9. 채팅 컨텍스트 ───────────────────────────────────────────────────
    section('9. 채팅 컨텍스트');
    const ctx = await evaluate(wc, `
      const c = window.AthenaCanvasMode.getContext();
      const banner = document.querySelector('#graphConfirmBanner .confirm-banner-title');
      return {
        ok: true, ctx: c,
        bannerCount: banner ? Number(banner.textContent.replace(/[^0-9]/g, '')) : null,
        keys: Object.keys(c).sort(),
        countKeys: Object.keys(c.counts).sort(),
      };
    `);
    if (!pageOk('getContext 호출', ctx)) throw new Error(`getContext가 페이지에서 터졌다: ${ctx.__error}`);
    check('getContext 최상위 키 계약이 유지된다',
      JSON.stringify(ctx.keys) === JSON.stringify(
        ['available', 'clusters', 'counts', 'filters', 'hiddenLinks', 'revision', 'selected', 'surface', 'topSignals'],
      ), ctx.keys);
    // 사전순은 코드 단위 비교다 — 'unassigned'(un+a)가 'uncertain'(un+c)보다 앞이다.
    check('counts 7필드가 유지된다',
      JSON.stringify(ctx.countKeys) === JSON.stringify(
        ['clusters', 'entities', 'hiddenLinks', 'relations', 'signals', 'unassigned', 'uncertain'],
      ), ctx.countKeys);
    check('브레인 준비 상태가 컨텍스트에 실린다', ctx.ctx.available === true, ctx.ctx.available);
    check('확인 필요 건수가 화면 배너와 같다',
      ctx.bannerCount === null || ctx.ctx.counts.uncertain === ctx.bannerCount,
      { ctx: ctx.ctx.counts.uncertain, banner: ctx.bannerCount });
    check('노드를 전부 싣지 않는다(군집 ≤10 · 신호 ≤12 · 숨은연관 ≤6)',
      ctx.ctx.clusters.length <= 10 && ctx.ctx.topSignals.length <= 12 && ctx.ctx.hiddenLinks.length <= 6,
      { clusters: ctx.ctx.clusters.length, signals: ctx.ctx.topSignals.length, hidden: ctx.ctx.hiddenLinks.length });
    check('걸린 필터가 컨텍스트에 실린다', !!ctx.ctx.filters, ctx.ctx.filters);

    // 프롬프트 조립은 main 프로세스 몫이다 — 실제 컨텍스트로 접두가 조립되는지 잰다.
    const { buildGraphModePrefix } = require(path.join(APP_DIR, 'lib', 'main', 'live-prompt.js'));
    const prefix = buildGraphModePrefix(ctx.ctx, '20260902');
    check('그래프 접두가 모드를 못박는다', prefix.startsWith('[모드: 그래프]'), prefix.slice(0, 30));
    check('그래프 접두가 athena_brain 5액션을 알려준다',
      ['profile', 'god_nodes', 'surprising', 'questions', 'diff'].every((a) => prefix.includes(a))
        && prefix.includes('athena_brain'), true);
    check('그래프 접두가 화면 숫자를 그대로 싣는다',
      prefix.includes(`확인 필요 ${ctx.ctx.counts.uncertain}`), ctx.ctx.counts.uncertain);
    check('그래프 접두가 시세 경로를 닫는다',
      prefix.includes('athena__render_canvas를 호출하지 않는다'), true);

    // ── 10. 모드 이탈 ──────────────────────────────────────────────────────
    section('10. 모드 이탈');
    await evaluate(wc, `document.getElementById('modeNavSummary').click(); return { ok: true };`);
    const exited = await waitForRenderer(wc, `
      const s = document.getElementById('graphSummaryTable');
      const g = document.getElementById('graphCanvas');
      const c = document.getElementById('graphSettingsCanvas');
      const m = document.getElementById('mosaic');
      return { ok: s.hidden && g.hidden && c.hidden && !m.hidden,
               summary: s.hidden, map: g.hidden, settings: c.hidden, mosaic: !m.hidden,
               chatHeadHidden: document.getElementById('chatModeHead').hidden };
    `, '대화 모드 복귀');
    check('대화 모드로 나가면 그래프 표면 셋이 전부 숨는다', exited.ok === true, exited);
    check('그래프 채팅 헤더도 함께 숨는다', exited.chatHeadHidden === true, exited.chatHeadHidden);

    // ── 11. 콘솔 오류 ──────────────────────────────────────────────────────
    section('11. 콘솔 오류');
    check('렌더러 콘솔 오류가 없다', consoleErrors.length === 0, consoleErrors.slice(0, 5));

    } catch (error) {
      check(`[${currentSection}] 실행 중단`, false, String((error && error.stack) || error).slice(0, 600));
    }

    return failures.length === 0 ? 0 : 1;
  } finally {
    try { backend.kill(); } catch { /* 이미 죽었다 */ }
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.destroy(); } catch { /* 이미 파괴됐다 */ }
    }
    // 영수증은 **어떤 경로로 끝나도** 남긴다 — 중단된 실행의 영수증이 없으면
    // 다음 바퀴가 어디까지 갔는지 모른 채 시작한다.
    const receipt = {
      generatedAt: new Date().toISOString(),
      steps,
      failures,
      pass: failures.length === 0,
    };
    const receiptPath = path.join(ARTIFACT_DIR, 'verify-graph-mode.json');
    try { fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8'); } catch { /* 못 쓰면 그만 */ }
    const checks = steps.filter((s) => !s.name.startsWith('──') && !s.name.startsWith('capture:')).length;
    process.stdout.write(`${JSON.stringify({ pass: receipt.pass, checks, failures: failures.length, receiptPath }, null, 2)}\n`);
    for (const failure of failures) {
      process.stdout.write(`FAIL  [${failure.section}] ${failure.name} :: ${JSON.stringify(failure.detail)}\n`);
    }
    if (failures.length > 0) {
      process.stdout.write(`\n--- backend log tail ---\n${backendLog.join('').slice(-800)}\n`);
    }
  }
}

main()
  .then((code) => { app.exit(code); })
  .catch((error) => {
    process.stderr.write(`${String((error && error.stack) || error)}\n`);
    app.exit(1);
  });
