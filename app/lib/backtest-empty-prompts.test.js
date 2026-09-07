'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  BACKTEST_EMPTY_PROMPT_HEAD,
  BACKTEST_EMPTY_PROMPTS,
  mountBacktestEmptyPrompts,
} = require('./backtest-empty-prompts');

const appDir = path.resolve(__dirname, '..');

function fakeNode(tag) {
  const node = {
    tag,
    className: '',
    textContent: '',
    type: '',
    children: [],
    _listeners: {},
    get firstChild() { return this.children[0] || null; },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      return child;
    },
    addEventListener(type, handler) {
      (this._listeners[type] = this._listeners[type] || []).push(handler);
    },
    click() {
      (this._listeners.click || []).forEach((handler) => handler({ type: 'click' }));
    },
  };
  return node;
}

test.beforeEach(() => {
  global.document = { createElement: (tag) => fakeNode(tag) };
});

test.afterEach(() => {
  delete global.document;
});

function findByClass(node, cls) {
  const found = [];
  const walk = (n) => {
    if (String(n.className || '').split(/\s+/).includes(cls)) found.push(n);
    (n.children || []).forEach(walk);
  };
  walk(node);
  return found;
}

test('Paper 40MW–40N3 문구 세 개가 고정이다 — 지어내지 않는다', () => {
  assert.equal(BACKTEST_EMPTY_PROMPT_HEAD, '이런 걸 물어볼 수 있어요');
  assert.deepEqual(BACKTEST_EMPTY_PROMPTS, [
    '이 기법은 다른 것과 뭐가 다른가요?',
    '왜 최근 두 달 동안 한 번도 안 샀죠?',
    '손절을 ATR 2배로 바꾸고 싶어요',
  ]);
});

test('mountBacktestEmptyPrompts: 머리와 칩 3개를 그리고 누르면 그 문장을 넘긴다', () => {
  const root = fakeNode('div');
  const picked = [];
  mountBacktestEmptyPrompts(root, (text) => picked.push(text));
  assert.equal(findByClass(root, 'backtest-empty-prompts-head')[0].textContent, BACKTEST_EMPTY_PROMPT_HEAD);
  const chips = findByClass(root, 'backtest-empty-prompt');
  assert.equal(chips.length, 3);
  assert.deepEqual(chips.map((c) => c.textContent), BACKTEST_EMPTY_PROMPTS.slice());
  chips[1].click();
  assert.deepEqual(picked, [BACKTEST_EMPTY_PROMPTS[1]]);
  chips[0].click();
  assert.deepEqual(picked, [BACKTEST_EMPTY_PROMPTS[1], BACKTEST_EMPTY_PROMPTS[0]]);
});

test('칩은 #history 밖 동생이고, 이력 :empty 선택자가 칩을 켠다', () => {
  const shell = fs.readFileSync(path.join(appDir, 'shell.html'), 'utf8');
  const css = fs.readFileSync(path.join(appDir, 'chat.css'), 'utf8');
  const chat = fs.readFileSync(path.join(appDir, 'chat.js'), 'utf8');
  const historyAt = shell.indexOf('id="history"');
  const promptsAt = shell.indexOf('id="backtestEmptyPrompts"');
  assert.ok(historyAt >= 0 && promptsAt > historyAt, '빈 질문 줄은 #history 뒤에 선다');
  const historyBlock = shell.slice(historyAt, promptsAt);
  assert.equal(historyBlock.includes('backtest-empty-prompt'), false, '칩을 이력 안에 넣으면 :empty가 죽는다');
  assert.match(
    css,
    /#chatModeHead\[data-mode="backtest"\]:not\(\[hidden\]\):not\(\[data-technique\]\)\s*~\s*\.history:empty\s*~\s*#backtestEmptyPrompts/,
  );
  assert.match(css, /#backtestEmptyPrompts\s*\{[^}]*display:\s*none/);
  const mount = chat.slice(
    chat.indexOf('BacktestEmptyPrompts'),
    chat.indexOf('BacktestEmptyPrompts') + 700,
  );
  assert.match(mount, /mountBacktestEmptyPrompts/);
  assert.match(mount, /athena:chat-insert/);
  assert.equal(mount.includes('dispatchUserQuery'), false, '칩은 보내지 않고 입력창에만 넣는다');
});
