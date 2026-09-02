// backtest-explain.js 단위 테스트 — jsdom 없이 최소 DOM 스텁으로 검증한다
// (backtest-canvas.test.js가 세운 관례를 그대로 쓴다).
//
// 이 파일이 지키는 계약은 하나다: **화면은 payload가 준 것만 그린다.** 문장을 지어내지
// 않고, 사실이 없으면 빈칸이며, 확실하지 않은 것은 확실하지 않게 그린다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Explain = require('./backtest-explain');

function fakeNode(tag) {
  return {
    tag,
    className: '',
    textContent: '',
    type: '',
    hidden: false,
    children: [],
    attrs: {},
    _listeners: {},
    get firstChild() { return this.children[0] || null; },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter((c) => c !== child); return child; },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === 'class') this.className = String(v);
    },
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
  global.document = { createElement: (tag) => fakeNode(tag) };
});

test.afterEach(() => { delete global.document; });

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

const PAYLOAD = {
  version: 5,
  source_kind: 'spec',
  target: { symbol: '005930', period: 'day', adjusted: true, from: '20240101', to: '20240630' },
  app_before: [{ key: 'load', title: '봉 데이터를 모읍니다', detail: '캐시에 있는 봉을 정리합니다' }],
  app_after: [
    { key: 'fill', title: '사고·파는 가격을 정합니다', detail: '다음 봉 시가로 체결합니다' },
    { key: 'cost', title: '비용을 뗍니다', detail: '수수료·거래세·슬리피지를 뺍니다' },
  ],
  boundary_after_note: 'entry·exit 두 열만 받습니다',
  boundary_after_lines: null,
  nodes: [
    {
      id: 'params', numeral: '①', title: '조절할 값을 정합니다',
      lines: [{ role: null, text: 'fast 20 (5–60, 1씩)' }],
      facts: [], status: 'ok', note: null, first_line: null, last_line: null, editable: true,
    },
    {
      id: 'indicators', numeral: '②', title: '가격을 지표로 바꿉니다',
      lines: [{ role: null, text: 'ma_fast — SMA(20) · 종가' }],
      facts: ['df — 240행 × 5열', '앞 60봉은 빈칸(워밍업)'],
      status: 'ok', note: null, first_line: 3, last_line: 4, editable: false,
    },
    {
      id: 'conditions', numeral: '③', title: '사고·파는 순간을 찍습니다',
      lines: [
        { role: 'entry', text: 'ma_fast가 ma_slow를 위로 뚫는 날' },
        { role: 'exit', text: 'ma_fast가 ma_slow를 아래로 뚫는 날' },
      ],
      facts: ['entry 3개 · exit 2개'],
      status: 'error', note: '지표를 만드는 칸이 멈췄습니다',
      first_line: null, last_line: null, editable: true,
    },
    {
      id: 'guard', numeral: '④', title: '지키는 선을 겁니다',
      lines: [], facts: [], status: 'unknown',
      note: '코드 전략의 지키는 선은 앱 설정에서 옵니다',
      first_line: null, last_line: null, editable: false,
    },
  ],
  free_code: [],
  unknown: [],
  error: null,
  code: { lines: 23, matches_map: true },
};

// ── 순수 계산 ───────────────────────────────────────────────────────────────

test('versionParticle: 숫자를 한국어로 읽었을 때의 받침으로 조사를 고른다', () => {
  assert.equal(Explain.versionParticle(1), '과');
  assert.equal(Explain.versionParticle(5), '와');
  assert.equal(Explain.versionParticle(10), '과');
  assert.equal(Explain.versionParticle(12), '와');
  assert.equal(Explain.versionParticle(17), '과');
  // 모르는 값에는 기본 조사를 쓴다 — 던지지 않는다.
  assert.equal(Explain.versionParticle(null), '과');
});

test('lineRange: 줄이 있는 칸만 범위를 준다 — 폼 경로의 칸에는 코드가 없다', () => {
  assert.deepEqual(Explain.lineRange({ first_line: 3, last_line: 7 }), { first: 3, last: 7 });
  assert.deepEqual(Explain.lineRange({ first_line: 3, last_line: null }), { first: 3, last: 3 });
  assert.equal(Explain.lineRange({ first_line: null }), null);
  assert.equal(Explain.lineRange(null), null);
});

test('targetText: 대상 한 줄은 payload가 준 것만 적는다', () => {
  assert.equal(
    Explain.targetText(PAYLOAD.target),
    '005930 · 일 · 20240101→20240630 · 수정주가',
  );
  assert.equal(Explain.targetText({ symbol: '005930', adjusted: false }), '005930 · 원주가');
  assert.equal(Explain.targetText(null), '');
});

// ── 지도 ────────────────────────────────────────────────────────────────────

test('지도: 머리말·대상 한 줄·경계 3줄·앱 칸·내 칸을 payload 순서대로 그린다', () => {
  const root = fakeNode('div');
  Explain.renderFlowMap(root, PAYLOAD, {});
  assert.equal(findByClass(root, 'backtest-map-head-title')[0].textContent, '이 전략은 이렇게 흐릅니다');
  assert.equal(findByClass(root, 'backtest-map-version')[0].textContent, '지도 v5');
  assert.equal(
    findByClass(root, 'backtest-map-target-text')[0].textContent,
    '005930 · 일 · 20240101→20240630 · 수정주가',
  );
  assert.equal(findByClass(root, 'backtest-flow-boundary').length, 3);
  assert.equal(findByClass(root, 'backtest-flow-node').filter((n) => /is-app/.test(n.className)).length, 3);
  const mine = findByClass(root, 'backtest-flow-node').filter((n) => /is-mine/.test(n.className));
  assert.equal(mine.length, 4);
  assert.deepEqual(
    findByClass(root, 'backtest-flow-badge').slice(1, 5).map((b) => b.children[0].textContent),
    ['①', '②', '③', '④'],
  );
});

test('지도: 마지막 경계가 "두 열만 받습니다"를 함께 적는다 — 그 자리가 계약이다', () => {
  const root = fakeNode('div');
  Explain.renderFlowMap(root, PAYLOAD, {});
  const labels = findByClass(root, 'backtest-flow-boundary-label').map((n) => n.textContent);
  assert.deepEqual(labels, [
    '앱이 준비해서 건넵니다',
    '여기부터 내 전략 — 대화로 고치는 칸들',
    '여기부터 다시 앱 — 전략이 손댈 수 없는 구간 · entry·exit 두 열만 받습니다',
  ]);
});

test('지도: 조건 칸의 두 문장에 진입·청산 이름표가 붙는다', () => {
  const root = fakeNode('div');
  Explain.renderFlowMap(root, PAYLOAD, {});
  const details = findByClass(root, 'backtest-flow-detail').map((n) => n.textContent);
  assert.ok(details.includes('진입 — ma_fast가 ma_slow를 위로 뚫는 날'));
  assert.ok(details.includes('청산 — ma_fast가 ma_slow를 아래로 뚫는 날'));
});

test('지도: 오른쪽 사실은 실행이 준 값만 — 없는 칸은 빈칸이다', () => {
  const root = fakeNode('div');
  Explain.renderFlowMap(root, PAYLOAD, {});
  const shapes = findByClass(root, 'backtest-flow-shape').map((n) => n.textContent);
  assert.ok(shapes.includes('df — 240행 × 5열\n앞 60봉은 빈칸(워밍업)'));
  assert.ok(shapes.includes('entry 3개 · exit 2개'));
  // 파라미터 칸은 실행이 만든 사실이 없다 — 지어내지 않는다.
  assert.equal(shapes.filter((t) => t === '').length >= 1, true);
});

test('지도: 상태 고리와 사유는 ok가 아닐 때만 뜬다', () => {
  const root = fakeNode('div');
  Explain.renderFlowMap(root, PAYLOAD, {});
  const mine = findByClass(root, 'backtest-flow-node').filter((n) => /is-mine/.test(n.className));
  assert.equal(mine[0].className.includes('is-error'), false);
  assert.equal(mine[2].className.includes('is-error'), true);
  assert.equal(mine[3].className.includes('is-unknown'), true);
  const notes = findByClass(root, 'backtest-flow-note').map((n) => n.textContent);
  assert.deepEqual(notes, ['지표를 만드는 칸이 멈췄습니다', '코드 전략의 지키는 선은 앱 설정에서 옵니다']);
});

test('지도: 방금 바뀐 칸과 대상 줄에만 알약이 붙는다', () => {
  const root = fakeNode('div');
  Explain.renderFlowMap(root, PAYLOAD, { changedIds: new Set(['target', 'conditions']) });
  const pills = findByClass(root, 'backtest-map-changed');
  assert.equal(pills.length, 2);
  assert.deepEqual(pills.map((p) => p.textContent), ['방금 바뀜', '방금 바뀜']);
});

test('지도: 지난 실행이 있을 때만 "지난 실행의 실제 값"이라고 말한다', () => {
  const withRun = fakeNode('div');
  Explain.renderFlowMap(withRun, PAYLOAD, { lastRunLabel: 'a1b2c3d4' });
  assert.match(findByClass(withRun, 'backtest-map-head-sub')[0].textContent, /지난 실행\(#a1b2c3d4\)의 실제 값/);

  const noRun = fakeNode('div');
  Explain.renderFlowMap(noRun, PAYLOAD, {});
  assert.equal(findByClass(noRun, 'backtest-map-head-sub')[0].textContent, '칸을 누르면 대화가 그 칸을 다룹니다');
});

test('지도: 칸을 누르면 그 칸을 통째로 넘긴다 — 무엇을 할지는 부르는 쪽이 정한다', () => {
  const root = fakeNode('div');
  const picked = [];
  Explain.renderFlowMap(root, PAYLOAD, { onSelect: (node) => picked.push(node.id) });
  const mine = findByClass(root, 'backtest-flow-node').filter((n) => /is-mine/.test(n.className));
  mine[1].dispatchEvent({ type: 'click' });
  assert.deepEqual(picked, ['indicators']);
});

test('지도가 못 담은 코드는 그 사실 그대로 선다 — 빈칸으로 숨기지 않는다', () => {
  const root = fakeNode('div');
  Explain.renderFlowMap(root, Object.assign({}, PAYLOAD, {
    free_code: [{ first_line: 9, last_line: 12, text: '지도가 못 담는 코드' }],
    unknown: ['9–12줄을 어느 단계로 볼지 확신하지 못했습니다'],
  }), {});
  const free = findByClass(root, 'backtest-flow-node').filter((n) => /is-free/.test(n.className));
  assert.equal(free.length, 1);
  assert.equal(free[0].children[1].children[0].textContent, '지도가 못 담는 코드 · 9–12줄');
  assert.equal(findByClass(root, 'backtest-flow-unknown-line').length, 1);
});

test('지도를 못 그리면 그 사실만 그린다 — 반쪽 지도를 그리지 않는다', () => {
  const root = fakeNode('div');
  Explain.renderFlowMap(root, { error: 'signals(df, p)를 찾지 못했습니다' }, {});
  assert.equal(findByClass(root, 'backtest-flow-error').length, 1);
  assert.equal(findByClass(root, 'backtest-flow-node').length, 0);
  assert.match(textOf(root), /signals\(df, p\)를 찾지 못했습니다/);
});

// ── 코드 서랍(보드 14-E) ────────────────────────────────────────────────────

test('서랍: 지도와 일치하면 그렇게 적고, [코드 열기] 하나만 둔다', () => {
  const root = fakeNode('div');
  let opened = 0;
  Explain.renderFlowMap(root, PAYLOAD, {
    drawer: {
      fileLabel: 'golden_cross.py', matchesMap: true, aheadOfMap: false,
      onOpenCode: () => { opened += 1; },
    },
  });
  assert.equal(
    findByClass(root, 'backtest-map-drawer-text')[0].textContent,
    '이 지도 뒤의 코드 · golden_cross.py · 23줄 · 지도 v5와 일치',
  );
  assert.equal(
    findByClass(root, 'backtest-map-drawer-note')[0].textContent,
    '웬만하면 열 일이 없습니다 — 최후의 보루',
  );
  assert.equal(findByClass(root, 'backtest-map-drawer-badge').length, 0);
  assert.equal(findByClass(root, 'backtest-map-back').length, 0);
  findByClass(root, 'backtest-map-open-code')[0].dispatchEvent({ type: 'click' });
  assert.equal(opened, 1);
});

test('서랍: 코드가 지도보다 앞서면 배지와 [지도로 되돌리기]가 함께 뜬다', () => {
  const root = fakeNode('div');
  let back = 0;
  Explain.renderFlowMap(root, PAYLOAD, {
    drawer: {
      fileLabel: 'strategy.py', matchesMap: true, aheadOfMap: true,
      onBackToMap: () => { back += 1; },
    },
  });
  assert.equal(
    findByClass(root, 'backtest-map-drawer-text')[0].textContent,
    '이 지도 뒤의 코드 · strategy.py · 23줄',
  );
  assert.equal(findByClass(root, 'backtest-map-drawer-badge')[0].textContent, '코드가 지도보다 앞섬');
  findByClass(root, 'backtest-map-back')[0].dispatchEvent({ type: 'click' });
  assert.equal(back, 1);
});

test('서랍: 지도가 코드를 다 담지 못했으면 일치한다고 말하지 않는다', () => {
  const root = fakeNode('div');
  Explain.renderFlowMap(root, PAYLOAD, {
    drawer: { fileLabel: 'strategy.py', matchesMap: false, aheadOfMap: false },
  });
  assert.equal(
    findByClass(root, 'backtest-map-drawer-badge')[0].textContent,
    '지도가 담지 못한 코드가 있습니다',
  );
  assert.equal(findByClass(root, 'backtest-map-drawer-text')[0].textContent.includes('일치'), false);
});

test('서랍이 없으면 지도만 그린다 — 코드로 가는 길을 억지로 만들지 않는다', () => {
  const root = fakeNode('div');
  Explain.renderFlowMap(root, PAYLOAD, {});
  assert.equal(findByClass(root, 'backtest-map-drawer').length, 0);
});

// ── 오류 진단(보드 09·12) ───────────────────────────────────────────────────

test('진단: 수정안이 없으면 지어내지 않고 그 사실을 적는다', () => {
  const root = fakeNode('div');
  Explain.renderDiagnosis(root, {
    title: '② 가격을 지표로 바꿉니다 — df에 없는 열을 찾았습니다',
    why: 'atr 열은 df에 없습니다', raw: 'KeyError: atr',
    unknown_reason: '어느 지표를 뜻하는지 확신하지 못했습니다',
  }, {});
  assert.equal(
    findByClass(root, 'backtest-diag-title')[0].textContent,
    '② 가격을 지표로 바꿉니다 — df에 없는 열을 찾았습니다',
  );
  assert.equal(findByClass(root, 'backtest-diag-nofix').length, 1);
  assert.equal(findByClass(root, 'backtest-diag-apply').length, 0);
});

test('진단: 세 갈래는 사람이 누를 때만 움직인다(보드 12)', () => {
  const root = fakeNode('div');
  const calls = [];
  Explain.renderDiagnosis(root, {
    title: '멈췄습니다', why: '이유', raw: 'Traceback',
    suggestion: { removed: 1, added: 2, summary: 'atr를 계산해 붙입니다', new_source: 'x = 1', diff_lines: [] },
  }, {
    onApply: (src, alsoRun) => calls.push(['apply', src, alsoRun]),
    onDiscard: () => calls.push(['discard']),
  });
  const labels = [
    findByClass(root, 'backtest-diag-apply')[0].textContent,
    findByClass(root, 'backtest-diag-apply-only')[0].textContent,
    findByClass(root, 'backtest-diag-discard')[0].textContent,
  ];
  assert.deepEqual(labels, ['적용하고 다시 실행', '지도만 고치기', '버리기']);
  assert.deepEqual(calls, []);
  findByClass(root, 'backtest-diag-apply-only')[0].dispatchEvent({ type: 'click' });
  assert.deepEqual(calls, [['apply', 'x = 1', false]]);
});
