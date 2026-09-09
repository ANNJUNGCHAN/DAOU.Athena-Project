'use strict';

// Live, read-only proof for all three Athena chat prewarm pools. Provider text
// and credentials never enter the artifact or stdout.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createConversationSessionPool } = require('../lib/main/conversation-session-pool');
const { createClaudeChatSession } = require('../lib/main/claude-chat-session');
const { createGrokAcpSession } = require('../lib/main/grok-acp-session');
const { createCodexChatSession } = require('../lib/main/codex-chat-session');
const { createCodexChatRuntime } = require('../lib/main/codex-chat-runtime');
const { ATHENA_GATEWAY_BUILTIN_TOOLS } = require('../lib/main/provider-runtime-bootstrap');
const { ensureMcpConfig } = require('../lib/main/mcp-config');

const READY_TIMEOUT_MS = 90_000;
const TURN_TIMEOUT_MS = 90_000;
const PROMPT = '도구를 사용하지 말고 OK라고만 답하세요.';
const actualUserData = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'athena-shell')
  : path.join(os.homedir(), 'AppData', 'Roaming', 'athena-shell');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-chat-prewarm-'));
const reportPath = path.resolve(__dirname, '../../.omc/artifacts/chat-prewarm-live.json');

process.env.ATHENA_MCP_REGISTRY_PATH = path.join(tempRoot, 'registry.json');
process.env.GROK_CLAUDE_MCPS_ENABLED = '0';
process.env.GROK_CURSOR_MCPS_ENABLED = '0';
fs.writeFileSync(process.env.ATHENA_MCP_REGISTRY_PATH, JSON.stringify({ servers: {} }));
const mcpConfig = ensureMcpConfig(tempRoot);
const report = { startedAt: new Date().toISOString(), isolatedAthenaRegistry: true,
  desiredPoolSize: 2, providers: {} };

function bounded(value, limit = 500) {
  const text = String(value == null ? '' : value);
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

function errorInfo(error, depth = 0) {
  if (!error || depth > 2) return null;
  const result = { name: bounded(error.name || 'Error', 80),
    code: error.code == null ? null : bounded(error.code, 120),
    message: bounded(error.message || error) };
  if (error.cause) result.cause = errorInfo(error.cause, depth + 1);
  return result;
}

function safeReadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function validString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readCodexModelSettings() {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  let text;
  try { text = fs.readFileSync(path.join(home, 'config.toml'), 'utf8'); } catch { return {}; }
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) break;
    const match = trimmed.match(/^(model|model_reasoning_effort)\s*=\s*(["'])(.*?)\2\s*(?:#.*)?$/);
    if (!match) continue;
    if (match[1] === 'model') result.model = validString(match[3]);
    else result.effort = validString(match[3]);
  }
  return result;
}

function readModelSettings() {
  const state = safeReadJson(path.join(actualUserData, 'athena-model.json'));
  const pair = (value) => ({ model: validString(value && value.model),
    effort: validString(value && value.effort) });
  return { claude: pair(state.claude), grok: pair(state.grok),
    codex: pair(readCodexModelSettings()) };
}

const models = readModelSettings();
report.models = models;

function gateway() {
  return safeReadJson(mcpConfig.configPath).mcpServers.athena;
}

function makeClaudeSession() {
  return createClaudeChatSession({ cwd: mcpConfig.dir, configFile: mcpConfig.configFile,
    appendSystemPrompt: '도구 없는 확인 요청에는 OK라고만 답하세요.', timeoutMs: TURN_TIMEOUT_MS });
}

function makeGrokSession() {
  const base = gateway();
  return createGrokAcpSession({ cwd: mcpConfig.dir, profilePath: mcpConfig.grokProfilePath,
    trustProjectFolder: true, rules: '도구 없는 확인 요청에는 OK라고만 답하세요.',
    mcpServers: [{ name: 'athena', command: base.command, args: base.args,
      env: Object.entries({ ...base.env, ATHENA_MCP_TOOL_NAME_STYLE: 'grok' })
        .map(([name, value]) => ({ name, value })) }],
    rpcTimeoutMs: READY_TIMEOUT_MS, timeoutMs: TURN_TIMEOUT_MS,
    envOverridesFn: () => ({ ATHENA_MCP_REGISTRY_PATH: process.env.ATHENA_MCP_REGISTRY_PATH,
      GROK_CLAUDE_MCPS_ENABLED: '0', GROK_CURSOR_MCPS_ENABLED: '0' }) });
}

function makeCodexSession() {
  const allowedTools = ATHENA_GATEWAY_BUILTIN_TOOLS.map((tool) => `mcp__athena__${tool}`);
  const built = createCodexChatRuntime({ userDataPath: actualUserData, cwd: mcpConfig.dir,
    gateway: gateway(), allowedTools,
    envOverridesFn: () => ({ ATHENA_MCP_REGISTRY_PATH: process.env.ATHENA_MCP_REGISTRY_PATH }),
    securityKeyFn: () => 'isolated-empty-registry-v1', identityKeyFn: () => 'codex-live-probe' });
  return createCodexChatSession({ ...built.sessionOptions,
    developerInstructions: '도구 없는 확인 요청에는 OK라고만 답하세요.', timeoutMs: TURN_TIMEOUT_MS });
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForReady(pool, errors) {
  const started = performance.now();
  while (performance.now() - started < READY_TIMEOUT_MS) {
    const snapshot = pool.snapshot();
    if (snapshot.ready === snapshot.desiredSize) {
      return { ok: true, elapsedMs: Math.round(performance.now() - started), snapshot };
    }
    if (snapshot.owned === 0 && errors.length >= snapshot.desiredSize) {
      return { ok: false, elapsedMs: Math.round(performance.now() - started), snapshot };
    }
    await sleep(100);
  }
  return { ok: false, timedOut: true, elapsedMs: Math.round(performance.now() - started),
    snapshot: pool.snapshot() };
}

function inspectEvent(counter, event) {
  const content = event?.message?.content;
  if (Array.isArray(content)) for (const block of content) {
    if (block && block.type === 'tool_use') counter.count += 1;
  }
}

function resultSummary(result, counter) {
  return { ok: result?.ok === true, submitted: result?.submitted === true,
    spawnedFresh: result?.spawnedFresh === true,
    answerValid: /^OK[.!]?$/i.test(String(result?.finalResult?.result || '').trim()),
    toolCalls: counter.count, error: result?.ok === true ? null : bounded(result?.error || 'provider turn failed'),
    errorCode: result?.ok === true ? null : result?.errorCode || null,
    firstEventMs: Number.isFinite(result?.firstEventMs) ? Math.round(result.firstEventMs) : null,
    firstTextMs: Number.isFinite(result?.firstTextMs) ? Math.round(result.firstTextMs) : null,
    totalMs: Number.isFinite(result?.totalMs) ? Math.round(result.totalMs) : null };
}

async function runTurn(session, warmOptions, resumeSessionId) {
  const counter = { count: 0 };
  let result;
  try {
    result = await session.run({ ...warmOptions, prompt: PROMPT, resumeSessionId,
      timeoutMs: TURN_TIMEOUT_MS, onEvent: (event) => inspectEvent(counter, event) });
  } catch (error) {
    result = { ok: false, error: bounded(error.message || error), errorCode: error.code || null };
  }
  return { raw: result, summary: resultSummary(result, counter) };
}

async function verifyProvider(providerId, createSession) {
  const errors = [];
  const sessions = [];
  const warmOptions = { ...models[providerId], identityKey: `${providerId}-live-probe`,
    securityKey: 'isolated-empty-registry-v1', resumeSessionId: null };
  let created = 0;
  const pool = createConversationSessionPool({ createSession() {
    created += 1;
    const session = createSession();
    sessions.push(session);
    return session;
  }, warmOptions, desiredSize: 2, retryDelayMs: READY_TIMEOUT_MS,
  onError(error, context) { errors.push({ phase: context?.phase || null, error: errorInfo(error) }); } });
  const row = { warmOptions: models[providerId], errors };
  try {
    pool.start();
    row.ready = await waitForReady(pool, errors);
    row.sessionsCreated = created;
    // A provider adapter can have live pre-spawned processes yet never publish
    // the pool's readiness signal. Claim those entries after the bounded wait
    // so the artifact distinguishes a readiness bug from a cold-spawn bug.
    const livePreSpawned = sessions.length === 2 && sessions.every((session) => {
      const snapshot = session.snapshot();
      return Number.isInteger(snapshot.pid) && snapshot.state !== 'down'
        && snapshot.state !== 'failed' && snapshot.state !== 'stopped';
    });
    row.livePreSpawnedAfterWait = livePreSpawned;
    if (!row.ready.ok && !livePreSpawned) return row;
    const claimed = [pool.claim(), pool.claim()];
    await pool.stop(new Error('live probe claimed both warmed sessions'));
    if (typeof pool.drain === 'function') await pool.drain();
    if (claimed.some((session) => !session)) { row.claimed = false; return row; }
    row.claimed = true;
    const before = claimed.map((session) => session.snapshot());
    row.pids = before.map((snapshot) => snapshot.pid);
    row.distinctPids = row.pids.every(Number.isInteger) && new Set(row.pids).size === claimed.length;
    const first = await Promise.all(claimed.map((session) => runTurn(session, warmOptions, null)));
    const afterFirst = claimed.map((session) => session.snapshot());
    row.first = first.map((entry, index) => ({ ...entry.summary,
      samePid: afterFirst[index].pid === before[index].pid }));
    const follow = await runTurn(claimed[0], warmOptions,
      first[0].raw?.finalResult?.session_id || undefined);
    row.followup = { ...follow.summary, samePid: claimed[0].snapshot().pid === before[0].pid };
    row.pass = row.ready.ok && row.distinctPids
      && row.first.every((entry) => entry.ok && entry.answerValid && entry.toolCalls === 0
        && entry.spawnedFresh === false && entry.samePid)
      && row.followup.ok && row.followup.answerValid && row.followup.toolCalls === 0
      && row.followup.spawnedFresh === false && row.followup.samePid;
    return row;
  } catch (error) { row.fatal = errorInfo(error); return row; }
  finally {
    await pool.stop(new Error('live prewarm probe complete'));
    if (typeof pool.drain === 'function') await pool.drain();
    await Promise.allSettled(sessions.map((session) => session.stop(new Error('live prewarm probe complete'))));
  }
}

function writeReport() {
  report.finishedAt = new Date().toISOString();
  report.pass = ['claude', 'grok', 'codex'].every((id) => report.providers[id]?.pass === true);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

async function main() {
  for (const [id, factory] of [['claude', makeClaudeSession], ['grok', makeGrokSession],
    ['codex', makeCodexSession]]) {
    report.providers[id] = await verifyProvider(id, factory);
    writeReport();
  }
  console.log(JSON.stringify({ report: reportPath, pass: report.pass,
    providers: Object.fromEntries(Object.entries(report.providers).map(([id, row]) => [id,
      { ready: row.ready?.ok === true, pass: row.pass === true,
        errorCodes: row.errors.map((entry) => entry.error?.code).filter(Boolean) }])) }));
  if (!report.pass) process.exitCode = 1;
}

main().catch((error) => {
  report.fatal = errorInfo(error);
  writeReport();
  console.error(JSON.stringify({ report: reportPath, fatal: report.fatal }));
  process.exitCode = 1;
});
