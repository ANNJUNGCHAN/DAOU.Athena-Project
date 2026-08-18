'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { volumeProfile, VOLUME_PROFILE_BUCKETS } = require('./chart-volume-profile');

test('버킷 수 기본값은 24다 (spec §4)', () => {
  assert.equal(VOLUME_PROFILE_BUCKETS, 24);
});

test('빈 rows → 빈 프로파일', () => {
  assert.deepEqual(volumeProfile([]), { buckets: [], pocIndex: -1 });
  assert.deepEqual(volumeProfile(null), { buckets: [], pocIndex: -1 });
});

test('가격범위 0(전 봉 동일가) → 단일 버킷에 전량', () => {
  const rows = [
    { high: 100, low: 100, close: 100, volume: 3 },
    { high: 100, low: 100, close: 100, volume: 7 },
  ];
  const p = volumeProfile(rows);
  assert.equal(p.buckets.length, 1);
  assert.equal(p.buckets[0].volume, 10);
  assert.equal(p.pocIndex, 0);
});

test('종가 기준 단순 배분 — 봉의 거래량 전량이 종가 버킷에 합산된다 (고저 균등배분 아님)', () => {
  // 범위 100~124, 4버킷: [100,106) [106,112) [112,118) [118,124]
  const rows = [
    { high: 124, low: 100, close: 101, volume: 5 }, // 버킷 0
    { high: 124, low: 100, close: 113, volume: 9 }, // 버킷 2 — 고저가 전체를 걸쳐도 종가 버킷에만
  ];
  const p = volumeProfile(rows, 4);
  assert.equal(p.buckets[0].volume, 5);
  assert.equal(p.buckets[1].volume, 0);
  assert.equal(p.buckets[2].volume, 9);
  assert.equal(p.buckets[3].volume, 0);
});

test('종가 == 전체 최고가 → 마지막 버킷 귀속', () => {
  const rows = [
    { high: 110, low: 100, close: 110, volume: 4 },
    { high: 110, low: 100, close: 100, volume: 1 },
  ];
  const p = volumeProfile(rows, 5);
  assert.equal(p.buckets[4].volume, 4);
  assert.equal(p.buckets[0].volume, 1);
});

test('POC 동률 → 최저가 쪽(먼저 등장한 버킷) 유지', () => {
  const rows = [
    { high: 120, low: 100, close: 101, volume: 6 }, // 버킷 0
    { high: 120, low: 100, close: 119, volume: 6 }, // 마지막 버킷 — 동률
  ];
  const p = volumeProfile(rows, 4);
  assert.equal(p.pocIndex, 0);
});
