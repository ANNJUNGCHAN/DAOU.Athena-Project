'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RENDER_CANVAS_ALLOWED_TOOL,
  GATEWAY_ALLOWED_TOOLS,
  DISALLOWED_EXECUTION_TOOLS,
  DISABLE_TOOL_SEARCH_ENV,
} = require('./claude-tool-policy');
const { buildArgs } = require('./claude-runner');

function assertUtf8Bytes(actual, expected) {
  assert.deepEqual(Buffer.from(actual, 'utf8'), Buffer.from(expected, 'utf8'));
}

test('tool policy: allowed/disallowed values preserve their exact UTF-8 bytes', () => {
  assertUtf8Bytes(RENDER_CANVAS_ALLOWED_TOOL, 'mcp__athena__athena__render_canvas');
  assertUtf8Bytes(GATEWAY_ALLOWED_TOOLS, 'mcp__athena,Task,Read,Glob');
  assertUtf8Bytes(DISALLOWED_EXECUTION_TOOLS, 'Bash,Write,Edit,NotebookEdit,Grep,WebFetch,WebSearch');
  assertUtf8Bytes(DISABLE_TOOL_SEARCH_ENV.ENABLE_TOOL_SEARCH, '0');
});

test('cold runner: policy extraction preserves argv and tool-search env byte-for-byte', () => {
  const args = buildArgs({
    prompt: 'cold-start',
    configFile: '.mcp.json',
    allowedTools: GATEWAY_ALLOWED_TOOLS,
  });

  assert.deepEqual(args, [
    '-p', 'cold-start',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--mcp-config', '.mcp.json',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--allowedTools', 'mcp__athena,Task,Read,Glob',
    '--disallowedTools', 'Bash,Write,Edit,NotebookEdit,Grep,WebFetch,WebSearch',
  ]);
  assert.deepEqual(DISABLE_TOOL_SEARCH_ENV, { ENABLE_TOOL_SEARCH: '0' });
});
