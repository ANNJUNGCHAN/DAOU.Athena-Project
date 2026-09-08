import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marketPhase } from './observer.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INVENTORY = path.join(ROOT, 'backend', 'ref', 'kiwoom-tr-inventory.json');
const MANIFEST = path.join(ROOT, 'backend', 'ref', 'kiwoom-common-screen-manifest.json');
const DEFINITIONS = path.join(ROOT, 'backend', 'ref', 'kiwoom-screen-definitions.json');
const ACCOUNT_HEADER = 'X-Athena-Account';
const REQUEST_LIMIT = 8;
const BUSINESS_LIMIT_BYTES = 1024 * 1024;
const OPENAPI_LIMIT_BYTES = 8 * 1024 * 1024;

const OPERATIONS = [
  { ref: 'base:ka10075', trId: 'ka10075', role: 'SOURCE_ORDER_HISTORY', path: '/api/v1/tr/account/ka10075', operationId: 'post_query_account_ka10075', required: ['all_stk_tp', 'trde_tp', 'stex_tp'], allowed: ['all_stk_tp', 'trde_tp', 'stk_cd', 'stex_tp'], payload: { all_stk_tp: '0', trde_tp: '0', stex_tp: '0' }, fields: ['ord_no', 'oso_qty'] },
  { ref: 'base:ka10088', trId: 'ka10088', role: 'TARGET', path: '/api/v1/tr/account/ka10088', operationId: 'post_query_account_ka10088', required: ['ord_no'], allowed: ['ord_no'], fields: ['osop'] },
  { ref: 'detail:ka10004:sell_bid_prices', trId: 'ka10004', role: 'SOURCE_BEST_ASK', path: '/api/v1/tr/quotes/ka10004/detail/sell_bid_prices', operationId: 'post_tr_quotes_ka10004_detail_sell_bid_prices', required: ['stk_cd'], allowed: ['stk_cd'], payload: { stk_cd: '005930' }, fields: ['sel_fpr_bid'] },
  { ref: 'detail:ka10001:current_trading', trId: 'ka10001', role: 'SOURCE_CURRENT_PRICE_FALLBACK', path: '/api/v1/tr/stockinfo/ka10001/detail/current_trading', operationId: 'post_tr_stockinfo_ka10001_detail_current_trading', required: ['stk_cd'], allowed: ['stk_cd'], payload: { stk_cd: '005930' }, fields: ['cur_prc'] },
  { ref: 'detail:kt00010:margin_order_capacity', trId: 'kt00010', role: 'TARGET', path: '/api/v1/tr/account/kt00010/detail/margin_order_capacity', operationId: 'post_tr_account_kt00010_detail_margin_order_capacity', required: ['stk_cd', 'trde_tp', 'uv'], allowed: ['io_amt', 'stk_cd', 'trde_tp', 'trde_qty', 'uv', 'exp_buy_unp'], fields: ['profa_20ord_alow_amt'] },
  { ref: 'detail:kt00010:cash_and_withdrawal_capacity', trId: 'kt00010', role: 'TARGET', path: '/api/v1/tr/account/kt00010/detail/cash_and_withdrawal_capacity', operationId: 'post_tr_account_kt00010_detail_cash_and_withdrawal_capacity', required: ['stk_cd', 'trde_tp', 'uv'], allowed: ['io_amt', 'stk_cd', 'trde_tp', 'trde_qty', 'uv', 'exp_buy_unp'], fields: ['ord_alowa'] },
  { ref: 'detail:kt00010:purchase_settlement', trId: 'kt00010', role: 'TARGET', path: '/api/v1/tr/account/kt00010/detail/purchase_settlement', operationId: 'post_tr_account_kt00010_detail_purchase_settlement', required: ['stk_cd', 'trde_tp', 'uv'], allowed: ['io_amt', 'stk_cd', 'trde_tp', 'trde_qty', 'uv', 'exp_buy_unp'], fields: ['pur_amt'] },
  { ref: 'base:ka30003', trId: 'ka30003', role: 'TARGET', path: '/api/v1/tr/elw/ka30003', operationId: 'post_query_elw_ka30003', required: ['bsis_aset_cd', 'base_dt'], allowed: ['bsis_aset_cd', 'base_dt'], fields: ['elwlpposs_daly_trnsn'] },
];

const TARGET_REFS = new Set(OPERATIONS.filter(op => op.role === 'TARGET').map(op => op.ref));

export function parseArgs(argv) {
  const options = { execute: false, baseUrl: process.env.ATHENA_BACKEND_URL || 'http://127.0.0.1:8010', outputDir: path.join(ROOT, 'artifacts', 'market-session-audit', '2026-09-07'), requestTimeoutMs: 5000, overallTimeoutMs: 60000, rateMs: 250 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute') options.execute = true;
    else if (arg === '--help') options.help = true;
    else if (['--base-url', '--output-dir', '--request-timeout-ms', '--overall-timeout-ms', '--rate-ms', '--now'].includes(arg)) options[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (options.execute && options.now) throw new Error('--now is not allowed with --execute');
  for (const [key, min, max] of [['requestTimeoutMs', 1, 5000], ['overallTimeoutMs', 1, 60000], ['rateMs', 0, 5000]]) {
    options[key] = Number(options[key]);
    if (!Number.isInteger(options[key]) || options[key] < min || options[key] > max) throw new Error(`${key} must be between ${min} and ${max}`);
  }
  if (options.now && Number.isNaN(new Date(options.now).getTime())) throw new Error('--now must be an ISO timestamp');
  return options;
}

export async function loadSources() {
  const [inventory, manifest, definitions] = await Promise.all([INVENTORY, MANIFEST, DEFINITIONS].map(async file => JSON.parse(await readFile(file, 'utf8'))));
  return { inventory, manifest, definitions };
}

function list(source, key) { return Array.isArray(source) ? source : source[key]; }
function exactSet(actual, expected) { return actual.length === expected.length && [...actual].sort().every((value, index) => value === [...expected].sort()[index]); }
function operation(source, trId) { return list(source.inventory, 'operations').find(item => item.id === trId); }
function definition(source, ref) { return list(source.definitions, 'definitions').find(item => item.operation_ref === ref); }
function mapping(source, ref) { return list(source.manifest, 'mappings').find(item => item.operation_ref === ref); }

function assertExactRoute(route, expected) {
  const rawPath = route?.path;
  const operationId = route?.operation_id ?? route?.operationId;
  if (typeof rawPath !== 'string' || rawPath !== expected.path || operationId !== expected.operationId) throw new Error(`unsafe exact route for ${expected.ref}`);
  if (!/^\/api\/v1\/tr\/[a-z0-9_]+\/[a-z0-9]+(?:\/detail\/[a-z0-9_]+)?$/.test(rawPath) || rawPath.includes('..') || /[%?#\\]/.test(rawPath)) throw new Error(`unsafe route syntax for ${expected.ref}`);
}

export function buildPlan(source, now = new Date()) {
  const routes = {};
  for (const expected of OPERATIONS) {
    const inv = operation(source, expected.trId);
    if (!inv || inv.method !== 'POST' || !String(inv.url).startsWith('/api/dostk/')) throw new Error(`inventory query contract missing for ${expected.ref}`);
    const req = inv.req_body || inv.request || [];
    const reqNames = req.map(field => field.element ?? field.alias ?? field.name);
    const requiredNames = req.filter(field => ['Y', true, 'true'].includes(field.required)).map(field => field.element ?? field.alias ?? field.name);
    if (!exactSet(requiredNames, expected.required)) throw new Error(`inventory required fields mismatch for ${expected.ref}`);
    for (const field of expected.required) {
      const contract = req.find(item => (item.element ?? item.alias ?? item.name) === field);
      if (!contract || !['Y', true, 'true'].includes(contract.required)) throw new Error(`required source contract drift for ${expected.ref}.${field}`);
    }
    if (!expected.allowed.every(field => reqNames.includes(field))) throw new Error(`request allowlist contract drift for ${expected.ref}`);
    const def = definition(source, expected.ref);
    if (!def || def.category !== 'read_display' || def.input?.read_only !== true) throw new Error(`read-only screen contract missing for ${expected.ref}`);
    const allowed = def.input?.field_allowlist?.top_level;
    if (!exactSet(allowed || [], expected.allowed)) throw new Error(`screen input allowlist drift for ${expected.ref}`);
    const available = new Set([
      ...(def.data?.scalar_field_allowlist || []),
      ...(def.data?.container_paths || []).map(value => String(value).replace(/^\$\./, '').replace(/\[\*\]$/, '')),
      ...(def.data?.containers || []).flatMap(container => (container.fields || []).map(field => field.alias)),
    ]);
    for (const field of expected.fields) if (!available.has(field)) throw new Error(`response field contract drift for ${expected.ref}.${field}`);
    const paths = new Map([
      ...(def.data?.scalar_fields || []).map(field => [field.alias, field.path]),
      ...(def.data?.containers || []).flatMap(container => (container.fields || []).map(field => [field.alias, field.path])),
    ]);
    for (const field of expected.fields) {
      const containerPaths = new Set(def.data?.container_paths || []);
      const expectedPath = expected.ref === 'base:ka10075' ? `$.oso[*].${field}` : `$.${field}`;
      if (!containerPaths.has(`$.${field}`) && !containerPaths.has(`$.${field}[*]`) && paths.get(field) !== expectedPath) throw new Error(`response path contract drift for ${expected.ref}.${field}`);
    }
    const manifestRoute = mapping(source, expected.ref)?.route;
    assertExactRoute(manifestRoute, expected);
    if (manifestRoute.method !== 'POST') throw new Error(`unsafe route method for ${expected.ref}`);
    routes[expected.ref] = { path: expected.path, operationId: expected.operationId };
  }
  const sibling = operation(source, 'ka30004');
  const underlying = (sibling?.req_body || []).find(field => (field.element ?? field.alias) === 'bsis_aset_cd');
  if (!String(underlying?.desc ?? underlying?.description ?? '').includes('005930')) throw new Error('ELW sibling underlying-code contract drift');
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).replaceAll('-', '');
  return { operations: OPERATIONS.map(op => ({ ...op, route: routes[op.ref] })), baseDate: date };
}

function dereferenceSchema(openapi, schema) {
  let current = schema;
  const seen = new Set();
  while (current?.$ref) {
    if (seen.has(current.$ref) || !current.$ref.startsWith('#/components/schemas/')) throw new Error('unsafe OpenAPI schema reference');
    seen.add(current.$ref);
    current = openapi.components?.schemas?.[current.$ref.split('/').at(-1)];
  }
  return current;
}

export function validateOpenApi(openapi, plan) {
  for (const expected of plan.operations) {
    const post = openapi.paths?.[expected.route.path]?.post;
    if (!post || post.operationId !== expected.route.operationId || post['x-kiwoom-tr-id'] !== expected.trId) throw new Error(`OpenAPI route contract mismatch for ${expected.ref}`);
    const schema = dereferenceSchema(openapi, post.requestBody?.content?.['application/json']?.schema);
    if (!schema || !exactSet(schema.required || [], expected.required)) throw new Error(`OpenAPI required fields mismatch for ${expected.ref}`);
    const properties = Object.keys(schema.properties || {});
    if (!exactSet(properties, expected.allowed)) throw new Error(`OpenAPI request properties mismatch for ${expected.ref}`);
  }
}

export function assertLoopbackBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '8010' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('base URL must be exactly loopback http://127.0.0.1:8010');
  return url.origin;
}

async function cappedJson(response, limit) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Error('RESPONSE_SIZE_LIMIT_EXCEEDED');
  const text = await response.text();
  if (Buffer.byteLength(text) > limit) throw new Error('RESPONSE_SIZE_LIMIT_EXCEEDED');
  try { return JSON.parse(text); } catch { throw new Error('RESPONSE_NOT_JSON'); }
}

function safeReturnCode(body) {
  const value = body?.return_code ?? body?.returnCode;
  return /^-?\d{1,5}$/.test(String(value)) ? String(value) : 'INVALID';
}

function safeRevision() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim() || null; }
  catch { return null; }
}

function normalizePositiveInteger(value, maxDigits) {
  const normalized = String(value ?? '').trim().replaceAll(',', '').replace(/^[+-]/, '');
  return new RegExp(`^\\d{1,${maxDigits}}$`).test(normalized) && BigInt(normalized) > 0n ? normalized : null;
}

function normalizePositiveQuantity(value, maxDigits) {
  const normalized = String(value ?? '').trim().replaceAll(',', '');
  return new RegExp(`^\\d{1,${maxDigits}}$`).test(normalized) && BigInt(normalized) > 0n ? normalized : null;
}

function chooseOrder(body) {
  if (!Array.isArray(body?.oso)) return null;
  return body.oso.find(row => /^\d{7}$/.test(String(row?.ord_no ?? '')) && normalizePositiveQuantity(row?.oso_qty, 12)) || null;
}

function selectAccount(body, requestedAlias) {
  if (!body || typeof body !== 'object' || !body.accounts || typeof body.accounts !== 'object') throw new Error('ACCOUNT_READINESS_SHAPE_INVALID');
  const alias = requestedAlias || body.default;
  if (typeof alias !== 'string' || !alias || body.accounts[alias]?.ready !== true) throw new Error('NO_SELECTED_READY_ACCOUNT');
  return alias;
}

function result(operationRef, role, attempted, verdict, reason, extra = {}) {
  return { operationRef, role, attempted, verdict, reason, ...extra };
}

async function requestJson(url, init, limit, timeoutMs, deadline, fetchImpl) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('OVERALL_TIMEOUT');
  const response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(Math.min(timeoutMs, remaining)) });
  if (response.url && response.url !== url) throw new Error('REDIRECT_NOT_ALLOWED');
  return { response, body: await cappedJson(response, limit) };
}

export async function runProbe(options = {}, source, deps = {}) {
  const config = { execute: false, baseUrl: 'http://127.0.0.1:8010', requestTimeoutMs: 5000, overallTimeoutMs: 60000, rateMs: 250, ...options };
  const baseUrl = assertLoopbackBaseUrl(config.baseUrl);
  const now = config.now ? new Date(config.now) : new Date();
  const plan = buildPlan(source, now);
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const tokenReader = deps.tokenReader || (() => process.env.ATHENA_LOCAL_BEARER_TOKEN);
  const accountReader = deps.accountReader || (() => process.env.ATHENA_AUDIT_ACCOUNT_ALIAS);
  const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const clock = deps.clock || (() => new Date());
  const report = { schemaVersion: 1, mode: config.execute ? 'loopback_live' : 'dry_run', revision: deps.revision === undefined ? safeRevision() : deps.revision, observedAt: now.toISOString(), marketPhaseAtStart: marketPhase(now), scope: { targetCount: 5, businessRequestLimit: REQUEST_LIMIT, accountBinding: 'SAME_SELECTED_READY_ALIAS_IN_MEMORY', symbolBinding: 'SAME_FIXED_DECLARED_SYMBOL_IN_MEMORY', orderSideEffects: 'FORBIDDEN' }, scenario: { side: 'BUY', uvMeaning: 'HYPOTHETICAL_CAPACITY_SCENARIO_PRICE', freshness: 'NOT_VERIFIED_NO_SOURCE_TIMESTAMP_CONTRACT' }, results: [], metadata: { openApi: 'NOT_RUN', accountReadiness: 'NOT_RUN' } };
  if (!config.execute) {
    report.results = plan.operations.filter(op => TARGET_REFS.has(op.ref)).map(op => result(op.ref, 'TARGET', false, 'NOT_RUN', 'DRY_RUN'));
    report.summary = summarize(report.results, 0, 0);
    return report;
  }
  const deadline = Date.now() + config.overallTimeoutMs;
  let metadataRequests = 0;
  let businessRequests = 0;
  let authBlocked = false;
  const effectiveRequestLimit = Math.min(REQUEST_LIMIT, Number.isInteger(deps.requestLimit) && deps.requestLimit > 0 ? deps.requestLimit : REQUEST_LIMIT);
  const metadataGet = async (pathname, cap) => {
    metadataRequests += 1;
    return requestJson(`${baseUrl}${pathname}`, { method: 'GET' }, cap, config.requestTimeoutMs, deadline, fetchImpl);
  };
  const open = await metadataGet('/openapi.json', OPENAPI_LIMIT_BYTES);
  if (!open.response.ok) throw new Error('OPENAPI_HTTP_FAILURE');
  validateOpenApi(open.body, plan);
  report.metadata.openApi = 'PASS_EXACT_REQUEST_CONTRACT';
  const ready = await metadataGet('/ready/accounts', BUSINESS_LIMIT_BYTES);
  if (!ready.response.ok) throw new Error('ACCOUNT_READINESS_HTTP_FAILURE');
  const accountAlias = selectAccount(ready.body, accountReader());
  report.metadata.accountReadiness = 'PASS_SELECTED_ALIAS_READY';
  const token = tokenReader();
  if (typeof token !== 'string' || !token.trim()) throw new Error('LOCAL_BEARER_TOKEN_MISSING');

  const byRef = new Map(plan.operations.map(op => [op.ref, op]));
  const call = async (op, payload) => {
    if (authBlocked) throw new Error('AUTH_FAILURE_NOT_ATTEMPTED');
    if (businessRequests >= effectiveRequestLimit) throw new Error('REQUEST_BUDGET_EXCEEDED');
    if (businessRequests > 0 && config.rateMs > 0) {
      if (deadline - Date.now() <= config.rateMs) throw new Error('OVERALL_TIMEOUT_BEFORE_RATE_DELAY');
      await sleep(config.rateMs);
    }
    businessRequests += 1;
    const url = `${baseUrl}${op.route.path}`;
    const attemptedAtDate = clock();
    const attemptedAt = attemptedAtDate.toISOString();
    const phase = marketPhase(attemptedAtDate);
    let requested;
    try {
      requested = await requestJson(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, [ACCOUNT_HEADER]: accountAlias, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, BUSINESS_LIMIT_BYTES, config.requestTimeoutMs, deadline, fetchImpl);
    } catch (error) {
      if (error && typeof error === 'object') error.auditAttempt = { attemptedAt, marketPhase: phase };
      throw error;
    }
    const { response, body } = requested;
    if (response.status === 401 || response.status === 403) authBlocked = true;
    return { response, body, attemptedAt, marketPhase: phase };
  };
  const observe = async (op, payload, validate) => {
    try {
      const { response, body, attemptedAt, marketPhase: phase } = await call(op, payload);
      const projected = op.ref.startsWith('detail:');
      const hasReturnCode = Object.hasOwn(body || {}, 'return_code') || Object.hasOwn(body || {}, 'returnCode');
      const code = hasReturnCode ? safeReturnCode(body) : null;
      const evidence = { httpStatus: response.status, attemptedAt, marketPhase: phase, ...(projected && !hasReturnCode ? { returnCode: 'NOT_EXPOSED_BY_DETAIL_PROJECTION' } : { returnCode: code }) };
      if (response.status === 401 || response.status === 403) return { fatalAuth: true, entry: result(op.ref, op.role, true, 'BLOCKED', 'AUTH_FAILURE', { httpStatus: response.status, attemptedAt, marketPhase: phase }) };
      if (!response.ok || !body || typeof body !== 'object' || Array.isArray(body)) return { entry: result(op.ref, op.role, true, 'BLOCKED', 'HTTP_OR_JSON_FAILURE', evidence) };
      if ((!projected && code !== '0') || (projected && hasReturnCode)) return { entry: result(op.ref, op.role, true, 'BLOCKED', projected ? 'DETAIL_PROJECTION_BUSINESS_OR_CONTRACT_FAILURE' : 'BUSINESS_RETURN_CODE_FAILURE', evidence) };
      const value = validate(body);
      return value ? { value, entry: result(op.ref, op.role, true, 'PASS', 'SOURCE_VALUE_OBSERVED_IN_MEMORY', evidence) } : { entry: result(op.ref, op.role, true, 'BLOCKED', 'SOURCE_VALUE_NOT_AVAILABLE', evidence) };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'REQUEST_FAILURE';
      return { fatalAuth: reason === 'AUTH_FAILURE_NOT_ATTEMPTED', entry: result(op.ref, op.role, reason !== 'AUTH_FAILURE_NOT_ATTEMPTED', 'BLOCKED', reason, error?.auditAttempt || {}) };
    }
  };
  const target = async (op, payload) => {
    try {
      const { response, body, attemptedAt, marketPhase: phase } = await call(op, payload);
      const projected = op.ref.startsWith('detail:');
      const hasReturnCode = Object.hasOwn(body || {}, 'return_code') || Object.hasOwn(body || {}, 'returnCode');
      const code = hasReturnCode ? safeReturnCode(body) : null;
      const evidence = { httpStatus: response.status, attemptedAt, marketPhase: phase, ...(projected && !hasReturnCode ? { returnCode: 'NOT_EXPOSED_BY_DETAIL_PROJECTION' } : { returnCode: code }) };
      if (response.status === 401 || response.status === 403) return result(op.ref, 'TARGET', true, 'BLOCKED', 'AUTH_FAILURE', { httpStatus: response.status, attemptedAt, marketPhase: phase });
      const present = op.fields.some(field => Object.hasOwn(body || {}, field));
      const envelopeValid = projected ? !hasReturnCode : code === '0';
      const pass = response.ok && envelopeValid && body && typeof body === 'object' && !Array.isArray(body) && present;
      const reason = pass ? 'PASS_HTTP_JSON_DECLARED_ROOT_PRESENT' : projected && hasReturnCode ? 'DETAIL_PROJECTION_BUSINESS_OR_CONTRACT_FAILURE' : 'HTTP_JSON_OR_DECLARED_ROOT_FAILURE';
      return result(op.ref, 'TARGET', true, pass ? 'PASS' : 'BLOCKED', reason, { ...evidence, pagination: 'NOT_VERIFIED_SINGLE_PAGE' });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'REQUEST_FAILURE';
      return result(op.ref, 'TARGET', reason !== 'AUTH_FAILURE_NOT_ATTEMPTED', 'BLOCKED', reason, error?.auditAttempt || {});
    }
  };

  const finishAuthBlocked = refs => {
    for (const ref of refs) report.results.push(result(ref, 'TARGET', false, 'BLOCKED', 'AUTH_FAILURE_NOT_ATTEMPTED'));
    report.summary = summarize(report.results, businessRequests, metadataRequests);
    return report;
  };

  const orders = await observe(byRef.get('base:ka10075'), byRef.get('base:ka10075').payload, chooseOrder);
  report.results.push(orders.entry);
  if (orders.fatalAuth) return finishAuthBlocked(plan.operations.filter(item => item.role === 'TARGET').map(item => item.ref));
  if (orders.value) report.results.push(await target(byRef.get('base:ka10088'), { ord_no: orders.value.ord_no }));
  else report.results.push(result('base:ka10088', 'TARGET', false, 'BLOCKED', 'NO_EXISTING_UNFILLED_ORDER'));
  if (authBlocked) return finishAuthBlocked(['detail:kt00010:margin_order_capacity', 'detail:kt00010:cash_and_withdrawal_capacity', 'detail:kt00010:purchase_settlement', 'base:ka30003']);

  let priceSource = 'BEST_ASK';
  let price = await observe(byRef.get('detail:ka10004:sell_bid_prices'), { stk_cd: '005930' }, body => normalizePositiveInteger(body.sel_fpr_bid, 10));
  report.results.push(price.entry);
  if (authBlocked) return finishAuthBlocked(['detail:kt00010:margin_order_capacity', 'detail:kt00010:cash_and_withdrawal_capacity', 'detail:kt00010:purchase_settlement', 'base:ka30003']);
  if (!price.value) {
    priceSource = 'CURRENT_PRICE_FALLBACK';
    price = await observe(byRef.get('detail:ka10001:current_trading'), { stk_cd: '005930' }, body => normalizePositiveInteger(body.cur_prc, 10));
    report.results.push(price.entry);
    if (authBlocked) return finishAuthBlocked(['detail:kt00010:margin_order_capacity', 'detail:kt00010:cash_and_withdrawal_capacity', 'detail:kt00010:purchase_settlement', 'base:ka30003']);
  }
  const capacityRefs = ['detail:kt00010:margin_order_capacity', 'detail:kt00010:cash_and_withdrawal_capacity', 'detail:kt00010:purchase_settlement'];
  if (price.value) {
    report.scenario.priceSource = priceSource;
    report.scenario.sourceDeliveredAt = price.entry.attemptedAt;
    for (let index = 0; index < capacityRefs.length; index += 1) {
      const ref = capacityRefs[index];
      report.results.push(await target(byRef.get(ref), { stk_cd: '005930', trde_tp: '2', uv: price.value }));
      if (authBlocked) return finishAuthBlocked([...capacityRefs.slice(index + 1), 'base:ka30003']);
    }
  } else {
    for (const ref of capacityRefs) report.results.push(result(ref, 'TARGET', false, 'BLOCKED', 'NO_OBSERVED_SCENARIO_PRICE'));
  }
  report.results.push(await target(byRef.get('base:ka30003'), { bsis_aset_cd: '005930', base_dt: plan.baseDate }));
  report.summary = summarize(report.results, businessRequests, metadataRequests);
  return report;
}

function summarize(results, businessRequests, metadataRequests) {
  const targets = results.filter(item => item.role === 'TARGET');
  return { targetCount: targets.length, targetAttempted: targets.filter(item => item.attempted).length, targetPass: targets.filter(item => item.verdict === 'PASS').length, targetBlocked: targets.filter(item => item.verdict === 'BLOCKED').length, businessRequestCount: businessRequests, metadataRequestCount: metadataRequests };
}

function kstTimestamp(date) {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date).replace(/[-: ]/g, '');
  return `${parts}KST`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log('Usage: node read-final-inputs.mjs [--execute] [--base-url http://127.0.0.1:8010] [--output-dir DIR]'); return; }
  const report = await runProbe(options, await loadSources());
  await mkdir(options.outputDir, { recursive: true });
  const output = path.join(options.outputDir, `read-final-inputs-${kstTimestamp(new Date())}.json`);
  if (existsSync(output)) throw new Error('refusing to overwrite report');
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ outputPath: output, mode: report.mode, summary: report.summary }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
