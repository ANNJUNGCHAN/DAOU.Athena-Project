'use strict';

// 대화별 실행 런타임(2026-09-08 다중 대화 동시 진행) — main.js가 앱 전역 싱글턴으로
// 들고 있던 "진행 중 질의 핸들·REST/Selector fast-path 컨트롤러·--resume 커서·상주
// claude 세션·busy 카운터"를 대화 id 단위로 쪼갠다. 한 대화가 답을 기다리는 동안
// 다른 대화가 자기 프로세스로 질의할 수 있고, 잠금·선점은 같은 대화 안에서만 성립한다.
//
// 순수 자료구조다 — Electron·자식 프로세스를 직접 만들지 않는다. 상주 세션은 호출자가
// 준 팩토리로 게으르게 만들고, 유휴 세션이 상한을 넘으면 가장 오래 안 쓴 것부터 stop한다
// (claude -p 프로세스 하나가 수백 MB라 대화 수만큼 무한히 살릴 수 없다). 진행 중(busy)
// 세션은 절대 건드리지 않는다 — 상한은 유휴에만 적용된다.

const DEFAULT_MAX_IDLE_CHAT_SESSIONS = 3;

function createRuntime(conversationId, now) {
  return {
    conversationId,
    busyDepth: 0,
    activeLiveQuery: null,
    activeRestRun: null,
    activeSelectorFastRun: null,
    // undefined = 아직 레코드(athena-conversations.json)의 커서를 읽지 않았다.
    // null = 명시적 새 대화, 문자열 = 그 세션에서 --resume.
    liveSessionId: undefined,
    chatSession: null,
    lastUsedAt: now(),
  };
}

function createConversationRuntimes({
  maxIdleChatSessions = DEFAULT_MAX_IDLE_CHAT_SESSIONS,
  now = () => Date.now(),
} = {}) {
  const runtimes = new Map();
  const idleCap = Math.max(0, Number(maxIdleChatSessions) || 0);

  function get(conversationId) {
    const id = String(conversationId || '');
    let runtime = runtimes.get(id);
    if (!runtime) {
      runtime = createRuntime(id, now);
      runtimes.set(id, runtime);
    }
    runtime.lastUsedAt = now();
    return runtime;
  }

  function peek(conversationId) {
    return runtimes.get(String(conversationId || '')) || null;
  }

  function isBusy(conversationId) {
    const runtime = peek(conversationId);
    return !!runtime && runtime.busyDepth > 0;
  }

  function busyIds() {
    const ids = [];
    for (const runtime of runtimes.values()) if (runtime.busyDepth > 0) ids.push(runtime.conversationId);
    return ids;
  }

  function sessionIsIdle(session) {
    if (!session || typeof session.snapshot !== 'function') return true;
    let snap = null;
    try { snap = session.snapshot(); } catch { return true; }
    return !snap || snap.state === 'idle' || snap.state === 'down';
  }

  function stopSession(runtime, reason) {
    const session = runtime.chatSession;
    runtime.chatSession = null;
    if (!session) return;
    try { session.stop(reason || new Error('conversation runtime evicted')); } catch { /* already stopping */ }
  }

  // 유휴 세션 상한 — 새 세션을 만들 자리를 비운다. 지금 만들려는 대화는 제외한다.
  function evictIdleSessions(exceptId) {
    const idle = [];
    for (const runtime of runtimes.values()) {
      if (!runtime.chatSession || runtime.conversationId === exceptId) continue;
      if (runtime.busyDepth > 0 || !sessionIsIdle(runtime.chatSession)) continue;
      idle.push(runtime);
    }
    idle.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    while (idle.length >= Math.max(1, idleCap)) {
      const victim = idle.shift();
      stopSession(victim, new Error('유휴 상주 세션 상한 — 가장 오래 안 쓴 대화의 세션을 닫았다'));
    }
  }

  function chatSession(conversationId, factory) {
    const runtime = get(conversationId);
    if (!runtime.chatSession) {
      evictIdleSessions(runtime.conversationId);
      runtime.chatSession = factory(runtime.conversationId);
    }
    return runtime.chatSession;
  }

  function forEachChatSession(fn) {
    for (const runtime of runtimes.values()) {
      if (runtime.chatSession) fn(runtime.chatSession, runtime);
    }
  }

  function stopAllChatSessions(reason) {
    for (const runtime of runtimes.values()) stopSession(runtime, reason);
  }

  // 프로바이더 전환처럼 "지금부터 새 세션"이 필요한 경우 — 답변 중인 대화의 세션은 건드리지 않는다.
  // 그 대화는 턴이 끝난 뒤 다음 질의에서 스스로 갈아탄다.
  function stopIdleChatSessions(reason) {
    for (const runtime of runtimes.values()) {
      if (runtime.busyDepth > 0 || !sessionIsIdle(runtime.chatSession)) continue;
      stopSession(runtime, reason);
    }
  }

  // 프로바이더가 바뀌면 이전 프로바이더의 세션 커서는 전부 무효다(main.js noteLiveQueryProvider).
  function clearCursors() {
    for (const runtime of runtimes.values()) runtime.liveSessionId = null;
  }

  // 답변 중인 대화의 커서는 그 턴이 끝나며 다시 적히므로 여기서 지우지 않는다.
  function clearIdleCursors() {
    for (const runtime of runtimes.values()) if (runtime.busyDepth === 0) runtime.liveSessionId = null;
  }

  function dispose(conversationId, reason) {
    const runtime = peek(conversationId);
    if (!runtime) return false;
    stopSession(runtime, reason);
    runtimes.delete(runtime.conversationId);
    return true;
  }

  function snapshot() {
    const rows = [];
    for (const runtime of runtimes.values()) {
      rows.push({
        conversationId: runtime.conversationId,
        busyDepth: runtime.busyDepth,
        hasChatSession: !!runtime.chatSession,
        liveSessionId: runtime.liveSessionId === undefined ? undefined : runtime.liveSessionId,
      });
    }
    return rows;
  }

  return Object.freeze({
    get, peek, isBusy, busyIds, chatSession, forEachChatSession, stopAllChatSessions, stopIdleChatSessions,
    clearCursors, clearIdleCursors, dispose, snapshot,
    size: () => runtimes.size,
  });
}

module.exports = { createConversationRuntimes, DEFAULT_MAX_IDLE_CHAT_SESSIONS };
