import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { marketPhase, observeOnce, parseLocalBearer, probeProcesses, REPO_ROOT, SAFE_ENDPOINTS, validateBaseUrl } from './observer.mjs';

function kst(hour, minute) {
  return new Date(`2026-09-07T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`);
}

test('marketPhase classifies every planned market boundary', () => {
  assert.equal(marketPhase(kst(8, 29)).phase, 'BEFORE_PREOPEN');
  assert.equal(marketPhase(kst(8, 30)).phase, 'PREOPEN');
  assert.equal(marketPhase(kst(9, 0)).phase, 'REGULAR');
  assert.equal(marketPhase(kst(15, 20)).phase, 'CLOSING_AUCTION');
  assert.equal(marketPhase(kst(15, 30)).phase, 'POSTCLOSE');
  assert.equal(marketPhase(kst(16, 30)).phase, 'AFTER_AUDIT_WINDOW');
});

test('parseLocalBearer follows backend-launcher .env parsing without exposing the value', () => {
  assert.equal(parseLocalBearer("X=1\n ATHENA_LOCAL_BEARER_TOKEN = 'secret-value'\n"), 'secret-value');
  assert.equal(parseLocalBearer('X=1'), null);
});

test('observeOnce performs GET-only bounded observations and persists summaries without secrets or account identities', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'athena-observer-'));
  const calls = [];
  const secret = 'never-persist-this-token';
  const fetchFn = async (url, init) => {
    calls.push({ url: String(url), method: init.method, authorization: init.headers?.Authorization, redirect: init.redirect, credentials: init.credentials });
    const pathname = new URL(url).pathname;
    const bodies = {
      '/health': { status: 'ok', raw: 'must-not-persist' },
      '/ready': { status: 'ready' },
      '/ready/accounts': {
        default: 'sensitive-alias',
        accounts: {
          'sensitive-account-one': { ready: true, websocket: true, order_scopes: ['read'] },
          'sensitive-account-two': { ready: false, websocket: false, order_scopes: null },
        },
      },
      '/openapi.json': { paths: { '/health': {}, '/api/v1/order/submit': {} } },
    };
    return { ok: true, status: 200, json: async () => bodies[pathname] };
  };
  try {
    const { artifact, outputPath } = await observeOnce({
      now: kst(9, 1), repoRoot: dir, outputRoot: dir, bearer: secret, fetchFn,
      gitProbe: async () => ({ head: 'abc', dirty_count: 2, dirty_digest_sha256: 'digest' }),
      processProbe: async () => ({ supported: true, process_count: 3, working_set_bytes: 99, cpu_seconds: 1.5 }),
    });
    assert.deepEqual(calls.map((call) => call.method), SAFE_ENDPOINTS.map(() => 'GET'));
    assert.ok(calls.every((call) => call.authorization === `Bearer ${secret}`));
    assert.ok(calls.every((call) => call.redirect === 'error' && call.credentials === 'omit'));
    const accounts = artifact.http.find((item) => item.endpoint === '/ready/accounts');
    assert.deepEqual(accounts.summary, {
      account_count: 2, ready_count: 1, websocket_ready_count: 1, order_scope_reported_count: 1,
    });
    const persisted = await readFile(outputPath, 'utf8');
    for (const forbidden of [secret, 'sensitive-alias', 'sensitive-account-one', 'sensitive-account-two', 'must-not-persist']) {
      assert.equal(persisted.includes(forbidden), false);
    }
    assert.equal(JSON.parse(persisted).authentication.secret_persisted, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('base URL validation rejects remote, credentialed, encrypted, and alternate-port targets', () => {
  assert.equal(validateBaseUrl('http://127.0.0.1:8010'), 'http://127.0.0.1:8010');
  assert.equal(validateBaseUrl('http://localhost:8010/'), 'http://localhost:8010');
  for (const value of [
    'http://example.com:8010',
    'http://user:password@127.0.0.1:8010',
    'https://127.0.0.1:8010',
    'http://127.0.0.1:8000',
    'http://127.0.0.1:8010/redirect',
  ]) assert.throws(() => validateBaseUrl(value));
});

test('observeOnce rejects a remote base URL before reading or sending a bearer', async () => {
  let fetched = false;
  await assert.rejects(
    observeOnce({ baseUrl: 'http://example.com:8010', bearer: 'secret', fetchFn: async () => { fetched = true; } }),
    /loopback/,
  );
  assert.equal(fetched, false);
});

test('observeOnce rejects invalid timeout bounds before fetching', async () => {
  let fetched = false;
  for (const timeoutMs of [-1, 0, 99, Number.NaN, Number.POSITIVE_INFINITY, 30_001]) {
    await assert.rejects(observeOnce({
      timeoutMs, bearer: null, fetchFn: async () => { fetched = true; },
    }), /timeoutMs must be between/);
  }
  assert.equal(fetched, false);
});

test('IPv6 loopback is accepted and recorded as loopback', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'athena-observer-ipv6-'));
  try {
    const { artifact } = await observeOnce({
      repoRoot: dir, outputRoot: dir, baseUrl: 'http://[::1]:8010', bearer: null,
      fetchFn: async () => ({ ok: false, status: 503, json: async () => ({}) }),
      gitProbe: async () => ({ head: 'abc', dirty_count: 0, dirty_digest_sha256: 'digest' }),
      processProbe: async () => ({ supported: false, process_count: null }),
    });
    assert.equal(artifact.source.loopback, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('root PID probe never claims a live non-Electron process as Athena-owned', { skip: process.platform !== 'win32' }, async () => {
  const result = await probeProcesses(REPO_ROOT, process.pid);
  assert.equal(result.root_validated === true || (Number.isInteger(result.process_count) && result.process_count > 0), false);
  assert.equal(
    result.error === undefined
      ? result.root_found === true && result.root_validated === false && result.process_count === 0
      : result.error === 'process_probe_failed' && result.process_count === null,
    true,
  );
});

test('observeOnce records timeout/failure as a bounded observation instead of throwing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'athena-observer-fail-'));
  try {
    const { artifact } = await observeOnce({
      repoRoot: dir, outputRoot: dir, bearer: null,
      fetchFn: async () => { throw new TypeError('private network detail'); },
      gitProbe: async () => ({ head: 'abc', dirty_count: 0, dirty_digest_sha256: 'digest' }),
      processProbe: async () => ({ supported: false, process_count: null, working_set_bytes: null, cpu_seconds: null }),
    });
    assert.ok(artifact.http.every((item) => item.error === 'request_failed' && item.reachable === false));
    assert.equal(JSON.stringify(artifact).includes('private network detail'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
