'use strict';

const { spawn } = require('child_process');
const { StreamJsonSession } = require('./stream-json-parser');
const { killTree } = require('./proc-utils');
const { getClaudeBin } = require('./claude-bin');
const {
  DISALLOWED_EXECUTION_TOOLS,
  DISABLE_TOOL_SEARCH_ENV,
  MAX_STDOUT_BYTES,
} = require('./claude-runner');

const DEFAULT_POOL_SIZE = 8;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_WARMUP_TIMEOUT_MS = 30_000;
const DEFAULT_QUIET_BOUNDARY_MS = 25;
const DEFAULT_MAX_USER_TURNS = 32;
const DEFAULT_RESPAWN_BASE_DELAY_MS = 100;
const DEFAULT_RESPAWN_MAX_DELAY_MS = 5_000;
const EARLY_FAILURE_WINDOW_MS = 10_000;
const WARMUP_PROMPT = 'Reply exactly OK.';

function buildSelectorWorkerArgs({ model = null, effort = null } = {}) {
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--setting-sources', '',
    '--tools', '',
    '--disallowedTools', DISALLOWED_EXECUTION_TOOLS,
    '--no-session-persistence',
    '--max-turns', '1',
  ];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  return args;
}

function errorText(reason, fallback) {
  if (reason && reason.message) return String(reason.message);
  if (reason != null && String(reason)) return String(reason);
  return fallback;
}

function abortedResult(reason = null) {
  return {
    ok: false,
    exitCode: null,
    timedOut: false,
    aborted: true,
    stdoutCapped: false,
    error: errorText(reason, 'Selector Claude 요청이 중단됐다'),
    finalResult: null,
    stderr: '',
    diagnostics: null,
  };
}

function timedOutResult(timeoutMs, diagnostics = null) {
  return {
    ok: false,
    exitCode: null,
    timedOut: true,
    aborted: false,
    stdoutCapped: false,
    error: `왕복 타임아웃(${Math.round(timeoutMs / 1000)}s) — Selector Claude 요청을 종료했다`,
    finalResult: null,
    stderr: '',
    diagnostics,
  };
}

function userMessage(content) {
  return `${JSON.stringify({
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
  })}\n`;
}

class ClaudeSelectorWorkerPool {
  constructor({
    cwd,
    desiredSize = DEFAULT_POOL_SIZE,
    model = null,
    effort = null,
    claudeBin = getClaudeBin(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    warmupTimeoutMs = DEFAULT_WARMUP_TIMEOUT_MS,
    quietBoundaryMs = DEFAULT_QUIET_BOUNDARY_MS,
    maxUserTurns = DEFAULT_MAX_USER_TURNS,
    maxStdoutBytes = MAX_STDOUT_BYTES,
    spawnFn = spawn,
    killFn = killTree,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    nowFn = Date.now,
    env = process.env,
    envOverrides = {},
    respawnBaseDelayMs = DEFAULT_RESPAWN_BASE_DELAY_MS,
    respawnMaxDelayMs = DEFAULT_RESPAWN_MAX_DELAY_MS,
    earlyFailureWindowMs = EARLY_FAILURE_WINDOW_MS,
  } = {}) {
    if (!cwd) throw new TypeError('cwd가 필요하다');
    if (!Number.isInteger(desiredSize) || desiredSize < 1) {
      throw new TypeError('desiredSize는 1 이상의 정수여야 한다');
    }
    if (!Number.isInteger(maxUserTurns) || maxUserTurns < 1) {
      throw new TypeError('maxUserTurns는 1 이상의 정수여야 한다');
    }
    this._cwd = cwd;
    this._desiredSize = desiredSize;
    this._config = { model: model || null, effort: effort || null };
    this._claudeBin = claudeBin;
    this._timeoutMs = timeoutMs;
    this._warmupTimeoutMs = warmupTimeoutMs;
    this._quietBoundaryMs = Math.max(0, quietBoundaryMs);
    this._maxUserTurns = maxUserTurns;
    this._maxStdoutBytes = maxStdoutBytes;
    this._spawn = spawnFn;
    this._kill = killFn;
    this._setTimeout = setTimeoutFn;
    this._clearTimeout = clearTimeoutFn;
    this._now = nowFn;
    this._env = env;
    this._envOverrides = envOverrides;
    this._respawnBaseDelayMs = Math.max(0, respawnBaseDelayMs);
    this._respawnMaxDelayMs = Math.max(this._respawnBaseDelayMs, respawnMaxDelayMs);
    this._earlyFailureWindowMs = Math.max(0, earlyFailureWindowMs);
    this._started = false;
    this._stopping = false;
    this._generation = 1;
    this._servingGeneration = null;
    this._nextWorkerId = 1;
    this._workers = new Set();
    this._queue = [];
    this._respawnTimer = null;
    this._failureStreak = 0;
  }

  start() {
    if (this._started) return this.snapshot();
    this._started = true;
    this._stopping = false;
    this._failureStreak = 0;
    this._reconcile();
    return this.snapshot();
  }

  stop(reason = null) {
    this._stopping = true;
    this._started = false;
    if (this._respawnTimer !== null) {
      this._clearTimeout(this._respawnTimer);
      this._respawnTimer = null;
    }
    for (const queued of this._queue.splice(0)) {
      this._detachQueued(queued);
      queued.resolve(abortedResult(reason));
    }
    for (const worker of [...this._workers]) {
      this._terminateWorker(worker, abortedResult(reason), false, false);
    }
    this._stopping = false;
    return this.snapshot();
  }

  configure({ model = this._config.model, effort = this._config.effort, desiredSize = this._desiredSize } = {}) {
    if (!Number.isInteger(desiredSize) || desiredSize < 1) {
      throw new TypeError('desiredSize는 1 이상의 정수여야 한다');
    }
    const next = { model: model || null, effort: effort || null };
    const changed = next.model !== this._config.model
      || next.effort !== this._config.effort
      || desiredSize !== this._desiredSize;
    this._desiredSize = desiredSize;
    if (changed) {
      this._config = next;
      this._generation += 1;
      this._failureStreak = 0;
      if (this._respawnTimer !== null) {
        this._clearTimeout(this._respawnTimer);
        this._respawnTimer = null;
      }
      this._retireSupersededWorkers();
    }
    if (this._started) this._reconcile();
    return this.snapshot();
  }

  run({ prompt, signal, timeoutMs = this._timeoutMs, onEvent } = {}) {
    if (!prompt || !String(prompt).trim()) {
      return Promise.resolve({ ok: false, error: '질의가 비어 있다', diagnostics: null });
    }
    if (!this._started) return Promise.resolve(abortedResult('Selector Claude worker pool이 시작되지 않았다'));
    if (signal && signal.aborted) return Promise.resolve(abortedResult(signal.reason));
    return new Promise((resolve) => {
      const enqueuedAt = this._now();
      const queued = {
        prompt: String(prompt),
        signal,
        timeoutMs,
        onEvent,
        resolve,
        onAbort: null,
        queueTimer: null,
        deadline: timeoutMs > 0 ? enqueuedAt + timeoutMs : null,
      };
      if (signal) {
        queued.onAbort = () => {
          const index = this._queue.indexOf(queued);
          if (index < 0) return;
          this._queue.splice(index, 1);
          this._detachQueued(queued);
          resolve(abortedResult(signal.reason));
        };
        signal.addEventListener('abort', queued.onAbort, { once: true });
      }
      this._queue.push(queued);
      if (timeoutMs > 0) {
        queued.queueTimer = this._setTimeout(() => {
          const index = this._queue.indexOf(queued);
          if (index < 0) return;
          this._queue.splice(index, 1);
          this._detachQueued(queued);
          resolve(timedOutResult(timeoutMs));
        }, timeoutMs);
      }
      this._drain();
    });
  }

  snapshot() {
    const workers = [...this._workers];
    const healthyReady = workers.filter((worker) => this._isHealthyReady(worker));
    const readyCurrent = healthyReady.filter((worker) => worker.generation === this._generation).length;
    return {
      started: this._started,
      desiredSize: this._desiredSize,
      generation: this._generation,
      targetGeneration: this._generation,
      servingGeneration: this._servingGeneration,
      activation: readyCurrent >= this._desiredSize ? 'ready' : 'warming',
      readyCurrent,
      config: { ...this._config },
      queued: this._queue.length,
      workers: {
        total: workers.length,
        warming: workers.filter((worker) => worker.state === 'warming').length,
        ready: healthyReady.length,
        idle: healthyReady.filter((worker) => worker.state === 'idle').length,
        busy: workers.filter((worker) => worker.state === 'busy').length,
        quiet: workers.filter((worker) => worker.state === 'quiet').length,
        stale: workers.filter((worker) => worker.generation !== this._generation).length,
      },
    };
  }

  _reconcile() {
    if (!this._started || this._stopping) return;
    if (this._respawnTimer === null) {
      let provisioned = this._provisionedCurrent().length;
      while (provisioned < this._desiredSize) {
        if (!this._spawnWorker()) break;
        provisioned += 1;
      }
    }
    if (this._hasFullReadyCurrent()) this._servingGeneration = this._generation;
    this._retireEligibleWorkers();
    this._drain();
  }

  _spawnWorker() {
    let child;
    try {
      child = this._spawn(this._claudeBin, buildSelectorWorkerArgs(this._config), {
        cwd: this._cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...this._env, ...this._envOverrides, ...DISABLE_TOOL_SEARCH_ENV },
        windowsHide: true,
        shell: false,
      });
    } catch {
      this._recordFailure(0, false);
      return false;
    }
    const worker = {
      id: this._nextWorkerId++,
      generation: this._generation,
      child,
      bornAt: this._now(),
      state: 'warming',
      warmupComplete: false,
      recyclePending: false,
      userTurns: 0,
      current: null,
      removed: false,
      killIssued: false,
    };
    this._workers.add(worker);
    if (child.stdout && typeof child.stdout.setEncoding === 'function') child.stdout.setEncoding('utf8');
    if (child.stderr && typeof child.stderr.setEncoding === 'function') child.stderr.setEncoding('utf8');
    if (child.stdin && typeof child.stdin.on === 'function') {
      child.stdin.on('error', (error) => this._handleTransportFailure(worker, null, error));
    }
    if (child.stdout && typeof child.stdout.on === 'function') {
      child.stdout.on('data', (chunk) => this._handleStdout(worker, chunk));
    }
    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', (chunk) => {
        if (worker.current) worker.current.stderr += String(chunk);
      });
    }
    child.on('error', (error) => this._handleTransportFailure(worker, null, error));
    child.on('close', (code) => this._handleTransportFailure(worker, code, null));
    return this._startWarmup(worker);
  }

  _startWarmup(worker) {
    const turn = this._createTurn('warmup', { prompt: WARMUP_PROMPT, timeoutMs: this._warmupTimeoutMs });
    worker.current = turn;
    worker.state = 'warming';
    this._armTurnTimeout(worker, turn);
    try {
      worker.child.stdin.write(userMessage(WARMUP_PROMPT));
      return true;
    } catch (error) {
      this._terminateWorker(worker, this._transportResult(worker, null, error), true, false);
      return false;
    }
  }

  _createTurn(kind, values) {
    return {
      kind,
      ...values,
      session: new StreamJsonSession(),
      stderr: '',
      stdoutBytes: 0,
      timer: null,
      quietTimer: null,
      onActiveAbort: null,
      sent: false,
      resultSeen: false,
      clientSettled: kind === 'warmup',
      discarded: kind === 'warmup',
    };
  }

  _handleStdout(worker, chunk) {
    const turn = worker.current;
    if (!turn || worker.removed) return;
    turn.stdoutBytes += Buffer.byteLength(String(chunk), 'utf8');
    if (turn.stdoutBytes > this._maxStdoutBytes) {
      const result = {
        ok: false,
        exitCode: null,
        timedOut: false,
        aborted: false,
        stdoutCapped: true,
        error: `stdout 누적 상한(${Math.round(this._maxStdoutBytes / 1_000_000)}MB) 초과 — claude selector worker를 교체했다`,
        finalResult: turn.session.finalResult(),
        stderr: turn.stderr,
        diagnostics: turn.session.diagnostics(),
      };
      this._terminateWorker(worker, result, true, true);
      return;
    }
    turn.session.feed(chunk, { onEvent: turn.discarded ? undefined : turn.onEvent });
    if (turn.resultSeen) {
      this._armQuietBoundary(worker, turn);
      return;
    }
    const finalResult = turn.session.finalResult();
    if (!finalResult) return;
    turn.resultSeen = true;
    this._clearTurnTimeout(turn);
    if (turn.kind === 'warmup') this._handleWarmupResult(worker, turn, finalResult);
    else this._handleUserResult(worker, turn, finalResult);
  }

  _handleWarmupResult(worker, turn, finalResult) {
    if (finalResult.is_error === true) {
      this._terminateWorker(worker, this._resultFromFinal(turn, finalResult), true, true);
      return;
    }
    worker.warmupComplete = true;
    worker.state = 'quiet';
    this._failureStreak = 0;
    this._armQuietBoundary(worker, turn);
    this._reconcile();
  }

  _handleUserResult(worker, turn, finalResult) {
    const result = this._resultFromFinal(turn, finalResult);
    if (!turn.clientSettled) {
      turn.clientSettled = true;
      turn.resolve(result);
    }
    if (finalResult.is_error === true || worker.userTurns >= this._maxUserTurns) {
      worker.recyclePending = true;
    }
    worker.state = 'quiet';
    this._armQuietBoundary(worker, turn);
    this._reconcile();
  }

  _resultFromFinal(turn, finalResult) {
    const isError = finalResult.is_error === true;
    return {
      ok: !isError,
      exitCode: null,
      timedOut: false,
      aborted: false,
      stdoutCapped: false,
      error: isError ? finalResult.result || 'Claude selector 분류가 실패했다' : null,
      finalResult,
      stderr: turn.stderr,
      diagnostics: turn.session.diagnostics(),
    };
  }

  _armTurnTimeout(worker, turn) {
    if (!(turn.timeoutMs > 0)) return;
    turn.timer = this._setTimeout(() => {
      const result = {
        ok: false,
        exitCode: null,
        timedOut: true,
        aborted: false,
        stdoutCapped: false,
        error: `왕복 타임아웃(${Math.round(turn.timeoutMs / 1000)}s) — claude selector worker를 교체했다`,
        finalResult: turn.session.finalResult(),
        stderr: turn.stderr,
        diagnostics: turn.session.diagnostics(),
      };
      this._terminateWorker(worker, result, true, true);
    }, turn.timeoutMs);
  }

  _armQuietBoundary(worker, turn) {
    if (turn.quietTimer !== null) this._clearTimeout(turn.quietTimer);
    if (this._quietBoundaryMs <= 0) {
      this._finishQuietBoundary(worker, turn);
      return;
    }
    turn.quietTimer = this._setTimeout(() => this._finishQuietBoundary(worker, turn), this._quietBoundaryMs);
  }

  _finishQuietBoundary(worker, turn) {
    if (worker.removed || worker.current !== turn || !turn.resultSeen) return;
    turn.quietTimer = null;
    this._detachActiveAbort(turn);
    worker.current = null;
    worker.state = 'idle';
    this._reconcile();
  }

  _drain() {
    if (!this._started || this._stopping || !this._queue.length) return;
    const candidates = [...this._workers]
      .filter((worker) => worker.state === 'idle' && this._isHealthyReady(worker))
      .filter((worker) => worker.generation === this._generation);
    for (const worker of candidates) {
      if (!this._queue.length) break;
      let queued = this._queue.shift();
      while (queued && queued.signal && queued.signal.aborted) {
        this._detachQueued(queued);
        queued.resolve(abortedResult(queued.signal.reason));
        queued = this._queue.shift();
      }
      if (!queued) break;
      this._assign(worker, queued);
    }
  }

  _assign(worker, queued) {
    this._detachQueued(queued);
    const remainingMs = queued.deadline === null
      ? queued.timeoutMs
      : Math.max(0, queued.deadline - this._now());
    if (queued.deadline !== null && remainingMs <= 0) {
      queued.resolve(timedOutResult(queued.timeoutMs));
      this._drain();
      return;
    }
    const turn = this._createTurn('user', { ...queued, timeoutMs: remainingMs });
    worker.current = turn;
    worker.state = 'busy';
    worker.userTurns += 1;
    if (turn.signal) {
      turn.onActiveAbort = () => {
        if (turn.clientSettled) return;
        turn.clientSettled = true;
        turn.discarded = true;
        this._detachActiveAbort(turn);
        turn.resolve(abortedResult(turn.signal.reason));
        if (!turn.sent && worker.current === turn) {
          this._clearTurnTimeout(turn);
          worker.current = null;
          worker.state = 'idle';
          worker.userTurns -= 1;
          this._drain();
        }
      };
      turn.signal.addEventListener('abort', turn.onActiveAbort, { once: true });
      if (turn.signal.aborted) {
        turn.onActiveAbort();
        return;
      }
    }
    this._armTurnTimeout(worker, turn);
    try {
      worker.child.stdin.write(userMessage(turn.prompt));
      turn.sent = true;
    } catch (error) {
      this._terminateWorker(worker, this._transportResult(worker, null, error), true, true);
    }
  }

  _handleTransportFailure(worker, code, error) {
    if (worker.removed) return;
    this._terminateWorker(worker, this._transportResult(worker, code, error), true, true);
  }

  _transportResult(worker, code, error) {
    const turn = worker.current;
    return {
      ok: false,
      exitCode: code,
      timedOut: false,
      aborted: false,
      stdoutCapped: false,
      error: errorText(error, `claude selector worker 종료 코드 ${code}`),
      finalResult: turn ? turn.session.finalResult() : null,
      stderr: turn ? turn.stderr : '',
      diagnostics: turn ? turn.session.diagnostics() : null,
    };
  }

  _terminateWorker(worker, clientResult, recordFailure, allowImmediate, suppressReconcile = false) {
    if (worker.removed) return;
    const lifetime = Math.max(0, this._now() - worker.bornAt);
    const turn = worker.current;
    if (turn) {
      this._clearTurnTimeout(turn);
      if (turn.quietTimer !== null) this._clearTimeout(turn.quietTimer);
      this._detachActiveAbort(turn);
      if (turn.kind === 'user' && !turn.clientSettled) {
        turn.clientSettled = true;
        turn.resolve(clientResult);
      }
    }
    worker.current = null;
    worker.removed = true;
    this._workers.delete(worker);
    this._killWorker(worker);
    if (!this._started || this._stopping) return;
    if (suppressReconcile) return;
    if (recordFailure && worker.generation === this._generation) {
      this._recordFailure(lifetime, allowImmediate);
    } else {
      this._reconcile();
    }
  }

  _killWorker(worker) {
    if (worker.killIssued) return;
    worker.killIssued = true;
    try {
      this._kill(worker.child);
    } catch {
      // Process replacement remains authoritative even if OS cleanup reports failure.
    }
  }

  _recordFailure(lifetime, allowImmediate) {
    if (!this._started || this._stopping) return;
    if (lifetime >= this._earlyFailureWindowMs) this._failureStreak = 0;
    this._failureStreak += 1;
    const delay = allowImmediate && this._failureStreak <= 1
      ? 0
      : Math.min(
        this._respawnMaxDelayMs,
        this._respawnBaseDelayMs * (2 ** Math.max(0, this._failureStreak - (allowImmediate ? 2 : 1))),
      );
    if (delay <= 0) {
      this._reconcile();
      return;
    }
    if (this._respawnTimer !== null) return;
    this._respawnTimer = this._setTimeout(() => {
      this._respawnTimer = null;
      this._reconcile();
    }, delay);
  }

  _retireEligibleWorkers() {
    if (!this._hasFullReadyCurrent()) return;
    for (const worker of [...this._workers]) {
      const stale = worker.generation !== this._generation;
      if ((!stale && !worker.recyclePending) || worker.state !== 'idle') continue;
      this._terminateWorker(worker, null, false, false);
    }
  }

  _retireSupersededWorkers() {
    for (const worker of [...this._workers]) {
      if (worker.generation === this._generation) continue;
      const drainingUserTurn = !!worker.current
        && worker.current.kind === 'user'
        && (worker.state === 'busy' || worker.state === 'quiet');
      const servingReady = worker.generation === this._servingGeneration
        && worker.warmupComplete
        && !worker.recyclePending
        && (worker.state === 'idle' || worker.state === 'busy' || worker.state === 'quiet');
      if (drainingUserTurn || servingReady) continue;
      // A superseded warmup has no client result to drain. Remove it before
      // provisioning the next target so repeated configure calls stay bounded.
      this._terminateWorker(worker, null, false, false, true);
    }
  }

  _hasFullReadyCurrent() {
    return [...this._workers].filter((worker) => (
      worker.generation === this._generation && this._isHealthyReady(worker)
    )).length >= this._desiredSize;
  }

  _isHealthyReady(worker) {
    return !worker.removed
      && worker.warmupComplete
      && !worker.recyclePending
      && (worker.state === 'idle' || worker.state === 'busy');
  }

  _provisionedCurrent() {
    return [...this._workers].filter((worker) => (
      worker.generation === this._generation && !worker.removed && !worker.recyclePending
    ));
  }

  _clearTurnTimeout(turn) {
    if (turn.timer === null) return;
    this._clearTimeout(turn.timer);
    turn.timer = null;
  }

  _detachQueued(queued) {
    if (queued.queueTimer !== null) {
      this._clearTimeout(queued.queueTimer);
      queued.queueTimer = null;
    }
    if (queued.signal && queued.onAbort) queued.signal.removeEventListener('abort', queued.onAbort);
  }

  _detachActiveAbort(turn) {
    if (turn.signal && turn.onActiveAbort) {
      turn.signal.removeEventListener('abort', turn.onActiveAbort);
      turn.onActiveAbort = null;
    }
  }
}

function createClaudeSelectorWorkerPool(options) {
  return new ClaudeSelectorWorkerPool(options);
}

module.exports = {
  DEFAULT_POOL_SIZE,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_WARMUP_TIMEOUT_MS,
  DEFAULT_QUIET_BOUNDARY_MS,
  DEFAULT_MAX_USER_TURNS,
  WARMUP_PROMPT,
  buildSelectorWorkerArgs,
  ClaudeSelectorWorkerPool,
  createClaudeSelectorWorkerPool,
};
