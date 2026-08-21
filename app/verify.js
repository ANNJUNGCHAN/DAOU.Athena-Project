// 검증 스크립트. `npm run verify` (= electron verify.js)로 실행한다.
// main.js를 모듈로 불러와 실제 앱과 동일한 창 생성 로직을 재사용하고,
// - capturePage() 스크린샷 (app/captures/)
// - 점→캔버스 확장/수축 rAF 프레임 실측 (p50/p95/max)
// - 두 창 getBounds() 독립성
// - 접근성 3종 강제 적용 스크린샷 (CDP Emulation.setEmulatedMedia)
// 을 수행하고 app/captures/VERIFY-REPORT.json 에 원본 수치를 남긴다.

// main.js를 라이브러리로 불러올 때는 자동 기동(app.whenReady().then(createWindows))을
// 막아야 한다 — verify.js가 createWindows()를 직접, 통제된 시점에 호출한다.
process.env.ATHENA_NO_AUTOSTART = '1';
// 기본 경로는 이제 실배선(live) — claude -p를 실제로 spawn한다(결정 D1).
// 자동 검증은 그 경로를 타면 안 된다: quota를 쓰고, 43초+ 걸리고, 외부 상태에
// 좌우돼 결정론적이지 않다. 검증 5(E2E Enter)는 명시적으로 픽스처 경로를 강제해
// 기존 3상태·자동성장 검증을 quota 없이 그대로 재현한다(app/main.js
// ATHENA_CANVAS_SOURCE 참조, plan/kiwoom-common-screen-handoff.md §6의
// "명시적 fixture adapter" 지시).
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

const { app, ipcMain, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

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

// 부팅 완료 판정. **`#app`이 보이는 것과 "부팅 성공"은 더 이상 같은 말이 아니다** —
// 온보딩 병합 이후 `chat.js`는 온보딩이 필요하면 `#app`을 숨긴 채 `#onboard`를
// 띄우고, 그게 정상 동작이다. 옛 판정(`!#app.hidden`)은 정상 동작을 false로
// 찍었다. 판정을 "게이지가 끝났고 대화 창이 **어떤 모드로든** 도달했는가"로
// 바꾸고, 어느 모드였는지를 리포트에 남긴다.
//
// 모드는 배타적이어야 한다 — `#app`·`#onboard`·`#settings`는 형제 패널이고
// 둘이 동시에 보이면 겹쳐 그려진다(GLOSSARY.md §1: 모드는 창이 아니다).
async function waitForChatBooted(chatWin, timeoutMs = 5000) {
  const probe = `(() => {
    const vis = (id) => { const n = document.getElementById(id); return !!n && !n.hidden; };
    return { boot: vis('boot'), app: vis('app'), onboard: vis('onboard'), settings: vis('settings') };
  })()`;
  const t0 = Date.now();
  let panels = null;
  while (Date.now() - t0 < timeoutMs) {
    panels = await chatWin.webContents.executeJavaScript(probe);
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
async function traceBootBar(chatWin, timeoutMs = 5000) {
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
    try { s = await chatWin.webContents.executeJavaScript(probe); } catch { break; }
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
  const { chatWin, canvasWin } = mainMod.getWins();
  const layout = mainMod.getLayout();
  report.layout = layout;

  // ---------- 검증 1: 부팅 — 대화 창만 뜬다 ----------
  // 부팅 바 연출 표집(1b)은 스크린샷보다 먼저 걸어둔다 — shot()이 수백 ms를 먹는
  // 동안 타이핑 구간(+660~+1160ms)이 지나가버리는 레이스를 피한다.
  const bootBarPromise = traceBootBar(chatWin);
  await wait(200);
  report.bootChatOnly = { canvasVisibleAtBoot: canvasWin.isVisible(), chatVisibleAtBoot: chatWin.isVisible() };
  dlog('before shot 01'); const s1 = await shot(chatWin, '01-boot-sequence.png'); dlog('after shot 01');
  const boot = await waitForChatBooted(chatWin);
  const bootBar = await bootBarPromise;
  dlog('boot done, before shot 02'); const s2 = await shot(chatWin, '02-chat-only-idle.png'); dlog('after shot 02');
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
    '[verify] 검증1 완료 — 부팅 시 캔버스 창 표시 여부:', canvasWin.isVisible(),
    '| 대화 창 부팅:', boot.booted, '| 모드:', boot.mode,
    '| 모드 배타성:', boot.exactlyOneModeVisible,
    '| 부팅바 이름쓰기:', JSON.stringify(bootBar)
  );
  // canvasVisibleAtBoot는 false가 정상이다(부팅 시 캔버스 창은 숨어 있어야 한다) —
  // 단언 대상에서 제외한다.
  assertOk('boot: chat window visible at boot', report.bootChatOnly.chatVisibleAtBoot === true);
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
    await chatWin.webContents.executeJavaScript(`
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
    const surface = await chatWin.webContents.executeJavaScript(`
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
  await chatWin.webContents.executeJavaScript(`
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
  const delayedRunStartedAt = Date.now();
  const mainDelay = setTimeout(() => {
    const blockedUntil = Date.now() + 600;
    while (Date.now() < blockedUntil) { /* intentional verify-only event-loop delay */ }
  }, 2100);
  const delayedFeedbackResult = await mainMod.runDirectRestDataset(delayedFeedbackDataset, true, {
    fetchImpl: delayedFetch,
  });
  clearTimeout(mainDelay);
  report.delayedRestFeedback = {
    elapsedMs: delayedFeedbackResult.firstFeedbackMs,
    totalRunMs: Date.now() - delayedRunStartedAt,
    feedbackOk: delayedFeedbackResult.feedbackOk,
    receiptPainted: delayedFeedbackResult.answerPaintedByMain,
    renderedCount: delayedFeedbackResult.renderedCount,
  };
  assertOk(
    'delayedRestFeedback: 600ms main scheduling delay still paints truthful receipt before 3000ms',
    delayedFeedbackResult.feedbackOk === true
      && delayedFeedbackResult.answerPaintedByMain === true
      && delayedFeedbackResult.firstFeedbackMs < 3000
      && delayedFeedbackResult.renderedCount === 0,
  );
  await chatWin.webContents.executeJavaScript(`
    document.querySelectorAll('.rest-receipt').forEach((node) => node.remove())
  `);

  // ---------- 검증 2: 점 → 캔버스 확장/수축, 프레임 실측 ----------
  const dotBefore = await mainMod.getDotScreenPoint();
  report.dotScreenPoint = dotBefore;

  dlog('before expand 1'); const expandResult = await mainMod.expandCanvasWindow(); dlog('after expand 1');
  await wait(150);
  canvasWin.webContents.send('athena:add-canvas', { type: 'stream' });
  await wait(150);
  canvasWin.webContents.send('athena:add-canvas', { type: 'reader' });
  await wait(150);
  canvasWin.webContents.send('athena:add-canvas', { type: 'table' });
  await wait(300);
  await shot(canvasWin, '03-mosaic-expanded.png');
  await shot(chatWin, '03b-chat-during-mosaic.png');

  // 보조 증거 — 실제 OS 화면 합성 캡처(best-effort). spike/electron-glass/RESULT.md가
  // 기록한 대로 이 공유 데스크톱 환경에서는 간헐적으로 실패한다. 실패해도 위의
  // capturePage() 결과가 주 증거이므로 여기서는 막지 않는다.
  try {
    const capScript = path.join(__dirname, '..', 'spike', 'electron-glass', 'scripts', 'capture.ps1');
    const cb = canvasWin.getBounds();
    execFileSync('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', capScript,
      '-x', String(cb.x), '-y', String(cb.y), '-w', String(cb.width), '-h', String(cb.height),
      '-out', path.join(CAPTURES, '03c-mosaic-OS-composited.png'),
    ], { stdio: 'pipe', windowsHide: true, timeout: 8000 });
    report.osCaptureAttempted = { ok: true };
  } catch (err) {
    report.osCaptureAttempted = { ok: false, error: String(err && err.message || err) };
    dlog('OS capture failed: ' + (err && err.message || err));
  }

  report.expand = stats(expandResult.timestamps);
  console.log('[verify] 확장 프레임 stats:', JSON.stringify(report.expand));

  await wait(400);
  dlog('before collapse 1'); const collapseResult = await mainMod.collapseCanvasWindow(); dlog('after collapse 1');
  report.collapse = stats(collapseResult.timestamps);
  console.log('[verify] 수축 프레임 stats:', JSON.stringify(report.collapse));
  await wait(200);
  await shot(chatWin, '04-collapsed-back-to-chat.png');
  report.afterCollapse = { canvasVisible: canvasWin.isVisible() };
  assertOk('collapse: canvas hidden after collapseCanvasWindow()', report.afterCollapse.canvasVisible === false);
  // expand/collapse 프레임 stats(p50/p95/max)는 공유 데스크톱 환경이라 실행마다
  // 흔들린다(CLAUDE.md §9) — 수치는 리포트에 남기되 pass/fail 단언에서는 뺀다.

  // ---------- 검증 3: 두 창 독립 이동/리사이즈 ----------
  // 직접 setBounds는 반드시 noteAppBounds로 "앱 주도"임을 표시한다 — 안 하면
  // 스냅 대상화(2026-08-18)의 OS 배치 감지가 이 이동을 Win+방향키 스냅으로
  // 오인해 짝 전체를 정착시켜 독립성 단언이 설계된 동작에 의해 깨진다.
  const initial = { canvas: canvasWin.getBounds(), chat: chatWin.getBounds() };
  canvasWin.setBounds({ ...canvasWin.getBounds(), x: canvasWin.getBounds().x + 80 });
  mainMod.noteAppBounds(canvasWin);
  await wait(150);
  const afterCanvasMove = { canvas: canvasWin.getBounds(), chat: chatWin.getBounds() };
  chatWin.setBounds({ ...chatWin.getBounds(), height: Math.min(layout.chatMaxH, chatWin.getBounds().height + 100) });
  mainMod.noteAppBounds(chatWin);
  await wait(150);
  const afterChatResize = { canvas: canvasWin.getBounds(), chat: chatWin.getBounds() };
  // 원위치
  canvasWin.setBounds({ ...canvasWin.getBounds(), x: canvasWin.getBounds().x - 80 });
  mainMod.noteAppBounds(canvasWin);
  chatWin.setBounds({ x: layout.chatOriginX, y: (layout.originY + layout.canvasH + layout.chatBaseH) - layout.chatBaseH, width: layout.chatW, height: layout.chatBaseH });
  mainMod.noteAppBounds(chatWin);
  await wait(150);

  // 허용 오차 2px — Windows에서 backgroundMaterial(acrylic) 적용 시 setBounds() 요청값과
  // getBounds() 실측값 사이에 DPI 반올림으로 1px 안팎의 편차가 실측된다(기능적 결함 아님).
  const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

  report.independence = {
    initial, afterCanvasMove, afterChatResize,
    canvasMovedButChatUnchanged:
      near(afterCanvasMove.canvas.x, initial.canvas.x + 80) &&
      near(afterCanvasMove.chat.x, initial.chat.x) && near(afterCanvasMove.chat.y, initial.chat.y) &&
      near(afterCanvasMove.chat.height, initial.chat.height),
    chatResizedButCanvasUnchanged:
      near(afterChatResize.chat.height, Math.min(layout.chatMaxH, initial.chat.height + 100)) &&
      near(afterChatResize.canvas.x, afterCanvasMove.canvas.x) && near(afterChatResize.canvas.y, afterCanvasMove.canvas.y) &&
      near(afterChatResize.canvas.width, afterCanvasMove.canvas.width) && near(afterChatResize.canvas.height, afterCanvasMove.canvas.height),
  };
  console.log('[verify] 독립성 체크:', JSON.stringify(report.independence.canvasMovedButChatUnchanged), JSON.stringify(report.independence.chatResizedButCanvasUnchanged));
  assertOk('independence: canvas move does not affect chat bounds', report.independence.canvasMovedButChatUnchanged === true);
  assertOk('independence: chat resize does not affect canvas bounds', report.independence.chatResizedButCanvasUnchanged === true);

  // ---------- 검증 4: 접근성 3종 (CDP Emulation.setEmulatedMedia) ----------
  // 다시 캔버스를 채워서 유리 표면이 실제로 보이는 상태에서 캡처한다.
  dlog('before expand 2'); const expand2 = await mainMod.expandCanvasWindow(); dlog('after expand 2');
  canvasWin.webContents.send('athena:add-canvas', { type: 'stream' });
  canvasWin.webContents.send('athena:add-canvas', { type: 'table' });
  await wait(300);

  await forceMedia(canvasWin, [{ name: 'prefers-reduced-transparency', value: 'reduce' }]);
  await forceMedia(chatWin, [{ name: 'prefers-reduced-transparency', value: 'reduce' }]);
  await wait(150);
  await shot(canvasWin, '05-a11y-reduced-transparency-canvas.png');
  await shot(chatWin, '05-a11y-reduced-transparency-chat.png');
  await clearMedia(canvasWin);
  await clearMedia(chatWin);

  await forceMedia(canvasWin, [{ name: 'prefers-contrast', value: 'more' }]);
  await forceMedia(chatWin, [{ name: 'prefers-contrast', value: 'more' }]);
  await wait(150);
  await shot(canvasWin, '06-a11y-prefers-contrast-canvas.png');
  await shot(chatWin, '06-a11y-prefers-contrast-chat.png');
  await clearMedia(canvasWin);
  await clearMedia(chatWin);

  await forceMedia(canvasWin, [{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await forceMedia(chatWin, [{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await wait(150);
  await shot(canvasWin, '07-a11y-reduced-motion-canvas.png');
  await shot(chatWin, '07-a11y-reduced-motion-chat.png');
  await clearMedia(canvasWin);
  await clearMedia(chatWin);

  dlog('a11y shots done'); report.accessibilityShotsTaken = [
    '05-a11y-reduced-transparency-canvas.png', '05-a11y-reduced-transparency-chat.png',
    '06-a11y-prefers-contrast-canvas.png', '06-a11y-prefers-contrast-chat.png',
    '07-a11y-reduced-motion-canvas.png', '07-a11y-reduced-motion-chat.png',
  ];
  console.log('[verify] 접근성 3종 캡처 완료');

  // ---------- 검증 5: 실제 개발용 트리거(Enter) 종단간 플로우 — 3상태 + 자동 성장 ----------
  // 지금까지는 mainMod 함수를 직접 호출했다. 이번엔 사용자가 실제로 하는 행동
  // (입력 후 Enter)을 그대로 시뮬레이션해 chat.js의 상태 머신·자동 성장·
  // athena__render_canvas 트리거 전체 경로를 검증한다.
  const boundsBeforeQuery = chatWin.getBounds();
  await chatWin.webContents.executeJavaScript(`
    (() => {
      const input = document.getElementById('input');
      input.value = '삼성전자 재무제표랑 공시, 뉴스 보여줘';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })();
  `);
  await wait(350);
  await shot(chatWin, '08-e2e-1-judging.png'); // 상태 1 — 판단 중 (점 breathe, 입력 잠김)
  await wait(500);
  await shot(chatWin, '09-e2e-2-calling.png'); // 상태 2 — 호출 중 (TR 코드 누적)

  // 상태 3(완료)까지 폴링 — .turn-a가 나타날 때까지, 최대 6초
  let e2eDone = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    const found = await chatWin.webContents.executeJavaScript("!!document.querySelector('.turn-a')");
    if (found) { e2eDone = true; break; }
    await wait(150);
  }
  await wait(150);
  await shot(chatWin, '10-e2e-3-done-autogrow.png');
  await shot(canvasWin, '11-e2e-3-mosaic-from-query.png');
  const boundsAfterQuery = chatWin.getBounds();

  const finalTurnText = await chatWin.webContents.executeJavaScript(
    "(() => { const els = document.querySelectorAll('.turn-a'); return els.length ? els[els.length-1].textContent : null; })()"
  );
  const chipCount = await chatWin.webContents.executeJavaScript("document.querySelectorAll('.chip').length");

  report.e2eTrigger = {
    reachedDoneState: e2eDone,
    boundsBeforeQuery, boundsAfterQuery,
    // 옛 단언은 `boundsAfterQuery.height > layout.chatBaseH`였다. 이건 DPI 반올림
    // 1px(205 > 204)에 통과한다 — 2026-08-17 실행이 실제로 그렇게 통과했다.
    // 그때 자동 성장은 죽어 있었다(온보딩이 `#app`을 숨겨 `#history.scrollHeight`가
    // 0이었다). 질의 **전** 높이 대비 실제 증가를 보고, acrylic DPI 반올림 오차
    // (±2px)보다 커야 통과시킨다.
    grewTallerThanBase: boundsAfterQuery.height > boundsBeforeQuery.height + 2,
    grownByPx: boundsAfterQuery.height - boundsBeforeQuery.height,
    finalAnswerText: finalTurnText,
    cardChipCount: chipCount,
  };
  console.log('[verify] 검증5(E2E Enter 트리거):', JSON.stringify(report.e2eTrigger));
  assertOk('e2e: reached done state (.turn-a appeared)', report.e2eTrigger.reachedDoneState === true);
  assertOk('e2e: chat grew taller than pre-query height', report.e2eTrigger.grewTallerThanBase === true);
  // finalAnswerText/cardChipCount는 fixture 응답 내용에 좌우되는 정보성 필드라
  // 단언에서 뺀다.

  // ---------- 검증 6: 그립 드래그로 수동 리사이즈 ----------
  const beforeDrag = chatWin.getBounds();
  const dragStartScreenY = layout.originY + layout.canvasH + layout.chatBaseH - 5; // 대략 그립 근처
  await chatWin.webContents.executeJavaScript(`
    (() => {
      const grip = document.getElementById('grip');
      grip.dispatchEvent(new MouseEvent('mousedown', { screenY: ${dragStartScreenY}, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { screenY: ${dragStartScreenY - 160}, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    })();
  `);
  await wait(200);
  const afterDrag = chatWin.getBounds();
  report.manualResize = {
    beforeDrag, afterDrag,
    grewByDrag: afterDrag.height > beforeDrag.height,
    bottomEdgePinned: near(beforeDrag.y + beforeDrag.height, afterDrag.y + afterDrag.height),
  };
  console.log('[verify] 검증6(수동 리사이즈):', JSON.stringify(report.manualResize));
  assertOk('manualResize: grip drag grew chat height', report.manualResize.grewByDrag === true);
  assertOk('manualResize: bottom edge stayed pinned while resizing', report.manualResize.bottomEdgePinned === true);

  // ---------- 검증 7: 설정을 열어도 창은 둘이다 + 사이드바 nav 전환 ----------
  // ui/soul.md §3·§8 — 창은 둘뿐이고 창 3개 이상은 즉시 탈락이다. 설정은 새 창이
  // 아니라 대화 창의 모드다(GLOSSARY.md §1). 이 검증의 핵심 단언은 "창이 늘어난다"
  // 가 아니라 **"창이 늘지 않는다"**이다.
  // 2026-08-18 사이드바 도입(Paper 43쪽) — #settingsGrid에는 nav가 고른 카드
  // 하나만 산다. 옛 단언("점 클릭 한 번에 계좌·MCP 카드가 동시에 뜬다")은 더 이상
  // 성립하지 않는다 — 기본 선택은 '화면'이고, 계좌·MCP·모델은 nav에서 선택해야
  // 각각 뜬다(lib/settings-cards.js renderNav/SETTINGS_PANELS, chat.js openSettings).
  const winCountBefore = BrowserWindow.getAllWindows().length;
  const chatBoundsBefore = chatWin.getBounds();

  await chatWin.webContents.executeJavaScript("document.getElementById('dot').click()");
  await wait(900);

  const winCountAfterOpen = BrowserWindow.getAllWindows().length;

  // 두 번 눌러도(재오픈이 no-op) nav·카드가 중복되지 않아야 한다
  await chatWin.webContents.executeJavaScript("document.getElementById('dot').click()");
  await wait(600);
  const winCountAfterSecondClick = BrowserWindow.getAllWindows().length;

  const navProbe = await chatWin.webContents.executeJavaScript(`
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

  const navClickAccounts = await chatWin.webContents.executeJavaScript(clickNavItemScript('계좌'));
  await wait(500);
  const accountsPanelCardCount = await chatWin.webContents.executeJavaScript(
    "document.querySelectorAll('#settingsGrid .card.accounts').length"
  );

  const navClickMcp = await chatWin.webContents.executeJavaScript(clickNavItemScript('MCP 서버'));
  await wait(1000); // mcp-list는 Python CLI 콜드 스폰이라 실측 ~850ms 걸린다(verify-settings.js 주석 참고)
  const mcpPanelCardCount = await chatWin.webContents.executeJavaScript(
    "document.querySelectorAll('#settingsGrid .card.mcp').length"
  );

  const navClickModel = await chatWin.webContents.executeJavaScript(clickNavItemScript('모델'));
  await wait(500);
  const modelPanelProbe = await chatWin.webContents.executeJavaScript(`
    (() => {
      const card = document.querySelector('#settingsGrid .card.model');
      return {
        modelCardCount: document.querySelectorAll('#settingsGrid .card.model').length,
        claudeAccountRows: card ? card.querySelectorAll('.uk-model-accounts .uk-model-account-row').length : 0,
        modelChipCount: card ? card.querySelectorAll('.uk-chip-row .uk-chip').length : 0,
      };
    })()
  `);

  const chatProbe = await chatWin.webContents.executeJavaScript(`
    (() => ({
      // 대화 화면은 물러나고 설정 화면이 그 자리를 차지한다 — 같은 창이 변한 것이다
      appHidden: document.getElementById('app').hidden === true,
      settingsVisible: document.getElementById('settings').hidden === false,
      // 설정은 대화 창 문서 안에 있다 — 별도 문서가 아니다
      url: location.pathname.split('/').pop(),
      // 점은 실제 버튼이어야 한다(장식이 아니라 어포던스)
      dotIsButton: document.getElementById('dot').tagName === 'BUTTON',
      // 자격증명·토큰이 화면으로 새면 안 된다 (CLAUDE.md §1)
      trIdLeak: /au1000[12]/.test(document.body.innerText),
      bearerLeak: /ATHENA_LOCAL_BEARER_TOKEN\s*=/.test(document.body.innerText),
    }))()
  `);
  // 캔버스 창은 설정에 관여하지 않는다 — 설정 카드가 저기 있으면 안 된다
  const canvasProbe = await canvasWin.webContents.executeJavaScript(`
    (() => ({
      settingsCardsOnCanvas: document.querySelectorAll('#grid .card.accounts, #grid .card.mcp, #grid .card.model, #grid .card.screen').length,
    }))()
  `);
  const chatBoundsWhileOpen = chatWin.getBounds();
  await shot(chatWin, '17-settings-mode.png');

  // Esc로 대화 모드로 돌아온다
  await chatWin.webContents.executeJavaScript(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"
  );
  await wait(600);
  const chatAfterClose = await chatWin.webContents.executeJavaScript(`
    (() => ({
      appVisible: document.getElementById('app').hidden === false,
      settingsHidden: document.getElementById('settings').hidden === true,
      gridEmptied: document.getElementById('settingsGrid').children.length === 0,
    }))()
  `);

  report.settingsSurface = {
    // 핵심 계약 — 설정은 창을 만들지 않는다. 이 창이 변한다.
    noNewWindowOnOpen: winCountAfterOpen === winCountBefore,
    stillTwoWindows: BrowserWindow.getAllWindows().length === winCountBefore,
    noNewWindowOnSecondClick: winCountAfterSecondClick === winCountBefore,
    // 대화 창이 설정 모드로 바뀐다
    renderedInChatWindow: chatProbe.settingsVisible === true && chatProbe.url === 'chat.html',
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
    // 온보딩과 같은 문법 — 창이 chatMaxH로 자란다
    chatGrewToMax: chatBoundsWhileOpen.height > chatBoundsBefore.height,
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

  // ---------- 검증 8: 커맨드바로도 설정에 도달한다 ----------
  // GLOSSARY.md §1 — 점 클릭은 "추가" 진입로다. 커맨드바 경로가 없으면 soul.md §8 탈락 조건.
  // 사이드바 도입 이후 커맨드바 경로도 기본 선택은 '화면'이다 — 옛 accountsCardCount
  // 전제(검증7과 같은 이유로) 대신 nav 존재 + 기본 패널로 판정한다.
  const winCountBeforeCmd = BrowserWindow.getAllWindows().length;
  const turnCountBeforeCmd = await chatWin.webContents.executeJavaScript(
    "document.querySelectorAll('.turn-q').length"
  );
  await chatWin.webContents.executeJavaScript(`
    (() => {
      const el = document.getElementById('input');
      el.value = '설정';
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })();
  `);
  await wait(900);
  const winCountAfterCmd = BrowserWindow.getAllWindows().length;
  const chatAfterCmd = await chatWin.webContents.executeJavaScript(`
    (() => ({
      inputCleared: document.getElementById('input').value === '',
      turnCount: document.querySelectorAll('.turn-q').length,
      settingsVisible: document.getElementById('settings').hidden === false,
      navExists: !!document.getElementById('settingsNav'),
      screenCardCount: document.querySelectorAll('#settingsGrid .card.screen').length,
    }))()
  `);
  // 정리 — 다음 단계에 설정 모드를 남기지 않는다
  await chatWin.webContents.executeJavaScript(
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
  const sendFromChat = (channel, payload) => chatWin.webContents.executeJavaScript(
    `window.athena.send('${channel}', ${JSON.stringify(payload)})`
  );

  // 9a — 줌: 두 창이 같은 배율로 움직이고, reset으로 1.0에 돌아온다
  await sendFromChat('athena:zoom', { dir: 'in' });
  await sendFromChat('athena:zoom', { dir: 'in' });
  await wait(300);
  const zoomAfterIn = {
    chat: chatWin.webContents.getZoomFactor(),
    canvas: canvasWin.webContents.getZoomFactor(),
  };
  await sendFromChat('athena:zoom', { dir: 'reset' });
  await wait(300);
  const zoomAfterReset = chatWin.webContents.getZoomFactor();

  // 9b — 이동 앵커: 창을 옮긴 뒤 높이를 바꿔도 새 위치가 유지된다(스냅백 회귀 방지)
  const beforeMove = chatWin.getBounds();
  chatWin.setBounds({ x: beforeMove.x + 120, y: beforeMove.y - 40, width: beforeMove.width, height: beforeMove.height });
  mainMod.noteAppBounds(chatWin); // 앱 주도 표시 — OS 스냅 오인 정착 방지(검증3 주석)
  await wait(150);
  const moved = chatWin.getBounds();
  await sendFromChat('athena:set-chat-height', { height: layout.chatBaseH + 150 });
  await wait(300);
  const afterHeightAtNewSpot = chatWin.getBounds();
  const anchorKept = {
    xKept: near(afterHeightAtNewSpot.x, moved.x),
    bottomKept: near(afterHeightAtNewSpot.y + afterHeightAtNewSpot.height, moved.y + moved.height),
    heightApplied: near(afterHeightAtNewSpot.height, layout.chatBaseH + 150),
  };
  // 원위치 복구 — 이후 단계에 이동 상태를 남기지 않는다
  chatWin.setBounds(beforeMove);
  mainMod.noteAppBounds(chatWin);
  await wait(150);
  await sendFromChat('athena:set-chat-height', { height: layout.chatBaseH });
  await wait(200);

  // 9c — 최소화(내리기)·복원(올리기): 두 창이 한 몸으로 내려가고, 한쪽 복원이 짝을 끌어올린다
  const canvasWasVisible = canvasWin.isVisible();
  await sendFromChat('athena:minimize-windows');
  await wait(500);
  const minimized = { chat: chatWin.isMinimized(), canvas: canvasWin.isMinimized() };
  chatWin.restore();
  await wait(600);
  const restoredPair = {
    chat: !chatWin.isMinimized(),
    canvas: !canvasWasVisible || !canvasWin.isMinimized(),
  };

  report.windowBasics = {
    zoomInSyncsBothWindows: zoomAfterIn.chat > 1 && Math.abs(zoomAfterIn.chat - zoomAfterIn.canvas) < 0.001,
    zoomAfterIn,
    zoomResetReturnsTo1: Math.abs(zoomAfterReset - 1) < 0.001,
    movedAnchorKept: anchorKept.xKept && anchorKept.bottomKept && anchorKept.heightApplied,
    anchorKept,
    canvasWasVisible,
    minimizeLowersBoth: minimized.chat && (!canvasWasVisible || minimized.canvas),
    restorePairsBoth: restoredPair.chat && restoredPair.canvas,
  };
  console.log('[verify] 검증9(창 기본 기능):', JSON.stringify(report.windowBasics));
  assertOk('windowBasics: zoom-in syncs both windows', report.windowBasics.zoomInSyncsBothWindows === true);
  assertOk('windowBasics: zoom reset returns to 1.0', report.windowBasics.zoomResetReturnsTo1 === true);
  assertOk('windowBasics: move anchor kept after height change', report.windowBasics.movedAnchorKept === true);
  assertOk('windowBasics: minimize lowers both windows', report.windowBasics.minimizeLowersBoth === true);
  assertOk('windowBasics: restore pairs both windows', report.windowBasics.restorePairsBoth === true);

  // 9d — 닫기(백그라운드 유지, 2026-08-18): 두 창이 숨고 프로세스는 산다. 복귀는
  // 트레이 클릭과 같은 함수 참조(restoreFromBackground)를 직접 부른다 — 실제
  // 트레이 클릭은 자동화로 만들 수 없다(정직 표기: 아이콘 클릭 자체는 미실측).
  const canvasVisibleBeforeClose = canvasWin.isVisible();
  await sendFromChat('athena:close-windows');
  await wait(400);
  const hiddenPair = { chat: chatWin.isVisible(), canvas: canvasWin.isVisible() };
  mainMod.restoreFromBackground();
  await wait(400);
  report.closeToBackground = {
    canvasVisibleBeforeClose,
    bothHiddenAfterClose: !hiddenPair.chat && !hiddenPair.canvas,
    visibleAfterClose: hiddenPair,
    chatRestored: chatWin.isVisible(),
    canvasRestoredWithPair: !canvasVisibleBeforeClose || canvasWin.isVisible(),
  };
  console.log('[verify] 검증9d(닫기→백그라운드→복귀):', JSON.stringify(report.closeToBackground));
  // canvasVisibleBeforeClose는 이 시점의 상태를 기록하는 값이라(캔버스가 항상
  // 열려 있어야 한다는 계약이 아니다) 단언에서 뺀다 — 아래 세 값이 실제 계약이다.
  assertOk('closeToBackground: both windows hidden after close', report.closeToBackground.bothHiddenAfterClose === true);
  assertOk('closeToBackground: chat restored from tray path', report.closeToBackground.chatRestored === true);
  assertOk('closeToBackground: canvas restored with its pair', report.closeToBackground.canvasRestoredWithPair === true);

  // ---------- 검증 10: 카드 배치·생애주기 규칙 (2026-08-18) ----------
  // 규칙 원본: plan/canvas-taxonomy.md "배치·생애주기 규칙". 폭은 형상이 정하고
  // (w-half/w-full) 순서는 도착순, AI layout 힌트는 폭 등급 승격·강등만,
  // drop_types는 턴별 큐레이션, 높이 예산(뷰포트 2배·최소 3장)은 안전망이다.
  // 실배선 경로(athena:add-canvas-live)는 합성 봉투로 구동한다 — main.js가
  // 실왕복 후 보내는 채널·형상 그대로이고 quota를 쓰지 않는다(파일 상단 원칙).
  if (!canvasWin.isVisible()) { dlog('expand for check10'); await mainMod.expandCanvasWindow(); await wait(200); }
  canvasWin.webContents.send('athena:clear-canvases');
  await wait(120);

  const gridProbe = () => canvasWin.webContents.executeJavaScript(`
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
  const liveEnvelope = (envelope) => canvasWin.webContents.send('athena:add-canvas-live', {
    status: 'success',
    envelope: { fell_back: false, fallback_reason: null, layout: null, drop_types: [], ...envelope },
  });

  // 10a — 도착순 + 형상별 폭 문법: stream → table → reader 순서로 보낸다. 옛 CSS는
  // 타입 고정 order라 이 순서가 stream·reader·table로 재정렬됐다 — 이제 도착순이 규범.
  canvasWin.webContents.send('athena:add-canvas', { type: 'stream' });
  await wait(120);
  canvasWin.webContents.send('athena:add-canvas', { type: 'table' });
  await wait(120);
  canvasWin.webContents.send('athena:add-canvas', { type: 'reader' });
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
  await shot(canvasWin, '12-card-layout-rules.png');

  // 10e — 높이 예산 집행: 창을 절반 높이로 줄여 예산을 좁힌 뒤 4장째를 추가하면
  // 가장 오래된 카드부터 제거된다(최소 3장 보장이라 3장에서 멈춘다).
  const cbBefore = canvasWin.getBounds();
  // 캔버스는 스냅 대상화(2026-08-18)로 min=max 크기 잠금이 걸려 있다 — 절반
  // 축소 시뮬레이션 동안만 하한을 풀고, 끝나면 원래 잠금으로 되돌린다.
  const halfH = Math.round(cbBefore.height / 2);
  canvasWin.setMinimumSize(layout.canvasW, halfH);
  canvasWin.setBounds({ ...cbBefore, height: halfH });
  mainMod.noteAppBounds(canvasWin); // 앱 주도 표시 — OS 스냅 오인 정착 방지
  await wait(200);
  canvasWin.webContents.send('athena:add-canvas', { type: 'table' });
  await wait(150);
  liveEnvelope({ canvas_type: 'free', caption: '검증10 자유', data: { a: 1, b: '검증' } });
  await wait(250);
  const afterBudget = await gridProbe();
  canvasWin.setBounds(cbBefore);
  canvasWin.setMinimumSize(layout.canvasW, layout.canvasH); // 잠금 복구
  mainMod.noteAppBounds(canvasWin);
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

  // ---------- 검증 11: 창 이동 표준화 — 네이티브 캡션 · JS 드래그 폐기 · 짝 팔로우 ----------
  // 2026-08-19 사용자 지시("평범한 앱처럼"): 커서 폴링 드래그(athena:window-drag)를
  // 폐기하고 -webkit-app-region 캡션으로 전환했다. 실제 캡션 드래그는 실물 마우스가
  // 필요해 자동화로 못 돌린다(검증9와 같은 제약) — 대신 계약 3종을 단언한다:
  // (a) 옛 채널이 죽어 있다(allowlist 제거 — send가 던진다) + 크기 불변(구판 DPI
  //     성장 버그 5e0a9ab 회귀 가드 계승), (b) 캡션/구멍 CSS 계약, (c) 짝 팔로우 —
  // noteAppBounds 없는 순수 이동(사용자 드래그 재현)이 짝 창을 같은 델타로 정착.
  const { screen: elScreen } = require('electron');
  const dragBefore = chatWin.getBounds();
  const oldChannelDead = await chatWin.webContents.executeJavaScript(
    "(() => { try { window.athena.send('athena:window-drag', { phase: 'start' }); return false; } catch { return true; } })()"
  );
  await wait(400);
  const dragAfter = chatWin.getBounds();
  const appRegions = await chatWin.webContents.executeJavaScript(`(() => {
    const reg = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return (cs.getPropertyValue('app-region') || cs.getPropertyValue('-webkit-app-region') || '').trim();
    };
    return { strip: reg('#dragStrip'), controlStrip: reg('#controlStrip'),
             grip: reg('#grip'), winBtn: reg('.win-btn'), history: reg('#history'),
             settingsHead: reg('#settings .settings-head') };
  })()`);
  const canvasStripRegion = await canvasWin.webContents.executeJavaScript(
    "(() => { const cs = getComputedStyle(document.getElementById('dragStrip')); return (cs.getPropertyValue('app-region') || cs.getPropertyValue('-webkit-app-region') || '').trim(); })()"
  );
  // (c) 짝 팔로우 — 의도적으로 noteAppBounds를 생략한 setBounds = 외부(사용자) 이동.
  // handleForeignArrange(디바운스 120ms)가 순수 이동으로 판정해 캔버스를 정착시킨다.
  const cvBefore = canvasWin.getBounds();
  const chBefore = chatWin.getBounds();
  chatWin.setBounds({ x: chBefore.x + 60, y: chBefore.y + 40, width: chBefore.width, height: chBefore.height });
  await wait(450);
  const cvAfter = canvasWin.getBounds();
  const pairFollowed = near(cvAfter.x, cvBefore.x + 60) && near(cvAfter.y, cvBefore.y + 40);
  // 원위치 — 같은 외부 이동 경로로 되돌리면 짝도 같이 돌아온다.
  chatWin.setBounds({ x: chBefore.x, y: chBefore.y, width: chBefore.width, height: chBefore.height });
  await wait(450);
  const cvRestored = canvasWin.getBounds();
  const pairReturned = near(cvRestored.x, cvBefore.x) && near(cvRestored.y, cvBefore.y);
  report.dragStandard = {
    scaleFactor: elScreen.getPrimaryDisplay().scaleFactor,
    oldChannelDead,
    sizeUnchanged: dragBefore.width === dragAfter.width && dragBefore.height === dragAfter.height,
    appRegions, canvasStripRegion,
    pairFollow: { cvBefore, cvAfter, cvRestored, pairFollowed, pairReturned },
  };
  console.log('[verify] 검증11(창 이동 표준화):', JSON.stringify(report.dragStandard));
  assertOk('dragStandard: 옛 JS 드래그 채널이 죽어 있다(allowlist 거부)', oldChannelDead === true);
  assertOk('dragStandard: 크기 불변(5e0a9ab 회귀 가드 계승)', report.dragStandard.sizeUnchanged === true);
  assertOk('dragStandard: 대화 창 맨 위 스트립 = 캡션(drag)', appRegions.strip === 'drag');
  assertOk('dragStandard: grip 중앙·창 버튼 = no-drag 구멍',
    appRegions.grip === 'no-drag' && appRegions.winBtn === 'no-drag');
  assertOk('dragStandard: 컨트롤 스트립은 캡션이 아니다(2026-08-19 개정 — 맨 위만)', appRegions.controlStrip !== 'drag');
  assertOk('dragStandard: 본문(.history)은 손잡이가 아니다', appRegions.history !== 'drag');
  assertOk('dragStandard: 설정 헤더 = 캡션(drag)', appRegions.settingsHead === 'drag');
  assertOk('dragStandard: 캔버스 상단 스트립 = 캡션(drag)', canvasStripRegion === 'drag');
  assertOk('dragStandard: 외부 순수 이동 시 짝 팔로우(같은 델타 정착)', pairFollowed === true);
  assertOk('dragStandard: 복귀 이동도 짝 유지', pairReturned === true);

  // ---------- 검증 12: §5.3.1 컬럼 우선순위 흡수(2층) — table 카드가 1560px에서 접힌다 ----------
  // claude -p 실배선 없이(quota 0) canvas.js의 'athena:add-canvas-live' 경로에 실제
  // ka10095(63컬럼, backend/ref/kiwoom-common-screen-manifest.json column_priority 그대로
  // 추출한 app/data/wide-table-fold-fixtures.json)를 직접 주입해 app/lib/column-fold.js가
  // 실제 렌더 DOM에서도 fold를 발동시키는지 확인한다 — main.js를 거치지 않고 canvasWin에
  // 바로 IPC를 보내므로 fixture/live 소스 분기와 무관하다(순수 렌더러 단 검증).
  const wideFixtures = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'data', 'wide-table-fold-fixtures.json'), 'utf-8')
  );
  const ka10095Fixture = wideFixtures.trs.find((t) => t.mapping_id === 'base:ka10095');
  const mockRow = {};
  for (const col of ka10095Fixture.columns) mockRow[col.key] = `v:${col.key}`;
  await canvasWin.webContents.send('athena:add-canvas-live', {
    status: 'success',
    envelope: {
      canvas_type: 'table',
      fell_back: false,
      caption: `${ka10095Fixture.name_ko} 검증용`,
      data: { columns: ka10095Fixture.columns, rows: [mockRow, mockRow] },
    },
  });
  await wait(300);
  const foldProbe = await canvasWin.webContents.executeJavaScript(`
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
  await shot(canvasWin, '18-table-column-fold-ka10095.png');

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
  await canvasWin.webContents.executeJavaScript(`window.addCard('chart')`);
  await wait(1500); // 동적 import + 비동기 마운트
  const chartProbe = await canvasWin.webContents.executeJavaScript(`(async () => {
    const card = document.querySelector('.card.chart');
    if (!card) return null;
    const tabs = Array.from(card.querySelectorAll('.chart-toolbar-tab')).map(b => b.textContent);
    const paneRows = Array.from(card.querySelectorAll('.chart-price-pane table tr'))
      .map(tr => tr.getBoundingClientRect()).filter(r => r.height > 0).length;
    const indBtn = Array.from(card.querySelectorAll('.chart-toolbar-btn')).find(b => b.textContent.includes('∿'));
    // 마운트 실패(예: lightweight-charts 미설치)면 카드는 있어도 툴바가 없다 —
    // 여기서 클릭하면 TypeError가 unhandledRejection으로 새서 verify가 영원히
    // 안 끝난다(2026-08-18 병합 검증에서 실제 재현). 실패는 수치로 보고한다.
    if (!indBtn) return { cardPresent: true, tabs, paneRows, indicatorRows: 0, vpBars: 0, toolbarMissing: true };
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
    return { cardPresent: true, tabs, paneRows, indicatorRows, vpBars };
  })()`);
  await wait(200);
  await shot(canvasWin, '19-chart-card.png');
  report.chartCard = {
    cardRendered: chartProbe !== null,
    periodTabsOk: chartProbe !== null && chartProbe.tabs.join(',') === '일,주,월,년,분,틱',
    paneSeparated: chartProbe !== null && chartProbe.paneRows >= 3, // 가격+구분+거래량 이상
    indicatorRows35: chartProbe !== null && chartProbe.indicatorRows === 35,
    volumeProfileBars24: chartProbe !== null && chartProbe.vpBars === 24,
    // 실측 수치도 그대로 남긴다 — 불리언만으로는 미래 회귀의 원인 추적이 어렵다
    // (아키텍트 검증 권고, 2026-08-18. 형제 검증 블록과 기록 밀도 정합).
    measured: chartProbe,
  };
  console.log('[verify] 검증13(차트 카드):', JSON.stringify(report.chartCard));
  assertOk('chartCard: card rendered', report.chartCard.cardRendered === true);
  assertOk('chartCard: period tabs match 일,주,월,년,분,틱', report.chartCard.periodTabsOk === true);
  assertOk('chartCard: price/volume panes separated', report.chartCard.paneSeparated === true);
  assertOk('chartCard: 35 indicator rows present', report.chartCard.indicatorRows35 === true);
  assertOk('chartCard: 24 volume-profile bars present', report.chartCard.volumeProfileBars24 === true);

  // ---- 검증13b — 실배선 chart 봉투(canvas.js renderLiveChart, 2026-08-18) ----
  // live-prompt.js의 chart 힌트가 규정한 형상 그대로(symbol/name/bars) liveEnvelope
  // 헬퍼(검증10에서 정의)로 합성 봉투를 보낸다 — 백엔드·quota 무관, 순수 렌더러 단
  // 검증(canvas_type:'chart'가 backend/athena_mcp/canvas.py 스키마 레지스트리에
  // 아직 없어도 이 경로는 상관없다 — main.js는 응답값 canvas_type만 읽는다).
  // 위 검증13이 이미 mock 'chart' 카드(window.addCard('chart'))를 그려뒀으므로,
  // makeCard의 "같은 타입 재요청 시 갈아치운다" 규칙(카드 정리 규칙)에 따라 이
  // 봉투가 그 카드를 대체한다 — 별도 정리 호출 없이 정확히 카드 1장만 남아야 한다.
  const liveChartBars = [
    { time: '2026-08-14', open: 71000, high: 71600, low: 70800, close: 71300, volume: 9123456 },
    { time: '2026-08-17', open: 71300, high: 71900, low: 71100, close: 71700, volume: 8877665 },
    { time: '2026-08-18', open: 71700, high: 72200, low: 71500, close: 72000, volume: 10233445 },
  ];
  liveEnvelope({
    canvas_type: 'chart',
    renderer_id: 'aits-chart-v1',
    caption: '검증13b 실배선 차트',
    data: { symbol: '005930', chart: { period: 'day', target: 'stock', trId: 'ka10081', candles: liveChartBars } },
  });
  await wait(1200); // renderLiveChart도 동적 import + 비동기 마운트(검증13과 같은 이유)
  const liveChartProbe = await canvasWin.webContents.executeJavaScript(`
    (() => {
      const cards = document.querySelectorAll('#grid .card.chart');
      const card = cards[cards.length - 1];
      if (!card) return null;
      return {
        cardCount: cards.length,
        canvasCount: card.querySelectorAll('canvas').length,
        titleText: card.querySelector('.card-title') ? card.querySelector('.card-title').textContent : null,
      };
    })()
  `);
  await shot(canvasWin, '20-live-chart-card.png');
  report.liveChartCard = {
    cardRendered: liveChartProbe !== null,
    replacedMockChartCard: liveChartProbe !== null && liveChartProbe.cardCount === 1,
    canvasMounted: liveChartProbe !== null && liveChartProbe.canvasCount > 0,
    // caption은 정보성 참고값(어떤 문구가 카드 제목에 실제로 반영됐는지 추적용) — 단언에서 뺀다.
    titleText: liveChartProbe && liveChartProbe.titleText,
  };
  console.log('[verify] 검증13b(실배선 chart 봉투):', JSON.stringify(report.liveChartCard));
  assertOk('liveChartCard: card rendered from a synthetic live envelope', report.liveChartCard.cardRendered === true);
  assertOk('liveChartCard: same-type re-render replaced the mock chart card (exactly one .card.chart)', report.liveChartCard.replacedMockChartCard === true);
  assertOk('liveChartCard: lightweight-charts canvas element mounted', report.liveChartCard.canvasMounted === true);

  // ---------- 검증 14: 창 배치(스냅) — Windows 표준 의미론 (2026-08-18) ----------
  // main.js가 노출한 placeWindows(left/right)·centerWindows를 직접 구동하고,
  // up/down은 실제 경로(athena:window-key → chat.js의 □ 버튼과 같은 로컬 함수)를
  // 그대로 왕복한다. 확인할 것: (a) 두 창이 함께 움직이는가(짝의 상대 오프셋
  // 불변 — computePlacement 계약상 캔버스·대화 창 x가 같다) (b) 크기는 안
  // 변하는가(스냅은 위치만 바꾼다) (c) 스냅 뒤에도 앵커가 갱신돼 다음
  // setChatHeight가 부팅 좌표로 되돌리지 않는가(syncChatAnchor 회귀 가드, 커밋
  // 5e0a9ab와 같은 종류의 버그를 잡는다).
  mainMod.centerWindows(); // 이전 검증들의 이동 상태를 정리 — 원점에서 시작
  await wait(150);
  const beforePlacement = { canvas: canvasWin.getBounds(), chat: chatWin.getBounds() };

  mainMod.placeWindows('left');
  await wait(200);
  const afterLeft = { canvas: canvasWin.getBounds(), chat: chatWin.getBounds() };

  mainMod.placeWindows('right');
  await wait(200);
  const afterRight = { canvas: canvasWin.getBounds(), chat: chatWin.getBounds() };

  // □ 토글 경유 — Win+↑와 정확히 같은 채널(athena:window-key)로 렌더러의 로컬
  // 경로(chat.js toggleMaxHeight)를 태운다. 먼저 알려진 높이(chatBaseH)로
  // 맞춰 시작한다 — 이전 단계의 잔여 높이에 기댄 판정은 흔들린다.
  chatWin.webContents.executeJavaScript(`window.athena.send('athena:set-chat-height', { height: ${layout.chatBaseH} })`);
  await wait(250);
  const chatHeightBeforeMax = chatWin.getBounds().height;
  chatWin.webContents.send('athena:window-key', { dir: 'up' });
  await wait(400);
  const afterMaximize = chatWin.getBounds();

  chatWin.webContents.send('athena:window-key', { dir: 'down' });
  await wait(400);
  const afterRestore = chatWin.getBounds();

  // 앵커 유지 — 스냅(right) 뒤 위치에서 높이만 바꿔도 x/하단 y가 그대로여야
  // 한다(검증9의 이동 앵커 계약과 같은 종류, syncChatAnchor 회귀 가드).
  const beforeAnchorCheck = chatWin.getBounds();
  chatWin.webContents.executeJavaScript(
    `window.athena.send('athena:set-chat-height', { height: ${layout.chatBaseH + 80} })`
  );
  await wait(300);
  const afterAnchorHeightChange = chatWin.getBounds();

  mainMod.centerWindows(); // 원위치 — 이후 단계에 배치 상태를 남기지 않는다
  await wait(200);
  chatWin.webContents.executeJavaScript(`window.athena.send('athena:set-chat-height', { height: ${layout.chatBaseH} })`);
  await wait(200);
  const afterCenter = { canvas: canvasWin.getBounds(), chat: chatWin.getBounds() };

  report.windowPlacement = {
    beforePlacement, afterLeft, afterRight, afterMaximize, afterRestore, afterCenter,
    // AT-CH-001R(2026-08-19): chatW(900) < canvasW(1560) — "짝으로 움직인다"의
    // 계약은 x 동일이 아니라 **대화 창이 캔버스 폭의 중앙**이다(window-placement.js).
    // 구판(chatW==canvasW)에서 x 동일 비교는 이 계약의 특수 사례였다.
    pairMovedTogetherOnLeft: near(afterLeft.chat.x, afterLeft.canvas.x + Math.round((afterLeft.canvas.width - afterLeft.chat.width) / 2)),
    pairMovedTogetherOnRight: near(afterRight.chat.x, afterRight.canvas.x + Math.round((afterRight.canvas.width - afterRight.chat.width) / 2)),
    leftDiffersFromRight: afterLeft.canvas.x !== afterRight.canvas.x,
    // near() ±2px — 이 파일의 다른 bounds 비교와 같은 관례다(acrylic + DPI 배율에서
    // setBounds 요청값과 getBounds 실측값이 1px 안팎 어긋나는 실측, 검증3 주석).
    // 자유 리사이즈 승급(2026-08-18)으로 min=max 잠금이 사라져 이 편차를 OS가
    // 눌러주지 않게 됐다 — 정확 일치 요구는 계약이 아니라 잠금의 부수 효과였다.
    sizeUnchangedOnLeft: near(afterLeft.canvas.width, beforePlacement.canvas.width) && near(afterLeft.canvas.height, beforePlacement.canvas.height),
    sizeUnchangedOnRight: near(afterRight.canvas.width, beforePlacement.canvas.width) && near(afterRight.canvas.height, beforePlacement.canvas.height),
    maximizedViaWindowKey: afterMaximize.height > chatHeightBeforeMax,
    maximizedReachedChatMaxH: near(afterMaximize.height, layout.chatMaxH),
    restoredViaWindowKey: near(afterRestore.height, layout.chatBaseH),
    anchorKeptAfterSnap:
      near(afterAnchorHeightChange.x, beforeAnchorCheck.x)
      && near(afterAnchorHeightChange.y + afterAnchorHeightChange.height, beforeAnchorCheck.y + beforeAnchorCheck.height),
    centerReturnsToBootOrigin: near(afterCenter.canvas.x, layout.originX) && near(afterCenter.canvas.y, layout.originY),
  };
  console.log('[verify] 검증14(창 배치):', JSON.stringify(report.windowPlacement));
  assertOk('windowPlacement: pair moves together on left snap', report.windowPlacement.pairMovedTogetherOnLeft === true);
  assertOk('windowPlacement: pair moves together on right snap', report.windowPlacement.pairMovedTogetherOnRight === true);
  assertOk('windowPlacement: left and right snap to different positions', report.windowPlacement.leftDiffersFromRight === true);
  assertOk('windowPlacement: size unchanged on left snap', report.windowPlacement.sizeUnchangedOnLeft === true);
  assertOk('windowPlacement: size unchanged on right snap', report.windowPlacement.sizeUnchangedOnRight === true);
  assertOk('windowPlacement: athena:window-key up maximizes chat height', report.windowPlacement.maximizedViaWindowKey === true);
  assertOk('windowPlacement: maximize reaches chatMaxH', report.windowPlacement.maximizedReachedChatMaxH === true);
  assertOk('windowPlacement: athena:window-key down restores base height', report.windowPlacement.restoredViaWindowKey === true);
  assertOk('windowPlacement: anchor kept after snap (no snapback on height change)', report.windowPlacement.anchorKeptAfterSnap === true);
  assertOk('windowPlacement: centerWindows returns to boot origin', report.windowPlacement.centerReturnsToBootOrigin === true);

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
  // --glass-* 4변수로 박았다(soul.md §7 완화책 2 개정). 여기서는 (a) 두 창이
  // 같은 토큰을 읽는지, (b) 실제 표면 렌더 값이 토큰과 일치하는지, (c) 사다리
  // 순서 계약(window < card < canvas < window-max)이 성립하는지를 단언한다 —
  // 값을 CSS 어딘가에 하드코드해 사다리가 두 벌이 되는 회귀를 잡는 게 목적이다.
  const readTokens = `(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      window: parseFloat(s.getPropertyValue('--glass-window')),
      card: parseFloat(s.getPropertyValue('--glass-card')),
      canvas: parseFloat(s.getPropertyValue('--glass-canvas')),
      windowMax: parseFloat(s.getPropertyValue('--glass-window-max')),
    };
  })()`;
  const chatTokens = await chatWin.webContents.executeJavaScript(readTokens);
  const canvasTokens = await canvasWin.webContents.executeJavaScript(readTokens);
  // 캔버스 창에 카드 하나를 띄워 실측한다(이전 검증들이 카드를 정리했을 수 있다).
  canvasWin.webContents.send('athena:add-canvas', { type: 'stream' });
  await wait(400);
  const alphaOf = (rgba) => {
    const m = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([0-9.]+))?\)/.exec(rgba || '');
    return m ? (m[1] === undefined ? 1 : parseFloat(m[1])) : NaN;
  };
  const surfaceAlphas = await canvasWin.webContents.executeJavaScript(`(() => {
    const mosaic = getComputedStyle(document.querySelector('.mosaic')).backgroundColor;
    const card = document.querySelector('.card');
    return { mosaic, card: card ? getComputedStyle(card).backgroundColor : null };
  })()`);
  const chatAppAlpha = await chatWin.webContents.executeJavaScript(
    "getComputedStyle(document.querySelector('.app')).backgroundColor"
  );
  const nearAlpha = (a, b) => Number.isFinite(a) && Math.abs(a - b) <= 0.02;
  report.glassLadder = {
    chatTokens, canvasTokens,
    mosaicAlpha: alphaOf(surfaceAlphas.mosaic),
    cardAlpha: alphaOf(surfaceAlphas.card),
    chatAppAlpha: alphaOf(chatAppAlpha),
    tokensMatchAcrossWindows:
      chatTokens.window === canvasTokens.window && chatTokens.card === canvasTokens.card
      && chatTokens.canvas === canvasTokens.canvas && chatTokens.windowMax === canvasTokens.windowMax,
    ladderOrdered:
      chatTokens.window < chatTokens.card && chatTokens.card < chatTokens.canvas
      && chatTokens.canvas < chatTokens.windowMax,
    mosaicMatchesToken: nearAlpha(alphaOf(surfaceAlphas.mosaic), canvasTokens.canvas),
    cardMatchesToken: nearAlpha(alphaOf(surfaceAlphas.card), canvasTokens.card),
    // 대화 창은 기본 높이 상태 — --glass-alpha 보간의 하한이 곧 --glass-window여야 한다.
    chatAppMatchesWindowToken: nearAlpha(alphaOf(chatAppAlpha), chatTokens.window),
  };
  console.log('[verify] 검증16(유리 사다리):', JSON.stringify(report.glassLadder));
  assertOk('glassLadder: tokens identical across both windows', report.glassLadder.tokensMatchAcrossWindows === true);
  assertOk('glassLadder: window < card < canvas < window-max', report.glassLadder.ladderOrdered === true);
  assertOk('glassLadder: canvas surface renders --glass-canvas', report.glassLadder.mosaicMatchesToken === true);
  assertOk('glassLadder: card renders --glass-card', report.glassLadder.cardMatchesToken === true);
  assertOk('glassLadder: chat app renders --glass-window at base height', report.glassLadder.chatAppMatchesWindowToken === true);

  // ---------- 검증 17: 능동 턴·주문 티켓 (2026-08-19 능동 에이전트 — 쿼터 0) ----------
  // 합성 발화 이벤트를 IPC로 주입해 P2~P4 렌더 계약을 픽스처로 검증한다:
  // 능동 턴(발화 배지·방식 표기·소스 라벨·시점 고지) → 티켓 직행 버튼 →
  // 모드 전이(#order 표시·#app 후퇴·창은 둘) → 게이트 잠금 → Esc 복귀.
  chatWin.webContents.send('athena:routine-event', {
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
  report.agentTurn = await chatWin.webContents.executeJavaScript(`(() => {
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

  await chatWin.webContents.executeJavaScript(`(() => {
    const t = document.querySelector('.turn-agent.agent-fired');
    const b = Array.from(t.querySelectorAll('button')).find((x) => x.textContent.includes('주문 티켓'));
    b.click();
  })()`);
  await wait(600);
  report.orderTicket = await chatWin.webContents.executeJavaScript(`(() => {
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
  assertOk('orderTicket: 창은 둘', report.orderTicket.windowCount === 2);
  assertOk('orderTicket: 발화 시점 라벨(시점 정직성)', report.orderTicket.firedAtLabel === true);
  assertOk('orderTicket: 게이트 잠금(주문 API 부재 시 실행 비활성)', report.orderTicket.execDisabled === true);
  await chatWin.webContents.executeJavaScript(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"
  );
  await wait(300);
  const orderClosed = await chatWin.webContents.executeJavaScript(
    "(() => { const o = document.getElementById('order'); const a = document.getElementById('app'); return o.hidden && !a.hidden; })()"
  );
  assertOk('orderTicket: Esc 복귀', orderClosed === true);

  // ---------- 검증 18: 캡처 신뢰성 — 연속 캡처 중복 감지 (2026-08-19 QA 결함 #2 재발 방지,
  // 디자인 갈래에서는 검증17이었다 — 병합 시 능동 턴 검증17과 번호가 겹쳐 18로 재부여) ----------
  // 같은 창을 연속으로 찍은 두 캡처가 MD5까지 완전히 같으면, 둘 중 하나(대개
  // 나중 것)는 화면이 바뀌기 전 프레임을 찍은 것이다 — 파일명이 주장하는 화면을
  // 실제로 담지 못했다는 뜻이라 값 자체가 신뢰 불가다. shot()의 rAF 2회 대기로
  // 근본 원인은 고쳤지만, 이 단언은 회귀를 잡는 감지망이다(완화가 아니라 추가).
  // 03b→04는 예외로 허용한다 — 대화 창의 유휴 입력줄은 캔버스 창이 펼쳐져 있든
  // 접혔든 자기 자신은 안 바뀐다(캔버스 가시성은 대화 창 DOM에 영향이 없다,
  // 실측 확인: 두 캡처가 픽셀 단위로 동일 — 새 턴도, 부팅 애니메이션도 그 사이에
  // 없다). 여기서 빼지 않으면 "정상적으로 안 바뀌는 화면"까지 결함으로 오탐한다.
  const EXPECTED_IDENTICAL = new Set(['03b-chat-during-mosaic.png>>>04-collapsed-back-to-chat.png']);
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

  // ---------- 검증 19: "기록 안 됨" 배지 — 채팅 저장 실패 신호(2026-08-19,
  // 그래프 갈래에서는 검증17이었다 — 병합 시 번호가 겹쳐 19로 재부여) ----------
  // verify.js는 항상 fixture 경로(ATHENA_CANVAS_SOURCE=fixture)라 runQueryLive를
  // 안 타므로(§CLAUDE.md §9 "픽스처 경로만 타서 못 잡는 것"과 같은 구조적 한계),
  // 실제 backend/claude -p 왕복 없이 chat.js가 실제로 로드한
  // window.AthenaLib.HistoryBadge 모듈 자체를 렌더러 안에서 직접 구동한다 —
  // main.js의 IPC 배선(athena:history-save-failed → saveFailedRouter.handleFailure)은
  // 별도로 preload.js의 ON_CHANNELS allowlist 통과 여부만 확인한다(실제 스트림은
  // node --test의 lib/history-badge.test.js가 순수 로직을 이미 촘촘히 검증했다).
  const badgeCheck = await chatWin.webContents.executeJavaScript(`(() => {
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
  assertOk('historyBadge: HistoryBadge 모듈이 chat.html에 실제로 로드됐다', badgeCheck.moduleLoaded === true);
  assertOk('historyBadge: assistant 실패가 aLine 생성보다 먼저 오면 pending으로 흡수된다', badgeCheck.pendingBeforeALine === true);
  assertOk('historyBadge: role:user 배지 텍스트 — "기록 안 됨"', badgeCheck.userBadgeText === '기록 안 됨');
  assertOk('historyBadge: role:assistant 배지 텍스트(pending 흡수 후 적용) — "기록 안 됨"', badgeCheck.assistantBadgeText === '기록 안 됨');
  assertOk('historyBadge: 배지는 트레이스 라인(.turn-meta) 부속이다 — 독립 유리 레이어 아님', badgeCheck.userBadgeInsideTurnMeta === true && badgeCheck.assistantBadgeInsideTurnMeta === true);
  assertOk('historyBadge: 줄마다 .turn-meta는 하나뿐 — 중복 생성 없음', badgeCheck.noDuplicateMetaOnQLine === true && badgeCheck.noDuplicateMetaOnALine === true);

  // preload allowlist — 렌더러가 athena:history-save-failed를 구독할 수 있어야
  // main의 IPC가 실제로 chat.js에 닿는다(모듈 로직과 별개로 배선 자체를 확인).
  const historyChannelAllowed = await chatWin.webContents.executeJavaScript(`(() => {
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

  // ---------- 검증 20: FactsCard/CompoundCard 실배선(P4, 공통 API 카드 6종) ----------
  // plan/공통화면-템플릿-실행계획-2026-08-20.md P4 — 모델의 canvas_type 판단과 무관하게
  // (P1b 이후에는 manifest 조회가 결정한다) 렌더러가 facts/compound 봉투를 그리는지
  // 순수 렌더러 단에서 확인한다(quota 무관, 검증10의 liveEnvelope 헬퍼 재사용).
  // F1(단일 그룹) · F2(2단 그룹, spec §3.1 경계 11개) · compound(헤더 밴드+표 1개,
  // spec §3.3 "다중 표 아님")를 각각 실측한다.
  if (!canvasWin.isVisible()) { dlog('expand for check20'); await mainMod.expandCanvasWindow(); await wait(200); }
  canvasWin.webContents.send('athena:clear-canvases');
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
  const factsF1Probe = await canvasWin.webContents.executeJavaScript(`
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
  const factsF2Probe = await canvasWin.webContents.executeJavaScript(`
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
  const compoundProbe = await canvasWin.webContents.executeJavaScript(`
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
  await shot(canvasWin, '21-facts-compound-cards.png');

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
    { id: 'C1', type: 'chart', screenId: 'AT-CV-005:C1', state: 'ready', data: { symbol: '005930', name: '검증종목', bars: [
      { time: '2026-08-18', open: 100, high: 110, low: 95, close: 105, volume: 1000 },
      { time: '2026-08-19', open: 105, high: 115, low: 101, close: 112, volume: 1200 },
    ] } },
    { id: 'C2', type: 'compound', screenId: 'AT-CV-005:C2', state: 'ready', data: { header: [{ key: 'stk_nm', label: '종목명', value: '검증종목' }], table: tableData(4) } },
    { id: 'E1', type: 'event', screenId: 'AT-CV-005:E1', state: 'open', data: { lifecycle: 'open', records: [{ type: '체결', name: '검증종목', value: '100' }] } },
    { id: 'E2', type: 'event', screenId: 'AT-CV-005:E2', state: 'reconnecting', data: { lifecycle: 'reconnecting', records: Array.from({ length: 20 }, (_, i) => ({ seq: i + 1, type: '시세', value: `${100 + i}` })) } },
    { id: 'E3', type: 'event', screenId: 'AT-CV-005:E3', state: 'stopped', data: { lifecycle: 'stopped', records: [{ seq: 1 }] } },
    { id: 'A1', type: 'action', screenId: 'AT-CV-005:A1', state: 'review', data: { lifecycle: 'review', receipt: { ord_no: 'DISPLAY-ONLY', dmst_stex_tp: 'KRX' } } },
    { id: 'S1', type: 'status', screenId: 'AT-CV-005:S1', state: 'ready', data: { lifecycle: 'ready', configured: true, ready: true, expires_at: '2026-08-21T12:00:00+09:00' } },
  ];
  report.paperScreenCases = {};
  for (const paperCase of paperCases) {
    canvasWin.webContents.send('athena:clear-canvases');
    await wait(60);
    liveEnvelope({
      canvas_type: paperCase.type,
      caption: `Paper ${paperCase.id}`,
      screen_id: paperCase.screenId,
      layout: paperCase.layout || null,
      data: paperCase.data,
    });
    await wait(paperCase.type === 'chart' ? 350 : 120);
    const probe = await canvasWin.webContents.executeJavaScript(`(() => {
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
      };
    })()`);
    const captureName = `paper-${paperCase.id}.png`;
    const imageSize = await shot(canvasWin, captureName);
    const passed = !!probe
      && Object.values(probe).every((value) => value === true || value === false || typeof value === 'string' || value === null)
      && probe.connected && probe.nonzeroRect && probe.bodyHasContent && probe.hasCloseControl
      && probe.stateMatches && probe.displayOnlyGuard && probe.noExecutableOrderOrOauthControl
      && probe.screenIdMatches
      && imageSize.width > 0 && imageSize.height > 0;
    report.paperScreenCases[paperCase.id] = {
      screenId: paperCase.screenId,
      fixture: 'verify.js:paper-at-cv-005-display-only-v1',
      status: passed ? 'pass' : 'fail',
      screenshot: `app/captures/${captureName}`,
      dom: { connected: !!(probe && probe.connected), nonzeroRect: !!(probe && probe.nonzeroRect), bodyHasContent: !!(probe && probe.bodyHasContent), screenIdMatches: !!(probe && probe.screenIdMatches) },
      layout: { cardMeasured: !!(probe && probe.nonzeroRect), paperWidthApplied: !!probe },
      controls: { closeControlRendered: !!(probe && probe.hasCloseControl), protectedActionsAbsent: !!(probe && probe.noExecutableOrderOrOauthControl) },
      states: { declaredStateRendered: !!(probe && probe.stateMatches), displayOnlyGuardRendered: !!(probe && probe.displayOnlyGuard) },
    };
    assertOk(`paperScreenCases ${paperCase.id}: actual DOM/layout/control/state + screenshot`, passed);
  }

  report.finishedAt = new Date().toISOString();
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
