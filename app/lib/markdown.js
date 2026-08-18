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
// 지원: #/## 헤더, | ... | 표(구분선 --- 스킵, 셀 수가 행마다 달라도 안 죽음),
// - 불릿, 나머지는 문단. DART 마크다운 실측 데이터(app/data/reader-mock.md)가
// 셀이 중간에 비거나 표가 비정형인 경우가 많아 관대하게 파싱한다.

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
  const lines = mdText.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    if (line.startsWith('## ')) {
      const h = document.createElement('h3');
      h.className = 'md-h2';
      h.textContent = line.slice(3).trim();
      container.appendChild(h);
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      const h = document.createElement('h2');
      h.className = 'md-h1';
      h.textContent = line.slice(2).trim();
      container.appendChild(h);
      i++;
      continue;
    }

    if (isTableRow(line)) {
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

    if (line.trim().startsWith('- ')) {
      const ul = document.createElement('ul');
      ul.className = 'md-list';
      while (i < lines.length && lines[i].trim().startsWith('- ')) {
        const li = document.createElement('li');
        li.textContent = lines[i].trim().slice(2);
        ul.appendChild(li);
        i++;
      }
      container.appendChild(ul);
      continue;
    }

    // 문단 — 다음 빈 줄/헤더/표/불릿 전까지 이어붙인다
    const paraLines = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !isTableRow(lines[i]) &&
      !lines[i].trim().startsWith('- ')
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    const p = document.createElement('p');
    p.className = 'md-p';
    p.textContent = paraLines.join(' ').trim();
    container.appendChild(p);
  }
}

// UMD 각주(2026-08-18 렌더러 격리) — sanitize.js와 같은 패턴.
const __exports = { renderMarkdownInto };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.Markdown = __exports;
}

})();
