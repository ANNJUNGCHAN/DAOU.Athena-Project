// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 에이전트모드 캔버스(Paper 보드 39) — #agentCanvas 컨테이너를 완전히 소유하고
// 헤더·탭·통계 카드·리스트를 전부 이 파일이 그린다. shell.html은 빈 컨테이너
// 하나만 갖는다(graph-mode의 graphSummaryTable/gridEmpty와 같은 자리 — 그리기는
// JS가 전담, innerHTML 미사용). 5/7/9/10/11단계가 이 파일을 계속 확장한다
// (예약·감시 상세 패널, 성향 제안, 알람 센터 등) — shell.html은 이번 단계
// 이후로 다시 손대지 않는다.
//
// 통계 카드 4장 중 "다음 실행"·"오늘 발화"·"성향 제안"은 대응하는 백엔드 집계가
// 없다(재검증 확인, Rev.3 ADR). "진행 중"도 이 단계에선 fixture다(5단계에서
// 라이브 승격 후보). source:'fixture' 필드는 기존 canvasSource 컨벤션(chat.js)과
// 동형이다 — 지어낸 숫자가 아니라 "아직 라이브로 못 잰다"는 사실을 코드 차원에
// 남긴다(P3). DOM에도 data-source 속성으로 새겨 둔다.
//
// 탭(모두/활성/일시중지)은 3단계가 쓰는 것과 같은 GET /api/v1/routines 실데이터를
// 그대로 필터링한다(실데이터, fixture 아님) — "모두"는 draft를 포함해 전부,
// 활성/일시중지는 status로 정확히 거른다(사이드바의 "우선 노출만" 필터와는
// 다른 목적이라 별도로 짠다 — 여기는 "다 보여주고 탭으로 좁히는" 화면이다).

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
  if (routine.status === 'paused') return { glyph: '❚❚', colorVar: '--color-warn' };
  if (routine.status === 'active') {
    return routine.mode === 'realtime-ws'
      ? { glyph: '●', colorVar: '--color-info' }
      : { glyph: '●', colorVar: '--color-ok' };
  }
  return { glyph: '○', colorVar: '--color-k-faint' }; // draft/expired/cancelled/failed — 정직하게 흐리게
}

function createAgentCanvas(deps) {
  const { container, fetchRoutines, onNewTaskClick } = deps || {};
  if (!container) return { mount() {}, async refresh() {} };

  let activeTab = 'all';
  let searchQuery = '';
  let routinesCache = [];
  let requestId = 0; // stale-응답 가드 — sidebar.js 3단계(loadAgentRoutines)와 같은 이유.

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
    renderList();
  });
  searchWrap.appendChild(searchInput);
  actions.appendChild(searchWrap);

  // 43번 "새 작업은 채팅에서" 원칙 — 시트를 열지 않고 채팅 입력에 포커스만
  // 옮긴다(전체 자연어 플로우는 8단계 몫, sidebar.js의 selectRoutineItem과 같은 태도).
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

  // ---------- 본문 — 라우틴 리스트(5단계가 두 열 레이아웃으로 확장한다) ----------
  const body = el('div', 'agent-body');
  const list = el('div', 'agent-list');
  body.appendChild(list);

  function matchesTab(routine) {
    if (activeTab === 'active') return routine.status === 'active';
    if (activeTab === 'paused') return routine.status === 'paused';
    return true; // 'all' — draft 포함 전부(3단계 사이드바의 "우선 노출만"과는 다른 목적)
  }

  function matchesSearch(routine) {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    const haystack = `${routine.note || ''} ${routine.symbol || ''}`.toLowerCase();
    return haystack.includes(q);
  }

  function makeRoutineRow(routine) {
    const row = el('div', 'agent-list-row');
    const icon = statusRowIcon(routine);
    const dot = el('span', 'agent-list-row-dot');
    dot.textContent = icon.glyph;
    dot.style.color = `var(${icon.colorVar})`;
    row.appendChild(dot);
    const rowTitle = el('span', 'agent-list-row-title');
    rowTitle.textContent = routine.note || routine.symbol || routine.id;
    row.appendChild(rowTitle);
    return row;
  }

  function renderList() {
    while (list.firstChild) list.removeChild(list.firstChild);
    const rows = routinesCache.filter((r) => matchesTab(r) && matchesSearch(r));
    if (!rows.length) {
      const empty = el('div', 'agent-list-empty');
      empty.textContent = routinesCache.length ? '조건에 맞는 작업이 없습니다' : '아직 등록된 작업이 없습니다';
      list.appendChild(empty);
      return;
    }
    for (const routine of rows) list.appendChild(makeRoutineRow(routine));
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
    renderList();
  }

  function mount() {
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(head);
    container.appendChild(stats);
    container.appendChild(body);
    renderStats();
    updateSubtitle();
    renderList();
  }

  // GET /api/v1/routines 실데이터 — requestId로 낡은 응답을 버린다(sidebar.js
  // loadAgentRoutines()와 같은 이유·같은 패턴, 실사용 결함 재현으로 확인됨).
  async function refresh() {
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
    renderList();
  }

  return { mount, refresh, setActiveTab };
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
