'use strict';

function eventKey(event) {
  if (!event || typeof event !== 'object') return null;
  const explicit = String(event.event_id || event.id || '').trim();
  if (explicit) return `id:${explicit}`;
  const parts = [event.type, event.routine_id, event.fired_at, event.observed]
    .map((value) => String(value || '').trim());
  return parts.some(Boolean) ? `fields:${parts.join('|')}` : null;
}

class StartupRoutineBuffer {
  constructor() {
    this._events = new Map();
    this._missed = new Map();
  }

  addEvent(event) {
    const key = eventKey(event);
    if (!key || this._events.has(key)) return false;
    this._events.set(key, event);
    return true;
  }

  addMissed(routines) {
    let added = 0;
    for (const routine of Array.isArray(routines) ? routines : []) {
      const id = String(routine && routine.id || '').trim();
      if (!id || this._missed.has(id)) continue;
      this._missed.set(id, routine);
      added += 1;
    }
    return added;
  }

  flush({ sendEvent, sendMissed } = {}) {
    let events = 0;
    let missed = 0;
    if (typeof sendEvent === 'function') {
      for (const [key, event] of [...this._events]) {
        sendEvent(event);
        this._events.delete(key);
        events += 1;
      }
    }
    if (typeof sendMissed === 'function' && this._missed.size) {
      const rows = [...this._missed.values()];
      sendMissed(rows);
      this._missed.clear();
      missed = rows.length;
    }
    return { events, missed, pending: this.snapshot() };
  }

  snapshot() {
    return { events: this._events.size, missed: this._missed.size };
  }
}

module.exports = { StartupRoutineBuffer, eventKey };
