'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isMarketOpen } = require('./market-hours');

// 2026-08-24는 월요일, 2026-08-22는 토요일, 2026-08-23은 일요일(실측, KST).
const MON = '2026-08-24';

test('isMarketOpen: 경계 09:00/15:30', () => {
  assert.equal(isMarketOpen(new Date(`${MON}T08:59:00+09:00`)), false); // 개장 직전
  assert.equal(isMarketOpen(new Date(`${MON}T09:00:00+09:00`)), true); // 개장 시각
  assert.equal(isMarketOpen(new Date(`${MON}T12:00:00+09:00`)), true); // 장중
  assert.equal(isMarketOpen(new Date(`${MON}T15:30:00+09:00`)), true); // 마감 시각(경계 포함)
  assert.equal(isMarketOpen(new Date(`${MON}T15:31:00+09:00`)), false); // 마감 직후
});

test('isMarketOpen: 주말은 시간과 무관하게 장외', () => {
  assert.equal(isMarketOpen(new Date('2026-08-22T12:00:00+09:00')), false); // 토요일 정오
  assert.equal(isMarketOpen(new Date('2026-08-23T12:00:00+09:00')), false); // 일요일 정오
});

test('isMarketOpen: 자정은 평일이라도 장외', () => {
  assert.equal(isMarketOpen(new Date(`${MON}T00:00:00+09:00`)), false);
});

test('isMarketOpen: 시스템 로컬 타임존과 무관하게 KST로 환산한다', () => {
  // UTC 00:00은 KST 09:00(같은 순간) — 오프셋 문자열 없이도 절대 시각 기준으로 맞다.
  assert.equal(isMarketOpen(new Date(`${MON}T00:00:00Z`)), true);
});

test('isMarketOpen: 비Date·Invalid Date는 장외로 본다', () => {
  assert.equal(isMarketOpen(new Date('bogus')), false);
  assert.equal(isMarketOpen('완전히 잘못된 문자열'), false);
});
