// IIFE 스코프 격리 — canvas-layout.js와 같은 문법(주석 참조).
(function () {
'use strict';

// 캔버스 빈 상태(보드 05) 수치 행의 순수 계산. IPC 응답을 그대로 넣지 않는다 —
// canvas.js가 athena:brain-cluster-map 응답(body)의 nodes만 뽑아 넘긴다.

// 엔티티·테마 군집 수 — cluster-map의 노드 배열에서 센다. 군집이 배정되지 않은
// 노드는 cluster:-1로 온다(backend get_brain_cluster_map 계약) — 군집 수는
// 배정된 것만 센다. 노드가 0개면 "엔티티 0"을 보여주는 대신 행 자체를 지운다
// (없는 데이터를 있다고 보이지 않는다 — soul.md §8).
function clusterStats(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return null;
  const clusters = new Set();
  for (const node of nodes) {
    if (node && Number.isInteger(node.cluster) && node.cluster >= 0) clusters.add(node.cluster);
  }
  return { entities: nodes.length, clusters: clusters.size };
}

// 확인 필요 힌트 개수 — suggested-questions의 questions 배열 길이. 0건이면 null —
// "확인이 필요한 것 0건이 기다리고 있습니다"는 힌트가 아니라 소음이다.
function suggestedCount(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return null;
  return questions.length;
}

const __exports = { clusterStats, suggestedCount };

// UMD 각주 — sanitize.js·canvas-layout.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.EmptyCanvas = __exports;
}

})();
