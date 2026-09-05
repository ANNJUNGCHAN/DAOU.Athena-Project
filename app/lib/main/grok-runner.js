'use strict';

const { spawn } = require('child_process');
const { StreamJsonSession } = require('./stream-json-parser');
const mcpEnv = require('./mcp-env');
const { killTree } = require('./proc-utils');
const { getGrokBin } = require('./grok-bin');

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_STDOUT_BYTES = 5_000_000;

// grok 내부 툴 ID — Claude의 Bash/Write/Edit/Web* 와 같은 실행 표면이다.
// MCP 툴은 --disallowed-tools 대상이 아니라 그대로 남는다(headless 문서:
// MCP meta-tools remain available unless denied). --yolo 는 남은 툴을
// 자동 승인한다 — 캔버스 렌더(MCP)가 권한 프롬프트에 걸려 멈추지 않게.
const DISALLOWED_EXECUTION_TOOLS = 'run_terminal_cmd,search_replace,write_file,web_search,web_fetch';

function grokFailureMessage({ killedBy, timeoutMs, code, finalResult, stderrText }) {
  if (killedBy === 'timeout') {
    return `왕복 타임아웃(${Math.round(timeoutMs / 1000)}s) — grok 프로세스 트리를 종료했다`;
  }
  if (killedBy === 'abort') return '사용자 중단 — grok 프로세스 트리를 종료했다';
  if (killedBy === 'stdout-cap') {
    return `stdout 누적 상한(${Math.round(MAX_STDOUT_BYTES / 1_000_000)}MB) 초과 — grok 프로세스 트리를 종료했다`;
  }
  const listed = finalResult && Array.isArray(finalResult.errors)
    ? finalResult.errors.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (listed.length) return listed.join(' · ');
  if (finalResult && typeof finalResult.result === 'string' && finalResult.result.trim()) {
    return finalResult.result.trim();
  }
  const stderr = String(stderrText || '').trim();
  if (stderr) {
    const line = stderr.split(/\r?\n/).map((item) => item.trim()).find((item) => item);
    if (line) return line.replace(/^Error:\s*/i, '');
  }
  return `grok 종료 코드 ${code}`;
}

function buildArgs({ prompt, resumeSessionId, model, effort }) {
  const args = [
    '-p', prompt,
    '--output-format', 'streaming-messages-json',
    '--include-partial-messages',
    '--yolo',
    '--verbatim',
    '--disallowed-tools', DISALLOWED_EXECUTION_TOOLS,
  ];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  if (resumeSessionId) args.push('--resume', String(resumeSessionId));
  return args;
}

function runGrokQuery({
  prompt,
  cwd,
  resumeSessionId = null,
  model = null,
  effort = null,
  grokBin = getGrokBin(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onSpawn,
  onCanvasResult,
  onEvent,
  onTextDelta,
  onThinkingDelta,
  signal,
} = {}) {
  return new Promise((resolve) => {
    if (!prompt || !String(prompt).trim()) {
      resolve({ ok: false, error: '질의가 비어 있다', diagnostics: null });
      return;
    }
    if (!cwd) {
      resolve({ ok: false, error: 'cwd(.grok/config.toml 위치)가 없다', diagnostics: null });
      return;
    }

    const args = buildArgs({ prompt, resumeSessionId, model, effort });
    const session = new StreamJsonSession();
    let child;
    try {
      child = spawn(grokBin, args, {
        cwd,
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
    let killedBy = null;
    let stdoutBytes = 0;
    const abortFromSignal = () => {
      killedBy = killedBy || 'abort';
      killTree(child);
    };

    if (signal) {
      if (signal.aborted) abortFromSignal();
      else signal.addEventListener('abort', abortFromSignal, { once: true });
    }

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
      if (killedBy) return;
      stdoutBytes += Buffer.byteLength(chunk, 'utf8');
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        killedBy = 'stdout-cap';
        killTree(child);
        return;
      }
      session.feed(chunk, { onCanvasResult, onEvent, onTextDelta, onThinkingDelta });
    });
    child.stderr.on('data', (c) => { stderrText += c; });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abortFromSignal);
      const code = err && err.code;
      const message =
        code === 'ENOENT'
          ? `'${grokBin}' 실행 파일을 PATH에서 못 찾았다. ` +
            'ATHENA_GROK_BIN 환경변수로 실행 파일 절대경로를 지정하라 ' +
            "(Windows: `where grok`, 그 외: `which grok`)."
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
      if (signal) signal.removeEventListener('abort', abortFromSignal);
      session.end({ onCanvasResult, onEvent, onTextDelta, onThinkingDelta });
      const finalResult = session.finalResult();
      const isError = !!killedBy || code !== 0 || (finalResult && finalResult.is_error === true) || !finalResult;
      resolve({
        ok: !isError,
        exitCode: code,
        timedOut: killedBy === 'timeout',
        aborted: killedBy === 'abort',
        stdoutCapped: killedBy === 'stdout-cap',
        error: isError ? grokFailureMessage({
          killedBy, timeoutMs, code, finalResult, stderrText,
        }) : null,
        finalResult,
        stderr: stderrText,
        diagnostics: session.diagnostics(),
      });
    });
  });
}

module.exports = {
  buildArgs,
  grokFailureMessage,
  runGrokQuery,
  DISALLOWED_EXECUTION_TOOLS,
  MAX_STDOUT_BYTES,
};
