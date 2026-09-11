'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const WINDOWS_PACKAGE = '@openai/codex-win32-x64';
const WINDOWS_TRIPLE = 'x86_64-pc-windows-msvc';

function nativeWindowsCandidate(root) {
  return path.join(
    root,
    'node_modules',
    '@openai',
    'codex',
    'node_modules',
    WINDOWS_PACKAGE,
    'vendor',
    WINDOWS_TRIPLE,
    'bin',
    'codex.exe',
  );
}

function resolveCodexExecutable({
  env = process.env,
  platform = process.platform,
  existsSync = fs.existsSync,
  spawnSyncImpl = spawnSync,
} = {}) {
  if (env.ATHENA_CODEX_BIN) return env.ATHENA_CODEX_BIN;

  let probe = null;
  try {
    probe = platform === 'win32'
      ? spawnSyncImpl('where', ['codex'], { encoding: 'utf8', windowsHide: true, shell: false })
      : spawnSyncImpl('which', ['codex'], { encoding: 'utf8', shell: false });
  } catch {
    probe = null;
  }
  const discovered = probe?.status === 0
    ? String(probe.stdout || '').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)
    : [];
  if (platform !== 'win32') return discovered.find((candidate) => existsSync(candidate)) || 'codex';

  const direct = discovered.find((candidate) => /\.exe$/i.test(candidate) && existsSync(candidate));
  if (direct) return direct;
  for (const wrapper of discovered) {
    const candidate = nativeWindowsCandidate(path.dirname(wrapper));
    if (existsSync(candidate)) return candidate;
  }
  if (env.APPDATA) {
    const candidate = nativeWindowsCandidate(path.join(env.APPDATA, 'npm'));
    if (existsSync(candidate)) return candidate;
  }
  throw Object.assign(
    new Error('Codex 네이티브 실행 파일을 찾지 못했다. ATHENA_CODEX_BIN에 codex.exe 절대 경로를 지정해야 한다.'),
    { code: 'CODEX_EXECUTABLE_NOT_FOUND', actionNeeded: true },
  );
}

module.exports = { resolveCodexExecutable };
