// 대화 창 렌더러. nodeIntegration:false / contextIsolation:true(2026-08-18 렌더러
// 격리, 클로드 데스크탑 방식) — preload.js의 window.athena 다리로만 main과
// 통신한다. lib/*.js는 chat.html이 <script> 태그로 미리 로드해 window.AthenaLib에
// 얹어둔 전역이다(require 없음 — nodeIntegration:false라 브라우저에 require가 없다).
const onboarding = window.AthenaLib.Onboarding;
const authScreen = window.AthenaLib.AuthScreen;
const settingsCards = window.AthenaLib.SettingsCards;

const $boot = document.getElementById('boot');
const $bootLine = document.getElementById('bootLine');
const $bootPanel = document.getElementById('bootPanel');
const $bootName = document.getElementById('bootName');
const $bootPh = document.getElementById('bootPh');
const $winControls = document.getElementById('winControls');
const $winMin = document.getElementById('winMin');
const $winMax = document.getElementById('winMax');
const $winClose = document.getElementById('winClose');
const $app = document.getElementById('app');
const $history = document.getElementById('history');
const $input = document.getElementById('input');
const $dot = document.getElementById('dot');
const $lockHint = document.getElementById('lockHint');
const $lockText = document.getElementById('lockText');
const $grip = document.getElementById('grip');
const $onboard = document.getElementById('onboard');
const $onboardBody = document.getElementById('onboardBody');
const $settings = document.getElementById('settings');
const $settingsNav = document.getElementById('settingsNav');
const $settingsGrid = document.getElementById('settingsGrid');

let layout = { chatBaseH: 204, chatMaxH: 788, scale: 1 };
// 'live'(기본) | 'fixture'. main이 athena:init에서 알려준다(main.js
// ATHENA_CANVAS_SOURCE 참조). verify.js만 명시적으로 'fixture'를 세팅한다 —
// 사람이 쓰는 npm start는 항상 live다(결정 D1의 실배선이 기본 경로여야 한다).
let canvasSource = 'live';
let manualOverride = false;
let currentHeight = layout.chatBaseH;
let state = 'idle'; // idle | judging | calling | done(즉시 idle로 수렴)
let liveProgressEl = null;
let abortToken = 0;
let onboardCleanup = null; // 현재 노출 중인 온보딩/인증 화면의 정리 함수(리스너·타이머 해제)

// ---------- 화면 설정(autoExpandCanvas/autoGrowChat) — 복구된 baa7e0e 계약 ----------
// 병합 커밋 c0d874b가 옮기겠다고 하고 안 옮긴 것을 2026-08-18에 되살렸다
// (app/README.md L599-608). 기본값은 원본과 동일 — 채널·기본값을 못 받아도
// 두 동작 모두 이전과 같은 "항상 켜짐"으로 동작한다(fail-open, 새 기능이라
// 실패가 기존 동작을 축소시키면 안 된다).
let prefs = { autoExpandCanvas: true, autoGrowChat: true, fontSize: 'md' };
// 글자 크기 5단계(2026-08-19) — tokens.css의 :root[data-font-size=...] 토큰 세트를
// 켠다. md는 기본 토큰이므로 속성을 지워 :root 값으로 돌아간다. 텍스트 크기가
// 바뀌면 필요한 창 높이도 바뀌므로 auto-grow 재측정을 건다.
function applyFontSize() {
  const v = prefs.fontSize;
  if (v && v !== 'md') document.documentElement.dataset.fontSize = v;
  else delete document.documentElement.dataset.fontSize;
  if (typeof scheduleHeightSync === 'function') scheduleHeightSync();
}
async function loadPrefs() {
  try {
    const next = await window.athena.invoke('athena:settings:prefs:get');
    if (next) prefs = next;
  } catch { /* 채널 없음 — 기본값 유지 */ }
  applyFontSize();
}
window.athena.on('athena:prefs-changed', (next) => { if (next) { prefs = next; applyFontSize(); } });

// ---------- "기록 안 됨" 배지 — 채팅 저장 실패 신호(2026-08-19, plan-chat-graph-pipeline.md §2(g)) ----------
// 순수 로직은 lib/history-badge.js(node --test로 단위 테스트) — 여기는 IPC 구독과
// runQueryLive의 턴 경계 연결만 한다.
const historyBadge = window.AthenaLib.HistoryBadge;
const saveFailedRouter = historyBadge.createSaveFailedRouter();
window.athena.on('athena:history-save-failed', (payload) => saveFailedRouter.handleFailure(payload));

// ---------- 부팅(AT-SY-001) — 4단계 생성 시퀀스 ----------
// 발광점(0ms) → 가로 확장(+180ms) → 세로 전개(+420ms, 유리 72%) → 창 확정(+620ms).
// 이징 cubic-bezier(.2,0,0,1). 4단계는 2026-08-18 사용자 지시로 재정의됐다:
// 전개의 종착은 별도 로고 화면이 아니라 **평소 채팅바 그 자체**다 — 확정된 바의
// 입력줄에 ATHENA가 한 자씩 적혔다가(+660ms~) 지워지고 placeholder로 돌아온 뒤
// (+1160ms) 실제 창으로 스왑한다(+1360ms). 부팅의 최대 크기는 채팅창(chatBaseH)을
// 넘지 않는다. 이전 판의 "상단 로고 + 하단 입력줄" 2분할 확정 화면은 폐기.
// 온보딩 자동 전환(최초 실행 시 AT-SY-002)은 그대로다.
// prefers-reduced-motion이면 시퀀스를 건너뛰고 즉시 완료 상태로 간다(접근성 3종은
// 직접 구현한다 — CLAUDE.md §2).
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
    $winControls.hidden = false; // 창 크롬은 창이 확정된 뒤에만 존재한다(부팅 연출 보호)
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
      scheduleHeightSync();
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

// ---------- 온보딩(AT-SY-002/003) · 인증(AT-CV-OAUTH) 상태 머신 ----------
// 대화 창을 chatMaxH로 확장한 상태에서 CLI 연결(2/3) → 계좌 연결(3/3) → 인증
// 토큰 확인(등록 직후 1회) 순으로 진행하고, 끝나면 chatBaseH로 되돌려 AT-CH-001
// (평소 대화 화면)로 넘어간다. 세 화면 모두 새 창이 아니라 이 컨테이너(#onboard)
// 하나를 재사용한다(plan/paper-specs/00-통합-계획.md §1.1/§1.5).
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
  manualOverride = true; // 온보딩 동안은 대화 이력 기반 자동 성장 로직이 개입하지 않는다
  syncMaxButton(); // 모드가 높이 소유권을 가져간다 — 최대화 버튼 비활성
  window.athena.send('athena:set-chat-height', { height: layout.chatMaxH, manual: false });
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
  manualOverride = false;
  syncMaxButton(); // 높이 소유권 반환 — 최대화 버튼 재활성
  // main이 done:true 응답 시 스스로 축소한다(house rule IPC 계약) — 이 호출은
  // 그 경로가 아직 없거나 실패했을 때를 위한 방어적 폴백이다.
  window.athena.send('athena:set-chat-height', { height: layout.chatBaseH, manual: false });
  $input.focus();
  scheduleHeightSync();
  maybeShowCoachmark(); // 최초 실행은 온보딩을 지나므로 여기가 첫 대화 화면이다
}

// ---------- 설정 진입 코치마크 (2026-08-19 결정 — 최초 1회) ----------
// soul.md "설정 아이콘을 찾아 헤매는 경험은 Athena에 없다"의 실측 반례(디자인 비판
// 2026-08-18: 점 호버 툴팁과 '설정' 타이핑 둘 다 사전 지식이 필요한 무발견 경로)에
// 대한 답. 두 진입로(점·커맨드바)를 한 문장으로 1회만 알린다. localStorage 플래그로
// 다시 안 나오고, fixture(자동 검증) 실행에선 띄우지 않는다 — 캡처 결정론 보호.
function maybeShowCoachmark() {
  if (canvasSource === 'fixture') return;
  try { if (localStorage.getItem('athena-coachmark-settings-v1')) return; } catch { return; }
  if (document.querySelector('.coachmark')) return;
  const mark = document.createElement('div');
  mark.className = 'coachmark';
  mark.textContent = '이 점이 설정입니다 — 누르거나, "설정"이라고 입력해도 열립니다';
  document.body.appendChild(mark);
  const dismiss = () => {
    try { localStorage.setItem('athena-coachmark-settings-v1', '1'); } catch { /* 플래그 실패 시 다음 부팅에 한 번 더 뜬다 — 치명적이지 않다 */ }
    mark.remove();
    window.removeEventListener('pointerdown', dismiss, true);
    window.removeEventListener('keydown', dismiss, true);
  };
  window.addEventListener('pointerdown', dismiss, true);
  window.addEventListener('keydown', dismiss, true);
  setTimeout(() => { if (mark.isConnected) dismiss(); }, 8000);
}

// ---------- 초기 레이아웃 정보 수신 ----------
window.athena.on('athena:init', (payload) => {
  layout = payload;
  canvasSource = payload.canvasSource || 'live';
  currentHeight = layout.chatBaseH;
  applyGlassFraction(0);
});

// ---------- 유리 두께 보간 (기본 0.30 ↔ 확장 0.55) ----------
// two-windows.md의 굴절값(0.46→0.17)은 창 자체의 네이티브 재질 강도를 말하며
// Electron backgroundMaterial API로는 런타임 파라미터화가 안 된다(chat.css 주석
// 참조) — 여기서는 실제로 조절 가능한 알파만 보간한다.
// 2026-08-18 전체 스케일 하향(사용자 지시 "그냥 검은 창 같다 — 뒤가 비쳐야 한다"):
// 0.82↔0.97은 acrylic 위에서 사실상 불투명 검정으로 읽혔다. 블러(가독성)는
// 네이티브 acrylic이 담당하므로 틴트 알파는 낮춰도 텍스트 대비가 성립한다.
// "뒤 정보 밀도에 비례해 두꺼워진다"(soul.md §7)는 유지.
// 2026-08-19: 값의 SSOT는 tokens.css 유리 사다리(--glass-window/--glass-window-max)다
// — 여기 하드코드하면 CSS와 두 벌이 된다(verify 검증16이 사다리 일치를 단언한다).
const rootStyles = getComputedStyle(document.documentElement);
const GLASS_WINDOW = parseFloat(rootStyles.getPropertyValue('--glass-window')) || 0.30;
const GLASS_WINDOW_MAX = parseFloat(rootStyles.getPropertyValue('--glass-window-max')) || 0.55;
// 휘도 감지-적응(2026-08-19) — 높이 보간과 밝기 하한의 합성: 최종 두께는
// max(높이 보간값, 밝기 하한)이다. 어두운 배경에선 하한이 GLASS_WINDOW라 기존
// 동작 그대로이고, 밝은 배경에선 하한이 0.72까지 올라가 dim 텍스트 소실(검증
// 보드 45 실측)을 막는다.
let glassFrac = 0;
let glassBrightFloor = GLASS_WINDOW;
function applyGlassFraction(frac) {
  glassFrac = frac;
  const interpolated = GLASS_WINDOW + (GLASS_WINDOW_MAX - GLASS_WINDOW) * frac;
  const alpha = Math.max(interpolated, glassBrightFloor);
  document.documentElement.style.setProperty('--glass-alpha', alpha.toFixed(3));
}
window.athena.on('athena:backdrop-luminance', ({ windowAlpha } = {}) => {
  if (!Number.isFinite(windowAlpha)) return;
  glassBrightFloor = windowAlpha;
  applyGlassFraction(glassFrac); // 현재 높이 상태에 새 하한을 즉시 합성 — 전이는 CSS(600ms)가 맡는다
});

window.addEventListener('resize', () => {
  // innerHeight는 CSS px — 창 bounds(물리 px)와 비교하려면 줌 배율을 되돌린다.
  currentHeight = Math.round(window.innerHeight * window.athena.getZoomFactor());
  const growable = Math.max(1, layout.chatMaxH - layout.chatBaseH);
  const frac = Math.min(1, Math.max(0, (currentHeight - layout.chatBaseH) / growable));
  applyGlassFraction(frac);
  syncMaxButton();
});

// OS 모서리 리사이즈(2026-08-18 자유 리사이즈 승급) — main의 handleForeignArrange가
// 사용자 리사이즈를 수용하면서 보낸다. 그립 드래그와 같은 "수동" 문법으로 취급해
// 다음 내용 변화의 자동 성장이 방금의 사용자 크기를 덮어쓰지 않게 한다.
window.athena.on('athena:manual-resize', () => { manualOverride = true; });

// 최대화 버튼의 상태(확장/복귀/비활성)를 실제 창 상태에서 파생한다 — 버튼이 자기
// 기억이 아니라 창의 현재 상태를 말하게 한다(정보 정직성). 설정·온보딩 모드가
// 높이를 소유하는 동안은 disabled로 디밍한다 — "복귀" 아이콘을 보여주면서 클릭을
// 조용히 무시하는 것은 라벨이 거짓말하는 상태다(2026-08-18 리뷰 지적).
// resize 이벤트 외에 모드 열림/닫힘 지점 4곳에서도 직접 호출한다 — 창이 이미
// chatMaxH라 리사이즈가 안 일어나는 경우에도 상태가 맞아야 한다.
function syncMaxButton() {
  const modeOwnsHeight = settingsOpen || orderOpen || !$onboard.hidden;
  const atMax = currentHeight >= layout.chatMaxH - 2;
  $winMax.disabled = modeOwnsHeight;
  $winMax.classList.toggle('is-max', atMax && !modeOwnsHeight);
  const label = modeOwnsHeight
    ? '지금은 설정·온보딩이 창 높이를 관리한다'
    : atMax ? '기본 높이로 복귀' : '최대 높이로 확장';
  $winMax.title = label;
  $winMax.setAttribute('aria-label', label);
}

// ---------- 이력 스크롤 — 하단 고정(stick-to-bottom) ----------
// .history가 overflow-y:auto로 바뀌었다(chat.css) — 창이 chatMaxH까지 자란 뒤에는
// 지난 턴을 스크롤로 되짚는다. 새 내용이 올 때는 바닥에 붙어 따라가되, 사용자가
// 위로 올려 읽는 중이면(바닥에서 24px 이상) 강제로 끌어내리지 않는다.
let stickToBottom = true;
$history.addEventListener('scroll', () => {
  stickToBottom = $history.scrollHeight - $history.scrollTop - $history.clientHeight < 24;
});

function scrollHistoryToBottom(force) {
  if (force) stickToBottom = true;
  if (stickToBottom) $history.scrollTop = $history.scrollHeight;
}

// ---------- 자동 성장 (위로만, 사용자 수동 조작을 덮어쓰지 않음) ----------
function scheduleHeightSync() {
  requestAnimationFrame(() => {
    // autoGrowChat=false여도 스크롤(하단 고정)은 계속 동작한다 — 막는 건 창을
    // 키우는 자동 요청뿐이다. 수동 리사이즈(그립 드래그)는 이 경로를 안 탄다.
    if (!manualOverride && prefs.autoGrowChat) {
      const need = measureNeededHeight();
      window.athena.send('athena:set-chat-height', { height: need, manual: false });
    }
    scrollHistoryToBottom();
  });
}

function measureNeededHeight() {
  const gripH = $grip.getBoundingClientRect().height;
  // AT-CH-001R — 입력 영역은 이제 2행(입력줄 52 + 컨트롤 스트립 48) 스택이다.
  const inputStack = document.querySelector('.input-stack');
  const inputH = inputStack ? inputStack.getBoundingClientRect().height : 100;
  const histNeeded = $history.scrollHeight + 16; // padding
  // 측정은 CSS px, 창 높이는 물리 px — 줌 배율을 곱해 보낸다(main의 clamp와 단위 일치).
  return Math.round((gripH + inputH + histNeeded) * window.athena.getZoomFactor());
}

// 줌 배율이 바뀌면 같은 내용이라도 필요한 창 높이가 달라진다 — 다시 재서 요청한다.
window.athena.on('athena:zoom-changed', () => scheduleHeightSync());

// ---------- 수동 리사이즈 (그립 드래그) ----------
let dragging = false;
let dragStartScreenY = 0;
let dragStartHeight = 0;
$grip.addEventListener('mousedown', (e) => {
  dragging = true;
  dragStartScreenY = e.screenY;
  dragStartHeight = currentHeight;
  document.body.style.cursor = 'ns-resize';
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const delta = dragStartScreenY - e.screenY; // 위로 끌수록(스크린Y 감소) 커진다
  const h = Math.round(dragStartHeight + delta);
  window.athena.send('athena:set-chat-height', { height: h, manual: true });
});
window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  manualOverride = true;
  document.body.style.cursor = '';
});

// ---------- TR → 카드 종류 라우팅 (목업) ----------
// "캔버스"는 창을 뜻한다. 창 안에 뜨는 것은 **카드**다(GLOSSARY.md §2).
// 카드는 데이터 표현 공통 UI라 들어오는 데이터가 달라져도 종류가 늘지 않는다 —
// TR이 몇 개든 12종에 접는다. 여기 매핑은 그 접기의 목업이다.
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

// 내부 식별자를 사용자에게 보여주지 않는다(ui/DESIGN-SOUL.md 축3 — "TR코드는
// 개발자의 언어이지 사용자의 언어가 아니다"). 2026-08-17 디자인 리뷰 [HIGH] 정정:
// 이전 판은 진행 라인·트레이스에 tool 코드(search_news 등)를, 완료 칩에 응답
// canvas_type(table/free 등)을 원문 그대로 노출했다. 화면에는 한국어 라벨만 내보내고
// 원문 식별자는 코드(CARD_PLAN.tool)와 로그에만 남는다.
const CANVAS_TYPE_LABELS = {
  table: '공통 테이블',
  'mcp-table': '공통 테이블',
  stream: '스트림',
  reader: '리더',
  chart: '차트',
  free: '자유 카드',
  notice: '알림',
};

function canvasTypeLabel(t) {
  // 미지의 타입도 원문 식별자를 새지 않게 한다 — 게이트웨이가 새 canvas_type을
  // 보내기 시작하면 여기 매핑에 등록하는 것이 정직한 경로다.
  return CANVAS_TYPE_LABELS[t] || '카드';
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

// 실배선/픽스처 분기 — plan/kiwoom-common-screen-handoff.md §6, main.js의
// athena__render_canvas source:'fixture' 분기와 짝을 이룬다. 기본은 live다.
async function runQuery(text) {
  if (canvasSource === 'fixture') return runQueryFixture(text);
  return runQueryLive(text);
}

// ---------- 실배선 — claude -p 실호출, 결정 D1 ----------
// 목업 시절의 "TR 이름을 미리 안다"는 전제가 여기선 성립하지 않는다 — 어떤
// MCP 툴이 몇 번 불릴지는 claude가 정한다. 그래서 진행 표시는 TR 코드 나열이
// 아니라 "카드가 늘어난 개수 + 경과 시간"이다. 실왕복은 43초까지 걸린 실측이
// 있다(spike/cli-pipe/gateway/RESULT.md) — 조용히 멈춘 것처럼 보이면 안 된다.
async function runQueryLive(text) {
  const myToken = ++abortToken;
  manualOverride = false;

  const qLine = document.createElement('div');
  qLine.className = 'turn';
  const qText = document.createElement('div');
  qText.className = 'turn-q';
  qText.textContent = text;
  qLine.appendChild(qText);
  $history.appendChild(qLine);
  scrollHistoryToBottom(true); // 새 질문은 무조건 바닥으로 — 위에서 읽던 중이어도 새 턴이 우선이다
  scheduleHeightSync();
  // 새 턴 시작 — "기록 안 됨" 배지가 붙을 줄 참조를 갱신(main이 진입 직후 role:user
  // 저장을 이미 시도하므로 여기서부터 실패 이벤트가 올 수 있다).
  saveFailedRouter.startTurn(qLine);

  state = 'judging';
  setDot('judging');
  setLocked(true, 'Claude에게 물어보는 중 — 수십 초 걸릴 수 있다');
  const progress = document.createElement('div');
  progress.className = 'progress-line';
  const progText = document.createElement('span');
  const startedAt = Date.now();
  progText.textContent = 'Claude에게 물어보는 중 · 0.0s';
  progress.appendChild(progText);
  $history.appendChild(progress);
  liveProgressEl = progress;
  scheduleHeightSync();

  let cardCount = 0;
  let calling = false;
  const elapsedText = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  const renderProgress = () => {
    if (myToken !== abortToken) return;
    const base = calling ? `카드 ${cardCount}개 렌더됨` : 'Claude에게 물어보는 중';
    progText.textContent = `${base} · ${elapsedText()} 경과`;
    setLocked(true, `${base} · ${elapsedText()} 경과`);
  };
  // 100ms 간격 — 표기는 소수 1자리(29.3s)인데 1초 간격으로 갱신하면 소수 자리가
  // 항상 .0으로만 보여 정수 표시와 구별되지 않았다(2026-08-18 사용자 지시).
  const tick = setInterval(renderProgress, 100); // 진행이 눈에 보이게 — 조용히 멈춘 것처럼 보이면 안 된다

  const onLiveCanvasAdded = () => {
    if (myToken !== abortToken) return;
    if (!calling) { calling = true; state = 'calling'; setDot('calling'); }
    cardCount += 1;
    renderProgress();
    scheduleHeightSync();
  };
  const unsubscribeLiveCanvasAdded = window.athena.on('athena:live-canvas-added', onLiveCanvasAdded);

  let result;
  try {
    result = await window.athena.invoke('athena__render_canvas', { source: 'live', query: text, expand: prefs.autoExpandCanvas });
  } finally {
    clearInterval(tick);
    unsubscribeLiveCanvasAdded();
  }
  if (myToken !== abortToken) return;

  state = 'idle';
  setDot(null);
  setLocked(false);
  progress.remove();
  liveProgressEl = null;

  const aLine = document.createElement('div');
  aLine.className = 'turn';
  const aText = document.createElement('div');
  aText.className = 'turn-a';
  // 정직하게: 실패했으면 실패했다고 보여준다(CLAUDE.md §4). result.error는
  // claude 종료 코드거나 CLI가 낸 실패 메시지 원문이다.
  aText.textContent = result && result.ok
    ? (result.answerText || `완료 — 카드 ${cardCount}개, 답변 텍스트 없음`)
    : `실패 — ${(result && result.error) || '알 수 없는 오류'}`;
  aLine.appendChild(aText);

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
  trace.textContent = `claude -p · ${durS}s` + (skipped ? ` · 비JSON 라인 ${skipped}건 건너뜀` : '');
  meta.appendChild(trace);
  aLine.appendChild(meta);

  $history.appendChild(aLine);
  saveFailedRouter.setAssistantLine(aLine);
  scheduleHeightSync();
  $input.focus();

  // 방금 턴에서 모델이 athena_routine(draft)로 제안했을 수 있다 — 승인 카드는
  // 스트림 파싱이 아니라 백엔드 목록 재조회로 결정론적으로 띄운다(P3).
  refreshRoutineDrafts();
}

// ---------- 픽스처 어댑터 — 검증 전용, 명시적으로 선택했을 때만 탄다 ----------
// spike/captures/*.json을 lib/mockdata.js가 읽는 경로(main.js의 source:'fixture'
// 분기)로 이어진다. verify.js가 ATHENA_CANVAS_SOURCE=fixture로 canvasSource를
// 강제할 때만 여기로 온다 — quota 없이 결정론적 3상태/자동성장 검증을 위해서다.
async function runQueryFixture(text) {
  const myToken = ++abortToken;
  manualOverride = false; // 새 턴 — 자동 성장 재개
  const types = pickCardTypes(text);

  const qLine = document.createElement('div');
  qLine.className = 'turn';
  const qText = document.createElement('div');
  qText.className = 'turn-q';
  qText.textContent = text;
  qLine.appendChild(qText);
  $history.appendChild(qLine);
  scrollHistoryToBottom(true);
  scheduleHeightSync();

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
  scheduleHeightSync();

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
  scheduleHeightSync();
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
  scheduleHeightSync();
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

// ---------- 설정 모드 ----------
// 설정은 새 창이 아니다. **이 창이 설정 모드로 바뀐다** — 온보딩·인증과 같은
// 문법이다(ui/DESIGN-SOUL.md:100 "#dot를 건들면 그냥 채팅창이 설정창으로 변하는
// 것이 좋겠다", 도출된 규칙 3). 근거: 설정을 만지는 동안 사용자는 채팅을 치지
// 않는다 — 시간을 다투지 않으면 면적을 나누지 않는다.
let settingsOpen = false;

function openSettings() {
  if (settingsOpen) return;
  settingsOpen = true;
  $app.hidden = true;
  $settings.hidden = false;
  manualOverride = true; // 설정 동안은 이력 기반 자동 성장이 개입하지 않는다
  syncMaxButton(); // 모드가 높이 소유권을 가져간다 — 최대화 버튼 비활성
  window.athena.send('athena:set-chat-height', { height: layout.chatMaxH, manual: false });
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
  manualOverride = false;
  syncMaxButton(); // 높이 소유권 반환 — 최대화 버튼 재활성
  window.athena.send('athena:set-chat-height', { height: layout.chatBaseH, manual: false });
  $input.focus();
}

// 커맨드바에서 설정을 부르는 말. 결정론적 매칭만 한다 — 애매하면 일반 질의로 흘린다.
// GLOSSARY.md §1: 설정은 커맨드바로도 반드시 도달할 수 있어야 한다. 점으로만
// 갈 수 있으면 ui/soul.md §8 탈락 조건에 걸린다.
// 실측 함정: `\b`는 한글 뒤에서 성립하지 않는다(한글은 \w가 아니다). 이걸 쓰면
// 첫 분기가 통째로 죽는다. 단독 호출어는 문자열 전체 일치로, 나머지는 동사구로 잡는다.
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

// LLM 미경유 — 로컬 IPC(athena:brain-history-query)만 왕복한다. main이 backend를
// 조회해 ④ 공통 테이블 카드 봉투로 접어 캔버스에 직접 보낸다(main.js
// sendLiveCanvasResult 재사용, 신규 카드 타입 0개). 실패해도 카드 없이 정직한
// 안내 텍스트만 남긴다(CLAUDE.md §4 — 조용히 삼키지 않는다).
async function runHistoryCommand(text) {
  const myToken = ++abortToken;
  manualOverride = false;

  const qLine = document.createElement('div');
  qLine.className = 'turn';
  const qText = document.createElement('div');
  qText.className = 'turn-q';
  qText.textContent = text;
  qLine.appendChild(qText);
  $history.appendChild(qLine);
  scrollHistoryToBottom(true);
  scheduleHeightSync();

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
  scheduleHeightSync();
  $input.focus();
}

$dot.addEventListener('click', () => { openSettings(); });

// ---------- 입력 ----------
$input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && state === 'idle') {
    const text = $input.value.trim() || '보유 종목 수급 요약해줘';
    $input.value = '';
    if (isSettingsCommand(text)) {
      openSettings();
      return;
    }
    if (isHistoryCommand(text)) {
      runHistoryCommand(text);
      return;
    }
    runQuery(text);
  }
});

// ---------- 창 제어 버튼 (AT-CH-001, 2026-08-18) — 우상단 3버튼 ----------
// 최소화 = 기존 Ctrl+M과 같은 IPC(두 창 한 몸). 최대화 = 이 앱에서 창의 최대는
// OS 전체화면이 아니라 설계 최대 높이(chatMaxH, E3)다 — 그립 드래그와 같은 높이
// 배선으로 chatBaseH↔chatMaxH를 오간다. 닫기 = 종료가 아니라 두 창을 숨기고
// 프로세스를 백그라운드에 남긴다(사용자 지시 "백그라운드는 살아있음") — 복귀는
// 트레이(main.js). 온보딩·설정 모드가 열려 있는 동안 높이는 모드 소유라 최대화
// 토글은 개입하지 않는다.
// ---------- 창 최대화/복원/최소화 — 로컬 경로 (2026-08-18, Windows 표준 의미론) ----------
// 높이 상태(auto-grow·manualOverride·□ 버튼 상태)의 단일 소유자는 렌더러다.
// □ 버튼 · Win+↑/↓(main이 athena:window-key로 위임) · Ctrl+Alt+↑/↓가 전부 이
// 두 함수를 공유한다 — main이 setChatHeight를 직접 부르면(구판) 이 상태들과
// 어긋난다(팀리드 지시). Win+←/→·Ctrl+Alt+←/→는 렌더러 상태와 무관한 순수 위치
// 이동이라 여전히 IPC(athena:place-windows)로 main이 직접 처리한다.
// 마지막 수동 높이 기억(2026-08-19 결정, 질의응답) — Windows 복원 사각형 의미론.
// □(확장 토글)는 이제 "확장 ↔ 직전 크기"다. 사용자가 그립·OS 엣지로 만든 커스텀
// 크기를 □가 조용히 204px로 붕괴시키던 결함(디자인 비판 2026-08-18)의 해소.
// 표준 최대(chatMaxH)를 넘긴 크기에서 □를 누르면 표준 최대로 접되 원크기를
// 복원값으로 기억한다 — 다시 누르면 돌아온다.
let lastRestoreHeight = null;

function restoreFromMax() {
  const target = lastRestoreHeight && lastRestoreHeight > layout.chatBaseH + 2
    ? lastRestoreHeight
    : layout.chatBaseH;
  lastRestoreHeight = null;
  // 기본 높이로 돌아가면 자동 성장 재개(manualOverride 해제), 커스텀 크기로
  // 돌아가면 그 크기를 보호한다(그립 드래그와 같은 문법).
  manualOverride = target !== layout.chatBaseH;
  window.athena.send('athena:set-chat-height', { height: target, manual: manualOverride });
}

function toggleMaxHeight() {
  if (settingsOpen || orderOpen || !$onboard.hidden) return; // 모드가 높이를 소유 중 — disabled의 백스톱
  const over = currentHeight > layout.chatMaxH + 2;
  const atMax = !over && currentHeight >= layout.chatMaxH - 2;
  if (over) {
    // 표준 최대보다 크게 늘린 상태 — 표준 최대로 접고 원크기를 기억한다.
    lastRestoreHeight = currentHeight;
    manualOverride = true;
    window.athena.send('athena:set-chat-height', { height: layout.chatMaxH, manual: true });
  } else if (atMax) {
    // scheduleHeightSync()를 부르지 않는 이유는 구판 주석 그대로 — 수축 직후
    // 자연 높이 재확장이 끼어드는 이중 리사이즈 방지(2026-08-18 리뷰 지적).
    restoreFromMax();
  } else {
    lastRestoreHeight = currentHeight > layout.chatBaseH + 2 ? currentHeight : null;
    manualOverride = true; // 그립 드래그와 같은 문법 — 자동 성장이 덮어쓰지 않는다
    window.athena.send('athena:set-chat-height', { height: layout.chatMaxH, manual: true });
  }
  $input.focus();
}

// Windows의 "restore-then-minimize" 의미론 — 최대화(이상) 상태면 직전 크기로 복원,
// 아니면 두 창을 최소화한다.
function restoreOrMinimize() {
  if (settingsOpen || orderOpen || !$onboard.hidden) return; // 모드가 높이를 소유 중 — disabled의 백스톱
  if (currentHeight >= layout.chatMaxH - 2) {
    restoreFromMax();
  } else {
    window.athena.send('athena:minimize-windows');
  }
}

// main의 before-input-event(Win+↑/↓)가 위임하는 이벤트 — □ 버튼과 같은 로컬
// 경로를 태운다(main.js wireWindowsKeyShortcuts 주석 참고).
window.athena.on('athena:window-key', ({ dir } = {}) => {
  if (dir === 'up') toggleMaxHeight();
  else if (dir === 'down') restoreOrMinimize();
});

$winMin.addEventListener('click', () => {
  window.athena.send('athena:minimize-windows');
});
$winMax.addEventListener('click', () => { toggleMaxHeight(); });
$winClose.addEventListener('click', () => {
  window.athena.send('athena:close-windows');
});

// ---------- 창 기본 기능 (2026-08-17) — frame:false라 OS 타이틀바가 없어 직접 배선 ----------
// 줌: Ctrl+= / Ctrl+- / Ctrl+0 / Ctrl+휠. 최소화: Ctrl+M. main.js가 두 창을 동기한다.
// 창 배치(2026-08-18, 설정 › 화면 안내 행과 짝을 이룬다) — 주 경로는 Windows
// 네이티브 Win+방향키(main.js가 before-input-event로 직접 처리한다,
// WIN_ARROW_DIR). Ctrl+Alt+방향키는 보조 경로이고 같은 의미론을 써야 한다 —
// left/right는 좌/우 절반, **up은 최대화 토글**(□ 버튼과 동일), **down은
// 복원→최소화**다. left/right는 렌더러 상태와 무관하니 여전히 IPC
// (athena:place-windows)로 main이 처리하지만, up/down은 높이 상태를 렌더러가
// 소유하므로(toggleMaxHeight/restoreOrMinimize 주석 참고) IPC 왕복 없이 같은
// 로컬 함수를 직접 부른다 — Win+↑/↓가 athena:window-key로 도착하는 것과 결국
// 같은 경로를 탄다. 'center'/'minimize' 같은 옛 별도 이름은 쓰지 않는다.
// Ctrl 단독 분기(줌·최소화)보다 먼저 검사해야 한다 — 기존 코드는 altKey가
// 눌리면 그냥 return했는데, 여기서 그 자리를 가로채 처리하고 여전히
// return한다(다른 Ctrl+Alt 조합에도 줌 로직이 새지 않게).
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.altKey) {
    if (e.key === 'ArrowUp') { e.preventDefault(); toggleMaxHeight(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); restoreOrMinimize(); return; }
    const dir = { ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
    if (dir) {
      e.preventDefault();
      window.athena.send('athena:place-windows', { dir });
    }
    return;
  }
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.key === '=' || e.key === '+') {
    e.preventDefault();
    window.athena.send('athena:zoom', { dir: 'in' });
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    window.athena.send('athena:zoom', { dir: 'out' });
  } else if (e.key === '0') {
    e.preventDefault();
    window.athena.send('athena:zoom', { dir: 'reset' });
  } else if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    window.athena.send('athena:minimize-windows');
  }
});

window.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  window.athena.send('athena:zoom', { dir: e.deltaY < 0 ? 'in' : 'out' });
}, { passive: false });

// 창 이동 — 빈 유리 표면(이력 여백·입력줄 여백·설정/온보딩 배경)을 잡고 끈다.
// e.target === el 조건이 핵심이다: 턴 텍스트·입력창·버튼 등 자식 위에서는
// 시작하지 않아 선택/클릭/스크롤과 충돌하지 않는다. 실제 이동은 main.js가
// 커서를 폴링해 수행한다(athena:window-drag).
function bindWindowDrag(el) {
  if (!el) return;
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target !== el) return;
    window.athena.send('athena:window-drag', { phase: 'start' });
    document.body.style.cursor = 'grabbing'; // 잡는 중 — hover의 grab(chat.css)과 짝(2026-08-19)
    const end = () => {
      window.athena.send('athena:window-drag', { phase: 'end' });
      document.body.style.cursor = '';
      window.removeEventListener('mouseup', end);
      window.removeEventListener('blur', end);
    };
    window.addEventListener('mouseup', end);
    window.addEventListener('blur', end);
  });
}
bindWindowDrag($history);
bindWindowDrag(document.querySelector('.input-row'));
bindWindowDrag(document.getElementById('controlStrip'));
bindWindowDrag($settings);
bindWindowDrag(document.querySelector('.settings-head'));
bindWindowDrag($onboard);
bindWindowDrag($onboardBody);

// ---------- 컨트롤 스트립(AT-CH-001R, Paper 47쪽) — CLI 필 · 모델 필 · 팝오버 ----------
// 실기능만 올린다(soul.md §7): CLI 필은 runQuery의 실행기(claude -p) 표시이자
// 설정 진입로, 모델 필은 athena:model-get 실상태 표시이자 인라인 팝오버다.
// 팝오버는 창 안 오버레이 — 새 창을 만들지 않는다(soul.md §3).
const $cliPill = document.getElementById('cliPill');
const $modelPill = document.getElementById('modelPill');
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

function modelPillLabel(st) {
  const c = (st && st.claude) || {};
  const m = c.model ? c.model.toUpperCase() : '기본 모델';
  return c.effort ? `${m} · ${c.effort}` : m;
}

async function refreshModelPill() {
  try {
    modelStateCache = await window.athena.invoke('athena:model-get');
    $modelPill.textContent = modelPillLabel(modelStateCache);
  } catch {
    // 상태를 못 읽으면 라벨을 갱신하지 않는다 — 추측값을 쓰지 않는다(정보 정직성).
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
      await refreshModelPill();
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

$modelPill.addEventListener('click', async () => {
  if ($modelPopover.hidden) {
    await refreshModelPill();
    renderModelPopover();
    $modelPopover.hidden = false;
  } else {
    closeModelPopover();
  }
});
// CLI 전환·계정은 설정 모드의 일이다 — 필은 진입로만 제공한다.
$cliPill.addEventListener('click', () => openSettings());
// 바깥 클릭으로 닫는다 — 필 클릭은 토글 핸들러가 처리하므로 제외.
document.addEventListener('mousedown', (e) => {
  if ($modelPopover.hidden) return;
  if ($modelPopover.contains(e.target) || $modelPill.contains(e.target)) return;
  closeModelPopover();
});
window.athena.on('athena:model-changed', () => refreshModelPill());
refreshModelPill();

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
      state = 'idle';
      setDot(null);
      setLocked(false);
      if (liveProgressEl) { liveProgressEl.remove(); liveProgressEl = null; }
      scheduleHeightSync();
    } else {
      window.athena.send('athena:collapse-canvas');
    }
  }
});

// ---------- 능동 턴 · 활성 루틴 칩 (능동 에이전트 P2, 2026-08-19) ----------
// 백엔드 파수꾼의 발화가 여기서 대화 이력에 들어온다 — 사용자 질의 없이
// 나타나는 유일한 턴 종류(GLOSSARY '능동 턴'). 본문은 결정론 템플릿
// (lib/routine-turn.js — LLM 0)이고, 발화 시각 배지·방식 표기·소스 라벨이
// 필수 계약이다(시점 정직성). 렌더는 전부 textContent — innerHTML 0건 유지.
const routineTurnLib = window.AthenaLib.RoutineTurn;
const $routineChip = document.getElementById('routineChip');

async function refreshRoutineChip() {
  if (!$routineChip) return;
  try {
    const res = await window.athena.invoke('athena:routines-list');
    const routines = res && res.ok && res.data && Array.isArray(res.data.routines)
      ? res.data.routines : [];
    const active = routines.filter((r) => r.status === 'active').length;
    $routineChip.hidden = active === 0;
    $routineChip.textContent = `감시 ${active} 활성`;
  } catch {
    // 백엔드 미기동·루틴 비활성 — 칩을 숨긴다(없는 감시를 있다고 표시하지 않는다).
    $routineChip.hidden = true;
  }
}

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
  scheduleHeightSync();
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
  refreshRoutineChip();
});
refreshRoutineChip();

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
      refreshRoutineChip();
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
const $order = document.getElementById('order');
const $orderBody = document.getElementById('orderBody');
let orderOpen = false;

function openOrderTicket(prefill) {
  if (orderOpen || settingsOpen || !$onboard.hidden) return;
  orderOpen = true;
  $app.hidden = true;
  $order.hidden = false;
  manualOverride = true;
  syncMaxButton();
  window.athena.send('athena:set-chat-height', { height: layout.chatMaxH, manual: false });
  renderOrderTicket(prefill);
}

function closeOrderTicket() {
  if (!orderOpen) return;
  orderOpen = false;
  $orderBody.replaceChildren();
  $order.hidden = true;
  $app.hidden = false;
  manualOverride = false;
  syncMaxButton();
  window.athena.send('athena:set-chat-height', { height: layout.chatBaseH, manual: false });
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
