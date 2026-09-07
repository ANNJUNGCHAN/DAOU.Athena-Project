'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MODES,
  SETTINGS_NAV,
  PAPER_CHROME,
  LOCKED_CLICKS,
  LIVE_QUERIES,
  SAFE_CLICK_IDS,
  VERIFY_SUITE,
  PAPER_SUITE,
  queryVerdict,
} = require('./live-full-catalog');

const appDir = path.join(__dirname, '..');

test('live-full catalog locks five modes to shell.html nav and canvas ids', () => {
  const shell = fs.readFileSync(path.join(appDir, 'shell.html'), 'utf8');
  assert.equal(MODES.length, 5);
  for (const mode of MODES) {
    assert.match(shell, new RegExp(`id="${mode.navId}"`));
    assert.match(shell, new RegExp(`id="${mode.canvasId}"`));
    assert.match(shell, new RegExp(`data-view="${mode.view}"`));
  }
});

test('live-full catalog paper chrome matches controller CHAT_HEAD_COPY and chat.css empty copy', () => {
  const controller = fs.readFileSync(path.join(__dirname, 'graph-mode', 'controller.js'), 'utf8');
  const chatCss = fs.readFileSync(path.join(appDir, 'chat.css'), 'utf8');
  assert.match(controller, /title: '그래프에게 묻기'/);
  assert.match(controller, /sub: '답이 캔버스를 바꿉니다'/);
  assert.match(controller, /title: '기법에게 묻기'/);
  assert.match(controller, /title: '아테나 · 플러그인 대화'/);
  assert.equal(PAPER_CHROME.summary.headerHidden, true);
  assert.equal(PAPER_CHROME.agent.headerHidden, true);
  assert.equal(PAPER_CHROME.graph.title, '그래프에게 묻기');
  assert.equal(PAPER_CHROME.plugin.title, '아테나 · 플러그인 대화');
  assert.equal(PAPER_CHROME.backtest.emptyHistory, '아직 고른 기법이 없습니다');
  assert.match(chatCss, /아직 고른 기법이 없습니다/);
});

test('live-full catalog settings nav fourth item is 성향・이력', () => {
  const settings = fs.readFileSync(path.join(__dirname, 'settings-cards.js'), 'utf8');
  assert.deepEqual(SETTINGS_NAV.map((item) => item.label), ['화면', '계좌', '모델', '성향・이력']);
  assert.match(settings, /label: '성향・이력'/);
});

test('live-full catalog locked clicks cover real orders and kiumi five faces', () => {
  assert.ok(LOCKED_CLICKS.some((item) => item.id === 'order-submit'));
  assert.ok(LOCKED_CLICKS.some((item) => item.id === 'kiumi-five-faces'));
  assert.ok(LIVE_QUERIES.some((item) => item.id === 'QA-MULTI-SCREEN' && /시세랑 호가/.test(item.question)));
  for (const id of SAFE_CLICK_IDS) {
    assert.equal(typeof id, 'string');
    assert.ok(id.length > 0);
  }
});

test('expectCard:false 질의도 실패·타임아웃을 통과로 쓰지 않는다', () => {
  const fin = LIVE_QUERIES.find((item) => item.id === 'QA-FIN');
  const quote = LIVE_QUERIES.find((item) => item.id === 'QA-QUOTE');
  assert.equal(queryVerdict(fin, { result: { ok: false, error: 'query timeout' }, painted: false, rest: false, usedModel: false }), false);
  assert.equal(queryVerdict(fin, { result: { ok: true }, painted: false, rest: false, usedModel: false }), true);
  assert.equal(queryVerdict(quote, { result: { ok: true }, painted: false, rest: true, usedModel: false }), false);
  assert.equal(queryVerdict(quote, { result: { ok: true }, painted: true, rest: true, usedModel: false }), true);
  assert.equal(queryVerdict(quote, { result: { ok: true }, painted: true, rest: false, usedModel: true }), false);
});

test('order lock does not treat 과매도 or 과매수 technique copy as a live order', () => {
  const orderLock = LOCKED_CLICKS.find((item) => item.id === 'order-submit');
  assert.ok(orderLock);
  assert.equal(orderLock.match.test('가짜 돌파 되돌림 반전 종가가 볼린저 하단 아래로 빠지면 진입(과매도 되돌림), 중심선 회복 시 청산'), false);
  assert.equal(orderLock.match.test('RSI 과매도'), false);
  assert.equal(orderLock.match.test('과매수에서 청산'), false);
  assert.equal(orderLock.match.test('시장가 매수'), true);
  assert.equal(orderLock.match.test('시장가 매도'), true);
  assert.equal(orderLock.match.test('주문 확인'), true);
});

test('live-full probe does not share the real athena-shell profile or skip every capture', () => {
  const src = fs.readFileSync(path.join(appDir, 'probe-live-full.js'), 'utf8');
  assert.match(src, /\.probe-live-full-profile/);
  assert.doesNotMatch(src, /appData['"], 'athena-shell'/);
  assert.doesNotMatch(src, /capturePage hangs Electron main on this host/);
  assert.match(src, /capturePage\(\)/);
  assert.match(src, /queryVerdict/);
});

test('verify suite lists live-full and the official verify script with budgets', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  const names = VERIFY_SUITE.map((item) => item.script);
  assert.ok(names.includes('verify:live-full'));
  assert.ok(names.includes('verify'));
  assert.ok(names.includes('verify:kiumi-cards'));
  for (const item of VERIFY_SUITE) {
    assert.ok(Number.isInteger(item.budgetMs) && item.budgetMs >= 30000, item.script);
    assert.ok(pkg.scripts[item.script], `missing npm script ${item.script}`);
  }
  const verifyJs = fs.readFileSync(path.join(appDir, 'verify.js'), 'utf8');
  assert.match(verifyJs, /capture skip/);
  assert.match(verifyJs, /wait\(12000\)/);
});

test('기본 스위트는 Paper 정적 게이트 3종을 매니페스트부터 순서대로 담는다', () => {
  // 전제(매니페스트)가 깨지면 나머지 판정이 무의미하니 맨 앞이다(설계서 §6.2).
  const names = VERIFY_SUITE.map((item) => item.script);
  assert.deepEqual(names.slice(0, 3), [
    'verify:paper-manifest',
    'verify:paper-cards-static',
    'verify:paper-mini-static',
  ]);
});

test('paper 스위트도 예산과 실재하는 npm 스크립트를 단언한다', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  assert.ok(PAPER_SUITE.length);
  for (const item of PAPER_SUITE) {
    assert.ok(Number.isInteger(item.budgetMs) && item.budgetMs >= 30000, item.script);
    assert.ok(pkg.scripts[item.script], `missing npm script ${item.script}`);
  }
  assert.equal(pkg.scripts['verify:paper'], 'node scripts/run-verify-suite.js --suite paper');
});

test('paper 스위트의 electron 항목은 기본 스위트에 못 들어간다', () => {
  // 15분짜리 전수가 기본 스위트로 새면 매 verify:suite가 22분에서 40분이 된다.
  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  const base = new Set(VERIFY_SUITE.map((item) => item.script));
  for (const item of PAPER_SUITE) {
    if (!pkg.scripts[item.script].startsWith('electron')) continue;
    assert.equal(base.has(item.script), false, `${item.script} 는 기본 스위트에 넣지 않는다`);
  }
});
