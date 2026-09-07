// 카드 v3 "주문" 카드종 렌더러.
// 실행 전 주문은 기존 guarded action 카드가 담당한다. 이 렌더러는 주문체결 WebSocket과
// 주문 결과 봉투를 체결 상태·주문번호·수량 중심의 읽기 전용 receipt로 표시한다.
(function () {
'use strict';

const CardPrimitives = typeof module !== 'undefined' && module.exports
  ? require('./card-primitives')
  : window.AthenaLib.CardPrimitives;
const FactsCard = typeof module !== 'undefined' && module.exports
  ? require('./facts-card')
  : window.AthenaLib.FactsCard;
const { TwoLineRow, StatusPill } = CardPrimitives;
const { formatNumeric } = FactsCard;

const META_KEYS = new Set(['result_code', 'result_message', 'return_code', 'return_msg']);

function fieldsToRecord(fields) {
  const values = {};
  const labels = {};
  for (const field of Array.isArray(fields) ? fields : []) {
    if (!field || typeof field.key !== 'string') continue;
    values[field.key] = field.value;
    labels[field.key] = field.label || field.key;
  }
  return { values, labels };
}

function formatOrderTime(raw) {
  const text = String(raw === null || raw === undefined ? '' : raw).trim();
  if (/^\d{6}$/.test(text)) return `${text.slice(0, 2)}:${text.slice(2, 4)}:${text.slice(4, 6)}`;
  if (/^\d{4}$/.test(text)) return `${text.slice(0, 2)}:${text.slice(2, 4)}`;
  return text || null;
}

function firstValue(record, keys) {
  for (const key of keys) {
    const value = record && record[key];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function buildOrderReceipt(record) {
  if (!record || typeof record !== 'object') return null;
  const keys = ['ord_no', 'order_no', 'ord_stt', 'status', 'stk_nm', 'stk_cd', 'ord_qty', 'cntr_qty', 'ord_pric'];
  if (!keys.some((key) => record[key] !== null && record[key] !== undefined && record[key] !== '')) return null;
  const rawPrice = firstValue(record, ['ord_pric', 'order_price', 'price']);
  const priceNumber = Number(rawPrice);
  return {
    orderNo: firstValue(record, ['ord_no', 'order_no']),
    status: firstValue(record, ['ord_stt', 'status', 'cntr_stt']),
    name: firstValue(record, ['stk_nm', 'stock_name']),
    code: firstValue(record, ['stk_cd', 'stock_code']),
    side: firstValue(record, ['io_tp_nm', 'side', 'trde_tp_nm']),
    quantity: firstValue(record, ['ord_qty', 'order_qty', 'qty']),
    price: Number.isFinite(priceNumber) && priceNumber > 0 ? rawPrice : null,
    filledQuantity: firstValue(record, ['cntr_qty', 'filled_qty']),
    time: formatOrderTime(firstValue(record, ['tm', 'ord_tm', 'time'])),
  };
}

function classifyOrderReceiptStatus(raw) {
  const text = String(raw === null || raw === undefined ? '' : raw);
  if (text === 'needs_confirm' || text.includes('확인 요청')) return 'info';
  if (text === 'in_doubt' || text.includes('확인 필요')) return 'warn';
  if (text === 'failed' || ['실패', '거부', '취소'].some((label) => text.includes(label))) return 'up';
  if (['미체결', '대기', '접수'].some((label) => text.includes(label))) return 'warn';
  if (text === 'done' || text.includes('완료') || text.includes('체결')) return 'ok';
  return 'flat';
}

function selectOrderFacts(fields) {
  return (Array.isArray(fields) ? fields : [])
    .filter((field) => field && !META_KEYS.has(field.key)
      && field.value !== null && field.value !== undefined && field.value !== '')
    .slice(0, 6)
    .map((field) => ({ label: field.label || field.key, value: field.value }));
}

function renderOrderReceipt(receipt) {
  const wrap = document.createElement('div');
  wrap.className = 'card-kind-order-receipt';

  if (receipt.status) {
    const state = document.createElement('div');
    state.className = 'card-kind-order-receipt-state';
    state.appendChild(StatusPill({
      status: receipt.status,
      toneTable: { [receipt.status]: classifyOrderReceiptStatus(receipt.status) },
    }));
    wrap.appendChild(state);
  }

  const symbol = [receipt.name, receipt.code].filter(Boolean).join(' · ');
  if (symbol) wrap.appendChild(TwoLineRow({ title: '종목', value: symbol }));
  if (receipt.side || receipt.quantity) {
    const orderText = [receipt.side, receipt.quantity != null ? `${formatNumeric(receipt.quantity)}주` : null]
      .filter(Boolean).join(' · ');
    wrap.appendChild(TwoLineRow({
      title: '주문 내용',
      value: orderText,
      valueSub: receipt.price != null ? `${formatNumeric(receipt.price)}원` : '시장가',
    }));
  }
  if (receipt.filledQuantity != null) {
    wrap.appendChild(TwoLineRow({ title: '체결 수량', value: `${formatNumeric(receipt.filledQuantity)}주` }));
  }
  if (receipt.orderNo || receipt.time) {
    wrap.appendChild(TwoLineRow({ title: '주문 번호', value: receipt.orderNo, valueSub: receipt.time }));
  }
  return wrap;
}

function renderOrderFacts(fields) {
  const facts = selectOrderFacts(fields);
  if (!facts.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'card-kind-order-facts';
  facts.forEach((field) => wrap.appendChild(TwoLineRow({
    title: field.label,
    value: formatNumeric(field.value),
  })));
  return wrap;
}

function resolveOrderData(data) {
  const source = data && typeof data === 'object' ? data : {};
  const table = source.table && typeof source.table === 'object' ? source.table : source;
  return {
    fields: Array.isArray(source.fields) ? source.fields : (Array.isArray(source.header) ? source.header : []),
    rows: Array.isArray(table.rows) ? table.rows : [],
  };
}

function recordFromOrderData(data, resolved) {
  if (resolved.rows.length) return resolved.rows[0];
  const source = data && typeof data === 'object' ? data : {};
  const fromFields = fieldsToRecord(resolved.fields).values;
  const receipt = source.receipt && typeof source.receipt === 'object' ? source.receipt : {};
  const order = source.order && typeof source.order === 'object' ? source.order : {};
  const record = { ...fromFields, ...order, ...receipt };
  if (!firstValue(record, ['ord_stt', 'status', 'cntr_stt'])) {
    record.status = source.state_label || source.lifecycle || null;
  }
  return record;
}

function render주문(envelope) {
  const data = envelope && envelope.data;
  if (!data) return null;
  const resolved = resolveOrderData(data);
  const record = recordFromOrderData(data, resolved);
  const receipt = buildOrderReceipt(record);
  if (receipt) return renderOrderReceipt(receipt);
  return renderOrderFacts(resolved.fields);
}

const __exports = {
  fieldsToRecord,
  formatOrderTime,
  buildOrderReceipt,
  classifyOrderReceiptStatus,
  selectOrderFacts,
  resolveOrderData,
  recordFromOrderData,
  render주문,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib.CardKinds.register('주문', render주문);
}

})();
