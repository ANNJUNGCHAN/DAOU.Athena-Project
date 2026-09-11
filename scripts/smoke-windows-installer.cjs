'use strict';

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { spawn, spawnSync } = require('node:child_process');

const LOOPBACK = '127.0.0.1';
const BACKEND_PORT = 8010;
const STARTUP_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 250;

function parseArgs(argv) {
  const parsed = { exe: '', output: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--exe') parsed.exe = argv[++index] || '';
    else if (name === '--output') parsed.output = argv[++index] || '';
    else throw new Error(`unknown argument: ${name}`);
  }
  for (const [name, value] of Object.entries(parsed)) {
    if (!value || !path.isAbsolute(value)) throw new Error(`--${name} must be an absolute path`);
    parsed[name] = path.resolve(value);
  }
  if (!fs.statSync(parsed.exe, { throwIfNoEntry: false })?.isFile()) {
    throw new Error('--exe must name the installed Athena.exe');
  }
  if (path.basename(parsed.exe).toLowerCase() !== 'athena.exe') {
    throw new Error('--exe basename must be Athena.exe');
  }
  return parsed;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listen(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LOOPBACK, resolve);
  });
  return server;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function assertBackendPortFree() {
  let server;
  try {
    server = await listen(BACKEND_PORT);
  } catch (error) {
    if (error?.code === 'EADDRINUSE') {
      throw new Error(`127.0.0.1:${BACKEND_PORT} is already in use; refusing to reuse an existing backend`);
    }
    throw error;
  }
  await closeServer(server);
}

async function reserveDebugPort() {
  const server = await listen(0);
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  await closeServer(server);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === BACKEND_PORT) {
    throw new Error('failed to reserve a safe CDP port');
  }
  return port;
}

function isolatedEnvironment(outputDir) {
  const env = {};
  const sourceByUpperName = new Map(
    Object.entries(process.env).map(([key, value]) => [key.toUpperCase(), value]),
  );
  for (const key of [
    'COMSPEC', 'NUMBER_OF_PROCESSORS', 'OS', 'PATHEXT',
    'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL',
    'PROCESSOR_REVISION', 'SYSTEMDRIVE', 'SYSTEMROOT', 'WINDIR',
    'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432',
    'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)', 'COMMONPROGRAMW6432',
  ]) {
    if (sourceByUpperName.has(key)) env[key] = sourceByUpperName.get(key);
  }
  const windowsDir = path.resolve(env.WINDIR || env.SYSTEMROOT || 'C:\\Windows');
  const home = path.join(outputDir, 'home');
  const appData = path.join(home, 'AppData', 'Roaming');
  const localAppData = path.join(home, 'AppData', 'Local');
  const temp = path.join(home, 'Temp');
  for (const directory of [home, appData, localAppData, temp]) fs.mkdirSync(directory, { recursive: true });
  return {
    ...env,
    USERPROFILE: home,
    HOME: home,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    TEMP: temp,
    TMP: temp,
    PATH: [path.join(windowsDir, 'System32'), windowsDir].join(path.delimiter),
  };
}

function safeError(error) {
  return {
    name: String(error?.name || 'Error').slice(0, 80),
    message: String(error?.message || error || 'unknown error').slice(0, 1000),
    code: error?.code == null ? null : String(error.code).slice(0, 80),
  };
}

async function fetchJson(url, timeoutMs = 1500) {
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

class CdpSession {
  constructor(target) {
    this.target = target;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.exceptions = [];
  }

  async connect() {
    this.socket = new WebSocket(this.target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket open timeout')), 5000);
      this.socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('CDP WebSocket failed to open'));
      }, { once: true });
    });
    this.socket.addEventListener('message', (event) => this.onMessage(event.data));
    this.socket.addEventListener('close', () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('CDP WebSocket closed'));
      }
      this.pending.clear();
    });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    return this;
  }

  onMessage(raw) {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'CDP command failed'));
      else pending.resolve(message.result || {});
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params?.exceptionDetails || {};
      this.exceptions.push({
        text: String(details.text || 'Uncaught').slice(0, 500),
        lineNumber: details.lineNumber ?? null,
        columnNumber: details.columnNumber ?? null,
        url: String(details.url || '').slice(0, 1000),
        description: String(details.exception?.description || details.exception?.value || '').slice(0, 1500),
      });
    }
  }

  send(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('CDP WebSocket is not open'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timeout: ${method}`));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(`CDP evaluation failed: ${result.exceptionDetails.text}`);
    return result.result?.value;
  }

  close() {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) this.socket.close();
  }
}

const READINESS_EXPRESSION = `(() => {
  const boot = document.getElementById('boot');
  const shell = document.getElementById('shell');
  const onboard = document.getElementById('onboard');
  const settings = document.getElementById('settings');
  const visible = (node) => !!node && !node.hidden && getComputedStyle(node).display !== 'none'
    && getComputedStyle(node).visibility !== 'hidden';
  return {
    href: location.href,
    title: document.title,
    readyState: document.readyState,
    bodyChildCount: document.body ? document.body.children.length : 0,
    hasAthenaBridge: !!window.athena,
    hasAthenaShell: !!window.AthenaShell,
    bootPhase: boot ? (boot.dataset.phase || '') : null,
    bootVisible: visible(boot),
    shellVisible: visible(shell),
    onboardingVisible: visible(onboard),
    settingsVisible: visible(settings),
    textSample: String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 240),
  };
})()`;

function isAppPage(target) {
  return target.type === 'page' && /^file:/i.test(target.url || '') && /shell\.html(?:[?#]|$)/i.test(target.url || '');
}

function installedFilePath(href) {
  try { return path.resolve(fileURLToPath(href)); } catch { return ''; }
}

function isWithin(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function discoverPages(debugPort, sessions, deadline) {
  let lastTargets = [];
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://${LOOPBACK}:${debugPort}/json/list`, 1000);
      lastTargets = Array.isArray(targets) ? targets : [];
    } catch {
      lastTargets = [];
    }
    for (const target of lastTargets.filter(isAppPage)) {
      if (!sessions.has(target.id) && target.webSocketDebuggerUrl) {
        const session = await new CdpSession(target).connect();
        sessions.set(target.id, session);
      }
    }
    if (sessions.size > 0) return lastTargets;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('installed app did not expose a shell page through CDP');
}

async function inspectReadyPages(debugPort, resourcesApp, sessions, deadline) {
  let targets = await discoverPages(debugPort, sessions, deadline);
  let observations = [];
  while (Date.now() < deadline) {
    try {
      const current = await fetchJson(`http://${LOOPBACK}:${debugPort}/json/list`, 1000);
      targets = Array.isArray(current) ? current : targets;
    } catch { /* keep the last target inventory while the app is busy */ }
    for (const target of targets.filter(isAppPage)) {
      if (!sessions.has(target.id) && target.webSocketDebuggerUrl) {
        sessions.set(target.id, await new CdpSession(target).connect());
      }
    }
    observations = [];
    for (const [id, session] of sessions) {
      try {
        const state = await session.evaluate(READINESS_EXPRESSION);
        const loadedPath = installedFilePath(state.href);
        observations.push({ id, target: session.target, state, loadedPath });
      } catch (error) {
        observations.push({ id, target: session.target, error: safeError(error), loadedPath: '' });
      }
    }
    const ready = observations.filter(({ state, loadedPath }) => state
      && state.readyState === 'complete'
      && state.bodyChildCount > 0
      && state.title === 'Athena'
      && state.hasAthenaBridge
      && state.hasAthenaShell
      && loadedPath
      && isWithin(loadedPath, resourcesApp));
    const contentReady = ready.some(({ state }) => state.shellVisible && !state.bootVisible
      && (state.onboardingVisible || state.textSample.length > 0));
    if (contentReady) return observations;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('Athena shell did not reach boot-complete content readiness');
}

async function waitForManifest(deadline) {
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const manifest = await fetchJson(`http://${LOOPBACK}:${BACKEND_PORT}/api/v1/llm/manifest`, 1500);
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error('backend manifest was not a JSON object');
      }
      return manifest;
    } catch (error) {
      lastError = error;
      await delay(POLL_INTERVAL_MS);
    }
  }
  throw new Error(`bundled backend manifest did not become ready: ${lastError?.message || 'timeout'}`);
}

function compactManifest(manifest) {
  return {
    keys: Object.keys(manifest).sort().slice(0, 100),
    providerCount: Array.isArray(manifest.providers) ? manifest.providers.length : null,
    modelCount: Array.isArray(manifest.models) ? manifest.models.length : null,
  };
}

function verifyBundledPython(resourcesDir, resourcesApp, env) {
  const candidates = [
    path.join(resourcesDir, 'backend', '.venv', 'Scripts', 'python.exe'),
    path.join(resourcesApp, 'backend', '.venv', 'Scripts', 'python.exe'),
  ];
  const pythonExe = candidates.find((candidate) => fs.statSync(candidate, { throwIfNoEntry: false })?.isFile());
  if (!pythonExe) throw new Error('bundled backend Python executable is missing');
  const backendDir = path.resolve(pythonExe, '..', '..', '..');
  const versionRun = spawnSync(pythonExe, ['--version'], {
    cwd: backendDir, env, windowsHide: true, encoding: 'utf8', timeout: 15_000,
  });
  if (versionRun.status !== 0) throw new Error(`bundled Python --version failed (${versionRun.status})`);
  const importRun = spawnSync(pythonExe, [
    '-c',
    'import json, fastapi, pandas, numpy, mcp; print(json.dumps({"fastapi": fastapi.__version__, "pandas": pandas.__version__, "numpy": numpy.__version__, "mcp": getattr(mcp, "__version__", "present")}))',
  ], {
    cwd: backendDir, env, windowsHide: true, encoding: 'utf8', timeout: 30_000,
  });
  if (importRun.status !== 0) {
    throw new Error(`bundled Python imports failed (${importRun.status}): ${String(importRun.stderr || '').trim().slice(0, 500)}`);
  }
  let imports;
  try { imports = JSON.parse(String(importRun.stdout || '').trim()); } catch {
    throw new Error('bundled Python import probe returned invalid JSON');
  }
  return {
    executable: pythonExe,
    backendDir,
    version: String(versionRun.stdout || versionRun.stderr || '').trim().slice(0, 120),
    imports,
  };
}

async function captureScreenshots(observations, sessions, outputDir) {
  const screenshots = [];
  let index = 0;
  for (const observation of observations.filter(({ state }) => state)) {
    index += 1;
    const session = sessions.get(observation.id);
    const capture = await session.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false,
    });
    if (!capture.data) throw new Error(`CDP screenshot was empty for page ${observation.id}`);
    const filename = `page-${String(index).padStart(2, '0')}.png`;
    fs.writeFileSync(path.join(outputDir, filename), Buffer.from(capture.data, 'base64'));
    screenshots.push({ pageId: observation.id, filename });
  }
  if (!screenshots.length) throw new Error('no installed app screenshot was captured');
  return screenshots;
}

function processIdentity(pid, expectedImage) {
  const tasklist = path.join(process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows', 'System32', 'tasklist.exe');
  const result = spawnSync(tasklist, ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
    windowsHide: true, encoding: 'utf8', timeout: 5000,
  });
  const output = String(result.stdout || '').trim();
  if (result.status !== 0 || !output || /^INFO:/i.test(output)) return { running: false, imageMatches: false };
  const match = /^"([^"]+)","(\d+)"/.exec(output);
  return {
    running: !!match && Number(match[2]) === pid,
    imageMatches: !!match && match[1].toLowerCase() === expectedImage.toLowerCase(),
    imageName: match?.[1] || null,
  };
}

function killOwnedTree(child, expectedImage) {
  if (!child || child.exitCode !== null) return { attempted: false, reason: 'already-exited' };
  const identity = processIdentity(child.pid, expectedImage);
  if (!identity.running) return { attempted: false, reason: 'process-not-running', identity };
  if (!identity.imageMatches) return { attempted: false, reason: 'pid-image-mismatch', identity };
  const taskkill = path.join(process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
  const result = spawnSync(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
    windowsHide: true, encoding: 'utf8', timeout: 15_000,
  });
  const after = processIdentity(child.pid, expectedImage);
  return {
    attempted: true,
    status: result.status,
    success: result.status === 0 || !after.running,
    identity,
    after,
    stderr: String(result.stderr || '').trim().slice(0, 500),
  };
}

async function main() {
  const startedAt = Date.now();
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (error) {
    process.stderr.write(`installer smoke: ERROR - ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(args.output, { recursive: true });
  const resultPath = path.join(args.output, 'smoke-result.json');
  const stdoutPath = path.join(args.output, 'app-stdout.log');
  const stderrPath = path.join(args.output, 'app-stderr.log');
  const resourcesDir = path.join(path.dirname(args.exe), 'resources');
  const resourcesApp = path.join(resourcesDir, 'app');
  const userData = path.join(args.output, 'profile');
  fs.mkdirSync(userData, { recursive: true });
  const env = isolatedEnvironment(args.output);
  const report = {
    schemaVersion: 1,
    kind: 'athena-installed-windows-smoke',
    generatedAt: new Date().toISOString(),
    outcome: 'ERROR',
    executable: args.exe,
    outputDirectory: args.output,
    isolation: {
      userData,
      home: env.HOME,
      credentialEnvironmentRemoved: true,
      minimalWindowsPath: env.PATH,
      providerRequestsIssuedByHarness: false,
      loginAttemptedByHarness: false,
      tradeAttemptedByHarness: false,
    },
    resources: { app: resourcesApp },
    pages: [],
    runtimeExceptions: [],
    screenshots: [],
    backend: null,
    bundledPython: null,
    process: null,
    cleanup: null,
    limitations: [
      'External provider CLI availability and provider login are prerequisites, not exercised by this smoke.',
      'No provider request, account login, broker request, or trade action is performed.',
    ],
  };
  let child = null;
  const sessions = new Map();
  let stdoutStream = null;
  let stderrStream = null;
  try {
    if (!fs.statSync(resourcesApp, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error('installed resources/app directory is missing');
    }
    for (const required of ['main.js', 'shell.html']) {
      if (!fs.statSync(path.join(resourcesApp, required), { throwIfNoEntry: false })?.isFile()) {
        throw new Error(`installed resources/app/${required} is missing`);
      }
    }
    for (const envFile of [path.join(resourcesDir, 'backend', '.env'), path.join(resourcesApp, 'backend', '.env')]) {
      if (fs.existsSync(envFile)) throw new Error(`installer contains a backend credential file: ${envFile}`);
    }
    await assertBackendPortFree();
    report.backend = { portWasFreeBeforeLaunch: true };
    const debugPort = await reserveDebugPort();
    report.process = { debugPort, pid: null, exit: null };
    stdoutStream = fs.createWriteStream(stdoutPath, { flags: 'w' });
    stderrStream = fs.createWriteStream(stderrPath, { flags: 'w' });
    child = spawn(args.exe, [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userData}`,
    ], {
      cwd: path.dirname(args.exe),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    report.process.pid = child.pid;
    child.stdout.pipe(stdoutStream);
    child.stderr.pipe(stderrStream);
    child.once('exit', (code, signal) => { report.process.exit = { code, signal }; });
    child.once('error', (error) => { report.process.spawnError = safeError(error); });
    const deadline = startedAt + STARTUP_TIMEOUT_MS;
    const [observations, manifest] = await Promise.all([
      inspectReadyPages(debugPort, resourcesApp, sessions, deadline),
      waitForManifest(deadline),
    ]);
    report.pages = observations.map(({ id, target, state, error, loadedPath }) => ({
      id,
      type: target.type,
      url: target.url,
      loadedPath,
      state: state || null,
      error: error || null,
      underInstalledResourcesApp: !!loadedPath && isWithin(loadedPath, resourcesApp),
    }));
    if (child.exitCode !== null || report.process.spawnError) {
      throw new Error(`installed Athena process exited during startup (${child.exitCode})`);
    }
    fs.writeFileSync(path.join(args.output, 'backend-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    report.backend = {
      ...report.backend,
      ready: true,
      url: `http://${LOOPBACK}:${BACKEND_PORT}/api/v1/llm/manifest`,
      manifest: compactManifest(manifest),
      manifestEvidence: 'backend-manifest.json',
    };
    report.bundledPython = verifyBundledPython(resourcesDir, resourcesApp, env);
    report.screenshots = await captureScreenshots(observations, sessions, args.output);
    await delay(500);
    report.runtimeExceptions = [...sessions.values()].flatMap((session) => (
      session.exceptions.map((exception) => ({ pageId: session.target.id, ...exception }))
    ));
    if (report.runtimeExceptions.length) {
      throw new Error(`renderer raised ${report.runtimeExceptions.length} Runtime.exceptionThrown event(s)`);
    }
    report.outcome = 'PASS';
  } catch (error) {
    report.error = safeError(error);
  } finally {
    report.runtimeExceptions = [...sessions.values()].flatMap((session) => (
      session.exceptions.map((exception) => ({ pageId: session.target.id, ...exception }))
    ));
    for (const session of sessions.values()) session.close();
    report.cleanup = killOwnedTree(child, path.basename(args.exe));
    if ((report.cleanup.attempted && !report.cleanup.success)
      || report.cleanup.reason === 'pid-image-mismatch') {
      report.outcome = 'ERROR';
      report.error ||= safeError(new Error(`owned process cleanup failed: ${report.cleanup.reason || report.cleanup.status}`));
    }
    if (stdoutStream) stdoutStream.end();
    if (stderrStream) stderrStream.end();
    report.durationMs = Date.now() - startedAt;
    fs.writeFileSync(resultPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  const summary = [
    `installer smoke: ${report.outcome}`,
    `pages=${report.pages.filter((page) => page.state).length}`,
    `exceptions=${report.runtimeExceptions.length}`,
    `backend=${report.backend?.ready ? 'ready' : 'not-ready'}`,
    `evidence=${resultPath}`,
  ].join(' ');
  (report.outcome === 'PASS' ? process.stdout : process.stderr).write(`${summary}\n`);
  if (report.outcome !== 'PASS') process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`installer smoke: FATAL - ${error.message}\n`);
  process.exitCode = 1;
});
