'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

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

function mainSourceBetween(source, start, end) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt);
  assert.notEqual(startAt, -1, `missing main.js source marker: ${start}`);
  assert.notEqual(endAt, -1, `missing main.js source marker: ${end}`);
  return source.slice(startAt, endAt).trim();
}

function createMainBacktestCompletionHarness(contextEntries) {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const forwarder = mainSourceBetween(
    source,
    'function maybeForwardBacktestChatAction(step, resultBlock)',
    '// tool_result.content',
  );
  const resultTextExtractor = mainSourceBetween(
    source,
    'function extractToolResultText(content)',
    '// tool_use_id별',
  );
  const callback = mainSourceBetween(
    source,
    'onTrustedToolCompleted(completion)',
    'onSubagentStep(step)',
  ).replace(/,$/, '');
  const sent = [];
  const context = {
    persistentTurnContexts: new Map(contextEntries),
    shellWin: {
      isDestroyed: () => false,
      webContents: { send: (...args) => sent.push(args) },
    },
  };
  const onTrustedToolCompleted = vm.runInNewContext(`
    const BACKTEST_TOOL_NAME = 'athena_backtest';
    ${forwarder}
    ${resultTextExtractor}
    ({ ${callback} }).onTrustedToolCompleted;
  `, context);
  return { onTrustedToolCompleted, sent };
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

test('trusted completion correlates the accepted arguments and successful result by tool-use id', () => {
  const completions = [];
  const steps = [];
  const input = {
    action: 'propose_spec',
    propose_spec: {
      patch: {
        symbols: ['005930'], period: 'day', fromDt: '20260607', toDt: '20260907',
      },
    },
  };
  const content = [{
    type: 'text',
    text: JSON.stringify({
      delivered: 'canvas',
      patch: input.propose_spec.patch,
    }),
  }];
  const router = createProviderEventRouter({
    clientSubmitId: 'submit-1',
    onToolStep: (step) => steps.push(step),
    onTrustedToolCompleted: (completion) => completions.push(completion),
  });

  router.route(event(1, 'tool_started', {
    toolUseId: 'backtest-1',
    providerToolName: 'mcp__athena__athena_backtest',
    canonicalToolName: 'athena_backtest',
    input,
  }));
  router.route(event(2, 'tool_completed', {
    toolUseId: 'backtest-1',
    providerToolName: 'mcp__athena__athena_backtest',
    canonicalToolName: 'athena_backtest',
    isError: false,
    content,
  }));

  assert.equal(completions.length, 1);
  assert.deepEqual(completions[0].input, input);
  assert.deepEqual(completions[0].content, content);
  assert.equal(completions[0].canonicalToolName, 'athena_backtest');
  assert.equal(completions[0].clientSubmitId, 'submit-1');
  const rendererPayload = JSON.stringify(steps);
  assert.equal(rendererPayload.includes('propose_spec'), false);
  assert.equal(rendererPayload.includes('005930'), false);
});

test('normalized completion reaches the real main backtest forwarder only for an active backtest turn', () => {
  const { onTrustedToolCompleted, sent } = createMainBacktestCompletionHarness([
    ['submit-backtest', { canvasMode: 'backtest' }],
    ['submit-summary', { canvasMode: null }],
    ['submit-cancelled', { canvasMode: 'backtest' }],
    ['submit-failed', { canvasMode: 'backtest' }],
  ]);
  const input = {
    action: 'propose_spec',
    propose_spec: { patch: { symbols: ['005930'] } },
  };
  const content = [{
    type: 'text',
    text: JSON.stringify({ delivered: 'canvas', patch: input.propose_spec.patch }),
  }];
  const routeOutcome = (clientSubmitId, { isError = false, interrupted = false } = {}) => {
    const router = createProviderEventRouter({ clientSubmitId, onTrustedToolCompleted });
    router.route(event(1, 'tool_started', {
      toolUseId: `${clientSubmitId}-tool`,
      providerToolName: 'mcp__athena__athena_backtest',
      canonicalToolName: 'athena_backtest',
      input,
    }));
    if (interrupted) router.route(event(2, 'turn_interrupted', { reason: 'user_interrupt' }));
    router.route(event(interrupted ? 3 : 2, 'tool_completed', {
      toolUseId: `${clientSubmitId}-tool`,
      providerToolName: 'mcp__athena__athena_backtest',
      canonicalToolName: 'athena_backtest',
      isError,
      content,
    }));
  };

  routeOutcome('submit-backtest');
  routeOutcome('submit-summary');
  routeOutcome('submit-missing');
  routeOutcome('submit-failed', { isError: true });
  routeOutcome('submit-cancelled', { interrupted: true });

  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [[
    'athena:backtest-chat-action',
    { kind: 'spec_draft', patch: { symbols: ['005930'] }, note: null, suggest_run: false },
  ]]);
});

test('trusted completion rejects errors, missing or mismatched starts, and completions after interruption', () => {
  const completions = [];
  const router = createProviderEventRouter({
    onTrustedToolCompleted: (completion) => completions.push(completion),
  });
  router.route(event(1, 'tool_started', {
    toolUseId: 'failed', canonicalToolName: 'athena_backtest', input: { action: 'propose_spec' },
  }));
  router.route(event(2, 'tool_completed', {
    toolUseId: 'failed', canonicalToolName: 'athena_backtest', isError: true, content: '{}',
  }));
  router.route(event(3, 'tool_completed', {
    toolUseId: 'missing', canonicalToolName: 'athena_backtest', isError: false, content: '{}',
  }));
  router.route(event(4, 'tool_started', {
    toolUseId: 'mismatch', canonicalToolName: 'athena_backtest', input: { action: 'propose_spec' },
  }));
  router.route(event(5, 'tool_completed', {
    toolUseId: 'mismatch', canonicalToolName: 'athena_routine', isError: false, content: '{}',
  }));
  router.route(event(6, 'turn_interrupted', { reason: 'user_interrupt' }));
  router.route(event(7, 'tool_started', {
    toolUseId: 'late', canonicalToolName: 'athena_backtest', input: { action: 'propose_spec' },
  }));
  router.route(event(8, 'tool_completed', {
    toolUseId: 'late', canonicalToolName: 'athena_backtest', isError: false, content: '{}',
  }));

  assert.deepEqual(completions, []);
});

test('router rejects a stale provider identity before trusted callbacks', () => {
  const completions = [];
  const router = createProviderEventRouter({
    onTrustedToolCompleted: (completion) => completions.push(completion),
  });
  router.route(event(1, 'tool_started', {
    toolUseId: 't', canonicalToolName: 'athena_backtest', input: { action: 'propose_spec' },
  }));
  const stale = event(2, 'tool_completed', {
    toolUseId: 't', canonicalToolName: 'athena_backtest', isError: false, content: '{}',
  });
  stale.runtimeGeneration = 3;
  assert.deepEqual(router.route(stale), { accepted: false, reason: 'identity-mismatch' });
  assert.deepEqual(completions, []);
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
