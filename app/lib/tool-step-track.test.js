'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyToolStep } = require('./tool-step-track');

test('시작 단계 — done:false, timeText 빈 문자열', () => {
  const steps = new Map();
  const r = applyToolStep(steps, { id: 't1', label: '조회', done: false, elapsedMs: null });
  assert.deepEqual(r, { id: 't1', label: '조회', done: false, timeText: '', error: false, retrying: false, note: '' });
  assert.deepEqual(steps.get('t1'), { label: '조회', done: false, elapsedMs: null, error: false, retrying: false, note: '' });
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
  assert.deepEqual(r, { id: 't1', label: '조회 실패', done: true, timeText: '0.8s', error: true, retrying: false, note: '' });
  assert.deepEqual(steps.get('t1'), { label: '조회 실패', done: true, elapsedMs: 800, error: true, retrying: false, note: '' });
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

// MCP 콜드스타트(2026-09-03 실측) — 세션이 막 뜨면 첫 호출이 "still connecting"으로
// 깨지고 모델이 기다렸다 다시 부른다. 그때까지 빨간 "실패"로 찍혀서 사용자가 기능이
// 없는 줄 알았다(F-19의 실제 원인). 실패가 아니라 대기로 분류한다 — 숨기지는 않는다.
test('retrying — 서버 연결 대기는 실패로 쓰지 않는다', () => {
  const steps = new Map();
  const r = applyToolStep(steps, {
    id: 't1', label: '그래프 화면 제어', done: true, elapsedMs: 20, error: false, retrying: true,
  });
  assert.equal(r.error, false, '도구가 고장난 것이 아니다');
  assert.equal(r.retrying, true);
  assert.equal(r.label, '그래프 화면 제어 — 서버 연결 대기');
});

test('retrying — 진짜 실패는 여전히 실패다(대기가 실패를 덮지 않는다)', () => {
  const steps = new Map();
  const r = applyToolStep(steps, {
    id: 't1', label: '그래프 화면 제어', done: true, elapsedMs: 20, error: true, retrying: true,
  });
  assert.equal(r.error, true);
  assert.equal(r.label, '그래프 화면 제어 실패', '실패 문구가 우선한다');
});

test('부제(Paper 보드 10) — 보낸 것만 그대로 실리고, 안 보내면 빈 문자열이다', () => {
  const steps = new Map();
  const r = applyToolStep(steps, {
    id: 't1', label: '노드 조회', done: true, elapsedMs: 300, note: '한미반도체 · 관계 7 · 이력 3',
  });
  assert.equal(r.label, '노드 조회');
  assert.equal(r.note, '한미반도체 · 관계 7 · 이력 3');
  assert.equal(applyToolStep(steps, { id: 't2', label: '조회', done: false }).note, '');
});
