'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const electron = require('electron');
const { getClaudeBin, claudeBinCandidates } = require('./claude-bin');
const { getGrokBin, grokBinCandidates } = require('./grok-bin');
const { resolveCodexRuntimeHome, createCodexRuntime } = require('./codex-runtime-home');

const PROVIDER_ORDER = Object.freeze(['claude', 'grok', 'codex']);
const PROVIDER_NAMES = Object.freeze({ claude: 'Claude', codex: 'Codex', grok: 'Grok' });
const CODEX_ACCOUNT_ID = 'codex:athena-runtime';
const CODEX_STATUS_TIMEOUT_MS = 5_000;
const LOGIN_COMMANDS = Object.freeze({
  claude: Object.freeze({
    command: 'claude', args: Object.freeze(['auth', 'login']),
    message: '터미널에서 로그인 진행 — 브라우저에서 인증 후 표시되는 코드를 터미널에 붙여넣어야 완료된다.',
  }),
  codex: Object.freeze({
    command: 'codex', args: Object.freeze(['login']),
    message: '터미널에서 로그인 진행 — 로컬 콜백으로 자동 완료된다.',
  }),
  grok: Object.freeze({
    command: 'grok', args: Object.freeze(['login']),
    message: '터미널에서 로그인 진행 — 브라우저에서 인증하면 완료된다.',
  }),
});

function defaultAtomicWrite(fsImpl, file, state) {
  fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  let handle;
  try {
    handle = fsImpl.openSync(tmp, 'w');
    fsImpl.writeFileSync(handle, JSON.stringify(state, null, 2), 'utf8');
    fsImpl.fsyncSync(handle);
  } finally {
    if (handle !== undefined) fsImpl.closeSync(handle);
  }
  fsImpl.renameSync(tmp, file);
  try {
    const directoryHandle = fsImpl.openSync(path.dirname(file), 'r');
    try { fsImpl.fsyncSync(directoryHandle); } finally { fsImpl.closeSync(directoryHandle); }
  } catch {
    // Windows may reject directory handles. The file was already fsynced and renamed.
  }
}

function immutableSnapshot(state, codexStatus, reconciledAtMonotonicMs) {
  const accounts = {};
  for (const [id, account] of Object.entries(state.accounts)) {
    accounts[id] = Object.freeze({ ...account });
  }
  return Object.freeze({
    accounts: Object.freeze(accounts),
    activeId: state.activeId,
    codexStatus,
    reconciledAtMonotonicMs,
  });
}

function createCliAccounts({
  appImpl = electron.app,
  runtime,
  fsImpl = fs,
  osImpl = os,
  spawnImpl = spawn,
  claudeBinImpl = getClaudeBin,
  grokBinImpl = getGrokBin,
  monotonicNow = () => performance.now(),
  statusTimeoutMs = CODEX_STATUS_TIMEOUT_MS,
  writeStateAtomicImpl,
} = {}) {
  if (!appImpl || typeof appImpl.getPath !== 'function') throw new TypeError('appImpl.getPath is required');
  if (!fsImpl || typeof fsImpl.readFileSync !== 'function') throw new TypeError('fsImpl is required');
  if (!osImpl || typeof osImpl.homedir !== 'function') throw new TypeError('osImpl.homedir is required');
  if (typeof spawnImpl !== 'function') throw new TypeError('spawnImpl is required');
  if (!Number.isFinite(statusTimeoutMs) || statusTimeoutMs <= 0) throw new TypeError('statusTimeoutMs must be positive');

  const userDataPath = appImpl.getPath('userData');
  const runtimeHome = resolveCodexRuntimeHome(userDataPath);
  const codexRuntime = runtime || createCodexRuntime({
    runtimeHome,
    codexExecutable: 'codex',
    spawnImpl,
  });
  const persist = writeStateAtomicImpl || ((file, state) => defaultAtomicWrite(fsImpl, file, state));
  let mutexTail = Promise.resolve();

  const statePath = () => path.join(userDataPath, 'athena-cli-accounts.json');
  function readState() {
    try {
      const parsed = JSON.parse(fsImpl.readFileSync(statePath(), 'utf8'));
      return {
        activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null,
        accounts: parsed.accounts && typeof parsed.accounts === 'object' ? { ...parsed.accounts } : {},
      };
    } catch {
      return { activeId: null, accounts: {} };
    }
  }
  const writeState = (state) => persist(statePath(), state);

  function detectClaude() {
    const home = osImpl.homedir();
    if (!fsImpl.existsSync(path.join(home, '.claude', '.credentials.json'))) return null;
    let label = 'Claude 계정';
    try {
      const parsed = JSON.parse(fsImpl.readFileSync(path.join(home, '.claude.json'), 'utf8'));
      const email = parsed && parsed.oauthAccount && parsed.oauthAccount.emailAddress;
      if (typeof email === 'string' && email) label = email;
    } catch {
      // Preserve the legacy credential-existence signal without requiring an email.
    }
    return { identifier: label, label };
  }

  function detectGrok() {
    const authPath = path.join(osImpl.homedir(), '.grok', 'auth.json');
    if (!fsImpl.existsSync(authPath)) return null;
    let label = 'Grok 계정';
    try {
      const parsed = JSON.parse(fsImpl.readFileSync(authPath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        for (const entry of Object.values(parsed)) {
          if (entry && typeof entry === 'object' && typeof entry.email === 'string' && entry.email) {
            label = entry.email;
            break;
          }
        }
      }
    } catch {
      // Credential file exists — keep the generic label rather than inventing an email.
    }
    return { identifier: label, label };
  }

  // Claude/Grok CLI 는 자격증명이 파일 하나다. 예전에 로그인했던 이메일을
  // 계정 목록에 남겨 두면 전환 버튼이 있는 것처럼 보이지만 실제 CLI 는
  // 지금 파일에 있는 계정만 쓴다. 그래서 현재 감지된 계정만 남기고 나머지는
  // 지운다. 활성 행이 지워진 행이면 activeId 도 비운다.
  function mergeSingleSlotProvider(state, providerId, found) {
    const liveId = found ? `${providerId}:${found.identifier}` : null;
    for (const [id, account] of Object.entries(state.accounts)) {
      if (!account || account.providerId !== providerId || id === liveId) continue;
      delete state.accounts[id];
      if (state.activeId === id) state.activeId = null;
    }
    if (!found) return;
    const existing = state.accounts[liveId];
    if (!existing) {
      state.accounts[liveId] = {
        id: liveId, providerId, label: found.label, source: 'detected', addedAt: new Date().toISOString(),
      };
    } else if (existing.label !== found.label) {
      state.accounts[liveId] = { ...existing, label: found.label };
    }
    if (!state.activeId) state.activeId = liveId;
  }

  function mergeClaude(state) {
    mergeSingleSlotProvider(state, 'claude', detectClaude());
  }

  function mergeGrok(state) {
    mergeSingleSlotProvider(state, 'grok', detectGrok());
  }

  function probeCodexStatus() {
    return new Promise((resolve) => {
      let child;
      let settled = false;
      let timer;
      const finish = (status) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (child && typeof child.removeAllListeners === 'function') {
          child.removeAllListeners('error');
          child.removeAllListeners('exit');
        }
        resolve(status);
      };
      try {
        child = codexRuntime.spawnPrivateHomeCommand(['login', 'status'], {
          timeoutMs: statusTimeoutMs,
          stdio: 'ignore',
        });
      } catch {
        finish('unavailable');
        return;
      }
      child.once('error', () => finish('unavailable'));
      child.once('exit', (code, signal) => {
        if (signal || !Number.isInteger(code)) finish('unavailable');
        else finish(code === 0 ? 'connected' : 'disconnected');
      });
      timer = setTimeout(() => {
        try { child.kill(); } catch { /* fail closed */ }
        finish('unavailable');
      }, statusTimeoutMs);
    });
  }

  function withMutex(task) {
    const run = mutexTail.then(task, task);
    mutexTail = run.then(() => undefined, () => undefined);
    return run;
  }

  async function reconcileCodexRuntimeAccountLocked() {
    const state = readState();
    mergeClaude(state);
    mergeGrok(state);
    const priorCodexIds = Object.values(state.accounts)
      .filter((account) => account && account.providerId === 'codex')
      .map((account) => account.id);
    const priorRuntimeAccount = state.accounts[CODEX_ACCOUNT_ID];
    const activeWasStaleCodex = priorCodexIds.includes(state.activeId)
      && state.activeId !== CODEX_ACCOUNT_ID;
    const codexStatus = await probeCodexStatus();

    for (const id of priorCodexIds) delete state.accounts[id];
    if (priorCodexIds.includes(state.activeId)) state.activeId = null;
    if (codexStatus === 'connected') {
      state.accounts[CODEX_ACCOUNT_ID] = {
        id: CODEX_ACCOUNT_ID,
        providerId: 'codex',
        label: 'Codex',
        source: 'detected',
        addedAt: priorRuntimeAccount && typeof priorRuntimeAccount.addedAt === 'string'
          ? priorRuntimeAccount.addedAt
          : new Date().toISOString(),
      };
      if (!state.activeId && !activeWasStaleCodex) state.activeId = CODEX_ACCOUNT_ID;
    }

    writeState(state);
    return immutableSnapshot(state, codexStatus, monotonicNow());
  }

  const reconcileCodexRuntimeAccount = () => withMutex(reconcileCodexRuntimeAccountLocked);

  function selectList(snapshot) {
    const byProvider = { claude: [], codex: [], grok: [] };
    for (const account of Object.values(snapshot.accounts)) {
      if (!byProvider[account.providerId]) continue;
      byProvider[account.providerId].push({
        id: account.id,
        label: account.label,
        active: account.id === snapshot.activeId,
      });
    }
    return {
      providers: PROVIDER_ORDER.map((id) => ({
        id,
        name: PROVIDER_NAMES[id],
        connected: byProvider[id].length > 0,
        accounts: byProvider[id],
      })),
    };
  }

  function selectActiveAccount(snapshot) {
    if (!snapshot.activeId) return null;
    const account = snapshot.accounts[snapshot.activeId];
    return account ? { accountId: account.id, providerId: account.providerId } : null;
  }

  function peekActiveAccount() {
    const state = readState();
    mergeClaude(state);
    mergeGrok(state);
    if (state.activeId && !state.accounts[state.activeId]) state.activeId = null;
    if (!state.activeId) {
      const preferred = PROVIDER_ORDER
        .map((providerId) => Object.values(state.accounts).find((account) => account && account.providerId === providerId))
        .find(Boolean);
      if (preferred) state.activeId = preferred.id;
    }
    return selectActiveAccount({ accounts: state.accounts, activeId: state.activeId });
  }

  const list = async () => selectList(await reconcileCodexRuntimeAccount());
  const getActiveAccount = async () => selectActiveAccount(await reconcileCodexRuntimeAccount());

  // 절대경로는 파일 존재로 판정한다 — `where`는 PATH만 뒤지므로 PATH 밖에
  // 깔린 실행 파일(예: ~/.local/bin/claude.exe)을 절대 못 찾는다. 이게
  // "설치되어 있지 않다"가 잘못 뜨던 원인이다(2026-09-01 실측).
  function probeBinaryExists(command) {
    if (path.isAbsolute(command)) {
      return Promise.resolve(fsImpl.existsSync(command));
    }
    return new Promise((resolve) => {
      let settled = false;
      let child;
      const isWin = process.platform === 'win32';
      try {
        child = isWin
          ? spawnImpl('where', [command], { stdio: 'ignore', windowsHide: true })
          : spawnImpl(command, ['--version'], { stdio: 'ignore', windowsHide: true });
      } catch {
        resolve(false);
        return;
      }
      child.on('error', () => { if (!settled) { settled = true; resolve(false); } });
      child.on('exit', (code) => { if (!settled) { settled = true; resolve(isWin ? code === 0 : true); } });
    });
  }

  async function login(providerId) {
    const cfg = LOGIN_COMMANDS[providerId];
    const name = PROVIDER_NAMES[providerId];
    if (!cfg || !name) return { ok: false, launched: false, message: '알 수 없는 CLI다' };
    // claude는 PATH에만 기대지 않는다 — claude-bin.js가 오버라이드·PATH·네이티브
    // 설치 순으로 푼다. codex는 아직 PATH 전제 그대로다(런타임이 별도 홈을 쓴다).
    const command = providerId === 'claude'
      ? claudeBinImpl()
      : providerId === 'grok'
        ? grokBinImpl()
        : cfg.command;
    if (!await probeBinaryExists(command)) {
      // 어디를 봤는지 말한다 — "설치되어 있지 않다"만으로는 다음에 뭘 할지 알 수 없다.
      const where = providerId === 'claude'
        ? ` (찾아본 곳: ${claudeBinCandidates().join(' · ')})`
        : providerId === 'grok'
          ? ` (찾아본 곳: ${grokBinCandidates().join(' · ')})`
          : '';
      return { ok: false, launched: false, message: `${name} CLI가 이 컴퓨터에 설치되어 있지 않다${where}` };
    }
    try {
      const child = providerId === 'codex'
        ? codexRuntime.spawnPrivateHomeInteractiveCommand(cfg.args, {
          title: `Athena · ${name} 로그인`,
        })
        : spawnImpl(
          'cmd.exe',
          ['/c', 'start', `"Athena · ${name} 로그인"`, 'cmd', '/k', command, ...cfg.args],
          { detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true },
        );
      child.unref();
      return { ok: true, launched: true, message: cfg.message };
    } catch {
      return { ok: false, launched: false, message: '로그인 창을 열지 못했다' };
    }
  }

  async function logout(providerId) {
    if (providerId !== 'codex') return { ok: false, message: '지원하지 않는 로그아웃 대상이다' };
    return withMutex(async () => {
      const logoutStatus = await new Promise((resolve) => {
        let child;
        let settled = false;
        let timer;
        const finish = (ok) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          if (child && typeof child.removeAllListeners === 'function') {
            child.removeAllListeners('error');
            child.removeAllListeners('exit');
          }
          resolve(ok);
        };
        try {
          child = codexRuntime.spawnPrivateHomeCommand(['logout'], {
            timeoutMs: statusTimeoutMs,
            stdio: 'ignore',
          });
        } catch {
          finish(false);
          return;
        }
        child.once('error', () => finish(false));
        child.once('exit', (code, signal) => finish(!signal && code === 0));
        timer = setTimeout(() => {
          try { child.kill(); } catch { /* fail closed */ }
          finish(false);
        }, statusTimeoutMs);
      });
      const snapshot = await reconcileCodexRuntimeAccountLocked();
      return Object.freeze({
        ok: logoutStatus && snapshot.codexStatus === 'disconnected',
        codexStatus: snapshot.codexStatus,
      });
    });
  }

  function setActive(accountId) {
    return withMutex(async () => {
      const state = readState();
      mergeClaude(state);
      mergeGrok(state);
      if (!state.accounts[accountId]) return { ok: false };
      state.activeId = accountId;
      writeState(state);
      return { ok: true };
    });
  }

  async function activateProviderCurrent(providerId) {
    if (providerId === 'codex') {
      const snapshot = await reconcileCodexRuntimeAccount();
      if (!snapshot.accounts[CODEX_ACCOUNT_ID]) return { ok: false };
      const activated = await setActive(CODEX_ACCOUNT_ID);
      return activated.ok
        ? { ok: true, accountId: CODEX_ACCOUNT_ID }
        : { ok: false };
    }
    if (providerId !== 'claude' && providerId !== 'grok') return { ok: false };
    return withMutex(async () => {
      const found = providerId === 'grok' ? detectGrok() : detectClaude();
      if (!found) return { ok: false };
      const state = readState();
      mergeClaude(state);
      mergeGrok(state);
      const id = `${providerId}:${found.identifier}`;
      if (!state.accounts[id]) {
        state.accounts[id] = {
          id, providerId, label: found.label, source: 'detected', addedAt: new Date().toISOString(),
        };
      }
      state.activeId = id;
      writeState(state);
      return { ok: true, accountId: id };
    });
  }

  function credentialsSignature() {
    return [
      path.join(osImpl.homedir(), '.claude', '.credentials.json'),
      path.join(osImpl.homedir(), '.grok', 'auth.json'),
      path.join(runtimeHome, 'auth.json'),
    ].map((file) => {
      try { return String(fsImpl.statSync(file).mtimeMs); } catch { return '0'; }
    }).join('|');
  }

  return Object.freeze({
    reconcileCodexRuntimeAccount,
    list,
    getActiveAccount,
    peekActiveAccount,
    login,
    logout,
    setActive,
    probeBinaryExists,
    credentialsSignature,
    activateProviderCurrent,
  });
}

let defaultInstance;
const getDefaultInstance = () => {
  if (!defaultInstance) defaultInstance = createCliAccounts();
  return defaultInstance;
};

module.exports = {
  createCliAccounts,
  reconcileCodexRuntimeAccount: (...args) => getDefaultInstance().reconcileCodexRuntimeAccount(...args),
  list: (...args) => getDefaultInstance().list(...args),
  getActiveAccount: (...args) => getDefaultInstance().getActiveAccount(...args),
  peekActiveAccount: (...args) => getDefaultInstance().peekActiveAccount(...args),
  login: (...args) => getDefaultInstance().login(...args),
  logout: (...args) => getDefaultInstance().logout(...args),
  setActive: (...args) => getDefaultInstance().setActive(...args),
  probeBinaryExists: (...args) => getDefaultInstance().probeBinaryExists(...args),
  credentialsSignature: (...args) => getDefaultInstance().credentialsSignature(...args),
  activateProviderCurrent: (...args) => getDefaultInstance().activateProviderCurrent(...args),
};
