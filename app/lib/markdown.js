// IIFE 스코프 격리(2026-08-18 렌더러 격리) — <script> 태그는 top-level const/function을
// 문서 전체가 공유하는 하나의 스크립트 스코프에 넣는다(require()의 모듈별 격리와 다르다).
// el/sanitize 같은 흔한 이름이 파일 간에 충돌해 SyntaxError가 났다(실측, diag-isolation.js).
// CJS(require)는 이 IIFE 밖에서도 동일하게 동작한다 — Node의 모듈 래퍼가 이미 함수 스코프다.
(function () {
// 최소 마크다운 → DOM 렌더러.
// 이유: 리더 캔버스에도 렌더링 계약(텍스트 노드 원칙)을 지킨다 — 문자열을
// innerHTML로 파싱시키지 않고, 직접 DOM 노드를 만들어 붙인다. 라이브러리도
// 안 쓴다(app/CLAUDE 지시: 번들러/외부 패키지 금지, 순수 JS).
//
// 지원: #~#### 헤더, | ... | 표(구분선 --- 스킵, 셀 수가 행마다 달라도 안 죽음),
// -/1. 목록(들여쓰기 중첩 + 원문 번호 보존), ``` 코드 블록, **굵게**, `인라인 코드`,
// 나머지는 문단. DART 마크다운 실측 데이터(app/data/reader-mock.md)가 셀이 중간에
// 비거나 표가 비정형인 경우가 많아 관대하게 파싱한다.
//
// 이 파일이 앱의 유일한 마크다운 렌더러다(2026-08-31 통합) — 채팅 답변과 리더
// 캔버스가 같은 모듈을 쓴다. 표면별 마크다운 렌더러를 따로 만들지 않는다:
// 채팅 쪽에 lib/chat-markdown.js를 별도로 만들었다가 canvas.css의 전역 .md-p
// 규칙과 클래스가 충돌해 의도치 않은 음영이 새어 들어왔다(실측). 렌더 규칙이
// 갈리면 반드시 여기서 갈래를 낸다.

// **굵게**와 `코드`만 인라인으로 처리한다. 나머지는 텍스트 노드 그대로.
function appendInline(parent, text) {
  const pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parent.appendChild(document.createTextNode(text.slice(last, match.index)));
    const token = match[0];
    if (token.startsWith('**')) {
      const strong = document.createElement('strong');
      strong.className = 'md-strong';
      strong.textContent = token.slice(2, -2);
      parent.appendChild(strong);
    } else {
      const code = document.createElement('code');
      code.className = 'md-code';
      code.textContent = token.slice(1, -1);
      parent.appendChild(code);
    }
    last = match.index + token.length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

function isTableRow(line) {
  return line.trim().startsWith('|');
}

function isSeparatorRow(line) {
  return /^\|?[\s:-]+\|?[\s|:-]*$/.test(line.trim()) && line.includes('-');
}

function splitCells(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

function renderMarkdownInto(container, mdText) {
  const lines = String(mdText == null ? '' : mdText).split(/\r?\n/);
  let i = 0;
  // 목록 연속성 상태 — 번호 항목 사이에 하위 불릿이 끼어도 상위 목록을 끊지
  // 않기 위해 블록 루프 밖에서 든다(끊으면 번호가 매번 1로 리셋, 실측 결함).
  let list = null;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      list = null;
      i++;
      continue;
    }

    // ``` 코드 블록 — 닫힘이 없으면(스트리밍 중) 지금까지 온 만큼 보여준다.
    if (/^```/.test(line)) {
      list = null;
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // 닫는 ``` 소비
      const pre = document.createElement('pre');
      pre.className = 'md-pre';
      pre.textContent = codeLines.join('\n');
      container.appendChild(pre);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      list = null;
      const level = heading[1].length;
      // 기존 계약 유지: #→h2.md-h1, ##→h3.md-h2 (+ 공통 md-h)
      const h = document.createElement(level === 1 ? 'h2' : level === 2 ? 'h3' : 'h4');
      h.className = `md-h md-h${level}`;
      appendInline(h, heading[2].trim());
      container.appendChild(h);
      i++;
      continue;
    }

    if (isTableRow(line)) {
      list = null;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        if (!isSeparatorRow(lines[i])) rows.push(splitCells(lines[i]));
        i++;
      }
      if (rows.length) {
        const table = document.createElement('table');
        table.className = 'md-table';
        const tbody = document.createElement('tbody');
        for (const cells of rows) {
          const tr = document.createElement('tr');
          for (const cell of cells) {
            const td = document.createElement('td');
            td.textContent = cell; // 텍스트 노드 — innerHTML 금지
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        container.appendChild(table);
      }
      continue;
    }

    const bullet = line.match(/^(\s*)[-*•]\s+(.*)$/);
    const ordered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (bullet || ordered) {
      const indent = (bullet ? bullet[1] : ordered[1]).length;
      const body = bullet ? bullet[2] : ordered[3];
      const wantTag = bullet ? 'UL' : 'OL';

      // 들여쓴 항목은 직전 목록 항목의 하위 목록으로 중첩한다 — 평탄하게 이어
      // 붙이면 상위 번호 목록이 끊겨 번호가 리셋된다(2026-08-31 실측).
      if (indent >= 2 && list && list.lastChild) {
        const parentLi = list.lastChild;
        let sub = parentLi.__mdSublist;
        if (!sub || sub.tagName !== wantTag) {
          sub = document.createElement(bullet ? 'ul' : 'ol');
          sub.className = (bullet ? 'md-list md-ul' : 'md-list md-ol') + ' md-sub';
          parentLi.appendChild(sub);
          parentLi.__mdSublist = sub;
        }
        const li = document.createElement('li');
        if (ordered) li.value = Number(ordered[2]);
        appendInline(li, body);
        sub.appendChild(li);
        i++;
        continue;
      }

      if (!list || list.tagName !== wantTag) {
        list = document.createElement(bullet ? 'ul' : 'ol');
        // md-list는 기존 리더 캔버스 CSS 계약, md-ul/md-ol은 채팅 CSS 계약.
        list.className = bullet ? 'md-list md-ul' : 'md-list md-ol';
        container.appendChild(list);
      }
      const li = document.createElement('li');
      // 원문 번호 보존 — 목록이 다른 블록으로 끊겨도 1부터 다시 세지 않는다.
      if (ordered) li.value = Number(ordered[2]);
      appendInline(li, body);
      list.appendChild(li);
      i++;
      continue;
    }

    // 문단 — 다음 빈 줄/헤더/표/목록/코드 전까지 이어붙인다
    list = null;
    const paraLines = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !/^```/.test(lines[i]) &&
      !isTableRow(lines[i]) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    const p = document.createElement('p');
    p.className = 'md-p';
    appendInline(p, paraLines.join(' ').trim());
    container.appendChild(p);
  }
}

// 컨테이너를 비우고 다시 그린다 — 채팅 스트리밍처럼 같은 노드에 반복 렌더하는
// 표면용 편의 계약.
function render(container, mdText) {
  while (container.firstChild) container.removeChild(container.firstChild);
  renderMarkdownInto(container, mdText);
}

// UMD 각주(2026-08-18 렌더러 격리) — sanitize.js와 같은 패턴.
const __exports = { renderMarkdownInto, render, appendInline };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.Markdown = __exports;
}

})();
