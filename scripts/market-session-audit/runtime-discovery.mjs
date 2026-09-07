import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildInventory, REPO_ROOT } from './inventory.mjs';
import { parseLocalBearer, validateBaseUrl } from './observer.mjs';

const execFileAsync = promisify(execFile);
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
const GENERATED_PREFIX = '/api/v1/tr/';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function identity(route) {
  return `${route.method} ${route.path}`;
}

function difference(left, right) {
  const other = new Set(right);
  return [...new Set(left)].filter((value) => !other.has(value)).sort();
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) (seen.has(value) ? repeated : seen).add(value);
  return [...repeated].sort();
}

export function extractRuntimeRoutes(openapi) {
  const routes = [];
  for (const [routePath, pathItem] of Object.entries(openapi?.paths || {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      routes.push({
        method: method.toUpperCase(),
        path: routePath,
        operation_id: typeof operation?.operationId === 'string' ? operation.operationId : null,
      });
    }
  }
  return routes.sort((a, b) => identity(a).localeCompare(identity(b)));
}

export function reconcileRoutes(runtimeRoutes, staticRows, generatedRows = []) {
  const generatedIds = new Set(generatedRows.map(identity));
  const generated = runtimeRoutes.filter((route) => generatedIds.has(identity(route)));
  const generatedTr = generated.filter((route) => route.path.startsWith(GENERATED_PREFIX));
  const runtimeOther = runtimeRoutes.filter((route) => !generatedIds.has(identity(route)));
  const staticWebsocket = staticRows.filter((row) => row.method === 'WEBSOCKET');
  const staticHttp = staticRows.filter((row) => row.method !== 'WEBSOCKET');
  const runtimeIds = runtimeOther.map(identity);
  const staticIds = staticHttp.map(identity);
  return {
    generated_api: {
      count: generated.length,
      expected_static_count: generatedRows.length,
      routes: generated,
      duplicate_route_ids: duplicates(generated.map(identity)),
      duplicate_operation_ids: duplicates(generated.map((route) => route.operation_id).filter(Boolean)),
      static_only: difference(generatedRows.map(identity), generated.map(identity)),
      runtime_only: difference(generated.map(identity), generatedRows.map(identity)),
      tr_prefix_count: generatedTr.length,
      non_tr_prefix_count: generated.length - generatedTr.length,
    },
    generated_tr: {
      count: generatedTr.length,
      routes: generatedTr,
    },
    other_runtime_api: {
      count: runtimeOther.length,
      routes: runtimeOther,
      duplicate_route_ids: duplicates(runtimeIds),
      duplicate_operation_ids: duplicates(runtimeOther.map((route) => route.operation_id).filter(Boolean)),
    },
    static_http: { count: staticHttp.length },
    static_websocket_excluded: {
      count: staticWebsocket.length,
      status: 'NOT_APPLICABLE',
      reason: 'FastAPI OpenAPI does not enumerate WebSocket routes',
      routes: staticWebsocket.map((row) => ({ method: row.method, path: row.path, source_path: row.source_path })),
    },
    diff: {
      static_only: difference(staticIds, runtimeIds),
      runtime_only: difference(runtimeIds, staticIds),
      verdict: 'NOT_VERIFIED',
      absence_cause: 'UNDETERMINED',
      interpretation: 'Route differences may depend on runtime feature flags or registration conditions; they are not automatically product failures.',
    },
  };
}

async function readBearer(repoRoot) {
  try {
    return parseLocalBearer(await readFile(path.join(repoRoot, 'backend', '.env'), 'utf8'));
  } catch {
    return null;
  }
}

async function gitHead(repoRoot) {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, windowsHide: true });
  return stdout.trim();
}

function timestampName(date) {
  return date.toISOString().replace(/[-:]/g, '').replace('.', '-');
}

export async function discoverRuntime(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const baseUrl = validateBaseUrl(options.baseUrl || 'http://127.0.0.1:8010');
  const now = options.now instanceof Date ? options.now : new Date();
  const timeoutMs = options.timeoutMs ?? 3_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error('timeoutMs must be between 100 and 30000');
  }
  const bearer = options.bearer === undefined ? await readBearer(repoRoot) : options.bearer;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await (options.fetchFn || globalThis.fetch)(new URL('/openapi.json', baseUrl), {
      method: 'GET',
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
      redirect: 'error',
      credentials: 'omit',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response?.ok) throw new Error(`OpenAPI discovery failed with status ${response?.status ?? 'unreachable'}`);
  const runtimeRoutes = extractRuntimeRoutes(await response.json());
  const inventory = options.inventory || await buildInventory({ repoRoot, now });
  const staticRows = inventory.items
    .filter((item) => item.source === 'custom_api_route')
    .map((item) => {
      const match = /^(\S+)\s+(.+)$/.exec(item.source_id);
      return { method: match?.[1] || '', path: match?.[2] || '', source_path: item.source_path };
    });
  let generatedRows = options.generatedRows;
  if (!generatedRows) {
    const manifest = JSON.parse(await readFile(path.join(repoRoot, 'backend', 'ref', 'kiwoom-common-screen-manifest.json'), 'utf8'));
    generatedRows = manifest.mappings.map((mapping) => ({
      method: mapping.route.method,
      path: mapping.route.path,
      operation_id: mapping.route.operation_id || null,
    }));
  }
  const reconciliation = reconcileRoutes(runtimeRoutes, staticRows, generatedRows);
  const routeDigest = digest(runtimeRoutes.map((route) => `${identity(route)}\t${route.operation_id || ''}`).join('\n'));
  const artifact = {
    schema_version: 1,
    kind: 'athena_runtime_openapi_discovery',
    observed_at: now.toISOString(),
    revision: await (options.gitHeadFn || gitHead)(repoRoot),
    source: { base_url: baseUrl, endpoint: '/openapi.json', method: 'GET', redirect: 'error', credentials: 'omit' },
    authentication: { local_bearer_present: Boolean(bearer), secret_persisted: false },
    runtime_environment: {
      flags_observed: null,
      route_absence_cause: 'UNDETERMINED',
      inference_performed: false,
    },
    route_digest_sha256: routeDigest,
    runtime_route_count: runtimeRoutes.length,
    reconciliation,
    mcp_tools_list: {
      status: 'NOT_VERIFIED',
      reason: 'No existing tools/list capture was supplied; this discovery does not start a new stdio MCP server.',
    },
  };
  const outputRoot = path.resolve(options.outputRoot || path.join(repoRoot, 'artifacts', 'market-session-audit', '2026-09-07'));
  await mkdir(outputRoot, { recursive: true });
  let outputPath = path.join(outputRoot, `runtime-discovery-${timestampName(now)}.json`);
  for (let suffix = 1; ; suffix += 1) {
    try {
      await writeFile(outputPath, JSON.stringify(artifact, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      outputPath = path.join(outputRoot, `runtime-discovery-${timestampName(now)}-${suffix}.json`);
    }
  }
  return { artifact, outputPath };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const { artifact, outputPath } = await discoverRuntime();
    console.log(`${outputPath} — runtime=${artifact.runtime_route_count} generated=${artifact.reconciliation.generated_api.count}/${artifact.reconciliation.generated_api.expected_static_count} tr_prefix=${artifact.reconciliation.generated_tr.count} other=${artifact.reconciliation.other_runtime_api.count} static_only=${artifact.reconciliation.diff.static_only.length} runtime_only=${artifact.reconciliation.diff.runtime_only.length}`);
  } catch (error) {
    console.error(`runtime discovery failed: ${error?.message || 'unknown_error'}`);
    process.exitCode = 1;
  }
}
