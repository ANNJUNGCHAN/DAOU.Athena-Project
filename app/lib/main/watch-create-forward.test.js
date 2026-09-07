'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isWatchCodeCall, koreanTitles, isWatchCodeSuccess, extractWatchCreate,
} = require('./watch-create-forward');

const LABELS = {
  load_bars: '일봉 불러오기',
  avg_volume: '3일 거래량 평균',
  volume_ratio: '배수 비교',
  fire: '알림',
};

test('propose_watch_code만 받고 다른 루틴 액션은 버린다', () => {
  assert.equal(isWatchCodeCall({ name: 'athena_routine', input: { action: 'propose_watch_code' } }), true);
  assert.equal(isWatchCodeCall({ name: 'mcp__athena__athena_routine', input: { action: 'propose_watch_code' } }), true);
  assert.equal(isWatchCodeCall({ name: 'athena_routine', input: { action: 'draft' } }), false);
  assert.equal(isWatchCodeCall({ name: 'other__athena_routine', input: { action: 'propose_watch_code' } }), false);
});

test('한국어 제목은 labels 짝을 우선하고 없으면 NODE_LABELS 리터럴을 읽는다', () => {
  assert.deepEqual(koreanTitles({ labels: LABELS }), [
    '일봉 불러오기', '3일 거래량 평균', '배수 비교', '알림',
  ]);
  assert.deepEqual(
    koreanTitles({ source: 'NODE_LABELS = {"load_bars": "일봉 불러오기", "fire": "알림"}\n' }),
    ['일봉 불러오기', '알림'],
  );
  assert.deepEqual(koreanTitles({ labels: {}, source: 'NODE_LABELS = {"a": "평균"}' }), ['평균']);
  assert.deepEqual(koreanTitles(null), []);
});

test('성공 결과는 code_hash 또는 path가 있을 때만이다', () => {
  assert.equal(isWatchCodeSuccess({ code_hash: 'abc', path: 'watch/a.py' }), true);
  assert.equal(isWatchCodeSuccess({ path: 'watch/a.py' }), true);
  assert.equal(isWatchCodeSuccess({ notice: '저장됨 — 검사 전' }), false);
  assert.equal(isWatchCodeSuccess(null), false);
});

test('추출은 성공 결과와 입력 제목을 함께 요구한다', () => {
  const step = {
    name: 'athena_routine',
    input: { action: 'propose_watch_code', watch_code: { labels: LABELS, path: 'watch/a.py' } },
  };
  assert.deepEqual(extractWatchCreate(step, { code_hash: 'abc' }).titles, [
    '일봉 불러오기', '3일 거래량 평균', '배수 비교', '알림',
  ]);
  assert.equal(extractWatchCreate(step, { notice: '저장됨 — 검사 전' }), null);
  assert.equal(extractWatchCreate({ name: 'athena_routine', input: { action: 'draft' } }, { code_hash: 'abc' }), null);
});
