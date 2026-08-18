// 키움 실배선 차트 E2E — "삼성전자 차트" 자연어 질의가 키움 셀렉터 4툴을 타고
// chart 캔버스까지 도달하는지 실왕복으로 검증한다 (2026-08-18, 사용자 지시
// "주식 관련 API는 무조건 키움" 결선의 종단 증거).
//
// probe_live_spawn.js 와 같은 구조이되 두 가지가 다르다:
//   1) 프롬프트를 강제 툴 호출이 아니라 **앱과 동일한 buildLivePrompt(자연어)** 로
//      감싼다 — 라우팅 규칙(주식=키움) 자체가 검증 대상이므로.
//   2) 전제: 키움 백엔드(uvicorn 127.0.0.1:8010)가 떠 있어야 한다. 앱은
//      backend-launcher가 자동 기동하지만 이 프로브는 node 단독이라 호출자가
//      먼저 백엔드를 띄운다(안 떠 있으면 이 프로브는 "미기동 안내" 경로를 검증하게 된다).
//
// 실행:  node spike/cli-pipe/gateway/probe_kiwoom_chart.js
// ⚠ 쿼터를 쓴다. 4툴 왕복 + 차트 렌더라 1분 이상 걸릴 수 있다.

'use strict';

const path = require('path');
const fs = require('fs');

const GATEWAY_DIR = __dirname;
const { runClaudeQuery } = require(
  path.join(__dirname, '..', '..', '..', 'app', 'lib', 'main', 'claude-runner.js')
);
const { buildLivePrompt } = require(
  path.join(__dirname, '..', '..', '..', 'app', 'lib', 'main', 'live-prompt.js')
);

const QUERY = '삼성전자 최근 일봉 차트 그려줘';

const events = [];
const canvases = [];
const toolNames = [];

(async () => {
  const startedAt = Date.now();
  const result = await runClaudeQuery({
    prompt: buildLivePrompt(QUERY),
    cwd: GATEWAY_DIR,
    configFile: '.mcp.json',
    timeoutMs: 240_000,
    onCanvasResult: (r) => {
      canvases.push(r);
      console.log('[probe] canvas:', JSON.stringify({
        kind: r && r.kind,
        canvasType: r && r.envelope && r.envelope.canvas_type,
        fellBack: r && r.envelope && r.envelope.fell_back,
      }));
    },
    onEvent: (e) => {
      events.push({ type: e && e.type, subtype: e && e.subtype });
      // assistant 턴의 tool_use 이름을 수집 — 키움 4툴을 실제로 탔는지의 근거.
      try {
        const content = e && e.message && e.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block && block.type === 'tool_use' && block.name) toolNames.push(block.name);
          }
        }
      } catch { /* 관측 실패는 프로브 실패가 아니다 */ }
    },
  });

  const elapsedMs = Date.now() - startedAt;
  const chartCanvases = canvases.filter(
    (c) => c && c.envelope && c.envelope.canvas_type === 'chart' && !c.envelope.fell_back
  );
  const kiwoomToolCalls = toolNames.filter((n) => /athena_(search|describe|resolve|call)/.test(n));
  const foreignStockCalls = toolNames.filter((n) => /korea-stock|pykrx|krx/i.test(n));

  const report = {
    ok: result.ok,
    exitCode: result.exitCode,
    error: result.error,
    elapsedMs,
    canvasCount: canvases.length,
    chartCanvasCount: chartCanvases.length,
    chartDataKeys: chartCanvases[0] && chartCanvases[0].envelope.data
      ? Object.keys(chartCanvases[0].envelope.data) : null,
    chartBarsLength: chartCanvases[0] && chartCanvases[0].envelope.data
      && Array.isArray(chartCanvases[0].envelope.data.bars)
      ? chartCanvases[0].envelope.data.bars.length : null,
    toolNames,
    kiwoomToolCalls,
    foreignStockCalls, // 라우팅 규칙 위반 감지 — 0건이어야 한다
    eventTypeCounts: events.reduce((acc, e) => {
      const k = `${e.type}${e.subtype ? '/' + e.subtype : ''}`;
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
    stderrHead: (result.stderr || '').slice(0, 300),
    finalResultText: result.finalResult ? String(result.finalResult.result || '').slice(0, 500) : null,
  };

  // 콘솔이 cp949라 한글이 깨진다(CLAUDE.md §8) — 파일로 남기고 파일을 열어 확인한다.
  const outPath = path.join(GATEWAY_DIR, 'PROBE-KIWOOM-CHART.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log('[probe] report:', outPath);
  console.log('[probe] ok:', report.ok, '| exit:', report.exitCode,
    '| chart:', report.chartCanvasCount, '| kiwoom calls:', kiwoomToolCalls.length,
    '| foreign stock calls:', foreignStockCalls.length, '| elapsed:', elapsedMs + 'ms');
  const pass = report.ok && report.chartCanvasCount > 0 && foreignStockCalls.length === 0;
  process.exit(pass ? 0 : 1);
})();
