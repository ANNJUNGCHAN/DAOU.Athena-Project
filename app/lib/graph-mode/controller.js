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
    elements,       // { pill, summary, graph(가시성 전용 — applyVisibility()만 소유),
                    //   graphBody(렌더·클릭위임·크기측정 전용), summaryTable(선택 —
                    //   보드 07 성향 신호 표, 가시성 전용), panel(선택) — 보드 07/15의
                    //   "공통 패널" }
    fetchClusterMap, // async () => payload
    onError,        // (err) => void (선택)
    onPanelCta,     // () => void (선택) — 공통 패널 CTA "채팅에서 답하기" 클릭 시(스텝8)
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
  //
  // 스텝2-보정 — 요약 표/군집 지도 두 표면이 그래프 기능 안에서 동시에
  // hidden=false였던 옛 결함(둘 다 92% 불투명 카드라 뒤 레이어가 비쳤다)을
  // state.surface로 정식 해소한다. 이 함수가 여전히 유일한 hidden 소유자다 —
  // canvas.js의 z-index 임시조치(.graph-surface-back)는 걷어냈다.
  function applyVisibility() {
    const graphView = store.isGraphView(state);
    if (elements.summary) elements.summary.hidden = graphView;
    if (elements.graph) elements.graph.hidden = !graphView || state.surface !== store.SURFACE_MAP;
    if (elements.summaryTable) elements.summaryTable.hidden = !graphView || state.surface !== store.SURFACE_SUMMARY;
    if (elements.pill) {
      // 모드 칩은 "다음에 할 동작"이 아니라 "지금 모드"를 보여준다(Paper 보드 05
      // "모드 칩 상시" — 답변/그래프 둘 중 지금 켜져 있는 쪽). 라벨은 "그래프"로
      // 고정하고, 지금 모드는 배경색 스왑(.is-active)으로만 표시한다(06/07 §4-3,
      // 38 §1.4-2 규범 — 예전엔 라벨 자체를 답변⇄그래프로 바꿔치기했다).
      elements.pill.classList.toggle('is-active', graphView);
      elements.pill.setAttribute('aria-pressed', graphView ? 'true' : 'false');
    }
  }

  // 브레인이 안 됐는데 그래프 모드로 들어오면 빈 캔버스 대신 이렇게 정직하게
  // 알린다 — 없는 것(성향 자체가 없다)과 못 읽은 것(브레인 미기동)은 다르다.
  function renderUnavailable() {
    if (!elements.graphBody) return;
    while (elements.graphBody.firstChild) elements.graphBody.removeChild(elements.graphBody.firstChild);
    const note = document.createElement('div');
    note.className = 'graph-mode-unavailable';
    note.textContent = '아직 성향을 읽을 수 없습니다 — 브레인이 준비되면 여기 그래프로 보입니다.';
    elements.graphBody.appendChild(note);
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
    if (!elements.graphBody || typeof elements.graphBody.querySelectorAll !== 'function') return;
    const nodeEls = elements.graphBody.querySelectorAll('.graph-node');
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
    if (!lastPlaced || !elements.graphBody) return;
    const nodes = store.visibleNodes(state, lastPlaced);
    const edges = store.visibleEdges(state, lastPlaced);
    const settings = prefs ? prefs.readPrefs() : null;
    render.renderClusterMap(elements.graphBody, { nodes, edges }, {
      showLabels: prefs ? prefs.shouldShowLabels(settings, nodes.length) : true,
      highlightCrossings: settings ? settings.highlightCrossings : true,
      selectedEntityId: state.selectedEntityId,
    });
    wireNodeClicks();
    renderSelection();
  }

  // 성향 신호 표 선택 하이라이트(보드 07) — applyVisibility()의 32행 주석
  // "가시성은 전부 이 함수 하나가 소유한다"는 단일 소유권 원칙을 선택
  // 하이라이트에도 적용한다: 새 상태·새 컴포넌트를 만들지 않고 기존
  // state.selectedEntityId를 그대로 읽어 .is-selected만 토글한다.
  function highlightSelectedRow() {
    if (!elements.summaryTable || typeof elements.summaryTable.querySelectorAll !== 'function') return;
    elements.summaryTable.querySelectorAll('.summary-row').forEach((row) => {
      row.classList.toggle('is-selected', row.getAttribute('data-entity-id') === state.selectedEntityId);
    });
  }

  function elp(name, className) {
    const node = document.createElement(name);
    if (className) node.setAttribute('class', className);
    return node;
  }

  // dot 인코딩 재사용 — summary-table.js의 dotClass()와 같은 confidence/tier
  // 규칙(§0 원칙5 "근거 불명확한 추정 분류"). 그래프 노드 선택 경로
  // (selectNode())는 confidence/tier가 없어 이 판정이 항상 '테두리만'으로
  // 떨어진다 — 지어낸 값이 아니라 정직한 기본값이다.
  function panelDotClass(data) {
    if (data.confidence === 'EXTRACTED' && data.tier === 'deterministic') return 'panel-dot-fact';
    if (data.confidence === 'AMBIGUOUS') return 'panel-dot-warn';
    return 'panel-dot-soft';
  }

  const PANEL_TIER_LABELS = { deterministic: '체결·잔고', conversational: '대화' };
  const PANEL_CONFIDENCE_LABELS = { EXTRACTED: '사실', INFERRED: '추론', AMBIGUOUS: '불확실' };

  // 공통 패널 콘텐츠(보드 07 §10, 스텝8). §10-1 탭("이력" 탭은 Paper에 콘텐츠
  // 스펙이 없어 클릭해도 전환 없음, §6 범위 밖) · §10-2 선택 헤더 · §10-3 티어
  // 대조(가용 필드가 rationale/confidence/tier뿐이라 두 카드 비교 "어긋남"
  // 대신 단일 카드로 축소, §0 정책) · §10-5 CTA를 그린다. §10-4(최근 변화)는
  // 데이터가 없어 섹션 자체를 렌더하지 않는다 — 빈 섹션보다 아예 없는 편이
  // 정직하다.
  function renderPanelContent(panel, data) {
    while (panel.firstChild) panel.removeChild(panel.firstChild);

    const tabs = elp('div', 'panel-tabs');
    const traitTab = elp('button', 'panel-tab is-active');
    traitTab.setAttribute('type', 'button');
    traitTab.textContent = '성향';
    tabs.appendChild(traitTab);
    const historyTab = elp('button', 'panel-tab');
    historyTab.setAttribute('type', 'button');
    historyTab.textContent = '이력';
    tabs.appendChild(historyTab);
    tabs.appendChild(elp('span', 'panel-tabs-spacer'));
    const deselectBtn = elp('button', 'panel-deselect');
    deselectBtn.setAttribute('type', 'button');
    deselectBtn.textContent = '선택 해제';
    deselectBtn.addEventListener('click', () => {
      state = store.clearSelection(state);
      renderSelection();
    });
    tabs.appendChild(deselectBtn);
    panel.appendChild(tabs);

    const header = elp('div', 'panel-header');
    const row1 = elp('div', 'panel-header-row1');
    row1.appendChild(elp('span', `panel-dot ${panelDotClass(data)}`));
    const name = elp('span', 'panel-name');
    name.textContent = data.name || data.entityId;
    row1.appendChild(name);
    if (data.kind) {
      const kindBadge = elp('span', 'panel-kind-badge');
      kindBadge.textContent = data.kind;
      row1.appendChild(kindBadge);
    }
    header.appendChild(row1);
    if (Number.isFinite(data.reinforcement)) {
      const row2 = elp('div', 'panel-header-row2');
      row2.textContent = `보강 ${data.reinforcement}회`;
      header.appendChild(row2);
    }
    panel.appendChild(header);

    // 가용 필드가 하나라도 있을 때만 카드를 그린다 — 전부 없으면(그래프 노드
    // 선택 경로처럼 rationale/confidence/tier가 아예 없는 panelData) 빈
    // 카드를 만들지 않는다.
    if (data.rationale || data.tier || data.confidence) {
      const tierCard = elp('div', 'panel-tier-card');
      const tierRow = elp('div', 'panel-tier-row');
      tierRow.appendChild(elp('span', `panel-dot ${panelDotClass(data)}`));
      const tierLabel = elp('span', 'panel-tier-label');
      tierLabel.textContent = PANEL_TIER_LABELS[data.tier] || '출처 불명';
      tierRow.appendChild(tierLabel);
      if (data.confidence) {
        const confBadge = elp('span', 'panel-tier-confidence');
        confBadge.textContent = PANEL_CONFIDENCE_LABELS[data.confidence] || data.confidence;
        tierRow.appendChild(confBadge);
      }
      tierCard.appendChild(tierRow);
      if (data.rationale) {
        const tierBody = elp('div', 'panel-tier-body');
        tierBody.textContent = data.rationale;
        tierCard.appendChild(tierBody);
      }
      panel.appendChild(tierCard);
    }

    const cta = elp('button', 'panel-cta');
    cta.setAttribute('type', 'button');
    cta.textContent = '채팅에서 답하기';
    if (typeof onPanelCta === 'function') cta.addEventListener('click', onPanelCta);
    panel.appendChild(cta);
  }

  // 공통 패널 — 선택된 노드가 있으면 채우고 없으면 숨긴다. panel 요소는
  // 주입받는다(elements.panel) — 안 들어오면 조용히 건너뛴다, DOM을 전역에서
  // 만들지 않는다는 이 파일의 원래 계약을 지킨다.
  function renderSelection() {
    highlightSelectedRow();
    const panel = elements.panel;
    if (!panel) return;
    if (!state.selectedEntityId || !state.panel) {
      panel.hidden = true;
      while (panel.firstChild) panel.removeChild(panel.firstChild);
      return;
    }
    panel.hidden = false;
    renderPanelContent(panel, state.panel);
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
      width: elements.graphBody ? elements.graphBody.clientWidth : 0,
      height: elements.graphBody ? elements.graphBody.clientHeight : 0,
    });
    lastPlaced = placed;
    const nodes = store.visibleNodes(state, placed);
    const edges = store.visibleEdges(state, placed);
    const settings = prefs ? prefs.readPrefs() : null;
    render.renderClusterMap(elements.graphBody, { nodes, edges }, {
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
    // 요약 표 ↔ 군집 지도 서브뷰 전환(스텝2-보정) — canvas.js의 옛 z-index
    // 임시조치(focusGraphSurface)를 대체한다. hidden 소유권은 applyVisibility()
    // 하나뿐이라 여기서도 안 건드리고 store.setSurface()로만 바꾼다.
    //
    // 지도로 전환할 때는 항상 강제로 다시 그린다(draw(true)) — #graphCanvas가
    // hidden인 동안엔 elements.graphBody.clientWidth/Height가 0이라(브레인
    // 응답이 요약 서브뷰를 보는 중에 도착하면 draw()가 이미 0×0으로 한 번
    // 그렸을 수 있다), 지도가 실제로 보이는 이 시점의 진짜 치수로 재계산해야
    // 배치가 한쪽에 뭉치지 않는다. redrawFromCache()는 이미 계산된(잘못됐을
    // 수 있는) 좌표를 재필터링만 할 뿐 치수를 다시 안 재므로 여기선 안 맞는다.
    async setSurface(nextSurface) {
      if (state.surface === nextSurface) return null;
      state = store.setSurface(state, nextSurface);
      applyVisibility();
      if (state.surface === store.SURFACE_MAP) {
        return draw(true);
      }
      renderSelection();
      return null;
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
