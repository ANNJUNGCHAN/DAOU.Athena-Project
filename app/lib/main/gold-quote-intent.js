'use strict';

const PRODUCTS = Object.freeze({
  oneKg: Object.freeze({
    code: 'M04020000',
    routeQuery: '금 상품코드 M04020000의 현재 시세를 알려줘',
  }),
  mini: Object.freeze({
    code: 'M04020100',
    routeQuery: '미니금 상품코드 M04020100의 현재 시세를 알려줘',
  }),
});

const CLARIFICATION = '어느 금현물 시세를 볼까요? 금 99.99_1kg 또는 미니금 99.99_100g 중 하나를 선택해 주세요.';

function normalized(value) {
  return String(value == null ? '' : value).normalize('NFKC').toLocaleLowerCase('ko-KR').trim();
}

function selectedProduct(text) {
  const compact = text.replace(/[\s_.-]+/g, '');
  if (/^(?:미니금(?:9999)?(?:100g)?|100g|m04020100)(?:으로|로)?(?:선택)?(?:해줘)?[.!?]?$/u.test(compact)) {
    return PRODUCTS.mini;
  }
  if (/^(?:(?:금)?(?:9999)?1kg|m04020000)(?:으로|로)?(?:선택)?(?:해줘)?[.!?]?$/u.test(compact)) {
    return PRODUCTS.oneKg;
  }
  return null;
}

function isGenericGoldQuote(text) {
  if (!/(?:금\s*현물|금시세|금\s*시세)/u.test(text)) return false;
  if (!/(?:시세|현재가|가격)/u.test(text)) return false;
  if (/(?:1\s*kg|100\s*g|미니금|m04020[01]00|99[.]?99)/u.test(text)) return false;
  if (/(?:매수|매도|구매|판매|주문)/u.test(text)) return false;
  return /^(?:금\s*현물|금)\s*(?:시세|현재가|가격)(?:를|을)?\s*(?:알려|보여)(?:\s*줘|주세요)?[.!?]?$/u.test(text);
}

function resolveGoldQuoteTurn(utterance, previousState = null) {
  const text = normalized(utterance);
  if (!text) return { handled: false, reason: 'missing_input', state: null };

  if (isGenericGoldQuote(text)) {
    return {
      handled: true,
      status: 'collecting',
      state: { awaitingProduct: true },
      routeQuery: null,
      answerText: CLARIFICATION,
    };
  }

  if (!previousState || previousState.awaitingProduct !== true) {
    return { handled: false, reason: 'not_gold_quote', state: null };
  }

  const product = selectedProduct(text);
  if (product) {
    return {
      handled: false,
      status: 'selected',
      state: null,
      routeQuery: product.routeQuery,
      productCode: product.code,
    };
  }

  return {
    handled: false,
    reason: 'unrelated_to_pending_gold_quote',
    state: null,
    clear: true,
  };
}

module.exports = { CLARIFICATION, PRODUCTS, resolveGoldQuoteTurn };
