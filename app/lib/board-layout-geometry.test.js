'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { visualRowCounts } = require('./board-layout-geometry');

test('visualRowCounts는 top이 달라도 세로 구간이 겹치는 KPI 셀을 같은 행으로 센다', () => {
  const counts = visualRowCounts([
    { left: 0, top: 100, right: 100, bottom: 140 },
    { left: 110, top: 106, right: 210, bottom: 134 },
    { left: 220, top: 103, right: 320, bottom: 137 },
    { left: 330, top: 109, right: 430, bottom: 131 },
  ]);

  assert.deepEqual(counts, [4], '실제 4열을 [2, 2] 같은 여러 행으로 쪼개면 안 된다');
  assert.equal(Math.max(...counts), 4, 'M 단계의 3열 상한 검사가 4열 회귀를 잡아야 한다');
});

test('visualRowCounts는 높이가 다른 3+2 flex 흐름을 두 행으로 센다', () => {
  const counts = visualRowCounts([
    { left: 0, top: 100, right: 100, bottom: 140 },
    { left: 110, top: 106, right: 210, bottom: 134 },
    { left: 220, top: 103, right: 320, bottom: 137 },
    { left: 0, top: 150, right: 100, bottom: 190 },
    { left: 110, top: 156, right: 210, bottom: 184 },
  ]);

  assert.deepEqual(counts, [3, 2]);
});
