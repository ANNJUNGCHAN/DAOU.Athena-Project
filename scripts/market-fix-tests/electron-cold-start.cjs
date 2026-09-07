'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const {
  createSpawnAdapter,
  firstRequestDelay,
  reserveEphemeralPort,
  waitUntil,
} = require('./cold-start-fixture.cjs');

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const BACKEND_ROOT = path.join(REPO_ROOT, 'backend');
const PRIVATE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-boot-integration-'));
const USER_DATA = path.join(PRIVATE_ROOT, 'electron-user-data');
fs.mkdirSync(USER_DATA, { recursive: true });
app.setPath('userData', USER_DATA);
process.chdir(PRIVATE_ROOT);
if (!process.versions.electron || path.resolve(app.getPath('userData')) !== USER_DATA) {
  throw new Error('fixture must run in Electron with its private userData path active');
}

const launcher = require('../../app/lib/main/backend-launcher');

function parseArgs(argv) {
  const result = { execute: false, pythonExe: '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--execute') result.execute = true;
    else if (argv[index] === '--python') result.pythonExe = path.resolve(argv[++index] || '');
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!result.execute) throw new Error('actual Electron/uvicorn gate requires --execute after independent review');
  if (!result.pythonExe) throw new Error('--python must name the reviewed Python executable');
  return result;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function readJson(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return true;
  return Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

async function runColdStart(pythonExe) {
  const port = await reserveEphemeralPort();
  const manifestUrl = `http://127.0.0.1:${port}/api/v1/llm/manifest`;
  let child = null;
  let spawnCount = 0;
  let stderrBytes = 0;
  const startedAt = Date.now();
  const spawnFn = createSpawnAdapter({
    expectedLauncherArgs: launcher.buildUvicornArgs(), pythonExe, backendRoot: BACKEND_ROOT,
    fixtureDir: SCRIPT_DIR, privateHome: PRIVATE_ROOT, port,
    onSpawn: (ownedChild) => {
      child = ownedChild;
      spawnCount += 1;
      ownedChild.stdout?.resume();
      ownedChild.stderr?.on('data', (chunk) => { stderrBytes += chunk.length; });
    },
  });
  try {
    const result = await launcher.ensureBackend({
      _dependencies: {
        checkHealthFn: () => launcher.checkHealth(manifestUrl, 500),
        venvExistsFn: () => fs.statSync(pythonExe, { throwIfNoEntry: false })?.isFile() === true,
        spawnFn,
        waitUntilHealthyFn: () => waitUntil(() => launcher.checkHealth(manifestUrl, 500), 30_000, 100),
      },
    });
    const manifestReadyAt = Date.now();
    if (!result?.ready || spawnCount !== 1 || !child) throw new Error('cold start did not produce one ready owned child');
    if (manifestReadyAt - startedAt >= 30_000) throw new Error('synthetic manifest readiness exceeded 30 seconds');
    const metadata = await readJson(`http://127.0.0.1:${port}/__fixture__/metadata`);
    if (metadata.synthetic !== true || metadata.identity_count !== 3525 || metadata.account_count !== 0
      || metadata.orders_enabled !== false || metadata.brain_enabled !== false
      || metadata.routines_enabled !== false || metadata.backtest_enabled !== false
      || metadata.cwd_is_private !== true) {
      throw new Error('fixture metadata did not prove the synthetic accountless lifespan');
    }
    if (path.resolve(metadata.backend_root) !== BACKEND_ROOT || !path.resolve(metadata.athena_api_path).startsWith(`${BACKEND_ROOT}${path.sep}`)) {
      throw new Error('backend source ownership proof failed');
    }
    const untilSixtySeconds = Math.max(0, startedAt + 60_100 - Date.now());
    await new Promise((resolve) => setTimeout(resolve, untilSixtySeconds));
    const aliveAfter60s = child.exitCode === null && await launcher.checkHealth(manifestUrl, 1000);
    if (!aliveAfter60s) throw new Error('owned child was not healthy after 60 seconds');
    return {
      outcome: 'PASS_SYNTHETIC_COMPONENT_COLD_START',
      synthetic_identity_count: metadata.identity_count,
      account_count: metadata.account_count,
      spawn_count: spawnCount,
      manifest_ready_ms: manifestReadyAt - startedAt,
      alive_after_60s: true,
      owned_child_pid: child.pid,
      owned_port: port,
      stderr_bytes: stderrBytes,
      backend_source_owned: true,
    };
  } finally {
    launcher.shutdownBackend({ killTreeFn: (ownedChild) => ownedChild.kill() });
    if (child && !(await waitForExit(child, 5000))) throw new Error('owned backend child cleanup timed out');
  }
}

async function runDelayedExistingServer() {
  const port = await reserveEphemeralPort();
  let requestCount = 0;
  let spawnCount = 0;
  const healthResults = [];
  const server = http.createServer((request, response) => {
    if (request.url !== '/api/v1/llm/manifest') {
      response.writeHead(404).end();
      return;
    }
    requestCount += 1;
    setTimeout(() => {
      if (response.destroyed) return;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    }, firstRequestDelay(requestCount, 1700));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const startedAt = Date.now();
  try {
    const result = await launcher.ensureBackend({
      _dependencies: {
        checkHealthFn: async () => {
          const healthy = await launcher.checkHealth(`http://127.0.0.1:${port}/api/v1/llm/manifest`, 1500);
          healthResults.push(healthy);
          return healthy;
        },
        venvExistsFn: () => true,
        spawnFn: () => { spawnCount += 1; throw new Error('unexpected spawn'); },
      },
    });
    if (result?.reason !== 'already-running' || spawnCount !== 0 || requestCount !== 2
      || JSON.stringify(healthResults) !== '[false,true]') {
      throw new Error('delayed existing backend was not detected before spawn');
    }
    if (Date.now() - startedAt < 1500) throw new Error('first manifest request did not cross the 1.5 second timeout');
    return {
      outcome: 'PASS_OWNED_DELAYED_EXISTING_SERVER',
      first_manifest_delay_ms: 1700,
      elapsed_ms: Date.now() - startedAt,
      request_count: requestCount,
      health_results: healthResults,
      spawn_count: spawnCount,
      owned_port: port,
    };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await app.whenReady();
  const cold = await runColdStart(args.pythonExe);
  const delayed = await runDelayedExistingServer();
  const report = {
    schema_version: 1,
    kind: 'athena_boot_component_integration',
    generated_at: new Date().toISOString(),
    mode: 'isolated_electron_synthetic_backend',
    limitations: [
      'launcher production URL is hard-coded to 127.0.0.1:8010; the dependency seam redirects checks and spawn arguments to an owned ephemeral loopback port',
      'the 3525-entry identity snapshot is synthetic and proves initialization behavior, not current market data',
      'non-loopback egress is not socket-instrumented; provider isolation evidence is the credential-free disabled Settings and loopback-only harness URLs',
    ],
    isolation: {
      private_user_data: true,
      sanitized_athena_environment: true,
      env_file_loaded: false,
      external_provider_access_configured: false,
      non_loopback_egress_instrumentation: 'NOT_INSTALLED',
      product_port_8010_touched: false,
      electron_version: process.versions.electron,
      backend_root: BACKEND_ROOT,
      reviewed_python_executable: args.pythonExe,
      source_hashes: {
        launcher: sha256(path.join(REPO_ROOT, 'app', 'lib', 'main', 'backend-launcher.js')),
        identity: sha256(path.join(BACKEND_ROOT, 'athena_api', 'selector', 'instrument_identity.py')),
        fixture: sha256(path.join(SCRIPT_DIR, 'backend_fixture.py')),
      },
    },
    scenarios: { cold, delayed_existing: delayed },
    cleanup: {
      owned_backend_exited: true,
      private_profile_preserved: true,
      private_root: PRIVATE_ROOT,
    },
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

main()
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`fixture failed: ${String(error?.message || error)}\n`);
    process.exitCode = 1;
    app.quit();
  });
