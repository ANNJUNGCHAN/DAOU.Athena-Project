const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  createFreshVerifyProfile,
  seedVerifyProfile,
  cleanupVerifyProfile,
  consumeCleanupDiagnostics,
  resolveNodeExecutable,
  runCleanupWatchdog,
  startVerifyProfileCleanupWatchdog,
} = require('./verify-profile');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function cleanup(profile) {
  return cleanupVerifyProfile(profile.directory, {
    tempRoot: profile.tempRoot,
    expectedRunId: profile.runId,
  });
}

test('createFreshVerifyProfile creates a unique configured profile for every run', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-profile-test-'));
  const first = createFreshVerifyProfile({ tempRoot, scenario: 'configured' });
  const second = createFreshVerifyProfile({ tempRoot, scenario: 'configured' });
  try {
    assert.notEqual(first.directory, second.directory);
    assert.deepEqual(readJson(path.join(first.directory, 'athena-onboarding.json')), {
      cliDone: true,
      accountDone: true,
    });
    assert.deepEqual(readJson(path.join(first.directory, 'athena-accounts.json')), {
      activeId: null,
      accounts: [],
    });
    assert.deepEqual(readJson(path.join(first.directory, 'athena-cli-accounts.json')), {
      activeId: null,
      accounts: {},
    });
  } finally {
    cleanup(first);
    cleanup(second);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('seedVerifyProfile explicitly represents LIFE-001 new-user and partial states', () => {
  const profile = createFreshVerifyProfile({ scenario: 'configured' });
  try {
    seedVerifyProfile(profile.directory, 'new-user');
    assert.deepEqual(readJson(path.join(profile.directory, 'athena-onboarding.json')), {
      cliDone: false,
      accountDone: false,
    });

    seedVerifyProfile(profile.directory, 'cli-complete');
    assert.deepEqual(readJson(path.join(profile.directory, 'athena-onboarding.json')), {
      cliDone: true,
      accountDone: false,
    });
  } finally {
    cleanup(profile);
  }
});

test('cleanupVerifyProfile removes only the marked profile and preserves captures outside it', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-profile-test-'));
  const captures = path.join(tempRoot, 'captures');
  fs.mkdirSync(captures);
  fs.writeFileSync(path.join(captures, 'VERIFY-REPORT.json'), '{}');
  const profile = createFreshVerifyProfile({ tempRoot });

  assert.equal(cleanup(profile), true);
  assert.equal(fs.existsSync(profile.directory), false);
  assert.equal(fs.existsSync(path.join(captures, 'VERIFY-REPORT.json')), true);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('cleanupVerifyProfile refuses an unmarked directory', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-unmarked-'));
  try {
    assert.equal(cleanupVerifyProfile(directory, {
      tempRoot: os.tmpdir(),
      expectedRunId: crypto.randomUUID(),
    }), false);
    assert.equal(fs.existsSync(directory), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cleanup watchdog removes the profile after its parent process exits', async () => {
  const { execFileSync } = require('child_process');
  const helperPath = require.resolve('./verify-profile');
  const output = execFileSync(process.execPath, ['-e', `
    const helper = require(${JSON.stringify(helperPath)});
    const profile = helper.createFreshVerifyProfile();
    helper.startVerifyProfileCleanupWatchdog(profile.directory, {
      tempRoot: profile.tempRoot,
      expectedRunId: profile.runId,
      nodeExecutable: process.execPath,
    });
    process.stdout.write(profile.directory);
  `], { encoding: 'utf8' });
  const directory = output.trim();

  const deadline = Date.now() + 5000;
  while (fs.existsSync(directory) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(fs.existsSync(directory), false);
});

test('cleanup refuses a path replaced with another marker and preserves replacement data', () => {
  const profile = createFreshVerifyProfile();
  fs.rmSync(profile.directory, { recursive: true, force: true });
  fs.mkdirSync(profile.directory);
  fs.writeFileSync(path.join(profile.directory, 'external-data.txt'), 'keep');
  fs.writeFileSync(path.join(profile.directory, '.athena-verify-profile.json'), JSON.stringify({
    kind: 'athena-electron-verify-profile',
    runId: crypto.randomUUID(),
  }));

  assert.equal(cleanup(profile), false);
  assert.equal(fs.readFileSync(path.join(profile.directory, 'external-data.txt'), 'utf8'), 'keep');
  fs.rmSync(profile.directory, { recursive: true, force: true });
});

test('cleanup watchdog refuses a profile replaced after monitoring starts', async () => {
  const profile = createFreshVerifyProfile();
  let parentChecks = 0;
  const result = await runCleanupWatchdog({
    directory: profile.directory,
    tempRoot: profile.tempRoot,
    expectedRunId: profile.runId,
    parentPid: 1234,
    isParentAlive: () => parentChecks++ === 0,
    sleep: async () => {
      fs.rmSync(profile.directory, { recursive: true, force: true });
      fs.mkdirSync(profile.directory);
      fs.writeFileSync(path.join(profile.directory, 'external-data.txt'), 'keep');
      fs.writeFileSync(path.join(profile.directory, '.athena-verify-profile.json'), JSON.stringify({
        kind: 'athena-electron-verify-profile',
        runId: crypto.randomUUID(),
      }));
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'run-id-mismatch');
  assert.equal(fs.readFileSync(path.join(profile.directory, 'external-data.txt'), 'utf8'), 'keep');
  consumeCleanupDiagnostics(profile.tempRoot);
  fs.rmSync(profile.directory, { recursive: true, force: true });
});

test('cleanup watchdog deadline starts after a parent alive for more than 15 seconds', async () => {
  const profile = createFreshVerifyProfile();
  let virtualNow = 0;
  let removeAttempts = 0;
  const result = await runCleanupWatchdog({
    directory: profile.directory,
    tempRoot: profile.tempRoot,
    expectedRunId: profile.runId,
    parentPid: 1234,
    retryWindowMs: 15000,
    pollMs: 100,
    now: () => virtualNow,
    isParentAlive: () => virtualNow < 16000,
    sleep: async () => { virtualNow += virtualNow < 16000 ? 8000 : 5000; },
    removeTarget: () => {
      removeAttempts += 1;
      if (removeAttempts < 3) return false;
      return cleanup(profile);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.parentStoppedAt, 16000);
  assert.equal(removeAttempts, 3);
  assert.equal(virtualNow, 26000);
});

test('cleanup watchdog writes a path-free diagnostic when post-exit retries time out', async () => {
  const profile = createFreshVerifyProfile();
  let virtualNow = 20000;
  const result = await runCleanupWatchdog({
    directory: profile.directory,
    tempRoot: profile.tempRoot,
    expectedRunId: profile.runId,
    parentPid: 1234,
    retryWindowMs: 1000,
    now: () => virtualNow,
    isParentAlive: () => false,
    sleep: async () => { virtualNow += 1000; },
    removeTarget: () => false,
  });
  const diagnostics = consumeCleanupDiagnostics(profile.tempRoot);

  assert.equal(result.reason, 'cleanup-timeout');
  assert.deepEqual(diagnostics.map(({ runId, reason }) => ({ runId, reason })), [{
    runId: profile.runId,
    reason: 'cleanup-timeout',
  }]);
  assert.equal(JSON.stringify(diagnostics).includes(profile.directory), false);
  cleanup(profile);
});

test('cleanup watchdog rejects unsafe parent PIDs and resolves an absolute Node executable', async () => {
  const profile = createFreshVerifyProfile();
  try {
    await assert.rejects(() => runCleanupWatchdog({
      directory: profile.directory,
      tempRoot: profile.tempRoot,
      expectedRunId: profile.runId,
      parentPid: 0,
    }), /positive safe integer|양의 safe integer/);
    assert.throws(() => startVerifyProfileCleanupWatchdog(profile.directory, {
      tempRoot: profile.tempRoot,
      expectedRunId: profile.runId,
      parentPid: Number.MAX_SAFE_INTEGER + 1,
      nodeExecutable: process.execPath,
    }), /양의 safe integer/);
    assert.equal(path.isAbsolute(resolveNodeExecutable()), true);
  } finally {
    cleanup(profile);
  }
});
