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
  detachForDestroy, findReusableRoot, buttonLabel, workflowStateLabel, isBoardSurface,
  buildCancelledState, buildAuthExpiredState,
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

test('view instance identity wins while legacy card and target fallback remains stable', () => {
  assert.equal(instanceKeyFor({
    card_id: 'CC-03', card_kind: 'instrument', stk_cd: '005930', view_instance_id: ' conversation 7 / chart ',
  }), 'view:conversation-7-/-chart');
  assert.equal(instanceKeyFor({
    card_id: 'CC-03', card_kind: 'instrument', stk_cd: '005930', viewInstanceId: 'chart:005930',
  }), 'view:chart:005930');
});

test('board surface roots are recognized by the card root mark alone', () => {
  assert.equal(isBoardSurface({ dataset: { boardSurface: 'true' } }), true);
  assert.equal(isBoardSurface({ dataset: { boardSurface: 'false' } }), false);
  assert.equal(isBoardSurface({ dataset: { cardId: 'CC-01' } }), false);
  assert.equal(isBoardSurface(null), false);
});

test('kind mismatch and legacy card ids fail closed', () => {
  assert.equal(integratedDefinition({ card_id: 'ACCOUNT', card_kind: 'account' }), null);
  assert.equal(integratedDefinition({ card_id: 'CC-04', card_kind: 'flow' }), null);
});

test('mode and section form an internal panel key, never another card id', () => {
  assert.equal(panelKeyFor({ mode: 'quote', section: 'overview', capability: 'quote', operation_ref: 'base:ka10001' }), 'quote:overview:quote:base:ka10001');
});

test('ranking mode keeps one panel while its axis operations rotate', () => {
  const highLow = panelKeyFor({ mode: 'ranking', section: 'ranked-results', capability: 'stock-info', operation_ref: 'base:ka10016' });
  const limits = panelKeyFor({ mode: 'ranking', section: 'ranked-results', capability: 'stock-info', operation_ref: 'base:ka10017' });
  assert.equal(highLow, 'ranking:ranked-results');
  assert.equal(highLow, limits);
  // CC-05 순위 탭은 4개 capability(program-trading·credit-lending-short·…)를
  // 한 탭에서 받는다 — capability도 키에서 제외된다.
  const program = panelKeyFor({ mode: 'ranking', section: 'ranked-results', capability: 'program-trading', operation_ref: 'base:ka90003' });
  const credit = panelKeyFor({ mode: 'ranking', section: 'ranked-results', capability: 'credit-lending-short', operation_ref: 'base:kt20016' });
  assert.equal(program, credit);
  assert.equal(buttonLabel({ mode: 'ranking', section: 'ranked-results' }), '순위');
});

test('internal fundamentals taxonomy is presented as an investor-facing Korean tab label', () => {
  assert.equal(buttonLabel({
    section: 'valuation-and-profile',
    presentation_contract: { sections: [{
      section_id: 'valuation-and-profile', title_ko: '가치와 기업 정보',
    }] },
  }), '가치와 기업 정보');
  assert.equal(buttonLabel({
    section: 'fundamentals',
    presentation_contract: { title_ko: '기업 기본 정보와 가치', sections: [] },
  }), '기업 기본 정보와 가치');
});

test('internal panel taxonomy and operation refs never become tab copy', () => {
  for (const token of ['visualization', 'depth-ladder', 'result-table', 'product-detail', 'summary']) {
    assert.equal(buttonLabel({
      section: token, mode: token, capability: token, operation_ref: 'detail:ka10004:buy_bid_prices',
      view_recipe: { title_ko: '종목 분석' },
      presentation_contract: { sections: [{ section_id: token, title_ko: token }] },
    }), '종목 분석');
  }
});

test('order routing and state tokens are localized before reaching product text', () => {
  assert.equal(workflowStateLabel('entry'), '주문 입력');
  assert.equal(workflowStateLabel('draft'), '주문 초안');
  assert.equal(buttonLabel({ mode: 'entry', section: 'draft' }), '요약');
  assert.equal(workflowStateLabel('draft'), '주문 초안');
  assert.equal(workflowStateLabel('review'), '확인 대기');
});

test('websocket lifecycle tokens use allowlisted investor-facing Korean states', () => {
  assert.equal(workflowStateLabel('connecting'), '실시간 연결 중');
  assert.equal(workflowStateLabel('connected'), '실시간 연결됨');
  assert.equal(workflowStateLabel('reconnecting'), '실시간 재연결 중');
  assert.equal(workflowStateLabel('stopped'), '실시간 연결 중지');
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

test('realtime tick reducer gate uses opaque lease identity and both generations', () => {
  const meta = {
    leaseId: 'CC-04:005930', cardId: 'CC-04', mode: 'regular', target: '005930',
    generation: 2, connectionGeneration: 4, operationIds: ['0D'],
  };
  const tick = {
    leaseId: 'CC-04:005930', cardId: 'CC-04', mode: 'regular', target: '005930',
    generation: 2, connectionGeneration: 4, operationId: '0D',
  };
  assert.equal(matchesRealtimeTick(meta, tick), true);
  assert.equal(matchesRealtimeTick(meta, { ...tick, leaseId: 'another-lease' }), false);
  assert.equal(matchesRealtimeTick(meta, { ...tick, cardId: 'CC-03' }), false);
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
  assert.ok(html.indexOf('lib/semantic-workspace.js') < html.indexOf('<script src="canvas.js"'));
  assert.ok(html.indexOf('lib/integrated-card-surface.js') < html.indexOf('<script src="canvas.js"'));
  assert.ok(html.indexOf('lib/paper-card-routing.js') < html.indexOf('<script src="canvas.js"'));
});

test('canvas routes canonical envelopes through one integrated root and semantic workspace', () => {
  const canvas = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  // 디스패치 판정은 lib/paper-card-routing.js가 단독 소유한다 — canvas.js는 결과만 쓴다.
  // 키움 봉투가 레거시 범용 카드로 새지 않는다는 계약을 여기서 함께 고정한다.
  assert.match(canvas, /paperCardRouting\.paperCardRoute\(envelope, \{/);
  assert.match(canvas, /route === 'integrated'/);
  assert.match(canvas, /route === 'workspace'/);
  assert.match(canvas, /route === 'blocked'/);
  assert.match(canvas, /data-integrated-instance-key/);
  assert.match(canvas, /semanticWorkspace\.upsert\(root, envelope\)/);
  assert.match(canvas, /upsertDeveloperDiagnostics\(root, envelope\)/);
  assert.match(canvas, /__ATHENA_DEVELOPER_DIAGNOSTICS__/);
  assert.match(canvas, /semantic-detail-row:not\(\[data-field-occurrence-id\]\)/);
  assert.match(canvas, /athena:integrated-card-realtime-mount/);
  assert.match(canvas, /athena:integrated-card-realtime-update/);
  assert.match(canvas, /athena:integrated-card-realtime-unmount/);
  assert.match(canvas, /integratedCardSurface\.matchesRealtimeTick/);
  assert.match(canvas, /semanticWorkspace\.applyRealtimeTick\(root, tick\)/);
  assert.match(canvas, /candidate\.classList\.contains\('integrated-card'\)/);
  assert.match(canvas, /rendered === existing/);
  assert.match(canvas, /if \(!root\.isConnected && state && state\.ok\)/);
  assert.match(canvas, /integratedRealtimePoliciesPromise = null/);
  assert.match(canvas, /athena:integrated-card-realtime-release-all/);
  assert.match(canvas, /verifiedOperationRefs/);
  assert.match(canvas, /semanticBindingIds/);
  assert.match(canvas, /envelope\.realtime_bindings/);
  assert.match(canvas, /requireRealtimeSuccess\(state\)/);
  assert.match(canvas, /showIntegratedRealtimeError\(root, envelope, error\)/);
  assert.doesNotMatch(canvas, /state\s*&&\s*state\.ok\s*\?[^\n]*:\s*'static'/);
  assert.match(canvas, /panelSessionFor\(integratedRoot, envelope\)/);
  assert.match(canvas, /detachForDestroy\(card\)/);
  assert.match(canvas, /settleCleanup\(realtimeTask\)/);
  assert.ok(canvas.indexOf('for (const destroy of panelDestroyers.values())') < canvas.indexOf('const realtimeCleanup = (async () =>'));

  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /semanticBindingSourceProvider:\s*integratedCardRealtime\.createSemanticBindingSourceProvider/);
  assert.match(main, /token:\s*LOCAL_BEARER_TOKEN/);
});

test('account panel tabs use mode/section Korean labels instead of collapsing to summary', () => {
  assert.equal(buttonLabel({ mode: 'holdings', section: 'holdings' }), '보유종목');
  assert.equal(buttonLabel({ mode: 'balance', section: 'balance' }), '예수금');
  assert.equal(buttonLabel({ mode: 'overview', section: 'other_assets_and_income' }), '기타자산');
  assert.equal(buttonLabel({ mode: 'overview', section: 'other-assets-and-income' }), '기타자산');
  assert.equal(buttonLabel({ mode: 'fills', section: 'fills' }), '체결');
  assert.equal(buttonLabel({ mode: 'orderable' }), '주문가능');
  // Card-level contract title must not overwrite a known section tab.
  assert.equal(buttonLabel({
    mode: 'holdings',
    section: 'holdings',
    presentation_contract: { title_ko: '계좌 통합', sections: [] },
  }), '보유종목');
});

// ---- 화면 P1 항목 17-B/17-C (Paper 1IG3-0) — 중단·인증 만료가 이미 받은 값을 지우지 않는다 ----
test('사용자 취소는 이미 받은 결과를 유지한다', () => {
  const state = buildCancelledState({ partial: [{ ordinal: 1 }, { ordinal: 2 }] });
  assert.equal(state.keepResults, true);
  assert.equal(state.badge, '취소됨');
  assert.equal(state.action, '결과 유지 · 다시 검색');
  assert.equal(state.title, '사용자 취소');
  assert.equal(state.message, '중단했습니다. 이미 받은 값은 그대로 두었습니다.');
});

test('부분 결과가 하나도 없을 때만 빈 취소 카드다', () => {
  const state = buildCancelledState({ partial: [] });
  assert.equal(state.keepResults, false);
  assert.equal(state.badge, '취소됨');
  assert.equal(state.action, '다시 검색');
  assert.equal(state.message, '중단했습니다. 아직 받은 값이 없습니다. 같은 조건으로 다시 검색할 수 있습니다.');
  assert.deepEqual(buildCancelledState(), buildCancelledState({ partial: [] }));
});

test('인증 만료는 이전 값을 읽기 전용으로 남기고 계좌 다시 연결을 준다', () => {
  const facts = ['평가금액 89,760,240원', '8종목', '키움증권 끝 4721'];
  const state = buildAuthExpiredState({ facts });
  assert.equal(state.readOnly, true);
  assert.equal(state.badge, '인증 만료');
  assert.equal(state.action, '계좌 다시 연결');
  assert.deepEqual(state.blocks, ['order', 'newQuery']);
  assert.equal(state.facts.at(-1), '주문과 새 조회는 재연결 후 가능');
  assert.equal(state.facts.at(-2), '이전 값 읽기 전용 유지');
});

test('인증 만료가 이미 그려진 값을 지우지 않는다', () => {
  const facts = ['평가금액 89,760,240원', '8종목'];
  const state = buildAuthExpiredState({ facts });
  assert.equal(state.clearValues, false);
  assert.deepEqual(state.facts.slice(0, 2), facts);
  assert.deepEqual(facts, ['평가금액 89,760,240원', '8종목'], '입력 배열을 제자리에서 바꾸지 않는다');
  assert.deepEqual(buildAuthExpiredState().facts, ['이전 값 읽기 전용 유지', '주문과 새 조회는 재연결 후 가능']);
});

test('인증 만료는 재시도 상태가 아니다 — 다시 시도 버튼이 붙는 상태 집합에 없다', () => {
  const canvas = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  const line = canvas.slice(canvas.indexOf('const REST_RETRY_STATES'));
  assert.match(line.slice(0, 120), /new Set\(\['timeout', 'cancelled', 'error'\]\)/);
  // 만료는 잠그기만 하고 값을 지우지 않는다 — 카드 파괴 경로를 타면 안 된다.
  const applyAt = canvas.indexOf('function applyAuthExpiryToAccountCards');
  assert.ok(applyAt > 0);
  const fn = canvas.slice(applyAt, canvas.indexOf('\n}', applyAt));
  assert.doesNotMatch(fn, /destroyCard|\.remove\(\)|replaceChildren/);
});
