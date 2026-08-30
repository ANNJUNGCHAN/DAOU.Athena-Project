'use strict';

const DEFAULT_LIMITS = Object.freeze({
  maxJsonlLineBytes: 1_000_000,
  maxTurnOutputBytes: 5_000_000,
  maxGenerationOutputBytes: 256_000_000,
  maxStderrRingBytes: 256_000,
  requestTimeoutMs: 180_000,
});

class CodexProtocolError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'CodexProtocolError';
    this.code = code;
    if (options.rpcCode !== undefined) this.rpcCode = options.rpcCode;
    if (options.overloaded === true) this.overloaded = true;
  }
}

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function requireMethod(method) {
  if (typeof method !== 'string' || method.trim() === '') {
    throw new TypeError('method must be a non-empty string');
  }
  return method;
}

function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new CodexProtocolError('CODEX_INVALID_ENVELOPE', 'Codex envelope must be an object');
  }
  if (Object.prototype.hasOwnProperty.call(envelope, 'jsonrpc')) {
    throw new CodexProtocolError(
      'CODEX_JSONRPC_FORBIDDEN',
      'Codex app-server stdio envelopes must omit jsonrpc',
    );
  }
  return envelope;
}

class CodexAppServerProtocol {
  constructor({
    writeLine,
    onNotification = () => {},
    beforeWrite = () => {},
    maxJsonlLineBytes = DEFAULT_LIMITS.maxJsonlLineBytes,
    maxTurnOutputBytes = DEFAULT_LIMITS.maxTurnOutputBytes,
    maxGenerationOutputBytes = DEFAULT_LIMITS.maxGenerationOutputBytes,
    maxStderrRingBytes = DEFAULT_LIMITS.maxStderrRingBytes,
    requestTimeoutMs = DEFAULT_LIMITS.requestTimeoutMs,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }) {
    if (typeof writeLine !== 'function') throw new TypeError('writeLine must be a function');
    if (typeof onNotification !== 'function') throw new TypeError('onNotification must be a function');
    if (typeof beforeWrite !== 'function') throw new TypeError('beforeWrite must be a function');
    this._writeLine = writeLine;
    this._onNotification = onNotification;
    this._beforeWrite = beforeWrite;
    this._maxJsonlLineBytes = requirePositiveInteger(maxJsonlLineBytes, 'maxJsonlLineBytes');
    this._maxTurnOutputBytes = requirePositiveInteger(maxTurnOutputBytes, 'maxTurnOutputBytes');
    this._maxGenerationOutputBytes = requirePositiveInteger(maxGenerationOutputBytes, 'maxGenerationOutputBytes');
    this._maxStderrRingBytes = requirePositiveInteger(maxStderrRingBytes, 'maxStderrRingBytes');
    this._requestTimeoutMs = requirePositiveInteger(requestTimeoutMs, 'requestTimeoutMs');
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;
    this._nextRequestId = 1;
    this._pending = new Map();
    this._carry = Buffer.alloc(0);
    this._stderr = Buffer.alloc(0);
    this._generationBytes = 0;
    this._activeTurns = new Map();
    this._ended = false;
  }

  get pendingRequestCount() {
    return this._pending.size;
  }

  get stderrTail() {
    return this._stderr.toString('utf8');
  }

  get generationOutputBytes() {
    return this._generationBytes;
  }

  beginTurn(turnId) {
    const key = String(turnId);
    if (this._activeTurns.has(key)) {
      throw new CodexProtocolError('CODEX_TURN_ALREADY_ACTIVE', 'A protocol turn budget is already active');
    }
    this._activeTurns.set(key, 0);
  }

  endTurn(turnId) {
    this._activeTurns.delete(String(turnId));
  }

  request(method, params, { timeoutMs = this._requestTimeoutMs } = {}) {
    requireMethod(method);
    requirePositiveInteger(timeoutMs, 'timeoutMs');
    const id = this._nextRequestId;
    this._nextRequestId += 1;
    const envelope = { id, method };
    if (params !== undefined) envelope.params = params;

    let resolveRequest;
    let rejectRequest;
    const result = new Promise((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    const timeout = this._setTimer(() => {
      if (!this._pending.delete(id)) return;
      rejectRequest(new CodexProtocolError(
        'CODEX_REQUEST_TIMEOUT',
        `Codex request timed out: ${method}`,
      ));
    }, timeoutMs);
    timeout?.unref?.();
    this._pending.set(id, { method, resolve: resolveRequest, reject: rejectRequest, timeout });

    try {
      this._sendEnvelope(envelope);
    } catch (error) {
      this._clearPending(id);
      rejectRequest(error);
    }
    return result;
  }

  notify(method, params, extraEnvelope) {
    requireMethod(method);
    const envelope = { method };
    if (params !== undefined) envelope.params = params;
    if (extraEnvelope !== undefined) Object.assign(envelope, extraEnvelope);
    this._sendEnvelope(envelope);
  }

  acceptStdoutChunk(chunk) {
    if (this._ended) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
    this._countStdout(bytes.length);
    let combined = this._carry.length === 0 ? bytes : Buffer.concat([this._carry, bytes]);
    let start = 0;
    for (let index = 0; index < combined.length; index += 1) {
      if (combined[index] !== 0x0a) continue;
      let line = combined.subarray(start, index);
      if (line.length > 0 && line[line.length - 1] === 0x0d) line = line.subarray(0, line.length - 1);
      this._assertLineLimit(line.length);
      this._acceptLine(line);
      start = index + 1;
    }
    combined = combined.subarray(start);
    this._assertLineLimit(combined.length);
    this._carry = Buffer.from(combined);
  }

  endStdout() {
    if (this._ended) return;
    this._ended = true;
    const carry = this._carry;
    this._carry = Buffer.alloc(0);
    if (carry.length > 0) {
      this._assertLineLimit(carry.length);
      this._acceptLine(carry);
    }
  }

  acceptStderrChunk(chunk) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
    if (bytes.length >= this._maxStderrRingBytes) {
      this._stderr = Buffer.from(bytes.subarray(bytes.length - this._maxStderrRingBytes));
      return;
    }
    const combined = this._stderr.length === 0 ? bytes : Buffer.concat([this._stderr, bytes]);
    this._stderr = combined.length > this._maxStderrRingBytes
      ? Buffer.from(combined.subarray(combined.length - this._maxStderrRingBytes))
      : Buffer.from(combined);
  }

  failPending(code, message, options = {}) {
    const pending = [...this._pending.entries()];
    this._pending.clear();
    for (const [, entry] of pending) {
      this._clearTimer(entry.timeout);
      entry.reject(new CodexProtocolError(code, message, options));
    }
  }

  _sendEnvelope(envelope) {
    validateEnvelope(envelope);
    this._beforeWrite();
    const line = JSON.stringify(envelope);
    if (Buffer.byteLength(line, 'utf8') > this._maxJsonlLineBytes) {
      throw new CodexProtocolError('CODEX_JSONL_LINE_LIMIT', 'Codex outbound JSONL line exceeded limit');
    }
    this._writeLine(`${line}\n`);
  }

  _countStdout(byteLength) {
    this._generationBytes += byteLength;
    if (this._generationBytes > this._maxGenerationOutputBytes) {
      throw new CodexProtocolError(
        'CODEX_GENERATION_OUTPUT_LIMIT',
        'Codex generation output exceeded limit',
      );
    }
    for (const [turnId, currentBytes] of this._activeTurns) {
      const nextBytes = currentBytes + byteLength;
      this._activeTurns.set(turnId, nextBytes);
      if (nextBytes > this._maxTurnOutputBytes) {
        throw new CodexProtocolError('CODEX_TURN_OUTPUT_LIMIT', 'Codex turn output exceeded limit');
      }
    }
  }

  _assertLineLimit(byteLength) {
    if (byteLength > this._maxJsonlLineBytes) {
      throw new CodexProtocolError('CODEX_JSONL_LINE_LIMIT', 'Codex JSONL line exceeded limit');
    }
  }

  _acceptLine(line) {
    if (line.length === 0) return;
    let envelope;
    try {
      envelope = JSON.parse(line.toString('utf8'));
    } catch (cause) {
      throw new CodexProtocolError('CODEX_MALFORMED_JSONL', 'Codex emitted malformed JSONL', { cause });
    }
    validateEnvelope(envelope);
    if (Object.prototype.hasOwnProperty.call(envelope, 'id')) {
      this._acceptResponse(envelope);
      return;
    }
    if (typeof envelope.method === 'string') {
      const emittedAtMs = Number.isFinite(envelope.emittedAtMs) ? envelope.emittedAtMs : null;
      this._onNotification({
        method: envelope.method,
        params: envelope.params,
        emittedAtMs,
      });
      return;
    }
    throw new CodexProtocolError('CODEX_INVALID_ENVELOPE', 'Codex envelope was neither response nor notification');
  }

  _acceptResponse(envelope) {
    const entry = this._pending.get(envelope.id);
    if (!entry) {
      throw new CodexProtocolError(
        'CODEX_UNKNOWN_RESPONSE_ID',
        `Codex response used unknown request id ${String(envelope.id)}`,
      );
    }
    this._clearPending(envelope.id);
    if (envelope.error !== undefined) {
      const rpcCode = envelope.error && envelope.error.code;
      const overloaded = rpcCode === -32001
        && envelope.error?.message === 'Server overloaded; retry later.';
      entry.reject(new CodexProtocolError(
        'CODEX_REQUEST_REJECTED',
        overloaded ? 'Codex server overloaded' : 'Codex request rejected', {
        rpcCode,
        overloaded,
      }));
      return;
    }
    entry.resolve(envelope.result);
  }

  _clearPending(id) {
    const entry = this._pending.get(id);
    if (!entry) return null;
    this._pending.delete(id);
    this._clearTimer(entry.timeout);
    return entry;
  }
}

module.exports = {
  DEFAULT_LIMITS,
  CodexAppServerProtocol,
  CodexProtocolError,
  validateEnvelope,
};
