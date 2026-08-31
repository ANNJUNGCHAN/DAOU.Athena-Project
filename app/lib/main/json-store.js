// userData JSON 상태 파일 원자 쓰기 — tmp에 쓰고 rename(부분 쓰기 방지).
// 6개 모듈(accounts/cli-accounts/model-prefs/onboarding/prefs/secrets)이 각자
// 들고 있던 동일 구현을 한 곳으로 모았다.
'use strict';
const fs = require('fs');
const path = require('path');
function writeJsonAtomic(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}
// 위와 같은 tmp+rename 절차의 비동기판 — 호출부가 메인 스레드를 막지 않고
// 영속화를 예약만 하고 싶을 때 사용한다(conversations.js의 백그라운드 저장).
async function writeJsonAtomicAsync(p, data) {
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.promises.rename(tmp, p);
}
module.exports = { writeJsonAtomic, writeJsonAtomicAsync };
