// 백테스트 쇼케이스 프로브 — 지금 구현된 화면을 **실백엔드 + 실앱 UI**로 한 바퀴 돌며
// 소개 페이지에 쓸 스크린샷 14장을 찍는다.
//
// ⚠ 이 프로브가 찍는 14장은 옛 스펙 경로(지도·폼·코드 하위 탭)의 화면이고, 그 경로는
// 2026-09-08에 앱에서 사라졌다. 2026-09-03 실행에서도 이미 14-narrow가 MISS였고 지금은
// 01 이후 대부분이 MISS다(2026-09-09 실측). 현행 화면의 소개 그림은 보드 19~32를 따라
// 새로 찍어야 한다 — 이 파일을 그대로 돌려서 나온 그림을 소개에 쓰지 말 것.
//
// probe-backtest-full.js의 부팅부와 섹션 G·N·O가 지나는 길을 그대로 따라간다.
// 다른 점은 판정이 아니라 **그림**이 산출물이라는 것뿐이다 — 어떤 상태에 닿지 못하면
// 그 자리에서 화면을 그대로 찍고 왜 못 닿았는지 리포트에 적는다(지어내지 않는다).
//
// 준비(프로브가 하지 않는다):
//   1) 캔들이 시드된 백테스트 sqlite
//   2) ATHENA_BACKTEST_ENABLED=true 로 백엔드 기동(127.0.0.1:8010)
//   3) cd app && npx electron probe-backtest-showcase.js
//
// 산출물: artifacts/backtest-showcase/NN-<slug>.png + showcase.json

// main.js는 이 플래그가 없으면 require 시점에 자기 자신의 app.whenReady().then(createWindows)를
// 스스로도 돈다 — 이 프로브가 그 뒤에 또 createWindows()를 부르면 shellWin이 두 개 생기고
// 채팅 카드가 엉뚱한 창에 붙는다(probe-card-landing.js 실측).
process.env.ATHENA_NO_AUTOSTART = '1';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-probe-bt-showcase-'));
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
writeProbeModelPrefs(PROFILE);
app.setPath('userData', PROFILE);

const BACKEND = process.env.ATHENA_BACKEND_URL || 'http://127.0.0.1:8010';
const STK = process.env.ATHENA_PROBE_STK || '005930';
const ENV_FROM = process.env.ATHENA_PROBE_FROM || '';
const ENV_TO = process.env.ATHENA_PROBE_TO || '';
const FALLBACK_FROM = '20240401';
const FALLBACK_TO = '20260801';

let FROM = ENV_FROM;
let TO = ENV_TO;

const R = '#backtestCanvas ';

const WIDE_W = 1600;
const WIDE_H = 1000;
const NARROW_W = 860;

const WAIT_UI = 10000;
const WAIT_JS = 15000;
const WAIT_PRESETS = 25000;
const WAIT_VALIDATE = 30000;
const WAIT_RUN = 90000;

const OUT_DIR = path.join(__dirname, '..', 'artifacts', 'backtest-showcase');

const report = {
  startedAt: new Date().toISOString(), finishedAt: null, shots: [], failed: [], fatal: null,
};
const outcome = { fatal: null, finished: false };
let probeWin = null;

class PreconditionAbort extends Error {}

function log(text) { console.log(`[showcase] ${text}`); }

function safeJson(value) {
  try {
    const text = JSON.stringify(value);
    return text && text.length > 500 ? `${text.slice(0, 500)}…` : String(text);
  } catch { return '<직렬화 불가>'; }
}

// ---------- 렌더러 구동 헬퍼(probe-backtest-full.js와 같은 계약) ----------

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, label) {
  let timer = null;
  const capped = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __probeError: `${label} 시간 초과(${ms}ms)` }), ms);
  });
  return Promise.race([promise, capped]).finally(() => clearTimeout(timer));
}

function js(win, source) {
  if (!win || win.isDestroyed()) return Promise.resolve({ __probeError: '창이 이미 닫혔다' });
  const run = win.webContents.executeJavaScript(
    `(() => { try { return (\n${source}\n); } catch (e) {`
    + ' return { __probeError: String((e && e.message) || e) }; } })()',
  ).catch((err) => ({ __probeError: `executeJavaScript 실패: ${String((err && err.message) || err)}` }));
  return withTimeout(run, WAIT_JS, 'executeJavaScript');
}

async function until(win, source, timeoutMs) {
  const budget = timeoutMs || WAIT_UI;
  const deadline = Date.now() + budget;
  let last = null;
  while (Date.now() < deadline) {
    last = await js(win, source);
    if (last && last.__probeError) { await wait(250); continue; }
    if (last) return last;
    await wait(250);
  }
  log(`WAIT — ${budget}ms 안에 조건이 참이 되지 않았다: ${String(source).replace(/\s+/g, ' ').slice(0, 110)}`);
  return null;
}

function ctx(win) {
  return js(win, '(() => { const a = window.AthenaBacktestCanvas; return a ? a.getContext() : null; })()');
}

function invoke(win, channel, payload) {
  const arg = payload === undefined ? '' : `, ${JSON.stringify(payload)}`;
  return js(win, `window.athena.invoke(${JSON.stringify(channel)}${arg})`);
}

async function backendJson(method, pathText, body) {
  try {
    const res = await fetch(`${BACKEND}${pathText}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let parsed = null;
    try { parsed = await res.json(); } catch { parsed = null; }
    return { status: res.status, body: parsed, error: null };
  } catch (err) {
    return { status: 0, body: null, error: String((err && err.message) || err) };
  }
}

function sendChat(win, action) {
  try {
    win.webContents.send('athena:backtest-chat-action', action);
    return true;
  } catch (err) {
    log(`WARN — 채팅 액션 전송 실패: ${String((err && err.message) || err)}`);
    return false;
  }
}

function click(win, selector) {
  return js(win, `(() => {
    const n = document.querySelector(${JSON.stringify(selector)});
    if (!n) return false;
    n.click();
    return true;
  })()`);
}

function clickNth(win, selector, index) {
  return js(win, `(() => {
    const list = document.querySelectorAll(${JSON.stringify(selector)});
    const n = list[${Number(index)}];
    if (!n) return false;
    n.click();
    return true;
  })()`);
}

function clickByText(win, selector, text) {
  return js(win, `(() => {
    const list = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const n = list.find((b) => (b.textContent || '').trim() === ${JSON.stringify(text)});
    if (!n) return false;
    n.click();
    return true;
  })()`);
}

function clickLastCardButton(win, label) {
  return js(win, `(() => {
    const cards = document.querySelectorAll('#history .backtest-change');
    if (!cards.length) return false;
    const card = cards[cards.length - 1];
    const btn = Array.from(card.querySelectorAll('button'))
      .find((b) => (b.textContent || '').trim() === ${JSON.stringify(label)});
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
}

function countOf(win, selector) {
  return js(win, `document.querySelectorAll(${JSON.stringify(selector)}).length`);
}

// ---------- 폼 조작 ----------

function goTab(win, index) { return clickNth(win, `${R}.backtest-tab`, index); }
function goSubtab(win, index) { return clickNth(win, `${R}.backtest-subtab`, index); }

async function goDesignForm(win) {
  await goTab(win, 0);
  await wait(200);
  // 고르기 전에는 하위 탭이 없다 — 없는 탭을 누르지 않는다.
  const n = await countOf(win, `${R}.backtest-subtab`);
  if (n > 1) {
    await goSubtab(win, 1);
    await wait(200);
  }
}

function addSymbol(win, code) {
  return js(win, `(() => {
    const s = document.querySelector('${R}.backtest-symbol-add');
    if (!s) return false;
    s.value = ${JSON.stringify(code)};
    s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
}

async function clearSymbols(win) {
  for (let i = 0; i < 8; i += 1) {
    const removed = await click(win, `${R}.backtest-symbol-remove`);
    if (!removed) break;
    await wait(120);
  }
}

function setDates(win, from, to) {
  return js(win, `(() => {
    const inputs = Array.from(document.querySelectorAll('${R}.backtest-design .backtest-field-input'))
      .filter((i) => i.placeholder === 'YYYYMMDD');
    if (inputs.length < 2) return { ok: false, found: inputs.length };
    inputs[0].value = ${JSON.stringify(from)};
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].value = ${JSON.stringify(to)};
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, found: inputs.length };
  })()`);
}

// 프리셋 → 폼(종목·기간) → 지도. probe-backtest-full.js ensureRunnableForm과 같은 순서다.
async function ensureRunnableForm(win) {
  await click(win, `${R}.backtest-approval-cancel`);
  await click(win, `${R}.backtest-diag-discard`);
  await click(win, `${R}.backtest-error-back`);
  await wait(250);
  await goDesignForm(win);
  await clickByText(win, `${R}.backtest-runpath-item`, '폼');
  await wait(150);
  await clickNth(win, `${R}.backtest-preset-item`, 0);
  await wait(300);
  // 프리셋을 고르면 화면은 지도로 간다 — 종목·기간은 폼에서 채운다.
  await goSubtab(win, 1);
  await wait(250);
  const cur = await ctx(win);
  const symbols = cur && cur.spec ? cur.spec.symbols : null;
  if (!Array.isArray(symbols) || symbols.length !== 1 || symbols[0] !== STK) {
    await clearSymbols(win);
    await addSymbol(win, STK);
    await wait(300);
  }
  await setDates(win, FROM, TO);
  await wait(200);
  return ctx(win);
}

function waitRunOutcome(win, timeoutMs) {
  return until(win, `(() => {
    const api = window.AthenaBacktestCanvas;
    if (!api) return null;
    const c = api.getContext();
    if (!c) return null;
    if (c.view === 'running' || c.view === 'design') return null;
    return { view: c.view, tab: c.tab };
  })()`, timeoutMs || WAIT_RUN);
}

// ---------- 촬영 ----------

// capturePage()가 아직 커밋 안 된 프레임을 돌려주는 문제 — rAF 2회로 최신 프레임을 강제한다
// (phase4-traversal.js·probe-card-demo.js 관행).
async function settle(win) {
  await js(win, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await wait(250);
  await js(win, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}

async function shot(win, slug, factsSource, note) {
  const file = path.join(OUT_DIR, `${slug}.png`);
  let facts = null;
  if (factsSource) facts = await js(win, factsSource);
  await settle(win);
  let size = null;
  try {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(file, img.toPNG());
    const s = img.getSize();
    size = `${s.width}x${s.height}`;
  } catch (err) {
    report.failed.push(`${slug} — capturePage 실패: ${String((err && err.message) || err)}`);
    log(`FAIL — ${slug} capturePage: ${String((err && err.message) || err)}`);
    return null;
  }
  report.shots.push({ slug, file, size, note: note || null, facts });
  log(`SHOT ${slug} (${size}) ${safeJson(facts)}`);
  return file;
}

function fail(slug, reason) {
  report.failed.push(`${slug} — ${reason}`);
  log(`MISS — ${slug}: ${reason}`);
}

// 캔버스 패널을 굴려 그 요소를 프레임 안에 넣는다 — 지도 탭은 1000px보다 길어서
// 요약 지도(①~④)와 시각 편집기가 한 프레임에 같이 들어오지 않는다.
function scrollIntoView(win, selector, block) {
  return js(win, `(() => {
    const n = document.querySelector(${JSON.stringify(selector)});
    if (!n) return false;
    n.scrollIntoView({ block: ${JSON.stringify(block || 'center')} });
    return true;
  })()`);
}

// 코드 상자는 자기 스크롤을 따로 가진다(gutter·pre·textarea 셋을 같이 굴린다).
function scrollCodeToLitLine(win) {
  return js(win, `(() => {
    const root = document.getElementById('backtestCanvas');
    const lit = root.querySelector('.backtest-code-gutter .backtest-code-line.is-lit');
    if (!lit) return { ok: false, why: '켜진 줄이 없다' };
    const line = Number(lit.textContent);
    const top = Math.max(0, (line - 6) * 18);
    ['.backtest-code-textarea', '.backtest-code-pre', '.backtest-code-gutter'].forEach((sel) => {
      const n = root.querySelector(sel);
      if (n) n.scrollTop = top;
    });
    return { ok: true, line, top };
  })()`);
}

// 채팅 카드를 화면 안으로 끌어온다 — 이력 패널이 스크롤돼 있으면 카드가 프레임 밖이다.
function scrollLastCardIntoView(win) {
  return js(win, `(() => {
    const cards = document.querySelectorAll('#history .backtest-visual');
    if (!cards.length) return false;
    cards[cards.length - 1].scrollIntoView({ block: 'center' });
    return true;
  })()`);
}

// ---------- 본체 ----------

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  probeWin = shellWin;
  shellWin.setContentSize(WIDE_W, WIDE_H);
  shellWin.show();
  await wait(2200); // 렌더러 스크립트(canvas.js·chat.js) 로드 대기

  // ── 00 전제 ────────────────────────────────────────────────────────────────
  let ready = false;
  const readyDeadline = Date.now() + 90000;
  while (Date.now() < readyDeadline) {
    try {
      const res = await fetch(`${BACKEND}/ready`);
      if (res.status === 200) { ready = true; break; }
    } catch { /* 아직 안 떴다 */ }
    await wait(1500);
  }
  if (!ready) throw new PreconditionAbort(`백엔드(${BACKEND})가 /ready 200을 주지 않는다`);

  const covEnvelope = await invoke(
    shellWin, 'athena:backtest-coverage', { stk_cd: STK, period: 'day', adjusted: true },
  );
  const coverage = covEnvelope && covEnvelope.ok ? covEnvelope.data : null;
  if (!coverage || !(Number(coverage.rows) > 0)) {
    throw new PreconditionAbort(`${STK} 일봉 캐시가 비어 있다`);
  }
  TO = ENV_TO || coverage.last_dt || FALLBACK_TO;
  const bounded = `${Number(String(TO).slice(0, 4)) - 3}${String(TO).slice(4)}`;
  FROM = ENV_FROM
    || (coverage.first_dt ? (bounded > coverage.first_dt ? bounded : coverage.first_dt) : FALLBACK_FROM);
  report.range = { stk: STK, from: FROM, to: TO, rows: coverage.rows };
  log(`구간 ${STK} ${FROM}~${TO} (캐시 ${coverage.rows}봉)`);

  // ── 01 백테스트 모드 진입 · 기법 목록 ────────────────────────────────────
  await js(shellWin, "(() => { const n = document.getElementById('modeNavBacktest'); if (n) n.click(); return true; })()");
  await wait(600);
  // 보드 19: 첫 화면은 기법 목록이다. 고르기 전에는 설계 하위 탭이 없다.
  const presetList = await until(
    shellWin,
    `(() => {
      const items = document.querySelectorAll('${R}.backtest-preset-item');
      if (!items.length) return null;
      return {
        presets: items.length,
        title: (document.querySelector('${R}.backtest-technique-wrap .backtest-card-title') || {}).textContent || null,
        first: (items[0].textContent || '').slice(0, 40),
      };
    })()`,
    WAIT_PRESETS,
  );
  if (!presetList) fail('01-mode-empty', '프리셋 목록이 뜨지 않았다');
  await shot(shellWin, '01-mode-empty', `(() => {
    const c = window.AthenaBacktestCanvas.getContext();
    const root = document.getElementById('backtestCanvas');
    return {
      view: c.view,
      tab: c.tab,
      screen: c.screen,
      designTab: c.designTab,
      tabs: Array.from(root.querySelectorAll('.backtest-tab')).map((t) => t.textContent),
      subtabs: Array.from(root.querySelectorAll('.backtest-subtab')).map((t) => t.textContent),
      presets: document.querySelectorAll('${R}.backtest-preset-item').length,
    };
  })()`, '모드 진입 직후의 보드 19 기법 목록(하위 탭 없음, 모드 탭 3개)');

  // ── 02 지도 탭(요약 지도 + 시각 편집기) ────────────────────────────────────
  await ensureRunnableForm(shellWin);
  await goSubtab(shellWin, 0);
  const mapOpened = await until(shellWin, `(() => {
    const root = document.getElementById('backtestCanvas');
    const c = window.AthenaBacktestCanvas.getContext();
    if (c.designTab !== 'flow') return null;
    const nodes = root.querySelectorAll('.backtest-vis-node');
    if (!nodes.length) return null;
    return {
      numerals: Array.from(root.querySelectorAll('.backtest-flow-node.is-mine .backtest-flow-badge span'))
        .map((n) => n.textContent),
      target: (root.querySelector('.backtest-visual-target') || {}).textContent || null,
      paletteGroups: root.querySelectorAll('.backtest-vis-palette-group').length,
      nodeButtons: nodes.length,
      edges: root.querySelectorAll('.backtest-vis-edge').length,
      state: c.map.validation_state,
    };
  })()`, WAIT_VALIDATE);
  if (!mapOpened) fail('02-map-tab', '시각 편집기가 서지 않았다');
  // 검증 바가 실제 판정을 말하는 화면을 찍는다 — 진입 직후는 '아직 검증하지 않았습니다'다.
  await click(shellWin, `${R}.backtest-visual-validate`);
  const validated = await until(shellWin, `(() => {
    const root = document.getElementById('backtestCanvas');
    const c = window.AthenaBacktestCanvas.getContext();
    if (['valid', 'synced', 'invalid'].indexOf(c.map.validation_state) === -1) return null;
    return {
      state: c.map.validation_state,
      status: (root.querySelector('.backtest-visual-status-text') || {}).textContent || null,
      summaryTitle: (root.querySelector('.backtest-vis-summary-title') || {}).textContent || null,
    };
  })()`, WAIT_VALIDATE);
  if (!validated) fail('02-map-tab', '서버 검증이 끝나지 않았다(검증 바가 중간 상태)');
  await shot(shellWin, '02-map-tab', `(() => {
    const root = document.getElementById('backtestCanvas');
    const c = window.AthenaBacktestCanvas.getContext();
    return {
      designTab: c.designTab,
      numerals: Array.from(root.querySelectorAll('.backtest-flow-node.is-mine .backtest-flow-badge span')).map((n) => n.textContent),
      target: (root.querySelector('.backtest-visual-target') || {}).textContent || null,
      state: c.map.validation_state,
      status: (root.querySelector('.backtest-visual-status-text') || {}).textContent || null,
      summaryTitle: (root.querySelector('.backtest-vis-summary-title') || {}).textContent || null,
      paletteGroups: root.querySelectorAll('.backtest-vis-palette-group').length,
      nodes: root.querySelectorAll('.backtest-vis-node').length,
      edges: root.querySelectorAll('.backtest-vis-edge').length,
    };
  })()`, '[검증]을 눌러 서버 판정까지 간 지도 탭');

  // 같은 지도 탭의 아랫부분 — 요약 지도와 편집기는 1600x1000 한 프레임에 같이 안 들어온다.
  // 편집기 머리에 맞춰 굴린다: 'end'로 굴리면 캔버스 상자가 팔레트 높이만큼 늘어나 있어
  // 노드가 프레임 위로 빠지고 빈 격자만 남는다(2026-09-03 실측).
  await scrollIntoView(shellWin, `${R}.backtest-vis`, 'start');
  await wait(400);
  await shot(shellWin, '02b-map-editor', `(() => {
    const root = document.getElementById('backtestCanvas');
    return {
      paletteGroups: root.querySelectorAll('.backtest-vis-palette-group').length,
      paletteItems: root.querySelectorAll('.backtest-vis-palette-item').length,
      nodes: root.querySelectorAll('.backtest-vis-node').length,
      edges: root.querySelectorAll('.backtest-vis-edge').length,
      summaryTitle: (root.querySelector('.backtest-vis-summary-title') || {}).textContent || null,
      summaryDetail: (root.querySelector('.backtest-vis-summary-detail') || {}).textContent || null,
    };
  })()`, '같은 지도 탭을 아래로 굴린 프레임 — 팔레트·캔버스·검사기·검증(요약) 바');

  // ── 03 노드 검사기 ─────────────────────────────────────────────────────────
  const picked = await js(shellWin, `(() => {
    const card = document.querySelector('${R}.backtest-vis-node[data-node-id="cond-exit-1"]');
    if (!card) return { ok: false, why: 'cond-exit-1 칸이 없다' };
    card.click();
    return { ok: true, label: (card.querySelector('.backtest-vis-node-title') || {}).textContent || null };
  })()`);
  const inspector = await until(shellWin, `(() => {
    const root = document.getElementById('backtestCanvas');
    const sel = root.querySelector('.backtest-vis-node.is-selected');
    const head = root.querySelector('.backtest-vis-inspector-head');
    if (!sel || !head) return null;
    return {
      selected: sel.getAttribute('data-node-id'),
      head: (head.textContent || '').slice(0, 60),
      fields: root.querySelectorAll('.backtest-vis-inspector .backtest-vis-field').length,
    };
  })()`, WAIT_UI);
  if (!inspector) fail('03-node-inspector', `검사기가 뜨지 않았다(${safeJson(picked)})`);
  await shot(shellWin, '03-node-inspector', `(() => {
    const root = document.getElementById('backtestCanvas');
    const sel = root.querySelector('.backtest-vis-node.is-selected');
    return {
      selected: sel ? sel.getAttribute('data-node-id') : null,
      label: sel ? (sel.querySelector('.backtest-vis-node-title') || {}).textContent : null,
      fields: root.querySelectorAll('.backtest-vis-inspector .backtest-vis-field').length,
    };
  })()`, '청산 조건 칸을 골라 검사기가 그 칸의 입력을 그린 상태');

  // ── 04 폼 탭 ───────────────────────────────────────────────────────────────
  await goSubtab(shellWin, 1);
  const form = await until(shellWin, `(() => {
    const root = document.getElementById('backtestCanvas');
    const c = window.AthenaBacktestCanvas.getContext();
    if (c.designTab !== 'form') return null;
    const chips = root.querySelectorAll('.backtest-symbol-chip, .backtest-symbol-remove');
    return {
      designTab: c.designTab,
      symbols: c.spec ? c.spec.symbols : null,
      chips: chips.length,
      cards: root.querySelectorAll('.backtest-card').length,
    };
  })()`, WAIT_UI);
  if (!form) fail('04-form-tab', '폼 탭이 뜨지 않았다');
  await shot(shellWin, '04-form-tab', `(() => {
    const root = document.getElementById('backtestCanvas');
    const c = window.AthenaBacktestCanvas.getContext();
    return {
      designTab: c.designTab,
      name: c.spec ? c.spec.name : null,
      symbols: c.spec ? c.spec.symbols : null,
      from: c.spec ? c.spec.from : null,
      to: c.spec ? c.spec.to : null,
      cards: root.querySelectorAll('.backtest-card').length,
    };
  })()`, '프리셋이 채운 지표·조건과 대상·기간을 칸으로 보는 폼 탭');

  // ── 05 코드 탭([코드 열기]) ────────────────────────────────────────────────
  await goSubtab(shellWin, 0);
  await wait(300);
  await click(shellWin, `${R}.backtest-visual-open-code`);
  await click(shellWin, `${R}.backtest-map-open-code`);
  const codeTab = await until(shellWin, `(() => {
    const root = document.getElementById('backtestCanvas');
    const c = window.AthenaBacktestCanvas.getContext();
    if (c.designTab !== 'code' || !c.code.source) return null;
    if (c.code.source.indexOf('def signals(df, p):') === -1) return null;
    return {
      lines: c.code.lines,
      runPath: c.runPath,
      banner: (root.querySelector('.backtest-code-frommap') || {}).textContent || null,
      gutter: root.querySelectorAll('.backtest-code-gutter .backtest-code-line').length,
    };
  })()`, WAIT_VALIDATE);
  if (!codeTab) fail('05-code-tab', '[코드 열기]가 생성 코드를 세우지 못했다');
  await shot(shellWin, '05-code-tab', `(() => {
    const root = document.getElementById('backtestCanvas');
    const c = window.AthenaBacktestCanvas.getContext();
    return {
      designTab: c.designTab,
      lines: c.code.lines,
      runPath: c.runPath,
      banner: (root.querySelector('.backtest-code-frommap') || {}).textContent || null,
    };
  })()`, '지도가 만든 파이썬을 여는 코드 탭');

  // 왕복의 base가 될 활성 버전 하나를 남긴다(적용이 "그 사이 다른 수정"을 판정할 기준).
  const beforeSaveVersionId = await js(shellWin, '(window.AthenaBacktestCanvas.getContext().code.activeVersionId)');
  await click(shellWin, `${R}.backtest-code-save`);
  const baseSaved = await until(shellWin, `(() => {
    const c = window.AthenaBacktestCanvas.getContext();
    if (!c.code.strategyId || !c.code.activeVersionId) return null;
    if (c.code.activeVersionId === ${JSON.stringify(beforeSaveVersionId)}) return null;
    return { strategyId: c.code.strategyId, activeVersionId: c.code.activeVersionId };
  })()`, WAIT_VALIDATE);
  report.baseSaved = baseSaved;
  if (!baseSaved) log('WARN — [이 코드로 저장]이 활성 버전을 만들지 못했다(이력·적용 판정에 영향)');

  // ── 06 오류 상태(청산 조건의 right 입력 엣지를 끊는다) ────────────────────
  await goSubtab(shellWin, 0);
  await wait(400);
  const cut = await js(shellWin, `(() => {
    const root = document.getElementById('backtestCanvas');
    const card = root.querySelector('.backtest-vis-node[data-node-id="cond-exit-1"]');
    if (!card) return { ok: false, why: 'cond-exit-1 칸이 없다' };
    card.click();
    const sel = root.querySelector(
      '.backtest-vis-inspector select.backtest-vis-select[data-node-id="cond-exit-1"][data-port="right"]',
    );
    if (!sel) return { ok: false, why: '검사기에 오른쪽 입력 칸이 없다' };
    const had = sel.value;
    sel.value = '';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, had };
  })()`);
  const broken = await until(shellWin, `(() => {
    const root = document.getElementById('backtestCanvas');
    const c = window.AthenaBacktestCanvas.getContext();
    if (c.map.validation_state !== 'invalid') return null;
    const run = root.querySelector('.backtest-run-button');
    const n = (sel) => root.querySelectorAll(sel).length;
    return {
      state: c.map.validation_state,
      codes: c.map.diagnostics.map((d) => d.code),
      node: n('.backtest-vis-node.is-error[data-node-id="cond-exit-1"]'),
      port: n('.backtest-vis-port[data-node-id="cond-exit-1"][data-port="right"][data-diag-code="BTG-PORT-002"]'),
      inspectorError: n('.backtest-vis-inspector-error'),
      summary: n('.backtest-vis-summary[data-diag-code="BTG-PORT-002"]'),
      errorCode: (root.querySelector('.backtest-vis-error-code') || {}).textContent || null,
      runText: run ? (run.textContent || '').trim() : null,
      runDisabled: run ? !!run.disabled : null,
    };
  })()`, WAIT_VALIDATE);
  if (!broken) fail('06-invalid', `엣지를 끊어도 invalid가 되지 않았다(${safeJson(cut)})`);
  // 오류가 붙는 네 곳(칸·포트·검사기·요약 바)은 편집기 안이다 — 그 자리를 프레임에 넣는다.
  await scrollIntoView(shellWin, `${R}.backtest-vis-node.is-error`, 'center');
  await wait(400);
  await shot(shellWin, '06-invalid', `(() => {
    const root = document.getElementById('backtestCanvas');
    const c = window.AthenaBacktestCanvas.getContext();
    const run = root.querySelector('.backtest-run-button');
    return {
      state: c.map.validation_state,
      codes: c.map.diagnostics.map((d) => d.code),
      errorCode: (root.querySelector('.backtest-vis-error-code') || {}).textContent || null,
      runText: run ? (run.textContent || '').trim() : null,
      runDisabled: run ? !!run.disabled : null,
    };
  })()`, '청산 조건의 오른쪽 입력을 끊어 BTG-PORT-002가 네 곳에 함께 선 상태');

  // ── 07 오류 칸에서 Enter → 미실행 미리보기 ────────────────────────────────
  await js(shellWin, `(() => {
    const card = document.querySelector('${R}.backtest-vis-node[data-node-id="cond-exit-1"]');
    if (!card) return false;
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  const preview = await until(shellWin, `(() => {
    const root = document.getElementById('backtestCanvas');
    const c = window.AthenaBacktestCanvas.getContext();
    if (c.designTab !== 'code') return null;
    const ta = root.querySelector('.backtest-code-textarea');
    const lit = Array.from(root.querySelectorAll('.backtest-code-gutter .backtest-code-line.is-lit'))
      .map((l) => Number(l.textContent));
    if (!ta || !lit.length) return null;
    const lines = String(ta.value).split('\\n');
    return {
      ribbonKind: (root.querySelector('.backtest-code-ribbon-kind') || {}).textContent || null,
      ribbonLabel: (root.querySelector('.backtest-code-ribbon-label') || {}).textContent || null,
      ribbonCode: (root.querySelector('.backtest-code-ribbon-code') || {}).textContent || null,
      readOnly: !!ta.readOnly,
      lit,
      missing: lit.map((k) => lines[k - 1] || '').some((t) => t.indexOf('__MISSING__') !== -1),
    };
  })()`, WAIT_VALIDATE);
  if (!preview) fail('07-error-to-code', '오류 칸 Enter가 코드 미리보기로 내려가지 않았다');
  // 켜진 줄(__MISSING__)은 코드 상자 안에서 아래쪽이다 — 리본과 그 줄을 한 프레임에 담는다.
  const scrolled = await scrollCodeToLitLine(shellWin);
  report.litScroll = scrolled;
  await wait(300);
  await shot(shellWin, '07-error-to-code', `(() => {
    const root = document.getElementById('backtestCanvas');
    const c = window.AthenaBacktestCanvas.getContext();
    const ta = root.querySelector('.backtest-code-textarea');
    return {
      designTab: c.designTab,
      ribbonKind: (root.querySelector('.backtest-code-ribbon-kind') || {}).textContent || null,
      ribbonLabel: (root.querySelector('.backtest-code-ribbon-label') || {}).textContent || null,
      ribbonCode: (root.querySelector('.backtest-code-ribbon-code') || {}).textContent || null,
      readOnly: ta ? !!ta.readOnly : null,
      lit: Array.from(root.querySelectorAll('.backtest-code-gutter .backtest-code-line.is-lit')).map((l) => Number(l.textContent)),
    };
  })()`, '오류 칸에서 Enter로 내려간 미실행 미리보기');

  // 지도로 되돌린다 — 질문은 지금 화면의 그래프로 만든다.
  await click(shellWin, `${R}.backtest-code-ribbon-back`);
  await until(shellWin, `(() => {
    const c = window.AthenaBacktestCanvas.getContext();
    return c.designTab === 'flow' ? true : null;
  })()`, WAIT_UI);

  // ── 08 질문 카드(visual_question) ──────────────────────────────────────────
  const graphForAsk = await js(shellWin, '(() => { const c = window.AthenaBacktestCanvas.getContext(); return c.map.graph; })()');
  const asked = await backendJson('POST', '/api/v1/backtest/visual/question', { graph: graphForAsk });
  const question = asked && asked.body ? asked.body.question : null;
  const historyBefore = await countOf(shellWin, '#history .backtest-visual');
  if (!question) fail('08-question-card', `POST /visual/question이 질문을 주지 않았다(status ${asked && asked.status})`);
  sendChat(shellWin, { kind: 'visual_question', payload: question });
  const questionCard = await until(shellWin, `(() => {
    const cards = document.querySelectorAll('#history .backtest-visual');
    if (!cards.length) return null;
    const card = cards[cards.length - 1];
    const pill = card.querySelector('.routine-draft-pill.is-filled');
    if (!pill || pill.textContent !== '한 가지만 확인할게요') return null;
    return {
      cards: cards.length,
      title: pill.textContent,
      choices: card.querySelectorAll('.backtest-visual-choice').length,
      makeDisabled: Array.from(card.querySelectorAll('button'))
        .filter((b) => (b.textContent || '').trim() === '수정안 만들기').map((b) => !!b.disabled)[0],
    };
  })()`, WAIT_VALIDATE);
  if (!questionCard) fail('08-question-card', '질문 카드가 채팅에 서지 않았다');
  await scrollLastCardIntoView(shellWin);
  await shot(shellWin, '08-question-card', `(() => {
    const cards = document.querySelectorAll('#history .backtest-visual');
    const card = cards[cards.length - 1];
    const c = window.AthenaBacktestCanvas.getContext();
    return {
      cards: cards.length,
      title: card ? (card.querySelector('.routine-draft-pill.is-filled') || {}).textContent : null,
      choices: card ? card.querySelectorAll('.backtest-visual-choice').length : 0,
      pendingQuestion: c.map.pendingQuestion ? c.map.pendingQuestion.code : null,
      state: c.map.validation_state,
    };
  })()`, '오류를 고칠 길을 묻는 질문 카드 — 고르기 전에는 [수정안 만들기]가 잠겨 있다');

  // ── 09 수정안(패치) 카드 ───────────────────────────────────────────────────
  await js(shellWin, `(() => {
    const cards = document.querySelectorAll('#history .backtest-visual');
    const card = cards[cards.length - 1];
    if (!card) return false;
    const pick = Array.from(card.querySelectorAll('.backtest-visual-choice'))
      .filter((b) => Array.from(b.querySelectorAll('.routine-draft-pill'))
        .some((p) => p.textContent === '권장'))[0];
    if (!pick) return false;
    pick.click();
    return true;
  })()`);
  await wait(250);
  await clickLastCardButton(shellWin, '수정안 만들기');
  const patchCard = await until(shellWin, `(() => {
    const cards = document.querySelectorAll('#history .backtest-visual');
    if (!cards.length) return null;
    const card = cards[cards.length - 1];
    const pill = card.querySelector('.routine-draft-pill.is-filled');
    if (!pill || pill.textContent !== '그래프 + 코드 패치') return null;
    return {
      cards: cards.length,
      diffRows: card.querySelectorAll('.backtest-diff-row').length,
      addedRows: card.querySelectorAll('.backtest-diff-row.is-add').length,
      buttons: Array.from(card.querySelectorAll('button')).map((b) => (b.textContent || '').trim()),
    };
  })()`, WAIT_VALIDATE);
  if (!patchCard) fail('09-patch-card', '[수정안 만들기]가 패치 카드를 내지 않았다');
  await scrollLastCardIntoView(shellWin);
  await shot(shellWin, '09-patch-card', `(() => {
    const cards = document.querySelectorAll('#history .backtest-visual');
    const card = cards[cards.length - 1];
    const c = window.AthenaBacktestCanvas.getContext();
    return {
      title: card ? (card.querySelector('.routine-draft-pill.is-filled') || {}).textContent : null,
      diffRows: card ? card.querySelectorAll('.backtest-diff-row').length : 0,
      buttons: card ? Array.from(card.querySelectorAll('button')).map((b) => (b.textContent || '').trim()) : [],
      pendingPatch: c.map.pendingPatch ? c.map.pendingPatch.patch_id : null,
      state: c.map.validation_state,
    };
  })()`, '권장 선택으로 만든 그래프+코드 패치 카드(diff) — 아직 아무것도 적용되지 않았다');

  // ── 10 적용 → 동기화 완료 ─────────────────────────────────────────────────
  await clickLastCardButton(shellWin, '적용하고 시각 설계로 돌아가기');
  const syncedCard = await until(shellWin, `(() => {
    const cards = document.querySelectorAll('#history .backtest-visual');
    if (cards.length <= ${Number(historyBefore) + 2}) return null;
    const card = cards[cards.length - 1];
    const c = window.AthenaBacktestCanvas.getContext();
    const root = document.getElementById('backtestCanvas');
    return {
      pills: Array.from(card.querySelectorAll('.routine-draft-pill')).map((p) => (p.textContent || '').trim()),
      state: c.map.validation_state,
      designTab: c.designTab,
      status: (root.querySelector('.backtest-visual-status-text') || {}).textContent || null,
      summaryTitle: (root.querySelector('.backtest-vis-summary-title') || {}).textContent || null,
      lastChange: c.lastChange ? (c.lastChange.errors || []) : null,
    };
  })()`, WAIT_VALIDATE);
  if (!syncedCard) fail('10-synced', '[적용]이 새 카드를 내지 않았다');
  else if (syncedCard.pills[0] !== '동기화 완료') {
    fail('10-synced', `적용이 '동기화 완료'가 아니었다: ${safeJson(syncedCard.pills)} / ${safeJson(syncedCard.lastChange)}`);
  }
  await scrollLastCardIntoView(shellWin);
  await shot(shellWin, '10-synced', `(() => {
    const cards = document.querySelectorAll('#history .backtest-visual');
    const card = cards[cards.length - 1];
    const c = window.AthenaBacktestCanvas.getContext();
    const root = document.getElementById('backtestCanvas');
    return {
      pills: card ? Array.from(card.querySelectorAll('.routine-draft-pill')).map((p) => (p.textContent || '').trim()) : [],
      state: c.map.validation_state,
      designTab: c.designTab,
      status: (root.querySelector('.backtest-visual-status-text') || {}).textContent || null,
      summaryTitle: (root.querySelector('.backtest-vis-summary-title') || {}).textContent || null,
    };
  })()`, '[적용하고 시각 설계로 돌아가기] 뒤의 동기화 완료 카드 + 지도 탭');

  // ── 11 실행 → 결과 탭 ─────────────────────────────────────────────────────
  await goTab(shellWin, 0);
  await goSubtab(shellWin, 1);
  await setDates(shellWin, FROM, TO);
  await wait(300);
  await click(shellWin, `${R}.backtest-run-button`);
  const ran = await waitRunOutcome(shellWin, WAIT_RUN);
  if (!ran || ran.view !== 'result') fail('11-result', `실행이 결과 화면까지 가지 않았다(${safeJson(ran)})`);
  await goTab(shellWin, 1);
  const result = await until(shellWin, `(() => {
    const root = document.getElementById('backtestCanvas');
    const c = window.AthenaBacktestCanvas.getContext();
    if (c.tab !== 'result') return null;
    const metrics = root.querySelectorAll('.backtest-metric, .backtest-result-metric');
    if (!metrics.length && !root.querySelector('.backtest-result')) return null;
    return { tab: c.tab, view: c.view, metrics: metrics.length, runId: c.lastResult ? c.lastResult.runId : null };
  })()`, WAIT_VALIDATE);
  if (!result) fail('11-result', '결과 탭이 값을 그리지 않았다');
  await shot(shellWin, '11-result', `(() => {
    const root = document.getElementById('backtestCanvas');
    const c = window.AthenaBacktestCanvas.getContext();
    return {
      tab: c.tab, view: c.view,
      runId: c.lastResult ? c.lastResult.runId : null,
      metrics: root.querySelectorAll('.backtest-metric, .backtest-result-metric').length,
      text: (root.textContent || '').replace(/\\s+/g, ' ').slice(0, 160),
    };
  })()`, '실행이 끝난 뒤의 결과 탭');

  // ── 12 이력 탭 ─────────────────────────────────────────────────────────────
  await goTab(shellWin, 2);
  const history = await until(shellWin, `(() => {
    const root = document.getElementById('backtestCanvas');
    const c = window.AthenaBacktestCanvas.getContext();
    if (c.tab !== 'history') return null;
    const versions = Array.from(root.querySelectorAll('.backtest-version-row'));
    const runs = root.querySelectorAll('.backtest-history-row').length;
    if (!versions.length && !runs) return null;
    return {
      tab: c.tab,
      runs,
      versions: versions.map((v) => ({
        no: (v.querySelector('.backtest-version-no') || {}).textContent || null,
        origin: (v.querySelector('.backtest-version-origin') || {}).textContent || null,
        active: !!v.querySelector('.backtest-version-active'),
      })),
    };
  })()`, WAIT_VALIDATE);
  if (!history) fail('12-history', '이력 탭이 목록을 그리지 않았다');
  else if (!(history.versions || []).some((v) => v.origin === 'visual')) {
    fail('12-history', `버전 목록에 origin=visual 행이 없다: ${safeJson(history.versions)}`);
  }
  await shot(shellWin, '12-history', `(() => {
    const root = document.getElementById('backtestCanvas');
    const c = window.AthenaBacktestCanvas.getContext();
    return {
      tab: c.tab,
      runs: root.querySelectorAll('.backtest-history-row').length,
      versions: Array.from(root.querySelectorAll('.backtest-version-row')).map((v) => ({
        no: (v.querySelector('.backtest-version-no') || {}).textContent || null,
        origin: (v.querySelector('.backtest-version-origin') || {}).textContent || null,
        active: !!v.querySelector('.backtest-version-active'),
      })),
    };
  })()`, '실행 이력과 버전 목록(origin=visual 행 포함)');

  // ── 13 코드가 지도보다 앞섬 ───────────────────────────────────────────────
  await goTab(shellWin, 0);
  await goSubtab(shellWin, 0);
  await wait(300);
  await click(shellWin, `${R}.backtest-visual-open-code`);
  await click(shellWin, `${R}.backtest-map-open-code`);
  await until(shellWin, `(() => {
    const c = window.AthenaBacktestCanvas.getContext();
    return (c.designTab === 'code' && c.code.source) ? true : null;
  })()`, WAIT_VALIDATE);
  const edited = await js(shellWin, `(() => {
    const ta = document.querySelector('${R}.backtest-code-textarea');
    if (!ta) return { ok: false, why: '편집기가 없다' };
    if (ta.readOnly) return { ok: false, why: '편집기가 읽기 전용이다(미실행 미리보기)' };
    ta.value = ta.value + '\\n# showcase-hand-edit';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true };
  })()`);
  const ahead = await until(shellWin, `(() => {
    const box = document.querySelector('${R}.backtest-code-ahead');
    if (!box) return null;
    return {
      text: (box.querySelector('.backtest-code-ahead-text') || {}).textContent || null,
      buttons: Array.from(box.querySelectorAll('button')).map((b) => (b.textContent || '').trim()),
    };
  })()`, WAIT_UI);
  if (!ahead) fail('13-code-ahead', `손 편집이 갈래를 세우지 않았다(${safeJson(edited)})`);
  await shot(shellWin, '13-code-ahead', `(() => {
    const box = document.querySelector('${R}.backtest-code-ahead');
    const c = window.AthenaBacktestCanvas.getContext();
    return {
      designTab: c.designTab,
      text: box ? (box.querySelector('.backtest-code-ahead-text') || {}).textContent : null,
      buttons: box ? Array.from(box.querySelectorAll('button')).map((b) => (b.textContent || '').trim()) : [],
    };
  })()`, '생성 코드를 손으로 고쳤을 때 서는 두 갈래');

  // ── 14 좁은 창(860px) ─────────────────────────────────────────────────────
  await click(shellWin, `${R}.backtest-code-ahead-regraph`);
  await until(shellWin, `(() => {
    const c = window.AthenaBacktestCanvas.getContext();
    return c.designTab === 'flow' ? true : null;
  })()`, WAIT_VALIDATE);
  shellWin.setContentSize(NARROW_W, WIDE_H);
  await wait(1200);
  await goTab(shellWin, 0);
  await goSubtab(shellWin, 0);
  const narrow = await until(shellWin, `(() => {
    const root = document.getElementById('backtestCanvas');
    const vis = root.querySelector('.backtest-vis');
    if (!vis) return null;
    return {
      rootClass: vis.className,
      isNarrow: vis.className.indexOf('is-narrow') !== -1,
      drawerToggles: root.querySelectorAll('.backtest-vis-drawer-toggle').length,
      palette: root.querySelectorAll('.backtest-vis-palette').length,
      inspector: root.querySelectorAll('.backtest-vis-inspector').length,
      width: root.getBoundingClientRect().width,
    };
  })()`, WAIT_VALIDATE);
  if (!narrow) fail('14-narrow', '좁은 창에서 편집기를 읽지 못했다');
  else if (!narrow.isNarrow) {
    fail('14-narrow', `창 폭 ${NARROW_W}px에서도 is-narrow가 붙지 않는다 — setNarrow()를 부르는 배선이 앱에 없다(편집기 API만 존재)`);
  }
  await shot(shellWin, '14-narrow', `(() => {
    const root = document.getElementById('backtestCanvas');
    const vis = root.querySelector('.backtest-vis');
    return {
      rootClass: vis ? vis.className : null,
      drawerToggles: root.querySelectorAll('.backtest-vis-drawer-toggle').length,
      palette: root.querySelectorAll('.backtest-vis-palette').length,
      inspector: root.querySelectorAll('.backtest-vis-inspector').length,
      width: root.getBoundingClientRect().width,
    };
  })()`, `창 폭 ${NARROW_W}px의 지도 탭`);

  shellWin.setContentSize(WIDE_W, WIDE_H);
}

// ---------- 마무리 ----------

async function finish() {
  if (outcome.finished) return;
  outcome.finished = true;
  report.finishedAt = new Date().toISOString();
  report.fatal = outcome.fatal;
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'showcase.json'), JSON.stringify(report, null, 1));
  } catch (err) {
    console.error('[showcase] 리포트 저장 실패:', String((err && err.message) || err));
  }
  log(`DONE — 찍은 장수 ${report.shots.length}, 못 채운 상태 ${report.failed.length}`);
  report.failed.forEach((f) => log(`  · ${f}`));
  try { if (probeWin && !probeWin.isDestroyed()) probeWin.destroy(); } catch { /* 이미 닫혔다 */ }
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); }
  catch { /* 다음 실행은 새 디렉터리다 */ }
  app.exit(report.fatal ? 1 : 0);
}

process.on('unhandledRejection', (reason) => {
  const text = String((reason && reason.stack) || (reason && reason.message) || reason);
  console.error('[showcase] 처리되지 않은 거절:', text);
  outcome.fatal = outcome.fatal || `unhandledRejection: ${text}`;
  void finish();
});

process.on('uncaughtException', (err) => {
  const text = String((err && err.stack) || err);
  console.error('[showcase] 잡히지 않은 예외:', text);
  outcome.fatal = outcome.fatal || `uncaughtException: ${text}`;
  void finish();
});

app.whenReady().then(async () => {
  try {
    await main();
  } catch (err) {
    const text = String((err && err.stack) || err);
    console.error('[showcase] 프로브 오류:', text);
    outcome.fatal = text;
  } finally {
    await finish();
  }
});
