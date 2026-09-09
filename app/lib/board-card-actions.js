// IIFE 스코프 격리 — paper-card-routing.js와 같은 이유(렌더러 스크립트 스코프 공유).
//
// 카드 표면의 조작 중 **다른 카드를 여는** 것들. 상태 보드 전환(canvas.js
// wireStateControls)과는 다른 갈래다: 상태 보드는 같은 카드 안에서 표면만 갈아타고,
// 여기 있는 조작은 Paper가 목적지를 **다른 card_id**로 그렸기 때문에 카드가 새로 선다
// (호가는 CC-04, 종목 상세는 CC-03).
//
// canvas.js는 shell.html에서만 도는 렌더러라 node --test로 못 잡는다. 그래서 판정
// (어느 문구가 어느 보드를 여는가 · 누른 줄의 종목이 무엇인가 · 봉투 형상)만 이리로
// 떼어내 단위 테스트한다 — paper-card-routing.js와 같은 관행이다.
(function () {
'use strict';

// 목적지 표. control은 Paper 원문 문구 그대로다(추출 HTML의 잎 텍스트와 대조한다).
// `stock`은 어느 종목으로 열 것인가다 — 'card'는 이 카드가 보고 있는 종목,
// 'row'는 누른 줄의 종목(순위·탐색 보드의 행 액션).
//
// `kind`
//   open-card   — 그 종목으로 다른 카드를 연다(Paper가 목적지를 다른 card_id로 그렸다).
//   agent-watch — 에이전트 모드의 「새 알람 · 말로 설명」으로 데려간다. 이 조작의
//                 화면은 카드 보드가 아니라 에이전트 모드 화면으로 이미 그려져 있고
//                 (Paper A-2 09~12 · docs/plans/2026-09-03-code-alarm-concept.md §3),
//                 알람은 AI가 쓴 감시 함수라 대화에서 시작한다. 보드 43 「새 작업은
//                 채팅에서」 원칙대로 **문장을 심고 보내지는 않는다**.
const CARD_ACTIONS = Object.freeze([
  Object.freeze({
    control: '호가 열기',
    kind: 'open-card',
    board_id: '13BC-2',
    card_id: 'CC-04',
    card_kind: 'orderbook',
    stock: 'card',
    title: '실시간 호가·체결',
  }),
  Object.freeze({
    control: '종목 상세 열기',
    kind: 'open-card',
    board_id: '137X-2',
    card_id: 'CC-03',
    card_kind: 'instrument',
    stock: 'row',
    title: '종목 상세',
  }),
  Object.freeze({
    control: '차트 열기',
    kind: 'open-card',
    board_id: '137X-2',
    card_id: 'CC-03',
    card_kind: 'instrument',
    // 레일·풋터 CTA(2U5L-1 s204). 줄 액션이 아니라 이 카드가 보고 있는 종목.
    stock: 'card',
    title: '종목 차트',
  }),
  Object.freeze({
    control: '비교에 추가',
    kind: 'compare-add',
    stock: 'row',
  }),
  Object.freeze({
    control: '주문 확인',
    kind: 'order-preview',
    stock: 'card',
  }),
  Object.freeze({
    control: '정정 확인',
    kind: 'order-preview',
    stock: 'card',
  }),
  Object.freeze({
    control: '취소 확인',
    kind: 'order-preview',
    stock: 'card',
  }),
  Object.freeze({
    control: '알림 설정',
    kind: 'agent-watch',
    stock: 'card',
    view: 'agent',
  }),
  // 15L8-2 Paper 원문. 「알림 설정」과 같은 에이전트 알람 문이되 문구가 다르다.
  Object.freeze({
    control: '알림 받기',
    kind: 'agent-watch',
    stock: 'card',
    view: 'agent',
    seedWithoutStock: true,
  }),
  Object.freeze({
    control: '조건 수정',
    kind: 'agent-watch',
    stock: 'card',
    view: 'agent',
    seed: '감시 조건 고쳐 줘',
    seedWithoutStock: true,
  }),
]);

const STOCK_CODE = /^\d{6}(?:_AL)?$/;

// 행에서 종목명으로 볼 수 있는 잎 — 코드 옆에 붙는 이름 칸이다. 숫자·기호만인 칸
// (순위·등락률·금액)은 이름이 아니다.
const STOCK_NAME = /[가-힣A-Za-z]/;

function controlOf(action) {
  return String((action && action.control) || '');
}

function cardActionFor(control) {
  const wanted = String(control || '').trim();
  if (!wanted) return null;
  return CARD_ACTIONS.find((action) => action.control === wanted) || null;
}

function leafText(el) {
  return String((el && el.textContent) || '').trim();
}

// 표면에서 조작 잎을 찾는다. 문구가 정확히 같은 **잎**만 본다 — 상위 상자는
// 자식 텍스트를 합쳐 들고 있어 같은 문구가 여러 겹으로 잡힌다.
function actionNodes(surface) {
  if (!surface || typeof surface.querySelectorAll !== 'function') return [];
  const found = [];
  for (const el of surface.querySelectorAll('*')) {
    if (el.childElementCount) continue;
    const action = cardActionFor(leafText(el));
    if (action) found.push({ node: el, action });
  }
  return found;
}

// 누른 줄의 종목코드. Paper 추출 원문의 표 행은 class 없는 상자라 행 경계를
// 이름으로 못 찾는다 — 조작 잎에서 위로 올라가며 6자리 코드 잎이 **처음** 나오는
// 조상을 그 줄로 본다. 위로 무한히 올라가면 다른 줄(또는 카드 머리)의 코드를
// 집으므로 표면에서 멈춘다.
function rowStock(node, surface) {
  for (let host = node && node.parentElement; host; host = host.parentElement) {
    const leaves = typeof host.querySelectorAll === 'function'
      ? [...host.querySelectorAll('*')].filter((el) => !el.childElementCount)
      : [];
    const codeLeaf = leaves.find((el) => STOCK_CODE.test(leafText(el)));
    if (codeLeaf) {
      const raw = leafText(codeLeaf);
      const name = leaves
        .map((el) => leafText(el))
        .find((text) => text && text !== raw && STOCK_NAME.test(text) && text.length <= 20);
      return { stkCd: raw.slice(0, 6), stockName: name || '' };
    }
    if (host === surface) break;
  }
  return null;
}

// 조작 하나가 열 카드의 봉투.
//
// operation_ref는 합성값이다(`card-action:<문구>`). 목적지 보드의 실제 op를 싣지
// 않는 이유: 그 ref는 하이드레이션 실패를 **치명**으로 올리는 축이고(canvas.js
// hydrateBoardSlots requiredRef), 앱 렌더러(차트·사다리)를 얹을지 정하는 축이다.
// 이 봉투에는 봉투 데이터(data.chart·호가 조각)가 없으므로 실렌더러는 어차피 못
// 서고, ref를 실었다가 못 서면 카드가 로딩 오류로 닫힌다. 슬롯 값은 보드 id로
// 채워진다 — 상태 보드 전환이 쓰는 그 경로 그대로다.
function cardActionEnvelope(action, options = {}) {
  const stkCd = String(options.stkCd || '').trim();
  if (!action || action.kind !== 'open-card' || !stkCd) return null;
  const stockName = String(options.stockName || '').trim();
  return {
    card_id: action.card_id,
    card_kind: action.card_kind,
    capability: 'quote',
    mode: 'quote',
    section: 'board-surface',
    canvas_type: 'facts',
    fell_back: false,
    operation_ref: `card-action:${action.control}`,
    operation_args: { stk_cd: stkCd },
    card_title: stockName ? `${stockName} ${action.title}` : action.title,
    correlation: {
      dataset_id: 'card-action',
      item_id: `${action.board_id}:${stkCd}`,
      ordinal: 1,
    },
    surface_contract: {
      surface_version: 'card-surface.v1',
      board_id: action.board_id,
      card_id: action.card_id,
      slot_values: {},
      unbound_slots: [],
      state_boards: [],
    },
    realtime_bindings: [],
    operation_refs: [],
  };
}

// 채팅에 심을 씨문장. 짧은 사람 말이어야 하고(2026-09-03 사용자 지적 「문장이 너무
// 길고 기계적이다」) 조건은 사람이 말한다 — 에이전트가 한 번에 하나씩 되묻는 것이
// 그 화면의 계약이다(Paper A-2 09 「질문 2/3」). 이름 뒤 줄표는 조사 판정을 피하는
// 집안 관례다.
function applyOrderPreview(surface) {
  if (!surface || typeof surface.querySelectorAll !== 'function') return false;
  if (surface.dataset == null) surface.dataset = {};
  const n = (Number(surface.dataset.orderPreviewCount) || 0) + 1;
  surface.dataset.orderPreviewCount = String(n);
  surface.dataset.orderPreview = '1';
  const orderText = n === 1
    ? '미리보기입니다. 주문은 접수되지 않았습니다.'
    : `미리보기입니다. 주문은 접수되지 않았습니다. (${n})`;
  const cancelText = n === 1
    ? '미리보기입니다. 취소는 접수되지 않았습니다.'
    : `미리보기입니다. 취소는 접수되지 않았습니다. (${n})`;
  const detail = n === 1
    ? '이 화면은 확인 미리보기입니다. 실제 주문은 내지 않습니다.'
    : `이 화면은 확인 미리보기입니다. 실제 주문은 내지 않습니다. (${n})`;
  const status = n === 1 ? '확인 미리보기' : `확인 미리보기 (${n})`;
  const fromOrder = new Set([
    '아직 주문되지 않았습니다',
    '미리보기입니다. 주문은 접수되지 않았습니다.',
  ]);
  const fromCancel = new Set([
    '아직 취소되지 않았습니다',
    '미리보기입니다. 취소는 접수되지 않았습니다.',
  ]);
  const fromDetail = new Set([
    '아래 주문 확인을 누른 뒤 한 번 더 확인해야 접수됩니다.',
    '이 화면은 확인 미리보기입니다. 실제 주문은 내지 않습니다.',
  ]);
  const fromStatus = new Set(['검토 중', '검토 필요', '확인 미리보기']);
  for (const el of surface.querySelectorAll('*')) {
    if (el.childElementCount) continue;
    const text = leafText(el);
    const stripped = text.replace(/ \(\d+\)$/, '');
    if (fromOrder.has(text) || fromOrder.has(stripped)) el.textContent = orderText;
    else if (fromCancel.has(text) || fromCancel.has(stripped)) el.textContent = cancelText;
    else if (fromDetail.has(text) || fromDetail.has(stripped)) el.textContent = detail;
    else if (fromStatus.has(text) || fromStatus.has(stripped)) el.textContent = status;
  }
  return true;
}

function applyCompareAdd(surface, stock) {
  if (!surface) return false;
  const label = String((stock && (stock.stockName || stock.stkCd)) || '').trim() || '종목';
  if (surface.dataset == null) surface.dataset = {};
  const n = (Number(surface.dataset.compareCount) || 0) + 1;
  surface.dataset.compareCount = String(n);
  const prev = surface.dataset.compareAdded || '';
  surface.dataset.compareAdded = prev ? `${prev},${label}` : label;
  const copy = n === 1 ? '비교에 넣음' : `비교에 넣음 · ${n}`;
  if (typeof surface.querySelectorAll !== 'function') return true;
  for (const el of surface.querySelectorAll('*')) {
    if (el.childElementCount) continue;
    const text = leafText(el);
    if (text === '비교에 추가' || text === '비교에 넣음' || text.startsWith('비교에 넣음')) {
      el.textContent = copy;
    }
  }
  return true;
}

function cardActionSeed(action, stock) {
  if (!action || action.kind !== 'agent-watch') return '';
  const name = String((stock && stock.stockName) || '').trim();
  const code = String((stock && stock.stkCd) || '').trim();
  const subject = name || (code ? `${code} 종목` : '');
  const tail = String(action.seed || '감시 알람 만들어 줘').trim();
  if (!subject) return action.seedWithoutStock ? tail : '';
  return `${subject} — ${tail}`;
}

const __exports = {
  CARD_ACTIONS, STOCK_CODE,
  cardActionFor, actionNodes, rowStock, cardActionEnvelope, cardActionSeed, controlOf,
  applyOrderPreview, applyCompareAdd,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BoardCardActions = __exports;
}

})();
