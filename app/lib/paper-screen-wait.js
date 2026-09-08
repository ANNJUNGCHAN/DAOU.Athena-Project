'use strict';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function domCountScript(selector, visibility) {
  if (visibility === 'any') {
    return `document.querySelectorAll(${JSON.stringify(selector)}).length`;
  }
  return `(() => {
    const visible = (el) => !!el && el.checkVisibility({ checkVisibilityCSS: true });
    return Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter(visible).length;
  })()`;
}

async function waitForDomCount(win, selector, expected, options = {}) {
  const timeoutMs = options.timeoutMs ?? 2000;
  const pollMs = options.pollMs ?? 100;
  const visibility = options.visibility ?? 'visible';
  const sleep = options.sleep ?? delay;
  let actual = null;

  for (let waited = 0; waited <= timeoutMs; waited += pollMs) {
    actual = await win.webContents.executeJavaScript(domCountScript(selector, visibility));
    if (actual === expected) return;
    if (waited < timeoutMs) await sleep(Math.min(pollMs, timeoutMs - waited));
  }

  const label = visibility === 'visible' ? '가시 개수' : 'DOM 개수';
  throw new Error(`DOM 조건 시간 초과 (${timeoutMs}ms): ${selector} ${label} 기대 ${expected}, 실제 ${actual}`);
}

module.exports = { waitForDomCount };
