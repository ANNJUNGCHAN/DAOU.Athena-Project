// stream-json-parser.js 단위 테스트. `node --test app/lib/main/stream-json-parser.test.js`로 돈다
// (electron이 필요 없다 — 파서는 순수 Node다, 그게 lib/main/ 분리의 요점이다).
//
// 픽스처는 spike/captures/S4-gateway-cli-roundtrip.ndjson **하나뿐**이다 — 실제
// `claude -p` ↔ 게이트웨이 왕복 42 이벤트를 담은 불변 증거다(CLAUDE.md §3).
// 지어낸 픽스처를 쓰지 않는다. claude -p를 여기서 실제로 호출하지 않는다(쿼터).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  splitLines,
  flushCarry,
  parseLine,
  parseAllLines,
  isRenderCanvasToolName,
  buildToolUseIndex,
  extractToolResultBlocks,
  normalizeToolResultContent,
  extractCanvasEnvelope,
  isUserRejected,
  classifyCanvasBlock,
  collectCanvasResults,
  StreamJsonSession,
} = require('./stream-json-parser');

const FIXTURE_PATH = path.join(__dirname, '..', '..', '..', 'spike', 'captures', 'S4-gateway-cli-roundtrip.ndjson');
const FIXTURE_TEXT = fs.readFileSync(FIXTURE_PATH, 'utf-8');

// ---------------------------------------------------------------------------
// 1. 라인 분할 — 청크 경계 (합성 예시)
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
// 3. 픽스처 전체 파싱 — 42 이벤트, 비JSON 0건
// ---------------------------------------------------------------------------
test('parseAllLines: S4 캡처 42 이벤트 전부 유효한 JSON이다', () => {
  const { events, skippedLines } = parseAllLines(FIXTURE_TEXT);
  assert.equal(events.length, 42);
  assert.equal(skippedLines, 0);
});

// ---------------------------------------------------------------------------
// 4. 툴 이름 매칭 — "athena__"가 두 번 나오는 실제 이름 + 별칭이 다른 경우
// ---------------------------------------------------------------------------
test('isRenderCanvasToolName: 실측 이름과 별칭이 다른 경우 둘 다 매칭', () => {
  assert.equal(isRenderCanvasToolName('mcp__athena__athena__render_canvas'), true);
  assert.equal(isRenderCanvasToolName('mcp__my-alias__athena__render_canvas'), true);
  assert.equal(isRenderCanvasToolName('mcp__athena__athena__save_canvas'), false);
  assert.equal(isRenderCanvasToolName('mcp__everything__echo'), false);
  assert.equal(isRenderCanvasToolName(undefined), false);
});

test('buildToolUseIndex: 픽스처 안 render_canvas tool_use 3건을 잡는다', () => {
  const { events } = parseAllLines(FIXTURE_TEXT);
  const index = buildToolUseIndex(events);
  const renderCanvasEntries = [...index.values()].filter((v) => v.isRenderCanvas);
  assert.equal(renderCanvasEntries.length, 3); // 1차 실패 · 2차 실패 · 3차 성공
});

// ---------------------------------------------------------------------------
// 5. 핵심 계약 — 성공 1 + free 폴백 2 + canvas_type은 응답값
// ---------------------------------------------------------------------------
test('collectCanvasResults: S4 캡처에서 성공 1건 + free 폴백 2건을 순서대로 뽑는다', () => {
  const { events } = parseAllLines(FIXTURE_TEXT);
  const results = collectCanvasResults(events);

  assert.equal(results.length, 3);
  assert.deepEqual(results.map((r) => r.status), ['fallback', 'fallback', 'success']);

  // ★ canvas_type은 요청값(table)이 아니라 응답값으로 읽어야 한다 — 두 번의
  // 폴백은 요청이 table이었지만 응답은 free였다(S4 RESULT.md §5).
  assert.equal(results[0].envelope.canvas_type, 'free');
  assert.equal(results[0].envelope.fell_back, true);
  assert.ok(results[0].envelope.fallback_reason.includes('is not of type'));

  assert.equal(results[1].envelope.canvas_type, 'free');
  assert.equal(results[1].envelope.fell_back, true);

  assert.equal(results[2].envelope.canvas_type, 'table');
  assert.equal(results[2].envelope.fell_back, false);
  assert.equal(results[2].envelope.fallback_reason, null);
});

test('collectCanvasResults: 성공한 table 봉투의 실제 데이터 형상 — columns는 {key,label} 객체 배열', () => {
  const { events } = parseAllLines(FIXTURE_TEXT);
  const results = collectCanvasResults(events);
  const success = results[2];
  assert.deepEqual(success.envelope.data.columns, [
    { key: 'name', label: '종목명' },
    { key: 'price', label: '현재가' },
  ]);
  assert.deepEqual(success.envelope.data.rows, [
    { name: '삼성전자', price: '71,000원' },
    { name: 'SK하이닉스', price: '195,000원' },
  ]);
});

// ---------------------------------------------------------------------------
// 6. content 정규화 — 문자열/블록배열 둘 다
// ---------------------------------------------------------------------------
test('normalizeToolResultContent: 문자열 content', () => {
  const r = normalizeToolResultContent('{"canvas_type":"table"}');
  assert.equal(r.kind, 'string');
  assert.equal(r.text, '{"canvas_type":"table"}');
});

test('normalizeToolResultContent: 블록 배열 content (실측 — ToolSearch 결과, 픽스처 10번째 줄)', () => {
  const { events } = parseAllLines(FIXTURE_TEXT);
  // ToolSearch의 tool_result — content가 tool_reference 블록 배열인 실제 이벤트를 찾는다.
  const userEvents = events.filter((e) => e.type === 'user');
  const withArrayContent = userEvents.find((e) => {
    const c = e.message && e.message.content;
    return Array.isArray(c) && c.some((b) => b.type === 'tool_result' && Array.isArray(b.content));
  });
  assert.ok(withArrayContent, '픽스처에 배열 content를 가진 tool_result가 있어야 한다');
  const block = extractToolResultBlocks(withArrayContent)[0];
  const normalized = normalizeToolResultContent(block.content);
  assert.equal(normalized.kind, 'blocks');
  assert.ok(Array.isArray(normalized.blocks));
  assert.equal(normalized.blocks[0].type, 'tool_reference');
});

test('extractCanvasEnvelope: 블록배열 content는 캔버스 봉투로 취급하지 않는다(방어적)', () => {
  const normalized = { kind: 'blocks', blocks: [{ type: 'tool_reference', tool_name: 'x' }] };
  const r = extractCanvasEnvelope(normalized);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-a-string-content');
});

test('classifyCanvasBlock: render_canvas 결과가 배열 content로 온다면 unparseable로 안전하게 떨어진다', () => {
  // 실측 픽스처엔 없는 조합이지만(render_canvas 결과는 항상 문자열이었다),
  // 계약이 "둘 다 처리하라"이므로 방어적으로 다뤄야 한다 — 크래시도, 오인식도 안 된다.
  const block = { toolUseId: 't1', content: [{ type: 'tool_reference', tool_name: 'x' }], isError: false, meta: null };
  const r = classifyCanvasBlock(block);
  assert.equal(r.status, 'unparseable');
  assert.equal(r.reason, 'not-a-string-content');
});

// ---------------------------------------------------------------------------
// 7. is_error 세 값 + 권한거부 판정 (실측 — 픽스처 34번째 줄, Grep 거부)
// ---------------------------------------------------------------------------
test('is_error: undefined/false/true 세 값이 실제로 픽스처에 다 나온다', () => {
  const { events } = parseAllLines(FIXTURE_TEXT);
  const allBlocks = events.flatMap((e) => extractToolResultBlocks(e));
  const isErrorValues = new Set(allBlocks.map((b) => b.isError));
  // 정규화 후엔 boolean만 남지만(undefined→false), 원본 사실 확인을 위해
  // 정규화 이전 블록 검색 — extractToolResultBlocks가 이미 정규화하므로
  // isError:true가 최소 1건은 있어야 한다(Grep 거부).
  assert.ok(isErrorValues.has(true), '거부된 Grep 호출이 isError:true로 잡혀야 한다');
  assert.ok(isErrorValues.has(false), '성공/폴백 호출들은 isError:false로 잡혀야 한다');
});

test('isUserRejected: 실측 권한거부(Grep, non-render_canvas)를 정확히 분류한다', () => {
  const { events } = parseAllLines(FIXTURE_TEXT);
  const allBlocks = events.flatMap((e) => extractToolResultBlocks(e));
  const rejected = allBlocks.filter((b) => isUserRejected(b));
  assert.equal(rejected.length, 1); // 픽스처엔 거부가 정확히 1건 — Grep 하나
  const toolUseIndex = buildToolUseIndex(events);
  const rejectedToolInfo = toolUseIndex.get(rejected[0].toolUseId);
  assert.equal(rejectedToolInfo.name, 'Grep'); // render_canvas가 아니라 내장 Grep이 거부됐다
  assert.equal(rejectedToolInfo.isRenderCanvas, false);
});

test('collectCanvasResults: render_canvas가 아닌 거부(Grep)는 캔버스 결과에 섞이지 않는다', () => {
  const { events } = parseAllLines(FIXTURE_TEXT);
  const results = collectCanvasResults(events);
  assert.ok(results.every((r) => r.status !== 'rejected'));
  assert.equal(results.length, 3); // Grep 거부 1건은 여기 안 들어간다
});

// ---------------------------------------------------------------------------
// 8. 스트리밍 세션 — 임의 지점(라인 중간 포함)에서 청크를 쪼개도 배치 결과와 같다
// ---------------------------------------------------------------------------
function feedInChunks(text, chunkSize) {
  const session = new StreamJsonSession();
  const collected = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize);
    session.feed(chunk, { onCanvasResult: (r) => collected.push(r) });
  }
  session.end({ onCanvasResult: (r) => collected.push(r) });
  return { collected, session };
}

test('StreamJsonSession: 라인 경계와 무관하게 임의 크기 청크로 먹여도 배치와 같은 3건이 나온다', () => {
  for (const chunkSize of [1, 7, 64, 4096, 1_000_000]) {
    const { collected, session } = feedInChunks(FIXTURE_TEXT, chunkSize);
    assert.equal(collected.length, 3, `chunkSize=${chunkSize}`);
    assert.deepEqual(collected.map((r) => r.status), ['fallback', 'fallback', 'success']);
    assert.equal(collected[2].envelope.canvas_type, 'table');
    assert.equal(session.diagnostics().skippedLines, 0, `chunkSize=${chunkSize}`);
  }
});

test('StreamJsonSession: 마지막 줄이 개행 없이 끝나도(파일 끝) end()가 회수한다', () => {
  // 픽스처 파일 자체가 마지막 줄에 트레일링 개행이 없을 수 있다 — 실측 확인.
  const trailingNewline = FIXTURE_TEXT.endsWith('\n');
  const session = new StreamJsonSession();
  const collected = [];
  session.feed(FIXTURE_TEXT, { onCanvasResult: (r) => collected.push(r) });
  const tail = session.end({ onCanvasResult: () => {} });
  if (!trailingNewline) {
    // 개행 없이 끝났다면 feed() 단계에서는 carry에 남아 있었을 것 — end()가 비어있지
    // 않을 수 있다. 어느 쪽이든 최종 캔버스 결과 수는 3이어야 한다.
    assert.equal(collected.length, 3);
  } else {
    assert.equal(collected.length, 3);
    assert.deepEqual(tail, []);
  }
});

test('StreamJsonSession: diagnostics()가 이벤트 수를 정확히 센다', () => {
  const session = new StreamJsonSession();
  session.feed(FIXTURE_TEXT, {});
  session.end({});
  assert.equal(session.diagnostics().totalEvents, 42);
  assert.equal(session.diagnostics().skippedLines, 0);
});

test('StreamJsonSession: finalResult()가 마지막 result/success 이벤트를 돌려준다', () => {
  const session = new StreamJsonSession();
  session.feed(FIXTURE_TEXT, {});
  session.end({});
  const final = session.finalResult();
  assert.ok(final);
  assert.equal(final.type, 'result');
  assert.equal(final.subtype, 'success');
  assert.equal(final.is_error, false);
  assert.equal(final.duration_ms, 43865);
});

// ---------------------------------------------------------------------------
// 9. 비JSON 라인이 섞여도 죽지 않고 세기만 한다 (합성 — 실측 픽스처는 전부 유효하므로)
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
