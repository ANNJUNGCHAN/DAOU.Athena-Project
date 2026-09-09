'use strict';

const GOLD_PRODUCTS = Object.freeze({
  oneKg: Object.freeze({
    code: 'M04020000',
    name: '금 99.99_1kg',
    unit: 'g',
  }),
  mini: Object.freeze({
    code: 'M04020100',
    name: '미니금 99.99_100g',
    unit: 'g',
  }),
});

const MARKET_UNSUPPORTED_REASON = (
  '금현물 주문 API에서 시장가 매매구분 코드가 확인되지 않아 실행할 수 없습니다.'
);
const REGULAR_PRICE_REQUIRED_REASON = (
  '금현물 보통 주문은 단가가 필요합니다. 단가 입력 실행 경로가 준비되지 않아 실행할 수 없습니다.'
);
const ORDER_TYPE_REQUIRED_REASON = (
  '금현물 주문 유형과 단가가 확인되지 않아 실행할 수 없습니다.'
);

function normalized(value) {
  return String(value == null ? '' : value).normalize('NFKC').toLocaleLowerCase('ko-KR').trim();
}

function sideFrom(text) {
  if (/(?:매수|사\s*줘|구매)/u.test(text)) return 'buy';
  if (/(?:매도|팔아\s*줘|판매)/u.test(text)) return 'sell';
  return null;
}

function orderTypeFrom(text) {
  if (/시장가/u.test(text)) return 'market';
  if (/보통\s*(?:주문|매수|매도)/u.test(text)
      || /^(?:단가|주문\s*유형|매매\s*구분)?\s*보통(?:\s*(?:로|으로)?\s*(?:선택|변경)?(?:해\s*줘)?)?[.!?]?$/u.test(text)) {
    return 'regular';
  }
  return null;
}

function productFrom(text) {
  const compact = text.replace(/[\s_.-]+/g, '');
  if (/m04020100/u.test(compact) || /미니금/u.test(compact)) {
    return GOLD_PRODUCTS.mini;
  }
  if (/m04020000/u.test(compact)
      || ((/금(?:99\.99|9999)/u.test(compact) || /금현물/u.test(compact)) && /1kg/u.test(compact))
      || /^1kg$/u.test(compact)) {
    return GOLD_PRODUCTS.oneKg;
  }
  return null;
}

function quantityFrom(text) {
  const match = text.match(/(?:^|\s)(\d{1,9})\s*(?:개|주)(?:로|으로)?(?:\s|$|[.!?])/u);
  let raw = match && match[1];
  if (!raw) {
    const gramMatches = [...text.matchAll(/(?:^|\s)(\d{1,9})\s*g(?:로|으로)?(?:\s|$|[.!?])/gu)];
    const gramMatch = gramMatches[gramMatches.length - 1];
    raw = gramMatch && gramMatch[1];
    if (raw === '100' && /미니\s*금/u.test(text) && gramMatches.length === 1) raw = null;
  }
  if (!raw) return null;
  const quantity = Number(raw);
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 100000
    ? quantity : null;
}

function isGoldOrderStart(text) {
  const hasGold = /(?:금\s*현물|금\s*99\.99|미니금|m04020[01]00)/u.test(text);
  const completeTicketRequest = isTicketRequest(text) && productFrom(text) && quantityFrom(text);
  return hasGold && sideFrom(text) != null && (orderTypeFrom(text) != null || completeTicketRequest);
}

function isTicketRequest(text) {
  return /(?:주문\s*)?(?:화면|팝업|창|티켓)(?:이|가|을|를)?\s*(?:다시\s*)?(?:열어|보여)(?:\s*줘)?/u.test(text);
}

function isCancellation(text) {
  return /^(?:이\s*)?(?:금\s*현물\s*)?(?:주문\s*)?(?:취소|그만|중단)(?:해\s*줘|할게)?[.!?]?$/u.test(text);
}

function isReopen(text) {
  return /^(?:(?:금\s*현물\s*)?주문\s*(?:화면|팝업|창|티켓)|티켓)(?:이|가|을|를)?\s*(?:(?:다시\s*)?(?:열어|보여)(?:\s*줘)?|안\s*(?:보여|보인다|열려|열린다|떠|뜬다)(?:요)?)[.!?]?$/u.test(text);
}

function isProductSelection(text) {
  return /^(?:(?:상품은?|종목은?)\s*)?(?:(?:금\s*)?(?:99[.]?99\s*)?1\s*kg|미니\s*금(?:\s*99[.]?99)?(?:\s*100\s*g)?|m04020[01]00)(?:\s*(?:상품)?(?:으로|로)?\s*(?:선택|변경)?(?:해\s*줘)?)?[.!?]?$/u.test(text);
}

function isQuantitySelection(text) {
  return /^(?:수량(?:은|을)?\s*)?\d{1,9}\s*(?:g|개|주)(?:\s*(?:로|으로)?\s*(?:선택|변경)?(?:해\s*줘)?)?[.!?]?$/u.test(text);
}

function isOrderTypeCorrection(text) {
  return /^(?:단가|주문\s*유형|매매\s*구분)?\s*(?:시장가|보통)(?:\s*(?:로|으로)?\s*(?:선택|변경)?(?:해\s*줘)?)?[.!?]?$/u.test(text);
}

function isSideCorrection(text) {
  return /^(?:방향(?:은|을)?\s*)?(?:매수|매도|구매|판매)(?:\s*(?:로|으로)?\s*(?:선택|변경)?(?:해\s*줘)?)?[.!?]?$/u.test(text);
}

function productForCode(code) {
  return Object.values(GOLD_PRODUCTS).find((product) => product.code === code) || null;
}

function missingFields(state) {
  const missing = [];
  if (!state.productCode) missing.push('product');
  if (!state.quantity) missing.push('quantity');
  return missing;
}

function collectionPrompt(missing) {
  if (missing.includes('product')) {
    return '금 상품을 골라 주세요: 금 99.99_1kg 또는 미니금 99.99_100g.';
  }
  return '주문 수량을 g 단위로 알려 주세요.';
}

function guardedDraft(state) {
  const buy = state.side === 'buy';
  const product = productForCode(state.productCode);
  const executionBlocker = state.orderType === 'market' ? MARKET_UNSUPPORTED_REASON
    : state.orderType === 'regular' ? REGULAR_PRICE_REQUIRED_REASON
    : ORDER_TYPE_REQUIRED_REASON;
  return {
    status: 'guarded',
    guarded: true,
    operation_ref: buy ? 'base:kt50000' : 'base:kt50001',
    card_title: buy ? '금현물 매수주문' : '금현물 매도주문',
    next_actions: ['open_order_ticket'],
    order_draft: {
      asset_kind: 'gold',
      stk_cd: product ? product.code : null,
      product_name: product ? product.name : null,
      side: state.side,
      ord_qty: state.quantity == null ? null : String(state.quantity),
      unit: 'g',
      requested_order_type: state.orderType,
      execution_supported: false,
      execution_blocker: executionBlocker,
    },
  };
}

function resolveGoldOrderTurn(utterance, previousState = null) {
  const text = normalized(utterance);
  if (!text) return { handled: false, reason: 'missing_input' };
  const start = isGoldOrderStart(text);
  if (!start && !previousState) return { handled: false, reason: 'not_gold_order' };

  if (!start && isCancellation(text)) {
    return {
      handled: true,
      status: 'cancelled',
      missing: [],
      state: null,
      payload: null,
      answerText: '금현물 주문 초안을 취소했습니다.',
    };
  }

  const continuation = start || isProductSelection(text) || isQuantitySelection(text)
    || isSideCorrection(text) || isOrderTypeCorrection(text) || isReopen(text);
  if (!continuation) {
    return { handled: false, reason: 'unrelated_to_pending_order', state: null, clear: true };
  }

  const state = start
    ? { side: sideFrom(text), orderType: orderTypeFrom(text) || 'unspecified', productCode: null, quantity: null }
    : {
      side: previousState.side,
      orderType: previousState.orderType,
      productCode: previousState.productCode || null,
      quantity: previousState.quantity || null,
    };
  const product = productFrom(text);
  state.side = sideFrom(text) || state.side;
  state.orderType = orderTypeFrom(text) || state.orderType;
  state.productCode = product ? product.code : state.productCode;
  state.quantity = quantityFrom(text) || state.quantity;

  const missing = missingFields(state);
  return {
    handled: true,
    status: missing.length ? 'collecting' : 'ready',
    missing,
    state,
    payload: missing.length ? null : guardedDraft(state),
    answerText: missing.length
      ? collectionPrompt(missing)
      : '금현물 주문 내용을 티켓에 채웠습니다. 주문 유형과 실행 제한 사유를 확인해 주세요.',
  };
}

function createGoldOrderIntentTracker() {
  const pending = new Map();
  function advance(conversationId, utterance) {
    const key = String(conversationId || '').trim();
    if (!key) return { handled: false, reason: 'missing_input' };
    const result = resolveGoldOrderTurn(utterance, pending.get(key) || null);
    if (!result.handled) {
      if (result.clear) pending.delete(key);
      return result;
    }
    if (result.state) pending.set(key, result.state);
    else pending.delete(key);
    return { ...result, prompt: result.answerText, draft: result.status === 'ready' ? result.payload : undefined };
  }

  function clear(conversationId) {
    pending.delete(String(conversationId || '').trim());
  }

  function peek(conversationId) {
    return pending.get(String(conversationId || '').trim()) || null;
  }

  return Object.freeze({ advance, clear, peek });
}

module.exports = {
  GOLD_PRODUCTS,
  MARKET_UNSUPPORTED_REASON,
  REGULAR_PRICE_REQUIRED_REASON,
  ORDER_TYPE_REQUIRED_REASON,
  resolveGoldOrderTurn,
  createGoldOrderIntentTracker,
};
