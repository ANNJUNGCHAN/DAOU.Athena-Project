'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const glau = require('./glau-mascot');

test('runtime signals map to the ten approved Glau expressions', () => {
  const expected = { idle: 'neutral', listen: 'neutral', watch: 'neutral', think: 'thinking', done: 'happy', wink: 'wink', glad: 'joy', fired: 'surprised', surprise: 'surprised', frown: 'error', crying: 'cry', mopey: 'sad', sleep: 'sleepy', drowsy: 'sleepy' };
  for (const [state, expression] of Object.entries(expected)) assert.equal(glau.expressionForState(state), expression);
  assert.equal(new Set(Object.values(expected)).size, 10);
});

test('every expression preserves the approved silhouette and supports independent gaze and blink layers', () => {
  const silhouettes = new Set();
  const expressions = new Set();
  for (const expression of glau.EXPRESSIONS) {
    const svg = glau.svg(expression);
    silhouettes.add(svg.match(/<circle class="glau-body"[^>]+>/)[0]);
    expressions.add(svg.match(/<g class="glau-lid">([\s\S]*?)<\/g>/)[1]);
    assert.match(svg, /class="glau-gaze"/);
    assert.ok(!svg.includes(' id='), 'instances do not introduce duplicate IDs');
  }
  assert.equal(silhouettes.size, 1);
  assert.equal(expressions.size, 9, 'happy and joy share eyes, with joy adding its approved cue');
});

test('renderer updates expression only, never inserts runtime input as markup', () => {
  const host = { dataset: {}, innerHTML: '' };
  glau.render(host, 'crying');
  assert.match(host.innerHTML, /data-expression="cry"/);
  assert.equal((host.innerHTML.match(/class="glau-tear"/g) || []).length, 1);
  glau.render(host, '<img src=x onerror=alert(1)>');
  assert.match(host.innerHTML, /data-expression="neutral"/);
  assert.ok(!host.innerHTML.includes('<img'));
});