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

// ---------- 노드 ↔ 코드 연결(보드 13) ----------

// 코드 한 줄의 높이(px). shell.css의 .backtest-code-line·.backtest-code-pre와 같은 값이어야
// 스크롤 위치와 인라인 표식이 진짜 그 줄에 얹힌다.
const LINE_HEIGHT = 18;
// .backtest-code-pre의 padding-top. 표식을 첫 줄에 맞추는 데 쓴다.
const CODE_PAD_TOP = 10;

// 보드 13의 고정 문구 — 화면·테스트·캔버스가 같은 상수를 본다.
const PREVIEW_BANNER_TEXT = '미실행 오류 미리보기 — 이 코드는 실행·저장 대상이 아닙니다';
const STALE_NOTICE_TEXT = '현재 오류의 정확한 코드 위치를 만들 수 없습니다 — 다시 검증하거나 코드 전용으로 검토하세요';
const LINK_TEXT = '노드 ↔ 코드 줄 범위';
const UNLINK_TEXT = '그래프로 표현할 수 없는 수정은 적용 전에 코드 전용 전환을 물습니다';
const NOTICE_MS = 6000;

// span은 {start:{line,column}, end:{line,column}, message}. line은 1부터, column은 0부터다
// — 파이썬 AST의 lineno/col_offset 규약 그대로이고, 서버 source map이 그 값을 그대로 싣는다.
function normalizeSpan(span) {
  const start = span && span.start;
  if (!start || !Number.isFinite(Number(start.line))) return null;
  const end = span.end || start;
  const startLine = Math.max(1, Math.floor(Number(start.line)));
  const endLine = Number.isFinite(Number(end.line))
    ? Math.max(startLine, Math.floor(Number(end.line)))
    : startLine;
  const col = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : null);
  return {
    startLine,
    endLine,
    startColumn: col(start.column),
    endColumn: col(end.column),
    message: span.message == null ? null : String(span.message),
  };
}

// sha256 hex. 렌더러에서는 Web Crypto(SubtleCrypto.digest — 그래서 비동기다)를 쓰고,
// 그것이 없는 node 테스트·구형 런타임에서만 node:crypto로 내려간다. 둘 다 같은 sha256이라
// 서버가 계산한 artifact_hash와 그대로 대조된다. 어느 쪽도 없으면 던진다 — 임시 해시를
// 지어내면 낡은 map이 유효한 척 통과하고, 그 순간 사람은 엉뚱한 줄을 원인으로 읽는다.
async function hashSource(text) {
  const source = String(text == null ? '' : text);
  const webcrypto = typeof globalThis === 'undefined' ? null : globalThis.crypto;
  if (webcrypto && webcrypto.subtle && typeof TextEncoder === 'function') {
    const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  if (typeof require === 'function') {
    return require('node:crypto').createHash('sha256').update(source, 'utf8').digest('hex');
  }
  throw new Error('sha256을 계산할 수 없습니다');
}

// 서버가 준 source map 묶음이 지금 편집기에 있는 코드에서 나온 것인지 본다. authoritative는
// artifact_hash, preview는 preview_hash와 대조한다. 어긋나면 비슷한 줄을 추정하지 않는다 —
// 추정한 줄은 사람에게 "여기가 원인"이라고 거짓말한다(평가서 §오류 노드 더블클릭 4항).
async function spanIsValid(sourceMapBundle, currentSource) {
  const bundle = sourceMapBundle || null;
  if (!bundle) return { ok: false, reason_ko: '노드·코드 연결 정보가 없습니다' };
  const preview = bundle.kind === 'preview';
  const expected = preview ? bundle.preview_hash : bundle.artifact_hash;
  if (!expected) {
    return {
      ok: false,
      reason_ko: preview ? '미리보기 해시가 없습니다' : '실행 산출물 해시가 없습니다',
    };
  }
  let actual = null;
  try {
    actual = await hashSource(currentSource);
  } catch {
    return { ok: false, reason_ko: '코드 해시를 계산할 수 없습니다' };
  }
  if (actual !== String(expected)) {
    return { ok: false, reason_ko: '코드가 바뀌어 노드·코드 연결이 낡았습니다' };
  }
  return { ok: true, reason_ko: null };
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
  if (!container) {
    return {
      setValue() {}, getValue() { return ''; }, highlightLines() {},
      openSpan() { return false; },
      setPreviewOnly() {}, isPreviewOnly() { return false; }, showNotice() {},
      setFileMeta() {}, setLinkStatus() {},
    };
  }

  const root = el('div', 'backtest-code-root');
  // 이 편집기에는 옆 패널이 없다 — 보드 13의 "전략 파일" 패널은 편집기 위 한 줄 띠로 접는다.
  const meta = el('div', 'backtest-code-filemeta');
  meta.hidden = true;
  const ribbon = el('div', 'backtest-code-ribbon');
  ribbon.hidden = true;
  const ribbonLabel = el('span', 'backtest-code-ribbon-label');
  const ribbonLoc = el('span', 'backtest-code-ribbon-loc');
  const ribbonCode = el('span', 'backtest-code-ribbon-code');
  ribbonCode.hidden = true;
  const ribbonKind = el('span', 'backtest-code-ribbon-kind');
  const ribbonBack = el('button', 'backtest-code-ribbon-back', '시각 설계에서 보기');
  ribbon.appendChild(ribbonLabel);
  ribbon.appendChild(ribbonLoc);
  ribbon.appendChild(ribbonCode);
  ribbon.appendChild(ribbonKind);
  ribbon.appendChild(ribbonBack);
  const banner = el('div', 'backtest-code-preview-banner');
  banner.hidden = true;
  const notice = el('div', 'backtest-code-notice');
  notice.hidden = true;
  const status = el('div', 'backtest-code-linkstatus');
  status.hidden = true;

  const wrap = el('div', 'backtest-code-editor');
  const gutter = el('div', 'backtest-code-gutter');
  const stack = el('div', 'backtest-code-stack');
  const pre = el('pre', 'backtest-code-pre');
  const marker = el('div', 'backtest-code-marker');
  marker.hidden = true;
  const textarea = document.createElement('textarea');
  textarea.className = 'backtest-code-textarea';
  textarea.spellcheck = false;
  textarea.setAttribute('aria-label', '전략 파이썬 코드');
  if (opts.readOnly) textarea.readOnly = true;

  stack.appendChild(pre);
  stack.appendChild(textarea);
  stack.appendChild(marker);
  wrap.appendChild(gutter);
  wrap.appendChild(stack);
  root.appendChild(meta);
  root.appendChild(ribbon);
  root.appendChild(banner);
  root.appendChild(notice);
  root.appendChild(wrap);
  root.appendChild(status);
  container.appendChild(root);

  let value = String(opts.value || '');
  let range = null;
  let markerLine = null;
  let previewOnly = false;
  let linkedNodeId = null;
  let metaName = '';
  let noticeTimer = null;

  // 표식은 stack 안에 절대 배치되므로 스크롤을 따라가지 않는다 — scrollTop을 빼서 직접
  // 붙인다. style 프로퍼티 대신 setAttribute를 쓰는 건 테스트의 DOM 스텁 때문이다.
  function placeMarker() {
    if (markerLine == null) { marker.hidden = true; return; }
    marker.hidden = false;
    const top = CODE_PAD_TOP + (markerLine - 1) * LINE_HEIGHT - (textarea.scrollTop || 0);
    marker.setAttribute('style', `top:${top}px`);
  }

  function paint() {
    renderHighlight(pre, value);
    renderGutter(gutter, value, range);
    placeMarker();
  }

  // line은 1부터, column은 0부터. 줄·열을 textarea가 아는 문자 오프셋으로 바꾼다.
  function offsetOf(line, column) {
    const lines = value.split('\n');
    const index = Math.min(Math.max(1, line), lines.length) - 1;
    let offset = 0;
    for (let i = 0; i < index; i += 1) offset += lines[i].length + 1;
    return offset + Math.min(column, lines[index].length);
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
    placeMarker();
  });

  // 리본의 [시각 설계에서 보기]는 열고 들어온 그 node_id로 되돌아간다.
  ribbonBack.addEventListener('click', () => {
    if (opts.onBackToNode && linkedNodeId != null) opts.onBackToNode(linkedNodeId);
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

    // 보드 13 · 오류 노드에서 코드로. 캔버스가 spanIsValid()로 map을 검증한 뒤에만 부른다 —
    // 여기서는 다시 검증하지 않고, 준 범위를 그대로 연다.
    openSpan(span, meta_) {
      const info = normalizeSpan(span);
      if (!info) return false;
      const m = meta_ || {};
      const preview = m.kind === 'preview';
      const node = m.node || {};

      range = { first: info.startLine, last: info.endLine };
      markerLine = info.message ? info.startLine : null;
      marker.textContent = info.message ? `! ${info.startLine}  ${info.message}` : '';

      // 열은 있으면 그 열까지, 없으면 줄 전체를 잡는다.
      const from = offsetOf(info.startLine, info.startColumn == null ? 0 : info.startColumn);
      const to = offsetOf(info.endLine, info.endColumn == null ? Infinity : info.endColumn);
      if (typeof textarea.setSelectionRange === 'function') {
        textarea.setSelectionRange(from, Math.max(from, to));
      } else if ('selectionStart' in textarea) {
        textarea.selectionStart = from;
        textarea.selectionEnd = Math.max(from, to);
      }

      // 켠 줄이 화면 맨 위에 딱 붙으면 앞뒤 맥락이 안 보인다 — 두 줄 위부터 보인다.
      const top = Math.max(0, (info.startLine - 3) * LINE_HEIGHT);
      textarea.scrollTop = top;
      pre.scrollTop = top;
      gutter.scrollTop = top;
      paint();
      if (typeof textarea.focus === 'function') textarea.focus();

      linkedNodeId = node.id == null ? null : node.id;
      ribbonLabel.textContent = `연결된 노드 · ${node.label || node.id || '알 수 없는 노드'}`;
      ribbonLoc.textContent = `${m.file || metaName || 'strategy.py'}:${info.startLine}`;
      ribbonCode.textContent = m.code ? String(m.code) : '';
      ribbonCode.hidden = !m.code;
      ribbonKind.textContent = preview ? '미실행 미리보기' : '연결됨';
      ribbonKind.className = `backtest-code-ribbon-kind${preview ? ' is-preview' : ''}`;
      ribbonBack.hidden = !opts.onBackToNode || linkedNodeId == null;
      ribbon.hidden = false;
      notice.hidden = true;
      return true;
    },

    // 미실행 preview 코드는 읽기 전용이다 — 실행·저장 대상으로 고를 수 없어야 한다.
    setPreviewOnly(on, info) {
      previewOnly = !!on;
      textarea.readOnly = previewOnly ? true : !!opts.readOnly;
      const reason = info && info.reason_ko ? String(info.reason_ko) : '';
      banner.textContent = previewOnly
        ? (reason ? `${PREVIEW_BANNER_TEXT} · ${reason}` : PREVIEW_BANNER_TEXT)
        : '';
      banner.hidden = !previewOnly;
      wrap.className = `backtest-code-editor${previewOnly ? ' is-preview-only' : ''}`;
    },
    isPreviewOnly() { return previewOnly; },

    // map이 낡아 줄을 못 여는 순간의 한 줄 알림. 잠깐 떴다 사라진다.
    showNotice(text) {
      notice.textContent = String(text == null ? '' : text);
      notice.hidden = !notice.textContent;
      if (noticeTimer) clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => {
        notice.textContent = '';
        notice.hidden = true;
        noticeTimer = null;
      }, NOTICE_MS);
      if (noticeTimer && typeof noticeTimer.unref === 'function') noticeTimer.unref();
    },

    // 보드 13의 "전략 파일 · 그래프에서 생성됨 · 연결된 구성 · 그래프 호환 모드".
    setFileMeta(info) {
      while (meta.firstChild) meta.removeChild(meta.firstChild);
      if (!info) { meta.hidden = true; metaName = ''; return; }
      metaName = info.name ? String(info.name) : '';
      meta.appendChild(el('span', 'backtest-code-filemeta-title', '전략 파일'));
      if (metaName) meta.appendChild(el('span', 'backtest-code-filemeta-name', metaName));
      if (info.generatedFromGraph) {
        meta.appendChild(el('span', 'backtest-code-filemeta-origin', '그래프에서 생성됨'));
      }
      const linked = info.linked || {};
      const parts = [
        ['데이터', linked.data],
        ['지표', linked.indicators],
        ['진입·청산', linked.entryExit],
      ].filter((pair) => pair[1]);
      if (parts.length) {
        meta.appendChild(el('span', 'backtest-code-filemeta-linked', '연결된 구성'));
        parts.forEach((pair) => {
          meta.appendChild(el('span', 'backtest-code-filemeta-chip', `${pair[0]} · ${pair[1]}`));
        });
      }
      if (info.compatMode) {
        meta.appendChild(el('span', 'backtest-code-filemeta-compat', '그래프 호환 모드'));
      }
      meta.hidden = false;
    },

    // 맨 아래 한 줄 — 지금 노드와 코드가 이어져 있는지, 아니면 무엇을 되묻게 되는지.
    setLinkStatus(info) {
      if (!info) { status.textContent = ''; status.hidden = true; return; }
      const linked = !!info.linked;
      const text = info.text_ko ? String(info.text_ko) : (linked ? LINK_TEXT : UNLINK_TEXT);
      status.textContent = linked ? `● 노드·코드 연결됨 · ${text}` : text;
      status.className = `backtest-code-linkstatus${linked ? ' is-linked' : ''}`;
      status.hidden = false;
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
  hashSource,
  spanIsValid,
  PREVIEW_BANNER_TEXT,
  STALE_NOTICE_TEXT,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BacktestCodeEditor = __exports;
}

})();
