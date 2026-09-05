// IIFE 스코프 격리 — board-format.js와 같은 이유(렌더러 스크립트 스코프 공유).
(function () {
'use strict';

// 생성물 색인. scripts/build_board_registry.py가
// backend/ref/card-surface-templates/*/board.html을 카드별 청크로 묶고, 보드 id →
// 카드 id 색인 하나를 따로 낸다 — 여기서는 읽기만 한다.
//
// 셸이 동기로 싣는 것은 색인(수 KB)뿐이다. 원문 HTML은 카드 청크(수 MB)에 들어
// 있고, 마운트 직전에 필요한 청크 하나만 `<script src>` 주입으로 가져온다.
// fetch를 쓰지 않는 이유는 렌더러가 file:// 스코프이기 때문이다(fetch는 막힌다,
// script src는 된다).
const isCjs = typeof module !== 'undefined' && !!module.exports;
const lib = (typeof window !== 'undefined' && window.AthenaLib) || null;
const index = isCjs
  ? require('./board-templates.index.generated')
  : (lib && lib.BoardTemplatesIndex);

const BOARD_CARD = (index && index.BOARD_CARD) || {};
const CARD_IDS = (index && index.CARD_IDS) || [];
const STATE_GRAPH = (index && index.STATE_GRAPH) || {};

// 이 스크립트가 어디서 왔는지 — 청크도 같은 폴더에 있다. 문서 URL 기준 상대경로를
// 쓰면 fixture HTML(app/*.html)처럼 다른 위치에서 부를 때 깨진다.
const SELF_SRC = (typeof document !== 'undefined' && document.currentScript
  && document.currentScript.src) || '';

function chunkFileName(cardId) {
  return `board-templates.${cardId}.generated.js`;
}

function chunkUrl(cardId) {
  const file = chunkFileName(cardId);
  return SELF_SRC ? SELF_SRC.replace(/[^/]+$/, file) : `lib/${file}`;
}

// 청크는 자기 자신을 window.AthenaLib.BoardTemplateChunks에 등록한다 — 레지스트리가
// 먼저 로드됐든 나중이든 상관없게 하려는 것이다.
function chunkTable() {
  return (typeof window !== 'undefined' && window.AthenaLib
    && window.AthenaLib.BoardTemplateChunks) || {};
}

const chunks = new Map();   // cardId → BOARDS
const pending = new Map();  // cardId → Promise<BOARDS>

function adopt(cardId, chunk) {
  const boards = (chunk && chunk.BOARDS) || null;
  if (!boards) return null;
  chunks.set(cardId, boards);
  return boards;
}

// 이미 와 있는 청크만 붙인다(주입은 하지 않는다). CJS에서는 require가 동기라
// 여기서 바로 읽어 온다 — 단위 테스트는 그 경로로 색인 전체를 그냥 쓴다.
function residentChunk(cardId) {
  if (!cardId) return null;
  if (chunks.has(cardId)) return chunks.get(cardId);
  const global = chunkTable()[cardId];
  if (global) return adopt(cardId, global);
  if (!isCjs) return null;
  try {
    return adopt(cardId, require(`./${chunkFileName(cardId)}`));
  } catch {
    return null;
  }
}

function injectChunk(cardId) {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc) return Promise.reject(new Error(`보드 청크를 실을 문서가 없다 — ${cardId}`));
  return new Promise((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = chunkUrl(cardId);
    // 순서를 보장할 필요가 없다 — 청크끼리 의존하지 않는다.
    script.async = true;
    script.addEventListener('load', () => {
      const boards = adopt(cardId, chunkTable()[cardId]);
      if (boards) resolve(boards);
      else reject(new Error(`보드 청크가 자기를 등록하지 않았다 — ${cardId}`));
    });
    script.addEventListener('error', () => reject(new Error(`보드 청크를 못 읽었다 — ${chunkUrl(cardId)}`)));
    (doc.head || doc.documentElement).appendChild(script);
  });
}

// 카드 청크 1개를 상주시킨다. 같은 카드를 동시에 여러 번 불러도 주입은 1회다.
function loadChunk(cardId) {
  const resident = residentChunk(cardId);
  if (resident) return Promise.resolve(resident);
  if (!cardId) return Promise.reject(new Error('보드 청크 카드 id가 없다'));
  if (pending.has(cardId)) return pending.get(cardId);
  const task = injectChunk(cardId).catch((error) => {
    pending.delete(cardId);
    throw error;
  });
  pending.set(cardId, task);
  return task;
}

function boardIds() {
  return Object.keys(BOARD_CARD).sort();
}

function hasBoard(boardId) {
  return Object.prototype.hasOwnProperty.call(BOARD_CARD, String(boardId));
}

function cardIdFor(boardId) {
  return hasBoard(boardId) ? BOARD_CARD[String(boardId)] : null;
}

function cardIds() {
  return CARD_IDS.slice();
}

// 상주한 청크에서만 찾는다. 브라우저에서 아직 안 실린 카드면 null이고, 호출부는
// loadBoard가 돌려주는 Promise를 기다려야 한다.
function boardEntry(boardId) {
  const cardId = cardIdFor(boardId);
  if (!cardId) return null;
  const boards = residentChunk(cardId);
  return (boards && boards[String(boardId)]) || null;
}

// 보드 1장을 쓸 수 있게 만든다 — 필요한 청크만 주입하고 항목으로 해석한다.
function loadBoard(boardId) {
  const cardId = cardIdFor(boardId);
  if (!cardId) return Promise.reject(new Error(`색인에 없는 보드다 — ${boardId}`));
  const resident = boardEntry(boardId);
  if (resident) return Promise.resolve(resident);
  return loadChunk(cardId).then(() => {
    const entry = boardEntry(boardId);
    if (!entry) throw new Error(`청크에 보드가 없다 — ${boardId}`);
    return entry;
  });
}

function isLoaded(boardId) {
  return boardEntry(boardId) !== null;
}

function boardHtml(boardId) {
  const entry = boardEntry(boardId);
  return entry ? entry.html : null;
}

function boardSha256(boardId) {
  const entry = boardEntry(boardId);
  return entry ? entry.htmlSha256 : null;
}

// 파싱한 <template>은 보드마다 1회만 만든다(D1 "런타임 레이아웃 재조립 없음" —
// 매 마운트마다 innerHTML을 다시 파싱하면 보드 1장에 수백 노드를 반복 파싱한다).
const templateCache = new Map();

// 마운트 계약(정적) — 어느 노드에 어떤 슬롯이 앉고 어떻게 포맷하는지. 값은 여기
// 없다. 값은 봉투의 surface_contract.slot_values가 나른다(백엔드 계약 §3).
function contractFor(boardId) {
  const entry = boardEntry(boardId);
  return entry ? { board_id: String(boardId), slots: entry.slots || [] } : null;
}

// 상태 보드 링크(어느 칩이 어느 보드를 여는가)의 정본은 이 색인이다. 봉투는 마운트한
// 그 보드의 직계 자식만 나르는데, 자식 보드의 탭 레일은 부모 레일의 복제본이라 부모의
// 링크가 없으면 갈아탄 뒤 레일이 통째로 죽는다. 그래서 제 자식 + 부모 레일 전부를 준다.
// 되돌아가기는 부모 레일에 부모 자신을 여는 표식이 있을 때만 나온다(레일 주인) —
// 없는 보드는 되돌아갈 칩을 지어내지 않는다.
function stateLinksFor(boardId) {
  const entry = STATE_GRAPH[String(boardId || '')];
  if (!entry) return [];
  const parent = entry.parent ? STATE_GRAPH[entry.parent] : null;
  const links = [];
  const seen = new Set();
  for (const link of (entry.links || []).concat((parent && parent.links) || [])) {
    const key = `${link.board_id} ${link.control}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ control: link.control, board_id: link.board_id });
  }
  return links;
}

// 보드 1장당 <template> 1개. cloneNode는 호출부(board-mount)가 한다.
function templateFor(boardId, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return null;
  const html = boardHtml(boardId);
  if (html === null) return null;
  const cached = templateCache.get(boardId);
  if (cached && cached.doc === doc) return cached.template;
  const template = doc.createElement('template');
  template.innerHTML = html;
  templateCache.set(boardId, { doc, template });
  return template;
}

function clearTemplateCache() {
  templateCache.clear();
}

const __exports = {
  BOARD_CARD, boardIds, cardIds, hasBoard, cardIdFor, isLoaded,
  chunkFileName, chunkUrl, loadChunk, loadBoard,
  boardHtml, boardSha256, contractFor, stateLinksFor, templateFor, clearTemplateCache,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BoardTemplateRegistry = __exports;
}

})();
