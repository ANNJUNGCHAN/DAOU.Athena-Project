// 우측 채팅 영역 렌더러. nodeIntegration:false / contextIsolation:true(2026-08-18
// 렌더러 격리, 클로드 데스크탑 방식) — preload.js의 window.athena 다리로만 main과
// 통신한다. lib/*.js는 shell.html이 <script> 태그로 미리 로드해 window.AthenaLib에
// 얹어둔 전역이다(require 없음 — nodeIntegration:false라 브라우저에 require가 없다).
//
// 2026-08-24 리프 1.2.1: 이 파일은 더 이상 **창** 하나를 소유하지 않는다. 셸 창의
// #chatRegion(고정 폭 400px) 안에서 돈다. 그와 함께 창 높이 상태의 소유권 전체가
// 사라졌다 — 자동 성장(scheduleHeightSync/measureNeededHeight) · 수동 리사이즈
// (그립 드래그) · manualOverride · 최대화 토글 · 유리 두께의 높이 보간이 전부
// "창 높이 = 대화 이력 높이"라는 전제 위에 있었고, 이력은 이제 영역 안에서
// 스크롤한다. 창 크롬·창 단축키는 shell.js로 옮겼다.
const onboarding = window.AthenaLib.Onboarding;
const authScreen = window.AthenaLib.AuthScreen;
const settingsCards = window.AthenaLib.SettingsCards;
const { waitForVisiblePaint: waitForRestReceiptPaint } = window.AthenaLib.RestCanvasPaint;
const toolStepTrack = window.AthenaLib.ToolStepTrack;
const { createTextReleaseLadder } = window.AthenaLib.TextReleaseLadder;

const $boot = document.getElementById('boot');
const $bootName = document.getElementById('bootName');
const $shell = document.getElementById('shell');
const $app = document.getElementById('app');
const $history = document.getElementById('history');
const $appNotification = document.getElementById('appNotification');
const $appNotificationTitle = document.getElementById('appNotificationTitle');
const $appNotificationBody = document.getElementById('appNotificationBody');
let appNotificationTimer = null;

window.athena.on('athena:app-notification', (payload = {}) => {
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!title || !body) return;
  $appNotificationTitle.textContent = title;
  $appNotificationBody.textContent = body;
  $appNotification.hidden = false;
  $appNotification.dataset.showCount = String(Number($appNotification.dataset.showCount || '0') + 1);
  if (appNotificationTimer) clearTimeout(appNotificationTimer);
  appNotificationTimer = setTimeout(() => { $appNotification.hidden = true; }, 8000);
  window.athena.send('athena:app-notification-shown');
});

// 결과물·출처 바(Paper 44 composer-context, 2026-09-05) — 옛 도크(대화 상단 3행 카드)를 입력 상자
// 위 회색 한 줄로 내렸다: [결과물][캡션][+N 카드][출처 N ˅][×]. shell.html에는 마크업이 없고
// 이 조립 코드가 #inputStack의 .input-row 앞에 끼워 넣는다. 하위 에이전트 행은 사라졌다 —
// 이력의 에이전트 카드(runQueryLive의 ensureAgentCard)가 그 자리를 잇는다.
const $inputStack = document.getElementById('inputStack');
const $inputRow = $inputStack.querySelector('.input-row');
// 캐럿 SVG(Paper 44) — 활동 줄·에이전트 카드·출처 버튼이 같은 10px 꺾쇠를 쓴다.
function chevronSvg(direction) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 10 10');
  svg.setAttribute('width', '10');
  svg.setAttribute('height', '10');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', direction === 'down' ? 'M2.5 4l2.5 2.5L7.5 4' : 'M3.5 2l3 3-3 3');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(p);
  return svg;
}
const $resultDock = document.createElement('div');
$resultDock.className = 'result-dock';
$resultDock.hidden = true;
const resultDockHead = document.createElement('div');
resultDockHead.className = 'result-dock-head';
const $resultDockLabel = document.createElement('span');
$resultDockLabel.className = 'result-dock-label';
$resultDockLabel.textContent = '결과물';
const $resultDockCaption = document.createElement('span');
$resultDockCaption.className = 'result-dock-caption';
const $resultDockCanvasCount = document.createElement('span');
$resultDockCanvasCount.className = 'result-dock-count';
const $resultDockSources = document.createElement('button');
$resultDockSources.type = 'button';
$resultDockSources.className = 'result-dock-sources';
$resultDockSources.title = '출처 종류 펼치기';
const $resultDockSourceCount = document.createElement('span');
$resultDockSources.append($resultDockSourceCount, chevronSvg('down'));
const $resultDockClose = document.createElement('button');
$resultDockClose.type = 'button';
$resultDockClose.className = 'result-dock-close';
$resultDockClose.setAttribute('aria-label', '결과물 바 닫기');
$resultDockClose.title = '닫기';
{
  const x = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  x.setAttribute('viewBox', '0 0 20 20');
  x.setAttribute('width', '16');
  x.setAttribute('height', '16');
  x.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M6.5 6.5l7 7M13.5 6.5l-7 7');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.2');
  p.setAttribute('stroke-linecap', 'round');
  x.appendChild(p);
  $resultDockClose.appendChild(x);
}
resultDockHead.append($resultDockLabel, $resultDockCaption, $resultDockCanvasCount, $resultDockSources, $resultDockClose);
const $resultDockChips = document.createElement('div');
$resultDockChips.className = 'result-dock-chips';
$resultDockChips.hidden = true;
$resultDock.append(resultDockHead, $resultDockChips);
$inputStack.insertBefore($resultDock, $inputRow);
let resultDockHasResults = false;
let resultDockDismissed = false;
$resultDockSources.addEventListener('click', () => {
  $resultDockChips.hidden = !$resultDockChips.hidden;
  $resultDockSources.classList.toggle('is-open', !$resultDockChips.hidden);
});
$resultDockClose.addEventListener('click', () => {
  resultDockDismissed = true;
  refreshResultDockVisibility();
});
// 결과가 있고 사람이 ×로 접지 않았을 때만 보인다 — hidden을 직접 안 건드린다(단일 진실).
function refreshResultDockVisibility() {
  $resultDock.hidden = !resultDockHasResults || resultDockDismissed;
}
const $input = document.getElementById('input');

// 입력창 높이를 내용에 맞춘다(2026-09-02 사용자 지적 "글 길게 쓰면 여러 줄이 되어야").
// height를 먼저 비워야 scrollHeight가 "지금 높이"가 아니라 "필요한 높이"를 답한다 —
// 안 비우면 한 번 커진 높이가 줄지 않는다. 상한은 CSS의 max-height가 쥐고, 여기서는
// 그 값을 넘겨 받아 그 이상 키우지 않는다(넘으면 textarea가 자체 스크롤한다).
function autoGrowInput() {
  if (!$input) return;
  $input.style.height = 'auto';
  const max = parseFloat(getComputedStyle($input).maxHeight);
  const needed = $input.scrollHeight;
  $input.style.height = `${Number.isFinite(max) ? Math.min(needed, max) : needed}px`;
}
const $dot = document.getElementById('dot');
const $lockHint = document.getElementById('lockHint');
const $lockText = document.getElementById('lockText');
const $lockTime = document.getElementById('lockTime');
// 컴포저(Paper 44, 2026-09-05) — 중단 버튼·하단 툴바.
const $stopBtn = document.getElementById('stopBtn');
const $composerSpinner = document.getElementById('composerSpinner');
const $attachBtn = document.getElementById('attachBtn');
const $mentionBtn = document.getElementById('mentionBtn');
const $modelBtn = document.getElementById('modelBtn');
const $effortBtn = document.getElementById('effortBtn');
const $onboard = document.getElementById('onboard');
const $onboardBody = document.getElementById('onboardBody');
const $settings = document.getElementById('settings');
const $settingsNav = document.getElementById('settingsNav');
const $settingsGrid = document.getElementById('settingsGrid');

// 'live'(기본) | 'fixture'. main이 athena:init에서 알려준다(main.js
// ATHENA_CANVAS_SOURCE 참조). verify.js만 명시적으로 'fixture'를 세팅한다 —
// 사람이 쓰는 npm start는 항상 live다(결정 D1의 실배선이 기본 경로여야 한다).
let canvasSource = 'live';
let state = 'idle'; // idle | judging | calling | done(즉시 idle로 수렴)
let liveProgressEl = null;
let abortToken = 0;
// 오브 대화 모드(2026-08-26 board-33)가 돌리는 왕복 중에는 셸 입력도 잠근다 —
// 셸이 숨겨진 동안만 오브가 질의할 수 있으므로 겹칠 일은 이론상 없지만, 트레이
// 복귀처럼 타이핑 없이 셸이 다시 보이게 되는 경로가 있어 방어적으로 공유한다
// (main.js broadcastLiveQueryBusy — "단일 실행 잠금은 공유한다").
let remoteQueryBusy = false;
let onboardCleanup = null; // 현재 노출 중인 온보딩/인증 화면의 정리 함수(리스너·타이머 해제)
const onboardingRevision = onboarding.createOnboardingRevisionGuard();
let onboardingAccountId = null;

function prepareRestReceiptSurface() {
  // A fail-closed receipt is the only visible result for rejected/no-render
  // requests. It must not be appended beneath boot, onboarding, settings or
  // order panels. Return the existing window to chat mode before measuring it.
  if (!$onboard.hidden) return false;
  $boot.hidden = true;
  $settings.hidden = true;
  $order.hidden = true;
  $app.hidden = false;
  settingsOpen = false;
  orderOpen = false;
  return true;
}
window.athena.on('athena:add-rest-receipt', async (payload = {}) => {
  if (onboarding.ackRestReceiptBlockedByOnboarding(
    $onboard,
    (channel, ack) => window.athena.send(channel, ack),
    payload.receiptId,
    // 같은 오버레이(#onboard)를 계좌 전환 화면도 빌려 쓴다 — 막는 이유를
    // 온보딩이라고 잘못 보고하지 않는다(둘 다 fail-closed인 것은 같다).
    accountSwitchOpen ? 'account_switch_active' : 'onboarding_active',
  )) return;
  if (!prepareRestReceiptSurface()) return;
  const line = document.createElement('div');
  line.className = 'turn rest-receipt';
  line.dataset.receiptId = String(payload.receiptId || '');
  const text = document.createElement('div');
  text.className = 'turn-a';
  text.textContent = String(payload.text || '캔버스에 표시하지 못했습니다.');
  line.appendChild(text);
  $history.appendChild(line);
  line.scrollIntoView({ block: 'nearest' });
  scrollAfterRender();
  try {
    const paint = await waitForRestReceiptPaint(line);
    window.athena.send('athena:rest-receipt-painted', {
      receipt_id: payload.receiptId,
      verified_visible: paint.verifiedVisible,
      visible_paint_at: paint.visiblePaintAt,
      rect: paint.rect,
    });
  } catch (error) {
    window.athena.send('athena:rest-receipt-painted', {
      receipt_id: payload.receiptId,
      verified_visible: false,
      error: String((error && error.message) || error),
    });
  }
});

let prefs = { autoExpandCanvas: true, autoGrowChat: true, fontSize: 'md', glassLevel: 'default' };
// 글자 크기 5단계(2026-08-19) — tokens.css의 :root[data-font-size=...] 토큰 세트를
// 켠다. md는 기본 토큰이므로 속성을 지워 :root 값으로 돌아간다. 텍스트 크기가
// 바뀌면 필요한 창 높이도 바뀌므로 auto-grow 재측정을 건다.
function applyFontSize() {
  const v = prefs.fontSize;
  if (v && v !== 'md') document.documentElement.dataset.fontSize = v;
  else delete document.documentElement.dataset.fontSize;
  scrollAfterRender();
}
// 유리 투명도 3단(2026-08-22) — 글자 크기와 같은 문법. default는 :root 기본 토큰이라
// 속성을 지운다. 두께만 바뀌므로 높이 재측정은 필요 없다.
function applyGlassLevel() {
  const v = prefs.glassLevel;
  if (v && v !== 'default') document.documentElement.dataset.glass = v;
  else delete document.documentElement.dataset.glass;
}
async function loadPrefs() {
  try {
    const next = await window.athena.invoke('athena:settings:prefs:get');
    if (next) prefs = next;
  } catch { /* 채널 없음 — 기본값 유지 */ }
  applyFontSize();
  applyGlassLevel();
}
window.athena.on('athena:prefs-changed', (next) => { if (next) { prefs = next; applyFontSize(); applyGlassLevel(); } });

// ---------- "기록 안 됨" 배지 — 채팅 저장 실패 신호(2026-08-19, plan-chat-graph-pipeline.md §2(g)) ----------
// 순수 로직은 lib/history-badge.js(node --test로 단위 테스트) — 여기는 IPC 구독과
// runQueryLive의 턴 경계 연결만 한다.
const historyBadge = window.AthenaLib.HistoryBadge;
const saveFailedRouter = historyBadge.createSaveFailedRouter();
window.athena.on('athena:history-save-failed', (payload) => saveFailedRouter.handleFailure(payload));

window.addEventListener('DOMContentLoaded', () => {
  loadPrefs(); // 화면 설정 — 부팅을 막지 않는다. 로드 전에는 기본값(둘 다 켜짐)으로 동작한다.

  if (window.AthenaShell.usesNativeWindowControls) {
    $boot.hidden = true;
    window.AthenaShell.revealChrome();
    window.athena.invoke('athena:onboarding-state').then((state) => {
      if (state && state.needed === true) {
        startOnboarding(onboarding.resolveOnboardingStartStep(state));
      } else {
        $app.hidden = false;
      }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.athena.send('athena:shell-handoff-ready');
      }));
    }, () => {
      startOnboarding(2);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.athena.send('athena:shell-handoff-ready');
      }));
    });
    return;
  }

  // BOOT-001 C1의 모든 예약 작업은 이 Set 하나가 소유한다. 페이지 종료·완료 시
  // 남은 타이머를 전부 취소해, 숨은 DOM에 뒤늦게 클래스나 글자가 붙지 않게 한다.
  const bootTimers = new Set();
  let bootDisposed = false;
  let bootFinishStarted = false;
  let focusChatAfterBoot = false;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $bootStatus = document.getElementById('bootStatus');
  const $bootTask = document.getElementById('bootTask');
  let visualMinimumReached = false;
  let startupSnapshot = null;
  let startupTransportFailed = false;
  let localReadiness = 'running';
  let localFailureReason = '';
  let localOnboardState = null;
  let localReadinessRequestId = 0;
  let offBootReadiness = null;
  let reducedSwapScheduled = false;
  const scheduleBoot = (fn, delay) => {
    const id = setTimeout(() => {
      bootTimers.delete(id);
      if (!bootDisposed) fn();
    }, delay);
    bootTimers.add(id);
    return id;
  };
  const cancelBootTimers = () => {
    bootTimers.forEach((id) => clearTimeout(id));
    bootTimers.clear();
  };
  $boot.dataset.startedAt = String(performance.now());
  $boot.setAttribute('aria-busy', 'true');
  const markBootTime = (name) => { $boot.dataset[name] = String(performance.now()); };
  const appendBootChar = (ch) => {
    const span = document.createElement('span');
    span.className = 'boot-name-char';
    span.textContent = ch;
    $bootName.appendChild(span);
    const prefixes = ($boot.dataset.typedPrefixes || '').split('|').filter(Boolean);
    prefixes.push($bootName.textContent);
    $boot.dataset.typedPrefixes = prefixes.join('|');
  };

  const snapshotIsValid = (snapshot) => snapshot
    && typeof snapshot.runId === 'string' && snapshot.runId.length > 0
    && Number.isInteger(snapshot.revision) && snapshot.revision >= 0
    && ['running', 'ready', 'degraded'].includes(snapshot.phase)
    && Array.isArray(snapshot.tasks);

  const updateReadinessDataset = () => {
    $boot.dataset.startupPhase = startupTransportFailed
      ? 'degraded'
      : ((startupSnapshot && startupSnapshot.phase) || 'running');
    $boot.dataset.startupRunId = (startupSnapshot && startupSnapshot.runId) || '';
    $boot.dataset.startupRevision = String((startupSnapshot && startupSnapshot.revision) || 0);
    $boot.dataset.localReadiness = localReadiness;
    $boot.dataset.localFailureReason = localFailureReason;
  };

  const applyInitialMode = () => {
    if (!localOnboardState || localOnboardState.needed !== false) {
      startOnboarding(onboarding.resolveOnboardingStartStep(localOnboardState));
    } else if (settingsOpen || !$onboard.hidden) {
      // 부팅 중 자동화가 다른 모드를 먼저 연 경우 그 모드의 배타성을 보존한다.
    } else {
      $app.hidden = false;
      focusChatAfterBoot = true;
    }
  };

  const completeBootSwap = () => {
    if (bootDisposed) return;
    $boot.dataset.phase = 'complete';
    markBootTime('completedAt');
    $shell.classList.remove('boot-shell-reveal', 'is-boot-expanded');
    document.documentElement.classList.remove('is-boot-expanding');
    $boot.hidden = true;
    $boot.setAttribute('aria-busy', 'false');
    bootDisposed = true;
    cancelBootTimers();
    if (offBootReadiness) offBootReadiness();
    const shellRect = $shell.getBoundingClientRect();
    window.athena.send('athena:boot-complete', {
      phase: $boot.dataset.phase,
      finishCount: Number($boot.dataset.finishCount || '0'),
      timings: {
        startedAt: Number($boot.dataset.startedAt || '0'),
        typingAt: Number($boot.dataset.typingAt || '0'),
        typedAt: Number($boot.dataset.typedAt || '0'),
        visualMinimumAt: Number($boot.dataset.visualMinimumAt || '0'),
        reducedStaticAt: Number($boot.dataset.reducedStaticAt || '0'),
        expandingAt: Number($boot.dataset.expandingAt || '0'),
        completedAt: Number($boot.dataset.completedAt || '0'),
        taskFirstShownAt: Number($boot.dataset.taskFirstShownAt || '0'),
      },
      shellFinishedFull: !$shell.hidden
        && ['none', 'inset(0px)'].includes(getComputedStyle($shell).clipPath)
        && Math.abs(shellRect.width - window.innerWidth) <= 1
        && Math.abs(shellRect.height - window.innerHeight) <= 1,
    });
    if (focusChatAfterBoot) {
      $input.focus();
      scrollHistoryToBottom();
      maybeShowCoachmark();
    }
  };

  // startup snapshot + local UI readiness + visual minimum이 모두 충족된 경우에만
  // 이 단일 경로로 셸을 연다. 실패/재시도/중복 push는 finishCount를 늘릴 수 없다.
  const finishBoot = () => {
    if (bootFinishStarted || bootDisposed) return;
    bootFinishStarted = true;
    cancelBootTimers();
    applyInitialMode();

    if (!reducedMotion) {
      $shell.classList.add('boot-shell-reveal');
      document.documentElement.classList.add('is-boot-expanding');
    }
    window.AthenaShell.revealChrome();
    $boot.dataset.finishCount = String(Number($boot.dataset.finishCount || '0') + 1);
    $bootStatus.textContent = 'ATHENA가 준비되었습니다.';

    if (reducedMotion) {
      completeBootSwap();
      return;
    }

    $boot.dataset.phase = 'expanding';
    markBootTime('expandingAt');
    $boot.classList.add('is-expanding');
    void $shell.offsetWidth;
    $shell.classList.add('is-boot-expanded');
    scheduleBoot(completeBootSwap, 480);
  };

  const gateIsReady = () => visualMinimumReached
    && (startupTransportFailed
      || (startupSnapshot && ['ready', 'degraded'].includes(startupSnapshot.phase)))
    && (localReadiness === 'ready' || localReadiness === 'fallback');

  const selectVisibleBootTask = () => {
    if ($bootName.textContent !== 'ATHENA'
      || startupTransportFailed
      || !startupSnapshot) return null;
    const tasks = startupSnapshot.tasks.filter((task) => task && typeof task.label === 'string');
    const activeGate = tasks.find(
      (task) => task.kind === 'gate' && (task.state === 'running' || task.state === 'retrying'),
    );
    const activeContinuous = tasks.find(
      (task) => task.kind === 'continuous' && (task.state === 'running' || task.state === 'retrying'),
    );
    const pendingGate = tasks.find((task) => task.kind === 'gate' && task.state === 'pending');
    const selected = activeGate || activeContinuous || pendingGate;
    if (selected) return { id: selected.id, state: selected.state, label: selected.label.trim() };
    if (['ready', 'degraded'].includes(startupSnapshot.phase) && localReadiness === 'running') {
      return { id: 'local-readiness', state: 'running', label: '화면 설정 확인' };
    }
    return null;
  };

  const renderVisibleBootTask = () => {
    const task = selectVisibleBootTask();
    if (task && !$boot.dataset.taskFirstShownAt) {
      $boot.dataset.taskFirstShownAt = String(performance.now());
    }
    $bootTask.hidden = !task;
    $bootTask.textContent = task ? task.label : '';
    $boot.dataset.currentTaskId = task ? task.id : '';
    $boot.dataset.currentTaskState = task ? task.state : '';
    $boot.dataset.currentTaskLabel = task ? task.label : '';
    return task;
  };

  const renderBootGate = () => {
    if (bootDisposed || bootFinishStarted) return;
    updateReadinessDataset();
    const visibleTask = renderVisibleBootTask();
    if (gateIsReady()) {
      if (reducedMotion) {
        if (!reducedSwapScheduled) {
          reducedSwapScheduled = true;
          $boot.dataset.phase = 'static';
          markBootTime('reducedStaticAt');
          $bootStatus.textContent = 'ATHENA가 준비되었습니다.';
          // readiness 성공 뒤의 정적 paint hold다. readiness를 시간으로 우회하지
          // 않으며, 완성 조판을 실제 합성 프레임으로 제출한 뒤 atomic swap한다.
          scheduleBoot(finishBoot, 80);
        }
        return;
      }
      finishBoot();
      return;
    }
    if (visualMinimumReached) {
      $boot.dataset.phase = 'waiting';
      $bootStatus.textContent = visibleTask ? `${visibleTask.label}.` : '시작 준비 중입니다.';
    } else if (visibleTask) {
      $bootStatus.textContent = `${visibleTask.label}.`;
    }
  };

  const acceptStartupSnapshot = (snapshot, { allowNewRun = false } = {}) => {
    if (!snapshotIsValid(snapshot)) return false;
    if (startupSnapshot) {
      if (snapshot.runId === startupSnapshot.runId) {
        if (snapshot.revision <= startupSnapshot.revision) return false;
      } else if (!allowNewRun) {
        return false;
      }
    }
    startupSnapshot = snapshot;
    startupTransportFailed = false;
    renderBootGate();
    return true;
  };

  const requestLocalReadiness = () => {
    const requestId = ++localReadinessRequestId;
    localReadiness = 'running';
    localFailureReason = '';
    localOnboardState = null;
    renderBootGate();
    return new Promise((resolve) => {
      let settled = false;
      const settle = (state, failureReason = '') => {
        if (settled || requestId !== localReadinessRequestId) return;
        settled = true;
        clearTimeout(timeoutId);
        bootTimers.delete(timeoutId);
        if (failureReason) {
          localOnboardState = { needed: true, step: 2 };
          localReadiness = 'fallback';
          localFailureReason = failureReason;
        } else {
          const validNeeded = state && state.needed === true && (state.step === 2 || state.step === 3);
          const validComplete = state && state.needed === false && state.step === 3;
          if (validNeeded || validComplete) {
            localOnboardState = { needed: state.needed, step: state.step };
            localReadiness = 'ready';
            localFailureReason = '';
          } else {
            localOnboardState = { needed: true, step: 2 };
            localReadiness = 'fallback';
            localFailureReason = 'unconfirmed';
          }
        }
        renderBootGate();
        resolve();
      };
      // 이 deadline도 부팅 생애주기 Set이 소유해야 pagehide/완료 뒤 숨은 callback이
      // 남지 않는다. scheduleBoot은 renderer가 살아 있는 동안 같은 3.5초를 보장한다.
      const timeoutId = scheduleBoot(() => settle(null, 'timeout'), 3500);
      window.athena.invoke('athena:onboarding-state').then(
        (state) => settle(state),
        () => settle(null, 'rejected'),
      );
    });
  };

  // push를 먼저 구독해야 get과 push 사이의 revision을 놓치지 않는다.
  offBootReadiness = window.athena.on('athena:boot-readiness', (snapshot) => {
    acceptStartupSnapshot(snapshot, { allowNewRun: !startupSnapshot });
  });
  window.athena.invoke('athena:boot-readiness:get').then((snapshot) => {
    const accepted = acceptStartupSnapshot(snapshot, { allowNewRun: !startupSnapshot });
    if (!accepted && !startupSnapshot) {
      startupTransportFailed = true;
      renderBootGate();
    }
  }, () => {
    startupTransportFailed = true;
    renderBootGate();
  });
  void requestLocalReadiness();

  window.addEventListener('pagehide', () => {
    bootDisposed = true;
    cancelBootTimers();
    if (offBootReadiness) offBootReadiness();
  }, { once: true });

  // 검사 전용 정지 — 부팅은 화면이 아니라 시간축이라, 러너가 창을 다시 읽어도
  // 지나간 단계로는 되돌아갈 수 없다. 화면계 게이트(probe-paper-screens.js)가 부팅
  // 창을 `?bootHoldChars=N`으로 다시 읽으면 N글자까지만 찍고 그 자리에 선다 —
  // 셸 창의 shellHandoff=1(shell.js:11)과 같은 문법이다. 파라미터가 없는 제품
  // 경로는 이 블록을 지나가지도 않는다.
  const bootHold = /(?:^|[?&])bootHoldChars=([0-6])(?:&|$)/.exec(location.search || '');
  if (bootHold) {
    const held = Number(bootHold[1]);
    'ATHENA'.split('').slice(0, held).forEach(appendBootChar);
    if (held > 0) $boot.dataset.phase = 'typing';
    return;
  }

  if (reducedMotion) {
    // 모션 감소는 타이핑/확장 애니메이션만 생략한다. 부팅 시작부터 완성된 정적
    // ATHENA 프레임을 최소 1.92초 유지한 뒤 같은 readiness gate를 통과한다.
    'ATHENA'.split('').forEach(appendBootChar);
    markBootTime('typedAt');
    $boot.dataset.phase = 'static';
    renderBootGate();
    scheduleBoot(() => {
      visualMinimumReached = true;
      markBootTime('visualMinimumAt');
      renderBootGate();
    }, 1920);
    return;
  }

  // 0~240ms: 투명한 폭 guide + 정적 키움증권 로고 + 빨간 caret 준비 상태.
  scheduleBoot(() => {
    $boot.dataset.phase = 'typing';
    markBootTime('typingAt');
  }, 240);
  // 240~1200ms: 160ms 슬롯 여섯 번. 각 슬롯 끝에 한 글자를 확정하고 caret을
  // 다시 ON으로 만든다. ATHENA는 지우지 않고 다음 셸 확장의 기점으로 쓴다.
  'ATHENA'.split('').forEach((ch, i) => {
    scheduleBoot(() => {
      appendBootChar(ch);
      if (i === 5) {
        markBootTime('typedAt');
        renderBootGate();
      }
    }, 240 + (i + 1) * 160);
  });
  // 1200~1440ms 완성 상태 유지. 1440ms는 expand의 최소 시작점일 뿐이며,
  // startup/local readiness가 아직 running이면 완성 ATHENA 상태로 기다린다.
  scheduleBoot(() => {
    visualMinimumReached = true;
    markBootTime('visualMinimumAt');
    renderBootGate();
  }, 1440);
});

async function onboardAdvance(step) {
  try {
    const res = await window.athena.invoke('athena:onboarding-advance', { step });
    return onboarding.normalizeOnboardingAdvanceResult(res);
  } catch (err) {
    return { ok: false, done: false };
  }
}
function startOnboarding(step) {
  onboardingRevision.invalidate();
  onboardingAccountId = null;
  onboarding.setAppBlockedForOnboarding($shell, $app, true);
  $onboard.hidden = false;
  // 스펙 전체에 "1 / 3" 화면이 없다(00-통합-계획.md §7-2 열린 질문) — main이
  // step:1을 돌려줘도 CLI 연결(2/3)부터 시작한다. 발명 — 리포트에 명시.
  showOnboardingStep(step === 3 ? 3 : 2);
}

function showOnboardingStep(step) {
  if (onboardCleanup) { onboardCleanup(); onboardCleanup = null; }
  const viewRevision = onboardingRevision.next();
  if (step === 3) {
    onboardCleanup = onboarding.renderAccountStep($onboardBody, {
      connectedAccountId: onboardingAccountId,
      onRegistered: (accountId) => {
        if (onboardingRevision.isCurrent(viewRevision)) showAuthConfirm(accountId);
      },
      onUseRegistered: (accountId) => {
        if (onboardingRevision.isCurrent(viewRevision)) showAuthConfirm(accountId);
      },
      onBack: () => {
        if (onboardingRevision.isCurrent(viewRevision)) showOnboardingStep(2);
      },
    });
  } else {
    onboardCleanup = onboarding.renderCliStep($onboardBody, {
      onContinue: async () => {
        const result = await onboardAdvance(2);
        if (!onboardingRevision.isCurrent(viewRevision)) return false;
        if (result.ok) showOnboardingStep(3);
        return result.ok;
      },
    });
  }
  focusOnboardingContent();
}

function focusOnboardingContent() {
  $onboardBody.tabIndex = -1;
  requestAnimationFrame(() => {
    if (!$onboard.hidden) $onboardBody.focus({ preventScroll: true });
  });
}
function showAuthConfirm(accountId) {
  if (onboardCleanup) { onboardCleanup(); onboardCleanup = null; }
  onboardingAccountId = accountId;
  const viewRevision = onboardingRevision.next();
  onboardCleanup = authScreen.renderAuthTokenStatus($onboardBody, {
    accountId,
    embedded: true,
    onBack: () => {
      if (onboardingRevision.isCurrent(viewRevision)) showOnboardingStep(3);
    },
    onContinue: async () => {
      const result = await onboardAdvance(3);
      return onboarding.completeOnboardingIfCurrent(
        result,
        onboardingRevision,
        viewRevision,
        finishOnboarding,
      );
    },
  });
  focusOnboardingContent();
}
function finishOnboarding() {
  onboardingRevision.invalidate();
  if (onboardCleanup) { onboardCleanup(); onboardCleanup = null; }
  $onboard.hidden = true;
  onboarding.setAppBlockedForOnboarding($shell, $app, false);
  onboardingAccountId = null;
  $input.focus();
  scrollAfterRender();
  maybeShowCoachmark(); // 최초 실행은 온보딩을 지나므로 여기가 첫 대화 화면이다
}

// ---------- 계좌 전환 화면 (Paper 보드 16 계정 메뉴 → 1M3-0) ----------
// 온보딩 3/3과 같은 인증 화면이지만 embedded가 아니다: 「이전」·「계속」 없이
// 계좌 목록으로 바로 들어가고, 「취소」·「닫기」 또는 Esc로 닫는다(onClose). 온보딩 오버레이(#onboard)를 그대로
// 쓴다 — 같은 .onb-* 재질이고, 둘이 동시에 열릴 수 있는 경로가 없다(온보딩 중에는
// 셸이 차단돼 사이드바 계정 메뉴에 닿지 못한다).
let accountSwitchOpen = false;
function openAccountSwitchScreen(accountId) {
  if (accountSwitchOpen || !$onboard.hidden || !accountId) return;
  accountSwitchOpen = true;
  onboarding.setAppBlockedForOnboarding($shell, $app, true);
  $onboard.hidden = false;
  onboardCleanup = authScreen.renderAuthTokenStatus($onboardBody, {
    accountId,
    embedded: false,
    initialView: 'switch',
    onClose: closeAccountSwitchScreen,
  });
  focusOnboardingContent();
}

function closeAccountSwitchScreen() {
  if (!accountSwitchOpen) return;
  accountSwitchOpen = false;
  if (onboardCleanup) { onboardCleanup(); onboardCleanup = null; }
  $onboardBody.replaceChildren();
  $onboard.hidden = true;
  onboarding.setAppBlockedForOnboarding($shell, $app, false);
  $input.focus();
}

// ---------- 설정 진입 코치마크 (2026-08-19 결정 — 최초 1회) ----------
// soul.md "설정 아이콘을 찾아 헤매는 경험은 Athena에 없다"의 실측 반례(디자인 비판
// 2026-08-18: 점 호버 툴팁과 '설정' 타이핑 둘 다 사전 지식이 필요한 무발견 경로)에
// 대한 답. 두 진입로(점·커맨드바)를 한 문장으로 1회만 알린다. localStorage 플래그로
// 다시 안 나오고, fixture(자동 검증) 실행에선 띄우지 않는다 — 캡처 결정론 보호.
function maybeShowCoachmark() {
  if (canvasSource === 'fixture') return;
  try { if (localStorage.getItem('athena-coachmark-settings-v3')) return; } catch { return; }
  if (document.querySelector('.coachmark')) return;
  const mark = document.createElement('div');
  mark.className = 'coachmark';
  // 병합 결정(2026-08-27 대화→main) — 대화측 "점=모드 전환" 문구는 셸 v2(전환=
  // 사이드바 네비)·키우미 v5(점=키우미 메뉴) 이후 세계와 안 맞아 main 쪽을 취한다.
  mark.textContent = '키우미를 누르면 파일 첨부·모델 설정이 열립니다 — 설정은 사이드바 계정 메뉴나 "설정" 입력으로';
  document.body.appendChild(mark);
  const shownAt = Date.now();
  const dismiss = (ev) => {
    // 창 포커스용 첫 클릭이 부착 직후 캡처 리스너에 잡혀 아무도 못 보고
    // 사라지던 결함(2026-08-27 실측 — "코치마크 안 뜬다"의 남은 절반).
    // 1.5초 안의 입력은 무시한다 — 자동 소멸(타임아웃)은 ev 없이 와서 통과.
    if (ev && Date.now() - shownAt < 1500) return;
    try { localStorage.setItem('athena-coachmark-settings-v3', '1'); } catch { /* 플래그 실패 시 다음 부팅에 한 번 더 뜬다 — 치명적이지 않다 */ }
    mark.remove();
    window.removeEventListener('pointerdown', dismiss, true);
    window.removeEventListener('keydown', dismiss, true);
  };
  window.addEventListener('pointerdown', dismiss, true);
  window.addEventListener('keydown', dismiss, true);
  setTimeout(() => { if (mark.isConnected) dismiss(); }, 8000);
}

// ---------- 초기 정보 수신 ----------
window.athena.on('athena:init', (payload) => {
  canvasSource = (payload && payload.canvasSource) || 'live';
});

// ---------- 창 표면의 유리 두께 ----------
// 값의 SSOT는 tokens.css 유리 사다리(--glass-window)다 — 여기 하드코드하면 CSS와
// 두 벌이 된다(verify 검증16이 사다리 일치를 단언한다). `--glass-alpha`를 쓰는
// 요소는 이제 셸(#shell, shell.css)이다 — 옛 판에서는 대화 창의 `.app`이었다.
//
// 셸 창은 내용이 늘어도 크기가 그대로이고 늘어나는 것은 영역 안 스크롤이라,
// 창 크기를 유리 두께의 근거로 삼을 수 없다. 근거 없는 값을 계속 흔드는 것보다
// 사다리의 기본 단을 정직하게 고정하는 쪽을 택한다. 두께 조절은 설정 › 화면의
// 유리 5단이 사용자 손에 이미 쥐여준다.
const rootStyles = getComputedStyle(document.documentElement);
const GLASS_WINDOW = parseFloat(rootStyles.getPropertyValue('--glass-window')) || 0.30;
document.documentElement.style.setProperty('--glass-alpha', GLASS_WINDOW.toFixed(3));

// ---------- 이력 스크롤 — 하단 고정(stick-to-bottom) ----------
// .history는 overflow-y:auto다(chat.css) — 채팅 영역이 고정 크기가 된 뒤(리프
// 1.2.1)로는 지난 턴을 되짚는 **유일한** 수단이다. 새 내용이 올 때는 바닥에 붙어
// 따라가되, 사용자가 위로 올려 읽는 중이면(바닥에서 24px 이상) 강제로 끌어내리지
// 않는다.
let stickToBottom = true;
$history.addEventListener('scroll', () => {
  stickToBottom = $history.scrollHeight - $history.scrollTop - $history.clientHeight < 24;
  reportChatViewport();
});

// 세션 보고(42번 보드) — 스크롤 위치와 입력 초안은 세션의 일부다. 렌더러는 무엇이
// 바뀌었는지만 보내고(patch), 어느 세션인지·어떤 모드인지는 main이 안다. 디바운스는
// 여기서 한 번, main의 브리지에서 한 번 더 — 키 입력마다 IPC를 쏘지 않기 위한 것이다.
let chatViewportTimer = null;
function reportChatViewport() {
  if (chatViewportTimer) clearTimeout(chatViewportTimer);
  chatViewportTimer = setTimeout(() => {
    chatViewportTimer = null;
    try {
      window.athena.send('athena:session-viewport', {
        viewport: { chat: { scrollTop: $history.scrollTop, atBottom: stickToBottom } },
      });
    } catch { /* 채널이 없는 하네스 */ }
  }, 400);
}
let chatDraftTimer = null;
function reportChatDraft() {
  if (chatDraftTimer) clearTimeout(chatDraftTimer);
  chatDraftTimer = setTimeout(() => {
    chatDraftTimer = null;
    try {
      window.athena.send('athena:session-workspace', { patch: { draft: { text: $input.value } } });
    } catch { /* 채널이 없는 하네스 */ }
  }, 300);
}

function scrollHistoryToBottom(force) {
  if (force) stickToBottom = true;
  if (stickToBottom) $history.scrollTop = $history.scrollHeight;
}

// ---------- 렌더 직후 바닥 따라가기 ----------
// 옛 이름은 scrollAfterRender()였다 — 창 높이 자동 성장 요청과 하단 고정 스크롤을
// 한 rAF 안에서 같이 했다. 리프 1.2.1에서 높이 요청이 사라져 남은 것은 스크롤뿐이라
// 이름도 그에 맞게 바꿨다(이름이 하는 일보다 크면 다음 사람이 없는 기능을 찾는다).
//
// 함께 사라진 것: measureNeededHeight()(타이틀바·그립·입력 스택·이력 높이를 더해
// 필요한 창 높이를 재던 함수) · 그립 드래그 수동 리사이즈 · athena:zoom-changed
// 재측정 · prefs.autoGrowChat 분기. 넷 다 "창 높이 = 대화 이력 높이"의 부속이다.
// prefs.autoGrowChat 설정 항목 자체는 아직 남아 있다(설정 › 화면) — 아무 효과가
// 없는 항목을 켜 두는 것은 정보 정직성 위반이라 리프 1.4.1이 걷어내야 한다.
function scrollAfterRender() {
  requestAnimationFrame(() => scrollHistoryToBottom());
}

const CARD_PLAN = {
  stream: { label: '스트림', tool: 'search_news', toolLabel: '뉴스 검색' },
  reader: { label: '리더', tool: 'download_document', toolLabel: '공시 원문 조회' },
  table: { label: '공통 테이블', tool: 'get_financial_statement', toolLabel: '재무제표 조회' },
  chart: { label: '차트', tool: 'get_stock_chart', toolLabel: '주가 차트 조회' },
  // AT-ST-001/AT-ST-004 제어 카드 트리거 — 카드 자체는 canvas.js가 그린다
  // (00-통합-계획.md §4.1). tool 코드는 실제 TR/MCP 툴 이름이 아직 없어 이
  // 대화 창 진행 표시용으로만 쓰는 자리표시자다 — 발명, 리포트에 명시.
  accounts: { label: '계좌', tool: 'account_list', toolLabel: '계좌 목록 조회' },
  mcp: { label: 'MCP 서버', tool: 'mcp_server_list', toolLabel: 'MCP 서버 목록 조회' },
};

const CANVAS_TYPE_LABELS = {
  table: '공통 테이블',
  'mcp-table': '공통 테이블',
  stream: '스트림',
  reader: '리더',
  chart: '차트',
  facts: '핵심 정보',
  compound: '복합 정보',
  free: '자유 카드',
  notice: '알림',
};

function canvasTypeLabel(t) {
  // 미지의 타입도 원문 식별자를 새지 않게 한다 — 게이트웨이가 새 canvas_type을
  // 보내기 시작하면 여기 매핑에 등록하는 것이 정직한 경로다.
  return CANVAS_TYPE_LABELS[t] || '카드';
}

// 결과물·출처 바(Paper 44) — 매 턴 이전 값을 지우고 최신 턴만 표시한다(누적 금지). 출처 칩은
// turn-meta가 이미 쓰는 canvasTypeLabel()/canvasTypes를 그대로 재사용한다(새 라벨 안 짓는다) —
// 결과물 캡션만 main.js가 새로 모아준 카드별 표시 이름(canvasCaptions)을 쓴다. 이번 턴에
// 카드가 하나도 없으면(순수 프로즈 답변) 보여줄 결과 자체가 없으므로 숨긴다.
function updateResultDock(cardCount, canvasTypes, canvasCaptions) {
  $resultDockCaption.textContent = '';
  $resultDockChips.textContent = '';
  $resultDockChips.hidden = true;
  $resultDockSources.classList.remove('is-open');
  resultDockHasResults = !!cardCount;
  resultDockDismissed = false; // 새 결과는 ×로 접어 둔 바를 다시 연다
  if (resultDockHasResults) {
    $resultDockCanvasCount.textContent = `+${cardCount} 카드`;
    $resultDockCaption.textContent = (canvasCaptions || []).join(' · ');
    $resultDockSourceCount.textContent = `출처 ${(canvasTypes || []).length}`;
    for (const t of canvasTypes || []) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = canvasTypeLabel(t);
      $resultDockChips.appendChild(chip);
    }
  }
  refreshResultDockVisibility();
}

let activeRecommendationRow = null;

function clearRecommendations() {
  if (!activeRecommendationRow) return;
  for (const button of activeRecommendationRow.querySelectorAll('button')) button.disabled = true;
  activeRecommendationRow.remove();
  activeRecommendationRow = null;
}

function renderRecommendations(turn, recommendations) {
  clearRecommendations();
  if (!Array.isArray(recommendations) || !recommendations.length) return;
  const row = document.createElement('div');
  row.className = 'turn-recommendations';
  row.setAttribute('aria-label', '후속 질문');
  for (const recommendation of recommendations.slice(0, 3)) {
    if (!recommendation || !recommendation.label || !recommendation.query) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recommendation-chip';
    button.textContent = recommendation.label;
    button.setAttribute('aria-label', recommendation.label);
    button.addEventListener('click', () => {
      // Enter 게이트(아래 keydown)와 같은 두 조건이어야 한다 — remoteQueryBusy를
      // 빼먹으면 오브 질의가 도는 중 트레이 복귀로 다시 보인 셸에 남아 있던 칩이
      // 그 질의를 죽인다(2026-08-27 병합 점검 결함① — 결함 #1의 역방향).
      if (state !== 'idle' || remoteQueryBusy) return;
      clearRecommendations();
      dispatchUserQuery(recommendation.query);
    });
    row.appendChild(button);
  }
  if (!row.childElementCount) return;
  turn.appendChild(row);
  activeRecommendationRow = row;
}

function pickCardTypes(text) {
  const t = text.trim();
  const picked = [];
  if (/뉴스|스트림|news/i.test(t)) picked.push('stream');
  if (/공시|리더|마크다운|reader/i.test(t)) picked.push('reader');
  if (/재무|표|테이블|table/i.test(t)) picked.push('table');
  if (/차트|캔들|봉차트|chart/i.test(t)) picked.push('chart');
  if (/계좌|account/i.test(t)) picked.push('accounts');
  if (/MCP|엠씨피/i.test(t)) picked.push('mcp');
  // 키워드가 하나도 안 걸리면 기본값 — 3종 모두 (모자이크 데모)
  return picked.length ? picked : ['stream', 'reader', 'table'];
}

// ---------- 상태 전이 ----------
// time — 경과 시간처럼 매 틱 바뀌는 짧은 값만 따로 받는다. 상태 문구와 한
// 문자열로 합치면 좁은 창에서 말줄임이 시간을 먼저 삼킨다(2026-08-31 사용자
// 지적 — 글자 짤림). 생략하면 시간 표기를 지운다(정적 힌트 호출자들).
function setLocked(locked, text, time) {
  $input.disabled = locked;
  // 잠금 중에는 placeholder를 숨긴다 — 입력이 min-width:0으로 눌리며
  // "무엇이든 물어보세요"가 "무엇이"로 잘려 힌트 옆에 남았다(2026-08-31
  // 사용자 지적). 답하는 중에 질문을 권하는 문구가 떠 있을 이유도 없다.
  $input.placeholder = locked ? '' : '무엇이든 물어보세요';
  $lockHint.hidden = !locked;
  $stopBtn.hidden = !locked;
  $composerSpinner.hidden = !locked;
  if (text) $lockText.textContent = text;
  $lockTime.textContent = locked && time ? time : '';
}

function setDot(mode) {
  $dot.classList.remove('judging', 'calling');
  if (mode) $dot.classList.add(mode);
}

// F-stage5b-FE(F2-스트레치) — "이어진 대화" 계측. 직전 능동 턴(routine-fired)
// 이후 처음 보내는 질의만 replied로 기록한다(engagement.py는 판정 로직이
// 없다 — "이어졌다"의 시간 창은 여기서 정의한다). renderAgentTurn이 kind가
// fired일 때만 채운다(만료·복원실패는 "이어갈" 발화 자체가 아니다).
const REPLIED_WINDOW_MS = 10 * 60 * 1000; // 발화 후 10분 안에 말을 걸면 "이어졌다"로 본다.
let lastFiredRoutine = null; // { routineId, at } | null

function maybeRecordReplied() {
  if (!lastFiredRoutine) return;
  const { routineId, at } = lastFiredRoutine;
  lastFiredRoutine = null; // 한 번만 — 다음 질의부터는 이미 "이어짐"이 확정됐다.
  if (Date.now() - at > REPLIED_WINDOW_MS) return;
  window.athena.invoke('athena:routine-engagement', { id: routineId, event: 'replied' }).catch(() => {});
}

async function runQuery(text) {
  maybeRecordReplied();
  if (canvasSource === 'fixture') return runQueryFixture(text);
  return runQueryLive(text);
}

// 완료된 턴의 실행 기록 보존(단계 9, board-04 "⑥ 경과 헤더") — 진행 중 그렸던
// toolSteps를 다시 그리지 않고 그대로 옮겨 붙인 뒤 접는다(AC6: 펼쳤을 때
// 라벨·소요시간이 진행 중 표시와 동일해야 한다 — 같은 DOM 노드라 항상 같다).
// 도구 호출이 하나도 없던 턴(순수 프로즈 답변)은 접을 기록이 없으므로 null —
// 호출자는 그때 아무것도 붙이지 않는다.
//
// aborted(2026-08-27, Paper DFQ-0 확정 명세) — Esc 중단 턴도 이 함수를 거친다.
// 계획 v5의 5.3 결정("Esc 중단은 이 함수를 아예 안 거친다 — AC10 의도적
// 비대칭")을 뒤집는 사용자 지시로, AC10을 반전한다: 완료 헤더 2FW-0과 같은
// 골격(헤어라인 구분선·접기 캐럿)에 warn-dot(기존 .turn-fail-dot 재사용,
// 6×6 var(--color-warn) — 새 점 안 만든다)과 "{N}초 만에 중단됨" 문구만
// 더한다. 실패 버블(turn-fail-*)보다는 조용하게 — 굵은 라벨·모노 캡스 없음.
// 활동 줄 문구(Paper 44) — 도구 라벨별로 세어 "현재가 조회 2개, 일봉 차트 1개 (1개 실패)".
// 라벨은 main.js TOOL_STEP_LABELS가 정한 그대로(tool-step-track이 실패에 붙인 " 실패"만 뗀다).
function summarizeToolSteps(steps) {
  const counts = new Map();
  let failed = 0;
  for (const s of steps.values()) {
    const base = s.error ? String(s.label).replace(/ 실패$/, '') : s.label;
    counts.set(base, (counts.get(base) || 0) + 1);
    if (s.error) failed += 1;
  }
  const parts = [];
  for (const [label, n] of counts) parts.push(`${label} ${n}개`);
  return parts.join(', ') + (failed ? ` (${failed}개 실패)` : '');
}

function foldExecutionRecord(toolSteps, startedAt, { aborted = false, steps = null } = {}) {
  if (!toolSteps || !toolSteps.childElementCount) return null;
  const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  const header = document.createElement('button');
  header.type = 'button';
  header.className = aborted ? 'turn-exec-header is-aborted' : 'turn-exec-header';
  if (aborted) {
    const dot = document.createElement('span');
    dot.className = 'turn-fail-dot'; // 재사용 — 새 warn-dot 클래스를 안 만든다
    header.appendChild(dot);
  }
  const label = document.createElement('span');
  label.className = 'turn-exec-header-label';
  const summary = steps && steps.size ? summarizeToolSteps(steps) : '';
  label.textContent = aborted
    ? `${seconds}초 만에 중단됨`
    : (summary || `${seconds}초 동안 작업함`);
  const caret = document.createElement('span');
  caret.className = 'turn-exec-header-caret';
  caret.appendChild(chevronSvg('right'));
  header.append(label, caret);
  // 기본 접힘(Paper 44, 2026-09-05 — Claude Code 정합). 어떤 도구를 불렀는지는 접힌 줄이
  // 종류별 개수로 말하고, 행 목록은 클릭 한 번으로 펼친다. 2026-08-31의 기본 펼침을 대체한다.
  toolSteps.hidden = true;
  header.addEventListener('click', () => {
    toolSteps.hidden = !toolSteps.hidden;
    header.classList.toggle('is-open', !toolSteps.hidden);
  });
  const record = document.createElement('div');
  record.className = 'turn-exec-record';
  record.append(header, toolSteps);
  return record;
}

// 실패 턴 버블(단계 7, board 1Y3-0 "실패 턴" C8B-0) — 기존
// .turn-agent.agent-restore-failed 카드 레시피의 자매 컴포넌트. 성공 버블
// (.turn-a, 각인 text-shadow 있음)과 시각적으로 구분되는 별도 패널이다 — 워닝
// 닷·"질의 실패" 라벨이 상태를 말해주므로 본문엔 "실패 — " 접두사 없이 원문만
// 넣는다. runQueryLive의 정상 실패 경로와 orb-turn-committed(오브에서 오간 턴의
// 뒤늦은 반영) 둘 다 이 함수 하나로 그린다(라벨 두 벌 방지).
function renderFailureBubble(aLine, errorText) {
  const card = document.createElement('div');
  card.className = 'turn-fail-card';
  const head = document.createElement('div');
  head.className = 'turn-fail-head';
  const dot = document.createElement('span');
  dot.className = 'turn-fail-dot';
  const label = document.createElement('span');
  label.className = 'turn-fail-label';
  label.textContent = '질의 실패';
  head.append(dot, label);
  const body = document.createElement('div');
  body.className = 'turn-fail-body';
  body.textContent = errorText;
  card.append(head, body);
  aLine.appendChild(card);
}

// 보낸 말풍선의 '@참조'는 칩으로 그린다(보드 22) — 입력창은 평문 textarea라 치는 동안에는
// 칩이 될 수 없고, 사람이 노드를 눌러 넣은 참조가 무엇이었는지는 보낸 뒤에 남으면 된다.
// innerHTML은 쓰지 않는다: 원문을 잘라 span에 textContent로 넣으므로 무엇이 와도 태그가
// 되지 않는다(이 파일의 innerHTML 0건 규칙 그대로). 흐름 참조 둘은 이름에 공백이 있어
// (@진입 흐름·@청산 흐름) 낱말 규칙만으로는 반쪽만 칩이 된다 — 그래서 먼저 걸러낸다.
function paintUserBubbleText(el, text) {
  const value = String(text == null ? '' : text);
  const re = /@(?:진입 흐름|청산 흐름|[A-Za-z0-9_가-힣][A-Za-z0-9_가-힣-]*)/g;
  el.textContent = '';
  let last = 0;
  let m = re.exec(value);
  while (m) {
    if (m.index > last) el.appendChild(document.createTextNode(value.slice(last, m.index)));
    const chip = document.createElement('span');
    chip.className = 'chat-ref-chip';
    chip.textContent = m[0];
    el.appendChild(chip);
    last = m.index + m[0].length;
    m = re.exec(value);
  }
  if (last < value.length) el.appendChild(document.createTextNode(value.slice(last)));
}

async function runQueryLive(text) {
  const myToken = ++abortToken;
  let clientSubmitId = null;
  const claimProviderVisible = (meta, owner, node) => {
    if (!meta || !clientSubmitId || meta.clientSubmitId !== clientSubmitId) return false;
    return window.AthenaProviderFirstPaint.claimFirstVisible({
      clientSubmitId,
      turnId: meta.turnId,
      sequence: meta.sequence,
      origin: 'shell',
      owner,
      node,
      rendererReceivedAt: meta.rendererReceivedAt,
    });
  };
  clearRecommendations();

  const qLine = document.createElement('div');
  qLine.className = 'turn';
  const qText = document.createElement('div');
  qText.className = 'turn-q';
  paintUserBubbleText(qText, text);
  qLine.appendChild(qText);
  $history.appendChild(qLine);
  scrollHistoryToBottom(true); // 새 질문은 무조건 바닥으로 — 위에서 읽던 중이어도 새 턴이 우선이다
  scrollAfterRender();
  // 새 턴 시작 — "기록 안 됨" 배지가 붙을 줄 참조를 갱신(main이 진입 직후 role:user
  // 저장을 이미 시도하므로 여기서부터 실패 이벤트가 올 수 있다).
  saveFailedRouter.startTurn(qLine);

  state = 'judging';
  setDot('judging');
  setLocked(true, 'Claude에게 물어보는 중 — 수십 초 걸릴 수 있다');
  // 진행 상태 텍스트는 하단 잠금 힌트(setLocked) 한 곳에만 쓴다(2026-08-27
  // 사용자 지적 — 버블 안 중복 표시 제거). 이 progress 요소는 툴 스텝 전용.
  const progress = document.createElement('div');
  progress.className = 'progress-line';
  const startedAt = Date.now();
  // 실행 라인(2026-08-26 어드버서리얼 리뷰 결함 #3, board-04 "⑧ 실행 라인") —
  // progress의 자식으로 둔다: Esc 중단(위 972행 근처)이 liveProgressEl 하나만
  // remove()하므로, 여기 붙여야 중단 시에도 같이 지워진다(고아 DOM 방지).
  const toolSteps = document.createElement('div');
  toolSteps.className = 'progress-tool-steps';
  progress.appendChild(toolSteps);
  $history.appendChild(progress);
  liveProgressEl = progress;
  liveProgressEl.startedAt = startedAt; // Esc 핸들러가 중단 헤더의 경과초를 재려면 필요하다
  scrollAfterRender();

  let cardCount = 0;
  let calling = false;
  // 카드 우선 표시(US-006, 2026-08-26 강화판) — 프리앰블 실측 결함(모델이
  // render_canvas 호출 전에 "확인해 보겠습니다"류 문장을 먼저 쓴 사례를
  // E2E로 잡음) 이후, "render_canvas가 이번 턴에 떴는지"만 보던 원래 판정을
  // 버리고 **모든 claude 경로 턴의 첫 텍스트 조각부터** 붙든다. 방출 시점은
  // lib/text-release-ladder.js(순수 상태기계, 단위 테스트로 사다리 4조건을
  // 전부 고정)가 정한다 — 여기서는 그 판정에 텍스트 누적·DOM 반영만 잇는다.
  // 프로즈 전용 턴(카드가 아예 없는 질문) 최초 페인트에 최대 2.5초 지연이
  // 붙는 건 의도된 비용이다(사다리 모듈 머리말 참고) — 카드가 오는 턴은
  // 카드 도착이나 툴 종결로 그보다 먼저 풀리는 게 보통이다. 유실 걱정은
  // 안 한다 — 턴이 끝나면 아래("최종 텍스트는 응답값이 권위" 블록)가 버블을
  // 새로 만들어서라도 authoritative answerText로 항상 덮어쓴다.
  let bufferedText = '';
  let bufferedTextMeta = null;
  const releaseLadder = createTextReleaseLadder({
    onRelease: () => {
      if (bufferedText) {
        clearThinkingPreview(); // appendToBubble보다 먼저 선언돼도 클로저라 호출 시점엔 문제없다.
        appendToBubble(bufferedText, bufferedTextMeta);
        bufferedText = '';
        bufferedTextMeta = null;
      }
    },
  });
  const elapsedText = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  const renderProgress = () => {
    if (myToken !== abortToken) return;
    // 문구는 대화 브랜치 디자인 정합(9ce2279)을 따르고, 표시는 main 결정(2026-08-27
    // 버블 안 중복 제거)대로 하단 잠금 힌트 한 곳에만 쓴다(병합 2026-08-27).
    //
    // 카드 수는 **실제로 그린 것이 있을 때만** 말한다(2026-09-03 사용자 지적 —
    // "카드 0개 렌더됨 이런 건 그냥 없애도 될 듯"). 0개인데 "렌더됨"이라고 쓰면
    // 아무것도 안 그렸는데 그렸다고 말하는 것이고, 그 긴 문구가 잠금 힌트의 폭을
    // 통째로 가져가 입력창을 밀어냈다(같은 행을 나눠 쓴다 — chat.css .input-row).
    const base = calling
      ? (cardCount > 0 ? `카드 ${cardCount}개 렌더됨` : '답변 중…')
      // "TR"은 키움 시세 요청의 이름이다 — 그래프·백테스트 모드에서는 부를 TR이
      // 없는데도 이 문구가 떴다(2026-09-03 실사용 제보). 그래프 접두는 시세 경로를
      // 닫아 두는데(live-prompt.js) 진행 문구만 그것을 몰랐다. 모드와 무관하게
      // 참인 말로 바꾼다 — 무엇을 고르는 중인지는 TOOL_STEP_LABELS가 곧 말해 준다.
      : '판단 중 — 어떤 도구를 쓸지 고르는 중';
    setLocked(true, base, elapsedText());
    renderAgentCardElapsed();
  };
  // 100ms 간격 — 표기는 소수 1자리(29.3s)인데 1초 간격으로 갱신하면 소수 자리가
  // 항상 .0으로만 보여 정수 표시와 구별되지 않았다(2026-08-18 사용자 지시).
  const tick = setInterval(renderProgress, 100); // 진행이 눈에 보이게 — 조용히 멈춘 것처럼 보이면 안 된다

  const onLiveCanvasAdded = () => {
    if (myToken !== abortToken) return;
    if (!calling) { calling = true; state = 'calling'; setDot('calling'); }
    cardCount += 1;
    releaseLadder.onCanvasLanded(); // 카드 우선 표시(US-006) 조건(a) — 카드 우선의 본래 목적.
    renderProgress();
    scrollAfterRender();
  };
  const unsubscribeLiveCanvasAdded = window.athena.on('athena:live-canvas-added', onLiveCanvasAdded);

  // 실행 라인(2026-08-26 어드버서리얼 리뷰 결함 #3) — main.js가 tool_use/
  // tool_result에서 뽑아 보내는 단계를 그린다. orb.js가 이미 쓰는 판정
  // (lib/tool-step-track.js)을 그대로 나눠 쓴다 — 라벨을 두 벌 짓지 않는다.
  const toolStepStates = new Map();
  // Esc 핸들러(top-level 리스너, 이 클로저 밖)가 "접을 기록이 있는가"를 판정할
  // 유일한 다리 — liveProgressEl 프로퍼티로 노출한다(2026-08-27, foldExecutionRecord
  // 위 주석의 aborted 분기와 짝).
  liveProgressEl.toolStepStates = toolStepStates;
  const toolStepEls = new Map();
  const onLiveToolStep = (step) => {
    if (myToken !== abortToken) return;
    const result = toolStepTrack.applyToolStep(toolStepStates, step);
    if (!result) return;
    if (!calling) { calling = true; state = 'calling'; setDot('calling'); }
    // 카드 우선 표시(US-006) — result는 이미 {id,label,done} 모양이라
    // 사다리가 그대로 받는다(새 IPC 없음, 기존 tool-step 구독 재사용).
    releaseLadder.onToolStep(result);
    let el = toolStepEls.get(result.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'progress-tool-step';
      const icon = document.createElement('span');
      icon.className = 'progress-tool-step-icon';
      const label = document.createElement('span');
      label.className = 'progress-tool-step-label';
      const time = document.createElement('span');
      time.className = 'progress-tool-step-time';
      el.append(icon, label, time);
      toolSteps.appendChild(el);
      toolStepEls.set(result.id, el);
    }
    el.classList.toggle('done', result.done);
    el.classList.toggle('is-warn', result.error);
    el.querySelector('.progress-tool-step-label').textContent = result.label;
    el.querySelector('.progress-tool-step-time').textContent = result.timeText;
    scrollAfterRender();
    claimProviderVisible({ ...step, rendererReceivedAt: performance.now() }, 'chat', el);
  };
  const unsubscribeLiveToolStep = window.athena.on('athena:live-tool-step', onLiveToolStep);

  // 하위 에이전트 카드(Paper 44 agent-card, 2026-09-05) — 턴에 카드 하나. 첫 task_started에서
  // 진행 라인 바로 뒤(이력)에 생기고, 전이마다 제목·개수·경과·격자를 다시 그린다. 턴이 끝나도
  // 기록으로 남는다(2026-08-31의 알약 줄·도크 행이 하던 일을 합쳤다). 이름은 task_progress의
  // 최신 값이다(연구 문서 §2b). task_notification의 summary는 안 낸다(output_file 노출 규율).
  const subagentStates = new Map(); // taskId -> { description, status }
  let agentCard = null;
  function formatAgentElapsed(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}초`;
    return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`;
  }
  function ensureAgentCard() {
    if (agentCard) return agentCard;
    const line = document.createElement('div');
    line.className = 'turn';
    const card = document.createElement('div');
    card.className = 'agent-card';
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'agent-card-head';
    const title = document.createElement('span');
    title.className = 'agent-card-title';
    const caret = document.createElement('span');
    caret.className = 'agent-card-caret';
    caret.appendChild(chevronSvg('right'));
    head.append(title, caret);
    const sub = document.createElement('div');
    sub.className = 'agent-card-sub';
    const subLabel = document.createElement('span');
    subLabel.textContent = '하위 에이전트';
    const count = document.createElement('span');
    count.className = 'agent-card-count';
    const elapsed = document.createElement('span');
    elapsed.className = 'agent-card-elapsed';
    sub.append(subLabel, count, elapsed);
    const grid = document.createElement('div');
    grid.className = 'agent-card-grid';
    const list = document.createElement('div');
    list.className = 'agent-card-list';
    list.hidden = true;
    head.addEventListener('click', () => {
      list.hidden = !list.hidden;
      head.classList.toggle('is-open', !list.hidden);
    });
    card.append(head, sub, grid, list);
    line.appendChild(card);
    progress.after(line); // 진행 라인 뒤 = 시간 순서. 턴이 끝나 진행 라인이 사라져도 카드는 남는다.
    agentCard = { line, title, count, elapsed, grid, list, startedAt: Date.now(), frozen: false };
    return agentCard;
  }
  // 경과는 진행 중에만 흐르고, 전부 끝나면 그 값에서 멈춘다(renderProgress 틱이 부른다).
  function renderAgentCardElapsed() {
    if (!agentCard || agentCard.frozen) return;
    let running = false;
    for (const s of subagentStates.values()) if (s.status !== 'completed') running = true;
    agentCard.elapsed.textContent = formatAgentElapsed(Date.now() - agentCard.startedAt);
    if (!running) agentCard.frozen = true;
  }
  function renderAgentCard() {
    const card = ensureAgentCard();
    card.grid.textContent = '';
    card.list.textContent = '';
    let firstDescription = null;
    for (const s of subagentStates.values()) {
      if (!firstDescription && s.description) firstDescription = s.description;
      const done = s.status === 'completed';
      const cell = document.createElement('span');
      cell.className = `agent-card-cell ${done ? 'is-done' : 'is-running'}`;
      card.grid.appendChild(cell);
      const row = document.createElement('div');
      row.className = 'agent-card-row';
      const rowCell = cell.cloneNode(false);
      rowCell.classList.add('agent-card-row-cell');
      const name = document.createElement('span');
      name.className = 'agent-card-row-name';
      name.textContent = s.description || '하위 에이전트';
      const stateEl = document.createElement('span');
      stateEl.className = 'agent-card-row-state';
      stateEl.textContent = done ? '완료' : '작업 중';
      row.append(rowCell, name, stateEl);
      card.list.appendChild(row);
    }
    card.title.textContent = firstDescription || '하위 에이전트';
    card.count.textContent = `${subagentStates.size}개`;
    card.frozen = false;
    renderAgentCardElapsed();
  }
  const onLiveSubagentStep = (step) => {
    if (myToken !== abortToken || !step || !step.taskId) return;
    let s = subagentStates.get(step.taskId);
    if (!s) {
      s = { description: null, status: 'running' };
      subagentStates.set(step.taskId, s);
    }
    if (step.subtype === 'task_started') {
      s.description = step.description;
    } else if (step.subtype === 'task_progress') {
      // description이 시작 때와 다르게 갱신될 수 있다(실측, .omc/research/
      // 2026-08-27-서브에이전트-스트림-계약.md §2b) — 최신 값을 반영한다.
      if (step.description) s.description = step.description;
    } else if (step.subtype === 'task_updated') {
      // 확정된 상태값은 completed 하나뿐이다(실측 미관측 — 실패/취소 라벨을
      // 지어내지 않는다). completed가 아니면 이미 갖고 있던 상태를 유지한다.
      if (step.status === 'completed') s.status = 'completed';
    }
    renderAgentCard();
    scrollAfterRender();
  };
  const unsubscribeLiveSubagentStep = window.athena.on('athena:live-subagent-step', onLiveSubagentStep);

  // 말걸기 가드 확인 카드(F-stage9) — 이 턴이 athena_nudge_guard를
  // propose로 불렀다면 main.js가 tool_result에서 뽑아 보낸다(아래
  // renderGuardConfirmCard 참고, 폴링으로는 발견 불가능한 비영속 데이터라
  // 이 턴 전용 구독이 유일한 신호다).
  const onNudgeGuardProposed = (payload) => {
    if (myToken !== abortToken) return;
    renderGuardConfirmCard(payload, text);
  };
  const unsubscribeNudgeGuardProposed = window.athena.on('athena:nudge-guard-proposed', onNudgeGuardProposed);

  // 모델이 낸 플러그인 제안은 이 턴의 산물이다 — 채팅에는 제안 턴 한 장만
  // 남는다. 캔버스 카드는 canvas.js의 모듈 스코프 구독이 그리고(턴이 끝나도
  // 카드는 남아야 한다), GUI 버튼 경로는 채팅 턴을 만들지 않는다.
  const onPluginProposed = (envelope) => {
    if (myToken !== abortToken) return;
    // 모드 밖이면 캔버스가 봉투를 폐기한다 — 그때 채팅에 남는 것은 폐기를
    // 알리는 한 줄뿐이고, 제안 턴은 만들지 않는다(없는 카드를 가리키게 된다).
    if (pluginModeLib.currentMode() !== 'plugin') return;
    renderPluginProposalTurn(envelope);
  };
  const unsubscribePluginProposed = window.athena.on('athena:plugin-proposed', onPluginProposed);
  // 폐기 한 줄의 중복 억제는 이 턴 안에서만이다 — 세션 내내 눌러 두면 다음
  // 턴에 같은 요청을 다시 해도 아무 말도 하지 않는다.
  pluginOutOfMode.reset();

  // 추론 미리보기(2026-08-26) — 답변 텍스트가 나오기 전 긴 침묵 구간을 채운다.
  // 미리보기 전용이다: 옅은 색·작은 글씨로 뚜렷이 구분하고, 답변 첫 조각이
  // 오거나 턴이 끝나면 즉시 지운다 — 턴 기록에는 절대 안 남는다.
  let thinkingLine = null;
  let thinkingBody = null;
  let thinkingText = '';
  const clearThinkingPreview = () => {
    if (!thinkingLine) return;
    thinkingLine.remove();
    thinkingLine = null;
    thinkingBody = null;
  };
  const onLiveThinkingDelta = ({ text: delta } = {}) => {
    if (myToken !== abortToken || !delta) return;
    if (!calling) { calling = true; state = 'calling'; setDot('calling'); }
    if (!thinkingLine) {
      thinkingLine = document.createElement('div');
      thinkingLine.className = 'turn turn-thinking-preview';
      const label = document.createElement('div');
      label.className = 'turn-thinking-label';
      label.textContent = '추론 중…';
      thinkingBody = document.createElement('div');
      thinkingBody.className = 'turn-thinking-body';
      thinkingLine.appendChild(label);
      thinkingLine.appendChild(thinkingBody);
      $history.appendChild(thinkingLine);
    }
    thinkingText += delta;
    thinkingBody.textContent = thinkingText;
    scrollAfterRender();
  };
  const unsubscribeLiveThinkingDelta = window.athena.on('athena:live-thinking-delta', onLiveThinkingDelta);

  // 답변 텍스트 조각(2026-08-26 S2) — 턴이 끝나야만 답이 보이던 것을 없앤다.
  // 첫 조각이 와야 버블을 만든다(빈 버블을 먼저 안 띄운다 — 카드 진행 표시와
  // 같은 원칙). REST 직결·캐시 리플레이 경로는 claude 프로세스를 안 띄우므로
  // 이 이벤트가 아예 안 온다 — 그 경로는 항상 이 블록 없이 기존대로 동작한다.
  let streamALine = null;
  let streamAText = null;
  let streamedText = '';
  const appendToBubble = (text, meta = null) => {
    if (!streamALine) {
      streamALine = document.createElement('div');
      streamALine.className = 'turn';
      streamAText = document.createElement('div');
      streamAText.className = 'turn-a';
      streamALine.appendChild(streamAText);
      $history.appendChild(streamALine);
    }
    streamedText += text;
    // 마크다운으로 다시 그린다 — **강조**·`코드`·목록 기호가 원문 그대로
    // 노출되던 문제(2026-08-31 사용자 지적). 전체 재렌더지만 조각당 정규식
    // 몇 개 수준이라 스트리밍에 부담이 없다.
    window.AthenaLib.Markdown.render(streamAText, streamedText);
    scrollAfterRender();
    claimProviderVisible(meta, 'chat', streamAText);
  };
  const onLiveTextDelta = (payload = {}) => {
    const { text: delta } = payload;
    if (myToken !== abortToken || !delta) return;
    if (!calling) { calling = true; state = 'calling'; setDot('calling'); }
    releaseLadder.onTextDelta(); // 첫 조각에서만 조건(c) 유예 타이머를 켠다(사다리 내부 판단).
    if (!releaseLadder.released) {
      bufferedText += delta; // 아직 방출 조건이 안 왔다 — 화면엔 안 그리고 모아만 둔다.
      if (!bufferedTextMeta) bufferedTextMeta = { ...payload, rendererReceivedAt: performance.now() };
      return;
    }
    clearThinkingPreview(); // 답변이 시작됐다 — 추론 미리보기는 자리를 비켜준다
    appendToBubble(delta, { ...payload, rendererReceivedAt: performance.now() });
  };
  const unsubscribeLiveTextDelta = window.athena.on('athena:live-text-delta', onLiveTextDelta);

  let result;
  // 오브 "생각 중" 실신호(2026-08-26 board-32) — 스피너 대신 오브 시선이 위를
  // 훑는다. 여기 감싸는 구간이 실제 질의 왕복이다(claude -p 또는 캐시 리플레이).
  window.athena.send('athena:orb-signal', { signal: 'think', active: true });
  try {
    clientSubmitId = window.crypto.randomUUID();
    const rendererSubmittedAt = performance.now();
    window.AthenaProviderFirstPaint.registerSubmit({ clientSubmitId, rendererSubmittedAt, origin: 'shell' });
    // @멘션은 여기서만 동봉한다 — 사용자 버블(qText)에는 타이핑 원문이 남는다.
    result = await window.athena.invoke('athena__render_canvas', {
      source: 'live', query: augmentMentions(text), expand: prefs.autoExpandCanvas,
      clientSubmitId, rendererSubmittedAt,
      // 백테스트 설계 턴 — main.js가 모드·폼 상태를 buildLiveTurnPrompt에 넘긴다. 모델은
      // 폼을 읽기만 하고, 바꾸는 것은 propose_spec 초안 카드의 [적용]을 사람이 누를 때다.
      canvasMode: (window.AthenaCanvasMode && window.AthenaCanvasMode.state && window.AthenaCanvasMode.state.view) || 'summary',
      backtestContext: (window.AthenaBacktestCanvas && typeof window.AthenaBacktestCanvas.getContext === 'function')
        ? window.AthenaBacktestCanvas.getContext() : null,
      // 그래프 모드 턴(2026-09-02) — 지금 보고 있는 그래프 상태를 함께 넘긴다.
      // 없으면 모델은 그래프의 존재조차 몰라 시세 질문으로 되묻는다(실측).
      graphContext: (window.AthenaCanvasMode && typeof window.AthenaCanvasMode.getContext === 'function')
        ? window.AthenaCanvasMode.getContext() : null,
    });
  } catch (err) {
    // 핸들러가 reject하면(예: main 쪽 미처리 예외) 결과 없이 아래로 떨어져
    // 잠금·타이머가 얼어붙었다(2026-08-31 실측). 실패 턴으로 정직하게 그린다.
    result = { ok: false, error: String((err && err.message) || err) };
  } finally {
    clearInterval(tick);
    unsubscribeLiveCanvasAdded();
    unsubscribeLiveToolStep();
    unsubscribeLiveSubagentStep();
    unsubscribeNudgeGuardProposed();
    unsubscribePluginProposed();
    unsubscribeLiveThinkingDelta();
    unsubscribeLiveTextDelta();
    releaseLadder.dispose(); // 유예 타이머 누수 방지 — 방출 자체는 아래 authoritative overwrite의 몫.
    // stale 턴은 끄지 않는다 — Esc로 죽인 질의 A가 새 질의 B 도중 뒤늦게 settle하면
    // 무조건 끄기가 B의 THINK 얼굴을 삼킨다(2026-08-27 병합 점검 결함②).
    // 중단된 턴의 끄기는 Esc 핸들러가 즉시 보낸다(아래 keydown의 짝 주석 참고).
    if (myToken === abortToken) window.athena.send('athena:orb-signal', { signal: 'think', active: false });
    // 방어적 — 답변 조각이 한 번도 안 오고 턴이 끝나는 경로(예: 조기 중단)에서도
    // 미리보기가 턴 기록에 남지 않게 한다.
    clearThinkingPreview();
  }
  if (myToken !== abortToken) return;

  // 오브 "완료" 실신호 — 성공한 턴에만 붙인다(result ok). 실패는 웃을 일이 아니다.
  if (result && result.ok) {
    window.athena.send('athena:orb-signal', { signal: 'done', active: true });
  }

  state = 'idle';
  setDot(null);
  setLocked(false);
  const execRecord = foldExecutionRecord(toolSteps, startedAt, { steps: toolStepStates });
  progress.remove();
  liveProgressEl = null;

  // 스트리밍 중 만든 버블이 있으면 그대로 이어 쓴다(재부착 없음 — 이미
  // $history 안에 있다). 없으면(REST 직결·캐시 리플레이·조각 0개) 기존처럼 새로 만든다.
  const aLine = streamALine || document.createElement('div');
  aLine.className = 'turn';
  if (execRecord) aLine.insertBefore(execRecord, aLine.firstChild);
  if (result && !result.ok) {
    // 스트리밍 버블이 이미 떠 있어도 실패는 실패로 보인다 — 원래(af8bb81)는
    // 어느 경로든 '실패 — ' 텍스트로 덮어썼는데 36f2a57이 실패 카드를 도입하며
    // !streamALine 경로만 바꿔 스트리밍-후-실패 턴이 '완료'처럼 렌더되던 회귀
    // (2026-08-27 병합 점검 M4, 반박 검증 CONFIRMED). 부분 스트리밍 텍스트는
    // 권위가 없으므로 제거하고 실패 카드가 대체한다(기존 덮어쓰기와 같은 원칙).
    if (streamAText) streamAText.remove();
    renderFailureBubble(aLine, (result && result.error) || '알 수 없는 오류');
  } else {
    const aText = streamAText || document.createElement('div');
    aText.className = 'turn-a';
    // 최종 텍스트는 응답값이 권위다(스트리밍 누적치가 아니다) — 조각이 유실되거나
    // 순서가 어긋나도 이 줄이 항상 진짜 답으로 덮어쓴다.
    window.AthenaLib.Markdown.render(
      aText,
      result && result.answerText
        ? result.answerText
        : `완료 — 카드 ${cardCount}개, 답변 텍스트 없음`,
    );
    if (!streamALine && !(result && result.answerPaintedByMain)) aLine.appendChild(aText);
  }

  const meta = document.createElement('div');
  meta.className = 'turn-meta';
  const canvasTypes = (result && result.canvasTypes) || [];
  for (const t of canvasTypes) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    // 실제 응답 canvas_type(table/free/...) — 요청값이 아니다. 화면에는 한국어
    // 라벨로만 낸다(내부 식별자 노출 금지, CANVAS_TYPE_LABELS 주석 참조).
    chip.textContent = canvasTypeLabel(t);
    meta.appendChild(chip);
  }
  updateResultDock(cardCount, canvasTypes, result && result.canvasCaptions);
  // 처리 경로·소요시간 푸터("claude -p · 11.0s")는 내부 진단 정보라 제거했다
  // (2026-08-31 사용자 확정) — 실행 세부는 접히는 실행 기록이 이미 갖고 있다.
  aLine.appendChild(meta);
  renderRecommendations(aLine, result && result.recommendations);

  if (!streamALine) $history.appendChild(aLine);
  saveFailedRouter.setAssistantLine(aLine);
  scrollAfterRender();
  $input.focus();

  // 방금 턴에서 모델이 athena_routine(draft)로 제안했을 수 있다 — 승인 카드는
  // 스트림 파싱이 아니라 백엔드 목록 재조회로 결정론적으로 띄운다(P3).
  refreshRoutineDrafts();
}

async function runQueryFixture(text) {
  const myToken = ++abortToken;
  const types = pickCardTypes(text);

  const qLine = document.createElement('div');
  qLine.className = 'turn';
  const qText = document.createElement('div');
  qText.className = 'turn-q';
  qText.textContent = text;
  qLine.appendChild(qText);
  $history.appendChild(qLine);
  scrollHistoryToBottom(true);
  scrollAfterRender();

  // 상태 1 — 판단 중
  state = 'judging';
  setDot('judging');
  setLocked(true, '어떤 TR을 부를지 고르는 중');
  const progress = document.createElement('div');
  progress.className = 'progress-line';
  const progText = document.createElement('span');
  progText.textContent = '어떤 TR을 부를지 고르는 중';
  const progTrs = document.createElement('span');
  progTrs.className = 'progress-trs';
  progress.appendChild(progText);
  progress.appendChild(progTrs);
  $history.appendChild(progress);
  liveProgressEl = progress;
  scrollAfterRender();

  await wait(550);
  if (myToken !== abortToken) return;

  // 상태 2 — 호출·렌더 중
  state = 'calling';
  setDot('calling');
  const trEls = {};
  for (const type of types) {
    const code = document.createElement('span');
    code.className = 'tr-code';
    code.textContent = CARD_PLAN[type].toolLabel; // 화면은 사용자 언어 — 원문 코드는 UI에 안 낸다
    progTrs.appendChild(code);
    trEls[type] = code;
  }

  let done = 0;
  let opened = false;
  for (const type of types) {
    progText.textContent = `${CARD_PLAN[type].toolLabel} 불러오는 중 · ${done}/${types.length}`;
    setLocked(true, `${CARD_PLAN[type].toolLabel} 불러오는 중 · ${done}/${types.length}`);
    await wait(500);
    if (myToken !== abortToken) return;

    // 픽스처 어댑터 — main.js의 source:'fixture' 분기로 간다(위 runQueryLive의
    // 실배선 호출과 짝을 이룬다. 여긴 명시적으로 fixture를 요청한 경로다).
    await window.athena.invoke('athena__render_canvas', { source: 'fixture', type, expand: prefs.autoExpandCanvas && !opened });
    opened = true;

    trEls[type].classList.add('done');
    done += 1;
    progText.textContent = `${CARD_PLAN[type].toolLabel} 완료 · ${done}/${types.length}`;
  }
  scrollAfterRender();
  await wait(200);
  if (myToken !== abortToken) return;

  // 상태 3 — 완료
  state = 'idle';
  setDot(null);
  setLocked(false);
  progress.remove();
  liveProgressEl = null;

  const aLine = document.createElement('div');
  aLine.className = 'turn';
  const aText = document.createElement('div');
  aText.className = 'turn-a';
  aText.textContent = answerFor(types);
  aLine.appendChild(aText);

  const meta = document.createElement('div');
  meta.className = 'turn-meta';
  for (const type of types) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = CARD_PLAN[type].label;
    chip.addEventListener('click', () => window.athena.send('athena:highlight-canvas', type));
    meta.appendChild(chip);
  }
  aLine.appendChild(meta);

  $history.appendChild(aLine);
  scrollAfterRender();
  $input.focus();

  // runQueryLive와 같은 이유(위 654-656행 주석 참고) — fixture 모드도 턴 종료
  // 직후 draft를 다시 조회해 승인 카드를 띄운다. canvasSource가 fixture인 건
  // 캔버스 카드 출처일 뿐 라우틴 서브시스템과는 무관하다 — 이 호출이 없으면
  // fixture 모드(verify.js)에서 8단계 흐름을 검증할 방법이 없다.
  refreshRoutineDrafts();
}

// 한글 받침 유무에 따른 을/를 조사 선택 (예: "스트림"→을, "테이블"→을, "리더"→를)
function withEulReul(word) {
  const last = word.charCodeAt(word.length - 1) - 0xac00;
  if (last < 0 || last > 11171) return word + '를'; // 한글 음절 범위 밖이면 기본값
  const hasBatchim = last % 28 !== 0;
  return word + (hasBatchim ? '을' : '를');
}

function answerFor(types) {
  const labels = types.map((t) => CARD_PLAN[t].label).join(', ');
  return `캔버스 창에 ${withEulReul(labels)} 띄웠습니다.`;
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

let settingsOpen = false;

function openSettings() {
  if (settingsOpen) return;
  settingsOpen = true;
  // Paper AJ-0 — 설정은 창 전체를 차지한다. 반투명 오버레이만 올리면 셸(사이드바·
  // 대화 열)이 그대로 비쳐 두 화면이 겹쳐 읽힌다(온보딩과 같은 처방, 다른 클래스).
  $shell.classList.add('is-settings-hidden');
  $app.hidden = true;
  $settings.hidden = false;
  // Paper 43쪽(2026-08-18 확정) — 좌 사이드바(화면·계좌·MCP 서버·모델) + 우 패널.
  // 세 카드를 동시에 쌓아 보여주던 이전 판(renderScreen/renderAccounts를
  // 나란히 호출)을 대체한다. 패널 렌더 함수 자체는 그대로 재사용 — nav가 어떤 걸
  // 부를지만 고른다.
  const SETTINGS_PANELS = {
    screen: settingsCards.renderScreen,
    accounts: settingsCards.renderAccounts,
    model: settingsCards.renderModel,
    history: settingsCards.renderHistory,
  };
  settingsCards.renderNav($settingsNav, $settingsGrid, {
    onSelect: (key, grid) => {
      grid.replaceChildren();
      (SETTINGS_PANELS[key] || settingsCards.renderScreen)(grid);
    },
  });
}

function closeSettings() {
  if (!settingsOpen) return;
  settingsOpen = false;
  $settingsGrid.replaceChildren();
  $settingsNav.replaceChildren();
  $settings.hidden = true;
  $shell.classList.remove('is-settings-hidden');
  $app.hidden = false;
  $input.focus();
}

const SETTINGS_COMMAND =
  /^(설정|환경설정|셋팅|세팅|settings?|config)\s*[?!.]*$|설정\s*(창|화면|모드)?\s*(을|를)?\s*(열어|보여|띄워|줘|줄래)|모델\s*(바꿔|변경|설정)|계좌\s*(연결|설정|관리)/i;

function isSettingsCommand(text) {
  return SETTINGS_COMMAND.test(text.trim());
}

// ---------- 대화 모드 HISTORY_COMMAND — 채팅→그래프 파이프라인 단계 5 ----------
// (.omc/plans/plan-chat-graph-pipeline.md §2(e)) LLM을 거치지 않는다 — SETTINGS_COMMAND와
// 같은 결정론적 클라이언트 가로채기다. 같은 실측 함정을 그대로 물려받는다:
// `\b`는 한글 뒤에서 성립하지 않는다(한글은 \w가 아니다) — 쓰지 않는다.
// 단독 호출어(이력/채팅 이력/성향/히스토리)는 문자열 전체 일치, 나머지는 동사구.
const HISTORY_COMMAND =
  /^(이력|채팅\s*이력|성향|투자\s*성향|히스토리|history)\s*[?!.]*$|채팅\s*(이력|기록)\s*(을|를)?\s*(보여|열어|줘|줄래)|투자\s*성향\s*(보여|알려|줘|줄래)/i;

function isHistoryCommand(text) {
  return HISTORY_COMMAND.test(text.trim());
}

// "성향"이 들어간 호출은 profile-summary, 그 외(이력/채팅 이력/히스토리)는 chats.
function historyCommandKind(text) {
  return /성향/.test(text) ? 'profile-summary' : 'chats';
}

async function runHistoryCommand(text) {
  const myToken = ++abortToken;

  const qLine = document.createElement('div');
  qLine.className = 'turn';
  const qText = document.createElement('div');
  qText.className = 'turn-q';
  qText.textContent = text;
  qLine.appendChild(qText);
  $history.appendChild(qLine);
  scrollHistoryToBottom(true);
  scrollAfterRender();

  const kind = historyCommandKind(text);
  const label = kind === 'profile-summary' ? '투자 성향 요약' : '채팅 이력';

  let result;
  try {
    result = await window.athena.invoke('athena:brain-history-query', { kind, expand: prefs.autoExpandCanvas });
  } catch (err) {
    result = { ok: false, error: String((err && err.message) || err) };
  }
  if (myToken !== abortToken) return;

  const aLine = document.createElement('div');
  aLine.className = 'turn';
  const aText = document.createElement('div');
  aText.className = 'turn-a';
  aText.textContent = result && result.ok
    ? `캔버스 창에 ${withEulReul(label)} 띄웠습니다.`
    : `${label}을 불러올 수 없다 — ${(result && result.error) || '알 수 없는 오류'}`;
  aLine.appendChild(aText);
  $history.appendChild(aLine);
  scrollAfterRender();
  $input.focus();
}

// 점은 대화 상태 표시(setDot)+키우미 메뉴 트리거다(Paper 보드 45 v5, 2026-08-27).
// 모드 전환 클릭은 사이드바 모드 네비(lib/sidebar-mode-nav.js) 몫이다(보드 44
// "원칙 1 — 채팅은 절대 접히지 않는다, 모드는 캔버스만 바꾼다"). 실제 모드
// 엔진은 그대로 canvas.js의 graphMode(lib/graph-mode/controller.js) 하나다.
$dot.addEventListener('click', () => { toggleKiumiMenu(); });
// 하단 툴바(Paper 44 composer-bar, 2026-09-05) — +는 키우미 메뉴(파일·폴더 첨부)의 두 번째 문,
// @는 커서에 @를 넣어 플러그인 멘션 메뉴를 연다. 모델·강도 버튼은 아래 모델 팝오버 절에 있다.
$attachBtn.addEventListener('click', () => { toggleKiumiMenu(); });
$mentionBtn.addEventListener('click', () => {
  if ($input.disabled) return;
  const start = $input.selectionStart == null ? $input.value.length : $input.selectionStart;
  const end = $input.selectionEnd == null ? start : $input.selectionEnd;
  const before = $input.value.slice(0, start);
  const spacer = before && !/\s$/.test(before) ? ' ' : '';
  $input.value = `${before}${spacer}@${$input.value.slice(end)}`;
  const caret = before.length + spacer.length + 1;
  $input.focus();
  $input.setSelectionRange(caret, caret);
  $input.dispatchEvent(new Event('input', { bubbles: true }));
});
// 사이드바 계정 메뉴(Paper 보드 16)의 "설정" 항목이 쓰는 다리 — lib/sidebar.js
// 참고.
window.AthenaShell.registerOpenSettings(openSettings);
// 같은 메뉴의 "계좌 전환" 항목 — 설정이 아니라 계좌 전환 화면(Paper 1M3-0)이다.
window.AthenaShell.registerOpenAccountSwitch(openAccountSwitchScreen);

// 43번 "새 작업은 채팅에서" 원칙의 공용 진입로(shell.js 버스) — 시트를 열지
// 않고 채팅 입력에 시작 문장을 심고 포커스만 옮긴다(7단계 제안 카드 "추가"가
// 첫 사용처, lib/agent-canvas.js).
window.AthenaShell.registerSeedChatInput((text) => {
  if (!$input) return;
  $input.value = text != null ? String(text) : '';
  autoGrowInput();
  $input.focus();
  // 캐럿을 문장 끝에 둔다(2026-09-03 사용자 지적 "심긴 뒤 무엇을 해야 하는지 안
  // 알려준다"). focus()만 하면 캐럿이 맨 앞에 서서 심긴 문장이 "이미 보낸 말"처럼
  // 읽혔다 — 끝에서 깜빡이는 캐럿이 "고쳐서 Enter"라는 뜻을 스스로 말한다.
  // 이 문장을 보내지 않는다는 계약은 그대로다(canvas.js seedGraphChat 주석).
  try { $input.setSelectionRange($input.value.length, $input.value.length); } catch { /* textarea가 아니면 그만 */ }
});

// ---------- @ 플러그인 멘션 ----------
// ---------- 되물을 것들 카드(2026-09-02) ----------
//
// 확인 필요 배너가 "답하시면 그대로 그래프가 갱신됩니다"라고 약속한다. 산문 대화로는
// 그 약속을 못 지킨다 — 사용자가 어디에 답해야 하고 그 답이 어떻게 그래프로 돌아가는지가
// 안 보인다. 실제로 모델은 정직하게 "이것이 배너의 그 3건과 같다고는 말할 수 없다"고
// 답했다(2026-09-02 실측). 배너의 그 3건은 백엔드가 이미 안다.
//
// **왜 N건을 다 묻고 한 번에 제출하나.** 답변마다 턴을 돌리면 그 턴 동안 입력이 잠겨
// 다음 질문을 누를 수 없다. 카드가 하나씩 묻고, 마지막에 모아 한 문장으로 보낸다 —
// 턴 하나, 추출 한 번이다.
//
// 답이 그래프로 돌아가는 경로는 사람의 채팅뿐이다(brain_tools.py: 모델은 그래프에
// 쓸 수 없다). 그래서 선택지는 답변 **문장**이 되어 dispatchUserQuery로 제출된다.
let brainQuestions = null; // { items, index, decisions } — 열려 있는 동안만

function brainQuestionsLib() {
  return window.AthenaLib && window.AthenaLib.BrainQuestions;
}

function closeBrainQuestions() {
  brainQuestions = null;
  const host = document.getElementById('brainQuestionCard');
  if (!host) return;
  while (host.firstChild) host.removeChild(host.firstChild);
  host.hidden = true;
}

// 답을 **그래프에 바로 반영하고** 카드를 닫는다(2026-09-03 사용자 확정).
//
// 예전에는 모은 답을 한 문장으로 채팅에 보냈고 반영은 다음 수집 배치가 했다.
// 그래서 세 건을 다 답해도 "확인이 필요한 것 3건"이 그대로였고 모델은 같은 카드를
// 다시 띄웠다 — 사람은 무한히 답했다(실측). 수집(대화를 캐는 일)과 편집(주인이
// 화면에서 확인하는 일)은 다른 일이다.
//
// 문장을 보내지 않는 것이 중요하다: 보내면 모델이 새 요청으로 읽어 카드를 또 띄운다.
// 결과는 채팅 흐름에 한 줄로 적는다 — 무엇이 처리됐는지 사람이 알아야 한다.
async function applyBrainAnswers() {
  const decided = brainQuestions ? brainQuestions.decisions.slice() : [];
  closeBrainQuestions();
  if (!decided.length) return;
  let confirmed = 0;
  let removed = 0;
  const failures = [];
  for (const decision of decided) {
    const channel = decision.choice === 'yes'
      ? 'athena:brain-confirm-relation'
      : 'athena:brain-retract-relation';
    let res = null;
    try {
      res = await window.athena.invoke(channel, { relationId: decision.relationId });
    } catch (err) {
      failures.push(decision.label + ': ' + String((err && err.message) || err));
      continue;
    }
    if (!res || !res.ok) {
      failures.push(decision.label + ': ' + ((res && res.error) || '알 수 없는 이유'));
      continue;
    }
    if (decision.choice === 'yes') confirmed += 1; else removed += 1;
  }
  const parts = [];
  if (confirmed) parts.push(confirmed + '건을 확실한 것으로 기록했습니다');
  if (removed) parts.push(removed + '건을 지웠습니다');
  if (parts.length) appendSystemLine(parts.join(' · ') + '.');
  // 실패를 조용히 넘기지 않는다 — 사람은 처리됐다고 믿고 화면을 떠난다(§0 정직성).
  for (const failure of failures) appendSystemLine('반영하지 못했습니다 — ' + failure);
}

function answerBrainQuestion(choice) {
  const lib = brainQuestionsLib();
  if (!brainQuestions || !lib) return;
  const item = brainQuestions.items[brainQuestions.index];
  // 건너뛰기는 아무것도 안 남긴다 — 침묵을 부정으로 굳히지 않는다.
  if (choice !== 'skip' && item && item.relationId) {
    brainQuestions.decisions.push({
      relationId: item.relationId,
      choice,
      label: (item.subjectImplicit || !item.subject)
        ? "\"" + item.object + "\" · '" + item.relationText + "'"
        : "\"" + item.subject + "\" → \"" + item.object + "\" · '" + item.relationText + "'",
    });
  }
  brainQuestions.index += 1;
  if (brainQuestions.index >= brainQuestions.items.length) {
    void applyBrainAnswers();
    return;
  }
  renderBrainQuestionCard();
}

function renderBrainQuestionCard() {
  const lib = brainQuestionsLib();
  const host = document.getElementById('brainQuestionCard');
  if (!host || !brainQuestions || !lib) return;
  while (host.firstChild) host.removeChild(host.firstChild);
  const item = brainQuestions.items[brainQuestions.index];

  const head = document.createElement('div');
  head.className = 'question-card-head';
  const title = document.createElement('div');
  title.className = 'question-card-title';
  title.textContent = item.question;
  head.appendChild(title);
  const progress = document.createElement('span');
  progress.className = 'question-card-progress';
  progress.textContent = lib.progressLabel(brainQuestions.index, brainQuestions.items.length);
  head.appendChild(progress);
  host.appendChild(head);

  const context = document.createElement('div');
  context.className = 'question-card-context';
  context.textContent = lib.contextLine(item);
  host.appendChild(context);

  const note = document.createElement('div');
  note.className = 'question-card-note';
  // 답이 어디로 가는지 적는다 — 누르면 채팅에 문장이 제출된다는 사실을 숨기지 않는다.
  note.textContent = '답하면 채팅으로 보내지고, 그 답이 그래프를 갱신합니다.';
  host.appendChild(note);

  const actions = document.createElement('div');
  actions.className = 'question-card-actions';
  const mkBtn = (choice, className) => {
    const spec = lib.CHOICES[choice];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `question-card-btn ${className}`;
    const label = document.createElement('span');
    label.textContent = spec.label;
    btn.appendChild(label);
    if (spec.hint) {
      const hint = document.createElement('span');
      hint.className = 'question-card-key';
      hint.textContent = spec.hint;
      btn.appendChild(hint);
    }
    btn.addEventListener('click', () => answerBrainQuestion(choice));
    return btn;
  };
  // 레퍼런스 화면과 같은 배치 — 거절이 왼쪽, 확인이 오른쪽.
  actions.appendChild(mkBtn('skip', 'is-quiet'));
  const right = document.createElement('span');
  right.className = 'question-card-right';
  right.appendChild(mkBtn('no', 'is-quiet'));
  right.appendChild(mkBtn('yes', 'is-primary'));
  actions.appendChild(right);
  host.appendChild(actions);
  host.hidden = false;
}

// 카드가 열려 있을 때만 듣는다 — Esc는 평소 "중단"이고 Ctrl+Enter는 평소 쓰임이 없다.
document.addEventListener('keydown', (e) => {
  if (!brainQuestions) return;
  if (e.key === 'Escape') { e.preventDefault(); answerBrainQuestion('skip'); return; }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); answerBrainQuestion('yes'); }
}, true);

window.AthenaShell.registerOpenBrainQuestions(async () => {
  const lib = brainQuestionsLib();
  if (!lib) return false;
  // 답변 중에는 열지 않는다 — 카드의 마지막 제출이 그 턴과 부딪힌다.
  if (state !== 'idle' || remoteQueryBusy) return false;
  const res = await window.athena.invoke('athena:brain-suggested-questions').catch(() => null);
  if (!res || !res.ok) return false;
  // IPC는 { ok, revision, questions } 평면 구조를 준다(main.js — result.body를 펼쳐 준다).
  // 관계명 한글 사전은 공통 패널·엔티티 타임라인이 이미 쓰는 것을 그대로 넘긴다
  // (controller.js RELATION_LABELS). 카드에 복사하면 한쪽만 고치는 실수가 나고,
  // 그 leaf가 controller를 의존하면 층이 뒤집힌다 — 그래서 여기서 주입한다.
  const controller = window.AthenaLib && window.AthenaLib.GraphModeController;
  const items = lib.normalizeQuestions(res, controller && controller.RELATION_LABELS);
  if (!items.length) return false;
  // decisions — 답한 것을 바로 반영하려면 relationId와 선택이 필요하다.
  // 예전 answers(문장 배열)는 채팅으로 보낼 용도였고 지금은 보내지 않는다.
  brainQuestions = { items, index: 0, decisions: [] };
  renderBrainQuestionCard();
  return true;
});

// ---------- 그래프 편집 제안 카드(2026-09-03) ----------
//
// 사용자 확정 방향: **모델은 제안, 확정은 사람.** 모델이 athena_graph_view
// action=propose_edit을 부르면 main.js가 athena:graph-chat-action으로 보내고,
// 여기서 카드를 띄운다. 누르면 사람의 답변 문장이 dispatchUserQuery로 제출되어
// POST /brain/chat → 추출로 그래프가 갱신된다 — 되물을 것들 카드와 **같은 경로**다.
//
// 되물을 것들 카드와 같은 클래스(.question-card*)를 쓰고 같은 키(Ctrl+Enter·Esc)를
// 쓴다. 다른 점은 하나뿐이다: 저쪽은 백엔드가 고른 불확실한 관계를 N건 묻고 한 번에
// 제출하고, 이쪽은 모델의 제안 한 건을 즉시 묻는다(제안은 대화 흐름 안에서 나오므로
// 모아 둘 이유가 없다).
let graphEditProposal = null; // 열려 있는 동안만

function graphEditProposalLib() {
  return window.AthenaLib && window.AthenaLib.GraphEditProposal;
}

function closeGraphEditProposal() {
  graphEditProposal = null;
  const host = document.getElementById('graphEditProposalCard');
  if (!host) return;
  while (host.firstChild) host.removeChild(host.firstChild);
  host.hidden = true;
}

function answerGraphEditProposal(choice) {
  const lib = graphEditProposalLib();
  if (!graphEditProposal || !lib) return;
  const item = graphEditProposal;
  const sentence = lib.proposalSentence(item, choice);
  closeGraphEditProposal();

  // 지우기는 **바로** 지운다(2026-09-03 사용자 확정 "내가 그래프창에 있으면 편집이라고
  // 봐야지"). 수집(대화를 캐는 일)과 편집(주인이 화면에서 고치는 일)은 다른 일이다.
  //
  // 예전에는 이것도 답변 문장을 채팅으로 보내는 것이 전부였고, 반영은 다음 수집
  // 배치가 했다 — 누른 직후 아무 일도 안 일어나니 모델이 같은 제안을 다시 냈고
  // 사람은 같은 카드를 무한히 눌렀다(실측). 문장을 **보내지 않는** 것이 중요하다:
  // 보내면 모델이 그것을 새 요청으로 읽어 또 제안하고, 루프가 그대로 남는다.
  //
  // relationId가 없으면(구버전 모델이 id를 안 실었거나 추가·수정 제안이면) 예전
  // 경로를 그대로 쓴다 — 직접 쓰기는 아직 지우기 하나뿐이다.
  if (choice === 'apply' && item.op === 'remove' && item.relationId) {
    void retractGraphRelation(item);
    return;
  }

  // 추가·수정도 바로 쓴다(2026-09-03). 두 끝 id가 다 와야 한다 — 이름으로 쓰면
  // 오타가 새 노드가 되고, 그것은 고치려던 것보다 나쁘다. 하나라도 없으면 아래
  // 예전 경로(답변 문장 제출 → 수집 때 반영)로 떨어진다.
  if (choice === 'apply' && (item.op === 'add' || item.op === 'change')
      && item.subjectId && item.objectId) {
    void writeManualRelation(item);
    return;
  }

  // 건너뛰기는 아무것도 보내지 않는다 — 침묵을 답으로 굳히지 않는다.
  if (sentence) dispatchUserQuery(sentence);
}

// 채팅 흐름에 결과 한 줄. 'past-empty'는 과거 대화 복원이 "메시지가 없습니다"에
// 쓰는 것과 같은 안내 톤이다 — 말풍선(사람/모델의 발화)이 아니라 화면이 하는 말이라
// 같은 자리·같은 톤을 쓴다(새 시각 언어를 만들지 않는다).
function appendSystemLine(text) {
  if (!$history) return;
  const line = document.createElement('div');
  line.className = 'past-empty';
  line.textContent = String(text == null ? '' : text);
  $history.appendChild(line);
  scrollAfterRender();
}

// 사람이 누른 추가·수정을 그래프에 바로 쓴다. 티어는 MANUAL이라 다음 대화 추출이
// 덮지 못한다(store._apply_one_relation). 취소와 같은 이유로 실패를 조용히 넘기지
// 않는다 — 사람은 고쳤다고 믿고 화면을 떠난다(§0 정직성).
async function writeManualRelation(item) {
  const label = proposalLabel(item);
  let res = null;
  try {
    res = await window.athena.invoke('athena:brain-manual-relation', {
      subjectId: item.subjectId,
      objectId: item.objectId,
      kind: item.relation,
      rationale: item.reason,
    });
  } catch (err) {
    appendSystemLine(label + ' — 반영하지 못했습니다: ' + String((err && err.message) || err));
    return;
  }
  if (!res || !res.ok) {
    appendSystemLine(label + ' — 반영하지 못했습니다: ' + ((res && res.error) || '알 수 없는 이유'));
    return;
  }
  if (res.written === false) {
    // 두 끝 중 하나가 그래프에 없다 — 화면에 없는 노드를 이름만으로 만들지 않는다.
    appendSystemLine(label + ' — 그래프에 없는 노드가 있어 반영하지 못했습니다.');
    return;
  }
  appendSystemLine(label + ' — 반영했습니다(직접 수정).');
}

// 카드가 가리키는 것을 한 줄로. 세 곳이 같은 말로 불러야 사람이 같은 것으로 읽는다.
function proposalLabel(item) {
  return (item.subjectImplicit || !item.subject)
    ? '"' + item.object + '" · \'' + item.relationText + '\''
    : '"' + item.subject + '" → "' + item.object + '" · \'' + item.relationText + '\'';
}

// 사람이 누른 취소를 그래프에 바로 반영한다. 실패하면 조용히 넘기지 않는다 —
// 사람은 지웠다고 믿고 화면을 떠난다(§0 정직성). 성공하면 main이 화면을 다시
// 읽게 하는 이벤트를 쏘므로 여기서 따로 다시 그리지 않는다.
async function retractGraphRelation(item) {
  const label = proposalLabel(item);
  let res = null;
  try {
    res = await window.athena.invoke('athena:brain-retract-relation', { relationId: item.relationId });
  } catch (err) {
    appendSystemLine(`${label} — 지우지 못했습니다: ${String((err && err.message) || err)}`);
    return;
  }
  if (!res || !res.ok) {
    appendSystemLine(`${label} — 지우지 못했습니다: ${(res && res.error) || '알 수 없는 이유'}`);
    return;
  }
  if (res.removed === false) {
    appendSystemLine(`${label} — 이미 없는 연결이었습니다.`);
    return;
  }
  appendSystemLine(`${label} — 지웠습니다.`);
}

function renderGraphEditProposalCard() {
  const lib = graphEditProposalLib();
  const host = document.getElementById('graphEditProposalCard');
  if (!host || !graphEditProposal || !lib) return;
  while (host.firstChild) host.removeChild(host.firstChild);

  const head = document.createElement('div');
  head.className = 'question-card-head';
  const title = document.createElement('div');
  title.className = 'question-card-title';
  title.textContent = lib.proposalTitle(graphEditProposal);
  head.appendChild(title);
  host.appendChild(head);

  const context = document.createElement('div');
  context.className = 'question-card-context';
  context.textContent = lib.proposalContext(graphEditProposal);
  host.appendChild(context);

  const note = document.createElement('div');
  note.className = 'question-card-note';
  // 아직 아무것도 안 바뀌었다는 사실을 화면이 말한다 — 모델의 notice와 같은 내용이다.
  // 문구는 **실제로 걸릴 경로**를 말한다(2026-09-03). 두 경로가 있다:
  //   · relationId가 있으면(op=remove) 누른 순간 그래프에서 바로 사라진다.
  //   · 없으면(추가·수정, 또는 모델이 id를 안 실은 경우) 답변 문장이 채팅으로 나가고
  //     반영은 다음 수집 배치가 한다.
  // 앞 판은 둘을 구분하지 않아, 즉시 지워지는데도 "다음 수집 때"라고 말했다 —
  // 그 전 판은 반대로 "그 답이 그래프를 갱신합니다"라 즉시로 읽혔고, 숫자가 안
  // 줄어드니 같은 카드를 계속 누르는 무한 루프처럼 느껴졌다(실제 제보). 어느 쪽이든
  // 화면이 사실과 다르면 사람은 고장으로 읽는다.
  const immediate = graphEditProposal.op === 'remove' && !!graphEditProposal.relationId;
  note.textContent = immediate
    ? '아직 그래프는 그대로입니다. 누르면 바로 지워집니다.'
    : '아직 그래프는 그대로입니다. 누르면 그 답이 채팅으로 보내지고, 다음 수집 때 그래프에 반영됩니다.';
  host.appendChild(note);

  const actions = document.createElement('div');
  actions.className = 'question-card-actions';
  const mkBtn = (choice, className) => {
    const spec = lib.CHOICES[choice];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `question-card-btn ${className}`;
    const label = document.createElement('span');
    label.textContent = spec.label;
    btn.appendChild(label);
    if (spec.hint) {
      const hint = document.createElement('span');
      hint.className = 'question-card-key';
      hint.textContent = spec.hint;
      btn.appendChild(hint);
    }
    btn.addEventListener('click', () => answerGraphEditProposal(choice));
    return btn;
  };
  // 되물을 것들 카드와 같은 배치 — 거절이 왼쪽, 확인이 오른쪽.
  actions.appendChild(mkBtn('skip', 'is-quiet'));
  const right = document.createElement('span');
  right.className = 'question-card-right';
  right.appendChild(mkBtn('reject', 'is-quiet'));
  right.appendChild(mkBtn('apply', 'is-primary'));
  actions.appendChild(right);
  host.appendChild(actions);
  host.hidden = false;
}

// 카드가 열려 있을 때만 듣는다 — 되물을 것들 카드와 같은 키를 쓰므로, 그 카드가
// 열려 있으면 이쪽은 듣지 않는다(위 핸들러가 먼저 preventDefault한다).
document.addEventListener('keydown', (e) => {
  if (!graphEditProposal || brainQuestions) return;
  if (e.key === 'Escape') { e.preventDefault(); answerGraphEditProposal('skip'); return; }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); answerGraphEditProposal('apply'); }
}, true);

// canvas.js가 athena:graph-chat-action을 받아 이 훅을 부른다 — 그 채널의
// 구독은 한 곳에만 둔다(shell.js hooks 주석 참고). 되물을 것들 카드가 이미
// 같은 버스를 쓰므로 chat↔canvas 손넘김 규칙이 하나로 유지된다.
window.AthenaShell.registerOpenGraphEditProposal((message) => {
  const lib = graphEditProposalLib();
  if (!lib) return false;
  // 관계명 한글 사전은 공통 패널이 이미 쓰는 것을 그대로 넘긴다(되물을 것들 카드와
  // 같은 이유 — 복사하면 한쪽만 고치는 실수가 난다).
  const controller = window.AthenaLib && window.AthenaLib.GraphModeController;
  const item = lib.normalizeProposal(message, controller && controller.RELATION_LABELS);
  // 못 쓸 제안은 카드를 띄우지 않는다 — 무엇을 고칠지 모르는 카드에는 답할 수 없다.
  if (!item) return false;
  graphEditProposal = item;
  renderGraphEditProposalCard();
  return true;
});

// ---------- 과거 대화 열기(2026-09-02) ----------
//
// 제보: 대화 이력 쪽을 누르면 그 대화로 이동해야 하는데 그런 기능이 전혀 없다.
// 실제로 없었다 — athena:conversations-set-active가 요청한 id를 의도적으로 무시하고
// 현재 활성 id를 그대로 돌려준다(main.js 주석: "복원 배선이 생기기 전까지 선택만
// 바꿔 새 메시지를 과거 제목 아래에 쓰면 안 된다"). 그 판단은 옳았지만, 그 주석이
// 말하는 "메시지를 복원할 수 없다"는 전제는 지금 틀렸다: 브레인 이력 DB가
// conversation_id와 함께 메시지를 들고 있고 조회 엔드포인트도 있다.
//
// **그래서 이제는 실제로 돌아간다(41번 보드 "다시 누르면 그대로").** main이
// athena:conversations-set-active에서 기록 대상 id와 Claude 커서(--resume)를 함께
// 바꾸므로, 여기서는 그 대화의 메시지를 다시 그리고 모드 화면을 그 대화의 모드로
// 맞춘 뒤 입력을 연다. 읽기 전용 잠금은 없다 — 이어서 말하면 그 대화에 쌓인다.
// 캔버스 카드·작업 환경의 복원은 세션 스토어 배선(다음 단계)의 몫이라 아직
// 카드는 비운 채 시작한다. 없는 것을 있다고 그리지 않는다.

function pastMessageTurn(message) {
  const line = document.createElement('div');
  line.className = 'turn';
  const body = document.createElement('div');
  // 사용자/모델 말풍선은 살아 있는 턴과 같은 클래스를 쓴다 — 복원된 대화라고
  // 다른 모양으로 그리면 같은 대화가 두 얼굴을 갖는다.
  body.className = message.role === 'user' ? 'turn-q' : 'turn-a';
  body.textContent = String((message && message.text) || '');
  line.appendChild(body);
  return line;
}

function restoreConversation(switched, messages, snapshot) {
  while ($history.firstChild) $history.removeChild($history.firstChild);
  if (window.AthenaShell && typeof window.AthenaShell.clearCanvases === 'function') {
    window.AthenaShell.clearCanvases();
  }
  // 대화는 모드에 묶인다 — 백테스트 대화를 열면 백테스트 캔버스가 뜬다(35번 보드).
  const snapshotLib = window.AthenaLib && window.AthenaLib.SessionSnapshot;
  const view = snapshotLib ? snapshotLib.modeToView(switched.activeMode) : null;
  if (view && window.AthenaCanvasMode && typeof window.AthenaCanvasMode.setView === 'function') {
    window.AthenaCanvasMode.setView(view);
  }
  if (view && window.AthenaModeNav && typeof window.AthenaModeNav.setActive === 'function') {
    window.AthenaModeNav.setActive(view);
  }

  // 배너는 없다(2026-09-05 사용자 정정 "복원됨이 아니라 그냥 자동으로 복원되어야"). 전에는
  // '복원됨 · 제목'과 '이어서 말할 수 있습니다 …' 줄을 맨 위에 그렸는데, 복원이 계약이면
  // 말할 게 없다(41번 보드 "전부 돌아왔으면 아무 말도 하지 않는다"). 문맥이 이어지는지
  // (switched.resumed)는 main의 커서가 정하고, 화면은 그것을 따로 알리지 않는다.

  if (!messages.length) {
    // 못 읽은 것과 없는 것은 다르다 — 조회는 됐고 메시지가 0건인 경우다
    // (이력 저장이 붙기 전에 만들어진 대화가 여기 해당한다).
    const empty = document.createElement('div');
    empty.className = 'past-empty';
    empty.textContent = '이 대화에는 저장된 메시지가 없습니다.';
    $history.appendChild(empty);
  } else {
    for (const message of messages) $history.appendChild(pastMessageTurn(message));
  }
  setLocked(false);
  // 초안과 스크롤도 그 대화의 것이다. 초안은 지금 입력이 비어 있을 때만 채운다 —
  // 사용자가 치던 글자를 저장본이 덮으면 안 된다. 스크롤은 저장된 자리로, 바닥이었으면 바닥으로.
  const ws = snapshot && snapshot.workspace;
  if (ws && ws.draft && typeof ws.draft.text === 'string' && !$input.value) {
    $input.value = ws.draft.text;
    autoGrowInput();
  }
  const vp = snapshot && snapshot.viewport && snapshot.viewport.chat;
  if (vp && vp.atBottom === false && typeof vp.scrollTop === 'number') {
    stickToBottom = false;
    $history.scrollTop = vp.scrollTop;
  } else {
    scrollHistoryToBottom(true);
  }
  // 모드 화면의 상태(그래프 시점·백테스트 폼 …)는 그 모드가 등록한 핸들러가 받는다 —
  // 여기서는 kind로 넘길 뿐이다(lib/session-workspace.js).
  if (ws && window.AthenaSessionWorkspace) window.AthenaSessionWorkspace.restore(ws);
}

// sidebar.js가 부르는 다리(shell.js 버스). 돌아갔으면 true.
window.AthenaShell.registerOpenConversation(async (conv) => {
  if (!conv || !conv.id) return false;
  // 답변 중에는 전환하지 않는다 — 진행 중 턴이 다른 대화 밑으로 사라진다.
  if (state !== 'idle' || remoteQueryBusy) return false;
  const switched = await window.athena.invoke('athena:conversations-set-active', { id: conv.id })
    .catch(() => null);
  if (!switched || !switched.restorable) return false;
  if (switched.isCurrent) return true;
  // 메시지의 원본은 세션 스토어다(42번 보드). 스냅샷의 currentId 경로만 그린다 — 분기가
  // 있어도 한 줄로 보인다. 스토어에 없으면(이 배선 전에 만든 대화) 브레인 이력으로 폴백.
  const snapshot = await window.athena.invoke('athena:session-load', { id: conv.id }).catch(() => null);
  const snapshotLib = window.AthenaLib && window.AthenaLib.SessionSnapshot;
  let messages = snapshot && snapshotLib ? snapshotLib.messagePath(snapshot.messages, snapshot.currentId) : [];
  if (!messages.length) {
    const res = await window.athena.invoke('athena:conversation-messages', { conversationId: conv.id })
      .catch(() => null);
    messages = res && res.ok && Array.isArray(res.messages) ? res.messages : [];
  }
  restoreConversation(switched, messages, snapshot);
  // 카드는 main이 저장된 봉투를 같은 페인트 채널로 다시 흘린다 — 캔버스를 비운 뒤라 순서가 맞는다.
  void window.athena.invoke('athena:session-replay-cards', { id: conv.id }).catch(() => {});
  return true;
});

// Claude 데스크톱의 @ 멘션과 같은 UX: 입력란에서 @를 치면 등록된 MCP 서버 목록이
// 뜨고, 고르면 @alias가 삽입된다. 제출 시 @alias가 실제 등록 서버와 일치하면
// 모델에게 그 서버의 도구를 우선 쓰라는 지시를 질의에 동봉한다(화면의 사용자
// 버블에는 타이핑한 원문만 남는다).
const mentionState = { aliases: [], loaded: false, open: false, items: [], active: 0 };
const $mentionMenu = document.createElement('div');
$mentionMenu.className = 'mention-menu';
$mentionMenu.hidden = true;
document.body.appendChild($mentionMenu);

async function loadMentionAliases() {
  if (mentionState.loaded) return;
  try {
    const res = await window.athena.invoke('athena:mcp-list');
    mentionState.aliases = ((res && res.servers) || [])
      .filter((s) => s && s.approved)
      .map((s) => ({
        alias: s.alias,
        // 카탈로그에서 설치한 서버는 사람이 읽는 이름을 함께 보여준다. 모르는
        // 별칭에는 이름을 지어내지 않고 실행 명령을 그대로 힌트로 쓴다.
        name: (window.AthenaLib && window.AthenaLib.PluginCatalog
          && window.AthenaLib.PluginCatalog.displayNameFor(s.alias)) || null,
        hint: [s.command, s.argsPreview].filter(Boolean).join(' '),
      }));
    mentionState.loaded = true;
  } catch { /* 목록 실패 — 멘션 없이도 입력은 정상이어야 한다 */ }
}
void loadMentionAliases();

// 플러그인을 설치·승인·철회·삭제하면 이 목록이 바로 낡는다. 한 번 읽고 세션
// 내내 캐시하면 "방금 설치했는데 @로 안 뜬다"가 된다 — canvas.js가 레지스트리를
// 다시 읽을 때마다 보내는 신호로 무효화한다.
window.addEventListener('athena:plugins-changed', () => {
  mentionState.loaded = false;
  void loadMentionAliases().then(() => { if (!$kiumiMenu.hidden) renderKiumiMenu(); });
});

// 커서 앞의 "@토큰"을 찾는다. 없으면 null.
function mentionTokenAtCaret() {
  const caret = $input.selectionStart == null ? $input.value.length : $input.selectionStart;
  const before = $input.value.slice(0, caret);
  const match = before.match(/@([A-Za-z0-9_-]*)$/);
  if (!match) return null;
  return { start: caret - match[0].length, end: caret, query: match[1] };
}

function closeMentionMenu() {
  mentionState.open = false;
  $mentionMenu.hidden = true;
  $mentionMenu.textContent = '';
}

function insertMention(alias) {
  const token = mentionTokenAtCaret();
  if (!token) { closeMentionMenu(); return; }
  const value = $input.value;
  $input.value = `${value.slice(0, token.start)}@${alias} ${value.slice(token.end)}`;
  autoGrowInput();
  const caret = token.start + alias.length + 2;
  $input.setSelectionRange(caret, caret);
  $input.focus();
  closeMentionMenu();
}

function renderMentionMenu(items) {
  $mentionMenu.textContent = '';
  items.forEach((item, i) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `mention-item${i === mentionState.active ? ' is-active' : ''}`;
    const name = document.createElement('span');
    name.className = 'mention-item-name';
    name.textContent = `@${item.alias}`;
    const hint = document.createElement('span');
    hint.className = 'mention-item-hint';
    hint.textContent = item.name ? `${item.name} · ${item.hint}` : item.hint;
    row.append(name, hint);
    // mousedown — click은 input blur 뒤라 토큰 위치가 흔들린다.
    row.addEventListener('mousedown', (e) => { e.preventDefault(); insertMention(item.alias); });
    $mentionMenu.appendChild(row);
  });
  const rect = $input.getBoundingClientRect();
  $mentionMenu.style.left = `${rect.left}px`;
  $mentionMenu.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  $mentionMenu.style.minWidth = `${Math.min(420, Math.max(240, rect.width * 0.6))}px`;
  $mentionMenu.hidden = false;
  mentionState.open = true;
  mentionState.items = items;
}

$input.addEventListener('input', () => {
  const token = mentionTokenAtCaret();
  if (!token) { closeMentionMenu(); return; }
  void loadMentionAliases();
  const needle = token.query.toLowerCase();
  const items = mentionState.aliases
    .filter((s) => s.alias.toLowerCase().includes(needle)
      || String(s.name || '').toLocaleLowerCase('ko-KR').includes(token.query.toLocaleLowerCase('ko-KR')))
    .slice(0, 8);
  if (!items.length) { closeMentionMenu(); return; }
  mentionState.active = 0;
  renderMentionMenu(items);
});
$input.addEventListener('blur', () => closeMentionMenu());

// 제출 직전 호출 — @alias가 실제 등록 서버명일 때만 지시를 동봉한다. 오탈자나
// 이메일 주소 같은 우연한 @는 그대로 평문으로 남는다.
function augmentMentions(text) {
  const known = new Set(mentionState.aliases.map((s) => s.alias));
  const mentioned = [...new Set(
    [...String(text).matchAll(/@([A-Za-z0-9_-]+)/g)].map((m) => m[1]).filter((a) => known.has(a)),
  )];
  if (!mentioned.length) return text;
  return `${text}\n\n(사용자가 지정한 플러그인: ${mentioned.map((a) => `@${a}`).join(', ')} — 이 MCP 서버의 도구를 우선 사용해 답하라.)`;
}

// ---------- 입력 ----------
function dispatchUserQuery(text) {
  const normalized = String(text || '').trim() || '보유 종목 수급 요약해줘';
  if (isSettingsCommand(normalized)) {
    openSettings();
    return;
  }
  if (isHistoryCommand(normalized)) {
    runHistoryCommand(normalized);
    return;
  }
  runQuery(normalized);
}
// 사람이 타이핑하는 동안에도 자란다(붙여넣기·한글 조합 포함 — input 이벤트가
// keydown보다 확실하다).
$input.addEventListener('input', autoGrowInput);
$input.addEventListener('input', reportChatDraft);

$input.addEventListener('keydown', (e) => {
  // 멘션 메뉴가 열려 있으면 방향키·Enter·Tab·Esc는 메뉴 몫이다 — 제출보다 먼저.
  if (mentionState.open) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      mentionState.active = (mentionState.active + delta + mentionState.items.length) % mentionState.items.length;
      renderMentionMenu(mentionState.items);
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const item = mentionState.items[mentionState.active];
      if (item) insertMention(item.alias);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); closeMentionMenu(); return; }
  }
  // Shift+Enter는 줄바꿈이다(2026-09-02 — 입력창이 textarea가 된 뒤로 필요해졌다).
  // 그냥 Enter는 그대로 제출이고, 이때 preventDefault를 해야 제출과 동시에 줄바꿈이
  // 하나 들어가지 않는다(<input> 시절에는 애초에 줄바꿈이 없어 필요 없었다).
  if (e.key === 'Enter' && e.shiftKey) return;
  if (e.key !== 'Enter' || state !== 'idle' || remoteQueryBusy) return;
  e.preventDefault();
  // 첨부 칩이 있으면 전송 직전에 경로를 동봉한다(코덱스 UI 이식, 2026-08-27).
  const text = consumeAttachments($input.value);
  $input.value = '';
  autoGrowInput();
  dispatchUserQuery(text);
});

// 오브가 질의를 돌리는 동안 셸 입력도 잠근다(위 remoteQueryBusy 선언 참고).
window.athena.on('athena:live-query-state', ({ busy } = {}) => {
  if (state !== 'idle') return; // 셸 자신이 이미 진행 중이면 그쪽 setLocked가 우선한다
  remoteQueryBusy = !!busy;
  setLocked(remoteQueryBusy, remoteQueryBusy ? '오브에서 대화 중 — 잠시 후 다시 시도하세요' : undefined);
});

// 오브 "듣는 중" 실신호(2026-08-26 board-32) — 입력 지점은 이 창 하나뿐이라
// (확정 결정 3), 여기 포커스가 곧 "사람이 말을 거는 중"이라는 사실이다. 지어낸
// 감정이 아니라 이미 있는 DOM 신호에 이름만 붙이는 것뿐이다(orb.js 위 주석과 짝).
$input.addEventListener('focus', () => {
  window.athena.send('athena:orb-signal', { signal: 'listen', active: true });
});
$input.addEventListener('blur', () => {
  window.athena.send('athena:orb-signal', { signal: 'listen', active: false });
});

// 우상단 3버튼(최소화·최대화·닫기)과 창 단축키(Ctrl+M · Ctrl+Alt+방향키)가
// shell.js로 옮겨갔다. 창에 속하는 것이 어느 한 영역의 코드에 살면 안 된다 —
// 옛 판에서 여기 있었던 이유는 대화 창이 곧 앱의 창이었기 때문이다.
//
// 함께 사라진 것: toggleMaxHeight()/restoreFromMax()/restoreOrMinimize()와
// lastRestoreHeight, 그리고 `athena:window-key` 구독. 이 앱에서 "창의 최대"는
// OS 전체화면이 아니라 설계 최대 높이(chatMaxH)라는 정의 위에 서 있던 것들이다.
// 셸 창에서는 최대화가 그냥 OS 창 최대화이고, 그 상태의 소유자는 렌더러가
// 아니라 OS다 — 그래서 판정도 main으로 갔다(main.js athena:toggle-maximize).
//
// 창 이동은 네이티브 캡션이다(2026-08-19 표준화) — 손잡이는 chat.css의
// -webkit-app-region 선언(컨트롤 스트립·설정/주문 헤더)과 셸 타이틀바이고 JS
// 드래그 경로는 폐기됐다. 본문(.history)은 손잡이가 아니라 텍스트 선택이 된다.

// ---------- 컨트롤 스트립(AT-CH-001R, Paper 47쪽) — CLI 필 · 모델 필 · 팝오버 ----------
// 실기능만 올린다(soul.md §7): CLI 필은 runQuery의 실행기(claude -p) 표시이자
// 설정 진입로, 모델 필은 athena:model-get 실상태 표시이자 인라인 팝오버다.
// 팝오버는 창 안 오버레이 — 새 창을 만들지 않는다(soul.md §3).
// 스트립 필 줄은 전면 제거됐다(보드 45 v5, 2026-08-27) — 모델 진입은 키우미
// 메뉴 '모델 설정', CLI 전환·계정은 설정 모드(사이드바 계정 메뉴·커맨드바)만.
const $modelPopover = document.getElementById('modelPopover');

// lib/settings-cards.js의 CLAUDE_MODEL_CHIPS/CLAUDE_EFFORT_CHIPS와 같은 어휘 —
// 팝오버는 설정 모델 카드의 빠른 진입로일 뿐 새 어휘를 만들지 않는다(값을
// 바꾸려면 양쪽을 같이 바꾼다. UMD 모듈이 이 상수를 노출하지 않아 복제한다).
const PILL_MODEL_CHIPS = [
  { value: null, label: '기본' },
  { value: 'fable', label: 'fable' },
  { value: 'opus', label: 'opus' },
  { value: 'sonnet', label: 'sonnet' },
  { value: 'haiku', label: 'haiku' },
];
const PILL_EFFORT_CHIPS = [
  { value: null, label: '기본' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
  { value: 'max', label: 'max' },
];
const PILL_GROK_MODEL_CHIPS = [
  { value: null, label: '기본' },
  { value: 'grok-4.6', label: 'grok-4.6' },
  { value: 'grok-4.5', label: 'grok-4.5' },
];
const PILL_GROK_EFFORT_CHIPS = [
  { value: null, label: '기본' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
];

let modelStateCache = null;

async function refreshModelState() {
  try {
    modelStateCache = await window.athena.invoke('athena:model-get');
  } catch {
    // 상태를 못 읽으면 캐시를 갱신하지 않는다 — 추측값을 쓰지 않는다(정보 정직성).
  }
  if (!$modelPopover.hidden) renderModelPopover();
  renderComposerModel();
}

// 툴바의 모델·강도 라벨(Paper 44) — 팝오버와 같은 어휘, 첫 글자만 대문자. 값이 없으면(기본값 위임)
// 모델은 'Claude', 강도는 '기본' — "기본 기본"으로 읽히지 않게.
function composerChoiceLabel(chips, value, fallback) {
  const hit = chips.find((c) => c.value === value);
  const label = hit && hit.value !== null ? hit.label : fallback;
  return label.charAt(0).toUpperCase() + label.slice(1);
}
function renderComposerModel() {
  const c = (modelStateCache && modelStateCache.claude) || { model: null, effort: null };
  $modelBtn.textContent = composerChoiceLabel(PILL_MODEL_CHIPS, c.model, 'Claude');
  $effortBtn.textContent = composerChoiceLabel(PILL_EFFORT_CHIPS, c.effort, '기본');
}
async function openModelPopover() {
  await refreshModelState();
  renderModelPopover();
  $modelPopover.hidden = false;
}
function toggleModelPopover() {
  if ($modelPopover.hidden) void openModelPopover();
  else closeModelPopover();
}
$modelBtn.addEventListener('click', toggleModelPopover);
$effortBtn.addEventListener('click', toggleModelPopover);

function popoverSection(title, chips, currentValue, key, provider) {
  const t = document.createElement('div');
  t.className = 'mp-title';
  t.textContent = title;
  $modelPopover.appendChild(t);
  const row = document.createElement('div');
  row.className = 'mp-row';
  for (const c of chips) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mp-chip' + (c.value === currentValue ? ' on' : '');
    b.textContent = c.label;
    b.addEventListener('click', async () => {
      const res = await window.athena.invoke('athena:model-set', { provider, patch: { [key]: c.value } });
      if (res && res.ok === false) return; // 거부된 값은 상태를 안 바꾼다(model-prefs 검증)
      await refreshModelState();
    });
    row.appendChild(b);
  }
  $modelPopover.appendChild(row);
}

function renderModelPopover() {
  const c = (modelStateCache && modelStateCache.claude) || { model: null, effort: null };
  const g = (modelStateCache && modelStateCache.grok) || { model: null, effort: null };
  $modelPopover.textContent = '';
  popoverSection('Claude 모델', PILL_MODEL_CHIPS, c.model, 'model', 'claude');
  const sep = document.createElement('div');
  sep.className = 'mp-sep';
  $modelPopover.appendChild(sep);
  popoverSection('Claude 사고 강도', PILL_EFFORT_CHIPS, c.effort, 'effort', 'claude');
  const grokSep = document.createElement('div');
  grokSep.className = 'mp-sep';
  $modelPopover.appendChild(grokSep);
  popoverSection('Grok 모델', PILL_GROK_MODEL_CHIPS, g.model, 'model', 'grok');
  const grokEffortSep = document.createElement('div');
  grokEffortSep.className = 'mp-sep';
  $modelPopover.appendChild(grokEffortSep);
  popoverSection('Grok 사고 강도', PILL_GROK_EFFORT_CHIPS, g.effort, 'effort', 'grok');
}

function closeModelPopover() { $modelPopover.hidden = true; }

// 모델 팝오버는 키우미 메뉴 '모델 설정'이 연다(보드 45 v5) — 필은 사라졌다.
// 바깥 클릭으로 닫는다(키우미 메뉴 항목 클릭은 메뉴가 먼저 닫혀 겹치지 않는다).
document.addEventListener('mousedown', (e) => {
  if ($modelPopover.hidden) return;
  if ($modelPopover.contains(e.target) || $modelBtn.contains(e.target) || $effortBtn.contains(e.target)) return;
  closeModelPopover();
});

// ---------- 키우미 메뉴 (2026-08-27, Paper 보드 45) ----------
// 파일·폴더는 경로 텍스트로만 입력줄에 붙는다 — 내용은 CLI(claude -p)가 읽는다.
const $kiumiMenu = document.getElementById('kiumiMenu');

function closeKiumiMenu() { $kiumiMenu.hidden = true; }

const KIUMI_ICON_PATHS = Object.freeze({
  file: 'M7.5 2.5H4A1.5 1.5 0 0 0 2.5 4v6A1.5 1.5 0 0 0 4 11.5h6A1.5 1.5 0 0 0 11.5 10V6.5Zm0 0v4h4',
  folder: 'M1.8 3.4h4l1.1 1.3h5.3v6.2H1.8z',
  target: 'M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-3a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0-2h5',
  plan: 'M3 3h8M3 7h8M3 11h5M1.5 3h.01M1.5 7h.01M1.5 11h.01',
  model: 'M4 4V2.5M10 4V2.5M3.5 4h7A1.5 1.5 0 0 1 12 5.5v4a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 2 9.5v-4A1.5 1.5 0 0 1 3.5 4ZM5 7h.01M9 7h.01M5 9h4',
  plugin: 'M4.5 1.5v2M9.5 1.5v2M3 3.5h8v3A4 4 0 0 1 7 10.5 4 4 0 0 1 3 6.5v-3ZM7 10.5v2',
  search: 'M6.2 10.4a4.2 4.2 0 1 1 0-8.4 4.2 4.2 0 0 1 0 8.4Zm3-1.2 3 3',
  sheet: 'M2.5 2.5h9v9h-9zM2.5 6h9M6 2.5v9',
});

function kiumiIcon(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 14 14');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', KIUMI_ICON_PATHS[kind] || KIUMI_ICON_PATHS.plugin);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

// 보드 45/49: 항목은 중립 선형 SVG + 제목 + (있으면) 설명 2줄.
function kiumiItem(iconKind, label, desc, onPick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'km-item';
  const ic = document.createElement('span');
  ic.className = 'km-ic';
  ic.setAttribute('aria-hidden', 'true');
  ic.appendChild(kiumiIcon(iconKind));
  const col = document.createElement('span');
  col.className = 'km-col';
  const title = document.createElement('span');
  title.className = 'km-title';
  title.textContent = label;
  col.appendChild(title);
  if (desc) {
    const d = document.createElement('span');
    d.className = 'km-desc';
    d.textContent = desc;
    col.appendChild(d);
  }
  b.append(ic, col);
  b.addEventListener('click', onPick);
  return b;
}

// 첨부 칩(2026-08-27, 코덱스 UI 이식) — 경로는 입력줄이 아니라 칩으로 쌓이고,
// 전송 시점에 프롬프트 뒤에 동봉된다. 눈에 보이는 질문은 깨끗하게 남는다.
const $attachChips = document.getElementById('attachChips');
let attachments = []; // { path, isDir }

function renderAttachChips() {
  $attachChips.textContent = '';
  $attachChips.hidden = attachments.length === 0;
  attachments.forEach((att, i) => {
    const chip = document.createElement('span');
    chip.className = 'attach-chip';
    const ic = document.createElement('span');
    ic.className = 'attach-chip-ic';
    ic.appendChild(kiumiIcon(att.isDir ? 'folder' : 'file'));
    const name = document.createElement('span');
    name.className = 'attach-chip-name';
    name.textContent = att.path.split(/[\\/]/).pop() || att.path;
    name.title = att.path;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'attach-chip-rm';
    rm.setAttribute('aria-label', '첨부 제거');
    rm.textContent = '×';
    rm.addEventListener('click', () => {
      attachments.splice(i, 1);
      renderAttachChips();
    });
    chip.appendChild(ic);
    chip.appendChild(name);
    chip.appendChild(rm);
    $attachChips.appendChild(chip);
  });
}

async function pickAttachments(directory) {
  closeKiumiMenu();
  try {
    const res = await window.athena.invoke('athena:pick-files', { directory });
    if (res && res.ok && Array.isArray(res.paths)) {
      for (const p of res.paths) {
        if (!attachments.some((a) => a.path === p)) attachments.push({ path: p, isDir: !!directory });
      }
      renderAttachChips();
    }
  } catch { /* 취소·실패는 조용히 — 칩을 건드리지 않는다 */ }
  $input.focus();
}

// 전송 직전 병합 — 프롬프트 뒤에 경로를 동봉하고 칩을 비운다. 입력이 비었으면
// 기본 질의 대신 첨부를 읽으라는 요청으로 채운다(없는 질문을 지어내지 않는다).
function consumeAttachments(text) {
  if (!attachments.length) return text;
  const paths = attachments.map((a) => a.path);
  attachments = [];
  renderAttachChips();
  const head = String(text || '').trim() || '첨부한 파일을 읽고 내용을 설명해줘';
  return `${head}\n\n[첨부 — 아래 경로를 Read(파일)/Glob(폴더)으로 직접 읽어라]\n${paths.join('\n')}`;
}

function kiumiSection(title) {
  const t = document.createElement('div');
  t.className = 'km-section';
  t.textContent = title;
  return t;
}

function renderKiumiMenu() {
  $kiumiMenu.textContent = '';
  $kiumiMenu.appendChild(kiumiSection('추가'));
  $kiumiMenu.appendChild(kiumiItem('file', '파일 첨부', '경로가 첨부 칩으로 쌓인다', () => pickAttachments(false)));
  $kiumiMenu.appendChild(kiumiItem('folder', '폴더 첨부', '폴더 경로를 칩으로 쌓는다', () => pickAttachments(true)));
  $kiumiMenu.appendChild(kiumiItem('target', '목표', '계속 추구할 목표를 설정', () => {
    closeKiumiMenu();
    $input.value = '달성할 목표를 구체화해줘: ';
    autoGrowInput();
    $input.focus();
  }));
  $kiumiMenu.appendChild(kiumiItem('plan', '계획 모드', '실행 전에 계획을 정리', () => {
    closeKiumiMenu();
    $input.value = '다음 작업을 실행 가능한 단계와 검증 기준으로 계획해줘: ';
    autoGrowInput();
    $input.focus();
  }));
  const sep = document.createElement('div');
  sep.className = 'mp-sep';
  $kiumiMenu.appendChild(sep);
  // 키우미의 플러그인 구역은 "현재 대화에서 빠르게 부르기"다(설계서: 키우미는
  // 설치된 플러그인의 빠른 실행 진입점). 그래서 고정 목록이 아니라 실제로
  // 등록·승인된 서버만 싣고, 고르면 입력란에 @별칭을 넣어 다음 턴이 그 서버의
  // 도구를 먼저 쓰게 한다. 관리는 아래 설정 구역의 항목이 맡는다.
  const openPlugin = (view) => {
    closeKiumiMenu();
    if (window.AthenaCanvasMode && typeof window.AthenaCanvasMode.setView === 'function') {
      window.AthenaCanvasMode.setView('plugin');
    }
    if (window.AthenaModeNav && typeof window.AthenaModeNav.setActive === 'function') {
      window.AthenaModeNav.setActive('plugin');
    }
    if (window.AthenaPluginCanvas && typeof window.AthenaPluginCanvas.setView === 'function') {
      window.AthenaPluginCanvas.setView(view);
    }
  };
  $kiumiMenu.appendChild(kiumiSection('플러그인'));
  if (mentionState.aliases.length) {
    mentionState.aliases.slice(0, 6).forEach((server) => {
      $kiumiMenu.appendChild(kiumiItem(
        'plugin',
        server.name || server.alias,
        `@${server.alias} · ${server.hint}`,
        () => {
          closeKiumiMenu();
          const value = $input.value;
          const spacer = value && !/\s$/.test(value) ? ' ' : '';
          $input.value = `${value}${spacer}@${server.alias} `;
          autoGrowInput();
          $input.focus();
          $input.setSelectionRange($input.value.length, $input.value.length);
        },
      ));
    });
  } else {
    $kiumiMenu.appendChild(kiumiItem('plugin', '설치된 플러그인 없음', '플러그인 모드에서 추천을 설치합니다', () => openPlugin('hub')));
  }
  const settingsSep = document.createElement('div');
  settingsSep.className = 'mp-sep';
  $kiumiMenu.appendChild(settingsSep);
  $kiumiMenu.appendChild(kiumiSection('설정'));
  // 모델·추론 노력 — 스트립 필 제거로 이 메뉴가 유일한 진입로다(보드 45 v5).
  // 설명은 Paper 2HDB-2 원문 그대로다 — 이 항목이 여는 모델 팝오버(보드 09)는
  // 화면 문구가 아니라 여기 주석에 적는다(제품 문구 3원칙: 내부용어 금지).
  $kiumiMenu.appendChild(kiumiItem('model', '모델 설정', '모델 · 사고 강도', async () => {
    closeKiumiMenu();
    await refreshModelState();
    renderModelPopover();
    $modelPopover.hidden = false;
  }));
  $kiumiMenu.appendChild(kiumiItem('plugin', '플러그인 관리', '설치 · 기능 허용 · 마켓플레이스', () => openPlugin('manage')));
}

function toggleKiumiMenu() {
  if ($kiumiMenu.hidden) {
    renderKiumiMenu();
    $kiumiMenu.hidden = false;
    // 첫 로드가 아직 안 끝났으면 "설치된 플러그인 없음"이 잠깐 뜬다 — 목록이
    // 도착하면 열려 있는 메뉴를 그 자리에서 다시 그린다(이미 로드됐으면 즉시 반환).
    void loadMentionAliases().then(() => { if (!$kiumiMenu.hidden) renderKiumiMenu(); });
  } else {
    closeKiumiMenu();
  }
}

document.addEventListener('mousedown', (e) => {
  if ($kiumiMenu.hidden) return;
  if ($kiumiMenu.contains(e.target) || $dot.contains(e.target) || $attachBtn.contains(e.target)) return;
  closeKiumiMenu();
});
window.athena.on('athena:model-changed', () => refreshModelState());
refreshModelState();

// Paper 54의 새 대화는 DOM만 비우는 동작이 아니다. 진행 중인 턴의 렌더 토큰을
// 먼저 폐기해 이전 응답이 새 방에 뒤늦게 붙는 것을 막고, main의 실행도 함께
// 중단한다. sidebar.js가 새 기록 id를 요청하기 직전에 이 이벤트를 보낸다.
window.addEventListener('athena:new-conversation', () => {
  abortToken += 1;
  window.athena.send('athena:abort-live-query');
  window.athena.send('athena:orb-signal', { signal: 'think', active: false });
  state = 'idle';
  setDot(null);
  setLocked(false);
  if (liveProgressEl) {
    liveProgressEl.remove();
    liveProgressEl = null;
  }
});

// 실행 중 턴 중단 — Esc(아래 keydown)와 입력 상자의 ■ 버튼(Paper 44)이 같은 경로를 탄다.
function abortLiveTurn() {
  abortToken++; // 중단 — UI 반영 차단
  window.athena.send('athena:abort-live-query'); // 실배선 프로세스 트리도 실제로 죽인다
  // 죽는 질의의 finally는 이제 stale이라 침묵한다(결함② 수정과 짝) — 여기서 즉시 끈다.
  window.athena.send('athena:orb-signal', { signal: 'think', active: false });
  state = 'idle';
  setDot(null);
  setLocked(false);
  if (liveProgressEl) {
    // AC10 반전(2026-08-27, 계획 v5 §5.3 결정을 뒤집는 사용자 지시 — Paper
    // DFQ-0 확정 명세) — 중단 전에 이미 실행한 조각이 있으면 접힌 기록으로
    // 남긴다. toolStepStates가 비어 있으면(순수 판단 중 중단 — 도구 호출
    // 자체가 없었다) foldExecutionRecord가 그대로 null을 돌려줘 완료 턴의
    // "기록 없음" 분기와 같은 취급이 된다(진행 라인만 지운다, 기존 동작).
    const toolSteps = liveProgressEl.querySelector('.progress-tool-steps');
    const execRecord = liveProgressEl.toolStepStates
      ? foldExecutionRecord(toolSteps, liveProgressEl.startedAt, { aborted: true, steps: liveProgressEl.toolStepStates })
      : null;
    if (execRecord) {
      const aLine = document.createElement('div');
      aLine.className = 'turn';
      aLine.appendChild(execRecord);
      $history.appendChild(aLine);
    }
    liveProgressEl.remove();
    liveProgressEl = null;
  }
  scrollAfterRender();
}
$stopBtn.addEventListener('click', () => { if (state !== 'idle') abortLiveTurn(); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // 지금 눈앞에 있는 것이 먼저다 — 팝오버 → 주문 티켓 → 계좌 전환 → 설정 순으로 닫는다.
    if (!$modelPopover.hidden) {
      closeModelPopover();
      return;
    }
    if (orderOpen) {
      closeOrderTicket();
      return;
    }
    if (accountSwitchOpen) {
      closeAccountSwitchScreen();
      return;
    }
    if (settingsOpen) {
      closeSettings();
      return;
    }
    if (state !== 'idle') {
      abortLiveTurn();
    } else {
      // 옛 판에서 이 키는 캔버스 **창**을 수축시켜 닫았다(athena:collapse-canvas).
      // 닫을 창이 없어진 뒤 남는 의미는 "쌓인 카드를 치운다"이고, 두 영역이 같은
      // 문서에 사는 지금은 IPC 왕복 없이 shell.js 버스로 바로 부른다.
      window.AthenaShell.clearCanvases();
    }
  }
});

// ---------- 능동 턴 · 활성 루틴 칩 (능동 에이전트 P2, 2026-08-19) ----------
// 백엔드 파수꾼의 발화가 여기서 대화 이력에 들어온다 — 사용자 질의 없이
// 나타나는 유일한 턴 종류(GLOSSARY '능동 턴'). 본문은 결정론 템플릿
// (lib/routine-turn.js — LLM 0)이고, 발화 시각 배지·방식 표기·소스 라벨이
// 필수 계약이다(시점 정직성). 렌더는 전부 textContent — innerHTML 0건 유지.
const routineTurnLib = window.AthenaLib.RoutineTurn;
// 루틴 칩은 스트립과 함께 제거됐다(보드 45 v5, 2026-08-27) — 활성 감시 수 표시는
// 사이드바 에이전트 배지의 몫(에이전트모드 구현과 함께 배선).

// 능동 턴·승인 카드·주문 티켓이 공유하는 DOM 조립 헬퍼 — 렌더는 textContent만.
function _btn(label, className) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  return b;
}

function _mountTurn(line, el) {
  line.appendChild(el);
  $history.appendChild(line);
  // 등장은 굴절 변조 — chat.css의 .turn-agent 전이. reduced-motion이면 즉시.
  requestAnimationFrame(() => el.classList.add('is-in'));
  $history.scrollTop = $history.scrollHeight;
  scrollAfterRender();
}

function renderAgentTurn(event) {
  const model = routineTurnLib.buildTurnModel(event, Date.now());
  // F-stage5b-FE — "이어진 대화" 계측의 기준점. fired만 채운다(위 maybeRecordReplied 참고).
  if (model.kind === 'fired' && event && event.routine_id) {
    lastFiredRoutine = { routineId: event.routine_id, at: Date.now() };
  }
  const line = document.createElement('div');
  line.className = 'turn';
  const box = document.createElement('div');
  box.className = `turn-agent agent-${model.kind}`;

  const head = document.createElement('div');
  head.className = 'agent-head';
  if (model.badge) {
    const badge = document.createElement('span');
    badge.className = 'agent-badge';
    badge.textContent = model.badge;
    head.appendChild(badge);
  }
  if (model.modeText) {
    const mode = document.createElement('span');
    mode.className = 'agent-mode';
    mode.textContent = model.modeText;
    head.appendChild(mode);
  }
  if (model.relative) {
    const rel = document.createElement('span');
    rel.className = 'agent-rel';
    rel.textContent = model.relative; // 보드 37: 상대시각만, 접두사 없음
    head.appendChild(rel);
  }
  if (head.childNodes.length) box.appendChild(head);

  // 소스 캡션 위치는 종별로 다르다(보드 37/09): 발화 턴은 맨 아래, 나머지는 머리 다음.
  if (model.sourceLabel && model.kind !== 'fired') {
    const src = document.createElement('div');
    src.className = 'agent-source';
    src.textContent = model.sourceLabel;
    box.appendChild(src);
  }

  if (model.kind === 'fired' && model.symbolText) {
    // 보드 37 구조 분해 본문: 종목 필 + 조건 도달 문장 + 시점 고지(전폭 줄).
    const body = document.createElement('div');
    body.className = 'agent-body agent-body-fired';
    const pill = document.createElement('span');
    pill.className = 'agent-symbol-pill';
    pill.textContent = model.symbolText;
    const text = document.createElement('span');
    text.className = 'agent-body-text';
    text.textContent = model.bodyText;
    const note = document.createElement('div');
    note.className = 'agent-body-note';
    note.textContent = model.bodyNote;
    body.append(pill, text, note);
    box.appendChild(body);

    // 감시 조건 패널(보드 37 ③) — 헤더 + 종목 줄 + 조건 행(✓/△·라벨·관측값).
    // 목업의 헤더 아이콘 2개는 동작 미규정이라 만들지 않는다(죽은 버튼 금지).
    if (Array.isArray(model.conditions) && model.conditions.length) {
      const watch = document.createElement('div');
      watch.className = 'agent-watch';
      const whead = document.createElement('div');
      whead.className = 'agent-watch-head';
      const wtitle = document.createElement('span');
      wtitle.className = 'agent-watch-title';
      wtitle.textContent = '감시 조건';
      whead.appendChild(wtitle);
      const wbody = document.createElement('div');
      wbody.className = 'agent-watch-body';
      const wsym = document.createElement('div');
      wsym.className = 'agent-watch-symbol';
      wsym.textContent = model.symbolText;
      wbody.appendChild(wsym);
      for (const cond of model.conditions) {
        const row = document.createElement('div');
        row.className = 'agent-watch-row';
        const ic = document.createElement('span');
        ic.className = `agent-watch-ic${cond.met ? ' is-met' : ''}`;
        ic.textContent = cond.met ? '✓' : '△';
        const label = document.createElement('span');
        label.className = 'agent-watch-label';
        label.textContent = cond.label;
        const value = document.createElement('span');
        value.className = 'agent-watch-value';
        value.textContent = cond.value;
        row.append(ic, label, value);
        wbody.appendChild(row);
      }
      watch.append(whead, wbody);
      box.appendChild(watch);
    }
  } else {
    const body = document.createElement('div');
    body.className = 'agent-body';
    body.textContent = model.body;
    box.appendChild(body);
  }

  // 발화 턴 → 주문 티켓 직행 경로(P4, LIV-066 시나리오의 정답 구조).
  // 티켓을 여는 것뿐 — 주문은 티켓 안에서 사람이 실행한다.
  // note: 보드 37 목업엔 이 버튼이 없다 — P4 기능 결정이 우선, Paper 역반영 후보.
  if (model.kind === 'fired') {
    const actions = document.createElement('div');
    actions.className = 'routine-approval-actions';
    const openBtn = _btn('주문 티켓 열기', 'routine-btn');
    openBtn.addEventListener('click', () => {
      openOrderTicket(orderTicketLib.buildPrefill(event));
    });
    actions.appendChild(openBtn);
    box.appendChild(actions);
  }

  if (model.sourceLabel && model.kind === 'fired') {
    const src = document.createElement('div');
    src.className = 'agent-source';
    src.textContent = model.sourceLabel;
    box.appendChild(src);
  }

  _mountTurn(line, box);
}

window.athena.on('athena:routine-event', (event) => {
  renderAgentTurn(event);
});

// Fast Selector의 guarded order 결과는 기존 주문 확인 티켓에만 착지한다.
// 이 이벤트 경로에서는 athena:order-execute를 호출하지 않는다 — 실행은 아래
// 티켓 안의 사용자 클릭 핸들러 하나로 계속 제한된다.
window.athena.on('athena:selector-order-draft', (payload) => {
  const prefill = orderTicketLib.buildSelectorOrderPrefill(payload);
  if (prefill) openOrderTicket(prefill);
});

// ---------- 예약 자동 브리핑 턴(R1, 4단계) ----------
// 사용자 턴 채널(athena:live-*)과 완전히 분리된 별개 핸들러들이다(MAJOR 2).
// 코드 리뷰 체크포인트: 아래 세 핸들러는 setLocked를 절대 부르지 않는다 —
// 브리핑은 배지·본문 표시만 하고 셸 입력을 잠그지 않는다(백엔드 scheduler의
// "대화가 우선" 원칙의 렌더러 쪽 절반). 기존 athena:live-query-state 핸들러
// (setLocked 호출)와 함수를 공유하지 않는다.
let briefingCard = null; // { badge, steps, body } — 진행 중 브리핑 카드의 DOM 참조
let briefingText = '';

function ensureBriefingCard() {
  if (briefingCard) return briefingCard;
  const line = document.createElement('div');
  line.className = 'turn';
  const box = document.createElement('div');
  box.className = 'turn-agent agent-briefing';
  const head = document.createElement('div');
  head.className = 'agent-head';
  const badge = document.createElement('span');
  badge.className = 'agent-badge';
  badge.textContent = '브리핑 실행 중';
  head.appendChild(badge);
  box.appendChild(head);
  const steps = document.createElement('div');
  steps.className = 'agent-source';
  steps.hidden = true;
  box.appendChild(steps);
  const body = document.createElement('div');
  body.className = 'agent-body';
  box.appendChild(body);
  _mountTurn(line, box);
  briefingCard = { badge, steps, body };
  return briefingCard;
}

window.athena.on('athena:briefing-query-state', ({ busy, ok, aborted } = {}) => {
  // 배지 전용 — setLocked 미호출(위 체크포인트). 입력은 계속 열려 있다.
  if (busy) {
    briefingText = '';
    ensureBriefingCard();
    return;
  }
  if (briefingCard) {
    // 종료 상태는 러너가 명시한다(ok/aborted) — 본문 유무로 추측하지 않는다.
    // 선점 중단은 부분 본문이 남아 있어도 완료로 표시하면 안 된다.
    briefingCard.badge.textContent = ok
      ? '브리핑 완료'
      : (aborted ? '브리핑 중단 — 새 대화가 우선됨' : '브리핑 생성 실패 — 알림만 표시');
    briefingCard.steps.hidden = true;
    briefingCard = null; // 다음 브리핑은 새 카드로
  }
});

window.athena.on('athena:briefing-text-delta', ({ text } = {}) => {
  if (typeof text !== 'string' || !text) return;
  briefingText += text;
  const card = ensureBriefingCard();
  card.body.textContent = briefingText;
  scrollAfterRender();
});

window.athena.on('athena:briefing-tool-step', (step = {}) => {
  if (!step || !step.label) return;
  const card = ensureBriefingCard();
  card.steps.hidden = false;
  card.steps.textContent = step.done ? `${step.label} 완료` : `${step.label}…`;
});

// ---------- 놓친 예약 캐치업 카드(R1, 5단계) ----------
// 기동 시 main이 감지한 놓친 예약을 사람이 확인해야 실행된다. 순서 보장(①
// catchup-fire ledger 기록 → ② 브리핑 실행, MAJOR 3)은 main 쪽 invoke 핸들러
// 몫이고, 이 카드는 물어보고 결과를 표시할 뿐이다. 건너뛰기는 백엔드 API를
// 부르지 않고 카드만 닫는다(계획 명시).
function renderMissedScheduleCard(r) {
  const line = document.createElement('div');
  line.className = 'turn';
  const card = document.createElement('div');
  card.className = 'turn-agent routine-missed';

  const head = document.createElement('div');
  head.className = 'agent-head';
  const badge = document.createElement('span');
  badge.className = 'agent-badge';
  badge.textContent = '놓친 예약';
  head.appendChild(badge);
  card.appendChild(head);

  const title = document.createElement('div');
  title.className = 'routine-draft-title';
  title.textContent = r.note || `${r.symbol || ''} 예약 브리핑`.trim();
  card.appendChild(title);

  const body = document.createElement('div');
  body.className = 'agent-body';
  body.textContent = '앱이 꺼져 있는 동안 예약 시각이 지났습니다. 지금 브리핑을 실행할까요?';
  card.appendChild(body);

  const row = document.createElement('div');
  row.className = 'routine-approval-actions';
  const status = document.createElement('span');
  status.className = 'agent-mode';

  const confirm = _btn('지금 브리핑', 'routine-btn routine-btn-approve');
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    skip.disabled = true;
    const res = await window.athena.invoke('athena:routine-missed-confirm', { id: r.id });
    if (res && res.ok) {
      status.textContent = '발화가 기록됐습니다 — 브리핑 시작';
    } else if (res && res.status === 409) {
      // 이미 처리된 예약(중복 클릭·다른 경로 선처리) — 재시도 버튼을 되살리지 않는다.
      status.textContent = '이미 처리된 예약입니다';
    } else {
      status.textContent = `실패: ${(res && res.error) || '알 수 없는 오류'}`;
      confirm.disabled = false;
      skip.disabled = false;
    }
  });

  const skip = _btn('건너뛰기', 'routine-btn');
  skip.addEventListener('click', () => {
    // fire-and-forget — main 쪽 보관 뷰 정리뿐, 백엔드 API 호출 없음.
    window.athena.invoke('athena:routine-missed-skip', { id: r.id }).catch(() => {});
    line.remove(); // 카드만 닫는다
  });

  row.appendChild(confirm);
  row.appendChild(skip);
  row.appendChild(status);
  card.appendChild(row);

  _mountTurn(line, card);
}

window.athena.on('athena:routine-missed', ({ routines } = {}) => {
  if (!Array.isArray(routines)) return;
  for (const r of routines) renderMissedScheduleCard(r);
});

// ---------- 오브에서 오간 턴 반영(2026-08-26 board-33/34) ----------
// 셸이 숨겨진 동안 오브 대화 모드가 돌린 턴은 chat.js가 그 순간에는 그릴 수
// 없었다(창이 안 보였으니까) — main이 턴이 끝난 뒤 늦게 알려주면 여기서
// $history에 채워 넣는다. "대화창으로 가기 → 메인 방 그대로 이어진다"(board-34)의
// 시각적 절반 — 세션·이력 저장은 runLiveQuery가 이미 끝냈고, 이 핸들러는 DOM
// 표시만 뒤늦게 맞춘다. 진행 중이던 셸 자신의 턴과 순서가 꼬이지 않게 idle일
// 때만 붙인다(원리상 겹칠 수 없다 — 셸이 숨어야 오브가 말할 수 있으므로).
window.athena.on('athena:orb-turn-committed', ({ query, result } = {}) => {
  if (state !== 'idle' || !query) return;
  const qLine = document.createElement('div');
  qLine.className = 'turn';
  const qText = document.createElement('div');
  qText.className = 'turn-q';
  qText.textContent = query;
  qLine.appendChild(qText);
  $history.appendChild(qLine);

  const aLine = document.createElement('div');
  aLine.className = 'turn';
  if (result && !result.ok) {
    renderFailureBubble(aLine, (result && result.error) || '알 수 없는 오류');
  } else {
    const aText = document.createElement('div');
    aText.className = 'turn-a';
    window.AthenaLib.Markdown.render(aText, (result && result.answerText) || '완료 — 답변 텍스트 없음');
    aLine.appendChild(aText);
  }

  const meta = document.createElement('div');
  meta.className = 'turn-meta';
  const canvasTypes = (result && result.canvasTypes) || [];
  for (const t of canvasTypes) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = canvasTypeLabel(t);
    meta.appendChild(chip);
  }
  aLine.appendChild(meta);

  $history.appendChild(aLine);
  scrollAfterRender();
});

// ---------- 루틴 승인 카드 (P3, 2026-08-19) ----------
// 모델은 draft 제안만 할 수 있다(athena_routine — confirm/cancel 액션 자체가
// 없다). 사람이 이 카드의 [승인]을 눌러야 감시가 시작된다. [승인] 클릭은
// LLM 재스폰 없이 렌더러가 백엔드 confirm을 직접 부른다(~200ms — C1 결정).
// 방식 행은 필수다(§8 고지 의무 — verify 검증 대상).
// id → 초안을 처음 본 시각(ISO, 앱측 클록) — 백엔드 생성 시각이 아니라 "우리가
// 언제부터 이 카드를 보여주고 있었나"를 잰다. dedup 겸용(Set 대신 Map).
const firstSeenAtById = new Map();

async function refreshRoutineDrafts() {
  let routines;
  try {
    const res = await window.athena.invoke('athena:routines-list');
    routines = res && res.ok && res.data && Array.isArray(res.data.routines)
      ? res.data.routines : [];
  } catch { return; }
  for (const r of routines) {
    if (r.status !== 'draft' || firstSeenAtById.has(r.id)) continue;
    firstSeenAtById.set(r.id, new Date().toISOString());
    renderApprovalCard(r);
  }
}

// ---------- 코드 알람 검사 카드(Step 6, Paper 보드 10/446V-1) ----------
// 초안 카드의 「검사」 칩과 그 결과 카드. 문구 계산은 lib/watch-check-card.js가
// 전담하고(순수 함수 — 테스트가 문구를 못박는다) 여기는 통로와 DOM 조립만
// 맡는다. 승인은 초안 카드와 같은 athena:routine-confirm 경로 하나뿐이다 —
// 사람 클릭 전용(§7-6).
const watchCheckCardLib = window.AthenaLib.WatchCheckCard;

// 목록 뷰에 watch 블록이 없을 수 있다 — 없으면 상세를 1회 더 불러 채운다.
async function watchBlockOf(r) {
  if (r.watch) return r.watch;
  try {
    const res = await window.athena.invoke('athena:routine-detail', { id: r.id });
    const w = res && res.ok && res.data && res.data.watch;
    if (w) r.watch = w;
    return w || null;
  } catch { return null; }
}

// 확인 주기(분) — 백엔드가 초로 준다. 모르면 보드 10의 기본값 1분.
function watchPollMinutes(r) {
  const sec = Number((r.watch && r.watch.poll_interval_s) || 0);
  return Number.isFinite(sec) && sec >= 60 ? Math.round(sec / 60) : 1;
}

// 검사 1회 — 응답 본문을 그대로 돌려준다(문구는 checkCardModel이 만든다).
// 통로 자체가 실패하면 카드가 실패로 그려지도록 ok:false 모양으로 감싼다.
async function runWatchCheck(r) {
  const watch = await watchBlockOf(r);
  if (!watch || !watch.project_id || !watch.path) return null;
  const body = {
    project_id: watch.project_id,
    path: watch.path,
    symbol: r.symbol,
    params: watch.params || {},
    lookback_days: watch.lookback_days || 30,
    cooldown_s: r.cooldown_s,
    routine_id: r.id,
  };
  let res;
  try { res = await window.athena.invoke('athena:routine-watch-check', { body }); }
  catch { return { ok: false, reason: '검사 통로가 막혀 있음' }; }
  if (res && res.ok && res.data) return res.data;
  return { ok: false, reason: (res && res.error) || '검사 통로가 막혀 있음' };
}

// 자동 검사 진행 패널(Paper 보드 09 · 458M-1) — 검사 카드와 「도는 중」 카드가 같은
// 문법을 쓴다. 마크는 세 종류뿐이고 발치 안전 고지는 순수 모델의 상수다.
const watchProgressLib = window.AthenaLib.WatchProgressCard;

const WATCH_PROGRESS_MARK_CLASS = {
  '✓': 'done', '◐': 'running', '○': 'pending',
};

function appendWatchProgress(card, progress) {
  const panel = document.createElement('div');
  panel.className = 'watch-progress';

  const head = document.createElement('div');
  head.className = 'watch-progress-head';
  const left = document.createElement('span');
  left.className = 'watch-progress-head-left';
  left.textContent = progress.headLeft;
  head.appendChild(left);
  const right = document.createElement('span');
  right.className = 'watch-progress-head-right';
  right.textContent = progress.headRight;
  head.appendChild(right);
  panel.appendChild(head);

  for (const line of progress.lines) {
    const row = document.createElement('div');
    row.className = `watch-progress-line is-${WATCH_PROGRESS_MARK_CLASS[line.mark] || 'pending'}`;
    const mark = document.createElement('span');
    mark.className = 'watch-progress-mark';
    mark.textContent = line.mark;
    row.appendChild(mark);
    const text = document.createElement('span');
    text.className = 'watch-progress-text';
    text.textContent = line.text;
    row.appendChild(text);
    panel.appendChild(row);
  }

  const notice = document.createElement('div');
  notice.className = 'watch-progress-notice';
  notice.textContent = progress.notice;
  panel.appendChild(notice);

  card.appendChild(panel);
}

// 검사가 도는 동안의 카드. 결과가 오면 이 턴을 걷고 검사 카드가 그 자리에 선다 —
// 같은 사실을 두 카드가 반복하지 않는다.
function renderWatchProgressTurn(r) {
  const line = document.createElement('div');
  line.className = 'turn';
  const card = document.createElement('div');
  card.className = 'turn-agent routine-approval';
  appendWatchProgress(card, watchProgressLib.buildProgress({
    pending: true,
    symbol: r.symbol,
    lookback_days: (r.watch && r.watch.lookback_days) || null,
  }));
  _mountTurn(line, card);
  return line;
}

function renderWatchCheckCard(r, check) {
  const model = watchCheckCardLib.checkCardModel(check, r);
  const line = document.createElement('div');
  line.className = 'turn';
  const card = document.createElement('div');
  card.className = 'turn-agent routine-approval';

  const head = document.createElement('div');
  head.className = 'agent-head';
  model.tags.forEach((tag, i) => {
    const pill = document.createElement('span');
    // 뒤쪽 배지가 판정이다 — 실패면 초안 pill과 같은 강조를 쓴다.
    pill.className = i > 0 && model.failed ? 'routine-draft-pill is-draft' : 'routine-draft-pill';
    pill.textContent = tag;
    head.appendChild(pill);
  });
  card.appendChild(head);

  const title = document.createElement('div');
  title.className = 'routine-draft-title';
  title.textContent = model.title;
  card.appendChild(title);

  if (model.subtitle) {
    const sub = document.createElement('div');
    sub.className = 'agent-body';
    sub.textContent = model.subtitle;
    card.appendChild(sub);
  }

  if (model.reason) {
    const why = document.createElement('div');
    why.className = 'agent-source';
    why.textContent = model.reason;
    card.appendChild(why);
  }

  // A-10 — 오늘 봉은 아직 안 끝났다는 고지. 검사 카드에서 빠질 수 없다.
  const counted = document.createElement('div');
  counted.className = 'agent-source';
  counted.textContent = model.countedUntil;
  card.appendChild(counted);

  // 보드 09(458M-1) — 무엇을 확인했고 무엇이 아직인지 다섯 줄로 말하고,
  // 발치에 격리 실행 고지를 붙인다(백엔드 응답과 무관한 상수다).
  appendWatchProgress(card, watchProgressLib.buildProgress(check));

  if (r.activation_blocker) {
    const blocker = document.createElement('div');
    blocker.className = 'agent-source';
    blocker.textContent = `지금은 켤 수 없음: ${r.activation_blocker}`;
    card.appendChild(blocker);
  }

  const row = document.createElement('div');
  row.className = 'routine-approval-actions';
  const status = document.createElement('span');
  status.className = 'agent-mode';
  const buttons = [];
  for (const chip of model.chips) {
    const btn = _btn(chip.label, chip.action === 'confirm' ? 'routine-btn routine-btn-approve' : 'routine-btn');
    btn.disabled = !chip.enabled || (chip.action === 'confirm' && !!r.activation_blocker);
    if (chip.action === 'confirm') {
      btn.addEventListener('click', async () => {
        for (const b of buttons) b.disabled = true;
        const res = await window.athena.invoke('athena:routine-confirm', { id: r.id });
        if (res && res.ok) {
          status.textContent = '켬 — 장중에 이 함수를 돌려 봄';
        } else {
          status.textContent = `켜기 실패: ${(res && res.error) || '알 수 없는 오류'}`;
          for (const b of buttons) b.disabled = false;
          btn.disabled = !!r.activation_blocker;
        }
      });
    } else {
      btn.addEventListener('click', () => {
        $input.value = draftFixSeedText(r);
        autoGrowInput();
        $input.focus();
      });
    }
    buttons.push(btn);
    row.appendChild(btn);
  }
  row.appendChild(status);
  card.appendChild(row);

  _mountTurn(line, card);
}

function approvalModeLine(r) {
  const modeText = routineTurnLib.describeMode(r.mode);
  // describeMode()와 짝을 이루는 3분기(3단계, 사실11②) — periodic만 따로
  // 걷어내고 나머지를 전부 "틱 즉시"로 묶으면 예약(scheduled)에도 그 문구가
  // 붙어 "방식 예약 실행 — 틱 즉시"라는 자기모순이 생긴다.
  const suffix = r.mode === 'periodic' ? ' — 최대 폴링 주기만큼 지연'
    : r.mode === 'scheduled' ? ' — 지정 요일·시각'
    : ' — 틱 즉시';
  const exp = r.experimental_source ? ' · [실값 미확인 필드]' : '';
  // 코드 알람(Step 6, 보드 10 「장중 1분마다」) — 확인 주기는 초안의 watch
  // 블록이 정한다. describeMode의 기본 문구 대신 실제 주기를 적는다.
  if (r.mode === 'code-watch') return `방식 코드 감시 — 장중 ${watchPollMinutes(r)}분마다${exp}`;
  return `방식 ${modeText}${suffix}${exp}`;
}

// 43번 "새 작업은 채팅에서" — 실제 백엔드 필드(mode·source_label·cooldown_s)만
// 조합한다. Paper 목업의 "매매일 15:40 · 소스: 계좌 + 일봉 차트"류 문구는 예약
// (schedule) 트리거 전용 예시라 실제 draft(SOURCES 카탈로그 조건-감시형)에는
// 대응 필드가 없다 — 지어내지 않는다(P3, 8단계 재검증).
function draftDescriptionLine(r) {
  return `${approvalModeLine(r)} · 소스 ${r.source_label || '—'} · 쿨다운 ${r.cooldown_s}초`;
}

// "고칠 게 있어" 클릭 → 시트 없이 채팅으로(동선 규칙②: 편집도 채팅으로).
function draftFixSeedText(r) {
  return `"${r.note}" 초안을 고쳐줘 — `;
}

function renderApprovalCard(r) {
  const line = document.createElement('div');
  line.className = 'turn';
  const card = document.createElement('div');
  card.className = 'turn-agent routine-approval';

  // 작업 요약 · 초안 카드 머리(Paper 보드 43 실측) — 옛 "루틴 제안 — 승인
  // 전에는 실재하지 않습니다" 단일 캡션을 pill 2개 + 안내 문구로 대체한다.
  const head = document.createElement('div');
  head.className = 'agent-head';
  const summaryPill = document.createElement('span');
  summaryPill.className = 'routine-draft-pill';
  summaryPill.textContent = '작업 요약';
  head.appendChild(summaryPill);
  const draftPill = document.createElement('span');
  draftPill.className = 'routine-draft-pill is-draft';
  draftPill.textContent = '초안';
  head.appendChild(draftPill);
  const hint = document.createElement('span');
  hint.className = 'routine-draft-hint';
  hint.textContent = '← 캔버스에 초안 생성됨';
  head.appendChild(hint);
  card.appendChild(head);

  const title = document.createElement('div');
  title.className = 'routine-draft-title';
  title.textContent = r.note;
  card.appendChild(title);

  const desc = document.createElement('div');
  desc.className = 'agent-body';
  desc.textContent = draftDescriptionLine(r);
  card.appendChild(desc);

  if (r.activation_blocker) {
    const blocker = document.createElement('div');
    blocker.className = 'agent-source';
    blocker.textContent = `지금은 켤 수 없음: ${r.activation_blocker}`;
    card.appendChild(blocker);
  }

  const notice = document.createElement('div');
  notice.className = 'agent-source';
  notice.textContent = '활성화해도 주문은 자동 집행되지 않습니다 — 조건 도달 시 알림이 옵니다.';
  card.appendChild(notice);

  // 칩 3종(Paper 보드 43 실측): 미리보기 실행 / 바로 활성화 / 고칠 게 있어.
  // "취소"는 이 카드에서 빠졌다 — 동선 규칙③ "확정은 채팅 카드의 칩" 그대로,
  // 거부는 새 자연어 턴으로 이어간다(43 설계 그대로, 별도 취소 버튼 없음).
  const row = document.createElement('div');
  row.className = 'routine-approval-actions';
  const status = document.createElement('span');
  status.className = 'agent-mode';

  // 이 자리는 코드 알람에서 「검사」다(A-7) — 지난 30일 완성 봉으로 몇 번
  // 울렸을지 세어 본다. 다른 모드는 여전히 대응 경로가 없어 비활성이다.
  const isCodeWatch = r.mode === 'code-watch';
  const preview = _btn(isCodeWatch ? '검사' : '미리보기 실행', 'routine-btn');
  if (isCodeWatch) {
    preview.title = '지난 30일 완성 봉으로 몇 번 울렸을지 세어 봄';
    preview.addEventListener('click', async () => {
      preview.disabled = true;
      status.textContent = '검사 중 — 지난 30일 다시 돌려 봄';
      const progressLine = renderWatchProgressTurn(r);
      const check = await runWatchCheck(r);
      // 결과가 오면 도는 중 카드를 걷는다 — 같은 사실을 두 카드가 반복하지 않는다.
      progressLine.remove();
      preview.disabled = false;
      if (!check) {
        status.textContent = '감시 코드 자리를 못 찾음 — 대화로 다시 만들기';
        return;
      }
      status.textContent = '';
      renderWatchCheckCard(r, check);
    });
  } else {
    preview.disabled = true;
    preview.title = '미리보기 실행은 아직 안 됨';
  }

  // R8 — 코드 알람의 확정 문구는 「이 알람 승인」이다(보드 10 승인 패널).
  const activate = _btn(isCodeWatch ? '이 알람 승인' : '바로 활성화', 'routine-btn routine-btn-approve');
  activate.disabled = !!r.activation_blocker;
  activate.addEventListener('click', async () => {
    activate.disabled = true;
    fix.disabled = true;
    const res = await window.athena.invoke('athena:routine-confirm', { id: r.id });
    if (res && res.ok) {
      status.textContent = '활성 — 감시가 시작됐습니다';
    } else {
      status.textContent = `활성화 실패: ${(res && res.error) || '알 수 없는 오류'}`;
      activate.disabled = !!r.activation_blocker;
      fix.disabled = false;
    }
  });

  const fix = _btn('고칠 게 있어', 'routine-btn');
  fix.addEventListener('click', () => {
    $input.value = draftFixSeedText(r);
    autoGrowInput();
    $input.focus();
  });

  row.appendChild(preview);
  row.appendChild(activate);
  row.appendChild(fix);
  row.appendChild(status);
  card.appendChild(row);

  _mountTurn(line, card);
}

refreshRoutineDrafts();

// ---------- 말걸기 가드 확인 카드 (F-stage9, Paper 보드 42/BIM-0) ----------
// athena_nudge_guard의 propose 결과는 라우틴 draft와 달리 아무것도 디스크에
// 안 남는다(8단계, 비영속 게이트) — refreshRoutineDrafts()류 폴링으로는 발견
// 못 하고, main.js가 이 턴의 tool_result에서 직접 뽑아 보내는
// athena:nudge-guard-proposed 하나가 유일한 신호다(runQueryLive의 턴 전용
// 구독, 아래). [확인] 클릭은 LLM 재스폰 없이 렌더러가 직접
// POST /api/v1/nudge-guard를 부른다(기존 confirm 패턴과 동일, C1 결정).
// 순수 계산(diff·병합·문구 조합)은 lib/guard-confirm.js에 있다(routine-turn.js와
// 같은 자리 — DOM 없는 로직만 단위 테스트가 있는 lib으로 뗀다).
const guardConfirmLib = window.AthenaLib.GuardConfirm;

function renderGuardConfirmCard({ current, proposed } = {}, triggerText) {
  if (!current || !proposed || typeof proposed !== 'object') return;

  const line = document.createElement('div');
  line.className = 'turn';
  const card = document.createElement('div');
  card.className = 'turn-agent guard-confirm';

  // 태그 2종(Paper 실측): "가드 조정"(채움) · "제안"(외곽선).
  const head = document.createElement('div');
  head.className = 'agent-head';
  const adjustPill = document.createElement('span');
  adjustPill.className = 'routine-draft-pill is-filled';
  adjustPill.textContent = '가드 조정';
  head.appendChild(adjustPill);
  const proposePill = document.createElement('span');
  proposePill.className = 'routine-draft-pill';
  proposePill.textContent = '제안';
  head.appendChild(proposePill);
  card.appendChild(head);

  const body = document.createElement('div');
  body.className = 'agent-body guard-confirm-body';
  body.textContent = guardConfirmLib.guardConfirmBodyText(current, proposed);
  card.appendChild(body);

  const rationale = document.createElement('div');
  rationale.className = 'agent-source';
  rationale.textContent = guardConfirmLib.guardConfirmRationale(triggerText);
  card.appendChild(rationale);

  // 칩 2종(Paper 실측): "이렇게 바꿔줘"(핑크 필) · "그대로 둘게"(아웃라인).
  // 42번 프로액티브 카드의 "루틴으로"/"보류"와 같은 시각 언어를 재사용한다
  // (agent-proactive-chip, agent-canvas.js와 이 문서가 같은 shell.html에
  // 로드돼 클래스 공유가 가능하다).
  const row = document.createElement('div');
  row.className = 'routine-approval-actions';
  const status = document.createElement('span');
  status.className = 'agent-mode';

  const confirmBtn = _btn('이렇게 바꿔줘', 'agent-proactive-chip is-primary');
  const dismissBtn = _btn('그대로 둘게', 'agent-proactive-chip');

  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    dismissBtn.disabled = true;
    const merged = guardConfirmLib.mergeGuardSettings(current, proposed);
    const res = await window.athena.invoke('athena:nudge-guard-set', merged);
    if (res && res.ok) {
      status.textContent = '반영됐습니다';
      // 캔버스 가드 패널도 같은 값을 보고 있다 — 다음 진입까지 기다리지 않고
      // 바로 다시 그리게 한다(단일 소유자는 여전히 백엔드, 여긴 재조회만).
      if (window.AthenaAgentCanvas && typeof window.AthenaAgentCanvas.refresh === 'function') {
        window.AthenaAgentCanvas.refresh();
      }
    } else {
      status.textContent = `저장 실패: ${(res && res.error) || '알 수 없는 오류'}`;
      confirmBtn.disabled = false;
      dismissBtn.disabled = false;
    }
  });
  dismissBtn.addEventListener('click', () => {
    // 8단계 비영속 설계대로 — 확인하지 않으면 제안은 그냥 사라진다(재확인 UI 없음).
    confirmBtn.disabled = true;
    dismissBtn.disabled = true;
    status.textContent = '그대로 뒀습니다';
  });

  row.appendChild(confirmBtn);
  row.appendChild(dismissBtn);
  row.appendChild(status);
  card.appendChild(row);

  _mountTurn(line, card);
}

// ---------- 제어 결과 턴 (Paper 보드 08 · 4330-1, 2026-09-06) ----------
// 에이전트 표면으로 데려가는 두 걸음(캔버스 전환 + 네비 활성)은 모드 네비와
// 같은 순서다(canvas.js onOpenGraph 참고) — 새 전환 경로를 만들지 않는다.
function openAgentCanvas() {
  if (window.AthenaCanvasMode && typeof window.AthenaCanvasMode.setView === 'function') {
    window.AthenaCanvasMode.setView('agent');
  }
  if (window.AthenaModeNav && typeof window.AthenaModeNav.setActive === 'function') {
    window.AthenaModeNav.setActive('agent');
  }
  if (window.AthenaAgentCanvas && typeof window.AthenaAgentCanvas.refresh === 'function') {
    window.AthenaAgentCanvas.refresh();
  }
}
// 칩을 누른 뒤 같은 방에 붙는 네 상태다: 성공 · 거부 · 실패·재시도 · 뷰 이동.
// 클릭은 캔버스에서 일어나므로(살아 있는 LLM 턴 밖) 결과 턴은 플러그인 결과와
// 똑같이 모듈 스코프의 이 구독이 마운트한다. 이벤트가 와야만 그린다 —
// 부팅 직후 #history는 비어 있어야 한다(verify.js emptyHistory 계약).
window.addEventListener('athena:routine-control-result', (event) => {
  const detail = (event && event.detail) || {};
  const turn = detail.turn || null;
  if (!turn || !turn.lead) return;
  renderControlResultTurn(turn, typeof detail.retry === 'function' ? detail.retry : null);
});

function renderControlResultTurn(turn, retry) {
  const line = document.createElement('div');
  line.className = 'turn';
  const card = document.createElement('div');
  card.className = 'turn-agent control-result';

  // 배지 두 개 — 누른 칩 이름(검정)과 판정(테두리). 설명문은 없다.
  const head = document.createElement('div');
  head.className = 'agent-head';
  if (turn.badge) {
    const action = document.createElement('span');
    action.className = 'control-result-badge';
    action.textContent = turn.badge;
    head.appendChild(action);
  }
  const status = document.createElement('span');
  status.className = `control-result-status is-${turn.tone}`;
  status.textContent = turn.statusBadge;
  head.appendChild(status);
  card.appendChild(head);

  const lead = document.createElement('div');
  lead.className = 'control-result-lead';
  lead.textContent = turn.lead;
  card.appendChild(lead);

  if (turn.fact) {
    const fact = document.createElement('div');
    fact.className = 'control-result-fact';
    fact.textContent = turn.fact;
    card.appendChild(fact);
  }

  // 실패에만 다음 행동이 있다. 「다시 시도」는 실패한 제어를 그대로 다시 부른다
  // (결과는 새 턴으로 온다). 손잡이가 없는 결과면 최소한 그 버튼 자리로
  // 데려간다 — 막다른 길을 만들지 않는다(보드 10).
  if (turn.chips.length) {
    const row = document.createElement('div');
    row.className = 'routine-approval-actions';
    for (const label of turn.chips) {
      const chip = _btn(label, 'agent-proactive-chip');
      chip.addEventListener('click', () => {
        chip.disabled = true;
        if (retry) {
          Promise.resolve(retry()).catch(() => {});
          return;
        }
        openAgentCanvas();
      });
      row.appendChild(chip);
    }
    card.appendChild(row);
  }

  _mountTurn(line, card);
}

// ---------- 플러그인 제안 턴 · 결과 턴 (US-004) ----------
// 채팅이 제안하고 캔버스가 승인한다. 이 파일은 승인 카드를 만들지 않는다 —
// 카드는 canvas.js가 그리고, 여기에는 무엇을 제안했는지와 승인 뒤 무엇이
// 일어났는지만 대화 기록으로 남는다. 시각 언어는 라우틴 초안 알약을 그대로
// 재사용한다(새 언어를 만들지 않는다).
const pluginProposalLib = window.AthenaLib.PluginProposal;
const pluginModeLib = window.AthenaLib.PluginModeAdapter;

function pluginTurnCard(pills, bodyLines, chipRow) {
  const line = document.createElement('div');
  line.className = 'turn';
  const card = document.createElement('div');
  card.className = 'turn-agent plugin-turn';
  const head = document.createElement('div');
  head.className = 'agent-head';
  pills.forEach((text, index) => {
    const pill = document.createElement('span');
    pill.className = index === 0 ? 'routine-draft-pill is-filled' : 'routine-draft-pill';
    pill.textContent = text;
    head.appendChild(pill);
  });
  card.appendChild(head);
  bodyLines.forEach((text) => {
    const body = document.createElement('div');
    body.className = 'agent-body';
    body.textContent = text;
    card.appendChild(body);
  });
  if (chipRow) card.appendChild(chipRow);
  _mountTurn(line, card);
}

// 모델이 낸 제안만 채팅 턴이 된다 — 허브 버튼이 낸 것은 카드로만 합류한다.
function renderPluginProposalTurn(envelope) {
  if (!envelope || envelope.source !== 'model') return;
  const copy = pluginProposalLib.cardCopy(envelope);
  pluginTurnCard(['플러그인', '제안'], [copy.title, copy.reasonLine].filter(Boolean), null);
}

// 승인 클릭은 살아 있는 LLM 턴 **밖**에서 일어난다 — 턴 스코프 클로저는 이미
// 죽어 있으므로 결과 턴은 모듈 스코프의 이 구독이 마운트한다.
window.addEventListener('athena:plugin-result', (event) => {
  const detail = (event && event.detail) || {};
  const result = detail.result || {};
  // 문장 조립(도구 수 합산·재시작 줄)은 순수 모듈이 한다 — 여기는 그리기만.
  const copy = pluginProposalLib.resultTurnModel(detail.kind, result);
  if (!copy.lines.length) return;
  let chipRow = null;
  if (copy.chip) {
    chipRow = document.createElement('div');
    chipRow.className = 'routine-approval-actions';
    const retry = _btn(copy.chip, 'agent-proactive-chip');
    // 실패한 봉투는 대기 목록으로 되돌려져 있다 — 같은 봉투를 그대로 다시 보낸다.
    retry.addEventListener('click', () => {
      retry.disabled = true;
      if (typeof pluginDecide === 'function') void pluginDecide('athena:plugin-approve', detail.envelope);
    });
    chipRow.appendChild(retry);
  }
  pluginTurnCard(['플러그인', '결과'], copy.lines, chipRow);
});

// 모드 밖에서 온 제안은 폐기됐다 — 캔버스에는 카드가 없다. 같은 제안이 한 턴에
// 여러 번 와도 한 번만 알린다(서명 1회 — 턴이 바뀌면 다시 알린다).
const pluginOutOfMode = pluginProposalLib.createOutOfModeNotifier();
window.addEventListener('athena:plugin-out-of-mode', (event) => {
  const envelope = (event && event.detail && event.detail.envelope) || null;
  if (!envelope) return;
  if (!pluginOutOfMode.shouldAnnounce(envelope)) return;
  pluginTurnCard(['플러그인'], [pluginProposalLib.outOfModeCopy()], null);
});

// ---------- 백테스트 변경 내역 카드 (5단계, 2026-09-02) ----------
// 채팅이 athena_backtest로 낸 액션 4종(설정·코드·화면 전환·최적화 제안)은 이제
// 캔버스에 **바로** 반영된다 — 초안 카드를 띄워놓고 [적용]을 기다리지 않는다
// (사용자 확정: "바로 반영 + 채팅에 변경 내역·되돌리기"). 대신 무엇이 바뀌었는지와
// 되돌릴 방법이 여기, 채팅에 남는다. 실행·검증·탐색은 그래도 사람이 이 카드의
// 버튼을 눌러야 시작된다 — 경계는 그대로다.
//
// 구독은 이 파일 하나뿐이다(canvas.js에서 같은 채널을 또 들으면 액션이 두 번
// 적용된다). 캔버스 API는 canvas.js가 window.AthenaBacktestCanvas로 올려둔다.
const BACKTEST_CHANGE_TITLES = {
  spec_draft: '지도 반영',
  code_draft: '코드 반영',
  file_draft: '파일 반영',
  navigate: '탭 이동',
  optimize_request: '최적화 준비',
  // 시각 설계 ↔ 코드 왕복(보드 12·13·14, 2026-09-03) — 묻고, 비활성 수정안을 보이고,
  // 동기화된 초안을 알리고, 그 사이 다른 수정이 먼저 저장됐음을 알린다.
  visual_question: '한 가지만 확인할게요',
  visual_patch: '그래프 + 코드 패치',
  visual_synced: '동기화 완료',
  visual_conflict: '다시 검토',
  // 새 기법 만들기(보드 20·21, 2026-09-03) — AI가 하나씩 묻고, 검사는 자동으로 돈다.
  technique_question: '하나만 정해요',
  technique_check: '자동 검사',
};

function backtestChangeRowText(row) {
  const label = (row && row.label) || '';
  const before = (row && row.before) ? String(row.before) : '';
  const after = (row && row.after) != null ? String(row.after) : '';
  return before ? `${label} · ${before} → ${after}` : `${label} · ${after}`;
}

// ---------- 시각 설계 오류 수정 카드 (보드 12·13·14, 2026-09-03) ----------
// backtest-visual-code-roundtrip-implementation-evaluation.md §"대화형 오류 수정 계약"의
// 채팅 표면이다. 상태는 넷뿐이다: 하나만 묻는다(visual_question) → 비활성 수정안을
// 보여준다(visual_patch) → 동기화된 초안이 생겼다(visual_synced) → 그 사이 다른 수정이
// 먼저 저장됐다(visual_conflict).
//
// 이 카드는 아무것도 적용하지 않는다. 버튼이 캔버스 API를 부르고, 저장·활성화·실행의
// 경계는 캔버스와 백엔드가 진다(계약: 수정안 생성만으로 활성 graph·저장된 버전·실행
// 설정은 바뀌지 않는다). 캔버스 API는 나중에 붙으므로 전부 typeof로 막는다.
const BACKTEST_VISUAL_KINDS = new Set([
  'visual_question', 'visual_patch', 'visual_synced', 'visual_conflict',
]);

function backtestVisualCanvasCall(name, ...args) {
  const api = window.AthenaBacktestCanvas;
  if (!api || typeof api[name] !== 'function') return null;
  return api[name](...args);
}

// 예상 StrategySpec diff — 배열이 정본이고 {rows:[…]}로 와도 같은 줄로 읽는다.
function backtestVisualSpecRows(specDiff) {
  if (Array.isArray(specDiff)) return specDiff;
  return (specDiff && Array.isArray(specDiff.rows)) ? specDiff.rows : [];
}

// 코드 diff는 진단 카드의 줄 문법을 그대로 쓴다(backtest-explain.js와 같은 클래스).
function backtestVisualDiff(diffLines) {
  const diff = document.createElement('div');
  diff.className = 'backtest-diff';
  (Array.isArray(diffLines) ? diffLines : []).forEach((row) => {
    const cls = row.mark === '+' ? 'is-add' : (row.mark === '-' ? 'is-del' : 'is-same');
    const el = document.createElement('div');
    el.className = `backtest-diff-row ${cls}`;
    const mark = document.createElement('span');
    mark.className = 'backtest-diff-mark';
    mark.textContent = row.mark === ' ' ? '' : (row.mark || '');
    const text = document.createElement('span');
    text.className = 'backtest-diff-text';
    text.textContent = row.text || '';
    el.appendChild(mark);
    el.appendChild(text);
    diff.appendChild(el);
  });
  return diff;
}

// [차이 보기]는 예상 설계 diff를 접었다 편다 — 수정안 카드와 동기화 카드가 같이 쓴다.
function backtestVisualSpecToggle(card, actions, specDiff, label) {
  const host = document.createElement('div');
  host.hidden = true;
  const rows = backtestVisualSpecRows(specDiff);
  if (rows.length) {
    rows.forEach((row) => {
      const el = document.createElement('div');
      el.className = 'backtest-change-row';
      el.textContent = backtestChangeRowText(row);
      host.appendChild(el);
    });
  } else {
    const el = document.createElement('div');
    el.className = 'backtest-change-row';
    el.textContent = '설계 차이 내역이 없습니다';
    host.appendChild(el);
  }
  card.appendChild(host);
  const btn = _btn(label, 'routine-btn');
  btn.addEventListener('click', () => {
    host.hidden = !host.hidden;
    btn.textContent = host.hidden ? label : '차이 접기';
  });
  actions.appendChild(btn);
}

function renderBacktestVisualCard(receipt) {
  const line = document.createElement('div');
  line.className = 'turn';
  const card = document.createElement('div');
  card.className = 'turn-agent backtest-change backtest-visual';

  const head = document.createElement('div');
  head.className = 'agent-head';
  const headPill = (text, filled) => {
    const el = document.createElement('span');
    el.className = filled ? 'routine-draft-pill is-filled' : 'routine-draft-pill';
    el.textContent = text;
    head.appendChild(el);
  };
  headPill(BACKTEST_CHANGE_TITLES[receipt.kind] || '백테스트', true);
  card.appendChild(head);

  const bodyLine = (text, className) => {
    const el = document.createElement('div');
    el.className = className || 'agent-body';
    el.textContent = text;
    card.appendChild(el);
  };

  const actions = document.createElement('div');
  actions.className = 'routine-approval-actions backtest-change-actions';
  const status = document.createElement('span');
  status.className = 'agent-mode';
  let noteText = '';

  if (receipt.kind === 'visual_question') {
    // 한 번에 질문 하나 — 고르기 전에는 [수정안 만들기]가 열리지 않는다.
    const q = receipt.question || {};
    bodyLine(q.question_ko || '');

    const make = _btn('수정안 만들기', 'routine-btn routine-btn-approve');
    make.disabled = true;
    let chosen = null;

    const list = document.createElement('div');
    list.className = 'backtest-visual-choices';
    list.setAttribute('role', 'radiogroup');
    if (q.question_ko) list.setAttribute('aria-label', q.question_ko);
    const picks = [];
    (Array.isArray(q.choices) ? q.choices : []).forEach((choice) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'backtest-visual-choice';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      const label = document.createElement('span');
      label.className = 'backtest-visual-choice-label';
      label.textContent = choice.label_ko || '';
      btn.appendChild(label);
      if (choice.recommended) {
        const rec = document.createElement('span');
        rec.className = 'routine-draft-pill is-filled';
        rec.textContent = '권장';
        btn.appendChild(rec);
      }
      // 이 선택이 무엇을 바꾸는지 — 계약이 요구하는 "각 선택이 바꾸는 node/edge/parameter".
      const what = (Array.isArray(choice.changes) ? choice.changes : [])
        .map((c) => c && c.what_ko).filter(Boolean).join(' · ');
      if (what) {
        const el = document.createElement('span');
        el.className = 'backtest-visual-choice-changes';
        el.textContent = what;
        btn.appendChild(el);
      }
      btn.addEventListener('click', () => {
        chosen = choice.id;
        picks.forEach((b) => {
          const on = b === btn;
          b.classList.toggle('is-picked', on);
          b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        make.disabled = false;
      });
      picks.push(btn);
      list.appendChild(btn);
    });
    card.appendChild(list);

    make.addEventListener('click', () => {
      if (!chosen) return;
      make.disabled = true;
      status.textContent = '수정안을 만드는 중…';
      backtestVisualCanvasCall('answerVisualQuestion', { code: q.code, choice_id: chosen });
    });
    actions.appendChild(make);
    noteText = 'AI는 바로 고치지 않고, 필요한 선택을 한 번에 하나씩 묻습니다 · 실행·활성화 없음';
  }

  if (receipt.kind === 'visual_patch') {
    const patch = receipt.patch || {};
    headPill(patch.graph_compatible ? '그래프 호환' : '그래프 비호환');
    card.appendChild(backtestVisualDiff(patch.code_diff && patch.code_diff.diff_lines));
    if (patch.summary_ko) bodyLine(patch.summary_ko, 'backtest-change-row');

    const apply = _btn('적용하고 시각 설계로 돌아가기', 'routine-btn routine-btn-approve');
    apply.addEventListener('click', () => {
      apply.disabled = true;
      status.textContent = '적용하는 중…';
      backtestVisualCanvasCall('applyVisualPatch', patch.patch_id);
    });
    actions.appendChild(apply);

    backtestVisualSpecToggle(card, actions, patch.spec_diff, '차이 자세히 보기');

    const drop = _btn('버리기', 'routine-btn');
    drop.addEventListener('click', () => {
      backtestVisualCanvasCall('discardVisualPatch', patch.patch_id);
      actions.textContent = '버렸습니다 — 지도와 코드는 그대로입니다';
    });
    actions.appendChild(drop);

    const next = patch.next_version != null
      ? patch.next_version
      : (receipt.version && receipt.version.to);
    noteText = next != null
      ? `적용하면 새 v${next} 초안이 생깁니다. 활성화와 백테스트 실행은 별도 확인입니다.`
      : '적용하면 새 초안이 생깁니다. 활성화와 백테스트 실행은 별도 확인입니다.';
  }

  if (receipt.kind === 'visual_synced') {
    const from = receipt.version ? receipt.version.from : null;
    const to = receipt.version ? receipt.version.to : null;
    if (from != null && to != null) headPill(`v${from} → v${to}`);
    if (receipt.summary_ko) bodyLine(receipt.summary_ko);

    const review = _btn('실행 전 검토', 'routine-btn routine-btn-approve');
    review.addEventListener('click', () => { backtestVisualCanvasCall('reviewBeforeRun'); });
    actions.appendChild(review);

    backtestVisualSpecToggle(card, actions, receipt.spec_diff, '차이 보기');

    const open = _btn('코드 열기', 'routine-btn');
    open.addEventListener('click', () => { backtestVisualCanvasCall('openCodeFromChat'); });
    actions.appendChild(open);

    noteText = from != null
      ? `활성화하거나 실행하기 전까지 현재 v${from}에는 영향이 없습니다.`
      : '활성화하거나 실행하기 전까지 현재 버전에는 영향이 없습니다.';
  }

  if (receipt.kind === 'visual_conflict') {
    bodyLine('다른 수정이 먼저 저장됐습니다 — 다시 검토');
    const retry = _btn('다시 검토', 'routine-btn routine-btn-approve');
    retry.addEventListener('click', () => {
      retry.disabled = true;
      status.textContent = '다시 검토하는 중…';
      backtestVisualCanvasCall('retryVisualPatch');
    });
    actions.appendChild(retry);
  }

  actions.appendChild(status);
  card.appendChild(actions);
  if (noteText) bodyLine(noteText, 'agent-source');

  _mountTurn(line, card);
}

// ---------- 새 기법 만들기 카드 (보드 20·21, 2026-09-03) ----------
// 둘 다 아무것도 적용하지 않는다.
//   technique_question — AI가 알고리즘을 정하려고 던진 질문. 선택지를 누르면 그 문장이
//     **사용자 메시지로** 나간다(캔버스의 [+ 새 기법 만들기] 첫 문장과 같은 길이다).
//     AI가 대신 고르지 않는다는 규칙이 여기서 화면으로 지켜진다.
//   technique_check — 코드가 바뀔 때마다 자동으로 돈 검사와 통계 한 줄. 항목 수는 세지
//     않는다(백엔드가 차단·경고를 더 보낸다). 버튼이 없다: 사람이 누를 것이 없기
//     때문이다(검사는 전부 자동이다).
const BACKTEST_TECHNIQUE_KINDS = new Set(['technique_question', 'technique_check']);

// 캔버스가 대화를 시작하는 길과 같다(backtest-canvas.js emitChatSubmit → 이 파일의
// 'athena:chat-submit' 수신부 → dispatchUserQuery). 입력창에 치고 Enter를 누른 것과 같다.
function backtestChatSubmit(text) {
  const value = String(text || '').trim();
  if (!value) return;
  document.dispatchEvent(new CustomEvent('athena:chat-submit', { detail: { text: value } }));
}

// 검사 줄의 갈래 — severity가 'warn'인 것만 경고이고 나머지는 전부 차단이다(캔버스
// 명령창과 같은 규칙). 통과 여부는 서버가 정한 receipt.passed를 쓴다 — 카드가 다시
// 세지 않는다: 경고 하나에 '아직 통과하지 못했습니다'라고 적으면 화면이 거짓말을 한다.
function backtestCheckIsWarn(check) {
  return !!check && String(check.severity || '') === 'warn';
}

// 요약 한 줄 — '차단 2/3 통과 · 경고 1'. 경고는 아직 안 고친 것만 센다.
function backtestCheckSummary(checks) {
  const list = Array.isArray(checks) ? checks : [];
  const blocks = list.filter((c) => c && !backtestCheckIsWarn(c));
  const done = blocks.filter((c) => c.ok).length;
  const warn = list.filter((c) => backtestCheckIsWarn(c) && !c.ok).length;
  return `차단 ${done}/${blocks.length} 통과 · 경고 ${warn}`;
}

function renderBacktestTechniqueCard(receipt) {
  const line = document.createElement('div');
  line.className = 'turn';
  const card = document.createElement('div');
  card.className = 'turn-agent backtest-change backtest-technique';

  const head = document.createElement('div');
  head.className = 'agent-head';
  const kindPill = document.createElement('span');
  kindPill.className = 'routine-draft-pill is-filled';
  kindPill.textContent = BACKTEST_CHANGE_TITLES[receipt.kind] || '새 기법';
  head.appendChild(kindPill);
  card.appendChild(head);

  const bodyLine = (text, className) => {
    if (!text) return;
    const el = document.createElement('div');
    el.className = className || 'agent-body';
    el.textContent = text;
    card.appendChild(el);
  };

  if (receipt.kind === 'technique_question') {
    const q = receipt.question || {};
    bodyLine(q.question_ko || '');
    bodyLine(q.why_ko || '', 'agent-source');

    const status = document.createElement('span');
    status.className = 'agent-mode';
    const list = document.createElement('div');
    list.className = 'backtest-visual-choices';
    list.setAttribute('role', 'group');
    if (q.question_ko) list.setAttribute('aria-label', q.question_ko);
    const picks = [];
    (Array.isArray(q.choices) ? q.choices : []).forEach((choice) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'backtest-visual-choice backtest-technique-choice';
      const label = document.createElement('span');
      label.className = 'backtest-visual-choice-label';
      label.textContent = choice.label_ko || '';
      btn.appendChild(label);
      if (choice.recommended) {
        const rec = document.createElement('span');
        rec.className = 'routine-draft-pill is-filled';
        rec.textContent = '권장';
        btn.appendChild(rec);
      }
      if (choice.detail_ko) {
        const detail = document.createElement('span');
        detail.className = 'backtest-visual-choice-detail';
        detail.textContent = choice.detail_ko;
        btn.appendChild(detail);
      }
      btn.addEventListener('click', () => {
        // 고른 것은 사람의 대답이다 — 그대로 다음 사용자 메시지가 된다.
        picks.forEach((b) => { b.disabled = true; });
        btn.classList.add('is-on');
        status.textContent = '고른 답을 보냈습니다';
        backtestChatSubmit(choice.label_ko || '');
      });
      picks.push(btn);
      list.appendChild(btn);
    });
    card.appendChild(list);
    const actions = document.createElement('div');
    actions.className = 'routine-approval-actions backtest-change-actions';
    actions.appendChild(status);
    card.appendChild(actions);
  } else {
    // 검사 줄 — 백엔드가 준 항목을 그대로 그린다(3개라고 세지 않는다). 차단과 경고를
    // 점 색으로 나누고, 경고에는 '고치면 좋음'을 붙여 통과를 막지 않는다고 적는다.
    const list = Array.isArray(receipt.checks) ? receipt.checks : [];
    const checks = document.createElement('div');
    checks.className = 'backtest-technique-checks';
    if (list.length) {
      const summary = document.createElement('div');
      summary.className = 'backtest-technique-summary';
      summary.textContent = backtestCheckSummary(list);
      checks.appendChild(summary);
    }
    list.forEach((check) => {
      const warn = backtestCheckIsWarn(check);
      const ok = !!(check && check.ok);
      const row = document.createElement('div');
      const tone = ok ? ' is-ok' : (warn ? ' is-warn' : ' is-fail');
      row.className = `backtest-technique-check${tone}`;
      const dot = document.createElement('span');
      dot.className = 'backtest-technique-check-dot';
      row.appendChild(dot);
      const mark = document.createElement('span');
      mark.className = 'backtest-technique-check-mark';
      mark.textContent = ok ? '통과' : (warn ? '경고' : '고쳐야 함');
      row.appendChild(mark);
      const label = document.createElement('span');
      label.className = 'backtest-technique-check-label';
      label.textContent = (check && (check.label_ko || check.id)) || '';
      row.appendChild(label);
      if (check && check.detail_ko) {
        const detail = document.createElement('span');
        detail.className = 'backtest-technique-check-detail';
        detail.textContent = check.detail_ko;
        row.appendChild(detail);
      }
      if (warn && !ok) {
        const note = document.createElement('span');
        note.className = 'backtest-technique-check-note';
        note.textContent = '고치면 좋음';
        row.appendChild(note);
      }
      checks.appendChild(row);
    });
    card.appendChild(checks);
    const stats = receipt.stats;
    if (stats) {
      const parts = [];
      if (stats.warmup_bars != null) parts.push(`워밍업 ${stats.warmup_bars}봉`);
      if (stats.entry != null) parts.push(`진입 신호 ${stats.entry}`);
      if (stats.exit != null) parts.push(`청산 신호 ${stats.exit}`);
      if (stats.rows != null) parts.push(`봉 ${stats.rows}개`);
      bodyLine(parts.join(' · '), 'backtest-technique-stats');
    }
    bodyLine(receipt.passed ? '노드·흐름 창이 열렸습니다' : '아직 통과하지 못했습니다', 'agent-source');
  }

  _mountTurn(line, card);
}

// ---------- 단계 카드 (보드 20·22, 2026-09-03) ----------
// 기법 폴더 안에서 AI가 하는 일(파일 수정·검사·노드 다시 그리기·백테스트)은 묻지 않고
// 자동으로 된다 — 그래서 이 카드에는 승인 버튼이 없다. 사람이 누르는 것은 [이 기법 승인]과
// 실매매 적용뿐이다. 대신 한 일이 여기 한 줄씩 쌓이고, 누르면 가운데 창이 그 자리를 연다:
// 파일을 고쳤으면 diff, 검사를 돌렸으면 터미널 출력, 노드를 다시 그렸으면 노드 창,
// 백테스트를 돌렸으면 결과. 카드가 스스로 여는 것은 하나도 없다 — 여는 일은 전부 캔버스의
// openStep이 한다(typeof 가드: 캔버스가 아직 안 떠 있으면 아무 일도 일어나지 않는다).
const BACKTEST_STEP_KIND = 'technique_step';

// 글리프는 다섯 갈래뿐이다 — 모르는 icon이 오면 edit으로 떨어뜨린다(빈 칸을 그리지
// 않는다: 슬롯이 비면 제목의 왼쪽 끝이 줄마다 어긋난다).
const BACKTEST_STEP_ICONS = {
  file: '▤',
  check: '✓',
  nodes: '◈',
  run: '▶',
  edit: '✎',
};

// 실패 여부는 서버가 정한다(step.tone === 'warn' | 'fail'). 카드가 제목 문구를 읽어
// 실패를 추측하지 않는다 — 화면이 원문보다 앞서 말하면 거짓말이 된다. 옛 영수증이
// tone 대신 ok:false만 실을 수 있어 그것도 실패로 읽는다.
function backtestStepTone(step) {
  const tone = String((step && step.tone) || '');
  if (tone === 'fail' || tone === 'warn') return tone;
  if (step && step.ok === false) return 'fail';
  return 'ok';
}

function renderBacktestStepCard(receipt) {
  const step = (receipt && receipt.step) || {};
  const icon = Object.prototype.hasOwnProperty.call(BACKTEST_STEP_ICONS, step.icon) ? String(step.icon) : 'edit';
  const line = document.createElement('div');
  line.className = 'turn backtest-step-turn';
  const card = document.createElement('div');
  card.className = `turn-agent backtest-step-card is-icon-${icon} is-${backtestStepTone(step)}`;

  const glyph = document.createElement('span');
  glyph.className = 'backtest-step-icon';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = BACKTEST_STEP_ICONS[icon];
  card.appendChild(glyph);

  const text = document.createElement('div');
  text.className = 'backtest-step-text';
  const title = document.createElement('div');
  title.className = 'backtest-step-title';
  title.textContent = step.title_ko || '';
  text.appendChild(title);
  if (step.meta_ko) {
    const meta = document.createElement('div');
    meta.className = 'backtest-step-meta';
    meta.textContent = step.meta_ko;
    text.appendChild(meta);
  }
  card.appendChild(text);

  const action = step.action;
  if (action && action.label_ko) {
    const open = () => {
      const api = window.AthenaBacktestCanvas;
      if (!api || typeof api.openStep !== 'function') return;
      api.openStep(action);
    };
    const btn = _btn(action.label_ko, 'routine-btn backtest-step-action');
    btn.addEventListener('click', (e) => { e.stopPropagation(); open(); });
    card.appendChild(btn);
    // 줄 전체가 과녁이다(보드 22). 다만 키보드로 닿는 컨트롤은 위 버튼 하나로 남긴다 —
    // 카드에 role="button"을 덧씌우면 버튼 안에 버튼이 되어 읽는 순서가 두 겹이 된다.
    card.classList.add('is-clickable');
    card.addEventListener('click', open);
  }

  _mountTurn(line, card);
}

function renderBacktestChangeCard(receipt) {
  if (!receipt || typeof receipt !== 'object') return;
  // 시각 설계 4종은 머리 태그와 상태 문구가 다르다 — 질문 카드에 "반영 안 됨"을 적으면
  // 사람이 실패로 읽는다. 기존 spec/code/file 초안 렌더에 분기를 섞지 않고 나눈다.
  if (BACKTEST_VISUAL_KINDS.has(receipt.kind)) { renderBacktestVisualCard(receipt); return; }
  // 새 기법 만들기 2종도 머리 태그와 버튼이 다르다 — 검사 카드에는 누를 것이 없고,
  // 질문 카드의 버튼은 적용이 아니라 **대답을 보내는** 자리다.
  if (BACKTEST_TECHNIQUE_KINDS.has(receipt.kind)) { renderBacktestTechniqueCard(receipt); return; }
  // 단계 카드는 머리 태그도 승인 버튼도 없다 — 질문·검사 카드와 한 함수에 섞으면
  // "누를 것이 있는 카드"와 "그냥 기록"이 같은 모양이 된다.
  if (receipt.kind === BACKTEST_STEP_KIND) { renderBacktestStepCard(receipt); return; }


  const line = document.createElement('div');
  line.className = 'turn';
  const card = document.createElement('div');
  card.className = 'turn-agent backtest-change';

  // 태그 2종 — 무엇을(채움) · 들어갔는지(외곽선, 실패면 초안 색).
  const head = document.createElement('div');
  head.className = 'agent-head';
  const kindPill = document.createElement('span');
  kindPill.className = 'routine-draft-pill is-filled';
  kindPill.textContent = BACKTEST_CHANGE_TITLES[receipt.kind] || '백테스트';
  head.appendChild(kindPill);
  const statePill = document.createElement('span');
  statePill.className = receipt.applied ? 'routine-draft-pill' : 'routine-draft-pill is-draft';
  // 파일 초안은 실패한 게 아니라 아직 안 쓴 것이다 — 같은 '반영 안 됨'으로 적으면
  // 사람이 "안 됐구나"로 읽고 다시 시키게 된다(디스크에 쓰는 건 아래 [적용]이다).
  statePill.textContent = receipt.applied
    ? '반영됨'
    : (receipt.canApply ? '적용 대기' : '반영 안 됨');
  head.appendChild(statePill);
  // 지도가 몇 판이 됐는가(보드 14-B) — 반영 한 번이 지도 한 판이다.
  if (receipt.version && receipt.version.from != null && receipt.version.to != null) {
    const versionPill = document.createElement('span');
    versionPill.className = 'routine-draft-pill';
    versionPill.textContent = `v${receipt.version.from} → v${receipt.version.to}`;
    head.appendChild(versionPill);
  }
  card.appendChild(head);

  if (receipt.note) {
    const note = document.createElement('div');
    note.className = 'agent-body';
    note.textContent = receipt.note;
    card.appendChild(note);
  }

  // 어느 칸이 바뀌었는지를 값보다 먼저 적는다 — 사람이 읽는 단위는 칸이다(보드 14-B).
  (Array.isArray(receipt.nodes) ? receipt.nodes : []).forEach((node) => {
    const nodeEl = document.createElement('div');
    nodeEl.className = 'backtest-change-row backtest-change-node';
    nodeEl.textContent = `${node.numeral} ${node.title} — ${node.text}`;
    card.appendChild(nodeEl);
  });

  (Array.isArray(receipt.rows) ? receipt.rows : []).forEach((row) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'backtest-change-row';
    rowEl.textContent = backtestChangeRowText(row);
    card.appendChild(rowEl);
  });

  // 반영된 변경에도 검증 오류가 남을 수 있다(빈 종목·날짜) — 그건 "실행 전에 채울 것"이지
  // 반영 실패가 아니다(2026-09-02). 반영이 막힌 경우(모르는 프리셋 등)만 라벨 없이 보여준다.
  const errorHost = document.createElement('div');
  card.appendChild(errorHost);
  const showErrors = (messages, label) => {
    errorHost.textContent = '';
    const list = Array.isArray(messages) ? messages : [];
    if (label && list.length) {
      const labelEl = document.createElement('div');
      labelEl.className = 'backtest-change-error-label';
      labelEl.textContent = label;
      errorHost.appendChild(labelEl);
    }
    list.forEach((m) => {
      const errEl = document.createElement('div');
      errEl.className = 'backtest-change-error';
      errEl.textContent = String(m);
      errorHost.appendChild(errEl);
    });
  };
  showErrors(receipt.errors, receipt.applied ? '실행 전에 채울 것' : null);

  const actions = document.createElement('div');
  actions.className = 'routine-approval-actions backtest-change-actions';
  const status = document.createElement('span');
  status.className = 'agent-mode';
  const canvasApi = () => window.AthenaBacktestCanvas;

  if (receipt.canUndo) {
    const undo = _btn('되돌리기', 'routine-btn');
    undo.addEventListener('click', () => {
      const api = canvasApi();
      if (!api || typeof api.undoChatAction !== 'function') return;
      undo.disabled = true;
      const res = api.undoChatAction(receipt.id);
      if (res && res.ok) {
        // 되돌린 카드에 남길 버튼이 없다 — 같은 지점을 두 번 되돌릴 수는 없다.
        actions.textContent = '되돌렸습니다';
        return;
      }
      undo.disabled = false;
      status.textContent = (res && res.reason) || '되돌리지 못했습니다';
    });
    actions.appendChild(undo);
  }

  // 파일만 [적용]이 남아 있다 — 설정·코드와 달리 이건 디스크의 파일이라 사람이
  // 누르기 전에는 한 글자도 쓰지 않는다(결정 D4). 누르는 순간 캔버스가 쓴다.
  if (receipt.canApply) {
    const applyThen = async (btn, thenRun) => {
      const api = canvasApi();
      if (!api || typeof api.applyFileDraft !== 'function') return;
      btn.disabled = true;
      status.textContent = '파일을 쓰는 중…';
      let res;
      try {
        res = await api.applyFileDraft(receipt.id);
      } catch (err) {
        res = { ok: false, reason: String((err && err.message) || err) };
      }
      if (!res || !res.ok) {
        btn.disabled = false;
        showErrors([(res && res.reason) || '파일을 쓰지 못했습니다']);
        status.textContent = '파일을 쓰지 못했습니다';
        return;
      }
      showErrors([]);
      let tail = '파일에 썼습니다';
      if (thenRun && typeof api.runFromChat === 'function') {
        const errors = api.runFromChat();
        if (Array.isArray(errors) && errors.length) {
          showErrors(errors);
          tail = '파일에 썼습니다 — 실행 전에 고칠 게 있습니다';
        } else {
          tail = '파일에 썼습니다 — 결과는 캔버스에서 보세요';
        }
      }
      // 같은 초안을 두 번 쓸 수는 없다 — 남은 버튼을 치운다([되돌리기]와 같은 규칙).
      actions.textContent = tail;
    };

    const apply = _btn('적용', 'routine-btn routine-btn-approve');
    apply.addEventListener('click', () => { void applyThen(apply, false); });
    actions.appendChild(apply);

    if (receipt.suggest_run) {
      const applyRun = _btn('적용하고 실행', 'routine-btn routine-btn-approve');
      applyRun.addEventListener('click', () => { void applyThen(applyRun, true); });
      actions.appendChild(applyRun);
    }

    const drop = _btn('버리기', 'routine-btn');
    drop.addEventListener('click', () => {
      const api = canvasApi();
      if (!api || typeof api.discardFileDraft !== 'function') return;
      const res = api.discardFileDraft(receipt.id);
      actions.textContent = res && res.ok
        ? '버렸습니다 — 파일은 그대로입니다'
        : ((res && res.reason) || '버리지 못했습니다');
    });
    actions.appendChild(drop);
  }

  if (receipt.applied && receipt.suggest_run) {
    const run = _btn('실행', 'routine-btn routine-btn-approve');
    run.addEventListener('click', () => {
      const api = canvasApi();
      if (!api || typeof api.runFromChat !== 'function') return;
      const errors = api.runFromChat();
      if (Array.isArray(errors) && errors.length) {
        showErrors(errors);
        status.textContent = '실행 전에 고칠 게 있습니다';
        return;
      }
      showErrors([]);
      run.disabled = true;
      status.textContent = '실행을 시작했습니다 — 결과는 캔버스에서 보세요';
    });
    actions.appendChild(run);
  }

  if (receipt.applied && receipt.suggest_validate) {
    const validate = _btn('검증', 'routine-btn');
    validate.addEventListener('click', async () => {
      const api = canvasApi();
      if (!api || typeof api.validateFromChat !== 'function') return;
      validate.disabled = true;
      status.textContent = '검증 중…';
      let res;
      try {
        res = await api.validateFromChat();
      } catch (err) {
        res = { ok: false, errors: [String((err && err.message) || err)] };
      }
      validate.disabled = false;
      if (res && res.ok) {
        showErrors([]);
        status.textContent = '검증 통과';
        return;
      }
      showErrors((res && res.errors) || ['검증에 실패했습니다']);
      status.textContent = '검증 실패';
    });
    actions.appendChild(validate);
  }

  // 반영되지 않은 영수증(실행 중 차단)에 살아 있는 버튼을 두지 않는다 — 카드는
  // "반영 안 됨"이라 적어놓고 탐색만 시작되는 갈라짐을 막는다.
  if (receipt.kind === 'optimize_request' && receipt.applied) {
    const start = _btn('탐색 시작', 'routine-btn routine-btn-approve');
    start.addEventListener('click', () => {
      const api = canvasApi();
      if (!api || typeof api.startOptimizeFromChat !== 'function') return;
      api.startOptimizeFromChat();
      start.disabled = true;
      start.textContent = '탐색 시작됨';
    });
    actions.appendChild(start);
  }

  actions.appendChild(status);
  card.appendChild(actions);

  const notice = document.createElement('div');
  notice.className = 'agent-source';
  notice.textContent = '실행·수집·저장·활성화·배포는 버튼으로만 됩니다';
  card.appendChild(notice);

  _mountTurn(line, card);
}

window.athena.on('athena:backtest-chat-action', async (action) => {
  const canvas = window.AthenaBacktestCanvas;
  if (!canvas || typeof canvas.onChatAction !== 'function') return;
  // file_draft만 Promise를 준다 — diff의 왼쪽(지금 파일)을 디스크에서 읽어야 한다.
  // 나머지 셋은 예전처럼 그 자리에서 영수증을 돌려준다(await는 그냥 통과한다).
  const receipt = await canvas.onChatAction(action);
  renderBacktestChangeCard(receipt);
});

// 카드 버튼에서 시작한 왕복(answerVisualQuestion·applyVisualPatch·retryVisualPatch)은
// main이 보낸 액션이 아니라 캔버스가 스스로 만든 영수증이다 — 위 채널로는 오지 않는다.
// 캔버스가 document에 던지는 이 이벤트가 그 하나뿐인 통로다(backtest-canvas.js emitChatCard).
document.addEventListener('athena:backtest-receipt', (event) => {
  renderBacktestChangeCard(event && event.detail);
});

// 캔버스가 대화를 **시작**해야 하는 자리 — 백테스트 [+ 새 기법 만들기]가 던진다.
// 입력창과 제출은 이 파일에만 있다(dispatchUserQuery). 캔버스는 첫 문장만 넘기고,
// 보내는 길은 사람이 Enter를 눌렀을 때와 같다 — 위 영수증 통로와 같은 문법이다.
document.addEventListener('athena:chat-submit', (event) => {
  const text = String((event && event.detail && event.detail.text) || '').trim();
  if (!text) return;
  dispatchUserQuery(text);
});

// 노드를 눌러도 말은 나가지 않는다(보드 22) — 참조만 입력창에 들어가고, 무엇을 물을지는
// 사람이 이어서 쓴다. 위 chat-submit과 짝이지만 정반대다: 저쪽은 보내고 이쪽은 넣기만 한다.
// 선택 영역이 있으면 그것을 대신하고, 앞 글자가 공백이 아니면 공백 하나를 앞에 붙인다
// (@전체가 앞말에 붙어 "청산흐름@전체"가 되면 참조로 읽히지 않는다).
document.addEventListener('athena:chat-insert', (event) => {
  const text = String((event && event.detail && event.detail.text) || '');
  if (!text || !$input) return;
  const value = $input.value;
  const start = $input.selectionStart == null ? value.length : $input.selectionStart;
  const end = $input.selectionEnd == null ? start : $input.selectionEnd;
  const head = value.slice(0, start);
  const chunk = `${head && !/\s$/.test(head) ? ' ' : ''}${text}`;
  $input.value = `${head}${chunk}${value.slice(end)}`;
  autoGrowInput();
  const caret = start + chunk.length;
  $input.setSelectionRange(caret, caret);
  $input.focus();
});

// ---------- 주문 확인 모드 — #order (P4, 2026-08-19) ----------
// 유일하게 미착수였던 모드의 실체(GLOSSARY §1). 온보딩·설정과 같은 형제 패널
// 문법 — 열리면 #app이 물러나고 높이는 모드가 소유한다. 프리필은 AI(루틴
// 발화)가, 방향·수량·실행은 사람만. 집행은 기존 3중 게이트 백엔드 라우트
// 그대로(새 주문 경로 없음), IN_DOUBT(409)는 재전송하지 않는다.
const orderTicketLib = window.AthenaLib.OrderTicket;
const protectedCardsLib = window.AthenaLib.ProtectedCards;
const $order = document.getElementById('order');
const $orderBody = document.getElementById('orderBody');
let orderOpen = false;

function openOrderTicket(prefill) {
  if (orderOpen || settingsOpen || !$onboard.hidden) return;
  orderOpen = true;
  $app.hidden = true;
  $order.hidden = false;
  renderOrderTicket(prefill);
}

function closeOrderTicket() {
  if (!orderOpen) return;
  orderOpen = false;
  $orderBody.replaceChildren();
  $order.hidden = true;
  $app.hidden = false;
  $input.focus();
}

function _ticketRow(label, value) {
  const row = document.createElement('div');
  row.className = 'ticket-row';
  const l = document.createElement('span');
  l.className = 'ticket-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'ticket-value';
  v.textContent = value;
  row.append(l, v);
  return row;
}

async function renderOrderTicket(prefill) {
  $orderBody.replaceChildren();
  const ticket = orderTicketLib.createTicket(prefill || null);

  const card = document.createElement('div');
  card.className = 'ticket-card';
  if (prefill) {
    card.appendChild(_ticketRow('종목', prefill.symbol));
    card.appendChild(_ticketRow('사유', prefill.reason || '-'));
    if (prefill.observed != null) {
      // 시점 정직성 — 프리필 값은 발화 시점 값임을 라벨로 드러낸다.
      card.appendChild(
        _ticketRow('발화 시점 관측값', `${prefill.observed} (집행 전 재확인 필요)`)
      );
    }
  }

  // Selector 초안은 방향·수량까지 채울 수 있지만 실행은 여전히 사람 클릭 전용이다.
  const sideRow = document.createElement('div');
  sideRow.className = 'ticket-row';
  const sideLabel = document.createElement('span');
  sideLabel.className = 'ticket-label';
  sideLabel.textContent = '방향';
  const buyBtn = _btn('매수', 'routine-btn');
  const sellBtn = _btn('매도', 'routine-btn');
  sideRow.append(sideLabel, buyBtn, sellBtn);
  card.appendChild(sideRow);

  // 가격 행 — 무엇이 실행되는지를 수량 라벨의 각주가 아니라 값으로 드러낸다.
  // 지정가는 P4 1차 범위 밖이라 비활성 세그먼트다(buildOrderPayload는 trde_tp 3 고정).
  const priceModel = orderTicketLib.priceRowModel();
  const priceRow = document.createElement('div');
  priceRow.className = 'ticket-row';
  const priceLabel = document.createElement('span');
  priceLabel.className = 'ticket-label';
  priceLabel.textContent = '가격';
  priceRow.appendChild(priceLabel);
  for (const seg of priceModel.segments) {
    const chip = document.createElement('span');
    chip.className = seg === priceModel.selected
      ? 'ticket-seg ticket-seg-on' : 'ticket-seg';
    chip.textContent = seg;
    priceRow.appendChild(chip);
  }
  const priceReadout = document.createElement('span');
  priceReadout.className = 'ticket-readout';
  priceReadout.textContent = priceModel.readout;
  priceRow.appendChild(priceReadout);
  card.appendChild(priceRow);

  const qtyRow = document.createElement('div');
  qtyRow.className = 'ticket-row';
  const qtyLabel = document.createElement('span');
  qtyLabel.className = 'ticket-label';
  qtyLabel.textContent = '수량';
  const qtyInput = document.createElement('input');
  qtyInput.type = 'number';
  qtyInput.min = '1';
  qtyInput.className = 'ticket-qty';
  if (ticket.qty) qtyInput.value = String(ticket.qty);
  const qtyUnit = document.createElement('span');
  qtyUnit.className = 'ticket-unit';
  qtyUnit.textContent = '주';
  qtyRow.append(qtyLabel, qtyInput, qtyUnit);
  card.appendChild(qtyRow);

  // 총액 추정 — 발화 시점 관측값 × 수량. 관측값이 없으면 행을 그리지 않는다.
  const totalRow = document.createElement('div');
  totalRow.className = 'ticket-total';
  const totalLabel = document.createElement('span');
  totalLabel.className = 'ticket-total-label';
  const totalValue = document.createElement('span');
  totalValue.className = 'ticket-total-value';
  totalRow.append(totalLabel, totalValue);
  card.appendChild(totalRow);
  const syncTotal = () => {
    const est = orderTicketLib.estimateOrderTotal({
      qty: qtyInput.value,
      observed: prefill ? prefill.observed : null,
    });
    totalRow.hidden = !est;
    if (est) {
      totalLabel.textContent = est.label;
      totalValue.textContent = est.text;
    }
  };
  syncTotal();

  // 게이트 상태 — 활성 계좌의 주문 API 여부를 정직하게 보여준다.
  const gateLine = document.createElement('div');
  gateLine.className = 'agent-source';
  card.appendChild(gateLine);
  let gateBlocked = '계좌 확인 중…';
  gateLine.textContent = gateBlocked;
  try {
    const res = await window.athena.invoke('athena:account-list');
    const accounts = (res && res.accounts) || [];
    const active = accounts.find((a) => a.active) || accounts[0] || null;
    gateBlocked = orderTicketLib.gateBlocker(active);
  } catch {
    gateBlocked = orderTicketLib.gateBlocker(null);
  }
  gateLine.textContent = gateBlocked
    ? `지금은 실행할 수 없음: ${gateBlocked}`
    : '주문 API 활성 — 실행 시 확인 게이트·멱등키가 적용됩니다 (모의계좌)';

  const status = document.createElement('div');
  status.className = 'agent-body';

  const execRow = document.createElement('div');
  execRow.className = 'routine-approval-actions';
  const execBtn = _btn('주문 실행', 'routine-btn routine-btn-approve');
  const closeBtn = _btn('닫기 (Esc)', 'routine-btn');
  execRow.append(execBtn, closeBtn);
  card.append(execRow, status);
  $orderBody.appendChild(card);

  const syncExec = () => {
    execBtn.disabled = !!gateBlocked || !ticket.side || !Number(qtyInput.value)
      || ticket.state === 'done' || ticket.state === 'in_doubt';
  };
  if (ticket.side === 'buy') buyBtn.classList.add('routine-btn-approve');
  if (ticket.side === 'sell') sellBtn.classList.add('routine-btn-approve');
  syncExec();

  buyBtn.addEventListener('click', () => {
    ticket.side = 'buy';
    buyBtn.classList.add('routine-btn-approve');
    sellBtn.classList.remove('routine-btn-approve');
    syncExec();
  });
  sellBtn.addEventListener('click', () => {
    ticket.side = 'sell';
    sellBtn.classList.add('routine-btn-approve');
    buyBtn.classList.remove('routine-btn-approve');
    syncExec();
  });
  qtyInput.addEventListener('input', () => { syncExec(); syncTotal(); });
  closeBtn.addEventListener('click', closeOrderTicket);

  execBtn.addEventListener('click', async () => {
    if (execBtn.disabled) return;
    let payload;
    try {
      ticket.qty = Number(qtyInput.value);
      payload = orderTicketLib.buildOrderPayload(ticket);
    } catch (err) {
      status.textContent = `입력 오류: ${err.message}`;
      return;
    }
    orderTicketLib.transition(ticket, 'executing');
    execBtn.disabled = true;
    status.textContent = '집행 중… (무재시도 — 응답을 기다립니다)';
    const res = await window.athena.invoke('athena:order-execute', {
      trId: payload.tr_id,
      body: payload.body,
      idempotencyKey: orderTicketLib.newIdempotencyKey(),
    });
    const outcome = orderTicketLib.interpretExecuteStatus((res && res.status) || 0);
    orderTicketLib.transition(ticket, outcome === 'done' ? 'done'
      : outcome === 'in_doubt' ? 'in_doubt' : 'failed');
    // 종결 상태를 표시 전용 action 카드로도 남긴다(Paper AT-CV-005 보호
    // 워크플로) — 실행 버튼이 없는 영수증일 뿐, 이 티켓 패널이 유일한 실행
    // 표면이라는 확정 결정 3 경계는 그대로다. addLiveCard는 canvas.js가 선언한
    // 전역 함수다(같은 문서, canvas.js가 chat.js보다 먼저 로드된다 — shell.html).
    if (typeof addLiveCard === 'function' && protectedCardsLib) {
      addLiveCard(protectedCardsLib.buildOrderActionCard({
        trId: payload.tr_id, body: payload.body, outcome, response: res,
      }));
    }
    if (outcome === 'done') {
      status.textContent = '주문 접수됨 — 체결은 계좌에서 확인하세요.';
    } else if (outcome === 'in_doubt') {
      status.textContent = '확인 중(IN_DOUBT) — 중복 방지를 위해 재전송하지 않습니다. 계좌에서 접수 여부를 확인하세요.';
    } else {
      status.textContent = `실행 실패: ${(res && res.error) || 'HTTP ' + ((res && res.status) || '?')} — 재시도하려면 다시 실행을 누르세요(새 멱등키).`;
      syncExec();
    }
  });
}
