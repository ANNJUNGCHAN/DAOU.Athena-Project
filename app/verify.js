// 검증 스크립트. `npm run verify` (= electron verify.js)로 실행한다.
// main.js를 모듈로 불러와 실제 앱과 동일한 창 생성 로직을 재사용하고,
// - capturePage() 스크린샷 (app/captures/)
// - 셸 창 3영역(현재 2영역) 폭 계약 · 배치 · 최대화 의미론
// - 접근성 3종 강제 적용 스크린샷 (CDP Emulation.setEmulatedMedia)
// 2026-08-24 리프 1.2.1: "점→캔버스 확장/수축 rAF 프레임 실측"과 "두 창 getBounds()
// 독립성"은 측정 대상 자체가 사라져 빠졌다(창 모델 전환 — 각 검증 블록 주석 참조).
// 을 수행하고 app/captures/VERIFY-REPORT.json 에 원본 수치를 남긴다.

// main.js를 라이브러리로 불러올 때는 자동 기동(app.whenReady().then(createWindows))을
// 막아야 한다 — verify.js가 createWindows()를 직접, 통제된 시점에 호출한다.
process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

const { app, ipcMain, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
// 지표 행 수의 단일 출처 — 검증이 숫자를 따로 갖지 않는다(2026-08-25).
const INDICATOR_DEFS_LENGTH = require('./lib/chart-indicator-registry').INDICATOR_DEFS.length;

const CAPTURES = path.join(__dirname, 'captures');
if (!fs.existsSync(CAPTURES)) fs.mkdirSync(CAPTURES, { recursive: true });

// ---------- 검증 전용 프로필 — 시작 상태를 이 머신에 맡기지 않는다 ----------
// 실측으로 드러난 결함이다(2026-08-17). `lib/main/`의 네 모듈이 전부
// `app.getPath('userData')` 아래를 읽는다 — `onboarding.js`(온보딩 진행),
// `accounts.js`, `cli-accounts.js`, `secrets.js`. 그래서 **검증 결과가 이 머신에
// 무엇이 등록돼 있느냐에 따라 달라졌다.**
//
// 실제로 일어난 일: 계좌가 미등록이라 `chat.js`가 `#app`을 숨긴 채 온보딩
// (`#onboard`)을 띄웠고, 그 상태로 검증 5~8이 **숨은 DOM에 대고** 이벤트를
// 쐈다. 단언은 전부 true였지만 같은 실행의 스크린샷
// (`10-e2e-3-done-autogrow.png`)에는 대화 이력이 아니라 온보딩 계좌 화면이
// 찍혀 있었다. 자동 성장도 죽어 있었다 — `startOnboarding()`이
// `manualOverride=true`를 걸고, 숨은 `#history`의 `scrollHeight`는 0이라
// `measureNeededHeight()`가 기본 높이만 돌려준다.
//
// userData를 검증 전용 디렉토리로 갈아끼우고 온보딩을 완료로 심어 **항상 같은
// 시작 상태**에서 잰다. 개인 프로필은 건드리지 않는다(백업·복원도 필요 없다).
// 대가: 계좌·MCP 목록이 빈 상태로 검증된다. 검증 7·8은 카드의 **존재와 경계**를
// 보는 것이라 유효하지만, 데이터가 찬 상태의 증거는 `npm run verify:settings-cards`
// 쪽이다(캡처 11장). 두 검증의 역할이 다르다.
const VERIFY_PROFILE = path.join(__dirname, '.verify-profile');
fs.rmSync(VERIFY_PROFILE, { recursive: true, force: true });
fs.mkdirSync(VERIFY_PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(VERIFY_PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }, null, 2),
  'utf-8'
);
app.setPath('userData', VERIFY_PROFILE);

// Codex 설정 격리 — codex-config.js는 userData가 아니라 CODEX_HOME/config.toml에
// 직접 쓴다(2026-08-18 실결선). 검증15 확장이 실제 파일 쓰기를 하므로, 이 머신의
// 진짜 ~/.codex/config.toml을 절대 건드리면 안 된다. cli-accounts.js의
// detectCodex()도 이 값을 읽으므로 require('./main.js')보다 먼저 세팅한다 —
// Codex가 이 격리 디렉토리에선 항상 미연결로 보이지만, 검증7의 모델 패널
// 단언(modelPanelHasClaudeAccountRow 등)은 Claude 쪽만 보므로 간섭이 없다.
process.env.CODEX_HOME = path.join(VERIFY_PROFILE, '.codex-home');
fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });

const DEBUGLOG = path.join(CAPTURES, 'verify-debug.log');
fs.writeFileSync(DEBUGLOG, `start ${new Date().toISOString()}\n`);
function dlog(msg) { fs.appendFileSync(DEBUGLOG, `${new Date().toISOString()} ${msg}\n`); }
process.on('uncaughtException', (err) => dlog('uncaughtException: ' + (err && err.stack || err)));
process.on('unhandledRejection', (err) => dlog('unhandledRejection: ' + (err && err.stack || err)));

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function stats(timestamps) {
  const deltas = [];
  for (let i = 1; i < timestamps.length; i++) deltas.push(timestamps[i] - timestamps[i - 1]);
  const sorted = [...deltas].sort((a, b) => a - b);
  const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);
  return {
    frameCount: timestamps.length,
    p50: pct(50), p95: pct(95),
    max: sorted.length ? sorted[sorted.length - 1] : null,
    min: sorted.length ? sorted[0] : null,
  };
}

// 2026-08-19 QA 결함 #2 원인: capturePage()는 컴포지터가 "지금 들고 있는" 프레임을
// 돌려준다 — 직전 DOM/캔버스 변경(특히 lightweight-charts 같은 rAF 기반 캔버스
// 재도장)이 아직 커밋되지 않았으면 이전 프레임이 그대로 찍힌다. 실측: 19-chart-
// card.png와 20-live-chart-card.png가 MD5까지 완전히 동일했다 — 카드 제목 텍스트가
// 달랐는데도 픽셀이 같았다는 건 캡처 자체가 새 프레임을 못 받은 것이지 렌더가
// 실제로 실패한 게 아니다(각 검증의 executeJavaScript 프로브는 옳은 값을 읽었다).
// 캡처 직전 rAF 2회를 기다려 컴포지터가 최신 프레임을 실제로 제출했음을 강제한다.
// captureLog는 재발 방지 단언(§검증17)이 읽는다 — 같은 창을 연속으로 찍은 캡처가
// 완전히 동일한 PNG가 되면 캡처 타이밍 회귀로 본다.
const captureLog = [];
async function shot(win, name) {
  await win.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
  );
  const img = await win.webContents.capturePage();
  const buf = img.toPNG();
  fs.writeFileSync(path.join(CAPTURES, name), buf);
  captureLog.push({ name, hash: crypto.createHash('md5').update(buf).digest('hex'), winTitle: win.getTitle() });
  return img.getSize();
}

// 2026-08-24 리프 1.3.2 — **렌더된 픽셀**의 채도를 잰다.
// 소스에 색을 안 썼다는 것과 화면에 색이 안 나온다는 것은 다른 주장이다. 이 저장소는
// 그 차이로 두 번 데였다(잔류 blur가 데이터를 흐렸고, 죽은 유리 단계가 토큰에만 있었다).
// nativeImage.toBitmap()은 BGRA 원본을 준다 — 디코더를 끼지 않고 실제 합성 결과를 읽는다.
//
// 투명창이라 창 밖 영역은 alpha 0으로 온다. 불투명 픽셀만 세야 배경이 통계를 희석하지 않는다.
async function measurePixels(win) {
  await win.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
  );
  const img = await win.webContents.capturePage();
  const bmp = img.toBitmap();
  let opaque = 0, chromaSum = 0, maxChroma = 0, bluish = 0;
  for (let i = 0; i < bmp.length; i += 4) {
    const b = bmp[i], g = bmp[i + 1], r = bmp[i + 2], a = bmp[i + 3];
    if (a < 200) continue;
    opaque += 1;
    // 채도 = max(r,g,b) - min(r,g,b). 무채색(백/회/흑)은 0이다.
    const c = Math.max(r, g, b) - Math.min(r, g, b);
    chromaSum += c;
    if (c > maxChroma) maxChroma = c;
    // 바이저 판정 — 참조 렌더 실측에 쓴 것과 **같은 기준**이다
    // (ui/.kiwoome-extract/sample-visor.js): 파랑 지배 + 충분히 진함.
    if (b > r + 45 && b > g + 45 && b > 70) bluish += 1;
  }
  return {
    size: img.getSize(),
    opaquePixels: opaque,
    meanChroma: opaque ? Number((chromaSum / opaque).toFixed(2)) : null,
    maxChroma,
    bluishPixels: bluish,
    bluishRatio: opaque ? Number((bluish / opaque).toFixed(4)) : null,
  };
}

async function forceMedia(win, features) {
  const wc = win.webContents;
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features });
}

async function clearMedia(win) {
  const wc = win.webContents;
  await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
  if (wc.debugger.isAttached()) wc.debugger.detach();
}

async function waitForChatBooted(shellWin, timeoutMs = 5000) {
  const probe = `(() => {
    const vis = (id) => { const n = document.getElementById(id); return !!n && !n.hidden; };
    return { boot: vis('boot'), app: vis('app'), onboard: vis('onboard'), settings: vis('settings') };
  })()`;
  const t0 = Date.now();
  let panels = null;
  while (Date.now() - t0 < timeoutMs) {
    panels = await shellWin.webContents.executeJavaScript(probe);
    if (!panels.boot && (panels.app || panels.onboard)) break;
    await wait(100);
  }
  const booted = !!panels && !panels.boot && (panels.app || panels.onboard);
  const visibleCount = panels
    ? ['app', 'onboard', 'settings'].filter((k) => panels[k]).length
    : 0;
  return {
    booted,
    mode: booted ? (panels.app ? 'app' : 'onboard') : null,
    exactlyOneModeVisible: visibleCount === 1,
    panels,
  };
}

// 부팅 4단계 재정의(2026-08-18) 실측 — 확정된 채팅바의 입력줄에 ATHENA가 적혔다가
// 지워지고 placeholder로 돌아오는지, 부팅이 끝날 때까지 DOM을 60ms 간격으로
// 표집한다. 스크린샷은 타이밍 레이스가 있어 상태 자체를 잰다. reduced-motion
// 환경이면 시퀀스가 통째로 생략되는 게 스펙이므로 그 사실을 함께 기록한다.
async function traceBootBar(shellWin, timeoutMs = 5000) {
  const probe = `(() => {
    const boot = document.getElementById('boot');
    const name = document.getElementById('bootName');
    const ph = document.getElementById('bootPh');
    return {
      booting: !!boot && !boot.hidden,
      name: name ? name.textContent : '',
      phVisible: !!ph && !ph.hidden,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  })()`;
  const t0 = Date.now();
  let sawFullName = false;
  let sawPhAfterName = false;
  let maxName = '';
  let reducedMotion = false;
  while (Date.now() - t0 < timeoutMs) {
    let s;
    try { s = await shellWin.webContents.executeJavaScript(probe); } catch { break; }
    reducedMotion = s.reducedMotion;
    if (!s.booting) break;
    if (s.name.length > maxName.length) maxName = s.name;
    if (s.name === 'ATHENA') sawFullName = true;
    if (sawFullName && s.name === '' && s.phVisible) sawPhAfterName = true;
    await wait(60);
  }
  return {
    sawFullName,
    sawPhAfterName,
    maxName,
    reducedMotion,
    // 판정 — 모션이 살아 있으면 "이름을 다 썼고, 지운 뒤 placeholder로 돌아왔다"
    // 둘 다 관측돼야 한다. reduced-motion이면 생략 자체가 스펙 준수다.
    pass: reducedMotion || (sawFullName && sawPhAfterName),
  };
}

app.whenReady().then(async () => {
  dlog('whenReady fired');
  const report = { startedAt: new Date().toISOString() };
  // 검증 블록들이 이미 계산하는 명시적 pass 불리언을 모아 exit code에 반영한다
  // (이전엔 리포트 JSON에만 남고 CI는 항상 exit 0으로 끝났다). 애매한 항목
  // (프레임 fps 수치, 상태 의존적 정보성 필드 등)은 아래 각 지점에서 의도적으로
  // 제외하고 주석으로 남긴다 — 리포트 JSON 형상 자체는 바꾸지 않는다.
  const failures = [];
  function assertOk(label, cond) {
    if (!cond) failures.push(label);
  }
  const mainMod = require('./main.js');
  dlog('main.js required');

  // ---------- 창 생성 (main.js와 동일 경로) ----------
  await mainMod.createWindows();
  dlog('createWindows done');
  const { shellWin, orbWin } = mainMod.getWins();
  const layout = mainMod.getLayout();
  report.layout = layout;

  const bootBarPromise = traceBootBar(shellWin);
  await wait(200);
  report.bootChatOnly = {
    openWindowCount: BrowserWindow.getAllWindows().length,
    chatVisibleAtBoot: shellWin.isVisible(),
    orbVisibleAtBoot: !!orbWin && orbWin.isVisible(),
  };
  dlog('before shot 01'); const s1 = await shot(shellWin, '01-boot-sequence.png'); dlog('after shot 01');
  const boot = await waitForChatBooted(shellWin);
  const bootBar = await bootBarPromise;
  dlog('boot done, before shot 02'); const s2 = await shot(shellWin, '02-chat-only-idle.png'); dlog('after shot 02');
  report.bootChatOnly.shots = { boot: s1, idle: s2 };
  report.bootChatOnly.chatBootedAfterBoot = boot.booted;
  report.bootChatOnly.bootMode = boot.mode;
  report.bootChatOnly.exactlyOneModeVisible = boot.exactlyOneModeVisible;
  report.bootChatOnly.panels = boot.panels;
  // 1b — 부팅 4단계 재정의(2026-08-18): 채팅바가 제 이름을 쓰고 되돌아온다
  report.bootChatOnly.bootBar = bootBar;
  report.bootChatOnly.bootBarWritesName = bootBar.pass;
  // 검증 전용 프로필은 온보딩을 완료로 심는다(파일 상단 참조) — 그러므로 여기서
  // 기대하는 모드는 'app'이다. 'onboard'가 나오면 프로필 격리가 깨진 것이고,
  // 그 상태의 검증 5~8은 숨은 DOM을 재는 것이라 믿으면 안 된다.
  report.bootChatOnly.bootedIntoChatMode = boot.mode === 'app';
  console.log(
    '[verify] 검증1 완료 — 열린 OS 창 수:', report.bootChatOnly.openWindowCount,
    '| 셸 창 부팅:', boot.booted, '| 모드:', boot.mode,
    '| 모드 배타성:', boot.exactlyOneModeVisible,
    '| 부팅바 이름쓰기:', JSON.stringify(bootBar)
  );
  assertOk('boot: exactly two OS windows (셸 + 알림 오브 — GLOSSARY §1)', report.bootChatOnly.openWindowCount === 2);
  assertOk('boot: shell window visible at boot', report.bootChatOnly.chatVisibleAtBoot === true);
  assertOk('boot: orb window visible at boot (상시 표시가 사양이다)', report.bootChatOnly.orbVisibleAtBoot === true);
  assertOk('boot: chat reached a mode after boot sequence', report.bootChatOnly.chatBootedAfterBoot === true);
  assertOk('boot: exactly one mode panel visible (no overlap)', report.bootChatOnly.exactlyOneModeVisible === true);
  assertOk('boot: boot bar wrote full name then returned to placeholder', report.bootChatOnly.bootBarWritesName === true);
  assertOk('boot: booted into chat(app) mode, not onboarding (verify profile isolation)', report.bootChatOnly.bootedIntoChatMode === true);

  // ---------- 검증 1c: fail-closed REST 영수증 실제 표시 ----------
  // 거절 요청은 캔버스가 없으므로 이 영수증이 유일한 피드백이다. 매 회 온보딩
  // 패널이 앱을 가린 상태를 재현한 뒤, production main→IPC→chat DOM→doubleRAF
  // paint ack를 여섯 번 반복해 모드 복구와 반복 waiter 정리를 함께 검증한다.
  const receiptPaints = [];
  for (let index = 0; index < 6; index += 1) {
    await shellWin.webContents.executeJavaScript(`
      (() => {
        document.getElementById('app').hidden = true;
        document.getElementById('onboard').hidden = false;
      })()
    `);
    const receiptStartedAt = Date.now();
    const paint = await mainMod.emitRestReceiptAndWaitForPaint(
      '지원하지 않는 요청이라 캔버스에 표시하지 않았습니다.',
      { timeoutMs: 1500 },
    );
    const surface = await shellWin.webContents.executeJavaScript(`
      (() => {
        const appPanel = document.getElementById('app');
        const onboard = document.getElementById('onboard');
        const receipts = [...document.querySelectorAll('.rest-receipt')];
        const last = receipts[receipts.length - 1];
        const rect = last && last.getBoundingClientRect();
        return {
          appVisible: !!appPanel && !appPanel.hidden,
          onboardingHidden: !!onboard && onboard.hidden,
          receiptCount: receipts.length,
          nonzero: !!rect && rect.width > 0 && rect.height > 0,
        };
      })()
    `);
    receiptPaints.push({
      elapsedMs: Date.now() - receiptStartedAt,
      verifiedVisible: paint.verifiedVisible === true,
      ...surface,
    });
  }
  report.restReceiptPaint = { repeats: receiptPaints };
  const receiptPaintPass = receiptPaints.length === 6 && receiptPaints.every((item, index) => (
    item.verifiedVisible && item.appVisible && item.onboardingHidden
    && item.nonzero && item.receiptCount === index + 1 && item.elapsedMs < 1500
  ));
  assertOk('restReceiptPaint: six hidden-mode receipts become visible with bounded paint ack', receiptPaintPass);
  await shellWin.webContents.executeJavaScript(`
    document.querySelectorAll('.rest-receipt').forEach((node) => node.remove())
  `);

  // ---------- 검증 1d: OS/main timer 지연에도 3초 전 보편 피드백 ----------
  // T+2100부터 메인 이벤트 루프를 약 600ms 막아 T+2200 watchdog 자체가 늦게
  // 실행되는 최악 조건을 만든다. 업스트림은 끝나지 않으며 runner의 T+3000
  // abort로 정리된다. 그 사이 payload-free 지연 영수증이 실제로 먼저 그려져야 한다.
  const delayedFeedbackDataset = {
    datasetId: 'verify-delayed-feedback',
    question: '지연 피드백 검증',
    items: [{
      itemId: 'verify-delayed-feedback-1',
      ordinal: 1,
      operationRef: 'detail:ka10001:current_trading',
      args: { stk_cd: '005930' },
    }],
    firstCanvasDeadlineMs: 3000,
  };
  const delayedFetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  // 2026-08-24 리프 1.3.1 — 이 검사가 **앱을 오진하고 있었다.**
  //
  // 증상: 5회 실행 중 2회가 3130~3196ms로 실패했다. 옛 판은 그걸 "앱이 3초 예산을
  // 넘겼다"로 보고했다. 계측을 넣어 실제 스톨 구간을 재보니 원인이 달랐다:
  //
  //   run  총시간   스톨 시작   스톨 길이   스톨 종료   **앱이 쓴 시간**  판정
  //   1    2737     2101       600        2701       36ms            통과
  //   2    2748     2112       600        2712       36ms            통과
  //   3    3196     **2573**   600        3173       **23ms**        실패
  //
  // 실패한 run 3에서 앱은 **가장 빨랐다**(23ms). 넘긴 이유는 하네스 자신의
  // `setTimeout(2100)`이 473ms 늦게 실행됐기 때문이다 — 공유 데스크톱에서 타이머가
  // 밀린 것이고 앱과 무관하다. 즉 옛 오라클은 하네스의 스케줄 지터를 앱 결함으로
  // 번역하고 있었다. 이런 거짓 양성은 결국 "이 검사는 원래 가끔 빨개진다"는 학습을
  // 만들고, 그때 진짜 회귀가 섞여 들어온다.
  //
  // 고친 방향(완화가 아니라 분리):
  //  ① 하네스가 자기 사양(2100±60에 시작, 600±60 지속)을 지켰는지 먼저 잰다.
  //  ② 사양을 못 지킨 시행은 **무효 시행**이고 최대 3회까지 다시 시도한다.
  //  ③ 유효 시행을 한 번도 못 만들면 **조용히 통과시키지 않고** 별도 사유로 실패시킨다
  //     (환경 불일치는 증거가 아니라 검증 실패다).
  //  ④ 3초 예산 단언은 그대로 두고, **앱이 스톨 이후 쓴 시간**에도 별도 상한을 건다 —
  //     총시간이 우연히 맞아떨어져도 앱이 느려지면 잡힌다(옛 판에는 없던 가드다).
  const STALL_SPEC = { scheduledAtMs: 2100, requestedMs: 600, toleranceMs: 60 };
  const APP_LATENCY_BUDGET_MS = 400; // 실측 23~133ms의 3배 — 회귀는 잡고 지터는 통과시킨다
  const delayedTrials = [];
  let delayedTrial = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const stall = { ...STALL_SPEC, startedAtMs: null, actualMs: null };
    const startedAt = Date.now();
    const mainDelay = setTimeout(() => {
      const enteredAt = Date.now();
      stall.startedAtMs = enteredAt - startedAt;
      const blockedUntil = enteredAt + stall.requestedMs;
      while (Date.now() < blockedUntil) { /* intentional verify-only event-loop delay */ }
      stall.actualMs = Date.now() - enteredAt;
    }, stall.scheduledAtMs);
    const result = await mainMod.runDirectRestDataset(delayedFeedbackDataset, true, {
      fetchImpl: delayedFetch,
    });
    clearTimeout(mainDelay);

    const stallEndedAtMs = stall.startedAtMs === null ? null : stall.startedAtMs + stall.actualMs;
    const trial = {
      attempt,
      elapsedMs: result.firstFeedbackMs,
      totalRunMs: Date.now() - startedAt,
      feedbackOk: result.feedbackOk,
      receiptPainted: result.answerPaintedByMain,
      renderedCount: result.renderedCount,
      stall,
      stallEndedAtMs,
      // 스톨이 끝난 뒤 앱이 영수증을 띄우기까지 쓴 시간 — 이게 앱의 몫이다.
      appLatencyAfterStallMs: stallEndedAtMs === null || result.firstFeedbackMs == null
        ? null
        : Math.round(result.firstFeedbackMs - stallEndedAtMs),
      stallWithinSpec: stall.actualMs !== null && stall.startedAtMs !== null
        && Math.abs(stall.actualMs - stall.requestedMs) <= stall.toleranceMs
        && Math.abs(stall.startedAtMs - stall.scheduledAtMs) <= stall.toleranceMs,
    };
    delayedTrials.push(trial);
    if (trial.stallWithinSpec) { delayedTrial = trial; break; }
    dlog(`delayedRestFeedback: 시행 ${attempt} 무효(스톨 시작 ${stall.startedAtMs}ms, 길이 ${stall.actualMs}ms) — 재시도`);
    // 렌더러에 쌓인 영수증을 치우고 다음 시행으로 — 시행 간 상태가 새면 안 된다.
    await shellWin.webContents.executeJavaScript(
      "document.querySelectorAll('.rest-receipt').forEach((node) => node.remove())"
    );
    await wait(200);
  }

  report.delayedRestFeedback = {
    trials: delayedTrials,
    validTrial: delayedTrial,
    // 유효 시행을 못 만든 것은 환경 불일치다 — 통과가 아니라 별도 실패로 보고한다.
    producedValidTrial: delayedTrial !== null,
  };
  assertOk(
    'delayedRestFeedback: 하네스가 사양대로 스톨을 재현했다(3회 안에 유효 시행 확보)',
    report.delayedRestFeedback.producedValidTrial === true,
  );
  assertOk(
    'delayedRestFeedback: 600ms main scheduling delay still paints truthful receipt before 3000ms',
    !!delayedTrial
      && delayedTrial.feedbackOk === true
      && delayedTrial.receiptPainted === true
      && delayedTrial.elapsedMs < 3000
      && delayedTrial.renderedCount === 0,
  );
  assertOk(
    `delayedRestFeedback: 스톨 해제 후 앱 지연이 ${APP_LATENCY_BUDGET_MS}ms 미만이다(앱 자체 회귀 가드)`,
    !!delayedTrial
      && delayedTrial.appLatencyAfterStallMs !== null
      && delayedTrial.appLatencyAfterStallMs < APP_LATENCY_BUDGET_MS,
  );
  await shellWin.webContents.executeJavaScript(`
    document.querySelectorAll('.rest-receipt').forEach((node) => node.remove())
  `);

  // 허용 오차 2px — Windows에서 setBounds() 요청값과 getBounds() 실측값 사이에
  // DPI 반올림으로 1px 안팎의 편차가 실측된다(기능적 결함 아님). 옛 판은 검증 3
  // 안에서 정의했는데, 이제 검증 2부터 쓰므로 앞으로 끌어올렸다.
  const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

  // ---------- 검증 2: 중앙 캔버스는 늘 떠 있다 (2026-08-24 리프 1.2.1 재정의) ----------
  // 옛 검증 2는 "점 → 캔버스 확장/수축, 프레임 실측"이었다: getDotScreenPoint()로
  // 점의 화면 좌표를 재고, expandCanvasWindow()가 캔버스 **창**을 원형 clip-path로
  // 550ms 동안 열고, collapseCanvasWindow()가 닫고, 그 사이 rAF 프레임 간격을
  // p50/p95/max로 기록했다. 창이 하나가 되면서 열고 닫을 창이 없다 —
  // 중앙 캔버스는 셸 창의 한 영역이라 부팅 순간부터 떠 있다.
  //
  // 그래서 이 자리에서 재는 것을 바꾼다: **연출 없이도 카드가 실제로 보이는가.**
  // 프레임 수치(report.expand/report.collapse)는 측정 대상이 사라져 리포트에서도
  // 뺀다 — 없는 것을 0으로 채워 넣으면 다음 사람이 "성능이 완벽하다"로 읽는다.
  shellWin.webContents.send('athena:add-canvas', { type: 'stream' });
  await wait(150);
  shellWin.webContents.send('athena:add-canvas', { type: 'reader' });
  await wait(150);
  shellWin.webContents.send('athena:add-canvas', { type: 'table' });
  await wait(300);
  await shot(shellWin, '03-shell-canvas-and-chat.png');

  report.canvasAlwaysVisible = await shellWin.webContents.executeJavaScript(`(() => {
    const region = document.getElementById('canvasRegion');
    const chat = document.getElementById('chatRegion');
    const cards = [...document.querySelectorAll('#grid .card')];
    const r = region.getBoundingClientRect();
    const c = chat.getBoundingClientRect();
    const mosaic = document.getElementById('mosaic');
    const sheen = document.querySelector('#canvasRegion .glass-sheen');
    return {
      cardCount: cards.length,
      allCardsNonzero: cards.every((n) => {
        const b = n.getBoundingClientRect();
        return b.width > 0 && b.height > 0;
      }),
      canvasRegionNonzero: r.width > 0 && r.height > 0,
      chatRegionWidth: Math.round(c.width),
      // 캔버스가 채팅 왼쪽에 있다(영역 순서 계약).
      canvasLeftOfChat: r.left < c.left,
      // 옛 확장 연출이 남긴 잔재가 없어야 한다 — clipPath 인라인은 카드를 원형으로
      // 잘라 데이터를 감추고, 잔류 blur는 숫자를 흐린다(soul.md §8 정보 정직성).
      // 두 값 모두 **인라인 스타일이 비어 있는지**를 본다: 애니메이션이 사라졌으니
      // 이 자리를 쓰는 코드 자체가 없어야 한다.
      noInlineClipPath: mosaic.style.clipPath === '',
      noInlineBackdropFilter: !sheen || sheen.style.backdropFilter === '',
      // 정지 상태 규범 — 계산값 blur도 0px여야 한다(canvas.css .glass-sheen).
      computedSheenFilter: sheen ? getComputedStyle(sheen).backdropFilter : null,
    };
  })()`);
  console.log('[verify] 검증2(중앙 캔버스 상시 표시):', JSON.stringify(report.canvasAlwaysVisible));
  assertOk('canvas: three fixture cards rendered with nonzero boxes', report.canvasAlwaysVisible.cardCount === 3 && report.canvasAlwaysVisible.allCardsNonzero === true);
  assertOk('canvas: canvas region is left of chat region', report.canvasAlwaysVisible.canvasLeftOfChat === true);
  assertOk('canvas: chat region is 400px wide (never collapses)', near(report.canvasAlwaysVisible.chatRegionWidth, 400, 2));
  assertOk('canvas: no residual expand-animation clip-path', report.canvasAlwaysVisible.noInlineClipPath === true);
  assertOk('canvas: no residual inline backdrop-filter', report.canvasAlwaysVisible.noInlineBackdropFilter === true);
  assertOk('canvas: sheen rests at blur(0px)', /blur\(0px\)/.test(String(report.canvasAlwaysVisible.computedSheenFilter || '')));

  try {
    const capScript = path.join(__dirname, 'scripts', 'capture.ps1');
    const cb = shellWin.getBounds();
    execFileSync('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', capScript,
      '-x', String(cb.x), '-y', String(cb.y), '-w', String(cb.width), '-h', String(cb.height),
      '-out', path.join(CAPTURES, '03c-shell-OS-composited.png'),
    ], { stdio: 'pipe', windowsHide: true, timeout: 8000 });
    report.osCaptureAttempted = { ok: true };
  } catch (err) {
    report.osCaptureAttempted = { ok: false, error: String(err && err.message || err) };
    dlog('OS capture failed: ' + (err && err.message || err));
  }

  // ---------- 검증 3: 셸 창 이동/리사이즈가 영역 계약을 지킨다 (리프 1.2.1 재정의) ----------
  // 옛 검증 3은 "두 창 독립 이동/리사이즈"였다 — 캔버스 창을 옮겨도 대화 창이
  // 안 따라오고, 대화 창 높이를 바꿔도 캔버스 창이 그대로인지를 봤다. 창이
  // 하나면 독립시킬 상대가 없다. 대신 **창을 움직여도 안의 영역 계약이 유지되는지**를
  // 잰다: 채팅 400px은 창 폭이 줄어도 줄지 않고, 줄어드는 쪽은 캔버스다.
  //
  // 직접 setBounds는 반드시 noteAppBounds로 "앱 주도"임을 표시한다 — 안 하면
  // 스냅 대상화(2026-08-18)의 OS 배치 감지가 이 이동을 Win+방향키 스냅으로
  // 오인해 창을 정착시켜 단언이 설계된 동작에 의해 깨진다.
  const regionWidths = () => shellWin.webContents.executeJavaScript(`(() => {
    const c = document.getElementById('canvasRegion').getBoundingClientRect();
    const t = document.getElementById('chatRegion').getBoundingClientRect();
    return { canvas: Math.round(c.width), chat: Math.round(t.width) };
  })()`);

  const shellInitial = shellWin.getBounds();
  const widthsInitial = await regionWidths();

  shellWin.setBounds({ ...shellInitial, x: shellInitial.x + 80 });
  mainMod.noteAppBounds(shellWin);
  await wait(150);
  const afterMove = shellWin.getBounds();
  const widthsAfterMove = await regionWidths();

  // 창 폭을 240 줄인다 — 채팅은 그대로, 캔버스만 줄어야 한다.
  const narrowW = shellInitial.width - 240;
  shellWin.setBounds({ ...afterMove, width: narrowW });
  mainMod.noteAppBounds(shellWin);
  await wait(200);
  const widthsAfterNarrow = await regionWidths();

  // 원위치
  shellWin.setBounds(shellInitial);
  mainMod.noteAppBounds(shellWin);
  await wait(150);

  report.regionContract = {
    shellInitial, afterMove, narrowW,
    widthsInitial, widthsAfterMove, widthsAfterNarrow,
    moveKeepsWidths:
      near(afterMove.x, shellInitial.x + 80)
      && near(widthsAfterMove.canvas, widthsInitial.canvas)
      && near(widthsAfterMove.chat, widthsInitial.chat),
    chatNeverShrinks: near(widthsAfterNarrow.chat, widthsInitial.chat, 2),
    canvasAbsorbsShrink: widthsAfterNarrow.canvas <= widthsInitial.canvas - 200,
  };
  console.log('[verify] 검증3(영역 계약):', JSON.stringify(report.regionContract));
  assertOk('regionContract: moving the window keeps both region widths', report.regionContract.moveKeepsWidths === true);
  assertOk('regionContract: chat region never shrinks when the window narrows', report.regionContract.chatNeverShrinks === true);
  assertOk('regionContract: canvas region absorbs the shrink', report.regionContract.canvasAbsorbsShrink === true);

  // ---------- 검증 4: 접근성 3종 (CDP Emulation.setEmulatedMedia) ----------
  // 캔버스에 카드가 찬 상태 그대로 캡처한다 — 유리 표면이 실제로 보여야 의미가 있다.
  // 2026-08-24 리프 1.2.1: 창이 하나가 되면서 캡처도 상태당 **한 장**이다. 옛 판은
  // 창마다 한 장씩 총 6장을 찍었는데, 지금 같은 창을 두 번 찍으면 바이트까지
  // 동일한 PNG 두 장이 남고 그건 검증17(캡처 스로틀 회귀 가드)이 잡아야 할
  // 신호와 구별되지 않는다.
  shellWin.webContents.send('athena:add-canvas', { type: 'stream' });
  shellWin.webContents.send('athena:add-canvas', { type: 'table' });
  await wait(300);

  await forceMedia(shellWin, [{ name: 'prefers-reduced-transparency', value: 'reduce' }]);
  await wait(150);
  await shot(shellWin, '05-a11y-reduced-transparency.png');
  await clearMedia(shellWin);

  await forceMedia(shellWin, [{ name: 'prefers-contrast', value: 'more' }]);
  await wait(150);
  await shot(shellWin, '06-a11y-prefers-contrast.png');
  await clearMedia(shellWin);

  await forceMedia(shellWin, [{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await wait(150);
  await shot(shellWin, '07-a11y-reduced-motion.png');
  await clearMedia(shellWin);

  dlog('a11y shots done'); report.accessibilityShotsTaken = [
    '05-a11y-reduced-transparency.png',
    '06-a11y-prefers-contrast.png',
    '07-a11y-reduced-motion.png',
  ];
  console.log('[verify] 접근성 3종 캡처 완료');


  // ---------- 검증 5: 실제 사용자 트리거(Enter) 종단간 플로우 — 3상태 ----------
  // 지금까지는 mainMod 함수를 직접 호출했다. 이번엔 사용자가 실제로 하는 행동
  // (입력 후 Enter)을 그대로 시뮬레이션해 chat.js의 상태 머신과
  // athena__render_canvas 트리거 전체 경로를 검증한다.
  //
  // 2026-08-24 리프 1.2.1: 옛 판은 여기서 **창 높이 자동 성장**을 함께 쟀다
  // (boundsAfterQuery.height > boundsBeforeQuery.height + 2). 채팅이 고정 폭 영역이
  // 된 뒤로는 창이 자라지 않는다 — 자라는 것은 이력의 scrollHeight이고, 넘치면
  // 영역 안에서 스크롤한다. 그래서 "창이 커졌는가" 대신 **"이력이 실제로 늘고
  // 바닥을 따라갔는가"**를 잰다. 창 높이 불변도 함께 단언한다: 옛 자동 성장 경로가
  // 되살아나면 그게 회귀다.
  const boundsBeforeQuery = shellWin.getBounds();
  // 이력이 실제로 늘었는지는 **턴 수**로 잰다. scrollHeight는 못 쓴다: chat.css의
  // `.history > :first-child { margin-top: auto }`가 내용을 바닥에 붙이므로, 내용이
  // 영역보다 짧은 동안 scrollHeight는 clientHeight에 고정된다(첫 실행 실측:
  // 질의 전후 둘 다 633). 옛 판에서 이 지표가 창 높이였던 자리를 그대로 물려받아
  // scrollHeight를 넣었다가 거짓 실패를 봤다 — 실측이 지표를 고친 사례다.
  const turnsBeforeQuery = await shellWin.webContents.executeJavaScript(
    "document.querySelectorAll('#history .turn').length"
  );
  await shellWin.webContents.executeJavaScript(`
    (() => {
      const input = document.getElementById('input');
      input.value = '삼성전자 재무제표랑 공시, 뉴스 보여줘';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })();
  `);
  await wait(350);
  await shot(shellWin, '08-e2e-1-judging.png'); // 상태 1 — 판단 중 (점 breathe, 입력 잠김)
  await wait(500);
  await shot(shellWin, '09-e2e-2-calling.png'); // 상태 2 — 호출 중 (TR 코드 누적)

  // 상태 3(완료)까지 폴링 — .turn-a가 나타날 때까지, 최대 6초
  let e2eDone = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    const found = await shellWin.webContents.executeJavaScript("!!document.querySelector('.turn-a')");
    if (found) { e2eDone = true; break; }
    await wait(150);
  }
  await wait(150);
  // 옛 판은 여기서 두 장을 찍었다(대화 창 10번 · 캔버스 창 11번). 창이 하나면
  // 같은 프레임 두 장이라 한 장으로 접는다 — 셸 한 장에 채팅 이력과 카드가 같이 찍힌다.
  await shot(shellWin, '10-e2e-3-done.png');
  const boundsAfterQuery = shellWin.getBounds();

  const finalTurnText = await shellWin.webContents.executeJavaScript(
    "(() => { const els = document.querySelectorAll('.turn-a'); return els.length ? els[els.length-1].textContent : null; })()"
  );
  const chipCount = await shellWin.webContents.executeJavaScript("document.querySelectorAll('.chip').length");
  const historyState = await shellWin.webContents.executeJavaScript(`(() => {
    const h = document.getElementById('history');
    return {
      scrollHeight: h.scrollHeight,
      clientHeight: h.clientHeight,
      scrollTop: Math.round(h.scrollTop),
      turnCount: h.querySelectorAll('.turn').length,
      // 하단 고정 — 새 턴이 들어오면 바닥을 따라간다(chat.js scrollHistoryToBottom).
      // 내용이 아직 영역보다 짧으면 스크롤 자체가 없으므로 그 경우도 통과로 본다.
      atBottom: h.scrollHeight - h.scrollTop - h.clientHeight < 24,
      overflows: h.scrollHeight > h.clientHeight,
    };
  })()`);

  report.e2eTrigger = {
    reachedDoneState: e2eDone,
    boundsBeforeQuery, boundsAfterQuery,
    turnsBeforeQuery,
    history: historyState,
    // 창은 자라지 않는다(리프 1.2.1). ±2px는 DPI 반올림 허용치.
    windowHeightUnchanged: near(boundsAfterQuery.height, boundsBeforeQuery.height),
    historyGrew: historyState.turnCount > turnsBeforeQuery,
    stuckToBottom: historyState.atBottom,
    finalAnswerText: finalTurnText,
    cardChipCount: chipCount,
  };
  console.log('[verify] 검증5(E2E Enter 트리거):', JSON.stringify(report.e2eTrigger));
  assertOk('e2e: reached done state (.turn-a appeared)', report.e2eTrigger.reachedDoneState === true);
  assertOk('e2e: window height did NOT change (auto-grow is gone)', report.e2eTrigger.windowHeightUnchanged === true);
  assertOk('e2e: history content grew inside the fixed chat region', report.e2eTrigger.historyGrew === true);
  assertOk('e2e: history stuck to bottom after the new turn', report.e2eTrigger.stuckToBottom === true);
  // finalAnswerText/cardChipCount는 fixture 응답 내용에 좌우되는 정보성 필드라
  // 단언에서 뺀다.

  // ---------- 검증 6: 창 크기는 사용자 리사이즈로만 바뀐다 (리프 1.2.1 재정의) ----------
  // 옛 검증 6은 "그립 드래그로 수동 리사이즈"였다 — 대화 창 상단의 #grip을 끌어
  // 창 높이를 키우고, 그동안 하단 입력줄이 화면에 고정(bottomEdgePinned)돼 있는지를
  // 봤다. 그립도, 하단 앵커도, "창 높이 = 이력 높이"라는 전제도 전부 사라졌다.
  // 남은 계약은 훨씬 단순하다: **창 크기를 바꾸는 것은 OS 리사이즈뿐이고, 앱이
  // 그 결과를 되감지 않는다.** 옛 판에서는 자동 성장이 사용자 크기를 덮어쓸 수
  // 있어서 manualOverride라는 별도 장치가 필요했다 — 그 장치가 필요 없어졌다는
  // 것을 여기서 잰다(자동 성장 부활 회귀 가드).
  const beforeResize = shellWin.getBounds();
  shellWin.setBounds({ ...beforeResize, height: beforeResize.height + 120 });
  mainMod.noteAppBounds(shellWin);
  await wait(250);
  const afterResize = shellWin.getBounds();
  // 내용을 더 밀어 넣는다 — 옛 자동 성장이 살아 있었다면 여기서 창이 다시 움직인다.
  await shellWin.webContents.executeJavaScript(`
    (() => {
      const h = document.getElementById('history');
      for (let i = 0; i < 5; i += 1) {
        const line = document.createElement('div');
        line.className = 'turn verify6-filler';
        const t = document.createElement('div');
        t.className = 'turn-a';
        t.textContent = 'verify6 filler ' + i;
        line.appendChild(t);
        h.appendChild(line);
      }
    })();
  `);
  await wait(300);
  const afterContentPush = shellWin.getBounds();
  await shellWin.webContents.executeJavaScript(
    "document.querySelectorAll('.verify6-filler').forEach((n) => n.remove())"
  );
  shellWin.setBounds(beforeResize);
  mainMod.noteAppBounds(shellWin);
  await wait(150);

  report.userResizeRespected = {
    beforeResize, afterResize, afterContentPush,
    resizeApplied: near(afterResize.height, beforeResize.height + 120),
    contentDidNotResizeWindow: near(afterContentPush.height, afterResize.height),
  };
  console.log('[verify] 검증6(사용자 리사이즈 존중):', JSON.stringify(report.userResizeRespected));
  assertOk('userResize: OS resize applied to the shell window', report.userResizeRespected.resizeApplied === true);
  assertOk('userResize: new content does NOT resize the window (auto-grow regression guard)', report.userResizeRespected.contentDidNotResizeWindow === true);

  const winCountBefore = BrowserWindow.getAllWindows().length;
  const chatBoundsBefore = shellWin.getBounds();

  await shellWin.webContents.executeJavaScript("document.getElementById('dot').click()");
  await wait(900);

  const winCountAfterOpen = BrowserWindow.getAllWindows().length;

  // 두 번 눌러도(재오픈이 no-op) nav·카드가 중복되지 않아야 한다
  await shellWin.webContents.executeJavaScript("document.getElementById('dot').click()");
  await wait(600);
  const winCountAfterSecondClick = BrowserWindow.getAllWindows().length;

  const navProbe = await shellWin.webContents.executeJavaScript(`
    (() => {
      const nav = document.getElementById('settingsNav');
      const items = nav ? Array.from(nav.querySelectorAll('.settings-nav-item')) : [];
      return {
        navExists: !!nav,
        navItemCount: items.length,
        navLabels: items.map((b) => { const l = b.querySelector('.settings-nav-label'); return l ? l.textContent.trim() : ''; }),
        screenCardCount: document.querySelectorAll('#settingsGrid .card.screen').length,
      };
    })()
  `);

  function clickNavItemScript(label) {
    return `
    (() => {
      const nav = document.getElementById('settingsNav');
      const items = nav ? Array.from(nav.querySelectorAll('.settings-nav-item')) : [];
      const btn = items.find((b) => { const l = b.querySelector('.settings-nav-label'); return l && l.textContent.trim() === ${JSON.stringify(label)}; });
      if (!btn) return 'NOT FOUND: ${label}';
      btn.click();
      return 'clicked';
    })();
    `;
  }

  const navClickAccounts = await shellWin.webContents.executeJavaScript(clickNavItemScript('계좌'));
  await wait(500);
  const accountsPanelCardCount = await shellWin.webContents.executeJavaScript(
    "document.querySelectorAll('#settingsGrid .card.accounts').length"
  );

  const navClickMcp = await shellWin.webContents.executeJavaScript(clickNavItemScript('MCP 서버'));
  await wait(1000); // mcp-list는 Python CLI 콜드 스폰이라 실측 ~850ms 걸린다(verify-settings.js 주석 참고)
  const mcpPanelCardCount = await shellWin.webContents.executeJavaScript(
    "document.querySelectorAll('#settingsGrid .card.mcp').length"
  );

  const navClickModel = await shellWin.webContents.executeJavaScript(clickNavItemScript('모델'));
  await wait(500);
  const modelPanelProbe = await shellWin.webContents.executeJavaScript(`
    (() => {
      const card = document.querySelector('#settingsGrid .card.model');
      return {
        modelCardCount: document.querySelectorAll('#settingsGrid .card.model').length,
        claudeAccountRows: card ? card.querySelectorAll('.uk-model-accounts .uk-model-account-row').length : 0,
        modelChipCount: card ? card.querySelectorAll('.uk-chip-row .uk-chip').length : 0,
      };
    })()
  `);

  const chatProbe = await shellWin.webContents.executeJavaScript(`
    (() => ({
      // 대화 화면은 물러나고 설정 화면이 그 자리를 차지한다 — 같은 창이 변한 것이다
      appHidden: document.getElementById('app').hidden === true,
      settingsVisible: document.getElementById('settings').hidden === false,
      // 설정은 대화 창 문서 안에 있다 — 별도 문서가 아니다
      url: location.pathname.split('/').pop(),
      // 점은 실제 버튼이어야 한다(장식이 아니라 어포던스)
      dotIsButton: document.getElementById('dot').tagName === 'BUTTON',
      trIdLeak: /au1000[12]/.test(document.body.innerText),
      bearerLeak: /ATHENA_LOCAL_BEARER_TOKEN\s*=/.test(document.body.innerText),
    }))()
  `);
  // 중앙 캔버스는 설정에 관여하지 않는다 — 설정 카드가 #grid에 있으면 안 된다.
  // 창이 하나가 된 뒤(리프 1.2.1)에도 두 영역의 DOM 서브트리는 분리돼 있으므로
  // 이 단언은 그대로 유효하다 — 오히려 한 문서 안이라 섞일 위험이 커져 더 중요해졌다.
  const canvasProbe = await shellWin.webContents.executeJavaScript(`
    (() => ({
      settingsCardsOnCanvas: document.querySelectorAll('#grid .card.accounts, #grid .card.mcp, #grid .card.model, #grid .card.screen').length,
    }))()
  `);
  const chatBoundsWhileOpen = shellWin.getBounds();
  await shot(shellWin, '17-settings-mode.png');

  // Esc로 대화 모드로 돌아온다
  await shellWin.webContents.executeJavaScript(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"
  );
  await wait(600);
  const chatAfterClose = await shellWin.webContents.executeJavaScript(`
    (() => ({
      appVisible: document.getElementById('app').hidden === false,
      settingsHidden: document.getElementById('settings').hidden === true,
      gridEmptied: document.getElementById('settingsGrid').children.length === 0,
    }))()
  `);

  report.settingsSurface = {
    // 핵심 계약 — 설정은 창을 만들지 않는다. 이 창이 변한다.
    // 이 객체의 값은 전부 불리언이어야 한다 — 아래 일괄 단언 루프가 `=== true`로
    // 판정하므로 수치를 섞으면 조용히 실패한다(창 수 자체는 report.bootChatOnly에 있다).
    noNewWindowOnOpen: winCountAfterOpen === winCountBefore,
    windowCountUnchanged: BrowserWindow.getAllWindows().length === winCountBefore,
    noNewWindowOnSecondClick: winCountAfterSecondClick === winCountBefore,
    // 셸 창이 설정 모드로 바뀐다
    renderedInChatWindow: chatProbe.settingsVisible === true && chatProbe.url === 'shell.html',
    chatModeSteppedAside: chatProbe.appHidden === true,
    // 사이드바 nav — 존재 + 항목 5개(화면·계좌·MCP 서버·모델·성향・이력, 채팅→그래프
    // 파이프라인 단계 5로 늘었다 — .omc/plans/plan-chat-graph-pipeline.md §2(e)) +
    // 기본 선택은 '화면'
    navExists: navProbe.navExists === true,
    navHasFiveItems: navProbe.navItemCount === 5,
    defaultPanelIsScreen: navProbe.screenCardCount === 1,
    // nav에서 각 항목을 고르면 그 카드 하나만 뜬다
    accountsPanelOnNavSelect: accountsPanelCardCount === 1,
    mcpPanelOnNavSelect: mcpPanelCardCount === 1,
    modelPanelOnNavSelect: modelPanelProbe.modelCardCount === 1,
    // 모델 패널 — Claude 계정 행(활성 계정이 최소 1개, cli-accounts.js가 이 머신의
    // ~/.claude/.credentials.json을 실측 감지) + 모델 칩이 실제로 그려진다
    modelPanelHasClaudeAccountRow: modelPanelProbe.claudeAccountRows >= 1,
    modelPanelHasModelChips: modelPanelProbe.modelChipCount > 0,
    // 설정은 캔버스의 일이 아니다
    noSettingsCardsOnCanvas: canvasProbe.settingsCardsOnCanvas === 0,
    // 2026-08-24 리프 1.2.1: 옛 단언 chatGrewToMax("설정을 열면 창이 chatMaxH로
    // 자란다")는 사라졌다 — 설정은 셸 창 전체를 덮는 오버레이라 창 크기를 건드리지
    // 않는다. 그 자리에 **창 크기 불변**을 넣는다: 모드 전환이 창을 흔들면 회귀다.
    windowSizeUnchangedWhileOpen:
      near(chatBoundsWhileOpen.width, chatBoundsBefore.width)
      && near(chatBoundsWhileOpen.height, chatBoundsBefore.height),
    dotIsRealButton: chatProbe.dotIsButton === true,
    noTrIdLeak: chatProbe.trIdLeak === false,
    noBearerLeak: chatProbe.bearerLeak === false,
    // Esc로 대화로 돌아오고 카드는 정리된다
    escReturnsToChat: chatAfterClose.appVisible === true && chatAfterClose.settingsHidden === true,
    gridEmptiedOnClose: chatAfterClose.gridEmptied === true,
  };
  report.settingsNavClicks = { navClickAccounts, navClickMcp, navClickModel, navLabels: navProbe.navLabels };
  console.log('[verify] 검증7(설정 모드):', JSON.stringify(report.settingsSurface));
  console.log('[verify] 검증7 nav 클릭 로그:', JSON.stringify(report.settingsNavClicks));
  // settingsSurface는 전부 참이 기대값인 불리언들이다(noTrIdLeak/noBearerLeak
  // 포함 — 자격증명 화면 유출 가드) — 일괄 단언한다.
  for (const [key, val] of Object.entries(report.settingsSurface)) {
    assertOk(`settingsSurface.${key}`, val === true);
  }
  // nav 클릭 자체가 대상을 못 찾은 실패(NOT FOUND)를 놓치지 않는다 — 문자열이라
  // 위 일괄 단언 루프 밖에서 따로 확인한다.
  assertOk('settingsSurface.navClickAccountsFound', navClickAccounts === 'clicked');
  assertOk('settingsSurface.navClickMcpFound', navClickMcp === 'clicked');
  assertOk('settingsSurface.navClickModelFound', navClickModel === 'clicked');

  const winCountBeforeCmd = BrowserWindow.getAllWindows().length;
  const turnCountBeforeCmd = await shellWin.webContents.executeJavaScript(
    "document.querySelectorAll('.turn-q').length"
  );
  await shellWin.webContents.executeJavaScript(`
    (() => {
      const el = document.getElementById('input');
      el.value = '설정';
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })();
  `);
  await wait(900);
  const winCountAfterCmd = BrowserWindow.getAllWindows().length;
  const chatAfterCmd = await shellWin.webContents.executeJavaScript(`
    (() => ({
      inputCleared: document.getElementById('input').value === '',
      turnCount: document.querySelectorAll('.turn-q').length,
      settingsVisible: document.getElementById('settings').hidden === false,
      navExists: !!document.getElementById('settingsNav'),
      screenCardCount: document.querySelectorAll('#settingsGrid .card.screen').length,
    }))()
  `);
  // 정리 — 다음 단계에 설정 모드를 남기지 않는다
  await shellWin.webContents.executeJavaScript(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"
  );
  await wait(400);

  report.settingsCommandBar = {
    // 커맨드바 경로도 창을 만들지 않는다
    noNewWindowOnCommand: winCountAfterCmd === winCountBeforeCmd,
    reachedSettings: chatAfterCmd.settingsVisible === true && chatAfterCmd.navExists === true && chatAfterCmd.screenCardCount === 1,
    inputCleared: chatAfterCmd.inputCleared === true,
    // 설정 명령은 질의로 흘러가지 않는다 — 이력에 질문이 추가되면 안 된다
    notTreatedAsQuery: chatAfterCmd.turnCount === turnCountBeforeCmd,
    turnCountBefore: turnCountBeforeCmd,
    turnCountAfter: chatAfterCmd.turnCount,
  };
  console.log('[verify] 검증8(커맨드바 진입):', JSON.stringify(report.settingsCommandBar));
  // turnCountBefore/turnCountAfter는 숫자 참고값이라 제외하고, 나머지 불리언만 단언한다.
  for (const [key, val] of Object.entries(report.settingsCommandBar)) {
    if (typeof val === 'boolean') assertOk(`settingsCommandBar.${key}`, val === true);
  }

  // ---------- 검증 9: 창 기본 기능 (2026-08-17) — 줌 · 이동 앵커 · 최소화/복원 ----------
  // frame:false·타이틀바 없음이라 main.js에 직접 배선한 기능들이다. 커서 폴링
  // 드래그 자체는 실제 마우스가 필요해 자동화로 못 돌린다 — 대신 그 결과(창이
  // 옮겨진 상태)를 setBounds로 재현해 "다음 높이 변경이 창을 부팅 좌표로
  // 되돌리지 않는다"(앵커 동기화)를 단언한다.
  const sendFromChat = (channel, payload) => shellWin.webContents.executeJavaScript(
    `window.athena.send('${channel}', ${JSON.stringify(payload)})`
  );

  // 9a — 줌: 배율이 적용되고 reset으로 1.0에 돌아온다.
  // 옛 판은 "두 창이 같은 배율로 움직인다"를 쟀다(zoomInSyncsBothWindows) — 창이
  // 하나가 되면서 동기화할 상대가 없다. 렌더러가 하나뿐이라 배율 어긋남 자체가
  // 구조적으로 불가능해졌다(리프 1.2.1).
  await sendFromChat('athena:zoom', { dir: 'in' });
  await sendFromChat('athena:zoom', { dir: 'in' });
  await wait(300);
  const zoomAfterIn = shellWin.webContents.getZoomFactor();
  await sendFromChat('athena:zoom', { dir: 'reset' });
  await wait(300);
  const zoomAfterReset = shellWin.webContents.getZoomFactor();

  // 9b — 이동 앵커: 창을 옮긴 뒤에도 그 자리가 유지된다(스냅백 회귀 방지).
  // 옛 판은 이동 후 `athena:set-chat-height`로 높이를 바꿔 "높이 변경이 창을 부팅
  // 좌표로 되돌리지 않는가"를 쟀다. 높이 경로가 사라졌으므로(리프 1.2.1) 같은
  // 회귀를 다른 자극으로 잰다: 이동 후 **모드 전환**(설정 열고 닫기)이다. 모드
  // 전환도 옛 판에서는 창 크기를 건드리던 경로라 스냅백 위험이 같은 자리에 있다.
  const beforeMove = shellWin.getBounds();
  shellWin.setBounds({ x: beforeMove.x + 120, y: beforeMove.y - 40, width: beforeMove.width, height: beforeMove.height });
  mainMod.noteAppBounds(shellWin); // 앱 주도 표시 — OS 스냅 오인 정착 방지(검증3 주석)
  await wait(150);
  const moved = shellWin.getBounds();
  await shellWin.webContents.executeJavaScript("document.getElementById('dot').click()");
  await wait(500);
  await shellWin.webContents.executeJavaScript(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"
  );
  await wait(500);
  const afterModeToggleAtNewSpot = shellWin.getBounds();
  const anchorKept = {
    xKept: near(afterModeToggleAtNewSpot.x, moved.x),
    yKept: near(afterModeToggleAtNewSpot.y, moved.y),
    sizeKept: near(afterModeToggleAtNewSpot.width, moved.width)
      && near(afterModeToggleAtNewSpot.height, moved.height),
  };
  // 원위치 복구 — 이후 단계에 이동 상태를 남기지 않는다
  shellWin.setBounds(beforeMove);
  mainMod.noteAppBounds(shellWin);
  await wait(200);

  // 9c — 최소화(내리기)·복원(올리기). 옛 판은 "두 창이 한 몸으로 내려가고 한쪽
  // 복원이 짝을 끌어올린다"를 쟀다 — 짝이 없어져 왕복 자체만 남는다.
  await sendFromChat('athena:minimize-windows');
  await wait(500);
  const minimized = shellWin.isMinimized();
  shellWin.restore();
  await wait(600);
  const restored = !shellWin.isMinimized();

  report.windowBasics = {
    zoomInApplied: zoomAfterIn > 1,
    zoomAfterIn,
    zoomResetReturnsTo1: Math.abs(zoomAfterReset - 1) < 0.001,
    movedAnchorKept: anchorKept.xKept && anchorKept.yKept && anchorKept.sizeKept,
    anchorKept,
    minimizeLowersWindow: minimized === true,
    restoreRaisesWindow: restored === true,
  };
  console.log('[verify] 검증9(창 기본 기능):', JSON.stringify(report.windowBasics));
  assertOk('windowBasics: zoom-in applied to the shell renderer', report.windowBasics.zoomInApplied === true);
  assertOk('windowBasics: zoom reset returns to 1.0', report.windowBasics.zoomResetReturnsTo1 === true);
  assertOk('windowBasics: position/size kept across a mode toggle at a moved spot', report.windowBasics.movedAnchorKept === true);
  assertOk('windowBasics: minimize lowers the shell window', report.windowBasics.minimizeLowersWindow === true);
  assertOk('windowBasics: restore raises the shell window', report.windowBasics.restoreRaisesWindow === true);

  // 9d — 닫기(백그라운드 유지, 2026-08-18): 창이 숨고 프로세스는 산다. 복귀는
  // 트레이 클릭과 같은 함수 참조(restoreFromBackground)를 직접 부른다 — 실제
  // 트레이 클릭은 자동화로 만들 수 없다(정직 표기: 아이콘 클릭 자체는 미실측).
  // 옛 판은 "두 창이 함께 숨고 함께 돌아오는가"(짝 맞춤)를 함께 쟀다 — 짝이 없다.
  await sendFromChat('athena:close-windows');
  await wait(400);
  const visibleAfterClose = shellWin.isVisible();
  mainMod.restoreFromBackground();
  await wait(400);
  report.closeToBackground = {
    hiddenAfterClose: visibleAfterClose === false,
    restoredFromTrayPath: shellWin.isVisible(),
    // 닫기는 종료가 아니다 — 창이 파괴되지 않고 숨었을 뿐이어야 한다.
    windowStillAlive: !shellWin.isDestroyed(),
  };
  console.log('[verify] 검증9d(닫기→백그라운드→복귀):', JSON.stringify(report.closeToBackground));
  assertOk('closeToBackground: shell window hidden after close', report.closeToBackground.hiddenAfterClose === true);
  assertOk('closeToBackground: shell restored from tray path', report.closeToBackground.restoredFromTrayPath === true);
  assertOk('closeToBackground: close hides rather than destroys', report.closeToBackground.windowStillAlive === true);

  mainMod.revealShell({ focus: false });
  await wait(200);
  await shellWin.webContents.executeJavaScript("window.AthenaShell.clearCanvases()");
  await wait(120);

  const gridProbe = () => shellWin.webContents.executeJavaScript(`
    (() => {
      const grid = document.getElementById('grid');
      const cards = [...grid.querySelectorAll('.card')];
      return {
        order: cards.map((c) => [...c.classList].find((k) => !['card', 'w-half', 'w-full', 'highlight'].includes(k))),
        widths: cards.map((c) => (c.classList.contains('w-full') ? 'full' : (c.classList.contains('w-half') ? 'half' : 'none'))),
        count: cards.length,
        scrollHeight: grid.scrollHeight,
        clientHeight: grid.clientHeight,
      };
    })()
  `);
  const liveEnvelope = (envelope) => shellWin.webContents.send('athena:add-canvas-live', {
    status: 'success',
    envelope: { fell_back: false, fallback_reason: null, layout: null, drop_types: [], ...envelope },
  });

  // 10a — 도착순 + 형상별 폭 문법: stream → table → reader 순서로 보낸다. 옛 CSS는
  // 타입 고정 order라 이 순서가 stream·reader·table로 재정렬됐다 — 이제 도착순이 규범.
  shellWin.webContents.send('athena:add-canvas', { type: 'stream' });
  await wait(120);
  shellWin.webContents.send('athena:add-canvas', { type: 'table' });
  await wait(120);
  shellWin.webContents.send('athena:add-canvas', { type: 'reader' });
  await wait(200);
  const arrival = await gridProbe();

  // 10b — layout 힌트 승격: stream(기본 반폭)을 'full'로. 같은 타입 재렌더라
  // 기존 stream 카드를 갈아치우고 맨 뒤(최신 도착)로 간다 — 도착순 규칙의 귀결.
  const streamRecord = { ts: '2026-08-18T09:00:00+09:00', ts_precision: 'second', source: 'verify', title: '검증 레코드', url: 'https://example.com' };
  liveEnvelope({ canvas_type: 'stream', caption: '검증10 스트림', layout: 'full', data: { records: [streamRecord] } });
  await wait(200);
  const promoted = await gridProbe();

  // 10c — 무효 힌트('mega')는 조용히 문법 기본값(반폭)으로 폴백한다.
  liveEnvelope({ canvas_type: 'stream', caption: '검증10 스트림', layout: 'mega', data: { records: [streamRecord] } });
  await wait(200);
  const invalidHint = await gridProbe();

  // 10d — 턴별 큐레이션: reader 봉투의 drop_types:['table']가 픽스처 table을 치운다.
  liveEnvelope({ canvas_type: 'reader', caption: '검증10 리더', drop_types: ['table'], data: { title: '검증10 리더', body_markdown: '# 검증\n큐레이션 본문' } });
  await wait(200);
  const curated = await gridProbe();
  await shot(shellWin, '12-card-layout-rules.png');

  // 10e — 높이 예산 집행: 창을 절반 높이로 줄여 예산을 좁힌 뒤 4장째를 추가하면
  // 가장 오래된 카드부터 제거된다(최소 3장 보장이라 3장에서 멈춘다).
  const cbBefore = shellWin.getBounds();
  // 셸 창에는 부팅 하한(main.js DESIGN.minW/minH)이 걸려 있다 — 절반 축소
  // 시뮬레이션이 그 하한에 막히지 않게 잠시만 풀고, 끝나면 되돌린다.
  // 2026-08-24 리프 1.2.1: 옛 판은 `layout.canvasW`(캔버스 창 설계 폭)를 하한
  // 폭으로 썼다. 그 값이 사라져 undefined가 들어가면서 setMinimumSize가 던졌다.
  const halfH = Math.round(cbBefore.height / 2);
  shellWin.setMinimumSize(200, 200);
  shellWin.setBounds({ ...cbBefore, height: halfH });
  mainMod.noteAppBounds(shellWin); // 앱 주도 표시 — OS 스냅 오인 정착 방지
  await wait(200);
  shellWin.webContents.send('athena:add-canvas', { type: 'table' });
  await wait(150);
  liveEnvelope({ canvas_type: 'free', caption: '검증10 자유', data: { a: 1, b: '검증' } });
  await wait(250);
  const afterBudget = await gridProbe();
  shellWin.setBounds(cbBefore);
  shellWin.setMinimumSize(900, 480); // 하한 복구 — main.js DESIGN.minW/minH와 같은 값
  mainMod.noteAppBounds(shellWin);
  await wait(150);

  report.cardLayout = {
    arrivalOrder: arrival.order,
    arrivalOrderIsSendOrder: JSON.stringify(arrival.order) === JSON.stringify(['stream', 'table', 'reader']),
    grammarWidths: arrival.widths,
    grammarWidthsCorrect: JSON.stringify(arrival.widths) === JSON.stringify(['half', 'full', 'half']),
    hintPromotedStreamToFull: promoted.widths[promoted.order.indexOf('stream')] === 'full',
    promotedOrder: promoted.order,
    invalidHintFallsBackToHalf: invalidHint.widths[invalidHint.order.indexOf('stream')] === 'half',
    dropTypesRemovedTable: !curated.order.includes('table'),
    curatedOrder: curated.order,
    budgetEnforcedOldestFirst: afterBudget.count === 3 && !afterBudget.order.includes('stream'),
    afterBudget,
  };
  console.log('[verify] 검증10(카드 배치·생애주기):', JSON.stringify(report.cardLayout));
  assertOk('cardLayout: arrival order matches send order', report.cardLayout.arrivalOrderIsSendOrder === true);
  assertOk('cardLayout: shape-grammar widths correct on arrival', report.cardLayout.grammarWidthsCorrect === true);
  assertOk('cardLayout: layout hint promotes stream to full width', report.cardLayout.hintPromotedStreamToFull === true);
  assertOk('cardLayout: invalid layout hint falls back to half width', report.cardLayout.invalidHintFallsBackToHalf === true);
  assertOk('cardLayout: drop_types curation removed table card', report.cardLayout.dropTypesRemovedTable === true);
  assertOk('cardLayout: height budget evicts oldest card first', report.cardLayout.budgetEnforcedOldestFirst === true);

  // ---------- 검증 11: 창 이동 표준화 — 네이티브 캡션 · JS 드래그 폐기 ----------
  // 2026-08-19 사용자 지시("평범한 앱처럼"): 커서 폴링 드래그(athena:window-drag)를
  // 폐기하고 -webkit-app-region 캡션으로 전환했다. 실제 캡션 드래그는 실물 마우스가
  // 필요해 자동화로 못 돌린다(검증9와 같은 제약) — 대신 계약 3종을 단언한다:
  // (a) 옛 채널이 죽어 있다(allowlist 제거 — send가 던진다) + 크기 불변(구판 DPI
  //     성장 버그 5e0a9ab 회귀 가드 계승), (b) 캡션/구멍 CSS 계약, (c) 외부(사용자)
  //     이동을 앱이 되감지 않는다.
  //
  // 2026-08-24 리프 1.2.1: (c)가 "짝 팔로우"에서 "되감지 않는다"로 바뀌었다. 옛
  // 판은 noteAppBounds 없는 setBounds로 사용자 드래그를 재현해 **상대 창이 같은
  // 델타로 따라오는지**를 쟀다. 따라올 상대가 없어졌으므로, 같은 자극으로 그
  // 반대편 위험을 잰다: handleForeignArrange가 사용자 이동을 OS 스냅으로 오인해
  // 창을 제자리로 정착시켜버리면 그게 회귀다.
  // #grip은 사라졌다(리프 1.2.1) — no-drag 구멍 단언 대상에서 뺀다. 캔버스 창의
  // 별도 상단 스트립도 사라졌다: 타이틀바는 셸에 하나뿐이라 strip과 같은 요소다.
  const { screen: elScreen } = require('electron');
  const dragBefore = shellWin.getBounds();
  const oldChannelDead = await shellWin.webContents.executeJavaScript(
    // ipc-channels:allow-dead — 죽은 채널을 일부러 부른다. 거절되는지가 측정 대상이다.
    "(() => { try { window.athena.send('athena:window-drag', { phase: 'start' }); return false; } catch { return true; } })()"
  );
  await wait(400);
  const dragAfter = shellWin.getBounds();
  const appRegions = await shellWin.webContents.executeJavaScript(`(() => {
    const reg = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return (cs.getPropertyValue('app-region') || cs.getPropertyValue('-webkit-app-region') || '').trim();
    };
    return { strip: reg('#dragStrip'), controlStrip: reg('#controlStrip'),
             winBtn: reg('.win-btn'), history: reg('#history'), grid: reg('#grid'),
             settingsHead: reg('#settings .settings-head') };
  })()`);
  // (c) 외부 이동 수용 — 의도적으로 noteAppBounds를 생략한 setBounds = 사용자 이동.
  // handleForeignArrange(디바운스 120ms)가 반절 스냅 기하가 아님을 보고 그대로 수용해야 한다.
  const foreignBefore = shellWin.getBounds();
  shellWin.setBounds({ x: foreignBefore.x + 60, y: foreignBefore.y + 40, width: foreignBefore.width, height: foreignBefore.height });
  await wait(450);
  const foreignAfter = shellWin.getBounds();
  const foreignMoveKept = near(foreignAfter.x, foreignBefore.x + 60) && near(foreignAfter.y, foreignBefore.y + 40);
  // 원위치 — 같은 외부 이동 경로로 되돌린다.
  shellWin.setBounds({ x: foreignBefore.x, y: foreignBefore.y, width: foreignBefore.width, height: foreignBefore.height });
  await wait(450);
  const foreignRestored = shellWin.getBounds();
  const foreignReturnKept = near(foreignRestored.x, foreignBefore.x) && near(foreignRestored.y, foreignBefore.y);
  report.dragStandard = {
    scaleFactor: elScreen.getPrimaryDisplay().scaleFactor,
    oldChannelDead,
    sizeUnchanged: dragBefore.width === dragAfter.width && dragBefore.height === dragAfter.height,
    appRegions,
    foreignMove: { foreignBefore, foreignAfter, foreignRestored, foreignMoveKept, foreignReturnKept },
  };
  console.log('[verify] 검증11(창 이동 표준화):', JSON.stringify(report.dragStandard));
  assertOk('dragStandard: 옛 JS 드래그 채널이 죽어 있다(allowlist 거부)', oldChannelDead === true);
  assertOk('dragStandard: 크기 불변(5e0a9ab 회귀 가드 계승)', report.dragStandard.sizeUnchanged === true);
  assertOk('dragStandard: 셸 맨 위 타이틀바 = 캡션(drag)', appRegions.strip === 'drag');
  assertOk('dragStandard: 창 버튼 = no-drag 구멍', appRegions.winBtn === 'no-drag');
  assertOk('dragStandard: 컨트롤 스트립은 캡션이 아니다(2026-08-19 개정 — 맨 위만)', appRegions.controlStrip !== 'drag');
  assertOk('dragStandard: 채팅 본문(.history)은 손잡이가 아니다', appRegions.history !== 'drag');
  assertOk('dragStandard: 캔버스 본문(#grid)도 손잡이가 아니다', appRegions.grid !== 'drag');
  assertOk('dragStandard: 설정 헤더 = 캡션(drag)', appRegions.settingsHead === 'drag');
  assertOk('dragStandard: 외부(사용자) 이동을 앱이 되감지 않는다', foreignMoveKept === true);
  assertOk('dragStandard: 복귀 이동도 그대로 수용된다', foreignReturnKept === true);

  // ---------- 검증 12: §5.3.1 컬럼 우선순위 흡수(2층) — table 카드가 1560px에서 접힌다 ----------
  // claude -p 실배선 없이(quota 0) canvas.js의 'athena:add-canvas-live' 경로에 실제
  // ka10095(63컬럼, backend/ref/kiwoom-common-screen-manifest.json column_priority 그대로
  // 추출한 app/data/wide-table-fold-fixtures.json)를 직접 주입해 app/lib/column-fold.js가
  // 실제 렌더 DOM에서도 fold를 발동시키는지 확인한다 — main.js를 거치지 않고 shellWin에
  // 바로 IPC를 보내므로 fixture/live 소스 분기와 무관하다(순수 렌더러 단 검증).
  const wideFixtures = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'data', 'wide-table-fold-fixtures.json'), 'utf-8')
  );
  const ka10095Fixture = wideFixtures.trs.find((t) => t.mapping_id === 'base:ka10095');
  const mockRow = {};
  for (const col of ka10095Fixture.columns) mockRow[col.key] = `v:${col.key}`;
  await shellWin.webContents.send('athena:add-canvas-live', {
    status: 'success',
    envelope: {
      canvas_type: 'table',
      fell_back: false,
      caption: `${ka10095Fixture.name_ko} 검증용`,
      data: { columns: ka10095Fixture.columns, rows: [mockRow, mockRow] },
    },
  });
  await wait(300);
  const foldProbe = await shellWin.webContents.executeJavaScript(`
    (() => {
      const card = document.querySelector('#grid .card.mcp-table');
      if (!card) return null;
      return {
        headerCellCount: card.querySelectorAll('thead th').length,
        rowCellCounts: Array.from(card.querySelectorAll('tbody tr')).map((tr) => tr.children.length),
        foldDataset: (() => {
          const t = card.querySelector('table.fin-table');
          return t ? { total: t.dataset.totalColumns, visible: t.dataset.visibleColumns, hidden: t.dataset.hiddenColumns } : null;
        })(),
      };
    })()
  `);
  await shot(shellWin, '18-table-column-fold-ka10095.png');

  report.tableColumnFold = {
    trId: ka10095Fixture.tr_id,
    totalColumns: ka10095Fixture.total_columns,
    cardRendered: foldProbe !== null,
    visibleColumns: foldProbe && foldProbe.headerCellCount,
    foldedBelowTotal: foldProbe !== null && foldProbe.headerCellCount < ka10095Fixture.total_columns,
    headerMatchesEveryRow: foldProbe !== null
      && foldProbe.rowCellCounts.every((n) => n === foldProbe.headerCellCount),
    foldDataset: foldProbe && foldProbe.foldDataset,
  };
  console.log('[verify] 검증12(컬럼 우선순위 fold):', JSON.stringify(report.tableColumnFold));
  assertOk('tableColumnFold: table card rendered', report.tableColumnFold.cardRendered === true);
  assertOk('tableColumnFold: visible columns folded below total', report.tableColumnFold.foldedBelowTotal === true);
  assertOk('tableColumnFold: header cell count matches every row', report.tableColumnFold.headerMatchesEveryRow === true);

  // ---- 검증13(CC-106): 차트 카드 — 마운트·툴바·지표 토글·매물대 스모크 ----
  // 깊은 상호작용(형식 전환·저작 영속·드로잉)은 probe-chart-*.js 4종이 전담한다 —
  // 여기서는 회귀 게이트로서 "카드가 뜨고, 툴바가 계약대로 있고, 매물대가 켜진다"
  // 만 매 verify마다 실측한다.
  await shellWin.webContents.executeJavaScript(`window.addCard('chart')`);
  await wait(1500); // 동적 import + 비동기 마운트
  const chartProbe = await shellWin.webContents.executeJavaScript(`(async () => {
    const card = document.querySelector('.card.chart');
    if (!card) return null;
    const tabs = Array.from(card.querySelectorAll('.chart-toolbar-tab')).map(b => b.textContent);
    // 분·틱은 데이터가 없어 잠겨 있어야 한다(2026-08-25 pseudoIntraday 제거).
    // 사유(title)까지 확인한다 — 이유 없이 잠긴 버튼은 고장으로 읽힌다.
    const lockedTabs = Array.from(card.querySelectorAll('.chart-toolbar-tab'))
      .filter(b => b.disabled).map(b => ({ label: b.textContent, why: b.title }));
    const paneRows = Array.from(card.querySelectorAll('.chart-price-pane table tr'))
      .map(tr => tr.getBoundingClientRect()).filter(r => r.height > 0).length;
    const indBtn = Array.from(card.querySelectorAll('.chart-toolbar-btn')).find(b => b.textContent.includes('∿'));
    // 마운트 실패(예: lightweight-charts 미설치)면 카드는 있어도 툴바가 없다 —
    // 여기서 클릭하면 TypeError가 unhandledRejection으로 새서 verify가 영원히
    // 안 끝난다(2026-08-18 병합 검증에서 실제 재현). 실패는 수치로 보고한다.
    if (!indBtn) return { cardPresent: true, tabs, lockedTabs, paneRows, indicatorRows: 0, vpBars: 0, toolbarMissing: true };
    indBtn.click();
    await new Promise(r => setTimeout(r, 150));
    const panel = card.querySelector('.chart-indicator-panel');
    const indicatorRows = panel ? panel.querySelectorAll('.chart-ind-row').length : 0;
    const vpRow = panel && panel.querySelector('.chart-ind-vp-row');
    if (vpRow) vpRow.click();
    await new Promise(r => setTimeout(r, 300));
    const vpBars = card.querySelectorAll('.chart-volume-profile-overlay .chart-vp-bar').length;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await new Promise(r => setTimeout(r, 100));
    return { cardPresent: true, tabs, lockedTabs, paneRows, indicatorRows, vpBars };
  })()`);
  await wait(200);
  await shot(shellWin, '19-chart-card.png');
  report.chartCard = {
    cardRendered: chartProbe !== null,
    periodTabsOk: chartProbe !== null && chartProbe.tabs.join(',') === '일,주,월,년,분,틱',
    paneSeparated: chartProbe !== null && chartProbe.paneRows >= 3, // 가격+구분+거래량 이상
    // 2026-08-25: 지표 35 → 36종(RMI 추가). 행 수는 레지스트리에서 읽어
    // 비교한다 — 숫자를 박아두면 지표를 추가할 때마다 여기가 깨진다.
    indicatorRowsMatchRegistry:
      chartProbe !== null && chartProbe.indicatorRows === INDICATOR_DEFS_LENGTH,
    volumeProfileBars24: chartProbe !== null && chartProbe.vpBars === 24,
    // 분·틱 탭이 잠겼고 사유가 붙어 있는가. 이게 풀리면 봉을 지어내는 경로가
    // 돌아왔다는 뜻이다(pseudoIntraday 회귀 감시).
    intradayTabsLocked:
      chartProbe !== null
      && (chartProbe.lockedTabs || []).map((t) => t.label).join(',') === '분,틱'
      && (chartProbe.lockedTabs || []).every((t) => /데이터가 아직 없다/.test(t.why)),
    // 실측 수치도 그대로 남긴다 — 불리언만으로는 미래 회귀의 원인 추적이 어렵다
    // (아키텍트 검증 권고, 2026-08-18. 형제 검증 블록과 기록 밀도 정합).
    measured: chartProbe,
  };
  console.log('[verify] 검증13(차트 카드):', JSON.stringify(report.chartCard));
  assertOk('chartCard: card rendered', report.chartCard.cardRendered === true);
  assertOk('chartCard: period tabs match 일,주,월,년,분,틱', report.chartCard.periodTabsOk === true);
  assertOk('chartCard: price/volume panes separated', report.chartCard.paneSeparated === true);
  assertOk(
    `chartCard: 지표 행 ${INDICATOR_DEFS_LENGTH}개 표시`,
    report.chartCard.indicatorRowsMatchRegistry === true
  );
  assertOk('chartCard: 24 volume-profile bars present', report.chartCard.volumeProfileBars24 === true);
  assertOk('chartCard: 분·틱 탭이 사유와 함께 잠겨 있다', report.chartCard.intradayTabsLocked === true);

  // ---- 검증13b — 실배선 chart 봉투(canvas.js renderLiveChart, 2026-08-18) ----
  // backend가 발급하는 AITS 정식 봉투(renderer_id + data.symbol + data.chart)를
  // liveEnvelope 헬퍼(검증10)로 합성해 gateway→AITS adapter→저수준 renderer를 검증한다.
  // 헬퍼(검증10에서 정의)로 합성 봉투를 보낸다 — 백엔드·quota 무관, 순수 렌더러 단
  // 검증(canvas_type:'chart'가 backend/athena_mcp/canvas.py 스키마 레지스트리에
  // 아직 없어도 이 경로는 상관없다 — main.js는 응답값 canvas_type만 읽는다).
  // 위 검증13이 이미 mock 'chart' 카드(window.addCard('chart'))를 그려뒀으므로,
  // makeCard의 "같은 타입 재요청 시 갈아치운다" 규칙(카드 정리 규칙)에 따라 이
  // 봉투가 그 카드를 대체한다 — 별도 정리 호출 없이 정확히 카드 1장만 남아야 한다.
  const liveChartCandles = [
    { time: '2026-08-14', open: 71000, high: 71600, low: 70800, close: 71300, volume: 9123456 },
    { time: '2026-08-17', open: 71300, high: 71900, low: 71100, close: 71700, volume: 8877665 },
    { time: '2026-08-18', open: 71700, high: 72200, low: 71500, close: 72000, volume: 10233445 },
  ];
  liveEnvelope({
    canvas_type: 'chart',
    renderer_id: 'aits-chart-v1',
    caption: '검증13b 실배선 차트',
    data: { symbol: '005930', chart: { period: 'day', target: 'stock', trId: 'ka10081', candles: liveChartCandles } },
  });
  await wait(1200); // import는 chart-card.js 로드 시 prewarm, 카드 마운트 자체는 비동기다.
  const liveChartProbe = await shellWin.webContents.executeJavaScript(`
    (() => {
      const cards = document.querySelectorAll('#grid .card.chart');
      const card = cards[cards.length - 1];
      if (!card) return null;
      return {
        cardCount: cards.length,
        canvasCount: card.querySelectorAll('canvas').length,
        chartAuthority: card.dataset.chartAuthority || null,
        renderState: card.dataset.renderState || null,
        rendererId: card.dataset.rendererId || null,
        errorNoteAbsent: !card.querySelector('.uk-error, [role="alert"]'),
        chartImportReadyAt: Number(card.dataset.chartImportReadyAt) || null,
        titleText: card.querySelector('.card-title') ? card.querySelector('.card-title').textContent : null,
      };
    })()
  `);
  await shot(shellWin, '20-live-chart-card.png');
  report.liveChartCard = {
    cardRendered: liveChartProbe !== null,
    replacedMockChartCard: liveChartProbe !== null && liveChartProbe.cardCount === 1,
    canvasMounted: liveChartProbe !== null && liveChartProbe.canvasCount > 0,
    aitsAuthority: liveChartProbe !== null && liveChartProbe.chartAuthority === 'AITS',
    dataRenderState: liveChartProbe !== null && liveChartProbe.renderState === 'data',
    rendererIdMatches: liveChartProbe !== null && liveChartProbe.rendererId === 'aits-chart-v1',
    errorNoteAbsent: liveChartProbe !== null && liveChartProbe.errorNoteAbsent === true,
    prewarmTelemetryPresent: liveChartProbe !== null && Number.isFinite(liveChartProbe.chartImportReadyAt),
    // caption은 정보성 참고값(어떤 문구가 카드 제목에 실제로 반영됐는지 추적용) — 단언에서 뺀다.
    titleText: liveChartProbe && liveChartProbe.titleText,
  };
  console.log('[verify] 검증13b(실배선 chart 봉투):', JSON.stringify(report.liveChartCard));
  assertOk('liveChartCard: card rendered from a synthetic live envelope', report.liveChartCard.cardRendered === true);
  assertOk('liveChartCard: same-type re-render replaced the mock chart card (exactly one .card.chart)', report.liveChartCard.replacedMockChartCard === true);
  assertOk('liveChartCard: lightweight-charts canvas element mounted', report.liveChartCard.canvasMounted === true);
  assertOk('liveChartCard: data-chart-authority is AITS', report.liveChartCard.aitsAuthority === true);
  assertOk('liveChartCard: renderState is data, never an error-card false green', report.liveChartCard.dataRenderState === true);
  assertOk('liveChartCard: rendererId is aits-chart-v1', report.liveChartCard.rendererIdMatches === true);
  assertOk('liveChartCard: no visible renderer error note', report.liveChartCard.errorNoteAbsent === true);
  assertOk('liveChartCard: prewarmed chart import readiness telemetry recorded', report.liveChartCard.prewarmTelemetryPresent === true);

  // ---------- 검증 14: 창 배치(스냅) — Windows 표준 의미론 (2026-08-18) ----------
  // main.js가 노출한 placeWindows(left/right)·centerWindows를 직접 구동하고,
  // 최대화/복원은 실제 경로(athena:toggle-maximize)를 그대로 왕복한다.
  //
  // 2026-08-24 리프 1.2.1로 바뀐 것 둘:
  //  (a) "짝이 함께 움직이는가"가 사라졌다 — 옛 계약은 "대화 창이 캔버스 폭의
  //      중앙에 온다"(AT-CH-001R)였는데 창이 하나라 상대 오프셋이 없다. 그 자리에
  //      **좌/우 절반의 중앙에 놓이는가**를 직접 잰다(computeShellPlacement 계약).
  //  (b) ↑/↓가 chatBaseH↔chatMaxH 높이 토글이 아니라 **OS 창 최대화/복원**이다.
  // 남는 것: 크기 불변(스냅은 위치만 바꾼다) · 스냅 뒤 앵커 갱신(다음 앱 주도
  // 이동이 부팅 좌표로 되돌리지 않는가 — 커밋 5e0a9ab와 같은 종류의 회귀 가드).
  mainMod.centerWindows(); // 이전 검증들의 이동 상태를 정리 — 원점에서 시작
  await wait(150);
  const beforePlacement = shellWin.getBounds();
  const workArea = elScreen.getDisplayMatching(beforePlacement).workArea;

  mainMod.placeWindows('left');
  await wait(200);
  const afterLeft = shellWin.getBounds();

  mainMod.placeWindows('right');
  await wait(200);
  const afterRight = shellWin.getBounds();

  // 최대화 토글 — □ 버튼·Win+↑·Ctrl+Alt+↑가 전부 이 채널을 탄다(main.js).
  const heightBeforeMax = shellWin.getBounds().height;
  await shellWin.webContents.executeJavaScript(
    "window.athena.send('athena:toggle-maximize', { force: 'maximize' })"
  );
  await wait(500);
  const afterMaximize = { bounds: shellWin.getBounds(), isMaximized: shellWin.isMaximized() };

  await shellWin.webContents.executeJavaScript(
    "window.athena.send('athena:toggle-maximize', { force: 'restore-or-minimize' })"
  );
  await wait(500);
  const afterRestore = { bounds: shellWin.getBounds(), isMaximized: shellWin.isMaximized() };

  // 앵커 유지 — 스냅 뒤 위치에서 앱 주도 이동을 한 번 더 걸어도 부팅 좌표로
  // 튕겨 돌아가지 않아야 한다(handleForeignArrange 오인 정착 회귀 가드).
  mainMod.placeWindows('right');
  await wait(250);
  const beforeAnchorCheck = shellWin.getBounds();
  shellWin.setBounds({ ...beforeAnchorCheck, y: beforeAnchorCheck.y + 30 });
  mainMod.noteAppBounds(shellWin);
  await wait(400);
  const afterAnchorNudge = shellWin.getBounds();

  mainMod.centerWindows(); // 원위치 — 이후 단계에 배치 상태를 남기지 않는다
  await wait(250);
  const afterCenter = shellWin.getBounds();

  const halfW = Math.floor(workArea.width / 2);
  const expectedLeftX = Math.round(workArea.x + (halfW - beforePlacement.width) / 2);
  const expectedRightX = Math.round((workArea.x + workArea.width - halfW) + (halfW - beforePlacement.width) / 2);

  report.windowPlacement = {
    workArea, beforePlacement, afterLeft, afterRight, afterMaximize, afterRestore, afterCenter,
    expectedLeftX, expectedRightX,
    // near() ±2px — 이 파일의 다른 bounds 비교와 같은 관례다(DPI 배율에서 setBounds
    // 요청값과 getBounds 실측값이 1px 안팎 어긋나는 실측, 검증3 주석).
    leftCentersInLeftHalf: near(afterLeft.x, expectedLeftX),
    rightCentersInRightHalf: near(afterRight.x, expectedRightX),
    leftDiffersFromRight: afterLeft.x !== afterRight.x,
    sizeUnchangedOnLeft: near(afterLeft.width, beforePlacement.width) && near(afterLeft.height, beforePlacement.height),
    sizeUnchangedOnRight: near(afterRight.width, beforePlacement.width) && near(afterRight.height, beforePlacement.height),
    maximizeToggleMaximizes: afterMaximize.isMaximized === true && afterMaximize.bounds.height > heightBeforeMax,
    restoreToggleUnmaximizes: afterRestore.isMaximized === false,
    restoreReturnsToPreMaxSize: near(afterRestore.bounds.height, heightBeforeMax),
    anchorKeptAfterSnap:
      near(afterAnchorNudge.x, beforeAnchorCheck.x)
      && near(afterAnchorNudge.y, beforeAnchorCheck.y + 30),
    centerReturnsToBootOrigin: near(afterCenter.x, layout.originX) && near(afterCenter.y, layout.originY)
      && near(afterCenter.width, layout.shellW) && near(afterCenter.height, layout.shellH),
  };
  console.log('[verify] 검증14(창 배치):', JSON.stringify(report.windowPlacement));
  assertOk('windowPlacement: left snap centers the shell in the left half', report.windowPlacement.leftCentersInLeftHalf === true);
  assertOk('windowPlacement: right snap centers the shell in the right half', report.windowPlacement.rightCentersInRightHalf === true);
  assertOk('windowPlacement: left and right snap to different positions', report.windowPlacement.leftDiffersFromRight === true);
  assertOk('windowPlacement: size unchanged on left snap', report.windowPlacement.sizeUnchangedOnLeft === true);
  assertOk('windowPlacement: size unchanged on right snap', report.windowPlacement.sizeUnchangedOnRight === true);
  assertOk('windowPlacement: athena:toggle-maximize maximizes the OS window', report.windowPlacement.maximizeToggleMaximizes === true);
  assertOk('windowPlacement: athena:toggle-maximize restores the OS window', report.windowPlacement.restoreToggleUnmaximizes === true);
  assertOk('windowPlacement: restore returns to the pre-maximize size', report.windowPlacement.restoreReturnsToPreMaxSize === true);
  assertOk('windowPlacement: anchor kept after snap (no snapback on app-driven move)', report.windowPlacement.anchorKeptAfterSnap === true);
  assertOk('windowPlacement: centerWindows returns to boot origin and design size', report.windowPlacement.centerReturnsToBootOrigin === true);

  // ---------- 검증 15: 모델 설정 저장 (lib/main/model-prefs.js) ----------
  // UI 쪽(모델 칩·Claude 계정 행 존재)은 검증7의 settingsSurface.modelPanel*
  // 단언이 이미 커버한다 — 여기서는 main.js가 노출한 settingsHandlers를 렌더러
  // 없이 직접 호출해 저장 계약(디스크 실재·검증 거부·거부 시 무변경)을 확인한다.
  const modelSetOk = mainMod.settingsHandlers.modelSet(null, { provider: 'claude', patch: { model: 'sonnet', effort: 'low' } });
  const modelGetAfterSet = mainMod.settingsHandlers.modelGet();
  const modelPrefsPath = path.join(VERIFY_PROFILE, 'athena-model.json');
  const modelPrefsOnDisk = fs.existsSync(modelPrefsPath)
    ? JSON.parse(fs.readFileSync(modelPrefsPath, 'utf-8'))
    : null;
  // 선두 '-'는 claude CLI 인자 파서가 값을 플래그로 오독하는 걸 막으려고
  // model-prefs.js가 명시적으로 거부한다(isValidModel). 무효 effort는 화이트리스트 밖.
  const modelSetRejectLeadingDash = mainMod.settingsHandlers.modelSet(null, { provider: 'claude', patch: { model: '-sonnet' } });
  const modelSetRejectInvalidEffort = mainMod.settingsHandlers.modelSet(null, { provider: 'claude', patch: { effort: 'not-a-real-effort' } });
  const modelGetAfterRejects = mainMod.settingsHandlers.modelGet();

  report.modelPrefs = {
    setOk: modelSetOk,
    getAfterSet: modelGetAfterSet,
    onDisk: modelPrefsOnDisk,
    rejectLeadingDash: modelSetRejectLeadingDash,
    rejectInvalidEffort: modelSetRejectInvalidEffort,
    savedCorrectly: modelSetOk.ok === true && modelGetAfterSet.claude.model === 'sonnet' && modelGetAfterSet.claude.effort === 'low',
    persistedToDisk: !!modelPrefsOnDisk && !!modelPrefsOnDisk.claude
      && modelPrefsOnDisk.claude.model === 'sonnet' && modelPrefsOnDisk.claude.effort === 'low',
    rejectsLeadingDash: modelSetRejectLeadingDash.ok === false,
    rejectsInvalidEffort: modelSetRejectInvalidEffort.ok === false,
    // 거부된 패치가 직전의 유효값을 덮어쓰지 않는다 — 여전히 sonnet/low여야 한다
    rejectedValuesDidNotOverwrite: modelGetAfterRejects.claude.model === 'sonnet' && modelGetAfterRejects.claude.effort === 'low',
  };
  console.log('[verify] 검증15(모델 설정):', JSON.stringify(report.modelPrefs));
  assertOk('modelPrefs: model-set saves claude model/effort', report.modelPrefs.savedCorrectly === true);
  assertOk('modelPrefs: persisted to athena-model.json on disk', report.modelPrefs.persistedToDisk === true);
  assertOk('modelPrefs: rejects model with leading dash', report.modelPrefs.rejectsLeadingDash === true);
  assertOk('modelPrefs: rejects invalid effort value', report.modelPrefs.rejectsInvalidEffort === true);
  assertOk('modelPrefs: rejected patches do not overwrite prior valid values', report.modelPrefs.rejectedValuesDidNotOverwrite === true);

  // ---------- 검증 15 확장: Codex 설정 실결선 (lib/main/codex-config.js) ----------
  // Codex는 userData가 아니라 CODEX_HOME/config.toml에 직접 쓴다 — 위에서
  // CODEX_HOME을 검증 전용 디렉토리로 격리했으므로(이 머신의 실제 Codex 세션에
  // 손대지 않는다) 여기서 실제 파일 I/O를 안전하게 검증할 수 있다.
  const codexConfigPath = path.join(process.env.CODEX_HOME, 'config.toml');
  const codexSetOk = mainMod.settingsHandlers.modelSet(null, { provider: 'codex', patch: { model: 'gpt-5-codex', effort: 'medium' } });
  const codexGetAfterSet = mainMod.settingsHandlers.modelGet();
  const codexConfigAfterSet = fs.existsSync(codexConfigPath) ? fs.readFileSync(codexConfigPath, 'utf-8') : '';
  // 무효 모델(선두 '-')·무효 effort(화이트리스트 밖)는 codex-config.js가
  // 파일을 건드리기 전에 거부한다 — 부분 적용이 없어야 한다.
  const codexSetRejectInvalidModel = mainMod.settingsHandlers.modelSet(null, { provider: 'codex', patch: { model: '-bad-flag-like' } });
  const codexSetRejectInvalidEffort = mainMod.settingsHandlers.modelSet(null, { provider: 'codex', patch: { effort: 'not-a-real-effort' } });
  const codexConfigAfterRejects = fs.existsSync(codexConfigPath) ? fs.readFileSync(codexConfigPath, 'utf-8') : '';
  const codexSetNullRemovesModel = mainMod.settingsHandlers.modelSet(null, { provider: 'codex', patch: { model: null } });
  const codexConfigAfterNull = fs.existsSync(codexConfigPath) ? fs.readFileSync(codexConfigPath, 'utf-8') : '';

  report.codexConfig = {
    setOk: codexSetOk,
    getAfterSet: codexGetAfterSet,
    configPath: codexConfigPath,
    configOnDiskAfterSet: codexConfigAfterSet,
    savedCorrectly: codexSetOk.ok === true && codexGetAfterSet.codex.model === 'gpt-5-codex' && codexGetAfterSet.codex.effort === 'medium',
    persistedToConfigToml: /^model = "gpt-5-codex"$/m.test(codexConfigAfterSet) && /^model_reasoning_effort = "medium"$/m.test(codexConfigAfterSet),
    rejectsInvalidModel: codexSetRejectInvalidModel.ok === false,
    rejectsInvalidEffort: codexSetRejectInvalidEffort.ok === false,
    rejectedPatchesDidNotChangeFile: codexConfigAfterRejects === codexConfigAfterSet,
    nullRemovesModelLine: codexSetNullRemovesModel.ok === true
      && !/^model = /m.test(codexConfigAfterNull)
      && /^model_reasoning_effort = "medium"$/m.test(codexConfigAfterNull),
  };
  console.log('[verify] 검증15 확장(Codex 설정):', JSON.stringify(report.codexConfig));
  assertOk('codexConfig: model-set saves codex model/effort', report.codexConfig.savedCorrectly === true);
  assertOk('codexConfig: persisted to CODEX_HOME/config.toml on disk', report.codexConfig.persistedToConfigToml === true);
  assertOk('codexConfig: rejects invalid model (leading dash)', report.codexConfig.rejectsInvalidModel === true);
  assertOk('codexConfig: rejects invalid effort value', report.codexConfig.rejectsInvalidEffort === true);
  assertOk('codexConfig: rejected patches leave config.toml unchanged', report.codexConfig.rejectedPatchesDidNotChangeFile === true);
  assertOk('codexConfig: null patch removes model line, preserves effort line', report.codexConfig.nullRemovesModelLine === true);

  // ---------- 검증 16: 유리 사다리 SSOT (2026-08-19 결정 — 질의응답) ----------
  // "광량 3단 고정" 규범을 값 사다리로 개정하면서 값의 SSOT를 tokens.css의
  // --glass-* 4변수로 박았다(soul.md §7 완화책 2 개정). (a) 실제 표면 렌더 값이
  // 토큰과 일치하는지, (b) 사다리 순서 계약(window < card < canvas < window-max)이
  // 성립하는지를 단언한다 — 값을 CSS 어딘가에 하드코드해 사다리가 두 벌이 되는
  // 회귀를 잡는 게 목적이다.
  //
  // 2026-08-24 리프 1.2.1로 바뀐 것 둘:
  //  (a) "두 창이 같은 토큰을 읽는가"(tokensMatchAcrossWindows)가 사라졌다 —
  //      렌더러가 하나라 토큰이 갈라질 곳이 없다.
  //  (b) **창 표면이 `.app`에서 `#shell`로 옮겨갔다.** 옛 판에서 대화 창의 `.app`이
  //      창 표면(--glass-window)이었는데, `.app`은 이제 셸 위의 투명한 레이아웃
  //      열이고 표면은 셸이 진다(shell.css). 그래서 여기서 읽는 요소도 바뀐다.
  //      `.app`이 투명한지도 함께 단언한다 — 유리를 두 겹 칠하면 실효 불투명도가
  //      곱해져 "그냥 검은 창" 회귀가 난다(2026-08-22 실측으로 두 번 겪었다).
  const tokens = await shellWin.webContents.executeJavaScript(`(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      window: parseFloat(s.getPropertyValue('--glass-window')),
      card: parseFloat(s.getPropertyValue('--glass-card')),
      canvas: parseFloat(s.getPropertyValue('--glass-canvas')),
      windowMax: parseFloat(s.getPropertyValue('--glass-window-max')),
    };
  })()`);
  // 캔버스에 카드 하나를 띄워 실측한다(이전 검증들이 카드를 정리했을 수 있다).
  shellWin.webContents.send('athena:add-canvas', { type: 'stream' });
  await wait(400);
  const alphaOf = (rgba) => {
    const m = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([0-9.]+))?\)/.exec(rgba || '');
    return m ? (m[1] === undefined ? 1 : parseFloat(m[1])) : NaN;
  };
  const surfaceAlphas = await shellWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('#grid .card');
    return {
      shell: getComputedStyle(document.getElementById('shell')).backgroundColor,
      mosaic: getComputedStyle(document.querySelector('.mosaic')).backgroundColor,
      card: card ? getComputedStyle(card).backgroundColor : null,
      chatApp: getComputedStyle(document.querySelector('#chatRegion > .app')).backgroundColor,
    };
  })()`);
  const nearAlpha = (a, b) => Number.isFinite(a) && Math.abs(a - b) <= 0.02;
  report.glassLadder = {
    tokens,
    shellAlpha: alphaOf(surfaceAlphas.shell),
    mosaicAlpha: alphaOf(surfaceAlphas.mosaic),
    cardAlpha: alphaOf(surfaceAlphas.card),
    chatAppRaw: surfaceAlphas.chatApp,
    ladderOrdered:
      tokens.window < tokens.card && tokens.card < tokens.canvas
      && tokens.canvas < tokens.windowMax,
    shellMatchesWindowToken: nearAlpha(alphaOf(surfaceAlphas.shell), tokens.window),
    mosaicMatchesToken: nearAlpha(alphaOf(surfaceAlphas.mosaic), tokens.canvas),
    cardMatchesToken: nearAlpha(alphaOf(surfaceAlphas.card), tokens.card),
    // 채팅 영역은 자기 유리를 갖지 않는다 — 완전 투명(alpha 0)이어야 한다.
    chatAppTransparent: alphaOf(surfaceAlphas.chatApp) === 0
      || /rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(String(surfaceAlphas.chatApp)),
  };
  console.log('[verify] 검증16(유리 사다리):', JSON.stringify(report.glassLadder));
  assertOk('glassLadder: window < card < canvas < window-max', report.glassLadder.ladderOrdered === true);
  assertOk('glassLadder: shell surface renders --glass-window', report.glassLadder.shellMatchesWindowToken === true);
  assertOk('glassLadder: canvas surface renders --glass-canvas', report.glassLadder.mosaicMatchesToken === true);
  assertOk('glassLadder: card renders --glass-card', report.glassLadder.cardMatchesToken === true);
  assertOk('glassLadder: chat region does not paint a second glass layer', report.glassLadder.chatAppTransparent === true);

  // ---------- 검증 17: 능동 턴·주문 티켓 (2026-08-19 능동 에이전트 — 쿼터 0) ----------
  // 합성 발화 이벤트를 IPC로 주입해 P2~P4 렌더 계약을 픽스처로 검증한다:
  // 능동 턴(발화 배지·방식 표기·소스 라벨·시점 고지) → 티켓 직행 버튼 →
  // 모드 전이(#order 표시·#app 후퇴·창은 둘) → 게이트 잠금 → Esc 복귀.
  shellWin.webContents.send('athena:routine-event', {
    type: 'routine-fired',
    routine_id: 'vr1',
    symbol: '005930',
    source: 'price.change_rate',
    mode: 'realtime-ws',
    observed: 5.3,
    threshold: 5.0,
    note: '검증 루틴',
    fired_at: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
  });
  await wait(400);
  report.agentTurn = await shellWin.webContents.executeJavaScript(`(() => {
    const t = document.querySelector('.turn-agent.agent-fired');
    if (!t) return { present: false };
    return {
      present: true,
      badge: (t.querySelector('.agent-badge') || {}).textContent || null,
      mode: (t.querySelector('.agent-mode') || {}).textContent || null,
      source: (t.querySelector('.agent-source') || {}).textContent || null,
      body: (t.querySelector('.agent-body') || {}).textContent || null,
      hasTicketButton: !!Array.from(t.querySelectorAll('button'))
        .find((b) => b.textContent.includes('주문 티켓')),
    };
  })()`);
  console.log('[verify] 검증17(능동 턴):', JSON.stringify(report.agentTurn));
  assertOk('agentTurn: renders', report.agentTurn.present === true);
  assertOk('agentTurn: 발화 시각 배지', /발화$/.test(report.agentTurn.badge || ''));
  assertOk('agentTurn: 방식 표기(실시간 WS)', (report.agentTurn.mode || '').includes('실시간'));
  assertOk('agentTurn: 소스 라벨(묻지 않은 턴)', (report.agentTurn.source || '').includes('묻지 않은 턴'));
  assertOk('agentTurn: 시점 고지(발화 시점 기준)', (report.agentTurn.body || '').includes('발화 시점'));
  assertOk('agentTurn: 티켓 직행 버튼', report.agentTurn.hasTicketButton === true);

  await shellWin.webContents.executeJavaScript(`(() => {
    const t = document.querySelector('.turn-agent.agent-fired');
    const b = Array.from(t.querySelectorAll('button')).find((x) => x.textContent.includes('주문 티켓'));
    b.click();
  })()`);
  await wait(600);
  report.orderTicket = await shellWin.webContents.executeJavaScript(`(() => {
    const vis = (id) => { const n = document.getElementById(id); return !!n && !n.hidden; };
    const execBtn = Array.from(document.querySelectorAll('#orderBody button'))
      .find((x) => x.textContent.includes('주문 실행'));
    return {
      orderVisible: vis('order'),
      appHidden: !vis('app'),
      firedAtLabel: !!Array.from(document.querySelectorAll('#orderBody .ticket-label'))
        .find((l) => l.textContent.includes('발화 시점')),
      execDisabled: execBtn ? execBtn.disabled : null,
    };
  })()`);
  report.orderTicket.windowCount = BrowserWindow.getAllWindows().length;
  console.log('[verify] 검증17(주문 티켓):', JSON.stringify(report.orderTicket));
  assertOk('orderTicket: 모드 전이(#order 표시·#app 후퇴)',
    report.orderTicket.orderVisible === true && report.orderTicket.appHidden === true);
  // 주문 확인도 새 창이 아니라 모드다 — 부팅 시점 창 수와 같아야 한다(기대값을
  // 상수로 박지 않는다: 오브 창(1.3.1)이 붙어 기준선이 2가 돼도 이 단언은 그대로 산다).
  assertOk('orderTicket: 창 수가 부팅 시점과 같다(새 창 없음)',
    report.orderTicket.windowCount === report.bootChatOnly.openWindowCount);
  assertOk('orderTicket: 발화 시점 라벨(시점 정직성)', report.orderTicket.firedAtLabel === true);
  assertOk('orderTicket: 게이트 잠금(주문 API 부재 시 실행 비활성)', report.orderTicket.execDisabled === true);
  await shellWin.webContents.executeJavaScript(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"
  );
  await wait(300);
  const orderClosed = await shellWin.webContents.executeJavaScript(
    "(() => { const o = document.getElementById('order'); const a = document.getElementById('app'); return o.hidden && !a.hidden; })()"
  );
  assertOk('orderTicket: Esc 복귀', orderClosed === true);

  const badgeCheck = await shellWin.webContents.executeJavaScript(`(() => {
    const HistoryBadge = window.AthenaLib && window.AthenaLib.HistoryBadge;
    if (!HistoryBadge) return { moduleLoaded: false };
    const router = HistoryBadge.createSaveFailedRouter();

    const qLine = document.createElement('div');
    qLine.className = 'turn';
    document.body.appendChild(qLine); // isConnected:true를 얻으려면 실제 문서에 붙어야 한다
    router.startTurn(qLine);

    // assistant 실패가 aLine 생성보다 먼저 오는 레이스(main이 fire-and-forget이라
    // 실제로 가능 — history-badge.test.js가 이미 단위로 잡은 경로)까지 같은
    // 렌더러 컨텍스트에서 재현한다.
    router.handleFailure({ messageId: 'verify17-a', role: 'assistant' });
    const pendingBeforeALine = router._debugState().pendingAssistantBadge === true;

    const aLine = document.createElement('div');
    aLine.className = 'turn';
    document.body.appendChild(aLine);
    router.setAssistantLine(aLine);

    router.handleFailure({ messageId: 'verify17-u', role: 'user' });

    const qBadge = qLine.querySelector('.save-failed-badge');
    const aBadge = aLine.querySelector('.save-failed-badge');
    const result = {
      moduleLoaded: true,
      pendingBeforeALine,
      userBadgeText: qBadge ? qBadge.textContent : null,
      assistantBadgeText: aBadge ? aBadge.textContent : null,
      userBadgeInsideTurnMeta: !!(qBadge && qBadge.closest('.turn-meta')),
      assistantBadgeInsideTurnMeta: !!(aBadge && aBadge.closest('.turn-meta')),
      noDuplicateMetaOnQLine: qLine.querySelectorAll('.turn-meta').length === 1,
      noDuplicateMetaOnALine: aLine.querySelectorAll('.turn-meta').length === 1,
    };
    qLine.remove();
    aLine.remove(); // 검증용 DOM 정리 — 다음 검증에 남지 않게
    return result;
  })()`);
  report.historySaveFailedBadge = badgeCheck;
  console.log('[verify] 검증19("기록 안 됨" 배지):', JSON.stringify(report.historySaveFailedBadge));
  assertOk('historyBadge: HistoryBadge 모듈이 shell.html에 실제로 로드됐다', badgeCheck.moduleLoaded === true);
  assertOk('historyBadge: assistant 실패가 aLine 생성보다 먼저 오면 pending으로 흡수된다', badgeCheck.pendingBeforeALine === true);
  assertOk('historyBadge: role:user 배지 텍스트 — "기록 안 됨"', badgeCheck.userBadgeText === '기록 안 됨');
  assertOk('historyBadge: role:assistant 배지 텍스트(pending 흡수 후 적용) — "기록 안 됨"', badgeCheck.assistantBadgeText === '기록 안 됨');
  assertOk('historyBadge: 배지는 트레이스 라인(.turn-meta) 부속이다 — 독립 유리 레이어 아님', badgeCheck.userBadgeInsideTurnMeta === true && badgeCheck.assistantBadgeInsideTurnMeta === true);
  assertOk('historyBadge: 줄마다 .turn-meta는 하나뿐 — 중복 생성 없음', badgeCheck.noDuplicateMetaOnQLine === true && badgeCheck.noDuplicateMetaOnALine === true);

  // preload allowlist — 렌더러가 athena:history-save-failed를 구독할 수 있어야
  // main의 IPC가 실제로 chat.js에 닿는다(모듈 로직과 별개로 배선 자체를 확인).
  const historyChannelAllowed = await shellWin.webContents.executeJavaScript(`(() => {
    try {
      const unsubscribe = window.athena.on('athena:history-save-failed', () => {});
      unsubscribe();
      return true;
    } catch {
      return false;
    }
  })()`);
  report.historyChannelAllowed = historyChannelAllowed;
  assertOk('historyBadge: preload allowlist가 athena:history-save-failed를 통과시킨다', historyChannelAllowed === true);

  mainMod.revealShell({ focus: false });
  await wait(200);
  await shellWin.webContents.executeJavaScript("window.AthenaShell.clearCanvases()");
  await wait(120);

  // 20a — F1: 스칼라 6개, 셀 프리미티브 5종 중 4종(가격/등락/수량·일시/종목) 실측 포함.
  liveEnvelope({
    canvas_type: 'facts',
    caption: '검증20 facts(F1)',
    data: {
      fields: [
        { key: 'stk_nm', label: '종목명', value: '삼성전자' },
        { key: 'cur_prc', label: '현재가', value: '71400' },
        { key: 'pred_pre', label: '전일대비', value: '+1500' },
        { key: 'pred_pre_sig', label: '전일대비기호', value: '2' },
        { key: 'trde_qty', label: '거래량', value: '18402113' },
        { key: 'dt', label: '기준일', value: '20260819' },
      ],
    },
  });
  await wait(200);
  const factsF1Probe = await shellWin.webContents.executeJavaScript(`
    (() => {
      const card = document.querySelector('#grid .card.facts');
      if (!card) return null;
      const changeCell = card.querySelector('.facts-value-change');
      return {
        groupCount: card.querySelectorAll('.facts-group').length,
        rowCount: card.querySelectorAll('.facts-row').length,
        priceText: card.querySelector('.facts-value-price') ? card.querySelector('.facts-value-price').textContent : null,
        changeToneClass: changeCell ? [...changeCell.classList].find((c) => c.startsWith('is-')) : null,
        datetimeText: card.querySelector('.facts-value-datetime') ? card.querySelector('.facts-value-datetime').textContent : null,
        symbolText: card.querySelector('.facts-value-symbol') ? card.querySelector('.facts-value-symbol').textContent : null,
      };
    })()
  `);

  // 20b — F2: 스칼라 14개(경계 11개 초과) → 2단 그룹으로 접혀야 한다. 같은 타입
  // 재요청이라 makeCard가 20a의 facts 카드를 갈아치운다(카드 정리 규칙).
  const f2Fields = Array.from({ length: 14 }, (_, i) => ({ key: `f${i}`, label: `필드${i}`, value: String(i) }));
  liveEnvelope({ canvas_type: 'facts', caption: '검증20 facts(F2)', data: { fields: f2Fields } });
  await wait(200);
  const factsF2Probe = await shellWin.webContents.executeJavaScript(`
    (() => {
      const card = document.querySelector('#grid .card.facts');
      if (!card) return null;
      const grid = card.querySelector('.facts-grid');
      return {
        groupCount: card.querySelectorAll('.facts-group').length,
        gridIs2Col: grid ? grid.classList.contains('facts-grid-2col') : false,
        rowCount: card.querySelectorAll('.facts-row').length,
      };
    })()
  `);

  // 20c — compound(C2): 헤더 밴드(스칼라 3) + 표 1개. mcp-table과 같은 buildFoldedTable을
  // 재사용하므로 fin-table 구조까지 확인한다.
  liveEnvelope({
    canvas_type: 'compound',
    caption: '검증20 compound',
    data: {
      header: [
        { key: 'stk_nm', label: '종목명', value: '삼성전자' },
        { key: 'cur_prc', label: '현재가', value: '71400' },
        { key: 'flu_rt', label: '등락률', value: '-1.02' },
      ],
      table: {
        columns: [{ key: 'dt', label: '일자' }, { key: 'cur_prc', label: '현재가' }],
        rows: [{ dt: '20260819', cur_prc: '71400' }, { dt: '20260818', cur_prc: '70200' }],
      },
    },
  });
  await wait(200);
  const compoundProbe = await shellWin.webContents.executeJavaScript(`
    (() => {
      const card = document.querySelector('#grid .card.compound');
      if (!card) return null;
      const band = card.querySelector('.compound-header-band');
      const table = card.querySelector('table.fin-table');
      const changeCell = band ? band.querySelector('.facts-value-change') : null;
      return {
        bandPresent: !!band,
        bandRowCount: band ? band.querySelectorAll('.facts-row').length : 0,
        tablePresent: !!table,
        tableBodyRowCount: table ? table.querySelectorAll('tbody tr').length : 0,
        changeToneClass: changeCell ? [...changeCell.classList].find((c) => c.startsWith('is-')) : null,
      };
    })()
  `);
  await shot(shellWin, '21-facts-compound-cards.png');

  report.factsCompoundCards = { f1: factsF1Probe, f2: factsF2Probe, compound: compoundProbe };
  console.log('[verify] 검증20(facts/compound 카드):', JSON.stringify(report.factsCompoundCards));
  assertOk('factsCard(F1): rendered as single group', factsF1Probe !== null && factsF1Probe.groupCount === 1);
  assertOk('factsCard(F1): all 6 fields rendered', factsF1Probe !== null && factsF1Probe.rowCount === 6);
  assertOk('factsCard(F1): price cell formatted with thousands separator', factsF1Probe !== null && factsF1Probe.priceText === '71,400');
  assertOk('factsCard(F1): change cell tone reflects positive value → up', factsF1Probe !== null && factsF1Probe.changeToneClass === 'is-up');
  assertOk('factsCard(F1): datetime cell formatted YYYYMMDD → YYYY-MM-DD', factsF1Probe !== null && factsF1Probe.datetimeText === '2026-08-19');
  assertOk('factsCard(F1): symbol cell rendered', factsF1Probe !== null && factsF1Probe.symbolText === '삼성전자');
  assertOk('factsCard(F2): 14 scalars fold into 2 groups(spec §3.1 boundary)', factsF2Probe !== null && factsF2Probe.groupCount === 2 && factsF2Probe.gridIs2Col === true);
  assertOk('factsCard(F2): all 14 fields still rendered across groups', factsF2Probe !== null && factsF2Probe.rowCount === 14);
  assertOk('compoundCard: header band + exactly one table(spec §3.3 "다중 표 아님")', compoundProbe !== null && compoundProbe.bandPresent === true && compoundProbe.tablePresent === true);
  assertOk('compoundCard: header band renders all 3 scalar fields', compoundProbe !== null && compoundProbe.bandRowCount === 3);
  assertOk('compoundCard: table renders both rows', compoundProbe !== null && compoundProbe.tableBodyRowCount === 2);
  assertOk('compoundCard: header change cell tone reflects negative value → down', compoundProbe !== null && compoundProbe.changeToneClass === 'is-down');

  // ---------- 검증 21: Paper AT-CV-005 승인 템플릿 13종 실제 DOM/캡처 ----------
  // 각 케이스를 같은 canvas renderer 채널에 주입하고, 카드가 실제 layout/control/state
  // 계약을 노출한 뒤 compositor screenshot이 비어 있지 않은지 확인한다. 보호 워크플로
  // E/A/S는 표시 전용 fixture만 사용하며 주문/OAuth/WS side effect를 실행하지 않는다.
  const tableData = (columnCount, withHeader = false) => ({
    ...(withHeader ? { header: [{ key: 'stk_nm', label: '종목명', value: '검증종목' }] } : {}),
    columns: Array.from({ length: columnCount }, (_, i) => ({ key: `c${i}`, label: `열${i}` })),
    rows: Array.from({ length: 3 }, (_, r) => Object.fromEntries(
      Array.from({ length: columnCount }, (_, c) => [`c${c}`, `${r}-${c}`]),
    )),
  });
  const paperCases = [
    { id: 'F1', type: 'facts', screenId: 'AT-CV-005:F1', state: 'ready', data: { fields: Array.from({ length: 6 }, (_, i) => ({ key: `f${i}`, label: `필드${i}`, value: `${i}` })) } },
    { id: 'F2', type: 'facts', screenId: 'AT-CV-005:F2', state: 'ready', data: { fields: Array.from({ length: 14 }, (_, i) => ({ key: `f${i}`, label: `필드${i}`, value: `${i}` })) } },
    { id: 'T1', type: 'table', screenId: 'AT-CV-005:T1', state: 'ready', data: tableData(4) },
    { id: 'T2', type: 'table', screenId: 'AT-CV-005:T2', state: 'ready', data: tableData(14) },
    { id: 'T3', type: 'table', screenId: 'AT-CV-005:T3', state: 'ready', layout: 'full', data: tableData(28) },
    { id: 'T4', type: 'table', screenId: 'AT-CV-005:T4', state: 'ready', data: tableData(6, true) },
    { id: 'C1', type: 'chart', screenId: 'AT-CV-005:C1', state: 'ready', rendererId: 'aits-chart-v1', data: {
      symbol: '005930',
      chart: { period: 'day', target: 'stock', trId: 'ka10081', candles: [
        { time: '2026-08-18', open: 100, high: 110, low: 95, close: 105, volume: 1000 },
        { time: '2026-08-19', open: 105, high: 115, low: 101, close: 112, volume: 1200 },
      ] },
    } },
    { id: 'C2', type: 'compound', screenId: 'AT-CV-005:C2', state: 'ready', data: { header: [{ key: 'stk_nm', label: '종목명', value: '검증종목' }], table: tableData(4) } },
    { id: 'E1', type: 'event', screenId: 'AT-CV-005:E1', state: 'open', data: { lifecycle: 'open', records: [{ type: '체결', name: '검증종목', value: '100' }] } },
    { id: 'E2', type: 'event', screenId: 'AT-CV-005:E2', state: 'reconnecting', data: { lifecycle: 'reconnecting', records: Array.from({ length: 20 }, (_, i) => ({ seq: i + 1, type: '시세', value: `${100 + i}` })) } },
    { id: 'E3', type: 'event', screenId: 'AT-CV-005:E3', state: 'stopped', data: { lifecycle: 'stopped', records: [{ seq: 1 }] } },
    { id: 'A1', type: 'action', screenId: 'AT-CV-005:A1', state: 'review', data: { lifecycle: 'review', receipt: { ord_no: 'DISPLAY-ONLY', dmst_stex_tp: 'KRX' } } },
    { id: 'S1', type: 'status', screenId: 'AT-CV-005:S1', state: 'ready', data: { lifecycle: 'ready', configured: true, ready: true, expires_at: '2026-08-21T12:00:00+09:00' } },
  ];
  report.paperScreenCases = {};
  for (const paperCase of paperCases) {
    await shellWin.webContents.executeJavaScript("window.AthenaShell.clearCanvases()");
    await wait(60);
    liveEnvelope({
      canvas_type: paperCase.type,
      caption: `Paper ${paperCase.id}`,
      screen_id: paperCase.screenId,
      renderer_id: paperCase.rendererId,
      layout: paperCase.layout || null,
      data: paperCase.data,
    });
    await wait(paperCase.type === 'chart' ? 350 : 120);
    const probe = await shellWin.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('#grid .card');
      if (!card) return null;
      const rect = card.getBoundingClientRect();
      const body = card.querySelector('.card-body');
      const protectedWorkflow = card.dataset.workflow || null;
      return {
        connected: card.isConnected,
        nonzeroRect: rect.width > 0 && rect.height > 0,
        bodyHasContent: !!body && body.textContent.trim().length > 0,
        fullWidth: card.classList.contains('w-full'),
        hasCloseControl: !!card.querySelector('.uk-card-close'),
        stateMatches: protectedWorkflow ? card.dataset.screenState === ${JSON.stringify(paperCase.state)} : true,
        displayOnlyGuard: protectedWorkflow ? !!card.querySelector('.workflow-guard') : true,
        noExecutableOrderOrOauthControl: !card.querySelector('button[data-order], button[data-oauth], input[type=password]'),
        screenIdMatches: card.dataset.screenId === ${JSON.stringify(paperCase.screenId)},
        chartAuthorityMatches: ${JSON.stringify(paperCase.type)} !== 'chart' || card.dataset.chartAuthority === 'AITS',
        chartRenderStateIsData: ${JSON.stringify(paperCase.type)} !== 'chart' || card.dataset.renderState === 'data',
        chartRendererIdMatches: ${JSON.stringify(paperCase.type)} !== 'chart' || card.dataset.rendererId === 'aits-chart-v1',
        chartSurfaceMounted: ${JSON.stringify(paperCase.type)} !== 'chart' || card.querySelectorAll('canvas').length > 0,
        chartErrorNoteAbsent: ${JSON.stringify(paperCase.type)} !== 'chart' || !card.querySelector('.uk-error, [role="alert"]'),
      };
    })()`);
    const captureName = `paper-${paperCase.id}.png`;
    const imageSize = await shot(shellWin, captureName);
    const passed = !!probe
      && Object.values(probe).every((value) => value === true || value === false || typeof value === 'string' || value === null)
      && probe.connected && probe.nonzeroRect && probe.bodyHasContent && probe.hasCloseControl
      && probe.stateMatches && probe.displayOnlyGuard && probe.noExecutableOrderOrOauthControl
      && probe.screenIdMatches
      && probe.chartAuthorityMatches && probe.chartRenderStateIsData && probe.chartRendererIdMatches
      && probe.chartSurfaceMounted && probe.chartErrorNoteAbsent
      && imageSize.width > 0 && imageSize.height > 0;
    report.paperScreenCases[paperCase.id] = {
      screenId: paperCase.screenId,
      fixture: 'verify.js:paper-at-cv-005-display-only-v1',
      status: passed ? 'pass' : 'fail',
      screenshot: `app/captures/${captureName}`,
      dom: { connected: !!(probe && probe.connected), nonzeroRect: !!(probe && probe.nonzeroRect), bodyHasContent: !!(probe && probe.bodyHasContent), screenIdMatches: !!(probe && probe.screenIdMatches) },
      layout: { cardMeasured: !!(probe && probe.nonzeroRect), paperWidthApplied: !!probe },
      controls: { closeControlRendered: !!(probe && probe.hasCloseControl), protectedActionsAbsent: !!(probe && probe.noExecutableOrderOrOauthControl) },
      states: {
        declaredStateRendered: !!(probe && probe.stateMatches),
        displayOnlyGuardRendered: !!(probe && probe.displayOnlyGuard),
        chartAuthorityMatches: !!(probe && probe.chartAuthorityMatches),
        chartRenderStateIsData: !!(probe && probe.chartRenderStateIsData),
        chartRendererIdMatches: !!(probe && probe.chartRendererIdMatches),
        chartSurfaceMounted: !!(probe && probe.chartSurfaceMounted),
        chartErrorNoteAbsent: !!(probe && probe.chartErrorNoteAbsent),
      },
    };
    assertOk(`paperScreenCases ${paperCase.id}: actual DOM/layout/control/state + screenshot`, passed);
  }

  // ---------- 검증 22: 알림 오브 창 (2026-08-24 리프 1.3.1 — 쿼터 0) ----------
  // 합성 발화 이벤트를 오브에 직접 주입해 계약을 실측한다. 백엔드 WS를 띄우지
  // 않는다(파일 상단 원칙: 자동 검증은 외부 상태에 좌우되면 안 된다) — main의
  // RoutineFeed가 받아서 보내는 것과 **같은 채널·같은 형상**이라 경로가 같다.
  //
  // 여기서 재는 것은 셋이다:
  //  (a) 접힘 상태의 기하 — 76px 원형이고 화면 구석에 있다
  //  (b) 펼침의 정직성 계약 — 발화 배지 · 방식 표기 · 소스 라벨 · 시점 고지
  //  (c) **없어야 하는 것** — 실행 버튼 0 · 입력창 0(확정 결정 3 · 단일 입력 원칙)
  // 그리고 왕복 불변: 펼쳤다 접으면 오브가 원래 자리로 돌아온다.
  const orbCollapsedBefore = orbWin.getBounds();

  // 22-A — **알림 0건: 오브에 색이 없다.** 리프 1.3.2의 핵심 계약이다.
  // 먼저 상태가 정말 'none'인지 확인한다 — 앞선 검증이 오브에 이벤트를 흘렸다면
  // 이 측정은 무의미해진다(가정을 재지 않고 확인한다).
  const orbAlertBeforeEvent = await orbWin.webContents.executeJavaScript(
    "document.getElementById('orbRoot').dataset.alert"
  );
  await shot(orbWin, '22-orb-collapsed.png');
  const pixelsQuiet = await measurePixels(orbWin);

  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-fired',
    routine_id: 'vorb1',
    symbol: '005930',
    source: 'price.change_rate',
    mode: 'realtime-ws',
    observed: 5.3,
    threshold: 5.0,
    note: '오브 검증 루틴',
    fired_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
  });
  await wait(300);

  // 22-B — **알림이 오면 딥블루 바이저가 드러난다.** 같은 창, 같은 크기, 상태만 다르다.
  await shot(orbWin, '22b-orb-alerted.png');
  const pixelsAlerted = await measurePixels(orbWin);

  const orbCollapsedProbe = await orbWin.webContents.executeJavaScript(`(() => {
    const orb = document.getElementById('orb');
    const r = orb.getBoundingClientRect();
    const cs = getComputedStyle(orb);
    const visor = getComputedStyle(document.getElementById('orbVisor'));
    return {
      width: Math.round(r.width),
      height: Math.round(r.height),
      borderRadius: cs.borderRadius,
      count: document.getElementById('orbCount').textContent,
      panelHidden: document.getElementById('orbPanel').hidden,
      state: document.getElementById('orbRoot').dataset.state,
      // 2026-08-24 리프 1.3.2 — 무채색↔발화 상태. 1건 받았으니 'fired'여야 한다.
      alert: document.getElementById('orbRoot').dataset.alert,
      // 유리는 끝까지 무채색이다 — 셸 배경에 색이 섞이면 그건 틴트다(soul.md §7).
      orbBackground: cs.backgroundColor,
      // 바이저는 **페이드가 아니라** 스케일·블러 변조로 드러난다(soul.md §7).
      visorTransition: visor.transition,
      visorTransform: visor.transform,
      eyeCount: document.querySelectorAll('#orbVisor .orb-eye').length,
      // 드래그 손잡이/구멍 계약 — 같은 픽셀에 겹치면 클릭이 영영 안 온다.
      orbRegion: (cs.getPropertyValue('app-region') || cs.getPropertyValue('-webkit-app-region') || '').trim(),
      coreRegion: (() => {
        const c = getComputedStyle(document.getElementById('orbToggle'));
        return (c.getPropertyValue('app-region') || c.getPropertyValue('-webkit-app-region') || '').trim();
      })(),
      // 옛 마젠타 호는 걷어냈다 — 얼굴이 신호를 가져갔고 신호는 화면당 한 곳이다.
      // 죽은 채 남았는지 확인한다: 링 배경에 브랜드 마젠타가 있으면 안 된다.
      ringHasBrand: getComputedStyle(document.getElementById('orbRing'))
        .backgroundImage.includes('238, 19, 123'),
    };
  })()`);

  // 펼침 — 실제 사용자 경로(코어 클릭)를 그대로 태운다.
  await orbWin.webContents.executeJavaScript("document.getElementById('orbToggle').click()");
  await wait(450);
  const orbExpandedBounds = orbWin.getBounds();
  await shot(orbWin, '23-orb-expanded.png');

  const orbPanelProbe = await orbWin.webContents.executeJavaScript(`(() => {
    const txt = (id) => { const n = document.getElementById(id); return n ? n.textContent.trim() : null; };
    return {
      state: document.getElementById('orbRoot').dataset.state,
      anchor: document.getElementById('orbRoot').dataset.anchor,
      panelVisible: document.getElementById('orbPanel').hidden === false,
      badge: txt('orbBadge'),
      mode: txt('orbMode'),
      relative: txt('orbRelative'),
      body: txt('orbBody'),
      source: txt('orbSource'),
      cardRows: document.querySelectorAll('#orbCard .orb-row').length,
      // 대표 카드가 스크롤 뒤로 잘리는지 — 잘리면 숫자가 안 읽힌다(soul.md §8).
      // 264px 시절 5줄 중 2줄만 보이던 실측 결함의 회귀 가드다(캡처로 발견).
      cardScrollHeight: document.getElementById('orbCard').scrollHeight,
      cardClientHeight: document.getElementById('orbCard').clientHeight,
      // 펼치면 전부 확인 처리 — 본 것을 안 봤다고 하지 않는다.
      arcAfterOpen: Number(document.getElementById('orbRing').style.getPropertyValue('--orb-arc')),
      countAfterOpen: txt('orbCount'),
      // **없어야 하는 것** — DOM 실측. 정적 게이트(check-orb.mjs)와 이중으로 건다.
      inputCount: document.querySelectorAll('input, textarea, [contenteditable]').length,
      buttonIds: [...document.querySelectorAll('button')].map((b) => b.id).sort(),
    };
  })()`);

  // 접기 — 왕복 불변 확인
  await orbWin.webContents.executeJavaScript("document.getElementById('orbClose').click()");
  await wait(450);
  const orbCollapsedAfter = orbWin.getBounds();

  report.orbWindow = {
    collapsedBefore: orbCollapsedBefore,
    expandedBounds: orbExpandedBounds,
    collapsedAfter: orbCollapsedAfter,
    collapsed: orbCollapsedProbe,
    panel: orbPanelProbe,
    // (a) 기하
    isCircle76: orbCollapsedProbe.width === 76 && orbCollapsedProbe.height === 76
      && /50%|38px/.test(orbCollapsedProbe.borderRadius),
    dragHandleContract: orbCollapsedProbe.orbRegion === 'drag' && orbCollapsedProbe.coreRegion === 'no-drag',
    // ---------- 리프 1.3.2: 키우미 참조 상태 계약 ----------
    alertBeforeEvent: orbAlertBeforeEvent,
    pixelsQuiet,
    pixelsAlerted,
    // 앞선 검증이 오브에 이벤트를 흘리지 않았다 — 22-A 측정의 전제다.
    quietStateWasClean: orbAlertBeforeEvent === 'none',
    // 2026-08-25 규범 개정 — "평소 **무채색**"에서 "평소 **반쯤**"으로.
    //
    // 옛 조항은 알림 0건에서 파란 픽셀 **0개**를 요구했다. 그 값을 지키려면 평소에
    // 얼굴이 아예 없어야 하고, 그러면 오브는 상주할 이유가 약한 딱딱한 공이 된다.
    // 얼굴은 늘 두되 신호는 색의 **유무**가 아니라 **양**이 지도록 바꾼다:
    // 대기는 34%만 열리고 발화에서 75%로 활짝 열린다(orb.css의 --orb-open).
    //
    // 0을 요구하던 자리에 **비율 상한**을 놓는다. 대기의 파란 면적이 발화의 60%를
    // 넘으면 두 상태가 눈으로 안 갈리고, 그러면 발화는 더 이상 신호가 아니다.
    // 설계비는 ~0.45다(제곱비가 아니다 — clip 원이 바이저 경계에서 포화되므로
    // 첫 판 44%는 실측 1.0으로 이 검사에 잡혔고, 34%로 내려서 갈라졌다).
    // 0.6은 그 위의 회귀 여유이지 봐주는 한계가 아니다.
    quietFaceIsPresent: pixelsQuiet.bluishPixels > 0,
    // 상한만 걸면 얼굴이 통째로 사라져도 통과한다 — 위 하한과 **짝으로** 건다.
    firedIsVisiblyWider:
      pixelsAlerted.bluishRatio > 0
      && pixelsQuiet.bluishRatio <= pixelsAlerted.bluishRatio * 0.6,
    // **알림이 오면 딥블루가 실제로 화면에 있다.** 참조 실측과 같은 판정 기준을 쓴다.
    alertedShowsVisor: pixelsAlerted.bluishRatio >= 0.10,
    // 상태가 바뀌었는데 픽셀이 안 바뀌면 그건 렌더가 아니라 주장이다.
    stateActuallyChangedPixels: pixelsAlerted.bluishPixels > pixelsQuiet.bluishPixels,
    unreadCountShown: orbCollapsedProbe.alert === 'fired' && orbCollapsedProbe.count === '1',
    // 유리는 끝까지 무채색 — 셸 배경은 백색 알파여야 한다(틴트 금지).
    glassStaysAchromatic: /rgba?\(\s*255\s*,\s*255\s*,\s*255\s*[,)]/.test(orbCollapsedProbe.orbBackground),
    // 페이드로 등장하지 않는다 — 전이가 transform/filter를 타야 한다.
    visorNotFadeIn: /transform|filter/.test(orbCollapsedProbe.visorTransition)
      && !/^opacity/.test(orbCollapsedProbe.visorTransition.trim()),
    hasTwoEyes: orbCollapsedProbe.eyeCount === 2,
    // 마젠타 호는 걷어냈다 — 신호는 화면당 한 곳(이 창에서는 바이저)이다.
    magentaArcRemoved: orbCollapsedProbe.ringHasBrand === false,
    // 펼치면 창이 실제로 커진다(패널이 창 밖으로 잘리지 않는다)
    expandGrewWindow: orbExpandedBounds.width > orbCollapsedBefore.width
      && orbExpandedBounds.height > orbCollapsedBefore.height,
    // 오브 원은 화면에서 안 움직인다 — 패널이 안쪽으로 자란다
    orbCornerStayed:
      near(orbExpandedBounds.x + orbExpandedBounds.width, orbCollapsedBefore.x + orbCollapsedBefore.width)
      && near(orbExpandedBounds.y + orbExpandedBounds.height, orbCollapsedBefore.y + orbCollapsedBefore.height),
    // 왕복 불변 — 접으면 정확히 제자리
    roundTripRestoresPosition:
      near(orbCollapsedAfter.x, orbCollapsedBefore.x) && near(orbCollapsedAfter.y, orbCollapsedBefore.y)
      && orbCollapsedAfter.width === orbCollapsedBefore.width
      && orbCollapsedAfter.height === orbCollapsedBefore.height,
    // (b) 정직성 계약 4종 — 값이 실제로 채워졌는지
    hasFiredBadge: /^\d{2}:\d{2} 발화$/.test(orbPanelProbe.badge || ''),
    hasModeLabel: orbPanelProbe.mode === '실시간 (WS)',
    hasRelativeTime: /분 전|방금/.test(orbPanelProbe.relative || ''),
    hasSourceLabel: /묻지 않은 턴입니다/.test(orbPanelProbe.source || ''),
    // 시점 고지 — 결정론 템플릿의 문장을 그대로 쓰는지
    statesValueIsAtFireTime: /발화 시점 기준/.test(orbPanelProbe.body || ''),
    representativeCardRendered: orbPanelProbe.cardRows >= 3,
    // 대표 카드 전체가 스크롤 없이 보인다 — 값이 잘리면 카드가 아니라 미끼다.
    representativeCardFullyVisible:
      orbPanelProbe.cardScrollHeight <= orbPanelProbe.cardClientHeight + 2,
    markedReadOnOpen: orbPanelProbe.arcAfterOpen === 0 && orbPanelProbe.countAfterOpen === '',
    // (c) 없어야 하는 것
    noInputSurface: orbPanelProbe.inputCount === 0,
    onlyAllowedButtons: JSON.stringify(orbPanelProbe.buttonIds) === JSON.stringify(['orbClose', 'orbMore', 'orbToggle']),
  };
  console.log('[verify] 검증22(알림 오브):', JSON.stringify(report.orbWindow));
  for (const key of [
    'isCircle76', 'dragHandleContract',
    'quietStateWasClean', 'quietFaceIsPresent', 'firedIsVisiblyWider',
    'alertedShowsVisor', 'stateActuallyChangedPixels',
    'unreadCountShown', 'glassStaysAchromatic', 'visorNotFadeIn', 'hasTwoEyes', 'magentaArcRemoved',
    'expandGrewWindow', 'orbCornerStayed', 'roundTripRestoresPosition',
    'hasFiredBadge', 'hasModeLabel', 'hasRelativeTime', 'hasSourceLabel',
    'statesValueIsAtFireTime', 'representativeCardRendered', 'representativeCardFullyVisible', 'markedReadOnOpen',
    'noInputSurface', 'onlyAllowedButtons',
  ]) {
    assertOk(`orbWindow.${key}`, report.orbWindow[key] === true);
  }

  // 검증 22b — "더보기"가 셸을 앞으로 가져오고 대표 카드를 중앙 캔버스에 쌓는다.
  // **주문은 여기서도 집행되지 않는다**(확정 결정 3) — 이 경로가 하는 일은
  // 창을 올리고 카드를 그리는 것뿐이고, 카드는 기존 facts 봉투다(신규 타입 0개).
  await shellWin.webContents.executeJavaScript("window.AthenaShell.clearCanvases()");
  await wait(120);
  const orbEnvelope = mainMod.routineEventToFactsEnvelope({
    type: 'routine-fired', routine_id: 'vorb2', symbol: '005930',
    source: 'price.change_rate', mode: 'realtime-ws', observed: 5.3, threshold: 5.0,
    note: '오브 더보기 검증', fired_at: new Date().toISOString(),
  });
  ipcMain.emit('athena:orb-open-shell', {}, {
    event: {
      type: 'routine-fired', routine_id: 'vorb2', symbol: '005930',
      source: 'price.change_rate', mode: 'realtime-ws', observed: 5.3, threshold: 5.0,
      note: '오브 더보기 검증', fired_at: new Date().toISOString(),
    },
  });
  await wait(500);
  const orbMoreProbe = await shellWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('#grid .card.facts');
    return {
      factsCardCount: document.querySelectorAll('#grid .card.facts').length,
      caption: card ? (card.querySelector('.card-title') || {}).textContent || null : null,
      rowCount: card ? card.querySelectorAll('.facts-row').length : 0,
      // 실행 어포던스가 카드에 딸려오면 안 된다.
      execButtons: [...document.querySelectorAll('#grid .card.facts button')]
        .map((b) => b.textContent.trim())
        .filter((t) => /실행|매수|매도|주문/.test(t)).length,
    };
  })()`);
  report.orbMoreToShell = {
    envelopeType: orbEnvelope.canvas_type,
    envelopeFieldCount: orbEnvelope.data.fields.length,
    ...orbMoreProbe,
    shellVisible: shellWin.isVisible(),
    // 신규 카드 타입 0개 — 기존 facts 봉투로 접는다.
    usesExistingFactsType: orbEnvelope.canvas_type === 'facts',
    cardRendered: orbMoreProbe.factsCardCount === 1 && orbMoreProbe.rowCount >= 3,
    // 시점 고지가 캔버스까지 따라온다
    captionStatesFireTime: /발화 시점 기준/.test(orbMoreProbe.caption || ''),
    noExecAffordanceOnCard: orbMoreProbe.execButtons === 0,
  };
  console.log('[verify] 검증22b(오브 더보기 → 셸):', JSON.stringify(report.orbMoreToShell));
  assertOk('orbMoreToShell: 기존 facts 봉투를 쓴다(신규 카드 타입 0개)', report.orbMoreToShell.usesExistingFactsType === true);
  assertOk('orbMoreToShell: 셸 창이 앞으로 온다', report.orbMoreToShell.shellVisible === true);
  assertOk('orbMoreToShell: 대표 카드가 중앙 캔버스에 실제로 그려진다', report.orbMoreToShell.cardRendered === true);
  assertOk('orbMoreToShell: 시점 고지가 카드까지 따라온다', report.orbMoreToShell.captionStatesFireTime === true);
  assertOk('orbMoreToShell: 카드에 실행 어포던스가 없다(확정 결정 3)', report.orbMoreToShell.noExecAffordanceOnCard === true);

  // 2026-08-24 리프 1.3.1: 이 블록을 파일 맨 끝으로 옮겼다. 원래는 검증 19 앞에
  // 있었는데, 그 자리에서는 뒤에 찍히는 캡처(검증 20~22)를 훑지 못한다 — 오브
  // 캡처 2장이 그 사각지대에 들어가면서 실측으로 드러났다(중복 감지가 14장만
  // 보고 16장을 못 봤다). 검사 대상이 "지금까지 찍은 것"이 아니라 "전부"여야
  // 회귀 감지망으로 성립한다.
  // ---------- 검증 18: 캡처 신뢰성 — 연속 캡처 중복 감지 (2026-08-19 QA 결함 #2 재발 방지,
  // 디자인 갈래에서는 검증17이었다 — 병합 시 능동 턴 검증17과 번호가 겹쳐 18로 재부여) ----------
  // 같은 창을 연속으로 찍은 두 캡처가 MD5까지 완전히 같으면, 둘 중 하나(대개
  // 나중 것)는 화면이 바뀌기 전 프레임을 찍은 것이다 — 파일명이 주장하는 화면을
  // 실제로 담지 못했다는 뜻이라 값 자체가 신뢰 불가다. shot()의 rAF 2회 대기로
  // 근본 원인은 고쳤지만, 이 단언은 회귀를 잡는 감지망이다(완화가 아니라 추가).
  // 2026-08-24 리프 1.2.1: 예외 목록이 비었다. 옛 예외는 03b(캔버스 펼침 중의 대화
  // 창)→04(수축 후 대화 창) 한 쌍이었다 — 캔버스 창의 가시성이 대화 창 DOM을 안
  // 바꾸므로 두 장이 픽셀까지 같은 것이 정상이었다. 확장/수축 연출과 함께 두 캡처
  // 자체가 사라졌다. 예외를 관성으로 남기면 "예외라서 통과"가 조용히 쌓인다.
  const EXPECTED_IDENTICAL = new Set();
  const dupCaptures = [];
  for (let i = 1; i < captureLog.length; i++) {
    const prev = captureLog[i - 1];
    const cur = captureLog[i];
    if (EXPECTED_IDENTICAL.has(`${prev.name}>>>${cur.name}`)) continue;
    if (prev.winTitle === cur.winTitle && prev.hash === cur.hash) {
      dupCaptures.push({ prev: prev.name, cur: cur.name, hash: cur.hash });
    }
  }
  report.captureIntegrity = { totalShots: captureLog.length, duplicates: dupCaptures };
  console.log('[verify] 검증18(캡처 신뢰성):', JSON.stringify(report.captureIntegrity));
  assertOk('captureIntegrity: no adjacent same-window capture is byte-identical', dupCaptures.length === 0);

  report.finishedAt = new Date().toISOString();
  // ---------- 그래프 모드 (leaf 8 / W2-3) ----------
  //
  // 재는 것 둘: (1) 토글하면 캔버스가 **비어 있지 않다**, (2) 그려진 노드 수가
  // 배치 결과와 일치한다. 스크린샷 픽셀 대조는 하지 않는다 — 기준 이미지 관리
  // 비용이 붙고, 여기서 답해야 하는 질문은 '그려졌는가'이지 '똑같이 생겼는가'가 아니다.
  //
  // '비어 있지 않은가'의 판정은 `describeRendered()` 하나만 쓴다. 여기서 따로
  // 세면 렌더러와 검증기가 서로 다른 답을 낼 수 있다.
  try {
    const graph = await shellWin.webContents.executeJavaScript(`(async () => {
      const pill = document.getElementById('graphPill');
      const container = document.getElementById('graphCanvas');
      if (!pill || !container || !window.AthenaGraphMode) {
        return { wired: false, reason: 'missing' };
      }
      // **가시성**으로 판정한다. 요소가 DOM에 있는지만 보면, 필이 영영 hidden인
      // 채로도 'wired'가 되어 사람이 못 닿는 기능을 검증됐다고 적게 된다.
      //
      // 그런데 숨은 이유를 여기서 물어야 한다. "브레인이 꺼져서 숨었다"와
      // "보이게 하는 코드가 없어서 숨었다"는 화면이 똑같다 — 재지 않으면 후자를
      // 전자로 읽고 건너뛴다. 실제로 그 일이 있었다(G70). 그래서 브레인 상태를
      // **따로** 물어 둘을 가른다.
      const status = await window.athena.invoke('athena:brain-status').catch(() => null);
      const brainReady = Boolean(status && status.ok && status.ready);
      // 가용성 프로브는 비동기라 아직 안 끝났을 수 있다. 잠깐 기다려 본다.
      if (pill.hidden && brainReady) {
        const until = Date.now() + 3000;
        while (pill.hidden && Date.now() < until) {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      if (pill.hidden) {
        return {
          wired: false,
          reason: brainReady ? 'hidden-though-ready' : 'unavailable',
          brainReady,
        };
      }
      // 사람이 밟는 길 그대로 — API를 직접 부르지 않고 필을 누른다.
      pill.click();
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (!container.hidden
            && window.AthenaLib.GraphRender.describeRendered(container).rendered) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const clickOpened = !container.hidden;
      const byClick = window.AthenaLib.GraphRender.describeRendered(container);
      // 좌표 계약은 배치 결과와 대조해야 알 수 있고, 클릭 경로는 그 값을 돌려주지
      // 않는다. 요약으로 접었다 다시 펴서 같은 화면의 배치를 받아 온다.
      await window.AthenaGraphMode.toggle();
      const placed = await window.AthenaGraphMode.toggle();
      const drawn = window.AthenaLib.GraphRender.describeRendered(container);
      return {
        wired: true,
        clickOpened,
        byClick,
        containerVisible: !container.hidden,
        summaryHidden: document.getElementById('mosaic').hidden,
        placedNodes: placed ? placed.nodes.length : 0,
        placedEdges: placed ? placed.edges.length : 0,
        drawn,
      };
    })()`);
    report.graphMode = graph;
    if (graph.wired) {
      // 필 클릭 하나로 열려야 한다 — API 직접 호출로만 열리면 사람은 못 쓴다.
      assertOk('graph-mode: 필을 누르면 그래프가 열린다', graph.clickOpened === true);
      assertOk('graph-mode: 필 클릭만으로 캔버스가 채워진다', graph.byClick.rendered === true);
      assertOk('graph-mode: 토글하면 그래프 영역이 보인다', graph.containerVisible === true);
      assertOk('graph-mode: 토글하면 요약이 숨는다', graph.summaryHidden === true);
      // 노드가 0개면 '빈 캔버스'와 '고장'을 구분할 수 없다. 브레인이 꺼져 있으면
      // 애초에 wired=false로 빠지므로, 여기 왔다면 그려진 것이 있어야 한다.
      assertOk('graph-mode: 캔버스가 비어 있지 않다', graph.drawn.rendered === true);
      assertOk(
        'graph-mode: 그려진 노드 수가 배치와 일치한다',
        graph.drawn.nodes === graph.placedNodes,
      );
      assertOk(
        'graph-mode: 그려진 엣지 수가 배치와 일치한다',
        graph.drawn.edges === graph.placedEdges,
      );
      report.graphMode.shot = await shot(shellWin, '90-graph-mode.png');
    } else if (graph.reason === 'hidden-though-ready') {
      // 브레인은 준비됐다는데 필이 숨어 있다 — 사람이 닿을 수 없는 기능이다.
      failures.push('graph-mode: 브레인이 준비됐는데도 필이 숨어 있다');
    } else if (graph.reason === 'unavailable') {
      // 브레인이 꺼져 있으면 필도 숨는 것이 맞다 — 측정 대상이 없다. 실패로 세지
      // 않되 **보고는 한다**. 조용히 건너뛰면 '검증됐다'로 읽힌다.
      dlog('graph-mode: 브레인 꺼짐(필 숨김) — 측정 건너뜀');
    } else {
      // 필·캔버스·전역 중 하나가 아예 없다. 이건 "꺼져 있다"가 아니라 배선이
      // 끊긴 것이므로 실패다.
      failures.push('graph-mode: 배선이 끊겼다 (필/캔버스/전역 누락)');
    }
  } catch (err) {
    report.graphMode = { error: String((err && err.message) || err) };
    failures.push('graph-mode: 검증 블록이 예외로 끝났다');
  }
  fs.writeFileSync(path.join(CAPTURES, 'VERIFY-REPORT.json'), JSON.stringify(report, null, 2));
  console.log('[verify] 리포트 저장:', path.join(CAPTURES, 'VERIFY-REPORT.json'));

  if (failures.length) {
    console.error(`[verify] 실패 단언 ${failures.length}건:`);
    for (const f of failures) console.error(`  - ${f}`);
  } else {
    console.log('[verify] 전 단언 통과');
  }
  // 실측(2026-08-18, 최소 재현 스크립트로 확인): 이 Electron 43.x/Windows
  // 조합에서 process.exitCode를 세팅한 뒤 app.quit()으로 끝내면 **항상 exit 0**
  // 이다 — app.quit()의 정상 종료 경로가 process.exitCode를 무시한다. probe-
  // chart-*.js가 이미 쓰는 패턴(성공은 app.quit(), 실패는 app.exit(1) 직접
  // 호출)을 그대로 따라야 실제로 exit code가 반영된다. process.exitCode도
  // 참고용으로 같이 세팅해둔다(의미는 맞고, 다른 종료 경로를 타면 쓰인다).
  process.exitCode = failures.length ? 1 : 0;

  await wait(200);
  if (failures.length) {
    dlog('quitting with failures'); app.exit(1);
  } else {
    dlog('quitting'); app.quit();
  }
});
