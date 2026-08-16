// 대화 창 렌더러. nodeIntegration:true / contextIsolation:false — spike/electron-glass 패턴 그대로.
const { ipcRenderer } = require('electron');
const onboarding = require('./lib/onboarding');
const authScreen = require('./lib/auth-screen');
const settingsCards = require('./lib/settings-cards');
const { el, progressDots } = require('./lib/ui-kit');

const $boot = document.getElementById('boot');
const $gaugeFill = document.getElementById('gaugeFill');
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
const $settingsGrid = document.getElementById('settingsGrid');

let layout = { chatBaseH: 204, chatMaxH: 788, scale: 1 };
let manualOverride = false;
let currentHeight = layout.chatBaseH;
let state = 'idle'; // idle | judging | calling | done(즉시 idle로 수렴)
let liveProgressEl = null;
let abortToken = 0;
let onboardCleanup = null; // 현재 노출 중인 온보딩/인증 화면의 정리 함수(리스너·타이머 해제)

// ---------- 부팅 게이지 ----------
// D4 — 부팅(AT-SY-001)을 온보딩 3단계 중 1단계로 프레이밍한다. 온보딩 화면
// 자체는 "2 / 3"·"3 / 3"뿐이고 "1 / 3"은 22개 아트보드 어디에도 없다
// (README.md "설계에 없어서 지어낸 것" 표) — 그 빈 자리가 부팅이라는 결정이다.
// 부팅 게이지는 최초 실행 여부와 무관하게 **매번** 뜬다(재실행 사용자도 본다).
// 반면 2/3·3/3은 온보딩이 필요한 최초 실행 때만 이어진다. 그래서 "1 / 3" 표기와
// 진행 점은 온보딩이 실제로 뒤따를 때만 보여준다 — 안 그러면 재실행 사용자에게
// "3단계 중 1단계"라고 말해놓고 2단계로 이어지지 않는 거짓말이 된다. 이 판단을
// 위해 onboarding-state 조회를 게이지 애니메이션과 동시에 시작한다(부팅 시간을
// 늘리지 않고 그 안에서 미리 알아낸다).
window.addEventListener('DOMContentLoaded', () => {
  requestAnimationFrame(() => {
    $gaugeFill.style.width = '100%';
  });

  const onboardStatePromise = ipcRenderer.invoke('athena:onboarding-state').catch(() => {
    // 채널이 아직 없거나 실패하면 "온보딩 필요"로 가정한다 — 온보딩을 건너
    // 뛰고 정상 대화 화면을 보여주는 쪽이 훨씬 위험하다("건너뛰기 없음"
    // 원칙, AT-SY-002/003). 이 fail-closed 결정은 발명이다 — 리포트 참고.
    return { needed: true, step: 2 };
  });
  onboardStatePromise.then((s) => {
    if (s && s.needed) showBootStepFraming();
  });

  setTimeout(() => {
    $boot.style.transition = 'opacity 260ms ease';
    $boot.style.opacity = '0';
    setTimeout(async () => {
      $boot.hidden = true;
      const onboardState = await onboardStatePromise;
      if (onboardState && onboardState.needed) {
        startOnboarding(onboardState.step);
      } else {
        $app.hidden = false;
        $input.focus();
        scheduleHeightSync();
      }
    }, 260);
  }, 1300);
});

// 새 부팅 화면을 만들지 않는다(D4 지시) — 있는 #boot에 온보딩과 같은 프리미티브
// (ui-kit의 진행 점)·같은 스타일(onb-kicker)을 덧붙일 뿐이다. 진행 점은
// ui-kit.css가 이미 무채색으로 고정해둔 컴포넌트라 D5(브랜드색은 [계속]에만)와도
// 충돌하지 않는다.
function showBootStepFraming() {
  if ($boot.querySelector('.boot-step-kicker')) return; // 중복 호출 방지
  const kicker = el('div', 'boot-step-kicker onb-kicker', '1 / 3');
  $boot.insertBefore(kicker, $boot.firstChild);
  $boot.appendChild(progressDots(3, 1));
}

// ---------- 온보딩(AT-SY-002/003) · 인증(AT-CV-OAUTH) 상태 머신 ----------
// 대화 창을 chatMaxH로 확장한 상태에서 CLI 연결(2/3) → 계좌 연결(3/3) → 인증
// 토큰 확인(등록 직후 1회) 순으로 진행하고, 끝나면 chatBaseH로 되돌려 AT-CH-001
// (평소 대화 화면)로 넘어간다. 세 화면 모두 새 창이 아니라 이 컨테이너(#onboard)
// 하나를 재사용한다(plan/paper-specs/00-통합-계획.md §1.1/§1.5).
async function onboardAdvance(step) {
  try {
    const res = await ipcRenderer.invoke('athena:onboarding-advance', { step });
    return !!(res && res.ok);
  } catch (err) {
    return false;
  }
}

function startOnboarding(step) {
  $onboard.hidden = false;
  manualOverride = true; // 온보딩 동안은 대화 이력 기반 자동 성장 로직이 개입하지 않는다
  ipcRenderer.send('athena:set-chat-height', { height: layout.chatMaxH, manual: false });
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
  // main이 done:true 응답 시 스스로 축소한다(house rule IPC 계약) — 이 호출은
  // 그 경로가 아직 없거나 실패했을 때를 위한 방어적 폴백이다.
  ipcRenderer.send('athena:set-chat-height', { height: layout.chatBaseH, manual: false });
  $input.focus();
  scheduleHeightSync();
}

// ---------- 초기 레이아웃 정보 수신 ----------
ipcRenderer.on('athena:init', (e, payload) => {
  layout = payload;
  currentHeight = layout.chatBaseH;
  applyGlassFraction(0);
});

// ---------- 유리 두께 보간 (기본 0.82 ↔ 확장 0.97) ----------
// two-windows.md의 굴절값(0.46→0.17)은 창 자체의 네이티브 재질 강도를 말하며
// Electron backgroundMaterial API로는 런타임 파라미터화가 안 된다(chat.css 주석
// 참조) — 여기서는 실제로 조절 가능한 알파만 보간한다.
function applyGlassFraction(frac) {
  const alpha = 0.82 + (0.97 - 0.82) * frac;
  document.documentElement.style.setProperty('--glass-alpha', alpha.toFixed(3));
}

window.addEventListener('resize', () => {
  currentHeight = window.innerHeight;
  const growable = Math.max(1, layout.chatMaxH - layout.chatBaseH);
  const frac = Math.min(1, Math.max(0, (currentHeight - layout.chatBaseH) / growable));
  applyGlassFraction(frac);
});

// ---------- 자동 성장 (위로만, 사용자 수동 조작을 덮어쓰지 않음) ----------
function scheduleHeightSync() {
  requestAnimationFrame(() => {
    if (manualOverride) return;
    const need = measureNeededHeight();
    ipcRenderer.send('athena:set-chat-height', { height: need, manual: false });
  });
}

function measureNeededHeight() {
  const gripH = $grip.getBoundingClientRect().height;
  const inputRow = document.querySelector('.input-row');
  const inputH = inputRow ? inputRow.getBoundingClientRect().height : 64;
  const histNeeded = $history.scrollHeight + 16; // padding
  return Math.round(gripH + inputH + histNeeded);
}

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
  ipcRenderer.send('athena:set-chat-height', { height: h, manual: true });
});
window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  manualOverride = true;
  document.body.style.cursor = '';
});

// ---------- TR / 캔버스 종류 라우팅 (목업) ----------
const CANVAS_PLAN = {
  stream: { label: '스트림', tool: 'search_news' },
  reader: { label: '리더', tool: 'download_document' },
  table: { label: '공통 테이블', tool: 'get_financial_statement' },
  // AT-ST-001/AT-ST-004 제어 캔버스 트리거 — 카드 자체는 canvas.js가 그린다
  // (00-통합-계획.md §4.1). tool 코드는 실제 TR/MCP 툴 이름이 아직 없어 이
  // 대화 창 진행 표시용으로만 쓰는 자리표시자다 — 발명, 리포트에 명시.
  accounts: { label: '계좌', tool: 'account_list' },
  mcp: { label: 'MCP 서버', tool: 'mcp_server_list' },
};

function pickCanvasTypes(text) {
  const t = text.trim();
  const picked = [];
  if (/뉴스|스트림|news/i.test(t)) picked.push('stream');
  if (/공시|리더|마크다운|reader/i.test(t)) picked.push('reader');
  if (/재무|표|테이블|table/i.test(t)) picked.push('table');
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
  const myToken = ++abortToken;
  manualOverride = false; // 새 턴 — 자동 성장 재개
  const types = pickCanvasTypes(text);

  const qLine = document.createElement('div');
  qLine.className = 'turn';
  qLine.innerHTML = ''; // 콘텐츠는 아래서 textContent로만 채운다
  const qText = document.createElement('div');
  qText.className = 'turn-q';
  qText.textContent = text;
  qLine.appendChild(qText);
  $history.appendChild(qLine);
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
    code.textContent = CANVAS_PLAN[type].tool;
    progTrs.appendChild(code);
    trEls[type] = code;
  }

  let done = 0;
  let opened = false;
  for (const type of types) {
    progText.textContent = `${CANVAS_PLAN[type].tool} 불러오는 중 · ${done}/${types.length}`;
    setLocked(true, `${CANVAS_PLAN[type].tool} 불러오는 중 · ${done}/${types.length}`);
    await wait(500);
    if (myToken !== abortToken) return;

    // athena__render_canvas 호출 인터페이스 — 나중에 실제 MCP 툴 호출로 대체될 자리.
    await ipcRenderer.invoke('athena__render_canvas', { type, mock: true, expand: !opened });
    opened = true;

    trEls[type].classList.add('done');
    done += 1;
    progText.textContent = `${CANVAS_PLAN[type].tool} 완료 · ${done}/${types.length}`;
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
    chip.textContent = CANVAS_PLAN[type].label;
    chip.addEventListener('click', () => ipcRenderer.send('athena:highlight-canvas', type));
    meta.appendChild(chip);
  }
  const trace = document.createElement('span');
  trace.textContent = types.map((t) => CANVAS_PLAN[t].tool).join(' · ') + ` · ${((types.length * 0.5) + 0.55).toFixed(1)}s`;
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
  const labels = types.map((t) => CANVAS_PLAN[t].label).join(', ');
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
  ipcRenderer.send('athena:set-chat-height', { height: layout.chatMaxH, manual: false });
  settingsCards.renderAccounts($settingsGrid);
  settingsCards.renderMcp($settingsGrid);
}

function closeSettings() {
  if (!settingsOpen) return;
  settingsOpen = false;
  $settingsGrid.replaceChildren();
  $settings.hidden = true;
  $app.hidden = false;
  manualOverride = false;
  ipcRenderer.send('athena:set-chat-height', { height: layout.chatBaseH, manual: false });
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
    runQuery(text);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // 설정 모드가 떠 있으면 그것부터 닫는다 — 지금 눈앞에 있는 것이 먼저다.
    if (settingsOpen) {
      closeSettings();
      return;
    }
    if (state !== 'idle') {
      abortToken++; // 중단
      state = 'idle';
      setDot(null);
      setLocked(false);
      if (liveProgressEl) { liveProgressEl.remove(); liveProgressEl = null; }
      scheduleHeightSync();
    } else {
      ipcRenderer.send('athena:collapse-canvas');
    }
  }
});
