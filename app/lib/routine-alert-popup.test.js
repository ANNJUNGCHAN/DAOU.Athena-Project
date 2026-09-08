'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoutineAlertPopup } = require('./routine-alert-popup');

function fakeDocument() {
  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.attributes = {};
      this.listeners = {};
      this.parentNode = null;
      this.hidden = false;
      this.textContent = '';
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    removeChild(child) { this.children = this.children.filter((item) => item !== child); child.parentNode = null; }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    click() { if (this.listeners.click) this.listeners.click(); }
  }
  const body = new Element('body');
  return { body, createElement: (tagName) => new Element(tagName) };
}

function findByClass(root, className) {
  if (root.className === className) return root;
  for (const child of root.children) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return null;
}

function room(id, overrides) {
  return { id, title: `\uc54c\ub78c ${id}`, sub: `\uc2e4\ub370\uc774\ud130 ${id}`, firedAt: 1_700_000_000_000, ...overrides };
}

test('queues different routines and coalesces repeat fires by routine id', () => {
  const document = fakeDocument();
  const popup = createRoutineAlertPopup({ document, onOpen() {} });

  popup.show(room('a'));
  popup.show(room('b', { title: '\ucc98\uc74c b' }));
  popup.show(room('b', { title: '\ucd5c\uc2e0 b' }));

  assert.deepEqual(popup.getState(), { currentId: 'a', queuedIds: ['b'] });
  assert.equal(findByClass(document.body, 'routine-alert-popup__count').textContent, '\uc678 1\uac74');
  popup.dismiss();
  assert.equal(findByClass(document.body, 'routine-alert-popup__title').textContent, '\ucd5c\uc2e0 b');

  popup.show(room('b', { title: '\ud55c \ubc88 \ub354 \uc6b8\ub9b0 b' }));
  assert.deepEqual(popup.getState(), { currentId: 'b', queuedIds: [] });
  assert.equal(findByClass(document.body, 'routine-alert-popup__title').textContent, '\ud55c \ubc88 \ub354 \uc6b8\ub9b0 b');
});

test('dismiss advances without opening or acknowledging a routine', () => {
  const document = fakeDocument();
  const opened = [];
  const popup = createRoutineAlertPopup({ document, onOpen: (id) => opened.push(id) });
  popup.show(room('a'));
  popup.show(room('b'));

  assert.equal(popup.dismiss(), true);
  assert.deepEqual(opened, []);
  assert.deepEqual(popup.getState(), { currentId: 'b', queuedIds: [] });
});

test('agent choice opens the current routine id and advances', () => {
  const document = fakeDocument();
  const opened = [];
  const popup = createRoutineAlertPopup({ document, onOpen: (id) => opened.push(id) });
  popup.show(room('routine-17'));
  popup.show(room('routine-18'));

  findByClass(document.body, 'routine-alert-popup__agent').click();

  assert.deepEqual(opened, ['routine-17']);
  assert.equal(popup.getState().currentId, 'routine-18');
});

test('agent choice preserves the original routine id type', () => {
  const document = fakeDocument();
  const opened = [];
  const popup = createRoutineAlertPopup({ document, onOpen: (id) => opened.push(id) });
  popup.show(room(17));

  findByClass(document.body, 'routine-alert-popup__agent').click();

  assert.deepEqual(opened, [17]);
});

test('card choice opens only when the alarm has a confirmed main card', () => {
  const document = fakeDocument();
  const cards = [];
  const agents = [];
  const popup = createRoutineAlertPopup({
    document,
    onOpenCard: (id) => cards.push(id),
    onOpenAgent: (id) => agents.push(id),
  });
  popup.show(room('without-card'));
  const cardButton = findByClass(document.body, 'routine-alert-popup__card');
  const agentButton = findByClass(document.body, 'routine-alert-popup__agent');
  assert.equal(cardButton.disabled, true);
  assert.equal(findByClass(document.body, 'routine-alert-popup__card-hint').hidden, false);
  cardButton.click();
  assert.deepEqual(cards, []);
  assert.equal(popup.getState().currentId, 'without-card');
  agentButton.click();
  assert.deepEqual(agents, ['without-card']);

  popup.show(room('with-card', { mainCard: { title: '\uc2dc\uc138' } }));
  assert.equal(cardButton.disabled, false);
  assert.equal(findByClass(document.body, 'routine-alert-popup__card-hint').hidden, true);
  cardButton.click();
  assert.deepEqual(cards, ['with-card']);
});

test('invalid alarm data is ignored and does not create visible state', () => {
  const document = fakeDocument();
  const popup = createRoutineAlertPopup({ document, onOpen() {} });

  assert.equal(popup.show(null), false);
  assert.equal(popup.show({ id: '', title: '\uc54c\ub78c' }), false);
  assert.equal(popup.show({ id: 'a', title: '  ' }), false);
  assert.deepEqual(popup.getState(), { currentId: null, queuedIds: [] });
  assert.equal(findByClass(document.body, 'routine-alert-popup').hidden, true);
});

test('late card detail updates only an alarm that is still current or queued', () => {
  const document = fakeDocument();
  const popup = createRoutineAlertPopup({ document, onOpenAgent() {} });
  popup.show(room('a'));
  popup.show(room('b'));
  popup.dismiss();
  assert.equal(popup.getState().currentId, 'b');
  assert.equal(popup.update('a', { mainCard: { title: '시세' } }), false);
  assert.deepEqual(popup.getState(), { currentId: 'b', queuedIds: [] });
  assert.equal(findByClass(document.body, 'routine-alert-popup__card').disabled, true);
  assert.equal(popup.update('b', { mainCard: { title: '차트' } }), true);
  assert.equal(findByClass(document.body, 'routine-alert-popup__card').disabled, false);
});
