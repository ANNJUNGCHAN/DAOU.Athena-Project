const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { resolveHarnessProfile } = require('./harness-profile');

function fakeFs() {
  const calls = { mkdtemp: [], rm: [], write: [] };
  return {
    calls,
    mkdtempSync: (p) => { calls.mkdtemp.push(p); return `${p}XXXX`; },
    rmSync: (p, opts) => { calls.rm.push({ p, opts }); },
    writeFileSync: (p, data) => { calls.write.push({ p, data }); },
  };
}

test('ATHENA_USERDATA_DIR이 있으면 그 경로를 공유 프로필로 쓴다', () => {
  const fsImpl = fakeFs();
  const p = resolveHarnessProfile({
    prefix: 'athena-probe-x-',
    env: { ATHENA_USERDATA_DIR: 'C:\\real\\profile' },
    fsImpl,
    tmpdir: () => '/tmp',
  });
  assert.equal(p.dir, 'C:\\real\\profile');
  assert.equal(p.shared, true);
  assert.deepEqual(fsImpl.calls.mkdtemp, []); // 임시 디렉터리를 만들지 않는다
});

test('공유 프로필의 cleanup()은 아무것도 지우지 않는다', () => {
  // 이 모듈이 존재하는 이유. 지우면 등록된 계좌·자격증명이 통째로 날아간다.
  const fsImpl = fakeFs();
  const p = resolveHarnessProfile({
    prefix: 'athena-probe-x-',
    env: { ATHENA_USERDATA_DIR: 'C:\\real\\profile' },
    fsImpl,
    tmpdir: () => '/tmp',
  });
  p.cleanup();
  p.cleanup();
  assert.deepEqual(fsImpl.calls.rm, []);
});

test('공유 프로필의 seedOnboarding()은 실제 온보딩 상태를 덮지 않는다', () => {
  const fsImpl = fakeFs();
  const p = resolveHarnessProfile({
    prefix: 'athena-probe-x-',
    env: { ATHENA_USERDATA_DIR: 'C:\\real\\profile' },
    fsImpl,
    tmpdir: () => '/tmp',
  });
  p.seedOnboarding();
  assert.deepEqual(fsImpl.calls.write, []);
});

test('env가 없으면 기존대로 임시 프로필을 만든다', () => {
  const fsImpl = fakeFs();
  const p = resolveHarnessProfile({
    prefix: 'athena-probe-backtest-',
    env: {},
    fsImpl,
    tmpdir: () => '/tmp',
  });
  assert.equal(p.shared, false);
  assert.equal(fsImpl.calls.mkdtemp.length, 1);
  assert.ok(fsImpl.calls.mkdtemp[0].endsWith('athena-probe-backtest-'));
  assert.equal(p.dir, `${path.join('/tmp', 'athena-probe-backtest-')}XXXX`);
});

test('임시 프로필은 cleanup()에서 지워지고 온보딩을 시딩한다', () => {
  const fsImpl = fakeFs();
  const p = resolveHarnessProfile({ prefix: 'athena-probe-x-', env: {}, fsImpl, tmpdir: () => '/tmp' });
  p.seedOnboarding();
  p.cleanup();
  assert.equal(fsImpl.calls.write.length, 1);
  assert.ok(fsImpl.calls.write[0].p.endsWith('athena-onboarding.json'));
  assert.deepEqual(JSON.parse(fsImpl.calls.write[0].data), { cliDone: true, accountDone: true });
  assert.deepEqual(fsImpl.calls.rm, [{ p: p.dir, opts: { recursive: true, force: true } }]);
});

test('임시 프로필 cleanup()은 EPERM으로 죽지 않는다', () => {
  // 앱이 띄운 MCP 서버 자식이 mcp-config를 붙잡고 있는 경우.
  const fsImpl = fakeFs();
  fsImpl.rmSync = () => { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; };
  const p = resolveHarnessProfile({ prefix: 'athena-probe-x-', env: {}, fsImpl, tmpdir: () => '/tmp' });
  assert.doesNotThrow(() => p.cleanup());
});

test('prefix 없이 부르면 거부한다', () => {
  assert.throws(() => resolveHarnessProfile({ env: {} }), /prefix is required/);
});
