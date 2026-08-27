// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 그래프 모드의 상태 기계: 요약⇄그래프 토글, 군집 펼침(1단계 → 2단계), 공통 패널.
//
// **왜 상태를 따로 두나.** 캔버스는 그리기만 하고 "지금 무엇을 보고 있는가"는 여기서
// 답한다. 그리기 코드가 상태를 들고 있으면 토글 한 번에 뭘 다시 그려야 하는지가
// 그리기 코드 안에 흩어지고, 그 상태가 화면과 어긋나는 순간을 재현할 수 없다.
//
// **리비전이 상태에 있는 이유.** 백엔드 응답마다 `revision`이 온다. 사용자가 군집을
// 펼쳐놓은 사이 그래프가 바뀌면 펼친 군집 번호가 다른 것을 가리킬 수 있다 — 군집 번호는
// 크기 순이라 새 노드 하나에 순서가 바뀐다. 그래서 리비전이 바뀌면 펼침을 접는다.
// 조용히 다른 군집을 보여주느니 1단계로 돌아가는 편이 정직하다.

const VIEW_SUMMARY = 'summary';
const VIEW_GRAPH = 'graph';
const STAGE_CLUSTERS = 'clusters';
const STAGE_EXPANDED = 'expanded';

// 그래프 기능 안의 서브뷰(스텝2-보정, 옛 z-index 임시조치를 대체) — "요약 표"와
// "군집 지도"는 그래프 기능 진입 여부(state.view)와는 다른 축이다. 값이 우연히
// VIEW_SUMMARY와 같은 문자열이지만 별개 필드(state.surface)라 섞이지 않는다.
const SURFACE_SUMMARY = 'summary';
const SURFACE_MAP = 'map';

function createInitialState() {
  return {
    view: VIEW_SUMMARY,
    surface: SURFACE_SUMMARY, // 보드 06/07 기본값 — "요약"이 항상 먼저 보인다.
    stage: STAGE_CLUSTERS,
    expandedCluster: null,
    selectedEntityId: null,
    revision: 0,
    panel: null,
  };
}

function isGraphView(state) {
  return state.view === VIEW_GRAPH;
}

// 서브뷰 전환 — 그래프 기능 진입/이탈(toggleView)과 무관하다. 펼침·선택은
// 안 건드린다(둘 다 유지할 이유가 있다: 표를 보다가 지도로 갔다 와도 선택은
// 남아 있어야 공통 패널이 안 깜빡인다).
function setSurface(state, surface) {
  if (surface !== SURFACE_SUMMARY && surface !== SURFACE_MAP) return state;
  if (surface === state.surface) return state;
  return { ...state, surface };
}

// 요약⇄그래프 토글. 그래프에서 요약으로 나가면 펼침과 선택을 버린다 — 돌아왔을 때
// 사용자가 기억하지 못하는 상태에 놓여 있으면 방향을 잃는다.
function toggleView(state) {
  if (state.view === VIEW_GRAPH) {
    return { ...state, view: VIEW_SUMMARY, stage: STAGE_CLUSTERS, expandedCluster: null, selectedEntityId: null, panel: null };
  }
  return { ...state, view: VIEW_GRAPH };
}

function setView(state, view) {
  if (view !== VIEW_SUMMARY && view !== VIEW_GRAPH) return state;
  if (view === state.view) return state;
  return toggleView(state);
}

// 1단계 → 2단계. 군집 하나를 펼쳐 그 안의 노드를 본다.
function expandCluster(state, cluster) {
  if (!Number.isInteger(cluster)) return state;
  if (!isGraphView(state)) return state;
  return { ...state, stage: STAGE_EXPANDED, expandedCluster: cluster };
}

// 2단계 → 1단계.
function collapseCluster(state) {
  if (state.stage !== STAGE_EXPANDED) return state;
  return { ...state, stage: STAGE_CLUSTERS, expandedCluster: null };
}

// 공통 패널: 어느 단계에서든 노드를 고르면 같은 패널이 열린다. 단계마다 다른 패널을
// 두면 같은 정보를 두 곳에서 관리하게 되고, 하나만 고치는 실수가 난다.
function selectEntity(state, entityId, panel) {
  if (!entityId) return { ...state, selectedEntityId: null, panel: null };
  return { ...state, selectedEntityId: String(entityId), panel: panel || null };
}

function clearSelection(state) {
  return { ...state, selectedEntityId: null, panel: null };
}

// 새 응답이 왔다. 리비전이 바뀌었으면 펼침·선택을 버린다(위 주석 참고).
function applyRevision(state, revision) {
  const next = Number.isInteger(revision) ? revision : state.revision;
  if (next === state.revision) return state;
  return {
    ...state,
    revision: next,
    stage: STAGE_CLUSTERS,
    expandedCluster: null,
    selectedEntityId: null,
    panel: null,
  };
}

// 지금 그려야 할 노드. 1단계는 전부, 2단계는 펼친 군집만.
function visibleNodes(state, layout) {
  const nodes = Array.isArray(layout && layout.nodes) ? layout.nodes : [];
  if (state.stage !== STAGE_EXPANDED || state.expandedCluster === null) return nodes;
  return nodes.filter((node) => node.cluster === state.expandedCluster);
}

// 지금 그려야 할 엣지. 2단계에서는 양 끝이 모두 보이는 것만 — 한쪽이 화면 밖인 선을
// 그리면 어디로도 가지 않는 선이 된다.
function visibleEdges(state, layout) {
  const edges = Array.isArray(layout && layout.edges) ? layout.edges : [];
  if (state.stage !== STAGE_EXPANDED || state.expandedCluster === null) return edges;
  const visible = new Set(visibleNodes(state, layout).map((node) => node.entity_id));
  return edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to));
}

const __exports = {
  VIEW_SUMMARY,
  VIEW_GRAPH,
  SURFACE_SUMMARY,
  SURFACE_MAP,
  STAGE_CLUSTERS,
  STAGE_EXPANDED,
  createInitialState,
  isGraphView,
  toggleView,
  setView,
  setSurface,
  expandCluster,
  collapseCluster,
  selectEntity,
  clearSelection,
  applyRevision,
  visibleNodes,
  visibleEdges,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.GraphModeStore = __exports;
}

})();
