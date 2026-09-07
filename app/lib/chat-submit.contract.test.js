'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('athena:chat-submit waits for idle like Enter', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'chat.js'), 'utf8');
  const start = src.indexOf("addEventListener('athena:chat-submit'");
  assert.ok(start >= 0);
  const block = src.slice(start, start + 500);
  assert.match(block, /state !== 'idle' \|\| remoteQueryBusy/);
  assert.match(block, /appendSystemLine\('답변 중'\)/);
  assert.match(block, /dispatchUserQuery\(text\)/);
});
