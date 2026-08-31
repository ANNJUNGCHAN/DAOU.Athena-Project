// 카드 v3 — 호가. 28개 operation은 서로 다른 미니 카드가 아니라 한 AITS식
// 호가창을 채우는 데이터 포커스다. REST 응답은 가능한 칸을 먼저 채우고, 0D 틱은
// 같은 DOM의 가격·잔량·막대를 제자리 갱신한다.
(function () {
'use strict';

const LEVEL_COUNT = 10;
const QUIET_MARK_MS = 5000;

const KA10004 = {
  askPrices: ['sel_10th_pre_bid', 'sel_9th_pre_bid', 'sel_8th_pre_bid', 'sel_7th_pre_bid', 'sel_6th_pre_bid', 'sel_5th_pre_bid', 'sel_4th_pre_bid', 'sel_3th_pre_bid', 'sel_2th_pre_bid', 'sel_fpr_bid'],
  askQuantities: ['sel_10th_pre_req', 'sel_9th_pre_req', 'sel_8th_pre_req', 'sel_7th_pre_req', 'sel_6th_pre_req', 'sel_5th_pre_req', 'sel_4th_pre_req', 'sel_3th_pre_req', 'sel_2th_pre_req', 'sel_fpr_req'],
  askChanges: ['sel_10th_pre_req_pre', 'sel_9th_pre_req_pre', 'sel_8th_pre_req_pre', 'sel_7th_pre_req_pre', 'sel_6th_pre_req_pre', 'sel_5th_pre_req_pre', 'sel_4th_pre_req_pre', 'sel_3th_pre_req_pre', 'sel_2th_pre_req_pre', 'sel_1th_pre_req_pre'],
  bidPrices: ['buy_fpr_bid', 'buy_2th_pre_bid', 'buy_3th_pre_bid', 'buy_4th_pre_bid', 'buy_5th_pre_bid', 'buy_6th_pre_bid', 'buy_7th_pre_bid', 'buy_8th_pre_bid', 'buy_9th_pre_bid', 'buy_10th_pre_bid'],
  bidQuantities: ['buy_fpr_req', 'buy_2th_pre_req', 'buy_3th_pre_req', 'buy_4th_pre_req', 'buy_5th_pre_req', 'buy_6th_pre_req', 'buy_7th_pre_req', 'buy_8th_pre_req', 'buy_9th_pre_req', 'buy_10th_pre_req'],
  bidChanges: ['buy_1th_pre_req_pre', 'buy_2th_pre_req_pre', 'buy_3th_pre_req_pre', 'buy_4th_pre_req_pre', 'buy_5th_pre_req_pre', 'buy_6th_pre_req_pre', 'buy_7th_pre_req_pre', 'buy_8th_pre_req_pre', 'buy_9th_pre_req_pre', 'buy_10th_pre_req_pre'],
};

const KA10007 = {
  askPrices: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((level) => `sel_${level}bid`),
  askQuantities: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((level) => `sel_${level}bid_req`),
  askChanges: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((level) => `sel_${level}bid_jub_pre`),
  askCounts: [5, 4, 3, 2, 1].map((level) => `sel_${level}bid_cnt`),
  askLpQuantities: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((level) => `lpsel_${level}bid_req`),
  bidPrices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((level) => `buy_${level}bid`),
  bidQuantities: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((level) => `buy_${level}bid_req`),
  bidChanges: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((level) => `buy_${level}bid_jub_pre`),
  bidCounts: [1, 2, 3, 4, 5].map((level) => `buy_${level}bid_cnt`),
  bidLpQuantities: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((level) => `lpbuy_${level}bid_req`),
};

const KA10087 = {
  askPrices: [5, 4, 3, 2, 1].map((level) => `ovt_sigpric_sel_bid_${level}`),
  askQuantities: [5, 4, 3, 2, 1].map((level) => `ovt_sigpric_sel_bid_qty_${level}`),
  askChanges: [5, 4, 3, 2, 1].map((level) => `ovt_sigpric_sel_bid_jub_pre_${level}`),
  bidPrices: [1, 2, 3, 4, 5].map((level) => `ovt_sigpric_buy_bid_${level}`),
  bidQuantities: [1, 2, 3, 4, 5].map((level) => `ovt_sigpric_buy_bid_qty_${level}`),
  bidChanges: [1, 2, 3, 4, 5].map((level) => `ovt_sigpric_buy_bid_jub_pre_${level}`),
};

function fieldsMap(fields) {
  const map = new Map();
  for (const field of Array.isArray(fields) ? fields : []) {
    if (field && typeof field.key === 'string') map.set(field.key, field);
  }
  return map;
}

function detectTotals(map) {
  if (map.has('tot_sel_req') && map.has('tot_buy_req')) return { sellKey: 'tot_sel_req', buyKey: 'tot_buy_req' };
  if (map.has('ovt_sel_req') && map.has('ovt_buy_req')) return { sellKey: 'ovt_sel_req', buyKey: 'ovt_buy_req' };
  if (map.has('ovt_sigpric_sel_bid_tot_req') && map.has('ovt_sigpric_buy_bid_tot_req')) {
    return { sellKey: 'ovt_sigpric_sel_bid_tot_req', buyKey: 'ovt_sigpric_buy_bid_tot_req' };
  }
  if (map.has('sel_bid_tot_req') && map.has('buy_bid_tot_req')) return { sellKey: 'sel_bid_tot_req', buyKey: 'buy_bid_tot_req' };
  return null;
}

function detectQuoteEmphasis(map) {
  if (map.has('cur_prc') && map.has('flu_rt')) return { priceKey: 'cur_prc', changeKey: 'flu_rt' };
  if (map.has('ovt_sigpric_cur_prc') && map.has('ovt_sigpric_flu_rt')) {
    return { priceKey: 'ovt_sigpric_cur_prc', changeKey: 'ovt_sigpric_flu_rt' };
  }
  return null;
}

function detectLadderShape(map) {
  if (map.has('sel_1bid_req') || map.has('buy_1bid_req')) return { name: 'ka10007_both' };
  if (KA10004.askQuantities.some((key) => map.has(key))) return { name: 'ka10004_sell' };
  if (KA10004.bidQuantities.some((key) => map.has(key))) return { name: 'ka10004_buy' };
  if (KA10087.askQuantities.some((key) => map.has(key))) return { name: 'ka10087_sell' };
  if (KA10087.bidQuantities.some((key) => map.has(key))) return { name: 'ka10087_buy' };
  return null;
}

function toNumber(value, { absolute = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(number)) return null;
  return absolute ? Math.abs(number) : number;
}

function emptyLevels() {
  return Array.from({ length: LEVEL_COUNT }, (_, index) => ({
    level: index + 1,
    price: null,
    quantity: null,
    change: null,
    count: null,
    auxQuantity: null,
  }));
}

function createOrderbookState() {
  return {
    symbol: null,
    name: null,
    asks: emptyLevels(),
    bids: emptyLevels(),
    currentPrice: null,
    currentChange: null,
    currentVolume: null,
    expectedExecutionPrice: null,
    expectedExecutionQuantity: null,
    sellTotal: null,
    buyTotal: null,
    time: null,
    focus: '호가 통합',
    marketMode: 'regular',
    depth: LEVEL_COUNT,
    liveSource: '0D',
  };
}

function valueOf(map, key, options) {
  const field = map.get(key);
  return field ? toNumber(field.value, options) : null;
}

function fillLevels(map, levels, property, keys, levelNumbers, options) {
  keys.forEach((key, index) => {
    if (!map.has(key)) return;
    const level = levelNumbers[index];
    levels[level - 1][property] = valueOf(map, key, options);
  });
}

function inferFocus(map) {
  const keys = [...map.keys()];
  if (keys.some((key) => /^lp(?:sel|buy)_\d+bid_req$/.test(key))) return 'LP 잔량';
  if (keys.some((key) => /_cnt$/.test(key))) return '주문 건수';
  if (keys.some((key) => /tot/.test(key) || /^(?:ovt_sel_req|ovt_buy_req)$/.test(key))) return '총잔량';
  if (keys.some((key) => /req_pre|jub_pre|change/.test(key))) return '잔량 증감';
  if (keys.some((key) => /^exp_cntr_(?:pric|qty)$/.test(key))) return '예상체결';
  if (keys.some((key) => /pre_bid$|^(?:sel|buy)_\d+bid$|(?:sel|buy)_bid_\d+$/.test(key)) && !keys.some((key) => /req|qty/.test(key))) return '가격축';
  if (keys.some((key) => /req|qty/.test(key))) return '잔량';
  if (keys.some((key) => /time|_tm$/.test(key))) return '스냅샷 시각';
  if (keys.some((key) => /^(?:stk_cd|stk_nm|mkt_nm)$/.test(key))) return '종목 식별';
  return '호가 통합';
}

function buildOrderbookState(fields, operationRef = '') {
  const map = fieldsMap(fields);
  const state = createOrderbookState();
  const descending10 = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const ascending10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const descending5 = [5, 4, 3, 2, 1];
  const ascending5 = [1, 2, 3, 4, 5];

  const symbolField = map.get('stk_cd');
  const nameField = map.get('stk_nm');
  state.symbol = symbolField && symbolField.value !== undefined ? String(symbolField.value).trim() : null;
  state.name = nameField && nameField.value !== undefined ? String(nameField.value).trim() : null;

  fillLevels(map, state.asks, 'price', KA10004.askPrices, descending10, { absolute: true });
  fillLevels(map, state.asks, 'quantity', KA10004.askQuantities, descending10, { absolute: true });
  fillLevels(map, state.asks, 'change', KA10004.askChanges, descending10);
  fillLevels(map, state.bids, 'price', KA10004.bidPrices, ascending10, { absolute: true });
  fillLevels(map, state.bids, 'quantity', KA10004.bidQuantities, ascending10, { absolute: true });
  fillLevels(map, state.bids, 'change', KA10004.bidChanges, ascending10);

  fillLevels(map, state.asks, 'price', KA10007.askPrices, descending10, { absolute: true });
  fillLevels(map, state.asks, 'quantity', KA10007.askQuantities, descending10, { absolute: true });
  fillLevels(map, state.asks, 'change', KA10007.askChanges, descending10);
  fillLevels(map, state.asks, 'count', KA10007.askCounts, descending5, { absolute: true });
  fillLevels(map, state.asks, 'auxQuantity', KA10007.askLpQuantities, descending10, { absolute: true });
  fillLevels(map, state.bids, 'price', KA10007.bidPrices, ascending10, { absolute: true });
  fillLevels(map, state.bids, 'quantity', KA10007.bidQuantities, ascending10, { absolute: true });
  fillLevels(map, state.bids, 'change', KA10007.bidChanges, ascending10);
  fillLevels(map, state.bids, 'count', KA10007.bidCounts, ascending5, { absolute: true });
  fillLevels(map, state.bids, 'auxQuantity', KA10007.bidLpQuantities, ascending10, { absolute: true });

  fillLevels(map, state.asks, 'price', KA10087.askPrices, descending5, { absolute: true });
  fillLevels(map, state.asks, 'quantity', KA10087.askQuantities, descending5, { absolute: true });
  fillLevels(map, state.asks, 'change', KA10087.askChanges, descending5);
  fillLevels(map, state.bids, 'price', KA10087.bidPrices, ascending5, { absolute: true });
  fillLevels(map, state.bids, 'quantity', KA10087.bidQuantities, ascending5, { absolute: true });
  fillLevels(map, state.bids, 'change', KA10087.bidChanges, ascending5);

  const totals = detectTotals(map);
  if (totals) {
    state.sellTotal = valueOf(map, totals.sellKey, { absolute: true });
    state.buyTotal = valueOf(map, totals.buyKey, { absolute: true });
  }
  const quote = detectQuoteEmphasis(map);
  if (quote) {
    state.currentPrice = valueOf(map, quote.priceKey, { absolute: true });
    state.currentChange = valueOf(map, quote.changeKey);
  }
  state.expectedExecutionPrice = valueOf(map, 'exp_cntr_pric', { absolute: true });
  state.expectedExecutionQuantity = valueOf(map, 'exp_cntr_qty', { absolute: true });
  const timeField = map.get('bid_req_base_tm');
  state.time = timeField && timeField.value !== undefined ? String(timeField.value).trim() : null;
  const normalizedOperationRef = String(operationRef);
  if (normalizedOperationRef.includes('ka10004:after_hours_totals')) {
    state.marketMode = 'after-hours-summary';
    state.depth = 0;
    state.liveSource = null;
  } else if (normalizedOperationRef.includes('ka10087') || [...map.keys()].some((key) => key.startsWith('ovt_sigpric_'))) {
    state.marketMode = 'after-hours';
    state.depth = 5;
    state.liveSource = null;
  }
  state.focus = inferFocus(map);
  return state;
}

function mergeArray(targetLevels, values, property) {
  if (!Array.isArray(values)) return;
  values.forEach((value, index) => {
    if (index < targetLevels.length && value !== null && value !== undefined) targetLevels[index][property] = value;
  });
}

function mergeTickIntoState(state, tick) {
  const next = state || createOrderbookState();
  if (!tick || typeof tick !== 'object') return next;
  if (next.liveSource !== '0D') return next;
  mergeArray(next.asks, tick.sellPrices, 'price');
  mergeArray(next.bids, tick.buyPrices, 'price');
  mergeArray(next.asks, tick.sellQuantities, 'quantity');
  mergeArray(next.bids, tick.buyQuantities, 'quantity');
  mergeArray(next.asks, tick.sellChanges, 'change');
  mergeArray(next.bids, tick.buyChanges, 'change');
  if (tick.currentPrice !== null && tick.currentPrice !== undefined) next.currentPrice = tick.currentPrice;
  if (tick.currentVolume !== null && tick.currentVolume !== undefined) next.currentVolume = tick.currentVolume;
  if (tick.expectedExecutionPrice !== null && tick.expectedExecutionPrice !== undefined) next.expectedExecutionPrice = tick.expectedExecutionPrice;
  if (tick.expectedExecutionQuantity !== null && tick.expectedExecutionQuantity !== undefined) next.expectedExecutionQuantity = tick.expectedExecutionQuantity;
  if (tick.sellTotal !== null && tick.sellTotal !== undefined) next.sellTotal = tick.sellTotal;
  if (tick.buyTotal !== null && tick.buyTotal !== undefined) next.buyTotal = tick.buyTotal;
  if (tick.time) next.time = tick.time;
  return next;
}

function ensureStylesheet() {
  if (typeof document === 'undefined' || !document.head) return;
  if (document.querySelector('link[data-athena-hoga-live]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './styles/card-kind-hoga.css';
  link.dataset.athenaHogaLive = 'true';
  document.head.appendChild(link);
}

function dom(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatNumber(value) {
  return Number.isFinite(value) ? Math.abs(value).toLocaleString('ko-KR') : '—';
}

function formatSigned(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toLocaleString('ko-KR')}`;
}

function flash(node, previous, next) {
  if (!node || !Number.isFinite(previous) || previous === next) return;
  const className = next > previous ? 'is-live-rise' : 'is-live-fall';
  node.classList.remove('is-live-rise', 'is-live-fall');
  if (node.__athenaFlashFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(node.__athenaFlashFrame);
  const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (callback) => setTimeout(callback, 0);
  node.__athenaFlashFrame = schedule(() => {
    node.__athenaFlashFrame = null;
    node.classList.add(className);
  });
  if (node.__athenaFlashTimer) clearTimeout(node.__athenaFlashTimer);
  node.__athenaFlashTimer = setTimeout(() => node.classList.remove(className), 420);
}

function setNumber(node, value, formatter, animate) {
  if (!node) return;
  const previous = node.__athenaNumericValue;
  node.textContent = formatter(value);
  node.__athenaNumericValue = value;
  if (animate) flash(node, previous, value);
}

function setCountOrLp(node, model, animate) {
  const isCount = Number.isFinite(model.count);
  const value = isCount ? model.count : model.auxQuantity;
  const previous = node && node.__athenaNumericValue;
  if (!node) return;
  node.textContent = Number.isFinite(value) ? `${isCount ? '' : 'LP '}${formatNumber(value)}` : '—';
  node.__athenaNumericValue = value;
  if (animate) flash(node, previous, value);
}

function createLevelRow(side, level) {
  const row = dom('div', `card-kit-hoga-live-row card-kit-hoga-live-row--${side}`);
  row.dataset.side = side;
  row.dataset.level = String(level);
  row.setAttribute('role', 'row');
  row.setAttribute('aria-label', `${side === 'ask' ? '매도' : '매수'} ${level}호가`);
  const count = dom('span', 'card-kit-hoga-live-count', '—');
  count.dataset.role = 'count';
  count.setAttribute('role', 'cell');
  const quantity = dom('span', 'card-kit-hoga-live-quantity', '—');
  quantity.dataset.role = 'quantity';
  quantity.setAttribute('role', 'cell');
  const change = dom('span', 'card-kit-hoga-live-change', '—');
  change.dataset.role = 'change';
  change.setAttribute('role', 'cell');
  const price = dom('span', 'card-kit-hoga-live-price', '—');
  price.dataset.role = 'price';
  price.setAttribute('role', 'cell');
  const barTrack = dom('span', 'card-kit-hoga-live-bar-track');
  barTrack.setAttribute('role', 'cell');
  const bar = dom('span', 'card-kit-hoga-live-bar');
  bar.dataset.role = 'bar';
  barTrack.appendChild(bar);
  row.append(count, quantity, change, price, barTrack);
  return row;
}

function updateLevelRow(wrap, side, level, model, maxQuantity, animate) {
  const cachedRows = wrap.__athenaOrderbookRows && wrap.__athenaOrderbookRows[side];
  const row = cachedRows ? cachedRows[level - 1] : wrap.querySelector(`[data-side="${side}"][data-level="${level}"]`);
  if (!row) return;
  setCountOrLp(row.querySelector('[data-role="count"]'), model, animate);
  setNumber(row.querySelector('[data-role="quantity"]'), model.quantity, formatNumber, animate);
  setNumber(row.querySelector('[data-role="change"]'), model.change, formatSigned, animate);
  setNumber(row.querySelector('[data-role="price"]'), model.price, formatNumber, animate);
  const bar = row.querySelector('[data-role="bar"]');
  const percentage = Number.isFinite(model.quantity) && maxQuantity > 0 ? Math.round((Math.abs(model.quantity) / maxQuantity) * 100) : 0;
  if (bar) {
    bar.style.width = `${percentage}%`;
    if (bar.parentElement) bar.parentElement.setAttribute('aria-label', `상대 잔량 ${percentage}%`);
  }
}

function updateOrderbookDom(wrap, state, animate) {
  const quantities = [...state.asks, ...state.bids].map((level) => Math.abs(level.quantity || 0));
  const maxQuantity = Math.max(0, ...quantities);
  for (let level = 1; level <= LEVEL_COUNT; level += 1) {
    updateLevelRow(wrap, 'ask', level, state.asks[level - 1], maxQuantity, animate);
    updateLevelRow(wrap, 'bid', level, state.bids[level - 1], maxQuantity, animate);
  }
  setNumber(wrap.querySelector('[data-role="current-price"]'), state.currentPrice, formatNumber, animate);
  const expectedExecution = wrap.querySelector('[data-role="expected-execution"]');
  if (expectedExecution) {
    const previous = expectedExecution.__athenaNumericValue;
    if (state.marketMode === 'after-hours') {
      expectedExecution.textContent = 'REST 스냅샷';
    } else if (Number.isFinite(state.expectedExecutionPrice)) {
      const quantity = Number.isFinite(state.expectedExecutionQuantity) ? ` · ${formatNumber(state.expectedExecutionQuantity)}주` : '';
      expectedExecution.textContent = `예상체결 ${formatNumber(state.expectedExecutionPrice)}${quantity}`;
    } else {
      expectedExecution.textContent = '예상체결 수신 대기';
    }
    expectedExecution.__athenaNumericValue = state.expectedExecutionPrice;
    if (animate) flash(expectedExecution, previous, state.expectedExecutionPrice);
  }
  setNumber(wrap.querySelector('[data-role="sell-total"]'), state.sellTotal, formatNumber, animate);
  setNumber(wrap.querySelector('[data-role="buy-total"]'), state.buyTotal, formatNumber, animate);
  const time = wrap.querySelector('[data-role="time"]');
  if (time) time.textContent = state.time || '수신 대기';
  const focus = wrap.querySelector('[data-role="focus"]');
  if (focus) focus.textContent = state.focus;
  const auxHeader = wrap.querySelector('[data-role="aux-header"]');
  if (auxHeader) auxHeader.textContent = state.focus === 'LP 잔량' ? 'LP 잔량' : '건수';
  const total = (state.sellTotal || 0) + (state.buyTotal || 0);
  const split = total > 0 ? Math.round(((state.sellTotal || 0) / total) * 100) : 50;
  const askShare = wrap.querySelector('[data-role="ask-share"]');
  const bidShare = wrap.querySelector('[data-role="bid-share"]');
  if (askShare) askShare.style.width = `${split}%`;
  if (bidShare) bidShare.style.width = `${100 - split}%`;
}

function buildIntegratedOrderbook(envelope, state) {
  const wrap = dom('section', 'card-kit-hoga-live');
  const isAfterHours = state.marketMode !== 'regular';
  const isAfterHoursSummary = state.marketMode === 'after-hours-summary';
  const title = isAfterHoursSummary ? '시간외 호가 잔량' : (isAfterHours ? '시간외 단일가 5단 호가' : '실시간 10단 호가');
  wrap.setAttribute('aria-label', title);
  wrap.__athenaOrderbookState = state;
  wrap.__athenaOrderbookRows = { ask: [], bid: [] };

  const header = dom('header', 'card-kit-hoga-live-header');
  const titleBlock = dom('div', 'card-kit-hoga-live-title-block');
  const identity = [state.name, state.symbol].filter(Boolean).join(' · ');
  titleBlock.append(dom('strong', 'card-kit-hoga-live-title', title), dom('span', 'card-kit-hoga-live-subtitle', identity || (isAfterHours ? '시간외 호가 데이터' : '실시간 호가 데이터')));
  const status = dom('div', 'card-kit-hoga-live-status');
  status.dataset.role = 'status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  status.append(dom('span', 'card-kit-hoga-live-status-dot'), dom('span', '', isAfterHours ? '조회 데이터' : '연결 중'), dom('time', 'card-kit-hoga-live-time', '수신 대기'));
  status.lastChild.dataset.role = 'time';
  header.append(titleBlock, status);

  const toolbar = dom('div', 'card-kit-hoga-live-toolbar');
  toolbar.append(dom('span', 'card-kit-hoga-live-focus', state.focus), dom('span', 'card-kit-hoga-live-depth', state.depth > 0 ? `${state.depth}호가` : '요약'));
  toolbar.firstChild.dataset.role = 'focus';

  const columns = dom('div', 'card-kit-hoga-live-columns');
  columns.append(dom('span', '', '건수'), dom('span', '', '잔량'), dom('span', '', '증감'), dom('span', '', '가격'), dom('span', '', '상대 잔량'));
  columns.firstChild.dataset.role = 'aux-header';
  columns.setAttribute('role', 'row');
  for (const heading of columns.children) heading.setAttribute('role', 'columnheader');

  const asks = dom('div', 'card-kit-hoga-live-levels card-kit-hoga-live-levels--ask');
  asks.setAttribute('role', 'rowgroup');
  asks.setAttribute('aria-live', 'off');
  for (let level = state.depth; level >= 1; level -= 1) {
    const row = createLevelRow('ask', level);
    wrap.__athenaOrderbookRows.ask[level - 1] = row;
    asks.appendChild(row);
  }
  const center = dom('div', 'card-kit-hoga-live-center');
  center.setAttribute('role', 'row');
  center.setAttribute('aria-label', '현재가와 예상체결가');
  center.append(dom('span', 'card-kit-hoga-live-center-label', '현재가'), dom('strong', 'card-kit-hoga-live-current', '—'), dom('span', 'card-kit-hoga-live-center-hint', isAfterHours ? '최근 조회 기준' : '예상체결 수신 대기'));
  for (const cell of center.children) cell.setAttribute('role', 'cell');
  center.children[1].dataset.role = 'current-price';
  center.children[2].dataset.role = 'expected-execution';
  const bids = dom('div', 'card-kit-hoga-live-levels card-kit-hoga-live-levels--bid');
  bids.setAttribute('role', 'rowgroup');
  bids.setAttribute('aria-live', 'off');
  for (let level = 1; level <= state.depth; level += 1) {
    const row = createLevelRow('bid', level);
    wrap.__athenaOrderbookRows.bid[level - 1] = row;
    bids.appendChild(row);
  }

  const table = dom('div', 'card-kit-hoga-live-table');
  table.setAttribute('role', 'table');
  table.setAttribute('aria-label', `${state.depth}단 매도·매수 호가`);
  table.append(columns, asks, center, bids);

  const footer = dom('footer', 'card-kit-hoga-live-footer');
  const totals = dom('div', 'card-kit-hoga-live-totals');
  const sellTotal = dom('span', 'card-kit-hoga-live-total card-kit-hoga-live-total--ask', '—');
  sellTotal.dataset.role = 'sell-total';
  const buyTotal = dom('span', 'card-kit-hoga-live-total card-kit-hoga-live-total--bid', '—');
  buyTotal.dataset.role = 'buy-total';
  totals.append(dom('span', '', '총매도'), sellTotal, dom('span', '', '총매수'), buyTotal);
  const imbalance = dom('div', 'card-kit-hoga-live-imbalance');
  const askShare = dom('span', 'card-kit-hoga-live-imbalance-ask');
  const bidShare = dom('span', 'card-kit-hoga-live-imbalance-bid');
  askShare.dataset.role = 'ask-share';
  bidShare.dataset.role = 'bid-share';
  imbalance.append(askShare, bidShare);
  footer.append(totals, imbalance);

  if (state.depth > 0) wrap.append(header, toolbar, table, footer);
  else wrap.append(header, toolbar, footer);
  updateOrderbookDom(wrap, state, false);
  return wrap;
}

function render호가(envelope) {
  const fields = envelope && envelope.data && Array.isArray(envelope.data.fields) ? envelope.data.fields : null;
  if (!fields || !fields.length || typeof document === 'undefined') return null;
  ensureStylesheet();
  const operationRef = envelope.operation_ref || envelope.operationRef || '';
  return buildIntegratedOrderbook(envelope, buildOrderbookState(fields, operationRef));
}

function applyTickNow(wrap, tick) {
  const state = wrap.__athenaOrderbookState || createOrderbookState();
  if (state.liveSource !== '0D') return;
  mergeTickIntoState(state, tick);
  wrap.__athenaOrderbookState = state;
  const status = wrap.querySelector('[data-role="status"]');
  if (status) {
    status.classList.add('is-live');
    const label = status.children[1];
    if (label) label.textContent = '실시간';
  }
  if (wrap.__athenaOrderbookStaleTimer) clearTimeout(wrap.__athenaOrderbookStaleTimer);
  wrap.__athenaOrderbookStaleTimer = setTimeout(() => {
    const currentStatus = wrap.querySelector('[data-role="status"]');
    if (!currentStatus) return;
    currentStatus.classList.remove('is-live');
    const label = currentStatus.children[1];
    if (label) label.textContent = '5초간 변동 없음';
  }, QUIET_MARK_MS);
  updateOrderbookDom(wrap, state, true);
}

function mergeTicks(previous, next) {
  if (!previous) return next;
  const merged = { ...previous, ...next };
  for (const key of ['currentPrice', 'currentVolume', 'expectedExecutionPrice', 'expectedExecutionQuantity', 'sellTotal', 'buyTotal', 'time']) {
    if (next[key] === null || next[key] === undefined || next[key] === '') merged[key] = previous[key];
  }
  for (const key of ['sellPrices', 'buyPrices', 'sellQuantities', 'buyQuantities', 'sellChanges', 'buyChanges']) {
    if (!Array.isArray(previous[key]) && !Array.isArray(next[key])) continue;
    merged[key] = Array.from({ length: LEVEL_COUNT }, (_, index) => {
      const value = next[key] && next[key][index];
      return value !== null && value !== undefined ? value : previous[key] && previous[key][index];
    });
  }
  return merged;
}

function applyLiveTick(wrap, envelope, tick) {
  if (!wrap || !tick || !wrap.classList.contains('card-kit-hoga-live')) return;
  wrap.__athenaPendingOrderbookTick = mergeTicks(wrap.__athenaPendingOrderbookTick, tick);
  if (typeof requestAnimationFrame !== 'function') {
    const pending = wrap.__athenaPendingOrderbookTick;
    wrap.__athenaPendingOrderbookTick = null;
    applyTickNow(wrap, pending);
    return;
  }
  if (wrap.__athenaOrderbookFrame) return;
  wrap.__athenaOrderbookFrame = requestAnimationFrame(() => {
    wrap.__athenaOrderbookFrame = null;
    const pending = wrap.__athenaPendingOrderbookTick;
    wrap.__athenaPendingOrderbookTick = null;
    if (pending) applyTickNow(wrap, pending);
  });
}

function supportsLive0D(wrap) {
  return Boolean(wrap && wrap.__athenaOrderbookState && wrap.__athenaOrderbookState.liveSource === '0D');
}

const __exports = {
  fieldsMap,
  detectLadderShape,
  detectTotals,
  detectQuoteEmphasis,
  buildOrderbookState,
  mergeTickIntoState,
  mergeTicks,
  supportsLive0D,
  render호가,
  applyLiveTick,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  ensureStylesheet();
  window.AthenaLib.CardKinds.register('호가', render호가);
  window.AthenaLib.CardKindHoga = { applyLiveTick, supportsLive0D };
}

})();
