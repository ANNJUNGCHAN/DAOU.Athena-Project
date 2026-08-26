// controller.js 단위 테스트 — 의존을 전부 주입하므로 Electron이 필요 없다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('./graph-mode-store');
const layout = require('./cluster-layout');
const render = require('./render');
const prefs = require('./graph-mode-prefs');
const { createGraphModeController } = require('./controller');
const { fakeNode, installFakeDocument, uninstallFakeDocument } = require('./fake-dom');

function payload(revision) {
  return {
    revision,
    nodes: [
      { entity_id: 'e:a', name: '반도체', kind: 'theme', cluster: 0, degree: 2 },
      { entity_id: 'e:b', name: '고배당', kind: 'theme', cluster: 1, degree: 1 },
    ],
    edges: [['e:a', 'e:b']],
  };
}

function payloadTwoClusters(revision) {
  return {
    revision,
    nodes: [
      { entity_id: 'e:a', name: '반도체', kind: 'theme', cluster: 0, degree: 2 },
      { entity_id: 'e:b', name: '장비', kind: 'company', cluster: 0, degree: 1 },
      { entity_id: 'e:c', name: '고배당', kind: 'theme', cluster: 1, degree: 1 },
    ],
    edges: [['e:a', 'e:b']],
  };
}

function setup(options) {
  const opts = options || {};
  const elements = {
    pill: fakeNode('button'),
    summary: fakeNode('div'),
    graph: fakeNode('div'),
  };
  if (opts.withPanel) elements.panel = fakeNode('div');
  let calls = 0;
  const controller = createGraphModeController({
    store,
    layout,
    render,
    prefs: opts.prefs === undefined ? null : opts.prefs,
    elements,
    fetchClusterMap: async () => {
      calls += 1;
      if (opts.fail) throw new Error('backend down');
      const build = opts.payload || payload;
      return build(opts.revisions ? opts.revisions[calls - 1] : 7);
    },
    onError: opts.onError,
  });
  // 대부분의 테스트는 브레인이 켜져 있다고 가정한다 — 꺼진 채 시작하고 싶은
  // 테스트만 opts.available: false를 넘긴다.
  if (opts.available !== false) controller.setAvailable(true);
  return { controller, elements, fetchCalls: () => calls };
}

test.beforeEach(() => {
  installFakeDocument();
});

test.afterEach(() => {
  uninstallFakeDocument();
});

test('처음에는 요약이 보이고 그래프는 숨겨져 있다', () => {
  const { controller, elements } = setup();
  controller.applyVisibility();
  assert.equal(elements.summary.hidden, false);
  assert.equal(elements.graph.hidden, true);
  assert.equal(elements.pill.textContent, '답변', '모드 칩은 지금 모드를 보여준다');
});

test('토글하면 캔버스 영역이 그래프로 바뀌고 그려진다', async () => {
  const { controller, elements } = setup();
  await controller.toggle();
  assert.equal(elements.summary.hidden, true, '요약이 숨는다');
  assert.equal(elements.graph.hidden, false);
  assert.equal(elements.pill.textContent, '그래프', '모드 칩은 지금 모드를 보여준다');
  assert.equal(render.describeRendered(elements.graph).nodes, 2);
});

test('다시 토글하면 요약으로 돌아온다', async () => {
  const { controller, elements } = setup();
  await controller.toggle();
  await controller.toggle();
  assert.equal(elements.summary.hidden, false);
  assert.equal(elements.graph.hidden, true);
});

test('리비전이 그대로면 다시 그리지 않는다', async () => {
  // 같은 그림을 다시 그리면 SVG가 통째로 교체되어 화면이 깜빡인다.
  const { controller, elements } = setup();
  await controller.toggle();
  const svgBefore = elements.graph.children[0];
  const redrawn = await controller.refresh();
  assert.equal(redrawn, null, '다시 그리지 않았다');
  assert.equal(elements.graph.children[0], svgBefore, '같은 SVG가 그대로 있다');
});

test('리비전이 바뀌면 다시 그린다', async () => {
  const { controller } = setup({ revisions: [7, 8] });
  await controller.toggle();
  const redrawn = await controller.refresh();
  assert.notEqual(redrawn, null, '새 리비전이면 다시 그린다');
});

test('백엔드가 죽으면 요약으로 돌아간다', async () => {
  // 빈 캔버스를 띄우면 "성향이 없다"로 읽힌다. 없는 것과 못 읽은 것은 다르다.
  const seen = [];
  const { controller, elements } = setup({ fail: true, onError: (e) => seen.push(e) });
  await controller.toggle();
  assert.equal(elements.graph.hidden, true, '그래프를 띄우지 않는다');
  assert.equal(elements.summary.hidden, false);
  assert.equal(seen.length, 1, '오류를 삼키지 않는다');
});

test('모드 칩은 브레인 상태와 무관하게 상시 보인다', () => {
  // 점(대화 상태)·칩(현재 모드) 둘 다 항상 켜져 있다 — 그래프 모드 진입로를
  // 숨기지 않는다(Paper 보드 05 "모드 칩 상시").
  const { controller, elements } = setup({ available: false });
  controller.applyVisibility();
  assert.equal(elements.pill.hidden, false);
  controller.setAvailable(true);
  assert.equal(elements.pill.hidden, false);
});

test('브레인이 안 됐을 때 그래프 모드로 들어오면 캔버스 안에 정직한 안내가 뜬다', async () => {
  // 빈 그래프를 그냥 띄우면 "성향이 없다"로 읽힌다 — 없는 것과 못 읽은 것은 다르다.
  // 그렇다고 모드 진입 자체를 막지도 않는다(예전엔 필이 숨어서 못 들어왔다).
  const { controller, elements, fetchCalls } = setup({ available: false });
  await controller.toggle();
  assert.equal(elements.summary.hidden, true, '그래프 모드 자체는 열린다');
  assert.equal(elements.graph.hidden, false);
  assert.equal(fetchCalls(), 0, '못 쓴다는 걸 이미 아니까 왕복하지 않는다');
  assert.match(elements.graph.children[0].textContent, /브레인|성향/);
});

test('그래프를 보는 중에 브레인이 꺼지면 화면 안에서 안내로 바뀐다(요약으로 쫓겨나지 않는다)', async () => {
  const { controller, elements } = setup();
  await controller.toggle();
  assert.equal(elements.graph.hidden, false);
  const svgBefore = elements.graph.children[0];
  controller.setAvailable(false);
  assert.equal(elements.graph.hidden, false, '그래프 모드에 그대로 머문다');
  assert.equal(elements.summary.hidden, true);
  assert.notEqual(elements.graph.children[0], svgBefore, '그림 대신 안내로 바뀐다');
});

test('그래프를 못 쓰다가 브레인이 켜지면 안내 대신 실제로 그린다', async () => {
  const { controller, elements, fetchCalls } = setup({ available: false });
  await controller.toggle();
  assert.equal(fetchCalls(), 0);
  await controller.setAvailable(true);
  assert.equal(fetchCalls(), 1);
  assert.equal(render.describeRendered(elements.graph).nodes, 2);
});

test('설정이 이름표 임계를 정한다', async () => {
  const storage = {
    _v: JSON.stringify({ labelThreshold: 1 }),
    getItem() {
      return this._v;
    },
    setItem(_k, v) {
      this._v = v;
    },
  };
  const boundPrefs = {
    readPrefs: () => prefs.readPrefs(storage),
    shouldShowLabels: (s, n) => prefs.shouldShowLabels(s, n),
  };
  const { controller, elements } = setup({ prefs: boundPrefs });
  await controller.toggle();
  // 노드가 2개인데 임계가 1이므로 이름표가 안 붙는다.
  assert.equal(render.describeRendered(elements.graph).labels, 0);
});

test('요약 화면에서는 백엔드를 부르지 않는다', async () => {
  const { controller, fetchCalls } = setup();
  await controller.refresh();
  assert.equal(fetchCalls(), 0, '안 보이는 화면 때문에 왕복하지 않는다');
});

// ── 보드 15: 군집 펼침 · 노드 선택 와이어링 ──────────────────────────────────

test('1단계에서 노드를 클릭하면 그 군집이 펼쳐진다', async () => {
  const { controller, elements, fetchCalls } = setup({ payload: payloadTwoClusters });
  await controller.toggle();
  assert.equal(controller.state.stage, store.STAGE_CLUSTERS);
  const nodeEls = elements.graph.querySelectorAll('.graph-node');
  assert.equal(nodeEls.length, 3, '1단계는 군집 전부가 보인다');
  const clusterZeroNode = nodeEls.find((n) => n.getAttribute('data-entity-id') === 'e:a');
  clusterZeroNode.dispatchEvent({ type: 'click' });
  assert.equal(controller.state.stage, store.STAGE_EXPANDED);
  assert.equal(controller.state.expandedCluster, 0);
  assert.equal(fetchCalls(), 1, '펼침은 새 fetch 없이 캐시로 다시 그린다');
  const afterExpand = elements.graph.querySelectorAll('.graph-node');
  assert.deepEqual(afterExpand.map((n) => n.getAttribute('data-entity-id')).sort(), ['e:a', 'e:b']);
});

test('2단계에서 노드를 클릭하면 선택된다(패널이 채워진다)', async () => {
  const { controller, elements } = setup({ payload: payloadTwoClusters, withPanel: true });
  await controller.toggle();
  const firstClick = elements.graph.querySelectorAll('.graph-node')
    .find((n) => n.getAttribute('data-entity-id') === 'e:a');
  firstClick.dispatchEvent({ type: 'click' }); // 1단계 클릭 — 펼친다
  assert.equal(controller.state.stage, store.STAGE_EXPANDED);

  const secondClick = elements.graph.querySelectorAll('.graph-node')
    .find((n) => n.getAttribute('data-entity-id') === 'e:b');
  secondClick.dispatchEvent({ type: 'click' }); // 2단계 클릭 — 고른다
  assert.equal(controller.state.selectedEntityId, 'e:b');
  assert.equal(controller.state.panel.name, '장비');
  assert.equal(elements.panel.hidden, false);
  assert.match(elements.panel.textContent, /장비/);
});

test('panel 요소가 없으면 선택 상태는 바뀌지만 조용히 넘어간다', async () => {
  const { controller, elements } = setup({ payload: payloadTwoClusters });
  await controller.toggle();
  const node = elements.graph.querySelectorAll('.graph-node')[0];
  assert.doesNotThrow(() => node.dispatchEvent({ type: 'click' }));
});

test('collapseCluster()로 2단계에서 1단계로 돌아간다', async () => {
  const { controller, elements } = setup({ payload: payloadTwoClusters });
  await controller.toggle();
  elements.graph.querySelectorAll('.graph-node')[0].dispatchEvent({ type: 'click' });
  assert.equal(controller.state.stage, store.STAGE_EXPANDED);
  controller.collapseCluster();
  assert.equal(controller.state.stage, store.STAGE_CLUSTERS);
  assert.equal(elements.graph.querySelectorAll('.graph-node').length, 3, '전부 다시 보인다');
});

test('clearSelection()으로 패널이 닫힌다', async () => {
  const { controller, elements } = setup({ payload: payloadTwoClusters, withPanel: true });
  await controller.toggle();
  controller.selectEntity('e:a', { name: '반도체' });
  assert.equal(elements.panel.hidden, false);
  controller.clearSelection();
  assert.equal(controller.state.selectedEntityId, null);
  assert.equal(elements.panel.hidden, true);
});

// ── 보드 07: 요약 표 행 선택도 같은 공통 패널을 쓴다 ─────────────────────────
// 요약 표 자체(canvas.js)는 이 디렉터리 밖이라 행 클릭 배선은 여기 없다 — 이
// 테스트는 selectEntity()가 그래프 클릭과 동일한 패널 경로를 그대로 타는지만
// 지킨다(store 주석 "공통 패널은 단계와 무관하게 같은 방식으로 열린다").
test('selectEntity()는 그래프를 열지 않고도(요약 화면에서도) 공통 패널을 연다', () => {
  const { controller, elements } = setup({ withPanel: true });
  controller.applyVisibility();
  assert.equal(controller.state.view, store.VIEW_SUMMARY);
  controller.selectEntity('trait:short-turn', { name: '단기 회전' });
  assert.equal(controller.state.selectedEntityId, 'trait:short-turn');
  assert.equal(elements.panel.hidden, false);
  assert.match(elements.panel.textContent, /단기 회전/);
});
