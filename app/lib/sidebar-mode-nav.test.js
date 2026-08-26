// sidebar-mode-nav.js 단위 테스트 — Electron/브라우저 없이 최소 DOM 스텁으로
// 검증한다(history-badge.test.js가 세운 관례 — jsdom 등 신규 의존성을 들이지
// 않는다). 이 모듈은 전역 document를 전혀 참조하지 않으므로(엘리먼트는 전부
// 주입받는다) global.document 스텁조차 필요 없다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSidebarModeNav } = require('./sidebar-mode-nav');

function fakeButton() {
  const el = {
    className: 'sidebar-mode-item',
    attrs: {},
    _listeners: {},
    setAttribute(key, value) { this.attrs[key] = value; },
    getAttribute(key) { return this.attrs[key]; },
    addEventListener(type, handler) {
      (this._listeners[type] = this._listeners[type] || []).push(handler);
    },
    dispatchEvent(event) {
      const handlers = this._listeners[event && event.type] || [];
      handlers.forEach((handler) => handler(event));
    },
  };
  return el;
}

function fakeBadge() {
  return { hidden: true, textContent: '' };
}

function setup(onSelect, badge) {
  const items = { summary: fakeButton(), graph: fakeButton(), agent: fakeButton() };
  const nav = createSidebarModeNav({ items, badge, onSelect });
  return { nav, items };
}

test('처음에는 아무 항목도 건드리지 않는다(정적 마크업의 기본 active를 덮어쓰지 않는다)', () => {
  const { items } = setup();
  assert.equal(items.summary.className, 'sidebar-mode-item');
  assert.equal(items.graph.className, 'sidebar-mode-item');
  assert.equal(items.agent.className, 'sidebar-mode-item');
});

test('항목을 클릭하면 그 항목만 active가 되고 onSelect가 그 키로 불린다', () => {
  const seen = [];
  const { items } = setup((key) => seen.push(key));
  items.graph.dispatchEvent({ type: 'click' });
  assert.equal(items.graph.className, 'sidebar-mode-item is-active');
  assert.equal(items.graph.getAttribute('aria-pressed'), 'true');
  assert.equal(items.summary.className, 'sidebar-mode-item');
  assert.equal(items.agent.className, 'sidebar-mode-item');
  assert.deepEqual(seen, ['graph']);
});

test('다른 항목을 클릭하면 이전 active가 꺼지고 새 항목만 켜진다', () => {
  const { items } = setup();
  items.graph.dispatchEvent({ type: 'click' });
  items.agent.dispatchEvent({ type: 'click' });
  assert.equal(items.graph.className, 'sidebar-mode-item');
  assert.equal(items.graph.getAttribute('aria-pressed'), 'false');
  assert.equal(items.agent.className, 'sidebar-mode-item is-active');
  assert.equal(items.agent.getAttribute('aria-pressed'), 'true');
});

test('setActive()를 직접 불러도 클릭과 같은 결과를 낸다(외부에서 상태를 맞출 때)', () => {
  const { nav, items } = setup();
  nav.setActive('summary');
  assert.equal(items.summary.className, 'sidebar-mode-item is-active');
  assert.equal(items.graph.className, 'sidebar-mode-item');
  assert.equal(items.agent.className, 'sidebar-mode-item');
});

test('items가 비어 있어도 터지지 않는다', () => {
  const nav = createSidebarModeNav({ items: {} });
  assert.doesNotThrow(() => nav.setActive('agent'));
});

test('deps 자체가 없어도 터지지 않는다', () => {
  assert.doesNotThrow(() => createSidebarModeNav());
});

test('onSelect가 없어도 클릭이 터지지 않는다(콜백 미주입 방어)', () => {
  const { items } = setup(undefined);
  assert.doesNotThrow(() => items.summary.dispatchEvent({ type: 'click' }));
  assert.equal(items.summary.className, 'sidebar-mode-item is-active');
});

test('addEventListener가 없는 항목(비-DOM 값)이 섞여도 나머지는 정상 배선된다', () => {
  const items = { summary: fakeButton(), graph: null };
  const seen = [];
  const nav = createSidebarModeNav({ items, onSelect: (k) => seen.push(k) });
  items.summary.dispatchEvent({ type: 'click' });
  assert.deepEqual(seen, ['summary']);
  assert.doesNotThrow(() => nav.setActive('graph'));
});

// ── 배지(원칙2 — 미확인 알람 수) ─────────────────────────────────────────────
// 시나리오: 2개 미확인 이벤트 주입 → 배지 "2" → 1개 읽음 처리 → 배지 "1"
// (팀 리드 브리핑 시나리오 그대로 — 이 파일은 호출자가 넘긴 숫자만 렌더한다).

test('배지: 2개 미확인 → "2" 표시, 1개 읽음 처리 후 → "1" 표시', () => {
  const badge = fakeBadge();
  const { nav } = setup(undefined, badge);
  nav.setBadgeCount(2);
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, '2');
  nav.setBadgeCount(1);
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, '1');
});

test('배지: 0이면 숨긴다(없는 미확인을 있다고 표시하지 않는다)', () => {
  const badge = fakeBadge();
  const { nav } = setup(undefined, badge);
  nav.setBadgeCount(2);
  nav.setBadgeCount(0);
  assert.equal(badge.hidden, true);
  assert.equal(badge.textContent, '');
});

test('배지: 음수·NaN·미지정은 0으로 취급한다', () => {
  const badge = fakeBadge();
  const { nav } = setup(undefined, badge);
  nav.setBadgeCount(-3);
  assert.equal(badge.hidden, true);
  nav.setBadgeCount(NaN);
  assert.equal(badge.hidden, true);
  nav.setBadgeCount(undefined);
  assert.equal(badge.hidden, true);
});

test('배지: 소수는 내림한다', () => {
  const badge = fakeBadge();
  const { nav } = setup(undefined, badge);
  nav.setBadgeCount(3.9);
  assert.equal(badge.textContent, '3');
});

test('배지: badge 엘리먼트가 주입되지 않아도 터지지 않는다', () => {
  const { nav } = setup();
  assert.doesNotThrow(() => nav.setBadgeCount(5));
});
