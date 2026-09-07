'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('probe-backtest-e2e records 기법 선택 and waits for the 폼 tab', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'probe-backtest-e2e.js'), 'utf8');
  assert.match(src, /01b-기법 선택/);
  assert.match(src, /01c-폼 탭 클릭/);
  assert.match(src, /designTab === 'form'/);
  assert.doesNotMatch(src, /if \(item\) item\.click\(\);\s*return true;/);
  assert.doesNotMatch(src, /if \(formTab\) formTab\.click\(\);\s*return true;/);
});
