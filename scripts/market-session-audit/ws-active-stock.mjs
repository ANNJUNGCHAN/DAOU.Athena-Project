import { randomInt } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { marketPhase, parseLocalBearer, REPO_ROOT, validateBaseUrl } from './observer.mjs';
import { reconcileWebsocketSources } from './ws-passive.mjs';

const execFileAsync = promisify(execFile);
const appRequire = createRequire(path.join(REPO_ROOT, 'app', 'package.json'));
const { Agent: UndiciAgent, WebSocket: UndiciWebSocket } = appRequire('undici');

export const STOCK_CODE = '005930';
export const REAL_TYPE = '0B';
export const OVERALL_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 5_000;
const BASELINE_MS = 2_000;
const AUTH_GRACE_MS = 250;
const OBSERVE_TIMEOUT_MS = 20_000;
const CLOSE_TIMEOUT_MS = 3_000;
const CLEANUP_RESERVE_MS = REQUEST_TIMEOUT_MS + CLOSE_TIMEOUT_MS;
const MAX_BODY_BYTES = 1_048_576;
const IDENTITY_PATH = '/api/v1/tr/stockinfo/ka10001/detail/identity_and_capital';
const CONTROL_PATH = `/api/v1/websocket/${REAL_TYPE}`;

function bounded(promise, timeoutMs, value = false) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => value === false ? resolve(false) : reject(value), timeoutMs);
    promise.then((result) => { clearTimeout(timer); resolve(result); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function safeErrorClass(error) {
  return ['AbortError', 'Error', 'RangeError', 'SyntaxError', 'TypeError'].includes(error?.name) ? error.name : 'UnknownError';
}

export function validateActiveWsUrl(value, expectedAccount) {
  const url = new URL(value);
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || url.port !== '8010'
    || url.pathname !== '/api/v1/ws/stream' || url.username || url.password || url.hash) {
    throw new Error('active WebSocket URL must be the fixed loopback stream endpoint');
  }
  const entries = [...url.searchParams.entries()];
  if (entries.length !== 1 || entries[0][0] !== 'account' || !entries[0][1] || entries[0][1] !== expectedAccount) {
    throw new Error('active WebSocket URL must contain only the selected account');
  }
  return url;
}

export function createOwnedGroup(randomIntFn = randomInt) {
  return String(randomIntFn(1000, 10000));
}

export function controlBody(command, group) {
  if (!['REG', 'REMOVE'].includes(command)) throw new Error('unsupported control command');
  if (!/^\d{4}$/.test(group)) throw new Error('owned group must be exactly four digits');
  return { trnm: command, grp_no: group, refresh: '1', data: [{ item: STOCK_CODE, type: REAL_TYPE }] };
}

function kstParts(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((out, part) => {
    if (part.type !== 'literal') out[part.type] = part.value;
    return out;
  }, {});
}

function inspectEventTime(fid20, receivedAt) {
  if (typeof fid20 !== 'string') return { ageSeconds: null, reason: 'nested_fid_non_string' };
  if (fid20.length !== 6) return { ageSeconds: null, reason: 'nested_fid_length_not_6' };
  if (!/^\d{6}$/.test(fid20)) return { ageSeconds: null, reason: 'nested_fid_non_digit' };
  const hour = Number(fid20.slice(0, 2));
  const minute = Number(fid20.slice(2, 4));
  const second = Number(fid20.slice(4, 6));
  if (hour > 23 || minute > 59 || second > 59) return { ageSeconds: null, reason: 'nested_fid_out_of_range' };
  const parts = kstParts(receivedAt);
  const eventMs = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}+09:00`);
  return { ageSeconds: Math.abs(receivedAt.getTime() - eventMs) / 1000, reason: null };
}

function freshnessBucket(ageSeconds) {
  if (ageSeconds <= 5) return '<=5s';
  if (ageSeconds <= 30) return '<=30s';
  if (ageSeconds <= 120) return '<=120s';
  return '>120s';
}

export function createStockEventSummary(nowFn = () => new Date()) {
  const counts = {
    message: 0, invalid_json: 0, oversized: 0, real_envelope: 0, baseline_matching: 0,
    wrong_type: 0, wrong_item: 0, matching_row: 0, invalid_time: 0, time_shape_valid: 0, stale: 0, valid: 0,
    values_object: 0, values_missing_or_non_object: 0, nested_fid_missing: 0, nested_fid_non_string: 0,
    nested_fid_length_not_6: 0, nested_fid_non_digit: 0, nested_fid_out_of_range: 0, top_level_fid_present: 0,
  };
  let bucket = null;
  let active = false;
  let resolveValid;
  const validEvent = new Promise((resolve) => { resolveValid = resolve; });
  return {
    setActive(value) { active = Boolean(value); },
    markOversized() { counts.oversized += 1; },
    accept(raw) {
      counts.message += 1;
      let message;
      try { message = JSON.parse(raw); } catch { counts.invalid_json += 1; return; }
      if (!message || message.trnm !== 'REAL' || !Array.isArray(message.data)) return;
      counts.real_envelope += 1;
      for (const row of message.data) {
        if (row?.type !== REAL_TYPE) { counts.wrong_type += 1; continue; }
        if (row?.item !== STOCK_CODE) { counts.wrong_item += 1; continue; }
        if (!active) { counts.baseline_matching += 1; continue; }
        counts.matching_row += 1;
        const values = row?.values;
        if (Object.prototype.hasOwnProperty.call(row, '20')) counts.top_level_fid_present += 1;
        if (!values || typeof values !== 'object' || Array.isArray(values)) {
          counts.values_missing_or_non_object += 1;
          counts.invalid_time += 1;
          continue;
        }
        counts.values_object += 1;
        if (!Object.prototype.hasOwnProperty.call(values, '20')) {
          counts.nested_fid_missing += 1;
          counts.invalid_time += 1;
          continue;
        }
        const inspected = inspectEventTime(values['20'], nowFn());
        if (inspected.reason) {
          counts[inspected.reason] += 1;
          counts.invalid_time += 1;
          continue;
        }
        const age = inspected.ageSeconds;
        counts.time_shape_valid += 1;
        if (age > 120) { counts.stale += 1; continue; }
        counts.valid += 1;
        bucket = freshnessBucket(age);
        resolveValid(true);
      }
    },
    waitForValid(timeoutMs) { return bounded(validEvent, timeoutMs, false); },
    seal() {
      return {
        status: counts.valid ? 'OBSERVED_VALID' : counts.matching_row ? 'BLOCKED_LIVE_EVENT_TIME_INVALID_OR_STALE' : 'BLOCKED_NO_LIVE_EVENT',
        counts: { ...counts }, identity_match: counts.matching_row > 0, time_shape_valid: counts.time_shape_valid > 0,
        fresh_within_120s: counts.valid > 0, freshness_bucket: bucket, raw_values_persisted: false,
      };
    },
  };
}

export async function openActiveStream({ url, token, summary, WebSocketCtor = UndiciWebSocket, dispatcherFactory = () => new UndiciAgent(), connectTimeoutMs = CONNECT_TIMEOUT_MS, authGraceMs = AUTH_GRACE_MS, closeTimeoutMs = CLOSE_TIMEOUT_MS }) {
  if (!Number.isFinite(closeTimeoutMs) || closeTimeoutMs <= 0 || closeTimeoutMs > CLOSE_TIMEOUT_MS) {
    throw new RangeError(`closeTimeoutMs must be no greater than ${CLOSE_TIMEOUT_MS}`);
  }
  const dispatcher = dispatcherFactory();
  const websocket = new WebSocketCtor(url.href, { dispatcher });
  let closeCode = null;
  let closed = false;
  let resolveClosed;
  let cleanupPromise = null;
  const closedPromise = new Promise((resolve) => { resolveClosed = resolve; });
  websocket.addEventListener('close', (event) => {
    closed = true;
    closeCode = Number.isInteger(event.code) ? event.code : null;
    resolveClosed(true);
  }, { once: true });
  websocket.addEventListener('message', (event) => {
    const raw = typeof event.data === 'string' ? event.data : null;
    const bytes = raw === null ? Number(event.data?.byteLength ?? event.data?.size ?? MAX_BODY_BYTES + 1) : Buffer.byteLength(raw);
    if (raw === null || bytes > MAX_BODY_BYTES) {
      summary.markOversized();
      websocket.close(1009);
      return;
    }
    summary.accept(raw);
  });
  const opened = new Promise((resolve, reject) => {
    websocket.addEventListener('open', resolve, { once: true });
    websocket.addEventListener('error', () => reject(new Error('websocket_connection_failed')), { once: true });
    websocket.addEventListener('close', () => reject(new Error('websocket_closed_before_open')), { once: true });
  });
  const closeOwned = () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      const closeDeadline = performance.now() + closeTimeoutMs;
      if (!closed && websocket.readyState < WebSocketCtor.CLOSING) {
        try { websocket.close(1000); } catch { /* dispatcher destruction still owns the hard cleanup boundary */ }
      }
      const ackRemaining = Math.max(0, closeDeadline - performance.now());
      const acknowledged = closed || await bounded(closedPromise, ackRemaining, false);
      const destroyPromise = Promise.resolve().then(() => dispatcher.destroy()).then(() => true, () => false);
      const destroyRemaining = Math.max(0, closeDeadline - performance.now());
      const dispatcherDestroyed = destroyRemaining > 0 ? await bounded(destroyPromise, destroyRemaining, false) : false;
      return { acknowledged, dispatcherDestroyed, closeCode };
    })();
    return cleanupPromise;
  };
  try {
    await bounded(opened, connectTimeoutMs, Object.assign(new Error('websocket_connect_timeout'), { name: 'AbortError' }));
    if (token) websocket.send(JSON.stringify({ type: 'auth', token }));
    await Promise.race([new Promise((resolve) => setTimeout(resolve, authGraceMs)), closedPromise]);
    if (closed) {
      const error = new Error(closeCode === 1008 ? 'websocket_auth_rejected' : 'websocket_closed_before_registration');
      error.closeCode = closeCode;
      throw error;
    }
    return {
      closeCode: () => closeCode,
      isClosed: () => closed,
      async wait(ms) { await Promise.race([new Promise((resolve) => setTimeout(resolve, ms)), closedPromise]); },
      close: closeOwned,
    };
  } catch (error) {
    await closeOwned();
    throw error;
  }
}

async function readBearer(repoRoot) {
  if (process.env.ATHENA_LOCAL_BEARER_TOKEN) return process.env.ATHENA_LOCAL_BEARER_TOKEN;
  try { return parseLocalBearer(await readFile(path.join(repoRoot, 'backend', '.env'), 'utf8')); } catch { return null; }
}

async function gitHead(repoRoot) {
  return (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, windowsHide: true })).stdout.trim();
}

async function jsonRequest(fetchFn, url, { method = 'GET', bearer, account, body, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Accept: 'application/json' };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    if (account) headers['X-Athena-Account'] = account;
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetchFn(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal, redirect: 'error', credentials: 'omit' });
    if (response.redirected || new URL(response.url).href !== new URL(url).href) throw new Error('redirect_or_url_mismatch');
    const declaredLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new Error('response_body_oversized');
    let bytes;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          await reader.cancel();
          throw new Error('response_body_oversized');
        }
        chunks.push(value);
      }
      bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
    } else {
      bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_BODY_BYTES) throw new Error('response_body_oversized');
    }
    let parsed = null;
    try { parsed = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { throw new Error('invalid_json_response'); }
    return { ok: response.ok, status: response.status, body: parsed };
  } finally { clearTimeout(timer); }
}

function isZero(value) { return String(value) === '0'; }

async function writeArtifact(outputRoot, now, artifact) {
  await mkdir(outputRoot, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('.', '-');
  let outputPath = path.join(outputRoot, `ws-active-stock-${stamp}.json`);
  for (let suffix = 1; ; suffix += 1) {
    try { await writeFile(outputPath, JSON.stringify(artifact, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' }); return outputPath; }
    catch (error) { if (error?.code !== 'EEXIST') throw error; outputPath = path.join(outputRoot, `ws-active-stock-${stamp}-${suffix}.json`); }
  }
}

export async function activeStockProbe(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const baseUrl = validateBaseUrl(options.baseUrl || 'http://127.0.0.1:8010');
  const now = options.now instanceof Date ? options.now : new Date();
  const execute = options.execute === true;
  const group = options.group || createOwnedGroup(options.randomIntFn);
  const occupiedGroups = new Set(options.occupiedGroups || []);
  const definitions = options.definitions || JSON.parse(await readFile(path.join(repoRoot, 'backend', 'ref', 'kiwoom-screen-definitions.json'), 'utf8')).definitions;
  const manifestMappings = options.manifestMappings || JSON.parse(await readFile(path.join(repoRoot, 'backend', 'ref', 'kiwoom-common-screen-manifest.json'), 'utf8')).mappings;
  const sourceReconciliation = reconcileWebsocketSources(definitions, manifestMappings);
  const artifact = {
    schema_version: 1, kind: 'athena_active_ws_stock_probe', observed_at: now.toISOString(), market: marketPhase(now),
    revision: await (options.gitHeadFn || gitHead)(repoRoot), mode: execute ? 'EXECUTE' : 'DRY_RUN',
    target: { tr_id: REAL_TYPE, item: STOCK_CODE, normal_stock_only: true, identity_route: IDENTITY_PATH },
    source_reconciliation: { expected_count: sourceReconciliation.expected_count, exact_set_equal: sourceReconciliation.exact_set_equal },
    bounds_ms: { overall: OVERALL_TIMEOUT_MS, request: REQUEST_TIMEOUT_MS, connect: CONNECT_TIMEOUT_MS, baseline: BASELINE_MS, observe: OBSERVE_TIMEOUT_MS, cleanup_reserve: CLEANUP_RESERVE_MS, close: CLOSE_TIMEOUT_MS },
    isolation: { status: 'ISOLATION_BEST_EFFORT_RANDOM_GROUP', group, refresh: '1', exact_lease_only: true, occupancy_api_available: false, collision_key: `${REAL_TYPE}/${group}/${STOCK_CODE}` },
    authentication: { local_bearer_present: null, token_persisted: false, account_alias_persisted: false },
    preflight: { ready: 'NOT_ATTEMPTED', account: 'NOT_ATTEMPTED', identity: 'NOT_ATTEMPTED', identity_business_code: 'NOT_ATTEMPTED' },
    control: { reg_requests: 0, reg_may_have_reached_upstream: false, reg_status: 'NOT_ATTEMPTED', remove_requests: 0, cleanup_status: 'NOT_ATTEMPTED', upstream_remove_ack_verified: false },
    events: createStockEventSummary().seal(),
    socket: { opened: false, owned_socket_only: true, reconnect_attempts: 0, close_status: 'NOT_ATTEMPTED' },
    safety: { other_tr_sent: false, condition_sent: false, order_sent: false, account_mutation_sent: false, raw_messages_persisted: false },
    verdict: execute ? 'BLOCKED_NOT_STARTED' : 'NOT_EXECUTED', error_class: null,
  };
  const outputRoot = path.resolve(options.outputRoot || path.join(repoRoot, 'artifacts', 'market-session-audit', '2026-09-07'));
  if (!/^\d{4}$/.test(group) || occupiedGroups.has(group)) {
    artifact.isolation.status = 'BLOCKED_GROUP_OWNERSHIP';
    artifact.verdict = 'BLOCKED_GROUP_OWNERSHIP';
    return { artifact, outputPath: await writeArtifact(outputRoot, now, artifact) };
  }
  if (!execute) return { artifact, outputPath: await writeArtifact(outputRoot, now, artifact) };

  const fetchFn = options.fetchFn || globalThis.fetch;
  const bearer = options.bearer === undefined ? await readBearer(repoRoot) : options.bearer;
  artifact.authentication.local_bearer_present = Boolean(bearer);
  const overallTimeoutMs = options.overallTimeoutMs ?? OVERALL_TIMEOUT_MS;
  if (!Number.isFinite(overallTimeoutMs) || overallTimeoutMs <= 0 || overallTimeoutMs > OVERALL_TIMEOUT_MS) {
    throw new RangeError(`overallTimeoutMs must be no greater than ${OVERALL_TIMEOUT_MS}`);
  }
  const clockMs = options.clockMsFn || Date.now;
  const deadline = clockMs() + overallTimeoutMs;
  const operationDeadline = deadline - CLEANUP_RESERVE_MS;
  const operationRemaining = () => {
    const value = operationDeadline - clockMs();
    if (value <= 0) throw Object.assign(new Error('overall_timeout'), { name: 'AbortError' });
    return Math.min(REQUEST_TIMEOUT_MS, value);
  };
  const cleanupRemaining = () => {
    const value = deadline - CLOSE_TIMEOUT_MS - clockMs();
    if (value <= 0) throw Object.assign(new Error('cleanup_deadline_exhausted'), { name: 'AbortError' });
    return Math.min(REQUEST_TIMEOUT_MS, value);
  };
  let account = null;
  let regAttempted = false;
  let stream = null;
  const summary = createStockEventSummary(options.eventNowFn || (() => new Date()));
  try {
    const ready = await jsonRequest(fetchFn, new URL('/ready', baseUrl), { bearer, timeoutMs: operationRemaining() });
    if (!ready.ok || ready.body?.status !== 'ready') throw new Error('kiwoom_not_ready');
    artifact.preflight.ready = 'READY';
    const accounts = await jsonRequest(fetchFn, new URL('/ready/accounts', baseUrl), { bearer, timeoutMs: operationRemaining() });
    account = accounts.body?.default;
    const runtime = typeof account === 'string' ? accounts.body?.accounts?.[account] : null;
    if (!accounts.ok || !account || runtime?.ready !== true || runtime?.websocket !== true) throw new Error('default_account_websocket_not_ready');
    artifact.preflight.account = 'READY';
    const identity = await jsonRequest(fetchFn, new URL(IDENTITY_PATH, baseUrl), { method: 'POST', bearer, account, body: { stk_cd: STOCK_CODE }, timeoutMs: operationRemaining() });
    const identityCodeExposed = Object.prototype.hasOwnProperty.call(identity.body || {}, 'return_code');
    artifact.preflight.identity_business_code = identityCodeExposed
      ? (isZero(identity.body.return_code) ? 'ZERO_EXPOSED' : 'NONZERO_EXPOSED')
      : 'NOT_EXPOSED_BY_DETAIL_PROJECTION';
    if (!identity.ok || (identityCodeExposed && !isZero(identity.body.return_code))) throw new Error('fresh_stock_identity_business_error');
    if (identity.body?.stk_cd !== STOCK_CODE || typeof identity.body?.stk_nm !== 'string' || !identity.body.stk_nm.trim()) throw new Error('fresh_stock_identity_mismatch');
    artifact.preflight.identity = 'VERIFIED';

    const wsUrl = validateActiveWsUrl(`ws://127.0.0.1:8010/api/v1/ws/stream?account=${encodeURIComponent(account)}`, account);
    stream = await (options.streamFactory || openActiveStream)({ url: wsUrl, token: bearer, summary, connectTimeoutMs: Math.min(CONNECT_TIMEOUT_MS, operationRemaining()), authGraceMs: options.authGraceMs });
    artifact.socket.opened = true;
    await stream.wait(Math.min(options.baselineMs ?? BASELINE_MS, Math.max(0, operationDeadline - clockMs())));
    if (stream.isClosed()) throw new Error('websocket_closed_before_registration');
    const regTimeoutMs = operationRemaining();
    regAttempted = true;
    artifact.control.reg_requests = 1;
    artifact.control.reg_may_have_reached_upstream = true;
    artifact.control.reg_status = 'DISPATCHED_ACK_PENDING';
    const reg = await jsonRequest(fetchFn, new URL(CONTROL_PATH, baseUrl), { method: 'POST', bearer, account, body: controlBody('REG', group), timeoutMs: regTimeoutMs });
    if (!reg.ok || !isZero(reg.body?.return_code)) {
      artifact.control.reg_status = 'REJECTED';
      throw new Error('registration_rejected');
    }
    artifact.control.reg_status = 'CONTROL_ACK';
    summary.setActive(true);
    await summary.waitForValid(Math.min(options.observeTimeoutMs ?? OBSERVE_TIMEOUT_MS, Math.max(0, operationDeadline - clockMs())));
    artifact.events = summary.seal();
    artifact.verdict = artifact.events.status === 'OBSERVED_VALID' ? 'PASS_WITH_CLEANUP_UNVERIFIED' : artifact.events.status;
  } catch (error) {
    if (artifact.control.reg_status === 'DISPATCHED_ACK_PENDING') artifact.control.reg_status = 'ACK_UNKNOWN_AFTER_DISPATCH';
    artifact.error_class = safeErrorClass(error);
    artifact.verdict = error?.message === 'websocket_auth_rejected' ? 'BLOCKED_AUTH_REJECTED' : `BLOCKED_${String(error?.message || 'operation_failed').toUpperCase()}`;
    artifact.events = summary.seal();
  } finally {
    if (regAttempted) {
      artifact.control.remove_requests = 1;
      try {
        const remove = await jsonRequest(fetchFn, new URL(CONTROL_PATH, baseUrl), { method: 'POST', bearer, account, body: controlBody('REMOVE', group), timeoutMs: cleanupRemaining() });
        artifact.control.cleanup_status = remove.ok && isZero(remove.body?.return_code) ? 'CLEANUP_API_ZERO_ACK_OR_SYNTHETIC' : 'CLEANUP_REJECTED';
      } catch { artifact.control.cleanup_status = 'CLEANUP_UNCERTAIN'; }
    }
    if (stream) {
      try {
        const closed = await stream.close();
        artifact.socket.close_status = closed.acknowledged && closed.dispatcherDestroyed ? 'OWNED_SOCKET_CLOSED' : 'OWNED_SOCKET_CLOSE_UNCERTAIN';
      } catch { artifact.socket.close_status = 'OWNED_SOCKET_CLOSE_UNCERTAIN'; }
    }
    if (regAttempted && artifact.control.cleanup_status !== 'CLEANUP_API_ZERO_ACK_OR_SYNTHETIC') artifact.verdict = 'BLOCKED_CLEANUP_UNCERTAIN';
    if (stream && artifact.socket.close_status !== 'OWNED_SOCKET_CLOSED') artifact.verdict = 'BLOCKED_SOCKET_CLEANUP';
  }
  return { artifact, outputPath: await writeArtifact(outputRoot, now, artifact) };
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--execute') options.execute = true;
    else if (argv[i] === '--output-root') options.outputRoot = argv[++i];
    else if (argv[i] === '--base-url') options.baseUrl = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return options;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const { artifact, outputPath } = await activeStockProbe(parseArgs(process.argv.slice(2)));
  console.log(`${outputPath} — mode=${artifact.mode} verdict=${artifact.verdict} reg=${artifact.control.reg_requests} remove=${artifact.control.remove_requests}`);
}
