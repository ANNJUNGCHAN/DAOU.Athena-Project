// 대화 창 렌더러. nodeIntegration:true / contextIsolation:false — spike/electron-glass 패턴 그대로.
const { ipcRenderer } = require('electron');

const $boot = document.getElementById('boot');
const $gaugeFill = document.getElementById('gaugeFill');
const $app = document.getElementById('app');
const $history = document.getElementById('history');
const $input = document.getElementById('input');
const $dot = document.getElementById('dot');
const $lockHint = document.getElementById('lockHint');
const $lockText = document.getElementById('lockText');
const $grip = document.getElementById('grip');

let layout = { chatBaseH: 204, chatMaxH: 788, scale: 1 };
let manualOverride = false;
let currentHeight = layout.chatBaseH;
let state = 'idle'; // idle | judging | calling | done(즉시 idle로 수렴)
let liveProgressEl = null;
let abortToken = 0;

// ---------- 부팅 게이지 ----------
window.addEventListener('DOMContentLoaded', () => {
  requestAnimationFrame(() => {
    $gaugeFill.style.width = '100%';
  });
  setTimeout(() => {
    $boot.style.transition = 'opacity 260ms ease';
    $boot.style.opacity = '0';
    setTimeout(() => {
      $boot.hidden = true;
      $app.hidden = false;
      $input.focus();
      scheduleHeightSync();
    }, 260);
  }, 1300);
});

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
};

function pickCanvasTypes(text) {
  const t = text.trim();
  const picked = [];
  if (/뉴스|스트림|news/i.test(t)) picked.push('stream');
  if (/공시|리더|마크다운|reader/i.test(t)) picked.push('reader');
  if (/재무|표|테이블|table/i.test(t)) picked.push('table');
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

// ---------- 입력 ----------
$input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && state === 'idle') {
    const text = $input.value.trim() || '보유 종목 수급 요약해줘';
    $input.value = '';
    runQuery(text);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
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
