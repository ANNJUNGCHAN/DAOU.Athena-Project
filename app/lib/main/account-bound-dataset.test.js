'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createAccountBoundInvoker, runAccountBoundDataset } = require('./account-bound-dataset');

function loadSelectorStage(dispatch) {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const start = mainSource.indexOf('  const orderDraft = selectorFastPath.buildMarketOrderDraft(');
  const end = mainSource.indexOf('  const { dir, configFile } = getLiveMcpConfig();', start);
  assert.ok(start >= 0 && end > start, 'main selector stage must remain executable');

  const calls = { classify: 0, generalModel: 0, persisted: [] };
  const context = vm.createContext({
    calls,
    AbortController,
    performance,
    activeSelectorFastRun: null,
    modePromptRequired: false,
    simpleChartRoute: { handled: false },
    stockEntityIndex: {},
    selectorFastPath: {
      buildMarketOrderDraft: () => ({ intent: 'order', arguments: { symbol: '005930' } }),
      runSelectorFastPath: dispatch,
    },
    accountBoundDataset: {
      createAccountBoundInvoker: async ({ run }) => ({
        ok: true,
        run: (options) => run(options),
      }),
    },
    activeRestAccountId: () => 'local-a',
    accounts: { resolveBackendAlias: async () => ({ ok: true, backendAccountAlias: 'server-a' }) },
    BACKEND_HTTP_BASE: 'http://backend',
    fetch: async () => { throw new Error('unexpected fetch'); },
    backendAccountAuthorization: () => 'Bearer fixture',
    selectorColdHedge: {
      runSelectorColdHedge: async () => {
        calls.classify += 1;
        return { handled: false, reason: 'fixture' };
      },
    },
    selectorClaudePool: { run: async () => { calls.classify += 1; } },
    emitRestCanvasForOrigin: async () => {},
    shellWin: null,
    revealShell() {},
    historySink: { saveChatMessage() {} },
    emitHistorySaveFailed() {},
    mdlog() {},
    persistLocalLiveResult: async (_query, result) => {
      calls.persisted.push(result);
      return result;
    },
  });
  vm.runInContext([
    'async function exerciseSelectorStage(query = "삼성전자 1주 시장가 매수", expand = false, origin = "shell", turnConversationId = "turn-a") {',
    '  const queryStartedAt = performance.now();',
    mainSource.slice(start, end),
    '  calls.generalModel += 1;',
    '  return { ok: true, source: "general-model" };',
    '}',
  ].join('\n'), context);
  return { run: context.exerciseSelectorStage, calls };
}

for (const fixture of [
  { name: 'HTTP 401', value: { handled: false, reason: 'http_401' } },
  { name: 'HTTP 409', value: { handled: false, reason: 'http_409' } },
  { name: 'HTTP 5xx', value: { handled: false, reason: 'http_503' } },
  {
    name: 'needs_inference preflight',
    value: {
      handled: false,
      reason: 'needs_inference',
      preflight: { candidates: [{ operation_ref: 'query:ka10001' }] },
    },
  },
  { name: '예외', error: new Error('selector failed') },
]) {
  test(`실제 main 주문 selector ${fixture.name} 실패는 cold·일반 모델을 호출하지 않는다`, async () => {
    let dispatches = 0;
    const { run, calls } = loadSelectorStage(async () => {
      dispatches += 1;
      if (fixture.error) throw fixture.error;
      return fixture.value;
    });

    const result = await run();
    assert.equal(dispatches, 1);
    assert.equal(calls.classify, 0);
    assert.equal(calls.generalModel, 0);
    assert.equal(calls.persisted.length, 1);
    assert.equal(result.ok, false);
    assert.equal(result.source, 'selector-fast');
    assert.equal(result.modelCalls, 0);
  });
}

test('한 번 검증한 활성 계좌 alias를 initial과 cold 재분배 호출에 동일하게 고정한다', async () => {
  for (const [accountId, backendAccountAlias] of [['local-a', 'server-a'], ['local-b', 'server-b']]) {
    const calls = [];
    const bound = await createAccountBoundInvoker({
      getActiveAccountId: () => accountId,
      resolveBackendAlias: async ({ id }) => ({ ok: true, accountId: id, backendAlias: backendAccountAlias }),
      run: async (options) => { calls.push(options); return { handled: false }; },
    });
    assert.equal(bound.ok, true);
    await bound.run({ phase: 'initial', backendAccountAlias: 'unsafe-default' });
    await bound.run({ phase: 'cold' });
    assert.deepEqual(calls, [
      { phase: 'initial', backendAccountAlias },
      { phase: 'cold', backendAccountAlias },
    ]);
  }
});

test('계좌 권위 검증 실패 시 selector 실행 손잡이를 만들지 않는다', async () => {
  let calls = 0;
  const bound = await createAccountBoundInvoker({
    getActiveAccountId: () => 'local-a',
    resolveBackendAlias: async () => ({ ok: false, error: '서버 계좌 연결 필요' }),
    run: async () => { calls += 1; },
  });
  assert.equal(bound.ok, false);
  assert.equal(bound.run, undefined);
  assert.equal(calls, 0);
});

test('활성 로컬 계좌 A/B를 검증한 서버 alias로만 runner에 전달한다', async () => {
  for (const [accountId, backendAlias] of [['local-a', 'server-a'], ['local-b', 'server-b']]) {
    const resolved = [];
    const ran = [];
    const result = await runAccountBoundDataset({
      getActiveAccountId: () => accountId,
      resolveBackendAlias: async (options) => {
        resolved.push(options);
        return { ok: true, accountId, backendAlias };
      },
      resolveOptions: { backendBase: 'http://backend', authorization: 'Bearer local-token' },
      runRestDataset: async (options) => {
        ran.push(options);
        return { ok: true, renderedCount: 1 };
      },
      runnerOptions: { dataset: { datasetId: 'dataset-1' }, backendBase: 'http://backend' },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(resolved, [{
      backendBase: 'http://backend', authorization: 'Bearer local-token', id: accountId,
    }]);
    assert.equal(ran.length, 1);
    assert.equal(ran[0].backendAccountAlias, backendAlias);
  }
});

test('명시된 재시도 계좌 ID를 활성 계좌보다 우선한다', async () => {
  let resolvedId;
  await runAccountBoundDataset({
    requestedAccountId: 'retry-local',
    getActiveAccountId: () => 'active-local',
    resolveBackendAlias: async ({ id }) => {
      resolvedId = id;
      return { ok: true, backendAlias: 'server-retry' };
    },
    runRestDataset: async () => ({ ok: true }),
  });
  assert.equal(resolvedId, 'retry-local');
});

test('mapping 누락이나 metadata 실패는 runner 호출 전에 차단한다', async () => {
  for (const error of ['조회에 사용할 서버 계좌를 먼저 연결해야 한다', '서버 계좌 정보를 확인할 수 없다']) {
    let runnerCalls = 0;
    const result = await runAccountBoundDataset({
      getActiveAccountId: () => 'local-a',
      resolveBackendAlias: async () => ({ ok: false, error }),
      runRestDataset: async () => { runnerCalls += 1; return { ok: true }; },
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'backend_account_unavailable');
    assert.equal(result.physicalCalls, 0);
    assert.equal(runnerCalls, 0);
    assert.match(result.answerText, /설정의 계좌 화면/);
  }
});
