'use strict';

const path = require('node:path');

function resolveWindowHtmlPath(appDir, filename) {
  if (!['canvas.html', 'chat.html'].includes(filename)) throw new Error('unsupported window html');
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
