// 자식 프로세스 트리 종료 공용 유틸 — claude-runner.js·backend-launcher.js가
// 각자 들고 있던 동일 구현을 한 곳으로 모았다(2026-08-20 포니테일 감사).
//
// claude.exe(→ athena-mcp serve → upstream N개)나 uvicorn worker처럼, 자식
// 프로세스 자신만 죽이면 그 밑의 손자 프로세스가 고아로 남을 수 있다 — Windows는
// taskkill /T로 프로세스 트리를 통째로 끊는다.
'use strict';

const { spawn } = require('child_process');

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch { /* 이미 죽어 있으면 그만 */ }
  } else {
    try { child.kill('SIGTERM'); } catch { /* 동일 */ }
  }
}

module.exports = { killTree };
