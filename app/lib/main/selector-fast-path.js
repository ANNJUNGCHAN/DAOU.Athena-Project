const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

const DEFAULT_DEADLINE_MS = 2700;
const EXPECTED_ORDER_REFS = Object.freeze({ buy: 'base:kt10000', sell: 'base:kt10001' });
const FALLTHROUGH_STATUSES = new Set([
  'needs_inference',
  'ambiguous',
  'invalid_arguments',
  'missing_arguments',
  'arguments_required',
]);

class SelectorFastPathError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SelectorFastPathError';
    this.code = code;
  }
}

function abortError(signal) {
  if (signal && signal.reason instanceof Error) return signal.reason;
  const error = new Error('Selector fast path가 중단됐다');
  error.name = 'AbortError';
  return error;
}

function ensureCurrent(signal, isCurrent) {
  if ((signal && signal.aborted) || (typeof isCurrent === 'function' && !isCurrent())) {
    throw abortError(signal);
  }
}

function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('ko-KR').trim();
}

function buildMarketOrderDraft(question, stockEntityIndex) {
  if (!stockEntityIndex || typeof stockEntityIndex.resolveQuery !== 'function') return null;
  const text = String(question || '').normalize('NFKC').trim();
  const match = text.match(/^(.+?)\s+(\d{1,9})\s*주(?:를|을)?\s*시장가(?:로)?\s*(매수|매도)(?:\s*(?:해\s*줘|해주세요|해줘|해\s*주세요|부탁해|부탁해요|주문해줘|주문해주세요))?[.!?]?$/u);
  if (!match) return null;

  const entityText = match[1].trim();
  const entity = stockEntityIndex.resolveQuery(entityText);
  if (!entity || entity.kind !== 'stock') return null;
  if (typeof stockEntityIndex.aliasesForEntity === 'function') {
    const normalizedEntityText = normalizeText(entityText);
    const exactAlias = stockEntityIndex.aliasesForEntity(entity)
      .some((alias) => normalizeText(alias) === normalizedEntityText);
    if (!exactAlias) return null;
  }

  const quantity = Number(match[2]);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000) return null;
  const side = match[3] === '매수' ? 'buy' : 'sell';
  return {
    intent: 'order',
    expectedOperationRef: EXPECTED_ORDER_REFS[side],
    arguments: {
      dmst_stex_tp: 'KRX',
      stk_cd: entity.code,
      ord_qty: String(quantity),
      trde_tp: '3',
    },
    side,
  };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    throw new SelectorFastPathError('invalid_json', 'Selector dispatch 응답이 JSON이 아니다');
  }
}

function correlationMatches(actual, expected) {
  return !!actual
    && actual.dataset_id === expected.dataset_id
    && actual.item_id === expected.item_id
    && Number(actual.ordinal) === expected.ordinal;
}

function verifyInlineQuery(body, expected) {
  if (!body || body.delivery !== 'inline' || body.queued !== false
      || !['rendered', 'error_rendered'].includes(body.status)) {
    throw new SelectorFastPathError('invalid_inline_response', 'Selector dispatch가 inline 조회 계약을 지키지 않았다');
  }
  if (body.kind && body.kind !== 'query') {
    throw new SelectorFastPathError('operation_kind_mismatch', 'Selector dispatch가 조회가 아닌 operation을 반환했다');
  }
  if (Object.hasOwn(body, 'plan_token')) {
    throw new SelectorFastPathError('unexpected_plan_token', 'Selector fast path 응답에 plan_token이 포함됐다');
  }
  if (!body.operation_ref || !/^(?:base:(?:ka|kt)\d+|detail:(?:ka|kt)\d+:[a-z0-9_]+)$/i.test(body.operation_ref)
      || /^base:kt1\d{4}$/i.test(body.operation_ref) || body.operation_ref === 'base:ka10001') {
    throw new SelectorFastPathError('ineligible_operation', 'Selector dispatch가 허용되지 않은 조회 operation을 반환했다');
  }
  if (!body.envelope || typeof body.envelope !== 'object') {
    throw new SelectorFastPathError('missing_envelope', 'Selector dispatch inline 응답에 envelope가 없다');
  }
  if (!body.canvas_type || body.envelope.canvas_type !== body.canvas_type) {
    throw new SelectorFastPathError('canvas_mismatch', 'Selector dispatch 카드 계약이 일치하지 않는다');
  }
  if (!body.screen_id || body.envelope.screen_id !== body.screen_id) {
    throw new SelectorFastPathError('screen_mismatch', 'Selector dispatch 화면 계약이 일치하지 않는다');
  }
  const correlation = body.correlation || body.envelope.correlation;
  if (!correlationMatches(correlation, expected) || !correlationMatches(body.envelope.correlation, expected)) {
    throw new SelectorFastPathError('correlation_mismatch', 'Selector dispatch correlation이 요청과 일치하지 않는다');
  }
  return body;
}

function verifyGuardedOrder(body, orderDraft) {
  if (!body || body.status !== 'guarded'
      || (body.kind != null && body.kind !== 'order')
      || (body.guarded != null && body.guarded !== true)) {
    throw new SelectorFastPathError('invalid_order_response', 'Selector dispatch가 guarded order 계약을 지키지 않았다');
  }
  if (Object.hasOwn(body, 'plan_token')) {
    throw new SelectorFastPathError('unexpected_plan_token', 'guarded order 응답에 plan_token이 포함됐다');
  }
  if (body.operation_ref !== orderDraft.expectedOperationRef) {
    throw new SelectorFastPathError('operation_mismatch', 'Selector dispatch 주문 operation이 요청 방향과 일치하지 않는다');
  }
  if (body.next_actions != null
      && (!Array.isArray(body.next_actions) || !body.next_actions.includes('open_order_ticket'))) {
    throw new SelectorFastPathError('missing_order_action', 'guarded order 응답에 주문확인 동작이 없다');
  }
  const returnedDraft = body.order_draft;
  if (!returnedDraft || Object.entries(orderDraft.arguments)
    .some(([key, value]) => String(returnedDraft[key]) !== String(value))) {
    throw new SelectorFastPathError('order_draft_mismatch', 'Selector dispatch 주문 초안이 요청과 일치하지 않는다');
  }
  return body;
}

async function runSelectorFastPath({
  question,
  backendBase,
  intent = 'auto',
  arguments: operationArguments = {},
  candidateRefs = [],
  preferredRef = null,
  detailGroup = null,
  orderDraft = null,
  fetchImpl = globalThis.fetch,
  emitCanvas = async () => ({}),
  emitOrderDraft = () => {},
  persistTurn = () => {},
  signal,
  isCurrent = () => true,
  idFactory = () => crypto.randomUUID(),
  clock = () => performance.now(),
  deadlineMs = DEFAULT_DEADLINE_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl이 필요하다');
  const rawQuestion = String(question || '');
  if (!rawQuestion.trim()) throw new TypeError('question이 필요하다');
  const datasetId = `selector-${idFactory()}`;
  const itemId = `selector-${idFactory()}`;
  const correlation = { dataset_id: datasetId, item_id: itemId, ordinal: 1 };
  const startedAt = clock();
  ensureCurrent(signal, isCurrent);

  const response = await fetchImpl(`${String(backendBase || '').replace(/\/$/, '')}/api/v1/selector/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      question: rawQuestion,
      intent,
      candidate_refs: Array.isArray(candidateRefs) ? candidateRefs : [],
      ...(preferredRef ? { preferred_ref: preferredRef } : {}),
      ...(detailGroup ? { detail_group: detailGroup } : {}),
      arguments: operationArguments,
      response_mode: 'auto',
      continuation: { cont_yn: 'N', next_key: null },
      ...correlation,
      deadline_ms: deadlineMs,
    }),
  });
  ensureCurrent(signal, isCurrent);
  if (!response || !response.ok) {
    return { handled: false, reason: `http_${response ? response.status : 'unknown'}` };
  }
  const body = await readJson(response);
  ensureCurrent(signal, isCurrent);

  if (FALLTHROUGH_STATUSES.has(String(body && body.status || '').toLowerCase())) {
    const status = String(body.status).toLowerCase();
    if (status === 'needs_inference' && !Object.hasOwn(body, 'plan_token') && Array.isArray(body.candidates)) {
      return {
        handled: false,
        reason: status,
        preflight: {
          status,
          catalog_version: body.catalog_version || null,
          suggested_intent: body.suggested_intent || null,
          candidates: body.candidates.slice(0, 3),
        },
      };
    }
    return { handled: false, reason: status };
  }

  if (orderDraft) {
    const verified = verifyGuardedOrder(body, orderDraft);
    ensureCurrent(signal, isCurrent);
    const sanitizedDraft = Object.freeze({
      ...orderDraft.arguments,
      side: orderDraft.side,
    });
    await emitOrderDraft({
      status: 'guarded',
      operation_ref: verified.operation_ref,
      order_draft: sanitizedDraft,
    });
    ensureCurrent(signal, isCurrent);
    const answerText = '주문 내용을 확인해 주세요.';
    await persistTurn({ question: rawQuestion, answerText });
    return {
      handled: true,
      ok: true,
      source: 'selector-fast',
      error: null,
      answerText,
      canvasTypes: [],
      operationRef: verified.operation_ref,
      durationMs: Math.max(0, clock() - startedAt),
      modelCalls: 0,
      guardedOrder: true,
    };
  }

  if (body && ['guarded', 'acknowledged'].includes(body.status)) {
    return { handled: false, reason: body.status };
  }
  const verified = verifyInlineQuery(body, correlation);
  if (preferredRef && verified.operation_ref !== preferredRef) {
    throw new SelectorFastPathError(
      'preferred_operation_mismatch',
      'Selector dispatch 결과가 분류기가 선택한 operation과 일치하지 않는다',
    );
  }
  const inlineAt = clock();
  ensureCurrent(signal, isCurrent);
  const paint = await emitCanvas({
    datasetId,
    itemId,
    ordinal: 1,
    operationRef: verified.operation_ref,
    operationArgs: verified.operation_args || {},
    canvasType: verified.canvas_type,
    envelope: verified.envelope,
    requestStartedAt: startedAt,
    inlineAt,
    paintDeadlineAt: startedAt + 3000,
    firstFeedbackPending: true,
    signal,
  });
  ensureCurrent(signal, isCurrent);
  const queryOk = verified.status === 'rendered';
  const answerText = queryOk
    ? '조회 결과를 카드로 표시했습니다.'
    : '조회 결과를 가져오지 못했습니다. 카드의 오류 상태를 확인해 주세요.';
  await persistTurn({ question: rawQuestion, answerText });
  return {
    handled: true,
    ok: queryOk,
    source: 'selector-fast',
    error: queryOk ? null : (verified.code || 'selector_dispatch_error'),
    answerText,
    canvasTypes: [verified.canvas_type],
    canvasCaptions: [verified.envelope.card_title || verified.envelope.caption].filter(Boolean),
    operationRef: verified.operation_ref,
    firstCanvasMs: Math.max(0, (Number(paint && paint.visiblePaintAt) || clock()) - startedAt),
    durationMs: Math.max(0, clock() - startedAt),
    modelCalls: 0,
  };
}

module.exports = {
  DEFAULT_DEADLINE_MS,
  SelectorFastPathError,
  buildMarketOrderDraft,
  runSelectorFastPath,
};
