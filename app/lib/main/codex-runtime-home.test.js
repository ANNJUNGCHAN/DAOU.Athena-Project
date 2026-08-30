'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {
  resolveCodexRuntimeHome,
  createCodexRuntime,
} = require('./codex-runtime-home');

const TEMP_PREFIX = 'athena-codex-runtime-home-test-';
const TEMP_MARKER = '.athena-codex-runtime-home-test';

function createMarkedTempDir() {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(tempRoot, TEMP_PREFIX));
  fs.writeFileSync(path.join(dir, TEMP_MARKER), 'owned by codex-runtime-home.test.js\n');
  return dir;
}

function removeMarkedTempDir(dir) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const resolved = fs.realpathSync(dir);
  assert.equal(path.dirname(resolved), tempRoot);
  assert.ok(path.basename(resolved).startsWith(TEMP_PREFIX));
  assert.ok(fs.existsSync(path.join(resolved, TEMP_MARKER)));
  fs.rmSync(resolved, { recursive: true, force: true });
}

function fakeChild() {
  const child = new EventEmitter();
  child.pid = 4321;
  child.kill = () => true;
  return child;
}

test('resolveCodexRuntimeHome: injected userData path owns one fixed codex-runtime child', () => {
  const userDataPath = path.join('C:', 'Users', 'tester', 'Athena');
  assert.equal(
    resolveCodexRuntimeHome(userDataPath),
    path.join(userDataPath, 'codex-runtime'),
  );
});

test('module can use a marked private temp home without importing or mutating Electron/global config', (t) => {
  const tempDir = createMarkedTempDir();
  t.after(() => removeMarkedTempDir(tempDir));
  const runtimeHome = path.join(tempDir, 'private-home');
  const calls = [];
  const runtime = createCodexRuntime({
    runtimeHome,
    codexExecutable: 'codex-test.exe',
    spawnImpl(command, argv, options) {
      calls.push({ command, argv, options });
      return fakeChild();
    },
  });

  const originalCodexHome = process.env.CODEX_HOME;
  runtime.spawnPrivateHomeCommand(['login', 'status'], {
    timeoutMs: 5_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'codex-test.exe');
  assert.deepEqual(calls[0].argv, ['login', 'status']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.timeout, 5_000);
  assert.deepEqual(calls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(calls[0].options.env.CODEX_HOME, runtimeHome);
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path');
  assert.equal(calls[0].options.env[pathKey], process.env[pathKey]);
  assert.equal(process.env.CODEX_HOME, originalCodexHome);
});

test('spawnPrivateHomeCommand: account command cannot receive generation context or gateway env', () => {
  let observed;
  const runtime = createCodexRuntime({
    runtimeHome: 'RUNTIME_HOME',
    codexExecutable: 'codex',
    spawnImpl(command, argv, options) {
      observed = { command, argv, options };
      return fakeChild();
    },
  });

  const child = runtime.spawnPrivateHomeCommand(['login'], { stdio: 'inherit' });

  assert.equal(child.pid, 4321);
  assert.deepEqual(observed.argv, ['login']);
  assert.equal(observed.options.env.CODEX_HOME, 'RUNTIME_HOME');
  assert.equal('runtimeGeneration' in observed.options, false);
  assert.equal('spawnContext' in observed.options, false);
});

test('spawnPrivateHomeInteractiveCommand: Windows launcher uses fixed script and private home without shell interpolation', () => {
  let observed;
  const originalCodexHome = process.env.CODEX_HOME;
  const runtime = createCodexRuntime({
    runtimeHome: 'ATHENA_PRIVATE_HOME',
    codexExecutable: 'C:\\Program Files\\Codex & Tools\\codex.exe',
    platform: 'win32',
    spawnImpl(command, argv, options) {
      observed = { command, argv, options };
      return fakeChild();
    },
  });

  runtime.spawnPrivateHomeInteractiveCommand(['login'], {
    title: 'Athena · Codex 로그인 & 안전',
  });

  assert.equal(observed.command, 'powershell.exe');
  assert.deepEqual(observed.argv.slice(0, 2), ['-NoLogo', '-NoProfile']);
  assert.equal(observed.argv[2], '-Command');
  assert.equal(observed.argv[3].includes('C:\\Program Files'), false);
  assert.equal(observed.argv[3].includes('로그인 & 안전'), false);
  assert.match(observed.argv[3], /Remove-Item Env:ATHENA_CODEX_EXECUTABLE/);
  assert.equal(observed.options.shell, false);
  assert.equal(observed.options.windowsHide, false);
  assert.equal(observed.options.detached, true);
  assert.equal(observed.options.stdio, 'ignore');
  assert.equal(observed.options.env.CODEX_HOME, 'ATHENA_PRIVATE_HOME');
  assert.equal(observed.options.env.ATHENA_CODEX_EXECUTABLE, 'C:\\Program Files\\Codex & Tools\\codex.exe');
  assert.equal(observed.options.env.ATHENA_CODEX_ARGV_JSON, '["login"]');
  assert.equal(observed.options.env.ATHENA_CODEX_WINDOW_TITLE, 'Athena · Codex 로그인 & 안전');
  assert.equal(process.env.CODEX_HOME, originalCodexHome);
});

test('spawnPrivateHomeInteractiveCommand: non-Windows launch is argv-safe and keeps global home unchanged', () => {
  let observed;
  const originalCodexHome = process.env.CODEX_HOME;
  const runtime = createCodexRuntime({
    runtimeHome: '/private/codex-home',
    codexExecutable: '/opt/Codex Tools/codex',
    platform: 'linux',
    spawnImpl(command, argv, options) {
      observed = { command, argv, options };
      return fakeChild();
    },
  });

  runtime.spawnPrivateHomeInteractiveCommand(['login']);

  assert.equal(observed.command, '/opt/Codex Tools/codex');
  assert.deepEqual(observed.argv, ['login']);
  assert.equal(observed.options.shell, false);
  assert.equal(observed.options.env.CODEX_HOME, '/private/codex-home');
  assert.equal(process.env.CODEX_HOME, originalCodexHome);
});

test('spawnGenerationAppServer: asserts, builds fresh Codex env, spawns fixed argv, then registers ownership', () => {
  const order = [];
  const generationEnv = {
    PATH: 'generation-bin',
    HOME: 'preserved-home',
    USERPROFILE: 'preserved-profile',
    CODEX_HOME: 'must-be-overridden',
    ATHENA_GATEWAY_CAPABILITY_TOKEN: 'generation-secret',
  };
  const child = fakeChild();
  const terminationHandle = { terminate: async () => {} };
  let spawnCall;
  let registration;
  const runtime = createCodexRuntime({
    runtimeHome: 'ATHENA_PRIVATE_HOME',
    codexExecutable: 'codex.exe',
    spawnImpl(command, argv, options) {
      order.push('spawn');
      spawnCall = { command, argv, options };
      return child;
    },
  });
  const generationContext = {
    runtimeGeneration: 7,
    processOwnerId: 'owner-7',
    spawnContext: {
      assertCurrent() { order.push('assert'); },
      buildEnv(provider) {
        order.push(`build:${provider}`);
        return generationEnv;
      },
      registerChild(registeredChild, metadata) {
        order.push('register');
        registration = { registeredChild, metadata };
        return terminationHandle;
      },
    },
  };

  const registered = runtime.spawnGenerationAppServer(generationContext);

  assert.deepEqual(order, ['assert', 'build:codex', 'assert', 'spawn', 'register']);
  assert.equal(spawnCall.command, 'codex.exe');
  assert.deepEqual(spawnCall.argv, ['app-server', '--stdio']);
  assert.equal(spawnCall.options.shell, false);
  assert.equal(spawnCall.options.windowsHide, true);
  assert.deepEqual(spawnCall.options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.deepEqual(spawnCall.options.env, {
    ...generationEnv,
    CODEX_HOME: 'ATHENA_PRIVATE_HOME',
  });
  assert.equal(spawnCall.options.env.HOME, 'preserved-home');
  assert.equal(spawnCall.options.env.USERPROFILE, 'preserved-profile');
  assert.equal(registration.registeredChild, child);
  assert.deepEqual(registration.metadata, {
    provider: 'codex',
    runtimeGeneration: 7,
    processOwnerId: 'owner-7',
  });
  assert.deepEqual(registered, { child, terminationHandle });
  assert.equal(generationEnv.CODEX_HOME, 'must-be-overridden', 'buildEnv result is not mutated');
});

test('spawnGenerationAppServer: a stale generation fails before buildEnv and spawn', () => {
  let built = false;
  let spawned = false;
  const runtime = createCodexRuntime({
    runtimeHome: 'private',
    codexExecutable: 'codex',
    spawnImpl() { spawned = true; return fakeChild(); },
  });
  const generationContext = {
    runtimeGeneration: 1,
    processOwnerId: 'owner',
    spawnContext: {
      assertCurrent() { throw new Error('stale generation'); },
      buildEnv() { built = true; return {}; },
      registerChild() { throw new Error('must not register'); },
    },
  };

  assert.throws(
    () => runtime.spawnGenerationAppServer(generationContext),
    /stale generation/,
  );
  assert.equal(built, false);
  assert.equal(spawned, false);
});

test('spawnGenerationAppServer: a generation fenced after env build never spawns', () => {
  let assertCount = 0;
  let spawned = false;
  const runtime = createCodexRuntime({
    runtimeHome: 'private',
    codexExecutable: 'codex',
    spawnImpl() { spawned = true; return fakeChild(); },
  });
  const generationContext = {
    runtimeGeneration: 2,
    processOwnerId: 'owner',
    spawnContext: {
      assertCurrent() {
        assertCount += 1;
        if (assertCount === 2) throw new Error('generation rotated');
      },
      buildEnv() { return { SECRET: 'ephemeral' }; },
      registerChild() { throw new Error('must not register'); },
    },
  };

  assert.throws(
    () => runtime.spawnGenerationAppServer(generationContext),
    /generation rotated/,
  );
  assert.equal(spawned, false);
});
