// QA 하네스(probe-*.js / verify-*.js / run-cases*.js)의 userData 프로필 결정.
//
// **왜 생겼나.** 하네스들은 각자 `fs.mkdtempSync()`로 임시 프로필을 만들고
// `athena-onboarding.json`에 `{cliDone:true, accountDone:true}`를 써서 온보딩을
// 건너뛴다. 그래서 사용자가 앱에서 실제로 등록한 계좌·CLI 계정을 하나도 쓰지
// 못한다 — "등록해 두고 검증이 그걸 쓰게 한다"가 성립하지 않았다.
//
// **왜 `env || mkdtemp()` 한 줄로 안 끝나나.** 하네스 11곳 중 9곳이 끝에
// `fs.rmSync(PROFILE, { recursive: true, force: true })`로 프로필을 지운다.
// PROFILE이 실프로필을 가리키는 순간 그 정리가 **등록된 계좌와 자격증명을
// 통째로 삭제한다**. 그래서 경로만 바꿔치기하면 안 되고, 공유 프로필일 때는
// 정리 자체가 존재하지 않아야 한다.
//
// 그 규칙을 호출부의 성실함에 맡기지 않는다 — 공유일 때 cleanup()과
// seedOnboarding()이 아무것도 하지 않는 함수로 나가므로, 호출부가 예전처럼
// 무심코 불러도 파괴적 동작이 일어날 수 없다.

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const ONBOARDING_FILE = 'athena-onboarding.json';
const ONBOARDING_DONE = { cliDone: true, accountDone: true };

// prefix — mkdtemp 접두사(예: 'athena-probe-backtest-'). 기존 하네스가 쓰던
// 값을 그대로 넘기면 임시 프로필 경로 모양이 변하지 않는다.
function resolveHarnessProfile({
  prefix,
  env = process.env,
  fsImpl = fs,
  tmpdir = os.tmpdir,
} = {}) {
  if (!prefix || typeof prefix !== 'string') throw new TypeError('prefix is required');

  const shared = env.ATHENA_USERDATA_DIR;
  if (shared) {
    return {
      dir: shared,
      shared: true,
      // 실프로필을 지우지 않는다 — 이 모듈이 존재하는 이유.
      cleanup() {},
      // 실제 온보딩 상태를 가짜 값으로 덮지 않는다.
      seedOnboarding() {},
    };
  }

  const dir = fsImpl.mkdtempSync(path.join(tmpdir(), prefix));
  return {
    dir,
    shared: false,
    cleanup() {
      // 앱이 띄운 MCP 서버 자식이 mcp-config를 붙잡고 있으면 EPERM이 난다.
      // 못 지워도 다음 실행은 새 디렉터리라 막히지 않는다(probe-backtest-mode.js
      // 의 기존 주석과 같은 판단).
      try { fsImpl.rmSync(dir, { recursive: true, force: true }); } catch { /* 다음 실행은 새 디렉터리다 */ }
    },
    seedOnboarding() {
      fsImpl.writeFileSync(path.join(dir, ONBOARDING_FILE), JSON.stringify(ONBOARDING_DONE));
    },
  };
}

module.exports = { resolveHarnessProfile, ONBOARDING_FILE, ONBOARDING_DONE };
