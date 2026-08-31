'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS chat_messages (
    message_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    sync_state TEXT NOT NULL DEFAULT 'pending'
      CHECK (sync_state IN ('pending', 'synced')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    synced_at TEXT,
    last_attempt_at TEXT,
    last_error_code TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_chat_messages_pending
    ON chat_messages(sync_state, occurred_at, message_id);
`;

class ChatHistoryStore {
  constructor({ dbPath }) {
    if (typeof dbPath !== 'string' || !dbPath.trim()) {
      throw new TypeError('chat history dbPath is required');
    }
    this.dbPath = dbPath === ':memory:' ? dbPath : path.resolve(dbPath);
    if (this.dbPath !== ':memory:') fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
    this.closed = false;
  }

  persistMessage({ messageId, conversationId, role, text, occurredAt }) {
    this.#assertOpen();
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO chat_messages (
        message_id, conversation_id, role, text, occurred_at,
        sync_state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(messageId, conversationId, role, text, occurredAt, now, now);
    return result.changes === 1;
  }

  getMessage(messageId) {
    this.#assertOpen();
    return this.db.prepare('SELECT * FROM chat_messages WHERE message_id = ?').get(messageId) || null;
  }

  getPendingMessages({ limit = 1000 } = {}) {
    this.#assertOpen();
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 1000;
    return this.db.prepare(`
      SELECT * FROM chat_messages
      WHERE sync_state = 'pending'
      ORDER BY occurred_at ASC, message_id ASC
      LIMIT ?
    `).all(safeLimit);
  }

  countPendingMessages() {
    this.#assertOpen();
    return this.db.prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE sync_state = 'pending'").get().count;
  }

  markSynced(messageId, syncedAt = new Date().toISOString()) {
    this.#assertOpen();
    const result = this.db.prepare(`
      UPDATE chat_messages
      SET text = '', sync_state = 'synced', synced_at = ?, last_attempt_at = ?,
          last_error_code = NULL, updated_at = ?
      WHERE message_id = ? AND sync_state = 'pending'
    `).run(syncedAt, syncedAt, syncedAt, messageId);
    return result.changes === 1;
  }

  markPendingAttempt(messageId, errorCode, attemptedAt = new Date().toISOString()) {
    this.#assertOpen();
    this.db.prepare(`
      UPDATE chat_messages
      SET last_attempt_at = ?, last_error_code = ?, updated_at = ?
      WHERE message_id = ? AND sync_state = 'pending'
    `).run(attemptedAt, String(errorCode || 'unknown'), attemptedAt, messageId);
  }

  purgePendingMessages() {
    this.#assertOpen();
    return this.db.prepare("DELETE FROM chat_messages WHERE sync_state = 'pending'").run().changes;
  }

  close() {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  #assertOpen() {
    if (this.closed) throw new Error('chat history store is closed');
  }
}

module.exports = { ChatHistoryStore };
