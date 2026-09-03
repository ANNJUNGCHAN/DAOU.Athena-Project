// graph-filters.js 단위 테스트 — 순수 함수라 DOM도 Electron도 필요 없다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalize, sortEntries, applyGraphFilters,
  windowLabel, minDegreeLabel, sortLabel, DEFAULTS,
  WINDOW_DAY_OPTIONS, MIN_DEGREE_OPTIONS, SORT_OPTIONS,
} = require('./graph-filters');

const DAY = 86400000;
const NOW = Date.parse('2026-09-01T00:00:00Z');

function iso(daysAgo) {
  return new Date(NOW - daysAgo * DAY).toISOString();
}

// ── normalize ────────────────────────────────────────────────────────────────

test('모르는 값은 기본값으로 접힌다(설정 하나가 깨져도 화면은 열린다)', () => {
  assert.deepEqual(normalize(null), { ...DEFAULTS });
  assert.deepEqual(normalize({ windowDays: 7, minDegree: 99, summarySort: 'zzz' }), { ...DEFAULTS });
  assert.deepEqual(normalize({ windowDays: '180', minDegree: '3', summarySort: 'recent' }),
    { windowDays: 180, minDegree: 3, summarySort: 'recent' });
});

// ── sortEntries ──────────────────────────────────────────────────────────────

test('보강 순은 백엔드 순서를 그대로 둔다', () => {
  const list = [{ entity_id: 'a', observed_at: iso(30) }, { entity_id: 'b', observed_at: iso(1) }];
  assert.deepEqual(sortEntries(list, 'reinforcement').map((e) => e.entity_id), ['a', 'b']);
});

test('최근 순은 관측 시각 내림차순이다', () => {
  const list = [{ entity_id: 'a', observed_at: iso(30) }, { entity_id: 'b', observed_at: iso(1) }];
  assert.deepEqual(sortEntries(list, 'recent').map((e) => e.entity_id), ['b', 'a']);
});

test('시각을 못 읽는 항목은 맨 뒤로 간다(모르는 것을 최신으로 올리지 않는다)', () => {
  const list = [{ entity_id: 'x', observed_at: 'nope' }, { entity_id: 'b', observed_at: iso(1) }];
  assert.deepEqual(sortEntries(list, 'recent').map((e) => e.entity_id), ['b', 'x']);
});

test('원본 배열을 건드리지 않는다', () => {
  const list = [{ entity_id: 'a', observed_at: iso(30) }, { entity_id: 'b', observed_at: iso(1) }];
  sortEntries(list, 'recent');
  assert.deepEqual(list.map((e) => e.entity_id), ['a', 'b']);
});

// ── applyGraphFilters ────────────────────────────────────────────────────────

function payload() {
  return {
    revision: 3,
    nodes: [
      { entity_id: 'a', name: 'A', kind: 'security', cluster: 0, degree: 3 },
      { entity_id: 'b', name: 'B', kind: 'security', cluster: 0, degree: 2 },
      { entity_id: 'c', name: 'C', kind: 'theme', cluster: 0, degree: 2 },
      { entity_id: 'old', name: 'OLD', kind: 'theme', cluster: 1, degree: 1 },
    ],
    edges: [['a', 'b'], ['a', 'c'], ['b', 'c'], ['a', 'old']],
    edge_details: [
      { source: 'a', target: 'b', kinds: ['owns'], tier: 'deterministic', confidence: 'EXTRACTED', observed_at: iso(5) },
      { source: 'a', target: 'c', kinds: ['belongs_to'], tier: 'conversational', confidence: 'INFERRED', observed_at: iso(10) },
      { source: 'b', target: 'c', kinds: ['relates_to'], tier: 'conversational', confidence: 'INFERRED', observed_at: iso(20) },
      { source: 'a', target: 'old', kinds: ['researched'], tier: 'conversational', confidence: 'INFERRED', observed_at: iso(200) },
    ],
  };
}

test('기간 밖 엣지와 그 때문에 고립된 노드가 사라진다', () => {
  const out = applyGraphFilters(payload(), { windowDays: 90, minDegree: 0 }, NOW);
  assert.deepEqual(out.edges.map((e) => e.join('~')).sort(), ['a~b', 'a~c', 'b~c']);
  // 'old'는 노드로는 남는다 — minDegree가 0이면 연결이 없다고 지우지 않는다.
  assert.ok(out.nodes.some((n) => n.entity_id === 'old'));
  assert.equal(out.nodes.find((n) => n.entity_id === 'old').degree, 0, '창 안 연결이 0개임을 정직하게 말한다');
});

test('기간이 넓어지면 오래된 연결이 돌아온다', () => {
  const out = applyGraphFilters(payload(), { windowDays: 365, minDegree: 0 }, NOW);
  assert.equal(out.edges.length, 4);
});

test('차수는 걸러진 뒤 다시 센다(백엔드의 전체 기간 degree를 그대로 두지 않는다)', () => {
  const out = applyGraphFilters(payload(), { windowDays: 90, minDegree: 0 }, NOW);
  assert.equal(out.nodes.find((n) => n.entity_id === 'a').degree, 2, '창 안에서 a는 b·c 둘뿐이다');
});

test('최소 연결 수는 연쇄가 멈출 때까지 반복 적용된다', () => {
  // a-b-c 삼각형에 꼬리(tail) 하나: tail은 c에만 붙어 있다.
  const chain = {
    revision: 1,
    nodes: [
      { entity_id: 'a', name: 'A', kind: 'security', cluster: 0, degree: 2 },
      { entity_id: 'b', name: 'B', kind: 'security', cluster: 0, degree: 2 },
      { entity_id: 'tail', name: 'T', kind: 'security', cluster: 0, degree: 1 },
      { entity_id: 'tail2', name: 'T2', kind: 'security', cluster: 0, degree: 1 },
    ],
    edges: [['a', 'b'], ['b', 'tail'], ['tail', 'tail2']],
    edge_details: [],
  };
  const out = applyGraphFilters(chain, { windowDays: 365, minDegree: 2 }, NOW);
  // tail2(차수1) → tail(그러면 차수1) → b(그러면 차수1) → a … 전부 무너진다.
  assert.deepEqual(out.nodes.map((n) => n.entity_id), []);
  assert.deepEqual(out.edges, []);
});

test('observed_at이 없는 엣지(구버전 backend)는 창 밖이라고 단정하지 않는다', () => {
  const legacy = { ...payload(), edge_details: [] };
  const out = applyGraphFilters(legacy, { windowDays: 30, minDegree: 0 }, NOW);
  assert.equal(out.edges.length, 4, '시각을 모르면 거르지 않는다(§0 정책)');
});

test('빈 그래프는 그대로 돌려준다', () => {
  const empty = { revision: 1, nodes: [], edges: [] };
  assert.equal(applyGraphFilters(empty, { windowDays: 30 }, NOW), empty);
});

test('edge_details도 사라진 노드에 맞춰 걸러진다(패널 관계 목록이 유령 행을 안 만든다)', () => {
  const out = applyGraphFilters(payload(), { windowDays: 365, minDegree: 2 }, NOW);
  const ids = new Set(out.nodes.map((n) => n.entity_id));
  assert.ok(!ids.has('old'), 'old는 연결이 하나뿐이라 빠진다');
  assert.ok(out.edge_details.every((d) => ids.has(d.source) && ids.has(d.target)));
});

// ── 라벨 ─────────────────────────────────────────────────────────────────────

test('칩 라벨이 Paper 문구 그대로다 — 연결 수 칩만 예외다', () => {
  assert.equal(windowLabel(90), '최근 90일');
  assert.equal(sortLabel('reinforcement'), '보강 순');
  assert.equal(sortLabel('recent'), '최근 순');
  // 연결 수 칩은 Paper에 대응 문구가 없다. Paper는 "보강 2회 이상"을 그렸는데 그
  // 값은 cluster-map에 없어서 걸 수 없고(이 파일 머리말), 그래서 연결 수로 바꿔 쓴다
  // — 이 두 문구는 구현이 지은 것이다("연결 전체"도 Paper 어디에도 없다, 2026-09-03
  // 전수 검색으로 확인). 그래서 이 줄만 Paper 대조가 아니라 자체 계약이다.
  assert.equal(minDegreeLabel(2), '연결 2개 이상');
  // 기본값은 "무슨 필터인지"와 "지금 안 걸려 있다"를 함께 말해야 한다 — "연결 전체"는
  // 전자를 못 말해서 실사용에서 이 칩을 못 찾았다(2026-09-03 제보).
  assert.equal(minDegreeLabel(0), '연결 제한 없음');
});

// ── 저장소와의 계약 ──────────────────────────────────────────────────────────

test('graph-mode-prefs가 허용하는 값과 여기 선택지가 정확히 같다', () => {
  // 두 모듈이 같은 목록을 각자 들고 있다. 합칠 수 없는 이유는 로드 순서다 —
  // shell.html에서 prefs가 graph-filters보다 먼저 실려서, prefs가 모듈 초기화
  // 시점에 window.AthenaLib.GraphFilters를 참조할 수 없다(테스트도 window 없이
  // prefs를 직접 require한다). 대신 이 테스트가 둘의 어긋남을 즉시 실패로 만든다:
  // 한쪽에만 선택지를 추가하면 저장은 되는데 칩에 안 뜨거나 그 반대가 된다.
  const prefs = require('./graph-mode-prefs');
  assert.deepEqual(prefs.VALID_WINDOW_DAYS, WINDOW_DAY_OPTIONS);
  assert.deepEqual(prefs.VALID_MIN_DEGREES, MIN_DEGREE_OPTIONS);
  assert.deepEqual(prefs.VALID_SORTS, SORT_OPTIONS);
  assert.equal(prefs.DEFAULTS.windowDays, DEFAULTS.windowDays);
  assert.equal(prefs.DEFAULTS.minDegree, DEFAULTS.minDegree);
  assert.equal(prefs.DEFAULTS.summarySort, DEFAULTS.summarySort);
});
