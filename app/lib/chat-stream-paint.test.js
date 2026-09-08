'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'chat.js'), 'utf8');
function harness({ displayed = true } = {}) {
  const paints = [];
  const claims = [];
  const frames = new Map();
  let nextFrame = 0;
  let scrolls = 0;
  const node = () => ({ appendChild() {} });
  let current = true;
  const pane = node();
  const context = vm.createContext({
    cid: 'conversation-1',
    mine: () => current,
    onScreen: () => displayed,
    paneRootFor: (conversationId) => {
      assert.equal(conversationId, 'conversation-1');
      return pane;
    },
    document: { createElement: node },
    window: { AthenaLib: { Markdown: { render: (_element, text) => paints.push(text) } } },
    scrollAfterRender: () => { scrolls += 1; },
    claimProviderVisible: (meta) => claims.push(meta),
    requestAnimationFrame: (fn) => { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  const start = source.indexOf('  let streamALine = null;');
  const end = source.indexOf('  const onLiveTextDelta =', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
  return {
    paints, claims, frames, context,
    get scrolls() { return scrolls; },
    append(text, meta = null) {
      context.text = text; context.meta = meta;
      vm.runInContext('appendToBubble(text, meta)', context);
    },
    supersede() { current = false; },
    flush() {
      const pending = [...frames.values()]; frames.clear();
      for (const callback of pending) callback();
    },
    finish() {
      const cleanup = source.match(/    if \(streamPaintFrame !== null\) cancelAnimationFrame\(streamPaintFrame\);\s+streamPaintFrame = null;/);
      assert.ok(cleanup, 'turn completion cancels pending stream paint');
      vm.runInContext(cleanup[0], context);
    },
  };
}

test('first text paints immediately; 100 additional deltas use one frame without loss', () => {
  const h = harness();
  const first = { sequence: 1 };
  h.append('처음', first);
  assert.deepEqual(h.paints, ['처음']);
  assert.equal(h.claims[0], first);
  for (let i = 0; i < 100; i += 1) h.append('가', { sequence: i + 2 });
  assert.equal(h.frames.size, 1);
  assert.equal(h.paints.length, 1);
  h.flush();
  assert.deepEqual(h.paints, ['처음', '처음' + '가'.repeat(100)]);
  assert.equal(h.scrolls, 2);
  assert.equal(h.claims[1].sequence, 2);
  h.append('끝'); h.flush();
  assert.equal(h.paints[2], '처음' + '가'.repeat(100) + '끝');
});

test('superseded turn cannot paint or claim visibility from a queued frame', () => {
  const h = harness();
  h.append('첫'); h.append('늦은 조각');
  h.supersede();
  h.flush();
  assert.deepEqual(h.paints, ['첫']);
  assert.equal(h.claims.length, 1);
});

test('offscreen conversation paints without scrolling either immediate or queued frames', () => {
  const h = harness({ displayed: false });
  h.append('첫');
  h.append('두번째');
  h.flush();
  assert.deepEqual(h.paints, ['첫', '첫두번째']);
  assert.equal(h.scrolls, 0);
  assert.equal(h.claims.length, 2);
});

test('completion cancels queued partial paint before the authoritative final answer', () => {
  const h = harness();
  h.append('첫'); h.append('부분');
  h.finish();
  h.flush();
  assert.equal(h.frames.size, 0);
  assert.deepEqual(h.paints, ['첫']);
});
