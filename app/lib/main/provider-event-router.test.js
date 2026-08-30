'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { ReplayTurnCapture } = require('./query-cache');
const { createProviderEventRouter, validateProviderEvent } = require('./provider-event-router');

function event(sequence, type, payload) {
  return {
    runtimeGeneration: 2,
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    sequence,
    type,
    payload,
  };
}

test('router emits renderer-safe tool steps without raw input or result content', () => {
  let now = 10;
  const steps = [];
  const router = createProviderEventRouter({
    clock: () => now,
    onToolStep: (step) => steps.push(step),
    toolStepLabel: () => '조회',
  });
  router.route(event(1, 'tool_started', {
    toolUseId: 'tool-1',
    canonicalToolName: 'athena_resolve',
    input: { account: 'secret', question: 'q' },
  }));
  now = 34;
  router.route(event(2, 'tool_completed', {
    toolUseId: 'tool-1',
    canonicalToolName: 'athena_resolve',
    isError: false,
    content: '{"plan_token":"private"}',
  }));

  assert.equal(steps.length, 2);
  assert.deepEqual(steps.map((step) => ({ done: step.done, elapsedMs: step.elapsedMs })), [
    { done: false, elapsedMs: null },
    { done: true, elapsedMs: 24 },
  ]);
  assert.equal(JSON.stringify(steps).includes('account'), false);
  assert.equal(JSON.stringify(steps).includes('plan_token'), false);
});

test('normalized replay capture preserves exact tool-use correlation', () => {
  const replayCapture = new ReplayTurnCapture();
  const router = createProviderEventRouter({ replayCapture });
  router.route(event(1, 'tool_started', {
    toolUseId: 'resolve-1', canonicalToolName: 'athena_resolve',
    input: { question: 'q', intent: 'query', preferred_ref: 'base:ka10001' },
  }));
  router.route(event(2, 'tool_completed', {
    toolUseId: 'resolve-1', canonicalToolName: 'athena_resolve', isError: false,
    content: JSON.stringify({ plan_token: 'plan-1' }),
  }));
  router.route(event(3, 'tool_started', {
    toolUseId: 'render-1', canonicalToolName: 'athena__render_canvas',
    input: { plan_token: 'plan-1', caption: '차트' },
  }));

  const judgment = replayCapture.buildJudgment(['chart']);
  assert.equal(judgment.resolveQuestion, 'q');
  assert.equal(judgment.caption, '차트');
});

test('duplicate completion and events after terminal are dropped', () => {
  const steps = [];
  const router = createProviderEventRouter({ onToolStep: (step) => steps.push(step) });
  router.route(event(1, 'tool_started', { toolUseId: 't', canonicalToolName: 'x' }));
  router.route(event(2, 'tool_completed', { toolUseId: 't', canonicalToolName: 'x' }));
  router.route(event(3, 'tool_completed', { toolUseId: 't', canonicalToolName: 'x' }));
  assert.equal(router.route(event(4, 'turn_completed', { finalText: 'ok' })).accepted, true);
  assert.deepEqual(router.route(event(5, 'text_delta', { text: 'late' })), { accepted: false, reason: 'after-terminal' });
  assert.equal(steps.length, 2);
});

test('subagent descriptions and warnings are bounded and control-character free', () => {
  const subagents = [];
  const warnings = [];
  const router = createProviderEventRouter({
    onSubagentStep: (value) => subagents.push(value),
    onWarning: (value) => warnings.push(value),
  });
  router.route(event(1, 'subagent_updated', { taskId: '1', description: `a\u0000${'b'.repeat(300)}` }));
  router.route(event(2, 'warning', { code: 'W', safeMessage: `x\n${'y'.repeat(300)}` }));

  assert.equal(subagents[0].description.length <= 160, true);
  assert.equal(/[\u0000-\u001f]/.test(subagents[0].description), false);
  assert.equal(warnings[0].safeMessage.length <= 160, true);
});

test('invalid or unstamped events fail before any callback', () => {
  let calls = 0;
  const router = createProviderEventRouter({ onInternalEvent: () => { calls += 1; } });
  assert.equal(validateProviderEvent({ type: 'text_delta', payload: { text: 'x' } }), false);
  assert.deepEqual(router.route({ type: 'text_delta', payload: { text: 'x' } }), { accepted: false, reason: 'invalid-event' });
  assert.equal(calls, 0);
});

