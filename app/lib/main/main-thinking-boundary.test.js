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

test('an unready simple-chart guard allows one model-free Selector attempt but blocks cold and full Claude fallback', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const selectorHandled = mainSource.indexOf('if (selectorResult.handled)');
  const inferenceGuard = mainSource.indexOf('if (simpleChartRoute.inferenceFallback)', selectorHandled);
  const coldSelector = mainSource.indexOf('selectorColdHedge.runSelectorColdHedge', selectorHandled);

  assert.ok(selectorHandled >= 0);
  assert.ok(inferenceGuard > selectorHandled);
  assert.ok(coldSelector > inferenceGuard);
  assert.ok(mainSource.indexOf('simpleChartRoute.inferenceFallback', coldSelector) >= 0);
});
