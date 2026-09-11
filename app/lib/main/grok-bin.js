'use strict';

// grok 실행 파일 해석 — claude-bin.js와 같은 계약이다. PATH가 얕은
// 환경(바로가기·패키징 exe)에서 `spawn grok ENOENT`가 나지 않게, 오버라이드 →
// PATH의 .exe → ~/.grok/bin 순으로 푼다. grok 설치기는 `~/.grok/bin/grok.exe`에
// 둔다(claude의 ~/.local/bin과 위치가 다르다).

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const FALLBACK = 'grok';

function executableName(platform) {
  return platform === 'win32' ? 'grok.exe' : 'grok';
}

function fromPath({ platform, spawnSyncImpl, existsSync }) {
  const wanted = executableName(platform);
  const probe = platform === 'win32'
    ? spawnSyncImpl('where', [wanted], { encoding: 'utf8', windowsHide: true })
    : spawnSyncImpl('which', [wanted], { encoding: 'utf8' });
  if (!probe || probe.status !== 0 || !probe.stdout) return null;
  for (const line of String(probe.stdout).split(/\r?\n/)) {
    const candidate = line.trim();
    if (!candidate) continue;
    if (platform === 'win32' && !/\.exe$/i.test(candidate)) continue;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function fromNativeInstall({ platform, homedir, existsSync }) {
  const candidate = path.join(homedir(), '.grok', 'bin', executableName(platform));
  return existsSync(candidate) ? candidate : null;
}

function grokBinCandidates({
  platform = process.platform,
  homedir = os.homedir,
} = {}) {
  return [
    'ATHENA_GROK_BIN 환경변수',
    platform === 'win32' ? 'PATH (where grok.exe)' : 'PATH (which grok)',
    path.join(homedir(), '.grok', 'bin', executableName(platform)),
  ];
}

function resolveGrokBin({
  env = process.env,
  platform = process.platform,
  homedir = os.homedir,
  existsSync = fs.existsSync,
  spawnSyncImpl = spawnSync,
} = {}) {
  const explicit = env.ATHENA_GROK_BIN;
  if (explicit) return explicit;

  let found = null;
  try {
    found = fromPath({ platform, spawnSyncImpl, existsSync });
  } catch {
    found = null;
  }
  if (found) return found;

  try {
    found = fromNativeInstall({ platform, homedir, existsSync });
  } catch {
    found = null;
  }
  return found || FALLBACK;
}

let cachedDiscovery = null;
function getGrokBin(options = {}) {
  const env = options.env || process.env;
  const explicit = env.ATHENA_GROK_BIN;
  if (explicit) return explicit;
  if (cachedDiscovery !== null) return cachedDiscovery;
  const discovered = resolveGrokBin({ ...options, env: {} });
  if (discovered !== FALLBACK) cachedDiscovery = discovered;
  return discovered;
}
function resetGrokBinCache() {
  cachedDiscovery = null;
}

module.exports = { resolveGrokBin, getGrokBin, resetGrokBinCache, grokBinCandidates };
