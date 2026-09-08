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

test('alarm confirmation opens the current routine id and advances', () => {
  const document = fakeDocument();
  const opened = [];
  const popup = createRoutineAlertPopup({ document, onOpen: (id) => opened.push(id) });
  popup.show(room('routine-17'));
  popup.show(room('routine-18'));

  findByClass(document.body, 'routine-alert-popup__open').click();

  assert.deepEqual(opened, ['routine-17']);
  assert.equal(popup.getState().currentId, 'routine-18');
});

test('alarm confirmation preserves the original routine id type', () => {
  const document = fakeDocument();
  const opened = [];
  const popup = createRoutineAlertPopup({ document, onOpen: (id) => opened.push(id) });
  popup.show(room(17));

  findByClass(document.body, 'routine-alert-popup__open').click();

  assert.deepEqual(opened, [17]);
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
