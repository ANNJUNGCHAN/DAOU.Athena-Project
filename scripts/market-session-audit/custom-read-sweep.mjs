#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marketPhase, parseLocalBearer, REPO_ROOT, validateBaseUrl } from './observer.mjs';

const DEFAULT_INVENTORY = path.join(REPO_ROOT, 'artifacts', 'market-session-audit', '2026-09-07', 'inventory.json');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'artifacts', 'market-session-audit', '2026-09-07');
const DEFAULT_RUNTIME_BASELINE = path.join(DEFAULT_OUTPUT, 'runtime-discovery-20260907T000357-672Z.json');
const MAX_RESPONSE_BYTES = 1_000_000;
const SAFE_INPUT_SOURCES = new Set(['observed_runtime_catalog', 'existing_local_record', 'owned_fixture']);

// Every GET handler in these exact source snapshots was inspected as read-only.
// Any source change fails closed until a new review updates the digest.
export const REVIEWED_GET_SOURCE_DIGESTS = Object.freeze({
  'backend/athena_api/api/backtest.py': '98e1e62aa130c199cf0da9ecc391fdfd0ba4061912bff63b5a3a2a6aa9762c05',
  'backend/athena_api/api/backtest_visual.py': 'c47d3ca3780db87fd5d39bbfe619138f9762ed043b569d0cae1e97cceccaa33e',
  'backend/athena_api/api/brain.py': '59ed637b746ad49225dfd9d323a628e56214432d3bd9ef3f17a4056a68630870',
  'backend/athena_api/api/canvas_push.py': 'ac382a5695e73c0a944118160d35dac6dd00dd439f9fd90bcf582a6c2496f857',
  'backend/athena_api/api/catalog.py': 'a95118c98fc0c43c273be7d7b6e64a406abf5f6f96308a60cea502bd297de5b0',
  'backend/athena_api/api/llm_tools.py': 'efdb732daef8fae0d235eaf202dff7cfbdcb5b16175fbfbe494df4d03f076d42',
  'backend/athena_api/api/nudge_guard.py': '8c04f0204d220473b99dce0ca946de1574944728d99ab8d0ad64f8a993571d62',
  'backend/athena_api/api/oauth_status.py': 'ca313038de0a8360c3547f2dad7848a7b3d6a6cb898c7abb1405263f3db9042c',
  'backend/athena_api/api/projects.py': '29ba4634dd7062f0590fa8b3c8fa4f47f4768ea6fc5170e134b7fbe729d021b1',
  'backend/athena_api/api/routines.py': 'b35ee20878bdd7cddf8db00457d7f7768802bd75a91a351a81b33b018c9b4c59',
  'backend/athena_api/api/sources.py': '6670122488479a9aa76e78077f181d7bbf4d841450ff7fc556ccc63f1a8355ff',
  'backend/athena_api/main.py': 'c310d51db44620bba5042de86ff09e0fd72c573bc72e7237bb1d3801005c5b1b',
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeSourcePath(value) {
  return String(value || '').replaceAll('\\', '/');
}

function parseIdentity(row) {
  const match = /^(\S+)\s+(.+)$/.exec(row.source_id || '');
  if (!match) throw new Error(`invalid custom API source_id: ${row.id || 'unknown'}`);
  return { method: match[1].toUpperCase(), routeTemplate: match[2] };
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) (seen.has(value) ? duplicates : seen).add(value);
  return [...duplicates];
}

async function sourceDigest(repoRoot, sourcePath) {
  return sha256(await readFile(path.join(repoRoot, sourcePath)));
}

function routeIdentity(method, routeTemplate) {
  return `${method} ${routeTemplate}`;
}

function validateRuntimeBaseline(rows, baseline, revision, inventoryRevision) {
  if (baseline?.kind !== 'athena_runtime_openapi_discovery') return { status: 'BLOCKED', reason: 'RUNTIME_IDENTITY_BASELINE_INVALID', operationIds: new Map() };
  if (!revision || baseline.revision !== revision || (inventoryRevision && inventoryRevision !== revision)) {
    return { status: 'BLOCKED', reason: 'RUNTIME_IDENTITY_BASELINE_HEAD_MISMATCH', operationIds: new Map() };
  }
  const expectedIdentities = rows.filter((row) => !row.source_id.startsWith('WEBSOCKET ')).map((row) => row.source_id).sort();
  const routes = baseline.reconciliation?.other_runtime_api?.routes || [];
  const identities = routes.map((route) => routeIdentity(route.method, route.path)).sort();
  const duplicateRoutes = duplicateValues(identities);
  const operationIds = routes.map((route) => route.operation_id).filter(Boolean);
  if (duplicateRoutes.length || duplicateValues(operationIds).length || operationIds.length !== routes.length) {
    return { status: 'BLOCKED', reason: 'RUNTIME_IDENTITY_BASELINE_DUPLICATE_OR_MISSING', operationIds: new Map() };
  }
  if (JSON.stringify(identities) !== JSON.stringify(expectedIdentities)) {
    return { status: 'BLOCKED', reason: 'RUNTIME_IDENTITY_BASELINE_MEMBERSHIP_MISMATCH', operationIds: new Map() };
  }
  return {
    status: 'VERIFIED',
    reason: null,
    revision,
    route_count: routes.length,
    operationIds: new Map(routes.map((route) => [routeIdentity(route.method, route.path), route.operation_id])),
  };
}

export async function buildCustomReadPlan(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const inventory = options.inventory || JSON.parse(await readFile(options.inventoryPath || DEFAULT_INVENTORY, 'utf8'));
  const rows = (inventory.items || []).filter((item) => item.source === 'custom_api_route');
  const duplicates = duplicateValues(rows.map((row) => row.id));
  if (duplicates.length) throw new Error(`duplicate custom API IDs: ${duplicates.join(', ')}`);
  const revision = options.revision || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true }).trim();
  let runtimeBaseline = options.runtimeBaseline;
  if (!runtimeBaseline) {
    try {
      runtimeBaseline = JSON.parse(await readFile(options.runtimeBaselinePath || DEFAULT_RUNTIME_BASELINE, 'utf8'));
    } catch {
      runtimeBaseline = null;
    }
  }
  const identityBaseline = validateRuntimeBaseline(rows, runtimeBaseline, revision, inventory.revision);

  const digestCache = new Map();
  const results = [];
  for (const row of rows) {
    const { method, routeTemplate } = parseIdentity(row);
    const sourcePath = normalizeSourcePath(row.source_path);
    const base = {
      id: row.id,
      source: 'custom_api_route',
      source_path: sourcePath,
      method,
      route_template: routeTemplate,
      expected_operation_id: identityBaseline.operationIds.get(routeIdentity(method, routeTemplate)) || null,
      observed_at: null,
      market_phase: null,
      evidence: null,
    };
    if (method === 'WEBSOCKET') {
      results.push({ ...base, verdict: 'NOT_APPLICABLE', reason: 'STREAM_PROTOCOL_EXCLUDED' });
      continue;
    }
    if (method !== 'GET') {
      results.push({ ...base, verdict: 'NOT_APPLICABLE', reason: 'NON_GET_NOT_AUTHORIZED' });
      continue;
    }
    if (identityBaseline.status !== 'VERIFIED' || !base.expected_operation_id) {
      results.push({ ...base, verdict: 'BLOCKED', reason: identityBaseline.reason || 'RUNTIME_IDENTITY_BASELINE_MISSING_OPERATION_ID' });
      continue;
    }
    const expected = REVIEWED_GET_SOURCE_DIGESTS[sourcePath];
    if (!expected) {
      results.push({ ...base, verdict: 'BLOCKED', reason: 'SOURCE_NOT_SAFETY_REVIEWED' });
      continue;
    }
    if (!digestCache.has(sourcePath)) {
      try {
        digestCache.set(sourcePath, await sourceDigest(repoRoot, sourcePath));
      } catch {
        digestCache.set(sourcePath, null);
      }
    }
    if (digestCache.get(sourcePath) !== expected) {
      results.push({ ...base, verdict: 'BLOCKED', reason: 'SOURCE_CHANGED_REVIEW_REQUIRED' });
      continue;
    }
    const pathParameters = [...routeTemplate.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
    if (pathParameters.length) {
      results.push({
        ...base,
        verdict: 'BLOCKED',
        reason: 'MISSING_SAFE_OBSERVED_INPUT',
        required_parameter_names: pathParameters,
      });
      continue;
    }
    results.push({ ...base, verdict: 'NOT_RUN', reason: 'DRY_RUN_RUNTIME_OPENAPI_REQUIRED' });
  }
  return {
    rows,
    results,
    identityBaseline: {
      status: identityBaseline.status,
      reason: identityBaseline.reason,
      revision: identityBaseline.revision || null,
      route_count: identityBaseline.route_count || 0,
    },
  };
}

function dereference(openapi, value) {
  if (!value?.$ref) return value;
  const prefix = '#/components/parameters/';
  return value.$ref.startsWith(prefix) ? openapi?.components?.parameters?.[value.$ref.slice(prefix.length)] : null;
}

function operationParameters(openapi, routeTemplate, operation) {
  const pathItem = openapi?.paths?.[routeTemplate];
  return [...(pathItem?.parameters || []), ...(operation?.parameters || [])]
    .map((parameter) => dereference(openapi, parameter))
    .filter(Boolean);
}

function safeInputFor(id, parameter, safeInputsById) {
  const input = safeInputsById?.[id]?.[parameter.name];
  if (!input || !SAFE_INPUT_SOURCES.has(input.source)) return null;
  if (!['string', 'number', 'boolean'].includes(typeof input.value)) return null;
  const value = String(input.value);
  if (!value || value.length > 256 || /[\r\n]/.test(value)) return null;
  return { value, source: input.source };
}

function responseSchemaSummary(body) {
  if (body === null) return { top_level_type: 'null', top_level_count: null, schema_digest_sha256: sha256('null') };
  if (Array.isArray(body)) {
    const shapes = [...new Set(body.slice(0, 20).map((value) => structuralShape(value)))].sort();
    return { top_level_type: 'array', top_level_count: body.length, schema_digest_sha256: sha256(JSON.stringify(shapes)) };
  }
  if (typeof body === 'object') {
    return { top_level_type: 'object', top_level_count: Object.keys(body).length, schema_digest_sha256: sha256(JSON.stringify(structuralShape(body))) };
  }
  return { top_level_type: typeof body, top_level_count: null, schema_digest_sha256: sha256(typeof body) };
}

function structuralShape(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return depth >= 3 ? 'array' : ['array', ...[...new Set(value.slice(0, 5).map((item) => structuralShape(item, depth + 1)))].sort()];
  if (typeof value !== 'object') return typeof value;
  if (depth >= 3) return 'object';
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, structuralShape(value[key], depth + 1)]));
}

async function boundedJson(response) {
  const reader = response.body?.getReader?.();
  if (!reader) return { parsed: null, tooLarge: false, invalidJson: true };
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return { parsed: null, tooLarge: true, invalidJson: false };
    }
    chunks.push(value);
  }
  try {
    return { parsed: JSON.parse(Buffer.concat(chunks).toString('utf8')), tooLarge: false, invalidJson: false };
  } catch {
    return { parsed: null, tooLarge: false, invalidJson: true };
  }
}

async function fetchWithTimeout(fetchFn, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetchFn(url, { ...init, signal: controller.signal, redirect: 'error', credentials: 'omit' });
    if (response.url && new URL(response.url).href !== new URL(url).href) throw new Error('RESPONSE_URL_CHANGED');
    return { response, elapsedMs: Math.round((performance.now() - started) * 10) / 10 };
  } finally {
    clearTimeout(timer);
  }
}

export async function runCustomReadSweep(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const now = options.now instanceof Date ? options.now : new Date();
  const execute = options.execute === true;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const rateMs = options.rateMs ?? 500;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new Error('timeoutMs must be between 100 and 30000');
  if (!Number.isFinite(rateMs) || rateMs < 0 || rateMs > 60_000) throw new Error('rateMs must be between 0 and 60000');
  const baseUrl = validateBaseUrl(options.baseUrl || 'http://127.0.0.1:8010');
  const revision = options.revision || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true }).trim();
  const { results: planned, identityBaseline } = await buildCustomReadPlan({ ...options, repoRoot, revision });
  let results = planned;
  let openapiStatus = 'NOT_LOADED_DRY_RUN';

  if (execute) {
    const bearer = options.bearer === undefined
      ? parseLocalBearer(await readFile(path.join(repoRoot, 'backend', '.env'), 'utf8').catch(() => ''))
      : options.bearer;
    const fetchFn = options.fetchFn || globalThis.fetch;
    let openapi;
    try {
      const loaded = await fetchWithTimeout(fetchFn, new URL('/openapi.json', baseUrl), {
        method: 'GET', headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
      }, timeoutMs);
      if (!loaded.response.ok) throw new Error('OPENAPI_HTTP_ERROR');
      openapi = await loaded.response.json();
      openapiStatus = 'LOADED';
    } catch (error) {
      openapiStatus = error?.name === 'AbortError' ? 'TIMEOUT' : 'FAILED';
    }
    results = [];
    for (const item of planned) {
      const suppliedSafeInputs = options.safeInputsById?.[item.id];
      const canResolvePlannedInputBlock = item.reason === 'MISSING_SAFE_OBSERVED_INPUT' && suppliedSafeInputs;
      if (item.verdict !== 'NOT_RUN' && !canResolvePlannedInputBlock) {
        results.push(item);
        continue;
      }
      if (!openapi) {
        results.push({ ...item, verdict: 'BLOCKED', reason: 'RUNTIME_OPENAPI_UNAVAILABLE' });
        continue;
      }
      const operation = openapi?.paths?.[item.route_template]?.get;
      if (!operation) {
        results.push({ ...item, verdict: 'BLOCKED', reason: 'RUNTIME_ROUTE_MISSING' });
        continue;
      }
      if (operation.operationId !== item.expected_operation_id) {
        results.push({ ...item, verdict: 'BLOCKED', reason: 'RUNTIME_OPERATION_ID_MISMATCH' });
        continue;
      }
      if (operation.requestBody?.required) {
        results.push({ ...item, verdict: 'BLOCKED', reason: 'GET_REQUEST_BODY_NOT_AUTHORIZED' });
        continue;
      }
      const contentTypes = Object.keys(operation.responses?.['200']?.content || {});
      if (contentTypes.some((value) => value.toLowerCase().includes('text/event-stream'))) {
        results.push({ ...item, verdict: 'NOT_APPLICABLE', reason: 'STREAMING_RESPONSE_EXCLUDED' });
        continue;
      }
      const required = operationParameters(openapi, item.route_template, operation).filter((parameter) => parameter.required);
      const inputs = [];
      let missing = null;
      for (const parameter of required) {
        if (parameter.in === 'header' && parameter.name.toLowerCase() === 'authorization' && bearer) continue;
        const input = safeInputFor(item.id, parameter, options.safeInputsById);
        if (!input || !['path', 'query'].includes(parameter.in)) {
          missing = parameter;
          break;
        }
        inputs.push({ name: parameter.name, in: parameter.in, value: input.value, source: input.source });
      }
      if (missing) {
        results.push({ ...item, verdict: 'BLOCKED', reason: 'MISSING_SAFE_OBSERVED_INPUT', required_parameter_names: required.map((p) => p.name) });
        continue;
      }
      let resolvedPath = item.route_template;
      const url = new URL(baseUrl);
      for (const input of inputs) {
        if (input.in === 'path') resolvedPath = resolvedPath.replace(`{${input.name}}`, encodeURIComponent(input.value));
        else url.searchParams.set(input.name, input.value);
      }
      url.pathname = resolvedPath;
      const observedAt = options.clock ? options.clock() : new Date();
      try {
        const loaded = await fetchWithTimeout(fetchFn, url, {
          method: 'GET',
          headers: bearer ? { Authorization: `Bearer ${bearer}`, 'X-Athena-Caller': 'market-session-audit' } : { 'X-Athena-Caller': 'market-session-audit' },
        }, timeoutMs);
        const contentType = String(loaded.response.headers?.get?.('content-type') || '').split(';')[0].toLowerCase();
        let responseEvidence = { content_type: contentType || null };
        let reason = loaded.response.ok ? 'HTTP_RESPONSE_SANITIZED' : 'HTTP_ERROR_STATUS';
        let verdict = loaded.response.ok ? 'PASS' : 'FAIL';
        if (contentType === 'text/event-stream') {
          await loaded.response.body?.cancel?.();
          verdict = 'BLOCKED';
          reason = 'STREAMING_RESPONSE_EXCLUDED';
        } else if (contentType === 'application/json' || contentType.endsWith('+json')) {
          const body = await boundedJson(loaded.response);
          if (body.tooLarge) {
            verdict = 'BLOCKED';
            reason = 'RESPONSE_TOO_LARGE_TO_SANITIZE';
          } else if (body.invalidJson) {
            verdict = 'FAIL';
            reason = 'INVALID_JSON_RESPONSE';
          } else {
            responseEvidence = { ...responseEvidence, ...responseSchemaSummary(body.parsed) };
          }
        } else {
          await loaded.response.body?.cancel?.();
        }
        results.push({
          ...item,
          verdict,
          reason,
          observed_at: observedAt.toISOString(),
          market_phase: marketPhase(observedAt),
          evidence: { http_status: loaded.response.status, elapsed_ms: loaded.elapsedMs, response: responseEvidence },
          resolved_parameters: inputs.map(({ name, in: location, source }) => ({ name, in: location, source })),
        });
      } catch (error) {
        results.push({
          ...item,
          verdict: 'FAIL',
          reason: error?.name === 'AbortError' ? 'TIMEOUT' : 'TRANSPORT_ERROR',
          observed_at: observedAt.toISOString(),
          market_phase: marketPhase(observedAt),
        });
      }
      if (rateMs) await new Promise((resolve) => setTimeout(resolve, rateMs));
    }
  }

  const summary = results.reduce((out, item) => {
    out[item.verdict] = (out[item.verdict] || 0) + 1;
    out.total += 1;
    return out;
  }, { total: 0 });
  return {
    schema_version: 1,
    kind: 'athena_custom_api_read_sweep',
    generated_at: now.toISOString(),
    market_phase: marketPhase(now),
    mode: execute ? 'loopback_live' : 'registry_dry_run',
    revision,
    scope: {
      custom_api_rows: results.length,
      authorization: 'GET_ONLY_SOURCE_REVIEWED',
      full_product_pass_claimed: false,
      raw_response_persisted: false,
      identifiers_persisted: false,
    },
    runtime_openapi: { status: openapiStatus },
    runtime_identity_baseline: identityBaseline,
    summary,
    results,
  };
}

function parseArgs(argv) {
  const args = { execute: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--execute') args.execute = true;
    else if (value === '--base-url') args.baseUrl = argv[++index];
    else if (value === '--timeout-ms') args.timeoutMs = Number(argv[++index]);
    else if (value === '--rate-ms') args.rateMs = Number(argv[++index]);
    else if (value === '--output-dir') args.outputDir = argv[++index];
    else throw new Error(`unknown argument: ${value}`);
  }
  return args;
}

function timestampForFile(date) {
  return date.toISOString().replace(/[-:]/g, '').replace('.', '-');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runCustomReadSweep(args);
  const outputDir = path.resolve(args.outputDir || DEFAULT_OUTPUT);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `custom-read-sweep-${timestampForFile(new Date())}.json`);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({ output: outputPath, mode: report.mode, summary: report.summary }));
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    await main();
  } catch (error) {
    console.error(`custom read sweep failed: ${error?.message || 'unknown_error'}`);
    process.exitCode = 1;
  }
}
