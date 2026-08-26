'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTextReleaseLadder } = require('./text-release-ladder');

// 실제 setTimeout을 기다리지 않는다 — 등록된 콜백을 손으로 들고 있다가 테스트가
// "시간이 흘렀다"를 원할 때만 부른다(order-ticket.js의 randomFn 주입과 같은
// 결정론 원칙). fireAll()은 그 순간 걸려 있는 타이머를 전부(보통 최대 1개,
// 텍스트 조각과 툴 단계가 같은 순간 겹칠 때만 최대 2개) 우르르 발화시킨다 —
// 이미 방출됐거나 조건이 안 맞는 타이머는 콜백 안에서 스스로 조용히 넘어간다.
function fakeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeoutFn: (fn) => { const id = nextId++; pending.set(id, fn); return id; },
    clearTimeoutFn: (id) => { pending.delete(id); },
    fireAll: () => { const fns = [...pending.values()]; pending.clear(); for (const fn of fns) fn(); },
    pendingCount: () => pending.size,
  };
}

function setup(overrides) {
  const timers = fakeTimers();
  const released = [];
  const ladder = createTextReleaseLadder({
    onRelease: () => released.push(true),
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    ...overrides,
  });
  return { ladder, timers, releasedCount: () => released.length };
}

test('조건(a) — 캔버스 결과 도착은 즉시, 다른 신호 없이도 방출한다', () => {
  const { ladder, releasedCount } = setup();
  assert.equal(ladder.released, false);
  ladder.onCanvasLanded();
  assert.equal(ladder.released, true);
  assert.equal(releasedCount(), 1);
});

test('방출은 정확히 한 번만 — 캔버스 결과가 여러 장 와도 onRelease는 한 번', () => {
  const { ladder, releasedCount } = setup();
  ladder.onCanvasLanded();
  ladder.onCanvasLanded();
  ladder.onCanvasLanded();
  assert.equal(releasedCount(), 1);
});

test('조건(b) — 전부 종결되면 조용해짐 유예가 걸리고, 유예 시간이 다 돼야 방출한다', () => {
  const { ladder, timers, releasedCount } = setup();
  ladder.onToolStep({ id: '1', label: '검색', done: false });
  assert.equal(ladder.released, false);
  ladder.onToolStep({ id: '1', label: '검색', done: true });
  assert.equal(timers.pendingCount(), 1, '유일한 단계가 끝나 조용해짐 유예가 걸린다');
  assert.equal(ladder.released, false, '유예 시간이 아직 안 지났다 — 즉시 방출하지 않는다(회귀 가드, 아래 별도 테스트)');
  timers.fireAll();
  assert.equal(ladder.released, true, '유예 시간 동안 새 단계가 없었다');
  assert.equal(releasedCount(), 1);
});

// 단위 테스트로 실측한 회귀 — 처음 구현은 단계 하나(검색)가 끝나는 즉시
// "전부 종결"로 오판해 곧바로 방출해버렸다. 실제로는 검색→설명→판단이 각각
// 1.8~2.5초 간격으로 이어지므로, 검색만 끝난 순간은 "종결"이 아니라 "다음
// 단계 시작 전 침묵"이다 — 그 순간 방출하면 나중에 진짜 render_canvas가 와도
// 이미 풀린 상태라 텍스트가 카드보다 먼저 보이는, 고치려던 결함이 재발한다.
test('회귀 — 단계 사이 침묵을 종결로 오판해 너무 일찍 풀리지 않는다(하나라도 진행 중이면 유예를 취소한다)', () => {
  const { ladder, timers } = setup();
  ladder.onToolStep({ id: '1', label: '검색', done: true }); // 조용해짐 유예 시작
  ladder.onToolStep({ id: '2', label: '스키마 확인', done: false }); // 유예 시간 안에 다음 단계 시작
  assert.equal(timers.pendingCount(), 0, '새 활동이 왔으니 이전 유예는 취소됐다');
  timers.fireAll(); // 취소됐으니 아무것도 안 남아 있어야 한다(발화할 게 없다)
  assert.equal(ladder.released, false, '설명이 아직 진행 중이다');
  ladder.onToolStep({ id: '2', label: '스키마 확인', done: true }); // 이제 다시 전부 종결 — 유예 재시작
  assert.equal(timers.pendingCount(), 1);
  timers.fireAll();
  assert.equal(ladder.released, true);
});

test('render_canvas가 한 번이라도 보이면 (b)는 절대 방출하지 않는다 — (a)만 기다린다', () => {
  const { ladder, timers } = setup();
  ladder.onToolStep({ id: '1', label: '검색', done: true });
  ladder.onToolStep({ id: '2', label: '카드 그리는 중', done: true });
  assert.equal(timers.pendingCount(), 0, 'render_canvas를 봤으니 조용해짐 유예 자체를 안 건다');
  timers.fireAll();
  assert.equal(ladder.released, false, '전부 done이어도 render_canvas가 있었으니 카드를 기다린다');
  ladder.onCanvasLanded();
  assert.equal(ladder.released, true, '카드가 실제로 오면 그제서야(a) 방출한다');
});

test('조건(c) — 첫 조각 이후 유예 시간 안에 툴 활동이 전혀 없으면 방출한다', () => {
  const { ladder, timers, releasedCount } = setup();
  ladder.onTextDelta();
  assert.equal(ladder.released, false);
  assert.equal(timers.pendingCount(), 1, '첫 조각에서 유예 타이머가 하나 걸린다');
  timers.fireAll();
  assert.equal(ladder.released, true, '유예 시간이 다 됐고 툴 활동이 하나도 없었다');
  assert.equal(releasedCount(), 1);
});

test('조건(c) — 유예 타이머는 첫 조각에서만 켠다(두 번째 조각은 새 타이머를 안 만든다)', () => {
  const { ladder, timers } = setup();
  ladder.onTextDelta();
  ladder.onTextDelta();
  ladder.onTextDelta();
  assert.equal(timers.pendingCount(), 1);
});

test('조건(c)는 유예 시간 안에 툴 활동이 시작되면 적용되지 않는다(그 활동을 계속 기다린다)', () => {
  const { ladder, timers } = setup();
  ladder.onTextDelta();
  ladder.onToolStep({ id: '1', label: '검색', done: false }); // 유예 시간 안에 활동 시작
  timers.fireAll(); // (c) 유예 타이머가 울려도
  assert.equal(ladder.released, false, '이미 활동이 있었으니 (c) 대상이 아니다 — 종결을 기다린다(b)');
  ladder.onToolStep({ id: '1', label: '검색', done: true }); // (b)의 조용해짐 유예가 걸린다
  timers.fireAll();
  assert.equal(ladder.released, true, '이제 (b)가 방출한다');
});

test('dispose() — 방출 전에 부르면 (c)/(b) 유예 타이머를 전부 지운다(누수 방지, 방출은 안 한다)', () => {
  const { ladder, timers, releasedCount } = setup();
  ladder.onTextDelta(); // (c) 타이머
  ladder.onToolStep({ id: '1', label: '검색', done: false });
  ladder.onToolStep({ id: '1', label: '검색', done: true }); // (b) 타이머로 교체(둘 다 안 겹친다 — 위 조건(c) 테스트와 같은 흐름)
  assert.equal(timers.pendingCount(), 1);
  ladder.dispose();
  assert.equal(timers.pendingCount(), 0, '타이머가 지워졌다');
  assert.equal(ladder.released, false, 'dispose 자체는 방출이 아니다 — authoritative overwrite가 대신 처리한다');
  assert.equal(releasedCount(), 0);
});

test('onRelease 콜백이 없으면 생성 시점에 거부한다(조용히 no-op하지 않는다)', () => {
  assert.throws(() => createTextReleaseLadder({}));
  assert.throws(() => createTextReleaseLadder());
});

test('onToolStep — id 없는 이벤트는 무시한다(그리지 않는다는 chat.js의 기존 관례와 같다)', () => {
  const { ladder } = setup();
  assert.doesNotThrow(() => ladder.onToolStep({ label: '검색', done: true }));
  assert.equal(ladder.released, false);
});

test('방출된 뒤에는 어떤 이벤트도 재방출을 안 일으킨다', () => {
  const { ladder, releasedCount } = setup();
  ladder.onCanvasLanded();
  ladder.onTextDelta();
  ladder.onToolStep({ id: '1', label: '검색', done: true });
  ladder.onCanvasLanded();
  assert.equal(releasedCount(), 1);
});
