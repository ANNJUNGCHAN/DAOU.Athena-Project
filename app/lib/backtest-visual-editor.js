// 시각 전략 편집기 — Paper 보드 11(편집 가능)·12(연결 오류)·14(동기화 완료).
//
// **왜 지도(backtest-explain.js) 옆에 따로 서는가.** 지도는 백엔드가 만든 설명 페이로드를
// 그대로 그리는 읽기 전용 표면이라 상태가 없다. 이 파일은 **편집** 표면이라 상태를 가진다 —
// 되돌리기 이력, 선택, 연결 중인 포트, 좁은 폭의 서랍. 두 규율을 한 파일에 섞으면 "화면이
// 문장을 만들지 않는다"는 지도의 계약이 먼저 무너진다.
//
// **문구의 출처.** 노드 이름은 registry의 `label_ko`, 오류 문장은 diagnostics의 `message_ko`,
// 요약 한 줄은 validation의 `summary_ko`에서 온다. 이 파일이 직접 갖는 한국어는 화면 구조
// 라벨(팔레트 머리말·요약 바 제목·포트 이름표·"이 노드는 무엇을 하나요?" 설명)뿐이고, 전부
// 보드 11·12·14에 그려진 그대로다. 서버가 summary_ko를 주면 계산값보다 서버 문장을 쓴다 —
// 같은 사실이 두 문장으로 갈라지면 어느 쪽이 맞는지 아무도 모른다.
//
// **한 진단은 네 곳에 같은 code로 뜬다**(US-006 수용 기준): ① 노드 고리·배지 ② 포트/엣지
// 강조 ③ 검사기 상세 ④ 요약 바. 네 곳 전부 `data-diag-code`를 달아 "같은 코드가 네 곳에
// 있다"를 사람 눈이 아니라 테스트가 판정하게 만든다.
//
// **드래그 없이도 전부 된다.** 포인터가 안 되는 환경(키보드·스크린리더·좁은 폭)에서 그래프
// 편집이 통째로 막히면 안 되므로, 같은 편집 연산을 목록/폼 보기(`[목록으로 보기]`)와 키보드
// (Tab 이동·Enter 코드 열기·Delete 삭제·Ctrl+Z/Y)로 한 번 더 낸다. 캔버스는 편의이지 관문이
// 아니다.
//
// 프레임워크를 쓰지 않는 이유는 PRD 결정 그대로다 — "P0/P1 편집기는 새 프레임워크 없이
// DOM/SVG로 만든다(Rete/React Flow 도입은 P4 graduate gate 뒤)". vis-network가 설치돼 있어도
// 여기서는 쓰지 않는다: 포트 타입·진단 귀속·좌표를 테스트로 단언해야 하는데 그 라이브러리는
// 좌표를 감춘다(backtest-equity-chart.js가 lightweight-charts를 버린 것과 같은 이유).
(function () {
'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------- 보드에 적힌 문구 ----------

const CANVAS_TITLE = '진입·청산 흐름';
const PALETTE_TITLE = '노드';
const PALETTE_SUB = '끌어서 전략에 놓기';
const PALETTE_SEARCH = '노드 검색';
const PALETTE_EMPTY = '찾는 노드가 없습니다';

const PILL_VALID = '연결 정상';
const PILL_SYNCED = '동기화';
const PILL_UNVALIDATED = '검증 전';

const SUMMARY_VALID = 'StrategySpec으로 변환할 수 있습니다';
const SUMMARY_SYNCED = '그래프와 코드가 같은 버전입니다';
const SUMMARY_UNVALIDATED = '아직 검증하지 않았습니다';
const SUMMARY_UNVALIDATED_DETAIL = '서버 검증을 거쳐야 실행할 수 있습니다';
const SUMMARY_LIST = '목록으로 보기';
const SUMMARY_LIST_SHORT = '목록 보기';
const SUMMARY_GRAPH = '그래프로 보기';
const SUMMARY_FIRST_ERROR = '첫 오류로';
const SUMMARY_VALIDATE = '검증';

const INSPECT_EYEBROW = '선택한 노드';
const INSPECT_EYEBROW_ERROR = '오류가 난 노드';
const INSPECT_EMPTY = '노드를 고르면 여기에서 값을 바꿉니다';
const INSPECT_IO = { input: '입력', output: '출력' };
const INSPECT_OK = '연결과 값이 유효합니다';
const INSPECT_WHAT = '이 노드는 무엇을 하나요?';
const INSPECT_SPEC = '생성될 StrategySpec 보기';
const INSPECT_WHERE = '문제 위치';
const INSPECT_WHERE_PORT = '포트';
const INSPECT_WHERE_CODE = '코드';
const INSPECT_OPEN_TITLE = '더블클릭 · Enter로 코드 열기';
const INSPECT_OPEN_NOTE = '코드 탭의 해당 행으로 이동하고, 연결된 노드와 줄 범위를 함께 강조합니다.';
const INSPECT_OPEN_CODE = '코드에서 열기';
const INSPECT_ASK_CHAT = '대화로 수정하기';
const INSPECT_ASK_NOTE = 'AI는 바로 고치지 않고, 필요한 선택을 한 번에 하나씩 묻습니다.';
const INSPECT_BLOCKED = '설계와 오류 검토는 가능하지만, 이 상태에서는 최종 실행을 시작할 수 없습니다.';
const INSPECT_DRAFT = '값을 바꾸면 새 초안이 됩니다. 저장하거나 실행하기 전까지 현재 버전에는 영향이 없습니다.';
const INSPECT_LABEL_FIELD = '이름';
const INSPECT_LINKS = '입력 연결';
const INSPECT_NO_LINK = '연결 없음';

const LIST_TITLE = '노드 목록';
const LIST_SUB = '끌지 않고 고쳐도 그래프는 같습니다';
const LIST_ADD = '노드 추가';
const LIST_REMOVE = '삭제';

const DRAWER_PALETTE = '노드';
const DRAWER_INSPECTOR = '검사기';
const DRAWER_CLOSE = '닫기';
const SELECTION_PREFIX = '선택';

const UNDO_LABEL = '↶';
const REDO_LABEL = '↷';
const FIT_LABEL = '맞춤';

// 포트 이름을 사람 말로. 보드 11의 "입력 데이터", 보드 14의 "오른쪽 입력"이 여기서 온다.
const PORT_FIELD_LABELS = {
  source: '입력 데이터',
  period: '기간 입력',
  left: '왼쪽 입력',
  right: '오른쪽 입력',
  signal: '신호 입력',
  in1: '조건 1',
  in2: '조건 2',
  in3: '조건 3',
  in4: '조건 4',
};

// 봉의 축 이름. 보드 11 검사기의 "종가 close"가 이 표에서 나온다.
const PORT_LABELS = {
  open: '시가',
  high: '고가',
  low: '저가',
  close: '종가',
  volume: '거래량',
  ohlcv: '봉 전체',
  value: '값',
  signal: '신호',
};

const PARAM_LABELS = {
  period: '기간',
  alias: '이름',
  compare_to: '비교 값',
  name: '이름',
  default: '기본값',
  min: '최소',
  max: '최대',
  step: '증분',
  type: '자료형',
};

const PARAM_MIN = '최소';
const PARAM_MAX = '최대';

// 팔레트 그룹의 가로 자리. 보드 11의 왼→오 흐름(데이터 → 지표 → 조건 → 출력)이 곧 열이다.
const GROUP_COLUMN = { 데이터: 0, 지표: 1, 조건: 2, 출력: 3 };

// 팔레트 항목 앞의 글리프. 색은 CSS가 정하고 여기서는 모양만 고른다.
const GROUP_GLYPH = { 데이터: '■', 지표: 'ƒx', 조건: '↗', 출력: '●' };

// Paper 실측은 100×86(출력 62×56 · 데이터 92×84)이고 카드 안 글자는 9px이다. 이 앱의 글자
// 스케일에는 9px 단이 없어(tokens.css: 2xs=10px) 같은 문장이 8% 넓어진다 — 'Series<Number>'가
// 말줄임으로 잘리면 타입을 못 읽으므로 카드 폭을 같은 비율로 늘린다. 보드와 다른 숫자지만
// 보드가 지키려던 것(한 줄에 타입 하나가 다 보인다)은 이쪽이 지킨다.
const NODE_SIZE_DEFAULT = { w: 108, h: 86 };
const NODE_SIZE_OUTPUT = { w: 66, h: 56 };
const NODE_SIZE_DATA = { w: 100, h: 84 };
const COLUMN_PITCH = 128;

const SURFACE_MIN_W = 438;
const SURFACE_MIN_H = 536;
const NOTICE_MS = 4000;

// ---------- 순수 계산 ----------

function cloneGraph(graph) {
  const base = graph || {};
  const out = {
    graph_version: base.graph_version || '1',
    nodes: JSON.parse(JSON.stringify(base.nodes || [])),
    edges: JSON.parse(JSON.stringify(base.edges || [])),
    scenario: JSON.parse(JSON.stringify(base.scenario || {})),
  };
  // 이름표(meta — 전략 이름·설명·태그·분류)는 이 편집기가 그리지 않는 값이지만 **그래프의
  // 일부**다. 여기서 떨어뜨리면 노드 값 하나만 고쳐도 그 넷이 사라져 컴파일된 스펙이
  // "시각 전략"이 되고, 저장할 bundle의 graph_hash도 서버가 다시 계산한 값과 어긋난다
  // (2026-09-03 실측 — O07이 422 "bundle hash가 …다르다: graph_hash"로 막혔다).
  // 그리지 않는다고 버리지 않는다.
  if (base.meta) out.meta = JSON.parse(JSON.stringify(base.meta));
  return out;
}

// 노드 ID는 만들 때 한 번 발급하고 이름·이동·값 변경에 그대로 둔다(US-006). 라벨이나 좌표에서
// 만들면 이름을 바꾼 순간 다른 노드가 되고, 지운 ID가 되살아나 진단이 엉뚱한 칸에 붙는다.
function freshId(prefix) {
  const g = typeof globalThis !== 'undefined' ? globalThis : null;
  const c = g && g.crypto;
  if (c && typeof c.randomUUID === 'function') return `${prefix}_${c.randomUUID()}`;
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

// 타입 일치. `Series<Number>|Number`처럼 합집합으로 선언된 입력은 어느 쪽이든 받는다
// (condition.right이 그렇다). 타입을 모르는 포트는 막지 않는다 — 모른다고 거절하면
// registry가 늘어날 때마다 화면이 먼저 고장 난다.
function typeAccepts(targetType, sourceType) {
  if (!targetType || !sourceType) return true;
  const accepted = String(targetType).split('|').map((s) => s.trim());
  return accepted.indexOf(String(sourceType).trim()) !== -1;
}

// registry 정규화 — 서버(visual_registry.py)와 계획서가 같은 것을 다른 이름으로 말한다:
//   포트 이름     `name`      ↔ `port`
//   합집합 타입   `accepts[]` ↔ `"A|B"`
//   묶음          `category`  ↔ `group`
//   선택지        `choices`   ↔ `enum`
// 둘 중 하나만 읽으면 계약이 바뀌는 날 화면이 조용히 빈칸이 된다. 경계에서 한 번 접어두고
// 안쪽은 한 가지 모양만 안다.
const CATEGORY_GROUP = {
  data: '데이터',
  param: '데이터',
  indicator: '지표',
  condition: '조건',
  logic: '조건',
  output: '출력',
};

function normalizePort(port) {
  const accepts = port.accepts && port.accepts.length ? port.accepts.join('|') : null;
  return {
    port: port.port != null ? port.port : port.name,
    type: accepts || port.type || '',
    label_ko: port.label_ko || '',
    required: !!port.required,
  };
}

function normalizeParam(param) {
  const out = {};
  Object.keys(param).forEach((k) => { out[k] = param[k]; });
  if (!out.enum && param.choices) out.enum = param.choices;
  return out;
}

function normalizeRegistry(registry) {
  const kinds = ((registry && registry.kinds) || []).map((k) => ({
    kind: k.kind,
    label_ko: k.label_ko || k.kind,
    group: k.group || CATEGORY_GROUP[k.category] || '기타',
    inputs: (k.inputs || []).map(normalizePort),
    outputs: (k.outputs || []).map(normalizePort),
    params: (k.params || []).map(normalizeParam),
    max_per_graph: k.max_per_graph == null ? null : k.max_per_graph,
  }));
  return { kinds: kinds };
}

// 파라미터 자료형은 서버가 int·float으로도 말한다 — 셋 다 슬라이더와 숫자칸을 쓴다.
function isNumericParam(param) {
  return param.type === 'number' || param.type === 'int' || param.type === 'float';
}

function portsOf(spec, dir) {
  if (!spec) return [];
  return (dir === 'in' ? spec.inputs : spec.outputs) || [];
}

function findPort(spec, dir, port) {
  return portsOf(spec, dir).filter((p) => p.port === port)[0] || null;
}

// 진단이 붙은 카드는 '어느 포트가 비었는지'와 '코드 몇 행인지' 두 줄이 더 붙는다(보드 12).
// 카드를 그만큼 키우지 않으면 그 두 줄이 잘려 오류 카드만 정보가 적어진다.
function nodeSize(kind, hasDiagnostic) {
  const base = (kind === 'output.entry' || kind === 'output.exit')
    ? NODE_SIZE_OUTPUT
    : (kind === 'data.ohlcv' ? NODE_SIZE_DATA : NODE_SIZE_DEFAULT);
  return hasDiagnostic ? { w: base.w, h: base.h + 26 } : base;
}

// 포트 점의 세로 자리. 보드는 입력이 하나면 카드 중간보다 살짝 위(86 카드에서 37), 둘이면
// 그 위아래로 22씩 벌린다. 포트가 많은 노드(가격 데이터의 6출력)는 카드 밖으로 나가지 않게
// 간격을 줄인다.
function portAnchor(box, count, index) {
  const center = Math.round(box.h * 0.43);
  if (count <= 1) return center;
  const spacing = Math.min(22, Math.max(10, (box.h - 24) / (count - 1)));
  return Math.round(center + (index - (count - 1) / 2) * spacing);
}

function edgePath(x1, y1, x2, y2) {
  const dx = Math.max(18, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

// 순환은 연결하기 전에 막는다. 만들고 나서 서버가 거절하면 사용자는 이미 "됐다"고 믿은 뒤다.
function reaches(edges, fromId, targetId) {
  const seen = {};
  const stack = [fromId];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === targetId) return true;
    if (seen[cur]) continue;
    seen[cur] = true;
    edges.forEach((e) => {
      if (e.from && e.from.node_id === cur && e.to) stack.push(e.to.node_id);
    });
  }
  return false;
}

// 이 노드가 결국 어느 출력으로 가는가(진입/청산). 보드가 조건 카드의 제목 색과 캔버스
// 워터마크를 이걸로 정한다 — "하향 돌파"가 파랑인 이유는 청산으로 흐르기 때문이다.
// 두 갈래에 다 닿는 노드(두 조건이 함께 쓰는 가격 데이터)는 어느 쪽도 아니다 — 한쪽으로
// 정하면 화면이 사실이 아닌 것을 색으로 말한다.
function branchOf(nodes, edges, nodeId) {
  const byId = {};
  nodes.forEach((n) => { byId[n.id] = n; });
  const seen = {};
  const stack = [nodeId];
  const hit = {};
  while (stack.length) {
    const cur = stack.pop();
    if (seen[cur]) continue;
    seen[cur] = true;
    const node = byId[cur];
    if (node && node.kind === 'output.entry') hit.entry = true;
    if (node && node.kind === 'output.exit') hit.exit = true;
    edges.forEach((e) => {
      if (e.from && e.from.node_id === cur && e.to) stack.push(e.to.node_id);
    });
  }
  if (hit.entry && hit.exit) return null;
  if (hit.entry) return 'entry';
  if (hit.exit) return 'exit';
  return null;
}

function warmupBars(nodes) {
  let max = 0;
  nodes.forEach((n) => {
    const period = n.params && n.params.period;
    if (typeof period === 'number' && period > max) max = period;
  });
  return max > 0 ? max - 1 : 0;
}

function countKind(nodes, kind) {
  return nodes.filter((n) => n.kind === kind).length;
}

// 요약 바의 부제. 서버가 summary_ko를 주면 그걸 쓰고, 없을 때만 이 계산이 대신 말한다.
function summaryDetail(nodes, edges) {
  return [
    `${nodes.length}개 노드`,
    `${edges.length}개 연결`,
    `진입 ${countKind(nodes, 'output.entry')}`,
    `청산 ${countKind(nodes, 'output.exit')}`,
    `워밍업 ${warmupBars(nodes)}봉`,
  ].join(' · ');
}

function severityOf(diag) {
  return (diag && diag.severity) || 'error';
}

function firstError(diagnostics) {
  const list = diagnostics || [];
  return list.filter((d) => severityOf(d) === 'error')[0] || list[0] || null;
}

function sourceSpanText(diag) {
  const span = diag && diag.source_span;
  if (!span || !span.file) return '';
  const line = span.start && span.start.line;
  return line == null ? String(span.file) : `${span.file}:${line}`;
}

// ---------- 한국어 설명 ----------

// 보드 11·14의 "이 노드는 무엇을 하나요?" 문단. 노드 종류마다 한 문장으로 고정한다 —
// 여기서 LLM을 부르면 같은 노드가 열 때마다 다르게 설명되고, 사용자는 어느 설명이 맞는지
// 판단할 방법이 없다.
function explainNode(node, spec, ctx) {
  const kind = node.kind;
  const label = (spec && spec.label_ko) || kind;
  if (kind === 'data.ohlcv') {
    const s = (ctx.graph.scenario || {});
    const who = s.symbol ? `${s.symbol}의 ` : '';
    return `${who}봉 데이터를 시가·고가·저가·종가·거래량으로 나눠 다음 노드에 건넵니다. 이 노드는 값을 만들지 않고 앱이 준비한 것을 그대로 옮깁니다.`;
  }
  if (kind === 'param') {
    const name = (node.params && node.params.name) || '이름 없음';
    return `전략 안에서 ${name}(으)로 부르는 숫자입니다. 값을 바꾸면 이 이름을 쓰는 노드가 모두 함께 바뀝니다.`;
  }
  if (kind.indexOf('indicator.') === 0) {
    const period = node.params && node.params.period;
    if (typeof period === 'number') {
      return `최근 ${period}개 종가의 평균을 매 봉마다 계산합니다. 첫 ${Math.max(period - 1, 0)}개 봉은 워밍업 구간이라 신호를 만들지 않습니다.`;
    }
    return `${label}을(를) 매 봉마다 계산해 시계열로 내보냅니다.`;
  }
  if (kind.indexOf('condition.') === 0) {
    const sides = conditionSides(node, ctx);
    const left = sides.left || '왼쪽 입력';
    const right = sides.right || '오른쪽 입력';
    const branch = ctx.branch[node.id];
    const target = branch === 'entry' ? '진입 신호' : (branch === 'exit' ? '청산 신호' : '신호');
    const verb = CONDITION_VERBS[kind] || '비교한';
    return `${left}이(가) ${right}${verb} 봉을 ${target}(으)로 만듭니다.`;
  }
  if (kind === 'logic.and') return '연결된 조건이 모두 참인 봉만 신호로 남깁니다. 비어 있는 입력은 무시합니다.';
  if (kind === 'logic.or') return '연결된 조건 중 하나라도 참이면 그 봉을 신호로 남깁니다.';
  if (kind === 'output.entry') return '이 신호가 참인 봉에서 매수합니다. 진입 신호는 전략에 하나만 있을 수 있습니다.';
  if (kind === 'output.exit') return '이 신호가 참인 봉에서 매도합니다. 청산 신호는 전략에 하나만 있을 수 있습니다.';
  return `${label} 노드입니다.`;
}

const CONDITION_VERBS = {
  'condition.cross_above': ' 위로 넘는',
  'condition.cross_below': ' 아래로 내려가는',
  'condition.greater_than': '보다 큰',
  'condition.less_than': '보다 작은',
  'condition.greater_equal': '보다 크거나 같은',
  'condition.less_equal': '보다 작거나 같은',
  'condition.equals': '과(와) 같은',
};

const CONDITION_GLYPHS = {
  'condition.cross_above': '↗',
  'condition.cross_below': '↘',
  'condition.greater_than': '>',
  'condition.less_than': '<',
  'condition.greater_equal': '≥',
  'condition.less_equal': '≤',
  'condition.equals': '=',
};

// 조건 카드 두 번째 줄("fast ↗ slow")을 만든다. 연결된 상대의 별칭을 그대로 읽는다 —
// 화면이 이름을 새로 지으면 코드의 이름과 갈라진다.
function conditionSides(node, ctx) {
  const out = { left: '', right: '' };
  (ctx.edges || []).forEach((e) => {
    if (!e.to || e.to.node_id !== node.id) return;
    const src = ctx.byId[e.from && e.from.node_id];
    if (!src) return;
    const name = shortName(src);
    if (e.to.port === 'left') out.left = name;
    if (e.to.port === 'right') out.right = name;
  });
  if (!out.right && node.params && node.params.compare_to != null) {
    out.right = String(node.params.compare_to);
  }
  return out;
}

function shortName(node) {
  if (node.params && node.params.alias) return String(node.params.alias);
  if (node.params && node.params.name) return String(node.params.name);
  return node.label || node.id;
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

function isFormTarget(ev) {
  const target = ev && ev.target;
  if (!target) return false;
  const name = String(target.tagName || target.tag || '').toLowerCase();
  return name === 'input' || name === 'select' || name === 'textarea';
}

// ---------- 편집기 ----------

function createVisualEditor(container, options) {
  const opts = options || {};
  const timer = opts.setTimeoutImpl || (typeof setTimeout === 'function' ? setTimeout : null);
  const untimer = opts.clearTimeoutImpl || (typeof clearTimeout === 'function' ? clearTimeout : null);

  const state = {
    registry: normalizeRegistry(opts.registry),
    graph: cloneGraph(opts.graph),
    diagnostics: (opts.diagnostics || []).slice(),
    validation: opts.validation || { state: 'unvalidated', summary_ko: '' },
    readOnly: !!opts.readOnly,
    narrow: !!opts.narrow,
    selectedId: null,
    view: 'graph',
    search: '',
    notice: '',
    pendingFrom: null,
    paletteOpen: false,
    inspectorOpen: false,
    coalesceKey: null,
    past: [],
    future: [],
  };

  let destroyed = false;
  let noticeTimer = null;
  let refs = { nodes: {}, ports: {} };
  let drag = null;

  const root = el('div', 'backtest-vis');
  root.setAttribute('tabindex', '-1');
  container.appendChild(root);
  root.addEventListener('keydown', onKeyDown);

  // ---------- 조회 ----------

  function kindSpec(kind) {
    return (state.registry.kinds || []).filter((k) => k.kind === kind)[0] || null;
  }

  function nodeById(id) {
    return (state.graph.nodes || []).filter((n) => n.id === id)[0] || null;
  }

  function diagnosticsFor(nodeId) {
    return state.diagnostics.filter((d) => d.node_id === nodeId);
  }

  function selectedNode() {
    return state.selectedId ? nodeById(state.selectedId) : null;
  }

  // ---------- 이력 ----------

  function pushHistory() {
    state.past.push({ graph: cloneGraph(state.graph), selectedId: state.selectedId });
    if (state.past.length > 100) state.past.shift();
    state.future.length = 0;
  }

  function emitChange(reason) {
    if (opts.onChange) opts.onChange(cloneGraph(state.graph), { reason: reason });
  }

  function undo() {
    if (!state.past.length) return false;
    state.future.push({ graph: cloneGraph(state.graph), selectedId: state.selectedId });
    const prev = state.past.pop();
    state.graph = prev.graph;
    setSelected(prev.selectedId, true);
    state.coalesceKey = null;
    render();
    emitChange('undo');
    return true;
  }

  function redo() {
    if (!state.future.length) return false;
    state.past.push({ graph: cloneGraph(state.graph), selectedId: state.selectedId });
    const next = state.future.pop();
    state.graph = next.graph;
    setSelected(next.selectedId, true);
    state.coalesceKey = null;
    render();
    emitChange('redo');
    return true;
  }

  // ---------- 알림 한 줄 ----------

  // 거절은 조용히 하지 않는다 — 연결이 안 붙었는데 이유가 없으면 사용자는 자기 손을 의심한다.
  function notice(text) {
    state.notice = text;
    if (noticeTimer != null && untimer) untimer(noticeTimer);
    if (timer) {
      noticeTimer = timer(() => {
        noticeTimer = null;
        if (destroyed) return;
        state.notice = '';
        render();
      }, NOTICE_MS);
      if (noticeTimer && typeof noticeTimer.unref === 'function') noticeTimer.unref();
    }
  }

  // ---------- 편집 연산 ----------

  function guardEditable() {
    if (state.readOnly) {
      notice('읽기 전용 그래프입니다 — 코드에서 만들어진 전략은 여기서 고치지 않습니다');
      return false;
    }
    return true;
  }

  function addNode(kind) {
    if (!guardEditable()) return null;
    const spec = kindSpec(kind);
    if (!spec) { notice(`모르는 노드 종류입니다 · ${kind}`); return null; }
    state.coalesceKey = null;
    pushHistory();
    const params = {};
    (spec.params || []).forEach((p) => {
      if (p.default !== undefined) params[p.name] = p.default;
    });
    const node = {
      id: freshId('n'),
      kind: kind,
      label: spec.label_ko || kind,
      params: params,
      ui: nextFreeSlot(spec),
    };
    state.graph.nodes.push(node);
    setSelected(node.id);
    render();
    emitChange('add');
    return node.id;
  }

  function nextFreeSlot(spec) {
    const col = GROUP_COLUMN[spec && spec.group] != null ? GROUP_COLUMN[spec.group] : 1;
    const x = 16 + col * COLUMN_PITCH;
    let y = 20;
    const taken = (state.graph.nodes || [])
      .filter((n) => n.ui && Math.abs(n.ui.x - x) < 4)
      .map((n) => n.ui.y);
    while (taken.indexOf(y) !== -1) y += 104;
    return { x: x, y: y, collapsed: false };
  }

  function duplicateNode(nodeId) {
    if (!guardEditable()) return null;
    const src = nodeById(nodeId);
    if (!src) return null;
    state.coalesceKey = null;
    pushHistory();
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = freshId('n');
    copy.ui = { x: (src.ui && src.ui.x || 0) + 18, y: (src.ui && src.ui.y || 0) + 18, collapsed: false };
    state.graph.nodes.push(copy);
    setSelected(copy.id);
    render();
    emitChange('duplicate');
    return copy.id;
  }

  // 이동은 ui만 건드리고 이력을 한 줌으로 접는다 — 픽셀마다 이력을 쌓으면 Ctrl+Z 한 번이
  // 아무것도 되돌리지 못한다.
  function moveNode(nodeId, x, y) {
    if (!guardEditable()) return false;
    const node = nodeById(nodeId);
    if (!node) return false;
    const key = `move:${nodeId}`;
    if (state.coalesceKey !== key) {
      pushHistory();
      state.coalesceKey = key;
    }
    node.ui = node.ui || {};
    node.ui.x = Math.round(x);
    node.ui.y = Math.round(y);
    render();
    emitChange('move');
    return true;
  }

  function connectionError(from, to) {
    if (!from || !to) return '연결할 포트를 고르지 못했습니다';
    if (from.node_id === to.node_id) return '자기 자신에는 연결할 수 없습니다';
    const src = nodeById(from.node_id);
    const dst = nodeById(to.node_id);
    if (!src || !dst) return '없는 노드입니다';
    const srcPort = findPort(kindSpec(src.kind), 'out', from.port);
    const dstPort = findPort(kindSpec(dst.kind), 'in', to.port);
    if (!srcPort) return `${src.label || src.kind}에는 ${from.port} 출력이 없습니다`;
    if (!dstPort) return `${dst.label || dst.kind}에는 ${to.port} 입력이 없습니다`;
    if (!typeAccepts(dstPort.type, srcPort.type)) {
      return `타입이 맞지 않습니다 · ${srcPort.type} → ${dstPort.type} 자리에는 연결할 수 없습니다`;
    }
    if (reaches(state.graph.edges || [], to.node_id, from.node_id)) {
      return '순환이 생겨 연결하지 않았습니다';
    }
    return null;
  }

  function connect(from, to) {
    if (!guardEditable()) return null;
    const why = connectionError(from, to);
    if (why) { notice(why); return null; }
    state.coalesceKey = null;
    pushHistory();
    // 입력 포트는 하나만 받는다 — 두 줄이 같은 칸에 들어오면 어느 쪽이 쓰였는지 화면이 거짓말한다.
    state.graph.edges = (state.graph.edges || []).filter(
      (e) => !(e.to && e.to.node_id === to.node_id && e.to.port === to.port),
    );
    const edge = {
      id: freshId('e'),
      from: { node_id: from.node_id, port: from.port },
      to: { node_id: to.node_id, port: to.port },
    };
    state.graph.edges.push(edge);
    state.pendingFrom = null;
    render();
    emitChange('connect');
    return edge.id;
  }

  function disconnect(edgeId) {
    if (!guardEditable()) return false;
    const before = (state.graph.edges || []).length;
    state.coalesceKey = null;
    pushHistory();
    state.graph.edges = (state.graph.edges || []).filter((e) => e.id !== edgeId);
    if (state.graph.edges.length === before) { state.past.pop(); return false; }
    render();
    emitChange('disconnect');
    return true;
  }

  function disconnectPort(nodeId, port) {
    const edge = (state.graph.edges || [])
      .filter((e) => e.to && e.to.node_id === nodeId && e.to.port === port)[0];
    return edge ? disconnect(edge.id) : false;
  }

  function removeNode(nodeId) {
    if (!guardEditable()) return false;
    if (!nodeById(nodeId)) return false;
    state.coalesceKey = null;
    pushHistory();
    state.graph.nodes = (state.graph.nodes || []).filter((n) => n.id !== nodeId);
    state.graph.edges = (state.graph.edges || []).filter(
      (e) => (!e.from || e.from.node_id !== nodeId) && (!e.to || e.to.node_id !== nodeId),
    );
    if (state.selectedId === nodeId) setSelected(null);
    render();
    emitChange('remove');
    return true;
  }

  function setParam(nodeId, name, value) {
    if (!guardEditable()) return false;
    const node = nodeById(nodeId);
    if (!node) return false;
    state.coalesceKey = null;
    pushHistory();
    node.params = node.params || {};
    node.params[name] = value;
    render();
    emitChange('param');
    return true;
  }

  function renameNode(nodeId, label) {
    if (!guardEditable()) return false;
    const node = nodeById(nodeId);
    if (!node) return false;
    state.coalesceKey = null;
    pushHistory();
    node.label = String(label);
    render();
    emitChange('rename');
    return true;
  }

  // ---------- 선택 ----------

  function setSelected(nodeId, silent) {
    const next = nodeId || null;
    if (state.selectedId === next) return;
    state.selectedId = next;
    if (!silent && opts.onSelect) opts.onSelect(next);
  }

  function select(nodeId) {
    setSelected(nodeId);
    render();
  }

  function focusNode(nodeId) {
    if (nodeId && state.selectedId !== nodeId) select(nodeId);
    focusEl(refs.nodes[nodeId || state.selectedId]);
  }

  function cycleSelection(step) {
    const nodes = state.graph.nodes || [];
    if (!nodes.length) return;
    const idx = nodes.map((n) => n.id).indexOf(state.selectedId);
    const next = idx < 0
      ? (step > 0 ? 0 : nodes.length - 1)
      : (idx + step + nodes.length) % nodes.length;
    select(nodes[next].id);
    focusEl(refs.nodes[nodes[next].id]);
  }

  // ---------- 키보드 ----------

  // 캔버스를 못 쓰는 사람에게도 같은 연산을 준다(US-006). Tab을 가로채는 이유: 노드 사이
  // 이동은 "다음 폼 칸"이 아니라 "다음 노드"여야 검사기가 따라온다.
  function onKeyDown(ev) {
    if (!ev) return;
    // 입력칸 안의 Backspace·Enter·Tab은 글자를 지우고 다음 칸으로 가는 뜻이다 — 여기서
    // 가로채면 이름을 고치려던 사람이 노드를 지운다.
    if (isFormTarget(ev)) return;
    const key = ev.key;
    const ctrl = ev.ctrlKey || ev.metaKey;
    const stop = () => { if (typeof ev.preventDefault === 'function') ev.preventDefault(); };

    if (ctrl && (key === 'z' || key === 'Z')) { stop(); undo(); return; }
    if (ctrl && (key === 'y' || key === 'Y')) { stop(); redo(); return; }
    if (key === 'Escape') {
      stop();
      if (state.pendingFrom) { state.pendingFrom = null; render(); return; }
      if (state.paletteOpen || state.inspectorOpen) { closeDrawers(); return; }
      return;
    }
    if (key === 'Tab') {
      if (!(state.graph.nodes || []).length) return;
      stop();
      cycleSelection(ev.shiftKey ? -1 : 1);
      return;
    }
    if (key === 'Enter') {
      if (!state.selectedId) return;
      stop();
      if (opts.onOpenCode) opts.onOpenCode(state.selectedId);
      return;
    }
    if (key === 'Delete' || key === 'Backspace') {
      if (!state.selectedId || state.readOnly) return;
      stop();
      removeNode(state.selectedId);
    }
  }

  function closeDrawers() {
    const had = state.paletteOpen || state.inspectorOpen;
    state.paletteOpen = false;
    state.inspectorOpen = false;
    render();
    // 서랍을 닫으면 초점은 열기 전에 보던 노드로 돌아간다 — 초점이 문서 처음으로 튀면
    // 키보드 사용자는 방금 무엇을 하던 중이었는지 잃는다.
    if (had) focusNode(state.selectedId);
  }

  // ---------- 렌더 문맥 ----------

  function buildContext() {
    const nodes = state.graph.nodes || [];
    const edges = state.graph.edges || [];
    const byId = {};
    const spec = {};
    nodes.forEach((n) => { byId[n.id] = n; spec[n.id] = kindSpec(n.kind); });

    const diagByNode = {};
    state.diagnostics.forEach((d) => {
      if (!d || !d.node_id) return;
      (diagByNode[d.node_id] = diagByNode[d.node_id] || []).push(d);
    });

    const boxes = {};
    const used = {};
    nodes.forEach((n) => {
      const size = nodeSize(n.kind, !!diagByNode[n.id]);
      let x = n.ui && typeof n.ui.x === 'number' ? n.ui.x : null;
      let y = n.ui && typeof n.ui.y === 'number' ? n.ui.y : null;
      if (x === null || y === null) {
        const s = spec[n.id];
        const col = GROUP_COLUMN[s && s.group] != null ? GROUP_COLUMN[s.group] : 1;
        const row = used[col] == null ? 0 : used[col] + 1;
        used[col] = row;
        x = 16 + col * COLUMN_PITCH;
        y = 20 + row * 104;
      }
      boxes[n.id] = { x: x, y: y, w: size.w, h: size.h };
    });

    const branch = {};
    nodes.forEach((n) => { branch[n.id] = branchOf(nodes, edges, n.id); });

    const errors = state.diagnostics.filter((d) => severityOf(d) === 'error');
    return {
      graph: state.graph,
      nodes: nodes,
      edges: edges,
      byId: byId,
      spec: spec,
      boxes: boxes,
      diagByNode: diagByNode,
      branch: branch,
      errors: errors,
      first: firstError(state.diagnostics),
    };
  }

  function portPoint(ctx, nodeId, port, dir) {
    const spec = ctx.spec[nodeId];
    const box = ctx.boxes[nodeId];
    if (!box) return null;
    const list = portsOf(spec, dir);
    let idx = list.map((p) => p.port).indexOf(port);
    let count = list.length;
    if (idx < 0) { idx = 0; count = Math.max(count, 1); }
    return {
      x: dir === 'in' ? box.x : box.x + box.w,
      y: box.y + portAnchor(box, count, idx),
    };
  }

  // ---------- 팔레트 ----------

  function paletteGroups() {
    const groups = [];
    const index = {};
    (state.registry.kinds || []).forEach((k) => {
      const name = k.group || '기타';
      if (index[name] == null) { index[name] = groups.length; groups.push({ name: name, kinds: [] }); }
      groups[index[name]].kinds.push(k);
    });
    const q = state.search.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        name: g.name,
        kinds: g.kinds.filter((k) => (
          String(k.label_ko || '').toLowerCase().indexOf(q) !== -1
          || String(k.kind).toLowerCase().indexOf(q) !== -1
        )),
      }))
      .filter((g) => g.kinds.length);
  }

  function renderPalette(asDrawer) {
    const wrap = el('div', `backtest-vis-palette${asDrawer ? ' is-drawer' : ''}`);
    attr(wrap, 'role', asDrawer ? 'dialog' : 'group');
    attr(wrap, 'aria-label', PALETTE_TITLE);

    const head = el('div', 'backtest-vis-palette-head');
    const headBody = el('div', 'backtest-vis-palette-head-body');
    headBody.appendChild(el('div', 'backtest-vis-palette-title', PALETTE_TITLE));
    headBody.appendChild(el('div', 'backtest-vis-palette-sub', PALETTE_SUB));
    head.appendChild(headBody);
    if (asDrawer) head.appendChild(button('backtest-vis-drawer-close', DRAWER_CLOSE, closeDrawers));
    wrap.appendChild(head);

    const search = el('input', 'backtest-vis-search');
    search.type = 'search';
    search.placeholder = PALETTE_SEARCH;
    search.value = state.search;
    attr(search, 'aria-label', PALETTE_SEARCH);
    search.addEventListener('input', () => { state.search = search.value; render(); focusEl(refs.search); });
    wrap.appendChild(search);
    refs.search = search;

    // 묶음 목록은 자기 상자 안에서만 흐른다 — 종류가 늘어도 팔레트 열이 캔버스보다
    // 길어지면 안 된다(그러면 캔버스가 그만큼 늘어나 화면 밖으로 나간다). 바깥 상자는
    // 자리만 잡고, 안쪽 상자가 그 자리를 채우며 스스로 스크롤한다 — 안쪽이 절대 위치라
    // 목록 길이가 열 높이 계산에 끼지 않는 것이 이 두 겹의 이유다(shell.css 짝 규칙).
    const scroll = el('div', 'backtest-vis-palette-scroll');
    const scrollBody = el('div', 'backtest-vis-palette-scroll-body');
    scroll.appendChild(scrollBody);
    wrap.appendChild(scroll);

    const groups = paletteGroups();
    if (!groups.length) {
      scrollBody.appendChild(el('div', 'backtest-vis-palette-empty', PALETTE_EMPTY));
      return wrap;
    }
    groups.forEach((group) => {
      const box = el('div', 'backtest-vis-palette-group');
      box.appendChild(el('div', 'backtest-vis-palette-group-title', group.name));
      group.kinds.forEach((k) => {
        const item = button('backtest-vis-palette-item', null, () => {
          addNode(k.kind);
          if (state.narrow) closeDrawers();
        });
        attr(item, 'data-kind', k.kind);
        const glyph = el('span', `backtest-vis-palette-glyph is-${groupTone(group.name)}`, GROUP_GLYPH[group.name] || '•');
        item.appendChild(glyph);
        item.appendChild(el('span', 'backtest-vis-palette-label', k.label_ko || k.kind));
        box.appendChild(item);
      });
      scrollBody.appendChild(box);
    });
    return wrap;
  }

  function groupTone(name) {
    if (name === '데이터') return 'info';
    if (name === '지표') return 'navy';
    if (name === '조건') return 'brand';
    if (name === '출력') return 'out';
    return 'info';
  }

  // ---------- 캔버스 ----------

  function statusPill(ctx) {
    const st = state.validation.state || 'unvalidated';
    if (st === 'invalid') return { text: `${ctx.errors.length}개 확인 필요`, tone: 'warn' };
    if (st === 'synced') return { text: PILL_SYNCED, tone: 'ok' };
    if (st === 'valid') return { text: PILL_VALID, tone: 'ok' };
    return { text: PILL_UNVALIDATED, tone: 'idle' };
  }

  function watermark(ctx) {
    if ((state.validation.state === 'invalid') && ctx.first && ctx.first.node_id) {
      const branch = ctx.branch[ctx.first.node_id];
      const tail = branch === 'entry' ? '진입 신호' : (branch === 'exit' ? '청산 신호' : '실행 전 검증');
      return `연결 오류 · ${tail}`;
    }
    return '진입 · 청산 신호 경로';
  }

  function renderCanvasColumn(ctx) {
    const col = el('div', 'backtest-vis-canvas');
    refs.canvas = col;
    const head = el('div', 'backtest-vis-canvas-head');

    const left = el('div', 'backtest-vis-canvas-head-left');
    left.appendChild(el('div', 'backtest-vis-canvas-title', CANVAS_TITLE));
    const pill = statusPill(ctx);
    const pillEl = el('div', `backtest-vis-status is-${pill.tone}`, pill.text);
    attr(pillEl, 'role', 'status');
    left.appendChild(pillEl);
    head.appendChild(left);

    const right = el('div', 'backtest-vis-canvas-head-right');
    if (state.narrow) {
      const pBtn = button('backtest-vis-drawer-toggle is-palette', DRAWER_PALETTE, () => {
        state.paletteOpen = !state.paletteOpen;
        state.inspectorOpen = false;
        render();
        if (!state.paletteOpen) focusNode(state.selectedId);
      });
      attr(pBtn, 'aria-expanded', state.paletteOpen ? 'true' : 'false');
      if (!state.readOnly) right.appendChild(pBtn);
      const iBtn = button('backtest-vis-drawer-toggle is-inspector', DRAWER_INSPECTOR, () => {
        state.inspectorOpen = !state.inspectorOpen;
        state.paletteOpen = false;
        render();
        if (!state.inspectorOpen) focusNode(state.selectedId);
      });
      attr(iBtn, 'aria-expanded', state.inspectorOpen ? 'true' : 'false');
      right.appendChild(iBtn);
    }
    if (!state.readOnly) {
      const undoBtn = button('backtest-vis-undo', UNDO_LABEL, undo);
      attr(undoBtn, 'aria-label', '되돌리기');
      undoBtn.disabled = !state.past.length;
      const redoBtn = button('backtest-vis-redo', REDO_LABEL, redo);
      attr(redoBtn, 'aria-label', '다시 하기');
      redoBtn.disabled = !state.future.length;
      right.appendChild(undoBtn);
      right.appendChild(redoBtn);
      right.appendChild(button('backtest-vis-fit', FIT_LABEL, () => { relayout(); }));
    }
    head.appendChild(right);
    col.appendChild(head);

    col.appendChild(state.view === 'list' ? renderList(ctx) : renderSurface(ctx));
    return col;
  }

  // "맞춤" — 좌표를 버리고 그룹 열로 다시 세운다. 되돌릴 수 있어야 하므로 이력을 남긴다.
  function relayout() {
    if (!guardEditable()) return;
    state.coalesceKey = null;
    pushHistory();
    const used = {};
    (state.graph.nodes || []).forEach((n) => {
      const s = kindSpec(n.kind);
      const col = GROUP_COLUMN[s && s.group] != null ? GROUP_COLUMN[s.group] : 1;
      const row = used[col] == null ? 0 : used[col] + 1;
      used[col] = row;
      n.ui = n.ui || {};
      n.ui.x = 16 + col * COLUMN_PITCH;
      n.ui.y = 20 + row * 104;
    });
    render();
    emitChange('layout');
  }

  function surfaceSize(ctx) {
    let w = SURFACE_MIN_W;
    let h = SURFACE_MIN_H;
    ctx.nodes.forEach((n) => {
      const b = ctx.boxes[n.id];
      w = Math.max(w, b.x + b.w + 24);
      h = Math.max(h, b.y + b.h + 24);
    });
    return { w: w, h: h };
  }

  function renderSurface(ctx) {
    const size = surfaceSize(ctx);
    const surface = el('div', 'backtest-vis-surface');
    attr(surface, 'role', 'group');
    attr(surface, 'aria-label', CANVAS_TITLE);
    surface.appendChild(el('div', 'backtest-vis-watermark', watermark(ctx)));

    const svg = svgEl('svg', {
      class: 'backtest-vis-edges',
      viewBox: `0 0 ${size.w} ${size.h}`,
      width: size.w,
      height: size.h,
      'aria-hidden': 'true',
    });
    ctx.edges.forEach((e) => svg.appendChild(renderEdge(ctx, e)));
    surface.appendChild(svg);

    ctx.nodes.forEach((n) => surface.appendChild(renderNode(ctx, n)));

    if (!state.readOnly) {
      surface.addEventListener('mousemove', (ev) => {
        if (!drag) return;
        moveNode(drag.id, (ev.clientX || 0) - drag.dx, (ev.clientY || 0) - drag.dy);
      });
      surface.addEventListener('mouseup', () => { drag = null; state.coalesceKey = null; });
      surface.addEventListener('mouseleave', () => { drag = null; state.coalesceKey = null; });
    }
    return surface;
  }

  function edgeTone(ctx, edge) {
    const dst = ctx.byId[edge.to && edge.to.node_id];
    if (dst && dst.kind === 'output.entry') return 'entry';
    if (dst && dst.kind === 'output.exit') return 'exit';
    const srcSpec = ctx.spec[edge.from && edge.from.node_id];
    const port = findPort(srcSpec, 'out', edge.from && edge.from.port);
    if (port && String(port.type).indexOf('Bool') !== -1) return 'bool';
    const src = ctx.byId[edge.from && edge.from.node_id];
    if (src && String(src.kind).indexOf('data.') === 0) return 'data';
    return 'value';
  }

  function edgeDiagnostic(ctx, edge) {
    const list = ctx.diagByNode[edge.to && edge.to.node_id] || [];
    return list.filter((d) => !d.port || d.port === (edge.to && edge.to.port))[0] || null;
  }

  function renderEdge(ctx, edge) {
    const a = portPoint(ctx, edge.from && edge.from.node_id, edge.from && edge.from.port, 'out');
    const b = portPoint(ctx, edge.to && edge.to.node_id, edge.to && edge.to.port, 'in');
    const dstSpec = ctx.spec[edge.to && edge.to.node_id];
    const idx = portsOf(dstSpec, 'in').map((p) => p.port).indexOf(edge.to && edge.to.port);
    const diag = edgeDiagnostic(ctx, edge);
    const classes = ['backtest-vis-edge', `is-${edgeTone(ctx, edge)}`];
    if (idx > 0) classes.push('is-secondary');
    if (diag) classes.push('is-diag');
    const path = svgEl('path', {
      class: classes.join(' '),
      d: a && b ? edgePath(a.x, a.y, b.x, b.y) : '',
      fill: 'none',
    });
    attr(path, 'data-edge-id', edge.id);
    if (diag) attr(path, 'data-diag-code', diag.code);
    return path;
  }

  function nodeTone(ctx, node) {
    const spec = ctx.spec[node.id];
    const group = spec && spec.group;
    if (group === '데이터') return 'info';
    if (group === '지표') return 'navy';
    if (group === '출력' || group === '조건') {
      const branch = node.kind === 'output.exit' ? 'exit' : (node.kind === 'output.entry' ? 'entry' : ctx.branch[node.id]);
      if (branch === 'exit') return 'exit';
      if (branch === 'entry') return 'entry';
    }
    return 'value';
  }

  // 카드 두 번째 줄. 보드 11의 "close → ma_fast / Series<Number>"가 여기서 나온다.
  function nodeLines(ctx, node) {
    const spec = ctx.spec[node.id];
    const lines = [];
    if (node.kind === 'data.ohlcv') {
      const s = ctx.graph.scenario || {};
      if (s.symbol || s.period) lines.push([s.symbol, s.period].filter(Boolean).join(' · '));
      // 기간(2024-01-01 → 2026-01-01)은 카드 폭에 절대 안 들어가고 시나리오 줄에 이미 있다.
      // 카드가 말할 것은 '여기서 무엇이 나오는가'다.
      lines.push(`${portsOf(spec, 'out').length}개 출력`);
      return lines;
    }
    if (node.kind === 'param') {
      lines.push(`${(node.params && node.params.name) || '이름 없음'} = ${(node.params && node.params.default) != null ? node.params.default : '—'}`);
    } else if (String(node.kind).indexOf('condition.') === 0) {
      const sides = conditionSides(node, ctx);
      const glyph = CONDITION_GLYPHS[node.kind] || '?';
      lines.push(`${sides.left || '—'} ${glyph} ${sides.right || '—'}`);
    } else if (String(node.kind).indexOf('indicator.') === 0) {
      const src = incomingLabel(ctx, node.id, 'source');
      lines.push(`${src || '—'} → ${shortName(node)}`);
    }
    const out = portsOf(spec, 'out')[0];
    if (out && out.type) lines.push(String(out.type));
    return lines;
  }

  function incomingLabel(ctx, nodeId, port) {
    const edge = ctx.edges.filter((e) => e.to && e.to.node_id === nodeId && e.to.port === port)[0];
    if (!edge) return '';
    const src = ctx.byId[edge.from.node_id];
    if (!src) return '';
    const srcSpec = ctx.spec[src.id];
    if (portsOf(srcSpec, 'out').length > 1) return edge.from.port;
    return shortName(src);
  }

  function paramBadge(ctx, node) {
    const spec = ctx.spec[node.id];
    if (!spec) return '';
    const numeric = (spec.params || []).filter(isNumericParam)[0];
    if (!numeric) return '';
    const value = node.params && node.params[numeric.name];
    return value == null ? '' : String(value);
  }

  function renderNode(ctx, node) {
    const box = ctx.boxes[node.id];
    const spec = ctx.spec[node.id];
    const diags = ctx.diagByNode[node.id] || [];
    const diag = firstError(diags);
    const classes = ['backtest-vis-node', `is-${nodeTone(ctx, node)}`];
    if (state.selectedId === node.id) classes.push('is-selected');
    if (node.kind === 'output.entry' || node.kind === 'output.exit') classes.push('is-output');
    if (diag) classes.push(severityOf(diag) === 'error' ? 'is-error' : 'is-warning');
    else if (state.validation.state === 'synced') classes.push('is-synced');

    const card = button(classes.join(' '), null, () => {
      select(node.id);
      if (state.narrow) state.inspectorOpen = true;
      render();
      focusEl(refs.nodes[node.id]);
    });
    attr(card, 'data-node-id', node.id);
    attr(card, 'data-kind', node.kind);
    attr(card, 'aria-pressed', state.selectedId === node.id ? 'true' : 'false');
    attr(card, 'style', `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px`);
    if (diag) attr(card, 'data-diag-code', diag.code);
    card.addEventListener('dblclick', () => { if (opts.onOpenCode) opts.onOpenCode(node.id); });
    if (!state.readOnly) {
      card.addEventListener('mousedown', (ev) => {
        drag = { id: node.id, dx: (ev.clientX || 0) - box.x, dy: (ev.clientY || 0) - box.y };
      });
    }

    const head = el('div', 'backtest-vis-node-head');
    head.appendChild(el('span', 'backtest-vis-node-title', node.label || (spec && spec.label_ko) || node.kind));
    const badge = paramBadge(ctx, node);
    if (badge) head.appendChild(el('span', 'backtest-vis-node-param', badge));
    card.appendChild(head);

    const body = el('div', 'backtest-vis-node-lines');
    nodeLines(ctx, node).forEach((line) => {
      const span = el('span', 'backtest-vis-node-line', line);
      attr(span, 'title', line);
      body.appendChild(span);
    });
    // 오류 카드는 보드 12처럼 두 줄을 더 얹는다 — 어느 포트가 비었는지, 코드 몇 행인지.
    if (diag) {
      body.appendChild(el('span', 'backtest-vis-node-line is-diag', `${diag.port || diag.code} 없음`));
      const line = diag.source_span && diag.source_span.start && diag.source_span.start.line;
      if (line != null) body.appendChild(el('span', 'backtest-vis-node-line is-diag', `코드 ${line}행`));
    }
    card.appendChild(body);

    portsOf(spec, 'in').forEach((p, i) => {
      card.appendChild(renderPort(ctx, node, p, 'in', i, portsOf(spec, 'in').length, box, diags));
    });
    portsOf(spec, 'out').forEach((p, i) => {
      card.appendChild(renderPort(ctx, node, p, 'out', i, portsOf(spec, 'out').length, box, diags));
    });
    refs.nodes[node.id] = card;
    return card;
  }

  function renderPort(ctx, node, port, dir, index, count, box, diags) {
    const diag = diags.filter((d) => d.port === port.port)[0] || null;
    const connected = ctx.edges.some((e) => (dir === 'in'
      ? (e.to && e.to.node_id === node.id && e.to.port === port.port)
      : (e.from && e.from.node_id === node.id && e.from.port === port.port)));
    const classes = ['backtest-vis-port', `is-${dir}`];
    if (!connected) classes.push('is-open');
    if (diag) classes.push('is-diag');
    if (state.pendingFrom && dir === 'out'
      && state.pendingFrom.node_id === node.id && state.pendingFrom.port === port.port) {
      classes.push('is-pending');
    }
    const dot = button(classes.join(' '), null, () => onPortClick(node, port, dir));
    attr(dot, 'data-node-id', node.id);
    attr(dot, 'data-port', port.port);
    attr(dot, 'data-dir', dir);
    attr(dot, 'aria-label', `${node.label || node.kind} · ${portFieldLabel(port)} · ${port.type || ''}`);
    attr(dot, 'style', `top:${portAnchor(box, count, index)}px`);
    if (diag) attr(dot, 'data-diag-code', diag.code);
    if (state.readOnly) dot.disabled = true;
    refs.ports[`${node.id}::${dir}::${port.port}`] = dot;
    return dot;
  }

  // 드래그 없이 연결하기: 출력 점을 누르면 "무엇을 잇는 중"이 되고, 입력 점을 누르면 붙는다.
  function onPortClick(node, port, dir) {
    if (state.readOnly) return;
    if (dir === 'out') {
      state.pendingFrom = { node_id: node.id, port: port.port };
      notice(`${node.label || node.kind} · ${port.port} 에서 시작 — 받을 입력을 고르세요`);
      render();
      return;
    }
    if (!state.pendingFrom) {
      // 연결된 입력을 누르면 끊는다 — 끊는 방법이 없으면 잘못 이은 줄이 영원히 남는다.
      if (!disconnectPort(node.id, port.port)) {
        notice('먼저 보낼 출력 포트를 고르세요');
      }
      return;
    }
    connect(state.pendingFrom, { node_id: node.id, port: port.port });
  }

  // 보드가 그린 포트는 보드의 이름표를 쓰고(보드 11 '입력 데이터', 보드 14 '오른쪽 입력'),
  // 보드에 없던 포트는 registry가 준 label_ko로 말한다. 화면이 없는 이름을 지어내지 않는다.
  function portFieldLabel(port) {
    const name = typeof port === 'string' ? port : (port && port.port);
    const given = typeof port === 'string' ? '' : (port && port.label_ko);
    return PORT_FIELD_LABELS[name] || given || PORT_LABELS[name] || name;
  }

  // ---------- 목록/폼 보기 ----------

  function renderList(ctx) {
    const wrap = el('div', 'backtest-vis-list');
    const head = el('div', 'backtest-vis-list-head');
    head.appendChild(el('div', 'backtest-vis-list-title', LIST_TITLE));
    head.appendChild(el('div', 'backtest-vis-list-sub', LIST_SUB));
    wrap.appendChild(head);

    if (!state.readOnly) {
      const add = el('select', 'backtest-vis-list-add');
      attr(add, 'aria-label', LIST_ADD);
      const first = el('option', null, LIST_ADD);
      first.value = '';
      add.appendChild(first);
      (state.registry.kinds || []).forEach((k) => {
        const o = el('option', null, `${k.group || ''} · ${k.label_ko || k.kind}`);
        o.value = k.kind;
        add.appendChild(o);
      });
      add.value = '';
      add.addEventListener('change', () => { if (add.value) addNode(add.value); });
      wrap.appendChild(add);
    }

    ctx.nodes.forEach((node) => wrap.appendChild(renderListRow(ctx, node)));
    if (!ctx.nodes.length) wrap.appendChild(el('div', 'backtest-vis-list-empty', '노드가 없습니다'));
    return wrap;
  }

  function renderListRow(ctx, node) {
    const spec = ctx.spec[node.id];
    const diag = firstError(ctx.diagByNode[node.id] || []);
    const row = el('div', `backtest-vis-list-row${diag ? ' is-error' : ''}${state.selectedId === node.id ? ' is-selected' : ''}`);
    attr(row, 'data-node-id', node.id);
    if (diag) attr(row, 'data-diag-code', diag.code);

    const head = el('div', 'backtest-vis-list-row-head');
    const pick = button('backtest-vis-list-pick', node.label || node.kind, () => select(node.id));
    attr(pick, 'data-node-id', node.id);
    head.appendChild(pick);
    head.appendChild(el('span', 'backtest-vis-list-kind', (spec && spec.label_ko) || node.kind));
    if (!state.readOnly) {
      head.appendChild(button('backtest-vis-list-remove', LIST_REMOVE, () => removeNode(node.id)));
    }
    row.appendChild(head);

    portsOf(spec, 'in').forEach((p) => row.appendChild(renderSourceField(ctx, node, p)));
    (spec && spec.params ? spec.params : []).forEach((p) => row.appendChild(renderParamField(ctx, node, p, true)));
    return row;
  }

  // ---------- 검사기 ----------

  function renderInspector(ctx, asDrawer) {
    const node = selectedNode();
    const diag = node ? firstError(ctx.diagByNode[node.id] || []) : null;
    const wrap = el('div', `backtest-vis-inspector${asDrawer ? ' is-drawer' : ''}${diag ? ' is-error' : ''}`);
    attr(wrap, 'role', asDrawer ? 'dialog' : 'group');
    attr(wrap, 'aria-label', INSPECT_EYEBROW);

    if (asDrawer) {
      const bar = el('div', 'backtest-vis-drawer-bar');
      bar.appendChild(button('backtest-vis-drawer-close', DRAWER_CLOSE, closeDrawers));
      wrap.appendChild(bar);
    }
    if (!node) {
      wrap.appendChild(el('div', 'backtest-vis-inspector-empty', INSPECT_EMPTY));
      return wrap;
    }

    const spec = ctx.spec[node.id];
    const head = el('div', 'backtest-vis-inspector-head');
    const headBody = el('div', 'backtest-vis-inspector-head-body');
    headBody.appendChild(el('div', 'backtest-vis-inspector-eyebrow', diag ? INSPECT_EYEBROW_ERROR : INSPECT_EYEBROW));
    headBody.appendChild(el('div', 'backtest-vis-inspector-title', node.label || node.kind));
    head.appendChild(headBody);
    head.appendChild(el('div', `backtest-vis-kind-pill${diag ? ' is-error' : ''}`, diag ? 'ERROR' : kindPillText(node, spec)));
    wrap.appendChild(head);

    if (diag) wrap.appendChild(renderInspectorError(ctx, node, diag));

    if (!state.readOnly) {
      const nameField = el('label', 'backtest-vis-field');
      nameField.appendChild(el('span', 'backtest-vis-field-label', INSPECT_LABEL_FIELD));
      const nameInput = el('input', 'backtest-vis-text');
      nameInput.type = 'text';
      nameInput.value = node.label || '';
      nameInput.addEventListener('change', () => renameNode(node.id, nameInput.value));
      nameField.appendChild(nameInput);
      wrap.appendChild(nameField);
    }

    portsOf(spec, 'in').forEach((p) => wrap.appendChild(renderSourceField(ctx, node, p)));
    (spec && spec.params ? spec.params : []).forEach((p) => wrap.appendChild(renderParamField(ctx, node, p, false)));

    wrap.appendChild(renderIoBlock(ctx, node, spec, diag));
    wrap.appendChild(renderWhatBlock(ctx, node, spec));

    if (diag) {
      wrap.appendChild(renderOpenCallout(node));
      const ask = el('div', 'backtest-vis-ask');
      ask.appendChild(button('backtest-vis-ask-chat', INSPECT_ASK_CHAT, () => {
        if (opts.onAskChat) opts.onAskChat(node.id);
      }));
      ask.appendChild(el('div', 'backtest-vis-ask-note', INSPECT_ASK_NOTE));
      wrap.appendChild(ask);
      wrap.appendChild(calloutRow('backtest-vis-blocked', INSPECT_BLOCKED));
    } else if (!state.readOnly) {
      wrap.appendChild(calloutRow('backtest-vis-draft', INSPECT_DRAFT));
    }
    return wrap;
  }

  function kindPillText(node, spec) {
    if (state.validation.state === 'synced') return '수정됨';
    const alias = node.params && node.params.alias;
    if (alias) return String(alias);
    const tail = String(node.kind).split('.').pop();
    return tail ? tail.toUpperCase() : node.kind;
  }

  function calloutRow(className, text) {
    const box = el('div', className);
    box.appendChild(el('span', 'backtest-vis-callout-dot', ''));
    box.appendChild(el('span', 'backtest-vis-callout-text', text));
    return box;
  }

  function renderInspectorError(ctx, node, diag) {
    const box = el('div', 'backtest-vis-inspector-error');
    attr(box, 'data-diag-code', diag.code);
    attr(box, 'role', 'alert');
    box.appendChild(el('div', 'backtest-vis-error-code', diag.code));
    box.appendChild(el('div', 'backtest-vis-error-message', diag.message_ko || ''));

    const where = el('div', 'backtest-vis-where');
    where.appendChild(el('div', 'backtest-vis-where-title', INSPECT_WHERE));
    const table = el('div', 'backtest-vis-where-table');
    if (diag.port) {
      const portSpec = findPort(ctx.spec[node.id], 'in', diag.port) || findPort(ctx.spec[node.id], 'out', diag.port);
      table.appendChild(whereRow(INSPECT_WHERE_PORT, `${diag.port}${portSpec && portSpec.type ? ` · ${portSpec.type}` : ''}`));
    }
    const code = sourceSpanText(diag);
    if (code) table.appendChild(whereRow(INSPECT_WHERE_CODE, code, 'is-code'));
    if (diag.json_path) table.appendChild(whereRow('경로', diag.json_path, 'is-code'));
    where.appendChild(table);
    box.appendChild(where);
    return box;
  }

  function whereRow(label, value, tone) {
    const row = el('div', 'backtest-vis-where-row');
    row.appendChild(el('span', 'backtest-vis-where-key', label));
    row.appendChild(el('span', `backtest-vis-where-value${tone ? ` ${tone}` : ''}`, value));
    return row;
  }

  function renderOpenCallout(node) {
    const box = el('div', 'backtest-vis-open');
    box.appendChild(el('div', 'backtest-vis-open-title', INSPECT_OPEN_TITLE));
    box.appendChild(el('div', 'backtest-vis-open-note', INSPECT_OPEN_NOTE));
    box.appendChild(button('backtest-vis-open-code', INSPECT_OPEN_CODE, () => {
      if (opts.onOpenCode) opts.onOpenCode(node.id);
    }));
    return box;
  }

  function renderIoBlock(ctx, node, spec, diag) {
    const box = el('div', 'backtest-vis-io');
    const ins = portsOf(spec, 'in');
    const outs = portsOf(spec, 'out');
    const required = ins.filter((p) => p.required);
    if (required.length > 1) {
      const connected = required.filter((p) => ctx.edges
        .some((e) => e.to && e.to.node_id === node.id && e.to.port === p.port)).length;
      const row = el('div', 'backtest-vis-io-row');
      row.appendChild(el('span', 'backtest-vis-io-key', INSPECT_LINKS));
      row.appendChild(el('span', 'backtest-vis-io-value', `${connected} / ${required.length}`));
      box.appendChild(row);
    }
    if (ins.length) box.appendChild(ioRow(INSPECT_IO.input, typeSummary(ins)));
    if (outs.length) box.appendChild(ioRow(INSPECT_IO.output, typeSummary(outs)));

    const statusRow = el('div', `backtest-vis-io-status${diag ? ' is-error' : ''}`);
    statusRow.appendChild(el('span', 'backtest-vis-io-dot', ''));
    statusRow.appendChild(el('span', 'backtest-vis-io-status-text', diag ? (diag.message_ko || diag.code) : INSPECT_OK));
    if (diag) attr(statusRow, 'data-diag-code', diag.code);
    box.appendChild(statusRow);
    return box;
  }

  function ioRow(key, value) {
    const row = el('div', 'backtest-vis-io-row');
    row.appendChild(el('span', 'backtest-vis-io-key', key));
    row.appendChild(el('span', 'backtest-vis-io-value', value));
    return row;
  }

  // 같은 타입이 여러 포트에 걸리면 "Series<Number> × 2"로 접는다(보드 14).
  function typeSummary(ports) {
    const counts = [];
    const index = {};
    ports.forEach((p) => {
      const t = p.type || '—';
      if (index[t] == null) { index[t] = counts.length; counts.push({ type: t, n: 0 }); }
      counts[index[t]].n += 1;
    });
    return counts.map((c) => (c.n > 1 ? `${c.type} × ${c.n}` : c.type)).join(' · ');
  }

  function renderWhatBlock(ctx, node, spec) {
    const box = el('div', 'backtest-vis-what');
    box.appendChild(el('div', 'backtest-vis-what-title', INSPECT_WHAT));
    box.appendChild(el('div', 'backtest-vis-what-body', explainNode(node, spec, ctx)));
    box.appendChild(button('backtest-vis-spec', INSPECT_SPEC, () => { if (opts.onShowSpec) opts.onShowSpec(); }));
    return box;
  }

  // ---------- 폼 조각 ----------

  function renderSourceField(ctx, node, port) {
    const field = el('label', 'backtest-vis-field');
    attr(field, 'data-port', port.port);
    const diag = (ctx.diagByNode[node.id] || []).filter((d) => d.port === port.port)[0] || null;
    const labelEl = el('span', `backtest-vis-field-label${diag ? ' is-error' : ''}`, portFieldLabel(port));
    if (diag) attr(labelEl, 'data-diag-code', diag.code);
    field.appendChild(labelEl);

    const select = el('select', 'backtest-vis-select');
    attr(select, 'aria-label', `${node.label || node.kind} · ${portFieldLabel(port)}`);
    attr(select, 'data-node-id', node.id);
    attr(select, 'data-port', port.port);
    const none = el('option', null, INSPECT_NO_LINK);
    none.value = '';
    select.appendChild(none);
    sourceOptions(ctx, node, port).forEach((o) => {
      const opt = el('option', null, o.label);
      opt.value = o.value;
      select.appendChild(opt);
    });
    const current = ctx.edges.filter((e) => e.to && e.to.node_id === node.id && e.to.port === port.port)[0];
    select.value = current ? `${current.from.node_id}::${current.from.port}` : '';
    if (state.readOnly) select.disabled = true;
    select.addEventListener('change', () => {
      const value = select.value;
      if (!value) { disconnectPort(node.id, port.port); return; }
      const parts = value.split('::');
      connect({ node_id: parts[0], port: parts[1] }, { node_id: node.id, port: port.port });
    });
    field.appendChild(select);
    return field;
  }

  // 고를 수 있는 출처만 낸다 — 타입이 안 맞거나 순환이 되는 후보를 보여주면 사용자는
  // 고르고 나서야 거절당한다.
  function sourceOptions(ctx, node, port) {
    const out = [];
    ctx.nodes.forEach((other) => {
      if (other.id === node.id) return;
      const spec = ctx.spec[other.id];
      const outs = portsOf(spec, 'out');
      outs.forEach((p) => {
        if (!typeAccepts(port.type, p.type)) return;
        if (reaches(ctx.edges, node.id, other.id)) return;
        out.push({
          value: `${other.id}::${p.port}`,
          label: outs.length > 1
            ? `${PORT_LABELS[p.port] || p.label_ko || p.port} ${p.port}`
            : `${other.label || other.kind}${paramBadge(ctx, other) ? ` ${paramBadge(ctx, other)}` : ''}`,
        });
      });
    });
    return out;
  }

  function paramRange(ctx, node, param) {
    let min = param.min;
    let max = param.max;
    let step = param.step;
    // 기간이 파라미터 노드에 물려 있으면 그 노드가 선언한 범위가 진짜다(보드 11의 최소 5·최대 60).
    const edge = ctx.edges.filter((e) => e.to && e.to.node_id === node.id && e.to.port === param.name)[0];
    if (edge) {
      const src = ctx.byId[edge.from.node_id];
      if (src && src.kind === 'param' && src.params) {
        if (src.params.min != null) min = src.params.min;
        if (src.params.max != null) max = src.params.max;
        if (src.params.step != null) step = src.params.step;
      }
    }
    return { min: min, max: max, step: step };
  }

  function renderParamField(ctx, node, param, compact) {
    const field = el('label', 'backtest-vis-field');
    attr(field, 'data-param', param.name);
    const value = node.params ? node.params[param.name] : undefined;
    const head = el('div', 'backtest-vis-field-head');
    head.appendChild(el('span', 'backtest-vis-field-label', PARAM_LABELS[param.name] || param.name));
    if (isNumericParam(param) && value != null) {
      head.appendChild(el('span', 'backtest-vis-field-value', String(value)));
    }
    field.appendChild(head);

    if (param.enum) {
      const select = el('select', 'backtest-vis-select');
      attr(select, 'data-node-id', node.id);
      attr(select, 'aria-label', PARAM_LABELS[param.name] || param.name);
      param.enum.forEach((v) => {
        const o = el('option', null, String(v));
        o.value = String(v);
        select.appendChild(o);
      });
      select.value = value == null ? String(param.enum[0]) : String(value);
      if (state.readOnly) select.disabled = true;
      select.addEventListener('change', () => setParam(node.id, param.name, select.value));
      field.appendChild(select);
      return field;
    }

    if (isNumericParam(param)) {
      const range = paramRange(ctx, node, param);
      if (!compact && range.min != null && range.max != null) {
        const slider = el('input', 'backtest-vis-slider');
        slider.type = 'range';
        attr(slider, 'min', range.min);
        attr(slider, 'max', range.max);
        attr(slider, 'step', range.step == null ? 1 : range.step);
        attr(slider, 'data-node-id', node.id);
        attr(slider, 'aria-label', PARAM_LABELS[param.name] || param.name);
        slider.value = value == null ? String(range.min) : String(value);
        if (state.readOnly) slider.disabled = true;
        slider.addEventListener('input', () => setParam(node.id, param.name, Number(slider.value)));
        field.appendChild(slider);
      }
      const num = el('input', 'backtest-vis-number');
      num.type = 'number';
      if (range.min != null) attr(num, 'min', range.min);
      if (range.max != null) attr(num, 'max', range.max);
      if (range.step != null) attr(num, 'step', range.step);
      attr(num, 'data-node-id', node.id);
      attr(num, 'aria-label', PARAM_LABELS[param.name] || param.name);
      num.value = value == null ? '' : String(value);
      if (state.readOnly) num.disabled = true;
      num.addEventListener('change', () => setParam(node.id, param.name, Number(num.value)));
      field.appendChild(num);
      if (!compact && range.min != null && range.max != null) {
        const bounds = el('div', 'backtest-vis-bounds');
        bounds.appendChild(el('span', 'backtest-vis-bound', `${PARAM_MIN} ${range.min}`));
        bounds.appendChild(el('span', 'backtest-vis-bound', `${PARAM_MAX} ${range.max}`));
        field.appendChild(bounds);
      }
      return field;
    }

    const text = el('input', 'backtest-vis-text');
    text.type = 'text';
    attr(text, 'data-node-id', node.id);
    attr(text, 'aria-label', PARAM_LABELS[param.name] || param.name);
    text.value = value == null ? '' : String(value);
    if (state.readOnly) text.disabled = true;
    text.addEventListener('change', () => setParam(node.id, param.name, text.value));
    field.appendChild(text);
    return field;
  }

  // ---------- 요약 바 ----------

  function renderSummary(ctx) {
    const st = state.validation.state || 'unvalidated';
    const bar = el('div', `backtest-vis-summary is-${st}`);
    attr(bar, 'role', 'status');
    attr(bar, 'aria-live', 'polite');

    const left = el('div', 'backtest-vis-summary-left');
    const mark = el('div', 'backtest-vis-summary-mark');
    mark.appendChild(el('span', '', st === 'invalid' ? '!' : (st === 'unvalidated' ? '·' : '✓')));
    left.appendChild(mark);

    const body = el('div', 'backtest-vis-summary-body');
    let title = SUMMARY_VALID;
    if (st === 'invalid') title = `${ctx.errors.length}개 연결을 확인해야 합니다`;
    else if (st === 'synced') title = SUMMARY_SYNCED;
    else if (st === 'unvalidated') title = SUMMARY_UNVALIDATED;
    body.appendChild(el('div', 'backtest-vis-summary-title', title));

    let detail = state.validation.summary_ko || '';
    if (!detail) {
      if (st === 'invalid') {
        detail = `${(ctx.first && ctx.first.message_ko) || ''} · 실행 전 검증 실패`.replace(/^ · /, '');
      } else if (st === 'unvalidated') {
        detail = SUMMARY_UNVALIDATED_DETAIL;
      } else {
        detail = summaryDetail(ctx.nodes, ctx.edges);
      }
    }
    const detailEl = el('div', 'backtest-vis-summary-detail', detail);
    if (ctx.first) attr(detailEl, 'data-diag-code', ctx.first.code);
    body.appendChild(detailEl);

    // 좁은 폭에서는 서랍이 닫혀도 "지금 무엇이 선택돼 있고 무엇이 틀렸는지"가 남아야 한다.
    if (state.narrow) {
      const node = selectedNode();
      const parts = [];
      if (node) parts.push(`${SELECTION_PREFIX} ${node.label || node.kind}`);
      if (ctx.first) parts.push(`${ctx.first.code} · ${ctx.first.message_ko || ''}`);
      const line = el('div', 'backtest-vis-summary-selection', parts.join(' · '));
      if (ctx.first) attr(line, 'data-diag-code', ctx.first.code);
      if (node) attr(line, 'data-node-id', node.id);
      body.appendChild(line);
    }
    left.appendChild(body);
    bar.appendChild(left);

    const actions = el('div', 'backtest-vis-summary-actions');
    if (st === 'invalid') {
      actions.appendChild(button('backtest-vis-first-error', SUMMARY_FIRST_ERROR, () => {
        const target = ctx.first && ctx.first.node_id;
        if (!target) return;
        select(target);
        if (state.narrow) { state.inspectorOpen = true; render(); }
        focusEl(refs.nodes[target]);
      }));
    }
    if (st === 'unvalidated' && opts.onValidate) {
      actions.appendChild(button('backtest-vis-validate', SUMMARY_VALIDATE, () => opts.onValidate()));
    }
    actions.appendChild(button(
      'backtest-vis-view-toggle',
      state.view === 'list' ? SUMMARY_GRAPH : (st === 'invalid' ? SUMMARY_LIST_SHORT : SUMMARY_LIST),
      () => { state.view = state.view === 'list' ? 'graph' : 'list'; render(); },
    ));
    bar.appendChild(actions);
    if (ctx.first) attr(bar, 'data-diag-code', ctx.first.code);
    return bar;
  }

  function renderNotice() {
    const box = el('div', 'backtest-vis-notice', state.notice);
    attr(box, 'role', 'alert');
    return box;
  }

  // ---------- 렌더 ----------

  function rootClass() {
    const parts = ['backtest-vis'];
    if (state.narrow) parts.push('is-narrow');
    if (state.readOnly) parts.push('is-readonly');
    parts.push(`is-${state.validation.state || 'unvalidated'}`);
    if (state.view === 'list') parts.push('is-list');
    return parts.join(' ');
  }

  function render() {
    if (destroyed) return;
    clear(root);
    refs = { nodes: {}, ports: {}, search: null, canvas: null };
    root.className = rootClass();
    const ctx = buildContext();

    const body = el('div', 'backtest-vis-body');
    if (!state.narrow && !state.readOnly) body.appendChild(renderPalette(false));
    body.appendChild(renderCanvasColumn(ctx));
    if (!state.narrow) body.appendChild(renderInspector(ctx, false));
    root.appendChild(body);

    // 서랍은 캔버스 칼럼 안에 얹는다 — root에 얹으면 요약 바 높이(선택·진단 줄이 붙으면
    // 늘어난다)를 상수로 빼야 하고, 그 상수는 반드시 언젠가 틀린다.
    const host = refs.canvas || root;
    if (state.narrow && state.paletteOpen && !state.readOnly) host.appendChild(renderPalette(true));
    if (state.narrow && state.inspectorOpen) host.appendChild(renderInspector(ctx, true));
    if (state.notice) root.appendChild(renderNotice());
    root.appendChild(renderSummary(ctx));
  }

  render();

  return {
    element: root,
    setRegistry(registry) { state.registry = normalizeRegistry(registry); render(); },
    setGraph(graph) {
      state.graph = cloneGraph(graph);
      state.past.length = 0;
      state.future.length = 0;
      state.coalesceKey = null;
      if (state.selectedId && !nodeById(state.selectedId)) setSelected(null);
      render();
    },
    setDiagnostics(list) {
      state.diagnostics = (list || []).slice();
      render();
    },
    setValidation(validation) {
      state.validation = typeof validation === 'string'
        ? { state: validation, summary_ko: state.validation.summary_ko }
        : (validation || { state: 'unvalidated', summary_ko: '' });
      render();
    },
    setNarrow(narrow) {
      state.narrow = !!narrow;
      if (!state.narrow) { state.paletteOpen = false; state.inspectorOpen = false; }
      render();
    },
    setView(view) { state.view = view === 'list' ? 'list' : 'graph'; render(); },
    openDrawer(which) {
      state.paletteOpen = which === 'palette';
      state.inspectorOpen = which === 'inspector';
      render();
    },
    closeDrawers: closeDrawers,
    select: select,
    focusNode: focusNode,
    addNode: addNode,
    duplicateNode: duplicateNode,
    moveNode: moveNode,
    connect: connect,
    connectionError: connectionError,
    disconnect: disconnect,
    disconnectPort: disconnectPort,
    removeNode: removeNode,
    setParam: setParam,
    renameNode: renameNode,
    undo: undo,
    redo: redo,
    canUndo() { return state.past.length > 0; },
    canRedo() { return state.future.length > 0; },
    getGraph() { return cloneGraph(state.graph); },
    getSelected() { return state.selectedId; },
    getNotice() { return state.notice; },
    destroy() {
      destroyed = true;
      if (noticeTimer != null && untimer) untimer(noticeTimer);
      noticeTimer = null;
      clear(root);
      if (typeof container.removeChild === 'function') container.removeChild(root);
    },
  };
}

const __exports = {
  createVisualEditor,
  normalizeRegistry,
  isNumericParam,
  typeAccepts,
  portAnchor,
  edgePath,
  reaches,
  branchOf,
  warmupBars,
  summaryDetail,
  explainNode,
  freshId,
  PORT_FIELD_LABELS,
  PORT_LABELS,
  PARAM_LABELS,
  GROUP_COLUMN,
};

// UMD 각주(2026-08-18 렌더러 격리) — backtest-explain.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BacktestVisualEditor = __exports;
}

})();
