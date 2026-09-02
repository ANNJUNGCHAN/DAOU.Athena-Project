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

// 폼을 실행 가능한 상태로 만든다(종목·기간). 입력 이벤트는 모델만 갱신하므로
// 화면을 다시 그리지 않아도 값이 남는다.
async function fillForm(container) {
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
  assert.equal(findByClass(container, 'backtest-canvas-error').length, 1);
  assert.match(textOf(container), /백엔드 없음/);
});

// ── 보드 01 · 설계 폼 ───────────────────────────────────────────────────────

test('empty → design: 프리셋 목록·대상·지표·조건·리스크 카드를 모두 그린다', async () => {
  const { container, canvas } = makeCanvas();
  canvas.mount();
  await flush();
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
  const badge = findByClass(container, 'backtest-logic-badge')[0];
  assert.match(badge.textContent, /AND/);
  await click(badge);
  assert.match(findByClass(container, 'backtest-logic-badge')[0].textContent, /OR/);
});

test('조건을 추가·삭제할 수 있다', async () => {
  const { container, canvas } = makeCanvas();
  canvas.mount();
  await flush();
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
  assert.match(textOf(container), /사실 주장이 아닙니다/);
});

test('설계 화면에도 체결 가정이 상시 붙는다(보드 01)', async () => {
  const { container, canvas } = makeCanvas();
  canvas.mount();
  await flush();
  assert.equal(findByClass(container, 'backtest-assumptions').length, 1);
});

test('실행 버튼: 폼이 비어있으면 run()을 부르지 않고 오류 목록을 보여준다', async () => {
  let called = false;
  const { container, canvas } = makeCanvas({ run: async () => { called = true; return {}; } });
  canvas.mount();
  await flush();
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

async function mounted(overrides) {
  const made = makeCanvas(overrides);
  made.canvas.mount();
  await flush();
  return made;
}

const RECEIPT_KEYS = [
  'id', 'kind', 'applied', 'note', 'rows', 'errors',
  'suggest_run', 'suggest_validate', 'tab', 'designTab', 'method', 'canUndo',
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

test('spec_draft: 폼에 바로 들어가고 영수증이 바뀐 항목을 싣는다 — 캔버스 초안 카드는 없다', async () => {
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
  assert.equal(receipt.designTab, 'form');
  assert.deepEqual(receipt.rows, [
    { label: '종목', before: '없음', after: '005930' },
    { label: '시작일', before: '없음', after: '20240101' },
    { label: '종료일', before: '없음', after: '20240630' },
  ]);

  // 폼이 곧바로 그 값이다 — 사람이 누를 카드가 캔버스에 서지 않는다.
  const ctx = canvas.getContext();
  assert.equal(ctx.view, 'design');
  assert.equal(ctx.tab, 'design');
  assert.equal(ctx.designTab, 'form');
  assert.deepEqual(ctx.spec.symbols, ['005930']);
  assert.equal(ctx.spec.fromDt, '20240101');
  assert.equal(ctx.draft, null);
  assert.equal(findByClass(container, 'backtest-draft').length, 0);
  assert.equal(findByClass(container, 'backtest-symbol-code').length, 1);
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

test('navigate design/flow: 코드가 있으면 흐름 지도를 불러온다', async () => {
  let asked = null;
  const made = await mounted({
    flow: async (body) => { asked = body; return { nodes: [] }; },
  });
  await withCode(made);
  const receipt = made.canvas.onChatAction({
    kind: 'navigate', tab: 'design', designTab: 'flow',
  });
  await flush();
  assert.deepEqual(asked, { source: CODE_SOURCE });
  assert.equal(receipt.designTab, 'flow');
  assert.equal(made.canvas.getContext().designTab, 'flow');
  assert.equal(findByClass(made.container, 'backtest-flow-tab').length, 1);
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
  assert.deepEqual(Object.keys(last), ['id', 'kind', 'applied', 'rows', 'errors']);
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
    'code', 'codeDraft', 'lastResult', 'diagnosis', 'optimize', 'runs', 'coverage',
    'lastChange',
  ]);
  assert.equal(ctx.view, 'design');
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

test('모드 탭 5개와 설계 하위 탭 3개가 계약으로 고정돼 있다', () => {
  assert.deepEqual(backtestCanvas.MODE_TABS.map((t) => t[0]),
    ['design', 'result', 'history', 'optimize', 'deploy']);
  assert.deepEqual(backtestCanvas.DESIGN_TABS.map((t) => t[0]), ['form', 'code', 'flow']);
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
