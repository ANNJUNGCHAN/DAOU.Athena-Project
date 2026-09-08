
'use strict';

const RENDER_CANVAS_SUFFIX = '__athena__render_canvas';
const GROK_RENDER_CANVAS_NAMES = new Set([
  'athena__athena_render_canvas',
  'mcp__athena__athena_render_canvas',
]);

function isRenderCanvasToolName(name) {
  return typeof name === 'string'
    && (name.endsWith(RENDER_CANVAS_SUFFIX) || GROK_RENDER_CANVAS_NAMES.has(name));
}

// Grok의 MCP 호출은 실제 서버 도구를 곧바로 tool_use.name에 싣지 않고 내장
// use_tool 하나로 감싼다. tool_result는 바깥 id만 되돌리므로, 시작 블록에서
// 실제 이름·입력을 풀어 인덱스와 main 진행 추적기가 같은 상관관계를 쓰게 한다.
// 불완전한 봉투는 오인식하지 않고 원문으로 돌려 기존 처리에 맡긴다.
function normalizeToolUseBlock(block) {
  if (!block || block.name !== 'use_tool') return block;
  const outerInput = block.input;
  if (!outerInput || typeof outerInput !== 'object' || Array.isArray(outerInput)) return block;
  if (typeof outerInput.tool_name !== 'string' || !outerInput.tool_name.trim()) return block;
  const toolInput = outerInput.tool_input;
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) return block;
  return { ...block, name: outerInput.tool_name, input: toolInput };
}

// ---------------------------------------------------------------------------
// 0b. 서브에이전트(Agent/Task) 인식 — task #32, 실측 근거는
//     .omc/research/2026-08-27-서브에이전트-스트림-계약.md.
//     --allowedTools에는 'Task'(별칭)를 넘기지만 실제 tool_use 블록 이름은
//     'Agent'로 찍힌다(CLI v2.1.63 Task→Agent 리네임) — 'Task' 문자열 매칭은
//     실측과 어긋난다.
// ---------------------------------------------------------------------------
const AGENT_TOOL_NAME = 'Agent';

function isAgentToolName(name) {
  return name === AGENT_TOOL_NAME;
}

// 서브에이전트 생애주기 이벤트 4종 — 전부 type:'system', subtype으로 구분.
const SUBAGENT_SUBTYPES = new Set(['task_started', 'task_progress', 'task_updated', 'task_notification']);

// 원시 system 이벤트 → 정규화된 서브에이전트 생애주기 스텝. 4종이 아니거나
// task_id가 없으면 null(호출자는 무시) — task_id가 도크 행의 안정 식별자다.
// last_tool_name(원문 툴 이름)은 여기서 라벨로 바꾸지 않는다 — main.js가 이미
// 가진 toolStepLabel/TOOL_STEP_LABELS(카드 진행 표시와 같은 매핑)를 그대로
// 쓰려면 호출부(main.js)가 그 변환을 해야 한다(이 모듈은 main.js 라벨표에
// 의존하지 않는 순수 분류 계층으로 남는다).
function classifySubagentEvent(event) {
  if (!event || event.type !== 'system' || !SUBAGENT_SUBTYPES.has(event.subtype)) return null;
  const taskId = event.task_id;
  if (!taskId) return null;
  if (event.subtype === 'task_started') {
    return {
      subtype: 'task_started',
      taskId,
      toolUseId: event.tool_use_id || null,
      description: event.description || null,
      subagentType: event.subagent_type || null,
    };
  }
  if (event.subtype === 'task_progress') {
    return {
      subtype: 'task_progress',
      taskId,
      description: event.description || null,
      lastToolName: event.last_tool_name || null,
      elapsedMs: event.usage && typeof event.usage.duration_ms === 'number' ? event.usage.duration_ms : null,
    };
  }
  if (event.subtype === 'task_updated') {
    const patch = event.patch || {};
    return {
      subtype: 'task_updated',
      taskId,
      status: typeof patch.status === 'string' ? patch.status : null,
      endTime: typeof patch.end_time === 'number' ? patch.end_time : null,
    };
  }
  // task_notification
  return {
    subtype: 'task_notification',
    taskId,
    status: event.status || null,
    summary: typeof event.summary === 'string' ? event.summary : null,
  };
}

// 서브에이전트 내부 활동 판정(실측 §3) — assistant/user 이벤트의
// parent_tool_use_id가 null이 아니면 그 서브에이전트 자신의 내부 턴(사고·툴
// 호출·툴 결과)이다. Agent tool_use 자체(최상위가 issue) · 그 최종 결과를
// 최상위에 되돌리는 tool_result는 실측상 parent_tool_use_id:null이라 여기
// 안 걸린다 — main.js가 그 둘은 isAgentToolName으로 별도 거른다(Agent 자체
// 생애주기는 이 모듈의 task_* 이벤트로 이미 추적하므로 최상위 진행 라인에
// 중복 안 낸다).
function isSubagentInternalEvent(event) {
  return !!(event && event.parent_tool_use_id != null);
}

// ---------------------------------------------------------------------------
// 1. NDJSON 라인 분할 — 청크 경계 처리
// ---------------------------------------------------------------------------
// 순수 함수: 이전 남은 조각(carry) + 새 청크 → 확정된 라인들 + 다음 carry.
// 마지막 조각은 개행 없이 끝났을 수 있으므로(미완성 라인) carry로 넘긴다.
function splitLines(carry, chunk) {
  const text = (carry || '') + (chunk == null ? '' : chunk);
  const parts = text.split('\n');
  const nextCarry = parts.pop();
  const lines = parts.map((l) => l.replace(/\r$/, ''));
  return { lines, carry: nextCarry };
}

// 스트림 종료(process 'close') 시 남은 carry를 flush한다 — 마지막 줄이
// 개행 없이 끝나는 경우가 실제로 있다(S4 캡처 42번째 줄).
function flushCarry(carry) {
  const line = String(carry || '').replace(/\r$/, '');
  return line.trim() ? [line] : [];
}

// ---------------------------------------------------------------------------
// 2. 라인 → 이벤트 파싱 — 비JSON 라인은 던지지 않고 건너뛰되 센다(진단용)
// ---------------------------------------------------------------------------
function parseLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return { ok: false, raw: line };
  try {
    return { ok: true, event: JSON.parse(trimmed) };
  } catch (err) {
    return { ok: false, raw: line, error: String((err && err.message) || err) };
  }
}

// 편의 함수 — 캡처 파일 전체 텍스트를 통째로 먹여 이벤트 배열을 얻는다.
// 테스트가 spawn 없이 픽스처 파일 하나로 파서를 검증할 수 있게 하는 진입점이다.
function parseAllLines(fullText) {
  const rawLines = String(fullText || '').split('\n');
  const events = [];
  let skippedLines = 0;
  for (const raw of rawLines) {
    if (!raw.trim()) continue;
    const result = parseLine(raw);
    if (result.ok) events.push(result.event);
    else skippedLines += 1;
  }
  return { events, skippedLines, totalLines: rawLines.length };
}

// ---------------------------------------------------------------------------
// 3. tool_use 인덱스 — tool_use_id → 툴 이름
// ---------------------------------------------------------------------------
// assistant 메시지의 message.content 안 tool_use 블록을 스캔한다. tool_result는
// 이 인덱스로만 "이게 render_canvas 호출의 결과였는가"를 안다 — tool_result
// 자체에는 툴 이름이 없다.
function indexToolUseBlock(index, event) {
  if (!event || event.type !== 'assistant') return;
  const content = event.message && event.message.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block && block.type === 'tool_use' && block.id) {
      const toolUse = normalizeToolUseBlock(block);
      index.set(block.id, { name: toolUse.name, isRenderCanvas: isRenderCanvasToolName(toolUse.name) });
    }
  }
}

function buildToolUseIndex(events) {
  const index = new Map();
  for (const event of events) indexToolUseBlock(index, event);
  return index;
}

// ---------------------------------------------------------------------------
// 4. tool_result 블록 추출 — content가 문자열/배열 둘 다 오는 걸 여기서 흡수한다
// ---------------------------------------------------------------------------
function extractToolResultBlocks(event) {
  if (!event || event.type !== 'user') return [];
  const content = event.message && event.message.content;
  if (!Array.isArray(content)) return [];
  const metaById = new Map();
  if (Array.isArray(event.tool_result_meta)) {
    for (const m of event.tool_result_meta) {
      if (m && m.id) metaById.set(m.id, m);
    }
  }
  const blocks = [];
  for (const block of content) {
    if (block && block.type === 'tool_result') {
      blocks.push({
        toolUseId: block.tool_use_id,
        content: block.content, // 문자열 | 블록 배열 — 정규화는 아래에서
        isError: block.is_error === true, // undefined/false는 성공 취급
        meta: metaById.get(block.tool_use_id) || null,
      });
    }
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// 5. content 정규화
// ---------------------------------------------------------------------------
function normalizeToolResultContent(content) {
  if (typeof content === 'string') return { kind: 'string', text: content };
  if (Array.isArray(content)) return { kind: 'blocks', blocks: content };
  return { kind: 'unknown', raw: content };
}

// ---------------------------------------------------------------------------
// 6. 캔버스 봉투 추출 — content 문자열을 한 번 더 JSON.parse
// ---------------------------------------------------------------------------
function extractCanvasEnvelope(normalizedContent) {
  if (normalizedContent.kind !== 'string') {
    return { ok: false, reason: 'not-a-string-content' };
  }
  let parsed;
  try {
    parsed = JSON.parse(normalizedContent.text);
  } catch (err) {
    return { ok: false, reason: 'json-parse-failed', error: String((err && err.message) || err) };
  }
  if (!parsed || typeof parsed !== 'object' || !('canvas_type' in parsed)) {
    return { ok: false, reason: 'not-a-canvas-envelope' };
  }
  return { ok: true, envelope: parsed };
}

// ---------------------------------------------------------------------------
// 7. 거부 판정
// ---------------------------------------------------------------------------
function isUserRejected(block) {
  return block.isError === true && !!block.meta && block.meta.non_execution_kind === 'user-rejected';
}

// ---------------------------------------------------------------------------
// 8. tool_result 블록 하나 → 캔버스 결과로 분류 (성공/폴백/거부/에러/해석불가)
// ---------------------------------------------------------------------------
function classifyCanvasBlock(block) {
  if (isUserRejected(block)) {
    return { toolUseId: block.toolUseId, status: 'rejected', raw: block };
  }
  if (block.isError) {
    return { toolUseId: block.toolUseId, status: 'error', raw: block };
  }
  const normalized = normalizeToolResultContent(block.content);
  const envelopeResult = extractCanvasEnvelope(normalized);
  if (!envelopeResult.ok) {
    return { toolUseId: block.toolUseId, status: 'unparseable', raw: block, reason: envelopeResult.reason };
  }
  const envelope = envelopeResult.envelope;
  // 데이터 지름길(2026-08-19, backend canvas_data.py) — pushed:true는 카드가
  // 사이드 채널(WS /api/v1/ws/canvas)로 이미 앱에 도착했다는 뜻이다. 이 결과는
  // 모델용 요약 전용이라 카드를 그리면 이중 렌더가 된다 — 별도 상태로 분류한다.
  if (envelope.pushed === true) {
    return { toolUseId: block.toolUseId, status: 'pushed', envelope };
  }
  // ★ canvas_type은 응답값으로 읽는다 — 요청값이 아니다. S4 RESULT.md §5:
  // 실왕복 3회 중 2회가 요청 table에 대해 응답 free로 폴백했다.
  return {
    toolUseId: block.toolUseId,
    status: envelope.fell_back ? 'fallback' : 'success',
    envelope,
  };
}

// ---------------------------------------------------------------------------
// 9. 상위 결합(배치) — 이벤트 목록에서 render_canvas 결과만 순서대로 뽑는다.
//    테스트가 캡처 파일 하나로 전체 파이프라인을 검증하는 진입점.
// ---------------------------------------------------------------------------
function collectCanvasResults(events) {
  const toolUseIndex = buildToolUseIndex(events);
  const results = [];
  for (const event of events) {
    for (const block of extractToolResultBlocks(event)) {
      const info = toolUseIndex.get(block.toolUseId);
      if (!info || !info.isRenderCanvas) continue; // render_canvas 호출이 아니면 무시
      results.push(classifyCanvasBlock(block));
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// 9b. 텍스트 델타 추출 — --include-partial-messages가 얹는 stream_event 중
//     content_block_delta/text_delta만 채팅 버블에 흘려보낼 조각이다. 실측
//     (claude -p --include-partial-messages --output-format stream-json):
//     {"type":"stream_event","event":{"type":"content_block_delta",
//      "index":0,"delta":{"type":"text_delta","text":"..."}}}
//     tool_use 인자 스트리밍(input_json_delta)은 채팅 답변이 아니라 걸러낸다.
// ---------------------------------------------------------------------------
function extractTextDelta(event) {
  if (!event || event.type !== 'stream_event') return null;
  const inner = event.event;
  if (!inner || inner.type !== 'content_block_delta') return null;
  const delta = inner.delta;
  if (!delta || delta.type !== 'text_delta' || typeof delta.text !== 'string') return null;
  return delta.text;
}

// 추론 과정 조각 — 실측(claude -p --include-partial-messages, thinking 블록):
//   {"type":"stream_event","event":{"type":"content_block_delta","index":0,
//    "delta":{"type":"thinking_delta","thinking":"...","estimated_tokens":null}}}
// 같은 content_block_delta 안에 signature_delta(서명, 텍스트 아님)도 오므로
// type이 정확히 thinking_delta일 때만 뽑는다 — 미리보기 전용이라 저장하지 않는다.
function extractThinkingDelta(event) {
  if (!event || event.type !== 'stream_event') return null;
  const inner = event.event;
  if (!inner || inner.type !== 'content_block_delta') return null;
  const delta = inner.delta;
  if (!delta || delta.type !== 'thinking_delta' || typeof delta.thinking !== 'string') return null;
  return delta.thinking;
}

// ---------------------------------------------------------------------------
// 10. 스트리밍 세션 — child_process stdout 청크를 실시간으로 먹인다.
//     내부에 최소 상태(carry, tool_use 인덱스, 카운터)만 들고 전체 이벤트
//     로그는 쌓지 않는다 — 왕복 하나가 43초+ 걸릴 수 있어 메모리를 늘리지 않는다.
// ---------------------------------------------------------------------------
class StreamJsonSession {
  constructor() {
    this._carry = '';
    this._toolUseIndex = new Map();
    this._skippedLines = 0;
    this._eventCount = 0;
    this._finalResult = null;
  }

  // 청크 하나를 먹인다. callbacks.onEvent(event) — 파싱된 이벤트마다.
  // callbacks.onCanvasResult(result) — render_canvas의 tool_result가 확정될 때마다.
  // callbacks.onTextDelta(text) — --include-partial-messages를 켰을 때 답변
  // 텍스트 조각마다(진행 중인 채팅 버블에 이어붙이는 용도, 선택).
  // callbacks.onThinkingDelta(text) — 같은 플래그의 추론 조각마다(미리보기
  // 전용 — 호출자가 턴 기록에 저장하면 안 된다, 선택).
  // 반환값은 이번 호출에서 새로 나온 캔버스 결과 배열(호출부가 편의상 쓸 수 있게).
  feed(chunk, callbacks) {
    const { lines, carry } = splitLines(this._carry, chunk);
    this._carry = carry;
    return this._consumeLines(lines, callbacks || {});
  }

  // 프로세스 종료 시 남은 조각을 flush한다.
  end(callbacks) {
    const lines = flushCarry(this._carry);
    this._carry = '';
    return this._consumeLines(lines, callbacks || {});
  }

  _consumeLines(lines, { onEvent, onCanvasResult, onTextDelta, onThinkingDelta }) {
    const newResults = [];
    for (const raw of lines) {
      const parsed = parseLine(raw);
      if (!parsed.ok) { this._skippedLines += 1; continue; }
      const event = parsed.event;
      this._eventCount += 1;
      indexToolUseBlock(this._toolUseIndex, event);
      if (event.type === 'result') this._finalResult = event;
      if (onEvent) onEvent(event);
      if (onTextDelta) {
        const delta = extractTextDelta(event);
        if (delta) onTextDelta(delta);
      }
      if (onThinkingDelta) {
        const thinkingDelta = extractThinkingDelta(event);
        if (thinkingDelta) onThinkingDelta(thinkingDelta);
      }
      for (const block of extractToolResultBlocks(event)) {
        const info = this._toolUseIndex.get(block.toolUseId);
        if (!info || !info.isRenderCanvas) continue;
        const result = classifyCanvasBlock(block);
        newResults.push(result);
        if (onCanvasResult) onCanvasResult(result);
      }
    }
    return newResults;
  }

  diagnostics() {
    return { skippedLines: this._skippedLines, totalEvents: this._eventCount };
  }

  finalResult() {
    return this._finalResult;
  }
}

module.exports = {
  RENDER_CANVAS_SUFFIX,
  isRenderCanvasToolName,
  normalizeToolUseBlock,
  AGENT_TOOL_NAME,
  isAgentToolName,
  classifySubagentEvent,
  isSubagentInternalEvent,
  splitLines,
  flushCarry,
  parseLine,
  parseAllLines,
  buildToolUseIndex,
  extractToolResultBlocks,
  normalizeToolResultContent,
  extractCanvasEnvelope,
  isUserRejected,
  classifyCanvasBlock,
  collectCanvasResults,
  extractTextDelta,
  extractThinkingDelta,
  StreamJsonSession,
};
