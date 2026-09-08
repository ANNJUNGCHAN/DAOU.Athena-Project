'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const html = read('shell.html');
const css = read('chat.css');
const chat = read('chat.js');

test('composer mounts the shared neutral Glau after its renderer is loaded', () => {
  assert.equal((html.match(/class="glau-composer"/g) || []).length, 1);
  assert.ok(html.indexOf('src="lib/glau-mascot.js"') < html.indexOf('src="chat.js"'));
  assert.match(chat, /GlauMascot\.render\(\$dot\.querySelector\('\.glau-composer'\), 'idle'\)/);
  assert.match(html, /aria-label="글라우 옵션 메뉴"/);
});

test('mode switching does not replace the shared composer mascot', () => {
  assert.doesNotMatch(html + css, /kiumi-face-(chat|graph|agent|plugin|backtest)/);
  assert.ok(!css.includes('.dot[data-mode='));
  assert.match(read('lib/graph-mode/controller.js'), /if \(elements\.kiumi\) elements\.kiumi\.dataset\.mode = modeLabel/);
});

test('composer keeps its 22px footprint without the old pink robot shell', () => {
  const dot = css.slice(css.indexOf('.dot {'), css.indexOf('.glau-composer {'));
  assert.match(dot, /width: 22px; height: 22px/);
  assert.match(dot, /background: transparent; border: 0/);
});

test('reduced motion stops the blink without hiding the mascot', () => {
  assert.match(css, /\.glau-composer \.glau-lid \{ animation: glau-blink/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('@keyframes glau-blink')));
  assert.match(reduced, /\.glau-composer \.glau-lid \{ animation: none; \}/);
});
