// 실배선 spawn 경로 검증 — `app/lib/main/claude-runner.js`의 `runClaudeQuery`를
// **실제로** 불러서 `claude -p`가 스폰되고 stream-json이 파싱되는지 본다.
//
// 왜 필요한가: `app-impl`이 파서는 실왕복 캡처(S4)로 검증했지만 **spawn 자체는
// 한 번도 실행하지 않았다**(quota 절약). 그래서 아래가 미검증으로 남았다 —
//   - `shell: process.platform === 'win32'` 가정이 실제로 통하는지
//   - Windows에서 `claude` 바이너리가 PATH로 해석되는지
//   - `--mcp-config` 상대경로 인자가 cwd 기준으로 실제로 먹는지
//   - stdin을 닫은 채로 왕복이 성립하는지
//   - `StreamJsonSession.feed()`가 실시간 청크에서 캔버스를 뽑는지
// CLAUDE.md §3 — "될 것이다"로 넘기지 않는다.
//
// electron이 필요 없다. `runClaudeQuery`는 cwd/configFile을 인자로 받으므로
// `mcp-config.js`(userData 의존)를 우회해 이 디렉토리의 `.mcp.json`을 그대로 쓴다.
//
// 실행:
//   node spike/cli-pipe/gateway/probe_live_spawn.js
//
// ⚠ **쿼터를 쓴다.** 왕복 1회에 40초 이상 걸린다. 함부로 반복하지 마라.

'use strict';

const path = require('path');
const fs = require('fs');

const GATEWAY_DIR = __dirname;
const { runClaudeQuery } = require(
  path.join(__dirname, '..', '..', '..', 'app', 'lib', 'main', 'claude-runner.js')
);

const PROMPT =
  'athena__render_canvas 툴을 canvas_type="table" 로 호출해라. ' +
  'data.columns 는 [{"key":"name","label":"종목명"},{"key":"price","label":"현재가"}], ' +
  'data.rows 는 [{"name":"삼성전자","price":"71,000원"}] 로 정확히 보내라. ' +
  '툴을 반드시 실제로 호출하고, 호출 후에는 더 이상 아무 툴도 쓰지 마라.';

const events = [];
const canvases = [];

(async () => {
  const startedAt = Date.now();
  const result = await runClaudeQuery({
    prompt: PROMPT,
    cwd: GATEWAY_DIR,
    configFile: '.mcp.json',
    onCanvasResult: (r) => {
      canvases.push(r);
      console.log('[probe] 캔버스 수신:', JSON.stringify({
        kind: r && r.kind,
        canvasType: r && r.envelope && r.envelope.canvas_type,
        fellBack: r && r.envelope && r.envelope.fell_back,
      }));
    },
    onEvent: (e) => events.push({ type: e && e.type, subtype: e && e.subtype }),
  });

  const elapsedMs = Date.now() - startedAt;
  const report = {
    // 이 프로브가 증명하려는 것들
    spawnSucceeded: result.error !== 'spawn claude ENOENT' && result.exitCode !== undefined,
    ok: result.ok,
    exitCode: result.exitCode,
    error: result.error,
    elapsedMs,
    canvasCount: canvases.length,
    canvases: canvases.map((c) => ({
      kind: c && c.kind,
      canvasType: c && c.envelope && c.envelope.canvas_type,
      fellBack: c && c.envelope && c.envelope.fell_back,
      fallbackReason: c && c.envelope && c.envelope.fallback_reason,
      dataKeys: c && c.envelope && c.envelope.data ? Object.keys(c.envelope.data) : null,
    })),
    diagnostics: result.diagnostics,
    eventTypeCounts: events.reduce((acc, e) => {
      const k = `${e.type}${e.subtype ? '/' + e.subtype : ''}`;
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
    stderrHead: (result.stderr || '').slice(0, 300),
    finalResultText: result.finalResult ? String(result.finalResult.result || '').slice(0, 400) : null,
  };

  // 콘솔이 cp949라 한글이 깨진다(CLAUDE.md §8) — 파일로 남기고 파일을 열어 확인한다.
  const outPath = path.join(GATEWAY_DIR, 'PROBE-LIVE-SPAWN.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log('[probe] 리포트 저장:', outPath);
  console.log('[probe] spawn 성공:', report.spawnSucceeded, '| ok:', report.ok,
    '| exit:', report.exitCode, '| 캔버스:', report.canvasCount, '| 경과:', elapsedMs + 'ms');
  process.exit(report.ok && report.canvasCount > 0 ? 0 : 1);
})();
