'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('verify-settings 실패는 app.exit(1)이고 핵심 항목을 failures로 판정한다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'verify-settings.js'), 'utf8');
  assert.match(src, /const failures = \[\]/);
  assert.match(src, /run\(\)\.catch\(\(err\) => \{[\s\S]*app\.exit\(1\)/);
  assert.doesNotMatch(src, /app\.quit\(\);\s*process\.exitCode = 1/);
  assert.match(src, /verifyOnly가 계좌를 저장했다/);
  assert.match(src, /mcp-env 복호화 왕복이 원문과 다르다/);
  assert.match(
    src,
    /if \(failures\.length\) \{[\s\S]*?app\.exit\(1\);[\s\S]*?return;[\s\S]*?\}/,
  );
  assert.match(src, /if \(!emptyAlias \|\| emptyAlias\.ok\)/);
});
