// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 에이전트모드 캔버스(Paper 보드 39) — #agentCanvas 컨테이너를 완전히 소유하고
// 헤더·탭·통계 카드·리스트+상세를 전부 이 파일이 그린다. shell.html은 빈
// 컨테이너 하나만 갖는다(graph-mode의 graphSummaryTable/gridEmpty와 같은 자리 —
// 그리기는 JS가 전담, innerHTML 미사용). 7/9/10/11단계가 이 파일을 계속
// 확장한다(성향 제안, 알람 센터 등) — shell.html은 4단계 이후로 다시 손대지
// 않는다.
//
// 통계 카드 4장 중 "다음 실행"·"오늘 발화"·"성향 제안"은 대응하는 백엔드 집계가
// 없다(재검증 확인, Rev.3 ADR). "진행 중"도 fixture다(값을 뒷받침할 진행률
// 스트림이 없다). source:'fixture' 필드는 기존 canvasSource 컨벤션(chat.js)과
// 동형이다 — 지어낸 숫자가 아니라 "아직 라이브로 못 잰다"는 사실을 코드 차원에
// 남긴다(P3). DOM에도 data-source 속성으로 새겨 둔다.
//
// 리스트(5단계, "예약·감시")는 세 출처를 한 화면에 섞는다:
//   · 감시(watch) — GET /api/v1/routines 실데이터. status가 active/paused인 것.
//   · 초안(draft, 8단계 추가) — status가 draft인 것. ◌ 점선 핑크 행으로
//     구분한다(Paper 보드 43 실측). draft→confirm 자체는 채팅의 "작업 요약·
//     초안" 카드 칩("바로 활성화")이 처리한다 — 여기서 새로 만들지 않는다
//     (재사용, 동선 규칙③ "확정은 채팅 카드의 칩 — 캔버스는 결과가 비치는
//     곳"). 그래서 상세 패널은 draft 항목에서 읽기 전용이다(액션 버튼 없음).
//   · 예약(schedule) — fixture. 백엔드 트리거 카탈로그에 벽시계 스케줄
//     개념이 없다(재검증 확인) — **예약 트리거 백엔드 미구현, 후속 스코프**.
// 탭(모두/활성/일시중지)·검색은 세 출처 모두에 동일하게 적용된다(화면
// 하나이므로 필터도 하나). "일시중지" 탭 외의 필터는 draft/watch/schedule을
// 가리지 않는다 — 'all' 탭에서 draft가 함께 보인다.
//
// 일시중지·재개 버튼은 감시(watch, live) 항목에서만 활성이다(6.5단계 —
// 6단계 pause/resume 엔드포인트를 이 화면에 배선). 예약(schedule) 항목은
// 백엔드에 대응 전이가 없어 항상 비활성으로 남는다(기능 없는 버튼을 활성으로
// 두지 않는다, P3). 상세 패널의 "최근 실행" 로그는 여전히 fixture다(ledger
// API 라이브 연결은 10단계 몫).
//
// 9단계(알람 센터·라이브 관제, Paper 보드 40) — 헤더에 뷰 탭 3종(작업/알람/
// 라이브)이 생긴다. "작업" 뷰는 위 39번 화면 그대로(통계·리스트+상세·제안).
// "알람"·"라이브" 뷰는 보드 40의 두 컬럼(알람 피드+라이브 관제)을 한 화면에
// 같이 그린다 — Paper 아트보드가 둘을 분리해 그리지 않았다(제목 자체가
// "알람 센터 · 라이브 관제"로 하나다), 그래서 지어내지 않고 같은 내용을
// 공유한다. 알람 피드는 sidebar.js의 notifyRooms를 window.AthenaNotify로
// 승격한 것 — 실데이터는 routine-fired 한 종류뿐이다(handleRoutineEvent가
// 그 외 이벤트는 애초에 방을 안 만든다), 그래서 카테고리 아이콘도 ◆ 하나만
// 쓴다(Paper 목업의 ●⚠❚❚ 3종은 대응하는 실이벤트가 없어 지어내지 않는다,
// P3). 라이브 컬럼(진행바·"다음 24시간" 타임라인)은 fixture다(WS 진행률
// 스트림·예약 트리거 둘 다 백엔드 미보유, 재검증 확인). "● WS 연결됨"만
// 실데이터다 — main.js RoutineFeed의 onStatus를 이번에 처음 렌더러로
// 릴레이했다(이전엔 no-op이라 신호가 안 왔다, 재검증에서 확인).
//
// 10단계(실행 이력·결과, Paper 보드 41 "작업 드릴인") — 감시(watch) 항목의
// 상세 패널 "최근 실행" 캡션에 "전체 이력 보기 →"가 생긴다. draft·예약
// (schedule)은 이 링크가 없다 — draft는 실행된 적이 없고, schedule은 실제
// 백엔드 라우틴이 아니라 ledger에 대응 행이 있을 수 없다(P3). 드릴인 화면은
// 뷰 탭을 브레드크럼("작업 › 이름" + 상태 배지)으로 잠깐 대체한다 — Paper가
// 뷰 탭 대신 브레드크럼을 그린다(재검증 확인). "최근 30회"는 6단계
// GET /{id}/runs 실데이터, 상태 아이콘은 ledger의 실제 verdict 3종
// (fired/near/suppressed)만 쓴다 — 목업의 "재시도 ↻"·"대체 실행 ⚠"은 대응
// verdict가 없어 만들지 않는다(AC10). 통계 4타일과 "오늘 산출물" 카드는
// ledger 스키마에 근거가 없어(컬럼이 식별자·숫자·판정 사유뿐, ledger.py
// 머리말 참고) 4타일만 fixture로 유지하고 산출물 카드는 아예 그리지 않는다
// (지어낼 데이터가 없다, 팀 리드 브리핑에도 없던 항목).
const VERDICT_ICON = {
  fired: { glyph: '●', colorVar: '--color-ok' },
  near: { glyph: '◐', colorVar: '--color-warn' },
  suppressed: { glyph: '○', colorVar: '--color-k-faint' },
};

// 11단계(프로액티브, Paper 보드 42) — 4번째 뷰 탭 "제안". "지금 읽히는 성향"
// 스트립·제안 카드 2장은 7단계와 같은 원천(GET /api/v1/brain/profile-summary,
// suggestionsCache)을 재사용한다 — 39번 좌측 미니 목록과 42번 전체 화면이
// 서로 다른 데이터를 보여주면 "두 개의 진실"이 생긴다(sidebar.js 머리말과
// 같은 원칙). 칩 "루틴으로"는 7단계 "추가"와 같은 seedChatInput 경로,
// "보류"는 세션 동안만 그 카드를 숨긴다(백엔드 저장이 없다 — 재시작하면
// 다시 보인다, 지어낸 영속성을 암시하지 않는다, P3). 말걸기 가드 패널은
// 정적 표시만이다 — 저장 백엔드가 없어 값을 바꾸는 UI를 만들지 않는다
// (죽은 버튼 금지, 팀 리드 브리핑 명시). "그래프 모드에서 근거 보기 →"는
// 사이드바 모드 네비를 그대로 재사용한다(setView + setActive 둘 다 — 하나만
// 부르면 캔버스는 바뀌는데 사이드바 활성 표시는 안 바뀌는 불일치가 생긴다).

const TABS = [
  { key: 'all', label: '모두' },
  { key: 'active', label: '활성' },
  { key: 'paused', label: '일시중지' },
];

// 상위 뷰 탭(9단계, 11단계에서 4번째 추가) — 위 TABS(리스트 필터, "작업" 뷰
// 내부용)와는 다른 층위다.
const VIEWS = [
  { key: 'tasks', label: '작업' },
  { key: 'alerts', label: '알람' },
  { key: 'live', label: '라이브' },
  { key: 'proactive', label: '제안' },
];

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function svgEl(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, String(value));
  return node;
}

// 통계 카드 4장의 fixture 값(Paper 보드 39 실측 문구 그대로) — 위 머리말 참고.
function fixtureStats() {
  return [
    { key: 'next-run', label: '다음 실행', value: '07:30 평일 아침 브리핑', sub: '49분 후 · 기존 채팅', source: 'fixture' },
    { key: 'in-progress', label: '진행 중', value: '● 시세 수집 — 삼성전자', sub: '감시 조건 2/3 · 12초 전', source: 'fixture' },
    { key: 'fired-today', label: '오늘 발화', value: '3건', sub: '마지막 15:30 · 조건 도달 1', source: 'fixture' },
    { key: 'suggestions', label: '성향 제안', value: '2건 대기', sub: '그래프 신호 312개 기반', source: 'fixture', accent: true },
  ];
}

function statusRowIcon(routine) {
  if (routine.status === 'draft') return { glyph: '◌', colorVar: '--color-brand' };
  if (routine.status === 'paused') return { glyph: '❚❚', colorVar: '--color-warn' };
  if (routine.status === 'active') {
    return routine.mode === 'realtime-ws'
      ? { glyph: '●', colorVar: '--color-info' }
      : { glyph: '●', colorVar: '--color-ok' };
  }
  return { glyph: '○', colorVar: '--color-k-faint' }; // expired/cancelled/failed — 정직하게 흐리게
}

function createAgentCanvas(deps) {
  const {
    container, fetchRoutines, onNewTaskClick, pauseRoutine, resumeRoutine,
    fetchProfileSummary, onAddSuggestion,
    fetchAlerts, markAllAlertsRead, getWsConnected,
    fetchRuns,
    onOpenGraph,
  } = deps || {};
  if (!container) return { mount() {}, async refresh() {} };

  let activeTab = 'all';
  let searchQuery = '';
  let routinesCache = [];
  let requestId = 0; // stale-응답 가드 — sidebar.js 3단계(loadAgentRoutines)와 같은 이유.
  let suggestionsCache = [];
  let suggestRequestId = 0; // 위와 같은 이유 — 별개 요청이라 별개 가드를 쓴다.
  let activeView = 'tasks';
  let alertsCache = [];
  let historyItem = null; // 드릴인 중인 항목(10단계) — null이면 드릴인이 아니다.
  let heldSuggestionIds = new Set(); // "보류"한 제안(11단계) — 세션 동안만, 저장 안 됨.
  let historyRequestId = 0; // 위와 같은 이유 — 별개 요청이라 별개 가드를 쓴다.

  // ---------- 헤더 ----------
  const head = el('div', 'agent-head');
  const title = el('div', 'agent-title');
  title.textContent = '에이전트';
  head.appendChild(title);

  // 뷰 탭 3종(9단계, 위 머리말 참고) — 항상 보인다.
  const viewTabsWrap = el('div', 'agent-view-tabs');
  const viewTabButtons = {};
  for (const view of VIEWS) {
    const btn = el('button', view.key === activeView ? 'agent-view-tab is-active' : 'agent-view-tab');
    btn.type = 'button';
    btn.textContent = view.label;
    btn.addEventListener('click', () => setActiveView(view.key));
    viewTabButtons[view.key] = btn;
    viewTabsWrap.appendChild(btn);
  }
  head.appendChild(viewTabsWrap);

  const markAllReadBtn = el('button', 'agent-mark-all-read');
  markAllReadBtn.type = 'button';
  markAllReadBtn.textContent = '모두 읽음으로';
  markAllReadBtn.hidden = true; // "작업" 뷰에서는 숨는다 — setActiveView가 토글.
  markAllReadBtn.addEventListener('click', () => {
    if (typeof markAllAlertsRead === 'function') markAllAlertsRead();
    renderAlarmColumn();
  });
  head.appendChild(markAllReadBtn);

  // 실행 이력 드릴인 브레드크럼(10단계, Paper 보드 41) — 뷰 탭 자리를 잠깐
  // 대체한다("작업 › 이름" + 상태 배지). openHistory/closeHistory가 토글한다.
  const breadcrumb = el('div', 'agent-breadcrumb');
  breadcrumb.hidden = true;
  const breadcrumbBack = el('button', 'agent-breadcrumb-back');
  breadcrumbBack.type = 'button';
  breadcrumbBack.textContent = '작업 ›';
  breadcrumbBack.addEventListener('click', () => closeHistory());
  breadcrumb.appendChild(breadcrumbBack);
  const breadcrumbTitle = el('span', 'agent-breadcrumb-title');
  breadcrumb.appendChild(breadcrumbTitle);
  // agent-status-badge와는 다른 클래스다(같은 이름을 쓰면 findByClass류 조회가
  // 상세 패널의 배지 대신 이 빈 배지를 먼저 집는다 — 실측: 기존 상세 패널
  // 테스트 3건이 이 충돌로 깨졌다). 시각은 .agent-breadcrumb-badge가 따로 진다.
  const breadcrumbBadge = el('span', 'agent-breadcrumb-badge');
  breadcrumb.appendChild(breadcrumbBadge);
  head.appendChild(breadcrumb);

  // "그래프 모드에서 근거 보기 →"(11단계, "제안" 뷰 전용) — 사이드바 모드
  // 네비를 그대로 재사용한다(위 머리말 참고).
  const graphLinkBtn = el('button', 'agent-graph-link');
  graphLinkBtn.type = 'button';
  graphLinkBtn.textContent = '그래프 모드에서 근거 보기 →';
  graphLinkBtn.hidden = true;
  graphLinkBtn.addEventListener('click', () => { if (typeof onOpenGraph === 'function') onOpenGraph(); });
  head.appendChild(graphLinkBtn);

  // "작업" 뷰 전용 머리(부제+리스트 필터 탭+검색+CTA) — .agent-head 레이아웃을
  // 그대로 물려받는다. "알람"·"라이브" 뷰에서는 숨는다(setActiveView).
  const tasksHead = el('div', 'agent-head agent-tasks-head');
  const subtitle = el('div', 'agent-subtitle');
  tasksHead.appendChild(subtitle);

  const tabsWrap = el('div', 'agent-tabs');
  const tabButtons = {};
  for (const tab of TABS) {
    const btn = el('button', tab.key === activeTab ? 'agent-tab is-active' : 'agent-tab');
    btn.type = 'button';
    btn.textContent = tab.label;
    btn.addEventListener('click', () => setActiveTab(tab.key));
    tabButtons[tab.key] = btn;
    tabsWrap.appendChild(btn);
  }
  tasksHead.appendChild(tabsWrap);

  const actions = el('div', 'agent-head-actions');
  const searchWrap = el('div', 'agent-search');
  const searchIcon = svgEl('svg', { width: 12, height: 12, viewBox: '0 0 12 12' });
  searchIcon.setAttribute('aria-hidden', 'true');
  searchIcon.appendChild(svgEl('circle', { cx: 5, cy: 5, r: 3.4, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2 }));
  searchIcon.appendChild(svgEl('path', { d: 'M7.6 7.6 10.4 10.4', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2 }));
  searchWrap.appendChild(searchIcon);
  const searchInput = el('input', 'agent-search-input');
  searchInput.type = 'text';
  searchInput.placeholder = '작업 검색';
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    renderPanels();
  });
  searchWrap.appendChild(searchInput);
  actions.appendChild(searchWrap);

  // 43번 "새 작업은 채팅에서" 원칙(동선 규칙①) — 시트를 열지 않는다. 시작
  // 문장을 심고 포커스만 옮기는 실제 동작은 canvas.js가 onNewTaskClick으로
  // 주입한다(8단계, shell.js seedChatInput 버스 — 7단계 제안 "추가"와 같은 경로).
  const cta = el('button', 'agent-cta');
  cta.type = 'button';
  cta.textContent = '＋ 새 작업 · 채팅에서';
  cta.addEventListener('click', () => { if (typeof onNewTaskClick === 'function') onNewTaskClick(); });
  actions.appendChild(cta);
  tasksHead.appendChild(actions);

  // ---------- 통계 카드 4장 ----------
  const stats = el('div', 'agent-stats');
  function renderStats() {
    while (stats.firstChild) stats.removeChild(stats.firstChild);
    for (const stat of fixtureStats()) {
      const card = el('div', stat.accent ? 'agent-stat-card is-accent' : 'agent-stat-card');
      card.setAttribute('data-source', stat.source); // 출처 표시(P3) — 지어낸 숫자가 아님을 코드 차원에 남긴다.
      const label = el('div', 'agent-stat-label');
      label.textContent = stat.label;
      const value = el('div', 'agent-stat-value');
      value.textContent = stat.value;
      const sub = el('div', 'agent-stat-sub');
      sub.textContent = stat.sub;
      card.appendChild(label);
      card.appendChild(value);
      card.appendChild(sub);
      stats.appendChild(card);
    }
  }

  // ---------- 본문 — 좌측 "예약·감시" 리스트(330px) + 우측 상세(429px, 5단계) ----------
  let selectedId = null;
  // 사용자가 직접 행을 고르기 전까지는 "지금 첫 번째" 항목을 계속 따라간다.
  // mount()는 refresh()보다 먼저 돌아서(라이브 데이터가 아직 없다) 처음엔
  // fixture 예약 행이 첫 항목이 된다 — 그 상태에서 고정해버리면 뒤이어
  // 라이브 라우틴이 도착해도 상세 패널이 계속 fixture를 보여준다(실측
  // 버그). 사용자가 실제로 클릭하면 그때부터는 그 선택을 존중한다.
  let userSelected = false;

  const body = el('div', 'agent-body');
  const panels = el('div', 'agent-panels');
  const listCol = el('div', 'agent-list-col');
  const listCaption = el('div', 'agent-panel-caption');
  listCaption.textContent = '예약 · 감시';
  listCol.appendChild(listCaption);
  const watchList = el('div', 'agent-watch-list');
  listCol.appendChild(watchList);

  // ---------- 제안 — 그래프 성향 기반(7단계, Paper 보드 39 하단) ----------
  // GET /api/v1/brain/profile-summary(athena:brain-profile-summary IPC) 실데이터 —
  // graph-mode/summary-table.js(보드 07)가 이미 쓰는 것과 같은 엔드포인트다.
  // brain.py 5종 분석 중 이 필드 구성(entity_name·relation_kind·reinforcement·
  // rationale)이 Paper 목업의 "OO 성향 N회 보강 — 근거문" 패턴과 가장 가깝다 —
  // suggested-questions("불확실한 관계 되묻기")는 성격이 달라 억지로 끼워맞추지
  // 않는다(P3). 제목은 목업의 지어낸 태스크 문구 대신 entity_name을 정직하게
  // 쓴다. 신호가 없으면 섹션 자체를 숨긴다(빈 라벨을 노출하지 않는다, P3).
  const suggestSection = el('div', 'agent-suggest-section');
  suggestSection.hidden = true;
  const suggestDivider = el('div', 'agent-suggest-divider');
  suggestSection.appendChild(suggestDivider);
  const suggestCaption = el('div', 'agent-panel-caption');
  suggestCaption.textContent = '제안 — 그래프 성향 기반';
  suggestSection.appendChild(suggestCaption);
  const suggestList = el('div', 'agent-suggest-list');
  suggestSection.appendChild(suggestList);
  listCol.appendChild(suggestSection);

  // 추가 클릭 → 시트 없이 채팅으로(43 원칙). 실제 필드만 조합한다 — 지어낸
  // 문구 없음(P3).
  function suggestionSeedText(entry) {
    const name = entry.entity_name || entry.entity_id;
    return `"${name}"에 대한 ${entry.relation_kind} 성향이 ${entry.reinforcement}회 보강됐어요 — 관련 루틴을 만들어줄까요?`;
  }

  function makeSuggestionRow(entry) {
    const row = el('div', 'agent-suggest-row');
    row.setAttribute('data-source', 'live'); // profile-summary는 실데이터다.
    const icon = el('span', 'agent-suggest-icon');
    icon.textContent = '◆';
    row.appendChild(icon);
    const textWrap = el('span', 'agent-suggest-text');
    const title = el('span', 'agent-suggest-title');
    title.textContent = entry.entity_name || entry.entity_id;
    textWrap.appendChild(title);
    const rationale = el('span', 'agent-suggest-rationale');
    rationale.textContent = `${entry.relation_kind} 성향 ${entry.reinforcement}회 보강` + (entry.rationale ? ` — ${entry.rationale}` : '');
    textWrap.appendChild(rationale);
    row.appendChild(textWrap);
    const addBtn = el('button', 'agent-suggest-add');
    addBtn.type = 'button';
    addBtn.textContent = '추가';
    addBtn.addEventListener('click', () => {
      if (typeof onAddSuggestion === 'function') onAddSuggestion(suggestionSeedText(entry));
    });
    row.appendChild(addBtn);
    return row;
  }

  function renderSuggestions() {
    while (suggestList.firstChild) suggestList.removeChild(suggestList.firstChild);
    suggestSection.hidden = suggestionsCache.length === 0;
    for (const entry of suggestionsCache) suggestList.appendChild(makeSuggestionRow(entry));
    renderProactiveView(); // 11단계 — 같은 캐시를 쓰는 "제안" 뷰도 함께 갱신한다(위 머리말).
  }

  // GET /api/v1/brain/profile-summary 실데이터 — requestId로 낡은 응답을 버린다
  // (routine 목록과 같은 이유·같은 패턴, 별개 요청이라 별개 카운터를 쓴다).
  async function refreshSuggestions() {
    const rid = ++suggestRequestId;
    let entries = [];
    try {
      entries = (typeof fetchProfileSummary === 'function') ? await fetchProfileSummary() : [];
      if (!Array.isArray(entries)) entries = [];
    } catch {
      entries = [];
    }
    if (rid !== suggestRequestId) return;
    suggestionsCache = entries;
    renderSuggestions();
  }

  const detailCol = el('div', 'agent-detail-col');
  panels.appendChild(listCol);
  panels.appendChild(detailCol);
  body.appendChild(panels);

  // ---------- 알람 센터 · 라이브 관제(9단계, Paper 보드 40) ----------
  // "알람"·"라이브" 뷰가 공유하는 한 화면 — 위 머리말 참고.
  const alarmLiveBody = el('div', 'agent-alarm-live');
  alarmLiveBody.hidden = true;

  const alarmCol = el('div', 'agent-alarm-col');
  const alarmCaption = el('div', 'agent-panel-caption');
  alarmCaption.textContent = '알람';
  alarmCol.appendChild(alarmCaption);
  const alarmList = el('div', 'agent-alarm-list');
  alarmCol.appendChild(alarmList);
  alarmLiveBody.appendChild(alarmCol);

  function updateAlertsTabLabel() {
    const unread = alertsCache.filter((a) => !a.read).length;
    viewTabButtons.alerts.textContent = unread > 0 ? `알람 ${unread}` : '알람';
  }

  function formatAlarmTime(ms) {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    const pad2 = (n) => String(n).padStart(2, '0');
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  // 액센트 바 색으로 미확인(핑크)/읽음(라인색)을 구분한다(Paper 실측). 카테고리
  // 아이콘은 ◆ 하나뿐이다 — 실데이터가 routine-fired 한 종류뿐이라서다(위 머리말).
  function makeAlarmRow(alert) {
    const row = el('div', alert.read ? 'agent-alarm-row' : 'agent-alarm-row is-unread');
    const icon = el('span', 'agent-alarm-icon');
    icon.textContent = '◆';
    row.appendChild(icon);
    const textWrap = el('span', 'agent-alarm-text');
    const t = el('span', 'agent-alarm-title');
    t.textContent = alert.title;
    textWrap.appendChild(t);
    if (alert.sub) {
      const s = el('span', 'agent-alarm-sub');
      s.textContent = alert.sub;
      textWrap.appendChild(s);
    }
    row.appendChild(textWrap);
    const time = el('span', 'agent-alarm-time');
    time.textContent = formatAlarmTime(alert.firedAt);
    row.appendChild(time);
    return row;
  }

  // notifyRooms(sidebar.js가 소유)를 읽기만 한다 — IPC 왕복이 없어 동기다.
  function renderAlarmColumn() {
    while (alarmList.firstChild) alarmList.removeChild(alarmList.firstChild);
    const alerts = (typeof fetchAlerts === 'function') ? fetchAlerts() : [];
    alertsCache = Array.isArray(alerts) ? alerts : [];
    updateAlertsTabLabel();
    if (!alertsCache.length) {
      const empty = el('div', 'agent-list-empty');
      empty.textContent = '받은 알람이 없습니다';
      alarmList.appendChild(empty);
      return;
    }
    for (const alert of alertsCache) alarmList.appendChild(makeAlarmRow(alert));
  }

  // 라이브 컬럼 — 진행바·"다음 24시간" 전부 fixture다(위 머리말). "WS 연결됨"만
  // getWsConnected(canvas.js가 athena:routine-feed-status를 구독해 준다)로 실데이터다.
  function fixtureLiveProgress() {
    return [
      { key: 'p1', label: '● 시세 수집 — 삼성전자', badge: '실시간', sub: '조건 2/3 · 12초 전 확인', pct: 66 },
      { key: 'p2', label: '● 평일 아침 브리핑', badge: '대기 → 07:30', sub: '49분 후 · 소스 예열됨', pct: 92 },
    ];
  }

  function fixtureTimeline() {
    return [
      { label: '아침 브리핑', sub: '기존 채팅' },
      { label: '장 시작 전 말걸기', sub: '프로액티브' },
      { label: '감시 마감 확인', sub: '삼성 88,000' },
      { label: '성향 제안 검토', sub: '그래프 반영' },
    ];
  }

  const liveCol = el('div', 'agent-live-col');
  liveCol.setAttribute('data-source', 'fixture');
  const liveCaption = el('div', 'agent-panel-caption');
  liveCaption.textContent = '라이브';
  liveCol.appendChild(liveCaption);

  const liveProgressWrap = el('div', 'agent-live-progress');
  for (const p of fixtureLiveProgress()) {
    const row = el('div', 'agent-live-progress-row');
    const headRow = el('div', 'agent-live-progress-head');
    const label = el('span', 'agent-live-progress-label');
    label.textContent = p.label;
    headRow.appendChild(label);
    const badge = el('span', 'agent-live-progress-badge');
    badge.textContent = p.badge;
    headRow.appendChild(badge);
    row.appendChild(headRow);
    const sub = el('div', 'agent-live-progress-sub');
    sub.textContent = p.sub;
    row.appendChild(sub);
    const bar = el('div', 'agent-live-progress-bar');
    const fill = el('div', 'agent-live-progress-fill');
    fill.style.width = `${p.pct}%`;
    bar.appendChild(fill);
    row.appendChild(bar);
    liveProgressWrap.appendChild(row);
  }
  liveCol.appendChild(liveProgressWrap);

  const timelineCaption = el('div', 'agent-panel-caption');
  timelineCaption.textContent = '다음 24시간';
  liveCol.appendChild(timelineCaption);
  const timelineWrap = el('div', 'agent-live-timeline');
  for (const t of fixtureTimeline()) {
    const row = el('div', 'agent-live-timeline-row');
    const dot = el('span', 'agent-live-timeline-dot');
    dot.textContent = '●';
    row.appendChild(dot);
    const label = el('span', 'agent-live-timeline-label');
    label.textContent = t.label;
    row.appendChild(label);
    const sub = el('span', 'agent-live-timeline-sub');
    sub.textContent = t.sub;
    row.appendChild(sub);
    timelineWrap.appendChild(row);
  }
  liveCol.appendChild(timelineWrap);

  const wsRow = el('div', 'agent-live-ws');
  wsRow.setAttribute('data-source', 'live');
  const wsDot = el('span', 'agent-live-ws-dot');
  wsRow.appendChild(wsDot);
  const wsLabel = el('span', 'agent-live-ws-label');
  wsRow.appendChild(wsLabel);
  liveCol.appendChild(wsRow);
  const wsCaption = el('div', 'agent-live-ws-caption');
  wsCaption.textContent = '발화는 채팅으로 도착 — 여긴 관제만';
  liveCol.appendChild(wsCaption);

  function renderWsStatus() {
    const connected = typeof getWsConnected === 'function' ? !!getWsConnected() : false;
    wsDot.textContent = '●';
    wsDot.style.color = connected ? 'var(--color-ok)' : 'var(--color-k-faint)';
    wsLabel.textContent = connected ? 'WS 연결됨' : 'WS 연결 안 됨';
  }

  alarmLiveBody.appendChild(liveCol);

  // ---------- 실행 이력 · 결과 드릴인(10단계, Paper 보드 41) ----------
  const historyBody = el('div', 'agent-history-body');
  historyBody.hidden = true;

  const historyRunsCol = el('div', 'agent-history-runs-col');
  const historyRunsCaption = el('div', 'agent-panel-caption');
  historyRunsCaption.textContent = '최근 30회';
  historyRunsCol.appendChild(historyRunsCaption);
  const historyRunsList = el('div', 'agent-history-runs-list');
  historyRunsCol.appendChild(historyRunsList);
  historyBody.appendChild(historyRunsCol);

  function fixtureHistoryStats() {
    return [
      { label: '성공률', value: '93%' },
      { label: '평균', value: '7.4s' },
      { label: '발화→열람', value: '71%' },
      { label: '이어진 대화', value: '9건' },
    ];
  }

  const historyStatsCol = el('div', 'agent-history-stats-col');
  historyStatsCol.setAttribute('data-source', 'fixture'); // ledger 스키마에 근거 없음(위 머리말).
  const historyStatsCaption = el('div', 'agent-panel-caption');
  historyStatsCaption.textContent = '30회 통계';
  historyStatsCol.appendChild(historyStatsCaption);
  const historyStatsGrid = el('div', 'agent-history-stats-grid');
  for (const tile of fixtureHistoryStats()) {
    const t = el('div', 'agent-history-stat-tile');
    const l = el('div', 'agent-history-stat-label');
    l.textContent = tile.label;
    t.appendChild(l);
    const v = el('div', 'agent-history-stat-value');
    v.textContent = tile.value;
    t.appendChild(v);
    historyStatsGrid.appendChild(t);
  }
  historyStatsCol.appendChild(historyStatsGrid);
  historyBody.appendChild(historyStatsCol);

  function formatRunTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  // ledger 실제 verdict 3종(fired/near/suppressed)만 쓴다 — 목업의 "재시도"·
  // "대체 실행"류는 대응 verdict가 없어 만들지 않는다(AC10, 위 머리말).
  function makeHistoryRunRow(run) {
    const icon = VERDICT_ICON[run.verdict] || { glyph: '?', colorVar: '--color-k-faint' };
    const row = el('div', 'agent-history-run');
    const time = el('span', 'agent-history-run-time');
    time.textContent = formatRunTime(run.ts);
    row.appendChild(time);
    const mark = el('span', 'agent-history-run-mark');
    mark.textContent = icon.glyph;
    mark.style.color = `var(${icon.colorVar})`;
    row.appendChild(mark);
    const textWrap = el('span', 'agent-history-run-text');
    const reason = el('span', 'agent-history-run-reason');
    reason.textContent = run.reason || '';
    textWrap.appendChild(reason);
    if (run.observed != null || run.threshold != null) {
      const detail = el('span', 'agent-history-run-detail');
      detail.textContent = `관측 ${run.observed} · 임계 ${run.threshold}`;
      textWrap.appendChild(detail);
    }
    row.appendChild(textWrap);
    return row;
  }

  // GET /api/v1/routines/{id}/runs 실데이터(6단계) — requestId로 낡은 응답을
  // 버린다(routine 목록·제안과 같은 이유·같은 패턴).
  async function refreshHistoryRuns() {
    if (!historyItem) return;
    const id = historyItem.id;
    const rid = ++historyRequestId;
    let runs = [];
    try {
      runs = (typeof fetchRuns === 'function') ? await fetchRuns(id) : [];
      if (!Array.isArray(runs)) runs = [];
    } catch {
      runs = [];
    }
    if (rid !== historyRequestId || !historyItem || historyItem.id !== id) return;
    // ledger는 append-only(오래된 게 먼저)라 최신 먼저로 뒤집고 30건으로 자른다.
    const sorted = runs.slice().sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 30);
    while (historyRunsList.firstChild) historyRunsList.removeChild(historyRunsList.firstChild);
    if (!sorted.length) {
      const empty = el('div', 'agent-list-empty');
      empty.textContent = '실행 이력이 없습니다';
      historyRunsList.appendChild(empty);
    } else {
      for (const run of sorted) historyRunsList.appendChild(makeHistoryRunRow(run));
    }
  }

  function openHistory(item) {
    historyItem = item;
    tasksHead.hidden = true;
    stats.hidden = true;
    body.hidden = true;
    alarmLiveBody.hidden = true;
    proactiveBody.hidden = true;
    graphLinkBtn.hidden = true;
    markAllReadBtn.hidden = true;
    viewTabsWrap.hidden = true;
    for (const k of Object.keys(viewTabButtons)) viewTabButtons[k].className = 'agent-view-tab';
    breadcrumb.hidden = false;
    breadcrumbTitle.textContent = item.title;
    breadcrumbBadge.className = `agent-breadcrumb-badge is-${item.status}`;
    breadcrumbBadge.textContent = item.status === 'paused' ? '일시중지' : '활성';
    historyBody.hidden = false;
    return refreshHistoryRuns(); // 호출부(클릭 핸들러)가 await할 수 있게 돌려준다.
  }

  // "작업 ›" 클릭 — 드릴인은 항상 "작업" 뷰에서만 열리므로(위 머리말) 그
  // 상태로 직접 되돌린다(탭 활성 표시도 "작업"으로 되돌린다 — 실측: 이전엔
  // 이 복원이 빠져 있어 복귀 후 어떤 탭도 활성으로 안 보였다).
  function closeHistory() {
    historyItem = null;
    breadcrumb.hidden = true;
    historyBody.hidden = true;
    viewTabsWrap.hidden = false;
    tasksHead.hidden = false;
    stats.hidden = false;
    body.hidden = false;
    proactiveBody.hidden = true;
    graphLinkBtn.hidden = true;
    activeView = 'tasks';
    for (const k of Object.keys(viewTabButtons)) {
      viewTabButtons[k].className = k === 'tasks' ? 'agent-view-tab is-active' : 'agent-view-tab';
    }
  }

  // ---------- 프로액티브(11단계, Paper 보드 42) ----------
  const proactiveBody = el('div', 'agent-proactive-body');
  proactiveBody.hidden = true;

  const proactiveStrip = el('div', 'agent-proactive-strip');
  const proactiveStripLabel = el('div', 'agent-panel-caption');
  proactiveStripLabel.textContent = '지금 읽히는 성향';
  proactiveStrip.appendChild(proactiveStripLabel);
  const proactiveStripValue = el('div', 'agent-proactive-strip-value');
  proactiveStrip.appendChild(proactiveStripValue);
  const proactiveStripSub = el('div', 'agent-proactive-strip-sub');
  proactiveStrip.appendChild(proactiveStripSub);
  proactiveBody.appendChild(proactiveStrip);

  const proactiveCardsWrap = el('div', 'agent-proactive-cards');
  proactiveBody.appendChild(proactiveCardsWrap);

  // 말걸기 가드 — 정적 표시만이다(저장 백엔드 없음, 팀 리드 브리핑 명시 —
  // 위 머리말). 값을 바꾸는 UI를 만들지 않는다(죽은 버튼 금지, P3).
  const nudgeGuard = el('div', 'agent-nudge-guard');
  nudgeGuard.setAttribute('data-source', 'fixture');
  const nudgeGuardCaption = el('div', 'agent-panel-caption');
  nudgeGuardCaption.textContent = '말걸기 가드';
  nudgeGuard.appendChild(nudgeGuardCaption);
  const nudgeGuardTags = el('div', 'agent-nudge-guard-tags');
  for (const label of ['하루 최대 2회', '조용 시간 22:00–07:00', '근거 표시 항상', '거절 반영 성향으로 학습']) {
    const tag = el('span', 'agent-nudge-guard-tag');
    tag.textContent = label;
    nudgeGuardTags.appendChild(tag);
  }
  nudgeGuard.appendChild(nudgeGuardTags);
  const nudgeGuardNote = el('div', 'agent-nudge-guard-note');
  nudgeGuardNote.textContent = '제안은 그래프 보강 15 이상일 때만 · 거절한 제안은 반복되지 않는다 → 발화 자체는 오른쪽 채팅에 도착';
  nudgeGuard.appendChild(nudgeGuardNote);
  proactiveBody.appendChild(nudgeGuard);

  function updateProactiveTabLabel() {
    const n = suggestionsCache.filter((e) => !heldSuggestionIds.has(e.entity_id)).length;
    viewTabButtons.proactive.textContent = n > 0 ? `제안 ${n}` : '제안';
  }

  function renderProactiveStrip() {
    const relations = [...new Set(suggestionsCache.map((e) => e.relation_kind).filter(Boolean))];
    proactiveStripValue.textContent = relations.length ? relations.join(' · ') : '아직 읽히는 성향이 없습니다';
    proactiveStripSub.textContent = suggestionsCache.length ? `신호 ${suggestionsCache.length}건` : '';
  }

  function makeProactiveCard(entry) {
    const card = el('div', 'agent-proactive-card');
    card.setAttribute('data-source', 'live'); // profile-summary는 실데이터다(7단계와 같은 원천).
    const head2 = el('div', 'agent-proactive-card-head');
    const icon = el('span', 'agent-proactive-card-icon');
    icon.textContent = '◆';
    head2.appendChild(icon);
    const title = el('span', 'agent-proactive-card-title');
    title.textContent = entry.entity_name || entry.entity_id;
    head2.appendChild(title);
    const routineBtn = el('button', 'agent-proactive-chip is-primary');
    routineBtn.type = 'button';
    routineBtn.textContent = '루틴으로';
    routineBtn.addEventListener('click', () => {
      if (typeof onAddSuggestion === 'function') onAddSuggestion(suggestionSeedText(entry));
    });
    head2.appendChild(routineBtn);
    const holdBtn = el('button', 'agent-proactive-chip');
    holdBtn.type = 'button';
    holdBtn.textContent = '보류';
    holdBtn.addEventListener('click', () => {
      // 세션 동안만 숨긴다 — 저장 백엔드가 없어 재시작하면 다시 보인다(위 머리말, P3).
      heldSuggestionIds.add(entry.entity_id);
      renderProactiveCards();
      updateProactiveTabLabel();
    });
    head2.appendChild(holdBtn);
    card.appendChild(head2);
    const rationale = el('div', 'agent-proactive-card-rationale');
    rationale.textContent = `${entry.relation_kind} 성향 ${entry.reinforcement}회 보강` + (entry.rationale ? ` — ${entry.rationale}` : '');
    card.appendChild(rationale);
    return card;
  }

  function renderProactiveCards() {
    while (proactiveCardsWrap.firstChild) proactiveCardsWrap.removeChild(proactiveCardsWrap.firstChild);
    const visible = suggestionsCache.filter((e) => !heldSuggestionIds.has(e.entity_id));
    if (!visible.length) {
      const empty = el('div', 'agent-list-empty');
      empty.textContent = '지금은 표시할 제안이 없습니다';
      proactiveCardsWrap.appendChild(empty);
    } else {
      for (const entry of visible) proactiveCardsWrap.appendChild(makeProactiveCard(entry));
    }
  }

  // suggestionsCache가 바뀔 때마다(refreshSuggestions) 같이 갱신된다 — 아래
  // renderSuggestions()가 부른다(단일 갱신 지점, 위 머리말 "두 개의 진실" 참고).
  function renderProactiveView() {
    renderProactiveStrip();
    renderProactiveCards();
    updateProactiveTabLabel();
  }

  // 예약 트리거 백엔드 미구현, 후속 스코프 — 벽시계 스케줄 개념이 SOURCES
  // 카탈로그에 없다(재검증 확인). 문구·필드는 Paper 보드 39 실측 예시 그대로다.
  function fixtureScheduleItems() {
    return [
      {
        id: 'fx-schedule-1', kind: 'schedule', source: 'fixture', status: 'active',
        title: '평일 아침 브리핑', sub: '주중 오전 7:30 · 기존 채팅', trailing: '49분 후',
        detail: {
          description: '매주 평일 아침 브리핑을 생성한다. 이전 성공 실행 이후를 조회하고, 첫 실행이면 지난 3일만 본다.',
          fields: [
            ['실행 위치', '새 캔버스 카드'],
            ['사용 소스', '네이버 뉴스 · DART · 계좌'],
            ['반복', '평일'],
            ['시각', '오전 7:30'],
            ['알림', '중요 업데이트만'],
          ],
        },
      },
      {
        id: 'fx-schedule-2', kind: 'schedule', source: 'fixture', status: 'paused',
        title: '반도체 ETF 리밸런스 점검', sub: '매월 1일 · 새 캔버스 카드', trailing: '6일 후',
        detail: {
          description: '매월 1일 반도체 ETF 구성 비중을 점검하고 리밸런스 필요 여부를 캔버스 카드로 정리한다.',
          fields: [
            ['실행 위치', '새 캔버스 카드'],
            ['반복', '매월 1일'],
            ['시각', '오전 9:00'],
          ],
        },
      },
    ];
  }

  // GET /api/v1/routines 실데이터 → 리스트 항목. status가 active/paused인
  // 것만 다룬다 — draft는 별도 kind('draft', 아래)로 다룬다.
  function toWatchItem(routine) {
    return {
      id: routine.id, kind: 'watch', source: 'live', status: routine.status, mode: routine.mode,
      title: routine.note || routine.symbol || routine.id,
      sub: routine.mode === 'realtime-ws' ? '실시간 감시' : '주기 확인',
      trailing: routine.mode === 'realtime-ws' ? '실시간' : '',
      raw: routine,
    };
  }

  // 초안(draft, 8단계) — 채팅의 "작업 요약·초안" 카드가 만드는 것과 같은
  // 실데이터다(위 머리말 참고). "채팅에서 만드는 중"이라는 출처만 알려줄 뿐
  // 지어낸 일정 문구를 붙이지 않는다(P3 — Paper 목업의 "매매일 15:40"류는
  // 예약 트리거 전용 예시라 실제 draft 필드에 대응이 없다).
  function toDraftItem(routine) {
    return {
      id: routine.id, kind: 'draft', source: 'live', status: 'draft', mode: routine.mode,
      title: routine.note || routine.symbol || routine.id,
      sub: '초안 — 채팅에서 만드는 중',
      trailing: '지금',
      raw: routine,
    };
  }

  function allItems() {
    const watchItems = routinesCache
      .filter((r) => r.status === 'active' || r.status === 'paused')
      .map(toWatchItem);
    const draftItems = routinesCache.filter((r) => r.status === 'draft').map(toDraftItem);
    return watchItems.concat(draftItems).concat(fixtureScheduleItems());
  }

  function matchesTab(item) {
    if (activeTab === 'active') return item.status === 'active';
    if (activeTab === 'paused') return item.status === 'paused';
    return true; // 'all'
  }

  function matchesSearch(item) {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return `${item.title} ${item.sub || ''}`.toLowerCase().includes(q);
  }

  function visibleItems() {
    return allItems().filter((item) => matchesTab(item) && matchesSearch(item));
  }

  function makeListRow(item) {
    let cls = 'agent-row';
    if (item.id === selectedId) cls += ' is-selected';
    if (item.status === 'draft') cls += ' is-draft'; // ◌ 점선 핑크(8단계, Paper 보드 43)
    const row = el('button', cls);
    row.type = 'button';
    row.setAttribute('data-source', item.source);
    const icon = statusRowIcon(item);
    const dot = el('span', 'agent-row-dot');
    dot.textContent = icon.glyph;
    dot.style.color = `var(${icon.colorVar})`;
    row.appendChild(dot);
    const textWrap = el('span', 'agent-row-text');
    const rowTitle = el('span', 'agent-row-title');
    rowTitle.textContent = item.title;
    textWrap.appendChild(rowTitle);
    if (item.sub) {
      const rowSub = el('span', 'agent-row-sub');
      rowSub.textContent = item.sub;
      textWrap.appendChild(rowSub);
    }
    row.appendChild(textWrap);
    if (item.trailing) {
      const trailing = el('span', 'agent-row-trailing');
      trailing.textContent = item.trailing;
      row.appendChild(trailing);
    }
    row.addEventListener('click', () => selectRow(item.id));
    return row;
  }

  function formatDateTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  // watch는 백엔드가 실제로 주는 필드만 쓴다(P3 — 지어내지 않는다).
  function detailFieldsFor(item) {
    if (item.kind === 'schedule') return (item.detail && item.detail.fields) || [];
    const r = item.raw;
    const fields = [['소스', r.source_label || '—'], ['쿨다운', `${r.cooldown_s}초`]];
    if (r.expires_at) fields.push(['만료', formatDateTime(r.expires_at)]);
    if (r.created_at) fields.push(['생성', formatDateTime(r.created_at)]);
    return fields;
  }

  // ledger API 라이브 연결은 10단계 몫 — 이 단계는 감시/예약 어느 쪽이든
  // fixture 로그다(Paper 보드 39 실측 예시).
  function fixtureLogs() {
    return [
      { time: '오늘 07:30', ok: true, text: '브리핑 카드 생성 — 캔버스 2' },
      { time: '어제 07:30', ok: true, text: '긴급 항목 없음' },
      { time: '금 07:30', ok: false, text: 'DART 응답 지연 — 소스 2개로 실행' },
    ];
  }

  function renderDetail() {
    while (detailCol.firstChild) detailCol.removeChild(detailCol.firstChild);
    const item = allItems().find((i) => i.id === selectedId);
    if (!item) {
      const empty = el('div', 'agent-detail-empty');
      empty.textContent = '선택된 항목이 없습니다';
      detailCol.appendChild(empty);
      return;
    }

    const caption = el('div', 'agent-panel-caption');
    caption.textContent = '상세';
    detailCol.appendChild(caption);

    const headRow = el('div', 'agent-detail-head');
    const badge = el('span', `agent-status-badge is-${item.status}`);
    badge.textContent = item.status === 'paused' ? '일시중지' : (item.status === 'draft' ? '초안' : '활성');
    headRow.appendChild(badge);
    const titleEl = el('span', 'agent-detail-title');
    titleEl.textContent = item.title;
    headRow.appendChild(titleEl);
    if (item.kind !== 'draft') {
      // draft는 읽기 전용이다(동선 규칙③ "확정은 채팅 카드의 칩" — 위 머리말 참고).
      const headActions = el('span', 'agent-detail-head-actions');
      const pauseBtn = el('button', 'agent-pause-btn');
      pauseBtn.type = 'button';
      if (item.kind === 'watch') {
        // 감시(watch, live)만 pause/resume 엔드포인트가 있다 — 위 머리말 참고.
        const willPause = item.status !== 'paused';
        pauseBtn.textContent = willPause ? '❚❚ 일시중지' : '▶ 재개';
        pauseBtn.disabled = false;
        pauseBtn.addEventListener('click', async () => {
          pauseBtn.disabled = true;
          const action = willPause ? pauseRoutine : resumeRoutine;
          try {
            if (typeof action === 'function') await action(item.id);
          } catch {
            // 실패해도 조용히 넘어간다 — 아래 refresh()가 실제 상태를 다시 받아와
            // 반영한다(낙관적 갱신 없음, P3 — 성공한 척하지 않는다).
          }
          await refresh();
        });
      } else {
        // 예약(schedule)은 fixture라 대응하는 백엔드 전이가 없다 — 항상 비활성.
        pauseBtn.textContent = '❚❚ 일시중지';
        pauseBtn.disabled = true;
        pauseBtn.title = '예약 트리거는 아직 백엔드에 없습니다';
      }
      headActions.appendChild(pauseBtn);
      headRow.appendChild(headActions);
    }
    detailCol.appendChild(headRow);

    const desc = el('div', 'agent-detail-desc');
    if (item.kind === 'draft') {
      desc.textContent = '오른쪽 채팅의 "작업 요약·초안" 카드에서 바로 활성화하거나 고칠 수 있습니다.';
    } else {
      desc.textContent = item.kind === 'watch' ? (item.raw.note || '') : ((item.detail && item.detail.description) || '');
    }
    detailCol.appendChild(desc);

    const fieldsCaption = el('div', 'agent-panel-caption');
    fieldsCaption.textContent = '세부 정보';
    detailCol.appendChild(fieldsCaption);
    const fieldsWrap = el('div', 'agent-detail-fields');
    fieldsWrap.setAttribute('data-source', item.source);
    for (const [label, value] of detailFieldsFor(item)) {
      const fieldRow = el('div', 'agent-detail-field');
      const l = el('span', 'agent-detail-field-label');
      l.textContent = label;
      const v = el('span', 'agent-detail-field-value');
      v.textContent = value;
      fieldRow.appendChild(l);
      fieldRow.appendChild(v);
      fieldsWrap.appendChild(fieldRow);
    }
    detailCol.appendChild(fieldsWrap);

    // draft는 아직 한 번도 실행되지 않았다 — "최근 실행" 섹션 자체를 생략한다
    // (빈 로그를 지어내 보여주지 않는다, P3).
    if (item.kind !== 'draft') {
      const logsCaptionRow = el('div', 'agent-panel-caption-row');
      const logsCaption = el('span', 'agent-panel-caption');
      logsCaption.textContent = '최근 실행';
      logsCaptionRow.appendChild(logsCaption);
      // 드릴인(10단계)은 감시(watch)만 연다 — schedule은 실제 라우틴이 아니라
      // ledger에 대응 행이 있을 수 없다(위 머리말).
      if (item.kind === 'watch') {
        const openHistoryBtn = el('button', 'agent-history-open');
        openHistoryBtn.type = 'button';
        openHistoryBtn.textContent = '전체 이력 보기 →';
        openHistoryBtn.addEventListener('click', () => openHistory(item));
        logsCaptionRow.appendChild(openHistoryBtn);
      }
      detailCol.appendChild(logsCaptionRow);
      const logsWrap = el('div', 'agent-detail-logs');
      logsWrap.setAttribute('data-source', 'fixture');
      for (const log of fixtureLogs()) {
        const logRow = el('div', 'agent-detail-log');
        const t = el('span', 'agent-detail-log-time');
        t.textContent = log.time;
        const mark = el('span', log.ok ? 'agent-detail-log-mark is-ok' : 'agent-detail-log-mark is-warn');
        mark.textContent = log.ok ? '✓' : '⚠';
        const text = el('span', 'agent-detail-log-text');
        text.textContent = log.text;
        logRow.appendChild(t);
        logRow.appendChild(mark);
        logRow.appendChild(text);
        logsWrap.appendChild(logRow);
      }
      detailCol.appendChild(logsWrap);
    }
  }

  function selectRow(id) {
    userSelected = true;
    if (id === selectedId) return;
    selectedId = id;
    renderPanels();
  }

  function renderPanels() {
    const items = visibleItems();
    if (!userSelected || !items.find((i) => i.id === selectedId)) {
      selectedId = items.length ? items[0].id : null;
    }
    while (watchList.firstChild) watchList.removeChild(watchList.firstChild);
    if (!items.length) {
      const empty = el('div', 'agent-list-empty');
      empty.textContent = '조건에 맞는 작업이 없습니다';
      watchList.appendChild(empty);
    } else {
      for (const item of items) watchList.appendChild(makeListRow(item));
    }
    renderDetail();
  }

  function updateSubtitle() {
    const activeCount = routinesCache.filter((r) => r.status === 'active').length;
    subtitle.textContent = `루틴 ${routinesCache.length} · 감시 ${activeCount} 진행 중`;
  }

  function setActiveTab(key) {
    if (!tabButtons[key] || key === activeTab) return;
    activeTab = key;
    for (const k of Object.keys(tabButtons)) {
      tabButtons[k].className = k === activeTab ? 'agent-tab is-active' : 'agent-tab';
    }
    renderPanels();
  }

  // 뷰 탭 3종(9단계) — "작업"은 39번 화면(통계+리스트/상세), "알람"·"라이브"는
  // 40번 화면(알람 피드+라이브 관제, 위 머리말 참고 — Paper가 하나로 그려서
  // 둘이 같은 내용을 공유한다).
  function setActiveView(key) {
    if (!viewTabButtons[key] || key === activeView) return;
    activeView = key;
    for (const k of Object.keys(viewTabButtons)) {
      viewTabButtons[k].className = k === activeView ? 'agent-view-tab is-active' : 'agent-view-tab';
    }
    const isTasks = activeView === 'tasks';
    const isAlarmLive = activeView === 'alerts' || activeView === 'live';
    const isProactive = activeView === 'proactive';
    tasksHead.hidden = !isTasks;
    stats.hidden = !isTasks;
    body.hidden = !isTasks;
    markAllReadBtn.hidden = !isAlarmLive;
    alarmLiveBody.hidden = !isAlarmLive;
    proactiveBody.hidden = !isProactive;
    graphLinkBtn.hidden = !isProactive;
    if (isAlarmLive) { renderAlarmColumn(); renderWsStatus(); }
    if (isProactive) renderProactiveView();
  }

  function mount() {
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(head);
    container.appendChild(tasksHead);
    container.appendChild(stats);
    container.appendChild(body);
    container.appendChild(alarmLiveBody);
    container.appendChild(historyBody);
    container.appendChild(proactiveBody);
    renderStats();
    updateSubtitle();
    renderPanels();
    renderAlarmColumn(); // 배지 라벨(알람 N)은 뷰와 무관하게 항상 최신이어야 한다.
    renderWsStatus();
    renderProactiveView(); // 배지 라벨(제안 N)도 마찬가지 — 위와 같은 이유.
  }

  // GET /api/v1/routines 실데이터 — requestId로 낡은 응답을 버린다(sidebar.js
  // loadAgentRoutines()와 같은 이유·같은 패턴, 실사용 결함 재현으로 확인됨).
  async function refreshRoutines() {
    const rid = ++requestId;
    let rows = [];
    try {
      rows = (typeof fetchRoutines === 'function') ? await fetchRoutines() : [];
      if (!Array.isArray(rows)) rows = [];
    } catch {
      rows = [];
    }
    if (rid !== requestId) return;
    routinesCache = rows;
    updateSubtitle();
    renderPanels();
  }

  // 네 소스는 서로 무관한 왕복이다 — 하나가 느려도(또는 실패해도) 다른 쪽을
  // 막지 않는다(Promise.all로 병렬, 실패는 각자의 try/catch가 이미 삼킨다).
  // 알람·WS 상태는 IPC 왕복이 없어(세션 메모리·캐시값) 동기로 같이 갱신한다.
  async function refresh() {
    renderAlarmColumn();
    renderWsStatus();
    const tasks = [refreshRoutines(), refreshSuggestions()];
    if (historyItem) tasks.push(refreshHistoryRuns()); // 드릴인 중이면 이력도 같이.
    await Promise.all(tasks);
  }

  return { mount, refresh, setActiveTab, selectRow, setActiveView, updateWsStatus: renderWsStatus };
}

const __exports = { createAgentCanvas };

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.AgentCanvas = __exports;
}

})();
