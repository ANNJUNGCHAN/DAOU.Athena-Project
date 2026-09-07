'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runAccountBoundDataset } = require('./account-bound-dataset');

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
