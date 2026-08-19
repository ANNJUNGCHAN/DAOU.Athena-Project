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
// 턴 타임라인 — 각 이벤트의 수신 시각(ms since start)·타입·tool_use 이름·직전
// 이벤트와의 간격을 기록한다(오케스트레이터 지시, 합의 계획 W1 지연 계측).
const turnTimeline = [];
let firstCanvasMs = null;

(async () => {
  const sideChannel = { connected: false, received: [] };
try {
  // 토큰 설정 배포는 모드 A — 앱(routine-feed)과 같은 인증 봉투를 보낸다.
  const localToken = require(
    path.join(__dirname, '..', '..', '..', 'app', 'lib', 'main', 'backend-launcher.js')
  ).readLocalBearerToken();
  const ws = new WebSocket('ws://127.0.0.1:8010/api/v1/ws/canvas');
  ws.onopen = () => {
    sideChannel.connected = true;
    if (localToken) ws.send(JSON.stringify({ type: 'auth', token: localToken }));
  };
  ws.onmessage = (ev) => {
    try { sideChannel.received.push(JSON.parse(ev.data)); } catch { /* 무시 */ }
  };
  ws.onerror = () => {};
} catch { /* Node<21 등 — 구독 없이 진행(리포트에 connected:false로 남는다) */ }

const startedAt = Date.now();
  let lastEventAt = startedAt;
  const result = await runClaudeQuery({
    prompt: buildLivePrompt(QUERY),
    cwd: GATEWAY_DIR,
    configFile: '.mcp.json',
    timeoutMs: 240_000,
    onCanvasResult: (r) => {
      canvases.push(r);
      if (firstCanvasMs === null) firstCanvasMs = Date.now() - startedAt;
      console.log('[probe] canvas:', JSON.stringify({
        kind: r && r.kind,
        canvasType: r && r.envelope && r.envelope.canvas_type,
        fellBack: r && r.envelope && r.envelope.fell_back,
      }));
    },
    onEvent: (e) => {
      events.push({ type: e && e.type, subtype: e && e.subtype });
      // assistant 턴의 tool_use 이름을 수집 — 키움 4툴을 실제로 탔는지의 근거.
      const eventToolNames = [];
      try {
        const content = e && e.message && e.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block && block.type === 'tool_use' && block.name) {
              toolNames.push(block.name);
              eventToolNames.push(block.name);
            }
          }
        }
      } catch { /* 관측 실패는 프로브 실패가 아니다 */ }
      const now = Date.now();
      turnTimeline.push({
        atMs: now - startedAt,
        deltaMs: now - lastEventAt,
        type: e && e.type,
        subtype: e && e.subtype,
        toolNames: eventToolNames,
      });
      lastEventAt = now;
    },
  });

  const elapsedMs = Date.now() - startedAt;
  // 사이드 채널 수신분(2026-08-19 데이터 지름길) — 카드 봉투는 이제 툴 결과가
  // 아니라 /api/v1/ws/canvas로 온다. 프로브가 앱 대신 구독해 실수신을 검증한다.
  await new Promise((r) => setTimeout(r, 1500)); // 마지막 push 도착 여유
  const chartCanvases = canvases.filter(
    (c) => c && c.envelope && c.envelope.canvas_type === 'chart' && !c.envelope.fell_back
  );
  const kiwoomToolCalls = toolNames.filter((n) => /athena_(search|describe|resolve|call)/.test(n));
  const foreignStockCalls = toolNames.filter((n) => /korea-stock|pykrx|krx/i.test(n));

  const side = sideChannel.received[0] || null;
  const report = {
    ok: result.ok,
    sideChannel: {
      connected: sideChannel.connected,
      receivedCount: sideChannel.received.length,
      canvasType: side && side.canvas_type,
      barsLength: side && side.data && Array.isArray(side.data.bars) ? side.data.bars.length : null,
      firstTime: side && side.data && side.data.bars && side.data.bars[0] ? side.data.bars[0].time : null,
      lastTime: side && side.data && side.data.bars && side.data.bars.length
        ? side.data.bars[side.data.bars.length - 1].time : null,
    },
    exitCode: result.exitCode,
    error: result.error,
    elapsedMs,
    firstCanvasMs,
    turnTimeline,
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
    '| chart:', report.chartCanvasCount, '| side:', report.sideChannel.receivedCount, 'bars:', report.sideChannel.barsLength, '| kiwoom calls:', kiwoomToolCalls.length,
    '| foreign stock calls:', foreignStockCalls.length, '| elapsed:', elapsedMs + 'ms');
  const pass = report.ok && report.chartCanvasCount > 0 && foreignStockCalls.length === 0;
  process.exit(pass ? 0 : 1);
})();
