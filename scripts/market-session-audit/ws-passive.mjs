import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { marketPhase, parseLocalBearer, REPO_ROOT } from './observer.mjs';

const execFileAsync = promisify(execFile);
const WS_URL = 'ws://127.0.0.1:8010/api/v1/ws/stream';
const CONNECT_TIMEOUT_MS = 5_000;
const LISTEN_TIMEOUT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 3_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_MESSAGE_BYTES = 1_048_576;
const EXPECTED_WS_SOURCE_COUNT = 23;
const appRequire = createRequire(path.join(REPO_ROOT, 'app', 'package.json'));
const { Agent: UndiciAgent, WebSocket: UndiciWebSocket } = appRequire('undici');

export function validateWsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || url.port !== '8010') {
    throw new Error('passive WebSocket URL must be ws://127.0.0.1:8010');
  }
  if (url.username || url.password || url.pathname !== '/api/v1/ws/stream' || url.search || url.hash) {
    throw new Error('passive WebSocket URL must be the fixed stream endpoint');
  }
  return url;
}

function boundedTimeout(value, fallback, name) {
  const timeout = value ?? fallback;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > MAX_TIMEOUT_MS) {
    throw new RangeError(`${name} must be a finite positive duration no greater than ${MAX_TIMEOUT_MS}ms`);
  }
  return timeout;
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) (seen.has(value) ? repeated : seen).add(value);
  return [...repeated].sort();
}

export function reconcileWebsocketSources(definitions, manifestMappings) {
  const definitionIds = definitions.filter((item) => item.category === 'websocket').map((item) => item.mapping_id).sort();
  const manifestIds = manifestMappings.filter((item) => item.classification?.category === 'websocket').map((item) => item.mapping_id).sort();
  const definitionDuplicates = duplicates(definitionIds);
  const manifestDuplicates = duplicates(manifestIds);
  const definitionSet = new Set(definitionIds);
  const manifestSet = new Set(manifestIds);
  const onlyDefinitions = definitionIds.filter((id) => !manifestSet.has(id));
  const onlyManifest = manifestIds.filter((id) => !definitionSet.has(id));
  if (definitionIds.length !== EXPECTED_WS_SOURCE_COUNT || manifestIds.length !== EXPECTED_WS_SOURCE_COUNT
    || definitionDuplicates.length || manifestDuplicates.length || onlyDefinitions.length || onlyManifest.length) {
    throw new Error('websocket_source_inventory_mismatch');
  }
  return {
    expected_count: EXPECTED_WS_SOURCE_COUNT, definition_count: definitionIds.length, manifest_count: manifestIds.length,
    exact_set_equal: true, definition_duplicates: [], manifest_duplicates: [], only_definitions: [], only_manifest: [],
    source_ids: definitionIds,
  };
}

function waitBounded(promise, timeoutMs, rejectOnTimeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => rejectOnTimeout ? reject(Object.assign(new Error('bounded_timeout'), { name: 'AbortError' })) : resolve(false), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

export async function undiciObserve({
  url, token, connectTimeoutMs, listenTimeoutMs, closeTimeoutMs, onMessage,
  WebSocketCtor = UndiciWebSocket, dispatcherFactory = () => new UndiciAgent(),
}) {
  const dispatcher = dispatcherFactory();
  let websocket;
  let connected = false;
  let closed = false;
  let closeCode = null;
  let authFrameSent = false;
  let oversizedMessageCount = 0;
  let cleanupComplete = false;
  let operationError = null;
  let resolveTerminal;
  const terminal = new Promise((resolve) => { resolveTerminal = resolve; });
  try {
    websocket = new WebSocketCtor(url.href, { dispatcher });
    websocket.addEventListener('close', (event) => {
      closed = true;
      closeCode = Number.isInteger(event.code) ? event.code : null;
      resolveTerminal(true);
    }, { once: true });
    const opened = new Promise((resolve, reject) => {
      websocket.addEventListener('open', resolve, { once: true });
      websocket.addEventListener('error', () => reject(new Error('websocket_connection_failed')), { once: true });
      websocket.addEventListener('close', () => reject(new Error('websocket_closed_before_open')), { once: true });
    });
    await waitBounded(opened, connectTimeoutMs, true);
    connected = true;
    websocket.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : null;
      const byteLength = raw === null ? Number(event.data?.byteLength ?? event.data?.size ?? MAX_MESSAGE_BYTES + 1) : Buffer.byteLength(raw);
      if (byteLength > MAX_MESSAGE_BYTES || raw === null) {
        oversizedMessageCount += 1;
        websocket.close(1009);
        return;
      }
      onMessage(raw);
    });
    if (token) {
      websocket.send(JSON.stringify({ type: 'auth', token }));
      authFrameSent = true;
    }
    await waitBounded(terminal, listenTimeoutMs, false);
  } catch (error) {
    operationError = error;
  } finally {
    if (websocket && websocket.readyState < WebSocketCtor.CLOSING) websocket.close(1000);
    if (websocket && !closed) await waitBounded(terminal, closeTimeoutMs, false);
    cleanupComplete = await waitBounded(Promise.resolve().then(() => dispatcher.destroy()).then(() => true, () => false), closeTimeoutMs, false);
  }
  if (operationError) {
    operationError.cleanupComplete = cleanupComplete;
    throw operationError;
  }
  return { connected, closed, closeCode, authFrameSent, oversizedMessageCount, cleanupComplete };
}

function safeErrorClass(error) {
  return ['AbortError', 'Error', 'RangeError', 'SyntaxError', 'TypeError'].includes(error?.name) ? error.name : 'UnknownError';
}

export function createEventSummary(sourceIds) {
  const known = new Set(sourceIds);
  const counts = Object.fromEntries(sourceIds.map((id) => [id, 0]));
  const schema = { message_count: 0, valid_json_count: 0, real_envelope_count: 0, data_array_count: 0, invalid_json_count: 0, unknown_type_count: 0 };
  return {
    accept(raw) {
      schema.message_count += 1;
      let message;
      try { message = JSON.parse(raw); } catch { schema.invalid_json_count += 1; return; }
      schema.valid_json_count += 1;
      if (!message || message.trnm !== 'REAL') return;
      schema.real_envelope_count += 1;
      if (!Array.isArray(message.data)) return;
      schema.data_array_count += 1;
      for (const item of message.data) {
        const id = typeof item?.type === 'string' ? `base:${item.type}` : null;
        if (id && known.has(id)) counts[id] += 1;
        else schema.unknown_type_count += 1;
      }
    },
    seal() {
      const observed = Object.values(counts).reduce((sum, value) => sum + value, 0);
      return {
        status: observed ? 'OBSERVED' : 'NOT_OBSERVED',
        reason: observed ? null : 'No existing upstream subscriptions fanned out during the passive window; no registration was attempted.',
        schema,
        source_ids: sourceIds.map((id) => ({ id, status: counts[id] ? 'OBSERVED' : 'NOT_OBSERVED', event_count: counts[id] })),
        fid_time_validity: { status: 'NOT_ASSESSED', reason: 'No universal unambiguous event-time FID contract was identified across all 23 sources.' },
      };
    },
  };
}

async function readBearer(repoRoot) {
  try { return parseLocalBearer(await readFile(path.join(repoRoot, 'backend', '.env'), 'utf8')); } catch { return null; }
}

async function gitHead(repoRoot) {
  return (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, windowsHide: true })).stdout.trim();
}

export async function passiveProbe(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const url = validateWsUrl(options.url || WS_URL);
  const now = options.now instanceof Date ? options.now : new Date();
  const definitions = options.definitions || JSON.parse(await readFile(path.join(repoRoot, 'backend', 'ref', 'kiwoom-screen-definitions.json'), 'utf8')).definitions;
  const manifestMappings = options.manifestMappings || JSON.parse(await readFile(path.join(repoRoot, 'backend', 'ref', 'kiwoom-common-screen-manifest.json'), 'utf8')).mappings;
  const sourceReconciliation = reconcileWebsocketSources(definitions, manifestMappings);
  const sourceIds = sourceReconciliation.source_ids;
  const execute = options.execute === true;
  const bounds = {
    connect: boundedTimeout(options.connectTimeoutMs, CONNECT_TIMEOUT_MS, 'connectTimeoutMs'),
    listen: boundedTimeout(options.listenTimeoutMs, LISTEN_TIMEOUT_MS, 'listenTimeoutMs'),
    close: boundedTimeout(options.closeTimeoutMs, CLOSE_TIMEOUT_MS, 'closeTimeoutMs'),
  };
  const artifact = {
    schema_version: 1, kind: 'athena_passive_ws_observation', observed_at: now.toISOString(), market: marketPhase(now),
    revision: await (options.gitHeadFn || gitHead)(repoRoot),
    mode: execute ? 'EXECUTE' : 'DRY_RUN',
    safety: {
      registration_sent: false, removal_sent: false, condition_action_sent: false, provider_spawned: false, raw_messages_persisted: false,
      redirect_policy: 'ERROR', post_receive_message_limit_bytes: MAX_MESSAGE_BYTES,
      pre_receive_payload_limit: 'UNAVAILABLE_IN_INSTALLED_UNDICI_WEBSOCKET',
    },
    target: { endpoint: url.href, account_selection: 'backend_default_implicit', account_alias_persisted: false },
    source_reconciliation: sourceReconciliation,
    bounds_ms: bounds,
    authentication: { mode: 'NOT_ATTEMPTED', outcome: 'NOT_ATTEMPTED', local_bearer_present: null, token_persisted: false },
    connection: { status: execute ? 'NOT_ATTEMPTED' : 'DRY_RUN', error_class: null },
    events: createEventSummary(sourceIds).seal(),
    verdict: execute ? 'NOT_OBSERVED' : 'NOT_EXECUTED',
  };
  if (execute) {
    const token = options.bearer === undefined ? await readBearer(repoRoot) : options.bearer;
    artifact.authentication = { mode: token ? 'AUTH_FIRST_FRAME' : 'NO_LOCAL_BEARER_FOUND', outcome: 'NOT_VERIFIED', local_bearer_present: Boolean(token), token_persisted: false };
    const summary = createEventSummary(sourceIds);
    try {
      const outcome = await (options.transport || undiciObserve)({ url, token, connectTimeoutMs: artifact.bounds_ms.connect, listenTimeoutMs: artifact.bounds_ms.listen, closeTimeoutMs: artifact.bounds_ms.close, onMessage: (raw) => summary.accept(raw) });
      const cleanupComplete = outcome.cleanupComplete !== false;
      artifact.connection = {
        status: outcome.connected ? (cleanupComplete ? 'CONNECTED' : 'BLOCKED_CLEANUP') : 'NOT_CONNECTED', closed: Boolean(outcome.closed),
        close_code: Number.isInteger(outcome.closeCode) ? outcome.closeCode : null,
        oversized_message_count: Number.isInteger(outcome.oversizedMessageCount) ? outcome.oversizedMessageCount : 0,
        cleanup_status: cleanupComplete ? 'COMPLETE' : 'FAILED_OR_TIMED_OUT',
        error_class: null,
      };
      artifact.authentication.outcome = token
        ? (outcome.closeCode === 1008 ? 'REJECTED_POLICY' : outcome.authFrameSent !== true ? 'NOT_SENT' : 'NOT_REJECTED_NO_ACK')
        : (outcome.closeCode === 1008 ? 'REJECTED_POLICY' : 'NOT_VERIFIED_NO_AUTH_FRAME');
    } catch (error) {
      artifact.connection = { status: 'BLOCKED', closed: false, cleanup_status: error?.cleanupComplete === false ? 'FAILED_OR_TIMED_OUT' : 'UNKNOWN', error_class: safeErrorClass(error) };
    }
    artifact.events = summary.seal();
    const authenticationBlocked = ['REJECTED_POLICY', 'NOT_SENT'].includes(artifact.authentication.outcome);
    if (artifact.events.status === 'OBSERVED' && !authenticationBlocked) artifact.authentication.outcome = 'STREAM_EVENT_RECEIVED';
    artifact.verdict = artifact.connection.status === 'CONNECTED' && !authenticationBlocked ? artifact.events.status : 'BLOCKED';
  }
  const outputRoot = path.resolve(options.outputRoot || path.join(repoRoot, 'artifacts', 'market-session-audit', '2026-09-07'));
  await mkdir(outputRoot, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('.', '-');
  let outputPath = path.join(outputRoot, `ws-passive-${stamp}.json`);
  for (let suffix = 1; ; suffix += 1) {
    try { await writeFile(outputPath, JSON.stringify(artifact, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' }); break; }
    catch (error) { if (error?.code !== 'EEXIST') throw error; outputPath = path.join(outputRoot, `ws-passive-${stamp}-${suffix}.json`); }
  }
  return { artifact, outputPath };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const execute = process.argv.slice(2).includes('--execute');
  const { artifact, outputPath } = await passiveProbe({ execute });
  console.log(`${outputPath} — mode=${artifact.mode} connection=${artifact.connection.status} events=${artifact.events.status} sources_observed=${artifact.events.source_ids.filter((item) => item.status === 'OBSERVED').length}/${artifact.events.source_ids.length}`);
}
