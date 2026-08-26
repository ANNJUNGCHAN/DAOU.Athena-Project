// 카드 랜딩 진단 프로브(2026-08-26) — "언어는 맞는데 카드가 캔버스에 안
// 뜬다"는 사용자 신고를 fast-path 문법이 아닌 대화체 질의로 재현한다.
// probe-text-stream.js(claude -p 경로, 렌더 지시 프롬프트)와 probe-chart-fastpath.js
// (감사 로그·차트 상태 스냅샷 관례)를 합친다. auto_execute는 OFF 상태
// (기본값)로 둔다 — 이번 진단은 그 경로와 무관하게 재현되는지 먼저 본다.
// 백엔드(127.0.0.1:8010)가 이미 떠 있어야 한다.
//
// ATHENA_NO_AUTOSTART=1을 켠다 — probe-chart-fastpath.js와 다른 이유다.
// main.js는 이 플래그가 없으면 모듈 로드 시점에 자기 자신의
// `app.whenReady().then(createWindows)`를 스스로도 돈다. 이 프로브가 그
// 뒤에 또 `createWindows()`를 명시로 부르면 같은 프로세스 안에서
// createWindows()가 경합적으로 두 번 실행돼(실측: main-debug.log에 부팅
// 로그 전 줄이 정확히 두 번씩 찍힌다) 물리적으로 다른 shellWin 두 개가
// 생긴다 — startCanvasFeed()의 WS 캔버스 푸시 핸들러는 모듈 전역 shellWin을
// "그때그때" 읽으므로, 이 프로브가 캡처해 둔 shellWin과 실제로 카드가
// 도착하는 shellWin이 레이스에 따라 서로 다른 창이 될 수 있다(카드가
// 실제로는 화면 어딘가에 떴는데 이 프로브만 못 보는 결함 — 앱 결함이
// 아니라 프로브 결함이다). 이 프로브는 fast-path 문법에 안 걸리는 대화체
// 질의만 쓰므로(아래 QUERY 참고) app-side stockEntityIndex(fast-path
// 그레마용, autostart가 채운다)에 애초에 의존하지 않는다 — 종목 식별은
// 백엔드(포트 8010)가 이미 부팅 때 자체적으로 채운 InstrumentIdentityIndex가
// 담당하며, 이건 app autostart와 무관하다. 그래서 autostart를 꺼도 안전하다.

process.env.ATHENA_NO_AUTOSTART = '1';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const OUT_DIR = path.join(__dirname, 'captures');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PROFILE = path.join(__dirname, '.probe-card-landing-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// fast-path 문법(restDatasetRunner.buildQuoteDataset/buildChartDataset)에
// 안 걸리는 대화체 질의 — 반드시 claude -p 모델 경로로 간다.
const QUERY = process.argv[2] || '삼성전자 지금 추이가 어때';

const AUDIT_LOG = path.join(os.homedir(), '.athena', 'audit', 'kiwoom-selector.jsonl');
const TIMING_LOG = path.join(os.homedir(), '.athena', 'audit', 'kiwoom-selector-timing.jsonl');

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try { return JSON.parse(l); } catch { return { _unparsed: l }; }
    });
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  shellWin.show();
  shellWin.focus();
  // ATHENA_NO_AUTOSTART=1이라 app-side Kiwoom 종목명 인덱스 갱신 자체가 안
  // 돈다 — 위 주석대로 이 프로브는 그 인덱스에 의존하지 않으므로 기다릴
  // 이유가 없다. 창 안정화만 짧게 기다린다.
  await wait(1500);

  const auditBefore = readJsonl(AUDIT_LOG);
  const timingBefore = readJsonl(TIMING_LOG);

  await shellWin.webContents.executeJavaScript(`
    window.__canvasResults = [];
    window.__unsubCanvas = window.athena.on('athena:add-canvas-live', (result) => {
      window.__canvasResults.push(result);
    });
    undefined;
  `);

  const startedAt = Date.now();
  const result = await shellWin.webContents.executeJavaScript(
    `window.athena.invoke('athena__render_canvas', ${JSON.stringify({ source: 'live', query: QUERY, expand: true })})`,
  );
  const elapsedMs = Date.now() - startedAt;
  await wait(1000); // add-canvas-live IPC가 도착할 시간을 준다

  const canvasResults = await shellWin.webContents.executeJavaScript('window.__canvasResults');
  await shellWin.webContents.executeJavaScript(
    'window.__unsubCanvas && window.__unsubCanvas(); undefined',
  );

  const domState = await shellWin.webContents.executeJavaScript(`(() => {
    const grid = document.getElementById('grid');
    const cards = grid ? Array.from(grid.querySelectorAll('.card')) : [];
    const notices = Array.from(document.querySelectorAll('.canvas-live-notice, .live-notice'))
      .map((el) => el.textContent);
    return {
      cardCount: cards.length,
      cardClasses: cards.map((c) => c.className),
      notices,
    };
  })()`);

  const img = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, 'probe-card-landing.png'), img.toPNG());

  const auditAfter = readJsonl(AUDIT_LOG);
  const timingAfter = readJsonl(TIMING_LOG);
  const auditDelta = auditAfter.slice(auditBefore.length);
  const timingDelta = timingAfter.slice(timingBefore.length);

  const summary = {
    query: QUERY,
    elapsedMs,
    result: {
      ok: result && result.ok,
      source: result && result.source,
      error: result && result.error,
      answerText: result && result.answerText,
      canvasTypes: result && result.canvasTypes,
    },
    canvasResultsFromIpc: canvasResults,
    domState,
    auditDeltaCount: auditDelta.length,
    auditDelta,
    timingDeltaCount: timingDelta.length,
    timingDelta,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'probe-card-landing.json'),
    JSON.stringify(summary, null, 1),
  );
  console.log('[probe-card-landing]', JSON.stringify(summary, null, 1));

  const landed = domState.cardCount > 0;
  console.log(`[probe-card-landing] 카드 랜딩: ${landed ? 'OK' : 'FAIL'} (cardCount=${domState.cardCount})`);
  app.exit(landed ? 0 : 1);
}

app.whenReady().then(main).catch((e) => {
  console.error('[probe-card-landing] 치명적 실패:', e);
  fs.writeFileSync(path.join(OUT_DIR, 'probe-card-landing-fatal.log'), String((e && e.stack) || e));
  app.exit(1);
});
