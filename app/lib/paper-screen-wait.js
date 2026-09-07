'use strict';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function visibleCountScript(selector) {
  return `(() => {
    const visible = (el) => !!el && el.checkVisibility({ checkVisibilityCSS: true });
    return Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter(visible).length;
  })()`;
}

async function waitForVisibleCount(win, selector, expected, options = {}) {
  const timeoutMs = options.timeoutMs ?? 2000;
  const pollMs = options.pollMs ?? 100;
  const sleep = options.sleep ?? delay;
  let actual = null;

  for (let waited = 0; waited <= timeoutMs; waited += pollMs) {
    actual = await win.webContents.executeJavaScript(visibleCountScript(selector));
    if (actual === expected) return;
    if (waited < timeoutMs) await sleep(Math.min(pollMs, timeoutMs - waited));
  }

  throw new Error(`DOM 조건 시간 초과 (${timeoutMs}ms): ${selector} 가시 개수 기대 ${expected}, 실제 ${actual}`);
}

module.exports = { waitForVisibleCount };
