'use strict';

const { createHash } = require('node:crypto');
const { spawn: nodeSpawn } = require('node:child_process');
const { PassThrough } = require('node:stream');
const {
  GATEWAY_ALLOWED_TOOLS,
  DISALLOWED_EXECUTION_TOOLS,
  DISABLE_TOOL_SEARCH_ENV,
} = require('./claude-tool-policy');
const { AsyncInputQueue } = require('./async-input-queue');
const { classifyCanvasBlock } = require('./stream-json-parser');
const { readProcessCreationTime, terminateTree } = require('./proc-utils');

const DEFAULT_INITIALIZE_TIMEOUT_MS = 60_000;
const DEFAULT_PERSISTENCE_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 25;
const DEFAULT_TURN_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_FRAME_BYTES = 1_000_000;
const DEFAULT_MAX_TURN_BYTES = 5_000_000;
const DEFAULT_MAX_GENERATION_BYTES = 20_000_000;
const DEFAULT_MAX_RAW_OUTPUT_BYTES = 20_000_000;
const DEFAULT_DIAGNOSTIC_BYTES = 64_000;
const DEFAULT_CLOSE_DRAIN_TIMEOUT_MS = 5_000;

function byteLength(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

function splitTools(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function compareUnicodeCodePoints(left, right) {
  const leftPoints = Array.from(left, (char) => char.codePointAt(0));
  const rightPoints = Array.from(right, (char) => char.codePointAt(0));
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const key of Object.keys(value).sort(compareUnicodeCodePoints)) {
    result[key] = stableValue(value[key]);
  }
  return result;
}

function canonicalMessageHash(message) {
  return createHash('sha256').update(JSON.stringify(stableValue(message)), 'utf8').digest('hex');
}

function safeText(value, max = 500) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
}

function userFacingProviderError(text) {
  const raw = safeText(text);
  if (/weekly limit/i.test(raw) || /hit your/i.test(raw)) return '이번 주 모델 한도에 닿았습니다';
  if (/rate[_ ]limit/i.test(raw)) return '모델 요청 한도에 닿았습니다';
  return raw;
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizedUsage(message) {
  const usage = plainObject(message && message.usage) ? message.usage : {};
  const fields = {
    inputTokens: usage.input_tokens ?? usage.inputTokens,
    outputTokens: usage.output_tokens ?? usage.outputTokens,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? usage.cacheReadInputTokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens,
    totalCostUsd: message && message.total_cost_usd,
  };
  const normalized = {};
  for (const [key, value] of Object.entries(fields)) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) normalized[key] = number;
  }
  return normalized;
}

function canonicalToolName(providerName) {
  const name = String(providerName || '');
  if (!name.startsWith('mcp__')) return name;
  const parts = name.split('__');
  return parts.length > 2 ? parts.slice(2).join('__') : name;
}

function collectExactMcpTools(snapshot) {
  const result = new Set();
  const allowedTools = snapshot && snapshot.allowedTools;
  const values = Array.isArray(allowedTools) ? allowedTools : splitTools(allowedTools);
  for (const value of values) {
    const toolName = String(value || '').trim();
    if (!/^mcp__athena__[A-Za-z0-9][A-Za-z0-9_]*(?:__[A-Za-z0-9][A-Za-z0-9_]*)*$/.test(toolName)) {
      throw new TypeError(`Invalid exact Athena MCP tool name: ${safeText(toolName, 120) || '<empty>'}`);
    }
    result.add(toolName);
  }
  return result;
}

class ProviderProcessFenceError extends Error {
  constructor(results) {
    super('One or more provider child processes did not cross the termination fence');
    this.name = 'ProviderProcessFenceError';
    this.code = 'PROVIDER_PROCESS_FENCE_FAILED';
    this.retryable = false;
    this.results = Object.freeze(results.map((result) => Object.freeze({ ...result })));
  }
}

function validateInitialClaudeCursor(generationContext) {
  if (!Object.prototype.hasOwnProperty.call(generationContext, 'initialProviderBinding')
      || !Object.prototype.hasOwnProperty.call(generationContext, 'initialContinuationCheckpoint')) {
    throw new TypeError('Claude generation context must explicitly provide both initial cursor fields');
  }
  const binding = generationContext.initialProviderBinding;
  const checkpoint = generationContext.initialContinuationCheckpoint;
  if (binding == null && checkpoint == null) return { binding: null, checkpoint: null };
  if (binding != null) {
    if (!plainObject(binding) || binding.provider !== 'claude' || typeof binding.sessionId !== 'string' || !binding.sessionId) {
      throw new TypeError('initialProviderBinding must be a Claude session binding');
    }
  }
  if (checkpoint != null) {
    if (!plainObject(checkpoint) || checkpoint.provider !== 'claude') {
      throw new TypeError('initialContinuationCheckpoint must be a Claude checkpoint');
    }
    if (typeof checkpoint.sessionId !== 'string' || !checkpoint.sessionId
        || typeof checkpoint.assistantMessageId !== 'string' || !checkpoint.assistantMessageId
        || !/^[0-9a-f]{64}$/i.test(String(checkpoint.assistantMessageHash || ''))) {
      throw new TypeError('initial Claude checkpoint fields are invalid');
    }
    if (binding == null || binding.sessionId !== checkpoint.sessionId) {
      throw new TypeError('initial Claude binding and checkpoint session IDs must match');
    }
  }
  return {
    binding: binding == null ? null : { provider: 'claude', sessionId: binding.sessionId },
    checkpoint: checkpoint == null ? null : {
      provider: 'claude',
      sessionId: checkpoint.sessionId,
      assistantMessageId: checkpoint.assistantMessageId,
      assistantMessageHash: checkpoint.assistantMessageHash.toLowerCase(),
    },
  };
}

function defaultSdkLoader() {
  return import('@anthropic-ai/claude-agent-sdk');
}

class ClaudeAgentSession {
  constructor({
    sdk = null,
    loadSdk = defaultSdkLoader,
    spawn = nodeSpawn,
    interactiveCanUseTool = null,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    initializeTimeoutMs = DEFAULT_INITIALIZE_TIMEOUT_MS,
    persistenceTimeoutMs = DEFAULT_PERSISTENCE_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS,
    maxFrameBytes = DEFAULT_MAX_FRAME_BYTES,
    maxTurnBytes = DEFAULT_MAX_TURN_BYTES,
    maxGenerationBytes = DEFAULT_MAX_GENERATION_BYTES,
    maxRawOutputBytes = DEFAULT_MAX_RAW_OUTPUT_BYTES,
    maxDiagnosticBytes = DEFAULT_DIAGNOSTIC_BYTES,
    closeDrainTimeoutMs = DEFAULT_CLOSE_DRAIN_TIMEOUT_MS,
    readCreationTime = readProcessCreationTime,
    terminateProcessTree = terminateTree,
  } = {}) {
    this._sdk = sdk;
    this._loadSdk = loadSdk;
    this._spawn = spawn;
    this._interactiveCanUseTool = interactiveCanUseTool;
    this._sleep = sleep;
    this._initializeTimeoutMs = initializeTimeoutMs;
    this._persistenceTimeoutMs = persistenceTimeoutMs;
    this._pollIntervalMs = pollIntervalMs;
    this._turnTimeoutMs = turnTimeoutMs;
    this._maxFrameBytes = maxFrameBytes;
    this._maxTurnBytes = maxTurnBytes;
    this._maxGenerationBytes = maxGenerationBytes;
    this._maxRawOutputBytes = maxRawOutputBytes;
    this._maxDiagnosticBytes = maxDiagnosticBytes;
    this._closeDrainTimeoutMs = closeDrainTimeoutMs;
    this._readCreationTime = readCreationTime;
    this._terminateProcessTree = terminateProcessTree;

    this._desired = null;
    this._generationContext = null;
    this._warmQuery = null;
    this._query = null;
    this._inputQueue = null;
    this._pumpPromise = null;
    this._pumpGeneration = 0;
    this._active = null;
    this._ready = false;
    this._stopping = false;
    this._providerBinding = null;
    this._continuationCheckpoint = null;
    this._provisionalCursor = null;
    this._generationBytes = 0;
    this._rawOutputBytes = 0;
    this._registeredChildren = [];
    this._pendingSpawnCleanups = [];
    this._diagnostics = {
      frames: 0,
      lateFrames: 0,
      latePumpErrors: 0,
      rawOutputBytes: 0,
      stderrBytes: 0,
      stderrDroppedBytes: 0,
      permissionFenceDenials: 0,
    };
  }

  async start(desiredState, generationContext) {
    if (this._desired) throw new Error('ClaudeAgentSession.start() can only be called once');
    if (!desiredState || !desiredState.cwd) throw new Error('Claude desired state requires cwd');
    if (!generationContext || !generationContext.spawnContext) throw new Error('Claude generation context is required');
    generationContext.spawnContext.assertCurrent();
    const initialCursor = validateInitialClaudeCursor(generationContext);
    this._desired = desiredState;
    this._generationContext = generationContext;
    this._sdk = this._sdk || await this._loadSdk();
    this._providerBinding = initialCursor.binding;
    this._continuationCheckpoint = initialCursor.checkpoint;
    try {
      await this._startWarm(this._providerBinding && this._providerBinding.sessionId);
    } catch (error) {
      await this._drainPendingSpawnCleanups();
      throw error;
    }
    this._ready = true;
  }

  async ready() {
    if (!this._ready || this._stopping) throw new Error('Claude provider is not ready');
    return { provider: 'claude', runtimeGeneration: this._generationContext.runtimeGeneration };
  }

  async sendTurn(turn, turnContext) {
    await this.ready();
    if (this._active) throw new Error('Claude adapter accepts one active turn');
    if (this._provisionalCursor) throw new Error('Claude cursor is awaiting supervisor acknowledgement');
    if (!turn || !turn.turnId || !turn.userText || !String(turn.userText).trim()) {
      throw new Error('Claude turn requires turnId and userText');
    }
    if (!turnContext || typeof turnContext.emit !== 'function') throw new Error('Claude turn context is required');
    turnContext.assertCurrent();
    this._generationContext.spawnContext.assertCurrent();
    this._ensureQuery();

    let resolveTerminal;
    const terminalPromise = new Promise((resolve) => { resolveTerminal = resolve; });
    const active = {
      turn,
      turnContext,
      resolveTerminal,
      terminal: null,
      sessionId: this._providerBinding && this._providerBinding.sessionId,
      assistantMessageId: null,
      toolNames: new Map(),
      emittedToolStarts: new Set(),
      subagents: new Map(),
      outputBytes: 0,
      interruptedReason: null,
      timeout: null,
      signalListener: null,
      pendingTerminal: null,
    };
    this._active = active;
    this._emit(active, 'turn_started', { providerTurnId: null }, null);
    if (this._turnTimeoutMs > 0) {
      active.timeout = setTimeout(() => {
        this._finishFailure(active, 'PROVIDER_TURN_TIMEOUT', true, 'Claude 응답 시간이 초과되었습니다.');
        try {
          const interrupted = this._query && this._query.interrupt();
          if (interrupted && typeof interrupted.catch === 'function') interrupted.catch(() => {});
        } catch {}
      }, this._turnTimeoutMs);
    }
    if (turn.signal) {
      active.signalListener = () => {
        void this.interrupt(turn.turnId, 'abort-signal').catch(() => {
          this._finishFailure(active, 'PROVIDER_PROCESS_EXITED', true, 'Claude interrupt 요청이 실패했습니다.');
        });
      };
      if (turn.signal.aborted) {
        active.interruptedReason = 'abort-signal';
        this._finishInterrupted(active);
      } else turn.signal.addEventListener('abort', active.signalListener, { once: true });
    }
    try {
      if (active.terminal) throw new Error('Claude turn was interrupted before input write');
      this._inputQueue.push({
        type: 'user',
        message: { role: 'user', content: String(turn.userText) },
        parent_tool_use_id: null,
      });
    } catch (error) {
      if (!active.terminal) this._finishFailure(active, 'PROVIDER_PROTOCOL_ERROR', true, safeText(error && error.message));
    }

    const result = await terminalPromise;
    let finalResult = result;
    if (!result.ok && !this._stopping) {
      this._ready = false;
      try {
        await this._recoverAfterNonSuccess();
      } catch (error) {
        const fenceFailed = error instanceof ProviderProcessFenceError;
        finalResult = {
          ...result,
          retryable: false,
          code: fenceFailed ? error.code : 'PROVIDER_CONTEXT_LOST',
          error: fenceFailed
            ? 'Claude 프로세스 종료 경계를 확인하지 못했습니다.'
            : '마지막 정상 대화 경계로 안전하게 복구하지 못했습니다.',
        };
        active.pendingTerminal = {
          type: 'turn_failed',
          payload: {
            code: finalResult.code,
            retryable: false,
            safeMessage: finalResult.error,
          },
        };
      }
    }
    if (active.pendingTerminal) {
      this._emitClaimed(active, active.pendingTerminal.type, active.pendingTerminal.payload);
      active.pendingTerminal = null;
    }
    this._cleanupActive(active);
    if (this._active === active) this._active = null;
    return finalResult;
  }

  async interrupt(turnId, reason = 'interrupt') {
    const active = this._active;
    if (!active || active.turn.turnId !== turnId || active.terminal) return null;
    active.interruptedReason = safeText(reason, 120) || 'interrupt';
    if (this._query && typeof this._query.interrupt === 'function') await this._query.interrupt();
    return null;
  }

  async stop(reason = 'stop') {
    if (this._stopping) return this._terminateRegisteredChildren();
    this._stopping = true;
    this._ready = false;
    const active = this._active;
    if (active && !active.terminal) {
      active.interruptedReason = safeText(reason, 120) || 'stop';
      this._finishInterrupted(active);
    }
    await this._closeRuntime();
    await this._terminateRegisteredChildren();
  }

  snapshot() {
    return Object.freeze({
      provider: 'claude',
      ready: this._ready,
      activeTurnId: this._active ? this._active.turn.turnId : null,
      providerBinding: this._providerBinding ? { ...this._providerBinding } : null,
      continuationCheckpoint: this._continuationCheckpoint ? { ...this._continuationCheckpoint } : null,
      diagnostics: Object.freeze({ ...this._diagnostics }),
    });
  }

  async _startWarm(resumeSessionId = null) {
    this._generationContext.spawnContext.assertCurrent();
    this._inputQueue = new AsyncInputQueue({ maxPending: 1 });
    const options = this._buildOptions(resumeSessionId);
    this._warmQuery = await this._sdk.startup({
      options,
      initializeTimeoutMs: this._initializeTimeoutMs,
    });
    this._generationContext.spawnContext.assertCurrent();
  }

  _ensureQuery() {
    if (this._query) return;
    if (!this._warmQuery) throw new Error('Claude WarmQuery is unavailable');
    this._query = this._warmQuery.query(this._inputQueue);
    const pumpGeneration = ++this._pumpGeneration;
    this._pumpPromise = this._pumpOutput(this._query, pumpGeneration);
  }

  _buildOptions(resumeSessionId) {
    const desired = this._desired;
    const allowedTools = splitTools(desired.toolPolicy && desired.toolPolicy.allowedTools || GATEWAY_ALLOWED_TOOLS);
    const disallowedTools = splitTools(desired.toolPolicy && desired.toolPolicy.disallowedTools || DISALLOWED_EXECUTION_TOOLS);
    const builtins = allowedTools.filter((name) => !name.startsWith('mcp__'));
    if (builtins.includes('Task') && !builtins.includes('Agent')) {
      builtins.splice(builtins.indexOf('Task') + 1, 0, 'Agent');
    }
    return {
      cwd: desired.cwd,
      model: desired.model || undefined,
      effort: desired.effort || undefined,
      resume: resumeSessionId || undefined,
      includePartialMessages: true,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: desired.systemPrompt || '' },
      settingSources: [],
      strictMcpConfig: true,
      env: { ...process.env, ...DISABLE_TOOL_SEARCH_ENV },
      mcpServers: desired.mcpSnapshot && desired.mcpSnapshot.claudeServers || {},
      tools: builtins,
      allowedTools,
      disallowedTools,
      permissionMode: 'default',
      hooks: {
        PreToolUse: [{ hooks: [this._createPreToolUseHook()], timeout: 5 }],
      },
      canUseTool: this._createInteractivePermissionHandler(),
      spawnClaudeCodeProcess: (options) => this._spawnGenerationProcess(options),
    };
  }

  _createPreToolUseHook() {
    const allowed = new Set(splitTools(this._desired.toolPolicy && this._desired.toolPolicy.allowedTools || GATEWAY_ALLOWED_TOOLS));
    const disallowed = new Set(splitTools(this._desired.toolPolicy && this._desired.toolPolicy.disallowedTools || DISALLOWED_EXECUTION_TOOLS));
    const exactMcpTools = collectExactMcpTools(this._desired.mcpSnapshot);
    return async (input) => {
      let permitted = false;
      let reason = 'Tool is outside the immutable Athena generation policy';
      try {
        this._generationContext.spawnContext.assertCurrent();
        const toolName = String(input && input.tool_name || '');
        if (disallowed.has(toolName)) reason = 'Tool is explicitly denied by Athena policy';
        else if (toolName.startsWith('mcp__')) permitted = exactMcpTools.has(toolName);
        else permitted = allowed.has(toolName) || (toolName === 'Agent' && allowed.has('Task'));
      } catch {
        reason = 'Stale or unknown Athena runtime generation';
      }
      if (!permitted) this._diagnostics.permissionFenceDenials += 1;
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: permitted ? 'allow' : 'deny',
          permissionDecisionReason: permitted ? 'Allowed by immutable Athena generation policy' : reason,
        },
      };
    };
  }

  _createInteractivePermissionHandler() {
    return async (toolName, input, options) => {
      try {
        this._generationContext.spawnContext.assertCurrent();
      } catch {
        return { behavior: 'deny', message: 'Stale Athena runtime generation' };
      }
      if (typeof this._interactiveCanUseTool !== 'function') {
        return { behavior: 'deny', message: 'Athena has no interactive approval for this tool call' };
      }
      try {
        const decision = await this._interactiveCanUseTool(toolName, input, options);
        if (!decision || !['allow', 'deny'].includes(decision.behavior)) {
          return { behavior: 'deny', message: 'Invalid interactive permission decision' };
        }
        return decision;
      } catch {
        return { behavior: 'deny', message: 'Interactive permission check failed' };
      }
    };
  }

  _spawnGenerationProcess(options) {
    const spawnContext = this._generationContext.spawnContext;
    spawnContext.assertCurrent();
    const generationEnv = spawnContext.buildEnv('claude');
    const env = { ...(options.env || {}), ...(generationEnv || {}), ...DISABLE_TOOL_SEARCH_ENV };
    spawnContext.assertCurrent();
    const child = this._spawn(options.command, options.args, {
      cwd: options.cwd,
      env,
      signal: options.signal,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let registration;
    let expectedCreationTime = null;
    try {
      expectedCreationTime = this._readCreationTime(child.pid);
      registration = spawnContext.registerChild(child, {
        provider: 'claude',
        runtimeGeneration: this._generationContext.runtimeGeneration,
        processOwnerId: this._generationContext.processOwnerId,
        expectedCreationTime,
        readCreationTime: this._readCreationTime,
      });
      if (registration && typeof registration.then === 'function') {
        throw new Error('registerChild must be synchronous for spawnClaudeCodeProcess');
      }
      this._registeredChildren.push({ child, registration });
    } catch (error) {
      this._pendingSpawnCleanups.push(
        Promise.resolve()
          .then(() => this._terminateProcessTree(child, {
            ...(expectedCreationTime == null ? {} : { expectedCreationTime }),
            readCreationTime: this._readCreationTime,
          }))
          .catch((cleanupError) => ({
            ok: false,
            outcome: 'exception',
            errorName: cleanupError && cleanupError.name || 'Error',
            errorMessage: safeText(cleanupError && cleanupError.message || cleanupError),
          })),
      );
      throw error;
    }

    const countedStdout = new PassThrough();
    child.stdout.on('data', (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk), 'utf8');
      this._rawOutputBytes += bytes;
      this._diagnostics.rawOutputBytes = this._rawOutputBytes;
      if (this._rawOutputBytes > this._maxRawOutputBytes) {
        const active = this._active;
        if (active) this._finishFailure(active, 'PROVIDER_OUTPUT_LIMIT', false, 'Claude 출력 상한을 초과했습니다.');
        child.stdout.pause?.();
        countedStdout.destroy();
      }
    });
    child.stdout.pipe(countedStdout);
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk), 'utf8');
        this._diagnostics.stderrBytes += bytes;
        this._diagnostics.stderrDroppedBytes = Math.max(0, this._diagnostics.stderrBytes - this._maxDiagnosticBytes);
      });
    }
    return {
      stdin: child.stdin,
      stdout: countedStdout,
      get killed() { return child.killed; },
      get exitCode() { return child.exitCode; },
      get signalCode() { return child.signalCode; },
      kill(signal) { return child.kill(signal); },
      on(event, listener) { child.on(event, listener); },
      once(event, listener) { child.once(event, listener); },
      off(event, listener) { child.off(event, listener); },
    };
  }

  async _pumpOutput(query, pumpGeneration) {
    try {
      for await (const message of query) {
        if (pumpGeneration !== this._pumpGeneration) {
          this._diagnostics.lateFrames += 1;
          continue;
        }
        if (this._stopping) continue;
        const active = this._active;
        if (!active || active.terminal) {
          this._diagnostics.lateFrames += 1;
          continue;
        }
        let frameBytes;
        try { frameBytes = byteLength(message); } catch {
          this._finishFailure(active, 'PROVIDER_PROTOCOL_ERROR', false, 'Claude message를 검증할 수 없습니다.');
          continue;
        }
        this._diagnostics.frames += 1;
        active.outputBytes += frameBytes;
        this._generationBytes += frameBytes;
        if (frameBytes > this._maxFrameBytes || active.outputBytes > this._maxTurnBytes || this._generationBytes > this._maxGenerationBytes) {
          this._finishFailure(active, 'PROVIDER_OUTPUT_LIMIT', false, 'Claude 출력 상한을 초과했습니다.');
          continue;
        }
        await this._handleMessage(active, message);
      }
      if (pumpGeneration !== this._pumpGeneration) return;
      const active = this._active;
      if (active && !active.terminal && !this._stopping) {
        this._finishFailure(active, 'PROVIDER_PROCESS_EXITED', true, 'Claude session이 예기치 않게 종료되었습니다.');
      }
    } catch (error) {
      if (pumpGeneration !== this._pumpGeneration) {
        this._diagnostics.latePumpErrors += 1;
        return;
      }
      const active = this._active;
      if (active && !active.terminal && !this._stopping) {
        this._finishFailure(active, 'PROVIDER_PROCESS_EXITED', true, safeText(error && error.message));
      } else {
        this._diagnostics.latePumpErrors += 1;
      }
    }
  }

  async _handleMessage(active, message) {
    if (!message || typeof message !== 'object' || active.terminal) return;
    if (message.session_id) active.sessionId = String(message.session_id);
    if (message.type === 'system' && message.subtype === 'init') {
      return;
    }
    if (message.type === 'stream_event') {
      this._handleStreamEvent(active, message.event, message.parent_tool_use_id || null);
      return;
    }
    if (message.type === 'assistant') {
      this._handleAssistant(active, message);
      return;
    }
    if (message.type === 'user') {
      this._handleUserToolResults(active, message);
      return;
    }
    if (message.type === 'tool_progress') {
      this._emit(active, 'tool_progress', {
        toolUseId: String(message.tool_use_id || ''),
        safeStatus: `running:${Math.max(0, Number(message.elapsed_time_seconds) || 0)}`,
      });
      return;
    }
    if (message.type === 'system' && message.subtype === 'permission_denied') {
      this._emit(active, 'permission_denied', {
        safeToolLabel: canonicalToolName(message.tool_name) || 'unknown-tool',
        reasonCode: safeText(message.decision_reason_type || 'denied', 80),
      });
      return;
    }
    if (message.type === 'system' && ['task_started', 'task_progress', 'task_updated', 'task_notification'].includes(message.subtype)) {
      this._handleSubagentEvent(active, message);
      return;
    }
    if (message.type === 'rate_limit_event') {
      this._emit(active, 'warning', {
        code: 'CLAUDE_RATE_LIMIT',
        safeMessage: userFacingProviderError(message.rate_limit_info && message.rate_limit_info.status || 'rate-limit'),
      });
      return;
    }
    if (message.type === 'result') await this._handleResult(active, message);
  }

  _handleStreamEvent(active, event, parentToolUseId) {
    if (!event || typeof event !== 'object' || active.terminal) return;
    if (event.type === 'content_block_delta' && event.delta) {
      if (event.delta.type === 'text_delta' && event.delta.text) {
        this._emit(active, 'text_delta', { text: String(event.delta.text) });
      } else if (['thinking_delta', 'redacted_thinking_delta'].includes(event.delta.type) && event.delta.thinking) {
        this._emit(active, 'thinking_delta', { text: String(event.delta.thinking) });
      }
      return;
    }
    if (event.type === 'content_block_start' && event.content_block && event.content_block.type === 'tool_use') {
      this._emitToolStarted(active, event.content_block, parentToolUseId);
    }
  }

  _handleAssistant(active, message) {
    if (message.parent_tool_use_id == null && message.uuid) active.assistantMessageId = String(message.uuid);
    const blocks = message.message && Array.isArray(message.message.content) ? message.message.content : [];
    for (const block of blocks) {
      if (block && block.type === 'tool_use') this._emitToolStarted(active, block, message.parent_tool_use_id || null);
    }
  }

  _emitToolStarted(active, block, parentToolUseId) {
    const id = String(block.id || '');
    if (!id || active.emittedToolStarts.has(id)) return;
    active.emittedToolStarts.add(id);
    const providerToolName = String(block.name || '');
    active.toolNames.set(id, providerToolName);
      this._emit(active, 'tool_started', {
      toolUseId: id,
      parentToolUseId,
      canonicalToolName: canonicalToolName(providerToolName),
      providerToolName,
      input: plainObject(block.input) ? block.input : {},
    });
  }

  _handleUserToolResults(active, message) {
    const blocks = message.message && Array.isArray(message.message.content) ? message.message.content : [];
    for (const block of blocks) {
      if (!block || block.type !== 'tool_result') continue;
      const toolUseId = String(block.tool_use_id || '');
      const providerName = active.toolNames.get(toolUseId) || '';
      const name = canonicalToolName(providerName);
      const content = block.content == null ? message.tool_use_result : block.content;
      this._emit(active, 'tool_completed', {
        toolUseId,
        canonicalToolName: name,
        isError: block.is_error === true,
        content,
      });
      if (name === 'athena__render_canvas' || name === 'render_canvas') {
        const canvas = classifyCanvasBlock({
          toolUseId,
          isError: block.is_error === true,
          content,
          meta: block.meta || null,
        });
        if (plainObject(canvas.envelope) || plainObject(canvas.receipt)) {
          this._emit(active, 'canvas_result', {
            toolUseId,
            status: canvas.status,
            envelope: canvas.envelope,
            receipt: canvas.receipt,
          });
        }
      }
    }
  }

  _handleSubagentEvent(active, message) {
    if (message.ambient === true || message.skip_transcript === true) return;
    const taskId = String(message.task_id || '');
    if (!taskId) return;
    const previous = active.subagents.get(taskId) || {};
    const patch = plainObject(message.patch) ? message.patch : {};
    const usage = plainObject(message.usage) ? message.usage : {};
    const next = {
      taskId,
      parentToolUseId: message.tool_use_id == null
        ? (previous.parentToolUseId || null)
        : String(message.tool_use_id),
      subtype: safeText(message.subagent_type || message.task_type || previous.subtype || 'subagent', 256) || 'subagent',
      description: safeText(message.description || patch.description || message.summary || previous.description || 'Subagent task', 4096) || 'Subagent task',
      status: safeText(message.status || patch.status || previous.status || (message.subtype === 'task_started' ? 'running' : 'updated'), 256) || 'updated',
      lastCanonicalToolName: message.last_tool_name
        ? canonicalToolName(message.last_tool_name)
        : (previous.lastCanonicalToolName || null),
      elapsedMs: Number.isFinite(Number(usage.duration_ms))
        ? Math.max(0, Number(usage.duration_ms))
        : (previous.elapsedMs || 0),
    };
    active.subagents.set(taskId, next);
    this._emit(active, 'subagent_updated', next);
  }

  async _handleResult(active, message) {
    if (active.terminal) return;
    this._emit(active, 'usage_updated', {
      ...normalizedUsage(message),
    });
    if (active.interruptedReason) {
      this._finishInterrupted(active);
      return;
    }
    if (message.subtype !== 'success' || message.is_error === true) {
      const detail = Array.isArray(message.errors) ? message.errors.join('; ') : message.result;
      this._finishFailure(active, 'PROVIDER_PROTOCOL_ERROR', true, userFacingProviderError(detail || 'Claude turn failed'));
      return;
    }
    const sessionId = String(message.session_id || active.sessionId || '');
    const assistantMessageId = active.assistantMessageId;
    if (!sessionId || !assistantMessageId) {
      this._finishFailure(active, 'PROVIDER_CHECKPOINT_UNAVAILABLE', false, 'Claude 응답의 durable checkpoint가 없습니다.');
      return;
    }
    if (!String(message.result || '')) {
      this._finishFailure(active, 'PROVIDER_PROTOCOL_ERROR', false, 'Claude 성공 응답에 최종 텍스트가 없습니다.');
      return;
    }
    const persisted = await this._awaitPersistedAssistant(sessionId, assistantMessageId);
    if (!persisted || active.terminal) {
      if (!active.terminal) this._finishFailure(active, 'PROVIDER_CHECKPOINT_UNAVAILABLE', false, 'Claude 응답 저장을 확인하지 못했습니다.');
      return;
    }
    const checkpoint = {
      provider: 'claude',
      sessionId,
      assistantMessageId: String(persisted.uuid),
      assistantMessageHash: canonicalMessageHash(persisted.message),
    };
    const binding = { provider: 'claude', sessionId };
    const payload = {
      providerBinding: binding,
      continuationCheckpoint: checkpoint,
      usage: message.usage || {},
      finalText: String(message.result || ''),
    };
    if (!this._claimTerminal(active)) return;
    this._provisionalCursor = {
      turnId: active.turn.turnId,
      binding,
      checkpoint,
    };
    this._emitClaimed(active, 'turn_completed', payload);
    active.resolveTerminal({
      ok: true,
      provider: 'claude',
      conversationId: active.turn.conversationId,
      turnId: active.turn.turnId,
      providerBinding: { ...binding },
      continuationCheckpoint: { ...checkpoint },
      finalText: payload.finalText,
      usage: payload.usage,
      timings: {},
    });
  }

  async _awaitPersistedAssistant(sessionId, assistantMessageId) {
    const deadline = Date.now() + this._persistenceTimeoutMs;
    do {
      let messages = [];
      try {
        messages = await this._sdk.getSessionMessages(sessionId, { dir: this._desired.cwd });
      } catch {}
      const match = Array.isArray(messages)
        ? messages.find((message) => message && message.type === 'assistant' && message.parent_tool_use_id == null && String(message.uuid) === assistantMessageId)
        : null;
      if (match) return match;
      if (Date.now() >= deadline) break;
      await this._sleep(this._pollIntervalMs);
    } while (!this._stopping);
    return null;
  }

  _claimTerminal(active) {
    if (!active || active.terminal) return false;
    active.terminal = true;
    return true;
  }

  _finishFailure(active, code, retryable, message) {
    if (!this._claimTerminal(active)) return false;
    const payload = { code, retryable: !!retryable, safeMessage: safeText(message || 'Claude turn failed') };
    active.pendingTerminal = { type: 'turn_failed', payload };
    active.resolveTerminal({
      ok: false,
      provider: 'claude',
      conversationId: active.turn.conversationId,
      turnId: active.turn.turnId,
      providerBinding: this._providerBinding ? { ...this._providerBinding } : undefined,
      interrupted: false,
      retryable: !!retryable,
      code,
      error: payload.safeMessage,
      timings: {},
    });
    return true;
  }

  _finishInterrupted(active) {
    if (!this._claimTerminal(active)) return false;
    const binding = this._providerBinding ? { ...this._providerBinding } : null;
    const payload = { providerBinding: binding, reason: active.interruptedReason || 'interrupt' };
    active.pendingTerminal = { type: 'turn_interrupted', payload };
    active.resolveTerminal({
      ok: false,
      provider: 'claude',
      conversationId: active.turn.conversationId,
      turnId: active.turn.turnId,
      providerBinding: binding || undefined,
      interrupted: true,
      retryable: false,
      code: 'PROVIDER_INTERRUPTED',
      error: 'Claude 요청이 중단되었습니다.',
      timings: {},
    });
    return true;
  }

  _emit(active, type, payload, providerTurnId = null) {
    if (!active || active.terminal) return;
    try {
      active.turnContext.assertCurrent();
      active.turnContext.emit(type, payload, providerTurnId);
    } catch {
      this._diagnostics.lateFrames += 1;
    }
  }

  _emitClaimed(active, type, payload, providerTurnId = null) {
    try {
      active.turnContext.assertCurrent();
      active.turnContext.emit(type, payload, providerTurnId);
    } catch {
      this._diagnostics.lateFrames += 1;
    }
  }

  _cleanupActive(active) {
    if (active.timeout) clearTimeout(active.timeout);
    if (active.turn.signal && active.signalListener) active.turn.signal.removeEventListener('abort', active.signalListener);
  }

  async commitTurn(turnId) {
    const provisional = this._provisionalCursor;
    if (!provisional || provisional.turnId !== turnId) {
      throw new Error('Claude cursor acknowledgement does not match the provisional turn');
    }
    const previousBinding = this._providerBinding ? { ...this._providerBinding } : null;
    const previousCheckpoint = this._continuationCheckpoint ? { ...this._continuationCheckpoint } : null;
    const committedBinding = { ...provisional.binding };
    const committedCheckpoint = { ...provisional.checkpoint };
    this._providerBinding = committedBinding;
    this._continuationCheckpoint = committedCheckpoint;
    this._provisionalCursor = null;
    let rollbackStarted = false;
    return Object.freeze({
      rollback: async () => {
        if (rollbackStarted) return;
        rollbackStarted = true;
        const currentBinding = this._providerBinding;
        const currentCheckpoint = this._continuationCheckpoint;
        if (!currentBinding || !currentCheckpoint
          || currentBinding.provider !== committedBinding.provider
          || currentBinding.sessionId !== committedBinding.sessionId
          || currentCheckpoint.provider !== committedCheckpoint.provider
          || currentCheckpoint.sessionId !== committedCheckpoint.sessionId
          || currentCheckpoint.assistantMessageId !== committedCheckpoint.assistantMessageId
          || currentCheckpoint.assistantMessageHash !== committedCheckpoint.assistantMessageHash) return;
        this._providerBinding = previousBinding;
        this._continuationCheckpoint = previousCheckpoint;
        this._ready = false;
        await this._recoverAfterNonSuccess();
      },
    });
  }

  async rollbackTurn(turnId) {
    const provisional = this._provisionalCursor;
    if (!provisional || provisional.turnId !== turnId) return;
    this._provisionalCursor = null;
    this._ready = false;
    await this._recoverAfterNonSuccess();
  }

  async _recoverAfterNonSuccess() {
    const checkpoint = this._continuationCheckpoint ? { ...this._continuationCheckpoint } : null;
    await this._closeRuntime();
    await this._terminateRegisteredChildren();
    if (this._stopping) return;
    if (!checkpoint) {
      this._providerBinding = null;
      await this._startWarm(null);
      this._ready = true;
      return;
    }
    const fork = await this._sdk.forkSession(checkpoint.sessionId, {
      dir: this._desired.cwd,
      upToMessageId: checkpoint.assistantMessageId,
    });
    if (!fork || !fork.sessionId) throw new Error('Claude fork did not return a session ID');
    const messages = await this._sdk.getSessionMessages(fork.sessionId, { dir: this._desired.cwd });
    const lastAssistant = Array.isArray(messages)
      ? messages.filter((message) => message && message.type === 'assistant' && message.parent_tool_use_id == null).at(-1)
      : null;
    if (!lastAssistant || canonicalMessageHash(lastAssistant.message) !== checkpoint.assistantMessageHash) {
      throw new Error('Claude fork checkpoint hash mismatch');
    }
    this._providerBinding = { provider: 'claude', sessionId: String(fork.sessionId) };
    this._continuationCheckpoint = {
      ...checkpoint,
      sessionId: String(fork.sessionId),
      assistantMessageId: String(lastAssistant.uuid),
    };
    await this._startWarm(String(fork.sessionId));
    this._ready = true;
  }

  async _closeRuntime() {
    const query = this._query;
    const warm = this._warmQuery;
    const pump = this._pumpPromise;
    this._query = null;
    this._warmQuery = null;
    this._pumpPromise = null;
    this._pumpGeneration += 1;
    if (this._inputQueue) this._inputQueue.close();
    this._inputQueue = null;
    try {
      if (query && typeof query.close === 'function') query.close();
      else if (warm && typeof warm.close === 'function') warm.close();
    } catch {}
    if (pump) {
      let timer = null;
      try {
        await Promise.race([
          pump,
          new Promise((resolve) => { timer = setTimeout(resolve, this._closeDrainTimeoutMs); }),
        ]);
      } catch {}
      if (timer) clearTimeout(timer);
    }
  }

  async _terminateRegisteredChildren() {
    const registrations = [...this._registeredChildren];
    const results = [];
    try {
      results.push(...await this._drainPendingSpawnCleanups());
    } catch (error) {
      if (error instanceof ProviderProcessFenceError) results.push(...error.results);
      else results.push({
        ok: false,
        outcome: 'exception',
        errorName: error && error.name || 'Error',
        errorMessage: safeText(error && error.message || error),
      });
    }
    for (const { child, registration } of registrations) {
      try {
        let result;
        if (typeof registration === 'function') result = await registration();
        else if (registration && typeof registration.terminate === 'function') result = await registration.terminate();
        else if (registration && typeof registration.stop === 'function') result = await registration.stop();
        else if (registration && typeof registration.kill === 'function') result = await registration.kill();
        else result = await this._terminateProcessTree(child);
        results.push(result && typeof result === 'object'
          ? { pid: child && child.pid || null, ...result }
          : { pid: child && child.pid || null, ok: false, outcome: 'invalid-result' });
        if (result && result.ok === true) {
          const index = this._registeredChildren.findIndex((entry) => entry.child === child
            && entry.registration === registration);
          if (index >= 0) this._registeredChildren.splice(index, 1);
        }
      } catch (error) {
        results.push({
          pid: child && child.pid || null,
          ok: false,
          outcome: 'exception',
          errorName: error && error.name || 'Error',
          errorMessage: safeText(error && error.message || error),
        });
      }
    }
    if (results.some((result) => result.ok !== true)) throw new ProviderProcessFenceError(results);
    return results;
  }

  async _drainPendingSpawnCleanups() {
    const pending = this._pendingSpawnCleanups.splice(0);
    if (pending.length === 0) return [];
    const settled = await Promise.allSettled(pending);
    const results = settled.map((entry) => entry.status === 'fulfilled'
      ? entry.value
      : {
        ok: false,
        outcome: 'exception',
        errorName: entry.reason && entry.reason.name || 'Error',
        errorMessage: safeText(entry.reason && entry.reason.message || entry.reason),
      });
    if (results.some((result) => !result || result.ok !== true)) {
      throw new ProviderProcessFenceError(results.map((result) => result || { ok: false, outcome: 'invalid-result' }));
    }
    return results;
  }
}

function createClaudeAgentSession(options) {
  return new ClaudeAgentSession(options);
}

module.exports = {
  AsyncInputQueue,
  ClaudeAgentSession,
  ProviderProcessFenceError,
  createClaudeAgentSession,
  canonicalMessageHash,
  canonicalToolName,
  userFacingProviderError,
  collectExactMcpTools,
  validateInitialClaudeCursor,
  DEFAULT_INITIALIZE_TIMEOUT_MS,
  DEFAULT_PERSISTENCE_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_TURN_TIMEOUT_MS,
  DEFAULT_MAX_FRAME_BYTES,
  DEFAULT_MAX_TURN_BYTES,
  DEFAULT_MAX_GENERATION_BYTES,
  DEFAULT_MAX_RAW_OUTPUT_BYTES,
  DEFAULT_DIAGNOSTIC_BYTES,
  DEFAULT_CLOSE_DRAIN_TIMEOUT_MS,
};
