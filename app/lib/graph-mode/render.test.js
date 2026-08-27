// render.js 단위 테스트 — Electron/브라우저 없이 최소 DOM 스텁으로 검증한다.
// history-badge.test.js와 같은 방식: jsdom을 들이지 않고 필요한 인터페이스만 흉내낸다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { layoutClusterMap } = require('./cluster-layout');
const { renderClusterMap, renderClusterBubbles, describeRendered, clusterHue } = require('./render');
const themeClusters = require('./theme-clusters');
const { fakeNode, installFakeDocument, uninstallFakeDocument } = require('./fake-dom');

// 최소 SVG 노드 스텁. `createElementNS`·`setAttribute`·`querySelectorAll`만 있으면 된다.
// renderClusterBubbles가 theme-clusters.js의 shouldWarnUnnamed를 재사용하므로
// (원칙1, render.js 주석 참고) theme-clusters.test.js와 같은 방식으로 window를 세운다.
test.beforeEach(() => {
  installFakeDocument();
  global.window = { AthenaLib: { ThemeClusters: themeClusters } };
});

test.afterEach(() => {
  uninstallFakeDocument();
  delete global.window;
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

// ── renderClusterBubbles(스텝10) — 그래프 뷰 1단계 아키텍처 전환 ──────────────

function mockPlaced(clusters) {
  return { revision: 1, nodes: [], edges: [], clusters };
}

function bubbles(svg) {
  return svg.querySelectorAll('.graph-cluster-bubble');
}

test('버블 개수는 클러스터 수와 같다', () => {
  const placed = mockPlaced([
    { cluster: 0, size: 3, x: 100, y: 120, radius: 40 },
    { cluster: 1, size: 2, x: 300, y: 220, radius: 30 },
  ]);
  const container = fakeNode('div');
  const svg = renderClusterBubbles(container, placed, { width: 800, height: 600 });
  assert.equal(bubbles(svg).length, 2);
});

test('좌표·반지름이 placed.clusters 값과 그대로 일치한다(새 스케일 발명 안 함, 원칙1)', () => {
  const placed = mockPlaced([{ cluster: 0, size: 5, x: 111, y: 222, radius: 58 }]);
  const container = fakeNode('div');
  const svg = renderClusterBubbles(container, placed, { width: 800, height: 600 });
  const bubble = bubbles(svg)[0];
  assert.equal(bubble.attrs.cx, '111');
  assert.equal(bubble.attrs.cy, '222');
  assert.equal(bubble.attrs.r, '58');
});

test('클릭 위임용 .graph-node에 data-cluster가 실린다(controller.js의 wireNodeClicks 재사용)', () => {
  const placed = mockPlaced([{ cluster: 3, size: 1, x: 1, y: 1, radius: 10 }]);
  const container = fakeNode('div');
  const svg = renderClusterBubbles(container, placed, { width: 800, height: 600 });
  const node = svg.querySelectorAll('.graph-node')[0];
  assert.equal(node.getAttribute('data-cluster'), '3');
});

test('cohesion이 있으면 alpha가 그 값에 단조 대응한다(직접 매핑)', () => {
  const placed = mockPlaced([
    { cluster: 0, size: 1, x: 1, y: 1, radius: 10, cohesion: 0.19 },
    { cluster: 1, size: 1, x: 1, y: 1, radius: 10, cohesion: 0.74 },
  ]);
  const container = fakeNode('div');
  const svg = renderClusterBubbles(container, placed, { width: 800, height: 600 });
  const [low, high] = bubbles(svg);
  assert.match(low.attrs.style, /fill-opacity: 0\.19/);
  assert.match(high.attrs.style, /fill-opacity: 0\.74/);
});

test('cohesion이 없으면(구버전 backend) 전 군집이 같은 대체 alpha를 쓴다', () => {
  const placed = mockPlaced([
    { cluster: 0, size: 1, x: 1, y: 1, radius: 10 },
    { cluster: 1, size: 4, x: 1, y: 1, radius: 20 },
  ]);
  const container = fakeNode('div');
  const svg = renderClusterBubbles(container, placed, { width: 800, height: 600 });
  const [a, b] = bubbles(svg);
  const alphaOf = (node) => node.attrs.style.match(/fill-opacity: ([\d.]+)/)[1];
  assert.equal(alphaOf(a), alphaOf(b), '군집 크기와 무관하게 동일 alpha(size 기준 상대값을 새로 발명하지 않는다)');
});

test('전 군집이 무명(0/N)이면 경고 스타일이 아니라 중립 스타일이다(§0 r5)', () => {
  const placed = mockPlaced([
    { cluster: 0, size: 1, x: 1, y: 1, radius: 10, name: null },
    { cluster: 1, size: 1, x: 1, y: 1, radius: 10, name: null },
  ]);
  const container = fakeNode('div');
  const svg = renderClusterBubbles(container, placed, { width: 800, height: 600 });
  assert.ok(bubbles(svg).every((b) => !String(b.attrs.class).includes('is-unnamed-warn')), '0/N이면 전부 중립');
  // "이름 없음" 배지 텍스트 자체는 이 임계 규칙과 무관하게 항상 표기한다(§0 정책).
  assert.equal(svg.querySelectorAll('.graph-cluster-unnamed-badge').length, 2);
});

test('부분 무명(0 < 이름 붙은 수 < 전체)이면 무명 군집에만 경고 스타일이 붙는다(§0 r5)', () => {
  const placed = mockPlaced([
    { cluster: 0, size: 1, x: 1, y: 1, radius: 10, name: '반도체' },
    { cluster: 1, size: 1, x: 1, y: 1, radius: 10, name: null },
  ]);
  const container = fakeNode('div');
  const svg = renderClusterBubbles(container, placed, { width: 800, height: 600 });
  const list = bubbles(svg);
  const named = list.find((b) => !String(b.attrs.class).includes('is-unnamed-warn'));
  const unnamed = list.find((b) => String(b.attrs.class).includes('is-unnamed-warn'));
  assert.ok(named, '이름 붙은 군집은 경고 스타일이 아니다');
  assert.ok(unnamed, '이름 없는 군집만 경고 스타일이다');
  assert.equal(svg.querySelectorAll('.graph-cluster-unnamed-badge').length, 1);
});

test('전 군집에 이름이 있으면(N/N) 경고 스타일이 아니다(§0 r5 — 보편 상태는 예외가 아니다)', () => {
  const placed = mockPlaced([
    { cluster: 0, size: 1, x: 1, y: 1, radius: 10, name: '반도체' },
    { cluster: 1, size: 1, x: 1, y: 1, radius: 10, name: '배당' },
  ]);
  const container = fakeNode('div');
  const svg = renderClusterBubbles(container, placed, { width: 800, height: 600 });
  assert.ok(bubbles(svg).every((b) => !String(b.attrs.class).includes('is-unnamed-warn')));
  assert.equal(svg.querySelectorAll('.graph-cluster-unnamed-badge').length, 0, '이름이 있으면 배지 자체가 없다');
});

test('빈 클러스터 목록도 터지지 않는다', () => {
  const container = fakeNode('div');
  const svg = renderClusterBubbles(container, mockPlaced([]), { width: 800, height: 600 });
  assert.equal(bubbles(svg).length, 0);
});

test('컨테이너가 없으면 조용히 넘어간다(renderClusterBubbles)', () => {
  assert.equal(renderClusterBubbles(null, mockPlaced([]), {}), null);
});

// ── 군집간 연결선 3종 + 범례(스텝11) ────────────────────────────────────────

function edgesOf(svg) {
  return svg.querySelectorAll('.graph-cluster-edge');
}

test('군집간 연결선이 먼저, 버블이 나중에 그려진다(엣지가 버블에 가리지 않는다)', () => {
  const placed = mockPlaced([
    { cluster: 0, size: 1, x: 100, y: 100, radius: 40 },
    { cluster: 1, size: 1, x: 300, y: 100, radius: 30 },
  ]);
  placed.clusterEdges = [{ from: 0, to: 1, x1: 100, y1: 100, x2: 300, y2: 100, count: 1, isSurprising: false }];
  const container = fakeNode('div');
  const svg = renderClusterBubbles(container, placed, { width: 800, height: 600 });
  const layerClasses = svg.children.map((c) => c.attrs.class);
  assert.deepEqual(layerClasses, ['graph-cluster-edges', 'graph-cluster-bubbles']);
});

test('평범한 군집 쌍은 실선(별도 클래스 없음)이고 count가 클수록 굵어진다(단조 증가)', () => {
  const placed = mockPlaced([
    { cluster: 0, size: 1, x: 0, y: 0, radius: 10 },
    { cluster: 1, size: 1, x: 100, y: 0, radius: 10 },
  ]);
  placed.clusterEdges = [
    { from: 0, to: 1, x1: 0, y1: 0, x2: 100, y2: 0, count: 1, isSurprising: false },
  ];
  const svgThin = renderClusterBubbles(fakeNode('div'), placed, { width: 800, height: 600 });
  placed.clusterEdges[0].count = 6;
  const svgThick = renderClusterBubbles(fakeNode('div'), placed, { width: 800, height: 600 });

  const widthOf = (svg) => Number(edgesOf(svg)[0].attrs.style.match(/stroke-width: ([\d.]+)px/)[1]);
  assert.ok(widthOf(svgThick) > widthOf(svgThin), 'count가 클수록 굵다');
  const e = edgesOf(svgThin)[0];
  assert.equal(String(e.attrs.class).includes('is-hidden-link'), false);
  assert.equal(String(e.attrs.class).includes('is-unnamed-warn'), false);
});

test('surprising-connections와 겹치는 군집 쌍은 핑크 점선(is-hidden-link)이다', () => {
  const placed = mockPlaced([
    { cluster: 0, size: 1, x: 0, y: 0, radius: 10 },
    { cluster: 1, size: 1, x: 100, y: 0, radius: 10 },
  ]);
  placed.clusterEdges = [{ from: 0, to: 1, x1: 0, y1: 0, x2: 100, y2: 0, count: 1, isSurprising: true }];
  const svg = renderClusterBubbles(fakeNode('div'), placed, { width: 800, height: 600 });
  assert.ok(String(edgesOf(svg)[0].attrs.class).includes('is-hidden-link'));
});

test('0/N(전부 무명)이면 이름 없는 군집 관련 엣지도 주황이 아니라 실선으로 렌더된다(§0 r5)', () => {
  const placed = mockPlaced([
    { cluster: 0, size: 1, x: 0, y: 0, radius: 10, name: null },
    { cluster: 1, size: 1, x: 100, y: 0, radius: 10, name: null },
  ]);
  placed.clusterEdges = [{ from: 0, to: 1, x1: 0, y1: 0, x2: 100, y2: 0, count: 1, isSurprising: false }];
  const svg = renderClusterBubbles(fakeNode('div'), placed, { width: 800, height: 600 });
  assert.equal(String(edgesOf(svg)[0].attrs.class).includes('is-unnamed-warn'), false, '0/N이면 3번째 종류를 아예 안 그린다');
});

test('부분 무명일 때만 무명 군집이 걸린 엣지가 주황 점선(is-unnamed-warn)이다(§0 r5)', () => {
  const placed = mockPlaced([
    { cluster: 0, size: 1, x: 0, y: 0, radius: 10, name: '반도체' },
    { cluster: 1, size: 1, x: 100, y: 0, radius: 10, name: null },
  ]);
  placed.clusterEdges = [{ from: 0, to: 1, x1: 0, y1: 0, x2: 100, y2: 0, count: 1, isSurprising: false }];
  const svg = renderClusterBubbles(fakeNode('div'), placed, { width: 800, height: 600 });
  assert.ok(String(edgesOf(svg)[0].attrs.class).includes('is-unnamed-warn'));
});

test('숨은 연관이면서 동시에 무명 군집도 걸려 있으면 핑크가 우선한다', () => {
  const placed = mockPlaced([
    { cluster: 0, size: 1, x: 0, y: 0, radius: 10, name: '반도체' },
    { cluster: 1, size: 1, x: 100, y: 0, radius: 10, name: null },
  ]);
  placed.clusterEdges = [{ from: 0, to: 1, x1: 0, y1: 0, x2: 100, y2: 0, count: 1, isSurprising: true }];
  const svg = renderClusterBubbles(fakeNode('div'), placed, { width: 800, height: 600 });
  const cls = String(edgesOf(svg)[0].attrs.class);
  assert.ok(cls.includes('is-hidden-link'));
  assert.equal(cls.includes('is-unnamed-warn'), false);
});

test('clusterEdges가 없으면(구버전 배치) 엣지 레이어가 비어 있을 뿐 안 터진다', () => {
  const placed = mockPlaced([{ cluster: 0, size: 1, x: 0, y: 0, radius: 10 }]);
  const svg = renderClusterBubbles(fakeNode('div'), placed, { width: 800, height: 600 });
  assert.equal(edgesOf(svg).length, 0);
});

// ── 범례 — 실제로 쓰인 시각 언어만 설명한다(§0 정직한 데이터 정책) ──────────────

function legendOf(container) {
  return container.querySelectorAll('.graph-cluster-legend-item');
}

test('cohesion이 하나도 없으면 "채움 진하기 = 응집도" 항목이 안 뜬다', () => {
  const placed = mockPlaced([{ cluster: 0, size: 1, x: 0, y: 0, radius: 10 }]); // cohesion 없음
  const container = fakeNode('div');
  renderClusterBubbles(container, placed, { width: 800, height: 600 });
  const texts = legendOf(container).map((item) => item.textContent);
  assert.ok(!texts.some((t) => t.includes('응집도')));
  assert.ok(texts.some((t) => t.includes('구성원 수')), '원 크기 항목은 군집이 있으면 항상 뜬다');
});

test('cohesion이 하나라도 있으면 "채움 진하기 = 응집도" 항목이 뜬다', () => {
  const placed = mockPlaced([{ cluster: 0, size: 1, x: 0, y: 0, radius: 10, cohesion: 0.5 }]);
  const container = fakeNode('div');
  renderClusterBubbles(container, placed, { width: 800, height: 600 });
  assert.ok(legendOf(container).map((item) => item.textContent).some((t) => t.includes('응집도')));
});

test('숨은 연관 stroke가 실제로 그려졌을 때만 "숨은 연관" 범례 항목이 뜬다', () => {
  const placed = mockPlaced([
    { cluster: 0, size: 1, x: 0, y: 0, radius: 10 },
    { cluster: 1, size: 1, x: 100, y: 0, radius: 10 },
  ]);
  const container = fakeNode('div');
  renderClusterBubbles(container, placed, { width: 800, height: 600 });
  assert.ok(!legendOf(container).map((item) => item.textContent).some((t) => t.includes('숨은 연관')));

  placed.clusterEdges = [{ from: 0, to: 1, x1: 0, y1: 0, x2: 100, y2: 0, count: 1, isSurprising: true }];
  const container2 = fakeNode('div');
  renderClusterBubbles(container2, placed, { width: 800, height: 600 });
  assert.ok(legendOf(container2).map((item) => item.textContent).some((t) => t.includes('숨은 연관')));
});

test('r5 임계 규칙이 켜져 있을 때만(부분 무명) "점선 = 확인 필요" 범례 항목이 뜬다', () => {
  const allUnnamed = mockPlaced([
    { cluster: 0, size: 1, x: 0, y: 0, radius: 10, name: null },
    { cluster: 1, size: 1, x: 100, y: 0, radius: 10, name: null },
  ]);
  const container = fakeNode('div');
  renderClusterBubbles(container, allUnnamed, { width: 800, height: 600 });
  assert.ok(!legendOf(container).map((item) => item.textContent).some((t) => t.includes('확인 필요')));

  const partial = mockPlaced([
    { cluster: 0, size: 1, x: 0, y: 0, radius: 10, name: '반도체' },
    { cluster: 1, size: 1, x: 100, y: 0, radius: 10, name: null },
  ]);
  const container2 = fakeNode('div');
  renderClusterBubbles(container2, partial, { width: 800, height: 600 });
  assert.ok(legendOf(container2).map((item) => item.textContent).some((t) => t.includes('확인 필요')));
});

test('클러스터가 하나도 없으면 범례 자체를 안 그린다', () => {
  const container = fakeNode('div');
  renderClusterBubbles(container, mockPlaced([]), { width: 800, height: 600 });
  assert.equal(container.querySelector('.graph-cluster-legend'), null);
});
