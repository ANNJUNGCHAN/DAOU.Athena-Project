'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-accounts-test-'));
const originalLoad = Module._load;
Module._load = function mockElectron(request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: { getPath: () => userDataDir },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(value, 'utf8'),
        decryptString: (value) => value.toString('utf8'),
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const accounts = require('./accounts');
Module._load = originalLoad;
const AUTHORIZATION = 'Bearer local-token';

test.after(() => fs.rmSync(userDataDir, { recursive: true, force: true }));

function writeAccounts(entries, activeId = entries[0]?.id || null) {
  fs.writeFileSync(path.join(userDataDir, 'athena-accounts.json'), JSON.stringify({ activeId, accounts: entries }));
}

function readyResponse(aliases, { ok = true } = {}) {
  return {
    ok,
    json: async () => ({
      default: aliases[0] || null,
      accounts: Object.fromEntries(aliases.map((alias) => [alias, { ready: true }])),
    }),
  };
}

test('서버 계좌 목록은 인증된 /ready/accounts 응답의 alias만 반환한다', async () => {
  const calls = [];
  const result = await accounts.listBackendAliases({
    backendBase: 'http://backend',
    authorization: AUTHORIZATION,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return readyResponse(['account-b', 'account-a']);
    },
  });
  assert.deepEqual(result, { ok: true, aliases: ['account-a', 'account-b'] });
  assert.equal(calls[0].url, 'http://backend/ready/accounts');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer local-token');
  assert.equal(calls[0].options.redirect, 'error');
});

test('local bearer가 없으면 metadata 요청 자체를 보내지 않는다', async () => {
  let fetches = 0;
  const result = await accounts.listBackendAliases({
    backendBase: 'http://backend',
    fetchImpl: async () => { fetches += 1; return readyResponse(['server-a']); },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /인증이 없다/);
  assert.equal(fetches, 0);
});

test('사용자가 고른 backendAlias를 로컬 표시 별칭과 별도 저장하고 다시 읽는다', async () => {
  writeAccounts([{ id: 'local-a', alias: '내 모의계좌' }]);
  const bound = await accounts.bindBackendAlias({
    id: 'local-a',
    backendAlias: 'server-a',
    backendBase: 'http://backend',
    authorization: AUTHORIZATION,
    fetchImpl: async () => readyResponse(['server-a', 'server-b']),
  });
  assert.equal(bound.ok, true);
  assert.equal(accounts.list().accounts[0].alias, '내 모의계좌');
  assert.equal(accounts.list().accounts[0].backendAlias, 'server-a');
});

test('두 로컬 계좌는 각각 명시 저장한 서버 alias로 해석된다', async () => {
  writeAccounts([
    { id: 'local-a', alias: '표시 A', backendAlias: 'server-a' },
    { id: 'local-b', alias: '표시 B', backendAlias: 'server-b' },
  ]);
  const fetchImpl = async () => readyResponse(['server-a', 'server-b']);
  const a = await accounts.resolveBackendAlias({
    id: 'local-a', backendBase: 'http://backend', fetchImpl, authorization: AUTHORIZATION,
  });
  const b = await accounts.resolveBackendAlias({
    id: 'local-b', backendBase: 'http://backend', fetchImpl, authorization: AUTHORIZATION,
  });
  assert.deepEqual(a, { ok: true, accountId: 'local-a', backendAlias: 'server-a' });
  assert.deepEqual(b, { ok: true, accountId: 'local-b', backendAlias: 'server-b' });
});

test('mapping 누락은 metadata 요청 전 차단하고 표시 별칭을 추측하지 않는다', async () => {
  writeAccounts([{ id: 'local-a', alias: 'server-a' }]);
  let fetches = 0;
  const result = await accounts.resolveBackendAlias({
    id: 'local-a',
    backendBase: 'http://backend',
    authorization: AUTHORIZATION,
    fetchImpl: async () => { fetches += 1; return readyResponse(['server-a']); },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /먼저 연결/);
  assert.equal(fetches, 0);
});

test('metadata 실패나 현재 목록에 없는 alias는 저장·해석하지 않는다', async () => {
  writeAccounts([{ id: 'local-a', alias: '표시 A' }]);
  const unavailable = await accounts.bindBackendAlias({
    id: 'local-a', backendAlias: 'server-a', backendBase: 'http://backend',
    authorization: AUTHORIZATION,
    fetchImpl: async () => readyResponse([], { ok: false }),
  });
  assert.equal(unavailable.ok, false);
  assert.equal(accounts.list().accounts[0].backendAlias, '');

  const unknown = await accounts.bindBackendAlias({
    id: 'local-a', backendAlias: 'server-a', backendBase: 'http://backend',
    authorization: AUTHORIZATION,
    fetchImpl: async () => readyResponse(['server-b']),
  });
  assert.equal(unknown.ok, false);
  assert.equal(accounts.list().accounts[0].backendAlias, '');

  writeAccounts([{ id: 'local-a', alias: '표시 A', backendAlias: 'server-a' }]);
  const stale = await accounts.resolveBackendAlias({
    id: 'local-a', backendBase: 'http://backend',
    authorization: AUTHORIZATION,
    fetchImpl: async () => readyResponse(['server-b']),
  });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /현재 backend에 없다/);
});

test('늦게 끝난 이전 선택은 더 최근에 저장된 서버 alias를 덮어쓰지 않는다', async () => {
  writeAccounts([{ id: 'local-a', alias: '표시 A' }]);
  let resolveOlder;
  let resolveNewer;
  const olderResponse = new Promise((resolve) => { resolveOlder = resolve; });
  const newerResponse = new Promise((resolve) => { resolveNewer = resolve; });

  const older = accounts.bindBackendAlias({
    id: 'local-a', backendAlias: 'server-a', backendBase: 'http://backend',
    authorization: AUTHORIZATION,
    fetchImpl: async () => olderResponse,
  });
  const newer = accounts.bindBackendAlias({
    id: 'local-a', backendAlias: 'server-b', backendBase: 'http://backend',
    authorization: AUTHORIZATION,
    fetchImpl: async () => newerResponse,
  });

  resolveNewer(readyResponse(['server-a', 'server-b']));
  const newerResult = await newer;
  assert.equal(newerResult.ok, true);
  assert.equal(accounts.list().accounts[0].backendAlias, 'server-b');

  resolveOlder(readyResponse(['server-a', 'server-b']));
  const olderResult = await older;
  assert.equal(olderResult.ok, false);
  assert.equal(olderResult.stale, true);
  assert.equal(accounts.list().accounts[0].backendAlias, 'server-b');
});

test('기동 선발급: 활성 계좌가 없으면 발급하지 않고 no-account로 끝난다', async () => {
  writeAccounts([], null);
  let refreshed = 0;
  const result = await accounts.ensureActiveToken({ refresh: async () => { refreshed += 1; return { ok: true, state: 'ready' }; } });
  assert.deepEqual(result, { ok: true, skipped: true, reason: 'no-account' });
  assert.equal(refreshed, 0);
});

test('기동 선발급: 10분 넘게 남은 토큰은 그대로 두고 발급하지 않는다', async () => {
  const expires = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  writeAccounts([{ id: 'local-a', alias: '표시 A', tokenExpiresAt: expires }]);
  let refreshed = 0;
  const result = await accounts.ensureActiveToken({ refresh: async () => { refreshed += 1; return { ok: true, state: 'ready' }; } });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'still-valid');
  assert.equal(result.alias, '표시 A');
  assert.ok(result.expiresInSec > 600);
  assert.equal(refreshed, 0);
});

test('기동 선발급: 토큰이 없거나 만료 임박이면 활성 계좌로 재발급한다', async () => {
  writeAccounts([
    { id: 'local-a', alias: '표시 A' },
    { id: 'local-b', alias: '표시 B', tokenExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() },
  ], 'local-b');
  const calls = [];
  const result = await accounts.ensureActiveToken({
    refresh: async (id) => { calls.push(id); return { ok: true, state: 'ready' }; },
  });
  assert.deepEqual(calls, ['local-b']);
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.id, 'local-b');
  assert.equal(result.alias, '표시 B');

  const failed = await accounts.ensureActiveToken({ refresh: async () => ({ ok: false, state: 'expired' }) });
  assert.equal(failed.ok, false);
  assert.equal(failed.state, 'expired');
});
