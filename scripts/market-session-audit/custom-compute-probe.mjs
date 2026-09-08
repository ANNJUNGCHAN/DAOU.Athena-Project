import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marketPhase } from './observer.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAX_BUSINESS = 16;
const BODY_LIMIT = 1024 * 1024;
const OPENAPI_LIMIT = 8 * 1024 * 1024;

export const STRATEGY_YAML = `version: "1.0"
metadata:
  name: SMA 골든크로스 감사 fixture
strategy:
  id: sma_crossover_audit
  params:
    fast: {default: 20, min: 5, max: 60, step: 1, type: int}
    slow: {default: 60, min: 20, max: 240, step: 1, type: int}
  indicators:
    - {id: SMA, alias: ma_fast, params: {period: "$fast"}}
    - {id: SMA, alias: ma_slow, params: {period: "$slow"}}
  entry:
    logic: AND
    conditions:
      - {indicator: ma_fast, operator: cross_above, compare_to: ma_slow}
  exit:
    logic: OR
    conditions:
      - {indicator: ma_fast, operator: cross_below, compare_to: ma_slow}
risk:
  stop_loss: {enabled: true, percent: 8}
  take_profit: {enabled: false, percent: 20}
  position: {sizing: all_in}
`;

export const STRATEGY_SOURCE = `import athena_bt as bt

PARAMS = {
    "fast": {"default": 20},
    "slow": {"default": 60},
}

def signals(df, p):
    ma_fast = bt.sma(df["close"], period=p["fast"])
    ma_slow = bt.sma(df["close"], period=p["slow"])
    entry = bt.cross_above(ma_fast, ma_slow)
    exit_ = bt.cross_below(ma_fast, ma_slow)
    return df.assign(entry=entry, exit=exit_)[["entry", "exit"]]
`;

const DIAGNOSE_SOURCE = `def signals(df, p):
    entry = df.close > 0
    stop = df.close - df.atr
    return df
`;

export const OPERATIONS = [
  ['backtest_validate', '/api/v1/backtest/validate', 'validate_route_api_v1_backtest_validate_post'],
  ['backtest_flow', '/api/v1/backtest/flow', 'flow_route_api_v1_backtest_flow_post'],
  ['backtest_map', '/api/v1/backtest/map', 'map_route_api_v1_backtest_map_post'],
  ['backtest_codegen', '/api/v1/backtest/codegen', 'codegen_route_api_v1_backtest_codegen_post'],
  ['backtest_diagnose', '/api/v1/backtest/diagnose', 'diagnose_route_api_v1_backtest_diagnose_post'],
  ['backtest_optimize_plan', '/api/v1/backtest/optimize/plan', 'optimize_plan_route_api_v1_backtest_optimize_plan_post'],
  ['technique_nodes', '/api/v1/backtest/technique/nodes', 'technique_nodes_route_api_v1_backtest_technique_nodes_post'],
  ['visual_from_spec', '/api/v1/backtest/visual/from-spec', 'visual_from_spec_route_api_v1_backtest_visual_from_spec_post'],
  ['visual_validate', '/api/v1/backtest/visual/validate', 'visual_validate_route_api_v1_backtest_visual_validate_post'],
  ['visual_compile', '/api/v1/backtest/visual/compile', 'visual_compile_route_api_v1_backtest_visual_compile_post'],
  ['visual_question', '/api/v1/backtest/visual/question', 'visual_question_route_api_v1_backtest_visual_question_post'],
  ['visual_patch', '/api/v1/backtest/visual/patch', 'visual_patch_route_api_v1_backtest_visual_patch_post'],
].map(([id, route, operationId]) => ({ id, route, operationId }));

const sha256 = value => createHash('sha256').update(value).digest('hex');
const safeRevision = () => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim(); } catch { return null; } };

export function parseArgs(argv) {
  const out = { execute: false, baseUrl: process.env.ATHENA_BACKEND_URL || 'http://127.0.0.1:8010', outputDir: path.join(ROOT, 'artifacts', 'market-session-audit', '2026-09-07'), requestTimeoutMs: 5000, overallTimeoutMs: 60000, rateMs: 150 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--execute') out.execute = true;
    else if (arg === '--help') out.help = true;
    else if (['--base-url', '--output-dir', '--request-timeout-ms', '--overall-timeout-ms', '--rate-ms', '--now'].includes(arg)) out[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (out.execute && out.now) throw new Error('--now is forbidden with --execute');
  for (const [key, min, max] of [['requestTimeoutMs', 1, 5000], ['overallTimeoutMs', 1, 60000], ['rateMs', 0, 5000]]) {
    out[key] = Number(out[key]);
    if (!Number.isInteger(out[key]) || out[key] < min || out[key] > max) throw new Error(`${key} must be between ${min} and ${max}`);
  }
  return out;
}

export function assertBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '8010' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('base URL must be exactly http://127.0.0.1:8010');
  return url.origin;
}

export function validateOpenApi(spec) {
  for (const op of OPERATIONS) {
    if (!/^\/api\/v1\/backtest\/[a-z0-9/-]+$/.test(op.route) || /\.\.|[%?#\\]/.test(op.route)) throw new Error(`unsafe route ${op.id}`);
    const pathItem = spec.paths?.[op.route];
    const post = pathItem?.post;
    const schema = post?.requestBody?.content?.['application/json']?.schema;
    if (!post || Object.keys(pathItem).length !== 1 || post.operationId !== op.operationId || schema?.type !== 'object' || schema?.additionalProperties !== true || schema?.title !== 'Body' || Object.keys(schema).sort().join(',') !== 'additionalProperties,title,type') throw new Error(`OpenAPI contract mismatch for ${op.id}`);
  }
}

async function json(response, limit) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Error('RESPONSE_SIZE_LIMIT_EXCEEDED');
  const text = await response.text();
  if (Buffer.byteLength(text) > limit) throw new Error('RESPONSE_SIZE_LIMIT_EXCEEDED');
  try { return JSON.parse(text); } catch { throw new Error('RESPONSE_NOT_JSON'); }
}

function semantic(id, body, expectedGraphHash = null) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  if (id === 'backtest_validate') return body.ok === true && Array.isArray(body.errors) && body.errors.length === 0;
  if (id === 'backtest_flow') return Array.isArray(body.nodes) && body.nodes.length > 0 && Array.isArray(body.params);
  if (id === 'backtest_map') return body.source_kind === 'spec' && Array.isArray(body.nodes) && body.code?.matches_map === true;
  if (id === 'backtest_codegen') return typeof body.source === 'string' && body.source.includes('def signals(df, p):') && Number.isInteger(body.lines) && body.lines > 0;
  if (id === 'backtest_diagnose') return Number.isInteger(body.line) && typeof body.why === 'string' && body.why.length > 0 && typeof body.suggestion?.new_source === 'string';
  if (id === 'backtest_optimize_plan') return body.combinations === 6 && body.over_limit === false && typeof body.values_per_param === 'object';
  if (id === 'technique_nodes') return Array.isArray(body.nodes) && body.nodes.length > 0 && body.error == null;
  if (id === 'visual_from_spec') return body.graph?.graph_version === '1' && /^[0-9a-f]{64}$/.test(body.hashes?.graph_hash || '');
  if (id === 'visual_validate') return body.valid === true && Array.isArray(body.diagnostics) && body.hashes?.graph_hash === expectedGraphHash;
  if (id === 'visual_compile') return body.executable === true && body.saved === false && typeof body.source === 'string' && body.source_map?.kind === 'authoritative' && body.hashes?.graph_hash === expectedGraphHash;
  if (id === 'visual_question') return body.question === null;
  if (id === 'visual_patch') return body.applied === false && Array.isArray(body.graph_patch) && body.graph_patch.length > 0 && typeof body.patch_id === 'string' && body.patch_id.length > 0;
  return false;
}

function initialPayload(id) {
  if (id === 'backtest_validate') return { kind: 'yaml', source: STRATEGY_YAML };
  if (id === 'backtest_flow' || id === 'technique_nodes') return { source: STRATEGY_SOURCE };
  if (id === 'backtest_map' || id === 'backtest_codegen' || id === 'visual_from_spec') return { yaml: STRATEGY_YAML };
  if (id === 'backtest_diagnose') return { error: 'File "strategy.py", line 3, in signals\nValueError: cannot mask with non-boolean array containing NA / NaN values', source: DIAGNOSE_SOURCE };
  if (id === 'backtest_optimize_plan') return { ranges: [{ name: 'fast', start: 5, stop: 20, step: 5 }, { name: 'slow', start: 5, stop: 20, step: 5 }], ascending: ['fast', 'slow'] };
  return null;
}

export async function runProbe(options = {}, deps = {}) {
  const config = { execute: false, baseUrl: 'http://127.0.0.1:8010', requestTimeoutMs: 5000, overallTimeoutMs: 60000, rateMs: 150, ...options };
  const base = assertBaseUrl(config.baseUrl);
  const now = config.now ? new Date(config.now) : new Date();
  const report = { schemaVersion: 1, kind: 'athena_custom_compute_probe', mode: config.execute ? 'loopback_live' : 'dry_run', revision: deps.revision === undefined ? safeRevision() : deps.revision, observedAt: now.toISOString(), marketPhaseAtStart: marketPhase(now), fixture: { source: 'REPO_TEST_AND_PRESET_DERIVED_EXPLICIT_AUDIT_FIXTURE', yamlSha256: sha256(STRATEGY_YAML), pythonSha256: sha256(STRATEGY_SOURCE), diagnosePythonSha256: sha256(DIAGNOSE_SOURCE), rawFixturePersisted: false, marketDataIncluded: false }, scope: { targetCount: OPERATIONS.length, businessRequestLimit: MAX_BUSINESS, sideEffects: 'FORBIDDEN', providerCalls: 'FORBIDDEN', optimizerExecution: 'FORBIDDEN' }, results: [], summary: null };
  if (!config.execute) {
    report.results = OPERATIONS.map(op => ({ operationId: op.id, method: 'POST', route: op.route, attempted: false, verdict: 'NOT_RUN', reason: 'DRY_RUN' }));
    report.summary = { targetCount: OPERATIONS.length, attempted: 0, pass: 0, blocked: 0, businessRequests: 0, metadataRequests: 0 };
    return report;
  }
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const clock = deps.clock || (() => new Date());
  const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const deadline = Date.now() + config.overallTimeoutMs;
  let business = 0;
  let authBlocked = false;
  const request = async (url, init, limit) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('OVERALL_TIMEOUT');
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(Math.min(config.requestTimeoutMs, remaining)) });
    if (response.url && response.url !== url) throw new Error('REDIRECT_NOT_ALLOWED');
    if (response.status === 401 || response.status === 403) return { response, body: null };
    return { response, body: await json(response, limit) };
  };
  const open = await request(`${base}/openapi.json`, { method: 'GET' }, OPENAPI_LIMIT);
  if (!open.response.ok) throw new Error('OPENAPI_HTTP_FAILURE');
  validateOpenApi(open.body);
  const token = (deps.tokenReader || (() => process.env.ATHENA_LOCAL_BEARER_TOKEN))();
  if (typeof token !== 'string' || !token.trim()) throw new Error('LOCAL_BEARER_TOKEN_MISSING');
  let graph = null;
  let graphHash = null;
  for (const op of OPERATIONS) {
    if (authBlocked) {
      report.results.push({ operationId: op.id, method: 'POST', route: op.route, attempted: false, verdict: 'BLOCKED', reason: 'AUTH_FAILURE_NOT_ATTEMPTED' });
      continue;
    }
    if (business >= MAX_BUSINESS) throw new Error('REQUEST_BUDGET_EXCEEDED');
    if (business > 0 && config.rateMs > 0) {
      if (deadline - Date.now() <= config.rateMs) throw new Error('OVERALL_TIMEOUT_BEFORE_RATE_DELAY');
      await sleep(config.rateMs);
    }
    let payload = initialPayload(op.id);
    if (op.id.startsWith('visual_') && op.id !== 'visual_from_spec') {
      if (!graph) {
        report.results.push({ operationId: op.id, method: 'POST', route: op.route, attempted: false, verdict: 'BLOCKED', reason: 'VISUAL_GRAPH_DEPENDENCY_MISSING' });
        continue;
      }
      payload = { graph };
      if (op.id === 'visual_patch') payload = { graph, base_graph_hash: graphHash, intent: { ops: [{ kind: 'set_param', node_id: 'param-fast', param: 'default', value: 25 }] } };
    }
    const at = clock();
    business += 1;
    try {
      const { response, body } = await request(`${base}${op.route}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, BODY_LIMIT);
      if (response.status === 401 || response.status === 403) authBlocked = true;
      const pass = response.ok && semantic(op.id, body, graphHash);
      report.results.push({ operationId: op.id, method: 'POST', route: op.route, attempted: true, attemptedAt: at.toISOString(), marketPhase: marketPhase(at), httpStatus: response.status, verdict: pass ? 'PASS' : 'BLOCKED', reason: response.status === 401 || response.status === 403 ? 'AUTH_FAILURE' : pass ? 'PASS_HTTP_JSON_SEMANTIC_CONTRACT' : 'HTTP_OR_SEMANTIC_CONTRACT_FAILURE' });
      if (pass && op.id === 'visual_from_spec') { graph = body.graph; graphHash = body.hashes.graph_hash; }
    } catch (error) {
      report.results.push({ operationId: op.id, method: 'POST', route: op.route, attempted: true, attemptedAt: at.toISOString(), marketPhase: marketPhase(at), verdict: 'BLOCKED', reason: error instanceof Error ? error.message : 'REQUEST_FAILURE' });
    }
  }
  report.summary = { targetCount: OPERATIONS.length, attempted: report.results.filter(x => x.attempted).length, pass: report.results.filter(x => x.verdict === 'PASS').length, blocked: report.results.filter(x => x.verdict === 'BLOCKED').length, businessRequests: business, metadataRequests: 1 };
  return report;
}

function stamp(date) { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date).replace(/[-: ]/g, ''); }

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log('Usage: node custom-compute-probe.mjs [--execute] [--output-dir DIR]'); return; }
  const report = await runProbe(options);
  await mkdir(options.outputDir, { recursive: true });
  const output = path.join(options.outputDir, `custom-compute-probe-${stamp(new Date())}KST.json`);
  if (existsSync(output)) throw new Error('refusing to overwrite report');
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify({ outputPath: output, mode: report.mode, summary: report.summary }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
