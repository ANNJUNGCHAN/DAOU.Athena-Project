
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  splitLines,
  flushCarry,
  parseLine,
  normalizeToolUseBlock,
  isRenderCanvasToolName,
  isAgentToolName,
  classifySubagentEvent,
  isSubagentInternalEvent,
  normalizeToolResultContent,
  extractCanvasEnvelope,
  classifyCanvasBlock,
  extractTextDelta,
  extractThinkingDelta,
  StreamJsonSession,
} = require('./stream-json-parser');

// ---------------------------------------------------------------------------
// 1. 라인 분할 — 청크 경계
// ---------------------------------------------------------------------------
test('splitLines: 청크 중간에서 끊긴 줄을 carry로 넘긴다', () => {
  const r1 = splitLines('', '{"a":1}\n{"b":2');
  assert.deepEqual(r1.lines, ['{"a":1}']);
  assert.equal(r1.carry, '{"b":2');

  const r2 = splitLines(r1.carry, '}\n{"c":3}\n');
  assert.deepEqual(r2.lines, ['{"b":2}', '{"c":3}']);
  assert.equal(r2.carry, '');
});

test('splitLines: 한 청크에 여러 줄 + 개행 없이 끝나는 조각', () => {
  const r = splitLines('', 'line1\nline2\nline3');
  assert.deepEqual(r.lines, ['line1', 'line2']);
  assert.equal(r.carry, 'line3');
});

test('splitLines: \\r\\n(윈도우 개행)도 처리한다', () => {
  const r = splitLines('', 'a\r\nb\r\n');
  assert.deepEqual(r.lines, ['a', 'b']);
});

test('flushCarry: 개행 없이 끝난 마지막 줄을 회수한다', () => {
  assert.deepEqual(flushCarry('{"tail":true}'), ['{"tail":true}']);
  assert.deepEqual(flushCarry(''), []);
  assert.deepEqual(flushCarry('   '), []); // 공백뿐이면 버린다
});

// ---------------------------------------------------------------------------
// 2. 라인 파싱 — 비JSON은 던지지 않고 건너뛴다
// ---------------------------------------------------------------------------
test('parseLine: 정상 JSON', () => {
  const r = parseLine('{"type":"result"}');
  assert.equal(r.ok, true);
  assert.deepEqual(r.event, { type: 'result' });
});

test('parseLine: 깨진 JSON은 예외를 던지지 않고 ok:false를 반환한다', () => {
  const r = parseLine('{not valid json');
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('parseLine: 빈 줄도 ok:false', () => {
  assert.equal(parseLine('').ok, false);
  assert.equal(parseLine('   ').ok, false);
});

// ---------------------------------------------------------------------------
// 3. 툴 이름 매칭 — "athena__"가 두 번 나오는 이름 + 별칭이 다른 경우
// ---------------------------------------------------------------------------
test('isRenderCanvasToolName: 이름과 별칭이 다른 경우 둘 다 매칭', () => {
  assert.equal(isRenderCanvasToolName('mcp__athena__athena__render_canvas'), true);
  assert.equal(isRenderCanvasToolName('mcp__my-alias__athena__render_canvas'), true);
  // Grok 접힌 이름(ATHENA_MCP_FLAT_TOOL_NAMES) — server.py가 __를 _로 접어 노출한다
  assert.equal(isRenderCanvasToolName('athena__athena_render_canvas'), true);
  assert.equal(isRenderCanvasToolName('athena__athena_save_canvas'), false);
  assert.equal(isRenderCanvasToolName('mcp__athena__athena__save_canvas'), false);
  assert.equal(isRenderCanvasToolName('mcp__everything__echo'), false);
  assert.equal(isRenderCanvasToolName(undefined), false);
});

test('normalizeToolUseBlock: Grok use_tool 봉투를 실제 MCP 이름과 입력으로 푼다', () => {
  const block = {
    type: 'tool_use', id: 'grok-tool-1', name: 'use_tool',
    input: {
      tool_name: 'athena__athena_backtest',
      tool_input: { action: 'propose_spec', propose_spec: { patch: { symbols: ['005930'] } } },
    },
  };
  assert.deepEqual(normalizeToolUseBlock(block), {
    ...block,
    name: 'athena__athena_backtest',
    input: block.input.tool_input,
  });
});

test('normalizeToolUseBlock: 불완전한 use_tool 입력과 일반 도구는 원문을 유지한다', () => {
  const malformed = { type: 'tool_use', id: 'bad', name: 'use_tool', input: { tool_name: 'athena__x' } };
  const direct = { type: 'tool_use', id: 'direct', name: 'mcp__athena__athena_search', input: { query: 'x' } };
  assert.equal(normalizeToolUseBlock(malformed), malformed);
  assert.equal(normalizeToolUseBlock(direct), direct);
});

// ---------------------------------------------------------------------------
// 3b. 서브에이전트(Agent/Task) 인식 — task #32. 아래 고정값은
//     app/captures/subagent-probe-1787815081507.ndjson(2026-08-27 worker-par
//     실측, 실 claude -p --output-format stream-json 캡처 — 커밋 안 함, 재현
//     스크립트는 app/captures/subagent-probe.js)의 실제 이벤트를 그대로
//     옮긴 값이다. 추측이 아니다.
// ---------------------------------------------------------------------------
test('isAgentToolName: 툴 이름은 Task가 아니라 Agent다(CLI v2.1.63 리네임)', () => {
  assert.equal(isAgentToolName('Agent'), true);
  assert.equal(isAgentToolName('Task'), false);
  assert.equal(isAgentToolName(undefined), false);
});

test('classifySubagentEvent: task_started', () => {
  const step = classifySubagentEvent({
    type: 'system', subtype: 'task_started',
    task_id: 'a89a5cffc32302b35', tool_use_id: 'toolu_01UngEhHX3JMVMfVgxuV2j8E',
    description: 'Bash echo probe', subagent_type: 'general-purpose', task_type: 'local_agent',
  });
  assert.deepEqual(step, {
    subtype: 'task_started', taskId: 'a89a5cffc32302b35', toolUseId: 'toolu_01UngEhHX3JMVMfVgxuV2j8E',
    description: 'Bash echo probe', subagentType: 'general-purpose',
  });
});

test('classifySubagentEvent: task_progress — description은 시작 때와 다를 수 있다(실측)', () => {
  const step = classifySubagentEvent({
    type: 'system', subtype: 'task_progress',
    task_id: 'a89a5cffc32302b35', description: 'Running Print hi to stdout',
    subagent_type: 'general-purpose', last_tool_name: 'Bash',
    usage: { total_tokens: 32857, tool_uses: 1, duration_ms: 2524 },
  });
  assert.deepEqual(step, {
    subtype: 'task_progress', taskId: 'a89a5cffc32302b35', description: 'Running Print hi to stdout',
    lastToolName: 'Bash', elapsedMs: 2524,
  });
});

test('classifySubagentEvent: task_updated — 실측은 completed만 관측, 다른 값도 그대로 통과시킨다', () => {
  const step = classifySubagentEvent({
    type: 'system', subtype: 'task_updated',
    task_id: 'a89a5cffc32302b35', patch: { status: 'completed', end_time: 1787815069532 },
  });
  assert.deepEqual(step, { subtype: 'task_updated', taskId: 'a89a5cffc32302b35', status: 'completed', endTime: 1787815069532 });
});

test('classifySubagentEvent: task_notification', () => {
  const step = classifySubagentEvent({
    type: 'system', subtype: 'task_notification',
    task_id: 'a89a5cffc32302b35', status: 'completed',
    summary: '(1) 시도한 명령: `echo hi`\n\n(2) 결과: 성공\n\n(3) 원문 출력: `hi`',
    output_file: 'C:\\Users\\x\\tasks\\a89a5cffc32302b35.output',
  });
  assert.equal(step.subtype, 'task_notification');
  assert.equal(step.taskId, 'a89a5cffc32302b35');
  assert.equal(step.status, 'completed');
  assert.ok(step.summary.includes('echo hi'));
  assert.equal(step.outputFile, undefined); // 지금 단계는 요약만 쓴다 — output_file은 안 옮긴다(사용자 노출 경로 규율)
});

test('classifySubagentEvent: 4종이 아니거나 task_id가 없으면 null', () => {
  assert.equal(classifySubagentEvent({ type: 'system', subtype: 'status' }), null);
  assert.equal(classifySubagentEvent({ type: 'assistant' }), null);
  assert.equal(classifySubagentEvent(null), null);
  assert.equal(classifySubagentEvent({ type: 'system', subtype: 'task_started' }), null); // task_id 없음
});

test('isSubagentInternalEvent: parent_tool_use_id로 서브에이전트 내부 활동을 가른다(실측 시퀀스)', () => {
  // 실측: Agent tool_use 자체(최상위) — parent:null.
  assert.equal(isSubagentInternalEvent({
    type: 'assistant', parent_tool_use_id: null,
    message: { content: [{ type: 'tool_use', id: 'toolu_01Un', name: 'Agent' }] },
  }), false);
  // 실측: 서브에이전트 내부 Bash 호출 — parent:<Agent의 tool_use id>.
  assert.equal(isSubagentInternalEvent({
    type: 'assistant', parent_tool_use_id: 'toolu_01UngEhHX3JMVMfVgxuV2j8E',
    message: { content: [{ type: 'tool_use', id: 'toolu_01RF', name: 'Bash' }] },
  }), true);
  // 실측: Agent 최종 결과가 최상위로 돌아오는 tool_result — parent:null(서브에이전트
  // 내부가 아니다 — Agent 자체 완료는 task_updated/task_notification이 별도로 알린다).
  assert.equal(isSubagentInternalEvent({
    type: 'user', parent_tool_use_id: null,
    message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_01Un' }] },
  }), false);
  assert.equal(isSubagentInternalEvent(null), false);
});

// ---------------------------------------------------------------------------
// 4. content 정규화 + 봉투 추출
// ---------------------------------------------------------------------------
test('normalizeToolResultContent: 문자열 content', () => {
  const r = normalizeToolResultContent('{"canvas_type":"table"}');
  assert.equal(r.kind, 'string');
  assert.equal(r.text, '{"canvas_type":"table"}');
});

test('normalizeToolResultContent: 블록 배열 content', () => {
  const r = normalizeToolResultContent([{ type: 'tool_reference', tool_name: 'x' }]);
  assert.equal(r.kind, 'blocks');
  assert.ok(Array.isArray(r.blocks));
  assert.equal(r.blocks[0].type, 'tool_reference');
});

test('extractCanvasEnvelope: 블록배열 content는 캔버스 봉투로 취급하지 않는다(방어적)', () => {
  const normalized = { kind: 'blocks', blocks: [{ type: 'tool_reference', tool_name: 'x' }] };
  const r = extractCanvasEnvelope(normalized);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-a-string-content');
});

test('classifyCanvasBlock: render_canvas 결과가 배열 content로 오면 unparseable로 안전하게 떨어진다', () => {
  // 계약이 "둘 다 처리하라"이므로 방어적으로 다뤄야 한다 — 크래시도, 오인식도 안 된다.
  const block = { toolUseId: 't1', content: [{ type: 'tool_reference', tool_name: 'x' }], isError: false, meta: null };
  const r = classifyCanvasBlock(block);
  assert.equal(r.status, 'unparseable');
  assert.equal(r.reason, 'not-a-string-content');
});

// ---------------------------------------------------------------------------
// 4b. 텍스트 델타 추출 — --include-partial-messages (2026-08-26 S2)
// ---------------------------------------------------------------------------
test('extractTextDelta: content_block_delta/text_delta에서 조각을 뽑는다(실측 형태)', () => {
  const event = {
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '하나, 둘' } },
  };
  assert.equal(extractTextDelta(event), '하나, 둘');
});

test('extractTextDelta: stream_event가 아니거나 text_delta가 아니면 null', () => {
  assert.equal(extractTextDelta({ type: 'assistant' }), null);
  assert.equal(extractTextDelta({ type: 'stream_event', event: { type: 'message_start' } }), null);
  assert.equal(extractTextDelta({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{}' } },
  }), null); // tool_use 인자 스트리밍 — 채팅 답변이 아니다
  assert.equal(extractTextDelta(null), null);
  assert.equal(extractTextDelta(undefined), null);
});

// ---------------------------------------------------------------------------
// 4c. 추론 델타 추출 — --include-partial-messages의 thinking 블록 (2026-08-26)
// ---------------------------------------------------------------------------
test('extractThinkingDelta: content_block_delta/thinking_delta에서 조각을 뽑는다(실측 형태)', () => {
  const event = {
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '37×50부터 계산', estimated_tokens: null } },
  };
  assert.equal(extractThinkingDelta(event), '37×50부터 계산');
});

test('extractThinkingDelta: signature_delta(서명)는 추론 텍스트가 아니다 — 제외', () => {
  const event = {
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'CAISqQIK...' } },
  };
  assert.equal(extractThinkingDelta(event), null);
});

test('extractThinkingDelta: text_delta는 추론이 아니다 — extractTextDelta와 서로 안 겹친다', () => {
  const event = {
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '답변입니다' } },
  };
  assert.equal(extractThinkingDelta(event), null);
  assert.equal(extractTextDelta(event), '답변입니다');
});

test('extractThinkingDelta: stream_event가 아니거나 형태가 안 맞으면 null', () => {
  assert.equal(extractThinkingDelta({ type: 'assistant' }), null);
  assert.equal(extractThinkingDelta({ type: 'stream_event', event: { type: 'message_start' } }), null);
  assert.equal(extractThinkingDelta(null), null);
  assert.equal(extractThinkingDelta(undefined), null);
});

// ---------------------------------------------------------------------------
// 5. 스트리밍 세션
// ---------------------------------------------------------------------------
test('StreamJsonSession: 비JSON 라인은 건너뛰고 skippedLines로 센다', () => {
  const session = new StreamJsonSession();
  const events = [];
  session.feed('{"type":"system","subtype":"init"}\nnot json at all\n{"type":"result","subtype":"success"}\n', {
    onEvent: (e) => events.push(e),
  });
  assert.equal(events.length, 2);
  assert.equal(session.diagnostics().skippedLines, 1);
});

test('StreamJsonSession: 라인 경계와 무관하게 임의 크기 청크로 먹여도 같은 결과가 나온다', () => {
  const toolUse = JSON.stringify({ type: 'assistant', message: { content: [
    { type: 'tool_use', id: 'tu-c', name: 'mcp__athena__athena__render_canvas', input: {} },
  ] } });
  const toolResult = JSON.stringify({ type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'tu-c', content: JSON.stringify({
      canvas_type: 'table', fell_back: false, fallback_reason: null,
      data: { columns: [{ key: 'name', label: '종목명' }], rows: [{ name: '삼성전자' }] },
    }) },
  ] } });
  const text = `${toolUse}\n${toolResult}\n`;

  for (const chunkSize of [1, 7, 64, 4096, 1_000_000]) {
    const session = new StreamJsonSession();
    const collected = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      session.feed(text.slice(i, i + chunkSize), { onCanvasResult: (r) => collected.push(r) });
    }
    session.end({ onCanvasResult: (r) => collected.push(r) });
    assert.equal(collected.length, 1, `chunkSize=${chunkSize}`);
    assert.equal(collected[0].envelope.canvas_type, 'table');
    assert.equal(session.diagnostics().skippedLines, 0, `chunkSize=${chunkSize}`);
  }
});

test('StreamJsonSession: Grok use_tool로 감싼 render_canvas 결과도 캔버스로 분류한다', () => {
  const session = new StreamJsonSession();
  const collected = [];
  const toolUse = {
    type: 'assistant',
    message: { content: [{
      type: 'tool_use', id: 'grok-canvas-1', name: 'use_tool',
      input: {
        tool_name: 'athena__athena__render_canvas',
        tool_input: { plan_token: 'plan-1' },
      },
    }] },
  };
  const toolResult = {
    type: 'user',
    message: { content: [{
      type: 'tool_result', tool_use_id: 'grok-canvas-1', is_error: false,
      content: JSON.stringify({ canvas_type: 'facts', data: { fields: [] } }),
    }] },
  };
  session.feed(`${JSON.stringify(toolUse)}\n${JSON.stringify(toolResult)}\n`, {
    onCanvasResult: (result) => collected.push(result),
  });
  assert.equal(collected.length, 1);
  assert.equal(collected[0].status, 'success');
  assert.equal(collected[0].envelope.canvas_type, 'facts');
});

test('StreamJsonSession: 마지막 줄이 개행 없이 끝나도 end()가 회수한다', () => {
  const session = new StreamJsonSession();
  const events = [];
  session.feed('{"type":"system","subtype":"init"}\n{"type":"result","subtype":"success"}', {
    onEvent: (e) => events.push(e),
  });
  assert.equal(events.length, 1); // 두 번째 줄은 아직 carry에 있다
  session.end({ onEvent: (e) => events.push(e) });
  assert.equal(events.length, 2);
});

test('StreamJsonSession: finalResult()가 마지막 result/success 이벤트를 돌려준다', () => {
  const session = new StreamJsonSession();
  session.feed('{"type":"result","subtype":"success","is_error":false,"duration_ms":43865}\n', {});
  session.end({});
  const final = session.finalResult();
  assert.ok(final);
  assert.equal(final.type, 'result');
  assert.equal(final.subtype, 'success');
  assert.equal(final.is_error, false);
  assert.equal(final.duration_ms, 43865);
});

test('StreamJsonSession: onTextDelta가 조각마다 불리고, 청크 경계에 걸쳐도 순서·내용이 보존된다', () => {
  const lines = [
    JSON.stringify({ type: 'stream_event', event: { type: 'message_start' } }),
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '하' } } }),
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '나, 둘' } } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '하나, 둘' }] } }),
  ];
  const text = `${lines.join('\n')}\n`;
  for (const chunkSize of [1, 5, 4096]) {
    const session = new StreamJsonSession();
    const deltas = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      session.feed(text.slice(i, i + chunkSize), { onTextDelta: (d) => deltas.push(d) });
    }
    session.end({ onTextDelta: (d) => deltas.push(d) });
    assert.deepEqual(deltas, ['하', '나, 둘'], `chunkSize=${chunkSize}`);
  }
});

test('StreamJsonSession: onTextDelta가 없어도(REST 직결·캐시 리플레이 경로) 다른 콜백은 그대로 동작한다', () => {
  const session = new StreamJsonSession();
  const events = [];
  session.feed(
    `${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } } })}\n`,
    { onEvent: (e) => events.push(e) },
  );
  assert.equal(events.length, 1); // onTextDelta 콜백 부재가 onEvent를 막지 않는다
});

test('StreamJsonSession: onThinkingDelta가 추론 조각마다 불리고 text_delta·signature_delta는 안 섞인다', () => {
  const lines = [
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } } }),
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '37×50', estimated_tokens: null } } }),
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '부터 계산', estimated_tokens: null } } }),
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-abc' } } }),
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '1813입니다' } } }),
  ];
  const session = new StreamJsonSession();
  const thinkingDeltas = [];
  const textDeltas = [];
  session.feed(`${lines.join('\n')}\n`, {
    onThinkingDelta: (d) => thinkingDeltas.push(d),
    onTextDelta: (d) => textDeltas.push(d),
  });
  assert.deepEqual(thinkingDeltas, ['37×50', '부터 계산']);
  assert.deepEqual(textDeltas, ['1813입니다']);
});

test('StreamJsonSession: onThinkingDelta가 없어도(REST 직결·캐시 리플레이 경로) 다른 콜백은 그대로 동작한다', () => {
  const session = new StreamJsonSession();
  const events = [];
  session.feed(
    `${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'x', estimated_tokens: null } } })}\n`,
    { onEvent: (e) => events.push(e) },
  );
  assert.equal(events.length, 1); // onThinkingDelta 콜백 부재가 onEvent를 막지 않는다
});

test('classifyCanvasBlock: pushed 봉투는 별도 상태 — 카드 이중 렌더 방지', () => {
  const s = new StreamJsonSession();
  const results = [];
  const toolUse = JSON.stringify({ type: 'assistant', message: { content: [
    { type: 'tool_use', id: 'tu-p', name: 'mcp__athena__athena__render_canvas', input: {} },
  ] } });
  const toolResult = JSON.stringify({ type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'tu-p', content: JSON.stringify({
      canvas_type: 'chart', pushed: true, fell_back: false,
      summary: { rows_kept: 240, latest_close: 247500 },
    }) },
  ] } });
  s.feed(`${toolUse}
${toolResult}
`, { onCanvasResult: (r) => results.push(r) });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'pushed');
  assert.equal(results[0].envelope.canvas_type, 'chart');
  assert.equal(results[0].envelope.summary.latest_close, 247500);
});
