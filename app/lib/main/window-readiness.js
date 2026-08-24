'use strict';

const path = require('node:path');

// 로드 가능한 창 문서 화이트리스트. 임의 경로를 loadFile에 넘기지 못하게 막는다.
// 2026-08-24 리프 1.2.1: canvas.html·chat.html 두 창 문서가 shell.html 하나로
// 합쳐졌다. 옛 두 파일은 삭제됐으므로 목록에서도 뺀다 — 남겨두면 "아직 그 창을
// 띄울 수 있다"는 거짓 신호가 된다. 오브 창(1.3.1)이 orb.html을 여기 추가한다.
const WINDOW_HTML = ['shell.html'];

function resolveWindowHtmlPath(appDir, filename) {
  if (!WINDOW_HTML.includes(filename)) throw new Error('unsupported window html');
  return path.resolve(appDir, filename);
}

function waitForWindowReady(win, { label = 'window', timeoutMs = 5000 } = {}) {
  if (!win || !win.webContents) return Promise.reject(new Error(`${label} handle is missing`));
  const contents = win.webContents;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => finish();
    const onClosed = () => finish(new Error(`${label} closed before ready-to-show`));
    const onFailedLoad = (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame === false) return;
      finish(new Error(`${label} failed to load (${code}): ${description}`));
    };
    const onRenderGone = (_event, details = {}) => {
      finish(new Error(`${label} renderer exited before ready-to-show: ${details.reason || 'unknown'}`));
    };
    const timer = setTimeout(
      () => finish(new Error(`${label} ready-to-show timeout after ${timeoutMs}ms`)),
      timeoutMs,
    );
    const cleanup = () => {
      clearTimeout(timer);
      win.removeListener('ready-to-show', onReady);
      win.removeListener('closed', onClosed);
      try {
        if (typeof contents.isDestroyed !== 'function' || !contents.isDestroyed()) {
          contents.removeListener('did-fail-load', onFailedLoad);
          contents.removeListener('render-process-gone', onRenderGone);
        }
      } catch {}
    };
    win.once('ready-to-show', onReady);
    win.once('closed', onClosed);
    contents.on('did-fail-load', onFailedLoad);
    contents.once('render-process-gone', onRenderGone);
  });
}

module.exports = { resolveWindowHtmlPath, waitForWindowReady };
