'use strict';

// backtest-visual-editor.js 단위 테스트 — jsdom 없이 최소 DOM 스텁으로 검증한다
// (backtest-canvas.test.js가 세운 관례). 그 스텁에 없던 셋을 여기서만 더한다:
//   ① createElementNS — 엣지가 SVG라서 필요하다
//   ② focus()/tagName — "서랍을 닫으면 초점이 노드로 돌아온다"는 접근성 계약을 코드로
//      판정하려면 초점을 기록해야 한다
//   ③ 동기 dispatch — 키보드 계약을 await 없이 단언하기 위해
// 전역 스텁을 고치지 않고 이 파일 안에서만 늘린다(다른 테스트의 기대를 흔들지 않는다).

const test = require('node:test');
const assert = require('node:assert/strict');

const editor = require('./backtest-visual-editor');
const { createVisualEditor } = editor;

// ── 고정 자료 ────────────────────────────────────────────────────────────────
// registry·graph·diagnostics는 US-002가 서버에서 내려줄 모양 그대로다. 화면이 자기
// 편한 모양으로 바꿔 읽기 시작하면 백엔드가 바뀔 때 조용히 어긋난다.

const SERIES_NUM = 'Series<Number>';
const SERIES_BOOL = 'Series<Bool>';

function condition(kind, labelKo) {
  return {
    kind: kind,
    label_ko: labelKo,
    group: '조건',
    inputs: [
      { port: 'left', type: SERIES_NUM, required: true },
      { port: 'right', type: `${SERIES_NUM}|Number`, required: true },
    ],
    outputs: [{ port: 'signal', type: SERIES_BOOL }],
    params: [{ name: 'compare_to', type: 'number', optional: true }],
  };
}

const REGISTRY = {
  kinds: [
    {
      kind: 'data.ohlcv',
      label_ko: '가격 데이터',
      group: '데이터',
      inputs: [],
      outputs: [
        { port: 'open', type: SERIES_NUM },
        { port: 'high', type: SERIES_NUM },
        { port: 'low', type: SERIES_NUM },
        { port: 'close', type: SERIES_NUM },
        { port: 'volume', type: SERIES_NUM },
        { port: 'ohlcv', type: 'OHLCV' },
      ],
      params: [],
    },
    {
      kind: 'param',
      label_ko: '파라미터',
      group: '데이터',
      inputs: [],
      outputs: [{ port: 'value', type: 'Number' }],
      params: [
        { name: 'name', type: 'str' },
        { name: 'default', type: 'number' },
        { name: 'min' },
        { name: 'max' },
        { name: 'step' },
        { name: 'type', enum: ['int', 'float'] },
      ],
    },
    {
      kind: 'indicator.sma',
      label_ko: '이동평균 SMA',
      group: '지표',
      inputs: [
        { port: 'source', type: SERIES_NUM, required: true },
        { port: 'period', type: 'Number', required: false },
      ],
      outputs: [{ port: 'value', type: SERIES_NUM }],
      params: [
        { name: 'alias', type: 'str' },
        { name: 'period', type: 'number', default: 20, min: 1, max: 500 },
      ],
    },
    condition('condition.cross_above', '상향 돌파'),
    condition('condition.cross_below', '하향 돌파'),
    {
      kind: 'logic.and',
      label_ko: 'AND',
      group: '조건',
      inputs: [
        { port: 'in1', type: SERIES_BOOL },
        { port: 'in2', type: SERIES_BOOL },
        { port: 'in3', type: SERIES_BOOL },
        { port: 'in4', type: SERIES_BOOL },
      ],
      outputs: [{ port: 'signal', type: SERIES_BOOL }],
      params: [],
    },
    {
      kind: 'output.entry',
      label_ko: '진입 신호',
      group: '출력',
      inputs: [{ port: 'signal', type: SERIES_BOOL, required: true }],
      outputs: [],
      params: [],
    },
    {
      kind: 'output.exit',
      label_ko: '청산 신호',
      group: '출력',
      inputs: [{ port: 'signal', type: SERIES_BOOL, required: true }],
      outputs: [],
      params: [],
    },
  ],
};

// 보드 11의 그래프 그대로 — 7개 노드 · 8개 연결 · 진입 1 · 청산 1 · 워밍업 59봉.
function goldenCross() {
  return {
    graph_version: '1',
    nodes: [
      { id: 'n_data', kind: 'data.ohlcv', label: '가격 데이터', params: {}, ui: { x: 16, y: 218 } },
      { id: 'n_fast', kind: 'indicator.sma', label: '빠른 SMA', params: { alias: 'ma_fast', period: 20 }, ui: { x: 125, y: 100 } },
      { id: 'n_slow', kind: 'indicator.sma', label: '느린 SMA', params: { alias: 'ma_slow', period: 60 }, ui: { x: 125, y: 315 } },
      { id: 'n_above', kind: 'condition.cross_above', label: '상향 돌파', params: {}, ui: { x: 245, y: 100 } },
      { id: 'n_below', kind: 'condition.cross_below', label: '하향 돌파', params: {}, ui: { x: 245, y: 315 } },
      { id: 'n_entry', kind: 'output.entry', label: '진입', params: {}, ui: { x: 360, y: 115 } },
      { id: 'n_exit', kind: 'output.exit', label: '청산', params: {}, ui: { x: 360, y: 330 } },
    ],
    edges: [
      edge('e1', 'n_data', 'close', 'n_fast', 'source'),
      edge('e2', 'n_data', 'close', 'n_slow', 'source'),
      edge('e3', 'n_fast', 'value', 'n_above', 'left'),
      edge('e4', 'n_slow', 'value', 'n_above', 'right'),
      edge('e5', 'n_fast', 'value', 'n_below', 'left'),
      edge('e6', 'n_slow', 'value', 'n_below', 'right'),
      edge('e7', 'n_above', 'signal', 'n_entry', 'signal'),
      edge('e8', 'n_below', 'signal', 'n_exit', 'signal'),
    ],
    scenario: {
      symbol: '삼성전자', period: '1d', adjusted: true, from: '2024-01-01', to: '2026-01-01', costs: {}, risk: {},
    },
  };
}

function edge(id, fromNode, fromPort, toNode, toPort) {
  return { id: id, from: { node_id: fromNode, port: fromPort }, to: { node_id: toNode, port: toPort } };
}

// 보드 12 — 하향 돌파의 오른쪽 입력이 비었다. 코드 하나가 네 곳에 떠야 한다.
const PORT_DIAGNOSTIC = {
  code: 'BTG-PORT-002',
  severity: 'error',
  node_id: 'n_below',
  port: 'right',
  json_path: '$.nodes[4].inputs.right',
  source_span: { file: 'golden_cross.py', start: { line: 17, column: 4 }, end: { line: 17, column: 40 } },
  message_ko: '느린 SMA 입력이 없습니다',
  suggested_fix: {
    kind: 'connect_port',
    from: { node_id: 'n_slow', port: 'value' },
    to: { node_id: 'n_below', port: 'right' },
  },
};

function brokenGraph() {
  const graph = goldenCross();
  graph.edges = graph.edges.filter((e) => e.id !== 'e6');
  return graph;
}

// ── DOM 스텁 ─────────────────────────────────────────────────────────────────

let focused = null;

function fakeNode(tag) {
  const node = {
    tag: tag,
    tagName: String(tag).toUpperCase(),
    className: '',
    textContent: '',
    type: '',
    placeholder: '',
    value: '',
    checked: false,
    hidden: false,
    disabled: false,
    readOnly: false,
    children: [],
    attrs: {},
    parentNode: null,
    _listeners: {},
    get firstChild() { return this.children[0] || null; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      child.parentNode = null;
      return child;
    },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === 'class') this.className = String(v);
    },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
    },
    focus() { focused = this; },
    addEventListener(type, handler) {
      (this._listeners[type] = this._listeners[type] || []).push(handler);
    },
    dispatchEvent(event) {
      (this._listeners[event && event.type] || []).forEach((h) => h(event));
      return true;
    },
  };
  return node;
}

test.beforeEach(() => {
  focused = null;
  global.document = {
    createElement: (tag) => fakeNode(tag),
    createElementNS: (ns, tag) => fakeNode(tag),
    createTextNode: (text) => ({ tag: '#text', textContent: text, children: [] }),
  };
});

test.afterEach(() => {
  delete global.document;
});

// ── 탐색 도우미 ──────────────────────────────────────────────────────────────

function walk(node, visit) {
  visit(node);
  (node.children || []).forEach((c) => walk(c, visit));
}

function byClass(root, cls) {
  const found = [];
  walk(root, (n) => {
    if (String(n.className || '').split(/\s+/).indexOf(cls) !== -1) found.push(n);
  });
  return found;
}

function byAttr(root, name, value) {
  const found = [];
  walk(root, (n) => {
    if (typeof n.getAttribute === 'function' && n.getAttribute(name) === value) found.push(n);
  });
  return found;
}

function textOf(node) {
  const parts = [];
  walk(node, (n) => {
    if (n.textContent && !(n.children || []).length) parts.push(n.textContent);
  });
  return parts.join(' ');
}

function fire(node, event) {
  node.dispatchEvent(event);
}

function click(node) {
  fire(node, { type: 'click' });
}

function key(root, keyName, extra) {
  const ev = Object.assign({ type: 'keydown', key: keyName, preventDefault() {} }, extra || {});
  fire(root, ev);
}

// 타이머를 주입하지 않으면 안내 문구의 예약이 남아 node --test가 늦게 끝난다.
function mount(overrides) {
  const container = fakeNode('div');
  const calls = { change: [], select: [], openCode: [], askChat: [], validate: 0, showSpec: 0 };
  const handle = createVisualEditor(container, Object.assign({
    registry: REGISTRY,
    graph: goldenCross(),
    diagnostics: [],
    validation: { state: 'valid', summary_ko: '' },
    setTimeoutImpl: () => 1,
    clearTimeoutImpl: () => {},
    onChange: (graph, meta) => calls.change.push({ graph: graph, meta: meta }),
    onSelect: (id) => calls.select.push(id),
    onOpenCode: (id) => calls.openCode.push(id),
    onAskChat: (id) => calls.askChat.push(id),
    onValidate: () => { calls.validate += 1; },
    onShowSpec: () => { calls.showSpec += 1; },
  }, overrides || {}));
  return { container: container, root: handle.element, handle: handle, calls: calls };
}

// ── 팔레트 ───────────────────────────────────────────────────────────────────

test('팔레트 그룹은 registry가 선언한 순서 그대로 선다 — 화면이 분류를 새로 만들지 않는다', () => {
  const { root } = mount();
  const groups = byClass(root, 'backtest-vis-palette-group-title').map((n) => n.textContent);
  assert.deepEqual(groups, ['데이터', '지표', '조건', '출력']);
  const kinds = byClass(root, 'backtest-vis-palette-item').map((n) => n.getAttribute('data-kind'));
  assert.ok(kinds.indexOf('indicator.sma') !== -1);
  assert.ok(kinds.indexOf('output.exit') !== -1);
});

test('노드 검색은 registry 라벨로 좁힌다', () => {
  const { root, handle } = mount();
  const search = byClass(root, 'backtest-vis-search')[0];
  search.value = '이동평균';
  fire(search, { type: 'input' });
  const kinds = byClass(handle.element, 'backtest-vis-palette-item').map((n) => n.getAttribute('data-kind'));
  assert.deepEqual(kinds, ['indicator.sma']);
});

// ── ID 계약 ──────────────────────────────────────────────────────────────────

test('팔레트로 노드를 더하면 새 ID가 한 번 발급된다', () => {
  const { root, handle, calls } = mount();
  const before = handle.getGraph().nodes.map((n) => n.id);
  const item = byClass(root, 'backtest-vis-palette-item')
    .filter((n) => n.getAttribute('data-kind') === 'indicator.sma')[0];
  click(item);

  const after = handle.getGraph().nodes;
  assert.equal(after.length, before.length + 1);
  const added = after[after.length - 1];
  assert.ok(added.id);
  assert.equal(before.indexOf(added.id), -1);
  assert.equal(added.kind, 'indicator.sma');
  assert.equal(added.params.period, 20, 'registry default가 그대로 들어온다');
  assert.equal(calls.change[calls.change.length - 1].meta.reason, 'add');
});

test('이름과 자리를 바꿔도 ID는 그대로다 — 진단이 다른 칸으로 옮겨가면 안 된다', () => {
  const { handle } = mount();
  handle.renameNode('n_fast', '20일 이동평균');
  handle.moveNode('n_fast', 300, 40);
  const node = handle.getGraph().nodes.filter((n) => n.id === 'n_fast')[0];
  assert.equal(node.id, 'n_fast');
  assert.equal(node.label, '20일 이동평균');
  assert.deepEqual({ x: node.ui.x, y: node.ui.y }, { x: 300, y: 40 });
});

test('복제는 값은 같고 ID만 새로 받는다', () => {
  const { handle } = mount();
  const copyId = handle.duplicateNode('n_fast');
  assert.notEqual(copyId, 'n_fast');
  const copy = handle.getGraph().nodes.filter((n) => n.id === copyId)[0];
  assert.equal(copy.kind, 'indicator.sma');
  assert.equal(copy.params.period, 20);
  assert.equal(handle.getGraph().nodes.filter((n) => n.id === 'n_fast').length, 1);
});

test('이동은 이력 한 줌으로 접힌다 — 픽셀마다 쌓으면 Ctrl+Z가 아무것도 못 되돌린다', () => {
  const { handle } = mount();
  handle.moveNode('n_fast', 200, 60);
  handle.moveNode('n_fast', 210, 62);
  handle.moveNode('n_fast', 220, 64);
  handle.undo();
  const node = handle.getGraph().nodes.filter((n) => n.id === 'n_fast')[0];
  assert.deepEqual({ x: node.ui.x, y: node.ui.y }, { x: 125, y: 100 });
});

// ── 타입 검사 ────────────────────────────────────────────────────────────────

test('Series<Number>는 조건의 left에 붙는다', () => {
  const { handle } = mount({ graph: brokenGraph() });
  assert.equal(handle.connectionError(
    { node_id: 'n_slow', port: 'value' },
    { node_id: 'n_below', port: 'right' },
  ), null);
  const edgeId = handle.connect(
    { node_id: 'n_slow', port: 'value' },
    { node_id: 'n_below', port: 'right' },
  );
  assert.ok(edgeId);
  assert.equal(handle.getGraph().edges.length, 8);
});

test('Series<Bool>은 left 자리에 못 붙고, 이유가 한국어로 남는다', () => {
  const { handle } = mount();
  const why = handle.connectionError(
    { node_id: 'n_above', port: 'signal' },
    { node_id: 'n_below', port: 'left' },
  );
  assert.match(why, /타입이 맞지 않습니다/);
  assert.match(why, /Series<Bool>/);
  assert.match(why, /Series<Number>/);

  const before = handle.getGraph().edges.length;
  assert.equal(handle.connect(
    { node_id: 'n_above', port: 'signal' },
    { node_id: 'n_below', port: 'left' },
  ), null);
  assert.equal(handle.getGraph().edges.length, before, '거절된 연결은 그래프를 건드리지 않는다');
  assert.equal(handle.getNotice(), why, '거절 이유가 화면에 남는다');
});

test('right는 Series<Number>|Number 합집합이라 Number도 받는다', () => {
  assert.equal(editor.typeAccepts('Series<Number>|Number', 'Number'), true);
  assert.equal(editor.typeAccepts('Series<Number>|Number', 'Series<Number>'), true);
  assert.equal(editor.typeAccepts('Series<Number>', 'Series<Bool>'), false);
});

test('순환과 자기 연결은 붙기 전에 막는다', () => {
  const { handle } = mount();
  assert.match(handle.connectionError(
    { node_id: 'n_fast', port: 'value' },
    { node_id: 'n_fast', port: 'source' },
  ), /자기 자신/);
  assert.match(handle.connectionError(
    { node_id: 'n_above', port: 'signal' },
    { node_id: 'n_fast', port: 'source' },
  ) || '', /순환|타입/);
});

// ── 진단 네 곳 ───────────────────────────────────────────────────────────────

test('진단 하나가 노드·포트·검사기·요약 바에 같은 code로 뜬다', () => {
  const { handle } = mount({
    graph: brokenGraph(),
    diagnostics: [PORT_DIAGNOSTIC],
    validation: { state: 'invalid', summary_ko: '하향 돌파 입력 누락 · 실행 전 검증 실패' },
  });
  handle.select('n_below');
  const root = handle.element;

  const marked = byAttr(root, 'data-diag-code', 'BTG-PORT-002');
  assert.ok(marked.length >= 4, `네 곳 이상에 코드가 붙어야 한다 (실제 ${marked.length})`);

  const node = byClass(root, 'backtest-vis-node')
    .filter((n) => n.getAttribute('data-node-id') === 'n_below')[0];
  assert.equal(node.getAttribute('data-diag-code'), 'BTG-PORT-002', '① 노드 고리');
  assert.ok(String(node.className).indexOf('is-error') !== -1);

  const port = byClass(root, 'backtest-vis-port')
    .filter((n) => n.getAttribute('data-node-id') === 'n_below' && n.getAttribute('data-port') === 'right')[0];
  assert.equal(port.getAttribute('data-diag-code'), 'BTG-PORT-002', '② 포트 강조');

  const inspector = byClass(root, 'backtest-vis-inspector-error')[0];
  assert.equal(inspector.getAttribute('data-diag-code'), 'BTG-PORT-002', '③ 검사기 상세');
  assert.match(textOf(inspector), /느린 SMA 입력이 없습니다/);
  assert.match(textOf(inspector), /right · Series<Number>\|Number/);
  assert.match(textOf(inspector), /golden_cross\.py:17/);

  const summary = byClass(root, 'backtest-vis-summary')[0];
  assert.equal(summary.getAttribute('data-diag-code'), 'BTG-PORT-002', '④ 요약 바');
});

test('연결된 포트의 진단은 엣지에도 번진다', () => {
  const { handle } = mount({
    diagnostics: [Object.assign({}, PORT_DIAGNOSTIC, { port: 'left' })],
    validation: { state: 'invalid', summary_ko: '' },
  });
  const edges = byClass(handle.element, 'backtest-vis-edge')
    .filter((n) => n.getAttribute('data-diag-code') === 'BTG-PORT-002');
  assert.equal(edges.length, 1);
  assert.equal(edges[0].getAttribute('data-edge-id'), 'e5');
});

// ── 요약 바 문구 ─────────────────────────────────────────────────────────────

test('정상 요약은 보드 11 문구 그대로다', () => {
  const { root } = mount();
  assert.equal(byClass(root, 'backtest-vis-summary-title')[0].textContent, 'StrategySpec으로 변환할 수 있습니다');
  assert.equal(
    byClass(root, 'backtest-vis-summary-detail')[0].textContent,
    '7개 노드 · 8개 연결 · 진입 1 · 청산 1 · 워밍업 59봉',
  );
  assert.equal(byClass(root, 'backtest-vis-view-toggle')[0].textContent, '목록으로 보기');
  assert.equal(byClass(root, 'backtest-vis-status')[0].textContent, '연결 정상');
});

test('오류 요약은 보드 12 문구 그대로다 — 제목·부제·버튼 둘', () => {
  const { root } = mount({
    graph: brokenGraph(),
    diagnostics: [PORT_DIAGNOSTIC],
    validation: { state: 'invalid', summary_ko: '하향 돌파 입력 누락 · 실행 전 검증 실패' },
  });
  assert.equal(byClass(root, 'backtest-vis-summary-title')[0].textContent, '1개 연결을 확인해야 합니다');
  assert.equal(
    byClass(root, 'backtest-vis-summary-detail')[0].textContent,
    '하향 돌파 입력 누락 · 실행 전 검증 실패',
  );
  assert.equal(byClass(root, 'backtest-vis-first-error')[0].textContent, '첫 오류로');
  assert.equal(byClass(root, 'backtest-vis-view-toggle')[0].textContent, '목록 보기');
  assert.equal(byClass(root, 'backtest-vis-status')[0].textContent, '1개 확인 필요');
  assert.equal(byClass(root, 'backtest-vis-watermark')[0].textContent, '연결 오류 · 청산 신호');
});

test('동기화 요약은 보드 14 문구로 바뀐다', () => {
  const { root, handle } = mount();
  handle.setValidation({ state: 'synced', summary_ko: '그래프와 코드의 의미 일치 · 연결 7/7 · 컴파일러 v1 · 실행 전' });
  assert.equal(byClass(handle.element, 'backtest-vis-summary-title')[0].textContent, '그래프와 코드가 같은 버전입니다');
  assert.equal(byClass(handle.element, 'backtest-vis-status')[0].textContent, '동기화');
  assert.ok(byClass(handle.element, 'backtest-vis-node').every((n) => String(n.className).indexOf('is-synced') !== -1));
  assert.ok(root === handle.element);
});

test('첫 오류로 버튼은 그 노드를 골라 초점까지 옮긴다', () => {
  const { root, handle, calls } = mount({
    graph: brokenGraph(),
    diagnostics: [PORT_DIAGNOSTIC],
    validation: { state: 'invalid', summary_ko: '' },
  });
  click(byClass(root, 'backtest-vis-first-error')[0]);
  assert.equal(handle.getSelected(), 'n_below');
  assert.deepEqual(calls.select, ['n_below']);
  assert.equal(focused.getAttribute('data-node-id'), 'n_below');
});

// ── 검사기 ───────────────────────────────────────────────────────────────────

test('검사기는 보드 11의 칸을 낸다 — 입력 데이터 select·기간 슬라이더·입출력 타입·설명', () => {
  const { handle } = mount();
  handle.select('n_fast');
  const root = handle.element;
  const inspector = byClass(root, 'backtest-vis-inspector')[0];

  const labels = byClass(inspector, 'backtest-vis-field-label').map((n) => n.textContent);
  assert.ok(labels.indexOf('입력 데이터') !== -1);
  assert.ok(labels.indexOf('기간') !== -1);

  const sourceSelect = byClass(inspector, 'backtest-vis-select')
    .filter((n) => n.getAttribute('data-port') === 'source')[0];
  assert.equal(sourceSelect.value, 'n_data::close');
  const options = sourceSelect.children.map((o) => o.textContent);
  assert.ok(options.indexOf('종가 close') !== -1, '봉 축은 사람 말로 읽힌다');
  assert.equal(options.indexOf('상향 돌파'), -1, 'Series<Bool>은 후보에 없다');

  assert.equal(byClass(inspector, 'backtest-vis-slider')[0].value, '20');
  assert.match(textOf(inspector), /최소 1/);
  assert.match(textOf(inspector), /최대 500/);
  assert.match(textOf(inspector), /연결과 값이 유효합니다/);
  assert.match(textOf(inspector), /이 노드는 무엇을 하나요\?/);
  assert.match(textOf(inspector), /최근 20개 종가의 평균/);
  assert.match(textOf(inspector), /첫 19개 봉은 워밍업 구간/);
  assert.match(textOf(inspector), /생성될 StrategySpec 보기/);
});

test('검사기 select로 연결을 바꾸면 드래그 없이 그래프가 고쳐진다', () => {
  const { handle } = mount({ graph: brokenGraph(), diagnostics: [PORT_DIAGNOSTIC] });
  handle.select('n_below');
  const select = byClass(handle.element, 'backtest-vis-select')
    .filter((n) => n.getAttribute('data-node-id') === 'n_below' && n.getAttribute('data-port') === 'right')[0];
  select.value = 'n_slow::value';
  fire(select, { type: 'change' });
  const added = handle.getGraph().edges
    .filter((e) => e.to.node_id === 'n_below' && e.to.port === 'right');
  assert.equal(added.length, 1);
  assert.equal(added[0].from.node_id, 'n_slow');
});

test('오류 검사기는 문제 위치와 두 버튼, 그리고 AI 규율 한 줄을 낸다', () => {
  const { handle, calls } = mount({
    graph: brokenGraph(),
    diagnostics: [PORT_DIAGNOSTIC],
    validation: { state: 'invalid', summary_ko: '' },
  });
  handle.select('n_below');
  const inspector = byClass(handle.element, 'backtest-vis-inspector')[0];
  assert.match(textOf(inspector), /더블클릭 · Enter로 코드 열기/);
  assert.match(textOf(inspector), /AI는 바로 고치지 않고, 필요한 선택을 한 번에 하나씩 묻습니다\./);
  assert.match(textOf(inspector), /최종 실행을 시작할 수 없습니다/);

  click(byClass(inspector, 'backtest-vis-open-code')[0]);
  click(byClass(inspector, 'backtest-vis-ask-chat')[0]);
  assert.deepEqual(calls.openCode, ['n_below']);
  assert.deepEqual(calls.askChat, ['n_below']);
});

test('파라미터 값을 바꾸면 setParam 한 번과 onChange 한 번', () => {
  const { handle, calls } = mount();
  handle.select('n_fast');
  const num = byClass(handle.element, 'backtest-vis-number')[0];
  num.value = '35';
  fire(num, { type: 'change' });
  assert.equal(handle.getGraph().nodes.filter((n) => n.id === 'n_fast')[0].params.period, 35);
  assert.equal(calls.change[calls.change.length - 1].meta.reason, 'param');
});

// ── 키보드 ───────────────────────────────────────────────────────────────────

test('Enter는 고른 노드로 코드를 연다', () => {
  const { root, handle, calls } = mount();
  handle.select('n_below');
  key(root, 'Enter');
  assert.deepEqual(calls.openCode, ['n_below']);
});

test('Delete는 노드와 그 연결을 함께 지운다', () => {
  const { root, handle } = mount();
  handle.select('n_below');
  key(root, 'Delete');
  const graph = handle.getGraph();
  assert.equal(graph.nodes.filter((n) => n.id === 'n_below').length, 0);
  assert.equal(graph.edges.filter((e) => e.from.node_id === 'n_below' || e.to.node_id === 'n_below').length, 0);
  assert.equal(graph.edges.length, 5);
});

test('Ctrl+Z는 방금 더한 노드를 되돌리고 Ctrl+Y는 다시 놓는다', () => {
  const { root, handle } = mount();
  const id = handle.addNode('indicator.sma');
  assert.equal(handle.getGraph().nodes.length, 8);
  assert.equal(handle.canUndo(), true);

  key(root, 'z', { ctrlKey: true });
  assert.equal(handle.getGraph().nodes.length, 7);
  assert.equal(handle.getGraph().nodes.filter((n) => n.id === id).length, 0);

  key(root, 'y', { ctrlKey: true });
  assert.equal(handle.getGraph().nodes.length, 8);
  assert.equal(handle.getGraph().nodes.filter((n) => n.id === id).length, 1, '되돌렸다 다시 놓아도 같은 ID다');
});

test('Tab은 다음 노드로, Shift+Tab은 이전 노드로 옮긴다', () => {
  const { root, handle } = mount();
  handle.select('n_data');
  key(root, 'Tab');
  assert.equal(handle.getSelected(), 'n_fast');
  key(root, 'Tab', { shiftKey: true });
  assert.equal(handle.getSelected(), 'n_data');
  assert.equal(focused.getAttribute('data-node-id'), 'n_data');
});

test('입력칸 안의 키는 가로채지 않는다 — 이름을 고치다 노드가 사라지면 안 된다', () => {
  const { root, handle } = mount();
  handle.select('n_fast');
  fire(root, { type: 'keydown', key: 'Delete', target: { tagName: 'INPUT' }, preventDefault() {} });
  assert.equal(handle.getGraph().nodes.length, 7);
});

// ── 좁은 폭 ──────────────────────────────────────────────────────────────────

test('좁은 폭에서 서랍을 닫으면 초점이 고른 노드로 돌아오고 상태 바는 선택·오류를 계속 말한다', () => {
  const { root, handle } = mount({
    narrow: true,
    graph: brokenGraph(),
    diagnostics: [PORT_DIAGNOSTIC],
    validation: { state: 'invalid', summary_ko: '' },
  });
  handle.select('n_below');
  assert.equal(byClass(root, 'backtest-vis-palette').length, 0, '좁은 폭에서 팔레트는 기본으로 접혀 있다');

  const toggle = byClass(handle.element, 'is-inspector')[0];
  click(toggle);
  assert.equal(byClass(handle.element, 'backtest-vis-inspector is-drawer').length + byClass(handle.element, 'is-drawer').length > 0, true);
  assert.equal(byClass(handle.element, 'backtest-vis-inspector')[0].getAttribute('role'), 'dialog');

  focused = null;
  click(byClass(handle.element, 'backtest-vis-drawer-close')[0]);
  assert.ok(focused, '닫으면 초점이 어딘가로 돌아가야 한다');
  assert.equal(focused.getAttribute('data-node-id'), 'n_below');

  const line = byClass(handle.element, 'backtest-vis-summary-selection')[0];
  assert.match(line.textContent, /선택 하향 돌파/);
  assert.match(line.textContent, /BTG-PORT-002/);
  assert.equal(line.getAttribute('data-diag-code'), 'BTG-PORT-002');
});

test('Escape도 서랍을 닫고 초점을 노드로 돌려놓는다', () => {
  const { handle } = mount({ narrow: true });
  handle.select('n_fast');
  handle.openDrawer('palette');
  assert.equal(byClass(handle.element, 'backtest-vis-palette').length, 1);
  focused = null;
  key(handle.element, 'Escape');
  assert.equal(byClass(handle.element, 'backtest-vis-palette').length, 0);
  assert.equal(focused.getAttribute('data-node-id'), 'n_fast');
});

// ── 목록 보기 ────────────────────────────────────────────────────────────────

test('목록 보기는 노드마다 포트 select를 내서 끌지 않고도 다 된다', () => {
  const { root, handle } = mount();
  click(byClass(root, 'backtest-vis-view-toggle')[0]);
  const rows = byClass(handle.element, 'backtest-vis-list-row');
  assert.equal(rows.length, 7);
  const belowRow = rows.filter((r) => r.getAttribute('data-node-id') === 'n_below')[0];
  const ports = byClass(belowRow, 'backtest-vis-select').map((n) => n.getAttribute('data-port'));
  assert.deepEqual(ports.filter(Boolean), ['left', 'right']);
  assert.equal(byClass(handle.element, 'backtest-vis-view-toggle')[0].textContent, '그래프로 보기');
});

test('목록 보기에서도 삭제가 된다', () => {
  const { handle } = mount();
  handle.setView('list');
  const row = byClass(handle.element, 'backtest-vis-list-row')
    .filter((r) => r.getAttribute('data-node-id') === 'n_exit')[0];
  click(byClass(row, 'backtest-vis-list-remove')[0]);
  assert.equal(handle.getGraph().nodes.filter((n) => n.id === 'n_exit').length, 0);
});

// ── 읽기 전용 ────────────────────────────────────────────────────────────────

test('읽기 전용 그래프는 편집 도구 없이 그려진다 — code_only 스냅숏이 쓰는 모양', () => {
  const { root, handle } = mount({ readOnly: true });
  assert.equal(byClass(root, 'backtest-vis-palette').length, 0);
  assert.equal(byClass(root, 'backtest-vis-undo').length, 0);
  assert.equal(byClass(root, 'backtest-vis-redo').length, 0);
  assert.equal(byClass(root, 'backtest-vis-fit').length, 0);
  assert.equal(byClass(root, 'backtest-vis-list-remove').length, 0);
  assert.ok(String(root.className).indexOf('is-readonly') !== -1);

  handle.select('n_fast');
  const inspector = byClass(handle.element, 'backtest-vis-inspector')[0];
  assert.ok(byClass(inspector, 'backtest-vis-select').every((s) => s.disabled === true));
  assert.ok(byClass(inspector, 'backtest-vis-number').every((s) => s.disabled === true));
  assert.equal(byClass(handle.element, 'backtest-vis-node').length, 7, '노드는 그대로 다 보인다');
});

test('읽기 전용에서는 편집 연산이 조용히 실패하지 않고 이유를 남긴다', () => {
  const { handle } = mount({ readOnly: true });
  assert.equal(handle.addNode('indicator.sma'), null);
  assert.equal(handle.getGraph().nodes.length, 7);
  assert.match(handle.getNotice(), /읽기 전용/);
});

// ── 서버 registry 모양 ───────────────────────────────────────────────────────

// 실제 payload는 visual_registry.py가 만든다(2026-09-03 실측): 포트 이름이 `port`가 아니라
// `name`, 합집합 타입이 `"A|B"`가 아니라 `accepts[]`, 묶음이 `group`이 아니라 `category`,
// 선택지가 `enum`이 아니라 `choices`다. 둘 중 하나만 읽으면 계약이 바뀌는 날 팔레트가
// 조용히 빈칸이 된다.
const SERVER_REGISTRY = {
  kinds: [
    {
      kind: 'data.ohlcv',
      category: 'data',
      label_ko: '캔들',
      inputs: [],
      outputs: [
        { name: 'close', type: SERIES_NUM, label_ko: '종가' },
        { name: 'ohlcv', type: 'OHLCV', label_ko: '캔들 묶음' },
      ],
      params: [],
      max_per_graph: 1,
    },
    {
      kind: 'indicator.sma',
      category: 'indicator',
      label_ko: 'SMA',
      inputs: [
        { name: 'source', type: SERIES_NUM, label_ko: '가격', accepts: [SERIES_NUM], required: true },
        { name: 'period', type: 'Number', label_ko: 'period', accepts: ['Number'], required: false },
      ],
      outputs: [{ name: 'value', type: SERIES_NUM, label_ko: '값' }],
      params: [
        { name: 'alias', type: 'str', label_ko: '이름', required: true, default: 'sma' },
        { name: 'period', type: 'int', label_ko: 'period', default: 20, min: 2, max: 240, step: 1 },
      ],
    },
    {
      kind: 'condition.cross_below',
      category: 'condition',
      label_ko: '아래로 교차',
      inputs: [
        { name: 'left', type: SERIES_NUM, label_ko: '왼쪽', accepts: [SERIES_NUM], required: true },
        { name: 'right', type: SERIES_NUM, label_ko: '오른쪽', accepts: [SERIES_NUM, 'Number'], required: false },
      ],
      outputs: [{ name: 'signal', type: SERIES_BOOL, label_ko: '신호' }],
      params: [{ name: 'compare_to', type: 'number', label_ko: '비교값', nullable: true }],
    },
    {
      kind: 'param',
      category: 'param',
      label_ko: '조절값',
      inputs: [],
      outputs: [{ name: 'value', type: 'Number', label_ko: '값' }],
      params: [{ name: 'type', type: 'enum', label_ko: '타입', default: 'int', choices: ['int', 'float'] }],
    },
    {
      kind: 'output.exit',
      category: 'output',
      label_ko: '청산',
      inputs: [{ name: 'signal', type: SERIES_BOOL, label_ko: '신호', accepts: [SERIES_BOOL], required: true }],
      outputs: [],
      params: [],
      max_per_graph: 1,
    },
  ],
};

test('서버 registry 모양(name·accepts·category·choices)을 그대로 받아 접는다', () => {
  const norm = editor.normalizeRegistry(SERVER_REGISTRY);
  const sma = norm.kinds.filter((k) => k.kind === 'indicator.sma')[0];
  assert.equal(sma.group, '지표');
  assert.equal(sma.inputs[0].port, 'source');
  assert.equal(sma.inputs[0].type, SERIES_NUM);
  const below = norm.kinds.filter((k) => k.kind === 'condition.cross_below')[0];
  assert.equal(below.inputs[1].port, 'right');
  assert.equal(below.inputs[1].type, 'Series<Number>|Number', 'accepts[]가 합집합 문자열로 접힌다');
  const param = norm.kinds.filter((k) => k.kind === 'param')[0];
  assert.deepEqual(param.params[0].enum, ['int', 'float'], 'choices가 enum으로 접힌다');
});

test('서버 registry로도 팔레트·타입 검사·검사기가 그대로 선다', () => {
  const { root, handle } = mount({
    registry: SERVER_REGISTRY,
    graph: {
      graph_version: '1',
      nodes: [
        { id: 'd', kind: 'data.ohlcv', label: '캔들', params: {}, ui: { x: 16, y: 40 } },
        { id: 's', kind: 'indicator.sma', label: '느린 SMA', params: { alias: 'ma_slow', period: 60 }, ui: { x: 140, y: 40 } },
        { id: 'c', kind: 'condition.cross_below', label: '아래로 교차', params: {}, ui: { x: 264, y: 40 } },
        { id: 'x', kind: 'output.exit', label: '청산', params: {}, ui: { x: 380, y: 50 } },
      ],
      edges: [edge('e1', 'd', 'close', 's', 'source')],
      scenario: {},
    },
  });
  const groups = byClass(root, 'backtest-vis-palette-group-title').map((n) => n.textContent);
  assert.deepEqual(groups, ['데이터', '지표', '조건', '출력']);

  assert.equal(handle.connectionError({ node_id: 's', port: 'value' }, { node_id: 'c', port: 'right' }), null);
  assert.match(
    handle.connectionError({ node_id: 'c', port: 'signal' }, { node_id: 'c', port: 'left' }),
    /자기 자신/,
  );
  assert.match(
    handle.connectionError({ node_id: 'd', port: 'ohlcv' }, { node_id: 's', port: 'source' }),
    /타입이 맞지 않습니다/,
  );

  handle.select('s');
  const inspector = byClass(handle.element, 'backtest-vis-inspector')[0];
  // int 파라미터도 슬라이더를 받는다 — 서버는 number 말고 int·float으로도 말한다.
  assert.equal(byClass(inspector, 'backtest-vis-slider')[0].value, '60');
  const labels = byClass(inspector, 'backtest-vis-field-label').map((n) => n.textContent);
  assert.ok(labels.indexOf('입력 데이터') !== -1, '보드가 그린 포트는 보드의 이름표를 쓴다');
  const options = byClass(inspector, 'backtest-vis-select')
    .filter((n) => n.getAttribute('data-port') === 'source')[0].children.map((o) => o.textContent);
  assert.ok(options.indexOf('종가 close') !== -1);
});

// ── 순수 계산 ────────────────────────────────────────────────────────────────

test('워밍업은 가장 긴 기간 -1봉', () => {
  assert.equal(editor.warmupBars(goldenCross().nodes), 59);
  assert.equal(editor.warmupBars([]), 0);
});

test('포트 점은 하나면 가운데 살짝 위, 둘이면 그 위아래로 벌어진다', () => {
  const box = { x: 0, y: 0, w: 100, h: 86 };
  assert.equal(editor.portAnchor(box, 1, 0), 37);
  assert.equal(editor.portAnchor(box, 2, 0), 26);
  assert.equal(editor.portAnchor(box, 2, 1), 48);
  // 포트가 여섯이어도 카드 밖으로 나가지 않는다
  const data = { x: 0, y: 0, w: 92, h: 84 };
  assert.ok(editor.portAnchor(data, 6, 0) > 0);
  assert.ok(editor.portAnchor(data, 6, 5) < data.h);
});

test('조건 노드가 어느 출력으로 흐르는지 안다 — 카드 색과 워터마크가 여기서 나온다', () => {
  const g = goldenCross();
  assert.equal(editor.branchOf(g.nodes, g.edges, 'n_above'), 'entry');
  assert.equal(editor.branchOf(g.nodes, g.edges, 'n_below'), 'exit');
  // 두 갈래에 다 닿는 칸은 어느 쪽도 아니다 — 한쪽으로 정하면 색이 거짓말을 한다.
  assert.equal(editor.branchOf(g.nodes, g.edges, 'n_data'), null);
});

test('destroy는 컨테이너를 비운다', () => {
  const { container, handle } = mount();
  assert.equal(container.children.length, 1);
  handle.destroy();
  assert.equal(container.children.length, 0);
});
