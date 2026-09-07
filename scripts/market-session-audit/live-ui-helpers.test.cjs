'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  EFFECTIVE_VISIBILITY_JS,
  buildPanelStateScript,
  sanitizeBootSnapshot,
  summarizeAccounts,
  summarizeMcpRegistry,
  summarizeModelPrefs,
  timeoutCode,
  validateAuditEnvironment,
  withRestoration,
} = require('./live-ui-helpers.cjs');

function fakeFs({ verify = false, onboarding = { accountDone: true, cliDone: true }, accounts = { activeId: null, accounts: [] } } = {}) {
  return {
    existsSync: (file) => verify || !file.endsWith('.athena-verify-profile.json'),
    statSync: () => ({ isDirectory: () => true }),
    readFileSync: (file) => JSON.stringify(file.endsWith('athena-onboarding.json') ? onboarding : accounts),
  };
}

test('requires a real profile and live safety gates', () => {
  assert.throws(() => validateAuditEnvironment({}, fakeFs()), /AUDIT_USERDATA_REQUIRED/);
  assert.throws(() => validateAuditEnvironment({ ATHENA_AUDIT_USERDATA: 'relative' }, fakeFs()), /NOT_ABSOLUTE/);
  const base = { ATHENA_AUDIT_USERDATA: 'C:\\profile', ATHENA_ENABLE_ORDER_API: 'false', ATHENA_ROUTINES_ENABLED: 'false' };
  assert.equal(validateAuditEnvironment(base, fakeFs()), 'C:\\profile');
  assert.throws(() => validateAuditEnvironment(base, fakeFs({ verify: true })), /VERIFY_PROFILE_FORBIDDEN/);
  assert.throws(() => validateAuditEnvironment(base, fakeFs({ onboarding: {} })), /PROFILE_MARKERS_INVALID/);
  assert.throws(() => validateAuditEnvironment({ ...base, ATHENA_NO_AUTOSTART: '1' }, fakeFs()), /AUTOSTART_BYPASS/);
  assert.throws(() => validateAuditEnvironment({ ...base, ATHENA_NO_AUTOSTART: 'true' }, fakeFs()), /AUTOSTART_BYPASS/);
  assert.throws(() => validateAuditEnvironment({ ...base, ATHENA_CANVAS_SOURCE: 'fixture' }, fakeFs()), /CANVAS_SOURCE_NOT_LIVE/);
  assert.equal(validateAuditEnvironment({ ...base, ATHENA_CANVAS_SOURCE: 'live' }, fakeFs()), 'C:\\profile');
});

test('boot snapshot strips labels and freeform detail', () => {
  const result = sanitizeBootSnapshot({
    phase: 'degraded', revision: 7,
    tasks: [{ id: 'stock-index', label: 'private label', detail: 'secret detail', kind: 'gate', state: 'failed', attempt: 2, retryable: true }],
  });
  assert.deepEqual(result.tasks, [{ id: 'stock-index', kind: 'gate', state: 'failed', attempt: 2, retryable: true, error_code: 'BOOT_TASK_FAILED' }]);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('account summary removes ids and keeps aggregate token states', () => {
  const result = summarizeAccounts({ accounts: [{ id: 'id-1', alias: 'private', active: true }] }, new Map([['id-1', 'ready']]));
  assert.deepEqual(result, {
    count: 1,
    active_count: 1,
    active_present: true,
    token_state_counts: { needed: 0, refreshing: 0, ready: 1, expired: 0, unknown: 0 },
  });
  assert.equal(JSON.stringify(result).includes('id-1'), false);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('model and MCP summaries retain aggregate status only', () => {
  assert.deepEqual(summarizeModelPrefs({ claude: { model: 'secret-model', effort: 'high' } }).providers[0], {
    id: 'claude', model_configured: true, effort_configured: true,
  });
  assert.deepEqual(summarizeMcpRegistry({ revision: 3, servers: [
    { alias: 'private-a', approved: true, toolCount: 4, health: 'ok' },
    { alias: 'private-b', approved: false, toolCount: 9, health: 'warning' },
  ] }), {
    count: 2, approved_count: 1, approved_tool_count: 4,
    health_counts: { ok: 1, warning: 1, unknown: 0 }, revision: 3,
  });
});

test('timeout labels are normalized to fixed error codes', () => {
  assert.equal(timeoutCode('shell handoff'), 'SHELL_HANDOFF_TIMEOUT');
});

test('restoration runs after a failed audit action', async () => {
  const events = [];
  await assert.rejects(withRestoration(async () => {
    events.push('work');
    throw new Error('failed');
  }, async () => {
    events.push('restore');
  }), /failed/);
  assert.deepEqual(events, ['work', 'restore']);
});

test('effective visibility rejects hidden ancestors and off-viewport geometry', () => {
  const windowObject = { innerWidth: 100, innerHeight: 100 };
  const documentObject = { getElementById: () => null };
  const getComputedStyle = (node) => node.style;
  const effective = Function('document', 'getComputedStyle', 'window', `${EFFECTIVE_VISIBILITY_JS}; return effective;`)(
    documentObject, getComputedStyle, windowObject,
  );
  const ancestor = {
    nodeType: 1, parentElement: null, hidden: false,
    style: { display: 'block', visibility: 'visible', opacity: '0' },
  };
  const node = {
    nodeType: 1, parentElement: ancestor, hidden: false, isConnected: true,
    style: { display: 'block', visibility: 'visible', opacity: '1' },
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({ left: 10, top: 10, right: 30, bottom: 30, width: 20, height: 20 }),
  };
  assert.equal(effective(node), false);
  ancestor.style.opacity = '1';
  assert.equal(effective(node), true);
  node.getBoundingClientRect = () => ({ left: 110, top: 10, right: 130, bottom: 30, width: 20, height: 20 });
  assert.equal(effective(node), false);
});

test('panel state script embeds its key and executes in the renderer VM', () => {
  const card = {
    nodeType: 1, parentElement: null, hidden: false, isConnected: true,
    style: { display: 'block', visibility: 'visible', opacity: '1' },
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({ left: 5, top: 5, right: 55, bottom: 55, width: 50, height: 50 }),
    querySelector: (selector) => selector === '.uk-history-section' ? {} : null,
    querySelectorAll: (selector) => ({ length: selector === '.uk-history-row' ? 2 : 0 }),
  };
  const documentObject = {
    getElementById: () => null,
    querySelector: (selector) => selector === '#settingsGrid > .card.history' ? card : null,
  };
  const result = Function(
    'document', 'getComputedStyle', 'window',
    `return ${buildPanelStateScript('history')};`,
  )(documentObject, (node) => node.style, { innerWidth: 100, innerHeight: 100 });
  assert.deepEqual(result, { rendered: true, effective: true, settled: true, aggregate_rows: 2 });
  assert.throws(() => buildPanelStateScript('unknown'), /SETTINGS_PANEL_KEY_INVALID/);
});
