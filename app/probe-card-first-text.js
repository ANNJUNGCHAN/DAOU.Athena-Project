// US-006/US-007 프로브 — 카드가 먼저 랜딩되고 스트림 텍스트는 그 뒤에 나오는지,
// 그리고 부팅 화면이 그래프/답변 모드 뒤섞임 없이 순수한 답변 모드인지를 함께
// 잰다(같은 E2E 큐 슬롯에서 검증하라는 팀리드 지시).
//
// US-006: probe-text-stream.js와 같은 부팅 패턴(별도 프로필 — worker-w0fe의
// 데모 프로브와 프로필이 겹치지 않게 분리)을 쓰되, 이 프로브가 재는 건 IPC
// 이벤트 도착 시각이 아니라 **실제 DOM에 그려진 시각**이다 — chat.js의 카드
// 우선 버퍼링은 athena:live-text-delta 자체의 도착 시각을 안 늦춘다(그건 여전히
// 원래 시각에 온다), .turn-a에 실제로 칠해지는 시각만 늦춘다. 그래서 raw delta
// 도착 시각을 재면 버퍼링 효과가 안 보인다 — MutationObserver로 DOM을 직접
// 지켜봐야 한다.
//
// US-007: 부팅 직후(3초 settle — canvas.js 동기 초기화 + brain-status 비동기
// 왕복까지 전부 끝날 시간) 그래프 표면(summaryTable/graphCanvas)이 전무하고
// 답변 표면(gridEmpty)만 있는지, 칩이 "답변"인지를 확인한다. 3초를 기다리는
// 이유가 핵심이다 — brain-status가 늦게 resolve되면서 그래프 표면을 답변
// 모드에 새어 보이게 했던 게 원래 결함이라, resolve가 끝난 뒤에 재야 그
// 결함을 다시 잡아낼 수 있다.
//
// 백엔드(127.0.0.1:8010)가 떠 있어야 한다.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const PROFILE = path.join(__dirname, '.probe-card-first-text-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
writeProbeModelPrefs(PROFILE);
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

  // US-007 — 사용자가 아무것도 누르기 전, 순수 부팅 상태를 잰다.
  const bootState = await shellWin.webContents.executeJavaScript(`
    ({
      modeNow: document.getElementById('sidebarModes') ? document.getElementById('sidebarModes').dataset.mode : null,
      summaryTableHidden: document.getElementById('graphSummaryTable') ? document.getElementById('graphSummaryTable').hidden : null,
      graphCanvasHidden: document.getElementById('graphCanvas') ? document.getElementById('graphCanvas').hidden : null,
      mosaicHidden: document.getElementById('mosaic') ? document.getElementById('mosaic').hidden : null,
      gridEmptyHidden: document.getElementById('gridEmpty') ? document.getElementById('gridEmpty').hidden : null,
      gridCardCount: document.getElementById('grid') ? document.getElementById('grid').querySelectorAll('.card').length : null,
    })
  `);

  // IIFE로 감싼다 — executeJavaScript의 top-level 스코프는 페이지의 main world와
  // 공유돼서, 여기서 bare `const grid = ...`를 쓰면 canvas.js 자신의 top-level
  // `const grid`(canvas.js:108)와 충돌해 SyntaxError로 스크립트 전체가 죽는다
  // (실측 — Electron은 "Script failed to execute"라고만 하고 원인을 안 밝힌다,
  // 함수 스코프로 격리해야 페이지 스크립트의 이름과 안 부딪힌다).
  await shellWin.webContents.executeJavaScript(`(function () {
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
    const probeGrid = document.getElementById('grid');
    window.__gridObserver = new MutationObserver(() => {
      if (window.__cardDomAt == null && probeGrid.querySelector('.card')) window.__cardDomAt = Date.now();
    });
    window.__gridObserver.observe(probeGrid, { childList: true });
    window.__historyObserver = new MutationObserver(() => {
      if (window.__textDomAt != null) return;
      const bubble = document.querySelector('.turn-a');
      if (bubble && bubble.textContent && bubble.textContent.trim()) window.__textDomAt = Date.now();
    });
    window.__historyObserver.observe(document.getElementById('history'), {
      childList: true, subtree: true, characterData: true,
    });
  })();
  undefined;`);

  // 실사용자와 같은 경로로 질의를 넣는다 — window.athena.invoke(athena__render_canvas)를
  // 직접 부르면 chat.js의 runQueryLive()를 완전히 건너뛴다(그 함수가 IPC를 감싸는
  // 게 아니라, chat.js가 스스로 그 IPC를 부르는 쪽이다). runQueryLive 안에서만
  // onLiveTextDelta/onLiveCanvasAdded 리스너와 이번 카드 우선 버퍼링이 만들어지므로,
  // #input에 진짜 Enter 키다운을 흘려보내야 그 코드가 실행된다(실측 — 직접 invoke로
  // 돌렸더니 카드는 뜨는데 .turn-a가 끝까지 안 생겼다, chat.js가 아예 안 불렸기 때문).
  const startedAt = Date.now();
  await shellWin.webContents.executeJavaScript(`(function () {
    const input = document.getElementById('input');
    input.value = ${JSON.stringify(QUERY)};
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })();
  undefined;`);

  // runQueryLive 완료 신호 — 반환값을 못 받으니(이벤트로 트리거한 비동기 흐름이라
  // 여기서 await할 Promise가 없다) .progress-line이 사라지는 걸로 판정한다(chat.js가
  // 턴 종료 시 progress.remove()를 부르는 지점, 393-622행 부근). 최대 60초.
  let resolvedAt = null;
  for (let i = 0; i < 120; i += 1) {
    await wait(500);
    const progressGone = await shellWin.webContents.executeJavaScript(
      'document.querySelectorAll(".progress-line").length === 0',
    );
    if (progressGone) { resolvedAt = Date.now(); break; }
  }
  if (resolvedAt == null) resolvedAt = Date.now(); // 타임아웃 — 그래도 지금까지 값을 기록한다
  await wait(300); // 마지막 MutationObserver 콜백이 마이크로태스크 큐를 빠져나올 여유

  const cardEventAt = await shellWin.webContents.executeJavaScript('window.__cardEventAt');
  const cardDomAt = await shellWin.webContents.executeJavaScript('window.__cardDomAt');
  const rawDeltaAt = await shellWin.webContents.executeJavaScript('window.__rawDeltaAt');
  const textDomAt = await shellWin.webContents.executeJavaScript('window.__textDomAt');
  const finalBubbleText = await shellWin.webContents.executeJavaScript(
    '(function(){ const b = document.querySelector(".turn-a"); return b ? b.textContent : null; })()',
  );
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
    finalBubbleText,
    // US-007 — 순수 부팅 상태(사용자가 아무것도 누르기 전, brain-status 왕복까지 끝난 뒤).
    bootState,
    bootStatePure: bootState.modeNow === 'chat'
      && bootState.summaryTableHidden === true
      && bootState.graphCanvasHidden === true
      && bootState.mosaicHidden === false
      && bootState.gridEmptyHidden === false, // 카드 0개 상태라 빈 상태 블록은 보여야 정상
  };
  fs.writeFileSync(
    path.join(__dirname, 'captures', 'probe-card-first-text.json'),
    JSON.stringify(summary, null, 1),
  );
  console.log('[probe]', JSON.stringify(summary, null, 1));
  const ok = cardDomAt != null && textDomAt != null
    && summary.cardDomBeforeTextDom === true
    && summary.bootStatePure === true;
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((e) => { console.error('[probe] 실패:', e); app.exit(1); });
