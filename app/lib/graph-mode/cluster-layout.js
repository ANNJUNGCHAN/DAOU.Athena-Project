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
    });
  });

  const rawEdges = Array.isArray(payload && payload.edges) ? payload.edges : [];
  const edges = [];
  for (const pair of rawEdges) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const from = placed.get(String(pair[0]));
    const to = placed.get(String(pair[1]));
    // 한쪽 끝이 없는 엣지는 그리지 않는다. 백엔드가 외래키로 막고 있으므로 정상
    // 경로에서는 없지만, 그리다 터지면 화면 전체가 죽는다.
    if (!from || !to) continue;
    edges.push({
      from: from.entity_id,
      to: to.entity_id,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      // 군집을 넘는 엣지는 "놀라운 연결"이다 — 캔버스가 다르게 그린다.
      crossesCluster: from.cluster !== to.cluster,
    });
  }

  return {
    revision: (payload && payload.revision) || 0,
    nodes: [...placed.values()],
    edges,
    clusters,
  };
}

const __exports = {
  layoutClusterMap,
  nodeRadiusPx,
  groupByCluster,
  NODE_RADIUS_MIN_PX,
  NODE_RADIUS_MAX_PX,
  CANVAS_PADDING_PX,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.GraphClusterLayout = __exports;
}

})();
