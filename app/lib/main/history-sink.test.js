'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function freshHistorySink() {
  delete require.cache[require.resolve('./history-sink')];
  const historySink = require('./history-sink');
  historySink.configureChatHistoryStore({ dbPath: ':memory:' });
  return historySink;
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

async function withThrowingPrefs(fn) {
  const prefsPath = require.resolve('./prefs');
  const prevEntry = require.cache[prefsPath];
  require.cache[prefsPath] = {
    id: prefsPath,
    filename: prefsPath,
    loaded: true,
    exports: { get: () => { throw new Error('prefs unreadable'); }, set: () => {} },
  };
  try {
    return await fn();
  } finally {
    if (prevEntry) require.cache[prefsPath] = prevEntry;
    else delete require.cache[prefsPath];
  }
}

async function withMutablePrefs(initialValues, fn) {
  const values = { ...initialValues };
  const prefsPath = require.resolve('./prefs');
  const prevEntry = require.cache[prefsPath];
  require.cache[prefsPath] = {
    id: prefsPath,
    filename: prefsPath,
    loaded: true,
    exports: { get: () => ({ ...values }), set: () => {} },
  };
  try {
    return await fn(values);
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
      // ready:true 확인 뒤엔 expose-to-model 재동기화(WP-I G-I6)가 이어서
      // 나간다 — 이 테스트는 status 조회 쪽만 본다.
      if (String(url).endsWith('/api/v1/brain/status')) {
        seenUrl = url;
        seenAuth = opts.headers.Authorization;
      }
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

test('saveChatMessage: 토큰/브레인 준비가 없어도 HTTP 없이 로컬 pending 원문을 먼저 저장한다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: undefined }, async () => {
    const historySink = freshHistorySink();
    const prevFetch = global.fetch;
    let called = false;
    global.fetch = async () => { called = true; return { ok: true, status: 200 }; };
    try {
      let failed = null;
      const receipt = historySink.saveChatMessage(
        { conversationId: 'c1', text: '질문', role: 'user' },
        { onSaveFailed: (p) => { failed = p; } },
      );
      assert.deepEqual(receipt, {
        status: 'persisted', messageId: receipt.messageId,
        persisted: true, skipped: false, failed: false, inserted: true,
      });
      assert.equal(called, false);
      assert.equal(failed, null);
      const row = historySink._getChatHistoryStoreForTest().getMessage(receipt.messageId);
      assert.equal(row.text, '질문');
      assert.equal(row.sync_state, 'pending');
    } finally {
      global.fetch = prevFetch;
      historySink.closeChatHistoryStore();
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
      // expose-to-model 재동기화(WP-I G-I6)는 이 테스트의 관심 밖 — chat POST만 센다.
      if (!url.endsWith('/api/v1/brain/chat')) return { ok: true, status: 200 };
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
      const row = historySink._getChatHistoryStoreForTest().getMessage(failed.messageId);
      assert.equal(row.text, '민감한 채팅 본문');
      assert.equal(row.sync_state, 'pending');
      assert.equal(row.last_error_code, 'http-401');
    } finally {
      global.fetch = prevFetch;
      historySink.closeChatHistoryStore();
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
      const row = historySink._getChatHistoryStoreForTest().getMessage(failed.messageId);
      assert.equal(row.sync_state, 'pending');
      assert.equal(row.last_error_code, 'network-error');
    } finally {
      global.fetch = prevFetch;
      historySink.closeChatHistoryStore();
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
      return {
        ok: true,
        status: 200,
        json: async () => ({ source_id: `chat:${bodySent.message_id}` }),
      };
    };
    try {
      await historySink.refreshBrainReady({});
      let failed = false;
      const receipt = historySink.saveChatMessage(
        { conversationId: 'conv-1', text: '안녕', role: 'user' },
        { onSaveFailed: () => { failed = true; } },
      );
      assert.equal(receipt.status, 'persisted');
      assert.equal(typeof receipt.messageId, 'string');
      await new Promise((r) => setTimeout(r, 10)); // fire-and-forget 완료 대기
      assert.equal(failed, false);
      assert.equal(bodySent.conversation_id, 'conv-1');
      assert.equal(bodySent.role, 'user');
      assert.equal(bodySent.text, '안녕');
      assert.equal(bodySent.message_id, receipt.messageId);
      assert.equal(typeof bodySent.occurred_at, 'string');
      assert.equal(historySink._getChatHistoryStoreForTest().getMessage(receipt.messageId).sync_state, 'synced');
    } finally {
      global.fetch = prevFetch;
      historySink.closeChatHistoryStore();
    }
  });
});

test('saveChatMessageAwaited: 성공 응답까지 기다리고 실패는 commit barrier로 거부한다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    const historySink = freshHistorySink();
    const prevFetch = global.fetch;
    let postOk = true;
    // 성공 응답은 ACK 계약(source_id === `chat:${messageId}`)까지 만족해야 한다 —
    // postChatMessage가 2xx만으로는 성공으로 치지 않는다.
    global.fetch = async (url, opts) => {
      if (url.endsWith('/api/v1/brain/status')) return { ok: true, json: async () => ({ ready: true }) };
      if (!postOk) return { ok: false, status: 503 };
      const body = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ source_id: `chat:${body.message_id}` }) };
    };
    try {
      await historySink.refreshBrainReady({});
      const messageId = await historySink.saveChatMessageAwaited(
        { conversationId: 'conv-1', text: '완료', role: 'assistant' },
      );
      assert.equal(typeof messageId, 'string');
      postOk = false;
      await assert.rejects(
        historySink.saveChatMessageAwaited(
          { conversationId: 'conv-1', text: '실패', role: 'assistant' },
        ),
        /history persistence failed/,
      );
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
        // expose-to-model 재동기화(WP-I G-I6)는 이 테스트의 관심 밖 — chat POST만 센다.
        if (!url.endsWith('/api/v1/brain/chat')) return { ok: true, status: 200 };
        chatCallCount += 1;
        return { ok: true, status: 200 };
      };
      try {
        await historySink.refreshBrainReady({});
        assert.equal(historySink.canAttemptSave(), false); // collectChat 게이트가 이유
        let failed = null;
        const receipt = historySink.saveChatMessage(
          { conversationId: 'c1', text: '민감한 채팅 본문', role: 'user' },
          { onSaveFailed: (p) => { failed = p; } },
        );
        assert.deepEqual(receipt, {
          status: 'skipped', messageId: receipt.messageId,
          persisted: false, skipped: true, failed: false, reason: 'collect_chat_disabled',
        });
        assert.equal(chatCallCount, 0);
        assert.equal(failed, null);
        assert.equal(historySink._getChatHistoryStoreForTest().countPendingMessages(), 0);
      } finally {
        global.fetch = prevFetch;
        historySink.closeChatHistoryStore();
      }
    });
  });
});

test('saveChatMessage: SQLite 저장 실패는 failed receipt이고 chat POST는 0회다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    await withMockPrefs(true, async () => {
      const historySink = freshHistorySink();
      const store = historySink._getChatHistoryStoreForTest();
      const originalPersist = store.persistMessage;
      const prevFetch = global.fetch;
      let chatCallCount = 0;
      global.fetch = async (url) => {
        if (String(url).endsWith('/api/v1/brain/chat')) chatCallCount += 1;
        return { ok: true, status: 200, json: async () => ({ ready: true }) };
      };
      store.persistMessage = () => { throw new Error('SQLITE_FULL'); };
      try {
        await historySink.refreshBrainReady({});
        const receipt = historySink.saveChatMessage({
          conversationId: 'failed-db', role: 'user', text: '저장되면 안 됨', messageId: 'db-fail',
        });
        assert.deepEqual(receipt, {
          status: 'failed', messageId: 'db-fail',
          persisted: false, skipped: false, failed: true, reason: 'store_unavailable',
        });
        assert.equal(chatCallCount, 0);
      } finally {
        store.persistMessage = originalPersist;
        global.fetch = prevFetch;
        historySink.closeChatHistoryStore();
      }
    });
  });
});

test('saveChatMessage: collectChat prefs 조회 실패는 fail-closed skipped이고 SQLite/HTTP를 건드리지 않는다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    await withThrowingPrefs(async () => {
      const historySink = freshHistorySink();
      const prevFetch = global.fetch;
      let fetchCount = 0;
      global.fetch = async () => { fetchCount += 1; return { ok: true, status: 200 }; };
      try {
        const receipt = historySink.saveChatMessage({
          conversationId: 'prefs-fail', role: 'user', text: '저장되면 안 됨', messageId: 'prefs-fail',
        });
        assert.deepEqual(receipt, {
          status: 'skipped', messageId: 'prefs-fail',
          persisted: false, skipped: true, failed: false, reason: 'prefs_unavailable',
        });
        assert.equal(fetchCount, 0);
        assert.equal(historySink._getChatHistoryStoreForTest().countPendingMessages(), 0);
      } finally {
        global.fetch = prevFetch;
        historySink.closeChatHistoryStore();
      }
    });
  });
});

test('saveChatMessage: 동일 messageId 재호출은 원문을 덮어쓰거나 중복 저장하지 않는다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: undefined }, async () => {
    const historySink = freshHistorySink();
    try {
      const first = historySink.saveChatMessage({
        conversationId: 'c1', text: '원본', role: 'user', messageId: 'fixed-id',
        occurredAt: '2026-08-31T00:00:00.000Z',
      });
      const second = historySink.saveChatMessage({
        conversationId: 'c2', text: '변경 시도', role: 'assistant', messageId: 'fixed-id',
        occurredAt: '2026-08-31T01:00:00.000Z',
      });
      assert.equal(first.messageId, 'fixed-id');
      assert.equal(first.status, 'persisted');
      assert.equal(first.inserted, true);
      assert.equal(second.messageId, 'fixed-id');
      assert.equal(second.status, 'persisted');
      assert.equal(second.inserted, false);
      const store = historySink._getChatHistoryStoreForTest();
      assert.equal(store.countPendingMessages(), 1);
      assert.equal(store.getMessage('fixed-id').text, '원본');
    } finally {
      historySink.closeChatHistoryStore();
    }
  });
});

test('saveChatMessage: 프로세스 재시작처럼 모듈을 다시 열어도 pending 원문이 남는다', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-history-sink-'));
  const dbPath = path.join(dir, 'chat.sqlite3');
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: undefined }, async () => {
    let historySink = freshHistorySink();
    historySink.configureChatHistoryStore({ dbPath });
    const receipt = historySink.saveChatMessage({ conversationId: 'restart', text: '재시작 후에도 보존', role: 'user' });
    historySink.closeChatHistoryStore();

    historySink = freshHistorySink();
    historySink.configureChatHistoryStore({ dbPath });
    assert.equal(historySink._getChatHistoryStoreForTest().getMessage(receipt.messageId).text, '재시작 후에도 보존');
    assert.equal(historySink._getChatHistoryStoreForTest().countPendingMessages(), 1);
    historySink.closeChatHistoryStore();
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('flushPendingChatMessages: 부분 성공만 synced 처리하고 동시 호출은 한 번만 전송한다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    const historySink = freshHistorySink();
    const prevFetch = global.fetch;
    const chatIds = [];
    const failedPayloads = [];
    let releaseFirst;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    global.fetch = async (url, opts) => {
      if (String(url).endsWith('/api/v1/brain/status')) return { ok: true, json: async () => ({ ready: true }) };
      if (!String(url).endsWith('/api/v1/brain/chat')) return { ok: true, status: 200 };
      const body = JSON.parse(opts.body);
      chatIds.push(body.message_id);
      if (chatIds.length === 1) await firstGate;
      return body.message_id === 'm2'
        ? { ok: false, status: 503 }
        : { ok: true, status: 200, json: async () => ({ source_id: `chat:${body.message_id}` }) };
    };
    try {
      historySink.saveChatMessage({ conversationId: 'c', role: 'user', text: '1', messageId: 'm1' });
      historySink.saveChatMessage({ conversationId: 'c', role: 'assistant', text: '2', messageId: 'm2' });
      historySink.saveChatMessage({ conversationId: 'c', role: 'user', text: '3', messageId: 'm3' });
      assert.equal(historySink._getChatHistoryStoreForTest().countPendingMessages(), 3);
      await historySink.refreshBrainReady({});

      const flush1 = historySink.flushPendingChatMessages({ onSaveFailed: (payload) => failedPayloads.push(payload) });
      const flush2 = historySink.flushPendingChatMessages({ onSaveFailed: (payload) => failedPayloads.push(payload) });
      releaseFirst();
      const [result1, result2] = await Promise.all([flush1, flush2]);
      assert.deepEqual(result1, { pending: 3, attempted: 3, synced: 2, failed: 1, remaining: 1 });
      assert.deepEqual(result2, result1);
      assert.deepEqual(chatIds, ['m1', 'm2', 'm3']);
      assert.deepEqual(failedPayloads, [{ messageId: 'm2', role: 'assistant' }]);
      assert.equal(historySink._getChatHistoryStoreForTest().getMessage('m2').sync_state, 'pending');
      assert.equal(historySink._getChatHistoryStoreForTest().getMessage('m1').sync_state, 'synced');
    } finally {
      global.fetch = prevFetch;
      historySink.closeChatHistoryStore();
    }
  });
});

test('flushPendingChatMessages: bounded batch를 반복해 모든 pending을 전송한다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    const historySink = freshHistorySink();
    const prevFetch = global.fetch;
    const sent = [];
    global.fetch = async (url, opts) => {
      if (String(url).endsWith('/api/v1/brain/status')) return { ok: true, json: async () => ({ ready: true }) };
      if (!String(url).endsWith('/api/v1/brain/chat')) return { ok: true, status: 200 };
      const body = JSON.parse(opts.body);
      sent.push(body.message_id);
      return { ok: true, status: 200, json: async () => ({ source_id: `chat:${body.message_id}` }) };
    };
    try {
      for (let index = 0; index < 5; index += 1) {
        historySink.saveChatMessage({
          conversationId: 'batch', role: 'user', text: `message-${index}`,
          messageId: `batch-${index}`, occurredAt: `2026-08-31T00:00:0${index}.000Z`,
        });
      }
      await historySink.refreshBrainReady({});
      const result = await historySink.flushPendingChatMessages({ batchSize: 2, maxBatches: 3 });
      assert.deepEqual(result, { pending: 5, attempted: 5, synced: 5, failed: 0, remaining: 0 });
      assert.deepEqual(sent, ['batch-0', 'batch-1', 'batch-2', 'batch-3', 'batch-4']);
    } finally {
      global.fetch = prevFetch;
      historySink.closeChatHistoryStore();
    }
  });
});

test('flushPendingChatMessages: maxBatches를 넘겨 같은 호출에서 무한 처리하지 않는다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    const historySink = freshHistorySink();
    const prevFetch = global.fetch;
    const sent = [];
    global.fetch = async (url, opts) => {
      if (String(url).endsWith('/api/v1/brain/status')) return { ok: true, json: async () => ({ ready: true }) };
      if (!String(url).endsWith('/api/v1/brain/chat')) return { ok: true, status: 200 };
      const body = JSON.parse(opts.body);
      sent.push(body.message_id);
      return { ok: true, status: 200, json: async () => ({ source_id: `chat:${body.message_id}` }) };
    };
    try {
      for (let index = 0; index < 5; index += 1) {
        historySink.saveChatMessage({
          conversationId: 'bounded', role: 'user', text: `${index}`,
          messageId: `bounded-${index}`, occurredAt: `2026-08-31T00:00:0${index}.000Z`,
        });
      }
      await historySink.refreshBrainReady({});
      const result = await historySink.flushPendingChatMessages({ batchSize: 2, maxBatches: 2 });
      assert.deepEqual(result, { pending: 5, attempted: 4, synced: 4, failed: 0, remaining: 1 });
      assert.deepEqual(sent, ['bounded-0', 'bounded-1', 'bounded-2', 'bounded-3']);
    } finally {
      global.fetch = prevFetch;
      historySink.closeChatHistoryStore();
    }
  });
});

test('2xx여도 source_id가 messageId와 일치해야 ACK하고 원문을 지운다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    const historySink = freshHistorySink();
    const prevFetch = global.fetch;
    global.fetch = async (url, opts) => {
      if (String(url).endsWith('/api/v1/brain/status')) return { ok: true, json: async () => ({ ready: true }) };
      if (!String(url).endsWith('/api/v1/brain/chat')) return { ok: true, status: 200 };
      const body = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ source_id: body.message_id === 'ok' ? 'chat:ok' : 'chat:other' }) };
    };
    try {
      historySink.saveChatMessage({ conversationId: 'c', role: 'user', text: '지워질 원문', messageId: 'ok' });
      historySink.saveChatMessage({ conversationId: 'c', role: 'user', text: '남아야 할 원문', messageId: 'mismatch' });
      await historySink.refreshBrainReady({});
      const result = await historySink.flushPendingChatMessages({ batchSize: 10, maxBatches: 1 });
      assert.deepEqual(result, { pending: 2, attempted: 2, synced: 1, failed: 1, remaining: 1 });
      assert.equal(historySink._getChatHistoryStoreForTest().getMessage('ok').text, '');
      assert.equal(historySink._getChatHistoryStoreForTest().getMessage('mismatch').text, '남아야 할 원문');
      assert.equal(historySink._getChatHistoryStoreForTest().getMessage('mismatch').last_error_code, 'source-id-mismatch');
    } finally {
      global.fetch = prevFetch;
      historySink.closeChatHistoryStore();
    }
  });
});

test('purgePendingChatMessages: collectChat 해제 시 아직 전송하지 않은 원문을 제거한다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: undefined }, async () => {
    const historySink = freshHistorySink();
    try {
      historySink.saveChatMessage({ conversationId: 'c', role: 'user', text: '삭제 대상', messageId: 'purge-me' });
      assert.equal(historySink.purgePendingChatMessages(), 1);
      assert.equal(historySink._getChatHistoryStoreForTest().getMessage('purge-me'), null);
    } finally {
      historySink.closeChatHistoryStore();
    }
  });
});

test('재활성화 전 purge가 실패하면 stale 원문은 전송되지 않고 OFF에서만 제거할 수 있다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    await withMutablePrefs({ collectChat: false, exposeToModel: false }, async (values) => {
      const historySink = freshHistorySink();
      const prevFetch = global.fetch;
      const posted = [];
      try {
        const store = historySink._getChatHistoryStoreForTest();
        values.collectChat = true;
        historySink.saveChatMessage({ conversationId: 'c', role: 'user', text: 'stale raw text', messageId: 'stale' });
        values.collectChat = false;

        const originalPurge = store.purgePendingMessages.bind(store);
        store.purgePendingMessages = () => { throw new Error('disk locked'); };
        assert.throws(() => historySink.purgePendingChatMessages(), /disk locked/);

        global.fetch = async (url, opts = {}) => {
          if (String(url).endsWith('/api/v1/brain/status')) return { ok: true, json: async () => ({ ready: true }) };
          if (String(url).endsWith('/api/v1/brain/chat')) posted.push(JSON.parse(opts.body).message_id);
          return { ok: true, status: 200, json: async () => ({ source_id: 'chat:stale' }) };
        };
        await historySink.refreshBrainReady({});
        assert.deepEqual(await historySink.flushPendingChatMessages(), { pending: 1, attempted: 0, synced: 0, failed: 0, remaining: 1 });
        assert.deepEqual(posted, []);

        store.purgePendingMessages = originalPurge;
        assert.equal(historySink.purgePendingChatMessages(), 1);
        values.collectChat = true;
        assert.deepEqual(await historySink.flushPendingChatMessages(), { pending: 0, attempted: 0, synced: 0, failed: 0, remaining: 0 });
        assert.deepEqual(posted, []);
      } finally {
        global.fetch = prevFetch;
        historySink.closeChatHistoryStore();
      }
    });
  });
});

test('flushPendingChatMessages: 수집 해제+purge가 진행 중 POST를 취소하고 후속 POST/ACK를 막는다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    await withMutablePrefs({ collectChat: true, exposeToModel: false }, async (values) => {
      const historySink = freshHistorySink();
      const prevFetch = global.fetch;
      const chatIds = [];
      let chatSignal = null;
      let releaseChat;
      let notifyChatStarted;
      const chatStarted = new Promise((resolve) => { notifyChatStarted = resolve; });
      const chatGate = new Promise((resolve) => { releaseChat = resolve; });
      global.fetch = async (url, opts = {}) => {
        if (String(url).endsWith('/api/v1/brain/status')) {
          return { ok: true, status: 200, json: async () => ({ ready: true }) };
        }
        if (!String(url).endsWith('/api/v1/brain/chat')) return { ok: true, status: 200 };
        const body = JSON.parse(opts.body);
        chatIds.push(body.message_id);
        chatSignal = opts.signal;
        notifyChatStarted();
        await chatGate;
        return { ok: true, status: 200, json: async () => ({ source_id: `chat:${body.message_id}` }) };
      };
      try {
        historySink.saveChatMessage({ conversationId: 'race', role: 'user', text: '1', messageId: 'race-1' });
        historySink.saveChatMessage({ conversationId: 'race', role: 'assistant', text: '2', messageId: 'race-2' });
        await historySink.refreshBrainReady({});
        const flush = historySink.flushPendingChatMessages({ batchSize: 10, maxBatches: 1 });
        await chatStarted;
        values.collectChat = false;
        assert.equal(historySink.purgePendingChatMessages(), 2);
        assert.equal(chatSignal.aborted, true);
        releaseChat();
        const result = await flush;
        assert.deepEqual(chatIds, ['race-1']);
        assert.deepEqual(result, { pending: 2, attempted: 1, synced: 0, failed: 0, remaining: 0 });
        assert.equal(historySink._getChatHistoryStoreForTest().getMessage('race-1'), null);
        assert.equal(historySink._getChatHistoryStoreForTest().getMessage('race-2'), null);
      } finally {
        releaseChat();
        global.fetch = prevFetch;
        historySink.closeChatHistoryStore();
      }
    });
  });
});

test('closeChatHistoryStore: 진행 중 fire-and-forget ACK를 취소해 닫힌 store 접근/unhandled rejection을 막는다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    await withMockPrefs(true, async () => {
      const historySink = freshHistorySink();
      const prevFetch = global.fetch;
      const unhandled = [];
      const onUnhandled = (reason) => { unhandled.push(reason); };
      let releaseChat;
      let notifyChatStarted;
      let chatSignal = null;
      const chatStarted = new Promise((resolve) => { notifyChatStarted = resolve; });
      const chatGate = new Promise((resolve) => { releaseChat = resolve; });
      global.fetch = async (url, opts = {}) => {
        if (String(url).endsWith('/api/v1/brain/status')) {
          return { ok: true, status: 200, json: async () => ({ ready: true }) };
        }
        if (!String(url).endsWith('/api/v1/brain/chat')) return { ok: true, status: 200 };
        const body = JSON.parse(opts.body);
        chatSignal = opts.signal;
        notifyChatStarted();
        await chatGate;
        return { ok: true, status: 200, json: async () => ({ source_id: `chat:${body.message_id}` }) };
      };
      process.on('unhandledRejection', onUnhandled);
      try {
        await historySink.refreshBrainReady({});
        const receipt = historySink.saveChatMessage({
          conversationId: 'close-race', role: 'user', text: '종료 중', messageId: 'close-race',
        });
        assert.equal(receipt.status, 'persisted');
        await chatStarted;
        historySink.closeChatHistoryStore();
        assert.equal(chatSignal.aborted, true);
        releaseChat();
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(unhandled, []);
      } finally {
        releaseChat();
        process.off('unhandledRejection', onUnhandled);
        global.fetch = prevFetch;
        historySink.closeChatHistoryStore();
      }
    });
  });
});

test('astral Unicode 코드 포인트 2만 자까지 로컬 원문이 완전하게 남는다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: undefined }, async () => {
    const historySink = freshHistorySink();
    try {
      const text = '😀'.repeat(historySink.MAX_CHAT_MESSAGE_CHARS);
      assert.equal(Array.from(text).length, 20_000);
      assert.equal(text.length, 40_000);
      const receipt = historySink.saveChatMessage({ conversationId: 'long', role: 'user', text, messageId: 'long' });
      assert.equal(receipt.persisted, true);
      assert.equal(historySink._getChatHistoryStoreForTest().getMessage('long').text, text);
    } finally {
      historySink.closeChatHistoryStore();
    }
  });
});

test('astral Unicode 코드 포인트 2만 1자는 poison pending row 없이 동기 실패한다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    const historySink = freshHistorySink();
    let fetchCalls = 0;
    const previousFetch = global.fetch;
    global.fetch = async () => { fetchCalls += 1; throw new Error('must not fetch'); };
    try {
      const text = '😀'.repeat(historySink.MAX_CHAT_MESSAGE_CHARS + 1);
      assert.equal(Array.from(text).length, 20_001);
      const receipt = historySink.saveChatMessage({
        conversationId: 'too-long',
        role: 'user',
        text,
        messageId: 'too-long',
      });
      assert.equal(receipt.failed, true);
      assert.equal(receipt.reason, 'invalid_message_length');
      assert.equal(historySink._getChatHistoryStoreForTest().getMessage('too-long'), null);
      assert.equal(fetchCalls, 0);
    } finally {
      global.fetch = previousFetch;
      historySink.closeChatHistoryStore();
    }
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

// ── exposeToModel 재동기화(WP-I I4 / G-I6) ──────────────────────────────────

// withMockPrefs는 collectChat 단일 값 전용이라, 임의 prefs 객체를 심는 변형을
// 따로 둔다(비동기 fn까지 안전하게 — withEnv의 try/finally 주석과 같은 이유).
async function withPrefs(values, fn) {
  const prefsPath = require.resolve('./prefs');
  const prevEntry = require.cache[prefsPath];
  require.cache[prefsPath] = {
    id: prefsPath,
    filename: prefsPath,
    loaded: true,
    exports: { get: () => ({ ...values }), set: () => {} },
  };
  try {
    return await fn();
  } finally {
    if (prevEntry) require.cache[prefsPath] = prevEntry;
    else delete require.cache[prefsPath];
  }
}

test('pushExposeToModel: 토큰 없으면 fetch 없이 false — 밀 방법이 없는 것이지 실패가 아니다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: undefined }, async () => {
    await withPrefs({ exposeToModel: true }, async () => {
      const historySink = freshHistorySink();
      let called = false;
      const prevFetch = global.fetch;
      global.fetch = async () => { called = true; return { ok: true }; };
      try {
        assert.equal(await historySink.pushExposeToModel({}), false);
        assert.equal(called, false);
      } finally {
        global.fetch = prevFetch;
      }
    });
  });
});

test('pushExposeToModel: 저장된 exposeToModel 값을 backend 게이트에 POST한다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    await withPrefs({ exposeToModel: false }, async () => {
      const historySink = freshHistorySink();
      const seen = [];
      const prevFetch = global.fetch;
      global.fetch = async (url, opts) => { seen.push([String(url), opts]); return { ok: true }; };
      try {
        assert.equal(await historySink.pushExposeToModel({}), true);
        assert.equal(seen.length, 1);
        assert.ok(seen[0][0].endsWith('/api/v1/settings/expose-to-model'));
        assert.equal(seen[0][1].method, 'POST');
        assert.deepEqual(JSON.parse(seen[0][1].body), { enabled: false });
        assert.equal(seen[0][1].headers.Authorization, 'Bearer tok');
      } finally {
        global.fetch = prevFetch;
      }
    });
  });
});

test('refreshBrainReady: 준비 확인 시 exposeToModel을 재동기화한다(G-I6) — backend 기동 초기값은 안전측 False라 이 push가 실제 설정값을 복원한다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    await withPrefs({ exposeToModel: true }, async () => {
      const historySink = freshHistorySink();
      const paths = [];
      const prevFetch = global.fetch;
      global.fetch = async (url) => {
        paths.push(String(url));
        if (String(url).includes('/brain/status')) {
          return { ok: true, json: async () => ({ ready: true }) };
        }
        return { ok: true };
      };
      try {
        assert.equal(await historySink.refreshBrainReady({}), true);
        await new Promise((resolve) => setImmediate(resolve)); // fire-and-forget push 소진
        assert.ok(paths.some((p) => p.endsWith('/api/v1/settings/expose-to-model')));
      } finally {
        global.fetch = prevFetch;
      }
    });
  });
});

test('refreshBrainReady: 준비 실패면 재동기화도 안 민다 — 닫힌 게이트가 옳다', async () => {
  await withEnv({ ATHENA_LOCAL_BEARER_TOKEN: 'tok' }, async () => {
    await withPrefs({ exposeToModel: true }, async () => {
      const historySink = freshHistorySink();
      const paths = [];
      const prevFetch = global.fetch;
      global.fetch = async (url) => {
        paths.push(String(url));
        return { ok: false };
      };
      try {
        assert.equal(await historySink.refreshBrainReady({}), false);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(paths.filter((p) => p.includes('expose-to-model')).length, 0);
      } finally {
        global.fetch = prevFetch;
      }
    });
  });
});
