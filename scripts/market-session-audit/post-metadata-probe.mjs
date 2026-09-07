#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BASE_URL, marketPhase, parseLocalBearer, REPO_ROOT, validateBaseUrl } from './observer.mjs';

const QUERY = '삼성전자 오늘 주가 얼마야?';
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_DURATION_MS = 20_000;
const MAX_BODY_BYTES = 1_000_000;
const MAX_OPENAPI_BYTES = 8 * 1024 * 1024;
const OUTPUT_DIR = path.join(REPO_ROOT, 'artifacts', 'market-session-audit', '2026-09-07');
const SOURCE_CONTRACT = Object.freeze({
  'backend/athena_api/api/llm_tools.py': 'efdb732daef8fae0d235eaf202dff7cfbdcb5b16175fbfbe494df4d03f076d42',
  'backend/athena_api/selector/schemas.py': 'bef275fd8601c11127af70a86fc7e432d6ac144d3fbd58ec5fa6e6058325abc3',
  'backend/athena_api/selector/service.py': '54ae52785c3982b10daac62160f8381cc7ccbda5b82a76c816c24997a6578fdf',
});
const ROUTES = Object.freeze([
  { id: 'custom-api:POST:/api/v1/llm/tools/search', path: '/api/v1/llm/tools/search', operationId: 'llm_search_operations', requestSchema: 'SearchRequest', responseSchema: 'SearchResponse' },
  { id: 'custom-api:POST:/api/v1/llm/tools/describe', path: '/api/v1/llm/tools/describe', operationId: 'llm_describe_operation', requestSchema: 'DescribeRequest', responseSchema: 'OperationDescription' },
]);

function fixedError(code, httpStatus = null) {
  const error = new Error(code);
  error.code = code;
  if (httpStatus !== null) error.httpStatus = httpStatus;
  return error;
}

async function withinDeadline(start, deadline, onLateResult = null) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw fixedError('DURATION_LIMIT_REACHED');
  const operation = Promise.resolve().then(start);
  let timer;
  const expired = Symbol('expired');
  const result = await Promise.race([
    operation,
    new Promise((resolve) => { timer = setTimeout(() => resolve(expired), remaining); }),
  ]).finally(() => clearTimeout(timer));
  if (result !== expired) return result;
  if (onLateResult) operation.then(onLateResult, () => {});
  throw fixedError('DURATION_LIMIT_REACHED');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function structuralShape(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return depth >= 3 ? 'array' : ['array', ...new Set(value.slice(0, 5).map((item) => structuralShape(item, depth + 1)))];
  if (typeof value !== 'object') return typeof value;
  if (depth >= 3) return 'object';
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, structuralShape(value[key], depth + 1)]));
}

function schemaEvidence(value) {
  return {
    top_level_type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
    top_level_count: Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : null,
    schema_digest_sha256: sha256(JSON.stringify(structuralShape(value))),
  };
}

async function readBoundedJson(response, signal, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) throw fixedError('BODY_UNAVAILABLE');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw fixedError('TIMEOUT');
      const { done, value } = await new Promise((resolve, reject) => {
        const onAbort = () => reject(fixedError('TIMEOUT'));
        signal.addEventListener('abort', onAbort, { once: true });
        reader.read().then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
      });
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw fixedError('RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw fixedError('INVALID_JSON_RESPONSE');
  }
}

function assertJsonResponse(response, expectedUrl) {
  if (response.url && new URL(response.url).href !== expectedUrl.href) throw fixedError('RESPONSE_URL_CHANGED');
  if (response.status !== 200) throw fixedError(response.status === 401 || response.status === 403 ? 'AUTH_REJECTED' : 'HTTP_STATUS', response.status);
  const type = String(response.headers?.get?.('content-type') || '').split(';')[0].toLowerCase();
  if (!(type === 'application/json' || type.endsWith('+json'))) throw fixedError('NON_JSON_RESPONSE');
}

async function withTimeout(fetchFn, url, init, timeoutMs, deadline, maxBytes) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw fixedError('DURATION_LIMIT_REACHED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, remaining));
  let responseReceived = false;
  try {
    const response = await fetchFn(url, { ...init, signal: controller.signal, redirect: 'error', credentials: 'omit' });
    responseReceived = true;
    assertJsonResponse(response, url);
    return await readBoundedJson(response, controller.signal, maxBytes);
  } catch (error) {
    let mapped = error;
    if (!error?.code) mapped = error?.name === 'AbortError' ? fixedError('TIMEOUT') : fixedError('TRANSPORT_ERROR');
    if (responseReceived) mapped.responseReceived = true;
    throw mapped;
  } finally {
    clearTimeout(timer);
  }
}

function schemaRef(operation, location) {
  const schema = location === 'request'
    ? operation?.requestBody?.content?.['application/json']?.schema
    : operation?.responses?.['200']?.content?.['application/json']?.schema;
  return typeof schema?.$ref === 'string' ? schema.$ref : null;
}

function preflightOpenApi(openapi) {
  for (const route of ROUTES) {
    const operation = openapi?.paths?.[route.path]?.post;
    if (!operation || operation.operationId !== route.operationId) return { status: 'BLOCKED', reason: 'RUNTIME_IDENTITY_MISMATCH', route_id: route.id };
    if (operation.requestBody?.required !== true) return { status: 'BLOCKED', reason: 'RUNTIME_REQUEST_CONTRACT_MISMATCH', route_id: route.id };
    if (schemaRef(operation, 'request') !== `#/components/schemas/${route.requestSchema}`) return { status: 'BLOCKED', reason: 'RUNTIME_REQUEST_CONTRACT_MISMATCH', route_id: route.id };
    if (schemaRef(operation, 'response') !== `#/components/schemas/${route.responseSchema}`) return { status: 'BLOCKED', reason: 'RUNTIME_RESPONSE_CONTRACT_MISMATCH', route_id: route.id };
  }
  return { status: 'VERIFIED', route_count: ROUTES.length };
}

async function verifySourceContract(repoRoot) {
  const digests = {};
  for (const [relativePath, expected] of Object.entries(SOURCE_CONTRACT)) {
    let actual;
    try {
      actual = sha256(await readFile(path.join(repoRoot, relativePath)));
    } catch {
      throw fixedError('SOURCE_CONTRACT_UNAVAILABLE');
    }
    if (actual !== expected) throw fixedError('SOURCE_CONTRACT_MISMATCH');
    digests[relativePath] = actual;
  }
  return { status: 'VERIFIED', digests_sha256: digests };
}

async function loadBearer(repoRoot, readBearerFn) {
  let token;
  try {
    token = readBearerFn ? await readBearerFn() : parseLocalBearer(await readFile(path.join(repoRoot, 'backend', '.env'), 'utf8'));
  } catch {
    token = null;
  }
  if (!token) throw fixedError('AUTH_UNAVAILABLE');
  return token;
}

function eligibleRef(body) {
  if (!body || !Array.isArray(body.results)) return { ref: null, count: 0, reason: 'SEARCH_RESPONSE_CONTRACT_MISMATCH' };
  const eligible = body.results.filter((item) => item && item.kind === 'query'
    && typeof item.operation_ref === 'string' && item.operation_ref.length <= 256
    && /^(?:base:[A-Za-z0-9]+|detail:[A-Za-z0-9]+:[A-Za-z0-9_-]+)$/.test(item.operation_ref));
  return { ref: eligible[0]?.operation_ref || null, count: eligible.length, reason: eligible.length ? null : 'NO_ELIGIBLE_READ_ONLY_REF' };
}

function resultRow(route, observedAt, response, extra = {}) {
  return {
    id: route.id,
    operation_id: route.operationId,
    attempted: true,
    verdict: 'PASS_HTTP_JSON_SHAPE_ONLY',
    observed_at: observedAt.toISOString(),
    market_phase: marketPhase(observedAt),
    http_status: 200,
    response_received: true,
    response: schemaEvidence(response),
    ...extra,
  };
}

function blockedRow(route, reason, attempted = false, observedAt = null, httpStatus = null, responseReceived = false) {
  return {
    id: route.id,
    operation_id: route.operationId,
    attempted,
    verdict: 'BLOCKED',
    reason,
    observed_at: observedAt?.toISOString() || null,
    market_phase: observedAt ? marketPhase(observedAt) : null,
    http_status: Number.isInteger(httpStatus) ? httpStatus : null,
    response_received: responseReceived,
  };
}

function outputName(date) {
  return `post-metadata-probe-${date.toISOString().replace(/[-:]/g, '').replace('.', '-')}.json`;
}

async function reserveArtifact(outputDir, timestamp) {
  await mkdir(outputDir, { recursive: true });
  for (let suffix = 0; ; suffix += 1) {
    const date = suffix === 0 ? timestamp : new Date(timestamp.getTime() + suffix);
    try {
      const outputPath = path.join(outputDir, outputName(date));
      return { handle: await open(outputPath, 'wx'), outputPath };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw fixedError('ARTIFACT_PREPARATION_FAILED');
    }
  }
}

async function writeArtifact(handle, value) {
  await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await handle.sync();
  await handle.close();
}

function safeFailure(reason, counts, mode) {
  return {
    schema_version: 1,
    kind: 'athena_post_metadata_probe_failure',
    generated_at: new Date().toISOString(),
    mode,
    reason: typeof reason === 'string' && /^[A-Z0-9_]+$/.test(reason) ? reason : 'PROBE_FAILED',
    admission: {
      ...counts,
      count_semantics: 'transport_adapter_invocations',
      transport_response_received: counts.transport_responses_received > 0,
      network_response_received: mode === 'loopback_live' && counts.transport_responses_received > 0,
    },
    raw_bodies_persisted: false,
    selected_ref_persisted: false,
    credentials_persisted: false,
  };
}

export async function runPostMetadataProbe(options = {}) {
  if (options.execute !== true) throw fixedError('EXPLICIT_EXECUTE_REQUIRED');
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const baseUrl = validateBaseUrl(options.baseUrl || DEFAULT_BASE_URL);
  if (baseUrl !== DEFAULT_BASE_URL) throw fixedError('EXACT_BASE_URL_REQUIRED');
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxDurationMs = options.maxDurationMs ?? MAX_DURATION_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > REQUEST_TIMEOUT_MS) throw fixedError('INVALID_TIMEOUT');
  if (!Number.isInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > MAX_DURATION_MS) throw fixedError('INVALID_DURATION');
  const deadline = Date.now() + maxDurationMs;
  const timestamp = options.timestamp instanceof Date ? options.timestamp : new Date();
  const { handle, outputPath } = await withinDeadline(
    () => reserveArtifact(path.resolve(options.outputDir || OUTPUT_DIR), timestamp),
    deadline,
    ({ handle: lateHandle }) => lateHandle.close().catch(() => {}),
  );
  const mode = options.fetchFn ? 'in_memory_fixture' : 'loopback_live';
  const counts = { source_reads: 0, credential_reads: 0, metadata_requests: 0, business_requests: 0, transport_responses_received: 0 };
  try {
    const sourceContract = await withinDeadline(() => verifySourceContract(repoRoot), deadline);
    counts.source_reads = Object.keys(SOURCE_CONTRACT).length;
    counts.credential_reads = 1;
    const bearer = await withinDeadline(() => loadBearer(repoRoot, options.readBearerFn), deadline);
    const fetchFn = options.fetchFn || globalThis.fetch;
    counts.metadata_requests = 1;
    const openapiUrl = new URL('/openapi.json', baseUrl);
    let openapi;
    try {
      openapi = await withTimeout(fetchFn, openapiUrl, {
        method: 'GET', headers: { Authorization: `Bearer ${bearer}`, 'X-Athena-Caller': 'market-session-audit' },
      }, timeoutMs, deadline, MAX_OPENAPI_BYTES);
      counts.transport_responses_received += 1;
    } catch (error) {
      if (error.responseReceived) counts.transport_responses_received += 1;
      throw error;
    }
    const openapiPreflight = preflightOpenApi(openapi);
    if (openapiPreflight.status !== 'VERIFIED') throw fixedError(openapiPreflight.reason);

    const headers = { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', 'X-Athena-Caller': 'market-session-audit' };
    const results = [];
    const searchAt = options.clock ? options.clock() : new Date();
    counts.business_requests += 1;
    let search;
    try {
      search = await withTimeout(fetchFn, new URL(ROUTES[0].path, baseUrl), {
        method: 'POST', headers, body: JSON.stringify({ query: QUERY, intent: 'query', limit: 5 }),
      }, timeoutMs, deadline, MAX_BODY_BYTES);
      counts.transport_responses_received += 1;
    } catch (error) {
      if (error.responseReceived) counts.transport_responses_received += 1;
      results.push(
        blockedRow(ROUTES[0], error.code, true, searchAt, error.httpStatus, Boolean(error.responseReceived)),
        blockedRow(ROUTES[1], 'SEARCH_PREREQUISITE_FAILED'),
      );
      return await finish(handle, outputPath, repoRoot, timestamp, sourceContract, openapiPreflight, counts, results, mode);
    }
    const selected = eligibleRef(search);
    if (selected.reason === 'SEARCH_RESPONSE_CONTRACT_MISMATCH') {
      results.push(
        blockedRow(ROUTES[0], selected.reason, true, searchAt, 200, true),
        blockedRow(ROUTES[1], 'SEARCH_PREREQUISITE_FAILED'),
      );
      return await finish(handle, outputPath, repoRoot, timestamp, sourceContract, openapiPreflight, counts, results, mode);
    }
    results.push(resultRow(ROUTES[0], searchAt, search, {
      eligible_read_only_candidate_count: selected.count,
      selected_ref_persisted: false,
    }));
    if (!selected.ref) {
      results.push(blockedRow(ROUTES[1], selected.reason));
      return await finish(handle, outputPath, repoRoot, timestamp, sourceContract, openapiPreflight, counts, results, mode);
    }

    const describeAt = options.clock ? options.clock() : new Date();
    counts.business_requests += 1;
    try {
      const described = await withTimeout(fetchFn, new URL(ROUTES[1].path, baseUrl), {
        method: 'POST', headers, body: JSON.stringify({ operation_ref: selected.ref, intent: 'query' }),
      }, timeoutMs, deadline, MAX_BODY_BYTES);
      if (described?.operation_ref !== selected.ref || described?.kind !== 'query') {
        const mismatch = fixedError('DESCRIBE_RESPONSE_CONTRACT_MISMATCH', 200);
        mismatch.responseReceived = true;
        throw mismatch;
      }
      counts.transport_responses_received += 1;
      results.push(resultRow(ROUTES[1], describeAt, described, { selected_ref_matches_response: true, selected_ref_persisted: false }));
    } catch (error) {
      if (error.responseReceived) counts.transport_responses_received += 1;
      results.push(blockedRow(ROUTES[1], error.code, true, describeAt, error.httpStatus, Boolean(error.responseReceived)));
    }
    return await finish(handle, outputPath, repoRoot, timestamp, sourceContract, openapiPreflight, counts, results, mode);
  } catch (error) {
    try { await writeArtifact(handle, safeFailure(error?.code, counts, mode)); } catch { await handle.close().catch(() => {}); }
    error.outputPath = outputPath;
    throw error;
  }
}

async function finish(handle, outputPath, repoRoot, timestamp, sourceContract, openapiPreflight, counts, results, mode) {
  const artifact = {
    schema_version: 1,
    kind: 'athena_post_metadata_probe',
    generated_at: timestamp.toISOString(),
    market_phase: marketPhase(timestamp),
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true }).trim(),
    mode,
    scope: { exact_ids: ROUTES.map((route) => route.id), full_product_pass_claimed: false, raw_bodies_persisted: false, selected_ref_persisted: false, credentials_persisted: false },
    source_contract: sourceContract,
    openapi_preflight: openapiPreflight,
    admission: {
      ...counts,
      count_semantics: 'transport_adapter_invocations',
      transport_response_received: counts.transport_responses_received > 0,
      network_response_received: mode === 'loopback_live' && counts.transport_responses_received > 0,
    },
    summary: {
      total: results.length,
      attempted: results.filter((item) => item.attempted).length,
      pass_http_json_shape_only: results.filter((item) => item.verdict === 'PASS_HTTP_JSON_SHAPE_ONLY').length,
      blocked: results.filter((item) => item.verdict === 'BLOCKED').length,
    },
    results,
  };
  await writeArtifact(handle, artifact);
  return { artifact, outputPath };
}

async function main(argv) {
  if (argv.length !== 1 || argv[0] !== '--execute') throw fixedError('EXPLICIT_EXECUTE_REQUIRED');
  const { artifact, outputPath } = await runPostMetadataProbe({ execute: true });
  console.log(JSON.stringify({ output: outputPath, mode: artifact.mode, summary: artifact.summary, admission: artifact.admission }));
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', reason: error?.code || 'PROBE_FAILED' }));
    process.exitCode = 1;
  }
}
