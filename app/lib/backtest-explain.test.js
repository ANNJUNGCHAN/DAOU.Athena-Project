// backtest-explain.js 단위 테스트 — jsdom 없이 최소 DOM 스텁으로 검증한다
// (backtest-canvas.test.js가 세운 관례를 그대로 쓴다).
//
// 이 파일이 지키는 계약은 하나다: **화면은 payload가 준 것만 그린다.** 문장을 지어내지
// 않고, 사실이 없으면 빈칸이며, 확실하지 않은 것은 확실하지 않게 그린다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Explain = require('./backtest-explain');

function fakeNode(tag) {
  return {
    tag,
    className: '',
    textContent: '',
    type: '',
    hidden: false,
    children: [],
    attrs: {},
    _listeners: {},
    get firstChild() { return this.children[0] || null; },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter((c) => c !== child); return child; },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === 'class') this.className = String(v);
    },
    addEventListener(type, handler) {
      (this._listeners[type] = this._listeners[type] || []).push(handler);
    },
    dispatchEvent(event) {
      (this._listeners[event && event.type] || []).forEach((h) => h(event));
      return true;
    },
  };
}

test.beforeEach(() => {
  global.document = { createElement: (tag) => fakeNode(tag) };
});

test.afterEach(() => { delete global.document; });

function findByClass(node, cls) {
  const found = [];
  const walk = (n) => {
    if (String(n.className || '').split(/\s+/).includes(cls)) found.push(n);
    (n.children || []).forEach(walk);
  };
  walk(node);
  return found;
}

function textOf(node) {
  const parts = [];
  const walk = (n) => {
    if (n.textContent && !(n.children || []).length) parts.push(n.textContent);
    (n.children || []).forEach(walk);
  };
  walk(node);
  return parts.join(' ');
}

// ── 오류 진단(보드 09·12) ───────────────────────────────────────────────────

test('진단: 수정안이 없으면 지어내지 않고 그 사실을 적는다', () => {
  const root = fakeNode('div');
  Explain.renderDiagnosis(root, {
    title: '② 가격을 지표로 바꿉니다 — df에 없는 열을 찾았습니다',
    why: 'atr 열은 df에 없습니다', raw: 'KeyError: atr',
    unknown_reason: '어느 지표를 뜻하는지 확신하지 못했습니다',
  }, {});
  assert.equal(
    findByClass(root, 'backtest-diag-title')[0].textContent,
    '② 가격을 지표로 바꿉니다 — df에 없는 열을 찾았습니다',
  );
  assert.equal(findByClass(root, 'backtest-diag-nofix').length, 1);
  assert.equal(findByClass(root, 'backtest-diag-apply').length, 0);
});

test('진단: 세 갈래는 사람이 누를 때만 움직인다(보드 12)', () => {
  const root = fakeNode('div');
  const calls = [];
  Explain.renderDiagnosis(root, {
    title: '멈췄습니다', why: '이유', raw: 'Traceback',
    suggestion: { removed: 1, added: 2, summary: 'atr를 계산해 붙입니다', new_source: 'x = 1', diff_lines: [] },
  }, {
    onApply: (src, alsoRun) => calls.push(['apply', src, alsoRun]),
    onDiscard: () => calls.push(['discard']),
  });
  const labels = [
    findByClass(root, 'backtest-diag-apply')[0].textContent,
    findByClass(root, 'backtest-diag-apply-only')[0].textContent,
    findByClass(root, 'backtest-diag-discard')[0].textContent,
  ];
  assert.deepEqual(labels, ['적용하고 다시 실행', '지도만 고치기', '버리기']);
  assert.deepEqual(calls, []);
  findByClass(root, 'backtest-diag-apply-only')[0].dispatchEvent({ type: 'click' });
  assert.deepEqual(calls, [['apply', 'x = 1', false]]);
});
