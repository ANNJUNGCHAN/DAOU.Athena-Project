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
const $bootLine = document.getElementById('bootLine');
const $bootPanel = document.getElementById('bootPanel');
const $bootName = document.getElementById('bootName');
const $bootPh = document.getElementById('bootPh');
const $app = document.getElementById('app');
const $history = document.getElementById('history');
const $input = document.getElementById('input');
const $dot = document.getElementById('dot');
const $lockHint = document.getElementById('lockHint');
const $lockText = document.getElementById('lockText');
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

function prepareRestReceiptSurface() {
  // A fail-closed receipt is the only visible result for rejected/no-render
  // requests. It must not be appended beneath boot, onboarding, settings or
  // order panels. Return the existing window to chat mode before measuring it.
  $boot.hidden = true;
  $onboard.hidden = true;
  $settings.hidden = true;
  $order.hidden = true;
  $app.hidden = false;
  settingsOpen = false;
  orderOpen = false;
}

window.athena.on('athena:add-rest-receipt', async (payload = {}) => {
  prepareRestReceiptSurface();
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
  const onboardStatePromise = window.athena.invoke('athena:onboarding-state').catch(() => {
    // 채널이 아직 없거나 실패하면 "온보딩 필요"로 가정한다 — 온보딩을 건너
    // 뛰고 정상 대화 화면을 보여주는 쪽이 훨씬 위험하다("건너뛰기 없음"
    // 원칙, AT-SY-002/003). 이 fail-closed 결정은 발명이다 — 리포트 참고.
    return { needed: true, step: 2 };
  });
  loadPrefs(); // 화면 설정 — 부팅을 막지 않는다. 로드 전에는 기본값(둘 다 켜짐)으로 동작한다.

  const finishBoot = async () => {
    $boot.hidden = true;
    // 창 크롬(셸·타이틀바·창 제어 3버튼)은 창이 확정된 뒤에만 존재한다 —
    // 부팅 연출 보호. 크롬 자체는 shell.js가 소유한다(리프 1.2.1).
    window.AthenaShell.revealChrome();
    const onboardState = await onboardStatePromise;
    if (onboardState && onboardState.needed) {
      startOnboarding(onboardState.step);
    } else if (settingsOpen || !$onboard.hidden) {
      // 부팅이 끝나기 전에 다른 모드가 먼저 열렸다 — 사람 조작으로는 불가능하고
      // 자동화(verify-settings-cards.js가 600ms 시점에 점을 클릭)만 밟는 경로다.
      // #app을 다시 드러내면 모드 배타성이 깨진다(GLOSSARY §1) — 모드에 양보한다.
    } else {
      $app.hidden = false;
      $input.focus();
      scrollHistoryToBottom();
      maybeShowCoachmark();
    }
  };

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    finishBoot();
    return;
  }

  // 1단계(0ms)는 CSS 초기 상태(발광점 16px)다. 이후 단계는 시각 경계에 클래스 토글.
  setTimeout(() => $bootLine.classList.add('expand'), 180); // 2단계 — 가로 확장
  setTimeout(() => $bootPanel.classList.add('unfold'), 420); // 3단계 — 세로 전개(72%)
  setTimeout(() => $bootPanel.classList.add('final'), 620); // 4단계 — 채팅바 확정
  // 4단계 후반부(2026-08-18 재정의) — 확정된 바가 입력줄에 제 이름을 쓴다.
  // 한 자씩 40ms(텍스트 추가는 유리 페이드가 아니다), 다 쓰고 300ms 들었다가
  // 지우고 placeholder를 드러낸다 — "다시 채팅바로 돌아온다".
  'ATHENA'.split('').forEach((ch, i) => {
    setTimeout(() => { $bootName.textContent += ch; }, 660 + i * 40);
  });
  setTimeout(() => {
    $bootName.textContent = '';
    $bootPh.hidden = false;
  }, 1160);
  // placeholder 상태가 한 박자(200ms) 정착한 뒤 실제 대화 창으로 바꿔치운다 — 부팅
  // 바의 최종 유리(0.30 — 2026-08-18 하향 후 현행)·그립·점·입력줄이 전부 .app과 같은
  // 값이라 이음새가 보이지 않는다. 200ms는 verify.js의 60ms 폴링이 이 상태를 놓치지
  // 않는 하한이기도 하다.
  setTimeout(finishBoot, 1360);
});

async function onboardAdvance(step) {
  try {
    const res = await window.athena.invoke('athena:onboarding-advance', { step });
    return !!(res && res.ok);
  } catch (err) {
    return false;
  }
}

function startOnboarding(step) {
  $onboard.hidden = false;
  // 스펙 전체에 "1 / 3" 화면이 없다(00-통합-계획.md §7-2 열린 질문) — main이
  // step:1을 돌려줘도 CLI 연결(2/3)부터 시작한다. 발명 — 리포트에 명시.
  showOnboardingStep(step === 3 ? 3 : 2);
}

function showOnboardingStep(step) {
  if (onboardCleanup) { onboardCleanup(); onboardCleanup = null; }
  if (step === 3) {
    onboardCleanup = onboarding.renderAccountStep($onboardBody, {
      onRegistered: (accountId) => showAuthConfirm(accountId),
    });
  } else {
    onboardCleanup = onboarding.renderCliStep($onboardBody, {
      onContinue: async () => {
        const ok = await onboardAdvance(2);
        if (ok) showOnboardingStep(3);
        return ok;
      },
    });
  }
}

function showAuthConfirm(accountId) {
  if (onboardCleanup) { onboardCleanup(); onboardCleanup = null; }
  onboardCleanup = authScreen.renderAuthTokenStatus($onboardBody, {
    accountId,
    embedded: true,
    onContinue: async () => {
      const ok = await onboardAdvance(3);
      if (ok) finishOnboarding();
      return ok;
    },
  });
}

function finishOnboarding() {
  if (onboardCleanup) { onboardCleanup(); onboardCleanup = null; }
  $onboard.hidden = true;
  $app.hidden = false;
  $input.focus();
  scrollAfterRender();
  maybeShowCoachmark(); // 최초 실행은 온보딩을 지나므로 여기가 첫 대화 화면이다
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
});

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
function setLocked(locked, text) {
  $input.disabled = locked;
  $lockHint.hidden = !locked;
  if (text) $lockText.textContent = text;
}

function setDot(mode) {
  $dot.classList.remove('judging', 'calling');
  if (mode) $dot.classList.add(mode);
}

async function runQuery(text) {
  if (canvasSource === 'fixture') return runQueryFixture(text);
  return runQueryLive(text);
}

async function runQueryLive(text) {
  const myToken = ++abortToken;
  clearRecommendations();

  const qLine = document.createElement('div');
  qLine.className = 'turn';
  const qText = document.createElement('div');
  qText.className = 'turn-q';
  qText.textContent = text;
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
  const releaseLadder = createTextReleaseLadder({
    onRelease: () => {
      if (bufferedText) {
        clearThinkingPreview(); // appendToBubble보다 먼저 선언돼도 클로저라 호출 시점엔 문제없다.
        appendToBubble(bufferedText);
        bufferedText = '';
      }
    },
  });
  const elapsedText = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  const renderProgress = () => {
    if (myToken !== abortToken) return;
    const base = calling ? `카드 ${cardCount}개 렌더됨` : 'Claude에게 물어보는 중';
    setLocked(true, `${base} · ${elapsedText()} 경과`);
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
    el.querySelector('.progress-tool-step-label').textContent = result.label;
    el.querySelector('.progress-tool-step-time').textContent = result.timeText;
    scrollAfterRender();
  };
  const unsubscribeLiveToolStep = window.athena.on('athena:live-tool-step', onLiveToolStep);

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
  const appendToBubble = (text) => {
    if (!streamALine) {
      streamALine = document.createElement('div');
      streamALine.className = 'turn';
      streamAText = document.createElement('div');
      streamAText.className = 'turn-a';
      streamALine.appendChild(streamAText);
      $history.appendChild(streamALine);
    }
    streamedText += text;
    streamAText.textContent = streamedText;
    scrollAfterRender();
  };
  const onLiveTextDelta = ({ text: delta } = {}) => {
    if (myToken !== abortToken || !delta) return;
    if (!calling) { calling = true; state = 'calling'; setDot('calling'); }
    releaseLadder.onTextDelta(); // 첫 조각에서만 조건(c) 유예 타이머를 켠다(사다리 내부 판단).
    if (!releaseLadder.released) {
      bufferedText += delta; // 아직 방출 조건이 안 왔다 — 화면엔 안 그리고 모아만 둔다.
      return;
    }
    clearThinkingPreview(); // 답변이 시작됐다 — 추론 미리보기는 자리를 비켜준다
    appendToBubble(delta);
  };
  const unsubscribeLiveTextDelta = window.athena.on('athena:live-text-delta', onLiveTextDelta);

  let result;
  // 오브 "생각 중" 실신호(2026-08-26 board-32) — 스피너 대신 오브 시선이 위를
  // 훑는다. 여기 감싸는 구간이 실제 질의 왕복이다(claude -p 또는 캐시 리플레이).
  window.athena.send('athena:orb-signal', { signal: 'think', active: true });
  try {
    result = await window.athena.invoke('athena__render_canvas', { source: 'live', query: text, expand: prefs.autoExpandCanvas });
  } finally {
    clearInterval(tick);
    unsubscribeLiveCanvasAdded();
    unsubscribeLiveToolStep();
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
  progress.remove();
  liveProgressEl = null;

  // 스트리밍 중 만든 버블이 있으면 그대로 이어 쓴다(재부착 없음 — 이미
  // $history 안에 있다). 없으면(REST 직결·캐시 리플레이·조각 0개) 기존처럼 새로 만든다.
  const aLine = streamALine || document.createElement('div');
  aLine.className = 'turn';
  const aText = streamAText || document.createElement('div');
  aText.className = 'turn-a';
  // 최종 텍스트는 응답값이 권위다(스트리밍 누적치가 아니다) — 조각이 유실되거나
  // 순서가 어긋나도 이 줄이 항상 진짜 답으로 덮어쓴다.
  aText.textContent = result && result.answerText
    ? result.answerText
    : (result && result.ok
      ? `완료 — 카드 ${cardCount}개, 답변 텍스트 없음`
      : `실패 — ${(result && result.error) || '알 수 없는 오류'}`);
  if (!streamALine && !(result && result.answerPaintedByMain)) aLine.appendChild(aText);

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
  const trace = document.createElement('span');
  const durS = result && typeof result.durationMs === 'number' ? (result.durationMs / 1000).toFixed(1) : elapsedText().replace('s', '');
  const skipped = result && result.diagnostics && result.diagnostics.skippedLines;
  const traceSource = result && result.source === 'kiwoom-rest'
    ? '키움 REST'
    : (result && result.source === 'live-cache' ? '키움 REST · 이전 해석 재사용' : 'claude -p');
  trace.textContent = `${traceSource} · ${durS}s` + (skipped ? ` · 비JSON 라인 ${skipped}건 건너뜀` : '');
  meta.appendChild(trace);
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
  const trace = document.createElement('span');
  trace.textContent = types.map((t) => CARD_PLAN[t].toolLabel).join(' · ') + ` · ${((types.length * 0.5) + 0.55).toFixed(1)}s`;
  meta.appendChild(trace);
  aLine.appendChild(meta);

  $history.appendChild(aLine);
  scrollAfterRender();
  $input.focus();
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
  $app.hidden = true;
  $settings.hidden = false;
  // Paper 43쪽(2026-08-18 확정) — 좌 사이드바(화면·계좌·MCP 서버·모델) + 우 패널.
  // 세 카드를 동시에 쌓아 보여주던 이전 판(renderScreen/renderAccounts/renderMcp를
  // 나란히 호출)을 대체한다. 패널 렌더 함수 자체는 그대로 재사용 — nav가 어떤 걸
  // 부를지만 고른다.
  const SETTINGS_PANELS = {
    screen: settingsCards.renderScreen,
    accounts: settingsCards.renderAccounts,
    mcp: settingsCards.renderMcp,
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

// 점은 답변⇄그래프 모드 전환기다(Paper 보드 05, 2026-08-26). 설정 진입은
// 사이드바 계정 메뉴(보드 16)로 옮겼다 — 커맨드바("설정")도 동등한 진입로다.
// 실제 모드 엔진은 canvas.js의 graphMode(lib/graph-mode/controller.js) — 여기는
// 그 위에 점 하나를 얹을 뿐, 두 번째 모드 엔진을 만들지 않는다.
// 키우미 메뉴(2026-08-27, Paper 보드 45 v5) — 점은 더 이상 모드 전환이 아니다.
// 전환은 사이드바 모드 네비의 몫이고, 얼굴은 모드 표시만 한다.
$dot.addEventListener('click', () => { toggleKiumiMenu(); });
// 사이드바 계정 메뉴(Paper 보드 16)의 "설정" 항목이 쓰는 다리 — lib/sidebar.js
// 참고.
window.AthenaShell.registerOpenSettings(openSettings);

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

$input.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || state !== 'idle' || remoteQueryBusy) return;
  // 첨부 칩이 있으면 전송 직전에 경로를 동봉한다(코덱스 UI 이식, 2026-08-27).
  const text = consumeAttachments($input.value);
  $input.value = '';
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

let modelStateCache = null;

async function refreshModelState() {
  try {
    modelStateCache = await window.athena.invoke('athena:model-get');
  } catch {
    // 상태를 못 읽으면 캐시를 갱신하지 않는다 — 추측값을 쓰지 않는다(정보 정직성).
  }
  if (!$modelPopover.hidden) renderModelPopover();
}

function popoverSection(title, chips, currentValue, key) {
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
      const res = await window.athena.invoke('athena:model-set', { provider: 'claude', patch: { [key]: c.value } });
      if (res && res.ok === false) return; // 거부된 값은 상태를 안 바꾼다(model-prefs 검증)
      await refreshModelState();
    });
    row.appendChild(b);
  }
  $modelPopover.appendChild(row);
}

function renderModelPopover() {
  const c = (modelStateCache && modelStateCache.claude) || { model: null, effort: null };
  $modelPopover.textContent = '';
  popoverSection('모델', PILL_MODEL_CHIPS, c.model, 'model');
  const sep = document.createElement('div');
  sep.className = 'mp-sep';
  $modelPopover.appendChild(sep);
  popoverSection('추론 노력', PILL_EFFORT_CHIPS, c.effort, 'effort');
}

function closeModelPopover() { $modelPopover.hidden = true; }

// 모델 팝오버는 키우미 메뉴 '모델 설정'이 연다(보드 45 v5) — 필은 사라졌다.
// 바깥 클릭으로 닫는다(키우미 메뉴 항목 클릭은 메뉴가 먼저 닫혀 겹치지 않는다).
document.addEventListener('mousedown', (e) => {
  if ($modelPopover.hidden) return;
  if ($modelPopover.contains(e.target)) return;
  closeModelPopover();
});

// ---------- 키우미 메뉴 (2026-08-27, Paper 보드 45) ----------
// 파일·폴더는 경로 텍스트로만 입력줄에 붙는다 — 내용은 CLI(claude -p)가 읽는다.
const $kiumiMenu = document.getElementById('kiumiMenu');

function closeKiumiMenu() { $kiumiMenu.hidden = true; }

function kiumiItem(label, onPick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'km-item';
  b.textContent = label;
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
    ic.textContent = att.isDir ? '📁' : '📄';
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
  $kiumiMenu.appendChild(kiumiItem('파일 첨부', () => pickAttachments(false)));
  $kiumiMenu.appendChild(kiumiItem('폴더 첨부', () => pickAttachments(true)));
  const sep = document.createElement('div');
  sep.className = 'mp-sep';
  $kiumiMenu.appendChild(sep);
  $kiumiMenu.appendChild(kiumiSection('설정'));
  // 모델·추론 노력 — 스트립 필 제거로 이 메뉴가 유일한 진입로다(보드 45 v5).
  $kiumiMenu.appendChild(kiumiItem('모델 설정', async () => {
    closeKiumiMenu();
    await refreshModelState();
    renderModelPopover();
    $modelPopover.hidden = false;
  }));
  // 그래프 수집·노출은 설정 › 성향·이력 카드가 소유한다(보드 22 병합).
  $kiumiMenu.appendChild(kiumiItem('수집·노출 설정', () => { closeKiumiMenu(); openSettings(); }));
}

function toggleKiumiMenu() {
  if ($kiumiMenu.hidden) {
    renderKiumiMenu();
    $kiumiMenu.hidden = false;
  } else {
    closeKiumiMenu();
  }
}

document.addEventListener('mousedown', (e) => {
  if ($kiumiMenu.hidden) return;
  if ($kiumiMenu.contains(e.target) || $dot.contains(e.target)) return;
  closeKiumiMenu();
});
window.athena.on('athena:model-changed', () => refreshModelState());
refreshModelState();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // 지금 눈앞에 있는 것이 먼저다 — 팝오버 → 주문 티켓 → 설정 순으로 닫는다.
    if (!$modelPopover.hidden) {
      closeModelPopover();
      return;
    }
    if (orderOpen) {
      closeOrderTicket();
      return;
    }
    if (settingsOpen) {
      closeSettings();
      return;
    }
    if (state !== 'idle') {
      abortToken++; // 중단 — UI 반영 차단
      window.athena.send('athena:abort-live-query'); // 실배선 프로세스 트리도 실제로 죽인다
      // 죽는 질의의 finally는 이제 stale이라 침묵한다(결함② 수정과 짝) — 여기서 즉시 끈다.
      window.athena.send('athena:orb-signal', { signal: 'think', active: false });
      state = 'idle';
      setDot(null);
      setLocked(false);
      if (liveProgressEl) { liveProgressEl.remove(); liveProgressEl = null; }
      scrollAfterRender();
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
    rel.textContent = `지금 확인 · ${model.relative}`;
    head.appendChild(rel);
  }
  if (head.childNodes.length) box.appendChild(head);

  if (model.sourceLabel) {
    const src = document.createElement('div');
    src.className = 'agent-source';
    src.textContent = model.sourceLabel;
    box.appendChild(src);
  }
  const body = document.createElement('div');
  body.className = 'agent-body';
  body.textContent = model.body;
  box.appendChild(body);

  // 발화 턴 → 주문 티켓 직행 경로(P4, LIV-066 시나리오의 정답 구조).
  // 티켓을 여는 것뿐 — 주문은 티켓 안에서 사람이 실행한다.
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

  _mountTurn(line, box);
}

window.athena.on('athena:routine-event', (event) => {
  renderAgentTurn(event);
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
  const aText = document.createElement('div');
  aText.className = 'turn-a';
  aText.textContent = result && result.answerText
    ? result.answerText
    : (result && result.ok ? '완료 — 답변 텍스트 없음' : `실패 — ${(result && result.error) || '알 수 없는 오류'}`);
  aLine.appendChild(aText);

  const meta = document.createElement('div');
  meta.className = 'turn-meta';
  const canvasTypes = (result && result.canvasTypes) || [];
  for (const t of canvasTypes) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = canvasTypeLabel(t);
    meta.appendChild(chip);
  }
  const trace = document.createElement('span');
  const durS = result && typeof result.durationMs === 'number' ? (result.durationMs / 1000).toFixed(1) : null;
  trace.textContent = '오브에서 대화' + (durS ? ` · ${durS}s` : '');
  meta.appendChild(trace);
  aLine.appendChild(meta);

  $history.appendChild(aLine);
  scrollAfterRender();
});

// ---------- 루틴 승인 카드 (P3, 2026-08-19) ----------
// 모델은 draft 제안만 할 수 있다(athena_routine — confirm/cancel 액션 자체가
// 없다). 사람이 이 카드의 [승인]을 눌러야 감시가 시작된다. [승인] 클릭은
// LLM 재스폰 없이 렌더러가 백엔드 confirm을 직접 부른다(~200ms — C1 결정).
// 방식 행은 필수다(§8 고지 의무 — verify 검증 대상).
const shownDraftIds = new Set();

async function refreshRoutineDrafts() {
  let routines;
  try {
    const res = await window.athena.invoke('athena:routines-list');
    routines = res && res.ok && res.data && Array.isArray(res.data.routines)
      ? res.data.routines : [];
  } catch { return; }
  for (const r of routines) {
    if (r.status !== 'draft' || shownDraftIds.has(r.id)) continue;
    shownDraftIds.add(r.id);
    renderApprovalCard(r);
  }
}

function approvalModeLine(r) {
  const modeText = routineTurnLib.describeMode(r.mode);
  const suffix = r.mode === 'periodic' ? ' — 최대 폴링 주기만큼 지연' : ' — 틱 즉시';
  const exp = r.experimental_source ? ' · [실값 미확인 필드]' : '';
  return `방식 ${modeText}${suffix}${exp}`;
}

function renderApprovalCard(r) {
  const line = document.createElement('div');
  line.className = 'turn';
  const card = document.createElement('div');
  card.className = 'turn-agent routine-approval';

  const head = document.createElement('div');
  head.className = 'agent-head';
  const title = document.createElement('span');
  title.className = 'agent-source';
  title.textContent = '루틴 제안 — 승인 전에는 실재하지 않습니다';
  head.appendChild(title);
  card.appendChild(head);

  const note = document.createElement('div');
  note.className = 'agent-body';
  note.textContent = r.note;
  card.appendChild(note);

  const mode = document.createElement('div');
  mode.className = 'agent-mode routine-mode-line';
  mode.textContent = approvalModeLine(r);
  card.appendChild(mode);

  if (r.activation_blocker) {
    const blocker = document.createElement('div');
    blocker.className = 'agent-source';
    blocker.textContent = `지금은 켤 수 없음: ${r.activation_blocker}`;
    card.appendChild(blocker);
  }

  const notice = document.createElement('div');
  notice.className = 'agent-source';
  notice.textContent = '승인해도 주문은 자동 집행되지 않습니다 — 조건 도달 시 알림이 옵니다.';
  card.appendChild(notice);

  const row = document.createElement('div');
  row.className = 'routine-approval-actions';
  const status = document.createElement('span');
  status.className = 'agent-mode';

  const approve = _btn('승인', 'routine-btn routine-btn-approve');
  approve.disabled = !!r.activation_blocker;
  approve.addEventListener('click', async () => {
    approve.disabled = true;
    cancel.disabled = true;
    const res = await window.athena.invoke('athena:routine-confirm', { id: r.id });
    if (res && res.ok) {
      status.textContent = '활성 — 감시가 시작됐습니다';
    } else {
      status.textContent = `승인 실패: ${(res && res.error) || '알 수 없는 오류'}`;
      approve.disabled = !!r.activation_blocker;
      cancel.disabled = false;
    }
  });

  const cancel = _btn('취소', 'routine-btn');
  cancel.addEventListener('click', async () => {
    approve.disabled = true;
    cancel.disabled = true;
    const res = await window.athena.invoke('athena:routine-cancel', { id: r.id });
    status.textContent = res && res.ok ? '취소됨' : `취소 실패: ${(res && res.error) || '오류'}`;
  });

  const edit = document.createElement('span');
  edit.className = 'agent-mode';
  edit.textContent = '수정은 커맨드바에 다시 말하면 됩니다';

  row.appendChild(approve);
  row.appendChild(cancel);
  row.appendChild(edit);
  row.appendChild(status);
  card.appendChild(row);

  _mountTurn(line, card);
}

refreshRoutineDrafts();

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

  // 방향 — 사람이 고른다(프리필 아님).
  const sideRow = document.createElement('div');
  sideRow.className = 'ticket-row';
  const sideLabel = document.createElement('span');
  sideLabel.className = 'ticket-label';
  sideLabel.textContent = '방향';
  const buyBtn = _btn('매수', 'routine-btn');
  const sellBtn = _btn('매도', 'routine-btn');
  sideRow.append(sideLabel, buyBtn, sellBtn);
  card.appendChild(sideRow);

  const qtyRow = document.createElement('div');
  qtyRow.className = 'ticket-row';
  const qtyLabel = document.createElement('span');
  qtyLabel.className = 'ticket-label';
  qtyLabel.textContent = '수량 · 시장가';
  const qtyInput = document.createElement('input');
  qtyInput.type = 'number';
  qtyInput.min = '1';
  qtyInput.className = 'ticket-qty';
  qtyRow.append(qtyLabel, qtyInput);
  card.appendChild(qtyRow);

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
  qtyInput.addEventListener('input', syncExec);
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
