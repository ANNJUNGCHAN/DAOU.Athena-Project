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

// 2단계 노드 채움 — **성향 신호 표의 dot과 같은 인코딩**이다(summary-table.js
// dotClass): 사실+체결기반은 채움 검정, 불확실은 채움 주황, 나머지는 테두리만.
//
// 옛 판은 "군집 안 최대 차수의 60% 이상이면 허브"라는 차수 기준을 썼는데 두 가지가
// 잘못이었다. 하나는 중복이다 — 원 크기가 이미 연결 수를 말하므로 채움까지 같은
// 값을 말하면 화면에 새 정보가 없다. 다른 하나는 퇴화다: 실제 군집 안에서 차수는
// 2~4로 촘촘해 여덟 노드 중 일곱이 "허브"가 됐다(실측). 모두가 허브면 아무도
// 허브가 아니다.
//
// 지금 인코딩은 표와 지도가 같은 시각 언어를 쓰게 한다 — 표에서 검게 찍힌 신호를
// 지도에서도 검은 원으로 찾을 수 있다. 근거는 profile-summary의 confidence/tier이고,
// 그 값이 없는 노드(성향 신호에 안 잡힌 구조 노드)는 테두리만 남는다 — 모른다는
// 뜻이지 leaf라는 뜻이 아니다.
const NODE_FILL_CAPTION = '채움은 성향 신호 표와 같은 확정성 인코딩';

function classifyNodeFill(nodes, confidenceByEntity) {
  const tiers = new Map();
  for (const node of nodes) {
    const entry = confidenceByEntity ? confidenceByEntity.get(String(node.entity_id)) : null;
    if (entry && entry.confidence === 'EXTRACTED' && entry.tier === 'deterministic') {
      tiers.set(node.entity_id, 'fact');
    } else if (entry && entry.confidence === 'AMBIGUOUS') {
      tiers.set(node.entity_id, 'warn');
    } else {
      tiers.set(node.entity_id, 'soft');
    }
  }
  return tiers;
}

// 군집 배경 타원(보드 04) — placed.clusters의 x/y/radius는 이 함수까지 안
// 전해지므로(layout은 {nodes,edges}만 받는다) 지금 그려지는 노드들의 바운딩
// 박스로 계산한다(새 좌표 체계를 발명하는 게 아니라 이미 배치된 노드 좌표를
// 그대로 감싸는 것뿐).
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

// 타원을 그릴 만큼 모였는가(보드 04 실측) — 펼친 군집은 항상 그리고, 이웃
// 군집은 화면에 3명 이상 보일 때만 그린다. Paper 보드 04에서 배당 방어(4명)와
// 이름 없는 군집(3명)은 타원 안에 있고, 거시 환경 소속인 금리 인하·원/달러
// 환율(2명)은 타원 없이 떠 있다 — 그 경계가 3이다. 2명에 타원을 씌우면 "군집"이
// 아니라 "선 하나 걸린 두 점"을 군집처럼 보여주게 된다.
const ELLIPSE_MIN_NEIGHBOUR_MEMBERS = 3;

// 2단계에 보이는 노드들을 군집별로 나눠 타원 후보를 만든다. 펼친 군집이 먼저
// 오도록 정렬한다 — SVG는 먼저 그린 것이 아래 깔리므로 이웃 타원이 위에 겹쳐도
// 펼친 군집 라벨이 가려지지 않게 하려면 순서가 아니라 라벨 레이어로 풀어야
// 하는데, 실제로는 겹치지 않으므로 읽기 순서만 맞춘다.
function ellipseGroups(nodes, expandedCluster) {
  const byCluster = new Map();
  for (const node of nodes) {
    if (!byCluster.has(node.cluster)) byCluster.set(node.cluster, []);
    byCluster.get(node.cluster).push(node);
  }
  // 어느 군집을 펼쳤는지 모르면 core/이웃을 가를 근거가 없다 — 그때는 임계를
  // 적용하지 않고 보이는 군집을 전부 감싼다(호출자가 이미 걸러 보낸 것으로 본다).
  const knowsExpanded = Number.isInteger(expandedCluster);
  const groups = [];
  for (const [cluster, members] of byCluster) {
    if (cluster === -1) continue; // 미분류는 군집이 아니다 — 타원으로 묶지 않는다.
    const isExpanded = knowsExpanded && cluster === expandedCluster;
    if (knowsExpanded && !isExpanded && members.length < ELLIPSE_MIN_NEIGHBOUR_MEMBERS) continue;
    const bounds = clusterEllipseBounds(members);
    if (bounds) groups.push({ cluster, isExpanded, bounds });
  }
  return groups.sort((a, b) => (a.isExpanded === b.isExpanded ? a.cluster - b.cluster : (a.isExpanded ? -1 : 1)));
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
  // 군집 메타(보드 04) — 타원 이름표가 "{제목} {전체 구성원 수}"를 쓴다. 화면에
  // 보이는 수가 아니라 그 군집의 전체 크기다(보드 04는 5명만 그려 놓고 "반도체
  // 대형주 9"라고 쓴다 — 지금 보이는 것이 전부가 아님을 그 숫자가 알린다).
  // controller.js가 placed.clusters를 그대로 넘긴다. 안 오면 이름표는 번호로 떨어진다.
  const clusterMeta = new Map(
    (Array.isArray(settings.clusters) ? settings.clusters : []).map((c) => [c.cluster, c])
  );
  const expandedCluster = Number.isInteger(settings.expandedCluster) ? settings.expandedCluster : null;
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

  // 군집 배경 타원(보드 04) — 가장 먼저 그린다(엣지·노드보다 아래 깔린다).
  // 펼친 군집 하나 + 화면에 3명 이상 모인 이웃 군집들. 나머지 이웃은 타원 없이
  // 떠 있는 컨텍스트 노드로 남는다(보드 04의 금리 인하·원/달러 환율과 같다).
  const ellipseLayer = el('g', { class: 'graph-cluster-ellipses' });
  for (const group of ellipseGroups(nodes, expandedCluster)) {
    const bounds = group.bounds;
    const meta = clusterMeta.get(group.cluster) || { cluster: group.cluster };
    const warn = unnamedOverrideEligible && unnamedClusters.has(group.cluster);
    const classes = ['graph-cluster-ellipse'];
    if (warn) classes.push('is-unnamed-warn');
    if (!group.isExpanded) classes.push('is-neighbour');
    ellipseLayer.appendChild(el('ellipse', {
      cx: bounds.cx, cy: bounds.cy, rx: bounds.rx, ry: bounds.ry,
      class: classes.join(' '),
      'data-cluster': group.cluster,
    }));

    // 이름표는 타원 좌상단(보드 04) — 제목 + 전체 구성원 수.
    const title = clusterTitle(meta);
    const labelClasses = ['graph-cluster-ellipse-label'];
    if (warn) labelClasses.push('is-unnamed-warn');
    if (title.estimated) labelClasses.push('is-estimated');
    const nameLabel = el('text', {
      x: bounds.left + 8, y: bounds.top + 18, class: labelClasses.join(' '),
    });
    nameLabel.textContent = title.text;
    ellipseLayer.appendChild(nameLabel);

    if (Number.isFinite(meta.size)) {
      const sizeLabel = el('text', {
        x: bounds.left + 8, y: bounds.top + 34, class: 'graph-cluster-ellipse-size',
      });
      // 화면에 보이는 수와 전체 수가 다르면 둘 다 알린다 — "9"만 쓰고 5개를
      // 그려 두면 4개가 어디 갔는지 화면이 답하지 못한다(§0 정직성).
      const visibleCount = nodes.filter((n) => n.cluster === group.cluster).length;
      sizeLabel.textContent = visibleCount < meta.size
        ? `${visibleCount} / ${meta.size}`
        : String(meta.size);
      ellipseLayer.appendChild(sizeLabel);
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
  const confidenceByEntity = settings.nodeConfidence instanceof Map ? settings.nodeConfidence : null;
  const tiers = classifyNodeFill(nodes, confidenceByEntity);
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
      title: NODE_FILL_CAPTION,
    });

    const circleClasses = ['graph-node-circle', `is-${tier}`];
    if (unnamedOverride) circleClasses.push('is-unnamed-warn');
    group.appendChild(
      el('circle', { cx: node.x, cy: node.y, r: node.radius, class: circleClasses.join(' ') })
    );
    if (showLabels) {
      const labelClasses = ['graph-label'];
      if (tier === 'fact') labelClasses.push('is-fact');
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
    tierCaption.textContent = NODE_FILL_CAPTION;
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

// 군집 버블 채움/테두리 alpha(보드 03 실측 회귀) — 옛 판은 cohesion을 alpha에
// 그대로 대입했는데(0.74 → 74% 불투명), Paper의 같은 군집은 16%다. 즉 옛 매핑은
// 버블을 Paper보다 4~5배 진하게 그려 지도가 검게 뭉쳤다. 7개 버블의 실제 채움색을
// 재서 회귀했다:
//   cohesion .38→α.090 · .44→.102 · .51→.122 · .58→.129 · .62→.141 · .74→.161
//   ⇒ α ≈ 0.02 + 0.19·cohesion (테두리는 0.17 + 0.18·cohesion)
// 범례 "채움 진하기 = 응집도"의 단조 증가는 그대로 지키면서 진하기 범위만 Paper에
// 맞춘다.
const FILL_ALPHA_BASE = 0.02;
const FILL_ALPHA_SCALE = 0.19;
const STROKE_ALPHA_BASE = 0.17;
const STROKE_ALPHA_SCALE = 0.18;
// 응집도가 없을 때(구버전 backend) 쓰는 대체 cohesion — 새 스케일을 발명하지 않고
// 위 식의 중간값(0.5)을 통과시킨다.
const DEFAULT_CLUSTER_COHESION = 0.5;

function clusterAlpha(cluster) {
  const cohesion = Number.isFinite(cluster.cohesion)
    ? Math.max(0, Math.min(1, cluster.cohesion))
    : DEFAULT_CLUSTER_COHESION;
  return {
    fill: FILL_ALPHA_BASE + FILL_ALPHA_SCALE * cohesion,
    stroke: STROKE_ALPHA_BASE + STROKE_ALPHA_SCALE * cohesion,
  };
}

// 버블 중앙 숫자의 글자 크기(보드 03 실측) — r52→19px, r22→12px 두 점을 잇는다.
// 큰 버블에 12px를 박으면 숫자가 원 안에서 떠 보이고, 작은 버블에 19px를 박으면
// 원 밖으로 삐져나온다 — Paper가 크기별로 다르게 그린 이유다.
function bubbleCountFontPx(radius) {
  return Math.max(11, Math.min(20, 6.9 + 0.233 * (radius || 0)));
}

// SVG 텍스트 폭 추정(라벨 칩 배경 전용) — SVG는 그리기 전에 폭을 알 수 없고
// fake-dom.js에는 측정 API가 없다. 배경 칩 하나 크기를 정하는 용도라 한글·CJK를
// 글자 크기와 같은 폭, 그 밖(라틴·숫자·기호)을 0.55배로 근사한다. 정확한 값이
// 아니라 **배경이 글자를 덮을 만큼 넉넉한지**만 보장하면 되는 자리다.
function estimateTextWidthPx(text, fontPx) {
  let units = 0;
  for (const ch of String(text || '')) {
    units += /[ᄀ-ᇿ　-ヿ㄰-㆏가-힯＀-｠]/.test(ch) ? 1 : 0.55;
  }
  return units * fontPx;
}

// entity kind → 라벨 앞 절의 한글 단위(보드 03 "종목 9" · "테마 12" 실측).
// 미등록 kind는 원문을 그대로 쓴다 — 지어낸 번역보다 정직하다.
const KIND_UNIT_LABELS = {
  security: '종목',
  company: '기업',
  sector: '섹터',
  theme: '테마',
  goal: '목표',
  preference: '성향',
  risk_signal: '위험',
};

// 군집 제목의 폴백 사다리(보드 03 각주 · WP-F) — 백엔드에 의미적 이름
// 파이프라인이 없어 name은 항상 null이다. 그때 7개 버블이 전부 "이름 없는 군집"이면
// 지도가 서로를 구별하지 못한다(정직하지만 쓸모가 없다). 그래서 AI 추정 라벨 →
// 규칙 기반 대표 → 마지막에야 "이름 없는 군집" 순으로 내려가고, 확정 이름이 아닌
// 단계에서는 `estimated: true`로 신호해 호출부가 "추정" 배지를 붙이게 한다.
function clusterTitle(cluster) {
  if (cluster.name) return { text: cluster.name, estimated: false };
  if (cluster.aiLabel) return { text: cluster.aiLabel, estimated: true };
  if (cluster.representative) return { text: cluster.representative, estimated: true };
  return { text: '이름 없는 군집', estimated: false };
}

// 라벨 아래 줄(보드 03 "종목 9 · 응집 0.74" · 무명 경고 시 "응집 0.19 · 확인 필요").
function clusterStatsText(cluster, warn) {
  const parts = [];
  const dominant = cluster.dominantKind;
  if (dominant && dominant.count > 0) {
    parts.push(`${KIND_UNIT_LABELS[dominant.kind] || dominant.kind} ${dominant.count}`);
  } else if (Number.isFinite(cluster.size)) {
    // kind가 하나도 없는 그래프(구버전 payload) — 총원만 정직하게 쓴다.
    parts.push(`${cluster.size}개`);
  }
  if (Number.isFinite(cluster.cohesion)) parts.push(`응집 ${cluster.cohesion.toFixed(2)}`);
  if (warn) parts.push('확인 필요');
  return parts.join(' · ');
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
  // 이 3번째 종류를 아예 안 그리고 실선으로 대체한다. isSurprising은 controller.js가
  // 1단계 렌더마다 surprising-connections 실데이터로 aggregateClusterEdges를 다시
  // 호출해 채운다(스텝14 실배선) — 실데이터가 없을 때만 false다.
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

  // 라벨 칩 치수(보드 03 실측) — 흰 배경 88%, radius 6, padding 3/8, 줄 간격 2.
  const CHIP_GAP_PX = 8;      // 버블 아래 여백
  const CHIP_PAD_Y = 3;
  const CHIP_PAD_X = 8;
  const CHIP_LINE_GAP = 2;
  const TITLE_FONT_PX = 13;
  const TITLE_LINE_PX = 16;
  const STATS_FONT_PX = 10;
  const STATS_LINE_PX = 12;

  let anyEstimatedTitle = false;
  const bubbleLayer = el('g', { class: 'graph-cluster-bubbles' });
  for (const cluster of clusters) {
    // 미분류(-1)는 버블로 그리지 않는다. 연결이 하나도 없는 노드들의 자루라
    // 버블을 그리면 (a) 헤더가 이미 "미분류 K"로 센 것을 두 번 말하고,
    // (b) 눌러서 펼치면 선 하나 없는 점 K개만 나오는 막다른 길이 된다(실측 —
    // 페르소나 그래프에서 선호 7개가 정확히 그 상태였다). Paper 보드 03이
    // 미분류를 헤더 숫자로만 다루는 것이 같은 판단이다.
    if (cluster.cluster === -1) continue;
    const warn = warnEligible && !cluster.name;
    const alpha = clusterAlpha(cluster);
    const radius = Number.isFinite(cluster.bubbleRadius) ? cluster.bubbleRadius : cluster.radius;
    // .graph-node — wireNodeClicks()(controller.js)가 이 클래스로 찾아 클릭을 건다.
    // 1단계에서 버블 클릭은 그 군집을 펼치는 뜻이라 data-cluster만 있으면 되고
    // data-entity-id는 필요 없다(handleNodeClick이 1단계에선 무시한다).
    const group = el('g', { class: 'graph-node graph-cluster-bubble-group', 'data-cluster': cluster.cluster });

    // 흰 바탕 원을 먼저 깐다 — 버블 채움이 응집도만큼만 불투명해서(0.09~0.16)
    // 그 아래를 지나는 연결선이 비쳐 가운데 숫자를 가로질렀다(실측).
    group.appendChild(el('circle', {
      cx: cluster.x, cy: cluster.y, r: radius, class: 'graph-cluster-bubble-base',
    }));
    group.appendChild(el('circle', {
      cx: cluster.x,
      cy: cluster.y,
      r: radius,
      class: warn ? 'graph-cluster-bubble is-unnamed-warn' : 'graph-cluster-bubble',
      // 색(먹/주황)은 CSS 토큰이 정하고, 데이터마다 달라지는 alpha만 얹는다 —
      // 옛 판의 hsl() 무지개 회전은 Paper에 없다(보드 03은 전부 같은 먹색이고
      // 군집을 가르는 것은 위치·크기·이름표다). 색을 군집 번호에 쓰면 "확인
      // 필요 주황"이라는 유일한 의미색과 경쟁한다.
      style: `fill-opacity: ${alpha.fill.toFixed(3)}; stroke-opacity: ${alpha.stroke.toFixed(3)}`,
    }));

    // 버블 중앙 구성원 수(보드 03) — 크기만으로는 "얼마나 큰가"를 못 읽는다.
    const count = el('text', {
      x: cluster.x,
      y: cluster.y,
      class: warn ? 'graph-cluster-bubble-count is-warn' : 'graph-cluster-bubble-count',
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      style: `font-size: ${bubbleCountFontPx(radius).toFixed(1)}px`,
    });
    count.textContent = String(cluster.size);
    group.appendChild(count);

    // 라벨 칩 — 흰 배경 위에 제목 + 통계 2줄. 배경을 깔지 않으면 군집 간 연결선
    // 위에 글자가 겹쳐 읽히지 않는다(보드 03이 칩을 쓴 이유).
    const title = clusterTitle(cluster);
    // 접미 "· 추정"은 여기서 안 붙인다 — 이름 파이프라인이 없는 실제 상태에서는
    // 모든 군집이 추정이라 같은 꼬리표가 일곱 번 반복된다(실측). 그 사실은 범례
    // 캡션 한 줄이 더 정확히, 덜 시끄럽게 말한다(아래 renderClusterLegend).
    const titleText = title.text;
    if (title.estimated) anyEstimatedTitle = true;
    const statsText = clusterStatsText(cluster, warn);
    const chipWidth = Math.max(
      estimateTextWidthPx(titleText, TITLE_FONT_PX),
      estimateTextWidthPx(statsText, STATS_FONT_PX)
    ) + CHIP_PAD_X * 2;
    const chipHeight = CHIP_PAD_Y * 2 + TITLE_LINE_PX + (statsText ? CHIP_LINE_GAP + STATS_LINE_PX : 0);
    const chipTop = cluster.y + radius + CHIP_GAP_PX;

    group.appendChild(el('rect', {
      x: cluster.x - chipWidth / 2,
      y: chipTop,
      width: chipWidth,
      height: chipHeight,
      rx: 6,
      class: 'graph-cluster-chip-bg',
    }));

    const nameLabel = el('text', {
      x: cluster.x,
      y: chipTop + CHIP_PAD_Y + TITLE_LINE_PX * 0.75,
      class: title.estimated ? 'graph-cluster-label is-estimated' : 'graph-cluster-label',
      'text-anchor': 'middle',
    });
    nameLabel.textContent = titleText;
    group.appendChild(nameLabel);

    if (statsText) {
      const stats = el('text', {
        x: cluster.x,
        y: chipTop + CHIP_PAD_Y + TITLE_LINE_PX + CHIP_LINE_GAP + STATS_LINE_PX * 0.8,
        class: warn ? 'graph-cluster-stats is-warn' : 'graph-cluster-stats',
        'text-anchor': 'middle',
      });
      stats.textContent = statsText;
      group.appendChild(stats);
    }

    bubbleLayer.appendChild(group);
  }
  svg.appendChild(bubbleLayer);

  container.appendChild(svg);
  const legend = renderClusterLegend(clusters, clusterEdges, warnEligible, anyEstimatedTitle);
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
function renderClusterLegend(clusters, clusterEdges, warnEligible, anyEstimatedTitle) {
  const items = [];
  if (clusters.length > 0) items.push(legendItem('원 크기 = 구성원 수'));
  if (clusters.some((c) => Number.isFinite(c.cohesion))) items.push(legendItem('채움 진하기 = 응집도'));
  if (clusterEdges.length > 0) items.push(legendItem('선 굵기 = 군집 간 연결 수', 'is-solid'));
  if (clusterEdges.some((e) => e.isSurprising)) items.push(legendItem('숨은 연관', 'is-hidden-link'));
  if (warnEligible) items.push(legendItem('점선 = 확인 필요', null, 'is-unnamed-warn'));
  if (items.length === 0) return null;

  const legend = elHtml('div', 'graph-cluster-legend');
  items.forEach((item) => legend.appendChild(item));
  // 이름 출처 캡션 — 확정 이름이 아닌 제목이 하나라도 있으면 그 사실을 한 번만
  // 말한다(버블마다 "· 추정"을 붙이는 대신, §0 정직성은 지키고 소음은 뺀다).
  if (anyEstimatedTitle) {
    legend.appendChild(legendItem('군집 이름은 대표 항목에서 추정', null, 'is-estimated'));
  }
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
// entityPairKey를 내보낸다(스텝14) — controller.js가 surprising-connections를
// draw()에 주입할 때 render.js와 정확히 같은 키 형식으로 Set을 만들어야 하는데
// (엔티티 쌍 정규화 규칙이 여기 하나뿐이어야 두 쪽이 어긋나지 않는다), 3번째로
// 다시 베끼는 대신 이번엔 재사용한다(1~11단계에서 duplicaton을 감내했던 것과
// 달리, 이제 소비자가 하나 더 늘어 재사용 쪽이 원칙1에 더 맞는다).
const __exports = { renderClusterMap, renderClusterBubbles, describeRendered, entityPairKey, clusterTitle, clusterStatsText };

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.GraphRender = __exports;
}

})();
