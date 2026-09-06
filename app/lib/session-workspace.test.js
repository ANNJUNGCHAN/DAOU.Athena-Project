'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionWorkspace } = require('./session-workspace');

test('모드가 등록한 핸들러가 kind로 복원을 받고, 없는 kind는 false다', () => {
  const ws = createSessionWorkspace();
  const got = [];
  ws.register('backtest', { restore: (w) => got.push(w) });
  assert.equal(ws.has('backtest'), true);
  assert.equal(ws.restore({ kind: 'backtest', form: { symbol: '005930' } }), true);
  assert.deepEqual(got, [{ kind: 'backtest', form: { symbol: '005930' } }]);
  assert.equal(ws.restore({ kind: 'graph' }), false);
  assert.equal(ws.restore(null), false);
  assert.equal(ws.restore({ form: {} }), false);
});

test('보고는 조각(patch)만 보내고, 객체가 아니면 보내지 않는다', () => {
  const sent = [];
  const ws = createSessionWorkspace({ send: (p) => sent.push(p) });
  assert.equal(ws.report({ form: { symbol: '005930' } }), true);
  assert.equal(ws.report('x'), false);
  assert.equal(ws.report([1]), false);
  assert.equal(ws.report(null), false);
  assert.deepEqual(sent, [{ patch: { form: { symbol: '005930' } } }]);
});

test('비동기 핸들러의 실패도 경고로 남고 조용한 거부가 되지 않는다', async () => {
  const warned = [];
  const ws = createSessionWorkspace({ warn: (m) => warned.push(m) });
  ws.register('graph', { restore: async () => { throw new Error('map draw failed'); } });
  assert.equal(ws.restore({ kind: 'graph', graph: { surface: 'map' } }), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(warned[0], /restore\(graph\) failed — map draw failed/);
});

test('핸들러가 던져도 복원은 죽지 않고 경고로 남는다; 등록 해제는 자기 것만 푼다', () => {
  const warned = [];
  const ws = createSessionWorkspace({ warn: (m) => warned.push(m) });
  const off = ws.register('graph', { restore: () => { throw new Error('boom'); } });
  assert.equal(ws.restore({ kind: 'graph' }), false);
  assert.match(warned[0], /restore\(graph\) failed — boom/);
  const later = { restore: () => {} };
  ws.register('graph', later);
  off(); // 먼저 것의 해제는 나중 등록을 건드리지 않는다
  assert.equal(ws.has('graph'), true);
  assert.throws(() => ws.register('', later), TypeError);
  assert.throws(() => ws.register('agent', {}), TypeError);
});

test('flush()는 지연 보고를 들고 있는 모드만 흘리고, 던져도 나머지를 흘린다', () => {
  const warned = [];
  const flushed = [];
  const ws = createSessionWorkspace({ warn: (m) => warned.push(m) });
  ws.register('graph', { restore: () => {}, flush: () => { throw new Error('boom'); } });
  ws.register('backtest', { restore: () => {}, flush: () => flushed.push('backtest') });
  ws.register('agent', { restore: () => {} }); // 지연 보고가 없는 모드는 그냥 넘어간다
  assert.doesNotThrow(() => ws.flush());
  assert.deepEqual(flushed, ['backtest']);
  assert.match(warned[0], /flush\(graph\) failed — boom/);
});

test('clear()는 앞 세션의 것을 들고 있는 모드만 거두고, 던져도 나머지를 거둔다', () => {
  const warned = [];
  const cleared = [];
  const ws = createSessionWorkspace({ warn: (m) => warned.push(m) });
  ws.register('graph', { restore: () => {}, clear: () => { throw new Error('boom'); } });
  ws.register('backtest', { restore: () => {}, clear: () => cleared.push('backtest') });
  ws.register('agent', { restore: () => {} }); // 거둘 것이 없는 모드는 그냥 넘어간다
  assert.doesNotThrow(() => ws.clear());
  assert.deepEqual(cleared, ['backtest']);
  assert.match(warned[0], /clear\(graph\) failed — boom/);
});
