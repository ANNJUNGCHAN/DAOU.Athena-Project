'use strict';

const PROVIDERS = Object.freeze(['claude', 'codex']);
const ORIGINS = Object.freeze(['shell', 'orb']);
const RUNTIME_STATES = Object.freeze([
  'stopped', 'starting', 'ready', 'busy', 'interrupting',
  'draining', 'rotating', 'backoff', 'failed',
]);
const EVENT_TYPES = Object.freeze([
  'turn_started', 'text_delta', 'thinking_delta', 'tool_started',
  'tool_progress', 'tool_completed', 'canvas_result', 'subagent_updated',
  'permission_denied', 'usage_updated', 'warning', 'turn_completed',
  'turn_interrupted', 'turn_failed',
]);
const TERMINAL_EVENT_TYPES = Object.freeze([
  'turn_completed', 'turn_interrupted', 'turn_failed',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

class ProviderRuntimeError extends Error {
  constructor(code, safeMessage, { retryable = false, cause = null } = {}) {
    super(String(safeMessage || 'Provider runtime error'));
    this.name = 'ProviderRuntimeError';
    this.code = String(code || 'PROVIDER_FAILED');
    this.retryable = retryable === true;
    if (cause) this.cause = cause;
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value, field, max = 4096) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  }
  return value;
}

function positiveGeneration(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
  return value;
}

function immutableClone(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(immutableClone));
  if (!plainObject(value)) return value;
  const cloned = {};
  for (const [key, child] of Object.entries(value)) cloned[key] = immutableClone(child);
  return Object.freeze(cloned);
}

function validateDesiredState(input) {
  if (!plainObject(input)) throw new TypeError('desiredState must be an object');
  if (!PROVIDERS.includes(input.provider)) throw new TypeError('desiredState.provider is invalid');
  nonEmptyString(input.accountId, 'desiredState.accountId', 256);
  nonEmptyString(input.conversationId, 'desiredState.conversationId', 256);
  nonEmptyString(input.cwd, 'desiredState.cwd', 32768);
  if (input.model !== null && input.model !== undefined) nonEmptyString(input.model, 'desiredState.model', 256);
  if (input.effort !== null && input.effort !== undefined) nonEmptyString(input.effort, 'desiredState.effort', 64);
  nonEmptyString(input.systemPrompt, 'desiredState.systemPrompt', 1_000_000);
  if (!SHA256_PATTERN.test(String(input.systemPromptHash || ''))) {
    throw new TypeError('desiredState.systemPromptHash must be a SHA-256 hex digest');
  }
  positiveGeneration(input.configGeneration, 'desiredState.configGeneration');
  positiveGeneration(input.securityGeneration, 'desiredState.securityGeneration');
  if (!plainObject(input.mcpSnapshot)) throw new TypeError('desiredState.mcpSnapshot must be an object');
  if (!plainObject(input.toolPolicy)) throw new TypeError('desiredState.toolPolicy must be an object');

  return Object.freeze({
    provider: input.provider,
    accountId: input.accountId,
    conversationId: input.conversationId,
    cwd: input.cwd,
    model: input.model || null,
    effort: input.effort || null,
    systemPrompt: input.systemPrompt,
    systemPromptHash: input.systemPromptHash.toLowerCase(),
    configGeneration: input.configGeneration,
    securityGeneration: input.securityGeneration,
    mcpSnapshot: immutableClone(input.mcpSnapshot),
    toolPolicy: immutableClone(input.toolPolicy),
  });
}

function validateTurnRequest(input) {
  if (!plainObject(input)) throw new TypeError('turn request must be an object');
  if (!UUID_PATTERN.test(String(input.clientSubmitId || ''))) {
    throw new TypeError('clientSubmitId must be a canonical UUID');
  }
  nonEmptyString(input.conversationId, 'conversationId', 256);
  if (!ORIGINS.includes(input.origin)) throw new TypeError('origin is invalid');
  nonEmptyString(input.userText, 'userText', 1_000_000);
  return Object.freeze({
    clientSubmitId: input.clientSubmitId.toLowerCase(),
    conversationId: input.conversationId,
    origin: input.origin,
    userText: input.userText,
  });
}

function validateBinding(binding, provider) {
  if (!plainObject(binding) || binding.provider !== provider) {
    throw new TypeError('providerBinding does not match provider');
  }
  if (provider === 'claude') nonEmptyString(binding.sessionId, 'providerBinding.sessionId', 512);
  else nonEmptyString(binding.threadId, 'providerBinding.threadId', 512);
  return binding;
}

function validateCheckpoint(checkpoint, provider) {
  if (!plainObject(checkpoint) || checkpoint.provider !== provider) {
    throw new TypeError('continuationCheckpoint does not match provider');
  }
  if (provider === 'claude') {
    nonEmptyString(checkpoint.sessionId, 'continuationCheckpoint.sessionId', 512);
    nonEmptyString(checkpoint.assistantMessageId, 'continuationCheckpoint.assistantMessageId', 512);
    if (!SHA256_PATTERN.test(String(checkpoint.assistantMessageHash || ''))) {
      throw new TypeError('continuationCheckpoint.assistantMessageHash must be a SHA-256 hex digest');
    }
  } else {
    nonEmptyString(checkpoint.turnId, 'continuationCheckpoint.turnId', 512);
  }
  return checkpoint;
}

function validateTerminalPayload(type, payload, provider) {
  if (!plainObject(payload)) throw new TypeError(`${type} payload must be an object`);
  if (type === 'turn_completed') {
    validateBinding(payload.providerBinding, provider);
    validateCheckpoint(payload.continuationCheckpoint, provider);
    nonEmptyString(payload.finalText, 'turn_completed.finalText', 2_000_000);
    if (!plainObject(payload.usage)) throw new TypeError('turn_completed.usage must be an object');
  } else if (type === 'turn_interrupted') {
    if (payload.providerBinding !== null && payload.providerBinding !== undefined) {
      validateBinding(payload.providerBinding, provider);
    }
    nonEmptyString(payload.reason, 'turn_interrupted.reason', 512);
  } else if (type === 'turn_failed') {
    nonEmptyString(payload.code, 'turn_failed.code', 128);
    if (typeof payload.retryable !== 'boolean') throw new TypeError('turn_failed.retryable must be boolean');
    nonEmptyString(payload.safeMessage, 'turn_failed.safeMessage', 4096);
  }
  return payload;
}

function validateEventPayload(type, payload, provider) {
  if (!EVENT_TYPES.includes(type)) throw new TypeError(`unsupported provider event: ${type}`);
  if (!plainObject(payload)) throw new TypeError(`${type} payload must be an object`);
  if (TERMINAL_EVENT_TYPES.includes(type)) return validateTerminalPayload(type, payload, provider);
  if (type === 'turn_started') {
    if (payload.providerTurnId !== null && payload.providerTurnId !== undefined) {
      nonEmptyString(payload.providerTurnId, 'turn_started.providerTurnId', 512);
    }
  } else if (type === 'text_delta' || type === 'thinking_delta') {
    nonEmptyString(payload.text, `${type}.text`, 2_000_000);
  } else if (type === 'tool_started') {
    nonEmptyString(payload.toolUseId, 'tool_started.toolUseId', 512);
    if (payload.parentToolUseId !== null && payload.parentToolUseId !== undefined) {
      nonEmptyString(payload.parentToolUseId, 'tool_started.parentToolUseId', 512);
    }
    nonEmptyString(payload.canonicalToolName, 'tool_started.canonicalToolName', 512);
    nonEmptyString(payload.providerToolName, 'tool_started.providerToolName', 512);
    if (!plainObject(payload.input)) throw new TypeError('tool_started.input must be an object');
  } else if (type === 'tool_progress') {
    nonEmptyString(payload.toolUseId, 'tool_progress.toolUseId', 512);
    nonEmptyString(payload.safeStatus, 'tool_progress.safeStatus', 4096);
  } else if (type === 'tool_completed') {
    nonEmptyString(payload.toolUseId, 'tool_completed.toolUseId', 512);
    nonEmptyString(payload.canonicalToolName, 'tool_completed.canonicalToolName', 512);
    if (typeof payload.isError !== 'boolean') throw new TypeError('tool_completed.isError must be boolean');
    if (!Object.prototype.hasOwnProperty.call(payload, 'content')) {
      throw new TypeError('tool_completed.content is required');
    }
  } else if (type === 'canvas_result') {
    nonEmptyString(payload.toolUseId, 'canvas_result.toolUseId', 512);
    nonEmptyString(payload.status, 'canvas_result.status', 128);
    if (!plainObject(payload.envelope) && !plainObject(payload.receipt)) {
      throw new TypeError('canvas_result requires a validated envelope or receipt');
    }
  } else if (type === 'subagent_updated') {
    nonEmptyString(payload.taskId, 'subagent_updated.taskId', 512);
    if (payload.parentToolUseId !== null && payload.parentToolUseId !== undefined) {
      nonEmptyString(payload.parentToolUseId, 'subagent_updated.parentToolUseId', 512);
    }
    for (const field of ['subtype', 'description', 'status']) {
      nonEmptyString(payload[field], `subagent_updated.${field}`, field === 'description' ? 4096 : 256);
    }
    if (payload.lastCanonicalToolName !== null && payload.lastCanonicalToolName !== undefined) {
      nonEmptyString(payload.lastCanonicalToolName, 'subagent_updated.lastCanonicalToolName', 512);
    }
    if (!Number.isFinite(payload.elapsedMs) || payload.elapsedMs < 0) {
      throw new TypeError('subagent_updated.elapsedMs must be a non-negative number');
    }
  } else if (type === 'permission_denied') {
    nonEmptyString(payload.safeToolLabel, 'permission_denied.safeToolLabel', 512);
    nonEmptyString(payload.reasonCode, 'permission_denied.reasonCode', 128);
  } else if (type === 'usage_updated') {
    if (Object.values(payload).some((value) => !Number.isFinite(value) || value < 0)) {
      throw new TypeError('usage_updated fields must be non-negative numbers');
    }
  } else if (type === 'warning') {
    nonEmptyString(payload.code, 'warning.code', 128);
    nonEmptyString(payload.safeMessage, 'warning.safeMessage', 4096);
  }
  return payload;
}

function isTerminalEvent(type) {
  return TERMINAL_EVENT_TYPES.includes(type);
}

function validateProviderSession(adapter) {
  if (!plainObject(adapter)) throw new TypeError('provider adapter must be an object');
  for (const method of ['start', 'ready', 'sendTurn', 'interrupt', 'stop']) {
    if (typeof adapter[method] !== 'function') {
      throw new TypeError(`provider adapter.${method} must be a function`);
    }
  }
  if (adapter.rotate !== undefined) {
    throw new TypeError('provider adapter.rotate is forbidden; rotation belongs to the supervisor');
  }
  return adapter;
}

module.exports = {
  PROVIDERS,
  ORIGINS,
  RUNTIME_STATES,
  EVENT_TYPES,
  TERMINAL_EVENT_TYPES,
  ProviderRuntimeError,
  immutableClone,
  validateDesiredState,
  validateTurnRequest,
  validateEventPayload,
  validateTerminalPayload,
  validateBinding,
  validateCheckpoint,
  validateProviderSession,
  isTerminalEvent,
};
