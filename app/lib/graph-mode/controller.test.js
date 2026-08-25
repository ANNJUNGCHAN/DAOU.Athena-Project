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

function setup(options) {
  const opts = options || {};
  const elements = {
    pill: fakeNode('button'),
    summary: fakeNode('div'),
    graph: fakeNode('div'),
  };
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
      return payload(opts.revisions ? opts.revisions[calls - 1] : 7);
    },
    onError: opts.onError,
  });
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
  assert.equal(elements.pill.textContent, '그래프');
});

test('토글하면 캔버스 영역이 그래프로 바뀌고 그려진다', async () => {
  const { controller, elements } = setup();
  await controller.toggle();
  assert.equal(elements.summary.hidden, true, '요약이 숨는다');
  assert.equal(elements.graph.hidden, false);
  assert.equal(elements.pill.textContent, '요약', '다음 동작을 표시한다');
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

test('브레인이 꺼져 있으면 필을 숨긴다', () => {
  // 없는 기능을 있다고 표시하지 않는다 — 루틴 칩과 같은 규율.
  const { controller, elements } = setup();
  controller.setAvailable(false);
  assert.equal(elements.pill.hidden, true);
  controller.setAvailable(true);
  assert.equal(elements.pill.hidden, false);
});

test('그래프를 보는 중에 브레인이 꺼지면 요약으로 되돌린다', async () => {
  const { controller, elements } = setup();
  await controller.toggle();
  assert.equal(elements.graph.hidden, false);
  controller.setAvailable(false);
  assert.equal(elements.graph.hidden, true, '못 쓰는 화면에 머물지 않는다');
  assert.equal(elements.summary.hidden, false);
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
