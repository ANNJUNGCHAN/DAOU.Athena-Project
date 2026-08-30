'use strict';

// 상주 채팅 세션(2026-08-30 속도 작업) — 매 턴 `claude -p`를 콜드 스폰하던
// 메인 대화 경로(claude-runner.js runClaudeQuery)의 턴당 고정비를 세션당 1회로
// 바꾼다. 고정비의 실체: (1) CLI Node 기동, (2) .mcp.json의 athena 게이트웨이
// (python -m athena_mcp serve) 재스폰 + upstream 재연결 + MCP 핸드셰이크,
// (3) --resume 세션 포크, (4) 규칙 프리앰블(~4KB) 매 턴 재전송. 대화형 CLI
// (Claude Code 인터랙티브)가 빠른 이유가 정확히 이 비용을 세션당 1회만 내는
// 것이라, 같은 조건을 만든다.
//
// 패턴은 claude-selector-worker-pool.js가 이미 프로덕션에서 검증했다 —
// `-p --input-format stream-json`으로 stdin을 열어두고 user 메시지 JSONL을
// 이어보내면 한 프로세스가 멀티턴을 처리한다(그 풀은 32턴까지 재사용).
// 차이: 여기는 프로세스 1개, MCP 게이트웨이 연결(--mcp-config), 세션 영속
// (--resume 복구용), --include-partial-messages(텍스트 델타), 그리고
// runClaudeQuery와 동일한 결과 형상이 필요하다.
//
// 대화 문맥은 프로세스가 들고 있다 — 살아있는 동안 --resume이 필요 없다.
// 프로세스가 죽으면(중단·타임아웃·크래시) 마지막으로 관측한 session_id로
// --resume 재예열해 문맥을 복구한다. 결과 형상·중단 의미론(선점 kill,
// aborted/timedOut 딱지)은 runClaudeQuery와 동일하게 유지해 main.js의
// 세션 체인·재시도 로직이 그대로 동작한다.

const { spawn } = require('child_process');
const { StreamJsonSession } = require('./stream-json-parser');
const mcpEnv = require('./mcp-env');
const { killTree } = require('./proc-utils');
const {
  GATEWAY_ALLOWED_TOOLS,
  DISALLOWED_EXECUTION_TOOLS,
  DISABLE_TOOL_SEARCH_ENV,
  MAX_STDOUT_BYTES,
} = require('./claude-runner');

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_QUIET_BOUNDARY_MS = 25;
const DEFAULT_RESPAWN_BASE_DELAY_MS = 1_000;
const DEFAULT_RESPAWN_MAX_DELAY_MS = 30_000;
// 이 시간 안에 죽은 프로세스는 "기동 자체가 실패"로 보고 백오프를 키운다 —
// selector 풀의 EARLY_FAILURE_WINDOW_MS와 같은 논리.
const EARLY_FAILURE_WINDOW_MS = 10_000;

function buildChatSessionArgs({
  configFile,
  allowedTools = GATEWAY_ALLOWED_TOOLS,
  appendSystemPrompt = null,
  model = null,
  effort = null,
  resumeSessionId = null,
} = {}) {
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    // 답변 텍스트를 조각(text_delta)으로 받는다 — claude-runner.js와 같은 이유.
    '--include-partial-messages',
    '--verbose',
    '--mcp-config', configFile,
    '--strict-mcp-config',
    '--setting-sources', '',
    '--allowedTools', allowedTools,
    // 보안 차단(#33) — claude-runner.js DISALLOWED_EXECUTION_TOOLS 주석 참고.
    '--disallowedTools', DISALLOWED_EXECUTION_TOOLS,
  ];
  // 불변 규칙(live-prompt.js buildLiveSystemPrompt)은 세션당 1회 — 턴 페이로드가
  // 질문만으로 가벼워지고, 이력에 규칙 사본이 턴 수만큼 쌓이지 않는다.
  if (appendSystemPrompt) args.push('--append-system-prompt', appendSystemPrompt);
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  if (resumeSessionId) args.push('--resume', String(resumeSessionId));
  return args;
}

// selector 풀의 userMessage()와 같은 계약 — content는 문자열이어도 된다.
function userMessage(text) {
  return `${JSON.stringify({
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
  })}\n`;
}

function errorText(reason, fallback) {
  if (reason && reason.message) return String(reason.message);
  if (reason != null && String(reason)) return String(reason);
  return fallback;
}

class ClaudeChatSession {
  constructor({
    cwd,
    configFile = '.mcp.json',
    allowedTools = GATEWAY_ALLOWED_TOOLS,
    appendSystemPrompt = null,
    claudeBin = process.env.ATHENA_CLAUDE_BIN || 'claude',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    quietBoundaryMs = DEFAULT_QUIET_BOUNDARY_MS,
    maxStdoutBytes = MAX_STDOUT_BYTES,
    spawnFn = spawn,
    killFn = killTree,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    nowFn = Date.now,
    env = process.env,
    // Electron 밖(벤치마크·테스트)에서 safeStorage 의존을 끊는 주입점 —
    // 스폰 시점마다 평가한다(등록된 upstream 비밀값이 세션 중 바뀔 수 있다).
    envOverridesFn = () => mcpEnv.buildEnvOverrides(),
    respawnBaseDelayMs = DEFAULT_RESPAWN_BASE_DELAY_MS,
    respawnMaxDelayMs = DEFAULT_RESPAWN_MAX_DELAY_MS,
    earlyFailureWindowMs = EARLY_FAILURE_WINDOW_MS,
  } = {}) {
    if (!cwd) throw new TypeError('cwd(.mcp.json 위치)가 필요하다');
    this._cwd = cwd;
    this._configFile = configFile;
    this._allowedTools = allowedTools;
    this._appendSystemPrompt = appendSystemPrompt;
    this._claudeBin = claudeBin;
    this._timeoutMs = timeoutMs;
    this._quietBoundaryMs = Math.max(0, quietBoundaryMs);
    this._maxStdoutBytes = maxStdoutBytes;
    this._spawn = spawnFn;
    this._kill = killFn;
    this._setTimeout = setTimeoutFn;
    this._clearTimeout = clearTimeoutFn;
    this._now = nowFn;
    this._env = env;
    this._envOverridesFn = envOverridesFn;
    this._respawnBaseDelayMs = Math.max(0, respawnBaseDelayMs);
    this._respawnMaxDelayMs = Math.max(this._respawnBaseDelayMs, respawnMaxDelayMs);
    this._earlyFailureWindowMs = Math.max(0, earlyFailureWindowMs);
    this._proc = null;
    this._stopped = false;
    this._lastSessionId = null;
    this._lastConfig = { model: null, effort: null };
    this._respawnTimer = null;
    this._failureStreak = 0;
  }

  lastSessionId() {
    return this._lastSessionId;
  }

  snapshot() {
    const proc = this._proc;
    return {
      running: !!proc && !proc.removed,
      state: proc && !proc.removed ? proc.state : 'down',
      pid: proc && !proc.removed ? proc.child.pid : null,
      warm: !!proc && !proc.removed && proc.initSeen,
      config: { ...this._lastConfig },
      lastSessionId: this._lastSessionId,
      stopped: this._stopped,
    };
  }

  // 예열 — 앱 기동 시(첫 질문 전에 CLI + MCP 게이트웨이를 미리 띄운다)와 설정
  // 변경 시(백그라운드 재예열) 호출한다. 턴이 진행 중이면 건드리지 않는다 —
  // 설정 변경분은 다음 run()이 config 불일치로 재활용한다.
  warm({ model = null, effort = null, resumeSessionId = null } = {}) {
    if (this._stopped) return this.snapshot();
    const config = { model: model || null, effort: effort || null };
    const proc = this._proc;
    if (proc && !proc.removed) {
      if (proc.config.model === config.model && proc.config.effort === config.effort) {
        return this.snapshot();
      }
      if (proc.state !== 'idle') return this.snapshot();
      this._removeProcess(proc);
    }
    this._spawnProcess({ config, resumeSessionId: resumeSessionId || this._lastSessionId });
    return this.snapshot();
  }

  stop(reason = null) {
    this._stopped = true;
    if (this._respawnTimer !== null) {
      this._clearTimeout(this._respawnTimer);
      this._respawnTimer = null;
    }
    const proc = this._proc;
    if (proc && !proc.removed) {
      this._settleTurn(proc, this._abortedResult(proc, reason));
      this._removeProcess(proc);
    }
    return this.snapshot();
  }

  // 턴 하나 — 결과 형상·콜백·중단 의미론은 runClaudeQuery와 동일. 추가 필드:
  // firstEventMs(제출→첫 스트림 이벤트), spawnedFresh(이 턴이 프로세스를 새로
  // 띄웠는가 — 텔레메트리용).
  run({
    prompt,
    model = null,
    effort = null,
    resumeSessionId = null,
    timeoutMs = this._timeoutMs,
    signal,
    onSpawn,
    onEvent,
    onTextDelta,
    onThinkingDelta,
    onCanvasResult,
  } = {}) {
    if (!prompt || !String(prompt).trim()) {
      return Promise.resolve({ ok: false, error: '질의가 비어 있다', diagnostics: null });
    }
    if (this._stopped) {
      return Promise.resolve(this._abortedResult(null, '채팅 세션이 종료됐다'));
    }
    if (signal && signal.aborted) {
      return Promise.resolve(this._abortedResult(null, signal.reason));
    }

    const config = { model: model || null, effort: effort || null };
    this._lastConfig = config;

    let proc = this._proc;
    // quiet(result 후 잔여 조각 대기 25ms) 중 연속 질의 — 이미 끝난 턴이니
    // 경계를 즉시 닫고 웜 프로세스를 그대로 쓴다(죽이면 안 된다).
    if (proc && !proc.removed && proc.state === 'quiet' && proc.turn && proc.turn.settled) {
      if (proc.turn.quietTimer !== null) this._clearTimeout(proc.turn.quietTimer);
      this._finishQuietBoundary(proc, proc.turn);
    }
    // 선점 — main.js는 새 질의 전에 activeLiveQuery.kill()을 부르지만, 그 사이
    // 레이스까지 여기서 흡수한다: 진행 중 턴은 aborted로 끝내고 프로세스를
    // 갈아치운다(콜드 스폰 시절의 "새 질의가 항상 선점한다"와 같은 의미론).
    if (proc && !proc.removed && proc.state !== 'idle') {
      this._settleTurn(proc, this._abortedResult(proc, '새 질의가 이전 질의를 대체했다'));
      this._removeProcess(proc);
      proc = null;
    }

    // 설정 변경 — 대화 문맥은 --resume으로 잇고 플래그만 새로 단다.
    if (proc && !proc.removed
      && (proc.config.model !== config.model || proc.config.effort !== config.effort)) {
      this._removeProcess(proc);
      proc = null;
    }

    let spawnedFresh = false;
    if (!proc || proc.removed) {
      // 스폰 시점의 재개 커서 — main.js가 판단한 liveSessionId(명시적 null이면
      // 새 대화 시작)를 그대로 따른다. 내부 커서는 백그라운드 재예열 전용이다.
      proc = this._spawnProcess({ config, resumeSessionId });
      spawnedFresh = true;
      if (!proc) {
        return Promise.resolve({
          ok: false,
          error: this._lastSpawnError || 'claude 상주 세션 스폰에 실패했다',
          errorCode: this._lastSpawnErrorCode || null,
          stderr: '',
          diagnostics: null,
        });
      }
    }

    const activeProc = proc;
    return new Promise((resolve) => {
      const turn = {
        session: new StreamJsonSession(),
        stderr: '',
        stdoutBytes: 0,
        timer: null,
        quietTimer: null,
        onAbort: null,
        resolve,
        settled: false,
        resultSeen: false,
        killedBy: null, // 'timeout' | 'abort' | 'stdout-cap'
        timeoutMs,
        submittedAt: this._now(),
        firstEventMs: null,
        spawnedFresh,
        signal,
        callbacks: { onEvent, onTextDelta, onThinkingDelta, onCanvasResult },
      };
      activeProc.turn = turn;
      activeProc.state = 'busy';

      // kill/abort를 이 턴에 스코프한다 — 턴이 끝난 뒤 도착한 늦은 kill이
      // 다음 턴이나 웜 프로세스를 오폭하지 않는다.
      const abortThisTurn = (reason) => {
        if (activeProc.turn === turn && !turn.settled) this._abortTurn(activeProc, reason);
      };
      if (signal) {
        turn.onAbort = () => abortThisTurn(signal.reason);
        signal.addEventListener('abort', turn.onAbort, { once: true });
      }
      if (typeof onSpawn === 'function') {
        onSpawn({
          pid: activeProc.child.pid,
          kill: () => abortThisTurn(null),
        });
      }
      if (timeoutMs > 0) {
        turn.timer = this._setTimeout(() => {
          turn.killedBy = 'timeout';
          this._settleTurn(activeProc, {
            ok: false,
            exitCode: null,
            timedOut: true,
            aborted: false,
            stdoutCapped: false,
            error: `왕복 타임아웃(${Math.round(timeoutMs / 1000)}s) — claude 상주 세션을 교체했다`,
            finalResult: turn.session.finalResult(),
            stderr: turn.stderr,
            diagnostics: turn.session.diagnostics(),
            firstEventMs: turn.firstEventMs,
            spawnedFresh: turn.spawnedFresh,
          });
          this._removeProcess(activeProc);
          this._scheduleRespawn();
        }, timeoutMs);
      }

      try {
        activeProc.child.stdin.write(userMessage(String(prompt)));
      } catch (error) {
        this._settleTurn(activeProc, this._transportResult(activeProc, null, error));
        this._removeProcess(activeProc);
        this._scheduleRespawn();
      }
    });
  }

  // -- 내부 ------------------------------------------------------------------

  _spawnProcess({ config, resumeSessionId = null }) {
    if (this._respawnTimer !== null) {
      this._clearTimeout(this._respawnTimer);
      this._respawnTimer = null;
    }
    this._lastSpawnError = null;
    this._lastSpawnErrorCode = null;
    const args = buildChatSessionArgs({
      configFile: this._configFile,
      allowedTools: this._allowedTools,
      appendSystemPrompt: this._appendSystemPrompt,
      model: config.model,
      effort: config.effort,
      resumeSessionId,
    });
    let child;
    try {
      child = this._spawn(this._claudeBin, args, {
        cwd: this._cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...this._env, ...this._envOverridesFn(), ...DISABLE_TOOL_SEARCH_ENV },
        windowsHide: true,
        shell: false,
      });
    } catch (error) {
      // runClaudeQuery의 ENOENT 안내와 같은 메시지 계약 — .cmd 래퍼 함정 참고.
      const code = error && error.code;
      this._lastSpawnError = code === 'ENOENT'
        ? `'${this._claudeBin}' 실행 파일을 PATH에서 못 찾았다. `
          + 'ATHENA_CLAUDE_BIN 환경변수로 실행 파일 절대경로를 지정하라 '
          + '(Windows: `where claude`, 그 외: `which claude`).'
        : String((error && error.message) || error);
      this._lastSpawnErrorCode = code || null;
      this._recordFailure(0);
      return null;
    }
    const proc = {
      child,
      config: { ...config },
      state: 'idle',
      turn: null,
      // 턴 밖(스폰 직후 init 등) 이벤트에서 session_id·예열 완료를 읽는다.
      idleSession: new StreamJsonSession(),
      initSeen: false,
      bornAt: this._now(),
      removed: false,
      killIssued: false,
    };
    this._proc = proc;
    if (child.stdout && typeof child.stdout.setEncoding === 'function') child.stdout.setEncoding('utf8');
    if (child.stderr && typeof child.stderr.setEncoding === 'function') child.stderr.setEncoding('utf8');
    if (child.stdin && typeof child.stdin.on === 'function') {
      child.stdin.on('error', (error) => this._handleTransportFailure(proc, null, error));
    }
    if (child.stdout && typeof child.stdout.on === 'function') {
      child.stdout.on('data', (chunk) => this._handleStdout(proc, chunk));
    }
    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', (chunk) => {
        if (proc.turn) proc.turn.stderr += String(chunk);
      });
    }
    child.on('error', (error) => this._handleTransportFailure(proc, null, error));
    child.on('close', (code) => this._handleTransportFailure(proc, code, null));
    return proc;
  }

  _observeEvent(proc, event) {
    if (event && typeof event.session_id === 'string' && event.session_id) {
      this._lastSessionId = event.session_id;
    }
    if (event && event.type === 'system' && event.subtype === 'init') {
      proc.initSeen = true;
      this._failureStreak = 0;
    }
  }

  _handleStdout(proc, chunk) {
    if (proc.removed) return;
    const turn = proc.turn;
    if (!turn) {
      // 턴 밖 출력(스폰 직후 init 등) — session_id/예열 신호만 읽고 버린다.
      proc.idleSession.feed(chunk, { onEvent: (event) => this._observeEvent(proc, event) });
      return;
    }
    if (turn.killedBy || turn.resultSeen) {
      // 죽이는 중이거나 result 이후 잔여 조각 — 더 파싱하지 않는다.
      return;
    }
    turn.stdoutBytes += Buffer.byteLength(String(chunk), 'utf8');
    if (turn.stdoutBytes > this._maxStdoutBytes) {
      turn.killedBy = 'stdout-cap';
      this._settleTurn(proc, {
        ok: false,
        exitCode: null,
        timedOut: false,
        aborted: false,
        stdoutCapped: true,
        error: `stdout 누적 상한(${Math.round(this._maxStdoutBytes / 1_000_000)}MB) 초과 — claude 상주 세션을 교체했다`,
        finalResult: turn.session.finalResult(),
        stderr: turn.stderr,
        diagnostics: turn.session.diagnostics(),
        firstEventMs: turn.firstEventMs,
        spawnedFresh: turn.spawnedFresh,
      });
      this._removeProcess(proc);
      this._scheduleRespawn();
      return;
    }
    const { onEvent, onTextDelta, onThinkingDelta, onCanvasResult } = turn.callbacks;
    turn.session.feed(chunk, {
      onEvent: (event) => {
        if (turn.firstEventMs === null) turn.firstEventMs = Math.max(0, this._now() - turn.submittedAt);
        this._observeEvent(proc, event);
        if (onEvent) onEvent(event);
      },
      onTextDelta,
      onThinkingDelta,
      onCanvasResult,
    });
    const finalResult = turn.session.finalResult();
    if (!finalResult || turn.resultSeen) return;
    turn.resultSeen = true;
    this._failureStreak = 0;
    const isError = finalResult.is_error === true;
    this._settleTurn(proc, {
      ok: !isError,
      exitCode: null,
      timedOut: false,
      aborted: false,
      stdoutCapped: false,
      error: isError ? (finalResult.result || 'claude 채팅 턴이 실패했다') : null,
      finalResult,
      stderr: turn.stderr,
      diagnostics: turn.session.diagnostics(),
      firstEventMs: turn.firstEventMs,
      spawnedFresh: turn.spawnedFresh,
    }, /* keepProcess */ true);
    proc.state = 'quiet';
    if (this._quietBoundaryMs <= 0) {
      this._finishQuietBoundary(proc, turn);
    } else {
      turn.quietTimer = this._setTimeout(() => this._finishQuietBoundary(proc, turn), this._quietBoundaryMs);
    }
  }

  _finishQuietBoundary(proc, turn) {
    if (proc.removed || proc.turn !== turn) return;
    turn.quietTimer = null;
    proc.turn = null;
    proc.state = 'idle';
  }

  _abortTurn(proc, reason) {
    if (proc.removed) return;
    const turn = proc.turn;
    // 진행 중 턴이 없으면(이미 settled 포함) 웜 프로세스를 지킨다 — 죽일 이유가 없다.
    if (!turn || turn.settled) return;
    turn.killedBy = turn.killedBy || 'abort';
    this._settleTurn(proc, this._abortedResult(proc, reason));
    this._removeProcess(proc);
    // Esc 직후의 다음 질의가 웜 프로세스를 만나도록 백그라운드로 재예열한다.
    this._scheduleRespawn();
  }

  _abortedResult(proc, reason) {
    const turn = proc && proc.turn;
    return {
      ok: false,
      exitCode: null,
      timedOut: false,
      aborted: true,
      stdoutCapped: false,
      error: errorText(reason, '사용자 중단 — claude 상주 세션 턴을 종료했다'),
      finalResult: turn ? turn.session.finalResult() : null,
      stderr: turn ? turn.stderr : '',
      diagnostics: turn ? turn.session.diagnostics() : null,
      firstEventMs: turn ? turn.firstEventMs : null,
      spawnedFresh: turn ? turn.spawnedFresh : false,
    };
  }

  _transportResult(proc, code, error) {
    const turn = proc.turn;
    return {
      ok: false,
      exitCode: code,
      timedOut: false,
      aborted: false,
      stdoutCapped: false,
      error: errorText(error, `claude 상주 세션 종료 코드 ${code}`),
      finalResult: turn ? turn.session.finalResult() : null,
      stderr: turn ? turn.stderr : '',
      diagnostics: turn ? turn.session.diagnostics() : null,
      firstEventMs: turn ? turn.firstEventMs : null,
      spawnedFresh: turn ? turn.spawnedFresh : false,
    };
  }

  _handleTransportFailure(proc, code, error) {
    if (proc.removed) return;
    const turn = proc.turn;
    if (turn && !turn.settled && !turn.resultSeen) {
      // 프로세스가 턴 도중 죽었다 — 남은 carry를 flush해 마지막 조각까지 읽는다
      // (runClaudeQuery의 close 처리와 같은 이유).
      turn.session.end(turn.callbacks);
      this._settleTurn(proc, this._transportResult(proc, code, error));
    }
    const early = Math.max(0, this._now() - proc.bornAt) < this._earlyFailureWindowMs && !proc.initSeen;
    this._removeProcess(proc);
    if (early) this._recordFailure(1);
    this._scheduleRespawn();
  }

  _settleTurn(proc, result, keepProcess = false) {
    const turn = proc && proc.turn;
    if (!turn || turn.settled) return;
    turn.settled = true;
    if (turn.timer !== null) {
      this._clearTimeout(turn.timer);
      turn.timer = null;
    }
    if (turn.signal && turn.onAbort) {
      turn.signal.removeEventListener('abort', turn.onAbort);
      turn.onAbort = null;
    }
    if (!keepProcess) proc.turn = null;
    turn.resolve(result);
  }

  _removeProcess(proc) {
    if (proc.removed) return;
    proc.removed = true;
    proc.turn = null;
    if (this._proc === proc) this._proc = null;
    if (!proc.killIssued) {
      proc.killIssued = true;
      try {
        this._kill(proc.child);
      } catch {
        // 교체가 권위다 — OS 정리 실패는 무시한다(selector 풀과 동일).
      }
    }
  }

  _recordFailure(increment) {
    this._failureStreak += increment;
  }

  _scheduleRespawn() {
    if (this._stopped || this._respawnTimer !== null) return;
    if (this._proc && !this._proc.removed) return;
    const delay = Math.min(
      this._respawnMaxDelayMs,
      this._respawnBaseDelayMs * (2 ** Math.max(0, this._failureStreak - 1)),
    );
    this._respawnTimer = this._setTimeout(() => {
      this._respawnTimer = null;
      if (this._stopped || (this._proc && !this._proc.removed)) return;
      this._spawnProcess({ config: this._lastConfig, resumeSessionId: this._lastSessionId });
    }, delay);
  }
}

function createClaudeChatSession(options) {
  return new ClaudeChatSession(options);
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_QUIET_BOUNDARY_MS,
  buildChatSessionArgs,
  ClaudeChatSession,
  createClaudeChatSession,
};
