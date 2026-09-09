'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { paperMockCandidates } = require('./board-text-clip');

test('paperMockCandidates는 숫자 있는 값 슬롯만 고르고 라벨·static 문면은 뺀다', () => {
  const got = paperMockCandidates([
    { slot_id: 's1', node_id: 'n1', kind: 'value', paper_text: '124,580,240원' },
    { slot_id: 's2', node_id: 'n2', kind: 'label', paper_text: '총자산' },
    { slot_id: 's3', node_id: 'n3', kind: 'value', paper_text: '실시간', static: 'text' },
    { slot_id: 's4', node_id: 'n4', kind: 'value', paper_text: '없음' },
  ]);
  assert.deepEqual(got, [{ slot_id: 's1', node: 'n1', paper: '124,580,240원' }]);
});
