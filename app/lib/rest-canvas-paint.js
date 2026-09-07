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

// 숨은 동안 예산을 쓰지 않기 위해 얼마나 자주 되보는지. 타이머는 숨은 창에서도
// 돌지만 rAF는 아예 멈춘다 — 그래서 대기 수단이 타이머여야 한다.
const HIDDEN_POLL_MS = 100;

async function waitForVisiblePaint(element, {
  requestAnimationFrame: raf = globalThis.requestAnimationFrame,
  visibilityState = () => (globalThis.document ? globalThis.document.visibilityState : 'visible'),
  now = () => globalThis.performance.now(),
  maxFrames = 120,
  timeoutMs = 2500,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
  // 창이 계속 숨어 있으면 언젠가는 접어야 한다. 이 한도는 "표시를 확인할 기회"의
  // 상한이지 렌더 예산이 아니다 — 그래서 rAF 예산(timeoutMs)보다 훨씬 길다.
  maxHiddenMs = 60_000,
} = {}) {
  if (!element || typeof element.getBoundingClientRect !== 'function') {
    throw new Error('paint ack 대상 카드가 없다');
  }
  if (typeof raf !== 'function') throw new Error('requestAnimationFrame이 필요하다');
  const startedAt = now();
  let wallClockDeadline = Date.now() + timeoutMs;
  let hiddenMs = 0;
  // 창이 숨어 있는 동안은 "안 그려졌다"가 아니라 "볼 수 없어서 확인할 수 없다"다.
  // Chromium은 숨은/가려진 창의 rAF를 멈추므로, 이 시간을 예산에 넣으면 창이 뒤로
  // 밀린 순간에 도착한 카드가 통째로 실패 카드가 된다(실측: 다른 창이 덮은 사이
  // paint ack wall-clock timeout → verified_visible false → 재시도 영수증).
  // 그래서 숨은 시간은 예산에서 빼고(deadline을 그만큼 미룬다) 창이 돌아오면
  // 그 자리에서 확인을 이어 간다. 확인 자체를 느슨하게 하지는 않는다 — 보이는
  // 상태에서 두 프레임을 다시 재는 규칙은 그대로다.
  const waitWhileHidden = async () => {
    while (visibilityState() !== 'visible') {
      if (hiddenMs >= maxHiddenMs) {
        const error = new Error(`paint ack: 창이 숨어 있어 표시를 확인하지 못했다(hidden ${hiddenMs}ms)`);
        error.reason = 'hidden';
        throw error;
      }
      await new Promise((resolve) => setTimer(resolve, HIDDEN_POLL_MS));
      hiddenMs += HIDDEN_POLL_MS;
      wallClockDeadline += HIDDEN_POLL_MS;
    }
  };
  const nextFrame = async () => {
    await waitWhileHidden();
    return new Promise((resolve, reject) => {
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
  };
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
        // 계측은 사용자가 **볼 수 있었던** 시간만 센다 — 숨은 시간은 렌더 지연이
        // 아니다. 호출부가 dom→ack 구간에서 이 값을 뺀다.
        hiddenMs,
        waitMs: Math.max(0, now() - startedAt - hiddenMs),
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
const PENDING_MOUNT_ACK_TIMEOUT_MS = 30_000;

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

function upsertRestReceipt(history, { receiptId, text, createElement, replaceOnly = false } = {}) {
  if (!history || typeof history.querySelectorAll !== 'function' || typeof history.appendChild !== 'function') {
    throw new Error('REST 영수증 이력 영역이 필요하다');
  }
  const stableId = String(receiptId || '');
  if (!stableId) throw new Error('REST 영수증 ID가 필요하다');
  const makeElement = typeof createElement === 'function'
    ? createElement
    : (tagName) => history.ownerDocument.createElement(tagName);
  let line = Array.from(history.querySelectorAll('.rest-receipt'))
    .find((candidate) => candidate && candidate.dataset && candidate.dataset.receiptId === stableId);
  let body = line && typeof line.querySelector === 'function' ? line.querySelector('.turn-a') : null;
  if (!line && replaceOnly) return null;
  if (!line) {
    line = makeElement('div');
    line.className = 'turn rest-receipt';
    line.dataset.receiptId = stableId;
    body = makeElement('div');
    body.className = 'turn-a';
    line.appendChild(body);
    history.appendChild(line);
  }
  if (!body) throw new Error('REST 영수증 본문이 없다');
  body.textContent = String(text || '캔버스에 표시하지 못했습니다.');
  return line;
}

const api = {
  isValidCorrelation,
  correlationKey,
  waitForVisiblePaint,
  decidePaintAck,
  timedOutPaint,
  upsertRestReceipt,
  PENDING_MOUNT_ACK_TIMEOUT_MS,
  HIDDEN_POLL_MS,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.RestCanvasPaint = api;
}
})();
