'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROUTES, STEP_KINDS, STRUCTURE_KINDS } = require('./paper-screen-routes.js');
const { MODES } = require('./live-full-catalog.js');
const { PHRASES } = require('./paper-screen-phrases.generated.js');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LEDGER_DIR = path.join(REPO_ROOT, 'backend', 'ref', 'paper-ledger');
const manifest = require(path.join(LEDGER_DIR, 'manifest.json'));

const screenBoards = new Map(manifest.boards.filter((b) => b.role === 'screen').map((b) => [b.id, b]));
const ledger = (boardId) => JSON.parse(fs.readFileSync(
  path.join(LEDGER_DIR, screenBoards.get(boardId).page, `${boardId}.json`), 'utf8'));

const shellHtml = fs.readFileSync(path.join(__dirname, '..', 'shell.html'), 'utf8');
const orbHtml = fs.readFileSync(path.join(__dirname, '..', 'orb.html'), 'utf8');

// ---------- 표의 모양 ----------

test('every route targets a distinct board the manifest calls a screen', () => {
  const seen = new Set();
  for (const route of ROUTES) {
    assert.ok(screenBoards.has(route.board), `${route.board}는 role==="screen"이 아니다`);
    assert.equal(seen.has(route.board), false, `${route.board}가 두 번 있다`);
    seen.add(route.board);
  }
});

test('the seed table is the eight boards the plan asks for — agent 4 and screen 4', () => {
  assert.equal(ROUTES.length, 8);
  const byPage = {};
  for (const route of ROUTES) {
    const page = screenBoards.get(route.board).page;
    byPage[page] = (byPage[page] ?? 0) + 1;
  }
  assert.deepEqual(byPage, { 'A-2': 4, '1-0': 3, 'D-2': 1 });
});

test('every route renders in a window the app actually has', () => {
  for (const route of ROUTES) assert.ok(['shell', 'orb'].includes(route.window), route.board);
});

// ---------- reach 어휘가 닫혀 있다 ----------

test('every reach step uses a declared verb and carries exactly its declared arguments', () => {
  for (const route of ROUTES) {
    assert.ok(Array.isArray(route.reach) && route.reach.length > 0, `${route.board} reach 없음`);
    for (const step of route.reach) {
      const required = STEP_KINDS[step.do];
      assert.ok(required, `${route.board}: 어휘 밖 스텝 ${step.do}`);
      const given = Object.keys(step).filter((k) => k !== 'do').sort();
      assert.deepEqual(given, [...required].sort(), `${route.board} ${step.do}`);
    }
  }
});

test('an eval escape hatch would have to say why — none of the seed routes needs one', () => {
  assert.deepEqual(STEP_KINDS.eval, ['js', 'why']);
  assert.deepEqual(ROUTES.filter((r) => r.reach.some((s) => s.do === 'eval')), []);
});

test('every mode step names a mode the shell can actually switch to', () => {
  const views = new Set(MODES.map((m) => m.view));
  for (const route of ROUTES) {
    for (const step of route.reach.filter((s) => s.do === 'mode')) {
      assert.ok(views.has(step.view), `${route.board}: 모드 ${step.view}가 없다`);
    }
  }
});

// ---------- 셀렉터가 실재한다 (§4.4 규칙 1의 축소판) ----------

test('every DOM id literal in a route exists in shell.html or orb.html', () => {
  const html = shellHtml + orbHtml;
  const selectors = [];
  for (const route of ROUTES) {
    selectors.push(route.root);
    for (const step of route.reach) if (step.selector) selectors.push(step.selector);
    for (const check of route.structure) selectors.push(check.selector);
  }
  for (const selector of selectors) {
    for (const id of selector.match(/#[A-Za-z][\w-]*/g) ?? []) {
      assert.ok(html.includes(`id="${id.slice(1)}"`), `${selector}: ${id}가 마크업에 없다`);
    }
  }
});

test('the data attributes the reach steps click are the ones the app writes', () => {
  // 값이 아니라 키로 집는 관례(shell.html data-view)를 캔버스·설정도 따르는지 잠근다.
  assert.match(fs.readFileSync(path.join(__dirname, 'agent-canvas.js'), 'utf8'), /btn\.setAttribute\('data-view', view\.key\);/);
  assert.match(fs.readFileSync(path.join(__dirname, 'settings-cards.js'), 'utf8'), /b\.setAttribute\('data-key', item\.key\);/);
});

// ---------- phrases (§4.4 규칙 4·5) ----------

test('every phrase is a text Paper really draws on that board', () => {
  for (const route of ROUTES) {
    const texts = new Set(ledger(route.board).texts.map((t) => String(t.text).trim()));
    for (const phrase of route.phrases) {
      assert.ok(texts.has(phrase), `${route.board}: 원장에 없는 문구 ${JSON.stringify(phrase)}`);
    }
  }
});

test('every phrase survived the generator, so none of them is a data value', () => {
  for (const route of ROUTES) {
    const candidates = new Set(PHRASES[route.board].phrases);
    for (const phrase of route.phrases) {
      assert.ok(candidates.has(phrase),
        `${route.board}: ${JSON.stringify(phrase)}는 E1~E7에 걸린 값이거나 생성물에 없다`);
    }
  }
});

test('each route carries 3 to 7 phrases', () => {
  for (const route of ROUTES) {
    assert.ok(route.phrases.length >= 3, `${route.board}: ${route.phrases.length}개는 공허 통과한다`);
    assert.ok(route.phrases.length <= 7, `${route.board}: ${route.phrases.length}개는 너무 잘 깨진다`);
    assert.equal(new Set(route.phrases).size, route.phrases.length, `${route.board}: 중복 문구`);
  }
});

// ---------- structure (§4.3) ----------

test('every structure check uses one of the three allowed shapes', () => {
  for (const route of ROUTES) {
    assert.ok(Array.isArray(route.structure), route.board);
    for (const check of route.structure) {
      assert.ok(STRUCTURE_KINDS.includes(check.what), `${route.board}: ${check.what}`);
      assert.equal(typeof check.selector, 'string');
      if (check.what === 'count') assert.equal(typeof check.equals, 'number');
      if (check.what === 'order') assert.ok(Array.isArray(check.equals));
      if (check.what === 'absent') assert.equal('equals' in check, false);
    }
  }
});
