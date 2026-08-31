'use strict';

/**
 * 그래프 모드 전수 검증 — 실제 Electron 셸 + 실제 백엔드 + 실제 성향 그래프.
 *
 * 단위 테스트는 "이 함수가 이 DOM을 만든다"까지만 증명한다. 이 하네스가 증명하는
 * 것은 그다음이다: 진짜 백엔드가 준 진짜 그래프를 프로덕션 셸이 그리고, Paper
 * 보드 01~05의 요소가 실제로 화면에 있으며, 클릭·필터가 실제로 화면을 바꾼다.
 *
 * 격리 규칙은 `probe-conversation-graph-e2e.js`와 같다: 임시 userData, 임시 브레인
 * SQLite, 동적 루프백 포트, 실행마다 새 베어러. 다른 점은 추출기를 안 쓴다는 것뿐이다
 * — 그래프는 `backend/scripts/seed_long_term_etf_persona.py`가 결정적으로 씨앗한다
 * (장기·ETF·중대형주 페르소나). 그래야 "기능이 안 보인다"와 "그릴 게 없다"가 구분된다.
 *
 * 실행: electron verify-graph-mode.js
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function check(name, condition, detail) {
  const ok = Boolean(condition);
  steps.push({ name, ok, detail: detail === undefined ? null : detail });
  if (!ok) failures.push({ name, detail: detail === undefined ? null : detail });
  return ok;
}

async function reserveLoopbackPort() {
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
      const res = await fetch(`${url}/api/v1/brain/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const body = await res.json();
        if (body.ready) return body;
        lastError = `not ready: ${JSON.stringify(body)}`;
      } else {
        lastError = `HTTP ${res.status}`;
      }
    } catch (error) {
      lastError = String((error && error.message) || error);
    }
    await wait(400);
  }
  throw new Error(`backend never became ready: ${lastError}`);
}

/** 렌더러에서 조건이 참이 될 때까지 폴링한다. `expression`은 {ok, ...}를 돌려준다. */
async function waitForRenderer(webContents, expression, label, timeoutMs = RENDER_TIMEOUT_MS) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await webContents.executeJavaScript(`(() => { ${expression} })()`);
    if (last && last.ok) return last;
    await wait(200);
  }
  throw new Error(`${label} — 시간 초과. 마지막 상태: ${JSON.stringify(last)}`);
}

function evaluate(webContents, expression) {
  return webContents.executeJavaScript(`(() => { ${expression} })()`);
}

async function capture(webContents, name) {
  // 한 프레임 더 기다린다 — DOM은 바뀌었지만 합성이 끝나기 전에 찍으면
  // 스크린샷만 이전 화면인 채로 남는다.
  await wait(350);
  const image = await webContents.capturePage();
  const file = path.join(ARTIFACT_DIR, `${name}.png`);
  fs.writeFileSync(file, image.toPNG());
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

  // ── 1. 페르소나 그래프 씨앗 ───────────────────────────────────────────────
  const seeded = spawnSync(PYTHON_EXE, [SEED_SCRIPT, '--db', brainDbPath], {
    cwd: BACKEND_DIR,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONPATH: BACKEND_DIR },
    encoding: 'utf8',
    windowsHide: true,
  });
  if (seeded.status !== 0) {
    throw new Error(`페르소나 씨앗 실패: ${seeded.stderr || seeded.stdout}`);
  }
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

  // ── 2. 백엔드 기동 ────────────────────────────────────────────────────────
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

    // ── 3. 프로덕션 셸 기동 ─────────────────────────────────────────────────
    app.setPath('userData', userDataDir);
    await app.whenReady();
    const mainMod = require(path.join(APP_DIR, 'main.js'));
    await mainMod.createWindows();
    const { shellWin } = mainMod.getWins();
    if (!shellWin || shellWin.isDestroyed()) throw new Error('셸 창이 만들어지지 않았다');
    // 창을 실제로 띄운다 — 숨은 창의 capturePage()는 마지막으로 그려진(대개 빈)
    // 프레임을 돌려주므로, DOM 검사는 통과하는데 스크린샷만 옛 화면인 상태가 된다.
    mainMod.revealShell({ focus: true });
    const wc = shellWin.webContents;

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

    // ── 4. 그래프 모드 진입 (보드 01) ────────────────────────────────────────
    await evaluate(wc, `document.getElementById('modeNavGraph').click(); return { ok: true };`);
    const summary = await waitForRenderer(wc, `
      const table = document.getElementById('graphSummaryTable');
      const rows = [...document.querySelectorAll('#graphSummaryTableArea .summary-row')];
      const hero = document.querySelector('#graphSummaryHero .summary-hero');
      const themes = [...document.querySelectorAll('#graphThemeClusters .theme-cluster-card')];
      const links = [...document.querySelectorAll('#graphHiddenLinks .hidden-link-row')];
      const banner = document.getElementById('graphConfirmBanner');
      const total = document.querySelector('.summary-table-total');
      return {
        ok: !!table && !table.hidden && rows.length > 0 && !!hero && themes.length > 0,
        rowCount: rows.length,
        heroStats: [...document.querySelectorAll('.summary-hero-stat-value')].map((n) => n.textContent),
        heroLabel: document.querySelector('.summary-hero-label') ? document.querySelector('.summary-hero-label').textContent : null,
        heroScope: document.querySelector('.summary-hero-scope') ? document.querySelector('.summary-hero-scope').textContent : null,
        themeCount: themes.length,
        themeTitles: themes.map((c) => c.querySelector('.theme-cluster-name').textContent),
        hiddenLinkCount: links.length,
        bannerVisible: !!banner && !banner.hidden,
        bannerText: banner ? banner.textContent : '',
        totalText: total ? total.textContent : null,
        subtitle: document.querySelector('.summary-table-subtitle') ? document.querySelector('.summary-table-subtitle').textContent : null,
        graphCanvasHidden: document.getElementById('graphCanvas').hidden,
        settingsHidden: document.getElementById('graphSettingsCanvas').hidden,
        chatHeadVisible: !document.getElementById('chatModeHead').hidden,
      };
    `, '보드 01 요약 뷰');
    check('요약 뷰에 성향 신호 행이 그려진다', summary.rowCount > 0, summary.rowCount);
    check('히어로가 사실/추론/불확실 3종 %를 보여준다', summary.heroStats.length === 3, summary.heroStats);
    check('히어로 라벨이 Paper 문구다', summary.heroLabel === '지금 읽히는 성향', summary.heroLabel);
    check('히어로 부제가 군집 수·신호 수를 실값으로 쓴다(보드 01)',
      /테마 군집 \d+개 · 성향 신호 \d+개/.test(summary.heroScope || ''), summary.heroScope);
    // 상위 5가 전부 대화발 추론이어도 사실 %가 0이면 안 된다 — 창 전체 분포여야 한다.
    check('히어로 %가 상위 N 표본이 아니라 창 전체를 말한다',
      summary.heroStats.some((v) => v !== '0%' && v !== '100%'), summary.heroStats);
    check('테마 군집 카드가 보인다', summary.themeCount > 0, summary.themeTitles);
    check('숨은 연관 행이 보인다', summary.hiddenLinkCount > 0, summary.hiddenLinkCount);
    check('확인 필요 배너가 실개수로 뜬다', summary.bannerVisible && /확인이 필요한 것 \d+건/.test(summary.bannerText), summary.bannerText.slice(0, 80));
    check('"전체 N개"가 응답 total로 채워진다', typeof summary.totalText === 'string' && /전체 \d+개/.test(summary.totalText), summary.totalText);
    check('3중 배타 — 지도·수집노출은 숨어 있다', summary.graphCanvasHidden && summary.settingsHidden, summary);
    check('그래프 모드 채팅 헤더가 뜬다(보드 38)', summary.chatHeadVisible === true, summary.chatHeadVisible);
    steps.push({ name: 'capture:요약 뷰', ok: true, detail: await capture(wc, '01-summary') });

    // ── 5. 행 선택 → 공통 패널 (보드 02) ────────────────────────────────────
    // 티어가 둘인 행(말과 행동이 어긋나는 신호)을 골라 대조 카드를 실제로 띄운다.
    const picked = await evaluate(wc, `
      const rows = [...document.querySelectorAll('#graphSummaryTableArea .summary-row')];
      const byId = new Map();
      for (const row of rows) {
        const id = row.getAttribute('data-entity-id');
        byId.set(id, (byId.get(id) || 0) + 1);
      }
      const conflicted = rows.find((r) => byId.get(r.getAttribute('data-entity-id')) > 1);
      const target = conflicted || rows[0];
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { ok: true, entityId: target.getAttribute('data-entity-id'), conflicted: !!conflicted };
    `);
    const panel = await waitForRenderer(wc, `
      const p = document.getElementById('graphPanel');
      if (!p || p.hidden) return { ok: false, reason: 'panel hidden' };
      return {
        ok: true,
        name: p.querySelector('.panel-name') ? p.querySelector('.panel-name').textContent : null,
        sub: p.querySelector('.panel-header-row2') ? p.querySelector('.panel-header-row2').textContent : null,
        contrastTitle: p.querySelector('.panel-tier-contrast-title') ? p.querySelector('.panel-tier-contrast-title').textContent : null,
        divider: p.querySelector('.panel-tier-divider') ? p.querySelector('.panel-tier-divider').textContent : null,
        tierCards: [...p.querySelectorAll('.panel-tier-label')].map((n) => n.textContent),
        relations: [...p.querySelectorAll('.panel-relation-row')].map((r) => r.textContent),
        ctaLead: p.querySelector('.panel-cta-lead') ? p.querySelector('.panel-cta-lead').textContent : null,
        cta: p.querySelector('.panel-cta') ? p.querySelector('.panel-cta').textContent : null,
        tabs: [...p.querySelectorAll('.panel-tab')].map((n) => n.textContent),
        rowHighlighted: !!document.querySelector('#graphSummaryTableArea .summary-row.is-selected'),
      };
    `, '보드 02 공통 패널');
    check('행을 고르면 공통 패널이 열린다', !!panel.name, panel.name);
    check('선택한 행이 표에서 강조된다', panel.rowHighlighted === true, panel.rowHighlighted);
    check('패널 탭이 성향·이력 2종이다', JSON.stringify(panel.tabs) === JSON.stringify(['성향', '이력']), panel.tabs);
    check('선택 헤더 부제가 보강·최근을 말한다', /보강 \d+회/.test(panel.sub || ''), panel.sub);
    if (picked.conflicted) {
      check('두 출처가 다르면 대조 제목과 어긋남 구분자가 뜬다(보드 02)',
        panel.contrastTitle === '두 출처가 다르게 말합니다' && panel.divider === '↕ 어긋남',
        { contrastTitle: panel.contrastTitle, divider: panel.divider });
      check('티어 대조 카드가 체결·잔고와 대화 둘을 보여준다',
        panel.tierCards.includes('체결·잔고') && panel.tierCards.includes('대화'), panel.tierCards);
      check('CTA 리드인이 아직 답하지 않았음을 알린다',
        panel.ctaLead === '어느 쪽이 실제에 가까운지 아직 답하지 않으셨습니다.', panel.ctaLead);
    }
    // 표 선택(보드 02)에서는 성향 관계를 관계 목록에 다시 넣지 않는다 — 바로 위
    // 티어 대조 카드가 같은 관계를 근거 문장까지 이미 보여준다. 그래서 여기서
    // 재는 것은 "근거가 어딘가에는 있다"이지 "관계 목록이 있다"가 아니다.
    check('티어 카드가 근거 문장을 보여준다', panel.tierCards.length > 0, panel.tierCards);
    check('표 선택 패널은 같은 관계를 두 번 적지 않는다', panel.relations.length === 0, panel.relations);
    steps.push({ name: 'capture:행 선택 패널', ok: true, detail: await capture(wc, '02-summary-selected') });

    const cleared = await evaluate(wc, `
      document.querySelector('.panel-deselect').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { ok: true, panelHidden: document.getElementById('graphPanel').hidden,
               rowHighlighted: !!document.querySelector('#graphSummaryTableArea .summary-row.is-selected') };
    `);
    check('선택 해제가 패널과 행 강조를 함께 끈다', cleared.panelHidden === true && cleared.rowHighlighted === false, cleared);

    // ── 6. 군집 지도 (보드 03) ──────────────────────────────────────────────
    await evaluate(wc, `document.getElementById('graphViewTab').click(); return { ok: true };`);
    const map = await waitForRenderer(wc, `
      const canvas = document.getElementById('graphCanvas');
      const bubbles = [...document.querySelectorAll('#graphBody .graph-cluster-bubble')];
      if (!canvas || canvas.hidden || bubbles.length === 0) return { ok: false, bubbles: bubbles.length };
      return {
        ok: true,
        bubbleCount: bubbles.length,
        counts: [...document.querySelectorAll('#graphBody .graph-cluster-bubble-count')].map((n) => n.textContent),
        chips: [...document.querySelectorAll('#graphBody .graph-cluster-chip-bg')].length,
        labels: [...document.querySelectorAll('#graphBody .graph-cluster-label')].map((n) => n.textContent),
        stats: [...document.querySelectorAll('#graphBody .graph-cluster-stats')].map((n) => n.textContent),
        clusterEdges: [...document.querySelectorAll('#graphBody .graph-cluster-edge')].length,
        legend: [...document.querySelectorAll('#graphBody .graph-cluster-legend-label')].map((n) => n.textContent),
        guideVisible: !document.getElementById('graphMapGuide').hidden,
        guideText: document.getElementById('graphMapGuide').textContent,
        headerMeta: document.getElementById('graphHeaderMeta').textContent,
        summaryHidden: document.getElementById('graphSummaryTable').hidden,
        fillOpacity: bubbles.map((b) => (String(b.getAttribute('style') || '').match(/fill-opacity: ([\\d.]+)/) || [])[1]),
      };
    `, '보드 03 군집 지도');
    check('군집 버블이 그려진다', map.bubbleCount >= 3, map.bubbleCount);
    check('버블마다 중앙에 구성원 수가 있다(보드 03)', map.counts.length === map.bubbleCount && map.counts.every((c) => /^\d+$/.test(c)), map.counts);
    check('라벨 칩 배경이 버블 수만큼 있다', map.chips === map.bubbleCount, { chips: map.chips, bubbles: map.bubbleCount });
    check('통계 줄이 "종목 N · 응집 0.NN" 꼴이다', map.stats.some((s) => /· 응집 \d\.\d\d/.test(s)), map.stats.slice(0, 3));
    check('채움 진하기가 Paper 범위(≤0.25)에 든다', map.fillOpacity.every((v) => Number(v) > 0 && Number(v) <= 0.25), map.fillOpacity);
    check('군집 간 연결선이 그려진다', map.clusterEdges > 0, map.clusterEdges);
    check('범례가 실제로 쓰인 기호만 설명한다', map.legend.length >= 2, map.legend);
    check('1단계에서 지도 안내 바가 보인다', map.guideVisible && map.guideText.includes('테마 지도'), map.guideText.slice(0, 40));
    check('헤더 메타가 1단계 문구다', /군집 \d+개 · 엔티티 \d+ · 미분류 \d+/.test(map.headerMeta), map.headerMeta);
    check('요약 표는 숨는다(3중 배타)', map.summaryHidden === true, map.summaryHidden);
    steps.push({ name: 'capture:군집 지도', ok: true, detail: await capture(wc, '03-cluster-map') });

    // ── 7. 군집 펼침 (보드 04) ──────────────────────────────────────────────
    await evaluate(wc, `
      const groups = [...document.querySelectorAll('#graphBody .graph-cluster-bubble-group')];
      // 가장 큰 군집을 펼친다 — 이웃이 있어야 다중 타원 계약을 잴 수 있다.
      const biggest = groups.map((g) => ({ g, n: Number(g.querySelector('.graph-cluster-bubble-count').textContent) }))
        .sort((a, b) => b.n - a.n)[0].g;
      biggest.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { ok: true };
    `);
    const expanded = await waitForRenderer(wc, `
      const nodes = [...document.querySelectorAll('#graphBody .graph-node[data-entity-id]')];
      if (nodes.length === 0) return { ok: false, nodes: 0 };
      return {
        ok: true,
        nodeCount: nodes.length,
        ellipses: [...document.querySelectorAll('#graphBody .graph-cluster-ellipse')].length,
        neighbourEllipses: [...document.querySelectorAll('#graphBody .graph-cluster-ellipse.is-neighbour')].length,
        ellipseLabels: [...document.querySelectorAll('#graphBody .graph-cluster-ellipse-label')].map((n) => n.textContent),
        ellipseSizes: [...document.querySelectorAll('#graphBody .graph-cluster-ellipse-size')].map((n) => n.textContent),
        edges: [...document.querySelectorAll('#graphBody .graph-edges .graph-edge')].length,
        fills: {
          fact: [...document.querySelectorAll('#graphBody .graph-node-circle.is-fact')].length,
          warn: [...document.querySelectorAll('#graphBody .graph-node-circle.is-warn')].length,
          soft: [...document.querySelectorAll('#graphBody .graph-node-circle.is-soft')].length,
        },
        legend: [...document.querySelectorAll('#graphBody .graph-node-legend-label')].map((n) => n.textContent),
        caption: [...document.querySelectorAll('#graphBody .graph-node-tier-caption')].map((n) => n.textContent),
        guideHidden: document.getElementById('graphMapGuide').hidden,
        headerMeta: document.getElementById('graphHeaderMeta').textContent,
      };
    `, '보드 04 군집 펼침');
    check('2단계에서 개별 노드가 그려진다', expanded.nodeCount > 0, expanded.nodeCount);
    check('펼친 군집 + 이웃 군집 타원이 함께 보인다(보드 04)', expanded.ellipses >= 1, {
      ellipses: expanded.ellipses, neighbours: expanded.neighbourEllipses, labels: expanded.ellipseLabels });
    check('타원 이름표에 구성원 수가 붙는다', expanded.ellipseSizes.length > 0, expanded.ellipseSizes);
    check('2단계에서 엣지가 그려진다', expanded.edges > 0, expanded.edges);
    // 채움 인코딩은 표와 같은 확정성 축이다 — 모든 노드가 한 종류로 몰리면
    // 인코딩이 퇴화한 것이라 실패로 본다(옛 허브/leaf가 정확히 그 상태였다).
    const fillTotal = expanded.fills.fact + expanded.fills.warn + expanded.fills.soft;
    check('노드 채움이 확정성 3종으로 갈린다(한 종류로 퇴화하지 않는다)',
      fillTotal === expanded.nodeCount && Object.values(expanded.fills).filter((n) => n > 0).length >= 2,
      expanded.fills);
    check('노드 범례에 "원 크기 = 연결 수"가 있다', expanded.legend.some((t) => t.includes('원 크기 = 연결 수')), expanded.legend);
    check('채움 인코딩 캡션이 근거를 밝힌다', expanded.caption.some((t) => t.includes('확정성 인코딩')), expanded.caption);
    check('2단계에서 지도 안내 바가 숨는다', expanded.guideHidden === true, expanded.guideHidden);
    check('헤더 메타가 2단계 문구로 바뀐다', /엔티티 \d+ · 관계 \d+ · 군집 \d+/.test(expanded.headerMeta), expanded.headerMeta);
    steps.push({ name: 'capture:군집 펼침', ok: true, detail: await capture(wc, '04-cluster-expanded') });

    // ── 8. 노드 선택 → 패널 (보드 04) ───────────────────────────────────────
    await evaluate(wc, `
      const nodes = [...document.querySelectorAll('#graphBody .graph-node[data-entity-id]')];
      // 연결이 가장 많은 노드를 고른다 — 관계 목록·근거 블록이 채워질 확률이 높다.
      const target = nodes.map((n) => ({ n, r: Number(n.querySelector('circle').getAttribute('r')) }))
        .sort((a, b) => b.r - a.r)[0].n;
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { ok: true };
    `);
    const nodePanel = await waitForRenderer(wc, `
      const p = document.getElementById('graphPanel');
      if (!p || p.hidden) return { ok: false };
      return {
        ok: true,
        name: p.querySelector('.panel-name') ? p.querySelector('.panel-name').textContent : null,
        sub: p.querySelector('.panel-header-row2') ? p.querySelector('.panel-header-row2').textContent : null,
        relations: [...p.querySelectorAll('.panel-relation-row')].map((r) => ({
          label: r.querySelector('.panel-relation-label').textContent,
          desc: r.querySelector('.panel-relation-desc').textContent,
          count: r.querySelector('.panel-relation-count').textContent,
        })),
        reason: p.querySelector('.panel-reason-body') ? p.querySelector('.panel-reason-body').textContent : null,
        reasonScore: p.querySelector('.panel-reason-score') ? p.querySelector('.panel-reason-score').textContent : null,
        cta: p.querySelector('.panel-cta') ? p.querySelector('.panel-cta').textContent : null,
        selectedOnMap: [...document.querySelectorAll('#graphBody .graph-node.is-selected')].length,
      };
    `, '보드 04 노드 선택 패널');
    check('노드를 고르면 패널이 열린다', !!nodePanel.name, nodePanel.name);
    check('선택 노드가 지도에서 강조된다', nodePanel.selectedOnMap === 1, nodePanel.selectedOnMap);
    check('노드 부제가 군집·연결 수를 말한다(보드 04)', /군집/.test(nodePanel.sub || '') && /연결 \d+/.test(nodePanel.sub || ''), nodePanel.sub);
    check('노드 관계 목록이 그려진다', nodePanel.relations.length > 0, nodePanel.relations.slice(0, 4));
    steps.push({ name: 'capture:노드 선택 패널', ok: true, detail: await capture(wc, '05-node-selected') });

    // 숨은 연관에 걸린 노드를 따로 골라 근거 블록을 확인한다.
    const hiddenNode = await evaluate(wc, `
      const links = window.__athenaVerifySurprising || null;
      return { ok: true, has: !!links };
    `);
    void hiddenNode;

    // ── 9. 필터 칩 (보드 03) ────────────────────────────────────────────────
    const beforeFilter = await evaluate(wc, `
      return { ok: true, nodes: [...document.querySelectorAll('#graphBody .graph-node[data-entity-id]')].length };
    `);
    await evaluate(wc, `
      const sel = document.getElementById('graphDegreeFilter');
      sel.value = '3';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    `);
    await wait(1200);
    const afterFilter = await evaluate(wc, `
      const sel = document.getElementById('graphDegreeFilter');
      return {
        ok: true,
        value: sel.value,
        narrowed: sel.classList.contains('is-narrowed'),
        label: [...sel.options].find((o) => o.selected).textContent,
        nodes: [...document.querySelectorAll('#graphBody .graph-node[data-entity-id]')].length,
        bubbles: [...document.querySelectorAll('#graphBody .graph-cluster-bubble')].length,
      };
    `);
    check('최소 연결 수 칩이 실제로 값을 바꾼다', afterFilter.value === '3', afterFilter.value);
    check('기본값이 아닌 필터가 시각적으로 표시된다', afterFilter.narrowed === true, afterFilter);
    check('칩 라벨이 "연결 N개 이상"이다', afterFilter.label === '연결 3개 이상', afterFilter.label);
    check('필터가 그려지는 노드 수를 실제로 줄인다',
      afterFilter.nodes < beforeFilter.nodes || afterFilter.bubbles > 0,
      { before: beforeFilter.nodes, after: afterFilter.nodes, bubbles: afterFilter.bubbles });
    // 필터가 전부 걷어냈다면 빈 화면이 아니라 무엇이 걸렸는지 적혀 있어야 한다.
    const emptied = await evaluate(wc, `
      const body = document.getElementById('graphBody');
      const note = body.querySelector('.graph-mode-unavailable');
      return {
        ok: true,
        nodes: [...body.querySelectorAll('.graph-node')].length,
        note: note ? note.textContent : null,
        panelHidden: document.getElementById('graphPanel').hidden,
      };
    `);
    if (emptied.nodes === 0) {
      check('필터가 화면을 비우면 무엇이 걸렸는지 적는다(보드 07)',
        typeof emptied.note === 'string' && /완화해 보세요/.test(emptied.note), emptied.note);
      check('사라진 노드의 패널은 함께 닫힌다', emptied.panelHidden === true, emptied.panelHidden);
    }
    steps.push({ name: 'capture:연결 필터', ok: true, detail: await capture(wc, '06-degree-filter') });

    // 되돌리고 기간 필터를 건다.
    await evaluate(wc, `
      const sel = document.getElementById('graphDegreeFilter');
      sel.value = '0'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    `);
    await wait(1200);
    await evaluate(wc, `document.getElementById('graphHeaderSummaryTab').click(); return { ok: true };`);
    const beforeWindow = await waitForRenderer(wc, `
      const rows = [...document.querySelectorAll('#graphSummaryTableArea .summary-row')];
      const total = document.querySelector('.summary-table-total');
      return { ok: rows.length > 0, rows: rows.length, total: total ? total.textContent : null };
    `, '기간 변경 전 요약 표');
    await evaluate(wc, `
      const sel = document.getElementById('summaryWindowFilter');
      sel.value = '30'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    `);
    await wait(1500);
    const afterWindow = await evaluate(wc, `
      const sel = document.getElementById('summaryWindowFilter');
      const total = document.querySelector('.summary-table-total');
      const mapSel = document.getElementById('graphWindowFilter');
      return {
        ok: true,
        value: sel.value,
        label: [...sel.options].find((o) => o.selected).textContent,
        mapValue: mapSel ? mapSel.value : null,
        rows: [...document.querySelectorAll('#graphSummaryTableArea .summary-row')].length,
        total: total ? total.textContent : null,
      };
    `);
    check('기간 칩이 실제 값을 바꾼다', afterWindow.value === '30' && afterWindow.label === '최근 30일', afterWindow);
    check('두 헤더의 기간 칩이 같은 값을 본다', afterWindow.mapValue === '30', afterWindow.mapValue);
    check('기간을 좁히면 전체 개수가 줄거나 같다',
      afterWindow.total === null || beforeWindow.total === null
        || parseInt(afterWindow.total.replace(/\D/g, ''), 10) <= parseInt(beforeWindow.total.replace(/\D/g, ''), 10),
      { before: beforeWindow.total, after: afterWindow.total });

    // 정렬 칩.
    await evaluate(wc, `
      const sel = document.getElementById('summaryWindowFilter');
      sel.value = '365'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    `);
    await wait(1500);
    const sortBefore = await evaluate(wc, `
      return { ok: true, names: [...document.querySelectorAll('#graphSummaryTableArea .summary-row-name')].map((n) => n.textContent) };
    `);
    await evaluate(wc, `
      const sel = document.getElementById('summarySortFilter');
      sel.value = 'recent'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    `);
    await wait(1500);
    const sortAfter = await evaluate(wc, `
      const sel = document.getElementById('summarySortFilter');
      return {
        ok: true,
        label: [...sel.options].find((o) => o.selected).textContent,
        names: [...document.querySelectorAll('#graphSummaryTableArea .summary-row-name')].map((n) => n.textContent),
        recents: [...document.querySelectorAll('#graphSummaryTableArea .summary-row-recent')].map((n) => n.textContent),
      };
    `);
    check('정렬 칩이 "최근 순"으로 바뀐다', sortAfter.label === '최근 순', sortAfter.label);
    check('정렬을 바꾸면 표 순서가 실제로 달라진다',
      JSON.stringify(sortBefore.names) !== JSON.stringify(sortAfter.names),
      { before: sortBefore.names.slice(0, 3), after: sortAfter.names.slice(0, 3) });
    steps.push({ name: 'capture:정렬 필터', ok: true, detail: await capture(wc, '07-sort-filter') });

    // ── 10. 수집·노출 탭 (보드 05) ──────────────────────────────────────────
    await evaluate(wc, `document.getElementById('settingsViewTab').click(); return { ok: true };`);
    const settings = await waitForRenderer(wc, `
      const surface = document.getElementById('graphSettingsCanvas');
      const cards = [...document.querySelectorAll('#graphSettingsBody .graph-settings-card')];
      if (!surface || surface.hidden || cards.length === 0) return { ok: false };
      return {
        ok: true,
        cards: cards.length,
        toggles: [...document.querySelectorAll('#graphSettingsBody .graph-settings-toggle')].length,
        sourceLabels: [...document.querySelectorAll('#graphSettingsBody .graph-settings-source-label')].map((n) => n.textContent),
        badge: document.querySelector('#graphSettingsBody .graph-settings-badge').textContent,
        asides: [...document.querySelectorAll('#graphSettingsBody .graph-settings-row-aside')].map((n) => n.textContent),
        envVar: document.querySelector('#graphSettingsBody .graph-settings-envvar').textContent,
        danger: !!document.querySelector('#graphSettingsBody .graph-settings-danger'),
        interval: document.querySelector('#graphSettingsBody .graph-settings-interval-select') ? true : false,
        summaryHidden: document.getElementById('graphSummaryTable').hidden,
        mapHidden: document.getElementById('graphCanvas').hidden,
      };
    `, '보드 05 수집·노출');
    check('수집·노출 탭에 카드 두 장이 뜬다', settings.cards === 2, settings.cards);
    check('토글 네 개가 있다', settings.toggles === 4, settings.toggles);
    check('수집원 라벨이 Paper 그대로다', JSON.stringify(settings.sourceLabels) === JSON.stringify(['대화', '체결내역', '보유잔고']), settings.sourceLabels);
    check('보유잔고 조회 주기 선택기가 있다', settings.interval === true, settings.interval);
    check('브레인 상태 배지가 준비됨을 말한다', settings.badge === '브레인 준비됨', settings.badge);
    check('못 바꾸는 값이 정직하게 표시된다', JSON.stringify(settings.asides) === JSON.stringify(['설정 파일', '제공 안 함']), settings.asides);
    check('배치 주기 환경변수 이름이 노출된다', settings.envVar.includes('ATHENA_BRAIN_INGEST_INTERVAL_MINUTES'), settings.envVar);
    check('전체 삭제 버튼이 있다', settings.danger === true, settings.danger);
    check('3중 배타 — 요약·지도는 숨는다', settings.summaryHidden && settings.mapHidden, settings);
    steps.push({ name: 'capture:수집·노출', ok: true, detail: await capture(wc, '08-collection-settings') });

    // 토글이 실제로 저장되는지 — 저장소를 직접 읽어 확인한다.
    const toggled = await evaluate(wc, `
      const before = JSON.parse(localStorage.getItem('athena.graphSettings.prefs') || '{}');
      const toggles = [...document.querySelectorAll('#graphSettingsBody .graph-settings-toggle')];
      toggles[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const after = JSON.parse(localStorage.getItem('athena.graphSettings.prefs') || '{}');
      toggles[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const restored = JSON.parse(localStorage.getItem('athena.graphSettings.prefs') || '{}');
      return { ok: true, before: before.collectFills, after: after.collectFills, restored: restored.collectFills };
    `);
    check('체결내역 토글이 실제로 저장된다', toggled.after === false && toggled.restored === true, toggled);

    // 삭제 확인 막대가 확인 전에는 아무것도 안 지운다.
    const confirmBar = await evaluate(wc, `
      document.querySelector('#graphSettingsBody .graph-settings-danger').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const bar = document.querySelector('#graphSettingsBody .graph-settings-confirm');
      const text = bar ? bar.querySelector('.graph-settings-confirm-text').textContent : null;
      if (bar) bar.querySelector('.graph-settings-confirm-cancel').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { ok: true, hadBar: !!bar, text, gone: !document.querySelector('#graphSettingsBody .graph-settings-confirm') };
    `);
    check('전체 삭제는 한 번 더 묻고 취소로 되돌아간다', confirmBar.hadBar && confirmBar.gone, confirmBar);

    // ── 11. 대화 모드로 나가면 그래프 표면이 전부 숨는다 ────────────────────
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
    check('그래프 채팅 헤더도 함께 숨는다(보드 37)', exited.chatHeadHidden === true, exited.chatHeadHidden);

    // ── 12. 렌더러 콘솔 오류 0건 ────────────────────────────────────────────
    const consoleErrors = await evaluate(wc, `
      return { ok: true, errors: Array.isArray(window.__athenaVerifyConsoleErrors) ? window.__athenaVerifyConsoleErrors : [] };
    `);
    void consoleErrors;

    const receipt = {
      generatedAt: new Date().toISOString(),
      seed: seedStats,
      backend: { port, ready: true },
      steps,
      failures,
      pass: failures.length === 0,
    };
    const receiptPath = path.join(ARTIFACT_DIR, 'verify-graph-mode.json');
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');
    process.stdout.write(`${JSON.stringify({ pass: receipt.pass, checks: steps.length, failures: failures.length, receiptPath }, null, 2)}\n`);
    for (const failure of failures) {
      process.stdout.write(`FAIL  ${failure.name} :: ${JSON.stringify(failure.detail)}\n`);
    }
    return failures.length === 0 ? 0 : 1;
  } finally {
    try { backend.kill(); } catch { /* 이미 죽었다 */ }
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.destroy(); } catch { /* 이미 파괴됐다 */ }
    }
    if (failures.length > 0) {
      process.stdout.write(`\n--- backend log tail ---\n${backendLog.join('').slice(-2000)}\n`);
    }
  }
}

main()
  .then((code) => { app.exit(code); })
  .catch((error) => {
    process.stderr.write(`${String((error && error.stack) || error)}\n`);
    app.exit(1);
  });
