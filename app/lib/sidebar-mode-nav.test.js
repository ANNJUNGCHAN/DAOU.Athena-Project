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

function setupCounts() {
  const items = { summary: fakeButton(), graph: fakeButton(), agent: fakeButton() };
  const counts = { summary: fakeBadge(), graph: fakeBadge(), agent: fakeBadge() };
  const nav = createSidebarModeNav({ items, counts });
  return { nav, items, counts };
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

test('감시 수: 2건이면 「감시 2」, 0이면 숨긴다', () => {
  const watch = fakeBadge();
  const items = { summary: fakeButton(), graph: fakeButton(), agent: fakeButton() };
  const nav = createSidebarModeNav({ items, watch });
  nav.setWatchCount(2);
  assert.equal(watch.hidden, false);
  assert.equal(watch.textContent, '감시 2');
  nav.setWatchCount(0);
  assert.equal(watch.hidden, true);
  assert.equal(watch.textContent, '');
});

test('감시 수: watch 엘리먼트가 없어도 터지지 않는다', () => {
  const { nav } = setup();
  assert.doesNotThrow(() => nav.setWatchCount(3));
});

// ── 모드별 대화 수(세션 명세 §3-1 "이력의 머리는 다섯 모드") ─────────────────
// 이 파일은 숫자를 세지 않는다 — 호출자(sidebar.js)가 session-history-view.js로
// 센 결과를 넘기고, 여기서는 렌더 규칙(0이면 숨김·숫자만)만 검증한다.

test('카운트: 양수면 숫자를 표시한다', () => {
  const { nav, counts } = setupCounts();
  nav.setCounts({ summary: 3, graph: 1 });
  assert.equal(counts.summary.hidden, false);
  assert.equal(counts.summary.textContent, '3');
  assert.equal(counts.graph.hidden, false);
  assert.equal(counts.graph.textContent, '1');
});

test('카운트: 0이거나 빠진 키는 그 자리를 숨긴다(없는 이력을 있다고 그리지 않는다)', () => {
  const { nav, counts } = setupCounts();
  nav.setCounts({ summary: 2, graph: 2, agent: 2 });
  nav.setCounts({ summary: 0 });
  assert.equal(counts.summary.hidden, true);
  assert.equal(counts.summary.textContent, '');
  assert.equal(counts.graph.hidden, true, '빠진 키는 0으로 취급한다');
  assert.equal(counts.agent.hidden, true);
});

test('카운트: 음수·NaN·비-숫자는 0으로 취급하고 소수는 내림한다', () => {
  const { nav, counts } = setupCounts();
  nav.setCounts({ summary: -1, graph: NaN, agent: 4.9 });
  assert.equal(counts.summary.hidden, true);
  assert.equal(counts.graph.hidden, true);
  assert.equal(counts.agent.textContent, '4');
  nav.setCounts({ agent: '7' });
  assert.equal(counts.agent.hidden, true);
});

test('카운트: 모르는 키는 무시한다(그릴 자리가 없다)', () => {
  const { nav, counts } = setupCounts();
  assert.doesNotThrow(() => nav.setCounts({ plugin: 9, backtest: 4 }));
  assert.equal(counts.summary.hidden, true);
});

test('카운트: counts 맵이 없거나 인자가 없어도 터지지 않는다', () => {
  const { nav } = setup();
  assert.doesNotThrow(() => nav.setCounts({ summary: 3 }));
  const withCounts = setupCounts();
  assert.doesNotThrow(() => withCounts.nav.setCounts());
  assert.equal(withCounts.counts.summary.hidden, true);
});

// ── 실행 중 표시(스피너 하나로 통일, 사용자 확정 2026-09-02) ─────────────────
// 색 점은 쓰지 않는다. 스피너는 CSS가 그리므로 여기서는 상태 클래스와 aria-busy만 본다.

test('실행중: true면 has-running 클래스와 aria-busy를 켜고, false면 끈다', () => {
  const { nav, items } = setup();
  nav.setRunning({ graph: true });
  assert.equal(items.graph.className, 'sidebar-mode-item has-running');
  assert.equal(items.graph.getAttribute('aria-busy'), 'true');
  assert.equal(items.summary.className, 'sidebar-mode-item');
  assert.equal(items.summary.getAttribute('aria-busy'), 'false');
  nav.setRunning({ graph: false });
  assert.equal(items.graph.className, 'sidebar-mode-item');
  assert.equal(items.graph.getAttribute('aria-busy'), 'false');
});

test('실행중: 두 번 켜도 클래스가 겹쳐 붙지 않는다', () => {
  const { nav, items } = setup();
  nav.setRunning({ agent: true });
  nav.setRunning({ agent: true });
  assert.equal(items.agent.className, 'sidebar-mode-item has-running');
});

test('실행중: 이미 active인 항목은 is-active를 잃지 않는다', () => {
  const { nav, items } = setup();
  nav.setActive('summary');
  nav.setRunning({ summary: true });
  assert.equal(items.summary.className, 'sidebar-mode-item is-active has-running');
});

test('실행중: 모르는 키는 무시하고, 인자가 없으면 전부 끈다', () => {
  const { nav, items } = setup();
  nav.setRunning({ summary: true });
  assert.doesNotThrow(() => nav.setRunning({ plugin: true }));
  assert.equal(items.summary.className, 'sidebar-mode-item', '빠진 키는 false로 취급한다');
  nav.setRunning({ summary: true });
  nav.setRunning();
  assert.equal(items.summary.className, 'sidebar-mode-item');
});

test('실행중: 비-DOM 값이 섞여도 나머지는 정상 처리된다', () => {
  const items = { summary: fakeButton(), graph: null };
  const nav = createSidebarModeNav({ items });
  assert.doesNotThrow(() => nav.setRunning({ summary: true, graph: true }));
  assert.equal(items.summary.className, 'sidebar-mode-item has-running');
});

test('기존 setActive는 그대로다: setCounts/setRunning을 배선해도 active 전환이 불변', () => {
  const { nav, items, counts } = setupCounts();
  nav.setCounts({ summary: 3 });
  items.graph.dispatchEvent({ type: 'click' });
  assert.equal(items.graph.className, 'sidebar-mode-item is-active');
  assert.equal(items.summary.className, 'sidebar-mode-item');
  assert.equal(counts.summary.textContent, '3', 'active 전환이 카운트를 지우지 않는다');
});

test('실행중: 다른 모드를 눌러도(setActive) 도는 스피너 클래스는 살아남는다', () => {
  const { nav, items } = setup();
  nav.setRunning({ agent: true });
  nav.setActive('graph');
  assert.equal(items.graph.className, 'sidebar-mode-item is-active');
  assert.equal(items.agent.className, 'sidebar-mode-item has-running');
  nav.setActive('agent');
  assert.equal(items.agent.className, 'sidebar-mode-item is-active has-running');
  nav.setRunning({ agent: false });
  assert.equal(items.agent.className, 'sidebar-mode-item is-active');
});
