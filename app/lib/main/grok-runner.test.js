'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildArgs, DISALLOWED_EXECUTION_TOOLS } = require('./grok-runner');

test('buildArgs: streaming-messages-json + 부분 메시지 + yolo + verbatim + 실행 툴 차단', () => {
  const args = buildArgs({ prompt: '1+1은?' });
  assert.deepEqual(args, [
    '-p', '1+1은?',
    '--output-format', 'streaming-messages-json',
    '--include-partial-messages',
    '--yolo',
    '--verbatim',
    '--disallowed-tools', DISALLOWED_EXECUTION_TOOLS,
  ]);
});

test('buildArgs: --disallowed-tools 가 셸·편집·웹을 막는다', () => {
  const args = buildArgs({ prompt: 'x' });
  const i = args.indexOf('--disallowed-tools');
  assert.ok(i >= 0);
  assert.equal(args[i + 1], 'run_terminal_cmd,search_replace,write_file,web_search,web_fetch');
});

test('buildArgs: 모델·effort 가 있을 때만 붙는다', () => {
  const bare = buildArgs({ prompt: 'x' });
  assert.equal(bare.indexOf('--model'), -1);
  assert.equal(bare.indexOf('--effort'), -1);

  const full = buildArgs({ prompt: 'x', model: 'grok-4.6', effort: 'high' });
  assert.equal(full[full.indexOf('--model') + 1], 'grok-4.6');
  assert.equal(full[full.indexOf('--effort') + 1], 'high');
});

test('buildArgs: resumeSessionId 가 있으면 --resume 이 끝에 붙는다', () => {
  const args = buildArgs({ prompt: 'x', resumeSessionId: 'sess-1' });
  const i = args.indexOf('--resume');
  assert.ok(i >= 0);
  assert.equal(args[i + 1], 'sess-1');
});

test('buildArgs: --mcp-config 를 붙이지 않는다 — 프로젝트 .grok/config.toml 이 MCP 를 싣는다', () => {
  const args = buildArgs({ prompt: 'x' });
  assert.equal(args.indexOf('--mcp-config'), -1);
});

test('buildArgs: 앱 관리 MCP 폴더를 명시한 호출만 --trust 를 붙인다', () => {
  assert.equal(buildArgs({ prompt: 'x' }).includes('--trust'), false);
  assert.equal(buildArgs({ prompt: 'x', trustProjectFolder: true }).includes('--trust'), true);
});

test('grokFailureMessage: CLI errors 배열을 종료 코드보다 우선한다', () => {
  const { grokFailureMessage } = require('./grok-runner');
  const message = grokFailureMessage({
    code: 1,
    finalResult: {
      is_error: true,
      errors: ["--effort/--reasoning-effort: unknown effort level 'max'; use one of: high, medium, low"],
    },
    stderrText: 'Error: hidden',
  });
  assert.match(message, /unknown effort level 'max'/);
  assert.equal(message.includes('종료 코드'), false);
});
