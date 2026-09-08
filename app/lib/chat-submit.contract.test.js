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

// 참조 칩(보드 21) — 칩을 접는 자리는 첨부 칩과 같고, 접히는 규칙은 세 가지다:
// 같은 참조를 두 번 쌓지 않고, 보낸 뒤에는 비우고, 사람이 쓴 문장은 그대로 남긴다.
// 렌더러 전역이라 require할 수 없어서 chat-submit 계약들과 같은 방식으로 구역을 들어낸다.
function loadReferenceFold() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'chat.js'), 'utf8');
  const start = src.indexOf('function addChatReference(ref) {');
  const end = src.indexOf("document.addEventListener('athena:chat-reference'");
  assert.ok(start >= 0 && end > start, '참조 칩 구역이 chat.js에 있다');
  const context = {
    chatRefs: [],
    renders: 0,
    focused: 0,
    renderRefChips() { context.renders += 1; },
    $input: { focus() { context.focused += 1; } },
  };
  vm.runInNewContext(src.slice(start, end), context);
  return context;
}

test('reference chips fold into a machine-readable tail and leave the typed sentence alone', () => {
  const c = loadReferenceFold();
  c.addChatReference({ kind: 'node', name: 'should_exit', lines: [26, 34], path: 'strategy.py' });
  assert.equal(c.consumeReferences('여기 왜 3일이야?'), '여기 왜 3일이야?\n\n[참조 @should_exit strategy.py L26-34]');
  // vm 안에서 만든 배열이라 deepEqual은 realm이 달라 걸린다 — 비었는지만 본다.
  assert.equal(c.chatRefs.length, 0, '보낸 뒤에는 비운다');
});

test('references without a line range promise nothing about line ranges', () => {
  const c = loadReferenceFold();
  c.addChatReference({ kind: 'all', name: '전체' });
  assert.equal(c.consumeReferences('전체적으로 이상해요'), '전체적으로 이상해요\n\n[참조 @전체]');
});

test('two references keep their order and an empty question sends the tail alone', () => {
  const c = loadReferenceFold();
  c.addChatReference({ kind: 'node', name: 'should_exit', lines: [26, 34], path: 'strategy.py' });
  c.addChatReference({ kind: 'flow', name: '진입 흐름' });
  assert.equal(c.consumeReferences('  '), '[참조 @should_exit strategy.py L26-34] [참조 @진입 흐름]');
});

test('the same reference does not stack when the card is pressed twice', () => {
  const c = loadReferenceFold();
  c.addChatReference({ kind: 'node', name: 'should_exit', lines: [26, 34] });
  c.addChatReference({ kind: 'node', name: 'should_exit', lines: [26, 34] });
  assert.equal(c.chatRefs.length, 1);
  assert.equal(c.renders, 1, '두 번째 누름은 다시 그리지 않는다');
  assert.equal(c.focused, 2, '두 번 다 초점은 입력창으로 돌아간다');
});

test('a question with no chips is passed through untouched', () => {
  const c = loadReferenceFold();
  assert.equal(c.consumeReferences('그냥 물어봅니다'), '그냥 물어봅니다');
  assert.equal(c.renders, 0);
});

test('the composer folds references at the same place it folds attachments', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'chat.js'), 'utf8');
  assert.match(src, /consumeReferences\(consumeAttachments\(\$input\.value\)\)/);
  // 기법이 갈리면 칩을 내린다 — 없는 함수를 가리키는 참조가 남으면 안 된다.
  const observed = src.indexOf('athena:chat-reference');
  assert.ok(observed >= 0);
  assert.match(src.slice(observed, observed + 900), /data-technique/);
});
