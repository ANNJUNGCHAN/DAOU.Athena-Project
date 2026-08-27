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

// 응집도가 없을 때(구버전 backend) 쓰는 대체 alpha — §0 원안의 두 대안("동일
// alpha" 또는 "size 기준 상대값") 중 새 스케일을 발명하지 않아도 되는 앞쪽을 쓴다.
const DEFAULT_CLUSTER_ALPHA = 0.35;

function clusterAlpha(cluster) {
  if (Number.isFinite(cluster.cohesion)) {
    // cohesion(0~1)을 alpha에 직접 매핑한다 — 정찰 보고서(paper-14-15-그래프뷰.md:66)가
    // 확인한 건 "응집도와 alpha가 단조 증가"뿐이고 정확한 선형식은 확인 불가하니,
    // 새 스케일을 발명하는 대신 이미 0~1인 값을 그대로 쓴다.
    return Math.max(0, Math.min(1, cluster.cohesion));
  }
  return DEFAULT_CLUSTER_ALPHA;
}

// 군집간 연결선(스텝11) — 정찰 보고서(paper-14-15-그래프뷰.md §1.4)가 확인한 범위
// (굵기 2~7px, alpha 16~26%, 둘 다 "군집 간 연결 수"와 함께 단조 증가)를 재현한다.
// 실선(회색)만 이 스케일을 쓴다 — 핑크/주황은 정찰 보고서에 데이터가 1~2건뿐이라
// count에 따른 스케일 관계를 확인할 근거가 없고, 오히려 관찰된 예시 굵기(핑크
// 2.4px, 주황 1.4~1.6px 평균)가 실선보다 눈에 띄게 얇다 — 굵어질수록 예외
// 신호(핑크/주황)가 통상 신호(회색)보다 시각적으로 더 강해지는 역전을 피하려면
// 고정폭이 더 정직하다(새 스케일을 "발명"하지 않는다는 원칙1의 정신을 여기선
// "확인 안 된 스케일을 안 쓴다"로 적용한다).
const MIN_EDGE_WIDTH = 2;
const MAX_EDGE_WIDTH = 7;
const MIN_EDGE_ALPHA = 0.16;
const MAX_EDGE_ALPHA = 0.26;
const EDGE_SCALE_CAP = 6; // 이 값 이상의 count는 최대 굵기/alpha로 saturate된다.
const HIDDEN_LINK_EDGE_WIDTH = 2.4; // 정찰 보고서 관찰값 그대로.
const UNNAMED_WARN_EDGE_WIDTH = 1.5; // 정찰 보고서 관찰값(1.4/1.6) 평균.

function edgeScale(count) {
  const t = Math.min(1, Math.max(0, (count - 1) / (EDGE_SCALE_CAP - 1)));
  return {
    width: MIN_EDGE_WIDTH + t * (MAX_EDGE_WIDTH - MIN_EDGE_WIDTH),
    alpha: MIN_EDGE_ALPHA + t * (MAX_EDGE_ALPHA - MIN_EDGE_ALPHA),
  };
}

// 군집 버블 지도(스텝10, §0-2 아키텍처 갭 해소) — 그래프 뷰 1단계를 개별 노드
// 나열이 아니라 placed.clusters 소비로 바꾼다. 좌표·반지름은 cluster-layout.js가
// 이미 계산한 값을 그대로 쓴다(새 스케일 발명 안 함, 원칙1) — 이 함수는 그리기만 한다.
function renderClusterBubbles(container, placed, options) {
  if (!container) return null;
  const settings = options || {};
  const clusters = placed && Array.isArray(placed.clusters) ? placed.clusters : [];
  const width = settings.width || container.clientWidth || 0;
  const height = settings.height || container.clientHeight || 0;

  while (container.firstChild) container.removeChild(container.firstChild);

  const svg = el('svg', {
    class: 'graph-canvas',
    viewBox: `0 0 ${Math.max(1, width)} ${Math.max(1, height)}`,
    width: '100%',
    height: '100%',
    role: 'img',
    'aria-label': `테마 지도 — 군집 ${clusters.length}개`,
  });

  // r5 "이름 있음 임계 규칙" — 0 < 이름 붙은 군집 수 < 전체 군집 수일 때만 "이름
  // 없음" 경고 시각 언어(주황+점선)를 켠다. theme-clusters.js의 같은 판정 함수를
  // 그대로 재사용한다(복붙하지 않는다, 원칙1) — cluster-layout.js의 placed.clusters는
  // 지금 name 필드를 안 주므로(이름 파이프라인 없음, §0 발견1) 실제로는 항상 0/N이라
  // 중립 스타일이지만, 이름 필드가 있는 입력(테스트용 모의 데이터 포함)에도 맞게 짠다.
  const namedCount = clusters.filter((c) => c.name).length;
  const warnEligible = window.AthenaLib.ThemeClusters.shouldWarnUnnamed(namedCount, clusters.length);
  const clusterEdges = placed && Array.isArray(placed.clusterEdges) ? placed.clusterEdges : [];
  const clusterById = new Map(clusters.map((c) => [c.cluster, c]));

  // 엣지를 먼저 그린다(renderClusterMap과 같은 이유 — SVG는 나중에 그린 게 위로
  // 온다, 버블이 선에 가려지면 안 된다). 실선/핑크 점선(숨은 연관)/주황 점선(확인
  // 필요) 3종 — 주황은 §0 r5 임계 규칙으로 게이팅한다: 0/N(현재 실제 상태)이면
  // 이 3번째 종류를 아예 안 그리고 실선으로 대체한다(cluster-layout.js 주석 참고 —
  // isSurprising은 surprising-connections가 아직 안 이어져 있어 항상 false다).
  const edgeLayer = el('g', { class: 'graph-cluster-edges' });
  for (const edge of clusterEdges) {
    const clusterA = clusterById.get(edge.from);
    const clusterB = clusterById.get(edge.to);
    if (!clusterA || !clusterB) continue;
    const unnamedRelated = warnEligible && (!clusterA.name || !clusterB.name);
    const { width, alpha } = edgeScale(edge.count);
    let className = 'graph-edge graph-cluster-edge';
    let style;
    if (edge.isSurprising) {
      className += ' is-hidden-link';
      style = `stroke-width: ${HIDDEN_LINK_EDGE_WIDTH}px`;
    } else if (unnamedRelated) {
      className += ' is-unnamed-warn';
      style = `stroke-width: ${UNNAMED_WARN_EDGE_WIDTH}px`;
    } else {
      style = `stroke: rgba(16, 19, 26, ${alpha.toFixed(2)}); stroke-width: ${width.toFixed(1)}px`;
    }
    edgeLayer.appendChild(el('line', {
      x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2,
      class: className,
      style,
      'data-from-cluster': edge.from,
      'data-to-cluster': edge.to,
    }));
  }
  svg.appendChild(edgeLayer);

  const bubbleLayer = el('g', { class: 'graph-cluster-bubbles' });
  const LINE_HEIGHT = 14;
  for (const cluster of clusters) {
    const warn = warnEligible && !cluster.name;
    const alpha = clusterAlpha(cluster);
    // .graph-node — wireNodeClicks()(controller.js)가 이 클래스로 찾아 클릭을 건다.
    // 1단계에서 버블 클릭은 그 군집을 펼치는 뜻이라 data-cluster만 있으면 되고
    // data-entity-id는 필요 없다(handleNodeClick이 1단계에선 무시한다).
    const group = el('g', { class: 'graph-node graph-cluster-bubble-group', 'data-cluster': cluster.cluster });

    group.appendChild(el('circle', {
      cx: cluster.x,
      cy: cluster.y,
      r: cluster.radius,
      class: warn ? 'graph-cluster-bubble is-unnamed-warn' : 'graph-cluster-bubble',
      // 색은 되도록 CSS(토큰)가 정하고, 데이터마다 달라지는 alpha만 인라인으로 얹는다.
      // 무명 경고 버블은 색 자체가 주황(--color-warn)으로 고정이라 fill을 CSS에
      // 맡기고, 통상 버블은 군집 번호로 회전하는 hue라 여기서 계산해야 한다.
      style: warn
        ? `fill-opacity: ${alpha}`
        : `fill: hsl(${clusterHue(cluster.cluster)} 62% 55%); fill-opacity: ${alpha}`,
    }));

    let lineY = cluster.y + cluster.radius + LINE_HEIGHT;
    const nameLabel = el('text', { x: cluster.x, y: lineY, class: 'graph-cluster-label', 'text-anchor': 'middle' });
    nameLabel.textContent = cluster.name || `군집 ${cluster.cluster}`;
    group.appendChild(nameLabel);
    lineY += LINE_HEIGHT;

    // "이름 없음" 배지 텍스트는 경고 스타일 여부와 무관하게 이름이 없으면 항상
    // 표기한다(§0 정책 — 이름 갭 자체는 r5 임계 규칙과 별개로 항상 정직하게 알린다).
    if (!cluster.name) {
      const unnamedBadge = el('text', { x: cluster.x, y: lineY, class: 'graph-cluster-unnamed-badge', 'text-anchor': 'middle' });
      unnamedBadge.textContent = '이름 없음';
      group.appendChild(unnamedBadge);
      lineY += LINE_HEIGHT;
    }

    // 종목 수는 theme-clusters.js의 "N종목" 표기를 그대로 따른다(원칙1) — 응집도는
    // 있을 때만 붙인다(§0 정책, 지어낸 숫자 없음).
    const statsParts = [`${cluster.size}종목`];
    if (Number.isFinite(cluster.cohesion)) statsParts.push(`응집 ${cluster.cohesion.toFixed(2)}`);
    const stats = el('text', {
      x: cluster.x,
      y: lineY,
      class: warn ? 'graph-cluster-stats is-warn' : 'graph-cluster-stats',
      'text-anchor': 'middle',
    });
    stats.textContent = statsParts.join(' · ');
    group.appendChild(stats);

    bubbleLayer.appendChild(group);
  }
  svg.appendChild(bubbleLayer);

  container.appendChild(svg);
  const legend = renderClusterLegend(clusters, clusterEdges, warnEligible);
  if (legend) container.appendChild(legend);
  return svg;
}

// SVG가 아니라 일반 DOM이다(theme-clusters.js의 el()과 같은 이유 — 텍스트 나열이라
// 굳이 SVG일 필요가 없다).
function elHtml(name, className) {
  const node = document.createElement(name);
  if (className) node.setAttribute('class', className);
  return node;
}

function legendItem(text, swatchClass, textClass) {
  const item = elHtml('span', 'graph-cluster-legend-item');
  if (swatchClass) item.appendChild(elHtml('span', `graph-cluster-legend-swatch ${swatchClass}`));
  const label = elHtml('span', textClass ? `graph-cluster-legend-label ${textClass}` : 'graph-cluster-legend-label');
  label.textContent = text;
  item.appendChild(label);
  return item;
}

// 범례(보드 14 §1.5, 스텝11) — 실제로 화면에 쓰인 시각 언어만 설명한다(§0 정직한
// 데이터 정책의 연장 — 안 쓰는 기호의 뜻을 설명하지 않는다). "응집도" 항목은
// 군집 중 하나라도 실제 cohesion이 있어야, "숨은 연관" 항목은 실제로 그 stroke가
// 그려졌어야, "확인 필요" 항목은 r5 임계 규칙이 켜져 있어야 보인다 — 지금(0/N,
// surprising-connections 미배선) 실제로는 처음 두 항목만 뜬다.
function renderClusterLegend(clusters, clusterEdges, warnEligible) {
  const items = [];
  if (clusters.length > 0) items.push(legendItem('원 크기 = 구성원 수'));
  if (clusters.some((c) => Number.isFinite(c.cohesion))) items.push(legendItem('채움 진하기 = 응집도'));
  if (clusterEdges.length > 0) items.push(legendItem('선 굵기 = 군집 간 연결 수', 'is-solid'));
  if (clusterEdges.some((e) => e.isSurprising)) items.push(legendItem('숨은 연관', 'is-hidden-link'));
  if (warnEligible) items.push(legendItem('점선 = 확인 필요', null, 'is-unnamed-warn'));
  if (items.length === 0) return null;

  const legend = elHtml('div', 'graph-cluster-legend');
  items.forEach((item) => legend.appendChild(item));
  return legend;
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
const __exports = { renderClusterMap, renderClusterBubbles, describeRendered, clusterHue };

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.GraphRender = __exports;
}

})();
