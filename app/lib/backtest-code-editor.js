// 파이썬 전략 편집기와 diff 뷰 — Paper 백테스트 보드 02(설계·코드)·09(오류 진단).
//
// **왜 CodeMirror가 아닌가.** 계획서 §7.4는 CodeMirror 6을 적었고 §11-6은 그 대가를
// "두 번째 프런트 런타임 의존 · 번들 크기 · 오프라인 설치"로 기록해뒀다. 이 화면이 실제로
// 요구하는 것은 줄번호 · 단색 아닌 코드 · 탭 들여쓰기 · diff 넷뿐이다. 넷 다 100줄 남짓의
// 코드로 되고, 그 대신 오프라인 설치와 번들이 지금 그대로 남는다. 자동완성·린트·접기가
// 필요해지는 날 CodeMirror를 다시 꺼내면 된다 — 그때는 대가를 치를 이유가 생긴 것이다.
//
// **강조 방식.** 투명한 `<textarea>`를 색칠된 `<pre>` 위에 정확히 겹친다(널리 쓰이는
// 기법). 커서·선택·IME는 진짜 textarea가 처리하므로 한글 입력이 깨지지 않는다 — 직접
// contenteditable을 색칠했다면 조합 중인 글자가 매 키입력마다 날아갔을 것이다.
//
// **토크나이저의 정직한 한계.** 정규식 하나로 파이썬을 완전히 토큰화할 수는 없다. 여기서
// 다루는 것은 문자열·주석·숫자·키워드 넷이고, f-string 중첩 표현식 같은 것은 문자열 통째로
// 칠한다. 강조가 틀려도 코드의 의미는 안 바뀐다 — 이 파일은 실행 경로가 아니다.
(function () {
'use strict';

// 전략 코드가 실제로 쓰는 키워드만. 파이썬 전체 키워드를 넣어도 되지만, 목록이 길수록
// 오탐(변수명이 키워드처럼 칠해지는 일)이 늘고 얻는 것은 없다.
const KEYWORDS = [
  'and', 'as', 'assert', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else',
  'except', 'False', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
  'lambda', 'None', 'not', 'or', 'pass', 'raise', 'return', 'True', 'try', 'while',
  'with', 'yield',
];

const TOKEN_PATTERN = new RegExp(
  [
    '(#[^\\n]*)',                              // 1 주석
    '("""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\')', // 2 삼중 따옴표
    '("(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\')', // 3 문자열
    `\\b(${KEYWORDS.join('|')})\\b`,           // 4 키워드
    '\\b(\\d+\\.?\\d*)\\b',                    // 5 숫자
  ].join('|'),
  'g',
);

const CLASS_BY_GROUP = {
  1: 'tok-comment',
  2: 'tok-string',
  3: 'tok-string',
  4: 'tok-keyword',
  5: 'tok-number',
};

// ---------- 순수 계산 ----------

// 소스를 [{text, kind}] 조각으로 나눈다. kind가 null이면 평문이다.
function tokenize(source) {
  const text = String(source == null ? '' : source);
  const out = [];
  let last = 0;
  TOKEN_PATTERN.lastIndex = 0;
  let match = TOKEN_PATTERN.exec(text);
  while (match !== null) {
    if (match.index > last) out.push({ text: text.slice(last, match.index), kind: null });
    let kind = null;
    for (let g = 1; g <= 5; g += 1) {
      if (match[g] !== undefined) { kind = CLASS_BY_GROUP[g]; break; }
    }
    out.push({ text: match[0], kind });
    last = match.index + match[0].length;
    match = TOKEN_PATTERN.exec(text);
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: null });
  return out;
}

function lineCount(source) {
  return String(source == null ? '' : source).split('\n').length;
}

// 줄 단위 LCS diff — 계획서 §7.4가 "별도 라이브러리 없이 라인 단위 LCS"로 못박은 그것.
// 전략 파일은 수백 줄 규모라 O(n·m) 표로 충분하다.
function diffLines(before, after) {
  const a = String(before == null ? '' : before).split('\n');
  const b = String(after == null ? '' : after).split('\n');
  const n = a.length;
  const m = b.length;
  const table = [];
  for (let i = 0; i <= n; i += 1) table.push(new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ mark: ' ', text: a[i], beforeLine: i + 1, afterLine: j + 1 });
      i += 1; j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ mark: '-', text: a[i], beforeLine: i + 1, afterLine: null });
      i += 1;
    } else {
      out.push({ mark: '+', text: b[j], beforeLine: null, afterLine: j + 1 });
      j += 1;
    }
  }
  while (i < n) { out.push({ mark: '-', text: a[i], beforeLine: i + 1, afterLine: null }); i += 1; }
  while (j < m) { out.push({ mark: '+', text: b[j], beforeLine: null, afterLine: j + 1 }); j += 1; }
  return out;
}

function diffStats(rows) {
  return {
    added: rows.filter((r) => r.mark === '+').length,
    removed: rows.filter((r) => r.mark === '-').length,
  };
}

// 바뀐 줄 주변만 남긴다 — 200줄 파일에서 2줄이 바뀌었는데 200줄을 다 보여주면
// 무엇이 바뀌었는지가 오히려 안 보인다.
function collapseUnchanged(rows, context) {
  const pad = context === undefined ? 2 : context;
  const keep = new Set();
  rows.forEach((row, i) => {
    if (row.mark === ' ') return;
    for (let k = Math.max(0, i - pad); k <= Math.min(rows.length - 1, i + pad); k += 1) {
      keep.add(k);
    }
  });
  const out = [];
  let skipping = false;
  rows.forEach((row, i) => {
    if (keep.has(i)) { out.push(row); skipping = false; return; }
    if (!skipping) { out.push({ mark: '…', text: '', beforeLine: null, afterLine: null }); }
    skipping = true;
  });
  return out;
}

// ---------- DOM ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function renderHighlight(pre, source) {
  while (pre.firstChild) pre.removeChild(pre.firstChild);
  tokenize(source).forEach((piece) => {
    if (piece.kind === null) {
      pre.appendChild(document.createTextNode(piece.text));
      return;
    }
    pre.appendChild(el('span', `backtest-code-${piece.kind}`, piece.text));
  });
  // 마지막 줄이 개행으로 끝나면 <pre>가 그 줄을 세지 않아 textarea와 높이가 어긋난다.
  pre.appendChild(document.createTextNode('\n'));
}

function renderGutter(gutter, source, highlightRange) {
  while (gutter.firstChild) gutter.removeChild(gutter.firstChild);
  const total = lineCount(source);
  for (let i = 1; i <= total; i += 1) {
    const inRange = highlightRange
      && i >= highlightRange.first
      && i <= highlightRange.last;
    gutter.appendChild(el('div', `backtest-code-line${inRange ? ' is-lit' : ''}`, i));
  }
}

// 편집기 하나. `onChange`는 매 입력마다 불린다 — 저장은 호출자가 정한다(사람이 [저장]을
// 눌러야 새 버전이 생긴다는 규율은 캔버스가 지킨다).
function createCodeEditor(options) {
  const opts = options || {};
  const container = opts.container;
  if (!container) return { setValue() {}, getValue() { return ''; }, highlightLines() {} };

  const wrap = el('div', 'backtest-code-editor');
  const gutter = el('div', 'backtest-code-gutter');
  const stack = el('div', 'backtest-code-stack');
  const pre = el('pre', 'backtest-code-pre');
  const textarea = document.createElement('textarea');
  textarea.className = 'backtest-code-textarea';
  textarea.spellcheck = false;
  textarea.setAttribute('aria-label', '전략 파이썬 코드');
  if (opts.readOnly) textarea.readOnly = true;

  stack.appendChild(pre);
  stack.appendChild(textarea);
  wrap.appendChild(gutter);
  wrap.appendChild(stack);
  container.appendChild(wrap);

  let value = String(opts.value || '');
  let range = null;

  function paint() {
    renderHighlight(pre, value);
    renderGutter(gutter, value, range);
  }

  textarea.value = value;
  paint();

  textarea.addEventListener('input', () => {
    value = textarea.value;
    paint();
    if (opts.onChange) opts.onChange(value);
  });

  // 스크롤을 세 겹이 함께 움직여야 줄번호와 코드가 어긋나지 않는다.
  textarea.addEventListener('scroll', () => {
    pre.scrollTop = textarea.scrollTop;
    pre.scrollLeft = textarea.scrollLeft;
    gutter.scrollTop = textarea.scrollTop;
  });

  // Tab이 포커스를 옮기면 파이썬 편집기로 쓸 수 없다 — 4칸 들여쓰기로 가로챈다.
  textarea.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.value = `${textarea.value.slice(0, start)}    ${textarea.value.slice(end)}`;
    textarea.selectionStart = start + 4;
    textarea.selectionEnd = start + 4;
    value = textarea.value;
    paint();
    if (opts.onChange) opts.onChange(value);
  });

  return {
    setValue(next) {
      value = String(next || '');
      textarea.value = value;
      paint();
    },
    getValue() { return value; },
    // 플로우 지도(보드 08)에서 칸을 누르면 그 줄을 켠다.
    highlightLines(first, last) {
      range = first == null ? null : { first, last: last == null ? first : last };
      paint();
    },
  };
}

// diff 뷰 — 보드 02(코드 초안)·05(코드 diff)·09(수정안)가 같은 문법을 쓴다.
function renderDiff(container, before, after, options) {
  const opts = options || {};
  while (container.firstChild) container.removeChild(container.firstChild);
  const rows = diffLines(before, after);
  const shown = opts.full ? rows : collapseUnchanged(rows, opts.context);
  const table = el('div', 'backtest-diff');
  shown.forEach((row) => {
    if (row.mark === '…') {
      table.appendChild(el('div', 'backtest-diff-gap', '…'));
      return;
    }
    const line = el('div', `backtest-diff-row is-${
      row.mark === '+' ? 'add' : (row.mark === '-' ? 'del' : 'same')
    }`);
    line.appendChild(el('span', 'backtest-diff-mark', row.mark === ' ' ? '' : row.mark));
    line.appendChild(el('span', 'backtest-diff-no', row.afterLine || row.beforeLine || ''));
    line.appendChild(el('span', 'backtest-diff-text', row.text));
    table.appendChild(line);
  });
  container.appendChild(table);
  return diffStats(rows);
}

const __exports = {
  KEYWORDS,
  tokenize,
  lineCount,
  diffLines,
  diffStats,
  collapseUnchanged,
  createCodeEditor,
  renderDiff,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BacktestCodeEditor = __exports;
}

})();
