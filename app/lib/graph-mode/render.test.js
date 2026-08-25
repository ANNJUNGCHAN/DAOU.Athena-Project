// render.js 단위 테스트 — Electron/브라우저 없이 최소 DOM 스텁으로 검증한다.
// history-badge.test.js와 같은 방식: jsdom을 들이지 않고 필요한 인터페이스만 흉내낸다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { layoutClusterMap } = require('./cluster-layout');
const { renderClusterMap, describeRendered, clusterHue } = require('./render');
const { fakeNode, installFakeDocument, uninstallFakeDocument } = require('./fake-dom');

// 최소 SVG 노드 스텁. `createElementNS`·`setAttribute`·`querySelectorAll`만 있으면 된다.
test.beforeEach(() => {
  installFakeDocument();
});

test.afterEach(() => {
  uninstallFakeDocument();
});

const VIEWPORT = { width: 800, height: 600 };

function payload() {
  return {
    revision: 4,
    nodes: [
      { entity_id: 'e:a', name: '반도체', kind: 'theme', cluster: 0, degree: 3 },
      { entity_id: 'e:b', name: '장비', kind: 'company', cluster: 0, degree: 1 },
      { entity_id: 'e:c', name: '고배당', kind: 'theme', cluster: 1, degree: 2 },
    ],
    edges: [
      ['e:a', 'e:b'],
      ['e:a', 'e:c'],
    ],
  };
}

function render(options) {
  const container = fakeNode('div');
  container.clientWidth = VIEWPORT.width;
  container.clientHeight = VIEWPORT.height;
  const layout = layoutClusterMap(payload(), VIEWPORT);
  renderClusterMap(container, layout, options);
  return container;
}

test('노드와 엣지가 SVG로 그려진다', () => {
  const summary = describeRendered(render());
  assert.equal(summary.rendered, true);
  assert.equal(summary.nodes, 3);
  assert.equal(summary.edges, 2);
});

test('빈 캔버스가 아님을 같은 함수로 판정한다', () => {
  // verify.js와 캔버스가 "비어 있지 않은가"를 각자 정의하면 하나가 거짓말할 수 있다.
  const empty = fakeNode('div');
  assert.deepEqual(describeRendered(empty), {
    rendered: false,
    nodes: 0,
    edges: 0,
    labels: 0,
  });
});

test('군집 경계를 넘는 엣지가 표시된다', () => {
  const container = render();
  const svg = container.querySelector('svg.graph-canvas');
  const crossing = svg
    .querySelectorAll('graph-edge')
    .filter((e) => String(e.attrs.class).includes('is-crossing'));
  assert.equal(crossing.length, 1, 'e:a-e:c 하나가 군집을 넘는다');
});

test('강조를 끄면 crossing 표시가 사라진다', () => {
  const container = render({ highlightCrossings: false });
  const svg = container.querySelector('svg.graph-canvas');
  const crossing = svg
    .querySelectorAll('graph-edge')
    .filter((e) => String(e.attrs.class).includes('is-crossing'));
  assert.equal(crossing.length, 0);
});

test('이름표를 끄면 text가 안 생긴다', () => {
  // 노드가 많으면 글자가 겹쳐 읽을 수 없다 — graph-mode-prefs의 labelThreshold가 이걸 정한다.
  assert.equal(describeRendered(render({ showLabels: true })).labels, 3);
  assert.equal(describeRendered(render({ showLabels: false })).labels, 0);
});

test('엣지가 노드보다 먼저 그려진다', () => {
  // SVG는 뒤에 그린 것이 위로 온다. 순서가 뒤집히면 노드가 선에 가려진다.
  const svg = render().querySelector('svg.graph-canvas');
  const layerClasses = svg.children.map((c) => c.attrs.class);
  assert.deepEqual(layerClasses, ['graph-edges', 'graph-nodes']);
});

test('다시 그리면 이전 내용을 지운다', () => {
  const container = render();
  const layout = layoutClusterMap(payload(), VIEWPORT);
  renderClusterMap(container, layout, {});
  assert.equal(container.children.length, 1, 'SVG가 쌓이지 않는다');
  assert.equal(describeRendered(container).nodes, 3);
});

test('군집 색이 결정적이다', () => {
  // 백엔드가 군집 번호를 크기 순으로 결정적으로 매기므로 색도 결정적이어야 한다.
  assert.equal(clusterHue(0), clusterHue(0));
  assert.notEqual(clusterHue(0), clusterHue(1));
  // 배정이 없는 노드(-1)도 터지지 않는다.
  assert.equal(typeof clusterHue(-1), 'number');
  assert.equal(typeof clusterHue(undefined), 'number');
});

test('접근성 요약이 붙는다', () => {
  const svg = render().querySelector('svg.graph-canvas');
  assert.equal(svg.attrs.role, 'img');
  assert.match(svg.attrs['aria-label'], /노드 3개, 연결 2개/);
});

test('빈 그래프도 터지지 않는다', () => {
  const container = fakeNode('div');
  container.clientWidth = VIEWPORT.width;
  container.clientHeight = VIEWPORT.height;
  renderClusterMap(container, layoutClusterMap({ nodes: [], edges: [] }, VIEWPORT), {});
  const summary = describeRendered(container);
  assert.equal(summary.rendered, true, 'SVG 자체는 만든다 — 빈 화면과 고장을 구분해야 한다');
  assert.equal(summary.nodes, 0);
});

test('컨테이너가 없으면 조용히 넘어간다', () => {
  assert.equal(renderClusterMap(null, layoutClusterMap(payload(), VIEWPORT), {}), null);
});
