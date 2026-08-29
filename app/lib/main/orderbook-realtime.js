// 키움 REAL 0D(주식호가잔량)를 AITS 통합 호가창이 바로 소비할 수 있는 형태로
// 바꾼다. 값이 없는 FID는 null로 남겨 기존 화면 값을 지우지 않는다.
'use strict';

const REAL_TR_ID = '0D';

const F_TIME = '21';
const F_EXPECTED_EXECUTION_PRICE = '23';
const F_EXPECTED_EXECUTION_QUANTITY = '24';
const F_SELL_PRICE = ['41', '42', '43', '44', '45', '46', '47', '48', '49', '50'];
const F_BUY_PRICE = ['51', '52', '53', '54', '55', '56', '57', '58', '59', '60'];
const F_SELL_QTY = ['61', '62', '63', '64', '65', '66', '67', '68', '69', '70'];
const F_BUY_QTY = ['71', '72', '73', '74', '75', '76', '77', '78', '79', '80'];
const F_SELL_CHANGE = ['81', '82', '83', '84', '85', '86', '87', '88', '89', '90'];
const F_BUY_CHANGE = ['91', '92', '93', '94', '95', '96', '97', '98', '99', '100'];
const F_SELL_TOTAL = '121';
const F_BUY_TOTAL = '125';

function toNumber(value, { absolute = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return null;
  return absolute ? Math.abs(n) : n;
}

function toText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function parseQuoteBookTick(row) {
  if (!row || typeof row !== 'object' || String(row.type) !== REAL_TR_ID) return null;
  const symbol = String(row.item || '').trim();
  if (!symbol) return null;
  const values = row.values && typeof row.values === 'object' ? row.values : {};

  return {
    symbol,
    time: toText(values[F_TIME]),
    expectedExecutionPrice: toNumber(values[F_EXPECTED_EXECUTION_PRICE], { absolute: true }),
    expectedExecutionQuantity: toNumber(values[F_EXPECTED_EXECUTION_QUANTITY], { absolute: true }),
    sellPrices: F_SELL_PRICE.map((fid) => toNumber(values[fid], { absolute: true })),
    buyPrices: F_BUY_PRICE.map((fid) => toNumber(values[fid], { absolute: true })),
    sellQuantities: F_SELL_QTY.map((fid) => toNumber(values[fid], { absolute: true })),
    buyQuantities: F_BUY_QTY.map((fid) => toNumber(values[fid], { absolute: true })),
    sellChanges: F_SELL_CHANGE.map((fid) => toNumber(values[fid])),
    buyChanges: F_BUY_CHANGE.map((fid) => toNumber(values[fid])),
    sellTotal: toNumber(values[F_SELL_TOTAL], { absolute: true }),
    buyTotal: toNumber(values[F_BUY_TOTAL], { absolute: true }),
  };
}

function parseQuoteBookFrame(message) {
  const frame = message && typeof message === 'object' ? message : {};
  if (String(frame.trnm) !== 'REAL' || !Array.isArray(frame.data)) return [];
  const out = [];
  for (const row of frame.data) {
    const tick = parseQuoteBookTick(row);
    if (tick) out.push(tick);
  }
  return out;
}

const api = {
  REAL_TR_ID,
  parseQuoteBookTick,
  parseQuoteBookFrame,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof window !== 'undefined') {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.OrderbookRealtime = api;
}
