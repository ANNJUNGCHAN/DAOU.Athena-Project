'use strict';

const { spawn } = require('child_process');
const { StreamJsonSession } = require('./stream-json-parser');
const mcpEnv = require('./mcp-env');
const { killTree } = require('./proc-utils');

const RENDER_CANVAS_ALLOWED_TOOL = 'mcp__athena__athena__render_canvas';
// `mcp__<서버명>` 형태는 그 서버의 모든 툴을 허용한다(Claude Code 권한 규칙 —
// MCP 툴 이름에는 와일드카드가 안 되고 서버 단위 접두만 된다).
const GATEWAY_ALLOWED_TOOLS = 'mcp__athena';

// 실왕복 실측 최대 43초(RESULT.md) + DART 다중 호출 실측 ~60초 — 3분이면
// 정상 질의는 전부 덮고, 멈춘 왕복이 UI를 영원히 잡아두는 것만 자른다.
const DEFAULT_TIMEOUT_MS = 180_000;

const MAX_STDOUT_BYTES = 5_000_000;

function buildArgs({ prompt, configFile, allowedTools, resumeSessionId, model, effort }) {
  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--mcp-config', configFile,
    '--strict-mcp-config',
    '--setting-sources', '',
    // `--tools` 표면 축소는 시도 후 **철회**됐다 (2026-08-19, W2b E2E 5회 실측 —
    // PROBE-KIWOOM-CHART-run1~5.json). 기록으로 남긴다:
    //   ""(전체 비활성)        → MCP 지연 로딩의 로더(ToolSearch)까지 끊겨 툴 0건.
    //   "ToolSearch"(로더만)   → 중간 ToolSearch 사냥·재조회 사이클로 96~104초
    //                            (기준선 72.7초보다 악화), run5는 렌더 자체 실패.
    // 기준선(무제한)의 Bash 3·Grep 1 낭비 4턴(~10초)이 깨진 지연 로딩보다 싸다 —
    // 실측이 두 번 뒤집은 끝의 결론이므로, 이 플래그를 재도입하려면 E2E 재실측을
    // 먼저 하라. 낭비 턴 억제는 프롬프트 규율(live-prompt.js 작업 규율)로만 한다.
    '--allowedTools', allowedTools,
  ];
  // 모델·추론강도(설정 화면 모델 패널, lib/main/model-prefs.js) — 값이 있을
  // 때만 붙인다. null/undefined면 인자 자체를 안 붙여 claude CLI 자체 기본값을
  // 쓴다("기본"의 의미). RESULT.md §1의 실왕복 계약(위 커맨드 블록)에는 없던
  // 추가 인자라 그 계약은 안 건드리고 뒤에 얹는다.
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
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
  model = null,
  effort = null,
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

    const args = buildArgs({ prompt, configFile, allowedTools, resumeSessionId, model, effort });
    const session = new StreamJsonSession();
    let child;
    try {
      child = spawn(claudeBin, args, {
        cwd,
        // stdin을 명시적으로 닫는다(S4 §1) — 안 닫으면 "no stdin data received
        // in 3s" 경고로 3초를 버린다.
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...mcpEnv.buildEnvOverrides() },
        windowsHide: true,
        shell: false,
      });
    } catch (err) {
      resolve({ ok: false, error: String((err && err.message) || err), diagnostics: null });
      return;
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let stderrText = '';
    let settled = false;
    let killedBy = null; // 'timeout' | 'abort' | 'stdout-cap' — close 핸들러가 에러 메시지를 고른다
    let stdoutBytes = 0; // 누적 총량 — MAX_STDOUT_BYTES 초과 시 트리를 죽인다

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
      if (killedBy) return; // 이미 죽이는 중 — 종료를 기다리는 동안 더 파싱하지 않는다
      stdoutBytes += Buffer.byteLength(chunk, 'utf8');
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        killedBy = 'stdout-cap';
        killTree(child);
        return;
      }
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
          : killedBy === 'stdout-cap'
            ? `stdout 누적 상한(${Math.round(MAX_STDOUT_BYTES / 1_000_000)}MB) 초과 — claude 프로세스 트리를 종료했다`
            : null;
      resolve({
        ok: !isError,
        exitCode: code,
        timedOut: killedBy === 'timeout',
        aborted: killedBy === 'abort',
        stdoutCapped: killedBy === 'stdout-cap',
        error: isError ? killMessage || (finalResult && finalResult.result) || `claude 종료 코드 ${code}` : null,
        finalResult,
        stderr: stderrText,
        diagnostics: session.diagnostics(),
      });
    });
  });
}

module.exports = { buildArgs, runClaudeQuery, RENDER_CANVAS_ALLOWED_TOOL, GATEWAY_ALLOWED_TOOLS, MAX_STDOUT_BYTES };
