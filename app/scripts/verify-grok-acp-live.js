'use strict';

// Read-only live verification: restore a completed one-shot benchmark session,
// search tool metadata, then reuse the ACP connection. No market/order calls.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const artifacts = path.resolve(__dirname, '../../.omc/artifacts');
const bench = JSON.parse(fs.readFileSync(path.join(artifacts, 'grok-latency-benchmark.json'), 'utf8'));
const saved = bench.reports.find((row) => row.label === 'oneshot-2' && row.ok);
if (!saved) throw new Error('completed one-shot benchmark required');
const parent = fs.readdirSync(os.tmpdir(), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('athena-grok-latency-'))
  .map((entry) => path.join(os.tmpdir(), entry.name))
  .sort((a, b) => fs.statSync(b).birthtimeMs - fs.statSync(a).birthtimeMs)[0];
process.env.ATHENA_MCP_REGISTRY_PATH = path.join(parent, 'registry.json');
const { ensureMcpConfig } = require('../lib/main/mcp-config');
const { createGrokAcpSession } = require('../lib/main/grok-acp-session');
const { buildLiveSystemPrompt } = require('../lib/main/live-prompt');
const config = ensureMcpConfig(parent);
const gateway = JSON.parse(fs.readFileSync(config.configPath, 'utf8')).mcpServers.athena;
const mcpServers = [{ name: 'athena', command: gateway.command, args: gateway.args,
  env: Object.entries({ ...gateway.env, ATHENA_MCP_TOOL_NAME_STYLE: 'grok' }).map(([name, value]) => ({ name, value })) }];
const session = createGrokAcpSession({ cwd: config.dir, profilePath: config.grokProfilePath, trustProjectFolder: true,
  envOverridesFn: () => ({ GROK_CLAUDE_MCPS_ENABLED: '0', GROK_CURSOR_MCPS_ENABLED: '0' }),
  rules: buildLiveSystemPrompt('grok'), mcpServers, rpcTimeoutMs: 90000 });
const report = { startedAt: new Date().toISOString(), toolEvents: [] };
async function main() {
  try {
    const result = await session.run({ model: bench.model, effort: bench.effort, resumeSessionId: saved.sessionId,
      prompt: 'search_tool로 athena 도구 목록을 한 번 검색하세요. 찾은 도구는 실행하지 말고 검색 성공 여부만 한 문장으로 답하세요.',
      onEvent(event) {
        for (const block of event.message?.content || []) {
          if (block.type === 'tool_use') report.toolEvents.push({ type: block.type, id: block.id, name: block.name, inputKeys: Object.keys(block.input || {}) });
          if (block.type === 'tool_result') report.toolEvents.push({ type: block.type, id: block.tool_use_id, isError: !!block.is_error, contentLength: String(block.content || '').length });
        }
      },
    });
    report.resume = { ok: result.ok, sameSession: result.finalResult?.session_id === saved.sessionId,
      sessionId: result.finalResult?.session_id, error: result.error, initMs: result.initMs, totalMs: result.totalMs };
    if (!result.ok) throw new Error('resume/tool metadata turn failed');
    const pid = session.snapshot().pid;
    const followup = await session.run({ model: bench.model, effort: bench.effort,
      resumeSessionId: result.finalResult.session_id, prompt: '도구 없이 OK라고만 답하세요.' });
    report.followup = { ok: followup.ok, reused: followup.spawnedFresh === false, samePid: session.snapshot().pid === pid,
      firstTextMs: followup.firstTextMs, totalMs: followup.totalMs };
    if (!followup.ok || followup.spawnedFresh) throw new Error('session reuse failed');
  } finally {
    session.stop();
    fs.writeFileSync(path.join(artifacts, 'grok-acp-live-verification.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
