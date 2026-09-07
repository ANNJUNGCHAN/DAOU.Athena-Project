#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_MANIFEST = path.join(ROOT, 'backend', 'ref', 'kiwoom-common-screen-manifest.json');
const DEFAULT_DEFINITIONS = path.join(ROOT, 'backend', 'ref', 'kiwoom-screen-definitions.json');
const DEFAULT_INVENTORY = path.join(ROOT, 'backend', 'ref', 'kiwoom-tr-inventory.json');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'artifacts', 'market-session-audit', '2026-09-07');
const DEFAULT_BASE_URL = 'http://127.0.0.1:8010';
const TOKEN_ENV = 'ATHENA_LOCAL_BEARER_TOKEN';
const BLOCKED_DYNAMIC_FIELDS = new Map([
  ['arn_grp_id', 'ka01300 응답의 관심종목 그룹 코드가 필요함'],
  ['etfobjt_idex_cd', '원천 계약에 유효값 설명이 없음'],
  ['mmcm_cd', 'ka10102 응답의 현재 회원사 코드가 필요함'],
  ['ord_no', '실제 주문번호가 필요함'],
  ['thema_grp_cd', '테마 목록 조회 결과의 현재 그룹 코드가 필요함'],
  ['uv', '조회 시점의 유효 단가가 필요함'],
]);
const SENSITIVE_KEY = /(acct|account|token|secret|authorization|password|passwd|credential|appkey)/i;
const DATE_KEY = /(^|_)(dt|date)$/i;
const TIME_KEY = /(^|_)(tm|time)$/i;
const OPERATION_SPECIFIC_INPUTS = new Map([
  ['ka10019', new Map([
    ['tm_tp', { value: '1', length: '1', description: '1:분전, 2:일전', source: 'ka10019_contract_one_minute' }],
    ['tm', { value: '1', length: '2', description: '분 혹은 일입력', source: 'ka10019_contract_one_minute' }],
  ])],
  ['ka10021', new Map([
    ['tm_tp', { value: '1', length: '2', description: '분 입력', source: 'ka10021_contract_one_minute' }],
  ])],
  ['ka10022', new Map([
    ['tm_tp', { value: '1', length: '2', description: '분 입력', source: 'ka10022_contract_one_minute' }],
  ])],
  ['ka10025', new Map([
    ['prpscnt', { value: '1', length: '2', description: '숫자입력', source: 'ka10025_contract_minimum_positive_count' }],
  ])],
]);

export function parseArgs(argv) {
  const options = {
    execute: false,
    baseUrl: process.env.ATHENA_BACKEND_URL || DEFAULT_BASE_URL,
    rateMs: 1000,
    timeoutMs: 15000,
    maxPages: 5,
    outputDir: DEFAULT_OUTPUT_DIR,
    now: null,
    onlyOperationRefs: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute') options.execute = true;
    else if (arg === '--base-url') options.baseUrl = argv[++index];
    else if (arg === '--rate-ms') options.rateMs = Number(argv[++index]);
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg === '--max-pages') options.maxPages = Number(argv[++index]);
    else if (arg === '--output-dir') options.outputDir = path.resolve(argv[++index]);
    else if (arg === '--now') options.now = new Date(argv[++index]);
    else if (arg === '--only-operation-ref') options.onlyOperationRefs.push(argv[++index]);
    else if (arg === '--help') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isFinite(options.rateMs) || options.rateMs < 0) throw new Error('--rate-ms must be >= 0');
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('--timeout-ms must be > 0');
  if (!Number.isInteger(options.maxPages) || options.maxPages <= 0) throw new Error('--max-pages must be a positive integer');
  if (options.now && Number.isNaN(options.now.getTime())) throw new Error('--now must be an ISO timestamp');
  if (options.execute && options.now) throw new Error('--now is not allowed with --execute');
  if (options.onlyOperationRefs.some(ref => !ref)) throw new Error('--only-operation-ref requires a value');
  return options;
}

export function assertLoopbackBaseUrl(raw) {
  const url = new URL(raw);
  const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (url.protocol !== 'http:' || !loopback.has(url.hostname) || url.port !== '8010' || url.username || url.password) {
    throw new Error('base URL must be unauthenticated loopback HTTP on port 8010');
  }
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('base URL must not contain a path, query, or fragment');
  return url.href.replace(/\/$/, '');
}

function kstParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  return Object.fromEntries(formatter.formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

function compactKstDate(now) {
  const parts = kstParts(now);
  return `${parts.year}${parts.month}${parts.day}`;
}

function previousKstDate(now, days = 30) {
  return compactKstDate(new Date(now.getTime() - days * 86400000));
}

export function marketPhase(now = new Date()) {
  const parts = kstParts(now);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (minutes >= 510 && minutes < 540) return 'PRE_OPEN_30M';
  if (minutes >= 540 && minutes < 930) return 'REGULAR';
  if (minutes >= 930 && minutes < 990) return 'POST_CLOSE_1H';
  return 'OUTSIDE_AUDIT_WINDOW';
}

function normalizeFieldName(field) {
  return String(field?.element || '').replace(/^[-\s]+/, '');
}

function operationSpecificContractIssue(operation) {
  const rules = OPERATION_SPECIFIC_INPUTS.get(operation.id);
  if (!rules) return null;
  const mismatch = [...rules].find(([name, expected]) => !operation.req_body.some(field => (
    field.required === 'Y'
    && normalizeFieldName(field) === name
    && String(field.length) === expected.length
    && String(field.desc || '').trim() === expected.description
  )));
  return mismatch ? `operation-specific safe input contract mismatch for ${operation.id}.${mismatch[0]}` : null;
}

function operationSpecificSeed(operation, fieldName) {
  const rules = OPERATION_SPECIFIC_INPUTS.get(operation.id);
  const rule = rules?.get(fieldName);
  if (!rule) return null;
  const contractIssue = operationSpecificContractIssue(operation);
  if (contractIssue) return { blocked: contractIssue };
  return { value: rule.value, source: rule.source };
}

function operationSeed(operation, field, now) {
  const name = normalizeFieldName(field);
  const description = String(field.desc || '').trim();
  if (BLOCKED_DYNAMIC_FIELDS.has(name)) return { blocked: BLOCKED_DYNAMIC_FIELDS.get(name) };
  const operationSpecific = operationSpecificSeed(operation, name);
  if (operationSpecific) return operationSpecific;
  if (name === 'stk_cd') {
    if (/M04020000|금\s*99\.99/.test(description) || operation.subcat === '금현물') return { value: 'M04020000', source: 'explicit_gold_seed' };
    if (/여러개의 종목코드/.test(description)) return { value: '005930|000660|069500', source: 'explicit_multi_instrument_seed' };
    if (operation.subcat === 'ETF') return { value: '069500', source: 'explicit_etf_seed' };
    return { value: '005930', source: 'explicit_stock_seed' };
  }
  if (['base_dt', 'date', 'ord_dt', 'qry_dt'].includes(name)) return { value: compactKstDate(now), source: 'current_kst_date' };
  if (['end_dt', 'to_dt'].includes(name)) return { value: compactKstDate(now), source: 'current_kst_date' };
  if (['fr_dt', 'start_dt', 'strt_dt'].includes(name)) return { value: previousKstDate(now), source: 'current_kst_date_minus_30d' };
  if (name === 'dt' && /^Y{3,4}MMDD/i.test(description)) return { value: compactKstDate(now), source: 'current_kst_date' };
  if (name === 'rank_end') return { value: '100', source: 'inventory_declared_range_end' };
  if (name === 'rank_strt') return { value: '0', source: 'inventory_declared_range_start' };
  if (name === 'skip_stk' && description.includes('000000000')) return { value: '000000000', source: 'inventory_declared_all_included_mask' };
  if (name === 'isscomp_cd' && description.includes('교보:001')) return { value: '001', source: 'inventory_declared_issuer_example' };
  if (name === 'date_tp' && /1일\s*~\s*99일/.test(description)) return { value: '1', source: 'inventory_declared_range_start' };
  if (name === 'max_trde_qty' || name === 'max_trde_prica') {
    const maximum = description.match(/(\d[\d,]*)\s*(?:주|백만원)?\s*이하/);
    if (maximum) return { value: maximum[1].replaceAll(',', ''), source: 'inventory_declared_maximum' };
  }
  if (name === 'min_trde_qty' || name === 'min_trde_prica') {
    const minimum = description.match(/(\d[\d,]*)\s*(?:주|백만원)?\s*이상/);
    if (minimum) return { value: minimum[1].replaceAll(',', ''), source: 'inventory_declared_minimum' };
  }
  if (/^\d+\s*(?:~|-)+\s*\d+/.test(description)) return { value: description.match(/^\d+/)[0], source: 'inventory_declared_range_start' };
  if (/^\d+\s+or\s+\d+/i.test(description)) return { value: description.match(/^\d+/)[0], source: 'inventory_declared_option' };
  const leadingCode = description.match(/^([%A-Za-z0-9_]+)\s*:/);
  if (leadingCode) return { value: leadingCode[1], source: 'inventory_first_declared_option' };
  const labelledCode = description.match(/^[^,:|]+:\s*([%A-Za-z0-9_]+)/);
  if (labelledCode) return { value: labelledCode[1], source: 'inventory_first_declared_option' };
  const example = description.match(/(?:예|예시)\s*[:(]?\s*([0-9]+)/);
  if (example) return { value: example[1], source: 'inventory_declared_example' };
  return { blocked: description ? '원천 설명에서 안전한 결정값을 확정할 수 없음' : '원천 계약에 유효값 설명이 없음' };
}

export function buildReadPlan({ manifest, definitions, inventory, now = new Date() }) {
  const allowedDefinitions = definitions.definitions.filter(item => item.category === 'read_display');
  const definitionRefs = new Set(allowedDefinitions.map(item => item.operation_ref));
  if (definitionRefs.size !== allowedDefinitions.length) throw new Error('duplicate read_display operation_ref in screen definitions');
  const manifestReads = manifest.mappings.filter(item => item.classification?.category === 'read_display');
  const manifestRefs = new Set(manifestReads.map(item => item.operation_ref));
  if (manifestRefs.size !== manifestReads.length) throw new Error('duplicate read_display operation_ref in route manifest');
  const missingManifest = [...definitionRefs].filter(ref => !manifestRefs.has(ref));
  const extraManifest = [...manifestRefs].filter(ref => !definitionRefs.has(ref));
  if (missingManifest.length || extraManifest.length) {
    throw new Error(`read_display source mismatch: missing=${missingManifest.length}, extra=${extraManifest.length}`);
  }
  const inventoryById = new Map(inventory.map(item => [item.id, item]));
  const operations = manifestReads.map(mapping => {
    const route = mapping.route || {};
    if (route.method !== 'POST' || !/^\/api\/v1\/tr\//.test(route.path || '')) {
      throw new Error(`unsafe read_display route ${mapping.operation_ref}: ${route.method || '?'} ${route.path || '?'}`);
    }
    if (!['query', 'query_detail'].includes(mapping.operation?.kind)) throw new Error(`non-query operation in read_display: ${mapping.operation_ref}`);
    const source = inventoryById.get(mapping.operation.tr_id);
    if (!source) throw new Error(`inventory missing ${mapping.operation.tr_id}`);
    const required = source.req_body.filter(field => field.required === 'Y' && !String(field.element).startsWith('-'));
    const payload = {};
    const inputEvidence = [];
    const missing = [];
    const operationContractIssue = operationSpecificContractIssue(source);
    if (operationContractIssue) {
      missing.push({
        field: [...OPERATION_SPECIFIC_INPUTS.get(source.id).keys()].join(','),
        reason: operationContractIssue,
        contract: 'exact operation-specific read input contract',
      });
    }
    for (const field of required) {
      const fieldName = normalizeFieldName(field);
      if (operationContractIssue && OPERATION_SPECIFIC_INPUTS.get(source.id)?.has(fieldName)) continue;
      const resolved = operationSeed(source, field, now);
      if ('value' in resolved) {
        payload[fieldName] = resolved.value;
        inputEvidence.push({ field: fieldName, source: resolved.source });
      } else {
        missing.push({ field: fieldName, reason: resolved.blocked, contract: String(field.desc || '').slice(0, 240) });
      }
    }
    return {
      operationRef: mapping.operation_ref,
      mappingType: mapping.mapping_type,
      trId: mapping.operation.tr_id,
      name: source.name,
      subcategory: source.subcat,
      route: { method: route.method, path: route.path, operationId: route.operation_id },
      requiredFields: required.map(normalizeFieldName),
      payload,
      inputEvidence,
      missing,
      freshnessContract: {
        basis: definitions.definitions.find(item => item.operation_ref === mapping.operation_ref)?.data?.time?.basis || 'missing',
        fieldPath: definitions.definitions.find(item => item.operation_ref === mapping.operation_ref)?.data?.time?.field_path || null,
      },
      planStatus: missing.length ? 'BLOCKED_INPUT' : 'ELIGIBLE',
    };
  });
  return {
    sourceCounts: {
      readDisplayDefinitions: allowedDefinitions.length,
      readDisplayManifestMappings: manifestReads.length,
      uniqueOperationRefs: definitionRefs.size,
    },
    operations,
  };
}

function safeReturnCode(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return /^[A-Za-z0-9_-]{0,32}$/.test(normalized) ? normalized : 'UNSAFE_VALUE_OMITTED';
}

function safeBodyEvidence(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { shape: typeof body, keys: [], nonEmptyValues: 0, listRows: 0, temporal: [] };
  let nonEmptyValues = 0;
  let listRows = 0;
  const temporal = [];
  let invalidTemporalValues = 0;
  const isValidDate = value => {
    if (!/^\d{8}$/.test(value)) return false;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  };
  const isValidTime = value => {
    if (!/^\d{4}(?:\d{2})?$/.test(value)) return false;
    const hour = Number(value.slice(0, 2));
    const minute = Number(value.slice(2, 4));
    const second = value.length === 6 ? Number(value.slice(4, 6)) : 0;
    return hour <= 23 && minute <= 59 && second <= 59;
  };
  const walk = (value, key = '', depth = 0, jsonPath = '$') => {
    if (depth > 5 || SENSITIVE_KEY.test(key)) return;
    if (Array.isArray(value)) {
      listRows += value.length;
      for (const item of value.slice(0, 20)) walk(item, key, depth + 1, `${jsonPath}[*]`);
    } else if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) walk(child, childKey, depth + 1, `${jsonPath}.${childKey}`);
    } else if (value !== null && value !== '') {
      if (!['return_code', 'return_msg'].includes(key)) nonEmptyValues += 1;
      if (DATE_KEY.test(key) || TIME_KEY.test(key)) {
        const canonical = String(value);
        const valid = DATE_KEY.test(key) ? isValidDate(canonical) : isValidTime(canonical);
        if (valid && temporal.length < 20) temporal.push({ field: key, path: jsonPath, value: canonical });
        else invalidTemporalValues += 1;
      }
    }
  };
  walk(body);
  return {
    shape: 'object',
    keys: Object.keys(body).filter(key => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) && !SENSITIVE_KEY.test(key)).slice(0, 60),
    nonEmptyValues,
    listRows,
    temporal,
    invalidTemporalValues,
  };
}

function freshnessEvidence(operation, evidence, now) {
  if (operation.freshnessContract?.basis !== 'declared_response_field') {
    return { state: 'NOT_VERIFIED_NO_DECLARED_TIME_CONTRACT', contractBasis: operation.freshnessContract?.basis || 'missing' };
  }
  const expectedPath = operation.freshnessContract.fieldPath;
  if (typeof expectedPath !== 'string' || !/^\$(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\*\])+$/.test(expectedPath)) {
    return { state: 'NOT_VERIFIED_UNSUPPORTED_TIME_PATH' };
  }
  const dates = evidence.temporal
    .filter(item => item.path === expectedPath)
    .map(item => item.value)
    .filter(value => /^\d{8}$/.test(value));
  if (!dates.length) return { state: 'NOT_VERIFIED_NO_VALID_SOURCE_DATE', fieldPath: operation.freshnessContract.fieldPath };
  const newest = dates.sort().at(-1);
  const today = compactKstDate(now);
  const sourceDateRelation = newest < today ? 'BEFORE_CURRENT_KST_DATE' : newest > today ? 'AFTER_CURRENT_KST_DATE' : 'CURRENT_KST_DATE';
  return {
    state: 'NOT_VERIFIED_NO_EXPECTED_DATE_POLICY',
    newestSourceDate: newest,
    currentKstDate: today,
    sourceDateRelation,
  };
}

function responseReturnCode(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.return_code === undefined) return null;
  return safeReturnCode(body.return_code);
}

function isAuthFailure(status, returnCode, returnMessage) {
  return status === 401 || status === 403 || /auth|token|인증|토큰/i.test(`${returnCode || ''} ${returnMessage || ''}`);
}

async function fetchJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, redirect: 'error' });
    if (response.url && new URL(response.url).href !== new URL(url).href) {
      const error = new Error('response URL changed');
      error.name = 'RedirectBoundaryError';
      throw error;
    }
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { response, body, elapsedMs: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

function dereferenceOpenApiSchema(openapi, schema) {
  if (!schema?.$ref) return schema;
  const prefix = '#/components/schemas/';
  if (!schema.$ref.startsWith(prefix)) return null;
  return openapi?.components?.schemas?.[schema.$ref.slice(prefix.length)] || null;
}

function validateLiveOpenApi(openapi, operation) {
  const route = openapi?.paths?.[operation.route.path]?.post;
  if (!route) return 'OPENAPI_ROUTE_MISSING';
  if (route.operationId !== operation.route.operationId) return 'OPENAPI_OPERATION_ID_MISMATCH';
  if (route['x-kiwoom-tr-id'] !== operation.trId) return 'OPENAPI_TR_ID_MISMATCH';
  if (route['x-athena-operation-kind'] === 'order' || route['x-athena-operation-kind'] === 'internal-oauth') return 'OPENAPI_MUTATOR_CLASSIFICATION';
  const requestSchema = dereferenceOpenApiSchema(openapi, route.requestBody?.content?.['application/json']?.schema);
  if (!requestSchema) return 'OPENAPI_REQUEST_SCHEMA_MISSING';
  const liveRequired = [...(requestSchema.required || [])].sort();
  const sourceRequired = [...operation.requiredFields].sort();
  if (JSON.stringify(liveRequired) !== JSON.stringify(sourceRequired)) {
    return 'OPENAPI_REQUIRED_FIELDS_MISMATCH';
  }
  return null;
}

function currentRevision() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

async function readBearerToken() {
  const direct = String(process.env[TOKEN_ENV] || '').trim();
  if (direct) return direct;
  const envPath = path.join(ROOT, 'backend', '.env');
  if (!existsSync(envPath)) return null;
  const contents = await readFile(envPath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*ATHENA_LOCAL_BEARER_TOKEN\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    return match[1].replace(/^(['"])(.*)\1$/, '$2').trim() || null;
  }
  return null;
}

function timestampForFile(now) {
  const p = kstParts(now);
  return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}KST`;
}

export async function runSweep(options, sources = {}) {
  const clock = options.clock || (() => options.now || new Date());
  const now = options.now || clock();
  const maxPages = options.maxPages ?? 5;
  const baseUrl = assertLoopbackBaseUrl(options.baseUrl);
  const manifest = sources.manifest || JSON.parse(await readFile(DEFAULT_MANIFEST, 'utf8'));
  const definitions = sources.definitions || JSON.parse(await readFile(DEFAULT_DEFINITIONS, 'utf8'));
  const inventory = sources.inventory || JSON.parse(await readFile(DEFAULT_INVENTORY, 'utf8'));
  const plan = buildReadPlan({ manifest, definitions, inventory, now });
  const requestedOperationRefs = options.onlyOperationRefs || [];
  const requestedRefSet = new Set(requestedOperationRefs);
  if (requestedRefSet.size !== requestedOperationRefs.length) throw new Error('duplicate --only-operation-ref');
  const fullOperationRefs = plan.operations.map(operation => operation.operationRef);
  const fullOperationRefSet = new Set(fullOperationRefs);
  const unknownOperationRefs = requestedOperationRefs.filter(ref => !fullOperationRefSet.has(ref));
  if (unknownOperationRefs.length) throw new Error(`unknown or non-read operation_ref: ${unknownOperationRefs.join(', ')}`);
  const selectedOperations = requestedOperationRefs.length
    ? plan.operations.filter(operation => requestedRefSet.has(operation.operationRef))
    : plan.operations;
  const results = [];
  let authStopped = false;
  let openapi = null;
  let openapiError = null;
  const token = options.execute ? await readBearerToken() : null;
  const headers = { 'Content-Type': 'application/json', 'X-Athena-Caller': 'market-session-audit' };
  if (token) headers.Authorization = `Bearer ${token}`;

  if (options.execute) {
    try {
      const loaded = await fetchJson(`${baseUrl}/openapi.json`, { method: 'GET', headers: token ? { Authorization: `Bearer ${token}` } : {} }, options.timeoutMs);
      if (!loaded.response.ok) openapiError = { code: 'OPENAPI_HTTP_ERROR', httpStatus: loaded.response.status };
      else if (!loaded.body) openapiError = { code: 'OPENAPI_INVALID_JSON', httpStatus: loaded.response.status };
      else openapi = loaded.body;
    } catch (error) {
      openapiError = { code: error.name === 'AbortError' ? 'OPENAPI_TIMEOUT' : 'OPENAPI_TRANSPORT_ERROR' };
    }
  }

  for (const operation of selectedOperations) {
    if (operation.planStatus === 'BLOCKED_INPUT') {
      results.push({ ...operation, payload: undefined, verdict: 'BLOCKED', reason: 'BLOCKED_INPUT' });
      continue;
    }
    if (!options.execute) {
      results.push({ ...operation, payload: undefined, verdict: 'NOT_RUN', reason: 'DRY_RUN_ELIGIBLE' });
      continue;
    }
    if (openapiError) {
      results.push({ ...operation, payload: undefined, verdict: 'BLOCKED', reason: 'BLOCKED_OPENAPI', evidence: openapiError });
      continue;
    }
    const openapiMismatch = validateLiveOpenApi(openapi, operation);
    if (openapiMismatch) {
      results.push({ ...operation, payload: undefined, verdict: 'BLOCKED', reason: 'BLOCKED_OPENAPI_ROUTE', evidence: openapiMismatch });
      continue;
    }
    if (authStopped) {
      results.push({ ...operation, payload: undefined, verdict: 'BLOCKED', reason: 'BLOCKED_AUTH_NOT_ATTEMPTED' });
      continue;
    }
    let attemptedAt = null;
    let operationMarketPhase = null;
    try {
      const pages = [];
      const temporal = [];
      let totalNonEmptyValues = 0;
      let totalListRows = 0;
      let invalidTemporalValues = 0;
      let nextKey = null;
      let paginationState = 'COMPLETE';
      const seenNextKeys = new Set();
      let loaded = null;
      let returnCode = null;
      let authMessage = '';
      let lastPageNow = now;
      for (let page = 1; page <= maxPages; page += 1) {
        if (results.some(item => item.attemptedAt) || pages.length) await new Promise(resolve => setTimeout(resolve, options.rateMs));
        const pageNow = clock();
        lastPageNow = pageNow;
        if (!attemptedAt) {
          attemptedAt = pageNow.toISOString();
          operationMarketPhase = marketPhase(pageNow);
        }
        const pageHeaders = { ...headers };
        if (nextKey) {
          pageHeaders['cont-yn'] = 'Y';
          pageHeaders['next-key'] = nextKey;
        }
        loaded = await fetchJson(`${baseUrl}${operation.route.path}`, { method: 'POST', headers: pageHeaders, body: JSON.stringify(operation.payload) }, options.timeoutMs);
        returnCode = responseReturnCode(loaded.body);
        authMessage = loaded.body && typeof loaded.body === 'object' ? String(loaded.body.return_msg || loaded.body.detail || '') : '';
        const pageEvidence = safeBodyEvidence(loaded.body);
        totalNonEmptyValues += pageEvidence.nonEmptyValues;
        totalListRows += pageEvidence.listRows;
        invalidTemporalValues += pageEvidence.invalidTemporalValues;
        temporal.push(...pageEvidence.temporal);
        const rawContYn = loaded.response.headers.get('cont-yn');
        const contYn = rawContYn;
        const validContYn = contYn === 'N' || contYn === 'Y';
        const responseNextKey = loaded.response.headers.get('next-key') || null;
        pages.push({ page, observedAt: pageNow.toISOString(), marketPhase: marketPhase(pageNow), httpStatus: loaded.response.status, returnCode, elapsedMs: loaded.elapsedMs, evidence: pageEvidence, continuation: { contYn: validContYn ? contYn : 'INVALID', hasNextKey: Boolean(responseNextKey) } });
        if (isAuthFailure(loaded.response.status, returnCode, authMessage) || !loaded.response.ok || (returnCode !== null && !['', '0'].includes(returnCode))) break;
        if (!validContYn) { paginationState = 'INCOMPLETE_INVALID_CONT_YN'; break; }
        if (contYn !== 'Y') break;
        if (!responseNextKey) { paginationState = 'INCOMPLETE_MISSING_NEXT_KEY'; break; }
        if (seenNextKeys.has(responseNextKey)) { paginationState = 'INCOMPLETE_REPEATED_NEXT_KEY'; break; }
        seenNextKeys.add(responseNextKey);
        nextKey = responseNextKey;
        if (page === maxPages) paginationState = 'INCOMPLETE_PAGE_LIMIT';
      }
      const evidence = { nonEmptyValues: totalNonEmptyValues, listRows: totalListRows, temporal: temporal.slice(0, 100), invalidTemporalValues };
      const freshness = freshnessEvidence(operation, evidence, lastPageNow);
      let verdict = 'PASS';
      let reason = 'HTTP_AND_BUSINESS_SUCCESS';
      if (isAuthFailure(loaded.response.status, returnCode, authMessage)) {
        verdict = 'BLOCKED'; reason = 'BLOCKED_AUTH'; authStopped = true;
      } else if (!loaded.response.ok) {
        verdict = 'FAIL'; reason = 'HTTP_ERROR';
      } else if (returnCode !== null && !['', '0'].includes(returnCode)) {
        verdict = 'FAIL'; reason = 'BUSINESS_RETURN_CODE';
      } else if (evidence.nonEmptyValues === 0 && evidence.listRows === 0) {
        verdict = 'FAIL'; reason = 'DATA_ABSENT';
      } else if (paginationState !== 'COMPLETE') {
        verdict = 'BLOCKED'; reason = 'BLOCKED_PAGINATION_NOT_VERIFIED';
      } else if (freshness.state.startsWith('NOT_VERIFIED_')) {
        verdict = 'BLOCKED'; reason = 'BLOCKED_FRESHNESS_NOT_VERIFIED';
      }
      results.push({ ...operation, payload: undefined, attemptedAt, marketPhase: operationMarketPhase, finalPageMarketPhase: marketPhase(lastPageNow), verdict, reason, httpStatus: loaded.response.status, returnCode, responseEvidence: evidence, freshness, pagination: { state: paginationState, pagesFetched: pages.length, maxPages, pages } });
    } catch (error) {
      const failedAt = clock();
      results.push({ ...operation, payload: undefined, attemptedAt: attemptedAt || failedAt.toISOString(), marketPhase: operationMarketPhase || marketPhase(failedAt), verdict: 'FAIL', reason: error.name === 'AbortError' ? 'TIMEOUT' : 'TRANSPORT_ERROR' });
    }
  }

  const summary = {
    sourceOperationCount: plan.sourceCounts.uniqueOperationRefs,
    selectedOperationCount: selectedOperations.length,
    eligibleInputCount: selectedOperations.filter(item => item.planStatus === 'ELIGIBLE').length,
    blockedInputCount: selectedOperations.filter(item => item.planStatus === 'BLOCKED_INPUT').length,
    attemptedCount: results.filter(item => item.attemptedAt).length,
    verdicts: Object.fromEntries(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN'].map(verdict => [verdict, results.filter(item => item.verdict === verdict).length])),
  };
  if (summary.eligibleInputCount + summary.blockedInputCount !== summary.selectedOperationCount) throw new Error('coverage accounting invariant failed');
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    observedKstDate: compactKstDate(now),
    marketPhase: marketPhase(now),
    marketPhaseScope: 'SWEEP_START_ONLY',
    mode: options.execute ? 'loopback_live' : 'registry_dry_run',
    revision: process.env.GIT_COMMIT || currentRevision(),
    sources: {
      allowlist: path.relative(ROOT, DEFAULT_DEFINITIONS).replaceAll('\\', '/'),
      routeManifest: path.relative(ROOT, DEFAULT_MANIFEST).replaceAll('\\', '/'),
      inputContracts: path.relative(ROOT, DEFAULT_INVENTORY).replaceAll('\\', '/'),
      liveOpenApi: options.execute ? `${baseUrl}/openapi.json` : null,
      fixturesMixedWithLive: false,
    },
    safety: { loopbackBaseUrl: baseUrl, concurrency: 1, minimumIntervalMs: options.rateMs, timeoutMs: options.timeoutMs, maxPages, bearerPresent: Boolean(token), sensitiveResponseValuesStored: false },
    sourceCounts: plan.sourceCounts,
    scope: {
      filterApplied: requestedOperationRefs.length > 0,
      requestedOperationRefs,
      selectedOperationCount: selectedOperations.length,
      allSourceOperationRefs: fullOperationRefs,
    },
    summary,
    openapi: options.execute ? { loaded: Boolean(openapi), error: openapiError } : { loaded: false, reason: 'dry-run' },
    results,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/market-session-audit/read-sweep.mjs [--execute] [--only-operation-ref base:ka10001 ...] [--base-url http://127.0.0.1:8010] [--rate-ms 1000] [--timeout-ms 15000] [--max-pages 5]');
    return;
  }
  const report = await runSweep(options);
  await mkdir(options.outputDir, { recursive: true });
  const outputPath = path.join(options.outputDir, `read-sweep-${timestampForFile(options.now || new Date())}.json`);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: outputPath, mode: report.mode, marketPhase: report.marketPhase, summary: report.summary }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`[read-sweep] ${error instanceof Error ? error.name : 'Error'}`);
    process.exitCode = 1;
  });
}
