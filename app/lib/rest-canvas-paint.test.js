'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { correlationKey, isValidCorrelation, waitForVisiblePaint } = require('./rest-canvas-paint');

test('correlation key requires complete dataset/item/ordinal identity', () => {
  const valid = { dataset_id: 'd', item_id: 'i', ordinal: 6 };
  assert.equal(isValidCorrelation(valid), true);
  assert.equal(correlationKey(valid), 'd\u0000i\u00006');
  assert.equal(correlationKey({ dataset_id: 'd', item_id: 'i', ordinal: 7 }), null);
  assert.equal(correlationKey({ dataset_id: 'd', ordinal: 1 }), null);
});

test('paint ack waits for visible nonzero rect and then two additional RAFs', async () => {
  let frames = 0;
  const raf = (callback) => { frames += 1; callback(frames); };
  const element = {
    getBoundingClientRect() {
      return frames < 2
        ? { width: 0, height: 0, x: 0, y: 0 }
        : { width: 400, height: 200, x: 10, y: 20 };
    },
  };
  const result = await waitForVisiblePaint(element, {
    requestAnimationFrame: raf,
    visibilityState: () => 'visible',
    now: () => frames * 10,
  });
  assert.equal(result.verifiedVisible, true);
  assert.equal(result.rect.width, 400);
  assert.equal(frames, 4); // 2번째 프레임에서 nonzero, 이후 2 RAF
});

test('paint ack does not accept a hidden document', async () => {
  const element = { getBoundingClientRect: () => ({ width: 10, height: 10, x: 0, y: 0 }) };
  await assert.rejects(() => waitForVisiblePaint(element, {
    requestAnimationFrame: (callback) => callback(),
    visibilityState: () => 'hidden',
    maxFrames: 2,
  }), /실제 표시되지 않았다/);
});

test('paint ack rejects on wall-clock timeout when RAF never fires', async () => {
  const element = { getBoundingClientRect: () => ({ width: 10, height: 10, x: 0, y: 0 }) };
  await assert.rejects(() => waitForVisiblePaint(element, {
    requestAnimationFrame: () => {},
    timeoutMs: 5,
  }), /wall-clock timeout/);
});
