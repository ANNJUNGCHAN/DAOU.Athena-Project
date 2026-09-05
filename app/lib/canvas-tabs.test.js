'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tabTitleFor, targetLabel, maskAccount, createDeck, STORAGE_KEY } = require('./canvas-tabs');
const { instanceKeyFor } = require('./integrated-card-surface');

// jsdom 없이 검증한다 — ranking-axis.test.js와 같은 관행(document 스텁 주입).
function makeDoc() {
  const doc = {
    focused: null,
    createElement(tag) {
      return {
        tag,
        className: '',
        textContent: '',
        hidden: false,
        tabIndex: 0,
        type: '',
        draggable: false,
        focus() { doc.focused = this; },
        dataset: {},
        attributes: {},
        children: [],
        listeners: [],
        parent: null,
        setAttribute(name, value) { this.attributes[name] = value; },
        getAttribute(name) { return this.attributes[name]; },
        addEventListener(type, handler) { this.listeners.push({ type, handler }); },
        dispatch(type, event = {}) {
          this.listeners.filter((l) => l.type === type).forEach((l) => l.handler(event));
        },
        appendChild(child) {
          if (child.parent) child.parent.children = child.parent.children.filter((c) => c !== child);
          child.parent = this;
          this.children.push(child);
          return child;
        },
        replaceChildren(...kids) {
          for (const child of this.children) child.parent = null;
          this.children = [];
          for (const kid of kids) this.appendChild(kid);
        },
        remove() {
          if (!this.parent) return;
          this.parent.children = this.parent.children.filter((c) => c !== this);
          this.parent = null;
        },
      };
    },
  };
  return doc;
}

// HTML5 드래그의 dataTransfer 최소 스텁 — 브라우저가 주는 것과 같은 표면만 흉내낸다.
function makeTransfer() {
  const data = new Map();
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: (type, value) => { data.set(type, value); },
    getData: (type) => data.get(type) || '',
  };
}

function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, value); },
  };
}

function card(doc, name) {
  const node = doc.createElement('div');
  node.dataset.name = name;
  return node;
}

test('탭 제목은 `카드명 · 대상` — 종목명 > 코드 > 계좌 뒤 4자리 순으로 있는 값만 쓴다', () => {
  assert.equal(tabTitleFor({ card_title: '시세', stk_nm: '삼성전자', stk_cd: '005930' }), '시세 · 삼성전자');
  assert.equal(tabTitleFor({ card_title: '시세', stk_cd: '005930' }), '시세 · 005930');
  assert.equal(tabTitleFor({ card_title: '계좌', operation_args: { acnt_no: '81234721' } }), '계좌 · ****4721');
  // 대상이 없으면 카드명만 — 없는 대상을 지어내지 않는다.
  assert.equal(tabTitleFor({ card_title: '탐색' }), '탐색');
  // card_title이 없으면 호출부가 준 통합 카드 제목으로 떨어진다.
  assert.equal(tabTitleFor({ stk_nm: '삼성전자' }, '종목·상품 통합 카드'), '종목·상품 통합 카드 · 삼성전자');
  assert.equal(tabTitleFor({}), '카드');
  assert.equal(targetLabel({ operation_args: { stk_nm: '카카오' } }), '카카오');
  assert.equal(targetLabel({}), null);
});

test('계좌번호는 뒤 4자리만 남긴다', () => {
  assert.equal(maskAccount('8012-34-4721'), '****4721');
  assert.equal(maskAccount('12'), '****');
  assert.equal(maskAccount(''), '****');
});

test('탭 1개 = 인스턴스 키 1개 — 같은 키의 후속 봉투는 새 탭을 만들지 않는다', () => {
  const doc = makeDoc();
  const deck = createDeck({ doc, storage: makeStorage() });
  const first = { card_id: 'CC-03', card_kind: 'instrument', card_title: '시세', stk_cd: '005930', stk_nm: '삼성전자' };
  const second = { ...first, card_title: '차트' };
  const keyOne = instanceKeyFor(first);

  const cardA = card(doc, 'a');
  deck.upsert(cardA, { key: keyOne, title: tabTitleFor(first) });
  assert.deepEqual(deck.keys(), [keyOne]);
  assert.equal(deck.strip.children.length, 1);

  const cardB = card(doc, 'b');
  deck.upsert(cardB, { key: instanceKeyFor(second), title: tabTitleFor(second) });
  assert.deepEqual(deck.keys(), [keyOne], '같은 인스턴스 키는 탭을 늘리지 않는다');
  assert.equal(deck.strip.children.length, 1);
  assert.equal(deck.titleFor(keyOne), '차트 · 삼성전자');
  assert.equal(deck.cardFor(keyOne), cardB);
  assert.equal(cardA.parent, null, '이전 카드는 패널에서 빠진다');

  const other = { card_id: 'CC-01', card_kind: 'account', card_title: '계좌', account_no: '8012344721' };
  const keyTwo = instanceKeyFor(other);
  deck.upsert(card(doc, 'c'), { key: keyTwo, title: tabTitleFor(other) });
  assert.deepEqual(deck.keys(), [keyOne, keyTwo]);
  assert.equal(deck.activeKey(), keyTwo, '새 카드는 자동으로 활성된다');
  assert.equal(deck.element.dataset.tabCount, '2');
});

test('활성 전환은 탭 한 개만 켜고 나머지 패널을 감춘다', () => {
  const doc = makeDoc();
  const deck = createDeck({ doc, storage: makeStorage() });
  deck.upsert(card(doc, 'a'), { key: 'k1', title: '시세 · 삼성전자' });
  deck.upsert(card(doc, 'b'), { key: 'k2', title: '계좌 · ****4721' });
  const [tab1, tab2] = deck.strip.children;
  assert.deepEqual([tab1.className, tab2.className], ['canvas-tab', 'canvas-tab is-active']);
  assert.deepEqual([tab1.attributes['aria-selected'], tab2.attributes['aria-selected']], ['false', 'true']);
  assert.deepEqual(deck.viewport.children.map((panel) => panel.hidden), [true, false]);

  tab1.dispatch('click');
  assert.equal(deck.activeKey(), 'k1');
  assert.deepEqual(deck.viewport.children.map((panel) => panel.hidden), [false, true]);
  assert.deepEqual([tab1.tabIndex, tab2.tabIndex], [0, -1]);
});

test('닫기는 그 탭만 지우고 이웃을 활성으로 올리며 카드 정리를 호출부에 넘긴다', () => {
  const doc = makeDoc();
  const closed = [];
  const deck = createDeck({ doc, storage: makeStorage(), onClose: (node, key) => closed.push([node.dataset.name, key]) });
  deck.upsert(card(doc, 'a'), { key: 'k1', title: 'A' });
  deck.upsert(card(doc, 'b'), { key: 'k2', title: 'B' });
  deck.upsert(card(doc, 'c'), { key: 'k3', title: 'C' });

  const closeButton = deck.strip.children[1].children[1];
  let stopped = 0;
  closeButton.dispatch('click', { stopPropagation: () => { stopped += 1; } });
  assert.equal(stopped, 1, '닫기는 탭 활성 클릭으로 번지지 않는다');
  assert.deepEqual(deck.keys(), ['k1', 'k3']);
  assert.deepEqual(closed, [['b', 'k2']]);
  assert.equal(deck.strip.children.length, 2);
  assert.equal(deck.viewport.children.length, 2);

  deck.close('k3');
  assert.equal(deck.activeKey(), 'k1');
  deck.close('k1');
  assert.equal(deck.activeKey(), null);
  assert.deepEqual(deck.keys(), []);
});

test('탭 순서와 활성은 세션에 저장되고 다음 덱이 그 순서대로 복원한다', () => {
  const doc = makeDoc();
  const storage = makeStorage();
  const first = createDeck({ doc, storage });
  first.upsert(card(doc, 'a'), { key: 'k1', title: 'A' });
  first.upsert(card(doc, 'b'), { key: 'k2', title: 'B' });
  first.upsert(card(doc, 'c'), { key: 'k3', title: 'C' });
  assert.deepEqual(first.move('k3', 0), ['k3', 'k1', 'k2']);
  first.activate('k1');
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), { order: ['k3', 'k1', 'k2'], active: 'k1' });

  // 새 덱은 도착 순서가 달라도 저장된 순서를 존중한다.
  const doc2 = makeDoc();
  const revived = createDeck({ doc: doc2, storage });
  revived.upsert(card(doc2, 'b'), { key: 'k2', title: 'B' });
  revived.upsert(card(doc2, 'a'), { key: 'k1', title: 'A' });
  revived.upsert(card(doc2, 'c'), { key: 'k3', title: 'C' });
  assert.deepEqual(revived.keys(), ['k3', 'k1', 'k2']);
  assert.deepEqual(revived.strip.children.map((tab) => tab.dataset.tabKey), ['k3', 'k1', 'k2']);
  // 처음 보는 키는 맨 뒤로.
  revived.upsert(card(doc2, 'd'), { key: 'k9', title: 'D' });
  assert.deepEqual(revived.keys(), ['k3', 'k1', 'k2', 'k9']);
});

test('세션 저장이 막혀 있어도 탭 자체는 동작한다', () => {
  const doc = makeDoc();
  const hostile = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  const deck = createDeck({ doc, storage: hostile });
  deck.upsert(card(doc, 'a'), { key: 'k1', title: 'A' });
  assert.deepEqual(deck.keys(), ['k1']);
  assert.equal(deck.activeKey(), 'k1');
});

test('덱 골격은 스트립 + 뷰포트 1개다', () => {
  const doc = makeDoc();
  const deck = createDeck({ doc, storage: makeStorage() });
  assert.equal(deck.element.className, 'canvas-tab-deck');
  assert.deepEqual(deck.element.children.map((node) => node.className), ['canvas-tab-strip', 'canvas-tab-viewport']);
  assert.equal(deck.strip.attributes.role, 'tablist');
  assert.equal(deck.element.dataset.tabCount, '0');
});

test('탭은 HTML5 드래그로 순서를 바꾸고 바뀐 순서가 세션에 남는다', () => {
  const doc = makeDoc();
  const storage = makeStorage();
  const deck = createDeck({ doc, storage });
  deck.upsert(card(doc, 'a'), { key: 'k1', title: 'A' });
  deck.upsert(card(doc, 'b'), { key: 'k2', title: 'B' });
  deck.upsert(card(doc, 'c'), { key: 'k3', title: 'C' });
  const [tab1, , tab3] = deck.strip.children;
  assert.equal(tab1.draggable, true, '탭이 draggable이 아니면 dragstart 자체가 없다');

  const transfer = makeTransfer();
  tab3.dispatch('dragstart', { dataTransfer: transfer });
  assert.equal(tab3.dataset.dragging, 'true');
  assert.equal(transfer.getData('text/plain'), 'k3');

  let prevented = 0;
  const preventDefault = () => { prevented += 1; };
  tab1.dispatch('dragover', { dataTransfer: transfer, preventDefault });
  assert.equal(prevented, 1, 'dragover에서 preventDefault를 안 하면 브라우저가 drop을 주지 않는다');
  assert.equal(transfer.dropEffect, 'move');

  tab1.dispatch('drop', { dataTransfer: transfer, preventDefault });
  assert.deepEqual(deck.keys(), ['k3', 'k1', 'k2']);
  assert.deepEqual(deck.strip.children.map((tab) => tab.dataset.tabKey), ['k3', 'k1', 'k2']);
  assert.equal(tab3.dataset.dragging, undefined, '끌기가 끝나면 표시가 지워진다');
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)).order, ['k3', 'k1', 'k2']);
});

test('끌던 것이 없거나 자기 자신에 놓으면 순서는 그대로다', () => {
  const doc = makeDoc();
  const deck = createDeck({ doc, storage: makeStorage() });
  deck.upsert(card(doc, 'a'), { key: 'k1', title: 'A' });
  deck.upsert(card(doc, 'b'), { key: 'k2', title: 'B' });
  const [tab1, tab2] = deck.strip.children;

  tab2.dispatch('drop', { preventDefault: () => {} });
  assert.deepEqual(deck.keys(), ['k1', 'k2'], '드래그 없이 온 drop은 무시한다');

  const transfer = makeTransfer();
  tab1.dispatch('dragstart', { dataTransfer: transfer });
  tab1.dispatch('drop', { dataTransfer: transfer, preventDefault: () => {} });
  assert.deepEqual(deck.keys(), ['k1', 'k2']);

  tab1.dispatch('dragstart', { dataTransfer: transfer });
  tab1.dispatch('dragend', {});
  assert.equal(tab1.dataset.dragging, undefined);
  assert.equal(deck.dragKey, null);
  // 끌기가 끝난 뒤의 dragover는 preventDefault를 하지 않는다 — 남의 드래그를 가로채지 않는다.
  let prevented = 0;
  tab2.dispatch('dragover', { dataTransfer: transfer, preventDefault: () => { prevented += 1; } });
  assert.equal(prevented, 0);
});

test('좌우 화살표는 이웃 탭으로 전환하고 포커스를 옮긴다 — 끝에서는 반대편으로 돈다', () => {
  const doc = makeDoc();
  const deck = createDeck({ doc, storage: makeStorage() });
  deck.upsert(card(doc, 'a'), { key: 'k1', title: 'A' });
  deck.upsert(card(doc, 'b'), { key: 'k2', title: 'B' });
  deck.upsert(card(doc, 'c'), { key: 'k3', title: 'C' });
  deck.activate('k1');
  const [tab1, tab2, tab3] = deck.strip.children;

  tab1.dispatch('keydown', { key: 'ArrowRight', preventDefault: () => {} });
  assert.equal(deck.activeKey(), 'k2');
  assert.equal(doc.focused, tab2, '전환한 탭으로 포커스가 따라간다');

  tab2.dispatch('keydown', { key: 'ArrowLeft', preventDefault: () => {} });
  assert.equal(deck.activeKey(), 'k1');

  tab1.dispatch('keydown', { key: 'ArrowLeft', preventDefault: () => {} });
  assert.equal(deck.activeKey(), 'k3');
  assert.equal(doc.focused, tab3);

  tab3.dispatch('keydown', { key: 'ArrowRight', preventDefault: () => {} });
  assert.equal(deck.activeKey(), 'k1');

  // 순서는 화살표로 바뀌지 않는다 — 정렬은 드래그만 한다.
  assert.deepEqual(deck.keys(), ['k1', 'k2', 'k3']);
  tab1.dispatch('keydown', { key: 'Enter', preventDefault: () => {} });
  assert.equal(deck.activeKey(), 'k1');
});

// ---------- canvas.js 배선 계약 ----------
// canvas.js는 shell.html에서만 도는 렌더러라 node --test가 실행할 수 없다.
// 그래서 배선 지점만 소스 수준에서 고정한다(raw-ui-boundary.test.js와 같은 관행).

const fs = require('node:fs');
const path = require('node:path');
const CANVAS = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');

test('통합 카드는 두 반환 경로 모두에서 자기 탭으로 옮겨진다', () => {
  const renderer = CANVAS.slice(
    CANVAS.indexOf('async function renderIntegratedCard'),
    CANVAS.indexOf('function integratedRealtimeMeta'),
  );
  assert.equal((renderer.match(/adoptIntoCanvasTab\(/g) || []).length, 2,
    '재사용 root 경로와 새 마운트 경로 둘 다 탭으로 가야 한다');
  assert.match(CANVAS, /const canvasTabs = window\.AthenaLib\.CanvasTabs;/);
  const adopt = CANVAS.slice(CANVAS.indexOf('function adoptIntoCanvasTab'), CANVAS.indexOf('// ---------- 캔버스 카드 추가'));
  assert.match(adopt, /integratedCardSurface\.instanceKeyFor\(envelope\)/);
  assert.match(adopt, /canvasTabs\.tabTitleFor\(envelope/);
});

test('덱은 늦게 만들고 마지막 탭이 닫히면 지운다 — 빈 캔버스 상태가 살아 있어야 한다', () => {
  const helper = CANVAS.slice(CANVAS.indexOf('function discardCanvasTabDeck'), CANVAS.indexOf('function adoptIntoCanvasTab'));
  assert.match(helper, /if \(!canvasTabDeck \|\| canvasTabDeck\.keys\(\)\.length\) return;/);
  assert.match(helper, /canvasTabDeck\.element\.remove\(\)/);
  assert.match(helper, /grid\.prepend\(canvasTabDeck\.element\)/);
  // #gridEmpty 판정은 #grid 자식 수 하나뿐이다 — 빈 덱을 남기면 빈 화면이 안 돌아온다.
  assert.match(CANVAS, /gridEmptyEl\.hidden = grid\.children\.length > 0;/);
  const clear = CANVAS.slice(CANVAS.indexOf('function clearCanvases'), CANVAS.indexOf('window.AthenaShell.registerCanvasClear'));
  assert.match(clear, /for \(const key of canvasTabDeck\.keys\(\)\) canvasTabDeck\.close\(key\);/);
  assert.match(clear, /discardCanvasTabDeck\(\)/);
});

test('탭 카드는 모자이크 높이 예산 밖이고, 카드 닫기는 탭 닫기로 간다', () => {
  const budget = CANVAS.slice(CANVAS.indexOf('function enforceHeightBudget'), CANVAS.indexOf('function cardStkCd'));
  assert.match(budget, /let cards = mosaicCards\(\);/);
  assert.match(budget, /cards = mosaicCards\(\);/);
  assert.match(CANVAS, /\.filter\(\(card\) => !card\.closest\('\.canvas-tab-deck'\)\)/);
  const close = CANVAS.slice(CANVAS.indexOf('function closeCard'), CANVAS.indexOf('function cardCloseButton'));
  assert.match(close, /canvasTabDeck\.has\(tabKey\)/);
  assert.match(close, /canvasTabDeck\.close\(tabKey\)/);
});

test('surface_contract가 있으면 보드 마운트로, 없으면 기존 경로로 간다', () => {
  const primary = CANVAS.slice(
    CANVAS.indexOf('function renderPrimaryEnvelope'),
    CANVAS.indexOf('function surfaceContractOf'),
  );
  // D1의 예외 — 앱 렌더러(AITS 차트·호가 래더·주문 초안)가 primary인 recipe는 보드가
  // 가로채지 않는다. 판정은 paper-card-routing.preservesAppPrimary가 든다(2026-09-04).
  assert.match(primary, /const boardCard = paperCardRouting\.preservesAppPrimary\(envelope, boardPrimaryRendererOf\(envelope\)\)\n\s*\? null : renderBoardSurfaceCard\(envelope\);\n\s*if \(boardCard\) return boardCard;/);
  assert.match(primary, /canvas_type === 'table' && !envelope\.fell_back\) return renderMcpTable/);
  const board = CANVAS.slice(CANVAS.indexOf('function renderBoardSurfaceCard'), CANVAS.indexOf('async function renderTaskCanvasEnvelope'));
  assert.match(board, /if \(!contract \|\| !boardMount\) return null;/);
  // 보드를 못 세우면 범용 카드로 조용히 떨어뜨리지 않는다.
  assert.match(board, /body\.replaceChildren\(errorNote\(/);
  assert.doesNotMatch(board, /renderFreeCanvas|renderMcpTable/);
  // 마운트 계약은 색인이 갖는다 — 봉투의 surface_contract를 계약으로 넘기면
  // slots가 없어 아무것도 안 그린다.
  const mount = CANVAS.slice(CANVAS.indexOf('function stateLinksOf'), CANVAS.indexOf('function renderBoardSurfaceCard'));
  assert.doesNotMatch(mount, /^\s*contract,\s*$/m, 'surface_contract를 마운트 계약으로 넘기면 slots가 없다');
  assert.doesNotMatch(mount, /contract:\s/);
  // 원문 HTML은 카드 청크에 있다 — 첫 마운트는 청크 로드를 기다린다.
  assert.match(mount, /boardMount\.mountBoardAsync\(host, state\.boardId, state\.values/);
  assert.doesNotMatch(mount, /boardMount\.mountBoard\(/);
});

test('상태 보드 전환은 계약이 준 링크 안에서만 일어나고 값 표를 이어 쓴다', () => {
  const mount = CANVAS.slice(CANVAS.indexOf('function stateLinksOf'), CANVAS.indexOf('function renderBoardSurfaceCard'));
  // state_links·state_boards 어느 이름으로 와도 같은 목록으로 읽는다.
  assert.match(mount, /contract\.state_links \|\| contract\.state_boards/);
  // 링크에 없는 보드로는 못 간다 — 없는 화면을 지어내지 않는다.
  assert.match(mount, /if \(!state\.links\.some\(\(link\) => link\.board_id === target\)\) return null;/);
  // ▸ 펼침·스트립 칩·탭이 모두 같은 전환 함수로 들어간다.
  assert.match(mount, /onExpand: \(boardId\) => switchStateBoard\(host, boardId, envelope\)/);
  assert.match(mount, /boardMount\.wireStateControlActivation\([\s\S]*?switchStateBoard\(host, link\.board_id, envelope\)/);
  assert.match(mount, /keyboard: isResponsiveStateControl\(node\)/);
  // 값 표는 카드가 사는 동안 이어진다(상태 보드로 갈아타도 같은 값을 다시 쓴다).
  assert.match(mount, /function mountBoardState\(host, boardId, envelope\) \{[\s\S]*?state\.values/);
  assert.doesNotMatch(
    CANVAS.slice(CANVAS.indexOf('function switchStateBoard'), CANVAS.indexOf('function findStateControl')),
    /state\.values = /, '상태 보드 전환이 값 표를 비우면 안 된다',
  );
});

test('상태 링크는 마운트마다 색인에서 다시 계산한다', () => {
  const mount = CANVAS.slice(CANVAS.indexOf('function mountBoardState'), CANVAS.indexOf('function switchStateBoard'));
  // 정본은 색인이다 — 봉투는 마운트한 보드의 직계 자식만 나른다(전환하면 부모 레일이 죽는다).
  assert.match(mount, /boardTemplateRegistry\.stateLinksFor\(state\.boardId\)/);
  // 색인이 모르는 보드(픽스처 계약)는 봉투가 실어온 목록을 그대로 쓴다.
  assert.match(mount, /if \(links\.length\) state\.links = links;/);
});

test('계약이 갈아탈 탭을 지정하면 기본 보드를 세운 뒤 그리로 간다', () => {
  const open = CANVAS.slice(CANVAS.indexOf('function openBoardSurface'), CANVAS.indexOf('function realtimeBindingsOf'));
  // 기본 보드가 먼저다 — 형제 탭 레일이 거기서 나온다.
  assert.match(open, /mountBoardState\(host, contract\.board_id, envelope\)\.then\(/);
  assert.match(open, /const initial = String\(contract\.initial_state_board \|\| ''\);/);
  // 전환은 사람이 탭을 누른 것과 같은 함수로 들어간다(링크에 없으면 아무 일도 없다).
  assert.match(open, /switchStateBoard\(host, initial, envelope\)/);
  // 갈아타다 실패해도 이미 선 기본 보드는 지우지 않는다(사람이 탭을 눌렀을 때와 같다).
  assert.match(open, /switched \? switched\.catch\(\(\) => mounted\) : mounted/);
  // 기준 보드를 갈아치우지 않는다 — 봉투가 준 board_id로 마운트한다.
  assert.doesNotMatch(open, /mountBoardState\(host, initial/);

  const board = CANVAS.slice(CANVAS.indexOf('function renderBoardSurfaceCard'), CANVAS.indexOf('async function renderTaskCanvasEnvelope'));
  // 마운트 전 높이 0이면 페인트 확인이 카드가 안 선 것으로 읽는다 — 인라인으로만 준다.
  assert.match(board, /host\.style\.minHeight = '120px';/);
  assert.match(board, /host\.style\.minHeight = '';/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'board-surface.css'), 'utf8');
  const hostRule = css.slice(css.indexOf('.board-surface-host {'), css.indexOf('}', css.indexOf('.board-surface-host {')));
  assert.doesNotMatch(hostRule, /min-height/, '전역 CSS에 두면 마운트를 끝낸 보드까지 건드린다');
});

test('상태 보드 키보드 의미는 flow/scroll/scroll-table 안의 plain leaf에만 보강한다', () => {
  const controls = CANVAS.slice(
    CANVAS.indexOf('function findStateControl'),
    CANVAS.indexOf('async function hydrateBoardSlots'),
  );
  assert.match(controls,
    /RESPONSIVE_STATE_CONTROL_OWNER = '\.bs-r-flow, \.bs-r-scroll, \.bs-r-scroll-table'/);
  assert.match(controls, /function isResponsiveStateControl\(node\)/);
  assert.match(controls, /node\.childElementCount === 0/);
  assert.match(controls, /node\.closest\(RESPONSIVE_STATE_CONTROL_OWNER\)/);
  assert.match(controls, /boardMount\.stateControlActivationOwner\(node\)/);
  assert.doesNotMatch(controls, /bs-r-paired-table/,
    'paired display mirrors never become interactive controls');
});

test('미결 슬롯이 있으면 하이드레이션을 부르고, 못 받으면 결측어를 그대로 둔다', () => {
  const hydrate = CANVAS.slice(
    CANVAS.indexOf('async function hydrateBoardSlots'),
    CANVAS.indexOf('function renderBoardSurfaceCard'),
  );
  assert.match(hydrate, /window\.athena\.invoke\('athena:canvas-board-hydrate', \{/);
  assert.match(hydrate, /boardId: state\.boardId/);
  assert.match(hydrate, /target: boardHydrateTarget\(envelope\)/);
  assert.match(hydrate, /account: boardHydrateAccount\(envelope\)/);
  // 미결 슬롯이 없으면 아예 부르지 않는다.
  assert.match(hydrate, /if \(!pending\.length \|\| !window\.athena \|\| typeof window\.athena\.invoke !== 'function'\) return mounted;/);
  // 응답이 없거나 비면 그대로 둔다 — 값을 지어내지 않는다.
  assert.match(hydrate, /if \(!filled \|\| !Object\.keys\(filled\)\.length\) return mounted;/);
  // 받은 값은 값 표에 병합하고 그 슬롯만 미결에서 뺀다.
  assert.match(hydrate, /state\.values = \{ \.\.\.state\.values, \.\.\.filled \};/);
  assert.match(hydrate, /state\.unbound = state\.unbound\.filter\(/);
  // 렌더러는 백엔드에 직접 붙지 않는다(main 경유 IPC만).
  assert.doesNotMatch(hydrate, /fetch\(/);

  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  assert.match(preload, /'athena:canvas-board-hydrate',/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /ipcMain\.handle\('athena:canvas-board-hydrate'/);
  assert.match(main, /boardHydrate\.hydrateBoard\(\{/);
});

test('덱 엘리먼트가 밖에서 떨어져 나갔으면 탭을 닫고 덱을 새로 만든다', () => {
  // grid.replaceChildren 류로 덱이 DOM에서 떨어졌는데 캐시만 살아 있으면 다음 카드가
  // 떨어진 패널 속으로 사라진다(2026-09-04 실측 — verify-semantic-workspaces 두 번째
  // recipe의 호가 카드가 통째로 증발). 남은 탭은 정식 close 경로로 닫아 리스를 풀고,
  // 덱은 새로 만든다.
  const helper = CANVAS.slice(CANVAS.indexOf('function ensureCanvasTabDeck'), CANVAS.indexOf('function adoptIntoCanvasTab'));
  assert.match(helper, /if \(canvasTabDeck && !canvasTabDeck\.element\.isConnected\) \{/);
  assert.match(helper, /for \(const key of canvasTabDeck\.keys\(\)\) canvasTabDeck\.close\(key\);\n\s*canvasTabDeck = null;/);
  // 복구 분기 뒤에야 캐시를 돌려준다 — 순서가 바뀌면 복구가 죽은 코드가 된다.
  assert.ok(helper.indexOf('isConnected') < helper.indexOf('if (canvasTabDeck) return canvasTabDeck;'));
});

// ---------- 보드 primary: 껍질 먼저, 앱 렌더러는 그 자리에 ----------
//
// 차트 봉투는 이제 자기 Paper 보드(137X-2)로 간다. 보드는 껍질을 먼저 세우고
// 라이브 차트를 primary 자리에 얹는다 — 그 순서가 흐트러지면 첫 피드백 3초
// 계약을 넘기거나(마운트를 기다림) 상태 전환이 컨테이너 충돌로 던진다.

test('보드가 얹는 렌더러 종류는 라우팅이 아는 목록과 같다', () => {
  const { BOARD_MOUNTED_RENDERERS } = require('./paper-card-routing');
  const mounted = CANVAS.match(/const BOARD_CHART_RENDERER = '([^']+)';/);
  assert.ok(mounted, 'canvas.js가 보드에 얹을 렌더러 이름을 상수로 갖고 있지 않다');
  // 라우팅이 보드로 보내는 종류와 canvas가 실제로 마운트하는 종류가 어긋나면
  // 그 봉투는 보드로 갔는데 자리는 목업인 채로 남는다.
  assert.deepEqual(Array.from(BOARD_MOUNTED_RENDERERS), [mounted[1]]);
});

test('보드 껍질을 먼저 세우고 앱 렌더러는 뒤에서 얹는다', () => {
  const mount = CANVAS.slice(CANVAS.indexOf('function mountBoardState'), CANVAS.indexOf('function switchStateBoard'));
  // await하면 AITS 라이브러리 로드가 3초 계약을 넘긴다 — 던져 놓고 하이드레이션으로 간다.
  assert.match(mount, /void mountBoardPrimary\(host, envelope, mounted\);/);
  assert.doesNotMatch(mount, /await mountBoardPrimary|return mountBoardPrimary/);
  assert.ok(mount.indexOf('wireStateControls') < mount.indexOf('mountBoardPrimary'));
  assert.ok(mount.indexOf('mountBoardPrimary') < mount.indexOf('hydrateBoardSlots'));
});

test('상태 보드를 갈아타기 전에 열린 primary 패널을 먼저 닫는다', () => {
  const swap = CANVAS.slice(CANVAS.indexOf('function switchStateBoard'), CANVAS.indexOf('function findStateControl'));
  // 표면을 갈면 컨테이너가 바뀐다 — 같은 panelId를 다른 컨테이너로 열면 adapter가 던진다.
  assert.match(swap, /destroyBoardPrimary\(state\);\n\s*return mountBoardState\(host, target, envelope\);/);
});

test('봉투가 차트를 안 실었거나 봉이 없으면 목업을 걷지 않는다', () => {
  const describe = CANVAS.slice(
    CANVAS.indexOf('function boardChartDescriptor'),
    CANVAS.indexOf('function beginBoardChartMount'),
  );
  // 봉을 지어내지 않는다 — 실을 것이 없으면 Paper 목업이 그대로 남는다.
  assert.match(describe, /if \(!data \|\| !data\.chart\) return null;/);
  assert.match(describe, /return descriptor\.body\.candles\.length \? descriptor : null;/);
});

test('보드 primary는 목업을 접고 얹으며, 실패하면 목업을 되돌린다', () => {
  const primary = CANVAS.slice(
    CANVAS.indexOf('async function mountBoardPrimary'),
    CANVAS.indexOf('// 봉투가 못 채운 슬롯을 마운트 뒤에 한 번 더 채운다.'),
  );
  // 저작된 렌더러 자리에만 손댄다.
  assert.match(primary, /primary\.renderer !== BOARD_CHART_RENDERER \|\| !primary\.mountPoint\) return null;/);
  // 껍질이 확정한 신원을 그대로 쓴다 — 다시 만들면 paint ack와 어긋난다.
  assert.match(primary, /let descriptor = state\.primaryDescriptor;/);
  // 목업은 지우지 않고 접는다(D1) — 실패하면 그대로 편다.
  assert.match(primary, /boardMount\.collapsePrimaryMockup\(primary\.mountPoint\)/);
  assert.match(primary, /boardMount\.restorePrimaryMockup\(collapsed\)/);
  assert.doesNotMatch(primary, /mountPoint\.replaceChildren|mountPoint\.innerHTML/);
  // 마운트 표식 — 검증 스크립트와 CSS가 이걸 본다.
  assert.match(primary, /primary\.mountPoint\.dataset\.bsPrimaryMounted = BOARD_CHART_RENDERER;/);
  // 실패를 감추지 않되, 사용자에게 보이는 문구에는 내부 용어를 싣지 않는다
  // (어댑터 원문은 검수용 표식에만 남는다 — 제품 문구 3원칙).
  assert.match(primary, /prepend\(errorNote\('차트를 그리지 못했다'\)\)/);
  assert.doesNotMatch(primary, /errorNote\(`/);
  assert.match(primary, /dataset\.bsPrimaryError = String\(\(error && error\.message\) \|\| error\)/);
  // 마운트 결과를 첫 ack가 걸어둔 자리에 맺는다 — 안 맺으면 확정 ack가 안 나간다.
  assert.match(primary, /settleBoardChartMount\(state, session\.body\.candles\.length \? 'data' : 'empty'\)/);
  assert.match(primary, /settleBoardChartMount\(state, 'error'\)/);
  // 실시간은 통합 카드 리스가 이미 나른다 — 보드 카드에 0B를 다시 걸지 않는다.
  assert.doesNotMatch(primary, /wireQuoteRealtime/);
  // 저수준 렌더러를 직접 부르지 않는다 — 같은 AITS adapter 문으로만 들어간다.
  assert.match(primary, /mountAitsChartPanel\(card, chartBody, descriptor, \{ registerCardDestroyer: false \}\)/);
  assert.doesNotMatch(primary, /createChartCard/);
  // 같은 panelId가 다른 컨테이너에 살아 있으면 열기 전에 놓아준다 — 안 놓으면 던진다.
  assert.ok(primary.indexOf('releaseBoardChartPanel(descriptor.panelId)') > 0);
  assert.ok(
    primary.indexOf('releaseBoardChartPanel(descriptor.panelId)') < primary.indexOf('mountAitsChartPanel'),
  );
  // 늦게 거부된 마운트가 그 사이 살아난 패널의 신원을 지우지 못하게 한다.
  assert.match(primary, /if \(state\.primaryMount !== attempt\) return null;/);
  assert.ok(
    primary.indexOf('if (state.primaryMount !== attempt) return null;')
    < primary.lastIndexOf('primary.mountPoint.dataset.bsPrimaryError'),
  );
});

test('보드 껍질이 차트 신원을 찍어 paint ack에 넘긴다', () => {
  const begin = CANVAS.slice(
    CANVAS.indexOf('function beginBoardChartMount'),
    CANVAS.indexOf('function settleBoardChartMount'),
  );
  // paint ack는 껍질이 선 시점의 dataset만 읽는다 — 여기서 안 찍으면 마운트도
  // 안 끝난 차트가 'data'로 집계되고 재조회 권위(panel_id·generation)가 안 선다.
  assert.match(begin, /card\.dataset\.renderState = 'loading';/);
  assert.match(begin, /card\.dataset\.chartPanelId = descriptor\.panelId;/);
  assert.match(begin, /card\.dataset\.chartGeneration = String\(descriptor\.generation\);/);
  assert.match(begin, /card\.dataset\.rendererId = descriptor\.rendererId;/);
  // 확정 ack가 기다릴 자리 — canvas.js의 rest paint 핸들러가 이 표에서 꺼낸다.
  assert.match(begin, /chartMountSettlements\.set\(descriptor\.panelId, settled\);/);

  const board = CANVAS.slice(
    CANVAS.indexOf('function renderBoardSurfaceCard'),
    CANVAS.indexOf('async function renderTaskCanvasEnvelope'),
  );
  assert.match(board, /if \(chartDescriptor\) beginBoardChartMount\(card, state, chartDescriptor\);/);
  assert.ok(board.indexOf('beginBoardChartMount') < board.indexOf('openBoardSurface(host, contract, envelope)'));
  // 보드를 못 세우면 차트도 못 선다 — 기다리던 결과를 맺어야 확정 ack가 나간다.
  assert.match(board, /settleBoardChartMount\(state, 'error'\);/);
});

test('같은 panelId가 다른 자리에 살아 있으면 열기 전에 놓아준다', () => {
  const release = CANVAS.slice(
    CANVAS.indexOf('function releaseBoardChartPanel'),
    CANVAS.indexOf('// 껍질(보드 HTML)이 선 뒤에'),
  );
  // 살아 있는 패널만 건드린다.
  assert.match(release, /if \(!aitsChartPanels\.has\(panelId\)\) return false;/);
  // 옛 보드 상태가 죽은 panelId를 붙들고 있으면 그 카드를 닫아도 아무것도 안 닫힌다.
  assert.match(release, /other\.primaryPanelId = '';/);
  // main은 이 통지로 재조회 권위와 실시간 참조를 푼다 — 조용히 닫으면 리스가 샌다.
  assert.match(release, /window\.athena\.send\('athena:chart-panel-destroyed', \{ panelId \}\)/);
});

test('보드 카드를 닫으면 그 자리에 열린 패널도 닫힌다', () => {
  const board = CANVAS.slice(CANVAS.indexOf('function renderBoardSurfaceCard'), CANVAS.indexOf('async function renderTaskCanvasEnvelope'));
  // 정리자가 없으면 카드를 닫아도 패널과 그 리스가 남는다.
  assert.match(board, /cardDestroyers\.set\(card, \(\) => destroyBoardPrimary\(boardStateOf\(host\)\)\);/);
  // 보드 카드는 리스를 통합 카드에서 받는다 — 여기서 0B를 따로 걸지 않는다.
  assert.doesNotMatch(board, /wireQuoteRealtime/);
});
