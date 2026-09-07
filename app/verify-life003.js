'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveHarnessProfile } = require('./lib/main/harness-profile');
const { captureRoot } = require('./lib/probe-captures');
const appDir = __dirname;
const captures = captureRoot(appDir);
// 이 스크립트는 자식 Electron 두 번에 ATHENA_USERDATA_DIR을 넘기는 오케스트레이터다.
// 호출자가 이미 그 변수를 줬으면(실제로 등록한 계좌·CLI 계정으로 검증하고 싶을 때)
// 새 임시 프로필을 만들지 않고 그대로 물려주며, finally의 정리도 no-op이 된다.
const harnessProfile = resolveHarnessProfile({ prefix: 'athena-life003-two-run-' });
const profile = harnessProfile.dir;
const electron = path.join(appDir, 'node_modules', 'electron', 'dist', 'electron.exe');
const reportPath = path.join(captures, 'LIFE-003-REVIEW.json');
function run() {
  const result = spawnSync(electron, ['run-life003-review.js'], {
    cwd: appDir, encoding: 'utf8', timeout: 30000,
    env: {
      ...process.env,
      ATHENA_USERDATA_DIR: profile,
      ATHENA_REVIEW_EXIT_AFTER_REPORT: '1',
      ATHENA_CAPTURE_DIR: captures,
    },
  });
  if (result.status !== 0) throw new Error(`Electron LIFE-003 run failed\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
}
try {
  const first = run();
  const second = run();
  assert.equal(first.pass, true); assert.equal(first.firstCloseNotice.markedBeforeClose, false);
  assert.equal(first.firstCloseNotice.afterSecond.shown, 1);
  assert.deepEqual(first.orbOpenShellIpc, {
    channel: 'athena:orb-open-shell', rendererSubmitted: true, restored: true,
    shellVisible: true, orbHidden: true, returnedToBackgroundForTray: true,
  });
  assert.equal(first.trayExit.beforeQuitObserved, true);
  assert.equal(second.pass, true); assert.equal(second.firstCloseNotice.markedBeforeClose, true);
  assert.equal(second.firstCloseNotice.afterSecond.shown, 0);
  assert.deepEqual(second.orbOpenShellIpc, first.orbOpenShellIpc);
  assert.equal(second.trayExit.beforeQuitObserved, true);
  fs.writeFileSync(path.join(captures, 'LIFE-003-VERIFY.json'), `${JSON.stringify({
    pass: true, profile: path.basename(profile), firstRun: first, secondRun: second,
  }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ pass: true, firstShown: 1, secondShown: 0,
    orbOpenShellIpc: first.orbOpenShellIpc,
    nativeAltF4: first.nativeAltF4, trayExit: first.trayExit,
    localBackgroundActivity: first.localBackgroundActivity,
    liveServicesVerified: false }));
} finally {
  harnessProfile.cleanup(); // 공유 프로필이면 지우지 않는다.
}
