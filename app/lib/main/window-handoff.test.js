'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  canCompleteShellHandoff, isExpectedWindowSender, revealShellWithoutVisibleOverlap,
} = require('./window-handoff');

function fakeWindow(sender = {}) {
  return { webContents: sender, isDestroyed: () => false };
}

test('LIFE-002: handoff waits for both boot completion and the shell double-RAF readiness signal', () => {
  const bootWin = fakeWindow();
  const shellWin = fakeWindow();
  assert.equal(canCompleteShellHandoff({ bootVisualComplete: false, shellHandoffReady: true, bootWin, shellWin }), false);
  assert.equal(canCompleteShellHandoff({ bootVisualComplete: true, shellHandoffReady: false, bootWin, shellWin }), false);
  assert.equal(canCompleteShellHandoff({ bootVisualComplete: true, shellHandoffReady: true, bootWin, shellWin }), true);
  bootWin.isDestroyed = () => true;
  assert.equal(canCompleteShellHandoff({ bootVisualComplete: true, shellHandoffReady: true, bootWin, shellWin }), false);
});

test('LIFE-002: boot-complete and shell-ready accept only their authoritative window sender', () => {
  const expectedSender = {};
  const win = fakeWindow(expectedSender);
  assert.equal(isExpectedWindowSender({ sender: expectedSender }, win), true);
  assert.equal(isExpectedWindowSender({ sender: {} }, win), false);
  win.isDestroyed = () => true;
  assert.equal(isExpectedWindowSender({ sender: expectedSender }, win), false);
});

test('LIFE-002: handoff hides boot before showing WCO shell and never exposes both', () => {
  const events = [];
  const bootWin = {
    visible: true,
    isVisible() { return this.visible; },
    hide() { events.push('boot.hide'); this.visible = false; },
  };
  const shellWin = {
    visible: false,
    isVisible() { return this.visible; },
    show() { events.push('shell.show'); this.visible = true; },
  };
  const audit = revealShellWithoutVisibleOverlap(bootWin, shellWin);
  assert.deepEqual(events, ['boot.hide', 'shell.show']);
  assert.equal(audit.some((sample) => sample.bootVisible && sample.shellVisible), false);
  assert.deepEqual(audit.at(-1), { phase: 'shell-shown', bootVisible: false, shellVisible: true });
});
