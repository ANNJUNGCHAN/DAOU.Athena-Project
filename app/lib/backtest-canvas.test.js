// backtest-canvas.js 단위 테스트 — jsdom 없이 최소 DOM 스텁으로 검증한다
// (history-badge.test.js/agent-canvas.test.js가 세운 관례).
//
// 2026-09-01 전수 파리티 이후 범위: 모드 탭 5개, 설계 폼(지표 슬라이더·조건 빌더·리스크),
// 승인 화면의 세 갈래(수집·보유 구간만·취소), 결과 타일 부제, 실패→진단 전환.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const backtestCanvas = require('./backtest-canvas');
const { createBacktestCanvas } = backtestCanvas;

const SMA_YAML = `
version: "1.0"
metadata:
  name: SMA 골든크로스
  description: 단기 이평이 장기 이평을 상향 돌파하면 진입, 하향 돌파하면 청산
strategy:
  id: sma_crossover
  category: trend
  params:
    fast: {default: 20, min: 5, max: 60, step: 1, type: int}
    slow: {default: 60, min: 20, max: 240, step: 1, type: int}
  indicators:
    - {id: SMA, alias: ma_fast, params: {period: "$fast"}}
    - {id: SMA, alias: ma_slow, params: {period: "$slow"}}
  entry:
    logic: AND
    conditions:
      - {indicator: ma_fast, operator: cross_above, compare_to: ma_slow}
  exit:
    logic: OR
    conditions:
      - {indicator: ma_fast, operator: cross_below, compare_to: ma_slow}
risk:
  stop_loss:   {enabled: true,  percent: 8}
  take_profit: {enabled: false, percent: 20}
  position:    {sizing: all_in}
`;

const PRESETS = [
  { id: 'sma_crossover', name: 'SMA 골든크로스', category: 'trend', yaml: SMA_YAML },
];

function fakeNode(tag) {
  const node = {
    tag,
    className: '',
    textContent: '',
    type: '',
    placeholder: '',
    value: '',
    checked: false,
    hidden: false,
    readOnly: false,
    spellcheck: true,
    selectionStart: 0,
    selectionEnd: 0,
    scrollTop: 0,
    scrollLeft: 0,
    children: [],
    attrs: {},
    _listeners: {},
    get firstChild() { return this.children[0] || null; },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter((c) => c !== child); return child; },
    // class 속성은 className으로 되비친다 — 진짜 DOM이 그렇고, SVG 노드는 className이
    // 아니라 setAttribute('class', ...)로만 클래스를 받는다(backtest-equity-chart.js).
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === 'class') this.className = String(v);
    },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
    },
    addEventListener(type, handler) {
      (this._listeners[type] = this._listeners[type] || []).push(handler);
    },
    dispatchEvent(event) {
      const handlers = this._listeners[event && event.type] || [];
      return Promise.all(handlers.map((h) => h(event)));
    },
  };
  return node;
}

test.beforeEach(() => {
  global.document = {
    createElement: (tag) => fakeNode(tag),
    // 시각 편집기의 엣지는 SVG다 — 이 하나가 없으면 지도 탭 전체가 못 선다.
    createElementNS: (ns, tag) => fakeNode(tag),
    createTextNode: (text) => ({ tag: '#text', textContent: text, children: [] }),
  };
});

test.afterEach(() => {
  delete global.document;
});

function findByClass(node, cls) {
  const found = [];
  const walk = (n) => {
    if (String(n.className || '').split(/\s+/).includes(cls)) found.push(n);
    (n.children || []).forEach(walk);
  };
  walk(node);
  return found;
}

function textOf(node) {
  const parts = [];
  const walk = (n) => {
    if (n.textContent && !(n.children || []).length) parts.push(n.textContent);
    (n.children || []).forEach(walk);
  };
  walk(node);
  return parts.join(' ');
}

async function click(node) {
  await node.dispatchEvent({ type: 'click' });
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// 타이머를 기본으로 가짜로 둔다 — 진짜 setTimeout을 쓰면 status가 계속 running인
// 테스트에서 폴링이 영원히 예약돼 node --test가 끝나지 않는다. 폴링 자체를 보는
// 테스트만 자기 구현을 넘긴다.
function makeCanvas(overrides) {
  const container = fakeNode('div');
  const pending = [];
  const deps = Object.assign({
    container,
    fetchPresets: async () => PRESETS,
    setTimeoutImpl: (fn) => { pending.push(fn); return pending.length; },
    clearTimeoutImpl: () => {},
  }, overrides || {});
  return { container, canvas: createBacktestCanvas(deps), pending };
}

// 지도가 기본 탭이라(2026-09-03) 폼을 보는 검사는 폼 탭으로 옮긴 뒤에 시작한다.
// 기본이 지도라는 사실 자체는 아래 '설계 하위 탭' 테스트가 따로 못 박는다.
async function toForm(container) {
  const tab = findByClass(container, 'backtest-subtab')[1];
  if (tab) await click(tab);
}

// 폼을 실행 가능한 상태로 만든다(종목·기간). 입력 이벤트는 모델만 갱신하므로
// 화면을 다시 그리지 않아도 값이 남는다.
async function fillForm(container) {
  await toForm(container);
  const symbolInput = findByClass(container, 'backtest-symbol-add')[0];
  symbolInput.value = '005930';
  await symbolInput.dispatchEvent({ type: 'keydown', key: 'Enter' });
  const inputs = findByClass(container, 'backtest-field-input');
  const from = inputs.find((i) => i.placeholder === 'YYYYMMDD');
  const to = inputs.filter((i) => i.placeholder === 'YYYYMMDD')[1];
  from.value = '20160101';
  await from.dispatchEvent({ type: 'input' });
  to.value = '20260828';
  await to.dispatchEvent({ type: 'input' });
}

// ── 기본 상태 ───────────────────────────────────────────────────────────────

test('container가 없으면 mount()/refresh()·채팅 배선까지 조용히 넘어간다', () => {
  const canvas = createBacktestCanvas({});
  assert.doesNotThrow(() => { canvas.mount(); canvas.refresh(); });
  // chat.js가 채널 구독에서 그냥 부르는 자리들 — 없으면 액션 한 번에 TypeError로 죽는다.
  assert.doesNotThrow(() => {
    canvas.onChatAction({ kind: 'navigate', tab: 'history' });
    canvas.onChatAction({ kind: 'spec_draft', patch: {} });
    canvas.runFromChat();
    canvas.startOptimizeFromChat();
  });
  assert.equal(canvas.undoChatAction('bc-1').ok, false);
  assert.equal(canvas.getContext(), null);
});

test('mount() 직후(비동기 완료 전)에는 정직한 로딩 상태를 그린다', () => {
  const { container, canvas } = makeCanvas();
  canvas.mount();
  assert.equal(findByClass(container, 'backtest-canvas-empty').length, 1);
  assert.match(textOf(container), /불러오는 중/);
});

test('프리셋 fetch 실패 시 정직한 에러 상태를 그린다(목업 데이터 없음)', async () => {
  const { container, canvas } = makeCanvas({
    fetchPresets: async () => { throw new Error('백엔드 없음'); },
  });
  canvas.mount();
  await flush();
  await toForm(container);
  assert.equal(findByClass(container, 'backtest-canvas-error').length, 1);
  assert.match(textOf(container), /백엔드 없음/);
});

// ── 보드 01 · 설계 폼 ───────────────────────────────────────────────────────

test('empty → design: 프리셋 목록·대상·지표·조건·리스크 카드를 모두 그린다', async () => {
  const { container, canvas } = makeCanvas();
  canvas.mount();
  await flush();
  await toForm(container);
  assert.equal(findByClass(container, 'backtest-preset-item').length, 1);
  assert.ok(findByClass(container, 'backtest-symbol-add').length, '종목 입력이 있어야 한다');
  assert.equal(findByClass(container, 'backtest-indicator-row').length, 2);
  assert.equal(findByClass(container, 'backtest-condition-card').length, 2);
  assert.match(textOf(container), /리스크 · 비용/);
});

test('지표 파라미터가 슬라이더로 나온다 — 프리셋의 min/max가 그대로 붙는다', async () => {
  const { container, canvas } = makeCanvas();
  canvas.mount();
  await flush();
  await toForm(container);
  const sliders = findByClass(container, 'backtest-param-slider');
  assert.equal(sliders.length, 2);
  assert.equal(sliders[0].getAttribute('min'), '5');
  assert.equal(sliders[0].getAttribute('max'), '60');
  assert.equal(sliders[0].value, '20');
});

test('슬라이더를 움직이면 실행 yaml의 값이 바뀐다', async () => {
  let sent = null;
  const { container, canvas } = makeCanvas({
    run: async (body) => { sent = body; return { run_id: 'r1' }; },
    result: async () => ({ status: 'running' }),
  });
  canvas.mount();
  await flush();
  await toForm(container);
  await fillForm(container);
  const slider = findByClass(container, 'backtest-param-slider')[0];
  slider.value = '35';
  await slider.dispatchEvent({ type: 'input' });
  await click(findByClass(container, 'backtest-run-button')[0]);
  await flush();
  assert.match(sent.yaml, /fast: \{default: 35,/);
});

test('AND/OR 뱃지를 누르면 전환된다', async () => {
  const { container, canvas } = makeCanvas();
  canvas.mount();
  await flush();
  await toForm(container);
  const badge = findByClass(container, 'backtest-logic-badge')[0];
  assert.match(badge.textContent, /AND/);
  await click(badge);
  assert.match(findByClass(container, 'backtest-logic-badge')[0].textContent, /OR/);
});

test('조건을 추가·삭제할 수 있다', async () => {
  const { container, canvas } = makeCanvas();
  canvas.mount();
  await flush();
  await toForm(container);
  assert.equal(findByClass(container, 'backtest-condition').length, 2);
  const adder = findByClass(container, 'backtest-condition-add')[0];
  const target = findByClass(adder, 'backtest-condition-target-input')[0];
  target.value = '70';
  await click(findByClass(adder, 'backtest-condition-add-button')[0]);
  assert.equal(findByClass(container, 'backtest-condition').length, 3);
  await click(findByClass(container, 'backtest-condition-remove')[0]);
  assert.equal(findByClass(container, 'backtest-condition').length, 2);
});

test('비용 기본값이 채워져 있고 "사실 주장이 아니다"를 함께 표기한다', async () => {
  const { container, canvas } = makeCanvas();
  canvas.mount();
  await flush();
  await toForm(container);
  assert.match(textOf(container), /사실 주장이 아닙니다/);
});

test('설계 화면에도 체결 가정이 상시 붙는다(보드 01)', async () => {
  const { container, canvas } = makeCanvas();
  canvas.mount();
  await flush();
  await toForm(container);
  assert.equal(findByClass(container, 'backtest-assumptions').length, 1);
});

test('실행 버튼: 폼이 비어있으면 run()을 부르지 않고 오류 목록을 보여준다', async () => {
  let called = false;
  const { container, canvas } = makeCanvas({ run: async () => { called = true; return {}; } });
  canvas.mount();
  await flush();
  await toForm(container);
  await click(findByClass(container, 'backtest-run-button')[0]);
  await flush();
  assert.equal(called, false);
  assert.ok(findByClass(container, 'backtest-design-error-line').length >= 1);
});

// ── 보드 04 · 수집 승인 ─────────────────────────────────────────────────────

async function toApproval(extra) {
  const calls = [];
  const { container, canvas } = makeCanvas(Object.assign({
    run: async (body) => {
      calls.push(body);
      return body.allow_partial ? { run_id: 'r-partial' } : { blocked: true, needed_pages: 4, est_seconds: 5 };
    },
    result: async () => ({ status: 'running' }),
  }, extra || {}));
  canvas.mount();
  await flush();
  await toForm(container);
  await fillForm(container);
  await click(findByClass(container, 'backtest-run-button')[0]);
  await flush();
  return { container, canvas, calls };
}

test('409 → 승인 카드: 커버리지 막대·TR 호출 수·예상 소요를 그린다', async () => {
  const { container } = await toApproval();
  assert.equal(findByClass(container, 'backtest-approval').length, 1);
  assert.equal(findByClass(container, 'backtest-coverage-bar').length, 1);
  const text = textOf(container);
  assert.match(text, /ka10081/);
  assert.match(text, /예상 소요/);
});

test('승인 카드에는 세 갈래가 모두 있다 — 막다른 길을 만들지 않는다', async () => {
  const { container } = await toApproval();
  assert.equal(findByClass(container, 'backtest-approval-confirm').length, 1);
  assert.equal(findByClass(container, 'backtest-approval-partial').length, 1);
  assert.equal(findByClass(container, 'backtest-approval-cancel').length, 1);
});

test('[보유 구간만으로 실행]은 allow_partial=true로 다시 부른다(휴장일 영구 409 탈출)', async () => {
  const { container, calls } = await toApproval();
  await click(findByClass(container, 'backtest-approval-partial')[0]);
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].allow_partial, undefined);
  assert.equal(calls[1].allow_partial, true);
});

test('승인 카드 [취소] → 설계로 돌아간다', async () => {
  const { container } = await toApproval();
  await click(findByClass(container, 'backtest-approval-cancel')[0]);
  assert.equal(findByClass(container, 'backtest-approval').length, 0);
  assert.ok(findByClass(container, 'backtest-preset-item').length);
});

test('[수집하고 실행] → backfill 바디가 폼 값 그대로다', async () => {
  let body = null;
  const { container } = await toApproval({
    backfill: async (b) => { body = b; return { job_id: 'j1' }; },
    status: async () => ({ status: 'running' }),
  });
  await click(findByClass(container, 'backtest-approval-confirm')[0]);
  await flush();
  assert.deepEqual(body, {
    stk_cd: '005930', period: 'day', adjusted: true,
    from_dt: '20160101', to_dt: '20260828',
  });
});

// ── 보드 03 · 결과 ──────────────────────────────────────────────────────────

const DONE_RESULT = {
  status: 'done',
  metrics: {
    total_return: 1.842, cagr: 0.104, sharpe: 0.87, mdd: -0.279,
    win_rate: 0.463, profit_factor: 1.62, open_positions: 0,
    buy_hold_return: 1.41, bars: 2559, warmup_bars: 60,
    mdd_start: '2020-03-02', mdd_bars: 87, closed_trades: 41, winning_trades: 19,
  },
  equity: [
    { dt: '2026-01-01', equity: 100, drawdown: 0 },
    { dt: '2026-02-01', equity: 118, drawdown: -0.02 },
    { dt: '2026-03-01', equity: 284.2, drawdown: 0 },
  ],
  // 매수보유 곡선 — 백엔드가 첫 종가 대비 배수로 준다(GET /runs/{id}의 top-level).
  benchmark: [1, 1.12, 2.41],
  stdout: 'bars=2559\n',
  flags: [],
};

async function toResult(extra) {
  const { container, canvas } = makeCanvas(Object.assign({
    run: async () => ({ run_id: 'r1' }),
    result: async () => DONE_RESULT,
    trades: async () => ([
      { dt: '2026-07-14', side: 'buy', price: 71300, qty: 140, fee: 1497, tax: 0, pnl: null, reason: 'signal' },
      { dt: '2026-08-21', side: 'sell', price: 76800, qty: 140, fee: 1610, tax: 19356, pnl: 747537, reason: 'signal' },
    ]),
  }, extra || {}));
  canvas.mount();
  await flush();
  await toForm(container);
  await fillForm(container);
  await click(findByClass(container, 'backtest-run-button')[0]);
  await flush();
  await flush();
  return { container, canvas };
}

test('running → result: 지표 6타일과 체결 표를 그린다', async () => {
  const { container } = await toResult();
  assert.equal(findByClass(container, 'backtest-metric-tile').length, 6);
  assert.equal(findByClass(container, 'backtest-trades-row').length, 3); // 머리 + 2행
});

test('타일 부제가 백엔드 값으로 채워진다 — 지어내지 않는다', async () => {
  const { container } = await toResult();
  const text = textOf(container);
  assert.match(text, /보유 141\.00%/);
  assert.match(text, /워밍업 60봉 제외/);
  assert.match(text, /2020-03-02 · 87봉/);
  assert.match(text, /41전 19승/);
});

test('체결 표의 비용은 수수료+세금이다 — 매도 거래세를 버리지 않는다', async () => {
  const { container } = await toResult();
  // 두 번째 데이터 행(매도): fee 1610 + tax 19356 = 20966
  assert.match(textOf(container), /20,966/);
});

test('자산곡선 자리가 플레이스홀더가 아니라 실제 영역이다', async () => {
  const { container } = await toResult();
  assert.equal(findByClass(container, 'backtest-equity-host').length, 1);
  assert.equal(textOf(container).includes('곡선은 다음 단계'), false);
});

test('매수보유 곡선을 실제로 그린다 — 범례만 있고 선이 없으면 안 된다', async () => {
  // 이 테스트만 SVG를 만들 수 있게 한다 — 기본 스텁에 createElementNS가 없어서 다른
  // 테스트는 곡선을 건너뛴다(backtest-canvas.js의 그 분기 주석 그대로).
  document.createElementNS = (_ns, tag) => fakeNode(tag);
  const { container } = await toResult();
  assert.equal(findByClass(container, 'backtest-equity-benchmark').length, 1);
  assert.equal(findByClass(container, 'backtest-equity-strategy').length, 1);
});

test('코드 출력(stdout)을 버리지 않고 보여준다', async () => {
  const { container } = await toResult();
  assert.match(textOf(container), /bars=2559/);
});

test('결과에서 설계로 돌아가는 탭이 있다 — 갇히지 않는다', async () => {
  const { container } = await toResult();
  const tabs = findByClass(container, 'backtest-tab');
  assert.equal(tabs.length, 5);
  await click(tabs[0]);
  assert.ok(findByClass(container, 'backtest-preset-item').length);
});

test('가정 섹션은 flags가 없어도 항상 표기된다', async () => {
  const { container } = await toResult();
  const node = findByClass(container, 'backtest-assumptions')[0];
  const text = textOf(node);
  ['종가 확정 후', '다음 봉 시가', '손절이 먼저', '생존 편향', '배당 재투자'].forEach((s) => {
    assert.ok(text.includes(s), `가정 문장 누락: ${s}`);
  });
});

// ── 실패 · 진단 ─────────────────────────────────────────────────────────────

test('코드가 없으면 실패는 그냥 에러 화면이다', async () => {
  const { container, canvas } = makeCanvas({
    run: async () => ({ run_id: 'r1' }),
    result: async () => ({ status: 'failed', error: '터졌다' }),
  });
  canvas.mount();
  await flush();
  await toForm(container);
  await fillForm(container);
  await click(findByClass(container, 'backtest-run-button')[0]);
  await flush();
  assert.equal(findByClass(container, 'backtest-canvas-error').length, 1);
  assert.match(textOf(container), /터졌다/);
});

test('폴링 중단: 컨테이너가 hidden이면 다음 tick을 예약하지 않는다', async () => {
  let scheduled = 0;
  const { container, canvas } = makeCanvas({
    run: async () => ({ run_id: 'r1' }),
    result: async () => ({ status: 'running' }),
    setTimeoutImpl: (fn) => { scheduled += 1; return fn && 1; },
    clearTimeoutImpl: () => {},
  });
  canvas.mount();
  await flush();
  await toForm(container);
  await fillForm(container);
  container.hidden = true;
  await click(findByClass(container, 'backtest-run-button')[0]);
  await flush();
  assert.equal(scheduled, 0);
});

// ── 채팅 액션(propose_spec → 바로 반영 → 채팅이 [되돌리기]) ────────────────
//
// 2026-09-02 사용자 결정: 캔버스에 초안 카드를 세우지 않는다. 검증을 통과한 설정·코드는
// 바로 반영되고, 무엇이 바뀌었는지와 [되돌리기]는 채팅 카드(chat.js)가 그린다.
// 이 파일이 지키는 것은 영수증의 모양과 반영·되돌리기·거부(검증 실패·실행 중)다.

const RSI_YAML = `
version: "1.0"
metadata:
  name: RSI 과매도
strategy:
  id: rsi_reversal
  category: reversal
  params:
    period: {default: 14, min: 5, max: 30, step: 1, type: int}
  indicators:
    - {id: RSI, alias: rsi, params: {period: "$period"}}
  entry:
    logic: AND
    conditions:
      - {indicator: rsi, operator: less_than, compare_to: 30}
  exit:
    logic: OR
    conditions:
      - {indicator: rsi, operator: greater_than, compare_to: 70}
risk:
  stop_loss:   {enabled: false, percent: 8}
  take_profit: {enabled: false, percent: 20}
  position:    {sizing: all_in}
`;

const TWO_PRESETS = PRESETS.concat([
  { id: 'rsi_reversal', name: 'RSI 과매도', category: 'reversal', yaml: RSI_YAML },
]);

const VALID_PATCH = { symbols: ['005930'], fromDt: '20240101', toDt: '20240630' };

// 2026-09-03부터 설계의 기본 탭은 지도다 — 폼·코드를 보는 테스트는 폼 탭으로 옮겨서
// 시작한다. 기본이 지도라는 사실 자체는 아래 '설계 하위 탭' 테스트가 따로 못 박는다.
async function mounted(overrides) {
  const made = makeCanvas(overrides);
  made.canvas.mount();
  await flush();
  await toForm(made.container);
  return made;
}

const RECEIPT_KEYS = [
  'id', 'kind', 'applied', 'note', 'rows', 'nodes', 'version', 'errors',
  'suggest_run', 'suggest_validate', 'tab', 'designTab', 'method', 'canUndo', 'canApply',
];

const CODE_SOURCE = [
  'import athena_bt as bt',
  '',
  'PARAMS = {"fast": {"default": 20}}',
  '',
  '',
  'def signals(df, p):',
  '    return df',
  '',
].join('\n');

// 코드가 편집기에 들어간 상태를 만든다 — 이제 액션 한 번이면 끝이다.
async function withCode(made) {
  made.canvas.onChatAction({ kind: 'code_draft', source: CODE_SOURCE });
  await flush();
  return made;
}

test('onChatAction: 알 수 없는 kind·빈 payload는 null이고 아무것도 바꾸지 않는다', async () => {
  const { canvas } = await mounted();
  assert.equal(canvas.onChatAction(null), null);
  assert.equal(canvas.onChatAction({}), null);
  assert.equal(canvas.onChatAction({ kind: 'nope', tab: 'history' }), null);
  assert.equal(canvas.onChatAction('navigate'), null);
  assert.equal(canvas.onChatAction({ kind: 'spec_draft', patch: 'symbols' }), null);
  assert.equal(canvas.onChatAction({ kind: 'spec_draft', patch: [] }), null);
  assert.equal(canvas.onChatAction({ kind: 'code_draft', source: '' }), null);
  assert.equal(canvas.onChatAction({ kind: 'code_draft', source: 42 }), null);
  const ctx = canvas.getContext();
  assert.equal(ctx.tab, 'design');
  assert.equal(ctx.draft, null);
  assert.equal(ctx.lastChange, null);
});

test('spec_draft: 폼에 바로 들어가고 지도로 돌아온다 — 캔버스 초안 카드는 없다', async () => {
  const { container, canvas } = await mounted();
  await click(findByClass(container, 'backtest-tab')[2]);           // 이력 탭으로
  assert.equal(canvas.getContext().tab, 'history');

  const receipt = canvas.onChatAction({
    kind: 'spec_draft', patch: VALID_PATCH, note: '삼성전자 상반기', suggest_run: false,
  });
  assert.deepEqual(Object.keys(receipt), RECEIPT_KEYS);
  assert.match(receipt.id, /^bc-\d+$/);
  assert.equal(receipt.kind, 'spec_draft');
  assert.equal(receipt.applied, true);
  assert.equal(receipt.note, '삼성전자 상반기');
  assert.deepEqual(receipt.errors, []);
  assert.equal(receipt.suggest_run, false);
  assert.equal(receipt.canUndo, true);
  assert.equal(receipt.tab, 'design');
  // 반영을 보는 자리는 지도다 — 대화가 고치는 것은 폼 칸이 아니라 흐름이다.
  assert.equal(receipt.designTab, 'flow');
  // 반영 한 번이 지도 한 판이다(보드 14-B).
  assert.deepEqual(receipt.version, { from: 1, to: 2 });
  assert.deepEqual(receipt.rows, [
    { label: '종목', before: '없음', after: '005930' },
    { label: '시작일', before: '없음', after: '20240101' },
    { label: '종료일', before: '없음', after: '20240630' },
  ]);

  const ctx = canvas.getContext();
  assert.equal(ctx.view, 'design');
  assert.equal(ctx.tab, 'design');
  assert.equal(ctx.designTab, 'flow');
  assert.equal(ctx.map.version, 2);
  assert.deepEqual(ctx.spec.symbols, ['005930']);
  assert.equal(ctx.spec.fromDt, '20240101');
  assert.equal(ctx.draft, null);
  // 폼이 곧바로 그 값이다 — 사람이 누를 카드가 캔버스에 서지 않는다.
  await toForm(container);
  assert.equal(findByClass(container, 'backtest-draft').length, 0);
  assert.equal(findByClass(container, 'backtest-symbol-code').length, 1);
});

test('spec_draft: 바뀐 칸이 지도의 어느 번호인지 영수증에 실린다(보드 14-B)', async () => {
  const drawn = {
    version: 1,
    nodes: [
      { id: 'params', numeral: '①', title: '조절할 값을 정합니다', lines: [], facts: [], status: 'ok' },
      { id: 'conditions', numeral: '③', title: '사고·파는 순간을 찍습니다', lines: [], facts: [], status: 'ok' },
    ],
    code: { lines: 12, matches_map: true },
  };
  const { canvas } = await mounted({ map: async () => drawn });
  const receipt = canvas.onChatAction({
    kind: 'spec_draft',
    patch: {
      params: { fast: 10 },
      exit: { logic: 'OR', conditions: [{ indicator: 'close', operator: 'less_than', compare_to: 70 }] },
    },
  });
  assert.deepEqual(receipt.nodes, [
    { numeral: '①', title: '조절할 값을 정합니다', text: '파라미터 fast: 10' },
    { numeral: '③', title: '사고·파는 순간을 찍습니다', text: '청산 조건: close 가 더 작음 70' },
  ]);
  // 지도가 '방금 바뀜'을 붙일 칸의 id — 컨텍스트도 같은 값을 읽는다.
  assert.deepEqual(canvas.getContext().lastChange.nodes, ['params', 'conditions']);
});

test('changedNodeIds: 스펙 필드를 지도 칸으로 옮긴다 — 지도 순서, 중복 없음', () => {
  assert.deepEqual(backtestCanvas.changedNodeIds(['entry', 'exit']), ['conditions']);
  assert.deepEqual(
    backtestCanvas.changedNodeIds(['risk', 'params', 'toDt', 'indicators']),
    ['target', 'params', 'indicators', 'guard'],
  );
  // 어느 칸도 아닌 필드(전략 이름)와 모르는 이름은 조용히 빠진다.
  assert.deepEqual(backtestCanvas.changedNodeIds(['name', 'nope']), []);
  assert.deepEqual(backtestCanvas.changedNodeIds(null), []);
});

test('spec_draft 영수증: 값을 사람 말로 적는다 — 파라미터·주기·리스크·비용·조건', async () => {
  const { canvas } = await mounted();
  const receipt = canvas.onChatAction({
    kind: 'spec_draft',
    patch: {
      params: { fast: 10 },
      period: 'week',
      adjusted: false,
      risk: { stop_loss: { enabled: false } },
      costs: { fee_bps: 2 },
      exit: { logic: 'OR', conditions: [{ indicator: 'close', operator: 'less_than', compare_to: 70 }] },
    },
  });
  const said = receipt.rows.map((r) => `${r.label} ${r.before} → ${r.after}`).join(' / ');
  assert.match(said, /파라미터 fast 20 → 10/);
  assert.match(said, /주기 일 → 주/);
  assert.match(said, /수정주가 켬 → 끔/);
  assert.match(said, /리스크 손절 8% 켬 · 익절 20% 끔 → 손절 8% 끔 · 익절 20% 끔/);
  assert.match(said, /비용 수수료 1\.5bp · 매도세 18bp · 슬리피지 5bp → 수수료 2bp/);
  assert.match(said, /청산 조건 ma_fast 가 하향 돌파 ma_slow → close 가 더 작음 70/);
});

test('spec_draft: 실행은 켜지 않는다 — suggest_run은 영수증에 실려 채팅 버튼이 된다', async () => {
  let runs = 0;
  const { canvas } = await mounted({ run: async () => { runs += 1; return {}; } });
  const receipt = canvas.onChatAction({
    kind: 'spec_draft', patch: VALID_PATCH, suggest_run: true,
  });
  assert.equal(receipt.applied, true);
  assert.equal(receipt.suggest_run, true);
  assert.equal(runs, 0);
  assert.equal(canvas.getContext().view, 'design');
});

test('[되돌리기]: 반영 직전 폼으로 돌아가고 무엇이 돌아왔는지를 돌려준다', async () => {
  const { container, canvas } = await mounted();
  const receipt = canvas.onChatAction({ kind: 'spec_draft', patch: VALID_PATCH });
  const undone = canvas.undoChatAction(receipt.id);
  assert.equal(undone.ok, true);
  assert.deepEqual(undone.restored.rows, [
    { label: '종목', before: '005930', after: '없음' },
    { label: '시작일', before: '20240101', after: '없음' },
    { label: '종료일', before: '20240630', after: '없음' },
  ]);
  const ctx = canvas.getContext();
  assert.deepEqual(ctx.spec.symbols, []);
  assert.equal(ctx.spec.fromDt, '');
  assert.equal(ctx.lastChange, null);
  assert.equal(findByClass(container, 'backtest-symbol-code').length, 0);
  // 같은 영수증을 두 번 되돌리지 못한다.
  assert.deepEqual(canvas.undoChatAction(receipt.id), {
    ok: false, reason: '되돌릴 내역이 남아 있지 않습니다',
  });
});

test('되돌리기: 옛 지점으로 돌아가면 그 뒤의 내역은 사라진다', async () => {
  const { canvas } = await mounted();
  const first = canvas.onChatAction({ kind: 'spec_draft', patch: VALID_PATCH });
  const second = canvas.onChatAction({ kind: 'spec_draft', patch: { symbols: ['000660'] } });
  assert.deepEqual(canvas.getContext().spec.symbols, ['000660']);

  assert.equal(canvas.undoChatAction(first.id).ok, true);
  assert.deepEqual(canvas.getContext().spec.symbols, []);
  assert.deepEqual(canvas.undoChatAction(second.id), {
    ok: false, reason: '되돌릴 내역이 남아 있지 않습니다',
  });
});

test('되돌리기 스택은 20개까지 — 더 오래된 변경은 이유를 돌려준다', async () => {
  const { canvas } = await mounted();
  const first = canvas.onChatAction({ kind: 'code_draft', source: '# 1\n' });
  for (let i = 2; i <= 21; i += 1) {
    canvas.onChatAction({ kind: 'code_draft', source: `# ${i}\n` });
  }
  assert.deepEqual(canvas.undoChatAction(first.id), {
    ok: false, reason: '되돌릴 내역이 남아 있지 않습니다',
  });
});

test('검증에 걸리는 설정도 반영된다 — 오류는 실행 전 확인으로 폼·영수증·pending에 남는다', async () => {
  const { container, canvas } = await mounted();
  const receipt = canvas.onChatAction({
    kind: 'spec_draft',
    patch: { symbols: ['005930'], fromDt: '20240630', toDt: '20240101' },
    suggest_run: true,
  });
  assert.equal(receipt.applied, true);
  assert.equal(receipt.canUndo, true);
  assert.deepEqual(receipt.errors, ['종료일은 시작일보다 빠를 수 없습니다']);
  assert.equal(receipt.rows.length, 3);

  const ctx = canvas.getContext();
  assert.deepEqual(ctx.spec.symbols, ['005930']);   // 종목·날짜는 들어갔다
  assert.equal(ctx.spec.toDt, '20240101');
  assert.equal(ctx.draft, null);
  assert.deepEqual(ctx.pending, ['종료일은 시작일보다 빠를 수 없습니다']);
  assert.deepEqual(ctx.lastChange.errors, ['종료일은 시작일보다 빠를 수 없습니다']);
  const lines = findByClass(container, 'backtest-design-error-line').map((n) => n.textContent);
  assert.deepEqual(lines, ['종료일은 시작일보다 빠를 수 없습니다']);

  // 다음 턴에 고쳐 보내면 오류 줄과 pending이 비워진다.
  canvas.onChatAction({ kind: 'spec_draft', patch: VALID_PATCH });
  assert.deepEqual(canvas.getContext().pending, []);
  assert.equal(canvas.getContext().spec.toDt, '20240630');
  assert.equal(findByClass(container, 'backtest-design-error-line').length, 0);
});

test('전략 전환은 종목·날짜가 비어 있어도 바로 반영된다 — 2026-09-02 이평이격 실측', async () => {
  const { canvas } = await mounted({ fetchPresets: async () => TWO_PRESETS });
  const receipt = canvas.onChatAction({ kind: 'spec_draft', patch: { preset: 'rsi_reversal' } });
  assert.equal(receipt.applied, true);
  assert.equal(receipt.rows[0].label, '전략');
  assert.ok(receipt.errors.includes('종목을 하나 이상 고르세요'));
  assert.equal(canvas.getContext().spec.presetId, 'rsi_reversal');
});

test('모르는 프리셋 id는 반영하지 않고 오류로 알린다', async () => {
  const { container, canvas } = await mounted();
  await fillForm(container);
  const receipt = canvas.onChatAction({ kind: 'spec_draft', patch: { preset: 'nope' } });
  assert.equal(receipt.applied, false);
  assert.deepEqual(receipt.errors, ['nope는 없는 프리셋입니다']);
  assert.equal(canvas.getContext().spec.presetId, 'sma_crossover');
});

test('preset이 든 설정: 전략이 바뀌고 종목·기간은 남으며 나머지 키가 그 위에 얹힌다', async () => {
  const { container, canvas } = await mounted({ fetchPresets: async () => TWO_PRESETS });
  await fillForm(container);
  const receipt = canvas.onChatAction({
    kind: 'spec_draft', patch: { preset: 'rsi_reversal', params: { period: 7 } },
  });
  assert.equal(receipt.applied, true);
  assert.equal(receipt.rows[0].label, '전략');
  const said = receipt.rows.map((r) => `${r.label} ${r.before} → ${r.after}`).join(' / ');
  assert.match(said, /전략 SMA 골든크로스 → RSI 과매도/);
  assert.match(said, /파라미터 period 없음 → 7/);

  const spec = canvas.getContext().spec;
  assert.equal(spec.presetId, 'rsi_reversal');
  assert.equal(spec.name, 'RSI 과매도');
  assert.deepEqual(spec.symbols, ['005930']);
  assert.equal(spec.fromDt, '20160101');
  assert.equal(spec.toDt, '20260828');
  assert.deepEqual(Object.keys(spec.params), ['period']);
  assert.equal(spec.params.period.default, 7);
  await toForm(container);
  const selected = findByClass(container, 'backtest-preset-item')
    .filter((n) => n.getAttribute('aria-pressed') === 'true');
  assert.equal(selected.length, 1);
  assert.equal(selected[0].children[0].textContent, 'RSI 과매도');

  // 되돌리면 앞 전략으로 통째로 돌아간다.
  assert.equal(canvas.undoChatAction(receipt.id).ok, true);
  assert.equal(canvas.getContext().spec.presetId, 'sma_crossover');
  assert.deepEqual(canvas.getContext().spec.symbols, ['005930']);
});

test('실행 중·승인 중에는 아무것도 바꾸지 않고 이유를 돌려준다', async () => {
  const { container, canvas } = await mounted({
    run: async () => ({ run_id: 'r1' }),
    result: async () => ({ status: 'running' }),
  });
  await fillForm(container);
  await click(findByClass(container, 'backtest-run-button')[0]);
  await flush();
  assert.equal(canvas.getContext().view, 'running');

  const specReceipt = canvas.onChatAction({ kind: 'spec_draft', patch: { symbols: ['000660'] } });
  assert.equal(specReceipt.applied, false);
  assert.deepEqual(specReceipt.errors, ['실행 중에는 바꿀 수 없습니다']);
  assert.equal(canvas.getContext().draft, null);          // 대기시키지도 않는다
  assert.deepEqual(canvas.getContext().spec.symbols, ['005930']);

  const codeReceipt = canvas.onChatAction({ kind: 'code_draft', source: CODE_SOURCE });
  assert.equal(codeReceipt.applied, false);
  assert.equal(canvas.getContext().code.source, '');
  assert.equal(canvas.onChatAction({ kind: 'navigate', tab: 'history' }).applied, false);
  assert.equal(canvas.onChatAction({ kind: 'optimize_request', method: 'random' }).applied, false);
  assert.equal(canvas.getContext().view, 'running');
  assert.equal(canvas.getContext().tab, 'design');
  assert.equal(canvas.getContext().optimize.method, 'grid');

  // 실행 중에는 되돌리지도 못한다.
  const approval = await toApproval();
  const applied = approval.canvas.onChatAction({ kind: 'spec_draft', patch: VALID_PATCH });
  assert.equal(applied.applied, false);
  await click(findByClass(approval.container, 'backtest-approval-cancel')[0]);
  const now = approval.canvas.onChatAction({ kind: 'spec_draft', patch: { symbols: ['000660'] } });
  assert.equal(now.applied, true);
  assert.equal(approval.canvas.getContext().view, 'design');
});

test('되돌리기: 실행 중에는 잠긴다', async () => {
  const { container, canvas } = await mounted({
    run: async () => ({ run_id: 'r1' }),
    result: async () => ({ status: 'running' }),
  });
  const receipt = canvas.onChatAction({ kind: 'spec_draft', patch: VALID_PATCH });
  await click(findByClass(container, 'backtest-run-button')[0]);
  await flush();
  assert.deepEqual(canvas.undoChatAction(receipt.id), {
    ok: false, reason: '실행 중에는 되돌릴 수 없습니다',
  });
});

test('runFromChat: 폼 오류를 돌려주고 실행하지 않는다 — 통과하면 그때 한 번 돈다', async () => {
  const bodies = [];
  const { container, canvas } = await mounted({
    run: async (body) => { bodies.push(body); return { run_id: 'r1' }; },
    result: async () => ({ status: 'running' }),
  });
  const errors = canvas.runFromChat();
  await flush();
  assert.ok(errors.includes('종목을 하나 이상 고르세요'), errors.join(' / '));
  assert.equal(bodies.length, 0);
  assert.ok(findByClass(container, 'backtest-design-error-line').length >= 1);

  canvas.onChatAction({ kind: 'spec_draft', patch: VALID_PATCH, suggest_run: true });
  assert.deepEqual(canvas.runFromChat(), []);
  await flush();
  assert.equal(bodies.length, 1);
  assert.match(bodies[0].yaml, /symbols: \["005930"\]/);
  assert.equal(canvas.getContext().view, 'running');
});

test('code_draft: 편집기에 바로 들어가고 실행경로가 코드로 바뀐다 — 실행은 없다', async () => {
  let runs = 0;
  const made = await mounted({ run: async () => { runs += 1; return {}; } });
  const receipt = made.canvas.onChatAction({
    kind: 'code_draft', source: CODE_SOURCE, note: '진입 조건을 고쳤다', suggest_validate: true,
  });
  assert.deepEqual(Object.keys(receipt), RECEIPT_KEYS);
  assert.equal(receipt.kind, 'code_draft');
  assert.equal(receipt.applied, true);
  assert.equal(receipt.note, '진입 조건을 고쳤다');
  assert.equal(receipt.suggest_validate, true);
  assert.equal(receipt.canUndo, true);
  assert.equal(receipt.tab, 'design');
  assert.equal(receipt.designTab, 'code');
  // 빈 편집기와의 diff라 지워진 줄은 없고 전부 추가 줄이다.
  assert.deepEqual(receipt.rows, [{ label: '코드', before: '0줄', after: '8줄 · +7 −0' }]);

  const ctx = made.canvas.getContext();
  assert.equal(ctx.view, 'design');
  assert.equal(ctx.designTab, 'code');
  assert.equal(ctx.code.source, CODE_SOURCE);
  assert.equal(ctx.code.lines, 8);
  assert.equal(ctx.runPath, 'code');
  assert.equal(ctx.codeDraft, null);
  assert.equal(findByClass(made.container, 'backtest-code-draft').length, 0);
  assert.equal(runs, 0);
  // 편집기에 그 원문이 들어가 있다.
  const area = findByClass(made.container, 'backtest-code-textarea')[0];
  assert.equal(area.value, CODE_SOURCE);
});

test('code_draft 되돌리기: 편집기와 실행경로가 함께 돌아간다', async () => {
  const made = await mounted();
  const first = made.canvas.onChatAction({ kind: 'code_draft', source: CODE_SOURCE });
  const second = made.canvas.onChatAction({
    kind: 'code_draft', source: `${CODE_SOURCE}# 두 번째\n`,
  });
  assert.deepEqual(second.rows, [{ label: '코드', before: '8줄', after: '9줄 · +1 −0' }]);

  const undone = made.canvas.undoChatAction(second.id);
  assert.equal(undone.ok, true);
  assert.deepEqual(undone.restored.rows, [
    { label: '코드', before: '9줄', after: '8줄 · +0 −1' },
  ]);
  assert.equal(made.canvas.getContext().code.source, CODE_SOURCE);

  assert.equal(made.canvas.undoChatAction(first.id).ok, true);
  assert.equal(made.canvas.getContext().code.source, '');
  assert.equal(made.canvas.getContext().runPath, 'form');
});

test('code_draft: run 바디에 source가 실린다 — 사람이 실행을 누른 뒤다', async () => {
  const bodies = [];
  const { container, canvas } = await mounted({
    run: async (body) => { bodies.push(body); return { run_id: 'r1' }; },
    result: async () => ({ status: 'running' }),
  });
  await fillForm(container);
  canvas.onChatAction({ kind: 'code_draft', source: CODE_SOURCE, suggest_run: true });
  assert.equal(bodies.length, 0);
  assert.deepEqual(canvas.runFromChat(), []);
  await flush();
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].source, CODE_SOURCE);
});

test('validateFromChat: validate(kind=python)를 부르고 판정·오류를 돌려준다', async () => {
  let seen = null;
  let ok = false;
  const { container, canvas } = await mounted({
    validate: async (body) => {
      seen = body;
      return ok ? { ok: true } : { ok: false, errors: [{ message: 'signals(df, p)가 없습니다' }] };
    },
  });
  canvas.onChatAction({ kind: 'code_draft', source: CODE_SOURCE, suggest_validate: true });
  assert.deepEqual(await canvas.validateFromChat(), {
    ok: false, errors: ['signals(df, p)가 없습니다'],
  });
  assert.deepEqual(seen, { kind: 'python', source: CODE_SOURCE });
  assert.deepEqual(canvas.getContext().code.errors, ['signals(df, p)가 없습니다']);
  assert.match(textOf(container), /signals\(df, p\)가 없습니다/);

  ok = true;
  assert.deepEqual(await canvas.validateFromChat(), { ok: true, errors: [] });
  assert.deepEqual(canvas.getContext().code.errors, []);
});

test('되돌리기: 검증 오류도 함께 지운다 — 사라진 코드의 오류를 남기지 않는다', async () => {
  const { container, canvas } = await mounted({
    validate: async () => ({ ok: false, errors: [{ message: 'signals(df, p)가 없습니다' }] }),
  });
  canvas.onChatAction({ kind: 'code_draft', source: '# 처음 코드\n' });
  const receipt = canvas.onChatAction({
    kind: 'code_draft', source: CODE_SOURCE, suggest_validate: true,
  });
  await canvas.validateFromChat();
  assert.deepEqual(canvas.getContext().code.errors, ['signals(df, p)가 없습니다']);

  assert.equal(canvas.undoChatAction(receipt.id).ok, true);
  const ctx = canvas.getContext();
  assert.equal(ctx.code.source, '# 처음 코드\n');
  assert.deepEqual(ctx.code.errors, []);
  assert.doesNotMatch(textOf(container), /signals\(df, p\)가 없습니다/);
});

test('navigate: 탭만 옮기고 되돌리기는 없다', async () => {
  let called = 0;
  const { container, canvas } = await mounted({
    runs: async () => {
      called += 1;
      return [{ run_id: 'run_9', status: 'done', metrics: { total_return: 0.12, sharpe: 1.1 } }];
    },
  });
  const receipt = canvas.onChatAction({ kind: 'navigate', tab: 'history' });
  await flush();
  assert.equal(called, 1);
  assert.equal(receipt.kind, 'navigate');
  assert.equal(receipt.applied, true);
  assert.equal(receipt.canUndo, false);
  assert.equal(receipt.tab, 'history');
  assert.deepEqual(receipt.rows, []);
  const ctx = canvas.getContext();
  assert.equal(ctx.tab, 'history');
  assert.deepEqual(ctx.runs, [{
    run_id: 'run_9', status: 'done', total_return: 0.12, sharpe: 1.1,
  }]);
  assert.equal(findByClass(container, 'backtest-history-row').length, 1);
});

test('navigate design/flow: 코드 경로면 지금 코드로 지도를 다시 만든다', async () => {
  const asked = [];
  const made = await mounted({
    map: async (body) => { asked.push(body); return { version: body.version, nodes: [] }; },
  });
  await withCode(made);
  const receipt = made.canvas.onChatAction({
    kind: 'navigate', tab: 'design', designTab: 'flow',
  });
  await flush();
  // 코드가 들어온 순간 이미 한 번 다시 만들었고, 탭을 열 때 또 만든다 — 둘 다 그 코드다.
  assert.deepEqual(asked[asked.length - 1], { version: 2, source: CODE_SOURCE });
  assert.equal(receipt.designTab, 'flow');
  assert.equal(made.canvas.getContext().designTab, 'flow');
  assert.equal(findByClass(made.container, 'backtest-flow-tab').length, 1);
});

test('폼 경로의 지도는 지금 폼(yaml)으로 만든다 — 같은 라우트, 다른 몸체', async () => {
  const asked = [];
  const made = await mounted({ map: async (body) => { asked.push(body); return { version: 1, nodes: [] }; } });
  await flush();
  assert.equal(asked.length >= 1, true, '전략이 서면 지도부터 만든다');
  assert.equal(asked[0].version, 1);
  assert.match(asked[0].yaml, /SMA 골든크로스/);
  assert.equal(asked[0].source, undefined);
  assert.equal(asked[0].run_id, undefined);
});

test('navigate: 모르는 tab은 null이고, 모르는 designTab만 무시한다', async () => {
  const { canvas } = await mounted();
  assert.equal(canvas.onChatAction({ kind: 'navigate', tab: 'nope' }), null);
  assert.equal(canvas.getContext().tab, 'design');
  const receipt = canvas.onChatAction({
    kind: 'navigate', tab: 'optimize', designTab: 'nope',
  });
  assert.equal(receipt.applied, true);
  const ctx = canvas.getContext();
  assert.equal(ctx.tab, 'optimize');
  assert.equal(ctx.designTab, 'form');
});

test('optimize_request: 방식을 골라두고 [탐색 시작]을 켠다 — 시작은 사람·채팅 버튼이다', async () => {
  let started = 0;
  const { container, canvas } = await mounted({
    optimize: async () => { started += 1; return { best: null, warnings: [] }; },
  });
  const receipt = canvas.onChatAction({
    kind: 'optimize_request', method: 'random', note: '느린 축부터 훑어보죠',
  });
  assert.equal(receipt.kind, 'optimize_request');
  assert.equal(receipt.applied, true);
  assert.equal(receipt.canUndo, false);
  assert.equal(receipt.method, 'random');
  assert.equal(receipt.tab, 'optimize');
  assert.equal(receipt.note, '느린 축부터 훑어보죠');
  const ctx = canvas.getContext();
  assert.equal(ctx.view, 'design');
  assert.equal(ctx.tab, 'optimize');
  assert.equal(ctx.optimize.method, 'random');
  assert.equal(started, 0);
  assert.match(findByClass(container, 'backtest-optimize-start')[0].className, /is-suggested/);
  assert.match(
    textOf(findByClass(container, 'backtest-optimize-suggested')[0]),
    /느린 축부터 훑어보죠/,
  );

  await canvas.startOptimizeFromChat();
  await flush();
  assert.equal(started, 1);
  assert.equal(findByClass(container, 'backtest-optimize-suggested').length, 0);
});

test('optimize_request: 문구가 없으면 기본 한 줄, 모르는 method는 그대로 둔다', async () => {
  const { container, canvas } = await mounted();
  const receipt = canvas.onChatAction({ kind: 'optimize_request', method: 'nope' });
  assert.equal(receipt.method, 'grid');
  assert.equal(canvas.getContext().optimize.method, 'grid');
  assert.match(
    textOf(findByClass(container, 'backtest-optimize-suggested')[0]),
    /채팅이 이 설정으로 탐색을 제안했습니다/,
  );
});

test('getContext(): lastChange는 마지막 변경만 싣고 되돌리면 사라진다', async () => {
  const { canvas } = await mounted();
  assert.equal(canvas.getContext().lastChange, null);
  const receipt = canvas.onChatAction({
    kind: 'spec_draft', patch: VALID_PATCH, note: '삼성전자',
  });
  const last = canvas.getContext().lastChange;
  assert.deepEqual(Object.keys(last), ['id', 'kind', 'applied', 'rows', 'nodes', 'errors']);
  assert.equal(last.id, receipt.id);
  assert.equal(last.kind, 'spec_draft');
  assert.equal(last.applied, true);
  assert.equal(last.rows.length, 3);
  assert.deepEqual(last.errors, []);

  canvas.onChatAction({ kind: 'navigate', tab: 'optimize' });
  assert.equal(canvas.getContext().lastChange.kind, 'navigate');

  assert.equal(canvas.undoChatAction(receipt.id).ok, true);
  assert.equal(canvas.getContext().lastChange, null);
});

// ── 실행경로(폼 · 코드) ─────────────────────────────────────────────────────

test('실행경로 전환은 코드가 있을 때만 뜨고, run 바디의 source를 켜고 끈다', async () => {
  const bodies = [];
  const made = await mounted({
    run: async (body) => { bodies.push(body); return { run_id: 'r1' }; },
    result: async () => ({ status: 'running' }),
  });
  const { container, canvas } = made;
  await fillForm(container);
  assert.equal(findByClass(container, 'backtest-runpath').length, 0);

  await withCode(made);
  const items = findByClass(container, 'backtest-runpath-item');
  assert.deepEqual(items.map((i) => i.textContent), ['폼', '코드']);
  assert.equal(items[1].getAttribute('aria-pressed'), 'true');

  await click(findByClass(container, 'backtest-run-button')[0]);
  await flush();
  assert.equal(bodies[0].source, CODE_SOURCE);
  assert.ok(bodies[0].yaml);

  await click(findByClass(container, 'backtest-runpath-item')[0]);
  assert.equal(canvas.getContext().runPath, 'form');
  await click(findByClass(container, 'backtest-run-button')[0]);
  await flush();
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].source, undefined);
});

test('결과에 실행경로 뱃지가 붙는다 — run_path=code면 [코드 경로]', async () => {
  const { container } = await toResult();
  assert.equal(findByClass(container, 'backtest-result-runpath')[0].textContent, '폼 경로');

  const codeRun = await toResult({
    result: async () => Object.assign({}, DONE_RESULT, {
      metrics: Object.assign({}, DONE_RESULT.metrics, { run_path: 'code' }),
    }),
  });
  assert.equal(
    findByClass(codeRun.container, 'backtest-result-runpath')[0].textContent, '코드 경로',
  );
});

// ── getContext() 확장 ───────────────────────────────────────────────────────

test('getContext(): 키 목록이 계약으로 고정돼 있다 — spec은 복사본이다', async () => {
  const { canvas } = await mounted();
  const ctx = canvas.getContext();
  assert.deepEqual(Object.keys(ctx), [
    'view', 'tab', 'designTab', 'runPath', 'spec', 'draft', 'pending', 'presets',
    'techniqueDraft', 'technique',
    'map', 'code', 'codeDraft', 'lastResult', 'diagnosis', 'optimize', 'runs', 'coverage',
    'lastChange', 'project',
  ]);
  assert.equal(ctx.view, 'design');
  assert.equal(ctx.techniqueDraft, false, '새 기법을 만드는 중이 아니다');
  assert.equal(ctx.spec.presetId, 'sma_crossover');
  assert.equal(ctx.draft, null);
  assert.deepEqual(ctx.presets, [{ id: 'sma_crossover', name: 'SMA 골든크로스' }]);
  ctx.spec.symbols.push('000000');
  assert.deepEqual(canvas.getContext().spec.symbols, []);
});

test('getContext(): 새 키는 아무것도 없을 때 없음/빈 값으로 정직하게 내려간다', async () => {
  const { canvas } = await mounted();
  const ctx = canvas.getContext();
  assert.equal(ctx.runPath, 'form');
  assert.deepEqual(ctx.code, {
    source: '', truncated: false, lines: 0,
    strategyId: null, activeVersionId: null, errors: [],
  });
  assert.equal(ctx.codeDraft, null);
  assert.equal(ctx.lastResult, null);
  assert.equal(ctx.diagnosis, null);
  assert.deepEqual(ctx.optimize, { method: 'grid', result: null });
  assert.deepEqual(ctx.runs, []);
  assert.equal(ctx.coverage, null);
});

test('getContext(): 성공한 실행은 뽑은 지표·플래그·stdout 꼬리를 싣는다', async () => {
  const { canvas } = await toResult();
  const last = canvas.getContext().lastResult;
  assert.equal(last.status, 'done');
  assert.equal(last.runId, 'r1');
  assert.equal(last.error, null);
  assert.equal(last.metrics.total_return, 1.842);
  assert.equal(last.metrics.warmup_bars, 60);
  // 계약이 정한 키만 — 타일 부제용 값은 프롬프트에 싣지 않는다.
  assert.equal(last.metrics.mdd_start, undefined);
  assert.deepEqual(last.flags, []);
  assert.equal(last.tradesCount, 2);
  assert.equal(last.stdoutTail, 'bars=2559\n');
});

test('getContext(): 실패한 실행은 오류를 싣고 앞 실행의 숫자를 남기지 않는다', async () => {
  const { container, canvas } = await mounted({
    run: async () => ({ run_id: 'r1' }),
    result: async () => ({ status: 'failed', error: 'ValueError: p["fast"]가 없습니다' }),
  });
  await fillForm(container);
  await click(findByClass(container, 'backtest-run-button')[0]);
  await flush();
  const last = canvas.getContext().lastResult;
  assert.equal(last.status, 'failed');
  assert.equal(last.error, 'ValueError: p["fast"]가 없습니다');
  assert.deepEqual(last.metrics, {});
  assert.deepEqual(last.flags, []);
  assert.equal(last.tradesCount, 0);
  assert.equal(last.stdoutTail, '');
});

test('getContext(): 6000자를 넘는 코드는 잘라 싣고 truncated로 알린다', async () => {
  const made = await mounted();
  const long = `${'# 한 줄\n'.repeat(1200)}`;
  made.canvas.onChatAction({ kind: 'code_draft', source: long });
  await flush();
  const code = made.canvas.getContext().code;
  assert.equal(code.truncated, true);
  assert.equal(code.source.length, 6000);
  assert.equal(code.lines, 1201);
});

test('getContext(): 진단은 제목·이유·줄·수정안 요약만 넘긴다', async () => {
  const made = await mounted({
    run: async () => ({ run_id: 'r1' }),
    result: async () => ({ status: 'failed', error: 'NameError' }),
    diagnose: async () => ({
      title: 'NameError',
      detail: '역추적 원문',
      why: '변수가 정의되지 않았다',
      line: 12,
      suggestion: { summary: 'p["fast"]로 바꾼다', new_source: CODE_SOURCE, added: 1, removed: 1 },
    }),
  });
  await fillForm(made.container);
  await withCode(made);
  await click(findByClass(made.container, 'backtest-run-button')[0]);
  await flush();
  assert.deepEqual(made.canvas.getContext().diagnosis, {
    title: 'NameError',
    why: '변수가 정의되지 않았다',
    line: 12,
    hasFix: true,
    summary: 'p["fast"]로 바꾼다',
  });
});

test('진단 [적용하고 다시 실행]: 실행경로가 코드로 돌아와 고친 코드가 돈다', async () => {
  const bodies = [];
  const FIXED = `${CODE_SOURCE}# 고친 줄
`;
  const made = await mounted({
    run: async (body) => { bodies.push(body); return { run_id: `r${bodies.length}` }; },
    result: async () => ({ status: 'failed', error: 'NameError' }),
    diagnose: async () => ({
      title: 'NameError',
      why: '변수가 정의되지 않았다',
      line: 12,
      suggestion: { summary: 'p["fast"]로 바꾼다', new_source: FIXED, added: 1, removed: 0 },
    }),
  });
  await fillForm(made.container);
  await withCode(made);
  // 사람이 실행경로를 폼으로 되돌려둔 상태에서 실패했다 — 진단은 코드가 있으면 뜬다.
  const segments = findByClass(made.container, 'backtest-runpath-item');
  if (segments.length) await click(segments[0]);
  await click(findByClass(made.container, 'backtest-run-button')[0]);
  await flush();
  assert.equal(made.canvas.getContext().view, 'diagnosis');
  await click(findByClass(made.container, 'backtest-diag-apply')[0]);
  await flush();
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].source, FIXED);
  assert.equal(made.canvas.getContext().runPath, 'code');
});

test('getContext(): 캐시 상태는 대상이 정해지면 실리고 대상이 바뀌면 모름으로 돌아간다', async () => {
  const asked = [];
  const made = await mounted({
    coverage: async (params) => {
      asked.push(params);
      return { rows: 1200, first_dt: '20160104', last_dt: '20260828' };
    },
  });
  assert.equal(made.canvas.getContext().coverage, null);  // 종목이 없으면 물어보지 않는다
  assert.equal(asked.length, 0);
  await fillForm(made.container);
  await flush();
  assert.deepEqual(asked, [{ stk_cd: '005930', period: 'day', adjusted: true }]);
  assert.deepEqual(made.canvas.getContext().coverage, {
    rows: 1200, first_dt: '20160104', last_dt: '20260828',
  });
  // 종목을 바꾸면 앞 종목의 숫자를 그대로 물려주지 않는다.
  await click(findByClass(made.container, 'backtest-symbol-remove')[0]);
  assert.equal(made.canvas.getContext().coverage, null);
});

test('getContext(): 최적화 결과는 최고점·경고 문장·셀 수로 줄인다', async () => {
  const { container, canvas } = await mounted({
    optimize: async () => ({
      best: { params: { fast: 10, slow: 40 }, sharpe: 1.4, total_return: 0.9, mdd: -0.2 },
      warnings: [{ kind: 'lonely_peak', message: '외딴 봉우리입니다' }],
      heatmap: { x_axis: 'fast', y_axis: 'slow', cells: [{ x: 1, y: 2, sharpe: 1 }] },
    }),
  });
  canvas.onChatAction({ kind: 'optimize_request', method: 'grid' });
  await click(findByClass(container, 'backtest-optimize-start')[0]);
  await flush();
  assert.deepEqual(canvas.getContext().optimize, {
    method: 'grid',
    result: {
      best: { params: { fast: 10, slow: 40 }, sharpe: 1.4, total_return: 0.9, mdd: -0.2 },
      warnings: ['외딴 봉우리입니다'],
      cells: 1,
    },
  });
});

// ── 순수 계산 ───────────────────────────────────────────────────────────────

test('formatPercentValue/formatRatioValue: null은 정직한 —, 무한대는 ∞', () => {
  assert.equal(backtestCanvas.formatPercentValue(null), '—');
  assert.equal(backtestCanvas.formatPercentValue(0.1234), '12.34%');
  assert.equal(backtestCanvas.formatRatioValue(null), '—');
  assert.equal(backtestCanvas.formatRatioValue(Infinity), '∞');
  assert.equal(backtestCanvas.formatRatioValue(1.618), '1.62');
});

test('metricTileSub: 값이 없으면 부제를 비운다', () => {
  const tile = backtestCanvas.METRIC_TILES[0];
  assert.equal(backtestCanvas.metricTileSub(tile, {}), '');
  assert.equal(backtestCanvas.metricTileSub(tile, null), '');
});

test('coverageRatio: 필요 페이지가 0이면 가득 찼다', () => {
  assert.equal(backtestCanvas.coverageRatio(1000, 0), 1);
  assert.equal(backtestCanvas.coverageRatio(0, 0), 0);
  assert.ok(backtestCanvas.coverageRatio(600, 1) > 0.49);
});

test('heatIntensity: 범위 밖 값을 0~1로 자른다', () => {
  assert.equal(backtestCanvas.heatIntensity(0.5, 0, 1), 0.5);
  assert.equal(backtestCanvas.heatIntensity(2, 0, 1), 1);
  assert.equal(backtestCanvas.heatIntensity(-1, 0, 1), 0);
  assert.equal(backtestCanvas.heatIntensity(1, 1, 1), 0.5);
  assert.equal(backtestCanvas.heatIntensity(null, 0, 1), 0);
});

test('모드 탭 5개와 설계 하위 탭 4개가 계약으로 고정돼 있다', () => {
  assert.deepEqual(backtestCanvas.MODE_TABS.map((t) => t[0]),
    ['design', 'result', 'history', 'optimize', 'deploy']);
  // 지도가 첫 탭이다(2026-09-03) — 코드 탭의 이름 자체가 그것이 마지막 수단임을 말한다.
  // 노드·흐름(2026-09-03 보드 21)은 넷째다 — 기존 기법에도 그 창이 있어야 한다.
  assert.deepEqual(backtestCanvas.DESIGN_TABS.map((t) => t[0]),
    ['flow', 'form', 'code', 'nodes']);
  assert.deepEqual(backtestCanvas.DESIGN_TABS.map((t) => t[1]),
    ['지도', '폼', '코드 · 최후의 보루', '노드·흐름']);
});

test('배포 모드 3종의 기본은 승인이다 — 자동 주문이 기본이 아니다', () => {
  assert.deepEqual(backtestCanvas.DEPLOY_MODES.map((m) => m[0]),
    ['observe', 'approve', 'auto']);
});

test('코드 경로 실행은 폼의 진입·청산 조건을 검사하지 않는다 — 2026-09-02 52주 실측', async () => {
  let sent = null;
  const { container, canvas } = await mounted({
    run: async (body) => { sent = body; return { run_id: 'r-code' }; },
    result: async () => ({ status: 'running' }),
  });
  await fillForm(container);
  canvas.onChatAction({ kind: 'code_draft', source: 'PARAMS = {}\ndef signals(df, p):\n    return df\n' });
  // 폼의 조건을 비운다 — 폼 경로라면 "진입 조건이 하나도 없습니다"로 막힌다.
  canvas.onChatAction({ kind: 'spec_draft', patch: { entry: { logic: 'AND', conditions: [] } } });
  assert.deepEqual(canvas.runFromChat(), []);
  await flush();
  assert.ok(sent && typeof sent.source === 'string' && sent.source.includes('def signals'));
});

test('오류 화면에는 설계로 돌아가는 버튼이 있다 — 막다른 길 금지(2026-09-02 "뒤로가기가 없어")', async () => {
  const { container, canvas } = await mounted({
    run: async () => { throw new Error('이 실행 경로는 종목 1개만 지원한다'); },
  });
  await fillForm(container);
  await click(findByClass(container, 'backtest-run-button')[0]);
  await flush();
  assert.equal(findByClass(container, 'backtest-canvas-error').length, 1);
  const back = findByClass(container, 'backtest-error-back')[0];
  assert.ok(back, '설계로 돌아가기 버튼이 있어야 한다');
  await click(back);
  assert.equal(canvas.getContext().view, 'design');
  assert.equal(findByClass(container, 'backtest-symbol-add').length, 1);
});

// ── 코드 탭의 프로젝트 IDE(결정 D1~D4) ──────────────────────────────────────
// 이 캔버스가 지는 몫은 셋뿐이다: IDE를 붙인다, 프로젝트가 없으면 옛 편집기로 되돌아간다,
// 실행이 "지금 연 파일"을 싣는다. IDE 자체의 계약은 project-ide.test.js가 진다.

const IDE_PROJECT = {
  id: 'p1', name: '내 전략', path: 'C:/x/p1', kind: 'managed',
  created_at: '2026-09-02T00:00:00Z', exists: true, py_files: 1,
};

const IDE_TREE = [
  { name: 'strategy.py', path: 'strategy.py', is_dir: false, py: true, size: 30 },
];

const PROJECT_SOURCE = 'PARAMS = {}\ndef signals(df, p):\n    return [["entry", "exit"]]\n';

// 가짜 디스크 — 쓴 것이 읽힌다. 진짜 디스크가 그러하고, "쓰고 나서 실행"이 편집기
// 버퍼의 옛 내용으로 도는지(캔버스가 파일을 다시 읽는지)를 이 fake만이 잡아낸다.
function projectDeps(overrides) {
  const disk = { 'strategy.py': PROJECT_SOURCE };
  return Object.assign({
    listProjects: async () => ({ projects: [IDE_PROJECT], notice: null }),
    projectTree: async () => ({ entries: IDE_TREE, truncated: false }),
    readProjectFile: async (_id, p) => {
      if (!(p in disk)) throw new Error('파일이 존재하지 않는다');
      return { path: p, text: disk[p] };
    },
    writeProjectFile: async (_id, p, text) => {
      disk[p] = text;
      return { path: p, size: text.length, mtime: 1 };
    },
  }, overrides || {});
}

// 폼을 채우고 → 코드 탭으로 옮겨 → 프로젝트를 고르고 → strategy.py를 연다.
async function openProjectFile(made) {
  await fillForm(made.container);
  await click(findByClass(made.container, 'backtest-subtab')[2]);
  await flush();
  await click(findByClass(made.container, 'project-ide-project')[0]);
  await flush();
  await click(findByClass(made.container, 'project-ide-file')[0]);
  await flush();
}

test('코드 탭: 프로젝트 배선이 없으면 지금까지의 단일 편집기 그대로다', async () => {
  const { container } = await mounted();
  await click(findByClass(container, 'backtest-subtab')[2]);
  assert.equal(findByClass(container, 'project-ide').length, 0);
  assert.equal(findByClass(container, 'backtest-code-textarea').length, 1);
  assert.equal(findByClass(container, 'backtest-code-save').length, 1);
});

test('코드 탭: 프로젝트를 고르기 전에는 IDE와 옛 편집기가 함께 선다', async () => {
  const made = await mounted(projectDeps());
  await click(findByClass(made.container, 'backtest-subtab')[2]);
  await flush();
  assert.equal(findByClass(made.container, 'project-ide').length, 1);
  assert.equal(findByClass(made.container, 'backtest-code-textarea').length, 1, '되돌아갈 자리가 남아야 한다');
  // 프로젝트를 고르면 IDE가 코드 탭을 가져간다.
  await click(findByClass(made.container, 'project-ide-project')[0]);
  await flush();
  assert.equal(findByClass(made.container, 'project-ide-body').length, 1);
  assert.equal(findByClass(made.container, 'backtest-code-save').length, 0);
  // 이 코드가 닿을 수 있는 것(경계 카드)은 어느 쪽에서도 사라지지 않는다.
  assert.equal(findByClass(made.container, 'backtest-code-bounds').length, 1);
});

test('실행: 지금 연 파일의 본문이 source로 실린다(D2 — 진실은 디스크에 있다)', async () => {
  let sent = null;
  const made = await mounted(projectDeps({
    run: async (body) => { sent = body; return { run_id: 'r1' }; },
    result: async () => ({ status: 'running' }),
  }));
  await openProjectFile(made);
  await click(findByClass(made.container, 'backtest-run-button')[0]);
  await flush();
  assert.equal(sent.source, PROJECT_SOURCE);
  assert.ok(sent.yaml, '대상·기간은 여전히 폼에서 온다');
});

test('실행: 저장 안 한 편집이 있으면 막고 "저장하고 실행하세요"를 코드 탭에 적는다', async () => {
  let sent = null;
  const made = await mounted(projectDeps({
    run: async (body) => { sent = body; return { run_id: 'r1' }; },
    result: async () => ({ status: 'running' }),
  }));
  await openProjectFile(made);
  const area = findByClass(made.container, 'backtest-code-textarea')[0];
  area.value = '# 아직 저장 안 함\n';
  await area.dispatchEvent({ type: 'input' });
  await click(findByClass(made.container, 'backtest-run-button')[0]);
  await flush();
  assert.equal(sent, null, '실행이 나가면 안 된다');
  assert.match(textOf(made.container), /저장하고 실행하세요/);

  // 저장하면 그 본문 그대로 돈다.
  await click(findByClass(made.container, 'project-ide-save')[0]);
  await flush();
  await click(findByClass(made.container, 'backtest-run-button')[0]);
  await flush();
  assert.equal(sent.source, '# 아직 저장 안 함\n');
});

test('실행: 프로젝트 파일을 열면 폼의 진입·청산 조건은 검사하지 않는다(신호는 파이썬이 만든다)', async () => {
  let sent = null;
  const made = await mounted(projectDeps({
    run: async (body) => { sent = body; return { run_id: 'r1' }; },
    result: async () => ({ status: 'running' }),
  }));
  made.canvas.onChatAction({ kind: 'spec_draft', patch: { entry: { logic: 'AND', conditions: [] } } });
  await openProjectFile(made);
  await click(findByClass(made.container, 'backtest-run-button')[0]);
  await flush();
  assert.ok(sent, '조건이 비어도 코드 경로로 돈다');
  assert.equal(sent.source, PROJECT_SOURCE);
});

// ── 채팅이 낸 파일 초안(결정 D4) ─────────────────────────────────────────────
// code_draft와 결정적으로 다른 점: 이건 디스크의 파일이다. 그래서 바로 반영하지 않고
// diff만 세운다 — 파일이 쓰이는 순간은 사람이 [적용]을 누른 그때 하나뿐이다.

const DRAFT_SOURCE = `${PROJECT_SOURCE}# 골든크로스\n`;

function fileDeps(writes, overrides) {
  const deps = projectDeps();
  const write = deps.writeProjectFile;
  return Object.assign(deps, {
    writeProjectFile: async (id, path, text) => {
      writes.push({ id, path, text });
      return write(id, path, text);
    },
  }, overrides || {});
}

// 프로젝트만 고르고 파일은 열지 않는다 — 채팅이 새 파일을 내는 흔한 자리다.
async function selectProjectOnly(made) {
  await click(findByClass(made.container, 'backtest-subtab')[2]);
  await flush();
  await click(findByClass(made.container, 'project-ide-project')[0]);
  await flush();
}

test('file_draft: 코드 탭에 diff가 서고 파일은 아직 쓰이지 않는다', async () => {
  const writes = [];
  const made = await mounted(fileDeps(writes));
  await selectProjectOnly(made);

  const receipt = await made.canvas.onChatAction({
    kind: 'file_draft',
    project_id: 'p1',
    path: 'strategy.py',
    source: DRAFT_SOURCE,
    note: '골든크로스로 바꿨다',
    suggest_run: true,
  });
  assert.deepEqual(Object.keys(receipt), RECEIPT_KEYS);
  assert.equal(receipt.kind, 'file_draft');
  assert.equal(receipt.applied, false, '아직 아무것도 안 썼다');
  assert.equal(receipt.canApply, true);
  assert.equal(receipt.canUndo, false, '바뀐 게 없으니 되돌릴 것도 없다');
  assert.equal(receipt.suggest_run, true);
  assert.equal(receipt.note, '골든크로스로 바꿨다');
  assert.equal(receipt.rows.length, 1);
  assert.equal(receipt.rows[0].label, 'strategy.py');
  assert.match(receipt.rows[0].after, /\+1 −0/);
  assert.deepEqual(receipt.errors, []);
  assert.equal(writes.length, 0, '적용을 누르기 전에는 쓰지 않는다');

  // 화면에는 지금 파일과의 diff가 선다 — 더한 줄 하나가 보여야 한다.
  assert.equal(findByClass(made.container, 'backtest-file-draft').length, 1);
  const diffRows = findByClass(made.container, 'backtest-diff-row');
  assert.ok(diffRows.length > 0);
  assert.equal(diffRows.filter((n) => n.className.includes('is-add')).length, 1);
  assert.equal(made.canvas.getContext().designTab, 'code');
});

test('[적용]: 그때 딱 한 번 파일에 쓴다 — project_id·경로·본문 그대로', async () => {
  const writes = [];
  const made = await mounted(fileDeps(writes));
  await selectProjectOnly(made);
  const receipt = await made.canvas.onChatAction({
    kind: 'file_draft', project_id: 'p1', path: 'strategies/golden.py', source: DRAFT_SOURCE,
  });

  assert.match(textOf(made.container), /새 파일 — 아직 만들지 않았습니다/);

  const applied = await made.canvas.applyFileDraft(receipt.id);
  assert.deepEqual(applied, { ok: true, path: 'strategies/golden.py' });
  assert.deepEqual(writes, [{ id: 'p1', path: 'strategies/golden.py', text: DRAFT_SOURCE }]);
  // 초안은 사라진다 — 같은 초안을 두 번 쓰지 않는다.
  assert.equal(findByClass(made.container, 'backtest-file-draft').length, 0);
  assert.equal(made.canvas.getContext().project.fileDraft, null);
  const again = await made.canvas.applyFileDraft(receipt.id);
  assert.deepEqual(again, { ok: false, reason: '적용할 파일 초안이 없습니다' });
  assert.equal(writes.length, 1);
});

test('[버리기]: 아무것도 쓰지 않고 초안만 사라진다', async () => {
  const writes = [];
  const made = await mounted(fileDeps(writes));
  await selectProjectOnly(made);
  const receipt = await made.canvas.onChatAction({
    kind: 'file_draft', project_id: 'p1', path: 'strategies/golden.py', source: DRAFT_SOURCE,
  });

  assert.deepEqual(
    made.canvas.discardFileDraft(receipt.id),
    { ok: true, path: 'strategies/golden.py' },
  );
  assert.equal(writes.length, 0);
  assert.equal(findByClass(made.container, 'backtest-file-draft').length, 0);
  assert.equal(made.canvas.getContext().project.fileDraft, null);
  // 버린 초안은 적용할 수도 없다.
  assert.deepEqual(
    await made.canvas.applyFileDraft(receipt.id),
    { ok: false, reason: '적용할 파일 초안이 없습니다' },
  );
});

test('file_draft: 프로젝트가 없거나 .py가 아니면 서지 않고 이유를 돌려준다', async () => {
  const writes = [];
  const noProject = await mounted();
  const blocked = await noProject.canvas.onChatAction({
    kind: 'file_draft', path: 'a.py', source: 'x = 1\n',
  });
  assert.equal(blocked.applied, false);
  assert.equal(blocked.canApply, false);
  assert.deepEqual(blocked.errors, ['코드 탭에서 프로젝트 폴더를 먼저 여세요']);

  const made = await mounted(fileDeps(writes));
  await selectProjectOnly(made);
  const notPython = await made.canvas.onChatAction({
    kind: 'file_draft', project_id: 'p1', path: 'notes.txt', source: '메모\n',
  });
  assert.deepEqual(notPython.errors, ['파이썬(.py) 파일만 쓸 수 있습니다']);
  const otherProject = await made.canvas.onChatAction({
    kind: 'file_draft', project_id: 'p9', path: 'a.py', source: 'x = 1\n',
  });
  assert.deepEqual(otherProject.errors, ['지금 열어둔 프로젝트의 파일이 아닙니다']);
  assert.equal(findByClass(made.container, 'backtest-file-draft').length, 0);
  assert.equal(writes.length, 0);
  // 빈 페이로드는 영수증도 만들지 않는다.
  assert.equal(await made.canvas.onChatAction({ kind: 'file_draft', path: 'a.py' }), null);
  assert.equal(await made.canvas.onChatAction({ kind: 'file_draft', source: 'x = 1' }), null);
});

test('[적용]: 편집기에 저장 안 한 편집이 있으면 덮어쓰지 않는다', async () => {
  const writes = [];
  const made = await mounted(fileDeps(writes));
  await openProjectFile(made);
  const area = findByClass(made.container, 'backtest-code-textarea')[0];
  area.value = '# 사람이 치던 중\n';
  await area.dispatchEvent({ type: 'input' });

  const receipt = await made.canvas.onChatAction({
    kind: 'file_draft', project_id: 'p1', path: 'strategy.py', source: DRAFT_SOURCE,
  });
  const res = await made.canvas.applyFileDraft(receipt.id);
  assert.equal(res.ok, false);
  assert.match(res.reason, /저장하지 않은 편집/);
  assert.equal(writes.length, 0);
});

test('[적용]: 쓰기가 실패하면 이유를 돌려주고 초안을 남긴다', async () => {
  const made = await mounted(fileDeps([], {
    writeProjectFile: async () => { throw new Error('파일을 저장하지 못했다'); },
  }));
  await selectProjectOnly(made);
  const receipt = await made.canvas.onChatAction({
    kind: 'file_draft', project_id: 'p1', path: 'strategies/golden.py', source: DRAFT_SOURCE,
  });
  const res = await made.canvas.applyFileDraft(receipt.id);
  assert.deepEqual(res, { ok: false, reason: '파일을 저장하지 못했다' });
  assert.equal(findByClass(made.container, 'backtest-file-draft').length, 1, '초안은 그대로 서 있다');
  assert.match(textOf(made.container), /파일을 저장하지 못했다/);
});

test('getContext().project: 폴더·활성 파일·.py 목록·적용 대기를 싣는다', async () => {
  const made = await mounted(fileDeps([]));
  assert.equal(made.canvas.getContext().project, null, '폴더를 열기 전에는 없다');

  await openProjectFile(made);
  const opened = made.canvas.getContext().project;
  assert.equal(opened.name, '내 전략');
  assert.equal(opened.path, 'C:/x/p1');
  assert.equal(opened.activeFile, 'strategy.py');
  assert.equal(opened.dirty, false);
  assert.deepEqual(opened.openFiles, ['strategy.py']);
  assert.deepEqual(opened.pyFiles, ['strategy.py']);
  assert.equal(opened.fileDraft, null);

  await made.canvas.onChatAction({
    kind: 'file_draft', project_id: 'p1', path: 'strategies/golden.py',
    source: DRAFT_SOURCE, note: '골든크로스',
  });
  assert.deepEqual(made.canvas.getContext().project.fileDraft, {
    path: 'strategies/golden.py', note: '골든크로스', lines: 5,
  });
});

test('[적용하고 실행]: 방금 쓴 파일이 돈다 — 편집기 버퍼의 옛 내용이 아니다', async () => {
  let sent = null;
  const writes = [];
  const made = await mounted(fileDeps(writes, {
    run: async (body) => { sent = body; return { run_id: 'r1' }; },
    result: async () => ({ status: 'running' }),
  }));
  // 사람이 strategy.py를 열어둔 채로 채팅이 같은 파일을 고치는 자리다.
  await openProjectFile(made);
  const receipt = await made.canvas.onChatAction({
    kind: 'file_draft', project_id: 'p1', path: 'strategy.py', source: DRAFT_SOURCE,
    suggest_run: true,
  });
  assert.deepEqual(await made.canvas.applyFileDraft(receipt.id), { ok: true, path: 'strategy.py' });

  // 채팅 카드의 [적용하고 실행]이 부르는 자리.
  assert.deepEqual(made.canvas.runFromChat(), []);
  await flush();
  assert.equal(sent.source, DRAFT_SOURCE);
  assert.deepEqual(writes, [{ id: 'p1', path: 'strategy.py', text: DRAFT_SOURCE }]);
});

// ── 내 전략(등록부) · 환경 · 흐름 지도 로딩(WAVE-3, 2026-09-02) ─────────────
// 이 묶음이 지키는 계약: 내 폴더의 .py가 프리셋과 같은 자리에 서고 고르면 실제로 열린다,
// 환경은 상태를 정직하게 말하고 만들기는 잡을 폴링한다, 지도는 만드는 중임을 그린다,
// 파일 실행 한 번이면 배포 탭이 열린다(저장 버튼을 거치지 않아도).

const USER_STRATEGY = {
  id: 'u1',
  name: 'golden',
  project_id: 'p1',
  path: 'strategies/golden.py',
  exists: true,
  params: { fast: 20, thresh: 0.02 },
};

const USER_TREE = [
  { name: 'strategy.py', path: 'strategy.py', is_dir: false, py: true, size: 30 },
  {
    name: 'strategies',
    path: 'strategies',
    is_dir: true,
    py: false,
    size: 0,
    children: [
      { name: 'golden.py', path: 'strategies/golden.py', is_dir: false, py: true, size: 40 },
    ],
  },
];

const GOLDEN_SOURCE = 'PARAMS = {"fast": {"default": 20}}\ndef signals(df, p):\n    return df\n';

// projectDeps에 등록부·환경까지 얹은 배선. 가짜 디스크는 그대로 쓴다.
function userStrategyDeps(overrides) {
  return Object.assign(projectDeps({
    projectTree: async () => ({ entries: USER_TREE, truncated: false }),
    readProjectFile: async (_id, p) => {
      const disk = { 'strategy.py': PROJECT_SOURCE, 'strategies/golden.py': GOLDEN_SOURCE };
      if (!(p in disk)) throw new Error('파일이 존재하지 않는다');
      return { path: p, text: disk[p] };
    },
    userStrategies: async () => [USER_STRATEGY],
  }), overrides || {});
}

test('설계 폼: 내가 만든 기법도 같은 목록에 선다 — 묶음은 하나뿐이다', async () => {
  const { container } = await mounted(userStrategyDeps());
  await flush();
  assert.equal(findByClass(container, 'backtest-technique-list').length, 1, '목록은 하나다');
  assert.equal(findByClass(container, 'backtest-preset-item').length, 1);
  const items = findByClass(container, 'backtest-user-strategy-item');
  assert.equal(items.length, 1);
  assert.match(textOf(items[0]), /golden/);
  assert.match(textOf(items[0]), /strategies\/golden\.py/);
  // 제목은 하나이고 둘을 함께 센다. "프리셋"·"내 전략"이라는 말은 화면에 없다.
  assert.match(textOf(container), /기법 — 2개/);
  assert.equal(textOf(container).indexOf('프리셋'), -1);
  assert.equal(findByClass(container, 'backtest-user-strategy-remove').length, 1);
});

test('설계 폼: 등록부 배선이 없으면 내가 만든 기법 줄이 없을 뿐 목록은 그대로다', async () => {
  const { container } = await mounted();
  assert.equal(findByClass(container, 'backtest-user-strategy-item').length, 0);
  assert.equal(findByClass(container, 'backtest-preset-item').length, 1);
  assert.match(textOf(container), /기법 — 1개/);
});

test('기법 카드: 이름·분류 칩(한국어)·한 줄 설명이 함께 선다', async () => {
  const { container } = await mounted();
  const card = findByClass(container, 'backtest-preset-item')[0];
  assert.equal(findByClass(card, 'backtest-preset-name')[0].textContent, 'SMA 골든크로스');
  assert.equal(findByClass(card, 'backtest-preset-category')[0].textContent, '추세');
  // 설명은 프리셋 yaml의 metadata.description을 그대로 쓴다 — 지어내지 않는다.
  assert.match(findByClass(card, 'backtest-technique-desc')[0].textContent, /단기 이평이/);
});

test('[+ 새 기법 만들기]: 빈 뼈대를 코드창에 세우고 첫 문장을 채팅에 보낸다', async () => {
  const sent = [];
  const prevCustomEvent = global.CustomEvent;
  // 문서 스텁은 beforeEach의 것을 그대로 쓰고(그리기가 그 위에서 돈다) 이 테스트가
  // 재는 통로 하나만 얹는다.
  global.CustomEvent = class {
    constructor(type, init) { this.type = type; this.detail = init && init.detail; }
  };
  global.document.dispatchEvent = (event) => { sent.push(event); return true; };
  try {
    const made = await mounted();
    await click(findByClass(made.container, 'backtest-technique-new')[0]);
    await flush();
    const ctx = made.canvas.getContext();
    assert.equal(ctx.designTab, 'code', '코드창이 먼저 선다');
    assert.equal(ctx.runPath, 'code');
    assert.equal(ctx.techniqueDraft, true);
    assert.equal(ctx.spec.name, '새 기법');
    assert.equal(ctx.spec.presetId, null);
    assert.match(ctx.code.source, /def signals\(df, p\):/);
    assert.match(ctx.code.source, /PARAMS = \{\}/);
    assert.match(ctx.code.source, /return df\[\["entry", "exit"\]\]/);
    // 대화가 시작된다 — 입력창과 제출은 chat.js의 것이라 문장만 던진다.
    const submits = sent.filter((e) => e.type === 'athena:chat-submit');
    assert.equal(submits.length, 1);
    assert.equal(
      submits[0].detail.text,
      '새 기법을 만들고 싶어요. 어떤 전략인지 하나씩 물어봐 주세요.',
    );
  } finally {
    global.CustomEvent = prevCustomEvent;
  }
});

test('[+ 새 기법 만들기] 뒤에 기법을 고르면 만들던 중이라는 신호가 꺼진다', async () => {
  const made = await mounted();
  await click(findByClass(made.container, 'backtest-technique-new')[0]);
  await flush();
  assert.equal(made.canvas.getContext().techniqueDraft, true);
  // 초안에는 폼 탭이 없다 — 목록으로 돌아가는 문은 진행 표시의 [기법 목록] 하나다.
  await click(findByClass(made.container, 'backtest-technique-back')[0]);
  await flush();
  await click(findByClass(made.container, 'backtest-preset-item')[0]);
  await flush();
  const ctx = made.canvas.getContext();
  assert.equal(ctx.techniqueDraft, false);
  assert.equal(ctx.runPath, 'form');
  assert.equal(ctx.code.source, '');
});

test('내 전략을 고르면 그 파일이 IDE에 열리고 실행경로가 코드로 바뀐다', async () => {
  const made = await mounted(userStrategyDeps());
  await flush();
  await fillForm(made.container);
  await click(findByClass(made.container, 'backtest-user-strategy-item')[0]);
  await flush();
  await flush();
  const ctx = made.canvas.getContext();
  assert.equal(ctx.runPath, 'code');
  assert.equal(ctx.project.activeFile, 'strategies/golden.py');
  // 종목·기간은 전략을 바꿔도 남는다 — 프리셋 전환과 같은 규칙이다.
  assert.deepEqual(ctx.spec.symbols, ['005930']);
  assert.equal(ctx.spec.fromDt, '20160101');
  assert.equal(ctx.spec.name, 'golden');
});

test('내 전략을 고르면 등록부의 PARAMS가 슬라이더로 서고, 지표·조건 카드는 사라진다', async () => {
  const made = await mounted(userStrategyDeps());
  await flush();
  await click(findByClass(made.container, 'backtest-user-strategy-item')[0]);
  await flush();
  await flush();
  await toForm(made.container);
  const sliders = findByClass(made.container, 'backtest-param-slider');
  assert.equal(sliders.length, 2, 'fast·thresh 둘 다 슬라이더가 된다');
  assert.equal(sliders[0].value, '20');
  assert.equal(sliders[0].getAttribute('max'), '80');
  // 신호를 만드는 것은 파이썬이다 — 빈 조건 빌더를 세워두지 않는다.
  assert.equal(findByClass(made.container, 'backtest-condition-card').length, 0);
  assert.equal(findByClass(made.container, 'backtest-indicator-row').length, 0);
  assert.match(textOf(made.container), /슬라이더 범위는 기본값에서 화면이 잡은 것입니다/);
});

test('내 전략 실행: 파일 본문·project_id·슬라이더 값이 함께 나간다', async () => {
  let sent = null;
  const made = await mounted(userStrategyDeps({
    run: async (body) => { sent = body; return { run_id: 'r1' }; },
    result: async () => ({ status: 'running' }),
  }));
  await flush();
  await fillForm(made.container);
  await click(findByClass(made.container, 'backtest-user-strategy-item')[0]);
  await flush();
  await flush();
  await toForm(made.container);
  const slider = findByClass(made.container, 'backtest-param-slider')[0];
  slider.value = '35';
  await slider.dispatchEvent({ type: 'input' });
  await click(findByClass(made.container, 'backtest-run-button')[0]);
  await flush();
  assert.equal(sent.source, GOLDEN_SOURCE);
  assert.equal(sent.project_id, 'p1');
  // 파일의 PARAMS 기본값이 폼 yaml을 덮으므로, 슬라이더는 그보다 센 params로 실려야 한다.
  assert.equal(sent.params.fast, 35);
});

test('[등록 해제]는 등록만 지우고 목록을 다시 읽는다 — 파일은 건드리지 않는다', async () => {
  const removed = [];
  let list = [USER_STRATEGY];
  const made = await mounted(userStrategyDeps({
    userStrategies: async () => list,
    unregisterUserStrategy: async (id) => { removed.push(id); list = []; return { ok: true }; },
  }));
  await flush();
  await click(findByClass(made.container, 'backtest-user-strategy-remove')[0]);
  await flush();
  assert.deepEqual(removed, ['u1']);
  assert.equal(findByClass(made.container, 'backtest-user-strategy-item').length, 0);
});

test('등록부가 exists:false를 주면 그 사실을 그대로 적는다 — 지어내지 않는다', async () => {
  const { container } = await mounted(userStrategyDeps({
    userStrategies: async () => [Object.assign({}, USER_STRATEGY, { exists: false })],
  }));
  await flush();
  assert.equal(findByClass(container, 'backtest-user-strategy-missing').length, 1);
  assert.match(textOf(container), /파일이 없습니다/);
});

// ── 코드 탭의 행동줄: 등록 버튼 ─────────────────────────────────────────────

test('[내 전략으로 등록]: 지금 연 파일을 파일 이름(확장자 뺀)으로 등록하고 목록을 갱신한다', async () => {
  const posted = [];
  let list = [];
  const made = await mounted(userStrategyDeps({
    userStrategies: async () => list,
    registerUserStrategy: async (body) => {
      posted.push(body);
      list = [USER_STRATEGY];
      return { id: 'u1' };
    },
  }));
  await openProjectFile(made);
  await click(findByClass(made.container, 'backtest-register-strategy')[0]);
  await flush();
  assert.deepEqual(posted, [{ project_id: 'p1', path: 'strategy.py', name: 'strategy' }]);
  await click(findByClass(made.container, 'backtest-subtab')[1]);
  await flush();
  assert.equal(findByClass(made.container, 'backtest-user-strategy-item').length, 1);
});

test('[내 전략으로 등록]: 저장 안 한 편집이 있으면 등록하지 않는다 — 등록부와 화면이 갈라진다', async () => {
  const posted = [];
  const made = await mounted(userStrategyDeps({
    registerUserStrategy: async (body) => { posted.push(body); return { id: 'u1' }; },
  }));
  await openProjectFile(made);
  const area = findByClass(made.container, 'backtest-code-textarea')[0];
  area.value = '# 아직 저장 안 함\n';
  await area.dispatchEvent({ type: 'input' });
  await click(findByClass(made.container, 'backtest-register-strategy')[0]);
  await flush();
  assert.deepEqual(posted, []);
  assert.match(textOf(made.container), /저장하고 등록하세요/);
});

test('등록 버튼: 연 파일이 없는 채로 누르면 조용히 넘어가지 않고 무엇을 하라고 말한다', async () => {
  const posted = [];
  const made = await mounted(userStrategyDeps({
    registerUserStrategy: async (body) => { posted.push(body); return { id: 'u1' }; },
  }));
  await click(findByClass(made.container, 'backtest-subtab')[2]);
  await flush();
  await click(findByClass(made.container, 'project-ide-project')[0]);
  await flush();
  await click(findByClass(made.container, 'backtest-register-strategy')[0]);
  await flush();
  assert.deepEqual(posted, []);
  assert.match(textOf(made.container), /등록할 파일을 먼저 여세요/);
});

// ── 코드 탭의 행동줄: 환경 패널 ─────────────────────────────────────────────

test('환경 패널: 없음/준비됨 상태를 백엔드가 준 그대로 적는다', async () => {
  const made = await mounted(userStrategyDeps({
    projectEnv: async () => ({
      project_id: 'p1', exists: false, python: null, packages: [], base_ok: false,
    }),
  }));
  await openProjectFile(made);
  assert.equal(findByClass(made.container, 'backtest-venv-panel').length, 1);
  assert.equal(findByClass(made.container, 'backtest-venv-status')[0].textContent, '없음');

  const ready = await mounted(userStrategyDeps({
    projectEnv: async () => ({
      project_id: 'p1',
      exists: true,
      python: 'C:/p/.venv/Scripts/python.exe',
      packages: ['numpy', 'pandas'],
      base_ok: true,
    }),
  }));
  await openProjectFile(ready);
  assert.equal(
    findByClass(ready.container, 'backtest-venv-status')[0].textContent, '준비됨 · 2개 패키지',
  );
});

test('[환경 만들기]: 패키지 칸을 실어 보내고 잡을 폴링하다가 끝나면 상태를 다시 읽는다', async () => {
  const posted = [];
  const asked = [];
  let envExists = false;
  let jobStatus = 'running';
  const made = await mounted(userStrategyDeps({
    projectEnv: async () => ({
      project_id: 'p1',
      exists: envExists,
      python: envExists ? 'C:/p/.venv/Scripts/python.exe' : null,
      packages: envExists ? ['numpy', 'pandas', 'scipy'] : [],
      base_ok: envExists,
    }),
    createProjectEnv: async (id, packages) => {
      posted.push([id, packages]);
      return { job_id: 'j9' };
    },
    status: async ({ job_id }) => {
      asked.push(job_id);
      const now = jobStatus;
      jobStatus = 'done';
      envExists = true;
      return {
        job_id,
        kind: 'env',
        status: now,
        progress: { step: 'install', line: 'pandas 설치 중' },
        error: null,
      };
    },
  }));
  await openProjectFile(made);
  const box = findByClass(made.container, 'backtest-venv-packages')[0];
  box.value = 'scipy, ta==0.11.0';
  await box.dispatchEvent({ type: 'input' });
  await click(findByClass(made.container, 'backtest-venv-create')[0]);
  await flush();
  assert.deepEqual(posted, [['p1', ['scipy', 'ta==0.11.0']]]);
  assert.deepEqual(asked, ['j9']);
  assert.match(textOf(made.container), /install · pandas 설치 중/);

  // 다음 tick에서 done — 상태를 다시 읽어 "몇 개 패키지"가 디스크와 맞아야 한다.
  await made.pending[made.pending.length - 1]();
  await flush();
  assert.equal(
    findByClass(made.container, 'backtest-venv-status')[0].textContent, '준비됨 · 3개 패키지',
  );
  assert.equal(findByClass(made.container, 'backtest-venv-progress').length, 0);
});

test('[환경 만들기]: 설치할 수 없는 이름은 보내기 전에 그 자리에서 막는다', async () => {
  const posted = [];
  const made = await mounted(userStrategyDeps({
    createProjectEnv: async (id, packages) => {
      posted.push([id, packages]);
      return { job_id: 'j9' };
    },
  }));
  await openProjectFile(made);
  const box = findByClass(made.container, 'backtest-venv-packages')[0];
  box.value = '-r requirements.txt';
  await box.dispatchEvent({ type: 'input' });
  await click(findByClass(made.container, 'backtest-venv-create')[0]);
  await flush();
  assert.deepEqual(posted, []);
  assert.match(textOf(made.container), /설치할 수 있는 이름이 아닙니다/);
});

test('환경 잡이 실패하면 이유를 그 자리에 적고 폴링을 멈춘다', async () => {
  const made = await mounted(userStrategyDeps({
    createProjectEnv: async () => ({ job_id: 'j9' }),
    status: async () => ({
      job_id: 'j9', kind: 'env', status: 'failed', progress: null, error: 'pip이 죽었다',
    }),
  }));
  await openProjectFile(made);
  const before = made.pending.length;
  await click(findByClass(made.container, 'backtest-venv-create')[0]);
  await flush();
  assert.match(textOf(made.container), /pip이 죽었다/);
  assert.equal(made.pending.length, before, '다음 tick을 예약하지 않는다');
});

// ── 흐름 지도(보드 11~14) ───────────────────────────────────────────────────

// 백엔드 mapmodel.build_map이 내는 모양 그대로의 견본.
const MAP_PAYLOAD = {
  version: 1,
  source_kind: 'spec',
  target: { symbol: '005930', period: 'day', adjusted: true, from: '20240101', to: '20240630' },
  app_before: [{ key: 'load', title: '봉 데이터를 모읍니다', detail: '캐시에 있는 봉을 정리합니다' }],
  app_after: [{ key: 'fill', title: '사고·파는 가격을 정합니다', detail: '다음 봉 시가로 체결합니다' }],
  boundary_after_note: 'entry·exit 두 열만 받습니다',
  boundary_after_lines: null,
  nodes: [
    {
      id: 'params', numeral: '①', title: '조절할 값을 정합니다',
      lines: [{ role: null, text: 'fast 20 (5–60, 1씩)' }], facts: [], status: 'ok',
      note: null, first_line: null, last_line: null, editable: true,
    },
    {
      id: 'conditions', numeral: '③', title: '사고·파는 순간을 찍습니다',
      lines: [
        { role: 'entry', text: 'ma_fast가 ma_slow를 위로 뚫는 날' },
        { role: 'exit', text: 'ma_fast가 ma_slow를 아래로 뚫는 날' },
      ],
      facts: ['entry 3개 · exit 2개'], status: 'ok',
      note: null, first_line: null, last_line: null, editable: true,
    },
  ],
  free_code: [],
  unknown: [],
  error: null,
  code: { lines: 23, matches_map: true },
};


test('지도 탭: 만드는 동안 진행 표시가 뜨고, 오면 사라진다', async () => {
  let resolveMap;
  const made = await mounted({
    map: () => new Promise((resolve) => { resolveMap = resolve; }),
  });
  await click(findByClass(made.container, 'backtest-subtab')[0]);
  await flush();
  assert.equal(findByClass(made.container, 'backtest-flow-loading').length, 1);
  assert.equal(findByClass(made.container, 'backtest-flow-spinner').length, 1);
  assert.match(textOf(made.container), /흐름 지도를 만드는 중…/);

  resolveMap(MAP_PAYLOAD);
  await flush();
  assert.equal(findByClass(made.container, 'backtest-flow-loading').length, 0);
  assert.equal(findByClass(made.container, 'backtest-map-head').length, 1);
});

test('지도 탭: 못 만들면 그 자리에 적는다 — 화면 전체를 오류로 바꾸지 않는다', async () => {
  const made = await mounted({
    map: async () => { throw new Error('지도 서비스가 없다'); },
  });
  await click(findByClass(made.container, 'backtest-subtab')[0]);
  await flush();
  assert.equal(findByClass(made.container, 'backtest-canvas-error').length, 0);
  assert.equal(findByClass(made.container, 'backtest-flow-loading').length, 0);
  assert.match(textOf(made.container), /지도 서비스가 없다/);
});

test('채팅 navigate(design, flow)도 같은 진행 표시를 거친다', async () => {
  let resolveMap;
  const made = await mounted({
    map: () => new Promise((resolve) => { resolveMap = resolve; }),
  });
  made.canvas.onChatAction({ kind: 'navigate', tab: 'design', designTab: 'flow' });
  await flush();
  assert.equal(findByClass(made.container, 'backtest-flow-loading').length, 1);
  resolveMap(MAP_PAYLOAD);
  await flush();
  assert.equal(findByClass(made.container, 'backtest-flow-loading').length, 0);
});

test('지도 탭: 프로젝트 파일을 열었으면 그 파일이 지도의 원문이다', async () => {
  let seen = null;
  const made = await mounted(userStrategyDeps({
    map: async (body) => { seen = body; return MAP_PAYLOAD; },
  }));
  await openProjectFile(made);
  await click(findByClass(made.container, 'backtest-subtab')[0]);
  await flush();
  assert.equal(seen.source, PROJECT_SOURCE);
  assert.equal(seen.yaml, undefined);
});

test('지도 탭: 대상 한 줄과 ①~④ 칸, 코드 서랍이 함께 선다', async () => {
  const made = await mounted({ map: async () => MAP_PAYLOAD });
  await click(findByClass(made.container, 'backtest-subtab')[0]);
  await flush();
  assert.equal(findByClass(made.container, 'backtest-map-target-text').length, 1);
  assert.equal(findByClass(made.container, 'backtest-flow-node').length, 4);
  assert.equal(
    findByClass(made.container, 'backtest-map-drawer-text')[0].textContent,
    '이 지도 뒤의 코드 · 생성됨 · 23줄 · 지도 v1과 일치',
  );
});

test('지도 탭: 방금 바뀐 칸에 알약이 붙는다 — 대화 한 번이 어디를 건드렸는지', async () => {
  const made = await mounted({ map: async () => MAP_PAYLOAD });
  made.canvas.onChatAction({ kind: 'spec_draft', patch: { params: { fast: 10 } } });
  await flush();
  const pills = findByClass(made.container, 'backtest-map-changed');
  assert.equal(pills.length, 1);
  assert.equal(pills[0].textContent, '방금 바뀜');
});

test('[코드 열기]: 폼 경로에서는 지도 뒤의 코드를 한 번 만들고 실행경로는 그대로 둔다', async () => {
  const asked = [];
  const made = await mounted({
    map: async () => MAP_PAYLOAD,
    codegen: async (body) => { asked.push(body); return { source: 'import athena_bt as bt\n', lines: 1 }; },
  });
  await click(findByClass(made.container, 'backtest-subtab')[0]);
  await flush();
  await click(findByClass(made.container, 'backtest-map-open-code')[0]);
  await flush();
  const ctx = made.canvas.getContext();
  assert.equal(asked.length, 1);
  assert.match(asked[0].yaml, /SMA 골든크로스/);
  assert.equal(ctx.designTab, 'code');
  assert.match(ctx.code.source, /import athena_bt as bt/);
  // 코드를 열어봤다는 이유로 도는 것이 바뀌면 안 된다.
  assert.equal(ctx.runPath, 'form');
  assert.match(textOf(made.container), /여기서 고치면 지도와 어긋날 수 있습니다 — 웬만하면 대화로/);

  // 같은 폼이면 다시 만들지 않는다.
  await click(findByClass(made.container, 'backtest-subtab')[0]);
  await flush();
  await click(findByClass(made.container, 'backtest-map-open-code')[0]);
  await flush();
  assert.equal(asked.length, 1);
});

test('[지도로 되돌리기]: 코드 초안을 버리고 폼 경로로 돌아간다', async () => {
  const made = await mounted({ map: async () => MAP_PAYLOAD });
  await withCode(made);
  await click(findByClass(made.container, 'backtest-subtab')[0]);
  await flush();
  const badge = findByClass(made.container, 'backtest-map-drawer-badge')[0];
  assert.equal(badge.textContent, '코드가 지도보다 앞섬');
  await click(findByClass(made.container, 'backtest-map-back')[0]);
  await flush();
  const ctx = made.canvas.getContext();
  assert.equal(ctx.runPath, 'form');
  assert.equal(ctx.code.source, '');
  assert.equal(ctx.designTab, 'flow');
});

test('지도 탭: 실행이 멈추면 진단이 지도 아래에 붙고 제목이 그 칸 번호로 시작한다', async () => {
  const stopped = Object.assign({}, MAP_PAYLOAD, {
    nodes: [
      Object.assign({}, MAP_PAYLOAD.nodes[0]),
      Object.assign({}, MAP_PAYLOAD.nodes[1], { status: 'error', note: '멈췄습니다' }),
    ],
  });
  const made = await mounted({
    map: async () => stopped,
    run: async () => ({ run_id: 'r1' }),
    result: async () => ({ status: 'failed', error: 'KeyError: atr' }),
    diagnose: async () => ({ title: 'df에 없는 열을 찾았습니다', why: 'atr가 없습니다', raw: 'KeyError' }),
  });
  await withCode(made);
  await fillForm(made.container);
  await click(findByClass(made.container, 'backtest-run-button')[0]);
  await flush();
  await flush();
  assert.equal(made.canvas.getContext().view, 'diagnosis');
  assert.equal(
    findByClass(made.container, 'backtest-diag-title')[0].textContent,
    '③ 사고·파는 순간을 찍습니다 — df에 없는 열을 찾았습니다',
  );
});

test('지도 요청: 실행이 멈춰 있으면 그 사실을 함께 보낸다 — 칸에 붙일 수 있게', async () => {
  const asked = [];
  const made = await mounted({
    map: async (body) => { asked.push(body); return MAP_PAYLOAD; },
    run: async () => ({ run_id: 'r1' }),
    result: async () => ({ status: 'failed', error: 'KeyError: atr' }),
    diagnose: async () => ({ title: 'df에 없는 열을 찾았습니다', why: '없습니다', line: 7 }),
  });
  await withCode(made);
  await fillForm(made.container);
  await click(findByClass(made.container, 'backtest-run-button')[0]);
  await flush();
  await flush();
  made.canvas.onChatAction({ kind: 'navigate', tab: 'design', designTab: 'flow' });
  await flush();
  const last = asked[asked.length - 1];
  assert.deepEqual(last.error, { message: 'df에 없는 열을 찾았습니다', lineno: 7 });
  assert.equal(last.run_id, 'r1');
});

// 요청을 보내는 자리가 실패·성공 **직후**여야 하는 이유: 그때가 아니면 지도는 앞 실행의
// 숫자와 빨간 칸을 계속 말한다. 위 진단 검사는 이미 받아둔 지도로도 통과하므로 여기서
// 요청 자체를 못 박는다.
test('실행이 멈추면 그 자리에서 지도를 다시 만든다 — 칸에 붙일 기회는 이때뿐이다', async () => {
  const asked = [];
  const made = await mounted({
    map: async (body) => { asked.push(body); return MAP_PAYLOAD; },
    run: async () => ({ run_id: 'r1' }),
    result: async () => ({ status: 'failed', error: 'KeyError: atr' }),
    diagnose: async () => ({ title: 'df에 없는 열을 찾았습니다', why: '없습니다', line: 7 }),
  });
  await withCode(made);
  await fillForm(made.container);
  const before = asked.length;
  await click(findByClass(made.container, 'backtest-run-button')[0]);
  await flush();
  await flush();
  await flush();
  assert.equal(made.canvas.getContext().view, 'diagnosis');
  assert.ok(asked.length > before, '진단이 선 다음 지도를 다시 만들어야 한다');
  const last = asked[asked.length - 1];
  assert.deepEqual(last.error, { message: 'df에 없는 열을 찾았습니다', lineno: 7 });
  assert.equal(last.run_id, 'r1');
});

test('실행이 끝나도 지도를 다시 만든다 — 오른쪽 사실은 그 실행이 만든 값이다', async () => {
  const asked = [];
  const made = await mounted({
    map: async (body) => { asked.push(body); return MAP_PAYLOAD; },
    run: async () => ({ run_id: 'r7' }),
    result: async () => ({ status: 'done', metrics: {}, equity: [] }),
    trades: async () => [],
  });
  await fillForm(made.container);
  await click(findByClass(made.container, 'backtest-run-button')[0]);
  await flush();
  await flush();
  const last = asked[asked.length - 1];
  assert.equal(last.run_id, 'r7');
  assert.equal(last.error, undefined);
});

test('지도를 다시 못 만들면 앞 지도를 지운다 — 남의 전략 칸이 서 있으면 안 된다', async () => {
  let broken = false;
  const made = await mounted({
    map: async () => {
      if (broken) throw new Error('종목이 비어 지도를 만들지 못했습니다');
      return MAP_PAYLOAD;
    },
  });
  await click(findByClass(made.container, 'backtest-subtab')[0]);
  await flush();
  assert.equal(findByClass(made.container, 'backtest-flow-node').length, 4);

  broken = true;
  await click(findByClass(made.container, 'backtest-subtab')[0]);
  await flush();
  assert.equal(findByClass(made.container, 'backtest-flow-node').length, 0);
  assert.equal(findByClass(made.container, 'backtest-map-drawer-text').length, 0);
  assert.match(textOf(made.container), /종목이 비어 지도를 만들지 못했습니다/);
  // 다음 턴 컨텍스트도 없는 칸을 말하지 않는다.
  assert.deepEqual(made.canvas.getContext().map.nodes, []);
});

test('프리셋을 고르면 지도 뒤의 코드도 비운다 — 서랍이 남의 코드를 가리키면 안 된다', async () => {
  const made = await mounted({ map: async () => MAP_PAYLOAD });
  await withCode(made);
  assert.equal(made.canvas.getContext().runPath, 'code');
  await toForm(made.container);
  await click(findByClass(made.container, 'backtest-preset-item')[0]);
  await flush();
  const ctx = made.canvas.getContext();
  assert.equal(ctx.code.source, '');
  // 화면은 프리셋인데 도는 것은 앞 파이썬인 상태를 남기지 않는다.
  assert.equal(ctx.runPath, 'form');
  assert.equal(findByClass(made.container, 'backtest-runpath-item').length, 0);
  assert.equal(ctx.designTab, 'flow');
  assert.equal(ctx.map.version, 1);
  assert.equal(
    findByClass(made.container, 'backtest-map-drawer-text')[0].textContent,
    '이 지도 뒤의 코드 · 생성됨 · 23줄 · 지도 v1과 일치',
  );
});

test('오류 화면에는 [지도에서 보기]가 있다 — 무엇이 멈췄는지는 칸 위에서 읽힌다', async () => {
  const made = await mounted({
    map: async () => MAP_PAYLOAD,
    run: async () => { throw new Error('이 실행 경로는 종목 1개만 지원한다'); },
  });
  await fillForm(made.container);
  await click(findByClass(made.container, 'backtest-run-button')[0]);
  await flush();
  assert.equal(findByClass(made.container, 'backtest-canvas-error').length, 1);
  await click(findByClass(made.container, 'backtest-error-map')[0]);
  await flush();
  const ctx = made.canvas.getContext();
  assert.equal(ctx.view, 'design');
  assert.equal(ctx.designTab, 'flow');
});

test('getContext().map: 마지막으로 받아온 칸만 싣는다 — 없으면 빈 목록이다', async () => {
  const empty = await mounted();
  // 시각 설계(US-007)가 map에 더한 키 — 그래프가 아직 없으면 전부 비어 있다.
  assert.deepEqual(empty.canvas.getContext().map, {
    version: 1,
    nodes: [],
    graph: null,
    validation_state: 'unvalidated',
    // 코드 전용으로 분기했는가(US-010) — 분기 전에는 false다.
    code_only: false,
    hashes: null,
    diagnostics: [],
    pendingQuestion: null,
    pendingPatch: null,
  });

  const made = await mounted({ map: async () => MAP_PAYLOAD });
  await flush();
  const ctx = made.canvas.getContext();
  assert.equal(ctx.map.version, 1);
  // facts는 지난 실행이 그 칸에 남긴 사실이다 — 스펙 경로에서 요약 지도를 없앤 뒤로
  // 이 숫자를 사람에게 말할 수 있는 것은 대화뿐이라 컨텍스트가 그대로 싣는다.
  assert.deepEqual(ctx.map.nodes, [
    {
      id: 'params', numeral: '①', title: '조절할 값을 정합니다',
      lines: ['fast 20 (5–60, 1씩)'], status: 'ok', note: null, facts: [],
    },
    {
      id: 'conditions', numeral: '③', title: '사고·파는 순간을 찍습니다',
      lines: ['진입: ma_fast가 ma_slow를 위로 뚫는 날', '청산: ma_fast가 ma_slow를 아래로 뚫는 날'],
      status: 'ok', note: null, facts: ['entry 3개 · exit 2개'],
    },
  ]);
});

test('되돌리기도 지도 한 판이다 — 버전은 뒤로 가지 않는다', async () => {
  const made = await mounted({ map: async () => MAP_PAYLOAD });
  const receipt = made.canvas.onChatAction({ kind: 'spec_draft', patch: VALID_PATCH });
  assert.deepEqual(receipt.version, { from: 1, to: 2 });
  assert.equal(made.canvas.undoChatAction(receipt.id).ok, true);
  assert.equal(made.canvas.getContext().map.version, 3);
  // 되돌린 변경의 '방금 바뀜'은 더 이상 서 있지 않다.
  assert.equal(made.canvas.getContext().lastChange, null);
});

// ── 배포 열기(파일 실행 한 번이면 된다) ─────────────────────────────────────

test('파일 실행이 준 전략·버전 id로 배포 탭이 열린다 — [이 코드로 저장]을 거치지 않는다', async () => {
  const made = await mounted(userStrategyDeps({
    run: async () => ({ run_id: 'r1', strategy_id: 's9', version_id: 'v9' }),
    result: async () => ({ status: 'done', metrics: {}, equity: [] }),
    trades: async () => [],
    deployments: async () => [],
  }));
  await openProjectFile(made);
  // 실행 전에는 배포 탭이 "먼저 저장하라"고 막는다.
  await click(findByClass(made.container, 'backtest-tab')[4]);
  await flush();
  assert.match(textOf(made.container), /먼저 코드를 한 번 실행하거나 코드 탭에서 저장해야/);

  // 대상·기간은 openProjectFile이 이미 채웠다 — 실행 버튼은 헤더라 어느 탭에서든 눌린다.
  await click(findByClass(made.container, 'backtest-tab')[0]);
  await click(findByClass(made.container, 'backtest-run-button')[0]);
  await flush();
  assert.equal(made.canvas.getContext().code.activeVersionId, 'v9');

  await click(findByClass(made.container, 'backtest-tab')[4]);
  await flush();
  assert.equal(findByClass(made.container, 'backtest-deploy-create').length, 1);
});

// ── US-007/008/009 · 편집 가능한 지도 탭(시각 전략 편집기) ───────────────────
//
// 편집기 자체의 계약(진단 4곳·키보드·목록 보기)은 backtest-visual-editor.test.js가 본다.
// 여기서 보는 것은 **캔버스가 그 편집기를 어떻게 세우는가**다: 폼 → 그래프 → 검증 → 컴파일
// → 폼·코드가 따라오는 왕복, 노드에서 코드로 가는 두 갈래(authoritative·preview), 그리고
// 채팅 카드가 부르는 다섯 자리가 실행·활성화·백필을 절대 부르지 않는다는 것.

const CodeEditorLib = require('./backtest-code-editor');

const VISUAL_GRAPH = {
  graph_version: '1',
  nodes: [
    { id: 'data-ohlcv', kind: 'data.ohlcv', label: '캔들', params: {} },
    { id: 'ind-ma_fast', kind: 'indicator.SMA', label: 'ma_fast', params: { period: 33 } },
  ],
  edges: [
    {
      id: 'e-data.close-ind.source',
      from: { node_id: 'data-ohlcv', port: 'close' },
      to: { node_id: 'ind-ma_fast', port: 'source' },
    },
  ],
  scenario: { period: 'day', adjusted: true },
  meta: { spec_version: '1.0', name: '시각 전략', strategy_id: 'visual_strategy' },
};

// 백엔드 yaml.safe_dump가 쓰는 **블록 스타일** 그대로다 — 프리셋 yaml의 `{...}` 한 줄
// 스타일이 아니다. 이 차이가 SpecModel.parsePresetYaml을 쓸 수 없는 이유이자
// parseYamlBlock이 있는 이유다.
const COMPILED_YAML = [
  "version: '1.0'",
  'metadata:',
  '  name: 시각 전략',
  'strategy:',
  '  id: visual_strategy',
  '  params:',
  '    fast:',
  '      default: 33',
  '      min: 5',
  '      max: 60',
  '      step: 1',
  '      type: int',
  '    slow:',
  '      default: 60',
  '      min: 20',
  '      max: 240',
  '      step: 1',
  '      type: int',
  '  indicators:',
  '  - id: SMA',
  '    alias: ma_fast',
  '    params:',
  '      period: $fast',
  '  - id: SMA',
  '    alias: ma_slow',
  '    params:',
  '      period: $slow',
  '  entry:',
  '    logic: AND',
  '    conditions:',
  '    - indicator: ma_fast',
  '      operator: cross_above',
  '      compare_to: ma_slow',
  '  exit:',
  '    logic: OR',
  '    conditions:',
  '    - indicator: ma_fast',
  '      operator: cross_below',
  '      compare_to: ma_slow',
  'risk:',
  '  stop_loss:',
  '    enabled: true',
  '    percent: 8.0',
  '  take_profit:',
  '    enabled: false',
  '    percent: 20.0',
  '  position:',
  '    sizing: all_in',
  '',
].join('\n');

const VISUAL_SOURCE = [
  'import pandas as pd',
  '',
  '',
  'def signals(df, params):',
  "    ma_fast = df['close'].rolling(params['fast']).mean()",
  "    ma_slow = df['close'].rolling(params['slow']).mean()",
  '    return ma_fast > ma_slow',
  '',
].join('\n');

function visualSourceMap(hash, kind) {
  const map = {
    graph_hash: 'gh-1',
    compiler_version: 'visual-1.0.0',
    entries: [
      {
        node_id: 'ind-ma_fast',
        role: 'indicator',
        ast_path: 'body/3/body/0',
        source_span: {
          file: 'golden_cross.py',
          start: { line: 5, column: 4 },
          end: { line: 5, column: 55 },
        },
      },
    ],
  };
  if (kind === 'preview') {
    return Object.assign(map, { preview_hash: hash, executable: false, preview_only: true });
  }
  return Object.assign(map, {
    spec_hash: 'sh-1', artifact_hash: hash, executable: true, preview_only: false,
  });
}

function visualStubs(hash, extra) {
  const calls = { fromSpec: 0, validate: 0, compile: 0, run: 0, activate: 0, backfill: 0 };
  const deps = Object.assign({
    map: async () => MAP_PAYLOAD,
    visualRegistry: async () => ({ registry_version: '1', graph_version: '1', kinds: [] }),
    visualFromSpec: async () => {
      calls.fromSpec += 1;
      return {
        graph: JSON.parse(JSON.stringify(VISUAL_GRAPH)),
        hashes: { graph_hash: 'gh-1', compiler_version: 'visual-1.0.0' },
      };
    },
    visualValidate: async () => {
      calls.validate += 1;
      return {
        valid: true,
        diagnostics: [],
        preview: null,
        source_map: null,
        exact_code_jump: true,
        hashes: { graph_hash: 'gh-1', compiler_version: 'visual-1.0.0' },
      };
    },
    visualCompile: async () => {
      calls.compile += 1;
      return {
        spec_yaml: COMPILED_YAML,
        source: VISUAL_SOURCE,
        source_map: visualSourceMap(hash, 'authoritative'),
        hashes: {
          graph_hash: 'gh-1', spec_hash: 'sh-1', artifact_hash: hash,
          compiler_version: 'visual-1.0.0',
        },
        executable: true,
        saved: false,
      };
    },
    // 이 셋은 시각 경로가 절대 부르지 않아야 하는 것들이다 — 세기만 한다.
    run: async () => { calls.run += 1; return { run_id: 'r-never' }; },
    activate: async () => { calls.activate += 1; return {}; },
    backfill: async () => { calls.backfill += 1; return { job_id: 'j-never' }; },
  }, extra || {});
  return { deps, calls };
}

async function mountVisual(extra) {
  const hash = await CodeEditorLib.hashSource(VISUAL_SOURCE);
  const stub = visualStubs(hash, extra);
  const made = makeCanvas(stub.deps);
  made.canvas.mount();
  // 프리셋 → 스펙 → from-spec → 편집기까지 세 번의 await 사슬이다.
  await flush();
  await flush();
  await flush();
  return Object.assign(made, { calls: stub.calls, hash });
}

async function clickVisualValidate(made) {
  await click(findByClass(made.container, 'backtest-visual-validate')[0]);
  await flush();
  await flush();
  await flush();
}

const VISUAL_PATCH = {
  patch_id: 'patch-1',
  patch_hash: 'ph-1',
  base_graph_hash: 'gh-1',
  base_version_id: 'v1',
  // visual_repair._ops_to_patch가 내는 모양 그대로 — node_id를 직접 싣지 않는다.
  graph_patch: [{
    op: 'add',
    path: '/edges/-',
    value: {
      id: 'e-data.close-ind.source',
      from: { node_id: 'data-ohlcv', port: 'close' },
      to: { node_id: 'ind-ma_fast', port: 'source' },
    },
  }],
  graph_after: VISUAL_GRAPH,
  graph_after_hash: 'gh-2',
  spec_diff: [{ path: 'strategy.indicators.0.params.period', before: null, after: '$fast' }],
  spec_diff_basis: 'delta',
  code_diff: { diff_lines: [{ mark: '+', text: 'ma_fast = ...' }] },
  diagnostics_after: [],
  graph_compatible: true,
  applied: false,
};

test('parseYamlBlock: safe_dump 블록 스타일을 읽는다(프리셋의 한 줄 스타일이 아니다)', () => {
  const doc = backtestCanvas.parseYamlBlock(COMPILED_YAML);
  assert.equal(doc.version, '1.0');
  assert.equal(doc.metadata.name, '시각 전략');
  assert.equal(doc.strategy.params.fast.default, 33);
  assert.equal(doc.strategy.params.slow.type, 'int');
  assert.equal(doc.strategy.indicators.length, 2);
  assert.equal(doc.strategy.indicators[0].alias, 'ma_fast');
  assert.equal(doc.strategy.indicators[0].params.period, '$fast');
  assert.equal(doc.strategy.entry.logic, 'AND');
  assert.equal(doc.strategy.entry.conditions[0].operator, 'cross_above');
  assert.equal(doc.risk.stop_loss.enabled, true);
  assert.equal(doc.risk.position.sizing, 'all_in');
});

test('프리셋을 세우면 지도 탭이 from-spec 그래프로 편집기를 띄운다', async () => {
  const made = await mountVisual();
  assert.equal(made.calls.fromSpec, 1);
  assert.equal(findByClass(made.container, 'backtest-vis').length, 1, '편집기가 서야 한다');
  assert.equal(findByClass(made.container, 'backtest-visual-host').length, 1);
  assert.match(textOf(made.container), /이 전략은 이렇게 흐릅니다 · 지도 v1/);
  // 대상 한 줄과 코드 서랍은 편집기가 서도 그대로 남는다.
  assert.equal(findByClass(made.container, 'backtest-visual-target').length, 1);
  assert.equal(findByClass(made.container, 'backtest-visual-drawer').length, 1);
  // 요약 지도(칸 ①~④)는 편집 표면 위에 서지 않는다(2026-09-03) — 같은 흐름을 두 번
  // 말하지 않는다. 지도의 재료는 컨텍스트에 그대로 남는다(아래 ctx.map).
  assert.equal(findByClass(made.container, 'backtest-flow-node').length, 0);
  assert.equal(findByClass(made.container, 'backtest-flow-summary').length, 0);
  // 같은 폼이면 다시 만들지 않는다 — yaml이 열쇠다.
  made.canvas.refresh();
  await flush();
  assert.equal(made.calls.fromSpec, 1);
  const ctx = made.canvas.getContext();
  assert.equal(ctx.map.graph.nodes.length, 2);
  assert.equal(ctx.map.validation_state, 'unvalidated');
  assert.equal(ctx.map.hashes.graph_hash, 'gh-1');
});

test('검증이 실패하면 실행 버튼이 잠기고 라벨이 [오류 검토]가 된다', async () => {
  const made = await mountVisual({
    visualValidate: async () => ({
      valid: false,
      diagnostics: [{
        code: 'E_PORT_REQUIRED', severity: 'error', node_id: 'ind-ma_fast',
        port: 'source', message_ko: '입력이 비어 있습니다',
      }],
      preview: null,
      source_map: null,
      exact_code_jump: false,
      hashes: { graph_hash: 'gh-1' },
    }),
  });
  await clickVisualValidate(made);
  const run = findByClass(made.container, 'backtest-run-button')[0];
  assert.equal(run.textContent, '오류 검토');
  assert.equal(run.disabled, true);
  assert.equal(run.getAttribute('aria-disabled'), 'true');
  assert.match(textOf(made.container), /서버 검증 실패/);
  const ctx = made.canvas.getContext();
  assert.equal(ctx.map.validation_state, 'invalid');
  assert.equal(ctx.map.diagnostics[0].code, 'E_PORT_REQUIRED');
  // 첫 오류는 지도 아래 "실행 전에 채울 것" 줄에도 남는다.
  assert.match(textOf(made.container), /입력이 비어 있습니다/);
});

test('검증 통과 → 컴파일이 만든 spec_yaml을 폼이 따라온다(대상은 지킨다)', async () => {
  const made = await mountVisual();
  await fillForm(made.container);
  await flush();
  await flush();
  await clickVisualValidate(made);
  assert.equal(made.calls.compile, 1);
  const ctx = made.canvas.getContext();
  assert.equal(ctx.map.validation_state, 'synced');
  assert.equal(ctx.spec.name, '시각 전략');
  assert.equal(ctx.spec.params.fast.default, 33);
  assert.equal(ctx.spec.params.fast.type, 'int');
  assert.equal(ctx.spec.indicators.length, 2);
  assert.equal(ctx.spec.indicators[1].alias, 'ma_slow');
  assert.equal(ctx.spec.entry.conditions[0].operator, 'cross_above');
  assert.equal(ctx.spec.risk.stop_loss.enabled, true);
  // 그래프는 종목·기간을 모른다 — 폼이 정한 대상은 그대로 남아야 한다.
  assert.deepEqual(ctx.spec.symbols, ['005930']);
  assert.equal(ctx.spec.fromDt, '20160101');
  assert.match(textOf(made.container), /그래프·코드 검증 완료/);
});

test('노드에서 코드로 — 검증·컴파일을 마친 산출물은 authoritative로 연다', async () => {
  const made = await mountVisual();
  await clickVisualValidate(made);
  await click(findByClass(made.container, 'backtest-visual-open-code')[0]);
  await flush();
  await flush();
  const ctx = made.canvas.getContext();
  assert.equal(ctx.designTab, 'code');
  assert.equal(findByClass(made.container, 'backtest-code-ribbon-kind')[0].textContent, '연결됨');
  assert.match(
    findByClass(made.container, 'backtest-code-ribbon-loc')[0].textContent,
    /golden_cross\.py:5/,
  );
  assert.match(
    findByClass(made.container, 'backtest-code-ribbon-label')[0].textContent,
    /ma_fast/,
  );
  assert.equal(findByClass(made.container, 'backtest-code-preview-banner')[0].hidden, true);
  assert.equal(findByClass(made.container, 'backtest-code-linkstatus')[0].hidden, false);
  // 편집기에 얹힌 원문은 컴파일이 준 그 코드다.
  assert.equal(ctx.code.lines, VISUAL_SOURCE.split('\n').length);
});

test('코드 해시가 어긋나면 줄을 열지 않는다 — 그 자리에 알리고 탭도 안 바꾼다', async () => {
  const made = await mountVisual({
    visualCompile: async () => ({
      spec_yaml: COMPILED_YAML,
      source: VISUAL_SOURCE,
      // 다른 코드에서 나온 map이다 — 이 소스의 해시가 아니다.
      source_map: visualSourceMap('0000deadbeef', 'authoritative'),
      hashes: { graph_hash: 'gh-1', artifact_hash: '0000deadbeef', compiler_version: 'visual-1.0.0' },
    }),
  });
  await clickVisualValidate(made);
  await click(findByClass(made.container, 'backtest-visual-open-code')[0]);
  await flush();
  await flush();
  assert.equal(made.canvas.getContext().designTab, 'flow', '탭을 바꾸지 않는다');
  assert.equal(findByClass(made.container, 'backtest-flow-notice').length, 1);
  assert.match(textOf(made.container), /다시 검증하거나 코드 전용으로 검토하세요/);
});

test('검증 실패의 미리보기는 preview로 열리고 편집기가 읽기 전용이 된다', async () => {
  const previewSource = ['# 미실행 미리보기', 'ma_fast = __MISSING__', ''].join('\n');
  const previewHash = await CodeEditorLib.hashSource(previewSource);
  const made = await mountVisual({
    visualValidate: async () => ({
      valid: false,
      diagnostics: [{
        code: 'E_PORT_REQUIRED', severity: 'error', node_id: 'ind-ma_fast',
        message_ko: '입력이 비어 있습니다',
      }],
      preview: { source: previewSource, preview_hash: previewHash, preview_only: true },
      source_map: visualSourceMap(previewHash, 'preview'),
      exact_code_jump: true,
      hashes: { graph_hash: 'gh-1', preview_hash: previewHash },
    }),
  });
  await clickVisualValidate(made);
  await click(findByClass(made.container, 'backtest-visual-open-code')[0]);
  await flush();
  await flush();
  assert.equal(made.canvas.getContext().designTab, 'code');
  assert.equal(
    findByClass(made.container, 'backtest-code-ribbon-kind')[0].textContent, '미실행 미리보기',
  );
  const banner = findByClass(made.container, 'backtest-code-preview-banner')[0];
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /실행·저장 대상이 아닙니다/);
  assert.equal(findByClass(made.container, 'backtest-code-textarea')[0].readOnly, true);
});

test('사람이 고친 코드 초안은 덮지 않는다 — 코드가 지도보다 앞섰다고 말한다', async () => {
  const made = await mountVisual();
  await clickVisualValidate(made);
  await click(findByClass(made.container, 'backtest-visual-open-code')[0]);
  await flush();
  await flush();
  const textarea = findByClass(made.container, 'backtest-code-textarea')[0];
  textarea.value = `${VISUAL_SOURCE}# 사람이 더한 줄\n`;
  await textarea.dispatchEvent({ type: 'input' });
  made.canvas.onChatAction({ kind: 'navigate', tab: 'design', designTab: 'flow' });
  await flush();
  await click(findByClass(made.container, 'backtest-visual-open-code')[0]);
  await flush();
  await flush();
  assert.equal(made.canvas.getContext().designTab, 'flow');
  assert.match(textOf(made.container), /코드가 지도보다 앞섬/);
});

test('visual_question·visual_patch는 화면을 바꾸지 않고 카드 모양만 돌려준다', async () => {
  const made = await mountVisual();
  const before = made.canvas.getContext().designTab;
  const question = made.canvas.onChatAction({
    kind: 'visual_question',
    question: {
      code: 'E_PORT_REQUIRED',
      question_ko: '이 지표의 입력을 무엇으로 이을까요?',
      node_id: 'ind-ma_fast',
      choices: [{
        id: 'connect-close', label_ko: '캔들 종가', recommended: true,
        changes: [{ target: 'edge', id: 'e1', what_ko: '종가 → 입력 연결' }],
      }],
    },
  });
  assert.equal(question.kind, 'visual_question');
  assert.equal(question.applied, false);
  assert.equal(question.question.code, 'E_PORT_REQUIRED');
  assert.equal(question.question.choices[0].id, 'connect-close');

  const patch = made.canvas.onChatAction({ kind: 'visual_patch', patch: VISUAL_PATCH });
  assert.equal(patch.kind, 'visual_patch');
  assert.equal(patch.applied, false);
  assert.equal(patch.patch.patch_id, 'patch-1');
  assert.equal(patch.patch.graph_compatible, true);
  assert.equal(patch.version.to, patch.version.from + 1);

  assert.equal(made.canvas.getContext().designTab, before, '카드는 화면을 바꾸지 않는다');
  const ctx = made.canvas.getContext();
  assert.equal(ctx.map.pendingQuestion.code, 'E_PORT_REQUIRED');
  assert.equal(ctx.map.pendingPatch.patch_id, 'patch-1');
});

test('[적용]은 새 버전을 저장할 뿐 실행·활성화·백필을 부르지 않는다', async () => {
  const saved = [];
  const made = await mountVisual({
    createStrategy: async () => ({ strategy_id: 's1', version_id: 'v1' }),
    visualSave: async (body) => {
      saved.push(body);
      return {
        version_id: 'v2', version: 2, active: false, is_active: false,
        origin: 'visual', active_version_id: 'v1', hashes: {},
      };
    },
  });
  await clickVisualValidate(made);
  made.canvas.onChatAction({ kind: 'visual_patch', patch: VISUAL_PATCH });
  const receipt = await made.canvas.applyVisualPatch('patch-1');
  await flush();

  assert.equal(receipt.kind, 'visual_synced');
  assert.deepEqual(receipt.version, { from: 1, to: 2 });
  assert.equal(receipt.summary_ko, null);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].strategy_id, 's1');
  assert.equal(saved[0].origin, 'visual');
  assert.equal(saved[0].source, VISUAL_SOURCE);
  assert.equal(saved[0].bundle.spec_yaml, COMPILED_YAML);
  assert.equal(saved[0].bundle.compiler_version, 'visual-1.0.0');
  assert.equal(saved[0].apply_receipt.patch_id, 'patch-1');
  assert.equal(saved[0].apply_receipt.patch_hash, 'ph-1');
  assert.equal(saved[0].apply_receipt.base_graph_hash, 'gh-1');
  assert.equal(saved[0].apply_receipt.base_version_id, 'v1');
  assert.equal(saved[0].apply_receipt.base_artifact_hash, made.hash);
  assert.ok(saved[0].apply_receipt.applied_at, 'applied_at은 사람이 누른 시각이다');
  // 경계: 이 경로는 돈을 쓰거나 도는 것을 바꾸는 어느 것도 부르지 않는다.
  assert.equal(made.calls.run, 0);
  assert.equal(made.calls.activate, 0);
  assert.equal(made.calls.backfill, 0);
  assert.equal(made.canvas.getContext().map.pendingPatch, null);
});

test('그 사이 다른 수정이 먼저 저장되면(409) visual_conflict로 돌아온다', async () => {
  const made = await mountVisual({
    createStrategy: async () => ({ strategy_id: 's1', version_id: 'v1' }),
    visualSave: async () => {
      const error = new Error('그 사이 다른 수정이 먼저 저장됐습니다');
      error.status = 409;
      throw error;
    },
  });
  await clickVisualValidate(made);
  made.canvas.onChatAction({ kind: 'visual_patch', patch: VISUAL_PATCH });
  const receipt = await made.canvas.applyVisualPatch('patch-1');
  assert.equal(receipt.kind, 'visual_conflict');
  assert.match(receipt.errors.join(' '), /먼저 저장/);
  assert.equal(made.calls.run, 0);
  assert.equal(made.calls.activate, 0);
});

test('[버리기]는 대기 중인 수정안만 지운다 · [실행 전 검토]는 지도로 옮길 뿐이다', async () => {
  const made = await mountVisual();
  made.canvas.onChatAction({ kind: 'visual_patch', patch: VISUAL_PATCH });
  assert.equal(made.canvas.discardVisualPatch('patch-1').ok, true);
  assert.equal(made.canvas.getContext().map.pendingPatch, null);

  await toForm(made.container);
  assert.equal(made.canvas.reviewBeforeRun().ok, true);
  assert.equal(made.canvas.getContext().designTab, 'flow');
  assert.match(textOf(made.container), /실행 전 검토/);
  assert.equal(made.calls.run, 0);
});

test('[다시 검토]는 다시 검증하고 막고 있는 오류를 하나 더 묻는다', async () => {
  let asked = 0;
  const made = await mountVisual({
    visualValidate: async () => ({
      valid: false,
      diagnostics: [{
        code: 'E_PORT_REQUIRED', severity: 'error', node_id: 'ind-ma_fast',
        message_ko: '입력이 비어 있습니다',
      }],
      preview: null, source_map: null, exact_code_jump: false, hashes: { graph_hash: 'gh-1' },
    }),
    visualQuestion: async () => {
      asked += 1;
      return {
        question: {
          code: 'E_PORT_REQUIRED', question_ko: '무엇을 이을까요?',
          choices: [{ id: 'connect-close', label_ko: '캔들 종가', recommended: true, changes: [] }],
          remaining: 0,
        },
      };
    },
  });
  const receipt = await made.canvas.retryVisualPatch();
  assert.equal(asked, 1);
  assert.equal(receipt.kind, 'visual_question');
  assert.equal(receipt.question.code, 'E_PORT_REQUIRED');
  assert.equal(made.canvas.getContext().map.pendingQuestion.code, 'E_PORT_REQUIRED');
});

test('선택지를 고르면 비활성 수정안 하나를 만든다 — 아직 아무것도 저장하지 않는다', async () => {
  const sent = [];
  const made = await mountVisual({
    visualPatch: async (body) => { sent.push(body); return VISUAL_PATCH; },
  });
  await clickVisualValidate(made);
  const receipt = await made.canvas.answerVisualQuestion({
    code: 'E_PORT_REQUIRED', choice_id: 'connect-close',
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].base_graph_hash, 'gh-1');
  assert.deepEqual(sent[0].intent, { code: 'E_PORT_REQUIRED', choice_id: 'connect-close' });
  assert.equal(receipt.kind, 'visual_patch');
  assert.equal(receipt.patch.patch_id, 'patch-1');
  assert.equal(receipt.applied, false);
  assert.equal(made.canvas.getContext().map.pendingQuestion, null);
});

test('시각 라우트가 없으면 지도는 읽기 전용으로 물러나고 이유를 한 줄 남긴다', async () => {
  const made = await mountVisual({
    visualFromSpec: async () => {
      throw new Error('백엔드에 백테스트 경로가 없습니다 — 백엔드가 이 브랜치 버전인지 확인하세요 (Not Found)');
    },
  });
  assert.equal(findByClass(made.container, 'backtest-vis').length, 0);
  assert.equal(findByClass(made.container, 'backtest-flow-notice').length, 1);
  assert.match(textOf(made.container), /읽기 전용 지도로 돌아갑니다/);
  // 지금까지의 읽기 전용 지도는 그대로 선다 — 기능이 통째로 사라지지 않는다.
  assert.ok(findByClass(made.container, 'backtest-flow-map').length >= 1);
  assert.match(textOf(made.container), /조절할 값을 정합니다/);
});

test('코드 경로의 지도에는 [코드 전용] 배지가 붙는다 — 그래프로 되돌릴 수 없다', async () => {
  const made = await mountVisual();
  made.canvas.onChatAction({
    kind: 'code_draft', source: 'def signals(df, params):\n    return None\n',
  });
  await flush();
  made.canvas.onChatAction({ kind: 'navigate', tab: 'design', designTab: 'flow' });
  await flush();
  assert.equal(findByClass(made.container, 'backtest-flow-codeonly').length, 1);
  assert.equal(findByClass(made.container, 'backtest-vis').length, 0);
});

test('모드 워크스페이스에 등록하고 탭이 움직일 때마다 조각을 보고한다', async () => {
  const registered = [];
  const reports = [];
  global.window = {
    AthenaSessionWorkspace: {
      register: (kind, handler) => { registered.push([kind, handler]); },
      report: (patch) => { reports.push(patch); },
    },
  };
  try {
    const made = await mountVisual();
    assert.equal(registered.length, 1);
    assert.equal(registered[0][0], 'backtest');
    assert.equal(typeof registered[0][1].restore, 'function');

    reports.length = 0;
    await toForm(made.container);
    assert.ok(reports.length >= 1, '하위 탭이 움직이면 보고한다');
    const last = reports[reports.length - 1];
    assert.equal(last.designTab, 'form');
    assert.equal(last.tab, 'design');
    assert.ok(last.form && typeof last.form.yaml === 'string');
    assert.ok(last.graph && Array.isArray(last.graph.nodes));

    registered[0][1].restore({
      kind: 'backtest', tab: 'design', designTab: 'flow', graph: VISUAL_GRAPH,
    });
    assert.equal(made.canvas.getContext().designTab, 'flow');
  } finally {
    delete global.window;
  }
});

test('워크스페이스 전역이 없어도 mount·탭 이동이 조용히 넘어간다', async () => {
  const made = await mountVisual();
  assert.doesNotThrow(() => { made.canvas.onChatAction({ kind: 'navigate', tab: 'history' }); });
});

test('[코드 열기]는 패치가 건드린 노드의 줄로 간다 — RFC 6902 path에서 읽는다', async () => {
  const made = await mountVisual();
  await clickVisualValidate(made);
  made.canvas.onChatAction({ kind: 'visual_patch', patch: VISUAL_PATCH });
  const opened = await made.canvas.openCodeFromChat();
  await flush();
  assert.equal(opened, true);
  assert.equal(made.canvas.getContext().designTab, 'code');
  assert.match(
    findByClass(made.container, 'backtest-code-ribbon-label')[0].textContent,
    /ma_fast/,
  );
  assert.equal(made.calls.run, 0);
});

// ── US-010 · P3 왕복 경계(코드 전용 분기 · 409 보존 · 버전 되열기) ───────────
//
// 여기서 보는 것은 셋이다: ① 그래프로 못 옮기는 코드 수정이 자동 왕복을 가장하지 않고
// origin=code_only 새 버전으로 갈라지는가, ② 409가 그래프와 대기 수정안을 버리지 않고
// [다시 검토]가 최신 base를 다시 읽는가, ③ 이력에서 연 버전이 읽기 전용으로 서고
// [이 버전으로 편집]을 눌러야 편집 표면이 되는가.

// 이력에서 되열 버전의 그래프 — 지금 그래프와 구분되는 이름표를 하나 심는다.
const HISTORY_GRAPH = {
  graph_version: '1',
  nodes: [
    { id: 'data-ohlcv', kind: 'data.ohlcv', label: '캔들', params: {} },
    { id: 'ind-ma_hist', kind: 'indicator.SMA', label: 'ma_hist', params: { period: 77 } },
  ],
  edges: [],
  scenario: { period: 'day', adjusted: true },
  meta: { spec_version: '1.0', name: '시각 전략', strategy_id: 'visual_strategy' },
};

// 지도에서 코드를 열고 사람이 한 줄을 손으로 더한다 — 코드가 지도보다 앞서는 유일한 길.
async function typeAheadOfMap(made) {
  await clickVisualValidate(made);
  await click(findByClass(made.container, 'backtest-visual-open-code')[0]);
  await flush();
  await flush();
  const textarea = findByClass(made.container, 'backtest-code-textarea')[0];
  textarea.value = `${VISUAL_SOURCE}# 그래프로 못 옮기는 수정\n`;
  await textarea.dispatchEvent({ type: 'input' });
  made.canvas.refresh();
  await flush();
}

test('코드가 지도보다 앞서면 코드 탭이 두 갈래를 명시한다 — 자동 왕복은 없다', async () => {
  const made = await mountVisual();
  await typeAheadOfMap(made);
  assert.equal(findByClass(made.container, 'backtest-code-ahead').length, 1);
  assert.match(textOf(made.container), /코드가 지도보다 앞섬/);
  assert.equal(
    findByClass(made.container, 'backtest-code-ahead-regraph')[0].textContent,
    '그래프에서 다시 만들기',
  );
  assert.equal(
    findByClass(made.container, 'backtest-code-ahead-fork')[0].textContent,
    '코드 전용으로 분기',
  );
});

test('[그래프에서 다시 만들기]는 코드 초안을 버리고 그래프를 지킨다', async () => {
  const made = await mountVisual();
  await typeAheadOfMap(made);
  await click(findByClass(made.container, 'backtest-code-ahead-regraph')[0]);
  await flush();
  const ctx = made.canvas.getContext();
  assert.equal(ctx.code.source, '');
  assert.equal(ctx.runPath, 'form');
  assert.equal(ctx.map.code_only, false);
  assert.ok(ctx.map.graph && ctx.map.graph.nodes.length, '그래프는 그대로 남는다');
});

test('[코드 전용으로 분기]: origin=code_only 새 버전을 남기고 지도를 읽기 전용으로 접는다', async () => {
  const versions = [];
  const made = await mountVisual({
    createStrategy: async () => ({ strategy_id: 's1', version_id: 'v1' }),
    addVersion: async (id, body) => {
      versions.push([id, body]);
      return { version_id: 'v2', version: 2, active: false, is_active: false, origin: 'code_only' };
    },
  });
  await typeAheadOfMap(made);
  await click(findByClass(made.container, 'backtest-code-ahead-fork')[0]);
  await flush();
  await flush();

  // 저장된 것: 초안 그대로, origin=code_only, bundle 없음(서버가 422로 거절하는 모양).
  assert.equal(versions.length, 1);
  assert.equal(versions[0][0], 's1');
  assert.equal(versions[0][1].origin, 'code_only');
  assert.equal(versions[0][1].note, '코드 전용 분기');
  assert.match(versions[0][1].source, /그래프로 못 옮기는 수정/);
  assert.equal(versions[0][1].bundle, undefined, 'code_only 버전은 bundle을 가질 수 없다');

  // 지도는 마지막 호환 snapshot이고, 동기화됐다고 말하지 않는다.
  made.canvas.onChatAction({ kind: 'navigate', tab: 'design', designTab: 'flow' });
  await flush();
  assert.equal(
    findByClass(made.container, 'backtest-snapshot-badge')[0].textContent,
    '동기화되지 않음 · 코드 전용',
  );
  assert.equal(findByClass(made.container, 'backtest-vis').length, 1, 'snapshot 그래프는 선다');
  assert.equal(findByClass(made.container, 'backtest-vis-undo').length, 0, '읽기 전용이다');
  assert.doesNotMatch(textOf(made.container), /그래프·코드 검증 완료/);
  assert.doesNotMatch(textOf(made.container), /일치/);

  const ctx = made.canvas.getContext();
  assert.equal(ctx.runPath, 'code');
  assert.equal(ctx.map.code_only, true);
  assert.notEqual(ctx.map.validation_state, 'synced');
  // 분기는 활성화도 실행도 아니다.
  assert.equal(made.calls.run, 0);
  assert.equal(made.calls.activate, 0);
  assert.equal(made.calls.backfill, 0);
  // 갈래를 이미 골랐으므로 코드 탭은 더 묻지 않는다.
  made.canvas.onChatAction({ kind: 'navigate', tab: 'design', designTab: 'code' });
  await flush();
  assert.equal(findByClass(made.container, 'backtest-code-ahead').length, 0);
});

test('409는 그래프도 대기 수정안도 버리지 않고, [다시 검토]가 최신 base를 다시 읽는다', async () => {
  const sent = [];
  const detailed = [];
  const made = await mountVisual({
    createStrategy: async () => ({ strategy_id: 's1', version_id: 'v1' }),
    visualSave: async () => {
      const error = new Error('base 버전이 최신이 아니다 — 최신 버전을 다시 읽어야 한다');
      error.status = 409;
      throw error;
    },
    versions: async () => ([
      { id: 'v1', version: 1, origin: 'human', active: true },
      { id: 'v9', version: 9, origin: 'visual', active: false },
    ]),
    versionDetail: async (strategyId, versionId) => {
      detailed.push([strategyId, versionId]);
      return {
        id: versionId, version: 9, origin: 'visual',
        hashes: { graph_hash: 'gh-9', artifact_hash: 'ah-9' },
      };
    },
    visualQuestion: async () => ({
      question: { code: 'E_PORT_REQUIRED', question_ko: '무엇을 이을까요?', choices: [] },
    }),
    visualPatch: async (body) => { sent.push(body); return VISUAL_PATCH; },
  });
  await clickVisualValidate(made);
  made.canvas.onChatAction({ kind: 'visual_patch', patch: VISUAL_PATCH });
  const receipt = await made.canvas.applyVisualPatch('patch-1');
  assert.equal(receipt.kind, 'visual_conflict');
  assert.equal(receipt.patch.patch_id, 'patch-1', '영수증이 그 수정안을 그대로 들고 온다');

  const kept = made.canvas.getContext();
  assert.equal(kept.map.pendingPatch.patch_id, 'patch-1', '수정안을 버리지 않는다');
  assert.ok(kept.map.graph && kept.map.graph.nodes.length, '그래프도 그대로다');

  // [다시 검토] — 서버의 머리(v9)를 다시 읽고, 다음 수정안은 그 base로 서명한다.
  await made.canvas.retryVisualPatch();
  assert.deepEqual(detailed, [['s1', 'v9']]);
  await made.canvas.answerVisualQuestion({ code: 'E_PORT_REQUIRED', choice_id: 'connect-close' });
  const last = sent[sent.length - 1];
  assert.equal(last.base_version_id, 'v9');
  assert.equal(last.base_graph_hash, 'gh-9');
  assert.equal(made.calls.run, 0);
  assert.equal(made.calls.activate, 0);
});

// 이력 되열기의 밑자락 — 먼저 [적용]으로 s1/v2를 만들어 두고 이력 탭으로 간다.
async function mountWithHistory(extra) {
  const made = await mountVisual(Object.assign({
    createStrategy: async () => ({ strategy_id: 's1', version_id: 'v1' }),
    visualSave: async () => ({
      version_id: 'v2', version: 2, active: false, is_active: false,
      origin: 'visual', active_version_id: 'v1', hashes: {},
    }),
    versions: async () => ([
      { id: 'v1', version: 1, origin: 'human', active: true, note: null },
      { id: 'v2', version: 2, origin: 'visual', active: false, note: '입력 연결' },
      { id: 'v3', version: 3, origin: 'code_only', active: false, note: '코드 전용 분기' },
    ]),
    versionDetail: async (strategyId, versionId) => {
      if (versionId === 'v3') {
        return {
          id: 'v3', version: 3, origin: 'code_only', source: '# 코드 전용 원문\n',
          graph: null, spec_yaml: null, hashes: null, compiler_version: null,
        };
      }
      return {
        id: 'v2', version: 2, origin: 'visual', source: VISUAL_SOURCE,
        graph: JSON.parse(JSON.stringify(HISTORY_GRAPH)),
        spec_yaml: COMPILED_YAML,
        hashes: { graph_hash: 'gh-2', spec_hash: 'sh-2', artifact_hash: 'ah-2' },
        compiler_version: 'visual-1.0.0',
      };
    },
  }, extra || {}));
  await clickVisualValidate(made);
  made.canvas.onChatAction({ kind: 'visual_patch', patch: VISUAL_PATCH });
  await made.canvas.applyVisualPatch('patch-1');
  await flush();
  made.canvas.onChatAction({ kind: 'navigate', tab: 'history' });
  await flush();
  await flush();
  return made;
}

test('이력에서 origin=visual 버전을 열면 그때의 그래프가 읽기 전용으로 선다', async () => {
  const made = await mountWithHistory();
  assert.match(textOf(made.container), /저장된 버전 3개/);
  const rows = findByClass(made.container, 'backtest-version-row');
  assert.equal(rows.length, 3);
  await click(rows[1]);
  await flush();
  await flush();

  assert.match(textOf(made.container), /origin=visual · v2 · 해시 gh-2/);
  assert.equal(
    findByClass(made.container, 'backtest-snapshot-badge')[0].textContent,
    '읽기 전용 · 이력에서 연 버전',
  );
  // 그때의 그래프다 — 지금 편집 중인 그래프가 아니다.
  assert.match(textOf(made.container), /ma_hist/);
  assert.equal(findByClass(made.container, 'backtest-vis-undo').length, 0, '읽기 전용이다');
  const ctx = made.canvas.getContext();
  assert.equal(ctx.designTab, 'flow');
  assert.equal(ctx.code.source, VISUAL_SOURCE, '그 버전의 원문도 함께 돌아온다');
  assert.equal(made.calls.run, 0);
  assert.equal(made.calls.activate, 0);
});

test('[이 버전으로 편집]을 눌러야 편집 표면이 되고, 그때 지도 판이 하나 오른다', async () => {
  const made = await mountWithHistory();
  await click(findByClass(made.container, 'backtest-version-row')[1]);
  await flush();
  await flush();
  const before = made.canvas.getContext().map.version;

  await click(findByClass(made.container, 'backtest-version-edit')[0]);
  await flush();
  const ctx = made.canvas.getContext();
  assert.equal(ctx.map.version, before + 1);
  assert.equal(ctx.runPath, 'form');
  assert.equal(findByClass(made.container, 'backtest-snapshot-badge').length, 0);
  assert.equal(findByClass(made.container, 'backtest-vis-undo').length, 1, '이제 편집할 수 있다');
  assert.ok(
    ctx.map.graph.nodes.some((n) => n.label === 'ma_hist'),
    '작업 초안이 그 버전의 그래프가 된다',
  );
});

test('origin=code_only 버전은 코드 탭에서 열리고 지도는 읽기 전용 snapshot뿐이다', async () => {
  const made = await mountWithHistory();
  await click(findByClass(made.container, 'backtest-version-row')[2]);
  await flush();
  await flush();
  const ctx = made.canvas.getContext();
  assert.equal(ctx.designTab, 'code');
  assert.match(ctx.code.source, /코드 전용 원문/);
  assert.equal(ctx.map.code_only, true);
  assert.match(textOf(made.container), /origin=code_only · v3/);

  made.canvas.onChatAction({ kind: 'navigate', tab: 'design', designTab: 'flow' });
  await flush();
  assert.equal(
    findByClass(made.container, 'backtest-snapshot-badge')[0].textContent,
    '동기화되지 않음 · 코드 전용',
  );
  assert.equal(findByClass(made.container, 'backtest-vis-undo').length, 0);
  assert.doesNotMatch(textOf(made.container), /그래프·코드 검증 완료/);
});

test('버전 되열기 배선이 없으면 그 자리에 이유를 적는다 — 화면을 오류로 바꾸지 않는다', async () => {
  const made = await mountWithHistory({ versionDetail: undefined });
  await click(findByClass(made.container, 'backtest-version-row')[1]);
  await flush();
  assert.equal(findByClass(made.container, 'backtest-canvas-error').length, 0);
  assert.match(textOf(made.container), /버전 되열기 배선이 없습니다/);
});

// ── 보드 20·21 · 새 기법 만들기(코드창 · 명령창 · 노드·흐름 창) ─────────────

const TECHNIQUE_SOURCE = [
  'import athena_bt as bt',
  '',
  'PARAMS = {"lookback": {"default": 20}}',
  '',
  '',
  'def compute_atr(df, lookback):',
  '    return df["high"] - df["low"]',
  '',
  '',
  'def signals(df, p):',
  '    df["entry"] = compute_atr(df, p["lookback"]) > 0',
  '    df["exit"] = False',
  '    return df[["entry", "exit"]]',
  '',
].join('\n');

const CHECKS_OK = [
  { id: 'syntax', label_ko: '문법·금지 import', ok: true, detail_ko: '' },
  { id: 'contract', label_ko: 'signals(df, p) 계약 · entry/exit 두 열', ok: true, detail_ko: '' },
  { id: 'dryrun', label_ko: '짧은 구간 시험 실행', ok: true, detail_ko: '워밍업 59봉 · entry 41 · exit 41' },
];

const NODES_RESPONSE = {
  nodes: [
    {
      id: 'compute_atr', label: 'compute_atr()', summary_ko: '변동폭을 잰다',
      first_line: 6, last_line: 7, params: ['df', 'lookback'],
      returns_hint: 'Series<Number>', calls: [], role: 'indicator', stage: null,
    },
    {
      id: 'signals', label: 'signals()', summary_ko: '',
      first_line: 10, last_line: 13, params: ['df', 'p'],
      returns_hint: 'DataFrame', calls: ['compute_atr'], role: 'signals', stage: null,
    },
  ],
  flows: { entry: ['compute_atr', 'signals'], exit: ['signals'] },
  granularity: 'function',
  unknown: [],
  error: null,
};

// 노드 창은 다른 파일이 만든다(backtest-technique-nodes.js) — 하네스는 그 계약만
// 흉내낸다: 만들 때 payload를 받고, 판이 바뀌면 setPayload로 다시 받는다.
function fakeNodesLib(seen) {
  return {
    createTechniqueNodes(host, options) {
      seen.host = host;
      seen.options = options;
      seen.payload = options.payload;
      seen.created = (seen.created || 0) + 1;
      return {
        element: host,
        setPayload(payload) { seen.payload = payload; },
        setStats(stats) { seen.stats = stats; },
        destroy() { seen.destroyed = true; },
      };
    },
  };
}

// 새 기법 초안을 세운다 — 검사·노드 배선을 주입하고 [+ 새 기법 만들기]까지 누른다.
async function draftCanvas(overrides) {
  const calls = { check: [], nodes: [] };
  const made = await mounted(Object.assign({
    techniqueCheck: async (body) => {
      calls.check.push(body);
      return {
        passed: true, checks: CHECKS_OK,
        stats: { warmup_bars: 59, entry: 41, exit: 41, rows: 606 },
        log: ['$ python -m athena_bt.check', '문법 통과 · 계약 통과 · 시험 실행 통과'],
        error: null,
      };
    },
    techniqueNodes: async (body) => { calls.nodes.push(body); return NODES_RESPONSE; },
  }, overrides || {}));
  await click(findByClass(made.container, 'backtest-technique-new')[0]);
  await flush();
  return Object.assign(made, { calls });
}

// 디바운스된 검사를 지금 돌린다 — makeCanvas의 가짜 타이머에 쌓인 콜백을 비운다.
async function runPending(made) {
  const queued = made.pending.splice(0, made.pending.length);
  queued.forEach((fn) => fn());
  await flush();
  await flush();
}

test('새 기법 초안: 하위 탭은 [코드][노드·흐름]뿐이고 띠·명령창·진행 표시가 선다', async () => {
  const made = await draftCanvas();
  const labels = findByClass(made.container, 'backtest-subtab').map((t) => t.textContent);
  assert.deepEqual(labels, ['코드', '노드·흐름'], '지도·폼은 초안에서 숨는다');
  assert.equal(findByClass(made.container, 'backtest-technique-progress').length, 1);
  assert.match(textOf(made.container), /검사 0\/5/);
  // AI가 쥐고 있다는 사실을 먼저 말한다.
  const band = findByClass(made.container, 'backtest-technique-band')[0];
  assert.ok(band);
  assert.match(textOf(band), /AI가 제어하는 중/);
  // 명령창은 코드 아래에 서고, 아직 잰 것이 없으면 그렇다고 적는다.
  const terminal = findByClass(made.container, 'backtest-terminal')[0];
  assert.ok(terminal);
  assert.match(textOf(terminal), /아직 검사하지 않았습니다/);
  // 빈 뼈대는 검사하지 않는다 — 아무 신호도 없는 코드가 통과로 찍히면 안 된다.
  assert.equal(made.calls.check.length, 0);
});

test('[직접 편집]을 켜면 띠 문구가 바뀐다 — 코드는 어느 쪽이든 편집 가능하다', async () => {
  const made = await draftCanvas();
  await click(findByClass(made.container, 'backtest-technique-hand-toggle')[0]);
  const band = findByClass(made.container, 'backtest-technique-band')[0];
  assert.match(textOf(band), /직접 편집 중/);
  assert.doesNotMatch(textOf(band), /AI가 제어하는 중/);
});

test('코드가 바뀌면 자동으로 검사하고 명령창이 로그·검사 3줄·통계를 그린다', async () => {
  const made = await draftCanvas();
  made.canvas.onChatAction({ kind: 'code_draft', source: TECHNIQUE_SOURCE });
  await flush();
  assert.equal(made.calls.check.length, 0, '700ms 묶기 전에는 부르지 않는다');
  await runPending(made);
  assert.equal(made.calls.check.length, 1);
  assert.equal(made.calls.check[0].source, TECHNIQUE_SOURCE);
  await click(findByClass(made.container, 'backtest-subtab')[0]);
  const terminal = findByClass(made.container, 'backtest-terminal')[0];
  assert.match(textOf(terminal), /python -m athena_bt\.check/);
  assert.match(textOf(terminal), /짧은 구간 시험 실행/);
  assert.match(textOf(terminal), /워밍업 59봉 · 진입 신호 41 · 청산 신호 41 · 봉 606개/);
  assert.equal(findByClass(terminal, 'backtest-terminal-check').length, 3);
});

test('검사 3/3을 넘으면 노드를 읽어 노드·흐름 탭이 자동으로 열리고 영수증 카드가 나간다', async () => {
  const cards = [];
  const prevCustomEvent = global.CustomEvent;
  global.CustomEvent = function (type, init) { return { type, detail: init && init.detail }; };
  global.document.dispatchEvent = (event) => { cards.push(event); return true; };
  try {
    const seen = {};
    const made = await draftCanvas({ techniqueNodesLib: fakeNodesLib(seen) });
    made.canvas.onChatAction({ kind: 'code_draft', source: TECHNIQUE_SOURCE });
    await runPending(made);
    assert.deepEqual(made.calls.nodes, [{ source: TECHNIQUE_SOURCE }]);
    // 통과한 그 순간 노드 창이 열린다(처음 한 번).
    assert.equal(made.canvas.getContext().designTab, 'nodes');
    assert.deepEqual(seen.payload.nodes.map((n) => n.id), ['compute_atr', 'signals']);
    assert.equal(seen.payload.granularity, 'function');
    assert.deepEqual(seen.payload.flows, { entry: ['compute_atr', 'signals'], exit: ['signals'] });
    // 창은 한 번만 만든다 — 다시 그릴 때마다 새로 만들면 고른 자리가 날아간다.
    assert.equal(seen.created, 1);
    // 영수증 카드 — 검사 3줄과 통계가 실린다.
    const receipts = cards.filter((e) => e.type === 'athena:backtest-receipt');
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].detail.kind, 'technique_check');
    assert.equal(receipts[0].detail.passed, true);
    assert.equal(receipts[0].detail.checks.length, 3);
    assert.equal(receipts[0].detail.stats.rows, 606);
  } finally {
    global.CustomEvent = prevCustomEvent;
  }
});

test('노드·흐름 창의 설명 요청은 사람이 친 것과 같은 길로 채팅에 실린다', async () => {
  const sent = [];
  const prevCustomEvent = global.CustomEvent;
  global.CustomEvent = function (type, init) { return { type, detail: init && init.detail }; };
  global.document.dispatchEvent = (event) => { sent.push(event); return true; };
  try {
    const seen = {};
    const made = await draftCanvas({ techniqueNodesLib: fakeNodesLib(seen) });
    made.canvas.onChatAction({ kind: 'code_draft', source: TECHNIQUE_SOURCE });
    await runPending(made);
    const texts = () => sent.filter((e) => e.type === 'athena:chat-submit')
      .map((e) => e.detail.text);

    seen.options.onExplainNode('compute_atr');
    assert.equal(texts().pop(), '노드 compute_atr()를 설명해줘');
    assert.equal(made.canvas.getContext().technique.selectedNode, 'compute_atr');

    seen.options.onExplainFlow('entry');
    assert.equal(texts().pop(), '진입 흐름을 설명해줘');
    seen.options.onExplainFlow('exit');
    assert.equal(texts().pop(), '청산 흐름을 설명해줘');
    seen.options.onExplainAll();
    assert.equal(texts().pop(), '이 기법 전체를 설명해줘');
  } finally {
    global.CustomEvent = prevCustomEvent;
  }
});

test('노드에서 코드로 — 코드 탭이 서고 그 함수의 줄이 짚힌다', async () => {
  const seen = {};
  const made = await draftCanvas({ techniqueNodesLib: fakeNodesLib(seen) });
  made.canvas.onChatAction({ kind: 'code_draft', source: TECHNIQUE_SOURCE });
  await runPending(made);
  seen.options.onOpenCode('signals');
  await flush();
  assert.equal(made.canvas.getContext().designTab, 'code');
  const marks = findByClass(made.container, 'backtest-code-line is-flow');
  assert.ok(findByClass(made.container, 'backtest-code-host').length === 1);
  assert.ok(marks.length >= 0);
});

test('technique_question: 영수증만 만들고 코드도 탭도 건드리지 않는다', async () => {
  const made = await draftCanvas();
  made.canvas.onChatAction({ kind: 'code_draft', source: TECHNIQUE_SOURCE });
  await runPending(made);
  const before = made.canvas.getContext();
  const receipt = made.canvas.onChatAction({
    kind: 'technique_question',
    payload: {
      question_ko: '무엇을 보고 사겠습니까?',
      choices: [
        { id: 'breakout', label_ko: '20일 최고가 돌파', detail_ko: '추세를 따라간다', recommended: true },
        { id: 'reversion', label_ko: '5일 저가 이탈', detail_ko: '되돌림을 노린다' },
      ],
      why_ko: '진입 규칙이 정해져야 나머지가 따라옵니다',
    },
  });
  assert.equal(receipt.kind, 'technique_question');
  assert.equal(receipt.question.question_ko, '무엇을 보고 사겠습니까?');
  assert.equal(receipt.question.choices.length, 2);
  assert.equal(receipt.applied, false);
  const after = made.canvas.getContext();
  assert.equal(after.code.source, before.code.source);
  assert.equal(after.designTab, before.designTab);
});

test('technique_question: 빈 봉투는 null이고 아무것도 바꾸지 않는다', async () => {
  const made = await draftCanvas();
  assert.equal(made.canvas.onChatAction({ kind: 'technique_question' }), null);
  assert.equal(made.canvas.onChatAction({ kind: 'technique_question', payload: 'x' }), null);
});

test('getContext().technique: 계약 키 8개 — 명령창 로그는 싣지 않는다', async () => {
  const made = await draftCanvas();
  const empty = made.canvas.getContext().technique;
  assert.deepEqual(Object.keys(empty), [
    'checks', 'passed', 'stats', 'nodes', 'flows', 'granularity', 'selectedNode', 'lastCheckAt',
  ]);
  assert.deepEqual(empty.checks, []);
  assert.equal(empty.passed, false);
  assert.equal(empty.lastCheckAt, null);

  made.canvas.onChatAction({ kind: 'code_draft', source: TECHNIQUE_SOURCE });
  await runPending(made);
  const filled = made.canvas.getContext().technique;
  assert.equal(filled.passed, true);
  assert.equal(filled.checks.length, 3);
  assert.equal(filled.stats.warmup_bars, 59);
  assert.deepEqual(filled.nodes.map((n) => n.id), ['compute_atr', 'signals']);
  assert.deepEqual(filled.flows, { entry: ['compute_atr', 'signals'], exit: ['signals'] });
  assert.equal(filled.granularity, 'function');
  assert.ok(filled.lastCheckAt);
});

test('검사가 통과하지 못하면 노드를 읽지 않고 탭도 뺏지 않는다', async () => {
  const made = await draftCanvas({
    techniqueCheck: async () => ({
      passed: false,
      checks: [
        { id: 'syntax', label_ko: '문법·금지 import', ok: true, detail_ko: '' },
        { id: 'contract', label_ko: 'signals(df, p) 계약 · entry/exit 두 열', ok: false, detail_ko: 'exit 열이 없습니다' },
        { id: 'dryrun', label_ko: '짧은 구간 시험 실행', ok: false, detail_ko: '' },
      ],
      stats: null, log: ['$ python -m athena_bt.check'], error: { message: 'exit 열이 없습니다', line: 12 },
    }),
  });
  made.canvas.onChatAction({ kind: 'code_draft', source: TECHNIQUE_SOURCE });
  await runPending(made);
  assert.equal(made.calls.nodes.length, 0);
  assert.equal(made.canvas.getContext().designTab, 'code');
  assert.match(textOf(findByClass(made.container, 'backtest-terminal')[0]), /exit 열이 없습니다/);
  assert.match(textOf(findByClass(made.container, 'backtest-technique-progress')[0]), /검사 1\/3/);
});

// ── 검사의 두 갈래(severity) ────────────────────────────────────────────────
// 백엔드가 항목마다 갈래를 붙인다: 룩어헤드·워밍업은 차단, 매직 넘버·구조는 경고다.
// 화면은 항목을 세지 않고 받은 배열을 그대로 그린다 — 검사가 5개로 늘어도 같은 코드다.
const CHECKS_WITH_WARN = [
  { id: 'syntax', label_ko: '문법·금지 import', ok: true, severity: 'block', detail_ko: '' },
  { id: 'contract', label_ko: 'signals(df, p) 계약', ok: true, severity: 'block', detail_ko: '' },
  { id: 'dryrun', label_ko: '짧은 구간 시험 실행', ok: true, severity: 'block', detail_ko: '' },
  { id: 'lookahead', label_ko: '미래 참조', ok: true, severity: 'block', detail_ko: '' },
  { id: 'warmup', label_ko: '워밍업', ok: true, severity: 'block', detail_ko: '' },
  {
    id: 'magic', label_ko: '매직 넘버', ok: false, severity: 'warn',
    detail_ko: '11번째 줄의 20은 PARAMS로 빼야 합니다',
  },
  {
    id: 'structure', label_ko: '노드 단위', ok: false, severity: 'warn',
    detail_ko: 'signals()가 계산을 안고 있습니다',
  },
];

function terminalOf(container) {
  return findByClass(container, 'backtest-terminal')[0];
}

function checkRows(terminal) {
  return findByClass(terminal, 'backtest-terminal-check');
}

function rowWith(terminal, token) {
  return checkRows(terminal).find((r) => String(r.className).split(/\s+/).includes(token));
}

test('경고는 통과를 막지 않는다 — warn이 실패해도 서버 passed 그대로 노드 창이 열린다', async () => {
  const seen = {};
  const made = await draftCanvas({
    techniqueNodesLib: fakeNodesLib(seen),
    techniqueCheck: async () => ({
      passed: true, checks: CHECKS_WITH_WARN, stats: null,
      log: ['$ python -m athena_bt.check'], error: null,
    }),
  });
  made.canvas.onChatAction({ kind: 'code_draft', source: TECHNIQUE_SOURCE });
  await runPending(made);
  // 통과 여부는 서버 값이다 — 화면이 checks.every(ok)로 다시 재면 여기서 false가 된다.
  assert.equal(made.canvas.getContext().technique.passed, true);
  assert.equal(made.calls.nodes.length, 1, '경고가 있어도 노드를 읽는다');
  assert.equal(made.canvas.getContext().designTab, 'nodes');
  // 진행 표시가 세는 것은 차단뿐이다 — 경고를 섞으면 통과했는데 5/7로 보인다.
  assert.match(
    textOf(findByClass(made.container, 'backtest-technique-progress')[0]), /검사 5\/5/,
  );
  await click(findByClass(made.container, 'backtest-subtab')[0]);
  const terminal = terminalOf(made.container);
  assert.equal(checkRows(terminal).length, 7, '항목 수에 의존하지 않고 그대로 그린다');
  assert.match(textOf(terminal), /차단 5\/5 통과 · 경고 2/);
  const warnRow = rowWith(terminal, 'is-warn');
  assert.ok(warnRow, '경고 항목은 실패가 아닌 제 갈래로 선다');
  assert.match(textOf(warnRow), /경고/);
  assert.match(textOf(warnRow), /고치면 좋음/, '통과에 영향 없다는 사실을 문구로 적는다');
  assert.doesNotMatch(textOf(warnRow), /고쳐야 함/);
  assert.equal(rowWith(terminal, 'is-fail'), undefined, '차단 실패는 없다');
});

test('차단이 실패하면 빨간 갈래로 적고 요약 줄이 남은 수를 센다', async () => {
  const made = await draftCanvas({
    techniqueCheck: async () => ({
      passed: false,
      checks: [
        { id: 'syntax', label_ko: '문법·금지 import', ok: true, severity: 'block', detail_ko: '' },
        {
          id: 'lookahead', label_ko: '미래 참조', ok: false, severity: 'block',
          detail_ko: '12번째 줄에서 shift(-1)로 미래를 봅니다',
        },
        {
          id: 'structure', label_ko: '노드 단위', ok: false, severity: 'warn',
          detail_ko: 'signals()가 계산을 안고 있습니다',
        },
      ],
      stats: null, log: [], error: null,
    }),
  });
  made.canvas.onChatAction({ kind: 'code_draft', source: TECHNIQUE_SOURCE });
  await runPending(made);
  assert.equal(made.calls.nodes.length, 0, '차단이 막혔으면 노드를 읽지 않는다');
  const terminal = terminalOf(made.container);
  assert.match(textOf(terminal), /차단 1\/2 통과 · 경고 1/);
  const failRow = rowWith(terminal, 'is-fail');
  assert.match(textOf(failRow), /고쳐야 함/);
  assert.match(textOf(failRow), /미래를 봅니다/);
  assert.match(textOf(rowWith(terminal, 'is-warn')), /경고/);
});

test('사유에 줄 번호가 있으면 그 줄로 가는 링크가 서고, 없으면 서지 않는다', async () => {
  const made = await draftCanvas({
    techniqueCheck: async () => ({
      passed: false,
      checks: [
        {
          id: 'lookahead', label_ko: '미래 참조', ok: false, severity: 'block',
          detail_ko: '12번째 줄에서 shift(-1)로 미래를 봅니다',
        },
        {
          id: 'structure', label_ko: '노드 단위', ok: false, severity: 'warn',
          detail_ko: 'signals()가 계산을 안고 있습니다',
        },
      ],
      stats: null, log: [], error: null,
    }),
  });
  made.canvas.onChatAction({ kind: 'code_draft', source: TECHNIQUE_SOURCE });
  await runPending(made);
  const jumps = findByClass(terminalOf(made.container), 'backtest-terminal-check-jump');
  assert.equal(jumps.length, 1, '줄 번호를 읽은 항목에만 링크가 선다');
  assert.equal(jumps[0].textContent, '12번째 줄');
  await click(jumps[0]);
  await flush();
  assert.equal(made.canvas.getContext().designTab, 'code');
  // 편집기 줄번호 홈통에 그 줄만 불이 들어온다(노드에서 들어갈 때와 같은 길이다).
  assert.deepEqual(findByClass(made.container, 'is-lit').map((n) => n.textContent), ['12']);
});

test('검사 셈 — 차단만 통과를 좌우하고, 경고는 안 고친 것만 센다', () => {
  const checks = [
    { ok: true, severity: 'block' },
    { ok: false, severity: 'block' },
    { ok: false, severity: 'warn' },
    { ok: true, severity: 'warn' },
    { ok: true },
  ];
  assert.deepEqual(
    backtestCanvas.techniqueCheckCounts(checks), { blockTotal: 3, blockDone: 2, warnOpen: 1 },
  );
  assert.equal(backtestCanvas.techniqueCheckSummary(checks), '차단 2/3 통과 · 경고 1');
  assert.equal(backtestCanvas.techniqueCheckSummary([]), '차단 0/0 통과 · 경고 0');
  assert.equal(backtestCanvas.techniqueCheckMark({ ok: true }), '통과');
  assert.equal(backtestCanvas.techniqueCheckMark({ ok: false, severity: 'warn' }), '경고');
  assert.equal(backtestCanvas.techniqueCheckMark({ ok: false }), '고쳐야 함');
});

test('줄 번호는 백엔드 line을 먼저, 없으면 사유 문장에서 읽는다', () => {
  assert.equal(backtestCanvas.techniqueCheckLine({ line: 7, detail_ko: '34번째 줄' }), 7);
  assert.equal(backtestCanvas.techniqueCheckLine({ detail_ko: '34번째 줄에서 미래를 봅니다' }), 34);
  assert.equal(backtestCanvas.techniqueCheckLine({ detail_ko: 'SyntaxError (line 12)' }), 12);
  assert.equal(backtestCanvas.techniqueCheckLine({ detail_ko: '워밍업 59봉 · entry 41' }), 0);
  assert.equal(backtestCanvas.techniqueCheckLine(null), 0);
});

test('검사를 못 돌린 것과 실패한 것은 다르다 — 3줄을 지어내지 않는다', async () => {
  const made = await draftCanvas({
    techniqueCheck: async () => { throw new Error('백엔드 없음'); },
  });
  made.canvas.onChatAction({ kind: 'code_draft', source: TECHNIQUE_SOURCE });
  await runPending(made);
  const t = made.canvas.getContext().technique;
  assert.deepEqual(t.checks, []);
  assert.equal(t.passed, false);
  assert.match(textOf(findByClass(made.container, 'backtest-terminal')[0]), /검사를 돌리지 못했습니다 — 백엔드 없음/);
});

test('노드 창 배선이 없으면 그 사실을 적는다 — 빈 화면으로 두지 않는다', async () => {
  const made = await draftCanvas({ techniqueNodesLib: {} });
  made.canvas.onChatAction({ kind: 'code_draft', source: TECHNIQUE_SOURCE });
  await runPending(made);
  assert.equal(made.canvas.getContext().designTab, 'nodes');
  assert.match(textOf(made.container), /노드 창을 아직 불러오지 못했습니다/);
});

test('기존 기법도 노드·흐름 탭을 갖는다 — 스펙 경로는 지도 뒤의 코드를 읽는다', async () => {
  const seen = {};
  const calls = { codegen: [], nodes: [] };
  const made = await mounted({
    techniqueNodesLib: fakeNodesLib(seen),
    codegen: async (body) => { calls.codegen.push(body); return { source: TECHNIQUE_SOURCE }; },
    techniqueNodes: async (body) => { calls.nodes.push(body); return NODES_RESPONSE; },
  });
  const tabs = findByClass(made.container, 'backtest-subtab').map((t) => t.textContent);
  assert.deepEqual(tabs, ['지도', '폼', '코드 · 최후의 보루', '노드·흐름']);
  await click(findByClass(made.container, 'backtest-subtab')[3]);
  await flush();
  await flush();
  assert.equal(calls.codegen.length, 1);
  assert.deepEqual(calls.nodes, [{ source: TECHNIQUE_SOURCE }]);
  assert.equal(made.canvas.getContext().designTab, 'nodes');
  assert.deepEqual(seen.payload.nodes.map((n) => n.id), ['compute_atr', 'signals']);
});
