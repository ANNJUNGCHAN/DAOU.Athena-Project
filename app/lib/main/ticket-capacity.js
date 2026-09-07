'use strict';

// 주문 티켓 수량 칩용 읽기 — 매수여력(kt00001 주문가능금액)과 보유(kt00018).
// 렌더러는 백엔드에 직접 붙지 않는다. 실주문이 아니라 조회 TR 두 개다.
// 실패·픽스처는 빈 값 — 없는 잔고를 있다고 하지 않는다.

const { readTicketCapacity } = require('../order-ticket');

const CASH_PATH = '/api/v1/tr/account/kt00001/detail/withdrawal_and_order_capacity';
const HOLDINGS_PATH = '/api/v1/tr/account/kt00018/detail/holdings';

async function postDetail(opts, path, body) {
  const backendBase = String(opts.backendBase || '').replace(/\/$/, '');
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!backendBase || typeof fetchImpl !== 'function') return null;
  const headers = { 'Content-Type': 'application/json' };
  const token = String(opts.token || '').trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetchImpl(`${backendBase}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
  if (!response || !response.ok) return null;
  try {
    const payload = typeof response.json === 'function' ? await response.json() : null;
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

async function fetchTicketCapacity(opts) {
  const o = opts || {};
  if (o.fixture) {
    return { ok: false, buyingPower: null, holdings: null };
  }
  const symbol = typeof o.symbol === 'string' ? o.symbol : '';
  const [cash, holdings] = await Promise.all([
    postDetail(o, CASH_PATH, { qry_tp: '3' }),
    postDetail(o, HOLDINGS_PATH, { qry_tp: '2', dmst_stex_tp: 'KRX' }),
  ]);
  const parsed = readTicketCapacity({ cash, holdings, symbol });
  const ok = parsed.buyingPower != null || parsed.holdings != null;
  return { ok, buyingPower: parsed.buyingPower, holdings: parsed.holdings };
}

module.exports = {
  CASH_PATH,
  HOLDINGS_PATH,
  fetchTicketCapacity,
};
