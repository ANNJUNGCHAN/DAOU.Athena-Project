'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { StringDecoder } = require('node:string_decoder');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseOnly, parseSuite, runOne, runSuite, readSourceIdentity } = require('./run-verify-suite');

// Node의 readable 스트림처럼 setEncoding이 걸리면 청크 경계를 이어 붙여 디코드한다.
class FakeStream extends EventEmitter {
  constructor() {
    super();
    this.decoder = null;
  }

  setEncoding(encoding) {
    this.decoder = new StringDecoder(encoding);
  }

  push(buffer) {
    this.emit('data', this.decoder ? this.decoder.write(buffer) : buffer);
  }
}

function fakeChild(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new FakeStream();
  child.stderr = new FakeStream();
  child.killed = false;
  child.kill = () => { child.killed = true; return true; };
  return child;
}

// deferTerminate: 실제 Windows 경로처럼 taskkill이 끝나기 전에 close가 먼저 오는 순서를
// 재현하려고 terminateTree를 테스트가 붙잡는 지연 프라미스로 만든다.
function harness({ budgetMs = 20, deferTerminate = false } = {}) {
  const child = fakeChild();
  const terminated = [];
  const spawnArgs = [];
  let signalTerminate;
  const whenTerminated = new Promise((resolve) => { signalTerminate = resolve; });
  let release = () => {};
  const promise = runOne({ script: 'verify:kiumi', budgetMs }, {
    spawn: (command, args, options) => {
      spawnArgs.push({ command, args, options });
      return child;
    },
    terminateTree: (target) => {
      terminated.push(target);
      signalTerminate();
      const outcome = { ok: true, outcome: 'forced' };
      if (!deferTerminate) return Promise.resolve(outcome);
      return new Promise((resolve) => { release = () => resolve(outcome); });
    },
  });
  return { child, terminated, spawnArgs, promise, whenTerminated, release: () => release() };
}

test('parseOnly는 --only가 없으면 전체 실행을 뜻하는 null을 준다', () => {
  assert.deepEqual(parseOnly(['node', 'run-verify-suite.js']), { only: null });
});

test('parseOnly는 --only 뒤 값을 그대로 돌려준다', () => {
  assert.deepEqual(
    parseOnly(['node', 'run-verify-suite.js', '--only', 'verify:kiumi']),
    { only: 'verify:kiumi' },
  );
});

test('parseOnly는 --only 뒤 값이 없으면 전체 실행으로 떨어지지 않고 오류를 준다', () => {
  const parsed = parseOnly(['node', 'run-verify-suite.js', '--only']);
  assert.equal(parsed.only, undefined);
  assert.match(parsed.error, /--only/);
});

test('parseOnly는 --only 뒤에 다른 플래그가 오면 값 누락으로 본다', () => {
  const parsed = parseOnly(['node', 'run-verify-suite.js', '--only', '--json']);
  assert.equal(parsed.only, undefined);
  assert.match(parsed.error, /--only/);
});

test('parseSuite는 --suite가 없으면 기본 스위트를 뜻한다', () => {
  assert.deepEqual(parseSuite(['node', 'run-verify-suite.js']), { suite: 'default' });
});

test('parseSuite는 --suite paper를 받는다', () => {
  assert.deepEqual(parseSuite(['node', 'run-verify-suite.js', '--suite', 'paper']), { suite: 'paper' });
});

test('parseSuite는 --suite 뒤 값이 없으면 기본 스위트로 떨어지지 않고 오류를 준다', () => {
  const parsed = parseSuite(['node', 'run-verify-suite.js', '--suite']);
  assert.equal(parsed.suite, undefined);
  assert.match(parsed.error, /--suite/);
});

test('parseSuite는 --suite 뒤에 다른 플래그가 오면 값 누락으로 본다', () => {
  const parsed = parseSuite(['node', 'run-verify-suite.js', '--suite', '--list']);
  assert.equal(parsed.suite, undefined);
  assert.match(parsed.error, /--suite/);
});

test('parseSuite는 오타난 스위트 이름을 조용히 기본 스위트로 바꾸지 않는다', () => {
  // 오타가 통과하면 15분짜리 전수를 돌린 줄 알고 22분짜리 기본 스위트를 돌리게 된다.
  const parsed = parseSuite(['node', 'run-verify-suite.js', '--suite', 'papers']);
  assert.equal(parsed.suite, undefined);
  assert.match(parsed.error, /unknown suite papers/);
});

test('runOne은 예산을 넘기면 자식 트리를 통째로 죽이고 timedOut을 알린다', async () => {
  const { child, terminated, promise } = harness({ budgetMs: 10 });
  const result = await promise;
  assert.deepEqual(terminated, [child]);
  assert.equal(child.killed, false, '직계 자식만 죽이는 child.kill()로 되돌아가면 안 된다');
  assert.equal(result.timedOut, true);
  assert.equal(result.ok, false);
  assert.equal(result.code, null);
});

test('runOne은 예산 초과 뒤 늦게 오는 close로 판정을 뒤집지 않는다', async () => {
  const { child, promise, whenTerminated, release } = harness({ budgetMs: 10, deferTerminate: true });
  await whenTerminated;
  // 트리를 죽이면 close가 taskkill 완료보다 먼저 도착한다. 가드가 없으면 여기서 ok=true로 뒤집힌다.
  child.emit('close', 0);
  release();
  const result = await promise;
  assert.equal(result.timedOut, true);
  assert.equal(result.ok, false);
  assert.equal(result.code, null);
});

test('runOne은 정상 종료 시 종료 코드로 판정하고 로그 꼬리를 담는다', async () => {
  const { child, terminated, promise } = harness({ budgetMs: 5000 });
  child.stdout.push(Buffer.from('완료\n', 'utf8'));
  child.stderr.push(Buffer.from('경고\n', 'utf8'));
  child.emit('close', 0);
  const result = await promise;
  assert.equal(result.ok, true);
  assert.equal(result.code, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.stdoutTail, '완료\n');
  assert.equal(result.stderrTail, '경고\n');
  assert.deepEqual(terminated, []);
});

test('runOne은 청크 경계에 걸린 한글을 깨뜨리지 않는다', async () => {
  const { child, promise } = harness({ budgetMs: 5000 });
  const message = Buffer.from('리포트 저장 완료', 'utf8');
  child.stdout.push(message.subarray(0, 4));
  child.stdout.push(message.subarray(4));
  child.emit('close', 0);
  const result = await promise;
  assert.equal(result.stdoutTail, '리포트 저장 완료');
});

function evidenceFixture(t, outcomes) {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-suite-evidence-'));
  const children = [];
  t.after(async () => {
    children.forEach((child) => child.emit('close', 0));
    await new Promise(setImmediate);
    fs.rmSync(outputRoot, { recursive: true, force: true });
  });
  const source = { commit: 'a'.repeat(40), dirty: true, worktreeSha256: 'b'.repeat(64) };
  const deps = {
    outputRoot, getSource: () => source, write: () => {},
    spawn: () => {
      const outcome = outcomes[children.length];
      if (outcome.throw) throw new Error('fixture spawn failed');
      const child = fakeChild();
      children.push(child);
      setImmediate(() => {
        child.stdout.push(Buffer.from(outcome.stdout || '', 'utf8'));
        child.stderr.push(Buffer.from(outcome.stderr || '', 'utf8'));
        if (outcome.error) child.emit('error', new Error('fixture child error'));
        else if (!outcome.hold) child.emit('close', outcome.code || 0);
      });
      return child;
    },
    terminateTree: async (child) => { child.emit('close', 0); return { ok: true }; },
  };
  return { outputRoot, children, source, deps };
}

test('실행 증거: 완료 전 결과는 running이고 완료 뒤 전체 로그와 출처를 실제 파일에 남긴다', async (t) => {
  const text = `${'한글 전체 로그\n'.repeat(400)}끝\n`;
  const fixture = evidenceFixture(t, [{ hold: true, stdout: text, stderr: '경고\n' }]);
  const running = runSuite([{ script: 'verify:fixture', budgetMs: 5000 }], fixture.deps);
  await new Promise(setImmediate);
  const directory = path.join(fixture.outputRoot, fs.readdirSync(fixture.outputRoot)[0]);
  const reportPath = path.join(directory, 'result.json');
  const before = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(before.status, 'running');
  assert.equal(before.ok, null, '끝나지 않은 실행을 성공으로 읽으면 안 된다');
  fixture.children[0].emit('close', 0);
  const result = await running;
  assert.deepEqual(JSON.parse(fs.readFileSync(result.reportPath, 'utf8')), result);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'complete');
  assert.equal(result.sourceSnapshotsMatch, true);
  assert.deepEqual(result.source, fixture.source);
  assert.ok(Date.parse(result.finishedAt) >= Date.parse(result.startedAt));
  assert.ok(result.durationMs >= 0);
  const step = result.results[0];
  assert.equal(step.stdoutTail, text.slice(-2000));
  assert.equal(step.stderrTail, '경고\n');
  assert.equal(fs.readFileSync(step.stdoutLog, 'utf8'), text, '2000자 꼬리 외의 앞부분도 보존한다');
  assert.equal(fs.readFileSync(step.stderrLog, 'utf8'), '경고\n');
  assert.ok(Date.parse(step.finishedAt) >= Date.parse(step.startedAt));
  assert.ok(step.durationMs >= 0);
});

for (const outcome of ['failure', 'timeout', 'throw', 'error']) {
  test(`실행 증거: ${outcome}도 이전 단계 결과와 실제 로그를 잃지 않는다`, async (t) => {
    const fixture = evidenceFixture(t, [
      { stdout: '앞 단계 성공\n' },
      { stdout: '실패 전 출력\n', stderr: '진단\n', code: outcome === 'failure' ? 3 : 0,
        hold: outcome === 'timeout', throw: outcome === 'throw', error: outcome === 'error' },
    ]);
    const result = await runSuite([
      { script: 'verify:first', budgetMs: 5000 },
      { script: 'verify:second', budgetMs: outcome === 'timeout' ? 20 : 5000 },
    ], fixture.deps);
    assert.equal(result.ok, false);
    assert.equal(result.results[0].ok, true);
    const failed = result.results[1];
    assert.equal(failed.ok, false);
    assert.equal(failed.timedOut, outcome === 'timeout');
    assert.equal(failed.code, outcome === 'failure' ? 3 : null);
    if (outcome === 'throw' || outcome === 'error') assert.match(failed.error, /fixture/);
    assert.equal(fs.existsSync(failed.stdoutLog), true);
    assert.equal(fs.existsSync(failed.stderrLog), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(result.reportPath, 'utf8')), result);
  });
}

test('실행 증거: 연속 실행은 서로 덮어쓰지 않고 공유된 옛 리포트·캡처는 미확인으로 둔다', async (t) => {
  const fixture = evidenceFixture(t, [{}, { code: 2 }]);
  const staleReport = path.join(fixture.outputRoot, 'PAPER-SCREENS.json');
  const staleCapture = path.join(fixture.outputRoot, 'old.png');
  fs.writeFileSync(staleReport, '{"ok":true,"from":"old-run"}');
  fs.writeFileSync(staleCapture, 'old-image');
  const selected = [{ script: 'verify:fixture', budgetMs: 5000 }];
  const first = await runSuite(selected, fixture.deps);
  const firstBytes = fs.readFileSync(first.reportPath);
  const second = await runSuite(selected, fixture.deps);
  assert.notEqual(first.runId, second.runId);
  assert.notEqual(first.reportPath, second.reportPath);
  assert.deepEqual(fs.readFileSync(first.reportPath), firstBytes);
  assert.equal(second.ok, false, '옛 성공 리포트가 현재 실패를 뒤집으면 안 된다');
  for (const report of [first, second]) {
    assert.equal(report.verificationScope, 'subprocess-exit-status');
    assert.equal(report.sharedArtifacts.verified, false);
    assert.match(report.sharedArtifacts.reason, /run|실행/);
  }
  assert.equal(fs.readFileSync(staleReport, 'utf8'), '{"ok":true,"from":"old-run"}');
  assert.equal(fs.readFileSync(staleCapture, 'utf8'), 'old-image');
});

test('실행 증거: 현재 Git commit과 dirty 여부 및 작업 사본 내용 해시를 읽는다', () => {
  const source = readSourceIdentity();
  assert.match(source.commit, /^[0-9a-f]{40}$/);
  assert.equal(typeof source.dirty, 'boolean');
  assert.match(source.worktreeSha256, /^[0-9a-f]{64}$/);
  assert.equal(source.error, undefined);
});

test('실행 증거: 시작과 종료의 소스가 다르면 동일 기준이라고 표시하지 않는다', async (t) => {
  const fixture = evidenceFixture(t, [{}]);
  let reads = 0;
  fixture.deps.getSource = () => ({ ...fixture.source, worktreeSha256: String(++reads).repeat(64) });
  const result = await runSuite([{ script: 'verify:fixture', budgetMs: 5000 }], fixture.deps);
  assert.equal(result.ok, true, 'ok는 기존 프로세스 종료 코드 의미를 유지한다');
  assert.equal(result.sourceSnapshotsMatch, false);
  assert.notEqual(result.source.worktreeSha256, result.sourceAtEnd.worktreeSha256);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.reportPath, 'utf8')), result);
});

test('실행 증거: Git 출처를 못 읽으면 동일 기준이라고 표시하지 않는다', async (t) => {
  const fixture = evidenceFixture(t, [{}]);
  fixture.deps.getSource = () => ({
    commit: null, dirty: null, worktreeSha256: null, error: 'git failed',
  });
  const result = await runSuite([{ script: 'verify:fixture', budgetMs: 5000 }], fixture.deps);
  assert.equal(result.ok, true, 'ok는 기존 프로세스 종료 코드 의미를 유지한다');
  assert.equal(result.sourceSnapshotsMatch, false);
  assert.equal(result.source.error, 'git failed');
  assert.equal(result.sourceAtEnd.error, 'git failed');
  assert.deepEqual(JSON.parse(fs.readFileSync(result.reportPath, 'utf8')), result);
});

test('실행 증거: result.json을 못 쓰면 완료 성공 영수증을 남기지 않는다', async (t) => {
  const fixture = evidenceFixture(t, [{ hold: true }]);
  const running = runSuite([{ script: 'verify:fixture', budgetMs: 5000 }], fixture.deps);
  await new Promise(setImmediate);
  const directory = path.join(fixture.outputRoot, fs.readdirSync(fixture.outputRoot)[0]);
  const reportPath = path.join(directory, 'result.json');
  const before = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(before.status, 'running');
  assert.equal(before.ok, null);
  fs.unlinkSync(reportPath);
  fs.mkdirSync(reportPath);
  fixture.children[0].emit('close', 0);
  await assert.rejects(running);
  const leftover = fs.readdirSync(directory)
    .filter((name) => name.startsWith('result.json') && fs.statSync(path.join(directory, name)).isFile())
    .map((name) => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')));
  for (const report of leftover) {
    assert.notEqual(report.ok, true);
    assert.notEqual(report.status, 'complete');
  }
});

test('실행 증거: 로그 파일을 쓸 수 없으면 자식 exit0도 성공 증거가 아니다', async (t) => {
  const fixture = evidenceFixture(t, [{ hold: true }]);
  const running = runSuite([{ script: 'verify:fixture', budgetMs: 5000 }], fixture.deps);
  const directory = path.join(fixture.outputRoot, fs.readdirSync(fixture.outputRoot)[0]);
  const stdoutLog = path.join(directory, fs.readdirSync(directory).find((file) => file.endsWith('.stdout.log')));
  fs.unlinkSync(stdoutLog);
  fs.mkdirSync(stdoutLog); // appendFileSync가 실패하는 실제 파일시스템 대조군
  fixture.children[0].stdout.push(Buffer.from('저장되지 못할 출력'));
  fixture.children[0].emit('close', 0);
  const result = await running;
  assert.equal(result.ok, false);
  assert.equal(result.results[0].code, 0);
  assert.match(result.results[0].error, /log write failed/);
});
