'use strict';

// backtest-code-editor.js — 토크나이저와 diff만 검증한다(DOM 없이).
//
// diff가 이 파일의 중심이다. 사람은 diff를 보고 [적용]을 누른다 — diff가 틀리면
// 사람은 자기가 승인하지 않은 변경을 승인하게 된다.

const test = require('node:test');
const assert = require('node:assert/strict');

const editor = require('./backtest-code-editor');

function kinds(source) {
  return editor.tokenize(source).filter((t) => t.kind).map((t) => [t.kind, t.text]);
}

// ── 토크나이저 ───────────────────────────────────────────────────────────────

test('주석·문자열·키워드·숫자를 갈라낸다', () => {
  assert.deepEqual(kinds('def f():  # hi\n    return "x" + 12'), [
    ['tok-keyword', 'def'],
    ['tok-comment', '# hi'],
    ['tok-keyword', 'return'],
    ['tok-string', '"x"'],
    ['tok-number', '12'],
  ]);
});

test('삼중 따옴표 docstring을 통째로 문자열로 본다', () => {
  const out = kinds('"""여러\n줄"""\nx = 1');
  assert.equal(out[0][0], 'tok-string');
  assert.match(out[0][1], /여러/);
});

test('문자열 안의 # 은 주석이 아니다', () => {
  assert.deepEqual(kinds('x = "# not a comment"'), [['tok-string', '"# not a comment"']]);
});

test('이스케이프된 따옴표에서 문자열이 끊기지 않는다', () => {
  assert.deepEqual(kinds('x = "a\\"b"'), [['tok-string', '"a\\"b"']]);
});

test('키워드가 이름 일부이면 칠하지 않는다', () => {
  assert.deepEqual(kinds('define = 1'), [['tok-number', '1']]);
});

test('조각을 이어붙이면 원본이 그대로 나온다 — 강조가 코드를 바꾸지 않는다', () => {
  const src = 'def signals(df, p):  # 시작\n    return df[["entry", "exit"]]  # 끝\n';
  assert.equal(editor.tokenize(src).map((t) => t.text).join(''), src);
});

test('빈 소스와 null을 견딘다', () => {
  assert.deepEqual(editor.tokenize(''), []);
  assert.deepEqual(editor.tokenize(null), []);
});

test('줄 수를 센다', () => {
  assert.equal(editor.lineCount('a\nb\nc'), 3);
  assert.equal(editor.lineCount(''), 1);
});

// ── diff ────────────────────────────────────────────────────────────────────

test('같은 소스는 변경 줄이 없다', () => {
  const rows = editor.diffLines('a\nb', 'a\nb');
  assert.deepEqual(editor.diffStats(rows), { added: 0, removed: 0 });
  assert.ok(rows.every((r) => r.mark === ' '));
});

test('한 줄 교체는 삭제 1 + 추가 1이다', () => {
  const rows = editor.diffLines('a\nb\nc', 'a\nB\nc');
  assert.deepEqual(editor.diffStats(rows), { added: 1, removed: 1 });
});

test('한 줄이 두 줄로 늘어난 경우(보드 09의 실제 수정안 모양)', () => {
  const before = 'x = 1\nstop = df.close - atr\ny = 2\n';
  const after = 'x = 1\nstop = (df.close - atr) \\\n    .where(entry).ffill()\ny = 2\n';
  assert.deepEqual(editor.diffStats(editor.diffLines(before, after)), {
    added: 2, removed: 1,
  });
});

test('순수 추가는 삭제를 만들지 않는다', () => {
  assert.deepEqual(editor.diffStats(editor.diffLines('a\n', 'a\nb\n')), {
    added: 1, removed: 0,
  });
});

test('순수 삭제는 추가를 만들지 않는다', () => {
  assert.deepEqual(editor.diffStats(editor.diffLines('a\nb\n', 'a\n')), {
    added: 0, removed: 1,
  });
});

test('빈 파일에서 시작하는 diff', () => {
  assert.deepEqual(editor.diffStats(editor.diffLines('', 'a\nb')), {
    added: 2, removed: 1,
  });
});

test('줄 번호는 각 쪽 기준으로 매겨진다', () => {
  const rows = editor.diffLines('a\nb\nc', 'a\nc');
  const kept = rows.filter((r) => r.mark === ' ');
  assert.deepEqual(kept.map((r) => [r.beforeLine, r.afterLine]), [[1, 1], [3, 2]]);
  const deleted = rows.find((r) => r.mark === '-');
  assert.equal(deleted.afterLine, null);
});

test('LCS라서 공통 줄을 최대한 남긴다 — 파일 전체를 갈아엎지 않는다', () => {
  const before = 'a\nb\nc\nd\ne';
  const after = 'a\nc\ne';
  const rows = editor.diffLines(before, after);
  assert.equal(rows.filter((r) => r.mark === ' ').length, 3);
});

// ── 접기 ────────────────────────────────────────────────────────────────────

test('안 바뀐 구간은 접고 바뀐 줄 주변만 남긴다', () => {
  const before = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
  const after = before.replace('line10', 'CHANGED');
  const rows = editor.diffLines(before, after);
  const shown = editor.collapseUnchanged(rows, 1);
  assert.ok(shown.length < rows.length);
  assert.ok(shown.some((r) => r.mark === '…'));
  assert.ok(shown.some((r) => r.text === 'CHANGED'));
});

test('접어도 바뀐 줄은 하나도 사라지지 않는다', () => {
  const before = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n');
  const after = before.replace('l3', 'X').replace('l25', 'Y');
  const rows = editor.diffLines(before, after);
  const shown = editor.collapseUnchanged(rows, 2);
  const changed = (list) => list.filter((r) => r.mark === '+' || r.mark === '-').length;
  assert.equal(changed(shown), changed(rows));
});

test('변경이 없으면 전부 접힌다', () => {
  const src = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n');
  const shown = editor.collapseUnchanged(editor.diffLines(src, src), 2);
  assert.deepEqual(shown.map((r) => r.mark), ['…']);
});
