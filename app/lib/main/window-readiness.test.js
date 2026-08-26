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
  assert.equal(resolveWindowHtmlPath(appDir, 'shell.html'), path.join(appDir, 'shell.html'));
  // 2026-08-24 리프 1.3.1: 알림 오브 창의 문서가 추가됐다 — 창 문서는 정확히 둘이다.
  assert.equal(resolveWindowHtmlPath(appDir, 'orb.html'), path.join(appDir, 'orb.html'));
  assert.throws(() => resolveWindowHtmlPath(appDir, '../secret.html'), /unsupported/);
  // 화이트리스트에 남아 있으면 "아직 띄울 수 있다"는 거짓 신호가 되므로 거부를 단언한다.
  assert.throws(() => resolveWindowHtmlPath(appDir, 'chat.html'), /unsupported/);
  assert.throws(() => resolveWindowHtmlPath(appDir, 'canvas.html'), /unsupported/);
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
  // 사다리는 런타임 샘플링이 아니라 **정적 토큰**이어야 한다는 것이 이 단언의 요지다.
  // 2026-08-22 팔레트 반전(사용자 지시 "애플 Liquid Glass 형태 그대로")으로 값 자체는
  // 바뀌었고 투명도 3단(clear/default/opaque)이 생겼다 — 값을 못박는 대신 기본 단계가
  // 정적 리터럴이고 순서 계약(window < card < canvas < window-max)이 성립함을 본다.
  const ladder = ['window', 'card', 'canvas', 'window-max'].map((key) => {
    const found = tokensSource.match(new RegExp(`--glass-${key}:\\s*(\\d*\\.?\\d+);`));
    assert.ok(found, `--glass-${key} 정적 리터럴이 없다`);
    return Number(found[1]);
  });
  assert.deepEqual(ladder, [...ladder].sort((a, b) => a - b), '유리 사다리 순서 계약 위반');
});
