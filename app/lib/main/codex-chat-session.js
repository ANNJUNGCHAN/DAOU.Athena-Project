'use strict';

const crypto = require('node:crypto');
const { CodexAppServerSession } = require('./codex-app-server-session');

const DEFAULT_TIMEOUT_MS = 180_000;
const CONVERSATION_ID = 'legacy-chat';

function errorText(error, fallback) {
  if (error?.message) return String(error.message);
  if (error != null && String(error)) return String(error);
  return fallback;
}

function providerError(error) {
  let current = error;
  let coded = null;
  let actionable = null;
  const seen = new Set();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (!coded && current.code) coded = current;
    if (current.actionNeeded === true) actionable = current;
    current = current.cause;
  }
  return actionable || coded || error;
}

function sameConfig(left, right) {
  return Boolean(left && right)
    && left.model === right.model
    && left.effort === right.effort
    && left.identityKey === right.identityKey
    && left.securityKey === right.securityKey;
}

function legacyEvent(type, payload) {
  if (type === 'text_delta') {
    return { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: payload.text } } };
  }
  if (type === 'thinking_delta') {
    return { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: payload.text } } };
  }
  if (type === 'tool_started') {
    return { type: 'assistant', message: { content: [{
      type: 'tool_use', id: payload.toolUseId,
      name: payload.providerToolName || payload.canonicalToolName,
      input: payload.input || {},
    }] } };
  }
  if (type === 'tool_completed') {
    return { type: 'user', message: { content: [{
      type: 'tool_result', tool_use_id: payload.toolUseId,
      content: payload.content, is_error: payload.isError === true,
    }] } };
  }
  return { type: 'system', subtype: `codex_${type}`, payload };
}

class CodexChatSession {
  constructor({
    cwd,
    runtime,
    generationContextFactory,
    developerInstructions = '',
    expectedMcpServers,
    requiredMcpServer,
    mcpAudit,
    appVersion = '0.1.0',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    nowFn = Date.now,
    uuidFn = crypto.randomUUID,
    sessionFactory = (options) => new CodexAppServerSession(options),
  } = {}) {
    if (!cwd) throw new TypeError('cwd is required');
    if (!runtime || typeof runtime.spawnGenerationAppServer !== 'function') {
      throw new TypeError('runtime.spawnGenerationAppServer is required');
    }
    if (typeof generationContextFactory !== 'function') {
      throw new TypeError('generationContextFactory is required');
    }
    this._cwd = cwd;
    this._runtime = runtime;
    this._generationContextFactory = generationContextFactory;
    this._developerInstructions = developerInstructions;
    this._expectedMcpServers = expectedMcpServers;
    this._requiredMcpServer = requiredMcpServer;
    this._mcpAudit = mcpAudit;
    this._appVersion = appVersion;
    this._timeoutMs = timeoutMs;
    this._now = nowFn;
    this._uuid = uuidFn;
    this._sessionFactory = sessionFactory;
    this._session = null;
    this._startPromise = null;
    this._config = null;
    this._lastSessionId = null;
    this._blankWarm = false;
    this._warmed = false;
    this._stopped = false;
    this._tail = Promise.resolve();
    this._activeTurnId = null;
  }

  lastSessionId() { return this._lastSessionId; }

  snapshot() {
    const inner = this._session?.snapshot?.() || null;
    let state = 'down';
    if (inner && inner.state !== 'stopped' && inner.state !== 'failed') {
      state = this._activeTurnId ? 'busy' : this._warmed && inner.state === 'ready' ? 'idle' : 'warming';
    }
    return {
      running: Boolean(inner && inner.state !== 'stopped' && inner.state !== 'failed'),
      state,
      pid: inner?.pid ?? null,
      warm: state === 'idle',
      lineage: this._lastSessionId,
      config: this._config ? { model: this._config.model, effort: this._config.effort } : { model: null, effort: null },
      lastSessionId: this._lastSessionId,
      stopped: this._stopped,
      conversationThreads: inner?.conversationThreads || {},
    };
  }

  warm(options = {}) {
    return this._enqueue(() => this._warm(options));
  }

  run(options = {}) {
    return this._enqueue(() => this._run(options));
  }

  stop(reason = null) {
    this._stopped = true;
    const session = this._session;
    this._session = null;
    this._startPromise = null;
    this._activeTurnId = null;
    this._warmed = false;
    if (!session) return Promise.resolve(this.snapshot());
    return Promise.resolve(session.stop(reason)).then(() => this.snapshot());
  }

  close(reason) { return this.stop(reason); }
  dispose(reason) { return this.stop(reason); }

  _enqueue(task) {
    const result = this._tail.then(task, task);
    this._tail = result.catch(() => {});
    return result;
  }

  _normalizedConfig({ model = null, effort = null, identityKey = null, securityKey = null } = {}) {
    return { model: model || null, effort: effort || null, identityKey, securityKey };
  }

  async _warm(options) {
    if (this._stopped) throw new Error('Codex 채팅 세션이 종료됐다');
    const config = this._normalizedConfig(options);
    const requested = options.resumeSessionId === undefined ? this._lastSessionId : (options.resumeSessionId || null);
    await this._ensureSession(config, requested);
    const warmed = await this._session.warmConversation(CONVERSATION_ID);
    this._lastSessionId = warmed.threadId;
    this._blankWarm = requested === null;
    this._warmed = true;
    return this.snapshot();
  }

  async _ensureSession(config, resumeSessionId) {
    const compatible = this._session && sameConfig(this._config, config)
      && (resumeSessionId === this._lastSessionId || (resumeSessionId === null && this._blankWarm));
    if (compatible) {
      await this._startPromise;
      return false;
    }
    if (this._session) await this._session.stop();
    if (this._stopped) throw new Error('Codex 채팅 세션이 종료됐다');
    const generationContext = this._generationContextFactory({
      identityKey: config.identityKey,
      securityKey: config.securityKey,
    });
    const desired = {
      model: config.model,
      effort: config.effort,
      cwd: this._cwd,
      developerInstructions: this._developerInstructions,
      conversationThreads: resumeSessionId ? { [CONVERSATION_ID]: resumeSessionId } : undefined,
      expectedMcpServers: this._expectedMcpServers,
      requiredMcpServer: this._requiredMcpServer,
      mcpAudit: this._mcpAudit,
    };
    this._session = this._sessionFactory({ runtime: this._runtime, appVersion: this._appVersion });
    this._config = config;
    this._lastSessionId = resumeSessionId;
    this._blankWarm = false;
    this._warmed = false;
    this._startPromise = this._session.start(desired, generationContext);
    await this._startPromise;
    return true;
  }

  async _run({
    prompt,
    model = null,
    effort = null,
    resumeSessionId,
    identityKey = null,
    securityKey = null,
    timeoutMs = this._timeoutMs,
    signal,
    onSpawn,
    onEvent,
    onTextDelta,
    onThinkingDelta,
    onCanvasResult,
  } = {}) {
    const startedAt = this._now();
    if (!prompt || !String(prompt).trim()) return this._failure('질의가 비어 있다', startedAt);
    if (this._stopped) return this._failure('Codex 채팅 세션이 종료됐다', startedAt, { aborted: true });
    if (signal?.aborted) return this._failure(signal.reason || '사용자 중단', startedAt, { aborted: true });

    let config;
    try {
      config = this._normalizedConfig({ model, effort, identityKey, securityKey });
    } catch (error) {
      return this._failure(error, startedAt);
    }
    const requested = resumeSessionId === undefined ? this._lastSessionId : (resumeSessionId || null);
    let spawnedFresh;
    try {
      spawnedFresh = await this._ensureSession(config, requested);
    } catch (error) {
      return this._failure(error, startedAt, { spawnedFresh: true });
    }
    if (requested === null && !this._blankWarm) {
      try {
        const warmed = await this._session.warmConversation(CONVERSATION_ID);
        this._lastSessionId = warmed.threadId;
        this._blankWarm = true;
        this._warmed = true;
      } catch (error) {
        return this._failure(error, startedAt, { spawnedFresh });
      }
    }

    const turnId = this._uuid();
    this._activeTurnId = turnId;
    let firstEventMs = null;
    let firstTextMs = null;
    const markEvent = () => {
      if (firstEventMs === null) firstEventMs = Math.max(0, this._now() - startedAt);
    };
    const turnContext = {
      emit: (type, payload) => {
        markEvent();
        if (type === 'text_delta') {
          if (firstTextMs === null) firstTextMs = Math.max(0, this._now() - startedAt);
          onTextDelta?.(payload.text);
        } else if (type === 'thinking_delta') onThinkingDelta?.(payload.text);
        else if (type === 'canvas_result') onCanvasResult?.(payload);
        onEvent?.(legacyEvent(type, payload));
      },
    };
    const cancel = (reason = '사용자 중단') => this._session?.interrupt(turnId, reason);
    onSpawn?.({ pid: this._session.snapshot().pid ?? null, kill: () => cancel('user') });
    const onAbort = () => { void cancel(signal.reason || 'abort'); };
    signal?.addEventListener('abort', onAbort, { once: true });

    let timer = null;
    const timeout = new Promise((resolve) => {
      if (!(timeoutMs > 0)) return;
      timer = setTimeout(() => {
        void cancel('timeout');
        resolve({ timeout: true });
      }, timeoutMs);
    });
    const turnPromise = this._session.sendTurn({
      conversationId: CONVERSATION_ID,
      turnId,
      userText: String(prompt),
    }, turnContext).then((result) => ({ result }), (error) => ({ error }));
    const outcome = await Promise.race([turnPromise, timeout]);
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    this._activeTurnId = null;

    if (outcome?.timeout) return this._failure(`왕복 타임아웃(${Math.round(timeoutMs / 1000)}s)`, startedAt, {
      timedOut: true, submitted: true, spawnedFresh, firstEventMs, firstTextMs,
    });
    if (outcome?.error) return this._failure(outcome.error, startedAt, {
      submitted: true, spawnedFresh, firstEventMs, firstTextMs,
      aborted: signal?.aborted === true || outcome.error?.code === 'CODEX_STOPPED',
    });
    if (outcome.result.status !== 'completed') return this._failure('Codex 턴이 중단됐다', startedAt, {
      submitted: true, spawnedFresh, firstEventMs, firstTextMs, aborted: true,
    });

    const finalText = outcome.result.finalText;
    const threadId = outcome.result.providerBinding.threadId;
    this._lastSessionId = threadId;
    this._blankWarm = false;
    const finalResult = {
      type: 'result', subtype: 'success', is_error: false,
      result: finalText, session_id: threadId, usage: outcome.result.usage,
    };
    onEvent?.(finalResult);
    return {
      ok: true, submitted: true, exitCode: null, timedOut: false, aborted: false,
      stdoutCapped: false, error: null, finalResult, stderr: '', diagnostics: null,
      firstEventMs, firstTextMs, totalMs: Math.max(0, this._now() - startedAt), spawnedFresh,
      metrics: { firstEventMs, firstTextMs, totalMs: Math.max(0, this._now() - startedAt), spawnedFresh },
    };
  }

  _failure(error, startedAt, extras = {}) {
    const totalMs = Math.max(0, this._now() - startedAt);
    const source = providerError(error);
    const code = source?.code || error?.code || null;
    return {
      ok: false, submitted: extras.submitted === true, exitCode: null,
      timedOut: extras.timedOut === true, aborted: extras.aborted === true,
      stdoutCapped: false, error: errorText(source, errorText(error, 'Codex 채팅 턴이 실패했다')),
      code, errorCode: code,
      actionNeeded: source?.actionNeeded === true,
      retryable: typeof source?.retryable === 'boolean' ? source.retryable : null,
      finalResult: null, stderr: '', diagnostics: null,
      firstEventMs: extras.firstEventMs ?? null, firstTextMs: extras.firstTextMs ?? null,
      totalMs, spawnedFresh: extras.spawnedFresh === true,
      metrics: {
        firstEventMs: extras.firstEventMs ?? null,
        firstTextMs: extras.firstTextMs ?? null,
        totalMs,
        spawnedFresh: extras.spawnedFresh === true,
      },
    };
  }
}

function createCodexChatSession(options) {
  return new CodexChatSession(options);
}

module.exports = {
  CONVERSATION_ID,
  CodexChatSession,
  createCodexChatSession,
  legacyEvent,
  providerError,
};
