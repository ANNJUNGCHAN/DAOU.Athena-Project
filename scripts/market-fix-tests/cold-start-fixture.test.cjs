'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createSpawnAdapter,
  firstRequestDelay,
  fixtureUvicornArgs,
  requireOwnedEphemeralPort,
  sanitizeChildEnv,
} = require('./cold-start-fixture.cjs');

test('sanitized child environment removes Athena credentials and pins private runtime paths', () => {
  const source = {
    PATH: 'bin', SYSTEMROOT: 'C:/Windows', HOME: 'real-home', USERPROFILE: 'real-profile',
    APPDATA: 'real-appdata', LOCALAPPDATA: 'real-localappdata', TEMP: 'real-temp', TMP: 'real-tmp',
    PYTHONPATH: 'foreign', HTTP_PROXY: 'http://proxy.invalid', OPENAI_API_KEY: 'generic-secret',
    AWS_SECRET_ACCESS_KEY: 'generic-secret',
    ATHENA_KIWOOM_APP_KEY: 'secret', Athena_Local_Bearer_Token: 'secret',
  };
  const privateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-private-env-'));
  const backendRoot = path.join(privateRoot, 'backend');
  fs.mkdirSync(backendRoot);
  const env = sanitizeChildEnv(source, { privateHome: privateRoot, backendRoot });
  assert.deepEqual(env, {
    PATH: 'bin',
    SYSTEMROOT: 'C:/Windows',
    HOME: path.join(privateRoot, 'home'),
    USERPROFILE: path.join(privateRoot, 'home'),
    APPDATA: path.join(privateRoot, 'appdata'),
    LOCALAPPDATA: path.join(privateRoot, 'localappdata'),
    TEMP: path.join(privateRoot, 'temp'),
    TMP: path.join(privateRoot, 'temp'),
    PYTHONPATH: backendRoot,
    PYTHONNOUSERSITE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUTF8: '1',
    DAOU_FIXTURE_PRIVATE_ROOT: privateRoot,
    DAOU_FIXTURE_BACKEND_ROOT: backendRoot,
  });
  for (const key of ['HTTP_PROXY', 'OPENAI_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'ATHENA_KIWOOM_APP_KEY']) {
    assert.equal(Object.hasOwn(env, key), false);
  }
  for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP']) {
    assert.equal(fs.statSync(env[key]).isDirectory(), true);
  }
  assert.equal(source.ATHENA_KIWOOM_APP_KEY, 'secret');
  for (const directory of ['home', 'appdata', 'localappdata', 'temp', 'backend']) fs.rmdirSync(path.join(privateRoot, directory));
  fs.rmdirSync(privateRoot);
});

test('fixture uvicorn arguments bind one worker to an owned loopback port', () => {
  const args = fixtureUvicornArgs({ fixtureDir: 'C:/fixture', port: 18010 });
  assert.deepEqual(args, [
    '-m', 'uvicorn', 'backend_fixture:app', '--app-dir', path.resolve('C:/fixture'),
    '--host', '127.0.0.1', '--port', '18010', '--workers', '1', '--log-level', 'warning',
  ]);
});

test('fixture port guard rejects the product port and invalid port values', () => {
  for (const value of [8010, 0, 1023, 65536, 18010.5]) {
    assert.throws(() => requireOwnedEphemeralPort(value), /non-product port/);
  }
});

test('spawn adapter preserves launcher contract while replacing only fixture-owned process details', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-cold-helper-'));
  const backendRoot = path.join(root, 'backend');
  const fixtureDir = path.join(root, 'fixture');
  const pythonExe = path.join(root, 'python.exe');
  fs.mkdirSync(backendRoot);
  fs.mkdirSync(fixtureDir);
  fs.writeFileSync(pythonExe, 'fixture');
  let captured = null;
  const fakeChild = { pid: 1234 };
  try {
    const adapter = createSpawnAdapter({
      expectedLauncherArgs: ['-m', 'uvicorn', 'athena_api.main:app'],
      pythonExe, backendRoot, fixtureDir, privateHome: root, port: 18011,
      baseEnv: { PATH: 'bin', ATHENA_LOCAL_BEARER_TOKEN: 'secret' },
      spawnImpl: (...args) => { captured = args; return fakeChild; },
    });
    const result = adapter('ignored-launcher-python', ['-m', 'uvicorn', 'athena_api.main:app'], { cwd: backendRoot });
    assert.equal(result, fakeChild);
    assert.equal(captured[0], pythonExe);
    assert.equal(captured[1].includes('backend_fixture:app'), true);
    assert.equal(captured[2].cwd, root);
    assert.equal(Object.keys(captured[2].env).some((key) => /^ATHENA_/i.test(key)), false);
  } finally {
    fs.rmSync(pythonExe, { force: true });
    fs.rmdirSync(fixtureDir);
    fs.rmdirSync(backendRoot);
    for (const directory of ['home', 'appdata', 'localappdata', 'temp']) fs.rmdirSync(path.join(root, directory));
    fs.rmdirSync(root);
  }
});

test('spawn adapter rejects changed launcher arguments before spawning', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-cold-contract-'));
  const backendRoot = path.join(root, 'backend');
  const fixtureDir = path.join(root, 'fixture');
  const pythonExe = path.join(root, 'python.exe');
  fs.mkdirSync(backendRoot);
  fs.mkdirSync(fixtureDir);
  fs.writeFileSync(pythonExe, 'fixture');
  let spawned = false;
  try {
    const adapter = createSpawnAdapter({
      expectedLauncherArgs: ['expected'], pythonExe, backendRoot, fixtureDir,
      privateHome: root, port: 18012, spawnImpl: () => { spawned = true; },
    });
    assert.throws(() => adapter('ignored', ['changed'], { cwd: backendRoot }), /arguments changed/);
    assert.equal(spawned, false);
  } finally {
    fs.rmSync(pythonExe, { force: true });
    fs.rmdirSync(fixtureDir);
    fs.rmdirSync(backendRoot);
    fs.rmdirSync(root);
  }
});

test('delayed existing-server fixture delays only its first manifest request', () => {
  assert.equal(firstRequestDelay(1, 1700), 1700);
  assert.equal(firstRequestDelay(2, 1700), 0);
  assert.equal(firstRequestDelay(3, 1700), 0);
});
