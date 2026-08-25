
'use strict';

const RENDER_CANVAS_SUFFIX = '__athena__render_canvas';

function isRenderCanvasToolName(name) {
  return typeof name === 'string' && name.endsWith(RENDER_CANVAS_SUFFIX);
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
      index.set(block.id, { name: block.name, isRenderCanvas: isRenderCanvasToolName(block.name) });
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

  _consumeLines(lines, { onEvent, onCanvasResult }) {
    const newResults = [];
    for (const raw of lines) {
      const parsed = parseLine(raw);
      if (!parsed.ok) { this._skippedLines += 1; continue; }
      const event = parsed.event;
      this._eventCount += 1;
      indexToolUseBlock(this._toolUseIndex, event);
      if (event.type === 'result') this._finalResult = event;
      if (onEvent) onEvent(event);
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
  StreamJsonSession,
};
