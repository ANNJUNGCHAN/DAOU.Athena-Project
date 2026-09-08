'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const createLib = require('./watch-create-card');

const source = fs.readFileSync(path.join(__dirname, '..', 'chat.js'), 'utf8');
const start = source.indexOf('function renderWatchCreateReceipt(');
const end = source.indexOf('const WATCH_PROGRESS_MARK_CLASS', start);
assert.ok(start >= 0 && end > start);

function element(tag) {
  return {
    tag, className: '', textContent: '', children: [], attrs: {}, listeners: {},
    appendChild(child) { this.children.push(child); return child; },
    setAttribute(key, value) { this.attrs[key] = String(value); },
    addEventListener(kind, handler) { this.listeners[kind] = handler; },
    classList: { add() {} },
  };
}
function byClass(root, cls) {
  const out = [];
  (function walk(node) {
    if ((node.className || '').split(/\s+/).includes(cls)) out.push(node);
    (node.children || []).forEach(walk);
  })(root);
  return out;
}

function harness() {
  const history = element('history');
  const sent = [];
  const scope = {
    document: {
      createElement: element,
      dispatchEvent: (event) => { sent.push(event); return true; },
    },
    CustomEvent: class {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    watchCreateCardLib: createLib,
    _mountTurn: (line, card) => { line.appendChild(card); history.appendChild(line); },
  };
  vm.createContext(scope);
  vm.runInContext(source.slice(start, end), scope);
  return { history, sent, scope };
}

test('watch-create 봉투가 오면 영수증과 확인 주기 질문 카드가 선다', () => {
  const h = harness();
  h.scope.renderWatchCreateReceipt(
    createLib.buildReceipt(['일봉 불러오기', '3일 거래량 평균', '배수 비교', '알림']),
  );
  h.scope.renderWatchCreateQuestion(createLib.POLL_QUESTION);
  assert.equal(byClass(h.history, 'watch-create-badge')[0].textContent, '+4');
  assert.equal(
    byClass(h.history, 'watch-create-text')[0].textContent,
    '함수 4개 만듦 · 일봉 불러오기 → 3일 거래량 평균 → 배수 비교 → 알림',
  );
  assert.equal(byClass(h.history, 'routine-draft-title')[0].textContent, '언제 확인할까요? — 하나만 고르면 됩니다');
  assert.deepEqual(
    byClass(h.history, 'backtest-visual-choice').map((btn) => btn.textContent),
    ['장중 1분마다', '장 마감 후 한 번'],
  );
  assert.match(byClass(h.history, 'agent-source')[0].textContent, /점심 지나서만 봐줘/);
});

test('확인 주기 칩은 고른 답을 채팅으로 보내고 다음 쿨다운 질문을 연다', () => {
  const h = harness();
  h.scope.renderWatchCreateQuestion(createLib.POLL_QUESTION);
  const poll = byClass(h.history, 'backtest-visual-choice')[0];
  poll.listeners.click();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].type, 'athena:chat-submit');
  assert.equal(h.sent[0].detail.text, '장중 1분마다');
  assert.equal(poll.disabled, true);
  assert.equal(
    byClass(h.history, 'routine-draft-title').at(-1).textContent,
    '얼마나 자주 울려도 될까요? — 쿨다운을 정합니다',
  );
});

test('이름이 없는 영수증은 그리지 않고 질문만 선다', () => {
  const h = harness();
  h.scope.renderWatchCreateReceipt(null);
  h.scope.renderWatchCreateQuestion(createLib.POLL_QUESTION);
  assert.equal(byClass(h.history, 'watch-create-receipt').length, 0);
  assert.equal(byClass(h.history, 'watch-create-question').length, 1);
});

test('봉투는 영수증만 자동으로 그리고 확인 주기 질문은 열지 않는다', () => {
  const appDir = path.join(__dirname, '..');
  const chatSource = fs.readFileSync(path.join(appDir, 'chat.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(appDir, 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(appDir, 'preload.js'), 'utf8');
  const shell = fs.readFileSync(path.join(appDir, 'shell.html'), 'utf8');
  assert.equal(mainSource.split("send('athena:watch-create'").length - 1, 1);
  assert.equal(chatSource.split("window.athena.on('athena:watch-create'").length - 1, 1);
  const body = chatSource.slice(chatSource.indexOf("window.athena.on('athena:watch-create'"));
  assert.match(body, /renderWatchCreateReceipt\(envelope\.receipt\)/);
  assert.doesNotMatch(body, /renderWatchCreateQuestion\(envelope\.poll\)/);
  assert.match(preload, /'athena:watch-create'/);
  assert.ok(shell.indexOf('lib/watch-create-card.js') < shell.indexOf('<script src="chat.js">'));
});
