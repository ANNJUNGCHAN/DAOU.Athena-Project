// 채팅 → HistoryStore 영속 훅 (합의 계획 .omc/plans/plan-chat-graph-pipeline.md
// §2(a)/(g), 단계 1a/1b). main.js의 runLiveQuery가 사용자 질의 진입 직후
// role:user 1건, 응답(answerText) 산출 직후 null이 아니면 role:assistant 1건을
// fire-and-forget으로 이 모듈에 넘긴다 — 채팅 UX를 절대 막지 않는다(await 금지,
// 호출부 주석 참조).
//
// 라우트 계약(고정, 백엔드는 다른 에이전트가 병렬 구현):
//   POST {ATHENA_BACKEND_URL 기본 http://127.0.0.1:8010}/api/v1/brain/chat
//   헤더 Authorization: Bearer <로컬 베어러 토큰>
//   body {conversation_id, role, text, message_id, occurred_at(ISO)} → 200/401/503
//   GET  .../api/v1/brain/status (동일 bearer) → {ready, ingestion_ready, extraction_enabled, fts_ready}
//
// 토큰 소스 실측: 이 저장소에서 Electron main이 backend를 호출한 선례가 이
// 훅 전에는 없었다(accounts.js는 키움 upstream을 직접 부르지, 이 앱의 backend를
// 안 부른다 — backend-launcher.js의 checkHealth()도 인증 불필요한 부트스트랩
// 엔드포인트만 친다). backend/.env.example의 ATHENA_LOCAL_BEARER_TOKEN은
// pydantic-settings가 backend 프로세스 안에서만 읽는 값이고, Electron은 그
// .env를 로드하지 않는다 — 그래서 여기서는 같은 프로세스 환경에 그대로
// 노출돼 있어야 하는 `process.env.ATHENA_LOCAL_BEARER_TOKEN`을 직접 읽는다
// (CLAUDE.md §0 "자격증명은 프로세스 메모리에만" — 디스크에 안 옮겨 적는다).
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

// 채팅 1건 저장 — fire-and-forget. 반환값은 messageId뿐(호출부가 실패 IPC와
// 짝지을 때 쓴다) — 프라미스 자체는 호출부가 await하지 않는다.
// **채팅 본문(text)을 로그에 남기지 않는다** — mdlog에는 role/성공여부/상태코드만
// 싣는다(CLAUDE.md §6, 함정 ⑫).
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
