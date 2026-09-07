'use strict';

// backtest-code-editor.js — 토크나이저와 diff만 검증한다(DOM 없이).
//
// diff가 이 파일의 중심이다. 사람은 diff를 보고 [적용]을 누른다 — diff가 틀리면
// 사람은 자기가 승인하지 않은 변경을 승인하게 된다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const editor = require('./backtest-code-editor');

const SHELL_CSS = fs.readFileSync(path.join(__dirname, '..', 'shell.css'), 'utf8');

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

// ── 노드 ↔ 코드 연결(보드 13) ────────────────────────────────────────────────
//
// jsdom 없이 최소 DOM 스텁으로 검증한다(backtest-explain.test.js·backtest-canvas.test.js가
// 세운 관례). 여기서 지키는 계약은 하나다: **연결이 확실할 때만 줄을 연다.** 낡은 map으로
// 비슷한 줄을 추정하면 사람은 원인이 아닌 줄을 원인으로 읽는다.

function fakeNode(tag) {
  return {
    tag,
    className: '',
    textContent: '',
    value: '',
    hidden: false,
    readOnly: false,
    spellcheck: true,
    focused: false,
    selectionStart: 0,
    selectionEnd: 0,
    scrollTop: 0,
    scrollLeft: 0,
    children: [],
    attrs: {},
    _listeners: {},
    get firstChild() { return this.children[0] || null; },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter((c) => c !== child); return child; },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === 'class') this.className = String(v);
    },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    focus() { this.focused = true; },
    addEventListener(type, handler) {
      (this._listeners[type] = this._listeners[type] || []).push(handler);
    },
    dispatchEvent(event) {
      (this._listeners[event && event.type] || []).forEach((h) => h(event));
      return true;
    },
  };
}

function findByClass(node, cls) {
  const found = [];
  const walk = (n) => {
    if (String(n.className || '').split(/\s+/).includes(cls)) found.push(n);
    (n.children || []).forEach(walk);
  };
  walk(node);
  return found;
}

const SRC = [
  'import pandas as pd',
  '',
  'def signals(df, p):',
  '    fast = df.close.rolling(p["fast"]).mean()',
  '    slow = df.close.rolling(p["slow"]).mean()',
  '    return fast, slow',
  '',
].join('\n');

// 4번째 줄이 시작하는 문자 오프셋 — 열 선택을 눈으로 세지 않고 계산해서 비교한다.
const LINE4_START = SRC.split('\n').slice(0, 3).reduce((n, line) => n + line.length + 1, 0);

function mount(options) {
  global.document = {
    createElement: (tag) => fakeNode(tag),
    createTextNode: (text) => ({ tag: '#text', textContent: text, children: [] }),
  };
  const host = fakeNode('div');
  const handle = editor.createCodeEditor(Object.assign({ container: host, value: SRC }, options));
  return { host, handle };
}

const one = (host, cls) => findByClass(host, cls)[0];

test('캔버스의 가운데 정렬은 코드 본문에 상속되지 않는다', () => {
  assert.match(SHELL_CSS, /\.backtest-code-root\s*{[^}]*text-align:\s*left\s*;/s);
  assert.match(SHELL_CSS, /\.backtest-code-pre,\s*\.backtest-code-textarea\s*{[^}]*text-align:\s*left\s*;/s);
  assert.match(SHELL_CSS, /\.backtest-code-gutter\s*{[^}]*text-align:\s*right\s*;/s);
  assert.match(SHELL_CSS, /\.backtest-code-marker\s*{[^}]*text-align:\s*right\s*;/s);
});
const litLines = (host) => findByClass(host, 'backtest-code-line')
  .filter((n) => n.className.split(/\s+/).includes('is-lit'))
  .map((n) => n.textContent);

test.after(() => { delete global.document; });

test('openSpan은 줄을 켜고 열까지 선택하고 포커스를 준다', () => {
  const { host, handle } = mount({});
  const opened = handle.openSpan(
    { start: { line: 4, column: 4 }, end: { line: 5, column: 8 } },
    { kind: 'authoritative', node: { id: 'ma_slow', label: '느린 SMA' }, file: 'strategy.py' },
  );
  assert.equal(opened, true);
  assert.deepEqual(litLines(host), ['4', '5']);
  const textarea = one(host, 'backtest-code-textarea');
  assert.equal(textarea.selectionStart, LINE4_START + 4);
  assert.equal(textarea.selectionEnd, LINE4_START + SRC.split('\n')[3].length + 1 + 8);
  assert.equal(textarea.focused, true);
  // 켠 줄이 맨 위에 붙지 않게 두 줄 위부터 보인다(줄 높이 18px).
  assert.equal(textarea.scrollTop, 18);
});

test('열이 없으면 그 줄 전체를 잡는다', () => {
  const { host, handle } = mount({});
  handle.openSpan({ start: { line: 4 } }, { kind: 'authoritative', node: { id: 'x' } });
  const textarea = one(host, 'backtest-code-textarea');
  assert.equal(textarea.selectionStart, LINE4_START);
  assert.equal(textarea.selectionEnd, LINE4_START + SRC.split('\n')[3].length);
});

test('리본은 연결된 노드·파일:줄·종류를 말한다 — authoritative', () => {
  const { host, handle } = mount({});
  handle.openSpan(
    { start: { line: 4, column: 4 } },
    {
      kind: 'authoritative',
      node: { id: 'ma_slow', label: '느린 SMA' },
      code: 'E_MISSING_INPUT',
      file: 'strategy.py',
    },
  );
  assert.equal(one(host, 'backtest-code-ribbon').hidden, false);
  assert.equal(one(host, 'backtest-code-ribbon-label').textContent, '연결된 노드 · 느린 SMA');
  assert.equal(one(host, 'backtest-code-ribbon-loc').textContent, 'strategy.py:4');
  assert.equal(one(host, 'backtest-code-ribbon-code').textContent, 'E_MISSING_INPUT');
  assert.equal(one(host, 'backtest-code-ribbon-kind').textContent, '연결됨');
});

test('preview span은 리본에서 미실행 미리보기로 표시된다', () => {
  const { host, handle } = mount({});
  handle.openSpan(
    { start: { line: 4 } },
    { kind: 'preview', node: { id: 'ma_slow', label: '느린 SMA' }, file: 'preview.py' },
  );
  const kind = one(host, 'backtest-code-ribbon-kind');
  assert.equal(kind.textContent, '미실행 미리보기');
  assert.ok(kind.className.split(/\s+/).includes('is-preview'));
});

test('message가 있으면 켠 줄에 인라인 표식이 얹힌다', () => {
  const { host, handle } = mount({});
  handle.openSpan(
    { start: { line: 4 }, message: '느린 SMA 입력이 비었습니다' },
    { kind: 'preview', node: { id: 'ma_slow', label: '느린 SMA' } },
  );
  const marker = one(host, 'backtest-code-marker');
  assert.equal(marker.hidden, false);
  assert.equal(marker.textContent, '! 4  느린 SMA 입력이 비었습니다');
  // 10px(pre 패딩) + 3줄 × 18px − 스크롤 18px.
  assert.equal(marker.attrs.style, 'top:46px');
});

test('[시각 설계에서 보기]는 열고 들어온 node_id로 되돌린다', () => {
  const seen = [];
  const { host, handle } = mount({ onBackToNode: (id) => seen.push(id) });
  handle.openSpan({ start: { line: 4 } }, { kind: 'authoritative', node: { id: 'ma_slow' } });
  const back = one(host, 'backtest-code-ribbon-back');
  assert.equal(back.hidden, false);
  back.dispatchEvent({ type: 'click' });
  assert.deepEqual(seen, ['ma_slow']);
});

test('줄이 없는 span은 아무것도 열지 않는다', () => {
  const { host, handle } = mount({});
  assert.equal(handle.openSpan(null, {}), false);
  assert.equal(handle.openSpan({ start: {} }, {}), false);
  assert.equal(one(host, 'backtest-code-ribbon').hidden, true);
});

test('미리보기 전용은 읽기 전용 + 전폭 배너 + 흐린 편집기다', () => {
  const { host, handle } = mount({});
  const textarea = one(host, 'backtest-code-textarea');
  handle.setPreviewOnly(true, { reason_ko: '느린 SMA 입력 누락' });
  assert.equal(handle.isPreviewOnly(), true);
  assert.equal(textarea.readOnly, true);
  const banner = one(host, 'backtest-code-preview-banner');
  assert.equal(banner.hidden, false);
  assert.equal(banner.textContent, `${editor.PREVIEW_BANNER_TEXT} · 느린 SMA 입력 누락`);
  assert.ok(one(host, 'backtest-code-editor').className.split(/\s+/).includes('is-preview-only'));

  handle.setPreviewOnly(false);
  assert.equal(handle.isPreviewOnly(), false);
  assert.equal(textarea.readOnly, false);
  assert.equal(one(host, 'backtest-code-preview-banner').hidden, true);
  assert.ok(!one(host, 'backtest-code-editor').className.split(/\s+/).includes('is-preview-only'));
});

test('showNotice는 map이 낡았을 때의 한 줄을 띄운다', () => {
  const { host, handle } = mount({});
  const notice = one(host, 'backtest-code-notice');
  assert.equal(notice.hidden, true);
  handle.showNotice(editor.STALE_NOTICE_TEXT);
  assert.equal(notice.hidden, false);
  assert.match(notice.textContent, /정확한 코드 위치를 만들 수 없습니다/);
});

test('전략 파일 띠는 그래프 출처·연결된 구성·호환 모드를 적는다', () => {
  const { host, handle } = mount({});
  handle.setFileMeta({
    name: 'strategy.py',
    generatedFromGraph: true,
    linked: { data: '005930 일봉', indicators: 'SMA 20 · SMA 60', entryExit: '교차 진입·교차 청산' },
    compatMode: true,
  });
  const strip = one(host, 'backtest-code-filemeta');
  assert.equal(strip.hidden, false);
  const texts = strip.children.map((c) => c.textContent);
  assert.deepEqual(texts, [
    '전략 파일',
    'strategy.py',
    '그래프에서 생성됨',
    '연결된 구성',
    '데이터 · 005930 일봉',
    '지표 · SMA 20 · SMA 60',
    '진입·청산 · 교차 진입·교차 청산',
    '그래프 호환 모드',
  ]);
  handle.setFileMeta(null);
  assert.equal(one(host, 'backtest-code-filemeta').hidden, true);
});

test('맨 아래 줄은 연결됨과 코드 전용 되물음을 갈라 말한다', () => {
  const { host, handle } = mount({});
  handle.setLinkStatus({ linked: true });
  const status = one(host, 'backtest-code-linkstatus');
  assert.equal(status.hidden, false);
  assert.equal(status.textContent, '● 노드·코드 연결됨 · 노드 ↔ 코드 줄 범위');
  assert.ok(status.className.split(/\s+/).includes('is-linked'));

  handle.setLinkStatus({ linked: false });
  assert.equal(
    one(host, 'backtest-code-linkstatus').textContent,
    '그래프로 표현할 수 없는 수정은 적용 전에 코드 전용 전환을 묻습니다',
  );
});

test('highlightLines는 그대로다 — 리본 없이 줄만 켠다', () => {
  const { host, handle } = mount({});
  handle.highlightLines(2, 3);
  assert.deepEqual(litLines(host), ['2', '3']);
  assert.equal(one(host, 'backtest-code-ribbon').hidden, true);
  handle.highlightLines(null);
  assert.deepEqual(litLines(host), []);
});

// ── source map 신선도 ───────────────────────────────────────────────────────

test('hashSource는 64자 hex sha256이다', async () => {
  const empty = await editor.hashSource('');
  assert.match(empty, /^[0-9a-f]{64}$/);
  assert.equal(empty, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(await editor.hashSource(SRC), await editor.hashSource(SRC));
});

test('artifact_hash가 맞으면 authoritative span은 유효하다', async () => {
  const bundle = { kind: 'authoritative', artifact_hash: await editor.hashSource(SRC) };
  assert.deepEqual(await editor.spanIsValid(bundle, SRC), { ok: true, reason_ko: null });
});

test('코드가 한 글자만 바뀌어도 map은 낡은 것이다', async () => {
  const bundle = { kind: 'authoritative', artifact_hash: await editor.hashSource(SRC) };
  const result = await editor.spanIsValid(bundle, `${SRC}# 손으로 한 줄\n`);
  assert.equal(result.ok, false);
  assert.match(result.reason_ko, /낡았습니다/);
});

test('preview map은 preview_hash로 대조한다', async () => {
  const hash = await editor.hashSource(SRC);
  assert.equal((await editor.spanIsValid({ kind: 'preview', preview_hash: hash }, SRC)).ok, true);
  // authoritative 해시를 들고 있어도 preview는 preview_hash가 없으면 못 연다.
  const wrong = await editor.spanIsValid({ kind: 'preview', artifact_hash: hash }, SRC);
  assert.equal(wrong.ok, false);
  assert.match(wrong.reason_ko, /미리보기 해시/);
});

test('묶음이 없으면 유효하지 않다 — 없는 연결을 지어내지 않는다', async () => {
  const result = await editor.spanIsValid(null, SRC);
  assert.equal(result.ok, false);
  assert.match(result.reason_ko, /연결 정보가 없습니다/);
});
