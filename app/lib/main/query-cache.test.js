// query-cache.js — L1 완전일치 판정 캐시의 계약: 정규화·TTL·FIFO 상한.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { QueryCache, normalizeQuery } = require('./query-cache');

test('normalizeQuery: 공백·대소문자·말미 문장부호만 다듬는다', () => {
  assert.equal(normalizeQuery('  삼성전자   차트 보여줘?? '), '삼성전자 차트 보여줘');
  assert.equal(normalizeQuery('Samsung Chart'), 'samsung chart');
  assert.equal(normalizeQuery(''), '');
  // 의미가 다른 문장은 다른 키 — 조사·어미를 뭉개지 않는다(L1은 완전일치다)
  assert.notEqual(normalizeQuery('삼성전자 차트'), normalizeQuery('삼전 차트'));
});

test('QueryCache: 같은 질문(정규화 동치)이 판정을 재사용한다', () => {
  let t = 0;
  const cache = new QueryCache({ clock: () => t });
  // 캐시는 judgment 형상을 모른다(불투명 저장) — P5부터 canvasType은 판정
  // 객체에 없다(operation_ref의 순수 함수라 응답값을 쓴다, fast-path.js).
  cache.set('삼성전자 차트 보여줘', { resolveQuestion: '삼성전자 차트' });
  assert.deepEqual(cache.get('  삼성전자  차트 보여줘! '), { resolveQuestion: '삼성전자 차트' });
});

test('QueryCache: TTL 만료 시 무효 — 낡은 판정을 재사용하지 않는다', () => {
  let t = 0;
  const cache = new QueryCache({ ttlMs: 1000, clock: () => t });
  cache.set('q', { resolveQuestion: 'q' });
  t = 1001;
  assert.equal(cache.get('q'), null);
});

test('QueryCache: 상한 초과 시 가장 오래된 항목부터 축출(FIFO)', () => {
  const cache = new QueryCache({ maxEntries: 2, clock: () => 0 });
  cache.set('a', { n: 1 });
  cache.set('b', { n: 2 });
  cache.set('c', { n: 3 });
  assert.equal(cache.get('a'), null);
  assert.deepEqual(cache.get('c'), { n: 3 });
});

test('QueryCache: invalidate — 실패한 판정은 반복 리플레이되지 않는다', () => {
  const cache = new QueryCache({ clock: () => 0 });
  cache.set('q', { resolveQuestion: 'q' });
  cache.invalidate('q');
  assert.equal(cache.get('q'), null);
});
