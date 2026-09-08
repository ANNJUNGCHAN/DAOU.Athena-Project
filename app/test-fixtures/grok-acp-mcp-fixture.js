'use strict';

// Deterministic MCP protocol fixture. No backend, financial data, or UI side effects.
const readline = require('node:readline');
if (process.argv[2]) require('node:fs').writeFileSync(process.argv[2], String(process.pid));
const envelope = { canvas_type: 'table', caption: 'ACP protocol fixture', data: { rows: [] } };
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (process.argv[2]) require('node:fs').appendFileSync(process.argv[2] + '.rpc', String(request.method) + '\n');
  if (request.id === undefined) return;
  let result;
  if (request.method === 'initialize') result = {
    protocolVersion: request.params.protocolVersion, capabilities: { tools: {} },
    serverInfo: { name: 'athena-latency-fixture', version: '1' },
  };
  else if (request.method === 'tools/list') result = { tools: [{
    name: 'athena_render_canvas', description: 'Return a synthetic empty table for ACP protocol verification only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }] };
  else if (request.method === 'tools/call' && request.params.name === 'athena_render_canvas') {
    result = { content: [{ type: 'text', text: JSON.stringify(envelope) }], structuredContent: envelope };
  } else if (request.method === 'ping') result = {};
  else {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'fixture method not supported' } }) + '\n');
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
});
