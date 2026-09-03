'use strict';

// backtest-technique-nodes.js 단위 테스트 — jsdom 없이 최소 DOM 스텁으로 검증한다
// (backtest-visual-editor.test.js가 세운 관례를 그대로 가져온다). 그 스텁에서 여기가
// 기대는 것은 셋이다:
//   ① createElementNS — 흐름선이 SVG라서 필요하다
//   ② focus()/tagName — "Tab이 다음 노드 카드로 간다"는 접근성 계약을 사람 눈이 아니라
//      테스트가 판정하게 하려면 초점을 기록해야 한다
//   ③ 동기 dispatch — 키보드 계약을 await 없이 단언하기 위해
// 전역 스텁을 고치지 않고 이 파일 안에서만 늘린다(다른 테스트의 기대를 흔들지 않는다).

const test = require('node:test');
const assert = require('node:assert/strict');

const mod = require('./backtest-technique-nodes');
const { createTechniqueNodes, buildLanes, flowPath, normalizePayload, ioLine, lineRange } = mod;

// ── 고정 자료 ────────────────────────────────────────────────────────────────
// POST /api/v1/backtest/technique/nodes 응답 모양 그대로다. 화면이 자기 편한 모양으로
// 바꿔 읽기 시작하면 백엔드가 바뀔 때 조용히 어긋난다.

function fn(id, over) {
  return Object.assign({
    id: id,
    label: `${id}()`,
    summary_ko: '',
    first_line: 1,
    last_line: 2,
    params: ['df'],
    returns_hint: 'Series<Number>',
    calls: [],
    role: 'helper',
    stage: null,
  }, over || {});
}

// ATR을 진입·청산이 함께 쓰는 돌파 기법 — 보드 21이 그린 그 구도다.
function breakout() {
  return {
    nodes: [
      fn('compute_atr', {
        summary_ko: '변동성 폭을 구한다', first_line: 12, last_line: 24,
        params: ['df', 'lookback'], role: 'indicator', calls: [],
      }),
      fn('breakout_level', {
        summary_ko: '돌파 기준선을 만든다', first_line: 27, last_line: 35,
        params: ['df', 'atr'], role: 'indicator', calls: ['compute_atr'],
      }),
      fn('should_enter', {
        summary_ko: '기준선을 넘으면 진입', first_line: 38, last_line: 45,
        params: ['df', 'level'], returns_hint: 'Series<Bool>', role: 'entry', calls: ['breakout_level'],
      }),
      fn('should_exit', {
        summary_ko: '변동성만큼 밀리면 청산', first_line: 48, last_line: 56,
        params: ['df', 'atr'], returns_hint: 'Series<Bool>', role: 'exit', calls: ['compute_atr'],
      }),
      fn('signals', {
        summary_ko: '두 열을 붙여 돌려준다', first_line: 59, last_line: 78,
        params: ['df', 'p'], returns_hint: 'DataFrame', role: 'signals',
        calls: ['should_enter', 'should_exit'],
      }),
    ],
    flows: {
      entry: ['compute_atr', 'breakout_level', 'should_enter'],
      exit: ['compute_atr', 'should_exit'],
    },
    granularity: 'function',
    unknown: [],
    error: null,
  };
}

// signals() 하나뿐인 기법 — 서버가 flow.py의 4단계를 노드로 준다. 흐름은 비어 온다.
function stagePayload() {
  return {
    nodes: [
      fn('output', { label: 'output', stage: 'output', role: '', first_line: 40, last_line: 48 }),
      fn('prepare', { label: 'prepare', stage: 'prepare', role: '', first_line: 4, last_line: 11 }),
      fn('conditions', { label: 'conditions', stage: 'conditions', role: '', first_line: 25, last_line: 39 }),
      fn('indicators', { label: 'indicators', stage: 'indicators', role: '', first_line: 12, last_line: 24 }),
    ],
    flows: {},
    granularity: 'stage',
    unknown: [],
    error: null,
  };
}

const STATS = { warmup_bars: 59, entry: 41, exit: 41, rows: 606 };

// ── DOM 스텁 ─────────────────────────────────────────────────────────────────

let focused = null;

function fakeNode(tag) {
  return {
    tag: tag,
    tagName: String(tag).toUpperCase(),
    className: '',
    textContent: '',
    type: '',
    value: '',
    hidden: false,
    disabled: false,
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

function hasClass(node, cls) {
  return String(node.className || '').split(/\s+/).indexOf(cls) !== -1;
}

function pos(node) {
  const style = node.getAttribute('style') || '';
  const left = /left:(-?\d+(?:\.\d+)?)px/.exec(style);
  const top = /top:(-?\d+(?:\.\d+)?)px/.exec(style);
  return { left: left ? Number(left[1]) : null, top: top ? Number(top[1]) : null };
}

function cards(root) {
  return byClass(root, 'backtest-tnodes-card');
}

function cardsOf(root, flow) {
  return cards(root).filter((c) => c.getAttribute('data-flow') === flow);
}

function ids(list) {
  return list.map((n) => n.getAttribute('data-node-id'));
}

function fire(node, event) {
  node.dispatchEvent(event);
}

function click(node) {
  fire(node, { type: 'click', stopPropagation() {} });
}

function key(root, keyName, extra) {
  fire(root, Object.assign({ type: 'keydown', key: keyName, preventDefault() {} }, extra || {}));
}

function mount(overrides) {
  const container = fakeNode('div');
  const calls = { select: [], explainNode: [], explainFlow: [], explainAll: 0, openCode: [] };
  const handle = createTechniqueNodes(container, Object.assign({
    payload: breakout(),
    stats: null,
    onSelect: (id) => calls.select.push(id),
    onExplainNode: (id) => calls.explainNode.push(id),
    onExplainFlow: (kind) => calls.explainFlow.push(kind),
    onExplainAll: () => { calls.explainAll += 1; },
    onOpenCode: (id) => calls.openCode.push(id),
  }, overrides || {}));
  return { container: container, root: handle.element, handle: handle, calls: calls };
}

// ── 왼쪽 레일 ────────────────────────────────────────────────────────────────

test('레일은 이 기법의 노드를 전부 세고, 함수명과 줄 범위를 함께 보여준다', () => {
  const { root } = mount();
  assert.equal(byClass(root, 'backtest-tnodes-rail-title')[0].textContent, '이 기법의 노드 5개');
  const items = byClass(root, 'backtest-tnodes-rail-item');
  assert.equal(items.length, 5);
  assert.deepEqual(ids(items), ['compute_atr', 'breakout_level', 'should_enter', 'should_exit', 'signals']);
  assert.equal(byClass(items[0], 'backtest-tnodes-rail-name')[0].textContent, 'compute_atr()');
  assert.equal(byClass(items[0], 'backtest-tnodes-rail-lines')[0].textContent, 'L12–24');
});

test('레일 맨 아래 안내는 이 화면이 이 기법의 것이라고 말한다 — 범용 팔레트가 아니다', () => {
  const { root } = mount();
  const note = byClass(root, 'backtest-tnodes-rail-note');
  assert.equal(note.length, 1);
  assert.equal(note[0].textContent, '다른 기법에는 다른 노드가 생깁니다');
  // 팔레트·연결 편집은 이 창에 없다.
  assert.equal(byClass(root, 'backtest-tnodes-palette').length, 0);
});

// ── 흐름 갈래 ────────────────────────────────────────────────────────────────

test('진입·청산은 두 세로 갈래로 서고, 카드 순서는 서버가 준 호출 사슬 그대로다', () => {
  const { root } = mount();
  const entry = cardsOf(root, 'entry');
  const exit = cardsOf(root, 'exit');
  assert.deepEqual(ids(entry), ['compute_atr', 'breakout_level', 'should_enter']);
  assert.deepEqual(ids(exit), ['compute_atr', 'should_exit']);
  // 세로: 같은 갈래 안에서 위→아래. 가로: 진입 갈래가 청산 갈래보다 왼쪽.
  assert.ok(pos(entry[0]).top < pos(entry[1]).top);
  assert.ok(pos(entry[1]).top < pos(entry[2]).top);
  assert.equal(pos(entry[0]).left, pos(entry[2]).left);
  assert.ok(pos(entry[0]).left < pos(exit[0]).left);
});

test('흐름 머리말은 갈래마다 서고 [이 흐름 설명]이 kind를 그대로 낸다', () => {
  const { root, calls } = mount();
  const heads = byClass(root, 'backtest-tnodes-lane-head');
  assert.deepEqual(heads.map((h) => h.getAttribute('data-flow')), ['entry', 'exit']);
  assert.equal(byClass(heads[0], 'backtest-tnodes-lane-title')[0].textContent, '진입 흐름');
  assert.equal(byClass(heads[1], 'backtest-tnodes-lane-title')[0].textContent, '청산 흐름');
  const asks = byClass(root, 'backtest-tnodes-lane-explain');
  assert.equal(asks.length, 2);
  assert.equal(asks[0].textContent, '이 흐름 설명');
  click(asks[0]);
  click(asks[1]);
  assert.deepEqual(calls.explainFlow, ['entry', 'exit']);
});

test('흐름선은 갈래마다 (노드 수 - 1)개이고 세로 베지어다 — 가로 곡선은 같은 x에서 직선이 된다', () => {
  const { root } = mount();
  const links = byClass(root, 'backtest-tnodes-link');
  assert.equal(links.length, 3); // 진입 2 + 청산 1
  assert.deepEqual(
    links.map((l) => `${l.getAttribute('data-from')}→${l.getAttribute('data-to')}`),
    ['compute_atr→breakout_level', 'breakout_level→should_enter', 'compute_atr→should_exit'],
  );
  const d = flowPath(100, 20, 100, 120);
  assert.equal(d, 'M 100 20 C 100 70, 100 70, 100 120');
});

// ── 재사용 고스트 ────────────────────────────────────────────────────────────

test('같은 함수가 두 흐름에 쓰이면 두 번째 카드가 재사용 고스트다', () => {
  const { root } = mount();
  const both = byAttr(root, 'data-node-id', 'compute_atr').filter((n) => hasClass(n, 'backtest-tnodes-card'));
  assert.equal(both.length, 2);
  assert.equal(hasClass(both[0], 'is-ghost'), false);
  assert.equal(hasClass(both[1], 'is-ghost'), true);
  assert.ok(textOf(both[1]).indexOf('재사용') !== -1);
  assert.ok(both[1].getAttribute('aria-label').indexOf('재사용') !== -1);
  // 고스트에는 손잡이를 달지 않는다 — 같은 함수의 [코드 보기]가 둘이면 어느 쪽인지 모른다.
  assert.equal(byClass(both[0], 'backtest-tnodes-act').length, 2);
  assert.equal(byClass(both[1], 'backtest-tnodes-act').length, 0);
});

// ── 선택과 콜백 ──────────────────────────────────────────────────────────────

test('카드를 누르면 선택되고, 같은 노드의 고스트도 함께 눌린 상태가 된다', () => {
  const { root, handle, calls } = mount();
  click(cardsOf(root, 'entry')[0]);
  assert.deepEqual(calls.select, ['compute_atr']);
  assert.equal(handle.getSelected(), 'compute_atr');
  const both = byAttr(handle.element, 'data-node-id', 'compute_atr').filter((n) => hasClass(n, 'backtest-tnodes-card'));
  assert.deepEqual(both.map((n) => n.getAttribute('aria-pressed')), ['true', 'true']);
  assert.equal(byClass(handle.element, 'backtest-tnodes-rail-item')[0].getAttribute('aria-pressed'), 'true');
});

test('레일에서 고른 노드도 같은 선택이다 — 같은 콜백이 한 번만 나간다', () => {
  const { root, handle, calls } = mount();
  click(byClass(root, 'backtest-tnodes-rail-item')[2]);
  assert.deepEqual(calls.select, ['should_enter']);
  click(byClass(handle.element, 'backtest-tnodes-rail-item')[2]);
  assert.deepEqual(calls.select, ['should_enter']);
});

test('카드의 두 버튼은 코드와 질문으로 갈라진다 — 이 창은 직접 고치지 않는다', () => {
  const { root, calls } = mount();
  const card = cardsOf(root, 'exit')[1];
  click(byClass(card, 'is-code')[0]);
  click(byClass(card, 'is-ask')[0]);
  assert.deepEqual(calls.openCode, ['should_exit']);
  assert.deepEqual(calls.explainNode, ['should_exit']);
  assert.equal(byClass(card, 'is-ask')[0].textContent, '이상해요, 물어볼게요');
});

test('캔버스 아래 [이 기법 전체를 설명해줘]는 인자 없이 부른다', () => {
  const { root, calls } = mount();
  const all = byClass(root, 'backtest-tnodes-explain-all');
  assert.equal(all.length, 1);
  assert.equal(all[0].textContent, '이 기법 전체를 설명해줘');
  click(all[0]);
  assert.equal(calls.explainAll, 1);
});

// ── 카드 내용 ────────────────────────────────────────────────────────────────

test('카드는 함수명·한 줄 설명·입력→출력·줄 범위·역할 칩을 함께 말한다', () => {
  const { root } = mount();
  const card = cardsOf(root, 'entry')[0];
  assert.equal(byClass(card, 'backtest-tnodes-card-title')[0].textContent, 'compute_atr()');
  assert.equal(byClass(card, 'backtest-tnodes-card-summary')[0].textContent, '변동성 폭을 구한다');
  assert.equal(byClass(card, 'backtest-tnodes-card-io')[0].textContent, 'df, lookback → Series<Number>');
  assert.equal(byClass(card, 'backtest-tnodes-card-lines')[0].textContent, 'L12–24');
  assert.equal(byClass(card, 'backtest-tnodes-card-role')[0].textContent, '지표');
  assert.equal(card.getAttribute('role'), 'button');
  assert.equal(card.getAttribute('aria-label'), 'compute_atr() · 지표');
});

test('설명이 비어 오면 그 줄을 아예 지운다 — 화면이 없는 설명을 지어내지 않는다', () => {
  const payload = breakout();
  payload.nodes[0].summary_ko = '';
  const { root } = mount({ payload: payload });
  const card = cardsOf(root, 'entry')[0];
  assert.equal(byClass(card, 'backtest-tnodes-card-summary').length, 0);
  assert.equal(byClass(card, 'backtest-tnodes-card-io').length, 1);
});

test('인자가 없거나 타입을 못 읽으면 빈칸이 아니라 낱말로 적는다', () => {
  assert.equal(ioLine({ params: [], returns_hint: '' }), '입력 없음 → unknown');
  assert.equal(lineRange({ first_line: 7, last_line: 7 }), 'L7');
  assert.equal(lineRange({ first_line: null, last_line: 9 }), '');
});

// ── 키보드 ───────────────────────────────────────────────────────────────────

test('Tab은 다음 노드로 가고 초점이 그 카드에 앉는다', () => {
  const { root, handle, calls } = mount();
  key(root, 'Tab');
  assert.equal(handle.getSelected(), 'compute_atr');
  assert.equal(focused.getAttribute('data-node-id'), 'compute_atr');
  assert.equal(hasClass(focused, 'backtest-tnodes-card'), true);
  key(handle.element, 'Tab');
  assert.equal(handle.getSelected(), 'breakout_level');
  key(handle.element, 'Tab', { shiftKey: true });
  assert.equal(handle.getSelected(), 'compute_atr');
  assert.deepEqual(calls.select, ['compute_atr', 'breakout_level', 'compute_atr']);
});

test('흐름에 안 들어간 함수는 카드가 없으므로 초점이 레일로 돌아간다 — 초점을 잃지 않는다', () => {
  const { root, handle } = mount();
  handle.focusNode('signals');
  assert.equal(handle.getSelected(), 'signals');
  assert.equal(hasClass(focused, 'backtest-tnodes-rail-item'), true);
  assert.equal(focused.getAttribute('data-node-id'), 'signals');
  assert.equal(cards(root).filter((c) => c.getAttribute('data-node-id') === 'signals').length, 0);
});

test('Enter는 설명, o는 코드 — 고른 노드가 없으면 아무 일도 없다', () => {
  const { root, handle, calls } = mount();
  key(root, 'Enter');
  key(root, 'o');
  assert.deepEqual(calls.explainNode, []);
  assert.deepEqual(calls.openCode, []);
  handle.select('should_exit');
  key(handle.element, 'Enter');
  key(handle.element, 'o');
  assert.deepEqual(calls.explainNode, ['should_exit']);
  assert.deepEqual(calls.openCode, ['should_exit']);
});

test('버튼 위의 Enter는 그 버튼의 클릭이다 — 설명이 덤으로 나가지 않는다', () => {
  const { root, handle, calls } = mount();
  handle.select('should_exit');
  const act = byClass(handle.element, 'backtest-tnodes-act')[0];
  key(handle.element, 'Enter', { target: act });
  assert.deepEqual(calls.explainNode, []);
});

// ── stage 폴백 ───────────────────────────────────────────────────────────────

test('signals() 하나뿐인 기법은 4단계를 같은 카드로 세운다 — 순서는 flow.py 단계 순서', () => {
  const { root } = mount({ payload: stagePayload() });
  const list = cards(root);
  assert.equal(list.length, 4);
  assert.deepEqual(ids(list), ['prepare', 'indicators', 'conditions', 'output']);
  assert.ok(list.every((c) => hasClass(c, 'backtest-tnodes-card')));
  assert.equal(byClass(list[0], 'backtest-tnodes-card-role')[0].textContent, '준비');
  assert.equal(byClass(list[3], 'backtest-tnodes-card-role')[0].textContent, '출력');
  // 한 갈래이므로 세로로만 선다.
  assert.equal(pos(list[0]).left, pos(list[3]).left);
  assert.ok(pos(list[0]).top < pos(list[3]).top);
});

test('폴백 갈래에는 [이 흐름 설명]을 달지 않는다 — 부를 kind가 없다', () => {
  const { root } = mount({ payload: stagePayload() });
  assert.equal(byClass(root, 'backtest-tnodes-lane-explain').length, 0);
  assert.equal(byClass(root, 'backtest-tnodes-lane-title')[0].textContent, '단계 흐름');
  assert.equal(byClass(root, 'backtest-tnodes-explain-all').length, 1);
});

test('흐름이 비어도 노드가 있으면 갈래 하나로 접는다 — 화면이 통째로 비지 않는다', () => {
  const payload = breakout();
  payload.flows = { entry: [], exit: [] };
  const lanes = buildLanes(normalizePayload(payload));
  assert.equal(lanes.length, 1);
  assert.equal(lanes[0].explainable, false);
  assert.equal(lanes[0].ids.length, 5);
});

test('흐름이 가리키는 이름이 노드에 없으면 그 이름만 버린다', () => {
  const payload = breakout();
  payload.flows.entry = ['compute_atr', '없는함수', 'compute_atr', 'should_enter'];
  const lanes = buildLanes(normalizePayload(payload));
  assert.deepEqual(lanes[0].ids, ['compute_atr', 'should_enter']);
});

// ── 알약·상태 ────────────────────────────────────────────────────────────────

test('stats가 있으면 주문 후보 알약 둘, 없으면 하나도 없다', () => {
  const { root, handle } = mount();
  assert.equal(byClass(root, 'backtest-tnodes-pill').length, 0);
  handle.setStats(STATS);
  const pills = byClass(handle.element, 'backtest-tnodes-pill');
  assert.deepEqual(pills.map((p) => p.textContent), ['진입 주문 후보 41건', '청산 주문 후보 41건']);
  handle.setStats(null);
  assert.equal(byClass(handle.element, 'backtest-tnodes-pill').length, 0);
});

test('상태 한 줄은 role=status이고 고른 노드가 어느 흐름에 있는지 말한다', () => {
  const { root, handle } = mount();
  const status = byClass(root, 'backtest-tnodes-status')[0];
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(textOf(status), '노드를 고르면 설명을 들을 수 있습니다');
  handle.select('compute_atr');
  assert.ok(textOf(byClass(handle.element, 'backtest-tnodes-status')[0]).indexOf('두 흐름 모두') !== -1);
  handle.select('should_exit');
  assert.ok(textOf(byClass(handle.element, 'backtest-tnodes-status')[0]).indexOf('청산 흐름') !== -1);
  handle.select('signals');
  assert.ok(textOf(byClass(handle.element, 'backtest-tnodes-status')[0]).indexOf('흐름에 들어가지 않습니다') !== -1);
});

test('error가 오면 상태 줄이 그 문장을 그대로 싣는다', () => {
  const { root } = mount({ payload: { nodes: [], flows: {}, error: { message: '구문 오류 · 17행' } } });
  const status = byClass(root, 'backtest-tnodes-status')[0];
  assert.equal(hasClass(status, 'is-error'), true);
  assert.ok(textOf(status).indexOf('구문 오류 · 17행') !== -1);
});

test('노드가 없으면 왜 비었는지 말한다', () => {
  const { root } = mount({ payload: { nodes: [], flows: {} } });
  assert.equal(cards(root).length, 0);
  assert.ok(textOf(byClass(root, 'backtest-tnodes-status')[0]).indexOf('검사를 통과하면') !== -1);
});

test('unknown은 화면이 삼키지 않는다 — 역할을 못 읽었다는 사실을 그대로 낸다', () => {
  const payload = breakout();
  payload.unknown = ['_debug', '_tmp'];
  const { root } = mount({ payload: payload });
  const note = byClass(root, 'backtest-tnodes-status-unknown')[0];
  assert.equal(note.textContent, '역할을 못 읽은 함수 2개 · _debug, _tmp');
});

// ── 손잡이 ───────────────────────────────────────────────────────────────────

test('setPayload는 화면을 갈아끼우고, 사라진 노드의 선택은 조용히 놓는다', () => {
  const { handle, calls } = mount();
  handle.select('should_enter');
  assert.deepEqual(calls.select, ['should_enter']);
  handle.setPayload(stagePayload());
  assert.equal(handle.getSelected(), null);
  assert.deepEqual(calls.select, ['should_enter']); // 서버 교체는 사용자의 선택이 아니다
  assert.equal(cards(handle.element).length, 4);
});

test('destroy는 컨테이너에서 자기 뿌리를 걷어낸다', () => {
  const { container, handle } = mount();
  assert.equal(container.children.length, 1);
  handle.destroy();
  assert.equal(container.children.length, 0);
});

test('normalizePayload는 빠진 칸을 계약의 기본값으로 채운다', () => {
  const p = normalizePayload(null);
  assert.deepEqual(p.nodes, []);
  assert.deepEqual(p.flows, { entry: [], exit: [] });
  assert.equal(p.granularity, 'function');
  assert.deepEqual(p.unknown, []);
  assert.equal(p.error, null);
  const one = normalizePayload({ nodes: [{ id: 'f' }] });
  assert.equal(one.nodes[0].label, 'f()');
  assert.equal(one.nodes[0].summary_ko, '');
  assert.deepEqual(one.nodes[0].params, []);
});
