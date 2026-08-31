// 검증 스크립트. `npm run verify` (= electron verify.js)로 실행한다.
// main.js를 모듈로 불러와 실제 앱과 동일한 창 생성 로직을 재사용하고,
// - capturePage() 스크린샷 (app/captures/)
// - 셸 창 3영역(현재 2영역) 폭 계약 · 배치 · 최대화 의미론
// - 접근성 3종 강제 적용 스크린샷 (CDP Emulation.setEmulatedMedia)
// 을 수행하고 app/captures/VERIFY-REPORT.json 에 원본 수치를 남긴다.

// main.js를 라이브러리로 불러올 때는 자동 기동(app.whenReady().then(createWindows))을
// 막아야 한다 — verify.js가 createWindows()를 직접, 통제된 시점에 호출한다.
process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';
process.env.ATHENA_BOOT_FIXTURE_DELAY_MS = '3500';
process.env.ATHENA_BOOT_FIXTURE_FAIL_TASK = 'fixture-readiness';
process.env.ATHENA_BOOT_FIXTURE_FAIL_ATTEMPTS = '1';
// 과거 선택형 OS material 환경변수가 있어도 부팅의 실제 픽셀은 투명해야 한다.
// 의도적으로 값을 주입한 채 main.js를 불러와 해당 회귀 경로를 매 실행 검증한다.
process.env.ATHENA_WINDOW_MATERIAL = 'mica';

const { app, ipcMain, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const {
  createFreshVerifyProfile,
  seedVerifyProfile,
  startVerifyProfileCleanupWatchdog,
} = require('./lib/main/verify-profile');
// 지표 행 수의 단일 출처 — 검증이 숫자를 따로 갖지 않는다(2026-08-25).
const INDICATOR_DEFS_LENGTH = require('./lib/chart-indicator-registry').INDICATOR_DEFS.length;

const CAPTURES = path.join(__dirname, 'captures');
if (!fs.existsSync(CAPTURES)) fs.mkdirSync(CAPTURES, { recursive: true });
fs.rmSync(path.join(CAPTURES, '01b-boot-complete-hold.png'), { force: true });

// ---------- 매 실행 새 검증 프로필 — 시작 상태를 이 머신이나 이전 실행에 맡기지 않는다 ----------
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
// userData를 매 실행 고유한 임시 디렉토리로 갈아끼우고 온보딩을 완료로 심어
// **항상 같은 시작 상태**에서 잰다. 고정 `.verify-profile`은 재사용하지 않으며,
// 개인 프로필도 건드리지 않는다(백업·복원도 필요 없다).
// 대가: 계좌·MCP 목록이 빈 상태로 검증된다. 검증 7·8은 카드의 **존재와 경계**를
// 보는 것이라 유효하지만, 데이터가 찬 상태의 증거는 `npm run verify:settings-cards`
// 쪽이다(캡처 11장). 두 검증의 역할이 다르다.
const VERIFY_PROFILE = createFreshVerifyProfile({ scenario: 'configured' });
const FIXED_VERIFY_PROFILE = path.join(__dirname, '.verify-profile');
const VERIFY_PROFILE_CLEANUP_WATCHDOG_PID = startVerifyProfileCleanupWatchdog(VERIFY_PROFILE.directory, {
  tempRoot: VERIFY_PROFILE.tempRoot,
  expectedRunId: VERIFY_PROFILE.runId,
});
app.setPath('userData', VERIFY_PROFILE.directory);

// Codex 설정 격리 — codex-config.js는 userData가 아니라 CODEX_HOME/config.toml에
// 직접 쓴다(2026-08-18 실결선). 검증15 확장이 실제 파일 쓰기를 하므로, 이 머신의
// 진짜 ~/.codex/config.toml을 절대 건드리면 안 된다. cli-accounts.js의
// detectCodex()도 이 값을 읽으므로 require('./main.js')보다 먼저 세팅한다 —
// Codex가 이 격리 디렉토리에선 항상 미연결로 보이지만, 검증7의 모델 패널
// 단언(modelPanelHasClaudeAccountRow 등)은 Claude 쪽만 보므로 간섭이 없다.
process.env.CODEX_HOME = path.join(VERIFY_PROFILE.directory, '.codex-home');
fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });

const DEBUGLOG = path.join(CAPTURES, 'verify-debug.log');
fs.writeFileSync(DEBUGLOG, `start ${new Date().toISOString()}\n`);
function dlog(msg) { fs.appendFileSync(DEBUGLOG, `${new Date().toISOString()} ${msg}\n`); }
process.on('uncaughtException', (err) => dlog('uncaughtException: ' + (err && err.stack || err)));
process.on('unhandledRejection', (err) => dlog('unhandledRejection: ' + (err && err.stack || err)));

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

// waitForChatBooted(아래)의 폴링 형태를 범용화한 헬퍼 — 고정 wait(ms) 대신 조건이
// 실제로 참이 될 때까지 짧은 간격으로 재확인한다. 반환값은 조건이 참이 된 시점의
// check() 결과(타임아웃이면 마지막 결과, 보통 falsy) — 호출부가 이 값으로 성공/
// 타임아웃을 함께 판정할 수 있다.
async function waitUntil(check, { timeoutMs = 1500, intervalMs = 50 } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    last = await check();
    if (last) return last;
    await wait(intervalMs);
  }
  return last;
}

// 2026-08-27(보드 45): 점은 설정을 열지 않는다 — 지금 점은 키우미 얼굴·메뉴
// 트리거이고 모드 전환은 사이드바 네비 몫. 설정 진입은 계정 메뉴 아니면 커맨드바다. 이 검증
// 프로필은 계좌가 비어 있어(위 §"검증 전용 프로필" 주석) 계정 행이 늘 숨어 있다
// — 그래서 여기서는 계정 메뉴가 아니라 언제나 있는 커맨드바("설정" 입력)를
// 신뢰성 있는 자극으로 쓴다. 검증8이 같은 경로를 별도로 더 자세히 잰다 — 이건
// 그 앞단에서 "설정 화면이 열려 있다"는 상태만 만들어주는 유틸이다.
async function openSettingsViaCommandBar(win) {
  await win.webContents.executeJavaScript(`
    (() => {
      const el = document.getElementById('input');
      el.value = '설정';
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })();
  `);
}

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
const bootPixelFrames = new Map();
async function shot(win, name) {
  const viewport = await win.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve({ width: innerWidth, height: innerHeight }))))'
  );
  const img = await win.webContents.capturePage();
  const buf = img.toPNG();
  fs.writeFileSync(path.join(CAPTURES, name), buf);
  captureLog.push({ name, hash: crypto.createHash('md5').update(buf).digest('hex'), winTitle: win.getTitle() });
  if (/^(01(?:w|c)?|02)-/.test(name)) {
    const size = img.getSize();
    bootPixelFrames.set(name, { ...size, viewport, bitmap: img.toBitmap() });
  }
  return img.getSize();
}

// BOOT-001 합성 가시성 — readiness-waiting과 expansion 중간의 **compact 바깥 픽셀**이
// 바뀌어야 실제 셸이 boot(20) 위에서 확장된 것이다. DOM clip만 움직이고 불투명
// boot가 계속 덮으면 이 영역은 waiting과 동일해 반드시 실패한다.
function measureBootCompositeReveal(waiting, mid, full) {
  if (!waiting || !mid || !full
    || waiting.width !== mid.width || waiting.height !== mid.height
    || waiting.width !== full.width || waiting.height !== full.height) {
    return { pass: false, reason: 'frame-size-mismatch' };
  }
  const scaleX = waiting.width / waiting.viewport.width;
  const scaleY = waiting.height / waiting.viewport.height;
  const compact = {
    left: (waiting.viewport.width / 2 - 360) * scaleX,
    right: (waiting.viewport.width / 2 + 360) * scaleX,
    top: (waiting.viewport.height / 2 - 130) * scaleY,
    bottom: (waiting.viewport.height / 2 + 130) * scaleY,
  };
  let sampled = 0;
  let changedFromWaiting = 0;
  let stillChangingToFull = 0;
  let shellLike = 0;
  for (let y = 0; y < waiting.height; y += 4) {
    for (let x = 0; x < waiting.width; x += 4) {
      if (x >= compact.left && x <= compact.right && y >= compact.top && y <= compact.bottom) continue;
      const i = (y * waiting.width + x) * 4;
      const hm = Math.abs(waiting.bitmap[i] - mid.bitmap[i])
        + Math.abs(waiting.bitmap[i + 1] - mid.bitmap[i + 1])
        + Math.abs(waiting.bitmap[i + 2] - mid.bitmap[i + 2]);
      const mf = Math.abs(mid.bitmap[i] - full.bitmap[i])
        + Math.abs(mid.bitmap[i + 1] - full.bitmap[i + 1])
        + Math.abs(mid.bitmap[i + 2] - full.bitmap[i + 2]);
      const hf = Math.abs(waiting.bitmap[i] - full.bitmap[i])
        + Math.abs(waiting.bitmap[i + 1] - full.bitmap[i + 1])
        + Math.abs(waiting.bitmap[i + 2] - full.bitmap[i + 2]);
      sampled += 1;
      if (hm > 24) changedFromWaiting += 1;
      if (mf > 24) stillChangingToFull += 1;
      if (hm > 24 && mf < hf) shellLike += 1;
    }
  }
  return {
    sampled,
    changedFromWaiting,
    stillChangingToFull,
    shellLike,
    pass: changedFromWaiting >= 25 && stillChangingToFull >= 25 && shellLike >= 10,
  };
}

// BOOT-001 투명 부팅 증거 — capturePage bitmap의 alpha를 직접 세어 화면 대부분이
// 실제 alpha 0이고 로고·타이핑·caret·현재 작업명에 해당하는 작은 painted island만 존재하는지
// 확인한다. CSS 문자열만 transparent여도 조상/가상요소가 면을 칠하면 실패한다.
function measureBootTransparency(frame) {
  if (!frame || !frame.bitmap || !frame.width || !frame.height) {
    return { pass: false, reason: 'frame-missing' };
  }
  let clearPixels = 0;
  let paintedPixels = 0;
  let opaquePixels = 0;
  let offMaskPaintedPixels = 0;
  let alphaSum = 0;
  const totalPixels = frame.bitmap.length / 4;
  const allowedBounds = {
    minX: Math.floor(frame.width * 0.32),
    maxX: Math.ceil(frame.width * 0.7),
    minY: Math.floor(frame.height * 0.28),
    maxY: Math.ceil(frame.height * 0.7),
  };
  const paintedBounds = {
    minX: frame.width,
    maxX: -1,
    minY: frame.height,
    maxY: -1,
  };
  for (let i = 3, pixelIndex = 0; i < frame.bitmap.length; i += 4, pixelIndex += 1) {
    const alpha = frame.bitmap[i];
    alphaSum += alpha;
    if (alpha <= 5) clearPixels += 1;
    else {
      paintedPixels += 1;
      const x = pixelIndex % frame.width;
      const y = Math.floor(pixelIndex / frame.width);
      paintedBounds.minX = Math.min(paintedBounds.minX, x);
      paintedBounds.maxX = Math.max(paintedBounds.maxX, x);
      paintedBounds.minY = Math.min(paintedBounds.minY, y);
      paintedBounds.maxY = Math.max(paintedBounds.maxY, y);
      if (x < allowedBounds.minX || x > allowedBounds.maxX
        || y < allowedBounds.minY || y > allowedBounds.maxY) {
        offMaskPaintedPixels += 1;
      }
    }
    if (alpha >= 200) opaquePixels += 1;
  }
  const transparentRatio = totalPixels ? clearPixels / totalPixels : 0;
  const paintedRatio = totalPixels ? paintedPixels / totalPixels : 1;
  const boundsFit = paintedPixels > 0
    && paintedBounds.minX >= allowedBounds.minX
    && paintedBounds.maxX <= allowedBounds.maxX
    && paintedBounds.minY >= allowedBounds.minY
    && paintedBounds.maxY <= allowedBounds.maxY;
  return {
    totalPixels,
    clearPixels,
    paintedPixels,
    opaquePixels,
    offMaskPaintedPixels,
    allowedBounds,
    paintedBounds,
    transparentRatio: Number(transparentRatio.toFixed(4)),
    paintedRatio: Number(paintedRatio.toFixed(4)),
    meanAlpha: totalPixels ? Number((alphaSum / totalPixels).toFixed(2)) : null,
    boundsFit,
    pass: transparentRatio >= 0.97
      && paintedPixels >= 1000
      && paintedRatio <= 0.025
      && offMaskPaintedPixels === 0
      && boundsFit,
  };
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

// BOOT-001 C1 실측 — 시각적으로 투명한 ATHENA 폭 guide 위에서 파란 글자가 접두사
// 순서대로 끝까지 입력되고, 글자 뒤 별도 색상 면 없이 핑크 커서가 유지되며, borderless 조판이 실제
// Page 1 셸 위에서 확장되는지 60ms 간격으로 표집한다. reduced-motion은 완성된
// 정적 조판만 짧게 보여주고 같은 단일 finishBoot 경로로 완료하는 것이 계약이다.
async function traceBootBar(shellWin, timeoutMs = 12000, completionSnapshotProvider = null) {
  const senderId = shellWin.webContents.id;
  const probe = `(() => {
    const boot = document.getElementById('boot');
    const name = document.getElementById('bootName');
    const panel = document.getElementById('bootPanel');
    const cursor = document.querySelector('.boot-cursor');
    const logo = document.querySelector('.boot-logo');
    const stage = document.querySelector('.boot-stage');
    const base = document.querySelector('.boot-base');
    const typedLayer = document.querySelector('.boot-typed-layer');
    const wordline = document.querySelector('.boot-wordline');
    const status = document.querySelector('.boot-status');
    const task = document.getElementById('bootTask');
    const shell = document.getElementById('shell');
    const chars = name ? Array.from(name.children) : [];
    const shellMapCells = Array.from(document.querySelectorAll('.boot-shell-map > span'));
    const bootStyle = boot ? getComputedStyle(boot) : null;
    const baseStyle = base ? getComputedStyle(base) : null;
    const cursorStyle = cursor ? getComputedStyle(cursor) : null;
    const stageStyle = stage ? getComputedStyle(stage) : null;
    const logoRect = logo ? logo.getBoundingClientRect() : null;
    const shellStyle = shell ? getComputedStyle(shell) : null;
    const shellRect = shell ? shell.getBoundingClientRect() : null;
    const bootSurfaceNodes = [
      boot, panel, stage, logo, wordline, base, typedLayer, name, cursor, task, status,
    ].filter(Boolean);
    return {
      booting: !!boot && !boot.hidden,
      name: name ? name.textContent : '',
      recordedTypedPrefixes: boot ? (boot.dataset.typedPrefixes || '').split('|').filter(Boolean) : [],
      phase: boot ? boot.dataset.phase : null,
      startupPhase: boot ? boot.dataset.startupPhase : null,
      localReadiness: boot ? boot.dataset.localReadiness : null,
      localFailureReason: boot ? boot.dataset.localFailureReason : null,
      finishCount: boot ? Number(boot.dataset.finishCount || '0') : 0,
      timings: boot ? {
        startedAt: Number(boot.dataset.startedAt || '0'),
        typingAt: Number(boot.dataset.typingAt || '0'),
        typedAt: Number(boot.dataset.typedAt || '0'),
        visualMinimumAt: Number(boot.dataset.visualMinimumAt || '0'),
        reducedStaticAt: Number(boot.dataset.reducedStaticAt || '0'),
        expandingAt: Number(boot.dataset.expandingAt || '0'),
        completedAt: Number(boot.dataset.completedAt || '0'),
      } : null,
      expanding: !!boot && boot.classList.contains('is-expanding'),
      shellVisible: !!shell && !shell.hidden,
      appVisible: !document.getElementById('app').hidden,
      modeSurfaceVisible: ['app', 'onboard', 'settings', 'order']
        .map((id) => document.getElementById(id))
        .some((node) => node && !node.hidden),
      viewport: { width: innerWidth, height: innerHeight },
      shellClipPath: shellStyle ? shellStyle.clipPath : '',
      shellTransform: shellStyle ? shellStyle.transform : '',
      shellTransitionProperty: shellStyle ? shellStyle.transitionProperty : '',
      shellTransitionDuration: shellStyle ? shellStyle.transitionDuration : '',
      shellRect: shellRect ? {
        left: shellRect.left,
        top: shellRect.top,
        width: shellRect.width,
        height: shellRect.height,
      } : null,
      clipPath: panel ? getComputedStyle(panel).clipPath : '',
      panelSurface: panel ? {
        backgroundColor: getComputedStyle(panel).backgroundColor,
        backgroundImage: getComputedStyle(panel).backgroundImage,
        borderWidth: getComputedStyle(panel).borderWidth,
        borderRadius: getComputedStyle(panel).borderRadius,
        boxShadow: getComputedStyle(panel).boxShadow,
      } : null,
      bootSurface: bootStyle ? {
        backgroundColor: bootStyle.backgroundColor,
        backgroundImage: bootStyle.backgroundImage,
        zIndex: bootStyle.zIndex,
      } : null,
      shellZIndex: shellStyle ? shellStyle.zIndex : '',
      failureVisible: false,
      retryVisible: false,
      statusText: status ? status.textContent : '',
      taskVisible: !!task && !task.hidden,
      taskText: task ? task.textContent : '',
      taskId: boot ? boot.dataset.currentTaskId : '',
      taskState: boot ? boot.dataset.currentTaskState : '',
      taskLabel: boot ? boot.dataset.currentTaskLabel : '',
      taskSurface: task ? {
        backgroundColor: getComputedStyle(task).backgroundColor,
        backgroundImage: getComputedStyle(task).backgroundImage,
        borderWidth: getComputedStyle(task).borderWidth,
        borderRadius: getComputedStyle(task).borderRadius,
        boxShadow: getComputedStyle(task).boxShadow,
        fontSize: getComputedStyle(task).fontSize,
        lineHeight: getComputedStyle(task).lineHeight,
      } : null,
      noBootProgress: !document.querySelector('.boot progress, .boot [role="progressbar"]'),
      baseText: base ? base.textContent : '',
      baseColor: baseStyle ? baseStyle.color : '',
      baseBackgroundColor: baseStyle ? baseStyle.backgroundColor : '',
      baseFontSize: baseStyle ? baseStyle.fontSize : '',
      baseLineHeight: baseStyle ? baseStyle.lineHeight : '',
      baseLetterSpacing: baseStyle ? baseStyle.letterSpacing : '',
      stageGap: stageStyle ? stageStyle.gap : '',
      logoSize: logoRect ? { width: Math.round(logoRect.width), height: Math.round(logoRect.height) } : null,
      typedLayerIsOverlay: !!typedLayer && getComputedStyle(typedLayer).position === 'absolute',
      noExtraCopy: !document.querySelector('.boot-folio, .boot-caption'),
      charColors: chars.map((n) => getComputedStyle(n).color),
      cursorText: cursor ? cursor.textContent : '',
      cursorColor: cursorStyle ? cursorStyle.color : '',
      cursorFontSize: cursorStyle ? cursorStyle.fontSize : '',
      cursorAnimation: cursorStyle ? cursorStyle.animationName : '',
      cursorOpacity: cursorStyle ? Number.parseFloat(cursorStyle.opacity) : null,
      staticLogoPresent: !!logo
        && logo.getAttribute('aria-label') === '키움증권'
        && getComputedStyle(logo).transform === 'none',
      staticLogoVisible: !!logo && logo.getBoundingClientRect().width > 0,
      noHandoff: document.getElementById('bootArrow') === null
        && !document.querySelector('.boot-arrow, .is-arrow-handoff'),
      noInternalWindows: shellMapCells.length === 0,
      bootHierarchyBorderless: bootSurfaceNodes.every((node) => {
        const cs = getComputedStyle(node);
        return cs.borderWidth === '0px'
          && cs.borderRadius === '0px'
          && cs.boxShadow === 'none';
      }),
      stableStatusAnnouncement: !!status
        && document.querySelectorAll('.boot-status[role="status"]').length === 1
        && status.getAttribute('aria-live') === 'polite'
        && status.getAttribute('aria-atomic') === 'true'
        && status.textContent.trim().length > 0
        && task.getAttribute('aria-hidden') === 'true'
        && name.getAttribute('aria-hidden') === 'true'
        && wordline.getAttribute('aria-hidden') === 'true',
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  })()`;
  const t0 = Date.now();
  let sawFullName = false;
  const typedPrefixes = new Set();
  const phases = new Set();
  let sawCompactStage = false;
  let sawBorderlessSurface = false;
  let sawExpansionOverShell = false;
  let sawStaticLogo = false;
  let sawCaretVisible = false;
  let sawCaretHidden = false;
  let sawShellCompactMask = false;
  let sawShellAboveBoot = false;
  let shellTransitionContract = false;
  const shellClipPaths = new Set();
  let sawTransparentBootSurface = false;
  let sawVisibleTask = false;
  let taskAppearedBeforeFullName = false;
  let taskSurfacePlain = false;
  const taskLabels = new Set();
  const taskStates = new Set();
  let sawPaperTypeScale = false;
  let maxName = '';
  let reducedMotion = false;
  let lastState = null;
  while (Date.now() - t0 < timeoutMs) {
    let s;
    try { s = await shellWin.webContents.executeJavaScript(probe); } catch { break; }
    lastState = s;
    reducedMotion = s.reducedMotion;
    if (!s.booting) break;
    if (s.phase) phases.add(s.phase);
    if (s.name.length > maxName.length) maxName = s.name;
    if (s.name && 'ATHENA'.startsWith(s.name)) typedPrefixes.add(s.name);
    for (const prefix of s.recordedTypedPrefixes || []) {
      if (prefix && 'ATHENA'.startsWith(prefix)) typedPrefixes.add(prefix);
    }
    if (s.name === 'ATHENA') sawFullName = true;
    if (s.taskVisible) {
      sawVisibleTask = true;
      if (s.name !== 'ATHENA') taskAppearedBeforeFullName = true;
      if (s.taskText) taskLabels.add(s.taskText);
      if (s.taskState) taskStates.add(s.taskState);
    }
    if (s.taskSurface
      && s.taskSurface.backgroundColor === 'rgba(0, 0, 0, 0)'
      && s.taskSurface.backgroundImage === 'none'
      && s.taskSurface.borderWidth === '0px'
      && s.taskSurface.borderRadius === '0px'
      && s.taskSurface.boxShadow === 'none'
      && Number.parseFloat(s.taskSurface.fontSize) === 13
      && Number.parseFloat(s.taskSurface.lineHeight) === 18
      && s.noBootProgress === true) taskSurfacePlain = true;
    if (!s.expanding && s.clipPath && s.clipPath !== 'none') sawCompactStage = true;
    if (s.panelSurface
      && s.panelSurface.backgroundColor === 'rgba(0, 0, 0, 0)'
      && s.panelSurface.backgroundImage === 'none'
      && s.panelSurface.borderWidth === '0px'
      && s.panelSurface.borderRadius === '0px'
      && s.panelSurface.boxShadow === 'none') sawBorderlessSurface = true;
    if (s.bootSurface
      && s.bootSurface.backgroundColor === 'rgba(0, 0, 0, 0)'
      && s.bootSurface.backgroundImage === 'none') {
      sawTransparentBootSurface = true;
    }
    if (Number.parseFloat(s.baseFontSize) === 112
      && Number.parseFloat(s.baseLineHeight) === 112
      && Number.parseFloat(s.baseLetterSpacing) >= -4.6
      && Number.parseFloat(s.baseLetterSpacing) <= -4.3
      && Number.parseFloat(s.cursorFontSize) === 112
      && s.stageGap === '28px'
      && s.logoSize && s.logoSize.width === 220 && s.logoSize.height === 69
      && s.typedLayerIsOverlay === true
      && s.noExtraCopy === true) {
      sawPaperTypeScale = true;
    }
    if (s.staticLogoVisible) sawStaticLogo = true;
    if (s.cursorOpacity >= 0.95) sawCaretVisible = true;
    if (s.cursorOpacity <= 0.05) sawCaretHidden = true;
    if (s.expanding && s.shellVisible && s.shellClipPath && s.shellClipPath !== 'none') {
      shellClipPaths.add(s.shellClipPath);
      if (Number.parseInt(s.shellZIndex, 10) > Number.parseInt(s.bootSurface.zIndex, 10)) {
        sawShellAboveBoot = true;
      }
      if (s.shellTransitionProperty.split(',').map((value) => value.trim()).includes('clip-path')
        && s.shellTransitionDuration.split(',').map((value) => value.trim()).includes('0.48s')) {
        shellTransitionContract = true;
      }
      if (s.shellRect && s.viewport
        && s.shellRect.width < s.viewport.width - 1
        && s.shellRect.height < s.viewport.height - 1) sawShellCompactMask = true;
    }
    if (s.expanding && s.shellVisible && s.modeSurfaceVisible) sawExpansionOverShell = true;
    await wait(60);
  }
  try { lastState = await shellWin.webContents.executeJavaScript(probe); } catch { /* 창 종료 */ }
  const finalColors = (lastState && lastState.charColors) || [];
  const baseWordPresent = !!lastState && lastState.baseText === 'ATHENA';
  const baseIsTransparent = !!lastState
    && lastState.baseColor === 'rgba(0, 0, 0, 0)'
    && lastState.baseBackgroundColor === 'rgba(0, 0, 0, 0)';
  const overlayIsBlue = finalColors.length === 6
    && finalColors.every((c) => c === 'rgb(14, 32, 178)');
  const cursorIsPink = !!lastState
    && lastState.cursorText === '|'
    && lastState.cursorColor === 'rgb(238, 19, 123)';
  const backgroundIsTransparent = sawTransparentBootSurface || (!!lastState && !!lastState.bootSurface
    && lastState.bootSurface.backgroundColor === 'rgba(0, 0, 0, 0)'
    && lastState.bootSurface.backgroundImage === 'none');
  const typeScaleMatchesPaper = sawPaperTypeScale || (!!lastState
    && Number.parseFloat(lastState.baseFontSize) === 112
    && Number.parseFloat(lastState.baseLineHeight) === 112
    && Number.parseFloat(lastState.cursorFontSize) === 112
    && lastState.stageGap === '28px'
    && lastState.logoSize && lastState.logoSize.width === 220 && lastState.logoSize.height === 69
    && lastState.typedLayerIsOverlay === true && lastState.noExtraCopy === true);
  const cursorBlinks = !!lastState && (
    lastState.reducedMotion
    || /boot-caret-blink/.test(lastState.cursorAnimation)
  );
  const staticLogoPresent = !!lastState && lastState.staticLogoPresent === true;
  const noHandoff = !!lastState && lastState.noHandoff === true;
  const noInternalWindows = !!lastState && lastState.noInternalWindows === true;
  const bootHierarchyBorderless = !!lastState && lastState.bootHierarchyBorderless === true;
  const stableStatusAnnouncement = !!lastState && lastState.stableStatusAnnouncement === true;
  const sawShellMaskProgress = shellClipPaths.size >= 2;
  const completionSnapshot = typeof completionSnapshotProvider === 'function'
    ? completionSnapshotProvider(senderId)
    : null;
  const shellFinishedFull = completionSnapshot?.shellFinishedFull === true || (!!lastState
    && lastState.shellVisible === true
    && lastState.shellClipPath === 'none'
    && lastState.shellRect && lastState.viewport
    && Math.abs(lastState.shellRect.width - lastState.viewport.width) <= 1
    && Math.abs(lastState.shellRect.height - lastState.viewport.height) <= 1);
  const finishCount = completionSnapshot?.finishCount ?? (lastState ? lastState.finishCount : 0);
  const expandedFromTypedFrame = !!lastState && lastState.expanding === true;
  const prefixCount = typedPrefixes.size;
  const timingSource = completionSnapshot?.timings || (lastState && lastState.timings) || {};
  const taskFirstShownAfterTyped = timingSource.taskFirstShownAt > 0
    && timingSource.typedAt > 0
    && timingSource.taskFirstShownAt >= timingSource.typedAt;
  const reducedStaticCommitted = !!lastState
    && (!lastState.reducedMotion || timingSource.reducedStaticAt > 0);
  const reducedReadinessWaitMs = reducedMotion
    ? timingSource.reducedStaticAt - timingSource.visualMinimumAt
    : null;
  const reducedBootMs = reducedMotion
    ? timingSource.completedAt - timingSource.startedAt
    : null;
  const bootTiming = reducedMotion ? null : {
    readyMs: timingSource.typingAt - timingSource.startedAt,
    typingMs: timingSource.typedAt - timingSource.typingAt,
    minimumHoldMs: timingSource.visualMinimumAt - timingSource.typedAt,
    readinessWaitMs: timingSource.expandingAt - timingSource.visualMinimumAt,
    holdMs: timingSource.expandingAt - timingSource.typedAt,
    expandMs: timingSource.completedAt - timingSource.expandingAt,
    totalMs: timingSource.completedAt - timingSource.startedAt,
  };
  const timingMatches = reducedMotion ? reducedBootMs >= 1920 : (
    bootTiming.readyMs >= 180 && bootTiming.readyMs <= 340
    && bootTiming.typingMs >= 860 && bootTiming.typingMs <= 1080
    && bootTiming.minimumHoldMs >= 180 && bootTiming.minimumHoldMs <= 340
    && bootTiming.readinessWaitMs >= 0
    && bootTiming.expandMs >= 400 && bootTiming.expandMs <= 580
    && bootTiming.totalMs >= 1850
  );
  return {
    sawFullName,
    prefixCount,
    typedPrefixes: Array.from(typedPrefixes),
    baseWordPresent,
    baseIsTransparent,
    overlayIsBlue,
    cursorIsPink,
    backgroundIsTransparent,
    typeScaleMatchesPaper,
    cursorBlinks,
    sawCaretVisible,
    sawCaretHidden,
    staticLogoPresent,
    sawStaticLogo,
    noHandoff,
    noInternalWindows,
    bootHierarchyBorderless,
    stableStatusAnnouncement,
    sawVisibleTask,
    taskAppearedBeforeFullName,
    taskSurfacePlain,
    taskLabels: Array.from(taskLabels),
    taskStates: Array.from(taskStates),
    sawShellCompactMask,
    sawShellAboveBoot,
    sawShellMaskProgress,
    shellTransitionContract,
    shellClipPaths: Array.from(shellClipPaths),
    shellFinishedFull,
    sawCompactStage,
    sawBorderlessSurface,
    sawExpansionOverShell,
    expandedFromTypedFrame,
    finishCount,
    reducedStaticCommitted,
    reducedReadinessWaitMs,
    reducedBootMs,
    bootTiming,
    timingMatches,
    taskFirstShownAfterTyped,
    phases: Array.from(phases),
    maxName,
    reducedMotion,
    pass: baseWordPresent && baseIsTransparent && overlayIsBlue && cursorIsPink
      && backgroundIsTransparent && typeScaleMatchesPaper
      && cursorBlinks && timingMatches
      && staticLogoPresent
      && noHandoff && noInternalWindows && bootHierarchyBorderless
      && stableStatusAnnouncement && taskSurfacePlain && !taskAppearedBeforeFullName && finishCount === 1
      && reducedStaticCommitted
      && (reducedMotion || (
        sawFullName
        && prefixCount >= 4
        && sawCaretVisible
        && (sawCaretHidden || cursorBlinks)
        && sawCompactStage
        && sawBorderlessSurface
        && sawStaticLogo
        && sawExpansionOverShell
        && sawShellCompactMask
        && sawShellAboveBoot
        && (sawShellMaskProgress || shellTransitionContract)
        && shellFinishedFull
        && expandedFromTypedFrame
      )),
  };
}

// 검증22(알림 오브)의 접힘 상태 DOM 프로브 — 발화 눈 모양 안정화를 기다릴 때와
// 최종 리포트 측정 때 같은 쿼리를 반복 호출한다(함수로 뽑아 재사용, 새 측정
// 로직을 만들지 않는다).
async function probeOrbCollapsed(win) {
  return win.webContents.executeJavaScript(`(() => {
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
      // 발화(fired) 상태의 눈 기하 — orbQuietEyeProbe와 짝을 맞춰 대기↔발화의
      // 실제 모양 차이를 잰다(더는 바이저 폭이 아니다).
      eyeWidth: (() => {
        const e = document.querySelector('#orbVisor .orb-eye');
        return e ? e.getBoundingClientRect().width : null;
      })(),
      eyeHeight: (() => {
        const e = document.querySelector('#orbVisor .orb-eye');
        return e ? e.getBoundingClientRect().height : null;
      })(),
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
  report.verifyProfile = {
    runId: VERIFY_PROFILE.runId,
    scenario: VERIFY_PROFILE.scenario,
    directoryName: path.basename(VERIFY_PROFILE.directory),
    uniqueTemporaryProfile: path.basename(VERIFY_PROFILE.directory).startsWith('athena-verify-'),
    fixedProfileUnused: path.resolve(app.getPath('userData')) !== path.resolve(FIXED_VERIFY_PROFILE),
    capturesOutsideProfile: !path.resolve(CAPTURES).startsWith(`${path.resolve(VERIFY_PROFILE.directory)}${path.sep}`),
    cleanupWatchdogStarted: Number.isInteger(VERIFY_PROFILE_CLEANUP_WATCHDOG_PID),
    previousCleanupDiagnostics: VERIFY_PROFILE.cleanupDiagnostics,
  };
  assertOk('verify profile: every run uses a fresh temporary userData directory',
    report.verifyProfile.uniqueTemporaryProfile === true
      && report.verifyProfile.fixedProfileUnused === true
      && report.verifyProfile.capturesOutsideProfile === true
      && report.verifyProfile.cleanupWatchdogStarted === true);
  const mainMod = require('./main.js');
  dlog('main.js required');

  // ---------- 창 생성 (main.js와 동일 경로) ----------
  await mainMod.createWindows();
  dlog('createWindows done');
  const { bootWin, shellWin, orbWin } = mainMod.getWins();
  const layout = mainMod.getLayout();
  report.layout = layout;

  async function createBootScenarioWindow() {
    const win = new BrowserWindow({
      x: layout.originX,
      y: layout.originY,
      width: layout.shellW,
      height: layout.shellH,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      show: false,
      resizable: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js'),
        backgroundThrottling: false,
      },
    });
    mainMod.registerVerifyBootWindow(win);
    const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    win.loadFile(path.join(__dirname, 'shell.html'));
    await loaded;
    win.show();
    win.focus();
    win.webContents.send('athena:init', { scale: layout.scale, canvasSource: 'fixture' });
    return win;
  }

  const bootBarPromise = traceBootBar(bootWin, 12000, mainMod.getBootCompletionSnapshotForVerify);
  const initialVisibleWindows = BrowserWindow.getAllWindows().filter((win) => win.isVisible());
  const preHandoffShellOverlay = await shellWin.webContents.executeJavaScript(`({
    nativeOverlayAvailable: !!navigator.windowControlsOverlay,
    nativeControlsSelected: document.documentElement.classList.contains('uses-native-window-controls'),
    customControlsHidden: document.getElementById('winControls').hidden,
  })`);
  report.bootChatOnly = {
    openWindowCount: initialVisibleWindows.length,
    preHandoffVisibleWindowCount: initialVisibleWindows.length,
    bootVisibleAtBoot: bootWin.isVisible(),
    shellHiddenAtBoot: !shellWin.isVisible(),
    orbVisibleAtBoot: !!orbWin && orbWin.isVisible(),
    orbHiddenAtBoot: !!orbWin && !orbWin.isVisible(),
    preHandoffShellOverlay,
  };
  const typingFrameState = await bootWin.webContents.executeJavaScript(`(() => {
    const boot = document.getElementById('boot');
    const task = document.getElementById('bootTask');
    return { phase: boot.dataset.phase, name: document.getElementById('bootName').textContent,
      taskHidden: task.hidden, taskState: boot.dataset.currentTaskState || '' };
  })()`);
  dlog('before shot 01'); const s1 = await shot(bootWin, '01-boot-sequence.png'); dlog('after shot 01');
  // 첫 캡처는 아직 readiness runner를 시작하지 않은 실제 typing 상태다. 캡처 뒤
  // runner를 시작해 다음 증거가 ATHENA+현재 작업명 waiting 상태임을 보장한다.
  mainMod.startBootReadinessForVerify();
  const bootTaskReachedAfterAthena = await waitUntil(
    () => bootWin.webContents.executeJavaScript(`(() => {
      const boot = document.getElementById('boot');
      const name = document.getElementById('bootName');
      const task = document.getElementById('bootTask');
      return !!boot && !boot.hidden && !boot.classList.contains('is-expanding')
        && !!name && name.textContent === 'ATHENA'
        && !!task && !task.hidden
        && task.textContent === '검증용 합성 준비 작업'
        && boot.dataset.currentTaskState === 'running';
    })()`),
    { timeoutMs: 2200, intervalMs: 30 },
  );
  const initialTaskStatus = await bootWin.webContents.executeJavaScript(`(() => {
    const boot = document.getElementById('boot');
    const task = document.getElementById('bootTask');
    const style = getComputedStyle(task);
    return {
      visible: !task.hidden,
      text: task.textContent,
      id: boot.dataset.currentTaskId,
      state: boot.dataset.currentTaskState,
      statusText: document.getElementById('bootStatus').textContent,
      plain: style.backgroundColor === 'rgba(0, 0, 0, 0)'
        && style.backgroundImage === 'none'
        && style.borderWidth === '0px'
        && style.borderRadius === '0px'
        && style.boxShadow === 'none'
        && !document.querySelector('.boot progress, .boot [role="progressbar"]'),
    };
  })()`);
  const waitingAfterMinimum = await waitUntil(
    () => bootWin.webContents.executeJavaScript(`(() => {
      const boot = document.getElementById('boot');
      const name = document.getElementById('bootName');
      const cursor = document.querySelector('.boot-cursor');
      const stage = document.querySelector('.boot-stage');
      const task = document.getElementById('bootTask');
      const elapsed = performance.now() - Number(boot.dataset.startedAt || '0');
      return elapsed >= 1920
        && boot.dataset.phase === 'waiting'
        && boot.dataset.startupPhase === 'running'
        && Number(boot.dataset.finishCount || '0') === 0
        && name.textContent === 'ATHENA'
        && cursor.getBoundingClientRect().height > 0
        && getComputedStyle(cursor).animationName === 'boot-caret-blink'
        && getComputedStyle(stage).opacity === '1'
        && !task.hidden
        && task.textContent === '검증용 합성 준비 작업'
        && boot.dataset.currentTaskState === 'running'
        && document.getElementById('shell').hidden;
    })()`),
    { timeoutMs: 2600, intervalMs: 25 },
  );
  const waitingFrameState = await bootWin.webContents.executeJavaScript(`(() => {
    const boot = document.getElementById('boot');
    const task = document.getElementById('bootTask');
    return { phase: boot.dataset.phase, name: document.getElementById('bootName').textContent,
      taskHidden: task.hidden, taskText: task.textContent, taskState: boot.dataset.currentTaskState || '' };
  })()`);
  dlog('before shot 01w'); const s1w = await shot(bootWin, '01w-boot-readiness-waiting.png'); dlog('after shot 01w');
  const authoritativeRunning = await mainMod.bootReadinessHandlers.get({ sender: bootWin.webContents });
  const orbReadinessRejected = await orbWin.webContents.executeJavaScript(
    `window.athena.invoke('athena:boot-readiness:get').then(() => false, () => true)`,
  );
  bootWin.webContents.send('athena:boot-readiness', {
    ...authoritativeRunning,
    revision: Math.max(0, authoritativeRunning.revision - 1),
    phase: 'ready',
  });
  bootWin.webContents.send('athena:boot-readiness', {
    ...authoritativeRunning,
    runId: 'stale-foreign-run',
    revision: authoritativeRunning.revision + 1000,
    phase: 'ready',
  });
  await wait(100);
  const staleReadinessIgnored = await bootWin.webContents.executeJavaScript(`(() => {
    const boot = document.getElementById('boot');
    return boot.dataset.phase === 'waiting'
      && boot.dataset.startupRunId === ${JSON.stringify(authoritativeRunning.runId)}
      && boot.dataset.currentTaskLabel === '검증용 합성 준비 작업'
      && boot.dataset.currentTaskState === 'running'
      && Number(boot.dataset.finishCount || '0') === 0
      && document.getElementById('shell').hidden;
  })()`);
  const degradedReached = await waitUntil(
    () => bootWin.webContents.executeJavaScript(`(() => {
      const boot = document.getElementById('boot');
      return boot.dataset.startupPhase === 'degraded'
        && document.getElementById('bootFailure') === null
        && document.getElementById('bootRetry') === null;
    })()`),
    { timeoutMs: 5000, intervalMs: 30 },
  );
  const bootExpansionReached = await waitUntil(
    () => bootWin.webContents.executeJavaScript(`(() => {
      const boot = document.getElementById('boot');
      return !!boot && !boot.hidden && boot.classList.contains('is-expanding');
    })()`),
    { timeoutMs: 5000, intervalMs: 15 },
  );
  await wait(140);
  dlog('before shot 01c'); const s1c = await shot(bootWin, '01c-boot-shell-expanding.png'); dlog('after shot 01c');
  const boot = await waitForChatBooted(shellWin);
  const bootBar = await bootBarPromise;
  const startupNotificationVisible = await waitUntil(
    () => shellWin.webContents.executeJavaScript(`(() => {
      const notice = document.getElementById('appNotification');
      return !notice.hidden && Number(notice.dataset.showCount || '0') === 1
        && notice.textContent.includes('검증용 합성 준비 작업');
    })()`),
    { timeoutMs: 1500, intervalMs: 25 },
  );
  const orbStartupNotificationCount = await orbWin.webContents.executeJavaScript(
    `Number(document.getElementById('orbCount').textContent || '0')`,
  );
  await orbWin.webContents.executeJavaScript(`document.getElementById('orb').click()`);
  await waitUntil(
    () => orbWin.webContents.executeJavaScript(
      `document.getElementById('orbRoot').dataset.state === 'expanded'`,
    ),
    { timeoutMs: 1200, intervalMs: 25 },
  );
  const orbStartupPanel = await orbWin.webContents.executeJavaScript(`(() => ({
    badge: document.getElementById('orbBadge').textContent,
    body: document.getElementById('orbBody').textContent,
    source: document.getElementById('orbSource').textContent,
  }))()`);
  await orbWin.webContents.executeJavaScript(`document.getElementById('orbClose').click()`);
  await waitUntil(
    () => orbWin.webContents.executeJavaScript(
      `document.getElementById('orbRoot').dataset.state === 'collapsed'`,
    ),
    { timeoutMs: 1200, intervalMs: 25 },
  );
  orbWin.webContents.send('athena:app-notification', {
    title: '시작 알림 순서 검증', body: '먼저 도착한 시작 알림입니다.',
  });
  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-fired', routine_id: 'boot-order-routine', symbol: '005930', source: 'price.change_rate',
    observed: 5.3, threshold: 5.0, note: '나중에 도착한 루틴 알림',
    fired_at: new Date().toISOString(),
  });
  await waitUntil(
    () => orbWin.webContents.executeJavaScript(
      `document.getElementById('orbCount').textContent === '2'`,
    ),
    { timeoutMs: 1200, intervalMs: 25 },
  );
  await orbWin.webContents.executeJavaScript(`document.getElementById('orb').click()`);
  await waitUntil(
    () => orbWin.webContents.executeJavaScript(
      `document.getElementById('orbRoot').dataset.state === 'expanded'`,
    ),
    { timeoutMs: 1200, intervalMs: 25 },
  );
  const orbOrderedFirst = await orbWin.webContents.executeJavaScript(`({
    badge: document.getElementById('orbBadge').textContent,
    body: document.getElementById('orbBody').textContent,
    remaining: document.getElementById('orbCount').textContent,
  })`);
  await orbWin.webContents.executeJavaScript(`document.getElementById('orbClose').click()`);
  await waitUntil(
    () => orbWin.webContents.executeJavaScript(
      `document.getElementById('orbRoot').dataset.state === 'collapsed'`,
    ),
    { timeoutMs: 1200, intervalMs: 25 },
  );
  await orbWin.webContents.executeJavaScript(`document.getElementById('orb').click()`);
  await waitUntil(
    () => orbWin.webContents.executeJavaScript(
      `document.getElementById('orbRoot').dataset.state === 'expanded'`,
    ),
    { timeoutMs: 1200, intervalMs: 25 },
  );
  const orbOrderedSecond = await orbWin.webContents.executeJavaScript(`({
    body: document.getElementById('orbBody').textContent,
    source: document.getElementById('orbSource').textContent,
    remaining: document.getElementById('orbCount').textContent,
  })`);
  await orbWin.webContents.executeJavaScript(`document.getElementById('orbClose').click()`);
  await waitUntil(
    () => orbWin.webContents.executeJavaScript(
      `document.getElementById('orbRoot').dataset.state === 'collapsed'`,
    ),
    { timeoutMs: 1200, intervalMs: 25 },
  );
  await waitUntil(
    () => JSON.stringify(mainMod.getStartupFailureNotificationResult().delivered)
      === JSON.stringify(['shell', 'orb', 'os']),
    { timeoutMs: 3000, intervalMs: 25 },
  );
  const notificationDelivery = mainMod.getStartupFailureNotificationResult();
  dlog('boot done, before shot 02'); const s2 = await shot(shellWin, '02-chat-only-idle.png'); dlog('after shot 02');
  const postHandoffVisibleWindows = BrowserWindow.getAllWindows().filter((win) => win.isVisible());
  const postHandoffAllWindows = BrowserWindow.getAllWindows();
  const postHandoffShellOverlay = await shellWin.webContents.executeJavaScript(`({
    nativeOverlayAvailable: !!navigator.windowControlsOverlay,
    nativeControlsSelected: document.documentElement.classList.contains('uses-native-window-controls'),
    customControlsHidden: document.getElementById('winControls').hidden,
  })`);
  const compositeReveal = measureBootCompositeReveal(
    bootPixelFrames.get('01w-boot-readiness-waiting.png'),
    bootPixelFrames.get('01c-boot-shell-expanding.png'),
    bootPixelFrames.get('02-chat-only-idle.png'),
  );
  const transparentFrames = {
    typing: measureBootTransparency(bootPixelFrames.get('01-boot-sequence.png')),
    waiting: measureBootTransparency(bootPixelFrames.get('01w-boot-readiness-waiting.png')),
  };
  report.bootChatOnly.shots = {
    typing: s1, readinessWaiting: s1w, expanding: s1c, idle: s2,
  };
  report.bootChatOnly.bootTaskReachedAfterAthena = bootTaskReachedAfterAthena === true;
  report.bootChatOnly.frameStates = { typing: typingFrameState, readinessWaiting: waitingFrameState };
  report.bootChatOnly.currentTaskStatus = initialTaskStatus;
  report.bootChatOnly.waitingAfterVisualMinimum = waitingAfterMinimum === true;
  report.bootChatOnly.staleReadinessIgnored = staleReadinessIgnored === true;
  report.bootChatOnly.orbReadinessRejected = orbReadinessRejected === true;
  report.bootChatOnly.degradedNotification = {
    degradedReached: degradedReached === true,
    shellVisibleOnce: startupNotificationVisible === true,
    orbUnreadCount: orbStartupNotificationCount,
    orbPanel: orbStartupPanel,
    orbArrivalOrder: { first: orbOrderedFirst, second: orbOrderedSecond },
    delivery: notificationDelivery,
  };
  report.bootChatOnly.expansionFrameCaptured = bootExpansionReached === true;
  report.bootChatOnly.compositeReveal = compositeReveal;
  report.bootChatOnly.transparentFrames = transparentFrames;
  report.bootChatOnly.chatBootedAfterBoot = boot.booted;
  report.bootChatOnly.bootMode = boot.mode;
  report.bootChatOnly.exactlyOneModeVisible = boot.exactlyOneModeVisible;
  report.bootChatOnly.panels = boot.panels;
  report.bootChatOnly.postHandoff = {
    bootDestroyed: bootWin.isDestroyed(),
    shellVisible: shellWin.isVisible(),
    orbVisible: !!orbWin && orbWin.isVisible(),
    orbHidden: !!orbWin && !orbWin.isVisible(),
    visibleWindowCount: postHandoffVisibleWindows.length,
    allWindowCountBaseline: postHandoffAllWindows.length,
    shellOverlay: postHandoffShellOverlay,
    visibilityAudit: mainMod.getShellHandoffVisibilityAudit(),
  };
  // 1b — BOOT-001 C1: 자리표시자를 덮어쓴 ATHENA 프레임이 실제 Page 1 셸로 확장된다.
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
  assertOk('boot: before handoff only the transparent boot renderer is visible; shell and orb stay hidden',
    report.bootChatOnly.preHandoffVisibleWindowCount === 1
      && report.bootChatOnly.bootVisibleAtBoot === true
      && report.bootChatOnly.shellHiddenAtBoot === true
      && report.bootChatOnly.orbHiddenAtBoot === true
      && report.bootChatOnly.preHandoffShellOverlay.nativeOverlayAvailable === true
      && report.bootChatOnly.preHandoffShellOverlay.nativeControlsSelected === true
      && report.bootChatOnly.preHandoffShellOverlay.customControlsHidden === true);
  assertOk('boot: handoff destroys boot and reveals exactly one WCO shell while the orb stays hidden',
    report.bootChatOnly.postHandoff.bootDestroyed === true
      && report.bootChatOnly.postHandoff.shellVisible === true
      && report.bootChatOnly.postHandoff.orbHidden === true
      && report.bootChatOnly.postHandoff.visibleWindowCount === 1
      && report.bootChatOnly.postHandoff.shellOverlay.nativeOverlayAvailable === true
      && report.bootChatOnly.postHandoff.shellOverlay.nativeControlsSelected === true
      && report.bootChatOnly.postHandoff.shellOverlay.customControlsHidden === true
      && JSON.stringify(report.bootChatOnly.postHandoff.visibilityAudit.map((sample) => sample.phase))
        === JSON.stringify(['before', 'boot-hidden', 'shell-shown'])
      && report.bootChatOnly.postHandoff.visibilityAudit.every(
        (sample) => !(sample.bootVisible && sample.shellVisible),
      ));
  assertOk('boot: typing and readiness-waiting evidence represent distinct authoritative states',
    report.bootChatOnly.bootTaskReachedAfterAthena === true
      && bootBar.prefixCount >= 4
      && bootBar.taskFirstShownAfterTyped === true
      && waitingFrameState.phase === 'waiting'
      && waitingFrameState.taskHidden === false
      && waitingFrameState.taskText === '검증용 합성 준비 작업'
      && waitingFrameState.taskState === 'running');
  assertOk('boot task: exact authoritative task label appears immediately after ATHENA with no surface or fake progress',
    initialTaskStatus.visible === true
      && initialTaskStatus.text === '검증용 합성 준비 작업'
      && initialTaskStatus.id === 'fixture-readiness'
      && initialTaskStatus.state === 'running'
      && initialTaskStatus.statusText === '검증용 합성 준비 작업.'
      && initialTaskStatus.plain === true);
  assertOk('boot readiness: ATHENA and caret remain visible after 1.92s while startup is running',
    report.bootChatOnly.waitingAfterVisualMinimum === true);
  assertOk('boot readiness: stale revision and foreign run cannot bypass waiting',
    report.bootChatOnly.staleReadinessIgnored === true);
  assertOk('boot readiness: raw startup snapshot is available only to the shell renderer',
    report.bootChatOnly.orbReadinessRejected === true);
  assertOk('boot readiness: degraded startup opens without retry UI and notifies shell, orb, and OS exactly once',
    report.bootChatOnly.degradedNotification.degradedReached === true
      && report.bootChatOnly.degradedNotification.shellVisibleOnce === true
      && report.bootChatOnly.degradedNotification.orbUnreadCount === 1
      && report.bootChatOnly.degradedNotification.orbPanel.badge === '시작 알림'
      && report.bootChatOnly.degradedNotification.orbPanel.body.includes('검증용 합성 준비 작업')
      && report.bootChatOnly.degradedNotification.orbPanel.source === 'ATHENA'
      && report.bootChatOnly.degradedNotification.orbArrivalOrder.first.badge === '시작 알림'
      && report.bootChatOnly.degradedNotification.orbArrivalOrder.first.body.includes('먼저 도착한 시작 알림')
      && report.bootChatOnly.degradedNotification.orbArrivalOrder.first.remaining === '1'
      && report.bootChatOnly.degradedNotification.orbArrivalOrder.second.body.includes('조건 도달')
      && report.bootChatOnly.degradedNotification.orbArrivalOrder.second.source.includes('나중에 도착한 루틴 알림')
      && report.bootChatOnly.degradedNotification.orbArrivalOrder.second.remaining === ''
      && JSON.stringify(report.bootChatOnly.degradedNotification.delivery.delivered)
        === JSON.stringify(['shell', 'orb', 'os']));
  assertOk('boot readiness: readiness delay grows total time and still finishes exactly once',
    bootBar.finishCount === 1
      && bootBar.bootTiming.readinessWaitMs >= 480
      && bootBar.bootTiming.totalMs > 2400
      && bootBar.phases.includes('waiting')
      && report.bootChatOnly.degradedNotification.degradedReached === true);
  assertOk('boot: actual shell pixels visibly expand above boot layer',
    report.bootChatOnly.expansionFrameCaptured === true && compositeReveal.pass === true);
  assertOk('boot: material override cannot paint a window surface; only centered logo, ATHENA, caret, and task-label pixels remain',
    transparentFrames.typing.pass === true
      && transparentFrames.waiting.pass === true);
  assertOk('boot: orb window stays hidden while the boot or shell window is visible',
    report.bootChatOnly.orbHiddenAtBoot === true
    && report.bootChatOnly.postHandoff.orbHidden === true);
  assertOk('boot: chat reached a mode after boot sequence', report.bootChatOnly.chatBootedAfterBoot === true);
  assertOk('boot: exactly one mode panel visible (no overlap)', report.bootChatOnly.exactlyOneModeVisible === true);
  assertOk('boot: C1 overtyped full ATHENA then expanded into Page 1 shell', report.bootChatOnly.bootBarWritesName === true);
  assertOk('boot: booted into chat(app) mode, not onboarding (verify profile isolation)', report.bootChatOnly.bootedIntoChatMode === true);

  // ---------- 검증 1b-2: 빈 이력 안내 문구(Paper 05·3KM-0) ----------
  // 부팅 직후, 아직 질의를 한 번도 안 보낸 시점의 #history는 자식이 0개다 —
  // 그 순간 :empty 의사요소로 뜨는 안내 문구를 getComputedStyle로 읽는다.
  const emptyHistory = await shellWin.webContents.executeJavaScript(`(() => {
    const h = document.getElementById('history');
    if (!h) return null;
    const before = window.getComputedStyle(h, '::before').content;
    const after = window.getComputedStyle(h, '::after').content;
    return { childCount: h.children.length, before, after };
  })()`);
  report.bootChatOnly.emptyHistory = emptyHistory;
  assertOk('emptyHistory: #history has no turns yet at boot', !!emptyHistory && emptyHistory.childCount === 0);
  assertOk('emptyHistory: "새 대화" title shown via :empty::before', !!emptyHistory && emptyHistory.before.includes('새 대화'));
  assertOk('emptyHistory: 안내 서브텍스트 노출', !!emptyHistory && emptyHistory.after.includes('종목') && emptyHistory.after.includes('캔버스에 카드로 쌓입니다'));

  // ---------- 검증 1c: fail-closed REST 영수증 실제 표시 ----------
  // 거절 요청은 캔버스가 없으므로 이 영수증이 유일한 피드백이다. 매 회 설정
  // 패널이 앱을 가린 상태를 재현한 뒤, production main→IPC→chat DOM→doubleRAF
  // paint ack를 여섯 번 반복해 모드 복구와 반복 waiter 정리를 함께 검증한다.
  // 온보딩은 최신 production 계약상 receipt가 침범하지 않는 보호 모드이므로
  // 여기서 강제로 열면 ack가 없는 것이 맞다(옛 검증은 반대 계약을 기대했다).
  const receiptPaints = [];
  for (let index = 0; index < 6; index += 1) {
    await shellWin.webContents.executeJavaScript(`
      (() => {
        document.getElementById('app').hidden = true;
        document.getElementById('onboard').hidden = true;
        document.getElementById('settings').hidden = false;
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
        const settings = document.getElementById('settings');
        const receipts = [...document.querySelectorAll('.rest-receipt')];
        const last = receipts[receipts.length - 1];
        const rect = last && last.getBoundingClientRect();
        return {
          appVisible: !!appPanel && !appPanel.hidden,
          onboardingHidden: !!onboard && onboard.hidden,
          settingsHidden: !!settings && settings.hidden,
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
    item.verifiedVisible && item.appVisible && item.onboardingHidden && item.settingsHidden
    && item.nonzero && item.receiptCount === index + 1 && item.elapsedMs < 1500
  ));
  assertOk('restReceiptPaint: six hidden-mode receipts become visible with bounded paint ack', receiptPaintPass);
  const receiptCountBeforeProtectedOnboarding = receiptPaints.length;
  await shellWin.webContents.executeJavaScript(`(() => {
    document.getElementById('app').hidden = true;
    document.getElementById('onboard').hidden = false;
  })()`);
  shellWin.webContents.send('athena:add-rest-receipt', {
    receiptId: 'verify-protected-onboarding',
    text: '보호 모드 침범 금지 검증',
  });
  await wait(100);
  const protectedOnboarding = await shellWin.webContents.executeJavaScript(`(() => ({
    onboardingVisible: !document.getElementById('onboard').hidden,
    appHidden: document.getElementById('app').hidden,
    receiptCount: document.querySelectorAll('.rest-receipt').length,
  }))()`);
  report.restReceiptPaint.protectedOnboarding = protectedOnboarding;
  assertOk('restReceiptPaint: receipt does not replace protected onboarding mode',
    protectedOnboarding.onboardingVisible === true
      && protectedOnboarding.appHidden === true
      && protectedOnboarding.receiptCount === receiptCountBeforeProtectedOnboarding);
  await shellWin.webContents.executeJavaScript(`(() => {
    document.getElementById('onboard').hidden = true;
    document.getElementById('app').hidden = false;
  })()`);
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

  // ---------- 검증 3b: 현재 Paper 50 실제 반응형/Snap 표면 ----------
  const responsiveProbe = () => shellWin.webContents.executeJavaScript(`(() => {
    const shell = document.getElementById('shell');
    const historyRegion = document.getElementById('historyRegion');
    const canvasRegion = document.getElementById('canvasRegion');
    const chatRegion = document.getElementById('chatRegion');
    const history = document.getElementById('history');
    const inputStack = document.getElementById('inputStack');
    const input = document.getElementById('input');
    const modeLabels = Array.from(document.querySelectorAll('.sidebar-mode-item-label'));
    const compactToggle = document.getElementById('sidebarCompactToggle');
    const sidebarList = document.getElementById('sidebarList');
    const rect = (node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    const conversation = rect(history);
    const responsiveTurn = document.getElementById('verifyResponsiveTurn');
    const responsiveTurnRect = responsiveTurn ? rect(responsiveTurn) : null;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      shellDisplay: getComputedStyle(shell).display,
      gridColumns: getComputedStyle(shell).gridTemplateColumns,
      history: rect(historyRegion),
      canvas: rect(canvasRegion),
      chat: rect(chatRegion),
      conversation,
      inputStack: rect(inputStack),
      input: rect(input),
      conversationDisplay: getComputedStyle(history).display,
      conversationOverflowY: getComputedStyle(history).overflowY,
      conversationChildCount: history.childElementCount,
      responsiveTurn: responsiveTurnRect,
      responsiveTurnVisible: !!responsiveTurn
        && getComputedStyle(responsiveTurn).display !== 'none'
        && responsiveTurnRect.bottom > conversation.y
        && responsiveTurnRect.y < conversation.bottom
        && responsiveTurnRect.right > conversation.x
        && responsiveTurnRect.x < conversation.right,
      conversationRole: history.getAttribute('role'),
      conversationLabel: history.getAttribute('aria-label'),
      conversationTabIndex: history.tabIndex,
      labelsHidden: modeLabels.every((node) => getComputedStyle(node).display === 'none'),
      compactToggleDisplay: getComputedStyle(compactToggle).display,
      compactExpanded: compactToggle.getAttribute('aria-expanded'),
      sidebarListDisplay: getComputedStyle(sidebarList).display,
      sameInputNode: document.querySelectorAll('#input').length === 1,
    };
  })()`);
  const responsiveSettle = () => shellWin.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
  );
  const setResponsiveWidth = async (origin, requestedViewportWidth) => {
    let requestedOuterWidth = Math.max(330, requestedViewportWidth);
    let actualOuterWidth = shellWin.getBounds().width;
    let actualInnerWidth = await shellWin.webContents.executeJavaScript('innerWidth');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      shellWin.setBounds({
        ...origin,
        width: Math.round(requestedOuterWidth),
        height: Math.max(620, origin.height),
      });
      mainMod.noteAppBounds(shellWin);
      await responsiveSettle();
      actualOuterWidth = shellWin.getBounds().width;
      actualInnerWidth = await shellWin.webContents.executeJavaScript('innerWidth');
      if (actualInnerWidth === requestedViewportWidth) break;
      requestedOuterWidth = actualOuterWidth + requestedViewportWidth - actualInnerWidth;
    }
    return { requestedViewportWidth, actualOuterWidth, actualInnerWidth };
  };
  const responsiveAttachmentProbe = async (origin, requestedViewportWidth) => {
    const viewport = await setResponsiveWidth(origin, requestedViewportWidth);
    const paths = [
      'C:\\verify-fixtures\\responsive-attachments\\a-very-long-folder-name\\quarterly-market-analysis-with-a-long-name.pdf',
      'C:\\verify-fixtures\\responsive-attachments\\another-very-long-folder-name\\portfolio-risk-notes-with-a-long-name.txt',
    ];
    const layout = await shellWin.webContents.executeJavaScript(`new Promise((resolve) => {
      document.getElementById('verifyResponsiveTurn')?.remove();
      attachments = ${JSON.stringify(paths.map((attachmentPath) => ({ path: attachmentPath, isDir: false })))};
      renderAttachChips();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const chat = document.getElementById('chatRegion');
        const stack = document.getElementById('inputStack');
        const container = document.getElementById('attachChips');
        const inputRow = stack.querySelector('.input-row');
        const input = document.getElementById('input');
        const chips = Array.from(container.querySelectorAll('.attach-chip'));
        const removeButtons = Array.from(container.querySelectorAll('.attach-chip-rm'));
        const rect = (node) => {
          const r = node.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
        };
        const withinViewport = (node) => {
          const r = node.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0
            && r.right <= innerWidth && r.bottom <= innerHeight;
        };
        const centerHit = (node) => {
          const r = node.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!hit && node.contains(hit);
        };
        input.focus();
        const chatRect = rect(chat);
        const inputRowRect = rect(inputRow);
        resolve({
          requestedViewportWidth: ${requestedViewportWidth},
          actualInnerWidth: innerWidth,
          historyChildCount: document.getElementById('history').childElementCount,
          attachmentCount: attachments.length,
          stack: rect(stack),
          chat: chatRect,
          container: rect(container),
          chips: chips.map(rect),
          removeButtons: removeButtons.map(rect),
          inputRow: inputRowRect,
          input: rect(input),
          withinViewport: {
            stack: withinViewport(stack),
            container: withinViewport(container),
            chips: chips.every(withinViewport),
            removeButtons: removeButtons.every(withinViewport),
            inputRow: withinViewport(inputRow),
            input: withinViewport(input),
          },
          centerHit: {
            stack: centerHit(stack),
            container: centerHit(container),
            chips: chips.every(centerHit),
            removeButtons: removeButtons.every(centerHit),
            inputRow: centerHit(inputRow),
            input: centerHit(input),
          },
          removeAccessibility: removeButtons.map((button) => ({
            tagName: button.tagName,
            type: button.type,
            ariaLabel: button.getAttribute('aria-label'),
            tabIndex: button.tabIndex,
            disabled: button.disabled,
          })),
          inputFocused: document.activeElement === input,
          inputRowBottomAligned: Math.abs(inputRowRect.bottom - chatRect.bottom) <= 1,
        });
      }));
    })`);
    let captureName = null;
    if (requestedViewportWidth === 500) {
      captureName = '03d-responsive-500-attachments.png';
      await shot(shellWin, captureName);
    }
    const removal = await shellWin.webContents.executeJavaScript(`new Promise((resolve) => {
      document.querySelector('#attachChips .attach-chip-rm')?.click();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const afterFirstRemove = attachments.length;
        attachments = [];
        renderAttachChips();
        resolve({
          afterFirstRemove,
          afterReset: attachments.length,
          containerHiddenAfterReset: document.getElementById('attachChips').hidden,
        });
      }));
    })`);
    return { ...layout, ...viewport, captureName, removal };
  };
  const resetResponsivePopoverCase = (populated) => shellWin.webContents.executeJavaScript(`new Promise((resolve) => {
    closeKiumiMenu();
    closeModelPopover();
    document.getElementById('verifyResponsiveTurn')?.remove();
    if (${populated}) {
      const history = document.getElementById('history');
      const turn = document.createElement('article');
      turn.id = 'verifyResponsiveTurn';
      turn.className = 'turn';
      const question = document.createElement('div');
      question.className = 'turn-q';
      question.textContent = '반폭 팝오버 검증 질문';
      const answer = document.createElement('div');
      answer.className = 'turn-a';
      answer.textContent = '반폭 팝오버 검증 답변';
      turn.append(question, answer);
      history.appendChild(turn);
      history.scrollTop = history.scrollHeight;
    }
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  })`);
  const responsivePopoverProbe = async (origin, requestedViewportWidth, populated, id) => {
    const viewport = await setResponsiveWidth(origin, requestedViewportWidth);
    await resetResponsivePopoverCase(populated);
    if (id === 'kiumiMenu') {
      await shellWin.webContents.executeJavaScript(`document.getElementById('dot').click()`);
    } else {
      await shellWin.webContents.executeJavaScript(`(() => {
        document.getElementById('dot').click();
        Array.from(document.querySelectorAll('#kiumiMenu .km-item'))
          .find((node) => node.querySelector('.km-title')?.textContent === '모델 설정')?.click();
      })()`);
      await waitUntil(
        () => shellWin.webContents.executeJavaScript(`document.getElementById('modelPopover').hidden === false`),
        { timeoutMs: 1500, intervalMs: 25 },
      );
    }
    await responsiveSettle();
    const probe = await shellWin.webContents.executeJavaScript(`(() => {
      const menu = document.getElementById(${JSON.stringify(id)});
      const menuRect = menu.getBoundingClientRect();
      const rect = (node) => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      };
      const withinViewport = (node) => {
        const r = node.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0
          && r.right <= innerWidth && r.bottom <= innerHeight;
      };
      const hitInside = (node, x, y) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && node.contains(hit);
      };
      const corners = {
        topLeft: hitInside(menu, menuRect.left + 12, menuRect.top + 12),
        topRight: hitInside(menu, menuRect.right - 12, menuRect.top + 12),
        bottomLeft: hitInside(menu, menuRect.left + 12, menuRect.bottom - 12),
        bottomRight: hitInside(menu, menuRect.right - 12, menuRect.bottom - 12),
      };
      const buttons = Array.from(menu.querySelectorAll('button')).filter((button) => {
        const r = button.getBoundingClientRect();
        return getComputedStyle(button).display !== 'none' && getComputedStyle(button).visibility !== 'hidden'
          && r.width > 0 && r.height > 0;
      });
      const buttonResults = buttons.map((button) => {
        const buttonRect = button.getBoundingClientRect();
        return {
          label: button.querySelector('.km-title')?.textContent.trim() || button.textContent.trim(),
          rect: rect(button),
          withinViewport: withinViewport(button),
          centerHit: hitInside(button, buttonRect.left + buttonRect.width / 2, buttonRect.top + buttonRect.height / 2),
        };
      });
      const requiredLabelCounts = ${JSON.stringify({
        kiumiMenu: { '파일 첨부': 1, '폴더 첨부': 1, '모델 설정': 1 },
        modelPopover: {
          기본: 2,
          fable: 1,
          opus: 1,
          sonnet: 1,
          haiku: 1,
          low: 1,
          medium: 1,
          high: 1,
          xhigh: 1,
          max: 1,
        },
      })}[${JSON.stringify(id)}];
      const requiredItems = Object.entries(requiredLabelCounts).map(([label, expectedCount]) => {
        const matches = buttonResults.filter((button) => button.label === label);
        return {
          label,
          expectedCount,
          actualCount: matches.length,
          withinViewport: matches.length === expectedCount && matches.every((button) => button.withinViewport),
          centerHit: matches.length === expectedCount && matches.every((button) => button.centerHit),
        };
      });
      return {
        requestedViewportWidth: ${requestedViewportWidth},
        actualInnerWidth: innerWidth,
        populated: ${populated},
        id: ${JSON.stringify(id)},
        historyChildCount: document.getElementById('history').childElementCount,
        visible: !menu.hidden && getComputedStyle(menu).display !== 'none' && menuRect.width > 0 && menuRect.height > 0,
        menu: rect(menu),
        menuWithinViewport: withinViewport(menu),
        corners,
        buttons: buttonResults,
        requiredItems,
      };
    })()`);
    await shellWin.webContents.executeJavaScript(`closeKiumiMenu(); closeModelPopover()`);
    await responsiveSettle();
    return { ...probe, ...viewport };
  };
  const responsiveOrigin = shellWin.getBounds();
  const attachmentMatrix = [];
  const popoverMatrix = [];
  let responsiveMatrixError = null;
  try {
    for (const requestedViewportWidth of [330, 500, 699, 700, 900, 1279]) {
      attachmentMatrix.push(await responsiveAttachmentProbe(responsiveOrigin, requestedViewportWidth));
    }
    for (const requestedViewportWidth of [330, 699, 700, 1279]) {
      for (const populated of [false, true]) {
        for (const id of ['kiumiMenu', 'modelPopover']) {
          popoverMatrix.push(await responsivePopoverProbe(responsiveOrigin, requestedViewportWidth, populated, id));
        }
      }
    }
    await setResponsiveWidth(responsiveOrigin, 900);
    await resetResponsivePopoverCase(false);
    const historyEmptyBeforeSeed = await shellWin.webContents.executeJavaScript(`document.getElementById('history').childElementCount === 0`);
    await shellWin.webContents.executeJavaScript(`(() => {
      const history = document.getElementById('history');
      const turn = document.createElement('article');
      turn.id = 'verifyResponsiveTurn';
      turn.className = 'turn';
      turn.innerHTML = '<div class="turn-q">삼성전자 흐름을 짧게 알려줘</div><div class="turn-a">최근 질문에 대한 답변이 반폭에서도 입력창 위에 이어집니다.</div>';
      history.appendChild(turn);
      history.scrollTop = history.scrollHeight;
    })()`);
    await wait(120);
    const twoPane = await responsiveProbe();
    await shot(shellWin, '03d-responsive-900-chat-tray.png');

    await setResponsiveWidth(responsiveOrigin, 500);
    const compact = await responsiveProbe();
    await shellWin.webContents.executeJavaScript(`document.getElementById('sidebarCompactToggle').click()`);
    await wait(120);
    const compactOverlay = await responsiveProbe();
    await shot(shellWin, '03e-responsive-500-rail-overlay.png');
    await shellWin.webContents.executeJavaScript(`document.getElementById('sidebarCompactToggle').click()`);

    report.responsiveShell = {
      twoPane,
      compact,
      compactOverlay,
      attachments: attachmentMatrix,
      popovers: { historyEmptyBeforeSeed, matrix: popoverMatrix },
    };
    console.log('[verify] 검증3b(현재 Paper 50 반응형/Snap):', JSON.stringify(report.responsiveShell));
    assertOk('responsiveShell: 900px keeps the authoritative conversation above the composer',
      twoPane.shellDisplay === 'grid'
      && near(twoPane.history.width, 268, 2)
      && twoPane.chat.height >= 196
      && twoPane.chat.height <= 248
      && twoPane.chat.y >= twoPane.canvas.bottom - 1
      && twoPane.canvas.height > 0
      && twoPane.conversationDisplay === 'flex'
      && twoPane.conversationOverflowY === 'auto'
      && twoPane.conversation.height > 80
      && twoPane.responsiveTurnVisible === true
      && near(twoPane.inputStack.y, twoPane.conversation.bottom, 2)
      && twoPane.inputStack.bottom <= twoPane.chat.bottom + 1
      && twoPane.input.width > 0
      && twoPane.conversationRole === 'log'
      && twoPane.conversationLabel === '현재 대화'
      && twoPane.conversationTabIndex === 0);
    assertOk('responsiveShell: 500px uses 44px rail and keeps the same mounted input',
      compact.shellDisplay === 'grid'
      && near(compact.history.width, 44, 2)
      && compact.labelsHidden === true
      && compact.sameInputNode === true
      && compact.responsiveTurnVisible === true
      && compact.conversationDisplay === 'flex'
      && compact.conversation.height > 80
      && compact.canvas.height > 0
      && near(compact.inputStack.y, compact.conversation.bottom, 2)
      && compact.inputStack.bottom <= compact.chat.bottom + 1
      && compact.input.width > 0);
    assertOk('responsiveShell: empty-history attachment chips stay reachable at responsive boundaries',
      attachmentMatrix.length === 6
      && attachmentMatrix.every((item) => item.actualInnerWidth === item.requestedViewportWidth
        && item.historyChildCount === 0
        && item.attachmentCount === 2
        && item.stack.height > 54
        && item.chips.length === 2
        && item.removeButtons.length === 2
        && Object.values(item.withinViewport).every(Boolean)
        && Object.values(item.centerHit).every(Boolean)
        && item.removeAccessibility.every((button) => button.tagName === 'BUTTON'
          && button.type === 'button'
          && button.ariaLabel === '첨부 제거'
          && button.tabIndex >= 0
          && button.disabled === false)
        && item.inputFocused === true
        && item.inputRowBottomAligned === true
        && item.removal.afterFirstRemove === 1
        && item.removal.afterReset === 0
        && item.removal.containerHiddenAfterReset === true)
      && attachmentMatrix.some((item) => item.captureName === '03d-responsive-500-attachments.png'));
    assertOk('responsiveShell: composer popovers pass viewport and hit tests at 330/699/700/1279 boundaries',
      historyEmptyBeforeSeed === true
      && popoverMatrix.length === 16
      && popoverMatrix.every((item) => item.actualInnerWidth === item.requestedViewportWidth
        && item.visible === true
        && item.menuWithinViewport === true
        && item.historyChildCount === (item.populated ? 1 : 0)
        && Object.values(item.corners).every(Boolean)
        && item.buttons.length > 0
        && item.buttons.every((button) => button.withinViewport === true && button.centerHit === true)
        && item.requiredItems.every((required) => required.actualCount === required.expectedCount
          && required.withinViewport === true
          && required.centerHit === true)));
    assertOk('responsiveShell: compact project/recent overlay is reachable from the rail',
      compact.compactToggleDisplay === 'flex'
      && compactOverlay.compactExpanded === 'true'
      && compactOverlay.sidebarListDisplay === 'flex');
  } catch (err) {
    responsiveMatrixError = err;
    throw err;
  } finally {
    const cleanupErrors = [];
    try {
      await shellWin.webContents.executeJavaScript(`(() => {
        attachments = [];
        renderAttachChips();
        closeKiumiMenu();
        closeModelPopover();
        document.getElementById('verifyResponsiveTurn')?.remove();
        const compactToggle = document.getElementById('sidebarCompactToggle');
        if (compactToggle?.getAttribute('aria-expanded') === 'true') compactToggle.click();
      })()`);
    } catch (err) {
      cleanupErrors.push(err);
    }
    try {
      shellWin.setBounds(responsiveOrigin);
      mainMod.noteAppBounds(shellWin);
      await responsiveSettle();
    } catch (err) {
      cleanupErrors.push(err);
    }
    if (cleanupErrors.length) {
      if (responsiveMatrixError) {
        dlog(`responsive cleanup after error: ${cleanupErrors.map((err) => err && err.stack || err).join(' | ')}`);
      } else {
        throw cleanupErrors[0];
      }
    }
  }

  // ---------- 검증 3c: Paper 25/26/47/48 플러그인 네 번째 모드 ----------
  await shellWin.webContents.executeJavaScript(`document.getElementById('modeNavPlugin').click()`);
  await wait(180);
  const pluginHub = await shellWin.webContents.executeJavaScript(`(() => ({
    pluginVisible: !document.getElementById('pluginCanvas').hidden,
    summaryHidden: document.getElementById('mosaic').hidden,
    graphHidden: document.getElementById('graphCanvas').hidden,
    agentHidden: document.getElementById('agentCanvas').hidden,
    chatVisible: !document.getElementById('chatRegion').hidden,
    activeMode: document.querySelector('.sidebar-mode-item.is-active')?.dataset.view || null,
    installed: document.querySelectorAll('.plugin-canvas-card[data-plugin-kind="installed"]').length,
    recommended: document.querySelectorAll('.plugin-canvas-card[data-plugin-kind="recommended"]').length,
  }))()`);
  await shot(shellWin, '03f-plugin-hub-paper-47.png');
  await shellWin.webContents.executeJavaScript(`document.querySelector('.plugin-canvas-recommended .plugin-canvas-action').click()`);
  await wait(80);
  const pluginInstallModal = await shellWin.webContents.executeJavaScript(`(() => {
    const dialog = document.querySelector('.plugin-canvas-install-sheet');
    const panel = document.querySelector('.plugin-canvas-panel');
    const controls = Array.from(dialog?.querySelectorAll('button:not([disabled])') || []);
    const focusedInitially = dialog?.contains(document.activeElement) || false;
    const initialClass = document.activeElement?.className || '';
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    const wrappedBackward = document.activeElement === controls[controls.length - 1];
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    const wrappedForward = document.activeElement === controls[0];
    return {
      dialogCount: document.querySelectorAll('.plugin-canvas-sheet[role="dialog"]').length,
      title: dialog?.querySelector('.plugin-canvas-sheet-title')?.textContent || '',
      confirmLabel: dialog?.querySelector('.is-sheet-confirm')?.textContent || '',
      panelInert: panel?.hasAttribute('inert') || false,
      focusedInitially,
      initialClass,
      wrappedBackward,
      wrappedForward,
    };
  })()`);
  await shellWin.webContents.executeJavaScript(`document.querySelector('.plugin-canvas-install-sheet')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  await wait(80);
  pluginInstallModal.closed = await shellWin.webContents.executeJavaScript(`!document.querySelector('.plugin-canvas-install-sheet')`);
  pluginInstallModal.focusRestored = await shellWin.webContents.executeJavaScript(`document.activeElement?.closest('.plugin-canvas-card')?.getAttribute('data-plugin-id') === 'pdf-report'`);
  await shellWin.webContents.executeJavaScript(`document.querySelector('.plugin-canvas-action.is-manage').click()`);
  await wait(120);
  const pluginManage = await shellWin.webContents.executeJavaScript(`(() => ({
    title: document.querySelector('.plugin-canvas-title')?.textContent || '',
    counts: Array.from(document.querySelectorAll('.plugin-canvas-count')).map((node) => node.textContent),
    toggles: Array.from(document.querySelectorAll('.plugin-canvas-toggle')).map((node) => node.getAttribute('aria-checked')),
  }))()`);
  await shot(shellWin, '03g-plugin-manage-paper-48.png');
  await shellWin.webContents.executeJavaScript(`
    window.AthenaPluginCanvas.setView('hub');
    document.querySelector('.plugin-canvas-card[data-plugin-id="dart"] .plugin-canvas-action').click();
  `);
  await wait(120);
  const pluginPermission = await shellWin.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector('.plugin-canvas-permissions-view');
    return {
      dialogCount: document.querySelectorAll('.plugin-canvas-sheet[role="dialog"]').length,
      overlayCount: document.querySelectorAll('.plugin-canvas-sheet-overlay').length,
      title: panel?.querySelector('.plugin-canvas-title')?.textContent || '',
      counts: Array.from(panel?.querySelectorAll('.plugin-canvas-count') || []).map((node) => node.textContent),
      allowed: panel?.querySelector('.plugin-canvas-sheet-count')?.textContent || '',
      features: panel?.querySelectorAll('.plugin-canvas-sheet-feature').length || 0,
      inert: panel?.hasAttribute('inert') || false,
    };
  })()`);
  await shot(shellWin, '03h-plugin-permission-paper-26.png');
  await shellWin.webContents.executeJavaScript(`document.querySelector('.plugin-canvas-action.is-sheet-cancel')?.click(); document.getElementById('modeNavSummary').click()`);
  await wait(100);
  report.pluginMode = { hub: pluginHub, install: pluginInstallModal, manage: pluginManage, permission: pluginPermission };
  console.log('[verify] 검증3c(Paper 플러그인 25/26/47/48):', JSON.stringify(report.pluginMode));
  assertOk('pluginMode: fourth mode is exclusive while chat persists',
    pluginHub.pluginVisible === true
    && pluginHub.summaryHidden === true
    && pluginHub.graphHidden === true
    && pluginHub.agentHidden === true
    && pluginHub.chatVisible === true
    && pluginHub.activeMode === 'plugin');
  assertOk('pluginMode: Paper 47 hub renders installed 2 and recommended 6', pluginHub.installed === 2 && pluginHub.recommended === 6);
  assertOk('pluginMode: install preview owns focus, traps Tab, closes with Escape, and restores focus',
    pluginInstallModal.dialogCount === 1
    && /설치 미리보기/.test(pluginInstallModal.title)
    && pluginInstallModal.confirmLabel === '세션 반영'
    && pluginInstallModal.panelInert === true
    && pluginInstallModal.focusedInitially === true
    && pluginInstallModal.wrappedBackward === true
    && pluginInstallModal.wrappedForward === true
    && pluginInstallModal.closed === true
    && pluginInstallModal.focusRestored === true);
  assertOk('pluginMode: Paper 48 management counts and switches match',
    JSON.stringify(pluginManage.counts) === JSON.stringify(['플러그인 2', '기능 8', '마켓플레이스 1'])
    && JSON.stringify(pluginManage.toggles) === JSON.stringify(['true', 'false', 'true']));
  assertOk('pluginMode: Paper 26 DART permission is a non-blocking 3/4 detail view',
    pluginPermission.dialogCount === 0
    && pluginPermission.overlayCount === 0
    && pluginPermission.title === 'DART 전자공시'
    && pluginPermission.counts.includes('UI 초안')
    && pluginPermission.features === 4
    && /3\s*\/\s*4/.test(pluginPermission.allowed)
    && pluginPermission.inert === false);

  // ---------- 검증 3d: Paper 49 Kiumi 메뉴 + Paper 54 프로젝트 상호작용 ----------
  await shellWin.webContents.executeJavaScript(`document.getElementById('dot').click()`);
  await wait(100);
  const kiumiMenu = await shellWin.webContents.executeJavaScript(`(() => {
    const menu = document.getElementById('kiumiMenu');
    const rect = menu.getBoundingClientRect();
    const style = getComputedStyle(menu);
    const items = Array.from(menu.querySelectorAll('.km-item'));
    return {
      visible: !menu.hidden,
      width: rect.width,
      itemCount: items.length,
      sections: Array.from(menu.querySelectorAll('.km-section')).map((node) => node.textContent),
      allIconsAreSvg: items.every((item) => item.querySelector('.km-ic > svg')),
      rowHeights: items.map((item) => item.getBoundingClientRect().height),
      backdropFilter: style.backdropFilter || style.webkitBackdropFilter || '',
    };
  })()`);
  await shot(shellWin, '03i-kiumi-menu-paper-49.png');
  await shellWin.webContents.executeJavaScript(`document.getElementById('dot').click()`);

  const projectHover = await shellWin.webContents.executeJavaScript(`(() => {
    const main = document.querySelector('.sidebar-project-main');
    main.focus();
    const description = main.querySelector('.sidebar-project-description');
    const add = document.querySelector('.sidebar-project-new-chat');
    const menu = document.querySelector('.sidebar-project-menu-trigger');
    const current = document.querySelector('.sidebar-project.is-current');
    const size = (node) => { const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height }; };
    return {
      currentProject: current?.querySelector('.sidebar-project-name')?.textContent || '',
      descriptionVisible: !!description && !description.hidden,
      description: description?.textContent || '',
      addSize: size(add),
      menuSize: size(menu),
    };
  })()`);
  await wait(80);
  await shot(shellWin, '03j-project-hover-paper-54.png');
  const projectMenuImmediate = await shellWin.webContents.executeJavaScript(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const trigger = document.querySelector('.sidebar-project-menu-trigger');
    trigger.click();
    const menu = document.querySelector('.sidebar-project-menu');
    return { expanded: trigger.getAttribute('aria-expanded'), visible: !menu.hidden };
  })()`);
  await wait(5300);
  const projectMenu = await shellWin.webContents.executeJavaScript(`(() => {
    const trigger = document.querySelector('.sidebar-project-menu-trigger');
    const menu = document.querySelector('.sidebar-project-menu');
    const actions = menu.closest('.sidebar-project-actions');
    const rect = menu.getBoundingClientRect();
    return {
      expanded: trigger.getAttribute('aria-expanded'),
      visible: !menu.hidden,
      role: menu.getAttribute('role'),
      firstAction: menu.querySelector('[role="menuitem"]')?.textContent || '',
      actionsOpacity: Number(getComputedStyle(actions).opacity),
      display: getComputedStyle(menu).display,
      rect: { width: rect.width, height: rect.height },
      focusedRole: document.activeElement?.getAttribute('role') || '',
      itemLabels: Array.from(menu.querySelectorAll('[role="menuitem"]')).map((node) => node.textContent),
    };
  })()`);
  await shot(shellWin, '03k-project-menu-paper-54.png');
  await shellWin.webContents.executeJavaScript(`document.querySelector('.sidebar-project-menu-trigger').click(); document.getElementById('input').focus()`);
  report.kiumiAndProjects = { kiumiMenu, projectHover, projectMenuImmediate, projectMenu };
  console.log('[verify] 검증3d(Paper 49 Kiumi / Paper 54 프로젝트):', JSON.stringify(report.kiumiAndProjects));
  assertOk('kiumiMenu: Paper 49 uses a 380px Liquid Glass menu with neutral SVG actions',
    kiumiMenu.visible === true
    && near(kiumiMenu.width, 380, 2)
    && kiumiMenu.itemCount === 8
    && JSON.stringify(kiumiMenu.sections) === JSON.stringify(['추가', '플러그인 UI 초안', '설정'])
    && kiumiMenu.allIconsAreSvg === true
    && kiumiMenu.rowHeights.every((height) => height >= 36)
    && /blur\(3px\)/.test(kiumiMenu.backdropFilter));
  assertOk('projects: Paper 54 exposes current-project description and 32px actions',
    projectHover.currentProject.length > 0
    && projectHover.descriptionVisible === true
    && projectHover.description.length > 0
    && near(projectHover.addSize.width, 32, 1)
    && near(projectHover.addSize.height, 32, 1)
    && near(projectHover.menuSize.width, 32, 1)
    && near(projectHover.menuSize.height, 32, 1));
  assertOk('projects: Paper 54 overflow menu is keyboard-shaped and reachable',
    projectMenuImmediate.expanded === 'true'
    && projectMenuImmediate.visible === true
    && projectMenu.expanded === 'true'
    && projectMenu.visible === true
    && projectMenu.role === 'menu'
    && projectMenu.firstAction === '고정'
    && projectMenu.actionsOpacity === 1
    && projectMenu.display !== 'none'
    && projectMenu.rect.width > 0
    && projectMenu.rect.height > 0
    && projectMenu.focusedRole === 'menuitem'
    && JSON.stringify(projectMenu.itemLabels) === JSON.stringify([
      '고정', '편집', '탐색기에서 열기', '영구 작업 트리 생성', '대화 보관', '프로젝트 제거',
    ]));

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
  // 채팅이 고정 폭 영역이
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

  await openSettingsViaCommandBar(shellWin);
  await wait(900);

  const winCountAfterOpen = BrowserWindow.getAllWindows().length;

  // 두 번 열어도(재오픈이 no-op) nav·카드가 중복되지 않아야 한다
  await openSettingsViaCommandBar(shellWin);
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
    // 설정은 셸 창 전체를 덮는 오버레이라 창 크기를 건드리지
    // 않는다. **창 크기 불변**을 단언한다: 모드 전환이 창을 흔들면 회귀다.
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
  // 리프 1.2.2: 점이 대화 상태 표시 전용이라 설정을 열지 않으므로 커맨드바로
  // 같은 "설정 열고 닫기" 자극을 만든다 — 이 검증이 재는 것은
  // 앵커 유지이지 설정 진입 경로 자체가 아니다.
  const beforeMove = shellWin.getBounds();
  shellWin.setBounds({ x: beforeMove.x + 120, y: beforeMove.y - 40, width: beforeMove.width, height: beforeMove.height });
  mainMod.noteAppBounds(shellWin); // 앱 주도 표시 — OS 스냅 오인 정착 방지(검증3 주석)
  await wait(150);
  const moved = shellWin.getBounds();
  await openSettingsViaCommandBar(shellWin);
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
  shellWin.setMinimumSize(330, 480); // 하한 복구 — main.js DESIGN.minW/minH와 같은 값
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
  // 따라올 상대가 없어졌으므로, 같은 자극으로 그
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
    return { strip: reg('#dragStrip'),
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
    // 행 수는 레지스트리에서 읽어
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
  // 캔들 수는 HISTORY_TRIGGER_BARS=12(chart-card.js:505) 이상이어야 한다(WP-J) —
  // 그보다 적으면 마운트 즉시 isNearLeftEdge()가 참이 되어 chart-reload.js의
  // "권위가 없는 패널이다" 방어 예외가 매 verify마다 콘솔에 쏟아진다. 하네스
  // 픽스처가 원인이라 하네스만 늘린다(차트 카드 기능 코드는 무변경).
  const liveChartCandles = [
    { time: '2026-07-29', open: 69800, high: 70200, low: 69500, close: 70000, volume: 8123456 },
    { time: '2026-07-30', open: 70000, high: 70500, low: 69800, close: 70300, volume: 7998877 },
    { time: '2026-07-31', open: 70300, high: 70600, low: 69900, close: 70100, volume: 9012345 },
    { time: '2026-08-03', open: 70100, high: 70700, low: 70000, close: 70500, volume: 8456789 },
    { time: '2026-08-04', open: 70500, high: 70900, low: 70200, close: 70400, volume: 7789900 },
    { time: '2026-08-05', open: 70400, high: 70800, low: 70100, close: 70600, volume: 8234567 },
    { time: '2026-08-06', open: 70600, high: 71100, low: 70400, close: 70900, volume: 9345678 },
    { time: '2026-08-07', open: 70900, high: 71300, low: 70600, close: 71100, volume: 8567890 },
    { time: '2026-08-10', open: 71100, high: 71400, low: 70800, close: 70900, volume: 7654321 },
    { time: '2026-08-11', open: 70900, high: 71200, low: 70500, close: 70700, volume: 8090909 },
    { time: '2026-08-12', open: 70700, high: 71100, low: 70400, close: 70800, volume: 8345612 },
    { time: '2026-08-13', open: 70800, high: 71200, low: 70600, close: 71000, volume: 8765432 },
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
  await waitUntil(
    () => shellWin.isMaximized() === true && shellWin.getBounds().height > heightBeforeMax,
    { timeoutMs: 2000 }
  );
  const afterMaximize = { bounds: shellWin.getBounds(), isMaximized: shellWin.isMaximized() };

  await shellWin.webContents.executeJavaScript(
    "window.athena.send('athena:toggle-maximize', { force: 'restore-or-minimize' })"
  );
  await waitUntil(() => shellWin.isMaximized() === false, { timeoutMs: 2000 });
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
  const modelPrefsPath = path.join(VERIFY_PROFILE.directory, 'athena-model.json');
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
  // **창 표면이 `.app`에서 `#shell`로 옮겨갔다.** `.app`은 이제 셸 위의 투명한 레이아웃
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
  report.orderTicket.allWindowCount = BrowserWindow.getAllWindows().length;
  report.orderTicket.visibleWindowCount = BrowserWindow.getAllWindows().filter((win) => win.isVisible()).length;
  report.orderTicket.handoffAllWindowCountBaseline = report.bootChatOnly.postHandoff.allWindowCountBaseline;
  console.log('[verify] 검증17(주문 티켓):', JSON.stringify(report.orderTicket));
  assertOk('orderTicket: 모드 전이(#order 표시·#app 후퇴)',
    report.orderTicket.orderVisible === true && report.orderTicket.appHidden === true);
  // 주문 확인도 새 창이 아니라 모드다. handoff 직후 살아 있던 전체 BrowserWindow
  // 수를 baseline으로 삼는다 — 가시 창 수와 전체 창 수를 섞으면 hidden orb 때문에
  // 실제로 새 창이 없어도 실패한다.
  assertOk('orderTicket: handoff 이후 전체 BrowserWindow 수가 그대로다(새 창 없음)',
    report.orderTicket.allWindowCount === report.orderTicket.handoffAllWindowCountBaseline);
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
      // liveChartCandles(검증13b)와 같은 이유로 HISTORY_TRIGGER_BARS=12 이상(WP-J).
      chart: { period: 'day', target: 'stock', trId: 'ka10081', candles: [
        { time: '2026-08-05', open: 90, high: 98, low: 88, close: 95, volume: 700 },
        { time: '2026-08-06', open: 95, high: 102, low: 93, close: 100, volume: 800 },
        { time: '2026-08-07', open: 100, high: 104, low: 96, close: 98, volume: 750 },
        { time: '2026-08-10', open: 98, high: 103, low: 95, close: 101, volume: 820 },
        { time: '2026-08-11', open: 101, high: 106, low: 99, close: 104, volume: 900 },
        { time: '2026-08-12', open: 104, high: 108, low: 100, close: 102, volume: 860 },
        { time: '2026-08-13', open: 102, high: 107, low: 100, close: 106, volume: 940 },
        { time: '2026-08-14', open: 106, high: 111, low: 104, close: 108, volume: 1010 },
        { time: '2026-08-17', open: 108, high: 112, low: 105, close: 107, volume: 880 },
        { time: '2026-08-18', open: 107, high: 110, low: 103, close: 105, volume: 950 },
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
  const orbWasVisibleBeforeVisualVerification = orbWin.isVisible();
  report.orbVisualVisibility = {
    originalVisible: orbWasVisibleBeforeVisualVerification,
    shownInactiveForVerification: false,
    visibleAfterPaintSettle: false,
    restoredOriginalVisibility: false,
  };
  let orbVisualPrimaryError = null;
  try {
    if (!orbWasVisibleBeforeVisualVerification) {
      orbWin.showInactive();
      report.orbVisualVisibility.shownInactiveForVerification = true;
    }
    const orbBecameVisible = await waitUntil(() => orbWin.isVisible(), { timeoutMs: 1500, intervalMs: 25 });
    if (!orbBecameVisible) throw new Error('검증22 오브가 시각 검증 전에 표시되지 않았다');
    const orbPaintSettled = await orbWin.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))'
    );
    report.orbVisualVisibility.visibleAfterPaintSettle = orbWin.isVisible() && orbPaintSettled === true;
    if (!report.orbVisualVisibility.visibleAfterPaintSettle) {
      throw new Error('검증22 오브가 표시·paint settle 상태에 도달하지 않았다');
    }

  const orbCollapsedBefore = orbWin.getBounds();

  // 22-A — **알림 0건: 오브에 색이 없다.** 리프 1.3.2의 핵심 계약이다.
  // 먼저 상태가 정말 'none'인지 확인한다 — 앞선 검증이 오브에 이벤트를 흘렸다면
  // 이 측정은 무의미해진다(가정을 재지 않고 확인한다).
  const orbAlertBeforeEvent = await orbWin.webContents.executeJavaScript(
    "document.getElementById('orbRoot').dataset.alert"
  );
  // 눈 기하 측정은 face=idle 전제 — 장외 시각엔 부팅 얼굴이 drowsy(눈이 반쯤
  // 감겨 세로/가로 비가 낮다)라 firedEyesAreRounder가 실행 시각에 따라 흔들렸다
  // (2026-08-27 실측: 같은 트리 2회 실행에서 통과/실패 갈림). probe-orb-drag-lift
  // 03a·probe-orb-drowsy와 같은 기법 — isMarketOpen을 열림으로 바꿔치고 15초
  // 주기 재판정 틱을 기다린다. listen:false는 셸 커맨드바 자동 포커스 잔재 제거.
  await orbWin.webContents.executeJavaScript(
    "(() => { window.AthenaLib.MarketHours.isMarketOpen = () => true; return true; })()"
  );
  orbWin.webContents.send('athena:orb-signal', { signal: 'listen', active: false });
  for (let i = 0; i < 40; i += 1) {
    const f = await orbWin.webContents.executeJavaScript("document.getElementById('orbRoot').dataset.face");
    if (f === 'idle') break;
    await wait(500);
  }
  await shot(orbWin, '22-orb-collapsed.png');
  const pixelsQuiet = await measurePixels(orbWin);
  // 눈 기하 — 대기(quiet) 상태의 눈 모양. board-31/32 규범 개정 이후 발화 신호는
  // 바이저 폭이 아니라 **눈 모양**이 진다(위 orbWindow.firedEyesAreRounder 주석과
  // 짝). getBoundingClientRect는 실측 px라 %보다 화면 배율에 안 흔들린다.
  const orbQuietEyeProbe = await orbWin.webContents.executeJavaScript(`(() => {
    const eye = document.querySelector('#orbVisor .orb-eye');
    if (!eye) return null;
    const r = eye.getBoundingClientRect();
    return { width: r.width, height: r.height };
  })()`);

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

  // 발화 눈 모양이 안정될 때까지 기다린다 — 조건 충족(발화 종횡비) 후 짧은
  // 간격을 두고 한 번 더 재확인해 같은 값이면 안정화로 간주한다(전이 애니메이션
  // 중간값을 잡지 않기 위함). firedEyesAreRounder 판정과 같은 종횡비 임계(1.3)를 쓴다.
  const looksFired = (p) => !!(p && p.eyeWidth && (p.eyeHeight / p.eyeWidth) < 1.3);
  await waitUntil(async () => {
    const probe = await probeOrbCollapsed(orbWin);
    if (!looksFired(probe)) return false;
    await wait(60);
    const probe2 = await probeOrbCollapsed(orbWin);
    return looksFired(probe2) && probe2.eyeWidth === probe.eyeWidth && probe2.eyeHeight === probe.eyeHeight;
  }, { timeoutMs: 900, intervalMs: 60 });

  // 22-B — **알림이 오면 딥블루 바이저가 드러난다.** 같은 창, 같은 크기, 상태만 다르다.
  await shot(orbWin, '22b-orb-alerted.png');
  const pixelsAlerted = await measurePixels(orbWin);

  const orbCollapsedProbe = await probeOrbCollapsed(orbWin);

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
      // 2026-08-26 board-33/34 규범 개정 — "입력창 0개"가 "#orbInput 하나까지,
      // 셸이 보이는 동안은 잠겨 있다"로 좁아졌다(check-orb.mjs 상단 주석과 짝).
      // id 화이트리스트 + 지금 이 검증 시점(셸이 보이는 상태, closeToBackground
      // 이후 restoreFromBackground로 이미 복귀됨)에 실제로 안 살아있는지를 같이 잰다.
      inputIds: [...document.querySelectorAll('input, textarea, [contenteditable]')].map((n) => n.id).sort(),
      chatInputStackHidden: (() => {
        const el = document.getElementById('orbInputStack');
        return el ? el.hidden : true;
      })(),
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
    // 2026-08-26 board-32: OS app-region:drag를 걷어내고 포인터 기반 드래그로
    // 바꿨다(orb.js pointerdown/move/up + athena:orb-drag-move) — app-region:drag가
    // 켜져 있으면 이동량이 렌더러에 안 들어와 board-32가 요구하는 "관성" 시선을
    // 못 그린다(orb.css #orb 규칙 위 주석과 짝). 그래서 이제 #orb·코어 모두
    // no-drag가 계약이다.
    dragHandleContract: orbCollapsedProbe.orbRegion !== 'drag' && orbCollapsedProbe.coreRegion === 'no-drag',
    // ---------- 리프 1.3.2: 키우미 참조 상태 계약 ----------
    alertBeforeEvent: orbAlertBeforeEvent,
    pixelsQuiet,
    pixelsAlerted,
    // 앞선 검증이 오브에 이벤트를 흘리지 않았다 — 22-A 측정의 전제다.
    quietStateWasClean: orbAlertBeforeEvent === 'none',
    // 2026-08-26 board-32 규범 개정(사용자 결정) — "대기 34% / 발화 75%"로 상태별
    // 바이저 폭을 벌리던 축을 걷어냈다. Paper board 32 section C가 잠듦 하나만
    // 빼고 모든 상태의 바이저를 같은 62×61 프레임으로 못박았기 때문이다: 발화
    // 신호는 이제 바이저 폭이 아니라 **눈이 동그래지는 것**이 진다("화면당 신호는
    // 여기 하나" — board-32). 대기 자체도 90%로 올라 파란 프레임이 거의 다
    // 드러난다(사용자 1순위 지적 "파란 부분이 너무 작다" 대응, orb.css 참조).
    //
    // 그래서 아래 픽셀 비율 기반 검사 둘(옛 firedIsVisiblyWider·
    // stateActuallyChangedPixels)은 새 규범에서 성립하지 않아 폐기했다 — 대기·
    // 발화가 같은 --orb-open(90%)을 쓰므로 파란 면적이 같아야 정상이다.
    // quietFaceIsPresent(대기에도 얼굴이 있다)는 여전히 유효하다.
    quietFaceIsPresent: pixelsQuiet.bluishPixels > 0,
    //
    // 2026-08-26 리뷰 결함 수정: 폐기하면서 자리에 `true` 상수를 박아뒀던 게
    // 스스로 발견됐다 — 늘 통과하는 게이트는 게이트가 아니다. 발화 신호가 진짜
    // 진 자리(눈 모양)로 옮겨 다시 잰다: 대기 눈은 길쭉한 알약(세로가 가로보다
    // 한참 크다), 발화 눈은 거의 원이다(orb.css `[data-face="fired"] .orb-eye`
    // 참조 — 22.6%×23%, 대기 기본 `.orb-eye` 14.5%×34.4%와 대조). 두 상태의
    // getBoundingClientRect를 실측해 aspect ratio(세로/가로)로 비교한다.
    firedEyesAreRounder: !!(orbQuietEyeProbe && orbCollapsedProbe.eyeWidth
      && (orbQuietEyeProbe.height / orbQuietEyeProbe.width) > 1.5
      && (orbCollapsedProbe.eyeHeight / orbCollapsedProbe.eyeWidth) < 1.3),
    // **알림이 오면 딥블루가 실제로 화면에 있다.** 참조 실측과 같은 판정 기준을 쓴다.
    alertedShowsVisor: pixelsAlerted.bluishRatio >= 0.10,
    // 대기→발화에서 눈 자체의 실측 px(너비 또는 높이)가 눈에 띄게 바뀌었는가 —
    // 표정이 안 바뀌면 두 probe의 값이 같아 이 단언이 다시 떨어진다(회귀 가드).
    stateActuallyChangedEyeShape: !!(orbQuietEyeProbe && orbCollapsedProbe.eyeWidth
      && (Math.abs(orbCollapsedProbe.eyeWidth - orbQuietEyeProbe.width) > 2
        || Math.abs(orbCollapsedProbe.eyeHeight - orbQuietEyeProbe.height) > 2)),
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
    // (c) 없어야 하는 것 / 있어도 되는 것의 상한
    // board-33/34 — 입력창은 #orbInput 하나까지만 허용하고(그 밖의 id·이름 없는
    // input·textarea·contenteditable은 여전히 0개), 이 검증 시점(셸이 보이는
    // 상태 — 검증9d에서 restoreFromBackground로 이미 복귀됨)에는 대화 모드가
    // 꺼져 있어야 하므로 그 하나도 실제로 안 살아있어야 한다.
    onlyAllowedInput: JSON.stringify(orbPanelProbe.inputIds) === JSON.stringify(['orbInput']),
    chatInputGatedByShellVisibility: orbPanelProbe.chatInputStackHidden === true,
    // CP2 미니 티켓(3a85be5) 버튼 2종 포함 — 오브 병합 후 full verify 미실행으로
    // 기대 목록이 낡아 있었다(2026-08-27 병합 점검 M5). 티켓은 사용자 승인 범위.
    onlyAllowedButtons: JSON.stringify(orbPanelProbe.buttonIds) === JSON.stringify(['orbChatGo', 'orbClose', 'orbEsc', 'orbMore', 'orbTicketCancel', 'orbTicketExec', 'orbToggle']),
  };
  console.log('[verify] 검증22(알림 오브):', JSON.stringify(report.orbWindow));
  for (const key of [
    'isCircle76', 'dragHandleContract',
    'quietStateWasClean', 'quietFaceIsPresent', 'firedEyesAreRounder',
    'alertedShowsVisor', 'stateActuallyChangedEyeShape',
    'unreadCountShown', 'glassStaysAchromatic', 'visorNotFadeIn', 'hasTwoEyes', 'magentaArcRemoved',
    'expandGrewWindow', 'orbCornerStayed', 'roundTripRestoresPosition',
    'hasFiredBadge', 'hasModeLabel', 'hasRelativeTime', 'hasSourceLabel',
    'statesValueIsAtFireTime', 'representativeCardRendered', 'representativeCardFullyVisible', 'markedReadOnOpen',
    'onlyAllowedInput', 'chatInputGatedByShellVisibility', 'onlyAllowedButtons',
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
  } catch (err) {
    orbVisualPrimaryError = err;
    throw err;
  } finally {
    const orbVisualCleanupErrors = [];
    try {
      if (!orbWasVisibleBeforeVisualVerification && !orbWin.isDestroyed() && orbWin.isVisible()) {
        orbWin.hide();
      }
    } catch (err) {
      orbVisualCleanupErrors.push(err);
    }
    try {
      report.orbVisualVisibility.restoredOriginalVisibility = !orbWin.isDestroyed()
        && orbWin.isVisible() === orbWasVisibleBeforeVisualVerification;
    } catch (err) {
      orbVisualCleanupErrors.push(err);
    }
    if (orbVisualCleanupErrors.length) {
      if (orbVisualPrimaryError) {
        dlog(`orb visual cleanup after primary error: ${orbVisualCleanupErrors.map((err) => err && err.stack || err).join(' | ')}`);
      } else {
        throw orbVisualCleanupErrors[0];
      }
    }
  }
  assertOk('orbVisualVisibility: hidden-policy orb is shown only for visual checks and restored afterward',
    report.orbVisualVisibility.visibleAfterPaintSettle === true
    && report.orbVisualVisibility.restoredOriginalVisibility === true);

  // ---------- 검증 18: 캡처 신뢰성 — 연속 캡처 중복 감지 (2026-08-19 QA 결함 #2 재발 방지,
  // 디자인 갈래에서는 검증17이었다 — 병합 시 능동 턴 검증17과 번호가 겹쳐 18로 재부여) ----------
  // 같은 창을 연속으로 찍은 두 캡처가 MD5까지 완전히 같으면, 둘 중 하나(대개
  // 나중 것)는 화면이 바뀌기 전 프레임을 찍은 것이다 — 파일명이 주장하는 화면을
  // 실제로 담지 못했다는 뜻이라 값 자체가 신뢰 불가다. shot()의 rAF 2회 대기로
  // 근본 원인은 고쳤지만, 이 단언은 회귀를 잡는 감지망이다(완화가 아니라 추가).
  // 예외 목록이 비었다 — 예외를 관성으로 남기면 "예외라서 통과"가 조용히 쌓인다.
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
  // 2026-08-27(보드 45 v5): 스트립 필 줄은 전면 제거 — 진입로는 사이드바 모드
  // 네비 하나다(상시 노출, Paper 보드 44). 브레인 준비 여부로 **기대하는 결과**가
  // 갈린다: 준비됐으면 실제 그래프가, 안 됐으면 캔버스 안의 정직한 안내
  // (controller.js renderUnavailable)가 뜬다 — 둘 다 "정상"이고, 네비 항목이
  // 숨거나 클릭해도 캔버스가 안 열리는 것만 실패다.
  try {
    const graph = await shellWin.webContents.executeJavaScript(`(async () => {
      const container = document.getElementById('graphCanvas');
      // 사람이 밟는 길 그대로 사이드바 모드 네비를 누른다.
      const nav = document.getElementById('modeNavGraph');
      if (!nav || !container || !window.AthenaCanvasMode) {
        return { wired: false, reason: 'missing' };
      }
      if (nav.hidden) {
        // 상시 보여야 하는 진입로다(보드 44) — 숨어 있으면 사람이 못 닿는다.
        return { wired: false, reason: 'hidden-though-always-visible' };
      }
      const status = await window.athena.invoke('athena:brain-status').catch(() => null);
      const brainReady = Boolean(status && status.ok && status.ready);
      nav.click();
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        // 그래프 기능 진입 판정은 #mosaic(답변 모드)이 숨는지로 본다 —
        // #graphCanvas(지도 서브뷰)는 스텝2-보정 이후 기본 서브뷰가 아니라서
        // (기본은 요약) 그냥 클릭만으로는 안 보인다. draw()는 toggle() 안에서
        // surface와 무관하게 여전히 즉시 실행되므로(graphBody에 내용은 쓰인다),
        // 그 내용이 실제로 준비됐는지는 describeRendered로 확인한다.
        if (document.getElementById('mosaic').hidden) {
          if (!brainReady || window.AthenaLib.GraphRender.describeRendered(container).rendered) break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      const clickOpened = document.getElementById('mosaic').hidden;
      const summaryHidden = document.getElementById('mosaic').hidden;
      // getComputedStyle().display는 조상의 display:none에 영향받지 않는다(그
      // 자신의 display 선언만 본다) — #graphSummaryTable이 예전처럼 #mosaic의
      // 자식으로 숨어 있었어도 이 값은 그대로 'block'이었을 것이다. 실제로
      // 화면에 그려지는지는 크기로만 판별 가능하다 — 부모가 display:none이면
      // 자손은 레이아웃 박스 자체가 생성되지 않아 rect가 0×0이 된다.
      const graphSummaryTableEl = document.getElementById('graphSummaryTable');
      const summaryTableRect = graphSummaryTableEl.getBoundingClientRect();
      const summaryTableVisible = summaryTableRect.width > 0 && summaryTableRect.height > 0;
      // 스텝2-보정 회귀 가드 — 요약 뷰 헤더의 "요약"/"그래프" 서브뷰 탭은 이제
      // graphMode.setSurface()로 state.surface를 바꾸고, applyVisibility()
      // 하나가 hidden을 소유한다(z-index 임시조치는 걷어냈다). setSurface()가
      // applyVisibility()를 draw()의 await 이전에 동기 호출하므로 hidden은
      // click() 직후 바로 반영된다 — 별도 대기 불필요. "그래프" 탭을 눌러도
      // #mosaic(답변 모드)이 계속 hidden인지(답변 모드로 안 튕겨나가는지)도
      // 함께 확인한다.
      const graphViewTab = document.getElementById('graphViewTab');
      const summaryViewTab = document.getElementById('summaryViewTab');
      let surfaceToggle = null;
      if (graphViewTab && summaryViewTab) {
        graphViewTab.click();
        const afterGraphClick = {
          mosaicHidden: document.getElementById('mosaic').hidden,
          summaryTableHidden: graphSummaryTableEl.hidden,
          graphCanvasHidden: container.hidden,
          graphTabActive: graphViewTab.classList.contains('is-active'),
        };
        summaryViewTab.click();
        const afterSummaryClick = {
          mosaicHidden: document.getElementById('mosaic').hidden,
          summaryTableHidden: graphSummaryTableEl.hidden,
          graphCanvasHidden: container.hidden,
          summaryTabActive: summaryViewTab.classList.contains('is-active'),
        };
        surfaceToggle = { afterGraphClick, afterSummaryClick };
      }
      const containerText = container.textContent;
      if (!brainReady) {
        return { wired: true, brainReady, clickOpened, summaryHidden, summaryTableVisible, surfaceToggle, containerText };
      }
      const byClick = window.AthenaLib.GraphRender.describeRendered(container);
      // 좌표 계약은 배치 결과와 대조해야 알 수 있고, 클릭 경로는 그 값을 돌려주지
      // 않는다. 요약으로 접었다 다시 펴서 같은 화면의 배치를 받아 온다.
      await window.AthenaCanvasMode.toggle();
      const placed = await window.AthenaCanvasMode.toggle();
      const drawn = window.AthenaLib.GraphRender.describeRendered(container);
      return {
        wired: true,
        brainReady,
        clickOpened,
        byClick,
        summaryHidden,
        summaryTableVisible,
        surfaceToggle,
        placedNodes: placed ? placed.nodes.length : 0,
        placedEdges: placed ? placed.edges.length : 0,
        // 1단계(기본, STAGE_CLUSTERS)는 개별 엔티티가 아니라 군집 버블을 그린다
        // (79fbedd) — 그려진 것과 대조할 배치 값은 clusters/clusterEdges다.
        placedClusters: placed && Array.isArray(placed.clusters) ? placed.clusters.length : 0,
        placedClusterEdges: placed && Array.isArray(placed.clusterEdges) ? placed.clusterEdges.length : 0,
        drawn,
      };
    })()`);
    report.graphMode = graph;
    if (!graph.wired) {
      if (graph.reason === 'hidden-though-always-visible') {
        // 상시 보여야 하는 네비 항목이 숨어 있다 — 사람이 닿을 수 없는 기능이다.
        failures.push('graph-mode: 모드 네비 항목이 상시 보여야 하는데 숨어 있다');
      } else {
        // 네비 항목·캔버스·전역 중 하나가 아예 없다 — 배선이 끊긴 것이므로 실패다.
        failures.push('graph-mode: 배선이 끊겼다 (모드 네비/캔버스/전역 누락)');
      }
    } else if (graph.brainReady) {
      // 네비 항목 클릭 하나로 열려야 한다 — API 직접 호출로만 열리면 사람은 못 쓴다.
      assertOk('graph-mode: 네비 항목을 누르면 그래프가 열린다', graph.clickOpened === true);
      assertOk('graph-mode: 네비 클릭만으로 캔버스가 채워진다', graph.byClick.rendered === true);
      assertOk('graph-mode: 토글하면 요약이 숨는다', graph.summaryHidden === true);
      // G-05 회귀 가드 — #graphSummaryTable이 #mosaic의 자식이던 시절엔 부모의
      // hidden(display:none) 상속에 막혀 크기가 0×0이었다(getComputedStyle의
      // display 값 자체는 조상 hidden과 무관해 이 결함을 못 잡는다 — rect로 봐야 한다).
      assertOk(
        'graph-mode: 성향 신호 표가 실제로 렌더된다(hidden 상속에 막히지 않는다)',
        graph.summaryTableVisible === true,
      );
      // 노드가 0개면 '빈 캔버스'와 '고장'을 구분할 수 없다. 브레인이 준비됐으면
      // 여기 왔을 때 그려진 것이 있어야 한다.
      assertOk('graph-mode: 캔버스가 비어 있지 않다', graph.drawn.rendered === true);
      // 1단계는 군집 버블 집계다(79fbedd) — 그려진 노드/엣지는 개별 엔티티(placedNodes)가
      // 아니라 군집 버블(placedClusters)·군집간 선(placedClusterEdges)과 일치해야 한다.
      assertOk(
        'graph-mode: 그려진 버블 수가 배치 군집 수와 일치한다',
        graph.drawn.nodes === graph.placedClusters,
      );
      assertOk(
        'graph-mode: 그려진 군집간 선 수가 배치와 일치한다',
        graph.drawn.edges === graph.placedClusterEdges,
      );
      report.graphMode.shot = await shot(shellWin, '90-graph-mode.png');
      // 지도 서브뷰도 증거로 남긴다(버블 AI 추정 라벨·숨은연관 핑크 점선은 지도
      // 표면에만 그려진다) — 찍고 요약 탭으로 되돌려 이후 검증의 전제(요약 표
      // 표시 상태)를 바꾸지 않는다.
      await shellWin.webContents.executeJavaScript(
        "document.getElementById('graphViewTab').click()"
      );
      report.graphMode.mapShot = await shot(shellWin, '90b-graph-map.png');
      await shellWin.webContents.executeJavaScript(
        "document.getElementById('summaryViewTab').click()"
      );
    } else {
      // 브레인이 안 됐다 — 그래도 네비 항목을 누르면 캔버스는 열려야 한다(막히지
      // 않는다), 다만 그 안은 실제 그래프가 아니라 정직한 안내여야 한다.
      assertOk('graph-mode: 브레인이 안 돼도 네비 항목을 누르면 캔버스가 열린다', graph.clickOpened === true);
      assertOk('graph-mode: 토글하면 요약이 숨는다', graph.summaryHidden === true);
      assertOk(
        'graph-mode: 브레인 미준비 시 캔버스 안에 정직한 안내가 뜬다(빈 화면이 아니다)',
        /브레인|성향/.test(graph.containerText || ''),
      );
      // G-05 회귀 가드 — 브레인 미준비 상태에서도 성향 신호 표 자체는 hidden
      // 상속에 막히지 않고 렌더돼야 한다(내용은 profile-summary가 없어 비어 있을 수 있다).
      assertOk(
        'graph-mode: 성향 신호 표가 실제로 렌더된다(hidden 상속에 막히지 않는다)',
        graph.summaryTableVisible === true,
      );
      report.graphMode.shot = await shot(shellWin, '90-graph-mode-unavailable.png');
    }
    if (graph.surfaceToggle) {
      // 스텝2-보정 회귀 가드 — brainReady와 무관하게 확인한다: 요약 뷰 헤더의
      // "요약"/"그래프" 서브뷰 탭이 graphMode.setSurface()로 hidden을 올바르게
      // 배타 전환하는지(z-index 임시조치가 아니라 진짜 hidden), 그리고 답변
      // 모드로 튕겨나가지 않는지(#mosaic이 계속 hidden).
      const st = graph.surfaceToggle;
      assertOk(
        'graph-mode: 그래프 탭 클릭 시 그래프 캔버스가 보이고 성향 신호 표는 숨는다',
        st.afterGraphClick.graphCanvasHidden === false && st.afterGraphClick.summaryTableHidden === true,
      );
      assertOk('graph-mode: 그래프 탭 클릭이 답변 모드로 튕겨나가지 않는다', st.afterGraphClick.mosaicHidden === true);
      assertOk('graph-mode: 그래프 탭이 활성 스타일을 받는다', st.afterGraphClick.graphTabActive === true);
      assertOk(
        'graph-mode: 요약 탭 클릭 시 성향 신호 표가 다시 보이고 그래프 캔버스는 숨는다',
        st.afterSummaryClick.summaryTableHidden === false && st.afterSummaryClick.graphCanvasHidden === true,
      );
      assertOk('graph-mode: 요약 탭 클릭도 답변 모드로 튕겨나가지 않는다', st.afterSummaryClick.mosaicHidden === true);
      assertOk('graph-mode: 요약 탭이 활성 스타일을 받는다', st.afterSummaryClick.summaryTabActive === true);
    }
  } catch (err) {
    report.graphMode = { error: String((err && err.message) || err) };
    failures.push('graph-mode: 검증 블록이 예외로 끝났다');
  }

  // ---------- 사이드바 모드 네비 3상태 (리프 1.2.2, BLOCKER 반영) ----------
  //
  // #graphPill이 완전히 사라졌는지, 새 모드 네비 3항목이 캔버스 3영역
  // (#mosaic/#graphCanvas/#agentCanvas)의 3중 배타를 실제로 쥐고 있는지,
  // #dot 클릭이 더는 모드를 바꾸지 않는지(상태표시 전용으로 좁혀졌는지)를
  // 잰다 — 1단계 완료 조건(AC3/AC4)이다.
  try {
    const modeNav = await shellWin.webContents.executeJavaScript(`(() => {
      const pillGone = document.getElementById('graphPill') === null;
      const items = {
        summary: document.getElementById('modeNavSummary'),
        graph: document.getElementById('modeNavGraph'),
        agent: document.getElementById('modeNavAgent'),
      };
      const itemsPresent = Object.values(items).every(Boolean);
      function visibleRegions() {
        const vis = (id) => { const el = document.getElementById(id); return el && !el.hidden; };
        const out = [];
        if (vis('mosaic')) out.push('summary');
        // 그래프 기능은 두 서브뷰(요약 표 #graphSummaryTable / 지도 #graphCanvas)
        // 중 하나로 보인다(스텝2-보정, 기본은 요약 표) — 어느 쪽이든 "그래프
        // 표면이 보인다"로 센다.
        if (vis('graphSummaryTable') || vis('graphCanvas')) out.push('graph');
        if (vis('agentCanvas')) out.push('agent');
        return out;
      }
      const dot = document.getElementById('dot');
      const stateBefore = window.AthenaCanvasMode ? window.AthenaCanvasMode.state.view : null;
      if (dot) dot.click();
      const stateAfterDotClick = window.AthenaCanvasMode ? window.AthenaCanvasMode.state.view : null;
      if (!itemsPresent) return { pillGone, itemsPresent, stateBefore, stateAfterDotClick };
      items.agent.click();
      const afterAgentClick = visibleRegions();
      items.graph.click();
      const afterGraphClick = visibleRegions();
      items.summary.click();
      const afterSummaryClick = visibleRegions();
      return {
        pillGone, itemsPresent, stateBefore, stateAfterDotClick,
        afterAgentClick, afterGraphClick, afterSummaryClick,
      };
    })()`);
    report.modeNav = modeNav;
    assertOk('mode-nav: #graphPill이 DOM에서 제거됐다', modeNav.pillGone === true);
    assertOk('mode-nav: 모드 네비 3항목(대화/그래프/에이전트)이 존재한다', modeNav.itemsPresent === true);
    assertOk('mode-nav: #dot 클릭은 더 이상 모드를 바꾸지 않는다(상태표시 전용)', modeNav.stateAfterDotClick === modeNav.stateBefore);
    if (modeNav.itemsPresent) {
      assertOk(
        'mode-nav: 에이전트 클릭 시 agentCanvas만 보인다(정확히 하나)',
        JSON.stringify(modeNav.afterAgentClick) === JSON.stringify(['agent']),
      );
      assertOk(
        'mode-nav: 그래프 클릭 시 그래프 표면만 보인다(정확히 하나)',
        JSON.stringify(modeNav.afterGraphClick) === JSON.stringify(['graph']),
      );
      assertOk(
        'mode-nav: 대화 클릭 시 mosaic만 보인다(정확히 하나)',
        JSON.stringify(modeNav.afterSummaryClick) === JSON.stringify(['summary']),
      );
    }
  } catch (err) {
    report.modeNav = { error: String((err && err.message) || err) };
    failures.push('mode-nav: 검증 블록이 예외로 끝났다');
  }

  // ---------- 에이전트모드 사이드바 — 작업·알람 파생 방 우선 노출 (3단계) ----------
  //
  // GET /api/v1/routines(athena:routines-list)는 이 하네스에 실제 백엔드가
  // 없으면 그대로 실패한다(위 #routineChip과 같은 처지) — 그래서 계획서가 쓴
  // "fixture 시드 데이터"를 여기서 만든다: ipcMain 핸들러를 이 블록 동안만
  // 교체해 라이브 IPC 경로(athena:routines-list → 렌더러 렌더)는 그대로 타되
  // 값만 픽스처로 준다. 렌더러 쪽 window.athena는 contextBridge로 얼려져 있어
  // (exposeInMainWorld) 거기서 직접 monkeypatch하면 조용히 무시될 수 있다 —
  // 그래서 main 프로세스의 ipcMain.handle을 바꾸는 쪽이 더 안전하다. 이
  // 블록이 스크립트의 마지막 라우틴 소비자라 복원은 "백엔드 없음"과 동일한
  // 정직한 실패 모양으로만 되돌린다(원래 핸들러를 그대로 재현할 수단이 없다).
  try {
    ipcMain.removeHandler('athena:routines-list');
    ipcMain.handle('athena:routines-list', async () => ({
      ok: true,
      data: {
        routines: [
          { id: 'fx1', symbol: '005930', note: '삼성전자 88,000 감시', status: 'active', mode: 'realtime-ws' },
          { id: 'fx2', symbol: '000660', note: 'SK하이닉스 공시 키워드', status: 'paused', mode: 'periodic' },
          // draft도 8단계부터 우선 노출 대상이다(◌ 점선 핑크) — 포함되는지 같이 잰다.
          { id: 'fx3', symbol: '005380', note: '현대차 실적 발표', status: 'draft', mode: 'periodic' },
        ],
        disclosure_ready: true,
        last_error: null,
      },
    }));

    const agentSidebar = await shellWin.webContents.executeJavaScript(`(async () => {
      const nav = document.getElementById('modeNavAgent');
      const back = document.getElementById('modeNavSummary');
      const list = document.getElementById('sidebarList');
      if (!nav || !back || !list) return { wired: false };
      nav.click();
      await new Promise((r) => setTimeout(r, 600)); // IPC 왕복 + renderList()
      const firstLabelAfterAgent = list.firstElementChild ? list.firstElementChild.textContent : null;
      const routineRowCount = list.querySelectorAll('.sidebar-item.is-routine').length;
      const pausedRowCount = list.querySelectorAll('.sidebar-item.is-routine.is-paused').length;
      const draftRowCount = list.querySelectorAll('.sidebar-item.is-routine.is-draft').length;
      back.click();
      await new Promise((r) => setTimeout(r, 200));
      const firstLabelAfterReturn = list.firstElementChild ? list.firstElementChild.textContent : null;
      const routineRowsGoneAfterReturn = list.querySelectorAll('.sidebar-item.is-routine').length === 0;
      return {
        wired: true, firstLabelAfterAgent, routineRowCount, pausedRowCount, draftRowCount,
        firstLabelAfterReturn, routineRowsGoneAfterReturn,
      };
    })()`);
    report.agentSidebar = agentSidebar;
    assertOk('agent-sidebar: 모드 네비/사이드바 리스트 배선이 있다', agentSidebar.wired === true);
    if (agentSidebar.wired) {
      assertOk(
        'agent-sidebar: 에이전트 모드 전환 직후 첫 섹션이 "작업·알람"이다(AC6)',
        agentSidebar.firstLabelAfterAgent === '작업·알람',
      );
      assertOk(
        'agent-sidebar: active+paused+draft 3건 모두 우선 노출된다(8단계부터 draft도 포함)',
        agentSidebar.routineRowCount === 3,
      );
      assertOk('agent-sidebar: paused 1건이 is-paused로 표시된다', agentSidebar.pausedRowCount === 1);
      assertOk('agent-sidebar: draft 1건이 is-draft로 표시된다(◌ 점선 핑크)', agentSidebar.draftRowCount === 1);
      assertOk(
        'agent-sidebar: 대화모드 복귀 시 라우틴 행이 사라지고 원래 이력이 복원된다(AC6)',
        agentSidebar.routineRowsGoneAfterReturn === true && agentSidebar.firstLabelAfterReturn !== '작업·알람',
      );
    }
  } catch (err) {
    report.agentSidebar = { error: String((err && err.message) || err) };
    failures.push('agent-sidebar: 검증 블록이 예외로 끝났다');
  } finally {
    ipcMain.removeHandler('athena:routines-list');
    ipcMain.handle('athena:routines-list', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
  }

  // ---------- 에이전트모드 캔버스 — 헤더·세그먼트 탭·통계 카드 (4단계) ----------
  //
  // 위 3단계 블록과 같은 이유로 athena:routines-list를 잠깐 fixture로 바꾼다
  // (이 하네스엔 실제 백엔드가 없다) — draft 1건을 섞어 좌측 리스트 필터링을
  // 잰다. 5단계에서 리스트가 감시(watch, 실데이터)+예약(schedule) 두 열
  // 레이아웃으로 바뀌었고, 후속 F-stage3(F1-FE)에서 예약도 fixture가 아니라
  // GET /api/v1/routines의 mode==='scheduled' 실데이터로 승격됐다 — 그래서
  // fx4를 섞어 예약 행도 같은 IPC로 함께 흘려보낸다. 행 클래스는 .agent-row다.
  try {
    ipcMain.removeHandler('athena:routines-list');
    ipcMain.handle('athena:routines-list', async () => ({
      ok: true,
      data: {
        routines: [
          { id: 'fx1', symbol: '005930', note: '삼성전자 88,000 감시', status: 'active', mode: 'realtime-ws' },
          { id: 'fx2', symbol: '000660', note: 'SK하이닉스 공시 키워드', status: 'paused', mode: 'periodic' },
          { id: 'fx3', symbol: '005380', note: '현대차 실적 발표', status: 'draft', mode: 'periodic' },
          {
            id: 'fx4', symbol: '069500', note: '평일 아침 브리핑', status: 'active', mode: 'scheduled',
            next_fire_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          },
        ],
        disclosure_ready: true,
        last_error: null,
        fired_today: 2,
      },
    }));

    const agentCanvasProbe = await shellWin.webContents.executeJavaScript(`(async () => {
      const nav = document.getElementById('modeNavAgent');
      const back = document.getElementById('modeNavSummary');
      const canvas = document.getElementById('agentCanvas');
      if (!nav || !back || !canvas) return { wired: false };
      nav.click();
      await new Promise((r) => setTimeout(r, 600)); // IPC 왕복 + refresh()
      const headerText = {
        title: (canvas.querySelector('.agent-title') || {}).textContent || null,
        subtitle: (canvas.querySelector('.agent-subtitle') || {}).textContent || null,
        tabLabels: Array.from(canvas.querySelectorAll('.agent-tab')).map((n) => n.textContent),
        searchPlaceholder: (canvas.querySelector('.agent-search-input') || {}).placeholder || null,
        ctaText: (canvas.querySelector('.agent-cta') || {}).textContent || null,
      };
      const statCards = Array.from(canvas.querySelectorAll('.agent-stat-card'));
      const statCount = statCards.length;
      const fixtureStatCount = statCards.filter((n) => n.getAttribute('data-source') === 'fixture').length;
      const allRowCount = canvas.querySelectorAll('.agent-row').length;
      const activeTabBtn = Array.from(canvas.querySelectorAll('.agent-tab')).find((n) => n.textContent === '활성');
      if (activeTabBtn) activeTabBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      const activeRowCount = canvas.querySelectorAll('.agent-row').length;
      // agentCanvas는 싱글턴이라 탭 상태가 다음 블록까지 남는다 — "모두"로
      // 되돌려 이 블록이 뒤따르는 블록에 곁가지 상태를 남기지 않게 한다.
      const allTabBtn = Array.from(canvas.querySelectorAll('.agent-tab')).find((n) => n.textContent === '모두');
      if (allTabBtn) allTabBtn.click();
      back.click();
      await new Promise((r) => setTimeout(r, 100));
      return { wired: true, headerText, statCount, fixtureStatCount, allRowCount, activeRowCount };
    })()`);
    report.agentCanvas = agentCanvasProbe;
    assertOk('agent-canvas: 헤더/캔버스 배선이 있다', agentCanvasProbe.wired === true);
    if (agentCanvasProbe.wired) {
      assertOk('agent-canvas: 타이틀이 "에이전트"다', agentCanvasProbe.headerText.title === '에이전트');
      assertOk(
        'agent-canvas: 탭 3종(모두/활성/일시중지)이 있다',
        JSON.stringify(agentCanvasProbe.headerText.tabLabels) === JSON.stringify(['모두', '활성', '일시중지']),
      );
      assertOk('agent-canvas: 검색 placeholder가 "작업 검색"이다', agentCanvasProbe.headerText.searchPlaceholder === '작업 검색');
      assertOk('agent-canvas: CTA가 "새 작업"을 담고 있다', (agentCanvasProbe.headerText.ctaText || '').includes('새 작업'));
      assertOk('agent-canvas: 통계 카드 4장이 렌더된다', agentCanvasProbe.statCount === 4);
      assertOk(
        'agent-canvas: "진행 중" 한 장만 fixture 출처다(F-stage3 — 나머지 3장은 라이브로 승격)',
        agentCanvasProbe.fixtureStatCount === 1,
      );
      assertOk(
        'agent-canvas: "모두" 탭은 감시 2건 + draft 1건 + 예약(live) 1건 = 4건이 보인다(8단계 draft·F-stage3 예약 라이브 포함)',
        agentCanvasProbe.allRowCount === 4,
      );
      assertOk(
        'agent-canvas: "활성" 탭 전환 시 2건(감시 1 + 예약 1)만 남는다(좌측 리스트 필터링, 예약도 live)',
        agentCanvasProbe.activeRowCount === 2,
      );
    }
  } catch (err) {
    report.agentCanvas = { error: String((err && err.message) || err) };
    failures.push('agent-canvas: 검증 블록이 예외로 끝났다');
  } finally {
    ipcMain.removeHandler('athena:routines-list');
    ipcMain.handle('athena:routines-list', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
  }

  // ---------- 에이전트모드 리스트·상세 — 감시=라이브 왕복, 예약=라이브(F-stage3) (5단계) ----------
  //
  // athena:routines-list와 함께 athena:routine-confirm도 이 블록 동안만
  // stateful fixture로 바꾼다 — draft→active 전이를 진짜로 흉내 내서
  // "draft→confirm 왕복이 실제 API로 동작"을 잰다. 이 confirm 액션 자체는
  // 채팅의 루틴 승인 카드([승인] 버튼, chat.js renderApprovalCard)가 이미
  // 쓰는 것과 같은 IPC 채널·계약이다 — 여기서 새 UI를 만들지 않고 그 채널을
  // 그대로 재사용해 캔버스가 결과를 정확히 반영하는지만 본다. F-stage3부터
  // 예약(schedule.daily)도 fixture 폴백이 아니라 이 같은 IPC로 흘러온다 —
  // fx-scheduled를 섞어 confirm 왕복과 무관하게 live로 남는지 함께 잰다.
  try {
    const stage5Routines = [
      {
        id: 'fx-draft', symbol: '005930', note: '삼성전자 조건 도달', status: 'draft', mode: 'realtime-ws',
        source_label: '현재가', cooldown_s: 300,
      },
      {
        id: 'fx-active', symbol: '000660', note: 'SK하이닉스 감시', status: 'active', mode: 'periodic',
        source_label: '공시 제목 키워드', cooldown_s: 600,
      },
      {
        id: 'fx-scheduled', symbol: '069500', note: '평일 아침 브리핑', status: 'active', mode: 'scheduled',
        source_label: '예약 시각(요일 지정)', cooldown_s: 0,
        next_fire_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
    ];
    ipcMain.removeHandler('athena:routines-list');
    ipcMain.handle('athena:routines-list', async () => ({
      ok: true,
      data: { routines: stage5Routines, disclosure_ready: true, last_error: null },
    }));
    ipcMain.removeHandler('athena:routine-confirm');
    ipcMain.handle('athena:routine-confirm', async (_e, { id } = {}) => {
      const r = stage5Routines.find((x) => x.id === id);
      if (!r) return { ok: false, error: '루틴이 존재하지 않는다' };
      if (r.status !== 'draft') return { ok: false, error: '전이할 수 없다' };
      r.status = 'active'; // routines.py confirm_routine과 같은 계약: draft → active
      return { ok: true, data: { ...r } };
    });

    const routineRoundTrip = await shellWin.webContents.executeJavaScript(`(async () => {
      const nav = document.getElementById('modeNavAgent');
      const back = document.getElementById('modeNavSummary');
      const canvas = document.getElementById('agentCanvas');
      if (!nav || !back || !canvas || !window.AthenaAgentCanvas) return { wired: false };
      const count = (sel) => canvas.querySelectorAll(sel).length;
      nav.click();
      await new Promise((r) => setTimeout(r, 600));
      // 4단계 블록이 "활성" 탭을 누른 채로 끝났을 수 있다(agentCanvas는 싱글턴이라
      // 탭 상태가 블록 사이에 남는다) — "모두"로 되돌려 이 블록을 그 순서와
      // 무관하게 만든다.
      const allTabBtn = Array.from(canvas.querySelectorAll('.agent-tab')).find((n) => n.textContent === '모두');
      if (allTabBtn) allTabBtn.click();
      // 8단계부터 draft도 data-source="live"다(실데이터라서) — watch/draft를
      // is-draft 클래스로 갈라 각각 잰다. F-stage3부터 watch:not(.is-draft)엔
      // 예약(schedule) 행도 섞여 든다(둘 다 data-source="live") — 그래서
      // 예약 행은 아래에서 제목으로 따로 찾아 출처만 별도로 잰다.
      const snapshot = () => ({
        watch: count('.agent-row[data-source="live"]:not(.is-draft)'),
        draft: count('.agent-row.is-draft'),
        fixture: count('.agent-row[data-source="fixture"]'),
      });
      const scheduleRowSource = () => {
        const row = Array.from(canvas.querySelectorAll('.agent-row')).find(
          (r) => (r.querySelector('.agent-row-title') || {}).textContent === '평일 아침 브리핑',
        );
        return row ? row.getAttribute('data-source') : null;
      };
      const before = snapshot();
      const scheduleSourceBefore = scheduleRowSource();
      // 채팅의 루틴 승인 카드가 [승인]을 누를 때 부르는 것과 같은 채널.
      const confirmRes = await window.athena.invoke('athena:routine-confirm', { id: 'fx-draft' });
      await window.AthenaAgentCanvas.refresh();
      await new Promise((r) => setTimeout(r, 200));
      const after = snapshot();
      const scheduleSourceAfter = scheduleRowSource();
      back.click();
      await new Promise((r) => setTimeout(r, 100));
      return {
        wired: true, confirmOk: !!(confirmRes && confirmRes.ok), before, after, scheduleSourceBefore, scheduleSourceAfter,
      };
    })()`);
    report.routineRoundTrip = routineRoundTrip;
    assertOk('agent-canvas-5: 배선이 있다', routineRoundTrip.wired === true);
    if (routineRoundTrip.wired) {
      assertOk('agent-canvas-5: confirm 호출이 성공한다(승인 카드와 같은 채널)', routineRoundTrip.confirmOk === true);
      assertOk(
        // watch 카운트엔 F-stage3부터 예약(schedule) 행도 섞인다(둘 다
        // data-source="live"라 이 CSS 셀렉터로는 안 갈린다) — fx-active(watch)
        // + fx-scheduled(schedule) = 2, draft는 fx-draft 1건.
        'agent-canvas-5: confirm 전엔 감시+예약(live) 2건 + draft 1건이 보인다(8단계, F-stage3)',
        routineRoundTrip.before.watch === 2 && routineRoundTrip.before.draft === 1,
      );
      assertOk(
        'agent-canvas-5: draft→confirm 왕복 후 draft 행이 감시(watch) 행으로 바뀐다(실 API)',
        routineRoundTrip.after.watch === 3 && routineRoundTrip.after.draft === 0,
      );
      assertOk(
        'agent-canvas-5/F-stage3: 예약(schedule) 행은 confirm과 무관하게 항상 live 출처다(더 이상 fixture가 아니다, P3)',
        routineRoundTrip.scheduleSourceBefore === 'live' && routineRoundTrip.scheduleSourceAfter === 'live',
      );
    }
  } catch (err) {
    report.routineRoundTrip = { error: String((err && err.message) || err) };
    failures.push('agent-canvas-5: 검증 블록이 예외로 끝났다');
  } finally {
    ipcMain.removeHandler('athena:routines-list');
    ipcMain.handle('athena:routines-list', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
    ipcMain.removeHandler('athena:routine-confirm');
    ipcMain.handle('athena:routine-confirm', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
  }

  // ---------- 상세 패널 일시중지·재개 → pause/resume API (6.5단계) ----------
  //
  // 6단계가 만든 엔드포인트를 이 화면에 처음 잇는다. athena:routines-list와
  // 함께 athena:routine-pause/resume도 stateful fixture로 바꿔 active→paused→
  // active 왕복이 실제로 도는지 잰다(승인 카드 confirm과 같은 패턴, 5단계
  // routineRoundTrip 참고).
  try {
    const stage65Routines = [
      {
        id: 'fx-pause', symbol: '005930', note: '삼성전자 감시', status: 'active', mode: 'periodic',
        source_label: '현재가', cooldown_s: 300,
      },
    ];
    ipcMain.removeHandler('athena:routines-list');
    ipcMain.handle('athena:routines-list', async () => ({
      ok: true, data: { routines: stage65Routines, disclosure_ready: true, last_error: null },
    }));
    ipcMain.removeHandler('athena:routine-pause');
    ipcMain.handle('athena:routine-pause', async (_e, { id } = {}) => {
      const r = stage65Routines.find((x) => x.id === id);
      if (!r) return { ok: false, error: '루틴이 존재하지 않는다' };
      r.status = 'paused';
      return { ok: true, data: { ...r } };
    });
    ipcMain.removeHandler('athena:routine-resume');
    ipcMain.handle('athena:routine-resume', async (_e, { id } = {}) => {
      const r = stage65Routines.find((x) => x.id === id);
      if (!r) return { ok: false, error: '루틴이 존재하지 않는다' };
      r.status = 'active';
      return { ok: true, data: { ...r } };
    });

    const pauseResumeProbe = await shellWin.webContents.executeJavaScript(`(async () => {
      const nav = document.getElementById('modeNavAgent');
      const back = document.getElementById('modeNavSummary');
      const canvas = document.getElementById('agentCanvas');
      if (!nav || !back || !canvas || !window.AthenaAgentCanvas) return { wired: false };
      nav.click();
      await new Promise((r) => setTimeout(r, 600));
      const allTabBtn = Array.from(canvas.querySelectorAll('.agent-tab')).find((n) => n.textContent === '모두');
      if (allTabBtn) allTabBtn.click();
      window.AthenaAgentCanvas.selectRow('fx-pause');
      await new Promise((r) => setTimeout(r, 100));
      const before = (canvas.querySelector('.agent-pause-btn') || {}).textContent || null;
      canvas.querySelector('.agent-pause-btn').click();
      await new Promise((r) => setTimeout(r, 300));
      const afterPause = (canvas.querySelector('.agent-pause-btn') || {}).textContent || null;
      const badgeAfterPause = (canvas.querySelector('.agent-status-badge') || {}).textContent || null;
      canvas.querySelector('.agent-pause-btn').click();
      await new Promise((r) => setTimeout(r, 300));
      const afterResume = (canvas.querySelector('.agent-pause-btn') || {}).textContent || null;
      const badgeAfterResume = (canvas.querySelector('.agent-status-badge') || {}).textContent || null;
      back.click();
      await new Promise((r) => setTimeout(r, 100));
      return { wired: true, before, afterPause, badgeAfterPause, afterResume, badgeAfterResume };
    })()`);
    report.pauseResume = pauseResumeProbe;
    assertOk('agent-canvas-6.5: 배선이 있다', pauseResumeProbe.wired === true);
    if (pauseResumeProbe.wired) {
      assertOk('agent-canvas-6.5: 활성 항목은 "❚❚ 일시중지" 버튼을 보여준다', pauseResumeProbe.before === '❚❚ 일시중지');
      assertOk(
        'agent-canvas-6.5: 일시중지 클릭 후 버튼이 "재개"로 바뀐다(실 API)',
        pauseResumeProbe.afterPause === '▶ 재개',
      );
      assertOk('agent-canvas-6.5: 일시중지 클릭 후 상태 배지가 "일시중지"다', pauseResumeProbe.badgeAfterPause === '일시중지');
      assertOk(
        'agent-canvas-6.5: 재개 클릭 후 버튼이 다시 "❚❚ 일시중지"로 바뀐다',
        pauseResumeProbe.afterResume === '❚❚ 일시중지',
      );
      assertOk('agent-canvas-6.5: 재개 클릭 후 상태 배지가 "활성"이다', pauseResumeProbe.badgeAfterResume === '활성');
    }
  } catch (err) {
    report.pauseResume = { error: String((err && err.message) || err) };
    failures.push('agent-canvas-6.5: 검증 블록이 예외로 끝났다');
  } finally {
    ipcMain.removeHandler('athena:routines-list');
    ipcMain.handle('athena:routines-list', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
    ipcMain.removeHandler('athena:routine-pause');
    ipcMain.handle('athena:routine-pause', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
    ipcMain.removeHandler('athena:routine-resume');
    ipcMain.handle('athena:routine-resume', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
  }

  // ---------- 제안 — 그래프 성향 기반 (7단계, Paper 보드 39 하단) ----------
  //
  // athena:brain-profile-summary를 stateful fixture로 바꿔 실데이터 왕복을
  // 흉내낸다(summary-table.js가 보드 07에서 쓰는 것과 같은 채널). "추가" 클릭이
  // 시트를 열지 않고 채팅 입력에만 문장을 심는지 확인한다(43 원칙 위반 시 실패).
  try {
    ipcMain.removeHandler('athena:routines-list');
    ipcMain.handle('athena:routines-list', async () => ({
      ok: true, data: { routines: [], disclosure_ready: true, last_error: null },
    }));
    ipcMain.removeHandler('athena:brain-profile-summary');
    ipcMain.handle('athena:brain-profile-summary', async () => ({
      ok: true,
      entries: [
        {
          entity_id: 'e1', entity_kind: 'stock', entity_name: '삼성전자', relation_kind: '단기 회전',
          confidence: 'EXTRACTED', tier: 'deterministic', rationale: '매매일마다 정리가 필요해 보여요',
          observed_at: '2026-08-26T00:00:00Z', reinforcement: 21,
        },
        {
          entity_id: 'e2', entity_kind: 'theme', entity_name: '배당 방어 바스켓', relation_kind: '응집 상승',
          confidence: 'INFERRED', tier: 'conversational', rationale: null,
          observed_at: '2026-08-25T00:00:00Z', reinforcement: 6,
        },
      ],
    }));

    const suggestionProbe = await shellWin.webContents.executeJavaScript(`(async () => {
      const nav = document.getElementById('modeNavAgent');
      const back = document.getElementById('modeNavSummary');
      const canvas = document.getElementById('agentCanvas');
      const input = document.getElementById('input');
      if (!nav || !back || !canvas || !input) return { wired: false };
      input.value = '';
      nav.click();
      await new Promise((r) => setTimeout(r, 600));
      const section = canvas.querySelector('.agent-suggest-section');
      const sectionHidden = section ? section.hidden : null;
      const titles = Array.from(canvas.querySelectorAll('.agent-suggest-title')).map((n) => n.textContent);
      const rationales = Array.from(canvas.querySelectorAll('.agent-suggest-rationale')).map((n) => n.textContent);
      const addBtns = canvas.querySelectorAll('.agent-suggest-add');
      addBtns[0].click();
      await new Promise((r) => setTimeout(r, 50));
      const seededValue = input.value;
      const orderHidden = document.getElementById('order').hidden;
      const settingsHidden = document.getElementById('settings').hidden;
      const onboardHidden = document.getElementById('onboard').hidden;
      back.click();
      await new Promise((r) => setTimeout(r, 100));
      return { wired: true, sectionHidden, titles, rationales, seededValue, orderHidden, settingsHidden, onboardHidden };
    })()`);
    report.suggestions = suggestionProbe;
    assertOk('agent-canvas-7: 배선이 있다', suggestionProbe.wired === true);
    if (suggestionProbe.wired) {
      assertOk('agent-canvas-7: 신호가 있으면 제안 섹션이 보인다', suggestionProbe.sectionHidden === false);
      assertOk(
        'agent-canvas-7: 제목 2건이 실제 entity_name이다(지어낸 태스크 문구가 아니다)',
        JSON.stringify(suggestionProbe.titles) === JSON.stringify(['삼성전자', '배당 방어 바스켓']),
      );
      assertOk(
        'agent-canvas-7: 근거문이 relation_kind·reinforcement·rationale 실제 필드로만 조합된다',
        suggestionProbe.rationales[0] === '단기 회전 성향 21회 보강 — 매매일마다 정리가 필요해 보여요'
          && suggestionProbe.rationales[1] === '응집 상승 성향 6회 보강',
      );
      assertOk(
        'agent-canvas-7: "추가" 클릭 시 채팅 입력에 문장이 심긴다',
        suggestionProbe.seededValue === '"삼성전자"에 대한 단기 회전 성향이 21회 보강됐어요 — 관련 루틴을 만들어줄까요?',
      );
      assertOk(
        'agent-canvas-7: "추가"는 시트를 열지 않는다(주문/설정/온보딩 패널 모두 hidden 유지, 43 원칙)',
        suggestionProbe.orderHidden === true && suggestionProbe.settingsHidden === true && suggestionProbe.onboardHidden === true,
      );
    }
  } catch (err) {
    report.suggestions = { error: String((err && err.message) || err) };
    failures.push('agent-canvas-7: 검증 블록이 예외로 끝났다');
  } finally {
    ipcMain.removeHandler('athena:routines-list');
    ipcMain.handle('athena:routines-list', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
    ipcMain.removeHandler('athena:brain-profile-summary');
    ipcMain.handle('athena:brain-profile-summary', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
    // 채팅 입력에 남은 시드 문장을 다음 블록으로 새지 않게 지운다.
    await shellWin.webContents.executeJavaScript(`(() => {
      const input = document.getElementById('input');
      if (input) input.value = '';
    })()`);
  }

  // ---------- 새 작업은 채팅에서 (8단계, Paper 보드 43) ----------
  //
  // athena:routines-list를 draft 2건이 있는 stateful fixture로 바꾸고, 아무
  // 질의나 Enter로 트리거한다(검증5와 같은 경로) — chat.js가 턴 종료 직후
  // refreshRoutineDrafts()를 불러 "작업 요약·초안" 카드를 스트림 파싱이 아니라
  // 목록 재조회로 결정론적으로 띄운다(P3). "고칠 게 있어"는 채팅 입력에 문장을
  // 심고(시트 없음), "바로 활성화"는 기존 승인 채널(athena:routine-confirm)을
  // 그대로 부른다(채팅의 루틴 승인 카드가 이미 쓰는 것과 같은 채널).
  try {
    const stage8Routines = [
      {
        id: 'fx-draft-1', symbol: '005930', note: '삼성전자 조건 도달 시 감시', status: 'draft', mode: 'realtime-ws',
        source_label: '현재가', cooldown_s: 300, activation_blocker: null,
      },
      {
        id: 'fx-draft-2', symbol: '000660', note: 'SK하이닉스 공시 키워드 감시', status: 'draft', mode: 'periodic',
        source_label: '공시 제목 키워드', cooldown_s: 600, activation_blocker: null,
      },
      // F-stage3(F1-FE) — 예약(schedule.daily) draft. approvalModeLine()의
      // 3분기(사실11②)가 "방식 예약 실행 — 지정 요일·시각"을 만들고, "틱
      // 즉시"(periodic 전용 문구)가 섞이지 않는지 여기서 잰다.
      {
        id: 'fx-draft-3', symbol: '069500', note: '평일 아침 브리핑 예약', status: 'draft', mode: 'scheduled',
        source_label: '예약 시각(요일 지정)', cooldown_s: 0, activation_blocker: null,
      },
    ];
    ipcMain.removeHandler('athena:routines-list');
    ipcMain.handle('athena:routines-list', async () => ({
      ok: true, data: { routines: stage8Routines, disclosure_ready: true, last_error: null },
    }));
    ipcMain.removeHandler('athena:routine-confirm');
    ipcMain.handle('athena:routine-confirm', async (_e, { id } = {}) => {
      const r = stage8Routines.find((x) => x.id === id);
      if (!r) return { ok: false, error: '루틴이 존재하지 않는다' };
      r.status = 'active'; // routines.py confirm_routine과 같은 계약: draft → active
      return { ok: true, data: { ...r } };
    });

    const draftFlowProbe = await shellWin.webContents.executeJavaScript(`(async () => {
      const input = document.getElementById('input');
      if (!input) return { wired: false };
      input.value = '아무 질의나 — 초안 카드 트리거용';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      let done = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 6000) {
        if (document.querySelectorAll('.routine-approval').length >= 3) { done = true; break; }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!done) return { wired: true, cardsAppeared: false };

      const cards = Array.from(document.querySelectorAll('.routine-approval'));
      const cardFor = (title) => cards.find((c) => {
        const t = c.querySelector('.routine-draft-title');
        return t && t.textContent === title;
      });
      const card1 = cardFor('삼성전자 조건 도달 시 감시');
      const card2 = cardFor('SK하이닉스 공시 키워드 감시');
      const card3 = cardFor('평일 아침 브리핑 예약');
      const pills1 = card1 ? Array.from(card1.querySelectorAll('.routine-draft-pill')).map((n) => n.textContent) : [];
      const hint1 = card1 ? (card1.querySelector('.routine-draft-hint') || {}).textContent : null;
      const chipLabels1 = card1 ? Array.from(card1.querySelectorAll('.routine-btn')).map((n) => n.textContent) : [];
      const previewDisabled1 = card1 ? card1.querySelectorAll('.routine-btn')[0].disabled : null;
      // F-stage3 — 예약 draft의 방식 고지 문구(approvalModeLine, 사실11②).
      const desc3 = card3 ? (card3.querySelector('.agent-body') || {}).textContent : null;

      // 카드1 — "고칠 게 있어" 클릭 → 채팅 입력에 문장이 심긴다.
      if (card1) Array.from(card1.querySelectorAll('.routine-btn')).find((b) => b.textContent === '고칠 게 있어').click();
      await new Promise((r) => setTimeout(r, 50));
      const seededValue = input.value;

      // 카드2 — "바로 활성화" 클릭 → 기존 승인 채널이 실제로 불린다.
      let activateStatus = null;
      if (card2) {
        Array.from(card2.querySelectorAll('.routine-btn')).find((b) => b.textContent === '바로 활성화').click();
        await new Promise((r) => setTimeout(r, 300));
        activateStatus = (card2.querySelector('.agent-mode') || {}).textContent;
      }

      return {
        wired: true, cardsAppeared: true, pills1, hint1, chipLabels1, previewDisabled1, seededValue, activateStatus, desc3,
      };
    })()`);
    report.draftFlow = draftFlowProbe;
    assertOk('routine-draft-8: 배선이 있다', draftFlowProbe.wired === true);
    if (draftFlowProbe.wired) {
      assertOk('routine-draft-8: 질의 완료 후 초안 카드 2건이 뜬다(refreshRoutineDrafts)', draftFlowProbe.cardsAppeared === true);
    }
    if (draftFlowProbe.cardsAppeared) {
      assertOk(
        'routine-draft-8: pill이 "작업 요약"·"초안" 2개다',
        JSON.stringify(draftFlowProbe.pills1) === JSON.stringify(['작업 요약', '초안']),
      );
      assertOk('routine-draft-8: 힌트가 "← 캔버스에 초안 생성됨"이다', draftFlowProbe.hint1 === '← 캔버스에 초안 생성됨');
      assertOk(
        'routine-draft-8: 칩 3종(미리보기 실행/바로 활성화/고칠 게 있어)이 있다',
        JSON.stringify(draftFlowProbe.chipLabels1) === JSON.stringify(['미리보기 실행', '바로 활성화', '고칠 게 있어']),
      );
      assertOk('routine-draft-8: "미리보기 실행"은 백엔드가 없어 비활성이다(P3)', draftFlowProbe.previewDisabled1 === true);
      assertOk(
        'routine-draft-8: "고칠 게 있어" 클릭 시 채팅 입력에 문장이 심긴다(시트 없음)',
        draftFlowProbe.seededValue === '"삼성전자 조건 도달 시 감시" 초안을 고쳐줘 — ',
      );
      assertOk(
        'routine-draft-8: "바로 활성화" 클릭이 기존 승인 채널을 실제로 부른다',
        draftFlowProbe.activateStatus === '활성 — 감시가 시작됐습니다',
      );
      assertOk(
        'routine-draft-8/F-stage3: 예약(scheduled) draft 카드가 "방식 예약 실행"으로 뜬다(사실11②)',
        !!draftFlowProbe.desc3 && draftFlowProbe.desc3.includes('방식 예약 실행'),
      );
      assertOk(
        'routine-draft-8/F-stage3: 예약 카드 문구에 "틱 즉시"가 섞이지 않는다(approvalModeLine 3분기 회귀 방지)',
        !!draftFlowProbe.desc3 && !draftFlowProbe.desc3.includes('틱 즉시'),
      );
    }
  } catch (err) {
    report.draftFlow = { error: String((err && err.message) || err) };
    failures.push('routine-draft-8: 검증 블록이 예외로 끝났다');
  } finally {
    ipcMain.removeHandler('athena:routines-list');
    ipcMain.handle('athena:routines-list', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
    ipcMain.removeHandler('athena:routine-confirm');
    ipcMain.handle('athena:routine-confirm', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
    await shellWin.webContents.executeJavaScript(`(() => {
      const input = document.getElementById('input');
      if (input) input.value = '';
    })()`);
  }

  // ---------- 알람 센터 · 라이브 관제 (9단계, Paper 보드 40) ----------
  //
  // 검증17이 이미 routine-fired 1건(vr1)을 보내 notifyRooms에 남아 있을 수
  // 있다 — 정확한 총 개수 대신 "방금 보낸 이벤트가 실제로 알람 행으로 뜨는가"
  // "모두 읽음으로 후 미확인이 0인가"를 상대적으로 잰다(routine-event 주입은
  // 검증17과 같은 경로: shellWin.webContents.send).
  try {
    shellWin.webContents.send('athena:routine-event', {
      type: 'routine-fired',
      routine_id: 'stage9-alarm-1',
      symbol: '000660',
      source: 'price.change_rate',
      mode: 'periodic',
      observed: 123456,
      threshold: 120000,
      note: '9단계 알람 검증',
      fired_at: new Date().toISOString(),
    });
    await wait(300); // sidebar.js handleRoutineEvent가 renderList/updateAgentBadge까지 끝내도록

    const alarmProbe = await shellWin.webContents.executeJavaScript(`(async () => {
      const nav = document.getElementById('modeNavAgent');
      const back = document.getElementById('modeNavSummary');
      const canvas = document.getElementById('agentCanvas');
      if (!nav || !back || !canvas || !window.AthenaAgentCanvas) return { wired: false };
      nav.click();
      await new Promise((r) => setTimeout(r, 600));
      const alertsTabBtn = Array.from(canvas.querySelectorAll('.agent-view-tab')).find((n) => n.textContent.startsWith('알람'));
      if (!alertsTabBtn) return { wired: false };
      const labelBefore = alertsTabBtn.textContent;
      alertsTabBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      const rows = Array.from(canvas.querySelectorAll('.agent-alarm-row'));
      const myRow = rows.find((r) => (r.querySelector('.agent-alarm-title') || {}).textContent === '9단계 알람 검증');
      const myRowUnread = myRow ? myRow.className.includes('is-unread') : null;
      const wsLabel = (canvas.querySelector('.agent-live-ws-label') || {}).textContent;
      const liveRowCount = canvas.querySelectorAll('.agent-live-progress-row').length;
      const timelineRowCount = canvas.querySelectorAll('.agent-live-timeline-row').length;

      canvas.querySelector('.agent-mark-all-read').click();
      await new Promise((r) => setTimeout(r, 100));
      const labelAfterMarkAll = alertsTabBtn.textContent;
      const stillUnreadCount = canvas.querySelectorAll('.agent-alarm-row.is-unread').length;

      const tasksTabBtn = Array.from(canvas.querySelectorAll('.agent-view-tab')).find((n) => n.textContent === '작업');
      if (tasksTabBtn) tasksTabBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      const tasksHeadHiddenAfterReturn = (canvas.querySelector('.agent-tasks-head') || {}).hidden;

      back.click();
      await new Promise((r) => setTimeout(r, 100));
      return {
        wired: true, labelBefore, myRowFound: !!myRow, myRowUnread, wsLabel,
        liveRowCount, timelineRowCount, labelAfterMarkAll, stillUnreadCount, tasksHeadHiddenAfterReturn,
      };
    })()`);
    report.alarmLive = alarmProbe;
    assertOk('agent-canvas-9: 배선이 있다', alarmProbe.wired === true);
    if (alarmProbe.wired) {
      assertOk(
        'agent-canvas-9: 알람 탭 라벨에 미확인 수가 붙는다(예: "알람 N")',
        /^알람 \d+$/.test(alarmProbe.labelBefore),
      );
      assertOk(
        'agent-canvas-9: 방금 보낸 routine-fired가 알람 행으로 뜬다(notifyRooms 승격)',
        alarmProbe.myRowFound === true,
      );
      assertOk('agent-canvas-9: 그 행은 미확인(is-unread)이다', alarmProbe.myRowUnread === true);
      assertOk(
        'agent-canvas-9: 라이브 컬럼 진행바 2건 + 타임라인 4건(fixture)',
        alarmProbe.liveRowCount === 2 && alarmProbe.timelineRowCount === 4,
      );
      assertOk(
        'agent-canvas-9: "WS 연결됨"은 검증 하네스에서 피드가 안 도니 정직하게 "연결 안 됨"이다',
        alarmProbe.wsLabel === 'WS 연결 안 됨',
      );
      assertOk('agent-canvas-9: "모두 읽음으로" 후 탭 라벨이 "알람"이다(배지 0)', alarmProbe.labelAfterMarkAll === '알람');
      assertOk('agent-canvas-9: "모두 읽음으로" 후 미확인 행이 0건이다', alarmProbe.stillUnreadCount === 0);
      assertOk('agent-canvas-9: "작업" 뷰로 돌아오면 작업 머리가 다시 보인다', alarmProbe.tasksHeadHiddenAfterReturn === false);
    }
  } catch (err) {
    report.alarmLive = { error: String((err && err.message) || err) };
    failures.push('agent-canvas-9: 검증 블록이 예외로 끝났다');
  }

  // ---------- 알림 방 재시작 복원 — ack·opened 왕복 (7단계·F-stage5b-FE) ----------
  //
  // 하이드레이션 자체(hydrateNotifyRooms)는 앱 부팅 시 1회만 도는 내부
  // 함수라 이 하네스(단일 프로세스, 이미 부팅된 shellWin 재사용)에선 재부팅
  // 없이 재현할 방법이 없다 — 그 매핑 로직(last_fired_at/unread → read)은
  // agent-sidebar-list.test.js의 buildHydratedRooms 단위 테스트 6건이 이미
  // 전수 커버한다(빈 목록·미발화 제외·unread 반전·정렬·잘못된 날짜 방어).
  // 여기서는 이 단계가 실제로 새로 배선한 부분 — selectNotifyRoom() 클릭 시
  // athena:routine-ack와 athena:routine-engagement(event:'opened', F-stage5b-FE)가
  // 실제로 불리는지 — 를 잰다(사이드바 좌측 "알림에서" 섹션, agent-canvas
  // 알람 컬럼과는 다른 표면).
  try {
    let ackCalledWith = null;
    ipcMain.removeHandler('athena:routine-ack');
    ipcMain.handle('athena:routine-ack', async (_e, { id } = {}) => {
      ackCalledWith = id;
      return { ok: true, data: { id, last_read_fired_at: new Date().toISOString() } };
    });
    let engagementCalls = [];
    ipcMain.removeHandler('athena:routine-engagement');
    ipcMain.handle('athena:routine-engagement', async (_e, { id, event } = {}) => {
      engagementCalls.push({ id, event });
      return { ok: true, data: { ts: new Date().toISOString(), routine_id: id, event } };
    });

    shellWin.webContents.send('athena:routine-event', {
      type: 'routine-fired',
      routine_id: 'stage7-notify-1',
      symbol: '005930',
      source: 'price.change_rate',
      mode: 'periodic',
      observed: 88100,
      threshold: 88000,
      note: '7단계 알림 방 ack 검증',
      fired_at: new Date().toISOString(),
    });
    await wait(300); // handleRoutineEvent의 renderList/updateAgentBadge까지.

    const ackProbe = await shellWin.webContents.executeJavaScript(`(async () => {
      const list = document.getElementById('sidebarList');
      if (!list) return { wired: false };
      const row = Array.from(list.querySelectorAll('.sidebar-item.is-notify')).find(
        (n) => (n.querySelector('.sidebar-item-label') || {}).textContent === '7단계 알림 방 ack 검증',
      );
      if (!row) return { wired: false, reason: 'no-notify-row' };
      const unreadDotBefore = !!row.querySelector('.sidebar-item-dot');
      row.click();
      await new Promise((r) => setTimeout(r, 200));
      const afterRow = Array.from(list.querySelectorAll('.sidebar-item.is-notify')).find(
        (n) => (n.querySelector('.sidebar-item-label') || {}).textContent === '7단계 알림 방 ack 검증',
      );
      const unreadDotAfter = afterRow ? !!afterRow.querySelector('.sidebar-item-dot') : null;
      const bannerHidden = (document.getElementById('roomHeadBanner') || {}).hidden;
      return { wired: true, unreadDotBefore, unreadDotAfter, bannerHidden };
    })()`);
    report.notifyAck = { ...ackProbe, ackCalledWith, engagementCalls };
    assertOk('sidebar-notify-7: 배선이 있다', ackProbe.wired === true);
    if (ackProbe.wired) {
      assertOk('sidebar-notify-7: 클릭 전엔 미확인 점이 있다', ackProbe.unreadDotBefore === true);
      assertOk('sidebar-notify-7: 클릭 후 즉시 미확인 점이 사라진다(화면 반영은 ack 왕복을 기다리지 않는다)', ackProbe.unreadDotAfter === false);
      assertOk('sidebar-notify-7: 배너가 뜬다(기존 selectNotifyRoom 동작 유지)', ackProbe.bannerHidden === false);
      assertOk('sidebar-notify-7: 클릭이 실제로 athena:routine-ack를 그 라우틴 id로 부른다(6단계 read-marks 왕복)', ackCalledWith === 'stage7-notify-1');
      assertOk(
        'sidebar-notify-7/F-stage5b-FE: 미확인 방을 처음 클릭하면 athena:routine-engagement(opened)를 그 라우틴 id로 부른다',
        JSON.stringify(engagementCalls) === JSON.stringify([{ id: 'stage7-notify-1', event: 'opened' }]),
      );
    }
  } catch (err) {
    report.notifyAck = { error: String((err && err.message) || err) };
    failures.push('sidebar-notify-7: 검증 블록이 예외로 끝났다');
  } finally {
    ipcMain.removeHandler('athena:routine-ack');
    ipcMain.handle('athena:routine-ack', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
    ipcMain.removeHandler('athena:routine-engagement');
    ipcMain.handle('athena:routine-engagement', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
  }

  // ---------- "이어진 대화" 계측 — replied 왕복 (F-stage5b-FE) ----------
  //
  // 능동 턴(routine-fired) 직후 사용자가 처음 보내는 질의만 replied로
  // 기록한다(chat.js maybeRecordReplied, 시간 창 판정은 프론트 몫 —
  // engagement.py 계약). athena__render_canvas는 이 하네스의 다른 모든
  // 블록이 공유하는 핵심 채널이라 손대지 않는다 — 실제 질의 왕복이 어떻게
  // 응답하든 무관하게, maybeRecordReplied()는 runQuery() 진입 시점에
  // 이미 불린다(네트워크 응답을 기다리지 않는다).
  try {
    let engagementCalls = [];
    ipcMain.removeHandler('athena:routine-engagement');
    ipcMain.handle('athena:routine-engagement', async (_e, { id, event } = {}) => {
      engagementCalls.push({ id, event });
      return { ok: true, data: { ts: new Date().toISOString(), routine_id: id, event } };
    });

    shellWin.webContents.send('athena:routine-event', {
      type: 'routine-fired',
      routine_id: 'stage5b-replied-1',
      symbol: '005930',
      source: 'price.change_rate',
      mode: 'periodic',
      observed: 88100,
      threshold: 88000,
      note: 'F-stage5b 이어진 대화 검증',
      fired_at: new Date().toISOString(),
    });
    await wait(200); // renderAgentTurn이 lastFiredRoutine을 채울 때까지.

    const repliedProbe = await shellWin.webContents.executeJavaScript(`(async () => {
      const input = document.getElementById('input');
      if (!input) return { wired: false };
      input.value = 'F-stage5b 이어진 대화 검증 질의';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return { wired: true };
    })()`);
    await wait(200); // maybeRecordReplied()는 동기적으로 곧바로 불린다 — IPC 왕복만 기다린다.
    report.repliedEngagement = { ...repliedProbe, engagementCalls };
    assertOk('replied-5b: 배선이 있다', repliedProbe.wired === true);
    if (repliedProbe.wired) {
      assertOk(
        'replied-5b: 능동 턴 직후 첫 질의가 athena:routine-engagement(replied)를 그 라우틴 id로 부른다',
        JSON.stringify(engagementCalls) === JSON.stringify([{ id: 'stage5b-replied-1', event: 'replied' }]),
      );
    }
  } catch (err) {
    report.repliedEngagement = { error: String((err && err.message) || err) };
    failures.push('replied-5b: 검증 블록이 예외로 끝났다');
  } finally {
    ipcMain.removeHandler('athena:routine-engagement');
    ipcMain.handle('athena:routine-engagement', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
    await shellWin.webContents.executeJavaScript(`(() => {
      const input = document.getElementById('input');
      if (input) input.value = '';
    })()`);
  }

  // ---------- 실행 이력 · 결과 드릴인 (10단계, Paper 보드 41) ----------
  //
  // athena:routines-list(감시 1건)와 athena:routine-runs(6단계 ledger 조회)를
  // stateful fixture로 바꿔 "전체 이력 보기 →" → 브레드크럼 → 최근 30회 → 통계
  // → "작업 ›" 복귀까지 왕복시킨다. verdict 3종(fired/near/suppressed) 아이콘만
  // 쓰는지, 최신순 정렬인지를 확인한다(AC10). athena:routine-runs 응답에
  // F-stage5(F2-FE)가 avg_duration_ms도 함께 태워, "30회 통계"의 "평균"
  // 타일이 라이브로 붙었는지도 같은 왕복에서 잰다.
  try {
    const stage10Routines = [
      {
        id: 'fx-hist-1', symbol: '005930', note: '삼성전자 88,000 감시', status: 'active', mode: 'realtime-ws',
        source_label: '현재가', cooldown_s: 300,
      },
    ];
    const stage10Runs = [
      { ts: '2026-08-25T07:30:00Z', routine_id: 'fx-hist-1', symbol: '005930', source: 'price.change_rate', verdict: 'near', observed: 87900, threshold: 88000, reason: '근접 — 임계 미달' },
      { ts: '2026-08-26T07:30:00Z', routine_id: 'fx-hist-1', symbol: '005930', source: 'price.change_rate', verdict: 'fired', observed: 88100, threshold: 88000, reason: '조건 도달' },
      { ts: '2026-08-24T07:30:00Z', routine_id: 'fx-hist-1', symbol: '005930', source: 'price.change_rate', verdict: 'suppressed', observed: 88100, threshold: 88000, reason: '쿨다운 중' },
      // [6단계] 오늘자 브리핑 산출물 행 — 3단계 briefings 병합 필드
      // (briefing_title/content/truncated/destination)로 41번 카드가 실데이터로
      // 뜨는지 같은 왕복에서 잰다. ts는 부팅 시각(오늘)이어야 카드가 렌더된다.
      {
        ts: new Date().toISOString(), routine_id: 'fx-hist-1', symbol: '005930',
        source: 'schedule.daily', verdict: 'fired', observed: '07:30', threshold: 'ALL@07:30',
        reason: '예약 시각 도달(07:30)', briefing_title: '아침 브리핑 검증',
        briefing_content: '오늘의 요약 본문(검증)', truncated: false, briefing_destination: 'canvas',
      },
    ];
    ipcMain.removeHandler('athena:routines-list');
    ipcMain.handle('athena:routines-list', async () => ({
      ok: true, data: { routines: stage10Routines, disclosure_ready: true, last_error: null },
    }));
    ipcMain.removeHandler('athena:routine-runs');
    ipcMain.handle('athena:routine-runs', async (_e, { id } = {}) => ({
      // avg_duration_ms(5단계, F2-FE) — runs 배열과 별개 필드다. 실제 값은
      // 4단계 백엔드가 최근 30건 non-null duration_ms 평균으로 계산하지만
      // (그쪽 pytest가 이미 검증), 이 하네스는 프론트 배선만 재확인하면
      // 되므로 확정 값을 직접 준다. opened_rate·replied_count(F-stage5b-BE)도
      // 같은 이유로 확정 값.
      ok: true,
      data: {
        runs: stage10Runs.filter((r) => r.routine_id === id),
        avg_duration_ms: 7420, opened_rate: 0.71, replied_count: 9,
      },
    }));

    const historyProbe = await shellWin.webContents.executeJavaScript(`(async () => {
      const nav = document.getElementById('modeNavAgent');
      const back = document.getElementById('modeNavSummary');
      const canvas = document.getElementById('agentCanvas');
      if (!nav || !back || !canvas || !window.AthenaAgentCanvas) return { wired: false };
      nav.click();
      await new Promise((r) => setTimeout(r, 600));
      const allTabBtn = Array.from(canvas.querySelectorAll('.agent-tab')).find((n) => n.textContent === '모두');
      if (allTabBtn) allTabBtn.click();
      window.AthenaAgentCanvas.selectRow('fx-hist-1');
      await new Promise((r) => setTimeout(r, 100));
      const openBtn = canvas.querySelector('.agent-history-open');
      if (!openBtn) return { wired: false, reason: 'no-open-btn' };
      openBtn.click();
      await new Promise((r) => setTimeout(r, 300));
      const breadcrumbVisible = !canvas.querySelector('.agent-breadcrumb').hidden;
      const breadcrumbTitle = (canvas.querySelector('.agent-breadcrumb-title') || {}).textContent;
      const breadcrumbBadge = (canvas.querySelector('.agent-breadcrumb-badge') || {}).textContent;
      const tasksHeadHidden = (canvas.querySelector('.agent-tasks-head') || {}).hidden;
      const runRows = Array.from(canvas.querySelectorAll('.agent-history-run'));
      const reasons = runRows.map((r) => (r.querySelector('.agent-history-run-reason') || {}).textContent);
      const marks = runRows.map((r) => (r.querySelector('.agent-history-run-mark') || {}).textContent);
      const statTiles = Array.from(canvas.querySelectorAll('.agent-history-stat-tile'));
      const statTileCount = statTiles.length;
      // 5단계(F2-FE) — "평균"만 live, 나머지 3장은 fixture다(컬럼 전체가
      // 아니라 타일 각각에 data-source가 실린다).
      const tileByLabel = (label) => statTiles.find((t) => (t.querySelector('.agent-history-stat-label') || {}).textContent === label);
      const tileValue = (label) => { const t = tileByLabel(label); return t ? (t.querySelector('.agent-history-stat-value') || {}).textContent : null; };
      const avgTile = tileByLabel('평균');
      const avgTileSource = avgTile ? avgTile.getAttribute('data-source') : null;
      const avgTileValue = tileValue('평균');
      // F-stage5b-FE — "발화→열람"·"이어진 대화"도 이제 live다.
      const openedRateValue = tileValue('발화→열람');
      const repliedCountValue = tileValue('이어진 대화');
      const fixtureTileCount = statTiles.filter((t) => t.getAttribute('data-source') === 'fixture').length;

      // "오늘 산출물" 카드(6단계부터 실데이터) — stage10Runs의 오늘자 브리핑
      // 행(briefing_* 병합 필드)이 재료다. fixture 시절 표기는 제거됐다.
      const outputCard = canvas.querySelector('.agent-history-output-card');
      const outputSource = outputCard ? outputCard.getAttribute('data-source') : null;
      const outputTitle = (canvas.querySelector('.agent-history-output-title') || {}).textContent;
      const outputTag = (canvas.querySelector('.agent-history-output-tag') || {}).textContent;
      const outputItemCount = canvas.querySelectorAll('.agent-history-output-item-text').length;
      const outputBtns = Array.from(canvas.querySelectorAll('.agent-history-output-btn'));
      const outputBtnLabels = outputBtns.map((n) => n.textContent);
      const outputBtnsAllDisabled = outputBtns.length > 0 && outputBtns.every((n) => n.disabled === true);

      canvas.querySelector('.agent-breadcrumb-back').click();
      await new Promise((r) => setTimeout(r, 100));
      const breadcrumbHiddenAfterBack = canvas.querySelector('.agent-breadcrumb').hidden;
      const tasksHeadVisibleAfterBack = !canvas.querySelector('.agent-tasks-head').hidden;

      back.click();
      await new Promise((r) => setTimeout(r, 100));
      return {
        wired: true, breadcrumbVisible, breadcrumbTitle, breadcrumbBadge, tasksHeadHidden,
        reasons, marks, statTileCount, avgTileSource, avgTileValue, fixtureTileCount,
        openedRateValue, repliedCountValue,
        breadcrumbHiddenAfterBack, tasksHeadVisibleAfterBack,
        outputSource, outputTitle, outputTag, outputItemCount, outputBtnLabels, outputBtnsAllDisabled,
      };
    })()`);
    report.historyDrillIn = historyProbe;
    assertOk('agent-canvas-10: 배선이 있다', historyProbe.wired === true);
    if (historyProbe.wired) {
      assertOk('agent-canvas-10: 브레드크럼이 뜬다("작업 › 이름")', historyProbe.breadcrumbVisible === true);
      assertOk('agent-canvas-10: 브레드크럼 제목이 실제 routine note다', historyProbe.breadcrumbTitle === '삼성전자 88,000 감시');
      assertOk('agent-canvas-10: 브레드크럼 상태 배지가 "활성"이다', historyProbe.breadcrumbBadge === '활성');
      assertOk('agent-canvas-10: 드릴인 진입 시 "작업" 머리가 숨는다', historyProbe.tasksHeadHidden === true);
      assertOk(
        // [6단계] 오늘자 브리핑 발화 행이 앞에 추가돼 4행이 됐다(최신순 유지).
        'agent-canvas-10: 최근 30회가 GET /{id}/runs 실데이터로 최신순 정렬된다',
        JSON.stringify(historyProbe.reasons)
          === JSON.stringify(['예약 시각 도달(07:30)', '조건 도달', '근접 — 임계 미달', '쿨다운 중']),
      );
      assertOk(
        'agent-canvas-10: 상태 아이콘이 ledger 실제 verdict 3종만 쓴다(fired=●·near=◐·suppressed=○, AC10)',
        JSON.stringify(historyProbe.marks) === JSON.stringify(['●', '●', '◐', '○']),
      );
      assertOk(
        // F-stage5b-FE — "발화→열람"·"이어진 대화"도 라이브로 승격됐다.
        // R2(3차 라운드, agent-mode-round3-plan.md 1단계)에서 지표 정의가
        // 끝내 확정되지 않은 타일 1개를 걷어내 3타일 전부 live가 됐다.
        'agent-canvas-10: 30회 통계 3타일 — 전부 live다(평균·발화→열람·이어진 대화, F-stage5b-FE·R2)',
        historyProbe.statTileCount === 3 && historyProbe.avgTileSource === 'live'
          && historyProbe.avgTileValue === '7.4s' && historyProbe.fixtureTileCount === 0
          && historyProbe.openedRateValue === '71%' && historyProbe.repliedCountValue === '9건',
      );
      // [6단계 의도적 반전] 이전 단언은 "카드가 fixture로 뜬다"였다 — 3단계
      // briefings 스토어의 실데이터로 승격되면서 data-source=live·실제 본문·
      // 단일 본문 블록(항목 1개)이 정답이 됐다(AC7).
      assertOk(
        'agent-canvas-10: "오늘 산출물" 카드가 실데이터(live)로 뜬다(6단계, fixture 제거)',
        historyProbe.outputSource === 'live' && historyProbe.outputTitle === '아침 브리핑 검증',
      );
      assertOk('agent-canvas-10: 산출물 카드 태그가 destination 기반 "캔버스 카드"다', historyProbe.outputTag === '캔버스 카드');
      assertOk('agent-canvas-10: 산출물 본문은 단일 텍스트 블록이다(지어낸 items 구조 아님)', historyProbe.outputItemCount === 1);
      assertOk(
        'agent-canvas-10: 산출물 카드 버튼이 "캔버스에서 열기"·"채팅으로"이고 재기동 후 복원 불가라 둘 다 비활성이다(P3)',
        JSON.stringify(historyProbe.outputBtnLabels) === JSON.stringify(['캔버스에서 열기', '채팅으로'])
          && historyProbe.outputBtnsAllDisabled === true,
      );
      assertOk('agent-canvas-10: "작업 ›" 클릭 시 브레드크럼이 숨는다', historyProbe.breadcrumbHiddenAfterBack === true);
      assertOk('agent-canvas-10: "작업 ›" 클릭 시 "작업" 머리가 복원된다', historyProbe.tasksHeadVisibleAfterBack === true);
    }
  } catch (err) {
    report.historyDrillIn = { error: String((err && err.message) || err) };
    failures.push('agent-canvas-10: 검증 블록이 예외로 끝났다');
  } finally {
    ipcMain.removeHandler('athena:routines-list');
    ipcMain.handle('athena:routines-list', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
    ipcMain.removeHandler('athena:routine-runs');
    ipcMain.handle('athena:routine-runs', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
  }

  // ---------- 39번 상세 패널 "채팅에서 열기 ↗" (F-fix1, 본편 이월 갭) ----------
  //
  // 알림 방이 있으면 sidebar-notify-7과 같은 selectNotifyRoom 경로(배너 표시
  // +ack·opened 계측)를 타는지, 없으면 채팅 입력 포커스로 폴백하는지(죽은
  // 버튼 아님, P3) 둘 다 잰다.
  try {
    let ackCalledWith = null;
    let engagementCalls = [];
    ipcMain.removeHandler('athena:routine-ack');
    ipcMain.handle('athena:routine-ack', async (_e, { id } = {}) => { ackCalledWith = id; return { ok: true, data: {} }; });
    ipcMain.removeHandler('athena:routine-engagement');
    ipcMain.handle('athena:routine-engagement', async (_e, { id, event } = {}) => {
      engagementCalls.push({ id, event });
      return { ok: true, data: {} };
    });
    ipcMain.removeHandler('athena:routines-list');
    ipcMain.handle('athena:routines-list', async () => ({
      ok: true,
      data: {
        routines: [{
          id: 'fx-openchat-1', symbol: '005930', note: 'F-fix1 열기 검증', status: 'active', mode: 'realtime-ws',
          source_label: '현재가', cooldown_s: 300,
        }],
        disclosure_ready: true, last_error: null,
      },
    }));
    // fx-openchat-1의 알림 방을 먼저 만든다(sidebar-notify-7과 같은 주입 경로).
    shellWin.webContents.send('athena:routine-event', {
      type: 'routine-fired', routine_id: 'fx-openchat-1', symbol: '005930', source: 'price.change_rate', mode: 'realtime-ws',
      observed: 88100, threshold: 88000, note: 'F-fix1 열기 검증', fired_at: new Date().toISOString(),
    });
    await wait(300);

    const openChatProbe = await shellWin.webContents.executeJavaScript(`(async () => {
      const nav = document.getElementById('modeNavAgent');
      const back = document.getElementById('modeNavSummary');
      const canvas = document.getElementById('agentCanvas');
      if (!nav || !back || !canvas || !window.AthenaAgentCanvas) return { wired: false };
      nav.click();
      await new Promise((r) => setTimeout(r, 600));
      const allTabBtn = Array.from(canvas.querySelectorAll('.agent-tab')).find((n) => n.textContent === '모두');
      if (allTabBtn) allTabBtn.click();
      window.AthenaAgentCanvas.selectRow('fx-openchat-1');
      await new Promise((r) => setTimeout(r, 100));
      const caption = (canvas.querySelector('.agent-detail-open-chat-caption') || {}).textContent;
      const btn = canvas.querySelector('.agent-detail-open-chat-btn');
      if (!btn) return { wired: false, reason: 'no-btn' };
      const btnLabel = btn.textContent;
      btn.click();
      await new Promise((r) => setTimeout(r, 200));
      const bannerHidden = (document.getElementById('roomHeadBanner') || {}).hidden;
      const roomTitle = (document.getElementById('roomHeadTitle') || {}).textContent;
      back.click();
      await new Promise((r) => setTimeout(r, 100));
      return { wired: true, caption, btnLabel, bannerHidden, roomTitle };
    })()`);
    report.openInChat = { ...openChatProbe, ackCalledWith, engagementCalls };
    assertOk('open-in-chat-Ffix1: 배선이 있다', openChatProbe.wired === true);
    if (openChatProbe.wired) {
      assertOk('open-in-chat-Ffix1: 각주가 "루틴 발화 — 묻지 않은 턴입니다"다(Paper 39 실측)', openChatProbe.caption === '루틴 발화 — 묻지 않은 턴입니다');
      assertOk('open-in-chat-Ffix1: 버튼 문구가 "채팅에서 열기 ↗"다', openChatProbe.btnLabel === '채팅에서 열기 ↗');
      assertOk('open-in-chat-Ffix1: 알림 방이 있으면 배너가 뜬다(selectNotifyRoom 경로 재사용)', openChatProbe.bannerHidden === false);
      assertOk('open-in-chat-Ffix1: 배너 제목이 그 라우틴 note다', openChatProbe.roomTitle === 'F-fix1 열기 검증');
      assertOk('open-in-chat-Ffix1: ack가 그 라우틴 id로 불린다(6단계 read-marks 경로 자동 정합)', ackCalledWith === 'fx-openchat-1');
      assertOk(
        'open-in-chat-Ffix1: opened 계측이 그 라우틴 id로 불린다(F-stage5b-FE 경로 자동 정합)',
        JSON.stringify(engagementCalls) === JSON.stringify([{ id: 'fx-openchat-1', event: 'opened' }]),
      );
    }
  } catch (err) {
    report.openInChat = { error: String((err && err.message) || err) };
    failures.push('open-in-chat-Ffix1: 검증 블록이 예외로 끝났다');
  } finally {
    ipcMain.removeHandler('athena:routine-ack');
    ipcMain.handle('athena:routine-ack', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
    ipcMain.removeHandler('athena:routine-engagement');
    ipcMain.handle('athena:routine-engagement', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
    ipcMain.removeHandler('athena:routines-list');
    ipcMain.handle('athena:routines-list', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
  }

  // ---------- "채팅에서 열기 ↗" 폴백 — 알림 방이 없는 라우틴 (F-fix1) ----------
  //
  // 이 세션에서 아직 발화한 적 없는(routine-fired를 한 번도 안 보낸) 라우틴은
  // window.AthenaNotify.selectRoom이 false를 돌려줘 채팅 입력 포커스로
  // 폴백해야 한다 — 죽은 버튼을 만들지 않는다(P3). 포커스 자체(document.
  // activeElement)는 이 하네스의 창 OS 포커스 상태에 좌우될 수 있어 대신
  // seedChatInput(text 없음)의 부작용(입력값을 비운다)으로 폴백 경로가 실제로
  // 탔는지를 잰다 — chat.js의 registerSeedChatInput 구현 참고.
  try {
    ipcMain.removeHandler('athena:routines-list');
    ipcMain.handle('athena:routines-list', async () => ({
      ok: true,
      data: {
        routines: [{
          id: 'fx-openchat-2', symbol: '000660', note: 'F-fix1 폴백 검증', status: 'active', mode: 'periodic',
          source_label: '공시 제목 키워드', cooldown_s: 600,
        }],
        disclosure_ready: true, last_error: null,
      },
    }));

    const fallbackProbe = await shellWin.webContents.executeJavaScript(`(async () => {
      const nav = document.getElementById('modeNavAgent');
      const back = document.getElementById('modeNavSummary');
      const canvas = document.getElementById('agentCanvas');
      const input = document.getElementById('input');
      if (!nav || !back || !canvas || !input || !window.AthenaAgentCanvas) return { wired: false };
      nav.click();
      await new Promise((r) => setTimeout(r, 600));
      const allTabBtn = Array.from(canvas.querySelectorAll('.agent-tab')).find((n) => n.textContent === '모두');
      if (allTabBtn) allTabBtn.click();
      window.AthenaAgentCanvas.selectRow('fx-openchat-2');
      await new Promise((r) => setTimeout(r, 100));
      const btn = canvas.querySelector('.agent-detail-open-chat-btn');
      if (!btn) return { wired: false, reason: 'no-btn' };
      input.value = '이전에 입력해둔 문장';
      btn.click();
      await new Promise((r) => setTimeout(r, 100));
      const inputValueAfter = input.value;
      back.click();
      await new Promise((r) => setTimeout(r, 100));
      return { wired: true, inputValueAfter };
    })()`);
    report.openInChatFallback = fallbackProbe;
    assertOk('open-in-chat-fallback-Ffix1: 배선이 있다', fallbackProbe.wired === true);
    if (fallbackProbe.wired) {
      assertOk(
        'open-in-chat-fallback-Ffix1: 알림 방이 없으면 seedChatInput(빈 값)이 불려 입력이 비워진다(폴백 경로 확인, P3)',
        fallbackProbe.inputValueAfter === '',
      );
    }
  } catch (err) {
    report.openInChatFallback = { error: String((err && err.message) || err) };
    failures.push('open-in-chat-fallback-Ffix1: 검증 블록이 예외로 끝났다');
  } finally {
    ipcMain.removeHandler('athena:routines-list');
    ipcMain.handle('athena:routines-list', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
    await shellWin.webContents.executeJavaScript(`(() => {
      const input = document.getElementById('input');
      if (input) input.value = '';
    })()`);
  }

  // ---------- 프로액티브 + 말걸기 가드 (11단계, Paper 보드 42) ----------
  //
  // athena:brain-profile-summary를 stateful fixture로 바꿔(7단계와 같은 채널)
  // "지금 읽히는 성향" 스트립·제안 카드·"그래프 모드에서 근거 보기 →"·
  // 말걸기 가드까지 왕복시킨다. "그래프 모드에서 근거 보기 →"가 실제로
  // 사이드바 모드 네비(#modeNavGraph)의 활성 표시까지 같이 바꾸는지 확인한다
  // (캔버스만 바뀌고 네비가 안 바뀌는 불일치가 이 배선의 실패 형태다).
  try {
    ipcMain.removeHandler('athena:routines-list');
    ipcMain.handle('athena:routines-list', async () => ({
      ok: true, data: { routines: [], disclosure_ready: true, last_error: null },
    }));
    ipcMain.removeHandler('athena:brain-profile-summary');
    ipcMain.handle('athena:brain-profile-summary', async () => ({
      ok: true,
      entries: [
        {
          entity_id: 'e1', entity_kind: 'stock', entity_name: '삼성전자', relation_kind: '단기 회전',
          confidence: 'EXTRACTED', tier: 'deterministic', rationale: '매매일마다 정리가 필요해 보여요',
          observed_at: '2026-08-26T00:00:00Z', reinforcement: 21,
        },
        {
          entity_id: 'e2', entity_kind: 'theme', entity_name: '배당 방어 바스켓', relation_kind: '응집 상승',
          confidence: 'INFERRED', tier: 'conversational', rationale: null,
          observed_at: '2026-08-25T00:00:00Z', reinforcement: 6,
        },
      ],
    }));
    // F-stage9 — 8단계 백엔드 GET /api/v1/nudge-guard와 같은 응답 계약.
    ipcMain.removeHandler('athena:nudge-guard-get');
    ipcMain.handle('athena:nudge-guard-get', async () => ({
      ok: true,
      data: {
        max_daily_nudges: 2, quiet_hours: { start: '22:00', end: '07:00' },
        show_rationale: true, learn_from_dismissals: true,
      },
    }));

    const proactiveProbe = await shellWin.webContents.executeJavaScript(`(async () => {
      const nav = document.getElementById('modeNavAgent');
      const back = document.getElementById('modeNavSummary');
      const graphNavItem = document.getElementById('modeNavGraph');
      const canvas = document.getElementById('agentCanvas');
      if (!nav || !back || !graphNavItem || !canvas) return { wired: false };
      nav.click();
      await new Promise((r) => setTimeout(r, 600));
      const proactiveTabBtn = Array.from(canvas.querySelectorAll('.agent-view-tab')).find((n) => n.textContent.startsWith('제안'));
      if (!proactiveTabBtn) return { wired: false, reason: 'no-proactive-tab' };
      const tabLabelBefore = proactiveTabBtn.textContent;
      proactiveTabBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      const stripValue = (canvas.querySelector('.agent-proactive-strip-value') || {}).textContent;
      const stripSub = (canvas.querySelector('.agent-proactive-strip-sub') || {}).textContent;
      const cardCount = canvas.querySelectorAll('.agent-proactive-card').length;
      const chipLabels = Array.from(canvas.querySelectorAll('.agent-proactive-chip')).slice(0, 2).map((n) => n.textContent);
      const guardTagCount = canvas.querySelectorAll('.agent-nudge-guard-tag').length;
      const guardSource = (canvas.querySelector('.agent-nudge-guard') || {}).getAttribute('data-source');
      const guardTagLabels = Array.from(canvas.querySelectorAll('.agent-nudge-guard-tag')).map((n) => n.textContent);

      // "보류" — 두 번째 카드의 보류 칩(각 카드 칩 배열의 인덱스 1).
      const secondCardChips = canvas.querySelectorAll('.agent-proactive-card')[1].querySelectorAll('.agent-proactive-chip');
      secondCardChips[1].click();
      await new Promise((r) => setTimeout(r, 50));
      const cardCountAfterHold = canvas.querySelectorAll('.agent-proactive-card').length;
      const tabLabelAfterHold = proactiveTabBtn.textContent;

      // "그래프 모드에서 근거 보기 →"
      const graphLinkHiddenBefore = canvas.querySelector('.agent-graph-link').hidden;
      canvas.querySelector('.agent-graph-link').click();
      await new Promise((r) => setTimeout(r, 200));
      // 그래프 진입의 가시 신호는 서브뷰 무관 "그래프 표면"이다(스텝2-보정 —
      // 기본 서브뷰가 요약 표라 #graphCanvas는 지도 전환 전까지 숨어 있다).
      const graphCanvasVisible = !document.getElementById('graphSummaryTable').hidden
        || !document.getElementById('graphCanvas').hidden;
      const graphNavActive = graphNavItem.className.includes('is-active');

      back.click();
      await new Promise((r) => setTimeout(r, 100));
      return {
        wired: true, tabLabelBefore, stripValue, stripSub, cardCount, chipLabels,
        guardTagCount, guardSource, guardTagLabels, cardCountAfterHold, tabLabelAfterHold,
        graphLinkHiddenBefore, graphCanvasVisible, graphNavActive,
      };
    })()`);
    report.proactive = proactiveProbe;
    // 에이전트 캔버스 픽셀 증거(2026-08-28 화면 평가 관찰4) — 프로브는 DOM 질의라
    // 화면 전환을 보장하지 않는다. 90b와 같은 패턴으로 네비를 실제로 눌러 찍고
    // 대화 뷰로 되돌린다(이후 검증의 전제 상태 불변).
    await shellWin.webContents.executeJavaScript(
      "document.getElementById('modeNavAgent').click()"
    );
    await wait(400);
    report.proactive.shot = await shot(shellWin, '91-agent-canvas.png');
    await shellWin.webContents.executeJavaScript(
      "document.getElementById('modeNavSummary').click()"
    );
    assertOk('agent-canvas-11: 배선이 있다', proactiveProbe.wired === true);
    if (proactiveProbe.wired) {
      assertOk('agent-canvas-11: 제안 탭 라벨이 개수를 담고 있다("제안 2")', proactiveProbe.tabLabelBefore === '제안 2');
      assertOk(
        'agent-canvas-11: "지금 읽히는 성향" 스트립이 실제 relation_kind를 합친다',
        proactiveProbe.stripValue === '단기 회전 · 응집 상승',
      );
      assertOk('agent-canvas-11: 스트립 부제가 신호 건수다', proactiveProbe.stripSub === '신호 2건');
      assertOk('agent-canvas-11: 제안 카드 2장이 뜬다', proactiveProbe.cardCount === 2);
      assertOk(
        'agent-canvas-11: 칩이 "루틴으로"·"보류"다',
        JSON.stringify(proactiveProbe.chipLabels) === JSON.stringify(['루틴으로', '보류']),
      );
      assertOk(
        'agent-canvas-11: 말걸기 가드 태그 4개가 GET /api/v1/nudge-guard 라이브 값으로 뜬다(F-stage9)',
        proactiveProbe.guardTagCount === 4 && proactiveProbe.guardSource === 'live'
          && JSON.stringify(proactiveProbe.guardTagLabels)
            === JSON.stringify(['하루 최대 2회', '조용 시간 22:00–07:00', '근거 표시 항상', '거절 반영 성향으로 학습']),
      );
      assertOk('agent-canvas-11: "보류" 클릭 후 카드가 1장으로 준다(세션 한정)', proactiveProbe.cardCountAfterHold === 1);
      assertOk('agent-canvas-11: "보류" 후 탭 라벨도 "제안 1"로 준다', proactiveProbe.tabLabelAfterHold === '제안 1');
      assertOk('agent-canvas-11: "그래프 모드에서 근거 보기 →"가 "제안" 뷰에서만 보인다', proactiveProbe.graphLinkHiddenBefore === false);
      assertOk('agent-canvas-11: 클릭 시 실제로 그래프 표면이 열린다', proactiveProbe.graphCanvasVisible === true);
      assertOk(
        'agent-canvas-11: 사이드바 모드 네비의 활성 표시도 "그래프"로 같이 바뀐다(캔버스만 바뀌는 불일치 없음)',
        proactiveProbe.graphNavActive === true,
      );
    }
  } catch (err) {
    report.proactive = { error: String((err && err.message) || err) };
    failures.push('agent-canvas-11: 검증 블록이 예외로 끝났다');
  } finally {
    ipcMain.removeHandler('athena:routines-list');
    ipcMain.handle('athena:routines-list', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
    ipcMain.removeHandler('athena:brain-profile-summary');
    ipcMain.handle('athena:brain-profile-summary', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
    ipcMain.removeHandler('athena:nudge-guard-get');
    ipcMain.handle('athena:nudge-guard-get', async () => ({ ok: false, status: 0, error: '백엔드 미기동(검증 하네스)' }));
    // 그래프 모드로 남아 있으면 다음 실행(재실행 시)에 영향을 줄 수 있다 — 답변 모드로 되돌린다.
    await shellWin.webContents.executeJavaScript(`(() => {
      if (window.AthenaCanvasMode && window.AthenaCanvasMode.state && window.AthenaCanvasMode.state.view !== 'summary') {
        window.AthenaCanvasMode.setView('summary');
      }
      const summaryNavItem = document.getElementById('modeNavSummary');
      if (window.AthenaModeNav && summaryNavItem) window.AthenaModeNav.setActive('summary');
    })()`);
  }

  // ---------- 검증 R1-4: 예약 자동 브리핑 러너 (2026-08-27, 4단계 AC3) ----------
  // handleRoutineFeedEvent를 module.exports의 실제 함수 참조로 직접 호출해
  // (Rev.3 MODERATE 4 — WS 서버·fixture 게이트와 무관) 스텁 claudeRunner의 호출
  // 카운트로 실행을 단언한다 — DOM 렌더만으로 통과 처리하지 않는다. 백엔드
  // 왕복(budget/report)도 스텁으로 바꿔 실백엔드 유무와 무관하게 결정론이다.
  try {
    const briefingRunnerMod = require('./lib/main/briefing-runner');
    const sessionBefore = mainMod.getLiveSessionId();
    let briefingStubCalls = 0;
    let briefingKilled = false;
    let briefingResolve = null;
    const briefingReports = [];
    mainMod.setBriefingClaudeRunnerForVerify({
      runClaudeQuery(opts) {
        briefingStubCalls += 1;
        opts.onSpawn({
          pid: 424242,
          kill: () => {
            briefingKilled = true;
            if (briefingResolve) briefingResolve({ ok: false, aborted: true });
          },
        });
        opts.onTextDelta('검증 브리핑 본문');
        return new Promise((resolve) => { briefingResolve = resolve; });
      },
    }, {
      fetchBudget: async () => ({ remaining: 99 }),
      reportResult: async (p) => { briefingReports.push(p); },
    });
    const briefFiredAt = new Date().toISOString();
    const briefEvent = {
      type: 'routine-fired', routine_id: 'vbrief1', symbol: '005930',
      source: 'schedule.daily', mode: 'scheduled', observed: '07:30',
      threshold: 'ALL@07:30', note: '브리핑 검증 루틴', fired_at: briefFiredAt,
      briefing_model: null, briefing_effort: null,
    };
    mainMod.handleRoutineFeedEvent(briefEvent);
    await wait(300);
    report.briefingRunner = {
      stubCallsAfterFire: briefingStubCalls,
      busyDepthDuring: mainMod.getBriefingBusyDepth(),
      inputDisabledDuring: await shellWin.webContents.executeJavaScript(
        "document.getElementById('input').disabled"
      ),
      cardBadgeDuring: await shellWin.webContents.executeJavaScript(`(() => {
        const b = document.querySelector('.turn-agent.agent-briefing .agent-badge');
        return b ? b.textContent : null;
      })()`),
    };
    assertOk('briefing: 스텁이 정확히 1회 호출됐다(실호출 단언)', briefingStubCalls === 1);
    assertOk('briefing: briefingBusy 깊이 1(독립 카운터 가동)', report.briefingRunner.busyDepthDuring === 1);
    assertOk('briefing: 진행 중에도 셸 입력이 잠기지 않는다(MAJOR 2)', report.briefingRunner.inputDisabledDuring === false);
    assertOk('briefing: 카드 배지 "브리핑 실행 중"', report.briefingRunner.cardBadgeDuring === '브리핑 실행 중');

    // 같은 (routine_id, fired_at) 재주입(멱등성)과 감시형(경계) — 둘 다 무실행.
    mainMod.handleRoutineFeedEvent(briefEvent);
    mainMod.handleRoutineFeedEvent({ ...briefEvent, routine_id: 'vbrief-rt', mode: 'realtime-ws' });
    await wait(200);
    assertOk('briefing: 중복·감시형 주입 후에도 스텁 호출은 1회(멱등·경계)', briefingStubCalls === 1);

    briefingResolve({ ok: true, finalResult: { session_id: 'stub-session-must-not-leak' } });
    await wait(300);
    report.briefingRunner.sessionAfter = mainMod.getLiveSessionId();
    report.briefingRunner.busyDepthAfter = mainMod.getBriefingBusyDepth();
    report.briefingRunner.reports = briefingReports;
    assertOk('briefing: 완료 후 liveSessionId 불변(BLOCKER — 독립 세션)', mainMod.getLiveSessionId() === sessionBefore);
    assertOk('briefing: 완료 후 busy 깊이 0', mainMod.getBriefingBusyDepth() === 0);
    assertOk('briefing: reportResult 1회 — status ok·본문·제목·목적지·fired_at 정합', briefingReports.length === 1
      && briefingReports[0].status === 'ok'
      && briefingReports[0].content === '검증 브리핑 본문'
      && briefingReports[0].title === '브리핑 검증 루틴'
      && briefingReports[0].destination === 'chat'
      && briefingReports[0].fired_at === briefFiredAt);
    const briefingBadgeAfter = await shellWin.webContents.executeJavaScript(`(() => {
      const badges = document.querySelectorAll('.turn-agent.agent-briefing .agent-badge');
      return badges.length ? badges[badges.length - 1].textContent : null;
    })()`);
    assertOk('briefing: 완료 배지 "브리핑 완료"', briefingBadgeAfter === '브리핑 완료');

    // 우선순위 — 사용자가 이긴다: 두 번째 브리핑을 걸어두고, 사용자 질의
    // 진입점(runLiveQueryInner)이 부르는 것과 같은 함수 참조
    // (killInProgressBriefing, require 캐시로 동일 모듈 인스턴스)를 직접 호출한다.
    mainMod.handleRoutineFeedEvent({
      ...briefEvent, routine_id: 'vbrief2', fired_at: new Date(Date.now() + 1000).toISOString(),
    });
    await wait(300);
    assertOk('briefing: 두 번째 브리핑 가동(스텁 2회)', briefingStubCalls === 2);
    const briefingKillNow = briefingRunnerMod.killInProgressBriefing();
    await wait(300);
    report.briefingRunner.preempt = {
      killedNow: briefingKillNow, briefingKilled,
      stubCalls: briefingStubCalls, busyDepth: mainMod.getBriefingBusyDepth(),
    };
    assertOk('briefing: 선점 kill이 실프로세스 핸들을 죽였다', briefingKillNow === true && briefingKilled === true);
    assertOk('briefing: abort는 재시도하지 않는다(스텁 여전히 2회)', briefingStubCalls === 2);
    assertOk('briefing: 선점 후 busy 깊이 0(사용자 질의 진행 가능)', mainMod.getBriefingBusyDepth() === 0);
    assertOk('briefing: 종료 후 재kill은 no-op', briefingRunnerMod.killInProgressBriefing() === false);
    assertOk('briefing: abort 보고는 failed·본문 없음(3단계 계약)', briefingReports.length === 2
      && briefingReports[1].status === 'failed' && !('content' in briefingReports[1]));
    const briefingBadgePreempt = await shellWin.webContents.executeJavaScript(`(() => {
      const badges = document.querySelectorAll('.turn-agent.agent-briefing .agent-badge');
      return badges.length ? badges[badges.length - 1].textContent : null;
    })()`);
    assertOk('briefing: 선점 종료 배지는 완료가 아니라 중단이다(오표시 금지)',
      briefingBadgePreempt === '브리핑 중단 — 새 대화가 우선됨');
    console.log('[verify] 검증R1-4(브리핑 러너):', JSON.stringify(report.briefingRunner));
  } catch (err) {
    report.briefingRunner = { error: String((err && err.message) || err) };
    failures.push('briefing: 검증 블록이 예외로 끝났다');
  }

  // ---------- 검증 R1-5: 놓친 예약 캐치업 흐름 (2026-08-27, 5단계 AC4) ----------
  // 놓친 예약 카드를 IPC 주입으로 띄우고, 확인 클릭 시 ① catchup-fire(ledger
  // 기록) ② 브리핑 실행이 **이 순서로** 불리는지 스텁 호출 순서로 단언한다.
  // 캐치업→runs 이력 반영(ledger 기반)은 백엔드 pytest가 커버한다(3단계 —
  // record_scheduled_fire 공유 헬퍼·/runs 필터) — 여기는 앱 쪽 순서·카드 계약만.
  try {
    const missedOrder = [];
    const missedReports = [];
    mainMod.setBriefingClaudeRunnerForVerify({
      runClaudeQuery(opts) {
        missedOrder.push('claude');
        opts.onSpawn({ pid: 5, kill() {} });
        opts.onTextDelta('캐치업 브리핑 본문');
        return Promise.resolve({ ok: true });
      },
    }, {
      fetchBudget: async () => ({ remaining: 99 }),
      reportResult: async (p) => { missedReports.push(p); },
      catchupFire: async (id) => {
        missedOrder.push(`catchup:${id}`);
        return { ok: true, data: { fired_at: '2026-08-27T07:30:00+09:00' } };
      },
    });
    const missedView = (id, note) => ({
      id, note, symbol: '005930', mode: 'scheduled', status: 'active', missed: true,
      briefing_model: null, briefing_effort: null,
    });
    const findMissedCard = (note) => `(() => {
      const cards = Array.from(document.querySelectorAll('.turn-agent.routine-missed'));
      return cards.find((c) => {
        const t = c.querySelector('.routine-draft-title');
        return t && t.textContent === ${JSON.stringify(note)};
      });
    })`;

    shellWin.webContents.send('athena:routine-missed', { routines: [missedView('vmiss1', '캐치업 검증 1')] });
    await wait(400);
    report.missedCatchup = {
      cardRendered: await shellWin.webContents.executeJavaScript(`(() => {
        const card = ${findMissedCard('캐치업 검증 1')}();
        if (!card) return null;
        const badge = card.querySelector('.agent-badge');
        const labels = Array.from(card.querySelectorAll('button')).map((b) => b.textContent);
        return { badge: badge ? badge.textContent : null, labels };
      })()`),
    };
    assertOk('missed: 카드가 뜬다(배지·버튼 2개)',
      !!report.missedCatchup.cardRendered
      && report.missedCatchup.cardRendered.badge === '놓친 예약'
      && JSON.stringify(report.missedCatchup.cardRendered.labels) === JSON.stringify(['지금 브리핑', '건너뛰기']));

    await shellWin.webContents.executeJavaScript(`(() => {
      const card = ${findMissedCard('캐치업 검증 1')}();
      Array.from(card.querySelectorAll('button')).find((b) => b.textContent === '지금 브리핑').click();
    })()`);
    await wait(500);
    report.missedCatchup.order = missedOrder.slice();
    report.missedCatchup.statusText = await shellWin.webContents.executeJavaScript(`(() => {
      const card = ${findMissedCard('캐치업 검증 1')}();
      const s = card.querySelector('.routine-approval-actions .agent-mode');
      return s ? s.textContent : null;
    })()`);
    assertOk('missed: catchup-fire가 브리핑보다 먼저 불렸다(순서 단언, MAJOR 3)',
      JSON.stringify(missedOrder) === JSON.stringify(['catchup:vmiss1', 'claude']));
    assertOk('missed: 서버 authoritative fired_at이 브리핑 보고까지 흘렀다',
      missedReports.length === 1 && missedReports[0].fired_at === '2026-08-27T07:30:00+09:00');
    assertOk('missed: 확인 상태 문구', report.missedCatchup.statusText === '발화가 기록됐습니다 — 브리핑 시작');

    // 건너뛰기 — catchup도 브리핑도 안 불리고 카드만 닫힌다.
    shellWin.webContents.send('athena:routine-missed', { routines: [missedView('vmiss2', '캐치업 검증 2')] });
    await wait(300);
    await shellWin.webContents.executeJavaScript(`(() => {
      const card = ${findMissedCard('캐치업 검증 2')}();
      Array.from(card.querySelectorAll('button')).find((b) => b.textContent === '건너뛰기').click();
    })()`);
    await wait(300);
    const skippedGone = await shellWin.webContents.executeJavaScript(`!${findMissedCard('캐치업 검증 2')}()`);
    assertOk('missed: 건너뛰기는 카드만 닫는다(스텁 무호출)', skippedGone === true
      && JSON.stringify(missedOrder) === JSON.stringify(['catchup:vmiss1', 'claude']));

    // 이미 처리된 예약(409) — 브리핑을 태우지 않고 카드에 사실만 표시한다.
    mainMod.setBriefingClaudeRunnerForVerify({
      runClaudeQuery() { missedOrder.push('claude-409'); return Promise.resolve({ ok: true }); },
    }, {
      fetchBudget: async () => ({ remaining: 99 }),
      reportResult: async () => {},
      catchupFire: async () => ({ ok: false, status: 409, error: '이미 발화 처리된 예약이다' }),
    });
    shellWin.webContents.send('athena:routine-missed', { routines: [missedView('vmiss3', '캐치업 검증 3')] });
    await wait(300);
    await shellWin.webContents.executeJavaScript(`(() => {
      const card = ${findMissedCard('캐치업 검증 3')}();
      Array.from(card.querySelectorAll('button')).find((b) => b.textContent === '지금 브리핑').click();
    })()`);
    await wait(300);
    const status409 = await shellWin.webContents.executeJavaScript(`(() => {
      const card = ${findMissedCard('캐치업 검증 3')}();
      const s = card.querySelector('.routine-approval-actions .agent-mode');
      return s ? s.textContent : null;
    })()`);
    assertOk('missed: 409면 브리핑을 안 태우고 "이미 처리됨"을 표시한다',
      status409 === '이미 처리된 예약입니다' && !missedOrder.includes('claude-409'));
    console.log('[verify] 검증R1-5(놓친 예약 캐치업):', JSON.stringify(report.missedCatchup));
  } catch (err) {
    report.missedCatchup = { error: String((err && err.message) || err) };
    failures.push('missed: 검증 블록이 예외로 끝났다');
  }

  // ---------- BOOT-001 C1 이미 준비된 fast reload ----------
  let fastBootWin = null;
  try {
    fastBootWin = await createBootScenarioWindow();
    const fastBoot = await traceBootBar(fastBootWin, 12000, mainMod.getBootCompletionSnapshotForVerify);
    const fastMode = await waitForChatBooted(fastBootWin);
    const duplicateNotificationCount = await fastBootWin.webContents.executeJavaScript(
      `Number(document.getElementById('appNotification').dataset.showCount || '0')`,
    );
    report.bootFastReady = { ...fastBoot, mode: fastMode.mode, duplicateNotificationCount };
    assertOk('boot fast readiness: ready snapshot keeps the 1.92s minimum path',
      fastBoot.reducedMotion === false
      && fastBoot.pass === true
      && fastBoot.finishCount === 1
      && fastBoot.bootTiming.readinessWaitMs >= 0
      && fastBoot.bootTiming.readinessWaitMs <= 250
      && fastBoot.bootTiming.totalMs >= 1850
      && fastBoot.bootTiming.totalMs <= 2200
      && fastMode.booted === true
      && duplicateNotificationCount === 0);
    console.log('[verify] BOOT-001 fast readiness:', JSON.stringify(report.bootFastReady));
  } catch (err) {
    report.bootFastReady = { error: String((err && err.message) || err) };
    failures.push('boot fast readiness: 검증 블록이 예외로 끝났다');
  } finally {
    if (fastBootWin && !fastBootWin.isDestroyed()) fastBootWin.destroy();
  }

  // ---------- BOOT-001 C1 reduced-motion 재부팅 ----------
  // 일반 부팅 검증과 별개로 미디어 조건을 건 채 같은 문서를 다시 로드한다.
  // 완성된 ATHENA 자리표시자/파란 overlay/빨간 caret은 유지하되, 타이핑과
  // 프레임 확장은 생략한다. local readiness를 의도적으로 늦춰도 정적 ATHENA를
  // 유지하다가 readiness 뒤 80ms 정적 상태를 거쳐 finishBoot가 정확히 1회여야 한다.
  let reducedBootWin = null;
  try {
    ipcMain.removeHandler('athena:onboarding-state');
    ipcMain.handle('athena:onboarding-state', async () => {
      await wait(2250);
      return mainMod.settingsHandlers.onboardingState();
    });
    reducedBootWin = await createBootScenarioWindow();
    await forceMedia(reducedBootWin, [{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const loaded = new Promise((resolve) => reducedBootWin.webContents.once('did-finish-load', resolve));
    reducedBootWin.webContents.reload();
    await loaded;
    const reducedBoot = await traceBootBar(reducedBootWin, 12000, mainMod.getBootCompletionSnapshotForVerify);
    const reducedMode = await waitForChatBooted(reducedBootWin);
    report.bootReducedMotion = { ...reducedBoot, mode: reducedMode.mode };
    assertOk('boot reduced-motion: static completed frame uses the same single finish path',
      reducedBoot.reducedMotion === true
      && reducedBoot.pass === true
      && reducedBoot.finishCount === 1
      && reducedBoot.taskAppearedBeforeFullName === false
      && reducedBoot.taskLabels.includes('화면 설정 확인')
      && reducedBoot.taskStates.includes('running')
      && reducedBoot.reducedBootMs >= 1920
      && reducedBoot.reducedReadinessWaitMs >= 250
      && reducedBoot.reducedReadinessWaitMs <= 900
      && reducedMode.booted === true);
    await clearMedia(reducedBootWin);
    console.log('[verify] BOOT-001 reduced-motion:', JSON.stringify(report.bootReducedMotion));
  } catch (err) {
    if (reducedBootWin && !reducedBootWin.isDestroyed() && reducedBootWin.webContents.debugger.isAttached()) {
      try { await clearMedia(reducedBootWin); } catch { /* 검증 종료 중 */ }
    }
    report.bootReducedMotion = { error: String((err && err.message) || err) };
    failures.push('boot reduced-motion: 검증 블록이 예외로 끝났다');
  } finally {
    if (reducedBootWin && !reducedBootWin.isDestroyed()) reducedBootWin.destroy();
    ipcMain.removeHandler('athena:onboarding-state');
    ipcMain.handle('athena:onboarding-state', mainMod.settingsHandlers.onboardingState);
  }

  // ---------- BOOT-003 local UI readiness timeout → dedicated onboarding fallback ----------
  // 응답이 영원히 안 오는 invoke는 완료로 추측하지 않는다. bounded timeout 뒤
  // 앱은 열리되 메인 대화는 숨김·inert인 전용 온보딩으로만 진입한다.
  let releaseHungOnboarding = null;
  let timeoutBootWin = null;
  try {
    // 앞선 close-to-background/오브 검증이 창의 표시 상태를 바꿀 수 있다. Chromium은
    // 숨은 renderer 타이머를 throttle하므로, 실제 사용자가 보는 부팅과 같은 전경
    // 조건을 복원한 뒤 3.5초 local deadline을 실측한다.
    ipcMain.removeHandler('athena:onboarding-state');
    ipcMain.handle('athena:onboarding-state', () => new Promise((resolve) => {
      // resolver를 보관해 검증 중 in-flight IPC를 실제 pending 상태로 유지하고,
      // 검증 뒤 명시적으로 정리한다. live root 없는 영구 Promise는 Electron bridge가
      // renderer deadline보다 먼저 reject할 수 있어 timeout 검증으로 쓸 수 없다.
      releaseHungOnboarding = resolve;
    }));
    timeoutBootWin = await createBootScenarioWindow();
    const timeoutBoot = await traceBootBar(timeoutBootWin, 12000, mainMod.getBootCompletionSnapshotForVerify);
    const timeoutMode = await waitForChatBooted(timeoutBootWin);
    const timeoutFallbackState = await timeoutBootWin.webContents.executeJavaScript(`(() => {
        const boot = document.getElementById('boot');
        const shell = document.getElementById('shell');
        return {
          phase: boot.dataset.phase,
          localReadiness: boot.dataset.localReadiness,
          localFailureReason: boot.dataset.localFailureReason,
          retryUiAbsent: document.getElementById('bootFailure') === null
            && document.getElementById('bootRetry') === null,
          onboardingVisible: !document.getElementById('onboard').hidden,
          appHidden: document.getElementById('app').hidden,
          shellBlocked: shell.classList.contains('is-onboarding-hidden') && shell.inert
            && getComputedStyle(shell).display === 'none',
          finishCount: Number(boot.dataset.finishCount || '0'),
        };
      })()`);
    const timeoutFallbackReached = !!timeoutFallbackState
      && timeoutFallbackState.phase === 'complete'
      && timeoutFallbackState.localReadiness === 'fallback'
      && timeoutFallbackState.localFailureReason === 'timeout'
      && timeoutFallbackState.retryUiAbsent === true
      && timeoutFallbackState.onboardingVisible === true
      && timeoutFallbackState.appHidden === true
      && timeoutFallbackState.shellBlocked === true
      && timeoutFallbackState.finishCount === 1;
    if (releaseHungOnboarding) {
      releaseHungOnboarding(mainMod.settingsHandlers.onboardingState());
      releaseHungOnboarding = null;
    }
    report.bootLocalReadinessTimeout = {
      ...timeoutBoot,
      fallbackReached: timeoutFallbackReached === true,
      fallbackState: timeoutFallbackState || null,
      mode: timeoutMode.mode,
    };
    assertOk('boot local readiness timeout: hang opens dedicated onboarding and never exposes main chat',
      timeoutFallbackReached === true
      && timeoutBoot.timingMatches === true
      && timeoutBoot.finishCount === 1
      && timeoutBoot.bootTiming.readinessWaitMs >= 1800
      && timeoutMode.booted === true
      && timeoutMode.mode === 'onboard');
    console.log('[verify] BOOT-001 local readiness timeout:', JSON.stringify(report.bootLocalReadinessTimeout));
  } catch (err) {
    report.bootLocalReadinessTimeout = { error: String((err && err.message) || err) };
    failures.push('boot local readiness timeout: 검증 블록이 예외로 끝났다');
  } finally {
    if (timeoutBootWin && !timeoutBootWin.isDestroyed()) timeoutBootWin.destroy();
    if (releaseHungOnboarding) {
      releaseHungOnboarding(mainMod.settingsHandlers.onboardingState());
      releaseHungOnboarding = null;
    }
    ipcMain.removeHandler('athena:onboarding-state');
    ipcMain.handle('athena:onboarding-state', mainMod.settingsHandlers.onboardingState);
  }

  // ---------- BOOT-003 corrupt/unconfirmed onboarding state → dedicated onboarding ----------
  let corruptBootWin = null;
  try {
    ipcMain.removeHandler('athena:onboarding-state');
    ipcMain.handle('athena:onboarding-state', async () => ({ needed: false, step: 2, extra: 'corrupt' }));
    corruptBootWin = await createBootScenarioWindow();
    const corruptBoot = await traceBootBar(corruptBootWin, 12000, mainMod.getBootCompletionSnapshotForVerify);
    const corruptMode = await waitForChatBooted(corruptBootWin);
    const corruptState = await corruptBootWin.webContents.executeJavaScript(`(() => {
      const shell = document.getElementById('shell');
      return {
        localReadiness: document.getElementById('boot').dataset.localReadiness,
        localFailureReason: document.getElementById('boot').dataset.localFailureReason,
        onboardingVisible: !document.getElementById('onboard').hidden,
        appHidden: document.getElementById('app').hidden,
        shellBlocked: shell.inert && shell.classList.contains('is-onboarding-hidden'),
      };
    })()`);
    report.bootCorruptOnboarding = { ...corruptBoot, mode: corruptMode.mode, state: corruptState };
    assertOk('boot corrupt onboarding state: unconfirmed completion falls back to dedicated onboarding',
      corruptBoot.finishCount === 1
      && corruptMode.mode === 'onboard'
      && corruptState.localReadiness === 'fallback'
      && corruptState.localFailureReason === 'unconfirmed'
      && corruptState.onboardingVisible === true
      && corruptState.appHidden === true
      && corruptState.shellBlocked === true);
  } catch (err) {
    report.bootCorruptOnboarding = { error: String((err && err.message) || err) };
    failures.push('boot corrupt onboarding state: 검증 블록이 예외로 끝났다');
  } finally {
    if (corruptBootWin && !corruptBootWin.isDestroyed()) corruptBootWin.destroy();
    ipcMain.removeHandler('athena:onboarding-state');
    ipcMain.handle('athena:onboarding-state', mainMod.settingsHandlers.onboardingState);
  }

  // ---------- BOOT-001 C1 지연 local UI readiness 회귀 ----------
  // onboarding-state는 실제 셸 모드를 결정하는 local readiness다. 응답이 늦으면
  // 완성 ATHENA 상태에서 기다리고, 성공한 뒤에만 480ms 확장을 시작해야 한다.
  let delayedBootWin = null;
  try {
    ipcMain.removeHandler('athena:onboarding-state');
    ipcMain.handle('athena:onboarding-state', async () => {
      await wait(2600);
      return mainMod.settingsHandlers.onboardingState();
    });
    delayedBootWin = await createBootScenarioWindow();
    const delayedBoot = await traceBootBar(delayedBootWin, 12000, mainMod.getBootCompletionSnapshotForVerify);
    const delayedMode = await waitForChatBooted(delayedBootWin);
    report.bootDelayedOnboarding = { ...delayedBoot, mode: delayedMode.mode };
    assertOk('boot delayed onboarding IPC: local readiness extends total without bypassing the gate',
      delayedBoot.reducedMotion === false
      && delayedBoot.timingMatches === true
      && delayedBoot.bootTiming.readinessWaitMs >= 900
      && delayedBoot.bootTiming.totalMs >= 2900
      && delayedBoot.taskAppearedBeforeFullName === false
      && delayedBoot.taskLabels.includes('화면 설정 확인')
      && delayedBoot.finishCount === 1
      && delayedBoot.sawShellCompactMask === true
      && delayedBoot.shellTransitionContract === true
      && delayedBoot.shellFinishedFull === true
      && delayedMode.booted === true);
    console.log('[verify] BOOT-001 delayed onboarding IPC:', JSON.stringify(report.bootDelayedOnboarding));
  } catch (err) {
    report.bootDelayedOnboarding = { error: String((err && err.message) || err) };
    failures.push('boot delayed onboarding IPC: 검증 블록이 예외로 끝났다');
  } finally {
    if (delayedBootWin && !delayedBootWin.isDestroyed()) delayedBootWin.destroy();
    ipcMain.removeHandler('athena:onboarding-state');
    ipcMain.handle('athena:onboarding-state', mainMod.settingsHandlers.onboardingState);
  }

  // ---------- 검증 프로필 상태 매트릭스 (LIFE-001) ----------
  // 새 임시 디렉터리라는 사실만 믿지 않고, 기본 앱 진입·완전 신규·CLI만 완료된
  // 부분 상태를 같은 production onboarding reader로 직접 확인한다. 각 시드는 계정
  // 파일도 함께 비우므로 실행 머신이나 앞선 검증 블록의 상태가 섞이지 않는다.
  try {
    const scenarioStates = {};
    for (const scenario of ['configured', 'new-user', 'cli-complete']) {
      seedVerifyProfile(VERIFY_PROFILE.directory, scenario);
      scenarioStates[scenario] = mainMod.settingsHandlers.onboardingState();
    }
    report.verifyProfile.scenarioStates = scenarioStates;
    assertOk('verify profile: configured seed opens the app shell',
      scenarioStates.configured.needed === false && scenarioStates.configured.step === 3);
    assertOk('verify profile: LIFE-001 new-user seed starts at CLI connection',
      scenarioStates['new-user'].needed === true && scenarioStates['new-user'].step === 2);
    assertOk('verify profile: LIFE-001 partial seed resumes at account connection',
      scenarioStates['cli-complete'].needed === true && scenarioStates['cli-complete'].step === 3);
  } catch (err) {
    report.verifyProfile.scenarioError = String((err && err.message) || err);
    failures.push('verify profile: LIFE-001 상태 시드 검증 블록이 예외로 끝났다');
  } finally {
    seedVerifyProfile(VERIFY_PROFILE.directory, 'configured');
  }

  // ---------- LIFE-001: 온보딩 3 / 3 열린 표면 실계산 스타일 ----------
  // 정규식으로 첫 CSS 규칙만 읽으면 뒤쪽 override를 놓칠 수 있다. production
  // shell.html에 로드된 실제 cascade에서 기본·포커스·등록 계좌 상태를 직접 잰다.
  try {
    if (shellWin.isMinimized()) shellWin.restore();
    if (!shellWin.isVisible()) shellWin.show();
    shellWin.focus();
    await wait(40);
    const accountSurface = await shellWin.webContents.executeJavaScript(`(async () => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;z-index:9999;background:white';
      document.body.appendChild(host);
      const cleanup = window.AthenaLib.Onboarding.renderAccountStep(host, {
        connectedAccountId: 'verify-account',
        onUseRegistered: () => {},
        onRegistered: () => {},
        onBack: () => {},
      });

      const inputRow = host.querySelector('.onb-input-row');
      const input = host.querySelector('.onb-input');
      const savebox = host.querySelector('.onb-savebox:not(.onb-connected-account)');
      const connected = host.querySelector('.onb-connected-account');
      const brandProbe = document.createElement('div');
      brandProbe.style.border = '1px solid var(--color-brand)';
      host.appendChild(brandProbe);
      const surface = (node) => {
        const style = node ? getComputedStyle(node) : null;
        return style ? {
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          borderColor: style.borderTopColor,
        } : null;
      };
      const baseInput = surface(inputRow);
      const storage = surface(savebox);
      const connectedAccount = surface(connected);
      input.focus();
      await new Promise((resolve) => setTimeout(resolve, 180));
      const focusedInput = surface(inputRow);
      const brandBorderColor = getComputedStyle(brandProbe).borderTopColor;
      const result = {
        baseInput,
        storage,
        connectedAccount,
        focusedInput,
        brandBorderColor,
        inputFocused: document.activeElement === input,
        rowFocusWithin: inputRow.matches(':focus-within'),
        connectedAccountPresent: !!connected,
      };
      cleanup();
      host.remove();
      return result;
    })()`);
    const isOpenSurface = (surface) => !!surface
      && surface.backgroundColor === 'rgba(0, 0, 0, 0)'
      && surface.backgroundImage === 'none';
    report.onboardingAccountSurface = accountSurface;
    assertOk('onboarding 3/3: input and storage use transparent open surfaces in the real shell cascade',
      isOpenSurface(accountSurface.baseInput)
      && isOpenSurface(accountSurface.storage));
    assertOk('onboarding 3/3: focus uses the existing brand border',
      accountSurface.inputFocused === true
      && accountSurface.rowFocusWithin === true
      && accountSurface.focusedInput.borderColor === accountSurface.brandBorderColor);
    assertOk('onboarding 3/3: connected-account state remains present and unfilled',
      accountSurface.connectedAccountPresent === true
      && isOpenSurface(accountSurface.connectedAccount));
  } catch (err) {
    report.onboardingAccountSurface = { error: String((err && err.message) || err) };
    failures.push('onboarding 3/3: 실제 cascade 열린 표면 검증 블록이 예외로 끝났다');
  }

  // 판정 신호 표준화(2026-08-28 P3c) — 리포트만 읽는 소비자가 성패를 오판하지
  // 않게 실패 목록·exit 코드를 리포트에도 싣는다. 이전엔 콘솔("전 단언 통과"/
  // "실패 단언 N건")과 exit code만 진짜 신호였고, 리포트의 failures 부재를
  // 빈 배열로 오독해 실패 2건을 통과로 판정한 실측 사고가 있었다(2026-08-27).
  report.failures = [...failures];
  report.exitCode = failures.length ? 1 : 0;
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
