'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const appDir = __dirname;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-life003-two-run-'));
const electron = path.join(appDir, 'node_modules', 'electron', 'dist', 'electron.exe');
const reportPath = path.join(appDir, 'captures', 'LIFE-003-REVIEW.json');
function run() {
  const result = spawnSync(electron, ['run-life003-review.js'], {
    cwd: appDir, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, ATHENA_USERDATA_DIR: profile, ATHENA_REVIEW_EXIT_AFTER_REPORT: '1' },
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
  fs.writeFileSync(path.join(appDir, 'captures', 'LIFE-003-VERIFY.json'), `${JSON.stringify({
    pass: true, profile: path.basename(profile), firstRun: first, secondRun: second,
  }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ pass: true, firstShown: 1, secondShown: 0,
    orbOpenShellIpc: first.orbOpenShellIpc,
    nativeAltF4: first.nativeAltF4, trayExit: first.trayExit,
    localBackgroundActivity: first.localBackgroundActivity,
    liveServicesVerified: false }));
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
}
