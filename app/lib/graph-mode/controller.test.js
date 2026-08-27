// controller.js 단위 테스트 — 의존을 전부 주입하므로 Electron이 필요 없다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('./graph-mode-store');
const layout = require('./cluster-layout');
const render = require('./render');
const themeClusters = require('./theme-clusters');
const prefs = require('./graph-mode-prefs');
const { createGraphModeController, computeGraphHeaderMeta } = require('./controller');
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
    // graph(가시성 전용)와 graphBody(렌더/측정/클릭위임 전용)를 별개 노드로 둔다 —
    // 스텝0-2 소유권 분리를 fake-dom에서도 그대로 흉내낸다.
    graph: fakeNode('div'),
    graphBody: fakeNode('div'),
    summaryTable: fakeNode('div'),
    graphHeaderMeta: fakeNode('span'),
    mapGuide: fakeNode('div'),
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
    onPanelCta: opts.onPanelCta,
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
  assert.equal(elements.pill.classList.contains('is-active'), false, '모드 칩은 지금 모드를 보여준다(답변 모드에선 비활성)');
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
  assert.equal(elements.pill.classList.contains('is-active'), false);
});

test('토글하면 캔버스 영역이 그래프 기능으로 바뀌고, 기본 서브뷰는 요약 표다(스텝2-보정)', async () => {
  const { controller, elements } = setup();
  await controller.toggle();
  assert.equal(elements.summary.hidden, true, '요약이 숨는다');
  assert.equal(elements.graph.hidden, true, '기본 서브뷰는 요약이라 지도는 아직 숨어 있다');
  assert.equal(elements.summaryTable.hidden, false, '그래프 모드에선 성향 신호 표가 기본으로 보인다');
  assert.equal(elements.pill.classList.contains('is-active'), true, '모드 칩은 지금 모드를 보여준다(그래프 모드에선 활성)');
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

test('백엔드가 죽으면 요약으로 돌아간다', async () => {
  // 빈 캔버스를 띄우면 "성향이 없다"로 읽힌다. 없는 것과 못 읽은 것은 다르다.
  const seen = [];
  const { controller, elements } = setup({ fail: true, onError: (e) => seen.push(e) });
  await controller.toggle();
  assert.equal(elements.graph.hidden, true, '그래프를 띄우지 않는다');
  assert.equal(elements.summary.hidden, false);
  assert.equal(elements.summaryTable.hidden, true, '요약으로 돌아갔으니 그래프 표면도 같이 숨는다');
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
    pill: fakeNode('button'),
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
    pill: fakeNode('button'),
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
    pill: fakeNode('button'),
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
