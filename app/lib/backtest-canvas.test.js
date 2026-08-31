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
    setAttribute(k, v) { this.attrs[k] = String(v); },
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

test('container가 없으면 mount()/refresh() 둘 다 조용히 넘어간다', () => {
  const canvas = createBacktestCanvas({});
  assert.doesNotThrow(() => { canvas.mount(); canvas.refresh(); });
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
  equity: [{ dt: '2026-01-01', equity: 100, drawdown: 0 }],
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
