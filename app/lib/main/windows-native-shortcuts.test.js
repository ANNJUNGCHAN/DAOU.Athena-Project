'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainSource = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');

function hasWinArrowBeforeInputHandler(source) {
  const handlers = [...source.matchAll(
    /\.on\(\s*['"]before-input-event['"]\s*,([\s\S]*?)(?=\n\s*}\);)/g,
  )].map((match) => match[1]);
  return handlers.some((handler) => (
    /(?:input\s*\.\s*meta|metaKey|Super|WIN_ARROW_DIR)/i.test(handler)
    && /(?:WIN_ARROW_DIR|Arrow(?:Left|Right|Up|Down))/i.test(handler)
    && /preventDefault\s*\(/.test(handler)
  ));
}

function hasWinArrowGlobalShortcut(source) {
  const registrations = [...source.matchAll(
    /globalShortcut\s*\.\s*register(?:All)?\s*\(([\s\S]*?)(?=\);)/g,
  )].map((match) => match[1]);
  return registrations.some((registration) => (
    /\b(?:Super|Meta|Win(?:dows)?)\b/i.test(registration)
    && /\b(?:Arrow)?(?:Left|Right|Up|Down)\b/i.test(registration)
  ));
}

test('Win+Arrow는 renderer 입력이나 globalShortcut으로 가로채지 않는다', () => {
  assert.equal(hasWinArrowBeforeInputHandler(mainSource), false);
  assert.equal(hasWinArrowGlobalShortcut(mainSource), false);
  assert.doesNotMatch(
    mainSource,
    /(?:^|\n)\s*(?:const\s+WIN_ARROW_DIR\b|function\s+wireWindowsKeyShortcuts\b|wireWindowsKeyShortcuts\s*\()/,
  );
});

test('Win+Arrow 회귀 가드는 관련 없는 입력 처리와 단축키를 허용한다', () => {
  const unrelated = `
    win.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.key === 'k') event.preventDefault();
    });
    globalShortcut.register('CommandOrControl+K', openSearch);
  `;
  assert.equal(hasWinArrowBeforeInputHandler(unrelated), false);
  assert.equal(hasWinArrowGlobalShortcut(unrelated), false);

  const intercepted = `
    win.webContents.on('before-input-event', (event, input) => {
      if (!input.meta) return;
      const dir = WIN_ARROW_DIR[input.key];
      if (dir) event.preventDefault();
    });
    globalShortcut.register('Super+Left', snapLeft);
  `;
  assert.equal(hasWinArrowBeforeInputHandler(intercepted), true);
  assert.equal(hasWinArrowGlobalShortcut(intercepted), true);
});

test('Windows native Snap 대상이 되도록 shell 창은 resizable을 유지한다', () => {
  const commonWinOpts = mainSource.match(
    /function commonWinOpts\(bounds\) \{([\s\S]*?)(?=\nfunction\s|\nconst\s|\nlet\s)/,
  );
  assert.ok(commonWinOpts, 'commonWinOpts 함수 경계를 찾을 수 있어야 한다');
  assert.match(commonWinOpts[1], /(?:^|\n)\s*resizable:\s*true\s*,/);
});
