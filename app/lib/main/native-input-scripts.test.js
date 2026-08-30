'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('LIFE-002: native input helper rejects an invalid HWND explicitly', () => {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, '..', '..', 'scripts', 'send-native-double-click.ps1'),
    '-WindowHandle', '0', '-X', '1', '-Y', '1',
  ], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Window handle must be non-zero/);
});
