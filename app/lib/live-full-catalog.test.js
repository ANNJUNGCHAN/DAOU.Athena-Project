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
