import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  activeStockProbe, controlBody, createOwnedGroup, createStockEventSummary,
  openActiveStream, validateActiveWsUrl,
} from './ws-active-stock.mjs';

const NOW = new Date('2026-09-07T04:12:30.000Z');

function reply(url, status, body, redirected = false, responseUrl = String(url)) {
  const bytes = Buffer.from(JSON.stringify(body));
  return { ok: status >= 200 && status < 300, status, redirected, url: responseUrl, async arrayBuffer() { return bytes; } };
}

function standardFetch(log, overrides = {}) {
  return async (url, init = {}) => {
    const parsed = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    log.push({ path: parsed.pathname, method: init.method || 'GET', body, account: init.headers?.['X-Athena-Account'] || null });
    if (overrides[parsed.pathname]) return overrides[parsed.pathname](url, init, body);
    if (parsed.pathname === '/ready') return reply(url, 200, { status: 'ready' });
    if (parsed.pathname === '/ready/accounts') return reply(url, 200, { default: 'audit', accounts: { audit: { ready: true, websocket: true, order_scopes: [] } } });
    if (parsed.pathname.includes('/identity_and_capital')) return reply(url, 200, { stk_cd: '005930', stk_nm: 'verified-name' });
    if (parsed.pathname === '/api/v1/websocket/0B') return reply(url, 200, { trnm: body.trnm, return_code: '0' });
    throw new Error(`unexpected path ${parsed.pathname}`);
  };
}

async function runProbe({ fetchFn, streamFactory, group = '4321', occupiedGroups, observeTimeoutMs = 5 } = {}) {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'athena-ws-active-'));
  try {
    const result = await activeStockProbe({
      execute: true, now: NOW, eventNowFn: () => NOW, outputRoot, group, occupiedGroups,
      bearer: 'test-secret-never-persist', gitHeadFn: async () => 'a'.repeat(40),
      fetchFn, streamFactory, baselineMs: 0, observeTimeoutMs,
    });
    result.serialized = await readFile(result.outputPath, 'utf8');
    return result;
  } finally { await rm(outputRoot, { recursive: true, force: true }); }
}

function streamThat(summaryAction = null, state = {}) {
  let closed = Boolean(state.closed);
  return async ({ summary }) => ({
    isClosed: () => closed,
    async wait() { if (summaryAction) summaryAction(summary); },
    async close() { closed = true; return { acknowledged: state.closeAcknowledged !== false, dispatcherDestroyed: state.dispatcherDestroyed !== false, closeCode: state.closeCode ?? 1000 }; },
  });
}

test('fixed URL, group, and control body contracts are exact', () => {
  assert.equal(validateActiveWsUrl('ws://127.0.0.1:8010/api/v1/ws/stream?account=audit', 'audit').searchParams.get('account'), 'audit');
  assert.throws(() => validateActiveWsUrl('ws://127.0.0.1:8010/api/v1/ws/stream?account=audit&extra=1', 'audit'));
  assert.equal(createOwnedGroup(() => 9999), '9999');
  assert.deepEqual(controlBody('REG', '4321'), { trnm: 'REG', grp_no: '4321', refresh: '1', data: [{ item: '005930', type: '0B' }] });
  assert.deepEqual(controlBody('REMOVE', '4321'), { trnm: 'REMOVE', grp_no: '4321', refresh: '1', data: [{ item: '005930', type: '0B' }] });
});

test('known group collision blocks before every network request', async () => {
  let calls = 0;
  const result = await runProbe({ fetchFn: async () => { calls += 1; }, streamFactory: async () => { throw new Error('must not open'); }, occupiedGroups: ['4321'] });
  assert.equal(result.artifact.verdict, 'BLOCKED_GROUP_OWNERSHIP');
  assert.equal(calls, 0);
  assert.equal(result.artifact.control.reg_requests, 0);
});

test('redirect or response URL mismatch fails before REG', async () => {
  const log = [];
  const fetchFn = standardFetch(log, { '/ready': (url) => reply(url, 200, { status: 'ready' }, true, 'http://127.0.0.1:8010/other') });
  const result = await runProbe({ fetchFn, streamFactory: streamThat() });
  assert.match(result.artifact.verdict, /REDIRECT_OR_URL_MISMATCH/);
  assert.equal(result.artifact.control.reg_requests, 0);
  assert.equal(log.length, 1);
});

test('fresh identity mismatch fails before socket and registration', async () => {
  const log = [];
  let sockets = 0;
  const fetchFn = standardFetch(log, { '/api/v1/tr/stockinfo/ka10001/detail/identity_and_capital': (url) => reply(url, 200, { stk_cd: '000660', stk_nm: 'wrong' }) });
  const result = await runProbe({ fetchFn, streamFactory: async () => { sockets += 1; } });
  assert.match(result.artifact.verdict, /FRESH_STOCK_IDENTITY_FAILED/);
  assert.equal(sockets, 0);
  assert.equal(result.artifact.control.reg_requests, 0);
});

test('auth rejection opens once, never reconnects, and sends no REG', async () => {
  const log = [];
  let sockets = 0;
  const error = new Error('websocket_auth_rejected');
  error.closeCode = 1008;
  const result = await runProbe({ fetchFn: standardFetch(log), streamFactory: async () => { sockets += 1; throw error; } });
  assert.equal(result.artifact.verdict, 'BLOCKED_AUTH_REJECTED');
  assert.equal(sockets, 1);
  assert.equal(log.filter((item) => item.path === '/api/v1/websocket/0B').length, 0);
  assert.equal(result.artifact.socket.reconnect_attempts, 0);
});

test('closed stream is not reconnected and is closed through owned handle', async () => {
  const log = [];
  let sockets = 0;
  let closes = 0;
  const factory = async () => {
    sockets += 1;
    return { isClosed: () => true, async wait() {}, async close() { closes += 1; return { acknowledged: true, dispatcherDestroyed: true, closeCode: 1006 }; } };
  };
  const result = await runProbe({ fetchFn: standardFetch(log), streamFactory: factory });
  assert.match(result.artifact.verdict, /WEBSOCKET_CLOSED_BEFORE_REGISTRATION/);
  assert.equal(sockets, 1);
  assert.equal(closes, 1);
  assert.equal(result.artifact.socket.reconnect_attempts, 0);
  assert.equal(result.artifact.control.reg_requests, 0);
});

test('no active event remains BLOCKED_NO_LIVE_EVENT and exact REMOVE runs once', async () => {
  const log = [];
  const result = await runProbe({ fetchFn: standardFetch(log), streamFactory: streamThat() });
  const controls = log.filter((item) => item.path === '/api/v1/websocket/0B');
  assert.equal(result.artifact.verdict, 'BLOCKED_NO_LIVE_EVENT');
  assert.equal(controls.length, 2);
  assert.deepEqual(controls.map((item) => item.body.trnm), ['REG', 'REMOVE']);
  assert.ok(controls.every((item) => item.body.grp_no === '4321' && item.body.refresh === '1' && item.body.data.length === 1));
  assert.equal(result.artifact.control.reg_requests, 1);
  assert.equal(result.artifact.control.remove_requests, 1);
});

test('wrong item, wrong type, invalid time, and stale rows do not satisfy the event gate', async () => {
  const log = [];
  const factory = async ({ summary }) => {
    setTimeout(() => {
      summary.accept(JSON.stringify({ trnm: 'REAL', data: [
        { type: '0D', item: '005930', 20: '131230' },
        { type: '0B', item: '000660', 20: '131230' },
        { type: '0B', item: '005930', 20: '996060' },
        { type: '0B', item: '005930', 20: '120000' },
      ] }));
    }, 0);
    return { isClosed: () => false, async wait() {}, async close() { return { acknowledged: true, dispatcherDestroyed: true, closeCode: 1000 }; } };
  };
  const result = await runProbe({ fetchFn: standardFetch(log), streamFactory: factory, observeTimeoutMs: 15 });
  assert.equal(result.artifact.verdict, 'BLOCKED_NO_LIVE_EVENT');
  assert.deepEqual({
    wrong_type: result.artifact.events.counts.wrong_type,
    wrong_item: result.artifact.events.counts.wrong_item,
    invalid_time: result.artifact.events.counts.invalid_time,
    stale: result.artifact.events.counts.stale,
    valid: result.artifact.events.counts.valid,
  }, { wrong_type: 1, wrong_item: 1, invalid_time: 1, stale: 1, valid: 0 });
});

test('valid 0B event passes while API zero cleanup stays explicitly ambiguous and secrets are absent', async () => {
  const log = [];
  const factory = async ({ summary }) => {
    setTimeout(() => summary.accept(JSON.stringify({ trnm: 'REAL', data: [{ type: '0B', item: '005930', 20: '131230', 10: '999999', name: 'raw-name' }] })), 0);
    return { isClosed: () => false, async wait() {}, async close() { return { acknowledged: true, dispatcherDestroyed: true, closeCode: 1000 }; } };
  };
  const result = await runProbe({ fetchFn: standardFetch(log), streamFactory: factory, observeTimeoutMs: 15 });
  assert.equal(result.artifact.verdict, 'PASS_WITH_CLEANUP_UNVERIFIED');
  assert.equal(result.artifact.events.status, 'OBSERVED_VALID');
  assert.equal(result.artifact.control.cleanup_status, 'CLEANUP_API_ZERO_ACK_OR_SYNTHETIC');
  assert.equal(result.artifact.control.upstream_remove_ack_verified, false);
  assert.equal(result.artifact.socket.close_status, 'OWNED_SOCKET_CLOSED');
  assert.doesNotMatch(result.serialized, /test-secret-never-persist|raw-name|999999|"audit"/);
});

test('REMOVE transport failure makes cleanup uncertain while still closing the owned socket', async () => {
  const log = [];
  let closes = 0;
  const fetchFn = standardFetch(log, {
    '/api/v1/websocket/0B': (url, init, body) => {
      if (body.trnm === 'REMOVE') throw new Error('simulated_remove_transport_failure');
      return reply(url, 200, { trnm: 'REG', return_code: '0' });
    },
  });
  const result = await runProbe({ fetchFn, streamFactory: async ({ summary }) => {
    setTimeout(() => summary.accept(JSON.stringify({ trnm: 'REAL', data: [{ type: '0B', item: '005930', 20: '131230' }] })), 0);
    return { isClosed: () => false, async wait() {}, async close() { closes += 1; return { acknowledged: true, dispatcherDestroyed: true, closeCode: 1000 }; } };
  }, observeTimeoutMs: 15 });
  assert.equal(result.artifact.control.remove_requests, 1);
  assert.equal(result.artifact.control.cleanup_status, 'CLEANUP_UNCERTAIN');
  assert.equal(result.artifact.verdict, 'BLOCKED_CLEANUP_UNCERTAIN');
  assert.equal(closes, 1);
});

test('event summarizer separates baseline, malformed, stale, and valid events', async () => {
  const summary = createStockEventSummary(() => NOW);
  summary.accept('{');
  summary.accept(JSON.stringify({ trnm: 'REAL', data: [{ type: '0B', item: '005930', 20: '131230' }] }));
  summary.setActive(true);
  summary.accept(JSON.stringify({ trnm: 'REAL', data: [{ type: '0B', item: '005930', 20: '131229' }] }));
  assert.equal(await summary.waitForValid(5), true);
  assert.deepEqual(summary.seal().counts, {
    message: 3, invalid_json: 1, oversized: 0, real_envelope: 2, baseline_matching: 1,
    wrong_type: 0, wrong_item: 0, invalid_time: 0, stale: 0, valid: 1,
  });
});

test('low-level stream sends auth first, rejects policy close, and never constructs a replacement socket', async () => {
  let instances = 0;
  class FakeSocket {
    static CLOSING = 2;
    constructor() { this.readyState = 0; this.listeners = new Map(); instances += 1; queueMicrotask(() => this.emit('open', {})); }
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(fn); }
    emit(name, event) { for (const fn of this.listeners.get(name) || []) fn(event); }
    send(raw) { assert.deepEqual(JSON.parse(raw), { type: 'auth', token: 'secret' }); this.emit('close', { code: 1008 }); }
    close() { this.readyState = 2; this.emit('close', { code: 1000 }); }
  }
  const summary = createStockEventSummary(() => NOW);
  await assert.rejects(() => openActiveStream({
    url: new URL('ws://127.0.0.1:8010/api/v1/ws/stream?account=audit'), token: 'secret', summary,
    WebSocketCtor: FakeSocket, dispatcherFactory: () => ({ async destroy() {} }), connectTimeoutMs: 50, authGraceMs: 5,
  }), /websocket_auth_rejected/);
  assert.equal(instances, 1);
});
