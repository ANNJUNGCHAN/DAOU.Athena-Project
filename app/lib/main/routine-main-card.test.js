'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRoutineMainCardHandlers } = require('./routine-main-card');

const candidate = Object.freeze({
  operation_ref: 'detail:ka10001:current_trading',
  args: { stk_cd: '005930' },
  title: '삼성전자 현재가',
});

test('main과 preload가 두 루틴 메인 카드 IPC를 같은 이름으로 등록한다', () => {
  const appDir = path.resolve(__dirname, '..', '..');
  const main = fs.readFileSync(path.join(appDir, 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(appDir, 'preload.js'), 'utf8');
  for (const channel of ['athena:routine-main-card-confirm', 'athena:routine-main-card-open']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel}'`));
    assert.ok(preload.includes(`'${channel}'`));
  }
});

function harness(overrides = {}) {
  const shellSender = {};
  const calls = [];
  const registrations = [];
  let activeConversationId = 'conversation-a';
  const handlers = createRoutineMainCardHandlers({
    routineHttp: async (method, path, body) => {
      calls.push({ type: 'http', method, path, body });
      if (method === 'GET') {
        return { ok: true, data: { id: 'routine-1', symbol: '005930', main_card: candidate, main_card_confirmed_at: '2026-09-08T10:00:00Z' } };
      }
      return { ok: true, data: { main_card: candidate } };
    },
    runDataset: async (dataset, options) => {
      calls.push({ type: 'run', dataset, options });
      await options.emitCanvas({ operationRef: candidate.operation_ref, envelope: { canvas_type: 'facts', data: { fields: [] } } });
      return { ok: true, dataCanvasCount: 1 };
    },
    isShellSender: (sender) => sender === shellSender,
    getActiveConversationId: () => activeConversationId,
    isEligibleOperationRef: (ref) => /^(?:base:ka\d+|detail:ka\d+:[a-z0-9_]+)$/.test(ref),
    registerConversation: (entry) => { registrations.push(entry); },
    idFactory: () => 'routine-main-card-test',
    now: () => 100,
    today: () => '20260908',
    ...overrides,
  });
  return {
    handlers, shellSender, calls, registrations,
    event: { sender: shellSender },
    switchConversation: (id) => { activeConversationId = id; },
  };
}

test('셸 외 sender는 확인과 열기 모두 거부한다', async () => {
  const h = harness();
  await assert.rejects(() => h.handlers.confirm({ sender: {} }, { id: 'routine-1', expected_candidate: candidate }), /셸 창/);
  await assert.rejects(() => h.handlers.open({ sender: {} }, { id: 'routine-1', conversationId: 'conversation-a' }), /셸 창/);
  assert.equal(h.calls.length, 0);
});

test('후보 확인은 정규화한 descriptor만 stale-check 백엔드 라우트에 한 번 보낸다', async () => {
  const h = harness();
  const result = await h.handlers.confirm(h.event, { id: 'routine 1', expected_candidate: candidate });
  assert.equal(result.ok, true);
  assert.deepEqual(h.calls, [{
    type: 'http', method: 'POST', path: '/api/v1/routines/routine%201/main-card/confirm',
    body: { expected_candidate: candidate },
  }]);
});

test('확인 후보의 쓰기 operation과 추가 필드를 거부한다', async () => {
  const h = harness();
  const write = await h.handlers.confirm(h.event, {
    id: 'routine-1', expected_candidate: { ...candidate, operation_ref: 'base:kt10000' },
  });
  const overridden = await h.handlers.confirm(h.event, {
    id: 'routine-1', expected_candidate: { ...candidate, canvas_type: 'custom' },
  });
  assert.equal(write.ok, false);
  assert.equal(overridden.ok, false);
  assert.equal(h.calls.length, 0);
});

test('stale 후보 backend 오류를 성공으로 바꾸지 않는다', async () => {
  const h = harness({
    routineHttp: async () => ({ ok: false, status: 409, error: '카드 후보가 바뀌었다' }),
  });
  const result = await h.handlers.confirm(h.event, { id: 'routine-1', expected_candidate: candidate });
  assert.deepEqual(result, { ok: false, status: 409, error: '카드 후보가 바뀌었다' });
});

test('열기는 persisted descriptor의 정확한 operation과 args로 한 번 조회하고 canonical 카드 하나만 반환한다', async () => {
  const h = harness();
  const result = await h.handlers.open(h.event, { id: 'routine-1', conversationId: 'conversation-a' });
  assert.deepEqual(result, {
    ok: true,
    id: 'routine-1',
    conversationId: 'conversation-a',
    card: { status: 'success', envelope: { canvas_type: 'facts', data: { fields: [] } } },
  });
  const run = h.calls.find((call) => call.type === 'run');
  assert.equal(h.calls.filter((call) => call.type === 'http').length, 1);
  assert.equal(h.calls.filter((call) => call.type === 'run').length, 1);
  assert.equal(run.dataset.items.length, 1);
  assert.equal(run.dataset.items[0].operationRef, candidate.operation_ref);
  assert.deepEqual(run.dataset.items[0].args, candidate.args);
  assert.equal(run.dataset.items[0].caption, candidate.title);
  assert.deepEqual(Object.keys(run.dataset.items[0]).sort(), ['args', 'caption', 'itemId', 'operationRef', 'ordinal']);
  assert.deepEqual(h.registrations, [{ conversationId: 'conversation-a', title: candidate.title }]);
});

test('base_dt의 정확한 $today marker만 클릭 시점 KST 날짜로 확장하고 고정 날짜는 보존한다', async () => {
  for (const [baseDt, expected] of [['$today', '20260908'], ['20260831', '20260831']]) {
    let requested;
    const h = harness({
      routineHttp: async () => ({
        ok: true,
        data: {
          symbol: '005930',
          main_card: { operation_ref: 'base:ka10081', args: { stk_cd: '005930', base_dt: baseDt }, title: '일봉' },
          main_card_confirmed_at: 'now',
        },
      }),
      runDataset: async (dataset, options) => {
        requested = dataset.items[0];
        await options.emitCanvas({ operationRef: 'base:ka10081', envelope: { canvas_type: 'chart' } });
        return { ok: true, dataCanvasCount: 1 };
      },
    });
    const result = await h.handlers.open(h.event, { id: 'routine-1', conversationId: 'conversation-a' });
    assert.equal(result.ok, true);
    assert.equal(requested.args.base_dt, expected);
    assert.equal(baseDt === '$today' ? requested.args.base_dt !== baseDt : requested.args.base_dt === baseDt, true);
  }
});

test('열기 payload로 card config를 덮어쓸 수 없다', async () => {
  const h = harness();
  const result = await h.handlers.open(h.event, {
    id: 'routine-1', conversationId: 'conversation-a', args: { stk_cd: '000660' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_open_binding');
  assert.equal(h.calls.length, 0);
  assert.equal(h.registrations.length, 0);
});

test('상세 실패나 미확정 카드는 조회를 실행하지 않고 명확히 실패한다', async () => {
  for (const response of [
    { ok: false, status: 503, error: 'backend unavailable' },
    { ok: true, data: { symbol: '005930', main_card: null, main_card_confirmed_at: null } },
  ]) {
    let runs = 0;
    const h = harness({
      routineHttp: async () => response,
      runDataset: async () => { runs += 1; },
    });
    const result = await h.handlers.open(h.event, { id: 'routine-1', conversationId: 'conversation-a' });
    assert.equal(result.ok, false);
    assert.equal(runs, 0);
    assert.equal(h.registrations.length, 0);
  }
});

test('persisted 카드의 종목이 루틴 종목과 다르면 조회하지 않는다', async () => {
  let runs = 0;
  const h = harness({
    routineHttp: async () => ({
      ok: true,
      data: { symbol: '000660', main_card: candidate, main_card_confirmed_at: 'now' },
    }),
    runDataset: async () => { runs += 1; },
  });
  const result = await h.handlers.open(h.event, { id: 'routine-1', conversationId: 'conversation-a' });
  assert.equal(result.code, 'invalid_persisted_main_card');
  assert.equal(runs, 0);
  assert.equal(h.registrations.length, 0);
});

test('상세 조회 중 또는 카드 조회 후 대화가 바뀌면 늦은 카드를 반환하지 않는다', async () => {
  let h;
  h = harness({
    routineHttp: async () => {
      h.switchConversation('conversation-b');
      return { ok: true, data: { symbol: '005930', main_card: candidate, main_card_confirmed_at: 'now' } };
    },
  });
  let result = await h.handlers.open(h.event, { id: 'routine-1', conversationId: 'conversation-a' });
  assert.equal(result.code, 'conversation_changed');

  h = harness({
    runDataset: async (dataset, options) => {
      await options.emitCanvas({ operationRef: candidate.operation_ref, envelope: { canvas_type: 'facts' } });
      h.switchConversation('conversation-b');
      return { ok: true, dataCanvasCount: 1 };
    },
  });
  result = await h.handlers.open(h.event, { id: 'routine-1', conversationId: 'conversation-a' });
  assert.equal(result.code, 'conversation_changed');
  assert.equal(result.card, undefined);
  assert.equal(h.registrations.length, 0);
});
