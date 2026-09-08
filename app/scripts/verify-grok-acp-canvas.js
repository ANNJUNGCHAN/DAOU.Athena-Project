'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGrokAcpSession } = require('../lib/main/grok-acp-session');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-acp-canvas-'));
const marker = path.join(tmp, 'fixture-started.txt');
const profilePath = path.join(tmp, 'profile.md');
fs.writeFileSync(profilePath, '---\nname: athena-protocol-probe\ndescription: ACP protocol verification\ntools: search_tool, use_tool\n---\n');
const session = createGrokAcpSession({ cwd: tmp, profilePath, trustProjectFolder: true, rpcTimeoutMs: 90000,
  envOverridesFn: () => ({ GROK_CLAUDE_MCPS_ENABLED: '0', GROK_CURSOR_MCPS_ENABLED: '0' }),
  mcpServers: [{ name: 'athena', command: process.execPath,
    args: [path.resolve(__dirname, '../test-fixtures/grok-acp-mcp-fixture.js'), marker], env: [] }],
  rules: 'This is a protocol test. Only the athena MCP fixture is allowed. Never use other servers or financial data.',
});
const report = { measuredAt: new Date().toISOString(), syntheticMcp: true, tools: [], canvas: [] };
async function main() {
  try {
    const result = await session.run({ model: 'grok-4.5', effort: 'low',
      prompt: 'Find athena__athena_render_canvas with search_tool limit 1, then call it once with {} using use_tool. It only returns a synthetic empty table. Then say OK.',
      onEvent(event) { for (const block of event.message?.content || []) if (block.type === 'tool_use') {
        report.tools.push({ name: block.name, inputKeys: Object.keys(block.input || {}) });
      } },
      onCanvasResult(value) { report.canvas.push({ status: value.status, type: value.envelope?.canvas_type }); },
    });
    report.ok = result.ok && report.canvas.length === 1 && report.canvas[0].type === 'table';
    report.providerOk = result.ok;
    report.error = result.error;
    report.totalMs = result.totalMs;
    if (!report.ok) process.exitCode = 1;
  } finally {
    report.fixtureStarted = fs.existsSync(marker);
    session.stop();
    const target = path.resolve(__dirname, '../../.omc/artifacts/grok-acp-canvas-verification.json');
    fs.writeFileSync(target, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
