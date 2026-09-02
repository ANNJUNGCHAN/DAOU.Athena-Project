// session-history-view.js 단위 테스트 — 순수 함수라 DOM 스텁이 전혀 필요 없다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MODE_ORDER, MODE_LABELS, buildHistoryView, countByMode, summarizeRunState,
} = require('./session-history-view');

function session(overrides) {
  return {
    id: 's1',
    mode: 'chat',
    projectId: 'p1',
    title: '세션 하나',
    pinned: false,
    archived: false,
    updatedAt: '2026-09-01T00:00:00.000Z',
    runState: null,
    ...overrides,
  };
}

test('세션이 없어도 모드 다섯 행이 count 0으로 나온다', () => {
  const view = buildHistoryView({ sessions: [], projects: [] });
  assert.equal(view.modes.length, 5);
  assert.deepEqual(view.modes.map((m) => m.mode), [...MODE_ORDER]);
  assert.deepEqual(view.modes.map((m) => m.label), MODE_ORDER.map((m) => MODE_LABELS[m]));
  assert.ok(view.modes.every((m) => m.count === 0 && m.runState === null));
  assert.deepEqual(view.totals, { sessions: 0, running: 0 });
});

test('모드별 개수가 맞고, 모르는 mode는 chat으로 센다', () => {
  const sessions = [
    session({ id: 'a', mode: 'graph' }),
    session({ id: 'b', mode: 'backtest' }),
    session({ id: 'c', mode: 'chat' }),
    session({ id: 'd', mode: 'wormhole' }),
    session({ id: 'e', mode: undefined }),
  ];
  assert.deepEqual(countByMode(sessions), { chat: 3, graph: 1, agent: 0, plugin: 0, backtest: 1 });

  const view = buildHistoryView({ sessions });
  const byMode = Object.fromEntries(view.modes.map((m) => [m.mode, m.count]));
  assert.deepEqual(byMode, { chat: 3, graph: 1, agent: 0, plugin: 0, backtest: 1 });
  assert.equal(view.totals.sessions, 5);
});

test('archived는 기본으로 빠지고 includeArchived로만 들어온다', () => {
  const sessions = [
    session({ id: 'live', mode: 'chat' }),
    session({ id: 'gone', mode: 'chat', archived: true }),
  ];

  const base = buildHistoryView({ sessions, projects: [{ id: 'p1', label: '프로젝트' }] });
  assert.equal(base.totals.sessions, 1);
  assert.equal(base.modes.find((m) => m.mode === 'chat').count, 1);
  assert.deepEqual(base.recent.map((r) => r.id), ['live']);
  assert.deepEqual(base.projects[0].sessions.map((s) => s.id), ['live']);

  const all = buildHistoryView({
    sessions, projects: [{ id: 'p1', label: '프로젝트' }], includeArchived: true,
  });
  assert.equal(all.totals.sessions, 2);
  assert.equal(all.modes.find((m) => m.mode === 'chat').count, 2);
  assert.equal(all.projects[0].count, 2);
});

test('프로젝트는 pinned 먼저, 그 다음 최신, 같으면 label 사전순', () => {
  const view = buildHistoryView({
    projects: [
      { id: 'old', label: 'B오래된', pinned: false },
      { id: 'fresh', label: 'A최신', pinned: false },
      { id: 'tieA', label: 'A동률', pinned: false },
      { id: 'tieB', label: 'B동률', pinned: false },
      { id: 'stuck', label: 'Z고정', pinned: true },
    ],
    sessions: [
      session({ id: 's-old', projectId: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }),
      session({ id: 's-fresh', projectId: 'fresh', updatedAt: '2026-09-02T00:00:00.000Z' }),
      session({ id: 's-tieA', projectId: 'tieA', updatedAt: '2026-05-05T00:00:00.000Z' }),
      session({ id: 's-tieB', projectId: 'tieB', updatedAt: '2026-05-05T00:00:00.000Z' }),
      session({ id: 's-stuck', projectId: 'stuck', updatedAt: '2020-01-01T00:00:00.000Z' }),
    ],
  });
  assert.deepEqual(view.projects.map((p) => p.id), ['stuck', 'fresh', 'tieA', 'tieB', 'old']);
  assert.equal(view.projects[0].pinned, true);
});

test('프로젝트 안에서는 running이 먼저, 나머지는 최신순', () => {
  const view = buildHistoryView({
    projects: [{ id: 'p1', label: '프로젝트' }],
    sessions: [
      session({ id: 'newest', updatedAt: '2026-09-03T00:00:00.000Z', runState: 'done' }),
      session({ id: 'oldRunning', updatedAt: '2020-01-01T00:00:00.000Z', runState: 'running' }),
      session({ id: 'middle', updatedAt: '2026-06-01T00:00:00.000Z', runState: 'waiting' }),
    ],
  });
  assert.deepEqual(view.projects[0].sessions.map((s) => s.id), ['oldRunning', 'newest', 'middle']);
  assert.equal(view.projects[0].runState, 'running');
  assert.equal(view.projects[0].count, 3);
  assert.equal(view.totals.running, 1);
});

test('projects에 없는 projectId는 자동 프로젝트가 되어 담긴다', () => {
  const view = buildHistoryView({
    projects: [{ id: 'known', label: '아는 프로젝트' }],
    sessions: [
      session({ id: 's-known', projectId: 'known', updatedAt: '2026-01-01T00:00:00.000Z' }),
      session({ id: 's-orphan', projectId: 'proj_고아', updatedAt: '2026-09-01T00:00:00.000Z' }),
    ],
  });
  const orphan = view.projects.find((p) => p.id === 'proj_고아');
  assert.ok(orphan, '고아 projectId가 프로젝트로 만들어져야 한다');
  assert.equal(orphan.label, 'proj_고아');
  assert.equal(orphan.pinned, false);
  assert.deepEqual(orphan.sessions.map((s) => s.id), ['s-orphan']);
});

test('recent는 모드 무관 최신순이고 recentLimit을 지킨다', () => {
  const sessions = [
    session({ id: 'r1', mode: 'chat', updatedAt: '2026-09-01T00:00:00.000Z' }),
    session({ id: 'r2', mode: 'backtest', updatedAt: '2026-09-03T00:00:00.000Z' }),
    session({ id: 'r3', mode: 'graph', updatedAt: '2026-09-02T00:00:00.000Z' }),
    session({ id: 'r4', mode: 'agent', updatedAt: '2026-08-01T00:00:00.000Z' }),
  ];
  const limited = buildHistoryView({ sessions, recentLimit: 2 });
  assert.deepEqual(limited.recent.map((r) => r.id), ['r2', 'r3']);
  assert.deepEqual(limited.recent.map((r) => r.mode), ['backtest', 'graph']);
  assert.equal(limited.recent[0].projectId, 'p1');

  const seven = Array.from({ length: 7 }, (_, i) => session({
    id: `k${i}`, updatedAt: `2026-09-0${i + 1}T00:00:00.000Z`,
  }));
  assert.equal(buildHistoryView({ sessions: seven }).recent.length, 6);
});

test('active 플래그가 세션과 모드 양쪽에 붙는다', () => {
  const view = buildHistoryView({
    projects: [{ id: 'p1', label: '프로젝트' }],
    sessions: [session({ id: 'here' }), session({ id: 'there' })],
    activeSessionId: 'here',
    activeMode: 'graph',
  });
  assert.deepEqual(view.recent.filter((r) => r.active).map((r) => r.id), ['here']);
  assert.deepEqual(view.projects[0].sessions.filter((s) => s.active).map((s) => s.id), ['here']);
  assert.deepEqual(view.modes.filter((m) => m.active).map((m) => m.mode), ['graph']);

  const none = buildHistoryView({ sessions: [session({ id: undefined })] });
  assert.equal(none.recent[0].active, false);
});

test('summarizeRunState는 running > waiting > failed > done > null 순이다', () => {
  const of = (...states) => summarizeRunState(states.map((runState) => ({ runState })));
  assert.equal(of('done', 'failed', 'waiting', 'running'), 'running');
  assert.equal(of('done', 'failed', 'waiting'), 'waiting');
  assert.equal(of('done', 'failed'), 'failed');
  assert.equal(of('done', 'done'), 'done');
  assert.equal(of(null, undefined, 'unknown'), null);
  assert.equal(summarizeRunState([]), null);
  assert.equal(summarizeRunState(null), null);
});

test('입력이 null이어도 던지지 않고 빈 뷰를 돌려준다', () => {
  for (const bad of [null, undefined, 'nope', { sessions: null, projects: 'nope' }]) {
    const view = buildHistoryView(bad);
    assert.equal(view.modes.length, 5);
    assert.ok(view.modes.every((m) => m.count === 0));
    assert.deepEqual(view.projects, []);
    assert.deepEqual(view.recent, []);
    assert.deepEqual(view.totals, { sessions: 0, running: 0 });
  }
  assert.deepEqual(countByMode(null), { chat: 0, graph: 0, agent: 0, plugin: 0, backtest: 0 });
});

test('입력 배열을 정렬로 변형하지 않는다', () => {
  const sessions = [
    session({ id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' }),
    session({ id: 'b', updatedAt: '2026-09-01T00:00:00.000Z' }),
  ];
  const projects = [{ id: 'p1', label: '프로젝트' }, { id: 'p0', label: '앞' }];
  buildHistoryView({ sessions, projects });
  assert.deepEqual(sessions.map((s) => s.id), ['a', 'b']);
  assert.deepEqual(projects.map((p) => p.id), ['p1', 'p0']);
});
