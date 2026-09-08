// IIFE 스코프 격리(2026-08-18 렌더러 격리) — agent-sidebar-list.js와 같은 패턴.
(function () {
'use strict';

// 사이드바 "대화 이력"의 뷰모델만 만든다 — DOM은 한 줄도 만들지 않는다. 세션 인덱스
// 행 배열을 받아 사이드바가 그대로 그릴 구조(모드 5행 → 프로젝트 → 최근)를 돌려주는
// 순수 함수라 렌더러 없이 node:test로 검증된다. 그리는 몫은 sidebar.js이고, 실행 중
// 표시는 상태 문자열만 내보내 스피너·점 색은 CSS가 정한다(세션 명세 §3-1).

const MODE_ORDER = Object.freeze(['chat', 'graph', 'agent', 'plugin', 'backtest']);

const MODE_LABELS = Object.freeze({
  chat: '아고라 · 대화',
  graph: '메티스 · 그래프',
  agent: '아이기스 · 에이전트',
  plugin: '에르가네 · 플러그인',
  backtest: '팔라스 · 백테스트',
});

// 상태 어휘는 넷뿐이다. 대표 상태를 고를 때 running > waiting > failed > done 순으로
// 앞선다(숫자가 클수록 앞선다).
const RUN_RANK = { running: 4, waiting: 3, failed: 2, done: 1 };

const DEFAULT_RECENT_LIMIT = 6;

// 모르는 mode는 버리지 않고 chat으로 접는다 — 세션이 목록에서 사라지는 편이 더 나쁘다.
function normalizeMode(mode) {
  return MODE_ORDER.indexOf(mode) >= 0 ? mode : 'chat';
}

function normalizeRunState(state) {
  return Object.prototype.hasOwnProperty.call(RUN_RANK, state) ? state : null;
}

// ISO 문자열·epoch 숫자 둘 다 받는다. 읽을 수 없으면 -Infinity라 내림차순에서 맨 뒤로 간다.
function toTime(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : -Infinity;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? -Infinity : parsed;
  }
  return -Infinity;
}

// -Infinity끼리 빼면 NaN이라 정렬이 깨진다 — 비교로만 내림차순을 만든다.
function descend(a, b) {
  if (a === b) return 0;
  return a < b ? 1 : -1;
}

function compareSessions(a, b) {
  const ar = a.runState === 'running' ? 1 : 0;
  const br = b.runState === 'running' ? 1 : 0;
  if (ar !== br) return br - ar;
  return descend(a.updatedAt, b.updatedAt);
}

// 세션 여럿의 runState → 하나의 대표 상태. 하나도 없으면 null.
function summarizeRunState(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  let best = null;
  let bestRank = 0;
  for (const session of list) {
    const state = normalizeRunState(session && session.runState);
    const rank = state ? RUN_RANK[state] : 0;
    if (rank > bestRank) {
      bestRank = rank;
      best = state;
    }
  }
  return best;
}

// 다섯 모드 전부를 키로 가진 개수표. 대화가 없는 모드도 0으로 나온다.
function countByMode(sessions) {
  const counts = {};
  for (const mode of MODE_ORDER) counts[mode] = 0;
  const list = Array.isArray(sessions) ? sessions : [];
  for (const session of list) {
    if (session) counts[normalizeMode(session.mode)] += 1;
  }
  return counts;
}

function toProjectEntry(row) {
  return { id: row.id, title: row.title, mode: row.mode, runState: row.runState, active: row.active };
}

function toRecentEntry(row) {
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    projectId: row.projectId,
    runState: row.runState,
    active: row.active,
  };
}

// 사이드바 이력 전체의 뷰모델. 입력 배열은 복사해서 정렬한다(호출자의 배열을 건드리지 않는다).
function buildHistoryView(input) {
  const opts = (input && typeof input === 'object') ? input : {};
  const activeSessionId = opts.activeSessionId;
  const limit = (Number.isFinite(opts.recentLimit) && opts.recentLimit >= 0)
    ? Math.floor(opts.recentLimit)
    : DEFAULT_RECENT_LIMIT;

  const rows = (Array.isArray(opts.sessions) ? opts.sessions : [])
    .filter((session) => session && typeof session === 'object')
    .filter((session) => (opts.includeArchived ? true : !session.archived))
    .map((session) => ({
      id: session.id,
      title: (typeof session.title === 'string' && session.title) ? session.title : session.id,
      mode: normalizeMode(session.mode),
      projectId: session.projectId != null ? session.projectId : null,
      runState: normalizeRunState(session.runState),
      active: activeSessionId != null && session.id === activeSessionId,
      updatedAt: toTime(session.updatedAt),
    }));

  const counts = countByMode(rows);
  const modes = MODE_ORDER.map((mode) => ({
    mode,
    label: MODE_LABELS[mode],
    count: counts[mode],
    runState: summarizeRunState(rows.filter((row) => row.mode === mode)),
    active: mode === opts.activeMode,
  }));

  // 선언된 프로젝트를 먼저 깔고, 그 목록에 없는 projectId를 만나면 그 자리에서 만든다 —
  // 고아 세션도 프로젝트 하나를 얻는다. projectId가 아예 없는 세션은 담을 프로젝트가
  // 없으니 최근·모드·합계에만 남는다.
  const groups = new Map();
  for (const project of (Array.isArray(opts.projects) ? opts.projects : [])) {
    if (!project || project.id == null) continue;
    groups.set(project.id, {
      id: project.id,
      label: (typeof project.label === 'string' && project.label) ? project.label : String(project.id),
      pinned: !!project.pinned,
      sessions: [],
    });
  }
  for (const row of rows) {
    if (!row.projectId) continue;
    let group = groups.get(row.projectId);
    if (!group) {
      group = { id: row.projectId, label: String(row.projectId), pinned: false, sessions: [] };
      groups.set(row.projectId, group);
    }
    group.sessions.push(row);
  }

  const projects = Array.from(groups.values())
    .map((group) => ({
      group,
      latest: group.sessions.reduce((max, row) => (row.updatedAt > max ? row.updatedAt : max), -Infinity),
    }))
    .sort((a, b) => {
      if (a.group.pinned !== b.group.pinned) return a.group.pinned ? -1 : 1;
      const byTime = descend(a.latest, b.latest);
      if (byTime !== 0) return byTime;
      return String(a.group.label).localeCompare(String(b.group.label));
    })
    .map(({ group }) => ({
      id: group.id,
      label: group.label,
      pinned: group.pinned,
      count: group.sessions.length,
      runState: summarizeRunState(group.sessions),
      sessions: group.sessions.slice().sort(compareSessions).map(toProjectEntry),
    }));

  const recent = rows.slice()
    .sort((a, b) => descend(a.updatedAt, b.updatedAt))
    .slice(0, limit)
    .map(toRecentEntry);

  return {
    modes,
    projects,
    recent,
    totals: {
      sessions: rows.length,
      running: rows.filter((row) => row.runState === 'running').length,
    },
  };
}

const __exports = { MODE_ORDER, MODE_LABELS, buildHistoryView, countByMode, summarizeRunState };

// UMD 각주(2026-08-18 렌더러 격리) — agent-sidebar-list.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.SessionHistoryView = __exports;
}

})();
