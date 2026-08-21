'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { resolveWindowHtmlPath, waitForWindowReady } = require('./window-readiness');

function fakeWindow() {
  const win = new EventEmitter();
  win.webContents = new EventEmitter();
  return win;
}

test('readiness listener is active before a synchronous load emits ready-to-show', async () => {
  const win = fakeWindow();
  const ready = waitForWindowReady(win, { timeoutMs: 50 });
  win.loadFile = () => win.emit('ready-to-show');
  win.loadFile();
  await ready;
  assert.equal(win.listenerCount('ready-to-show'), 0);
});

test('main-frame load failure rejects and cleans readiness listeners', async () => {
  const win = fakeWindow();
  const ready = waitForWindowReady(win, { label: 'canvas', timeoutMs: 50 });
  win.webContents.emit('did-fail-load', {}, -6, 'FILE_NOT_FOUND', 'file:///canvas.html', true);
  await assert.rejects(ready, /canvas failed to load \(-6\): FILE_NOT_FOUND/);
  assert.equal(win.listenerCount('ready-to-show'), 0);
  assert.equal(win.webContents.listenerCount('render-process-gone'), 0);
});

test('readiness has a bounded timeout', async () => {
  const win = fakeWindow();
  await assert.rejects(
    waitForWindowReady(win, { label: 'chat', timeoutMs: 5 }),
    /chat ready-to-show timeout/,
  );
});

test('closed cleanup tolerates an already-destroyed webContents', async () => {
  const win = fakeWindow();
  win.webContents.isDestroyed = () => true;
  const ready = waitForWindowReady(win, { label: 'destroyed', timeoutMs: 50 });
  win.emit('closed');
  await assert.rejects(ready, /closed before ready-to-show/);
});

test('window HTML paths are absolute and anchored to the app directory', () => {
  const appDir = path.resolve('C:/repo/app');
  assert.equal(resolveWindowHtmlPath(appDir, 'canvas.html'), path.join(appDir, 'canvas.html'));
  assert.equal(resolveWindowHtmlPath(appDir, 'chat.html'), path.join(appDir, 'chat.html'));
  assert.throws(() => resolveWindowHtmlPath(appDir, '../secret.html'), /unsupported/);
});

test('normal Electron runtime contains no desktop capture polling that can starve direct REST paint', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const runnerSource = fs.readFileSync(path.join(__dirname, 'rest-dataset-runner.js'), 'utf8');
  const tokensSource = fs.readFileSync(path.join(__dirname, '..', '..', 'styles', 'tokens.css'), 'utf8');
  assert.doesNotMatch(mainSource, /desktopCapturer/);
  assert.doesNotMatch(mainSource, /startBackdropSampling|sampleBackdropOnce/);
  assert.doesNotMatch(mainSource, /setInterval\([^\n]*backdrop/i);
  assert.doesNotMatch(mainSource, /athena:backdrop-luminance/);
  assert.match(mainSource, /visiblePaintAt:\s*performance\.now\(\)/);
  assert.match(runnerSource, /clock\s*=\s*\(\)\s*=>\s*performance\.now\(\)/);
  assert.match(tokensSource, /--glass-window:\s*0\.30/);
  assert.match(tokensSource, /--glass-canvas:\s*0\.50/);
});
