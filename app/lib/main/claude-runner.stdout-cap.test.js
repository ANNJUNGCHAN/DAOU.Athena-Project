// stdout 누적 총량 상한(US-007) 테스트 — `runClaudeQuery`를 실제로 spawn까지
// 돌린다. claude-runner.test.js와 달리 여기서는 claudeBin을 오버라이드해서
// 돈다(주석 L79/L86 "테스트/오버라이드용" — 쿼터 소모 없음, 실제 claude를
// 부르지 않는다).
//
// 왜 진짜 실행 파일을 새로 컴파일하나: 가짜 claude로 node/python 등 흔한
// 인터프리터를 그대로 쓰려 해봤지만, buildArgs()가 고정한
// `-p <prompt> --output-format stream-json --verbose ...` 모양을 인터프리터
// 자신의 CLI 플래그로 해석하려 들어 낯선 플래그에서 즉시 죽는다(실측:
// `node -p "1+1" --foo`도 "bad option: --foo"로 실패한다 — -p/-e 뒤에도 Node는
// 나머지 argv 전부를 자기 플래그로 계속 파싱한다). 인자를 통째로 무시하고
// 고정 크기 stdout만 쏟는 최소 네이티브 실행 파일을 csc.exe(.NET Framework,
// Windows 기본 탑재)로 즉석 컴파일해 쓴다 — `.cmd/.bat`는 Node 22가 `shell:false`
// spawn을 EINVAL로 막는다(CVE-2024-27980 대응)라 후보에서 제외했다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// mcp-env.js의 buildEnvOverrides()가 이 컴퓨터의 실제 ~/.athena/mcp_servers.json을
// 읽지 않게 한다 — 등록된 서버가 있으면 secrets.js(safeStorage, Electron 전용)를
// 건드려 plain `node --test`에서 죽는다(mcp-env.test.js와 같은 격리 원칙).
process.env.ATHENA_MCP_REGISTRY_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'athena-stdoutcap-registry-')),
  'mcp_servers.json',
);

const { runClaudeQuery, MAX_STDOUT_BYTES } = require('./claude-runner');

function findCsc() {
  const candidates = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) {
    throw new Error('csc.exe(.NET Framework)를 못 찾았다 — stdout 상한 테스트용 가짜 실행 파일을 컴파일할 수 없다');
  }
  return found;
}

// 인자를 전부 무시하고(가짜 claude가 buildArgs()의 고정 플래그를 받아도 죽지
// 않아야 한다) totalBytes만큼 'x'를 stdout에 쏟기만 하는 최소 실행 파일.
function compileDumpFixture(totalBytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-stdoutcap-fixture-'));
  const csPath = path.join(dir, 'dump.cs');
  const exePath = path.join(dir, 'dump.exe');
  const chunkSize = 65536;
  const iterations = Math.ceil(totalBytes / chunkSize);
  const src = `
using System;
class Program {
  static void Main(string[] args) {
    var chunk = new string('x', ${chunkSize});
    var bytes = System.Text.Encoding.ASCII.GetBytes(chunk);
    var stdout = Console.OpenStandardOutput();
    for (int i = 0; i < ${iterations}; i++) { stdout.Write(bytes, 0, bytes.Length); }
    stdout.Flush();
  }
}`;
  fs.writeFileSync(csPath, src, 'utf-8');
  execFileSync(findCsc(), ['/nologo', `/out:${exePath}`, csPath], { stdio: 'pipe' });
  return exePath;
}

test('runClaudeQuery: stdout 누적 총량이 MAX_STDOUT_BYTES를 넘으면 프로세스 트리를 죽이고 stdoutCapped:true를 보고한다', async () => {
  // 상한(5,000,000바이트)의 6배 이상을 쏟는다 — 파이프 버퍼 경계와 무관하게
  // 확실히 초과하게 한다.
  const exePath = compileDumpFixture(MAX_STDOUT_BYTES * 6);
  const result = await runClaudeQuery({
    prompt: 'x',
    cwd: __dirname,
    claudeBin: exePath,
    timeoutMs: 0, // 상한 자체만 검증한다 — 기본 180초 타이머와 경합하지 않는다
  });
  assert.equal(result.ok, false);
  assert.equal(result.stdoutCapped, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.aborted, false);
  assert.match(result.error, /상한/);
  assert.ok(result.error.includes(String(Math.round(MAX_STDOUT_BYTES / 1_000_000))), `에러 메시지에 상한 크기(MB)가 있어야 한다: ${result.error}`);
});

test('runClaudeQuery: stdout 누적 총량이 상한 아래면 stdoutCapped:false — 정상 종료를 방해하지 않는다', async () => {
  const exePath = compileDumpFixture(1024); // 1KB — 상한과 무관하게 작다
  const result = await runClaudeQuery({
    prompt: 'x',
    cwd: __dirname,
    claudeBin: exePath,
    timeoutMs: 0,
  });
  assert.equal(result.stdoutCapped, false);
});

// 인자를 전부 무시하고 자기 프로세스가 실제로 물려받은 ENABLE_TOOL_SEARCH
// env 값을 stream-json type:"result" 이벤트 하나로 되돌려주는 최소 실행
// 파일. 부모(테스트)가 오염된 값을 심어도 runClaudeQuery()의 spawn env가
// 그걸 덮어썼는지를 실제 자식 프로세스 관점에서 증명한다.
function compileEnvEchoFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-envecho-fixture-'));
  const csPath = path.join(dir, 'envecho.cs');
  const exePath = path.join(dir, 'envecho.exe');
  const src = `
using System;
class Program {
  static void Main(string[] args) {
    var value = Environment.GetEnvironmentVariable("ENABLE_TOOL_SEARCH") ?? "__unset__";
    Console.WriteLine("{\\"type\\":\\"result\\",\\"is_error\\":false,\\"result\\":\\"" + value + "\\"}");
  }
}`;
  fs.writeFileSync(csPath, src, 'utf-8');
  execFileSync(findCsc(), ['/nologo', `/out:${exePath}`, csPath], { stdio: 'pipe' });
  return exePath;
}

test('runClaudeQuery: 부모 셸이 ENABLE_TOOL_SEARCH=1을 오염시켜도 자식 spawn env는 "0"으로 고정된다 (2026-08-26 카드 랜딩 결함)', async () => {
  const previous = process.env.ENABLE_TOOL_SEARCH;
  process.env.ENABLE_TOOL_SEARCH = '1'; // 오케스트레이션 셸 오염 재현
  try {
    const exePath = compileEnvEchoFixture();
    const result = await runClaudeQuery({
      prompt: 'x',
      cwd: __dirname,
      claudeBin: exePath,
      timeoutMs: 0,
    });
    assert.equal(result.finalResult && result.finalResult.result, '0');
  } finally {
    if (previous === undefined) delete process.env.ENABLE_TOOL_SEARCH;
    else process.env.ENABLE_TOOL_SEARCH = previous;
  }
});
