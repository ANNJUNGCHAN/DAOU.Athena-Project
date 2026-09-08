'use strict';

const { spawn, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
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
  const started = Date.now();
  const logPaths = deps.logPaths || {};
  for (const file of Object.values(logPaths)) fs.writeFileSync(file, '');
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timer;
    let logError = null;
    const finish = (code, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const finished = Date.now();
      const failure = error ? String(error.message || error) : logError;
      resolve({
        script: item.script, ok: code === 0 && !timedOut && !failure,
        code, timedOut, budgetMs: item.budgetMs, error: failure,
        startedAt: new Date(started).toISOString(), finishedAt: new Date(finished).toISOString(),
        durationMs: Math.max(0, finished - started),
        stdoutTail: stdout, stderrTail: stderr,
        stdoutLog: logPaths.stdout || null, stderrLog: logPaths.stderr || null,
      });
    };
    const append = (stream, chunk) => {
      if (settled) return;
      if (stream === 'stdout') stdout = (stdout + chunk).slice(-2000);
      else stderr = (stderr + chunk).slice(-2000);
      if (logPaths[stream]) {
        try { fs.appendFileSync(logPaths[stream], chunk, 'utf8'); }
        catch (error) { logError = `log write failed: ${error.message}`; }
      }
    };
    let child;
    try {
      child = spawnFn('npm', ['run', item.script], {
        cwd: appDir, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) { finish(null, error); return; }
    // shell: true라 Windows에서는 cmd.exe → npm.cmd → electron 3단 트리가 뜬다.
    // child.kill()은 직계 cmd.exe만 죽여 electron 좀비가 프로필 락을 쥔 채 남으므로
    // 트리째 죽이는 terminateTree(win32에서 taskkill /T /F)를 쓰고 그 종료를 기다린다.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    timer = setTimeout(() => {
      timedOut = true;
      Promise.resolve().then(() => terminateFn(child)).then(
        () => finish(null), (error) => finish(null, error),
      );
    }, item.budgetMs);
    child.on('error', (error) => { if (!timedOut) finish(null, error); });
    child.on('close', (code) => {
      if (timedOut) return;
      finish(code);
    });
  });
}

// commit만 적으면 미커밋 수정이 같은 실행 출처로 보인다. ignored 산출물은 빼고
// Git이 추적하거나 아직 추가하지 않은 파일의 실제 내용도 함께 식별한다.
function readSourceIdentity() {
  const root = path.join(appDir, '..');
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const source = { commit: null, dirty: null, worktreeSha256: null };
  try {
    source.commit = git(['rev-parse', 'HEAD']).trim();
    source.dirty = !!git(['status', '--porcelain', '--untracked-files=all']).trim();
    const files = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
      .split('\0').filter(Boolean))].sort();
    const hash = createHash('sha256');
    for (const file of files) {
      const fullPath = path.join(root, file);
      hash.update(`${file}\0`);
      try {
        const stat = fs.lstatSync(fullPath);
        hash.update(stat.isSymbolicLink() ? fs.readlinkSync(fullPath) : fs.readFileSync(fullPath));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        hash.update('\0deleted');
      }
      hash.update('\0');
    }
    source.worktreeSha256 = hash.digest('hex');
  } catch (error) { source.error = String(error.message || error); }
  return source;
}

async function runSuite(selected, deps = {}) {
  const write = deps.write || ((text) => process.stdout.write(text));
  const getSource = deps.getSource || readSourceIdentity;
  const started = Date.now();
  const outputRoot = deps.outputRoot || path.join(appDir, 'captures', 'verify-suite');
  fs.mkdirSync(outputRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(outputRoot, `${new Date(started).toISOString().replace(/[:.]/g, '-')}-`));
  const report = {
    ok: null, results: [],
    schemaVersion: 1, runId: path.basename(directory), suite: deps.suite || 'default',
    reportPath: path.join(directory, 'result.json'),
    startedAt: new Date(started).toISOString(), finishedAt: null, durationMs: null,
    status: 'running', source: getSource(),
    verificationScope: 'subprocess-exit-status',
    // 하위 프로브가 공유 captures에 쓰는 파일은 이 run ID를 확인할 계약이 없다.
    // 존재/mtime만으로 이번 실행의 리포트·캡처라고 승격하지 않는다.
    sharedArtifacts: { verified: false, reason: 'Shared reports/captures are not bound to this run ID.' },
  };
  const persist = () => {
    fs.writeFileSync(`${report.reportPath}.tmp`, JSON.stringify(report, null, 2) + '\n');
    fs.renameSync(`${report.reportPath}.tmp`, report.reportPath);
  };
  persist();
  for (const [index, item] of selected.entries()) {
    report.currentStep = { script: item.script, startedAt: new Date().toISOString() };
    persist();
    write(`[suite] start ${item.script} budget=${item.budgetMs}\n`);
    const prefix = `${String(index + 1).padStart(3, '0')}-${item.script.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const result = await runOne(item, {
      ...deps, logPaths: {
        stdout: path.join(directory, `${prefix}.stdout.log`),
        stderr: path.join(directory, `${prefix}.stderr.log`),
      },
    });
    report.results.push(result);
    report.currentStep = null;
    persist();
    write(`[suite] ${item.script} ok=${result.ok} timedOut=${result.timedOut} code=${result.code}\n`);
  }
  report.sourceAtEnd = getSource();
  report.sourceSnapshotsMatch = !!report.source.worktreeSha256
    && report.source.worktreeSha256 === report.sourceAtEnd.worktreeSha256
    && report.source.commit === report.sourceAtEnd.commit;
  report.finishedAt = new Date().toISOString();
  report.durationMs = Math.max(0, Date.now() - started);
  report.status = 'complete';
  report.ok = report.results.every((result) => result.ok);
  persist();
  return report;
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
  const report = await runSuite(selected, { suite: parsedSuite.suite });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(String(error && error.stack || error) + '\n');
    process.exitCode = 1;
  });
}

module.exports = { parseOnly, parseSuite, runOne, runSuite, readSourceIdentity };
