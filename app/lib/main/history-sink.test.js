'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function freshHistorySink() {
  delete require.cache[require.resolve('./history-sink')];
  return require('./history-sink');
}

// prefs.js는 electron의 app.getPath('userData')를 거쳐 실제 디스크에 쓴다 — 이
// 테스트 파일은 순수 node --test(Electron 없음)로 돌아 그 경로를 못 태운다.
// require.cache에 가짜 exports를 심어 history-sink.js가 require('./prefs')로
// 보는 값을 통제한다(freshHistorySink()로 다시 불러오기 전에 심어야 한다).
function withMockPrefs(collectChat, fn) {
  const prefsPath = require.resolve('./prefs');
  const prevEntry = require.cache[prefsPath];
  require.cache[prefsPath] = {
    id: prefsPath,
    filename: prefsPath,
    loaded: true,
    exports: { get: () => ({ collectChat }), set: () => {} },
  };
  try {
    return fn();
  } finally {
    if (prevEntry) require.cache[prefsPath] = prevEntry;
    else delete require.cache[prefsPath];
  }
}

// fn이 async면 finally가 fn() 완료를 기다려야 한다 — 안 그러면(동기 try/finally)
// env 복원이 fn 내부의 await보다 먼저 실행돼(자바스크립트 try/finally는 반환값
// 프라미스가 settle되길 기다리지 않는다) 다음 테스트로 상태가 새는 레이스가 난다.
async function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test('getBearerToken: 미설정/공백이면 null — 시도 조건 판정의 기반', () => {
  withEnv({ ATHENA_LOCAL_BEARER_TOKEN: undefined }, () => {
    const historySink = freshHistorySink();
    assert.equal(historySink.getBearerToken(), null);
  });
  withEnv({ ATHENA_LOCAL_BEARER_TOKEN: '   ' }, () => {
    const historySink = freshHistorySink();
    assert.equal(historySink.getBearerToken(), null);
  });
  withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, () => {
    const historySink = freshHistorySink();
    assert.equal(historySink.getBearerToken(), 'tok');
  });
});

test('getBackendUrl: 기본값 127.0.0.1:8010, ATHENA_BACKEND_URL로 오버라이드 가능', () => {
  withEnv({ ATHENA_BACKEND_URL: undefined }, () => {
    const historySink = freshHistorySink();
    assert.equal(historySink.getBackendUrl(), 'http://127.0.0.1:8010');
  });
  withEnv({ ATHENA_BACKEND_URL: 'http://127.0.0.1:9999' }, () => {
    const historySink = freshHistorySink();
    assert.equal(historySink.getBackendUrl(), 'http://127.0.0.1:9999');
  });
});

test('canAttemptSave: 토큰 없으면 브레인 준비 상태와 무관하게 false — 시도 자체를 안 한다', () => {
  withEnv({ ATHENA_LOCAL_BEARER_TOKEN: undefined }, () => {
    const historySink = freshHistorySink();
    assert.equal(historySink.canAttemptSave(), false);
  });
});

test('canAttemptSave: 토큰 있어도 브레인 준비 캐시가 true가 아니면 false', () => {
  withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, () => {
    const historySink = freshHistorySink();
    assert.equal(historySink.canAttemptSave(), false); // refreshBrainReady를 아직 안 불렀다 — 미확인
  });
});

test('refreshBrainReady: fetch 실패(네트워크 예외)면 false — canAttemptSave도 false', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    const historySink = freshHistorySink();
    const prevFetch = global.fetch;
    global.fetch = async () => { throw new Error('ECONNREFUSED'); };
    try {
      const ready = await historySink.refreshBrainReady({});
      assert.equal(ready, false);
      assert.equal(historySink.canAttemptSave(), false);
    } finally {
      global.fetch = prevFetch;
    }
  });
});

test('refreshBrainReady: 200 + ready:true면 캐시가 true — canAttemptSave 통과', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    const historySink = freshHistorySink();
    const prevFetch = global.fetch;
    let seenUrl = null;
    let seenAuth = null;
    // 단언을 mock 안에서 던지지 않는다 — fetchBrainStatus가 try/catch로 감싸고
    // 있어서 여기서 던진 AssertionError가 "네트워크 실패"로 삼켜져 false가 나온다
    // (실제로 이 버그를 여기서 재현·수정했다). 값을 밖으로 빼서 나중에 단언한다.
    global.fetch = async (url, opts) => {
      seenUrl = url;
      seenAuth = opts.headers.Authorization;
      return { ok: true, json: async () => ({ ready: true }) };
    };
    try {
      const ready = await historySink.refreshBrainReady({});
      assert.equal(seenUrl, 'http://127.0.0.1:8010/api/v1/brain/status');
      assert.equal(seenAuth, 'Bearer tok');
      assert.equal(ready, true);
      assert.equal(historySink.canAttemptSave(), true);
    } finally {
      global.fetch = prevFetch;
    }
  });
});

test('saveChatMessage: 시도 조건 불충족이면 fetch를 아예 호출하지 않는다("해당 없음")', () => {
  withEnv({ ATHENA_LOCAL_BEARER_TOKEN: undefined }, () => {
    const historySink = freshHistorySink();
    const prevFetch = global.fetch;
    let called = false;
    global.fetch = async () => { called = true; return { ok: true, status: 200 }; };
    try {
      let failed = null;
      historySink.saveChatMessage(
        { conversationId: 'c1', text: '질문', role: 'user' },
        { onSaveFailed: (p) => { failed = p; } },
      );
      assert.equal(called, false);
      assert.equal(failed, null);
    } finally {
      global.fetch = prevFetch;
    }
  });
});

test('saveChatMessage: POST 실패(401)면 onSaveFailed({messageId, role})만 실어 보낸다 — 본문 없음', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    const historySink = freshHistorySink();
    const prevFetch = global.fetch;
    let chatCallCount = 0;
    global.fetch = async (url) => {
      if (url.endsWith('/api/v1/brain/status')) return { ok: true, json: async () => ({ ready: true }) };
      chatCallCount += 1;
      return { ok: false, status: 401 };
    };
    try {
      await historySink.refreshBrainReady({});
      const failed = await new Promise((resolve) => {
        historySink.saveChatMessage(
          { conversationId: 'c1', text: '민감한 채팅 본문', role: 'assistant' },
          { onSaveFailed: (p) => resolve(p) },
        );
      });
      assert.equal(chatCallCount, 1);
      assert.equal(failed.role, 'assistant');
      assert.equal(typeof failed.messageId, 'string');
      assert.deepEqual(Object.keys(failed).sort(), ['messageId', 'role']); // text/conversationId 누락 확인 — 함정 ⑫
    } finally {
      global.fetch = prevFetch;
    }
  });
});

test('saveChatMessage: fetch가 예외를 던져도(네트워크 다운) onSaveFailed가 불린다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    const historySink = freshHistorySink();
    const prevFetch = global.fetch;
    global.fetch = async (url) => {
      if (url.endsWith('/api/v1/brain/status')) return { ok: true, json: async () => ({ ready: true }) };
      throw new Error('ECONNREFUSED');
    };
    try {
      await historySink.refreshBrainReady({});
      const failed = await new Promise((resolve) => {
        historySink.saveChatMessage(
          { conversationId: 'c1', text: '질문', role: 'user' },
          { onSaveFailed: (p) => resolve(p) },
        );
      });
      assert.equal(failed.role, 'user');
    } finally {
      global.fetch = prevFetch;
    }
  });
});

test('saveChatMessage: 성공하면 messageId를 즉시 반환하고 onSaveFailed는 안 불린다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    const historySink = freshHistorySink();
    const prevFetch = global.fetch;
    let bodySent = null;
    global.fetch = async (url, opts) => {
      if (url.endsWith('/api/v1/brain/status')) return { ok: true, json: async () => ({ ready: true }) };
      bodySent = JSON.parse(opts.body);
      return { ok: true, status: 200 };
    };
    try {
      await historySink.refreshBrainReady({});
      let failed = false;
      const messageId = historySink.saveChatMessage(
        { conversationId: 'conv-1', text: '안녕', role: 'user' },
        { onSaveFailed: () => { failed = true; } },
      );
      assert.equal(typeof messageId, 'string');
      await new Promise((r) => setTimeout(r, 10)); // fire-and-forget 완료 대기
      assert.equal(failed, false);
      assert.equal(bodySent.conversation_id, 'conv-1');
      assert.equal(bodySent.role, 'user');
      assert.equal(bodySent.text, '안녕');
      assert.equal(bodySent.message_id, messageId);
      assert.equal(typeof bodySent.occurred_at, 'string');
    } finally {
      global.fetch = prevFetch;
    }
  });
});

test('saveChatMessage: collectChat=false면 토큰·브레인 준비가 멀쩡해도 저장 시도 자체를 안 한다(원문 미적재)', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    await withMockPrefs(false, async () => {
      const historySink = freshHistorySink();
      const prevFetch = global.fetch;
      let chatCallCount = 0;
      global.fetch = async (url) => {
        if (url.endsWith('/api/v1/brain/status')) return { ok: true, json: async () => ({ ready: true }) };
        chatCallCount += 1;
        return { ok: true, status: 200 };
      };
      try {
        await historySink.refreshBrainReady({});
        assert.equal(historySink.canAttemptSave(), false); // collectChat 게이트가 이유
        let failed = null;
        historySink.saveChatMessage(
          { conversationId: 'c1', text: '민감한 채팅 본문', role: 'user' },
          { onSaveFailed: (p) => { failed = p; } },
        );
        assert.equal(chatCallCount, 0);
        assert.equal(failed, null);
      } finally {
        global.fetch = prevFetch;
      }
    });
  });
});

test('canAttemptSave: collectChat=true면 기존 토큰·브레인 준비 조건만 그대로 적용된다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    await withMockPrefs(true, async () => {
      const historySink = freshHistorySink();
      const prevFetch = global.fetch;
      global.fetch = async () => ({ ok: true, json: async () => ({ ready: true }) });
      try {
        await historySink.refreshBrainReady({});
        assert.equal(historySink.canAttemptSave(), true);
      } finally {
        global.fetch = prevFetch;
      }
    });
  });
});
