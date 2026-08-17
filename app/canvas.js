// 캔버스 창 렌더러. spike/electron-glass/canvas.html의 확장/수축 rAF 애니메이션을
// 그대로 이식 + 목업 데이터 3종 렌더.
const { ipcRenderer, webFrame } = require('electron');
const { sanitize } = require('./lib/sanitize');
const { renderMarkdownInto } = require('./lib/markdown');
const { loadStreamItems, loadFinancialStatement, loadReaderMarkdown } = require('./lib/mockdata');
const { errorNote } = require('./lib/ui-kit');

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

// main.js가 주는 cx/cy/rmax는 물리 px(스크린 좌표 기반) — clipPath는 CSS px로
// 그리므로 줌 배율만큼 되돌린다(줌 미사용 시 zf=1로 기존과 동일).
function toCssCoords(payload) {
  const zf = webFrame.getZoomFactor();
  const scaled = { ...payload, cx: payload.cx / zf, cy: payload.cy / zf };
  if (typeof payload.rmax === 'number') scaled.rmax = payload.rmax / zf;
  return scaled;
}

ipcRenderer.on('prime-clip', (e, payload) => {
  const p = toCssCoords(payload);
  mosaic.style.clipPath = `circle(0px at ${p.cx}px ${p.cy}px)`;
  sheen.style.backdropFilter = 'blur(30px)';
  ipcRenderer.send('primed');
});

ipcRenderer.on('run-animation', async (e, payload) => {
  const p = toCssCoords(payload);
  if (p.mode === 'expand') {
    mosaic.style.clipPath = `circle(0px at ${p.cx}px ${p.cy}px)`;
    sheen.style.backdropFilter = 'blur(30px)';
  }
  const timestamps = await runAnimation(p);
  ipcRenderer.send('animation-done', { mode: p.mode, timestamps });
});

// ---------- 캔버스 카드 추가/초기화/하이라이트 ----------
ipcRenderer.on('athena:add-canvas', (e, { type }) => {
  addCard(type);
});

ipcRenderer.on('athena:clear-canvases', () => {
  grid.innerHTML = '';
});

// ---------- 실배선 — stream-json-parser.classifyCanvasBlock()의 결과를 렌더 ----------
// main.js가 athena__render_canvas(source:'live')로 claude -p를 실왕복한 뒤 매
// render_canvas tool_result마다 이걸 보낸다. status는 success/fallback(둘 다
// canvas_type을 읽어 렌더한다) · rejected/error/unparseable(카드 대신 안내만).
ipcRenderer.on('athena:add-canvas-live', (e, result) => {
  addLiveCard(result);
});

function addLiveCard(result) {
  if (!result) return renderLiveNotice('빈 응답을 받았다.');
  if (result.status === 'rejected') {
    return renderLiveNotice('캔버스 호출이 거부됐다 — --allowedTools 권한이 없다.');
  }
  if (result.status === 'error') {
    return renderLiveNotice('캔버스 호출이 게이트웨이/upstream 에러로 실패했다.');
  }
  if (result.status === 'unparseable') {
    return renderLiveNotice(`캔버스 응답을 해석하지 못했다 — ${result.reason || '원인 미상'}.`);
  }
  const envelope = result.envelope;
  if (!envelope) return renderLiveNotice('캔버스 응답에 데이터가 없다.');
  // ★ canvas_type은 응답값이다 — 요청값이 아니다(S4 RESULT.md §5). success/fallback
  // 둘 다 이 필드로 어떤 카드를 그릴지 정한다. 알려진 4종(table/stream/reader) 중
  // 하나가 아니면(대개 free로 폴백) 자유 카드로 떨어뜨린다 — 폴백은 예외가 아니라
  // 흔한 경로다. `!envelope.fell_back`은 방어적 중복이다 — canvas.py의
  // validate_canvas_payload()는 폴백 시 canvas_type 자체를 'free'로 바꿔 보내므로
  // (backend/athena_mcp/canvas.py L152-157) 이론상 fell_back=true인데 canvas_type이
  // 'stream'/'reader'/'table'로 남는 조합은 안 나오지만, 계약이 바뀌어도 조용히
  // 깨진 카드를 그리지 않도록 남겨둔다.
  if (envelope.canvas_type === 'table' && !envelope.fell_back) return renderMcpTable(envelope);
  if (envelope.canvas_type === 'stream' && !envelope.fell_back) return renderLiveStream(envelope);
  if (envelope.canvas_type === 'reader' && !envelope.fell_back) return renderLiveReader(envelope);
  return renderFreeCanvas(envelope);
}

// 카드를 못 그릴 상황(거부/에러/해석불가)을 조용히 삼키지 않는다 — 모자이크에
// 안내 카드를 하나 띄운다. 'free'가 아니라 별도 타입('notice')을 쓴다 — 같은
// 세션에서 정상 free 카드가 이미 떠 있는데 이후 호출이 실패하면, makeCard가
// 같은 타입 카드를 갈아치우는 규칙(재요청 시 새로 갱신) 때문에 실제 데이터
// 카드가 에러 배너로 덮일 수 있어서다. ui-kit.errorNote는 role="alert"다.
function renderLiveNotice(message) {
  const { body } = makeCard('notice', '캔버스 알림');
  body.appendChild(errorNote(message));
}

// ---------- 공통 테이블(신규④) — MCP render_canvas의 실제 table 응답 ----------
// 목업 table 카드(renderTable, 아래)와는 다른 데이터 형상이다 — 이건 키움
// 재무제표 고정 스키마가 아니라 스키마 불특정 {columns:[{key,label}], rows:[{key:value}]}다.
// GLOSSARY.md §2 신규④ "공통 테이블 — 스키마 불특정 레코드. '부모'이자 기본값".
function renderMcpTable(envelope) {
  const { body } = makeCard('mcp-table', envelope.caption || '공통 테이블');
  const cols = (envelope.data && Array.isArray(envelope.data.columns)) ? envelope.data.columns : [];
  const rows = (envelope.data && Array.isArray(envelope.data.rows)) ? envelope.data.rows : [];

  if (!cols.length || !rows.length) {
    body.appendChild(errorNote('빈 테이블 — columns 또는 rows가 없다.'));
    return;
  }

  const table = document.createElement('table');
  table.className = 'fin-table';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const col of cols) {
    const th = document.createElement('th');
    th.textContent = col && col.label != null ? col.label : (col && col.key) || '';
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    for (const col of cols) {
      const td = document.createElement('td');
      const v = r ? r[col.key] : undefined;
      td.textContent = v == null ? '—' : String(v);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  body.appendChild(table);
}

// ---------- 실배선 스트림(신규①) — MCP render_canvas의 실제 stream 응답 ----------
// 목업 스트림(아래 addCard → renderStream)은 네이버 뉴스 API 원형
// {title, pubDate, originallink, link}을 읽는다 — 이건 다른 데이터 형상이다.
// 실배선은 canvas.py STREAM_SCHEMA를 그대로 따른다(backend/athena_mcp/canvas.py
// L34-55 실측): data.records:[{ts, ts_precision:"second"|"day", source, title,
// url, summary?, tickers?[], kind?}]. title은 null 허용(스키마 "type":
// ["string","null"]) — sanitize(null)도 null을 그대로 돌려주므로(lib/sanitize.js)
// textContent 대입 전에 폴백 문구를 둔다. sanitize한 문자열은 textContent로만
// 넣는다 — innerHTML 금지(CLAUDE.md §6).
function renderLiveStream(envelope) {
  const { body } = makeCard('stream', envelope.caption || '스트림 · 뉴스');
  const records = (envelope.data && Array.isArray(envelope.data.records)) ? envelope.data.records : [];
  if (!records.length) {
    body.appendChild(errorNote('빈 스트림 — records가 없다.'));
    return;
  }
  const ul = document.createElement('ul');
  ul.className = 'stream-list';
  const SHOW = 14;
  for (const rec of records.slice(0, SHOW)) {
    const li = document.createElement('li');
    li.className = 'stream-item';

    const time = document.createElement('span');
    time.className = 'stream-time';
    time.textContent = formatRecordTs(rec && rec.ts, rec && rec.ts_precision);

    const source = document.createElement('span');
    source.className = 'stream-source';
    source.textContent = (rec && rec.source) || domainOf(rec && rec.url);

    const title = document.createElement('span');
    title.className = 'stream-title';
    title.textContent = sanitize(rec && rec.title) || '(제목 없음)'; // 텍스트 노드만

    li.appendChild(time);
    li.appendChild(source);
    li.appendChild(title);
    ul.appendChild(li);
  }
  body.appendChild(ul);
  if (records.length > SHOW) {
    const more = document.createElement('div');
    more.className = 'stream-more';
    more.textContent = `+ ${records.length - SHOW}건 더`;
    body.appendChild(more);
  }
}

// `ts`가 second/day 어느 정밀도든 한 형식으로 렌더한다 — day 정밀도에서 없는
// 시:분을 지어내지 않는다(정보 정직성, soul.md §8).
function formatRecordTs(ts, precision) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  if (precision === 'day') return `${mm}.${dd}`;
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}.${dd} ${hh}:${mi}`;
}

// ---------- 실배선 리더(신규②) — MCP render_canvas의 실제 reader 응답 ----------
// canvas.py READER_SCHEMA 실측(L57-68): data는 {title, body_markdown,
// format?:"markdown"|"raw"(기본 markdown), highlights?[], error_state?:
// null|"not_found"|"processing_delayed"}. error_state가 있으면 문서가 아예
// 없거나(당일 접수 공시 등) 처리 지연 중이라는 뜻이라 본문 대신 안내만 낸다 —
// 조용히 빈 카드를 그리지 않는다. format:"raw"는 마크다운 문법으로 해석하지
// 않고 문단 하나로 그대로 낸다.
function renderLiveReader(envelope) {
  const data = (envelope.data && typeof envelope.data === 'object') ? envelope.data : {};
  const { body } = makeCard('reader', data.title || envelope.caption || '리더 · 공시 원문');
  if (data.error_state === 'not_found') {
    body.appendChild(errorNote('문서를 찾을 수 없다 — not_found.'));
    return;
  }
  if (data.error_state === 'processing_delayed') {
    body.appendChild(errorNote('문서 처리가 지연되고 있다 — processing_delayed.'));
    return;
  }
  if (!data.body_markdown) {
    body.appendChild(errorNote('빈 리더 — body_markdown이 없다.'));
    return;
  }
  if (Array.isArray(data.highlights) && data.highlights.length) {
    const note = document.createElement('div');
    note.className = 'fin-meta';
    note.textContent = `하이라이트: ${data.highlights.join(' · ')}`;
    body.appendChild(note);
  }
  if (data.format === 'raw') {
    const p = document.createElement('p');
    p.className = 'md-p';
    p.textContent = data.body_markdown; // 텍스트 노드 — innerHTML 금지
    body.appendChild(p);
  } else {
    renderMarkdownInto(body, data.body_markdown);
  }
}

// ---------- 자유 카드(신규, W4 최소 구현) ----------
// GLOSSARY.md §2: "기성 12종으로 표현 못 하는 데이터가 오면 AI가 그 자리에서
// 그리는 설계된 탈출구." 전체 자유 카드 설계(W4)는 미착수 상태로 남아 있다 —
// 이건 그 자리를 비워두지 않기 위한 최소 구현이다: 스키마를 가정하지 않고
// envelope.data를 재귀적으로 key/value 트리로 펼친다. innerHTML 미사용
// (CLAUDE.md §6) — DOM 노드만 만든다.
function renderFreeCanvas(envelope) {
  const { body } = makeCard('free', envelope.caption || '자유 카드');
  if (envelope.fell_back) {
    const note = document.createElement('div');
    note.className = 'fin-meta';
    note.textContent = `table 카드로 못 그려 자유 카드로 폴백함 — ${envelope.fallback_reason || '사유 미상'}`;
    body.appendChild(note);
  }
  body.appendChild(renderJsonTree(envelope.data));
}

function renderJsonTree(value) {
  if (Array.isArray(value)) {
    const ul = document.createElement('ul');
    ul.className = 'free-tree-list';
    for (const item of value) {
      const li = document.createElement('li');
      li.appendChild(renderJsonTree(item));
      ul.appendChild(li);
    }
    return ul;
  }
  if (value !== null && typeof value === 'object') {
    const dl = document.createElement('dl');
    dl.className = 'free-tree-dl';
    for (const [k, v] of Object.entries(value)) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.appendChild(renderJsonTree(v));
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    return dl;
  }
  const span = document.createElement('span');
  span.className = 'free-tree-scalar';
  span.textContent = value === null || value === undefined ? '—' : String(value);
  return span;
}

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
  // 계좌·MCP 카드는 여기 없다. 2026-08-16에 대화 창의 설정 모드로 옮겼다 —
  // 설정은 데이터 출력이 아니라 "앱 자신"이고, 설정을 만지는 동안 사용자는
  // 채팅을 치지 않는다(ui/DESIGN-SOUL.md:100). 렌더는 chat.js `openSettings`.
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

// ---------- 창 기본 기능 (2026-08-17) — 대화 창(chat.js)과 같은 배선 ----------
// 줌·최소화는 main.js가 두 창을 동기하므로 어느 창에 포커스가 있어도 동작이 같다.
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.key === '=' || e.key === '+') {
    e.preventDefault();
    ipcRenderer.send('athena:zoom', { dir: 'in' });
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    ipcRenderer.send('athena:zoom', { dir: 'out' });
  } else if (e.key === '0') {
    e.preventDefault();
    ipcRenderer.send('athena:zoom', { dir: 'reset' });
  } else if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    ipcRenderer.send('athena:minimize-windows');
  }
});

window.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  ipcRenderer.send('athena:zoom', { dir: e.deltaY < 0 ? 'in' : 'out' });
}, { passive: false });

// 창 이동 — 카드가 없는 빈 유리 표면(grid 여백)을 잡고 끈다. e.target 조건으로
// 카드 내부 스크롤·선택과 충돌하지 않는다.
function bindWindowDrag(el) {
  if (!el) return;
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target !== el) return;
    ipcRenderer.send('athena:window-drag', { phase: 'start' });
    const end = () => {
      ipcRenderer.send('athena:window-drag', { phase: 'end' });
      window.removeEventListener('mouseup', end);
      window.removeEventListener('blur', end);
    };
    window.addEventListener('mouseup', end);
    window.addEventListener('blur', end);
  });
}
bindWindowDrag(grid);
bindWindowDrag(mosaic);
