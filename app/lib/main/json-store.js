// userData JSON 상태 파일 원자 쓰기 — tmp에 쓰고 rename(부분 쓰기 방지).
// 6개 모듈(accounts/cli-accounts/model-prefs/onboarding/prefs/secrets)이 각자
// 들고 있던 동일 구현을 한 곳으로 모았다(2026-08-20 포니테일 감사).
'use strict';
const fs = require('fs');
const path = require('path');
function writeJsonAtomic(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}
module.exports = { writeJsonAtomic };
