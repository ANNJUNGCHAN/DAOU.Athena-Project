'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveInputLock } = require('./live-query-lock');

test('둘 다 idle — 잠금 없음', () => {
  assert.deepEqual(
    resolveInputLock({ chatBusy: false, remoteQueryBusy: false }),
    { disabled: false, hintHidden: true, hintText: null },
  );
});

test('오브 자신의 질의 진행 중 — "답변 중…"', () => {
  assert.deepEqual(
    resolveInputLock({ chatBusy: true, remoteQueryBusy: false }),
    { disabled: true, hintHidden: false, hintText: '답변 중…' },
  );
});

test('셸 질의 진행 중(원격) — "셸 질의 진행 중"', () => {
  assert.deepEqual(
    resolveInputLock({ chatBusy: false, remoteQueryBusy: true }),
    { disabled: true, hintHidden: false, hintText: '셸 질의 진행 중' },
  );
});

test('둘 다 true — 오브 자신이 우선한다(원격 문구로 안 덮인다)', () => {
  assert.deepEqual(
    resolveInputLock({ chatBusy: true, remoteQueryBusy: true }),
    { disabled: true, hintHidden: false, hintText: '답변 중…' },
  );
});
