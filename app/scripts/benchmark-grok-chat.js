'use strict';

// Live, read-only prompts on the installed Grok account. Isolate Athena's MCP
// registry; never print prompts, credentials, or raw provider output.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-grok-latency-'));
process.env.ATHENA_MCP_REGISTRY_PATH = path.join(tmp, 'registry.json');
process.env.GROK_CLAUDE_MCPS_ENABLED = '0';
process.env.GROK_CURSOR_MCPS_ENABLED = '0';
fs.writeFileSync(process.env.ATHENA_MCP_REGISTRY_PATH, JSON.stringify({ servers: {} }));
const { ensureMcpConfig } = require('../lib/main/mcp-config');
const { createGrokAcpSession } = require('../lib/main/grok-acp-session');
const { runGrokQuery } = require('../lib/main/grok-runner');
const { buildLiveSystemPrompt, buildLivePrompt, buildLiveTurnPrompt } = require('../lib/main/live-prompt');
const config = ensureMcpConfig(tmp);
const base = JSON.parse(fs.readFileSync(config.configPath, 'utf8')).mcpServers.athena;
const mcpServers = [{ name: 'athena', command: base.command, args: base.args,
  env: Object.entries({ ...base.env, ATHENA_MCP_TOOL_NAME_STYLE: 'grok' }).map(([name, value]) => ({ name, value })) }];
const input = { providerId: 'grok', userText: '도구를 사용하지 말고 OK라고만 답하세요.' };
const options = { model: 'grok-4.5', effort: 'low', timeoutMs: 180000 };
const reports = [];
async function measure(label, run) {
  const start = performance.now();
  let firstTextMs = null;
  let toolCalls = 0;
  const result = await run({ onTextDelta(text) { if (text && firstTextMs === null) firstTextMs = performance.now() - start; },
    onEvent(event) { for (const block of event.message?.content || []) if (block.type === 'tool_use') toolCalls++; } });
  const row = { label, ok: result.ok, totalMs: Math.round(performance.now() - start),
    firstTextMs: firstTextMs === null ? null : Math.round(firstTextMs), initMs: result.initMs,
    spawnedFresh: result.spawnedFresh, submitted: result.submitted, toolCalls,
    answerValid: /^OK[.!]?$/i.test(String(result.finalResult?.result || '').trim()),
    sessionId: result.finalResult?.session_id, error: result.ok ? null : result.error };
  reports.push(row); console.log(JSON.stringify(row));
  if (!result.ok) throw new Error(`benchmark failed at ${label}`);
  if (!row.answerValid || toolCalls) throw new Error(`unexpected answer or tool call at ${label}`);
  return result.finalResult?.session_id;
}
async function main() {
  const session = createGrokAcpSession({ cwd: config.dir, profilePath: config.grokProfilePath, trustProjectFolder: true,
    rules: buildLiveSystemPrompt('grok'), mcpServers, rpcTimeoutMs: 90000 });
  try {
    let cursor;
    for (let i = 0; i < 3; i++) {
      cursor = await measure(i === 0 ? 'acp-cold' : `acp-warm-${i}`, (callbacks) => session.run({
        ...options, ...callbacks, prompt: buildLiveTurnPrompt(input), resumeSessionId: cursor }));
    }
    if (!process.argv.includes('--acp-only')) {
      let coldCursor;
      for (let i = 0; i < 2; i++) coldCursor = await measure(`oneshot-${i + 1}`, (callbacks) => runGrokQuery({
        ...options, ...callbacks, cwd: config.dir, trustProjectFolder: true,
        prompt: buildLivePrompt(input), resumeSessionId: coldCursor }));
    }
  } finally {
    session.stop();
    const target = path.resolve(__dirname, '../../.omc/artifacts/grok-latency-benchmark.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ measuredAt: new Date().toISOString(), model: options.model,
      effort: options.effort, isolatedAthenaRegistry: true, reports }, null, 2));
    console.log(JSON.stringify({ report: target }));
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
