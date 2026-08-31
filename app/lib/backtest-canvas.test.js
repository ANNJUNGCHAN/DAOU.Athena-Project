// backtest-canvas.js 단위 테스트 — history-badge.test.js가 세운 관례(jsdom 없이
// 최소 DOM 스텁)를 그대로 쓴다. 이번 단계는 정직한 빈 상태 하나뿐이라
// 검증할 것도 그만큼만이다: mount()가 그 빈 상태를 그리는지, refresh()가
// 죽지 않는지.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBacktestCanvas } = require('./backtest-canvas');

function fakeContainer() {
  return {
    children: [],
    className: '',
    _text: '',
    get firstChild() {
      return this.children[0] || null;
    },
    get textContent() {
      return this._text;
    },
    set textContent(value) {
      this._text = value;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      return child;
    },
  };
}

test.beforeEach(() => {
  global.document = { createElement: () => fakeContainer() };
});

test.afterEach(() => {
  delete global.document;
});

test('mount()는 정직한 빈 상태(제목 "백테스트" + 부제)를 그린다', () => {
  const container = fakeContainer();
  const canvas = createBacktestCanvas({ container });
  canvas.mount();
  assert.equal(container.children.length, 1);
  const wrap = container.children[0];
  assert.equal(wrap.className, 'backtest-canvas-empty');
  const [title, sub] = wrap.children;
  assert.equal(title.className, 'backtest-canvas-empty-title');
  assert.equal(title.textContent, '백테스트');
  assert.equal(sub.className, 'backtest-canvas-empty-sub');
  assert.match(sub.textContent, /백엔드가 붙지 않았습니다/);
});

test('refresh()는 죽지 않고 같은 빈 상태를 다시 그린다', () => {
  const container = fakeContainer();
  const canvas = createBacktestCanvas({ container });
  canvas.mount();
  assert.doesNotThrow(() => canvas.refresh());
  assert.equal(container.children.length, 1, '중복으로 쌓이지 않는다(매번 비우고 다시 그린다)');
});

test('container가 없으면 mount()/refresh() 둘 다 조용히 넘어간다', () => {
  const canvas = createBacktestCanvas({});
  assert.doesNotThrow(() => canvas.mount());
  assert.doesNotThrow(() => canvas.refresh());
});
