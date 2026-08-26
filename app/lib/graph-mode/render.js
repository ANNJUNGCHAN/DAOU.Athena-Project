// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 군집 지도를 SVG로 그린다.
//
// **왜 SVG인가.** `canvas.js`에 `getContext`가 0건이고 DOM 조작이 145건이다 — 이 리포의
// 캔버스는 이름만 캔버스이고 실제로는 DOM 카드 모자이크다. SVG는 그 관례 안에 있고,
// `verify.js`가 `capturePage()` 전에 DOM을 세는 방식과도 맞는다. canvas 2D였다면
// 검증이 픽셀 대조밖에 남지 않는다.
//
// **좌표는 이미 정해져 있다.** `cluster-layout.js`가 결정적으로 배치하고, 여기서는
// 그리기만 한다. 그리기 코드가 좌표를 다시 계산하면 배치의 결정성이 두 곳에 흩어진다.

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  return node;
}

// 군집 번호를 색상 회전에 매핑한다. 번호가 결정적이므로(백엔드가 크기 순으로 매긴다)
// 색도 결정적이다 — 같은 그래프를 다시 열면 같은 색이다.
function clusterHue(cluster) {
  const index = Number.isInteger(cluster) && cluster >= 0 ? cluster : 0;
  return (index * 47) % 360;
}

function renderClusterMap(container, layout, options) {
  if (!container) return null;
  const settings = options || {};
  const showLabels = settings.showLabels !== false;
  const highlightCrossings = settings.highlightCrossings !== false;
  const selectedEntityId = settings.selectedEntityId != null ? String(settings.selectedEntityId) : null;

  const nodes = (layout && layout.nodes) || [];
  const edges = (layout && layout.edges) || [];
  const width = settings.width || container.clientWidth || 0;
  const height = settings.height || container.clientHeight || 0;

  while (container.firstChild) container.removeChild(container.firstChild);

  const svg = el('svg', {
    class: 'graph-canvas',
    viewBox: `0 0 ${Math.max(1, width)} ${Math.max(1, height)}`,
    width: '100%',
    height: '100%',
    role: 'img',
    // 스크린리더가 노드를 하나씩 읽으면 수백 줄이 된다. 요약 하나로 대신한다.
    'aria-label': `투자 성향 그래프 — 노드 ${nodes.length}개, 연결 ${edges.length}개`,
  });

  // 엣지를 먼저 그린다 — SVG는 뒤에 그린 것이 위로 오므로 노드가 선에 가려지지 않는다.
  const edgeLayer = el('g', { class: 'graph-edges' });
  for (const edge of edges) {
    const line = el('line', {
      x1: edge.x1,
      y1: edge.y1,
      x2: edge.x2,
      y2: edge.y2,
      class:
        highlightCrossings && edge.crossesCluster
          ? 'graph-edge is-crossing'
          : 'graph-edge',
      'data-from': edge.from,
      'data-to': edge.to,
    });
    edgeLayer.appendChild(line);
  }
  svg.appendChild(edgeLayer);

  const nodeLayer = el('g', { class: 'graph-nodes' });
  for (const node of nodes) {
    const isSelected = selectedEntityId !== null && selectedEntityId === String(node.entity_id);
    const group = el('g', {
      class: isSelected ? 'graph-node is-selected' : 'graph-node',
      'data-entity-id': node.entity_id,
      'data-cluster': node.cluster,
      'data-kind': node.kind,
    });
    group.appendChild(
      el('circle', {
        cx: node.x,
        cy: node.y,
        r: node.radius,
        fill: `hsl(${clusterHue(node.cluster)} 62% 55% / 0.85)`,
      })
    );
    if (showLabels) {
      const label = el('text', {
        x: node.x,
        y: node.y + node.radius + 12,
        class: 'graph-label',
        'text-anchor': 'middle',
      });
      label.textContent = node.name;
      group.appendChild(label);
    }
    nodeLayer.appendChild(group);
  }
  svg.appendChild(nodeLayer);

  container.appendChild(svg);
  return svg;
}

// `verify.js`와 캔버스가 같은 질문에 같은 답을 하게 하는 함수.
// "비어 있지 않은가"를 두 곳에서 따로 정의하면 하나가 거짓말할 수 있다.
function describeRendered(container) {
  const svg = container && container.querySelector('svg.graph-canvas');
  if (!svg) return { rendered: false, nodes: 0, edges: 0, labels: 0 };
  return {
    rendered: true,
    nodes: svg.querySelectorAll('.graph-node').length,
    edges: svg.querySelectorAll('.graph-edge').length,
    labels: svg.querySelectorAll('.graph-label').length,
  };
}

// SVG_NS는 내보내지 않는다 — 이 파일 안에서만 쓰이고, 쓰는 쪽이 생기면 그때
// 내보내면 된다. 아무도 안 쓰는 export는 "누군가 쓰고 있다"는 신호를 헛되이 준다.
const __exports = { renderClusterMap, describeRendered, clusterHue };

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.GraphRender = __exports;
}

})();
