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

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, name), img.toPNG());
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

app.whenReady().then(async () => {
  dlog('whenReady fired');
  const report = { startedAt: new Date().toISOString() };
  const mainMod = require('./main.js');
  dlog('main.js required');

  // ---------- 창 생성 (main.js와 동일 경로) ----------
  await mainMod.createWindows();
  dlog('createWindows done');
  const { chatWin, canvasWin } = mainMod.getWins();
  const layout = mainMod.getLayout();
  report.layout = layout;

  // ---------- 검증 1: 부팅 — 대화 창만 뜬다 ----------
  await wait(200);
  report.bootChatOnly = { canvasVisibleAtBoot: canvasWin.isVisible(), chatVisibleAtBoot: chatWin.isVisible() };
  dlog('before shot 01'); const s1 = await shot(chatWin, '01-boot-sequence.png'); dlog('after shot 01');
  const boot = await waitForChatBooted(chatWin);
  dlog('boot done, before shot 02'); const s2 = await shot(chatWin, '02-chat-only-idle.png'); dlog('after shot 02');
  report.bootChatOnly.shots = { boot: s1, idle: s2 };
  report.bootChatOnly.chatBootedAfterBoot = boot.booted;
  report.bootChatOnly.bootMode = boot.mode;
  report.bootChatOnly.exactlyOneModeVisible = boot.exactlyOneModeVisible;
  report.bootChatOnly.panels = boot.panels;
  // 검증 전용 프로필은 온보딩을 완료로 심는다(파일 상단 참조) — 그러므로 여기서
  // 기대하는 모드는 'app'이다. 'onboard'가 나오면 프로필 격리가 깨진 것이고,
  // 그 상태의 검증 5~8은 숨은 DOM을 재는 것이라 믿으면 안 된다.
  report.bootChatOnly.bootedIntoChatMode = boot.mode === 'app';
  console.log(
    '[verify] 검증1 완료 — 부팅 시 캔버스 창 표시 여부:', canvasWin.isVisible(),
    '| 대화 창 부팅:', boot.booted, '| 모드:', boot.mode,
    '| 모드 배타성:', boot.exactlyOneModeVisible
  );

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

  // ---------- 검증 3: 두 창 독립 이동/리사이즈 ----------
  const initial = { canvas: canvasWin.getBounds(), chat: chatWin.getBounds() };
  canvasWin.setBounds({ ...canvasWin.getBounds(), x: canvasWin.getBounds().x + 80 });
  await wait(150);
  const afterCanvasMove = { canvas: canvasWin.getBounds(), chat: chatWin.getBounds() };
  chatWin.setBounds({ ...chatWin.getBounds(), height: Math.min(layout.chatMaxH, chatWin.getBounds().height + 100) });
  await wait(150);
  const afterChatResize = { canvas: canvasWin.getBounds(), chat: chatWin.getBounds() };
  // 원위치
  canvasWin.setBounds({ ...canvasWin.getBounds(), x: canvasWin.getBounds().x - 80 });
  chatWin.setBounds({ x: layout.originX, y: (layout.originY + layout.canvasH + layout.chatBaseH) - layout.chatBaseH, width: layout.chatW, height: layout.chatBaseH });
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

  // ---------- 검증 7: 설정을 열어도 창은 둘이다 ----------
  // ui/soul.md §3·§8 — 창은 둘뿐이고 창 3개 이상은 즉시 탈락이다. 설정은 새 창이
  // 아니라 캔버스 창에 그려지는 카드다(GLOSSARY.md §1, app/canvas.js:151-152).
  // 이 검증의 핵심 단언은 "창이 늘어난다"가 아니라 **"창이 늘지 않는다"**이다.
  const winCountBefore = BrowserWindow.getAllWindows().length;
  const chatBoundsBefore = chatWin.getBounds();

  await chatWin.webContents.executeJavaScript("document.getElementById('dot').click()");
  await wait(900);

  const winCountAfterOpen = BrowserWindow.getAllWindows().length;

  // 두 번 눌러도 카드는 하나여야 한다(buildCardShell이 기존 카드를 제거하고 다시 만든다)
  await chatWin.webContents.executeJavaScript("document.getElementById('dot').click()");
  await wait(600);
  const winCountAfterSecondClick = BrowserWindow.getAllWindows().length;

  const chatProbe = await chatWin.webContents.executeJavaScript(`
    (() => ({
      // 대화 화면은 물러나고 설정 화면이 그 자리를 차지한다 — 같은 창이 변한 것이다
      appHidden: document.getElementById('app').hidden === true,
      settingsVisible: document.getElementById('settings').hidden === false,
      accountsCardCount: document.querySelectorAll('#settingsGrid .card.accounts').length,
      mcpCardCount: document.querySelectorAll('#settingsGrid .card.mcp').length,
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
      settingsCardsOnCanvas: document.querySelectorAll('#grid .card.accounts, #grid .card.mcp').length,
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
    accountsCardPresent: chatProbe.accountsCardCount === 1,
    mcpCardPresent: chatProbe.mcpCardCount === 1,
    // 두 번 눌러도 카드가 겹쳐 쌓이지 않는다
    singleCardAfterSecondClick: chatProbe.accountsCardCount === 1 && chatProbe.mcpCardCount === 1,
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
  console.log('[verify] 검증7(설정 모드):', JSON.stringify(report.settingsSurface));

  // ---------- 검증 8: 커맨드바로도 설정에 도달한다 ----------
  // GLOSSARY.md §1 — 점 클릭은 "추가" 진입로다. 커맨드바 경로가 없으면 soul.md §8 탈락 조건.
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
      accountsCardCount: document.querySelectorAll('#settingsGrid .card.accounts').length,
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
    reachedSettings: chatAfterCmd.settingsVisible === true && chatAfterCmd.accountsCardCount === 1,
    inputCleared: chatAfterCmd.inputCleared === true,
    // 설정 명령은 질의로 흘러가지 않는다 — 이력에 질문이 추가되면 안 된다
    notTreatedAsQuery: chatAfterCmd.turnCount === turnCountBeforeCmd,
    turnCountBefore: turnCountBeforeCmd,
    turnCountAfter: chatAfterCmd.turnCount,
  };
  console.log('[verify] 검증8(커맨드바 진입):', JSON.stringify(report.settingsCommandBar));

  // ---------- 검증 9: 창 기본 기능 (2026-08-17) — 줌 · 이동 앵커 · 최소화/복원 ----------
  // frame:false·타이틀바 없음이라 main.js에 직접 배선한 기능들이다. 커서 폴링
  // 드래그 자체는 실제 마우스가 필요해 자동화로 못 돌린다 — 대신 그 결과(창이
  // 옮겨진 상태)를 setBounds로 재현해 "다음 높이 변경이 창을 부팅 좌표로
  // 되돌리지 않는다"(앵커 동기화)를 단언한다.
  const sendFromChat = (channel, payload) => chatWin.webContents.executeJavaScript(
    `require('electron').ipcRenderer.send('${channel}', ${JSON.stringify(payload)})`
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
  canvasWin.setBounds({ ...cbBefore, height: Math.round(cbBefore.height / 2) });
  await wait(200);
  canvasWin.webContents.send('athena:add-canvas', { type: 'table' });
  await wait(150);
  liveEnvelope({ canvas_type: 'free', caption: '검증10 자유', data: { a: 1, b: '검증' } });
  await wait(250);
  const afterBudget = await gridProbe();
  canvasWin.setBounds(cbBefore);
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

  // ---------- 검증 11: 창 이동(빈 유리 드래그)이 크기를 바꾸지 않는다 ----------
  // 사용자 보고(2026-08-18): 화면 아무 곳이나 클릭하면 창이 늘어난다. 빈 유리
  // mousedown → athena:window-drag start → main.js가 16ms 폴링으로 setPosition을
  // 호출하는데, DPI 배율 화면에서 setPosition은 DIP↔물리 px 반올림을 왕복하며
  // 크기를 누적 변형시킨다. 제자리 클릭(이동 0px)을 재현한다 — 700ms 홀드면
  // 폴링 ~40회라 누적이 있으면 반드시 드러난다.
  const { screen: elScreen } = require('electron');
  const dragBefore = chatWin.getBounds();
  await chatWin.webContents.executeJavaScript(
    "require('electron').ipcRenderer.send('athena:window-drag', { phase: 'start' })"
  );
  await wait(700);
  await chatWin.webContents.executeJavaScript(
    "require('electron').ipcRenderer.send('athena:window-drag', { phase: 'end' })"
  );
  await wait(150);
  const dragAfter = chatWin.getBounds();
  report.dragNoResize = {
    scaleFactor: elScreen.getPrimaryDisplay().scaleFactor,
    before: dragBefore,
    after: dragAfter,
    // 크기 불변이 핵심 단언. 위치는 검증 중 실제 마우스가 움직이면 정당하게
    // 변할 수 있어 참고 수치로만 남긴다(공유 데스크톱).
    sizeUnchanged: dragBefore.width === dragAfter.width && dragBefore.height === dragAfter.height,
    positionDelta: { x: dragAfter.x - dragBefore.x, y: dragAfter.y - dragBefore.y },
  };
  console.log('[verify] 검증11(제자리 클릭 크기 불변):', JSON.stringify(report.dragNoResize));

  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(CAPTURES, 'VERIFY-REPORT.json'), JSON.stringify(report, null, 2));
  console.log('[verify] 리포트 저장:', path.join(CAPTURES, 'VERIFY-REPORT.json'));

  await wait(200);
  dlog('quitting'); app.quit();
});
