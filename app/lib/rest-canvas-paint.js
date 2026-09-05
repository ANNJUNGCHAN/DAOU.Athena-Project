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

// 차트 카드는 3초 첫 피드백 계약 때문에 껍질만 붙인 채 첫 ack를 보내고 패널은
// 뒤에서 채운다. 그 ack에 낙관적 'data'를 실으면 마운트에 실패한 차트가 데이터
// 카드로 집계된다(권위 등록·실시간 REG까지 따라간다). 그래서 첫 ack는 pending으로
// 나가고, 마운트 결과 ack가 최종 render_state를 정한다. 시각·구간 계측은 첫 ack가
// 정본이다 — 사용자가 실제로 무언가를 본 시점이 그때다.
const PENDING_MOUNT_ACK_TIMEOUT_MS = 8000;

function paintFromPayload(payload, now) {
  return {
    verifiedVisible: true,
    visiblePaintAt: now(),
    inlineToDomMs: Number(payload.inline_to_dom_ms) || 0,
    inlineToChartImportMs: payload.inline_to_chart_import_ms == null ? null : Number(payload.inline_to_chart_import_ms),
    chartImportToDomMs: payload.chart_import_to_dom_ms == null ? null : Number(payload.chart_import_to_dom_ms),
    domToPaintAckMs: Number(payload.dom_to_paint_ack_ms) || 0,
    renderState: payload.render_state || null,
    rendererId: payload.renderer_id || null,
    panelId: payload.panel_id || null,
    generation: payload.generation != null && Number.isInteger(Number(payload.generation)) ? Number(payload.generation) : null,
    rect: payload.rect || null,
  };
}

function decidePaintAck(payload, { pendingPaint = null, now = () => 0 } = {}) {
  if (!payload || !payload.verified_visible) {
    return {
      action: 'reject',
      paint: null,
      message: (payload && payload.error) || 'REST 카드가 실제 표시되지 않았다',
    };
  }
  if (!pendingPaint) {
    const paint = paintFromPayload(payload, now);
    return { action: payload.pending === true ? 'defer' : 'settle', paint };
  }
  // 후속 ack는 상태와 패널 신원만 갱신한다. 계측은 첫 ack 값을 그대로 쓴다.
  return {
    action: 'settle',
    paint: Object.assign({}, pendingPaint, {
      renderState: payload.render_state || null,
      rendererId: payload.renderer_id || pendingPaint.rendererId,
      panelId: payload.panel_id || pendingPaint.panelId,
      generation: payload.generation != null && Number.isInteger(Number(payload.generation))
        ? Number(payload.generation) : pendingPaint.generation,
    }),
  };
}

function timedOutPaint(pendingPaint) {
  return Object.assign({}, pendingPaint, { renderState: 'timeout' });
}

const api = {
  isValidCorrelation,
  correlationKey,
  waitForVisiblePaint,
  decidePaintAck,
  timedOutPaint,
  PENDING_MOUNT_ACK_TIMEOUT_MS,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.RestCanvasPaint = api;
}
})();
