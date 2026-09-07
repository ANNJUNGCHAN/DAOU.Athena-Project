'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { captureRoot } = require('./probe-captures');

test('ATHENA_CAPTURE_DIR가 있으면 공유 captures가 아니라 그 디렉터리다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-capture-dir-'));
  const previous = process.env.ATHENA_CAPTURE_DIR;
  process.env.ATHENA_CAPTURE_DIR = dir;
  try {
    assert.equal(captureRoot(path.join(os.tmpdir(), 'unused-app')), path.resolve(dir));
    assert.equal(fs.existsSync(dir), true);
  } finally {
    if (previous === undefined) delete process.env.ATHENA_CAPTURE_DIR;
    else process.env.ATHENA_CAPTURE_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ATHENA_CAPTURE_DIR가 없으면 appDir/captures 를 만들고 쓴다', () => {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-capture-app-'));
  const previous = process.env.ATHENA_CAPTURE_DIR;
  delete process.env.ATHENA_CAPTURE_DIR;
  try {
    const root = captureRoot(appDir);
    assert.equal(root, path.join(appDir, 'captures'));
    assert.equal(fs.existsSync(root), true);
  } finally {
    if (previous === undefined) delete process.env.ATHENA_CAPTURE_DIR;
    else process.env.ATHENA_CAPTURE_DIR = previous;
    fs.rmSync(appDir, { recursive: true, force: true });
  }
});

test('전수 스위트의 공유 리포트 하네스는 captureRoot를 쓴다', () => {
  const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  const files = [
    'verify.js',
    'probe-live-full.js',
    'verify-hoga-live.js',
    'verify-kiumi.js',
    'verify-settings.js',
    'verify-settings-cards.js',
    'verify-plugins.js',
    'probe-chat-v3-visual.js',
    'probe-agent-paper-parity.js',
    'probe-orb-order-ticket.js',
    'probe-orb-conversation.js',
    'probe-orb-kiumi-96.js',
    'verify-integrated-cards.js',
    'verify-life003.js',
    'run-life003-review.js',
    'scripts/paper-cards-static.mjs',
    'scripts/paper-mini-static.mjs',
  ];
  for (const file of files) {
    const src = read(file);
    assert.match(src, /probe-captures/, file);
    assert.match(src, /captureRoot\(/, file);
    assert.doesNotMatch(
      src,
      /path\.join\((?:__dirname|APP|APP_ROOT|appDir|APP_DIR), ['"]captures['"]\)/,
      file,
    );
  }
});
