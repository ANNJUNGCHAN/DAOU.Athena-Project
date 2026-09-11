'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { resolveGrokBin, grokBinCandidates, getGrokBin, resetGrokBinCache } = require('./grok-bin');

const HOME = path.join('C:', 'Users', 'tester');
const homedir = () => HOME;
const nativeWin = path.join(HOME, '.grok', 'bin', 'grok.exe');

function spawnSyncNever() {
  return { status: 1, stdout: '' };
}

test('명시 오버라이드는 존재를 확인하지 않고 그대로 돌려준다', () => {
  const missing = path.join('C:', 'nope', 'not-a-real-grok.exe');
  const got = resolveGrokBin({
    env: { ATHENA_GROK_BIN: missing },
    platform: 'win32',
    homedir,
    existsSync: () => false,
    spawnSyncImpl: spawnSyncNever,
  });
  assert.equal(got, missing);
});

test('오버라이드가 있으면 PATH를 조회조차 하지 않는다', () => {
  let called = false;
  resolveGrokBin({
    env: { ATHENA_GROK_BIN: 'X' },
    platform: 'win32',
    homedir,
    existsSync: () => true,
    spawnSyncImpl: () => { called = true; return { status: 0, stdout: 'Y' }; },
  });
  assert.equal(called, false);
});

test('Windows에서 where가 준 .cmd/.ps1 래퍼는 건너뛰고 .exe를 고른다', () => {
  const exe = path.join('C:', 'tools', 'grok.exe');
  const got = resolveGrokBin({
    env: {},
    platform: 'win32',
    homedir,
    existsSync: (p) => p === exe,
    spawnSyncImpl: () => ({
      status: 0,
      stdout: ['C:\\npm\\grok.cmd', 'C:\\npm\\grok.ps1', exe].join('\r\n'),
    }),
  });
  assert.equal(got, exe);
});

test('PATH가 비면 ~/.grok/bin 설치 경로로 내려간다', () => {
  const got = resolveGrokBin({
    env: {},
    platform: 'win32',
    homedir,
    existsSync: (p) => p === nativeWin,
    spawnSyncImpl: spawnSyncNever,
  });
  assert.equal(got, nativeWin);
});

test('네이티브 경로는 homedir에서 유도한다 — 사용자명이 박히지 않는다', () => {
  const other = path.join('D:', 'home', 'someone-else');
  const got = resolveGrokBin({
    env: {},
    platform: 'win32',
    homedir: () => other,
    existsSync: (p) => p === path.join(other, '.grok', 'bin', 'grok.exe'),
    spawnSyncImpl: spawnSyncNever,
  });
  assert.equal(got, path.join(other, '.grok', 'bin', 'grok.exe'));
});

test('후보 목록에 ~/.grok/bin 이 들어 있다', () => {
  const candidates = grokBinCandidates({ platform: 'win32', homedir });
  assert.ok(candidates.some((item) => item.includes(path.join('.grok', 'bin'))));
});

test('getGrokBin은 미설치 fallback을 캐시하지 않아 실행 중 설치 후 재시도할 수 있다', () => {
  let installed = false;
  try {
    resetGrokBinCache();
    const options = {
      env: {},
      platform: 'win32',
      homedir,
      existsSync: (candidate) => installed && candidate === nativeWin,
      spawnSyncImpl: spawnSyncNever,
    };
    assert.equal(getGrokBin(options), 'grok');
    installed = true;
    assert.equal(getGrokBin(options), nativeWin);
  } finally {
    resetGrokBinCache();
  }
});
