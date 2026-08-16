// 캔버스 창 렌더러. spike/electron-glass/canvas.html의 확장/수축 rAF 애니메이션을
// 그대로 이식 + 목업 데이터 3종 렌더.
const { ipcRenderer } = require('electron');
const { sanitize } = require('./lib/sanitize');
const { renderMarkdownInto } = require('./lib/markdown');
const { loadStreamItems, loadFinancialStatement, loadReaderMarkdown } = require('./lib/mockdata');
const { renderAccounts, renderMcp } = require('./lib/settings-cards');

const mosaic = document.getElementById('mosaic');
const sheen = document.getElementById('sheen');
const grid = document.getElementById('grid');

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInCubic(t) { return t * t * t; }

// ---------- 점 → 캔버스 확장/수축 (spike v2.js 이식, setBounds 애니메이션 없음) ----------
function runAnimation({ cx, cy, rmax, duration, mode }) {
  return new Promise((resolve) => {
    const timestamps = [];
    const t0 = performance.now();
    function frame(now) {
      timestamps.push(now);
      const elapsed = now - t0;
      const t = Math.min(1, elapsed / duration);
      const et = mode === 'expand' ? easeOutCubic(t) : (1 - easeInCubic(1 - t));
      const r = mode === 'expand' ? rmax * et : rmax * (1 - et);
      // 굴절 변조: 등장 시 30px(짙은 안개)→0px(맑음), 소멸 시 반대.
      // 스파이크(canvas.html)는 등장 끝값을 6px로 남겨뒀는데, 이 상태로 캡처해보니
      // 실제 재무 데이터·텍스트가 영구적으로 흐려져 읽히지 않았다(soul.md §8
      // "정보 정직성" 위반 — 실측으로 발견, W2 구현 중 정정). 정지 상태는 0이어야 한다.
      const blur = mode === 'expand' ? (30 * (1 - et)) : (30 * et);
      mosaic.style.clipPath = `circle(${r}px at ${cx}px ${cy}px)`;
      sheen.style.backdropFilter = `blur(${blur}px)`;
      sheen.style.webkitBackdropFilter = `blur(${blur}px)`;
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        if (mode === 'expand') {
          // 안전망 — 부동소수 오차로 완전히 0에 못 미치는 경우를 명시적으로 정리한다.
          sheen.style.backdropFilter = 'blur(0px)';
          sheen.style.webkitBackdropFilter = 'blur(0px)';
        }
        resolve(timestamps);
      }
    }
    requestAnimationFrame(frame);
  });
}

ipcRenderer.on('prime-clip', (e, payload) => {
  mosaic.style.clipPath = `circle(0px at ${payload.cx}px ${payload.cy}px)`;
  sheen.style.backdropFilter = 'blur(30px)';
  ipcRenderer.send('primed');
});

ipcRenderer.on('run-animation', async (e, payload) => {
  if (payload.mode === 'expand') {
    mosaic.style.clipPath = `circle(0px at ${payload.cx}px ${payload.cy}px)`;
    sheen.style.backdropFilter = 'blur(30px)';
  }
  const timestamps = await runAnimation(payload);
  ipcRenderer.send('animation-done', { mode: payload.mode, timestamps });
});

// ---------- 캔버스 카드 추가/초기화/하이라이트 ----------
ipcRenderer.on('athena:add-canvas', (e, { type }) => {
  addCard(type);
});

ipcRenderer.on('athena:clear-canvases', () => {
  grid.innerHTML = '';
});

ipcRenderer.on('athena:highlight-canvas', (e, type) => {
  const el = grid.querySelector(`.card.${type}`);
  if (!el) return;
  el.classList.add('highlight');
  el.scrollIntoView({ block: 'nearest' });
  setTimeout(() => el.classList.remove('highlight'), 1200);
});

function freshLabel() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss} 기준`;
}

// ---------- 카드별 닫기 (D7) ----------
// 지금까지 전역 Esc(athena:collapse-canvas → 캔버스 전체 접기)만 있었다 —
// 설계가 여는 법만 정하고 카드 하나만 닫는 법은 안 정했다. accounts/mcp
// 카드(lib/settings-cards.js)에 같은 어포던스를 다는 김에 여기 3개 카드
// (stream/reader/table)도 일관되게 맞춘다 — 5개 카드 중 2개만 닫히면
// 사용자 입장에서 더 헷갈린다는 판단(기존 동작 확장, 보고서에 별도로 남김).
// 마지막 카드를 닫으면 빈 유리창을 남기지 않고 캔버스 자체를 접는다 — Esc가
// 쓰는 채널을 그대로 재사용한다.
function closeCard(card) {
  const parent = card.parentElement;
  card.remove();
  if (parent && !parent.querySelector('.card')) {
    ipcRenderer.send('athena:collapse-canvas');
  }
}

function cardCloseButton(card) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'uk-card-close';
  b.setAttribute('aria-label', '카드 닫기');
  b.title = '이 카드 닫기';
  b.textContent = '×';
  b.addEventListener('click', () => closeCard(card));
  return b;
}

function makeCard(type, title) {
  const existing = grid.querySelector(`.card.${type}`);
  if (existing) existing.remove(); // 재요청 시 새로 갱신
  const card = document.createElement('div');
  card.className = `card ${type}`;
  const head = document.createElement('div');
  head.className = 'card-head';
  const h = document.createElement('div');
  h.className = 'card-title';
  h.textContent = title;
  const fresh = document.createElement('div');
  fresh.className = 'card-fresh';
  fresh.textContent = freshLabel();
  const rightGroup = document.createElement('div');
  rightGroup.className = 'card-head-right';
  rightGroup.appendChild(fresh);
  rightGroup.appendChild(cardCloseButton(card));
  head.appendChild(h);
  head.appendChild(rightGroup);
  const body = document.createElement('div');
  body.className = 'card-body';
  card.appendChild(head);
  card.appendChild(body);
  grid.appendChild(card);
  return { card, body };
}

function addCard(type) {
  if (type === 'stream') return renderStream();
  if (type === 'reader') return renderReader();
  if (type === 'table') return renderTable();
  // 계좌(AT-ST-001)·MCP(AT-ST-004) 제어 캔버스 카드 — 등록·활성화·승인·probe
  // 시트는 새 카드/새 창이 아니라 이 카드들 내부의 오버레이다
  // (plan/paper-specs/00-통합-계획.md §1.2/1.3, lib/settings-cards.js).
  if (type === 'accounts') return renderAccounts(grid);
  if (type === 'mcp') return renderMcp(grid);
}

// ① 스트림 — sanitize한 문자열은 절대 innerHTML로 넣지 않는다. textContent로만.
function renderStream() {
  const { body } = makeCard('stream', '스트림 · 뉴스');
  const items = loadStreamItems();
  const ul = document.createElement('ul');
  ul.className = 'stream-list';
  const SHOW = 14;
  for (const item of items.slice(0, SHOW)) {
    const li = document.createElement('li');
    li.className = 'stream-item';

    const time = document.createElement('span');
    time.className = 'stream-time';
    time.textContent = formatPubDate(item.pubDate);

    const source = document.createElement('span');
    source.className = 'stream-source';
    const url = item.originallink || item.link;
    source.textContent = domainOf(url);

    const title = document.createElement('span');
    title.className = 'stream-title';
    title.textContent = sanitize(item.title); // 텍스트 노드

    li.appendChild(time);
    li.appendChild(source);
    li.appendChild(title);
    ul.appendChild(li);
  }
  body.appendChild(ul);
  if (items.length > SHOW) {
    const more = document.createElement('div');
    more.className = 'stream-more';
    more.textContent = `+ ${items.length - SHOW}건 더`;
    body.appendChild(more);
  }
}

function domainOf(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function formatPubDate(pubDate) {
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return pubDate;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}.${dd} ${hh}:${mi}`;
}

// ② 리더 — 마크다운을 직접 DOM으로 렌더(innerHTML 미사용, lib/markdown.js)
function renderReader() {
  const { body } = makeCard('reader', '리더 · 공시 원문');
  const md = loadReaderMarkdown();
  const note = document.createElement('div');
  note.className = 'fin-meta';
  note.textContent = '원문 일부(캡처 당시 미리보기 필드 한도로 절단됨) — DART 자기주식 처분 결정 공시';
  body.appendChild(note);
  renderMarkdownInto(body, md);
}

// ④ 공통 테이블 — 재무제표(재무상태표) 스냅샷
function renderTable() {
  const { body } = makeCard('table', '공통 테이블 · 재무제표(연결)');
  const { meta, list } = loadFinancialStatement();
  const rows = list.filter((r) => r.sj_nm === '재무상태표');

  const note = document.createElement('div');
  note.className = 'fin-meta';
  note.textContent = `corp_code ${meta.corp_code} · ${meta.fs_div} · ${meta.bsns_year} 사업연도 · ${rows.length}개 계정`;
  body.appendChild(note);

  const table = document.createElement('table');
  table.className = 'fin-table';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  const headers = ['계정과목', rows[0]?.thstrm_nm || '당기', rows[0]?.frmtrm_nm || '전기', rows[0]?.bfefrmtrm_nm || '전전기'];
  for (const h of headers) {
    const th = document.createElement('th');
    th.textContent = h;
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    const cells = [r.account_nm, fmtWon(r.thstrm_amount), fmtWon(r.frmtrm_amount), fmtWon(r.bfefrmtrm_amount)];
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  body.appendChild(table);
}

function fmtWon(raw) {
  if (!raw) return '—';
  const n = Number(raw);
  if (Number.isNaN(n)) return raw;
  return n.toLocaleString('ko-KR');
}
