'use strict';

const { assertSessionStopsSucceeded } = require('./provider-session-shutdown');

const {
  CodexJsonlRpcClient,
  CodexProtocolError,
  DEFAULT_LIMITS,
} = require('./codex-jsonl-rpc-client');
const { classifyCanvasBlock, isRenderCanvasToolName } = require('./stream-json-parser');

const OVERLOAD_RPC_CODE = -32001;
const OVERLOAD_MESSAGE = 'Server overloaded; retry later.';
const MAX_OVERLOAD_RETRIES = 3;

class CodexSessionError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'CodexSessionError';
    this.code = code;
    if (options.providerStatus !== undefined) this.providerStatus = options.providerStatus;
    const source = options.cause;
    if (source?.actionNeeded !== undefined) this.actionNeeded = source.actionNeeded === true;
    if (source?.retryable !== undefined) this.retryable = source.retryable === true;
    if (source?.runtimeHome !== undefined) this.runtimeHome = source.runtimeHome;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function extractThreadId(result) {
  const value = result?.thread?.id ?? result?.threadId ?? result?.id;
  return typeof value === 'string' && value !== '' ? value : null;
}

function extractTurnId(value) {
  const turnId = value?.turn?.id ?? value?.turnId ?? value?.id;
  return typeof turnId === 'string' && turnId !== '' ? turnId : null;
}

function extractTurnStatus(value) {
  const status = value?.turn?.status ?? value?.status;
  return typeof status === 'string' ? status : null;
}

function stableNormalize(value) {
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (!value || typeof value !== 'object') return value;
  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    if (key === 'pluginId' && (value[key] === null || value[key] === undefined)) continue;
    normalized[key] = stableNormalize(value[key]);
  }
  return normalized;
}

function stableEqual(left, right) {
  return JSON.stringify(stableNormalize(left)) === JSON.stringify(stableNormalize(right));
}

function canonicalToolName(providerName) {
  const name = String(providerName || '');
  if (!name.startsWith('mcp__')) return name;
  const parts = name.split('__');
  return parts.length > 2 ? parts.slice(2).join('__') : name;
}

function numericUsage(value, prefix = '', output = {}) {
  if (Number.isFinite(value) && value >= 0 && prefix) {
    output[prefix] = value;
    return output;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
  for (const [key, child] of Object.entries(value)) {
    numericUsage(child, prefix ? `${prefix}_${key}` : key, output);
  }
  return output;
}

function normalizeMcpPage(result) {
  const data = result?.data ?? result?.items ?? result?.servers ?? [];
  if (!Array.isArray(data)) {
    throw new CodexSessionError('CODEX_MCP_INVENTORY_INVALID', 'Codex MCP inventory page was invalid');
  }
  return {
    data,
    nextCursor: result?.nextCursor ?? result?.next_cursor ?? null,
  };
}

function mcpToolNames(server) {
  const tools = server?.tools;
  if (Array.isArray(tools)) {
    return new Set(tools
      .map((tool) => typeof tool === 'string' ? tool : tool?.name)
      .filter((name) => typeof name === 'string' && name));
  }
  if (tools && typeof tools === 'object') {
    const names = [];
    for (const [key, tool] of Object.entries(tools)) {
      if (key) names.push(key);
      if (typeof tool?.name === 'string' && tool.name) names.push(tool.name);
    }
    return new Set(names);
  }
  return new Set();
}

function unqualifiedMcpToolName(name) {
  const parts = String(name || '').split('__');
  return parts[0] === 'mcp' && parts.length > 2 ? parts.slice(2).join('__') : String(name || '');
}

function assertRequiredMcpServer(actual, requirement) {
  if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement)) {
    throw new TypeError('desired.requiredMcpServer must be an object');
  }
  const name = requireNonEmptyString(requirement.name, 'desired.requiredMcpServer.name');
  const server = actual.find((entry) => entry?.name === name);
  if (!server) {
    throw new CodexSessionError('CODEX_MCP_REQUIRED_SERVER_MISSING', `Required Codex MCP server is missing: ${name}`);
  }
  const runtimeStatus = String(server.runtimeStatus ?? server.status ?? '').toLowerCase();
  if (server.enabled === false
    || ['authenticationrequired', 'cancelled', 'disabled', 'failed', 'error'].includes(runtimeStatus)) {
    throw new CodexSessionError('CODEX_MCP_REQUIRED_SERVER_DISABLED', `Required Codex MCP server is disabled: ${name}`);
  }
  const requiredTools = requirement.requiredTools ?? [];
  if (!Array.isArray(requiredTools) || requiredTools.some((tool) => typeof tool !== 'string' || !tool)) {
    throw new TypeError('desired.requiredMcpServer.requiredTools must be an array of non-empty strings');
  }
  const tools = mcpToolNames(server);
  const normalizedTools = new Set([...tools].map(unqualifiedMcpToolName));
  const missing = requiredTools.filter((tool) => !tools.has(tool)
    && !normalizedTools.has(unqualifiedMcpToolName(tool)));
  if (missing.length) {
    throw new CodexSessionError(
      'CODEX_MCP_REQUIRED_TOOL_MISSING',
      `Required Codex MCP tools are missing: ${missing.join(', ')}`,
    );
  }
}

function toolResultContent(item) {
  const result = item?.result ?? item?.content ?? null;
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    if (typeof result.content === 'string') return result.content;
    if (Array.isArray(result.content)) {
      const text = result.content
        .map((block) => typeof block === 'string' ? block : block?.text)
        .filter((value) => typeof value === 'string' && value)
        .join('\n');
      if (text) return text;
    }
    if (result.structuredContent && typeof result.structuredContent === 'object') {
      return JSON.stringify(result.structuredContent);
    }
  }
  return result == null ? '' : JSON.stringify(result);
}

function isProtocolOverload(error) {
  return error instanceof CodexProtocolError
    && error.code === 'CODEX_REQUEST_REJECTED'
    && error.rpcCode === OVERLOAD_RPC_CODE
    && error.overloaded === true;
}

function buildThreadStartParams(desired) {
  const params = {
    cwd: requireNonEmptyString(desired.cwd, 'desired.cwd'),
    approvalPolicy: 'never',
    sandbox: 'read-only',
    developerInstructions: String(desired.systemPrompt ?? desired.developerInstructions ?? ''),
    serviceName: 'athena',
  };
  if (desired.model) params.model = requireNonEmptyString(desired.model, 'desired.model');
  if (desired.threadStartConfigSupported !== false && desired.effort) {
    params.config = { model_reasoning_effort: desired.effort };
  }
  return params;
}

function buildTurnStartParams(turn, threadId, desired, includeOverrides) {
  const base = {
    threadId,
    clientUserMessageId: requireNonEmptyString(turn.turnId, 'turn.turnId'),
    input: [{ type: 'text', text: String(turn.userText ?? '') }],
  };
  if (!includeOverrides) return base;
  const params = {
    ...base,
    cwd: requireNonEmptyString(desired.cwd, 'desired.cwd'),
    approvalPolicy: 'never',
    sandboxPolicy: {
      type: 'readOnly',
      networkAccess: false,
    },
  };
  if (desired.model) params.model = requireNonEmptyString(desired.model, 'desired.model');
  if (desired.effort) params.effort = requireNonEmptyString(desired.effort, 'desired.effort');
  return params;
}

class CodexAppServerSession {
  constructor({
    runtime,
    random = Math.random,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    requestTimeoutMs = DEFAULT_LIMITS.requestTimeoutMs,
    startupTimeoutMs = 60_000,
    maxJsonlLineBytes = DEFAULT_LIMITS.maxJsonlLineBytes,
    maxTurnOutputBytes = DEFAULT_LIMITS.maxTurnOutputBytes,
    maxGenerationOutputBytes = DEFAULT_LIMITS.maxGenerationOutputBytes,
    maxStderrRingBytes = DEFAULT_LIMITS.maxStderrRingBytes,
    appVersion = '0.1.0',
  }) {
    if (!runtime || typeof runtime.spawnGenerationAppServer !== 'function') {
      throw new TypeError('runtime.spawnGenerationAppServer must be a function');
    }
    if (typeof random !== 'function') throw new TypeError('random must be a function');
    if (typeof sleep !== 'function') throw new TypeError('sleep must be a function');
    this._runtime = runtime;
    this._random = random;
    this._sleep = sleep;
    this._requestTimeoutMs = requestTimeoutMs;
    this._startupTimeoutMs = startupTimeoutMs;
    this._limits = {
      maxJsonlLineBytes,
      maxTurnOutputBytes,
      maxGenerationOutputBytes,
      maxStderrRingBytes,
    };
    this._appVersion = String(appVersion);
    this._state = 'stopped';
    this._desired = null;
    this._generationContext = null;
    this._child = null;
    this._terminationHandle = null;
    this._protocol = null;
    this._connectionSerial = 0;
    this._conversations = new Map();
    this._conversationTails = new Map();
    this._activeByAthenaTurn = new Map();
    this._activeByProviderTurn = new Map();
    this._activeByThread = new Map();
    this._readyPromise = null;
    this._connectionFailure = null;
  }

  async start(desired, generationContext) {
    if (this._state !== 'stopped') {
      throw new CodexSessionError('CODEX_ALREADY_STARTED', 'Codex app-server session already started');
    }
    if (!generationContext?.spawnContext
      || typeof generationContext.spawnContext.assertCurrent !== 'function') {
      throw new TypeError('generationContext.spawnContext.assertCurrent is required');
    }
    this._state = 'starting';
    this._desired = Object.freeze({ ...desired });
    this._generationContext = generationContext;
    this._seedConversationThreads(desired?.conversationThreads);
    generationContext.spawnContext.assertCurrent();

    let spawned;
    try {
      spawned = this._runtime.spawnGenerationAppServer(generationContext);
    } catch (cause) {
      this._state = 'failed';
      if (cause?.actionNeeded === true) throw cause;
      throw new CodexSessionError('CODEX_SPAWN_FAILED', 'Unable to start Codex app-server', { cause });
    }
    if (!spawned?.child?.stdin || !spawned?.child?.stdout || !spawned?.child?.stderr) {
      this._state = 'failed';
      throw new CodexSessionError('CODEX_INVALID_CHILD', 'Codex runtime returned an invalid child process');
    }
    this._child = spawned.child;
    this._terminationHandle = spawned.terminationHandle;
    const connectionSerial = ++this._connectionSerial;
    this._protocol = new CodexJsonlRpcClient({
      writeLine: (line) => {
        if (this._connectionSerial !== connectionSerial || this._state === 'stopped') {
          throw new CodexSessionError('CODEX_STALE_GENERATION', 'Codex connection is stale');
        }
        if (!this._child.stdin.write(line, 'utf8')) {
          // Node streams preserve write order while applying their own bounded backpressure.
        }
      },
      beforeWrite: () => generationContext.spawnContext.assertCurrent(),
      onNotification: (notification) => this._handleNotification(notification, connectionSerial),
      requestTimeoutMs: this._requestTimeoutMs,
      ...this._limits,
    });
    this._attachChild(connectionSerial);

    this._readyPromise = this._initialize();
    try {
      await this._readyPromise;
      generationContext.spawnContext.assertCurrent();
      this._state = 'ready';
    } catch (cause) {
      this._state = 'failed';
      await this._terminateRegisteredChild();
      if (cause instanceof CodexSessionError) throw cause;
      if (cause instanceof CodexProtocolError) {
        throw new CodexSessionError(
          cause.code,
          'Codex app-server initialization was rejected',
          { cause },
        );
      }
      throw new CodexSessionError('CODEX_INITIALIZE_FAILED', 'Codex initialize failed', { cause });
    }
  }

  async ready() {
    if (!this._readyPromise) {
      throw new CodexSessionError('CODEX_NOT_STARTED', 'Codex app-server session has not started');
    }
    await this._readyPromise;
    if (this._state !== 'ready') {
      throw this._connectionFailure
        || new CodexSessionError('CODEX_NOT_READY', 'Codex app-server session is not ready');
    }
    return {
      provider: 'codex',
      runtimeGeneration: this._generationContext.runtimeGeneration,
    };
  }

  sendTurn(turn, turnContext) {
    requireNonEmptyString(turn?.conversationId, 'turn.conversationId');
    requireNonEmptyString(turn?.turnId, 'turn.turnId');
    if (!turnContext || typeof turnContext.emit !== 'function') {
      throw new TypeError('turnContext.emit must be a function');
    }
    if (this._state !== 'ready') {
      return Promise.reject(this._connectionFailure
        || new CodexSessionError('CODEX_NOT_READY', 'Codex app-server session is not ready'));
    }
    const conversationId = turn.conversationId;
    const previous = this._conversationTails.get(conversationId) || Promise.resolve();
    const task = previous.then(
      () => this._runTurn(turn, turnContext),
      () => this._runTurn(turn, turnContext),
    );
    const tail = task.catch(() => {});
    this._conversationTails.set(conversationId, tail);
    tail.finally(() => {
      if (this._conversationTails.get(conversationId) === tail) {
        this._conversationTails.delete(conversationId);
      }
    });
    return task;
  }

  async warmConversation(conversationId = '__warm__') {
    requireNonEmptyString(conversationId, 'conversationId');
    await this.ready();
    const conversation = await this._ensureConversation(conversationId);
    await this._verifyMcpInventory(conversation);
    this._assertCurrent();
    return { threadId: conversation.threadId };
  }

  async interrupt(athenaTurnId, reason = 'user') {
    const active = this._activeByAthenaTurn.get(athenaTurnId);
    if (!active) return null;
    const providerTurnId = active.providerTurnId || await active.providerStarted.promise;
    if (active.completed) return active.terminal.promise;
    try {
      await this._protocol.request('turn/interrupt', {
        threadId: active.threadId,
        turnId: providerTurnId,
      });
    } catch (cause) {
      if (!active.completed) {
        this._failActive(active, new CodexSessionError(
          'CODEX_INTERRUPT_FAILED',
          `Codex interrupt request failed (${String(reason)})`,
          { cause },
        ));
      }
    }
    return active.terminal.promise;
  }

  async stop() {
    if (this._state === 'stopped') return;
    this._state = 'stopping';
    this._connectionSerial += 1;
    const stoppedError = new CodexSessionError('CODEX_STOPPED', 'Codex app-server session stopped');
    this._protocol?.failPending('CODEX_STOPPED', stoppedError.message);
    for (const active of [...this._activeByAthenaTurn.values()]) {
      this._failActive(active, stoppedError);
    }
    try {
      this._child?.stdin?.end?.();
    } catch {
      // Termination handle remains authoritative.
    }
    await this._terminateRegisteredChild();
    this._protocol = null;
    this._child = null;
    this._state = 'stopped';
  }

  snapshot() {
    return {
      state: this._state,
      pid: this._child?.pid ?? null,
      runtimeGeneration: this._generationContext?.runtimeGeneration ?? null,
      pendingRequestCount: this._protocol?.pendingRequestCount ?? 0,
      conversationThreads: Object.fromEntries(
        [...this._conversations.entries()].map(([conversationId, entry]) => [conversationId, entry.threadId]),
      ),
      conversationCursors: Object.fromEntries(
        [...this._conversations.entries()].map(([conversationId, entry]) => [conversationId, {
          threadId: entry.threadId,
          lastSuccessfulTurnId: entry.lastSuccessfulTurnId,
        }]),
      ),
      activeTurnCount: this._activeByAthenaTurn.size,
      generationOutputBytes: this._protocol?.generationOutputBytes ?? 0,
    };
  }

  async _initialize() {
    const result = await this._protocol.request('initialize', {
      clientInfo: {
        name: 'athena',
        title: 'Athena',
        version: this._appVersion,
      },
      capabilities: { experimentalApi: false },
    }, { timeoutMs: this._startupTimeoutMs });
    this._protocol.notify('initialized');
    return result;
  }

  _seedConversationThreads(conversationThreads) {
    if (!conversationThreads || typeof conversationThreads !== 'object') return;
    for (const [conversationId, cursor] of Object.entries(conversationThreads)) {
      const threadId = typeof cursor === 'string' ? cursor : cursor?.threadId;
      if (typeof threadId !== 'string' || threadId === '') continue;
      this._conversations.set(conversationId, {
        threadId,
        needsResume: true,
        needsRecovery: false,
        lastSuccessfulTurnId: typeof cursor === 'object' ? cursor.lastSuccessfulTurnId || null : null,
        firstTurnInGeneration: true,
        mcpVerified: false,
      });
    }
  }

  async _runTurn(turn, turnContext) {
    this._assertCurrent();
    const conversation = await this._ensureConversation(turn.conversationId);
    if (conversation.needsRecovery) await this._recoverConversation(conversation);
    await this._verifyMcpInventory(conversation);
    this._assertCurrent();

    const active = this._createActiveTurn(turn, turnContext, conversation);
    const params = buildTurnStartParams(
      turn,
      conversation.threadId,
      this._desired,
      conversation.firstTurnInGeneration,
    );
    conversation.firstTurnInGeneration = false;
    try {
      const startResult = await this._requestTurnStart(params, active);
      const providerTurnId = extractTurnId(startResult) || active.providerTurnId;
      if (!providerTurnId) {
        throw new CodexSessionError('CODEX_TURN_ID_MISSING', 'Codex turn/start response omitted turn id');
      }
      this._setProviderTurnId(active, providerTurnId);
      return await active.terminal.promise;
    } catch (cause) {
      if (!active.completed) {
        const error = cause instanceof CodexSessionError
          ? cause
          : cause instanceof CodexProtocolError && cause.code === 'CODEX_REQUEST_REJECTED'
            ? new CodexSessionError('CODEX_REQUEST_REJECTED', 'Codex turn request was rejected', { cause })
            : cause;
        this._failActive(active, error);
      }
      return active.terminal.promise;
    }
  }

  async _requestTurnStart(params, active) {
    let retry = 0;
    while (true) {
      this._assertCurrent();
      try {
        return await this._protocol.request('turn/start', params);
      } catch (error) {
        if (!isProtocolOverload(error) || active.started || retry >= MAX_OVERLOAD_RETRIES) throw error;
        const base = Math.min(30_000, 250 * (2 ** retry));
        const jitter = 0.5 + this._random();
        retry += 1;
        await this._sleep(base * jitter);
      }
    }
  }

  async _ensureConversation(conversationId) {
    let entry = this._conversations.get(conversationId);
    if (entry?.needsResume) {
      const result = await this._protocol.request('thread/resume', { threadId: entry.threadId });
      const resumedId = extractThreadId(result);
      if (!resumedId) {
        throw new CodexSessionError('CODEX_THREAD_ID_MISSING', 'Codex thread/resume response omitted thread id');
      }
      entry.threadId = resumedId;
      entry.needsResume = false;
      entry.firstTurnInGeneration = true;
      entry.mcpVerified = false;
      return entry;
    }
    if (entry) return entry;

    const result = await this._protocol.request('thread/start', buildThreadStartParams(this._desired));
    const threadId = extractThreadId(result);
    if (!threadId) {
      throw new CodexSessionError('CODEX_THREAD_ID_MISSING', 'Codex thread/start response omitted thread id');
    }
    entry = {
      threadId,
      needsResume: false,
      needsRecovery: false,
      lastSuccessfulTurnId: null,
      firstTurnInGeneration: true,
      mcpVerified: false,
    };
    this._conversations.set(conversationId, entry);
    return entry;
  }

  async _recoverConversation(entry) {
    let result;
    if (entry.lastSuccessfulTurnId) {
      result = await this._protocol.request('thread/fork', {
        threadId: entry.threadId,
        lastTurnId: entry.lastSuccessfulTurnId,
      });
    } else {
      result = await this._protocol.request('thread/start', buildThreadStartParams(this._desired));
    }
    const threadId = extractThreadId(result);
    if (!threadId) {
      throw new CodexSessionError('CODEX_RECOVERY_FAILED', 'Codex recovery response omitted thread id');
    }
    entry.threadId = threadId;
    entry.needsRecovery = false;
    entry.needsResume = false;
    entry.firstTurnInGeneration = true;
    entry.mcpVerified = false;
  }

  async _verifyMcpInventory(entry) {
    const expected = this._desired.expectedMcpServers
      ?? this._desired.mcpSnapshot?.codexServers
      ?? this._desired.mcpSnapshot?.expectedCodexServers;
    const required = this._desired.requiredMcpServer;
    const audit = this._desired.mcpAudit;
    if ((expected === undefined && required === undefined && !audit) || entry.mcpVerified) return;
    if (audit && typeof audit.validate !== 'function') {
      throw new TypeError('desired.mcpAudit.validate must be a function');
    }
    if (expected !== undefined && !Array.isArray(expected)) {
      throw new TypeError('desired.expectedMcpServers must be an array');
    }
    const actual = [];
    const configAudit = await this._protocol.request('config/read', {
      cwd: requireNonEmptyString(this._desired.cwd, 'desired.cwd'),
      includeLayers: true,
    });
    if (!configAudit || typeof configAudit !== 'object') {
      throw new CodexSessionError('CODEX_CONFIG_AUDIT_INVALID', 'Codex config provenance audit was invalid');
    }
    let cursor = null;
    do {
      const params = {
        threadId: entry.threadId,
        detail: 'full',
        cursor,
        limit: this._desired.mcpPageLimit ?? this._desired.mcpSnapshot?.pageLimit ?? 100,
      };
      const page = normalizeMcpPage(await this._protocol.request('mcpServerStatus/list', params));
      actual.push(...page.data);
      cursor = page.nextCursor || null;
    } while (cursor !== null);

    if (expected !== undefined && !stableEqual(actual, expected)) {
      throw new CodexSessionError(
        'CODEX_MCP_INVENTORY_MISMATCH',
        'Codex effective MCP inventory did not match the Athena snapshot',
      );
    }
    if (required !== undefined) assertRequiredMcpServer(actual, required);
    if (audit) await audit.validate({ configAudit, servers: actual });
    entry.mcpVerified = true;
  }

  _createActiveTurn(turn, turnContext, conversation) {
    const terminal = deferred();
    const providerStarted = deferred();
    // Avoid unhandled rejections when a turn fails before an interrupt waiter exists.
    providerStarted.promise.catch(() => {});
    terminal.promise.catch(() => {});
    const active = {
      athenaTurnId: turn.turnId,
      conversationId: turn.conversationId,
      threadId: conversation.threadId,
      conversation,
      turnContext,
      terminal,
      providerStarted,
      providerTurnId: null,
      started: false,
      completed: false,
      finalText: '',
      usage: {},
    };
    this._activeByAthenaTurn.set(turn.turnId, active);
    this._activeByThread.set(conversation.threadId, active);
    this._protocol.beginTurn(turn.turnId);
    return active;
  }

  _setProviderTurnId(active, providerTurnId) {
    if (active.providerTurnId && active.providerTurnId !== providerTurnId) {
      this._failActive(active, new CodexSessionError(
        'CODEX_TURN_CORRELATION_MISMATCH',
        'Codex turn identifiers did not correlate',
      ));
      return;
    }
    if (!active.providerTurnId) {
      active.providerTurnId = providerTurnId;
      this._activeByProviderTurn.set(providerTurnId, active);
      active.providerStarted.resolve(providerTurnId);
    }
  }

  _handleNotification(notification, connectionSerial) {
    if (connectionSerial !== this._connectionSerial || this._state === 'stopped') return;
    try {
      this._assertCurrent();
    } catch {
      return;
    }
    const params = notification.params || {};
    const providerTurnId = extractTurnId(params);
    const threadId = params?.turn?.threadId ?? params.threadId ?? null;
    const active = (providerTurnId && this._activeByProviderTurn.get(providerTurnId))
      || (threadId && this._activeByThread.get(threadId));

    switch (notification.method) {
      case 'turn/started':
        if (!active || !providerTurnId) return;
        this._setProviderTurnId(active, providerTurnId);
        if (active.started) return;
        active.started = true;
        this._emitActive(active, 'turn_started', { providerTurnId }, providerTurnId);
        return;
      case 'item/agentMessage/delta':
        if (!active) return;
        active.finalText += String(params.delta ?? '');
        if (params.delta) this._emitActive(active, 'text_delta', { text: String(params.delta) }, providerTurnId);
        return;
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
        if (!active) return;
        if (params.delta) this._emitActive(active, 'thinking_delta', { text: String(params.delta) }, providerTurnId);
        return;
      case 'thread/tokenUsage/updated':
        if (!active) return;
        active.usage = numericUsage(params.tokenUsage ?? params.usage ?? {});
        this._emitActive(active, 'usage_updated', active.usage, providerTurnId);
        return;
      case 'item/started':
        this._emitItem(active, params, false, providerTurnId);
        return;
      case 'item/completed':
        this._emitItem(active, params, true, providerTurnId);
        return;
      case 'turn/completed':
        if (!active || !providerTurnId) return;
        this._setProviderTurnId(active, providerTurnId);
        this._completeActive(active, extractTurnStatus(params) || 'failed', params);
        return;
      default:
        // Stable app-server can add informational notifications. Unknown variants
        // are never interpreted as a tool or terminal success.
    }
  }

  _emitItem(active, params, completed, providerTurnId) {
    if (!active) return;
    const item = params.item || {};
    const itemType = String(item.type || '');
    if (itemType === 'mcpToolCall' || itemType === 'mcp_tool_call') {
      const toolUseId = String(item.id || '');
      const providerToolName = String(item.name ?? item.toolName ?? '');
      if (!toolUseId || !providerToolName) return;
      if (completed) {
        const content = toolResultContent(item);
        this._emitActive(active, 'tool_completed', {
          toolUseId,
          canonicalToolName: canonicalToolName(providerToolName),
          isError: Boolean(item.error),
          content,
        }, providerTurnId);
        if (!item.error && isRenderCanvasToolName(providerToolName)) {
          const canvas = classifyCanvasBlock({ toolUseId, content, isError: false, meta: null });
          if (canvas.envelope) this._emitActive(active, 'canvas_result', canvas, providerTurnId);
        }
      } else {
        this._emitActive(active, 'tool_started', {
          toolUseId,
          parentToolUseId: item.parentId ?? null,
          canonicalToolName: canonicalToolName(providerToolName),
          providerToolName,
          input: item.arguments ?? item.input ?? {},
        }, providerTurnId);
      }
      return;
    }
    if (itemType === 'collabAgentToolCall' || itemType === 'collaboration') {
      this._emitActive(active, 'subagent_updated', {
        taskId: String(item.id || 'unknown'),
        parentToolUseId: item.parentId ?? null,
        subtype: itemType,
        description: String(item.description || 'Codex collaboration task'),
        status: completed ? 'completed' : 'started',
        lastCanonicalToolName: null,
        elapsedMs: Number(item.elapsedMs) || 0,
      }, providerTurnId);
    }
  }

  _completeActive(active, status, params = {}) {
    if (active.completed) return;
    const binding = { provider: 'codex', threadId: active.threadId };
    if (status === 'completed') {
      active.completed = true;
      active.conversation.lastSuccessfulTurnId = active.providerTurnId;
      active.conversation.needsRecovery = false;
      const checkpoint = { provider: 'codex', turnId: active.providerTurnId };
      const result = {
        status: 'completed',
        providerBinding: binding,
        continuationCheckpoint: checkpoint,
        finalText: active.finalText || String(params?.turn?.summary ?? params.summary ?? ''),
        usage: active.usage,
      };
      this._emitActive(active, 'turn_completed', {
        providerBinding: binding,
        continuationCheckpoint: checkpoint,
        finalText: result.finalText,
        usage: result.usage,
      }, active.providerTurnId);
      this._cleanupActive(active);
      active.terminal.resolve(result);
      return;
    }

    active.conversation.needsRecovery = true;
    if (status === 'interrupted') {
      active.completed = true;
      const result = { status: 'interrupted', providerBinding: binding };
      this._emitActive(active, 'turn_interrupted', {
        providerBinding: binding,
        reason: 'interrupt',
      }, active.providerTurnId);
      this._cleanupActive(active);
      active.terminal.resolve(result);
      return;
    }
    this._failActive(active, new CodexSessionError(
      'CODEX_TURN_FAILED',
      'Codex turn failed',
      { providerStatus: status },
    ));
  }

  _failActive(active, error) {
    if (active.completed) return;
    active.completed = true;
    active.conversation.needsRecovery = active.started || Boolean(active.providerTurnId);
    active.providerStarted.reject(error);
    this._emitActive(active, 'turn_failed', {
      code: error?.code || 'CODEX_TURN_FAILED',
      retryable: error?.code === 'CODEX_PROCESS_EXITED' || error?.code === 'CODEX_REQUEST_TIMEOUT',
      safeMessage: 'Codex turn failed.',
    }, active.providerTurnId);
    this._cleanupActive(active);
    active.terminal.reject(error);
  }

  _cleanupActive(active) {
    this._protocol?.endTurn(active.athenaTurnId);
    this._activeByAthenaTurn.delete(active.athenaTurnId);
    if (active.providerTurnId) this._activeByProviderTurn.delete(active.providerTurnId);
    if (this._activeByThread.get(active.threadId) === active) this._activeByThread.delete(active.threadId);
  }

  _emitActive(active, type, payload, providerTurnId) {
    try {
      active.turnContext.assertCurrent?.();
      active.turnContext.emit(type, payload, providerTurnId);
      return true;
    } catch {
      return false;
    }
  }

  _attachChild(connectionSerial) {
    const child = this._child;
    child.stdout.on('data', (chunk) => {
      if (connectionSerial !== this._connectionSerial) return;
      try {
        this._protocol.acceptStdoutChunk(chunk);
      } catch (error) {
        this._failConnection(error, connectionSerial);
      }
    });
    child.stdout.on('end', () => {
      if (connectionSerial !== this._connectionSerial) return;
      try {
        this._protocol.endStdout();
      } catch (error) {
        this._failConnection(error, connectionSerial);
      }
    });
    child.stderr.on('data', (chunk) => {
      if (connectionSerial === this._connectionSerial) this._protocol.acceptStderrChunk(chunk);
    });
    child.once('error', (cause) => {
      this._failConnection(new CodexSessionError(
        'CODEX_PROCESS_ERROR',
        'Codex app-server process failed',
        { cause },
      ), connectionSerial);
    });
    child.once('close', () => {
      if (connectionSerial !== this._connectionSerial || this._state === 'stopping') return;
      try {
        this._protocol.endStdout();
      } catch (error) {
        this._failConnection(error, connectionSerial);
        return;
      }
      this._failConnection(new CodexSessionError(
        'CODEX_PROCESS_EXITED',
        'Codex app-server exited',
      ), connectionSerial);
    });
  }

  _failConnection(error, connectionSerial) {
    if (connectionSerial !== this._connectionSerial || this._state === 'stopped') return;
    const failure = error instanceof CodexSessionError
      ? error
      : error instanceof CodexProtocolError
        ? new CodexSessionError(error.code, error.message, { cause: error })
        : new CodexSessionError('CODEX_PROTOCOL_FAILED', 'Codex protocol failed', { cause: error });
    this._connectionFailure = failure;
    this._state = 'failed';
    this._protocol.failPending(failure.code, failure.message);
    for (const entry of this._conversations.values()) entry.needsResume = true;
    for (const active of [...this._activeByAthenaTurn.values()]) this._failActive(active, failure);
    this._connectionSerial += 1;
  }

  _assertCurrent() {
    this._generationContext.spawnContext.assertCurrent();
    if (this._connectionFailure) throw this._connectionFailure;
  }

  async _terminateRegisteredChild() {
    const handle = this._terminationHandle;
    this._terminationHandle = null;
    if (!handle) return;
    if (typeof handle.terminate === 'function') assertSessionStopsSucceeded(await handle.terminate());
    else if (typeof handle.stop === 'function') assertSessionStopsSucceeded(await handle.stop());
  }
}

module.exports = {
  OVERLOAD_RPC_CODE,
  OVERLOAD_MESSAGE,
  CodexAppServerSession,
  CodexSessionError,
  buildThreadStartParams,
  buildTurnStartParams,
  stableNormalize,
  assertRequiredMcpServer,
  toolResultContent,
};
