'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { measureScript } = require('./paper-screen-measure.js');
const { ROUTES } = require('./paper-screen-routes.js');

function fakeElement(text, shown) {
  return {
    textContent: text,
    checkVisibility: () => shown,
  };
}

test('the report measurement separates DOM presence, empty children, and visibility', () => {
  const root = fakeElement('', true);
  const history = fakeElement('', false);
  const input = fakeElement('', true);
  const matches = new Map([
    ['.shell-region', [fakeElement('', true), fakeElement('', true), fakeElement('', true)]],
    ['#history', [history]],
    ['#history > *', []],
    ['#input', [input]],
  ]);
  root.querySelectorAll = (selector) => matches.get(selector) ?? [];

  const document = {
    querySelector: (selector) => selector === '#shell' ? root : null,
    createTreeWalker: () => ({ nextNode: () => null }),
  };
  const route = ROUTES.find((item) => item.board === 'G5B-0');

  const measured = vm.runInNewContext(measureScript(route), { document });
  assert.deepEqual(Array.from(measured.structure, (item) => item.actual), [3, 1, 0, 0, 1]);
});
