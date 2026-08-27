// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 그래프 모드 1단계: 군집 지도의 좌표를 정한다.
//
// **왜 렌더러가 좌표를 계산하나.** 백엔드는 군집 *배정*까지만 답한다
// (`GET /api/v1/brain/analysis/cluster-map`). 좌표는 캔버스 크기에 딸린 값이라
// 창을 줄이면 달라지는데, 그때마다 백엔드에 다시 묻는 것은 왕복 낭비다.
//
// **왜 힘 기반 시뮬레이션이 아닌가.** 시뮬레이션은 매번 다른 그림을 낸다 — 같은
// 그래프를 두 번 열면 노드가 다른 자리에 있고, 사용자는 그래프가 바뀐 줄 안다.
// 백엔드가 군집 번호를 결정적으로 매기는 이유(store/projection 참고)를 화면에서
// 무너뜨리면 안 된다. 그래서 **결정적 배치**를 쓴다: 군집을 원형으로 놓고, 군집 안에서
// 노드를 다시 원형으로 놓는다. 같은 입력이면 픽셀까지 같다.

const GOLDEN_ANGLE_RAD = 2.399963229728653; // π(3 − √5)
const MIN_CLUSTER_RADIUS_PX = 48;
const NODE_RADIUS_MIN_PX = 6;
const NODE_RADIUS_MAX_PX = 22;
const CANVAS_PADDING_PX = 40;

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

// 차수를 반지름으로. 중심 노드가 눈에 띄어야 "내 투자의 중심"이라는 질문에 답이 된다.
// 제곱근을 쓰는 이유: 차수는 꼬리가 긴 분포라 선형이면 허브 하나가 화면을 삼킨다.
function nodeRadiusPx(degree, maxDegree) {
  if (!maxDegree || maxDegree <= 0) return NODE_RADIUS_MIN_PX;
  const scale = Math.sqrt(Math.max(0, degree) / maxDegree);
  return NODE_RADIUS_MIN_PX + scale * (NODE_RADIUS_MAX_PX - NODE_RADIUS_MIN_PX);
}

function groupByCluster(nodes) {
  const groups = new Map();
  for (const node of nodes) {
    const key = Number.isInteger(node.cluster) ? node.cluster : -1;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(node);
  }
  // 군집 번호 오름차순, 군집 안은 entity_id 오름차순 — 백엔드가 이미 크기 내림차순으로
  // 번호를 매겼으므로 0번이 가장 크다. 여기서 다시 정렬하지 않으면 Map의 삽입 순서에
  // 기대게 되고, 그건 응답 순서가 바뀌면 함께 흔들린다.
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cluster, members]) => ({
      cluster,
      members: [...members].sort((a, b) => String(a.entity_id).localeCompare(String(b.entity_id))),
    }));
}

// 군집 지도 1단계 배치. 좌표는 결정적이다.
function layoutClusterMap(payload, viewport) {
  const nodes = Array.isArray(payload && payload.nodes) ? payload.nodes : [];
  const width = Math.max(1, (viewport && viewport.width) || 0);
  const height = Math.max(1, (viewport && viewport.height) || 0);
  if (nodes.length === 0) {
    return { revision: (payload && payload.revision) || 0, nodes: [], edges: [], clusters: [] };
  }

  const groups = groupByCluster(nodes);
  const maxDegree = nodes.reduce((acc, node) => Math.max(acc, node.degree || 0), 0);
  // 응집도는 backend가 이미 계산해 주는 값을 통과만 시킨다(여기서 계산하지 않는다).
  // 구버전 backend는 이 필드 자체가 없을 수 있으므로 그때는 undefined로 남겨
  // 소비하는 쪽(스텝6/10)이 §0 원안(생략/size 대체)으로 폴백하게 한다.
  const cohesionByCluster = (payload && payload.cluster_cohesion) || null;
  // WP-F AI 추정 라벨 — cohesion과 같은 순수 통과. name을 채우지 않는다(G-F7:
  // 추정 이름은 name 판정("이름 없음" 배지·namedCount)에 관여하면 안 된다 —
  // theme-clusters.js의 같은 결정을 지도 경로에서도 그대로 따른다).
  const aiLabelByCluster = (payload && payload.cluster_ai_labels) || null;
  const centreX = width / 2;
  const centreY = height / 2;
  const mapRadius = Math.max(
    MIN_CLUSTER_RADIUS_PX,
    Math.min(width, height) / 2 - CANVAS_PADDING_PX
  );

  const placed = new Map();
  const clusters = [];

  groups.forEach((group, index) => {
    // 군집이 하나면 한가운데. 여럿이면 황금각으로 흩는다 — 균등 분할은 군집 수가
    // 바뀔 때 모든 군집이 한꺼번에 움직이지만, 황금각은 기존 자리를 대체로 지킨다.
    const angle = groups.length === 1 ? 0 : index * GOLDEN_ANGLE_RAD;
    const distance = groups.length === 1 ? 0 : mapRadius * Math.sqrt(index / groups.length);
    const clusterX = centreX + Math.cos(angle) * distance;
    const clusterY = centreY + Math.sin(angle) * distance;
    const clusterRadius = Math.max(
      MIN_CLUSTER_RADIUS_PX,
      Math.sqrt(group.members.length) * 26
    );

    group.members.forEach((node, memberIndex) => {
      const memberAngle =
        group.members.length === 1
          ? 0
          : (memberIndex / group.members.length) * Math.PI * 2;
      const memberDistance = group.members.length === 1 ? 0 : clusterRadius;
      placed.set(String(node.entity_id), {
        entity_id: String(node.entity_id),
        name: String(node.name || ''),
        kind: String(node.kind || ''),
        cluster: group.cluster,
        degree: node.degree || 0,
        x: clamp(clusterX + Math.cos(memberAngle) * memberDistance, CANVAS_PADDING_PX, width - CANVAS_PADDING_PX),
        y: clamp(clusterY + Math.sin(memberAngle) * memberDistance, CANVAS_PADDING_PX, height - CANVAS_PADDING_PX),
        radius: nodeRadiusPx(node.degree || 0, maxDegree),
      });
    });

    clusters.push({
      cluster: group.cluster,
      size: group.members.length,
      x: clusterX,
      y: clusterY,
      radius: clusterRadius,
      cohesion: cohesionByCluster ? cohesionByCluster[group.cluster] : undefined,
      aiLabel: aiLabelByCluster ? aiLabelByCluster[group.cluster] : undefined,
    });
  });

  // 엣지 메타데이터(스텝13, 스텝13-보정 백엔드 예외 — additive 필드
  // payload.edge_details[]{source,target,kinds,tier,confidence}). 기존
  // payload.edges(bare [from,to] 쌍)는 절대 안 바뀌므로 이 룩업은 "있으면 보강,
  // 없으면 조용히 undefined로 남긴다"는 관용(tolerant) 구조다 — 백엔드 승인 전
  // (지금)이든 구버전 backend든 안 죽는다(§0 정책과 같은 논리).
  const edgeDetailsByPair = new Map();
  const rawEdgeDetails = Array.isArray(payload && payload.edge_details) ? payload.edge_details : [];
  for (const detail of rawEdgeDetails) {
    if (!detail || detail.source == null || detail.target == null) continue;
    edgeDetailsByPair.set(entityPairKey(detail.source, detail.target), detail);
  }

  const rawEdges = Array.isArray(payload && payload.edges) ? payload.edges : [];
  const edges = [];
  for (const pair of rawEdges) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const from = placed.get(String(pair[0]));
    const to = placed.get(String(pair[1]));
    // 한쪽 끝이 없는 엣지는 그리지 않는다. 백엔드가 외래키로 막고 있으므로 정상
    // 경로에서는 없지만, 그리다 터지면 화면 전체가 죽는다.
    if (!from || !to) continue;
    const detail = edgeDetailsByPair.get(entityPairKey(from.entity_id, to.entity_id));
    edges.push({
      from: from.entity_id,
      to: to.entity_id,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      // 군집을 넘는 엣지는 "놀라운 연결"이다 — 캔버스가 다르게 그린다.
      crossesCluster: from.cluster !== to.cluster,
      kinds: detail ? detail.kinds : undefined,
      tier: detail ? detail.tier : undefined,
      confidence: detail ? detail.confidence : undefined,
    });
  }

  return {
    revision: (payload && payload.revision) || 0,
    nodes: [...placed.values()],
    edges,
    clusters,
    // 군집간 엣지(스텝11) — layoutClusterMap()이 이미 계산한 nodes/edges/clusters
    // 위에서 순수 파생이라 여기서 같이 계산해 둔다(호출부(controller.js)를 안
    // 건드리고 render.renderClusterBubbles가 placed.clusterEdges만 읽으면 되게).
    // surprisingPairs는 아직 어디서도 실제로 주입되지 않는다 — surprising-connections는
    // canvas.js(스텝7)가 별개 카드(숨은 연관 섹션)를 위해 따로 fetch할 뿐, 그 결과를
    // draw()/layoutClusterMap() 호출로 잇는 배선은 이번 스텝 대상 파일(cluster-layout.js/
    // render.js/canvas.css) 밖(controller.js)이라 하지 않는다 — 정직하게 빈 배열로 둔다.
    clusterEdges: aggregateClusterEdges({ revision: (payload && payload.revision) || 0, nodes: [...placed.values()], edges, clusters }),
  };
}

// 개별 엔티티 엣지를 군집 쌍으로 축약한다(스텝11, §0-2 gap-analysis가 지적한
// "군집간 연결선이 없다" 갭 해소). layoutClusterMap()이 이미 계산한 placed
// (nodes/edges/clusters)를 입력으로 받는 순수 함수 — 여기서 좌표를 새로 정하지
// 않고 군집 버블 중심(placed.clusters[i].x/y, 스텝10이 이미 계산)을 그대로 쓴다
// (원칙1, "이미 있는 결정적 배치를 존중"). surprisingPairs(선택, 기본 빈 배열)는
// surprising-connections API 결과의 {source_cluster, target_cluster} 쌍 목록 —
// layoutClusterMap()의 1차 계산은 빈 배열로 부르지만, controller.js(renderStage,
// 스텝14 실배선)가 1단계 렌더마다 실데이터로 다시 불러 그 군집 쌍의
// isSurprising을 true로 덮어쓴다.
function aggregateClusterEdges(placed, surprisingPairs) {
  const nodes = Array.isArray(placed && placed.nodes) ? placed.nodes : [];
  const edges = Array.isArray(placed && placed.edges) ? placed.edges : [];
  const clusters = Array.isArray(placed && placed.clusters) ? placed.clusters : [];
  if (nodes.length === 0 || edges.length === 0 || clusters.length === 0) return [];

  const clusterById = new Map(clusters.map((c) => [c.cluster, c]));
  const nodeCluster = new Map(nodes.map((n) => [n.entity_id, n.cluster]));
  const surprisingKeys = new Set(
    (Array.isArray(surprisingPairs) ? surprisingPairs : [])
      .filter((p) => p && Number.isInteger(p.source_cluster) && Number.isInteger(p.target_cluster))
      .map((p) => pairKey(p.source_cluster, p.target_cluster))
  );

  const counts = new Map(); // "a-b"(a<b) -> 하위 연결 수
  for (const edge of edges) {
    const fromCluster = nodeCluster.get(edge.from);
    const toCluster = nodeCluster.get(edge.to);
    if (!Number.isInteger(fromCluster) || !Number.isInteger(toCluster) || fromCluster === toCluster) continue;
    const key = pairKey(fromCluster, toCluster);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const result = [];
  for (const [key, count] of counts) {
    const [a, b] = key.split('-').map(Number);
    const clusterA = clusterById.get(a);
    const clusterB = clusterById.get(b);
    if (!clusterA || !clusterB) continue;
    result.push({
      from: a,
      to: b,
      x1: clusterA.x,
      y1: clusterA.y,
      x2: clusterB.x,
      y2: clusterB.y,
      count,
      isSurprising: surprisingKeys.has(key),
    });
  }
  return result;
}

function pairKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

// entity_id 쌍의 무향 키(스텝13) — pairKey와 같은 무향 정규화 원리지만, entity_id는
// 임의 문자열이라(해시라 '-'가 들어있을 수 있다) '-' 구분자를 그대로 재사용하면
// 충돌할 수 있어 공백으로 분리한 별도 함수를 둔다(entity_id 자체엔 공백이 없다 —
// summary-table.js가 이미 이 값을 그대로 찍고 있어 알려진 형태다, §0 발견4).
function entityPairKey(a, b) {
  const [x, y] = String(a) < String(b) ? [a, b] : [b, a];
  return `${x} ${y}`;
}

const __exports = {
  layoutClusterMap,
  aggregateClusterEdges,
  nodeRadiusPx,
  groupByCluster,
  NODE_RADIUS_MIN_PX,
  NODE_RADIUS_MAX_PX,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.GraphClusterLayout = __exports;
}

})();
