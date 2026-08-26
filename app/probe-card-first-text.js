// US-006 프로브 — 카드가 먼저 랜딩되고 스트림 텍스트는 그 뒤에 나오는지 실측한다.
// probe-text-stream.js와 같은 부팅 패턴(별도 프로필 — worker-w0fe의 데모 프로브와
// 프로필이 겹치지 않게 분리)을 쓰되, 이 프로브가 재는 건 IPC 이벤트 도착 시각이
// 아니라 **실제 DOM에 그려진 시각**이다 — chat.js의 카드 우선 버퍼링(US-006)은
// athena:live-text-delta 자체의 도착 시각을 안 늦춘다(그건 여전히 원래 시각에
// 온다), .turn-a에 실제로 칠해지는 시각만 늦춘다. 그래서 raw delta 도착 시각을
// 재면 버퍼링 효과가 안 보인다 — MutationObserver로 DOM을 직접 지켜봐야 한다.
// 백엔드(127.0.0.1:8010)가 떠 있어야 한다.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-card-first-text-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// manifest-backed facts 카드로 즉시 떨어지는 시세 질문(live-prompt.js 예시와 동일
// 계열) — 카드가 뜬 뒤 "핵심 요약 3문장 이내" 후속 텍스트가 따라오는 전형적 모양.
const QUERY = process.argv[2] || '삼성전자 오늘 주가 알려주고 왜 그런지 한 줄로 설명해줘';

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  shellWin.show();
  shellWin.focus();
  await wait(3000);

  await shellWin.webContents.executeJavaScript(`
    window.__cardEventAt = null; // athena:live-canvas-added IPC 도착 시각
    window.__cardDomAt = null;   // #grid에 .card가 실제로 추가된 시각
    window.__rawDeltaAt = null;  // athena:live-text-delta IPC 최초 도착 시각(버퍼링과 무관)
    window.__textDomAt = null;   // .turn-a에 텍스트가 실제로 칠해진 시각(버퍼링의 영향을 받음)
    window.__unsubCanvasAdded = window.athena.on('athena:live-canvas-added', () => {
      if (window.__cardEventAt == null) window.__cardEventAt = Date.now();
    });
    window.__unsubDelta = window.athena.on('athena:live-text-delta', () => {
      if (window.__rawDeltaAt == null) window.__rawDeltaAt = Date.now();
    });
    const grid = document.getElementById('grid');
    window.__gridObserver = new MutationObserver(() => {
      if (window.__cardDomAt == null && grid.querySelector('.card')) window.__cardDomAt = Date.now();
    });
    window.__gridObserver.observe(grid, { childList: true });
    window.__historyObserver = new MutationObserver(() => {
      if (window.__textDomAt != null) return;
      const bubble = document.querySelector('.turn-a');
      if (bubble && bubble.textContent && bubble.textContent.trim()) window.__textDomAt = Date.now();
    });
    window.__historyObserver.observe(document.getElementById('history'), {
      childList: true, subtree: true, characterData: true,
    });
    undefined;
  `);

  const startedAt = Date.now();
  const result = await shellWin.webContents.executeJavaScript(
    `window.athena.invoke('athena__render_canvas', ${JSON.stringify({ source: 'live', query: QUERY, expand: false })})`,
  );
  const resolvedAt = Date.now();
  await wait(300); // 마지막 MutationObserver 콜백이 마이크로태스크 큐를 빠져나올 여유

  const cardEventAt = await shellWin.webContents.executeJavaScript('window.__cardEventAt');
  const cardDomAt = await shellWin.webContents.executeJavaScript('window.__cardDomAt');
  const rawDeltaAt = await shellWin.webContents.executeJavaScript('window.__rawDeltaAt');
  const textDomAt = await shellWin.webContents.executeJavaScript('window.__textDomAt');
  await shellWin.webContents.executeJavaScript(`
    window.__unsubCanvasAdded && window.__unsubCanvasAdded();
    window.__unsubDelta && window.__unsubDelta();
    window.__gridObserver && window.__gridObserver.disconnect();
    window.__historyObserver && window.__historyObserver.disconnect();
    undefined;
  `);

  const summary = {
    query: QUERY,
    totalElapsedMs: resolvedAt - startedAt,
    cardEventAtMsAfterStart: cardEventAt ? cardEventAt - startedAt : null,
    cardDomAtMsAfterStart: cardDomAt ? cardDomAt - startedAt : null,
    rawDeltaAtMsAfterStart: rawDeltaAt ? rawDeltaAt - startedAt : null,
    textDomAtMsAfterStart: textDomAt ? textDomAt - startedAt : null,
    // 핵심 단언 — 실제로 눈에 보이는 카드가 실제로 눈에 보이는 텍스트보다 먼저다.
    cardDomBeforeTextDom: cardDomAt != null && textDomAt != null ? cardDomAt <= textDomAt : null,
    // 참고 — raw delta는 버퍼링 때문에 카드보다 먼저 도착할 수 있다(정상, 결함 아님).
    // 이게 이 프로브가 IPC 시각이 아니라 DOM 시각을 재는 이유다.
    rawDeltaBeforeCardDom: rawDeltaAt != null && cardDomAt != null ? rawDeltaAt < cardDomAt : null,
    bufferingWasActive: rawDeltaAt != null && cardDomAt != null && textDomAt != null
      ? rawDeltaAt < cardDomAt && textDomAt >= cardDomAt
      : null,
    resultAnswerText: result && result.answerText,
    resultOk: result && result.ok,
  };
  fs.writeFileSync(
    path.join(__dirname, 'captures', 'probe-card-first-text.json'),
    JSON.stringify(summary, null, 1),
  );
  console.log('[probe]', JSON.stringify(summary, null, 1));
  const ok = cardDomAt != null && textDomAt != null && summary.cardDomBeforeTextDom === true;
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((e) => { console.error('[probe] 실패:', e); app.exit(1); });
