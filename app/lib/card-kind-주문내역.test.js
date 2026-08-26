'use strict';

// DOM 빌더(render주문내역)는 document가 필요해 node --test 경로에서는 못 돈다 —
// 이 스위트는 순수 함수(classifyOrderStatus/formatOrderTime/buildOrderLine)만 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyOrderStatus, formatOrderTime, buildOrderLine } = require('./card-kind-주문내역');

test('classifyOrderStatus — "완료" 포함 문자열은 ok 톤', () => {
  assert.equal(classifyOrderStatus('체결 완료'), 'ok');
  assert.equal(classifyOrderStatus('완료'), 'ok');
});

test('classifyOrderStatus — "대기" 포함 문자열은 warn 톤', () => {
  assert.equal(classifyOrderStatus('체결 대기'), 'warn');
});

test('classifyOrderStatus — 알 수 없는 값/빈 값은 flat(색 추측 금지)', () => {
  assert.equal(classifyOrderStatus('접수'), 'flat');
  assert.equal(classifyOrderStatus(''), 'flat');
  assert.equal(classifyOrderStatus(null), 'flat');
});

test('formatOrderTime — HHmmss 6자리 → HH:MM', () => {
  assert.equal(formatOrderTime('093100'), '09:31');
});

test('formatOrderTime — HHmm 4자리도 지원', () => {
  assert.equal(formatOrderTime('0902'), '09:02');
});

test('formatOrderTime — 형식이 안 맞으면 원문 그대로(추측 변환 금지)', () => {
  assert.equal(formatOrderTime('오전9시31분'), '오전9시31분');
  assert.equal(formatOrderTime(''), null);
  assert.equal(formatOrderTime(null), null);
});

test('buildOrderLine — 지정가 주문: 종목+수량 결합, 가격·시각 서브라인', () => {
  const line = buildOrderLine({
    stk_nm: 'SK하이닉스',
    ord_qty: '5',
    io_tp_nm: '지정가',
    ord_pric: '1701000',
    tm: '093100',
    ord_stt: '체결 대기',
  });
  assert.equal(line.title, 'SK하이닉스 5주');
  assert.equal(line.titleSub, '지정가 1,701,000원 · 09:31');
  assert.equal(line.status, '체결 대기');
});

test('buildOrderLine — 시장가 주문: 가격 세그먼트 생략(0원짜리 목업 방지)', () => {
  const line = buildOrderLine({
    stk_nm: '삼성전자',
    ord_qty: '10',
    io_tp_nm: '시장가',
    ord_pric: '0',
    tm: '090200',
    ord_stt: '체결 완료',
  });
  assert.equal(line.title, '삼성전자 10주');
  assert.equal(line.titleSub, '시장가 · 09:02');
});

test('buildOrderLine — 종목명·주문수량 중 하나라도 없으면 그 행은 null(필드 단위 생략)', () => {
  assert.equal(buildOrderLine({ stk_nm: 'SK하이닉스' }), null); // ord_qty 없음
  assert.equal(buildOrderLine({ ord_qty: '5' }), null); // stk_nm 없음
  assert.equal(buildOrderLine(null), null);
});
