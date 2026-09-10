'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
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
    require: createRequire(path.join(__dirname, '..', '..', 'main.js')),
    streamJsonParser,
    require: require('node:module').createRequire(path.join(__dirname, '..', '..', 'main.js')),
    shellWin: {
      isDestroyed: () => false,
      webContents: { send: (...args) => sent.push(args) },
    },
    TOOL_STEP_LABELS: { athena_backtest: '백테스트' },
    Date,
  };
  const createToolStepTracker = vm.runInNewContext(`
    const BACKTEST_TOOL_NAME = 'athena_backtest';
    // 다중 대화(2026-09-08) — 전달자는 대화별 셸 전송을 거친다. 하네스에서는 바로 보낸다.
    let forwardingConversationId = null;
    const shellForConversation = () => ({ send: (channel, payload) => shellWin.webContents.send(channel, payload) });
    ${labeler}
    ${forwarder}
    ${resultTextExtractor}
    const maybeForwardBrainEntity = () => '';
    const maybeForwardNudgeGuardProposal = () => {};
    const maybeForwardRoutineDraft = () => {};
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

test('toolStepLabel은 실제 도구 입력에서 대상만 붙이고 TR·토큰은 숨긴다', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const chunk = sourceBetween(source, 'const TOOL_STEP_LABELS = {', 'const NUDGE_GUARD_TOOL_NAME');
  const toolStepLabel = vm.runInNewContext(
    `${chunk}\ntoolStepLabel;`,
    { streamJsonParser: require('./stream-json-parser') },
  );
  assert.equal(toolStepLabel('athena_search', { query: '삼성전자' }), '검색 · 삼성전자');
  assert.equal(
    toolStepLabel('athena_resolve', {
      question: '삼성전자 2025 연결 재무',
      arguments: { stk_nm: '삼성전자', year: 2025, fs_div: '연결' },
    }),
    '판단 중 · 삼성전자 2025 연결',
  );
  assert.equal(
    toolStepLabel('athena_resolve', { question: '삼성전자 흐름 보여줘' }),
    '판단 중 · 삼성전자 흐름 보여줘',
  );
  assert.equal(toolStepLabel('athena_call', { plan_token: 'private' }), '조회');
  assert.equal(toolStepLabel('athena_describe', { operation_ref: 'ka10001' }), '스키마 확인');
  assert.equal(
    toolStepLabel('mcp__athena__athena_brain', { action: 'entity', entity: '한미반도체' }),
    '노드 조회 · 한미반도체',
  );
  assert.equal(
    toolStepLabel('mcp__athena__athena__render_canvas', { query: '삼성전자' }),
    '카드 그리는 중',
  );
});

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

test('write_file sends the saved source only after a matching successful acknowledgement', () => {
  const input = { project_id: 'p', root_path: 'algo', path: 'algo/strategy.py', source: '' };
  const result = { kind: 'file_written', status: 'written', project_id: 'p', root_path: 'algo', path: input.path };
  for (const isError of [false, true]) {
    const { track, sent } = createHarness({ forwardBacktestAction: true });
    track({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'saved-1',
      name: 'athena_backtest', input: { action: 'write_file', write_file: input } }] } });
    assert.equal(sent.length, 0);
    track({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'saved-1',
      is_error: isError, content: JSON.stringify(result) }] } });
    assert.deepEqual(JSON.parse(JSON.stringify(sent)), isError ? []
      : [['athena:backtest-chat-action', { ...result, source: '' }]]);
  }
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
