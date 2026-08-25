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
    elements,       // { pill, summary, graph }
    fetchClusterMap, // async () => payload
    onError,        // (err) => void (선택)
  } = deps;

  let state = store.createInitialState();
  let lastDrawnRevision = null;

  function applyVisibility() {
    const graphView = store.isGraphView(state);
    if (elements.summary) elements.summary.hidden = graphView;
    if (elements.graph) elements.graph.hidden = !graphView;
    if (elements.pill) {
      elements.pill.textContent = graphView ? '요약' : '그래프';
      elements.pill.setAttribute('aria-pressed', graphView ? 'true' : 'false');
    }
  }

  async function draw(force) {
    if (!store.isGraphView(state)) return null;
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
    const settings = prefs ? prefs.readPrefs() : null;
    render.renderClusterMap(elements.graph, placed, {
      showLabels: prefs
        ? prefs.shouldShowLabels(settings, placed.nodes.length)
        : true,
      highlightCrossings: settings ? settings.highlightCrossings : true,
    });
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
      return draw(true);
    },
    async refresh() {
      return draw(false);
    },
    // 브레인이 준비됐을 때만 필을 보인다 — 없는 기능을 있다고 표시하지 않는다.
    setAvailable(available) {
      if (elements.pill) elements.pill.hidden = !available;
      if (!available && store.isGraphView(state)) {
        state = store.setView(state, store.VIEW_SUMMARY);
        applyVisibility();
      }
    },
    applyVisibility,
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
