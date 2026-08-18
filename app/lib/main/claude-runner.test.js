// claude-runner.js의 순수 부분(buildArgs)만 테스트한다. runClaudeQuery는 실제
// `claude -p`를 spawn하므로 여기서 부르지 않는다(쿼터 소모 — CLAUDE.md §3,
// 오케스트레이터 지시). 계약은 spike/cli-pipe/gateway/RESULT.md §1 실왕복
// 커맨드와 문자 그대로 일치해야 한다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildArgs, RENDER_CANVAS_ALLOWED_TOOL, GATEWAY_ALLOWED_TOOLS } = require('./claude-runner');

test('buildArgs: RESULT.md §1 실왕복 커맨드와 동일한 인자 순서 · --setting-sources는 빈 문자열', () => {
  const args = buildArgs({ prompt: '1+1은?', configFile: '.mcp.json', allowedTools: RENDER_CANVAS_ALLOWED_TOOL });
  assert.deepEqual(args, [
    '-p', '1+1은?',
    '--output-format', 'stream-json',
    '--verbose',
    '--mcp-config', '.mcp.json',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--allowedTools', 'mcp__athena__athena__render_canvas',
  ]);
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
  assert.equal(GATEWAY_ALLOWED_TOOLS, 'mcp__athena');
});
