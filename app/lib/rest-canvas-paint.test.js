'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  correlationKey, isValidCorrelation, waitForVisiblePaint,
  decidePaintAck, timedOutPaint, upsertRestReceipt, PENDING_MOUNT_ACK_TIMEOUT_MS,
} = require('./rest-canvas-paint');

test('correlation key requires complete dataset/item/ordinal identity', () => {
  const valid = { dataset_id: 'd', item_id: 'i', ordinal: 6 };
  assert.equal(isValidCorrelation(valid), true);
  assert.equal(correlationKey(valid), 'd\u0000i\u00006');
  assert.equal(correlationKey({ dataset_id: 'd', item_id: 'i', ordinal: 7 }), null);
  assert.equal(correlationKey({ dataset_id: 'd', ordinal: 1 }), null);
});

test('같은 receipt ID의 최종 결과는 로딩 문구를 교체하고 다른 요청은 건드리지 않는다', () => {
  const makeElement = () => ({
    className: '',
    dataset: {},
    children: [],
    appendChild(child) { this.children.push(child); },
    querySelector(selector) {
      return this.children.find((child) => selector === '.turn-a' && child.className === 'turn-a') || null;
    },
  });
  const history = makeElement();
  history.querySelectorAll = (selector) => history.children
    .filter((child) => selector === '.rest-receipt' && child.className.includes('rest-receipt'));

  const first = upsertRestReceipt(history, {
    receiptId: 'receipt-1', text: '데이터를 불러오는 중입니다...', createElement: makeElement,
  });
  const second = upsertRestReceipt(history, {
    receiptId: 'receipt-2', text: '데이터를 불러오는 중입니다...', createElement: makeElement,
  });
  const updated = upsertRestReceipt(history, {
    receiptId: 'receipt-1', text: '캔버스에 표시했습니다.', createElement: makeElement,
    replaceOnly: true,
  });
  const missing = upsertRestReceipt(history, {
    receiptId: 'receipt-missing', text: '늦은 결과', createElement: makeElement, replaceOnly: true,
  });

  assert.equal(updated, first);
  assert.equal(missing, null);
  assert.equal(history.children.length, 2);
  assert.equal(first.querySelector('.turn-a').textContent, '캔버스에 표시했습니다.');
  assert.equal(second.querySelector('.turn-a').textContent, '데이터를 불러오는 중입니다...');

  for (const finalText of [
    '조회 중 오류가 발생했습니다. 다시 시도할 수 있습니다.',
    '조회가 취소되었습니다. 다시 시도할 수 있습니다.',
  ]) {
    upsertRestReceipt(history, {
      receiptId: 'receipt-2', text: finalText, createElement: makeElement, replaceOnly: true,
    });
    assert.equal(second.querySelector('.turn-a').textContent, finalText);
    assert.equal(second.querySelector('.turn-a').textContent.includes('불러오는 중'), false);
  }
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

// ---------- 차트 껍질 먼저, 마운트 결과는 나중 (P1 2026-09-05) ----------
// 차트 카드는 3초 첫 피드백 계약 때문에 껍질만 붙인 채 ack를 보낸다. 그 ack에
// 낙관적 'data'를 실으면 마운트에 실패한 차트가 데이터 카드로 집계된다. 첫 ack는
// pending으로 나가고, 마운트 결과 ack가 최종 상태를 정한다.

const firstAck = {
  verified_visible: true,
  render_state: 'loading',
  pending: true,
  renderer_id: 'aits-chart-v1',
  panel_id: 'panel-1',
  generation: 3,
  inline_to_dom_ms: 40,
  dom_to_paint_ack_ms: 18,
  inline_to_chart_import_ms: 12,
  chart_import_to_dom_ms: 9,
  rect: { width: 400, height: 200, x: 0, y: 0 },
};

test('첫 ack가 pending이면 결론을 미루고 계측만 확정한다', () => {
  const decision = decidePaintAck(firstAck, { now: () => 1234 });
  assert.equal(decision.action, 'defer');
  assert.equal(decision.paint.renderState, 'loading');
  assert.equal(decision.paint.visiblePaintAt, 1234);
  assert.equal(decision.paint.inlineToDomMs, 40);
  assert.equal(decision.paint.domToPaintAckMs, 18);
  assert.equal(decision.paint.panelId, 'panel-1');
});

test('마운트 결과 ack가 첫 ack의 시각을 유지한 채 최종 상태를 확정한다', () => {
  const pendingPaint = decidePaintAck(firstAck, { now: () => 1234 }).paint;
  const settled = decidePaintAck({
    verified_visible: true,
    render_state: 'data',
    pending: false,
    renderer_id: 'aits-chart-v1',
    panel_id: 'panel-1',
    generation: 3,
  }, { pendingPaint, now: () => 9999 });
  assert.equal(settled.action, 'settle');
  assert.equal(settled.paint.renderState, 'data');
  // 첫 피드백 시각은 껍질이 뜬 순간이다 — 3초 계약은 여기서 판정된다.
  assert.equal(settled.paint.visiblePaintAt, 1234);
  assert.equal(settled.paint.inlineToDomMs, 40);
  assert.equal(settled.paint.domToPaintAckMs, 18);
  assert.equal(settled.paint.rect.width, 400);
});

test('마운트 실패 ack는 낙관값 없이 error로 정착한다', () => {
  const pendingPaint = decidePaintAck(firstAck, { now: () => 1234 }).paint;
  const settled = decidePaintAck({
    verified_visible: true, render_state: 'error', pending: false,
  }, { pendingPaint, now: () => 9999 });
  assert.equal(settled.action, 'settle');
  assert.equal(settled.paint.renderState, 'error');
  assert.equal(settled.paint.panelId, 'panel-1');
});

test('한도를 넘긴 pending은 data가 아니라 timeout으로 집계된다', () => {
  const pendingPaint = decidePaintAck(firstAck, { now: () => 1234 }).paint;
  const timedOut = timedOutPaint(pendingPaint);
  assert.equal(timedOut.renderState, 'timeout');
  assert.equal(timedOut.visiblePaintAt, 1234);
  assert.notEqual(pendingPaint.renderState, 'timeout');
});

test('동일 correlation의 늦은 최종 ack는 30초 한도 안에서 pending을 data로 확정한다', () => {
  const correlation = { dataset_id: 'dataset-1', item_id: 'item-1', ordinal: 1 };
  const key = correlationKey(correlation);
  const pendingPaint = decidePaintAck(firstAck, { now: () => 0 }).paint;
  const waiters = new Map();
  let settledPaint = null;
  let timedOut = false;
  let pendingTimer = null;
  const setVirtualTimer = (callback, delay) => {
    pendingTimer = { at: delay, callback };
    return pendingTimer;
  };
  const clearVirtualTimer = (timer) => {
    if (pendingTimer === timer) pendingTimer = null;
  };
  const advanceTo = (nowMs) => {
    if (!pendingTimer || pendingTimer.at > nowMs) return;
    const timer = pendingTimer;
    pendingTimer = null;
    timer.callback();
  };

  const timeout = setVirtualTimer(() => {
    timedOut = true;
    settledPaint = timedOutPaint(pendingPaint);
    waiters.delete(key);
  }, PENDING_MOUNT_ACK_TIMEOUT_MS);
  waiters.set(key, { pendingPaint, timeout });

  advanceTo(20_000);
  assert.equal(timedOut, false);
  const finalCorrelation = { dataset_id: 'dataset-1', item_id: 'item-1', ordinal: 1 };
  const waiter = waiters.get(correlationKey(finalCorrelation));
  assert.ok(waiter);
  const finalDecision = decidePaintAck({
    verified_visible: true,
    render_state: 'data',
    pending: false,
    renderer_id: 'aits-chart-v1',
    panel_id: 'panel-1',
    generation: 3,
  }, { pendingPaint: waiter.pendingPaint, now: () => 20_000 });
  clearVirtualTimer(waiter.timeout);
  waiters.delete(key);
  settledPaint = finalDecision.paint;

  advanceTo(PENDING_MOUNT_ACK_TIMEOUT_MS);
  assert.equal(finalDecision.action, 'settle');
  assert.equal(timedOut, false);
  assert.equal(waiters.size, 0);
  assert.equal(settledPaint.renderState, 'data');
  assert.equal(settledPaint.visiblePaintAt, 0);
});

test('pending이 아닌 카드는 첫 ack에서 곧바로 정착한다', () => {
  const decision = decidePaintAck({
    verified_visible: true, render_state: 'data', inline_to_dom_ms: 5, dom_to_paint_ack_ms: 6,
  }, { now: () => 7 });
  assert.equal(decision.action, 'settle');
  assert.equal(decision.paint.renderState, 'data');
  assert.equal(decision.paint.generation, null);
});

test('표시되지 않은 카드는 pending 여부와 무관하게 거절한다', () => {
  const decision = decidePaintAck({ verified_visible: false, pending: true, error: '차트를 그리지 못했다' }, { now: () => 1 });
  assert.equal(decision.action, 'reject');
  assert.equal(decision.paint, null);
  assert.match(decision.message, /차트를 그리지 못했다/);
});

test('pending 대기는 main의 paint waiter 배선에 실제로 걸려 있다', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const handler = mainSource.slice(
    mainSource.indexOf("ipcMain.on('athena:rest-canvas-painted'"),
    mainSource.indexOf("ipcMain.on('athena:rest-receipt-painted'"),
  );
  assert.match(handler, /decidePaintAck\(payload/);
  assert.match(handler, /decision\.action === 'defer'[\s\S]*beginPendingMount/);
  assert.match(handler, /beginPendingMount\(\(\) => \{[\s\S]*resolve\(timedOutPaint\(/);
  // 결론(권위 등록·실시간 REG)은 defer 뒤에서만 내린다.
  assert.ok(handler.indexOf('registerPaint') > handler.indexOf("decision.action === 'defer'"));
  assert.ok(handler.indexOf('ensureChartRealtime') > handler.indexOf("decision.action === 'defer'"));
  assert.match(mainSource, /PENDING_MOUNT_ACK_TIMEOUT_MS/);
  assert.match(mainSource, /beginPendingMount\(onTimeout\)/);
  // pending으로 미루는 동안에도 첫 피드백은 이미 도달했다 — 러너의 3초 마감과
  // 지연 영수증 워치독은 defer 시점에 풀린다.
  assert.match(handler, /decision\.action === 'defer'[\s\S]*notifyFirstPaint\(decision\.paint\)/);
  assert.match(mainSource, /notifyFirstPaint: typeof payload\.onFirstPaint === 'function'/);
  assert.match(mainSource, /event\.type === 'paint-ack' \|\| event\.type === 'paint-pending'\)\) feedbackObserved = true/);
  // 무한 대기는 3초 계약 뒤에 답변을 영원히 붙잡는다 — 한도는 유한하다.
  assert.equal(Number.isInteger(PENDING_MOUNT_ACK_TIMEOUT_MS), true);
  assert.equal(PENDING_MOUNT_ACK_TIMEOUT_MS, 30_000);
});

test('main은 로딩 receipt를 같은 ID의 최종 결과로 교체하고 ack revision을 검증한다', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const direct = mainSource.slice(
    mainSource.indexOf('async function runDirectRestDataset('),
    mainSource.indexOf('async function handleChartPanelReload('),
  );
  assert.match(direct, /'데이터를 불러오는 중입니다\.\.\.'/);
  assert.doesNotMatch(direct, /조회가 지연되어 아직 화면 데이터를 표시하지 못했습니다/);
  assert.equal((direct.match(/receiptId: watchdogReceiptId/g) || []).length, 2);
  assert.match(direct, /replaceOnly: true/);
  assert.match(direct, /historyConversationId\(\) !== turnConversationId/);
  assert.match(direct, /historyConversationId\(\) === turnConversationId/);
  assert.match(direct, /if \(watchdogReceipt\) \{[\s\S]*if \(historyConversationId\(\) === turnConversationId\)/);
  assert.match(direct, /firstCanvasDeadlineMs: DIRECT_DATASET_SETTLE_TIMEOUT_MS/);
  assert.match(mainSource, /String\(payload\.receipt_revision \|\| ''\) !== waiter\.revision/);
  assert.match(mainSource, /restReceiptWaiters\.get\(stableReceiptId\) !== waiter/);
  assert.match(mainSource, /receiptRevision,[\s\S]*text,/);
});
