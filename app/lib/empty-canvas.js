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

// 빈 캔버스 문구 회전(보드 46 v3, 2026-08-27) — 시간대·성향에 따라 계속 바뀐다.
// 순수 함수: 시각·시드를 받아 결정적으로 고른다(테스트 가능). 성향 문구는
// 브레인이 준 상위 라벨이 있을 때만 풀에 들어간다 — 없는 성향을 지어내지 않는다.
const COPY_GENERIC = { title: '무엇이든 물어보세요', sub: '질문하면 답변 카드가 이 자리에 쌓입니다.' };
const COPY_BY_HOUR = [
  { from: 6, to: 9, title: '장 시작 전, 궁금한 것부터', sub: '오늘 볼 종목을 물어보면 카드로 정리해드립니다.' },
  { from: 9, to: 16, title: '지금 시장이 움직이고 있습니다', sub: '궁금한 종목을 물어보면 카드가 바로 쌓입니다.' },
  { from: 16, to: 20, title: '오늘 장, 정리해볼까요?', sub: '체결과 손익을 물어보면 카드로 정리합니다.' },
  { from: 20, to: 24, title: '장은 닫혔지만 준비는 지금', sub: '내일 볼 종목을 물어보면 미리 정리해드립니다.' },
  { from: 0, to: 6, title: '장은 닫혔지만 준비는 지금', sub: '내일 볼 종목을 물어보면 미리 정리해드립니다.' },
];

function pickEmptyCopy({ hour, profileTop, seed } = {}) {
  const pool = [COPY_GENERIC];
  if (Number.isInteger(hour)) {
    for (const c of COPY_BY_HOUR) {
      if (hour >= c.from && hour < c.to) {
        pool.push({ title: c.title, sub: c.sub });
        break;
      }
    }
  }
  if (typeof profileTop === 'string' && profileTop.trim()) {
    pool.push({
      title: `${profileTop.trim()} 쪽, 요즘 자주 보시죠?`,
      sub: '이어서 물어보면 흐름까지 함께 정리합니다.',
    });
  }
  const idx = Math.abs(Number.isFinite(seed) ? Math.floor(seed) : 0) % pool.length;
  return pool[idx];
}

const __exports = { clusterStats, suggestedCount, pickEmptyCopy };

// UMD 각주 — sanitize.js·canvas-layout.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.EmptyCanvas = __exports;
}

})();
