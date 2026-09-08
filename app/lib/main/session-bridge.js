// 저장 "타이밍" 정책의 단일 소유자. session-store.js는 어떻게 쓰는가만 알고,
// 언제 쓰는가 — 제출은 즉시, 스트리밍 델타는 5초·2KB 저널, 카드·워크스페이스·뷰포트는
// wait+maxWait 디바운스, 창 blur·모드 전환·종료에는 flush — 는 전부 여기서 정한다.
// 델타마다 디스크를 때리면 감당이 안 되고, 턴 끝에만 쓰면 프로세스가 죽을 때 통째로 잃기 때문이다(명세 4절).

'use strict';

const { isDeepStrictEqual } = require('node:util');

const JOURNAL_INTERVAL_MS = 5000;
const JOURNAL_BYTES = 2048;
const DEBOUNCE = Object.freeze({
  cards: Object.freeze({ wait: 200, max: 600 }),
  workspace: Object.freeze({ wait: 300, max: 1000 }),
  viewport: Object.freeze({ wait: 400, max: 2000 }),
});

function asText(value) {
  return typeof value === 'string' ? value : '';
}

class SessionBridge {
  constructor({ store, now, setTimer, clearTimer, log, onRunState }) {
    if (!store) throw new TypeError('session bridge store is required');
    this.store = store;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.log = log;
    // 세션의 대표 실행 상태가 바뀔 때마다 { sessionId, runState }로 알린다(39번 보드의
    // 스피너·점). 누가 듣는지는 모른다 — main이 사이드바로 흘린다.
    this.onRunState = typeof onRunState === 'function' ? onRunState : null;
    this.buffers = new Map();
    this.pending = new Map();
    this.savedWorkspace = new Map();
  }

  // 제출 경로(ensureSession·recordUserMessage)는 감싸지 않는다.
  // 여기서 실패하면 턴을 시작하지 않고 이유를 보여야 한다(명세 4절).
  ensureSession({ id, mode, projectId, title } = {}) {
    const existing = this.store.getSession(id);
    if (existing) return existing;
    return this.store.createSession({ id, mode, projectId, title, now: this.now() });
  }

  recordUserMessage({ sessionId, messageId, text, occurredAt, attachments } = {}) {
    return this.store.appendMessage(sessionId, {
      id: messageId,
      role: 'user',
      text: asText(text),
      done: true,
      attachments: Array.isArray(attachments) ? attachments : [],
      occurredAt: occurredAt || this.now(),
    });
  }

  beginAssistant({ sessionId, messageId, parentId } = {}) {
    this.#buffer(sessionId, messageId);
    const appended = this.#guard(() => this.store.appendMessage(sessionId, {
      id: messageId,
      parentId,
      role: 'assistant',
      text: '',
      done: false,
      occurredAt: this.now(),
    }));
    // 답변 턴도 실행이다 — 다른 대화로 옮겨가 있어도 이 행에 스피너가 돈다(39번 보드).
    this.attachJob({ sessionId, job: { id: messageId, kind: 'chat.turn', status: 'running' } });
    return appended;
  }

  // 답변 턴의 모든 반환 경로가 같은 수명주기를 쓴다. 빠른 경로가 모델 경로보다
  // 먼저 return하거나 예외를 던져도 placeholder와 chat.turn job을 끝낸다.
  // 본문이 finishAssistant를 직접 호출한 경우에는 버퍼가 이미 사라졌으므로
  // 사용량·thinking·최종 상태를 다시 덮어쓰지 않는다.
  async runAssistantTurn({ sessionId, messageId, parentId, run } = {}) {
    this.beginAssistant({ sessionId, messageId, parentId });
    try {
      const result = await run();
      if (this.buffers.has(`${sessionId}:${messageId}`)) {
        this.finishAssistant({
          sessionId,
          messageId,
          text: result && typeof result.answerText === 'string' ? result.answerText : undefined,
          error: result && result.ok === false ? String(result.error || '') : null,
          interrupted: Boolean(result && result.ok === false),
        });
      }
      return result;
    } catch (error) {
      if (this.buffers.has(`${sessionId}:${messageId}`)) {
        this.finishAssistant({ sessionId, messageId, error, interrupted: true });
      }
      throw error;
    }
  }

  journalDelta({ sessionId, messageId, text, thinking } = {}) {
    const key = `${sessionId}:${messageId}`;
    const buf = this.buffers.get(key);
    if (!buf) {
      // finishAssistant가 버퍼를 지운 뒤에 온 늦은 델타. 최종본을 덮어쓰지 않는다.
      this.log('session-bridge', `late delta ignored ${key}`);
      return false;
    }
    const deltaText = asText(text);
    const deltaThinking = asText(thinking);
    buf.text += deltaText;
    buf.thinking += deltaThinking;
    buf.bytes += Buffer.byteLength(deltaText) + Buffer.byteLength(deltaThinking);
    if (buf.bytes >= JOURNAL_BYTES) {
      this.#journal(key);
      return true;
    }
    if (!buf.timer) {
      buf.timer = this.setTimer(() => {
        buf.timer = null;
        this.#journal(key);
      }, JOURNAL_INTERVAL_MS);
    }
    return true;
  }

  recordToolStep({ sessionId, messageId, step } = {}) {
    const buf = this.#buffer(sessionId, messageId);
    buf.toolSteps.push(step);
    // 툴 이벤트는 즉시 쓴다. 청크는 저널로 미루지만 사건은 미루지 않는다.
    return this.#guard(() => this.store.updateMessage(sessionId, messageId, {
      toolSteps: buf.toolSteps.slice(),
    }));
  }

  finishAssistant({ sessionId, messageId, text, thinking, usage, error, interrupted } = {}) {
    const key = `${sessionId}:${messageId}`;
    const buf = this.buffers.get(key);
    if (buf && buf.timer) this.clearTimer(buf.timer);
    this.buffers.delete(key);
    const patch = {
      text: typeof text === 'string' ? text : (buf ? buf.text : ''),
      thinking: typeof thinking === 'string' ? thinking : (buf ? buf.thinking : ''),
      done: true,
      usage: usage ?? null,
      error: error ? String(error.message || error) : (interrupted ? 'interrupted' : null),
    };
    if (buf && buf.toolSteps.length) patch.toolSteps = buf.toolSteps.slice();
    const updated = this.#guard(() => this.store.updateMessage(sessionId, messageId, patch));
    // 오류면 빨강, 그 외(정상·사용자 중단)는 회색 — 중단은 사용자의 뜻이지 실패가 아니다.
    this.updateJob({ jobId: messageId, patch: { status: error ? 'failed' : 'done', error: patch.error } });
    return updated;
  }

  saveCards({ sessionId, cards } = {}) {
    return this.#debounce('cards', sessionId, Array.isArray(cards) ? cards : []);
  }

  saveWorkspace({ sessionId, workspace } = {}) {
    // 같은 값을 다시 쓰면 revision만 헛돌아 충돌 판정이 거짓말을 한다.
    if (!this.pending.has(`${sessionId}:workspace`)
      && isDeepStrictEqual(workspace, this.savedWorkspace.get(sessionId))) return false;
    return this.#debounce('workspace', sessionId, workspace);
  }

  saveViewport({ sessionId, viewport } = {}) {
    return this.#debounce('viewport', sessionId, viewport);
  }

  flush(sessionId) {
    for (const [key, buf] of [...this.buffers]) {
      if (sessionId && buf.sessionId !== sessionId) continue;
      this.#journal(key);
    }
    for (const [key, entry] of [...this.pending]) {
      if (sessionId && entry.sessionId !== sessionId) continue;
      this.#commit(key);
    }
  }

  flushSync() {
    try {
      this.flush();
    } catch (err) {
      this.log('session-bridge', err);
    }
  }

  // ---------- 실행(job) — 39번 보드 ----------
  // 실행 레코드는 즉시 쓴다(디바운스 없음). 백테스트 run·백필·답변 턴이 다 여기로 온다.
  // 상태가 바뀌면 그 세션의 대표 상태를 다시 계산해 알린다.
  attachJob({ sessionId, job } = {}) {
    const attached = this.#guard(() => this.store.attachJob(sessionId, job));
    if (attached) this.#notifyRunState(sessionId);
    return attached || null;
  }

  updateJob({ jobId, patch } = {}) {
    const job = this.#guard(() => this.store.getJob(jobId));
    if (!job) return false;
    const changed = this.#guard(() => this.store.updateJob(jobId, patch));
    if (changed && patch && Object.prototype.hasOwnProperty.call(patch, 'status') && patch.status !== job.status) {
      this.#notifyRunState(job.sessionId);
    }
    return Boolean(changed);
  }

  runStates() {
    return this.#guard(() => this.store.runStates()) || {};
  }

  #notifyRunState(sessionId) {
    if (!this.onRunState) return;
    const runState = this.runStates()[sessionId] || null;
    try { this.onRunState({ sessionId, runState }); } catch (error) { if (this.log) this.log('session run-state notify', error); }
  }

  load(sessionId) {
    return this.store.getSession(sessionId);
  }

  pendingCount() {
    let count = this.pending.size;
    for (const buf of this.buffers.values()) if (buf.bytes > 0) count += 1;
    return count;
  }

  #buffer(sessionId, messageId) {
    const key = `${sessionId}:${messageId}`;
    let buf = this.buffers.get(key);
    if (!buf) {
      buf = { sessionId, messageId, text: '', thinking: '', toolSteps: [], bytes: 0, timer: null };
      this.buffers.set(key, buf);
    }
    return buf;
  }

  #journal(key) {
    const buf = this.buffers.get(key);
    if (!buf || buf.bytes === 0) return;
    if (buf.timer) {
      this.clearTimer(buf.timer);
      buf.timer = null;
    }
    buf.bytes = 0;
    // 누적 전체를 같은 행에 다시 쓴다. 프로세스가 죽어도 마지막 저널까지는 남는다.
    this.#guard(() => this.store.updateMessage(buf.sessionId, buf.messageId, {
      text: buf.text,
      thinking: buf.thinking,
    }));
  }

  #debounce(kind, sessionId, payload) {
    const spec = DEBOUNCE[kind];
    const key = `${sessionId}:${kind}`;
    const at = this.#nowMs();
    let entry = this.pending.get(key);
    if (!entry) {
      entry = { kind, sessionId, payload, firstAt: at, timer: null };
      this.pending.set(key, entry);
    } else {
      entry.payload = payload;
      if (entry.timer) this.clearTimer(entry.timer);
      entry.timer = null;
    }
    // maxWait: 호출이 계속 들어와도 첫 호출로부터 max를 넘기지 않는다.
    const remaining = Math.max(0, entry.firstAt + spec.max - at);
    entry.timer = this.setTimer(() => {
      entry.timer = null;
      this.#commit(key);
    }, Math.min(spec.wait, remaining));
    return true;
  }

  #commit(key) {
    const entry = this.pending.get(key);
    if (!entry) return;
    if (entry.timer) this.clearTimer(entry.timer);
    this.pending.delete(key);
    this.#guard(() => {
      if (entry.kind === 'cards') return this.store.putCards(entry.sessionId, entry.payload);
      if (entry.kind === 'workspace') {
        const result = this.store.saveWorkspace(entry.sessionId, entry.payload);
        this.savedWorkspace.set(entry.sessionId, entry.payload);
        return result;
      }
      return this.store.saveViewport(entry.sessionId, entry.payload);
    });
  }

  #nowMs() {
    const ms = Date.parse(this.now());
    return Number.isFinite(ms) ? ms : Date.now();
  }

  #guard(run) {
    try {
      return run();
    } catch (err) {
      // 저장 실패가 턴을 죽이면 안 되지만, 조용히 잃어서도 안 된다.
      this.log('session-bridge', err);
      return null;
    }
  }
}

function createSessionBridge({
  store,
  now = () => new Date().toISOString(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  log = () => {},
  onRunState,
} = {}) {
  return new SessionBridge({ store, now, setTimer, clearTimer, log, onRunState });
}

module.exports = { createSessionBridge, JOURNAL_INTERVAL_MS, JOURNAL_BYTES, DEBOUNCE };
