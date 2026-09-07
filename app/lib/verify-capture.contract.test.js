'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'verify.js'), 'utf8');

test('인접 캡처 중복 감지는 skip 항목을 바이트 동일로 치지 않는다', () => {
  const loop = src.slice(src.indexOf('const dupCaptures = []'), src.indexOf("assertOk('captureIntegrity:"));
  assert.match(loop, /if \(prev\.skipped \|\| cur\.skipped\) continue;/);
  assert.match(loop, /prev\.winTitle === cur\.winTitle && prev\.hash === cur\.hash/);
});

test('부팅 합성 단언은 캡처 스킵과 프레임 크기 불일치를 다른 원인으로 남긴다', () => {
  const fn = src.slice(
    src.indexOf('function measureBootCompositeReveal'),
    src.indexOf('function measureBootTransparency'),
  );
  assert.match(fn, /if \(!waiting \|\| !mid \|\| !full\) \{\s*return \{ pass: false, reason: 'frame-missing' \};/);
  assert.match(fn, /reason: 'frame-size-mismatch'/);
  const missingAt = fn.indexOf("reason: 'frame-missing'");
  const sizeAt = fn.indexOf("reason: 'frame-size-mismatch'");
  assert.ok(missingAt >= 0 && sizeAt > missingAt);
});

test('paperScreenCases는 capturePage skip을 제품 실패나 옛 PNG 경로로 쓰지 않는다', () => {
  const block = src.slice(src.indexOf('const imageSize = await shot(shellWin, captureName);'));
  const caseBlock = block.slice(0, block.indexOf('report.paperScreenCases[paperCase.id]') + 800);
  assert.match(caseBlock, /const captureSkipped = imageSize\.skipped === true;/);
  assert.doesNotMatch(caseBlock, /imageSize\.width > 0 && imageSize\.height > 0/);
  assert.match(caseBlock, /captureSkipped,/);
  assert.match(caseBlock, /screenshot: captureSkipped \? null : `app\/captures\/\$\{captureName\}`/);
});
