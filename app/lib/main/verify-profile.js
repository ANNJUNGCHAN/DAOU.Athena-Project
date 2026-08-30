const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const PROFILE_PREFIX = 'athena-verify-';
const MARKER_FILE = '.athena-verify-profile.json';
const MARKER_KIND = 'athena-electron-verify-profile';
const DIAGNOSTIC_PREFIX = '.athena-verify-cleanup-';
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SCENARIOS = Object.freeze({
  configured: Object.freeze({ cliDone: true, accountDone: true }),
  'new-user': Object.freeze({ cliDone: false, accountDone: false }),
  'cli-complete': Object.freeze({ cliDone: true, accountDone: false }),
});

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function assertScenario(scenario) {
  if (!Object.prototype.hasOwnProperty.call(SCENARIOS, scenario)) {
    throw new Error(`알 수 없는 검증 프로필 시나리오: ${scenario}`);
  }
}

function markerPath(directory) {
  return path.join(directory, MARKER_FILE);
}

function readMarker(directory) {
  try {
    return JSON.parse(fs.readFileSync(markerPath(directory), 'utf8'));
  } catch {
    return null;
  }
}

function samePath(left, right) {
  const normalize = (value) => path.resolve(value).toLowerCase();
  return normalize(left) === normalize(right);
}

function validateCleanupTarget({ directory, tempRoot, expectedRunId }) {
  if (!directory || !tempRoot || !RUN_ID_PATTERN.test(String(expectedRunId || ''))) {
    return { ok: false, reason: 'invalid-cleanup-identity' };
  }
  const resolved = path.resolve(directory);
  const root = path.resolve(tempRoot);
  if (!samePath(path.dirname(resolved), root)) return { ok: false, reason: 'outside-temp-root' };
  if (!path.basename(resolved).startsWith(PROFILE_PREFIX)) return { ok: false, reason: 'invalid-prefix' };
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    return { ok: false, reason: 'profile-missing' };
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return { ok: false, reason: 'invalid-profile-node' };
  try {
    if (!samePath(fs.realpathSync(resolved), resolved)
        || !samePath(fs.realpathSync(root), root)) {
      return { ok: false, reason: 'profile-path-redirected' };
    }
  } catch {
    return { ok: false, reason: 'profile-realpath-failed' };
  }
  const marker = readMarker(resolved);
  if (!marker) return { ok: false, reason: 'marker-missing' };
  if (marker.kind !== MARKER_KIND) return { ok: false, reason: 'marker-kind-mismatch' };
  if (marker.runId !== expectedRunId) return { ok: false, reason: 'run-id-mismatch' };
  return { ok: true, directory: resolved, tempRoot: root };
}

function diagnosticPath(tempRoot, runId) {
  return path.join(path.resolve(tempRoot), `${DIAGNOSTIC_PREFIX}${runId}.json`);
}

function writeCleanupDiagnostic(tempRoot, runId, reason) {
  if (!RUN_ID_PATTERN.test(String(runId || ''))) return false;
  try {
    writeJson(diagnosticPath(tempRoot, runId), {
      kind: 'athena-verify-cleanup-diagnostic',
      runId,
      reason: String(reason || 'cleanup-failed'),
      failedAt: new Date().toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}

function consumeCleanupDiagnostics(tempRoot) {
  const root = path.resolve(tempRoot);
  let names = [];
  try {
    names = fs.readdirSync(root).filter((name) => name.startsWith(DIAGNOSTIC_PREFIX) && name.endsWith('.json'));
  } catch {
    return [];
  }
  const diagnostics = [];
  for (const name of names) {
    const filePath = path.join(root, name);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (parsed.kind === 'athena-verify-cleanup-diagnostic'
          && RUN_ID_PATTERN.test(String(parsed.runId || ''))
          && typeof parsed.reason === 'string') {
        diagnostics.push({ runId: parsed.runId, reason: parsed.reason, failedAt: parsed.failedAt || null });
      }
      fs.rmSync(filePath, { force: true });
    } catch {
      // 깨진 진단 파일은 다른 사용자의 임시 파일일 수 있으므로 지우지 않는다.
    }
  }
  return diagnostics;
}

function seedVerifyProfile(directory, scenario = 'configured') {
  assertScenario(scenario);
  const resolved = path.resolve(directory);
  const marker = readMarker(resolved);
  if (!marker || marker.kind !== MARKER_KIND) {
    throw new Error('표식 없는 디렉터리는 검증 프로필로 시드할 수 없음');
  }

  writeJson(path.join(resolved, 'athena-onboarding.json'), SCENARIOS[scenario]);
  // 계정 파일도 명시적으로 비운다. 새 임시 디렉터리라는 사실에 기대지 않아
  // LIFE-001 상태가 머신의 기존 계정·이전 검증 실행과 무관함을 드러낸다.
  writeJson(path.join(resolved, 'athena-accounts.json'), { activeId: null, accounts: [] });
  writeJson(path.join(resolved, 'athena-cli-accounts.json'), { activeId: null, accounts: {} });
  writeJson(markerPath(resolved), { ...marker, scenario });
  return { scenario, onboarding: { ...SCENARIOS[scenario] } };
}

function createFreshVerifyProfile({ tempRoot = os.tmpdir(), scenario = 'configured' } = {}) {
  assertScenario(scenario);
  const root = path.resolve(tempRoot);
  fs.mkdirSync(root, { recursive: true });
  const cleanupDiagnostics = consumeCleanupDiagnostics(root);
  const directory = fs.mkdtempSync(path.join(root, PROFILE_PREFIX));
  const runId = crypto.randomUUID();
  writeJson(markerPath(directory), {
    kind: MARKER_KIND,
    runId,
    scenario,
    createdAt: new Date().toISOString(),
  });
  seedVerifyProfile(directory, scenario);
  return { directory, tempRoot: root, runId, scenario, cleanupDiagnostics };
}

function cleanupVerifyProfile(directory, { tempRoot, expectedRunId } = {}) {
  const validated = validateCleanupTarget({ directory, tempRoot, expectedRunId });
  if (!validated.ok) return false;
  try {
    // 실제 삭제 직전 한 번 더 읽는다. 감시 시작 뒤 같은 경로가 다른 marker나
    // 외부 데이터로 교체됐으면 이 시점에서 거부한다.
    const immediatelyBeforeDelete = validateCleanupTarget({ directory, tempRoot, expectedRunId });
    if (!immediatelyBeforeDelete.ok) return false;
    fs.rmSync(immediatelyBeforeDelete.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    return !fs.existsSync(immediatelyBeforeDelete.directory);
  } catch {
    return false;
  }
}

function parentProcessAlive(parentPid) {
  try {
    process.kill(parentPid, 0);
    return true;
  } catch {
    return false;
  }
}

function validateNodeExecutable(candidate) {
  if (!candidate || !path.isAbsolute(candidate) || !fs.existsSync(candidate)) {
    throw new Error('검증 정리 감시자에 사용할 절대 Node 실행 경로가 없음');
  }
  const reported = execFileSync(candidate, ['-p', 'process.execPath'], {
    encoding: 'utf8', windowsHide: true, timeout: 5000,
  }).trim();
  if (!reported || !samePath(fs.realpathSync(reported), fs.realpathSync(candidate))) {
    throw new Error('검증 정리 감시자 Node 실행 경로 검증 실패');
  }
  return fs.realpathSync(candidate);
}

function resolveNodeExecutable({ electron = !!process.versions.electron, env = process.env, execPath = process.execPath } = {}) {
  return validateNodeExecutable(electron ? env.npm_node_execpath : execPath);
}

async function runCleanupWatchdog({
  directory,
  tempRoot,
  expectedRunId,
  parentPid,
  retryWindowMs = 15000,
  pollMs = 100,
  now = Date.now,
  isParentAlive = parentProcessAlive,
  removeTarget = cleanupVerifyProfile,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  writeDiagnostic = writeCleanupDiagnostic,
} = {}) {
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0) {
    throw new Error('parentPid는 양의 safe integer여야 함');
  }
  if (!Number.isFinite(retryWindowMs) || retryWindowMs < 0) {
    throw new Error('retryWindowMs가 올바르지 않음');
  }
  const initial = validateCleanupTarget({ directory, tempRoot, expectedRunId });
  if (!initial.ok) {
    writeDiagnostic(tempRoot, expectedRunId, initial.reason);
    return { ok: false, reason: initial.reason, parentStoppedAt: null };
  }

  let parentStoppedAt = null;
  for (;;) {
    if (isParentAlive(parentPid)) {
      await sleep(pollMs);
      continue;
    }
    if (parentStoppedAt === null) parentStoppedAt = now();

    const current = validateCleanupTarget({ directory, tempRoot, expectedRunId });
    if (!current.ok) {
      // 이미 삭제된 경우는 성공이다. 그 외 교체/경계 위반은 절대 삭제하지 않는다.
      if (current.reason === 'profile-missing') return { ok: true, reason: 'already-removed', parentStoppedAt };
      writeDiagnostic(tempRoot, expectedRunId, current.reason);
      return { ok: false, reason: current.reason, parentStoppedAt };
    }
    if (removeTarget(directory, { tempRoot, expectedRunId })) {
      return { ok: true, reason: 'removed', parentStoppedAt };
    }
    if (now() - parentStoppedAt >= retryWindowMs) {
      writeDiagnostic(tempRoot, expectedRunId, 'cleanup-timeout');
      return { ok: false, reason: 'cleanup-timeout', parentStoppedAt };
    }
    await sleep(pollMs);
  }
}

function startVerifyProfileCleanupWatchdog(directory, {
  tempRoot,
  expectedRunId,
  parentPid = process.pid,
  nodeExecutable,
} = {}) {
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0) {
    throw new Error('parentPid는 양의 safe integer여야 함');
  }
  const validated = validateCleanupTarget({ directory, tempRoot, expectedRunId });
  if (!validated.ok) throw new Error(`검증 프로필 정리 감시자 대상 거부: ${validated.reason}`);
  const executable = nodeExecutable ? validateNodeExecutable(nodeExecutable) : resolveNodeExecutable();

  // Electron/Chromium 자식이 userData 파일을 잡고 있어 before-quit/exit 시점의
  // 동기 삭제는 Windows에서 잔여 폴더를 남길 수 있다. 분리된 Node 프로세스가
  // 부모 종료를 확인한 뒤 잠금이 풀릴 때까지 제한적으로 재시도한다.
  const payload = Buffer.from(JSON.stringify({
    directory: validated.directory,
    tempRoot: validated.tempRoot,
    expectedRunId,
    parentPid,
  })).toString('base64url');
  const child = spawn(executable, [__filename, '--cleanup-watchdog', payload], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: process.env,
  });
  child.unref();
  return child.pid;
}

async function runWatchdogCli() {
  const encoded = process.argv[3];
  let payload;
  try {
    payload = JSON.parse(Buffer.from(String(encoded || ''), 'base64url').toString('utf8'));
  } catch {
    process.exitCode = 2;
    return;
  }
  const result = await runCleanupWatchdog(payload);
  process.exitCode = result.ok ? 0 : 1;
}

if (require.main === module && process.argv[2] === '--cleanup-watchdog') {
  void runWatchdogCli();
}

module.exports = {
  SCENARIOS,
  createFreshVerifyProfile,
  seedVerifyProfile,
  cleanupVerifyProfile,
  validateCleanupTarget,
  consumeCleanupDiagnostics,
  resolveNodeExecutable,
  runCleanupWatchdog,
  startVerifyProfileCleanupWatchdog,
};
