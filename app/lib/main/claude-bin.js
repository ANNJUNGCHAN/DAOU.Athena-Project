// claude 실행 파일 해석 — 네 스폰 지점(claude-runner·claude-chat-session·
// claude-selector-worker-pool·cli-accounts)이 각자 `process.env.ATHENA_CLAUDE_BIN
// || 'claude'`를 반복하던 것을 한 군데로 모은다.
//
// **왜 필요했나.** 자식 프로세스는 부모의 PATH를 상속한다. 앱을 PATH가 얕은
// 환경(바탕화면 바로가기·패키징된 exe·스케줄러·비대화형 셸)에서 켜면 네 곳이
// 한꺼번에 `spawn claude ENOENT`를 낸다(2026-09-01 실측 — 온보딩 CLI 연결이
// "Claude CLI가 이 컴퓨터에 설치되어 있지 않다"를 냈지만 실제로는 설치돼
// 있었다). 그때까지 네 곳의 대응은 전부 "사용자에게 `where claude`를 쳐보라"고
// 안내하는 것뿐이었다.
//
// **왜 .cmd/.ps1을 후보에서 뺐나.** claude-runner.js는 `shell:false`로 스폰한다
// — `shell:true`로 되돌리면 빈 문자열 인자가 사라져 `--setting-sources`가
// 깨진다(claude-runner.js의 spawn 주석). Windows에서 `shell:false`는 실행
// 파일(.exe)만 찾으므로, npm 전역이 깔아 두는 `claude.cmd`/`claude.ps1` 래퍼는
// 여기서 쓸 수 없다. 실측(2026-09-01): npm 전역엔 `.exe`가 아예 없고
// (`claude`·`claude.cmd`·`claude.ps1` 셋 다 래퍼), `~/.local/bin/claude.exe`만
// 진짜 실행 파일이다. 그래서 npm 전역 prefix는 후보에 넣지 않는다.
//
// **왜 명시 오버라이드를 검증하지 않나.** probe-turn-error.js가 존재하지 않는
// 경로를 일부러 ATHENA_CLAUDE_BIN에 넣어 ENOENT 처리 경로를 시험한다. 여기서
// 존재를 확인해 다른 후보로 넘어가 버리면 그 프로브가 무의미해진다. 명시
// 지정은 있는 그대로 돌려준다 — "지정했으면 그것만 쓴다"가 계약이다.
//
// **왜 경로를 하드코딩하지 않나.** 사용자명·노드 버전이 박힌 경로는 PC가
// 바뀌거나 노드를 올리면 그대로 깨진다. 후보는 전부 `os.homedir()`나 PATH
// 질의에서 유도한다.

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

// 마지막 수단. 지금까지의 동작과 같다 — PATH에 있으면 뜨고, 없으면 각 호출부의
// ENOENT 메시지가 안내한다. 여기서 던지지 않는 이유: 던지면 "claude 없이도
// 뜨긴 하던" 화면들이 기동 자체를 못 하게 되어 회귀 범위가 커진다.
const FALLBACK = 'claude';

function executableName(platform) {
  return platform === 'win32' ? 'claude.exe' : 'claude';
}

// PATH 조회. Windows는 `where`가 여러 줄을 주므로 실행 가능한 첫 줄만 쓴다.
// `where claude`는 .cmd/.ps1 래퍼도 같이 뱉으므로 확장자로 거른다(위 주석).
function fromPath({ platform, spawnSyncImpl, existsSync }) {
  const wanted = executableName(platform);
  const probe = platform === 'win32'
    ? spawnSyncImpl('where', [wanted], { encoding: 'utf8', windowsHide: true })
    : spawnSyncImpl('which', [wanted], { encoding: 'utf8' });
  if (!probe || probe.status !== 0 || !probe.stdout) return null;
  for (const line of String(probe.stdout).split(/\r?\n/)) {
    const candidate = line.trim();
    if (!candidate) continue;
    if (platform === 'win32' && !/\.exe$/i.test(candidate)) continue;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// 네이티브 설치 위치. 사용자명을 박지 않으려고 homedir()에서 유도한다.
function fromNativeInstall({ platform, homedir, existsSync }) {
  const candidate = path.join(homedir(), '.local', 'bin', executableName(platform));
  return existsSync(candidate) ? candidate : null;
}

// 시도한 후보를 호출부 오류 메시지가 나열할 수 있게 같이 돌려준다 — "설치되어
// 있지 않다"고만 하면 사용자가 다음에 뭘 할지 알 수 없다.
function claudeBinCandidates({
  platform = process.platform,
  homedir = os.homedir,
} = {}) {
  return [
    'ATHENA_CLAUDE_BIN 환경변수',
    platform === 'win32' ? 'PATH (where claude.exe)' : 'PATH (which claude)',
    path.join(homedir(), '.local', 'bin', executableName(platform)),
  ];
}

function resolveClaudeBin({
  env = process.env,
  platform = process.platform,
  homedir = os.homedir,
  existsSync = fs.existsSync,
  spawnSyncImpl = spawnSync,
} = {}) {
  const explicit = env.ATHENA_CLAUDE_BIN;
  if (explicit) return explicit; // 검증하지 않는다 — 위 주석 참조.

  let found = null;
  try {
    found = fromPath({ platform, spawnSyncImpl, existsSync });
  } catch {
    found = null; // where/which 자체가 없는 환경 — 다음 후보로 간다.
  }
  if (found) return found;

  try {
    found = fromNativeInstall({ platform, homedir, existsSync });
  } catch {
    found = null;
  }
  return found || FALLBACK;
}

// **탐색 결과만 캐시한다 — 오버라이드는 매번 다시 읽는다.** 탐색은 spawnSync
// 왕복이라 스폰마다 돌릴 이유가 없지만, ATHENA_CLAUDE_BIN까지 캐시하면
// 실행 중에 값을 바꾸는 프로브가 깨진다: probe-orb-mini-chart-card.js는 한
// 프로세스 안에서 이 변수를 두 번(서로 다른 가짜 실행 파일로) 갈아끼운다.
let cachedDiscovery = null;
function getClaudeBin() {
  const explicit = process.env.ATHENA_CLAUDE_BIN;
  if (explicit) return explicit;
  if (cachedDiscovery === null) cachedDiscovery = resolveClaudeBin({ env: {} });
  return cachedDiscovery;
}
function resetClaudeBinCache() {
  cachedDiscovery = null;
}

module.exports = { resolveClaudeBin, getClaudeBin, resetClaudeBinCache, claudeBinCandidates };
