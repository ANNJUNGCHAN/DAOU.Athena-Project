#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCustomReadPlan } from './custom-read-sweep.mjs';
import { marketPhase, parseLocalBearer, REPO_ROOT, validateBaseUrl } from './observer.mjs';

const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'artifacts', 'market-session-audit', '2026-09-07');
const MAX_BODY_BYTES = 1_000_000;
const MAX_REQUESTS = 40;
const TARGET_IDS = Object.freeze([
  'custom-api:GET:/api/v1/backtest/data/coverage',
  'custom-api:GET:/api/v1/backtest/jobs/{job_id}',
  'custom-api:GET:/api/v1/backtest/runs/{run_id}',
  'custom-api:GET:/api/v1/backtest/runs/{run_id}/trades',
  'custom-api:GET:/api/v1/backtest/strategies/{strategy_id}/versions',
  'custom-api:GET:/api/v1/backtest/strategies/{strategy_id}/versions/{version_id}',
  'custom-api:GET:/api/v1/backtest/strategies/{strategy_id}/diff',
  'custom-api:GET:/api/v1/backtest/deployments/{deployment_id}/signals',
  'custom-api:GET:/api/v1/brain/ingestion/jobs/{job_id}',
  'custom-api:GET:/api/v1/brain/chats',
  'custom-api:GET:/api/v1/brain/analysis/entity-timeline',
  'custom-api:GET:/api/v1/brain/analysis/entity-detail',
  'custom-api:GET:/api/v1/internal/canvas/realtime-bindings/{operation_id}',
  'custom-api:GET:/api/v1/catalog/{operation_ref}',
  'custom-api:GET:/api/v1/projects/{project_id}/tree',
  'custom-api:GET:/api/v1/projects/{project_id}/file',
  'custom-api:GET:/api/v1/projects/{project_id}/env',
  'custom-api:GET:/api/v1/routines/{routine_id}',
  'custom-api:GET:/api/v1/routines/{routine_id}/runs',
  'custom-api:GET:/api/v1/backtest/source/map/{job_id}',
]);

const SOURCE_IDS = Object.freeze({
  runs: 'custom-api:GET:/api/v1/backtest/runs',
  strategies: 'custom-api:GET:/api/v1/backtest/strategies',
  deployments: 'custom-api:GET:/api/v1/backtest/deployments',
  conversations: 'custom-api:GET:/api/v1/brain/conversations',
  entities: 'custom-api:GET:/api/v1/brain/analysis/god-nodes',
  catalog: 'custom-api:GET:/api/v1/catalog',
  projects: 'custom-api:GET:/api/v1/projects',
  routines: 'custom-api:GET:/api/v1/routines',
});

const TARGET_PARAMETER_ALLOWLIST = Object.freeze({
  [TARGET_IDS[0]]: ['stk_cd', 'period', 'adjusted'],
  [TARGET_IDS[1]]: ['job_id'],
  [TARGET_IDS[2]]: ['run_id'],
  [TARGET_IDS[3]]: ['run_id'],
  [TARGET_IDS[4]]: ['strategy_id'],
  [TARGET_IDS[5]]: ['strategy_id', 'version_id'],
  [TARGET_IDS[6]]: ['strategy_id', 'base', 'head'],
  [TARGET_IDS[7]]: ['deployment_id'],
  [TARGET_IDS[8]]: ['job_id'],
  [TARGET_IDS[9]]: ['conversation_id'],
  [TARGET_IDS[10]]: ['entity_id'],
  [TARGET_IDS[11]]: ['entity'],
  [TARGET_IDS[12]]: ['operation_id'],
  [TARGET_IDS[13]]: ['operation_ref'],
  [TARGET_IDS[14]]: ['project_id'],
  [TARGET_IDS[15]]: ['project_id', 'path'],
  [TARGET_IDS[16]]: ['project_id'],
  [TARGET_IDS[17]]: ['routine_id'],
  [TARGET_IDS[18]]: ['routine_id'],
  [TARGET_IDS[19]]: ['job_id'],
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function firstBy(items, key) {
  if (!Array.isArray(items)) return { value: null, count: 0 };
  const candidates = items.filter((item) => item && typeof item === 'object' && typeof item[key] === 'string' && item[key] && item[key].length <= 256);
  candidates.sort((left, right) => left[key].localeCompare(right[key]));
  return { value: candidates[0] || null, count: candidates.length };
}

function firstViableProject(body) {
  if (!body || body.notice !== null || !Array.isArray(body.projects)) {
    return { value: null, count: 0, error: 'BLOCKED_SOURCE_CONTRACT_MISMATCH' };
  }
  const candidates = body.projects.filter((item) => (
    item
    && typeof item === 'object'
    && typeof item.id === 'string'
    && item.id
    && item.id.length <= 256
    && item.exists === true
    && (item.kind === 'managed' || item.kind === 'external')
  ));
  candidates.sort((left, right) => left.id.localeCompare(right.id));
  return { value: candidates[0] || null, count: candidates.length, error: null };
}

function firstTwoBy(items, key) {
  if (!Array.isArray(items)) return { values: [], count: 0 };
  const candidates = items.filter((item) => item && typeof item === 'object' && typeof item[key] === 'string' && item[key] && item[key].length <= 256);
  candidates.sort((left, right) => left[key].localeCompare(right[key]));
  return { values: candidates.slice(0, 2), count: candidates.length };
}

function firstPythonEntry(entries) {
  const candidates = [];
  const visit = (items) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      if (item.py === true && typeof item.path === 'string' && item.path.length <= 512) candidates.push(item);
      visit(item.children);
    }
  };
  visit(entries);
  candidates.sort((left, right) => left.path.localeCompare(right.path));
  return { value: candidates[0] || null, count: candidates.length };
}

function structuralShape(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return depth >= 3 ? 'array' : ['array', ...[...new Set(value.slice(0, 5).map((item) => structuralShape(item, depth + 1)))].sort()];
  if (typeof value !== 'object') return typeof value;
  if (depth >= 3) return 'object';
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, structuralShape(value[key], depth + 1)]));
}

function schemaEvidence(value) {
  const topLevelType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const topLevelCount = Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : null;
  return { top_level_type: topLevelType, top_level_count: topLevelCount, schema_digest_sha256: sha256(JSON.stringify(structuralShape(value))) };
}

async function boundedJson(response) {
  const reader = response.body?.getReader?.();
  if (!reader) return { error: 'INVALID_JSON_RESPONSE' };
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return { error: 'RESPONSE_TOO_LARGE' };
    }
    chunks.push(value);
  }
  try {
    return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { error: 'INVALID_JSON_RESPONSE' };
  }
}

function dereferenceParameter(openapi, parameter) {
  if (!parameter?.$ref) return parameter;
  const prefix = '#/components/parameters/';
  return parameter.$ref.startsWith(prefix) ? openapi?.components?.parameters?.[parameter.$ref.slice(prefix.length)] : null;
}

function operationParameters(openapi, item) {
  const pathItem = openapi?.paths?.[item.route_template];
  return [...(pathItem?.parameters || []), ...(pathItem?.get?.parameters || [])]
    .map((parameter) => dereferenceParameter(openapi, parameter))
    .filter(Boolean);
}

function resolveUrl(baseUrl, item, openapi, inputs, bearer) {
  const operation = openapi?.paths?.[item.route_template]?.get;
  if (!operation || operation.operationId !== item.expected_operation_id) return { error: 'RUNTIME_IDENTITY_MISMATCH' };
  if (operation.requestBody?.required) return { error: 'GET_REQUEST_BODY_NOT_AUTHORIZED' };
  const responseTypes = Object.keys(operation.responses?.['200']?.content || {});
  if (responseTypes.some((value) => value.toLowerCase().includes('text/event-stream'))) return { error: 'STREAMING_RESPONSE_EXCLUDED' };
  const url = new URL(baseUrl);
  let resolvedPath = item.route_template;
  const used = [];
  const parameters = operationParameters(openapi, item);
  const allowed = new Set(TARGET_PARAMETER_ALLOWLIST[item.id] || []);
  if (Object.keys(inputs || {}).some((name) => !allowed.has(name))) return { error: 'CHAIN_PARAMETER_NOT_ALLOWLISTED' };
  for (const parameter of parameters.filter((entry) => entry?.required)) {
    if (parameter.in === 'header' && parameter.name?.toLowerCase() === 'authorization' && bearer) continue;
    if (!allowed.has(parameter.name)) return { error: 'RUNTIME_PARAMETER_CONTRACT_MISMATCH' };
    const value = inputs?.[parameter.name];
    if (!['path', 'query'].includes(parameter.in) || value === undefined || value === null) return { error: 'MISSING_SAFE_CHAIN_INPUT' };
  }
  for (const [name, rawValue] of Object.entries(inputs || {})) {
    const parameter = parameters.find((entry) => entry?.name === name && ['path', 'query'].includes(entry.in));
    if (!parameter) return { error: 'RUNTIME_PARAMETER_CONTRACT_MISMATCH' };
    const encoded = String(rawValue);
    if (!encoded || encoded.length > 512 || /[\r\n]/.test(encoded)) return { error: 'INVALID_SAFE_CHAIN_INPUT' };
    if (parameter.in === 'path') resolvedPath = resolvedPath.replace(`{${name}}`, encodeURIComponent(encoded));
    else url.searchParams.set(name, encoded);
    used.push({ name, in: parameter.in, source: 'preceding_safe_get' });
  }
  if (/\{[^}]+\}/.test(resolvedPath)) return { error: 'MISSING_SAFE_CHAIN_INPUT' };
  url.pathname = resolvedPath;
  return { url, used };
}

function preflightOpenApi(openapi, plan) {
  if (!openapi || typeof openapi !== 'object') return { status: 'BLOCKED', reason: 'OPENAPI_NOT_SUPPLIED' };
  const ids = [...new Set([...TARGET_IDS, ...Object.values(SOURCE_IDS)])];
  for (const id of ids) {
    const item = plan.byId.get(id);
    if (!item || item.method !== 'GET' || !item.expected_operation_id || !['DRY_RUN_RUNTIME_OPENAPI_REQUIRED', 'MISSING_SAFE_OBSERVED_INPUT'].includes(item.reason)) {
      return { status: 'BLOCKED', reason: 'CUSTOM_API_BASELINE_MISMATCH', route_id: id };
    }
    const operation = openapi?.paths?.[item.route_template]?.get;
    if (!operation || operation.operationId !== item.expected_operation_id) return { status: 'BLOCKED', reason: 'RUNTIME_IDENTITY_MISMATCH', route_id: id };
    if (operation.requestBody !== undefined) return { status: 'BLOCKED', reason: 'GET_REQUEST_BODY_NOT_AUTHORIZED', route_id: id };
    const responseTypes = Object.values(operation.responses || {}).flatMap((response) => Object.keys(response?.content || {}));
    if (responseTypes.some((value) => value.toLowerCase().includes('text/event-stream'))) return { status: 'BLOCKED', reason: 'STREAMING_RESPONSE_EXCLUDED', route_id: id };
    const parameters = operationParameters(openapi, item);
    const allowed = new Set(TARGET_PARAMETER_ALLOWLIST[id] || []);
    const required = parameters.filter((entry) => entry?.required);
    for (const parameter of required) {
      if (parameter.in === 'header' && parameter.name?.toLowerCase() === 'authorization') continue;
      if (!['path', 'query'].includes(parameter.in) || !allowed.has(parameter.name)) return { status: 'BLOCKED', reason: 'RUNTIME_PARAMETER_CONTRACT_MISMATCH', route_id: id };
    }
    for (const name of allowed) {
      if (!parameters.some((parameter) => parameter?.name === name && ['path', 'query'].includes(parameter.in))) {
        return { status: 'BLOCKED', reason: 'RUNTIME_PARAMETER_CONTRACT_MISMATCH', route_id: id };
      }
    }
    const placeholders = [...item.route_template.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
    const pathParameters = required.filter((parameter) => parameter.in === 'path').map((parameter) => parameter.name).sort();
    if (JSON.stringify(placeholders) !== JSON.stringify(pathParameters)) return { status: 'BLOCKED', reason: 'RUNTIME_PARAMETER_CONTRACT_MISMATCH', route_id: id };
  }
  return { status: 'VERIFIED', reason: null, route_count: ids.length };
}

export function chainDefinitions() {
  return TARGET_IDS.map((id) => {
    if (id.endsWith('/jobs/{job_id}') || id.includes('/ingestion/jobs/{job_id}') || id.includes('/source/map/{job_id}')) {
      return { id, status: 'BLOCKED', reason: 'NO_SAFE_EXISTING_LIST_SOURCE', sources: [] };
    }
    return { id, status: 'READY_FOR_REVIEW', reason: 'SAFE_EXISTING_GET_CHAIN_DEFINED', sources: [] };
  });
}

export async function buildCustomReadChainPlan(options = {}) {
  const revision = options.revision || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: options.repoRoot || REPO_ROOT, encoding: 'utf8', windowsHide: true }).trim();
  const base = await buildCustomReadPlan({ ...options, revision });
  if (base.results.length !== 124 || new Set(base.results.map((item) => item.id)).size !== 124) throw new Error('custom API baseline must contain exactly 124 unique IDs');
  const byId = new Map(base.results.map((item) => [item.id, item]));
  const definitions = chainDefinitions();
  if (definitions.length !== 20 || new Set(definitions.map((item) => item.id)).size !== 20) throw new Error('chain target set must contain exactly 20 unique IDs');
  const results = definitions.map((definition) => {
    const item = byId.get(definition.id);
    if (!item || item.method !== 'GET' || !item.expected_operation_id) return { ...definition, status: 'BLOCKED', reason: 'CUSTOM_API_BASELINE_MISMATCH' };
    return { ...definition, source_path: item.source_path, route_template: item.route_template, expected_operation_id: item.expected_operation_id };
  });
  return { revision, identityBaseline: base.identityBaseline, byId, results };
}

async function deriveInputs(targetId, get, recordSelection) {
  const select = async (sourceId, key, field) => {
    const source = await get(sourceId, {});
    if (!source.ok) return { error: source.reason };
    const selected = firstBy(source.body?.[key], field);
    recordSelection(sourceId, key, selected.count, Boolean(selected.value));
    return selected.value ? { item: selected.value } : { error: 'BLOCKED_NO_EXISTING_RECORD' };
  };
  if (targetId === TARGET_IDS[0]) {
    const selected = await select(SOURCE_IDS.deployments, 'deployments', 'id');
    if (selected.error) return selected;
    const item = selected.item;
    if (typeof item.stk_cd !== 'string' || typeof item.period !== 'string' || typeof item.adjusted !== 'boolean') return { error: 'BLOCKED_SOURCE_CONTRACT_MISMATCH' };
    return { inputs: { stk_cd: item.stk_cd, period: item.period, adjusted: item.adjusted } };
  }
  if (targetId.includes('/runs/{run_id}')) {
    const selected = await select(SOURCE_IDS.runs, 'runs', 'run_id');
    return selected.error ? selected : { inputs: { run_id: selected.item.run_id } };
  }
  if (targetId.includes('/strategies/{strategy_id}')) {
    const selected = await select(SOURCE_IDS.strategies, 'strategies', 'id');
    if (selected.error) return selected;
    if (targetId.endsWith('/versions/{version_id}') || targetId.endsWith('/diff')) {
      const versionsId = 'custom-api:GET:/api/v1/backtest/strategies/{strategy_id}/versions';
      const versions = await get(versionsId, { strategy_id: selected.item.id });
      if (!versions.ok) return { error: versions.reason };
      if (targetId.endsWith('/diff')) {
        const pair = firstTwoBy(versions.body?.versions, 'id');
        recordSelection(versionsId, 'versions for diff', pair.count, pair.values.length === 2);
        return pair.values.length === 2
          ? { inputs: { strategy_id: selected.item.id, base: pair.values[0].id, head: pair.values[1].id } }
          : { error: 'BLOCKED_NO_EXISTING_RECORD' };
      }
      const version = firstBy(versions.body?.versions, 'id');
      recordSelection(versionsId, 'versions', version.count, Boolean(version.value));
      return version.value ? { inputs: { strategy_id: selected.item.id, version_id: version.value.id } } : { error: 'BLOCKED_NO_EXISTING_RECORD' };
    }
    return { inputs: { strategy_id: selected.item.id } };
  }
  if (targetId.includes('/deployments/{deployment_id}/signals')) {
    const selected = await select(SOURCE_IDS.deployments, 'deployments', 'id');
    return selected.error ? selected : { inputs: { deployment_id: selected.item.id } };
  }
  if (targetId.endsWith('/brain/chats')) {
    const selected = await select(SOURCE_IDS.conversations, 'conversations', 'conversation_id');
    return selected.error ? selected : { inputs: { conversation_id: selected.item.conversation_id } };
  }
  if (targetId.includes('/analysis/entity-')) {
    const selected = await select(SOURCE_IDS.entities, 'nodes', 'entity_id');
    if (selected.error) return selected;
    return { inputs: targetId.endsWith('entity-timeline') ? { entity_id: selected.item.entity_id } : { entity: selected.item.entity_id } };
  }
  if (targetId.includes('/realtime-bindings/{operation_id}')) {
    const source = await get(SOURCE_IDS.catalog, {});
    if (!source.ok) return { error: source.reason };
    const operations = Array.isArray(source.body?.operations) ? source.body.operations.filter((item) => item?.kind === 'websocket') : [];
    const selected = firstBy(operations, 'tr_id');
    recordSelection(SOURCE_IDS.catalog, 'websocket operations', selected.count, Boolean(selected.value));
    return selected.value ? { inputs: { operation_id: selected.value.tr_id } } : { error: 'BLOCKED_NO_EXISTING_RECORD' };
  }
  if (targetId.includes('/catalog/{operation_ref}')) {
    const selected = await select(SOURCE_IDS.catalog, 'operations', 'operation_ref');
    return selected.error ? selected : { inputs: { operation_ref: selected.item.operation_ref } };
  }
  if (targetId.includes('/projects/{project_id}')) {
    const source = await get(SOURCE_IDS.projects, {});
    if (!source.ok) return { error: source.reason };
    const selected = firstViableProject(source.body);
    recordSelection(SOURCE_IDS.projects, 'viable projects', selected.count, Boolean(selected.value));
    if (selected.error) return { error: selected.error };
    if (!selected.value) return { error: 'BLOCKED_NO_VIABLE_PROJECT' };
    if (targetId.endsWith('/file')) {
      const treeId = 'custom-api:GET:/api/v1/projects/{project_id}/tree';
      const tree = await get(treeId, { project_id: selected.value.id });
      if (!tree.ok) return { error: tree.reason };
      const file = firstPythonEntry(tree.body?.entries);
      recordSelection(treeId, 'python entries', file.count, Boolean(file.value));
      return file.value ? { inputs: { project_id: selected.value.id, path: file.value.path } } : { error: 'BLOCKED_NO_EXISTING_RECORD' };
    }
    return { inputs: { project_id: selected.value.id } };
  }
  if (targetId.includes('/routines/{routine_id}')) {
    const selected = await select(SOURCE_IDS.routines, 'routines', 'id');
    return selected.error ? selected : { inputs: { routine_id: selected.item.id } };
  }
  return { error: 'NO_SAFE_EXISTING_LIST_SOURCE' };
}

export async function runCustomReadChain(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const baseUrl = validateBaseUrl(options.baseUrl || 'http://127.0.0.1:8010');
  const execute = options.execute === true;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxRequests = options.maxRequests ?? 32;
  const maxDurationMs = options.maxDurationMs ?? 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) throw new Error('timeoutMs must be between 100 and 10000');
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > MAX_REQUESTS) throw new Error('maxRequests must be between 1 and 40');
  if (!Number.isFinite(maxDurationMs) || maxDurationMs < 100 || maxDurationMs > 60_000) throw new Error('maxDurationMs must be between 100 and 60000');
  const plan = await buildCustomReadChainPlan({ ...options, repoRoot });
  const now = options.now instanceof Date ? options.now : new Date();
  if (!execute) return report(plan, now, false, [], plan.results.map((item) => ({ ...item, verdict: item.status === 'BLOCKED' ? 'BLOCKED' : 'NOT_RUN', reason: item.reason })), 0, { status: 'NOT_RUN', reason: 'DRY_RUN' });

  const openapiPreflight = preflightOpenApi(options.openapi, plan);
  if (openapiPreflight.status !== 'VERIFIED') {
    const results = plan.results.map((item) => item.status === 'BLOCKED'
      ? { ...item, verdict: 'BLOCKED', attempted: false }
      : { ...item, verdict: 'BLOCKED', reason: 'OPENAPI_PREFLIGHT_FAILED', preflight_reason: openapiPreflight.reason, attempted: false });
    return report(plan, now, true, [], results, 0, openapiPreflight);
  }
  let bearer = options.bearer;
  if (bearer === undefined) {
    try {
      bearer = options.readBearerFn
        ? await options.readBearerFn()
        : parseLocalBearer(await readFile(path.join(repoRoot, 'backend', '.env'), 'utf8'));
    } catch {
      bearer = null;
    }
    if (!bearer) {
      const results = plan.results.map((item) => item.status === 'BLOCKED'
        ? { ...item, verdict: 'BLOCKED', attempted: false }
        : { ...item, verdict: 'BLOCKED', reason: 'AUTH_UNAVAILABLE', attempted: false });
      return report(plan, now, true, [], results, 0, openapiPreflight);
    }
  }
  const fetchFn = options.fetchFn || globalThis.fetch;
  const nowMs = options.nowMsFn || Date.now;
  const deadline = nowMs() + maxDurationMs;
  let requestCount = 0;
  let authRejected = false;
  const sourceObservations = [];
  const cache = new Map();
  const byId = plan.byId;
  const call = async (id, inputs = {}) => {
    const cacheKey = `${id}\0${JSON.stringify(inputs)}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    if (authRejected) return { ok: false, reason: 'AUTH_REJECTED', attempted: false };
    if (requestCount >= maxRequests) return { ok: false, reason: 'REQUEST_LIMIT_REACHED' };
    const remainingMs = deadline - nowMs();
    if (remainingMs <= 0) return { ok: false, reason: 'DURATION_LIMIT_REACHED' };
    const item = byId.get(id);
    if (!item || item.method !== 'GET' || !item.expected_operation_id || !['DRY_RUN_RUNTIME_OPENAPI_REQUIRED', 'MISSING_SAFE_OBSERVED_INPUT'].includes(item.reason)) {
      return { ok: false, reason: 'CUSTOM_API_BASELINE_MISMATCH' };
    }
    const resolved = resolveUrl(baseUrl, item, options.openapi, inputs, bearer);
    if (resolved.error) return { ok: false, reason: resolved.error };
    requestCount += 1;
    const observedAt = options.clock ? options.clock() : new Date();
    const controller = new AbortController();
    const effectiveTimeoutMs = Math.min(timeoutMs, remainingMs);
    const durationLimited = effectiveTimeoutMs < timeoutMs;
    const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
    let result;
    try {
      const started = performance.now();
      const response = await fetchFn(resolved.url, {
        method: 'GET', signal: controller.signal, redirect: 'error', credentials: 'omit',
        headers: bearer ? { Authorization: `Bearer ${bearer}`, 'X-Athena-Caller': 'market-session-audit' } : { 'X-Athena-Caller': 'market-session-audit' },
      });
      if (response.url && new URL(response.url).href !== resolved.url.href) {
        const mismatch = new Error('response URL changed');
        mismatch.code = 'RESPONSE_URL_CHANGED';
        throw mismatch;
      }
      const elapsedMs = Math.round((performance.now() - started) * 10) / 10;
      const contentType = String(response.headers?.get?.('content-type') || '').split(';')[0].toLowerCase();
      if (!response.ok) {
        await response.body?.cancel?.();
        const reason = response.status === 401 || response.status === 403 ? 'AUTH_REJECTED' : 'SOURCE_HTTP_STATUS';
        if (reason === 'AUTH_REJECTED') authRejected = true;
        result = { ok: false, reason, attempted: true, observedAt, used: resolved.used, evidence: { http_status: response.status, elapsed_ms: elapsedMs } };
      } else if (!(contentType === 'application/json' || contentType.endsWith('+json'))) {
        await response.body?.cancel?.();
        result = { ok: false, reason: 'NON_JSON_RESPONSE', attempted: true, observedAt, used: resolved.used, evidence: { http_status: response.status, elapsed_ms: elapsedMs } };
      } else {
        const parsed = await boundedJson(response);
        result = parsed.error ? { ok: false, reason: parsed.error, attempted: true, observedAt, used: resolved.used, evidence: { http_status: response.status, elapsed_ms: elapsedMs } } : {
          ok: true, body: parsed.value, attempted: true, observedAt, used: resolved.used,
          evidence: { http_status: response.status, elapsed_ms: elapsedMs, response: schemaEvidence(parsed.value) },
        };
      }
    } catch (error) {
      const reason = error?.code === 'RESPONSE_URL_CHANGED'
        ? 'RESPONSE_URL_CHANGED'
        : error?.name === 'AbortError'
          ? durationLimited ? 'DURATION_LIMIT_REACHED' : 'TIMEOUT'
          : 'TRANSPORT_ERROR';
      result = { ok: false, reason, attempted: true, observedAt, used: resolved.used };
    } finally {
      clearTimeout(timer);
    }
    cache.set(cacheKey, result);
    sourceObservations.push({ id, observed_at: observedAt.toISOString(), market_phase: marketPhase(observedAt), verdict: result.ok ? 'PASS_HTTP_SCHEMA_ONLY' : 'BLOCKED', reason: result.reason || 'HTTP_RESPONSE_SANITIZED', evidence: result.evidence || null, resolved_parameters: result.used || [] });
    return result;
  };

  const results = [];
  for (const definition of plan.results) {
    if (definition.status === 'BLOCKED') {
      results.push({ ...definition, verdict: 'BLOCKED', attempted: false });
      continue;
    }
    const selections = [];
    const derived = await deriveInputs(definition.id, call, (sourceId, selector, candidateCount, selected) => selections.push({ source_id: sourceId, selector, observed_candidate_count: candidateCount, selected }));
    if (derived.error) {
      results.push({ ...definition, verdict: 'BLOCKED', reason: derived.error, attempted: false, selections });
      continue;
    }
    const target = await call(definition.id, derived.inputs);
    results.push({
      ...definition,
      verdict: target.ok ? 'PASS_HTTP_SCHEMA_ONLY' : 'BLOCKED',
      reason: target.ok ? 'HTTP_RESPONSE_SANITIZED' : target.reason,
      attempted: Boolean(target.attempted),
      observed_at: target.observedAt?.toISOString() || null,
      market_phase: target.observedAt ? marketPhase(target.observedAt) : null,
      evidence: target.evidence || null,
      resolved_parameters: target.used || [],
      selections,
    });
  }
  return report(plan, now, true, sourceObservations, results, requestCount, openapiPreflight);
}

function report(plan, now, execute, sourceObservations, results, requestCount = 0, openapiPreflight = null) {
  const summary = results.reduce((out, item) => {
    out[item.verdict] = (out[item.verdict] || 0) + 1;
    out.total += 1;
    if (item.attempted) out.attempted += 1;
    return out;
  }, { total: 0, attempted: 0 });
  return {
    schema_version: 1,
    kind: 'athena_custom_read_chain',
    generated_at: now.toISOString(),
    market_phase: marketPhase(now),
    revision: plan.revision,
    mode: execute ? 'loopback_live' : 'chain_dry_run',
    scope: { target_ids: 20, source_inventory_ids: 124, full_product_pass_claimed: false, raw_bodies_persisted: false, selected_values_persisted: false, credentials_persisted: false },
    runtime_identity_baseline: plan.identityBaseline,
    openapi_preflight: openapiPreflight,
    request_count: requestCount,
    summary,
    source_observations: sourceObservations,
    results,
  };
}

async function main() {
  const execute = process.argv.includes('--execute');
  if (execute) throw new Error('live execution requires reviewed programmatic OpenAPI injection');
  const reportValue = await runCustomReadChain({ execute: false });
  await mkdir(DEFAULT_OUTPUT, { recursive: true });
  const name = new Date().toISOString().replace(/[-:]/g, '').replace('.', '-');
  const outputPath = path.join(DEFAULT_OUTPUT, `custom-read-chain-${name}.json`);
  await writeFile(outputPath, `${JSON.stringify(reportValue, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({ output: outputPath, mode: reportValue.mode, summary: reportValue.summary }));
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try { await main(); } catch { console.error('custom read chain failed'); process.exitCode = 1; }
}
