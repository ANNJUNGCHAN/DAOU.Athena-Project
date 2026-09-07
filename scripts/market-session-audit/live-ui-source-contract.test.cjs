'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const runner = fs.readFileSync(path.join(__dirname, 'live-ui.cjs'), 'utf8');
const helper = fs.readFileSync(path.join(__dirname, 'live-ui-helpers.cjs'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'app', 'lib', 'sidebar.js'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'app', 'lib', 'settings-cards.js'), 'utf8');

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('mode navigation is blocked because product controls create persisted conversations', () => {
  assert.match(sidebar, /if \(modeChanged\) startNewConversation\(currentProjectId, view\)/);
  assert.match(sidebar, /invoke\('athena:conversations-new'/);
  assert.match(runner, /BLOCKED_NAV_CREATES_HISTORY/);
  assert.doesNotMatch(runner, /function clickById/);
  assert.doesNotMatch(runner, /getElementById\([^\n]*navId[^\n]*\.click/);
});

test('settings read effects are declared from the product source', () => {
  for (const channel of [
    'athena:settings:prefs:get', 'athena:account-list', 'athena:model-get', 'athena:cli-list',
    'athena:brain-profile-summary', 'athena:brain-conversations-count',
  ]) {
    assert.match(settings, new RegExp(escaped(channel)));
    assert.match(runner, new RegExp(escaped(channel)));
  }
  assert.match(runner, /BACKEND_READ_NOT_VERIFIED/);
  assert.doesNotMatch(runner, /history_queries:\s*0/);
});

test('effective visibility requires DOM connection, geometry, and computed style', () => {
  assert.match(helper, /node\.isConnected/);
  assert.match(helper, /getClientRects\(\)\.length > 0/);
  assert.match(helper, /getBoundingClientRect\(\)/);
  assert.match(helper, /style\.opacity/);
  assert.match(helper, /current = current\.parentElement/);
  assert.match(helper, /intersectsViewport/);
  assert.match(runner, /panel_effective/);
  assert.match(runner, /nonexpected_primary_hidden/);
});

test('runner records explicit actions and guarantees settings restoration', () => {
  assert.match(runner, /runner_explicit_actions/);
  assert.match(runner, /withRestoration\(/);
  assert.match(runner, /restoration\.attempted = true/);
  assert.doesNotMatch(runner, /safety:\s*\{/);
  assert.match(runner, /readiness\.tasks\.some\(\(task\) => task\.state === 'failed'\)/);
  assert.match(runner, /observedChecksOk \? 'BLOCKED' : 'FAIL'/);
});
