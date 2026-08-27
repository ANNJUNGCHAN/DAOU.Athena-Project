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

// 그래프 뷰 헤더 메타 텍스트(보드 14 §1.2/15 §2.2, 스텝9) — state.stage로
// 분기한다. 1단계('clusters'): "군집 N개 · 엔티티 M · 미분류 K" — K는 §0
// 발견5의 방어 코드(cluster-layout.js groupByCluster가 이미 -1로 묶어 둔 것)를
// 그대로 센다. 2단계('expanded'): "엔티티 M · 관계 E · 군집 N" — 순서가
// 바뀌고 미분류가 빠지며 관계 수(필터 전 원본 payload.edges)가 새로 들어간다
// (Paper 표 그대로). 모듈 스코프 순수 함수라 stage는 문자열 리터럴로 비교한다
// (graph-mode-store.js의 STAGE_EXPANDED 값과 반드시 같아야 한다 — 이 파일이
// createGraphModeController(deps) 밖에서도 테스트 가능해야 해서 store 주입에
// 기대지 않는다).
function computeGraphHeaderMeta(stage, payload, placed) {
  if (!payload || !placed) return '';
  const entityCount = Array.isArray(payload.nodes) ? payload.nodes.length : 0;
  const clusterCount = Array.isArray(placed.clusters) ? placed.clusters.length : 0;
  if (stage === 'expanded') {
    const relationCount = Array.isArray(payload.edges) ? payload.edges.length : 0;
    return `엔티티 ${entityCount} · 관계 ${relationCount} · 군집 ${clusterCount}`;
  }
  const unassignedCount = Array.isArray(placed.nodes)
    ? placed.nodes.filter((n) => n.cluster === -1).length
    : 0;
  return `군집 ${clusterCount}개 · 엔티티 ${entityCount} · 미분류 ${unassignedCount}`;
}

// ── 엔티티 타임라인(§10-4 최근 변화, WP-G) — 순수 헬퍼 3벌 ────────────────────
//
// computeGraphHeaderMeta와 같은 이유로 모듈 스코프 순수 함수다 —
// createGraphModeController(deps) 밖에서도 테스트 가능해야 한다.

// 날짜는 절대 MM-DD(G-G1, Paper 15 §2.5 실측 — Geist Mono 44px 고정폭 열).
// relativeDaysText(summary-table.js)와 다른 포맷인 이유: Paper가 명시적으로
// 절대 날짜를 그렸고 원칙3(Paper 우선)이 앱 내부 관례보다 앞선다.
// 파싱 불가면 빈 문자열 — 지어내지 않는다.
function formatEventDate(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// relation 한글 사전(G-G5: 이 패널 로컬 상수 — 공유 모듈화는 실사용 후 필요성
// 확인 시 후속). 어휘는 백엔드 RelationKind(ontology.py:78-95) 전체를 덮고,
// 미등록 relation은 원문 그대로 폴백한다(summary-table.js 기존 관례와 동일 —
// 지어낸 한글을 강제하지 않음).
const RELATION_LABELS = {
  relates_to: '연관',
  interested_in: '관심',
  prefers: '선호',
  owns: '보유',
  traded: '매매',
  researched: '탐색',
  belongs_to: '소속',
  exposed_to: '노출',
  avoids: '회피',
  targets: '목표',
};

// confidence 한글 라벨 — 원래 createGraphModeController 안(패널 티어 대조 카드
// 전용)에 있던 것을 타임라인 문구 조립(timelineEventText)과 공유하려고 모듈
// 스코프로 올렸다. 값은 그대로다(Paper 행2 "추론 → 사실로 승격"이 정확히 이 어휘).
const PANEL_CONFIDENCE_LABELS = { EXTRACTED: '사실', INFERRED: '추론', AMBIGUOUS: '불확실' };

// confidence 위계(edge_changed의 "승격" 판정 전용) — 상승만 "…로 승격"(G-G4),
// 하강·동일·한쪽 미상은 전부 방어적 중립 "신뢰도 변경"으로 통일한다.
const CONFIDENCE_RANK = { AMBIGUOUS: 0, INFERRED: 1, EXTRACTED: 2 };

// GraphEventOp별 문구 조립(G-G6 초안 그대로 채택 — Paper 대응 사례가 없는 op는
// GraphEventOp 주석 의미로 직역). entity_added의 대화 제목 인용구는 backend에
// 대응 필드가 없어 조립하지 않는다(G-G3, §0 정직성 원칙).
function timelineEventText(event) {
  const rel = event.relation ? (RELATION_LABELS[event.relation] || event.relation) : '';
  switch (event.op) {
    case 'entity_added': return '노드 처음 생김';
    case 'entity_removed': return '노드 제거됨';
    case 'entity_merged': return '다른 노드와 병합됨';
    case 'edge_added': return rel ? `관계 추가됨(${rel})` : '관계 추가됨';
    case 'edge_removed': return rel ? `관계 제거됨(${rel})` : '관계 제거됨';
    case 'edge_rejected': return rel ? `제안된 관계가 기각됨(${rel})` : '제안된 관계가 기각됨';
    case 'edge_changed': {
      const before = event.confidence_before;
      const after = event.confidence_after;
      const prefix = rel ? `${rel} 관계 ` : '관계 ';
      if (before && after && CONFIDENCE_RANK[after] > CONFIDENCE_RANK[before]) {
        const beforeLabel = PANEL_CONFIDENCE_LABELS[before] || before;
        const afterLabel = PANEL_CONFIDENCE_LABELS[after] || after;
        return `${prefix}${beforeLabel} → ${afterLabel}로 승격`;
      }
      return `${prefix}신뢰도 변경`;
    }
    default: return event.op; // 미등록 op도 원문 폴백 — relation 폴백과 같은 규칙.
  }
}

// EntityEventOut[] → 패널 행 [{date, text}] — 렌더(G3)가 그대로 소비한다.
function buildTimelineRows(events) {
  if (!Array.isArray(events)) return [];
  return events
    .filter(Boolean)
    .map((event) => ({ date: formatEventDate(event.at), text: timelineEventText(event) }));
}

function createGraphModeController(deps) {
  const {
    store,          // graph-mode-store
    layout,         // cluster-layout
    render,         // render
    prefs,          // graph-mode-prefs (선택)
    elements,       // { pill, summary, graph(가시성 전용 — applyVisibility()만 소유),
                    //   graphBody(렌더·클릭위임·크기측정 전용), summaryTable(선택 —
                    //   보드 07 성향 신호 표, 가시성 전용), panel(선택) — 보드 07/15의
                    //   "공통 패널", graphHeaderMeta(선택) — 보드 14/15 헤더 메타
                    //   텍스트(스텝9), mapGuide(선택) — 지도 안내 바(스텝9, 1단계 전용) }
    fetchClusterMap, // async () => payload
    onError,        // (err) => void (선택)
    onPanelCta,     // () => void (선택) — 공통 패널 CTA "채팅에서 답하기" 클릭 시(스텝8)
    // 스텝14 — 스텝11(숨은 연관 군집 쌍)·13(숨은 연관 엔티티 쌍)이 캡able로만
    // 만들어 뒀던 옵션을 실제로 채우는 두 소스. 둘 다 선택(없으면 그 기능이
    // 조용히 꺼진다 — §0 정직한 빈 데이터와 같은 논리) — canvas.js가 이미
    // loadHiddenLinks()/profile-summary 표 로드로 fetch해 둔 결과를 그대로
    // 캐시로 얹는다(이중 fetch 금지, 리드 지침).
    getSurprisingConnections, // () => connections[] (선택) — surprising-connections 원본.
    getProfileSummaryEntries, // () => entries[] (선택) — profile-summary 원본.
    // §10-4 최근 변화(WP-G) — 위 두 소스와 달리 동기 캐시가 아니라 entity_id별
    // IPC 왕복이 필요한 호출당 API라 async 함수로 주입받는다. 없으면 섹션이
    // 조용히 꺼진다(다른 선택 주입과 같은 계약).
    fetchEntityTimeline,      // async (entityId) => events[] (선택) — entity-timeline 원본.
  } = deps;

  let state = store.createInitialState();
  let lastDrawnRevision = null;
  let lastPlaced = null; // 마지막으로 받은 배치. 펼침·접기·선택은 새 fetch 없이 이걸 다시 필터링해서 그린다.
  // 그래프 뷰 헤더 메타 텍스트(보드 14/15, 스텝9)의 "관계 E"는 필터 전 원본
  // 엣지 수여야 한다 — lastPlaced.edges는 이미 유효한 것만 걸러진 배치
  // 결과라 다르다. payload를 따로 캐싱해 redraw 시에도 재사용한다.
  let lastPayload = null;
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
    // profile-summary에 같은 entity_id가 있으면(그래프 노드와 성향 신호 표는
    // 서로 다른 엔드포인트라 항상 겹치진 않는다) 그 항목의 근거·신뢰도·보강
    // 수까지 얹는다 — table 선택 경로(summary-table.js의 panelDataFor())와
    // 같은 수준의 패널을 그래프 선택에서도 보여줄 수 있으면 보여준다(스텝14,
    // §0 정책 — 있는 걸 재사용할 뿐 지어내지 않는다).
    const profileEntry = typeof getProfileSummaryEntries === 'function'
      ? (getProfileSummaryEntries() || []).find((e) => e && e.entity_id === entityId)
      : null;
    const panelData = {
      entityId,
      source: 'node', // §15 선택 출처 태그 — summary-table.js의 'table'과 짝.
      name: (node && node.name) || (profileEntry && profileEntry.entity_name) || undefined,
      kind: (node && node.kind) || (profileEntry && profileEntry.entity_kind) || undefined,
      cluster: node ? node.cluster : undefined,
      degree: node ? node.degree : undefined,
      relation: profileEntry ? profileEntry.relation_kind : undefined,
      rationale: profileEntry ? profileEntry.rationale : undefined,
      reinforcement: profileEntry ? profileEntry.reinforcement : undefined,
      confidence: profileEntry ? profileEntry.confidence : undefined,
      tier: profileEntry ? profileEntry.tier : undefined,
    };
    state = store.selectEntity(state, entityId, panelData);
    renderSelection();
  }

  // 관계 목록(보드 15 §2.5-③, 스텝14) — 선택 엔티티가 걸린 surprising-connections를
  // "숨은" 관계 행으로 보여준다. profile-summary 자체 관계(관심 등)는 이미
  // 위 티어 대조 카드가 보여주므로 여기선 숨은 연관만 더한다(같은 정보를 두
  // 곳에 중복 표기하지 않는다) — 데이터가 없으면(§0 정책) 빈 배열, 섹션 자체를
  // 안 그린다.
  function buildHiddenRelationships(entityId) {
    if (typeof getSurprisingConnections !== 'function' || !entityId) return [];
    const connections = getSurprisingConnections();
    if (!Array.isArray(connections)) return [];
    return connections
      .filter((c) => c && (c.source_entity_id === entityId || c.target_entity_id === entityId))
      .map((c) => {
        const isSource = c.source_entity_id === entityId;
        return {
          otherName: (isSource ? c.target_name : c.source_name) || (isSource ? c.target_entity_id : c.source_entity_id),
          kinds: Array.isArray(c.kinds) ? c.kinds : [],
        };
      });
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

  // 1단계(clusters)는 군집 버블 집계, 2단계(expanded)는 기존 개별 노드 렌더
  // (스텝10) — draw()/redrawFromCache() 둘 다 이 분기를 타므로 한 곳에 모아
  // 둘이 어긋나지 않게 한다.
  function renderStage(placed) {
    const surprisingConnections = typeof getSurprisingConnections === 'function'
      ? (getSurprisingConnections() || [])
      : [];
    if (state.stage === store.STAGE_CLUSTERS) {
      // 숨은 연관 군집 쌍(스텝11이 캡able로 만들어 둔 것을 스텝14가 배선) —
      // layoutClusterMap()이 자동 계산해 둔 clusterEdges(항상 isSurprising:false)를
      // 실데이터로 다시 계산해 덮어쓴다. surprising-connections는 이미
      // source_cluster/target_cluster를 주므로(SurprisingConnectionOut) 변환
      // 없이 그대로 aggregateClusterEdges에 넘긴다.
      placed.clusterEdges = layout.aggregateClusterEdges(placed, surprisingConnections);
      render.renderClusterBubbles(elements.graphBody, placed, {});
      return;
    }
    const nodes = store.visibleNodes(state, placed);
    const edges = store.visibleEdges(state, placed);
    const settings = prefs ? prefs.readPrefs() : null;
    // 이름 있음 임계 규칙(§0 r5, §15 비차단 2번 — "전체 군집 수"는 그래프
    // 전체 기준)과 지금 펼친 군집의 이름(스텝12가 캡able로 만들어 둔 것을
    // 스텝14가 배선) — 이름 파이프라인이 아직 없어(§0 발견1) namedCount는
    // 실제로 항상 0이지만, 로직은 실데이터가 와도 맞게 짠다. theme-clusters.js의
    // shouldWarnUnnamed()와 같은 규칙이지만 이 판정 하나 때문에 새
    // window.AthenaLib 의존을 걸지 않고 인라인으로 둔다(이 파일은 이미 store
    // 주입 패턴이라 전역 참조를 안 만드는 게 원래 계약).
    const clusters = Array.isArray(placed.clusters) ? placed.clusters : [];
    const namedCount = clusters.filter((c) => c.name).length;
    const unnamedClusterWarnEligible = namedCount > 0 && namedCount < clusters.length;
    const unnamedClusters = clusters.filter((c) => !c.name).map((c) => c.cluster);
    const expandedCluster = clusters.find((c) => c.cluster === state.expandedCluster);
    const surprisingEntityPairs = new Set(
      surprisingConnections
        .filter((c) => c && c.source_entity_id != null && c.target_entity_id != null)
        .map((c) => render.entityPairKey(c.source_entity_id, c.target_entity_id))
    );
    render.renderClusterMap(elements.graphBody, { nodes, edges }, {
      showLabels: prefs ? prefs.shouldShowLabels(settings, nodes.length) : true,
      highlightCrossings: settings ? settings.highlightCrossings : true,
      selectedEntityId: state.selectedEntityId,
      clusterName: expandedCluster ? expandedCluster.name : undefined,
      unnamedClusterWarnEligible,
      unnamedClusters,
      surprisingEntityPairs,
    });
  }

  // 지금 상태로 마지막 배치를 다시 그린다 — 펼침·접기·선택 전부 이 경로를 탄다.
  // 배치는 이미 있으니 무엇을 보여줄지만 바뀐다, 네트워크 왕복이 필요 없다.
  function redrawFromCache() {
    if (!lastPlaced || !elements.graphBody) return;
    renderStage(lastPlaced);
    wireNodeClicks();
    renderSelection();
    renderGraphHeader();
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

  // 헤더 메타 텍스트 + 지도 안내 바(보드 14 §1.3, 06/07 안내 바와 달리 1단계
  // 전용) 갱신 — draw()/redrawFromCache()/renderUnavailable() 끝에서 부른다.
  // 안내 바의 hidden은 이 함수 하나가 소유한다(applyVisibility()가 #graphCanvas
  // 전체를 숨기면 자식인 #graphHeader와 함께 자동으로 숨으므로, 이 로직은
  // 1단계⇄2단계 전환에만 관여하고 답변⇄그래프 모드 전환과는 무관하다).
  function renderGraphHeader() {
    if (elements.graphHeaderMeta) {
      elements.graphHeaderMeta.textContent = computeGraphHeaderMeta(state.stage, lastPayload, lastPlaced);
    }
    if (elements.mapGuide) {
      elements.mapGuide.hidden = state.stage !== store.STAGE_CLUSTERS;
    }
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

  // §10-4 최근 변화(보드 15 §2.5, WP-G) — 2단계 렌더의 채움 단계. 응답 시점의
  // 실제 DOM에서 섹션을 다시 찾는다(선점해 둔 closure 노드는 같은 엔티티
  // 재렌더로 이미 교체됐을 수 있다). 행이 없으면 섹션을 걷어낸다 — 빈 섹션보다
  // 아예 없는 편이 정직하다(§0 정책).
  function fillTimelineSection(entityId, rows) {
    const panel = elements.panel;
    // stale 응답 가드 — 빠른 재선택으로 이미 다른 엔티티가 선택됐거나 선택이
    // 해제됐으면, 늦게 도착한 이 응답이 최신 선택 결과를 덮어쓰지 않게 버린다.
    if (!panel || state.selectedEntityId !== entityId) return;
    const section = panel.querySelector('.panel-recent-changes');
    if (!section) return;
    if (rows.length === 0) {
      panel.removeChild(section);
      return;
    }
    while (section.firstChild) section.removeChild(section.firstChild);
    const title = elp('div', 'panel-recent-changes-title');
    title.textContent = '최근 변화';
    section.appendChild(title);
    for (const row of rows) {
      const rowEl = elp('div', 'panel-change-row');
      const date = elp('span', 'panel-change-date');
      date.textContent = row.date;
      rowEl.appendChild(date);
      const desc = elp('span', 'panel-change-desc');
      desc.textContent = row.text;
      rowEl.appendChild(desc);
      section.appendChild(rowEl);
    }
    section.hidden = false;
  }

  // 공통 패널 콘텐츠(보드 07 §10, 스텝8). §10-1 탭("이력" 탭은 Paper에 콘텐츠
  // 스펙이 없어 클릭해도 전환 없음, §6 범위 밖) · §10-2 선택 헤더 · §10-3 티어
  // 대조(가용 필드가 rationale/confidence/tier뿐이라 두 카드 비교 "어긋남"
  // 대신 단일 카드로 축소, §0 정책) · §10-4 최근 변화(엔티티 타임라인, WP-G —
  // 유일한 비동기 채움 섹션, 아래 주석 참고) · §10-5 CTA를 그린다.
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

    // 관계 목록(보드 15 §2.5-③, 스텝14) — 숨은 연관(surprising-connections)만
    // 얹는다(위 티어 대조 카드가 이미 profile-summary 자체 관계를 보여준다).
    // 하나도 없으면(§0 정책) 섹션 자체를 안 그린다 — 빈 "이 노드의 관계" 제목만
    // 뜨는 건 없는 것보다 못하다.
    const hiddenRelations = buildHiddenRelationships(data.entityId);
    if (hiddenRelations.length > 0) {
      const relations = elp('div', 'panel-relations');
      const title = elp('div', 'panel-relations-title');
      title.textContent = '이 노드의 관계';
      relations.appendChild(title);
      for (const rel of hiddenRelations) {
        const row = elp('div', 'panel-relation-row');
        row.appendChild(elp('span', 'panel-relation-dot is-hidden'));
        const label = elp('span', 'panel-relation-label is-hidden');
        label.textContent = '숨은';
        row.appendChild(label);
        const desc = elp('span', 'panel-relation-desc');
        desc.textContent = rel.kinds.length > 0 ? `${rel.otherName} (${rel.kinds.join(' · ')})` : rel.otherName;
        row.appendChild(desc);
        relations.appendChild(row);
      }
      panel.appendChild(relations);
    }

    // §10-4 최근 변화(보드 15 §2.5, WP-G) — 유일한 비동기 채움 섹션(2단계
    // 렌더, G-G2). 다른 섹션은 전부 동기 캐시 조회지만 엔티티 타임라인은
    // entity_id별 IPC 왕복이라 첫 렌더 시점엔 데이터가 없다. 섹션 자리를
    // hidden으로 먼저 선점해 CTA보다 앞 순서를 고정해 두고(fake-dom에
    // insertBefore가 없어 자리 선점이 가장 단순하다), 응답이 오면
    // fillTimelineSection()이 채우거나(행 있음) 걷어낸다(행 없음·실패).
    // selectNode()/selectEntity()의 동기 계약은 그대로다 — 이 fetch를
    // 기다리지 않는다.
    if (typeof fetchEntityTimeline === 'function' && data.entityId) {
      const section = elp('div', 'panel-recent-changes');
      section.hidden = true;
      panel.appendChild(section);
      const requestedEntityId = data.entityId;
      Promise.resolve()
        .then(() => fetchEntityTimeline(requestedEntityId))
        .then((events) => fillTimelineSection(requestedEntityId, buildTimelineRows(events)))
        // 실패는 빈 상태 유지가 정직하다 — 화면을 깨지 않고 선점해 둔 섹션도
        // 걷어낸다(못 읽은 것을 "변화 없음"처럼 그리지 않으려면 섹션 자체가
        // 없는 게 맞다, renderUnavailable()과 같은 논리).
        .catch(() => fillTimelineSection(requestedEntityId, []));
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
    lastPayload = payload; // 헤더 메타의 "관계 E"(필터 전 원본)가 이 값을 읽는다.
    renderStage(placed);
    wireNodeClicks();
    renderSelection();
    renderGraphHeader();
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

const __exports = { createGraphModeController, computeGraphHeaderMeta, formatEventDate, buildTimelineRows };

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.GraphModeController = __exports;
}

})();
