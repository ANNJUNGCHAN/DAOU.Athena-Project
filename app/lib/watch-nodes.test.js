// watch-nodes.js 단위 테스트 — 순수 계산이라 DOM 스텁도 필요 없다
// (watch-check-card.test.js와 같은 자리·같은 모양).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./watch-nodes');

test('formatValue: 큰 수는 자릿수를 끊고, 참/거짓은 한국어, 없는 값은 「—」다', () => {
  assert.equal(W.formatValue(18900000), '18,900,000');
  assert.equal(W.formatValue(1.523), '1.52');
  assert.equal(W.formatValue(-1240), '-1,240');
  assert.equal(W.formatValue(true), '참');
  assert.equal(W.formatValue(false), '거짓');
  assert.equal(W.formatValue(null), '—');
  assert.equal(W.formatValue(undefined), '—');
  assert.equal(W.formatValue(''), '—');
  assert.equal(W.formatValue('1.52배 · 넘음'), '1.52배 · 넘음');
});

test('watchSubLabel: 확인 주기를 모르면 1분으로 적는다(chat.js와 같은 규칙)', () => {
  assert.equal(W.watchSubLabel({ poll_interval_s: 300 }), '코드 감시 · 장중 5분마다');
  assert.equal(W.watchSubLabel(null), '코드 감시 · 장중 1분마다');
  assert.equal(W.watchSubLabel({ poll_interval_s: 30 }), '코드 감시 · 장중 1분마다');
});

test('versionLabel: 해시가 없으면 지어낸 버전 번호를 붙이지 않는다', () => {
  assert.equal(W.versionLabel({ version_hash: 'ab12cd34ef' }), '코드 감시 · vab12cd');
  assert.equal(W.versionLabel(null), '코드 감시');
});

test('nodeCards: 한국어 제목이 없으면 영어 함수명으로 대체한다(B-11의 앱 쪽 짝)', () => {
  const [card] = W.nodeCards([{ fn: 'avg_volume', inputs: [{ name: '봉', value: 60 }], output: 12400000, called: false }]);
  assert.equal(card.titleKo, 'avg_volume');
  assert.equal(card.titleEn, 'avg_volume');
  assert.deepEqual(card.inputs, [{ name: '봉', value: '60' }]);
  assert.equal(card.output, '12,400,000');
  assert.equal(card.unused, true, 'called:false도 「이번엔 안 쓰임」으로 본다');
  assert.deepEqual(W.nodeCards(null), []);
});

test('checkSummary: 검사를 안 돌렸으면 0번이라고 단정하지 않는다', () => {
  assert.equal(W.checkSummary({ count: 4, lookback_days: 30, last_fire: '2026-08-26' }), '지난 30일 4번 · 마지막 8/26');
  assert.equal(W.checkSummary({ count: 0, lookback_days: 30 }), '지난 30일 0번');
  assert.equal(W.checkSummary(null), '');
  assert.equal(W.checkSummary({}), '');
});

test('dayLabel·clockLabel: 못 읽는 값은 지어내지 않고 빈 문자열로 남긴다', () => {
  assert.equal(W.dayLabel('2026-10-03T09:00:00'), '2026-10-03');
  assert.equal(W.clockLabel('2026-09-03T15:31:00'), '15:31');
  assert.equal(W.dayLabel(''), '');
  assert.equal(W.clockLabel('그런 시각 없음'), '');
});
test('cooldownLabel: 나누어떨어지는 가장 큰 한국어 단위로 적는다(보드 12 「쿨다운 1일」)', () => {
  assert.equal(W.cooldownLabel(86400), '1일');
  assert.equal(W.cooldownLabel(300), '5분');
  assert.equal(W.cooldownLabel(7200), '2시간');
  assert.equal(W.cooldownLabel(90), '90초', '안 떨어지면 반올림하지 않고 초 그대로다');
  assert.equal(W.cooldownLabel(0), '0초');
  assert.equal(W.cooldownLabel(null), '—');
});
