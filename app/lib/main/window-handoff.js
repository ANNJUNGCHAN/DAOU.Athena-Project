'use strict';

function isExpectedWindowSender(event, win) {
  return Boolean(event && win && !win.isDestroyed() && event.sender === win.webContents);
}

function canCompleteShellHandoff({ bootVisualComplete, shellHandoffReady, bootWin, shellWin }) {
  return bootVisualComplete === true
    && shellHandoffReady === true
    && Boolean(bootWin && !bootWin.isDestroyed())
    && Boolean(shellWin && !shellWin.isDestroyed());
}

function revealShellWithoutVisibleOverlap(bootWin, shellWin) {
  const audit = [];
  const sample = (phase) => audit.push({
    phase,
    bootVisible: bootWin.isVisible(),
    shellVisible: shellWin.isVisible(),
  });
  sample('before');
  bootWin.hide();
  sample('boot-hidden');
  shellWin.show();
  sample('shell-shown');
  return audit;
}

module.exports = { canCompleteShellHandoff, isExpectedWindowSender, revealShellWithoutVisibleOverlap };
