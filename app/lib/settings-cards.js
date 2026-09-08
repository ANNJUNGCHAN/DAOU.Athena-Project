// IIFE 스코프 격리(2026-08-18 렌더러 격리) — <script> 태그는 top-level const/function을
// 문서 전체가 공유하는 하나의 스크립트 스코프에 넣는다(require()의 모듈별 격리와 다르다).
// el/sanitize 같은 흔한 이름이 파일 간에 충돌해 SyntaxError가 났다(실측, diag-isolation.js).
// CJS(require)는 이 IIFE 밖에서도 동일하게 동작한다 — Node의 모듈 래퍼가 이미 함수 스코프다.
(function () {

// UMD 헤드(2026-08-18 렌더러 격리) — ipcRenderer는 window.athena 다리로
// 대체한다(preload.js). ui-kit require는 node --test/<script> 태그 겸용.
const {
  el, row, statusDot, badge, button,
  sheet, secretMask, emptyState, errorNote, clear, removeCard,
} = (typeof module !== 'undefined' && module.exports) ? require('./ui-kit') : window.AthenaLib.UiKit;

// ---------------------------------------------------------------------------
// 로컬 프리미티브 — ui-kit.js에 없는 것만 여기서 만든다(오케스트레이터 지시:
// ui-kit.js는 다른 에이전트가 동시에 읽는 중이라 편집하지 않는다).
// ---------------------------------------------------------------------------

// Paper FPE-0 FPS-0의 확인 완료 박스. ui-kit엔 errorNote만 있어 여기서 만든다
// (ui-kit.js는 다른 트랙이 동시에 읽는 파일이라 건드리지 않는다 — 위 주석과 같은 이유).
function successNote(message) {
  const n = el('div', 'uk-success', message);
  n.setAttribute('role', 'status');
  return n;
}

function pill(text, tone) {
  return el('span', `uk-pill tone-${tone || 'dim'}`, text);
}

// 44×24 토글. 브랜드색은 켜진 트랙 테두리에만 쓴다 — 배경 채움은 쓰지 않는다
// (화면당 유일 브랜드 요소 규칙은 버튼 쪽에서 지킨다).
function toggleSwitch(initial, onChange, ariaLabel) {
  let on = !!initial;
  const t = el('button', `uk-toggle${on ? ' is-on' : ''}`);
  t.type = 'button';
  t.setAttribute('role', 'switch');
  t.setAttribute('aria-checked', String(on));
  if (ariaLabel) t.setAttribute('aria-label', ariaLabel);
  t.appendChild(el('span', 'uk-toggle-thumb'));
  t.setChecked = (next) => {
    on = !!next;
    t.classList.toggle('is-on', on);
    t.setAttribute('aria-checked', String(on));
  };
  t.addEventListener('click', () => {
    t.setChecked(!on);
    onChange(on);
  });
  return t;
}

// 카드가 다시 그려질 때마다(nav에서 재선택할 때마다) 이전 구독을 반드시 끊는다 —
// window.athena.on()의 반환값은 구독 해제 함수이고, 카드는 buildCardShell()이
// 기존 DOM만 지우고 리스너는 그대로 두므로 여기서 직접 관리하지 않으면 설정을
// 여닫을 때마다 athena:zoom-changed/athena:model-changed 리스너가 누적된다.
let unsubscribeScreenZoom = null;
let unsubscribeModelChanged = null;
let unsubscribeCliChangedForModel = null;


// disabledTitle이 있으면(계좌 목록의 "마지막 하나는 삭제 불가", AT-ST-001
// Desc 1.1) 클릭 리스너 없는 비활성 버튼만 돌려준다.
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

// 확인 버튼은 ghost + is-danger(경고색)다 — primary(브랜드색)를 쓰지 않는다.
// 계좌 카드도 같은 규칙으로 맞춘다. 클릭 핸들러는 호출자가 붙인다 — 여기서는
// 뼈대만 만든다.
function deleteConfirmBar(message) {
  const bar = el('div', 'uk-row-confirm');
  // 확인 바 위 어디를 눌러도(버튼이 아닌 여백 포함) 아래 행의 클릭 리스너
  // (계좌 전환)로 새지 않게 막는다.
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
  b.addEventListener('click', () => removeCard(card));
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
  { key: 'model', label: '모델' },
  // Paper 보드 32 — 성향·이력. 배지는 개수가 아니라 노출 on/off 상태다: 대화
  // 모델에 성향 그래프가 열려 있는지를 켜짐/꺼짐으로 보여준다(그 토글 자체는
  // 그래프 모드 「수집·노출」 탭이 소유한다 — 보드 22).
  { key: 'history', label: '성향・이력', statusFn: () => (readGraphSettings().exposeToModel ? '켜짐' : '꺼짐') },
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
// (기존 renderScreen/renderAccounts 재사용 + 신규 renderModel, 호출자는
// chat.js openSettings). nav 자신은 어떤 카드도 모른다 — 그리는 책임은 호출자에게
// 넘긴다(관심사 분리, 계좌 카드 재작성 금지 지시와도 맞물린다).
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
    if (item && item.statusFn && item._badgeEl) item._badgeEl.textContent = item.statusFn();
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
    // 라벨이 아니라 키로 집는다 — lib/paper-screen-routes.js의 도달 절차가 쓰는 셀렉터다.
    b.setAttribute('data-key', item.key);
    b.appendChild(el('span', 'settings-nav-label', item.label));
    if (item.countChannel) {
      const badgeEl = el('span', 'settings-nav-badge', '');
      item._badgeEl = badgeEl;
      b.appendChild(badgeEl);
      refreshNavCount(item, badgeEl);
    } else if (item.statusFn) {
      const badgeEl = el('span', 'settings-nav-badge', item.statusFn());
      item._badgeEl = badgeEl;
      b.appendChild(badgeEl);
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
    el('span', 'uk-settings-count', '두 영역과 카드에 함께 적용된다'),
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
  const expandToggle = toggleSwitch(
    !!data.autoExpandCanvas,
    (next) => setPref('autoExpandCanvas', next),
    '질의하면 캔버스 창을 자동으로 연다',
  );
  body.appendChild(row('uk-toggle-row', [expandLabelCol, expandToggle]));

  const growLabelCol = el('div');
  growLabelCol.appendChild(el('div', 'uk-toggle-label', '답변 길이에 따라 대화 창이 자란다'));
  const growToggle = toggleSwitch(
    !!data.autoGrowChat,
    (next) => setPref('autoGrowChat', next),
    '답변 길이에 따라 대화 창이 자란다',
  );
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

  // ---- UI 배율 — 단축키 없이 이 설정의 버튼으로만 조절한다. ----
  const zoomLabelCol = el('div');
  zoomLabelCol.appendChild(el('div', 'uk-toggle-label', 'UI 배율'));
  const zoomControls = el('div', 'uk-zoom-controls');
  zoomControls.setAttribute('role', 'group');
  zoomControls.setAttribute('aria-label', 'UI 배율');
  const zoomValue = el('span', 'uk-zoom-value uk-mono-faint', `${Math.round(window.athena.getZoomFactor() * 100)}%`);
  zoomValue.setAttribute('role', 'status');
  zoomValue.setAttribute('aria-live', 'polite');
  zoomValue.setAttribute('aria-label', '현재 UI 배율');
  const zoomOutButton = button('ghost', '−', { onClick: () => window.athena.send('athena:zoom', { dir: 'out' }) });
  zoomOutButton.setAttribute('aria-label', 'UI 배율 축소');
  zoomControls.appendChild(zoomOutButton);
  zoomControls.appendChild(zoomValue);
  const zoomInButton = button('ghost', '+', { onClick: () => window.athena.send('athena:zoom', { dir: 'in' }) });
  zoomInButton.setAttribute('aria-label', 'UI 배율 확대');
  zoomControls.appendChild(zoomInButton);
  const zoomResetButton = button('text', '재설정', { onClick: () => window.athena.send('athena:zoom', { dir: 'reset' }) });
  zoomResetButton.setAttribute('aria-label', 'UI 배율 재설정');
  zoomControls.appendChild(zoomResetButton);
  body.appendChild(row('uk-toggle-row', [zoomLabelCol, zoomControls]));

  unsubscribeScreenZoom = window.athena.on('athena:zoom-changed', (payload) => {
    const z = (payload && typeof payload.zoom === 'number') ? payload.zoom : window.athena.getZoomFactor();
    zoomValue.textContent = `${Math.round(z * 100)}%`;
  });

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
    body.appendChild(buildAccountsTable(
      accounts,
      refresh,
      (account) => openOrderApiSheet(card, account, refresh),
    ));
  }

  const note = el('div', 'uk-settings-note');
  note.appendChild(el('div', null, '앱키·시크릿은 목록에 표시되지 않는다. 저장 위치는 OS 자격증명 저장소다.'));
  note.appendChild(el('div', null, '비활성 계좌를 누르면 활성으로 전환된다. 활성 계좌는 항상 하나다.'));
  body.appendChild(note);
}

function acctStatusPill(a) {
  if (a.backendConnected === true) return pill('마지막 연결 성공', 'ok');
  if (a.backendSyncError) return pill('조회 연결 실패', 'warn');
  return pill('연결 확인 필요', 'warn');
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
  const backendButton = button('text', a.backendSyncError ? '다시 시도' : '연결 확인');
  backendButton.classList.add('uk-account-backend-button');
  backendButton.title = '이 계좌의 저장된 자격 증명으로 조회 연결을 확인합니다';
  const actionStatus = el('div', 'uk-account-backend-status');
  if (a.backendSyncError) actionStatus.appendChild(errorNote(a.backendSyncError));
  backendButton.addEventListener('click', async () => {
    clear(actionStatus);
    backendButton.disabled = true;
    backendButton.textContent = '확인 중…';
    let result;
    try {
      result = await window.athena.invoke('athena:account-set-backend-alias', { id: a.id });
    } catch (err) {
      result = { ok: false, error: String((err && err.message) || err) };
    }
    if (!result || !result.ok || result.backendConnected === false) {
      actionStatus.appendChild(errorNote(
        (result && (result.backendSyncError || result.error)) || '조회 연결을 확인하지 못했습니다',
      ));
      backendButton.disabled = false;
      backendButton.textContent = '다시 시도';
      return;
    }
    await refresh();
  });
  actionsCell.appendChild(backendButton);
  actionsCell.appendChild(actionStatus);

  const normalCells = [aliasCell, appkeyCell, orderApiCell, statusCell, lastCheckCell, actionsCell];
  const r = row('uk-row', normalCells);
  if (!a.active) {
    r.classList.add('is-clickable');
    r.addEventListener('click', async () => {
      clear(actionStatus);
      let result;
      try {
        result = await window.athena.invoke('athena:account-set-active', { id: a.id });
      } catch (err) {
        result = { ok: false, error: String((err && err.message) || err) };
      }
      if (!result || !result.ok) {
        actionStatus.appendChild(errorNote((result && result.error) || '계좌를 활성화하지 못했습니다'));
        return;
      }
      await refresh();
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
        let result;
        try {
          result = await window.athena.invoke('athena:account-remove', { id: a.id });
        } catch (err) {
          result = { ok: false, error: String((err && err.message) || err) };
        }
        if (!result || !result.ok) {
          bar.appendChild(errorNote((result && result.error)
            || '계좌 삭제 기능을 아직 사용할 수 없다 (athena:account-remove 핸들러 없음)'));
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
  // Paper FLM-0 FM0-0 원문 — 인증 실패만 보드가 문구를 확정했다.
  if (code === 'auth') return '인증 실패 — APP KEY 또는 SECRET KEY를 확인해 주세요';
  if (code === 'network') return '네트워크 오류 — 잠시 후 다시 시도한다';
  if (code === 'ratelimit') return '레이트리밋 초과 — 잠시 후 다시 시도한다';
  if (code === 'invalid') return '입력값을 확인한다';
  return '검증에 실패해 저장하지 않았다';
}

// Paper XI-0(확인 중) · FLM-0(인증 실패) · FPE-0(확인 완료) — 계좌 등록 시트는
// idle → verifying → failed | verified → saving → saved 순서로 움직인다. 검증과
// 저장이 갈리므로 실패해도 시트가 열려 있는 **동안만** 입력 값이 남는다(다시 검증).
// 시트를 닫는 두 길(취소·저장 완료)에서는 예외 없이 비운다 — wipeInputs가 그 계약이다.
const ACCOUNT_SHEET_HINTS = {
  idle: '모의투자 계좌의 APP KEY / SECRET KEY로 연결 권한을 확인합니다',
  verifying: '토큰 발급 확인 중… 입력과 저장이 잠시 잠깁니다',
  failed: '검증에 실패해 저장하지 않았습니다. 키를 수정한 뒤 다시 검증할 수 있습니다',
  verified: '확인이 완료되었습니다. 저장하면 OS 자격증명 저장소에 암호화됩니다',
};
const ACCOUNT_SHEET_SUCCESS = '확인 완료 — 모의투자 계좌 연결 권한을 확인했습니다';

function accountSheetPhase(phase, extra) {
  const verifiedLike = phase === 'verified' || phase === 'saving';
  const syncing = phase === 'syncing';
  return {
    phase,
    hint: phase === 'sync-failed'
      ? '계좌는 저장됐지만 조회 연결을 확인하지 못했습니다'
      : syncing ? '저장한 계좌의 조회 연결을 확인하고 있습니다'
        : ACCOUNT_SHEET_HINTS[phase === 'saving' ? 'verified' : phase],
    verificationNote: phase === 'verifying' ? 'APP KEY와 SECRET KEY로 계좌 연결 권한을 확인하고 있습니다' : null,
    submitLabel: syncing ? '연결 확인 중…'
      : phase === 'sync-failed' ? '연결 확인'
        : phase === 'verifying' ? '확인 중…'
      : verifiedLike ? '계좌 저장'
        : phase === 'failed' ? '다시 검증' : '검증 후 저장',
    submitDisabled: phase === 'verifying' || phase === 'saving' || syncing,
    inputsDisabled: phase === 'verifying' || phase === 'saving' || syncing || phase === 'sync-failed',
    wipeInputs: false,
    closeSheet: false,
    successBox: verifiedLike ? ACCOUNT_SHEET_SUCCESS : null,
    errorMessage: null,
    errorFields: [],
    ...extra,
  };
}

function accountSheetState(prev, event) {
  const phase = (prev && prev.phase) || 'idle';
  const type = (event && event.type) || 'open';
  if (type === 'cancel') return accountSheetPhase('idle', { wipeInputs: true, closeSheet: true });
  if (type === 'saved') return accountSheetPhase('idle', { wipeInputs: true, closeSheet: true });
  if (type === 'verify') return accountSheetPhase('verifying');
  if (type === 'verified') return accountSheetPhase('verified');
  if (type === 'save') return accountSheetPhase('saving');
  if (type === 'sync-failed') return accountSheetPhase('sync-failed', {
    wipeInputs: true,
    errorMessage: event && event.error,
  });
  if (type === 'sync') return accountSheetPhase('syncing');
  if (type === 'verify-failed' || type === 'save-failed') {
    return accountSheetPhase('failed', {
      errorMessage: accountErrorMessage(event && event.error),
      // 인증 실패만 어느 칸이 틀렸는지 말할 수 있다 — 네트워크·레이트리밋은
      // 입력과 무관하므로 테두리를 물들이지 않는다(FLM-0은 SECRET KEY를 짚는다).
      errorFields: (event && event.error) === 'auth' ? ['appKey', 'secretKey'] : [],
    });
  }
  return accountSheetPhase(type === 'open' ? 'idle' : phase);
}

// ---- AT-ST-002: 계좌 등록 시트 ----
function openAccountRegisterSheet(card, onDone) {
  const { root, body } = sheet('계좌 등록', {
    subtitle: '모의투자 계좌의 APP KEY / SECRET KEY를 등록한다',
    // 닫는 길은 전부 취소 이벤트를 거친다 — 그래야 값 비우기가 한 곳에서만 일어난다.
    onClose: cancelSheet,
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

  // 상태 행(Paper XI-0 113-0) 아래에 확인 중 설명(114-0)을 별도 줄로 그린다.
  const statusRow = el('div', 'uk-status-row');
  const statusDotEl = el('span', 'uk-status-dot');
  const statusText = el('span', 'uk-status-text', '');
  statusRow.appendChild(statusDotEl);
  statusRow.appendChild(statusText);
  body.appendChild(statusRow);

  const errBox = el('div');
  body.appendChild(errBox);

  const btnRow = row('uk-btn-row-end', []);
  const cancelBtn = button('ghost', '취소', {
    onClick: cancelSheet,
  });
  const submitBtn = button('primary', '검증 후 저장', { onClick: onPrimary });
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(submitBtn);
  body.appendChild(btnRow);

  let sheetState = accountSheetState(null, { type: 'open' });
  let savedAccountId = null;

  function cancelSheet() {
    applyState(accountSheetState(sheetState, { type: 'cancel' }));
    if (savedAccountId) onDone();
  }

  function wipeSecretInputs() {
    aliasInput.value = '';
    appKeyField.input.value = '';
    secretKeyField.input.value = '';
    appKeyField.hint.textContent = '';
    secretKeyField.hint.textContent = '';
  }

  // 상태 하나가 화면 전부를 정한다. 값 비우기·시트 닫기도 여기서만 일어나므로
  // "닫히는 길은 반드시 비운다"가 취소·저장 완료·닫기 세 길에서 똑같이 지켜진다.
  function applyState(next, overrideError) {
    sheetState = next;
    statusText.textContent = next.hint;
    statusDotEl.className = next.inputsDisabled ? 'uk-status-dot is-busy' : 'uk-status-dot';
    submitBtn.textContent = next.submitLabel;
    submitBtn.disabled = next.submitDisabled;
    aliasInput.disabled = next.inputsDisabled;
    appKeyField.input.disabled = next.inputsDisabled;
    secretKeyField.input.disabled = next.inputsDisabled;
    appKeyField.input.classList.toggle('is-error', next.errorFields.includes('appKey'));
    secretKeyField.input.classList.toggle('is-error', next.errorFields.includes('secretKey'));
    clear(errBox);
    if (next.verificationNote) errBox.appendChild(el('div', 'uk-field-hint-static uk-account-verifying-note', next.verificationNote));
    if (next.successBox) errBox.appendChild(successNote(next.successBox));
    const failure = overrideError || next.errorMessage;
    if (failure) errBox.appendChild(errorNote(failure));
    if (next.wipeInputs) wipeSecretInputs();
    if (next.closeSheet) detachSheet(card, root);
  }

  // 값은 누를 때마다 입력에서 읽는다. 검증과 저장이 갈린 뒤로는 실패해도 값을
  // 지우지 않으므로(FLM-0 다시 검증) 값이 남아 있는 구간은 **시트가 열려 있는
  // 동안**으로 한정된다 — 닫히는 순간 applyState가 예외 없이 비운다. 마스크
  // (password 입력 + 붙여넣음 · N자)는 그동안에도 그대로다.
  function readInputs() {
    return {
      alias: aliasInput.value.trim(),
      appKey: appKeyField.input.value,
      secretKey: secretKeyField.input.value,
    };
  }

  async function callRegister(payload) {
    try {
      return { res: await window.athena.invoke('athena:account-register', payload) };
    } catch (err) {
      return { missingHandler: true };
    }
  }

  async function onPrimary() {
    if (sheetState.phase === 'sync-failed') return onSync();
    if (sheetState.phase === 'verified') return onSave();
    return onVerify();
  }

  async function onSync() {
    applyState(accountSheetState(sheetState, { type: 'sync' }));
    let res;
    try {
      res = await window.athena.invoke('athena:account-set-backend-alias', { id: savedAccountId });
    } catch (err) {
      res = { ok: false, error: String((err && err.message) || err) };
    }
    if (!res || !res.ok || res.backendConnected === false) {
      applyState(accountSheetState(sheetState, {
        type: 'sync-failed',
        error: (res && (res.backendSyncError || res.error)) || '조회 연결을 확인하지 못했습니다',
      }));
      return;
    }
    applyState(accountSheetState(sheetState, { type: 'saved' }));
    await onDone();
  }

  async function onVerify() {
    const input = readInputs();
    applyState(accountSheetState(sheetState, { type: 'verify' }));
    const { res, missingHandler } = await callRegister({ ...input, verifyOnly: true });
    if (missingHandler) {
      applyState(accountSheetState(sheetState, { type: 'verify-failed' }),
        '계좌 등록 기능을 아직 사용할 수 없다 (athena:account-register 핸들러 없음)');
      return;
    }
    if (res && res.ok) {
      applyState(accountSheetState(sheetState, { type: 'verified' }));
      return;
    }
    applyState(accountSheetState(sheetState, { type: 'verify-failed', error: res && res.error }));
  }

  async function onSave() {
    const input = readInputs();
    applyState(accountSheetState(sheetState, { type: 'save' }));
    const { res, missingHandler } = await callRegister(input);
    if (missingHandler) {
      applyState(accountSheetState(sheetState, { type: 'save-failed' }),
        '계좌 등록 기능을 아직 사용할 수 없다 (athena:account-register 핸들러 없음)');
      return;
    }
    if (res && res.ok) {
      savedAccountId = res.id;
      if (res.backendConnected === false) {
        applyState(accountSheetState(sheetState, {
          type: 'sync-failed',
          error: res.backendSyncError || '조회 연결을 확인하지 못했습니다',
        }));
        return;
      }
      // 목록 새로고침은 저장이 끝난 뒤다 — 검증만 한 시점에는 아직 계좌가 없다.
      applyState(accountSheetState(sheetState, { type: 'saved' }));
      await onDone();
      return;
    }
    applyState(accountSheetState(sheetState, { type: 'save-failed', error: res && res.error }));
  }

  applyState(sheetState);
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
  const toggleEl = toggleSwitch(toggleState, async (next) => {
    toggleState = next;
    // Desc 5 "되돌리기": 이미 켜진 상태에서 끄는 것은 로컬에 즉시 반영하고
    // 서버 확인 결과를 같은 시트에 명시한다.
    // 켜는 것은 아래 "활성화" 버튼의 최종 확인을 반드시 거친다(Desc 2).
    if (!next && account.orderApi) {
      clear(errBox);
      account.orderApi = false;
      statusPill.textContent = '로컬 OFF · 서버 확인 중';
      renderChecklist();
      try {
        const res = await window.athena.invoke('athena:order-api-set', { id: account.id, enabled: false });
        if (res && res.ok) {
          statusPill.textContent = '현재 OFF';
        } else {
          statusPill.textContent = '로컬 OFF · 서버 확인 필요';
          errBox.appendChild(errorNote((res && res.error) || '서버의 주문 API OFF 상태를 확인하지 못했습니다'));
        }
      } catch (err) {
        statusPill.textContent = '로컬 OFF · 서버 확인 필요';
        errBox.appendChild(errorNote(String((err && err.message) || err)));
      }
    }
    renderChecklist();
  }, 'AI가 이 계좌의 주문 API를 호출하도록 허용');
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

  body.appendChild(el('div', 'uk-revert-note',
    '언제든 설정에서 OFF로 되돌릴 수 있다. OFF는 로컬에 즉시 적용되며 서버 확인 결과를 함께 표시한다.'));

  async function onActivate() {
    clear(errBox);
    activateBtn.disabled = true;
    try {
      const res = await window.athena.invoke('athena:order-api-set', { id: account.id, enabled: toggleState });
      if (res && res.orderApi === false) {
        toggleState = false;
        toggleEl.setChecked(false);
        account.orderApi = false;
        statusPill.textContent = '현재 OFF';
      }
      if (res && res.checklist) renderChecklist(res.checklist);
      else renderChecklist();
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
// 모델 — Paper 화면 18 "설정 — 모델 · AI 제공업체 계정"(2026-09-05 계정 카드형으로
// 개편, 원본 2026-08-18). 리드(제목·설명) / Claude 섹션 / 구분선 / Grok 섹션 / 구분선 / Codex 섹션 /
// 정직성 노트 2줄. 섹션마다: 상태 헤드(점·이름·연결 pill) · 설명 · "계정" 소제목과
// 우측 [+ 계정 추가] · 계정 카드 목록(활성 카드는 진한 테두리, 비활성 카드는
// 본문이 전환 button, 카드 우측에 [재인증]·[제거]) · 모델/사고 강도 칩.
//
// 계정 데이터는 athena:cli-list의 provider.accounts: [{id,label,active,addedAt,
// current}] — current는 그 CLI가 지금 들고 있는 로그인이다(cli-accounts.js
// selectList). 활성 전환은 athena:cli-set-active(무확인, 온보딩과 동일), 계정
// 추가·재인증은 athena:cli-login(providerId) 위임 — 새 콘솔 창에서 로그인이
// 끝나면 athena:cli-changed가 이 창에도 오고, 그 구독이 카드를 다시 그린다(아래
// renderModel 참고). 제거는 athena:cli-remove — Codex는 런타임 로그아웃, Claude는
// 이전 로그인 항목만 지워지고 현재 CLI 로그인은 버튼이 잠긴다. 여기서 별도
// 폴링·타임아웃을 두지 않는다.
//
// 모델·사고 강도는 계정별이 아니라 앱 전역 설정이다(athena:model-get/-set, 위
// IPC 계약 그대로) — 그래서 buildModelSection이 accounts와 modelState를
// 별개 인자로 받는다.
// IPC 계약: athena:model-get → {claude, grok, codex} 각 {model,effort}
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
const GROK_MODEL_CHIPS = [
  { value: null, label: '기본' },
  { value: 'grok-4.6', label: 'grok-4.6' },
  { value: 'grok-4.5', label: 'grok-4.5' },
];
const GROK_EFFORT_CHIPS = [
  { value: null, label: '기본' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
];

// 재인증(↻)·제거(휴지통) — Paper 화면 18의 11×11 선 아이콘. ui-kit의 arrowIcon과
// 같은 방식으로 innerHTML 없이 노드로 만든다.
const SVG_NS = 'http://www.w3.org/2000/svg';
const ACTION_ICON_PATHS = {
  refresh: ['M9.2 5.5A3.7 3.7 0 1 1 8.1 2.9', 'M8.3 1.2v2.1H6.2'],
  trash: ['M1.5 3h8M4 3V1.8h3V3M2.5 3l.6 6.2h4.8L8.5 3'],
};
function actionIcon(kind) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '11');
  svg.setAttribute('height', '11');
  svg.setAttribute('viewBox', '0 0 11 11');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ACTION_ICON_PATHS[kind]) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
  }
  return svg;
}
function iconButton(kind, label, opts) {
  const b = button('ghost', label, opts);
  b.insertBefore(actionIcon(kind), b.firstChild);
  return b;
}

// addedAt(ISO) → "8월 10일 오후 4:49"(이 컴퓨터 시간대). 못 읽으면 null — 부제에서
// 날짜 조각을 뺀다. Intl ko-KR은 엔진에 따라 "8. 10. 오후 4:49"로 찍혀 손으로 잇는다.
function formatAddedAt(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${h < 12 ? '오전' : '오후'} ${h12}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 계정 카드 부제 — 출처 · 추가 시각 · (비활성이면) 전환 안내. Paper 화면 18의
// "현재 CLI 로그인 · 8월 10일 오후 4:49 추가" 문법. 순수 함수라 node --test로 잰다.
function accountSubline(acc, sourceLabel) {
  const parts = [sourceLabel];
  const when = formatAddedAt(acc && acc.addedAt);
  if (when) parts.push(`${when} 추가`);
  if (!(acc && acc.active)) parts.push('누르면 활성으로 전환');
  return parts.join(' · ');
}

const CLAUDE_CURRENT_LOCK_TITLE = '현재 Claude CLI에 로그인된 계정이다 — 터미널에서 로그아웃한 뒤 제거한다';

// 계정 카드 — 활성 카드는 상태 표시라 본문이 정적이고, 비활성 카드는 본문 전체가
// 전환 button이다(이전 행 구조와 같은 규칙: 누를 게 있는 곳만 button, 전부 키보드
// 도달 가능). 우측 [재인증]·[제거]는 두 카드 모두 진짜 button — button 안에
// button을 넣지 않으려고 카드 자체는 div다. .uk-model-account-row 클래스는
// verify.js 검증7의 프로브(.uk-model-accounts .uk-model-account-row)가 센다.
function buildAccountCard(acc, { providerId, sourceLabel, onSwitch, onReauth, onRemove }) {
  const card = el('div', `uk-model-account-row uk-account-card${acc.active ? ' is-active' : ''}`);
  const titleRow = row('uk-account-title-row', [
    el('span', 'uk-model-account-label', acc.label),
    badge(!!acc.active, acc.active ? '활성' : '비활성'),
  ]);
  const sub = el('div', 'uk-account-sub', accountSubline(acc, sourceLabel(acc)));
  let main;
  if (acc.active) {
    main = row('uk-account-main', [titleRow, sub]);
  } else {
    main = el('button', 'uk-account-main uk-account-switch');
    main.type = 'button';
    main.setAttribute('aria-label', `${acc.label} — 눌러서 활성 계정으로 전환`);
    main.appendChild(titleRow);
    main.appendChild(sub);
    main.addEventListener('click', () => onSwitch(acc));
  }
  card.appendChild(main);

  const actions = el('div', 'uk-account-actions');
  actions.appendChild(iconButton('refresh', '재인증', {
    onClick: onReauth,
    title: '로그인 명령을 새 터미널 창에서 다시 실행한다',
  }));
  // Claude는 자격증명 파일이 하나뿐이라 지금 CLI가 들고 있는 로그인은 여기서
  // 못 지운다(cli-accounts.js remove()도 같은 이유로 거부한다) — 잠그고 이유를 단다.
  const locked = providerId === 'claude' && acc.current;
  actions.appendChild(iconButton('trash', '제거', locked
    ? { disabled: true, title: CLAUDE_CURRENT_LOCK_TITLE }
    : {
      onClick: () => askRemove(),
      title: providerId === 'codex' ? 'Athena 전용 Codex 로그인을 로그아웃한다' : '이전에 감지된 로그인 항목을 목록에서 지운다',
    }));
  card.appendChild(actions);

  // 계좌 카드의 삭제 확인 바와 같은 문법 — 카드 내용을 확인 바로 바꿨다가 취소·실패
  // 시 되돌린다. 성공 시에는 onRemove가 카드 전체를 다시 그린다.
  function askRemove() {
    const normal = [main, actions];
    clear(card);
    const { bar, cancelBtn, confirmBtn } = deleteConfirmBar(providerId === 'codex'
      ? `'${acc.label}' 계정을 제거할까요? Athena 전용 Codex 로그인이 로그아웃된다`
      : `'${acc.label}' 계정을 목록에서 제거할까요?`);
    confirmBtn.querySelector('.uk-btn-label').textContent = '제거';
    const restore = () => {
      clear(card);
      for (const c of normal) card.appendChild(c);
    };
    cancelBtn.addEventListener('click', restore);
    confirmBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      confirmBtn.disabled = true;
      confirmBtn.querySelector('.uk-btn-label').textContent = '제거 중…';
      const ok = await onRemove(acc);
      if (!ok) restore();
    });
    card.appendChild(bar);
  }

  return card;
}

// title/provider(athena:cli-list의 provider 항목, accounts:[{id,label,active,
// addedAt,current}])/description(섹션 설명)/accountsHint("계정" 소제목 아래 설명)/
// sourceLabel(acc → 카드 부제의 출처 문구)/optional(Codex처럼 "선택 사항" pill)/
// modelState({model,effort} 또는 null)/modelChips(null이면 Codex처럼 입력 하나만)/
// effortChips/disabled(모델·강도 컨트롤만 잠근다 — 계정 목록·로그인은 연결
// 상태와 무관하게 항상 조작 가능해야 "연결" 자체가 가능하다)/onModelChange/
// onAccountsChanged(계정 전환·로그인·제거 성공 시 카드 전체를 다시 그리라는 콜백)/
// errBox(공용 오류 표시 슬롯, 두 섹션이 공유).
function buildModelSection(opts) {
  const {
    title, provider, description, accountsHint, sourceLabel, optional,
    modelState, modelChips, effortChips, disabled, onModelChange, onAccountsChanged, errBox,
  } = opts;
  const accounts = (provider && provider.accounts) || [];
  const connected = accounts.length > 0;
  const s = modelState || {};

  const wrap = el('div', 'uk-model-section');
  const headRow = row('uk-model-section-head', [
    statusDot(connected, `${title} ${connected ? '연결됨' : '미연결'}`),
    el('span', 'uk-settings-name', title),
    pill(connected ? '연결됨' : '미연결', connected ? 'ok' : 'dim'),
  ]);
  if (optional) headRow.appendChild(pill('선택 사항', 'dim'));
  wrap.appendChild(headRow);
  wrap.appendChild(el('div', 'uk-provider-desc', description));

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

  // 성공하면 onAccountsChanged가 카드를 다시 그리므로 true, 실패면 카드가 원래
  // 모습으로 돌아가야 하므로 false를 돌려준다(buildAccountCard askRemove).
  async function doRemove(acc) {
    clear(errBox);
    try {
      const res = await window.athena.invoke('athena:cli-remove', { accountId: acc.id });
      if (!res || !res.ok) {
        errBox.appendChild(errorNote((res && res.message) || `${acc.label} 계정을 제거하지 못했다`));
        return false;
      }
    } catch (err) {
      errBox.appendChild(errorNote('계정 제거 기능을 아직 사용할 수 없다 (athena:cli-remove 핸들러 없음)'));
      return false;
    }
    onAccountsChanged();
    return true;
  }

  // ---- "계정" 소제목 + [+ 계정 추가] · 계정 카드 목록 — 연결 상태와 무관하게
  // 항상 조작 가능하다(미연결이면 빈 카드 한 장, 추가 버튼은 그대로). ----
  const block = el('div', 'uk-accounts-block');
  const headText = el('div');
  headText.appendChild(el('div', 'uk-accounts-title', '계정'));
  headText.appendChild(el('div', 'uk-accounts-hint', accountsHint));
  block.appendChild(row('uk-accounts-head', [headText, button('ghost', '+ 계정 추가', { onClick: doLogin })]));
  const accountsWrap = el('div', 'uk-model-accounts');
  if (connected) {
    for (const acc of accounts) {
      accountsWrap.appendChild(buildAccountCard(acc, {
        providerId: provider.id, sourceLabel, onSwitch: doSwitch, onReauth: doLogin, onRemove: doRemove,
      }));
    }
  } else {
    accountsWrap.appendChild(el('div', 'uk-account-empty', `연결된 ${title} 계정이 없다 — + 계정 추가를 누르면 로그인 명령이 새 터미널 창에서 실행되고, 로그인은 그 창에서 끝난다.`));
  }
  block.appendChild(accountsWrap);
  wrap.appendChild(block);

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
  const grokProvider = providers.find((p) => p.id === 'grok') || { id: 'grok', accounts: [] };
  const codexProvider = providers.find((p) => p.id === 'codex') || { id: 'codex', accounts: [] };
  const grokConnected = (grokProvider.accounts || []).length > 0;
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

  // 리드 — Paper 화면 18 상단. 카드 헤드 "모델"은 설정 카테고리, 이 리드가 패널의 제목이다.
  // 설명문은 Paper 18보다 한 공급자 길다: 보드는 Claude·Codex 둘만 그렸는데 이 카드는
  // Grok 섹션도 그린다(아래 buildModelSection 셋). 화면에 있는 것을 리드가 빠뜨리면
  // 거짓말이라 Grok을 넣었다 — Paper 18은 Grok 섹션째로 갱신돼야 한다.
  const lead = el('div', 'uk-provider-lead');
  lead.appendChild(el('div', 'uk-provider-lead-title', 'AI 제공업체 계정'));
  lead.appendChild(el('div', 'uk-provider-lead-desc', 'Athena는 이 컴퓨터의 Claude·Grok·Codex CLI 로그인을 그대로 쓴다. 질의는 활성 계정으로 실행되고, 모델·사고 강도는 공급자별로 정한다.'));
  body.appendChild(lead);

  body.appendChild(buildModelSection({
    title: 'Claude',
    provider: claudeProvider,
    description: '이 컴퓨터의 Claude CLI 로그인을 그대로 쓴다. 계정을 여러 개 오가려면 여기서 추가한다 — 로그인은 새 터미널 창에서 끝난다.',
    accountsHint: '이 컴퓨터에서 감지된 Claude 계정이다. 새 계정은 여기에 추가된다.',
    sourceLabel: (acc) => (acc.current ? '현재 CLI 로그인' : '이전 CLI 로그인'),
    modelState: modelState && modelState.claude,
    modelChips: CLAUDE_MODEL_CHIPS,
    effortChips: CLAUDE_EFFORT_CHIPS,
    disabled: false,
    onModelChange: (patch) => applyChange('claude', patch),
    onAccountsChanged: refresh,
    errBox,
  }));

  body.appendChild(el('div', 'uk-model-divider'));

  // Grok도 계정 카드를 그리는 갈래다 — sourceLabel이 없으면 계정이 하나라도
  // 감지된 순간 buildAccountCard가 던져 이 아래(Codex 섹션·안내문)가 통째로 안
  // 그려진다(2026-09-06 실측). 자격증명이 파일 하나인 것도 Claude와 같아 출처
  // 문구도 같다.
  body.appendChild(buildModelSection({
    title: 'Grok',
    provider: grokProvider,
    sourceLabel: (acc) => (acc.current ? '현재 CLI 로그인' : '이전 CLI 로그인'),
    modelState: modelState && modelState.grok,
    modelChips: GROK_MODEL_CHIPS,
    effortChips: GROK_EFFORT_CHIPS,
    disabled: !grokConnected,
    onModelChange: (patch) => applyChange('grok', patch),
    onAccountsChanged: refresh,
    errBox,
  }));

  body.appendChild(el('div', 'uk-model-divider'));

  body.appendChild(buildModelSection({
    title: 'Codex',
    provider: codexProvider,
    description: 'Codex 로그인은 Athena 전용 홈에 따로 보관된다 — 이 컴퓨터의 다른 Codex 로그인과 섞이지 않는다. 연결하지 않아도 질의는 Claude로 실행된다.',
    accountsHint: 'Athena 전용 홈에 보관된 Codex 로그인이다. 새 계정은 여기에 추가된다.',
    sourceLabel: () => 'Athena 전용 로그인',
    optional: true,
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
  note.appendChild(el('div', null, '활성 계정이 Claude면 claude CLI, Grok이면 grok CLI로 질의가 실행된다. Codex 설정은 $CODEX_HOME/config.toml에 반영되지만 질의 실행은 아직 Codex를 쓰지 않는다.'));
  note.appendChild(el('div', null, 'Claude·Grok CLI는 자격증명이 파일 하나다 — 목록의 활성 행은 지금 로그인된 계정이 아니면 전환되지 않고, 다른 계정은 계정 추가로 다시 로그인한다.'));
  note.appendChild(el('div', null, '모델 접근 권한은 활성 계정의 플랜을 따른다 — 접근 불가 모델이면 질의가 오류로 표면화된다.'));
  body.appendChild(note);
}


function renderHistory(grid) {
  const { card, head, body } = buildCardShell(grid, 'history');
  return refreshHistoryCard(card, head, body);
}


// 그래프 수집·노출 값(Paper 보드 22) — 무엇을 읽고 누구에게 보일지. 토글 화면은
// 그래프 모드 「수집·노출」 탭(lib/graph-mode/collection-settings.js)이 소유하고,
// 여기 남은 것은 그 탭과 설정 nav 배지가 함께 읽는 저장소 계약이다.
//
// 저장은 그래프 모드 설정(graph-mode-prefs.js)과 같은 이유로 localStorage다:
// 백엔드 실제 수집 주기는 아직 이 값을 읽지 않는 화면 쪽 토글 상태일 뿐이라
// 왕복할 값이 없다.
const GRAPH_SETTINGS_STORAGE_KEY = 'athena.graphSettings.prefs';

// 보유잔고 조회 주기 — Paper 보드 22는 60분만 보이지만 선택지는 최소한으로
// 늘려 뒀다(2026-08-26). 백엔드가 아직 이 값을 읽지 않는다는 한계는 위 주석과
// 같다 — 화면 쪽 선호값일 뿐이다.
const HOLDINGS_INTERVAL_MINUTES = Object.freeze([30, 60, 120]);

const GRAPH_SETTINGS_DEFAULTS = Object.freeze({
  collectChat: true,
  collectFills: true,
  collectHoldings: true,
  exposeToModel: true,
  holdingsIntervalMin: 60,
});

function normalizeGraphSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of Object.keys(GRAPH_SETTINGS_DEFAULTS)) {
    if (key === 'holdingsIntervalMin') continue;
    out[key] = typeof source[key] === 'boolean' ? source[key] : GRAPH_SETTINGS_DEFAULTS[key];
  }
  out.holdingsIntervalMin = HOLDINGS_INTERVAL_MINUTES.includes(source.holdingsIntervalMin)
    ? source.holdingsIntervalMin
    : GRAPH_SETTINGS_DEFAULTS.holdingsIntervalMin;
  return out;
}

function readGraphSettings(storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return { ...GRAPH_SETTINGS_DEFAULTS };
  let raw = null;
  try {
    raw = JSON.parse(store.getItem(GRAPH_SETTINGS_STORAGE_KEY));
  } catch {
    raw = null;
  }
  return normalizeGraphSettings(raw);
}

function writeGraphSettingsLocal(patch, storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const next = normalizeGraphSettings({ ...readGraphSettings(store), ...(patch || {}) });
  if (store) {
    try {
      store.setItem(GRAPH_SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 저장 실패(용량 초과·사생활 모드)는 화면을 막을 이유가 아니다 — graph-mode-prefs.js와 같은 판단.
    }
  }
  return next;
}

function writeGraphSettings(patch, storage) {
  const next = writeGraphSettingsLocal(patch, storage);
  // WP-I I4 — exposeToModel은 main이 prefs 영속 + backend 게이트 POST까지
  // 한 번에 처리하는 전용 채널로 미러링한다. 실패해도 로컬 토글 표시는 유지한다.
  if (patch && typeof patch.exposeToModel === 'boolean'
    && typeof window !== 'undefined' && window.athena && window.athena.invoke) {
    window.athena.invoke('athena:settings:expose-to-model:set', { enabled: next.exposeToModel }).catch(() => {});
  }
  return next;
}

async function setCollectChatPreference(enabled, storage) {
  try {
    if (typeof window === 'undefined' || !window.athena || typeof window.athena.invoke !== 'function') {
      throw new Error('settings bridge unavailable');
    }
    const result = await window.athena.invoke('athena:settings:prefs:set', { collectChat: enabled === true });
    if (!result || result.collectChat !== (enabled === true)) {
      throw new Error('collectChat preference was not applied');
    }
    return writeGraphSettingsLocal({ collectChat: result.collectChat }, storage);
  } catch (error) {
    writeGraphSettingsLocal({ collectChat: false }, storage);
    if (error instanceof Error && /대화 이력 수집(?:을 켜지 못했습니다|은 OFF로 유지됐지만 남은 원문을 삭제하지 못했습니다)/.test(error.message)) {
      throw error;
    }
    const action = enabled === true ? '켜지' : '변경하지';
    throw new Error(`대화 이력 수집을 ${action} 못했습니다. 개인정보 보호를 위해 OFF로 유지됩니다.`);
  }
}

// 카드가 그릴 행을 순수 함수로 뽑는다 — node --test가 여기를 잰다(DOM은
// verify-settings-cards.js가 본다). **없는 값은 행 자체를 만들지 않는다**: 보드가
// 그려 둔 성향 문구·보관 건수·용량·보존 기간은 목업 수치이고, 백엔드가 주지 않는
// 줄을 채우면 화면이 거짓말을 한다. 빈 자리가 정직하다.
function buildHistoryCardModel({ profileEntries, conversationCount, exposeToModel } = {}) {
  const interests = [];
  for (const entry of profileEntries || []) {
    const name = String((entry && entry.entity_name) || '').trim();
    if (name && !interests.includes(name)) interests.push(name);
  }
  return {
    profileRows: interests.length ? [['주요 관심', interests.join(' · ')]] : [],
    // Paper 32의 「성향 반영」 행. 학습된 값이 아니라 사람이 켜고 끈 설정이라
    // 따로 낸다 — 성향이 아직 없어도 이 행은 사실이다. 값의 주인은 그래프
    // 「수집·노출」 탭이고 설정 nav 배지도 같은 값을 읽는다. Paper가 적은
    // 「답변 어조에만 사용」은 실제로 넘기는 것을 축소해 말하므로 쓰지 않는다.
    preferenceRows: typeof exposeToModel === 'boolean'
      ? [['성향 반영', exposeToModel ? '켜짐 · 보유 종목·수량과 대화 원문 전달' : '꺼짐']]
      : [],
    storageRows: Number.isInteger(conversationCount) && conversationCount >= 0
      ? [['보관 중', `대화 ${conversationCount}건`]]
      : [],
  };
}

function historySection(title, aside) {
  const section = el('section', 'uk-history-section');
  const sectionHead = el('div', 'uk-history-section-head');
  sectionHead.appendChild(el('div', 'uk-history-section-title', title));
  if (aside) sectionHead.appendChild(el('div', 'uk-history-section-aside', aside));
  section.appendChild(sectionHead);
  return section;
}

function historyRow(label, value) {
  return row('uk-history-row', [
    el('div', 'uk-toggle-label', label),
    el('div', 'uk-history-value', value),
  ]);
}

// Paper 보드 32 「설정 — 성향·이력」. 이 카드는 **로컬에 무엇이 남아 있는지**를
// 말한다. 무엇을 모아 누구에게 보일지(보드 22 수집·노출)는 그래프 모드의
// 「수집·노출」 탭(lib/graph-mode/collection-settings.js)이 소유한다 — 같은 토글을
// 두 화면이 나눠 가지면 한쪽만 고쳐지는 날이 온다.
function refreshHistoryCard(card, head, body) {
  clear(head);
  clear(body);

  head.appendChild(row('uk-settings-title', [
    el('span', 'uk-settings-name', '성향·이력'),
    el('span', 'uk-settings-count', '로컬 보관 · 언제든 내보내기 가능'),
  ]));
  const actions = row('uk-settings-actions', []);
  actions.appendChild(cardCloseButton(card));
  head.appendChild(actions);

  const sections = el('div', 'uk-history-sections');
  body.appendChild(sections);

  const resultBox = el('div');
  body.appendChild(resultBox);

  const deleteRow = row('uk-btn-row-end', []);
  const exportBtn = button('ghost', '이력 내보내기', { onClick: () => onExportClick() });
  const deleteBtn = button('ghost', '전체 삭제', { onClick: () => onDeleteClick() });
  deleteBtn.classList.add('is-danger');
  deleteRow.appendChild(exportBtn);
  deleteRow.appendChild(deleteBtn);
  body.appendChild(deleteRow);

  const foot = el('div', 'uk-settings-note');
  foot.appendChild(el('div', null, '삭제는 확인 단계를 한 번 더 거치며 되돌릴 수 없습니다'));
  body.appendChild(foot);

  fillHistorySections();

  // 성향도 보관 건수도 브레인에서 읽는다 — 이 카드의 두 버튼(내보내기 · 전체
  // 삭제)이 다루는 저장소와 같아야 지운 뒤에 줄어든다. 로컬 세션 원장을 세면
  // 전체 삭제가 건드리지도 않는 수를 말하게 된다. 한쪽이 실패해도 다른 쪽은 그린다.
  async function fillHistorySections() {
    const [profile, listed] = await Promise.all([
      window.athena.invoke('athena:brain-profile-summary', { limit: 5 }).catch(() => null),
      window.athena.invoke('athena:brain-conversations-count').catch(() => null),
    ]);
    const model = buildHistoryCardModel({
      profileEntries: (profile && profile.ok && profile.entries) || [],
      conversationCount: (listed && listed.ok) ? listed.conversations : null,
      exposeToModel: readGraphSettings().exposeToModel,
    });

    clear(sections);
    const learned = model.profileRows.length > 0;
    const profileSection = historySection('투자 성향', learned ? '대화에서 학습됨' : null);
    if (learned) {
      for (const [label, value] of model.profileRows) profileSection.appendChild(historyRow(label, value));
    } else {
      profileSection.appendChild(emptyState('아직 학습된 성향이 없습니다', '대화가 쌓이면 여기에 보입니다'));
    }
    for (const [label, value] of model.preferenceRows) profileSection.appendChild(historyRow(label, value));
    sections.appendChild(profileSection);

    const storageSection = historySection('대화 이력');
    if (model.storageRows.length) {
      for (const [label, value] of model.storageRows) storageSection.appendChild(historyRow(label, value));
    } else {
      storageSection.appendChild(errorNote('보관 상태를 읽지 못했습니다'));
    }
    sections.appendChild(storageSection);
  }

  async function onExportClick() {
    clear(resultBox);
    const label = exportBtn.querySelector('.uk-btn-label');
    exportBtn.disabled = true;
    label.textContent = '내보내는 중…';
    let res;
    try {
      res = await window.athena.invoke('athena:history-export');
    } catch (err) {
      res = { ok: false, error: String((err && err.message) || err) };
    }
    label.textContent = '이력 내보내기';
    exportBtn.disabled = false;
    if (!res || !res.ok) {
      resultBox.appendChild(errorNote((res && res.error) || '내보내기에 실패했습니다'));
      return;
    }
    if (res.canceled) return;
    const note = el('div', 'uk-settings-note');
    note.appendChild(el('div', null, `내보내기 완료 — 대화 ${res.conversations}건 · 메시지 ${res.messages}건`));
    note.appendChild(el('div', null, res.path));
    // 바로 옆이 되돌릴 수 없는 「전체 삭제」다 — 다 담기지 않았다면 지우기 전에 말한다.
    if (res.truncated) note.appendChild(el('div', null, '이력이 많아 일부는 담기지 않았습니다'));
    resultBox.appendChild(note);
  }

  function onDeleteClick() {
    clear(resultBox);
    const { bar, cancelBtn, confirmBtn } = deleteConfirmBar(
      '채팅 이력과 투자 성향을 전부 삭제할까요? 되돌릴 수 없습니다.',
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
        resultBox.appendChild(errorNote((res && res.error) || '삭제에 실패했습니다'));
        deleteBtn.disabled = false;
        return;
      }
      const note = el('div', 'uk-settings-note');
      if (res.selfSpawned) {
        note.appendChild(el('div', null, res.restarted
          ? '삭제 완료 — 브레인이 재기동 중이거나 이미 재기동됐습니다.'
          : '삭제 완료 — 브레인 재기동 확인에 실패했습니다. 직접 재시작해야 할 수 있습니다.'));
      } else {
        note.appendChild(el('div', null, '삭제 완료 — 이 앱이 띄운 백엔드가 아니라 자동으로 재기동하지 않습니다. 백엔드를 직접 재시작하세요.'));
      }
      resultBox.appendChild(note);
      // 브레인을 비웠으니 카드가 보여 주던 성향·보관 건수는 이미 옛 값이다 —
      // 다시 읽어야 화면이 방금 지운 것을 계속 말하지 않는다.
      fillHistorySections();
    });
  }
}

// UMD 각주(2026-08-18 렌더러 격리) — sanitize.js와 같은 패턴.
const __exports = {
  renderAccounts, renderScreen, renderModel, renderHistory, renderNav,
  accountSubline, formatAddedAt, accountSheetState,
  buildHistoryCardModel,
  normalizeGraphSettings, readGraphSettings, writeGraphSettings, setCollectChatPreference,
  GRAPH_SETTINGS_DEFAULTS,
  HOLDINGS_INTERVAL_MINUTES,
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.SettingsCards = __exports;
}

})();
