// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 그래프 모드를 화면에 붙이는 배선. 상태(`graph-mode-store`)·배치(`cluster-layout`)·
// 그리기(`render`)는 각자 순수하고, 이 파일이 셋을 DOM과 백엔드에 잇는다.
//
// **의존을 전부 주입받는다.** DOM 노드도 fetch도 전역에서 집어오지 않는다 — 그래야
// Electron 없이 테스트할 수 있고, 이 리포는 이미 그 방식을 쓴다(history-badge.test.js).
//
// **리비전이 같으면 다시 그리지 않는다.** 백엔드가 군집을 캐시하므로 응답은 싸지만,
// 같은 그림을 다시 그리면 SVG가 통째로 교체되어 화면이 깜빡인다.

function createGraphModeController(deps) {
  const {
    store,          // graph-mode-store
    layout,         // cluster-layout
    render,         // render
    prefs,          // graph-mode-prefs (선택)
    elements,       // { pill, summary, graph, summaryTable(선택 — 보드 07 성향 신호 표),
                    //   panel(선택) — 보드 07/15의 "공통 패널" }
    fetchClusterMap, // async () => payload
    onError,        // (err) => void (선택)
  } = deps;

  let state = store.createInitialState();
  let lastDrawnRevision = null;
  let lastPlaced = null; // 마지막으로 받은 배치. 펼침·접기·선택은 새 fetch 없이 이걸 다시 필터링해서 그린다.
  // 브레인 상태를 아직 모르는 부팅 초반엔 "못 씀"으로 가정한다 — setAvailable(true)가
  // 오기 전에 그래프 모드로 들어오면 renderUnavailable()의 정직한 안내를 보여준다.
  let available = false;

  // 보드 12d/US-007 — 답변⇄그래프 두 표면의 가시성은 전부 이 함수 하나가 소유한다.
  // 부팅 시 다른 어디서도(예: canvas.js의 brain-status 콜백) summaryTable 같은
  // 그래프 표면의 hidden을 직접 건드리지 않는다 — 소유자가 둘이면 브레인 준비
  // 타이밍에 따라 그래프 표면이 답변 모드에 새어 보이는 결함이 재발한다(실측,
  // 2026-08-26 — summaryTable이 graphView와 무관하게 ready만으로 보였다 지워졌다 했다).
  function applyVisibility() {
    const graphView = store.isGraphView(state);
    if (elements.summary) elements.summary.hidden = graphView;
    if (elements.graph) elements.graph.hidden = !graphView;
    if (elements.summaryTable) elements.summaryTable.hidden = !graphView;
    if (elements.pill) {
      // 모드 칩은 "다음에 할 동작"이 아니라 "지금 모드"를 보여준다(Paper 보드 05
      // "모드 칩 상시" — 답변/그래프 둘 중 지금 켜져 있는 쪽).
      elements.pill.textContent = graphView ? '그래프' : '답변';
      elements.pill.setAttribute('aria-pressed', graphView ? 'true' : 'false');
    }
    // 키우미 얼굴(2026-08-27, Paper 보드 45) — 지금 모드를 얼굴로 보여준다
    // (대화=눈 · 그래프=온톨로지 별자리). CSS가 data-mode로 얼굴을 고른다.
    if (elements.kiumi) elements.kiumi.dataset.mode = graphView ? 'graph' : 'chat';
  }

  // 브레인이 안 됐는데 그래프 모드로 들어오면 빈 캔버스 대신 이렇게 정직하게
  // 알린다 — 없는 것(성향 자체가 없다)과 못 읽은 것(브레인 미기동)은 다르다.
  function renderUnavailable() {
    if (!elements.graph) return;
    while (elements.graph.firstChild) elements.graph.removeChild(elements.graph.firstChild);
    const note = document.createElement('div');
    note.className = 'graph-mode-unavailable';
    note.textContent = '아직 성향을 읽을 수 없습니다 — 브레인이 준비되면 여기 그래프로 보입니다.';
    elements.graph.appendChild(note);
    lastDrawnRevision = null; // available해지면 실제 그림으로 다시 그리게 한다.
  }

  // 노드 클릭 하나가 지금 단계에 따라 다른 뜻이다(보드 15): 1단계에서는 그 노드가
  // 속한 군집을 펼치고, 2단계에서는 그 노드를 고른다 — 공통 패널이 연다.
  function handleNodeClick(entityId, cluster) {
    if (state.stage === store.STAGE_CLUSTERS) {
      state = store.expandCluster(state, Number(cluster));
      redrawFromCache();
      return;
    }
    selectNode(entityId);
  }

  function selectNode(entityId) {
    const node = lastPlaced && Array.isArray(lastPlaced.nodes)
      ? lastPlaced.nodes.find((n) => n.entity_id === entityId)
      : null;
    const panelData = node
      ? { entityId: node.entity_id, name: node.name, kind: node.kind, cluster: node.cluster, degree: node.degree }
      : { entityId };
    state = store.selectEntity(state, entityId, panelData);
    renderSelection();
  }

  // 렌더된 노드마다 클릭을 건다. 다시 그릴 때마다 SVG가 통째로 교체되므로
  // (render.js 주석 참고) 리스너도 매번 새로 건다 — 개별 바인딩을 쓰는 이유는
  // 이 파일이 최소 DOM 스텁(fake-dom.js)에서도 똑같이 돌아야 해서다(버블링 없음).
  function wireNodeClicks() {
    if (!elements.graph || typeof elements.graph.querySelectorAll !== 'function') return;
    const nodeEls = elements.graph.querySelectorAll('.graph-node');
    for (const nodeEl of nodeEls) {
      if (typeof nodeEl.addEventListener !== 'function') continue;
      nodeEl.addEventListener('click', () => {
        handleNodeClick(nodeEl.getAttribute('data-entity-id'), nodeEl.getAttribute('data-cluster'));
      });
    }
  }

  // 지금 상태로 마지막 배치를 다시 그린다 — 펼침·접기·선택 전부 이 경로를 탄다.
  // 배치는 이미 있으니 무엇을 보여줄지만 바뀐다, 네트워크 왕복이 필요 없다.
  function redrawFromCache() {
    if (!lastPlaced || !elements.graph) return;
    const nodes = store.visibleNodes(state, lastPlaced);
    const edges = store.visibleEdges(state, lastPlaced);
    const settings = prefs ? prefs.readPrefs() : null;
    render.renderClusterMap(elements.graph, { nodes, edges }, {
      showLabels: prefs ? prefs.shouldShowLabels(settings, nodes.length) : true,
      highlightCrossings: settings ? settings.highlightCrossings : true,
      selectedEntityId: state.selectedEntityId,
    });
    wireNodeClicks();
    renderSelection();
  }

  // 공통 패널 — 선택된 노드가 있으면 채우고 없으면 숨긴다. 관계 목록·근거·최근
  // 변화 같은 백엔드 의존 섹션은 여기서 만들지 않는다 — 지어낼 데이터가 없다.
  // panel 요소는 주입받는다(elements.panel) — 안 들어오면 조용히 건너뛴다,
  // DOM을 전역에서 만들지 않는다는 이 파일의 원래 계약을 지킨다.
  function renderSelection() {
    const panel = elements.panel;
    if (!panel) return;
    if (!state.selectedEntityId || !state.panel) {
      panel.hidden = true;
      panel.textContent = '';
      return;
    }
    panel.hidden = false;
    const data = state.panel;
    const degreeText = Number.isFinite(data.degree) ? `연결 ${data.degree}` : '';
    panel.textContent = [data.name || data.entityId, degreeText].filter(Boolean).join(' · ');
  }

  async function draw(force) {
    if (!store.isGraphView(state)) return null;
    if (!available) {
      renderUnavailable();
      return null;
    }
    let payload;
    try {
      payload = await fetchClusterMap();
    } catch (err) {
      // 그래프를 못 받으면 요약으로 돌아간다 — 빈 캔버스를 띄우면 "성향이 없다"로
      // 읽힌다. 없는 것과 못 읽은 것은 다르다.
      if (onError) onError(err);
      state = store.setView(state, store.VIEW_SUMMARY);
      applyVisibility();
      return null;
    }

    state = store.applyRevision(state, payload && payload.revision);
    if (!force && lastDrawnRevision === state.revision) return null;

    const placed = layout.layoutClusterMap(payload, {
      width: elements.graph ? elements.graph.clientWidth : 0,
      height: elements.graph ? elements.graph.clientHeight : 0,
    });
    lastPlaced = placed;
    const nodes = store.visibleNodes(state, placed);
    const edges = store.visibleEdges(state, placed);
    const settings = prefs ? prefs.readPrefs() : null;
    render.renderClusterMap(elements.graph, { nodes, edges }, {
      showLabels: prefs
        ? prefs.shouldShowLabels(settings, nodes.length)
        : true,
      highlightCrossings: settings ? settings.highlightCrossings : true,
      selectedEntityId: state.selectedEntityId,
    });
    wireNodeClicks();
    renderSelection();
    lastDrawnRevision = state.revision;
    return placed;
  }

  return {
    get state() {
      return state;
    },
    async toggle() {
      state = store.toggleView(state);
      applyVisibility();
      renderSelection();
      return draw(true);
    },
    async refresh() {
      return draw(false);
    },
    // 모드 칩은 상시 보인다(Paper 보드 05) — 브레인 꺼짐은 칩을 숨기는 대신
    // 그래프 화면 안에서 renderUnavailable()로 정직하게 알린다. 그래프 모드
    // 자체는 브레인 상태와 무관하게 항상 열 수 있다.
    setAvailable(nextAvailable) {
      available = Boolean(nextAvailable);
      if (!store.isGraphView(state)) return undefined;
      if (available) {
        return draw(true); // 못 쓰던 그래프가 쓸 수 있게 됐다 — 안내 대신 실제로 그린다.
      }
      renderUnavailable();
      return undefined;
    },
    applyVisibility,
    // 공통 패널 공개 API — 그래프 밖(요약 표의 행 선택, 보드 07)에서도 같은 패널을
    // 열 수 있어야 한다는 게 store의 원래 계약이다("공통 패널: 어느 단계에서든
    // 노드를 고르면 같은 패널이 열린다"). 요약 표 자체는 이 디렉터리 밖(canvas.js)에
    // 있어 그 쪽 행 클릭 배선은 이 파일의 몫이 아니다 — 호출자가 entityId·설명
    // 데이터를 이 메서드로 넘기면 같은 패널이 연다.
    selectEntity(entityId, panelData) {
      state = store.selectEntity(state, entityId, panelData);
      renderSelection();
    },
    clearSelection() {
      state = store.clearSelection(state);
      renderSelection();
    },
    collapseCluster() {
      state = store.collapseCluster(state);
      redrawFromCache();
    },
  };
}

const __exports = { createGraphModeController };

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.GraphModeController = __exports;
}

})();
