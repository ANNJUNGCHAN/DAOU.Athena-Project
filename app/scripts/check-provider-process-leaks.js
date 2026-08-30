const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');

const RECORD_FIELDS = ['runId', 'pid', 'parentPid', 'creationTime', 'provider', 'generation'];

function normalizeProcess(entry) {
  const pid = Number(entry && (entry.pid ?? entry.ProcessId));
  const parentPid = Number(entry && (entry.parentPid ?? entry.ParentProcessId));
  const creationTime = String(entry && (entry.creationTime ?? entry.CreationTime) || '');
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(parentPid) || parentPid < 0 || !creationTime) {
    return null;
  }
  return { pid, parentPid, creationTime };
}

function normalizeRecord(record) {
  const processIdentity = normalizeProcess(record);
  const runId = typeof record?.runId === 'string' ? record.runId : '';
  const provider = typeof record?.provider === 'string' ? record.provider : '';
  const generation = Number(record?.generation);
  if (!processIdentity || !runId || !provider || !Number.isSafeInteger(generation) || generation < 0) {
    throw new TypeError('provider process record is invalid');
  }
  return { runId, ...processIdentity, provider, generation };
}

function appendProviderProcessRecord(recordPath, record) {
  const normalized = normalizeRecord(record);
  const persisted = Object.fromEntries(RECORD_FIELDS.map((field) => [field, normalized[field]]));
  fs.appendFileSync(recordPath, `${JSON.stringify(persisted)}\n`, { encoding: 'utf8', flag: 'a' });
  return persisted;
}

function readProviderProcessRecords(recordPath, runId) {
  let contents;
  try {
    contents = fs.readFileSync(recordPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }

  const records = [];
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = normalizeRecord(JSON.parse(line));
      if (record.runId === runId) records.push(record);
    } catch {
      // A partial or foreign writer line cannot establish process ownership.
    }
  }
  return records;
}

function processKey(processIdentity) {
  return `${processIdentity.pid}\u0000${processIdentity.creationTime}`;
}

function normalizeSnapshot(snapshot) {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.map(normalizeProcess).filter(Boolean);
}

function findSurvivors({ baseline, current, records, rootIdentity }) {
  const baselineKeys = new Set(baseline.map(processKey));
  const currentByPid = new Map(current.map((entry) => [entry.pid, entry]));
  const metadataByKey = new Map();
  const seedPids = new Set();

  if (rootIdentity && !baselineKeys.has(processKey(rootIdentity))) {
    const currentRoot = currentByPid.get(rootIdentity.pid);
    if (!currentRoot || currentRoot.creationTime === rootIdentity.creationTime) {
      seedPids.add(rootIdentity.pid);
    }
  }

  for (const record of records) {
    const key = processKey(record);
    if (baselineKeys.has(key)) continue;
    const currentRecord = currentByPid.get(record.pid);
    if (currentRecord && currentRecord.creationTime !== record.creationTime) continue;
    seedPids.add(record.pid);
    metadataByKey.set(key, { provider: record.provider, generation: record.generation });
  }

  const descendantPids = new Set(seedPids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of current) {
      if (!descendantPids.has(entry.pid) && descendantPids.has(entry.parentPid)) {
        descendantPids.add(entry.pid);
        changed = true;
      }
    }
  }

  return current
    .filter((entry) => descendantPids.has(entry.pid) && !baselineKeys.has(processKey(entry)))
    .map((entry) => ({
      ...entry,
      ...(metadataByKey.get(processKey(entry)) || { provider: 'scenario-descendant', generation: null }),
    }))
    .sort((left, right) => left.pid - right.pid);
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    child.once('error', (error) => finish(reject, error));
    child.once('close', (code, signal) => finish(resolve, { code: code ?? 1, signal: signal || null }));
  });
}

function defaultSnapshotProcesses() {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$items = Get-CimInstance Win32_Process | ForEach-Object {',
    '  [PSCustomObject]@{',
    '    pid = [int]$_.ProcessId',
    '    parentPid = [int]$_.ParentProcessId',
    '    creationTime = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString("o") } else { "" }',
    '  }',
    '}',
    '@($items) | ConvertTo-Json -Compress',
  ].join('\n');

  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024,
    }, (error, stdout) => {
      if (error) return reject(error);
      try {
        resolve(normalizeSnapshot(JSON.parse(stdout || '[]')));
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

async function orchestrateProviderLeakCheck({
  command,
  args = [],
  runId = crypto.randomUUID(),
  recordPath,
  graceMs = 2_000,
  pollMs = 100,
  snapshotProcesses = defaultSnapshotProcesses,
  spawnProcess = spawn,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  writeOutput = (line) => process.stdout.write(`${line}\n`),
  env = process.env,
}) {
  if (!command || !recordPath) throw new TypeError('command and recordPath are required');
  if (!Number.isFinite(graceMs) || graceMs < 0 || !Number.isFinite(pollMs) || pollMs <= 0) {
    throw new TypeError('graceMs and pollMs must be nonnegative and positive, respectively');
  }

  const baseline = normalizeSnapshot(await snapshotProcesses());
  const child = spawnProcess(command, args, {
    shell: false,
    stdio: 'inherit',
    env: {
      ...env,
      ATHENA_PROVIDER_LEAK_RUN_ID: runId,
      ATHENA_PROVIDER_LEAK_RECORD_PATH: path.resolve(recordPath),
    },
  });
  const childCompletion = waitForChild(child);
  const rootSnapshot = normalizeSnapshot(await snapshotProcesses());
  const rootIdentity = rootSnapshot.find((entry) => entry.pid === child.pid) || null;
  const scenario = await childCompletion;

  const deadline = now() + graceMs;
  let survivors = [];
  do {
    const current = normalizeSnapshot(await snapshotProcesses());
    const records = readProviderProcessRecords(recordPath, runId);
    survivors = findSurvivors({ baseline, current, records, rootIdentity });
    if (survivors.length === 0 || now() >= deadline) break;
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
  } while (true);

  const result = {
    runId,
    rootObserved: Boolean(rootIdentity),
    scenarioExitCode: scenario.code,
    survivors,
    exitCode: survivors.length > 0 ? 1 : scenario.code,
  };
  writeOutput(JSON.stringify({
    runId,
    rootObserved: result.rootObserved,
    scenarioExitCode: scenario.code,
    survivorCount: survivors.length,
    survivors,
  }));
  return result;
}

function parseCli(argv) {
  const separator = argv.indexOf('--');
  const options = separator === -1 ? argv : argv.slice(0, separator);
  const scenario = separator === -1 ? [] : argv.slice(separator + 1);
  const parsed = { graceMs: 2_000, pollMs: 100 };
  for (let index = 0; index < options.length; index += 2) {
    const name = options[index];
    const value = options[index + 1];
    if (value === undefined) throw new Error(`missing value for ${name}`);
    if (name === '--run-id') parsed.runId = value;
    else if (name === '--record-path') parsed.recordPath = value;
    else if (name === '--grace-ms') parsed.graceMs = Number(value);
    else if (name === '--poll-ms') parsed.pollMs = Number(value);
    else throw new Error(`unknown option ${name}`);
  }
  if (scenario.length === 0) throw new Error('scenario command is required after --');
  parsed.command = scenario[0];
  parsed.args = scenario.slice(1);
  return parsed;
}

async function main() {
  let temporaryDirectory;
  try {
    const options = parseCli(process.argv.slice(2));
    if (!options.recordPath) {
      temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-provider-leaks-'));
      options.recordPath = path.join(temporaryDirectory, 'providers.ndjson');
    }
    const result = await orchestrateProviderLeakCheck(options);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`provider leak check failed: ${error && error.message ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  } finally {
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  appendProviderProcessRecord,
  defaultSnapshotProcesses,
  findSurvivors,
  orchestrateProviderLeakCheck,
  readProviderProcessRecords,
};
