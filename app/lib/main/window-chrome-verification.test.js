'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { summarizeWindowChromeVerification } = require('./window-chrome-verification');

const completePhysicalEvidence = {
  physicalDoubleClickObserved: true,
  rightClickSystemMenuObserved: true,
  nativeDragMoved: true,
  edgeSnapObserved: true,
  winZSnapLayoutsObserved: true,
  borderResizeObserved: true,
};

test('LIFE-002: any missing physical Windows interaction keeps the full gate inconclusive', () => {
  for (const key of Object.keys(completePhysicalEvidence)) {
    const result = summarizeWindowChromeVerification({
      automatedPassed: true,
      ...completePhysicalEvidence,
      [key]: false,
    });
    assert.equal(result.nativeInteractionVerification, 'inconclusive');
    assert.equal(result.conclusive, false);
    assert.equal(result.manualGateRequired, true);
    assert.equal(result.passed, false);
    assert.equal(result.missingPhysicalEvidence.length, 1);
  }
});

test('LIFE-002: full verification passes only with automation and every physical interaction', () => {
  const result = summarizeWindowChromeVerification({ automatedPassed: true, ...completePhysicalEvidence });
  assert.equal(result.nativeInteractionVerification, 'passed');
  assert.equal(result.conclusive, true);
  assert.equal(result.manualGateRequired, false);
  assert.equal(result.passed, true);
  assert.deepEqual(result.missingPhysicalEvidence, []);
});

test('LIFE-002: Electron probe exit follows the conclusive full gate, not the automated subset', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'probe-window-chrome.js'), 'utf8');
  assert.match(source, /app\.exit\(verification\.passed \? 0 : 1\)/);
  assert.doesNotMatch(source, /app\.exit\(automatedPassed \? 0 : 1\)/);
  assert.match(source, /rightClickSystemMenuObserved:\s*false/);
  assert.match(source, /winZSnapLayoutsObserved:\s*false/);
  assert.match(source, /borderResizeObserved:\s*false/);
});
