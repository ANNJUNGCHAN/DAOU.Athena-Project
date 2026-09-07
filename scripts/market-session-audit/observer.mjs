import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(THIS_DIR, '..', '..');
export const DEFAULT_BASE_URL = 'http://127.0.0.1:8010';
export const DEFAULT_TIMEOUT_MS = 2_000;
export const SAFE_ENDPOINTS = Object.freeze(['/health', '/ready', '/ready/accounts', '/openapi.json']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function isLoopbackHostname(hostname) {
  return LOOPBACK_HOSTS.has(hostname);
}

export function validateBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:') throw new Error('observer base URL must use http');
  if (!isLoopbackHostname(url.hostname)) throw new Error('observer base URL must be loopback');
  if (url.port !== '8010') throw new Error('observer base URL must use port 8010');
  if (url.username || url.password) throw new Error('observer base URL must not contain userinfo');
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('observer base URL must be an origin');
  return url.origin;
}

function validateTimeoutMs(value) {
  const timeoutMs = value === undefined ? DEFAULT_TIMEOUT_MS : value;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error('timeoutMs must be between 100 and 30000');
  }
  return timeoutMs;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function marketPhase(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((out, part) => {
    if (part.type !== 'literal') out[part.type] = part.value;
    return out;
  }, {});
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  let phase = 'BEFORE_PREOPEN';
  if (minutes >= 8 * 60 + 30 && minutes < 9 * 60) phase = 'PREOPEN';
  else if (minutes >= 9 * 60 && minutes < 15 * 60 + 20) phase = 'REGULAR';
  else if (minutes >= 15 * 60 + 20 && minutes < 15 * 60 + 30) phase = 'CLOSING_AUCTION';
  else if (minutes >= 15 * 60 + 30 && minutes < 16 * 60 + 30) phase = 'POSTCLOSE';
  else if (minutes >= 16 * 60 + 30) phase = 'AFTER_AUDIT_WINDOW';
  return {
    timezone: 'Asia/Seoul',
    local_date: `${parts.year}-${parts.month}-${parts.day}`,
    local_time: `${parts.hour}:${parts.minute}:${parts.second}`,
    phase,
  };
}

export function parseLocalBearer(text) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = /^\s*ATHENA_LOCAL_BEARER_TOKEN\s*=\s*(.+?)\s*$/.exec(line);
    if (match) return match[1].replace(/^["']|["']$/g, '') || null;
  }
  return null;
}

async function readBearer(repoRoot) {
  try {
    return parseLocalBearer(await readFile(path.join(repoRoot, 'backend', '.env'), 'utf8'));
  } catch {
    return null;
  }
}

async function observeEndpoint(endpoint, { baseUrl, bearer, fetchFn, timeoutMs }) {
  if (!SAFE_ENDPOINTS.includes(endpoint)) throw new Error(`unsafe observer endpoint: ${endpoint}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const headers = bearer ? { Authorization: `Bearer ${bearer}` } : undefined;
    const response = await fetchFn(new URL(endpoint, baseUrl), {
      method: 'GET', headers, signal: controller.signal, redirect: 'error', credentials: 'omit',
    });
    const elapsed_ms = Math.round((performance.now() - started) * 10) / 10;
    let summary = null;
    if (endpoint === '/ready/accounts' && response.ok) {
      const body = await response.json();
      const accounts = body && typeof body.accounts === 'object' && body.accounts ? Object.values(body.accounts) : [];
      summary = {
        account_count: accounts.length,
        ready_count: accounts.filter((item) => item && item.ready === true).length,
        websocket_ready_count: accounts.filter((item) => item && item.websocket === true).length,
        order_scope_reported_count: accounts.filter((item) => item && Array.isArray(item.order_scopes)).length,
      };
    } else if (endpoint === '/openapi.json' && response.ok) {
      const body = await response.json();
      summary = { path_count: body && body.paths && typeof body.paths === 'object' ? Object.keys(body.paths).length : 0 };
    }
    return { endpoint, method: 'GET', reachable: true, ok: response.ok, status: response.status, elapsed_ms, summary };
  } catch (error) {
    return {
      endpoint, method: 'GET', reachable: false, ok: false, status: null,
      elapsed_ms: Math.round((performance.now() - started) * 10) / 10,
      error: error && error.name === 'AbortError' ? 'timeout' : 'request_failed',
      summary: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function defaultGitProbe(repoRoot) {
  const [{ stdout: head }, { stdout: status }] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, windowsHide: true }),
    execFileAsync('git', ['status', '--porcelain=v1', '-z'], { cwd: repoRoot, windowsHide: true }),
  ]);
  const dirty = status.split('\0').filter(Boolean);
  return { head: head.trim(), dirty_count: dirty.length, dirty_digest_sha256: sha256(status) };
}

export async function probeProcesses(repoRoot, rootPid = null) {
  if (process.platform !== 'win32') return { supported: false, candidate_count: null, working_set_bytes: null };
  const escapedRoot = repoRoot.replace(/'/g, "''").toLowerCase();
  const command = [
    `$repo = '${escapedRoot}'`,
    "$repoPrefix = $repo.TrimEnd('\\') + '\\'",
    '$all = @(Get-CimInstance Win32_Process -ErrorAction Stop)',
    '$owned = [System.Collections.Generic.HashSet[int]]::new()',
    rootPid
      ? `$root = $all | Where-Object { [int]$_.ProcessId -eq ${rootPid} } | Select-Object -First 1; $rootFound = $null -ne $root; $rootValidated = $rootFound -and $root.ExecutablePath -and $root.ExecutablePath.ToLower().StartsWith($repoPrefix) -and $root.Name.ToLower() -eq 'electron.exe'; if ($rootValidated) { [void]$owned.Add(${rootPid}) }`
      : '$all | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.ToLower().StartsWith($repoPrefix) } | ForEach-Object { [void]$owned.Add([int]$_.ProcessId) }',
    'do { $before=$owned.Count; $all | Where-Object { $owned.Contains([int]$_.ParentProcessId) } | ForEach-Object { [void]$owned.Add([int]$_.ProcessId) } } while ($owned.Count -gt $before)',
    '$items = @($all | Where-Object { $owned.Contains([int]$_.ProcessId) })',
    '$live = @(Get-Process -Id @($items.ProcessId) -ErrorAction SilentlyContinue)',
    `[pscustomobject]@{ root_found = ${rootPid ? '$rootFound' : '$null'}; root_validated = ${rootPid ? '$rootValidated' : '$null'}; root_image_name = ${rootPid ? '$(if ($rootFound) { $root.Name } else { $null })' : '$null'}; process_count = @($items).Count; working_set_bytes = [long](($items | Measure-Object WorkingSetSize -Sum).Sum); cpu_seconds = [double](($live | Measure-Object CPU -Sum).Sum); by_name = @($items | Group-Object Name | ForEach-Object { [pscustomobject]@{ name=$_.Name; count=$_.Count; working_set_bytes=[long](($_.Group | Measure-Object WorkingSetSize -Sum).Sum) } }) } | ConvertTo-Json -Compress -Depth 4`,
  ].join('; ');
  try {
    const encoded = Buffer.from(command, 'utf16le').toString('base64');
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true, timeout: 4_000, maxBuffer: 1024 * 1024,
    });
    return {
      supported: true,
      scope: rootPid ? 'primary_pid_tree' : 'repo_executable_roots_and_descendants',
      root_pid: rootPid || null,
      ...JSON.parse(stdout.trim()),
    };
  } catch {
    return {
      supported: true,
      scope: rootPid ? 'primary_pid_tree' : 'repo_executable_roots_and_descendants',
      root_pid: rootPid || null,
      process_count: null, working_set_bytes: null, cpu_seconds: null, error: 'process_probe_failed',
    };
  }
}

function timestampName(date) {
  return date.toISOString().replace(/[-:]/g, '').replace('.', '-').replace('Z', 'Z');
}

export async function observeOnce(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const baseUrl = validateBaseUrl(options.baseUrl || DEFAULT_BASE_URL);
  const fetchFn = options.fetchFn || globalThis.fetch;
  const timeoutMs = validateTimeoutMs(options.timeoutMs);
  const bearer = options.bearer === undefined ? await readBearer(repoRoot) : options.bearer;
  const [git, processes, ...http] = await Promise.all([
    (options.gitProbe || defaultGitProbe)(repoRoot),
    (options.processProbe || probeProcesses)(repoRoot, options.rootPid || null),
    ...SAFE_ENDPOINTS.map((endpoint) => observeEndpoint(endpoint, { baseUrl, bearer, fetchFn, timeoutMs })),
  ]);
  const artifact = {
    schema_version: 1,
    kind: 'athena_market_session_observation',
    observed_at: now.toISOString(),
    market: marketPhase(now),
    environment: { declared: options.environment || null, inferred: false },
    source: { base_url: baseUrl, loopback: isLoopbackHostname(new URL(baseUrl).hostname) },
    authentication: { local_bearer_present: Boolean(bearer), secret_persisted: false },
    revision: git,
    processes,
    http,
  };
  const outputRoot = path.resolve(options.outputRoot || path.join(repoRoot, 'artifacts', 'market-session-audit', marketPhase(now).local_date));
  await mkdir(outputRoot, { recursive: true });
  let outputPath = path.join(outputRoot, `observer-${timestampName(now)}.json`);
  for (let suffix = 1; ; suffix += 1) {
    try {
      await writeFile(outputPath, JSON.stringify(artifact, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
      break;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      outputPath = path.join(outputRoot, `observer-${timestampName(now)}-${suffix}.json`);
    }
  }
  return { artifact, outputPath };
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--output-root') result.outputRoot = argv[++i];
    else if (value === '--base-url') result.baseUrl = argv[++i];
    else if (value === '--timeout-ms') result.timeoutMs = Number(argv[++i]);
    else if (value === '--environment') result.environment = argv[++i];
    else if (value === '--root-pid') {
      result.rootPid = Number(argv[++i]);
      if (!Number.isInteger(result.rootPid) || result.rootPid <= 0) throw new Error('--root-pid must be a positive integer');
    }
    else throw new Error(`unknown argument: ${value}`);
  }
  return result;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const { artifact, outputPath } = await observeOnce(parseArgs(process.argv.slice(2)));
    const okCount = artifact.http.filter((item) => item.ok).length;
    console.log(`${outputPath} — phase=${artifact.market.phase} http_ok=${okCount}/${artifact.http.length} processes=${artifact.processes.process_count ?? 'unknown'}`);
  } catch (error) {
    console.error(`observer failed: ${error && error.message ? error.message : 'unknown_error'}`);
    process.exitCode = 1;
  }
}
