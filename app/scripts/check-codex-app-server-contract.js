'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCodexRuntime } = require('../lib/main/codex-runtime-home');

const APP_DIR = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(APP_DIR, 'test-fixtures', 'provider-contract');
const DEFAULT_FIXTURE = path.join(FIXTURE_DIR, 'codex-app-server-0.147.0.json');
const DEFAULT_REPORT = path.join(FIXTURE_DIR, 'reports', 'codex.json');
const TEMP_PREFIX = 'athena-codex-contract-';
const TEMP_MARKER = '.athena-owned-contract-probe';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function walkFiles(root) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else files.push(file);
    }
  }
  walk(root);
  return files.sort();
}

function hashSchemaBundle(root) {
  const hash = crypto.createHash('sha256');
  const files = walkFiles(root);
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    hash.update(relative);
    hash.update('\0');
    hash.update(fs.readFileSync(file));
  }
  return { fileCount: files.length, sha256: hash.digest('hex') };
}

function collectMethods(value, output = new Set()) {
  if (!value || typeof value !== 'object') return output;
  if (value.properties?.method?.const && typeof value.properties.method.const === 'string') {
    output.add(value.properties.method.const);
  }
  if (Array.isArray(value.properties?.method?.enum)) {
    for (const method of value.properties.method.enum) {
      if (typeof method === 'string') output.add(method);
    }
  }
  for (const child of Object.values(value)) collectMethods(child, output);
  return output;
}

function inspectStableSchemas(schemaRoot) {
  const clientRequest = readJson(path.join(schemaRoot, 'ClientRequest.json'));
  const resume = readJson(path.join(schemaRoot, 'v2', 'ThreadResumeParams.json'));
  const fork = readJson(path.join(schemaRoot, 'v2', 'ThreadForkParams.json'));
  const mcp = readJson(path.join(schemaRoot, 'v2', 'ListMcpServerStatusResponse.json'));
  const notification = readJson(path.join(schemaRoot, 'ServerNotification.json'));
  const mcpStatus = mcp.definitions?.McpServerStatus;
  return {
    methods: [...collectMethods(clientRequest)].sort(),
    resumeRequired: resume.required || [],
    resumeProperties: Object.keys(resume.properties || {}).sort(),
    forkProperties: Object.keys(fork.properties || {}).sort(),
    notificationProperties: Object.keys(notification.properties || {}).sort(),
    mcpStatusProperties: Object.keys(mcpStatus?.properties || {}).sort(),
  };
}

function validateSchemaFacts(fixture, facts) {
  const missingMethods = fixture.requiredMethods.filter((method) => !facts.methods.includes(method));
  assert.deepEqual(missingMethods, [], `Codex stable methods missing: ${missingMethods.join(', ')}`);
  assert.ok(facts.resumeRequired.includes('threadId'));
  for (const experimental of ['excludeTurns', 'initialTurnsPage', 'historyMode']) {
    assert.equal(facts.resumeProperties.includes(experimental), false, `${experimental} must remain experimental`);
  }
  assert.equal(facts.forkProperties.includes('lastTurnId'), true);
  assert.equal(facts.notificationProperties.includes('emittedAtMs'), true);
  for (const field of ['name', 'authStatus', 'tools', 'resources', 'resourceTemplates', 'serverInfo']) {
    assert.equal(facts.mcpStatusProperties.includes(field), true, `MCP status missing ${field}`);
  }
  assert.equal(facts.mcpStatusProperties.includes('pluginId'), false);
}

function validateWireFixture(fixture) {
  function assertNoJsonRpc(value) {
    if (!value || typeof value !== 'object') return;
    assert.equal(Object.hasOwn(value, 'jsonrpc'), false, 'Codex wire fixture must omit jsonrpc');
    for (const child of Object.values(value)) assertNoJsonRpc(child);
  }
  assertNoJsonRpc(fixture.requests);
  assertNoJsonRpc(fixture.responses);
  assertNoJsonRpc(fixture.notifications);
  assert.deepEqual(Object.keys(fixture.requests.threadResume.params), ['threadId']);
  assert.equal(fixture.requests.initialize.params.capabilities.experimentalApi, false);
  assert.deepEqual(
    Object.keys(fixture.requests.firstTurn.params).sort(),
    ['approvalPolicy', 'clientUserMessageId', 'cwd', 'effort', 'input', 'model', 'sandboxPolicy', 'threadId'],
  );
  assert.deepEqual(fixture.requests.firstTurn.params.sandboxPolicy, {
    type: 'readOnly',
    networkAccess: false,
  });
  assert.equal(fixture.notifications.turnCompleted.emittedAtMs, 0);
  for (const name of [
    'initialize', 'threadStart', 'threadResume', 'threadFork',
    'turnStart', 'turnInterrupt', 'configRead', 'mcpInventory',
  ]) {
    assert.ok(fixture.responses[name], `Codex response fixture missing ${name}`);
  }
}

function candidateCodexExecutables() {
  const candidates = [];
  if (process.env.ATHENA_CODEX_EXECUTABLE) candidates.push(process.env.ATHENA_CODEX_EXECUTABLE);
  if (process.platform === 'win32' && process.env.APPDATA) {
    candidates.push(path.join(
      process.env.APPDATA,
      'npm', 'node_modules', '@openai', 'codex', 'node_modules',
      '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe',
    ));
  }
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

function resolveCodexExecutable(expected) {
  const candidates = candidateCodexExecutables().filter((candidate) => fs.existsSync(candidate));
  const exact = candidates.find((candidate) => {
    const bytes = fs.readFileSync(candidate);
    return bytes.length === expected.bytes && sha256(bytes) === expected.sha256;
  });
  assert.ok(exact, 'No installed Codex binary matches the pinned version/hash fixture');
  return exact;
}

function createOwnedTempRoot() {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tempRoot, TEMP_PREFIX));
  fs.writeFileSync(path.join(root, TEMP_MARKER), 'owned by Athena Codex contract probe\n');
  return root;
}

function removeOwnedTempRoot(root) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const resolved = fs.realpathSync(root);
  assert.equal(path.dirname(resolved), tempRoot);
  assert.ok(path.basename(resolved).startsWith(TEMP_PREFIX));
  assert.ok(fs.existsSync(path.join(resolved, TEMP_MARKER)));
  fs.rmSync(resolved, { recursive: true, force: true });
}

function runChild(child, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const append = (current, chunk) => `${current}${chunk}`.slice(-65_536);
    child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.once('error', reject);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Codex contract command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function hashGlobalCodexState() {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const hash = crypto.createHash('sha256');
  for (const name of ['auth.json', 'config.toml']) {
    const file = path.join(home, name);
    hash.update(name);
    hash.update('\0');
    hash.update(fs.existsSync(file) ? fs.readFileSync(file) : '<absent>');
  }
  return hash.digest('hex');
}

async function probeCodexContract({ fixturePath = DEFAULT_FIXTURE } = {}) {
  const fixture = readJson(fixturePath);
  validateWireFixture(fixture);
  const executable = resolveCodexExecutable(fixture.binary);
  const binaryBytes = fs.readFileSync(executable);
  assert.equal(binaryBytes.length, fixture.binary.bytes);
  assert.equal(sha256(binaryBytes), fixture.binary.sha256);

  const root = createOwnedTempRoot();
  const runtimeHome = path.join(root, 'private-home');
  const schemaRoot = path.join(root, 'stable-schema');
  fs.mkdirSync(runtimeHome);
  const runtime = createCodexRuntime({ runtimeHome, codexExecutable: executable });
  const globalBefore = hashGlobalCodexState();
  try {
    const versionResult = await runChild(runtime.spawnPrivateHomeCommand(['--version'], {
      timeoutMs: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }), 6_000);
    assert.equal(versionResult.code, 0, versionResult.stderr);
    const versionMatch = /codex-cli\s+([^\s]+)/.exec(versionResult.stdout);
    assert.equal(versionMatch?.[1], fixture.version);

    const schemaResult = await runChild(runtime.spawnPrivateHomeCommand([
      'app-server', 'generate-json-schema', '--out', schemaRoot,
    ], {
      timeoutMs: 20_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }), 21_000);
    assert.equal(schemaResult.code, 0, schemaResult.stderr);
    const schemaHash = hashSchemaBundle(schemaRoot);
    assert.deepEqual(schemaHash, {
      fileCount: fixture.stableSchema.generatedFileCount,
      sha256: fixture.stableSchema.nameAndBytesSha256,
    });
    const facts = inspectStableSchemas(schemaRoot);
    validateSchemaFacts(fixture, facts);

    const authResult = await runChild(runtime.spawnPrivateHomeCommand(['login', 'status'], {
      timeoutMs: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }), 6_000);
    const privateAuthReady = authResult.code === 0;
    const globalAfter = hashGlobalCodexState();
    assert.equal(globalAfter, globalBefore, 'Codex probe mutated global auth/config state');

    return {
      schemaVersion: 1,
      provider: 'codex',
      version: fixture.version,
      sha256: fixture.binary.sha256,
      upstreamTag: fixture.upstreamTag,
      upstreamCommit: fixture.upstreamCommit,
      stableSchemaSha256: schemaHash.sha256,
      referenceSchemaSha256: fixture.stableSchema.referenceSha256,
      methods: fixture.requiredMethods,
      gates: {
        exactBinary: true,
        stableSchema: true,
        privateRuntimeHome: true,
        globalStateUnchanged: true,
        privateAuthReady,
        threadScopedMcpInventory: false,
        builtinCapabilityNegativeProbe: false,
      },
      liveTurnExecuted: false,
      liveAppServerSpawned: false,
    };
  } finally {
    removeOwnedTempRoot(root);
  }
}

function writeReport(file, report) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stableJson(report), 'utf8');
}

async function main() {
  const reportArg = process.argv.indexOf('--report');
  const reportPath = reportArg >= 0 ? path.resolve(process.argv[reportArg + 1]) : DEFAULT_REPORT;
  const report = await probeCodexContract();
  writeReport(reportPath, report);
  process.stdout.write(stableJson(report));
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Codex app-server contract probe failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  hashSchemaBundle,
  inspectStableSchemas,
  validateSchemaFacts,
  validateWireFixture,
  resolveCodexExecutable,
  probeCodexContract,
};
