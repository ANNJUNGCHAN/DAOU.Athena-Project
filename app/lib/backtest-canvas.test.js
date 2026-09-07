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

function findByTag(node, tag) {
  const found = [];
  const walk = (n) => {
    if (n.tag === tag) found.push(n);
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

// 예약만 쌓아두는 가짜 타이머를 실제로 흘린다 — 디바운스 뒤에 무엇이 나가는지는
// 이것 없이는 한 번도 실행되지 않는다(작업공간 재봉인이 그 경로에 산다).
async function runPending(made) {
  const queued = made.pending.splice(0, made.pending.length);
  for (const fn of queued) fn();
  await flush();
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

// 보드 19: 첫 화면은 목록만. 폼 칸을 보려면 기법을 고른 다음이다. 고른 뒤 기본 탭은
// 지도라(2026-09-03) 폼 검사는 폼 탭으로 옮긴 뒤에 시작한다.
async function toForm(container) {
  if (!findByClass(container, 'backtest-symbol-add').length) {
    const item = findByClass(container, 'backtest-preset-item')[0];
    if (item) {
      await click(item);
      await flush();
    }
  }
  const tabs = findByClass(container, 'backtest-subtab');
  const formTab = tabs.find((t) => t.textContent === '폼') || tabs[1];
  if (formTab) await click(formTab);
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

// ── 보드 17 · 출처에서 지도로 ───────────────────────────────────────────────
//
// 화면이 소유한 것만 본다: 잡을 띄우는가, 받은 것만 그리는가, [멈추기]가 연쇄를
// 실제로 끊는가. 다섯 단계의 속내(무엇을 뽑았나·어떻게 옮겼나)는 백엔드 것이고
// backend/tests/unit/test_backtest_source_to_map.py가 고정한다.

// 3/5 단계에서 멈춰 세운 잡 한 장 — Paper가 그린 프레임 그대로다.
function sourceJobAt3of5(extra) {
  return Object.assign({
    job_id: 'sm-1',
    status: 'running',
    step_index: 3,
    step_total: 5,
    eta_seconds: 20,
    target_ko: '코스피 대형주 · 일봉 · 3년',
    target_confirmed: false,
    steps: [
      { id: 'read', state: 'done', title_ko: '출처 읽음', meta_ko: '유튜브 · 14,200자' },
      { id: 'rules', state: 'done', title_ko: '규칙 뽑음', meta_ko: '진입 2 · 청산 1 · 손절 1' },
      { id: 'map', state: 'running', title_ko: '지도 그리는 중', meta_ko: '칸 3/4 · 지금 ③ 사고·파는 순간을 찍습니다' },
      { id: 'code', state: 'todo', title_ko: '코드 만들기', meta_ko: '지도 뒤에서 자동' },
      { id: 'check', state: 'todo', title_ko: '자체 검사', meta_ko: '가상환경 · 짧은 구간 시험 실행' },
    ],
    map_filled: 2,
    map_total: 4,
    code_lines: null,
    map: {
      version: 0,
      source_kind: 'spec',
      target: null,
      app_before: [{ key: 'load', title: '봉 데이터를 모읍니다', detail: '캐시에 있는 봉을 정리합니다' }],
      app_after: [
        { key: 'fill', title: '사고·파는 가격을 정합니다', detail: '신호가 난 다음 봉의 시가' },
        { key: 'cost', title: '비용을 뗍니다', detail: '수수료·거래세·슬리피지' },
        { key: 'report', title: '성과를 냅니다', detail: '지표·자산곡선·체결 표' },
      ],
      boundary_after_note: 'entry·exit 두 열만 받습니다',
      nodes: [
        { id: 'params', numeral: '①', title: '조절할 값을 정합니다', lines: [], facts: [], status: 'ok' },
        { id: 'indicators', numeral: '②', title: '가격을 지표로 바꿉니다', lines: [], facts: [], status: 'ok' },
        { id: 'conditions', numeral: '③', title: '사고·파는 순간을 찍습니다', lines: [], facts: [], status: 'ok', drawing: true },
        { id: 'guard', numeral: '④', title: '', lines: [], facts: [], status: 'ok', skeleton: true },
      ],
      free_code: [],
      unknown: [],
      error: null,
      code: null,
    },
    error: null,
  }, extra || {});
}

function sourceCanvas(overrides) {
  const calls = { start: [], status: [], cancel: [] };
  const made = makeCanvas(Object.assign({
    sourceMapStart: async (body) => { calls.start.push(body); return { job_id: 'sm-1' }; },
    sourceMapStatus: async (body) => { calls.status.push(body); return sourceJobAt3of5(); },
    sourceMapCancel: async (body) => { calls.cancel.push(body); },
  }, overrides || {}));
  return Object.assign({ calls }, made);
}

test('보드 17: 채팅이 붙인 주소 하나가 다섯 단계 진행 화면을 연다', async () => {
  const { container, canvas, calls } = sourceCanvas();
  canvas.mount();
  await flush();

  const receipt = canvas.onChatAction({ kind: 'source_url', url: ' https://youtu.be/8kQz ' });
  await flush();

  // 채팅에는 아무 카드도 안 낸다 — 보드 17의 채팅은 사람 말풍선 다음에 「출처 읽음」
  // 하나뿐이다(그 카드는 출처를 실제로 읽은 뒤에 나간다).
  assert.equal(receipt, null);
  assert.deepEqual(calls.start, [{ url: 'https://youtu.be/8kQz' }]);
  // 진행 4요소 — 지금 하는 일 · 몇 단계 중 몇 · 남은 시간 · 멈추기(보드 18 F칸).
  const text = textOf(findByClass(container, 'backtest-source-progress')[0]);
  assert.match(text, /출처를 지도로 만드는 중/);
  assert.match(text, /3\/5 단계/);
  assert.match(text, /약 20초 남음/);
  assert.equal(findByClass(container, 'backtest-source-stop').length, 1);
});

test('보드 17: 다섯 줄의 이름·부제·표식은 전부 잡이 준 것이다', async () => {
  const { container, canvas } = sourceCanvas();
  canvas.mount();
  await flush();
  canvas.onChatAction({ kind: 'source_url', url: 'https://youtu.be/8kQz' });
  await flush();

  const rows = findByClass(container, 'backtest-source-step');
  assert.equal(rows.length, 5);
  assert.equal(textOf(rows[0]), '✓ 출처 읽음 유튜브 · 14,200자');
  assert.equal(textOf(rows[2]), '● 지도 그리는 중 칸 3/4 · 지금 ③ 사고·파는 순간을 찍습니다');
  assert.match(textOf(rows[3]), /^○ 코드 만들기/);
});

test('보드 17: 대상은 출처가 말한 것이고 늘 확인 필요다', async () => {
  const { container, canvas } = sourceCanvas();
  canvas.mount();
  await flush();
  canvas.onChatAction({ kind: 'source_url', url: 'https://youtu.be/8kQz' });
  await flush();

  const strip = findByClass(container, 'backtest-source-target')[0];
  assert.match(textOf(strip), /출처가 말한 대상/);
  assert.match(textOf(strip), /코스피 대형주 · 일봉 · 3년/);
  assert.match(textOf(strip), /확인 필요/);
  assert.match(textOf(strip), /지도가 끝나면 채팅이 대상·기간부터 하나씩 묻습니다/);
});

test('보드 17: 출처가 대상을 말하지 않았으면 그 자리를 비운다(지어내지 않는다)', async () => {
  const { container, canvas } = sourceCanvas({
    sourceMapStatus: async () => sourceJobAt3of5({ target_ko: null }),
  });
  canvas.mount();
  await flush();
  canvas.onChatAction({ kind: 'source_url', url: 'https://youtu.be/8kQz' });
  await flush();

  assert.equal(findByClass(container, 'backtest-source-target-text').length, 0);
  assert.equal(findByClass(container, 'backtest-source-target-badge').length, 1);
});

test('보드 17: 지도는 그린 칸까지만 서고 나머지는 뼈대다', async () => {
  const { container, canvas } = sourceCanvas();
  canvas.mount();
  await flush();
  canvas.onChatAction({ kind: 'source_url', url: 'https://youtu.be/8kQz' });
  await flush();

  assert.match(textOf(container), /칸이 하나씩 채워집니다/);
  assert.match(textOf(container), /여기부터 내 전략 — 출처에서 뽑은 칸들/);
  assert.equal(findByClass(container, 'backtest-flow-drawing').length, 1);
  const skeleton = findByClass(container, 'is-skeleton');
  assert.equal(skeleton.length, 1);
  assert.equal(skeleton[0].disabled, true);
});

test('보드 17: 코드가 아직 없으면 서랍은 「아직 없음」이고 열 버튼이 없다', async () => {
  const { container, canvas } = sourceCanvas();
  canvas.mount();
  await flush();
  canvas.onChatAction({ kind: 'source_url', url: 'https://youtu.be/8kQz' });
  await flush();

  const drawer = findByClass(container, 'backtest-map-drawer')[0];
  assert.match(textOf(drawer), /이 지도 뒤의 코드/);
  assert.match(textOf(drawer), /아직 없음 — 지도가 끝나면 자동으로 만들어집니다/);
  assert.match(textOf(drawer), /최후의 보루/);
  assert.equal(findByClass(container, 'backtest-map-open-code').length, 0);
});

test('보드 17: 코드 줄 수가 나와도 만드는 중 서랍에는 열 버튼이 서지 않는다', async () => {
  // 잡은 ④를 끝낸 뒤에도 ⑤ 자체 검사를 도는 중이다 — 그 사이에 [코드 열기]를 세우면
  // 이 화면에는 그 코드를 여는 자리가 없어 눌러도 아무 일도 안 하는 버튼이 된다.
  const { container, canvas } = sourceCanvas({
    sourceMapStatus: async () => sourceJobAt3of5({ code_lines: 20 }),
  });
  canvas.mount();
  await flush();
  canvas.onChatAction({ kind: 'source_url', url: 'https://youtu.be/8kQz' });
  await flush();

  assert.equal(findByClass(container, 'backtest-map-open-code').length, 0);
  assert.match(
    textOf(findByClass(container, 'backtest-map-drawer')[0]),
    /아직 없음 — 지도가 끝나면 자동으로 만들어집니다/,
  );
});

test('보드 17: 머리는 무엇을 만들고 있는지만 말한다(이름도 판번호도 아직 없다)', async () => {
  const { container, canvas } = sourceCanvas();
  canvas.mount();
  await flush();
  canvas.onChatAction({ kind: 'source_url', url: 'https://youtu.be/8kQz' });
  await flush();

  const head = findByClass(container, 'backtest-head-title')[0];
  assert.match(textOf(head), /새 전략/);
  assert.match(textOf(head), /출처에서 만드는 중/);
  assert.match(textOf(head), /지도 v0/);
  // 고른 기법이 없으니 실행 버튼도 없다 — 돌릴 것이 아직 없다.
  assert.equal(findByClass(container, 'backtest-run-button').length, 0);
});

// 앞 전략을 열어 둔 사람이 주소를 붙이면 머리가 그 전략의 판번호를 물려 쓴다 —
// 「새 전략」이라고 말하면서 「지도 v3」이라 적히는 자리다. 잡이 만드는 지도의 version도
// 0이라 그 숫자는 어느 쪽과도 맞지 않는 가짜 값이었다.
test('보드 17: 앞 전략이 몇 판이었든 만드는 중 머리는 지도 v0이다', async () => {
  const { container, canvas } = sourceCanvas();
  canvas.mount();
  await flush();
  await toForm(container);
  const patch = { symbols: ['005930'], fromDt: '20240101', toDt: '20240630' };
  canvas.onChatAction({ kind: 'spec_draft', patch });
  await flush();
  assert.equal(canvas.onChatAction({ kind: 'spec_draft', patch }).version.to, 3);

  canvas.onChatAction({ kind: 'source_url', url: 'https://youtu.be/8kQz' });
  await flush();

  assert.match(textOf(findByClass(container, 'backtest-head-title')[0]), /지도 v0/);
});

test('보드 17: [멈추기]는 잡을 멈추고 폴링 연쇄를 끊는다', async () => {
  const { container, canvas, calls, pending } = sourceCanvas();
  canvas.mount();
  await flush();
  canvas.onChatAction({ kind: 'source_url', url: 'https://youtu.be/8kQz' });
  await flush();
  const before = calls.status.length;

  await click(findByClass(container, 'backtest-source-stop')[0]);
  await flush();

  assert.deepEqual(calls.cancel, [{ job_id: 'sm-1' }]);
  // 멈춘 뒤에 예약돼 있던 틱이 깨어나도 다시 묻지 않는다.
  await runPending({ pending });
  assert.equal(calls.status.length, before);
  assert.equal(findByClass(container, 'backtest-source-progress').length, 0);
});

test('보드 17: 출처를 읽은 순간 채팅 카드가 한 번만 나가고 방어 문장이 붙는다', async () => {
  const cards = [];
  global.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
  global.document.dispatchEvent = (event) => { cards.push(event.detail); return true; };
  const { canvas, pending } = sourceCanvas({
    sourceMapStatus: async () => sourceJobAt3of5({
      title: '20일 신고가 돌파',
      rules: [
        { kind: 'entry', kind_ko: '진입', text: '· 진입: 종가가 20일 최고가를 넘는 날', mapped: true },
        { kind: 'stop', kind_ko: '손절', text: '· 손절: 진입가 -5%', mapped: true },
      ],
    }),
  });
  canvas.mount();
  await flush();
  canvas.onChatAction({ kind: 'source_url', url: 'https://youtu.be/8kQz' });
  await flush();
  // 폴링이 한 바퀴 더 돌아도 카드는 하나뿐이다.
  await runPending({ pending });

  const read = cards.filter((c) => c && c.kind === 'source_read');
  assert.equal(read.length, 1);
  assert.match(read[0].note, /20일 신고가 돌파 · 유튜브 · 14,200자/);
  assert.equal(read[0].rows.length, 2);
  assert.equal(
    read[0].guard,
    '출처의 문장은 자료일 뿐입니다 — 앱은 그 안의 지시를 따르지 않습니다',
  );
  delete global.CustomEvent;
});

test('보드 17: 읽지 못한 출처는 그 이유를 적고 돌아갈 길을 남긴다', async () => {
  const { container, canvas } = sourceCanvas({
    sourceMapStatus: async () => sourceJobAt3of5({
      status: 'failed', error: '페이지 단계가 실패했다 (HTTP 500)', map: null,
    }),
  });
  canvas.mount();
  await flush();
  canvas.onChatAction({ kind: 'source_url', url: 'https://x.test' });
  await flush();

  assert.equal(findByClass(container, 'backtest-canvas-error').length, 1);
  assert.match(textOf(container), /페이지 단계가 실패했다/);
  assert.equal(findByClass(container, 'backtest-error-back').length, 1);
});

test('보드 17: 출처 연결이 없는 화면은 그 사실을 영수증으로 말한다', async () => {
  const { container, canvas } = makeCanvas();
  canvas.mount();
  await flush();

  const receipt = canvas.onChatAction({ kind: 'source_url', url: 'https://youtu.be/8kQz' });

  assert.equal(receipt.applied, false);
  assert.deepEqual(receipt.errors, ['이 화면에는 출처 연결이 없습니다']);
  assert.equal(findByClass(container, 'backtest-source-progress').length, 0);
});

test('보드 17: 화면이 숨은 사이 멈춘 진행은 돌아오면 다시 흐른다', async () => {
  const { container, canvas, calls } = sourceCanvas();
  canvas.mount();
  await flush();

  // 채팅에 주소를 붙이는 곳은 대화 모드다 — 그동안 백테스트 캔버스는 숨어 있다.
  container.hidden = true;
  canvas.onChatAction({ kind: 'source_url', url: 'https://youtu.be/8kQz' });
  await flush();
  assert.equal(calls.status.length, 0, '숨은 화면은 잡을 묻지 않는다');

  container.hidden = false;
  canvas.refresh();
  await flush();

  assert.equal(calls.status.length, 1);
  assert.equal(findByClass(container, 'backtest-source-step').length, 5);
});

// 다 그린 잡 한 장 — 5/5에 폼이 읽을 스펙 원문(백엔드 spec_to_yaml)이 실려 있다.
function sourceJobDone(extra) {
  return sourceJobAt3of5(Object.assign({
    status: 'done',
    step_index: 5,
    eta_seconds: null,
    steps: [
      { id: 'read', state: 'done', title_ko: '출처 읽음', meta_ko: '유튜브 · 14,200자' },
      { id: 'rules', state: 'done', title_ko: '규칙 뽑음', meta_ko: '진입 2 · 청산 1 · 손절 1' },
      { id: 'map', state: 'done', title_ko: '지도 그림', meta_ko: '칸 4개' },
      { id: 'code', state: 'done', title_ko: '코드 만듦', meta_ko: '20줄' },
      { id: 'check', state: 'done', title_ko: '자체 검사 마침', meta_ko: '검사 3/3 통과' },
    ],
    map_filled: 4,
    code_lines: 20,
    spec_yaml: SMA_YAML,
  }, extra || {}));
}

test('보드 17: 다 그린 지도는 설계 화면의 전략이 된다 — 「만드는 중」이 남지 않는다', async () => {
  const asked = [];
  const { container, canvas } = sourceCanvas({
    sourceMapStatus: async () => sourceJobDone(),
    map: async (body) => { asked.push(body); return MAP_PAYLOAD; },
  });
  canvas.mount();
  await flush();

  canvas.onChatAction({ kind: 'source_url', url: 'https://youtu.be/8kQz' });
  await flush();

  assert.equal(findByClass(container, 'backtest-source-progress').length, 0);
  assert.equal(findByClass(container, 'backtest-source-stop').length, 0);
  // 잡이 만든 스펙이 폼에 들어갔다 — 머리에 그 이름이 서고 지도는 그 스펙으로 다시 그린다.
  assert.match(textOf(findByClass(container, 'backtest-head-title')[0]), /SMA 골든크로스/);
  assert.equal(asked.length, 1);
  assert.match(asked[0].yaml, /SMA 골든크로스/);
  assert.equal(asked[0].source, undefined, '앞 전략의 코드로 새 지도를 그리지 않는다');
  assert.equal(findByClass(container, 'backtest-flow-map').length, 1);
});

test('보드 17: 새 주소가 오면 앞 잡을 멈추고 새로 띄운다', async () => {
  let started = 0;
  const { canvas, calls } = sourceCanvas({
    sourceMapStart: async () => { started += 1; return { job_id: `sm-${started}` }; },
  });
  canvas.mount();
  await flush();

  canvas.onChatAction({ kind: 'source_url', url: 'https://youtu.be/8kQz' });
  await flush();
  canvas.onChatAction({ kind: 'source_url', url: 'https://blog.example/2' });
  await flush();

  assert.deepEqual(calls.cancel, [{ job_id: 'sm-1' }]);
  assert.equal(started, 2);
});


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

test('보드 19: mount 직후는 기법 목록이고 프리셋 0번을 자동으로 고르지 않는다', async () => {
  const { container, canvas } = makeCanvas();
  canvas.mount();
  await flush();
  assert.equal(findByClass(container, 'backtest-technique-list').length, 1);
  assert.match(textOf(container), /새 기법 만들기/);
  assert.equal(findByClass(container, 'backtest-technique-new-chip')[0].textContent, '대화로 시작');
  assert.equal(findByClass(container, 'backtest-subtab').length, 0);
  const tabs = findByClass(container, 'backtest-tab').map((t) => t.textContent);
  assert.deepEqual(tabs, ['기법', '결과', '이력']);
  assert.equal(findByClass(container, 'backtest-symbol-add').length, 0);
  assert.equal(findByClass(container, 'backtest-run-button').length, 0);
  const ctx = canvas.getContext();
  assert.equal(ctx.spec, null);
  assert.equal(ctx.designTab, 'form');
  assert.equal(textOf(container).includes('data.symbols'), false);
  assert.equal(textOf(container).includes('pydantic'), false);
});

test('empty → design: 프리셋 목록·대상·지표·조건·리스크 카드를 모두 그린다', async () => {
  const { container, canvas } = makeCanvas();
  canvas.mount();
  await flush();
  await toForm(container);
  // 목록은 홈에만 선다 — 기법 하나의 화면에는 목록으로 돌아가는 문만 있다.
  assert.equal(findByClass(container, 'backtest-preset-item').length, 0);
  assert.equal(findByClass(container, 'backtest-head-home').length, 1);
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
  assert.ok(findByClass(container, 'backtest-subtab').length, '설계 화면으로 돌아온다');
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

async function toRunning(extra) {
  const made = await toApproval(Object.assign({
    backfill: async () => ({ job_id: 'j1' }),
    status: async () => ({ status: 'running', progress: { page: 1, rows: 100, oldest_dt: '20240101' } }),
  }, extra || {}));
  await click(findByClass(made.container, 'backtest-approval-confirm')[0]);
  await flush();
  return made;
}

test('수집 중 화면에 중단 버튼과 이어짐 안내가 있다 — 막다른 길이 아니다', async () => {
  const { container } = await toRunning();
  const stop = findByClass(container, 'backtest-running-stop');
  assert.equal(stop.length, 1);
  assert.equal(stop[0].textContent, '중단');
  assert.match(textOf(container), /끝나면 바로 백테스트가 이어집니다/);
});

test('중단을 누르면 잡 취소 IPC를 부른다 — 폴링만 멈추지 않는다', async () => {
  const cancelled = [];
  const { container } = await toRunning({
    cancelJob: async (body) => { cancelled.push(body); return { ok: true }; },
  });
  await click(findByClass(container, 'backtest-running-stop')[0]);
  await flush();
  assert.deepEqual(cancelled, [{ job_id: 'j1' }]);
  // 수집 화면을 빠져나와 설계로 돌아간다.
  assert.equal(findByClass(container, 'backtest-running-stop').length, 0);
});

test('중단 뒤에 늦게 돌아온 수집 응답이 백테스트를 시작하지 않는다', async () => {
  let release = null;
  const { container, calls } = await toRunning({
    status: () => new Promise((resolve) => { release = () => resolve({ status: 'done' }); }),
    cancelJob: async () => ({ ok: true }),
  });
  // 첫 틱이 status 안에 들어가 있는 사이에 사람이 「중단」을 누른다.
  await click(findByClass(container, 'backtest-running-stop')[0]);
  await flush();
  release();
  await flush();
  await flush();
  // run은 승인 카드를 띄운 첫 호출 하나뿐이어야 한다 — 늦게 온 done이 실행을 열지 않는다.
  assert.equal(calls.length, 1);
  assert.equal(findByClass(container, 'backtest-canvas-error').length, 0);
  assert.ok(findByClass(container, 'backtest-subtab').length, '설계 화면으로 돌아온다');
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
  assert.ok(findByClass(container, 'backtest-subtab').length, '설계 화면으로 돌아온다');
  // 목록(홈)으로 가는 문도 있다.
  await toList(container);
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

// 기법 하나의 화면에서 목록(홈)으로 — 헤더의 [기법 목록]/[그만두기]. 목록이 이미 서 있으면
// 그대로다. 목록은 홈에만 선다(2026-09-07 사용자 확정: 한 페이지 = 한 알고리즘).
async function toList(container) {
  const home = findByClass(container, 'backtest-head-home')[0];
  if (home) { await click(home); await flush(); }
}

async function clickNewTechnique(made) {
  await toList(made.container);
  await click(findByClass(made.container, 'backtest-technique-new')[0]);
  await flush();
}

function subtabNamed(container, label) {
  return findByClass(container, 'backtest-subtab').find((t) => t.textContent === label);
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
  assert.deepEqual(receipt.errors, ['nope는 없는 기법입니다']);
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
  // 헤더가 바뀐 전략을 말한다 — 목록은 홈에만 서고 홈은 전략을 내려놓는 자리다.
  assert.equal(findByClass(container, 'backtest-head-strategy')[0].textContent, 'RSI 과매도');

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

// ── 보드 05 · 이력 비교 diff 두 칸 ──────────────────────────────────────────

const COMPARE_DETAIL = {
  run_a: {
    status: 'done', equity: [{ dt: '20240101', equity: 1, drawdown: 0 }],
    params: { fast: 10, slow: 40 }, version: 3, source: 'a\nb\nc\n',
  },
  run_b: {
    status: 'done', equity: [{ dt: '20240101', equity: 1, drawdown: 0 }],
    params: { fast: 20, slow: 60 }, version: 4, source: 'a\nB\nc\n',
  },
};

async function toCompare() {
  const made = await mounted({
    runs: async () => ([
      { run_id: 'run_a', status: 'done', metrics: { total_return: 0.1 } },
      { run_id: 'run_b', status: 'done', metrics: { total_return: 0.2 } },
    ]),
    result: async ({ run_id }) => COMPARE_DETAIL[run_id],
  });
  made.canvas.onChatAction({ kind: 'navigate', tab: 'history' });
  await flush();
  // 한 번 누를 때마다 다시 그리므로 두 번째 행은 새로 찾는다.
  await click(findByClass(made.container, 'backtest-history-row')[0]);
  await flush();
  await click(findByClass(made.container, 'backtest-history-row')[1]);
  await flush();
  return made;
}

test('비교 패널에 파라미터 diff와 코드 diff 두 칸이 선다', async () => {
  const { container } = await toCompare();
  const labels = findByClass(container, 'backtest-compare-diff-label').map((n) => n.textContent);
  assert.deepEqual(labels, ['파라미터 diff', '코드 diff']);
  const values = findByClass(container, 'backtest-compare-diff-value').map((n) => n.textContent);
  assert.equal(values[0], 'fast 10→20 · slow 40→60');
  assert.equal(values[1], 'v3→v4 · 2줄');
  // 두 버전의 소스가 그대로 줄 diff로 선다(보드 02·09와 같은 문법).
  assert.equal(findByClass(container, 'backtest-diff').length, 1);
});

test('파라미터 diff는 키 단위로 변한 값만 적는다', () => {
  assert.equal(
    backtestCanvas.paramsDiffText({ fast: 10, slow: 40 }, { fast: 20, slow: 60 }),
    'fast 10→20 · slow 40→60',
  );
  // 같은 값인 키는 적지 않는다.
  assert.equal(
    backtestCanvas.paramsDiffText({ fast: 10, slow: 40 }, { fast: 10, slow: 60 }),
    'slow 40→60',
  );
  // 한쪽을 모르면 지어내지 않고 빈 문자열이다.
  assert.equal(backtestCanvas.paramsDiffText(null, { fast: 20 }), '');
  assert.equal(backtestCanvas.paramsDiffText({ fast: 10 }, { fast: 10 }), '');
});

test('코드 diff 칸은 버전 쌍과 바뀐 줄 수를 적는다', () => {
  assert.equal(
    backtestCanvas.codeDiffText({ version: 3, source: 'a\nb\n' }, { version: 4, source: 'a\nB\n' }),
    'v3→v4 · 2줄',
  );
  assert.equal(
    backtestCanvas.codeDiffText({ version: 4, source: 'a\n' }, { version: 4, source: 'a\n' }),
    '같은 버전 v4',
  );
  assert.equal(backtestCanvas.codeDiffText(null, { version: 4, source: '' }), '');
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
  assert.deepEqual(backtestCanvas.MODE_TABS.map((t) => t[1]),
    ['기법', '결과', '이력', '최적화', '배포']);
  assert.deepEqual(backtestCanvas.MODE_TABS_LIST.map((t) => t[1]),
    ['기법', '결과', '이력']);
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

// 이 폴더의 strategy.py를 가리키는 등록부 줄 — 기법 화면은 목록에서 이 줄을 눌러 들어간다.
const PROJECT_STRATEGY = {
  id: 'u0', name: 'strategy', project_id: 'p1', path: 'strategy.py', exists: true, params: {},
};

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
    userStrategies: async () => [PROJECT_STRATEGY],
  }, overrides || {});
}

// 폼(대상·기간)을 채우고 → 목록으로 → 이 폴더의 기법을 고른다. 기법 화면이 열리며 그 파일이
// 편집기에 들어온다 — 코드 탭에서 폴더를 고르는 길은 없다(기법 하나의 화면, 보드 20).
async function openProjectFile(made) {
  await fillForm(made.container);
  await toList(made.container);
  await toList(made.container);
  await click(findByClass(made.container, 'backtest-user-strategy-item')[0]);
  await flush();
  await flush();
}

test('코드 탭: 프로젝트 배선이 없으면 지금까지의 단일 편집기 그대로다', async () => {
  const { container } = await mounted();
  await click(findByClass(container, 'backtest-subtab')[2]);
  assert.equal(findByClass(container, 'project-ide').length, 0);
  assert.equal(findByClass(container, 'backtest-code-textarea').length, 1);
  assert.equal(findByClass(container, 'backtest-code-save').length, 1);
});

test('코드 탭: 프리셋은 단일 편집기, 폴더가 있는 기법은 그 폴더의 편집기 — 폴더를 고르는 줄은 없다', async () => {
  const made = await mounted(projectDeps());
  await click(findByClass(made.container, 'backtest-subtab')[2]);
  await flush();
  // 프리셋(yaml)에는 폴더가 없다 — 지금까지의 단일 편집기와 경계 카드다.
  assert.equal(findByClass(made.container, 'project-ide').length, 0);
  assert.equal(findByClass(made.container, 'backtest-code-textarea').length, 1);
  assert.equal(findByClass(made.container, 'backtest-code-save').length, 1);
  assert.equal(findByClass(made.container, 'backtest-code-bounds').length, 1);
  // 목록에서 폴더가 있는 기법을 고르면 그 폴더 하나의 편집기가 코드 탭이다.
  await openProjectFile(made);
  assert.equal(findByClass(made.container, 'project-ide-body').length, 1);
  assert.equal(findByClass(made.container, 'backtest-code-save').length, 0);
  assert.equal(findByClass(made.container, 'backtest-code-bounds').length, 0, '기법 화면에는 경계 카드가 없다(보드 20)');
  // 다른 폴더를 고르는 줄·새 프로젝트·폴더 열기는 없다 — 한 페이지는 한 알고리즘만 다룬다.
  assert.equal(findByClass(made.container, 'project-ide-project').length, 0);
  assert.doesNotMatch(textOf(made.container), /새 프로젝트|폴더 열기/);
  // 헤더는 폴더 이름과 목록으로 돌아가는 문이다 — 모드 탭·폼/코드 갈래는 없다.
  assert.equal(findByClass(made.container, 'backtest-head-folder')[0].textContent, '내 전략/');
  assert.match(findByClass(made.container, 'backtest-head-folder-sub')[0].textContent, /폴더 하나가 기법 하나 · 대화 하나 · 1개 파일/);
  assert.equal(findByClass(made.container, 'backtest-head-home')[0].textContent, '기법 목록');
  assert.equal(findByClass(made.container, 'backtest-tab').length, 0);
  assert.equal(findByClass(made.container, 'backtest-runpath').length, 0);
  assert.deepEqual(
    findByClass(made.container, 'backtest-subtab').map((t) => t.textContent),
    ['코드', '노드·흐름', '폼', '배포'],
  );
  // 왼쪽 열 — 기법 폴더 트리와 다짐 한 줄(보드 20).
  assert.equal(findByClass(made.container, 'project-ide-side-title')[0].textContent, '기법 폴더');
  assert.match(textOf(made.container), /이 폴더 밖은 AI가 건드리지 않습니다/);
  // [기법 목록]으로 돌아가면 목록이고, 앞 기법의 파일은 실행 대상이 아니다.
  await toList(made.container);
  assert.equal(findByClass(made.container, 'backtest-technique-list').length, 1);
  assert.equal(made.canvas.getContext().project, null);
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

  // 저장하면(Ctrl+S — 자동 저장은 타이머를 기다린다) 그 본문 그대로 돈다.
  await findByClass(made.container, 'project-ide')[0].dispatchEvent({ type: 'keydown', key: 's', ctrlKey: true });
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
// 폴더만 고르는 길은 없어졌다 — 폴더는 기법을 고를 때 그 파일과 함께 열린다.
async function selectProjectOnly(made) {
  await openProjectFile(made);
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
  assert.deepEqual(blocked.errors, ['기법 목록에서 폴더가 있는 기법을 먼저 고르세요']);

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

test('기법 목록: 내가 만든 기법도 같은 목록에 선다 — 묶음은 하나뿐이다', async () => {
  const { container } = await mounted(userStrategyDeps());
  await flush();
  await toList(container);
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

test('기법 목록: 등록부 배선이 없으면 내가 만든 기법 줄이 없을 뿐 목록은 그대로다', async () => {
  const { container } = await mounted();
  await toList(container);
  assert.equal(findByClass(container, 'backtest-user-strategy-item').length, 0);
  assert.equal(findByClass(container, 'backtest-preset-item').length, 1);
  assert.match(textOf(container), /기법 — 1개/);
});

test('기법 카드: 이름·분류 칩(한국어)·한 줄 설명이 함께 선다', async () => {
  const { container } = await mounted();
  await toList(container);
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
    await clickNewTechnique(made);
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
  await clickNewTechnique(made);
  assert.equal(made.canvas.getContext().techniqueDraft, true);
  // 초안에는 폼 탭이 없다 — 목록으로 돌아가는 문은 헤더의 [그만두기] 하나다.
  assert.equal(findByClass(made.container, 'backtest-head-home')[0].textContent, '그만두기');
  await click(findByClass(made.container, 'backtest-head-home')[0]);
  await flush();
  assert.equal(made.canvas.getContext().techniqueDraft, false);
  assert.equal(findByClass(made.container, 'backtest-technique-list').length, 1, '홈으로 돌아온다');
  await click(findByClass(made.container, 'backtest-preset-item')[0]);
  await flush();
  const ctx = made.canvas.getContext();
  assert.equal(ctx.techniqueDraft, false);
  assert.equal(ctx.runPath, 'form');
  assert.equal(ctx.code.source, '');
});

// ── 보드 19 → 20 · 목록 화면에서 대화가 먼저 시작될 때 ────────────────────────
//
// 목록 화면은 spec이 없는 화면이다. 그 자리에서 모델이 설정·코드를 보내면 예전에는
// 「프리셋이 없어…」로 막히거나(설정), 「반영됨」이라 해놓고 화면 어디에도 코드가
// 없었다. 보드 19의 약속은 하나다 — 목록 화면에서 대화로 시작하면 새 기법 흐름이
// 열린다. [+ 새 기법 만들기]를 누른 것과 같은 뼈대 위에 얹는다.

// 고르지 않은 첫 화면 그대로 — mounted()와 달리 프리셋을 고르지 않는다.
async function listMounted(overrides) {
  const made = makeCanvas(overrides);
  made.canvas.mount();
  await flush();
  return made;
}

// document.dispatchEvent로 나가는 athena:chat-submit을 잰다.
async function withChatSubmits(fn) {
  const sent = [];
  const prevCustomEvent = global.CustomEvent;
  global.CustomEvent = class {
    constructor(type, init) { this.type = type; this.detail = init && init.detail; }
  };
  global.document.dispatchEvent = (event) => { sent.push(event); return true; };
  try { await fn(); } finally { global.CustomEvent = prevCustomEvent; }
  return sent.filter((e) => e.type === 'athena:chat-submit');
}

test('목록 화면에서 온 설정은 새 기법 뼈대를 세우고 그 위에 얹는다', async () => {
  const submits = await withChatSubmits(async () => {
    const made = await listMounted();
    const receipt = made.canvas.onChatAction({
      kind: 'spec_draft', patch: { symbols: ['005930'] },
    });
    await flush();
    assert.equal(receipt.applied, true);
    assert.deepEqual(receipt.errors.includes('기법이 없어 설정을 얹을 수 없습니다'), false);
    const ctx = made.canvas.getContext();
    assert.equal(ctx.techniqueDraft, true);
    assert.equal(ctx.spec.name, '새 기법');
    assert.deepEqual(ctx.spec.symbols, ['005930']);
    // 초안에는 지도도 폼도 없다 — 컨텍스트가 화면에 없는 탭을 말하면 안 된다.
    assert.equal(ctx.designTab, 'code');
    assert.equal(ctx.runPath, 'code');
    assert.equal(findByClass(made.container, 'backtest-technique-list').length, 0);
    const labels = findByClass(made.container, 'backtest-subtab').map((t) => t.textContent);
    assert.deepEqual(labels, ['코드', '노드·흐름']);
  });
  // 첫 문장은 사람이 [+ 새 기법 만들기]를 눌렀을 때만 나간다 — 대화가 이미 시작된
  // 자리에서 또 보내면 모델이 자기 말에 답하는 고리가 된다.
  assert.deepEqual(submits, []);
});

test('목록 화면에서 온 코드는 뼈대 위에 얹히고 코드창이 실제로 선다', async () => {
  const source = 'import athena_bt as bt\nPARAMS = {"n": 5}\n';
  const made = await listMounted();
  const receipt = made.canvas.onChatAction({ kind: 'code_draft', source, note: '초안' });
  await flush();
  assert.equal(receipt.applied, true);
  assert.equal(receipt.designTab, 'code');
  const ctx = made.canvas.getContext();
  assert.equal(ctx.techniqueDraft, true);
  assert.equal(ctx.code.source, source);
  assert.equal(ctx.designTab, 'code');
  // 「반영됨」이라 했으면 화면에 있어야 한다 — 목록이 아니라 편집기다.
  assert.equal(findByClass(made.container, 'backtest-technique-list').length, 0);
  assert.equal(findByClass(made.container, 'backtest-code-editor').length, 1);
  const labels = findByClass(made.container, 'backtest-subtab').map((t) => t.textContent);
  assert.deepEqual(labels, ['코드', '노드·흐름']);
});

test('목록 화면이어도 아는 기법 id가 든 설정은 그 기법을 고른다', async () => {
  const made = await listMounted();
  const receipt = made.canvas.onChatAction({
    kind: 'spec_draft', patch: { preset: 'sma_crossover' },
  });
  await flush();
  assert.equal(receipt.applied, true);
  const ctx = made.canvas.getContext();
  assert.equal(ctx.techniqueDraft, false, '새 기법이 아니라 고른 기법이다');
  assert.equal(ctx.spec.presetId, 'sma_crossover');
  assert.equal(ctx.designTab, 'flow');
});

test('목록 화면의 navigate는 하위 탭을 반영하지 않고 이유를 돌려준다', async () => {
  const made = await listMounted();
  const receipt = made.canvas.onChatAction({
    kind: 'navigate', tab: 'design', designTab: 'flow',
  });
  await flush();
  assert.equal(receipt.applied, false);
  assert.deepEqual(receipt.errors, ['기법을 먼저 고르세요']);
  const ctx = made.canvas.getContext();
  assert.equal(ctx.designTab, 'form', '없는 탭으로 컨텍스트만 옮기지 않는다');
  assert.equal(findByClass(made.container, 'backtest-technique-list').length, 1);
});

test('목록 화면에서도 모드 탭 이동(이력)은 그대로 반영된다', async () => {
  const made = await listMounted({ fetchHistory: async () => [] });
  const receipt = made.canvas.onChatAction({ kind: 'navigate', tab: 'history' });
  await flush();
  assert.equal(receipt.applied, true);
  assert.equal(made.canvas.getContext().tab, 'history');
});

// 위 두 케이스를 **실제 앱의 배선**(폴더 생성 + 파일 쓰기)에서 다시 본다. 폴더 만들기는
// 비동기라 그 사이에 얹힌 코드가 씨앗 쓰기에 덮일 수 있고, 막힐 설정이 폴더를 남길 수
// 있다 — 단일 버퍼 배선에서는 둘 다 보이지 않는 자리다.

test('폴더 배선에서도 목록 화면에서 온 코드가 디스크와 편집기에 남는다', async () => {
  const calls = techniqueCalls();
  const source = ['import athena_bt as bt', '', 'PARAMS = {"n": 5}', '', '',
    'def signals(df, p):', '    return df', ''].join('\n');
  const made = await listMounted(techniqueProjectDeps(calls));
  const receipt = made.canvas.onChatAction({ kind: 'code_draft', source, note: '초안' });
  assert.equal(receipt.applied, true);
  for (let i = 0; i < 8; i += 1) await flush();
  // 폴더 하나에 뼈대 두 파일 — 그런데 strategy.py에 남는 것은 빈 뼈대가 아니라 그 코드다.
  assert.equal(calls.created.length, 1);
  const strategy = calls.writes.filter((w) => w.path === 'strategy.py').pop();
  assert.equal(strategy.text, source, '빈 뼈대가 방금 반영한 코드를 덮으면 안 된다');
  const ctx = made.canvas.getContext();
  assert.equal(ctx.code.source, source);
  assert.equal(ctx.project.activeFile, 'strategy.py');
  assert.equal(findByClass(made.container, 'project-ide').length, 1);
  // 「반영됨」이라 했으면 화면에도 그 코드가 있어야 한다 — 도는 것과 보이는 것이 같다.
  assert.equal(findByTag(made.container, 'textarea')[0].value, source);
});

test('폴더 배선에서 모르는 기법 id는 뼈대도 폴더도 만들지 않는다', async () => {
  const calls = techniqueCalls();
  const made = await listMounted(techniqueProjectDeps(calls));
  const receipt = made.canvas.onChatAction({ kind: 'spec_draft', patch: { preset: 'nope' } });
  for (let i = 0; i < 8; i += 1) await flush();
  assert.equal(receipt.applied, false);
  assert.deepEqual(receipt.errors, ['nope는 없는 기법입니다']);
  // 되돌렸다고 답해놓고 폴더만 쌓이면 모델이 id를 틀릴 때마다 빈 폴더가 남는다.
  assert.deepEqual(calls.created, []);
  assert.deepEqual(calls.writes, []);
  const ctx = made.canvas.getContext();
  assert.equal(ctx.techniqueDraft, false);
  assert.equal(findByClass(made.container, 'backtest-technique-list').length, 1);
});

test('내 전략을 고르면 그 파일이 IDE에 열리고 실행경로가 코드로 바뀐다', async () => {
  const made = await mounted(userStrategyDeps());
  await flush();
  await fillForm(made.container);
  await toList(made.container);
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
  await toList(made.container);
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
  await toList(made.container);
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

// ── 처음 있던 기법(프리셋)도 같은 기법 화면이다(2026-09-07 사용자 확정) ─────────
// 폴더 배선(codegen · 프로젝트 채널)이 있으면 프리셋을 고르는 것은 내 기법을 고르는 것과 같다:
// yaml에서 파이썬을 만들어 그 기법의 폴더에 두고 strategy.py를 편집기에 연다. 배선이 없는
// 하네스(위 mounted())에서는 지금까지의 지도·폼 표면이 선다 — 그 계약은 위 테스트들이 잔다.

const PRESET_SOURCE = [
  'import athena_bt as bt',
  '',
  'PARAMS = {"fast": {"default": 20, "min": 5, "max": 60}, "slow": {"default": 60, "min": 20, "max": 240}}',
  '',
  '',
  'def signals(df, p):',
  '    return df',
  '',
].join('\n');

// 가짜 디스크 + 프로젝트 배선 + codegen. createProject는 관리형 폴더처럼 씨앗을 갖고 태어난다.
function presetWorkspaceDeps(calls, overrides) {
  const disk = {};
  const projects = [];
  return Object.assign(projectDeps({
    createProject: async (name) => {
      calls.created.push(name);
      const project = {
        id: `pp-${projects.length + 1}`, name: String(name), path: `C:/x/${name}`,
        kind: 'managed', created_at: '2026-09-07T00:00:00Z', exists: true, py_files: 1,
      };
      projects.push(project);
      disk['strategy.py'] = '# 씨앗\n';
      return { project, seed: 'strategy.py' };
    },
    listProjects: async () => ({ projects: projects.slice(), notice: null }),
    projectTree: async () => ({
      entries: Object.keys(disk).map((path) => ({
        name: path.split('/').pop(), path, is_dir: false, py: /\.py$/i.test(path), size: 1,
      })),
      truncated: false,
    }),
    readProjectFile: async (_id, path) => {
      if (!(path in disk)) throw new Error('파일이 존재하지 않는다');
      return { path, text: disk[path] };
    },
    writeProjectFile: async (id, path, text) => {
      calls.writes.push({ id, path, text });
      disk[path] = text;
      return { path, size: text.length, mtime: 1 };
    },
    codegen: async (body) => { calls.codegen.push(body); return { source: PRESET_SOURCE }; },
    userStrategies: async () => [],
  }), overrides || {});
}

function presetCalls() {
  return { created: [], writes: [], codegen: [], map: [], nodes: [] };
}

// 목록(홈)에서 시작한다 — mounted()는 폼을 보려고 프리셋을 한 번 눌러 두는데, 배선이 있으면
// 그 클릭이 이미 폴더를 열어 셈이 하나 어긋난다.
async function mountedList(overrides) {
  const made = makeCanvas(overrides);
  made.canvas.mount();
  await flush();
  return made;
}

// 목록에서 프리셋을 누른 뒤 폴더·파일까지 다 열리기를 기다린다.
async function openPreset(made) {
  await toList(made.container);
  await click(findByClass(made.container, 'backtest-preset-item')[0]);
  for (let i = 0; i < 6; i += 1) await flush();
}

test('프리셋을 고르면 그 기법의 폴더가 열린다 — 코드는 yaml에서 만들고 폴더는 한 번만 만든다', async () => {
  const calls = presetCalls();
  const made = await mountedList(presetWorkspaceDeps(calls, {
    map: async (body) => { calls.map.push(body); return MAP_PAYLOAD; },
  }));
  await openPreset(made);
  // 코드는 그 기법의 yaml에서 나오고, 폴더 이름은 기법 이름이다(경로 한 조각으로 다듬어).
  assert.equal(calls.codegen.length, 1);
  assert.match(calls.codegen[0].yaml, /sma_crossover/);
  assert.deepEqual(calls.created, ['SMA-골든크로스']);
  assert.deepEqual(calls.writes.map((w) => w.path), ['strategy.py', 'tests/test_strategy.py']);
  assert.equal(calls.writes[0].text, PRESET_SOURCE);
  // 기법 하나의 화면이다 — 폴더 헤더, [기법 목록], 모드 탭 없음, 지도 없음.
  const ctx = made.canvas.getContext();
  assert.equal(ctx.runPath, 'code');
  assert.equal(ctx.project.name, 'SMA-골든크로스');
  assert.equal(ctx.project.activeFile, 'strategy.py');
  assert.equal(ctx.designTab, 'code');
  assert.equal(ctx.code.source, PRESET_SOURCE);
  assert.equal(findByClass(made.container, 'backtest-head-folder')[0].textContent, 'SMA-골든크로스/');
  assert.equal(findByClass(made.container, 'backtest-head-home')[0].textContent, '기법 목록');
  assert.equal(findByClass(made.container, 'backtest-tab').length, 0);
  assert.deepEqual(
    findByClass(made.container, 'backtest-subtab').map((t) => t.textContent),
    ['코드', '노드·흐름', '폼', '배포'],
  );
  assert.equal(calls.map.length, 0, '지도를 만들지 않는다');
  assert.equal(findByClass(made.container, 'backtest-code-textarea')[0].value, PRESET_SOURCE);
  assert.equal(findByClass(made.container, 'project-ide-side').length, 1);
  // 다시 고르면 같은 폴더다 — 폴더를 또 만들지도, 파일을 다시 쓰지도 않는다.
  await openPreset(made);
  assert.deepEqual(calls.created, ['SMA-골든크로스']);
  assert.equal(calls.writes.length, 2);
  assert.equal(calls.codegen.length, 2, '코드는 매번 만들지만 폴더가 있으면 그 파일이 이긴다');
  assert.equal(made.canvas.getContext().project.activeFile, 'strategy.py');
});

test('프리셋 폼: 지표·조건 카드 대신 파라미터 카드다 — 슬라이더는 실행에 params로 얹힌다', async () => {
  const calls = presetCalls();
  let sent = null;
  const made = await mountedList(presetWorkspaceDeps(calls, {
    run: async (body) => { sent = body; return { run_id: 'r1' }; },
    result: async () => ({ status: 'running' }),
  }));
  await openPreset(made);
  await fillForm(made.container);
  await toForm(made.container);
  assert.equal(findByClass(made.container, 'backtest-indicator-row').length, 0);
  assert.equal(findByClass(made.container, 'backtest-condition-card').length, 0);
  assert.match(textOf(made.container), /범위는 기법이 정한 값입니다/);
  const sliders = findByClass(made.container, 'backtest-param-slider');
  assert.equal(sliders.length, 2);
  assert.equal(sliders[0].getAttribute('max'), '60', 'yaml의 범위 그대로다');
  sliders[0].value = '35';
  await sliders[0].dispatchEvent({ type: 'input' });
  await click(findByClass(made.container, 'backtest-run-button')[0]);
  await flush();
  assert.equal(sent.source, PRESET_SOURCE, '도는 것은 폴더의 파일이다');
  assert.equal(sent.project_id, 'pp-1');
  assert.equal(sent.params.fast, 35);
  assert.equal(sent.params.slow, 60);
});

test('프리셋 노드·흐름: 열린 파일이 원문이다 — 지도 뒤의 코드를 다시 만들지 않는다', async () => {
  const calls = presetCalls();
  const seen = {};
  const made = await mountedList(presetWorkspaceDeps(calls, {
    techniqueNodesLib: fakeNodesLib(seen),
    techniqueNodes: async (body) => { calls.nodes.push(body); return NODES_RESPONSE; },
  }));
  await openPreset(made);
  await click(subtabNamed(made.container, '노드·흐름'));
  await flush();
  await flush();
  assert.deepEqual(calls.nodes, [{ source: PRESET_SOURCE }]);
  assert.equal(calls.codegen.length, 1, '폴더를 열 때 한 번뿐이다');
  assert.equal(made.canvas.getContext().designTab, 'nodes');
});

test('프리셋: 폴더를 못 만들면 화면 버퍼로 열고 그 사실을 적는다 — 실행은 그 코드를 싣는다', async () => {
  const calls = presetCalls();
  let sent = null;
  const made = await mountedList(presetWorkspaceDeps(calls, {
    createProject: async () => { throw new Error('프로젝트 API 없음'); },
    run: async (body) => { sent = body; return { run_id: 'r1' }; },
    result: async () => ({ status: 'running' }),
  }));
  await openPreset(made);
  await fillForm(made.container);
  // 폼을 채운 뒤 코드 탭으로 — 버퍼로 물러난 사실과 코드는 코드 탭에 적힌다.
  await click(subtabNamed(made.container, '코드'));
  const ctx = made.canvas.getContext();
  assert.equal(ctx.project, null);
  assert.equal(ctx.code.source, PRESET_SOURCE);
  assert.match(textOf(made.container), /폴더를 만들지 못해 화면 버퍼로 엽니다 — 프로젝트 API 없음/);
  assert.match(findByClass(made.container, 'backtest-head-folder-sub')[0].textContent, /폴더 없이 화면 버퍼로/);
  assert.equal(findByClass(made.container, 'backtest-code-textarea')[0].value, PRESET_SOURCE);
  assert.equal(findByClass(made.container, 'backtest-code-save').length, 0, '기법 화면에는 버튼이 없다');
  await click(findByClass(made.container, 'backtest-run-button')[0]);
  await flush();
  assert.equal(sent.source, PRESET_SOURCE);
  assert.equal(sent.project_id, undefined);
  assert.equal(sent.params.fast, 20, '버퍼 코드에도 슬라이더 값이 얹힌다');
});

test('프리셋: [기법 목록]으로 나가면 폴더·파일을 내려놓고, 다시 고르면 그 폴더가 되살아난다', async () => {
  const calls = presetCalls();
  const made = await mountedList(presetWorkspaceDeps(calls));
  await openPreset(made);
  await toList(made.container);
  assert.equal(findByClass(made.container, 'backtest-technique-list').length, 1);
  assert.equal(made.canvas.getContext().project, null);
  assert.equal(made.canvas.getContext().runPath, 'form');
  await openPreset(made);
  assert.equal(made.canvas.getContext().project.activeFile, 'strategy.py');
  assert.deepEqual(calls.created, ['SMA-골든크로스']);
});

test('대화가 기법을 고르면(spec_draft preset) 그 기법의 화면으로 간다 — 바뀐 파라미터가 코드에 실린다', async () => {
  const calls = presetCalls();
  const made = await mountedList(presetWorkspaceDeps(calls, {
    fetchPresets: async () => TWO_PRESETS,
    map: async (body) => { calls.map.push(body); return MAP_PAYLOAD; },
  }));
  await toList(made.container);
  const receipt = made.canvas.onChatAction({
    kind: 'spec_draft', patch: { preset: 'rsi_reversal', params: { period: 7 } },
  });
  assert.equal(receipt.applied, true);
  for (let i = 0; i < 6; i += 1) await flush();
  assert.deepEqual(calls.created, ['RSI-과매도']);
  assert.equal(calls.codegen.length, 1);
  assert.match(calls.codegen[0].yaml, /rsi_reversal/);
  assert.match(calls.codegen[0].yaml, /default: 7/, '대화가 바꾼 값이 코드에 실린다');
  assert.equal(calls.map.length, 0);
  const ctx = made.canvas.getContext();
  assert.equal(ctx.designTab, 'code');
  assert.equal(ctx.project.name, 'RSI-과매도');
  assert.equal(findByClass(made.container, 'backtest-head-folder')[0].textContent, 'RSI-과매도/');
});

test('[등록 해제]는 등록만 지우고 목록을 다시 읽는다 — 파일은 건드리지 않는다', async () => {
  const removed = [];
  let list = [USER_STRATEGY];
  const made = await mounted(userStrategyDeps({
    userStrategies: async () => list,
    unregisterUserStrategy: async (id) => { removed.push(id); list = []; return { ok: true }; },
  }));
  await flush();
  await toList(made.container);
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
  await toList(container);
  assert.equal(findByClass(container, 'backtest-user-strategy-missing').length, 1);
  assert.match(textOf(container), /파일이 없습니다/);
});

// ── 기법 화면 왼쪽 열의 환경 패널 ───────────────────────────────────────────

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

test('내 기법 화면에는 지도 탭이 없다 — 첫 표면은 그 파일의 코드고 지도를 만들지 않는다', async () => {
  let asked = 0;
  const made = await mounted(userStrategyDeps({
    map: async () => { asked += 1; return MAP_PAYLOAD; },
  }));
  const before = asked;
  await openProjectFile(made);
  assert.equal(asked, before, '기법을 고를 때 지도를 만들지 않는다');
  assert.equal(made.canvas.getContext().designTab, 'code');
  assert.equal(subtabNamed(made.container, '지도'), undefined);
  assert.equal(findByClass(made.container, 'backtest-subtab')[0].className.includes('is-on'), true);
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
  await toList(made.container);
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
  // 실행 전에는 배포 탭이 "먼저 저장하라"고 막는다. 배포는 기법 화면의 하위 탭이다(보드 23).
  await click(subtabNamed(made.container, '배포'));
  await flush();
  assert.match(textOf(made.container), /먼저 코드를 한 번 실행하거나 코드 탭에서 저장해야/);

  // 대상·기간은 openProjectFile이 이미 채웠다 — 실행 버튼은 헤더라 어느 탭에서든 눌린다.
  await click(subtabNamed(made.container, '코드'));
  await click(findByClass(made.container, 'backtest-run-button')[0]);
  await flush();
  assert.equal(made.canvas.getContext().code.activeVersionId, 'v9');

  await click(subtabNamed(made.container, '배포'));
  await flush();
  assert.equal(findByClass(made.container, 'backtest-deploy-create').length, 1);
});

// ── 보드 23 · 한도를 비운 배포는 만들 수 없다 ───────────────────────────────

async function toDeployForm(extra) {
  const made = await mounted(userStrategyDeps(Object.assign({
    run: async () => ({ run_id: 'r1', strategy_id: 's9', version_id: 'v9' }),
    result: async () => ({ status: 'done', metrics: {}, equity: [] }),
    trades: async () => [],
    deployments: async () => [],
  }, extra || {})));
  await openProjectFile(made);
  await click(findByClass(made.container, 'backtest-run-button')[0]);
  await flush();
  await click(subtabNamed(made.container, '배포'));
  await flush();
  return made;
}

test('유효 종료가 비면 실전 배포 버튼이 비활성이고 이유가 적힌다', async () => {
  const { container } = await toDeployForm();
  const create = findByClass(container, 'backtest-deploy-create')[0];
  assert.equal(create.disabled, true);
  const text = textOf(container);
  assert.match(text, /한도 — 미리 승인하는 범위/);
  assert.match(text, /비워둘 수 없습니다\. 한도 없는 자동 주문은 이 화면이 약속한 것이 아닙니다\./);
  assert.match(text, /유효 종료\(YYYYMMDD\)/);
});

test('한도 6칸이 모두 차야 배포가 만들어진다', async () => {
  let calls = 0;
  const { container } = await toDeployForm({
    createDeployment: async () => { calls += 1; return { id: 'd1' }; },
  });
  const create = findByClass(container, 'backtest-deploy-create')[0];
  await click(create);
  await flush();
  assert.equal(calls, 0);

  // 마지막 빈 칸(유효 종료)을 채우면 그때 열린다 — 다시 그리지 않고 버튼만 바뀐다.
  const inputs = findByClass(container, 'backtest-field-input');
  const validTo = inputs[inputs.length - 3];
  validTo.value = '20261231';
  await validTo.dispatchEvent({ type: 'input' });
  assert.equal(create.disabled, false);
  await click(create);
  await flush();
  assert.equal(calls, 1);
});

test('deployLimitsGate: 빈 칸을 라벨로 되돌려준다 — 지어낸 기본값을 넣지 않는다', () => {
  const full = {
    max_order_amount: 2000000, max_orders_per_day: 2,
    valid_from: '20260903', valid_to: '20261231',
    stop_on_drawdown_pct: 15, stop_on_consecutive_losses: 3,
  };
  assert.deepEqual(backtestCanvas.deployLimitsGate(full), { ok: true, missing: [] });
  assert.deepEqual(
    backtestCanvas.deployLimitsGate(Object.assign({}, full, { valid_to: '' })),
    { ok: false, missing: ['유효 종료(YYYYMMDD)'] },
  );
  assert.deepEqual(backtestCanvas.deployLimitsGate(null).ok, false);
});

// ── 무장 스위치와 오늘 로그(보드 23 · 2026-09-04) ────────────────────────────
//
// 여기서 지키는 것은 하나다: **화면이 자동 매매에 대해 거짓말을 하지 않는가.**
// 토글은 서버가 준 armed만 비추고, 거절당하면 그 이유가 화면에 남고, 배선이 없으면
// 아예 그리지 않고, 오늘 로그는 없는 수량·주문번호를 지어내지 않는다.

const ARMED_DEPLOYMENT = {
  id: 'd1', stk_cd: '005930', mode: 'auto',
  mode_label: '한도 안에서 자동으로 주문합니다', status: 'active',
  armed: true, auto_armed: true,
  limits: { max_order_amount: 3000000, max_orders_per_day: 3 },
};

function deployment(overrides) {
  return Object.assign({}, ARMED_DEPLOYMENT, overrides || {});
}

// 오늘 로그는 오늘 것만 센다 — 신호의 dt는 백엔드와 같은 YYYYMMDD다.
function todayDt() {
  return require('./backtest-spec').todayYyyymmdd();
}

// 배포 탭까지 간다. 배포 목록 자체는 저장된 버전이 없어도 그려진다(막는 것은 새 배포 폼뿐).
async function atDeployTab(overrides) {
  const made = await mounted(overrides);
  await click(findByClass(made.container, 'backtest-tab')[4]);
  await flush();
  await flush();
  return made;
}

test('유효기간이 지난 배포는 만료 배지를 함께 그린다 — 켜져 있다고 말하지 않는다', async () => {
  const { container } = await atDeployTab({
    deployments: async () => [deployment({ status: 'active', expired: true })],
    listSignals: async () => [],
  });
  assert.equal(findByClass(container, 'backtest-deploy-expired')[0].textContent, '만료');
  assert.equal(findByClass(container, 'backtest-deploy-status')[0].textContent, 'active');
});

test('중지한 배포는 만료로 덮이지 않는다 — 멈춘 것이 사람이었다는 사실을 지우지 않는다', async () => {
  const { container } = await atDeployTab({
    deployments: async () => [deployment({ status: 'stopped', expired: true })],
    listSignals: async () => [],
  });
  assert.equal(findByClass(container, 'backtest-deploy-status')[0].textContent, 'stopped');
  assert.equal(findByClass(container, 'backtest-deploy-expired').length, 1);
});

test('무장 토글이 armDeployment(id, 반대값)를 정확히 한 번 부른다', async () => {
  const calls = [];
  let armed = true;
  const { container } = await atDeployTab({
    deployments: async () => [deployment({ armed, auto_armed: armed })],
    listSignals: async () => [],
    armDeployment: async (id, next) => { calls.push([id, next]); armed = next; return { armed: next }; },
  });
  const toggle = findByClass(container, 'backtest-deploy-arm-toggle')[0];
  assert.ok(toggle, '무장 토글이 있어야 한다');
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  await click(toggle);
  await flush();
  assert.deepEqual(calls, [['d1', false]]);
  // 다시 읽은 목록이 토글의 시각 상태를 정한다 — 낙관적으로 뒤집지 않는다.
  assert.equal(findByClass(container, 'backtest-deploy-arm-toggle')[0].getAttribute('aria-pressed'), 'false');
});

test('무장이 409로 거절당하면 그 이유가 화면에 남는다 — 조용한 실패 금지', async () => {
  const { container } = await atDeployTab({
    deployments: async () => [deployment({ armed: false, auto_armed: false })],
    listSignals: async () => [],
    armDeployment: async () => { throw new Error('멈춘 배포는 무장할 수 없다'); },
  });
  await click(findByClass(container, 'backtest-deploy-arm-toggle')[0]);
  await flush();
  assert.match(textOf(container), /멈춘 배포는 무장할 수 없다/);
  // 배포 목록이 통째로 오류 화면으로 바뀌지는 않는다.
  assert.equal(findByClass(container, 'backtest-canvas-error').length, 0);
  assert.equal(findByClass(container, 'backtest-deploy-arm-toggle')[0].getAttribute('aria-pressed'), 'false');
});

test('armDeployment 배선이 없으면 무장 토글을 아예 그리지 않는다', async () => {
  const { container } = await atDeployTab({
    deployments: async () => [deployment()],
    listSignals: async () => [],
  });
  assert.equal(findByClass(container, 'backtest-deploy-arm-toggle').length, 0);
  assert.equal(findByClass(container, 'backtest-deploy-arm').length, 0);
  assert.doesNotMatch(textOf(container), /키우미 켜짐/);
});

test('auto_armed가 false면 "자동" 표시가 없다 — armed만으로 자동을 말하지 않는다', async () => {
  const { container } = await atDeployTab({
    // 사람은 스위치를 켰지만 모드가 approve라 자동 집행은 아니다(서버 판정).
    deployments: async () => [deployment({ mode: 'approve', armed: true, auto_armed: false })],
    listSignals: async () => [],
    armDeployment: async () => ({ armed: true }),
  });
  assert.equal(findByClass(container, 'backtest-deploy-auto').length, 0);
  // 그래도 토글은 켜져 있다 — 그것이 서버가 준 armed다.
  assert.equal(findByClass(container, 'backtest-deploy-arm-toggle')[0].getAttribute('aria-pressed'), 'true');

  // 반대쪽도 잠근다 — 없는 것만 검사하면 뱃지를 그리는 줄을 통째로 지워도 통과한다.
  const on = await atDeployTab({
    deployments: async () => [deployment({ mode: 'auto', armed: true, auto_armed: true })],
    listSignals: async () => [],
    armDeployment: async () => ({ armed: true }),
  });
  assert.equal(findByClass(on.container, 'backtest-deploy-auto').length, 1);
  assert.match(textOf(on.container), /자동/);
});

test('오늘 로그는 order_no·qty가 없는 행에 수량과 주문번호를 지어내지 않는다', async () => {
  const dt = todayDt();
  const { container } = await atDeployTab({
    deployments: async () => [deployment()],
    listSignals: async () => [
      { id: 's1', dt, side: 'buy', stage: 'signal', reason: '종가가 돌파선을 넘음',
        basis: '', blocked_reason: null, fill_price: null, order_no: null, qty: null },
    ],
    armDeployment: async () => ({ armed: true }),
  });
  const row = findByClass(container, 'backtest-deploy-log-row')[0];
  assert.ok(row, '오늘 신호 한 줄이 있어야 한다');
  assert.equal(findByClass(row, 'backtest-deploy-log-order').length, 0);
  const text = textOf(row);
  assert.match(text, /신호/);
  assert.match(text, /종가가 돌파선을 넘음/);
  assert.doesNotMatch(text, /주/);
  assert.doesNotMatch(text, /원/);
});

test('오늘 로그는 체결 행에 수량·체결가·주문번호를 싣고 오늘 것만 센다', async () => {
  const dt = todayDt();
  const { container } = await atDeployTab({
    deployments: async () => [deployment()],
    listSignals: async () => [
      { id: 's0', dt: '20200101', side: 'buy', stage: 'filled', reason: '어제 일',
        fill_price: 100, order_no: 'A0', qty: 1 },
      { id: 's1', dt, side: 'buy', stage: 'filled', reason: '사람 승인 없이 자동',
        fill_price: 74250, order_no: 'KR0001', qty: 10 },
    ],
    armDeployment: async () => ({ armed: true }),
  });
  // 어제 행은 오늘 로그에 없다.
  assert.equal(findByClass(container, 'backtest-deploy-log-row').length, 1);
  const row = findByClass(container, 'backtest-deploy-log-row')[0];
  assert.match(textOf(row), /005930 10주 74,250원 — 사람 승인 없이 자동/);
  assert.equal(findByClass(row, 'backtest-deploy-log-order')[0].textContent, 'KR0001');
  // 하루 한도(3건)와 같은 축으로 센다 — 오늘 나간 주문만이다.
  assert.match(textOf(container), /오늘 1 \/ 3건/);
});

test('신호를 못 읽으면 오늘 로그를 그리지 않는다 — 빈 로그는 "아무 일도 없었다"가 된다', async () => {
  const { container } = await atDeployTab({
    deployments: async () => [deployment()],
    armDeployment: async () => ({ armed: true }),
  });
  assert.equal(findByClass(container, 'backtest-deploy-log').length, 0);
});

test('배포 카드 머리 문구가 자동 주문 사실을 말한다 — "신호까지만"은 더 이상 참이 아니다', async () => {
  const { container } = await atDeployTab({ deployments: async () => [] });
  const note = textOf(container);
  assert.match(note, /키우미를 켜면 미리 정한 한도 안에서 주문까지 자동으로 나갑니다/);
  assert.doesNotMatch(note, /주문은 주문 게이트를 통과합니다/);
});

test('오늘 로그 순수 계산 — 없는 값은 빈 칸이고 단계는 사람 말이다', () => {
  assert.equal(backtestCanvas.signalQtyText({ qty: null, fill_price: null }), '');
  assert.equal(backtestCanvas.signalQtyText({ qty: 10, fill_price: null }), '10주');
  assert.equal(backtestCanvas.signalQtyText({ qty: 10, fill_price: 74250 }), '10주 74,250원');
  assert.equal(backtestCanvas.signalStageLabel('blocked'), '차단');
  assert.equal(backtestCanvas.signalStageLabel('filled'), '체결');
  // 차단 사유가 있으면 그것이 이유를 대신한다.
  assert.equal(
    backtestCanvas.signalLineText({ reason: '돌파', blocked_reason: '하루 3건 소진' }, '005930'),
    '005930 — 하루 3건 소진',
  );
  // created_at이 없으면 시각 칸은 빈 문자열이다 — dt(날짜)를 시각인 척 세우지 않는다.
  assert.equal(backtestCanvas.signalTimeText({ dt: '20260904' }), '');
  // 있으면 HH:MM이다. 이 줄이 없으면 signalTimeText가 늘 ''를 돌려줘도 초록이라
  // 화면의 시각 칸을 아무도 잠그지 않는다(검증 지적).
  const at = new Date(2026, 8, 4, 9, 31);
  assert.equal(backtestCanvas.signalTimeText({ created_at: at.toISOString() }), '09:31');
  assert.equal(backtestCanvas.signalTimeText({ created_at: '말이 안 되는 값' }), '');
  // 나머지 단계 라벨도 지어낸 말이 아니라 고정된 말이다.
  assert.equal(backtestCanvas.signalStageLabel('in_doubt'), '판단 보류');
  assert.equal(backtestCanvas.signalStageLabel('skipped'), '해당 없음');
  assert.equal(
    backtestCanvas.todayOrderCount(
      [{ dt: '20260904', stage: 'ordered' }, { dt: '20260904', stage: 'signal' },
        { dt: '20260903', stage: 'filled' }],
      '20260904',
    ),
    1,
  );
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
  // 보드 19: 목록만 선다. 시각 편집기는 기법을 고른 뒤에 지도 탭에서 선다.
  await flush();
  await flush();
  const item = findByClass(made.container, 'backtest-preset-item')[0];
  if (item) {
    await click(item);
    await flush();
    await flush();
  }
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

// yaml.safe_dump(..., allow_unicode=True, sort_keys=False)가 실제로 쓴 제목 형식.
const FOLDED_SOURCE_TITLES = [
  {
    "kind": "plain",
    "title": "TITLE_MARKER word word word word word word word word word word word word word word word word word word word word word word word word word",
    "scalar": "  name: TITLE_MARKER word word word word word word word word word word word word word\n    word word word word word word word word word word word word"
  },
  {
    "kind": "single",
    "title": "TITLE_MARKER: user's word word word word word word word word word word word word word word word word word word word word word word word word word",
    "scalar": "  name: 'TITLE_MARKER: user''s word word word word word word word word word word word\n    word word word word word word word word word word word word word word'"
  },
  {
    "kind": "double",
    "title": "TITLE_MARKER\tword word word word word word word word word word word word word word word word word word word word word word word word word",
    "scalar": "  name: \"TITLE_MARKER\\tword word word word word word word word word word word word\\\n    \\ word word word word word word word word word word word word word\""
  },
  {
    "kind": "paragraph",
    "title": "TITLE_MARKER\nnext line word word word word word word word word word word word word word word word word word word word word word word word word word",
    "scalar": "  name: 'TITLE_MARKER\n\n    next line word word word word word word word word word word word word word word\n    word word word word word word word word word word word'"
  },
  {
    "kind": "next-line",
    "title": "TITLE_MARKER\u0085word word word word word word word word word word word word word word word word word word word word word word word word word",
    "scalar": "  name: 'TITLE_MARKER\u0085    word word word word word word word word word word word word word word word word\n    word word word word word word word word word'"
  },
  {
    "kind": "line-separator",
    "title": "TITLE_MARKER\u2028word word word word word word word word word word word word word word word word word word word word word word word word word",
    "scalar": "  name: 'TITLE_MARKER\u2028    word word word word word word word word word word word word word word word word\n    word word word word word word word word word'"
  },
  {
    "kind": "paragraph-separator",
    "title": "TITLE_MARKER\u2029word word word word word word word word word word word word word word word word word word word word word word word word word",
    "scalar": "  name: 'TITLE_MARKER\u2029    word word word word word word word word word word word word word word word word\n    word word word word word word word word word'"
  },
  {
    "kind": "newline-unicode",
    "title": "  tail\n\u2029world\"",
    "scalar": "  name: '  tail\n\n\u2029    world\"'"
  },
  {
    "kind": "unicode-spaces",
    "title": "TITLE\u2028  words",
    "scalar": "  name: \"TITLE\\L  words\""
  },
  {
    "kind": "trailing-unicode-newlines",
    "title": "  tailhello한글\u0085\u2028: '\u2028\n\n",
    "scalar": "  name: '  tailhello한글\u0085\u2028    : ''\u2028\n\n    '"
  },
  {
    "kind": "double-literal-backslash",
    "title": "path \\UFFFFFFFF\t C:\\new value \\u0041",
    "scalar": "  name: \"path \\\\UFFFFFFFF\\t C:\\\\new value \\\\u0041\""
  }
];

for (const sample of FOLDED_SOURCE_TITLES) {
  test(`parseYamlBlock: safe_dump ${sample.kind} 제목 뒤의 전략·리스크와 원제목을 보존한다`, () => {
    const yaml = COMPILED_YAML.replace('  name: 시각 전략', sample.scalar)
      .replace('  id: visual_strategy', '  id: from_source');
    const original = yaml;
    const doc = backtestCanvas.parseYamlBlock(yaml);
    const spec = backtestCanvas.specOverridesFromYaml(yaml);
    assert.equal(doc.metadata.name, sample.title);
    assert.equal(spec.presetId, 'from_source');
    assert.equal(spec.params.fast.default, 33);
    assert.equal(spec.indicators.length, 2);
    assert.equal(spec.risk.stop_loss.percent, 8);
    assert.equal(yaml, original);
  });
}

test('parseYamlBlock: 폼이 저장한 사용자 이름의 Unicode 구분자 뒤 의도한 공백을 보존한다', () => {
  const Spec = require('./backtest-spec');
  for (const separator of ['\x85', '\u2028', '\u2029']) {
    const name = `내 전략${separator}  사용자 이름`;
    const original = Spec.createSpec(null, { presetId: 'custom', name });
    const yaml = Spec.toYaml(original);
    const parsed = backtestCanvas.specOverridesFromYaml(yaml);
    assert.equal(parsed.name, name);
    assert.equal(parsed.presetId, 'custom');
    assert.equal(original.name, name);
    assert.equal(Spec.toYaml(original), yaml);
  }
});

for (const name of [String.raw`C:\new strategy`, String.raw`value \u0041`, String.raw`path \UFFFFFFFF`]) {
  test(`parseYamlBlock: 폼 quote가 그대로 쓴 사용자 이름 ${name}의 backslash를 보존한다`, () => {
    const Spec = require('./backtest-spec');
    const original = Spec.createSpec(null, { presetId: 'custom', name });
    const yaml = Spec.toYaml(original);
    const parsed = backtestCanvas.specOverridesFromYaml(yaml);
    assert.equal(parsed.name, name);
    assert.equal(parsed.presetId, 'custom');
    assert.equal(original.name, name);
    assert.equal(Spec.toYaml(original), yaml);
  });
}

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

test('폭이 900px 아래로 내려가면 편집기에 is-narrow가 붙는다 — 판단은 부르는 쪽 몫', async () => {
  // shell.css의 계약: <900px은 부르는 쪽이 판단해 narrow:true로 넘긴다. 쇼케이스 프로브
  // 실측(2026-09-03)에서 이 배선이 없어 860px 창에서도 서랍 UI가 서지 않았다.
  const observers = [];
  const prevRO = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe(target) { this.target = target; }
  };
  try {
    const made = await mountVisual();
    const host = findByClass(made.container, 'backtest-visual-host')[0];
    const obs = observers.find((o) => o.target === host);
    assert.ok(obs, '편집기 host를 관측해야 한다');
    const vis = () => findByClass(made.container, 'backtest-vis')[0];

    host.getBoundingClientRect = () => ({ width: 860 });
    obs.cb();
    assert.match(vis().className, /is-narrow/, '900px 아래면 좁은 모드');

    host.getBoundingClientRect = () => ({ width: 1200 });
    obs.cb();
    assert.doesNotMatch(vis().className, /is-narrow/, '다시 넓어지면 풀린다');

    // hidden(모드 이탈)의 0폭은 상태를 뒤집는 근거가 아니다.
    host.getBoundingClientRect = () => ({ width: 0 });
    obs.cb();
    assert.doesNotMatch(vis().className, /is-narrow/);
  } finally {
    if (prevRO === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = prevRO;
  }
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
  assert.match(textOf(made.container), /그래프 · 코드 검증 완료/);
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
  assert.doesNotMatch(textOf(made.container), /그래프 · 코드 검증 완료/);
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
  assert.doesNotMatch(textOf(made.container), /그래프 · 코드 검증 완료/);
});

test('이력 탭 버전 행에 [이 버전 켜기]가 있고 누르면 activate를 부른다', async () => {
  const activated = [];
  const made = await mountWithHistory({
    activate: async (strategyId, versionId) => { activated.push([strategyId, versionId]); return {}; },
  });
  const buttons = findByClass(made.container, 'backtest-version-activate');
  assert.equal(buttons.length, 2, '이미 활성인 v1에는 켜기 버튼이 서지 않는다');
  assert.equal(buttons[0].textContent, '이 버전 켜기');

  await click(buttons[0]);
  await flush();
  assert.deepEqual(activated, [['s1', 'v2']]);
});

test('활성화는 실행과 다른 버튼이고 지금 활성 버전을 함께 말한다', async () => {
  const made = await mountWithHistory();
  assert.match(textOf(made.container), /지금 활성 · v1/);

  await click(findByClass(made.container, 'backtest-version-activate')[0]);
  await flush();
  assert.equal(made.calls.activate, 1);
  assert.equal(made.calls.run, 0, '켜기는 실행이 아니다');
  assert.equal(made.calls.backfill, 0);
});

test('활성화 배선이 없으면 켜기 버튼을 세우지 않는다 — 누를 수 없는 약속을 만들지 않는다', async () => {
  const made = await mountWithHistory({ activate: undefined });
  assert.equal(findByClass(made.container, 'backtest-version-activate').length, 0);
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
  await clickNewTechnique(made);
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
    // 단계 카드 넷 — 폴더(여기서는 배선이 없어 화면 버퍼) · 수정 · 검사 · 노드(보드 22).
    // 실행 배선이 없으니 자동 백테스트 카드는 없다.
    const steps = cards
      .filter((e) => e.type === 'athena:backtest-receipt')
      .map((e) => e.detail);
    assert.deepEqual(steps.map((r) => r.kind), new Array(4).fill('technique_step'));
    assert.deepEqual(steps.map((r) => r.step.icon), ['file', 'edit', 'check', 'nodes']);
    assert.equal(steps[1].step.title_ko, 'strategy.py 수정 +6 −7');
    assert.equal(steps[1].step.action.open, 'diff');
    assert.equal(steps[2].step.title_ko, '검사 3/3 통과');
    assert.equal(steps[2].step.tone, 'ok', '경고가 없으면 그냥 통과다');
    assert.match(steps[2].step.meta_ko, /워밍업 59봉/);
    assert.deepEqual(steps[2].step.action, { label_ko: '출력 보기', open: 'terminal', ref: null });
    assert.equal(steps[3].step.icon, 'nodes');
    assert.equal(steps[3].step.title_ko, '노드 다시 그림 · 0 → 2');
    assert.equal(steps[3].step.action.open, 'nodes');
  } finally {
    global.CustomEvent = prevCustomEvent;
  }
});

test('노드를 눌러도 메시지는 안 나간다 — 입력창에 @참조가 들어갈 뿐이다', async () => {
  const sent = [];
  const prevCustomEvent = global.CustomEvent;
  global.CustomEvent = function (type, init) { return { type, detail: init && init.detail }; };
  global.document.dispatchEvent = (event) => { sent.push(event); return true; };
  try {
    const seen = {};
    const made = await draftCanvas({ techniqueNodesLib: fakeNodesLib(seen) });
    made.canvas.onChatAction({ kind: 'code_draft', source: TECHNIQUE_SOURCE });
    await runPending(made);
    const before = sent.filter((e) => e.type === 'athena:chat-submit').length;
    const texts = () => sent.filter((e) => e.type === 'athena:chat-insert')
      .map((e) => e.detail.text);

    // Tab 순회(onSelect)는 선택만 적는다 — 지나친 노드마다 @참조가 쌓이면 안 된다.
    seen.options.onSelect('compute_atr');
    assert.equal(texts().length, 0);
    assert.equal(made.canvas.getContext().technique.selectedNode, 'compute_atr');

    // 클릭·Enter(onExplainNode)가 참조를 넣는다.
    seen.options.onExplainNode('compute_atr');
    assert.equal(texts().pop(), '@compute_atr ');
    seen.options.onExplainNode('signals');
    assert.equal(texts().pop(), '@signals ');
    seen.options.onExplainFlow('entry');
    assert.equal(texts().pop(), '@진입 흐름 ');
    seen.options.onExplainFlow('exit');
    assert.equal(texts().pop(), '@청산 흐름 ');
    seen.options.onExplainAll();
    assert.equal(texts().pop(), '@전체 ');
    // 하나도 보내지 않았다 — 무엇을 물을지는 사람이 이어서 쓴다.
    assert.equal(sent.filter((e) => e.type === 'athena:chat-submit').length, before);
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

test('getContext().technique: 계약 키 13개 — 명령창 로그·diff 원문은 싣지 않는다', async () => {
  const made = await draftCanvas();
  const empty = made.canvas.getContext().technique;
  assert.deepEqual(Object.keys(empty), [
    'projectId', 'name', 'path', 'checks', 'passed', 'stats', 'nodes', 'flows', 'granularity',
    'selectedNode', 'lastCheckAt', 'steps', 'autoRun',
  ]);
  assert.deepEqual(empty.checks, []);
  assert.equal(empty.passed, false);
  assert.equal(empty.lastCheckAt, null);
  assert.equal(empty.autoRun, null);
  assert.equal(empty.path, 'strategy.py');

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

// ── 보드 20~23 · 폴더 하나 = 기법 하나 = 대화 하나 ─────────────────────────
//
// 여기서부터 [+ 새 기법 만들기]는 **진짜 폴더**를 만든다. 그 폴더 안에서 AI의 편집·검사·
// 백테스트는 묻지 않고 자동으로 돌고(자동 수락), 한 일은 전부 단계 카드로 쌓인다.
// 사람이 누르는 것은 [이 기법 승인] 하나다.

const AUTO_RUN_RESULT = {
  status: 'done',
  metrics: { total_return: 0.184, mdd: -0.092, sharpe: 1.1 },
  flags: [],
  stdout: '',
};

// 가짜 디스크 + 프로젝트 배선. createProject가 관리형 폴더처럼 씨앗 strategy.py를 갖고
// 태어나는 것까지 흉내낸다 — 캔버스가 그 씨앗을 빈 뼈대로 덮는지가 걸린 자리다.
function techniqueProjectDeps(calls, overrides) {
  const disk = {};
  const projects = [];
  return Object.assign({
    createProject: async (name) => {
      calls.created.push(name);
      const project = {
        id: `p-${projects.length + 1}`, name: String(name), path: `C:/x/${name}`,
        kind: 'managed', created_at: '2026-09-03T00:00:00Z', exists: true, py_files: 1,
      };
      projects.push(project);
      disk['strategy.py'] = '# 씨앗\nPARAMS = {"fast": {"default": 20}}\n';
      return { project, seed: 'strategy.py' };
    },
    listProjects: async () => ({ projects: projects.slice(), notice: null }),
    projectTree: async () => ({
      entries: Object.keys(disk).map((p) => ({
        name: p.split('/').pop(), path: p, is_dir: false, py: /\.py$/i.test(p), size: 1,
      })),
      truncated: false,
    }),
    readProjectFile: async (_id, p) => {
      if (!(p in disk)) throw new Error('파일이 존재하지 않는다');
      return { path: p, text: disk[p] };
    },
    writeProjectFile: async (id, p, text) => {
      calls.writes.push({ id, path: p, text });
      disk[p] = text;
      return { path: p, size: text.length, mtime: 1 };
    },
    coverage: async (body) => {
      calls.coverage.push(body);
      return { rows: 606, first_dt: '20240307', last_dt: '20260902' };
    },
    run: async (body) => { calls.run.push(body); return { run_id: 'run-abcdefgh-9' }; },
    result: async () => AUTO_RUN_RESULT,
    trades: async () => [],
    registerUserStrategy: async (body) => {
      calls.register.push(body);
      return { strategy_id: 'us1' };
    },
    userStrategies: async () => (calls.register.length
      ? [{
        id: 'us1', name: calls.register[0].name, project_id: calls.register[0].project_id,
        path: calls.register[0].path, exists: true, params: {},
      }]
      : []),
  }, overrides || {});
}

function techniqueCalls() {
  return { created: [], writes: [], coverage: [], run: [], register: [], check: [], nodes: [] };
}

// 폴더까지 만든 초안을 세운다 — draftCanvas와 같은 자리지만 프로젝트 배선이 붙어 있다.
async function folderDraft(seen, overrides) {
  const calls = techniqueCalls();
  const made = await mounted(Object.assign(techniqueProjectDeps(calls), {
    techniqueNodesLib: fakeNodesLib(seen || {}),
    techniqueCheck: async (body) => {
      calls.check.push(body);
      return {
        passed: true, checks: CHECKS_OK,
        stats: { warmup_bars: 59, entry: 41, exit: 41, rows: 606 },
        log: ['$ python -m athena_bt.check'], error: null,
      };
    },
    techniqueNodes: async (body) => { calls.nodes.push(body); return NODES_RESPONSE; },
  }, overrides || {}));
  await clickNewTechnique(made);
  await flush();
  return Object.assign(made, { calls });
}

// 카드를 세는 통로 — CustomEvent 스텁을 걸고 문서 이벤트를 모은다.
function captureCards(fn) {
  return async () => {
    const cards = [];
    const prevCustomEvent = global.CustomEvent;
    global.CustomEvent = function (type, init) { return { type, detail: init && init.detail }; };
    global.document.dispatchEvent = (event) => { cards.push(event); return true; };
    try { await fn(cards); } finally { global.CustomEvent = prevCustomEvent; }
  };
}

function stepsOf(cards) {
  return cards
    .filter((e) => e.type === 'athena:backtest-receipt' && e.detail.kind === 'technique_step')
    .map((e) => e.detail.step);
}

test('[+ 새 기법 만들기]: 폴더 하나를 만들고 뼈대 두 파일을 쓴 뒤 그 파일을 연다', captureCards(async (cards) => {
  const made = await folderDraft();
  assert.equal(made.calls.created.length, 1);
  assert.match(made.calls.created[0], /^새-기법-\d{6}-\d{4}$/);
  // 씨앗(SMA 골든크로스)을 빈 뼈대로 덮고, 계약 시험 하나를 함께 쓴다.
  assert.deepEqual(made.calls.writes.map((w) => w.path), ['strategy.py', 'tests/test_strategy.py']);
  assert.match(made.calls.writes[0].text, /PARAMS = \{\}/);
  assert.match(made.calls.writes[0].text, /원칙 1/);
  assert.match(made.calls.writes[0].text, /원칙 3/);
  assert.match(made.calls.writes[1].text, /def test_signals_returns_entry_exit/);
  // 폴더를 만든 것도 단계 카드다 — 사람은 코드 탭을 안 보고 있을 수 있다.
  const steps = stepsOf(cards);
  assert.equal(steps[0].icon, 'file');
  assert.match(steps[0].title_ko, /^폴더 만듦 · 새-기법-/);
  assert.equal(steps[0].meta_ko, 'strategy.py · tests/test_strategy.py');
  // 계약에 그 폴더와 파일이 실린다.
  const t = made.canvas.getContext().technique;
  assert.equal(t.projectId, 'p-1');
  assert.equal(t.path, 'strategy.py');
  // 코드 탭은 이제 그 폴더의 IDE다(파일 트리 + 편집기).
  assert.equal(made.canvas.getContext().designTab, 'code');
  assert.equal(findByClass(made.container, 'project-ide').length, 1);
  assert.equal(made.canvas.getContext().project.activeFile, 'strategy.py');
}));

test('폴더를 못 만들면 메모리 버퍼로 물러나고 그 사실을 카드로 알린다', captureCards(async (cards) => {
  const calls = techniqueCalls();
  const made = await mounted(Object.assign(techniqueProjectDeps(calls), {
    createProject: async () => { throw new Error('백엔드 없음'); },
  }));
  await clickNewTechnique(made);
  await flush();
  const steps = stepsOf(cards);
  assert.equal(steps[0].icon, 'file');
  assert.equal(steps[0].title_ko, '폴더를 만들지 못해 화면 버퍼로 시작합니다');
  assert.equal(steps[0].meta_ko, '백엔드 없음');
  assert.equal(steps[0].tone, 'warn');
  assert.equal(made.canvas.getContext().technique.projectId, null);
  // 코드는 그대로 화면에 있다 — 대화는 끊기지 않는다.
  assert.match(made.canvas.getContext().code.source, /def signals\(df, p\):/);
  assert.equal(calls.writes.length, 0);
}));

test('프로젝트 배선 자체가 없으면 폴더 없이 시작한다고 적는다', captureCards(async (cards) => {
  const made = await mounted();
  await clickNewTechnique(made);
  const steps = stepsOf(cards);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].title_ko, '폴더 없이 시작합니다');
  assert.equal(steps[0].action.open, 'code');
}));

test('폴더 안의 file_draft는 묻지 않고 바로 쓰고, 되돌리기 대신 단계 카드가 남는다', captureCards(async (cards) => {
  const made = await folderDraft();
  const wroteBefore = made.calls.writes.length;
  const receipt = await made.canvas.onChatAction({
    kind: 'file_draft', project_id: 'p-1', path: 'strategy.py',
    source: TECHNIQUE_SOURCE, note: '변동폭을 함수로 뺐다',
  });
  assert.equal(receipt.applied, true, '자동 수락 — 아직 안 썼다고 말하지 않는다');
  assert.equal(receipt.canApply, false, '[적용]을 기다리지 않는다');
  assert.equal(receipt.canUndo, false, '되돌릴 자리는 파일의 이력이지 이 화면이 아니다');
  assert.equal(made.calls.writes.length, wroteBefore + 1);
  assert.equal(made.calls.writes[wroteBefore].path, 'strategy.py');
  assert.equal(made.calls.writes[wroteBefore].text, TECHNIQUE_SOURCE);
  // 화면에는 초안 diff 패널이 서지 않는다 — 이미 쓴 파일이다.
  assert.equal(findByClass(made.container, 'backtest-file-draft').length, 0);
  const edit = stepsOf(cards).filter((s) => s.icon === 'edit').pop();
  assert.match(edit.title_ko, /^strategy\.py 수정 \+\d+ −\d+$/);
  assert.equal(edit.meta_ko, '변동폭을 함수로 뺐다');
  assert.deepEqual(
    edit.action, { label_ko: 'diff 보기', open: 'diff', ref: { path: 'strategy.py' } },
  );
}));

test('검사 → 노드 → 자동 백테스트가 이 순서로 돌고, 대상이 없으면 캐시 구간을 쓴다', captureCards(async (cards) => {
  const seen = {};
  const made = await folderDraft(seen);
  await made.canvas.onChatAction({
    kind: 'file_draft', project_id: 'p-1', path: 'strategy.py', source: TECHNIQUE_SOURCE,
  });
  await runPending(made);
  await flush();
  const icons = stepsOf(cards).map((s) => s.icon);
  assert.deepEqual(icons, ['file', 'edit', 'check', 'nodes', 'run'], '한 일이 순서대로 쌓인다');
  // 대상이 비어 있으니 005930 일봉 캐시 구간으로 돈다 — 날짜를 지어내지 않는다.
  assert.deepEqual(made.calls.coverage[0], { stk_cd: '005930', period: 'day', adjusted: true });
  assert.equal(made.calls.run.length, 1);
  assert.equal(made.calls.run[0].source, TECHNIQUE_SOURCE);
  assert.equal(made.calls.run[0].project_id, 'p-1');
  assert.match(made.calls.run[0].yaml, /005930/);
  const run = stepsOf(cards).pop();
  assert.equal(run.title_ko, '백테스트 #run-abcd 실행 · 총수익률 +18.4% · MDD −9.2%');
  assert.equal(run.meta_ko, '005930 일봉 20240307~20260902 (대상 미정이라 캐시 구간)');
  assert.equal(run.action.open, 'result');
  // 결과는 담기되 노드 창을 뺏지 않는다.
  assert.equal(made.canvas.getContext().designTab, 'nodes');
  assert.equal(made.canvas.getContext().tab, 'design');
  const t = made.canvas.getContext().technique;
  assert.equal(t.autoRun.status, 'done');
  assert.equal(t.autoRun.runId, 'run-abcdefgh-9');
  assert.equal(t.autoRun.metrics.total_return, 0.184);
  assert.equal(made.canvas.getContext().lastResult.metrics.total_return, 0.184);
}));

test('같은 코드로는 자동 백테스트를 두 번 돌지 않는다', captureCards(async () => {
  const made = await folderDraft();
  await made.canvas.onChatAction({
    kind: 'file_draft', project_id: 'p-1', path: 'strategy.py', source: TECHNIQUE_SOURCE,
  });
  await runPending(made);
  await flush();
  await made.canvas.onChatAction({
    kind: 'file_draft', project_id: 'p-1', path: 'strategy.py', source: TECHNIQUE_SOURCE,
  });
  await runPending(made);
  await flush();
  assert.equal(made.calls.run.length, 1);
}));

test('캐시가 모자라면 자동으로 수집하지 않는다 — 그 결정은 사람의 것이라고 적는다', captureCards(async (cards) => {
  const made = await folderDraft({}, {
    run: async () => ({ blocked: true, needed_pages: 3, est_seconds: 12, cached_rows: 10 }),
  });
  await made.canvas.onChatAction({
    kind: 'file_draft', project_id: 'p-1', path: 'strategy.py', source: TECHNIQUE_SOURCE,
  });
  await runPending(made);
  await flush();
  const run = stepsOf(cards).pop();
  assert.equal(run.icon, 'run');
  assert.equal(run.title_ko, '수집 승인이 필요합니다 — [수집하고 실행]은 사람이 누릅니다');
  assert.equal(run.tone, 'warn', '실패가 아니라 사람을 기다리는 자리다');
  assert.equal(run.action, null, '카드에서 수집을 시작하는 손잡이는 없다');
  assert.equal(made.canvas.getContext().technique.autoRun.status, 'blocked');
  assert.notEqual(made.canvas.getContext().view, 'approval', '화면을 승인 카드로 뺏지 않는다');
}));

test('캐시 구간도 모를 때는 돌리지 않고 무엇을 해야 하는지 적는다', captureCards(async (cards) => {
  const made = await folderDraft({}, {
    coverage: async () => ({ rows: 0, first_dt: null, last_dt: null }),
  });
  await made.canvas.onChatAction({
    kind: 'file_draft', project_id: 'p-1', path: 'strategy.py', source: TECHNIQUE_SOURCE,
  });
  await runPending(made);
  await flush();
  assert.equal(made.calls.run.length, 0);
  const run = stepsOf(cards).pop();
  assert.equal(run.title_ko, '백테스트를 자동으로 돌리지 못했습니다');
  assert.match(run.meta_ko, /종목·기간을 정하고 \[실행\]을 누르세요/);
}));

test('openStep: diff·명령창·노드·결과·코드가 가운데에 열린다', captureCards(async (cards) => {
  const made = await folderDraft();
  await made.canvas.onChatAction({
    kind: 'file_draft', project_id: 'p-1', path: 'strategy.py', source: TECHNIQUE_SOURCE,
  });
  await runPending(made);
  await flush();
  const byIcon = (icon) => stepsOf(cards).filter((s) => s.icon === icon).pop();

  // diff — 코드 탭 위에 빨강/초록 줄이 서고 [코드로]가 닫는다.
  assert.equal(made.canvas.openStep(byIcon('edit').action), true);
  assert.equal(made.canvas.getContext().designTab, 'code');
  const diff = findByClass(made.container, 'backtest-technique-diff')[0];
  assert.ok(diff, 'diff 패널이 선다');
  const rows = findByClass(diff, 'backtest-diff-row');
  assert.ok(rows.filter((n) => n.className.includes('is-add')).length > 0);
  assert.ok(rows.filter((n) => n.className.includes('is-del')).length > 0);
  await click(findByClass(made.container, 'backtest-technique-diff-close')[0]);
  assert.equal(findByClass(made.container, 'backtest-technique-diff').length, 0);

  // 명령창 — 코드 탭에서 펼쳐지고 끝으로 굴러 있다.
  assert.equal(made.canvas.openStep(byIcon('check').action), true);
  const terminal = findByClass(made.container, 'backtest-terminal')[0];
  assert.ok(terminal.className.includes('is-open'));
  assert.ok(findByClass(terminal, 'backtest-terminal-log')[0].scrollTop > 0);

  // 노드 — 노드·흐름 탭.
  assert.equal(made.canvas.openStep(byIcon('nodes').action), true);
  assert.equal(made.canvas.getContext().designTab, 'nodes');

  // 결과 — 결과 탭(지표 타일이 그려진다).
  assert.equal(made.canvas.openStep(byIcon('run').action), true);
  assert.equal(made.canvas.getContext().tab, 'result');
  assert.ok(findByClass(made.container, 'backtest-metric-tile').length > 0);

  // 코드 — 그 함수의 줄을 짚는다.
  assert.equal(made.canvas.openStep({ open: 'code', ref: { first: 10, last: 13 } }), true);
  assert.equal(made.canvas.getContext().designTab, 'code');
  // 모르는 손잡이는 조용히 거절한다 — 없는 화면을 지어내지 않는다.
  assert.equal(made.canvas.openStep({ open: '없는것' }), false);
  assert.equal(made.canvas.openStep(null), false);
}));

test('[이 기법 승인]: 검사와 자동 실행을 넘긴 뒤에만 서고, 누르면 목록에 오른다', captureCards(async (cards) => {
  const made = await folderDraft();
  // 아직 아무것도 안 돌았으면 버튼이 없다 — 돌려보지 않은 기법을 목록에 올리지 않는다.
  assert.equal(findByClass(made.container, 'backtest-technique-approve').length, 0);
  await made.canvas.onChatAction({
    kind: 'file_draft', project_id: 'p-1', path: 'strategy.py', source: TECHNIQUE_SOURCE,
  });
  await runPending(made);
  await flush();
  const approve = findByClass(made.container, 'backtest-technique-approve')[0];
  assert.ok(approve, '검사 통과 + 자동 실행 완료면 승인 버튼이 선다');
  assert.equal(approve.textContent, '이 기법 승인');
  await click(approve);
  await flush();
  await flush();
  assert.deepEqual(made.calls.register, [
    { project_id: 'p-1', path: 'strategy.py', name: '새 기법' },
  ]);
  assert.equal(made.canvas.getContext().techniqueDraft, false, '초안이 아니게 된다');
  assert.equal(stepsOf(cards).pop().title_ko, '기법 목록에 추가됨 · 새 기법');
  // 승인된 기법은 같은 화면에 머문다 — 이제 초안이 아니라 목록의 내 기법이다.
  assert.equal(findByClass(made.container, 'backtest-head-home')[0].textContent, '기법 목록');
  assert.equal(findByClass(made.container, 'backtest-technique-approve-bar').length, 0, '승인 바는 초안의 것이다');
  // 목록을 다시 읽어 그 기법이 선다.
  await toList(made.container);
  assert.match(textOf(made.container), /기법 — 2개/);
}));

test('승인: 등록이 실패하면 목록에 올리지 않고 이유를 코드 탭에 적는다', captureCards(async () => {
  const made = await folderDraft({}, {
    registerUserStrategy: async () => { throw new Error('같은 경로가 이미 등록돼 있다'); },
  });
  await made.canvas.onChatAction({
    kind: 'file_draft', project_id: 'p-1', path: 'strategy.py', source: TECHNIQUE_SOURCE,
  });
  await runPending(made);
  await flush();
  await click(findByClass(made.container, 'backtest-technique-approve')[0]);
  await flush();
  assert.equal(made.canvas.getContext().techniqueDraft, true, '실패했으면 초안 그대로다');
  await click(findByClass(made.container, 'backtest-subtab')[0]);
  assert.match(textOf(made.container), /같은 경로가 이미 등록돼 있다/);
}));

test('헤더 진행 표시: 몇 번째 고침인지와 검사 몇 개를 넘었는지가 함께 선다', captureCards(async () => {
  const made = await folderDraft();
  const bar = () => findByClass(made.container, 'backtest-technique-progress')[0];
  assert.doesNotMatch(textOf(bar()), /번째 고침/, '아직 안 고쳤으면 그 말은 없다');
  await made.canvas.onChatAction({
    kind: 'file_draft', project_id: 'p-1', path: 'strategy.py', source: TECHNIQUE_SOURCE,
  });
  await runPending(made);
  await flush();
  assert.match(textOf(bar()), /1번째 고침/);
  assert.match(textOf(bar()), /검사 3\/3/);
}));

test('code_draft도 폴더 안이면 그 파일에 쓰인다 — 화면 버퍼만 바꾸지 않는다', captureCards(async (cards) => {
  const made = await folderDraft();
  const wroteBefore = made.calls.writes.length;
  made.canvas.onChatAction({ kind: 'code_draft', source: TECHNIQUE_SOURCE, note: '초안' });
  await flush();
  assert.equal(made.calls.writes.length, wroteBefore + 1);
  assert.equal(made.calls.writes[wroteBefore].path, 'strategy.py');
  const edit = stepsOf(cards).filter((s) => s.icon === 'edit').pop();
  assert.match(edit.title_ko, /^strategy\.py 수정 \+\d+ −\d+$/);
}));

test('다른 폴더의 파일 초안은 지금까지처럼 [적용]을 기다린다', captureCards(async () => {
  const made = await folderDraft();
  const wroteBefore = made.calls.writes.length;
  const receipt = await made.canvas.onChatAction({
    kind: 'file_draft', project_id: 'p-9', path: 'strategy.py', source: TECHNIQUE_SOURCE,
  });
  assert.equal(receipt.applied, false);
  assert.deepEqual(receipt.errors, ['지금 열어둔 프로젝트의 파일이 아닙니다']);
  assert.equal(made.calls.writes.length, wroteBefore);
}));

test('단계 카드의 순수 계산 — 줄 수·폴더 이름·부호 퍼센트·검사 한 줄', () => {
  assert.deepEqual(backtestCanvas.diffCounts('a\nb', 'a\nc\nd'), { added: 2, removed: 1 });
  assert.equal(
    backtestCanvas.techniqueProjectName(new Date(2026, 8, 3, 14, 7)), '새-기법-260903-1407',
  );
  assert.match(backtestCanvas.techniqueProjectName(), /^새-기법-\d{6}-\d{4}$/);
  assert.equal(backtestCanvas.signedPercent(0.184), '+18.4%');
  assert.equal(backtestCanvas.signedPercent(-0.092), '−9.2%');
  assert.equal(backtestCanvas.signedPercent(null), '—');
  assert.equal(
    backtestCanvas.techniqueRunTitle('run-abcdefgh', { total_return: 0.184, mdd: -0.092 }),
    '백테스트 #run-abcd 실행 · 총수익률 +18.4% · MDD −9.2%',
  );
  assert.equal(backtestCanvas.techniqueRunTitle('r', null), '백테스트 #r 실행');
  assert.equal(
    backtestCanvas.techniqueStepCheckTitle(
      [{ ok: true, severity: 'block' }, { ok: false, severity: 'warn' }], true,
    ),
    '검사 1/1 통과 · 경고 1',
  );
  assert.equal(
    backtestCanvas.techniqueStepCheckTitle(
      [
        { ok: true, severity: 'block' },
        { ok: false, severity: 'block', label_ko: '룩어헤드' },
      ], false,
    ),
    '검사 1/2 — 룩어헤드 고쳐야 함',
  );
  // 아직 아무것도 안 잰 상태의 분모는 차단 검사 5개다(지어낸 숫자가 아니다).
  assert.equal(backtestCanvas.techniqueStepCheckTitle([], false), '검사 0/5');
});

// ── 세션 복원(Paper 보드 41 · 42) ────────────────────────────────────────────
//
// 여기서 보는 것은 셋이다: ① 봉인이 42번 보드의 항목표(폼·코드·결과·로그·스크롤)를
// 그대로 담는가, ② 복원이 폼의 **대상**(종목·기간)까지 되살리는가 — 그래프 왕복
// (adoptSpecYaml)이 일부러 안 읽는 자리라 여기서 놓치면 종목이 빈 칸으로 열린다,
// ③ 결과를 못 읽었을 때 조용히 넘어가지 않고 이름을 대는 안내가 서는가(Rule 3).

const RESTORE_YAML = `
version: "1.0"
metadata:
  name: 변동성 돌파
data:
  symbols: ["005930"]
  period: day
  adjusted: true
  from: "20230101"
  to: "20251231"
strategy:
  id: custom
  params:
    k: {default: 0.62, min: 0.1, max: 1, step: 0.01, type: float}
  indicators:
    - {id: SMA, alias: ma_fast, params: {period: 20}}
  entry:
    logic: AND
    conditions:
      - {indicator: ma_fast, operator: cross_above, compare_to: ma_slow}
  exit:
    logic: OR
    conditions: []
risk:
  stop_loss:   {enabled: true,  percent: 3}
  take_profit: {enabled: false, percent: 20}
  position:    {sizing: all_in}
costs:
  fee_bps: 1.5
  tax_bps: 20
  slippage_bps: 5
`;

const RESTORE_WORKSPACE = {
  kind: 'backtest',
  tab: 'design',
  designTab: 'form',
  form: {
    yaml: RESTORE_YAML,
    fields: ['symbols', 'period', 'fromDt', 'toDt', 'params', 'costs'],
  },
  code: { source: 'def signal(df, k=0.62):\n    return 0\n', file: 'strategy.py', runPath: 'code' },
  log: { tail: '14:02:19 done · 스크롤 위치 저장됨' },
  run: { runId: 'run-9' },
  scroll: { top: 120 },
};

function withWorkspaceGlobal(run) {
  const registered = [];
  const reports = [];
  global.window = {
    AthenaSessionWorkspace: {
      register: (kind, handler) => { registered.push([kind, handler]); },
      report: (patch) => { reports.push(patch); },
    },
  };
  return Promise.resolve(run({ registered, reports })).finally(() => { delete global.window; });
}

function makeWorkspaceCanvas(overrides) {
  const timers = new Map();
  let timerId = 0;
  const made = makeCanvas(Object.assign({}, overrides, {
    setTimeoutImpl: (fn) => { timers.set(++timerId, fn); return timerId; },
    clearTimeoutImpl: (id) => { timers.delete(id); },
  }));
  made.tick = async () => {
    for (const [id, fn] of [...timers]) {
      if (!timers.delete(id)) continue;
      fn();
    }
    await flush();
  };
  return made;
}

function workspaceDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function switchWorkspace(made, handler) {
  handler.flush();
  handler.clear();
  await handler.restore({
    kind: 'backtest', tab: 'design', designTab: 'form',
    form: { yaml: RESTORE_YAML.replace('005930', '000660').replace('변동성 돌파', '다음 세션') },
    graph: { ...VISUAL_GRAPH, id: 'next-session-graph' },
  });
  await made.tick();
}

for (const pending of ['question', 'patch']) {
  for (const transition of ['same', 'clear', 'restore']) {
    test(`완료된 세션 상태 경계: 대기 ${pending} (전환=${transition})`, async () => withWorkspaceGlobal(async ({ registered }) => {
      const made = await mountVisual();
      const handler = registered[0][1];
      made.canvas.onChatAction(pending === 'question'
        ? { kind: 'visual_question', question: { code: 'E_PREVIOUS', choices: [] } }
        : { kind: 'visual_patch', patch: VISUAL_PATCH });
      const key = pending === 'question' ? 'pendingQuestion' : 'pendingPatch';
      const previous = made.canvas.getContext().map[key];
      assert.ok(previous, '전환 전에 앞 세션의 대기 상태가 실제로 있어야 한다');
      if (transition === 'clear') handler.clear();
      if (transition === 'restore') {
        await handler.restore({ kind: 'backtest', form: RESTORE_WORKSPACE.form, graph: VISUAL_GRAPH });
      }
      await flush();
      assert.deepEqual(made.canvas.getContext().map[key], transition === 'same' ? previous : null,
        '앞 세션의 질문·수정안은 다음 모델 컨텍스트에 남으면 안 된다');
    }));
  }
}

for (const origin of ['visual', 'code_only']) {
  for (const transition of ['same', 'clear', 'restore']) {
    test(`완료된 세션 상태 경계: 열린 ${origin} 버전 (전환=${transition})`, async () => withWorkspaceGlobal(async ({ registered }) => {
      const made = await mountWithHistory();
      const handler = registered[0][1];
      await click(findByClass(made.container, 'backtest-version-row')[origin === 'visual' ? 1 : 2]);
      await flush();
      made.canvas.onChatAction({ kind: 'navigate', tab: 'design', designTab: 'flow' });
      await flush();
      assert.equal(findByClass(made.container, 'backtest-snapshot-badge').length, 1);
      assert.equal(made.canvas.getContext().map.code_only, origin === 'code_only');
      if (transition === 'clear') handler.clear();
      if (transition === 'restore') {
        await handler.restore({
          kind: 'backtest', form: RESTORE_WORKSPACE.form, graph: VISUAL_GRAPH, designTab: 'flow',
        });
      }
      await flush();
      assert.equal(made.canvas.getContext().map.code_only, transition === 'same' && origin === 'code_only');
      assert.equal(findByClass(made.container, 'backtest-head-opened').length, transition === 'same' ? 1 : 0,
        '앞 세션에서 열었던 버전 표시가 남으면 안 된다');
      assert.equal(findByClass(made.container, 'backtest-snapshot-badge').length, transition === 'same' ? 1 : 0);
      if (transition === 'restore') {
        assert.equal(findByClass(made.container, 'backtest-vis-undo').length, 1,
          '새 세션의 그래프는 이전 버전 snapshot에 가려지지 않고 편집할 수 있어야 한다');
        assert.doesNotMatch(textOf(made.container), /ma_hist/);
      }
    }));
  }
}

test('완료된 세션 상태 경계: 다음 코드 전용 버전은 다음 세션의 호환 그래프를 쓴다', async () => withWorkspaceGlobal(async ({ registered }) => {
  const made = await mountWithHistory();
  const handler = registered[0][1];
  await click(findByClass(made.container, 'backtest-version-row')[2]);
  await flush();
  const graph = JSON.parse(JSON.stringify(VISUAL_GRAPH));
  graph.nodes[1].label = 'ma_next_session';
  await handler.restore({
    kind: 'backtest', form: RESTORE_WORKSPACE.form, graph,
    code: { ...RESTORE_WORKSPACE.code, strategyId: 'next-strategy' },
  });
  made.canvas.onChatAction({ kind: 'navigate', tab: 'history' });
  await flush();
  await flush();
  await click(findByClass(made.container, 'backtest-version-row')[2]);
  await flush();
  made.canvas.onChatAction({ kind: 'navigate', tab: 'design', designTab: 'flow' });
  await flush();
  assert.equal(made.canvas.getContext().map.code_only, true);
  assert.match(textOf(made.container), /ma_next_session/,
    '읽기 전용 그래프 캐시도 세션 사이에 재사용하면 안 된다');
}));

for (const pendingStage of ['start', 'status']) {
  for (const switched of [false, true]) {
    test(`비동기 세션 경계: 수집 ${pendingStage} (전환=${switched})`, async () => withWorkspaceGlobal(async ({ registered, reports }) => {
      const previous = workspaceDeferred();
      const next = workspaceDeferred();
      const runs = [];
      const statuses = [];
      let backfills = 0;
      let allowRun = false;
      const made = makeWorkspaceCanvas({
        run: async (body) => {
          runs.push(body);
          return allowRun ? { run_id: 'completed-run' } : { blocked: true, needed_pages: 3 };
        },
        backfill: () => {
          backfills += 1;
          return backfills === 1
            ? (pendingStage === 'start' ? previous.promise : Promise.resolve({ job_id: 'previous-job' }))
            : Promise.resolve({ job_id: 'next-job' });
        },
        status: ({ job_id: jobId }) => {
          statuses.push(jobId);
          return jobId === 'next-job' ? next.promise
            : (pendingStage === 'status' ? previous.promise : Promise.resolve({ status: 'done' }));
        },
        result: async () => ({ status: 'done', metrics: {}, stdout: '수집 후 실행' }),
      });
      made.canvas.mount();
      await flush();
      const handler = registered[0][1];
      await handler.restore({ ...RESTORE_WORKSPACE, run: null });
      made.canvas.runFromChat();
      await flush();
      await click(findByClass(made.container, 'backtest-approval-confirm')[0]);
      await flush();
      assert.equal(backfills, 1);
      if (switched) {
        await switchWorkspace(made, handler);
        made.canvas.onChatAction({ kind: 'code_draft', source: '# 다음 세션 실행\n' });
        made.canvas.runFromChat();
        await flush();
        await click(findByClass(made.container, 'backtest-approval-confirm')[0]);
        await flush();
      }
      await made.tick();
      const before = reports.length;
      const beforeRuns = runs.length;
      allowRun = true;
      previous.resolve(pendingStage === 'start' ? { job_id: 'previous-job' } : { status: 'done' });
      await flush();
      await made.tick();
      if (switched) {
        assert.equal(runs.length, beforeRuns, '앞 수집 응답이 다음 세션 실행을 시작했다');
        assert.equal(reports.length, before);
        assert.equal(made.canvas.getContext().view, 'running');
        assert.deepEqual(statuses, pendingStage === 'start' ? ['next-job'] : ['previous-job', 'next-job']);
        next.resolve({ status: 'done' });
        await flush();
        await made.tick();
      }
      assert.equal(runs.length, beforeRuns + 1, '현재 세션 수집 완료는 실행으로 이어져야 한다');
      assert.equal(made.canvas.getContext().view, 'result');
    }));
  }
}

for (const pendingStage of ['check', 'nodes', 'codegen']) {
  for (const switched of [false, true]) {
    test(`비동기 세션 경계: 기법 ${pendingStage} (전환=${switched})`, captureCards(async (cards) => withWorkspaceGlobal(async ({ registered, reports }) => {
      const previous = workspaceDeferred();
      let requests = 0;
      const made = makeWorkspaceCanvas({
        techniqueCheck: () => pendingStage === 'check'
          ? (requests += 1, previous.promise) : Promise.resolve({ passed: true, checks: CHECKS_OK }),
        techniqueNodes: () => pendingStage === 'nodes'
          ? (requests += 1, previous.promise) : Promise.resolve(NODES_RESPONSE),
        codegen: () => { requests += 1; return previous.promise; },
      });
      made.canvas.mount();
      await flush();
      const handler = registered[0][1];
      if (pendingStage === 'codegen') {
        await click(findByClass(made.container, 'backtest-preset-item')[0]);
        await click(findByClass(made.container, 'backtest-subtab')[3]);
      } else {
        made.canvas.onChatAction({ kind: 'code_draft', source: TECHNIQUE_SOURCE });
        await made.tick();
      }
      await flush();
      assert.equal(requests, 1);
      if (switched) await switchWorkspace(made, handler);
      await made.tick();
      const before = made.canvas.getContext();
      const beforeReports = reports.length;
      const beforeCards = cards.length;
      previous.resolve(pendingStage === 'check' ? { passed: true, checks: CHECKS_OK }
        : pendingStage === 'nodes' ? NODES_RESPONSE : { source: TECHNIQUE_SOURCE });
      await flush();
      await made.tick();
      if (switched) {
        assert.deepEqual(made.canvas.getContext().technique, before.technique);
        assert.equal(made.canvas.getContext().designTab, 'form');
        assert.equal(reports.length, beforeReports);
        assert.equal(cards.length, beforeCards);
      } else {
        assert.deepEqual(made.canvas.getContext().technique.nodes.map((n) => n.id), ['compute_atr', 'signals']);
        assert.equal(made.canvas.getContext().designTab, 'nodes');
      }
    })));
  }
}

for (const pendingStage of ['coverage', 'run', 'result', 'trades']) {
  for (const switched of [false, true]) {
    test(`비동기 세션 경계: 자동 실행 ${pendingStage} (전환=${switched})`, captureCards(async (cards) => withWorkspaceGlobal(async ({ registered, reports }) => {
      const previous = workspaceDeferred();
      const runs = [];
      let requests = 0;
      const made = makeWorkspaceCanvas({
        techniqueCheck: async () => ({ passed: true, checks: CHECKS_OK }),
        techniqueNodes: async () => NODES_RESPONSE,
        coverage: ({ stk_cd: symbol }) => {
          if (symbol === '005930' && pendingStage === 'coverage') { requests += 1; return previous.promise; }
          return Promise.resolve({ rows: 606, first_dt: '20240307', last_dt: '20260902' });
        },
        run: (body) => {
          runs.push(body);
          if (pendingStage === 'run') { requests += 1; return previous.promise; }
          return Promise.resolve({ run_id: 'previous-auto-run' });
        },
        result: () => pendingStage === 'result'
          ? (requests += 1, previous.promise) : Promise.resolve(AUTO_RUN_RESULT),
        trades: () => pendingStage === 'trades'
          ? (requests += 1, previous.promise) : Promise.resolve([]),
      });
      made.canvas.mount();
      await flush();
      const handler = registered[0][1];
      made.canvas.onChatAction({ kind: 'code_draft', source: TECHNIQUE_SOURCE });
      await made.tick();
      await flush();
      assert.equal(requests, 1);
      if (switched) await switchWorkspace(made, handler);
      await made.tick();
      const before = made.canvas.getContext();
      const beforeReports = reports.length;
      const beforeCards = cards.length;
      previous.resolve(pendingStage === 'coverage' ? { rows: 606, first_dt: '20240307', last_dt: '20260902' }
        : pendingStage === 'run' ? { run_id: 'previous-auto-run' }
          : pendingStage === 'result' ? AUTO_RUN_RESULT : []);
      await flush();
      await made.tick();
      if (switched) {
        assert.deepEqual(made.canvas.getContext().spec, before.spec);
        assert.deepEqual(made.canvas.getContext().technique, before.technique);
        assert.deepEqual(made.canvas.getContext().lastResult, before.lastResult);
        assert.equal(reports.length, beforeReports);
        assert.equal(cards.length, beforeCards);
        assert.equal(runs.length, pendingStage === 'coverage' ? 0 : 1);
      } else {
        assert.equal(runs.length, 1);
        assert.equal(made.canvas.getContext().technique.autoRun.status, 'done');
        assert.equal(made.canvas.getContext().technique.autoRun.runId, 'previous-auto-run');
        assert.equal(made.canvas.getContext().lastResult.metrics.total_return, 0.184);
      }
    })));
  }
}

for (const switched of [false, true]) {
  test(`비동기 세션 경계: 버전 열기 (전환=${switched})`, async () => withWorkspaceGlobal(async ({ registered, reports }) => {
    const previous = workspaceDeferred();
    let requests = 0;
    const made = makeWorkspaceCanvas({
      versions: async () => [{ id: 'previous-version', version: 2, origin: 'code_only' }],
      versionDetail: () => { requests += 1; return previous.promise; },
    });
    made.canvas.mount();
    await flush();
    const handler = registered[0][1];
    await handler.restore({ ...RESTORE_WORKSPACE, run: null, code: { ...RESTORE_WORKSPACE.code, strategyId: 'previous-strategy' } });
    made.canvas.onChatAction({ kind: 'navigate', tab: 'history' });
    await flush();
    await click(findByClass(made.container, 'backtest-version-row')[0]);
    assert.equal(requests, 1);
    if (switched) await switchWorkspace(made, handler);
    await made.tick();
    const before = made.canvas.getContext();
    const beforeReports = reports.length;
    previous.resolve({ id: 'previous-version', origin: 'code_only', source: '# 이전 버전 원문\n' });
    await flush();
    await made.tick();
    if (switched) {
      assert.deepEqual(made.canvas.getContext().code, before.code);
      assert.deepEqual(made.canvas.getContext().spec, before.spec);
      assert.equal(made.canvas.getContext().designTab, 'form');
      assert.equal(reports.length, beforeReports);
    } else {
      assert.equal(made.canvas.getContext().code.source, '# 이전 버전 원문\n');
      assert.equal(made.canvas.getContext().designTab, 'code');
    }
  }));
}

for (const pendingStage of ['validate', 'compile']) {
  for (const switched of [false, true]) {
    test(`비동기 세션 경계: 시각 컴파일 ${pendingStage} (전환=${switched})`, async () => withWorkspaceGlobal(async ({ registered, reports }) => {
      const previous = workspaceDeferred();
      let requests = 0;
      const compiled = { spec_yaml: COMPILED_YAML, source: VISUAL_SOURCE, hashes: {} };
      const made = makeWorkspaceCanvas({
        visualFromSpec: async () => ({ graph: VISUAL_GRAPH }),
        visualValidate: () => pendingStage === 'validate'
          ? (requests += 1, previous.promise) : Promise.resolve({ valid: true, diagnostics: [] }),
        visualCompile: () => pendingStage === 'compile'
          ? (requests += 1, previous.promise) : Promise.resolve(compiled),
      });
      made.canvas.mount();
      await flush();
      const handler = registered[0][1];
      await handler.restore({ kind: 'backtest', form: RESTORE_WORKSPACE.form, graph: VISUAL_GRAPH, designTab: 'flow' });
      await click(findByClass(made.container, 'backtest-visual-validate')[0]);
      await flush();
      assert.equal(requests, 1);
      if (switched) await switchWorkspace(made, handler);
      await made.tick();
      const before = made.canvas.getContext();
      const beforeReports = reports.length;
      previous.resolve(pendingStage === 'validate' ? { valid: true, diagnostics: [] } : compiled);
      await flush();
      await made.tick();
      if (switched) {
        assert.deepEqual(made.canvas.getContext().spec, before.spec);
        assert.deepEqual(made.canvas.getContext().map, before.map);
        assert.equal(reports.length, beforeReports);
      } else {
        assert.equal(made.canvas.getContext().spec.name, '시각 전략');
        assert.match(reports[reports.length - 1].form.yaml, /시각 전략/);
      }
    }));
  }
}

for (const pendingStage of ['validate', 'compile', 'create', 'save']) {
  for (const switched of [false, true]) {
    test(`비동기 세션 경계: 시각 패치 ${pendingStage} (전환=${switched})`, captureCards(async (cards) => withWorkspaceGlobal(async ({ registered, reports }) => {
      const previous = workspaceDeferred();
      const creates = [];
      const saves = [];
      let requests = 0;
      const compiled = { spec_yaml: COMPILED_YAML, source: VISUAL_SOURCE, hashes: {} };
      const made = makeWorkspaceCanvas({
        visualFromSpec: async () => ({ graph: VISUAL_GRAPH }),
        visualValidate: () => pendingStage === 'validate'
          ? (requests += 1, previous.promise) : Promise.resolve({ valid: true, diagnostics: [] }),
        visualCompile: () => pendingStage === 'compile'
          ? (requests += 1, previous.promise) : Promise.resolve(compiled),
        createStrategy: (body) => {
          creates.push(body);
          if (pendingStage === 'create') { requests += 1; return previous.promise; }
          return Promise.resolve({ strategy_id: 'previous-strategy', version_id: 'previous-v1' });
        },
        visualSave: (body) => {
          saves.push(body);
          if (pendingStage === 'save') { requests += 1; return previous.promise; }
          return Promise.resolve({ version_id: 'previous-v2', version: 2 });
        },
      });
      made.canvas.mount();
      await flush();
      const handler = registered[0][1];
      await handler.restore({ kind: 'backtest', form: RESTORE_WORKSPACE.form, graph: VISUAL_GRAPH, designTab: 'flow' });
      made.canvas.onChatAction({ kind: 'visual_patch', patch: VISUAL_PATCH });
      const applying = made.canvas.applyVisualPatch('patch-1').then((value) => ({ value }), (error) => ({ error }));
      await flush();
      assert.equal(requests, 1);
      if (switched) {
        await switchWorkspace(made, handler);
        made.canvas.onChatAction({ kind: 'visual_patch', patch: { ...VISUAL_PATCH, patch_id: 'next-patch' } });
      }
      await made.tick();
      const before = made.canvas.getContext();
      const beforeReports = reports.length;
      const beforeCards = cards.length;
      const beforeCreates = creates.length;
      const beforeSaves = saves.length;
      previous.resolve(pendingStage === 'validate' ? { valid: true, diagnostics: [] }
        : pendingStage === 'compile' ? compiled
          : pendingStage === 'create' ? { strategy_id: 'previous-strategy', version_id: 'previous-v1' }
            : { version_id: 'previous-v2', version: 2 });
      const outcome = await applying;
      await made.tick();
      assert.equal(outcome.error, undefined, '세션 전환 뒤 적용 응답이 예외로 끝나면 안 된다');
      if (switched) {
        assert.equal(outcome.value, null);
        assert.deepEqual(made.canvas.getContext().code, before.code);
        assert.deepEqual(made.canvas.getContext().spec, before.spec);
        assert.equal(made.canvas.getContext().map.pendingPatch.patch_id, 'next-patch');
        assert.equal(reports.length, beforeReports);
        assert.equal(cards.length, beforeCards);
        assert.equal(creates.length, beforeCreates);
        assert.equal(saves.length, beforeSaves);
      } else {
        assert.equal(outcome.value.kind, 'visual_synced');
        assert.equal(creates.length, 1);
        assert.equal(saves.length, 1);
        assert.equal(saves[0].strategy_id, 'previous-strategy');
        assert.equal(made.canvas.getContext().code.source, VISUAL_SOURCE);
      }
    })));
  }
}

for (const pendingKind of ['backfill', 'check', 'auto-run', 'version', 'compile', 'save']) {
  for (const switched of [false, true]) {
    test(`비동기 세션 경계: 실패 응답 ${pendingKind} (전환=${switched})`, captureCards(async (cards) => withWorkspaceGlobal(async ({ registered, reports }) => {
      const previous = workspaceDeferred();
      let requests = 0;
      const waitForFailure = () => { requests += 1; return previous.promise; };
      const made = makeWorkspaceCanvas({
        run: pendingKind === 'auto-run' ? waitForFailure : async () => ({ blocked: true, needed_pages: 3 }),
        backfill: waitForFailure,
        techniqueCheck: pendingKind === 'check' ? waitForFailure : async () => ({ passed: true, checks: CHECKS_OK }),
        techniqueNodes: async () => NODES_RESPONSE,
        coverage: async () => ({ rows: 606, first_dt: '20240307', last_dt: '20260902' }),
        versions: async () => [{ id: 'previous-v1', version: 1, origin: 'human' }],
        versionDetail: waitForFailure,
        visualFromSpec: async () => ({ graph: VISUAL_GRAPH }),
        visualValidate: async () => ({ valid: true, diagnostics: [] }),
        visualCompile: pendingKind === 'compile' ? waitForFailure
          : async () => ({ spec_yaml: COMPILED_YAML, source: VISUAL_SOURCE, hashes: {} }),
        createStrategy: async () => ({ strategy_id: 'previous-strategy' }),
        visualSave: waitForFailure,
      });
      made.canvas.mount();
      await flush();
      const handler = registered[0][1];
      let applying = Promise.resolve(null);
      if (pendingKind === 'check' || pendingKind === 'auto-run') {
        made.canvas.onChatAction({ kind: 'code_draft', source: TECHNIQUE_SOURCE });
        await made.tick();
      } else if (pendingKind === 'backfill' || pendingKind === 'version') {
        await handler.restore({ ...RESTORE_WORKSPACE, run: null, code: { ...RESTORE_WORKSPACE.code, strategyId: 'previous-strategy' } });
        if (pendingKind === 'backfill') {
          made.canvas.runFromChat();
          await flush();
          await click(findByClass(made.container, 'backtest-approval-confirm')[0]);
        } else {
          made.canvas.onChatAction({ kind: 'navigate', tab: 'history' });
          await flush();
          await click(findByClass(made.container, 'backtest-version-row')[0]);
        }
      } else {
        await handler.restore({ kind: 'backtest', form: RESTORE_WORKSPACE.form, graph: VISUAL_GRAPH, designTab: 'flow' });
        if (pendingKind === 'compile') await click(findByClass(made.container, 'backtest-visual-validate')[0]);
        else {
          made.canvas.onChatAction({ kind: 'visual_patch', patch: VISUAL_PATCH });
          applying = made.canvas.applyVisualPatch('patch-1');
        }
      }
      await flush();
      assert.equal(requests, 1);
      if (switched) await switchWorkspace(made, handler);
      await made.tick();
      const before = made.canvas.getContext();
      const beforeReports = reports.length;
      const beforeCards = cards.length;
      const failure = Object.assign(new Error('지연된 이전 세션 실패'), { status: 409 });
      previous.reject(failure);
      const receipt = await applying;
      await flush();
      await made.tick();
      if (switched) {
        assert.deepEqual(made.canvas.getContext(), before);
        assert.equal(reports.length, beforeReports);
        assert.equal(cards.length, beforeCards);
        assert.equal(receipt, null);
      } else {
        assert.match(JSON.stringify({ text: textOf(made.container), context: made.canvas.getContext(), cards }), /지연된 이전 세션 실패/);
        if (pendingKind === 'save') {
          assert.equal(receipt.kind, 'visual_conflict');
          assert.equal(receipt.canRetry, true);
        }
      }
    })));
  }
}

for (const rejected of [false, true]) {
  for (const switched of [false, true]) {
    test(`비동기 세션 경계: 수집 중단 (거절=${rejected}, 전환=${switched})`, async () => withWorkspaceGlobal(async ({ registered, reports }) => {
      const cancel = workspaceDeferred();
      const pendingStatus = workspaceDeferred();
      const cancellations = [];
      let job = 0;
      const made = makeWorkspaceCanvas({
        run: async () => ({ blocked: true, needed_pages: 3 }),
        backfill: async () => ({ job_id: `job-${++job}` }),
        status: () => pendingStatus.promise,
        cancelJob: (body) => { cancellations.push(body); return cancel.promise; },
      });
      made.canvas.mount();
      await flush();
      const handler = registered[0][1];
      await handler.restore({ ...RESTORE_WORKSPACE, run: null });
      made.canvas.runFromChat();
      await flush();
      await click(findByClass(made.container, 'backtest-approval-confirm')[0]);
      await flush();
      await click(findByClass(made.container, 'backtest-running-stop')[0]);
      assert.deepEqual(cancellations, [{ job_id: 'job-1' }]);
      if (switched) {
        await switchWorkspace(made, handler);
        made.canvas.onChatAction({ kind: 'code_draft', source: '# 다음 세션 실행\n' });
        made.canvas.runFromChat();
        await flush();
        await click(findByClass(made.container, 'backtest-approval-confirm')[0]);
        await flush();
      }
      await made.tick();
      const before = reports.length;
      if (rejected) cancel.reject(new Error('이미 끝난 이전 수집'));
      else cancel.resolve({ cancelled: true });
      await flush();
      await made.tick();
      if (switched) {
        assert.equal(made.canvas.getContext().view, 'running');
        assert.equal(reports.length, before);
        await click(findByClass(made.container, 'backtest-running-stop')[0]);
        await flush();
        assert.deepEqual(cancellations[1], { job_id: 'job-2' });
      }
      assert.equal(made.canvas.getContext().view, 'design');
    }));
  }
}

for (const pendingStage of ['list', 'hash', 'detail', 'validate', 'question']) {
  for (const switched of [false, true]) {
    test(`비동기 세션 경계: 다시 검토 ${pendingStage} (전환=${switched})`, captureCards(async (cards) => withWorkspaceGlobal(async ({ registered, reports }) => {
      const previous = workspaceDeferred();
      const calls = { list: [], detail: [], validate: [], question: [] };
      let requests = 0;
      const wait = () => { requests += 1; return previous.promise; };
      const head = { id: 'previous-v9', version: 9, source: pendingStage === 'hash' ? '# previous head\n' : null };
      const detail = { hashes: { graph_hash: 'previous-gh', artifact_hash: 'previous-ah' } };
      const question = { question: { code: 'E_PREVIOUS', question_ko: '이전 세션 질문', choices: [] } };
      const originalHash = CodeEditorLib.hashSource;
      if (pendingStage === 'hash') CodeEditorLib.hashSource = wait;
      try {
        const made = makeWorkspaceCanvas({
          versions: (id) => { calls.list.push(id); return pendingStage === 'list' ? wait() : Promise.resolve([head]); },
          versionDetail: (id, version) => { calls.detail.push([id, version]); return pendingStage === 'detail' ? wait() : Promise.resolve(detail); },
          visualFromSpec: async () => ({ graph: VISUAL_GRAPH }),
          visualValidate: (body) => { calls.validate.push(body); return pendingStage === 'validate' ? wait() : Promise.resolve({ valid: false, diagnostics: [] }); },
          visualQuestion: (body) => { calls.question.push(body); return pendingStage === 'question' ? wait() : Promise.resolve(question); },
        });
        made.canvas.mount();
        await flush();
        const handler = registered[0][1];
        await handler.restore({
          kind: 'backtest', form: RESTORE_WORKSPACE.form, graph: VISUAL_GRAPH, designTab: 'flow',
          code: { source: '# previous strategy\n', strategyId: 'previous-strategy', runPath: 'form' },
        });
        const retrying = made.canvas.retryVisualPatch();
        await flush();
        assert.equal(requests, 1);
        if (switched) await switchWorkspace(made, handler);
        await made.tick();
        const before = made.canvas.getContext();
        const beforeCalls = JSON.parse(JSON.stringify(calls));
        const beforeReports = reports.length;
        const beforeCards = cards.length;
        previous.resolve(pendingStage === 'list' ? [head] : pendingStage === 'hash' ? 'previous-ah'
          : pendingStage === 'detail' ? detail : pendingStage === 'validate' ? { valid: false, diagnostics: [] } : question);
        const receipt = await retrying;
        await made.tick();
        if (switched) {
          assert.equal(receipt, null);
          assert.deepEqual(made.canvas.getContext(), before);
          assert.deepEqual(calls, beforeCalls, '이전 재검토가 다음 세션의 후속 요청을 시작했다');
          assert.equal(reports.length, beforeReports);
          assert.equal(cards.length, beforeCards);
        } else {
          assert.equal(receipt.kind, 'visual_question');
          assert.equal(made.canvas.getContext().map.pendingQuestion.code, 'E_PREVIOUS');
          assert.deepEqual(calls.detail, [['previous-strategy', 'previous-v9']]);
        }
      } finally { CodeEditorLib.hashSource = originalHash; }
    })));
  }
}

for (const rejected of [false, true]) {
  for (const switched of [false, true]) {
    test(`비동기 세션 경계: 질문 선택 (거절=${rejected}, 전환=${switched})`, captureCards(async (cards) => withWorkspaceGlobal(async ({ registered, reports }) => {
      const previous = workspaceDeferred();
      const requests = [];
      const made = makeWorkspaceCanvas({
        visualPatch: (body) => { requests.push(body); return previous.promise; },
      });
      made.canvas.mount();
      await flush();
      const handler = registered[0][1];
      await handler.restore({
        kind: 'backtest', form: RESTORE_WORKSPACE.form, graph: VISUAL_GRAPH, designTab: 'flow',
      });
      made.canvas.onChatAction({ kind: 'visual_question', question: { code: 'E_PREVIOUS', choices: [] } });
      const answering = made.canvas.answerVisualQuestion({ code: 'E_PREVIOUS', choice_id: 'connect-close' });
      await flush();
      assert.equal(requests.length, 1, '이전 질문의 선택 요청이 실제로 대기해야 한다');
      assert.deepEqual(requests[0].intent, { code: 'E_PREVIOUS', choice_id: 'connect-close' });
      if (switched) {
        await switchWorkspace(made, handler);
        made.canvas.onChatAction({ kind: 'visual_question', question: { code: 'E_NEXT', choices: [] } });
      }
      await made.tick();
      const before = made.canvas.getContext();
      const beforeReports = reports.length;
      const beforeCards = cards.length;
      if (rejected) previous.reject(new Error('PREVIOUS_SESSION_PATCH_ERROR'));
      else previous.resolve({ ...VISUAL_PATCH, patch_id: 'PREVIOUS_SESSION_PATCH' });
      const receipt = await answering;
      await made.tick();
      const after = made.canvas.getContext();
      if (switched) {
        assert.equal(receipt, null);
        assert.deepEqual(after, before, '다음 세션의 질문·수정안·지도 판번호를 보존해야 한다');
        assert.equal(after.map.pendingQuestion.code, 'E_NEXT');
        assert.equal(reports.length, beforeReports);
        assert.equal(cards.length, beforeCards);
      } else if (rejected) {
        assert.equal(receipt.kind, 'visual_conflict');
        assert.equal(after.map.pendingQuestion.code, 'E_PREVIOUS');
        assert.equal(after.map.pendingPatch, null);
        assert.equal(after.map.version, before.map.version);
        assert.equal(cards.length, beforeCards + 1);
      } else {
        assert.equal(receipt.kind, 'visual_patch');
        assert.equal(after.map.pendingQuestion, null);
        assert.equal(after.map.pendingPatch.patch_id, 'PREVIOUS_SESSION_PATCH');
        assert.deepEqual(receipt.version, { from: before.map.version, to: before.map.version + 1 });
        assert.equal(cards.length, beforeCards + 1);
      }
    })));
  }
}

for (const pendingStage of ['create', 'version']) {
  for (const rejected of [false, true]) {
    for (const switched of [false, true]) {
      test(`비동기 세션 경계: 코드 분기 ${pendingStage} (거절=${rejected}, 전환=${switched})`, captureCards(async (cards) => withWorkspaceGlobal(async ({ registered, reports }) => {
        const previous = workspaceDeferred();
        const saved = [];
        let requests = 0;
        const hash = await CodeEditorLib.hashSource(VISUAL_SOURCE);
        const stub = visualStubs(hash, {
          createStrategy: () => {
            if (pendingStage === 'create') { requests += 1; return previous.promise; }
            return Promise.resolve({ strategy_id: 'previous-strategy', version_id: 'previous-v1' });
          },
          addVersion: (id, body) => {
            saved.push({ id, body });
            if (pendingStage === 'version') { requests += 1; return previous.promise; }
            return Promise.resolve({ version_id: 'previous-v2', version: 2 });
          },
        });
        const made = makeWorkspaceCanvas(stub.deps);
        made.canvas.mount();
        await flush();
        const handler = registered[0][1];
        await click(findByClass(made.container, 'backtest-preset-item')[0]);
        await flush();
        await typeAheadOfMap(made);
        await click(findByClass(made.container, 'backtest-code-ahead-fork')[0]);
        await flush();
        assert.equal(requests, 1);
        if (switched) {
          await switchWorkspace(made, handler);
          made.canvas.onChatAction({ kind: 'code_draft', source: `${VISUAL_SOURCE}# 다음 세션 편집\n` });
        }
        await made.tick();
        const before = made.canvas.getContext();
        const beforeText = textOf(made.container);
        const beforeReports = reports.length;
        const beforeCards = cards.length;
        const beforeSaves = saved.length;
        if (rejected) previous.reject(new Error('이전 세션 분기 실패'));
        else previous.resolve(pendingStage === 'create'
          ? { strategy_id: 'previous-strategy', version_id: 'previous-v1' }
          : { version_id: 'previous-v2', version: 2 });
        await flush();
        await made.tick();
        if (switched) {
          assert.deepEqual(made.canvas.getContext(), before);
          assert.equal(textOf(made.container), beforeText);
          assert.equal(reports.length, beforeReports);
          assert.equal(cards.length, beforeCards);
          assert.equal(saved.length, beforeSaves);
        } else if (rejected) {
          assert.match(textOf(made.container), /이전 세션 분기 실패/);
        } else {
          assert.equal(saved.length, 1);
          assert.equal(saved[0].id, 'previous-strategy');
          assert.equal(saved[0].body.origin, 'code_only');
          assert.equal(made.canvas.getContext().designTab, 'flow');
          assert.equal(cards[cards.length - 1].detail.kind, 'code_only');
        }
      })));
    }
  }
}

test('세션 복원: 폼의 대상·코드·로그가 돌아오고 표식이 카운트를 말한다', async () => withWorkspaceGlobal(async ({ registered }) => {
  const made = makeCanvas({ result: async () => ({ status: 'done', metrics: {}, stdout: '' }) });
  made.canvas.mount();
  await flush();
  const handler = registered[0][1];
  await handler.restore(RESTORE_WORKSPACE);
  await flush();
  const ctx = made.canvas.getContext();
  assert.equal(ctx.designTab, 'form');
  // 종목·기간은 그래프 왕복이 안 읽는 자리다 — 봉투에서 읽어야 돌아온다.
  assert.match(textOf(made.container), /005930/);
  assert.equal(findByClass(made.container, 'backtest-restore-count')[0].textContent, '복원 6/6');
  assert.equal(findByClass(made.container, 'backtest-restore-code')[0].textContent, 'restored');
  // 전부 돌아왔으면 아무 말도 하지 않는다(Rule 1).
  assert.equal(findByClass(made.container, 'backtest-restore-notice').length, 0);
}));

test('세션 복원: 결과를 못 읽으면 이름을 대는 안내가 서고 [이대로 열기]가 접는다', async () => withWorkspaceGlobal(async ({ registered }) => {
  const made = makeCanvas({ result: async () => { throw new Error('없는 실행입니다'); } });
  made.canvas.mount();
  await flush();
  await registered[0][1].restore(RESTORE_WORKSPACE);
  await flush();
  const notice = findByClass(made.container, 'backtest-restore-notice');
  assert.equal(notice.length, 1);
  assert.match(textOf(notice[0]), /일부만 복원했습니다/);
  // Paper 3WO4-1의 문면 그대로.
  assert.match(textOf(notice[0]), /결과 데이터셋 1장을 찾지 못했습니다/);
  assert.match(textOf(notice[0]), /폼·코드·로그는 그대로입니다/);
  // 못 읽은 결과 자리에도 봉인해 둔 로그는 남는다 — "실행이 없다"고 말하지 않는다.
  made.canvas.onChatAction({ kind: 'navigate', tab: 'result' });
  await flush();
  assert.match(textOf(made.container), /스크롤 위치 저장됨/);
  // 표식은 폼 카드·코드 카드의 머리에 붙는 것이라(Paper 3WJS-1 · 3WKB-1) 그 카드가 없는
  // 결과 탭에는 설 자리가 없다. 안내는 세션 전체를 두고 하는 말이라 여기서도 선다.
  assert.equal(findByClass(made.container, 'backtest-restore-mark').length, 0);
  assert.equal(findByClass(made.container, 'backtest-restore-open').length, 1);
  await click(findByClass(made.container, 'backtest-restore-open')[0]);
  await flush();
  assert.equal(findByClass(made.container, 'backtest-restore-notice').length, 0);
  // 표식은 안내를 접어도 남는다 — 배너가 아니라 카드의 상태이기 때문이다.
  made.canvas.onChatAction({ kind: 'navigate', tab: 'design' });
  await flush();
  assert.equal(findByClass(made.container, 'backtest-restore-code').length, 1);
}));

test('세션 복원: [다시 시도]가 빠진 결과만 다시 읽고 성공하면 안내가 사라진다', async () => withWorkspaceGlobal(async ({ registered }) => {
  let attempts = 0;
  const made = makeCanvas({
    result: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('없는 실행입니다');
      return { status: 'done', metrics: { total_return: 0.418 }, stdout: 'run start' };
    },
    trades: async () => [],
  });
  made.canvas.mount();
  await flush();
  await registered[0][1].restore(RESTORE_WORKSPACE);
  await flush();
  assert.equal(findByClass(made.container, 'backtest-restore-notice').length, 1);
  await click(findByClass(made.container, 'backtest-restore-retry')[0]);
  await flush();
  assert.equal(attempts, 2);
  assert.equal(findByClass(made.container, 'backtest-restore-notice').length, 0);
  // 되읽은 결과가 실제로 화면에 선다 — 안내만 사라지는 것이 아니다.
  made.canvas.onChatAction({ kind: 'navigate', tab: 'result' });
  await flush();
  assert.match(textOf(made.container), /run start/);
}));

test('세션 복원: 보고는 42번 보드 항목표를 담는다 — 폼·코드·결과·로그·스크롤', async () => withWorkspaceGlobal(async ({ reports }) => {
  const made = makeCanvas({
    run: async () => ({ run_id: 'run-1' }),
    result: async () => ({ status: 'done', metrics: {}, stdout: '14:02:11 run start' }),
    trades: async () => [],
  });
  made.canvas.mount();
  await flush();
  await fillForm(made.container);
  await click(findByClass(made.container, 'backtest-run-button')[0]);
  await flush();
  const last = reports[reports.length - 1];
  assert.ok(last.form && last.form.yaml.includes('005930'));
  assert.deepEqual(last.form.fields, ['symbols', 'period', 'fromDt', 'toDt', 'params', 'costs']);
  assert.deepEqual(last.run, { runId: 'run-1' });
  assert.equal(last.log.tail, '14:02:11 run start');
  assert.deepEqual(last.scroll, { top: 0 });
}));

test('세션 복원: 못 읽은 결과 자리에서 디바운스 재봉인이 저장본을 지우지 않는다', async () => withWorkspaceGlobal(async ({ registered, reports }) => {
  const made = makeCanvas({ result: async () => { throw new Error('없는 실행입니다'); } });
  made.canvas.mount();
  await flush();
  await registered[0][1].restore(RESTORE_WORKSPACE);
  await flush();
  await runPending(made);
  const last = reports[reports.length - 1];
  // 못 읽었다고 run_id·로그를 null로 적어 보내면 main의 얕은 병합이 저장본을 지운다 —
  // [다시 시도]가 되살릴 봉투 자체가 없어지고, 다음에 열면 실행이 없었던 일이 된다.
  assert.deepEqual(last.run, { runId: 'run-9' });
  assert.equal(last.log.tail, '14:02:19 done · 스크롤 위치 저장됨');
  assert.deepEqual(last.scroll, { top: 120 });
}));

test('세션 복원: 갈아타기 직전 flush()가 예약된 보고를 지금 흘린다', async () => withWorkspaceGlobal(async ({ registered, reports }) => {
  const made = makeCanvas({ result: async () => ({ status: 'done', metrics: {}, stdout: '' }) });
  made.canvas.mount();
  await flush();
  const handler = registered[0][1];
  await handler.restore(RESTORE_WORKSPACE);
  await flush();
  // 사람이 굴린 자리는 아직 예약 안에만 있다 — 갈아타면 그대로 사라지거나 남의 기록에 적힌다.
  const body = findByClass(made.container, 'backtest-body')[0];
  body.scrollTop = 40;
  await body.dispatchEvent({ type: 'scroll' });
  const before = reports.length;
  handler.flush();
  assert.equal(reports.length, before + 1);
  assert.deepEqual(reports[reports.length - 1].scroll, { top: 40 });
  // 흘린 뒤에는 예약이 남지 않는다 — 전환 뒤에 한 번 더 터지면 남의 기록에 적힌다.
  handler.flush();
  assert.equal(reports.length, before + 1);
}));

test('세션 복원: 되돌린 스크롤 자리는 다시 그려도 남고 사람이 굴리면 놓는다', async () => withWorkspaceGlobal(async ({ registered, reports }) => {
  const made = makeCanvas({
    result: async () => ({ status: 'done', metrics: {}, stdout: '' }),
    trades: async () => [],
  });
  made.canvas.mount();
  await flush();
  await registered[0][1].restore(RESTORE_WORKSPACE);
  await flush();
  assert.equal(findByClass(made.container, 'backtest-body')[0].scrollTop, 120);
  // 탭을 옮기면 새 몸통이 선다 — 저장된 자리는 그 몸통에도 다시 서야 한다.
  made.canvas.onChatAction({ kind: 'navigate', tab: 'result' });
  await flush();
  const body = findByClass(made.container, 'backtest-body')[0];
  assert.equal(body.scrollTop, 120);
  // 사람이 굴리면 그 자리는 사람의 것이다 — 되돌리기를 그만두고 굴린 자리를 봉인한다.
  body.scrollTop = 40;
  await body.dispatchEvent({ type: 'scroll' });
  await runPending(made);
  assert.deepEqual(reports[reports.length - 1].scroll, { top: 40 });
}));

test('세션 복원: 늦게 도착한 기법 목록이 복원한 자리를 뺏지 않는다', async () => withWorkspaceGlobal(async ({ registered }) => {
  let releasePresets;
  const made = makeCanvas({
    fetchPresets: () => new Promise((resolve) => { releasePresets = () => resolve(PRESETS); }),
    result: async () => ({ status: 'done', metrics: {}, stdout: '' }),
    trades: async () => [],
  });
  made.canvas.mount();
  await flush();
  // 프리셋이 아직 안 왔는데 복원이 먼저 도착한 판 — 실앱의 실제 순서다(모드 전환이
  // mount를 부르고, 그 다음 줄에서 chat.js가 workspace.restore를 부른다).
  await registered[0][1].restore({ ...RESTORE_WORKSPACE, tab: 'result', designTab: 'code' });
  await flush();
  releasePresets();
  await flush();
  assert.equal(made.canvas.getContext().tab, 'result');
  assert.equal(made.canvas.getContext().designTab, 'code');
}));

test('세션 복원: 아직 도는 실행은 진행 화면으로 다시 붙는다(Rule 2)', async () => withWorkspaceGlobal(async ({ registered }) => {
  let calls = 0;
  const made = makeCanvas({
    result: async () => { calls += 1; return { status: 'running' }; },
  });
  made.canvas.mount();
  await flush();
  await registered[0][1].restore(RESTORE_WORKSPACE);
  await flush();
  assert.equal(calls >= 1, true);
  assert.equal(made.canvas.getContext().view, 'running');
  // 도는 중은 실패가 아니다 — 안내를 세우지 않는다.
  assert.equal(findByClass(made.container, 'backtest-restore-notice').length, 0);
}));

test('세션 복원: 갈아탄 세션의 보고에 앞 세션의 실행·로그가 실리지 않는다', async () => withWorkspaceGlobal(async ({ registered, reports }) => {
  const made = makeCanvas({
    result: async () => ({ status: 'done', metrics: { total_return: 0.418 }, stdout: 'A의 표준출력' }),
    trades: async () => [],
  });
  made.canvas.mount();
  await flush();
  const handler = registered[0][1];
  await handler.restore(RESTORE_WORKSPACE);
  await flush();
  // 실행한 적 없는 세션으로 갈아탄다 — 봉투에 폼과 코드만 있다.
  await handler.restore({
    kind: 'backtest',
    tab: 'design',
    designTab: 'form',
    form: RESTORE_WORKSPACE.form,
    code: RESTORE_WORKSPACE.code,
  });
  await flush();
  await runPending(made);
  const last = reports[reports.length - 1];
  // 앞 세션의 run_id·로그를 실어 보내면 main의 얕은 병합이 이 세션 저장본에 그대로
  // 적는다 — 다음에 열면 없던 실행이 있었던 일이 되고 「복원」 표식까지 선다.
  assert.equal(last.run, null);
  assert.equal(last.log, null);
  // 화면도 마찬가지다 — 결과 탭에 앞 세션의 지표·출력이 이 세션의 것으로 서지 않는다.
  made.canvas.onChatAction({ kind: 'navigate', tab: 'result' });
  await flush();
  assert.equal(/A의 표준출력/.test(textOf(made.container)), false);
  assert.equal(/41\.8/.test(textOf(made.container)), false);
}));

test('세션 복원: 다른 세션으로 갈아타면 복원 표식·안내를 거둔다', async () => withWorkspaceGlobal(async ({ registered }) => {
  const made = makeCanvas({ result: async () => { throw new Error('없는 실행입니다'); } });
  made.canvas.mount();
  await flush();
  const handler = registered[0][1];
  await handler.restore(RESTORE_WORKSPACE);
  await flush();
  assert.equal(findByClass(made.container, 'backtest-restore-count').length, 1);
  assert.equal(findByClass(made.container, 'backtest-restore-notice').length, 1);
  // 대화 세션이나 새 대화로 갈아탄 자리 — restore()는 오지 않으므로 clear()가 거둔다.
  // 없으면 아무것도 되살린 적 없는 화면에 「복원 6/6」·「일부만 복원했습니다」가 남는다.
  handler.clear();
  await flush();
  assert.equal(findByClass(made.container, 'backtest-restore-count').length, 0);
  assert.equal(findByClass(made.container, 'backtest-restore-code').length, 0);
  assert.equal(findByClass(made.container, 'backtest-restore-notice').length, 0);
}));

for (const hidden of [false, true]) {
  test(`세션 복원: clear 뒤 앞 세션을 다시 봉인하지 않고 새 편집은 저장한다 (hidden=${hidden})`, async () => withWorkspaceGlobal(async ({ registered, reports }) => {
    const made = makeWorkspaceCanvas({
      result: async () => ({ status: 'done', metrics: {}, stdout: '앞 세션 로그' }),
      trades: async () => [],
    });
    made.canvas.mount();
    await flush();
    const handler = registered[0][1];
    await handler.restore(RESTORE_WORKSPACE);
    await made.tick();
    made.container.hidden = hidden;
    // chat.js가 새 기록 id를 요청하기 직전에 호출하는 실제 순서다.
    handler.flush();
    const before = reports.length;
    handler.clear();
    await made.tick();
    made.container.hidden = false;
    made.canvas.refresh();
    await flush();
    await made.tick();
    assert.equal(reports.length, before, '새 세션에 앞 세션의 작업공간을 보냈다');

    // 보고를 꺼서 통과시키면 안 된다 — 새 세션에서 고른 폼은 바로 저장되어야 한다.
    await click(findByClass(made.container, 'backtest-preset-item')[0]);
    await flush();
    await made.tick();
    const next = reports[reports.length - 1];
    assert.ok(reports.length > before);
    assert.match(next.form.yaml, /SMA 골든크로스/);
    assert.ok(!next.form.yaml.includes('005930'), '앞 세션의 대상까지 새 폼에 옮겼다');
    assert.equal(next.code, null);
    assert.equal(next.run, null);
    assert.equal(next.log, null);
    assert.notEqual(next.scroll && next.scroll.top, 120);
  }));
}

test('세션 복원: clear 전 시작한 결과 조회가 다음 복원에 늦게 섞이지 않는다', async () => withWorkspaceGlobal(async ({ registered, reports }) => {
  let finishResult;
  const result = new Promise((resolve) => { finishResult = resolve; });
  const made = makeWorkspaceCanvas({ result: () => result, trades: async () => [] });
  made.canvas.mount();
  await flush();
  const handler = registered[0][1];
  const restoring = handler.restore(RESTORE_WORKSPACE);
  handler.flush();
  handler.clear();
  await handler.restore({
    kind: 'backtest', tab: 'design', designTab: 'form',
    form: { yaml: RESTORE_YAML.replace('005930', '000660') },
  });
  await made.tick();
  const before = reports.length;
  finishResult({ status: 'done', metrics: { total_return: 0.418 }, stdout: '앞 세션 결과' });
  await restoring;
  await made.tick();
  assert.equal(reports.length, before, '이전 결과 조회가 새 세션에 보고를 만들었다');
  const next = reports[reports.length - 1];
  assert.match(next.form.yaml, /000660/);
  assert.equal(next.code, null);
  assert.equal(next.run, null);
  assert.equal(next.log, null);
  assert.equal(findByClass(made.container, 'backtest-restore-notice').length, 0);
}));

for (const pendingStage of ['start', 'status']) {
  test(`세션 복원: 앞 세션의 출처 ${pendingStage} 응답은 새 세션 지도를 바꾸지 않는다`, async () => withWorkspaceGlobal(async ({ registered, reports }) => {
    let finishPrevious;
    const previous = new Promise((resolve) => { finishPrevious = resolve; });
    let finishNext;
    const next = new Promise((resolve) => { finishNext = resolve; });
    const statusCalls = [];
    const made = makeWorkspaceCanvas({
      sourceMapStart: async ({ url }) => url.endsWith('/previous')
        ? (pendingStage === 'start' ? previous : { job_id: 'previous-source' })
        : { job_id: 'next-source' },
      sourceMapStatus: ({ job_id: jobId }) => {
        statusCalls.push(jobId);
        return jobId === 'previous-source' ? previous : next;
      },
    });
    made.canvas.mount();
    await flush();
    const handler = registered[0][1];
    made.canvas.onChatAction({ kind: 'source_url', url: 'https://example.com/previous' });
    await flush();
    handler.flush();
    handler.clear();
    made.canvas.onChatAction({ kind: 'source_url', url: 'https://example.com/next' });
    await flush();
    finishPrevious(pendingStage === 'start'
      ? { job_id: 'previous-source' }
      : sourceJobAt3of5({ status: 'done', spec_yaml: RESTORE_YAML }));
    await flush();
    await made.tick();
    assert.equal(made.canvas.getContext().view, 'sourcing');
    assert.deepEqual(statusCalls, pendingStage === 'start'
      ? ['next-source'] : ['previous-source', 'next-source']);
    // 새 세션의 응답은 정상 채택·저장한다 — 모든 출처 결과를 버리는 가드는 오답이다.
    finishNext(sourceJobAt3of5({ status: 'done', spec_yaml: SMA_YAML }));
    await flush();
    await made.tick();
    assert.equal(made.canvas.getContext().view, 'design');
    assert.match(reports[reports.length - 1].form.yaml, /SMA 골든크로스/);
    assert.ok(!reports[reports.length - 1].form.yaml.includes('변동성 돌파'));
  }));
}

test('세션 복원: 앞 세션의 실행 시작 응답을 새 세션 실행으로 저장하지 않는다', async () => withWorkspaceGlobal(async ({ registered, reports }) => {
  let finishRun;
  const running = new Promise((resolve) => { finishRun = resolve; });
  const made = makeWorkspaceCanvas({
    run: () => running,
    result: async () => ({ status: 'done', metrics: {}, stdout: '' }),
    trades: async () => [],
  });
  made.canvas.mount();
  await flush();
  const handler = registered[0][1];
  await handler.restore(RESTORE_WORKSPACE);
  assert.deepEqual(made.canvas.runFromChat(), []);
  handler.flush();
  handler.clear();
  await handler.restore({
    kind: 'backtest', tab: 'design', designTab: 'form',
    form: { yaml: RESTORE_YAML.replace('005930', '000660') },
  });
  await made.tick();
  const before = reports.length;
  finishRun({ run_id: 'previous-late-run', strategy_id: 'previous-strategy', version_id: 'previous-version' });
  await flush();
  await made.tick();
  assert.equal(reports.length, before);
  assert.equal(reports[reports.length - 1].run, null);
  assert.equal(reports[reports.length - 1].code, null);
  assert.equal(made.canvas.getContext().view, 'design');
}));

for (const dirty of [false, true]) {
  test(`세션 복원: 이전 IDE 파일이 복원 코드의 실행을 가로채지 않는다 (dirty=${dirty})`, async () => withWorkspaceGlobal(async ({ registered }) => {
    const sent = [];
    const made = makeWorkspaceCanvas(userStrategyDeps({
      run: async (body) => { sent.push(body); return { run_id: 'next-run' }; },
      result: async () => ({ status: 'running' }),
    }));
    made.canvas.mount();
    await flush();
    await fillForm(made.container);
    await toList(made.container);
    await click(findByClass(made.container, 'backtest-user-strategy-item')[0]);
    await flush();
    await flush();
    const draft = `${GOLDEN_SOURCE}# 저장 안 한 편집\n`;
    if (dirty) {
      const editor = findByClass(made.container, 'backtest-code-textarea')[0];
      editor.value = draft;
      await editor.dispatchEvent({ type: 'input' });
    }
    const handler = registered[0][1];
    handler.flush();
    handler.clear();
    const nextSource = 'PARAMS = {}\ndef signals(df, p):\n    return df\n# SESSION_B_CODE\n';
    await handler.restore({
      kind: 'backtest', designTab: 'code', form: RESTORE_WORKSPACE.form,
      code: { source: nextSource, file: 'b.py', runPath: 'code' },
    });
    assert.equal(made.canvas.getContext().project, null);
    assert.equal(findByClass(made.container, 'backtest-code-textarea')[0].value, nextSource);
    assert.deepEqual(made.canvas.runFromChat(), []);
    await flush();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].source, nextSource);
    assert.equal(sent[0].project_id, undefined);
    // 보존한 탭은 목록에서 그 기법을 다시 고르면 되살아나고, 저장 안 한 편집도 그대로 남는다.
    await toList(made.container);
    await click(findByClass(made.container, 'backtest-user-strategy-item')[0]);
    await flush();
    await flush();
    assert.equal(made.canvas.getContext().project.activeFile, 'strategies/golden.py');
    assert.equal(findByClass(made.container, 'backtest-code-textarea')[0].value, dirty ? draft : GOLDEN_SOURCE);
    assert.equal(made.canvas.getContext().project.dirty, dirty);
  }));
}

for (const pendingKind of ['graph', 'code']) {
  test(`세션 복원: 앞 세션의 ${pendingKind} 생성 응답은 새 세션 설계를 덮지 않는다`, async () => withWorkspaceGlobal(async ({ registered, reports }) => {
    let finishPrevious;
    const previous = new Promise((resolve) => { finishPrevious = resolve; });
    let requests = 0;
    const made = makeWorkspaceCanvas({
      visualFromSpec: () => {
        if (pendingKind === 'graph') { requests += 1; return previous; }
        return Promise.resolve({ graph: VISUAL_GRAPH });
      },
      visualValidate: async () => ({ valid: true, diagnostics: [] }),
      codegen: () => { requests += 1; return previous; },
    });
    made.canvas.mount();
    await flush();
    const handler = registered[0][1];
    await click(findByClass(made.container, 'backtest-preset-item')[0]);
    await flush();
    if (pendingKind === 'code') await click(findByClass(made.container, 'backtest-visual-open-code')[0]);
    await flush();
    assert.equal(requests, 1, '이전 세션 요청이 실제로 대기해야 한다');
    handler.flush();
    handler.clear();
    await handler.restore({
      kind: 'backtest', designTab: 'form',
      form: { yaml: RESTORE_YAML.replace('005930', '000660') },
    });
    await made.tick();
    const before = reports.length;
    finishPrevious(pendingKind === 'graph'
      ? { graph: { ...VISUAL_GRAPH, id: 'previous-session-graph' } }
      : { source: '# previous-session-code\n' });
    await flush();
    await made.tick();
    assert.equal(reports.length, before);
    assert.equal(reports[reports.length - 1].code, null);
    assert.notEqual(reports[reports.length - 1].graph?.id, 'previous-session-graph');
    assert.equal(made.canvas.getContext().designTab, 'form');
  }));
}

test('세션 복원: 바뀐 것이 없으면 같은 봉투를 다시 보고하지 않는다', async () => withWorkspaceGlobal(async ({ registered, reports }) => {
  const made = makeCanvas({
    result: async () => ({ status: 'done', metrics: {}, stdout: '' }),
    trades: async () => [],
  });
  made.canvas.mount();
  await flush();
  await registered[0][1].restore(RESTORE_WORKSPACE);
  await flush();
  await runPending(made);
  const before = reports.length;
  // 탭이 움직인 것은 한 번만 나간다 — 즉시 보고와 render()의 예약이 같은 봉투다.
  made.canvas.onChatAction({ kind: 'navigate', tab: 'result' });
  await flush();
  await runPending(made);
  assert.equal(reports.length, before + 1);
  // 화면이 다시 그려져도 봉투가 그대로면 아무것도 나가지 않는다 — 실행 폴링·진행률
  // 갱신이 전부 render()를 지나가므로, 여기서 거르지 않으면 세션 파일을 초당 다시 쓴다.
  made.canvas.onChatAction({ kind: 'navigate', tab: 'result' });
  await flush();
  await runPending(made);
  assert.equal(reports.length, before + 1);
}));

test('세션 복원: 새 기법을 고르면 복원 표식이 사라진다 — 지금 폼은 되살린 것이 아니다', async () => withWorkspaceGlobal(async ({ registered }) => {
  const made = makeCanvas({ result: async () => { throw new Error('없는 실행입니다'); } });
  made.canvas.mount();
  await flush();
  await registered[0][1].restore(RESTORE_WORKSPACE);
  await flush();
  assert.equal(findByClass(made.container, 'backtest-restore-count').length, 1);
  await toList(made.container);
  assert.equal(findByClass(made.container, 'backtest-restore-count').length, 0, '홈으로 가면 그 세션의 표식은 거둔다');
  await click(findByClass(made.container, 'backtest-preset-item')[0]);
  await flush();
  assert.equal(findByClass(made.container, 'backtest-restore-count').length, 0);
  assert.equal(findByClass(made.container, 'backtest-restore-notice').length, 0);
}));

// ── 보드 10 · 안 될 때의 두 상태 ────────────────────────────────────────────
//
// Paper는 「안 될 때」를 배지로 갈랐다: 실행이 터진 실패와, 기능 자체가 꺼진 비활성.
// 세 번째 카드(진행 유지)는 화면이 아니라 이 캔버스가 이미 하는 일이라(41번 보드
// 세션 복원 · resumePollingIfNeeded) 배지가 설 자리가 없다.

test('보드 10: 기능이 꺼진 상태는 「비활성」 배지와 다시 시도로 선다', async () => {
  const { container } = (() => {
    const made = makeCanvas({
      fetchPresets: async () => { throw new Error(backtestCanvas.BACKTEST_DISABLED_TEXT); },
    });
    made.canvas.mount();
    return made;
  })();
  await flush();

  assert.equal(findByClass(container, 'backtest-canvas-error').length, 1);
  assert.deepEqual(
    findByClass(container, 'backtest-error-badge').map((n) => n.textContent),
    ['비활성'],
  );
  assert.match(textOf(container), /설정에서 백테스트를 켜야 합니다/);
  // 내부 이름은 화면에 오르지 않는다.
  assert.ok(!textOf(container).includes('ATHENA_BACKTEST_ENABLED'));
  // 막다른 길 금지 — 켠 뒤 다시 물을 손잡이 하나가 남는다.
  assert.deepEqual(
    findByClass(container, 'backtest-error-back').map((n) => n.textContent),
    ['다시 시도'],
  );
});

test('보드 10: 꺼진 상태의 [다시 시도]는 목록을 다시 묻는다', async () => {
  let calls = 0;
  const made = makeCanvas({
    fetchPresets: async () => {
      calls += 1;
      if (calls === 1) throw new Error(backtestCanvas.BACKTEST_DISABLED_TEXT);
      return PRESETS;
    },
  });
  made.canvas.mount();
  await flush();
  await click(findByClass(made.container, 'backtest-error-back')[0]);
  await flush();

  assert.equal(calls, 2);
  assert.equal(findByClass(made.container, 'backtest-canvas-error').length, 0);
  assert.ok(findByClass(made.container, 'backtest-preset-item').length > 0);
});

test('보드 10: 그 밖의 오류는 「실패」 배지와 설계로 돌아가기다', async () => {
  const made = makeCanvas({
    fetchPresets: async () => { throw new Error('백테스트 실행에 실패했습니다'); },
  });
  made.canvas.mount();
  await flush();

  assert.deepEqual(
    findByClass(made.container, 'backtest-error-badge').map((n) => n.textContent),
    ['실패'],
  );
  assert.match(textOf(made.container), /백테스트 실행에 실패했습니다/);
  assert.deepEqual(
    findByClass(made.container, 'backtest-error-back').map((n) => n.textContent),
    ['설계로 돌아가기'],
  );
});

test('보드 10: 배지 판정은 문구 하나로 갈린다', () => {
  const { errorStateBadge, BACKTEST_DISABLED_TEXT } = backtestCanvas;
  assert.equal(errorStateBadge(BACKTEST_DISABLED_TEXT), '비활성');
  assert.equal(errorStateBadge(`${BACKTEST_DISABLED_TEXT} (503)`), '비활성');
  assert.equal(errorStateBadge('데이터 수집에 실패했습니다'), '실패');
  assert.equal(errorStateBadge(''), '실패');
});

test('보드 10: 설계를 마친 뒤 꺼진 것을 만나면 설계로 돌아갈 길도 남는다', async () => {
  const { container, canvas } = await mounted({
    run: async () => { throw new Error(backtestCanvas.BACKTEST_DISABLED_TEXT); },
  });
  await fillForm(container);
  await click(findByClass(container, 'backtest-run-button')[0]);
  await flush();

  assert.deepEqual(
    findByClass(container, 'backtest-error-badge').map((n) => n.textContent),
    ['비활성'],
  );
  assert.deepEqual(
    findByClass(container, 'backtest-error-back').map((n) => n.textContent),
    ['다시 시도', '설계로 돌아가기'],
  );
  await click(findByClass(container, 'backtest-error-back')[1]);
  assert.equal(canvas.getContext().view, 'design');
});

