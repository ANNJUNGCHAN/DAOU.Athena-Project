'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const https = require('node:https');

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
const secrets = require('./secrets');
Module._load = originalLoad;
const AUTHORIZATION = 'Bearer local-token';
const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
const BACKEND_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BACKEND_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const LOCAL_BACKEND = 'http://127.0.0.1:8010';

test.after(() => fs.rmSync(userDataDir, { recursive: true, force: true }));

function writeAccounts(entries, activeId = entries[0]?.id || null, selectionRevision = 0) {
  fs.writeFileSync(path.join(userDataDir, 'athena-accounts.json'), JSON.stringify({
    activeId, selectionRevision, accounts: entries,
  }));
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

function runtimeResponse(backendAlias, { ok = true, status = 200, ready = true } = {}) {
  return {
    ok,
    status,
    json: async () => ({ ok: true, backend_alias: backendAlias, ready }),
  };
}

function setAccountSecrets(id, appKey, secretKey) {
  secrets.setValue(id, 'appKey', appKey);
  secrets.setValue(id, 'secretKey', secretKey);
}

test('서버 계좌 목록은 인증된 /ready/accounts 응답의 alias만 반환한다', async () => {
  const calls = [];
  const result = await accounts.listBackendAliases({
    backendBase: LOCAL_BACKEND,
    authorization: AUTHORIZATION,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return readyResponse(['account-b', 'account-a']);
    },
  });
  assert.deepEqual(result, { ok: true, aliases: ['account-a', 'account-b'] });
  assert.equal(calls[0].url, `${LOCAL_BACKEND}/ready/accounts`);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer local-token');
  assert.equal(calls[0].options.redirect, 'error');
});

test('local bearer가 없으면 metadata 요청 자체를 보내지 않는다', async () => {
  let fetches = 0;
  const result = await accounts.listBackendAliases({
    backendBase: LOCAL_BACKEND,
    fetchImpl: async () => { fetches += 1; return readyResponse(['server-a']); },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /인증이 없다/);
  assert.equal(fetches, 0);
});

test('선택한 두 프론트 계좌는 각각 자신의 저장된 자격증명으로 backend에 동기화된다', async () => {
  writeAccounts([
    { id: ACCOUNT_A, alias: '표시 A' },
    { id: ACCOUNT_B, alias: '표시 B' },
  ], ACCOUNT_A, 3);
  setAccountSecrets(ACCOUNT_A, 'app-a', 'secret-a');
  setAccountSecrets(ACCOUNT_B, 'app-b', 'secret-b');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return runtimeResponse(url.includes(ACCOUNT_A) ? BACKEND_A : BACKEND_B);
  };
  const a = await accounts.resolveBackendAlias({
    id: ACCOUNT_A, backendBase: LOCAL_BACKEND, fetchImpl, authorization: AUTHORIZATION,
  });
  assert.equal(accounts.setActive(ACCOUNT_B).ok, true);
  const b = await accounts.resolveBackendAlias({
    id: ACCOUNT_B, backendBase: LOCAL_BACKEND, fetchImpl, authorization: AUTHORIZATION,
  });
  assert.equal(a.backendAlias, BACKEND_A);
  assert.equal(b.backendAlias, BACKEND_B);
  assert.deepEqual(calls.map((call) => call.body), [
    {
      app_key: 'app-a', secret_key: 'secret-a', active: true, selection_revision: 3, order_api: false,
    },
    {
      app_key: 'app-b', secret_key: 'secret-b', active: true, selection_revision: 4, order_api: false,
    },
  ]);
  assert.equal(calls[0].options.headers.Authorization, AUTHORIZATION);
  assert.equal(calls[0].options.redirect, 'error');
  assert.deepEqual(accounts.list().accounts.map((account) => account.backendConnected), [true, true]);
});

test('기존에 저장된 수동 alias를 신뢰하지 않고 자격증명 검증 결과로 교체한다', async () => {
  writeAccounts([{ id: ACCOUNT_A, alias: '표시 A', backendAlias: 'legacy-wrong-alias' }]);
  setAccountSecrets(ACCOUNT_A, 'app-a', 'secret-a');
  const result = await accounts.resolveBackendAlias({
    id: ACCOUNT_A, backendBase: LOCAL_BACKEND,
    authorization: AUTHORIZATION,
    fetchImpl: async () => runtimeResponse(BACKEND_A),
  });
  assert.equal(result.ok, true);
  assert.equal(result.backendAlias, BACKEND_A);
  assert.equal(accounts.list().accounts[0].backendAlias, BACKEND_A);
});

test('기존 backend 설정과 동일 자격증명이면 UUID가 아닌 검증 alias도 재사용한다', async () => {
  writeAccounts([{ id: ACCOUNT_A, alias: '표시 A', backendAlias: 'wrong-saved-alias' }]);
  setAccountSecrets(ACCOUNT_A, 'app-a', 'secret-a');
  const result = await accounts.resolveBackendAlias({
    id: ACCOUNT_A, backendBase: LOCAL_BACKEND, authorization: AUTHORIZATION,
    fetchImpl: async () => runtimeResponse('default'),
  });
  assert.equal(result.ok, true);
  assert.equal(result.backendAlias, 'default');
  assert.equal(accounts.list().accounts[0].backendAlias, 'default');
});

test('금지 응답과 redirect 실패는 기존 alias를 바꾸지 않고 연결 오류로 표시한다', async () => {
  writeAccounts([{ id: ACCOUNT_A, alias: '표시 A', backendAlias: 'legacy-alias' }]);
  setAccountSecrets(ACCOUNT_A, 'app-a', 'secret-a');
  const calls = [];
  const forbidden = await accounts.resolveBackendAlias({
    id: ACCOUNT_A, backendBase: LOCAL_BACKEND, authorization: AUTHORIZATION,
    fetchImpl: async (_url, options) => {
      calls.push(options);
      return runtimeResponse(BACKEND_A, { ok: false, status: 403 });
    },
  });
  assert.equal(forbidden.ok, false);
  assert.equal(accounts.list().accounts[0].backendAlias, 'legacy-alias');
  assert.equal(accounts.list().accounts[0].backendConnected, false);
  assert.match(accounts.list().accounts[0].backendSyncError, /연결할 수 없다/);
  assert.equal(calls[0].redirect, 'error');

  const redirected = await accounts.resolveBackendAlias({
    id: ACCOUNT_A, backendBase: LOCAL_BACKEND, authorization: AUTHORIZATION,
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'error');
      throw new TypeError('redirect blocked');
    },
  });
  assert.equal(redirected.ok, false);
  assert.equal(accounts.list().accounts[0].backendAlias, 'legacy-alias');
});

test('원격 backend 주소나 bearer 누락에는 자격증명을 전송하지 않는다', async () => {
  writeAccounts([{ id: ACCOUNT_A, alias: '표시 A' }]);
  setAccountSecrets(ACCOUNT_A, 'app-a', 'secret-a');
  let fetches = 0;
  const fetchImpl = async () => { fetches += 1; return runtimeResponse(BACKEND_A); };
  const remote = await accounts.resolveBackendAlias({
    id: ACCOUNT_A, backendBase: 'https://example.com', authorization: AUTHORIZATION, fetchImpl,
  });
  const unauthenticated = await accounts.resolveBackendAlias({
    id: ACCOUNT_A, backendBase: LOCAL_BACKEND, fetchImpl,
  });
  assert.equal(remote.ok, false);
  assert.match(remote.error, /로컬 백엔드/);
  assert.equal(unauthenticated.ok, false);
  assert.match(unauthenticated.error, /인증이 없다/);
  assert.equal(fetches, 0);
});

test('동일 계좌 동시 resolve는 같은 자격증명 PUT 한 건으로 합친다', async () => {
  writeAccounts([{ id: ACCOUNT_A, alias: '표시 A' }]);
  setAccountSecrets(ACCOUNT_A, 'app-a', 'secret-a');
  let release;
  let fetches = 0;
  const response = new Promise((resolve) => { release = resolve; });
  const options = {
    id: ACCOUNT_A, backendBase: LOCAL_BACKEND, authorization: AUTHORIZATION,
    fetchImpl: async () => { fetches += 1; return response; },
  };
  const first = accounts.resolveBackendAlias(options);
  const second = accounts.resolveBackendAlias(options);
  release(runtimeResponse(BACKEND_A));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(fetches, 1);
  assert.equal(a.backendAlias, BACKEND_A);
  assert.equal(b.backendAlias, BACKEND_A);
});

test('완료된 resolve는 캐시하지 않고 다음 조회에서 backend 준비 상태를 다시 검증한다', async () => {
  writeAccounts([{ id: ACCOUNT_A, alias: '표시 A' }]);
  setAccountSecrets(ACCOUNT_A, 'app-a', 'secret-a');
  let fetches = 0;
  const options = {
    id: ACCOUNT_A, backendBase: LOCAL_BACKEND, authorization: AUTHORIZATION,
    fetchImpl: async () => { fetches += 1; return runtimeResponse(BACKEND_A); },
  };
  assert.equal((await accounts.resolveBackendAlias(options)).ok, true);
  assert.equal((await accounts.resolveBackendAlias(options)).ok, true);
  assert.equal(fetches, 2);
});

test('비활성 계좌 동기화는 현재 선택 번호와 active false를 보내 기본 계좌를 바꾸지 않는다', async () => {
  writeAccounts([
    { id: ACCOUNT_A, alias: '표시 A' },
    { id: ACCOUNT_B, alias: '표시 B' },
  ], ACCOUNT_A, 7);
  setAccountSecrets(ACCOUNT_B, 'app-b', 'secret-b');
  let body;
  const result = await accounts.resolveBackendAlias({
    id: ACCOUNT_B, backendBase: LOCAL_BACKEND, authorization: AUTHORIZATION,
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return runtimeResponse(BACKEND_B);
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(body, {
    app_key: 'app-b', secret_key: 'secret-b', active: false, selection_revision: 7, order_api: false,
  });
});

test('활성 계좌 선택 번호는 실제 선택 변경과 활성 계좌 삭제 때만 단조 증가한다', () => {
  writeAccounts([
    { id: ACCOUNT_A, alias: '표시 A' },
    { id: ACCOUNT_B, alias: '표시 B' },
  ], ACCOUNT_A, 9);
  assert.equal(accounts.setActive(ACCOUNT_A).ok, true);
  assert.equal(accounts.setActive(ACCOUNT_B).ok, true);
  let state = JSON.parse(fs.readFileSync(path.join(userDataDir, 'athena-accounts.json'), 'utf8'));
  assert.equal(state.selectionRevision, 10);
  assert.equal(state.activeId, ACCOUNT_B);

  accounts.remove(ACCOUNT_B);
  state = JSON.parse(fs.readFileSync(path.join(userDataDir, 'athena-accounts.json'), 'utf8'));
  assert.equal(state.selectionRevision, 11);
  assert.equal(state.activeId, ACCOUNT_A);
});

test('지연된 OAuth 등록은 인증 중 바뀐 활성 계좌와 선택 번호를 덮어쓰지 않는다', async () => {
  writeAccounts([
    { id: ACCOUNT_A, alias: '표시 A' },
    { id: ACCOUNT_B, alias: '표시 B' },
  ], ACCOUNT_A, 30);

  const originalRequest = https.request;
  let finishAuth;
  https.request = (_options, onResponse) => {
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => {};
    request.destroy = () => {};
    finishAuth = () => {
      const response = new EventEmitter();
      response.statusCode = 200;
      onResponse(response);
      response.emit('data', JSON.stringify({
        return_code: '0', token: 'issued-token', expires_dt: '20991231235959',
      }));
      response.emit('end');
    };
    return request;
  };

  try {
    const registering = accounts.register({
      alias: '표시 C', appKey: 'app-c', secretKey: 'secret-c', verifyOnly: false,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(accounts.setActive(ACCOUNT_B).ok, true);
    finishAuth();
    const result = await registering;
    assert.equal(result.ok, true);

    const state = JSON.parse(fs.readFileSync(path.join(userDataDir, 'athena-accounts.json'), 'utf8'));
    assert.equal(state.activeId, ACCOUNT_B);
    assert.equal(state.selectionRevision, 31);
    assert.equal(state.accounts.some((account) => account.id === result.id && account.alias === '표시 C'), true);
  } finally {
    https.request = originalRequest;
  }
});

test('주문 API 실제 토글도 구성 번호를 증가시켜 backend 요청 순서를 고정한다', async () => {
  writeAccounts([{
    id: ACCOUNT_A,
    alias: '표시 A',
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    orderApi: false,
  }], ACCOUNT_A, 12);
  setAccountSecrets(ACCOUNT_A, 'app-a', 'secret-a');
  assert.equal(accounts.orderApiSet(ACCOUNT_A, true).ok, true);
  assert.equal(accounts.orderApiSet(ACCOUNT_A, true).ok, true);
  let body;
  await accounts.syncBackendAccount({
    id: ACCOUNT_A, backendBase: LOCAL_BACKEND, authorization: AUTHORIZATION,
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return runtimeResponse(BACKEND_A);
    },
  });
  assert.equal(body.order_api, true);
  assert.equal(body.selection_revision, 13);

  assert.equal(accounts.orderApiSet(ACCOUNT_A, false).ok, true);
  assert.equal(accounts.orderApiSet(ACCOUNT_A, false).ok, true);
  const state = JSON.parse(fs.readFileSync(path.join(userDataDir, 'athena-accounts.json'), 'utf8'));
  assert.equal(state.selectionRevision, 14);
});

test('동기화 중 삭제는 PUT 종료 뒤 DELETE하고 늦은 alias를 로컬에 저장하지 않는다', async () => {
  writeAccounts([{ id: ACCOUNT_A, alias: '표시 A', backendAlias: 'legacy-alias' }]);
  setAccountSecrets(ACCOUNT_A, 'app-a', 'secret-a');
  let finishPut;
  const putResponse = new Promise((resolve) => { finishPut = resolve; });
  const methods = [];
  const fetchImpl = async (_url, options) => {
    methods.push(options.method);
    if (options.method === 'PUT') return putResponse;
    return { ok: true, status: 200, json: async () => ({ ok: true, removed: true }) };
  };
  const syncing = accounts.resolveBackendAlias({
    id: ACCOUNT_A, backendBase: LOCAL_BACKEND, authorization: AUTHORIZATION, fetchImpl,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const removing = accounts.removeFromBackend({
    id: ACCOUNT_A, backendBase: LOCAL_BACKEND, authorization: AUTHORIZATION, fetchImpl,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(methods, ['PUT']);

  finishPut(runtimeResponse(BACKEND_A));
  const syncResult = await syncing;
  const removeResult = await removing;
  assert.equal(syncResult.ok, false);
  assert.equal(syncResult.stale, true);
  assert.equal(removeResult.ok, true);
  assert.deepEqual(methods, ['PUT', 'DELETE']);
  assert.equal(accounts.list().accounts[0].backendAlias, 'legacy-alias');

  accounts.remove(ACCOUNT_A);
  assert.deepEqual(accounts.list().accounts, []);
});

test('서로 다른 상태의 PUT이 겹쳐도 삭제는 해당 계좌의 모든 PUT 뒤에 실행된다', async () => {
  writeAccounts([
    { id: ACCOUNT_A, alias: '표시 A' },
    { id: ACCOUNT_B, alias: '표시 B' },
  ], ACCOUNT_A, 20);
  setAccountSecrets(ACCOUNT_A, 'app-a', 'secret-a');
  let finishOlder;
  let finishNewer;
  const olderResponse = new Promise((resolve) => { finishOlder = resolve; });
  const newerResponse = new Promise((resolve) => { finishNewer = resolve; });
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ method: options.method, body });
    if (options.method === 'DELETE') {
      return { ok: true, status: 200, json: async () => ({ ok: true, removed: true }) };
    }
    return body.active ? olderResponse : newerResponse;
  };

  const older = accounts.resolveBackendAlias({
    id: ACCOUNT_A, backendBase: LOCAL_BACKEND, authorization: AUTHORIZATION, fetchImpl,
  });
  await new Promise((resolve) => setImmediate(resolve));
  accounts.setActive(ACCOUNT_B);
  const newer = accounts.resolveBackendAlias({
    id: ACCOUNT_A, backendBase: LOCAL_BACKEND, authorization: AUTHORIZATION, fetchImpl,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const removing = accounts.removeFromBackend({
    id: ACCOUNT_A, backendBase: LOCAL_BACKEND, authorization: AUTHORIZATION, fetchImpl,
  });

  finishNewer(runtimeResponse(BACKEND_A));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.map((call) => call.method), ['PUT', 'PUT']);
  finishOlder(runtimeResponse(BACKEND_A));
  const [olderResult, newerResult, removeResult] = await Promise.all([older, newer, removing]);
  assert.equal(olderResult.stale, true);
  assert.equal(newerResult.stale, true);
  assert.equal(removeResult.ok, true);
  assert.deepEqual(calls.map((call) => call.method), ['PUT', 'PUT', 'DELETE']);
  assert.equal(calls[2].body.selection_revision, 22);
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
