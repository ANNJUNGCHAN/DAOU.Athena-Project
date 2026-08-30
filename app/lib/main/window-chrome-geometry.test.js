'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { pointInRect, validateGeometryUpdate } = require('./window-chrome-geometry');

const hidden = { visible: false, titlebar: null, controls: null, zoomFactor: 1, generation: null, revision: 0 };
function payload(overrides = {}) {
  return {
    generation: 'renderer-a', revision: 1, zoomFactor: 1,
    viewport: { width: 800, height: 600 }, visible: true,
    titlebar: { x: 0, y: 0, width: 800, height: 26 },
    controls: { x: 690, y: 7, width: 98, height: 24 },
    ...overrides,
  };
}

test('LIFE-002: geometry validates current viewport and converts CSS rects using current zoom', () => {
  for (const zoomFactor of [0.5, 1, 2]) {
    const cssWidth = 800 / zoomFactor;
    const result = validateGeometryUpdate({
      current: hidden,
      payload: payload({
        zoomFactor,
        viewport: { width: cssWidth, height: 600 / zoomFactor },
        titlebar: { x: 0, y: 0, width: cssWidth, height: 26 },
        controls: { x: cssWidth - 110, y: 7, width: 98, height: 24 },
      }),
      zoomFactor,
      contentBounds: { width: 800, height: 600 },
    });
    assert.equal(result.accepted, true);
    assert.equal(result.geometry.titlebar.width, 800);
  }
});

test('LIFE-002: stale, cross-generation, out-of-range and zoom-mismatched geometry fail closed', () => {
  const current = validateGeometryUpdate({
    current: hidden, payload: payload(), zoomFactor: 1, contentBounds: { width: 800, height: 600 },
  }).geometry;
  assert.equal(validateGeometryUpdate({ current, payload: payload(), zoomFactor: 1, contentBounds: { width: 800, height: 600 } }).stale, true);
  for (const bad of [
    payload({ generation: 'renderer-b', revision: 2 }),
    payload({ revision: 2, zoomFactor: 2 }),
    payload({ revision: 2, titlebar: { x: -1, y: 0, width: 800, height: 26 } }),
    payload({ revision: 2, controls: { x: 790, y: 0, width: 20, height: 20 } }),
    payload({ revision: 2, viewport: { width: Number.POSITIVE_INFINITY, height: 600 } }),
  ]) {
    const result = validateGeometryUpdate({ current, payload: bad, zoomFactor: 1, contentBounds: { width: 800, height: 600 } });
    assert.equal(result.accepted, false);
    assert.equal(result.geometry.visible, false);
  }
});

test('LIFE-002: renderer and authoritative zoom factors must be raw finite numbers in range', () => {
  for (const badZoomFactor of [undefined, Number.NaN, Number.POSITIVE_INFINITY, '1', 0, 0.1, 6]) {
    const rendererResult = validateGeometryUpdate({
      current: hidden,
      payload: payload({ zoomFactor: badZoomFactor }),
      zoomFactor: 1,
      contentBounds: { width: 800, height: 600 },
    });
    assert.equal(rendererResult.accepted, false, `renderer zoom ${String(badZoomFactor)} must be rejected`);
    assert.equal(rendererResult.geometry.visible, false);

    const authoritativeResult = validateGeometryUpdate({
      current: hidden,
      payload: payload(),
      zoomFactor: badZoomFactor,
      contentBounds: { width: 800, height: 600 },
    });
    assert.equal(authoritativeResult.accepted, false, `authoritative zoom ${String(badZoomFactor)} must be rejected`);
    assert.equal(authoritativeResult.geometry.visible, false);
  }
});

test('LIFE-002: titlebar hit-test excludes controls and content below', () => {
  const result = validateGeometryUpdate({
    current: hidden, payload: payload(), zoomFactor: 1, contentBounds: { width: 800, height: 600 },
  }).geometry;
  assert.equal(pointInRect({ x: 100, y: 13 }, result.titlebar), true);
  assert.equal(pointInRect({ x: 700, y: 13 }, result.controls), true);
  assert.equal(pointInRect({ x: 100, y: 40 }, result.titlebar), false);
});
