import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  activeStockProbe, controlBody, createOwnedGroup, createStockEventSummary,
  openActiveStream, OVERALL_TIMEOUT_MS, validateActiveWsUrl,
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

async function runProbe({ fetchFn, streamFactory, group = '4321', occupiedGroups, observeTimeoutMs = 5, bearer = 'test-secret-never-persist', clockMsFn } = {}) {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'athena-ws-active-'));
  try {
    const probeOptions = {
      execute: true, now: NOW, eventNowFn: () => NOW, outputRoot, group, occupiedGroups,
      fetchFn, streamFactory, baselineMs: 0, observeTimeoutMs, clockMsFn,
      gitHeadFn: async () => 'a'.repeat(40),
    };
    if (bearer !== 'FROM_ENVIRONMENT') probeOptions.bearer = bearer;
    const result = await activeStockProbe(probeOptions);
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
  assert.equal(OVERALL_TIMEOUT_MS, 45_000);
  assert.equal(validateActiveWsUrl('ws://127.0.0.1:8010/api/v1/ws/stream?account=audit', 'audit').searchParams.get('account'), 'audit');
  assert.throws(() => validateActiveWsUrl('ws://127.0.0.1:8010/api/v1/ws/stream?account=audit&extra=1', 'audit'));
  assert.equal(createOwnedGroup(() => 9999), '9999');
  assert.deepEqual(controlBody('REG', '4321'), { trnm: 'REG', grp_no: '4321', refresh: '1', data: [{ item: '005930', type: '0B' }] });
  assert.deepEqual(controlBody('REMOVE', '4321'), { trnm: 'REMOVE', grp_no: '4321', refresh: '1', data: [{ item: '005930', type: '0B' }] });
});

test('oversized HTTP response blocks before REG', async () => {
  const oversized = Buffer.alloc(1_048_577, 0x20);
  const result = await runProbe({
    fetchFn: async (url) => ({ ok: true, status: 200, redirected: false, url: String(url), async arrayBuffer() { return oversized; } }),
    streamFactory: async () => { throw new Error('must not open'); },
  });
  assert.match(result.artifact.verdict, /RESPONSE_BODY_OVERSIZED/);
  assert.equal(result.artifact.control.reg_requests, 0);
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
  assert.match(result.artifact.verdict, /FRESH_STOCK_IDENTITY_MISMATCH/);
  assert.equal(sockets, 0);
  assert.equal(result.artifact.control.reg_requests, 0);
});

test('successful detail projection without return_code verifies exact stock identity', async () => {
  const log = [];
  const result = await runProbe({ fetchFn: standardFetch(log), streamFactory: streamThat() });
  assert.equal(result.artifact.preflight.identity, 'VERIFIED');
  assert.equal(result.artifact.preflight.identity_business_code, 'NOT_EXPOSED_BY_DETAIL_PROJECTION');
  assert.equal(result.artifact.control.reg_requests, 1);
});

test('HTTP 200 business-error envelope with nonzero return_code blocks before REG', async () => {
  const log = [];
  let sockets = 0;
  const fetchFn = standardFetch(log, {
    '/api/v1/tr/stockinfo/ka10001/detail/identity_and_capital': (url) => reply(url, 200, {
      return_code: '1', return_msg: 'provider-business-error', stk_cd: '005930', stk_nm: 'must-not-pass',
    }),
  });
  const result = await runProbe({ fetchFn, streamFactory: async () => { sockets += 1; } });
  assert.match(result.artifact.verdict, /FRESH_STOCK_IDENTITY_BUSINESS_ERROR/);
  assert.equal(result.artifact.preflight.identity_business_code, 'NONZERO_EXPOSED');
  assert.equal(sockets, 0);
  assert.equal(result.artifact.control.reg_requests, 0);
  assert.doesNotMatch(result.serialized, /provider-business-error|must-not-pass/);
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
        { type: '0D', item: '005930', values: { 20: '131230' } },
        { type: '0B', item: '000660', values: { 20: '131230' } },
        { type: '0B', item: '005930', values: { 20: '996060' } },
        { type: '0B', item: '005930', values: { 20: '120000' } },
      ] }));
    }, 0);
    return { isClosed: () => false, async wait() {}, async close() { return { acknowledged: true, dispatcherDestroyed: true, closeCode: 1000 }; } };
  };
  const result = await runProbe({ fetchFn: standardFetch(log), streamFactory: factory, observeTimeoutMs: 15 });
  assert.deepEqual({
    wrong_type: result.artifact.events.counts.wrong_type,
    wrong_item: result.artifact.events.counts.wrong_item,
    invalid_time: result.artifact.events.counts.invalid_time,
    stale: result.artifact.events.counts.stale,
    matching_row: result.artifact.events.counts.matching_row,
    valid: result.artifact.events.counts.valid,
  }, { wrong_type: 1, wrong_item: 1, invalid_time: 1, stale: 1, matching_row: 2, valid: 0 });
  assert.equal(result.artifact.verdict, 'BLOCKED_LIVE_EVENT_TIME_INVALID_OR_STALE');
});

test('valid 0B event passes while API zero cleanup stays explicitly ambiguous and secrets are absent', async () => {
  const log = [];
  const factory = async ({ summary }) => {
    setTimeout(() => summary.accept(JSON.stringify({ trnm: 'REAL', data: [{ type: '0B', item: '005930', values: { 20: '131230', 10: '999999' }, name: 'raw-name' }] })), 0);
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

test('process-only bearer environment is used without persisting the secret', async () => {
  const previous = process.env.ATHENA_LOCAL_BEARER_TOKEN;
  const secret = 'child-process-only-secret';
  process.env.ATHENA_LOCAL_BEARER_TOKEN = secret;
  const seenAuthorization = [];
  const baseFetch = standardFetch([]);
  try {
    const result = await runProbe({
      bearer: 'FROM_ENVIRONMENT',
      fetchFn: async (url, init) => { seenAuthorization.push(init.headers?.Authorization); return baseFetch(url, init); },
      streamFactory: streamThat(),
    });
    assert.ok(seenAuthorization.length >= 4);
    assert.ok(seenAuthorization.every((value) => value === `Bearer ${secret}`));
    assert.doesNotMatch(result.serialized, new RegExp(secret));
  } finally {
    if (previous === undefined) delete process.env.ATHENA_LOCAL_BEARER_TOKEN;
    else process.env.ATHENA_LOCAL_BEARER_TOKEN = previous;
  }
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
    setTimeout(() => summary.accept(JSON.stringify({ trnm: 'REAL', data: [{ type: '0B', item: '005930', values: { 20: '131230' } }] })), 0);
    return { isClosed: () => false, async wait() {}, async close() { closes += 1; return { acknowledged: true, dispatcherDestroyed: true, closeCode: 1000 }; } };
  }, observeTimeoutMs: 15 });
  assert.equal(result.artifact.control.remove_requests, 1);
  assert.equal(result.artifact.control.cleanup_status, 'CLEANUP_UNCERTAIN');
  assert.equal(result.artifact.verdict, 'BLOCKED_CLEANUP_UNCERTAIN');
  assert.equal(closes, 1);
});

test('REG response loss still sends one exact REMOVE and cannot pass', async () => {
  const log = [];
  let closes = 0;
  const fetchFn = standardFetch(log, {
    '/api/v1/websocket/0B': (url, init, body) => {
      if (body.trnm === 'REG') throw Object.assign(new Error('simulated_reg_response_lost'), { name: 'AbortError' });
      return reply(url, 200, { trnm: 'REMOVE', return_code: '0' });
    },
  });
  const result = await runProbe({ fetchFn, streamFactory: async () => ({
    isClosed: () => false, async wait() {},
    async close() { closes += 1; return { acknowledged: true, dispatcherDestroyed: true, closeCode: 1000 }; },
  }) });
  const controls = log.filter((item) => item.path === '/api/v1/websocket/0B');
  assert.deepEqual(controls.map((item) => item.body.trnm), ['REG', 'REMOVE']);
  assert.deepEqual(controls.map((item) => item.body.data), [controls[0].body.data, controls[0].body.data]);
  assert.ok(controls.every((item) => item.body.grp_no === '4321' && item.body.refresh === '1'));
  assert.equal(result.artifact.control.reg_status, 'ACK_UNKNOWN_AFTER_DISPATCH');
  assert.equal(result.artifact.control.reg_may_have_reached_upstream, true);
  assert.equal(result.artifact.control.remove_requests, 1);
  assert.equal(result.artifact.control.cleanup_status, 'CLEANUP_API_ZERO_ACK_OR_SYNTHETIC');
  assert.notEqual(result.artifact.verdict, 'PASS_WITH_CLEANUP_UNVERIFIED');
  assert.equal(closes, 1);
});

test('operation deadline exhaustion preserves reserved REMOVE and owned-close budgets', async () => {
  const log = [];
  let closes = 0;
  const ticks = [0, 0, 0, 0, 0, 0, 0, 37_000, 37_000];
  const clockMsFn = () => ticks.length ? ticks.shift() : 37_000;
  const result = await runProbe({
    fetchFn: standardFetch(log), clockMsFn, observeTimeoutMs: 20_000,
    streamFactory: async () => ({
      isClosed: () => false, async wait() {},
      async close() { closes += 1; return { acknowledged: true, dispatcherDestroyed: true, closeCode: 1000 }; },
    }),
  });
  const controls = log.filter((item) => item.path === '/api/v1/websocket/0B');
  assert.deepEqual(controls.map((item) => item.body.trnm), ['REG', 'REMOVE']);
  assert.equal(result.artifact.verdict, 'BLOCKED_NO_LIVE_EVENT');
  assert.equal(result.artifact.control.remove_requests, 1);
  assert.equal(result.artifact.control.cleanup_status, 'CLEANUP_API_ZERO_ACK_OR_SYNTHETIC');
  assert.equal(result.artifact.bounds_ms.cleanup_reserve, 8_000);
  assert.equal(result.artifact.socket.close_status, 'OWNED_SOCKET_CLOSED');
  assert.equal(closes, 1);
});

test('event summarizer separates baseline, malformed, stale, and valid events', async () => {
  const summary = createStockEventSummary(() => NOW);
  summary.accept('{');
  summary.accept(JSON.stringify({ trnm: 'REAL', data: [{ type: '0B', item: '005930', values: { 20: '131230' } }] }));
  summary.setActive(true);
  summary.accept(JSON.stringify({ trnm: 'REAL', data: [{ type: '0B', item: '005930', values: { 20: '131229' } }] }));
  assert.equal(await summary.waitForValid(5), true);
  const counts = summary.seal().counts;
  assert.deepEqual({ message: counts.message, invalid_json: counts.invalid_json, real_envelope: counts.real_envelope,
    baseline_matching: counts.baseline_matching, matching_row: counts.matching_row, values_object: counts.values_object,
    time_shape_valid: counts.time_shape_valid, valid: counts.valid },
  { message: 3, invalid_json: 1, real_envelope: 2, baseline_matching: 1, matching_row: 1,
    values_object: 1, time_shape_valid: 1, valid: 1 });
});

test('time-FID diagnostics expose only structural categories and never raw values', () => {
  const summary = createStockEventSummary(() => NOW);
  summary.setActive(true);
  summary.accept(JSON.stringify({ trnm: 'REAL', data: [
    { type: '0B', item: '005930', 20: 'top-level-secret' },
    { type: '0B', item: '005930', values: 'not-an-object-secret' },
    { type: '0B', item: '005930', values: {} },
    { type: '0B', item: '005930', values: { 20: 131230 } },
    { type: '0B', item: '005930', values: { 20: '12345' } },
    { type: '0B', item: '005930', values: { 20: '12x456' } },
    { type: '0B', item: '005930', values: { 20: '996060' } },
  ] }));
  const sealed = summary.seal();
  assert.equal(sealed.status, 'BLOCKED_LIVE_EVENT_TIME_INVALID_OR_STALE');
  assert.deepEqual({
    matching_row: sealed.counts.matching_row,
    invalid_time: sealed.counts.invalid_time,
    values_object: sealed.counts.values_object,
    values_missing_or_non_object: sealed.counts.values_missing_or_non_object,
    nested_fid_missing: sealed.counts.nested_fid_missing,
    nested_fid_non_string: sealed.counts.nested_fid_non_string,
    nested_fid_length_not_6: sealed.counts.nested_fid_length_not_6,
    nested_fid_non_digit: sealed.counts.nested_fid_non_digit,
    nested_fid_out_of_range: sealed.counts.nested_fid_out_of_range,
    top_level_fid_present: sealed.counts.top_level_fid_present,
  }, {
    matching_row: 7, invalid_time: 7, values_object: 5, values_missing_or_non_object: 2,
    nested_fid_missing: 1, nested_fid_non_string: 1, nested_fid_length_not_6: 1,
    nested_fid_non_digit: 1, nested_fid_out_of_range: 1, top_level_fid_present: 1,
  });
  const serialized = JSON.stringify(sealed);
  assert.doesNotMatch(serialized, /top-level-secret|not-an-object-secret|12x456|996060/);
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

test('low-level close shares one deadline across missing ACK and delayed dispatcher destruction', async () => {
  let destroyAttempted = false;
  class NoAckSocket {
    static CLOSING = 2;
    constructor() { this.readyState = 0; this.listeners = new Map(); queueMicrotask(() => this.emit('open', {})); }
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(fn); }
    emit(name, event) { for (const fn of this.listeners.get(name) || []) fn(event); }
    close() { this.readyState = 2; }
  }
  const stream = await openActiveStream({
    url: new URL('ws://127.0.0.1:8010/api/v1/ws/stream?account=audit'), token: null,
    summary: createStockEventSummary(() => NOW), WebSocketCtor: NoAckSocket,
    dispatcherFactory: () => ({ async destroy() { destroyAttempted = true; await new Promise((resolve) => setTimeout(resolve, 100)); } }),
    connectTimeoutMs: 50, authGraceMs: 1, closeTimeoutMs: 50,
  });
  const started = performance.now();
  const result = await stream.close();
  const elapsed = performance.now() - started;
  assert.equal(destroyAttempted, true);
  assert.equal(result.acknowledged, false);
  assert.equal(result.dispatcherDestroyed, false);
  assert.ok(elapsed >= 35, `close returned too early: ${elapsed}ms`);
  assert.ok(elapsed < 100, `close exceeded its shared deadline: ${elapsed}ms`);
});
