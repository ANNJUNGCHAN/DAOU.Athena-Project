'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const { VERIFY_SUITE, PAPER_SUITE } = require('../lib/live-full-catalog');
const { terminateTree } = require('../lib/main/proc-utils');

const appDir = path.join(__dirname, '..');
const USAGE = 'usage: node scripts/run-verify-suite.js [--list] [--suite <name>] [--only <script>]';

// 스위트는 두 개뿐이다(설계서 §6.2). 늘리려면 여기와 live-full-catalog.js 를 같이 고친다.
const SUITES = Object.freeze({ default: VERIFY_SUITE, paper: PAPER_SUITE });

function parseOnly(argv) {
  const idx = argv.indexOf('--only');
  if (idx === -1) return { only: null };
  const value = argv[idx + 1];
  if (!value || value.startsWith('--')) return { error: '--only 뒤에 스크립트 이름이 필요하다' };
  return { only: value };
}

// --suite 오타를 조용히 기본 스위트로 떨어뜨리면 15분짜리를 돌린 줄 알고 22분짜리를
// 돌린다. --only 와 같이 exit 2로 거절한다.
function parseSuite(argv) {
  const idx = argv.indexOf('--suite');
  if (idx === -1) return { suite: 'default' };
  const value = argv[idx + 1];
  if (!value || value.startsWith('--')) return { error: '--suite 뒤에 스위트 이름이 필요하다' };
  if (!SUITES[value]) return { error: `unknown suite ${value} (${Object.keys(SUITES).join(', ')})` };
  return { suite: value };
}

function printList(suite) {
  for (const item of suite) {
    process.stdout.write(`${item.script}\t${item.budgetMs}\n`);
  }
}

function runOne(item, deps = {}) {
  const spawnFn = deps.spawn || spawn;
  const terminateFn = deps.terminateTree || terminateTree;
  return new Promise((resolve) => {
    const child = spawnFn('npm', ['run', item.script], {
      cwd: appDir,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // shell: true라 Windows에서는 cmd.exe → npm.cmd → electron 3단 트리가 뜬다.
    // child.kill()은 직계 cmd.exe만 죽여 electron 좀비가 프로필 락을 쥔 채 남으므로
    // 트리째 죽이는 terminateTree(win32에서 taskkill /T /F)를 쓰고 그 종료를 기다린다.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      timedOut = true;
      const settle = () => resolve({
        script: item.script,
        ok: false,
        code: null,
        timedOut: true,
        budgetMs: item.budgetMs,
        stdoutTail: stdout.slice(-2000),
        stderrTail: stderr.slice(-2000),
      });
      Promise.resolve(terminateFn(child)).then(settle, settle);
    }, item.budgetMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      resolve({
        script: item.script,
        ok: code === 0,
        code,
        timedOut: false,
        budgetMs: item.budgetMs,
        stdoutTail: stdout.slice(-2000),
        stderrTail: stderr.slice(-2000),
      });
    });
  });
}

async function main() {
  const parsedSuite = parseSuite(process.argv);
  if (parsedSuite.error) {
    process.stderr.write(`${parsedSuite.error}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const suite = SUITES[parsedSuite.suite];
  if (process.argv.includes('--list')) {
    printList(suite);
    return;
  }
  const parsed = parseOnly(process.argv);
  if (parsed.error) {
    process.stderr.write(`${parsed.error}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const only = parsed.only;
  const selected = only
    ? suite.filter((item) => item.script === only)
    : suite;
  if (!selected.length) {
    process.stderr.write(`unknown script ${only}\n`);
    process.exitCode = 2;
    return;
  }
  const results = [];
  for (const item of selected) {
    process.stdout.write(`[suite] start ${item.script} budget=${item.budgetMs}\n`);
    const result = await runOne(item);
    results.push(result);
    process.stdout.write(`[suite] ${item.script} ok=${result.ok} timedOut=${result.timedOut} code=${result.code}\n`);
  }
  const failed = results.filter((item) => !item.ok);
  process.stdout.write(JSON.stringify({ ok: failed.length === 0, results }, null, 2) + '\n');
  if (failed.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(String(error && error.stack || error) + '\n');
    process.exitCode = 1;
  });
}

module.exports = { parseOnly, parseSuite, runOne };
