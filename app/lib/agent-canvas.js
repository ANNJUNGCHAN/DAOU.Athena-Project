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

const TABS = [
  { key: 'all', label: '모두' },
  { key: 'active', label: '활성' },
  { key: 'paused', label: '일시중지' },
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
  } = deps || {};
  if (!container) return { mount() {}, async refresh() {} };

  let activeTab = 'all';
  let searchQuery = '';
  let routinesCache = [];
  let requestId = 0; // stale-응답 가드 — sidebar.js 3단계(loadAgentRoutines)와 같은 이유.
  let suggestionsCache = [];
  let suggestRequestId = 0; // 위와 같은 이유 — 별개 요청이라 별개 가드를 쓴다.

  // ---------- 헤더 ----------
  const head = el('div', 'agent-head');
  const title = el('div', 'agent-title');
  title.textContent = '에이전트';
  head.appendChild(title);

  const subtitle = el('div', 'agent-subtitle');
  head.appendChild(subtitle);

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
  head.appendChild(tabsWrap);

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
  head.appendChild(actions);

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
      const logsCaption = el('div', 'agent-panel-caption');
      logsCaption.textContent = '최근 실행';
      detailCol.appendChild(logsCaption);
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

  function mount() {
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(head);
    container.appendChild(stats);
    container.appendChild(body);
    renderStats();
    updateSubtitle();
    renderPanels();
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

  // 두 소스는 서로 무관한 왕복이다 — 하나가 느려도(또는 실패해도) 다른 쪽을
  // 막지 않는다(Promise.all로 병렬, 실패는 각자의 try/catch가 이미 삼킨다).
  async function refresh() {
    await Promise.all([refreshRoutines(), refreshSuggestions()]);
  }

  return { mount, refresh, setActiveTab, selectRow };
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
