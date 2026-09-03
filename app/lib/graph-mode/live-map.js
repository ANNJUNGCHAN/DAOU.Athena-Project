// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 군집 지도의 **라이브 렌더러**(2026-09-02) — vis-network로 힘 시뮬레이션을 계속
// 돌린다. 기존 결정적 SVG 렌더러(render.js + cluster-layout.js)를 대체하지 않고
// 나란히 산다: 헤더의 토글이 둘 중 하나를 고르고, 쓰지 않는 쪽은 아무것도 안 그린다.
//
// **왜 둘 다 두나.** cluster-layout.js 머리말이 힘 시뮬레이션을 거부한 이유는 여전히
// 유효하다("같은 입력이면 픽셀까지 같다"). 라이브 뷰는 그 성질을 포기하는 대신
// 손으로 만지는 감각을 얻는다 — 어느 쪽이 옳은지는 실제 앱에서 만져 보고 정할
// 문제라, 지금은 **두 답을 다 화면에 두고 비교할 수 있게** 한다. 그리고 실무적으로,
// verify-graph-mode.js의 전수 검증이 SVG DOM(.graph-cluster-bubble,
// .graph-node-circle.is-fact …)에 걸려 있다. 정적 렌더러를 지우면 이 표면의
// 안전망이 통째로 사라진다.
//
// **왜 2단계(군집 버블 → 펼침)가 여기 없나.** 라이브 뷰는 노드를 처음부터 전부
// 편다. 40개 규모에서는 그편이 잘 읽히고, 무엇보다 "물리로 뭉친 덩어리"가 곧
// 군집이라 버블 집계가 하던 일을 색이 대신한다. 엔티티가 수백 개로 늘면 이 판단은
// 다시 봐야 한다 — 그때는 2단계가 필요해진다.

const PALETTE = ['#FFC454', '#68BDF6', '#6DCE9E', '#FF756E', '#DE9BF9', '#FB95AF', '#A5ABB6', '#F79767', '#57C7E3', '#8DCC93'];

// 엣지 3종 — **canvas.css의 정적 렌더러 값 그대로다**(.graph-edge,
// .graph-edge.is-inference, .graph-edge.is-hidden-link). 두 뷰를 오갈 때 같은 선이
// 같은 뜻이어야 해서 색을 새로 만들지 않는다.
//
// 주의(알려진 차이): 정적 뷰는 **노드 채움**에도 확정성을 싣는다
// (.graph-node-circle.is-fact/.is-warn/.is-soft). 라이브 뷰는 노드 색을 군집에
// 쓰므로 그 축이 겹친다 — 여기서는 확정성을 엣지에만 싣고, 군집은 색으로 읽게 한다
// (1단계 군집 버블이 색으로 군집을 말하던 것과 같은 읽기다). 노드 확정성까지
// 살리려면 profile-summary 티어를 여기로 끌어와 테두리에 실어야 한다 — 후속 판단.
const CONFIDENCE = {
  EXTRACTED: { label: '사실', color: 'rgba(16, 19, 26, 0.38)', dashes: false },
  INFERRED: { label: '추론', color: 'rgba(16, 19, 26, 0.24)', dashes: [4, 4] },
  AMBIGUOUS: { label: '불확실', color: '#ff9838', dashes: [2, 4] },
};
const HIDDEN_COLOR = '#ee137b'; // --color-brand — 정적 뷰의 숨은 연관과 같은 색.

// 앱 테마를 따른다. 프로토타입은 다크 기준이었는데 셸은 백색 유리(--color-k-bg
// #eef0f4)라, 하드코딩한 색을 그대로 들고 오면 흰 배경에 흰 글자를 얹게 된다(실측).
function themeColors(el) {
  const fallback = { text: '#14171d', dim: '#5b6270', halo: '#ffffff', line: 'rgba(16, 19, 26, 0.14)' };
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function' || !el) return fallback;
  const styles = window.getComputedStyle(el);
  const read = (name, backup) => (styles.getPropertyValue(name) || '').trim() || backup;
  return {
    text: read('--color-k-text', fallback.text),
    dim: read('--color-k-dim', fallback.dim),
    halo: read('--color-k-panel', fallback.halo),
    line: read('--color-k-line', fallback.line),
  };
}

// **네모 창은 이 파일에 없다 — CSS에 있다**(.graph-live-map의 테두리).
//
// 처음엔 그래프 좌표계에 사각형을 그리고 노드를 그 안으로 되미는 방식으로 만들었다가
// 통째로 걷어냈다. Neo4j Browser를 실제로 돌려 재 보니(2026-09-02, localhost:7474
// 실측) 셋 다 다르다:
//   ① 확대해도 프레임 크기는 안 변한다(캔버스 1657×498 불변) — 화면 고정 패널이다.
//   ② 프레임을 넘는 내용은 **잘린다**. 벽이 아니라 창틀이다.
//   ③ 노드를 프레임 밖으로 끌면 그냥 나가서 잘린다 — 되밀리지 않는다.
// 필요한 것은 테두리 있는 패널 하나뿐이고, 캔버스는 원래 자기 밖으로 안 그린다.
// 물리에 손대는 벽은 레이아웃만 망가뜨렸다(노드가 테두리에 늘어붙었다).
const SEP = ' '; // 공백. NUL은 이 저장소가 49897fd에서 한 번 걷어낸 함정이다.

// Graphify(안정화 후 동결)가 아니라 Neo4j(상시 가동) 쪽 설정이다. 척력을 세게 두면
// 엣지 없는 노드가 멀리 밀려나 첫 맞춤이 크게 축소돼 캡션이 안 읽힌다(실측) —
// 중력을 올려 뭉치게 한다.
const PHYSICS = {
  enabled: true,
  solver: 'barnesHut',
  barnesHut: {
    gravitationalConstant: -4000,
    centralGravity: 0.6,
    springLength: 100,
    springConstant: 0.06,
    damping: 0.5,
    avoidOverlap: 0.6,
  },
  stabilization: false, // 열자마자 자리를 잡아 가는 움직임이 보인다.
  minVelocity: 0.4,
};

// 원 지름 = 연결 수(정적 렌더러 nodeRadiusPx와 같은 축). 캡션이 안에 들어가야 하므로
// 최솟값이 옛 dot 시절보다 크다 — 한글 두 줄이 들어갈 최소치가 44px 실측이다.
const NODE_DIAMETER_MIN_PX = 44;
const NODE_DIAMETER_MAX_PX = 76;
const NODE_FONT_PX = 11;

function nodeDiameterPx(degree, maxDegree) {
  const ratio = Math.sqrt(Math.max(0, Number(degree) || 0) / Math.max(1, maxDegree));
  return Math.round(NODE_DIAMETER_MIN_PX + (NODE_DIAMETER_MAX_PX - NODE_DIAMETER_MIN_PX) * ratio);
}

// 지름 안에 들어갈 만큼만 남기고 자른다. 원은 위아래로 갈수록 좁아지므로 지름 전체를
// 글자 폭으로 쓸 수 없다 — 실효 폭을 지름의 0.72로 보고 3줄까지 잡는다(실측).
// 한글은 대략 글꼴 크기만큼의 폭을 쓴다.
function truncateForCircle(name, diameter) {
  const text = String(name || '');
  const perLine = Math.max(3, Math.floor((diameter * 0.72) / NODE_FONT_PX));
  const budget = perLine * 3;
  if (text.length <= budget) return text;
  return `${text.slice(0, Math.max(1, budget - 1))}…`;
}

function clusterColor(cluster) {
  const n = Number(cluster) || 0;
  return PALETTE[((n % PALETTE.length) + PALETTE.length) % PALETTE.length];
}

function pairKey(a, b) {
  return `${String(a)}${SEP}${String(b)}`;
}

// 같은 그래프를 다시 받았는데 처음부터 다시 그리면 물리가 재시작돼 사용자가
// 손으로 만들어 둔 배치가 날아간다. draw(true)는 필터·전환마다 불리므로
// 내용이 실제로 달라졌을 때만 다시 만든다.
function signatureOf(payload) {
  const nodes = Array.isArray(payload && payload.nodes) ? payload.nodes : [];
  const edges = Array.isArray(payload && payload.edges) ? payload.edges : [];
  return `${payload && payload.revision}|${nodes.length}|${edges.length}|${nodes.map((n) => n.entity_id).join(',')}`;
}

function createLiveMap(deps) {
  const { container, onSelect, visNetwork } = deps || {};
  const vis = visNetwork || (typeof window !== 'undefined' ? window.vis : null);

  let network = null;
  let nodesDs = null;
  let edgesDs = null;
  let signature = null;
  let host = null;
  let wheelHandler = null; // Ctrl+휠 가로채기 — destroy에서 반드시 떼야 누수가 없다.

  // 지금 **보이는 영역**을 그래프 좌표로 바꾼다.
  //
  // 앞서 걷어낸 월드 좌표 벽과는 다른 물건이다: 그건 확대하면 같이 커지는 고정
  // 울타리였고, 이건 화면이 곧 범위다 — 축소하면 멀리, 확대하면 가까이까지만 던질
  // 수 있다. "노드를 던질 수 있는 범위가 딱 화면까지"라는 요구가 이 뜻이다.
  function visibleGraphBounds() {
    if (!network || !host) return null;
    const topLeft = network.DOMtoCanvas({ x: 0, y: 0 });
    const bottomRight = network.DOMtoCanvas({ x: host.clientWidth, y: host.clientHeight });
    return { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };
  }

  // 끌고 있는 노드만 화면 안으로 되민다. 물리로 움직이는 노드는 안 건드린다 —
  // 배치는 시뮬레이션이 정하는 것이고, 거기 손대면 노드가 테두리에 늘어붙는다(실측).
  function clampDragged(ids) {
    const bounds = visibleGraphBounds();
    const body = network && network.body;
    if (!bounds || !body || !body.nodes) return;
    for (const id of ids) {
      const node = body.nodes[id];
      if (!node || typeof node.x !== 'number') continue;
      const radius = (node.shape && node.shape.radius) || 20;
      node.x = Math.min(Math.max(node.x, bounds.left + radius), bounds.right - radius);
      node.y = Math.min(Math.max(node.y, bounds.top + radius), bounds.bottom - radius);
    }
  }

  function available() {
    return Boolean(container && vis && vis.Network && vis.DataSet);
  }

  function buildNodes(payload, theme) {
    const maxDegree = Math.max(1, ...payload.nodes.map((n) => Number(n.degree) || 0));
    return payload.nodes.map((node) => {
      const color = clusterColor(node.cluster);
      const diameter = nodeDiameterPx(node.degree, maxDegree);
      return {
        id: node.entity_id,
        // 캡션이 원 **안**에 든다(Neo4j와 같은 형태). shape:'dot'은 이름을 원 밖에
        // 두는데, 노드가 촘촘해지면 이름과 선이 뒤엉켜 무엇의 이름인지 흐려진다.
        //
        // 'circle'은 원래 글자 길이에 맞춰 원이 커진다 — 그러면 "원 크기 = 연결 수"
        // 인코딩이 이름 길이에 잡아먹힌다. widthConstraint로 지름을 못박고, 대신
        // 이름을 그 지름에 맞게 잘라 넣는다(Neo4j도 "미국 나스닥 ADR…"처럼 자른다).
        label: truncateForCircle(node.name, diameter),
        shape: 'circle',
        widthConstraint: { minimum: diameter, maximum: diameter },
        color: {
          background: color,
          border: color,
          highlight: { background: color, border: theme.text },
          hover: { background: color, border: theme.text },
        },
        borderWidth: 2,
        borderWidthSelected: 4,
        // 원 안이라 후광이 필요 없다 — 파스텔 군집색 위의 잉크로 충분히 읽힌다.
        font: { color: theme.text, size: 11, multi: false },
        title: `${node.name} · 연결 ${node.degree}개`,
      };
    });
  }

  function buildEdges(payload, theme) {
    const clusterOf = new Map(payload.nodes.map((n) => [String(n.entity_id), n.cluster]));
    const details = new Map();
    for (const detail of (payload.edge_details || [])) {
      details.set(pairKey(detail.source, detail.target), detail);
    }
    return payload.edges.map((pair, index) => {
      const [a, b] = pair;
      const detail = details.get(pairKey(a, b)) || details.get(pairKey(b, a)) || {};
      const conf = CONFIDENCE[detail.confidence] || CONFIDENCE.AMBIGUOUS;
      const crossing = clusterOf.get(String(a)) !== clusterOf.get(String(b));
      const kinds = Array.isArray(detail.kinds) ? detail.kinds.join(' · ') : '';
      return {
        id: index,
        from: a,
        to: b,
        label: kinds || undefined,
        // 숨은 연관은 확정성보다 우선해서 칠한다 — 정적 뷰의
        // .graph-edge.is-hidden-link도 다른 엣지 규칙을 덮는다.
        color: {
          color: crossing ? HIDDEN_COLOR : conf.color,
          highlight: HIDDEN_COLOR,
        },
        dashes: crossing ? [6, 4] : conf.dashes,
        width: crossing ? 2 : 1.4,
        arrows: { to: { enabled: true, scaleFactor: 0.5, type: 'arrow' } },
        font: { color: theme.dim, size: 10, strokeWidth: 4, strokeColor: theme.halo, align: 'horizontal' },
        title: `${conf.label}${crossing ? ' · 숨은 연관' : ''}${kinds ? `\n${kinds}` : ''}`,
      };
    });
  }

  function render(payload) {
    if (!available()) return false;
    const nodes = Array.isArray(payload && payload.nodes) ? payload.nodes : [];
    if (nodes.length === 0) {
      destroy();
      return false;
    }
    const next = signatureOf(payload);
    if (network && next === signature) return true; // 같은 그래프 — 배치를 지키고 아무것도 안 한다.
    signature = next;

    destroy();
    host = document.createElement('div');
    host.className = 'graph-live-map';
    container.appendChild(host);

    const theme = themeColors(container);
    nodesDs = new vis.DataSet(buildNodes(payload, theme));
    edgesDs = new vis.DataSet(buildEdges(payload, theme));
    network = new vis.Network(host, { nodes: nodesDs, edges: edgesDs }, {
      // 크기는 노드마다 widthConstraint로 못박는다(buildNodes) — scaling은 shape:'dot'의
      // value 축에만 듣고 'circle'에는 안 들어서, 남겨두면 안 듣는 설정이 된다.
      edges: { smooth: { type: 'dynamic' }, selectionWidth: 2 },
      physics: PHYSICS,
      interaction: {
        hover: true,
        tooltipDelay: 150,
        dragNodes: true,
        keyboard: false,
        zoomView: true, // 마우스 휠 확대·축소(vis 기본) — 아래에서 Ctrl+휠도 같은 일을 하게 한다.
      },
    });

    // Ctrl+휠. vis 자체 핸들러는 ctrlKey를 안 가려서 휠만으로 이미 확대가 되지만,
    // Ctrl+휠은 그 전에 Electron의 페이지 줌으로 먹힌다 — 캡처 단계에서 가로채
    // 같은 확대로 돌린다(요청: "마우스 휠 또는 control + 마우스 휠").
    wheelHandler = (event) => {
      if (!event.ctrlKey || !network) return;
      event.preventDefault();
      event.stopPropagation();
      const scale = network.getScale();
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      network.moveTo({ scale: Math.min(4, Math.max(0.15, scale * factor)) });
    };
    host.addEventListener('wheel', wheelHandler, { passive: false, capture: true });

    // 첫 정착에 한 번만 프레임에 맞춘다. stabilization:false라 vis가 대신 fit해 주지
    // 않아서, 안 하면 열자마자 그래프가 프레임 밖으로 걸어 나간다(실측). 이후의 fit은
    // 사용자가 맞춰 둔 줌을 뺏는 것이라 하지 않는다 — Neo4j도 프레임 우하단의
    // 맞춤 버튼을 사람이 눌러야 다시 맞춘다.
    let fitted = false;
    const fitOnce = () => {
      if (fitted || !network) return;
      fitted = true;
      network.fit({ animation: { duration: 600 } });
    };
    network.on('stabilized', fitOnce);
    setTimeout(fitOnce, 3500);

    // 끌어다 놓은 노드는 그 자리에 둔다.
    //
    // **fixed:true가 아니라 physics:false다.** fixed로 고정하면 시뮬레이션에서만
    // 빠지는 게 아니라 **다시는 끌 수 없게 된다** — vis의 드래그 핸들러가 fixed인
    // 축의 좌표를 갱신하지 않아, 화면 끝으로 밀어둔 노드를 도로 끌어올 방법이
    // 사라진다(실측·재현 검증). 문서가 physics를 이렇게 정의한다: "not part of the
    // physics simulation. It will not move except for from manual dragging."
    // 끄는 **동안** 매 프레임 되민다 — 놓을 때만 잡으면 화면 밖으로 끌려 나갔다가
    // 튕겨 돌아오는 것처럼 보인다. 여기서 막으면 커서가 벽을 미는 느낌이 된다.
    network.on('dragging', (params) => {
      if (!params.nodes || !params.nodes.length) return;
      clampDragged(params.nodes);
    });

    network.on('dragEnd', (params) => {
      if (!network || !params.nodes || !params.nodes.length) return;
      clampDragged(params.nodes);
      nodesDs.update(params.nodes.map((id) => ({ id, physics: false })));
      network.redraw();
    });

    // 노드 선택은 컨트롤러의 공통 패널로 넘긴다.
    network.on('click', (params) => {
      if (typeof onSelect !== 'function') return;
      onSelect(params.nodes && params.nodes.length ? String(params.nodes[0]) : null);
    });

    // 더블클릭 = 그 노드로 카메라를 옮긴다. vis 자체의 doubleClick은 이벤트만 쏘고
    // 아무 동작도 안 해서(vis-network.js onDoubleTap 실측), 안 붙이면 더블클릭이
    // 그냥 클릭 두 번이다. 빈 곳을 두 번 누르면 전체 맞춤으로 되돌린다 — 확대해
    // 들어갔다가 나오는 길이 화면에 하나는 있어야 한다.
    network.on('doubleClick', (params) => {
      if (!network) return;
      if (params.nodes && params.nodes.length) {
        network.focus(params.nodes[0], {
          scale: Math.max(1.2, network.getScale()),
          animation: { duration: 400, easingFunction: 'easeInOutQuad' },
        });
        return;
      }
      network.fit({ animation: { duration: 400 } });
    });
    return true;
  }

  function selectEntity(entityId) {
    if (!network) return;
    if (!entityId) { network.unselectAll(); return; }
    try { network.selectNodes([entityId]); } catch { /* 걸러진 노드 — 선택할 게 없다 */ }
  }

  // 그 노드로 카메라를 옮긴다 — 더블클릭이 하는 것과 **같은 동작**이다. 채팅이
  // 노드를 골라 줄 때(athena_graph_view action=select) 선택만 하면 화면 밖에 있는
  // 노드는 패널만 열리고 지도에서는 아무 일도 안 일어난 것처럼 보인다.
  function focusEntity(entityId) {
    if (!network || !entityId) return false;
    try {
      network.focus(entityId, {
        scale: Math.max(1.2, network.getScale()),
        animation: { duration: 400, easingFunction: 'easeInOutQuad' },
      });
      return true;
    } catch {
      return false; // 필터에 걸려 지도에 없는 노드 — 조용히 아무 일도 안 한다.
    }
  }

  // 전체 맞춤 — 빈 곳 더블클릭과 같은 동작이다. 확대해 들어갔다가 나오는 길을
  // 채팅에도 준다("전체 다시 보여줘").
  function fitView() {
    if (!network) return false;
    network.fit({ animation: { duration: 400 } });
    return true;
  }

  function destroy() {
    if (host && wheelHandler) host.removeEventListener('wheel', wheelHandler, { capture: true });
    wheelHandler = null;
    if (network) { network.destroy(); network = null; }
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
    nodesDs = null;
    edgesDs = null;
    signature = null;
  }

  return { available, render, selectEntity, focusEntity, fitView, destroy };
}

const __exports = {
  createLiveMap, signatureOf, clusterColor, nodeDiameterPx, truncateForCircle, CONFIDENCE, PHYSICS,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.GraphLiveMap = __exports;
}

})();
