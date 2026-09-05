'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createCliAccounts } = require('./cli-accounts');

function createChild() {
  const child = new EventEmitter();
  child.killCalls = 0;
  child.unrefCalls = 0;
  child.kill = () => { child.killCalls += 1; return true; };
  child.unref = () => { child.unrefCalls += 1; };
  return child;
}

function createHarness(t, { initialState, statusOutcomes = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-cli-accounts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'user-data');
  const globalHome = path.join(root, 'global-home');
  const stateFile = path.join(userData, 'athena-cli-accounts.json');
  fs.mkdirSync(userData, { recursive: true });
  if (initialState) fs.writeFileSync(stateFile, JSON.stringify(initialState));

  const statusCalls = [];
  const saves = [];
  const pending = [];
  const runtime = {
    spawnPrivateHomeCommand(argv, options) {
      const child = createChild();
      const call = { argv, options, child };
      statusCalls.push(call);
      const outcome = statusOutcomes.shift();
      if (outcome === 'pending') pending.push(child);
      else queueMicrotask(() => {
        if (outcome === 'error') child.emit('error', new Error('spawn failed: secret-output'));
        else child.emit('exit', outcome === undefined ? 0 : outcome, null);
      });
      return child;
    },
  };
  const accounts = createCliAccounts({
    appImpl: { getPath: () => userData },
    runtime,
    fsImpl: fs,
    osImpl: { homedir: () => globalHome },
    spawnImpl: () => { throw new Error('unexpected spawn'); },
    statusTimeoutMs: 20,
    writeStateAtomicImpl(file, state) {
      saves.push(structuredClone(state));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(state, null, 2));
    },
  });
  return { accounts, stateFile, globalHome, statusCalls, saves, pending };
}

test('list preserves the existing provider-grouped IPC shape and fixed order', async (t) => {
  const { accounts, statusCalls } = createHarness(t, {
    statusOutcomes: [0],
    initialState: {
      activeId: 'codex:athena-runtime',
      accounts: {
        'codex:athena-runtime': {
          id: 'codex:athena-runtime', providerId: 'codex', label: 'Codex', source: 'detected', addedAt: 'old',
        },
      },
    },
  });

  const result = await accounts.list();

  assert.deepEqual(result, {
    providers: [
      { id: 'claude', name: 'Claude', connected: false, accounts: [] },
      {
        id: 'codex',
        name: 'Codex',
        connected: true,
        // addedAt·current는 설정 모델 카드(2026-09-05)가 부제·[제거] 잠금에 쓴다.
        accounts: [{ id: 'codex:athena-runtime', label: 'Codex', active: true, addedAt: 'old', current: true }],
      },
    ],
  });
  assert.deepEqual(statusCalls[0].argv, ['login', 'status']);
  assert.deepEqual(statusCalls[0].options, { timeoutMs: 20, stdio: 'ignore' });
});

// Claude 로그인 감지 픽스처 — detectClaude()가 보는 두 파일(자격증명 존재 +
// .claude.json의 oauthAccount.emailAddress)을 harness의 globalHome에 심는다.
function seedClaudeLogin(globalHome, email) {
  fs.mkdirSync(path.join(globalHome, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(globalHome, '.claude', '.credentials.json'), '{}');
  fs.writeFileSync(path.join(globalHome, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: email } }));
}

const TWO_CLAUDE_LOGINS = {
  activeId: 'claude:old@example.com',
  accounts: {
    'claude:old@example.com': {
      id: 'claude:old@example.com', providerId: 'claude', label: 'old@example.com', source: 'detected', addedAt: '2026-08-08T08:45:00.000Z',
    },
    'claude:now@example.com': {
      id: 'claude:now@example.com', providerId: 'claude', label: 'now@example.com', source: 'detected', addedAt: '2026-08-10T07:49:00.000Z',
    },
  },
};

test('list marks only the login the Claude CLI currently holds as current', async (t) => {
  const { accounts, globalHome } = createHarness(t, { statusOutcomes: [1], initialState: TWO_CLAUDE_LOGINS });
  seedClaudeLogin(globalHome, 'now@example.com');

  const { providers } = await accounts.list();

  assert.deepEqual(providers[0].accounts, [
    { id: 'claude:old@example.com', label: 'old@example.com', active: true, addedAt: '2026-08-08T08:45:00.000Z', current: false },
    { id: 'claude:now@example.com', label: 'now@example.com', active: false, addedAt: '2026-08-10T07:49:00.000Z', current: true },
  ]);
});

test('remove drops a previous Claude login and hands active over to the current one', async (t) => {
  const { accounts, globalHome, stateFile } = createHarness(t, { statusOutcomes: [1], initialState: TWO_CLAUDE_LOGINS });
  seedClaudeLogin(globalHome, 'now@example.com');

  const result = await accounts.remove('claude:old@example.com');

  assert.deepEqual(result, { ok: true });
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(state.activeId, 'claude:now@example.com');
  assert.deepEqual(Object.keys(state.accounts), ['claude:now@example.com']);
});

test('remove refuses the login the Claude CLI currently holds and leaves state untouched', async (t) => {
  const { accounts, globalHome, stateFile } = createHarness(t, { statusOutcomes: [1], initialState: TWO_CLAUDE_LOGINS });
  seedClaudeLogin(globalHome, 'now@example.com');

  const result = await accounts.remove('claude:now@example.com');

  assert.equal(result.ok, false);
  assert.match(result.message, /현재 Claude CLI/);
  assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')), TWO_CLAUDE_LOGINS);
});

test('remove on the Codex runtime account is the private-home logout', async (t) => {
  const { accounts, statusCalls, stateFile } = createHarness(t, {
    statusOutcomes: [0, 1],
    initialState: {
      activeId: 'codex:athena-runtime',
      accounts: {
        'codex:athena-runtime': {
          id: 'codex:athena-runtime', providerId: 'codex', label: 'Codex', source: 'detected', addedAt: 'old',
        },
      },
    },
  });

  const result = await accounts.remove('codex:athena-runtime');

  assert.deepEqual(result, { ok: true, codexStatus: 'disconnected' });
  assert.deepEqual(statusCalls.map((call) => call.argv), [['logout'], ['login', 'status']]);
  assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')), { activeId: null, accounts: {} });
});

test('remove of an unknown account fails without touching state', async (t) => {
  const { accounts, saves } = createHarness(t, { statusOutcomes: [] });

  const result = await accounts.remove('claude:ghost@example.com');

  assert.equal(result.ok, false);
  assert.deepEqual(saves, []);
});

test('global Codex state never counts and disconnected private status removes stale rows and active selection', async (t) => {
  const initialState = {
    activeId: 'codex:global-account',
    accounts: {
      'codex:global-account': {
        id: 'codex:global-account', providerId: 'codex', label: 'Global', source: 'detected', addedAt: 'old',
      },
    },
  };
  const { accounts, stateFile, globalHome, saves } = createHarness(t, { initialState, statusOutcomes: [1] });
  fs.mkdirSync(path.join(globalHome, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(globalHome, '.codex', 'auth.json'), JSON.stringify({
    account_id: 'must-not-count',
    access_token: 'must-not-be-read-or-saved',
  }));

  const active = await accounts.getActiveAccount();

  assert.equal(active, null);
  assert.equal(saves.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')), { activeId: null, accounts: {} });
  assert.equal(fs.readFileSync(stateFile, 'utf8').includes('must-not'), false);
});

test('spawn error and timeout are unavailable and clear an active Codex row fail-closed', async (t) => {
  const initialState = {
    activeId: 'codex:athena-runtime',
    accounts: {
      'codex:athena-runtime': {
        id: 'codex:athena-runtime', providerId: 'codex', label: 'Codex', source: 'detected', addedAt: 'old',
      },
    },
  };
  const errorHarness = createHarness(t, { initialState, statusOutcomes: ['error'] });
  const errorSnapshot = await errorHarness.accounts.reconcileCodexRuntimeAccount();
  assert.equal(errorSnapshot.codexStatus, 'unavailable');
  assert.equal(errorSnapshot.activeId, null);
  assert.deepEqual(errorSnapshot.accounts, {});

  const timeoutHarness = createHarness(t, { initialState, statusOutcomes: ['pending'] });
  const timeoutSnapshot = await timeoutHarness.accounts.reconcileCodexRuntimeAccount();
  assert.equal(timeoutSnapshot.codexStatus, 'unavailable');
  assert.equal(timeoutHarness.statusCalls[0].child.killCalls, 1);
});

test('concurrent reconciliations serialize and each mutex acquisition starts a fresh probe and one save', async (t) => {
  const { accounts, statusCalls, saves, pending } = createHarness(t, {
    statusOutcomes: ['pending', 0],
  });

  const first = accounts.reconcileCodexRuntimeAccount();
  const second = accounts.reconcileCodexRuntimeAccount();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(statusCalls.length, 1);

  pending[0].emit('exit', 0, null);
  const firstSnapshot = await first;
  const secondSnapshot = await second;

  assert.equal(firstSnapshot.codexStatus, 'connected');
  assert.equal(secondSnapshot.codexStatus, 'connected');
  assert.equal(statusCalls.length, 2);
  assert.equal(saves.length, 2);
});

test('list and getActiveAccount each perform a fresh reconciliation and never expose status output', async (t) => {
  const { accounts, statusCalls, stateFile } = createHarness(t, { statusOutcomes: [0, 0] });

  await accounts.list();
  const active = await accounts.getActiveAccount();

  assert.deepEqual(active, { accountId: 'codex:athena-runtime', providerId: 'codex' });
  assert.equal(statusCalls.length, 2);
  const persisted = fs.readFileSync(stateFile, 'utf8');
  assert.equal(persisted.includes('secret-output'), false);
});

test('production persistence writes a complete JSON snapshot and leaves no temporary file', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-cli-accounts-atomic-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'user-data');
  const child = createChild();
  const accounts = createCliAccounts({
    appImpl: { getPath: () => userData },
    runtime: {
      spawnPrivateHomeCommand() {
        queueMicrotask(() => child.emit('exit', 0, null));
        return child;
      },
    },
    fsImpl: fs,
    osImpl: { homedir: () => path.join(root, 'global-home') },
    spawnImpl: () => { throw new Error('unexpected spawn'); },
  });

  await accounts.list();

  const entries = fs.readdirSync(userData);
  assert.deepEqual(entries, ['athena-cli-accounts.json']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(userData, entries[0]), 'utf8')).activeId, 'codex:athena-runtime');
});

test('Codex login uses the private runtime visible launcher and never mutates global home', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-cli-login-private-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'user-data');
  const globalHome = path.join(root, 'global-home');
  const globalAuth = path.join(globalHome, '.codex', 'auth.json');
  fs.mkdirSync(path.dirname(globalAuth), { recursive: true });
  fs.writeFileSync(globalAuth, '{"sentinel":"global-must-not-change"}');
  const calls = [];
  const accounts = createCliAccounts({
    appImpl: { getPath: () => userData },
    fsImpl: fs,
    osImpl: { homedir: () => globalHome },
    spawnImpl(command, argv, options) {
      const child = createChild();
      calls.push({ command, argv, options, child });
      if (command === 'where') queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    },
  });
  const originalCodexHome = process.env.CODEX_HOME;

  const result = await accounts.login('codex');

  assert.equal(result.ok, true);
  assert.equal(result.launched, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].argv, ['codex']);
  const launch = calls[1];
  assert.equal(launch.command, 'powershell.exe');
  assert.equal(launch.options.shell, false);
  assert.equal(launch.options.env.CODEX_HOME, path.join(userData, 'codex-runtime'));
  assert.equal(launch.options.env.ATHENA_CODEX_EXECUTABLE, 'codex');
  assert.equal(launch.options.env.ATHENA_CODEX_ARGV_JSON, '["login"]');
  assert.equal(launch.child.unrefCalls, 1);
  assert.equal(fs.readFileSync(globalAuth, 'utf8'), '{"sentinel":"global-must-not-change"}');
  assert.equal(process.env.CODEX_HOME, originalCodexHome);
});

test('Codex logout and follow-up status use the same private home and clear only the private runtime row', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-cli-logout-private-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'user-data');
  const globalHome = path.join(root, 'global-home');
  const globalAuth = path.join(globalHome, '.codex', 'auth.json');
  const stateFile = path.join(userData, 'athena-cli-accounts.json');
  fs.mkdirSync(path.dirname(globalAuth), { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(globalAuth, '{"sentinel":"global-must-not-change"}');
  fs.writeFileSync(stateFile, JSON.stringify({
    activeId: 'codex:athena-runtime',
    accounts: {
      'codex:athena-runtime': {
        id: 'codex:athena-runtime', providerId: 'codex', label: 'Codex', source: 'detected', addedAt: 'old',
      },
    },
  }));
  const calls = [];
  const exitCodes = [0, 1];
  const accounts = createCliAccounts({
    appImpl: { getPath: () => userData },
    fsImpl: fs,
    osImpl: { homedir: () => globalHome },
    spawnImpl(command, argv, options) {
      const child = createChild();
      calls.push({ command, argv, options });
      const code = exitCodes.shift();
      queueMicrotask(() => child.emit('exit', code, null));
      return child;
    },
  });
  const originalCodexHome = process.env.CODEX_HOME;

  const result = await accounts.logout('codex');

  assert.deepEqual(result, { ok: true, codexStatus: 'disconnected' });
  assert.deepEqual(calls.map(({ command, argv }) => ({ command, argv })), [
    { command: 'codex', argv: ['logout'] },
    { command: 'codex', argv: ['login', 'status'] },
  ]);
  for (const call of calls) {
    assert.equal(call.options.shell, false);
    assert.equal(call.options.env.CODEX_HOME, path.join(userData, 'codex-runtime'));
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')), { activeId: null, accounts: {} });
  assert.equal(fs.readFileSync(globalAuth, 'utf8'), '{"sentinel":"global-must-not-change"}');
  assert.equal(process.env.CODEX_HOME, originalCodexHome);
});
