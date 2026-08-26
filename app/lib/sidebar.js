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
  // window.AthenaGraphMode는 canvas.js가 이 스크립트보다 나중에(shell.html 로드
  // 순서) 세운다 — 그래서 모듈 로드 시점이 아니라 클릭 시점에만 참조한다(기존
  // $newChat의 window.AthenaShell 참조와 같은 패턴, 이 파일 위 머리말 참고).
  const modeNav = (window.AthenaLib && window.AthenaLib.SidebarModeNav)
    ? window.AthenaLib.SidebarModeNav.createSidebarModeNav({
        items: {
          summary: document.getElementById('modeNavSummary'),
          graph: document.getElementById('modeNavGraph'),
          agent: document.getElementById('modeNavAgent'),
        },
        badge: document.getElementById('modeNavAgentBadge'),
        onSelect: (view) => {
          if (window.AthenaGraphMode && typeof window.AthenaGraphMode.setView === 'function') {
            window.AthenaGraphMode.setView(view);
          }
          // 에이전트모드 진입 시 라우틴 목록을 새로 받아온다(리프 1.2.2, 3단계) —
          // loadAgentRoutines()가 안에서 renderList()까지 호출한다. 다른 모드는
          // 라우틴 섹션과 무관하니 그냥 다시 그리기만 한다(대화 이력 복원).
          if (view === 'agent') loadAgentRoutines(); else renderList();
        },
      })
    : null;

  // 3단계(리프 1.2.2, Paper 보드 39 보강본) — 순수 포매팅/상태아이콘은
  // agent-sidebar-list.js가 갖고 DOM은 여기서 조립한다(다른 make*Item과 같은 자리).
  const agentSidebarList = window.AthenaLib && window.AthenaLib.AgentSidebarList;
  let agentRoutinesCache = [];
  let agentRoutinesRequestId = 0; // stale-응답 가드 — 아래 주석 참고.

  function currentMode() {
    return (window.AthenaGraphMode && window.AthenaGraphMode.state && window.AthenaGraphMode.state.view) || 'summary';
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
  let activeConversationId = null;
  let selectedNotifyId = null;
  let showOlder = false;
  let searchQuery = '';

  // ---------- 날짜 섹션 ----------
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

  function bucketOf(updatedAt) {
    const now = startOfDay(new Date());
    const day = startOfDay(new Date(updatedAt));
    const diffDays = Math.round((now.getTime() - day.getTime()) / 86400000);
    if (diffDays <= 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays <= 7) return 'week';
    return 'older';
  }

  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function makeSectionLabel(text, extraClass) {
    const label = el('div', extraClass ? `sidebar-section-label ${extraClass}` : 'sidebar-section-label');
    label.textContent = text;
    return label;
  }

  function makeConversationItem(conv) {
    const btn = el('button', 'sidebar-item');
    btn.type = 'button';
    btn.title = conv.title;
    const isSelected = conv.id === activeConversationId && !selectedNotifyId;
    if (isSelected) btn.classList.add('is-selected');
    const label = el('span', 'sidebar-item-label');
    label.textContent = conv.title;
    btn.appendChild(label);
    if (isSelected) {
      const dot = el('span', 'sidebar-item-dot');
      btn.appendChild(dot);
    }
    btn.addEventListener('click', () => selectConversation(conv.id));
    return btn;
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

    const buckets = { today: [], yesterday: [], week: [], older: [] };
    for (const conv of filtered) buckets[bucketOf(conv.updatedAt)].push(conv);

    const sections = [['today', '오늘'], ['yesterday', '어제'], ['week', '지난 7일']];
    for (const [key, label] of sections) {
      if (!buckets[key].length) continue;
      $list.appendChild(makeSectionLabel(label));
      for (const conv of buckets[key]) $list.appendChild(makeConversationItem(conv));
    }

    if (buckets.older.length) {
      const visible = showOlder || q ? buckets.older : buckets.older.slice(0, INITIAL_VISIBLE);
      for (const conv of visible) $list.appendChild(makeConversationItem(conv));
      // 이미 다 보이면(older 6개 이하) 눌러도 아무 것도 안 늘어나는 버튼을
      // 남기지 않는다 — INITIAL_VISIBLE을 넘을 때만 보여준다.
      if (!showOlder && !q && buckets.older.length > INITIAL_VISIBLE) {
        const more = el('button', 'sidebar-item sidebar-more');
        more.type = 'button';
        more.textContent = `더 보기 (${buckets.older.length})`;
        more.addEventListener('click', () => { showOlder = true; renderList(); });
        $list.appendChild(more);
      }
    }

    if (!filtered.length && !notifyRooms.length) {
      const empty = el('div', 'sidebar-section-label');
      empty.textContent = q ? '검색 결과 없음' : '대화 이력 없음';
      $list.appendChild(empty);
    }
  }

  async function loadConversations() {
    try {
      const res = await window.athena.invoke('athena:conversations-list');
      conversationsCache = (res && Array.isArray(res.conversations)) ? res.conversations : [];
      activeConversationId = res && res.activeId ? res.activeId : null;
    } catch {
      conversationsCache = [];
    }
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
  }

  // ---------- 알림 파생 방(Paper 보드 08) ----------
  // 세션 메모리만 — 앱을 다시 켜면 비어 있다(위 파일 머리말 참고).
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

  function handleRoutineEvent(event) {
    if (!event || event.type !== 'routine-fired') return;
    const id = event.routine_id || event.id;
    if (!id) return;
    const firedAtMs = Number.isFinite(Date.parse(event.fired_at)) ? Date.parse(event.fired_at) : Date.now();
    const existing = notifyRooms.find((r) => r.id === id);
    if (existing) {
      existing.firedAt = firedAtMs;
      existing.title = routineEventTitle(event);
      existing.read = existing.id === selectedNotifyId;
    } else {
      notifyRooms.unshift({ id, title: routineEventTitle(event), firedAt: firedAtMs, read: false, event });
    }
    renderList();
    updateAgentBadge();
  }

  function selectNotifyRoom(id) {
    const room = notifyRooms.find((r) => r.id === id);
    if (!room) return;
    room.read = true;
    selectedNotifyId = id;
    const d = new Date(room.firedAt);
    const pad2 = (n) => String(n).padStart(2, '0');
    $roomTime.textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    $roomTitle.textContent = room.title;
    $roomBanner.hidden = false;
    renderList();
    updateAgentBadge();
  }

  // ---------- 새 대화 ----------
  // 배경 대화(historyConversationId)는 앱 수명 단위로 고정돼 있어 진짜 새
  // 세션을 열 수는 없다(위 머리말) — "새 대화"는 눈에 보이는 캔버스·이력을
  // 비우는 것까지만 한다. save-failed 배지 라우터는 lineEl.isConnected를
  // 먼저 확인하므로(lib/history-badge.js) 지워진 줄을 향한 배지 시도는
  // 조용히 무시된다.
  $newChat.addEventListener('click', () => {
    if (window.AthenaShell && typeof window.AthenaShell.clearCanvases === 'function') {
      window.AthenaShell.clearCanvases();
    }
    while ($history.firstChild) $history.removeChild($history.firstChild);
    $roomBanner.hidden = true;
    selectedNotifyId = null;
    renderList();
    if ($input) { $input.value = ''; $input.focus(); }
  });

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
    if ($accountMenu.hidden) return;
    if ($accountMenu.contains(e.target) || $accountRow.contains(e.target)) return;
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

  // ---------- 부트 ----------
  loadConversations();
  loadAccount();
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
