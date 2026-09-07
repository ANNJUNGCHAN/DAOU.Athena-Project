#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertLoopbackBaseUrl, buildReadPlan, marketPhase } from './read-sweep.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'artifacts', 'market-session-audit', '2026-09-07');
const DEFAULT_BASE_URL = 'http://127.0.0.1:8010';
const TOKEN_ENV = 'ATHENA_LOCAL_BEARER_TOKEN';
const REQUEST_LIMIT = 20;
const BODY_LIMIT = 1_000_000;
const OPENAPI_LIMIT = 8 * 1024 * 1024;

const SOURCE_FILES = {
  manifest: path.join(ROOT, 'backend', 'ref', 'kiwoom-common-screen-manifest.json'),
  definitions: path.join(ROOT, 'backend', 'ref', 'kiwoom-screen-definitions.json'),
  inventory: path.join(ROOT, 'backend', 'ref', 'kiwoom-tr-inventory.json'),
};

const CHAINS = [
  {
    sourceRef: 'base:ka01300', sourcePath: '$.nofi[*].gcod', path: '/api/v1/tr/watchlist/ka01300', operationId: 'post_query_watchlist_ka01300',
    targets: [{ operationRef: 'base:ka01301', field: 'arn_grp_id', required: 'Y', length: '3', description: 'ka01300 응답 결과의 gcod값을 입력', path: '/api/v1/tr/watchlist/ka01301', operationId: 'post_query_watchlist_ka01301' }],
  },
  {
    sourceRef: 'base:ka10102', sourcePath: '$.list[*].code', path: '/api/v1/tr/stockinfo/ka10102', operationId: 'post_query_stockinfo_ka10102',
    targets: [
      { operationRef: 'base:ka10039', field: 'mmcm_cd', required: 'Y', length: '3', description: '회원사 코드는 ka10102 조회', path: '/api/v1/tr/ranking/ka10039', operationId: 'post_query_ranking_ka10039' },
      { operationRef: 'base:ka10043', field: 'mmcm_cd', required: 'Y', length: '3', description: '회원사 코드는 ka10102 조회', path: '/api/v1/tr/stockinfo/ka10043', operationId: 'post_query_stockinfo_ka10043' },
      { operationRef: 'base:ka10052', field: 'mmcm_cd', required: 'Y', length: '3', description: '회원사 코드는 ka10102 조회', path: '/api/v1/tr/stockinfo/ka10052', operationId: 'post_query_stockinfo_ka10052' },
      { operationRef: 'base:ka10078', field: 'mmcm_cd', required: 'Y', length: '3', description: '회원사 코드는 ka10102 조회', path: '/api/v1/tr/quotes/ka10078', operationId: 'post_query_quotes_ka10078' },
    ],
  },
  {
    sourceRef: 'base:ka40007', sourcePath: '$.etfobjt_idex_cd', path: '/api/v1/tr/etf/ka40007', operationId: 'post_query_etf_ka40007',
    targets: [{ operationRef: 'base:ka40001', field: 'etfobjt_idex_cd', required: 'Y', length: '3', description: '', path: '/api/v1/tr/etf/ka40001', operationId: 'post_query_etf_ka40001' }],
  },
  {
    sourceRef: 'base:ka90001', sourcePath: '$.thema_grp[*].thema_grp_cd', path: '/api/v1/tr/theme/ka90001', operationId: 'post_query_theme_ka90001',
    targets: [{ operationRef: 'base:ka90002', field: 'thema_grp_cd', required: 'Y', length: '6', description: '테마그룹코드 번호', path: '/api/v1/tr/theme/ka90002', operationId: 'post_query_theme_ka90002' }],
  },
];

function normalizeFieldName(field) {
  return String(field?.element || '').replace(/^[-\s]+/, '');
}

function inventoryOperations(inventory) {
  return Array.isArray(inventory) ? inventory : inventory.operations || [];
}

function definitionFor(definitions, operationRef) {
  return (definitions.definitions || []).find(item => item.category === 'read_display' && item.operation_ref === operationRef);
}

function mappingFor(manifest, operationRef) {
  return (manifest.mappings || []).find(item => item.operation_ref === operationRef);
}

function declaredPaths(definition) {
  const data = definition?.data || {};
  return new Set([
    ...(data.scalar_fields || []).map(field => field.path),
    ...(data.containers || []).flatMap(container => (container.fields || []).map(field => field.path)),
  ]);
}

function declaredResponseRoots(definition) {
  return [...declaredPaths(definition)].map(fieldPath => /^\$\.([A-Za-z0-9_]+)/.exec(fieldPath)?.[1]).filter(Boolean);
}

export function parseArgs(argv) {
  const options = {
    execute: false,
    baseUrl: process.env.ATHENA_BACKEND_URL || DEFAULT_BASE_URL,
    outputDir: DEFAULT_OUTPUT_DIR,
    rateMs: 250,
    requestTimeoutMs: 5000,
    overallTimeoutMs: 60000,
    now: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute') options.execute = true;
    else if (arg === '--base-url') options.baseUrl = argv[++index];
    else if (arg === '--output-dir') options.outputDir = path.resolve(argv[++index]);
    else if (arg === '--rate-ms') options.rateMs = Number(argv[++index]);
    else if (arg === '--request-timeout-ms') options.requestTimeoutMs = Number(argv[++index]);
    else if (arg === '--overall-timeout-ms') options.overallTimeoutMs = Number(argv[++index]);
    else if (arg === '--now') options.now = new Date(argv[++index]);
    else if (arg === '--help') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isFinite(options.rateMs) || options.rateMs < 0 || options.rateMs > 5000) throw new Error('--rate-ms must be between 0 and 5000');
  if (!Number.isFinite(options.requestTimeoutMs) || options.requestTimeoutMs <= 0 || options.requestTimeoutMs > 5000) throw new Error('--request-timeout-ms must be between 1 and 5000');
  if (!Number.isFinite(options.overallTimeoutMs) || options.overallTimeoutMs <= 0 || options.overallTimeoutMs > 60000) throw new Error('--overall-timeout-ms must be between 1 and 60000');
  if (options.now && Number.isNaN(options.now.getTime())) throw new Error('--now must be an ISO timestamp');
  if (options.execute && options.now) throw new Error('--now is not allowed with --execute');
  return options;
}

export async function loadSources() {
  const [manifest, definitions, inventory] = await Promise.all(Object.values(SOURCE_FILES).map(async file => JSON.parse(await readFile(file, 'utf8'))));
  return { manifest, definitions, inventory };
}

export function buildChainPlan(sources, now = new Date()) {
  const readPlan = buildReadPlan(sources, now);
  const byRef = new Map(readPlan.operations.map(item => [item.operationRef, item]));
  const inventoryById = new Map(inventoryOperations(sources.inventory).map(item => [item.id, item]));
  const operationRefs = new Set();
  const chains = CHAINS.map(chain => {
    const source = byRef.get(chain.sourceRef);
    if (!source || source.planStatus !== 'ELIGIBLE') throw new Error(`source contract mismatch: ${chain.sourceRef}`);
    const sourceDefinition = definitionFor(sources.definitions, chain.sourceRef);
    if (!sourceDefinition || !declaredPaths(sourceDefinition).has(chain.sourcePath)) throw new Error(`source response path contract mismatch: ${chain.sourceRef} ${chain.sourcePath}`);
    const sourceMapping = mappingFor(sources.manifest, chain.sourceRef);
    assertExactRoute(sourceMapping?.route, source.route, chain, `source ${chain.sourceRef}`);
    operationRefs.add(chain.sourceRef);
    const targets = chain.targets.map(spec => {
      const target = byRef.get(spec.operationRef);
      if (!target || target.planStatus !== 'BLOCKED_INPUT' || target.missing.length !== 1 || target.missing[0].field !== spec.field) throw new Error(`target input plan mismatch: ${spec.operationRef}`);
      const operation = inventoryById.get(target.trId);
      const field = operation?.req_body?.find(item => normalizeFieldName(item) === spec.field);
      if (!field || field.required !== spec.required || String(field.length) !== spec.length || String(field.desc || '').trim() !== spec.description) throw new Error(`target field contract mismatch: ${spec.operationRef}.${spec.field}`);
      const mapping = mappingFor(sources.manifest, spec.operationRef);
      assertExactRoute(mapping?.route, target.route, spec, `target ${spec.operationRef}`);
      const targetDefinition = definitionFor(sources.definitions, spec.operationRef);
      if (!targetDefinition) throw new Error(`missing read_display definition: ${spec.operationRef}`);
      operationRefs.add(spec.operationRef);
      return {
        operationRef: spec.operationRef,
        trId: target.trId,
        route: target.route,
        requiredFields: [...target.requiredFields],
        dependencyField: spec.field,
        dependencyMaxLength: Number(spec.length),
        basePayload: { ...target.payload },
        responseRoots: declaredResponseRoots(targetDefinition),
        inputEvidence: [...target.inputEvidence, { field: spec.field, source: `${chain.sourceRef}:${chain.sourcePath}` }],
      };
    });
    return {
      sourceRef: chain.sourceRef,
      sourceTrId: source.trId,
      sourcePath: chain.sourcePath,
      route: source.route,
      requiredFields: [...source.requiredFields],
      payload: { ...source.payload },
      targets,
    };
  });
  if (operationRefs.size !== 11 || chains.reduce((sum, chain) => sum + chain.targets.length, 0) !== 7) throw new Error('chain scope must remain exactly 4 sources and 7 targets');
  return { sourceCounts: readPlan.sourceCounts, chains };
}

function assertExactRoute(manifestRoute, plannedRoute, expected, label) {
  const routes = [manifestRoute, plannedRoute];
  for (const route of routes) {
    const actualOperationId = route?.operation_id ?? route?.operationId;
    if (!route || route.method !== 'POST' || route.path !== expected.path || actualOperationId !== expected.operationId) {
      throw new Error(`unsafe exact route: ${label}`);
    }
    if (/[\\%?#]/.test(route.path) || route.path.includes('..') || !/^\/api\/v1\/tr\/[a-z0-9_-]+\/ka\d{5}$/.test(route.path)) throw new Error(`unsafe exact route encoding: ${label}`);
    const canonical = new URL(route.path, 'http://127.0.0.1:8010');
    if (canonical.pathname !== route.path || canonical.search || canonical.hash) throw new Error(`non-canonical route: ${label}`);
  }
}

function dereferenceSchema(openapi, schema) {
  let current = schema;
  const seen = new Set();
  while (current?.$ref) {
    if (!current.$ref.startsWith('#/')) throw new Error('external OpenAPI refs are forbidden');
    if (seen.has(current.$ref)) throw new Error('cyclic OpenAPI ref');
    seen.add(current.$ref);
    current = current.$ref.slice(2).split('/').reduce((value, key) => value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], openapi);
    if (!current) throw new Error('missing OpenAPI ref');
  }
  return current || {};
}

export function validateOpenApi(openapi, plan) {
  for (const chain of plan.chains) {
    for (const operation of [{ operationRef: chain.sourceRef, trId: chain.sourceTrId, route: chain.route, payload: chain.payload, requiredFields: chain.requiredFields }, ...chain.targets]) {
      const endpoint = openapi.paths?.[operation.route.path]?.post;
      if (!endpoint || endpoint.operationId !== operation.route.operationId || endpoint['x-kiwoom-tr-id'] !== operation.trId) throw new Error(`OpenAPI operation mismatch: ${operation.operationRef}`);
      const schema = dereferenceSchema(openapi, endpoint.requestBody?.content?.['application/json']?.schema || {});
      const required = [...new Set(schema.required || [])].sort();
      const expectedRequired = [...new Set(operation.requiredFields || [])].sort();
      if (required.length !== expectedRequired.length || required.some((field, index) => field !== expectedRequired[index])) throw new Error(`OpenAPI required fields mismatch: ${operation.operationRef}`);
      if (operation.dependencyField && !required.includes(operation.dependencyField)) throw new Error(`OpenAPI dependency field missing: ${operation.operationRef}.${operation.dependencyField}`);
    }
  }
}

function valuesAtPath(body, fieldPath) {
  const match = /^\$\.([A-Za-z0-9_]+)(\[\*\])?\.([A-Za-z0-9_]+)$/.exec(fieldPath);
  if (match) {
    const container = body?.[match[1]];
    if (!Array.isArray(container)) return [];
    return container.map(item => item?.[match[3]]);
  }
  const scalar = /^\$\.([A-Za-z0-9_]+)$/.exec(fieldPath);
  return scalar ? [body?.[scalar[1]]] : [];
}

function usableDependencyValues(body, fieldPath, maxLength) {
  return valuesAtPath(body, fieldPath)
    .map(value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '')
    .filter(value => value.length > 0 && value.length <= maxLength);
}

function returnCode(body) {
  const value = body?.return_code ?? body?.rtcd;
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return /^[+-]?\d{1,6}$/.test(text) ? text : 'INVALID';
}

function isAuthFailure(status, body) {
  return status === 401 || status === 403 || ['401', '403'].includes(returnCode(body));
}

function safeRevision() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

function kstTimestamp(now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).filter(part => part.type !== 'literal').reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}KST`;
}

async function readJsonResponse(response, limit) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Error('RESPONSE_TOO_LARGE');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > limit) throw new Error('RESPONSE_TOO_LARGE');
  try { return JSON.parse(text); } catch { throw new Error('RESPONSE_NOT_JSON'); }
}

async function requestJson(url, options, timeoutMs, deadline, limit) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('OVERALL_TIMEOUT');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, remaining));
  try {
    const response = await fetch(url, { ...options, redirect: 'error', signal: controller.signal });
    if (response.url && response.url !== url) throw new Error('REDIRECTED_RESPONSE');
    return { response, body: await readJsonResponse(response, limit) };
  } finally { clearTimeout(timer); }
}

function sourceResult(chain, attemptedAt, phase, response, body, values) {
  const code = returnCode(body);
  let verdict = 'BLOCKED';
  let reason = 'BLOCKED_SOURCE_SCHEMA';
  if (isAuthFailure(response.status, body)) reason = 'BLOCKED_AUTH';
  else if (!response.ok) reason = 'SOURCE_HTTP_FAILURE';
  else if (code !== '0') reason = code === null ? 'BLOCKED_SOURCE_RETURN_CODE_MISSING' : 'SOURCE_BUSINESS_FAILURE';
  else if (values.length === 0) reason = 'BLOCKED_SOURCE_EMPTY_OR_INVALID';
  else { verdict = 'PASS'; reason = 'SOURCE_VALUE_OBSERVED_IN_MEMORY'; }
  return { operationRef: chain.sourceRef, role: 'SOURCE', attempted: true, attemptedAt, marketPhase: phase, httpStatus: response.status, returnCode: code, verdict, reason, observedValueCount: values.length, persistedValue: false, pagination: 'NOT_VERIFIED_SINGLE_PAGE', freshness: 'NOT_VERIFIED' };
}

function blockedTarget(target, reason) {
  return { operationRef: target.operationRef, role: 'TARGET', attempted: false, verdict: 'BLOCKED', reason, pagination: 'NOT_VERIFIED', freshness: 'NOT_VERIFIED' };
}

function targetResult(target, attemptedAt, phase, response, body) {
  const code = returnCode(body);
  let verdict = 'BLOCKED';
  let reason = 'BLOCKED_RESPONSE_SCHEMA';
  if (isAuthFailure(response.status, body)) reason = 'BLOCKED_AUTH';
  else if (!response.ok) reason = 'TARGET_HTTP_FAILURE';
  else if (!body || typeof body !== 'object' || Array.isArray(body) || !target.responseRoots.some(root => Object.hasOwn(body, root))) reason = 'BLOCKED_RESPONSE_SCHEMA';
  else if (code !== '0') reason = code === null ? 'BLOCKED_TARGET_RETURN_CODE_MISSING' : 'TARGET_BUSINESS_FAILURE';
  else { verdict = 'PASS'; reason = 'PASS_HTTP_JSON_DECLARED_ROOT_PRESENT'; }
  return { operationRef: target.operationRef, role: 'TARGET', attempted: true, attemptedAt, marketPhase: phase, httpStatus: response.status, returnCode: code, verdict, reason, pagination: 'NOT_VERIFIED_SINGLE_PAGE', freshness: 'NOT_VERIFIED' };
}

export async function runChain(options, sources, dependencies = {}) {
  const now = options.now || new Date();
  const baseUrl = assertLoopbackBaseUrl(options.baseUrl || DEFAULT_BASE_URL);
  const rateMs = options.rateMs ?? 250;
  if (!Number.isFinite(rateMs) || rateMs < 0 || rateMs > 5000) throw new Error('rateMs must be between 0 and 5000');
  const overallTimeoutMs = options.overallTimeoutMs ?? 60000;
  if (!Number.isFinite(overallTimeoutMs) || overallTimeoutMs <= 0 || overallTimeoutMs > 60000) throw new Error('overallTimeoutMs must be between 1 and 60000');
  const plan = buildChainPlan(sources, now);
  const requestLimit = Math.min(dependencies.requestLimit ?? REQUEST_LIMIT, REQUEST_LIMIT);
  const report = {
    schemaVersion: 1,
    mode: options.execute ? 'loopback_live' : 'dry_run',
    generatedAt: now.toISOString(),
    revision: dependencies.revision === undefined ? safeRevision() : dependencies.revision,
    marketPhaseAtStart: marketPhase(now),
    scope: { sourceOperations: 4, targetOperations: 7, maxBusinessRequests: requestLimit, pagesPerOperation: 1 },
    sourceCounts: plan.sourceCounts,
    results: [],
    summary: null,
  };
  if (!options.execute) {
    report.results = plan.chains.flatMap(chain => [
      { operationRef: chain.sourceRef, role: 'SOURCE', attempted: false, verdict: 'NOT_RUN', reason: 'DRY_RUN' },
      ...chain.targets.map(target => ({ operationRef: target.operationRef, role: 'TARGET', attempted: false, verdict: 'NOT_RUN', reason: 'DRY_RUN_DEPENDENCY_CHAIN' })),
    ]);
    report.summary = summarize(report.results, 0, 0);
    return report;
  }

  const clock = dependencies.clock || (() => new Date());
  const sleep = dependencies.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const deadline = Date.now() + overallTimeoutMs;
  let metadataRequests = 0;
  let businessRequests = 0;
  const openapiUrl = `${baseUrl}/openapi.json`;
  const metadata = await requestJson(openapiUrl, { method: 'GET' }, Math.min(options.requestTimeoutMs ?? 5000, 5000), deadline, OPENAPI_LIMIT);
  metadataRequests += 1;
  if (!metadata.response.ok) throw new Error('OpenAPI metadata request failed');
  validateOpenApi(metadata.body, plan);
  const tokenReader = dependencies.tokenReader || (() => process.env[TOKEN_ENV]);
  const token = tokenReader();
  if (!token || !String(token).trim()) throw new Error(`${TOKEN_ENV} is required for --execute`);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${String(token).trim()}` };
  let authBlocked = false;

  const call = async (operation, payload) => {
    if (businessRequests >= requestLimit) throw new Error('REQUEST_BUDGET_EXCEEDED');
    if (businessRequests > 0 && rateMs > 0) {
      if (rateMs >= deadline - Date.now()) throw new Error('OVERALL_TIMEOUT_BEFORE_RATE_DELAY');
      await sleep(rateMs);
    }
    businessRequests += 1;
    const attemptedAt = clock();
    try {
      const result = await requestJson(`${baseUrl}${operation.route.path}`, { method: 'POST', headers, body: JSON.stringify(payload) }, Math.min(options.requestTimeoutMs ?? 5000, 5000), deadline, BODY_LIMIT);
      return { ...result, attemptedAt: attemptedAt.toISOString(), phase: marketPhase(attemptedAt) };
    } catch (error) {
      error.attemptedAt = attemptedAt.toISOString();
      error.marketPhase = marketPhase(attemptedAt);
      throw error;
    }
  };

  for (const chain of plan.chains) {
    if (authBlocked) {
      report.results.push({ operationRef: chain.sourceRef, role: 'SOURCE', attempted: false, verdict: 'BLOCKED', reason: 'BLOCKED_AUTH_NOT_ATTEMPTED' });
      report.results.push(...chain.targets.map(target => blockedTarget(target, 'BLOCKED_AUTH_NOT_ATTEMPTED')));
      continue;
    }
    let sourceCall;
    try { sourceCall = await call(chain, chain.payload); }
    catch (error) {
      if (['REQUEST_BUDGET_EXCEEDED', 'OVERALL_TIMEOUT_BEFORE_RATE_DELAY'].includes(error?.message)) throw error;
      report.results.push({ operationRef: chain.sourceRef, role: 'SOURCE', attempted: true, attemptedAt: error.attemptedAt || null, marketPhase: error.marketPhase || null, verdict: 'BLOCKED', reason: String(error?.message || '').startsWith('RESPONSE_') ? String(error.message) : 'TRANSPORT_ERROR' });
      report.results.push(...chain.targets.map(target => blockedTarget(target, 'BLOCKED_SOURCE_UNAVAILABLE')));
      continue;
    }
    const maxLength = Math.max(...chain.targets.map(target => target.dependencyMaxLength));
    const values = usableDependencyValues(sourceCall.body, chain.sourcePath, maxLength);
    const source = sourceResult(chain, sourceCall.attemptedAt, sourceCall.phase, sourceCall.response, sourceCall.body, values);
    report.results.push(source);
    if (source.reason === 'BLOCKED_AUTH') authBlocked = true;
    if (source.verdict !== 'PASS') {
      report.results.push(...chain.targets.map(target => blockedTarget(target, source.reason === 'BLOCKED_AUTH' ? 'BLOCKED_AUTH_NOT_ATTEMPTED' : 'BLOCKED_SOURCE_VALUE_NOT_AVAILABLE')));
      continue;
    }
    const dependencyValue = values[0];
    for (const target of chain.targets) {
      if (authBlocked) { report.results.push(blockedTarget(target, 'BLOCKED_AUTH_NOT_ATTEMPTED')); continue; }
      if (dependencyValue.length > target.dependencyMaxLength) { report.results.push(blockedTarget(target, 'BLOCKED_SOURCE_VALUE_INVALID_FOR_TARGET')); continue; }
      try {
        const targetCall = await call(target, { ...target.basePayload, [target.dependencyField]: dependencyValue });
        const result = targetResult(target, targetCall.attemptedAt, targetCall.phase, targetCall.response, targetCall.body);
        report.results.push(result);
        if (result.reason === 'BLOCKED_AUTH') authBlocked = true;
      } catch (error) {
        if (['REQUEST_BUDGET_EXCEEDED', 'OVERALL_TIMEOUT_BEFORE_RATE_DELAY'].includes(error?.message)) throw error;
        report.results.push({ ...blockedTarget(target, String(error?.message || '').startsWith('RESPONSE_') ? String(error.message) : 'TRANSPORT_ERROR'), attempted: true, attemptedAt: error.attemptedAt || null, marketPhase: error.marketPhase || null });
      }
    }
  }
  report.summary = summarize(report.results, businessRequests, metadataRequests);
  return report;
}

function summarize(results, businessRequests, metadataRequests) {
  return {
    total: results.length,
    sources: results.filter(item => item.role === 'SOURCE').length,
    targets: results.filter(item => item.role === 'TARGET').length,
    attempted: results.filter(item => item.attempted).length,
    pass: results.filter(item => item.verdict === 'PASS').length,
    blocked: results.filter(item => item.verdict === 'BLOCKED').length,
    notRun: results.filter(item => item.verdict === 'NOT_RUN').length,
    businessRequestCount: businessRequests,
    metadataRequestCount: metadataRequests,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node read-input-chain.mjs [--execute] [--base-url http://127.0.0.1:8010] [--output-dir DIR]');
    return;
  }
  const report = await runChain(options, await loadSources());
  await mkdir(options.outputDir, { recursive: true });
  const outputPath = path.join(options.outputDir, `read-input-chain-${kstTimestamp(new Date())}.json`);
  if (existsSync(outputPath)) throw new Error('refusing to overwrite an existing report');
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({ outputPath, mode: report.mode, summary: report.summary }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
