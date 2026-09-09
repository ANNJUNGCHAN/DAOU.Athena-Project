'use strict';

const { spawn } = require('child_process');
const { StreamJsonSession } = require('./stream-json-parser');
const { terminateTree } = require('./proc-utils');
const { getGrokBin } = require('./grok-bin');
const { assertSessionStopsSucceeded } = require('./provider-session-shutdown');

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_RPC_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_LINE_BYTES = 1_000_000;
const DEFAULT_MAX_STDOUT_BYTES = 5_000_000;
const DEFAULT_MAX_ERROR_BYTES = 16_000;

function buildGrokAcpArgs({
  model = null,
  effort = null,
  profilePath = null,
  trustProjectFolder = false,
} = {}) {
  const args = trustProjectFolder ? ['--trust', 'agent'] : ['agent'];
  if (model) args.push('--model', model);
  if (effort) args.push('--reasoning-effort', effort);
  if (profilePath) args.push('--agent-profile', profilePath);
  args.push('--no-leader');
  args.push('stdio');
  return args;
}

function boundedText(value, maxBytes = DEFAULT_MAX_ERROR_BYTES) {
  const text = String(value == null ? '' : value).trim();
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  return Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8') + '\u2026';
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (content && typeof content.text === 'string') return content.text;
  return '';
}

function toolId(update) {
  return update.toolCallId || update.tool_call_id || update.id || null;
}

function toolName(update) {
  const name = update.toolName || update.tool_name || update.name || update.title || 'tool';
  return name === 'athena_render_canvas' ? 'athena__athena_render_canvas' : name;
}

function toolResultContent(update) {
  const structured = update.structuredContent ?? update.structured_content;
  if (structured !== undefined) return JSON.stringify(structured);
  if (typeof update.content === 'string') return update.content;
  if (Array.isArray(update.content)) {
    const blocks = update.content.map((entry) => entry && entry.content ? entry.content : entry);
    const text = blocks.map(contentText).filter(Boolean).join('\n');
    return text || JSON.stringify(blocks);
  }
  if (update.content != null) return JSON.stringify(update.content);
  const raw = update.rawOutput ?? update.raw_output;
  if (raw && raw.type === 'MCP' && raw.output && typeof raw.output === 'object') {
    const okay = raw.output.OkayOutput;
    if (typeof okay === 'string') return okay;
    if (okay !== undefined) return JSON.stringify(okay);
  }
  if (raw && typeof raw.content === 'string') return raw.content;
  return raw == null ? '' : JSON.stringify(raw);
}

function rawOutputIsError(update) {
  const raw = update.rawOutput ?? update.raw_output;
  return !!(raw && raw.type === 'MCP'
    && (!raw.output || typeof raw.output !== 'object'
      || !Object.prototype.hasOwnProperty.call(raw.output, 'OkayOutput')));
}

function acpUpdateToEvents(update) {
  if (!update || typeof update !== 'object') return [];
  const kind = update.sessionUpdate || update.session_update;
  if (kind === 'agent_message_chunk') {
    const text = contentText(update.content);
    return text ? [{
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    }] : [];
  }
  if (kind === 'agent_thought_chunk') {
    const thinking = contentText(update.content);
    return thinking ? [{
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } },
    }] : [];
  }
  if (kind === 'tool_call') {
    const id = toolId(update);
    if (!id) return [];
    return [{
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id, name: toolName(update), input: update.rawInput || update.raw_input || update.input || {} }] },
    }];
  }
  if (kind === 'tool_call_update') {
    const id = toolId(update);
    const status = String(update.status || '').toLowerCase();
    const terminal = status === 'completed' || status === 'failed' || status === 'error';
    const hasResult = update.structuredContent !== undefined
      || update.structured_content !== undefined
      || update.rawOutput !== undefined
      || update.raw_output !== undefined
      || update.content !== undefined;
    if (!id || !terminal || !hasResult) return [];
    return [{
      type: 'user',
      message: { content: [{
        type: 'tool_result',
        tool_use_id: id,
        content: toolResultContent(update),
        is_error: status === 'failed' || status === 'error' || rawOutputIsError(update),
      }] },
    }];
  }
  return [{ type: 'system', subtype: 'grok_acp_update', update }];
}

function createGrokAcpSession(options) {
  return new GrokAcpSession(options);
}

class GrokAcpSession {
  constructor({
    cwd,
    rules = null,
    profilePath = null,
    trustProjectFolder = false,
    mcpServers = [],
    mcpServersFn = null,
    grokBin = getGrokBin(),
    args = null,
    buildArgs = buildGrokAcpArgs,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    rpcTimeoutMs = DEFAULT_RPC_TIMEOUT_MS,
    maxLineBytes = DEFAULT_MAX_LINE_BYTES,
    maxStdoutBytes = DEFAULT_MAX_STDOUT_BYTES,
    maxErrorBytes = DEFAULT_MAX_ERROR_BYTES,
    spawnFn = spawn,
    killFn = terminateTree,
    nowFn = Date.now,
    env = process.env,
    envOverridesFn = () => ({}),
  } = {}) {
    if (!cwd) throw new TypeError('cwd(.grok/config.toml 위치)가 필요하다');
    this._cwd = cwd;
    this._rules = rules;
    this._profilePath = profilePath;
    this._trustProjectFolder = trustProjectFolder === true;
    this._mcpServers = Array.isArray(mcpServers) ? mcpServers : [];
    this._mcpServersFn = typeof mcpServersFn === 'function'
      ? mcpServersFn
      : () => this._mcpServers;
    this._grokBin = grokBin;
    this._args = Array.isArray(args) ? [...args] : null;
    this._buildArgs = buildArgs;
    this._timeoutMs = timeoutMs;
    this._rpcTimeoutMs = rpcTimeoutMs;
    this._maxLineBytes = maxLineBytes;
    this._maxStdoutBytes = maxStdoutBytes;
    this._maxErrorBytes = maxErrorBytes;
    this._spawn = spawnFn;
    this._kill = killFn;
    this._now = nowFn;
    this._env = env;
    this._envOverridesFn = envOverridesFn;
    this._proc = null;
    this._stopped = false;
    this._nextId = 1;
    this._tail = Promise.resolve();
    this._terminations = new Set();
  }

  snapshot() {
    const proc = this._proc;
    return {
      state: !proc || proc.dead ? 'down' : proc.state,
      pid: !proc || proc.dead ? null : proc.child.pid,
      sessionId: !proc || proc.dead ? null : proc.sessionId,
      stopped: this._stopped,
    };
  }

  run(options = {}) {
    const execute = () => this._run(options);
    const result = this._tail.then(execute, execute);
    this._tail = result.catch(() => {});
    return result;
  }

  async warm({ model = null, effort = null, identityKey = null, securityKey = null, resumeSessionId = null } = {}) {
    const execute = async () => {
      if (this._stopped) throw new Error('Grok ACP 세션이 종료됐다');
      const config = { model: model || null, effort: effort || null, identityKey, securityKey };
      let proc = this._proc;
      if (proc && !proc.dead) {
        if (this._compatible(proc, config, resumeSessionId)
          || (resumeSessionId === null && proc.blankWarm && this._compatible(proc, config, proc.sessionId))) {
          return this.snapshot();
        }
        if (proc.state !== 'idle') return this.snapshot();
        this._failProcess(proc, new Error('Grok ACP 런타임 구성이 변경됐다'));
      }
      proc = await this._start(config, resumeSessionId, null);
      proc.blankWarm = resumeSessionId === null;
      return this.snapshot();
    };
    const result = this._tail.then(execute, execute);
    this._tail = result.catch(() => {});
    return result;
  }

  stop(reason = new Error('Grok ACP 세션이 종료됐다')) {
    this._stopped = true;
    const proc = this._proc;
    const error = reason instanceof Error ? reason : new Error(String(reason || 'Grok ACP 세션이 종료됐다'));
    if (!error.code) error.code = 'ABORTED';
    if (proc && !proc.dead) this._failProcess(proc, error);
    const terminations = [...this._terminations];
    return Promise.allSettled(terminations).then((results) => {
      for (const pending of terminations) this._terminations.delete(pending);
      assertSessionStopsSucceeded(results);
      return this.snapshot();
    });
  }

  close(reason) { return this.stop(reason); }
  dispose(reason) { return this.stop(reason); }

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
    if (!prompt || !String(prompt).trim()) return this._failure('질의가 비어 있다', false, startedAt);
    if (this._stopped) return this._failure('Grok ACP 세션이 종료됐다', false, startedAt, { aborted: true });
    if (signal && signal.aborted) {
      return this._failure(signal.reason || '사용자 중단', false, startedAt, { aborted: true });
    }

    const requestedLineage = resumeSessionId === undefined
      ? (this._proc && !this._proc.dead ? this._proc.sessionId : null)
      : (resumeSessionId || null);
    const config = { model: model || null, effort: effort || null, identityKey, securityKey };
    let runProc = null;
    let cancelled = false;
    let cancelReason = null;
    const cancel = (reason = null) => {
      cancelled = true;
      cancelReason = reason || signal?.reason || new Error('사용자 중단');
      if (!(cancelReason instanceof Error)) cancelReason = new Error(String(cancelReason));
      if (!cancelReason.code) cancelReason.code = 'ABORTED';
      if (runProc && !runProc.dead) this._failProcess(runProc, cancelReason);
    };
    const onAbort = () => cancel(signal && signal.reason);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    let proc = this._proc;
    let spawnedFresh = false;
    const reusableBlank = proc && requestedLineage === null && proc.blankWarm
      && this._compatible(proc, config, proc.sessionId);
    if (proc && !proc.dead && !reusableBlank && !this._compatible(proc, config, requestedLineage)) {
      this._failProcess(proc, new Error('Grok ACP 런타임 구성이 변경됐다'));
      proc = null;
    }

    let initMs = 0;
    if (!proc || proc.dead) {
      spawnedFresh = true;
      const initStartedAt = this._now();
      try {
        proc = await this._start(config, requestedLineage, (started) => {
          runProc = started;
          if (typeof onSpawn === 'function') onSpawn({ pid: started.child.pid, kill: () => cancel() });
        });
        initMs = Math.max(0, this._now() - initStartedAt);
      } catch (error) {
        if (signal) signal.removeEventListener('abort', onAbort);
        if (this._proc && !this._proc.dead) this._failProcess(this._proc, error);
        return this._failure(cancelReason || error, false, startedAt, {
          aborted: cancelled || this._stopped || !!(signal && signal.aborted),
          spawnedFresh,
          initMs: Math.max(0, this._now() - initStartedAt),
        });
      }
    } else {
      runProc = proc;
      if (typeof onSpawn === 'function') onSpawn({ pid: proc.child.pid, kill: () => cancel() });
    }
    if (cancelled || this._stopped || (signal && signal.aborted)) {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (proc && !proc.dead) this._failProcess(proc, cancelReason || signal?.reason || new Error('사용자 중단'));
      return this._failure(cancelReason || signal?.reason || '사용자 중단', false, startedAt, { aborted: true, spawnedFresh, initMs });
    }

    proc.state = 'busy';
    proc.blankWarm = false;
    const parser = new StreamJsonSession();
    const submittedAt = this._now();
    const active = {
      parser,
      submittedAt,
      firstEventMs: null,
      firstTextMs: null,
      stdoutBytes: 0,
      completedToolIds: new Set(),
      callbacks: { onEvent, onTextDelta, onThinkingDelta, onCanvasResult },
    };
    proc.active = active;
    let response;
    try {
      response = await this._request(proc, 'session/prompt', {
        sessionId: proc.sessionId,
        prompt: [{ type: 'text', text: String(prompt) }],
      }, timeoutMs, true);
    } catch (error) {
      const timedOut = error && error.code === 'RPC_TIMEOUT';
      const aborted = (signal && signal.aborted) || (error && error.code === 'ABORTED');
      if (!proc.dead) this._failProcess(proc, error);
      return this._failure(error, true, startedAt, {
        timedOut, aborted, spawnedFresh, initMs,
        firstEventMs: active.firstEventMs,
        firstTextMs: active.firstTextMs,
        stderr: proc.stderr,
        diagnostics: parser.diagnostics(),
      });
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
    }

    if (!proc.dead) {
      proc.active = null;
      proc.state = 'idle';
    }
    const stopReason = response && (response.stopReason || response.stop_reason) || null;
    const isError = !response || response.isError === true || response.is_error === true || stopReason !== 'end_turn';
    const finalResult = {
      type: 'result',
      subtype: isError ? 'error' : 'success',
      is_error: !!isError,
      result: active.text || '',
      session_id: proc.sessionId,
      stop_reason: stopReason,
    };
    this._emitCompat(active, finalResult);
    return {
      ok: !isError,
      submitted: true,
      exitCode: null,
      timedOut: false,
      aborted: false,
      stdoutCapped: false,
      error: isError ? boundedText(
        response && (response.error || response.message) || `Grok ACP 턴이 완료되지 않았다 (${stopReason || 'unknown'})`,
        this._maxErrorBytes,
      ) : null,
      finalResult,
      stderr: proc.stderr,
      diagnostics: parser.diagnostics(),
      metrics: {
        initMs,
        firstEventMs: active.firstEventMs,
        firstTextMs: active.firstTextMs,
        totalMs: Math.max(0, this._now() - startedAt),
        spawnedFresh,
      },
      initMs,
      firstEventMs: active.firstEventMs,
      firstTextMs: active.firstTextMs,
      totalMs: Math.max(0, this._now() - startedAt),
      spawnedFresh,
    };
  }

  _compatible(proc, config, lineage) {
    return proc.config.model === config.model
      && proc.config.effort === config.effort
      && proc.config.identityKey === config.identityKey
      && proc.config.securityKey === config.securityKey
      && proc.sessionId === lineage;
  }

  async _start(config, resumeSessionId, onProcess = null) {
    let child;
    const args = this._args || this._buildArgs({
      model: config.model,
      effort: config.effort,
      profilePath: this._profilePath,
      trustProjectFolder: this._trustProjectFolder,
    });
    try {
      child = this._spawn(this._grokBin, args, {
        cwd: this._cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...this._env, ...this._envOverridesFn() },
        windowsHide: true,
        shell: false,
      });
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        const missing = new Error(`'${this._grokBin}' 실행 파일을 PATH에서 못 찾았다. ATHENA_GROK_BIN을 지정하라.`);
        missing.code = 'ENOENT';
        throw missing;
      }
      throw error;
    }
    const proc = {
      child, config: { ...config }, state: 'starting', sessionId: null,
      carry: '', stderr: '', pending: new Map(), active: null, dead: false,
    };
    this._proc = proc;
    child.stdout?.setEncoding?.('utf8');
    child.stderr?.setEncoding?.('utf8');
    child.stdout?.on?.('data', (chunk) => this._onStdout(proc, chunk));
    child.stderr?.on?.('data', (chunk) => {
      proc.stderr = boundedText(proc.stderr + String(chunk), this._maxErrorBytes);
    });
    child.stdin?.on?.('error', (error) => this._failProcess(proc, error));
    child.on?.('error', (error) => this._failProcess(proc, error));
    child.on?.('close', (code) => {
      const error = new Error(`grok agent stdio 종료 코드 ${String(code)}`);
      error.exitCode = code;
      error.code = 'PROCESS_EXIT';
      this._failProcess(proc, error);
    });
    if (onProcess) onProcess(proc);

    const initialized = await this._request(proc, 'initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
    }, this._rpcTimeoutMs, false);
    const authMethods = Array.isArray(initialized && initialized.authMethods) ? initialized.authMethods : [];
    const authRequired = initialized && (initialized.authRequired === true || initialized.authenticated === false);
    if (authRequired) {
      const cached = authMethods.find((method) => (method.id || method.methodId || method) === 'cached_token');
      if (!cached) throw new Error('Grok ACP 인증이 필요하지만 cached_token 방식이 제공되지 않았다');
      await this._request(proc, 'authenticate', { methodId: 'cached_token' }, this._rpcTimeoutMs, false);
    }
    const mcpServers = this._mcpServersFn();
    if (!Array.isArray(mcpServers)) throw new TypeError('mcpServersFn은 ACP 서버 배열을 반환해야 한다');
    const sessionParams = { cwd: this._cwd, mcpServers };
    sessionParams._meta = {
      yoloMode: true,
      startupHints: { nonInteractive: true },
    };
    if (this._rules) sessionParams._meta.rules = this._rules;
    if (this._profilePath) sessionParams._meta.agentProfile = this._profilePath;
    if (resumeSessionId) {
      sessionParams.sessionId = resumeSessionId;
      await this._request(proc, 'session/load', sessionParams, this._rpcTimeoutMs, false);
      proc.sessionId = resumeSessionId;
    } else {
      const created = await this._request(proc, 'session/new', sessionParams, this._rpcTimeoutMs, false);
      if (!created || !created.sessionId) throw new Error('session/new 응답에 sessionId가 없다');
      proc.sessionId = created.sessionId;
    }
    proc.state = 'idle';
    return proc;
  }

  _request(proc, method, params, timeoutMs, submitted) {
    if (proc.dead) return Promise.reject(Object.assign(new Error('Grok ACP 프로세스가 종료됐다'), { code: submitted ? 'ABORTED' : 'STARTUP_FAILED' }));
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => {
        proc.pending.delete(id);
        const error = new Error(`${method} RPC 타임아웃(${Math.round(timeoutMs / 1000)}s)`);
        error.code = 'RPC_TIMEOUT';
        reject(error);
      }, timeoutMs) : null;
      proc.pending.set(id, { resolve, reject, timer, submitted });
      try {
        proc.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch (error) {
        proc.pending.delete(id);
        if (timer) clearTimeout(timer);
        reject(error);
      }
    });
  }

  _onStdout(proc, chunk) {
    if (proc.dead) return;
    proc.carry += String(chunk);
    if (Buffer.byteLength(proc.carry, 'utf8') > this._maxLineBytes && !proc.carry.includes('\n')) {
      const error = new Error('Grok ACP JSON line 상한을 초과했다');
      error.code = 'STDOUT_CAP';
      this._failProcess(proc, error);
      return;
    }
    const lines = proc.carry.split('\n');
    proc.carry = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch {
        const error = new Error('Grok ACP stdout에 잘못된 JSON이 수신됐다');
        error.code = 'INVALID_JSON';
        this._failProcess(proc, error);
        return;
      }
      this._onMessage(proc, message);
    }
  }

  _onMessage(proc, message) {
    if (Object.prototype.hasOwnProperty.call(message, 'id') && !message.method) {
      const pending = proc.pending.get(message.id);
      if (!pending) return;
      proc.pending.delete(message.id);
      if (pending.timer) clearTimeout(pending.timer);
      if (message.error) {
        const error = new Error(boundedText(message.error.message || JSON.stringify(message.error), this._maxErrorBytes));
        error.code = message.error.code;
        pending.reject(error);
      } else pending.resolve(message.result || {});
      return;
    }
    if (message.method === 'session/update' || message.method === 'x.ai/session/update') {
      const active = proc.active;
      if (!active) return;
      active.stdoutBytes += Buffer.byteLength(JSON.stringify(message), 'utf8');
      if (active.stdoutBytes > this._maxStdoutBytes) {
        const error = new Error('Grok ACP 턴 stdout 누적 상한을 초과했다');
        error.code = 'STDOUT_CAP';
        this._failProcess(proc, error);
        return;
      }
      const update = message.params && (message.params.update || message.params);
      const kind = update && (update.sessionUpdate || update.session_update);
      const id = kind === 'tool_call_update' ? toolId(update) : null;
      const events = acpUpdateToEvents(update);
      if (id && events.some((event) => event.type === 'user')) {
        if (active.completedToolIds.has(id)) return;
        active.completedToolIds.add(id);
      }
      for (const event of events) this._emitCompat(active, event);
      return;
    }
    if (message.method && Object.prototype.hasOwnProperty.call(message, 'id')) {
      const permission = message.method.includes('request_permission');
      const reply = permission
        ? { jsonrpc: '2.0', id: message.id, result: { outcome: { outcome: 'cancelled' } } }
        : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Athena client capability denied' } };
      try { proc.child.stdin.write(`${JSON.stringify(reply)}\n`); } catch { /* process failure handler owns teardown */ }
    }
  }

  _emitCompat(active, event) {
    if (!active || !event) return;
    const callbacks = active.callbacks;
    active.parser.feed(`${JSON.stringify(event)}\n`, {
      onEvent: (parsed) => {
        if (active.firstEventMs === null) active.firstEventMs = Math.max(0, this._now() - active.submittedAt);
        if (callbacks.onEvent) callbacks.onEvent(parsed);
      },
      onTextDelta: (text) => {
        if (active.firstTextMs === null) active.firstTextMs = Math.max(0, this._now() - active.submittedAt);
        active.text = (active.text || '') + text;
        if (callbacks.onTextDelta) callbacks.onTextDelta(text);
      },
      onThinkingDelta: callbacks.onThinkingDelta,
      onCanvasResult: callbacks.onCanvasResult,
    });
  }

  _failProcess(proc, reason) {
    if (!proc || proc.dead) return;
    proc.dead = true;
    proc.state = 'down';
    const error = reason instanceof Error ? reason : new Error(String(reason || 'Grok ACP 프로세스가 종료됐다'));
    if (error.exitCode == null && reason && reason.exitCode != null) error.exitCode = reason.exitCode;
    for (const pending of proc.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    proc.pending.clear();
    proc.active = null;
    if (this._proc === proc) this._proc = null;
    try {
      const operation = this._kill(proc.child);
      if (operation && typeof operation.then === 'function') {
        const pending = Promise.resolve(operation);
        this._terminations.add(pending);
        pending.catch(() => {});
      }
    } catch (error) {
      const pending = Promise.reject(error);
      this._terminations.add(pending);
      pending.catch(() => {});
    }
  }

  _failure(reason, submitted, startedAt, extra = {}) {
    const error = boundedText(reason && reason.message ? reason.message : reason, this._maxErrorBytes) || 'Grok ACP 요청이 실패했다';
    const metrics = {
      initMs: extra.initMs || 0,
      firstEventMs: extra.firstEventMs ?? null,
      firstTextMs: extra.firstTextMs ?? null,
      totalMs: Math.max(0, this._now() - startedAt),
      spawnedFresh: !!extra.spawnedFresh,
    };
    return {
      ok: false,
      submitted: !!submitted,
      exitCode: reason && reason.exitCode != null ? reason.exitCode : null,
      timedOut: !!extra.timedOut,
      aborted: !!extra.aborted,
      stdoutCapped: !!(reason && reason.code === 'STDOUT_CAP'),
      error,
      finalResult: null,
      stderr: extra.stderr || '',
      diagnostics: extra.diagnostics || null,
      metrics,
      ...metrics,
    };
  }
}

module.exports = {
  GrokAcpSession,
  createGrokAcpSession,
  buildGrokAcpArgs,
  acpUpdateToEvents,
  DEFAULT_MAX_STDOUT_BYTES,
};
