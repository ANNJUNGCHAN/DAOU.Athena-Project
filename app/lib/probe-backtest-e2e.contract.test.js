'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('probe-backtest-full A08은 목록 화면을 폼이라고 말하지 않고 없는 하위 탭을 누르지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'probe-backtest-full.js'), 'utf8');
  const a08 = src.slice(src.indexOf("step('A08'"), src.indexOf("step('A05'"));
  assert.match(a08, /subtabs\.designTab === null/);
  assert.match(a08, /subtabs\.screen === 'technique-list'/);
  assert.doesNotMatch(a08, /goSubtab/);
});

test('probe-backtest-e2e records 기법 선택 and waits for the 폼 tab', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'probe-backtest-e2e.js'), 'utf8');
  assert.match(src, /01b-기법 선택/);
  assert.match(src, /01c-폼 탭 클릭/);
  assert.match(src, /designTab === 'form'/);
  assert.doesNotMatch(src, /if \(item\) item\.click\(\);\s*return true;/);
  assert.doesNotMatch(src, /if \(formTab\) formTab\.click\(\);\s*return true;/);
});
