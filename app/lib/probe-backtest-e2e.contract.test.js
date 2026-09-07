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

test('goDesignForm은 하위 탭이 있을 때만 폼 탭을 누른다', () => {
  const full = fs.readFileSync(path.join(__dirname, '..', 'probe-backtest-full.js'), 'utf8');
  const show = fs.readFileSync(path.join(__dirname, '..', 'probe-backtest-showcase.js'), 'utf8');
  for (const [name, src] of [['full', full], ['showcase', show]]) {
    const fn = src.slice(src.indexOf('async function goDesignForm'), src.indexOf('function addSymbol'));
    assert.match(fn, /backtest-subtab/, name);
    assert.match(fn, /if \(n > 1\)/, name);
    assert.match(fn, /goSubtab\(win, 1\)/, name);
  }
});

test('showcase 01번 샷은 목록 화면을 폼 하위탭이라고 쓰지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'probe-backtest-showcase.js'), 'utf8');
  const shot = src.slice(src.indexOf("shot(shellWin, '01-mode-empty'"), src.indexOf('02 지도 탭'));
  assert.match(shot, /하위 탭 없음/);
  assert.match(shot, /screen: c\.screen/);
  assert.match(shot, /subtabs:/);
  assert.doesNotMatch(shot, /폼 하위탭/);
});

test('probe-backtest-e2e records 기법 선택 and waits for the 폼 tab', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'probe-backtest-e2e.js'), 'utf8');
  assert.match(src, /01b-기법 선택/);
  assert.match(src, /01c-폼 탭 클릭/);
  assert.match(src, /designTab === 'form'/);
  assert.doesNotMatch(src, /if \(item\) item\.click\(\);\s*return true;/);
  assert.doesNotMatch(src, /if \(formTab\) formTab\.click\(\);\s*return true;/);
});
