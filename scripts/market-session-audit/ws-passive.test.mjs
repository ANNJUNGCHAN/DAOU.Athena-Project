import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEventSummary, passiveProbe, reconcileWebsocketSources, undiciObserve, validateWsUrl } from './ws-passive.mjs';

const DEFINITIONS = JSON.parse(await readFile(path.resolve('backend/ref/kiwoom-screen-definitions.json'), 'utf8')).definitions;
const MANIFEST_MAPPINGS = JSON.parse(await readFile(path.resolve('backend/ref/kiwoom-common-screen-manifest.json'), 'utf8')).mappings;

test('fixed URL validation and installed Undici transport reject redirects', async () => {
  assert.equal(validateWsUrl('ws://127.0.0.1:8010/api/v1/ws/stream').href, 'ws://127.0.0.1:8010/api/v1/ws/stream');
  for (const value of ['wss://127.0.0.1:8010/api/v1/ws/stream', 'ws://example.com:8010/api/v1/ws/stream', 'ws://u:p@127.0.0.1:8010/api/v1/ws/stream', 'ws://127.0.0.1:8000/api/v1/ws/stream', 'ws://127.0.0.1:8010/other']) assert.throws(() => validateWsUrl(value));
  const connectionSource = await readFile(path.resolve('app/node_modules/undici/lib/web/websocket/connection.js'), 'utf8');
  assert.match(connectionSource, /redirect:\s*'error'/);
});

test('Undici-delivered complete messages are counted without retaining raw values; silence is NOT_OBSERVED', async () => {
  const summary = createEventSummary(['base:0B', 'base:0D']);
  const reconstructed = JSON.stringify({ trnm: 'REAL', data: [{ type: '0B', values: { 10: 'secret-price' } }, { type: 'ZZ', item: 'secret-account' }] });
  let dispatcherDestroyed = false;
  const sent = [];
  class ReassembledMessageSocket extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    readyState = ReassembledMessageSocket.CONNECTING;
    constructor() {
      super();
      queueMicrotask(() => {
        this.readyState = ReassembledMessageSocket.OPEN;
        this.dispatchEvent(new Event('open'));
        setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: reconstructed })), 0);
      });
    }
    send(value) { sent.push(value); }
    close(code) {
      if (this.readyState === ReassembledMessageSocket.CLOSED) return;
      this.readyState = ReassembledMessageSocket.CLOSED;
      const event = new Event('close');
      Object.defineProperty(event, 'code', { value: code });
      this.dispatchEvent(event);
    }
  }
  await undiciObserve({
    url: validateWsUrl('ws://127.0.0.1:8010/api/v1/ws/stream'), token: 'private-token',
    connectTimeoutMs: 100, listenTimeoutMs: 20, closeTimeoutMs: 20,
    onMessage: (raw) => summary.accept(raw), WebSocketCtor: ReassembledMessageSocket,
    dispatcherFactory: () => ({ destroy: async () => { dispatcherDestroyed = true; } }),
  });
  summary.accept('private invalid message');
  const result = summary.seal();
  assert.equal(result.status, 'OBSERVED');
  assert.deepEqual(result.source_ids, [{ id: 'base:0B', status: 'OBSERVED', event_count: 1 }, { id: 'base:0D', status: 'NOT_OBSERVED', event_count: 0 }]);
  assert.equal(result.schema.unknown_type_count, 1);
  assert.equal(result.schema.invalid_json_count, 1);
  assert.equal(JSON.stringify(result).includes('secret-price'), false);
  assert.equal(JSON.stringify(result).includes('secret-account'), false);
  assert.equal(JSON.stringify(result).includes('private invalid message'), false);
  assert.equal(createEventSummary(['base:0B']).seal().status, 'NOT_OBSERVED');
  assert.equal(dispatcherDestroyed, true);
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(sent[0])).sort(), ['token', 'type']);
  assert.equal(JSON.parse(sent[0]).type, 'auth');
  const cleanupTimedOut = await undiciObserve({
    url: validateWsUrl('ws://127.0.0.1:8010/api/v1/ws/stream'), token: null,
    connectTimeoutMs: 100, listenTimeoutMs: 5, closeTimeoutMs: 5, onMessage: () => {},
    WebSocketCtor: ReassembledMessageSocket, dispatcherFactory: () => ({ destroy: () => new Promise(() => {}) }),
  });
  assert.equal(cleanupTimedOut.cleanupComplete, false);
});

test('probe is dry-run by default; execute sends only auth first frame through bounded injected transport and persists summaries', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'athena-ws-passive-'));
  const token = 'never-persist-token';
  let transportCalled = false;
  try {
    const reconciliation = reconcileWebsocketSources(DEFINITIONS, MANIFEST_MAPPINGS);
    assert.equal(reconciliation.definition_count, 23);
    assert.equal(reconciliation.exact_set_equal, true);
    assert.equal(reconciliation.source_ids.includes('base:0G'), true);
    assert.equal(reconciliation.source_ids.includes('base:0g'), true);
    assert.throws(() => reconcileWebsocketSources(DEFINITIONS, [...MANIFEST_MAPPINGS, MANIFEST_MAPPINGS.find((item) => item.mapping_id === 'base:0G')]));
    assert.throws(() => reconcileWebsocketSources(DEFINITIONS, MANIFEST_MAPPINGS.map((item) => item.mapping_id === 'base:0g' ? { ...item, mapping_id: 'base:0G' } : item)));
    const common = { repoRoot: dir, outputRoot: dir, definitions: DEFINITIONS, manifestMappings: MANIFEST_MAPPINGS, gitHeadFn: async () => 'abc' };
    const dry = await passiveProbe(common);
    assert.equal(dry.artifact.mode, 'DRY_RUN');
    assert.equal(dry.artifact.verdict, 'NOT_EXECUTED');
    await assert.rejects(() => passiveProbe({ ...common, listenTimeoutMs: -1 }), RangeError);
    await assert.rejects(() => passiveProbe({ ...common, closeTimeoutMs: Number.POSITIVE_INFINITY }), RangeError);
    const live = await passiveProbe({
      ...common, execute: true, bearer: token,
      connectTimeoutMs: 100, listenTimeoutMs: 200, closeTimeoutMs: 100,
      transport: async ({ url, token: sent, onMessage, connectTimeoutMs, listenTimeoutMs, closeTimeoutMs }) => {
        transportCalled = true;
        assert.equal(url.href, 'ws://127.0.0.1:8010/api/v1/ws/stream');
        assert.equal(sent, token);
        assert.deepEqual([connectTimeoutMs, listenTimeoutMs, closeTimeoutMs], [100, 200, 100]);
        onMessage(JSON.stringify({ trnm: 'REAL', data: [{ type: '0D', values: { 10: 'private-price' } }] }));
        return { connected: true, closed: true, authFrameSent: true, closeCode: 1000, cleanupComplete: true };
      },
    });
    assert.equal(transportCalled, true);
    assert.equal(live.artifact.authentication.mode, 'AUTH_FIRST_FRAME');
    assert.equal(live.artifact.authentication.outcome, 'STREAM_EVENT_RECEIVED');
    assert.equal(live.artifact.events.status, 'OBSERVED');
    const persisted = await readFile(live.outputPath, 'utf8');
    assert.equal(persisted.includes(token), false);
    assert.equal(persisted.includes('private-price'), false);
    assert.equal(live.artifact.safety.registration_sent, false);

    const handshakeError = await passiveProbe({ ...common, execute: true, bearer: token, transport: async () => { throw new Error('private handshake detail'); } });
    assert.equal(handshakeError.artifact.connection.status, 'BLOCKED');
    assert.equal(JSON.stringify(handshakeError.artifact).includes('private handshake detail'), false);

    const rejected = await passiveProbe({ ...common, execute: true, bearer: token, transport: async () => ({ connected: true, closed: true, closeCode: 1008, authFrameSent: true, cleanupComplete: true }) });
    assert.equal(rejected.artifact.authentication.outcome, 'REJECTED_POLICY');
    assert.equal(rejected.artifact.verdict, 'BLOCKED');

    const realThenRejected = await passiveProbe({ ...common, execute: true, bearer: token, transport: async ({ onMessage }) => {
      onMessage(JSON.stringify({ trnm: 'REAL', data: [{ type: '0D' }] }));
      return { connected: true, closed: true, closeCode: 1008, authFrameSent: true, cleanupComplete: true };
    } });
    assert.equal(realThenRejected.artifact.events.status, 'OBSERVED');
    assert.equal(realThenRejected.artifact.authentication.outcome, 'REJECTED_POLICY');
    assert.equal(realThenRejected.artifact.verdict, 'BLOCKED');

    const realWithoutAuthFrame = await passiveProbe({ ...common, execute: true, bearer: token, transport: async ({ onMessage }) => {
      onMessage(JSON.stringify({ trnm: 'REAL', data: [{ type: '0D' }] }));
      return { connected: true, closed: true, closeCode: 1000, authFrameSent: false, cleanupComplete: true };
    } });
    assert.equal(realWithoutAuthFrame.artifact.events.status, 'OBSERVED');
    assert.equal(realWithoutAuthFrame.artifact.authentication.outcome, 'NOT_SENT');
    assert.equal(realWithoutAuthFrame.artifact.verdict, 'BLOCKED');

    const cleanupFailed = await passiveProbe({ ...common, execute: true, bearer: token, transport: async () => ({ connected: true, closed: true, closeCode: 1000, authFrameSent: true, cleanupComplete: false }) });
    assert.equal(cleanupFailed.artifact.connection.status, 'BLOCKED_CLEANUP');
    assert.equal(cleanupFailed.artifact.connection.cleanup_status, 'FAILED_OR_TIMED_OUT');
    assert.equal(cleanupFailed.artifact.verdict, 'BLOCKED');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
