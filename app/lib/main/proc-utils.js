// Process-tree termination shared by provider and backend launchers.
//
// killTree keeps the historical fire-and-forget surface. New lifecycle code must
// await terminateTree so shutdown is not considered complete until the owned
// child has emitted exit/close (or a bounded failure result has been produced).
'use strict';

const { spawn } = require('child_process');
const { spawnSync } = require('child_process');
const { readFileSync } = require('fs');

const DEFAULT_GRACEFUL_MS = 1_500;
const DEFAULT_FORCE_MS = 1_500;
const terminationByChild = new WeakMap();

function validatePid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new TypeError('pid must be a positive integer');
  return pid;
}

function readProcessCreationTime(pid, {
  platform = process.platform,
  readFileSyncFn = readFileSync,
  spawnSyncFn = spawnSync,
} = {}) {
  const targetPid = validatePid(pid);
  if (platform === 'linux') {
    const stat = String(readFileSyncFn(`/proc/${targetPid}/stat`, 'utf8'));
    const commandEnd = stat.lastIndexOf(')');
    const fieldsAfterCommand = commandEnd < 0 ? [] : stat.slice(commandEnd + 1).trim().split(/\s+/);
    const startTimeTicks = fieldsAfterCommand[19];
    if (!/^\d+$/.test(String(startTimeTicks || ''))) {
      throw new Error(`Unable to read creation time for pid ${targetPid}`);
    }
    return `linux-start-ticks:${startTimeTicks}`;
  }

  const command = platform === 'win32' ? 'powershell.exe' : 'ps';
  const args = platform === 'win32'
    ? [
      '-NoProfile', '-NonInteractive', '-Command',
      `(Get-CimInstance Win32_Process -Filter \"ProcessId = ${targetPid}\").CreationDate.ToUniversalTime().Ticks`,
    ]
    : ['-o', 'lstart=', '-p', String(targetPid)];
  const observed = spawnSyncFn(command, args, {
    windowsHide: true,
    shell: false,
    encoding: 'utf8',
  });
  if (observed?.error) throw observed.error;
  const value = String(observed?.stdout || '').trim();
  if (observed?.status !== 0 || !value) {
    throw new Error(`Unable to read creation time for pid ${targetPid}`);
  }
  return `${platform}-creation:${value}`;
}

function hasExited(child) {
  return child?.exitCode !== null && child?.exitCode !== undefined
    || child?.signalCode !== null && child?.signalCode !== undefined;
}

function exitSnapshot(child) {
  return {
    exitCode: child?.exitCode ?? null,
    signalCode: child?.signalCode ?? null,
  };
}

function errorEvidence(error, phase) {
  return {
    phase,
    name: error?.name || 'Error',
    message: error?.message || String(error),
    ...(error?.code === undefined ? {} : { code: error.code }),
  };
}

function defaultWaitForExit(child, timeoutMs) {
  if (hasExited(child)) return Promise.resolve({ exited: true, ...exitSnapshot(child) });

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener?.('exit', onExit);
      child.removeListener?.('close', onClose);
      child.removeListener?.('error', onError);
      resolve(result);
    };
    const onExit = (exitCode, signalCode) => finish({ exited: true, exitCode, signalCode });
    const onClose = (exitCode, signalCode) => finish({ exited: true, exitCode, signalCode });
    const onError = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener?.('exit', onExit);
      child.removeListener?.('close', onClose);
      child.removeListener?.('error', onError);
      reject(error);
    };
    const timer = setTimeout(
      () => finish({ exited: hasExited(child), timedOut: !hasExited(child), ...exitSnapshot(child) }),
      Math.max(0, timeoutMs),
    );
    child.once?.('exit', onExit);
    child.once?.('close', onClose);
    child.once?.('error', onError);

    // Avoid missing an exit between the initial check and listener attachment.
    if (hasExited(child)) finish({ exited: true, ...exitSnapshot(child) });
  });
}

function normalizeWaitResult(result, child) {
  if (typeof result === 'boolean') {
    return { exited: result, timedOut: !result, ...exitSnapshot(child) };
  }
  return {
    exited: Boolean(result?.exited || hasExited(child)),
    timedOut: Boolean(result?.timedOut),
    exitCode: result?.exitCode ?? child?.exitCode ?? null,
    signalCode: result?.signalCode ?? child?.signalCode ?? null,
  };
}

function sameCreationTime(actual, expected) {
  const normalize = (value) => value instanceof Date ? value.toISOString() : String(value);
  return normalize(actual) === normalize(expected);
}

async function verifyIdentity(child, options, phase) {
  if (options.expectedCreationTime === undefined || options.expectedCreationTime === null) {
    return { ok: true, checked: false };
  }
  if (typeof options.readCreationTime !== 'function') {
    return {
      ok: false,
      checked: false,
      phase,
      error: {
        phase,
        name: 'ProcessIdentityError',
        message: 'creation-time reader is required when an expected creation time is supplied',
      },
    };
  }

  try {
    const actualCreationTime = await options.readCreationTime(child.pid);
    return {
      ok: sameCreationTime(actualCreationTime, options.expectedCreationTime),
      checked: true,
      expectedCreationTime: options.expectedCreationTime,
      actualCreationTime,
      phase,
    };
  } catch (error) {
    return { ok: false, checked: true, phase, error: errorEvidence(error, phase) };
  }
}

function baseResult(child, platform) {
  return {
    ok: false,
    outcome: 'failed',
    pid: child?.pid ?? null,
    platform,
    attempts: [],
    errors: [],
    identityChecks: [],
    ...exitSnapshot(child),
  };
}

async function waitWithEvidence(waitForExit, child, timeoutMs, phase, errors) {
  try {
    return normalizeWaitResult(await waitForExit(child, timeoutMs, phase), child);
  } catch (error) {
    errors.push(errorEvidence(error, `${phase}:wait`));
    return { exited: hasExited(child), timedOut: !hasExited(child), ...exitSnapshot(child) };
  }
}

async function terminatePosix(child, options, result) {
  const waitForExit = options.waitForExit || defaultWaitForExit;
  const phases = [
    { phase: 'graceful', signal: 'SIGTERM', timeoutMs: options.gracefulMs },
    { phase: 'force', signal: 'SIGKILL', timeoutMs: options.forceMs },
  ];

  for (const current of phases) {
    if (current.phase === 'force') {
      const identity = await verifyIdentity(child, options, 'before-force');
      result.identityChecks.push(identity);
      if (!identity.ok) {
        if (identity.error) result.errors.push(identity.error);
        result.outcome = 'identity-mismatch';
        return result;
      }
    }

    const attempt = { phase: current.phase, action: current.signal, signalAccepted: false };
    result.attempts.push(attempt);
    try {
      attempt.signalAccepted = child.kill(current.signal) !== false;
      if (!attempt.signalAccepted) throw new Error(`${current.signal} was not accepted`);
    } catch (error) {
      result.errors.push(errorEvidence(error, current.phase));
      continue;
    }

    const observed = await waitWithEvidence(
      waitForExit, child, current.timeoutMs, current.phase, result.errors,
    );
    Object.assign(attempt, { confirmedExited: observed.exited, timedOut: observed.timedOut });
    if (observed.exited) {
      Object.assign(result, observed, {
        ok: true,
        outcome: current.phase === 'force' ? 'forced' : 'graceful',
      });
      return result;
    }
  }

  result.outcome = result.attempts.some((attempt) => attempt.timedOut) ? 'timeout' : 'failed';
  if (result.outcome === 'timeout') {
    result.timedOutPhase = result.attempts.findLast((attempt) => attempt.timedOut)?.phase;
  }
  Object.assign(result, exitSnapshot(child));
  return result;
}

async function terminateWindows(child, options, result) {
  const waitForExit = options.waitForExit || defaultWaitForExit;
  const spawnFn = options.spawnFn || spawn;
  const phases = [
    { phase: 'graceful', force: false, timeoutMs: options.gracefulMs },
    { phase: 'force', force: true, timeoutMs: options.forceMs },
  ];

  for (const current of phases) {
    if (current.force) {
      const identity = await verifyIdentity(child, options, 'before-force');
      result.identityChecks.push(identity);
      if (!identity.ok) {
        if (identity.error) result.errors.push(identity.error);
        result.outcome = 'identity-mismatch';
        return result;
      }
    }

    const args = ['/PID', String(child.pid), '/T'];
    if (current.force) args.push('/F');
    const attempt = {
      phase: current.phase,
      action: current.force ? 'taskkill-force' : 'taskkill',
      args,
      commandConfirmed: false,
      confirmedExited: false,
    };
    result.attempts.push(attempt);

    let taskkillChild;
    try {
      taskkillChild = spawnFn('taskkill', args, {
        windowsHide: true,
        stdio: 'ignore',
        shell: false,
      });
    } catch (error) {
      result.errors.push(errorEvidence(error, `${current.phase}:spawn`));
      continue;
    }

    const [commandObserved, targetObserved] = await Promise.all([
      waitWithEvidence(waitForExit, taskkillChild, current.timeoutMs, `${current.phase}:taskkill`, result.errors),
      waitWithEvidence(waitForExit, child, current.timeoutMs, current.phase, result.errors),
    ]);
    attempt.commandConfirmed = commandObserved.exited && commandObserved.exitCode === 0;
    attempt.commandExitCode = commandObserved.exitCode;
    attempt.commandTimedOut = commandObserved.timedOut;
    attempt.confirmedExited = targetObserved.exited;
    attempt.timedOut = targetObserved.timedOut;

    if (!attempt.commandConfirmed) {
      result.errors.push({
        phase: `${current.phase}:taskkill`,
        name: 'TaskkillError',
        message: commandObserved.timedOut
          ? 'taskkill did not exit before the deadline'
          : `taskkill exited with code ${String(commandObserved.exitCode)}`,
      });
    }
    if (targetObserved.exited) {
      Object.assign(result, targetObserved, {
        ok: true,
        outcome: current.phase === 'force' ? 'forced' : 'graceful',
      });
      return result;
    }
  }

  result.outcome = result.attempts.some((attempt) => attempt.timedOut) ? 'timeout' : 'failed';
  if (result.outcome === 'timeout') {
    result.timedOutPhase = result.attempts.findLast((attempt) => attempt.timedOut)?.phase;
  }
  Object.assign(result, exitSnapshot(child));
  return result;
}

async function runTermination(child, options) {
  const platform = options.platform || process.platform;
  const result = baseResult(child, platform);

  if (hasExited(child)) {
    return { ...result, ok: true, outcome: 'already-exited' };
  }

  const identity = options.expectedCreationTime === undefined || options.expectedCreationTime === null
    ? { ok: true, checked: false }
    : await verifyIdentity(child, options, 'before-graceful');
  result.identityChecks.push(identity);
  if (!identity.ok) {
    if (identity.error) result.errors.push(identity.error);
    result.outcome = 'identity-mismatch';
    return result;
  }

  if (platform === 'win32') return terminateWindows(child, options, result);
  return terminatePosix(child, options, result);
}

function terminateTree(child, options = {}) {
  if (!child || typeof child !== 'object' || !Number.isInteger(child.pid) || child.pid <= 0) {
    return Promise.resolve({
      ...baseResult(child, options.platform || process.platform),
      outcome: 'failed',
      errors: [{ phase: 'validate', name: 'TypeError', message: 'A live child process with a positive pid is required' }],
    });
  }

  const existing = terminationByChild.get(child);
  if (existing) return existing.operation;

  const normalizedOptions = {
    ...options,
    gracefulMs: Number.isFinite(options.gracefulMs) ? Math.max(0, options.gracefulMs) : DEFAULT_GRACEFUL_MS,
    forceMs: Number.isFinite(options.forceMs) ? Math.max(0, options.forceMs) : DEFAULT_FORCE_MS,
  };
  const operation = runTermination(child, normalizedOptions);
  const registration = { operation };
  terminationByChild.set(child, registration);
  operation.then(() => {
    if (terminationByChild.get(child) === registration) terminationByChild.delete(child);
  }, () => {
    if (terminationByChild.get(child) === registration) terminationByChild.delete(child);
  });
  return operation;
}

function killTree(child, options = {}) {
  if (!child || hasExited(child)) return;
  const platform = options.platform || process.platform;
  if (platform === 'win32') {
    try {
      const taskkillChild = (options.spawnFn || spawn)('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        shell: false,
      });
      taskkillChild?.once?.('error', () => {});
    } catch { /* The process may already have exited. */ }
    return;
  }
  try { child.kill('SIGTERM'); } catch { /* The process may already have exited. */ }
}

module.exports = { killTree, readProcessCreationTime, terminateTree };
