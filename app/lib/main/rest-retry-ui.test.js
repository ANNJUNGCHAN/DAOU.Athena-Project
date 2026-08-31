'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '../..');
const mainSource = fs.readFileSync(path.join(appRoot, 'main.js'), 'utf8');
const canvasSource = fs.readFileSync(path.join(appRoot, 'canvas.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(appRoot, 'preload.js'), 'utf8');

test('renderer receives only opaque retry capability and invokes the existing safe IPC', () => {
  assert.match(preloadSource, /ON_CHANNELS[\s\S]*'athena:rest-retry-available'/);
  assert.match(mainSource, /send\('athena:rest-retry-available',\s*\{\s*retryId,\s*state: result\.state,\s*cardId: retryCardId,?\s*\}\)/);
  assert.match(mainSource, /send\('athena:add-rest-canvas',\s*\{[\s\S]*?retryCardId: payload\.retryCardId,[\s\S]*?\}\)/);
  assert.match(canvasSource, /invoke\('athena__render_canvas',\s*\{\s*source: 'rest-retry',\s*retryId,?\s*\}\)/);
  const rendererHandler = canvasSource.slice(
    canvasSource.indexOf("window.athena.on('athena:rest-retry-available'"),
    canvasSource.indexOf('// ---------- 실배선', canvasSource.indexOf("window.athena.on('athena:rest-retry-available'")),
  );
  for (const forbidden of ['dataset:', 'operationRef', 'operation_args', 'accountId', 'generation']) {
    assert.doesNotMatch(rendererHandler, new RegExp(forbidden), `${forbidden} must not cross the retry renderer boundary`);
  }
});

test('retry UI is restricted to error states and reports pending, success and failure honestly', () => {
  assert.match(canvasSource, /REST_RETRY_STATES = new Set\(\['timeout', 'cancelled', 'error'\]\)/);
  assert.match(canvasSource, /const prior = card\.querySelector\('\.rest-retry-action'\);\s*if \(prior\) prior\.remove\(\)/);
  assert.match(canvasSource, /button\.disabled = true;[\s\S]*button\.textContent = '다시 시도 중…'/);
  assert.match(canvasSource, /status\.textContent = '다시 조회했습니다\.';[\s\S]*destroyCard\(card\)/);
  assert.doesNotMatch(canvasSource.slice(
    canvasSource.indexOf('function attachRestRetryAction'),
    canvasSource.indexOf("window.athena.on('athena:rest-retry-available'"),
  ), /button\.disabled = false/);
  assert.match(canvasSource, /button\.remove\(\);\s*action\.dataset\.consumed = 'true'/);
  assert.match(canvasSource, /status\.setAttribute\('role', 'status'\)/);
  assert.match(canvasSource, /status\.setAttribute\('aria-live', 'polite'\)/);
});

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.textContent = '';
    this.disabled = false;
    this.isConnected = true;
  }

  appendChild(child) {
    child.parentNode = this;
    child.isConnected = this.isConnected;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    }
    this.parentNode = null;
    this.isConnected = false;
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  click() { return this.listeners.get('click')(); }

  querySelector(selector) {
    const className = selector.startsWith('.') ? selector.slice(1) : null;
    const stack = [...this.children];
    while (stack.length) {
      const current = stack.shift();
      if (className && current.className.split(/\s+/).includes(className)) return current;
      stack.push(...current.children);
    }
    return null;
  }
}

function retryUiHarness() {
  const grid = new FakeElement('main');
  const handlers = new Map();
  let invoke = async () => ({ ok: true });
  const makeStateCard = (state, cardId) => {
    const card = new FakeElement('article');
    card.className = 'card';
    card.dataset.screenState = state;
    if (cardId) Object.defineProperty(card, '__athenaRestRetryCardId', { value: cardId });
    const body = new FakeElement('div');
    body.className = 'card-body';
    card.appendChild(body);
    grid.appendChild(card);
    return card;
  };
  const start = canvasSource.indexOf('const REST_RETRY_STATES');
  const end = canvasSource.indexOf('// ---------- 실배선', start);
  vm.runInNewContext(canvasSource.slice(start, end), {
    window: { athena: {
      on: (channel, handler) => handlers.set(channel, handler),
      invoke: (...args) => invoke(...args),
    } },
    document: { createElement: (tagName) => new FakeElement(tagName) },
    grid: {
      querySelectorAll: () => grid.children.filter((child) => child.className.split(/\s+/).includes('card')),
    },
    renderRestStateCard: (envelope) => makeStateCard(envelope.state),
    destroyCard: (card) => card.remove(),
  });
  return {
    grid,
    handler: handlers.get('athena:rest-retry-available'),
    makeStateCard,
    setInvoke: (next) => { invoke = next; },
  };
}

function retryAction(card) {
  const action = card.querySelector('.rest-retry-action');
  return { action, button: action.children[0], status: action.children[1] };
}

test('fake DOM: opaque card correlation selects only the exact same-state card', () => {
  const harness = retryUiHarness();
  const firstCardId = '11111111-1111-4111-8111-111111111111';
  const secondCardId = '22222222-2222-4222-8222-222222222222';
  const first = harness.makeStateCard('timeout', firstCardId);
  const second = harness.makeStateCard('timeout', secondCardId);
  harness.handler({ retryId: 'A'.repeat(43), state: 'timeout', cardId: secondCardId });
  assert.equal(first.querySelector('.rest-retry-action'), null);
  assert.ok(second.querySelector('.rest-retry-action'));
});

test('fake DOM: failed or throwing one-shot clicks stay consumed until a new token arrives', async () => {
  const harness = retryUiHarness();
  const cardId = '33333333-3333-4333-8333-333333333333';
  const card = harness.makeStateCard('error', cardId);
  harness.setInvoke(async () => ({ ok: false, error: '실패함' }));
  harness.handler({ retryId: 'B'.repeat(43), state: 'error', cardId });
  let current = retryAction(card);
  await current.button.click();
  assert.equal(current.button.isConnected, false);
  assert.equal(current.action.dataset.consumed, 'true');
  assert.equal(current.status.textContent, '실패함');

  harness.setInvoke(async () => { throw new Error('boom'); });
  harness.handler({ retryId: 'C'.repeat(43), state: 'error', cardId });
  current = retryAction(card);
  await current.button.click();
  assert.equal(current.button.isConnected, false);
  assert.equal(current.action.dataset.consumed, 'true');
  assert.equal(current.status.textContent, '다시 조회하지 못했습니다.');

  harness.handler({ retryId: 'D'.repeat(43), state: 'error', cardId });
  const replacement = retryAction(card);
  assert.equal(replacement.button.textContent, '다시 시도');
  assert.equal(replacement.button.disabled, false);
  assert.equal(replacement.action.dataset.consumed, undefined);
});

test('main consumes retry only from the shell and returns no private dataset', () => {
  const start = mainSource.indexOf("if (payload.source === 'rest-retry')");
  const end = mainSource.indexOf("if (payload.source === 'rest-dataset')", start);
  assert.ok(start > 0 && end > start);
  const branch = mainSource.slice(start, end);
  assert.match(branch, /e\.sender !== shellWin\.webContents/);
  assert.match(branch, /restRetryRegistry\.consume\(\{/);
  assert.match(branch, /conversationId: historyConversationId\(\)/);
  assert.match(branch, /accountId/);
  assert.match(branch, /runDirectRestDataset\(consumed\.dataset/);
  const returned = branch.slice(branch.lastIndexOf('return {'));
  for (const forbidden of ['dataset', 'operationRef', 'operationArgs', 'accountId', 'generation', 'retryAction']) {
    assert.doesNotMatch(returned, new RegExp(forbidden), `${forbidden} must not be returned to renderer`);
  }
});
