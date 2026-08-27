// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 에이전트모드 캔버스(Paper 보드 39) — #agentCanvas 컨테이너를 완전히 소유하고
// 헤더·탭·통계 카드·리스트+상세를 전부 이 파일이 그린다. shell.html은 빈
// 컨테이너 하나만 갖는다(graph-mode의 graphSummaryTable/gridEmpty와 같은 자리 —
// 그리기는 JS가 전담, innerHTML 미사용). 7/9/10/11단계가 이 파일을 계속
// 확장한다(성향 제안, 알람 센터 등) — shell.html은 4단계 이후로 다시 손대지
// 않는다.
//
// 통계 카드 4장 중 "다음 실행"·"오늘 발화"·"성향 제안"은 3단계(F1-FE)부터
// 라이브다 — 앞 둘은 schedule.daily 백엔드(2단계)의 next_fire_at/fired_today,
// 성향 제안은 749행 suggestionsCache 계산(7단계와 동일 원천)을 재사용한다.
// "진행 중"만 fixture로 남는다(값을 뒷받침할 진행률 스트림이 없다, 재검증
// 확인). source 필드는 기존 canvasSource 컨벤션(chat.js)과 동형이다 —
// 지어낸 숫자가 아니라 "라이브로 잰 값인지"를 코드 차원에 남긴다(P3). DOM에도
// data-source 속성으로 새겨 둔다.
//
// 리스트("예약·감시")는 세 출처를 한 화면에 섞는다:
//   · 감시(watch) — GET /api/v1/routines 실데이터. status가 active/paused고
//     mode가 'scheduled'가 아닌 것(3단계부터 — 예약은 아래 schedule로 간다).
//   · 초안(draft, 8단계 추가) — status가 draft인 것(mode 무관). ◌ 점선 핑크
//     행으로 구분한다(Paper 보드 43 실측). draft→confirm 자체는 채팅의
//     "작업 요약·초안" 카드 칩("바로 활성화")이 처리한다 — 여기서 새로
//     만들지 않는다(재사용, 동선 규칙③ "확정은 채팅 카드의 칩 — 캔버스는
//     결과가 비치는 곳"). 그래서 상세 패널은 draft 항목에서 읽기 전용이다
//     (액션 버튼 없음).
//   · 예약(schedule) — 3단계부터 GET /api/v1/routines 실데이터(mode가
//     'scheduled'인 것). schedule.daily 벽시계 트리거가 2단계에서 백엔드에
//     생겼다 — 더 이상 fixture가 아니다.
// 탭(모두/활성/일시중지)·검색은 세 출처 모두에 동일하게 적용된다(화면
// 하나이므로 필터도 하나). "일시중지" 탭 외의 필터는 draft/watch/schedule을
// 가리지 않는다 — 'all' 탭에서 draft가 함께 보인다.
//
// 일시중지·재개 버튼은 여전히 감시(watch, live) 항목에서만 활성이다(6.5단계
// — 6단계 pause/resume 엔드포인트를 이 화면에 배선). 예약(schedule) 항목은
// 백엔드가 이제 같은 전이를 지원하지만(store.transition은 mode를 안 가린다),
// 이 화면에 그 배선을 잇는 건 F1 최소선(3단계) 스코프 밖이라 항상 비활성으로
// 남겨둔다(P5 — 스코프 규율, 다음 스코프로 이연). 상세 패널의 "최근 실행"
// 로그는 여전히 fixture다(ledger API 라이브 연결은 10단계 몫 — 예약도 watch와
// 마찬가지로 이 화면에선 아직 라이브 붙이지 않는다).
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
// verdict가 없어 만들지 않는다(AC10). 통계 3타일("평균"(5단계)·"발화→열람"·
// "이어진 대화", F-stage5b-FE)은 전부 라이브다 — 지표 정의가 끝내 확정되지
// 않은 타일 1개는 3차 라운드(R2)에서 제거됐다(agent-mode-round3-plan.md
// 1단계). "오늘 07:30 산출물" 카드는 ledger 스키마에
// 근거가 없다(컬럼이 식별자·숫자·판정 사유뿐, ledger.py 머리말 참고) — 그래도
// 생략하지 않는다: 사용자 확정 규칙1("Paper에 있는 요소는 전부 구현")의
// 합의된 처리는 fixture+data-source="fixture" 표기이지 생략이 아니다(팀 리드
// 정정, 2026-08-27). 산출물 카드의 버튼 2종("캔버스에서 열기"·"채팅으로")은
// 뒷받침 데이터가 없어 비활성으로 둔다(기능 없는 버튼을 활성으로 두지 않는다, P3).
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
// F-stage9부터 GET /api/v1/nudge-guard 라이브다 — 이 패널 자체엔 여전히
// 값을 바꾸는 버튼이 없다(편집은 채팅 확인 카드로만, 아래 참고, 죽은 버튼
// 금지 원칙은 유지). "그래프 모드에서 근거 보기 →"는
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

// 3단계(사실11⑥) — active 상태를 3분기로 가른다. periodic·scheduled는 같은
// 색(--color-ok)을 쓰지만(39번 리스트는 item.sub/title 텍스트로도 이미
// 구분된다), 구조 자체는 3분기다 — 다음에 색을 분리하고 싶을 때 이진 삼항으로
// 되돌아가지 않도록.
function statusRowIcon(routine) {
  if (routine.status === 'draft') return { glyph: '◌', colorVar: '--color-brand' };
  if (routine.status === 'paused') return { glyph: '❚❚', colorVar: '--color-warn' };
  if (routine.status === 'active') {
    if (routine.mode === 'realtime-ws') return { glyph: '●', colorVar: '--color-info' };
    if (routine.mode === 'scheduled') return { glyph: '●', colorVar: '--color-ok' };
    return { glyph: '●', colorVar: '--color-ok' };
  }
  return { glyph: '○', colorVar: '--color-k-faint' }; // expired/cancelled/failed — 정직하게 흐리게
}

function createAgentCanvas(deps) {
  const {
    container, fetchRoutines, fetchFiredToday, onNewTaskClick, pauseRoutine, resumeRoutine,
    fetchProfileSummary, onAddSuggestion,
    fetchAlerts, markAllAlertsRead, getWsConnected,
    fetchRuns, fetchAvgDuration, fetchEngagement,
    fetchNudgeGuard,
    onOpenGraph,
    onOpenInChat,
  } = deps || {};
  if (!container) return { mount() {}, async refresh() {} };

  let activeTab = 'all';
  let searchQuery = '';
  let routinesCache = [];
  let firedTodayCache = null; // GET /api/v1/routines의 fired_today(3단계) — 독립 왕복.
  let requestId = 0; // stale-응답 가드 — sidebar.js 3단계(loadAgentRoutines)와 같은 이유.
  let suggestionsCache = [];
  let suggestRequestId = 0; // 위와 같은 이유 — 별개 요청이라 별개 가드를 쓴다.
  let activeView = 'tasks';
  let alertsCache = [];
  let historyItem = null; // 드릴인 중인 항목(10단계) — null이면 드릴인이 아니다.
  let heldSuggestionIds = new Set(); // "보류"한 제안(11단계) — 세션 동안만, 저장 안 됨.
  let historyRequestId = 0; // 위와 같은 이유 — 별개 요청이라 별개 가드를 쓴다.
  let avgDurationCache = null; // GET /{id}/runs의 avg_duration_ms(5단계) — 드릴인 대상별로 갱신.
  let engagementCache = null; // GET /{id}/runs의 opened_rate/replied_count(F-stage5b-FE) — 드릴인 대상별로 갱신.
  let nudgeGuardCache = null; // GET /api/v1/nudge-guard(F-stage9) — 라이브.
  let nudgeGuardRequestId = 0; // 위와 같은 이유 — 별개 요청이라 별개 가드를 쓴다.

  // ---------- 통계 카드 4장의 값 계산(3단계부터 3장이 라이브) ----------
  // routinesCache/firedTodayCache/suggestionsCache 클로저가 필요해 createAgentCanvas
  // 안에 둔다(statusRowIcon()처럼 순수 함수가 아니다).

  // "진행 중" 타일만 fixture 값이 남는다(Paper 보드 39 실측 문구 그대로) — 위
  // 머리말 참고, 대응하는 진행률 스트림이 없다.
  function fixtureInProgressStat() {
    return { key: 'in-progress', label: '진행 중', value: '● 시세 수집 — 삼성전자', sub: '감시 조건 2/3 · 12초 전', source: 'fixture' };
  }

  // "다음 실행"(3단계 라이브) — routinesCache의 예약(mode==='scheduled')
  // 스펙 중 active만 보고 next_fire_at(2단계 백엔드, 순수 계산값)이 가장 이른
  // 것을 고른다. 활성 예약이 없으면 지어내지 않고 정직하게 "없음"을 보여준다(P3).
  function nextRunStat() {
    let best = null;
    for (const r of routinesCache) {
      if (r.mode !== 'scheduled' || r.status !== 'active' || !r.next_fire_at) continue;
      const t = Date.parse(r.next_fire_at);
      if (!Number.isFinite(t)) continue;
      if (!best || t < best.t) best = { t, r };
    }
    if (!best) {
      return { key: 'next-run', label: '다음 실행', value: '없음', sub: '활성 예약이 없습니다', source: 'live' };
    }
    const diffMin = Math.max(0, Math.round((best.t - Date.now()) / 60000));
    const relative = diffMin < 60 ? `${diffMin}분 후` : `${Math.floor(diffMin / 60)}시간 ${diffMin % 60}분 후`;
    return {
      key: 'next-run', label: '다음 실행',
      value: `${formatAlarmTime(best.t)} ${best.r.note || best.r.symbol || best.r.id}`,
      sub: `${relative} · 예약 실행`, source: 'live',
    };
  }

  // "오늘 발화"(3단계 라이브) — GET /api/v1/routines 응답의 fired_today(2단계,
  // ledger 단일 스캔 집계)를 그대로 쓴다. fetchFiredToday가 없거나 실패하면
  // firedTodayCache가 null로 남아 "—"로 정직하게 표시한다(지어낸 숫자 없음).
  function firedTodayStat() {
    if (firedTodayCache == null) {
      return { key: 'fired-today', label: '오늘 발화', value: '—', sub: '', source: 'live' };
    }
    return { key: 'fired-today', label: '오늘 발화', value: `${firedTodayCache}건`, sub: 'KST 기준', source: 'live' };
  }

  // "보류"하지 않은 성향 제안 수 — updateProactiveTabLabel()과 같은 계산을
  // 공유한다(재검증 사실5, "두 개의 진실" 방지 — 위 머리말).
  function visibleSuggestionCount() {
    return suggestionsCache.filter((e) => !heldSuggestionIds.has(e.entity_id)).length;
  }

  // "성향 제안"(3단계 라이브) — 7단계와 같은 원천(suggestionsCache)을 그대로
  // 재사용한다. 그래프 "신호 개수" 같은 지어낸 통계는 붙이지 않는다(P3 — 실제로
  // 아는 값은 "몇 건 대기 중인가"뿐이다).
  function suggestionsStat() {
    const n = visibleSuggestionCount();
    return {
      key: 'suggestions', label: '성향 제안',
      value: n > 0 ? `${n}건 대기` : '없음',
      sub: n > 0 ? '그래프 성향 기반' : '',
      source: 'live', accent: true,
    };
  }

  function buildStats() {
    return [nextRunStat(), fixtureInProgressStat(), firedTodayStat(), suggestionsStat()];
  }

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
    for (const stat of buildStats()) {
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
    renderStats(); // 3단계 — "성향 제안" 통계 타일도 같은 캐시를 쓴다(위와 같은 이유).
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

  // GET /api/v1/nudge-guard 실데이터(F-stage9, 8단계 백엔드) — 다른 세 소스와
  // 무관한 독립 왕복이다(위 머리말 원칙).
  async function refreshNudgeGuard() {
    const rid = ++nudgeGuardRequestId;
    let settings = null;
    try {
      settings = (typeof fetchNudgeGuard === 'function') ? await fetchNudgeGuard() : null;
    } catch {
      settings = null;
    }
    if (rid !== nudgeGuardRequestId) return;
    nudgeGuardCache = settings;
    renderNudgeGuard();
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

  // "평균"(5단계 라이브) — 4단계 GET /{id}/runs의 avg_duration_ms를 그대로
  // 쓴다. 아직 못 물어봤거나(초기 상태) 최근 30건에 duration_ms가 있는 행이
  // 하나도 없으면(구 jsonl 혼재) 지어낸 숫자 없이 "—"로 정직하게 표시한다(P3).
  function avgDurationTile() {
    if (avgDurationCache == null) return { key: 'avg', label: '평균', value: '—', source: 'live' };
    return { key: 'avg', label: '평균', value: `${(avgDurationCache / 1000).toFixed(1)}s`, source: 'live' };
  }

  // "발화→열람"(F-stage5b-FE 라이브) — GET /{id}/runs의 opened_rate(0~1,
  // 최근 30건 fired 기준 근사치, engagement.py 참고)를 %로 보여준다. null이면
  // (아직 못 물어봤거나 최근 fired가 0건이라 분모가 없으면) "—"로 정직하게 둔다.
  function openedRateTile() {
    if (!engagementCache || engagementCache.openedRate == null) {
      return { key: 'opened-rate', label: '발화→열람', value: '—', source: 'live' };
    }
    return { key: 'opened-rate', label: '발화→열람', value: `${Math.round(engagementCache.openedRate * 100)}%`, source: 'live' };
  }

  // "이어진 대화"(F-stage5b-FE 라이브) — GET /{id}/runs의 replied_count(최근
  // 30건 engagement 로그 기준, engagement.py 참고) 그대로.
  function repliedCountTile() {
    if (!engagementCache || engagementCache.repliedCount == null) {
      return { key: 'continued', label: '이어진 대화', value: '—', source: 'live' };
    }
    return { key: 'continued', label: '이어진 대화', value: `${engagementCache.repliedCount}건`, source: 'live' };
  }

  // 통계 3타일(평균·발화→열람·이어진 대화)은 F-stage5·5b-FE를 거쳐 전부
  // 라이브다 — 지표 정의가 끝내 확정되지 않은 타일 1개는 3차 라운드(R2)에서
  // 제거됐다(agent-mode-round3-plan.md 1단계, Paper 우선 역방향 적용).
  function buildHistoryStats() {
    return [
      avgDurationTile(),
      openedRateTile(),
      repliedCountTile(),
    ];
  }

  // "오늘 07:30 산출물" 카드(fixture) — Paper 41번 우측 상단, 정정 반영(사용자
  // 확정 규칙1: 디자인에 있는 요소는 생략이 아니라 fixture+data-source 표기로
  // 구현한다). 버튼 2종은 뒷받침 데이터(캔버스 카드 재조회·채팅 이동 경로)가
  // 없어 비활성 — 기능 없는 버튼을 활성으로 두지 않는다(P3).
  function fixtureTodayOutput() {
    return {
      title: '# 아침 브리핑 — 8/26 화',
      tag: '캔버스 카드',
      items: [
        { text: '1. 삼성전자 88,000 돌파 — 감시 조건 도달', sub: '권장: 감시 유지 · 89,000 재설정 검토' },
        { text: '2. 반도체 공급망 뉴스 — 참고' },
        { text: '3. 배당 바스켓 응집 0.58 → 0.61' },
      ],
    };
  }

  // 5단계부터 "평균"만 live고 나머지 셋은 fixture로 남아 컬럼 전체를 한
  // data-source로 표기할 수 없다(P3) — 산출물 카드·통계 타일 각각에 표기한다
  // (아래, historyOutputCard·agent-history-stat-tile 개별 attribute).
  const historyStatsCol = el('div', 'agent-history-stats-col');

  const historyOutputCaption = el('div', 'agent-panel-caption');
  historyOutputCaption.textContent = '오늘 07:30 산출물';
  historyStatsCol.appendChild(historyOutputCaption);
  const historyOutputCard = el('div', 'agent-history-output-card');
  historyOutputCard.setAttribute('data-source', 'fixture');
  const output = fixtureTodayOutput();
  const outputHead = el('div', 'agent-history-output-head');
  const outputTitle = el('span', 'agent-history-output-title');
  outputTitle.textContent = output.title;
  outputHead.appendChild(outputTitle);
  const outputTag = el('span', 'agent-history-output-tag');
  outputTag.textContent = output.tag;
  outputHead.appendChild(outputTag);
  historyOutputCard.appendChild(outputHead);
  for (const item of output.items) {
    const row = el('div', 'agent-history-output-item');
    const text = el('div', 'agent-history-output-item-text');
    text.textContent = item.text;
    row.appendChild(text);
    if (item.sub) {
      const sub = el('div', 'agent-history-output-item-sub');
      sub.textContent = item.sub;
      row.appendChild(sub);
    }
    historyOutputCard.appendChild(row);
  }
  const outputActions = el('div', 'agent-history-output-actions');
  for (const label of ['캔버스에서 열기', '채팅으로']) {
    const btn = el('button', 'agent-history-output-btn');
    btn.type = 'button';
    btn.textContent = label;
    btn.disabled = true;
    btn.title = '뒷받침 데이터가 없어 아직 지원하지 않습니다';
    outputActions.appendChild(btn);
  }
  historyOutputCard.appendChild(outputActions);
  historyStatsCol.appendChild(historyOutputCard);

  const historyStatsCaption = el('div', 'agent-panel-caption');
  historyStatsCaption.textContent = '30회 통계';
  historyStatsCol.appendChild(historyStatsCaption);
  const historyStatsGrid = el('div', 'agent-history-stats-grid');
  historyStatsCol.appendChild(historyStatsGrid);
  historyBody.appendChild(historyStatsCol);

  // avgDurationCache가 드릴인 대상마다 바뀌므로(5단계) 최초 1회 구성이 아니라
  // refreshHistoryRuns() 완료 시마다 다시 그린다.
  function renderHistoryStats() {
    while (historyStatsGrid.firstChild) historyStatsGrid.removeChild(historyStatsGrid.firstChild);
    for (const tile of buildHistoryStats()) {
      const t = el('div', 'agent-history-stat-tile');
      t.setAttribute('data-source', tile.source);
      const l = el('div', 'agent-history-stat-label');
      l.textContent = tile.label;
      t.appendChild(l);
      const v = el('div', 'agent-history-stat-value');
      v.textContent = tile.value;
      t.appendChild(v);
      historyStatsGrid.appendChild(t);
    }
  }
  renderHistoryStats(); // 초기 페인트 — 드릴인 열기 전엔 "평균"이 "—"로 보인다.

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
  // 버린다(routine 목록·제안과 같은 이유·같은 패턴). fetchAvgDuration(5단계)·
  // fetchEngagement(F-stage5b-FE)는 같은 엔드포인트의 다른 필드(avg_duration_ms·
  // opened_rate·replied_count)를 노린 별개 왕복이다 — fetchFiredToday와 같은
  // 이유(agent-canvas.js 머리말 "네 소스는 서로 무관한 왕복이다" 원칙 재사용),
  // fetchRuns의 기존 배열 계약을 안 건드리기 위함이다.
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
    let avgDuration = null;
    try {
      const v = (typeof fetchAvgDuration === 'function') ? await fetchAvgDuration(id) : null;
      avgDuration = (typeof v === 'number') ? v : null;
    } catch {
      avgDuration = null;
    }
    let engagement = null;
    try {
      const v = (typeof fetchEngagement === 'function') ? await fetchEngagement(id) : null;
      engagement = (v && typeof v === 'object') ? v : null;
    } catch {
      engagement = null;
    }
    if (rid !== historyRequestId || !historyItem || historyItem.id !== id) return;
    avgDurationCache = avgDuration;
    engagementCache = engagement;
    renderHistoryStats();
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

  // 말걸기 가드(F-stage9부터 라이브) — GET /api/v1/nudge-guard(8단계)로 4개
  // 태그를 채운다. 편집은 여전히 채팅 경로로만(43 원칙, 아래 가드 확인 카드
  // 참고) — 이 패널 자체엔 값을 바꾸는 버튼을 두지 않는다(죽은 버튼 금지, P3).
  const nudgeGuard = el('div', 'agent-nudge-guard');
  const nudgeGuardCaption = el('div', 'agent-panel-caption');
  nudgeGuardCaption.textContent = '말걸기 가드';
  nudgeGuard.appendChild(nudgeGuardCaption);
  const nudgeGuardTags = el('div', 'agent-nudge-guard-tags');
  nudgeGuard.appendChild(nudgeGuardTags);
  const nudgeGuardNote = el('div', 'agent-nudge-guard-note');
  nudgeGuard.appendChild(nudgeGuardNote);
  proactiveBody.appendChild(nudgeGuard);

  // GuardSettings 4필드 → 패널 태그 4개(guard_settings.py "42번 패널의 기존
  // 4개 태그와 1:1 대응"과 같은 매핑).
  function guardTagLabels(settings) {
    const qh = settings.quiet_hours || {};
    return [
      `하루 최대 ${settings.max_daily_nudges}회`,
      `조용 시간 ${qh.start || '?'}–${qh.end || '?'}`,
      settings.show_rationale ? '근거 표시 항상' : '근거 표시 끔',
      settings.learn_from_dismissals ? '거절 반영 성향으로 학습' : '거절 학습 끔',
    ];
  }

  function renderNudgeGuard() {
    while (nudgeGuardTags.firstChild) nudgeGuardTags.removeChild(nudgeGuardTags.firstChild);
    nudgeGuard.setAttribute('data-source', 'live'); // 8단계부터 라이브 — fixture 폴백 없음(지어내지 않는다, P3).
    if (!nudgeGuardCache) {
      const empty = el('div', 'agent-list-empty');
      empty.textContent = '가드 설정을 불러오는 중입니다';
      nudgeGuardTags.appendChild(empty);
      nudgeGuardNote.textContent = '';
      return;
    }
    for (const label of guardTagLabels(nudgeGuardCache)) {
      const tag = el('span', 'agent-nudge-guard-tag');
      tag.textContent = label;
      nudgeGuardTags.appendChild(tag);
    }
    nudgeGuardNote.textContent = '제안은 그래프 보강 15 이상일 때만 · 거절한 제안은 반복되지 않는다 → 발화 자체는 오른쪽 채팅에 도착';
  }
  renderNudgeGuard(); // 초기 페인트 — 라이브 데이터 도착 전엔 "불러오는 중"으로 정직하게 보인다.

  function updateProactiveTabLabel() {
    const n = visibleSuggestionCount(); // 3단계 — "성향 제안" 통계 타일과 같은 계산 공유.
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
      renderStats(); // 3단계 — "성향 제안" 통계 타일도 heldSuggestionIds를 본다(위와 같은 이유).
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

  // GET /api/v1/routines 실데이터 → 리스트 항목. status가 active/paused인
  // 것만 다룬다 — draft는 별도 kind('draft', 아래)로 다룬다.
  //
  // 전제(Critic 조건부 코멘트, 3단계): 이 함수는 호출자(allItems())가
  // mode !== 'scheduled'로 이미 걸렀다는 전제 위에서 동작한다 — 새 호출부를
  // 추가할 때도 이 전제를 지켜야 한다(그렇지 않으면 예약 항목이 "주기 확인"
  // sub 라벨을 잘못 받는다, 사실11③).
  function toWatchItem(routine) {
    return {
      id: routine.id, kind: 'watch', source: 'live', status: routine.status, mode: routine.mode,
      title: routine.note || routine.symbol || routine.id,
      sub: routine.mode === 'realtime-ws' ? '실시간 감시' : '주기 확인',
      trailing: routine.mode === 'realtime-ws' ? '실시간' : '',
      raw: routine,
    };
  }

  // 예약(schedule, 3단계) — toWatchItem()과 대칭이다. mode==='scheduled'
  // 스펙만 이쪽으로 온다(allItems()의 상보 필터). trailing엔 2단계 백엔드가
  // 계산한 next_fire_at(순수 함수, 저장 안 함)을 쓴다 — 없으면 빈 문자열로
  // 정직하게 남긴다(지어내지 않는다, P3).
  function toScheduleItem(routine) {
    return {
      id: routine.id, kind: 'schedule', source: 'live', status: routine.status, mode: routine.mode,
      title: routine.note || routine.symbol || routine.id,
      sub: '예약 실행',
      trailing: routine.next_fire_at ? formatAlarmTime(Date.parse(routine.next_fire_at)) : '',
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

  // 3단계(사실11③) — watchItems 필터에 mode !== 'scheduled'를 추가해 예약을
  // 걷어낸다. scheduleItems가 그 상보 집합을 가져간다 — 같은 라우틴이 감시·
  // 예약 리스트 양쪽에 중복 노출되는 걸 구조적으로 막는다(toWatchItem 자체는
  // 무수정, 위 전제 주석 참고).
  function allItems() {
    const watchItems = routinesCache
      .filter((r) => (r.status === 'active' || r.status === 'paused') && r.mode !== 'scheduled')
      .map(toWatchItem);
    const draftItems = routinesCache.filter((r) => r.status === 'draft').map(toDraftItem);
    const scheduleItems = routinesCache
      .filter((r) => (r.status === 'active' || r.status === 'paused') && r.mode === 'scheduled')
      .map(toScheduleItem);
    return watchItems.concat(draftItems).concat(scheduleItems);
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

  // watch·schedule 둘 다 백엔드가 실제로 주는 필드만 쓴다(P3 — 지어내지
  // 않는다) — 3단계부터 schedule도 raw가 live 라우틴이라 같은 필드 조합을
  // 쓴다. schedule만 "다음 실행"(next_fire_at, 2단계 순수 계산값)이 추가로 붙는다.
  function detailFieldsFor(item) {
    const r = item.raw;
    const fields = [['소스', r.source_label || '—'], ['쿨다운', `${r.cooldown_s}초`]];
    if (item.kind === 'schedule' && r.next_fire_at) fields.push(['다음 실행', formatDateTime(r.next_fire_at)]);
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
        // 예약(schedule)은 백엔드가 이제 같은 pause/resume 전이를 지원하지만
        // (store.transition은 mode를 안 가린다), 이 화면에 그 배선을 잇는 건
        // F1 최소선(3단계) 스코프 밖이다 — 항상 비활성으로 남겨둔다(P5, 다음
        // 스코프로 이연. "백엔드에 없다"는 옛 사유는 더 이상 사실이 아니다).
        pauseBtn.textContent = '❚❚ 일시중지';
        pauseBtn.disabled = true;
        pauseBtn.title = '예약 항목의 일시중지 제어는 이번 스코프 밖입니다';
      }
      headActions.appendChild(pauseBtn);
      headRow.appendChild(headActions);
    }
    detailCol.appendChild(headRow);

    const desc = el('div', 'agent-detail-desc');
    if (item.kind === 'draft') {
      desc.textContent = '오른쪽 채팅의 "작업 요약·초안" 카드에서 바로 활성화하거나 고칠 수 있습니다.';
    } else {
      // watch·schedule 둘 다 3단계부터 raw가 live 라우틴이다 — 지어낸 설명문
      // 없이 실제 note만 쓴다(P3).
      desc.textContent = item.raw.note || '';
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
      // 드릴인(10단계)은 감시(watch)만 연다 — schedule도 3단계부터 실제
      // 라우틴이라 ledger에 대응 행이 생길 수 있지만, 이 화면에 그 배선을
      // 잇는 건 F1 최소선 스코프 밖이다(위 머리말, P5 — 다음 스코프로 이연).
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

      // F-fix1(본편 이월 갭, Paper 39번 실측 AAG-0) — "채팅에서 열기 ↗".
      // watch·schedule 둘 다 대상이다(둘 다 능동 턴을 만들 수 있다, 3단계) —
      // draft만 위 가드로 이미 제외돼 있다. sidebar.js가 소유한 알림 방이
      // 있으면 selectNotifyRoom과 완전히 같은 경로(ack·opened 계측 자동
      // 정합, window.AthenaNotify.selectRoom 다리)를 타고, 없으면(이 세션에서
      // 아직 안 뜬 발화) 채팅 입력 포커스로 폴백한다 — 죽은 버튼을 만들지
      // 않는다(P3).
      const openInChatRow = el('div', 'agent-detail-open-chat');
      const openInChatCaption = el('span', 'agent-detail-open-chat-caption');
      openInChatCaption.textContent = '루틴 발화 — 묻지 않은 턴입니다';
      openInChatRow.appendChild(openInChatCaption);
      const openInChatBtn = el('button', 'agent-detail-open-chat-btn');
      openInChatBtn.type = 'button';
      openInChatBtn.textContent = '채팅에서 열기 ↗';
      openInChatBtn.addEventListener('click', () => {
        if (typeof onOpenInChat === 'function') onOpenInChat(item.id);
      });
      openInChatRow.appendChild(openInChatBtn);
      detailCol.appendChild(openInChatRow);
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
  // fetchFiredToday(3단계)는 같은 응답의 다른 필드(fired_today, 라우틴별이
  // 아닌 전체 집계)를 노린 별개 왕복이다 — "네 소스는 서로 무관한 왕복이다"
  // 원칙(위 머리말)을 그대로 따른다, 실패해도 routinesCache 갱신을 막지 않는다.
  async function refreshRoutines() {
    const rid = ++requestId;
    let rows = [];
    try {
      rows = (typeof fetchRoutines === 'function') ? await fetchRoutines() : [];
      if (!Array.isArray(rows)) rows = [];
    } catch {
      rows = [];
    }
    let firedToday = null;
    try {
      const v = (typeof fetchFiredToday === 'function') ? await fetchFiredToday() : null;
      firedToday = (typeof v === 'number') ? v : null;
    } catch {
      firedToday = null;
    }
    if (rid !== requestId) return;
    routinesCache = rows;
    firedTodayCache = firedToday;
    updateSubtitle();
    renderStats();
    renderPanels();
  }

  // 네 소스는 서로 무관한 왕복이다 — 하나가 느려도(또는 실패해도) 다른 쪽을
  // 막지 않는다(Promise.all로 병렬, 실패는 각자의 try/catch가 이미 삼킨다).
  // 알람·WS 상태는 IPC 왕복이 없어(세션 메모리·캐시값) 동기로 같이 갱신한다.
  async function refresh() {
    renderAlarmColumn();
    renderWsStatus();
    const tasks = [refreshRoutines(), refreshSuggestions(), refreshNudgeGuard()];
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
