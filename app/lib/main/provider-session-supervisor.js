'use strict';

const { randomUUID } = require('crypto');
const {
  ProviderRuntimeError,
  immutableClone,
  validateDesiredState,
  validateTurnRequest,
  validateEventPayload,
  validateProviderSession,
  isTerminalEvent,
} = require('./provider-session-contract');

const DEFAULT_TURN_TIMEOUT_MS = 180_000;
const DEFAULT_INTERRUPT_GRACE_MS = 5_000;
const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_RETRY_CAP_MS = 30_000;
const DEFAULT_RETRY_WINDOW_MS = 60_000;
const DEFAULT_RETRY_MAX_ATTEMPTS = 5;
const DEFAULT_CIRCUIT_OPEN_MS = 60_000;
const DEFAULT_HEALTHY_RESET_MS = 120_000;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject, settled: false };
}

function safeFailure({ provider, conversationId, turnId, code, error, retryable = false, interrupted = false }) {
  return Object.freeze({
    ok: false,
    provider,
    conversationId,
    turnId,
    interrupted,
    retryable,
    code,
    error,
    timings: Object.freeze({}),
  });
}

function errorCode(error, fallback = 'PROVIDER_START_FAILED') {
  return error && typeof error.code === 'string' ? error.code : fallback;
}

function safeErrorText(error, fallback = 'Provider runtime is unavailable.') {
  if (error instanceof ProviderRuntimeError) return error.message;
  return fallback;
}

function retryableError(error) {
  return Boolean(error && error.retryable === true);
}

function freezeContext(context) {
  Object.defineProperty(context, 'toJSON', {
    value: () => undefined,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(context);
}

class ProviderSessionSupervisor {
  constructor({
    adapterFactory,
    generationContextFactory = null,
    invalidateSecurity = async () => {},
    onEvent = async () => {},
    commitSuccess = async () => {},
    uuid = randomUUID,
    now = Date.now,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    queueTask = queueMicrotask,
    turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS,
    interruptGraceMs = DEFAULT_INTERRUPT_GRACE_MS,
    retryBaseMs = DEFAULT_RETRY_BASE_MS,
    retryCapMs = DEFAULT_RETRY_CAP_MS,
    retryWindowMs = DEFAULT_RETRY_WINDOW_MS,
    retryMaxAttempts = DEFAULT_RETRY_MAX_ATTEMPTS,
    circuitOpenMs = DEFAULT_CIRCUIT_OPEN_MS,
    healthyResetMs = DEFAULT_HEALTHY_RESET_MS,
    jitter = () => 1,
  } = {}) {
    if (typeof adapterFactory !== 'function') throw new TypeError('adapterFactory is required');
    this._adapterFactory = adapterFactory;
    this._generationContextFactory = generationContextFactory;
    this._invalidateSecurity = invalidateSecurity;
    this._onEvent = onEvent;
    this._commitSuccess = commitSuccess;
    this._uuid = uuid;
    this._now = now;
    this._setTimeout = setTimeoutFn;
    this._clearTimeout = clearTimeoutFn;
    this._queueTask = queueTask;
    this._turnTimeoutMs = Math.max(1, turnTimeoutMs);
    this._interruptGraceMs = Math.max(1, interruptGraceMs);
    this._retryBaseMs = Math.max(0, retryBaseMs);
    this._retryCapMs = Math.max(this._retryBaseMs, retryCapMs);
    this._retryWindowMs = Math.max(1, retryWindowMs);
    this._retryMaxAttempts = Math.max(1, retryMaxAttempts);
    this._circuitOpenMs = Math.max(1, circuitOpenMs);
    this._healthyResetMs = Math.max(1, healthyResetMs);
    this._jitter = jitter;

    this._state = 'stopped';
    this._desired = null;
    this._published = null;
    this._runtimeGeneration = 0;
    this._activeTurn = null;
    this._pendingTurn = null;
    this._dispatchBlocked = false;
    this._stopping = false;
    this._retryTimer = null;
    this._healthyTimer = null;
    this._failureStreak = 0;
    this._attemptTimes = [];
    this._circuitOpenUntil = 0;
    this._readyDeferred = deferred();
    this._lifecycle = Promise.resolve();
    this._inflightStarts = new Set();
    this._rotationRequests = 0;
    this._bindings = new Map();
    this._checkpoints = new Map();
    this._metrics = {
      staleEventDropped: 0,
      duplicateTerminalDropped: 0,
      supersededBeforeStart: 0,
      retryAttempts: 0,
      circuitOpened: 0,
      turnsStarted: 0,
      turnsCompleted: 0,
      turnsFailed: 0,
    };
  }

  async start(desiredState) {
    const desired = validateDesiredState(desiredState);
    if (this._state !== 'stopped') throw new ProviderRuntimeError('PROVIDER_ALREADY_STARTED', 'Provider runtime is already started.');
    this._desired = desired;
    this._stopping = false;
    this._dispatchBlocked = true;
    this._state = 'starting';
    this._readyDeferred = deferred();
    this._queueTask(() => {
      if (!this._stopping && this._state !== 'stopped') void this._trackStart();
    });
  }

  ready() {
    if (this._published && (this._state === 'ready' || this._state === 'busy'
      || this._state === 'interrupting' || this._state === 'draining')) {
      return Promise.resolve(Object.freeze({
        provider: this._published.desired.provider,
        runtimeGeneration: this._published.runtimeGeneration,
      }));
    }
    return this._readyDeferred.promise;
  }

  sendTurn(input) {
    const request = validateTurnRequest(input);
    const turnId = this._uuid();
    if (this._state === 'stopped' || !this._desired) {
      return Promise.resolve(safeFailure({
        provider: this._desired ? this._desired.provider : 'claude',
        conversationId: request.conversationId,
        turnId,
        code: 'PROVIDER_NOT_STARTED',
        error: 'Provider runtime has not started.',
      }));
    }
    if (this._isCircuitOpen()) {
      return Promise.resolve(safeFailure({
        provider: this._desired.provider,
        conversationId: request.conversationId,
        turnId,
        code: 'PROVIDER_CIRCUIT_OPEN',
        error: 'Provider connection could not be restored. Try again.',
        retryable: false,
      }));
    }
    if (this._state === 'failed' && !this._retryTimer) {
      return Promise.resolve(safeFailure({
        provider: this._desired ? this._desired.provider : 'claude',
        conversationId: request.conversationId,
        turnId,
        code: 'PROVIDER_UNAVAILABLE',
        error: 'Provider runtime is unavailable.',
      }));
    }

    const completion = deferred();
    const entry = {
      request,
      turnId,
      controller: new AbortController(),
      completion,
      sequence: 0,
      lastDeliveredSequence: 0,
      terminal: null,
      finalized: false,
      interruptStarted: false,
      timeoutTimer: null,
      interruptTimer: null,
      eventDrain: Promise.resolve(),
      generation: null,
      adapter: null,
      adapterDrainSettled: false,
    };

    if (this._activeTurn || this._pendingTurn || this._dispatchBlocked || !this._published) {
      if (this._pendingTurn) {
        const superseded = this._pendingTurn;
        this._pendingTurn = null;
        this._metrics.supersededBeforeStart += 1;
        this._resolveEntry(superseded, safeFailure({
          provider: this._desired.provider,
          conversationId: superseded.request.conversationId,
          turnId: superseded.turnId,
          code: 'SUPERSEDED_BEFORE_START',
          error: 'A newer request replaced this request before it started.',
          interrupted: true,
        }));
      }
      this._pendingTurn = entry;
      if (this._activeTurn && !this._dispatchBlocked && !this._activeTurn.interruptStarted) {
        void this._beginInterrupt(this._activeTurn, 'replaced_by_newer_turn');
      }
    } else {
      this._pendingTurn = entry;
    }
    this._pump();
    return completion.promise;
  }

  interrupt(turnId, reason = 'user_interrupt') {
    const active = this._activeTurn;
    if (!active || active.turnId !== turnId) return Promise.resolve(null);
    void this._beginInterrupt(active, reason);
    return active.completion.promise;
  }

  rotate(nextDesiredState, reason = 'configuration_changed') {
    const nextDesired = validateDesiredState(nextDesiredState);
    const previousDesired = this._desired;
    this._desired = nextDesired;
    this._dispatchBlocked = true;
    this._rotationRequests += 1;
    const operation = async () => {
      try {
        if (this._stopping || this._state === 'stopped') {
          throw new ProviderRuntimeError('PROVIDER_STOPPED', 'Provider runtime is stopped.');
        }
        this._state = 'rotating';
        const securityChanged = !previousDesired
          || nextDesired.securityGeneration !== previousDesired.securityGeneration;
        if (securityChanged) await this._invalidateSecurity({
          previousSecurityGeneration: previousDesired ? previousDesired.securityGeneration : null,
          nextSecurityGeneration: nextDesired.securityGeneration,
          reason,
        });
        if (this._activeTurn) await this.interrupt(this._activeTurn.turnId, reason);
        await this._stopPublished(reason);
        this._clearRetryTimer();
        if (this._stopping || this._state === 'stopped') {
          throw new ProviderRuntimeError('PROVIDER_STOPPED', 'Provider runtime is stopped.');
        }
        this._readyDeferred = deferred();
        this._failureStreak = 0;
        this._state = 'rotating';
        await this._trackStart();
        return this.ready();
      } finally {
        this._rotationRequests = Math.max(0, this._rotationRequests - 1);
      }
    };
    const result = this._lifecycle.then(operation, operation);
    this._lifecycle = result.catch(() => {});
    return result;
  }

  async stop(reason = 'app_shutdown') {
    if (this._state === 'stopped') return;
    this._stopping = true;
    this._dispatchBlocked = true;
    this._clearRetryTimer();
    this._clearHealthyTimer();
    const pending = this._pendingTurn;
    this._pendingTurn = null;
    if (pending) this._resolveEntry(pending, safeFailure({
      provider: this._desired.provider,
      conversationId: pending.request.conversationId,
      turnId: pending.turnId,
      code: 'PROVIDER_STOPPED',
      error: 'Provider runtime stopped.',
      interrupted: true,
    }));
    const active = this._activeTurn;
    if (active) {
      active.controller.abort(new ProviderRuntimeError('PROVIDER_STOPPED', 'Provider runtime stopped.'));
      try { await Promise.resolve(active.adapter.interrupt(active.turnId, reason)); } catch {}
    }
    this._fencePublished();
    await this._stopPublished(reason);
    if (this._inflightStarts.size > 0) {
      await Promise.allSettled([...this._inflightStarts]);
    }
    if (active && !active.finalized) {
      await this._finalize(active, safeFailure({
        provider: this._desired.provider,
        conversationId: active.request.conversationId,
        turnId: active.turnId,
        code: 'PROVIDER_STOPPED',
        error: 'Provider runtime stopped.',
        interrupted: true,
      }), { pump: false });
    }
    if (!this._readyDeferred.settled) {
      this._readyDeferred.settled = true;
      this._readyDeferred.reject(new ProviderRuntimeError('PROVIDER_STOPPED', 'Provider runtime stopped.'));
      this._readyDeferred.promise.catch(() => {});
    }
    this._state = 'stopped';
    this._stopping = false;
  }

  snapshot() {
    const published = this._published;
    return immutableClone({
      state: this._state,
      provider: this._desired ? this._desired.provider : null,
      runtimeGeneration: published ? published.runtimeGeneration : this._runtimeGeneration,
      configGeneration: this._desired ? this._desired.configGeneration : null,
      securityGeneration: this._desired ? this._desired.securityGeneration : null,
      ready: Boolean(published),
      activeTurnCount: this._activeTurn ? 1 : 0,
      pendingTurnCount: this._pendingTurn ? 1 : 0,
      bindingCount: this._bindings.size,
      checkpointCount: this._checkpoints.size,
      retry: {
        failureStreak: this._failureStreak,
        scheduled: this._retryTimer !== null,
        circuitOpenUntil: this._circuitOpenUntil || null,
      },
      metrics: { ...this._metrics },
    });
  }

  async _attemptStart() {
    if (this._stopping || this._state === 'stopped' || !this._desired) return;
    const desired = this._desired;
    this._clearRetryTimer();
    this._state = this._state === 'rotating' ? 'rotating' : 'starting';
    const runtimeGeneration = ++this._runtimeGeneration;
    const generationToken = { current: true };
    const initialProviderBinding = this._bindings.has(desired.conversationId)
      ? immutableClone(this._bindings.get(desired.conversationId))
      : null;
    const initialContinuationCheckpoint = this._checkpoints.has(desired.conversationId)
      ? immutableClone(this._checkpoints.get(desired.conversationId))
      : null;
    const baseContext = {
      runtimeGeneration,
      securityGeneration: desired.securityGeneration,
      processOwnerId: this._uuid(),
      initialProviderBinding,
      initialContinuationCheckpoint,
      assertCurrent: () => {
        if (!generationToken.current || !this._published
          || this._published.runtimeGeneration !== runtimeGeneration) {
          throw new ProviderRuntimeError('STALE_PROVIDER_GENERATION', 'Provider generation is no longer current.');
        }
      },
    };
    const supplied = this._generationContextFactory
      ? this._generationContextFactory({ ...baseContext, desiredState: desired })
      : {};
    const generationContext = freezeContext({ ...supplied, ...baseContext });
    let adapter;
    try {
      adapter = validateProviderSession(this._adapterFactory(desired.provider));
      await adapter.start(desired, generationContext);
      await adapter.ready();
      if (this._stopping || desired !== this._desired) {
        generationToken.current = false;
        await adapter.stop('stale_start');
        return;
      }
      this._published = { adapter, desired, runtimeGeneration, generationContext, generationToken };
      this._dispatchBlocked = false;
      this._state = 'ready';
      this._scheduleHealthyReset();
      if (!this._readyDeferred.settled) {
        this._readyDeferred.settled = true;
        this._readyDeferred.resolve(Object.freeze({ provider: desired.provider, runtimeGeneration }));
      }
      this._pump();
    } catch (error) {
      generationToken.current = false;
      if (adapter && typeof adapter.stop === 'function') {
        try { await adapter.stop('start_failed'); } catch {}
      }
      await this._handleStartFailure(error);
    }
  }

  _trackStart() {
    const task = this._attemptStart();
    this._inflightStarts.add(task);
    task.finally(() => this._inflightStarts.delete(task)).catch(() => {});
    return task;
  }

  async _handleStartFailure(error) {
    if (this._stopping) return;
    this._published = null;
    this._dispatchBlocked = true;
    if (!retryableError(error)) {
      this._state = 'failed';
      if (!this._readyDeferred.settled) {
        this._readyDeferred.settled = true;
        this._readyDeferred.reject(new ProviderRuntimeError(
          errorCode(error), safeErrorText(error), { retryable: false },
        ));
        this._readyDeferred.promise.catch(() => {});
      }
      this._failPendingUnavailable(errorCode(error), safeErrorText(error));
      return;
    }

    const now = this._now();
    this._attemptTimes = this._attemptTimes.filter((at) => now - at <= this._retryWindowMs);
    this._attemptTimes.push(now);
    this._failureStreak += 1;
    this._metrics.retryAttempts += 1;
    let delay;
    if (this._attemptTimes.length >= this._retryMaxAttempts) {
      this._circuitOpenUntil = now + this._circuitOpenMs;
      this._metrics.circuitOpened += 1;
      delay = this._circuitOpenMs;
      this._failPendingUnavailable('PROVIDER_CIRCUIT_OPEN',
        'Provider connection could not be restored. Try again.');
    } else {
      const raw = Math.min(this._retryCapMs, this._retryBaseMs * (2 ** (this._failureStreak - 1)));
      delay = Math.max(0, Math.round(raw * Math.max(0, Number(this._jitter()) || 0)));
    }
    this._state = 'backoff';
    this._retryTimer = this._setTimeout(() => {
      this._retryTimer = null;
      if (this._stopping || this._state === 'stopped') return;
      if (this._isCircuitOpen()) {
        const remaining = Math.max(1, this._circuitOpenUntil - this._now());
        this._retryTimer = this._setTimeout(() => {
          this._retryTimer = null;
          void this._trackStart();
        }, remaining);
        return;
      }
      void this._trackStart();
    }, delay);
  }

  _pump() {
    if (this._stopping || this._dispatchBlocked || this._activeTurn || !this._published || !this._pendingTurn) return;
    const entry = this._pendingTurn;
    this._pendingTurn = null;
    this._dispatch(entry);
  }

  _dispatch(entry) {
    const published = this._published;
    if (!published || this._dispatchBlocked) {
      this._pendingTurn = entry;
      return;
    }
    entry.adapter = published.adapter;
    entry.generation = published;
    this._activeTurn = entry;
    this._state = 'busy';
    this._metrics.turnsStarted += 1;
    entry.timeoutTimer = this._setTimeout(() => {
      entry.timeoutTimer = null;
      if (!entry.finalized) void this._beginInterrupt(entry, 'turn_timeout', true);
    }, this._turnTimeoutMs);

    const turn = Object.freeze({
      ...entry.request,
      turnId: entry.turnId,
      signal: entry.controller.signal,
    });
    const turnContext = freezeContext({
      assertCurrent: () => this._assertTurnCurrent(entry),
      emit: (type, payload, providerTurnId = null) => {
        this._assertTurnCurrent(entry);
        return this._acceptEvent(entry, type, payload, providerTurnId);
      },
    });

    Promise.resolve()
      .then(() => entry.adapter.sendTurn(turn, turnContext))
      .then((adapterResult) => this._adapterDrained(entry, adapterResult),
        (error) => this._adapterFailed(entry, error));
  }

  _assertTurnCurrent(entry) {
    if (entry.finalized || this._activeTurn !== entry || !this._published
      || entry.generation !== this._published || !entry.generation.generationToken.current) {
      this._metrics.staleEventDropped += 1;
      throw new ProviderRuntimeError('STALE_PROVIDER_TURN', 'Provider turn is no longer current.');
    }
  }

  _acceptEvent(entry, type, payload, providerTurnId) {
    validateEventPayload(type, payload, entry.generation.desired.provider);
    if (entry.finalized || this._activeTurn !== entry || entry.generation !== this._published) {
      this._metrics.staleEventDropped += 1;
      return false;
    }
    if (isTerminalEvent(type) && entry.terminal) {
      this._metrics.duplicateTerminalDropped += 1;
      return false;
    }
    const sequence = ++entry.sequence;
    const safePayload = immutableClone(payload);
    const event = Object.freeze({
      provider: entry.generation.desired.provider,
      runtimeGeneration: entry.generation.runtimeGeneration,
      configGeneration: entry.generation.desired.configGeneration,
      securityGeneration: entry.generation.desired.securityGeneration,
      clientSubmitId: entry.request.clientSubmitId,
      conversationId: entry.request.conversationId,
      turnId: entry.turnId,
      sequence,
      monotonicAtMs: this._now(),
      type,
      payload: safePayload,
      providerTurnId: providerTurnId || null,
    });
    if (sequence <= entry.lastDeliveredSequence) {
      this._metrics.staleEventDropped += 1;
      return false;
    }
    entry.lastDeliveredSequence = sequence;
    if (isTerminalEvent(type)) {
      entry.terminal = event;
      this._state = 'draining';
    }
    if (type === 'turn_completed') return true;
    entry.eventDrain = entry.eventDrain
      .then(() => this._onEvent(event))
      .catch((error) => { entry.dispatchError = error; });
    return true;
  }

  async _adapterDrained(entry, adapterResult) {
    if (entry.finalized || this._activeTurn !== entry) return;
    entry.adapterDrainSettled = true;
    if (!entry.terminal) {
      this._emitSupervisorFailure(entry, 'PROVIDER_ADAPTER_CONTRACT', false,
        'Provider ended without a canonical terminal event.');
    }
    await entry.eventDrain;
    if (entry.finalized || this._activeTurn !== entry) return;
    let result;
    let adapterCommitTransaction = null;
    try {
      if (entry.dispatchError) throw entry.dispatchError;
      result = this._resultFromTerminal(entry, adapterResult);
      if (result.ok) {
        if (typeof entry.adapter.commitTurn === 'function') {
          // A provider may return { rollback() } when acknowledging its cursor
          // changes local state that must remain reversible until history commits.
          adapterCommitTransaction = await entry.adapter.commitTurn(entry.turnId);
        }
        await this._commitSuccess(result);
        this._bindings.set(entry.request.conversationId, result.providerBinding);
        this._checkpoints.set(entry.request.conversationId, result.continuationCheckpoint);
      }
    } catch {
      let compensated = false;
      if (adapterCommitTransaction && typeof adapterCommitTransaction.rollback === 'function') {
        try {
          await adapterCommitTransaction.rollback();
          compensated = true;
        } catch {}
      }
      if (!compensated && typeof entry.adapter.rollbackTurn === 'function') {
        try { await entry.adapter.rollbackTurn(entry.turnId); } catch {}
      }
      result = safeFailure({
        provider: entry.generation.desired.provider,
        conversationId: entry.request.conversationId,
        turnId: entry.turnId,
        code: 'PROVIDER_COMMIT_FAILED',
        error: 'Provider result could not be committed.',
        retryable: false,
      });
      const sequence = ++entry.sequence;
      entry.lastDeliveredSequence = sequence;
      entry.terminal = Object.freeze({
        provider: entry.generation.desired.provider,
        runtimeGeneration: entry.generation.runtimeGeneration,
        configGeneration: entry.generation.desired.configGeneration,
        securityGeneration: entry.generation.desired.securityGeneration,
        clientSubmitId: entry.request.clientSubmitId,
        conversationId: entry.request.conversationId,
        turnId: entry.turnId,
        sequence,
        monotonicAtMs: this._now(),
        type: 'turn_failed',
        payload: Object.freeze({
          code: 'PROVIDER_COMMIT_FAILED',
          retryable: false,
          safeMessage: 'Provider result could not be committed.',
        }),
        providerTurnId: null,
      });
      try { await this._onEvent(entry.terminal); } catch {}
      await this._finalize(entry, result);
      return;
    }
    if (result.ok) {
      try { await this._onEvent(entry.terminal); } catch {}
    }
    await this._finalize(entry, result);
  }

  async _adapterFailed(entry, error) {
    if (entry.finalized || this._activeTurn !== entry) return;
    if (!entry.terminal) {
      this._emitSupervisorFailure(entry, errorCode(error, 'PROVIDER_TURN_FAILED'), retryableError(error),
        safeErrorText(error, 'Provider turn failed.'));
    }
    await entry.eventDrain;
    if (entry.finalized || this._activeTurn !== entry) return;
    await this._finalize(entry, this._resultFromTerminal(entry, null));
  }

  _emitSupervisorFailure(entry, code, retryable, safeMessage) {
    this._acceptEvent(entry, 'turn_failed', { code, retryable, safeMessage }, null);
  }

  _resultFromTerminal(entry, adapterResult) {
    const { type, payload } = entry.terminal;
    const common = {
      provider: entry.generation.desired.provider,
      conversationId: entry.request.conversationId,
      turnId: entry.turnId,
    };
    if (type === 'turn_completed') {
      const result = Object.freeze({
        ok: true,
        ...common,
        providerBinding: immutableClone(payload.providerBinding),
        continuationCheckpoint: immutableClone(payload.continuationCheckpoint),
        finalText: payload.finalText,
        usage: immutableClone(payload.usage),
        timings: immutableClone(adapterResult && adapterResult.timings ? adapterResult.timings : {}),
      });
      return result;
    }
    if (type === 'turn_interrupted') return safeFailure({
      ...common,
      code: 'PROVIDER_INTERRUPTED',
      error: payload.reason,
      interrupted: true,
    });
    return safeFailure({
      ...common,
      code: payload.code,
      error: payload.safeMessage,
      retryable: payload.retryable,
    });
  }

  async _beginInterrupt(entry, reason, fromTimeout = false) {
    if (entry.finalized || this._activeTurn !== entry) return;
    if (entry.interruptStarted) return entry.completion.promise;
    entry.interruptStarted = true;
    entry.controller.abort(new ProviderRuntimeError(
      fromTimeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_INTERRUPTED',
      fromTimeout ? 'Provider turn timed out.' : 'Provider turn was interrupted.',
      { retryable: fromTimeout },
    ));
    this._state = 'interrupting';
    try { await Promise.resolve(entry.adapter.interrupt(entry.turnId, reason)); } catch {}
    if (entry.finalized) return entry.completion.promise;
    entry.interruptTimer = this._setTimeout(() => {
      entry.interruptTimer = null;
      if (!entry.finalized) void this._forceInterruptTimeout(entry, reason, fromTimeout);
    }, this._interruptGraceMs);
    return entry.completion.promise;
  }

  async _forceInterruptTimeout(entry, reason, fromTimeout) {
    if (entry.finalized || this._activeTurn !== entry) return;
    this._dispatchBlocked = true;
    this._state = 'rotating';
    this._fencePublished();
    await this._stopPublished(`${reason}_grace_timeout`);
    if (!entry.terminal) {
      entry.terminal = {
        type: 'turn_failed',
        payload: {
          code: fromTimeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_INTERRUPT_TIMEOUT',
          retryable: true,
          safeMessage: fromTimeout ? 'Provider turn timed out.' : 'Provider interrupt timed out.',
        },
      };
    }
    await this._finalize(entry, this._resultFromTerminal(entry, null), { pump: false });
    if (!this._stopping && this._rotationRequests === 0) {
      this._readyDeferred = deferred();
      await this._trackStart();
    }
  }

  async _finalize(entry, result, { pump = true } = {}) {
    if (entry.finalized) return;
    entry.finalized = true;
    if (entry.timeoutTimer !== null) this._clearTimeout(entry.timeoutTimer);
    if (entry.interruptTimer !== null) this._clearTimeout(entry.interruptTimer);
    if (this._activeTurn === entry) this._activeTurn = null;
    if (result.ok) this._metrics.turnsCompleted += 1;
    else this._metrics.turnsFailed += 1;
    this._resolveEntry(entry, result);
    if (!this._stopping && this._published && !this._dispatchBlocked) this._state = 'ready';
    if (pump) this._pump();
  }

  _resolveEntry(entry, result) {
    if (entry.completion.settled) return;
    entry.completion.settled = true;
    entry.completion.resolve(result);
  }

  async _stopPublished(reason) {
    const published = this._published;
    this._published = null;
    if (!published) return;
    published.generationToken.current = false;
    await published.adapter.stop(reason);
  }

  _fencePublished() {
    if (this._published) this._published.generationToken.current = false;
  }

  _failPendingUnavailable(code, message) {
    const pending = this._pendingTurn;
    this._pendingTurn = null;
    if (!pending) return;
    this._resolveEntry(pending, safeFailure({
      provider: this._desired.provider,
      conversationId: pending.request.conversationId,
      turnId: pending.turnId,
      code,
      error: message,
    }));
  }

  _isCircuitOpen() {
    return this._circuitOpenUntil > this._now();
  }

  _scheduleHealthyReset() {
    this._clearHealthyTimer();
    this._healthyTimer = this._setTimeout(() => {
      this._healthyTimer = null;
      if (!this._published || this._stopping) return;
      this._failureStreak = 0;
      this._attemptTimes = [];
      this._circuitOpenUntil = 0;
    }, this._healthyResetMs);
  }

  _clearRetryTimer() {
    if (this._retryTimer === null) return;
    this._clearTimeout(this._retryTimer);
    this._retryTimer = null;
  }

  _clearHealthyTimer() {
    if (this._healthyTimer === null) return;
    this._clearTimeout(this._healthyTimer);
    this._healthyTimer = null;
  }
}

module.exports = {
  ProviderSessionSupervisor,
  DEFAULT_TURN_TIMEOUT_MS,
  DEFAULT_INTERRUPT_GRACE_MS,
};
