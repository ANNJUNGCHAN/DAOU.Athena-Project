'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CodexJsonlRpcClient } = require('./codex-jsonl-rpc-client');

test('exact Codex JSONL transport module exposes the bounded RPC client', async () => {
  assert.equal(typeof CodexJsonlRpcClient, 'function');
  const writes = [];
  const client = new CodexJsonlRpcClient({ writeLine: (line) => writes.push(line) });
  const pending = client.request('initialize', {});
  client.acceptStdoutChunk('{"id":1,"result":{}}');
  client.endStdout();
  assert.deepEqual(await pending, {});
  assert.equal(writes[0], '{"id":1,"method":"initialize","params":{}}\n');
});
