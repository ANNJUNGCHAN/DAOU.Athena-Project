import test from 'node:test';
import assert from 'node:assert/strict';
import { unknownIpcChannels } from './check-harness-freshness.mjs';

const knownChannels = new Set(['athena:known-ipc']);

test('DOM athena events are not classified as IPC channels', () => {
  assert.deepEqual(
    unknownIpcChannels("document.addEventListener('athena:chat-submit', listener, true);", knownChannels),
    [],
  );
  assert.deepEqual(
    unknownIpcChannels("document.removeEventListener('athena:chat-submit', listener, true);", knownChannels),
    [],
  );
});

test('a genuine unknown IPC channel is still rejected beside a DOM event', () => {
  const line = "document.addEventListener('athena:chat-submit', listener); window.athena.send('athena:unknown-ipc');";
  assert.deepEqual(unknownIpcChannels(line, knownChannels), ['athena:unknown-ipc']);
});
