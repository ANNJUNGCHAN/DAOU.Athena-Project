'use strict';

const MAX_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 160;

function fail(code, error, extra = {}) {
  return { ok: false, code, error, ...extra };
}

function requireShellSender(event, isShellSender) {
  if (!event || !isShellSender(event.sender)) {
    throw new Error('루틴 메인 카드는 셸 창에서만 열 수 있다');
  }
}

function normalizeId(value, label) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > MAX_ID_LENGTH) throw new TypeError(`${label}가 올바르지 않다`);
  return id;
}

function cloneJsonValue(value, depth = 0) {
  if (depth > 8) throw new TypeError('카드 인자 중첩이 너무 깊다');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => cloneJsonValue(item, depth + 1));
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('카드 인자는 JSON 객체여야 한다');
  }
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new TypeError('허용되지 않는 카드 인자 키가 있다');
    }
    output[key] = cloneJsonValue(item, depth + 1);
  }
  return output;
}

function normalizeDescriptor(candidate, isEligibleOperationRef) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('확정할 메인 카드 후보가 없다');
  }
  const allowedKeys = new Set(['operation_ref', 'args', 'title']);
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) {
    throw new TypeError('메인 카드 후보에 허용되지 않는 필드가 있다');
  }
  const operationRef = typeof candidate.operation_ref === 'string' ? candidate.operation_ref.trim() : '';
  if (!isEligibleOperationRef(operationRef)) {
    throw new TypeError('조회 전용 메인 카드 operation_ref만 허용한다');
  }
  const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
  if (!title || title.length > MAX_TITLE_LENGTH) throw new TypeError('메인 카드 제목이 올바르지 않다');
  return {
    operation_ref: operationRef,
    args: cloneJsonValue(candidate.args || {}),
    title,
  };
}

function detailData(result) {
  if (!result || !result.ok) return null;
  const body = result.data;
  if (body && typeof body === 'object' && body.routine && typeof body.routine === 'object') {
    return body.routine;
  }
  return body && typeof body === 'object' ? body : null;
}

function kstToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function expandDynamicArgs(args, today) {
  const expanded = cloneJsonValue(args);
  if (expanded.base_dt === '$today') expanded.base_dt = today();
  return expanded;
}

function createRoutineMainCardHandlers({
  routineHttp,
  runDataset,
  isShellSender,
  getActiveConversationId,
  isEligibleOperationRef,
  registerConversation,
  idFactory = () => `routine-main-card-${Date.now().toString(36)}`,
  now = () => Date.now(),
  today = () => kstToday(),
} = {}) {
  if (typeof routineHttp !== 'function') throw new TypeError('routineHttp가 필요하다');
  if (typeof runDataset !== 'function') throw new TypeError('runDataset이 필요하다');
  if (typeof isShellSender !== 'function') throw new TypeError('isShellSender가 필요하다');
  if (typeof getActiveConversationId !== 'function') throw new TypeError('getActiveConversationId가 필요하다');
  if (typeof isEligibleOperationRef !== 'function') throw new TypeError('isEligibleOperationRef가 필요하다');
  if (typeof registerConversation !== 'function') throw new TypeError('registerConversation이 필요하다');

  function scopeMatches(conversationId) {
    return getActiveConversationId() === conversationId;
  }

  async function confirm(event, payload = {}) {
    requireShellSender(event, isShellSender);
    try {
      const id = normalizeId(payload.id, '루틴 id');
      const expectedCandidate = normalizeDescriptor(payload.expected_candidate, isEligibleOperationRef);
      return await routineHttp(
        'POST',
        `/api/v1/routines/${encodeURIComponent(id)}/main-card/confirm`,
        { expected_candidate: expectedCandidate },
      );
    } catch (error) {
      return fail('invalid_main_card_candidate', String((error && error.message) || error));
    }
  }

  async function open(event, payload = {}) {
    requireShellSender(event, isShellSender);
    const keys = Object.keys(payload || {});
    if (keys.some((key) => key !== 'id' && key !== 'conversationId')) {
      return fail('invalid_open_binding', '알람 카드 열기에는 루틴 id와 대화 id만 허용된다');
    }

    let id;
    let conversationId;
    try {
      id = normalizeId(payload.id, '루틴 id');
      conversationId = normalizeId(payload.conversationId, '대화 id');
    } catch (error) {
      return fail('invalid_open_binding', String((error && error.message) || error));
    }
    if (!scopeMatches(conversationId)) {
      return fail('conversation_changed', '선택한 대화가 바뀌어 알람 카드를 열지 않았다', { id, conversationId });
    }

    let detail;
    try {
      detail = await routineHttp('GET', `/api/v1/routines/${encodeURIComponent(id)}`);
    } catch (error) {
      return fail('routine_detail_failed', String((error && error.message) || error), { id, conversationId });
    }
    if (!detail || !detail.ok) {
      return fail('routine_detail_failed', detail && detail.error ? detail.error : '알람 정보를 불러오지 못했다', {
        id, conversationId, status: detail && detail.status,
      });
    }
    if (!scopeMatches(conversationId)) {
      return fail('conversation_changed', '선택한 대화가 바뀌어 알람 카드를 열지 않았다', { id, conversationId });
    }

    const routine = detailData(detail);
    if (!routine || !routine.main_card || !routine.main_card_confirmed_at) {
      return fail('main_card_not_confirmed', '이 알람에 확정된 메인 카드가 없다', { id, conversationId });
    }

    let descriptor;
    try {
      descriptor = normalizeDescriptor(routine.main_card, isEligibleOperationRef);
    } catch (error) {
      return fail('invalid_persisted_main_card', String((error && error.message) || error), { id, conversationId });
    }
    if (typeof routine.symbol !== 'string' || descriptor.args.stk_cd !== routine.symbol) {
      return fail('invalid_persisted_main_card', '확정된 카드의 종목이 알람 종목과 일치하지 않는다', {
        id, conversationId,
      });
    }

    const captured = [];
    const scopeController = new AbortController();
    const dataset = {
      datasetId: String(idFactory()).slice(0, 64),
      question: descriptor.operation_ref,
      items: [{
        itemId: 'routine-main-card',
        ordinal: 1,
        operationRef: descriptor.operation_ref,
        args: expandDynamicArgs(descriptor.args, today),
        caption: descriptor.title,
      }],
    };
    let result;
    try {
      result = await runDataset(dataset, {
        conversationId,
        signal: scopeController.signal,
        emitCanvas: async (card) => {
          if (!scopeMatches(conversationId)) {
            scopeController.abort(new Error('conversation_changed'));
            throw new Error('conversation_changed');
          }
          if (captured.length || card.operationRef !== descriptor.operation_ref) {
            throw new Error('unexpected_main_card_result');
          }
          captured.push({ status: 'success', envelope: card.envelope });
          return {
            verifiedVisible: false,
            visiblePaintAt: now(),
            renderState: card.envelope && card.envelope.state ? card.envelope.state : 'data',
          };
        },
      });
    } catch (error) {
      const code = String((error && error.message) || error) === 'conversation_changed'
        ? 'conversation_changed'
        : 'main_card_query_failed';
      return fail(code, code === 'conversation_changed'
        ? '선택한 대화가 바뀌어 알람 카드를 열지 않았다'
        : String((error && error.message) || error), { id, conversationId });
    }

    if (!scopeMatches(conversationId)) {
      return fail('conversation_changed', '선택한 대화가 바뀌어 알람 카드를 열지 않았다', { id, conversationId });
    }
    if (!result || !result.ok || result.dataCanvasCount !== 1 || captured.length !== 1) {
      return fail('main_card_query_failed', (result && result.error) || '알람 카드를 불러오지 못했다', {
        id, conversationId,
      });
    }
    registerConversation({ conversationId, title: descriptor.title });
    return { ok: true, id, conversationId, card: captured[0] };
  }

  return { confirm, open };
}

module.exports = { createRoutineMainCardHandlers, normalizeDescriptor };
