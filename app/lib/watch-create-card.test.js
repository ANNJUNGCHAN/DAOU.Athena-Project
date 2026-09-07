'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildReceipt, POLL_QUESTION, COOLDOWN_QUESTION, POLL_FOOTNOTE,
} = require('./watch-create-card');

const NODES = ['일봉 불러오기', '3일 거래량 평균', '배수 비교', '알림'];

test('영수증은 Paper 459Q-1 원문 그대로 화살표로 잇는다', () => {
  const receipt = buildReceipt(NODES);
  assert.equal(receipt.badge, '+4');
  assert.equal(receipt.title, '함수 4개 만듦');
  assert.equal(receipt.chain, '일봉 불러오기 → 3일 거래량 평균 → 배수 비교 → 알림');
  assert.equal(receipt.text, '함수 4개 만듦 · 일봉 불러오기 → 3일 거래량 평균 → 배수 비교 → 알림');
});

test('이름이 없으면 영수증을 만들지 않는다 — 개수를 지어내지 않는다', () => {
  assert.equal(buildReceipt(null), null);
  assert.equal(buildReceipt([]), null);
  assert.equal(buildReceipt(['', '  ']), null);
  assert.equal(buildReceipt(undefined), null);
});

test('질문 카드 문구는 Paper 459S-1·45A6-1 원문이다', () => {
  assert.deepEqual(POLL_QUESTION.tags, ['새 알람', '질문 2/3']);
  assert.equal(POLL_QUESTION.question, '언제 확인할까요? — 하나만 고르면 됩니다');
  assert.deepEqual(POLL_QUESTION.choices, ['장중 1분마다', '장 마감 후 한 번']);
  assert.equal(POLL_QUESTION.footnote, POLL_FOOTNOTE);
  assert.match(POLL_FOOTNOTE, /점심 지나서만 봐줘/);
  assert.deepEqual(COOLDOWN_QUESTION.tags, ['다음']);
  assert.equal(COOLDOWN_QUESTION.question, '얼마나 자주 울려도 될까요? — 쿨다운을 정합니다');
  assert.deepEqual(COOLDOWN_QUESTION.choices, []);
});
