'use strict';

// Isolated live proof: an actual shell DOM conversation is durably ingested,
// projected, and rendered by the production graph UI. This file intentionally
// has no package.json script because it calls a real configured Claude CLI.

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const APP_DIR = __dirname;
const REPO_DIR = path.resolve(APP_DIR, '..');
const BACKEND_DIR = path.join(REPO_DIR, 'backend');
const PYTHON_EXE = path.join(BACKEND_DIR, '.venv', 'Scripts', 'python.exe');
const CAPTURE_DIR = path.join(APP_DIR, 'captures');
const PROMPT = [
  '내 투자 성향을 기억해줘.',
  '나는 삼성전자와 SK하이닉스를 장기 핵심 보유 후보로 선호하고,',
  '두 종목을 반도체 성장 테마로 함께 묶어 분산 투자하고 싶어.',
  '변동성이 큰 단기 테마주는 피한다.',
  '시세나 카드는 조회하지 말고 이 성향을 한 문장으로 확인해줘.',
].join(' ');
const BACKEND_READY_TIMEOUT_MS = 45_000;
const CHAT_TIMEOUT_MS = 240_000;
const RENDER_TIMEOUT_MS = 30_000;
const WINDOWS_ENV_ALLOWLIST = new Set([
  'APPDATA',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'COMSPEC',
  'HOMEDRIVE',
  'HOMEPATH',
  'LOCALAPPDATA',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PATH',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PSMODULEPATH',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'WINDIR',
]);
const SENSITIVE_ENV_NAME = /(KIWOOM|ACCOUNT|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_KEY|ACCESS_KEY|PRIVATE_KEY)/i;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sanitizeError(error, secrets) {
  let text = String((error && error.stack) || error || 'unknown error');
  for (const [value, replacement] of secrets) {
    if (value) text = text.split(String(value)).join(replacement);
  }
  return text;
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function powershellJson(script) {
  const stdout = execFileSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', windowsHide: true, timeout: 15_000 },
  ).trim();
  if (!stdout) return [];
  const parsed = safeJsonParse(stdout, []);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function buildMinimalWindowsEnvironment(source, athenaSettings) {
  const env = {};
  for (const [name, value] of Object.entries(source || {})) {
    const normalizedName = name.toUpperCase();
    if (!WINDOWS_ENV_ALLOWLIST.has(normalizedName)) continue;
    if (SENSITIVE_ENV_NAME.test(name)) continue;
    env[name] = value;
  }
  for (const [name, value] of Object.entries(athenaSettings || {})) {
    assert(name.startsWith('ATHENA_'), `refusing non-ATHENA harness setting: ${name}`);
    env[name] = value;
  }
  return env;
}

function replaceProcessEnvironment(nextEnv) {
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, nextEnv);
}

function snapshotListeners(port) {
  if (process.platform !== 'win32') return [];
  const safePort = Number(port);
  return powershellJson([
    `$items = @(Get-NetTCPConnection -State Listen -LocalPort ${safePort} -ErrorAction SilentlyContinue`,
    "  | Select-Object LocalAddress,LocalPort,OwningProcess",
    "  | Sort-Object LocalAddress,OwningProcess)",
    '; $items | ConvertTo-Json -Compress',
  ].join(' ')).map((item) => ({
    address: String(item.LocalAddress || ''),
    port: Number(item.LocalPort),
    pid: Number(item.OwningProcess),
  }));
}

function snapshotProcessTreeDetails() {
  if (process.platform !== 'win32') return [];
  return powershellJson([
    "$items = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue",
    '  | Select-Object ProcessId,ParentProcessId,Name,CreationDate,CommandLine',
    '  | Sort-Object ProcessId)',
    '; $items | ConvertTo-Json -Compress',
  ].join(' ')).map((item) => ({
    pid: Number(item.ProcessId),
    parentPid: Number(item.ParentProcessId),
    name: String(item.Name || ''),
    creationDate: String(item.CreationDate || ''),
    commandLine: String(item.CommandLine || ''),
    commandHash: sha256(String(item.CommandLine || '')),
  }));
}

function processFingerprint(item) {
  return {
    pid: item.pid,
    parentPid: item.parentPid,
    name: item.name,
    creationDate: item.creationDate,
    commandHash: item.commandHash,
  };
}

function excludeHarnessProcessTree(items) {
  const byPid = new Map(items.map((item) => [item.pid, item]));
  const belongsToHarness = (item) => {
    const visited = new Set();
    let current = item;
    while (current && !visited.has(current.pid)) {
      if (current.pid === process.pid || current.parentPid === process.pid) return true;
      visited.add(current.pid);
      current = byPid.get(current.parentPid);
    }
    return false;
  };
  return items.filter((item) => !belongsToHarness(item));
}

function getProcessCommandLine(pid) {
  if (process.platform !== 'win32') return null;
  const rows = powershellJson([
    `$item = Get-CimInstance Win32_Process -Filter \"ProcessId = ${Number(pid)}\" -ErrorAction SilentlyContinue`,
    '$item | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress',
  ].join('\n'));
  if (!rows.length) return null;
  return {
    pid: Number(rows[0].ProcessId),
    name: String(rows[0].Name || ''),
    commandLine: String(rows[0].CommandLine || ''),
  };
}

function processStillExists(pid) {
  if (process.platform === 'win32') return getProcessCommandLine(pid) !== null;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessDetails(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const item = snapshotProcessTreeDetails().find((candidate) => candidate.pid === pid);
    if (item) return item;
    await wait(100);
  } while (Date.now() < deadline);
  return null;
}

function preExistingProcessesPreserved(before, after) {
  const afterByPid = new Map(after.map((item) => [item.pid, item]));
  const missingOrChanged = before.filter((item) => {
    const current = afterByPid.get(item.pid);
    return !current
      || current.name !== item.name
      || current.creationDate !== item.creationDate
      || current.commandHash !== item.commandHash;
  });
  return { ok: missingOrChanged.length === 0, missingOrChanged };
}

function processIdentity(item) {
  return `${item.pid}:${item.creationDate}:${item.name}:${item.commandHash}`;
}

function collectProcessTreePids(details, rootPid) {
  const root = Number(rootPid);
  const owned = new Set(Number.isFinite(root) ? [root] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of details || []) {
      if (owned.has(item.pid) || !owned.has(item.parentPid)) continue;
      owned.add(item.pid);
      changed = true;
    }
  }
  return owned;
}

function collectOwnedPythonClaude(details, { preExistingAll, backendPid, tempRoot, excludePids = [] }) {
  const preExistingIdentities = new Set((preExistingAll || []).map(processIdentity));
  const byPid = new Map(details.map((item) => [item.pid, item]));
  const roots = new Set([process.pid, Number(backendPid)].filter(Number.isFinite));
  const excluded = new Set(excludePids.map(Number));
  const normalizedTempRoot = tempRoot ? path.resolve(tempRoot).toLowerCase() : '';
  const isDescendant = (item) => {
    const visited = new Set();
    let current = item;
    while (current && !visited.has(current.pid)) {
      if (roots.has(current.pid) || roots.has(current.parentPid)) return true;
      visited.add(current.pid);
      current = byPid.get(current.parentPid);
    }
    return false;
  };
  const isTempRelated = (item) => normalizedTempRoot
    && item.commandLine.toLowerCase().includes(normalizedTempRoot);
  const tempRootRelated = details
    .filter((item) => item.pid !== process.pid && isTempRelated(item))
    .map(processFingerprint);
  const ownedPythonClaude = details
    .filter((item) => !preExistingIdentities.has(processIdentity(item)))
    .filter((item) => !excluded.has(item.pid))
    .filter((item) => /^(python|pythonw|claude)\.exe$/i.test(item.name))
    .filter((item) => isTempRelated(item) || isDescendant(item))
    .map((item) => ({ ...item, fingerprint: processFingerprint(item) }));
  return { tempRootRelated, ownedPythonClaude };
}

async function waitForHarnessProcessCleanup(options, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let leaks = { tempRootRelated: [], ownedPythonClaude: [] };
  do {
    leaks = collectOwnedPythonClaude(snapshotProcessTreeDetails(), options);
    if (!leaks.tempRootRelated.length && !leaks.ownedPythonClaude.length) return leaks;
    await wait(250);
  } while (Date.now() < deadline);
  return leaks;
}

function validateCurrentProcessIdentity(expected) {
  const current = snapshotProcessTreeDetails().find((item) => item.pid === expected.pid);
  return Boolean(current && processIdentity(current) === processIdentity(expected));
}

async function terminateOwnedPythonClaude(options) {
  const terminated = [];
  for (let pass = 0; pass < 4; pass += 1) {
    const owned = collectOwnedPythonClaude(snapshotProcessTreeDetails(), options).ownedPythonClaude;
    if (!owned.length) break;
    for (const item of owned) {
      if (!validateCurrentProcessIdentity(item)) continue;
      if (process.platform === 'win32') {
        try {
          execFileSync('taskkill.exe', ['/PID', String(item.pid), '/F'], {
            windowsHide: true,
            stdio: 'ignore',
            timeout: 10_000,
          });
        } catch (error) {
          if (processStillExists(item.pid)) throw error;
        }
      } else {
        process.kill(item.pid, 'SIGTERM');
      }
      terminated.push(item.fingerprint);
    }
    await wait(250);
  }
  return terminated;
}

async function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error('dynamic loopback port allocation failed'));
        else resolve(port);
      });
    });
  });
}

async function fetchJson(url, { token, timeoutMs = 3_000, method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, body: payload };
}

function collectReadOnlySqliteEvidence(brainDbPath, chatOutboxPath, tempRoot, childEnv) {
  const script = `
import json
import sqlite3
from pathlib import Path

def open_read_only(path):
    return sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)

brain = open_read_only(${JSON.stringify(brainDbPath)})
outbox = open_read_only(${JSON.stringify(chatOutboxPath)})
try:
    brain_counts = {}
    for table in ("source_records", "sources", "entities", "relations", "graph_events"):
        brain_counts[table] = brain.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
    outbox_counts = {
        "total": outbox.execute("SELECT COUNT(*) FROM chat_messages").fetchone()[0],
        "user": outbox.execute("SELECT COUNT(*) FROM chat_messages WHERE role='user'").fetchone()[0],
        "assistant": outbox.execute("SELECT COUNT(*) FROM chat_messages WHERE role='assistant'").fetchone()[0],
        "pending": outbox.execute("SELECT COUNT(*) FROM chat_messages WHERE sync_state='pending'").fetchone()[0],
        "synced": outbox.execute("SELECT COUNT(*) FROM chat_messages WHERE sync_state='synced'").fetchone()[0],
        "synced_nonblank": outbox.execute(
            "SELECT COUNT(*) FROM chat_messages WHERE sync_state='synced' AND text <> ''"
        ).fetchone()[0],
    }
    print(json.dumps({"brain": brain_counts, "outbox": outbox_counts}, separators=(",", ":")))
finally:
    brain.close()
    outbox.close()
`;
  const raw = execFileSync(PYTHON_EXE, ['-c', script], {
    cwd: tempRoot,
    encoding: 'utf8',
    env: { ...childEnv, PYTHONIOENCODING: 'utf-8', PYTHONPATH: BACKEND_DIR },
    windowsHide: true,
    timeout: 20_000,
  });
  const evidence = JSON.parse(raw);
  const brain = evidence.brain || {};
  const outbox = evidence.outbox || {};
  assert(brain.source_records >= 2, 'brain source_records does not contain both conversation turns');
  assert(brain.sources > 0, 'graph sources table is empty');
  assert(brain.entities > 0, 'graph entities table is empty');
  assert(brain.relations > 0, 'graph relations table is empty');
  assert(brain.graph_events > 0, 'graph event ledger is empty');
  assert(outbox.total >= 2, 'durable outbox does not contain both conversation turns');
  assert(outbox.user >= 1 && outbox.assistant >= 1, 'durable outbox roles are incomplete');
  assert(outbox.pending === 0, 'durable outbox still has pending rows');
  assert(outbox.synced === outbox.total, 'not every durable outbox row is synced');
  assert(outbox.synced_nonblank === 0, 'synced durable outbox rows still retain plaintext');
  return {
    readOnlyUri: true,
    connectionsClosed: true,
    brain: {
      sourceRecords: brain.source_records,
      sources: brain.sources,
      entities: brain.entities,
      relations: brain.relations,
      graphEvents: brain.graph_events,
    },
    outbox: {
      total: outbox.total,
      user: outbox.user,
      assistant: outbox.assistant,
      pending: outbox.pending,
      synced: outbox.synced,
      syncedNonblank: outbox.synced_nonblank,
    },
  };
}

async function waitForBackendReady(baseUrl, token, child) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < BACKEND_READY_TIMEOUT_MS) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`owned backend exited before readiness (code=${child.exitCode}, signal=${child.signalCode})`);
    }
    try {
      last = await fetchJson(`${baseUrl}/api/v1/brain/status`, { token });
      const body = last.body || {};
      if (
        last.ok
        && body.ready === true
        && body.ingestion_ready === true
        && body.extraction_enabled === true
      ) {
        return { elapsedMs: Date.now() - startedAt, status: body };
      }
    } catch {
      // Uvicorn may not have bound the socket yet.
    }
    await wait(300);
  }
  throw new Error(`owned backend did not become graph-ready: ${JSON.stringify(last)}`);
}

async function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', done);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.removeListener('exit', done);
      resolve(false);
    }, timeoutMs);
  });
}

async function stopOwnedBackend(child, port, expectedIdentity) {
  if (!child || !child.pid) return { stopped: true, alreadyExited: true, listenerCount: 0 };
  if (!processStillExists(child.pid)) {
    return { stopped: true, alreadyExited: true, listenerCount: snapshotListeners(port).length };
  }

  const processInfo = getProcessCommandLine(child.pid);
  const currentDetails = snapshotProcessTreeDetails().find((item) => item.pid === child.pid);
  const listeners = snapshotListeners(port);
  const ownsListener = process.platform !== 'win32'
    || listeners.length === 0
    || listeners.every((item) => item.pid === child.pid);
  const commandMatches = process.platform !== 'win32'
    || Boolean(
      processInfo
      && processInfo.pid === child.pid
      && /python(?:\.exe)?$/i.test(processInfo.name)
      && processInfo.commandLine.includes('athena_api.main:app')
      && processInfo.commandLine.includes(`--port ${port}`),
    );
  assert(commandMatches, `refusing to terminate PID ${child.pid}: command line ownership mismatch`);
  assert(
    !expectedIdentity || (currentDetails && processIdentity(currentDetails) === expectedIdentity),
    `refusing to terminate PID ${child.pid}: process identity mismatch`,
  );
  assert(ownsListener, `refusing to terminate PID ${child.pid}: loopback listener ownership mismatch`);

  child.kill('SIGTERM');
  let exited = await waitForChildExit(child, 8_000);
  if (!exited && process.platform === 'win32') {
    execFileSync('taskkill.exe', ['/PID', String(child.pid), '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 10_000,
    });
    exited = await waitForChildExit(child, 5_000);
  }
  assert(exited || !processStillExists(child.pid), `owned backend PID ${child.pid} did not exit`);

  const deadline = Date.now() + 10_000;
  let remaining = snapshotListeners(port);
  while (remaining.length && Date.now() < deadline) {
    await wait(200);
    remaining = snapshotListeners(port);
  }
  assert(remaining.length === 0, `owned backend port ${port} still has ${remaining.length} listener(s)`);
  return {
    stopped: true,
    alreadyExited: false,
    validatedPid: child.pid,
    commandHash: sha256(processInfo.commandLine),
    listenerCount: remaining.length,
  };
}

function validateAndRemoveTempRoot(tempRoot) {
  const resolved = path.resolve(tempRoot);
  const tempBase = path.resolve(os.tmpdir());
  const expectedPrefix = `${tempBase}${path.sep}`;
  assert(resolved.startsWith(expectedPrefix), `refusing to remove non-temp path: ${resolved}`);
  assert(path.basename(resolved).startsWith('athena-conversation-graph-e2e-'), 'unexpected temp root name');
  assert(resolved !== tempBase && resolved !== path.parse(resolved).root, 'refusing broad temp removal');
  fs.rmSync(resolved, { recursive: true, force: true });
  return !fs.existsSync(resolved);
}

async function waitForRenderer(webContents, expression, timeoutMs, label) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    last = await webContents.executeJavaScript(`Promise.resolve((() => { ${expression} })())`);
    if (last && last.ok === true) return { elapsedMs: Date.now() - startedAt, value: last };
    await wait(200);
  }
  throw new Error(`${label} timed out: ${JSON.stringify(last)}`);
}

function closeOwnedWindows(mainMod) {
  if (!mainMod || typeof mainMod.getWins !== 'function') return;
  const wins = mainMod.getWins();
  for (const win of [wins.orbWin, wins.shellWin, wins.bootWin]) {
    if (!win || win.isDestroyed()) continue;
    try {
      if (win === wins.shellWin) win.removeAllListeners('closed');
      win.destroy();
    } catch {
      // A destroyed renderer may race this final sweep.
    }
  }
}

async function main() {
  let port = null;
  let backendUrl = null;
  let bearerToken = null;
  let tempRoot = null;
  let userDataDir = null;
  let brainDbPath = null;
  let chatOutboxPath = null;
  let routinesDir = null;
  let capturePath = null;
  let receiptPath = null;
  let backendChild = null;
  let backendIdentity = null;
  let childEnv = null;
  let mainMod = null;
  let historySink = null;
  let app = null;
  let primaryError = null;
  let exitCode = 1;
  let snapshotReady = false;
  let preExisting = { port8010: [], relevantProcesses: [], allProcesses: [] };
  let secrets = [];
  const backendStdout = [];
  const backendStderr = [];
  const report = {
    schemaVersion: 1,
    purpose: 'actual Electron conversation to SQLite ingestion to rendered conversation graph',
    steps: {},
    artifacts: {},
    cleanup: { errors: [] },
    pass: false,
  };
  const appendCleanupError = (stage, error) => {
    report.cleanup.errors.push({ stage, error: sanitizeError(error, secrets) });
    report.pass = false;
    exitCode = 1;
  };

  try {
    assert(process.versions.electron, 'run with Electron: electron probe-conversation-graph-e2e.js');
    assert(fs.existsSync(PYTHON_EXE), `backend venv Python not found: ${PYTHON_EXE}`);

    port = await reserveLoopbackPort();
    backendUrl = `http://127.0.0.1:${port}`;
    bearerToken = crypto.randomBytes(32).toString('hex');
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-conversation-graph-e2e-'));
    userDataDir = path.join(tempRoot, 'user-data');
    brainDbPath = path.join(tempRoot, 'brain.sqlite3');
    chatOutboxPath = path.join(tempRoot, 'chat-outbox.sqlite3');
    routinesDir = path.join(tempRoot, 'routines');
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    capturePath = path.join(CAPTURE_DIR, `conversation-graph-e2e-${runId}.png`);
    receiptPath = path.join(CAPTURE_DIR, `conversation-graph-e2e-${runId}.json`);

  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(routinesDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'athena-onboarding.json'),
    JSON.stringify({ cliDone: true, accountDone: true }, null, 2),
    'utf8',
  );
writeProbeModelPrefs(userDataDir);

  // Every process-wide ATHENA setting is fixed before main.js or any of its
  // cached dependencies is loaded. Backend and Electron therefore share one
  // isolated graph SQLite while the durable outbound chat queue stays separate.
    const athenaSettings = {
    ATHENA_NO_AUTOSTART: '1',
    ATHENA_CANVAS_SOURCE: 'live',
    ATHENA_BACKEND_URL: backendUrl,
    ATHENA_LOCAL_BEARER_TOKEN: bearerToken,
    ATHENA_BRAIN_ENABLED: 'true',
    ATHENA_BRAIN_DB_PATH: brainDbPath,
    ATHENA_BRAIN_HISTORY_DB_PATH: brainDbPath,
    ATHENA_CHAT_HISTORY_DB_PATH: chatOutboxPath,
    ATHENA_BRAIN_USE_CLAUDE_CLI_EXTRACTION: 'true',
    ATHENA_ROUTINES_ENABLED: 'false',
    ATHENA_ROUTINES_STORE_PATH: path.join(routinesDir, 'routines.json'),
    ATHENA_ROUTINES_LEDGER_PATH: path.join(routinesDir, 'ledger.jsonl'),
    ATHENA_ROUTINES_READ_MARKS_PATH: path.join(routinesDir, 'read-marks.json'),
    ATHENA_ROUTINES_ENGAGEMENT_PATH: path.join(routinesDir, 'engagement.jsonl'),
    ATHENA_ROUTINES_BRIEFINGS_PATH: path.join(routinesDir, 'briefings.jsonl'),
    ATHENA_ROUTINES_LEDGER_ARCHIVE_DIR: path.join(routinesDir, 'archive'),
    ATHENA_NUDGE_GUARD_PATH: path.join(routinesDir, 'nudge-guard.json'),
    };
    const minimalEnv = buildMinimalWindowsEnvironment(process.env, athenaSettings);
    childEnv = Object.freeze({ ...minimalEnv });
    replaceProcessEnvironment(minimalEnv);

    const allProcesses = snapshotProcessTreeDetails();
    preExisting = {
      port8010: snapshotListeners(8010),
      relevantProcesses: excludeHarnessProcessTree(allProcesses)
        .filter((item) => /^(electron|python|pythonw|claude)\.exe$/i.test(item.name))
        .map(processFingerprint),
      allProcesses,
    };
    snapshotReady = true;
    assert(snapshotListeners(port).length === 0, `dynamic port ${port} was claimed before backend spawn`);

    Object.assign(report, {
    runId,
    startedAt: new Date().toISOString(),
    isolation: {
      loopbackPort: port,
      tempRootName: path.basename(tempRoot),
      userDataIsolated: true,
      unifiedBrainSqlite: true,
      separateDurableChatOutbox: true,
      perRunBearerToken: true,
      backendOwnedByHarness: true,
      backendWorkingDirectoryIsTempRoot: true,
      backendPythonPathIsRepositoryBackend: true,
      inheritedEnvironmentAllowlisted: true,
      inheritedKiwoomAccountTokenSecretVariablesExcluded: true,
      preExistingPort8010ListenerCount: preExisting.port8010.length,
      preExistingRelevantProcessCount: preExisting.relevantProcesses.length,
    },
    });
    secrets = [
    [bearerToken, '[BEARER_TOKEN]'],
    [tempRoot, '[TEMP_ROOT]'],
    [userDataDir, '[USER_DATA]'],
    [brainDbPath, '[BRAIN_DB]'],
    [chatOutboxPath, '[CHAT_OUTBOX]'],
  ];

    backendChild = spawn(PYTHON_EXE, [
      '-m', 'uvicorn', 'athena_api.main:app',
      '--host', '127.0.0.1',
      '--port', String(port),
      '--workers', '1',
    ], {
      cwd: tempRoot,
      env: { ...childEnv, PYTHONIOENCODING: 'utf-8', PYTHONPATH: BACKEND_DIR },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    const backendErrorPromise = new Promise((_, reject) => {
      backendChild.on('error', reject);
    });
    await Promise.race([
      new Promise((resolve) => backendChild.once('spawn', resolve)),
      backendErrorPromise,
    ]);
    backendChild.stdout.on('data', (chunk) => backendStdout.push(Buffer.from(chunk)));
    backendChild.stderr.on('data', (chunk) => backendStderr.push(Buffer.from(chunk)));

    const spawnedBackendDetails = await waitForProcessDetails(backendChild.pid);
    assert(spawnedBackendDetails, `spawned backend PID ${backendChild.pid} was not observable`);
    backendIdentity = processIdentity(spawnedBackendDetails);

    const readiness = await Promise.race([
      waitForBackendReady(backendUrl, bearerToken, backendChild),
      backendErrorPromise,
    ]);
    const ownedListeners = snapshotListeners(port);
    const backendProcessPids = collectProcessTreePids(
      snapshotProcessTreeDetails(),
      backendChild.pid,
    );
    assert(
      process.platform !== 'win32'
        || (ownedListeners.length > 0
          && ownedListeners.every((item) => backendProcessPids.has(item.pid))),
      'spawned backend does not exclusively own its dynamic loopback listener',
    );
    report.steps.backendReady = {
      elapsedMs: readiness.elapsedMs,
      pid: backendChild.pid,
      ready: readiness.status.ready,
      ingestionReady: readiness.status.ingestion_ready,
      extractionEnabled: readiness.status.extraction_enabled,
      listenerOwned: true,
      listenerPids: ownedListeners.map((item) => item.pid),
    };

    ({ app } = require('electron'));
    app.setPath('userData', userDataDir);
    await app.whenReady();

    historySink = require(path.join(APP_DIR, 'lib', 'main', 'history-sink.js'));
    historySink.configureChatHistoryStore({ dbPath: chatOutboxPath });
    mainMod = require(path.join(APP_DIR, 'main.js'));
    await mainMod.createWindows();
    const { shellWin } = mainMod.getWins();
    assert(shellWin && !shellWin.isDestroyed(), 'production shell window was not created');
    mainMod.revealShell({ focus: true, force: true });

    // The harness owns startup orchestration, so expose the already-loaded real
    // shell without synthesizing a second renderer or bypassing its DOM handlers.
    await shellWin.webContents.executeJavaScript(`(() => {
      const boot = document.getElementById('boot');
      const onboard = document.getElementById('onboard');
      const settings = document.getElementById('settings');
      const order = document.getElementById('order');
      const app = document.getElementById('app');
      if (boot) boot.hidden = true;
      if (onboard) onboard.hidden = true;
      if (settings) settings.hidden = true;
      if (order) order.hidden = true;
      if (app) app.hidden = false;
      return { ok: !!app && !app.hidden, input: !!document.getElementById('input') };
    })()`);

    const brainReady = await historySink.refreshBrainReady({ mdlog: () => {} });
    assert(brainReady === true, 'production history sink did not accept graph-ready backend');

    const submitted = await shellWin.webContents.executeJavaScript(`(() => {
      const input = document.getElementById('input');
      if (!input || input.disabled) return { ok: false, reason: 'input unavailable' };
      input.value = ${JSON.stringify(PROMPT)};
      input.focus();
      const accepted = input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true,
      }));
      return { ok: true, eventAccepted: accepted, valueAfter: input.value };
    })()`);
    assert(submitted.ok === true && submitted.valueAfter === '', 'actual shell Enter path did not consume prompt');

    const chat = await waitForRenderer(shellWin.webContents, `
      const input = document.getElementById('input');
      const lock = document.getElementById('lockHint');
      const questions = [...document.querySelectorAll('#history .turn-q')];
      const answers = [...document.querySelectorAll('#history .turn-a')]
        .filter((node) => String(node.textContent || '').trim().length > 0);
      const failed = !!document.querySelector('#history .turn-fail-card');
      const promptSeen = questions.some((node) => node.textContent === ${JSON.stringify(PROMPT)});
      return {
        ok: promptSeen && answers.length > 0 && input && !input.disabled && lock && lock.hidden && !failed,
        promptSeen,
        answerCount: answers.length,
        unlocked: !!input && !input.disabled && !!lock && lock.hidden,
        failed,
        answerChars: answers.length ? String(answers[answers.length - 1].textContent || '').trim().length : 0,
      };
    `, CHAT_TIMEOUT_MS, 'actual shell user/assistant turn');
    report.steps.actualShellConversation = {
      submittedThroughInputEnter: true,
      promptSha256: sha256(PROMPT),
      promptChars: PROMPT.length,
      ...chat.value,
      elapsedMs: chat.elapsedMs,
    };

    const navigation = await shellWin.webContents.executeJavaScript(`(() => {
      const button = document.getElementById('modeNavGraph');
      if (!button) return { ok: false, reason: 'graph navigation missing' };
      button.click();
      return { ok: true, pressed: button.getAttribute('aria-pressed') };
    })()`);
    assert(navigation.ok === true, 'actual graph navigation button was not available');

    const mapTab = await shellWin.webContents.executeJavaScript(`(() => {
      const button = document.getElementById('graphViewTab');
      if (!button) return { ok: false, reason: 'graph map tab missing' };
      button.click();
      window.__athenaGraphE2eUpdates = [];
      window.athena.on('athena:brain-graph-updated', (payload) => {
        window.__athenaGraphE2eUpdates.push({
          revision: Number(payload && payload.revision),
          nodes: Number(payload && payload.nodes),
          edges: Number(payload && payload.edges),
        });
      });
      return { ok: true };
    })()`);
    assert(mapTab.ok === true, 'actual graph map tab was not available');
    const emptyMapSurface = await waitForRenderer(shellWin.webContents, `
      const tab = document.getElementById('graphViewTab');
      const canvas = document.getElementById('graphCanvas');
      const summary = document.getElementById('graphSummaryTable');
      const nodes = [...document.querySelectorAll('#graphCanvas .graph-node')];
      return {
        ok: !!tab && tab.getAttribute('aria-selected') === 'true'
          && !!canvas && !canvas.hidden && (!summary || summary.hidden) && nodes.length === 0,
        ariaSelected: tab ? tab.getAttribute('aria-selected') : null,
        mapVisible: !!canvas && !canvas.hidden,
        summaryHidden: !summary || summary.hidden,
        nodeCount: nodes.length,
      };
    `, RENDER_TIMEOUT_MS, 'empty graph map before production refresh');
    report.steps.graphNavigation = {
      modeNavGraphClicked: true,
      graphViewTabClicked: true,
      emptyBeforeRefresh: emptyMapSurface.value.nodeCount === 0,
      ...emptyMapSurface.value,
      elapsedMs: emptyMapSurface.elapsedMs,
    };

    // Exercise the exact production refresh entry: durable outbox drain, graph
    // job, warm-up, and renderer broadcast all stay owned by main.js.
    const graphReport = await mainMod.runConversationGraphRefreshForProbe('boot');
    assert(graphReport.job.status === 'succeeded', 'manual conversation graph job did not succeed');
    assert(graphReport.graph.revision > 0, 'graph revision did not advance');
    assert(graphReport.graph.nodes > 0, 'conversation graph has no nodes');
    assert(graphReport.graph.edges > 0, 'conversation graph has no edges');
    assert(graphReport.graph.clusters > 0, 'conversation graph has no clusters');
    report.steps.productionGraphRefresh = {
      trigger: graphReport.trigger,
      flushed: graphReport.flushed,
      pending: graphReport.pending,
      jobStatus: graphReport.job.status,
      revision: graphReport.graph.revision,
      nodes: graphReport.graph.nodes,
      edges: graphReport.graph.edges,
      clusters: graphReport.graph.clusters,
      warmStatus: graphReport.warmStatus,
    };

    const eventRefresh = await waitForRenderer(shellWin.webContents, `
      const updates = Array.isArray(window.__athenaGraphE2eUpdates)
        ? window.__athenaGraphE2eUpdates : [];
      const nodes = [...document.querySelectorAll('#graphCanvas .graph-node')];
      const matchingEvent = updates.find((item) => item.revision === ${Number(graphReport.graph.revision)});
      return {
        ok: !!matchingEvent && nodes.length > 0,
        eventCount: updates.length,
        eventRevision: matchingEvent ? matchingEvent.revision : null,
        eventNodes: matchingEvent ? matchingEvent.nodes : null,
        eventEdges: matchingEvent ? matchingEvent.edges : null,
        renderedNodes: nodes.length,
      };
    `, RENDER_TIMEOUT_MS, 'production graph event refreshes the already-open map');
    report.steps.graphEventRefresh = {
      noNavigationAfterRefresh: true,
      ...eventRefresh.value,
      elapsedMs: eventRefresh.elapsedMs,
    };

    await waitForRenderer(shellWin.webContents, `
      const svg = document.querySelector('#graphCanvas svg.graph-canvas');
      const nodes = [...document.querySelectorAll('#graphCanvas .graph-node')];
      return { ok: !!svg && nodes.length > 0, nodeCount: nodes.length };
    `, RENDER_TIMEOUT_MS, 'initial graph SVG');

    // Stage one is the cluster overview. Clicking a real graph node follows the
    // production expansion path so relationship edges are visible and testable.
    await shellWin.webContents.executeJavaScript(`(() => {
      const node = document.querySelector('#graphCanvas .graph-node');
      if (!node) return { ok: false };
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return { ok: true };
    })()`);

    const rendered = await waitForRenderer(shellWin.webContents, `
      const canvas = document.getElementById('graphCanvas');
      const svg = canvas && canvas.querySelector('svg.graph-canvas');
      const nodes = canvas ? [...canvas.querySelectorAll('.graph-node')] : [];
      const edges = canvas ? [...canvas.querySelectorAll('.graph-edge')] : [];
      const visible = (el) => {
        if (!el) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden'
          && rect.width > 0 && rect.height > 0;
      };
      const node = nodes.find(visible) || null;
      const rect = node ? node.getBoundingClientRect() : null;
      const point = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
      const hit = point ? document.elementFromPoint(point.x, point.y) : null;
      const hitNode = hit && typeof hit.closest === 'function' ? hit.closest('.graph-node') : null;
      const viewport = rect ? rect.left >= 0 && rect.top >= 0
        && rect.right <= innerWidth && rect.bottom <= innerHeight : false;
      const corners = rect ? [
        [rect.left, rect.top], [rect.right, rect.top],
        [rect.left, rect.bottom], [rect.right, rect.bottom],
      ].every(([x, y]) => x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight) : false;
      return {
        ok: visible(canvas) && visible(svg) && nodes.filter(visible).length > 0
          && edges.filter(visible).length > 0 && viewport && corners && hitNode === node,
        canvasVisible: visible(canvas),
        svgVisible: visible(svg),
        visibleNodes: nodes.filter(visible).length,
        visibleEdges: edges.filter(visible).length,
        viewport,
        corners,
        centerHitNode: hitNode === node,
        innerWidth,
        innerHeight,
      };
    `, RENDER_TIMEOUT_MS, 'visible graph nodes, edges, and hit-test');
    report.steps.renderedGraph = { ...rendered.value, elapsedMs: rendered.elapsedMs };

    report.steps.sqliteEvidence = collectReadOnlySqliteEvidence(
      brainDbPath,
      chatOutboxPath,
      tempRoot,
      childEnv,
    );

    await wait(300);
    fs.mkdirSync(CAPTURE_DIR, { recursive: true });
    const image = await shellWin.webContents.capturePage();
    const png = image.toPNG();
    fs.writeFileSync(capturePath, png);
    report.artifacts.capture = {
      file: path.relative(REPO_DIR, capturePath).replace(/\\/g, '/'),
      bytes: png.length,
      sha256: sha256(png),
    };

    report.pass = true;
    exitCode = 0;
  } catch (error) {
    primaryError = error;
    report.error = sanitizeError(error, secrets);
  } finally {
    if (historySink) {
      try {
        historySink.closeChatHistoryStore();
        report.cleanup.chatOutboxClosed = true;
      } catch (error) {
        appendCleanupError('chat-outbox-close', error);
      }
    }
    try {
      closeOwnedWindows(mainMod);
      report.cleanup.ownedWindowsClosed = true;
    } catch (error) {
      appendCleanupError('owned-window-close', error);
    }
    if (snapshotReady) {
      try {
        report.cleanup.ownedPythonClaudeStoppedBeforeBackend = await terminateOwnedPythonClaude({
          preExistingAll: preExisting.allProcesses,
          backendPid: backendChild && backendChild.pid,
          tempRoot,
          excludePids: [backendChild && backendChild.pid].filter(Boolean),
        });
      } catch (error) {
        appendCleanupError('owned-python-claude-stop-before-backend', error);
      }
    }
    if (port !== null) {
      try {
        report.cleanup.backend = await stopOwnedBackend(backendChild, port, backendIdentity);
      } catch (error) {
        appendCleanupError('owned-backend-stop', error);
      }
    }
    if (snapshotReady) {
      try {
        report.cleanup.ownedPythonClaudeStoppedAfterBackend = await terminateOwnedPythonClaude({
          preExistingAll: preExisting.allProcesses,
          backendPid: backendChild && backendChild.pid,
          tempRoot,
          excludePids: [backendChild && backendChild.pid].filter(Boolean),
        });
      } catch (error) {
        appendCleanupError('owned-python-claude-stop-after-backend', error);
      }
    }

    let noProcessLeaks = false;
    try {
      if (!snapshotReady || !tempRoot) throw new Error('process baseline was not established');
      const leaks = await waitForHarnessProcessCleanup({
        preExistingAll: preExisting.allProcesses,
        backendPid: backendChild && backendChild.pid,
        tempRoot,
      });
      report.cleanup.tempRootRelatedProcesses = leaks.tempRootRelated;
      report.cleanup.harnessPythonClaudeLeaks = leaks.ownedPythonClaude.map((item) => item.fingerprint);
      noProcessLeaks = leaks.tempRootRelated.length === 0 && leaks.ownedPythonClaude.length === 0;
      report.cleanup.noTempRootRelatedProcesses = leaks.tempRootRelated.length === 0;
      report.cleanup.noHarnessPythonClaudeLeaks = leaks.ownedPythonClaude.length === 0;
      if (!noProcessLeaks) {
        appendCleanupError('process-leak-audit', new Error(
          `temp-related=${leaks.tempRootRelated.length}, python-claude=${leaks.ownedPythonClaude.length}`,
        ));
      }
    } catch (error) {
      appendCleanupError('process-leak-audit', error);
    }

    try {
      if (!snapshotReady || port === null) throw new Error('process baseline was not established');
      const after = {
        port8010: snapshotListeners(8010),
        dynamicPort: snapshotListeners(port),
        relevantProcesses: excludeHarnessProcessTree(snapshotProcessTreeDetails())
          .filter((item) => /^(electron|python|pythonw|claude)\.exe$/i.test(item.name))
          .map(processFingerprint),
      };
      const preservation = preExistingProcessesPreserved(
        preExisting.relevantProcesses,
        after.relevantProcesses,
      );
      report.cleanup.dynamicPortListenerCount = after.dynamicPort.length;
      report.cleanup.preExistingPort8010Unchanged = JSON.stringify(after.port8010)
        === JSON.stringify(preExisting.port8010);
      report.cleanup.preExistingProcessesPreserved = preservation.ok;
      report.cleanup.preExistingProcessChanges = preservation.missingOrChanged;
      if (after.dynamicPort.length !== 0) {
        appendCleanupError('dynamic-port-listener-audit', new Error(
          `${after.dynamicPort.length} listener(s) remain on ${port}`,
        ));
      }
      if (!report.cleanup.preExistingPort8010Unchanged) {
        appendCleanupError('pre-existing-8010-audit', new Error('port 8010 listener snapshot changed'));
      }
      if (!preservation.ok) {
        appendCleanupError('pre-existing-process-audit', new Error(
          `${preservation.missingOrChanged.length} pre-existing process fingerprint(s) changed`,
        ));
      }
    } catch (error) {
      appendCleanupError('process-and-listener-snapshot', error);
    }

    report.steps.backendLogReceipt = {
      stdoutBytes: backendStdout.reduce((total, item) => total + item.length, 0),
      stdoutSha256: sha256(Buffer.concat(backendStdout)),
      stderrBytes: backendStderr.reduce((total, item) => total + item.length, 0),
      stderrSha256: sha256(Buffer.concat(backendStderr)),
    };

    if (tempRoot && (noProcessLeaks || !backendChild)) {
      try {
        report.cleanup.tempPathsRemoved = validateAndRemoveTempRoot(tempRoot);
      } catch (error) {
        appendCleanupError('temp-path-removal', error);
      }
    } else {
      report.cleanup.tempPathsRemoved = false;
      report.cleanup.tempRemovalSkipped = 'process leak audit did not pass';
    }

    if (primaryError) report.error = sanitizeError(primaryError, secrets);
    report.pass = report.pass === true && exitCode === 0 && primaryError === null;
    report.exitCode = report.pass ? 0 : 1;
    report.completedAt = new Date().toISOString();
    if (receiptPath) {
      try {
        fs.mkdirSync(CAPTURE_DIR, { recursive: true });
        const receiptJson = `${JSON.stringify(report, null, 2)}\n`;
        fs.writeFileSync(receiptPath, receiptJson, 'utf8');
        report.artifacts.receipt = {
          file: path.relative(REPO_DIR, receiptPath).replace(/\\/g, '/'),
          canonicalPayloadSha256: sha256(receiptJson),
          hashScope: 'JSON before artifacts.receipt was added',
        };
        // A JSON document cannot contain a digest of its final bytes without changing
        // those bytes. Record the canonical pre-field payload digest explicitly; the
        // capture digest above is the end-to-end visual artifact integrity proof.
        fs.writeFileSync(receiptPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      } catch (error) {
        appendCleanupError('receipt-write', error);
        if (primaryError) report.error = sanitizeError(primaryError, secrets);
      }
    }
    report.exitCode = report.pass ? 0 : 1;

    console.log(JSON.stringify({
      pass: report.pass,
      capture: report.artifacts.capture || null,
      receipt: report.artifacts.receipt,
      cleanup: report.cleanup,
    }));

    process.exitCode = report.exitCode;
    if (app && !app.isReady()) process.exit(report.exitCode);
    if (app) app.exit(report.exitCode);
  }
}

if (process.argv.includes('--powershell-preflight')) {
  try {
    const processes = snapshotProcessTreeDetails();
    const listeners = snapshotListeners(65_534);
    const processTreeFixture = collectProcessTreePids([
      { pid: 20, parentPid: 10 },
      { pid: 30, parentPid: 20 },
      { pid: 40, parentPid: 999 },
    ], 10);
    console.log(JSON.stringify({
      ok: processes.length > 0 && Array.isArray(listeners)
        && processTreeFixture.has(10) && processTreeFixture.has(20)
        && processTreeFixture.has(30) && !processTreeFixture.has(40),
      processCount: processes.length,
      listenerCount: listeners.length,
      descendantResolution: processTreeFixture.size === 3,
    }));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
} else {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
