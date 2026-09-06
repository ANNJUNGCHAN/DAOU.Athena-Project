// 좌측 이력 사이드바(리프 1.2.2, Paper 보드 04/05/08/16). 우측 채팅과 동등한
// "영역" — chat.js/canvas.js처럼 자기 <script> 태그로 독립적으로 산다. 서로
// 다른 영역은 shell.js의 window.AthenaShell 버스로만 넘나든다(chat.js가
// registerOpenSettings로 openSettings()를 등록해둔 것을 여기서 부른다).
//
// 데이터는 세 갈래 전부 실제 소스다 — 목업 하드코딩 없음:
//   · 이력 목록      athena:conversations-list (lib/main/conversations.js)
//   · 계정 발치      athena:account-list + athena:auth-token-status
//   · 알림 파생 방    athena:routine-event(type:'routine-fired') — 세션 메모리만,
//                     디스크에 남기지 않는다(라우틴 자체가 백엔드 상태의 파생물이라
//                     여기서 다시 영속화하면 두 개의 진실이 생긴다).
//
// 정직 기록: 옛 세션(오늘이 아닌 날짜의 항목)을 클릭해도 그 대화가 다시
// 열리지 않는다 — main.js historyConversationId()가 "대화는 앱 수명 단위다"로
// 이미 고정한 결정이고(conversations.js 상단 주석), 이 파일은 그 결정을
// 몰래 뒤집지 않는다. 선택 표시는 실제로 저장되는 상태(activeId)만 반영한다.
(function () {
  'use strict';

  const $list = document.getElementById('sidebarList');
  const $newChat = document.getElementById('sidebarNewChat');
  const $searchToggle = document.getElementById('sidebarSearchToggle');
  const $searchInput = document.getElementById('sidebarSearchInput');
  const $compactToggle = document.getElementById('sidebarCompactToggle');
  const $historyRegion = document.getElementById('historyRegion');
  const $modeTotal = document.getElementById('sidebarModeTotal');
  const $accountRow = document.getElementById('sidebarAccountRow');
  const $accountDot = document.getElementById('sidebarAccountDot');
  const $accountAlias = document.getElementById('sidebarAccountAlias');
  const $accountToken = document.getElementById('sidebarAccountToken');
  const $accountMenu = document.getElementById('sidebarAccountMenu');
  const $history = document.getElementById('history');
  const $input = document.getElementById('input');
  const $roomBanner = document.getElementById('roomHeadBanner');
  const $roomTime = document.getElementById('roomHeadTime');
  const $roomTitle = document.getElementById('roomHeadTitle');

  if (!$list) return; // shell.html 계약이 깨진 경우 — 조용히 물러난다(다른 영역을 막지 않는다).

  // ---------- 모드 네비(리프 1.2.2, Paper 보드 37/44) ----------
  // #graphPill을 대체한다 — 클릭이 캔버스 3영역을 바꾸는 유일한 사람 진입로다.
  // window.AthenaCanvasMode는 canvas.js가 이 스크립트보다 나중에(shell.html 로드
  // 순서) 세운다 — 그래서 모듈 로드 시점이 아니라 클릭 시점에만 참조한다(기존
  // $newChat의 window.AthenaShell 참조와 같은 패턴, 이 파일 위 머리말 참고).
  const modeNav = (window.AthenaLib && window.AthenaLib.SidebarModeNav)
    ? window.AthenaLib.SidebarModeNav.createSidebarModeNav({
        items: {
          summary: document.getElementById('modeNavSummary'),
          graph: document.getElementById('modeNavGraph'),
          agent: document.getElementById('modeNavAgent'),
          plugin: document.getElementById('modeNavPlugin'),
          backtest: document.getElementById('modeNavBacktest'),
        },
        badge: document.getElementById('modeNavAgentBadge'),
        counts: {
          summary: document.getElementById('modeNavSummaryCount'),
          graph: document.getElementById('modeNavGraphCount'),
          agent: document.getElementById('modeNavAgentCount'),
          plugin: document.getElementById('modeNavPluginCount'),
          backtest: document.getElementById('modeNavBacktestCount'),
        },
        onSelect: (view) => {
          // 모드가 대화의 경계다(40번 보드 · lib/main/conversations.js touch()
          // 주석 "모드는 만들 때 한 번 정해지고 바뀌지 않는다") — 그러면 모드를
          // 바꿀 때 그 모드의 새 대화로 갈아타야 경계가 성립한다.
          //
          // 이 배선이 없어서 캔버스만 바뀌고 채팅 스레드는 그대로 넘어갔다
          // (실측 probe-graph-mode-exit.js: 그래프 모드에서 심은 턴이 대화 모드에
          // 그대로 남았고 activeId도 같았다 — 화면 절반은 아직 앞 모드였다).
          // 그래서 그래프 접두가 대화 모드 문맥 위에 얹히고, 대화 모드에 그래프
          // 추천 질문이 남았다(2026-09-03 제보).
          //
          // 지금 보고 있는 모드를 다시 누른 것이면 갈아타지 않는다 — 같은 탭을
          // 눌렀다고 쓰던 대화를 버리면 그건 기능이 아니라 사고다.
          const previousView = currentMode();
          const modeChanged = previousView !== view;
          if (window.AthenaCanvasMode && typeof window.AthenaCanvasMode.setView === 'function') {
            window.AthenaCanvasMode.setView(view);
          }
          if (view === 'plugin'
              && window.AthenaPluginCanvas
              && typeof window.AthenaPluginCanvas.setView === 'function') {
            window.AthenaPluginCanvas.setView('hub');
          }
          if (view === 'backtest'
              && window.AthenaBacktestCanvas
              && typeof window.AthenaBacktestCanvas.refresh === 'function') {
            window.AthenaBacktestCanvas.refresh();
          }
          // 에이전트모드 진입 시 라우틴 목록을 새로 받아온다(리프 1.2.2, 3단계) —
          // loadAgentRoutines()가 안에서 renderList()까지 호출한다. 캔버스 쪽
          // 통계·리스트도 같은 진입점에서 새로고침한다(4단계, canvas.js가
          // window.AthenaAgentCanvas로 노출). 다른 모드는 라우틴 섹션과
          // 무관하니 사이드바만 다시 그린다(대화 이력 복원).
          if (view === 'agent') {
            loadAgentRoutines();
            if (window.AthenaAgentCanvas && typeof window.AthenaAgentCanvas.refresh === 'function') {
              window.AthenaAgentCanvas.refresh();
            }
          } else if (!modeChanged) {
            renderList();
          }
          // 새 대화로 갈아타기 — 위 renderList()를 modeChanged일 때 건너뛴 이유가
          // 이것이다. startNewConversation()은 clearConversationUi()로 채팅을 비우고
          // 목록까지 다시 그린다(그 함수 주석 참고). 여기서 또 부르면 두 번 그린다.
          if (modeChanged) startNewConversation(currentProjectId, view);
        },
      })
    : null;

  // 11단계(프로액티브, Paper 보드 42) — "그래프 모드에서 근거 보기 →"가 이
  // 모드 네비를 그대로 재사용한다. setView만 부르면 캔버스는 그래프로
  // 바뀌는데 이 네비의 활성 표시는 안 바뀌는 불일치가 생긴다 — setActive도
  // 같이 노출한다(모드 네비 자신의 클릭 핸들러가 이미 하는 것과 동일한 순서).
  if (modeNav) window.AthenaModeNav = { setActive: modeNav.setActive };

  // 3단계(리프 1.2.2, Paper 보드 39 보강본) — 순수 포매팅/상태아이콘은
  // agent-sidebar-list.js가 갖고 DOM은 여기서 조립한다(다른 make*Item과 같은 자리).
  const agentSidebarList = window.AthenaLib && window.AthenaLib.AgentSidebarList;
  // 프로젝트 행이 "무엇을 보일까"(⋯ 셋·모드 다섯·삭제 확인)는 순수 함수 쪽에 있다
  // (36·37·38번 보드, sidebar-project-menu.js) — 여기서는 DOM 조립과 IPC 왕복만.
  const projectMenu = window.AthenaLib && window.AthenaLib.SidebarProjectMenu;
  let agentRoutinesCache = [];
  let agentRoutinesRequestId = 0; // stale-응답 가드 — 아래 주석 참고.

  function currentMode() {
    return (window.AthenaCanvasMode && window.AthenaCanvasMode.state && window.AthenaCanvasMode.state.view) || 'summary';
  }

  // GET /api/v1/routines 실데이터(IPC 경유, 기존 athena:routines-list 채널 —
  // chat.js의 #routineChip이 이미 쓰는 것과 동일) → active/paused만 우선 노출.
  // 백엔드 미기동이면 조용히 빈 목록(없는 걸 있다고 꾸미지 않는다, #routineChip과 같은 태도).
  //
  // requestId로 낡은 응답을 버린다: 사용자가 에이전트모드를 짧게 오갔다 다시
  // 들어오면 왕복 두 개가 동시에 떠 있을 수 있고, 네트워크 사정상 먼저 보낸
  // 쪽이 나중에 돌아올 수 있다 — 그걸 그대로 적용하면 최신 화면이 낡은
  // 데이터로 덮인다(실측: verify.js 3단계 검증에서 이 역전이 실제로 재현됨).
  async function loadAgentRoutines() {
    const requestId = ++agentRoutinesRequestId;
    if (!agentSidebarList) { renderList(); return; }
    let rows = [];
    try {
      const res = await window.athena.invoke('athena:routines-list');
      const routines = res && res.ok && res.data && Array.isArray(res.data.routines)
        ? res.data.routines : [];
      rows = agentSidebarList.buildAgentSidebarRows(routines);
    } catch {
      rows = [];
    }
    if (requestId !== agentRoutinesRequestId) return; // 그 사이 더 최신 요청이 갔다 — 이 응답은 버린다.
    agentRoutinesCache = rows;
    renderList();
  }

  const INITIAL_VISIBLE = 6; // "더 보기" 이전에 보이는 지난 7일 이전 항목 수(Paper 보드 04 실측)

  let conversationsCache = [];
  let projectsCache = [];
  let currentProjectId = null;
  let activeConversationId = null;
  let openProjectMenuId = null;
  // 프로젝트 행이 여는 것은 넷(⋯ 메뉴·모드 선택·삭제 확인·프로젝트 수정)이고 한 번에 하나만 열린다.
  let openModePickerId = null;
  let openRemoveProjectId = null;
  let projectRemoveDraft = '';  // 5초 폴링 재렌더가 입력을 지우지 않게 초안을 밖에 둔다.
  let projectRemoveHint = '';   // IPC가 거절한 이유(name_mismatch 등) 한 줄.
  let openEditProjectId = null; // '프로젝트 수정' 패널(29번 보드) — 삭제 확인과 같은 렌더 상태.
  let projectEditDraft = null;  // { label, description } — 재렌더가 타이핑을 지우지 않게 밖에 둔다.
  let projectEditHint = '';     // IPC가 거절한 이유(invalid_label 등) 한 줄.
  let selectedNotifyId = null;
  let showOlder = false;
  let searchQuery = '';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function pencilIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M4 20h4.2L19 9.2 14.8 5 4 15.8V20Zm9.4-13.6 4.2 4.2');
    svg.appendChild(path);
    return svg;
  }

  function makeSectionLabel(text, extraClass) {
    const label = el('div', extraClass ? `sidebar-section-label ${extraClass}` : 'sidebar-section-label');
    label.textContent = text;
    return label;
  }

  // 대화 행 앞의 모드 아이콘(35번 보드 "모드 아이콘 · 제목 · 실행 점"의 첫 레인). 목록이
  // 더는 모드로 걸러지지 않으므로(renderList) 이 아이콘이 그 대화의 모드를 말하는 유일한
  // 표시다. 모드 네비(#sidebarModeNav)의 SVG를 그대로 복제한다 — 아이콘 원본이 둘이면
  // 한쪽만 바뀌는 날이 온다. 네비에 없는 모드는 빈 슬롯으로 자리만 지켜 제목 레인이
  // 흔들리지 않는다.
  function makeModeIcon(mode) {
    const slot = el('span', 'sidebar-item-mode-ic');
    const snapshot = window.AthenaLib && window.AthenaLib.SessionSnapshot;
    const historyView = window.AthenaLib && window.AthenaLib.SessionHistoryView;
    const view = snapshot ? snapshot.modeToView(mode) : 'summary';
    const source = document.querySelector(
      `#sidebarModeNav .sidebar-mode-item[data-view="${view}"] .sidebar-mode-item-ic`,
    );
    if (source) slot.appendChild(source.cloneNode(true));
    const label = snapshot && historyView && historyView.MODE_LABELS
      ? historyView.MODE_LABELS[snapshot.viewToMode(mode)]
      : null;
    if (label) {
      slot.setAttribute('role', 'img');
      slot.setAttribute('aria-label', `${label} 모드`);
    } else {
      slot.setAttribute('aria-hidden', 'true');
    }
    return slot;
  }

  function makeConversationItem(conv, projection) {
    const btn = el('button', projection === 'project'
      ? 'sidebar-item sidebar-project-conversation'
      : 'sidebar-item sidebar-recent-conversation');
    btn.type = 'button';
    btn.title = conv.title;
    btn.dataset.conversationId = conv.id;
    btn.dataset.projectId = conv.projectId || '';
    const isSelected = conv.id === activeConversationId && !selectedNotifyId;
    if (isSelected) btn.classList.add('is-selected', 'is-current-conversation');
    btn.appendChild(makeModeIcon(conv.mode));
    const label = el('span', 'sidebar-item-label');
    label.textContent = conv.title;
    btn.appendChild(label);
    // 점 하나로 읽는 네 가지 상태(39번 보드): 실행 중은 스피너, 대기 주황, 완료 회색,
    // 실패 빨강. 상태가 없으면 아무것도 그리지 않는다 — 없는 실행을 있다고 하지 않는다.
    if (conv.runState && RUN_STATE_LABELS[conv.runState]) {
      const run = el('span', `sidebar-item-run sidebar-item-run-${conv.runState}`);
      run.setAttribute('role', 'img');
      run.setAttribute('aria-label', RUN_STATE_LABELS[conv.runState]);
      btn.classList.add(`is-run-${conv.runState}`);
      btn.appendChild(run);
    }
    if (isSelected) {
      const dot = el('span', 'sidebar-item-dot sidebar-current-dot');
      btn.appendChild(dot);
    }
    btn.addEventListener('click', () => selectConversation(conv.id));
    return btn;
  }

  function closeProjectMenus(except) {
    if (!except) openProjectMenuId = null;
    for (const menu of $list.querySelectorAll('.sidebar-project-menu')) {
      if (menu === except) continue;
      menu.hidden = true;
      const actions = menu.parentElement;
      if (actions) actions.classList.remove('is-open');
      const trigger = actions && actions.querySelector('.sidebar-project-menu-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }
  }

  // 모드 선택·삭제 확인은 렌더 상태로만 산다(⋯ 메뉴처럼 DOM에 미리 만들어두지
  // 않는다) — 상태를 지운 뒤 다시 그려야 사라진다. 무언가 열려 있었는지를
  // 돌려줘서 호출자가 불필요한 재렌더를 피한다.
  function resetProjectPopovers() {
    const had = Boolean(openModePickerId || openRemoveProjectId || openEditProjectId);
    openModePickerId = null;
    openRemoveProjectId = null;
    projectRemoveDraft = '';
    projectRemoveHint = '';
    openEditProjectId = null;
    projectEditDraft = null;
    projectEditHint = '';
    return had;
  }

  // 상태를 지우면서 이미 그려진 노드도 그 자리에서 감춘다 — closeProjectMenus와
  // 같은 방식이다. 여기서 다시 그리면 mousedown 도중 DOM이 갈려 그 다음에 올
  // click이 사라진 노드 위에서 죽는다(+ 폴더 추가·더 보기가 한 번에 안 눌린다).
  function closeProjectPopovers() {
    resetProjectPopovers();
    for (const node of $list.querySelectorAll(
      '.sidebar-mode-picker, .sidebar-project-remove, .sidebar-project-edit, .sidebar-project-description',
    )) {
      node.hidden = true;
    }
    for (const btn of $list.querySelectorAll('.sidebar-project-new-chat')) {
      btn.setAttribute('aria-expanded', 'false');
    }
    closeProjectMenus();
  }

  async function toggleProjectPin(project) {
    let snap = null;
    try {
      snap = await window.athena.invoke('athena:project-pin', { id: project.id, pinned: !project.pinned });
    } catch (e) {
      console.warn('프로젝트 고정 실패', e);
      return;
    }
    // 고정은 정렬을 바꾼다 — 응답 스냅샷이 그 순서의 진실이라 그대로 갈아끼운다.
    if (snap && Array.isArray(snap.projects)) projectsCache = snap.projects;
    if (snap && Array.isArray(snap.conversations)) conversationsCache = snap.conversations;
    updateModeCounts();
    renderList();
  }

  async function revealProject(project) {
    try {
      const res = await window.athena.invoke('athena:project-reveal', { id: project.id });
      if (!res || !res.ok) console.warn('탐색기에서 열기 실패', (res && (res.reason || res.error)) || '');
    } catch (e) {
      console.warn('탐색기에서 열기 실패', e);
    }
  }

  const REMOVE_FAIL_HINT = {
    name_mismatch: '이름이 달라 아무것도 지우지 않았습니다.',
    default_project: '기본 프로젝트는 지울 수 없습니다.',
    unknown_project: '이미 없는 프로젝트입니다.',
    rm_failed: '폴더를 지우지 못했습니다.',
  };

  async function removeProject(project, typed) {
    let res = null;
    try {
      res = await window.athena.invoke('athena:project-remove', { id: project.id, confirmName: typed });
    } catch (e) {
      console.warn('프로젝트 제거 실패', e);
      res = null;
    }
    if (res && res.ok) {
      closeProjectPopovers();
      loadConversations();
      return;
    }
    projectRemoveHint = (res && REMOVE_FAIL_HINT[res.reason]) || '프로젝트를 지우지 못했습니다.';
    renderList();
  }

  // 폴더 대화상자는 main이 띄운다 — 여기서는 결과 네 갈래를 받아 화면만 맞춘다.
  async function addProjectFolder() {
    let res = null;
    try {
      res = await window.athena.invoke('athena:project-add');
    } catch (e) {
      console.warn('프로젝트 추가 실패', e);
      return;
    }
    if (!res) return;
    if (res.canceled) return;
    if (res.ok) { loadConversations(); return; }
    // 같은 폴더를 두 번 등록하지 않는다(main.js folder_taken) — 새로 만드는 대신
    // 이미 있는 그 프로젝트로 선택을 옮긴다.
    if (res.reason === 'folder_taken') {
      if (res.project && res.project.id) currentProjectId = res.project.id;
      renderList();
      return;
    }
    console.warn('프로젝트 추가 실패', res.error || res.reason || '');
  }

  function makeProjectAddButton() {
    const btn = el('button', 'sidebar-project-add');
    btn.type = 'button';
    btn.textContent = '+ 폴더 추가';
    btn.title = '폴더를 골라 프로젝트로 추가';
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      closeProjectPopovers();
      addProjectFolder();
    });
    return btn;
  }

  // 펜 = 새 대화창(38번 보드) — 어느 모드로 열지를 사람이 고른다.
  function makeModePicker(project) {
    const picker = el('div', 'sidebar-mode-picker');
    picker.setAttribute('role', 'menu');
    picker.setAttribute('aria-label', `${project.label} 새 대화창`);
    const choices = projectMenu ? projectMenu.modeChoices() : [];
    for (const choice of choices) {
      const btn = el('button', 'sidebar-mode-picker-item');
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      btn.dataset.view = choice.view;
      btn.appendChild(el('span', 'sidebar-mode-picker-label', choice.label));
      btn.appendChild(el('span', 'sidebar-mode-picker-hint', choice.hint));
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        closeProjectPopovers();
        startNewConversation(project.id, choice.view);
        // 고른 모드로 화면까지 옮긴다 — 대화만 그 모드로 만들고 캔버스가 그대로면
        // 방금 무엇을 골랐는지가 화면 어디에도 안 남는다.
        if (window.AthenaCanvasMode && typeof window.AthenaCanvasMode.setView === 'function') {
          window.AthenaCanvasMode.setView(choice.view);
        }
        if (window.AthenaModeNav && typeof window.AthenaModeNav.setActive === 'function') {
          window.AthenaModeNav.setActive(choice.view);
        }
      });
      picker.appendChild(btn);
    }
    return picker;
  }

  // 제거는 폴더를 지우는 영구 삭제라 이름을 그대로 다시 쳐야 열린다(37번 보드).
  function makeProjectRemovePanel(project) {
    const panel = el('div', 'sidebar-project-remove');
    panel.appendChild(el('p', 'sidebar-project-remove-copy',
      '폴더와 그 안의 모든 파일이 지워집니다. 되돌릴 수 없습니다.'));
    if (project.path) panel.appendChild(el('p', 'sidebar-project-remove-path', project.path));
    const input = el('input', 'sidebar-project-remove-input');
    input.type = 'text';
    input.placeholder = '프로젝트 이름을 그대로 입력';
    input.value = projectRemoveDraft;
    panel.appendChild(input);
    const hint = el('p', 'sidebar-project-remove-hint');
    panel.appendChild(hint);
    const cancel = el('button', 'sidebar-project-remove-cancel', '취소');
    cancel.type = 'button';
    const confirm = el('button', 'sidebar-project-remove-confirm is-danger', '영구 삭제');
    confirm.type = 'button';
    const sync = () => {
      const state = projectMenu
        ? projectMenu.removeConfirmState(project, input.value)
        : { canRemove: false, hint: '' };
      confirm.disabled = !state.canRemove;
      hint.textContent = projectRemoveHint || state.hint;
    };
    input.addEventListener('input', () => {
      projectRemoveDraft = input.value;
      projectRemoveHint = ''; // 다시 치기 시작하면 지난 거절 이유는 낡은 말이 된다.
      sync();
    });
    cancel.addEventListener('click', (event) => {
      event.stopPropagation();
      closeProjectPopovers();
      renderList();
    });
    confirm.addEventListener('click', (event) => {
      event.stopPropagation();
      removeProject(project, input.value);
    });
    sync();
    panel.appendChild(cancel);
    panel.appendChild(confirm);
    return panel;
  }

  const EDIT_FAIL_HINT = {
    invalid_label: '이름은 비울 수 없습니다.',
    unknown_project: '이미 없는 프로젝트입니다.',
  };

  // '프로젝트 수정'(29번 보드) — 이름·설명만 main에 보낸다. 폴더·고정은 ⋯ 메뉴의 몫이다.
  async function updateProject(project, label, description) {
    let res = null;
    try {
      res = await window.athena.invoke('athena:project-update', { id: project.id, label, description });
    } catch (e) {
      console.warn('프로젝트 수정 실패', e);
      res = null;
    }
    if (res && res.ok) {
      closeProjectPopovers();
      // 응답 스냅샷이 이름의 진실이다 — 다음 5초 폴링을 기다리지 않고 바로 갈아끼운다.
      if (res.state && Array.isArray(res.state.projects)) projectsCache = res.state.projects;
      renderList();
      return;
    }
    projectEditHint = (res && EDIT_FAIL_HINT[res.reason]) || '프로젝트를 고치지 못했습니다.';
    renderList();
  }

  // 설명 카드의 '프로젝트 수정'이 연다(29번 보드). 삭제 확인과 같은 자리·같은 방식이다 —
  // 렌더 상태로만 살고, 초안은 projectEditDraft가 지켜 5초 폴링 재렌더를 견딘다.
  // 이름은 비울 수 없다(사이드바 행과 삭제 확인이 이름으로 사람을 붙잡는다).
  function makeProjectEditPanel(project) {
    const panel = el('div', 'sidebar-project-edit');
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', `${project.label} 수정`);
    const draft = projectEditDraft || { label: project.label, description: project.description || '' };

    const makeField = (field, caption, value, placeholder) => {
      const wrapper = el('label', 'sidebar-project-edit-field');
      wrapper.appendChild(el('span', 'sidebar-project-edit-label', caption));
      const input = el('input', 'sidebar-project-edit-input');
      input.type = 'text';
      input.dataset.field = field;
      input.value = value;
      if (placeholder) input.placeholder = placeholder;
      wrapper.appendChild(input);
      panel.appendChild(wrapper);
      return input;
    };
    const labelInput = makeField('label', '이름', draft.label);
    const descriptionInput = makeField('description', '설명', draft.description, '이 프로젝트에 속한 대화와 작업');

    const hint = el('p', 'sidebar-project-edit-hint');
    hint.setAttribute('role', 'alert'); // 저장 거절 이유는 보조기기에도 읽혀야 한다.
    panel.appendChild(hint);
    const actions = el('div', 'sidebar-project-edit-actions');
    const cancel = el('button', 'sidebar-project-edit-cancel', '취소');
    cancel.type = 'button';
    const save = el('button', 'sidebar-project-edit-save', '저장');
    save.type = 'button';
    const sync = () => {
      save.disabled = !labelInput.value.trim();
      hint.textContent = projectEditHint;
    };
    const onInput = () => {
      projectEditDraft = { label: labelInput.value, description: descriptionInput.value };
      projectEditHint = ''; // 다시 치기 시작하면 지난 거절 이유는 낡은 말이 된다.
      sync();
    };
    labelInput.addEventListener('input', onInput);
    descriptionInput.addEventListener('input', onInput);
    const submit = () => {
      if (save.disabled) return;
      updateProject(project, labelInput.value, descriptionInput.value);
    };
    // Enter는 입력 칸에서만 저장이다 — 패널 전체에 걸면 '취소'에 포커스를 두고 누른 Enter까지
    // 저장으로 새어 버린다(2026-09-05 리뷰).
    for (const input of [labelInput, descriptionInput]) {
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        submit();
      });
    }
    cancel.addEventListener('click', (event) => {
      event.stopPropagation();
      closeProjectPopovers();
      renderList();
    });
    save.addEventListener('click', (event) => {
      event.stopPropagation();
      submit();
    });
    sync();
    actions.appendChild(cancel);
    actions.appendChild(save);
    panel.appendChild(actions);
    return panel;
  }

  function makeProjectRow(project, conversations) {
    const wrap = el('div', 'sidebar-project');
    wrap.dataset.projectId = project.id;
    if (project.id === currentProjectId) wrap.classList.add('is-current');
    // 고정의 진실은 레코드다 — 화면에서 클래스만 흉내 내면 재조회 때 뒤집힌다.
    if (project.pinned) wrap.classList.add('is-pinned');

    const row = el('div', 'sidebar-project-row');
    const main = el('button', 'sidebar-project-main');
    main.type = 'button';
    const descriptionText = project.description || '이 프로젝트에 속한 대화와 작업';
    // title 툴팁은 달지 않는다 — 설명 카드와 같은 문장이 툴팁으로도 떠서 카드의 버튼을
    // 가렸다(2026-09-05 제보). 설명은 카드 하나가 말한다.
    const name = el('span', 'sidebar-project-name');
    name.textContent = project.label;
    main.appendChild(name);
    main.addEventListener('click', () => {
      currentProjectId = project.id;
      closeProjectPopovers();
      renderList();
    });
    row.appendChild(main);

    // 설명 카드(29번 보드). 버튼(main) 안이 아니라 행 묶음(wrap)의 형제로 둔다 — 버튼 안에
    // 있으면 카드의 '프로젝트 수정'을 눌러도 버튼 클릭으로 새어 나가 프로젝트 선택·재렌더로
    // 끝났고, 포인터가 행을 벗어나는 순간 mouseleave로 꺼져 버튼에 닿을 수가 없었다
    // (2026-09-05 제보 "클릭하려는 순간에 꺼져버려서"). 지금은 행이나 카드 위에 머무는
    // 동안 남고, 둘 다 벗어난 뒤 잠깐 있다가 닫힌다. 자리는 행 오른쪽 바깥이라 펜·⋯을
    // 덮지 않는다. 문서 mousedown 판정은 .sidebar-project 안이면 닫지 않으므로 카드 안
    // 클릭도 안전하다.
    const description = el('div', 'sidebar-project-description');
    description.id = `sidebarProjectDescription-${project.id}`;
    description.setAttribute('role', 'group');
    description.setAttribute('aria-label', `${project.label} 설명`);
    main.setAttribute('aria-describedby', description.id);
    description.appendChild(el('span', 'sidebar-project-description-name', project.label));
    description.appendChild(el(
      'span',
      'sidebar-project-description-meta',
      `대화 ${conversations.length}개 · 현재 프로젝트`,
    ));
    description.appendChild(el('span', 'sidebar-project-description-id', project.id));
    description.appendChild(el('span', 'sidebar-project-description-copy', descriptionText));
    const editAction = el('button', 'sidebar-project-description-action');
    editAction.type = 'button';
    const editIcon = pencilIcon();
    editIcon.setAttribute('width', '12');
    editIcon.setAttribute('height', '12');
    editAction.appendChild(editIcon);
    editAction.appendChild(el('span', undefined, '프로젝트 수정'));
    editAction.addEventListener('click', (event) => {
      event.stopPropagation();
      resetProjectPopovers();
      openEditProjectId = project.id;
      renderList();
      // 방금 누른 버튼은 재렌더로 사라졌다 — 포커스를 새 패널의 이름 칸(커서는 끝)으로 옮겨
      // 키보드가 길을 잃지 않게 한다.
      restoreCaret('.sidebar-project-edit-input[data-field="label"]');
    });
    description.appendChild(editAction);
    description.hidden = true;
    let hideTimer = null;
    const showDescription = () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      // 이 행의 다른 팝오버(⋯ 메뉴·모드 선택·삭제 확인·수정 패널)가 열려 있으면 겹치지 않는다.
      if (openProjectMenuId === project.id || openModePickerId === project.id
          || openRemoveProjectId === project.id || openEditProjectId === project.id) return;
      const rect = row.getBoundingClientRect();
      description.style.left = `${Math.round(rect.right + 8)}px`;
      description.style.top = `${Math.round(rect.top)}px`;
      description.hidden = false;
    };
    const hideDescriptionSoon = () => {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { hideTimer = null; description.hidden = true; }, 160);
    };
    const keepsFocus = (target) => Boolean(target && (row.contains(target) || description.contains(target)));
    for (const node of [row, description]) {
      node.addEventListener('mouseenter', showDescription);
      node.addEventListener('mouseleave', hideDescriptionSoon);
      node.addEventListener('focusin', showDescription);
      node.addEventListener('focusout', (event) => {
        if (!keepsFocus(event.relatedTarget)) hideDescriptionSoon();
      });
    }

    const actions = el('div', 'sidebar-project-actions');
    if (openProjectMenuId === project.id) actions.classList.add('is-open');
    const newChat = el('button', 'sidebar-project-new-chat');
    newChat.type = 'button';
    newChat.setAttribute('aria-label', `${project.label} 새 대화창`);
    newChat.title = '새 대화창';
    newChat.setAttribute('aria-haspopup', 'menu');
    newChat.setAttribute('aria-expanded', openModePickerId === project.id ? 'true' : 'false');
    newChat.appendChild(pencilIcon());
    newChat.addEventListener('click', (event) => {
      event.stopPropagation();
      const opening = openModePickerId !== project.id;
      closeProjectPopovers();
      openModePickerId = opening ? project.id : null;
      renderList();
    });
    actions.appendChild(newChat);

    const menuTrigger = el('button', 'sidebar-project-menu-trigger');
    menuTrigger.type = 'button';
    menuTrigger.setAttribute('aria-label', `${project.label} 관리 메뉴`);
    menuTrigger.setAttribute('aria-haspopup', 'menu');
    menuTrigger.setAttribute('aria-expanded', openProjectMenuId === project.id ? 'true' : 'false');
    menuTrigger.textContent = '…';
    actions.appendChild(menuTrigger);

    const menu = el('div', 'sidebar-project-menu');
    menu.hidden = openProjectMenuId !== project.id;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', `${project.label} 관리`);
    const menuItems = projectMenu ? projectMenu.menuItemsFor(project) : [];
    let firstMenuItem = null;
    for (const item of menuItems) {
      const button = el('button', `sidebar-project-menu-item${item.danger ? ' is-danger' : ''}`);
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.appendChild(el('span', 'sidebar-project-menu-item-label', item.label));
      button.appendChild(el('span', 'sidebar-project-menu-item-hint', item.hint));
      if (item.disabled) {
        button.disabled = true;
        if (item.reason) button.title = item.reason;
      } else {
        button.addEventListener('click', () => {
          openProjectMenuId = null;
          menu.hidden = true;
          actions.classList.remove('is-open');
          menuTrigger.setAttribute('aria-expanded', 'false');
          if (item.key === 'pin') { toggleProjectPin(project); return; }
          if (item.key === 'reveal') { revealProject(project); return; }
          if (item.key === 'remove') {
            resetProjectPopovers();
            openRemoveProjectId = project.id;
            renderList();
          }
        });
      }
      if (!firstMenuItem) firstMenuItem = button;
      menu.appendChild(button);
    }
    actions.appendChild(menu);

    menuTrigger.addEventListener('click', (event) => {
      event.stopPropagation();
      // aria-expanded를 단일 상태 권위로 쓴다. CSS/플랫폼이 [hidden] 표시를
      // 재계산해도 첫 클릭이 닫기 동작으로 뒤집히지 않아야 한다.
      const opening = menuTrigger.getAttribute('aria-expanded') !== 'true';
      const hadPopover = resetProjectPopovers();
      description.hidden = true; // 설명 카드 위에 메뉴를 겹치지 않는다 — showDescription의 계약과 같은 것.
      openProjectMenuId = opening ? project.id : null;
      closeProjectMenus(menu);
      menu.hidden = !opening;
      actions.classList.toggle('is-open', opening);
      menuTrigger.setAttribute('aria-expanded', opening ? 'true' : 'false');
      // 모드 선택·삭제 확인은 렌더 상태라 지우려면 다시 그려야 한다. 다시 그려도
      // openProjectMenuId가 그대로라 방금 연 메뉴는 열린 채로 복원된다.
      if (hadPopover) { renderList(); return; }
      if (opening && firstMenuItem) firstMenuItem.focus();
    });

    row.appendChild(actions);
    wrap.appendChild(row);
    wrap.appendChild(description);
    if (openModePickerId === project.id) wrap.appendChild(makeModePicker(project));
    if (openRemoveProjectId === project.id) wrap.appendChild(makeProjectRemovePanel(project));
    if (openEditProjectId === project.id) wrap.appendChild(makeProjectEditPanel(project));
    if (project.id === currentProjectId) {
      for (const conversation of conversations) {
        wrap.appendChild(makeConversationItem(conversation, 'project'));
      }
    }
    return wrap;
  }

  function makeNotifyItem(room) {
    const btn = el('button', 'sidebar-item is-notify');
    btn.type = 'button';
    btn.title = room.title;
    if (room.id === selectedNotifyId) btn.classList.add('is-selected');
    const label = el('span', 'sidebar-item-label');
    label.textContent = room.title;
    btn.appendChild(label);
    if (!room.read) btn.appendChild(el('span', 'sidebar-item-dot'));
    btn.addEventListener('click', () => selectNotifyRoom(room.id));
    return btn;
  }

  // 43번 "새 작업은 채팅에서" 원칙과 합치시킨다(전체 자연어 플로우는 8단계 몫) —
  // 여기서는 그 방향의 가장 얕은 형태로 채팅 입력에 포커스만 옮긴다. 시트·모달을
  // 새로 만들지 않는다(43 원칙 위반 방지, P3 — 없는 기능을 암시하지 않는다).
  function selectRoutineItem() {
    if ($input) $input.focus();
  }

  function makeRoutineItem(row) {
    const btn = el('button', 'sidebar-item is-routine');
    btn.type = 'button';
    btn.title = row.title;
    if (agentSidebarList && row.icon === agentSidebarList.STATUS_ICON.paused) {
      btn.classList.add('is-paused');
    }
    if (agentSidebarList && row.icon === agentSidebarList.STATUS_ICON.draft) {
      btn.classList.add('is-draft'); // ◌ 점선 핑크(8단계, Paper 보드 43 실측)
    }
    const ic = el('span', 'sidebar-item-status-ic');
    ic.textContent = row.icon.glyph;
    ic.style.color = `var(${row.icon.colorVar})`;
    btn.appendChild(ic);
    const label = el('span', 'sidebar-item-label');
    label.textContent = row.title;
    btn.appendChild(label);
    btn.addEventListener('click', () => selectRoutineItem(row));
    return btn;
  }

  function renderList() {
    const focusedMenuItem = document.activeElement && document.activeElement.getAttribute
      && document.activeElement.getAttribute('role') === 'menuitem'
      ? document.activeElement.closest('.sidebar-project')
      : null;
    const focusedProjectId = focusedMenuItem && focusedMenuItem.dataset.projectId;
    // 삭제 확인 입력은 5초 폴링 재렌더를 그대로 맞는다 — 값은 projectRemoveDraft가
    // 지키고, 커서는 여기서 되돌린다(안 그러면 타이핑 도중 포커스가 튄다).
    const focusedRemoveInput = Boolean(document.activeElement
      && document.activeElement.classList
      && document.activeElement.classList.contains('sidebar-project-remove-input'));
    // 수정 패널의 두 입력도 같은 이유로 커서를 되돌린다 — 어느 칸이었는지는 data-field가 말한다.
    const focusedEditField = document.activeElement
      && document.activeElement.classList
      && document.activeElement.classList.contains('sidebar-project-edit-input')
      ? document.activeElement.dataset.field
      : null;
    while ($list.firstChild) $list.removeChild($list.firstChild);

    // 에이전트모드 우선 노출(원칙3, Paper 보드 39 보강본) — 대화 이력보다
    // 먼저 온다. 대화모드로 돌아오면(currentMode() !== 'agent') 이 블록을
    // 건너뛰어 원래 이력이 그대로 복원된다 — 별도 복원 로직이 필요 없다.
    if (currentMode() === 'agent' && agentRoutinesCache.length) {
      $list.appendChild(makeSectionLabel('작업·알람', 'is-routine-caption'));
      for (const row of agentRoutinesCache) $list.appendChild(makeRoutineItem(row));
    }

    // 모드는 목록을 거르지 않는다(2026-09-05 사용자 정정: "모드 창을 누르면 목록이 확확
    // 바뀌는데 이건 내가 원한 게 아니다"). 2026-09-03에 넣었던 "현재 모드만" 필터는 모드를
    // 누를 때마다 프로젝트·최근이 통째로 갈리는 사고로 읽혔다 — 지금은 어느 모드에 있든
    // 같은 행을 보이고, 행 앞의 모드 아이콘(makeModeIcon)이 그 대화의 모드를 말한다.
    // 모드 클릭이 하는 일은 캔버스 전환과 그 프로젝트의 새 대화뿐이다(모드 네비 onSelect,
    // 35·40번 보드 2026-09-05 개정). 검색은 그대로 여기서 한다.
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? conversationsCache.filter((c) => c.title.toLowerCase().includes(q))
      : conversationsCache;

    if (notifyRooms.length && !q) {
      $list.appendChild(makeSectionLabel('알림에서'));
      for (const room of notifyRooms) $list.appendChild(makeNotifyItem(room));
    }

    if (projectsCache.length) {
      const projectCaption = makeSectionLabel('프로젝트', 'is-project-caption');
      projectCaption.appendChild(makeProjectAddButton()); // 폴더 추가는 캡션 오른쪽(36번 보드)
      $list.appendChild(projectCaption);
      for (const project of projectsCache) {
        const projectRows = filtered.filter((conversation) => conversation.projectId === project.id);
        $list.appendChild(makeProjectRow(project, projectRows));
      }
    }

    if (filtered.length) {
      // 최근은 모드를 가리지 않는다 — 머리말이 그것을 말한다(35번 보드).
      $list.appendChild(makeSectionLabel('최근 · 모드 무관', 'is-recent-caption'));
      const visible = showOlder || q ? filtered : filtered.slice(0, INITIAL_VISIBLE);
      for (const conversation of visible) {
        $list.appendChild(makeConversationItem(conversation, 'recent'));
      }
      if (!showOlder && !q && filtered.length > INITIAL_VISIBLE) {
        const more = el('button', 'sidebar-item sidebar-more');
        more.type = 'button';
        more.textContent = `더 보기 (${filtered.length})`;
        more.addEventListener('click', () => { showOlder = true; renderList(); });
        $list.appendChild(more);
      }
    }

    if (!filtered.length && !notifyRooms.length) {
      const empty = el('div', 'sidebar-section-label');
      empty.textContent = q ? '검색 결과 없음' : '대화 이력 없음';
      $list.appendChild(empty);
    }

    if (openProjectMenuId && focusedProjectId === openProjectMenuId) {
      const restored = Array.from($list.querySelectorAll('.sidebar-project'))
        .find((project) => project.dataset.projectId === openProjectMenuId);
      const firstAction = restored && restored.querySelector('.sidebar-project-menu-item:not(:disabled)');
      if (firstAction) firstAction.focus();
    }

    if (openRemoveProjectId && focusedRemoveInput) restoreCaret('.sidebar-project-remove-input');
    if (openEditProjectId && focusedEditField) {
      restoreCaret(`.sidebar-project-edit-input[data-field="${focusedEditField}"]`);
    }
  }

  // 재렌더로 새로 만들어진 입력에 포커스와 커서(끝)를 되돌린다 — 삭제 확인·수정 패널이 같이 쓴다.
  function restoreCaret(selector) {
    const input = $list.querySelector(selector);
    if (!input) return;
    input.focus();
    const end = input.value.length;
    if (typeof input.setSelectionRange === 'function') input.setSelectionRange(end, end);
  }

  // 이력의 머리는 다섯 모드(세션 명세 §3-1) — 대화 목록을 새로 받을 때마다
  // 모드별 개수를 세어 네비에 넘긴다. 세는 규칙(모드 어휘 정규화·모르는 모드
  // 접기)의 주인은 session-history-view.js 하나라 여기서 다시 세지 않고,
  // 레코드 어휘(chat…) ↔ 화면 어휘(summary…)의 다리도 session-snapshot.js
  // 한 쌍뿐이다. 모듈이 없으면 조용히 건너뛴다(위 modeNav 가드와 같은 방식).
  const RUN_STATE_LABELS = { running: '실행 중', waiting: '대기', done: '완료', failed: '실패' };

  // 이력 머리의 "실행 중 3 · 대기 1" 알약(39번 보드). 하나도 없으면 사라진다.
  let $runSummary = null;
  function renderRunSummary() {
    const nav = document.getElementById('sidebarModeNav');
    if (!nav || !nav.parentElement) return;
    let running = 0;
    let waiting = 0;
    for (const c of conversationsCache) {
      if (c.runState === 'running') running += 1;
      else if (c.runState === 'waiting') waiting += 1;
    }
    if (!running && !waiting) {
      if ($runSummary) $runSummary.hidden = true;
      return;
    }
    if (!$runSummary) {
      $runSummary = el('div', 'sidebar-run-summary');
      $runSummary.id = 'sidebarRunSummary';
      nav.parentElement.insertBefore($runSummary, nav);
    }
    const parts = [];
    if (running) parts.push(`실행 중 ${running}`);
    if (waiting) parts.push(`대기 ${waiting}`);
    $runSummary.textContent = parts.join(' · ');
    $runSummary.classList.toggle('is-waiting-only', running === 0);
    $runSummary.hidden = false;
  }

  function updateModeCounts() {
    renderRunSummary();
    // 모드 구역 머리의 대화 수(35번 보드) — 모드별 숫자와 달리 거르지 않은 전체다.
    if ($modeTotal) $modeTotal.textContent = `${conversationsCache.length}개 대화`;
    const historyView = window.AthenaLib && window.AthenaLib.SessionHistoryView;
    const snapshot = window.AthenaLib && window.AthenaLib.SessionSnapshot;
    if (!modeNav || !historyView || !snapshot) return;
    // runState는 main이 목록에 얹어 준 세션의 대표 실행 상태다(job 레코드, 명세 §5).
    // 없으면 null — 없는 "실행 중"을 있다고 그리지 않는다(P3).
    const view = historyView.buildHistoryView({
      sessions: conversationsCache.map((c) => ({
        id: c.id,
        mode: c.mode,
        projectId: c.projectId,
        title: c.title,
        pinned: false,
        archived: false,
        updatedAt: c.updatedAt,
        runState: c.runState || null,
      })),
    });
    const counts = {};
    const running = {};
    for (const row of view.modes) {
      const key = snapshot.modeToView(row.mode);
      counts[key] = row.count;
      running[key] = row.runState === 'running';
    }
    modeNav.setCounts(counts);
    modeNav.setRunning(running);
  }

  // main이 실행 상태 변화를 밀어준다 — 목록을 다시 받지 않고 그 행만 고쳐 다시 그린다.
  // 모르는 대화면(방금 생긴 대화) 목록을 통째로 다시 받는다.
  function handleSessionRunState(payload) {
    const id = payload && payload.id;
    if (!id) return;
    const conv = conversationsCache.find((c) => c.id === id);
    if (!conv) { loadConversations(); return; }
    conv.runState = payload.runState || null;
    updateModeCounts();
    renderList();
  }

  // 마지막으로 main이 준 목록 그대로의 문자열 — 5초 폴링이 같은 답을 돌려주면 다시 그리지 않는다.
  let lastListSnapshot = null;

  async function loadConversations() {
    let res = null;
    try {
      res = await window.athena.invoke('athena:conversations-list');
    } catch {
      res = null;
    }
    // 바뀐 게 없으면 손대지 않는다(2026-09-05 리뷰). 폴링마다 목록을 통째로 다시 그리면 사람이
    // 설명 카드 위에 머무는 동안 카드가 사라지고(고치려던 바로 그 결함), 행에 있던 키보드
    // 포커스도 5초마다 떨어진다. 실행 상태·새 대화·프로젝트 변경은 답이 달라지므로 그대로 그린다.
    const snapshotText = res ? JSON.stringify(res) : null;
    if (snapshotText !== null && snapshotText === lastListSnapshot) return;
    lastListSnapshot = snapshotText;
    if (res) {
      conversationsCache = Array.isArray(res.conversations) ? res.conversations : [];
      projectsCache = Array.isArray(res.projects) ? res.projects : [];
      currentProjectId = res.currentProjectId
        || (projectsCache[0] && projectsCache[0].id)
        || null;
      activeConversationId = res.activeId ? res.activeId : null;
    } else {
      conversationsCache = [];
      projectsCache = [];
    }
    updateModeCounts();
    renderList();
  }

  async function selectConversation(id) {
    selectedNotifyId = null;
    $roomBanner.hidden = true;
    // 전환은 chat.js가 한다(41번 보드). 답변 중이면 거절하고, 아니면 main의
    // set-active(직렬화 큐)를 거쳐 기록 대상과 Claude 커서를 함께 바꾼 뒤 메시지를
    // 다시 그린다. 여기서 set-active를 먼저 부르면 chat.js가 거절한 경우에도 main의
    // 기록 대상만 바뀌어 다음 메시지가 엉뚱한 제목 아래 쌓인다 — 그래서 여기서는
    // 부르지 않고, 성공했을 때만 목록 하이라이트를 옮긴다.
    const conv = conversationsCache.find((c) => c && c.id === id) || null;
    let opened = false;
    if (window.AthenaShell && typeof window.AthenaShell.openConversation === 'function') {
      opened = await window.AthenaShell.openConversation({ id, title: conv ? conv.title : null });
    }
    if (opened) activeConversationId = id;
    renderList();
  }

  // ---------- 알림 파생 방(Paper 보드 08) ----------
  // 7단계(F3-FE)부터는 "세션 메모리만"이 더 이상 정확하지 않다 — 배열 자체는
  // 여전히 이 파일이 메모리에서만 들고 있지만(라우틴 *상태*의 이중 영속화는
  // 여전히 안 한다, P4), "읽었는지"만은 6단계 read-marks가 백엔드에 영속화해
  // 아래 hydrateNotifyRooms()가 기동 시 다시 채운다. 그래서 재시작해도 최근
  // 발화·읽음 여부는 유지된다 — sub·title 같은 표시용 필드까지 영속화하는 건
  // 아니다(그건 매번 routines 요약 뷰에서 다시 만든다).
  const notifyRooms = [];

  // 에이전트 모드 네비 배지(원칙2) — notifyRooms의 !read 개수를 그대로 노출한다.
  // notifyRooms 자체가 이미 "라우틴 상태의 파생물"이라 별도로 다시 세거나
  // 디스크에 남기지 않는다(P3 — 이 파일 머리말과 같은 이유).
  function updateAgentBadge() {
    if (!modeNav) return;
    modeNav.setBadgeCount(notifyRooms.filter((r) => !r.read).length);
  }

  function routineEventTitle(event) {
    if (event && event.note) return String(event.note);
    if (event && event.routine_id) return `루틴 ${event.routine_id}`;
    return '알림';
  }

  // 9단계(알람 센터, Paper 보드 40) 알람 행의 부제 — event에 실제로 있는 필드만
  // 조합한다(symbol·observed, routineTurnLib이 능동 턴 본문에 쓰는 것과 같은
  // 필드). 지어낸 문구 없음(P3).
  function routineEventSub(event) {
    if (!event) return '';
    const parts = [];
    if (event.symbol != null) parts.push(String(event.symbol));
    if (event.observed != null) parts.push(`관측 ${event.observed}`);
    return parts.join(' · ');
  }

  function handleRoutineEvent(event) {
    if (!event || event.type !== 'routine-fired') return;
    const id = event.routine_id || event.id;
    if (!id) return;
    const firedAtMs = Number.isFinite(Date.parse(event.fired_at)) ? Date.parse(event.fired_at) : Date.now();
    const existing = notifyRooms.find((r) => r.id === id);
    if (existing) {
      existing.firedAt = firedAtMs;
      existing.title = routineEventTitle(event);
      existing.sub = routineEventSub(event);
      existing.mode = typeof event.mode === 'string' ? event.mode : '';
      existing.read = existing.id === selectedNotifyId;
    } else {
      notifyRooms.unshift({
        id, title: routineEventTitle(event), sub: routineEventSub(event),
        // 알람 센터(Paper 보드 02)가 갈래 아이콘을 고르는 유일한 근거다 —
        // 예약 실행(scheduled)과 조건 감시를 실데이터로 가른다.
        mode: typeof event.mode === 'string' ? event.mode : '',
        firedAt: firedAtMs, read: false, event,
      });
    }
    renderList();
    updateAgentBadge();
  }

  function selectNotifyRoom(id) {
    const room = notifyRooms.find((r) => r.id === id);
    if (!room) return;
    // F-stage5b-FE — engagement.py의 "opened" 정의(능동 턴이 뜬 방을 사용자가
    // 실제로 선택해 열람한 사건)와 맞추려면 이미 읽은 방을 다시 눌렀을 때는
    // 세지 않는다 — 안 그러면 재클릭마다 opened가 쌓여 발화→열람 비율이
    // 100%를 넘는 지어낸 숫자가 된다(engagement.py의 opened_rate 계산 참고).
    const wasUnread = !room.read;
    room.read = true;
    selectedNotifyId = id;
    const d = new Date(room.firedAt);
    const pad2 = (n) => String(n).padStart(2, '0');
    $roomTime.textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    $roomTitle.textContent = room.title;
    $roomBanner.hidden = false;
    renderList();
    updateAgentBadge();
    // 7단계(F3-FE) — 6단계 read-marks에 남긴다. 화면은 이미 위에서 즉시
    // 반영됐으니 실패해도 조용히 넘어간다(재조회 시 자연히 다시 unread로
    // 보일 뿐 — 낙관적 갱신을 성공한 척 위장하지 않는다, P3).
    if (window.athena && typeof window.athena.invoke === 'function') {
      window.athena.invoke('athena:routine-ack', { id }).catch(() => {});
      if (wasUnread) window.athena.invoke('athena:routine-engagement', { id, event: 'opened' }).catch(() => {});
    }
  }

  // 7단계(F3-FE) — 기동 시 최근 발화한 라우틴으로 notifyRooms를 다시 채운다
  // (agent-sidebar-list.js의 buildHydratedRooms, 순수 매핑만 거기서 하고 여기서는
  // IPC 왕복 + notifyRooms 시드만 한다, 위 파일 머리말 DI 원칙). handleRoutineEvent가
  // 실시간으로 이미 방을 만들었다면(레이스 — WS가 하이드레이션보다 먼저 뜬 경우)
  // 그 항목은 건드리지 않는다.
  async function hydrateNotifyRooms() {
    if (!agentSidebarList || typeof agentSidebarList.buildHydratedRooms !== 'function') return;
    let routines = [];
    try {
      const res = await window.athena.invoke('athena:routines-list');
      routines = res && res.ok && res.data && Array.isArray(res.data.routines) ? res.data.routines : [];
    } catch {
      routines = [];
    }
    const hydrated = agentSidebarList.buildHydratedRooms(routines);
    let changed = false;
    for (const room of hydrated) {
      if (notifyRooms.some((r) => r.id === room.id)) continue;
      notifyRooms.push({ ...room, event: null });
      changed = true;
    }
    if (!changed) return;
    notifyRooms.sort((a, b) => b.firedAt - a.firedAt); // 최신 먼저 — handleRoutineEvent의 unshift와 같은 순서.
    renderList();
    updateAgentBadge();
  }


  // ---------- 새 대화 ----------
  function clearConversationUi() {
    window.dispatchEvent(new Event('athena:new-conversation'));
    if (window.AthenaShell && typeof window.AthenaShell.clearCanvases === 'function') {
      window.AthenaShell.clearCanvases();
    }
    while ($history.firstChild) $history.removeChild($history.firstChild);
    $roomBanner.hidden = true;
    selectedNotifyId = null;
    renderList();
    if ($input) { $input.value = ''; $input.focus(); }
  }

  // view를 주면 그 모드의 대화창으로 연다(38번 보드 펜 = 새 대화창). 없으면
  // 지금 보고 있는 모드 그대로다(상단 + 버튼의 기존 동작).
  async function startNewConversation(projectId, view) {
    const selectedProjectId = projectsCache.some((project) => project.id === projectId)
      ? projectId
      : currentProjectId;
    currentProjectId = selectedProjectId;
    let pending = null;
    if (window.athena && typeof window.athena.invoke === 'function') {
      try {
        pending = window.athena.invoke('athena:conversations-new', {
          projectId: selectedProjectId,
          mode: view || currentMode(),
        });
      } catch {
        pending = null;
      }
    }
    clearConversationUi();
    if (!pending || typeof pending.then !== 'function') {
      activeConversationId = null;
      return;
    }
    try {
      const res = await pending;
      conversationsCache = res && Array.isArray(res.conversations) ? res.conversations : conversationsCache;
      projectsCache = res && Array.isArray(res.projects) ? res.projects : projectsCache;
      currentProjectId = (res && res.currentProjectId) || selectedProjectId;
      activeConversationId = res && res.activeId ? res.activeId : null;
    } catch {
      activeConversationId = null;
    }
    updateModeCounts();
    renderList();
  }

  $newChat.addEventListener('click', () => startNewConversation(currentProjectId));

  if ($compactToggle && $historyRegion) {
    const closeCompactPanel = () => {
      $historyRegion.classList.remove('is-compact-open');
      $compactToggle.setAttribute('aria-expanded', 'false');
    };
    $compactToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      const opening = !$historyRegion.classList.contains('is-compact-open');
      $historyRegion.classList.toggle('is-compact-open', opening);
      $compactToggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
    });
    document.addEventListener('mousedown', (event) => {
      if (!$historyRegion.contains(event.target)) closeCompactPanel();
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 700) closeCompactPanel();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeCompactPanel();
    });
  }

  // ---------- 검색 ----------
  // Paper 2V27-1 — 결과는 목록을 갈아끼우는 대신 별도 패널로 뜬다. 그룹마다 건수를
  // 달고 발치에 키보드 안내와 총 건수를 남긴다. 판정은 순수 모듈이 한다.
  const searchLib = window.AthenaLib.SidebarSearch;
  const $searchPanel = el('div', 'sidebar-search-panel');
  $searchPanel.hidden = true;
  $searchPanel.setAttribute('role', 'listbox');
  $searchPanel.setAttribute('aria-label', '검색 결과');
  ($historyRegion.querySelector('.sidebar-head') || $historyRegion).appendChild($searchPanel);
  let searchRows = [];
  let searchActive = -1;
  const searchCardNodes = new Map();

  // 캔버스 카드는 지금 보고 있는 대화의 카드다 — #grid에 실제로 붙어 있는 것만
  // 읽는다(없는 카드를 결과로 만들지 않는다).
  function collectCanvasCards() {
    searchCardNodes.clear();
    const grid = document.getElementById('grid');
    if (!grid) return [];
    const rows = [];
    grid.querySelectorAll('.card .card-title').forEach((titleNode, index) => {
      const title = (titleNode.textContent || '').trim();
      if (!title) return;
      const id = `card-${index}`;
      searchCardNodes.set(id, titleNode.closest('.card'));
      rows.push({ id, title });
    });
    return rows;
  }

  function setSearchActive(index) {
    searchActive = index;
    searchRows.forEach((row, i) => {
      row.classList.toggle('is-active', i === index);
      row.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });
  }

  function closeSearchPanel() {
    $searchPanel.hidden = true;
    searchRows = [];
    searchActive = -1;
  }

  function openSearchRow(kind, id) {
    closeSearchPanel();
    if (kind === 'card') {
      const node = searchCardNodes.get(id);
      if (node) node.scrollIntoView({ block: 'nearest' });
      return;
    }
    void selectConversation(id);
  }

  function renderSearchPanel() {
    searchRows = [];
    searchActive = -1;
    while ($searchPanel.firstChild) $searchPanel.removeChild($searchPanel.firstChild);
    if (!searchQuery.trim()) { $searchPanel.hidden = true; return; }
    const result = searchLib.buildSearchResults({
      conversations: conversationsCache,
      cards: collectCanvasCards(),
      query: searchQuery,
      now: Date.now(),
    });
    for (const group of result.groups) {
      $searchPanel.appendChild(el('div', 'sidebar-search-group-label', group.label));
      for (const row of group.rows) {
        const btn = el('button', 'sidebar-search-row');
        btn.type = 'button';
        btn.setAttribute('role', 'option');
        btn.title = row.title;
        btn.appendChild(el('span', 'sidebar-search-row-title', row.title));
        if (row.when) btn.appendChild(el('span', 'sidebar-search-row-when', row.when));
        btn.addEventListener('click', () => openSearchRow(group.kind, row.id));
        $searchPanel.appendChild(btn);
        searchRows.push(btn);
      }
    }
    if (!result.total) $searchPanel.appendChild(el('div', 'sidebar-search-empty', '검색 결과 없음'));
    const foot = el('div', 'sidebar-search-foot');
    foot.append(el('span', 'sidebar-search-hint', result.hint), el('span', 'sidebar-search-count', `${result.total}건`));
    $searchPanel.appendChild(foot);
    $searchPanel.hidden = false;
    if (searchRows.length) setSearchActive(0);
  }

  $searchToggle.addEventListener('click', () => {
    const opening = $searchInput.hidden;
    $searchInput.hidden = !opening;
    if (opening) { $searchInput.focus(); } else { searchQuery = ''; $searchInput.value = ''; closeSearchPanel(); renderList(); }
  });
  $searchInput.addEventListener('input', () => {
    searchQuery = $searchInput.value;
    renderList();
    renderSearchPanel();
  });
  $searchInput.addEventListener('keydown', (event) => {
    if ($searchPanel.hidden) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!searchRows.length) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setSearchActive((searchActive + step + searchRows.length) % searchRows.length);
    } else if (event.key === 'Enter') {
      if (searchActive < 0) return;
      event.preventDefault();
      searchRows[searchActive].click();
    } else if (event.key === 'Escape') {
      // compact 패널 닫기 전역 핸들러(document keydown)보다 먼저 소비한다 —
      // 검색이 열려 있으면 Esc는 검색만 닫는다.
      event.preventDefault();
      event.stopPropagation();
      searchQuery = '';
      $searchInput.value = '';
      closeSearchPanel();
      renderList();
    }
  });

  // ---------- 계정 발치 + 계정 메뉴(Paper 보드 16) ----------
  function formatTokenRemaining(expiresInSec) {
    const sec = Math.max(0, Math.round(expiresInSec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h <= 0 && m <= 0) return '곧 만료';
    if (h <= 0) return `${m}분 남음`;
    return `${h}시간 ${m}분 남음`;
  }

  let activeAccountCache = null;
  let accountCountCache = 0;

  function closeAccountMenu() { $accountMenu.hidden = true; }

  function buildAccountMenu(account, remainingText, accountCount) {
    while ($accountMenu.firstChild) $accountMenu.removeChild($accountMenu.firstChild);

    const head = el('div', 'sidebar-menu-head');
    const alias = el('div', 'sidebar-menu-alias');
    alias.textContent = account.alias;
    const sub = el('div', 'sidebar-menu-sub');
    sub.textContent = `키움 모의투자 · 주문 API ${account.orderApi ? '켜짐' : '꺼짐'}`;
    head.appendChild(alias);
    head.appendChild(sub);
    $accountMenu.appendChild(head);

    const usage = el('button', 'sidebar-menu-item');
    usage.type = 'button';
    const usageLabel = el('span', 'sidebar-menu-item-label');
    usageLabel.textContent = '토큰 사용량';
    const usageValue = el('span', 'sidebar-menu-item-value');
    usageValue.textContent = remainingText;
    usage.appendChild(usageLabel);
    usage.appendChild(usageValue);
    usage.addEventListener('click', () => { closeAccountMenu(); openSettingsBridge(); });
    $accountMenu.appendChild(usage);

    const switcher = el('button', 'sidebar-menu-item');
    switcher.type = 'button';
    const switchLabel = el('span', 'sidebar-menu-item-label');
    switchLabel.textContent = '계좌 전환';
    const switchValue = el('span', 'sidebar-menu-item-value');
    switchValue.textContent = `${accountCount}개`;
    switcher.appendChild(switchLabel);
    switcher.appendChild(switchValue);
    switcher.addEventListener('click', () => { closeAccountMenu(); openAccountSwitchBridge(); });
    $accountMenu.appendChild(switcher);

    const settings = el('button', 'sidebar-menu-item');
    settings.type = 'button';
    const settingsLabel = el('span', 'sidebar-menu-item-label');
    settingsLabel.textContent = '설정';
    const settingsValue = el('span', 'sidebar-menu-item-value');
    settingsValue.textContent = 'Ctrl+,';
    settings.appendChild(settingsLabel);
    settings.appendChild(settingsValue);
    settings.addEventListener('click', () => { closeAccountMenu(); openSettingsBridge(); });
    $accountMenu.appendChild(settings);
  }

  function openSettingsBridge() {
    if (window.AthenaShell && typeof window.AthenaShell.openSettings === 'function') {
      window.AthenaShell.openSettings();
    }
  }

  // 「계좌 전환」은 설정 창이 아니라 계좌 전환 화면(Paper 1M3-0)으로 간다 — 그
  // 화면이 경고·4단계 흐름·[전환하고 다시 인증]을 그리는 유일한 자리다.
  function openAccountSwitchBridge() {
    if (!activeAccountCache) return;
    if (window.AthenaShell && typeof window.AthenaShell.openAccountSwitch === 'function') {
      window.AthenaShell.openAccountSwitch(activeAccountCache.id);
    }
  }

  $accountRow.addEventListener('click', () => {
    if (!activeAccountCache) return;
    if (!$accountMenu.hidden) { closeAccountMenu(); return; }
    window.athena.invoke('athena:auth-token-status', { id: activeAccountCache.id })
      .then((status) => {
        const remaining = status && status.state === 'ready'
          ? `토큰 ${formatTokenRemaining(status.expiresInSec)}`
          : '토큰 재발급 필요';
        buildAccountMenu(activeAccountCache, remaining, accountCountCache);
        $accountMenu.hidden = false;
      })
      .catch(() => {
        buildAccountMenu(activeAccountCache, '토큰 상태 확인 불가', accountCountCache);
        $accountMenu.hidden = false;
      });
  });

  document.addEventListener('mousedown', (e) => {
    // 모드 선택·삭제 확인은 행 안(.sidebar-project)에 있고 .sidebar-project-actions
    // 밖이다 — 판정 범위를 행 전체로 넓혀야 패널 안을 눌러도 닫히지 않는다.
    const inProject = e.target && typeof e.target.closest === 'function'
      ? e.target.closest('.sidebar-project')
      : null;
    if (!inProject) closeProjectPopovers();
    if (!$accountMenu.hidden
        && !$accountMenu.contains(e.target)
        && !$accountRow.contains(e.target)) {
      closeAccountMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeProjectPopovers();
    closeAccountMenu();
  });

  async function loadAccount() {
    let accounts = [];
    try {
      const res = await window.athena.invoke('athena:account-list');
      accounts = (res && Array.isArray(res.accounts)) ? res.accounts : [];
    } catch { accounts = []; }
    accountCountCache = accounts.length;
    const active = accounts.find((a) => a.active) || null;
    activeAccountCache = active;
    if (!active) {
      $accountRow.hidden = true;
      closeAccountMenu();
      return;
    }
    $accountRow.hidden = false;
    $accountAlias.textContent = active.alias;
    $accountDot.style.background = active.connected ? 'var(--color-ok)' : 'var(--color-k-faint)';
    try {
      const status = await window.athena.invoke('athena:auth-token-status', { id: active.id });
      $accountToken.textContent = status && status.state === 'ready'
        ? `토큰 ${formatTokenRemaining(status.expiresInSec)}`
        : '토큰 재발급 필요';
    } catch {
      $accountToken.textContent = '';
    }
  }

  // ---------- 알람 센터 다리 (9단계, Paper 보드 40) ----------
  // notifyRooms를 캔버스 레벨로 승격한다 — 소유자는 여전히 이 파일이다(세션
  // 메모리, 위 머리말). 캔버스(agent-canvas.js)는 이 다리로 읽기+"모두 읽음"
  // 액션만 받는다(단일 소유자 원칙, graph-mode/controller.js applyVisibility
  // 주석과 같은 이유 — notifyRooms 소유자가 둘이면 결함이 재발한다).
  window.AthenaNotify = {
    // 얕은 복제 — 캔버스가 원본 배열/객체를 직접 변형 못 하게 한다.
    list: () => notifyRooms.map((r) => ({ id: r.id, title: r.title, sub: r.sub || '', mode: r.mode || '', firedAt: r.firedAt, read: r.read })),
    markAllRead: () => {
      let changed = false;
      for (const r of notifyRooms) { if (!r.read) { r.read = true; changed = true; } }
      if (changed) { renderList(); updateAgentBadge(); }
      return changed;
    },
    // F-fix1 — 39번 상세 패널 "채팅에서 열기 ↗"가 이 다리로 알림 방을 연다.
    // 있으면 selectNotifyRoom과 완전히 같은 경로(ack·opened 계측 포함)를 그대로
    // 타고, 없으면 false를 돌려줘 호출자가 채팅 포커스로 폴백하게 한다(단일
    // 소유자 원칙 — 캔버스가 notifyRooms를 직접 뒤지지 않는다).
    selectRoom: (id) => {
      const found = notifyRooms.some((r) => r.id === id);
      if (found) selectNotifyRoom(id);
      return found;
    },
  };

  // ---------- 부트 ----------
  loadConversations();
  loadAccount();
  hydrateNotifyRooms(); // 7단계 — 모드와 무관하게 항상 시도한다(알림 배지는 대화모드에서도 보인다).
  // 사이드바는 채팅 왕복(질의→답변)의 부산물을 반영할 뿐 그 자체가 실시간
  // 스트림을 갖지 않는다(대화 자체는 채팅 영역의 일이다) — 가벼운 폴링으로
  // 충분하다. 계좌 토큰 잔여시간도 같은 주기로 갱신한다.
  setInterval(loadConversations, 5000);
  setInterval(loadAccount, 30000);

  if (window.athena && typeof window.athena.on === 'function') {
    window.athena.on('athena:routine-event', handleRoutineEvent);
    window.athena.on('athena:session-run-state', handleSessionRunState);
    window.athena.on('athena:auth-token-changed', () => loadAccount());
  }
})();
