'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createQuoteRealtimePanelAdapter } = require('./quote-realtime-panel');

test('openPanel: 등록 후 size·isOpen이 반영된다', () => {
  const adapter = createQuoteRealtimePanelAdapter();
  adapter.openPanel('p1', '005930', () => {});
  assert.equal(adapter.size(), 1);
  assert.equal(adapter.isOpen('p1'), true);
  assert.equal(adapter.isOpen('p2'), false);
});

test('openPanel: panelId·symbol·onTick 중 하나라도 없으면 던진다', () => {
  const adapter = createQuoteRealtimePanelAdapter();
  assert.throws(() => adapter.openPanel(null, '005930', () => {}));
  assert.throws(() => adapter.openPanel('p1', '', () => {}));
  assert.throws(() => adapter.openPanel('p1', '005930', null));
});

test('applyRealtimeTick: 종목이 일치하는 열린 패널마다 onTick을 부른다', () => {
  const adapter = createQuoteRealtimePanelAdapter();
  const received = [];
  adapter.openPanel('p1', '005930', (tick) => received.push(tick));
  const tick = { symbol: '005930', at: 1, price: 257000, volume: 10, changeRate: -1.37, accVolume: 311392 };
  const applied = adapter.applyRealtimeTick(tick);
  assert.equal(applied, 1);
  assert.deepEqual(received, [tick]);
});

test('applyRealtimeTick: 같은 종목을 보는 패널이 여럿이면 전부 받는다', () => {
  const adapter = createQuoteRealtimePanelAdapter();
  let count1 = 0;
  let count2 = 0;
  adapter.openPanel('p1', '005930', () => { count1 += 1; });
  adapter.openPanel('p2', '005930', () => { count2 += 1; });
  adapter.openPanel('p3', '000660', () => { throw new Error('다른 종목이 불려선 안 된다'); });
  const applied = adapter.applyRealtimeTick({ symbol: '005930', at: 1, price: 1 });
  assert.equal(applied, 2);
  assert.equal(count1, 1);
  assert.equal(count2, 1);
});

test('applyRealtimeTick: 종목 불일치는 조용히 버린다(카드를 새로 안 만든다)', () => {
  const adapter = createQuoteRealtimePanelAdapter();
  let called = false;
  adapter.openPanel('p1', '005930', () => { called = true; });
  const applied = adapter.applyRealtimeTick({ symbol: '000660', at: 1, price: 1 });
  assert.equal(applied, 0);
  assert.equal(called, false);
});

test('applyRealtimeTick: symbol 없는 tick·빈 레지스트리는 0을 돌려준다', () => {
  const adapter = createQuoteRealtimePanelAdapter();
  assert.equal(adapter.applyRealtimeTick(null), 0);
  assert.equal(adapter.applyRealtimeTick({}), 0);
  assert.equal(adapter.applyRealtimeTick({ symbol: '005930' }), 0);
});

test('closePanel: 소멸 후에는 같은 종목 틱이 와도 조용히 버린다', () => {
  const adapter = createQuoteRealtimePanelAdapter();
  let called = false;
  adapter.openPanel('p1', '005930', () => { called = true; });
  assert.equal(adapter.closePanel('p1'), true);
  assert.equal(adapter.isOpen('p1'), false);
  assert.equal(adapter.size(), 0);
  const applied = adapter.applyRealtimeTick({ symbol: '005930', at: 1, price: 1 });
  assert.equal(applied, 0);
  assert.equal(called, false);
});

test('closePanel: 없는 panelId는 false — 없는 걸 지웠다고 하지 않는다', () => {
  const adapter = createQuoteRealtimePanelAdapter();
  assert.equal(adapter.closePanel('ghost'), false);
});

test('closePanel: 같은 종목의 다른 패널은 계속 틱을 받는다', () => {
  const adapter = createQuoteRealtimePanelAdapter();
  let count2 = 0;
  adapter.openPanel('p1', '005930', () => { throw new Error('닫힌 패널이 불려선 안 된다'); });
  adapter.openPanel('p2', '005930', () => { count2 += 1; });
  adapter.closePanel('p1');
  const applied = adapter.applyRealtimeTick({ symbol: '005930', at: 1, price: 1 });
  assert.equal(applied, 1);
  assert.equal(count2, 1);
});
