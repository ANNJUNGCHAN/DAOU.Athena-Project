// CLI 공급자 4종(AT-SY-002) — Athena가 부릴 Claude/Gemini/Codex/Grok CLI
// 계정을 연결·전환한다. `plan/paper-specs/01-CLI-로그인-조사.md`(조사 완료)
// 실측 근거:
//   - Claude: 설치됨. `claude auth login` 서브커맨드. 이메일은
//     `~/.claude.json`의 `oauthAccount.emailAddress`에서 비밀값을 건드리지
//     않고 읽을 수 있다(조사 문서 결론). 자격증명 자체(`~/.claude/.credentials.json`)는
//     존재 여부만 본다 — 내용을 읽지 않는다.
//   - Codex: 설치됨. `codex login`은 로컬 콜백 서버로 자동 완료되지만,
//     "probe만 해도(중단해도) 기존 세션을 로그아웃시킨다"는 파괴적 부작용이
//     조사 중 실측됐다. 이메일은 얻을 수 없다(`auth.json`엔 `account_id`
//     UUID만 평문, 나머지는 토큰) — 그래서 라벨은 `account_id`만 쓴다.
//   - Gemini/Grok: 이 컴퓨터에 설치돼 있지 않다(조사 결과, `where`/`npm
//     list -g`/`pip list`/`winget list` 전수 실패). 로그인 명령 자체가
//     미검증이다.
//
// 브라우저 로그인 연동 방식은 스펙 각주 자체가 "미정 — 협의 필요"(빨간 글씨)로
// 명시한 미해결 이슈다(AT-SY-002 §Open questions 4). 여기서는 각 CLI의 실제
// 서브커맨드를 사용자가 보이는 터미널 창에서 직접 실행하게 위임한다(OAuth
// 리다이렉트를 이 프로세스가 가로채지 않는다) — 그 창에서 사용자가 완료한다.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

const PROVIDER_ORDER = ['claude', 'gemini', 'codex', 'grok'];
const PROVIDER_NAMES = { claude: 'Claude', gemini: 'Gemini', codex: 'Codex', grok: 'Grok' };

const LOGIN_COMMANDS = {
  claude: {
    command: 'claude',
    args: ['auth', 'login'],
    message: '터미널에서 로그인 진행 — 브라우저에서 인증 후 표시되는 코드를 터미널에 붙여넣어야 완료된다.',
  },
  codex: {
    command: 'codex',
    args: ['login'],
    message: '터미널에서 로그인 진행 — 로컬 콜백으로 자동 완료된다. 주의: 중단해도 기존 로그인 세션이 로그아웃될 수 있다(조사 문서 실측).',
  },
  gemini: {
    command: 'gemini',
    args: ['auth', 'login'],
    message: 'Gemini CLI 로그인 명령은 이 조사에서 검증되지 않았다(설치 확인 안 됨).',
  },
  grok: {
    command: 'grok',
    args: ['auth', 'login'],
    message: 'Grok CLI 로그인 명령은 이 조사에서 검증되지 않았다(설치 확인 안 됨).',
  },
};

function statePath() {
  return path.join(app.getPath('userData'), 'athena-cli-accounts.json');
}

function readState() {
  try {
    const raw = fs.readFileSync(statePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return { activeId: parsed.activeId || null, accounts: parsed.accounts || {} };
  } catch {
    return { activeId: null, accounts: {} };
  }
}

function writeState(state) {
  const p = statePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

// ---------------------------------------------------------------------------
// 감지 — 이미 로그인된 CLI를 (비밀값을 건드리지 않고) 찾아 계정 목록에 반영
// ---------------------------------------------------------------------------

function detectClaude() {
  const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
  const connected = fs.existsSync(credPath);
  if (!connected) return null;
  let label = 'Claude 계정';
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    const email = parsed && parsed.oauthAccount && parsed.oauthAccount.emailAddress;
    if (typeof email === 'string' && email) label = email;
  } catch {
    // .claude.json이 없거나 이메일 필드가 없어도 자격증명 파일 존재만으로 연결로 본다.
  }
  return { identifier: label, label };
}

function detectCodex() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const authPath = path.join(codexHome, 'auth.json');
  try {
    const raw = fs.readFileSync(authPath, 'utf-8');
    const parsed = JSON.parse(raw);
    // account_id만 꺼낸다 — id_token/access_token/refresh_token은 여기서도
    // 절대 읽지 않는다(조사 문서: 이메일을 얻으려면 JWT를 열어야 하는데 그건
    // 비밀값에 손대는 것이라 하지 않는다는 결론).
    const accountId = parsed && typeof parsed.account_id === 'string' ? parsed.account_id : null;
    if (!accountId) return null;
    return { identifier: accountId, label: `Codex · ${accountId.slice(0, 8)}` };
  } catch {
    return null;
  }
}

const DETECTORS = { claude: detectClaude, codex: detectCodex };

// 감지된-그러나-아직 목록에 없는 계정을 병합한다. "최초 연결된 계정은 자동으로
// 활성"(AT-SY-002 Desc 4) — 앱 전체에 활성 계정이 하나도 없을 때 처음 감지된
// 계정을 활성으로 삼는다(00-통합-계획.md 조사 문서의 §열린질문3 권고를 따름 —
// 새 계정은 기본 비활성, 앱 콜드스타트 때만 최초 1개가 활성이 된다).
function detectAndMerge() {
  const state = readState();
  let changed = false;
  for (const providerId of Object.keys(DETECTORS)) {
    let found;
    try {
      found = DETECTORS[providerId]();
    } catch {
      found = null;
    }
    if (!found) continue;
    const id = `${providerId}:${found.identifier}`;
    if (!state.accounts[id]) {
      state.accounts[id] = {
        id,
        providerId,
        label: found.label,
        source: 'detected',
        addedAt: new Date().toISOString(),
      };
      changed = true;
      if (!state.activeId) {
        state.activeId = id;
      }
    }
  }
  if (changed) writeState(state);
  return state;
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

// athena:cli-list -> { providers: [ { id, name, connected, accounts } ] }
function list() {
  const state = detectAndMerge();
  const byProvider = {};
  for (const p of PROVIDER_ORDER) byProvider[p] = [];
  for (const acc of Object.values(state.accounts)) {
    if (!byProvider[acc.providerId]) continue;
    byProvider[acc.providerId].push({
      id: acc.id,
      label: acc.label,
      active: acc.id === state.activeId,
    });
  }
  return {
    providers: PROVIDER_ORDER.map((id) => ({
      id,
      name: PROVIDER_NAMES[id],
      connected: byProvider[id].length > 0,
      accounts: byProvider[id],
    })),
  };
}

function probeBinaryExists(command) {
  return new Promise((resolve) => {
    let settled = false;
    let child;
    try {
      child = spawn(command, ['--version'], { stdio: 'ignore', windowsHide: true });
    } catch {
      resolve(false);
      return;
    }
    child.on('error', () => {
      if (!settled) { settled = true; resolve(false); }
    });
    child.on('exit', () => {
      if (!settled) { settled = true; resolve(true); }
    });
  });
}

// athena:cli-login { providerId } -> { ok, launched, message }
// 실제 OAuth/디바이스 로그인은 이 프로세스가 대행하지 않는다 — 각 CLI의 실제
// 서브커맨드를 사용자가 보는 새 콘솔 창에서 실행할 뿐이다. 완료 여부는 앱이
// 알 수 없으므로(로그인 완료 콜백을 이 프로세스가 가로채는 메커니즘이 스펙
// 자체에 미정으로 남아 있다 — Open Question 4), 다음 `cli-list` 호출 시
// `detectAndMerge()`가 파일 시스템을 다시 훑어 새로 로그인된 계정을 찾는다.
async function login(providerId) {
  const cfg = LOGIN_COMMANDS[providerId];
  const name = PROVIDER_NAMES[providerId];
  if (!cfg || !name) {
    return { ok: false, launched: false, message: '알 수 없는 CLI다' };
  }
  const exists = await probeBinaryExists(cfg.command);
  if (!exists) {
    return { ok: false, launched: false, message: `${name} CLI가 이 컴퓨터에 설치되어 있지 않다` };
  }
  try {
    // Windows: 새 콘솔 창을 열어 로그인 명령을 실행한다 — 이 프로세스는 그
    // 창의 표준입출력을 가로채지 않는다(OAuth 코드 붙여넣기 등은 전부 사용자가
    // 그 창에서 직접 한다).
    const child = spawn(
      'cmd.exe',
      ['/c', 'start', `"Athena · ${name} 로그인"`, 'cmd', '/k', cfg.command, ...cfg.args],
      { detached: true, stdio: 'ignore', windowsHide: false },
    );
    child.unref();
    return { ok: true, launched: true, message: cfg.message };
  } catch {
    return { ok: false, launched: false, message: '로그인 창을 열지 못했다' };
  }
}

// athena:cli-set-active { accountId } -> { ok }
function setActive(accountId) {
  const state = readState();
  if (!state.accounts[accountId]) {
    return { ok: false };
  }
  state.activeId = accountId;
  writeState(state);
  return { ok: true };
}

module.exports = { PROVIDER_ORDER, list, login, setActive, probeBinaryExists };
