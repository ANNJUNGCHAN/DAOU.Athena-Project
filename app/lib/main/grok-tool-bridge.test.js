'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const streamJsonParser = require('./stream-json-parser');

function sourceBetween(source, start, end) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt);
  assert.notEqual(startAt, -1, `missing main.js source marker: ${start}`);
  assert.notEqual(endAt, -1, `missing main.js source marker: ${end}`);
  return source.slice(startAt, endAt).trim();
}

function createHarness({ forwardBacktestAction = false } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const labeler = sourceBetween(source, 'function toolStepLabel(name, input)', 'const NUDGE_GUARD_TOOL_NAME');
  const forwarder = sourceBetween(
    source,
    'function maybeForwardBacktestChatAction(step, resultBlock)',
    '// tool_result.content',
  );
  const resultTextExtractor = sourceBetween(
    source,
    'function extractToolResultText(content)',
    '// tool_use_id별',
  );
  const tracker = sourceBetween(source, 'function createToolStepTracker(', '// 하위 에이전트 도크');
  const sent = [];
  const steps = [];
  const context = {
    streamJsonParser,
    shellWin: {
      isDestroyed: () => false,
      webContents: { send: (...args) => sent.push(args) },
    },
    TOOL_STEP_LABELS: { athena_backtest: '백테스트' },
    Date,
  };
  const createToolStepTracker = vm.runInNewContext(`
    const BACKTEST_TOOL_NAME = 'athena_backtest';
    ${labeler}
    ${forwarder}
    ${resultTextExtractor}
    const maybeForwardBrainEntity = () => '';
    const maybeForwardNudgeGuardProposal = () => {};
    const maybeForwardRoutineProposal = () => {};
    const maybeForwardWatchCreate = () => {};
    const maybeForwardGraphChatAction = () => {};
    const maybeForwardPluginProposal = () => {};
    (${tracker});
  `, context);
  return {
    track: createToolStepTracker(
      (step) => steps.push(step),
      { forwardBacktestAction },
    ),
    sent,
    steps,
  };
}

function grokBacktestEvents({ isError = false } = {}) {
  const patch = { symbols: ['005930'], period: 'day', fromDt: '20260607', toDt: '20260907' };
  return [
    {
      type: 'assistant',
      message: { content: [{
        type: 'tool_use', id: 'grok-backtest-1', name: 'use_tool',
        input: {
          tool_name: 'athena__athena_backtest',
          tool_input: { action: 'propose_spec', propose_spec: { patch } },
        },
      }] },
    },
    {
      type: 'user',
      message: { content: [{
        type: 'tool_result', tool_use_id: 'grok-backtest-1', is_error: isError,
        content: JSON.stringify({ delivered: 'canvas', patch }),
      }] },
    },
  ];
}

test('Grok use_tool 성공은 실제 backtest forwarder를 거쳐 폼 액션 IPC로 전달된다', () => {
  const { track, sent, steps } = createHarness({ forwardBacktestAction: true });
  for (const event of grokBacktestEvents()) track(event);
  assert.equal(steps[0].label, '백테스트');
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [[
    'athena:backtest-chat-action',
    {
      kind: 'spec_draft',
      patch: { symbols: ['005930'], period: 'day', fromDt: '20260607', toDt: '20260907' },
      note: null,
      suggest_run: false,
    },
  ]]);
});

test('Grok use_tool 실패는 backtest 폼 액션을 전달하지 않는다', () => {
  const { track, sent, steps } = createHarness({ forwardBacktestAction: true });
  for (const event of grokBacktestEvents({ isError: true })) track(event);
  assert.equal(steps.at(-1).error, true);
  assert.deepEqual(sent, []);
});

test('Grok use_tool 성공도 일반·그래프 턴에서는 backtest 폼 액션을 전달하지 않는다', () => {
  for (const forwardBacktestAction of [false, undefined]) {
    const { track, sent } = createHarness({ forwardBacktestAction });
    for (const event of grokBacktestEvents()) track(event);
    assert.deepEqual(sent, []);
  }
});

test('Grok use_tool 시작 뒤 취소되어 결과가 없으면 backtest 폼 액션을 전달하지 않는다', () => {
  const { track, sent } = createHarness({ forwardBacktestAction: true });
  track(grokBacktestEvents()[0]);
  assert.deepEqual(sent, []);
});

test('main Grok 경로는 앱 관리 MCP cwd에만 trust opt-in과 provider 전용 prompt를 건다', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const turn = sourceBetween(source, 'async function runLiveQueryInner(', '// Esc 중단');
  assert.match(turn, /const \{ dir, configFile \} = getLiveMcpConfig\(\)/);
  assert.match(turn, /providerId:\s*liveProviderId/);
  const grokBranch = sourceBetween(turn, "if (liveProviderId === 'grok')", '} else if (persistentChatEnabled())');
  assert.match(grokBranch, /prompt:\s*buildLivePrompt\(liveTurnInput\)/);
  assert.match(grokBranch, /cwd:\s*dir/);
  assert.match(grokBranch, /trustProjectFolder:\s*true/);
  assert.doesNotMatch(grokBranch, /submit\.(cwd|project|path)/);
  assert.match(turn, /forwardBacktestAction:\s*submit\.canvasMode\s*===\s*'backtest'/);
});
