'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildArgs,
  RENDER_CANVAS_ALLOWED_TOOL,
  GATEWAY_ALLOWED_TOOLS,
  DISALLOWED_EXECUTION_TOOLS,
  DISABLE_TOOL_SEARCH_ENV,
} = require('./claude-runner');

test('buildArgs: RESULT.md §1 실왕복 커맨드와 동일한 인자 순서 · --setting-sources는 빈 문자열', () => {
  const args = buildArgs({ prompt: '1+1은?', configFile: '.mcp.json', allowedTools: RENDER_CANVAS_ALLOWED_TOOL });
  assert.deepEqual(args, [
    '-p', '1+1은?',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--mcp-config', '.mcp.json',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--allowedTools', 'mcp__athena__athena__render_canvas',
    // 2026-08-27(#33) 추가 — RESULT.md §1 원계약 이후의 보안 차단, 아래
    // DISALLOWED_EXECUTION_TOOLS 테스트 참고. 병합(대화→main)으로 Read·Glob은
    // 키우미 첨부 전제라 차단 목록에서 빠졌다(7종).
    '--disallowedTools', 'Bash,Write,Edit,NotebookEdit,Grep,WebFetch,WebSearch',
  ]);
});

test('buildArgs: --disallowedTools가 항상 붙는다(2026-08-27, #33) — allowedTools 값과 무관한 별도 안전망', () => {
  // 실측: --allowedTools는 화이트리스트가 아니라 자동 승인 목록이었다.
  // Bash/Read/Glob/Grep/Edit/NotebookEdit는 허용목록 밖인데도 기본 실행됐다
  // (claude-runner-baseline-tool-enum-probe 캡처) — 그래서 allowedTools가
  // 뭐든(카드 렌더용 단일 툴이든 게이트웨이 전체든) 이 차단은 항상 붙는다.
  const args = buildArgs({ prompt: 'x', configFile: '.mcp.json', allowedTools: 'y' });
  const i = args.indexOf('--disallowedTools');
  assert.ok(i >= 0);
  assert.equal(args[i + 1], DISALLOWED_EXECUTION_TOOLS);
});

test('buildArgs: --include-partial-messages가 항상 붙는다(2026-08-26 S2 — 답변 텍스트 델타 스트리밍)', () => {
  const args = buildArgs({ prompt: 'x', configFile: '.mcp.json', allowedTools: 'y' });
  assert.ok(args.includes('--include-partial-messages'));
});

test('buildArgs: --tools를 붙이지 않는다 — 표면 축소 실험 철회(E2E run1~5 실측, claude-runner.js 주석)', () => {
  const args = buildArgs({ prompt: 'x', configFile: '.mcp.json', allowedTools: 'y' });
  assert.equal(args.indexOf('--tools'), -1); // 재도입하려면 E2E 재실측 먼저
});

test('buildArgs: --setting-sources 값은 항상 빈 문자열 하나뿐 — 콤마 값 등으로 오염되지 않는다', () => {
  const args = buildArgs({ prompt: 'x', configFile: '.mcp.json', allowedTools: 'y' });
  const i = args.indexOf('--setting-sources');
  assert.ok(i >= 0);
  assert.equal(args[i + 1], ''); // S3 실측: "user"처럼 값을 하나라도 주면 완화책이 깨진다
});

test('buildArgs: resumeSessionId가 없으면 --resume이 붙지 않는다 — 첫 턴은 새 세션', () => {
  const args = buildArgs({ prompt: 'x', configFile: '.mcp.json', allowedTools: 'y' });
  assert.equal(args.indexOf('--resume'), -1);
});

test('buildArgs: resumeSessionId가 있으면 --resume <id>가 끝에 붙는다 — 멀티턴 재개', () => {
  const args = buildArgs({
    prompt: 'x', configFile: '.mcp.json', allowedTools: 'y',
    resumeSessionId: 'sess-abc-123',
  });
  assert.deepEqual(args.slice(-2), ['--resume', 'sess-abc-123']);
  // 기존 인자 순서(RESULT.md §1 계약)는 그대로 보존된다 — 재개 인자는 뒤에만 붙는다
  assert.deepEqual(args.slice(0, -2), buildArgs({ prompt: 'x', configFile: '.mcp.json', allowedTools: 'y' }));
});

test('buildArgs: model이 있으면 --model <model>이 --allowedTools 뒤·--resume 앞에 붙는다', () => {
  const args = buildArgs({ prompt: 'x', configFile: '.mcp.json', allowedTools: 'y', model: 'claude-sonnet-5' });
  const i = args.indexOf('--model');
  assert.ok(i >= 0);
  assert.equal(args[i + 1], 'claude-sonnet-5');
});

test('buildArgs: model이 없으면(undefined) --model이 안 붙는다 — "기본"의 의미', () => {
  const args = buildArgs({ prompt: 'x', configFile: '.mcp.json', allowedTools: 'y' });
  assert.equal(args.indexOf('--model'), -1);
});

test('buildArgs: effort가 있으면 --effort <effort>가 붙는다', () => {
  const args = buildArgs({ prompt: 'x', configFile: '.mcp.json', allowedTools: 'y', effort: 'high' });
  const i = args.indexOf('--effort');
  assert.ok(i >= 0);
  assert.equal(args[i + 1], 'high');
});

test('buildArgs: effort가 없으면 --effort가 안 붙는다', () => {
  const args = buildArgs({ prompt: 'x', configFile: '.mcp.json', allowedTools: 'y' });
  assert.equal(args.indexOf('--effort'), -1);
});

test('buildArgs: model·effort·resumeSessionId가 모두 있으면 셋 다 붙고, model/effort가 --resume보다 앞이다', () => {
  const args = buildArgs({
    prompt: 'x', configFile: '.mcp.json', allowedTools: 'y',
    model: 'claude-opus-5', effort: 'max', resumeSessionId: 'sess-1',
  });
  assert.deepEqual(args.slice(-6), [
    '--model', 'claude-opus-5',
    '--effort', 'max',
    '--resume', 'sess-1',
  ]);
});

test('RENDER_CANVAS_ALLOWED_TOOL: athena__가 두 번 나오는 실측 이름 그대로', () => {
  assert.equal(RENDER_CANVAS_ALLOWED_TOOL, 'mcp__athena__athena__render_canvas');
});

test('GATEWAY_ALLOWED_TOOLS: 서버 단위 허용 — 업스트림 재노출 툴이 권한에서 죽지 않는다', () => {
  // 툴 1개짜리 기본값은 게이트웨이가 재노출한 업스트림 툴(dart-mcp 등)을 전부
  // 거부하게 만든다 — 2026-08-17 실사용에서 실측된 결함. 툴 단위 게이트는
  // 게이트웨이 consent allowlist가 담당하므로 CLI는 서버 단위로 허용한다.
  // Task(서브에이전트, 2026-08-27) — 허용목록은 프로세스 전체에 한 벌이라
  // 서브에이전트 권한 경계가 부모보다 넓어지지 않는다(claude-runner-subagent-probe
  // 실측: mcp__athena는 부모처럼 성공, 허용목록 밖 Write는 부모처럼 거부).
  // Read·Glob(2026-08-27) — 키우미 파일/폴더 첨부의 전제(병합 결정: 차단 목록에서도 뺐다).
  assert.equal(GATEWAY_ALLOWED_TOOLS, 'mcp__athena,Task,Read,Glob');
});

test('DISALLOWED_EXECUTION_TOOLS: 실행류 빌트인 차단 — Read·Glob(첨부)·Agent(서브에이전트)는 의도적 제외', () => {
  // 전수 실측(baseline-tool-enum-probe)은 9종이었으나 병합 결정(2026-08-27,
  // 대화→main)으로 Read·Glob은 키우미 첨부(B4 사용자 확정)의 전제라 차단하지
  // 않는다 — 나머지 7종(이미 거부되던 Write/WebFetch/WebSearch도 방어적으로
  // 포함, 향후 기본 동작이 바뀌어도 안전하게)만 명시 차단한다.
  assert.equal(DISALLOWED_EXECUTION_TOOLS, 'Bash,Write,Edit,NotebookEdit,Grep,WebFetch,WebSearch');
  // Agent(서브에이전트)는 여기 없다 — #30에서 의도적으로 연 툴이다.
  assert.ok(!DISALLOWED_EXECUTION_TOOLS.split(',').includes('Agent'));
  // Read·Glob도 없다 — 있으면 첨부가 죽는다(명시 허용과 모순).
  assert.ok(!DISALLOWED_EXECUTION_TOOLS.split(',').includes('Read'));
  assert.ok(!DISALLOWED_EXECUTION_TOOLS.split(',').includes('Glob'));
});

test('DISABLE_TOOL_SEARCH_ENV: 항상 "0"으로 고정한다 — 부모 셸의 ENABLE_TOOL_SEARCH 상속을 덮는다', () => {
  // 2026-08-26 실측: 오케스트레이션 셸이 사용자 설정 env로 ENABLE_TOOL_SEARCH=1을
  // 내보내면 그 셸에서 띄운 이 앱의 claude -p 자식이 그대로 물려받아 MCP 툴을
  // 지연 로딩(ToolSearch)으로 돌렸고, 그 인덱서가 athena__render_canvas 하나만
  // 못 찾아 카드가 캔버스에 전혀 안 뜨는 결함으로 이어졌다(일반 사용자는 이
  // env가 없어 즉시 로딩이라 재현되지 않았다). 실제 spawn env에 반영되는지는
  // claude-runner.stdout-cap.test.js가 실제 프로세스로 검증한다.
  assert.deepEqual(DISABLE_TOOL_SEARCH_ENV, { ENABLE_TOOL_SEARCH: '0' });
});
