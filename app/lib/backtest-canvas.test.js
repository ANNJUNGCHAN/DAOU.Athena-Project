// backtest-canvas.js 단위 테스트 — jsdom 없이 최소 DOM 스텁으로 검증한다
// (history-badge.test.js/agent-canvas.test.js가 세운 관례). P4 범위: 상태 전이
// (empty→design→approval→running→result), run()의 409→approval 변환, 폴링 중단
// (container.hidden), 가정 섹션 상시 존재.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const backtestCanvas = require('./backtest-canvas');
const { createBacktestCanvas } = backtestCanvas;

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
    children: [],
    attrs: {},
    _listeners: {},
    get firstChild() { return this.children[0] || null; },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter((c) => c !== child); return child; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    addEventListener(type, handler) { (this._listeners[type] = this._listeners[type] || []).push(handler); },
    dispatchEvent(event) {
      const handlers = this._listeners[event && event.type] || [];
      return Promise.all(handlers.map((h) => h(event)));
    },
  };
  return node;
}

test.beforeEach(() => {
  global.document = { createElement: (tag) => fakeNode(tag) };
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

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function manualTimer() {
  let pending = null;
  return {
    setTimeoutImpl: (fn) => { pending = fn; return {}; },
    clearTimeoutImpl: () => { pending = null; },
    async fire() { const fn = pending; pending = null; if (fn) await fn(); },
    hasPending: () => pending !== null,
  };
}

const PRESET = { id: 'p1', name: '이평 교차', category: 'trend', yaml: 'strategy:\n  name: sma' };

function validForm(container) {
  const stkCd = findByClass(container, 'backtest-field-input').find((n) => n.placeholder === '005930');
  const dates = findByClass(container, 'backtest-field-input').filter((n) => n.placeholder === 'YYYYMMDD');
  stkCd.value = '005930';
  stkCd.dispatchEvent({ type: 'input' });
  dates[0].value = '20200101';
  dates[0].dispatchEvent({ type: 'input' });
  dates[1].value = '20260101';
  dates[1].dispatchEvent({ type: 'input' });
}

test('container가 없으면 mount()/refresh() 둘 다 조용히 넘어간다', () => {
  const canvas = createBacktestCanvas({});
  assert.doesNotThrow(() => canvas.mount());
  assert.doesNotThrow(() => canvas.refresh());
});

test('mount() 직후(비동기 완료 전)에는 정직한 로딩 상태를 그린다', () => {
  const container = fakeNode('div');
  const canvas = createBacktestCanvas({ container, fetchPresets: async () => [PRESET] });
  canvas.mount();
  assert.equal(container.children[0].className, 'backtest-canvas-empty');
  assert.match(container.children[0].children[1].textContent, /불러오는 중/);
});

test('상태 전이: empty → design — 프리셋을 받으면 목록+실행 버튼을 그린다', async () => {
  const container = fakeNode('div');
  const canvas = createBacktestCanvas({ container, fetchPresets: async () => [PRESET] });
  canvas.mount();
  await flush();
  assert.equal(findByClass(container, 'backtest-preset-item').length, 1);
  assert.equal(findByClass(container, 'backtest-preset-item')[0].className, 'backtest-preset-item is-selected');
  assert.equal(findByClass(container, 'backtest-run-button').length, 1);
});

test('프리셋 fetch 실패 시 정직한 에러 상태를 그린다(목업 데이터 없음)', async () => {
  const container = fakeNode('div');
  const canvas = createBacktestCanvas({
    container,
    fetchPresets: async () => { throw new Error('backend down'); },
  });
  canvas.mount();
  await flush();
  assert.equal(container.children[0].className, 'backtest-canvas-empty backtest-canvas-error');
  assert.match(container.children[0].children[1].textContent, /backend down/);
});

test('실행 버튼: 폼이 비어있으면 run()을 부르지 않고 인라인 오류를 보여준다', async () => {
  const container = fakeNode('div');
  const runSpy = () => { throw new Error('불려서는 안 된다'); };
  const canvas = createBacktestCanvas({ container, fetchPresets: async () => [PRESET], run: runSpy });
  canvas.mount();
  await flush();
  findByClass(container, 'backtest-run-button')[0].dispatchEvent({ type: 'click' });
  await flush();
  assert.match(findByClass(container, 'backtest-design-error')[0].textContent, /종목코드/);
});

test('409→approval 변환: run()이 blocked를 돌려주면 needed_pages/est_seconds로 승인 카드를 그린다', async () => {
  const container = fakeNode('div');
  const canvas = createBacktestCanvas({
    container,
    fetchPresets: async () => [PRESET],
    run: async () => ({ blocked: true, needed_pages: 12, est_seconds: 12 }),
  });
  canvas.mount();
  await flush();
  validForm(container);
  findByClass(container, 'backtest-run-button')[0].dispatchEvent({ type: 'click' });
  await flush();
  const stats = findByClass(container, 'backtest-approval-stat').map((n) => n.textContent);
  assert.deepEqual(stats, ['필요 페이지 · 12', '예상 소요 · 12초']);
});

test('승인 카드 [취소] → design으로 돌아간다', async () => {
  const container = fakeNode('div');
  const canvas = createBacktestCanvas({
    container,
    fetchPresets: async () => [PRESET],
    run: async () => ({ blocked: true, needed_pages: 1, est_seconds: 1 }),
  });
  canvas.mount();
  await flush();
  validForm(container);
  findByClass(container, 'backtest-run-button')[0].dispatchEvent({ type: 'click' });
  await flush();
  findByClass(container, 'backtest-approval-cancel')[0].dispatchEvent({ type: 'click' });
  await flush();
  assert.equal(findByClass(container, 'backtest-preset-item').length, 1);
});

test('승인 카드 [수집하고 실행] → backfill 바디가 폼 값 그대로다(stk_cd/period/adjusted/from_dt/to_dt)', async () => {
  const container = fakeNode('div');
  let backfillBody = null;
  const timer = manualTimer();
  const canvas = createBacktestCanvas({
    container,
    fetchPresets: async () => [PRESET],
    run: async () => ({ blocked: true, needed_pages: 1, est_seconds: 1 }),
    backfill: async (body) => { backfillBody = body; return { job_id: 'j1' }; },
    status: async () => ({ status: 'running' }),
    setTimeoutImpl: timer.setTimeoutImpl,
    clearTimeoutImpl: timer.clearTimeoutImpl,
  });
  canvas.mount();
  await flush();
  validForm(container);
  findByClass(container, 'backtest-run-button')[0].dispatchEvent({ type: 'click' });
  await flush();
  findByClass(container, 'backtest-approval-confirm')[0].dispatchEvent({ type: 'click' });
  await flush();
  assert.deepEqual(backfillBody, {
    stk_cd: '005930', period: 'day', adjusted: true, from_dt: '20200101', to_dt: '20260101',
  });
});

test('상태 전이: running → result — run() 성공 후 result를 폴링하다 done이면 지표 6타일+체결 표를 그린다', async () => {
  const container = fakeNode('div');
  let runCalls = 0;
  const timer = manualTimer();
  const canvas = createBacktestCanvas({
    container,
    fetchPresets: async () => [PRESET],
    run: async ({ yaml }) => {
      runCalls += 1;
      assert.match(yaml, /data:\n {2}symbols: \["005930"\]\n {2}period: day\n {2}adjusted: true\n {2}from: "20200101"\n {2}to: "20260101"/);
      return { blocked: false, run_id: 'r1' };
    },
    result: async ({ run_id }) => {
      assert.equal(run_id, 'r1');
      return {
        status: 'done',
        metrics: {
          total_return: 0.1234, cagr: 0.2, sharpe: 1.5, mdd: -0.15,
          win_rate: 0.6, open_positions: 2, profit_factor: 1.8,
        },
        equity: [],
        flags: ['비용 미설정'],
      };
    },
    trades: async () => ([
      { seq: 1, side: 'buy', dt: '20200105', price: 10000, qty: 10, fee: 15, tax: 0, pnl: null, reason: 'signal' },
      { seq: 2, side: 'sell', dt: '20200110', price: 11000, qty: 10, fee: 16, tax: 25, pnl: 985, reason: 'take_profit' },
    ]),
    setTimeoutImpl: timer.setTimeoutImpl,
    clearTimeoutImpl: timer.clearTimeoutImpl,
  });
  canvas.mount();
  await flush();
  validForm(container);
  findByClass(container, 'backtest-run-button')[0].dispatchEvent({ type: 'click' });
  await flush();
  assert.equal(runCalls, 1);

  const values = findByClass(container, 'backtest-metric-value').map((n) => n.textContent);
  assert.deepEqual(values, ['12.34%', '20.00%', '1.50', '-15.00%', '60.00%', '1.80']);
  assert.match(findByClass(container, 'backtest-metric-sub')[0].textContent, /미청산 2건/);

  const tradeRows = findByClass(container, 'backtest-trades-row');
  assert.equal(tradeRows.length, 3, '헤더 1 + 체결 2');
  assert.deepEqual(tradeRows[1].children.map((c) => c.textContent), ['2020-01-05', '매수', '10,000', '10', '15', '—', '신호']);
  assert.deepEqual(tradeRows[2].children.map((c) => c.textContent), ['2020-01-10', '매도', '11,000', '10', '16', '985', '익절']);

  assert.equal(findByClass(container, 'backtest-assumptions-text')[0].textContent, backtestCanvas.ASSUMPTIONS_TEXT);
  assert.match(findByClass(container, 'backtest-assumptions-flags')[0].textContent, /비용 미설정/);
});

test('폴링 중단: 컨테이너가 hidden이면 다음 tick을 예약하지 않는다', async () => {
  const container = fakeNode('div');
  let resultCalls = 0;
  const timer = manualTimer();
  const canvas = createBacktestCanvas({
    container,
    fetchPresets: async () => [PRESET],
    run: async () => ({ blocked: false, run_id: 'r1' }),
    result: async () => { resultCalls += 1; return { status: 'running' }; },
    setTimeoutImpl: timer.setTimeoutImpl,
    clearTimeoutImpl: timer.clearTimeoutImpl,
  });
  canvas.mount();
  await flush();
  validForm(container);
  findByClass(container, 'backtest-run-button')[0].dispatchEvent({ type: 'click' });
  await flush();
  assert.equal(resultCalls, 1);
  assert.equal(timer.hasPending(), true, '다음 폴링이 예약돼 있다');

  container.hidden = true; // 모드 이탈(controller.js applyVisibility가 미는 값)
  await timer.fire();
  assert.equal(resultCalls, 1, 'hidden이면 다음 fetch를 하지 않는다');
  assert.equal(timer.hasPending(), false, '다음 tick도 예약하지 않는다');

  container.hidden = false;
  canvas.refresh(); // 재진입 — 멈췄던 폴링을 깨운다
  await flush();
  assert.equal(resultCalls, 2, 'refresh()가 폴링을 재개한다');
});

test('가정 섹션은 flags가 없어도(비어 있어도) 5개 문장이 항상 표기된다', async () => {
  const container = fakeNode('div');
  const canvas = createBacktestCanvas({
    container,
    fetchPresets: async () => [PRESET],
    run: async () => ({ blocked: false, run_id: 'r1' }),
    result: async () => ({ status: 'done', metrics: null, equity: [], flags: [] }),
    trades: async () => [],
  });
  canvas.mount();
  await flush();
  validForm(container);
  findByClass(container, 'backtest-run-button')[0].dispatchEvent({ type: 'click' });
  await flush();
  assert.equal(findByClass(container, 'backtest-assumptions-text').length, 1);
  assert.equal(findByClass(container, 'backtest-assumptions-flags').length, 0, 'flags가 비면 플래그 줄 자체가 없다');
  const values = findByClass(container, 'backtest-metric-value').map((n) => n.textContent);
  assert.deepEqual(values, ['—', '—', '—', '—', '—', '—'], 'metrics가 null이면 전부 정직한 —');
});

test('실패 상태: result()가 failed를 돌려주면 error 화면으로 간다', async () => {
  const container = fakeNode('div');
  const canvas = createBacktestCanvas({
    container,
    fetchPresets: async () => [PRESET],
    run: async () => ({ blocked: false, run_id: 'r1' }),
    result: async () => ({ status: 'failed', error: '샌드박스 타임아웃' }),
  });
  canvas.mount();
  await flush();
  validForm(container);
  findByClass(container, 'backtest-run-button')[0].dispatchEvent({ type: 'click' });
  await flush();
  assert.equal(container.children[0].className, 'backtest-canvas-empty backtest-canvas-error');
  assert.match(container.children[0].children[1].textContent, /샌드박스 타임아웃/);
});

// ---------- 순수 계산 ----------

test('validateForm: 종목코드/날짜 형식·순서를 검증한다', () => {
  assert.equal(backtestCanvas.validateForm({ stkCd: '005930', fromDt: '20200101', toDt: '20260101' }), null);
  assert.match(backtestCanvas.validateForm({ stkCd: '5930', fromDt: '20200101', toDt: '20260101' }), /종목코드/);
  assert.match(backtestCanvas.validateForm({ stkCd: '005930', fromDt: '2020-01-01', toDt: '20260101' }), /YYYYMMDD/);
  assert.match(backtestCanvas.validateForm({ stkCd: '005930', fromDt: '20260101', toDt: '20200101' }), /종료일/);
});

test('buildRunYaml: 프리셋 yaml 뒤에 data: 블록을 이어붙인다(params는 건드리지 않는다)', () => {
  const yaml = backtestCanvas.buildRunYaml('strategy:\n  name: sma\n', {
    stkCd: '005930', period: 'day', adjusted: true, fromDt: '20200101', toDt: '20260101',
  });
  assert.equal(yaml, 'strategy:\n  name: sma\ndata:\n  symbols: ["005930"]\n  period: day\n  adjusted: true\n  from: "20200101"\n  to: "20260101"\n');
});

test('formatPercentValue/formatRatioValue: null은 정직한 —, 무한대는 ∞', () => {
  assert.equal(backtestCanvas.formatPercentValue(null), '—');
  assert.equal(backtestCanvas.formatPercentValue(0.1), '10.00%');
  assert.equal(backtestCanvas.formatRatioValue(null), '—');
  assert.equal(backtestCanvas.formatRatioValue(Infinity), '∞');
  assert.equal(backtestCanvas.formatRatioValue(1.5), '1.50');
});
