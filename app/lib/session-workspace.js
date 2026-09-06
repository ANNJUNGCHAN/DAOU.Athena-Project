// 모드 워크스페이스 계약(42번 보드 "환경 전체가 저장된다"). 각 모드 화면(그래프·에이전트·
// 플러그인·백테스트)은 자기 상태를 여기 등록하고, 복원 때 자기 상태를 돌려받는다.
// chat.js의 restoreConversation은 어느 모드가 무엇을 저장하는지 모른다 — kind로 찾아
// 넘길 뿐이다. 보고는 조각(patch)이고 병합·저장 시점은 main·session-bridge가 정한다.
//
// 등록:  window.AthenaSessionWorkspace.register('backtest', { restore(workspace) {...}, flush() {...}, clear() {...} })
// 보고:  window.AthenaSessionWorkspace.report({ form: {...} })   // 바뀐 조각만
// 흘리기: window.AthenaSessionWorkspace.flush()  // 세션 전환 직전, 지연 보고를 지금 보낸다
// 거두기: window.AthenaSessionWorkspace.clear()  // 세션 전환 직후, 앞 세션의 표식을 거둔다
// 복원:  restore(workspace) — workspace.kind의 핸들러에 통째로 넘긴다. 핸들러가 없으면 false.
(function () {
'use strict';

function createSessionWorkspace({ send, warn } = {}) {
  const handlers = new Map();
  const emit = typeof send === 'function' ? send : () => {};
  const complain = typeof warn === 'function' ? warn : () => {};

  function register(kind, handler) {
    if (typeof kind !== 'string' || !kind) throw new TypeError('workspace kind must be a non-empty string');
    if (!handler || typeof handler.restore !== 'function') throw new TypeError(`workspace handler for ${kind} needs restore()`);
    handlers.set(kind, handler);
    return () => { if (handlers.get(kind) === handler) handlers.delete(kind); };
  }

  function has(kind) {
    return handlers.has(kind);
  }

  // 조각 보고. 객체가 아니면 보내지 않는다 — 빈 보고로 저장본을 흐리지 않는다.
  function report(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
    emit({ patch });
    return true;
  }

  // 세션을 갈아타기 직전에 부른다 — 모드가 지연 보고(디바운스)를 들고 있으면 지금 흘린다.
  // main은 **받은 시점의** 세션에 적으므로(historyConversationId), 전환 뒤에 도착한 보고는
  // 앞 세션의 작업공간을 다음 세션의 기록에 적는다.
  function flush() {
    for (const [kind, handler] of handlers) {
      if (!handler || typeof handler.flush !== 'function') continue;
      try { handler.flush(); }
      catch (error) { complain(`workspace flush(${kind}) failed — ${String((error && error.message) || error)}`); }
    }
  }

  // 세션을 갈아탔다 — 되살렸던 것은 그 세션의 것이지 다음 세션의 것이 아니다. flush()와
  // 짝이다: flush()가 앞 세션에 적을 것을 마저 보내고, clear()가 앞 세션의 것을 화면에서
  // 거둔다. 갈아탄 곳이 그 모드가 아니어도(대화 세션·새 대화) restore()는 오지 않으므로
  // 이 문이 없으면 되살린 적 없는 화면에 앞 세션의 복원 표식이 남는다.
  function clear() {
    for (const [kind, handler] of handlers) {
      if (!handler || typeof handler.clear !== 'function') continue;
      try { handler.clear(); }
      catch (error) { complain(`workspace clear(${kind}) failed — ${String((error && error.message) || error)}`); }
    }
  }

  // 복원. 핸들러가 던져도 복원 전체(메시지·초안·스크롤)는 이미 끝났으니 여기서 삼키고 알린다.
  function restore(workspace) {
    if (!workspace || typeof workspace !== 'object' || typeof workspace.kind !== 'string') return false;
    const handler = handlers.get(workspace.kind);
    if (!handler) return false;
    const fail = (error) => complain(`workspace restore(${workspace.kind}) failed — ${String((error && error.message) || error)}`);
    try {
      const result = handler.restore(workspace);
      // 비동기 핸들러(지도 그리기 등)의 실패도 같은 경고로 — 조용한 거부(unhandled rejection)를 남기지 않는다.
      if (result && typeof result.catch === 'function') result.catch(fail);
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  }

  return { register, has, report, flush, clear, restore };
}

const __exports = { createSessionWorkspace };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.SessionWorkspace = __exports;
  // 렌더러 전역 하나 — 모드 화면들이 여기에 등록한다. 채널이 없는 하네스에서도 죽지 않는다.
  window.AthenaSessionWorkspace = createSessionWorkspace({
    send: (payload) => { try { window.athena.send('athena:session-workspace', payload); } catch { /* 하네스 */ } },
    warn: (message) => console.warn(message),
  });
}

})();
