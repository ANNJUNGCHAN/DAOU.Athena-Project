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
const VIEW_AGENT = 'agent';
const VIEW_PLUGIN = 'plugin';
const VIEW_BACKTEST = 'backtest'; // 5번째 모드(D4, backtest-mode-plan.md §3.2) — 캔버스 자리 #backtestCanvas.
const STAGE_CLUSTERS = 'clusters';
const STAGE_EXPANDED = 'expanded';

// 그래프 기능 안의 서브뷰(스텝2-보정, 옛 z-index 임시조치를 대체) — "요약 표"와
// "군집 지도"는 그래프 기능 진입 여부(state.view)와는 다른 축이다. 값이 우연히
// VIEW_SUMMARY와 같은 문자열이지만 별개 필드(state.surface)라 섞이지 않는다.
const SURFACE_SUMMARY = 'summary';
const SURFACE_MAP = 'map';
// 세 번째 서브뷰(보드 05) — "수집·노출". 요약/지도와 같은 축이다: 그래프 기능
// 안에서 무엇을 보고 있는가일 뿐, 그래프 기능 진입 여부(state.view)와는 무관하다.
const SURFACE_SETTINGS = 'settings';
const SURFACES = [SURFACE_SUMMARY, SURFACE_MAP, SURFACE_SETTINGS];

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
  if (!SURFACES.includes(surface)) return state;
  if (surface === state.surface) return state;
  return { ...state, surface };
}

// 요약⇄그래프 토글 — 사이드바 모드 네비가 생기기 전부터 있던 2값 순환기다. 지금도
// 유일한 실사용처(verify.js의 toggle() 직접 호출)가 요약⇄그래프 왕복 전용이라 이
// 계약을 그대로 굳힌다: agent/plugin 상태에서 불릴 근거가 없으므로 그 경우는 no-op으로
// 확정한다 — 상태를 그대로 돌려준다, 다른 모드로 튀지 않는다.
// 그래프에서 요약으로 나가면 펼침과 선택을 버린다 — 돌아왔을 때 사용자가 기억하지
// 못하는 상태에 놓여 있으면 방향을 잃는다.
function toggleView(state) {
  if (state.view !== VIEW_SUMMARY && state.view !== VIEW_GRAPH) return state;
  if (state.view === VIEW_GRAPH) {
    return { ...state, view: VIEW_SUMMARY, stage: STAGE_CLUSTERS, expandedCluster: null, selectedEntityId: null, panel: null };
  }
  return { ...state, view: VIEW_GRAPH };
}

// 5값 독립 전이 — toggleView를 재사용하지 않는다. toggleView는 summary⇄graph
// 2값 하드코딩이라 setView(state,'agent')를 재사용하면 무조건 VIEW_GRAPH로
// 튄다(실사용 결함, Rev.2에서 발견). 요청된 view를 직접 대입하고, 그래프를
// 떠날 때만(목적지가 무엇이든) 펼침·선택을 버린다 — 그 상태는 그래프 밖에서
// 의미가 없다.
function setView(state, view) {
  if (view !== VIEW_SUMMARY && view !== VIEW_GRAPH && view !== VIEW_AGENT && view !== VIEW_PLUGIN && view !== VIEW_BACKTEST) return state;
  if (view === state.view) return state;
  if (state.view === VIEW_GRAPH) {
    return { ...state, view, stage: STAGE_CLUSTERS, expandedCluster: null, selectedEntityId: null, panel: null };
  }
  return { ...state, view };
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

// 지금 그려야 할 노드. 1단계는 전부, 2단계는 **펼친 군집 + 그 이웃 1홉**.
//
// **왜 이웃까지 보이나(보드 04).** 옛 판은 펼친 군집 하나만 남겼다. 그러면 그래프
// 모드의 핵심 질문 — "이 군집이 바깥과 어떻게 이어져 있나" — 에 화면이 답을 못
// 한다. 군집 경계를 넘는 연결(= 숨은 연관)은 정의상 한쪽 끝이 다른 군집인데,
// 그 끝을 지우면 숨은 연관 자체가 2단계에서 사라진다. Paper 보드 04가 펼친
// 군집 옆에 이웃 군집 타원과 군집 밖 컨텍스트 노드(금리 인하·원/달러 환율)를
// 함께 그린 이유가 이것이다.
//
// 1홉에서 끊는다 — 2홉까지 열면 큰 그래프에서 사실상 전체가 되어 "펼침"이라는
// 말이 무의미해진다.
function visibleNodes(state, layout) {
  const nodes = Array.isArray(layout && layout.nodes) ? layout.nodes : [];
  if (state.stage !== STAGE_EXPANDED || state.expandedCluster === null) return nodes;
  const core = new Set(
    nodes.filter((node) => node.cluster === state.expandedCluster).map((node) => node.entity_id)
  );
  if (core.size === 0) return [];
  const edges = Array.isArray(layout && layout.edges) ? layout.edges : [];
  const neighbours = new Set();
  for (const edge of edges) {
    if (core.has(edge.from) && !core.has(edge.to)) neighbours.add(edge.to);
    else if (core.has(edge.to) && !core.has(edge.from)) neighbours.add(edge.from);
  }
  return nodes.filter((node) => core.has(node.entity_id) || neighbours.has(node.entity_id));
}

// 지금 그려야 할 엣지. 2단계에서는 양 끝이 모두 보이는 것만 — 한쪽이 화면 밖인 선을
// 그리면 어디로도 가지 않는 선이 된다. 이웃끼리의 연결(둘 다 펼친 군집 밖)도
// 양 끝이 보이면 그린다: 보드 04에서 이웃 군집 내부 구조가 보이는 것이 그 군집을
// 하나의 덩어리로 읽게 해 준다.
//
// controller.js는 2단계에서 보이는 부분집합을 **다시 배치**하므로(캔버스를 채우기
// 위해) 이 함수 대신 그 재배치 결과의 edges를 쓴다. 여기 남아 있는 이유는 배치
// 없이 "무엇이 보이는가"만 묻는 순수 계약이라 상태 기계 테스트가 그것을 재기
// 때문이다 — visibleNodes와 짝을 이룬다.
function visibleEdges(state, layout) {
  const edges = Array.isArray(layout && layout.edges) ? layout.edges : [];
  if (state.stage !== STAGE_EXPANDED || state.expandedCluster === null) return edges;
  const visible = new Set(visibleNodes(state, layout).map((node) => node.entity_id));
  return edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to));
}

const __exports = {
  VIEW_SUMMARY,
  VIEW_GRAPH,
  VIEW_AGENT,
  VIEW_PLUGIN,
  VIEW_BACKTEST,
  SURFACE_SUMMARY,
  SURFACE_MAP,
  SURFACE_SETTINGS,
  SURFACES,
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
