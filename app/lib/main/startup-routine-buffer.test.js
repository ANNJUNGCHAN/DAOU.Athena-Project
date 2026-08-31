'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { StartupRoutineBuffer, eventKey } = require('./startup-routine-buffer');

test('부팅 중 routine-fired와 놓친 일정은 셸 준비 전까지 유실하지 않는다', () => {
  const buffer = new StartupRoutineBuffer();
  const event = {
    type: 'routine-fired', routine_id: 'r-1', fired_at: '2026-08-31T00:00:00Z',
  };
  assert.equal(buffer.addEvent(event), true);
  assert.equal(buffer.addMissed([{ id: 'm-1' }, { id: 'm-2' }]), 2);
  assert.deepEqual(buffer.snapshot(), { events: 1, missed: 2 });

  const seenEvents = [];
  const seenMissed = [];
  const result = buffer.flush({
    sendEvent: (value) => seenEvents.push(value),
    sendMissed: (rows) => seenMissed.push(...rows),
  });

  assert.deepEqual(seenEvents, [event]);
  assert.deepEqual(seenMissed.map((row) => row.id), ['m-1', 'm-2']);
  assert.deepEqual(result, { events: 1, missed: 2, pending: { events: 0, missed: 0 } });
});

test('피드 재연결로 같은 이벤트가 다시 와도 부팅 버퍼는 한 번만 전달한다', () => {
  const buffer = new StartupRoutineBuffer();
  const event = {
    type: 'routine-fired', routine_id: 'r-1', fired_at: '2026-08-31T00:00:00Z',
  };
  assert.equal(eventKey(event), 'fields:routine-fired|r-1|2026-08-31T00:00:00Z|');
  assert.equal(buffer.addEvent(event), true);
  assert.equal(buffer.addEvent({ ...event }), false);
  assert.equal(buffer.addMissed([{ id: 'm-1' }, { id: 'm-1' }]), 1);

  let eventCount = 0;
  let missedCount = 0;
  buffer.flush({
    sendEvent: () => { eventCount += 1; },
    sendMissed: (rows) => { missedCount += rows.length; },
  });
  assert.equal(eventCount, 1);
  assert.equal(missedCount, 1);
});

test('전달 중 예외가 나면 아직 전달하지 못한 항목은 다음 flush에 남는다', () => {
  const buffer = new StartupRoutineBuffer();
  buffer.addEvent({ event_id: 'e-1', type: 'routine-fired' });
  buffer.addEvent({ event_id: 'e-2', type: 'routine-fired' });

  assert.throws(() => buffer.flush({
    sendEvent: (event) => {
      if (event.event_id === 'e-1') throw new Error('renderer unavailable');
    },
  }), /renderer unavailable/);
  assert.deepEqual(buffer.snapshot(), { events: 2, missed: 0 });

  const seen = [];
  buffer.flush({ sendEvent: (event) => seen.push(event.event_id) });
  assert.deepEqual(seen, ['e-1', 'e-2']);
  assert.deepEqual(buffer.snapshot(), { events: 0, missed: 0 });
});
