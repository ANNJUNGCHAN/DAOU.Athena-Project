// claude-runner.js의 순수 부분(buildArgs)만 테스트한다. runClaudeQuery는 실제
// `claude -p`를 spawn하므로 여기서 부르지 않는다(쿼터 소모 — CLAUDE.md §3,
// 오케스트레이터 지시). 계약은 spike/cli-pipe/gateway/RESULT.md §1 실왕복
// 커맨드와 문자 그대로 일치해야 한다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildArgs, RENDER_CANVAS_ALLOWED_TOOL } = require('./claude-runner');

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

test('RENDER_CANVAS_ALLOWED_TOOL: athena__가 두 번 나오는 실측 이름 그대로', () => {
  assert.equal(RENDER_CANVAS_ALLOWED_TOOL, 'mcp__athena__athena__render_canvas');
});
