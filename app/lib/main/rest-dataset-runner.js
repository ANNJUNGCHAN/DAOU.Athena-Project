'use strict';

const { performance } = require('node:perf_hooks');

const MAX_ITEMS = 6;
const MAX_CONCURRENCY = 3;
const DEFAULT_FIRST_CANVAS_DEADLINE_MS = 3000;
const BACKEND_MAX_DEADLINE_MS = 2700;
const BACKEND_MIN_DEADLINE_MS = 100;
const PRIMARY_UPSTREAM_DEADLINE_MS = 1500;
const PAINT_RESERVE_MS = 100;
const SECONDARY_PAINT_TIMEOUT_MS = 3000;
const STOCK_ENTITY_RESOLVER_ALGORITHM = 'stock-entity-index';
const STOCK_ENTITY_RESOLVER_VERSION = 2;
const STOCK_ENTITY_RESOLVER_ADAPTER_VERSION = `${STOCK_ENTITY_RESOLVER_ALGORITHM}-v${STOCK_ENTITY_RESOLVER_VERSION}`;
const ENTITY_INDEX_VERSION = STOCK_ENTITY_RESOLVER_VERSION;
const QUOTE_INTENT_RE = /(현재가|현재\s*시세|오늘\s*주가|주가\s*(?:얼마|조회)|current\s+(?:stock\s+)?price|stock\s+price\s+today)/i;
const AMBIGUOUS_ENTITY_CONTEXT_RE = /(?:말고|제외|아닌|비교|\b(?:not|except|excluding|compare|versus|vs)\b)/i;
const ENTITY_SUFFIX_PATTERN = "(?:'s|의|가|이|은|는|을|를|와|과|에|에서|으로|로)";

class RestDatasetError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RestDatasetError';
    this.code = code;
    Object.assign(this, details);
  }
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[^0-9a-z가-힣]+/g, '');
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function aliasSpanPattern(alias) {
  const flexibleAlias = [...alias].map(regexEscape).join('[^0-9a-z가-힣]*');
  return new RegExp(
    `(?:^|[^0-9a-z가-힣])${flexibleAlias}(?:${ENTITY_SUFFIX_PATTERN})?(?=$|[^0-9a-z가-힣])`,
    'iu',
  );
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function operationKey(item) {
  return `${item.operationRef}\n${JSON.stringify(stableValue(item.args))}`;
}

function isEligibleOperationRef(operationRef) {
  const ref = String(operationRef || '');
  if (/^base:au\d+$/i.test(ref)) return false;
  if (/^base:kt1\d{4}$/i.test(ref)) return false;
  if (ref === 'base:ka10001') return false;
  return /^(?:base:(?:ka|kt)\d+|detail:(?:ka|kt)\d+:[a-z0-9_]+)$/i.test(ref);
}

function normalizeDataset(input) {
  if (!input || typeof input !== 'object') {
    throw new RestDatasetError('invalid_dataset', 'REST 데이터셋 객체가 필요하다');
  }
  if (input.invalid_request) {
    throw new RestDatasetError(
      String(input.invalid_request.reason || 'invalid_request'),
      '안전하지 않거나 지원하지 않는 REST 화면 요청이다',
    );
  }

  const datasetId = String(input.datasetId || input.dataset_id || input.id || '').trim();
  if (!datasetId || datasetId.length > 64) {
    throw new RestDatasetError('invalid_dataset_id', 'dataset_id는 1~64자여야 한다');
  }
  const question = String(input.question || '').trim();
  if (!question) throw new RestDatasetError('empty_question', '질의가 비어 있다');

  const rawItems = Array.isArray(input.items)
    ? input.items
    : (Array.isArray(input.operations)
      ? input.operations.map((operation, index) => ({
        itemId: `${datasetId}-${index + 1}`,
        ordinal: index + 1,
        operationRef: operation.operation_ref,
        args: operation.args,
        caption: operation.caption,
      }))
      : []);
  if (rawItems.length < 1 || rawItems.length > MAX_ITEMS) {
    throw new RestDatasetError('invalid_item_count', `REST 데이터셋 항목은 1~${MAX_ITEMS}개여야 한다`);
  }

  const ids = new Set();
  const ordinals = new Set();
  const items = rawItems.map((raw, index) => {
    const itemId = String(raw.itemId || raw.item_id || `${datasetId}-${index + 1}`).trim();
    const ordinal = Number(raw.ordinal ?? index + 1);
    const operationRef = String(raw.operationRef || raw.operation_ref || '').trim();
    if (!itemId || itemId.length > 128 || ids.has(itemId)) {
      throw new RestDatasetError('invalid_item_id', 'item_id는 데이터셋 안에서 고유한 1~128자여야 한다');
    }
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > MAX_ITEMS || ordinals.has(ordinal)) {
      throw new RestDatasetError('invalid_ordinal', `ordinal은 데이터셋 안에서 고유한 1~${MAX_ITEMS} 정수여야 한다`);
    }
    if (!isEligibleOperationRef(operationRef)) {
      throw new RestDatasetError('ineligible_operation', '조회 전용 Kiwoom REST operation_ref만 허용한다');
    }
    if (raw.canvasType || raw.canvas_type || raw.data) {
      throw new RestDatasetError('caller_presentation_forbidden', '호출자는 canvas_type이나 data를 지정할 수 없다');
    }
    ids.add(itemId);
    ordinals.add(ordinal);
    return {
      itemId,
      ordinal,
      operationRef,
      args: raw.args && typeof raw.args === 'object' && !Array.isArray(raw.args) ? raw.args : {},
      caption: raw.caption == null ? null : String(raw.caption).slice(0, 160),
    };
  }).sort((a, b) => a.ordinal - b.ordinal);

  return {
    datasetId,
    question,
    items,
    firstCanvasDeadlineMs: Math.min(
      DEFAULT_FIRST_CANVAS_DEADLINE_MS,
      Math.max(1, Number(input.firstCanvasDeadlineMs || input.first_canvas_deadline_ms) || DEFAULT_FIRST_CANVAS_DEADLINE_MS),
    ),
  };
}

async function readJson(response, label) {
  if (!response || !response.ok) {
    let body = null;
    try {
      body = response && typeof response.json === 'function' ? await response.json() : null;
    } catch {
      body = null;
    }
    const detail = body && body.detail;
    const backendCode = String(
      (detail && typeof detail === 'object' && detail.code)
      || (body && body.code)
      || '',
    ).trim() || null;
    const backendMessage = String(
      (detail && typeof detail === 'object' && (detail.message || detail.error))
      || (typeof detail === 'string' && detail)
      || (body && (body.message || body.error))
      || '',
    ).trim() || null;
    const suffix = [backendCode, backendMessage].filter(Boolean).join(': ');
    throw new RestDatasetError(
      `${label}_http`,
      `${label} HTTP ${response && response.status}${suffix ? ` (${suffix})` : ''}`,
      { httpStatus: response && response.status, backendCode, backendMessage },
    );
  }
  try {
    return await response.json();
  } catch {
    throw new RestDatasetError(`${label}_json`, `${label} 응답이 JSON이 아니다`);
  }
}

function remainingRenderDeadlineMs(startedAt, firstCanvasDeadlineMs, now) {
  const elapsedMs = Math.max(0, Number(now) - Number(startedAt));
  const remainingMs = Number(firstCanvasDeadlineMs) - elapsedMs - PAINT_RESERVE_MS;
  return Math.max(
    BACKEND_MIN_DEADLINE_MS,
    Math.min(PRIMARY_UPSTREAM_DEADLINE_MS, Math.floor(remainingMs)),
  );
}

function verifyInlineResponse(body, item, datasetId) {
  const expected = { dataset_id: datasetId, item_id: item.itemId, ordinal: item.ordinal };
  if (!body || body.delivery !== 'inline' || body.queued !== false
    || !['rendered', 'error_rendered'].includes(body.status)) {
    throw new RestDatasetError('invalid_inline_response', 'render-plan이 인라인 렌더 계약을 지키지 않았다');
  }
  if (!body.envelope || typeof body.envelope !== 'object') {
    throw new RestDatasetError('missing_envelope', '인라인 응답에 envelope가 없다');
  }
  const correlation = body.correlation || body.envelope.correlation;
  if (!correlation
    || correlation.dataset_id !== expected.dataset_id
    || correlation.item_id !== expected.item_id
    || correlation.ordinal !== expected.ordinal) {
    throw new RestDatasetError('correlation_mismatch', '인라인 응답 correlation이 요청과 다르다');
  }
  if (body.operation_ref !== item.operationRef) {
    throw new RestDatasetError('operation_mismatch', '인라인 응답 operation_ref가 요청과 다르다');
  }
  if (!body.canvas_type || body.envelope.canvas_type !== body.canvas_type) {
    throw new RestDatasetError('manifest_mismatch', 'manifest 권위 canvas_type이 일관되지 않다');
  }
  if (!body.screen_id || body.envelope.screen_id !== body.screen_id) {
    throw new RestDatasetError('screen_contract_missing', 'Paper screen_id 계약이 없거나 일관되지 않다');
  }
  return body;
}

function cloneInlineResponse(body, item, datasetId) {
  const correlation = { dataset_id: datasetId, item_id: item.itemId, ordinal: item.ordinal };
  return {
    ...body,
    correlation,
    envelope: {
      ...body.envelope,
      caption: item.caption || body.envelope.caption || null,
      correlation,
    },
  };
}

function toCancelledInlineResponse(body) {
  return {
    ...body,
    status: 'error_rendered',
    code: 'UPSTREAM_CANCELLED',
    envelope: {
      canvas_type: body.canvas_type,
      screen_id: body.screen_id,
      state: 'cancelled',
      fell_back: false,
      fallback_reason: null,
      caption: null,
      layout: body.envelope.layout || null,
      drop_types: [],
      correlation: body.correlation,
      error: { code: 'UPSTREAM_CANCELLED', retryable: true },
    },
    receipt: {
      pushed: true,
      delivery: 'inline',
      canvas_type: body.canvas_type,
      screen_id: body.screen_id,
      state: 'cancelled',
      error_code: 'UPSTREAM_CANCELLED',
      fell_back: false,
      fallback_reason: null,
      trimmed: false,
      partial: false,
      cache_reused: false,
    },
    next_actions: [],
  };
}

function buildDeterministicAnswer(canvases, errors = []) {
  if (!canvases.length) return '캔버스에 표시하지 못했습니다. 화면 오류를 확인해 주세요.';
  const state = canvases.find((canvas) => canvas.state)?.state;
  if (state === 'timeout') return '조회 시간이 초과되어 캔버스에 시간 초과 상태를 표시했습니다.';
  if (state === 'cancelled') return '조회가 취소되어 캔버스에 취소 상태를 표시했습니다.';
  if (state === 'error') return '조회 오류가 발생해 캔버스에 오류 상태를 표시했습니다.';
  if (errors.length) return '일부 결과만 캔버스에 표시했습니다. 표시하지 못한 항목이 있습니다.';
  return '캔버스에 표시했습니다.';
}

function normalizeRecommendations(actions) {
  if (!Array.isArray(actions)) return [];
  const out = [];
  const ids = new Set();
  for (const raw of actions) {
    if (!raw || typeof raw !== 'object') continue;
    const id = String(raw.follow_up_id || raw.id || '').trim();
    const label = String(raw.label || '').trim();
    const query = String(raw.query || raw.user_query || '').trim();
    const targetIntent = String(raw.target_intent || 'query').trim();
    const operationRef = String(raw.operation_ref || '').trim();
    if (!id || ids.has(id) || !label || !query || targetIntent !== 'query') continue;
    if (operationRef && !isEligibleOperationRef(operationRef)) continue;
    if (/(주문|매수|매도|자동매매|oauth|토큰|인증\s*발급)/i.test(`${label} ${query}`)) continue;
    ids.add(id);
    out.push({
      id,
      label: label.slice(0, 80),
      query: query.slice(0, 240),
      targetIntent,
      operationRef: operationRef || null,
    });
    if (out.length === 3) break;
  }
  return out;
}

function abortError(signal) {
  return signal && signal.reason instanceof Error
    ? signal.reason
    : new RestDatasetError('aborted', 'REST 데이터셋 실행이 중단됐다');
}

async function runPool(items, limit, worker) {
  let cursor = 0;
  const count = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: count }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  }));
}

async function runRestDataset({
  dataset: rawDataset,
  backendBase,
  fetchImpl = globalThis.fetch,
  emitCanvas = async () => ({}),
  signal,
  hardSignal,
  clock = () => performance.now(),
  onEvent = () => {},
} = {}) {
  let dataset;
  try {
    dataset = normalizeDataset(rawDataset);
  } catch (error) {
    return {
      ok: false,
      feedbackOk: false,
      source: 'kiwoom-rest',
      rejected: true,
      error: error.message,
      errorCode: error.code || 'invalid_dataset',
      answerText: '지원하지 않는 요청이라 캔버스에 표시하지 않았습니다.',
      answer: {
        delivery: 'separate',
        source: 'rejected-receipt',
        startedBeforeCanvasSettled: true,
        blockedCanvas: false,
        payloadTokensLeaked: false,
        modelCalls: 0,
      },
      canvases: [],
      canvasTypes: [],
      renderedCount: 0,
      dataCanvasCount: 0,
      stateCanvasCount: 0,
      physicalCalls: 0,
      lateCanvases: 0,
      recommendations: [],
      recommendationsExecutedBeforeClick: 0,
      forbiddenCalls: { mcp: 0, claude: 0, ws: 0, order: 0, oauth: 0 },
    };
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl이 필요하다');
  if (typeof emitCanvas !== 'function') throw new TypeError('emitCanvas가 필요하다');

  const startedAt = clock();
  const controller = new AbortController();
  let cancelRequested = false;
  const abortFromParent = () => {
    // HTTP를 즉시 끊으면 authoritative screen_id/canvas_type을 잃어 같은 슬롯의
    // 취소 상태를 그릴 수 없다. 최대 2700ms backend deadline까지 기다린 뒤,
    // 반환된 manifest/Paper identity 위에 데이터 없는 cancelled state를 그린다.
    cancelRequested = true;
    onEvent({ type: 'cancel-requested', datasetId: dataset.datasetId });
  };
  if (signal) {
    if (signal.aborted) abortFromParent();
    else signal.addEventListener('abort', abortFromParent, { once: true });
  }
  const abortHard = () => {
    controller.abort(hardSignal && hardSignal.reason instanceof Error
      ? hardSignal.reason
      : new RestDatasetError('hard_abort', 'REST 데이터셋 실행이 강제 중단됐다'));
  };
  if (hardSignal) {
    if (hardSignal.aborted) abortHard();
    else hardSignal.addEventListener('abort', abortHard, { once: true });
  }
  let firstPainted = false;
  let firstCanvasMs = null;
  let firstFeedbackMs = null;
  const deadlineTimer = setTimeout(() => {
    if (!firstPainted) controller.abort(new RestDatasetError('first_canvas_deadline', '첫 카드 3초 마감 시간을 넘겼다'));
  }, dataset.firstCanvasDeadlineMs);

  const canvases = [];
  const errors = [];
  const singleFlight = new Map();
  let physicalCalls = 0;
  let lateCanvases = 0;

  async function executePhysical(item) {
    if (controller.signal.aborted) throw abortError(controller.signal);
    physicalCalls += 1;
    onEvent({ type: 'resolve-start', datasetId: dataset.datasetId, itemId: item.itemId, ordinal: item.ordinal });
    const resolveBody = await readJson(await fetchImpl(`${backendBase}/api/v1/llm/tools/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        // Operation selection is already complete in RestDatasetPlan. Mint the
        // signed one-use token through selector exact-identity matching instead
        // of re-ranking the dataset's descriptive natural-language question.
        question: item.operationRef,
        intent: 'query',
        arguments: item.args,
      }),
    }), 'resolve');
    if (!resolveBody.plan_token) {
      throw new RestDatasetError('missing_plan_token', 'resolve가 실행 가능한 plan_token을 주지 않았다');
    }
    onEvent({ type: 'inline-start', datasetId: dataset.datasetId, itemId: item.itemId, ordinal: item.ordinal });
    const renderDeadlineMs = firstPainted
      ? BACKEND_MAX_DEADLINE_MS
      : remainingRenderDeadlineMs(startedAt, dataset.firstCanvasDeadlineMs, clock());
    const body = await readJson(await fetchImpl(`${backendBase}/api/v1/canvas/render-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        plan_token: resolveBody.plan_token,
        delivery: 'inline',
        dataset_id: dataset.datasetId,
        item_id: item.itemId,
        ordinal: item.ordinal,
        caption: item.caption,
        deadline_ms: renderDeadlineMs,
      }),
    }), 'render-plan');
    const verified = verifyInlineResponse(body, item, dataset.datasetId);
    return cancelRequested ? toCancelledInlineResponse(verified) : verified;
  }

  async function executeItem(item) {
    try {
      const key = operationKey(item);
      let shared = singleFlight.get(key);
      if (!shared) {
        shared = executePhysical(item);
        singleFlight.set(key, shared);
      }
      const baseBody = await shared;
      const body = cloneInlineResponse(baseBody, item, dataset.datasetId);
      if (controller.signal.aborted) {
        lateCanvases += 1;
        throw abortError(controller.signal);
      }
      const inlineAt = clock();
      onEvent({ type: 'inline-ready', datasetId: dataset.datasetId, itemId: item.itemId, ordinal: item.ordinal });
      const paintDeadlineAt = firstPainted
        ? inlineAt + SECONDARY_PAINT_TIMEOUT_MS
        : startedAt + dataset.firstCanvasDeadlineMs;
      const paint = await emitCanvas({
        datasetId: dataset.datasetId,
        itemId: item.itemId,
        ordinal: item.ordinal,
        operationRef: item.operationRef,
        operationArgs: Object.assign({}, item.args),
        canvasType: body.canvas_type,
        envelope: body.envelope,
        requestStartedAt: startedAt,
        inlineAt,
        paintDeadlineAt,
        firstFeedbackPending: !firstPainted,
        signal: controller.signal,
      });
      if (controller.signal.aborted && !firstPainted) {
        lateCanvases += 1;
        throw abortError(controller.signal);
      }
      const paintedAt = Number(paint && paint.visiblePaintAt) || clock();
      const totalMs = Math.max(0, paintedAt - startedAt);
      const renderState = (paint && paint.renderState)
        || (body.status === 'rendered' ? 'data' : (body.envelope.state || 'error'));
      if (!firstPainted) {
        firstPainted = true;
        firstFeedbackMs = totalMs;
        clearTimeout(deadlineTimer);
      }
      if (body.status === 'rendered' && renderState === 'data' && firstCanvasMs === null) firstCanvasMs = totalMs;
      const observed = {
        operationRef: item.operationRef,
        canvasType: body.canvas_type,
        ordinal: item.ordinal,
        correlation: body.correlation,
        envelope: body.envelope,
        receipt: body.receipt,
        status: body.status,
        state: body.envelope.state || null,
        screenId: body.screen_id || body.envelope.screen_id || null,
        renderState,
        rendererId: paint && paint.rendererId ? paint.rendererId : null,
        panelId: paint && paint.panelId ? paint.panelId : null,
        generation: paint && Number.isInteger(paint.generation) ? paint.generation : null,
        isDataCanvas: body.status === 'rendered' && renderState === 'data',
        backendTiming: body.timing || body.timing_ms || null,
        nextActions: normalizeRecommendations(body.next_actions),
        verifiedVisible: paint ? paint.verifiedVisible !== false : true,
        stageMs: {
          requestToInlineMs: Math.max(0, inlineAt - startedAt),
          inlineToDomMs: Number(paint && paint.inlineToDomMs) || 0,
          domToPaintAckMs: Number(paint && paint.domToPaintAckMs) || 0,
          totalMs,
        },
      };
      canvases.push(observed);
      onEvent({ type: 'paint-ack', datasetId: dataset.datasetId, itemId: item.itemId, ordinal: item.ordinal, totalMs });
    } catch (error) {
      errors.push({
        itemId: item.itemId,
        ordinal: item.ordinal,
        code: error.code || 'request_failed',
        message: error.message,
        httpStatus: error.httpStatus || null,
        backendCode: error.backendCode || null,
        backendMessage: error.backendMessage || null,
      });
      onEvent({ type: 'item-error', datasetId: dataset.datasetId, itemId: item.itemId, ordinal: item.ordinal, code: error.code || 'request_failed' });
    }
  }

  const answerStartedAt = clock();
  onEvent({ type: 'answer-start', datasetId: dataset.datasetId, at: answerStartedAt });
  try {
    await executeItem(dataset.items[0]);
    if (!controller.signal.aborted && dataset.items.length > 1) {
      await runPool(dataset.items.slice(1), MAX_CONCURRENCY, executeItem);
    }
  } finally {
    clearTimeout(deadlineTimer);
    if (signal) signal.removeEventListener('abort', abortFromParent);
    if (hardSignal) hardSignal.removeEventListener('abort', abortHard);
  }

  canvases.sort((a, b) => a.ordinal - b.ordinal);
  const durationMs = Math.max(0, clock() - startedAt);
  const answerText = buildDeterministicAnswer(canvases, errors);
  const recommendations = [];
  const recommendationIds = new Set();
  for (const canvas of canvases) {
    for (const action of canvas.nextActions || []) {
      if (recommendations.length >= 3 || recommendationIds.has(action.id)) continue;
      recommendationIds.add(action.id);
      recommendations.push(action);
    }
  }
  const feedbackDeadlineMet = firstFeedbackMs !== null && firstFeedbackMs <= dataset.firstCanvasDeadlineMs;
  const dataCanvasCount = canvases.filter((canvas) => canvas.isDataCanvas).length;
  const stateCanvasCount = canvases.length - dataCanvasCount;
  const stateErrorCode = canvases.find((canvas) => canvas.state)?.receipt?.error_code || null;
  return {
    ok: dataCanvasCount > 0 && firstCanvasMs <= dataset.firstCanvasDeadlineMs,
    feedbackOk: feedbackDeadlineMet,
    source: 'kiwoom-rest',
    datasetId: dataset.datasetId,
    error: dataCanvasCount ? null : (stateErrorCode || (errors[0] && errors[0].message) || '렌더할 데이터 카드가 없다'),
    errorCode: dataCanvasCount ? null : (stateErrorCode || (errors[0] && errors[0].code) || 'no_data_canvas'),
    answerText,
    answer: {
      delivery: 'separate',
      source: 'display-receipt',
      startedAt: answerStartedAt,
      startedBeforeCanvasSettled: true,
      blockedCanvas: false,
      payloadTokensLeaked: false,
      modelCalls: 0,
    },
    recommendations,
    recommendationsExecutedBeforeClick: 0,
    canvases,
    canvasTypes: canvases.map((canvas) => canvas.canvasType),
    errors,
    firstCanvasMs,
    firstFeedbackMs,
    durationMs,
    renderedCount: canvases.length,
    dataCanvasCount,
    stateCanvasCount,
    physicalCalls,
    lateCanvases,
    maxConcurrency: MAX_CONCURRENCY,
    forbiddenCalls: { mcp: 0, claude: 0, ws: 0, order: 0, oauth: 0 },
  };
}

class StockEntityIndex {
  constructor() {
    this.algorithm = STOCK_ENTITY_RESOLVER_ALGORITHM;
    this.version = STOCK_ENTITY_RESOLVER_VERSION;
    this.adapterVersion = STOCK_ENTITY_RESOLVER_ADAPTER_VERSION;
    this._aliases = new Map();
    this.refreshedAt = null;
  }

  replace(records) {
    const next = new Map();
    for (const record of records || []) {
      const code = String(record && (record.code || record.stk_cd) || '').trim();
      const name = String(record && (record.name || record.stk_nm) || '').trim();
      if (!/^\d{6}$/.test(code) || !name) continue;
      const supplementalAliases = Array.isArray(record && record.aliases) ? record.aliases : [];
      for (const alias of [code, name, ...supplementalAliases]) {
        const normalized = normalizeText(alias);
        if (!normalized) continue;
        if (!next.has(normalized)) next.set(normalized, new Set());
        next.get(normalized).add(code);
      }
    }
    this._aliases = next;
    this.refreshedAt = Date.now();
    return this.size;
  }

  get size() {
    return this._aliases.size;
  }

  resolveQuery(query) {
    const text = String(query || '').normalize('NFKC').toLocaleLowerCase('ko-KR');
    if (AMBIGUOUS_ENTITY_CONTEXT_RE.test(text)) return null;

    const explicitCodes = new Set(
      [...text.matchAll(/(?:^|\D)(\d{6})(?=\D|$)/g)].map((match) => match[1]),
    );
    if (explicitCodes.size > 1) return null;

    const matchedCodes = new Set(explicitCodes);
    let matchedAlias = false;
    for (const [alias, codes] of this._aliases) {
      if (alias.length < 2 || /^\d{6}$/.test(alias) || !aliasSpanPattern(alias).test(text)) continue;
      matchedAlias = true;
      if (codes.size !== 1) return null;
      matchedCodes.add([...codes][0]);
    }
    if (matchedCodes.size !== 1) return null;
    const code = [...matchedCodes][0];
    return { code, source: explicitCodes.size === 1 && !matchedAlias ? 'explicit-code' : 'entity-index' };
  }
}

function extractStockMasterRecords(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.list)) return body.list;
  if (body && body.data && Array.isArray(body.data.list)) return body.data.list;
  return [];
}

async function refreshStockEntityIndex(index, {
  backendBase,
  fetchImpl = globalThis.fetch,
  markets = ['0', '10', '8'],
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const records = [];
  for (let marketIndex = 0; marketIndex < markets.length; marketIndex += 1) {
    const market = markets[marketIndex];
    const response = await fetchImpl(`${backendBase}/api/v1/tr/stockinfo/ka10099`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mrkt_tp: market }),
    });
    const body = await readJson(response, 'stock-master');
    records.push(...extractStockMasterRecords(body));
    // 같은 API ID는 초당 1회 제한이다. 첫 시장부터 즉시 사용 가능한 인덱스로
    // 반영하고, 다음 시장 호출 전 1초 창을 넘긴다.
    index.replace(records);
    if (marketIndex < markets.length - 1) await wait(1050);
  }
  return index.size;
}

function buildQuoteDataset(query, index, { idFactory = () => `rest-${Date.now().toString(36)}` } = {}) {
  const text = String(query || '').trim();
  if (!QUOTE_INTENT_RE.test(text)) {
    return null;
  }
  const entity = index && index.resolveQuery(text);
  if (!entity) return null;
  return {
    datasetId: String(idFactory()).slice(0, 64),
    question: text,
    items: [{
      itemId: 'primary-quote',
      ordinal: 1,
      operationRef: 'detail:ka10001:current_trading',
      args: { stk_cd: entity.code },
      caption: null,
    }],
  };
}

module.exports = {
  MAX_ITEMS,
  MAX_CONCURRENCY,
  DEFAULT_FIRST_CANVAS_DEADLINE_MS,
  ENTITY_INDEX_VERSION,
  STOCK_ENTITY_RESOLVER_ALGORITHM,
  STOCK_ENTITY_RESOLVER_VERSION,
  STOCK_ENTITY_RESOLVER_ADAPTER_VERSION,
  RestDatasetError,
  StockEntityIndex,
  normalizeDataset,
  normalizeRecommendations,
  isEligibleOperationRef,
  buildDeterministicAnswer,
  buildQuoteDataset,
  refreshStockEntityIndex,
  runRestDataset,
};
