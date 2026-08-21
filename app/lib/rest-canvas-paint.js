(function () {
'use strict';

function isValidCorrelation(value) {
  return !!value
    && typeof value.dataset_id === 'string'
    && value.dataset_id.length >= 1
    && value.dataset_id.length <= 64
    && typeof value.item_id === 'string'
    && value.item_id.length >= 1
    && value.item_id.length <= 128
    && Number.isInteger(value.ordinal)
    && value.ordinal >= 1
    && value.ordinal <= 6;
}

function correlationKey(value) {
  if (!isValidCorrelation(value)) return null;
  return `${value.dataset_id}\u0000${value.item_id}\u0000${value.ordinal}`;
}

async function waitForVisiblePaint(element, {
  requestAnimationFrame: raf = globalThis.requestAnimationFrame,
  visibilityState = () => (globalThis.document ? globalThis.document.visibilityState : 'visible'),
  now = () => globalThis.performance.now(),
  maxFrames = 120,
  timeoutMs = 2500,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  if (!element || typeof element.getBoundingClientRect !== 'function') {
    throw new Error('paint ack 대상 카드가 없다');
  }
  if (typeof raf !== 'function') throw new Error('requestAnimationFrame이 필요하다');
  const startedAt = now();
  const wallClockDeadline = Date.now() + timeoutMs;
  const nextFrame = () => new Promise((resolve, reject) => {
    const remainingMs = wallClockDeadline - Date.now();
    if (remainingMs <= 0) {
      reject(new Error('paint ack wall-clock timeout'));
      return;
    }
    const timer = setTimer(() => reject(new Error('paint ack wall-clock timeout')), remainingMs);
    raf((value) => {
      clearTimer(timer);
      resolve(value);
    });
  });
  for (let frame = 0; frame < maxFrames; frame += 1) {
    await nextFrame();
    const rect = element.getBoundingClientRect();
    if (visibilityState() !== 'visible' || !(rect.width > 0) || !(rect.height > 0)) continue;
    await nextFrame();
    await nextFrame();
    const paintedRect = element.getBoundingClientRect();
    if (visibilityState() === 'visible' && paintedRect.width > 0 && paintedRect.height > 0) {
      return {
        verifiedVisible: true,
        visiblePaintAt: now(),
        waitMs: Math.max(0, now() - startedAt),
        rect: {
          width: paintedRect.width,
          height: paintedRect.height,
          x: paintedRect.x,
          y: paintedRect.y,
        },
      };
    }
  }
  throw new Error('카드가 제한 프레임 안에 실제 표시되지 않았다');
}

const api = { isValidCorrelation, correlationKey, waitForVisiblePaint };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.RestCanvasPaint = api;
}
})();
