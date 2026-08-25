'use strict';

const crypto = require('crypto');

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8010';

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
  return brainReadyCache;
}

function isBrainReadyCached() {
  return brainReadyCache === true;
}

// 시도 조건(계획 §2(g)) — 토큰이 없거나 브레인이 준비 안 됐으면 시도 자체를
// 안 한다("해당 없음"과 "실패"의 구분 — 이 경우엔 배지도 없다).
function canAttemptSave() {
  return !!getBearerToken() && isBrainReadyCached();
}

async function postChatMessage({ conversationId, role, text, messageId, occurredAt }) {
  const token = getBearerToken();
  const res = await fetch(`${getBackendUrl()}/api/v1/brain/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      conversation_id: conversationId,
      role,
      text,
      message_id: messageId,
      occurred_at: occurredAt,
    }),
  });
  return { ok: res.ok, status: res.status };
}

function saveChatMessage({ conversationId, text, role }, { onSaveFailed, mdlog } = {}) {
  const messageId = crypto.randomUUID();
  if (!canAttemptSave()) return messageId; // 해당 없음 — 시도도 배지도 없음

  const occurredAt = new Date().toISOString();
  postChatMessage({ conversationId, role, text, messageId, occurredAt })
    .then((result) => {
      if (result.ok) return;
      if (mdlog) mdlog(`history-sink: 저장 실패 role=${role} status=${result.status}`);
      if (onSaveFailed) onSaveFailed({ messageId, role });
      // 저장 실패 시 재확인 허용(계획 §2(g)) — 다음 시도가 최신 상태를 반영하게
      // fire-and-forget으로 다시 조회한다(이 실패 자체를 막지 않는다).
      refreshBrainReady({ mdlog }).catch(() => {});
    })
    .catch((err) => {
      if (mdlog) mdlog(`history-sink: 저장 예외 role=${role} — ${String((err && err.message) || err)}`);
      if (onSaveFailed) onSaveFailed({ messageId, role });
      refreshBrainReady({ mdlog }).catch(() => {});
    });
  return messageId;
}

module.exports = {
  getBackendUrl,
  getBearerToken,
  fetchBrainStatus,
  refreshBrainReady,
  isBrainReadyCached,
  canAttemptSave,
  saveChatMessage,
  // 테스트 전용 — 모듈 스코프 캐시를 초기화한다(테스트 간 상태 누수 방지).
  _resetBrainReadyCacheForTest: () => { brainReadyCache = null; },
};
