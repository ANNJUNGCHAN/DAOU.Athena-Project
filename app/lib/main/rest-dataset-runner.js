'use strict';

const { performance } = require('node:perf_hooks');

const MAX_ITEMS = 6;
const MAX_CONCURRENCY = 3;
const DEFAULT_FIRST_CANVAS_DEADLINE_MS = 3000;
const MAX_FIRST_CANVAS_DEADLINE_MS = 30_000;
const BACKEND_MAX_DEADLINE_MS = 2700;
const BACKEND_MIN_DEADLINE_MS = 100;
const PRIMARY_UPSTREAM_DEADLINE_MS = 1500;
const PAINT_RESERVE_MS = 100;
const SECONDARY_PAINT_TIMEOUT_MS = 3000;
let retryDatasetSequence = 0;
const STOCK_ENTITY_RESOLVER_ALGORITHM = 'stock-entity-index';
const STOCK_ENTITY_RESOLVER_VERSION = 3;
const STOCK_ENTITY_RESOLVER_ADAPTER_VERSION = `${STOCK_ENTITY_RESOLVER_ALGORITHM}-v${STOCK_ENTITY_RESOLVER_VERSION}`;
const ENTITY_INDEX_VERSION = STOCK_ENTITY_RESOLVER_VERSION;
const AMBIGUOUS_ENTITY_CONTEXT_RE = /(?:말고|제외|아닌|비교|\b(?:not|except|excluding|compare|versus|vs)\b)/i;
const ENTITY_SUFFIX_PATTERN = "(?:'s|의|가|이|은|는|을|를|와|과|에|에서|으로|로)";
const REVIEWED_MARKET_ENTITY_KIND = Object.freeze({ '0': 'stock', '10': 'stock', '8': 'etf' });
const GRAMMAR_EDGE = `[\\s?!.,~"'():;·-]*`;
const KOREAN_QUOTE_CORE = '(?:시세|현재\\s*(?:가|시세)|오늘\\s*주가|주가)(?:\\s*(?:얼마(?:야|예요|에요|인가요?)?|조회))?';
const KOREAN_QUOTE_COURTESY = '(?:\\s*(?:를|은|는))?(?:\\s*(?:좀|한번))?(?:\\s*(?:(?:알려|보여)\\s*(?:줘|주세요)|(?:조회|확인)\\s*(?:해)?\\s*(?:줘|주세요)|해\\s*(?:줘|주세요)))?';
const ENGLISH_QUOTE_CORE = '(?:current\\s+(?:stock\\s+)?price|stock\\s+price\\s+today)';
// 일봉 차트만 대상이다(base:ka10081) — "주봉/시세/호가"는 다른 TR·다른 렌더러라
// 닫힌 문법에 안 넣는다(팀 지침의 "불확실하면 미매치"). 영어 문법도 뺐다 —
// "chart"는 조직도 등과 겹쳐 한국어보다 오탐 위험이 크다.
const KOREAN_CHART_CORE = '(?:(?:주가|주식)\\s*)?(?:일봉\\s*차트|차트|일봉)';
const KOREAN_CHART_COURTESY = '(?:\\s*(?:를|은|는))?(?:\\s*(?:좀|한번))?(?:\\s*(?:(?:보여|그려|띄워)\\s*(?:줘|주세요|줄래)?|(?:조회|확인)\\s*(?:해)?\\s*(?:줘|주세요)|해\\s*(?:줘|주세요)))?';

// 카드 v3 정형 질의 5종(2026-08-26, 속도 레버) — QUOTE_COURTESY를 그대로
// 재사용한다("보여/알려줘"·"조회/확인해줘"류 순수 조회 정중어라 그림/띄움
// 동사가 붙는 CHART_COURTESY와 다르다). 각 CORE는 그 카드 하나만 가리키는
// 명사라 다른 화면과 안 겹친다(예: "시세"는 QUOTE_CORE에 이미 있어 안 넣음).
const KOREAN_ORDERBOOK_CORE = '(?:호가)';
const KOREAN_SCREEN_CORE = '(?:시세|현재가|오늘\\s*주가|주가|호가|(?:일봉\\s*)?차트)';
const KOREAN_SCREEN_JOIN = '(?:랑|이랑|와|과|하고|,)';
const KOREAN_INVESTOR_FLOW_CORE = '(?:수급|(?:외국인|기관)\\s*매매(?:\\s*동향)?)';
const KOREAN_TRADING_SOURCE_CORE = '(?:거래원)';
const KOREAN_STOCKINFO_CORE = '(?:종목정보|기업정보)';
// 프로그램매매는 종목 무관(시장 전체) — entity 결선이 아예 없다.
const KOREAN_PROGRAM_TRADE_CORE = '(?:프로그램매매(?:\\s*동향)?)';

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

function flexibleExactAliasPattern(alias) {
  return [...String(alias || '')].map(regexEscape).join('[\\s._-]*');
}

// Fast quote는 selector를 대신하는 작은 폐쇄 문법이다. 정확히 resolve된 하나의
// 종목 표기와 현재가 표현, 검토된 조사/정중어만 질문 전체를 소진해야 한다.
// 알 수 없는 단어·접속사·추가 화면 의미가 한 글자라도 남으면 정상 selector로
// 넘긴다. 따라서 경쟁 의도 목록을 계속 유지할 필요가 없다.
function matchesStandaloneQuoteGrammar(query, index, entity) {
  if (!index || !entity) return false;
  const text = String(query || '').normalize('NFKC').toLocaleLowerCase('ko-KR').trim();
  const aliases = index.aliasesForEntity(entity);
  return aliases.some((alias) => {
    const aliasPattern = flexibleExactAliasPattern(alias);
    const koreanEntity = `${aliasPattern}(?:의|은|는|이|가|을|를)?`;
    const englishEntity = `${aliasPattern}(?:\\s*'s)?`;
    const patterns = [
      `${GRAMMAR_EDGE}${koreanEntity}\\s*${KOREAN_QUOTE_CORE}${KOREAN_QUOTE_COURTESY}${GRAMMAR_EDGE}`,
      `${GRAMMAR_EDGE}(?:please\\s+)?(?:show\\s+me\\s+|tell\\s+me\\s+)?${englishEntity}\\s+${ENGLISH_QUOTE_CORE}(?:\\s+please)?${GRAMMAR_EDGE}`,
      `${GRAMMAR_EDGE}(?:please\\s+)?${ENGLISH_QUOTE_CORE}\\s+(?:for|of)\\s+${englishEntity}(?:\\s+please)?${GRAMMAR_EDGE}`,
    ];
    return patterns.some((pattern) => new RegExp(`^${pattern}$`, 'iu').test(text));
  });
}

// 차트 fast quote와 같은 원칙(닫힌 문법, 전체 소진) — 종목 표기 + 차트 단어 +
// 검토된 조사/정중어만 허용한다. 남는 단어가 한 글자라도 있으면 정상 selector로.
function matchesStandaloneChartGrammar(query, index, entity) {
  if (!index || !entity) return false;
  const text = String(query || '').normalize('NFKC').toLocaleLowerCase('ko-KR').trim();
  const aliases = index.aliasesForEntity(entity);
  return aliases.some((alias) => {
    const aliasPattern = flexibleExactAliasPattern(alias);
    const koreanEntity = `${aliasPattern}(?:의|은|는|이|가|을|를)?`;
    const pattern = `${GRAMMAR_EDGE}${koreanEntity}\\s*${KOREAN_CHART_CORE}${KOREAN_CHART_COURTESY}${GRAMMAR_EDGE}`;
    return new RegExp(`^${pattern}$`, 'iu').test(text);
  });
}

// 카드 v3 정형 질의 5종 공용 — 위 quote/chart와 같은 원칙(닫힌 문법, 전체
// 소진)이라 entity+core+courtesy 뼈대를 공유한다. quote/chart는 각자 영어
// 변형·다중 패턴이 있어 그대로 두고 손 안 댄다 — 이 5종은 전부 한국어
// 단일 패턴이라 새 코드에서만 중복을 걷는다.
function matchesStandaloneEntityGrammar(query, index, entity, core, courtesy) {
  if (!index || !entity) return false;
  const text = String(query || '').normalize('NFKC').toLocaleLowerCase('ko-KR').trim();
  const aliases = index.aliasesForEntity(entity);
  return aliases.some((alias) => {
    const aliasPattern = flexibleExactAliasPattern(alias);
    const koreanEntity = `${aliasPattern}(?:의|은|는|이|가|을|를)?`;
    const pattern = `${GRAMMAR_EDGE}${koreanEntity}\\s*${core}${courtesy}${GRAMMAR_EDGE}`;
    return new RegExp(`^${pattern}$`, 'iu').test(text);
  });
}

function matchesStandaloneOrderBookGrammar(query, index, entity) {
  return matchesStandaloneEntityGrammar(query, index, entity, KOREAN_ORDERBOOK_CORE, KOREAN_QUOTE_COURTESY);
}

function matchesStandaloneInvestorFlowGrammar(query, index, entity) {
  return matchesStandaloneEntityGrammar(query, index, entity, KOREAN_INVESTOR_FLOW_CORE, KOREAN_QUOTE_COURTESY);
}

function matchesStandaloneTradingSourceGrammar(query, index, entity) {
  return matchesStandaloneEntityGrammar(query, index, entity, KOREAN_TRADING_SOURCE_CORE, KOREAN_QUOTE_COURTESY);
}

function matchesStandaloneStockInfoGrammar(query, index, entity) {
  return matchesStandaloneEntityGrammar(query, index, entity, KOREAN_STOCKINFO_CORE, KOREAN_QUOTE_COURTESY);
}

// 종목 결선이 없다 — 시장 전체 프로그램매매 동향이라 entity 매칭을 아예 안
// 거친다. 남는 단어가 있으면(예: "삼성전자 프로그램매매") 이 문법이 아니라
// 정상 selector로 넘어간다(전체 소진 원칙 그대로).
function matchesStandaloneProgramTradeGrammar(query) {
  const text = String(query || '').normalize('NFKC').toLocaleLowerCase('ko-KR').trim();
  const pattern = `${GRAMMAR_EDGE}${KOREAN_PROGRAM_TRADE_CORE}${KOREAN_QUOTE_COURTESY}${GRAMMAR_EDGE}`;
  return new RegExp(`^${pattern}$`, 'iu').test(text);
}

function screenKindFromCore(token) {
  const text = String(token || '').replace(/\s+/g, '');
  if (text.includes('호가')) return 'orderbook';
  if (text.includes('차트') || text.includes('일봉')) return 'chart';
  if (text.includes('시세') || text.includes('현재가') || text.includes('주가')) return 'quote';
  return null;
}

function matchCompoundScreenCores(query, index, entity) {
  if (!index || !entity) return null;
  const text = String(query || '').normalize('NFKC').toLocaleLowerCase('ko-KR').trim();
  const aliases = index.aliasesForEntity(entity);
  for (const alias of aliases) {
    const aliasPattern = flexibleExactAliasPattern(alias);
    const koreanEntity = `${aliasPattern}(?:의|은|는|이|가|을|를)?`;
    const pattern = `${GRAMMAR_EDGE}${koreanEntity}\\s*(${KOREAN_SCREEN_CORE})\\s*${KOREAN_SCREEN_JOIN}\\s*(${KOREAN_SCREEN_CORE})${KOREAN_QUOTE_COURTESY}${GRAMMAR_EDGE}`;
    const match = text.match(new RegExp(`^${pattern}$`, 'iu'));
    if (!match) continue;
    const first = screenKindFromCore(match[1]);
    const second = screenKindFromCore(match[2]);
    if (!first || !second || first === second) continue;
    return [first, second];
  }
  return null;
}

function restItemForScreenKind(kind, entity, ordinal, today) {
  if (kind === 'quote') {
    return {
      itemId: 'primary-quote',
      ordinal,
      operationRef: 'detail:ka10001:current_trading',
      args: { stk_cd: entity.code },
      caption: null,
    };
  }
  if (kind === 'orderbook') {
    return {
      itemId: 'primary-orderbook',
      ordinal,
      operationRef: 'detail:ka10004:aggregate_totals',
      args: { stk_cd: entity.code },
      caption: null,
    };
  }
  return {
    itemId: 'primary-chart',
    ordinal,
    operationRef: 'base:ka10081',
    args: { stk_cd: entity.code, base_dt: today(), upd_stkpc_tp: '1' },
    caption: null,
  };
}

function kstToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
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
  const generation = input.generation == null ? 1 : Number(input.generation);
  if (!Number.isInteger(generation) || generation < 1) {
    throw new RestDatasetError('invalid_generation', 'generation은 1 이상의 정수여야 한다');
  }

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
    generation,
    question,
    items,
    firstCanvasDeadlineMs: Math.min(
      MAX_FIRST_CANVAS_DEADLINE_MS,
      Math.max(1, Number(input.firstCanvasDeadlineMs || input.first_canvas_deadline_ms) || DEFAULT_FIRST_CANVAS_DEADLINE_MS),
    ),
  };
}

function defaultRetryDatasetId() {
  retryDatasetSequence += 1;
  return `rest-retry-${Date.now().toString(36)}-${retryDatasetSequence.toString(36)}`;
}

function buildRetryAction(dataset, state, idFactory = defaultRetryDatasetId) {
  let datasetId = String(idFactory()).trim().slice(0, 64);
  if (!datasetId || datasetId === dataset.datasetId) datasetId = defaultRetryDatasetId().slice(0, 64);
  const generation = dataset.generation + 1;
  return {
    id: `retry-rest-dataset:${datasetId}`,
    type: 'retry-rest-dataset',
    label: '다시 시도',
    retryable: true,
    state,
    dataset: {
      datasetId,
      generation,
      question: dataset.question,
      firstCanvasDeadlineMs: dataset.firstCanvasDeadlineMs,
      items: dataset.items.map((item) => ({
        itemId: `${datasetId}-${item.ordinal}`,
        ordinal: item.ordinal,
        operationRef: item.operationRef,
        args: Object.assign({}, item.args),
        caption: item.caption,
      })),
    },
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

function buildDeterministicAnswer(canvases, errors = [], localState = null) {
  if (localState === 'timeout') return '조회 시간이 초과되었습니다. 다시 시도할 수 있습니다.';
  if (localState === 'cancelled') return '조회가 취소되었습니다. 다시 시도할 수 있습니다.';
  if (localState === 'error') return '조회 중 오류가 발생했습니다. 다시 시도할 수 있습니다.';
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

async function waitWithAbort(wait, ms, signal) {
  if (!signal) return wait(ms);
  if (signal.aborted) throw abortError(signal);
  let onAbort;
  const aborted = new Promise((resolve, reject) => {
    onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(() => wait(ms)), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
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
  backendAccountAlias,
  fetchImpl = globalThis.fetch,
  emitCanvas = async () => ({}),
  signal,
  hardSignal,
  clock = () => performance.now(),
  onEvent = () => {},
  retryIdFactory = defaultRetryDatasetId,
} = {}) {
  let dataset;
  try {
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(String(backendAccountAlias || ''))) {
      throw new RestDatasetError('missing_backend_account_alias', '조회에 사용할 서버 계좌가 연결되지 않았다');
    }
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
  // 차트 껍질처럼 먼저 보이는 카드는 마운트 결과가 확정되기 전에 이미 첫 피드백을
  // 지킨다. 그 시점에 마감을 풀지 않으면 늦게 뜨는 차트마다 화면에는 카드가 있는데
  // 답변만 first_canvas_deadline으로 뒤집힌다.
  const markFirstFeedback = (paintedAt) => {
    if (firstPainted) return false;
    firstPainted = true;
    firstFeedbackMs = Math.max(0, paintedAt - startedAt);
    clearTimeout(deadlineTimer);
    return true;
  };

  const canvases = [];
  const errors = [];
  const singleFlight = new Map();
  const signedQueryOperations = new Set();
  let physicalCalls = 0;
  let lateCanvases = 0;

  async function executePhysical(item) {
    if (controller.signal.aborted) throw abortError(controller.signal);
    physicalCalls += 1;
    onEvent({ type: 'resolve-start', datasetId: dataset.datasetId, itemId: item.itemId, ordinal: item.ordinal });
    const resolveBody = await readJson(await fetchImpl(`${backendBase}/api/v1/llm/tools/resolve`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'X-Athena-Account': backendAccountAlias,
      },
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
    signedQueryOperations.add(operationKey(item));
    onEvent({ type: 'inline-start', datasetId: dataset.datasetId, itemId: item.itemId, ordinal: item.ordinal });
    const renderDeadlineMs = firstPainted
      ? BACKEND_MAX_DEADLINE_MS
      : remainingRenderDeadlineMs(startedAt, dataset.firstCanvasDeadlineMs, clock());
    const body = await readJson(await fetchImpl(`${backendBase}/api/v1/canvas/render-plan`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'X-Athena-Account': backendAccountAlias,
      },
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
        // 카드가 눈에 보인 순간 호출된다(차트는 마운트 확정 전이다). 여기서
        // 마감을 풀고 첫 피드백 도달을 알린 뒤, 최종 render_state만 기다린다.
        onFirstPaint: (provisional) => {
          const at = Number(provisional && provisional.visiblePaintAt) || clock();
          if (!markFirstFeedback(at)) return;
          onEvent({
            type: 'paint-pending',
            datasetId: dataset.datasetId,
            itemId: item.itemId,
            ordinal: item.ordinal,
            totalMs: firstFeedbackMs,
          });
        },
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
      markFirstFeedback(paintedAt);
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
          inlineToChartImportMs: paint && paint.inlineToChartImportMs != null
            ? Number(paint.inlineToChartImportMs) : null,
          chartImportToDomMs: paint && paint.chartImportToDomMs != null
            ? Number(paint.chartImportToDomMs) : null,
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
  const authoritativeState = canvases.find((canvas) => canvas.state)?.state || null;
  const abortCode = controller.signal.reason && controller.signal.reason.code;
  const localState = canvases.length ? null : (
    cancelRequested || (hardSignal && hardSignal.aborted) || abortCode === 'hard_abort'
      ? 'cancelled'
      : (abortCode === 'first_canvas_deadline' || errors.some((error) => error.code === 'first_canvas_deadline')
        ? 'timeout'
        : (errors.length ? 'error' : null))
  );
  const state = authoritativeState || localState;
  const answerText = buildDeterministicAnswer(canvases, errors, localState);
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
  const retryAction = !dataCanvasCount && state
    ? buildRetryAction(dataset, state, retryIdFactory)
    : null;
  if (retryAction) {
    retryAction.verifiedQueryOnly = dataset.items.every((item) => signedQueryOperations.has(operationKey(item)));
  }
  return {
    ok: dataCanvasCount > 0 && firstCanvasMs <= dataset.firstCanvasDeadlineMs,
    feedbackOk: feedbackDeadlineMet,
    source: 'kiwoom-rest',
    datasetId: dataset.datasetId,
    generation: dataset.generation,
    state,
    retryable: Boolean(retryAction),
    retryAction,
    localState: localState ? {
      state: localState,
      errorCode: localState === 'timeout'
        ? 'LOCAL_FIRST_CANVAS_TIMEOUT'
        : (localState === 'cancelled' ? 'LOCAL_REQUEST_CANCELLED' : 'LOCAL_REQUEST_FAILED'),
      retryable: true,
    } : null,
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
    this._aliasSpans = new Map();
    this._entities = new Map();
    this._resolveMemo = null;
    this.refreshedAt = null;
  }

  replace(records) {
    const next = new Map();
    const entities = new Map();
    for (const record of records || []) {
      const code = String(record && (record.code || record.stk_cd) || '').trim();
      const name = String(record && (record.name || record.stk_nm) || '').trim();
      const market = String(record && (record.market ?? record.mrkt_tp) || '').trim();
      const kind = REVIEWED_MARKET_ENTITY_KIND[market];
      if (!/^\d{6}$/.test(code) || !name || !kind) continue;
      const entityKey = `${market}:${code}`;
      entities.set(entityKey, Object.freeze({ code, kind, market }));
      const supplementalAliases = Array.isArray(record && record.aliases) ? record.aliases : [];
      for (const alias of [code, name, ...supplementalAliases]) {
        const normalized = normalizeText(alias);
        if (!normalized) continue;
        if (!next.has(normalized)) next.set(normalized, new Set());
        next.get(normalized).add(entityKey);
      }
    }
    // resolveQuery의 alias 스캔이 매번 new RegExp를 던지지 않도록 스킵 대상을
    // 뺀 나머지만 여기서 한 번에 컴파일해둔다(빌드는 refresh 주기당 1회).
    const aliasSpans = new Map();
    for (const alias of next.keys()) {
      if (alias.length < 2 || /^\d{6}$/.test(alias)) continue;
      aliasSpans.set(alias, aliasSpanPattern(alias));
    }
    this._aliases = next;
    this._aliasSpans = aliasSpans;
    this._entities = entities;
    this._resolveMemo = null;
    this.refreshedAt = Date.now();
    return this.size;
  }

  get size() {
    return this._entities.size;
  }

  aliasesForEntity(entity) {
    if (!entity) return [];
    const entityKeys = new Set();
    for (const [key, indexedEntity] of this._entities) {
      if (indexedEntity.code === entity.code
          && indexedEntity.kind === entity.kind
          && indexedEntity.market === entity.market) entityKeys.add(key);
    }
    if (!entityKeys.size) return [];
    const aliases = [];
    for (const [alias, keys] of this._aliases) {
      if ([...entityKeys].some((key) => keys.has(key))) aliases.push(alias);
    }
    return aliases;
  }

  resolveQuery(query) {
    const text = String(query || '').normalize('NFKC').toLocaleLowerCase('ko-KR');
    // 카드 v3의 6개 빌더가 같은 턴에 같은 질의 문자열로 전부 이 메서드를
    // 부른다 — 직전 질의 하나만 기억해도 2~6번째 호출은 재계산 없이 끝난다.
    // replace()가 유일한 색인 변경점이라 거기서만 무효화하면 된다.
    if (this._resolveMemo && this._resolveMemo.text === text) return this._resolveMemo.result;

    const result = (() => {
      if (AMBIGUOUS_ENTITY_CONTEXT_RE.test(text)) return null;

      const explicitCodes = new Set(
        [...text.matchAll(/(?:^|\D)(\d{6})(?=\D|$)/g)].map((match) => match[1]),
      );
      if (explicitCodes.size > 1) return null;

      const matchedEntities = new Set();
      for (const code of explicitCodes) {
        const entities = this._aliases.get(code);
        if (!entities || entities.size !== 1) return null;
        matchedEntities.add([...entities][0]);
      }
      let matchedAlias = false;
      for (const [alias, entities] of this._aliases) {
        if (alias.length < 2 || /^\d{6}$/.test(alias) || !this._aliasSpans.get(alias).test(text)) continue;
        matchedAlias = true;
        if (entities.size !== 1) return null;
        matchedEntities.add([...entities][0]);
      }
      if (matchedEntities.size !== 1) return null;
      const entity = this._entities.get([...matchedEntities][0]);
      if (!entity) return null;
      return Object.freeze({
        code: entity.code,
        kind: entity.kind,
        market: entity.market,
        source: explicitCodes.size === 1 && !matchedAlias ? 'explicit-code' : 'entity-index',
      });
    })();
    this._resolveMemo = { text, result };
    return result;
  }
}

function extractStockMasterRecords(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.list)) return body.list;
  if (body && body.data && Array.isArray(body.data.list)) return body.data.list;
  throw new RestDatasetError('stock_master_shape', 'stock-master 응답에 list 배열이 없다');
}

function buildStockMasterRefreshRecords(marketRecords) {
  const reviewedMarkets = Object.keys(REVIEWED_MARKET_ENTITY_KIND);
  if (reviewedMarkets.some((market) => !Array.isArray(marketRecords[market]))) {
    throw new RestDatasetError('stock_master_incomplete', 'stock-master 0/10/8 전체 배치가 필요하다');
  }
  const candidatesByCode = new Map();
  for (const requestedMarket of reviewedMarkets) {
    for (const row of marketRecords[requestedMarket]) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new RestDatasetError('stock_master_row', 'stock-master 행은 객체여야 한다');
      }
      const code = String(row.code || row.stk_cd || '').trim();
      const name = String(row.name || row.stk_nm || '').trim();
      // ka10099 market 0은 aggregate 응답이다. 요청 시장을 추정값으로 쓰지
      // 않고 각 행이 반환한 시장만 신원 권위로 사용한다.
      const market = String(row.marketCode || row.market_code || '').trim();
      if (!/^\d{6}$/.test(code) || !name || !REVIEWED_MARKET_ENTITY_KIND[market]) continue;
      const candidate = Object.freeze({ code, name, market });
      const fingerprint = JSON.stringify(candidate);
      if (!candidatesByCode.has(code)) candidatesByCode.set(code, new Map());
      candidatesByCode.get(code).set(fingerprint, candidate);
    }
  }

  const accepted = [];
  for (const candidates of candidatesByCode.values()) {
    // aggregate/dedicated 응답의 동일 행은 한 종목이다. 이름이나 반환 시장이
    // 충돌하면 어느 쪽도 선택하지 않고 코드 전체를 제외한다.
    if (candidates.size === 1) accepted.push(candidates.values().next().value);
  }
  return accepted;
}

async function refreshStockEntityIndex(index, {
  backendBase,
  backendAccountAlias,
  fetchImpl = globalThis.fetch,
  markets = ['0', '10', '8'],
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  signal,
}) {
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(String(backendAccountAlias || ''))) {
    throw new RestDatasetError('missing_backend_account_alias', '조회에 사용할 서버 계좌가 연결되지 않았다');
  }
  const reviewedMarkets = markets
    .map(String)
    .filter((market, position, all) => REVIEWED_MARKET_ENTITY_KIND[market] && all.indexOf(market) === position);
  if (Object.keys(REVIEWED_MARKET_ENTITY_KIND).some((market) => !reviewedMarkets.includes(market))) {
    throw new RestDatasetError('stock_master_incomplete', 'stock-master refresh는 0/10/8 시장을 모두 조회해야 한다');
  }
  const marketRecords = {};
  for (let marketIndex = 0; marketIndex < reviewedMarkets.length; marketIndex += 1) {
    if (signal && signal.aborted) throw abortError(signal);
    const market = reviewedMarkets[marketIndex];
    const response = await fetchImpl(`${backendBase}/api/v1/tr/stockinfo/ka10099`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'X-Athena-Account': backendAccountAlias,
      },
      body: JSON.stringify({ mrkt_tp: market }),
      signal,
    });
    const body = await readJson(response, 'stock-master');
    marketRecords[market] = extractStockMasterRecords(body);
    // 같은 API ID는 초당 1회 제한이다. 대기 중에도 기존 snapshot을 유지한다.
    if (marketIndex < reviewedMarkets.length - 1) await waitWithAbort(wait, 1050, signal);
  }
  if (signal && signal.aborted) throw abortError(signal);
  const records = buildStockMasterRefreshRecords(marketRecords);
  // 모든 fetch/검증/충돌 제거가 성공한 뒤 단 한 번 게시한다.
  return index.replace(records);
}

function buildQuoteDataset(query, index, { idFactory = () => `rest-${Date.now().toString(36)}` } = {}) {
  const text = String(query || '').trim();
  const entity = index && index.resolveQuery(text);
  if (!entity || entity.kind !== 'stock' || !matchesStandaloneQuoteGrammar(text, index, entity)) return null;
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

// 일봉 차트 — base:ka10081(주식일봉차트조회요청)만 대상이다. base_dt는 "이
// 날짜까지"를 뜻하는 커서라 오늘 날짜를 준다(chart-reload.js의 today() 관례와
// 동일). upd_stkpc_tp:'1'은 수정주가 — AITS 차트 패널의 기본값과 맞춘다.
function buildChartDataset(query, index, {
  idFactory = () => `rest-${Date.now().toString(36)}`,
  today = kstToday,
} = {}) {
  const text = String(query || '').trim();
  const entity = index && index.resolveQuery(text);
  if (!entity || entity.kind !== 'stock' || !matchesStandaloneChartGrammar(text, index, entity)) return null;
  return {
    datasetId: String(idFactory()).slice(0, 64),
    question: text,
    items: [{
      itemId: 'primary-chart',
      ordinal: 1,
      operationRef: 'base:ka10081',
      args: { stk_cd: entity.code, base_dt: today(), upd_stkpc_tp: '1' },
      caption: null,
    }],
  };
}

function buildCompoundScreenDataset(query, index, {
  idFactory = () => `rest-${Date.now().toString(36)}`,
  today = kstToday,
} = {}) {
  const text = String(query || '').trim();
  const entity = index && index.resolveQuery(text);
  if (!entity || entity.kind !== 'stock') return null;
  const kinds = matchCompoundScreenCores(text, index, entity);
  if (!kinds) return null;
  return {
    datasetId: String(idFactory()).slice(0, 64),
    question: text,
    items: kinds.map((kind, indexInCompound) => restItemForScreenKind(
      kind,
      entity,
      indexInCompound + 1,
      today,
    )),
  };
}

// 호가 — detail:ka10004:aggregate_totals(호가 총잔량). base:ka10004는 split
// family라(SPLIT_BASE_TR_IDS) detail_group 없이는 resolve 자체가
// DETAIL_GROUP_REQUIRED로 거부된다(실측 — E2E 타이밍 프로브에서 422로 확인,
// buildQuoteDataset이 base:ka10001 대신 detail:ka10001:current_trading을
// 쓰는 것과 같은 이유). aggregate_totals(tot_sel_req/tot_buy_req)를 고른
// 근거는 card-kind-호가.js의 render호가()가 detectTotals()를 최우선
// 분기로 검사한다는 것 — 그 카드가 이미 이 조각을 1순위로 취급한다.
function buildOrderBookDataset(query, index, { idFactory = () => `rest-${Date.now().toString(36)}` } = {}) {
  const text = String(query || '').trim();
  const entity = index && index.resolveQuery(text);
  if (!entity || entity.kind !== 'stock' || !matchesStandaloneOrderBookGrammar(text, index, entity)) return null;
  return {
    datasetId: String(idFactory()).slice(0, 64),
    question: text,
    items: [{
      itemId: 'primary-orderbook',
      ordinal: 1,
      operationRef: 'detail:ka10004:aggregate_totals',
      args: { stk_cd: entity.code },
      caption: null,
    }],
  };
}

// 수급 — base:ka10061(종목별투자자기관별합계요청). 개인/외국인/기관 3행
// 스냅샷이 목적이라 시작일=종료일=오늘(단일 거래일)로 준다 — 추이가
// 필요하면(닫힌 문법 밖) 모델 경로로 넘어간다. amt_qty_tp:'1'(금액)·
// trde_tp:'0'(순매수, 백엔드 계약상 유일값)·unit_tp:'1000'(천주)은
// Ka10061Request 필수 필드의 API 문서 나열 첫 값을 그대로 쓴다(추측 아님).
function buildInvestorFlowDataset(query, index, {
  idFactory = () => `rest-${Date.now().toString(36)}`,
  today = kstToday,
} = {}) {
  const text = String(query || '').trim();
  const entity = index && index.resolveQuery(text);
  if (!entity || entity.kind !== 'stock' || !matchesStandaloneInvestorFlowGrammar(text, index, entity)) return null;
  const dt = today();
  return {
    datasetId: String(idFactory()).slice(0, 64),
    question: text,
    items: [{
      itemId: 'primary-investor-flow',
      ordinal: 1,
      operationRef: 'base:ka10061',
      args: {
        stk_cd: entity.code,
        strt_dt: dt,
        end_dt: dt,
        amt_qty_tp: '1',
        trde_tp: '0',
        unit_tp: '1000',
      },
      caption: null,
    }],
  };
}

// 거래원 — base:ka10038(종목별증권사순위요청). qry_tp:'2'(순매수순위정렬)를
// 기본값으로 쓴다 — "OO 거래원"류 질문은 보통 누가 사들이고 있는지를 묻는다.
function buildTradingSourceDataset(query, index, { idFactory = () => `rest-${Date.now().toString(36)}` } = {}) {
  const text = String(query || '').trim();
  const entity = index && index.resolveQuery(text);
  if (!entity || entity.kind !== 'stock' || !matchesStandaloneTradingSourceGrammar(text, index, entity)) return null;
  return {
    datasetId: String(idFactory()).slice(0, 64),
    question: text,
    items: [{
      itemId: 'primary-trading-source',
      ordinal: 1,
      operationRef: 'base:ka10038',
      args: { stk_cd: entity.code, qry_tp: '2' },
      caption: null,
    }],
  };
}

// 종목정보 — base:ka10100(종목정보 조회). ka10001은 detail 7종으로 쪼개져
// 있어(isEligibleOperationRef가 base:ka10001 자체를 이미 배제한다) 단일
// TR로 "종목정보 개요"에 대응하는 게 없다 — stk_cd 하나만 받는 ka10100이
// 정확히 그 개요 TR이다.
function buildStockInfoDataset(query, index, { idFactory = () => `rest-${Date.now().toString(36)}` } = {}) {
  const text = String(query || '').trim();
  const entity = index && index.resolveQuery(text);
  if (!entity || entity.kind !== 'stock' || !matchesStandaloneStockInfoGrammar(text, index, entity)) return null;
  return {
    datasetId: String(idFactory()).slice(0, 64),
    question: text,
    items: [{
      itemId: 'primary-stockinfo',
      ordinal: 1,
      operationRef: 'base:ka10100',
      args: { stk_cd: entity.code },
      caption: null,
    }],
  };
}

// 프로그램매매 — base:ka90005(프로그램매매추이요청 시간대별), 시장 전체
// 집계라 종목 결선이 없다. date는 오늘, amt_qty_tp:'1'(금액)·mrkt_tp:'P00101'
// (코스피/KRX)·min_tic_tp:'1'(분)·stex_tp:'1'(KRX)은 전부 Ka90005Request
// 필수 필드의 API 문서 첫 값 그대로다(추측 아님) — 코스닥 등 다른 시장은
// 닫힌 문법 밖(불확실하면 미매치).
function buildProgramTradeDataset(query, {
  idFactory = () => `rest-${Date.now().toString(36)}`,
  today = kstToday,
} = {}) {
  const text = String(query || '').trim();
  if (!matchesStandaloneProgramTradeGrammar(text)) return null;
  return {
    datasetId: String(idFactory()).slice(0, 64),
    question: text,
    items: [{
      itemId: 'primary-program-trade',
      ordinal: 1,
      operationRef: 'base:ka90005',
      args: {
        date: today(),
        amt_qty_tp: '1',
        mrkt_tp: 'P00101',
        min_tic_tp: '1',
        stex_tp: '1',
      },
      caption: null,
    }],
  };
}

module.exports = {
  MAX_ITEMS,
  MAX_CONCURRENCY,
  DEFAULT_FIRST_CANVAS_DEADLINE_MS,
  MAX_FIRST_CANVAS_DEADLINE_MS,
  ENTITY_INDEX_VERSION,
  STOCK_ENTITY_RESOLVER_ALGORITHM,
  STOCK_ENTITY_RESOLVER_VERSION,
  STOCK_ENTITY_RESOLVER_ADAPTER_VERSION,
  REVIEWED_MARKET_ENTITY_KIND,
  KOREAN_SCREEN_CORE,
  KOREAN_SCREEN_JOIN,
  RestDatasetError,
  StockEntityIndex,
  normalizeDataset,
  buildRetryAction,
  normalizeRecommendations,
  isEligibleOperationRef,
  buildDeterministicAnswer,
  buildQuoteDataset,
  buildChartDataset,
  buildCompoundScreenDataset,
  buildOrderBookDataset,
  buildInvestorFlowDataset,
  buildTradingSourceDataset,
  buildStockInfoDataset,
  buildProgramTradeDataset,
  refreshStockEntityIndex,
  runRestDataset,
};
