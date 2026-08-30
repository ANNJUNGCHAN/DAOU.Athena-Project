'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const bg = require('./background-close');
function withTemp(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-background-close-'));
  try { return run(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
test('show succeeds once, then durable marker blocks this run', () => withTemp((dir) => {
  let shows = 0;
  const gate = bg.createNoticeController({ userDataDir: dir, isSupported: () => true,
    showNotification: () => { shows += 1; } });
  assert.equal(gate.showOnce().shown, true);
  assert.equal(gate.showOnce().reason, 'memory-consumed');
  assert.equal(shows, 1); assert.equal(bg.markerExists(dir), true);
}));
test('new app controller respects durable marker', () => withTemp((dir) => {
  bg.writeShownMarker(dir); let shows = 0;
  const gate = bg.createNoticeController({ userDataDir: dir, isSupported: () => true,
    showNotification: () => { shows += 1; } });
  assert.equal(gate.showOnce().reason, 'durable-marker'); assert.equal(shows, 0);
}));
test('unsupported does not consume or persist', () => withTemp((dir) => {
  const gate = bg.createNoticeController({ userDataDir: dir, isSupported: () => false,
    showNotification: () => assert.fail() });
  assert.equal(gate.showOnce().reason, 'unsupported');
  assert.equal(gate.snapshot().memoryConsumed, false); assert.equal(bg.markerExists(dir), false);
}));
test('show failure releases memory and leaves no marker', () => withTemp((dir) => {
  let attempts = 0;
  const gate = bg.createNoticeController({ userDataDir: dir, isSupported: () => true,
    showNotification: () => { attempts += 1; throw new Error('show failed'); } });
  assert.equal(gate.showOnce().reason, 'show-failed');
  assert.equal(gate.showOnce().reason, 'show-failed');
  assert.equal(attempts, 2); assert.equal(bg.markerExists(dir), false);
}));
test('fsync failure removes partial marker and memory prevents duplicate in-run show', () => withTemp((dir) => {
  const brokenFs = { ...fs, fsyncSync() { throw new Error('fsync failed'); } }; let shows = 0;
  const gate = bg.createNoticeController({ userDataDir: dir, isSupported: () => true,
    showNotification: () => { shows += 1; },
    persistMarker: () => bg.writeShownMarker(dir, { fileSystem: brokenFs }) });
  const first = gate.showOnce(); assert.equal(first.shown, true); assert.equal(first.durable, false);
  assert.equal(bg.markerExists(dir), false); assert.equal(gate.showOnce().reason, 'memory-consumed');
  assert.equal(shows, 1);
}));
test('fsync plus temp-unlink failure preserves cleanup evidence and never creates final marker', () => withTemp((dir) => {
  const brokenFs = {
    ...fs,
    fsyncSync() { throw new Error('fsync failed'); },
    unlinkSync() { throw new Error('temp unlink failed'); },
  };
  assert.throws(
    () => bg.writeShownMarker(dir, { fileSystem: brokenFs, uniqueId: () => 'cleanup-failure' }),
    (error) => error.message === 'fsync failed'
      && error.cleanupError && error.cleanupError.message === 'temp unlink failed',
  );
  assert.equal(fs.existsSync(bg.markerPath(dir)), false);
}));
test('zero-byte final marker is not durable and is atomically replaced after a successful show', () => withTemp((dir) => {
  fs.writeFileSync(bg.markerPath(dir), '');
  assert.equal(bg.markerExists(dir), false);
  let shows = 0;
  const gate = bg.createNoticeController({ userDataDir: dir, isSupported: () => true,
    showNotification: () => { shows += 1; } });
  const result = gate.showOnce();
  assert.equal(result.shown, true); assert.equal(result.durable, true);
  assert.equal(shows, 1); assert.equal(bg.markerExists(dir), true);
}));
for (const notice of [false, true]) {
  test(`tray failure cannot block ${notice ? 'x-button' : 'Alt+F4'} background entry`, () => {
    const calls = [];
    const enter = bg.createBackgroundEntry({
      ensureTray() { calls.push('tray'); throw new Error('tray failed'); },
      hideShell() { calls.push('hide'); }, ensureOrbVisible() { calls.push('orb'); },
      showNotice() { calls.push('notice'); return { shown: true }; }, log() { calls.push('log'); },
    });
    assert.equal(enter({ notice }).trayReady, false);
    assert.deepEqual(calls, notice ? ['tray', 'log', 'hide', 'orb', 'notice'] : ['tray', 'log', 'hide', 'orb']);
  });
}
