'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { StringDecoder } = require('node:string_decoder');

const { parseOnly, runOne } = require('./run-verify-suite');

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

function harness({ budgetMs = 20 } = {}) {
  const child = fakeChild();
  const terminated = [];
  const spawnArgs = [];
  const promise = runOne({ script: 'verify:kiumi', budgetMs }, {
    spawn: (command, args, options) => {
      spawnArgs.push({ command, args, options });
      return child;
    },
    terminateTree: (target) => {
      terminated.push(target);
      return Promise.resolve({ ok: true, outcome: 'forced' });
    },
  });
  return { child, terminated, spawnArgs, promise };
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
  const parsed = parseOnly(['node', 'run-verify-suite.js', '--only', '--list']);
  assert.equal(parsed.only, undefined);
  assert.match(parsed.error, /--only/);
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
  const { child, promise } = harness({ budgetMs: 10 });
  const result = await promise;
  child.emit('close', 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.timedOut, true);
  assert.equal(result.ok, false);
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
