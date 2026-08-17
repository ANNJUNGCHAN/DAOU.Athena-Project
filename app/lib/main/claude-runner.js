// `claude -p`를 spawn해 stream-json을 실시간으로 파싱한다 — 결정 D1의 실배선.
//
//   Electron ──spawn──> claude -p ──stdio──> athena-mcp serve ──> upstream N개
//      ^                    │
//      └── stream-json ─────┘   tool_result에서 캔버스 페이로드를 뽑아 IPC로 렌더
//
// 커맨드 계약은 spike/cli-pipe/gateway/RESULT.md §1 실왕복으로 고정됐다 —
// 여기서 다시 조사하지 않는다:
//   claude -p "<prompt>" --output-format stream-json --verbose
//     --mcp-config <configFile> --strict-mcp-config
//     --setting-sources ""
//     --allowedTools "mcp__athena__athena__render_canvas"
//   cwd = .mcp.json이 있는 디렉토리.
//
// 지켜야 할 것 (RESULT.md에서 실측으로 확정):
//   - --setting-sources는 반드시 빈 문자열. 값을 하나라도 주면 유저 스코프
//     훅·MCP·플러그인이 전부 로드된다(S3).
//   - --allowedTools 없이는 툴 실행이 자동 거부된다(S3).
//   - stdin을 명시적으로 닫는다 — 안 그러면 "no stdin data received in 3s"
//     경고와 함께 3초를 버린다(S4 §1).
//
// 2026-08-17 개정 — --allowedTools 기본값은 툴 1개가 아니라 서버 전체다.
// 위 계약의 예시(`mcp__athena__athena__render_canvas`)를 기본값으로 쓰면
// 게이트웨이가 재노출한 업스트림 툴(예: mcp__athena__dart-mcp__search_disclosure)이
// 전부 권한에서 거부된다 — 헤드리스라 승인 프롬프트가 뜰 수 없어 실사용에서
// "권한 승인이 되지 않았습니다"로 죽는 것이 실측됐다(dart-mcp, 2026-08-17).
// 툴 단위 게이트는 게이트웨이의 consent allowlist(~/.athena/consent.json,
// probe 시트의 "선택 허용")가 담당한다 — CLI에서 이중 게이트를 만들지 않는다.
'use strict';

const { spawn } = require('child_process');
const { StreamJsonSession } = require('./stream-json-parser');
const mcpEnv = require('./mcp-env');

const RENDER_CANVAS_ALLOWED_TOOL = 'mcp__athena__athena__render_canvas';
// `mcp__<서버명>` 형태는 그 서버의 모든 툴을 허용한다(Claude Code 권한 규칙 —
// MCP 툴 이름에는 와일드카드가 안 되고 서버 단위 접두만 된다).
const GATEWAY_ALLOWED_TOOLS = 'mcp__athena';

// 실왕복 실측 최대 43초(RESULT.md) + DART 다중 호출 실측 ~60초 — 3분이면
// 정상 질의는 전부 덮고, 멈춘 왕복이 UI를 영원히 잡아두는 것만 자른다.
const DEFAULT_TIMEOUT_MS = 180_000;

// claude.exe만 죽이면 그 자식(athena-mcp serve → upstream N개)이 고아로 남을 수
// 있다 — Windows는 taskkill /T로 프로세스 트리를 통째로 끊는다.
function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch { /* 이미 죽어 있으면 그만 */ }
  } else {
    try { child.kill('SIGTERM'); } catch { /* 동일 */ }
  }
}

function buildArgs({ prompt, configFile, allowedTools, resumeSessionId }) {
  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--mcp-config', configFile,
    '--strict-mcp-config',
    '--setting-sources', '',
    '--allowedTools', allowedTools,
  ];
  // 멀티턴 — 직전 왕복의 result 이벤트가 준 session_id로 대화를 잇는다.
  // -p 재개는 세션을 포크해 **새 session_id**를 발급한다 — 호출자는 매 왕복의
  // finalResult.session_id로 갱신해야 체인이 이어진다(main.js runLiveQuery).
  if (resumeSessionId) args.push('--resume', String(resumeSessionId));
  return args;
}

// prompt/cwd/configFile은 호출자가 채운다(mcp-config.ensureMcpConfig()의 결과).
// onCanvasResult(result) — render_canvas의 tool_result가 확정될 때마다(스트리밍 중).
// onEvent(event) — 모든 파싱된 이벤트마다(진행 표시용, 선택).
// onSpawn({pid, kill}) — 프로세스가 뜨자마자. kill()은 트리 전체를 끊는다(Esc 중단용).
// timeoutMs — 왕복 상한. 넘기면 트리를 죽이고 ok:false·timedOut:true로 끝낸다. 0이면 무제한.
// claudeBin — 테스트/오버라이드용. 기본은 PATH의 `claude`.
function runClaudeQuery({
  prompt,
  cwd,
  configFile = '.mcp.json',
  allowedTools = GATEWAY_ALLOWED_TOOLS,
  resumeSessionId = null,
  claudeBin = process.env.ATHENA_CLAUDE_BIN || 'claude',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onSpawn,
  onCanvasResult,
  onEvent,
} = {}) {
  return new Promise((resolve) => {
    if (!prompt || !String(prompt).trim()) {
      resolve({ ok: false, error: '질의가 비어 있다', diagnostics: null });
      return;
    }
    if (!cwd) {
      resolve({ ok: false, error: 'cwd(.mcp.json 위치)가 없다', diagnostics: null });
      return;
    }

    const args = buildArgs({ prompt, configFile, allowedTools, resumeSessionId });
    const session = new StreamJsonSession();
    let child;
    try {
      child = spawn(claudeBin, args, {
        cwd,
        // stdin을 명시적으로 닫는다(S4 §1) — 안 닫으면 "no stdin data received
        // in 3s" 경고로 3초를 버린다.
        stdio: ['ignore', 'pipe', 'pipe'],
        // SECURITY.md §6 — 게이트웨이(athena-mcp serve)가 upstream MCP 서버를
        // spawn할 때 쓸 복호화된 env를 여기서 claude 프로세스 환경에 얹는다.
        // 환경변수는 자식으로 상속되므로 claude -p -> athena-mcp serve까지
        // 별도 배선 없이 전달된다 — env를 명시하지 않으면 spawn()은 어차피
        // process.env를 상속하므로, 여기서도 그 기반 위에 override만 덧붙인다.
        env: { ...process.env, ...mcpEnv.buildEnvOverrides() },
        windowsHide: true,
        // ★ `shell: true`를 쓰면 안 된다 — 실측으로 확정됐다(2026-08-17).
        //
        // 이 파일의 이전 판은 "Windows에서 claude는 .cmd 셸 래퍼다"라는 **추측**으로
        // `shell: process.platform === 'win32'`를 걸었고, 그게 실배선을 통째로
        // 깨뜨렸다. Windows에서 `shell:true`는 args를 커맨드라인 문자열로 합치는데
        // **빈 문자열 인자가 그 과정에서 사라진다.** 그래서 `--setting-sources`가
        // 자기 값이 아니라 **다음 인자(`--allowedTools`)를 값으로 먹었다**:
        //
        //   Error processing --setting-sources: Invalid setting source: --allowedTools.
        //   Valid options are: user, project, local
        //
        // (`spike/cli-pipe/gateway/PROBE-LIVE-SPAWN.json` — exit 1, 캔버스 0건, 319ms)
        //
        // 대조 실측: 같은 args를 `shell:false`로 넘기면 빈 문자열이 argv에 그대로
        // 살아남는다. bash에서 손으로 돌렸을 때 통과했던 이유도 같다 — bash는
        // `""`를 진짜 빈 argv 원소로 넘긴다(S4 실왕복).
        //
        // 그리고 추측 자체가 틀렸다: 이 머신의 `where claude`는
        // `C:\Users\ajc22\.local\bin\claude.exe` — **진짜 .exe다.** `.exe`는
        // CreateProcess가 PATH에서 찾으므로 셸이 필요 없다.
        shell: false,
      });
    } catch (err) {
      resolve({ ok: false, error: String((err && err.message) || err), diagnostics: null });
      return;
    }

    child.stdout.setEncoding('utf8'); // UTF-8 고정 — 이 콘솔 자체가 cp949인 것과 무관(CLAUDE.md §8)
    child.stderr.setEncoding('utf8');
    let stderrText = '';
    let settled = false;
    let killedBy = null; // 'timeout' | 'abort' — close 핸들러가 에러 메시지를 고른다

    if (typeof onSpawn === 'function') {
      onSpawn({
        pid: child.pid,
        kill: () => { killedBy = killedBy || 'abort'; killTree(child); },
      });
    }
    const timer = timeoutMs > 0
      ? setTimeout(() => { killedBy = killedBy || 'timeout'; killTree(child); }, timeoutMs)
      : null;

    child.stdout.on('data', (chunk) => {
      session.feed(chunk, { onCanvasResult, onEvent });
    });
    child.stderr.on('data', (c) => {
      stderrText += c;
      // 실측: "no stdin data received in 3s..."는 무해한 경고다(stdin을 닫아도
      // 일부 버전은 여전히 찍을 수 있다) — 별도 취급 없이 stderr 원문에 남긴다.
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // `shell:false`는 PATH에서 실행 파일(.exe)을 찾는다. `claude`가 이 머신에
      // `.cmd`/`.ps1` 래퍼로 깔려 있으면 여기서 ENOENT가 난다. `shell:true`로
      // 되돌리면 안 된다 — 빈 문자열 인자가 사라져 `--setting-sources`가
      // 깨진다(위 spawn 주석). 실행 파일을 직접 가리키게 안내한다.
      const code = err && err.code;
      const message =
        code === 'ENOENT'
          ? `'${claudeBin}' 실행 파일을 PATH에서 못 찾았다. ` +
            'ATHENA_CLAUDE_BIN 환경변수로 실행 파일 절대경로를 지정하라 ' +
            "(Windows: `where claude`, 그 외: `which claude`)."
          : String((err && err.message) || err);
      resolve({
        ok: false,
        error: message,
        errorCode: code || null,
        stderr: stderrText,
        diagnostics: session.diagnostics(),
      });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      session.end({ onCanvasResult, onEvent });
      const finalResult = session.finalResult();
      const isError = !!killedBy || code !== 0 || (finalResult && finalResult.is_error === true) || !finalResult;
      const killMessage = killedBy === 'timeout'
        ? `왕복 타임아웃(${Math.round(timeoutMs / 1000)}s) — claude 프로세스 트리를 종료했다`
        : killedBy === 'abort'
          ? '사용자 중단 — claude 프로세스 트리를 종료했다'
          : null;
      resolve({
        ok: !isError,
        exitCode: code,
        timedOut: killedBy === 'timeout',
        aborted: killedBy === 'abort',
        error: isError ? killMessage || (finalResult && finalResult.result) || `claude 종료 코드 ${code}` : null,
        finalResult,
        stderr: stderrText,
        diagnostics: session.diagnostics(),
      });
    });
  });
}

module.exports = { buildArgs, runClaudeQuery, RENDER_CANVAS_ALLOWED_TOOL, GATEWAY_ALLOWED_TOOLS };
