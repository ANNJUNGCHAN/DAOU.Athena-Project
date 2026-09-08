// 기법 노드·흐름 창 — Paper 보드 21.
//
// **여기는 편집 표면이 아니다.** 한때 옆에 있던 시각 편집기(2026-09-08 폐기)는 registry가
// 정한 노드 종류를 팔레트에서 끌어다 붙이는 편집 표면이었다. 이 창은 반대다 — 노드가 기법
// 파이썬의 함수 한 단위라서 기법마다 노드가 다르고, 범용 팔레트라는 것이 아예 없다.
// 팔레트도 연결 편집도 만들지 않고 읽기·선택·참조만 낸다. 그 규율이 흔들리면 "여기서는
// 손으로 못 고친다"는 이 창의 계약이 가장 먼저 무너진다.
//
// **문구의 출처.** 노드 이름은 서버가 준 label(=`함수명()`), 한 줄 설명은 summary_ko,
// 타입은 returns_hint에서 온다. 이 파일이 직접 갖는 한국어는 화면 구조 라벨(흐름 이름·
// 역할 칩·버튼·안내 한 줄)뿐이고 전부 보드 21에 그려진 그대로다. summary_ko가 비어 오면
// 그 줄을 지운다 — 화면이 없는 설명을 지어내면 사용자는 그것을 코드의 사실로 읽는다.
//
// **고치는 곳은 여기가 아니다.** 카드를 누르면 @참조가 대화 입력창에 들어가고, AI가
// 코드 ↔ 노드 ↔ 백테스트를 오가며 고친다. 그래서 이 모듈은 콜백만 내고 페이로드를 바꾸지
// 않는다(자기 상태는 '지금 고른 노드' 하나뿐이다).
//
// **같은 함수가 두 흐름에 나오면 두 번째는 고스트다.** ATR처럼 진입·청산이 함께 쓰는
// 함수를 두 갈래에 똑같이 그리면 "두 번 계산한다"로 읽힌다. 두 번째 카드를 점선 '재사용'
// 으로 낮춰 같은 노드라는 것을 모양으로 말한다(선택은 둘이 함께 눌린다 — 같은 노드니까).
//
// 프레임워크를 쓰지 않는 이유는 시각 편집기와 같다 — 좌표와 흐름 순서를 테스트로 단언해야
// 하는데 그래프 라이브러리는 좌표를 감춘다.
(function () {
'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------- 보드에 적힌 문구 ----------

const CANVAS_TITLE = '노드·흐름';
const RAIL_COUNT = (n) => `이 기법의 노드 ${n}개`;
const RAIL_NOTE = '다른 기법에는 다른 노드가 생깁니다';
const FLOW_TITLES = { entry: '진입 흐름', exit: '청산 흐름', stage: '단계 흐름' };
const FLOW_EXPLAIN = '이 흐름 설명';
const FLOW_EXPLAIN_HINT = (title) => `누르면 @${title}`;
const CARD_OPEN_CODE = '코드 보기';
const EXPLAIN_ALL = '이 기법 전체를 설명해줘';
const REF_ALL_NAME = '전체';
const REF_ALL_HINT = '누르면 @전체';
const GHOST_LABEL = '재사용';
const GHOST_TITLE = '앞 흐름에서 만든 값을 그대로 다시 씁니다';
const PILL_ENTRY = (n) => `진입 주문 후보 ${n}건`;
const PILL_EXIT = (n) => `청산 주문 후보 ${n}건`;

// 보드 21(2026-09-08 개정)의 발밑 문장. 여기서 누른 것은 메시지가 아니라 참조라는 계약을
// 아무것도 고르지 않은 상태의 안내가 직접 말한다 — "설명을 들을 수 있습니다"는 누르면 말이
// 나간다는 뜻으로 읽혔다.
const STATUS_IDLE = "'이상해요' 같은 버튼은 없습니다. 무엇이 이상한지는 사람이 자기 말로 씁니다.";
const STATUS_ATTACHED = (name) => `선택됨 — 오른쪽 입력창에 @${name} 가 붙었습니다`;
const STATUS_EMPTY = '아직 노드가 없습니다 — 검사를 통과하면 함수 단위 노드가 생깁니다';
const STATUS_SELECT = '선택';
const STATUS_OFF_FLOW = '진입·청산 흐름에 들어가지 않습니다';
const STATUS_BOTH = '두 흐름 모두';
const STATUS_ERROR = '노드를 읽지 못했습니다';
const UNKNOWN_NOTE = (n, names) => `역할을 못 읽은 함수 ${n}개 · ${names}`;

const NO_INPUT = '입력 없음';
const UNKNOWN_TYPE = 'unknown';

// 역할 칩. 서버가 주는 role은 계약이 정한 여섯 낱말뿐이고, 모르는 값이 오면 그대로 보여
// 준다 — 화면이 임의로 '보조'로 접으면 백엔드가 역할을 늘렸을 때 아무도 눈치채지 못한다.
const ROLE_LABELS = {
  entry: '진입',
  exit: '청산',
  indicator: '지표',
  sizing: '수량',
  helper: '보조',
  signals: '신호',
};

// granularity 'stage'일 때의 네 칸. flow.py의 단계 이름을 그대로 옮긴다.
const STAGE_LABELS = {
  prepare: '준비',
  indicators: '지표',
  conditions: '조건',
  output: '출력',
};
const STAGE_ORDER = ['prepare', 'indicators', 'conditions', 'output'];

// ---------- 자리 ----------
// 두 갈래를 세로로 세우고 가로로 나란히 둔다(보드 21). 카드 폭 208은 'df, lookback →
// Series<Number>' 한 줄이 --text-2xs(10px) 모노에서 잘리지 않는 최소치다.
const CARD_W = 208;
const CARD_H = 104;
const LANE_PITCH = 248;
const LANE_X0 = 20;
const LANE_HEAD_Y = 12;
const CARD_TOP = 48;
const CARD_PITCH = 138;
const SURFACE_MIN_W = 300;
const SURFACE_MIN_H = 240;

// ---------- 순수 계산 ----------

function normalizePayload(payload) {
  const base = payload || {};
  const nodes = (base.nodes || []).filter((n) => n && n.id).map((n) => ({
    id: String(n.id),
    label: n.label || `${n.id}()`,
    summary_ko: n.summary_ko || '',
    first_line: n.first_line == null ? null : Number(n.first_line),
    last_line: n.last_line == null ? null : Number(n.last_line),
    params: (n.params || []).map(String),
    returns_hint: n.returns_hint || '',
    calls: (n.calls || []).map(String),
    role: n.role || '',
    stage: n.stage || null,
  }));
  const flows = base.flows || {};
  return {
    nodes: nodes,
    flows: {
      entry: (flows.entry || []).map(String),
      exit: (flows.exit || []).map(String),
    },
    granularity: base.granularity === 'stage' ? 'stage' : 'function',
    unknown: (base.unknown || []).map(String),
    // 참조 칩이 "어느 파일의 몇째 줄"인지 말할 수 있어야 하므로 소스 경로도 그대로 나른다.
    // 서버가 안 주면 빈 문자열이고, 그때 칩은 줄 범위만 말한다 — 경로를 지어내지 않는다.
    path: base.path ? String(base.path) : '',
    error: base.error || null,
  };
}

// 흐름 하나를 만들 때 두 가지를 지운다: ① 노드 목록에 없는 이름(서버가 흐름만 남기고
// 노드를 못 만든 경우) ② 같은 흐름 안의 중복. 지우지 않으면 카드가 허공에 뜨거나 같은
// 카드가 한 갈래에 두 번 선다.
function laneIds(ids, byId) {
  const seen = {};
  const out = [];
  (ids || []).forEach((id) => {
    if (!byId[id] || seen[id]) return;
    seen[id] = true;
    out.push(id);
  });
  return out;
}

// 단계 노드는 서버가 준 순서가 아니라 flow.py의 단계 순서로 세운다 — 준비 다음에 지표가
// 오는 것은 코드의 사실이지 화면의 취향이 아니다.
function stageIds(nodes) {
  const known = [];
  const rest = [];
  nodes.forEach((n) => {
    if (n.stage && STAGE_ORDER.indexOf(n.stage) !== -1) known.push(n);
    else rest.push(n);
  });
  known.sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
  return known.concat(rest).map((n) => n.id);
}

// 갈래를 만든다. 진입·청산이 하나라도 있으면 그 둘이 갈래고, 둘 다 비었으면 한 갈래로
// 접는다(단계 폴백) — 흐름을 못 읽었다고 노드까지 감추면 화면이 통째로 빈다.
function buildLanes(payload) {
  const p = payload;
  const byId = {};
  p.nodes.forEach((n) => { byId[n.id] = n; });

  const entry = laneIds(p.flows.entry, byId);
  const exit = laneIds(p.flows.exit, byId);
  if (entry.length || exit.length) {
    const lanes = [];
    if (entry.length) lanes.push({ kind: 'entry', title: FLOW_TITLES.entry, ids: entry, explainable: true });
    if (exit.length) lanes.push({ kind: 'exit', title: FLOW_TITLES.exit, ids: exit, explainable: true });
    return lanes;
  }
  if (!p.nodes.length) return [];
  // 폴백 갈래에는 [이 흐름 설명]을 달지 않는다. onExplainFlow의 kind는 'entry'|'exit'
  // 둘뿐이라 여기서 부를 이름이 없다 — 없는 이름을 지어내느니 전체 설명 버튼으로 보낸다.
  const ids = p.granularity === 'stage' ? stageIds(p.nodes) : p.nodes.map((n) => n.id);
  return [{ kind: 'stage', title: FLOW_TITLES.stage, ids: ids, explainable: false }];
}

// 카드·머리말·연결선의 좌표를 한 번에 만든다. SVG가 카드 밑을 지나가야 하므로 두 좌표계가
// 갈라지면 안 된다 — 그래서 한 함수가 둘 다 낸다.
function layout(lanes) {
  const heads = [];
  const boxes = [];
  const links = [];
  let maxLen = 0;
  lanes.forEach((lane, li) => {
    const x = LANE_X0 + li * LANE_PITCH;
    heads.push({ kind: lane.kind, x: x, y: LANE_HEAD_Y, w: CARD_W });
    maxLen = Math.max(maxLen, lane.ids.length);
    lane.ids.forEach((id, ci) => {
      const y = CARD_TOP + ci * CARD_PITCH;
      boxes.push({ lane: lane.kind, id: id, index: ci, x: x, y: y, w: CARD_W, h: CARD_H });
      if (ci > 0) {
        const prev = CARD_TOP + (ci - 1) * CARD_PITCH;
        links.push({
          lane: lane.kind,
          from: lane.ids[ci - 1],
          to: id,
          x1: x + CARD_W / 2,
          y1: prev + CARD_H,
          x2: x + CARD_W / 2,
          y2: y,
        });
      }
    });
  });
  const w = Math.max(SURFACE_MIN_W, LANE_X0 * 2 + (lanes.length ? (lanes.length - 1) * LANE_PITCH + CARD_W : 0));
  const h = Math.max(SURFACE_MIN_H, CARD_TOP + (maxLen ? (maxLen - 1) * CARD_PITCH + CARD_H : 0) + LANE_X0);
  return { heads: heads, boxes: boxes, links: links, size: { w: w, h: h } };
}

// 세로 흐름이므로 제어점도 세로다. 가로 베지어(시각 편집기의 edgePath)를 그대로 쓰면
// 같은 x 위에서 곡선이 사라져 직선이 된다.
function flowPath(x1, y1, x2, y2) {
  const dy = Math.max(12, Math.abs(y2 - y1) / 2);
  return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
}

function roleLabel(node, granularity) {
  if (granularity === 'stage' && node.stage) return STAGE_LABELS[node.stage] || node.stage;
  if (!node.role) return '';
  return ROLE_LABELS[node.role] || node.role;
}

// 카드의 "입력 → 출력" 한 줄. 인자가 없으면 '입력 없음', 타입을 못 읽었으면 계약이 쓰는
// 낱말 그대로 unknown이라고 적는다 — 빈칸으로 두면 '없다'와 '모른다'가 섞인다.
function ioLine(node) {
  const ins = node.params && node.params.length ? node.params.join(', ') : NO_INPUT;
  return `${ins} → ${node.returns_hint || UNKNOWN_TYPE}`;
}

function lineRange(node) {
  const a = node.first_line;
  const b = node.last_line;
  if (a == null) return '';
  if (b == null || b === a) return `L${a}`;
  return `L${a}–${b}`;
}

// ---------- DOM 도우미 ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.keys(attrs || {}).forEach((k) => node.setAttribute(k, String(attrs[k])));
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function button(className, text, onClick) {
  const b = el('button', className, text);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function attr(node, name, value) {
  if (value == null) return node;
  node.setAttribute(name, String(value));
  return node;
}

function focusEl(node) {
  if (node && typeof node.focus === 'function') node.focus();
}

function tagOf(target) {
  return String((target && (target.tagName || target.tag)) || '').toLowerCase();
}

function isFormTarget(ev) {
  const name = tagOf(ev && ev.target);
  return name === 'input' || name === 'select' || name === 'textarea';
}

// ---------- 창 ----------

function createTechniqueNodes(container, options) {
  const opts = options || {};

  const state = {
    payload: normalizePayload(opts.payload),
    stats: opts.stats || null,
    selectedId: opts.selected || null,
    attached: null, // 마지막으로 입력창에 붙인 참조의 이름 — 상태 한 줄이 그것만 말한다
  };

  let destroyed = false;
  let refs = { cards: {}, rail: {} };

  const root = el('div', 'backtest-tnodes');
  root.setAttribute('tabindex', '-1');
  container.appendChild(root);
  root.addEventListener('keydown', onKeyDown);

  // ---------- 조회 ----------

  function nodeById(id) {
    return state.payload.nodes.filter((n) => n.id === id)[0] || null;
  }

  function lanesOf(id) {
    return buildLanes(state.payload).filter((l) => l.ids.indexOf(id) !== -1).map((l) => l.kind);
  }

  // ---------- 선택 ----------

  function setSelected(nodeId, silent) {
    const next = nodeId && nodeById(nodeId) ? nodeId : null;
    if (state.selectedId === next) return;
    state.selectedId = next;
    state.attached = null; // 다른 노드로 옮기면 앞 참조의 안내는 더 이상 사실이 아니다
    if (!silent && opts.onSelect) opts.onSelect(next);
  }

  function select(nodeId) {
    setSelected(nodeId);
    render();
  }

  // ---------- 참조 ----------
  //
  // 보드 21(2026-09-08 개정) 확정: **노드를 눌러도 메시지는 나가지 않는다.** 무엇을 두고
  // 이야기할지만 정해지고(=참조 칩이 입력창에 붙고), 하고 싶은 말은 사람이 자기 말로 쓴다.
  // 그래서 이 창이 내는 것은 문장이 아니라 참조 하나다.
  //
  // onExplain*는 지운 게 아니라 뒤로 물렸다 — 그 서명으로 이미 배선한 호스트(옛 캔버스·
  // 하네스)가 있고, 그쪽에서 화면이 조용히 죽으면 원인을 아무도 못 찾는다. onReference가
  // 있으면 그것이 이기고 메시지는 한 건도 나가지 않는다.

  function nodeLines(node) {
    if (node.first_line == null) return null;
    return [node.first_line, node.last_line == null ? node.first_line : node.last_line];
  }

  function nodeRef(node) {
    return {
      kind: 'node',
      label: `@${node.id}`,
      name: node.id,
      lines: nodeLines(node),
      path: state.payload.path,
    };
  }

  function plainRef(kind, name) {
    return { kind: kind, label: `@${name}`, name: name, lines: null, path: state.payload.path };
  }

  // 참조를 붙인다. onReference가 있으면 상태 한 줄이 바뀌므로 true를 돌려주고, 부르는 쪽이
  // 한 번만 다시 그린다(여기서 render를 부르면 선택 갱신과 겹쳐 두 번 그린다).
  function attach(ref, legacy) {
    if (opts.onReference) {
      state.attached = ref.name;
      opts.onReference(ref);
      return true;
    }
    if (legacy) legacy();
    return false;
  }

  function focusNode(nodeId) {
    const id = nodeId || state.selectedId;
    if (id && state.selectedId !== id) select(id);
    // 흐름에 안 들어간 함수는 캔버스에 카드가 없다 — 그럴 때 초점을 잃지 않도록 레일로
    // 되돌린다. 초점이 문서 처음으로 튀면 키보드 사용자는 자리를 통째로 잃는다.
    focusEl(refs.cards[id] || refs.rail[id]);
  }

  function cycleSelection(step) {
    const nodes = state.payload.nodes;
    if (!nodes.length) return;
    const idx = nodes.map((n) => n.id).indexOf(state.selectedId);
    const next = idx < 0
      ? (step > 0 ? 0 : nodes.length - 1)
      : (idx + step + nodes.length) % nodes.length;
    select(nodes[next].id);
    focusEl(refs.cards[nodes[next].id] || refs.rail[nodes[next].id]);
  }

  // ---------- 키보드 ----------

  // 이 창은 읽고 묻는 창이라 키보드 계약도 셋뿐이다: Tab으로 노드를 돌고, Enter로 설명을
  // 듣고, o로 코드를 연다. Tab을 가로채는 이유는 시각 편집기와 같다 — "다음 폼 칸"이 아니라
  // "다음 노드"여야 설명이 따라온다.
  function onKeyDown(ev) {
    if (!ev) return;
    if (isFormTarget(ev)) return;
    const key = ev.key;
    const ctrl = ev.ctrlKey || ev.metaKey || ev.altKey;
    const stop = () => { if (typeof ev.preventDefault === 'function') ev.preventDefault(); };

    if (key === 'Tab' && !ctrl) {
      if (!state.payload.nodes.length) return;
      stop();
      cycleSelection(ev.shiftKey ? -1 : 1);
      return;
    }
    // Enter는 버튼 위에서 이미 클릭이다. 여기서 또 받으면 [코드 보기]를 눌렀는데 설명까지
    // 함께 나간다.
    if (key === 'Enter' && !ctrl) {
      if (tagOf(ev.target) === 'button') return;
      const node = nodeById(state.selectedId);
      if (!node) return;
      stop();
      if (attach(nodeRef(node), () => { if (opts.onExplainNode) opts.onExplainNode(node.id); })) render();
      return;
    }
    if ((key === 'o' || key === 'O') && !ctrl) {
      if (!state.selectedId) return;
      stop();
      if (opts.onOpenCode) opts.onOpenCode(state.selectedId);
    }
  }

  // ---------- 왼쪽 레일 ----------

  function renderRail() {
    const rail = el('div', 'backtest-tnodes-rail');
    attr(rail, 'role', 'group');
    attr(rail, 'aria-label', RAIL_COUNT(state.payload.nodes.length));
    rail.appendChild(el('div', 'backtest-tnodes-rail-title', RAIL_COUNT(state.payload.nodes.length)));

    const list = el('div', 'backtest-tnodes-rail-list');
    state.payload.nodes.forEach((node) => {
      const picked = state.selectedId === node.id;
      const item = button(`backtest-tnodes-rail-item${picked ? ' is-selected' : ''}`, null, () => {
        setSelected(node.id);
        // 레일에서 고른 것도 참조다(보드 21). 붙었으면 초점은 대화 입력창의 것이므로
        // 여기서 되가져오지 않는다 — 뺏으면 이어서 타자할 수 없다(카드 클릭의 짝 주석).
        const attached = attach(nodeRef(node));
        render();
        if (!attached) focusEl(refs.cards[node.id] || refs.rail[node.id]);
      });
      attr(item, 'data-node-id', node.id);
      attr(item, 'aria-pressed', state.selectedId === node.id ? 'true' : 'false');
      attr(item, 'aria-label', ariaLabel(node));
      item.appendChild(el('span', 'backtest-tnodes-rail-name', node.label));
      const range = lineRange(node);
      if (range) item.appendChild(el('span', 'backtest-tnodes-rail-lines', range));
      refs.rail[node.id] = item;
      list.appendChild(item);
    });
    rail.appendChild(list);
    // 보드 21의 맨 아래 작은 안내 — "이 화면은 이 기법의 것"이라는 사실을 매번 말한다.
    rail.appendChild(el('div', 'backtest-tnodes-rail-note', RAIL_NOTE));
    return rail;
  }

  function ariaLabel(node) {
    const role = roleLabel(node, state.payload.granularity);
    return role ? `${node.label} · ${role}` : node.label;
  }

  // ---------- 가운데 캔버스 ----------

  function renderCanvas(lanes) {
    const canvas = el('div', 'backtest-tnodes-canvas');
    const head = el('div', 'backtest-tnodes-canvas-head');
    head.appendChild(el('span', 'backtest-tnodes-canvas-title', CANVAS_TITLE));
    // 캔버스 머리 오른쪽 [전체](보드 21) — 노드도 흐름도 아닌 "이 기법 전체"를 참조로 붙인다.
    const all = button('backtest-tnodes-canvas-all', REF_ALL_NAME, () => {
      if (attachAll()) render();
    });
    attr(all, 'title', REF_ALL_HINT);
    head.appendChild(all);
    canvas.appendChild(head);
    canvas.appendChild(renderSurface(lanes));
    canvas.appendChild(renderFoot());
    return canvas;
  }

  function renderSurface(lanes) {
    const plan = layout(lanes);
    const surface = el('div', 'backtest-tnodes-surface');
    attr(surface, 'role', 'group');
    attr(surface, 'aria-label', CANVAS_TITLE);

    const svg = svgEl('svg', {
      class: 'backtest-tnodes-links',
      viewBox: `0 0 ${plan.size.w} ${plan.size.h}`,
      width: plan.size.w,
      height: plan.size.h,
      'aria-hidden': 'true',
    });
    plan.links.forEach((link) => {
      const path = svgEl('path', {
        class: `backtest-tnodes-link is-${link.lane}`,
        d: flowPath(link.x1, link.y1, link.x2, link.y2),
        fill: 'none',
      });
      attr(path, 'data-from', link.from);
      attr(path, 'data-to', link.to);
      svg.appendChild(path);
    });
    surface.appendChild(svg);

    const laneByKind = {};
    lanes.forEach((l) => { laneByKind[l.kind] = l; });
    plan.heads.forEach((h) => surface.appendChild(renderLaneHead(laneByKind[h.kind], h)));

    // 고스트 판정은 갈래 순서(진입 → 청산)를 따른다. 처음 그려진 카드가 원본이고 그 뒤는
    // 전부 '재사용'이다.
    const seen = {};
    plan.boxes.forEach((box) => {
      const node = nodeById(box.id);
      if (!node) return;
      const ghost = !!seen[box.id];
      seen[box.id] = true;
      surface.appendChild(renderCard(node, box, ghost));
    });
    return surface;
  }

  function renderLaneHead(lane, box) {
    const head = el('div', `backtest-tnodes-lane-head is-${box.kind}`);
    attr(head, 'data-flow', box.kind);
    attr(head, 'style', `left:${box.x}px;top:${box.y}px;width:${box.w}px`);
    head.appendChild(el('span', 'backtest-tnodes-lane-title', (lane && lane.title) || FLOW_TITLES[box.kind] || box.kind));
    if (lane && lane.explainable) {
      // 흐름 손잡이도 참조다 — @진입 흐름 / @청산 흐름. 무엇이 붙는지 버튼이 직접 말한다
      // (문구는 보드 21 캔버스 머리의 [전체]와 같은 '누르면 @…' 관례).
      const ask = button('backtest-tnodes-lane-explain', FLOW_EXPLAIN, () => {
        const title = FLOW_TITLES[lane.kind] || lane.kind;
        if (attach(plainRef('flow', title), () => {
          if (opts.onExplainFlow) opts.onExplainFlow(lane.kind);
        })) render();
      });
      attr(ask, 'data-flow', lane.kind);
      attr(ask, 'title', FLOW_EXPLAIN_HINT(FLOW_TITLES[lane.kind] || lane.kind));
      head.appendChild(ask);
    }
    return head;
  }

  function renderCard(node, box, ghost) {
    const classes = ['backtest-tnodes-card', `is-${box.lane}`];
    if (state.selectedId === node.id) classes.push('is-selected');
    if (ghost) classes.push('is-ghost');
    const card = el('div', classes.join(' '));
    attr(card, 'role', 'button');
    attr(card, 'tabindex', '0');
    attr(card, 'data-node-id', node.id);
    attr(card, 'data-flow', box.lane);
    attr(card, 'aria-pressed', state.selectedId === node.id ? 'true' : 'false');
    attr(card, 'aria-label', ghost ? `${ariaLabel(node)} · ${GHOST_LABEL}` : ariaLabel(node));
    attr(card, 'style', `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px`);
    // 클릭 = 이 노드를 참조한다. 초점을 카드로 되가져오지 않는다 — 부르는 쪽이 대화 입력창에
    // @참조를 넣고 포커스를 주는데, 여기서 다시 뺏으면 이어서 타자할 수 없다(실측).
    card.addEventListener('click', () => {
      setSelected(node.id);
      attach(nodeRef(node), () => { if (opts.onExplainNode) opts.onExplainNode(node.id); });
      render();
    });

    const head = el('div', 'backtest-tnodes-card-head');
    head.appendChild(el('span', 'backtest-tnodes-card-title', node.label));
    const role = roleLabel(node, state.payload.granularity);
    if (role) {
      const chip = el('span', `backtest-tnodes-card-role is-${node.role || node.stage || 'none'}`, role);
      head.appendChild(chip);
    }
    if (ghost) {
      const mark = el('span', 'backtest-tnodes-card-ghost', GHOST_LABEL);
      attr(mark, 'title', GHOST_TITLE);
      head.appendChild(mark);
    }
    card.appendChild(head);

    if (node.summary_ko) {
      const summary = el('div', 'backtest-tnodes-card-summary', node.summary_ko);
      attr(summary, 'title', node.summary_ko);
      card.appendChild(summary);
    }
    const io = ioLine(node);
    const ioEl = el('div', 'backtest-tnodes-card-io', io);
    attr(ioEl, 'title', io);
    card.appendChild(ioEl);
    const range = lineRange(node);
    if (range) card.appendChild(el('div', 'backtest-tnodes-card-lines', range));

    // 고스트에는 버튼을 달지 않는다. 같은 노드의 [코드 보기]가 화면에 둘이면 어느 것이
    // 그 함수인지 사람도 테스트도 헷갈린다 — 원본 카드 하나가 그 함수의 손잡이다.
    if (!ghost) {
      const acts = el('div', 'backtest-tnodes-card-acts');
      acts.appendChild(button('backtest-tnodes-act is-code', CARD_OPEN_CODE, (ev) => {
        if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
        if (opts.onOpenCode) opts.onOpenCode(node.id);
      }));
      card.appendChild(acts);
      refs.cards[node.id] = card;
    }
    return card;
  }

  // ---------- 아래 알약 ----------

  function renderFoot() {
    const foot = el('div', 'backtest-tnodes-foot');
    const s = state.stats;
    if (s) {
      if (s.entry != null) foot.appendChild(el('span', 'backtest-tnodes-pill is-entry', PILL_ENTRY(s.entry)));
      if (s.exit != null) foot.appendChild(el('span', 'backtest-tnodes-pill is-exit', PILL_EXIT(s.exit)));
    }
    // 발밑 버튼도 같은 손잡이다 — onReference가 있으면 여기서도 말이 나가지 않는다.
    const all = button('backtest-tnodes-explain-all', EXPLAIN_ALL, () => {
      if (attachAll()) render();
    });
    foot.appendChild(all);
    return foot;
  }

  function attachAll() {
    return attach(plainRef('all', REF_ALL_NAME), () => {
      if (opts.onExplainAll) opts.onExplainAll();
    });
  }

  // ---------- 상태 한 줄 ----------

  function statusText() {
    if (state.payload.error) {
      const msg = typeof state.payload.error === 'string'
        ? state.payload.error
        : (state.payload.error.message || '');
      return msg ? `${STATUS_ERROR} · ${msg}` : STATUS_ERROR;
    }
    if (!state.payload.nodes.length) return STATUS_EMPTY;
    // 참조를 붙인 직후에는 그 사실만 말한다 — 사람이 다음에 할 일은 입력창에 자기 말을
    // 쓰는 것이고, 그 자리를 상태 줄이 짚어 준다(보드 21).
    if (state.attached) return STATUS_ATTACHED(state.attached);
    const node = nodeById(state.selectedId);
    if (!node) return STATUS_IDLE;
    const kinds = lanesOf(node.id);
    let where = STATUS_OFF_FLOW;
    if (kinds.length > 1) where = STATUS_BOTH;
    else if (kinds.length === 1) where = FLOW_TITLES[kinds[0]] || kinds[0];
    return `${STATUS_SELECT} · ${ariaLabel(node)} · ${where}`;
  }

  function renderStatus() {
    const line = el('div', 'backtest-tnodes-status');
    attr(line, 'role', 'status');
    if (state.payload.error) line.className = 'backtest-tnodes-status is-error';
    line.appendChild(el('span', 'backtest-tnodes-status-text', statusText()));
    // unknown은 계약이 주는 값이라 화면이 삼키지 않는다 — 서버가 역할을 못 읽었다는 사실을
    // 감추면 사용자는 노드가 왜 흐름에 없는지 영원히 모른다.
    if (state.payload.unknown.length) {
      line.appendChild(el(
        'span',
        'backtest-tnodes-status-unknown',
        UNKNOWN_NOTE(state.payload.unknown.length, state.payload.unknown.join(', ')),
      ));
    }
    return line;
  }

  // ---------- 렌더 ----------

  function render() {
    if (destroyed) return;
    clear(root);
    refs = { cards: {}, rail: {} };
    const lanes = buildLanes(state.payload);

    const body = el('div', 'backtest-tnodes-body');
    body.appendChild(renderRail());
    body.appendChild(renderCanvas(lanes));
    root.appendChild(body);
    root.appendChild(renderStatus());
  }

  render();

  return {
    element: root,
    setPayload(payload) {
      state.payload = normalizePayload(payload);
      state.attached = null; // 판이 갈리면 앞 참조는 다른 기법의 함수를 가리킨다
      if (state.selectedId && !nodeById(state.selectedId)) setSelected(null, true);
      render();
    },
    setStats(stats) {
      state.stats = stats || null;
      render();
    },
    select: select,
    focusNode: focusNode,
    getSelected() { return state.selectedId; },
    destroy() {
      destroyed = true;
      clear(root);
      if (typeof container.removeChild === 'function') container.removeChild(root);
    },
  };
}

const __exports = {
  createTechniqueNodes,
  normalizePayload,
  buildLanes,
  layout,
  flowPath,
  roleLabel,
  ioLine,
  lineRange,
  stageIds,
  ROLE_LABELS,
  STAGE_LABELS,
  STAGE_ORDER,
};

// UMD 각주(2026-08-18 렌더러 격리) — lib의 다른 렌더러 모듈과 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BacktestTechniqueNodes = __exports;
}

})();
