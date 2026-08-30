const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  appendProviderProcessRecord,
  orchestrateProviderLeakCheck,
} = require('./check-provider-process-leaks');

function processEntry(pid, parentPid, creationTime, extra = {}) {
  return { pid, parentPid, creationTime, ...extra };
}

function fakeChild(pid, code = 0) {
  const child = new EventEmitter();
  child.pid = pid;
  queueMicrotask(() => child.emit('close', code, null));
  return child;
}

async function runWithSnapshots({
  snapshots,
  records = [],
  childPid = 100,
  runId = 'run-current',
  graceMs = 20,
}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-leak-test-'));
  const recordPath = path.join(directory, 'providers.ndjson');
  for (const record of records) {
    appendProviderProcessRecord(recordPath, record);
  }

  let snapshotIndex = 0;
  let clock = 0;
  let spawnCall;
  const output = [];
  try {
    const result = await orchestrateProviderLeakCheck({
      command: 'scenario.exe',
      args: ['--token', 'top-secret'],
      runId,
      recordPath,
      graceMs,
      pollMs: 10,
      snapshotProcesses: async () => snapshots[Math.min(snapshotIndex++, snapshots.length - 1)],
      spawnProcess(command, args, options) {
        spawnCall = { command, args, options };
        return fakeChild(childPid);
      },
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
      writeOutput: (line) => output.push(line),
    });
    return { result, spawnCall, output };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('appends only the provider identity fields as NDJSON', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-leak-record-'));
  const recordPath = path.join(directory, 'providers.ndjson');
  try {
    appendProviderProcessRecord(recordPath, {
      runId: 'run-1', pid: 42, parentPid: 7, creationTime: '2026-08-30T00:00:00.000Z',
      provider: 'claude', generation: 3, commandLine: '--secret value',
    });
    const lines = fs.readFileSync(recordPath, 'utf8').trimEnd().split('\n');
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), {
      runId: 'run-1', pid: 42, parentPid: 7, creationTime: '2026-08-30T00:00:00.000Z',
      provider: 'claude', generation: 3,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('returns nonzero for a recorded survivor and redacts process details', async () => {
  const provider = processEntry(110, 100, 'provider-created', {
    commandLine: 'provider.exe --api-key top-secret', executablePath: 'C:\\private\\provider.exe',
  });
  const { result, spawnCall, output } = await runWithSnapshots({
    snapshots: [[], [processEntry(100, 1, 'root-created')], [provider], [provider], [provider]],
    records: [{
      runId: 'run-current', pid: 110, parentPid: 100, creationTime: 'provider-created',
      provider: 'claude', generation: 2,
    }],
  });

  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.survivors, [{
    pid: 110, parentPid: 100, creationTime: 'provider-created', provider: 'claude', generation: 2,
  }]);
  assert.equal(spawnCall.options.shell, false);
  assert.equal(spawnCall.options.env.ATHENA_PROVIDER_LEAK_RUN_ID, 'run-current');
  assert.equal(spawnCall.options.env.ATHENA_PROVIDER_LEAK_RECORD_PATH.endsWith('providers.ndjson'), true);
  assert.doesNotMatch(output.join('\n'), /top-secret|private|commandLine|executablePath/i);
});

test('returns zero after grace polling observes a clean exit', async () => {
  const provider = processEntry(110, 100, 'provider-created');
  const { result } = await runWithSnapshots({
    snapshots: [[], [processEntry(100, 1, 'root-created')], [provider], []],
    records: [{
      runId: 'run-current', pid: 110, parentPid: 100, creationTime: 'provider-created',
      provider: 'codex', generation: 1,
    }],
    graceMs: 30,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.survivors, []);
});

test('excludes a reused PID whose creation time changed', async () => {
  const { result } = await runWithSnapshots({
    snapshots: [[], [processEntry(100, 1, 'root-created')], [processEntry(110, 4, 'reused-created')]],
    records: [{
      runId: 'run-current', pid: 110, parentPid: 100, creationTime: 'original-created',
      provider: 'codex', generation: 1,
    }],
    graceMs: 0,
  });
  assert.equal(result.exitCode, 0);
});

test('ignores records from another run and identities present in the baseline', async () => {
  const baseline = processEntry(500, 1, 'baseline-created');
  const { result } = await runWithSnapshots({
    snapshots: [[baseline], [processEntry(100, 1, 'root-created')], [baseline, processEntry(600, 1, 'foreign-created')]],
    records: [
      { runId: 'run-current', pid: 500, parentPid: 1, creationTime: 'baseline-created', provider: 'codex', generation: 1 },
      { runId: 'wrong-run', pid: 600, parentPid: 1, creationTime: 'foreign-created', provider: 'claude', generation: 1 },
    ],
    graceMs: 0,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.survivors, []);
});

test('a missing scenario root does not classify unrelated processes as descendants', async () => {
  const unrelated = processEntry(700, 100, 'unrelated-created');
  const { result } = await runWithSnapshots({
    snapshots: [[], [], [unrelated]],
    records: [],
    graceMs: 0,
  });
  assert.equal(result.rootObserved, false);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.survivors, []);
});

test('finds an unrecorded descendant survivor through the observed root closure', async () => {
  const root = processEntry(100, 1, 'root-created');
  const child = processEntry(120, 100, 'child-created');
  const grandchild = processEntry(130, 120, 'grandchild-created');
  const { result } = await runWithSnapshots({
    snapshots: [[], [root], [child, grandchild]],
    records: [],
    graceMs: 0,
  });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.survivors.map(({ pid }) => pid), [120, 130]);
});
