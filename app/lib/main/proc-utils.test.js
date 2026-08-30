'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { killTree, readProcessCreationTime, terminateTree } = require('./proc-utils');

test('reads an exact Linux process start-tick identity without trusting the command name field', () => {
  const fields = ['S', ...Array.from({ length: 18 }, (_, index) => String(index + 1)), '987654', 'tail'];
  const value = readProcessCreationTime(1234, {
    platform: 'linux',
    readFileSyncFn(path, encoding) {
      assert.equal(path, '/proc/1234/stat');
      assert.equal(encoding, 'utf8');
      return `1234 (command with ) parens) ${fields.join(' ')}`;
    },
  });
  assert.equal(value, 'linux-start-ticks:987654');
});

test('creation-time reader uses shell-free platform commands and rejects missing identities', () => {
  const calls = [];
  const value = readProcessCreationTime(4321, {
    platform: 'win32',
    spawnSyncFn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: '638000000000000000\r\n' };
    },
  });
  assert.equal(value, 'win32-creation:638000000000000000');
  assert.equal(calls[0].command, 'powershell.exe');
  assert.equal(calls[0].options.shell, false);
  assert.match(calls[0].args.at(-1), /ProcessId = 4321/);
  assert.throws(() => readProcessCreationTime(4321, {
    platform: 'darwin', spawnSyncFn: () => ({ status: 1, stdout: '' }),
  }), /Unable to read creation time/);
});

function fakeChild({ pid = 1234, exited = false, killImpl } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = exited ? 0 : null;
  child.signalCode = null;
  child.killCalls = [];
  child.kill = (signal) => {
    child.killCalls.push(signal);
    return killImpl ? killImpl(signal, child) : true;
  };
  return child;
}

function scriptedWait(results) {
  const calls = [];
  const waitForExit = async (child, timeoutMs, phase) => {
    calls.push({ child, timeoutMs, phase });
    const result = results.shift();
    if (result?.exitCode !== undefined) child.exitCode = result.exitCode;
    if (result?.signalCode !== undefined) child.signalCode = result.signalCode;
    return result || { exited: false, timedOut: true };
  };
  waitForExit.calls = calls;
  return waitForExit;
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

test('terminateTree reports already-exited without signalling', async () => {
  const child = fakeChild({ exited: true });
  const result = await terminateTree(child, {
    platform: 'linux',
    waitForExit: () => assert.fail('wait should not run'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'already-exited');
  assert.deepEqual(child.killCalls, []);
  assert.deepEqual(result.attempts, []);
});

test('POSIX confirms graceful SIGTERM exit', async () => {
  const child = fakeChild();
  const waitForExit = scriptedWait([{ exited: true, signalCode: 'SIGTERM' }]);

  const result = await terminateTree(child, {
    platform: 'linux', gracefulMs: 25, forceMs: 10, waitForExit,
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'graceful');
  assert.deepEqual(child.killCalls, ['SIGTERM']);
  assert.deepEqual(result.attempts.map((attempt) => attempt.action), ['SIGTERM']);
});

test('default waiter confirms the child close event rather than assuming kill succeeded', async () => {
  const child = fakeChild({
    killImpl: (signal, target) => {
      queueMicrotask(() => {
        target.signalCode = signal;
        target.emit('close', null, signal);
      });
      return true;
    },
  });

  const result = await terminateTree(child, { platform: 'linux', gracefulMs: 25, forceMs: 10 });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'graceful');
  assert.equal(result.attempts[0].confirmedExited, true);
  assert.equal(result.signalCode, 'SIGTERM');
});

test('POSIX escalates to SIGKILL and confirms forced exit', async () => {
  const child = fakeChild();
  const waitForExit = scriptedWait([
    { exited: false, timedOut: true },
    { exited: true, signalCode: 'SIGKILL' },
  ]);

  const result = await terminateTree(child, {
    platform: 'linux', gracefulMs: 25, forceMs: 10, waitForExit,
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'forced');
  assert.deepEqual(child.killCalls, ['SIGTERM', 'SIGKILL']);
});

test('POSIX returns timeout evidence when the process cannot be killed', async () => {
  const child = fakeChild();
  const waitForExit = scriptedWait([
    { exited: false, timedOut: true },
    { exited: false, timedOut: true },
  ]);

  const result = await terminateTree(child, {
    platform: 'linux', gracefulMs: 25, forceMs: 10, waitForExit,
  });

  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'timeout');
  assert.equal(result.timedOutPhase, 'force');
  assert.deepEqual(child.killCalls, ['SIGTERM', 'SIGKILL']);
  assert.equal(result.attempts.at(-1).confirmedExited, false);
});

test('signal failures are returned as explicit failure evidence', async () => {
  const child = fakeChild({ killImpl: () => { throw new Error('access denied'); } });
  const result = await terminateTree(child, {
    platform: 'linux', gracefulMs: 25, forceMs: 10,
    waitForExit: () => assert.fail('wait should not run after both signals fail'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'failed');
  assert.deepEqual(result.errors.map((error) => error.message), ['access denied', 'access denied']);
});

test('repeated terminateTree calls share one termination operation', async () => {
  const child = fakeChild();
  let release;
  const waitForExit = () => new Promise((resolve) => { release = resolve; });

  const first = terminateTree(child, { platform: 'linux', waitForExit });
  const second = terminateTree(child, { platform: 'linux', waitForExit });
  assert.strictEqual(first, second);
  assert.deepEqual(child.killCalls, ['SIGTERM']);

  child.signalCode = 'SIGTERM';
  release({ exited: true, signalCode: 'SIGTERM' });
  assert.strictEqual(await first, await second);
});

test('creation-time mismatch fails closed before signalling a reused PID', async () => {
  const child = fakeChild();
  const result = await terminateTree(child, {
    platform: 'linux',
    expectedCreationTime: '2026-08-30T01:00:00.000Z',
    readCreationTime: async () => '2026-08-30T02:00:00.000Z',
  });

  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'identity-mismatch');
  assert.deepEqual(child.killCalls, []);
});

test('identity-reader failure and mismatch attempts are retryable, then matching identity can terminate', async () => {
  const child = fakeChild();
  let identityAttempt = 0;
  const readCreationTime = async () => {
    identityAttempt += 1;
    if (identityAttempt === 1) throw new Error('identity reader unavailable');
    if (identityAttempt === 2) return 'wrong-identity';
    return 'expected-identity';
  };
  const waitForExit = scriptedWait([{ exited: true, signalCode: 'SIGTERM' }]);

  const readerFailure = await terminateTree(child, {
    platform: 'linux', expectedCreationTime: 'expected-identity', readCreationTime, waitForExit,
  });
  const mismatch = await terminateTree(child, {
    platform: 'linux', expectedCreationTime: 'expected-identity', readCreationTime, waitForExit,
  });
  const successResult = await terminateTree(child, {
    platform: 'linux', expectedCreationTime: 'expected-identity', readCreationTime, waitForExit,
  });

  assert.equal(readerFailure.ok, false);
  assert.equal(mismatch.ok, false);
  assert.equal(successResult.ok, true);
  assert.equal(identityAttempt, 3);
  assert.deepEqual(child.killCalls, ['SIGTERM']);
});

test('concurrent callers dedupe, then a completed failed owner can be replaced without late clearing', async () => {
  const child = fakeChild();
  const graceGate = deferred();
  const first = terminateTree(child, {
    platform: 'linux',
    waitForExit: async (target, timeoutMs, phase) => {
      if (phase === 'graceful') return graceGate.promise;
      return { exited: false, timedOut: true };
    },
  });
  const duplicate = terminateTree(child, { platform: 'linux' });
  assert.strictEqual(first, duplicate);
  graceGate.resolve({ exited: false, timedOut: true });
  assert.equal((await first).ok, false);

  const retry = terminateTree(child, {
    platform: 'linux', waitForExit: async () => ({ exited: true, signalCode: 'SIGTERM' }),
  });
  assert.notStrictEqual(retry, first);
  assert.equal((await retry).ok, true);
});

test('expected creation time without a reader fails closed before signalling', async () => {
  const child = fakeChild();
  const result = await terminateTree(child, {
    platform: 'linux', expectedCreationTime: 'captured-start-token',
  });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'identity-mismatch');
  assert.deepEqual(child.killCalls, []);
  assert.match(result.errors[0].message, /creation-time reader is required/);
});

test('Windows awaits taskkill and child-close confirmation, then forces if needed', async () => {
  const child = fakeChild();
  const commands = [];
  const spawnFn = (command, args, options) => {
    commands.push({ command, args, options });
    return fakeChild({ pid: 8000 + commands.length });
  };
  const waitForExit = scriptedWait([
    { exited: true, exitCode: 0 },
    { exited: false, timedOut: true },
    { exited: true, exitCode: 0 },
    { exited: true, signalCode: 'SIGKILL' },
  ]);

  const result = await terminateTree(child, {
    platform: 'win32', spawnFn, waitForExit, gracefulMs: 25, forceMs: 10,
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'forced');
  assert.deepEqual(commands.map(({ args }) => args), [
    ['/PID', '1234', '/T'],
    ['/PID', '1234', '/T', '/F'],
  ]);
  for (const { command, options } of commands) {
    assert.equal(command, 'taskkill');
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    assert.equal(options.stdio, 'ignore');
  }
  assert.equal(result.attempts[0].commandConfirmed, true);
  assert.equal(result.attempts[0].confirmedExited, false);
  assert.equal(result.attempts[1].confirmedExited, true);
});

test('killTree retains its fire-and-forget API and never requests a shell', () => {
  const child = fakeChild();
  const calls = [];
  const returned = killTree(child, {
    platform: 'win32',
    spawnFn: (command, args, options) => {
      calls.push({ command, args, options });
      return fakeChild({ exited: true });
    },
    waitForExit: async () => ({ exited: true, exitCode: 0 }),
  });

  assert.equal(returned, undefined);
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[0].args, ['/PID', '1234', '/T', '/F']);
});
