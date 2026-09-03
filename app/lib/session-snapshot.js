// 세션 스냅샷 계약 — 대화 세션 한 벌이 파일·DB·화면 어디를 지나도 같은 모양으로 남게 하는
// 순수 규칙 모듈이다(docs/plans/session-persistence-spec.md 2절의 레코드를 코드로 옮긴 것).
// Electron·fs·sqlite를 부르지 않는다. main이 쓰고 렌더러가 그리는 두 경로가 각자 정규화
// 규칙을 들면 저장본과 화면이 조용히 어긋나므로, 직렬화·정규화의 진실은 이 파일 하나다.
(function () {
'use strict';

const SCHEMA_VERSION = 1;
const MODES = Object.freeze(['chat', 'graph', 'agent', 'plugin', 'backtest']);
// 코드의 모드 어휘(graph-mode-store.js의 VIEW_*)는 대화 모드를 'summary'라 부르고
// 세션 레코드는 'chat'이라 부른다. 두 이름의 다리는 여기 한 쌍뿐이다 — 다른 파일이
// 각자 매핑을 들면 저장된 mode와 화면의 view가 조용히 어긋난다.
const VIEW_TO_MODE = Object.freeze({ summary: 'chat' });
const MODE_TO_VIEW = Object.freeze({ chat: 'summary' });
const TITLE_SOURCES = ['auto', 'user', 'fallback'];
const VIEWPORT_KEYS = ['chat', 'canvas', 'editor', 'sidebar'];
// conversations.js truncateTitle과 같은 40자 — 제목 규칙이 두 벌이 되면 목록과 본문이 갈린다.
const TITLE_MAX = 40;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMode(value) {
  return MODES.includes(value);
}

// 화면의 view id → 세션 레코드의 mode. 모르는 값은 'chat'으로 떨어뜨린다.
function viewToMode(view) {
  const key = typeof view === 'string' ? view : '';
  if (VIEW_TO_MODE[key]) return VIEW_TO_MODE[key];
  return isMode(key) ? key : 'chat';
}

// 세션 레코드의 mode → 화면의 view id. 모르는 값은 'summary'로 떨어뜨린다.
function modeToView(mode) {
  const key = typeof mode === 'string' ? mode : '';
  if (MODE_TO_VIEW[key]) return MODE_TO_VIEW[key];
  return isMode(key) ? key : 'summary';
}

function nowIso(now) {
  return typeof now === 'string' && now ? now : new Date().toISOString();
}

function str(value, fallback) {
  return typeof value === 'string' && value ? value : fallback;
}

// undefined는 "안 건드림"이지 "지움"이 아니다 — 부분 patch의 기본 어휘.
function definedEntries(patch) {
  if (!isPlainObject(patch)) return [];
  return Object.entries(patch).filter(([, value]) => value !== undefined);
}

function mergeDepth2(base, patch) {
  const next = { ...base };
  for (const [key, value] of definedEntries(patch)) {
    if (isPlainObject(value) && isPlainObject(next[key])) {
      const inner = { ...next[key] };
      for (const [innerKey, innerValue] of definedEntries(value)) inner[innerKey] = innerValue;
      next[key] = inner;
    } else {
      next[key] = value;
    }
  }
  return next;
}

function titleFrom(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '(제목 없음)';
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX)}…` : clean;
}

function normalizeMessage(raw) {
  const src = isPlainObject(raw) ? raw : {};
  return {
    id: str(src.id, ''),
    parentId: str(src.parentId, null),
    role: str(src.role, 'user'),
    text: typeof src.text === 'string' ? src.text : '',
    thinking: typeof src.thinking === 'string' ? src.thinking : '',
    // done 미지정은 완료로 본다 — 진행 중인 행만 명시적으로 false를 적는다(명세 4절 자리표시자).
    done: src.done !== false,
    toolSteps: Array.isArray(src.toolSteps) ? src.toolSteps.slice() : [],
    cardRefs: Array.isArray(src.cardRefs) ? src.cardRefs.slice() : [],
    attachments: Array.isArray(src.attachments) ? src.attachments.slice() : [],
    usage: isPlainObject(src.usage) ? { ...src.usage } : null,
    error: src.error === undefined || src.error === null ? null : src.error,
    occurredAt: str(src.occurredAt, null),
  };
}

function normalizeCard(raw) {
  const src = isPlainObject(raw) ? raw : {};
  return {
    cardId: str(src.cardId, ''),
    seq: Number.isInteger(src.seq) && src.seq >= 0 ? src.seq : 0,
    kind: str(src.kind, ''),
    channel: str(src.channel, ''),
    envelope: isPlainObject(src.envelope) ? { ...src.envelope } : null,
    dataRef: src.dataRef === undefined || src.dataRef === null ? null : src.dataRef,
    live: Boolean(src.live),
    protected: Boolean(src.protected),
    createdAt: str(src.createdAt, null),
  };
}

function normalizeJob(raw) {
  const src = isPlainObject(raw) ? raw : {};
  const seen = isPlainObject(src.lastSeen) ? src.lastSeen : {};
  return {
    id: str(src.id, ''),
    kind: str(src.kind, ''),
    attachedAt: str(src.attachedAt, null),
    lastSeen: {
      status: str(seen.status, null),
      pct: typeof seen.pct === 'number' ? seen.pct : null,
      at: str(seen.at, null),
    },
  };
}

function normalizeViewport(raw) {
  const src = isPlainObject(raw) ? raw : {};
  const viewport = {};
  for (const key of VIEWPORT_KEYS) viewport[key] = isPlainObject(src[key]) ? { ...src[key] } : {};
  return viewport;
}

// seq는 배열 순서가 진실이다 — 저장본이 어떤 번호를 들고 왔든 다시 매긴다.
function resequence(cards) {
  return cards.map((card, index) => ({ ...card, seq: index }));
}

function normalizeSnapshot(raw) {
  const src = isPlainObject(raw) ? raw : {};
  const mode = isMode(src.mode) ? src.mode : 'chat';

  const messages = [];
  const seenIds = new Set();
  if (Array.isArray(src.messages)) {
    for (const item of src.messages) {
      if (!isPlainObject(item)) continue;
      const message = normalizeMessage(item);
      // 중복 id는 첫 것만 — 뒤엣것은 저널 재기록의 잔재다(명세 4절 저널 커밋).
      if (!message.id || seenIds.has(message.id)) continue;
      seenIds.add(message.id);
      messages.push(message);
    }
  }

  const cards = [];
  if (Array.isArray(src.canvasCards)) {
    for (const item of src.canvasCards) {
      if (!isPlainObject(item)) continue;
      const card = normalizeCard(item);
      if (card.cardId) cards.push(card);
    }
  }

  const jobs = [];
  if (Array.isArray(src.jobs)) {
    for (const item of src.jobs) {
      if (!isPlainObject(item)) continue;
      const job = normalizeJob(item);
      if (job.id) jobs.push(job);
    }
  }

  const stamp = str(src.createdAt, null) || str(src.updatedAt, null) || nowIso();
  const title = titleFrom(src.title);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: str(src.id, ''),
    mode,
    projectId: str(src.projectId, 'default'),
    title,
    titleSource: TITLE_SOURCES.includes(src.titleSource)
      ? src.titleSource
      : (str(src.title, '') ? 'auto' : 'fallback'),
    pinned: Boolean(src.pinned),
    archived: Boolean(src.archived),
    createdAt: str(src.createdAt, stamp),
    updatedAt: str(src.updatedAt, stamp),
    revision: Number.isInteger(src.revision) && src.revision >= 0 ? src.revision : 0,
    messages,
    currentId: str(src.currentId, null),
    canvasCards: resequence(cards),
    // workspace 내부 키는 모드마다 다른 유니온이라 화이트리스트를 두지 않는다. kind만 강제한다.
    workspace: { ...(isPlainObject(src.workspace) ? src.workspace : {}), kind: mode },
    viewport: normalizeViewport(src.viewport),
    jobs,
  };
}

function createSnapshot(options) {
  const opts = isPlainObject(options) ? options : {};
  const at = nowIso(opts.now);
  return normalizeSnapshot({
    id: opts.id,
    mode: opts.mode,
    projectId: opts.projectId,
    title: opts.title,
    titleSource: str(opts.title, '') ? 'auto' : 'fallback',
    createdAt: at,
    updatedAt: at,
  });
}

function messagePath(messages, currentId) {
  const rows = Array.isArray(messages) ? messages.filter(isPlainObject) : [];
  const byId = new Map();
  for (const row of rows) {
    if (typeof row.id === 'string' && row.id && !byId.has(row.id)) byId.set(row.id, row);
  }

  let tail = byId.get(currentId);
  if (!tail) {
    // currentId가 없거나 가리키는 행이 사라졌으면 마지막 완료 메시지를 말단으로 본다.
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (rows[i].done === true && typeof rows[i].id === 'string' && rows[i].id) {
        tail = rows[i];
        break;
      }
    }
  }
  if (!tail) return [];

  const path = [];
  const visited = new Set();
  let node = tail;
  // 방문 집합 — parentId가 자기 자신이거나 사이클이면 여기서 멈춘다.
  while (node && !visited.has(node.id)) {
    visited.add(node.id);
    path.push(node);
    node = typeof node.parentId === 'string' ? byId.get(node.parentId) : null;
  }
  return path.reverse();
}

function appendMessage(snapshot, message) {
  const base = normalizeSnapshot(snapshot);
  const next = normalizeMessage(message);
  if (!next.id) return base;
  const linked = { ...next, parentId: next.parentId || base.currentId };
  return { ...base, messages: [...base.messages, linked], currentId: linked.id };
}

function updateMessage(snapshot, messageId, patch) {
  const base = normalizeSnapshot(snapshot);
  const index = base.messages.findIndex((row) => row.id === messageId);
  // 없는 id는 아무 일도 없었던 것처럼 원본을 그대로 돌려준다(늦게 도착한 저널 델타).
  if (index < 0) return snapshot;
  const merged = { ...base.messages[index] };
  for (const [key, value] of definedEntries(patch)) merged[key] = value;
  const messages = base.messages.slice();
  messages[index] = normalizeMessage({ ...merged, id: base.messages[index].id });
  return { ...base, messages };
}

function putCard(snapshot, card) {
  const base = normalizeSnapshot(snapshot);
  const next = normalizeCard(card);
  if (!next.cardId) return base;
  const index = base.canvasCards.findIndex((row) => row.cardId === next.cardId);
  const cards = base.canvasCards.slice();
  if (index < 0) cards.push(next);
  else cards[index] = next;
  return { ...base, canvasCards: resequence(cards) };
}

function removeCard(snapshot, cardId) {
  const base = normalizeSnapshot(snapshot);
  const cards = base.canvasCards.filter((row) => row.cardId !== cardId);
  return { ...base, canvasCards: resequence(cards) };
}

function mergeWorkspace(snapshot, patch) {
  const base = normalizeSnapshot(snapshot);
  const workspace = mergeDepth2(base.workspace, patch);
  workspace.kind = base.mode;
  return { ...base, workspace };
}

function mergeViewport(snapshot, patch) {
  const base = normalizeSnapshot(snapshot);
  return { ...base, viewport: normalizeViewport(mergeDepth2(base.viewport, patch)) };
}

function attachJob(snapshot, job) {
  const base = normalizeSnapshot(snapshot);
  const next = normalizeJob(job);
  if (!next.id) return base;
  const index = base.jobs.findIndex((row) => row.id === next.id);
  const jobs = base.jobs.slice();
  if (index < 0) jobs.push(next);
  else jobs[index] = next;
  return { ...base, jobs };
}

function updateJobSeen(snapshot, jobId, lastSeen) {
  const base = normalizeSnapshot(snapshot);
  const index = base.jobs.findIndex((row) => row.id === jobId);
  if (index < 0) return snapshot;
  const jobs = base.jobs.slice();
  jobs[index] = normalizeJob({
    ...base.jobs[index],
    lastSeen: mergeDepth2(base.jobs[index].lastSeen, lastSeen),
  });
  return { ...base, jobs };
}

// revision은 호출자가 명시적으로 올린다 — 변경 함수가 자동으로 올리면 한 사용자 동작이
// 여러 patch로 쪼개질 때 revision이 실제 커밋 수와 어긋난다(명세 원칙 11).
function bumpRevision(snapshot, now) {
  const base = normalizeSnapshot(snapshot);
  return { ...base, revision: base.revision + 1, updatedAt: nowIso(now) };
}

const __exports = {
  MODES,
  SCHEMA_VERSION,
  isMode,
  viewToMode,
  modeToView,
  createSnapshot,
  normalizeSnapshot,
  normalizeMessage,
  normalizeCard,
  messagePath,
  appendMessage,
  updateMessage,
  putCard,
  removeCard,
  mergeWorkspace,
  mergeViewport,
  attachJob,
  updateJobSeen,
  bumpRevision,
  titleFrom,
};

// UMD 각주(2026-08-18 렌더러 격리) — canvas-layout.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.SessionSnapshot = __exports;
}

})();
