'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const APP_SERVER_ARGV = Object.freeze(['app-server', '--stdio']);
const APP_SERVER_STDIO = Object.freeze(['pipe', 'pipe', 'pipe']);
const WINDOWS_TERMINAL_EXECUTABLE = 'powershell.exe';
const WINDOWS_TERMINAL_SCRIPT = [
  '$Host.UI.RawUI.WindowTitle = $env:ATHENA_CODEX_WINDOW_TITLE',
  '$athenaCodexExecutable = $env:ATHENA_CODEX_EXECUTABLE',
  '$athenaCodexArgs = ConvertFrom-Json -InputObject $env:ATHENA_CODEX_ARGV_JSON',
  'Remove-Item Env:ATHENA_CODEX_EXECUTABLE,Env:ATHENA_CODEX_ARGV_JSON,Env:ATHENA_CODEX_WINDOW_TITLE',
  '& $athenaCodexExecutable @athenaCodexArgs',
  'exit $LASTEXITCODE',
].join('; ');
const WINDOWS_TERMINAL_ARGV = Object.freeze([
  '-NoLogo',
  '-NoProfile',
  '-Command',
  WINDOWS_TERMINAL_SCRIPT,
]);

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function requireArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new TypeError('argv must be a non-empty array');
  }
  if (argv.some((arg) => typeof arg !== 'string')) {
    throw new TypeError('argv entries must be strings');
  }
  return [...argv];
}

function resolveCodexRuntimeHome(userDataPath) {
  return path.join(requireNonEmptyString(userDataPath, 'userDataPath'), 'codex-runtime');
}

function createCodexRuntime({
  runtimeHome,
  codexExecutable,
  spawnImpl = spawn,
  platform = process.platform,
}) {
  const resolvedRuntimeHome = requireNonEmptyString(runtimeHome, 'runtimeHome');
  const resolvedCodexExecutable = requireNonEmptyString(codexExecutable, 'codexExecutable');
  if (typeof spawnImpl !== 'function') {
    throw new TypeError('spawnImpl must be a function');
  }

  function spawnPrivateHomeCommand(argv, { timeoutMs, stdio } = {}) {
    const spawnOptions = {
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        CODEX_HOME: resolvedRuntimeHome,
      },
    };
    if (timeoutMs !== undefined) {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new TypeError('timeoutMs must be a positive finite number');
      }
      spawnOptions.timeout = timeoutMs;
    }
    if (stdio !== undefined) spawnOptions.stdio = stdio;

    return spawnImpl(resolvedCodexExecutable, requireArgv(argv), spawnOptions);
  }

  function spawnPrivateHomeInteractiveCommand(argv, { title = 'Athena · Codex 로그인' } = {}) {
    const resolvedArgv = requireArgv(argv);
    const resolvedTitle = requireNonEmptyString(title, 'title');
    const privateEnv = {
      ...process.env,
      CODEX_HOME: resolvedRuntimeHome,
    };

    if (platform === 'win32') {
      return spawnImpl(WINDOWS_TERMINAL_EXECUTABLE, [...WINDOWS_TERMINAL_ARGV], {
        shell: false,
        windowsHide: false,
        detached: true,
        stdio: 'ignore',
        env: {
          ...privateEnv,
          ATHENA_CODEX_EXECUTABLE: resolvedCodexExecutable,
          ATHENA_CODEX_ARGV_JSON: JSON.stringify(resolvedArgv),
          ATHENA_CODEX_WINDOW_TITLE: resolvedTitle,
        },
      });
    }

    return spawnImpl(resolvedCodexExecutable, resolvedArgv, {
      shell: false,
      windowsHide: false,
      detached: true,
      stdio: 'inherit',
      env: privateEnv,
    });
  }

  function spawnGenerationAppServer(generationContext) {
    const { runtimeGeneration, processOwnerId, spawnContext } = generationContext || {};
    if (!spawnContext
      || typeof spawnContext.assertCurrent !== 'function'
      || typeof spawnContext.buildEnv !== 'function'
      || typeof spawnContext.registerChild !== 'function') {
      throw new TypeError('generationContext.spawnContext is invalid');
    }

    spawnContext.assertCurrent();
    const generationEnv = spawnContext.buildEnv('codex');
    if (!generationEnv || typeof generationEnv !== 'object' || Array.isArray(generationEnv)) {
      throw new TypeError("spawnContext.buildEnv('codex') must return an env object");
    }
    const env = {
      ...generationEnv,
      CODEX_HOME: resolvedRuntimeHome,
    };
    spawnContext.assertCurrent();

    const child = spawnImpl(resolvedCodexExecutable, [...APP_SERVER_ARGV], {
      shell: false,
      windowsHide: true,
      stdio: [...APP_SERVER_STDIO],
      env,
    });
    const terminationHandle = spawnContext.registerChild(child, {
      provider: 'codex',
      runtimeGeneration,
      processOwnerId,
    });
    return { child, terminationHandle };
  }

  return Object.freeze({
    spawnPrivateHomeCommand,
    spawnPrivateHomeInteractiveCommand,
    spawnGenerationAppServer,
  });
}

module.exports = {
  resolveCodexRuntimeHome,
  createCodexRuntime,
};
