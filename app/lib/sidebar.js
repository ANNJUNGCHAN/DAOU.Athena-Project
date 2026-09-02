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
          } else {
            renderList();
          }
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
    const label = el('span', 'sidebar-item-label');
    label.textContent = conv.title;
    btn.appendChild(label);
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

  function makeProjectRow(project, conversations) {
    const wrap = el('div', 'sidebar-project');
    wrap.dataset.projectId = project.id;
    if (project.id === currentProjectId) wrap.classList.add('is-current');

    const row = el('div', 'sidebar-project-row');
    const main = el('button', 'sidebar-project-main');
    main.type = 'button';
    const descriptionText = project.description || '이 프로젝트에 속한 대화와 작업';
    main.title = descriptionText;
    const name = el('span', 'sidebar-project-name');
    name.textContent = project.label;
    main.appendChild(name);
    const description = el('span', 'sidebar-project-description');
    description.appendChild(el('span', 'sidebar-project-description-name', project.label));
    description.appendChild(el(
      'span',
      'sidebar-project-description-meta',
      `대화 ${conversations.length}개 · 현재 프로젝트`,
    ));
    description.appendChild(el('span', 'sidebar-project-description-id', project.id));
    description.appendChild(el('span', 'sidebar-project-description-copy', descriptionText));
    description.appendChild(el('span', 'sidebar-project-description-action', '프로젝트 수정'));
    description.hidden = true;
    main.appendChild(description);
    const showDescription = () => {
      const rect = main.getBoundingClientRect();
      description.style.left = `${Math.round(rect.right + 8)}px`;
      description.style.top = `${Math.round(rect.top)}px`;
      description.hidden = false;
    };
    const hideDescription = () => { description.hidden = true; };
    main.addEventListener('mouseenter', showDescription);
    main.addEventListener('mouseleave', hideDescription);
    main.addEventListener('focus', showDescription);
    main.addEventListener('blur', hideDescription);
    main.addEventListener('click', () => {
      currentProjectId = project.id;
      closeProjectMenus();
      renderList();
    });
    row.appendChild(main);

    const actions = el('div', 'sidebar-project-actions');
    if (openProjectMenuId === project.id) actions.classList.add('is-open');
    const newChat = el('button', 'sidebar-project-new-chat');
    newChat.type = 'button';
    newChat.setAttribute('aria-label', `${project.label} 프로젝트 수정`);
    newChat.title = '프로젝트 수정';
    newChat.appendChild(pencilIcon());
    newChat.addEventListener('click', (event) => {
      event.stopPropagation();
      if (description.hidden) showDescription();
      else hideDescription();
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
    const menuItems = [
      { label: '고정', action: () => wrap.classList.toggle('is-pinned') },
      { label: '편집', action: showDescription },
      { label: '탐색기에서 열기', unavailable: true },
      { label: '영구 작업 트리 생성', unavailable: true },
      { label: '대화 보관', unavailable: true },
      { label: '프로젝트 제거', unavailable: true, danger: true },
    ];
    let firstMenuItem = null;
    for (const item of menuItems) {
      const button = el('button', `sidebar-project-menu-item${item.danger ? ' is-danger' : ''}`);
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.textContent = item.label;
      if (item.unavailable) {
        button.disabled = true;
        button.title = '프로젝트 연결 정보가 있을 때 사용할 수 있습니다';
      } else {
        button.addEventListener('click', () => {
          if (item.action) item.action();
          openProjectMenuId = null;
          menu.hidden = true;
          actions.classList.remove('is-open');
          menuTrigger.setAttribute('aria-expanded', 'false');
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
      openProjectMenuId = opening ? project.id : null;
      closeProjectMenus(menu);
      menu.hidden = !opening;
      actions.classList.toggle('is-open', opening);
      menuTrigger.setAttribute('aria-expanded', opening ? 'true' : 'false');
      if (opening && firstMenuItem) firstMenuItem.focus();
    });

    row.appendChild(actions);
    wrap.appendChild(row);
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
    while ($list.firstChild) $list.removeChild($list.firstChild);

    // 에이전트모드 우선 노출(원칙3, Paper 보드 39 보강본) — 대화 이력보다
    // 먼저 온다. 대화모드로 돌아오면(currentMode() !== 'agent') 이 블록을
    // 건너뛰어 원래 이력이 그대로 복원된다 — 별도 복원 로직이 필요 없다.
    if (currentMode() === 'agent' && agentRoutinesCache.length) {
      $list.appendChild(makeSectionLabel('작업·알람', 'is-routine-caption'));
      for (const row of agentRoutinesCache) $list.appendChild(makeRoutineItem(row));
    }

    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? conversationsCache.filter((c) => c.title.toLowerCase().includes(q))
      : conversationsCache;

    if (notifyRooms.length && !q) {
      $list.appendChild(makeSectionLabel('알림에서'));
      for (const room of notifyRooms) $list.appendChild(makeNotifyItem(room));
    }

    if (projectsCache.length) {
      $list.appendChild(makeSectionLabel('프로젝트', 'is-project-caption'));
      for (const project of projectsCache) {
        const projectRows = filtered.filter((conversation) => conversation.projectId === project.id);
        $list.appendChild(makeProjectRow(project, projectRows));
      }
    }

    if (filtered.length) {
      $list.appendChild(makeSectionLabel('최근', 'is-recent-caption'));
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
  }

  // 이력의 머리는 다섯 모드(세션 명세 §3-1) — 대화 목록을 새로 받을 때마다
  // 모드별 개수를 세어 네비에 넘긴다. 세는 규칙(모드 어휘 정규화·모르는 모드
  // 접기)의 주인은 session-history-view.js 하나라 여기서 다시 세지 않고,
  // 레코드 어휘(chat…) ↔ 화면 어휘(summary…)의 다리도 session-snapshot.js
  // 한 쌍뿐이다. 모듈이 없으면 조용히 건너뛴다(위 modeNav 가드와 같은 방식).
  function updateModeCounts() {
    const historyView = window.AthenaLib && window.AthenaLib.SessionHistoryView;
    const snapshot = window.AthenaLib && window.AthenaLib.SessionSnapshot;
    if (!modeNav || !historyView || !snapshot) return;
    // runState는 전부 null이다 — 지금 대화 레코드에는 실행 중인지를 말해주는
    // 근거가 없다. 없는 "실행 중"을 있다고 그리지 않는다(P3). 실행 상태 배선은
    // job 레코드가 생기는 다음 단계의 몫이다(명세 §5).
    const view = historyView.buildHistoryView({
      sessions: conversationsCache.map((c) => ({
        id: c.id,
        mode: c.mode,
        projectId: c.projectId,
        title: c.title,
        pinned: false,
        archived: false,
        updatedAt: c.updatedAt,
        runState: null,
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

  async function loadConversations() {
    try {
      const res = await window.athena.invoke('athena:conversations-list');
      conversationsCache = (res && Array.isArray(res.conversations)) ? res.conversations : [];
      projectsCache = (res && Array.isArray(res.projects)) ? res.projects : [];
      currentProjectId = (res && res.currentProjectId)
        || (projectsCache[0] && projectsCache[0].id)
        || null;
      activeConversationId = res && res.activeId ? res.activeId : null;
    } catch {
      conversationsCache = [];
      projectsCache = [];
    }
    updateModeCounts();
    renderList();
  }

  async function selectConversation(id) {
    selectedNotifyId = null;
    $roomBanner.hidden = true;
    try {
      const res = await window.athena.invoke('athena:conversations-set-active', { id });
      activeConversationId = res && res.activeId ? res.activeId : id;
    } catch {
      activeConversationId = id;
    }
    renderList();
    // 그 대화로 이동한다(2026-09-02 사용자 지적 "누르면 해당 대화로 이동이 되어야
    // 하는데 그런 기능이 전혀 없다"). 위 set-active는 활성 포인터만 바꾸고 화면은
    // 그대로 뒀다 — 실제로 아무 일도 일어나지 않았다.
    //
    // 읽기 전용이다: chat.js가 메시지를 불러 화면을 갈아치우고 입력을 잠근다.
    // 답변 중이면 거절되므로(진행 중 턴이 사라지면 안 된다) 반환값을 무시하지 않고
    // 그때는 목록 하이라이트만 남긴다.
    const conv = conversationsCache.find((c) => c && c.id === id) || null;
    if (window.AthenaShell && typeof window.AthenaShell.openConversation === 'function') {
      await window.AthenaShell.openConversation({ id, title: conv ? conv.title : null });
    }
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

  async function startNewConversation(projectId) {
    const selectedProjectId = projectsCache.some((project) => project.id === projectId)
      ? projectId
      : currentProjectId;
    currentProjectId = selectedProjectId;
    let pending = null;
    if (window.athena && typeof window.athena.invoke === 'function') {
      try {
        pending = window.athena.invoke('athena:conversations-new', {
          projectId: selectedProjectId,
          mode: currentMode(),
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
  $searchToggle.addEventListener('click', () => {
    const opening = $searchInput.hidden;
    $searchInput.hidden = !opening;
    if (opening) { $searchInput.focus(); } else { searchQuery = ''; $searchInput.value = ''; renderList(); }
  });
  $searchInput.addEventListener('input', () => {
    searchQuery = $searchInput.value;
    renderList();
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
    switcher.addEventListener('click', () => { closeAccountMenu(); openSettingsBridge(); });
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
    const inProjectActions = e.target && typeof e.target.closest === 'function'
      ? e.target.closest('.sidebar-project-actions')
      : null;
    if (!inProjectActions) closeProjectMenus();
    if (!$accountMenu.hidden
        && !$accountMenu.contains(e.target)
        && !$accountRow.contains(e.target)) {
      closeAccountMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeProjectMenus();
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
    window.athena.on('athena:auth-token-changed', () => loadAccount());
  }
})();
