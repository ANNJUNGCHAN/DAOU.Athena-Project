'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('main process does not relay raw model thinking while retaining Korean tool progress', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');

  assert.doesNotMatch(mainSource, /onThinkingDelta\s*:/);
  assert.doesNotMatch(mainSource, /athena:live-thinking-delta/);
  assert.match(mainSource, /onEvent:\s*\(ev\)\s*=>\s*\{[^}]*trackToolStep\(ev\)/s);
  assert.match(mainSource, /athena:live-tool-step/);
});
