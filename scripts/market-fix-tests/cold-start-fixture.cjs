'use strict';

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const LOOPBACK_HOST = '127.0.0.1';
const PRODUCT_PORT = 8010;

function requireAbsoluteExistingFile(value, label) {
  const resolved = path.resolve(String(value || ''));
  if (!path.isAbsolute(String(value || '')) || !fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`${label} must be an existing absolute file`);
  }
  return resolved;
}

function requireAbsoluteExistingDirectory(value, label) {
  const resolved = path.resolve(String(value || ''));
  if (!path.isAbsolute(String(value || '')) || !fs.statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`${label} must be an existing absolute directory`);
  }
  return resolved;
}

function requireOwnedEphemeralPort(value) {
  if (!Number.isInteger(value) || value < 1024 || value > 65535 || value === PRODUCT_PORT) {
    throw new Error('fixture port must be an unprivileged non-product port');
  }
  return value;
}

function sanitizeChildEnv(baseEnv, { privateHome, backendRoot }) {
  const env = {};
  const sourceByUpperName = new Map(
    Object.entries(baseEnv || {}).map(([key, value]) => [key.toUpperCase(), value]),
  );
  for (const key of [
    'COMSPEC', 'NUMBER_OF_PROCESSORS', 'OS', 'PATH', 'PATHEXT',
    'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL',
    'PROCESSOR_REVISION', 'SYSTEMROOT', 'WINDIR',
  ]) {
    if (sourceByUpperName.has(key)) env[key] = sourceByUpperName.get(key);
  }
  const privateRoot = requireAbsoluteExistingDirectory(privateHome, 'privateHome');
  const privatePaths = {
    HOME: path.join(privateRoot, 'home'),
    USERPROFILE: path.join(privateRoot, 'home'),
    APPDATA: path.join(privateRoot, 'appdata'),
    LOCALAPPDATA: path.join(privateRoot, 'localappdata'),
    TEMP: path.join(privateRoot, 'temp'),
    TMP: path.join(privateRoot, 'temp'),
  };
  for (const directory of new Set(Object.values(privatePaths))) fs.mkdirSync(directory, { recursive: true });
  Object.assign(env, privatePaths);
  env.PYTHONPATH = path.resolve(backendRoot);
  env.PYTHONNOUSERSITE = '1';
  env.PYTHONDONTWRITEBYTECODE = '1';
  env.PYTHONUTF8 = '1';
  env.DAOU_FIXTURE_PRIVATE_ROOT = privateRoot;
  env.DAOU_FIXTURE_BACKEND_ROOT = path.resolve(backendRoot);
  return env;
}

function fixtureUvicornArgs({ fixtureDir, port }) {
  return [
    '-m', 'uvicorn', 'backend_fixture:app',
    '--app-dir', path.resolve(fixtureDir),
    '--host', LOOPBACK_HOST,
    '--port', String(requireOwnedEphemeralPort(port)),
    '--workers', '1',
    '--log-level', 'warning',
  ];
}

function createSpawnAdapter({
  expectedLauncherArgs,
  pythonExe,
  backendRoot,
  fixtureDir,
  privateHome,
  port,
  baseEnv = process.env,
  spawnImpl = spawn,
  onSpawn = () => {},
}) {
  const expected = JSON.stringify(expectedLauncherArgs);
  const executable = requireAbsoluteExistingFile(pythonExe, 'pythonExe');
  const launcherCwd = requireAbsoluteExistingDirectory(backendRoot, 'backendRoot');
  const childCwd = requireAbsoluteExistingDirectory(privateHome, 'privateHome');
  const appDir = requireAbsoluteExistingDirectory(fixtureDir, 'fixtureDir');
  requireOwnedEphemeralPort(port);
  return (_launcherPython, launcherArgs, launcherOptions) => {
    if (JSON.stringify(launcherArgs) !== expected) throw new Error('launcher uvicorn arguments changed');
    if (path.resolve(launcherOptions?.cwd || '') !== launcherCwd) throw new Error('launcher backend cwd changed');
    const child = spawnImpl(executable, fixtureUvicornArgs({ fixtureDir: appDir, port }), {
      cwd: childCwd,
      env: sanitizeChildEnv(baseEnv, { privateHome: childCwd, backendRoot: launcherCwd }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    onSpawn(child);
    return child;
  };
}

async function reserveEphemeralPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, LOOPBACK_HOST, resolve);
  });
  const address = server.address();
  const port = requireOwnedEphemeralPort(address.port);
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitUntil(checkFn, timeoutMs, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await checkFn()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (Date.now() < deadline);
  return false;
}

function firstRequestDelay(requestNumber, delayMs) {
  return requestNumber === 1 ? delayMs : 0;
}

module.exports = {
  LOOPBACK_HOST,
  PRODUCT_PORT,
  createSpawnAdapter,
  firstRequestDelay,
  fixtureUvicornArgs,
  requireOwnedEphemeralPort,
  reserveEphemeralPort,
  sanitizeChildEnv,
  waitUntil,
};
