'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CARD_DEFINITIONS, integratedDefinition, instanceKeyFor, panelKeyFor, normalizeIdentity,
  specializedClassNames, copySpecializedDatasets,
  matchesRealtimeTick, requireRealtimeSuccess, verifiedOperationRefsFor,
  rememberPanelSession, panelSessionFor, forgetPanelSession,
  detachForDestroy, findReusableRoot,
} = require('./integrated-card-surface');

test('canonical taxonomy has exactly six root surfaces', () => {
  assert.deepEqual(Object.keys(CARD_DEFINITIONS), ['CC-01', 'CC-02', 'CC-03', 'CC-04', 'CC-05', 'CC-06']);
  assert.equal(new Set(Object.values(CARD_DEFINITIONS).map((item) => item.kind)).size, 6);
});

test('instance key is card plus normalized account or target', () => {
  assert.equal(instanceKeyFor({ card_id: 'CC-01', card_kind: 'account', operation_args: { acnt_no: ' 123 45 ' } }), 'CC-01:123-45');
  assert.equal(instanceKeyFor({ card_id: 'CC-03', card_kind: 'instrument', stk_cd: '005930' }), 'CC-03:005930');
  assert.equal(normalizeIdentity(' 삼성 전자 '), '삼성-전자');
});

test('kind mismatch and legacy card ids fail closed', () => {
  assert.equal(integratedDefinition({ card_id: 'ACCOUNT', card_kind: 'account' }), null);
  assert.equal(integratedDefinition({ card_id: 'CC-04', card_kind: 'flow' }), null);
});

test('mode and section form an internal panel key, never another card id', () => {
  assert.equal(panelKeyFor({ mode: 'quote', section: 'overview', capability: 'quote', operation_ref: 'base:ka10001' }), 'quote:overview:quote:base:ka10001');
});

test('renderer passes the production verifiedOperationRefs key without suppressing query refs', () => {
  assert.deepEqual(verifiedOperationRefsFor({ card_id: 'CC-02', operation_refs: ['00', '04'] }), ['00', '04']);
  assert.deepEqual(verifiedOperationRefsFor({ card_id: 'CC-02', operation_ref: 'base:0E' }), ['base:0E']);
  assert.deepEqual(verifiedOperationRefsFor({ card_id: 'CC-03', operation_ref: 'base:ka10081' }), ['base:ka10081']);
});

test('integrated chart root keeps independent A then B sessions and returns A without duplication', () => {
  const root = {};
  const a = { mode: 'chart', section: 'daily', capability: 'chart', operation_ref: 'detail:ka10081:daily' };
  const b = { mode: 'chart', section: 'minute', capability: 'chart', operation_ref: 'detail:ka10080:minute' };
  rememberPanelSession(root, a, { dataset: { chartPanelId: 'panel-a', chartGeneration: '1', rendererId: 'aits-chart-v1' } });
  rememberPanelSession(root, b, { dataset: { chartPanelId: 'panel-b', chartGeneration: '1', rendererId: 'aits-chart-v1' } });
  assert.equal(root.__athenaIntegratedPanelSessions.size, 2);
  assert.equal(panelSessionFor(root, a).panelId, 'panel-a');
  assert.equal(panelSessionFor(root, b).panelId, 'panel-b');
  forgetPanelSession(root, panelKeyFor(a));
  assert.equal(panelSessionFor(root, a), null);
  assert.equal(panelSessionFor(root, b).panelId, 'panel-b');
});

test('clear detaches a dying root before immediate same-card render and clears old sessions', () => {
  const oldRoot = {
    dataset: { integratedInstanceKey: 'CC-03:005930' },
    remove() { this.isConnected = false; },
    isConnected: true,
  };
  rememberPanelSession(oldRoot, { operation_ref: 'detail:ka10081:daily' }, {
    dataset: { chartPanelId: 'panel-old', chartGeneration: '1' },
  });
  detachForDestroy(oldRoot);
  assert.equal(oldRoot.dataset.destroying, 'true');
  assert.equal(oldRoot.isConnected, false);
  assert.equal(oldRoot.__athenaIntegratedPanelSessions.size, 0);
  assert.equal(findReusableRoot([oldRoot], 'CC-03:005930'), null);

  const freshRoot = { dataset: { integratedInstanceKey: 'CC-03:005930' }, isConnected: true };
  assert.equal(findReusableRoot([oldRoot, freshRoot], 'CC-03:005930'), freshRoot);
});

test('integrated root preserves specialized chart/orderbook class contracts', () => {
  assert.deepEqual(
    specializedClassNames('card chart integrated-card w-full', 'card orderbook w-full'),
    ['chart', 'orderbook'],
  );
  const root = { dataset: { cardId: 'CC-03' } };
  copySpecializedDatasets(root, {
    dataset: { chartPanelId: 'panel-1', chartGeneration: '2', rendererId: 'aits-chart-v1', cardId: 'wrong' },
  });
  assert.deepEqual(root.dataset, {
    cardId: 'CC-03', chartPanelId: 'panel-1', chartGeneration: '2', rendererId: 'aits-chart-v1',
  });
});

test('realtime tick reducer gate checks target, operation, and both generations', () => {
  const meta = {
    leaseId: 'CC-04:005930', cardId: 'CC-04', mode: 'regular', target: '005930',
    generation: 2, connectionGeneration: 4, operationIds: ['0D'],
  };
  const tick = {
    leaseId: 'CC-04:005930', cardId: 'CC-04', mode: 'regular', target: '005930',
    generation: 2, connectionGeneration: 4, operationId: '0D',
  };
  assert.equal(matchesRealtimeTick(meta, tick), true);
  assert.equal(matchesRealtimeTick(meta, { ...tick, target: '000660' }), false);
  assert.equal(matchesRealtimeTick(meta, { ...tick, operationId: '0B' }), false);
  assert.equal(matchesRealtimeTick(meta, { ...tick, generation: 1 }), false);
  assert.equal(matchesRealtimeTick(meta, { ...tick, connectionGeneration: 3 }), false);
});

test('mount or update rejection stays a visible retryable error path', () => {
  assert.throws(() => requireRealtimeSuccess({ ok: false, error: 'REG failed' }), /REG failed/);
  assert.throws(() => requireRealtimeSuccess(null), /실시간 등록에 실패/);
  assert.deepEqual(requireRealtimeSuccess({ ok: true, status: 'active' }), { ok: true, status: 'active' });
});

test('shell loads integrated CSS and both libraries before canvas runtime', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'shell.html'), 'utf8');
  assert.ok(html.includes('styles/integrated-cards.css'));
  assert.ok(html.indexOf('lib/semantic-detail-sheet.js') < html.indexOf('<script src="canvas.js"'));
  assert.ok(html.indexOf('lib/integrated-card-surface.js') < html.indexOf('<script src="canvas.js"'));
});

test('canvas routes canonical envelopes through one integrated root and detail sheet', () => {
  const canvas = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  assert.match(canvas, /integratedCardSurface\.integratedDefinition\(envelope\)/);
  assert.match(canvas, /data-integrated-instance-key/);
  assert.match(canvas, /semanticDetailSheet\.upsert\(root, envelope\)/);
  assert.match(canvas, /semantic-detail-row:not\(\[data-field-occurrence-id\]\)/);
  assert.match(canvas, /athena:integrated-card-realtime-mount/);
  assert.match(canvas, /athena:integrated-card-realtime-update/);
  assert.match(canvas, /athena:integrated-card-realtime-unmount/);
  assert.match(canvas, /integratedCardSurface\.matchesRealtimeTick/);
  assert.match(canvas, /semanticDetailSheet\.applyRealtimeTick\(root, tick\)/);
  assert.match(canvas, /candidate\.classList\.contains\('integrated-card'\)/);
  assert.match(canvas, /rendered === existing/);
  assert.match(canvas, /if \(!root\.isConnected && state && state\.ok\)/);
  assert.match(canvas, /integratedRealtimePoliciesPromise = null/);
  assert.match(canvas, /athena:integrated-card-realtime-release-all/);
  assert.match(canvas, /verifiedOperationRefs/);
  assert.match(canvas, /requireRealtimeSuccess\(state\)/);
  assert.match(canvas, /showIntegratedRealtimeError\(root, envelope, error\)/);
  assert.doesNotMatch(canvas, /state\s*&&\s*state\.ok\s*\?[^\n]*:\s*'static'/);
  assert.match(canvas, /panelSessionFor\(integratedRoot, envelope\)/);
  assert.match(canvas, /detachForDestroy\(card\)/);
  assert.match(canvas, /settleCleanup\(realtimeTask\)/);
  assert.ok(canvas.indexOf('for (const destroy of panelDestroyers.values())') < canvas.indexOf('const realtimeCleanup = (async () =>'));
});
