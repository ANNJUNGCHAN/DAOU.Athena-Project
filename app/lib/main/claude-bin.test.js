const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { resolveClaudeBin, claudeBinCandidates } = require('./claude-bin');

const HOME = path.join('C:', 'Users', 'tester');
const homedir = () => HOME;
const nativeWin = path.join(HOME, '.local', 'bin', 'claude.exe');

function spawnSyncNever() {
  return { status: 1, stdout: '' };
}

test('명시 오버라이드는 존재를 확인하지 않고 그대로 돌려준다', () => {
  // probe-turn-error.js가 존재하지 않는 경로로 ENOENT 경로를 시험한다 —
  // 여기서 걸러 다른 후보로 넘어가면 그 프로브가 무의미해진다.
  const missing = path.join('C:', 'nope', 'not-a-real-claude.exe');
  const got = resolveClaudeBin({
    env: { ATHENA_CLAUDE_BIN: missing },
    platform: 'win32',
    homedir,
    existsSync: () => false,
    spawnSyncImpl: spawnSyncNever,
  });
  assert.equal(got, missing);
});

test('오버라이드가 있으면 PATH를 조회조차 하지 않는다', () => {
  let called = false;
  resolveClaudeBin({
    env: { ATHENA_CLAUDE_BIN: 'X' },
    platform: 'win32',
    homedir,
    existsSync: () => true,
    spawnSyncImpl: () => { called = true; return { status: 0, stdout: 'Y' }; },
  });
  assert.equal(called, false);
});

test('Windows에서 where가 준 .cmd/.ps1 래퍼는 건너뛰고 .exe를 고른다', () => {
  // npm 전역은 claude/claude.cmd/claude.ps1 래퍼만 깔고 .exe가 없다. shell:false
  // 스폰은 .exe만 찾으므로 래퍼를 고르면 그대로 ENOENT다.
  const exe = path.join('C:', 'tools', 'claude.exe');
  const got = resolveClaudeBin({
    env: {},
    platform: 'win32',
    homedir,
    existsSync: (p) => p === exe,
    spawnSyncImpl: () => ({
      status: 0,
      stdout: ['C:\\npm\\claude.cmd', 'C:\\npm\\claude.ps1', exe].join('\r\n'),
    }),
  });
  assert.equal(got, exe);
});

test('PATH가 비면 네이티브 설치 경로로 내려간다', () => {
  const got = resolveClaudeBin({
    env: {},
    platform: 'win32',
    homedir,
    existsSync: (p) => p === nativeWin,
    spawnSyncImpl: spawnSyncNever,
  });
  assert.equal(got, nativeWin);
});

test('네이티브 경로는 homedir에서 유도한다 — 사용자명이 박히지 않는다', () => {
  // PC·사용자가 바뀌어도 따라와야 한다(이 모듈이 생긴 이유).
  const other = path.join('D:', 'home', 'someone-else');
  const got = resolveClaudeBin({
    env: {},
    platform: 'win32',
    homedir: () => other,
    existsSync: (p) => p === path.join(other, '.local', 'bin', 'claude.exe'),
    spawnSyncImpl: spawnSyncNever,
  });
  assert.equal(got, path.join(other, '.local', 'bin', 'claude.exe'));
});

test('posix는 확장자 없는 claude를 찾는다', () => {
  // 경로는 path.join으로 조립한다 — 이 테스트가 Windows에서도 돌아서
  // 구분자를 문자열로 박으면 구분자만 보고 실패한다. 검증 대상은 구분자가
  // 아니라 "실행 파일명에 .exe가 붙지 않는다"는 것이다.
  const expected = path.join('/home/t', '.local', 'bin', 'claude');
  const got = resolveClaudeBin({
    env: {},
    platform: 'linux',
    homedir: () => '/home/t',
    existsSync: (p) => p === expected,
    spawnSyncImpl: spawnSyncNever,
  });
  assert.equal(got, expected);
  assert.ok(!got.endsWith('.exe'));
});

test('아무 후보도 없으면 기존 동작대로 bare claude로 떨어진다', () => {
  // 던지지 않는다 — 던지면 claude 없이도 뜨던 화면들이 기동을 못 한다.
  const got = resolveClaudeBin({
    env: {},
    platform: 'win32',
    homedir,
    existsSync: () => false,
    spawnSyncImpl: spawnSyncNever,
  });
  assert.equal(got, 'claude');
});

test('where/which 자체가 없어도 죽지 않고 다음 후보로 간다', () => {
  const got = resolveClaudeBin({
    env: {},
    platform: 'win32',
    homedir,
    existsSync: (p) => p === nativeWin,
    spawnSyncImpl: () => { throw new Error('spawnSync ENOENT'); },
  });
  assert.equal(got, nativeWin);
});

test('후보 목록이 오류 메시지용으로 노출된다', () => {
  const list = claudeBinCandidates({ platform: 'win32', homedir });
  assert.equal(list.length, 3);
  assert.match(list[0], /ATHENA_CLAUDE_BIN/);
  assert.ok(list[2].endsWith(path.join('.local', 'bin', 'claude.exe')));
});

test('getClaudeBin은 오버라이드를 매번 다시 읽는다 (캐시하지 않는다)', () => {
  // probe-orb-mini-chart-card.js가 한 프로세스 안에서 두 번 갈아끼운다.
  const { getClaudeBin, resetClaudeBinCache } = require('./claude-bin');
  const saved = process.env.ATHENA_CLAUDE_BIN;
  try {
    resetClaudeBinCache();
    process.env.ATHENA_CLAUDE_BIN = 'first.exe';
    assert.equal(getClaudeBin(), 'first.exe');
    process.env.ATHENA_CLAUDE_BIN = 'second.exe';
    assert.equal(getClaudeBin(), 'second.exe');
  } finally {
    if (saved === undefined) delete process.env.ATHENA_CLAUDE_BIN;
    else process.env.ATHENA_CLAUDE_BIN = saved;
    resetClaudeBinCache();
  }
});

test('getClaudeBin은 미설치 fallback을 캐시하지 않아 실행 중 설치 후 재시도할 수 있다', () => {
  const { getClaudeBin, resetClaudeBinCache } = require('./claude-bin');
  let installed = false;
  try {
    resetClaudeBinCache();
    const options = {
      env: {},
      platform: 'win32',
      homedir,
      existsSync: (candidate) => installed && candidate === nativeWin,
      spawnSyncImpl: spawnSyncNever,
    };
    assert.equal(getClaudeBin(options), 'claude');
    installed = true;
    assert.equal(getClaudeBin(options), nativeWin);
  } finally {
    resetClaudeBinCache();
  }
});
