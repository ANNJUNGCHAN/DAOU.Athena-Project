// 계좌(AT-ST-001/002/003) · MCP(AT-ST-004/005/006) 제어 캔버스 카드.
//
// 배치 근거: plan/paper-specs/00-통합-계획.md §1.2/1.3 — 두 화면 모두 "캔버스 창 ›
// 제어 캔버스" 카드 하나이고, 등록·활성화·승인·probe 네 화면은 새 카드/새 창이
// 아니라 이 두 카드 내부의 시트(오버레이)다. canvas.js의 addCard() 스위치에
// stream/reader/table과 같은 자리로 얹힌다.
//
// 렌더링 계약은 lib/ui-kit.js·lib/markdown.js와 동일: innerHTML에 문자열을 넣지
// 않는다. 계좌 별칭, MCP 별칭·실행 명령·upstream 툴 설명(backend/athena_mcp/
// SECURITY.md §3이 명시한 프롬프트 인젝션 표면)은 전부 textContent로만 그린다.
//
// 비밀값 원칙(AT-ST-007, 부록이지만 모든 화면을 구속한다):
// - APP KEY/SECRET KEY 값은 입력 요소 → 메인 프로세스行 IPC 인자로만 흐른다.
//   읽어들인 뒤 바깥 스코프 변수에 담지 않고, invoke 직후 입력 요소도 비운다.
// - 화면은 문자 수만 보여준다 — ui-kit의 secretMask(charCount)가 그 계약을
//   코드로 강제한다(값이 아니라 개수만 받는 함수라 값 자체가 이 모듈에 닿을 수
//   없다).
// - MCP 스니펫 붙여넣기 textarea는 사용자가 붙여넣은 JSON 원문(그 안에 실제 env
//   비밀값이 섞여 있을 수 있다)을 담을 수 있는 유일한 입력이다. 분석
//   완료(athena:mcp-stage-snippet) 후에는 그 원문을 다시 읽어 다른 DOM 노드로
//   재현하지 않는다 — envKeys(키 이름만)·risks만 렌더한다.
//
// 데이터는 전부 실제 IPC 핸들러 호출 결과다. 목업을 만들지 않는다 — 핸들러가
// 아직 없으면(메인 프로세스 작업이 병행 중이라 있을 수 있다) 빈 카드에 예외를
// 던지는 대신 emptyState + errorNote를 그린다.

const { ipcRenderer } = require('electron');
const {
  el, row, statusDot, badge, arrowIcon, button, progressDots, labeledRow,
  sheet, secretMask, emptyState, errorNote, clear,
} = require('./ui-kit');

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
    data = await ipcRenderer.invoke('athena:account-list');
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
  head.appendChild(button('ghost', '+ 계좌 등록', { onClick: () => openAccountRegisterSheet(card, refresh) }));

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

function buildAccountsTable(accounts, refresh, openOrderApi) {
  const wrap = el('div');
  wrap.appendChild(row('uk-col-head', [
    el('span', 'uk-col-alias', '별칭'),
    el('span', 'uk-col-appkey', '앱키'),
    el('span', 'uk-col-orderapi', '주문 API'),
    el('span', 'uk-col-status', '연결 상태'),
    el('span', 'uk-col-lastcheck', '마지막 검증'),
  ]));

  for (const a of accounts) {
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

    const r = row('uk-row', [aliasCell, appkeyCell, orderApiCell, statusCell, lastCheckCell]);
    if (!a.active) {
      r.classList.add('is-clickable');
      r.addEventListener('click', async () => {
        try {
          await ipcRenderer.invoke('athena:account-set-active', { id: a.id });
        } catch { /* 핸들러 부재 — 조용히 무시하지 않되 카드 전체를 깨뜨리지 않는다 */ }
        refresh();
      });
    }
    wrap.appendChild(r);
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
      res = await ipcRenderer.invoke('athena:account-register', { alias, appKey, secretKey });
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
        const res = await ipcRenderer.invoke('athena:order-api-set', { id: account.id, enabled: false });
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
      const res = await ipcRenderer.invoke('athena:order-api-set', { id: account.id, enabled: toggleState });
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
    data = await ipcRenderer.invoke('athena:mcp-list');
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
  head.appendChild(actions);

  if (!servers.length) {
    body.appendChild(emptyState('등록된 MCP 서버가 없다', '스니펫 붙여넣기 또는 + 서버 등록으로 시작한다'));
  } else {
    body.appendChild(buildMcpTable(servers, (alias) => openMcpProbeSheet(card, alias, refresh)));
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

function buildMcpTable(servers, onRowClick) {
  const wrap = el('div');
  wrap.appendChild(row('uk-col-head', [
    el('span', 'uk-col-mcpalias', '별칭'),
    el('span', 'uk-col-mcpstatus', '상태'),
    el('span', 'uk-col-mcptools', '허용 툴'),
    el('span', 'uk-col-mcpcmd', '실행 명령'),
  ]));

  for (const s of servers) {
    const aliasCell = el('div', 'uk-col-mcpalias');
    aliasCell.appendChild(el('div', 'uk-cell-strong', s.alias));
    if (Array.isArray(s.warnings)) {
      for (const w of s.warnings) aliasCell.appendChild(el('div', 'uk-mcp-warning', `⚠ ${w}`));
    }

    const statusCell = el('div', 'uk-col-mcpstatus');
    statusCell.appendChild(mcpStatusPill(s));

    const toolsCell = el('div', 'uk-col-mcptools uk-mono-faint', s.toolCount != null ? `${s.toolCount}개` : '—');

    // "자르지 않는다" (AT-ST-004 Desc 3) — CSS에 텍스트 말줄임(ellipsis)을
    // 적용하지 않고 그대로 줄바꿈되도록 둔다. command/argsPreview는 main
    // 프로세스가 채워주는 그대로다.
    const cmdText = [s.command, s.argsPreview].filter(Boolean).join(' ');
    const cmdCell = el('div', 'uk-col-mcpcmd uk-cmd', cmdText);

    const r = row('uk-row is-clickable', [aliasCell, statusCell, toolsCell, cmdCell]);
    r.addEventListener('click', () => onRowClick(s.alias));
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
      const res = await ipcRenderer.invoke('athena:mcp-stage-snippet', { snippet });
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
      const registerRes = await ipcRenderer.invoke('athena:mcp-register', { staged });
      if (!(registerRes && registerRes.ok)) {
        gateErrBox.appendChild(errorNote((registerRes && registerRes.error) || '등록에 실패했다'));
        return;
      }
      const approveRes = await ipcRenderer.invoke('athena:mcp-approve', { alias: registerRes.alias || staged.alias });
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
  const { root, body } = sheet(`probe 결과 · ${alias}`, { onClose: () => detachSheet(card, root) });
  attachSheet(card, root);
  runProbe();

  async function runProbe() {
    clear(body);
    body.appendChild(emptyState('probe 실행 중…'));
    let res;
    let threw = false;
    try {
      res = await ipcRenderer.invoke('athena:mcp-probe', { alias });
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
          try { await ipcRenderer.invoke('athena:mcp-approve', { alias }); } catch { /* 무시 — 아래 재probe가 실패를 다시 보여준다 */ }
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
        // t.description은 upstream MCP 서버가 자체 보고한 문자열이다
        // (backend/athena_mcp/SECURITY.md §3 — 프롬프트 인젝션 표면). 게이트웨이가
        // 이미 서버 쪽에서 출처를 라벨링하므로 여기서 또 "(업스트림)" 같은 접두를
        // 덧붙이지 않는다 — textContent로만, 있는 그대로 그린다.
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
          const r = await ipcRenderer.invoke('athena:mcp-allow-tool', { alias, tool: t.name, allowed: nowAllowed });
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

module.exports = { renderAccounts, renderMcp };
