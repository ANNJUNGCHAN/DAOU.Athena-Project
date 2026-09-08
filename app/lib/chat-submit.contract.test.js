'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('routine suggestion submits its complete request once without replacing the composer', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  const callback = src.match(/onAddSuggestion: (\(text\) => \{[\s\S]*?\n  \}),/);
  assert.ok(callback, 'routine suggestion callback exists');
  const events = [];
  const onAddSuggestion = vm.runInNewContext(`(${callback[1]})`, {
    document: { dispatchEvent: (event) => events.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  });
  const text = '삼성전자 감시 루틴을 검사까지 마친 초안으로 만들어줘.';
  onAddSuggestion(text);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'athena:chat-submit');
  assert.equal(events[0].detail.text, text);
});

test('submitted routine requests respect both busy gates and only dispatch when idle', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'chat.js'), 'utf8');
  const start = src.indexOf("document.addEventListener('athena:chat-submit'");
  const end = src.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  for (const [state, remoteQueryBusy, expected] of [['idle', false, 1], ['thinking', false, 0], ['idle', true, 0]]) {
    let handler;
    const submitted = [];
    const notices = [];
    vm.runInNewContext(src.slice(start, end), {
      document: { addEventListener: (_name, fn) => { handler = fn; } },
      state, remoteQueryBusy,
      dispatchUserQuery: (text) => submitted.push(text),
      appendSystemLine: (text) => notices.push(text),
    });
    handler({ detail: { text: '완성된 루틴 초안을 만들어줘' } });
    assert.equal(submitted.length, expected);
    assert.equal(notices.length, 1 - expected);
  }
});

test('athena:chat-submit waits for idle like Enter', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'chat.js'), 'utf8');
  const start = src.indexOf("addEventListener('athena:chat-submit'");
  assert.ok(start >= 0);
  const block = src.slice(start, start + 500);
  assert.match(block, /state !== 'idle' \|\| remoteQueryBusy/);
  assert.match(block, /appendSystemLine\('답변 중'\)/);
  assert.match(block, /dispatchUserQuery\(text\)/);
});
