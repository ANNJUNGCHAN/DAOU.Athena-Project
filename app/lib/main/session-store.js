// 세션 영속 저장소. JSON 한 덩어리는 메시지가 쌓일수록 통째로 다시 쓰고 다시 읽어야 해서
// 스트리밍 중 5초마다 진행 중 행만 고쳐 쓰는 저널 커밋과 본문 검색을 감당하지 못한다. 그래서 SQLite다.
// 목록 조회(listSessions)는 sessions 테이블의 인덱스 컬럼만 읽고 메시지·카드·워크스페이스 blob은 열지 않는다.
// 사이드바를 그리는 데 대화 본문이 필요 없기 때문이다(Open WebUI가 chat 목록에서 chat JSON을 안 건드리는 이유와 같다).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  SCHEMA_VERSION,
  createSnapshot,
  normalizeSnapshot,
  normalizeMessage,
  normalizeCard,
  titleFrom,
} = require('../session-snapshot');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    schema_version INTEGER,
    mode TEXT NOT NULL,
    project_id TEXT NOT NULL,
    title TEXT,
    title_source TEXT,
    pinned INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT,
    revision INTEGER DEFAULT 0,
    current_id TEXT,
    workspace_json TEXT,
    viewport_json TEXT
  );
  CREATE TABLE IF NOT EXISTS session_messages (
    session_id TEXT,
    message_id TEXT,
    parent_id TEXT,
    role TEXT,
    seq INTEGER,
    text TEXT,
    thinking TEXT,
    done INTEGER,
    tool_steps_json TEXT,
    card_refs_json TEXT,
    attachments_json TEXT,
    usage_json TEXT,
    error TEXT,
    occurred_at TEXT,
    PRIMARY KEY (session_id, message_id)
  );
  CREATE TABLE IF NOT EXISTS session_cards (
    session_id TEXT,
    card_id TEXT,
    seq INTEGER,
    kind TEXT,
    channel TEXT,
    envelope_json TEXT,
    data_ref TEXT,
    live_json TEXT,
    protected INTEGER,
    created_at TEXT,
    PRIMARY KEY (session_id, card_id)
  );
  CREATE TABLE IF NOT EXISTS session_jobs (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    kind TEXT,
    status TEXT,
    progress_json TEXT,
    log_ref TEXT,
    attached_at TEXT,
    heartbeat_at TEXT,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_mode ON sessions(mode);
  CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);
  CREATE INDEX IF NOT EXISTS idx_session_messages_seq ON session_messages(session_id, seq);
  CREATE INDEX IF NOT EXISTS idx_session_jobs_session ON session_jobs(session_id);
  CREATE INDEX IF NOT EXISTS idx_session_jobs_status ON session_jobs(status);
`;

const MESSAGE_PATCH_COLUMNS = {
  parentId: 'parent_id',
  role: 'role',
  text: 'text',
  thinking: 'thinking',
  done: 'done',
  toolSteps: 'tool_steps_json',
  cardRefs: 'card_refs_json',
  attachments: 'attachments_json',
  usage: 'usage_json',
  error: 'error',
  occurredAt: 'occurred_at',
};

const JOB_PATCH_COLUMNS = {
  kind: 'kind',
  status: 'status',
  progress: 'progress_json',
  logRef: 'log_ref',
  heartbeatAt: 'heartbeat_at',
  error: 'error',
};

const JSON_PATCH_KEYS = new Set(['toolSteps', 'cardRefs', 'attachments', 'usage', 'progress']);

function parseJson(text, fallback) {
  if (typeof text !== 'string' || !text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function bindable(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function rowToMessage(row) {
  return {
    id: row.message_id,
    parentId: row.parent_id,
    role: row.role,
    text: row.text,
    thinking: row.thinking,
    done: Boolean(row.done),
    toolSteps: parseJson(row.tool_steps_json, []),
    cardRefs: parseJson(row.card_refs_json, []),
    attachments: parseJson(row.attachments_json, []),
    usage: parseJson(row.usage_json, null),
    error: row.error,
    occurredAt: row.occurred_at,
  };
}

function rowToCard(row) {
  return {
    cardId: row.card_id,
    seq: row.seq,
    kind: row.kind,
    channel: row.channel,
    envelope: parseJson(row.envelope_json, null),
    dataRef: row.data_ref,
    live: parseJson(row.live_json, null),
    protected: Boolean(row.protected),
    createdAt: row.created_at,
  };
}

function rowToJob(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    kind: row.kind,
    status: row.status,
    progress: parseJson(row.progress_json, null),
    logRef: row.log_ref,
    attachedAt: row.attached_at,
    heartbeatAt: row.heartbeat_at,
    error: row.error,
  };
}

function rowToIndex(row) {
  return {
    id: row.id,
    mode: row.mode,
    projectId: row.project_id,
    title: row.title,
    titleSource: row.title_source,
    pinned: Boolean(row.pinned),
    archived: Boolean(row.archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
  };
}

function likeNeedle(query) {
  return `%${String(query).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

function snippetOf(text, query) {
  const body = typeof text === 'string' ? text : '';
  const at = body.toLowerCase().indexOf(String(query).toLowerCase());
  const start = at < 0 ? 0 : Math.max(0, at - 20);
  return body.slice(start, start + 80);
}

class SessionStore {
  constructor({ dbPath }) {
    if (typeof dbPath !== 'string' || !dbPath.trim()) {
      throw new TypeError('session store dbPath is required');
    }
    this.dbPath = dbPath === ':memory:' ? dbPath : path.resolve(dbPath);
    if (this.dbPath !== ':memory:') fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
    this.closed = false;
  }

  createSession({ id, mode, projectId, title, now } = {}) {
    const snapshot = createSnapshot({ id, mode, projectId, title, now });
    const existing = this.#sessionRow(snapshot.id);
    if (existing) return this.getSession(snapshot.id);
    this.db.prepare(`
      INSERT INTO sessions (
        id, schema_version, mode, project_id, title, title_source,
        pinned, archived, created_at, updated_at, revision,
        current_id, workspace_json, viewport_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.id,
      bindable(snapshot.schemaVersion ?? SCHEMA_VERSION),
      snapshot.mode,
      snapshot.projectId,
      bindable(snapshot.title),
      bindable(snapshot.titleSource),
      bindable(snapshot.pinned),
      bindable(snapshot.archived),
      bindable(snapshot.createdAt),
      bindable(snapshot.updatedAt),
      bindable(snapshot.revision ?? 0),
      bindable(snapshot.currentId),
      JSON.stringify(snapshot.workspace ?? null),
      JSON.stringify(snapshot.viewport ?? null),
    );
    return this.getSession(snapshot.id);
  }

  getSession(id) {
    const row = this.#sessionRow(id);
    if (!row) return null;
    const messages = this.db
      .prepare('SELECT * FROM session_messages WHERE session_id = ? ORDER BY seq ASC')
      .all(row.id)
      .map(rowToMessage);
    const canvasCards = this.db
      .prepare('SELECT * FROM session_cards WHERE session_id = ? ORDER BY seq ASC')
      .all(row.id)
      .map(rowToCard);
    return normalizeSnapshot({
      schemaVersion: row.schema_version,
      id: row.id,
      mode: row.mode,
      projectId: row.project_id,
      title: row.title,
      titleSource: row.title_source,
      pinned: Boolean(row.pinned),
      archived: Boolean(row.archived),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: row.revision,
      messages,
      currentId: row.current_id,
      canvasCards,
      workspace: parseJson(row.workspace_json, undefined),
      viewport: parseJson(row.viewport_json, undefined),
      jobs: this.listJobs(row.id),
    });
  }

  listSessions({ mode, projectId, includeArchived, limit } = {}) {
    const where = [];
    const params = [];
    if (mode) {
      where.push('mode = ?');
      params.push(mode);
    }
    if (projectId) {
      where.push('project_id = ?');
      params.push(projectId);
    }
    if (!includeArchived) where.push('archived = 0');
    params.push(Number.isInteger(limit) && limit > 0 ? limit : 200);
    return this.db.prepare(`
      SELECT id, mode, project_id, title, title_source, pinned, archived,
             created_at, updated_at, revision
      FROM sessions
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `).all(...params).map(rowToIndex);
  }

  appendMessage(sessionId, message) {
    const row = this.#sessionRow(sessionId);
    if (!row) return null;
    const msg = normalizeMessage(message);
    const at = new Date().toISOString();
    const occurredAt = msg.occurredAt || at;
    return this.#tx(() => {
      const seq = this.db
        .prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM session_messages WHERE session_id = ?')
        .get(sessionId).next;
      const userCount = this.db
        .prepare("SELECT COUNT(*) AS count FROM session_messages WHERE session_id = ? AND role = 'user'")
        .get(sessionId).count;
      this.db.prepare(`
        INSERT INTO session_messages (
          session_id, message_id, parent_id, role, seq, text, thinking, done,
          tool_steps_json, card_refs_json, attachments_json, usage_json, error, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId,
        msg.id,
        bindable(msg.parentId),
        msg.role,
        seq,
        bindable(msg.text),
        bindable(msg.thinking),
        bindable(msg.done),
        JSON.stringify(msg.toolSteps ?? []),
        JSON.stringify(msg.cardRefs ?? []),
        JSON.stringify(msg.attachments ?? []),
        JSON.stringify(msg.usage ?? null),
        bindable(msg.error),
        occurredAt,
      );
      const autoTitle = msg.role === 'user' && userCount === 0 && row.title_source !== 'user'
        ? titleFrom(msg.text || '')
        : '';
      if (autoTitle) {
        this.db.prepare("UPDATE sessions SET title = ?, title_source = 'auto' WHERE id = ?")
          .run(autoTitle, sessionId);
      }
      this.db.prepare('UPDATE sessions SET current_id = ? WHERE id = ?').run(msg.id, sessionId);
      return { revision: this.#touch(sessionId, at), messageId: msg.id };
    });
  }

  updateMessage(sessionId, messageId, patch) {
    const target = this.db
      .prepare('SELECT message_id FROM session_messages WHERE session_id = ? AND message_id = ?')
      .get(sessionId, messageId);
    if (!target) return null;
    const sets = [];
    const params = [];
    for (const [key, column] of Object.entries(MESSAGE_PATCH_COLUMNS)) {
      if (!patch || !Object.prototype.hasOwnProperty.call(patch, key)) continue;
      sets.push(`${column} = ?`);
      params.push(JSON_PATCH_KEYS.has(key) ? JSON.stringify(patch[key] ?? null) : bindable(patch[key]));
    }
    const at = new Date().toISOString();
    return this.#tx(() => {
      if (sets.length) {
        this.db.prepare(`
          UPDATE session_messages SET ${sets.join(', ')}
          WHERE session_id = ? AND message_id = ?
        `).run(...params, sessionId, messageId);
      }
      return { revision: this.#touch(sessionId, at), messageId };
    });
  }

  putCards(sessionId, cards) {
    if (!this.#sessionRow(sessionId)) return null;
    // seq는 넘어온 배열 순서로 다시 매긴다. 캔버스 스택 자체가 순서의 진실이다.
    const list = (Array.isArray(cards) ? cards : []).map((card) => normalizeCard(card));
    const at = new Date().toISOString();
    return this.#tx(() => {
      const stmt = this.db.prepare(`
        INSERT INTO session_cards (
          session_id, card_id, seq, kind, channel, envelope_json,
          data_ref, live_json, protected, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (session_id, card_id) DO UPDATE SET
          seq = excluded.seq, kind = excluded.kind, channel = excluded.channel,
          envelope_json = excluded.envelope_json, data_ref = excluded.data_ref,
          live_json = excluded.live_json, protected = excluded.protected
      `);
      list.forEach((card, index) => {
        stmt.run(
          sessionId,
          card.cardId,
          index,
          bindable(card.kind),
          bindable(card.channel),
          JSON.stringify(card.envelope ?? null),
          bindable(card.dataRef),
          JSON.stringify(card.live ?? null),
          bindable(card.protected),
          card.createdAt || at,
        );
      });
      return { revision: this.#touch(sessionId, at) };
    });
  }

  removeCard(sessionId, cardId) {
    if (!this.#sessionRow(sessionId)) return false;
    const at = new Date().toISOString();
    return this.#tx(() => {
      const changes = this.db
        .prepare('DELETE FROM session_cards WHERE session_id = ? AND card_id = ?')
        .run(sessionId, cardId).changes;
      this.#touch(sessionId, at);
      return changes > 0;
    });
  }

  saveWorkspace(sessionId, workspace) {
    if (!this.#sessionRow(sessionId)) return null;
    const at = new Date().toISOString();
    return this.#tx(() => {
      this.db.prepare('UPDATE sessions SET workspace_json = ? WHERE id = ?')
        .run(JSON.stringify(workspace ?? null), sessionId);
      return { revision: this.#touch(sessionId, at) };
    });
  }

  saveViewport(sessionId, viewport) {
    // 스크롤 위치는 충돌 판정과 무관하므로 revision을 올리지 않는다.
    const changes = this.db.prepare('UPDATE sessions SET viewport_json = ? WHERE id = ?')
      .run(JSON.stringify(viewport ?? null), sessionId).changes;
    return changes > 0;
  }

  setTitle(sessionId, title, source = 'user') {
    const row = this.#sessionRow(sessionId);
    if (!row) return false;
    if (source !== 'user' && row.title_source === 'user') return false;
    const at = new Date().toISOString();
    return this.#tx(() => {
      this.db.prepare('UPDATE sessions SET title = ?, title_source = ? WHERE id = ?')
        .run(bindable(title), source, sessionId);
      this.#touch(sessionId, at);
      return true;
    });
  }

  setPinned(sessionId, value) {
    return this.#setFlag(sessionId, 'pinned', value);
  }

  setArchived(sessionId, value) {
    return this.#setFlag(sessionId, 'archived', value);
  }

  attachJob(sessionId, job) {
    if (!this.#sessionRow(sessionId)) return null;
    const source = job && typeof job === 'object' ? job : {};
    if (!source.id) return null;
    const at = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO session_jobs (
        id, session_id, kind, status, progress_json, log_ref, attached_at, heartbeat_at, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        session_id = excluded.session_id, kind = excluded.kind, status = excluded.status,
        progress_json = excluded.progress_json, log_ref = excluded.log_ref,
        heartbeat_at = excluded.heartbeat_at, error = excluded.error
    `).run(
      source.id,
      sessionId,
      bindable(source.kind),
      bindable(source.status),
      JSON.stringify(source.progress ?? null),
      bindable(source.logRef),
      source.attachedAt || at,
      source.heartbeatAt || at,
      bindable(source.error),
    );
    return this.#jobById(source.id);
  }

  updateJob(jobId, patch) {
    if (!this.#jobById(jobId)) return false;
    const sets = [];
    const params = [];
    for (const [key, column] of Object.entries(JOB_PATCH_COLUMNS)) {
      if (!patch || !Object.prototype.hasOwnProperty.call(patch, key)) continue;
      sets.push(`${column} = ?`);
      params.push(JSON_PATCH_KEYS.has(key) ? JSON.stringify(patch[key] ?? null) : bindable(patch[key]));
    }
    if (!sets.length) return false;
    this.db.prepare(`UPDATE session_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params, jobId);
    return true;
  }

  listJobs(sessionId) {
    return this.db
      .prepare('SELECT * FROM session_jobs WHERE session_id = ? ORDER BY attached_at ASC, id ASC')
      .all(sessionId)
      .map(rowToJob);
  }

  reconcileStaleJobs({ staleMs = 60_000, now } = {}) {
    const nowMs = now ? Date.parse(now) : Date.now();
    const cutoff = new Date(nowMs - staleMs).toISOString();
    return this.db.prepare(`
      UPDATE session_jobs SET status = 'interrupted'
      WHERE status = 'running' AND COALESCE(heartbeat_at, attached_at) < ?
    `).run(cutoff).changes;
  }

  searchMessages(query, { limit } = {}) {
    if (typeof query !== 'string' || !query) return [];
    const rows = this.db.prepare(`
      SELECT m.session_id, m.message_id, m.text, s.title, s.mode
      FROM session_messages m
      JOIN sessions s ON s.id = m.session_id
      WHERE m.text LIKE ? ESCAPE '\\'
      ORDER BY m.occurred_at DESC, m.seq DESC
      LIMIT ?
    `).all(likeNeedle(query), Number.isInteger(limit) && limit > 0 ? limit : 50);
    return rows.map((row) => ({
      sessionId: row.session_id,
      messageId: row.message_id,
      title: row.title,
      mode: row.mode,
      snippet: snippetOf(row.text, query),
    }));
  }

  deleteSession(id) {
    return this.#tx(() => {
      this.db.prepare('DELETE FROM session_messages WHERE session_id = ?').run(id);
      this.db.prepare('DELETE FROM session_cards WHERE session_id = ?').run(id);
      this.db.prepare('DELETE FROM session_jobs WHERE session_id = ?').run(id);
      return this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id).changes > 0;
    });
  }

  close() {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  #sessionRow(id) {
    if (typeof id !== 'string' || !id) return null;
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) || null;
  }

  #jobById(jobId) {
    if (typeof jobId !== 'string' || !jobId) return null;
    const row = this.db.prepare('SELECT * FROM session_jobs WHERE id = ?').get(jobId);
    return row ? rowToJob(row) : null;
  }

  #setFlag(sessionId, column, value) {
    if (!this.#sessionRow(sessionId)) return false;
    const at = new Date().toISOString();
    return this.#tx(() => {
      this.db.prepare(`UPDATE sessions SET ${column} = ? WHERE id = ?`).run(value ? 1 : 0, sessionId);
      this.#touch(sessionId, at);
      return true;
    });
  }

  #touch(sessionId, at) {
    this.db.prepare('UPDATE sessions SET revision = revision + 1, updated_at = ? WHERE id = ?')
      .run(at, sessionId);
    return this.db.prepare('SELECT revision FROM sessions WHERE id = ?').get(sessionId).revision;
  }

  #tx(run) {
    this.db.exec('BEGIN');
    try {
      const result = run();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

function createSessionStore(options) {
  return new SessionStore(options);
}

module.exports = { SessionStore, createSessionStore };
