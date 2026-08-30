'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const shellCss = fs.readFileSync(path.join(__dirname, '..', 'shell.css'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function mediaBlock(maxWidth) {
  const marker = `@media (max-width: ${maxWidth}px)`;
  const start = shellCss.indexOf(marker);
  assert.notEqual(start, -1, `${marker} 규칙이 있어야 한다`);
  const next = shellCss.indexOf('@media ', start + marker.length);
  return shellCss.slice(start, next === -1 ? shellCss.length : next);
}

test('Paper 53: BrowserWindow 최소 폭은 330px이다', () => {
  assert.match(mainSource, /minW:\s*330\b/);
  assert.match(mainSource, /setMinimumSize\(DESIGN\.minW,\s*DESIGN\.minH\)/);
});

test('Paper 53: 700–1279px은 좌측 268px + 중앙과 하단 작성창을 유지한다', () => {
  const css = mediaBlock(1279);
  assert.match(css, /grid-template-columns:\s*268px\s+minmax\(0,\s*1fr\)/);
  assert.match(css, /grid-template-rows:\s*minmax\(0,\s*1fr\)\s+54px/);
  assert.match(css, /#historyRegion\s*\{[\s\S]*?grid-row:\s*1\s*\/\s*3/);
  assert.match(css, /#chatRegion\s*\{[\s\S]*?grid-column:\s*2[\s\S]*?grid-row:\s*2/);
  assert.match(css, /#chatRegion\s*>\s*\.app\s*>\s*:not\(\.input-stack\)/);
  assert.match(css, /#chatRegion\s*>\s*\.app\s*\{[\s\S]*?overflow:\s*visible/);
  assert.match(css, /#chatRegion\s+\.input-stack\s*\{[\s\S]*?position:\s*absolute[\s\S]*?bottom:\s*0/);
});

test('Paper 53: 330–699px은 44px 아이콘 레일과 단일 중앙 열이다', () => {
  const css = mediaBlock(699);
  assert.match(css, /grid-template-columns:\s*44px\s+minmax\(0,\s*1fr\)/);
  assert.match(css, /#historyRegion\s*\{[\s\S]*?width:\s*44px/);
  assert.match(css, /\.sidebar-mode-item-label[\s\S]*?display:\s*none\s*!important/);
  assert.match(css, /\.sidebar-list[\s\S]*?display:\s*none\s*!important/);
  assert.match(css, /\.sidebar-mode-item\s*\{[\s\S]*?width:\s*34px[\s\S]*?height:\s*34px/);
});
