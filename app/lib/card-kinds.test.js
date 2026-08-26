'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CardKinds = require('./card-kinds');

test('register/resolve — 등록한 title로 정확히 그 renderFn을 돌려준다', () => {
  const renderFn = (envelope) => (envelope.data ? {} : null);
  CardKinds.register('시세', renderFn);
  assert.strictEqual(CardKinds.resolve('시세'), renderFn);
});

test('resolve — 등록되지 않은 title은 undefined(호출부가 범용 렌더러로 폴백)', () => {
  assert.equal(CardKinds.resolve('등록안된카드'), undefined);
});

test('resolve — title이 없으면(null/undefined/빈 문자열) undefined', () => {
  assert.equal(CardKinds.resolve(null), undefined);
  assert.equal(CardKinds.resolve(undefined), undefined);
  assert.equal(CardKinds.resolve(''), undefined);
});

test('all-or-nothing 계약 — renderFn은 핵심 필드가 없으면 null을 돌려줘 범용 렌더러로 폴백한다', () => {
  const renderFn = (envelope) => {
    const price = envelope && envelope.data && envelope.data.cur_prc;
    if (price === undefined) return null;
    return { built: true, price };
  };
  CardKinds.register('테스트카드', renderFn);
  const resolved = CardKinds.resolve('테스트카드');
  assert.equal(resolved({ data: {} }), null);
  assert.deepEqual(resolved({ data: { cur_prc: '71400' } }), { built: true, price: '71400' });
});

test('register — renderFn이 아닌 값은 항상 null을 돌려주는 안전 기본값으로 대체된다(스텁 파일 패턴)', () => {
  CardKinds.register('스텁카드', undefined);
  assert.equal(CardKinds.resolve('스텁카드')({ data: { cur_prc: '1' } }), null);
});

test('register — 같은 title로 다시 등록하면 이전 renderFn을 덮어쓴다', () => {
  CardKinds.register('덮어쓰기카드', () => 'first');
  CardKinds.register('덮어쓰기카드', () => 'second');
  assert.equal(CardKinds.resolve('덮어쓰기카드')(), 'second');
});
