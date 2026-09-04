'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const { VERIFY_SUITE } = require('../lib/live-full-catalog');

const appDir = path.join(__dirname, '..');
const listOnly = process.argv.includes('--list');
const only = (() => {
  const idx = process.argv.indexOf('--only');
  return idx === -1 ? null : process.argv[idx + 1];
})();

function printList() {
  for (const item of VERIFY_SUITE) {
    process.stdout.write(`${item.script}\t${item.budgetMs}\n`);
  }
}

function runOne(item) {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', item.script], {
      cwd: appDir,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill();
      resolve({
        script: item.script,
        ok: false,
        code: null,
        timedOut: true,
        budgetMs: item.budgetMs,
      });
    }, item.budgetMs);
    child.on('close', (code) => {
      clearTimeout(timer);
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
  if (listOnly) {
    printList();
    return;
  }
  const selected = only
    ? VERIFY_SUITE.filter((item) => item.script === only)
    : VERIFY_SUITE;
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

main().catch((error) => {
  process.stderr.write(String(error && error.stack || error) + '\n');
  process.exitCode = 1;
});
