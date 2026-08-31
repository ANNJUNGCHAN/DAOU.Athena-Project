'use strict';

// 그래프 모드 — 결정적 배치와 상태 기계.
//
// 이 스위트가 지키는 것 둘:
// 1. **같은 입력이면 픽셀까지 같다.** 힘 기반 시뮬레이션을 쓰지 않은 이유이고,
//    백엔드가 군집 번호를 결정적으로 매기는 이유를 화면에서 무너뜨리지 않기 위해서다.
// 2. **리비전이 바뀌면 펼침을 접는다.** 군집 번호는 크기 순이라 새 노드 하나에 순서가
//    바뀐다 — 조용히 다른 군집을 보여주느니 1단계로 돌아가는 편이 정직하다.

const test = require('node:test');
const assert = require('node:assert/strict');

const { layoutClusterMap, nodeRadiusPx, groupByCluster, NODE_RADIUS_MIN_PX, NODE_RADIUS_MAX_PX } =
  require('./cluster-layout');
const store = require('./graph-mode-store');

const VIEWPORT = { width: 1200, height: 800 };

function node(id, cluster, degree = 1, name = id) {
  return { entity_id: id, name, kind: 'theme', cluster, degree };
}

function payload() {
  return {
    revision: 7,
    nodes: [
      node('e:a', 0, 5, '반도체'),
      node('e:b', 0, 2, '장비'),
      node('e:c', 1, 3, '고배당'),
      node('e:d', 1, 1, '리츠'),
    ],
    edges: [
      ['e:a', 'e:b'],
      ['e:c', 'e:d'],
      ['e:a', 'e:c'],
    ],
  };
}

// ── 배치 ────────────────────────────────────────────────────────────────────

test('같은 입력이면 좌표가 픽셀까지 같다', () => {
  const first = layoutClusterMap(payload(), VIEWPORT);
  const second = layoutClusterMap(payload(), VIEWPORT);
  assert.deepEqual(first, second);
});

test('모든 노드가 캔버스 안에 있다', () => {
  const layout = layoutClusterMap(payload(), VIEWPORT);
  assert.equal(layout.nodes.length, 4);
  for (const placed of layout.nodes) {
    assert.ok(placed.x >= 0 && placed.x <= VIEWPORT.width, `x=${placed.x}`);
    assert.ok(placed.y >= 0 && placed.y <= VIEWPORT.height, `y=${placed.y}`);
  }
});

test('차수가 큰 노드가 더 크게 그려진다', () => {
  const layout = layoutClusterMap(payload(), VIEWPORT);
  const byId = new Map(layout.nodes.map((n) => [n.entity_id, n]));
  assert.ok(byId.get('e:a').radius > byId.get('e:d').radius);
});

test('반지름은 상·하한 사이에 머문다', () => {
  assert.equal(nodeRadiusPx(0, 0), NODE_RADIUS_MIN_PX);
  assert.equal(nodeRadiusPx(0, 100), NODE_RADIUS_MIN_PX);
  assert.equal(nodeRadiusPx(100, 100), NODE_RADIUS_MAX_PX);
  // 음수 차수가 와도 하한 아래로 내려가지 않는다.
  assert.equal(nodeRadiusPx(-5, 100), NODE_RADIUS_MIN_PX);
});

test('군집을 넘는 엣지가 표시된다', () => {
  const layout = layoutClusterMap(payload(), VIEWPORT);
  const crossing = layout.edges.filter((edge) => edge.crossesCluster);
  assert.equal(crossing.length, 1);
  assert.deepEqual(
    [crossing[0].from, crossing[0].to].sort(),
    ['e:a', 'e:c']
  );
});

test('한쪽 끝이 없는 엣지는 그리지 않는다', () => {
  const broken = payload();
  broken.edges.push(['e:a', 'e:does-not-exist']);
  const layout = layoutClusterMap(broken, VIEWPORT);
  assert.equal(layout.edges.length, 3, '끊어진 엣지가 걸러져야 한다');
});

test('빈 응답이 터지지 않는다', () => {
  assert.deepEqual(layoutClusterMap({ revision: 3, nodes: [], edges: [] }, VIEWPORT), {
    revision: 3,
    nodes: [],
    edges: [],
    clusters: [],
  });
  assert.equal(layoutClusterMap(null, VIEWPORT).nodes.length, 0);
  assert.equal(layoutClusterMap(payload(), null).nodes.length, 4);
});

test('군집 묶음이 번호 오름차순, 안쪽은 id 오름차순이다', () => {
  const shuffled = {
    nodes: [node('e:z', 1), node('e:a', 1), node('e:m', 0)],
    edges: [],
  };
  const groups = groupByCluster(shuffled.nodes);
  assert.deepEqual(groups.map((g) => g.cluster), [0, 1]);
  assert.deepEqual(groups[1].members.map((m) => m.entity_id), ['e:a', 'e:z']);
});

// ── 상태 기계 ───────────────────────────────────────────────────────────────

test('처음에는 요약 화면, 1단계다', () => {
  const state = store.createInitialState();
  assert.equal(state.view, store.VIEW_SUMMARY);
  assert.equal(state.stage, store.STAGE_CLUSTERS);
  assert.equal(store.isGraphView(state), false);
});

test('요약⇄그래프 토글', () => {
  let state = store.createInitialState();
  state = store.toggleView(state);
  assert.equal(state.view, store.VIEW_GRAPH);
  state = store.toggleView(state);
  assert.equal(state.view, store.VIEW_SUMMARY);
});

test('요약으로 나가면 펼침과 선택을 버린다', () => {
  // 돌아왔을 때 기억하지 못하는 상태에 놓여 있으면 방향을 잃는다.
  let state = store.toggleView(store.createInitialState());
  state = store.expandCluster(state, 1);
  state = store.selectEntity(state, 'e:a', { name: '반도체' });
  state = store.toggleView(state);
  assert.equal(state.stage, store.STAGE_CLUSTERS);
  assert.equal(state.expandedCluster, null);
  assert.equal(state.selectedEntityId, null);
  assert.equal(state.panel, null);
});

test('요약 화면에서는 펼칠 수 없다', () => {
  const state = store.createInitialState();
  assert.equal(store.expandCluster(state, 0), state, '같은 상태를 돌려줘야 한다');
});

test('펼치고 접기', () => {
  let state = store.toggleView(store.createInitialState());
  state = store.expandCluster(state, 0);
  assert.equal(state.stage, store.STAGE_EXPANDED);
  assert.equal(state.expandedCluster, 0);
  state = store.collapseCluster(state);
  assert.equal(state.stage, store.STAGE_CLUSTERS);
  assert.equal(state.expandedCluster, null);
});

test('정수가 아닌 군집 번호는 무시한다', () => {
  const state = store.toggleView(store.createInitialState());
  for (const bad of [null, undefined, '0', 1.5, NaN]) {
    assert.equal(store.expandCluster(state, bad), state);
  }
});

test('공통 패널은 단계와 무관하게 같은 방식으로 열린다', () => {
  let state = store.toggleView(store.createInitialState());
  state = store.selectEntity(state, 'e:a', { name: '반도체' });
  assert.equal(state.selectedEntityId, 'e:a');
  state = store.expandCluster(state, 0);
  assert.equal(state.selectedEntityId, 'e:a', '펼쳐도 선택은 유지된다');
  state = store.clearSelection(state);
  assert.equal(state.panel, null);
});

test('리비전이 바뀌면 펼침을 접는다', () => {
  // 군집 번호는 크기 순이라 새 노드 하나에 순서가 바뀐다 — 펼친 번호가 다른 것을
  // 가리킬 수 있으므로 조용히 다른 군집을 보여주지 않는다.
  let state = store.toggleView(store.createInitialState());
  state = store.applyRevision(state, 7);
  state = store.expandCluster(state, 1);
  state = store.selectEntity(state, 'e:a', {});
  state = store.applyRevision(state, 8);
  assert.equal(state.stage, store.STAGE_CLUSTERS);
  assert.equal(state.expandedCluster, null);
  assert.equal(state.selectedEntityId, null);
  assert.equal(state.view, store.VIEW_GRAPH, '화면 자체는 그대로 그래프다');
});

test('리비전이 그대로면 아무것도 버리지 않는다', () => {
  let state = store.applyRevision(store.toggleView(store.createInitialState()), 7);
  state = store.expandCluster(state, 1);
  const same = store.applyRevision(state, 7);
  assert.equal(same, state, '같은 객체를 돌려줘야 헛된 다시 그리기가 없다');
});

// ── 단계별로 무엇이 보이는가 ────────────────────────────────────────────────

test('1단계는 전부, 2단계는 펼친 군집 + 이웃 1홉이 보인다(보드 04)', () => {
  const layout = layoutClusterMap(payload(), VIEWPORT);
  let state = store.applyRevision(store.toggleView(store.createInitialState()), 7);
  assert.equal(store.visibleNodes(state, layout).length, 4);

  state = store.expandCluster(state, 0);
  const visible = store.visibleNodes(state, layout);
  // e:a·e:b는 군집 0. e:c는 e:a와 이어진 이웃이라 함께 보인다 — 군집 경계를 넘는
  // 연결의 반대쪽 끝을 지우면 그 연결 자체가 화면에서 사라진다.
  assert.deepEqual(visible.map((n) => n.entity_id).sort(), ['e:a', 'e:b', 'e:c']);
  // e:d는 2홉(e:c의 이웃)이라 안 보인다 — 1홉에서 끊는다.
  assert.ok(!visible.some((n) => n.entity_id === 'e:d'));
});

test('2단계에서는 양 끝이 보이는 엣지만 그린다', () => {
  // 한쪽이 화면 밖인 선을 그리면 어디로도 가지 않는 선이 된다.
  const layout = layoutClusterMap(payload(), VIEWPORT);
  let state = store.applyRevision(store.toggleView(store.createInitialState()), 7);
  state = store.expandCluster(state, 0);
  const edges = store.visibleEdges(state, layout);
  const pairs = edges.map((e) => [e.from, e.to].sort().join('~')).sort();
  // e:a~e:b(군집 내부)와 e:a~e:c(군집 경계 넘음) 둘 다 양 끝이 보인다.
  // e:c~e:d는 e:d가 안 보이므로 빠진다.
  assert.deepEqual(pairs, ['e:a~e:b', 'e:a~e:c']);
});

test('이웃이 하나도 없는 군집을 펼치면 그 군집만 보인다', () => {
  const isolated = {
    revision: 7,
    nodes: [node('e:x', 0, 1), node('e:y', 0, 1), node('e:z', 1, 1)],
    edges: [['e:x', 'e:y']],
  };
  const layout = layoutClusterMap(isolated, VIEWPORT);
  let state = store.applyRevision(store.toggleView(store.createInitialState()), 7);
  state = store.expandCluster(state, 0);
  assert.deepEqual(store.visibleNodes(state, layout).map((n) => n.entity_id).sort(), ['e:x', 'e:y']);
});

test('없는 군집을 펼치면 빈 화면이다(지어내지 않는다)', () => {
  const layout = layoutClusterMap(payload(), VIEWPORT);
  let state = store.applyRevision(store.toggleView(store.createInitialState()), 7);
  state = store.expandCluster(state, 99);
  assert.deepEqual(store.visibleNodes(state, layout), []);
  assert.deepEqual(store.visibleEdges(state, layout), []);
});

test('서브뷰는 요약·지도·수집노출 셋뿐이고 모르는 값은 무시된다(보드 05)', () => {
  const base = store.createInitialState();
  assert.equal(base.surface, store.SURFACE_SUMMARY, '기본은 요약이다');
  assert.equal(store.setSurface(base, store.SURFACE_SETTINGS).surface, store.SURFACE_SETTINGS);
  assert.equal(store.setSurface(base, store.SURFACE_MAP).surface, store.SURFACE_MAP);
  assert.equal(store.setSurface(base, 'nope'), base, '모르는 서브뷰는 상태를 안 바꾼다');
  assert.deepEqual(store.SURFACES, [store.SURFACE_SUMMARY, store.SURFACE_MAP, store.SURFACE_SETTINGS]);
});

test('서브뷰 전환은 펼침·선택을 건드리지 않는다(같은 그래프를 다르게 보는 것뿐)', () => {
  let state = store.expandCluster(store.toggleView(store.createInitialState()), 0);
  state = store.selectEntity(state, 'e:a', { name: '반도체' });
  const moved = store.setSurface(state, store.SURFACE_SETTINGS);
  assert.equal(moved.expandedCluster, 0);
  assert.equal(moved.selectedEntityId, 'e:a');
  assert.equal(moved.stage, store.STAGE_EXPANDED);
});

test('빈 배치에서도 보이는 것 계산이 터지지 않는다', () => {
  const state = store.createInitialState();
  assert.deepEqual(store.visibleNodes(state, null), []);
  assert.deepEqual(store.visibleEdges(state, {}), []);
});

// ── 3상태(agent 추가) ───────────────────────────────────────────────────────
// setView(state,'agent')가 toggleView를 재사용하면 무조건 VIEW_GRAPH로 튀는
// 결함이 있었다(Rev.2에서 발견) — 이 구간은 그 회귀를 잡는다.

test('setView(state, "agent")는 실제로 agent로 전이한다', () => {
  const state = store.setView(store.createInitialState(), 'agent');
  assert.equal(state.view, 'agent');
});

test('VIEW_PLUGIN을 export하고 setView(state, "plugin")은 plugin으로 전이한다', () => {
  assert.equal(store.VIEW_PLUGIN, 'plugin');
  const state = store.setView(store.createInitialState(), store.VIEW_PLUGIN);
  assert.equal(state.view, 'plugin');
});

test('VIEW_BACKTEST를 export하고 setView(state, "backtest")는 backtest로 전이한다(D4, 5번째 모드)', () => {
  assert.equal(store.VIEW_BACKTEST, 'backtest');
  const state = store.setView(store.createInitialState(), store.VIEW_BACKTEST);
  assert.equal(state.view, 'backtest');
});

test('setView는 summary⇄agent⇄graph 어느 방향으로도 직접 전이한다', () => {
  let state = store.createInitialState();
  state = store.setView(state, 'agent');
  assert.equal(state.view, 'agent');
  state = store.setView(state, 'graph');
  assert.equal(state.view, store.VIEW_GRAPH);
  state = store.setView(state, 'summary');
  assert.equal(state.view, store.VIEW_SUMMARY);
  state = store.setView(state, 'plugin');
  assert.equal(state.view, store.VIEW_PLUGIN);
});

test('setView는 그래프를 떠날 때(목적지가 agent여도) 펼침·선택을 버린다', () => {
  let state = store.applyRevision(store.setView(store.createInitialState(), 'graph'), 7);
  state = store.expandCluster(state, 1);
  state = store.selectEntity(state, 'e:a', {});
  state = store.setView(state, 'agent');
  assert.equal(state.view, 'agent');
  assert.equal(state.stage, store.STAGE_CLUSTERS);
  assert.equal(state.expandedCluster, null);
  assert.equal(state.selectedEntityId, null);
  assert.equal(state.panel, null);
});

test('setView는 모르는 view 값을 무시하고 같은 상태를 돌려준다', () => {
  const state = store.createInitialState();
  assert.equal(store.setView(state, 'bogus'), state);
});

test('setView는 같은 view로 부르면 같은 객체를 돌려준다(헛된 다시 그리기 없음)', () => {
  const state = store.setView(store.createInitialState(), 'agent');
  assert.equal(store.setView(state, 'agent'), state);
});

test('toggleView는 agent 상태에서 no-op이다(agent에서 요약·그래프로 토글할 근거가 없다)', () => {
  const state = store.setView(store.createInitialState(), 'agent');
  assert.equal(store.toggleView(state), state, '같은 객체를 그대로 돌려줘야 한다');
});

test('toggleView는 plugin 상태에서도 no-op이다', () => {
  const state = store.setView(store.createInitialState(), store.VIEW_PLUGIN);
  assert.equal(store.toggleView(state), state, '같은 객체를 그대로 돌려줘야 한다');
});

test('toggleView는 agent가 추가된 뒤에도 여전히 summary⇄graph 2값만 순환한다', () => {
  let state = store.createInitialState();
  state = store.toggleView(state);
  assert.equal(state.view, store.VIEW_GRAPH);
  state = store.toggleView(state);
  assert.equal(state.view, store.VIEW_SUMMARY);
});
