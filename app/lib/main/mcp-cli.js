// `athena-mcp` 파이썬 CLI(backend/athena_mcp/__main__.py)를 감싸는 래퍼.
// 오케스트레이터 지시 그대로: 스니펫 파싱·별칭 정규화·위험 스캔·동의 게이트는
// 절대 여기서 다시 구현하지 않는다 — 전부 `child_process.spawn`으로 실제
// 파이썬 프로세스를 불러 하게 시킨다. 이 파일이 하는 일은 (1) 그 프로세스를
// 정확한 인자로 spawn하고, (2) 그 결과(및 CLI가 이미 디스크에 영속시킨
// registry.json/consent.json)를 IPC 계약이 요구하는 모양으로 바꾸는 것뿐이다.
//
// --json이 있는 서브커맨드(probe)만 그 옵션을 쓴다. list/register/show/
// approve/allow/remove는 --json이 없다(`athena-mcp --help` 및 각 서브파서
// 실측 확인) — 이 서브커맨드들의 결과는 그 CLI 호출이 실제로 영속시킨
// registry.json/consent.json을 직접 읽어 조립한다. **stdout 사람용 텍스트를
// 정규식으로 긁지 않는다** — 그건 오케스트레이터가 명시적으로 금지한
// "fragile scraping"이다. 유일한 예외는 실패 시 에러 메시지 한 줄을 사람에게
// 보여주기 위해 stderr/stdout의 첫 줄을 그대로 옮기는 것(파싱 아님, 표시일 뿐).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const BACKEND_DIR = path.join(__dirname, '..', '..', '..', 'backend');
const PYTHON_EXE = path.join(BACKEND_DIR, '.venv', 'Scripts', 'python.exe');

function registryPath() {
  return process.env.ATHENA_MCP_REGISTRY_PATH || path.join(os.homedir(), '.athena', 'mcp_servers.json');
}

function stateDir() {
  return path.dirname(registryPath());
}

function consentPath() {
  return path.join(stateDir(), 'consent.json');
}

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return fallback;
  }
}

function readRegistry() {
  return readJson(registryPath(), { servers: {} });
}

function readConsent() {
  return readJson(consentPath(), {});
}

function runCli(args, opts = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(PYTHON_EXE, ['-m', 'athena_mcp', ...args], {
        cwd: BACKEND_DIR,
        // opts.env — mcp-env.js의 buildEnvOverrides() 결과(있으면). upstream
        // 서버를 실제로 spawn하는 서브커맨드(probe)만 이걸 채워 보낸다 —
        // 안 쓰는 서브커맨드(list/register/approve/allow/remove)까지 복호화된
        // 비밀값을 자식 프로세스 환경에 실어 보낼 이유가 없다.
        env: { ...process.env, PYTHONPATH: BACKEND_DIR, ...(opts.env || {}) },
        windowsHide: true,
      });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String((err && err.message) || err) });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString('utf-8'); });
    child.stderr.on('data', (c) => { stderr += c.toString('utf-8'); });
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: String((err && err.message) || err) }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (opts.input != null) {
      child.stdin.write(opts.input, 'utf-8');
    }
    child.stdin.end();
  });
}

// 실패 이유 한 줄. 사람이 낸 오류는 파이썬 CLI가 이미 한 줄로 끝내므로
// (`__main__.py` USER_FACING_ERRORS) 그 줄이 그대로 온다. 예상 못한 크래시로
// 트레이스백이 오면 첫 줄은 항상 "Traceback (most recent call last):"이라
// 화면에 이유가 아니라 그 문자열이 뜬다 — 그때는 예외가 찍힌 **마지막** 줄을
// 쓰고 모듈 경로 접두사를 떼어 사람이 읽을 수 있게 만든다.
function firstErrorLine(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return '알 수 없는 오류';
  const tracebackAt = lines.findIndex((l) => l.startsWith('Traceback (most recent call last)'));
  if (tracebackAt < 0) return lines[0];
  // 트레이스백 앞에 CLI가 찍은 사람용 줄이 있으면 그게 더 정확하다.
  if (tracebackAt > 0) return lines[0];
  const last = lines[lines.length - 1];
  const named = last.match(/^(?:[A-Za-z_][\w.]*\.)?([A-Za-z_]\w*(?:Error|Exception)):\s*(.*)$/);
  if (!named) return last;
  const detail = named[2].replace(/^'(.*)'$/, '$1').trim();
  return detail ? `${named[1]}: ${detail}` : named[1];
}

// ---------------------------------------------------------------------------
// athena:mcp-list — registry.json + consent.json을 직접 읽어 조립한다(`list`
// 서브커맨드는 --json이 없다).
// ---------------------------------------------------------------------------

function list() {
  const registry = readRegistry();
  const consent = readConsent();
  const servers = Object.values(registry.servers || {}).map((entry) => {
    const record = consent[entry.alias];
    const approved = !!(record && record.approved);
    const toolCount = record && Array.isArray(record.approved_tools) ? record.approved_tools.length : 0;
    // health: registry.py/consent.py에 서버 상태를 나타내는 필드가 따로
    // 없다 — probe로 관측된 것(self_reported_server_info 존재 여부, 인코딩
    // 스모크 테스트 결과)만으로 정직하게 유도한다. probe를 한 번도 안 했으면
    // 'unknown'이다(임의로 'ok'를 붙이지 않는다).
    let health = 'unknown';
    if (entry.self_reported_server_info) {
      health = entry.encoding_smoke_test_warning ? 'warning' : 'ok';
    }
    const warnings = [];
    if (record && Array.isArray(record.risk_warnings)) warnings.push(...record.risk_warnings);
    if (entry.encoding_smoke_test_warning) {
      warnings.push('인코딩 손상 경고 — 툴 이름/설명에서 U+FFFD가 감지됐다');
    }
    return {
      alias: entry.alias,
      command: entry.command,
      argsPreview: Array.isArray(entry.args) ? entry.args.join(' ') : '',
      approved,
      toolCount,
      health,
      warnings,
    };
  });
  // revision — registry.py가 쓰기마다 1씩 올려 mcp_servers.json에 남기는 값이다
  // (registry.py `_payload`). 승인 직전 "그 사이 목록이 바뀌었는가"를 재는 유일한
  // 권위 값이라 목록과 같은 읽기에서 함께 돌려준다(두 번 읽으면 그 사이가 벌어진다).
  const revision = Number.isSafeInteger(registry.revision) ? registry.revision : 0;
  return { servers, revision };
}

// ---------------------------------------------------------------------------
// athena:mcp-stage-snippet — 실제로 `register --snippet-file`을 호출한다.
//
// **왜 "스테이징"인데 진짜로 등록하는가**: `athena_mcp.onboarding.stage_from_snippet()`은
// registry.add() + consent.request_consent()까지 즉시 수행한다 — Python
// 백엔드에는 "미리보기만 하고 커밋 안 함" 모드가 없다(dry-run 플래그 없음).
// 그래도 안전한 이유는 이 시점에 `approve()`가 아직 호출되지 않았다는 것 —
// consent.py의 게이트가 서버 spawn을 막는다(승인 전 프로세스 없음). 그러므로
// "스테이징 = 등록 + 승인요청, 아직 미승인"이 이 백엔드가 제공하는 가장 가까운
// 프리뷰 개념이고, 이 함수는 그걸 그대로 노출한다. `mcp-register`는 그 뒤
// 이미 커밋된 데이터를 재확인하는 역할만 한다(아래 참고).
// ---------------------------------------------------------------------------

async function stageSnippet(rawSnippet) {
  const raw = String(rawSnippet || '');
  if (!raw.trim()) {
    return { ok: false, error: '스니펫이 비어 있다' };
  }

  const before = readRegistry();
  const beforeAliases = new Set(Object.keys(before.servers || {}));

  // 원본 서버 이름(별칭 정규화 전) 후보만 화면 표시용으로 뽑는다 — 별칭을
  // 어떻게 유도할지(derive_alias/sanitize_alias)는 절대 여기서 다시 계산하지
  // 않는다. 파싱에 실패해도 계속 진행한다 — 실제 에러는 Python이 낸다.
  let originalNames = null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.mcpServers && typeof parsed.mcpServers === 'object') {
      originalNames = Object.keys(parsed.mcpServers);
    }
  } catch {
    originalNames = null;
  }

  const result = await runCli(['register', '--snippet-file', '-'], { input: raw });
  if (result.code !== 0) {
    return { ok: false, error: firstErrorLine(result.stderr || result.stdout) };
  }

  const after = readRegistry();
  const afterConsent = readConsent();
  const newAliases = Object.keys(after.servers || {}).filter((a) => !beforeAliases.has(a));

  const staged = newAliases.map((alias, i) => {
    const entry = after.servers[alias];
    const record = afterConsent[alias];
    return {
      alias,
      originalName: (originalNames && originalNames[i]) || alias,
      command: entry.command,
      args: Array.isArray(entry.args) ? entry.args : [],
      envKeys: entry.env ? Object.keys(entry.env) : [], // 키 이름만 — 값은 여기 한 번도 안 담긴다
      risks: record && Array.isArray(record.risk_warnings) ? record.risk_warnings : [],
    };
  });

  if (!staged.length) {
    return { ok: false, error: '등록된 서버가 없다 — 스니펫 형식을 확인한다' };
  }
  return { ok: true, staged };
}

// athena:mcp-register — staged는 stageSnippet()이 돌려준 단일 항목 그대로
// (렌더러가 "한 번에 하나씩" 심사·전달한다). 실제 등록은 이미 stageSnippet에서
// 끝났으므로, 여기서는 그 결과가 여전히 레지스트리에 있는지 재확인만 한다.
function register(staged) {
  if (!staged || !staged.alias) {
    return { ok: false, error: '등록 정보가 없다' };
  }
  const registry = readRegistry();
  const entry = (registry.servers || {})[staged.alias];
  if (!entry) {
    return { ok: false, error: '이 서버는 아직 등록돼 있지 않다 — 스니펫을 다시 분석한다' };
  }
  return { ok: true, alias: staged.alias };
}

async function approve(alias) {
  const result = await runCli(['approve', alias]);
  if (result.code !== 0) {
    return { ok: false, error: firstErrorLine(result.stderr || result.stdout) };
  }
  return { ok: true };
}

// athena:mcp-probe — `probe --json`은 실제 --json 플래그가 있는 유일한
// 서브커맨드다. cmd_probe는 사람용 텍스트를 먼저 찍고 그 뒤에 JSON 블록을
// 찍는다 — 그 블록만 파싱한다(첫 '{' 부터).
//
// `extraEnv` — mcp-env.js의 `buildEnvOverrides(alias)`. probe는 실제로 upstream
// 서버를 spawn하므로(client.py의 UpstreamServerHandle.start()), 레지스트리에
// 센티널이 남아있으면 이 env가 없이는 그 서버만 명확히 실패한다(fail-closed,
// registry.py의 resolve_secret_env() 참고). 호출자(main.js)가 채워 넘긴다 —
// 이 파일은 mcp-env.js를 직접 require하지 않는다(순환 회피, mcp-env.js
// 모듈 설명 참고).
async function probe(alias, extraEnv = {}) {
  const result = await runCli(['probe', alias, '--json'], { env: extraEnv });
  let report = null;
  const jsonStart = result.stdout.indexOf('{');
  if (jsonStart >= 0) {
    try {
      report = JSON.parse(result.stdout.slice(jsonStart));
    } catch {
      report = null;
    }
  }
  if (!report) {
    return { ok: false, error: firstErrorLine(result.stderr || result.stdout) };
  }
  if (!report.ok) {
    return { ok: false, error: report.error || 'probe에 실패했다' };
  }
  const consent = readConsent();
  const record = consent[alias];
  const allowedSet = new Set(record && Array.isArray(record.approved_tools) ? record.approved_tools : []);
  const tools = (report.tools || []).map((t) => ({
    name: t.name,
    description: t.description,
    allowed: allowedSet.has(t.name),
  }));
  return {
    ok: true,
    protocolVersion: report.protocol_version,
    encodingCorrupt: !!report.mojibake_in_tool_metadata,
    tools,
  };
}

// athena:mcp-allow-tool — allow/disallow 둘 다 실제 파이썬 CLI 서브커맨드를
// spawn한다. consent.json을 이 파일에서 직접 mutate하던 이전 경로(disallow_tool()과
// "같은 연산"을 JS로 재구현)는 보안 경계 위반이었다 — consent.py가 유일한
// 게이트여야 하는데, 두 번째 언어로 된 두 번째 writer가 파일 포맷이 바뀌는
// 순간 조용히 깨진다. `disallow` 서브커맨드가 이제 백엔드에 있으니
// (`backend/athena_mcp/__main__.py` cmd_disallow) 그걸 부른다.
async function allowTool(alias, tool, allowed) {
  const result = await runCli([allowed ? 'allow' : 'disallow', alias, tool]);
  if (result.code !== 0) {
    return { ok: false, error: firstErrorLine(result.stderr || result.stdout) };
  }
  return { ok: true };
}

// athena:mcp-revoke — approve의 역연산. consent.revoke()가 approved=false로
// 되돌리고 approved_tools까지 비운다(consent.py). 관리 화면의 끄기가 이걸 부른다:
// 서버를 지우지 않고 대화에서만 빼는 유일한 방법이다.
async function revoke(alias) {
  const result = await runCli(['revoke', alias]);
  if (result.code !== 0) {
    return { ok: false, error: firstErrorLine(result.stderr || result.stdout) };
  }
  return { ok: true };
}

async function remove(alias) {
  const result = await runCli(['remove', alias]);
  return { ok: result.code === 0 };
}

module.exports = {
  list,
  stageSnippet,
  register,
  approve,
  revoke,
  probe,
  allowTool,
  remove,
};
