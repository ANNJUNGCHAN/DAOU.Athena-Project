'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyToolStep } = require('./tool-step-track');

test('시작 단계 — done:false, timeText 빈 문자열', () => {
  const steps = new Map();
  const r = applyToolStep(steps, { id: 't1', label: '조회', done: false, elapsedMs: null });
  assert.deepEqual(r, { id: 't1', label: '조회', done: false, timeText: '', error: false });
  assert.deepEqual(steps.get('t1'), { label: '조회', done: false, elapsedMs: null, error: false });
});

test('완료 단계 — 초 단위 소요시간 문자열', () => {
  const steps = new Map();
  const r = applyToolStep(steps, { id: 't1', label: '조회', done: true, elapsedMs: 1234 });
  assert.equal(r.timeText, '1.2s');
  assert.equal(r.done, true);
});

test('완료인데 elapsedMs가 숫자가 아니면 — 대시 하나', () => {
  const steps = new Map();
  const r = applyToolStep(steps, { id: 't1', label: '조회', done: true, elapsedMs: null });
  assert.equal(r.timeText, '—');
});

test('라벨 없는 이벤트 — 기본 라벨 "처리 중"', () => {
  const steps = new Map();
  const r = applyToolStep(steps, { id: 't2', done: false });
  assert.equal(r.label, '처리 중');
});

test('id 없는 이벤트 — null(그리지 않는다)', () => {
  assert.equal(applyToolStep(new Map(), {}), null);
  assert.equal(applyToolStep(new Map(), null), null);
  assert.equal(applyToolStep(new Map(), undefined), null);
});

test('같은 id 재호출 — 진행 중에서 완료로 갱신된다', () => {
  const steps = new Map();
  applyToolStep(steps, { id: 't1', label: '조회', done: false, elapsedMs: null });
  const r = applyToolStep(steps, { id: 't1', label: '조회', done: true, elapsedMs: 500 });
  assert.equal(r.done, true);
  assert.equal(r.timeText, '0.5s');
  assert.equal(steps.size, 1);
});

test('실패 완료 — label에 "실패"가 붙고 error:true', () => {
  const steps = new Map();
  const r = applyToolStep(steps, { id: 't1', label: '조회', done: true, elapsedMs: 800, error: true });
  assert.deepEqual(r, { id: 't1', label: '조회 실패', done: true, timeText: '0.8s', error: true });
  assert.deepEqual(steps.get('t1'), { label: '조회 실패', done: true, elapsedMs: 800, error: true });
});

test('error 필드 없는 이벤트 — error:false 기본값(옵셔널 필드)', () => {
  const steps = new Map();
  const r = applyToolStep(steps, { id: 't1', label: '조회', done: true, elapsedMs: 100 });
  assert.equal(r.error, false);
  assert.equal(r.label, '조회');
});

test('같은 id 재호출 — 진행 중에서 실패로 갱신된다', () => {
  const steps = new Map();
  applyToolStep(steps, { id: 't1', label: '조회', done: false, elapsedMs: null });
  const r = applyToolStep(steps, { id: 't1', label: '조회', done: true, elapsedMs: 300, error: true });
  assert.equal(r.done, true);
  assert.equal(r.error, true);
  assert.equal(r.label, '조회 실패');
  assert.equal(steps.size, 1);
});
