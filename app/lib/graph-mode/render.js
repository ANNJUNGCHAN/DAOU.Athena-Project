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

// 2단계 노드 계층 분류(스텝12, §0 r4 "근거 불명확한 추정 분류") — Paper가 정확한
// 허브 판정 함수를 안 줘서(정찰 보고서 §2.3 "정확한 함수는 특정할 수 없음") 실행자가
// 정한 컷오프: 그 노드가 속한 군집 안에서 최대 차수의 60% 이상이면 허브, 미만이면
// leaf. 확정적 그래픽(채움색)만으로 끝내지 않고 범례 캡션·title 툴팁으로 "추정
// 분류"임을 신호한다(원칙5).
const HUB_DEGREE_RATIO = 0.6;
const HUB_LEAF_CAPTION = '허브/leaf는 상대 차수 기준 추정 분류';

function classifyHubLeaf(nodes) {
  const maxByCluster = new Map();
  for (const node of nodes) {
    const prev = maxByCluster.get(node.cluster) || 0;
    if ((node.degree || 0) > prev) maxByCluster.set(node.cluster, node.degree || 0);
  }
  const tiers = new Map();
  for (const node of nodes) {
    const max = maxByCluster.get(node.cluster) || 0;
    tiers.set(node.entity_id, max > 0 && (node.degree || 0) >= max * HUB_DEGREE_RATIO ? 'hub' : 'leaf');
  }
  return tiers;
}

// 군집 배경 타원(스텝12, 보드 15 §2.3) — placed.clusters의 x/y/radius는 이 함수까지
// 안 전해진다(controller.js가 대상 파일 밖이라 layout은 {nodes,edges}만 받는다,
// 스텝11의 clusterEdges와 같은 사정) — 그래서 지금 그려지는 노드들의 바운딩
// 박스로 대신 계산한다(새 좌표 체계를 발명하는 게 아니라 이미 배치된 노드
// 좌표를 그대로 감싸는 것뿐). 2단계는 지금 펼친 군집 하나만 보여주므로
// (graph-mode-store.js의 visibleNodes가 expandedCluster로만 거른다 — 정찰
// 보고서가 관찰한 "군집 타원 없는 컨텍스트 노드"까지 보여주려면 그 필터 자체를
// 바꿔야 해서 이번 스텝 범위 밖이다) 타원도 항상 하나만 그리면 된다.
function clusterEllipseBounds(nodes) {
  if (!nodes.length) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const r = node.radius || 0;
    minX = Math.min(minX, node.x - r);
    maxX = Math.max(maxX, node.x + r);
    minY = Math.min(minY, node.y - r);
    maxY = Math.max(maxY, node.y + r);
  }
  const padX = Math.max(30, (maxX - minX) * 0.18);
  const padY = Math.max(30, (maxY - minY) * 0.22);
  return {
    cluster: nodes[0].cluster,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    rx: (maxX - minX) / 2 + padX,
    ry: (maxY - minY) / 2 + padY,
    left: minX - padX,
    top: minY - padY,
  };
}

// entity_id 쌍의 무향 키(스텝13) — cluster-layout.js의 entityPairKey와 같은
// 원리지만 render.js는 cluster-layout.js를 require하지 않으므로(새 크로스 의존을
// 만들지 않는다) 이 작은 정규화 한 줄만 따로 둔다.
function entityPairKey(a, b) {
  const [x, y] = String(a) < String(b) ? [a, b] : [b, a];
  return `${x} ${y}`;
}

// 엣지 종류 판정(스텝13) — classifyHubLeaf와 같은 성격의 §0 r4 판단이다.
function classifyEdgeKind(edge, surprisingEntityPairs) {
  if (surprisingEntityPairs && surprisingEntityPairs.has(entityPairKey(edge.from, edge.to))) {
    return 'hidden-link';
  }
  if (edge.confidence === undefined) return null; // 메타데이터 없음 — 폴백(사실과 동일하게 실선).
  return edge.confidence === 'EXTRACTED' ? 'fact' : 'inference';
}

function renderClusterMap(container, layout, options) {
  if (!container) return null;
  const settings = options || {};
  const showLabels = settings.showLabels !== false;
  const highlightCrossings = settings.highlightCrossings !== false;
  const selectedEntityId = settings.selectedEntityId != null ? String(settings.selectedEntityId) : null;
  // 이름 없는 군집 오버라이드(스텝12, §0 r5) — controller.js가 아직 안 채워주는
  // 선택적 입력이다(대상 파일 밖이라 배선하지 않는다, 스텝11의 surprisingPairs와
  // 같은 사정). 기본값(둘 다 안 옴)에서는 오버라이드가 항상 꺼진다 — 지금
  // 실제 데이터(0/N, 이름 파이프라인 없음)와 같은 결과라 정직하다.
  const unnamedOverrideEligible = settings.unnamedClusterWarnEligible === true;
  const unnamedClusters = settings.unnamedClusters instanceof Set
    ? settings.unnamedClusters
    : new Set(Array.isArray(settings.unnamedClusters) ? settings.unnamedClusters : []);
  const clusterHasName = settings.clusterName != null; // 지금 보이는(단일) 군집의 이름 여부.
  // 숨은 연관(스텝13) — controller.js가 아직 안 채워주는 선택적 입력이다(스텝11의
  // surprisingPairs·스텝12의 unnamedClusters와 같은 사정, 대상 파일 밖).
  const surprisingEntityPairs = settings.surprisingEntityPairs instanceof Set ? settings.surprisingEntityPairs : null;

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

  // 군집 배경 타원 — 가장 먼저 그린다(엣지·노드보다 아래 깔린다).
  const ellipseLayer = el('g', { class: 'graph-cluster-ellipses' });
  const bounds = clusterEllipseBounds(nodes);
  if (bounds) {
    const ellipseUnnamed = !clusterHasName;
    ellipseLayer.appendChild(el('ellipse', {
      cx: bounds.cx, cy: bounds.cy, rx: bounds.rx, ry: bounds.ry,
      class: ellipseUnnamed ? 'graph-cluster-ellipse is-unnamed-warn' : 'graph-cluster-ellipse',
    }));
    const nameLabel = el('text', {
      x: bounds.left + 8, y: bounds.top + 18,
      class: ellipseUnnamed ? 'graph-cluster-ellipse-label is-unnamed-warn' : 'graph-cluster-ellipse-label',
    });
    // §0 정책 — 이름이 없으면 "군집 N"으로 정직하게 대체한다(지어내지 않는다).
    nameLabel.textContent = settings.clusterName || `군집 ${bounds.cluster}`;
    ellipseLayer.appendChild(nameLabel);
    if (ellipseUnnamed) {
      const badge = el('text', { x: bounds.left + 8, y: bounds.top + 34, class: 'graph-cluster-ellipse-badge' });
      badge.textContent = '이름 없음';
      ellipseLayer.appendChild(badge);
    }
  }
  svg.appendChild(ellipseLayer);

  // 엣지를 먼저 그린다 — SVG는 뒤에 그린 것이 위로 오므로 노드가 선에 가려지지 않는다.
  // 엣지 3종(스텝13, 보드 15 §2.3) — 숨은 연관이 최우선(surprisingEntityPairs와
  // 겹치면 무조건 핑크), 그다음 confidence로 사실/추론을 가른다(§0 r4 "근거
  // 불명확한 추정 분류" — EXTRACTED만 "확정적으로 관측됨"으로 보고 사실, 나머지
  // (INFERRED/AMBIGUOUS 등)는 추론으로 묶는다. Paper는 confidence→사실/추론의
  // 정확한 매핑 규칙을 안 주므로 이 이분법은 실행자 판단이다). edge.confidence가
  // 아예 없으면(스텝13-보정 백엔드 예외 미승인 시절 또는 구버전 backend) 사실/
  // 추론을 가를 근거가 없어 실선(사실과 시각적으로 동일) 하나로 폴백한다 —
  // "메타데이터 부재 허용" 구조, §0 정책과 같은 논리.
  // anyFact는 confidence==='EXTRACTED'가 실제로 확인된 엣지만 센다 — 폴백(kind
  // === null, 메타데이터 자체가 없음)은 "확인 안 됨"이지 "사실 확인됨"이 아니라서
  // 범례에 "사실"이라고 안내하면 없는 확신을 지어내는 셈이다(§0 정책). 스트로크는
  // 폴백도 사실과 같은 실선을 쓰지만(구분할 근거가 없으니), 범례 캡션은 진짜
  // confidence가 있을 때만 뜬다.
  let anyFact = false;
  let anyInference = false;
  let anyHiddenLink = false;
  const edgeLayer = el('g', { class: 'graph-edges' });
  for (const edge of edges) {
    const kind = classifyEdgeKind(edge, surprisingEntityPairs);
    if (kind === 'hidden-link') anyHiddenLink = true;
    else if (kind === 'inference') anyInference = true;
    else if (kind === 'fact') anyFact = true; // null(폴백)은 세지 않는다.
    const classes = ['graph-edge'];
    if (highlightCrossings && edge.crossesCluster) classes.push('is-crossing');
    if (kind === 'hidden-link') classes.push('is-hidden-link');
    else if (kind === 'inference') classes.push('is-inference');
    const line = el('line', {
      x1: edge.x1,
      y1: edge.y1,
      x2: edge.x2,
      y2: edge.y2,
      class: classes.join(' '),
      'data-from': edge.from,
      'data-to': edge.to,
    });
    edgeLayer.appendChild(line);
  }
  svg.appendChild(edgeLayer);

  // 노드 스타일 4계층(스텝12) — 허브/leaf(채움), 선택(테두리 핑크+라벨 볼드,
  // Paper "선택 상태는 크기가 아니라 테두리색+라벨 굵기로 표현" 그대로),
  // 무명 군집 오버라이드(흰 채움 강제+주황 테두리, r5 게이팅). §15 비차단
  // 1번(선택+무명 오버라이드 동시 해당 시 우선순위) — 선택이 우선한다(사용자가
  // 방금 누른 행동 피드백이 상시 상태 경고보다 즉시성이 높다고 판단, 리드 권고
  // 채택): CSS에서 `.is-selected .graph-node-circle` 선택자가 `.is-unnamed-warn`
  // 단독 선택자보다 특이도가 높아 테두리색은 선택이 이긴다 — 다만 흰 채움 강제는
  // 선택 여부와 무관하게 그대로 적용된다(Paper 규칙 "선택은 테두리+라벨만 바꾼다"
  // 그대로, 채움은 선택의 관할이 아니다).
  const tiers = classifyHubLeaf(nodes);
  const nodeLayer = el('g', { class: 'graph-nodes' });
  for (const node of nodes) {
    const isSelected = selectedEntityId !== null && selectedEntityId === String(node.entity_id);
    const tier = tiers.get(node.entity_id) || 'leaf';
    const unnamedOverride = unnamedOverrideEligible && unnamedClusters.has(node.cluster);

    const groupClasses = ['graph-node'];
    if (isSelected) groupClasses.push('is-selected');
    const group = el('g', {
      class: groupClasses.join(' '),
      'data-entity-id': node.entity_id,
      'data-cluster': node.cluster,
      'data-kind': node.kind,
      title: HUB_LEAF_CAPTION,
    });

    const circleClasses = ['graph-node-circle', tier === 'hub' ? 'is-hub' : 'is-leaf'];
    if (unnamedOverride) circleClasses.push('is-unnamed-warn');
    group.appendChild(
      el('circle', { cx: node.x, cy: node.y, r: node.radius, class: circleClasses.join(' ') })
    );
    if (showLabels) {
      const labelClasses = ['graph-label'];
      if (tier === 'hub') labelClasses.push('is-hub');
      const label = el('text', {
        x: node.x,
        y: node.y + node.radius + 12,
        class: labelClasses.join(' '),
        'text-anchor': 'middle',
      });
      label.textContent = node.name;
      group.appendChild(label);
    }
    nodeLayer.appendChild(group);
  }
  svg.appendChild(nodeLayer);

  container.appendChild(svg);
  if (nodes.length > 0) {
    // 범례(보드 15 §2.4, 스텝13) — Paper 스펙 그대로(사실/추론/숨은연관 + spacer +
    // "원 크기 = 연결 수" 우측 정렬)이되, 실제로 화면에 쓰인 종류만 보여준다(§0
    // 정직한 데이터 정책, 스텝11과 같은 패턴) — 항상 뜨는 건 "원 크기=연결 수"뿐,
    // 사실/추론/숨은연관은 그 종류의 엣지가 실제로 하나라도 그려졌을 때만 켠다.
    const legend = elHtml('div', 'graph-node-legend');
    if (anyFact) legend.appendChild(nodeLegendItem('사실 — 말했거나 체결됨', 'is-fact'));
    if (anyInference) legend.appendChild(nodeLegendItem('추론', 'is-inference'));
    if (anyHiddenLink) legend.appendChild(nodeLegendItem('숨은 연관', 'is-hidden-link'));
    legend.appendChild(nodeLegendItem('원 크기 = 연결 수', null, 'is-right'));
    container.appendChild(legend);

    // "추정 분류" 신호 캡션 줄(§0 r4, 원칙5) — 허브/leaf(스텝12)는 항상, confidence
    // 기반 사실/추론(스텝13)은 그 구분이 실제로 쓰였을 때만(메타데이터가 없어
    // 폴백했으면 애초에 구분 자체가 없으니 캡션도 의미가 없다).
    const caption = elHtml('div', 'graph-node-tier-legend');
    const tierCaption = elHtml('span', 'graph-node-tier-caption');
    tierCaption.textContent = HUB_LEAF_CAPTION;
    caption.appendChild(tierCaption);
    if (anyFact && anyInference) {
      const confidenceCaption = elHtml('span', 'graph-node-tier-caption');
      confidenceCaption.textContent = '사실/추론 구분은 confidence 필드 기반 추정';
      caption.appendChild(confidenceCaption);
    }
    container.appendChild(caption);
  }
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

// legendItem과 같은 모양이지만 2단계(개별 노드/엣지) 전용 클래스를 쓴다(스텝13) —
// 1단계 군집 범례(.graph-cluster-legend-*)와 같은 화면에 동시에 뜨는 일이 없어도
// (state.stage가 배타적이다) 이름을 그대로 재사용하면 "군집" 범례로 오해된다 —
// 그래서 별도 클래스 스킴을 쓴다(로직은 legendItem과 동일해 복붙 최소화만 포기).
function nodeLegendItem(text, swatchClass, textClass) {
  const item = elHtml('span', 'graph-node-legend-item');
  if (swatchClass) item.appendChild(elHtml('span', `graph-node-legend-swatch ${swatchClass}`));
  const label = elHtml('span', textClass ? `graph-node-legend-label ${textClass}` : 'graph-node-legend-label');
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
