// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 군집 집계(2026-09-02) — 옛 cluster-layout.js에서 **좌표와 무관한 부분만** 살려낸
// leaf 모듈이다. 정적 SVG 렌더러를 지우면서 배치 계산은 통째로 버렸지만(라이브
// 지도가 자기 좌표를 정한다), "노드를 군집별로 어떻게 묶고 무엇을 대표 이름으로
// 고르는가"는 화면 두 곳이 여전히 쓴다:
//   · theme-clusters.js — 요약 뷰의 테마 군집 카드
//   · controller.js — 지도 헤더 메타("군집 N · 엔티티 M · 미분류 K")와 공통 패널
//
// **왜 leaf로 두나.** 둘 중 하나에 두면 다른 쪽이 상위 모듈을 거꾸로 의존하게 되고,
// 양쪽에 복사하면 요약 뷰의 군집 수와 지도 헤더의 군집 수가 조용히 어긋난다 —
// cluster-layout.js 시절 주석이 "복붙하지 않는다"고 못박은 이유가 그것이다.

// 군집 대표 이름 — kind → 차수 → 이름 순으로 고른다.
//
// 종류를 먼저 보는 이유: 군집에 이름을 붙이는 일이라 **테마가 종목보다 낫다**.
// 종목 이름을 쓰면 "한미반도체 군집"처럼 방금 고른 노드가 자기가 속한 군집의
// 이름이 되는 순환이 생긴다(실측). 마지막 이름 오름차순은 동률을 결정적으로 끊기
// 위한 것이다 — 같은 그래프를 다시 열면 같은 이름이어야 한다.
const REPRESENTATIVE_KIND_RANK = { theme: 0, sector: 1 };

function representativeName(members) {
  let best = null;
  for (const member of members) {
    const name = String((member && member.name) || '');
    if (!name) continue;
    const rank = REPRESENTATIVE_KIND_RANK[String((member && member.kind) || '')] ?? 2;
    const degree = member.degree || 0;
    const better = best === null
      || rank < best.rank
      || (rank === best.rank && degree > best.degree)
      || (rank === best.rank && degree === best.degree && name.localeCompare(best.name) < 0);
    if (better) best = { name, degree, rank };
  }
  return best ? best.name : null;
}

// 군집 번호 오름차순, 군집 안은 entity_id 오름차순. 백엔드가 이미 크기 내림차순으로
// 번호를 매기므로 0번이 가장 크다. 여기서 다시 정렬하지 않으면 Map의 삽입 순서에
// 기대게 되고, 그건 응답 순서가 바뀌면 함께 흔들린다.
// cluster가 정수가 아니면 -1(미분류)로 묶는다 — 화면이 "미분류 K"로 따로 보고한다.
function groupByCluster(nodes) {
  const groups = new Map();
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const key = Number.isInteger(node.cluster) ? node.cluster : -1;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(node);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cluster, members]) => ({
      cluster,
      members: [...members].sort((a, b) => String(a.entity_id).localeCompare(String(b.entity_id))),
    }));
}

// cluster-map 응답을 **좌표 없는** 형태로 정리한다(옛 layoutClusterMap의 자리).
// 헤더 메타와 공통 패널이 읽는 것은 노드·엣지·군집 목록뿐이라 캔버스 치수도, 배치도
// 필요 없다 — 그래서 창 크기가 바뀔 때 다시 계산할 이유도 함께 사라졌다.
function projectPayload(payload) {
  const nodes = Array.isArray(payload && payload.nodes) ? payload.nodes : [];
  const pairs = Array.isArray(payload && payload.edges) ? payload.edges : [];
  const known = new Set(nodes.map((n) => String(n.entity_id)));
  const edges = pairs
    .filter((p) => Array.isArray(p) && p.length === 2
      && known.has(String(p[0])) && known.has(String(p[1])))
    .map(([from, to]) => ({ from, to }));

  const cohesionBy = (payload && payload.cluster_cohesion) || null;
  const aiLabelBy = (payload && payload.cluster_ai_labels) || null;
  const clusters = groupByCluster(nodes).map((group) => ({
    cluster: group.cluster,
    size: group.members.length,
    representative: representativeName(group.members),
    cohesion: cohesionBy ? cohesionBy[group.cluster] : undefined,
    aiLabel: aiLabelBy ? aiLabelBy[group.cluster] : undefined,
  }));

  return { nodes, edges, clusters };
}

const __exports = { groupByCluster, representativeName, projectPayload };

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.ClusterGrouping = __exports;
}

})();
