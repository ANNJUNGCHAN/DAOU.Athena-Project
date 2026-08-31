'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ProviderRuntimeError,
  validateDesiredState,
  validateTurnRequest,
  validateEventPayload,
  validateProviderSession,
} = require('./provider-session-contract');

function desired(overrides = {}) {
  return {
    provider: 'claude', accountId: 'acct', conversationId: 'conversation-1',
    cwd: 'C:\\repo', model: null, effort: null,
    systemPrompt: 'prompt', systemPromptHash: 'a'.repeat(64), configGeneration: 1,
    securityGeneration: 1, mcpSnapshot: { revision: 1 }, toolPolicy: { allowed: ['Read'] },
    ...overrides,
  };
}

test('desired state is validated, cloned and deeply frozen without accepting generation zero', () => {
  const source = desired();
  const result = validateDesiredState(source);
  source.mcpSnapshot.revision = 9;
  assert.equal(result.mcpSnapshot.revision, 1);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.toolPolicy.allowed), true);
  assert.equal(result.conversationId, 'conversation-1');
  assert.throws(() => validateDesiredState(desired({ securityGeneration: 0 })), /positive safe integer/);
  assert.throws(() => validateDesiredState(desired({ provider: 'other' })), /provider/);
  assert.throws(() => validateDesiredState(desired({ conversationId: '' })), /conversationId/);
});

test('turn request requires caller correlation and never accepts caller turn or signal fields as authority', () => {
  const request = validateTurnRequest({
    clientSubmitId: '123e4567-e89b-42d3-a456-426614174000',
    conversationId: 'conversation-1', origin: 'shell', userText: 'hello',
    turnId: 'caller-owned', signal: {},
  });
  assert.deepEqual(Object.keys(request), ['clientSubmitId', 'conversationId', 'origin', 'userText']);
  assert.throws(() => validateTurnRequest({ ...request, clientSubmitId: 'not-a-uuid' }), /canonical UUID/);
});

test('canonical terminal payload validates provider binding and durable checkpoint', () => {
  assert.doesNotThrow(() => validateEventPayload('turn_completed', {
    providerBinding: { provider: 'claude', sessionId: 'session-1' },
    continuationCheckpoint: {
      provider: 'claude', sessionId: 'session-1', assistantMessageId: 'assistant-1',
      assistantMessageHash: 'b'.repeat(64),
    },
    usage: {}, finalText: 'done',
  }, 'claude'));
  assert.throws(() => validateEventPayload('turn_completed', {
    providerBinding: { provider: 'claude', sessionId: 'session-1' },
    continuationCheckpoint: { provider: 'claude', sessionId: 'session-1' },
    usage: {}, finalText: 'done',
  }, 'claude'), /assistantMessageId/);
  assert.throws(() => validateEventPayload('raw_provider_message', {}, 'claude'), /unsupported/);
  assert.throws(() => validateEventPayload('tool_started', {
    toolUseId: 'tool-1', canonicalToolName: 'Read', providerToolName: 'Read', input: null,
  }, 'claude'), /input must be an object/);
  assert.doesNotThrow(() => validateEventPayload('usage_updated', { inputTokens: 1, outputTokens: 2 }, 'claude'));
});

test('runtime errors expose only typed safe fields', () => {
  const error = new ProviderRuntimeError('PROVIDER_TIMEOUT', '잠시 후 다시 시도해 주세요.', {
    retryable: true, cause: new Error('raw secret detail'),
  });
  assert.equal(error.code, 'PROVIDER_TIMEOUT');
  assert.equal(error.retryable, true);
  assert.equal(JSON.stringify(error).includes('raw secret detail'), false);
});

test('provider session contract requires lifecycle methods and forbids adapter-owned rotation', () => {
  const adapter = {
    start() {}, ready() {}, sendTurn() {}, interrupt() {}, stop() {},
  };
  assert.equal(validateProviderSession(adapter), adapter);
  assert.throws(() => validateProviderSession({ ...adapter, rotate() {} }), /rotation belongs to the supervisor/);
  assert.throws(() => validateProviderSession({ ...adapter, interrupt: null }), /interrupt/);
});
