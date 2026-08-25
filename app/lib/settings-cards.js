// IIFE 스코프 격리(2026-08-18 렌더러 격리) — <script> 태그는 top-level const/function을
// 문서 전체가 공유하는 하나의 스크립트 스코프에 넣는다(require()의 모듈별 격리와 다르다).
// el/sanitize 같은 흔한 이름이 파일 간에 충돌해 SyntaxError가 났다(실측, diag-isolation.js).
// CJS(require)는 이 IIFE 밖에서도 동일하게 동작한다 — Node의 모듈 래퍼가 이미 함수 스코프다.
(function () {

// UMD 헤드(2026-08-18 렌더러 격리) — ipcRenderer는 window.athena 다리로
// 대체한다(preload.js). ui-kit require는 node --test/<script> 태그 겸용.
const {
  el, row, statusDot, badge, arrowIcon, button, progressDots, labeledRow,
  sheet, secretMask, emptyState, errorNote, clear, removeCardAndMaybeCollapse,
} = (typeof module !== 'undefined' && module.exports) ? require('./ui-kit') : window.AthenaLib.UiKit;

// ---------------------------------------------------------------------------
// 로컬 프리미티브 — ui-kit.js에 없는 것만 여기서 만든다(오케스트레이터 지시:
// ui-kit.js는 다른 에이전트가 동시에 읽는 중이라 편집하지 않는다).
// ---------------------------------------------------------------------------

function pill(text, tone) {
  return el('span', `uk-pill tone-${tone || 'dim'}`, text);
}

// 44×24 토글. 브랜드색은 켜진 트랙 테두리에만 쓴다 — 배경 채움은 쓰지 않는다
// (화면당 유일 브랜드 요소 규칙은 버튼 쪽에서 지킨다).
function toggleSwitch(initial, onChange) {
  let on = !!initial;
  const t = el('button', `uk-toggle${on ? ' is-on' : ''}`);
  t.type = 'button';
  t.setAttribute('role', 'switch');
  t.setAttribute('aria-checked', String(on));
  t.appendChild(el('span', 'uk-toggle-thumb'));
  t.addEventListener('click', () => {
    on = !on;
    t.classList.toggle('is-on', on);
    t.setAttribute('aria-checked', String(on));
    onChange(on);
  });
  return t;
}

// 16×16 체크박스. disabled면 클릭 리스너 자체를 달지 않는다(64자 초과 툴).
function checkboxEl(initial, disabled, onChange) {
  let checked = !!initial;
  const c = el('button', `uk-check${checked ? ' is-checked' : ''}${disabled ? ' is-disabled' : ''}`, checked ? '✓' : (disabled ? '–' : ''));
  c.type = 'button';
  c.setAttribute('role', 'checkbox');
  c.setAttribute('aria-checked', String(checked));
  if (disabled) {
    c.disabled = true;
    return c;
  }
  c.addEventListener('click', () => {
    checked = !checked;
    c.classList.toggle('is-checked', checked);
    c.textContent = checked ? '✓' : '';
    c.setAttribute('aria-checked', String(checked));
    onChange(checked);
  });
  return c;
}

function spacer(widthPx) {
  const s = el('span', 'uk-spacer');
  s.style.flex = `0 0 ${widthPx}px`;
  return s;
}

// 카드가 다시 그려질 때마다(nav에서 재선택할 때마다) 이전 구독을 반드시 끊는다 —
// window.athena.on()의 반환값은 구독 해제 함수이고, 카드는 buildCardShell()이
// 기존 DOM만 지우고 리스너는 그대로 두므로 여기서 직접 관리하지 않으면 설정을
// 여닫을 때마다 athena:zoom-changed/athena:model-changed 리스너가 누적된다.
let unsubscribeScreenZoom = null;
let unsubscribeModelChanged = null;
let unsubscribeCliChangedForModel = null;


// disabledTitle이 있으면(계좌 목록의 "마지막 하나는 삭제 불가", AT-ST-001
// Desc 1.1) 클릭 리스너 없는 비활성 버튼만 돌려준다 — 64자 초과 툴 체크박스와
// 같은 패턴(checkboxEl 참고).
function deleteIconButton(onClick, disabledTitle) {
  const b = el('button', 'uk-row-delete', '×');
  b.type = 'button';
  b.setAttribute('aria-label', '삭제');
  if (disabledTitle) {
    b.disabled = true;
    b.title = disabledTitle;
    return b;
  }
  b.title = '삭제';
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

// probe 시트 닫기 경고(D8, 오케스트레이터 지시) — 2026-08-17 실사용 사고 재발
// 방지. probe만 하고 "선택 허용"을 누르지 않은 채 닫으면 로컬에서 고른 허용
// 상태가 반영되지 않고 사라지거나, 허용 툴이 0개인 채로 남아 이 서버의 툴이
// 하나도 재노출되지 않을 수 있다(dart-mcp에서 실제로 발생). 새 모달/새 창을
// 만들지 않고 이 시트가 이미 risks 경고에 쓰는 .uk-warnbox를 재사용해 시트
// 안에서 인라인으로 한 번 더 확인한다.
function closeWarnBar(message) {
  const bar = el('div', 'uk-warnbox uk-close-warn');
  bar.appendChild(el('span', 'uk-warnbox-icon', '!'));
  bar.appendChild(el('span', 'uk-warnbox-body', message));
  const btns = el('div', 'uk-close-warn-btns');
  const keepBtn = button('text', '계속 편집');
  const closeBtn = button('ghost', '그냥 닫기');
  closeBtn.classList.add('is-danger');
  btns.appendChild(keepBtn);
  btns.appendChild(closeBtn);
  bar.appendChild(btns);
  return { bar, keepBtn, closeBtn };
}

// 확인 버튼은 ghost + is-danger(경고색)다 — primary(브랜드색)를 쓰지 않는다.
// MCP 카드는 "+ 서버 등록"이 이미 화면 내 유일한 브랜드색 자리를 쓰고
// 있고(AT-ST-004 Desc 1.2), 계좌 카드도 같은 규칙으로 맞춘다. 클릭 핸들러는
// 호출자가 붙인다 — 여기서는 뼈대만 만든다.
function deleteConfirmBar(message) {
  const bar = el('div', 'uk-row-confirm');
  // 확인 바 위 어디를 눌러도(버튼이 아닌 여백 포함) 아래 행의 클릭 리스너
  // (계좌 전환 · MCP 상세 열기)로 새지 않게 막는다.
  bar.addEventListener('click', (e) => e.stopPropagation());
  bar.appendChild(el('span', 'uk-row-confirm-msg', message));
  bar.appendChild(el('span', 'uk-flex-spacer'));
  const cancelBtn = button('text', '취소');
  const confirmBtn = button('ghost', '삭제');
  confirmBtn.classList.add('is-danger');
  bar.appendChild(cancelBtn);
  bar.appendChild(confirmBtn);
  return { bar, cancelBtn, confirmBtn };
}


// 카드 헤더의 실제 액션(등록·스니펫 붙여넣기)과 경쟁하지 않게 구분선 뒤
// 조용한 자리에 둔다 — canvas.css의 .uk-card-close가 그 시각적 거리를 만든다.
function cardCloseButton(card) {
  const b = el('button', 'uk-card-close', '×');
  b.type = 'button';
  b.setAttribute('aria-label', '카드 닫기');
  b.title = '이 카드 닫기';
  b.addEventListener('click', () => removeCardAndMaybeCollapse(card));
  return b;
}

// ---------------------------------------------------------------------------
// 카드 셸 — canvas.js의 makeCard()와 같은 역할이지만 이 두 카드는 헤더 구성이
// (타이틀+카운트, 우측 액션 버튼) 달라 전용으로 만든다. .card 클래스는
// canvas.css가 정의한 그대로 재사용해 그리드 안에서 stream/reader/table과
// 동일하게 배치된다.
// ---------------------------------------------------------------------------

function buildCardShell(grid, type) {
  const existing = grid.querySelector(`.card.${type}`);
  if (existing) existing.remove();
  const card = el('div', `card ${type}`);
  const head = el('div', 'card-head');
  const body = el('div', 'card-body');
  card.appendChild(head);
  card.appendChild(body);
  grid.appendChild(card);
  return { card, head, body };
}

function missingHandlerCard(head, body, title, channel) {
  head.appendChild(el('span', 'uk-settings-name', title));
  body.appendChild(emptyState(`${title} 목록을 불러올 수 없다`, `${channel} 핸들러가 아직 없다 — 메인 프로세스 작업이 끝나면 자동으로 채워진다`));
}

// 시트는 카드 안 오버레이라 카드 자신의 높이(목록 행 수에 따라 달라짐)에
// 맞춰 잘릴 수 있다 — 목록이 짧을 때(계좌 1~2개) 시트 내용(주문 API 게이트,
// probe 표 등)이 카드보다 커서 잘리는 걸 막으려고 시트가 떠 있는 동안만
// .has-sheet로 카드 최소높이를 넉넉하게 키운다. 정지 상태(시트 없음)에는
// 다시 목록 크기 그대로 돌아간다 — README/soul.md §8의 "정지 상태에 잔여
// 흔적을 남기지 않는다" 원칙과 같은 이유.
function attachSheet(card, root) {
  card.classList.add('has-sheet');
  card.appendChild(root);
}
function detachSheet(card, root) {
  card.classList.remove('has-sheet');
  root.remove();
}


const NAV_ITEMS = [
  { key: 'screen', label: '화면' },
  { key: 'accounts', label: '계좌', countChannel: 'athena:account-list', countKey: 'accounts' },
  { key: 'mcp', label: 'MCP 서버', countChannel: 'athena:mcp-list', countKey: 'servers' },
  { key: 'model', label: '모델' },
  // 채팅→그래프 파이프라인 단계 5(.omc/plans/plan-chat-graph-pipeline.md §2(e)) —
  // 배치·전체 삭제는 카운트 배지가 없다(투자 성향은 "몇 개"로 셀 표가 아니다).
  { key: 'history', label: '성향・이력' },
];

async function refreshNavCount(item, badgeEl) {
  try {
    const data = await window.athena.invoke(item.countChannel);
    const list = (data && data[item.countKey]) || [];
    badgeEl.textContent = `${list.length}개`;
  } catch {
    badgeEl.textContent = '';
  }
}

// renderNav(nav, grid, { onSelect }) — onSelect(key, grid)가 실제 패널을 그린다
// (기존 renderScreen/renderAccounts/renderMcp 재사용 + 신규 renderModel, 호출자는
// chat.js openSettings). nav 자신은 어떤 카드도 모른다 — 그리는 책임은 호출자에게
// 넘긴다(관심사 분리, 계좌/MCP 카드 재작성 금지 지시와도 맞물린다).
function renderNav(nav, grid, { onSelect }) {
  clear(nav);
  nav.setAttribute('role', 'listbox');
  nav.setAttribute('aria-label', '설정 카테고리');

  const order = NAV_ITEMS.map((i) => i.key);
  const buttons = {};
  let focusedKey = order[0];

  function applyRovingTabindex() {
    for (const k of order) buttons[k].tabIndex = (k === focusedKey) ? 0 : -1;
  }

  function commitSelect(key) {
    focusedKey = key;
    for (const k of order) {
      const isSel = k === key;
      buttons[k].classList.toggle('is-selected', isSel);
      buttons[k].setAttribute('aria-selected', String(isSel));
    }
    applyRovingTabindex();
    const item = NAV_ITEMS.find((i) => i.key === key);
    if (item && item.countChannel && item._badgeEl) refreshNavCount(item, item._badgeEl);
    onSelect(key, grid);
  }

  function moveFocus(nextKey) {
    focusedKey = nextKey;
    applyRovingTabindex();
    buttons[nextKey].focus();
  }

  for (const item of NAV_ITEMS) {
    const b = el('button', 'settings-nav-item');
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', 'false');
    b.appendChild(el('span', 'settings-nav-label', item.label));
    if (item.countChannel) {
      const badgeEl = el('span', 'settings-nav-badge', '');
      item._badgeEl = badgeEl;
      b.appendChild(badgeEl);
      refreshNavCount(item, badgeEl);
    }
    b.addEventListener('click', () => commitSelect(item.key));
    b.addEventListener('keydown', (e) => {
      const i = order.indexOf(item.key);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveFocus(order[(i + 1) % order.length]);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveFocus(order[(i - 1 + order.length) % order.length]);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        commitSelect(item.key);
      }
    });
    buttons[item.key] = b;
    nav.appendChild(b);
  }

  applyRovingTabindex();
  commitSelect(order[0]);
}


function renderScreen(grid) {
  const { card, head, body } = buildCardShell(grid, 'screen');
  if (unsubscribeScreenZoom) { unsubscribeScreenZoom(); unsubscribeScreenZoom = null; }
  return refreshScreenCard(card, head, body);
}

async function refreshScreenCard(card, head, body) {
  let data;
  try {
    data = await window.athena.invoke('athena:settings:prefs:get');
  } catch (err) {
    clear(head);
    clear(body);
    missingHandlerCard(head, body, '화면', 'athena:settings:prefs:get');
    body.appendChild(errorNote(String((err && err.message) || err)));
    return;
  }
  clear(head);
  clear(body);

  head.appendChild(row('uk-settings-title', [
    el('span', 'uk-settings-name', '화면'),
  ]));
  const actions = row('uk-settings-actions', []);
  actions.appendChild(cardCloseButton(card));
  head.appendChild(actions);

  async function setPref(key, value) {
    try {
      await window.athena.invoke('athena:settings:prefs:set', { [key]: value });
    } catch { /* 핸들러 부재 — 로컬 토글 표시만 유지, 다음 새로고침에서 다시 기본값으로 보인다 */ }
  }

  const expandLabelCol = el('div');
  expandLabelCol.appendChild(el('div', 'uk-toggle-label', '질의하면 캔버스 창을 자동으로 연다'));
  expandLabelCol.appendChild(el('div', 'uk-toggle-sub', 'OFF면 캔버스 창을 손으로 열어야 한다'));
  const expandToggle = toggleSwitch(!!data.autoExpandCanvas, (next) => setPref('autoExpandCanvas', next));
  body.appendChild(row('uk-toggle-row', [expandLabelCol, expandToggle]));

  const growLabelCol = el('div');
  growLabelCol.appendChild(el('div', 'uk-toggle-label', '답변 길이에 따라 대화 창이 자란다'));
  growLabelCol.appendChild(el('div', 'uk-toggle-sub', 'OFF면 그립을 끌어야만 창이 커진다'));
  const growToggle = toggleSwitch(!!data.autoGrowChat, (next) => setPref('autoGrowChat', next));
  body.appendChild(row('uk-toggle-row', [growLabelCol, growToggle]));

  // ---- 글자 크기 5단계 (2026-08-19 사용자 지시 "글자가 너무 큼") ----
  // 값은 lib/main/prefs.js FONT_SIZES와 1:1 — tokens.css의 --text-* 토큰 세트를
  // 통째로 바꾼다. UI 배율(zoom)과 달리 텍스트만 커지고 창·여백은 그대로다.
  const FONT_SIZE_CHIPS = [
    { value: 'xs', label: '매우 작음' },
    { value: 'sm', label: '작음' },
    { value: 'md', label: '보통' },
    { value: 'lg', label: '큼' },
    { value: 'xl', label: '매우 큼' },
  ];
  const fontLabelCol = el('div');
  fontLabelCol.appendChild(el('div', 'uk-toggle-label', '글자 크기'));
  fontLabelCol.appendChild(el('div', 'uk-toggle-sub', '두 창의 모든 텍스트에 적용된다'));
  const fontChipRow = row('uk-chip-row', []);
  const currentFont = data.fontSize || 'md';
  const fontChips = [];
  for (const c of FONT_SIZE_CHIPS) {
    const b = button('ghost', c.label, {
      onClick: async () => {
        await setPref('fontSize', c.value);
        for (const { btn, value } of fontChips) btn.classList.toggle('is-pressed', value === c.value);
      },
    });
    b.classList.add('uk-chip');
    if (c.value === currentFont) b.classList.add('is-pressed');
    fontChips.push({ btn: b, value: c.value });
    fontChipRow.appendChild(b);
  }
  body.appendChild(row('uk-toggle-row', [fontLabelCol, fontChipRow]));

  // ---- 유리 투명도 5단 (2026-08-22 사용자 지시 — 애플 Liquid Glass 레퍼런스가
  // 투명도를 사용자 슬라이더로 준다 — 2026-08-24 리프 1.1.2에서 Paper 보드 07이
  // sheer·solid 2단을 더해 5단으로 늘렸다). 값은 lib/main/prefs.js GLASS_LEVELS와
  // 1:1이고 tokens.css의 --glass-* 사다리를 통째로 바꾼다. 글자 크기와 완전히 같은
  // 문법 — .uk-chip-row가 flex-wrap이라 칩 5개도 FONT_SIZE_CHIPS와 동일하게 줄바꿈된다.
  const GLASS_CHIPS = [
    { value: 'clear', label: '가장 투명' },
    { value: 'sheer', label: '투명' },
    { value: 'default', label: '중간' },
    { value: 'solid', label: '불투명' },
    { value: 'opaque', label: '가장 불투명' },
  ];
  const glassLabelCol = el('div');
  glassLabelCol.appendChild(el('div', 'uk-toggle-label', '유리 투명도'));
  glassLabelCol.appendChild(
    el('div', 'uk-toggle-sub', '두 창과 카드에 함께 적용된다 — 바탕이 복잡하면 불투명 쪽이 읽힌다'),
  );
  const glassChipRow = row('uk-chip-row', []);
  const currentGlass = data.glassLevel || 'default';
  const glassChips = [];
  for (const c of GLASS_CHIPS) {
    const b = button('ghost', c.label, {
      onClick: async () => {
        await setPref('glassLevel', c.value);
        for (const { btn, value } of glassChips) btn.classList.toggle('is-pressed', value === c.value);
      },
    });
    b.classList.add('uk-chip');
    if (c.value === currentGlass) b.classList.add('is-pressed');
    glassChips.push({ btn: b, value: c.value });
    glassChipRow.appendChild(b);
  }
  body.appendChild(row('uk-toggle-row', [glassLabelCol, glassChipRow]));

  // ---- UI 배율 — 기존 Ctrl+=/Ctrl+-/Ctrl+휠(chat.js)과 같은 채널을 버튼으로 노출 ----
  const zoomLabelCol = el('div');
  zoomLabelCol.appendChild(el('div', 'uk-toggle-label', 'UI 배율'));
  zoomLabelCol.appendChild(el('div', 'uk-toggle-sub', 'Ctrl+= / Ctrl+- / Ctrl+휠과 같은 조작이다'));
  const zoomControls = el('div', 'uk-zoom-controls');
  const zoomValue = el('span', 'uk-zoom-value uk-mono-faint', `${Math.round(window.athena.getZoomFactor() * 100)}%`);
  zoomControls.appendChild(button('ghost', '−', { onClick: () => window.athena.send('athena:zoom', { dir: 'out' }) }));
  zoomControls.appendChild(zoomValue);
  zoomControls.appendChild(button('ghost', '+', { onClick: () => window.athena.send('athena:zoom', { dir: 'in' }) }));
  zoomControls.appendChild(button('text', '재설정', { onClick: () => window.athena.send('athena:zoom', { dir: 'reset' }) }));
  body.appendChild(row('uk-toggle-row', [zoomLabelCol, zoomControls]));

  unsubscribeScreenZoom = window.athena.on('athena:zoom-changed', (payload) => {
    const z = (payload && typeof payload.zoom === 'number') ? payload.zoom : window.athena.getZoomFactor();
    zoomValue.textContent = `${Math.round(z * 100)}%`;
  });

  // ---- 창 배치 — 읽기 전용 안내. 주 경로는 Windows 네이티브 Win+방향키
  // (main.js WIN_ARROW_DIR가 before-input-event로 직접 처리), Ctrl+Alt+방향키는
  // 보조 경로이고 같은 의미론이다 — up=최대화 토글(□ 버튼과 동일), down=복원→최소화
  // (2026-08-18 정정, chat.js 키다운과 짝을 이룬다). ----
  const placeLabelCol = el('div');
  placeLabelCol.appendChild(el('div', 'uk-toggle-label', '창 배치'));
  placeLabelCol.appendChild(el('div', 'uk-toggle-sub', 'Win+←/→/↑/↓ — Windows 창 단축키 그대로 (좌/우 배치 · 최대화 · 최소화) · 보조: Ctrl+Alt+방향키'));
  body.appendChild(row('uk-toggle-row', [placeLabelCol]));

  const a11yWrap = el('div', 'uk-a11y-status');
  a11yWrap.appendChild(el('div', 'uk-field-label', '접근성 — 이 컴퓨터의 OS 설정을 따른다'));
  const A11Y_QUERIES = [
    { q: '(prefers-reduced-transparency: reduce)', label: '투명도 감소' },
    { q: '(prefers-contrast: more)', label: '고대비' },
    { q: '(prefers-reduced-motion: reduce)', label: '모션 감소' },
  ];
  for (const { q, label } of A11Y_QUERIES) {
    const on = window.matchMedia(q).matches;
    a11yWrap.appendChild(row('uk-a11y-row', [
      statusDot(on, `${label} ${on ? '켜짐' : '꺼짐'}`),
      el('span', 'uk-a11y-label', label),
      pill(on ? '켜짐' : '꺼짐', on ? 'ok' : 'dim'),
    ]));
  }
  body.appendChild(a11yWrap);
}

// =============================================================================
// 계좌 — AT-ST-001 (목록) · AT-ST-002 (등록 시트) · AT-ST-003 (주문 API 게이트)
// =============================================================================

function renderAccounts(grid) {
  const { card, head, body } = buildCardShell(grid, 'accounts');
  return refreshAccountsCard(card, head, body);
}

async function refreshAccountsCard(card, head, body) {
  const refresh = () => refreshAccountsCard(card, head, body);

  // 비우기를 **await 뒤로** 미룬다. 먼저 비우면 등록·활성화·삭제 때마다 카드가
  // 수백 ms 동안 완전히 빈 채로 남는다(실측) — 사용자에겐 카드가 깨진 것처럼
  // 보인다. 이전 내용을 그대로 둔 채 기다렸다가 한 번에 교체한다.
  let data;
  try {
    data = await window.athena.invoke('athena:account-list');
  } catch (err) {
    clear(head);
    clear(body);
    missingHandlerCard(head, body, '계좌', 'athena:account-list');
    body.appendChild(errorNote(String((err && err.message) || err)));
    return;
  }
  clear(head);
  clear(body);

  const accounts = (data && data.accounts) || [];

  head.appendChild(row('uk-settings-title', [
    el('span', 'uk-settings-name', '계좌'),
    el('span', 'uk-settings-count', `${accounts.length}개 등록`),
  ]));
  const acctActions = row('uk-settings-actions', []);
  acctActions.appendChild(button('ghost', '+ 계좌 등록', { onClick: () => openAccountRegisterSheet(card, refresh) }));
  acctActions.appendChild(cardCloseButton(card));
  head.appendChild(acctActions);

  if (!accounts.length) {
    body.appendChild(emptyState('등록된 계좌가 없다', '+ 계좌 등록으로 첫 모의투자 계좌를 연결한다'));
  } else {
    body.appendChild(buildAccountsTable(accounts, refresh, (account) => openOrderApiSheet(card, account, refresh)));
  }

  const note = el('div', 'uk-settings-note');
  note.appendChild(el('div', null, '앱키·시크릿은 목록에 표시되지 않는다. 저장 위치는 OS 자격증명 저장소다.'));
  note.appendChild(el('div', null, '비활성 계좌를 누르면 활성으로 전환된다. 활성 계좌는 항상 하나다.'));
  body.appendChild(note);
}

function acctStatusPill(a) {
  // AT-ST-001 Desc 3은 정상/검증 필요/실패 3종을 말하지만, 고정 IPC 계약
  // (athena:account-list)은 connected: bool 하나만 준다 — 3종 중 관측 가능한
  // 두 값(정상/검증 필요)만 이 bool로 표현한다. "실패"는 spec 자체도 색·문구가
  // 미정이라(Open Questions #4) 이 bool 계약으로는 별도 구분이 불가능하다.
  return a.connected ? pill('정상', 'ok') : pill('검증 필요', 'warn');
}

// canDelete === false는 "등록된 계좌가 이 하나뿐"이다(AT-ST-001 Desc 1.1
// "마지막 하나는 삭제 불가"). 백엔드(accounts.remove())는 이 규칙을 강제하지
// 않으므로 — 강제할 수 있는 유일한 자리인 UI에서 막는다.
function buildAccountRow(a, refresh, openOrderApi, canDelete) {
  const aliasCell = row('uk-col-alias', [
    el('span', 'uk-cell-strong', a.alias),
    badge(!!a.active, a.active ? '활성' : '비활성'),
  ]);

  const appkeyCell = el('div', 'uk-col-appkey');
  appkeyCell.appendChild(secretMask(a.appKeyChars));

  const orderApiChip = pill(a.orderApi ? 'ON' : 'OFF', a.orderApi ? 'brand' : 'dim');
  orderApiChip.classList.add('is-clickable');
  orderApiChip.title = '눌러서 주문 API 게이트 열기';
  orderApiChip.addEventListener('click', (e) => {
    e.stopPropagation();
    openOrderApi(a);
  });
  const orderApiCell = el('div', 'uk-col-orderapi');
  orderApiCell.appendChild(orderApiChip);

  const statusCell = el('div', 'uk-col-status');
  statusCell.appendChild(acctStatusPill(a));

  // 마지막 검증 시각 — 고정 IPC 계약에 필드 자체가 없다(스펙은 원했지만
  // athena:account-list 응답 모양에 없음). 항상 "—"로만 표시한다.
  const lastCheckCell = el('span', 'uk-col-lastcheck uk-mono-faint', '—');

  const actionsCell = el('div', 'uk-col-actions');
  actionsCell.addEventListener('click', (e) => e.stopPropagation());

  const normalCells = [aliasCell, appkeyCell, orderApiCell, statusCell, lastCheckCell, actionsCell];
  const r = row('uk-row', normalCells);
  if (!a.active) {
    r.classList.add('is-clickable');
    r.addEventListener('click', async () => {
      try {
        await window.athena.invoke('athena:account-set-active', { id: a.id });
      } catch { /* 핸들러 부재 — 조용히 무시하지 않되 카드 전체를 깨뜨리지 않는다 */ }
      refresh();
    });
  }

  actionsCell.appendChild(deleteIconButton(
    () => {
      clear(r);
      const { bar, cancelBtn, confirmBtn } = deleteConfirmBar(
        `'${a.alias}' 계좌를 삭제할까요? 앱키·시크릿도 함께 삭제된다`,
      );
      cancelBtn.addEventListener('click', () => {
        clear(r);
        for (const c of normalCells) r.appendChild(c);
      });
      confirmBtn.addEventListener('click', async () => {
        cancelBtn.disabled = true;
        confirmBtn.disabled = true;
        confirmBtn.querySelector('.uk-btn-label').textContent = '삭제 중…';
        let threw = false;
        try {
          await window.athena.invoke('athena:account-remove', { id: a.id });
        } catch { threw = true; }
        if (threw) {
          bar.appendChild(errorNote('계좌 삭제 기능을 아직 사용할 수 없다 (athena:account-remove 핸들러 없음)'));
          cancelBtn.disabled = false;
          confirmBtn.disabled = false;
          confirmBtn.querySelector('.uk-btn-label').textContent = '삭제';
          return;
        }
        refresh();
      });
      r.appendChild(bar);
    },
    canDelete ? null : '마지막 계좌는 삭제할 수 없다',
  ));

  return r;
}

function buildAccountsTable(accounts, refresh, openOrderApi) {
  const wrap = el('div');
  wrap.appendChild(row('uk-col-head', [
    el('span', 'uk-col-alias', '별칭'),
    el('span', 'uk-col-appkey', '앱키'),
    el('span', 'uk-col-orderapi', '주문 API'),
    el('span', 'uk-col-status', '연결 상태'),
    el('span', 'uk-col-lastcheck', '마지막 검증'),
    el('span', 'uk-col-actions', ''),
  ]));

  const canDelete = accounts.length > 1;
  for (const a of accounts) {
    wrap.appendChild(buildAccountRow(a, refresh, openOrderApi, canDelete));
  }
  return wrap;
}

function accountErrorMessage(code) {
  if (code === 'auth') return '인증 실패 — APP KEY/SECRET KEY를 확인한다';
  if (code === 'network') return '네트워크 오류 — 잠시 후 다시 시도한다';
  if (code === 'ratelimit') return '레이트리밋 초과 — 잠시 후 다시 시도한다';
  if (code === 'invalid') return '입력값을 확인한다';
  return '검증에 실패해 저장하지 않았다';
}

// ---- AT-ST-002: 계좌 등록 시트 ----
function openAccountRegisterSheet(card, onDone) {
  const { root, body } = sheet('계좌 등록', {
    subtitle: '모의투자 계좌의 APP KEY / SECRET KEY를 등록한다',
    onClose: () => detachSheet(card, root),
  });

  const cols = el('div', 'uk-two-col');
  const left = el('div', 'uk-field-col');

  const aliasGroup = el('div', 'uk-field-group');
  aliasGroup.appendChild(el('label', 'uk-field-label', '별칭'));
  const aliasInput = document.createElement('input');
  aliasInput.type = 'text';
  aliasInput.className = 'uk-input';
  aliasInput.placeholder = '모의-주력';
  aliasInput.autocomplete = 'off';
  aliasGroup.appendChild(aliasInput);
  aliasGroup.appendChild(el('div', 'uk-field-hint-static', '이 컴퓨터에서만 쓰는 이름이다'));
  left.appendChild(aliasGroup);

  function secretField(labelText) {
    const g = el('div', 'uk-field-group');
    const labelRow = el('div', 'uk-field-row');
    labelRow.appendChild(el('span', 'uk-field-label', labelText));
    const hint = el('span', 'uk-field-hint', '');
    labelRow.appendChild(hint);
    g.appendChild(labelRow);

    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'uk-input uk-input-mono';
    input.autocomplete = 'off';
    input.spellcheck = false;
    // Desc 2: "password 입력 — 붙여넣기만 허용한다 · 자동완성·맞춤법 검사는
    // 끈다." 타이핑을 막고 붙여넣기·삭제·이동 키만 통과시킨다.
    input.addEventListener('keydown', (e) => {
      const allowedKeys = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
      const isPaste = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v';
      const isSelectAll = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a';
      if (!allowedKeys.includes(e.key) && !isPaste && !isSelectAll) e.preventDefault();
    });
    // Desc 2.1: 문자 수 표시는 "붙여넣기 오류만 잡는 용도" — 값 자체는 여기서
    // 바깥 변수로 새 나가지 않는다. input.value는 매 이벤트마다 즉시 읽고 버린다.
    input.addEventListener('input', () => {
      hint.textContent = input.value.length ? `붙여넣음 · ${input.value.length}자` : '';
    });
    g.appendChild(input);
    return { group: g, input, hint };
  }

  const appKeyField = secretField('APP KEY');
  const secretKeyField = secretField('SECRET KEY');
  left.appendChild(appKeyField.group);
  left.appendChild(secretKeyField.group);

  const right = el('div', 'uk-principles');
  right.appendChild(el('div', 'uk-settings-name', '저장·표시 원칙'));
  const bullets = [
    'OS 자격증명 저장소(Windows DPAPI)에 암호화 저장한다',
    '저장 후에는 화면에 다시 표시하지 않는다',
    '앱 로그에도 남기지 않는다',
    '폐기는 삭제 한 번으로 끝난다',
  ];
  const bulletList = el('div', 'uk-bullets');
  for (const b of bullets) {
    bulletList.appendChild(row('uk-bullet-item', [el('span', 'uk-bullet-dot'), el('span', 'uk-bullet-text', b)]));
  }
  right.appendChild(bulletList);

  cols.appendChild(left);
  cols.appendChild(right);
  body.appendChild(cols);

  const statusRow = el('div', 'uk-status-row');
  const statusDotEl = el('span', 'uk-status-dot');
  const statusText = el('span', 'uk-status-text', '');
  statusRow.appendChild(statusDotEl);
  statusRow.appendChild(statusText);
  body.appendChild(statusRow);
  body.appendChild(el('div', 'uk-field-hint-static', '검증에 실패하면 저장하지 않는다 — 인증 실패 / 네트워크 / 레이트리밋을 구분해 표시한다'));

  const errBox = el('div');
  body.appendChild(errBox);

  const btnRow = row('uk-btn-row-end', []);
  const cancelBtn = button('ghost', '취소', {
    onClick: () => {
      wipeSecretInputs();
      detachSheet(card, root);
    },
  });
  const submitBtn = button('primary', '검증 후 저장', { onClick: onSubmit });
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(submitBtn);
  body.appendChild(btnRow);

  function wipeSecretInputs() {
    aliasInput.value = '';
    appKeyField.input.value = '';
    secretKeyField.input.value = '';
    appKeyField.hint.textContent = '';
    secretKeyField.hint.textContent = '';
  }

  async function onSubmit() {
    // 값은 여기서만 읽고, invoke 인자로 넘긴 직후 즉시 입력 요소를 비운다 —
    // 바깥 스코프 변수(alias/appKey/secretKey)는 이 함수 실행이 끝나면 더 이상
    // 참조되지 않는다(재렌더·재표시 없음).
    const alias = aliasInput.value.trim();
    const appKey = appKeyField.input.value;
    const secretKey = secretKeyField.input.value;

    clear(errBox);
    statusDotEl.className = 'uk-status-dot is-busy';
    statusText.textContent = '토큰 발급 확인 중…';
    submitBtn.disabled = true;

    let res;
    let threw = false;
    try {
      res = await window.athena.invoke('athena:account-register', { alias, appKey, secretKey });
    } catch (err) {
      threw = true;
    }

    wipeSecretInputs();
    submitBtn.disabled = false;
    statusDotEl.className = 'uk-status-dot';
    statusText.textContent = '';

    if (threw) {
      errBox.appendChild(errorNote('계좌 등록 기능을 아직 사용할 수 없다 (athena:account-register 핸들러 없음)'));
      return;
    }
    if (res && res.ok) {
      detachSheet(card, root);
      onDone();
      return;
    }
    errBox.appendChild(errorNote(accountErrorMessage(res && res.error)));
  }

  attachSheet(card, root);
  aliasInput.focus();
}

// ---- AT-ST-003: 주문 API 활성화 게이트 시트 ----
function openOrderApiSheet(card, account, onDone) {
  const { root, body, head } = sheet('주문 API 활성화', {
    subtitle: account.alias,
    onClose: () => detachSheet(card, root),
  });
  const closeBtn = head.querySelector('.uk-sheet-close');
  const statusPill = pill(account.orderApi ? '현재 ON' : '현재 OFF', 'dim');
  head.insertBefore(statusPill, closeBtn || null);

  // 열리는 것 · 열리지 않는 것
  const split = el('div', 'uk-split');
  const openCol = el('div', 'uk-split-col');
  openCol.appendChild(row('uk-split-head', [el('span', 'uk-dot-warn'), el('span', null, '열리는 것 · 12건 · 모의 계좌 대상')]));
  const trRows = [
    ['kt10000~10003', '국내주식', '매수 · 매도 · 정정 · 취소'],
    ['kt10006~10009', '신용주문', '매수 · 매도 · 정정 · 취소'],
    ['kt50000~50003', '금현물', '매수 · 매도 · 정정 · 취소'],
  ];
  for (const [code, name, actions] of trRows) {
    openCol.appendChild(row('uk-tr-row', [
      el('span', 'uk-tr-code', code),
      el('span', 'uk-tr-name', name),
      el('span', 'uk-tr-actions', actions),
    ]));
  }
  openCol.appendChild(el('div', 'uk-tr-foot', '3계열 × 4동작 = 12건 — 신용주문 포함'));

  const closedCol = el('div', 'uk-split-col');
  closedCol.appendChild(el('div', 'uk-split-head', '열리지 않는 것'));
  const closedItems = [
    ['자동 매매 없음', '모든 주문은 대화 창에서 사용자가 직접 지시해야 실행된다'],
    ['AI 단독 실행 없음', '제안은 AI가 하고, 실행 지시는 항상 사용자가 한다'],
    ['실거래 계좌 접근 없음', '이 API는 모의 계좌 밖으로 나가지 않는다'],
  ];
  for (const [t, d] of closedItems) {
    closedCol.appendChild(row('uk-closed-item', [
      el('div', 'uk-closed-title', t),
      el('div', 'uk-closed-desc', d),
    ]));
  }
  split.appendChild(openCol);
  split.appendChild(closedCol);
  body.appendChild(split);

  // 토글 행
  let toggleState = !!account.orderApi;
  const toggleLabelCol = el('div');
  toggleLabelCol.appendChild(el('div', 'uk-toggle-label', 'AI가 이 계좌의 주문 API를 호출하도록 허용'));
  toggleLabelCol.appendChild(el('div', 'uk-toggle-sub', 'OFF일 때는 어떤 주문 요청도 실행되지 않는다'));
  const toggleEl = toggleSwitch(toggleState, async (next) => {
    toggleState = next;
    // Desc 5 "되돌리기": 이미 켜진 상태에서 끄는 것은 즉시·무확인으로 반영한다.
    // 켜는 것은 아래 "활성화" 버튼의 최종 확인을 반드시 거친다(Desc 2).
    if (!next && account.orderApi) {
      try {
        const res = await window.athena.invoke('athena:order-api-set', { id: account.id, enabled: false });
        if (res && res.ok) {
          account.orderApi = false;
          statusPill.textContent = '현재 OFF';
        }
      } catch { /* 핸들러 부재 — 로컬 토글 표시만 유지 */ }
    }
    renderChecklist();
  });
  body.appendChild(row('uk-toggle-row', [toggleLabelCol, toggleEl]));

  const checklistWrap = el('div', 'uk-checklist');
  body.appendChild(checklistWrap);
  function renderChecklist(list) {
    clear(checklistWrap);
    const items = list || [
      { key: 'orderApi', label: '주문 API 허용 (토글)', met: toggleState },
      { key: 'token', label: '로컬 인증 토큰 설정', met: account.tokenState === 'ready' },
    ];
    for (const it of items) {
      const metLabel = it.key === 'token' ? (it.met ? '설정됨' : '미설정') : (it.met ? 'ON' : 'OFF');
      checklistWrap.appendChild(row('uk-checklist-row', [
        row('uk-checklist-label', [el('span', 'uk-dot-dim'), el('span', null, it.label)]),
        pill(metLabel, it.met ? 'ok' : 'dim'),
      ]));
    }
  }
  renderChecklist();

  const errBox = el('div');
  body.appendChild(errBox);

  const btnRow = row('uk-btn-row-end', []);
  btnRow.appendChild(button('ghost', '취소', { onClick: () => detachSheet(card, root) }));
  const activateBtn = button('primary', '활성화', { onClick: onActivate });
  btnRow.appendChild(activateBtn);
  body.appendChild(btnRow);

  body.appendChild(el('div', 'uk-revert-note', '언제든 설정에서 OFF로 되돌릴 수 있다. 되돌리면 즉시 반영된다.'));

  async function onActivate() {
    clear(errBox);
    activateBtn.disabled = true;
    try {
      const res = await window.athena.invoke('athena:order-api-set', { id: account.id, enabled: toggleState });
      if (res && res.checklist) renderChecklist(res.checklist);
      if (res && res.ok) {
        account.orderApi = toggleState;
        detachSheet(card, root);
        onDone();
        return;
      }
      if (res && res.error) errBox.appendChild(errorNote(res.error));
    } catch (err) {
      errBox.appendChild(errorNote('주문 API 게이트를 아직 사용할 수 없다 (athena:order-api-set 핸들러 없음)'));
    } finally {
      activateBtn.disabled = false;
    }
  }

  attachSheet(card, root);
}

// =============================================================================
// MCP — AT-ST-004 (목록) · AT-ST-005 (등록·승인 시트) · AT-ST-006 (probe·툴 허용 시트)
// =============================================================================

function renderMcp(grid) {
  const { card, head, body } = buildCardShell(grid, 'mcp');
  return refreshMcpCard(card, head, body);
}

async function refreshMcpCard(card, head, body) {
  const refresh = () => refreshMcpCard(card, head, body);

  // 계좌 카드와 같은 이유로 비우기를 await 뒤로 미룬다 — 여기는 Python CLI를
  // 콜드 스폰하므로 공백 구간이 더 길다(실측 ~850ms).
  let data;
  try {
    data = await window.athena.invoke('athena:mcp-list');
  } catch (err) {
    clear(head);
    clear(body);
    missingHandlerCard(head, body, 'MCP 서버', 'athena:mcp-list');
    body.appendChild(errorNote(String((err && err.message) || err)));
    return;
  }
  clear(head);
  clear(body);

  const servers = (data && data.servers) || [];
  // "n개 연결됨" — approved && health가 연결 실패류가 아닌 서버 수. health의
  // 정확한 값 집합은 고정 IPC 계약에 열거돼 있지 않아 방어적으로 판정한다.
  const connectedCount = servers.filter((s) => s.approved && !isFailedHealth(s.health)).length;
  const toolTotal = servers.reduce((sum, s) => sum + (Number(s.toolCount) || 0), 0);

  head.appendChild(row('uk-settings-title', [
    el('span', 'uk-settings-name', 'MCP 서버'),
    el('span', 'uk-settings-count', `${servers.length}개 등록 · ${connectedCount}개 연결됨 · ${toolTotal}개 툴 노출`),
  ]));
  const actions = row('uk-settings-actions', []);
  actions.appendChild(button('text', '스니펫 붙여넣기', { onClick: () => openMcpRegisterSheet(card, refresh) }));
  actions.appendChild(button('primary', '+ 서버 등록', { onClick: () => openMcpRegisterSheet(card, refresh) }));
  actions.appendChild(cardCloseButton(card));
  head.appendChild(actions);

  if (!servers.length) {
    body.appendChild(emptyState('등록된 MCP 서버가 없다', '스니펫 붙여넣기 또는 + 서버 등록으로 시작한다'));
  } else {
    body.appendChild(buildMcpTable(servers, refresh, (alias) => openMcpProbeSheet(card, alias, refresh)));
  }
  body.appendChild(el('div', 'uk-settings-note', '행을 누르면 상세 · 툴 목록 · 감사 로그가 열린다. 실행 명령은 자르지 않고 전문을 표시한다.'));
}

function isFailedHealth(health) {
  const h = String(health || '').toLowerCase();
  return h === 'error' || h === 'failed' || h === 'disconnected';
}

function isOkHealth(health) {
  const h = String(health || '').toLowerCase();
  return h === 'ok' || h === 'connected' || h === 'healthy';
}

function mcpStatusPill(s) {
  if (!s.approved) return pill('승인 대기', 'dim');
  if (isFailedHealth(s.health)) return pill('연결 실패', 'warn');
  if (isOkHealth(s.health)) return pill('연결됨', 'ok');
  return pill('상태 미확인', 'dim');
}

function buildMcpTable(servers, refresh, onRowClick) {
  const wrap = el('div');
  wrap.appendChild(row('uk-col-head', [
    el('span', 'uk-col-mcpalias', '별칭'),
    el('span', 'uk-col-mcpstatus', '상태'),
    el('span', 'uk-col-mcptools', '허용 툴'),
    el('span', 'uk-col-mcpcmd', '실행 명령'),
    el('span', 'uk-col-actions', ''),
  ]));

  for (const s of servers) {
    const aliasCell = el('div', 'uk-col-mcpalias');
    aliasCell.appendChild(el('div', 'uk-cell-strong', s.alias));
    if (Array.isArray(s.warnings)) {
      for (const w of s.warnings) aliasCell.appendChild(el('div', 'uk-mcp-warning', `⚠ ${w}`));
    }

    const statusCell = el('div', 'uk-col-mcpstatus');
    statusCell.appendChild(mcpStatusPill(s));

    // toolCount는 consent.json의 approved_tools 수다(lib/main/mcp-cli.js). 승인까지
    // 마쳤는데 0개면 게이트웨이가 이 서버의 툴을 하나도 재노출하지 않는 상태 —
    // probe 시트에서 "선택 허용"을 안 누르면 이렇게 되는데, 흐린 숫자로는 안 보인다
    // (2026-08-17 dart-mcp 실사용에서 실제로 조용히 삼켜진 사례).
    const toolsCell = el('div', 'uk-col-mcptools uk-mono-faint');
    if (s.approved && Number(s.toolCount) === 0) {
      toolsCell.appendChild(pill('0개 — 노출 안 됨', 'warn'));
    } else {
      toolsCell.textContent = s.toolCount != null ? `${s.toolCount}개` : '—';
    }

    // "자르지 않는다" (AT-ST-004 Desc 3) — CSS에 텍스트 말줄임(ellipsis)을
    // 적용하지 않고 그대로 줄바꿈되도록 둔다. command/argsPreview는 main
    // 프로세스가 채워주는 그대로다.
    const cmdText = [s.command, s.argsPreview].filter(Boolean).join(' ');
    const cmdCell = el('div', 'uk-col-mcpcmd uk-cmd', cmdText);

    const actionsCell = el('div', 'uk-col-actions');
    actionsCell.addEventListener('click', (e) => e.stopPropagation());

    const normalCells = [aliasCell, statusCell, toolsCell, cmdCell, actionsCell];
    const r = row('uk-row is-clickable', normalCells);
    r.addEventListener('click', () => onRowClick(s.alias));

    actionsCell.appendChild(deleteIconButton(() => {
      clear(r);
      r.classList.remove('is-clickable');
      const { bar, cancelBtn, confirmBtn } = deleteConfirmBar(`'${s.alias}' 서버를 삭제할까요?`);
      cancelBtn.addEventListener('click', () => {
        clear(r);
        r.classList.add('is-clickable');
        for (const c of normalCells) r.appendChild(c);
      });
      confirmBtn.addEventListener('click', async () => {
        cancelBtn.disabled = true;
        confirmBtn.disabled = true;
        confirmBtn.querySelector('.uk-btn-label').textContent = '삭제 중…';
        let res;
        let threw = false;
        try {
          res = await window.athena.invoke('athena:mcp-remove', { alias: s.alias });
        } catch { threw = true; }
        if (threw || !(res && res.ok)) {
          bar.appendChild(errorNote(threw ? 'MCP 서버 삭제 기능을 아직 사용할 수 없다 (athena:mcp-remove 핸들러 없음)' : '삭제에 실패했다'));
          cancelBtn.disabled = false;
          confirmBtn.disabled = false;
          confirmBtn.querySelector('.uk-btn-label').textContent = '삭제';
          return;
        }
        refresh();
      });
      r.appendChild(bar);
    }));

    wrap.appendChild(r);
  }
  return wrap;
}

// ---- AT-ST-005: MCP 등록 — 스니펫 · 승인 시트 ----
// 카드 1(스니펫 붙여넣기·별칭 정규화)과 카드 2(동의 게이트·승인)를 한 시트
// 안에서 순서대로 보여준다. 카드 2는 스니펫에서 감지된 서버를 "한 번에 하나씩"
// 심사한다(승인/거부 버튼이 스펙상 화면 내 유일한 브랜드색 요소이므로, staged
// 서버가 여럿이어도 동시에 여러 개의 브랜드색 "승인" 버튼을 띄우지 않는다).
function openMcpRegisterSheet(card, onDone) {
  const { root, body } = sheet('MCP 서버 등록', {
    subtitle: '클로드 데스크탑 설정 블록을 그대로 붙여넣는다',
    onClose: () => detachSheet(card, root),
  });

  const pasteGroup = el('div', 'uk-field-group');
  pasteGroup.appendChild(el('label', 'uk-field-label', 'claude_desktop_config.json'));
  const textarea = document.createElement('textarea');
  textarea.className = 'uk-textarea';
  textarea.placeholder = '{ "mcpServers": { ... } }';
  textarea.spellcheck = false;
  pasteGroup.appendChild(textarea);
  const analyzeRow = row('uk-btn-row-end', []);
  const analyzeBtn = button('ghost', '분석', { onClick: onAnalyze });
  analyzeRow.appendChild(analyzeBtn);
  pasteGroup.appendChild(analyzeRow);
  body.appendChild(pasteGroup);

  const analyzeErrBox = el('div');
  body.appendChild(analyzeErrBox);

  const stagedInfoWrap = el('div');
  body.appendChild(stagedInfoWrap);

  const gateWrap = el('div');
  body.appendChild(gateWrap);

  let stagedList = [];
  let queueIndex = 0;

  async function onAnalyze() {
    // 스니펫 원문은 여기서만 읽는다. 분석 성공 이후 이 textarea.value를 다시
    // 읽어 어딘가에 재현하지 않는다 — env 값이 원문 JSON에 섞여 있을 수 있다
    // (AT-ST-007 비밀값 원칙). 분석 결과 화면에는 envKeys(키 이름만)·risks만
    // 그린다.
    const snippet = textarea.value;
    clear(analyzeErrBox);
    // 분석은 Python CLI를 콜드 스폰하므로 실측 ~850ms가 걸린다. 버튼을
    // 비활성만 시키면 그 1초 가까운 시간 동안 아무 신호가 없어 눌리지 않은
    // 것처럼 보인다 — 계좌 등록 쪽이 이미 "토큰 발급 확인 중…"으로 하는 것과
    // 같은 처리를 한다.
    const analyzeLabel = analyzeBtn.querySelector('.uk-btn-label');
    const analyzeIdleText = analyzeLabel ? analyzeLabel.textContent : '';
    if (analyzeLabel) analyzeLabel.textContent = '분석 중…';
    analyzeBtn.disabled = true;
    try {
      const res = await window.athena.invoke('athena:mcp-stage-snippet', { snippet });
      if (res && res.ok) {
        stagedList = res.staged || [];
        queueIndex = 0;
        renderStagedInfo();
        renderGate();
      } else {
        analyzeErrBox.appendChild(errorNote((res && res.error) || '스니펫을 분석할 수 없다'));
      }
    } catch (err) {
      analyzeErrBox.appendChild(errorNote('스니펫 분석 기능을 아직 사용할 수 없다 (athena:mcp-stage-snippet 핸들러 없음)'));
    } finally {
      if (analyzeLabel) analyzeLabel.textContent = analyzeIdleText;
      analyzeBtn.disabled = false;
    }
  }

  function renderStagedInfo() {
    clear(stagedInfoWrap);
    if (!stagedList.length) return;
    stagedInfoWrap.appendChild(row('uk-settings-title', [
      el('span', 'uk-settings-name', '별칭 정규화'),
      el('span', 'uk-settings-count', `감지됨 · 서버 ${stagedList.length}개 · 원본 → 제안 · 확정은 사용자가 한다`),
    ]));
    const listBox = el('div', 'uk-alias-list');
    for (const s of stagedList) {
      listBox.appendChild(row('uk-alias-row', [
        el('span', 'uk-cmd', s.originalName),
        el('span', 'uk-alias-arrow', '→'),
        el('span', 'uk-staged-alias', s.alias),
      ]));
    }
    stagedInfoWrap.appendChild(listBox);
  }

  function renderGate() {
    clear(gateWrap);
    if (queueIndex >= stagedList.length) {
      if (stagedList.length) {
        detachSheet(card, root);
        onDone();
      }
      return;
    }
    const current = stagedList[queueIndex];
    const gateHead = row('uk-settings-title', [
      el('span', 'uk-settings-name', 'MCP 서버 시작 승인'),
      pill('대기 중', 'dim'),
    ]);
    gateWrap.appendChild(gateHead);

    gateWrap.appendChild(el('div', 'uk-field-hint-static', '대상 서버 · 좌측에서 확정된 별칭'));
    gateWrap.appendChild(row('uk-gate-target', [
      el('span', 'uk-staged-alias', current.alias),
      pill('stdio', 'dim'),
    ]));

    gateWrap.appendChild(el('div', 'uk-field-label', '실행 명령 전문 · 자르지 않는다'));
    const cmdText = [current.command, ...(current.args || [])].join(' ');
    gateWrap.appendChild(el('div', 'uk-cmd uk-cmd-box', cmdText));

    if (current.envKeys && current.envKeys.length) {
      const envHead = el('div', 'uk-field-row');
      envHead.appendChild(el('span', 'uk-field-label', '환경변수'));
      envHead.appendChild(el('span', 'uk-field-hint-static', '키 이름만 · 값은 표시하지 않는다'));
      gateWrap.appendChild(envHead);
      gateWrap.appendChild(row('uk-pill-list', current.envKeys.map((k) => pill(k, 'dim'))));
    }

    if (current.risks && current.risks.length) {
      for (const riskText of current.risks) {
        const wb = el('div', 'uk-warnbox');
        wb.appendChild(el('span', 'uk-warnbox-icon', '!'));
        wb.appendChild(el('span', 'uk-warnbox-body', riskText));
        gateWrap.appendChild(wb);
      }
    }

    gateWrap.appendChild(el('div', 'uk-field-hint-static', '승인 전에는 프로세스가 뜨지 않는다. 승인은 서버 시작까지만이고, 툴 호출은 별도로 확인한다.'));

    const gateErrBox = el('div');
    gateWrap.appendChild(gateErrBox);

    const btnRow = row('uk-btn-row-end', []);
    btnRow.appendChild(button('ghost', '거부', {
      onClick: () => {
        // 거부 = 이 스니펫에서 대기 중인 이 서버를 건너뛴다. 아직 등록조차
        // 하지 않았으므로 되돌릴 백엔드 상태가 없다(mcp-register를 아직 호출
        // 안 함) — consent.py에 "대기 중 요청 거절" 전용 동작이 없다는 스펙의
        // 갭(AT-ST-005 Open Questions #6)을 이렇게 피해간다.
        queueIndex += 1;
        renderGate();
      },
    }));
    btnRow.appendChild(button('primary', '승인', { onClick: () => onApproveCurrent(current, gateErrBox) }));
    gateWrap.appendChild(btnRow);
  }

  async function onApproveCurrent(staged, gateErrBox) {
    clear(gateErrBox);
    try {
      const registerRes = await window.athena.invoke('athena:mcp-register', { staged });
      if (!(registerRes && registerRes.ok)) {
        gateErrBox.appendChild(errorNote((registerRes && registerRes.error) || '등록에 실패했다'));
        return;
      }
      const approveRes = await window.athena.invoke('athena:mcp-approve', { alias: registerRes.alias || staged.alias });
      if (!(approveRes && approveRes.ok)) {
        gateErrBox.appendChild(errorNote((approveRes && approveRes.error) || '승인에 실패했다'));
        return;
      }
      queueIndex += 1;
      renderGate();
    } catch (err) {
      gateErrBox.appendChild(errorNote('MCP 등록·승인 기능을 아직 사용할 수 없다 (athena:mcp-register/athena:mcp-approve 핸들러 없음)'));
    }
  }

  attachSheet(card, root);
  textarea.focus();
}

// ---- AT-ST-006: MCP probe · 툴 허용 시트 ----
function openMcpProbeSheet(card, alias, onDone) {
  // 닫기 판단 함수들 — probe 결과가 로드되기 전(로딩·에러 상태)에는 항상
  // "경고 없음"이다. renderProbeResult()가 실제 tools/localAllowed를 알게 된
  // 뒤에만 의미 있는 판정으로 교체된다.
  let hasUnsavedChanges = () => false;
  // null = "아직 판단할 수 없다"(로딩/에러 중이거나 probe 결과 자체가 0개 툴).
  // 0 = "툴은 있는데 허용된 게 하나도 없다" — 이 값일 때만 경고한다.
  let allowedCountGetter = () => null;
  let activeWarnBar = null;

  function attemptClose() {
    if (activeWarnBar) return; // 이미 경고 중 — 중복으로 새 바를 쌓지 않는다
    const allowedCount = allowedCountGetter();
    const dirty = hasUnsavedChanges();
    if (!dirty && allowedCount !== 0) {
      detachSheet(card, root);
      return;
    }
    const parts = [];
    if (allowedCount === 0) parts.push('허용된 툴이 0개다 — 이 서버의 툴이 하나도 노출되지 않는다');
    if (dirty) parts.push('바꾼 허용 상태를 아직 반영하지 않았다');
    const { bar, keepBtn, closeBtn } = closeWarnBar(`${parts.join(' · ')} — 그래도 닫을까?`);
    activeWarnBar = bar;
    keepBtn.addEventListener('click', () => {
      bar.remove();
      activeWarnBar = null;
    });
    closeBtn.addEventListener('click', () => detachSheet(card, root));
    body.insertBefore(bar, body.firstChild);
  }

  const { root, body } = sheet(`probe 결과 · ${alias}`, { onClose: () => attemptClose() });
  attachSheet(card, root);
  runProbe();

  async function runProbe() {
    // 재조회 때마다 경고 상태를 초기화한다 — clear(body)가 이전 경고 바
    // DOM도 지우므로, 판정 함수도 같이 로딩 상태로 되돌려야 잔여 참조가
    // "닫아도 되는데 경고" 같은 유령 상태를 만들지 않는다.
    activeWarnBar = null;
    hasUnsavedChanges = () => false;
    allowedCountGetter = () => null;
    clear(body);
    body.appendChild(emptyState('probe 실행 중…'));
    let res;
    let threw = false;
    try {
      res = await window.athena.invoke('athena:mcp-probe', { alias });
    } catch (err) {
      threw = true;
    }
    clear(body);
    if (threw) {
      body.appendChild(errorNote('probe 기능을 아직 사용할 수 없다 (athena:mcp-probe 핸들러 없음)'));
      return;
    }
    if (!res || !res.ok) {
      body.appendChild(errorNote((res && res.error) || 'probe에 실패했다 — 서버가 아직 승인되지 않았을 수 있다'));
      // 승인 전에는 probe 자체가 거부된다(AT-ST-006 §3.1, consent.py 게이트).
      // 서버 승인은 여기서도 독립적인 명시 동작으로만 수행한다 — 자동 승인 없음.
      body.appendChild(button('primary', '서버 시작 승인 후 재시도', {
        onClick: async () => {
          try { await window.athena.invoke('athena:mcp-approve', { alias }); } catch { /* 무시 — 아래 재probe가 실패를 다시 보여준다 */ }
          runProbe();
        },
      }));
      return;
    }
    renderProbeResult(res);
  }

  function renderProbeResult(res) {
    const tools = res.tools || [];
    body.appendChild(row('uk-probe-head', [
      el('span', 'uk-settings-name', 'probe 결과'),
      el('span', 'uk-mono-faint', `protocolVersion ${res.protocolVersion || '—'}`),
      el('span', 'uk-mono-faint', `툴 ${tools.length}개 발견`),
    ]));

    body.appendChild(row('uk-col-head', [
      spacer(16),
      el('span', 'uk-col-toolname', '툴 이름'),
      el('span', 'uk-col-toollen', '길이'),
      el('span', 'uk-col-tooldesc', '설명 요약'),
      el('span', 'uk-col-toolallow', '허용'),
    ]));

    // 이 시트가 열려 있는 동안만 쓰는 로컬 체크 상태. "선택 허용"을 눌러야
    // 백엔드에 실제로 반영된다(AT-ST-006 Desc 2/4 — 전체 허용이 기본값이
    // 아니고, "선택 허용"이 화면 내 유일한 브랜드색 주 액션이다).
    const localAllowed = {};
    for (const t of tools) localAllowed[t.name] = !!t.allowed;

    // attemptClose()가 참조하는 실제 판정 — localAllowed는 이후 체크박스
    // 클릭으로 제자리에서(in-place) 바뀌므로 여기서 한 번만 연결해두면 항상
    // 최신 상태를 본다. tools가 애초에 0개면(서버에 노출할 툴 자체가 없음)
    // "0개 허용" 경고 대상이 아니다 — null로 판단 보류.
    hasUnsavedChanges = () => tools.some((t) => !!localAllowed[t.name] !== !!t.allowed);
    allowedCountGetter = () => (tools.length ? tools.filter((t) => localAllowed[t.name]).length : null);

    const rowsWrap = el('div');
    body.appendChild(rowsWrap);

    function drawRows() {
      clear(rowsWrap);
      for (const t of tools) {
        const qlen = alias.length + 2 + t.name.length;
        const oversized = qlen > 64;
        const checked = !!localAllowed[t.name];
        const cb = checkboxEl(checked, oversized, (next) => {
          localAllowed[t.name] = next;
          drawFooter();
        });
        const nameEl = el('span', `uk-col-toolname${oversized ? ' is-dim' : ''}`, t.name);
        const lenEl = el('span', `uk-col-toollen${oversized ? ' is-dim' : ''}`, `${qlen}자`);
        const descEl = el('span', `uk-col-tooldesc${oversized ? ' is-dim' : ''}`, t.description || '');
        const allowCell = el('span', 'uk-col-toolallow');
        if (oversized) {
          allowCell.classList.add('uk-oversized-note');
          allowCell.textContent = '64자 초과 — 노출 불가';
        } else {
          allowCell.appendChild(pill(checked ? '허용됨' : '미허용', checked ? 'ok' : 'dim'));
        }
        rowsWrap.appendChild(row(`uk-row${oversized ? ' uk-row-oversized' : ''}`, [cb, nameEl, lenEl, descEl, allowCell]));
      }
    }
    drawRows();

    const notes = el('div', 'uk-probe-notes');
    notes.appendChild(row(null, [
      el('span', 'uk-note-ok', '✓'),
      el('span', null, res.encodingCorrupt
        ? '인코딩 스모크 — U+FFFD 손상 감지됨 (탐지만 하고 복구하지 않는다)'
        : '인코딩 스모크 — 툴 이름·설명 U+FFFD 수동 스캔 통과 (호출 없음)'),
    ]));
    notes.appendChild(row(null, [
      el('span', 'uk-note-dim', '●'),
      el('span', null, '능동 probe는 allowlist 툴만 실행 — 어느 쪽이든 감사 로그에 남는다'),
    ]));
    body.appendChild(notes);

    const footer = row('uk-btn-row-end', []);
    body.appendChild(footer);
    function drawFooter() {
      clear(footer);
      const selected = tools.filter((t) => localAllowed[t.name]).length;
      footer.appendChild(el('span', 'uk-mono-faint uk-footer-count', `${selected}개 선택됨 · ${tools.length}개 중`));
      footer.appendChild(el('span', 'uk-flex-spacer'));
      footer.appendChild(button('ghost', '전체 허용', {
        onClick: () => {
          for (const t of tools) {
            const qlen = alias.length + 2 + t.name.length;
            if (qlen <= 64) localAllowed[t.name] = true;
          }
          drawRows();
          drawFooter();
        },
      }));
      footer.appendChild(button('primary', '선택 허용', { onClick: onCommit }));
    }
    drawFooter();

    async function onCommit() {
      const failures = [];
      for (const t of tools) {
        const wasAllowed = !!t.allowed;
        const nowAllowed = !!localAllowed[t.name];
        if (wasAllowed === nowAllowed) continue;
        try {
          const r = await window.athena.invoke('athena:mcp-allow-tool', { alias, tool: t.name, allowed: nowAllowed });
          if (!r || !r.ok) failures.push(t.name);
        } catch (err) {
          failures.push(t.name);
        }
      }
      await runProbe();
      onDone();
      if (failures.length) body.appendChild(errorNote(`허용 상태를 반영하지 못한 툴: ${failures.join(', ')}`));
    }
  }
}

// =============================================================================
// 모델 — Paper 43쪽(2026-08-18 확정, 다계정 요건 2026-08-18 추가). Claude 섹션
// (계정 목록 · 계정 추가 · 모델 칩 · 직접 입력 · 사고 강도 칩) / 구분선 / Codex
// 섹션(같은 구조, 미연결이면 계정 목록 대신 "미연결 · 연결" 행이고 모델·강도는
// 비활성) / 정직성 노트 2줄.
//
// 공급자당 연결 상태는 더 이상 단일 pill이 아니라 **계정 목록**이다 —
// athena:cli-list가 provider.accounts: [{id,label,active}]를 준다(2~3개 가능,
// 온보딩 2/3과 같은 계약). 활성 전환은 athena:cli-set-active(무확인, 온보딩과
// 동일), 계정 추가는 athena:cli-login(providerId) 위임 — 새 콘솔 창에서 로그인이
// 끝나면 athena:cli-changed가 이 창에도 오고, 그 구독이 카드를 다시 그린다(아래
// renderModel 참고). 여기서 별도 폴링·타임아웃을 두지 않는다.
//
// 모델·사고 강도는 계정별이 아니라 앱 전역 설정이다(athena:model-get/-set, 위
// IPC 계약 그대로) — 그래서 buildModelSection이 accounts와 modelState를
// 별개 인자로 받는다.
// IPC 계약: athena:model-get → {claude:{model,effort}, codex:{model,effort}}
// (null=기본) · athena:model-set {provider, patch} → 성공 시 전체 상태, 실패
// 시 {ok:false, error} · on athena:model-changed.
// =============================================================================

const CLAUDE_MODEL_CHIPS = [
  { value: null, label: '기본' },
  { value: 'fable', label: 'fable' },
  { value: 'opus', label: 'opus' },
  { value: 'sonnet', label: 'sonnet' },
  { value: 'haiku', label: 'haiku' },
];
const CLAUDE_EFFORT_CHIPS = [
  { value: null, label: '기본' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
  { value: 'max', label: 'max' },
];
const CODEX_EFFORT_CHIPS = [
  { value: null, label: '기본' },
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
];

// 활성 계정 행 — 상태 표시만, 조작이 없으므로 button이 아니다(누를 게 없는
// 행까지 버튼으로 만들면 오히려 키보드 사용자에게 "여기 액션이 있다"고
// 거짓 신호를 준다). 비활성 계정 행은 buildModelAccountSwitchButton이 만든다
// — 그쪽만 진짜 button이다(팀리드 지시: 전부 키보드 도달 가능, 행도 button).
function buildModelActiveAccountRow(acc) {
  return row('uk-model-account-row is-active', [
    el('span', 'uk-model-account-label', acc.label),
    el('span', 'uk-flex-spacer'),
    badge(true, '활성'),
  ]);
}

function buildModelAccountSwitchButton(acc, onSwitch) {
  const b = el('button', 'uk-model-account-row uk-model-account-switch');
  b.type = 'button';
  b.setAttribute('aria-label', `${acc.label} — 눌러서 활성 계정으로 전환`);
  b.appendChild(el('span', 'uk-model-account-label', acc.label));
  b.appendChild(el('span', 'uk-flex-spacer'));
  b.appendChild(badge(false, '비활성'));
  b.addEventListener('click', () => onSwitch(acc));
  return b;
}

function buildModelConnectRow(title, onConnect) {
  const b = el('button', 'uk-model-account-row uk-model-account-connect');
  b.type = 'button';
  b.appendChild(statusDot(false, `${title} 미연결`));
  b.appendChild(el('span', 'uk-model-account-label', '미연결'));
  b.appendChild(el('span', 'uk-flex-spacer'));
  b.appendChild(el('span', 'uk-model-connect-label', '연결'));
  b.addEventListener('click', onConnect);
  return b;
}

// title/provider(athena:cli-list의 provider 항목, accounts:[{id,label,active}])/
// modelState({model,effort} 또는 null)/modelChips(null이면 Codex처럼 입력 하나만)/
// effortChips/disabled(모델·강도 컨트롤만 잠근다 — 계정 목록·로그인은 연결
// 상태와 무관하게 항상 조작 가능해야 "연결" 자체가 가능하다)/onModelChange/
// onAccountsChanged(계정 전환·로그인 성공 시 카드 전체를 다시 그리라는 콜백)/
// errBox(공용 오류 표시 슬롯, 두 섹션이 공유).
function buildModelSection(opts) {
  const { title, provider, modelState, modelChips, effortChips, disabled, onModelChange, onAccountsChanged, errBox } = opts;
  const accounts = (provider && provider.accounts) || [];
  const connected = accounts.length > 0;
  const s = modelState || {};

  const wrap = el('div', 'uk-model-section');
  wrap.appendChild(row('uk-model-section-head', [
    el('span', 'uk-settings-name', title),
    pill(connected ? '연결됨' : '미연결', connected ? 'ok' : 'dim'),
  ]));

  async function doSwitch(acc) {
    clear(errBox);
    try {
      const res = await window.athena.invoke('athena:cli-set-active', { accountId: acc.id });
      if (!res || !res.ok) { errBox.appendChild(errorNote('활성 계정 전환에 실패했다')); return; }
    } catch (err) {
      errBox.appendChild(errorNote('계정 전환 기능을 아직 사용할 수 없다 (athena:cli-set-active 핸들러 없음)'));
      return;
    }
    onAccountsChanged();
  }

  async function doLogin() {
    clear(errBox);
    try {
      const res = await window.athena.invoke('athena:cli-login', { providerId: provider.id });
      if (!res || !res.ok) {
        errBox.appendChild(errorNote(`${title} 로그인을 시작하지 못했다${res && res.message ? ' — ' + res.message : ''}`));
      }
      // launched:true면 새 터미널 창에서 로그인이 진행 중이다 — 성공하면
      // athena:cli-changed가 이 창에도 방송되고 renderModel()의 구독이 카드를
      // 다시 그린다(onboarding.js와 같은 신호, 별도 폴링을 두지 않는다).
    } catch (err) {
      errBox.appendChild(errorNote('CLI 로그인 기능을 아직 사용할 수 없다 (athena:cli-login 핸들러 없음)'));
    }
  }

  // ---- 계정 목록 · 계정 추가 — 연결 상태와 무관하게 항상 조작 가능하다 ----
  const accountsWrap = el('div', 'uk-model-accounts');
  if (connected) {
    for (const acc of accounts) {
      accountsWrap.appendChild(acc.active ? buildModelActiveAccountRow(acc) : buildModelAccountSwitchButton(acc, doSwitch));
    }
    accountsWrap.appendChild(button('text', '+ 계정 추가', { onClick: doLogin }));
  } else {
    accountsWrap.appendChild(buildModelConnectRow(title, doLogin));
  }
  accountsWrap.appendChild(el('div', 'uk-field-hint-static', '연결을 누르면 해당 CLI의 로그인 명령이 새 터미널 창에서 실행된다 — 로그인은 그 창에서 완료한다.'));
  wrap.appendChild(accountsWrap);

  // ---- 모델 · 사고 강도 — 앱 전역 설정(계정별 아님). disabled면 이 컨트롤만
  // 잠긴다, 위 계정 UI는 그대로 켜져 있다(연결해야 잠금이 풀리므로). ----
  const controlsWrap = el('div', `uk-model-controls${disabled ? ' is-disabled' : ''}`);
  const modelValue = s.model || null;

  function makeCommittableInput(placeholder, initialValue, onCommit) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'uk-input uk-input-mono uk-model-custom-input';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.value = initialValue || '';
    if (disabled) input.disabled = true;
    const commit = () => onCommit(input.value.trim());
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); input.blur(); }
    });
    return input;
  }

  if (modelChips) {
    controlsWrap.appendChild(el('div', 'uk-field-label', '모델'));
    const chipRow = row('uk-chip-row', []);
    for (const c of modelChips) {
      const isOn = c.value === modelValue;
      const b = button('ghost', c.label, { disabled, onClick: () => onModelChange({ model: c.value }) });
      b.classList.add('uk-chip');
      if (isOn) b.classList.add('is-pressed');
      b.setAttribute('aria-pressed', String(isOn));
      chipRow.appendChild(b);
    }
    controlsWrap.appendChild(chipRow);

    const isCustomModel = modelValue && !modelChips.some((c) => c.value === modelValue);
    const customInput = makeCommittableInput('모델 이름 직접 입력', isCustomModel ? modelValue : '', (v) => {
      if (!v || v === modelValue) return;
      onModelChange({ model: v });
    });
    controlsWrap.appendChild(customInput);
  } else {
    controlsWrap.appendChild(el('div', 'uk-field-label', '모델'));
    const modelInput = makeCommittableInput('모델 이름', modelValue, (v) => {
      if (v === (modelValue || '')) return;
      onModelChange({ model: v || null });
    });
    controlsWrap.appendChild(modelInput);
  }

  controlsWrap.appendChild(el('div', 'uk-field-label uk-model-effort-label', '사고 강도'));
  const effortValue = s.effort || null;
  const effortRow = row('uk-chip-row', []);
  for (const c of effortChips) {
    const isOn = c.value === effortValue;
    const b = button('ghost', c.label, { disabled, onClick: () => onModelChange({ effort: c.value }) });
    b.classList.add('uk-chip');
    if (isOn) b.classList.add('is-pressed');
    b.setAttribute('aria-pressed', String(isOn));
    effortRow.appendChild(b);
  }
  controlsWrap.appendChild(effortRow);
  wrap.appendChild(controlsWrap);

  return wrap;
}

function renderModel(grid) {
  const { card, head, body } = buildCardShell(grid, 'model');
  if (unsubscribeModelChanged) { unsubscribeModelChanged(); unsubscribeModelChanged = null; }
  if (unsubscribeCliChangedForModel) { unsubscribeCliChangedForModel(); unsubscribeCliChangedForModel = null; }
  const refresh = () => refreshModelCard(card, head, body);
  unsubscribeModelChanged = window.athena.on('athena:model-changed', () => refresh());
  // 계정 추가·전환이 다른 경로(온보딩 등)에서 일어나도 이 카드가 열려 있으면
  // 반영돼야 한다 — athena:cli-changed는 이미 preload ON allowlist에 있다.
  unsubscribeCliChangedForModel = window.athena.on('athena:cli-changed', () => refresh());
  return refresh();
}

async function refreshModelCard(card, head, body) {
  let modelState;
  try {
    modelState = await window.athena.invoke('athena:model-get');
  } catch (err) {
    clear(head);
    clear(body);
    missingHandlerCard(head, body, '모델', 'athena:model-get');
    body.appendChild(errorNote(String((err && err.message) || err)));
    return;
  }
  let providers = [];
  try {
    const cliData = await window.athena.invoke('athena:cli-list');
    providers = (cliData && cliData.providers) || [];
  } catch { /* 연결 상태 조회 실패 — 두 섹션 다 미연결로 그린다 */ }

  clear(head);
  clear(body);

  head.appendChild(row('uk-settings-title', [
    el('span', 'uk-settings-name', '모델'),
  ]));
  const actions = row('uk-settings-actions', []);
  actions.appendChild(cardCloseButton(card));
  head.appendChild(actions);

  const claudeProvider = providers.find((p) => p.id === 'claude') || { id: 'claude', accounts: [] };
  const codexProvider = providers.find((p) => p.id === 'codex') || { id: 'codex', accounts: [] };
  const codexConnected = (codexProvider.accounts || []).length > 0;

  const errBox = el('div');
  const refresh = () => refreshModelCard(card, head, body);

  // 성공 시 여기서 직접 다시 그리지 않는다 — main이 athena:model-set 성공 응답과
  // 별개로 이 창(chatWin)에 athena:model-changed를 방송하고(app/main.js
  // handleModelSet), renderModel()이 그 이벤트를 구독해 이미 다시 그린다. 여기서도
  // refresh()를 부르면 같은 변경 하나에 athena:model-get·athena:cli-list를 두 번씩
  // 보내는 꼴이다.
  async function applyChange(provider, patch) {
    clear(errBox);
    try {
      const res = await window.athena.invoke('athena:model-set', { provider, patch });
      if (!res || res.ok === false) {
        errBox.appendChild(errorNote((res && res.error) || '모델 설정을 저장하지 못했다'));
      }
    } catch (err) {
      errBox.appendChild(errorNote('모델 설정 기능을 아직 사용할 수 없다 (athena:model-set 핸들러 없음)'));
    }
  }

  body.appendChild(buildModelSection({
    title: 'Claude',
    provider: claudeProvider,
    modelState: modelState && modelState.claude,
    modelChips: CLAUDE_MODEL_CHIPS,
    effortChips: CLAUDE_EFFORT_CHIPS,
    disabled: false,
    onModelChange: (patch) => applyChange('claude', patch),
    onAccountsChanged: refresh,
    errBox,
  }));

  body.appendChild(el('div', 'uk-model-divider'));

  body.appendChild(buildModelSection({
    title: 'Codex',
    provider: codexProvider,
    modelState: modelState && modelState.codex,
    modelChips: null,
    effortChips: CODEX_EFFORT_CHIPS,
    disabled: !codexConnected,
    onModelChange: (patch) => applyChange('codex', patch),
    onAccountsChanged: refresh,
    errBox,
  }));

  body.appendChild(errBox);

  const note = el('div', 'uk-settings-note');
  note.appendChild(el('div', null, 'Codex 설정은 $CODEX_HOME/config.toml의 model · model_reasoning_effort에 직접 반영된다 — 이 앱 밖에서 codex를 쓸 때도 적용되는 전역 기본값이다. 질의 실행 결선은 여전히 Claude뿐이다.'));
  note.appendChild(el('div', null, '모델 접근 권한은 활성 계정의 플랜을 따른다 — 접근 불가 모델이면 질의가 오류로 표면화된다.'));
  body.appendChild(note);
}


function renderHistory(grid) {
  const { card, head, body } = buildCardShell(grid, 'history');
  return refreshHistoryCard(card, head, body);
}

async function refreshHistoryCard(card, head, body) {
  let status;
  try {
    status = await window.athena.invoke('athena:brain-status');
  } catch (err) {
    status = { ok: false, error: String((err && err.message) || err) };
  }
  clear(head);
  clear(body);

  head.appendChild(row('uk-settings-title', [
    el('span', 'uk-settings-name', '성향・이력'),
  ]));
  const actions = row('uk-settings-actions', []);
  actions.appendChild(cardCloseButton(card));
  head.appendChild(actions);

  const readyPill = status && status.ok
    ? pill(status.ready ? '브레인 준비됨' : '브레인 준비 안 됨', status.ready ? 'ok' : 'dim')
    : pill('상태 조회 실패', 'warn');
  body.appendChild(row('uk-toggle-row', [
    el('span', 'uk-toggle-label', '브레인 상태'),
    readyPill,
  ]));
  if (!(status && status.ok)) {
    body.appendChild(errorNote((status && status.error) || '상태를 조회할 수 없다'));
  }

  const infoNote = el('div', 'uk-settings-note');
  infoNote.appendChild(el('div', null, '배치 주기 — 설정 파일로 관리한다(ATHENA_BRAIN_INGEST_INTERVAL_MINUTES, 기본 60분). 이 화면은 값을 바꾸지 않는다.'));
  infoNote.appendChild(el('div', null, '수동 실행 · 마지막/다음 실행 시각 — 상태 API가 아직 이 값을 노출하지 않아 이 화면에서 제공하지 않는다.'));
  body.appendChild(infoNote);

  const dangerNote = el('div', 'uk-settings-note');
  dangerNote.appendChild(el('div', null, '전체 삭제 — 저장된 채팅 이력과 투자 성향 그래프를 모두 지우고 백엔드를 재기동한다. 되돌릴 수 없다.'));
  body.appendChild(dangerNote);

  const resultBox = el('div');
  body.appendChild(resultBox);

  const deleteRow = row('uk-btn-row-end', []);
  const deleteBtn = button('ghost', '전체 삭제', { onClick: () => onDeleteClick() });
  deleteBtn.classList.add('is-danger');
  deleteRow.appendChild(deleteBtn);
  body.appendChild(deleteRow);

  function onDeleteClick() {
    clear(resultBox);
    const { bar, cancelBtn, confirmBtn } = deleteConfirmBar(
      '채팅 이력과 투자 성향을 전부 삭제할까요? 되돌릴 수 없다.',
    );
    resultBox.appendChild(bar);
    deleteBtn.disabled = true;
    cancelBtn.addEventListener('click', () => {
      clear(resultBox);
      deleteBtn.disabled = false;
    });
    confirmBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      confirmBtn.disabled = true;
      confirmBtn.querySelector('.uk-btn-label').textContent = '삭제 중…';
      let res;
      let threw = false;
      try {
        res = await window.athena.invoke('athena:brain-reset');
      } catch (err) {
        threw = true;
        res = { ok: false, error: String((err && err.message) || err) };
      }
      clear(resultBox);
      if (threw || !(res && res.ok)) {
        resultBox.appendChild(errorNote((res && res.error) || '삭제에 실패했다'));
        deleteBtn.disabled = false;
        return;
      }
      const note = el('div', 'uk-settings-note');
      if (res.selfSpawned) {
        note.appendChild(el('div', null, res.restarted
          ? '삭제 완료 — 브레인 재기동 중이거나 이미 재기동됐다.'
          : '삭제 완료 — 브레인 재기동 확인에 실패했다. 수동으로 재시작해야 할 수 있다.'));
      } else {
        note.appendChild(el('div', null, '삭제 완료 — 이 앱이 스폰한 백엔드가 아니라 자동으로 재기동하지 않는다. 백엔드를 수동으로 재시작한다.'));
      }
      resultBox.appendChild(note);
      // 삭제 직후엔 다시 누를 대상이 없다 — 재확인은 카드를 닫았다 다시 여는
      // 것으로 한다(refreshHistoryCard가 최신 상태를 다시 조회한다).
    });
  }
}

// UMD 각주(2026-08-18 렌더러 격리) — sanitize.js와 같은 패턴.
const __exports = { renderAccounts, renderMcp, renderScreen, renderModel, renderHistory, renderNav };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.SettingsCards = __exports;
}

})();
