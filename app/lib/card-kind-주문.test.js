'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fieldsToRecord,
  buildOrderReceipt,
  classifyOrderReceiptStatus,
  formatOrderTime,
  recordFromOrderData,
  selectOrderFacts,
  resolveOrderData,
} = require('./card-kind-주문');

test('fieldsToRecord: facts 필드를 키·라벨 사전으로 바꾼다', () => {
  const result = fieldsToRecord([
    { key: 'ord_no', label: '주문번호', value: '20260829-01' },
    { key: 'ord_stt', label: '주문상태', value: '체결완료' },
  ]);
  assert.deepEqual(result.values, { ord_no: '20260829-01', ord_stt: '체결완료' });
  assert.deepEqual(result.labels, { ord_no: '주문번호', ord_stt: '주문상태' });
});

test('buildOrderReceipt: 주문체결 데이터를 사용자 확인용 요약으로 만든다', () => {
  assert.deepEqual(buildOrderReceipt({
    ord_no: '20260829-01',
    ord_stt: '체결완료',
    stk_nm: '삼성전자',
    stk_cd: '005930',
    io_tp_nm: '매수',
    ord_qty: '10',
    ord_pric: '0',
    cntr_qty: '10',
    tm: '143218',
  }), {
    orderNo: '20260829-01',
    status: '체결완료',
    name: '삼성전자',
    code: '005930',
    side: '매수',
    quantity: '10',
    price: null,
    filledQuantity: '10',
    time: '14:32:18',
  });
});

test('buildOrderReceipt: 주문 관련 필드가 하나도 없으면 receipt를 만들지 않는다', () => {
  assert.equal(buildOrderReceipt({ cur_prc: '88100' }), null);
});

test('classifyOrderReceiptStatus: 확인 요청·불확실·실패를 갈라 친다', () => {
  assert.equal(classifyOrderReceiptStatus('체결완료'), 'ok');
  assert.equal(classifyOrderReceiptStatus('접수대기'), 'warn');
  assert.equal(classifyOrderReceiptStatus('미체결'), 'warn');
  assert.equal(classifyOrderReceiptStatus('체결대기'), 'warn');
  assert.equal(classifyOrderReceiptStatus('체결거부'), 'up');
  assert.equal(classifyOrderReceiptStatus('실패'), 'up');
  assert.equal(classifyOrderReceiptStatus('확인 요청'), 'info');
  assert.equal(classifyOrderReceiptStatus('확인 필요'), 'warn');
  assert.equal(classifyOrderReceiptStatus('알 수 없음'), 'flat');
});

test('formatOrderTime: 6자리 주문시각은 초까지 보존한다', () => {
  assert.equal(formatOrderTime('093015'), '09:30:15');
  assert.equal(formatOrderTime('0930'), '09:30');
});

test('recordFromOrderData: guarded 주문 영수증의 주문 맥락과 응답을 합친다', () => {
  const data = {
    lifecycle: 'done',
    state_label: '체결 완료',
    order: { stk_cd: '005930', ord_qty: '10', side: '매수' },
    receipt: { ord_no: '0000123', dmst_stex_tp: 'KRX' },
  };
  assert.deepEqual(recordFromOrderData(data, resolveOrderData(data)), {
    stk_cd: '005930',
    ord_qty: '10',
    side: '매수',
    ord_no: '0000123',
    dmst_stex_tp: 'KRX',
    status: '체결 완료',
  });
});

test('selectOrderFacts: receipt 모양이 아닌 주문 이벤트도 비어 있지 않은 필드를 보존한다', () => {
  assert.deepEqual(selectOrderFacts([
    { key: 'result_code', label: '결과코드', value: '0' },
    { key: 'service_name', label: '서비스명', value: '주문체결' },
    { key: 'message', label: '상태', value: '정상 수신' },
  ]), [
    { label: '서비스명', value: '주문체결' },
    { label: '상태', value: '정상 수신' },
  ]);
});

test('resolveOrderData: compound 주문 결과의 header/table도 receipt 입력으로 푼다', () => {
  const data = {
    header: [{ key: 'ord_no', label: '주문번호', value: '1' }],
    table: { rows: [{ ord_no: '2' }] },
  };
  assert.deepEqual(resolveOrderData(data), {
    fields: data.header,
    rows: data.table.rows,
  });
});
