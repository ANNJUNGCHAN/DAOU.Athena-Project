'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CARD_ACTIONS, cardActionFor, actionNodes, rowStock, cardActionEnvelope, cardActionSeed,
} = require('./board-card-actions');

// jsdom 없이 검증한다 — board-mount.test.js와 같은 관행(DOM 스텁 주입).
// 추출 원문의 표 행은 class 없는 상자 중첩이라, 스텁도 그 모양(상자 안 잎)으로 만든다.
function leaf(text) {
  return { text, children: [], parentElement: null };
}

function box(children) {
  return { text: '', children, parentElement: null };
}

function mount(node, parent = null) {
  node.parentElement = parent;
  node.childElementCount = node.children.length;
  Object.defineProperty(node, 'textContent', {
    get() {
      return node.children.length
        ? node.children.map((child) => child.textContent).join('')
        : node.text;
    },
    configurable: true,
  });
  node.querySelectorAll = (selector) => {
    assert.equal(selector, '*');
    const out = [];
    const walk = (current) => {
      for (const child of current.children) {
        out.push(child);
        walk(child);
      }
    };
    walk(node);
    return out;
  };
  for (const child of node.children) mount(child, node);
  return node;
}

function rankingSurface() {
  const row = (name, code) => box([
    leaf('01'), leaf(name), leaf(code), leaf('150,850'), leaf('+1.24%'),
    box([leaf('종목 상세 열기'), leaf('비교에 추가')]),
  ]);
  return mount(box([
    box([leaf('삼성전자'), leaf('005930'), leaf('호가 열기')]),
    box([row('SK하이닉스', '000660'), row('현대차', '005380')]),
  ]));
}

test('cardActionFor는 Paper 문구가 정확히 같을 때만 목적지를 준다', () => {
  assert.equal(cardActionFor('호가 열기').board_id, '13BC-2');
  assert.equal(cardActionFor('  종목 상세 열기  ').board_id, '137X-2');
  assert.equal(cardActionFor('호가'), null);
  assert.equal(cardActionFor('호가 열기 버튼'), null);
  assert.equal(cardActionFor(''), null);
});

test('목적지 표는 카드 종류와 짝이 맞는다 — 어긋나면 통합 카드 판정이 닫힌다', () => {
  const kinds = { 'CC-03': 'instrument', 'CC-04': 'orderbook' };
  for (const action of CARD_ACTIONS) {
    assert.ok(action.stock === 'card' || action.stock === 'row', action.control);
    if (action.kind !== 'open-card') continue;
    assert.equal(action.card_kind, kinds[action.card_id], action.control);
  }
});

test('「알림 설정」은 카드를 열지 않는다 — 에이전트 모드 새 알람으로 간다', () => {
  const action = cardActionFor('알림 설정');
  assert.equal(action.kind, 'agent-watch');
  assert.equal(action.view, 'agent');
  assert.equal(action.board_id, undefined, '카드 보드가 없는 조작이다');
  // 봉투를 만들면 목적지 없는 카드가 선다 — 종목이 있어도 만들지 않는다.
  assert.equal(cardActionEnvelope(action, { stkCd: '005930' }), null);
});

test('씨문장은 짧은 사람 말이고 조건은 사람이 말한다', () => {
  const action = cardActionFor('알림 설정');
  assert.equal(cardActionSeed(action, { stkCd: '005930', stockName: '삼성전자' }),
    '삼성전자 — 감시 알람 만들어 줘');
  // 이름을 못 읽었으면 코드로라도 주체를 말한다.
  assert.equal(cardActionSeed(action, { stkCd: '005930' }), '005930 종목 — 감시 알람 만들어 줘');
  // 주체가 없으면 심지 않는다(빈 문장을 심으면 입력창만 비운다).
  assert.equal(cardActionSeed(action, {}), '');
  // 카드를 여는 조작에는 씨문장이 없다.
  assert.equal(cardActionSeed(cardActionFor('호가 열기'), { stkCd: '005930' }), '');
});

test('actionNodes는 문구가 같은 잎만 집는다 — 상위 상자는 안 집는다', () => {
  const surface = rankingSurface();
  const found = actionNodes(surface);
  assert.deepEqual(
    found.map((entry) => entry.action.control),
    ['호가 열기', '종목 상세 열기', '종목 상세 열기'],
  );
  for (const entry of found) assert.equal(entry.node.childElementCount, 0);
});

test('rowStock은 누른 줄의 종목만 집는다 — 다른 줄·카드 머리로 새지 않는다', () => {
  const surface = rankingSurface();
  const [, first, second] = actionNodes(surface);
  assert.deepEqual(rowStock(first.node, surface), { stkCd: '000660', stockName: 'SK하이닉스' });
  assert.deepEqual(rowStock(second.node, surface), { stkCd: '005380', stockName: '현대차' });
});

test('rowStock은 코드가 없으면 지어내지 않는다', () => {
  const surface = mount(box([box([leaf('종목 상세 열기')])]));
  const [entry] = actionNodes(surface);
  assert.equal(rowStock(entry.node, surface), null);
});

test('봉투는 통합 카드로 갈 형상이다 — 종목코드가 없으면 만들지 않는다', () => {
  const action = cardActionFor('호가 열기');
  assert.equal(cardActionEnvelope(action, { stkCd: '' }), null);
  const envelope = cardActionEnvelope(action, { stkCd: '005930', stockName: '삼성전자' });
  assert.equal(envelope.card_id, 'CC-04');
  assert.equal(envelope.card_kind, 'orderbook');
  assert.equal(envelope.surface_contract.board_id, '13BC-2');
  assert.equal(envelope.operation_args.stk_cd, '005930');
  assert.equal(envelope.card_title, '삼성전자 실시간 호가·체결');
  assert.equal(envelope.correlation.ordinal, 1);
  // 합성 ref다 — 목적지 보드의 실제 op를 실으면 하이드레이션 실패가 카드를 닫는다.
  assert.match(envelope.operation_ref, /^card-action:/);
  assert.deepEqual(envelope.surface_contract.slot_values, {});
});

test('종목명이 없으면 제목은 조작 이름만 쓴다', () => {
  const envelope = cardActionEnvelope(cardActionFor('종목 상세 열기'), { stkCd: '000660' });
  assert.equal(envelope.card_title, '종목 상세');
});
