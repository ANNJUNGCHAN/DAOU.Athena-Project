// S2 텍스트 스트리밍 + 추론 미리보기 결선 확인 프로브 — chat.js가 실제로
// athena:live-text-delta를 턴 종료 전에 여러 번 받는지, 첫 조각이 오는 시각이
// 최종 invoke() resolve보다 확연히 이른지, 그리고 추론 미리보기(.turn-thinking-preview)가
// 답변 시작과 함께 사라지고 최종 DOM에 안 남는지를 실측한다.
// 백엔드(127.0.0.1:8010)가 떠 있어야 한다.
// ATHENA_NO_AUTOSTART를 안 켠다(probe-chart-fastpath.js와 같은 이유 — 안 켜야
// Kiwoom 인덱스 갱신 등 정상 부팅 경로가 돈다. 이 프로브는 인덱스에 안 기대지만
// 일관성을 위해 정상 부팅으로 통일한다).

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-text-stream-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
// 추론 미리보기가 실제로 눈에 보이려면 effort를 높여야 한다(기본 null=CLI 기본값은
// 이 앱의 도구 제한 프롬프트에서 thinking_delta를 안 낼 수 있다 — 실측으로 확인).
fs.writeFileSync(
  path.join(PROFILE, 'athena-model.json'),
  JSON.stringify({ claude: { model: 'claude-opus-5', effort: 'high' } }),
);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// 차트/현재가 문법에 안 걸리는 일반 질문 — 반드시 claude -p 경로로 간다.
const QUERY = process.argv[2] || '오늘 코스피 시장 분위기를 한 문장으로 설명해줘';

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  shellWin.show();
  shellWin.focus();
  await wait(3000);

  await shellWin.webContents.executeJavaScript(`
    window.__deltaLog = [];
    window.__thinkingLog = [];
    window.__thinkingPreviewSeenInDom = false;
    window.__unsubDelta = window.athena.on('athena:live-text-delta', (payload) => {
      window.__deltaLog.push({ t: Date.now(), text: payload && payload.text });
    });
    window.__unsubThinking = window.athena.on('athena:live-thinking-delta', (payload) => {
      window.__thinkingLog.push({ t: Date.now(), text: payload && payload.text });
      if (document.querySelector('.turn-thinking-preview')) window.__thinkingPreviewSeenInDom = true;
    });
    undefined;
  `);

  const startedAt = Date.now();
  const result = await shellWin.webContents.executeJavaScript(
    `window.athena.invoke('athena__render_canvas', ${JSON.stringify({ source: 'live', query: QUERY, expand: false })})`,
  );
  const resolvedAt = Date.now();

  const deltaLog = await shellWin.webContents.executeJavaScript('window.__deltaLog');
  const thinkingLog = await shellWin.webContents.executeJavaScript('window.__thinkingLog');
  const thinkingPreviewSeenInDom = await shellWin.webContents.executeJavaScript('window.__thinkingPreviewSeenInDom');
  const thinkingPreviewLeftInDomAfterTurn = await shellWin.webContents.executeJavaScript(
    '!!document.querySelector(".turn-thinking-preview")',
  );
  await shellWin.webContents.executeJavaScript(
    'window.__unsubDelta && window.__unsubDelta(); window.__unsubThinking && window.__unsubThinking(); undefined',
  );

  const firstDeltaAt = deltaLog.length ? deltaLog[0].t : null;
  const firstThinkingAt = thinkingLog.length ? thinkingLog[0].t : null;
  const summary = {
    query: QUERY,
    totalElapsedMs: resolvedAt - startedAt,
    deltaCount: deltaLog.length,
    firstDeltaMsAfterStart: firstDeltaAt ? firstDeltaAt - startedAt : null,
    firstDeltaMsBeforeResolve: firstDeltaAt ? resolvedAt - firstDeltaAt : null,
    concatenatedDeltas: deltaLog.map((d) => d.text).join(''),
    thinkingDeltaCount: thinkingLog.length,
    firstThinkingMsAfterStart: firstThinkingAt ? firstThinkingAt - startedAt : null,
    firstThinkingBeforeFirstText: firstThinkingAt && firstDeltaAt ? firstThinkingAt <= firstDeltaAt : null,
    thinkingPreviewSeenInDom,
    thinkingPreviewLeftInDomAfterTurn,
    resultAnswerText: result && result.answerText,
    resultSource: result && result.source,
    resultOk: result && result.ok,
  };
  fs.writeFileSync(
    path.join(__dirname, 'captures', 'probe-text-stream.json'),
    JSON.stringify(summary, null, 1),
  );
  console.log('[probe]', JSON.stringify(summary, null, 1));
  const ok = summary.deltaCount > 0
    && summary.firstDeltaMsBeforeResolve > 0
    && !summary.thinkingPreviewLeftInDomAfterTurn; // 미리보기가 최종 DOM에 남으면 실패
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((e) => { console.error('[probe] 실패:', e); app.exit(1); });
