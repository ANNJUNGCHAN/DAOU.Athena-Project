'use strict';

const fs = require('node:fs');
const path = require('node:path');

// 스위트 러너가 단계마다 ATHENA_CAPTURE_DIR 을 넘긴다. 없으면 예전처럼
// 공유 app/captures/ 다. 디렉터리가 없으면 여기서 만든다 — 호출부마다
// mkdir 을 반복하지 않는다(CODE-039).
function captureRoot(appDir) {
  const env = String(process.env.ATHENA_CAPTURE_DIR || '').trim();
  const root = env ? path.resolve(env) : path.join(appDir, 'captures');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

module.exports = { captureRoot };
