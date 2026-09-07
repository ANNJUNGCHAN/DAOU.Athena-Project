'use strict';

const crypto = require('crypto');
const prefs = require('./prefs');
const { ChatHistoryStore } = require('./chat-history-store');

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8010';
const MAX_CHAT_MESSAGE_CHARS = 20_000;

function getBackendUrl() {
  return process.env.ATHENA_BACKEND_URL || DEFAULT_BACKEND_URL;
}

function getBearerToken() {
  const raw = process.env.ATHENA_LOCAL_BEARER_TOKEN;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed || null;
}

// 브레인 준비 상태 캐시 — "부팅 후 status GET 1회(+저장 실패 시 재확인 허용)"
// (계획 §2(g)). null=미확인(시도 안 함과 동일하게 취급 — canAttemptSave()는
// true일 때만 통과한다).
let brainReadyCache = null;
let chatHistoryStore = null;
let configuredChatHistoryDbPath = null;
let pendingFlush = null;
let historyGeneration = 0;
let lastCollectChatEnabled = null;
const transmissionControllers = new Set();
const inFlightTransmissions = new Set();

function makeSaveReceipt(status, messageId, details = {}) {
  return Object.freeze({
    status,
    messageId,
    persisted: status === 'persisted',
    skipped: status === 'skipped',
    failed: status === 'failed',
    ...details,
  });
}

function cancelChatTransmissions() {
  historyGeneration += 1;
  for (const controller of transmissionControllers) controller.abort();
  transmissionControllers.clear();
}

function readCollectChatState() {
  try {
    return { enabled: prefs.get().collectChat !== false, reason: null };
  } catch {
    return { enabled: false, reason: 'prefs_unavailable' };
  }
}

function observeCollectChatState() {
  const state = readCollectChatState();
  if (!state.enabled && lastCollectChatEnabled !== false) cancelChatTransmissions();
  lastCollectChatEnabled = state.enabled;
  return state;
}

function beginTransmission(store) {
  const controller = new AbortController();
  const context = { controller, generation: historyGeneration, store };
  transmissionControllers.add(controller);
  return context;
}

function endTransmission(context) {
  transmissionControllers.delete(context.controller);
}

function transmissionAllowed(context) {
  if (
    context.controller.signal.aborted
    || context.generation !== historyGeneration
    || context.store !== chatHistoryStore
    || !context.store
    || context.store.closed
  ) return false;
  return observeCollectChatState().enabled;
}

function trackTransmission(promise) {
  let tracked;
  tracked = Promise.resolve(promise)
    .catch(() => {})
    .finally(() => { inFlightTransmissions.delete(tracked); });
  inFlightTransmissions.add(tracked);
  return tracked;
}

function configureChatHistoryStore({ dbPath } = {}) {
  const resolvedPath = dbPath || process.env.ATHENA_CHAT_HISTORY_DB_PATH;
  if (typeof resolvedPath !== 'string' || !resolvedPath.trim()) {
    throw new TypeError('chat history dbPath is required');
  }
  cancelChatTransmissions();
  if (chatHistoryStore) chatHistoryStore.close();
  configuredChatHistoryDbPath = resolvedPath;
  chatHistoryStore = new ChatHistoryStore({ dbPath: resolvedPath });
  return chatHistoryStore;
}

function getChatHistoryStore() {
  if (chatHistoryStore) return chatHistoryStore;
  return configureChatHistoryStore({ dbPath: configuredChatHistoryDbPath || process.env.ATHENA_CHAT_HISTORY_DB_PATH });
}

function closeChatHistoryStore() {
  cancelChatTransmissions();
  if (chatHistoryStore) chatHistoryStore.close();
  chatHistoryStore = null;
  pendingFlush = null;
}

async function fetchBrainStatus({ mdlog } = {}) {
  const token = getBearerToken();
  if (!token) return false;
  try {
    const res = await fetch(`${getBackendUrl()}/api/v1/brain/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const body = await res.json();
    return !!(body && body.ready);
  } catch (err) {
    if (mdlog) mdlog(`history-sink: brain/status 조회 실패 — ${String((err && err.message) || err)}`);
    return false;
  }
}

async function refreshBrainReady(opts) {
  brainReadyCache = await fetchBrainStatus(opts);
  // WP-I(G-I6) — backend는 기동 시 게이트를 안전측 False로 시작하므로(lifespan.py),
  // 브레인 준비를 확인한 이 자리에서 저장된 exposeToModel 값을 밀어 넣어야
  // 재기동·재연결 후에도 토글 상태가 실제 게이트에 반영된다. 실패는 이 폴링을
  // 막지 않는다 — 다음 준비 확인 때 다시 민다.
  if (brainReadyCache) pushExposeToModel(opts).catch(() => {});
  return brainReadyCache;
}

// exposeToModel 현재값을 backend 게이트에 민다(WP-I I4). prefs 조회가 안 되는
// 환경(순수 node --test)이나 토큰 미설정 배포에서는 조용히 건너뛴다 — 밀 값이
// 없거나 밀 방법이 없는 것이지 실패가 아니다.
async function pushExposeToModel({ mdlog } = {}) {
  const token = getBearerToken();
  if (!token) return false;
  let enabled;
  try {
    enabled = prefs.get().exposeToModel === true;
  } catch {
    return false;
  }
  try {
    const res = await fetch(`${getBackendUrl()}/api/v1/settings/expose-to-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok && mdlog) mdlog(`history-sink: expose-to-model 동기화 실패 status=${res.status}`);
    return res.ok;
  } catch (err) {
    if (mdlog) mdlog(`history-sink: expose-to-model 동기화 예외 — ${String((err && err.message) || err)}`);
    return false;
  }
}

function isBrainReadyCached() {
  return brainReadyCache === true;
}

// WP-D1(그래프 후속 계획) — collectChat이 꺼져 있으면 저장 자체를 시도하지
// 않는다(원문 미적재). prefs 조회 자체가 실패해도 개인정보 수집 동의를 확인할
// 수 없으므로 fail-closed로 저장과 전송을 모두 막는다.
function collectChatEnabled() {
  return observeCollectChatState().enabled;
}

// 시도 조건(계획 §2(g)) — 토큰이 없거나 브레인이 준비 안 됐거나 collectChat이
// 꺼져 있으면 시도 자체를 안 한다("해당 없음"과 "실패"의 구분 — 이 경우엔
// 배지도 없다).
function canAttemptSave() {
  return !!getBearerToken() && isBrainReadyCached() && collectChatEnabled();
}

async function postChatMessage({ conversationId, role, text, messageId, occurredAt, signal }) {
  const token = getBearerToken();
  const res = await fetch(`${getBackendUrl()}/api/v1/brain/chat`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      conversation_id: conversationId,
      role,
      text,
      message_id: messageId,
      occurred_at: occurredAt,
    }),
  });
  if (!res.ok) return { ok: false, status: res.status, errorCode: `http-${res.status}` };
  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, status: res.status, errorCode: 'invalid-response' };
  }
  const expectedSourceId = `chat:${messageId}`;
  if (!body || body.source_id !== expectedSourceId) {
    return { ok: false, status: res.status, errorCode: 'source-id-mismatch' };
  }
  return { ok: true, status: res.status, sourceId: body.source_id };
}

function reportSaveFailure({ messageId, role, onSaveFailed, mdlog, status, errorCode, err }) {
  if (mdlog) {
    const detail = errorCode
      ? `오류=${errorCode}`
      : status == null
      ? `예외=${String((err && err.message) || err)}`
      : `status=${status}`;
    mdlog(`history-sink: 저장 실패 role=${role} ${detail}`);
  }
  if (onSaveFailed) onSaveFailed({ messageId, role });
}

function saveChatMessage(
  { conversationId, text, role, messageId = crypto.randomUUID(), occurredAt = new Date().toISOString() },
  { onSaveFailed, mdlog } = {},
) {
  const collectState = observeCollectChatState();
  if (!collectState.enabled) {
    return makeSaveReceipt('skipped', messageId, { reason: collectState.reason || 'collect_chat_disabled' });
  }
  const textLength = typeof text === 'string' ? Array.from(text).length : 0;
  if (typeof text !== 'string' || textLength === 0 || textLength > MAX_CHAT_MESSAGE_CHARS) {
    if (typeof onSaveFailed === 'function') onSaveFailed({ messageId, role, reason: 'invalid_message_length' });
    return makeSaveReceipt('failed', messageId, { reason: 'invalid_message_length' });
  }

  // 저장은 fire-and-forget 계약이다 — 스토어 미구성(dbPath 없음)·디스크 오류가
  // 여기서 동기 throw로 새면 render_canvas 핸들러 전체가 죽어 턴이 얼어붙는다
  // (2026-08-31 실측: ATHENA_CHAT_HISTORY_DB_PATH 부재 환경에서 첫 저장 시도가
  // 턴을 통째로 reject시켰다). 실패는 이미 있는 onSaveFailed("기록 안 됨" 배지)
  // 경로로만 알린다.
  let store;
  let inserted;
  try {
    store = getChatHistoryStore();
    inserted = store.persistMessage({ conversationId, text, role, messageId, occurredAt });
  } catch (err) {
    if (mdlog) mdlog(`대화 기록 저장 불가 — ${String((err && err.message) || err)}`);
    if (typeof onSaveFailed === 'function') onSaveFailed({ messageId, role, reason: 'store_unavailable' });
    return makeSaveReceipt('failed', messageId, { reason: 'store_unavailable' });
  }
  const receipt = makeSaveReceipt('persisted', messageId, { inserted });
  if (!inserted || !canAttemptSave()) return receipt;

  const context = beginTransmission(store);
  trackTransmission((async () => {
    try {
      if (!transmissionAllowed(context)) return;
      const result = await postChatMessage({
        conversationId, role, text, messageId, occurredAt, signal: context.controller.signal,
      });
      if (!transmissionAllowed(context)) return;
      if (result.ok) {
        store.markSynced(messageId);
        return;
      }
      store.markPendingAttempt(messageId, result.errorCode || `http-${result.status}`);
      reportSaveFailure({
        messageId, role, onSaveFailed, mdlog, status: result.status, errorCode: result.errorCode,
      });
      refreshBrainReady({ mdlog }).catch(() => {});
    } catch (err) {
      if (!transmissionAllowed(context)) return;
      store.markPendingAttempt(messageId, 'network-error');
      reportSaveFailure({ messageId, role, onSaveFailed, mdlog, err });
      refreshBrainReady({ mdlog }).catch(() => {});
    } finally {
      endTransmission(context);
    }
  })());
  return receipt;
}

function flushPendingChatMessages({
  onSaveFailed,
  mdlog,
  limit,
  batchSize = limit == null ? 100 : limit,
  maxBatches = 10,
} = {}) {
  if (pendingFlush) return pendingFlush;
  pendingFlush = (async () => {
    const store = getChatHistoryStore();
    const safeBatchSize = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 100;
    const safeMaxBatches = Number.isInteger(maxBatches) && maxBatches > 0 ? maxBatches : 10;
    const pending = store.countPendingMessages();
    const counts = { pending, attempted: 0, synced: 0, failed: 0, remaining: pending };
    if (!canAttemptSave()) return counts;
    const context = beginTransmission(store);

    try {
      let cancelled = false;
      for (let batch = 0; batch < safeMaxBatches && !cancelled; batch += 1) {
        if (!transmissionAllowed(context)) break;
        const rows = store.getPendingMessages({ limit: safeBatchSize });
        if (rows.length === 0) break;
        let batchFailed = false;
        for (const row of rows) {
          if (!transmissionAllowed(context)) {
            cancelled = true;
            break;
          }
          counts.attempted += 1;
          try {
          const result = await postChatMessage({
            conversationId: row.conversation_id,
            role: row.role,
            text: row.text,
            messageId: row.message_id,
            occurredAt: row.occurred_at,
            signal: context.controller.signal,
          });
          if (!transmissionAllowed(context)) {
            cancelled = true;
            break;
          }
          if (result.ok) {
            store.markSynced(row.message_id);
            counts.synced += 1;
            continue;
          }
          store.markPendingAttempt(row.message_id, result.errorCode || `http-${result.status}`);
          counts.failed += 1;
          batchFailed = true;
          reportSaveFailure({
            messageId: row.message_id,
            role: row.role,
            onSaveFailed,
            mdlog,
            status: result.status,
            errorCode: result.errorCode,
          });
          } catch (err) {
            if (!transmissionAllowed(context)) {
              cancelled = true;
              break;
            }
            store.markPendingAttempt(row.message_id, 'network-error');
            counts.failed += 1;
            batchFailed = true;
            reportSaveFailure({ messageId: row.message_id, role: row.role, onSaveFailed, mdlog, err });
          }
        }
        // 실패한 행은 pending 선두에 남는다. 같은 flush에서 즉시 재시도하지 않고
        // 다음 부팅/주기 갱신으로 넘겨 호출당 작업량과 오류 폭주를 제한한다.
        if (batchFailed) break;
      }
      if (store === chatHistoryStore && !store.closed) counts.remaining = store.countPendingMessages();
      else counts.remaining = 0;
      return counts;
    } finally {
      endTransmission(context);
    }
  })().finally(() => { pendingFlush = null; });
  return pendingFlush;
}

function purgePendingChatMessages() {
  cancelChatTransmissions();
  lastCollectChatEnabled = false;
  return getChatHistoryStore().purgePendingMessages();
}

// 프로바이더 런타임 전용 경로(ATHENA_PROVIDER_RUNTIME=1) — 위 saveChatMessage는
// 설계상 절대 throw하지 않는 fire-and-forget이라 "성공까지 기다렸다가 실패면 거절"
// 하는 commit barrier 계약을 만족할 수 없다. 그 계약이 필요한 호출부(app/main.js의
// commitSuccess)를 위해 별도 함수로 둔다.
function startChatMessageSave({ conversationId, text, role }, { onSaveFailed, mdlog } = {}) {
  const messageId = crypto.randomUUID();
  if (!canAttemptSave()) return { messageId, attempted: false, completion: Promise.resolve() };

  const occurredAt = new Date().toISOString();
  const completion = postChatMessage({ conversationId, role, text, messageId, occurredAt })
    .then((result) => {
      if (result.ok) return;
      if (mdlog) mdlog(`history-sink: 저장 실패 role=${role} status=${result.status}`);
      if (onSaveFailed) onSaveFailed({ messageId, role });
      // 저장 실패 시 재확인 허용(계획 §2(g)) — 다음 시도가 최신 상태를 반영하게
      // fire-and-forget으로 다시 조회한다(이 실패 자체를 막지 않는다).
      refreshBrainReady({ mdlog }).catch(() => {});
      throw new Error(`history persistence failed with status ${result.status}`);
    })
    .catch((err) => {
      if (!String((err && err.message) || err).startsWith('history persistence failed with status')) {
        if (mdlog) mdlog(`history-sink: 저장 예외 role=${role} — ${String((err && err.message) || err)}`);
        if (onSaveFailed) onSaveFailed({ messageId, role });
        refreshBrainReady({ mdlog }).catch(() => {});
      }
      throw err;
    });
  return { messageId, attempted: true, completion };
}

async function saveChatMessageAwaited(input, options) {
  const operation = startChatMessageSave(input, options);
  await operation.completion;
  return operation.messageId;
}

module.exports = {
  getBackendUrl,
  getBearerToken,
  fetchBrainStatus,
  refreshBrainReady,
  pushExposeToModel,
  isBrainReadyCached,
  canAttemptSave,
  collectChatEnabled,
  configureChatHistoryStore,
  closeChatHistoryStore,
  saveChatMessage,
  flushPendingChatMessages,
  purgePendingChatMessages,
  MAX_CHAT_MESSAGE_CHARS,
  saveChatMessageAwaited,
  // 테스트 전용 — 모듈 스코프 캐시를 초기화한다(테스트 간 상태 누수 방지).
  _resetBrainReadyCacheForTest: () => { brainReadyCache = null; },
  _resetForTest: () => {
    closeChatHistoryStore();
    configuredChatHistoryDbPath = null;
    brainReadyCache = null;
    lastCollectChatEnabled = null;
  },
  _getChatHistoryStoreForTest: () => getChatHistoryStore(),
};
