'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function fakeElement() {
  const listeners = new Map();
  const classes = new Set();
  return {
    hidden: true,
    title: '',
    attributes: new Map(),
    classList: {
      toggle(name, active) {
        if (active) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); },
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    getBoundingClientRect() { return { x: 0, y: 0, width: 100, height: 26 }; },
    style: { setProperty() {} },
    setPointerCapture() {},
    hasPointerCapture() { return false; },
    releasePointerCapture() {},
    setAttribute(name, value) { this.attributes.set(name, value); },
    dispatch(type, event = {}) { listeners.get(type)?.(event); },
  };
}

function loadShell({ nativeWindowControls = false } = {}) {
  const ids = ['shell', 'dragStrip', 'winControls', 'winMin', 'winMax', 'winClose'];
  const elements = Object.fromEntries(ids.map((id) => [id, fakeElement()]));
  const sent = [];
  const subscriptions = new Map();
  const documentListeners = new Map();
  const window = {
    location: { search: nativeWindowControls ? '?shellHandoff=1' : '' },
    navigator: nativeWindowControls ? {
      windowControlsOverlay: {
        getTitlebarAreaRect() { return { x: 0, y: 0, width: 862, height: 32, right: 862 }; },
      },
    } : {},
    athena: {
      send(channel, payload) { sent.push({ channel, payload }); },
      on(channel, callback) {
        subscriptions.set(channel, callback);
        return () => subscriptions.delete(channel);
      },
    },
    addEventListener() {},
    getComputedStyle() { return { display: 'block', visibility: 'visible' }; },
    innerWidth: nativeWindowControls ? 1000 : 100,
    innerHeight: 100,
  };
  const document = {
    getElementById(id) { return elements[id]; },
    addEventListener(type, handler) { documentListeners.set(type, handler); },
  };
  const code = fs.readFileSync(path.join(__dirname, '..', 'shell.js'), 'utf8');
  vm.runInNewContext(code, { window, document, performance: { timeOrigin: 1 }, Math });
  return { elements, sent, subscriptions, window };
}

test('LIFE-002: WCO geometry uses the native titlebar safe area and excludes OS controls', () => {
  const { sent } = loadShell({ nativeWindowControls: true });
  const geometry = sent.find(({ channel }) => channel === 'athena:window-chrome-geometry')?.payload;
  assert.deepEqual({ ...geometry.titlebar }, { x: 0, y: 0, width: 862, height: 32 });
  assert.deepEqual({ ...geometry.controls }, { x: 862, y: 0, width: 138, height: 32 });
});

test('LIFE-002: maximize glyph and accessible labels follow authoritative OS state', () => {
  const { elements, subscriptions } = loadShell();
  const applyState = subscriptions.get('athena:window-state');
  assert.equal(typeof applyState, 'function');

  applyState({ maximized: true });
  assert.equal(elements.winMax.classList.contains('is-max'), true);
  assert.equal(elements.winMax.title, '이전 크기로 복원');
  assert.equal(elements.winMax.attributes.get('aria-label'), '이전 크기로 복원');

  applyState({ maximized: false });
  assert.equal(elements.winMax.classList.contains('is-max'), false);
  assert.equal(elements.winMax.title, '최대화');
  assert.equal(elements.winMax.attributes.get('aria-label'), '최대화');
});

test('LIFE-002: minimize and maximize buttons only request native window actions', () => {
  const { elements, sent } = loadShell();
  elements.winMin.dispatch('click');
  elements.winMax.dispatch('click');
  assert.deepEqual(sent.filter(({ channel }) => channel !== 'athena:window-chrome-geometry'), [
    { channel: 'athena:minimize-windows', payload: undefined },
    { channel: 'athena:toggle-maximize', payload: undefined },
  ]);
});

test('LIFE-002: renderer no longer infers maximize from screen geometry', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'shell.js'), 'utf8');
  assert.doesNotMatch(source, /window\.(?:outerWidth|outerHeight|screen\.availWidth|screen\.availHeight)/);
  assert.match(source, /window\.athena\.on\('athena:window-state', syncMaxButton\)/);
});

test('LIFE-002: WCO leaves caption double-click to Windows and preserves the drag area', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(__dirname, '..', 'shell.js'), 'utf8');
  const cssSource = fs.readFileSync(path.join(__dirname, '..', 'styles', 'ui-kit.css'), 'utf8');
  assert.doesNotMatch(mainSource, /ipcMain\.on\('athena:window-drag'/);
  assert.doesNotMatch(preloadSource, /athena:window-drag/);
  assert.doesNotMatch(shellSource, /titlebarSensor|addEventListener\('dblclick'/);
  assert.doesNotMatch(mainSource, /wireNativeTitlebarDoubleClick\(shellWin\)/);
  assert.match(shellSource, /getBoundingClientRect\(\)/);
  assert.match(shellSource, /athena:window-chrome-geometry/);
  assert.doesNotMatch(mainSource, /TITLEBAR_HEIGHT|WINDOW_CONTROLS_WIDTH|NATIVE_DOUBLE_CLICK_MS|NATIVE_DOUBLE_CLICK_DISTANCE/);
  assert.match(cssSource, /\.titlebar\s*\{[\s\S]*?-webkit-app-region:\s*drag/);
  assert.doesNotMatch(cssSource, /\.titlebar-label\s*\{[^}]*-webkit-app-region:\s*no-drag/);
});
