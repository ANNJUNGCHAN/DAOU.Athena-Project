// controller.js 단위 테스트 — 의존을 전부 주입하므로 Electron이 필요 없다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const store = require('./graph-mode-store');
const layout = require('./cluster-layout');
const render = require('./render');
const themeClusters = require('./theme-clusters');
const prefs = require('./graph-mode-prefs');
const { createGraphModeController, computeGraphHeaderMeta, formatEventDate, buildTimelineRows } = require('./controller');
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
    summary: fakeNode('div'),
    // graph(가시성 전용)와 graphBody(렌더/측정/클릭위임 전용)를 별개 노드로 둔다 —
    // 스텝0-2 소유권 분리를 fake-dom에서도 그대로 흉내낸다.
    graph: fakeNode('div'),
    graphBody: fakeNode('div'),
    summaryTable: fakeNode('div'),
    agent: fakeNode('div'),
    plugin: fakeNode('div'),
    backtest: fakeNode('div'), // D4 — 5번째 모드 표면.
    kiumi: fakeNode('div'),
    canvasRegion: fakeNode('main'),
    chatHead: fakeNode('div'),
    graphHeaderMeta: fakeNode('span'),
    mapGuide: fakeNode('div'),
  };
  elements.kiumi.dataset = {};
  elements.canvasRegion.dataset = {};
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
    onPanelCta: opts.onPanelCta,
    getSurprisingConnections: opts.getSurprisingConnections,
    getProfileSummaryEntries: opts.getProfileSummaryEntries,
    fetchEntityTimeline: opts.fetchEntityTimeline,
  });
  // 대부분의 테스트는 브레인이 켜져 있다고 가정한다 — 꺼진 채 시작하고 싶은
  // 테스트만 opts.available: false를 넘긴다.
  if (opts.available !== false) controller.setAvailable(true);
  return { controller, elements, fetchCalls: () => calls };
}

// render.js의 renderClusterBubbles(스텝10)가 theme-clusters.js의 shouldWarnUnnamed를
// 재사용하므로(원칙1) render.test.js/theme-clusters.test.js와 같은 방식으로 window를 세운다.
test.beforeEach(() => {
  installFakeDocument();
  global.window = { AthenaLib: { ThemeClusters: themeClusters } };
});

test.afterEach(() => {
  uninstallFakeDocument();
  delete global.window;
});

test('처음에는 요약이 보이고 그래프는 숨겨져 있다', () => {
  const { controller, elements } = setup();
  controller.applyVisibility();
  assert.equal(elements.summary.hidden, false);
  assert.equal(elements.graph.hidden, true);
  assert.equal(elements.summaryTable.hidden, true, '성향 신호 표도 그래프 표면이다 — 답변 모드에선 숨는다');
});

// US-007 — 부팅 시 그래프/답변 모드가 섞여 보이던 실사용 결함의 회귀 가드.
// 근본 원인은 canvas.js가 summaryTable의 hidden을 브레인 ready 여부로
// 독자적으로 건드려서 소유자가 둘이 됐던 것 — 이 테스트는 applyVisibility()
// 하나가 소유자임을 못박는다. 브레인이 이미 켜진(available:true) 상태에서도
// 그래프로 토글하지 않는 한 그래프 표면은 전무해야 한다.
test('US-007: 브레인이 켜져 있어도 그래프로 토글하기 전엔 그래프 표면이 전무하다', () => {
  const { controller, elements } = setup({ available: true });
  controller.applyVisibility();
  assert.equal(elements.graph.hidden, true);
  assert.equal(elements.summaryTable.hidden, true);
  assert.equal(elements.summary.hidden, false);
});

test('토글하면 캔버스 영역이 그래프 기능으로 바뀌고, 기본 서브뷰는 요약 표다(스텝2-보정)', async () => {
  const { controller, elements } = setup();
  await controller.toggle();
  assert.equal(elements.summary.hidden, true, '요약이 숨는다');
  assert.equal(elements.graph.hidden, true, '기본 서브뷰는 요약이라 지도는 아직 숨어 있다');
  assert.equal(elements.summaryTable.hidden, false, '그래프 모드에선 성향 신호 표가 기본으로 보인다');
});

test('setSurface(지도)로 전환하면 군집 지도가 보이고 그려진다, 요약 표면은 숨는다', async () => {
  const { controller, elements } = setup();
  await controller.toggle();
  await controller.setSurface(store.SURFACE_MAP);
  assert.equal(elements.graph.hidden, false);
  assert.equal(elements.summaryTable.hidden, true, '지도로 전환하면 요약 표면은 숨는다(두 표면 동시 노출 금지)');
  assert.equal(render.describeRendered(elements.graphBody).nodes, 2);
});

test('setSurface(같은 값)는 아무 일도 안 한다(불필요한 재렌더 방지)', async () => {
  const { controller, elements } = setup();
  await controller.toggle();
  const result = await controller.setSurface(store.SURFACE_SUMMARY); // 이미 기본값
  assert.equal(result, null);
  assert.equal(elements.graph.hidden, true);
});

test('브레인 응답이 요약 서브뷰를 보는 중에 도착해도, 지도로 전환하면 그 시점 치수로 다시 그린다', async () => {
  // 실측: #graphCanvas가 hidden인 동안엔 그 안의 elements.graphBody.clientWidth/
  // Height가 실제로 0이다 — fake-dom은 이걸 재현 안 하니(고정 800×600) 직접 흉내낸다.
  const { controller, elements, fetchCalls } = setup({ available: false });
  await controller.toggle(); // 기본 surface='summary' — 지도는 숨어 있다.
  elements.graphBody.clientWidth = 0;
  elements.graphBody.clientHeight = 0;
  await controller.setAvailable(true); // 브레인이 요약 서브뷰를 보는 중에 켜졌다.
  assert.equal(fetchCalls(), 1);

  elements.graphBody.clientWidth = 400; // 지도로 전환되며 실제 치수가 잡혔다.
  elements.graphBody.clientHeight = 300;
  await controller.setSurface(store.SURFACE_MAP);
  assert.equal(fetchCalls(), 2, '지도로 전환하면 강제로 다시 그려 최신 치수를 반영한다(redrawFromCache는 좌표만 재필터링해 치수 문제를 못 고친다)');
  assert.equal(elements.graph.hidden, false);
  assert.equal(render.describeRendered(elements.graphBody).nodes, 2, '0×0이 아니라 실제로 노드가 그려진다');
});

test('다시 토글하면 요약으로 돌아오고 그래프 표면은 완전히 숨는다', async () => {
  const { controller, elements } = setup();
  await controller.toggle();
  await controller.toggle();
  assert.equal(elements.summary.hidden, false);
  assert.equal(elements.graph.hidden, true);
  assert.equal(elements.summaryTable.hidden, true, '반대 모드 표면(요약 표 포함)이 완전히 숨는다');
});

test('리비전이 그대로면 다시 그리지 않는다', async () => {
  // 같은 그림을 다시 그리면 SVG가 통째로 교체되어 화면이 깜빡인다.
  const { controller, elements } = setup();
  await controller.toggle();
  const svgBefore = elements.graphBody.children[0];
  const redrawn = await controller.refresh();
  assert.equal(redrawn, null, '다시 그리지 않았다');
  assert.equal(elements.graphBody.children[0], svgBefore, '같은 SVG가 그대로 있다');
});

test('리비전이 바뀌면 다시 그린다', async () => {
  const { controller } = setup({ revisions: [7, 8] });
  await controller.toggle();
  const redrawn = await controller.refresh();
  assert.notEqual(redrawn, null, '새 리비전이면 다시 그린다');
});

test('백엔드가 죽어도 지도 헤더를 남기고 요약↔지도로 왕복할 수 있다', async () => {
  const seen = [];
  const { controller, elements } = setup({ fail: true, onError: (e) => seen.push(e) });
  await controller.toggle();
  await controller.setSurface(store.SURFACE_MAP);
  assert.equal(controller.state.view, store.VIEW_GRAPH, '요청 실패가 상위 그래프 모드를 닫지 않는다');
  assert.equal(controller.state.surface, store.SURFACE_MAP);
  assert.equal(elements.graph.hidden, false, '지도 헤더와 요약 탭을 눌러야 한다');
  assert.equal(elements.summary.hidden, true, '대화 요약 표면으로 잘못 탈출하지 않는다');
  assert.equal(elements.summaryTable.hidden, true);
  assert.match(elements.graphBody.children[0].textContent, /불러오지 못했습니다/);
  assert.equal(seen.length, 2, '요약 선행 로드와 지도 진입 실패를 모두 삼키지 않는다');

  await controller.setSurface(store.SURFACE_SUMMARY);
  assert.equal(elements.graph.hidden, true);
  assert.equal(elements.summaryTable.hidden, false, '눈에 보이는 요약 탭으로 돌아간다');

  await controller.setSurface(store.SURFACE_MAP);
  assert.equal(elements.graph.hidden, false, '요약에서 지도로도 다시 전환한다');
  assert.equal(seen.length, 3, '재진입 실패도 오류 경로에 전달한다');
});

test('그래프 오류 안내는 #graphBody 안에만 배치되어 헤더 클릭 영역을 덮지 않는다', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'canvas.css'), 'utf8');
  const graphBodyRule = css.match(/#graphBody\s*\{([^}]*)\}/);
  const unavailableRule = css.match(/\.graph-mode-unavailable\s*\{([^}]*)\}/);
  assert.ok(graphBodyRule, '#graphBody 규칙이 있다');
  assert.match(graphBodyRule[1], /position\s*:\s*relative\s*;/, '절대 배치 안내의 containing block이다');
  assert.ok(unavailableRule, '그래프 오류 안내 규칙이 있다');
  assert.match(unavailableRule[1], /position\s*:\s*absolute\s*;/);
  assert.match(unavailableRule[1], /inset\s*:\s*0\s*;/, '안내는 #graphBody 범위만 채운다');
});

test('브레인이 안 됐을 때 지도 서브뷰로 전환하면 캔버스 안에 정직한 안내가 뜬다', async () => {
  // 빈 그래프를 그냥 띄우면 "성향이 없다"로 읽힌다 — 없는 것과 못 읽은 것은 다르다.
  // 그렇다고 모드 진입 자체를 막지도 않는다(예전엔 필이 숨어서 못 들어왔다).
  const { controller, elements, fetchCalls } = setup({ available: false });
  await controller.toggle();
  assert.equal(elements.summary.hidden, true, '그래프 모드 자체는 열린다');
  await controller.setSurface(store.SURFACE_MAP);
  assert.equal(elements.graph.hidden, false);
  assert.equal(fetchCalls(), 0, '못 쓴다는 걸 이미 아니까 왕복하지 않는다');
  assert.match(elements.graphBody.children[0].textContent, /브레인|성향/);
});

test('지도를 보는 중에 브레인이 꺼지면 화면 안에서 안내로 바뀐다(요약으로 쫓겨나지 않는다)', async () => {
  const { controller, elements } = setup();
  await controller.toggle();
  await controller.setSurface(store.SURFACE_MAP);
  assert.equal(elements.graph.hidden, false);
  const svgBefore = elements.graphBody.children[0];
  controller.setAvailable(false);
  assert.equal(elements.graph.hidden, false, '지도 서브뷰에 그대로 머문다');
  assert.equal(elements.summary.hidden, true);
  assert.notEqual(elements.graphBody.children[0], svgBefore, '그림 대신 안내로 바뀐다');
});

test('그래프를 못 쓰다가 브레인이 켜지면 안내 대신 실제로 그린다', async () => {
  const { controller, elements, fetchCalls } = setup({ available: false });
  await controller.toggle();
  assert.equal(fetchCalls(), 0);
  await controller.setAvailable(true);
  assert.equal(fetchCalls(), 1);
  assert.equal(render.describeRendered(elements.graphBody).nodes, 2);
});

test('설정이 이름표 임계를 정한다(2단계 개별 노드 렌더에 적용 — 1단계 버블은 항상 이름표를 보인다, 스텝10)', async () => {
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
  const { controller, elements } = setup({ prefs: boundPrefs, payload: payloadTwoClusters });
  await controller.toggle();
  const clusterZeroBubble = elements.graphBody.querySelectorAll('.graph-node')
    .find((n) => n.getAttribute('data-cluster') === '0');
  clusterZeroBubble.dispatchEvent({ type: 'click' }); // 2단계로 — cluster 0엔 노드 2개(e:a, e:b)
  // 노드가 2개인데 임계가 1이므로 이름표가 안 붙는다.
  assert.equal(render.describeRendered(elements.graphBody).labels, 0);
});

test('요약 화면에서는 백엔드를 부르지 않는다', async () => {
  const { controller, fetchCalls } = setup();
  await controller.refresh();
  assert.equal(fetchCalls(), 0, '안 보이는 화면 때문에 왕복하지 않는다');
});

// ── 보드 15: 군집 펼침 · 노드 선택 와이어링 ──────────────────────────────────

test('1단계에서 버블을 클릭하면 그 군집이 펼쳐진다(스텝10 — 1단계는 군집 버블 집계다)', async () => {
  const { controller, elements, fetchCalls } = setup({ payload: payloadTwoClusters });
  await controller.toggle();
  assert.equal(controller.state.stage, store.STAGE_CLUSTERS);
  const nodeEls = elements.graphBody.querySelectorAll('.graph-node');
  assert.equal(nodeEls.length, 2, '1단계는 군집 버블 수만큼 보인다(개별 엔티티가 아니다)');
  const clusterZeroBubble = nodeEls.find((n) => n.getAttribute('data-cluster') === '0');
  clusterZeroBubble.dispatchEvent({ type: 'click' });
  assert.equal(controller.state.stage, store.STAGE_EXPANDED);
  assert.equal(controller.state.expandedCluster, 0);
  assert.equal(fetchCalls(), 1, '펼침은 새 fetch 없이 캐시로 다시 그린다');
  const afterExpand = elements.graphBody.querySelectorAll('.graph-node');
  assert.deepEqual(afterExpand.map((n) => n.getAttribute('data-entity-id')).sort(), ['e:a', 'e:b']);
});

test('2단계에서 노드를 클릭하면 선택된다(패널이 채워진다)', async () => {
  const { controller, elements } = setup({ payload: payloadTwoClusters, withPanel: true });
  await controller.toggle();
  const clusterZeroBubble = elements.graphBody.querySelectorAll('.graph-node')
    .find((n) => n.getAttribute('data-cluster') === '0');
  clusterZeroBubble.dispatchEvent({ type: 'click' }); // 1단계 버블 클릭 — 펼친다
  assert.equal(controller.state.stage, store.STAGE_EXPANDED);

  const secondClick = elements.graphBody.querySelectorAll('.graph-node')
    .find((n) => n.getAttribute('data-entity-id') === 'e:b');
  secondClick.dispatchEvent({ type: 'click' }); // 2단계 클릭 — 고른다
  assert.equal(controller.state.selectedEntityId, 'e:b');
  assert.equal(controller.state.panel.name, '장비');
  assert.equal(elements.panel.hidden, false);
  assert.match(elements.panel.textContent, /장비/);
});

// ── 공통 패널 콘텐츠(보드 07 §10, 스텝8) ─────────────────────────────────────

function tablePanelData(overrides) {
  return {
    entityId: 'e:samsung', name: '삼성전자', kind: 'stock', relation: '보유',
    rationale: '체결 4건 · 평균 71,200원', reinforcement: 12,
    confidence: 'EXTRACTED', tier: 'deterministic',
    ...overrides,
  };
}

test('패널 탭 — "성향"(활성)·"이력"(비활성)이 둘 다 그려진다', () => {
  const { controller, elements } = setup({ withPanel: true });
  controller.selectEntity('e:samsung', tablePanelData());
  const tabs = elements.panel.querySelectorAll('.panel-tab');
  assert.equal(tabs.length, 2);
  assert.equal(tabs[0].textContent, '성향');
  assert.equal(tabs[0].classList.contains('is-active'), true);
  assert.equal(tabs[1].textContent, '이력');
  assert.equal(tabs[1].classList.contains('is-active'), false);
});

test('패널 탭 — "이력" 탭은 클릭해도 전환 없다(Paper에 콘텐츠 스펙 없음, §6 범위 밖)', () => {
  const { controller, elements } = setup({ withPanel: true });
  controller.selectEntity('e:samsung', tablePanelData());
  const historyTab = elements.panel.querySelectorAll('.panel-tab')[1];
  assert.doesNotThrow(() => historyTab.dispatchEvent({ type: 'click' }));
  // 클릭 핸들러 자체가 없다 — 활성 탭·패널 내용이 그대로다.
  const traitTab = elements.panel.querySelectorAll('.panel-tab')[0];
  assert.equal(traitTab.classList.contains('is-active'), true);
});

test('패널 탭 — "선택 해제" 클릭 시 clearSelection과 같은 결과(패널이 닫힌다)', () => {
  const { controller, elements } = setup({ withPanel: true });
  controller.selectEntity('e:samsung', tablePanelData());
  const deselect = elements.panel.querySelector('.panel-deselect');
  deselect.dispatchEvent({ type: 'click' });
  assert.equal(controller.state.selectedEntityId, null);
  assert.equal(elements.panel.hidden, true);
});

test('선택 헤더 — 이름·kind 배지·보강 횟수를 그린다', () => {
  const { controller, elements } = setup({ withPanel: true });
  controller.selectEntity('e:samsung', tablePanelData());
  const name = elements.panel.querySelector('.panel-name');
  assert.equal(name.textContent, '삼성전자');
  const kindBadge = elements.panel.querySelector('.panel-kind-badge');
  assert.equal(kindBadge.textContent, 'stock');
  const row2 = elements.panel.querySelector('.panel-header-row2');
  assert.equal(row2.textContent, '보강 12회');
});

test('티어 대조 카드 — tier를 한글로, confidence를 배지로, rationale을 본문으로 그린다', () => {
  const { controller, elements } = setup({ withPanel: true });
  controller.selectEntity('e:samsung', tablePanelData({ tier: 'conversational', confidence: 'INFERRED' }));
  const label = elements.panel.querySelector('.panel-tier-label');
  assert.equal(label.textContent, '대화');
  const confBadge = elements.panel.querySelector('.panel-tier-confidence');
  assert.equal(confBadge.textContent, '추론');
  const body = elements.panel.querySelector('.panel-tier-body');
  assert.equal(body.textContent, '체결 4건 · 평균 71,200원');
});

test('티어 대조 카드 — rationale/tier/confidence가 전부 없으면(그래프 노드 선택) 카드를 안 그린다', () => {
  const { controller, elements } = setup({ payload: payloadTwoClusters, withPanel: true });
  controller.selectEntity('e:x', { name: '이름만' }); // 그래프 노드 선택 경로와 같은 얕은 데이터
  assert.equal(elements.panel.querySelector('.panel-tier-card'), null);
});

test('CTA "채팅에서 답하기" 클릭 시 onPanelCta가 불린다', () => {
  let called = 0;
  const { controller, elements } = setup({ withPanel: true, onPanelCta: () => { called += 1; } });
  controller.selectEntity('e:samsung', tablePanelData());
  const cta = elements.panel.querySelector('.panel-cta');
  assert.equal(cta.textContent, '채팅에서 답하기');
  cta.dispatchEvent({ type: 'click' });
  assert.equal(called, 1);
});

test('§10-4 최근 변화 — 데이터가 없어 섹션 자체를 안 그린다(§0 정책)', () => {
  const { controller, elements } = setup({ withPanel: true });
  controller.selectEntity('e:samsung', tablePanelData());
  assert.equal(elements.panel.querySelector('.panel-recent-changes'), null);
});

test('panel 요소가 없으면 선택 상태는 바뀌지만 조용히 넘어간다', async () => {
  const { controller, elements } = setup({ payload: payloadTwoClusters });
  await controller.toggle();
  const node = elements.graphBody.querySelectorAll('.graph-node')[0];
  assert.doesNotThrow(() => node.dispatchEvent({ type: 'click' }));
});

test('collapseCluster()로 2단계에서 1단계로 돌아간다', async () => {
  const { controller, elements } = setup({ payload: payloadTwoClusters });
  await controller.toggle();
  elements.graphBody.querySelectorAll('.graph-node')[0].dispatchEvent({ type: 'click' });
  assert.equal(controller.state.stage, store.STAGE_EXPANDED);
  controller.collapseCluster();
  assert.equal(controller.state.stage, store.STAGE_CLUSTERS);
  assert.equal(elements.graphBody.querySelectorAll('.graph-node').length, 2, '군집 버블이 전부 다시 보인다(스텝10)');
});

// ── 그래프 뷰 헤더 메타 텍스트 + 지도 안내 바(보드 14/15, 스텝9) ────────────────

test('computeGraphHeaderMeta — 1단계(clusters): "군집 N개 · 엔티티 M · 미분류 K"', () => {
  const placed = { nodes: [{ cluster: 0 }, { cluster: 0 }, { cluster: -1 }], clusters: [{ cluster: 0 }] };
  const meta = computeGraphHeaderMeta('clusters', { nodes: [1, 2, 3], edges: [1, 2] }, placed);
  assert.equal(meta, '군집 1개 · 엔티티 3 · 미분류 1');
});

test('computeGraphHeaderMeta — 2단계(expanded): "엔티티 M · 관계 E · 군집 N"(관계는 필터 전 원본)', () => {
  const placed = { nodes: [{ cluster: 0 }, { cluster: 1 }], clusters: [{ cluster: 0 }, { cluster: 1 }] };
  const meta = computeGraphHeaderMeta('expanded', { nodes: [1, 2, 3], edges: [1, 2, 3, 4] }, placed);
  assert.equal(meta, '엔티티 3 · 관계 4 · 군집 2');
});

test('computeGraphHeaderMeta — payload/placed가 없으면 빈 문자열(지어내지 않는다)', () => {
  assert.equal(computeGraphHeaderMeta('clusters', null, null), '');
  assert.equal(computeGraphHeaderMeta('clusters', { nodes: [] }, null), '');
});

test('그래프 진입(1단계) 시 헤더 메타가 "군집 N개 · 엔티티 M · 미분류 K"로 채워지고 지도 안내 바가 보인다', async () => {
  const { controller, elements } = setup({ payload: payloadTwoClusters });
  await controller.toggle();
  assert.equal(elements.graphHeaderMeta.textContent, '군집 2개 · 엔티티 3 · 미분류 0');
  assert.equal(elements.mapGuide.hidden, false, '1단계에서는 지도 안내 바가 보인다');
});

test('군집을 펼치면(2단계) 헤더 메타가 "엔티티 M · 관계 E · 군집 N"으로 바뀌고 지도 안내 바가 숨는다', async () => {
  const { controller, elements } = setup({ payload: payloadTwoClusters });
  await controller.toggle();
  elements.graphBody.querySelectorAll('.graph-node')[0].dispatchEvent({ type: 'click' });
  assert.equal(controller.state.stage, store.STAGE_EXPANDED);
  assert.equal(elements.graphHeaderMeta.textContent, '엔티티 3 · 관계 1 · 군집 2');
  assert.equal(elements.mapGuide.hidden, true, '2단계에서는 지도 안내 바가 사라진다');
});

test('collapseCluster()로 1단계로 돌아오면 헤더 메타·지도 안내 바가 원래대로 돌아온다', async () => {
  const { controller, elements } = setup({ payload: payloadTwoClusters });
  await controller.toggle();
  elements.graphBody.querySelectorAll('.graph-node')[0].dispatchEvent({ type: 'click' });
  controller.collapseCluster();
  assert.equal(controller.state.stage, store.STAGE_CLUSTERS);
  assert.equal(elements.graphHeaderMeta.textContent, '군집 2개 · 엔티티 3 · 미분류 0');
  assert.equal(elements.mapGuide.hidden, false);
});

test('graphHeaderMeta·mapGuide가 없으면(선택 안 주입) 조용히 넘어간다', async () => {
  const elements = {
    summary: fakeNode('div'),
    graph: fakeNode('div'),
    graphBody: fakeNode('div'),
    // graphHeaderMeta·mapGuide 없음
  };
  const controller = createGraphModeController({
    store, layout, render, prefs: null, elements,
    fetchClusterMap: async () => payload(7),
  });
  controller.setAvailable(true);
  await assert.doesNotReject(() => controller.toggle());
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

// ── 보드 07: 성향 신호 표 선택 하이라이트(스텝5) ─────────────────────────────

function summaryRow(entityId) {
  const row = fakeNode('div');
  row.setAttribute('class', 'summary-row');
  row.setAttribute('data-entity-id', entityId);
  return row;
}

test('selectEntity() 후 summaryTable 안 해당 row가 is-selected를 받는다', () => {
  const { controller, elements } = setup();
  const rowA = summaryRow('e:a');
  const rowB = summaryRow('e:b');
  elements.summaryTable.appendChild(rowA);
  elements.summaryTable.appendChild(rowB);

  controller.selectEntity('e:a', { name: '삼성전자' });
  assert.equal(rowA.classList.contains('is-selected'), true);
  assert.equal(rowB.classList.contains('is-selected'), false, '다른 row는 안 받는다');
});

test('다른 엔티티를 선택하면 이전 row의 하이라이트가 옮겨간다', () => {
  const { controller, elements } = setup();
  const rowA = summaryRow('e:a');
  const rowB = summaryRow('e:b');
  elements.summaryTable.appendChild(rowA);
  elements.summaryTable.appendChild(rowB);

  controller.selectEntity('e:a', { name: '삼성전자' });
  controller.selectEntity('e:b', { name: '고배당주' });
  assert.equal(rowA.classList.contains('is-selected'), false);
  assert.equal(rowB.classList.contains('is-selected'), true);
});

test('clearSelection() 후 모든 row에서 is-selected가 빠진다', () => {
  const { controller, elements } = setup();
  const rowA = summaryRow('e:a');
  elements.summaryTable.appendChild(rowA);

  controller.selectEntity('e:a', { name: '삼성전자' });
  assert.equal(rowA.classList.contains('is-selected'), true);
  controller.clearSelection();
  assert.equal(rowA.classList.contains('is-selected'), false);
});

test('summaryTable이 없으면(선택 안 주입) 조용히 넘어간다', () => {
  const elements = {
    summary: fakeNode('div'),
    graph: fakeNode('div'),
    graphBody: fakeNode('div'),
    // summaryTable 없음
  };
  const controller = createGraphModeController({
    store, layout, render, prefs: null, elements,
    fetchClusterMap: async () => payload(7),
  });
  assert.doesNotThrow(() => controller.selectEntity('e:a', { name: '반도체' }));
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

// ── 스텝0-2: DOM 골격 소유권 분리 회귀 가드 ──────────────────────────────────
// graph(가시성)와 graphBody(렌더/측정/클릭위임)를 별개 참조로 나눈 것이 이
// 스텝의 핵심이다 — 소유권이 다시 섞이면(예: applyVisibility가 graphBody도
// 건드리기 시작하면) hidden 소유자가 둘이 되는 옛 결함이 재발한다.

test('applyVisibility()는 graphBody·panel의 hidden을 건드리지 않는다(가시성은 graph·summaryTable만 소유)', () => {
  const { controller, elements } = setup({ withPanel: true });
  elements.graphBody.hidden = false;
  elements.panel.hidden = false;
  controller.applyVisibility();
  assert.equal(elements.graph.hidden, true, '가시성 소유자(graph)는 정상 토글된다');
  assert.equal(elements.graphBody.hidden, false, 'graphBody는 applyVisibility가 손대지 않는다');
  assert.equal(elements.panel.hidden, false, 'panel도 applyVisibility가 손대지 않는다');
});

test('draw()는 폭/높이를 elements.graphBody.clientWidth/clientHeight에서 읽는다', async () => {
  const elements = {
    summary: fakeNode('div'),
    graph: fakeNode('div'),
    graphBody: fakeNode('div'),
    summaryTable: fakeNode('div'),
  };
  elements.graph.clientWidth = 999; // 가시성 전용 참조 — layoutClusterMap이 이 값을 읽으면 결함이다.
  elements.graph.clientHeight = 999;
  elements.graphBody.clientWidth = 321;
  elements.graphBody.clientHeight = 654;
  let capturedViewport = null;
  const spyLayout = {
    layoutClusterMap(p, viewport) {
      capturedViewport = viewport;
      return layout.layoutClusterMap(p, viewport);
    },
    // renderStage()가 스텝14부터 1단계 렌더 때마다 clusterEdges를 다시 계산한다
    // (숨은 연관 실배선) — 이 스파이는 viewport만 살피면 되므로 진짜 구현에 위임한다.
    aggregateClusterEdges: layout.aggregateClusterEdges,
  };
  const controller = createGraphModeController({
    store,
    layout: spyLayout,
    render,
    prefs: null,
    elements,
    fetchClusterMap: async () => payloadTwoClusters(7),
  });
  controller.setAvailable(true);
  await controller.toggle();
  assert.equal(capturedViewport.width, 321, 'graphBody.clientWidth를 읽는다');
  assert.equal(capturedViewport.height, 654, 'graphBody.clientHeight를 읽는다');
});

// ── 스텝14: 2단계 컨텍스트 패널(관계 목록) + 스텝11·12 실배선 ─────────────────

function expandBubble(elements, cluster) {
  const bubble = elements.graphBody.querySelectorAll('.graph-node')
    .find((n) => n.getAttribute('data-cluster') === String(cluster));
  bubble.dispatchEvent({ type: 'click' });
}

test('selectNode() — profile-summary에 같은 entity_id가 있으면 근거·신뢰도·보강수까지 얹고 source:"node"를 단다', async () => {
  const entries = [{ entity_id: 'e:a', entity_name: '반도체', entity_kind: 'theme', relation_kind: '관심', rationale: '질문 4회', reinforcement: 4, confidence: 'INFERRED', tier: 'conversational' }];
  const { controller, elements } = setup({ payload: payloadTwoClusters, withPanel: true, getProfileSummaryEntries: () => entries });
  await controller.toggle();
  expandBubble(elements, 0);
  const nodeEl = elements.graphBody.querySelectorAll('.graph-node').find((n) => n.getAttribute('data-entity-id') === 'e:a');
  nodeEl.dispatchEvent({ type: 'click' });
  assert.equal(controller.state.panel.source, 'node');
  assert.equal(controller.state.panel.relation, '관심');
  assert.equal(controller.state.panel.rationale, '질문 4회');
  assert.equal(controller.state.panel.reinforcement, 4);
  assert.equal(controller.state.panel.confidence, 'INFERRED');
});

test('selectNode() — profile-summary에 매칭이 없으면 그래프 노드 필드만으로 최소 패널이 뜬다(지어내지 않는다)', async () => {
  const { controller, elements } = setup({ payload: payloadTwoClusters, withPanel: true, getProfileSummaryEntries: () => [] });
  await controller.toggle();
  expandBubble(elements, 0);
  const nodeEl = elements.graphBody.querySelectorAll('.graph-node').find((n) => n.getAttribute('data-entity-id') === 'e:a');
  nodeEl.dispatchEvent({ type: 'click' });
  assert.equal(controller.state.panel.source, 'node');
  assert.equal(controller.state.panel.rationale, undefined);
  assert.equal(controller.state.panel.confidence, undefined);
});

test('관계 목록 — 선택 엔티티가 걸린 surprising-connections가 있으면 "숨은" 행으로 렌더된다', async () => {
  const connections = [
    { source_entity_id: 'e:a', source_name: '반도체', target_entity_id: 'e:x', target_name: '배당 방어', kinds: ['교차언급'] },
  ];
  const { controller, elements } = setup({ payload: payloadTwoClusters, withPanel: true, getSurprisingConnections: () => connections });
  await controller.toggle();
  expandBubble(elements, 0);
  const nodeEl = elements.graphBody.querySelectorAll('.graph-node').find((n) => n.getAttribute('data-entity-id') === 'e:a');
  nodeEl.dispatchEvent({ type: 'click' });
  const relations = elements.panel.querySelectorAll('.panel-relation-row');
  assert.equal(relations.length, 1);
  assert.match(elements.panel.textContent, /배당 방어/);
  assert.match(elements.panel.textContent, /숨은/);
});

test('관계 목록 — 선택 엔티티가 어느 surprising-connections에도 안 걸리면 섹션 자체가 안 뜬다(§0 정책)', async () => {
  const connections = [{ source_entity_id: 'e:zzz', target_entity_id: 'e:yyy', kinds: [] }];
  const { controller, elements } = setup({ payload: payloadTwoClusters, withPanel: true, getSurprisingConnections: () => connections });
  await controller.toggle();
  expandBubble(elements, 0);
  const nodeEl = elements.graphBody.querySelectorAll('.graph-node').find((n) => n.getAttribute('data-entity-id') === 'e:a');
  nodeEl.dispatchEvent({ type: 'click' });
  assert.equal(elements.panel.querySelector('.panel-relations'), null);
});

test('관계 목록 — getSurprisingConnections를 안 주면(현재 실제 상태) 조용히 섹션이 없다', async () => {
  const { controller, elements } = setup({ payload: payloadTwoClusters, withPanel: true });
  await controller.toggle();
  expandBubble(elements, 0);
  const nodeEl = elements.graphBody.querySelectorAll('.graph-node').find((n) => n.getAttribute('data-entity-id') === 'e:a');
  assert.doesNotThrow(() => nodeEl.dispatchEvent({ type: 'click' }));
  assert.equal(elements.panel.querySelector('.panel-relations'), null);
});

test('1단계 — surprising-connections의 source_cluster/target_cluster와 겹치는 군집 쌍은 clusterEdges.isSurprising:true로 다시 계산된다(스텝11 실배선)', async () => {
  // payload(): e:a는 cluster 0, e:b는 cluster 1, edges=[['e:a','e:b']] — 0↔1을 잇는 군집간 엣지가 하나 있다.
  const connections = [{ source_entity_id: 'x', target_entity_id: 'y', source_cluster: 0, target_cluster: 1 }];
  let capturedPlaced = null;
  const spyRender = Object.assign({}, render, {
    renderClusterBubbles(container, placed, options) {
      capturedPlaced = placed;
      return render.renderClusterBubbles(container, placed, options);
    },
  });
  const controller = createGraphModeController({
    store, layout, render: spyRender, prefs: null,
    elements: { summary: fakeNode('div'), graph: fakeNode('div'), graphBody: fakeNode('div'), summaryTable: fakeNode('div') },
    fetchClusterMap: async () => payload(7),
    getSurprisingConnections: () => connections,
  });
  controller.setAvailable(true);
  await controller.toggle();
  const edge01 = capturedPlaced.clusterEdges.find((e) => (e.from === 0 && e.to === 1) || (e.from === 1 && e.to === 0));
  assert.ok(edge01, '군집 0↔1 엣지가 있어야 한다');
  assert.equal(edge01.isSurprising, true);
});

test('2단계 — surprising-connections의 entity 쌍이 겹치면 render.renderClusterMap에 surprisingEntityPairs로 전달된다(스텝13 실배선)', async () => {
  const connections = [{ source_entity_id: 'e:a', target_entity_id: 'e:b' }];
  let capturedOptions = null;
  const spyRender = Object.assign({}, render, {
    renderClusterMap(container, layoutArg, options) {
      capturedOptions = options;
      return render.renderClusterMap(container, layoutArg, options);
    },
  });
  const elements = {
    summary: fakeNode('div'), graph: fakeNode('div'),
    graphBody: fakeNode('div'), summaryTable: fakeNode('div'),
  };
  const controller = createGraphModeController({
    store, layout, render: spyRender, prefs: null, elements,
    fetchClusterMap: async () => payloadTwoClusters(7),
    getSurprisingConnections: () => connections,
  });
  controller.setAvailable(true);
  await controller.toggle();
  expandBubble(elements, 0); // payloadTwoClusters: e:a/e:b가 cluster 0.
  assert.ok(capturedOptions.surprisingEntityPairs instanceof Set);
  assert.ok(capturedOptions.surprisingEntityPairs.has(render.entityPairKey('e:a', 'e:b')));
});

test('2단계 — unnamedClusterWarnEligible/unnamedClusters/clusterName이 placed.clusters(전체 군집 기준, §15 비차단 2번)로 계산돼 전달된다(스텝12 실배선)', async () => {
  let capturedOptions = null;
  const spyRender = Object.assign({}, render, {
    renderClusterMap(container, layoutArg, options) {
      capturedOptions = options;
      return render.renderClusterMap(container, layoutArg, options);
    },
  });
  // layoutClusterMap()은 실제로 cluster.name을 안 준다(이름 파이프라인 없음) —
  // 부분 무명 상태를 재현하려고 layoutClusterMap 결과에 name을 얹는 스파이를 쓴다.
  const spyLayout = Object.assign({}, layout, {
    layoutClusterMap(p, viewport) {
      const placed = layout.layoutClusterMap(p, viewport);
      placed.clusters = placed.clusters.map((c) => (c.cluster === 0 ? { ...c, name: '반도체 대형주' } : c));
      return placed;
    },
  });
  const elements = {
    summary: fakeNode('div'), graph: fakeNode('div'),
    graphBody: fakeNode('div'), summaryTable: fakeNode('div'),
  };
  const controller = createGraphModeController({
    store, layout: spyLayout, render: spyRender, prefs: null, elements,
    fetchClusterMap: async () => payloadTwoClusters(7),
  });
  controller.setAvailable(true);
  await controller.toggle();
  expandBubble(elements, 0); // cluster 0은 이름이 있다(스파이가 얹음), cluster 1은 없다 — 부분 무명.
  assert.equal(capturedOptions.clusterName, '반도체 대형주');
  assert.equal(capturedOptions.unnamedClusterWarnEligible, true, '0 < 이름 붙은 군집 수(1) < 전체(2)');
  assert.deepEqual(capturedOptions.unnamedClusters, [1]);
});

// ── 엔티티 타임라인 유틸(WP-G G1+G2) — 순수 함수라 컨트롤러 없이 직접 부른다 ────

test('formatEventDate — 절대 MM-DD(G-G1), 윤년·월경계·한자리 패딩', () => {
  // 정오(Z) 고정 — 자정 경계 타임존 차로 날짜가 밀리는 플레이크를 막는다.
  assert.equal(formatEventDate('2024-02-29T12:00:00Z'), '02-29', '윤년 2월 29일');
  assert.equal(formatEventDate('2026-12-31T12:00:00Z'), '12-31', '연말 월경계');
  assert.equal(formatEventDate('2026-08-04T12:00:00Z'), '08-04', '한자리 월·일 zero-pad(Paper 행3 실측값)');
});

test('formatEventDate — 파싱 불가면 빈 문자열(지어내지 않는다)', () => {
  assert.equal(formatEventDate('not-a-date'), '');
  assert.equal(formatEventDate(undefined), '');
});

test('buildTimelineRows — op별 문구(G-G6 초안 그대로), relation은 한글 사전으로', () => {
  const rows = buildTimelineRows([
    { at: '2026-08-23T12:00:00Z', op: 'entity_added' },
    { at: '2026-08-23T12:00:00Z', op: 'entity_removed' },
    { at: '2026-08-23T12:00:00Z', op: 'entity_merged' },
    { at: '2026-08-23T12:00:00Z', op: 'edge_added', relation: 'interested_in' },
    { at: '2026-08-23T12:00:00Z', op: 'edge_removed', relation: 'owns' },
    { at: '2026-08-23T12:00:00Z', op: 'edge_rejected', relation: 'traded' },
  ]);
  assert.deepEqual(rows.map((r) => r.text), [
    '노드 처음 생김', // 대화 제목 인용구는 backend에 대응 필드가 없어 생략(G-G3)
    '노드 제거됨',
    '다른 노드와 병합됨',
    '관계 추가됨(관심)',
    '관계 제거됨(보유)',
    '제안된 관계가 기각됨(매매)',
  ]);
  assert.ok(rows.every((r) => r.date === '08-23'));
});

test('buildTimelineRows — 미등록 relation·미등록 op는 원문 그대로 폴백(§0 정직성)', () => {
  const rows = buildTimelineRows([
    { at: '2026-08-23T12:00:00Z', op: 'edge_added', relation: 'mystery_kind' },
    { at: '2026-08-23T12:00:00Z', op: 'edge_added' }, // relation 자체가 없으면 괄호도 생략
    { at: '2026-08-23T12:00:00Z', op: 'unknown_op' },
  ]);
  assert.equal(rows[0].text, '관계 추가됨(mystery_kind)');
  assert.equal(rows[1].text, '관계 추가됨');
  assert.equal(rows[2].text, 'unknown_op');
});

test('buildTimelineRows — edge_changed: 상승만 "…로 승격"(G-G4), 하강·동일은 "신뢰도 변경"', () => {
  const base = { at: '2026-08-19T12:00:00Z', op: 'edge_changed', relation: 'interested_in' };
  const rows = buildTimelineRows([
    { ...base, confidence_before: 'INFERRED', confidence_after: 'EXTRACTED' },
    { ...base, confidence_before: 'EXTRACTED', confidence_after: 'AMBIGUOUS' },
    { ...base, confidence_before: 'INFERRED', confidence_after: 'INFERRED' },
    { ...base, confidence_before: null, confidence_after: 'EXTRACTED' }, // 한쪽 미상도 중립
  ]);
  assert.equal(rows[0].text, '관심 관계 추론 → 사실로 승격', 'Paper 행2 실측 어휘 그대로');
  assert.equal(rows[1].text, '관심 관계 신뢰도 변경');
  assert.equal(rows[2].text, '관심 관계 신뢰도 변경');
  assert.equal(rows[3].text, '관심 관계 신뢰도 변경');
});

test('buildTimelineRows — 배열이 아니면 빈 배열, null 항목은 걸러낸다', () => {
  assert.deepEqual(buildTimelineRows(undefined), []);
  assert.deepEqual(buildTimelineRows(null), []);
  const rows = buildTimelineRows([null, { at: '2026-08-04T12:00:00Z', op: 'entity_added' }]);
  assert.equal(rows.length, 1);
});

// ── §10-4 최근 변화 — 2단계 렌더 배선(WP-G G3) ─────────────────────────────────

// 2단계 채움은 Promise 체인(마이크로태스크)으로 도착한다 — setImmediate 한 번이면
// 체인 전체가 소진된 뒤 단언할 수 있다.
const flushTimeline = () => new Promise((resolve) => setImmediate(resolve));

test('§10-4 — IPC 성공 시 최근 변화 섹션이 행으로 채워진다(2단계 렌더)', async () => {
  const { controller, elements } = setup({
    withPanel: true,
    fetchEntityTimeline: async () => [
      { at: '2026-08-23T12:00:00Z', op: 'edge_added', relation: 'interested_in' },
      { at: '2026-08-04T12:00:00Z', op: 'entity_added' },
    ],
  });
  controller.selectEntity('e:samsung', tablePanelData());
  await flushTimeline();
  const section = elements.panel.querySelector('.panel-recent-changes');
  assert.ok(section, '섹션이 채워져 있다');
  assert.equal(section.hidden, false, '채워진 섹션은 보인다');
  assert.equal(section.querySelector('.panel-recent-changes-title').textContent, '최근 변화');
  const rows = section.querySelectorAll('.panel-change-row');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('.panel-change-date').textContent, '08-23');
  assert.equal(rows[0].querySelector('.panel-change-desc').textContent, '관계 추가됨(관심)');
  assert.equal(rows[1].querySelector('.panel-change-date').textContent, '08-04');
  assert.equal(rows[1].querySelector('.panel-change-desc').textContent, '노드 처음 생김');
});

test('§10-4 — 이벤트가 없으면 선점해 둔 섹션을 걷어낸다(빈 섹션보다 없는 편이 정직하다)', async () => {
  const { controller, elements } = setup({
    withPanel: true,
    fetchEntityTimeline: async () => [],
  });
  controller.selectEntity('e:samsung', tablePanelData());
  await flushTimeline();
  assert.equal(elements.panel.querySelector('.panel-recent-changes'), null);
});

test('§10-4 — IPC 실패면 섹션 없이 빈 상태를 유지하고 화면이 깨지지 않는다', async () => {
  const { controller, elements } = setup({
    withPanel: true,
    fetchEntityTimeline: async () => { throw new Error('backend down'); },
  });
  controller.selectEntity('e:samsung', tablePanelData());
  await flushTimeline();
  assert.equal(elements.panel.querySelector('.panel-recent-changes'), null);
  // 다른 섹션(헤더·CTA)은 멀쩡하다 — 실패가 패널 전체를 깨지 않는다.
  assert.equal(elements.panel.querySelector('.panel-name').textContent, '삼성전자');
  assert.ok(elements.panel.querySelector('.panel-cta'));
});

test('§10-4 — 빠른 재선택(A→B): A 응답이 B보다 늦게 도착해도 최종 렌더는 B다(stale 가드)', async () => {
  const resolvers = {};
  const { controller, elements } = setup({
    withPanel: true,
    fetchEntityTimeline: (entityId) => new Promise((resolve) => { resolvers[entityId] = resolve; }),
  });
  controller.selectEntity('e:a', tablePanelData({ entityId: 'e:a', name: 'A' }));
  controller.selectEntity('e:b', tablePanelData({ entityId: 'e:b', name: 'B' }));
  await flushTimeline();
  // 도착 순서를 뒤집는다 — B가 먼저, A(이미 stale)가 나중에.
  resolvers['e:b']([{ at: '2026-08-23T12:00:00Z', op: 'entity_added' }]);
  await flushTimeline();
  resolvers['e:a']([{ at: '2026-08-01T12:00:00Z', op: 'edge_removed', relation: 'owns' }]);
  await flushTimeline();
  const rows = elements.panel.querySelectorAll('.panel-change-row');
  assert.equal(rows.length, 1, 'A의 늦은 응답이 B의 타임라인을 덮어쓰지 않는다');
  assert.equal(rows[0].querySelector('.panel-change-desc').textContent, '노드 처음 생김');
});

test('§10-4 — 선택 해제 후 도착한 응답은 버려진다(패널을 다시 만들지 않는다)', async () => {
  let resolveFetch;
  const { controller, elements } = setup({
    withPanel: true,
    fetchEntityTimeline: () => new Promise((resolve) => { resolveFetch = resolve; }),
  });
  controller.selectEntity('e:samsung', tablePanelData());
  await flushTimeline();
  controller.clearSelection();
  resolveFetch([{ at: '2026-08-23T12:00:00Z', op: 'entity_added' }]);
  await flushTimeline();
  assert.equal(elements.panel.hidden, true);
  assert.equal(elements.panel.querySelector('.panel-recent-changes'), null);
});

// ── 3상태 캔버스 스위칭(리프 1.2.2, 사이드바 모드 네비) ───────────────────────
// #graphPill을 대체하는 setView()와 elements.agent 3중 배타를 검증한다.

test('setView("agent")로 전환하면 agent 표면만 보이고 나머지 둘은 숨는다(3중 배타)', async () => {
  const { controller, elements } = setup();
  await controller.setView('agent');
  assert.equal(controller.state.view, 'agent');
  assert.equal(elements.agent.hidden, false);
  assert.equal(elements.summary.hidden, true);
  assert.equal(elements.graph.hidden, true);
  assert.equal(elements.summaryTable.hidden, true, '성향 신호 표도 그래프 표면이라 agent에서는 숨는다');
});

test('setView("graph")는 toggle()과 동등하다 — 기본 서브뷰는 요약 표, 지도 내용은 graphBody에 그려진다(스텝2-보정)', async () => {
  const { controller, elements } = setup();
  await controller.setView('graph');
  assert.equal(elements.summary.hidden, true, '요약(답변) 모자이크가 숨는다');
  assert.equal(elements.graph.hidden, true, '기본 서브뷰는 요약이라 지도는 아직 숨어 있다');
  assert.equal(elements.summaryTable.hidden, false, '성향 신호 표가 기본으로 보인다');
  assert.equal(render.describeRendered(elements.graphBody).nodes, 2, 'draw()는 surface와 무관하게 graphBody에 그린다');
});

test('setView("summary")로 돌아오면 세 표면 중 요약만 보인다', async () => {
  const { controller, elements } = setup();
  await controller.setView('agent');
  await controller.setView('summary');
  assert.equal(elements.summary.hidden, false);
  assert.equal(elements.graph.hidden, true);
  assert.equal(elements.agent.hidden, true);
});

test('setView는 summary/graph/agent/plugin 네 표면을 항상 하나만 보이고 plugin 모드를 DOM에 공개한다', async () => {
  const { controller, elements } = setup();
  const visibleSurface = {
    summary: 'summary',
    graph: 'summaryTable',
    agent: 'agent',
    plugin: 'plugin',
  };

  for (const view of Object.keys(visibleSurface)) {
    await controller.setView(view);
    for (const surface of ['summary', 'graph', 'summaryTable', 'agent', 'plugin']) {
      assert.equal(elements[surface].hidden, surface !== visibleSurface[view], `${view}: ${surface}`);
    }
    const expectedMode = view === 'summary' ? 'chat' : view;
    assert.equal(elements.kiumi.dataset.mode, expectedMode);
    assert.equal(elements.canvasRegion.dataset.mode, expectedMode);
    assert.equal(elements.chatHead.hidden, view !== 'graph', '그래프 전용 채팅 헤더 규칙');
  }
});

test('controller.setView()는 모르는 mode를 무시하고 현재 plugin 가시성을 유지한다', async () => {
  const { controller, elements, fetchCalls } = setup();
  await controller.setView('plugin');
  const previousState = controller.state;
  await controller.setView('bogus');
  assert.equal(controller.state, previousState);
  assert.equal(elements.plugin.hidden, false);
  assert.equal(elements.summary.hidden, true);
  assert.equal(fetchCalls(), 0);
});

test('agent로 전환할 때는 백엔드를 부르지 않는다(그래프 뷰가 아니므로 draw()가 no-op)', async () => {
  const { controller, fetchCalls } = setup();
  await controller.setView('agent');
  assert.equal(fetchCalls(), 0);
});

test('elements.agent가 없어도 setView("agent")가 터지지 않는다(옵셔널 가드)', async () => {
  const elements = { summary: fakeNode('div'), graph: fakeNode('div') };
  const controller = createGraphModeController({
    store, layout, render, prefs: null, elements,
    fetchClusterMap: async () => payload(7),
  });
  await assert.doesNotReject(() => controller.setView('agent'));
  assert.equal(elements.summary.hidden, true);
});

// ── D4: 5 view × 5 표면 배타표(backtest-mode-plan.md §3.3) ──────────────────
// 5번째 모드(backtest) 추가로 applyVisibility()를 view→표면 맵으로 정규화했다
// (함수 본문 안에서만, graph만 surface 축 예외로 남는다) — 이 표가 그 정규화의
// 회귀 가드다. graph는 surface 축(요약 표/군집 지도)이 따로 있어, 여기서 다루는
// elements.graph(군집 지도 표면)는 기본 진입(setSurface 호출 전) 상태에서는
// summary/agent/plugin/backtest와 마찬가지로 hidden이다 — 그 축은 위 setSurface
// 테스트들이 이미 따로 지킨다.
test('D4 — 5 view × 5 표면 배타표: 각 view에서 정확히 그 표면만 보인다(25칸)', async () => {
  const { controller, elements } = setup();
  const VIEWS = ['summary', 'graph', 'agent', 'plugin', 'backtest'];
  const SURFACES = ['summary', 'graph', 'agent', 'plugin', 'backtest'];
  // view → 이 표에서 보여야 할 표면 키. graph는 기본 서브뷰가 요약 표라
  // elements.graph 자체는 이 표 안에서 항상 hidden이다(null = 5개 전부 숨음).
  const visibleSurfaceKey = { summary: 'summary', graph: null, agent: 'agent', plugin: 'plugin', backtest: 'backtest' };

  for (const view of VIEWS) {
    await controller.setView(view);
    for (const surface of SURFACES) {
      const expectedHidden = surface !== visibleSurfaceKey[view];
      assert.equal(elements[surface].hidden, expectedHidden, `${view} 진입 시 ${surface} hidden 기대값 불일치`);
    }
  }
});
