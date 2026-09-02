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

test('container가 없으면 mount()/refresh()·채팅 배선까지 조용히 넘어간다', () => {
  const canvas = createBacktestCanvas({});
  assert.doesNotThrow(() => { canvas.mount(); canvas.refresh(); });
  // canvas.js가 채널 구독에서 그냥 부르는 자리들 — 없으면 액션 한 번에 TypeError로 죽는다.
  assert.doesNotThrow(() => {
    canvas.onChatAction({ kind: 'navigate', tab: 'history' });
    canvas.showDraft({ patch: [] });
  });
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

// ── 채팅 초안(propose_spec → 카드 → 사람이 [적용]) ──────────────────────────

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

test('showDraft: 카드가 설계›폼 맨 위에 뜨고 바뀐 항목만 전 → 후로 보인다', async () => {
  const { container, canvas } = await mounted();
  await click(findByClass(container, 'backtest-subtab')[1]);        // 코드 탭으로
  await click(findByClass(container, 'backtest-tab')[2]);           // 이력 탭으로
  assert.equal(canvas.getContext().tab, 'history');

  canvas.showDraft({ patch: VALID_PATCH, note: '삼성전자 상반기', suggest_run: false });
  const ctx = canvas.getContext();
  assert.equal(ctx.view, 'design');
  assert.equal(ctx.tab, 'design');
  assert.equal(ctx.designTab, 'form');

  const cards = findByClass(container, 'backtest-draft');
  assert.equal(cards.length, 1);
  // 하위 탭 줄 바로 다음, 프리셋 목록보다 앞이다.
  const design = findByClass(container, 'backtest-design')[0];
  assert.equal(design.children[0].className, 'backtest-subtabs');
  assert.ok(design.children[1] === cards[0]);
  assert.equal(design.children[2].className, 'backtest-preset-wrap');

  const text = textOf(cards[0]);
  assert.match(text, /채팅이 제안한 설정/);
  assert.match(text, /삼성전자 상반기/);
  assert.match(text, /종목 없음 → 005930/);
  assert.match(text, /시작일 없음 → 20240101/);
  assert.match(text, /종료일 없음 → 20240630/);
  assert.equal(findByClass(cards[0], 'backtest-draft-row').length, 3);
  assert.match(text, /적용해도 실행·수집·저장은 일어나지 않습니다/);
  assert.equal(findByClass(cards[0], 'backtest-draft-apply').length, 1);
  assert.equal(findByClass(cards[0], 'backtest-draft-apply-run').length, 0);
  assert.equal(findByClass(cards[0], 'backtest-draft-discard').length, 1);
  // 카드는 폼을 아직 건드리지 않았다.
  assert.deepEqual(ctx.spec.symbols, []);
});

test('showDraft: 값을 사람 말로 적는다 — 파라미터·주기·리스크·비용·조건', async () => {
  const { container, canvas } = await mounted();
  canvas.showDraft({
    patch: {
      params: { fast: 10 },
      period: 'week',
      adjusted: false,
      risk: { stop_loss: { enabled: false } },
      costs: { fee_bps: 2 },
      exit: { logic: 'OR', conditions: [{ indicator: 'close', operator: 'less_than', compare_to: 70 }] },
    },
  });
  const text = textOf(findByClass(container, 'backtest-draft')[0]);
  assert.match(text, /파라미터 fast 20 → 10/);
  assert.match(text, /주기 일 → 주/);
  assert.match(text, /수정주가 켬 → 끔/);
  assert.match(text, /리스크 손절 8% 켬 · 익절 20% 끔 → 손절 8% 끔 · 익절 20% 끔/);
  assert.match(text, /비용 수수료 1\.5bp · 매도세 18bp · 슬리피지 5bp → 수수료 2bp/);
  assert.match(text, /청산 조건 ma_fast 가 하향 돌파 ma_slow → close 가 더 작음 70/);
});

test('[적용]: 폼이 병합 결과가 되고 초안·폼 오류가 지워진다 — 실행은 부르지 않는다', async () => {
  let runs = 0;
  const { container, canvas } = await mounted({ run: async () => { runs += 1; return {}; } });
  await click(findByClass(container, 'backtest-run-button')[0]);   // 빈 폼 → 오류 목록
  await flush();
  assert.ok(findByClass(container, 'backtest-design-error-line').length >= 1);

  canvas.showDraft({ patch: VALID_PATCH });
  await click(findByClass(container, 'backtest-draft-apply')[0]);
  await flush();
  const ctx = canvas.getContext();
  assert.deepEqual(ctx.spec.symbols, ['005930']);
  assert.equal(ctx.spec.fromDt, '20240101');
  assert.equal(ctx.spec.toDt, '20240630');
  assert.equal(ctx.spec.presetId, 'sma_crossover');
  assert.equal(ctx.draft, null);
  assert.equal(findByClass(container, 'backtest-draft').length, 0);
  assert.equal(findByClass(container, 'backtest-design-error-line').length, 0);
  assert.equal(runs, 0);
  // 폼에도 반영됐다 — 종목 칩이 생겼다.
  assert.equal(findByClass(container, 'backtest-symbol-code').length, 1);
});

test('[버리기]: 초안만 사라지고 폼은 그대로다', async () => {
  const { container, canvas } = await mounted();
  canvas.showDraft({ patch: VALID_PATCH });
  await click(findByClass(container, 'backtest-draft-discard')[0]);
  const ctx = canvas.getContext();
  assert.equal(ctx.draft, null);
  assert.equal(findByClass(container, 'backtest-draft').length, 0);
  assert.deepEqual(ctx.spec.symbols, []);
  assert.equal(ctx.spec.fromDt, '');
});

test('병합 결과가 검증에 걸리면 오류 줄이 뜨고 적용 버튼이 잠긴다', async () => {
  const { container, canvas } = await mounted();
  canvas.showDraft({
    patch: { symbols: ['005930'], fromDt: '20240630', toDt: '20240101' },
    suggest_run: true,
  });
  const card = findByClass(container, 'backtest-draft')[0];
  const errors = findByClass(card, 'backtest-draft-error');
  assert.ok(errors.length >= 1);
  assert.match(textOf(card), /종료일은 시작일보다 빠를 수 없습니다/);
  const applyRun = findByClass(card, 'backtest-draft-apply-run')[0];
  const applyOnly = findByClass(card, 'backtest-draft-apply-only')[0];
  assert.equal(applyRun.disabled, true);
  assert.equal(applyOnly.disabled, true);
  assert.equal(findByClass(card, 'backtest-draft-discard')[0].disabled, undefined);
  assert.deepEqual(canvas.getContext().draft.errors, ['종료일은 시작일보다 빠를 수 없습니다']);
  // 잠긴 버튼의 핸들러가 불려도 폼은 바뀌지 않는다.
  await click(applyRun);
  await flush();
  assert.deepEqual(canvas.getContext().spec.symbols, []);
  assert.ok(canvas.getContext().draft);
});

test('suggest_run: [적용하고 실행]·[적용만]·[버리기] 세 버튼, 실행은 사람이 눌러야 한 번 돈다', async () => {
  const bodies = [];
  const { container, canvas } = await mounted({
    run: async (body) => { bodies.push(body); return { run_id: 'r1' }; },
    result: async () => ({ status: 'running' }),
  });
  canvas.showDraft({ patch: VALID_PATCH, suggest_run: true });
  const card = findByClass(container, 'backtest-draft')[0];
  assert.equal(findByClass(card, 'backtest-draft-apply-run')[0].textContent, '적용하고 실행');
  assert.equal(findByClass(card, 'backtest-draft-apply-only')[0].textContent, '적용만');
  assert.equal(findByClass(card, 'backtest-draft-discard')[0].textContent, '버리기');
  assert.equal(findByClass(card, 'backtest-draft-apply').length, 0);
  assert.equal(bodies.length, 0);

  await click(findByClass(card, 'backtest-draft-apply-run')[0]);
  await flush();
  assert.equal(bodies.length, 1);
  assert.match(bodies[0].yaml, /symbols: \["005930"\]/);
  assert.match(bodies[0].yaml, /from: "20240101"/);
  assert.equal(canvas.getContext().view, 'running');
  assert.equal(canvas.getContext().draft, null);
});

test('suggest_run: [적용만]은 폼만 바꾸고 실행하지 않는다', async () => {
  let runs = 0;
  const { container, canvas } = await mounted({ run: async () => { runs += 1; return {}; } });
  canvas.showDraft({ patch: VALID_PATCH, suggest_run: true });
  await click(findByClass(container, 'backtest-draft-apply-only')[0]);
  await flush();
  assert.equal(runs, 0);
  assert.deepEqual(canvas.getContext().spec.symbols, ['005930']);
  assert.equal(canvas.getContext().draft, null);
  assert.equal(canvas.getContext().view, 'design');
});

test('getContext(): 화면·폼·초안 — spec은 복사본, draft는 errors를 품는다', async () => {
  const { canvas } = await mounted();
  const ctx = canvas.getContext();
  assert.deepEqual(Object.keys(ctx), [
    'view', 'tab', 'designTab', 'runPath', 'spec', 'draft', 'presets',
    'code', 'codeDraft', 'lastResult', 'diagnosis', 'optimize', 'runs', 'coverage',
  ]);
  assert.equal(ctx.view, 'design');
  assert.equal(ctx.tab, 'design');
  assert.equal(ctx.designTab, 'form');
  assert.equal(ctx.spec.presetId, 'sma_crossover');
  assert.equal(ctx.draft, null);
  assert.deepEqual(ctx.presets, [{ id: 'sma_crossover', name: 'SMA 골든크로스' }]);
  ctx.spec.symbols.push('000000');
  assert.deepEqual(canvas.getContext().spec.symbols, []);

  canvas.showDraft({ patch: {}, note: '이대로 실행할까요', suggest_run: true });
  const draft = canvas.getContext().draft;
  assert.deepEqual(Object.keys(draft), ['patch', 'note', 'suggest_run', 'errors']);
  assert.deepEqual(draft.patch, {});
  assert.equal(draft.note, '이대로 실행할까요');
  assert.equal(draft.suggest_run, true);
  assert.ok(draft.errors.includes('종목을 하나 이상 고르세요'));
});

test('preset이 든 초안: 전략이 바뀌고 종목·기간은 남으며 나머지 키는 새 전략 위에 얹힌다', async () => {
  const { container, canvas } = await mounted({ fetchPresets: async () => TWO_PRESETS });
  await fillForm(container);
  canvas.showDraft({ patch: { preset: 'rsi_reversal', params: { period: 7 } } });
  const card = findByClass(container, 'backtest-draft')[0];
  const text = textOf(card);
  assert.match(text, /전략 SMA 골든크로스 → RSI 과매도/);
  assert.equal(findByClass(card, 'backtest-draft-row')[0].children[0].textContent, '전략');
  assert.match(text, /파라미터 period 없음 → 7/);
  assert.equal(findByClass(card, 'backtest-draft-error').length, 0);

  await click(findByClass(card, 'backtest-draft-apply')[0]);
  const spec = canvas.getContext().spec;
  assert.equal(spec.presetId, 'rsi_reversal');
  assert.equal(spec.name, 'RSI 과매도');
  assert.deepEqual(spec.symbols, ['005930']);
  assert.equal(spec.fromDt, '20160101');
  assert.equal(spec.toDt, '20260828');
  assert.equal(spec.period, 'day');
  assert.deepEqual(Object.keys(spec.params), ['period']);
  assert.equal(spec.params.period.default, 7);
  const selected = findByClass(container, 'backtest-preset-item').filter((n) => n.getAttribute('aria-pressed') === 'true');
  assert.equal(selected.length, 1);
  assert.equal(selected[0].children[0].textContent, 'RSI 과매도');
});

test('모르는 프리셋 id가 든 초안은 오류로 알리고 [적용]을 잠근다', async () => {
  const { container, canvas } = await mounted();
  await fillForm(container);
  canvas.showDraft({ patch: { preset: 'nope' } });
  const card = findByClass(container, 'backtest-draft')[0];
  const errors = findByClass(card, 'backtest-draft-error').map((n) => n.textContent);
  assert.deepEqual(errors, ['nope는 없는 프리셋입니다']);
  assert.equal(findByClass(card, 'backtest-draft-apply')[0].disabled, true);
  assert.ok(canvas.getContext().draft.errors.includes('nope는 없는 프리셋입니다'));
});

test('실행 중·승인 중에는 showDraft가 화면을 바꾸지 않는다 — 초안만 들고 있는다', async () => {
  const { container, canvas } = await mounted({
    run: async () => ({ run_id: 'r1' }),
    result: async () => ({ status: 'running' }),
  });
  await fillForm(container);
  await click(findByClass(container, 'backtest-run-button')[0]);
  await flush();
  assert.equal(canvas.getContext().view, 'running');
  canvas.showDraft({ patch: VALID_PATCH });
  assert.equal(canvas.getContext().view, 'running');
  assert.equal(findByClass(container, 'backtest-draft').length, 0);
  assert.deepEqual(canvas.getContext().draft.patch, VALID_PATCH);

  const approval = await toApproval();
  approval.canvas.showDraft({ patch: VALID_PATCH });
  assert.equal(approval.canvas.getContext().view, 'approval');
  assert.equal(findByClass(approval.container, 'backtest-approval').length, 1);
  // 승인을 취소하고 설계로 돌아오면 카드가 그때 보인다.
  await click(findByClass(approval.container, 'backtest-approval-cancel')[0]);
  assert.equal(findByClass(approval.container, 'backtest-draft').length, 1);
});

test('두 번째 showDraft는 앞의 초안을 갈아치운다 — 카드는 하나뿐이다', async () => {
  const { container, canvas } = await mounted();
  canvas.showDraft({ patch: { symbols: ['005930'] } });
  canvas.showDraft({ patch: { symbols: ['000660'] } });
  const cards = findByClass(container, 'backtest-draft');
  assert.equal(cards.length, 1);
  const text = textOf(cards[0]);
  assert.match(text, /000660/);
  assert.equal(text.includes('005930'), false);
  assert.deepEqual(canvas.getContext().draft.patch.symbols, ['000660']);
});

test('showDraft: patch가 객체가 아니면 무시한다', async () => {
  const { container, canvas } = await mounted();
  assert.doesNotThrow(() => {
    canvas.showDraft(null);
    canvas.showDraft({});
    canvas.showDraft({ patch: 'symbols' });
    canvas.showDraft({ patch: [] });
  });
  assert.equal(canvas.getContext().draft, null);
  assert.equal(findByClass(container, 'backtest-draft').length, 0);
});

// ── 채팅 액션(코드 초안 · 화면 전환 · 최적화 제안) ──────────────────────────

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

// 코드가 편집기에 들어간 상태를 만든다 — 사람이 [적용]을 누른 것과 같은 경로다.
async function withCode(made) {
  made.canvas.onChatAction({ kind: 'code_draft', source: CODE_SOURCE });
  await click(findByClass(made.container, 'backtest-draft-apply')[0]);
  await flush();
  return made;
}

test('onChatAction: 알 수 없는 kind·빈 payload는 조용히 무시한다', async () => {
  const { canvas } = await mounted();
  assert.doesNotThrow(() => {
    canvas.onChatAction(null);
    canvas.onChatAction({});
    canvas.onChatAction({ kind: 'nope', tab: 'history' });
    canvas.onChatAction('navigate');
  });
  const ctx = canvas.getContext();
  assert.equal(ctx.tab, 'design');
  assert.equal(ctx.codeDraft, null);
  assert.equal(ctx.draft, null);
});

test('onChatAction spec_draft: showDraft와 같은 카드로 간다', async () => {
  const { container, canvas } = await mounted();
  canvas.onChatAction({ kind: 'spec_draft', patch: VALID_PATCH, note: '삼성전자', suggest_run: false });
  assert.equal(findByClass(container, 'backtest-draft').length, 1);
  assert.equal(canvas.getContext().draft.note, '삼성전자');
});

test('code_draft: 코드 탭 맨 위에 카드가 서고 화면이 설계›코드로 간다', async () => {
  const { container, canvas } = await mounted();
  canvas.onChatAction({
    kind: 'code_draft', source: CODE_SOURCE, note: '진입 조건을 고쳤다',
  });
  const ctx = canvas.getContext();
  assert.equal(ctx.view, 'design');
  assert.equal(ctx.tab, 'design');
  assert.equal(ctx.designTab, 'code');

  const cards = findByClass(container, 'backtest-code-draft');
  assert.equal(cards.length, 1);
  // strategy.py 머리보다 앞이다.
  const codeTab = findByClass(container, 'backtest-code-tab')[0];
  assert.ok(codeTab.children[0] === cards[0]);
  const text = textOf(cards[0]);
  assert.match(text, /채팅이 제안한 코드/);
  assert.match(text, /진입 조건을 고쳤다/);
  assert.match(text, /적용하면 편집기에 들어갑니다 — 저장·실행·검증은 따로 누릅니다/);
  // 빈 편집기와의 diff라 지워진 줄은 없고 전부 추가 줄이다.
  const rows = findByClass(cards[0], 'backtest-diff-row');
  assert.equal(rows.filter((r) => /is-add/.test(r.className)).length, 7);
  assert.equal(rows.filter((r) => /is-del/.test(r.className)).length, 0);
  assert.equal(findByClass(cards[0], 'backtest-draft-apply').length, 1);
  assert.equal(findByClass(cards[0], 'backtest-draft-apply-run').length, 0);
  assert.equal(findByClass(cards[0], 'backtest-draft-discard').length, 1);
  // 편집기는 아직 비어 있다.
  assert.equal(canvas.getContext().code.source, '');
  assert.equal(canvas.getContext().runPath, 'form');
});

test('code_draft 기본 버튼: suggest_run → [적용하고 실행], suggest_validate → [적용하고 검증]', async () => {
  const { container, canvas } = await mounted();
  canvas.onChatAction({ kind: 'code_draft', source: CODE_SOURCE, suggest_run: true });
  let card = findByClass(container, 'backtest-code-draft')[0];
  assert.equal(findByClass(card, 'backtest-draft-apply-run')[0].textContent, '적용하고 실행');
  assert.equal(findByClass(card, 'backtest-draft-apply-only')[0].textContent, '적용만');

  canvas.onChatAction({ kind: 'code_draft', source: CODE_SOURCE, suggest_validate: true });
  card = findByClass(container, 'backtest-code-draft')[0];
  assert.equal(findByClass(card, 'backtest-draft-apply-run')[0].textContent, '적용하고 검증');
  assert.equal(findByClass(card, 'backtest-draft-apply-only')[0].textContent, '적용만');

  canvas.onChatAction({ kind: 'code_draft', source: CODE_SOURCE });
  card = findByClass(container, 'backtest-code-draft')[0];
  assert.equal(findByClass(card, 'backtest-draft-apply')[0].textContent, '적용');
  assert.equal(findByClass(card, 'backtest-draft-apply-only').length, 0);
});

test('code_draft [적용]: 편집기에 들어가고 실행경로가 코드로 바뀐다 — 실행은 없다', async () => {
  let runs = 0;
  const made = await mounted({ run: async () => { runs += 1; return {}; } });
  await withCode(made);
  const ctx = made.canvas.getContext();
  assert.equal(ctx.code.source, CODE_SOURCE);
  assert.equal(ctx.code.lines, 8);
  assert.equal(ctx.code.truncated, false);
  assert.equal(ctx.runPath, 'code');
  assert.equal(ctx.codeDraft, null);
  assert.equal(findByClass(made.container, 'backtest-code-draft').length, 0);
  assert.equal(runs, 0);
});

test('code_draft [적용하고 실행]: 폼이 비어 있으면 코드 탭에 그 이유가 보인다', async () => {
  const bodies = [];
  const { container, canvas } = await mounted({
    run: async (body) => { bodies.push(body); return { run_id: 'r1' }; },
  });
  // 폼(종목·기간)을 채우지 않은 채 코드 초안의 [적용하고 실행]을 누른다.
  canvas.onChatAction({ kind: 'code_draft', source: CODE_SOURCE, suggest_run: true });
  await click(findByClass(container, 'backtest-draft-apply-run')[0]);
  await flush();
  assert.equal(bodies.length, 0);
  assert.equal(canvas.getContext().designTab, 'code');
  const lines = findByClass(container, 'backtest-design-error-line').map((n) => n.textContent);
  assert.ok(lines.length >= 1, '코드 탭에 폼 오류가 보여야 한다');
  assert.ok(lines.some((m) => /종목/.test(m)), lines.join(' / '));
});

test('code_draft [적용하고 실행]: run 바디에 source가 실린다', async () => {
  const bodies = [];
  const { container, canvas } = await mounted({
    run: async (body) => { bodies.push(body); return { run_id: 'r1' }; },
    result: async () => ({ status: 'running' }),
  });
  await fillForm(container);
  canvas.onChatAction({ kind: 'code_draft', source: CODE_SOURCE, suggest_run: true });
  assert.equal(bodies.length, 0);
  await click(findByClass(container, 'backtest-draft-apply-run')[0]);
  await flush();
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].source, CODE_SOURCE);
  assert.equal(canvas.getContext().view, 'running');
});

test('code_draft [적용하고 검증]: validate(kind=python)를 부르고 오류를 코드 탭에 남긴다', async () => {
  let seen = null;
  const { container, canvas } = await mounted({
    validate: async (body) => {
      seen = body;
      return { ok: false, errors: [{ message: 'signals(df, p)가 없습니다' }] };
    },
  });
  canvas.onChatAction({ kind: 'code_draft', source: CODE_SOURCE, suggest_validate: true });
  await click(findByClass(container, 'backtest-draft-apply-run')[0]);
  await flush();
  assert.deepEqual(seen, { kind: 'python', source: CODE_SOURCE });
  assert.deepEqual(canvas.getContext().code.errors, ['signals(df, p)가 없습니다']);
  assert.match(textOf(container), /signals\(df, p\)가 없습니다/);
});

test('code_draft [버리기]: 초안만 사라지고 편집기는 그대로다', async () => {
  const { container, canvas } = await mounted();
  canvas.onChatAction({ kind: 'code_draft', source: CODE_SOURCE });
  await click(findByClass(container, 'backtest-draft-discard')[0]);
  assert.equal(canvas.getContext().codeDraft, null);
  assert.equal(canvas.getContext().code.source, '');
  assert.equal(findByClass(container, 'backtest-code-draft').length, 0);
});

test('code_draft: 뒤에 온 초안이 앞의 초안을 갈아치우고, 빈 source는 무시한다', async () => {
  const { container, canvas } = await mounted();
  canvas.onChatAction({ kind: 'code_draft', source: CODE_SOURCE, note: '첫 번째' });
  canvas.onChatAction({ kind: 'code_draft', source: `${CODE_SOURCE}# 두 번째\n`, note: '두 번째' });
  assert.equal(findByClass(container, 'backtest-code-draft').length, 1);
  assert.equal(canvas.getContext().codeDraft.note, '두 번째');
  canvas.onChatAction({ kind: 'code_draft', source: '' });
  canvas.onChatAction({ kind: 'code_draft', source: 42 });
  assert.equal(canvas.getContext().codeDraft.note, '두 번째');
});

test('navigate history: 이력을 불러오고 탭이 이력으로 간다', async () => {
  let called = 0;
  const { container, canvas } = await mounted({
    runs: async () => {
      called += 1;
      return [{ run_id: 'run_9', status: 'done', metrics: { total_return: 0.12, sharpe: 1.1 } }];
    },
  });
  canvas.onChatAction({ kind: 'navigate', tab: 'history' });
  await flush();
  assert.equal(called, 1);
  const ctx = canvas.getContext();
  assert.equal(ctx.tab, 'history');
  assert.equal(ctx.view, 'history');
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
  made.canvas.onChatAction({ kind: 'navigate', tab: 'design', designTab: 'flow' });
  await flush();
  assert.deepEqual(asked, { source: CODE_SOURCE });
  assert.equal(made.canvas.getContext().designTab, 'flow');
  assert.equal(findByClass(made.container, 'backtest-flow-tab').length, 1);
});

test('navigate: 모르는 tab·designTab은 무시한다', async () => {
  const { canvas } = await mounted();
  canvas.onChatAction({ kind: 'navigate', tab: 'nope' });
  assert.equal(canvas.getContext().tab, 'design');
  canvas.onChatAction({ kind: 'navigate', tab: 'optimize', designTab: 'nope' });
  const ctx = canvas.getContext();
  assert.equal(ctx.tab, 'optimize');
  assert.equal(ctx.designTab, 'form');
});

test('optimize_request: 방식을 골라두고 [탐색 시작]을 켠다 — 누르는 것은 사람이다', async () => {
  let started = 0;
  const { container, canvas } = await mounted({
    optimize: async () => { started += 1; return { best: null, warnings: [] }; },
  });
  canvas.onChatAction({
    kind: 'optimize_request', method: 'random', note: '느린 축부터 훑어보죠',
  });
  const ctx = canvas.getContext();
  assert.equal(ctx.view, 'design');
  assert.equal(ctx.tab, 'optimize');
  assert.equal(ctx.optimize.method, 'random');
  assert.equal(started, 0);
  const start = findByClass(container, 'backtest-optimize-start')[0];
  assert.match(start.className, /is-suggested/);
  assert.match(
    textOf(findByClass(container, 'backtest-optimize-suggested')[0]),
    /느린 축부터 훑어보죠/,
  );

  await click(start);
  await flush();
  assert.equal(started, 1);
  assert.equal(findByClass(container, 'backtest-optimize-suggested').length, 0);
});

test('optimize_request: 문구가 없으면 기본 한 줄, 모르는 method는 그대로 둔다', async () => {
  const { container, canvas } = await mounted();
  canvas.onChatAction({ kind: 'optimize_request', method: 'nope' });
  assert.equal(canvas.getContext().optimize.method, 'grid');
  assert.match(
    textOf(findByClass(container, 'backtest-optimize-suggested')[0]),
    /채팅이 이 설정으로 탐색을 제안했습니다/,
  );
});

test('실행 중에는 navigate·optimize_request를 무시하고 코드 초안은 들고만 있는다', async () => {
  const { container, canvas } = await mounted({
    run: async () => ({ run_id: 'r1' }),
    result: async () => ({ status: 'running' }),
  });
  await fillForm(container);
  await click(findByClass(container, 'backtest-run-button')[0]);
  await flush();
  assert.equal(canvas.getContext().view, 'running');

  canvas.onChatAction({ kind: 'navigate', tab: 'history' });
  canvas.onChatAction({ kind: 'optimize_request', method: 'random' });
  assert.equal(canvas.getContext().view, 'running');
  assert.equal(canvas.getContext().tab, 'design');
  assert.equal(canvas.getContext().optimize.method, 'grid');

  canvas.onChatAction({ kind: 'code_draft', source: CODE_SOURCE });
  assert.equal(canvas.getContext().view, 'running');
  assert.equal(findByClass(container, 'backtest-code-draft').length, 0);
  assert.equal(canvas.getContext().codeDraft.lines, 8);
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
  await click(findByClass(made.container, 'backtest-draft-apply')[0]);
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
