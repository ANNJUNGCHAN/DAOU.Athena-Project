// 캔버스 창 렌더러. spike/electron-glass/canvas.html의 확장/수축 rAF 애니메이션을
// 그대로 이식 + 목업 데이터 3종 렌더. nodeIntegration:false / contextIsolation:true
// (2026-08-18 렌더러 격리) — preload.js의 window.athena 다리로만 main과 통신한다.
// lib/*.js는 canvas.html이 <script> 태그로 미리 로드해 window.AthenaLib에 얹어둔
// 전역이다. 목업 데이터(spike/captures/*.json)는 fs를 직접 못 읽어 main으로
// 옮겼다 — athena:load-fixture invoke로 파싱된 데이터만 받는다.
const { sanitize } = window.AthenaLib.Sanitize;
const { renderMarkdownInto } = window.AthenaLib.Markdown;
const { errorNote, removeCardAndMaybeCollapse } = window.AthenaLib.UiKit;
const { widthGradeFor, dropTargetsFor, exceedsHeightBudget, MIN_CARDS } = window.AthenaLib.CanvasLayout;
const { foldColumns } = window.AthenaLib.ColumnFold;
const { createChartCard } = window.AthenaLib.ChartCard;
const { classifyCell, changeTone, formatNumeric, formatDatetime, groupFactsFields } = window.AthenaLib.FactsCard;

async function loadFixture(kind) {
  return window.athena.invoke('athena:load-fixture', { kind });
}

// ---------- 글자 크기 5단계 (2026-08-19, 설정 › 화면 › 글자 크기) ----------
// chat.js와 같은 문법 — tokens.css의 :root[data-font-size=...] 토큰 세트를 켠다.
// md는 기본 토큰이라 속성을 지운다. 부팅 시 1회 조회 + prefs-changed 방송 반영.
function applyFontSizePref(p) {
  const v = p && p.fontSize;
  if (v && v !== 'md') document.documentElement.dataset.fontSize = v;
  else delete document.documentElement.dataset.fontSize;
}
(async () => {
  try {
    applyFontSizePref(await window.athena.invoke('athena:settings:prefs:get'));
  } catch { /* 채널 없음 — 기본 크기 유지 */ }
})();
window.athena.on('athena:prefs-changed', (next) => applyFontSizePref(next));

// 카드별 destroy 콜백 — closeCard가 lightweight-charts 인스턴스를 누수 없이
// 정리하도록 카드 DOM 노드에 매달아둔다(WeakMap: 카드가 GC되면 콜백도 같이 사라짐).
const cardDestroyers = new WeakMap();

const mosaic = document.getElementById('mosaic');
const sheen = document.getElementById('sheen');
const grid = document.getElementById('grid');

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInCubic(t) { return t * t * t; }

// 굴절층·데이터층 분리(soul.md §7 완화책) — 애니메이션 굴절의 두 축을 따로 토글한다.
// 기본은 현행(modulate/live) — 스파이크 계측(verify-glass-separation.js)이 수치로
// 채택을 판정한다(plan.md 다음 수 7 "프로토타입 실측 먼저").
// - sheen: 'modulate'(현행 — blur 반경을 매 프레임 30→0px 변조)
//          | 'bake'(정적 프로스트 — 반경은 30px 고정, 서리층의 농도(opacity)만 변조.
//            유리 표면의 페이드가 아니라 안개층의 걷힘이라 soul.md §7 "굴절 변조로
//            등장" 규범과 양립한다는 가설 — 판정은 실측이 한다)
// - cards: 'live'(현행 — 카드 backdrop-filter 유지)
//          | 'baked'(애니메이션 동안 카드를 정적 프로스트로 굽는다, canvas.css .frost-baked)
let glassSeparation = { sheen: 'modulate', cards: 'live' };
// 휘도 감지-적응(2026-08-19) — main이 보내는 밝기 기반 유리 두께를 .mosaic에
// 반영한다. canvas.css가 var(--glass-canvas-live, var(--glass-canvas))를 읽으므로
// 이벤트가 안 오면(fixture 검증) 토큰 기본값 그대로다 — 검증16 결정론 유지.
window.athena.on('athena:backdrop-luminance', ({ canvasAlpha } = {}) => {
  if (!Number.isFinite(canvasAlpha)) return;
  document.documentElement.style.setProperty('--glass-canvas-live', canvasAlpha.toFixed(3));
});

window.athena.on('athena:glass-separation', (payload) => {
  glassSeparation = {
    sheen: payload && payload.sheen === 'bake' ? 'bake' : 'modulate',
    cards: payload && payload.cards === 'baked' ? 'baked' : 'live',
  };
});

// ---------- 점 → 캔버스 확장/수축 (spike v2.js 이식, setBounds 애니메이션 없음) ----------
function runAnimation({ cx, cy, rmax, duration, mode }) {
  return new Promise((resolve) => {
    const gs = glassSeparation; // 애니메이션 도중 토글이 바뀌어도 한 실행 안에서는 일관되게
    if (gs.cards === 'baked') mosaic.classList.add('frost-baked');
    if (gs.sheen === 'bake') {
      sheen.style.backdropFilter = 'blur(30px)';
      sheen.style.webkitBackdropFilter = 'blur(30px)';
    }
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
      mosaic.style.clipPath = `circle(${r}px at ${cx}px ${cy}px)`;
      if (gs.sheen === 'bake') {
        // 정적 프로스트 — 반경 고정, 농도만 변조(굴절 재계산을 반경 변화와 분리)
        sheen.style.opacity = String(mode === 'expand' ? (1 - et) : et);
      } else {
        const blur = mode === 'expand' ? (30 * (1 - et)) : (30 * et);
        sheen.style.backdropFilter = `blur(${blur}px)`;
        sheen.style.webkitBackdropFilter = `blur(${blur}px)`;
      }
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        if (mode === 'expand') {
          // 안전망 — 부동소수 오차로 완전히 0에 못 미치는 경우를 명시적으로 정리한다.
          // (bake 변형은 반경이 30px 고정이었으므로 여기서 0으로 되돌리는 것이
          // 정지 상태 규범 "blur는 반드시 0px"의 유일한 경로다.)
          sheen.style.backdropFilter = 'blur(0px)';
          sheen.style.webkitBackdropFilter = 'blur(0px)';
        }
        // 잔류 방지 — 토글 상태와 무관하게 무조건 정리한다(구운 서리·농도 인라인).
        sheen.style.opacity = '';
        mosaic.classList.remove('frost-baked');
        resolve(timestamps);
      }
    }
    requestAnimationFrame(frame);
  });
}

// main.js가 주는 cx/cy/rmax는 물리 px(스크린 좌표 기반) — clipPath는 CSS px로
// 그리므로 줌 배율만큼 되돌린다(줌 미사용 시 zf=1로 기존과 동일).
function toCssCoords(payload) {
  const zf = window.athena.getZoomFactor();
  const scaled = { ...payload, cx: payload.cx / zf, cy: payload.cy / zf };
  if (typeof payload.rmax === 'number') scaled.rmax = payload.rmax / zf;
  return scaled;
}

window.athena.on('prime-clip', (payload) => {
  const p = toCssCoords(payload);
  mosaic.style.clipPath = `circle(0px at ${p.cx}px ${p.cy}px)`;
  sheen.style.backdropFilter = 'blur(30px)';
  window.athena.send('primed');
});

window.athena.on('run-animation', async (payload) => {
  const p = toCssCoords(payload);
  if (p.mode === 'expand') {
    mosaic.style.clipPath = `circle(0px at ${p.cx}px ${p.cy}px)`;
    sheen.style.backdropFilter = 'blur(30px)';
  }
  const timestamps = await runAnimation(p);
  window.athena.send('animation-done', { mode: p.mode, timestamps });
});

// ---------- 캔버스 카드 추가/초기화/하이라이트 ----------
window.athena.on('athena:add-canvas', ({ type }) => {
  addCard(type);
});

window.athena.on('athena:clear-canvases', () => {
  grid.innerHTML = '';
});

// ---------- 실배선 — stream-json-parser.classifyCanvasBlock()의 결과를 렌더 ----------
// main.js가 athena__render_canvas(source:'live')로 claude -p를 실왕복한 뒤 매
// render_canvas tool_result마다 이걸 보낸다. status는 success/fallback(둘 다
// canvas_type을 읽어 렌더한다) · rejected/error/unparseable(카드 대신 안내만).
window.athena.on('athena:add-canvas-live', (result) => {
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
  // 턴별 큐레이션(배치·생애주기 규칙 3, canvas-taxonomy) — 모델이 봉투
  // drop_types로 지목한, 현재 질의와 무관해진 카드를 렌더 전에 치운다.
  // 'table'은 픽스처 table과 실배선 mcp-table 둘 다다(lib/canvas-layout.js).
  for (const cls of dropTargetsFor(envelope.drop_types)) {
    const el = grid.querySelector(`.card.${cls}`);
    if (el) el.remove();
  }
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
  if (envelope.canvas_type === 'chart' && !envelope.fell_back) return renderLiveChart(envelope);
  // facts/compound(P4, plan/공통화면-템플릿-실행계획-2026-08-20.md) — 공통 API 카드 6종
  // 중 FactsCard/CompoundCard(일반). 스키마는 backend/athena_mcp/canvas.py FACTS_SCHEMA/
  // COMPOUND_SCHEMA(P1a) 그대로. C1(차트 12TR)은 이 분기가 아니라 위 'chart'로 온다 —
  // manifest layout=compound라도 build_chart_bars를 거치면 canvas_type은 'chart'다.
  if (envelope.canvas_type === 'facts' && !envelope.fell_back) return renderFactsCard(envelope);
  if (envelope.canvas_type === 'compound' && !envelope.fell_back) return renderCompoundCard(envelope);
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
  const { body } = makeCard('mcp-table', envelope.caption || '공통 테이블', envelope.layout);
  const rawCols = (envelope.data && Array.isArray(envelope.data.columns)) ? envelope.data.columns : [];
  const rows = (envelope.data && Array.isArray(envelope.data.rows)) ? envelope.data.rows : [];

  if (!rawCols.length || !rows.length) {
    body.appendChild(errorNote('빈 테이블 — columns 또는 rows가 없다.'));
    return;
  }
  body.appendChild(buildFoldedTable(rawCols, rows));
}

// table 카드와 compound 카드(P4)가 공유하는 표 빌더 — §5.3.1 컬럼 우선순위 흡수(2층):
// columns는 이미 백엔드가 §5.3.1 규칙(식별 컬럼 고정 + 실측 alias 빈도 tie-break,
// backend/scripts/generate_api.py의 column_priority_ranking)으로 정렬해 보낸다고
// 가정한다 — 여기서는 그 순서 위에서 1560px 캔버스 폭 기준으로 접기만 한다
// (app/lib/column-fold.js). ka10095(63컬럼) 같은 넓은 표가 스크롤 없이 fold되어
// 보이는 게 이 단계의 목표다. 반환은 table 엘리먼트 하나 — 카드 뼈대(makeCard)는
// 호출부가 짓는다.
function buildFoldedTable(rawCols, rows) {
  const { visible: cols, hidden } = foldColumns(rawCols);

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

  // 접힘 사실은 데이터 속성으로만 남긴다(검증·캡처 리포트가 기계로 읽는다).
  // 표시 텍스트("접힌 컬럼 N개 …")는 2026-08-18 사용자 결정으로 제거 —
  // 정보 정직성(ui/soul.md §8)은 기계 검증 가능성으로 유지한다.
  table.dataset.totalColumns = String(rawCols.length);
  table.dataset.visibleColumns = String(cols.length);
  table.dataset.hiddenColumns = String(hidden.length);
  return table;
}

// ---------- 실배선 FactsCard/CompoundCard(P4) — MCP render_canvas의 facts/compound 응답 ----------
// canvas.py FACTS_SCHEMA(L161-167)/COMPOUND_SCHEMA(L169-176) 실측: facts는
// {fields:[{key,label,value}]}, compound는 {header:[...같은 필드 계약...], table:{columns,rows}}.
// 필드별 개별 렌더러는 만들지 않는다 — lib/facts-card.js의 셀 프리미티브 5종
// (spec §4: 가격/등락/수량/종목/일시)이 key로 포맷을 결정하고, 나머지는 일반 텍스트다.

// FactsCard(F1 단일 그룹 · F2 2단 그룹, spec §3.1) — key/value dl 하나 또는 둘.
// 그룹 분할은 lib/facts-card.js groupFactsFields(순수 함수, facts-card.test.js가 검증).
function renderFactsFieldGroup(fields) {
  const dl = document.createElement('dl');
  dl.className = 'facts-group';
  for (const field of fields) {
    const key = field && field.key;
    const cell = classifyCell(key);
    const value = field ? field.value : undefined;

    const dt = document.createElement('dt');
    dt.className = 'facts-key';
    dt.textContent = (field && (field.label != null ? field.label : field.key)) || '';

    const dd = document.createElement('dd');
    dd.className = `facts-value facts-value-${cell}`;
    if (cell === 'change') {
      dd.classList.add(`is-${changeTone(key, value)}`);
      dd.textContent = value === null || value === undefined || value === '' ? '—' : String(value);
    } else if (cell === 'price' || cell === 'quantity') {
      dd.textContent = formatNumeric(value);
    } else if (cell === 'datetime') {
      dd.textContent = formatDatetime(value);
    } else {
      dd.textContent = value === null || value === undefined || value === '' ? '—' : String(value);
    }
    // dt+dd를 .facts-row로 묶는다(HTML5 dl은 그룹을 div로 감싸는 것을 허용한다) —
    // facts-grid(세로: 라벨 위·값 아래)와 compound 헤더 밴드(가로 칩)가 같은 DOM을
    // CSS만 바꿔 재사용하려면 한 쌍이 붙어 다녀야 한다(순수 dt/dd 나열은 flex-wrap
    // 시 쌍이 흩어진다).
    const row = document.createElement('div');
    row.className = 'facts-row';
    row.appendChild(dt);
    row.appendChild(dd);
    dl.appendChild(row);
  }
  return dl;
}

function renderFactsGrid(fields) {
  const groups = groupFactsFields(fields);
  const wrap = document.createElement('div');
  wrap.className = groups.length > 1 ? 'facts-grid facts-grid-2col' : 'facts-grid';
  for (const group of groups) wrap.appendChild(renderFactsFieldGroup(group));
  return wrap;
}

function renderFactsCard(envelope) {
  const { body } = makeCard('facts', envelope.caption || 'Facts', envelope.layout);
  const fields = (envelope.data && Array.isArray(envelope.data.fields)) ? envelope.data.fields : [];
  if (!fields.length) {
    body.appendChild(errorNote('빈 facts — fields가 없다.'));
    return;
  }
  body.appendChild(renderFactsGrid(fields));
}

// CompoundCard 일반(C2, spec §3.3) — "이름과 달리 다중 표가 아니다": 스칼라 헤더 밴드
// 하나 + 표 하나로 고정. 헤더는 facts와 같은 셀 프리미티브를 재사용하되 세로 그리드가
// 아니라 가로 밴드(스칼라 2~9개, §3.3 실측이라 F2 2단 분할까지는 가지 않는다)로 편다.
// 표는 buildFoldedTable을 그대로 재사용한다(mcp-table과 드리프트하지 않는다).
function renderCompoundHeaderBand(fields) {
  const band = document.createElement('div');
  band.className = 'compound-header-band';
  band.appendChild(renderFactsFieldGroup(fields));
  return band;
}

function renderCompoundCard(envelope) {
  const { body } = makeCard('compound', envelope.caption || 'Compound', envelope.layout);
  const data = (envelope.data && typeof envelope.data === 'object') ? envelope.data : {};
  const header = Array.isArray(data.header) ? data.header : [];
  const table = data.table;
  const tableCols = table && Array.isArray(table.columns) ? table.columns : [];
  const tableRows = table && Array.isArray(table.rows) ? table.rows : [];
  if (!header.length || !tableCols.length || !tableRows.length) {
    body.appendChild(errorNote('빈 compound — header 또는 table이 없다.'));
    return;
  }
  body.appendChild(renderCompoundHeaderBand(header));
  body.appendChild(buildFoldedTable(tableCols, tableRows));
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
  const { body } = makeCard('stream', envelope.caption || '스트림 · 뉴스', envelope.layout);
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
  const { body } = makeCard('reader', data.title || envelope.caption || '리더 · 공시 원문', envelope.layout);
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

// ---------- 실배선 차트(신규⑤) — MCP render_canvas의 실제 chart 응답 ----------
// live-prompt.js의 chart 힌트가 규정한 형상: data는 {symbol, name, bars:[{time,
// open,high,low,close,volume}, ...]}(날짜 오름차순 — 프롬프트가 모델에게 정렬해서
// 보내라고 지시한다, 여기서는 재정렬하지 않는다). 렌더 자체는 아래 renderChartCard
// (목업 경로, addCard('chart'))와 같은 createChartCard를 재사용한다 — 차이는
// loadFixture 대신 envelope.data를 바로 먹인다는 것뿐이다. 카드 셸(makeCard)·
// cardDestroyers 등록·에러 처리는 다른 실배선 렌더러(renderMcpTable 등)와 동일하다.
async function renderLiveChart(envelope) {
  const data = (envelope.data && typeof envelope.data === 'object') ? envelope.data : {};
  const bars = Array.isArray(data.bars) ? data.bars : [];
  const title = envelope.caption || (data.name ? `일봉 — ${data.name}` : '차트');
  const { card, body } = makeCard('chart', title, envelope.layout);
  if (!bars.length) {
    body.appendChild(errorNote('빈 차트 — bars가 없다.'));
    return;
  }
  const chartBody = document.createElement('div');
  chartBody.className = 'chart-card-body';
  body.appendChild(chartBody);
  try {
    // P2a — data.initial({period})은 일/주/월/년봉 8TR에 한해 render-plan이
    // 실어준다(canvas_transform.py::resolve_chart_initial_period). 그 외(P2b
    // 분/틱 4TR 포함)는 undefined — createChartCard의 resolveInitialPeriod가
    // 'D'로 안전 폴백한다.
    const instance = await createChartCard(chartBody, { symbol: data.symbol, name: data.name, ohlcv: bars, initial: data.initial });
    // 닫기 버튼(closeCard)이 lightweight-charts를 정리하도록 카드 자체에 매단다.
    cardDestroyers.set(card, instance.destroy);
  } catch (err) {
    chartBody.remove();
    body.appendChild(errorNote(`차트를 그리지 못했다 — ${err && err.message ? err.message : String(err)}`));
  }
}

// ---------- 자유 카드(신규, W4 최소 구현) ----------
// GLOSSARY.md §2: "기성 12종으로 표현 못 하는 데이터가 오면 AI가 그 자리에서
// 그리는 설계된 탈출구." 전체 자유 카드 설계(W4)는 미착수 상태로 남아 있다 —
// 이건 그 자리를 비워두지 않기 위한 최소 구현이다: 스키마를 가정하지 않고
// envelope.data를 재귀적으로 key/value 트리로 펼친다. innerHTML 미사용
// (CLAUDE.md §6) — DOM 노드만 만든다.
function renderFreeCanvas(envelope) {
  const { body } = makeCard('free', envelope.caption || '자유 카드', envelope.layout);
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

window.athena.on('athena:highlight-canvas', (type) => {
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
  const destroy = cardDestroyers.get(card);
  if (destroy) {
    try { destroy(); } catch (err) { /* 카드가 이미 언마운트된 경우 등 — 닫기 자체는 막지 않는다 */ }
    cardDestroyers.delete(card);
  }
  // 부모에서 remove → 그리드가 비면 캔버스 접기는 ui-kit.js의
  // removeCardAndMaybeCollapse로 settings-cards.js와 공용화했다(포니테일 감사).
  removeCardAndMaybeCollapse(card);
}

function cardCloseButton(card) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'uk-card-close';
  b.setAttribute('aria-label', '카드 닫기');
  b.title = '이 카드 닫기';
  // 문자 '×' 대신 스트로크 SVG — 폰트에 따라 흔들리지 않는 정밀한 X.
  // createElementNS는 DOM 노드 생성이므로 innerHTML 금지 원칙(CLAUDE.md §6)과 무관.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 10 10');
  svg.setAttribute('width', '10');
  svg.setAttribute('height', '10');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M1.2 1.2 L8.8 8.8', 'M8.8 1.2 L1.2 8.8']) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.3');
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
  }
  b.appendChild(svg);
  b.addEventListener('click', () => closeCard(card));
  return b;
}

// 높이 예산 안전망(배치·생애주기 규칙 4) — 총높이 ≤ 뷰포트 2배, 최소 3장 보장.
// 큐레이션(규칙 3, drop_types)이 먼저 돌므로 여기 닿는 경우는 드물어야 한다.
// 초과 시 가장 오래된(도착순 맨 앞) 카드부터 제거한다. 판정 로직은
// lib/canvas-layout.js — 순수 함수라 node --test로 검증된다.
function enforceHeightBudget() {
  let cards = grid.querySelectorAll('.card');
  while (
    cards.length > MIN_CARDS &&
    exceedsHeightBudget(grid.scrollHeight, grid.clientHeight, cards.length)
  ) {
    cards[0].remove();
    cards = grid.querySelectorAll('.card');
  }
}

function makeCard(type, title, layoutHint) {
  const existing = grid.querySelector(`.card.${type}`);
  if (existing) existing.remove(); // 재요청 시 새로 갱신 — 큐레이션(규칙 3)의 특수 사례
  const card = document.createElement('div');
  // 폭은 형상이 정하고(w-half/w-full), AI layout 힌트는 등급 승격·강등만 한다.
  // 순서는 도착순(appendChild) — canvas-taxonomy "배치·생애주기 규칙 (2026-08-18)".
  card.className = `card ${type} w-${widthGradeFor(type, layoutHint)}`;
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
  enforceHeightBudget();
  // 2026-08-19 QA 결함 #2 실제 원인 — .grid는 overflow-y:auto라 카드가 쌓여
  // 뷰포트를 넘기면, 새/갱신 카드가 스크롤 위치 밖(화면 아래)에 조용히 붙는다.
  // scrollTop을 아무도 옮기지 않으니 사용자는 새 카드가 도착한 줄도 모른다 —
  // capturePage() 캡처가 "안 바뀐 것처럼" 보인 진짜 이유였다(19-chart-card.png /
  // 20-live-chart-card.png가 MD5까지 같았던 것 — 캔버스 자체는 매번 옳게 갱신됐고,
  // 화면에 안 보이는 위치에 있었을 뿐). 캡처 버그가 아니라 실사용에서도 새 카드가
  // 안 보일 수 있는 결함이라 여기(카드 생성 지점)에서 고친다.
  card.scrollIntoView({ block: 'nearest' });
  // 2026-08-19 QA 결함 #5 — 하단 경계에서 반쯤 잘린 글리프가 다른 글자로 읽힌다
  // (픽스처 원문 "주주균등처분(주)"이 03-mosaic-expanded.png에서 "조조규등처부(조)"로
  // 보였다 — 인코딩이 아니라 descender 절단). 스크롤이 실제로 생겼을 때만
  // .is-clipped를 붙여 CSS 페이드(잘림의 정직한 표시)를 켠다. 내용이 다 보이면
  // 페이드도 없다 — 정보 정직성 우선.
  const syncClipped = () => {
    body.classList.toggle('is-clipped', body.scrollHeight > body.clientHeight + 1);
  };
  new ResizeObserver(syncClipped).observe(body);
  new MutationObserver(syncClipped).observe(body, { childList: true, subtree: true });
  return { card, body };
}

async function addCard(type) {
  if (type === 'stream') return renderStream();
  if (type === 'reader') return renderReader();
  if (type === 'table') return renderTable();
  if (type === 'chart') return renderChartCard();
  // 계좌·MCP 카드는 여기 없다. 2026-08-16에 대화 창의 설정 모드로 옮겼다 —
  // 설정은 데이터 출력이 아니라 "앱 자신"이고, 설정을 만지는 동안 사용자는
  // 채팅을 치지 않는다(ui/DESIGN-SOUL.md:100). 렌더는 chat.js `openSettings`.
}

// ⑤ 차트 카드(CC-101) — CompoundCard(charts) 위 시계열 렌즈. 카드 제목은
// TR ID를 노출하지 않는다("일봉 — 삼성전자", CLAUDE.md §5.3.1 관례와 같은 이유로
// 내부 코드를 화면에 흘리지 않는다). lightweight-charts 마운트는 비동기(동적
// import, lib/chart-card.js 상단 주석)라 makeCard로 카드 뼈대를 먼저 세우고
// 그 안에서 await한다 — 다른 렌더러(renderStream 등)와 달리 이 함수만 async다.
async function renderChartCard() {
  const { card, body } = makeCard('chart', '일봉 — 삼성전자');
  const chartBody = document.createElement('div');
  chartBody.className = 'chart-card-body';
  body.appendChild(chartBody);
  try {
    const { bars } = await loadFixture('chart');
    const instance = await createChartCard(chartBody, { symbol: '005930', name: '삼성전자', ohlcv: bars });
    // 닫기 버튼(closeCard)이 lightweight-charts를 정리하도록 카드 자체에 매단다.
    cardDestroyers.set(card, instance.destroy);
  } catch (err) {
    chartBody.remove();
    body.appendChild(errorNote(`차트를 그리지 못했다 — ${err && err.message ? err.message : String(err)}`));
  }
}

// ① 스트림 — sanitize한 문자열은 절대 innerHTML로 넣지 않는다. textContent로만.
async function renderStream() {
  const { body } = makeCard('stream', '스트림 · 뉴스');
  const { items } = await loadFixture('stream');
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
async function renderReader() {
  const { body } = makeCard('reader', '리더 · 공시 원문');
  const { markdown: md } = await loadFixture('reader');
  const note = document.createElement('div');
  note.className = 'fin-meta';
  note.textContent = '원문 일부(캡처 당시 미리보기 필드 한도로 절단됨) — DART 자기주식 처분 결정 공시';
  body.appendChild(note);
  renderMarkdownInto(body, md);
}

// ④ 공통 테이블 — 재무제표(재무상태표) 스냅샷
async function renderTable() {
  const { body } = makeCard('table', '재무제표(연결)');
  const { meta, list } = await loadFixture('table');
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
    window.athena.send('athena:zoom', { dir: 'in' });
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    window.athena.send('athena:zoom', { dir: 'out' });
  } else if (e.key === '0') {
    e.preventDefault();
    window.athena.send('athena:zoom', { dir: 'reset' });
  } else if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    window.athena.send('athena:minimize-windows');
  }
});

window.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  window.athena.send('athena:zoom', { dir: e.deltaY < 0 ? 'in' : 'out' });
}, { passive: false });

// 창 이동은 네이티브 캡션이다(2026-08-19 표준화) — 손잡이는 canvas.html의
// 상단 스트립(#dragStrip, canvas.css -webkit-app-region:drag)이고 JS 드래그
// 경로는 폐기됐다. 카드·여백의 스크롤·선택은 이제 드래그와 충돌 여지가 없다.
