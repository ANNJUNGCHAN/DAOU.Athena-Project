// IIFE 스코프 격리 — ranking-axis.js와 같은 이유(렌더러 스크립트 스코프 공유).
(function () {
'use strict';

// 캔버스 = 탭 스트립 + 뷰포트 1개(캔버스 탭 계획 §1). 키움 보드 카드는 모자이크
// 2열(.grid)에 나란히 눕지 않고, 탭 하나 = 카드 인스턴스 하나로 뷰포트를 나눠 쓴다.
// 카드 크기 = 뷰포트 크기이므로 모든 카드 크기가 같아진다.
//
// 탭 스트립은 셸 크롬이지 카드가 아니다 — 그래서 이 모듈은 카드 내부를 전혀
// 모른다. 카드 root 엘리먼트를 받아 뷰포트 패널로 옮기기만 한다.

const STORAGE_KEY = 'athena.canvas.tabs';

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// 계좌번호는 탭 제목에 원문으로 두지 않는다 — 뒤 4자리만 남긴다(계획 §1 `계좌 · ****4721`).
function maskAccount(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 4 ? `****${digits.slice(-4)}` : '****';
}

// 대상 표기는 있는 값만 쓴다 — 종목명이 없으면 코드, 그것도 없으면 계좌 뒤 4자리.
// 없는 이름을 지어내지 않는다(헌장 신념 5·13).
function targetLabel(envelope) {
  const args = (envelope && (envelope.operation_args || envelope.arguments)) || {};
  const data = (envelope && envelope.data) || {};
  const name = clean(envelope && envelope.stk_nm) || clean(args.stk_nm) || clean(data.stk_nm);
  if (name) return name;
  const code = clean(envelope && envelope.stk_cd) || clean(args.stk_cd)
    || clean(envelope && envelope.symbol) || clean(args.symbol);
  if (code) return code;
  const account = clean(envelope && envelope.account_id) || clean(envelope && envelope.account_no)
    || clean(args.account_id) || clean(args.account_no) || clean(args.acnt_no);
  return account ? maskAccount(account) : null;
}

// 탭 제목 = `카드명 · 대상`. 카드명은 봉투가 싣고 오는 고정 카드 제목(16종)을 쓰고,
// 없으면 호출부가 준 통합 카드 제목으로 떨어진다.
function tabTitleFor(envelope, fallbackTitle) {
  const name = clean(envelope && envelope.card_title) || clean(fallbackTitle) || '카드';
  const target = targetLabel(envelope);
  return target ? `${name} · ${target}` : name;
}

function readState(storage, key) {
  if (!storage) return { order: [], active: null };
  try {
    const parsed = JSON.parse(storage.getItem(key) || '{}');
    return {
      order: Array.isArray(parsed.order) ? parsed.order.filter((k) => typeof k === 'string') : [],
      active: typeof parsed.active === 'string' ? parsed.active : null,
    };
  } catch {
    return { order: [], active: null };
  }
}

function writeState(storage, key, state) {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify({ order: state.order, active: state.active }));
  } catch {
    // 세션 저장은 편의일 뿐이다 — 못 쓰더라도 탭 자체는 계속 동작한다.
  }
}

function createDeck(options = {}) {
  const doc = options.doc || (typeof document !== 'undefined' ? document : null);
  if (!doc) return null;
  const storageKey = options.storageKey || STORAGE_KEY;
  const storage = options.storage === undefined
    ? (typeof window !== 'undefined' && window.sessionStorage) || null
    : options.storage;
  const saved = readState(storage, storageKey);

  const element = doc.createElement('div');
  element.className = 'canvas-tab-deck';
  const strip = doc.createElement('div');
  strip.className = 'canvas-tab-strip';
  strip.setAttribute('role', 'tablist');
  strip.setAttribute('aria-label', '캔버스 카드 탭');
  const viewport = doc.createElement('div');
  viewport.className = 'canvas-tab-viewport';
  element.appendChild(strip);
  element.appendChild(viewport);

  const tabs = new Map();
  const deck = {
    element, strip, viewport, doc,
    order: [], active: null, dragKey: null,
    savedOrder: saved.order, savedActive: saved.active,
  };

  function persist() {
    writeState(storage, storageKey, { order: deck.order, active: deck.active });
  }

  function paint() {
    for (const entry of tabs.values()) {
      const isActive = entry.key === deck.active;
      entry.tab.className = `canvas-tab${isActive ? ' is-active' : ''}`;
      entry.tab.setAttribute('aria-selected', String(isActive));
      entry.tab.tabIndex = isActive ? 0 : -1;
      entry.panel.className = `canvas-tab-panel${isActive ? ' is-active' : ''}`;
      entry.panel.hidden = !isActive;
    }
    element.dataset.tabCount = String(deck.order.length);
  }

  function activate(key) {
    if (!tabs.has(key)) return null;
    deck.active = key;
    paint();
    persist();
    return key;
  }

  // 세션에 남은 순서를 존중한다 — 저장된 순서에 있는 키는 그 자리에, 처음 보는
  // 키는 맨 뒤에 붙인다.
  function insertOrdered(key) {
    const savedIndex = deck.savedOrder.indexOf(key);
    if (savedIndex < 0) { deck.order.push(key); return; }
    const at = deck.order.findIndex((other) => {
      const otherIndex = deck.savedOrder.indexOf(other);
      return otherIndex < 0 || otherIndex > savedIndex;
    });
    if (at < 0) deck.order.push(key);
    else deck.order.splice(at, 0, key);
  }

  function reflowStrip() {
    for (const key of deck.order) {
      const entry = tabs.get(key);
      if (entry) strip.appendChild(entry.tab);
    }
  }

  function close(key) {
    const entry = tabs.get(key);
    if (!entry) return null;
    const index = deck.order.indexOf(key);
    tabs.delete(key);
    deck.order = deck.order.filter((other) => other !== key);
    deck.savedOrder = deck.savedOrder.filter((other) => other !== key);
    entry.tab.remove();
    entry.panel.remove();
    if (deck.active === key) {
      deck.active = deck.order[Math.min(index, deck.order.length - 1)] || null;
    }
    paint();
    persist();
    if (typeof options.onClose === 'function') options.onClose(entry.card, key);
    return entry.card;
  }

  function focusTab(key) {
    const entry = tabs.get(key);
    if (entry && typeof entry.tab.focus === 'function') entry.tab.focus();
  }

  // 좌우 화살표 = 탭 전환(ARIA tabs 관행). 목록 끝에서 반대편으로 돈다. 순서
  // 바꾸기는 드래그가 하고 화살표는 전환만 한다 — 두 손짓이 겹치지 않는다.
  function step(key, delta) {
    const at = deck.order.indexOf(key);
    if (at < 0 || !deck.order.length) return null;
    const next = deck.order[(at + delta + deck.order.length) % deck.order.length];
    if (!next || next === key) return next || null;
    activate(next);
    focusTab(next);
    return next;
  }

  // HTML5 드래그로 순서를 바꾼다. dataTransfer는 브라우저가 주는 것이라 없을 수도
  // 있어(테스트 스텁·일부 경로) 끌고 있는 키를 덱에도 적어 둔다.
  function beginDrag(key, event) {
    deck.dragKey = key;
    const transfer = event && event.dataTransfer;
    if (transfer) {
      transfer.effectAllowed = 'move';
      try { transfer.setData('text/plain', key); } catch { /* 일부 브라우저는 dragstart 밖 setData를 막는다 */ }
    }
    const entry = tabs.get(key);
    if (entry) entry.tab.dataset.dragging = 'true';
  }

  function endDrag() {
    const entry = deck.dragKey ? tabs.get(deck.dragKey) : null;
    if (entry) delete entry.tab.dataset.dragging;
    deck.dragKey = null;
  }

  function dropOn(key, event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const transfer = event && event.dataTransfer;
    const from = deck.dragKey
      || (transfer && typeof transfer.getData === 'function' ? transfer.getData('text/plain') : '');
    endDrag();
    if (!from || from === key || !tabs.has(from) || !tabs.has(key)) return null;
    return move(from, deck.order.indexOf(key));
  }

  function createEntry(key, title) {
    const tab = doc.createElement('button');
    tab.type = 'button';
    tab.className = 'canvas-tab';
    tab.setAttribute('role', 'tab');
    tab.draggable = true;
    tab.dataset.tabKey = key;
    const label = doc.createElement('span');
    label.className = 'canvas-tab-label';
    label.textContent = title;
    const closeButton = doc.createElement('span');
    closeButton.className = 'canvas-tab-close';
    closeButton.setAttribute('role', 'button');
    closeButton.setAttribute('aria-label', `${title} 탭 닫기`);
    closeButton.textContent = '×';
    closeButton.addEventListener('click', (event) => {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      close(key);
    });
    tab.appendChild(label);
    tab.appendChild(closeButton);
    tab.addEventListener('click', () => activate(key));
    tab.addEventListener('keydown', (event) => {
      const delta = event && event.key === 'ArrowRight' ? 1 : (event && event.key === 'ArrowLeft' ? -1 : 0);
      if (!delta) return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      step(key, delta);
    });
    tab.addEventListener('dragstart', (event) => beginDrag(key, event));
    // dragover에서 preventDefault를 안 하면 브라우저가 drop을 아예 안 준다.
    tab.addEventListener('dragover', (event) => {
      if (!deck.dragKey) return;
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      if (event && event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    });
    tab.addEventListener('drop', (event) => dropOn(key, event));
    tab.addEventListener('dragend', () => endDrag());

    const panel = doc.createElement('div');
    panel.className = 'canvas-tab-panel';
    panel.setAttribute('role', 'tabpanel');
    panel.dataset.tabKey = key;
    viewport.appendChild(panel);

    const entry = { key, title, tab, label, closeButton, panel, card: null };
    tabs.set(key, entry);
    insertOrdered(key);
    reflowStrip();
    return entry;
  }

  // 같은 인스턴스 키의 후속 봉투는 새 탭을 만들지 않고 그 탭을 갱신한다
  // (integrated-card-surface의 "같은 인스턴스 갱신" 계약 그대로).
  function upsert(card, meta = {}) {
    const key = clean(meta.key);
    if (!card || !key) return null;
    const title = clean(meta.title) || key;
    let entry = tabs.get(key);
    if (!entry) entry = createEntry(key, title);
    if (entry.title !== title) {
      entry.title = title;
      entry.label.textContent = title;
      entry.closeButton.setAttribute('aria-label', `${title} 탭 닫기`);
    }
    if (entry.card !== card) {
      entry.panel.replaceChildren(card);
      entry.card = card;
    }
    activate(key);
    return entry;
  }

  function move(key, index) {
    if (!tabs.has(key)) return null;
    const rest = deck.order.filter((other) => other !== key);
    const at = Math.max(0, Math.min(index, rest.length));
    rest.splice(at, 0, key);
    deck.order = rest;
    deck.savedOrder = rest.slice();
    reflowStrip();
    persist();
    return deck.order.slice();
  }

  Object.assign(deck, {
    upsert, activate, close, move, paint, step, beginDrag, dropOn, endDrag,
    has: (key) => tabs.has(key),
    keys: () => deck.order.slice(),
    activeKey: () => deck.active,
    cardFor: (key) => (tabs.get(key) ? tabs.get(key).card : null),
    cards: () => deck.order.map((key) => tabs.get(key).card).filter(Boolean),
    titleFor: (key) => (tabs.get(key) ? tabs.get(key).title : null),
  });
  paint();
  return deck;
}

const __exports = { STORAGE_KEY, maskAccount, targetLabel, tabTitleFor, createDeck };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.CanvasTabs = __exports;
}

})();
