'use strict';

const { extractToolResultBlocks, normalizeToolResultContent } = require('./stream-json-parser');

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30분 — 판정(라우팅)은 데이터보다 오래 유효하다
const DEFAULT_MAX_ENTRIES = 200;

const REPLAYABLE_INTENTS = new Set(['auto', 'query']);

function isSensitiveCacheKey(key) {
  const raw = String(key || '');
  const normalized = raw.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  return normalized === 'data'
    || normalized === 'payload'
    || normalized === 'plantoken'
    || /^(?:account|acct|acnt)/.test(normalized)
    || /^order/.test(normalized)
    || /^ord(?!inal)/.test(normalized)
    || /계좌|주문/.test(raw);
}

function sanitizeCacheValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeCacheValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !isSensitiveCacheKey(key))
    .map(([key, child]) => [key, sanitizeCacheValue(child)]));
}

function pick(input, snakeName, camelName) {
  if (!input || typeof input !== 'object') return undefined;
  return input[snakeName] ?? input[camelName];
}

// 캐시 리플레이는 canonical assertion이 있는 REST 선택만 허용한다. 주문 여부를
// TR 접두어로 추측하지 않는다(kt*에도 조회 API가 있다). 실제 cache 가능 카드인지
// 여부는 backend manifest가 돌려준 canvas type으로 buildReplayJudgment가 판단한다.
// candidate_refs는 검색 recall 힌트일 뿐이라 판정 객체에 복사하지 않는다.
function isReplaySafePreferredRef(value) {
  const ref = String(value || '').trim();
  if (!/^(?:base|detail):[^:]+(?::[^:]+)?$/i.test(ref)) return false;
  const operationId = ref.split(':')[1].toLowerCase();
  return !operationId.startsWith('ws') && !operationId.startsWith('oauth');
}

function buildReplayJudgment(resolveInput, renderInput, actualCanvasTypes, resolvedPlanToken) {
  if (!resolveInput || !renderInput || !renderInput.plan_token || !resolvedPlanToken) return null;
  if (String(renderInput.plan_token) !== String(resolvedPlanToken)) return null;
  const authoritativeTypes = Array.isArray(actualCanvasTypes) ? actualCanvasTypes : [];
  // 한 턴에 여러 계획이 섞이면 마지막 resolve/render 캡처가 어느 실제 카드와
  // 대응하는지 보장할 수 없다. 단일 manifest 카드만 캐시해 교차 재생을 막는다.
  if (authoritativeTypes.length !== 1
      || (authoritativeTypes[0] !== 'chart' && authoritativeTypes[0] !== 'table')) return null;

  const resolveIntent = String(resolveInput.intent || 'auto').toLowerCase();
  const preferredRef = pick(resolveInput, 'preferred_ref', 'preferredRef');
  if (!REPLAYABLE_INTENTS.has(resolveIntent) || !isReplaySafePreferredRef(preferredRef)) return null;

  return {
    resolveQuestion: resolveInput.question,
    resolveIntent,
    resolveArgs: resolveInput.arguments || {},
    preferredRef: String(preferredRef),
    detailGroup: pick(resolveInput, 'detail_group', 'detailGroup') ?? null,
    responseMode: pick(resolveInput, 'response_mode', 'responseMode') || 'auto',
    caption: renderInput.caption || null,
  };
}

function parseToolResultObject(content) {
  const normalized = normalizeToolResultContent(content);
  const texts = normalized.kind === 'string'
    ? [normalized.text]
    : normalized.kind === 'blocks'
      ? normalized.blocks
        .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
      : [];
  for (const text of texts) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // 다른 text 블록이 실제 JSON일 수 있다. 끝까지 확인한다.
    }
  }
  return null;
}

// 한 live turn 안에서 tool_use_id를 최소 상관키로 사용한다. resolve 입력만 보고
// 마지막 render와 결합하지 않고, 그 resolve의 성공 tool_result가 발급한 토큰과
// render 입력 토큰이 같을 때만 재생 판정을 만든다.
class ReplayTurnCapture {
  constructor() {
    this._resolveCalls = [];
    this._resolveByToolUseId = new Map();
    this._renderCalls = [];
  }

  observe(event) {
    if (event && typeof event.type === 'string' && event.payload
        && (event.type === 'tool_started' || event.type === 'tool_completed'
          || event.type === 'canvas_result')) {
      this.observeProviderEvent(event);
      return;
    }
    const content = event && event.message && event.message.content;
    if (event && event.type === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        if (!block || block.type !== 'tool_use' || !block.input) continue;
        const name = String(block.name || '');
        if (name.endsWith('athena_resolve')) {
          const call = { toolUseId: block.id || null, input: block.input, planToken: null };
          this._resolveCalls.push(call);
          if (call.toolUseId) this._resolveByToolUseId.set(call.toolUseId, call);
        } else if (name.endsWith('athena__render_canvas')) {
          this._renderCalls.push(block.input);
        }
      }
    }

    for (const result of extractToolResultBlocks(event)) {
      const call = this._resolveByToolUseId.get(result.toolUseId);
      if (!call || result.isError) continue;
      const body = parseToolResultObject(result.content);
      if (body && body.plan_token) call.planToken = String(body.plan_token);
    }
  }

  observeProviderEvent(event) {
    const payload = event && event.payload;
    if (!payload || typeof payload !== 'object') return;
    if (event.type === 'tool_started') {
      const name = String(payload.canonicalToolName || '');
      if (name.endsWith('athena_resolve') && payload.input) {
        const call = {
          toolUseId: payload.toolUseId || null,
          input: payload.input,
          planToken: null,
        };
        this._resolveCalls.push(call);
        if (call.toolUseId) this._resolveByToolUseId.set(call.toolUseId, call);
      } else if (name.endsWith('athena__render_canvas') && payload.input) {
        this._renderCalls.push(payload.input);
      }
      return;
    }

    if (event.type === 'tool_completed') {
      const call = this._resolveByToolUseId.get(payload.toolUseId);
      if (!call || payload.isError) return;
      const body = parseToolResultObject(payload.content);
      if (body && body.plan_token) call.planToken = String(body.plan_token);
    }
  }

  buildJudgment(actualCanvasTypes) {
    if (this._resolveCalls.length !== 1 || this._renderCalls.length !== 1) return null;
    const resolveCall = this._resolveCalls[0];
    if (!resolveCall.planToken) return null;
    return buildReplayJudgment(
      resolveCall.input,
      this._renderCalls[0],
      actualCanvasTypes,
      resolveCall.planToken,
    );
  }
}

// 완전일치 전 정규화 — 대소문자·공백·말미 문장부호만 다듬는다(의미 변형 없음).
function normalizeQuery(query) {
  return String(query || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[?!.…~\s]+$/g, '')
    .toLowerCase();
}

class QueryCache {
  constructor(opts = {}) {
    this._ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this._maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this._clock = opts.clock || Date.now;
    this._map = new Map(); // 삽입 순서 = FIFO 축출 순서
  }

  get(query) {
    const key = normalizeQuery(query);
    if (!key) return null;
    const entry = this._map.get(key);
    if (!entry) return null;
    if (this._clock() - entry.storedAt > this._ttlMs) {
      this._map.delete(key);
      return null;
    }
    return sanitizeCacheValue(entry.judgment);
  }

  set(query, judgment) {
    const key = normalizeQuery(query);
    if (!key || !judgment) return;
    if (this._map.has(key)) this._map.delete(key); // 재삽입 — 최신이 뒤로
    this._map.set(key, { storedAt: this._clock(), judgment: sanitizeCacheValue(judgment) });
    while (this._map.size > this._maxEntries) {
      const oldest = this._map.keys().next().value;
      this._map.delete(oldest);
    }
  }

  invalidate(query) {
    this._map.delete(normalizeQuery(query));
  }

  size() {
    return this._map.size;
  }
}

// UMD 불필요 — 메인 프로세스 전용 CommonJS.
module.exports = {
  QueryCache,
  normalizeQuery,
  isReplaySafePreferredRef,
  sanitizeCacheValue,
  buildReplayJudgment,
  parseToolResultObject,
  ReplayTurnCapture,
  DEFAULT_TTL_MS,
  DEFAULT_MAX_ENTRIES,
};
