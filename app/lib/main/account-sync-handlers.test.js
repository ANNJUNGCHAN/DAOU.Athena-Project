'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function functionSource(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const open = source.indexOf(') {', start) + 2;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unclosed ${signature}`);
}

function runtime({ syncOk = true, removeOk = true } = {}) {
  let active = 'account-a';
  const calls = [];
  const context = vm.createContext({
    accounts: {
      register: async (payload) => payload.verifyOnly ? { ok: true, verified: true } : { ok: true, id: 'account-b' },
      syncBackendAccount: async (options) => {
        calls.push(['sync', options.id]);
        assert.equal(options.authorization, 'Bearer test');
        assert.equal(options.backendBase, 'http://127.0.0.1:8010');
        return syncOk ? { ok: true, backendAlias: 'verified' } : { ok: false, error: '연결 실패' };
      },
      setActive: (id) => { active = id; calls.push(['select', id]); return { ok: true }; },
      orderApiSet: (id, enabled) => { calls.push(['order', id, enabled]); return { ok: true, checklist: [{ key: 'orderApi', met: enabled }] }; },
      removeFromBackend: async ({ id }) => {
        calls.push(['remote-remove', id]);
        return removeOk ? { ok: true } : { ok: false, error: '삭제 실패' };
      },
      remove: (id) => { calls.push(['local-remove', id]); active = 'account-b'; return { ok: true }; },
    },
    activeRestAccountId: () => active,
    resetAccountBoundRealtime: async () => { calls.push(['reset']); },
    BACKEND_HTTP_BASE: 'http://127.0.0.1:8010',
    backendAccountAuthorization: () => 'Bearer test',
    fetch: async () => { throw new Error('unexpected fetch'); },
  });
  const source = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
  vm.runInContext([
    'function syncSelectedAccount(',
    'async function handleAccountRegister(',
    'async function handleAccountSetActive(',
    'async function handleAccountSetBackendAlias(',
    'async function handleAccountRemove(',
    'async function handleOrderApiSet(',
  ].map((signature) => functionSource(source, signature)).join('\n'), context);
  return { context, calls, active: () => active };
}

test('registration synchronizes only saved credentials; verify-only does not provision backend', async () => {
  const r = runtime();
  assert.equal((await r.context.handleAccountRegister(null, { verifyOnly: true })).verified, true);
  assert.deepEqual(r.calls, []);
  assert.equal((await r.context.handleAccountRegister(null, {})).backendConnected, true);
  assert.deepEqual(r.calls, [['sync', 'account-b']]);
});

test('saved account reports connection failure without disguising it as readiness', async () => {
  const r = runtime({ syncOk: false });
  const result = await r.context.handleAccountRegister(null, {});
  assert.equal(result.ok, true);
  assert.equal(result.backendConnected, false);
  assert.equal(result.backendSyncError, '연결 실패');
});

test('switch clears previous realtime then synchronizes selected account without fallback', async () => {
  const r = runtime({ syncOk: false });
  const result = await r.context.handleAccountSetActive(null, { id: 'account-b' });
  assert.equal(result.backendConnected, false);
  assert.equal(r.active(), 'account-b');
  assert.deepEqual(r.calls, [['select', 'account-b'], ['reset'], ['sync', 'account-b']]);
});

test('legacy mapping IPC ignores caller supplied server alias', async () => {
  const r = runtime();
  await r.context.handleAccountSetBackendAlias(null, { id: 'account-a', backendAlias: 'wrong-account' });
  assert.deepEqual(r.calls, [['sync', 'account-a'], ['reset']]);
});

test('removal releases backend account before deleting local credentials', async () => {
  const r = runtime();
  assert.equal((await r.context.handleAccountRemove(null, { id: 'account-a' })).ok, true);
  assert.deepEqual(r.calls, [['remote-remove', 'account-a'], ['local-remove', 'account-a'], ['reset'], ['sync', 'account-b']]);
});

test('backend removal failure preserves local account', async () => {
  const r = runtime({ removeOk: false });
  assert.equal((await r.context.handleAccountRemove(null, { id: 'account-a' })).ok, false);
  assert.deepEqual(r.calls, [['remote-remove', 'account-a']]);
  assert.equal(r.active(), 'account-a');
});

test('order permission is synchronized and a failed enable is compensated by OFF', async () => {
  const r = runtime({ syncOk: false });
  const result = await r.context.handleOrderApiSet(null, { id: 'account-a', enabled: true });
  assert.equal(result.ok, false);
  assert.equal(result.orderApi, false);
  assert.equal(result.checklist[0].met, false);
  assert.deepEqual(r.calls, [
    ['order', 'account-a', true], ['sync', 'account-a'],
    ['order', 'account-a', false], ['sync', 'account-a'],
  ]);
  assert.match(result.error, /OFF/);
});

test('failed backend disable leaves local order gate OFF and reports pending server confirmation', async () => {
  const r = runtime({ syncOk: false });
  const result = await r.context.handleOrderApiSet(null, { id: 'account-a', enabled: false });
  assert.equal(result.ok, false);
  assert.deepEqual(r.calls, [['order', 'account-a', false], ['sync', 'account-a']]);
});
