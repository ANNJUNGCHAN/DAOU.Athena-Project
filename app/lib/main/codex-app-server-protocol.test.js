'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CodexAppServerProtocol,
  CodexProtocolError,
} = require('./codex-app-server-protocol');

function createProtocol(options = {}) {
  const writes = [];
  const notifications = [];
  const protocol = new CodexAppServerProtocol({
    writeLine(line) {
      writes.push(line);
    },
    onNotification(notification) {
      notifications.push(notification);
    },
    ...options,
  });
  return { protocol, writes, notifications };
}

test('request IDs correlate out of order and wire envelopes omit jsonrpc', async () => {
  const { protocol, writes } = createProtocol();
  const first = protocol.request('initialize', { capabilities: { experimentalApi: false } });
  const second = protocol.request('thread/resume', { threadId: 'thread-1' });

  assert.deepEqual(JSON.parse(writes[0]), {
    id: 1,
    method: 'initialize',
    params: { capabilities: { experimentalApi: false } },
  });
  assert.equal('jsonrpc' in JSON.parse(writes[0]), false);

  protocol.acceptStdoutChunk('{"id":2,"result":{"thread":{"id":"thread-1"}}}\n');
  protocol.acceptStdoutChunk('{"id":1,"result":{"ok":true}}\n');
  assert.deepEqual(await first, { ok: true });
  assert.deepEqual(await second, { thread: { id: 'thread-1' } });
  assert.equal(protocol.pendingRequestCount, 0);
});

test('notifications accept optional emittedAtMs as diagnostics and never as ordering', () => {
  const { protocol, notifications } = createProtocol();
  protocol.acceptStdoutChunk([
    '{"method":"turn/started","params":{"turn":{"id":"t1"}},"emittedAtMs":900}',
    '{"method":"item/agentMessage/delta","params":{"delta":"a"},"emittedAtMs":100}',
  ].join('\n') + '\n');

  assert.deepEqual(notifications.map((entry) => entry.method), [
    'turn/started',
    'item/agentMessage/delta',
  ]);
  assert.deepEqual(notifications.map((entry) => entry.emittedAtMs), [900, 100]);
});

test('jsonrpc field is a contract violation on input and output', async () => {
  const { protocol } = createProtocol();
  assert.throws(
    () => protocol.notify('initialized', undefined, { jsonrpc: '2.0' }),
    (error) => error instanceof CodexProtocolError && error.code === 'CODEX_JSONRPC_FORBIDDEN',
  );
  assert.throws(
    () => protocol.acceptStdoutChunk('{"jsonrpc":"2.0","method":"initialized"}\n'),
    (error) => error instanceof CodexProtocolError && error.code === 'CODEX_JSONRPC_FORBIDDEN',
  );
});

test('EOF flushes a valid response without newline', async () => {
  const { protocol } = createProtocol();
  const pending = protocol.request('config/read', { cwd: 'C:\\workspace' });
  protocol.acceptStdoutChunk('{"id":1,"result":{"config":{}}}');
  protocol.endStdout();
  assert.deepEqual(await pending, { config: {} });
});

test('malformed EOF carry, oversized carry, and unknown response IDs fail closed', () => {
  const malformed = createProtocol().protocol;
  malformed.acceptStdoutChunk('{bad');
  assert.throws(
    () => malformed.endStdout(),
    (error) => error instanceof CodexProtocolError && error.code === 'CODEX_MALFORMED_JSONL',
  );

  const capped = createProtocol({ maxJsonlLineBytes: 8 }).protocol;
  assert.throws(
    () => capped.acceptStdoutChunk('123456789'),
    (error) => error instanceof CodexProtocolError && error.code === 'CODEX_JSONL_LINE_LIMIT',
  );

  const unknown = createProtocol().protocol;
  assert.throws(
    () => unknown.acceptStdoutChunk('{"id":404,"result":{}}\n'),
    (error) => error instanceof CodexProtocolError && error.code === 'CODEX_UNKNOWN_RESPONSE_ID',
  );
});

test('turn and generation output caps apply after terminal and stderr is a bounded ring', () => {
  const { protocol } = createProtocol({
    maxTurnOutputBytes: 20,
    maxGenerationOutputBytes: 60,
    maxStderrRingBytes: 8,
  });
  protocol.beginTurn('turn-1');
  protocol.acceptStderrChunk('abcdefghijk');
  assert.equal(protocol.stderrTail, 'defghijk');
  assert.throws(
    () => protocol.acceptStdoutChunk('{"method":"abc"}\n12345'),
    (error) => error instanceof CodexProtocolError && error.code === 'CODEX_TURN_OUTPUT_LIMIT',
  );

  const generation = createProtocol({ maxGenerationOutputBytes: 10 }).protocol;
  assert.throws(
    () => generation.acceptStdoutChunk('12345678901'),
    (error) => error instanceof CodexProtocolError && error.code === 'CODEX_GENERATION_OUTPUT_LIMIT',
  );
});

test('process exit rejects and clears all pending requests with safe diagnostics', async () => {
  const { protocol } = createProtocol();
  protocol.acceptStderrChunk('secret-looking diagnostic tail');
  const pending = protocol.request('initialize', {});
  protocol.failPending('CODEX_PROCESS_EXITED', 'Codex app-server exited');
  await assert.rejects(
    pending,
    (error) => error instanceof CodexProtocolError
      && error.code === 'CODEX_PROCESS_EXITED'
      && !error.message.includes('secret-looking'),
  );
  assert.equal(protocol.pendingRequestCount, 0);
});
