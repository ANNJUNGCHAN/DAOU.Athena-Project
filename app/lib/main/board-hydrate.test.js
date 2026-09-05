'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HYDRATE_PATH, buildHydrateBody, normalizeSlotValues, hydrateBoard,
} = require('./board-hydrate');

function makeFetch(reply) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: options && options.body ? JSON.parse(options.body) : null });
    if (typeof reply === 'function') return reply();
    return reply;
  };
  return { calls, fetchImpl };
}

function jsonResponse(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

// 백엔드가 실제로 돌려주는 모양(backend/tests/api/test_canvas_push.py:498-518).
function hydrateResponse(slotValues, unbound = []) {
  return jsonResponse(200, {
    board_id: '2SKU-1',
    card_id: 'CC-01',
    operations: [{ operation_ref: 'base:ka10085', status: 'bound', reason: null, bound_count: 1 }],
    surface_contract: {
      surface_version: 1,
      board_id: '2SKU-1',
      card_id: 'CC-01',
      slot_values: slotValues,
      unbound_slots: unbound,
      state_boards: [],
    },
  });
}

test('요청 몸체의 target은 manifest alias 가방이고 빈 값은 싣지 않는다', () => {
  assert.deepEqual(
    buildHydrateBody({
      boardId: '2R3M-1',
      target: { stk_cd: '005930', stex_tp: '0' },
      account: '8012344721',
    }),
    { board_id: '2R3M-1', target: { stk_cd: '005930', stex_tp: '0' }, account: '8012344721' },
  );
  // 값 없는 alias는 버린다 — 백엔드가 ''를 인자로 오인하게 두지 않는다.
  assert.deepEqual(
    buildHydrateBody({ boardId: ' 2R3M-1 ', target: { stk_cd: '005930', qry_tp: '  ' }, account: ' ' }),
    { board_id: '2R3M-1', target: { stk_cd: '005930' } },
  );
  // 가방이 비면 target 자체를 싣지 않는다.
  assert.deepEqual(buildHydrateBody({ boardId: 'B1', target: {} }), { board_id: 'B1' });
  // 가방이 아닌 값(옛 문자열 계약)은 백엔드 모델이 거부한다 — 아예 싣지 않는다.
  assert.deepEqual(buildHydrateBody({ boardId: 'B1', target: '005930' }), { board_id: 'B1' });
  assert.throws(() => buildHydrateBody({ target: { stk_cd: '005930' } }), /board_id/);
});

test('slot_values는 목록으로 와도 표로 와도 같은 표가 된다', () => {
  assert.deepEqual(
    normalizeSlotValues([{ slot_id: 'a', value: 1 }, { slot_id: 'b', value: 0 }]),
    { a: 1, b: 0 },
  );
  assert.deepEqual(normalizeSlotValues({ a: 1, b: null }), { a: 1, b: null });
  // 모양이 틀린 항목은 버린다 — 값 없는 슬롯을 undefined로 채워 결측 판정을 흐리지 않는다.
  assert.deepEqual(normalizeSlotValues([{ slot_id: 'a' }, { value: 3 }, null, 'x']), {});
  assert.deepEqual(normalizeSlotValues(undefined), {});
});

test('하이드레이션은 로컬 베어러를 싣고 surface_contract.slot_values를 읽는다', async () => {
  const { calls, fetchImpl } = makeFetch(hydrateResponse([
    { slot_id: 'kpi_prsm_dpst_aset_amt', occurrence_id: 'base:kt00003|$.prsm_dpst_aset_amt|1', observation_id: 'obs', value: '12340000' },
  ], ['col_stk_nm']));
  const result = await hydrateBoard({
    backendBase: 'http://127.0.0.1:8010',
    fetchImpl,
    token: 'board-hydrate-token',
    boardId: '2SKU-1',
    target: { stk_cd: '005930' },
  });
  assert.equal(calls[0].url, `http://127.0.0.1:8010${HYDRATE_PATH}`);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer board-hydrate-token');
  assert.deepEqual(calls[0].body, { board_id: '2SKU-1', target: { stk_cd: '005930' } });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'hydrated');
  assert.equal(result.board_id, '2SKU-1');
  assert.deepEqual(result.slot_values, { kpi_prsm_dpst_aset_amt: '12340000' });
  assert.equal(result.filled, 1);
  // 실시간 재색인은 observation_id가 붙은 원본 계약을 필요로 한다.
  assert.equal(result.surface_contract.slot_values[0].observation_id, 'obs');
});

test('토큰이 없으면 빈 Authorization을 지어내지 않는다', async () => {
  const { calls, fetchImpl } = makeFetch(hydrateResponse([]));
  await hydrateBoard({ backendBase: 'http://x', fetchImpl, boardId: 'B1' });
  assert.equal('Authorization' in calls[0].options.headers, false);
});

test('베어러가 거부되면 조용히 접지 않는다 — 설정 결함은 오류다', async () => {
  const { fetchImpl } = makeFetch(jsonResponse(401, { detail: 'Invalid bearer credential' }));
  const result = await hydrateBoard({ backendBase: 'http://x', fetchImpl, boardId: 'B1', token: 'x' });
  assert.deepEqual(result, { ok: false, status: 'error', httpStatus: 401, error: 'HTTP 401' });
});

test('엔드포인트가 아직 없으면 실패가 아니라 unavailable — 화면은 결측어를 지킨다', async () => {
  for (const status of [404, 405, 501, 503]) {
    const { fetchImpl } = makeFetch(jsonResponse(status, { detail: 'not found' }));
    const result = await hydrateBoard({ backendBase: 'http://x', fetchImpl, boardId: 'B1' });
    assert.deepEqual(result, { ok: false, status: 'unavailable', httpStatus: status });
  }
  // 백엔드가 아예 안 떠 있어도 같다.
  const dead = { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } };
  const result = await hydrateBoard({ backendBase: 'http://x', fetchImpl: dead.fetchImpl, boardId: 'B1' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'unavailable');
});

test('서버가 있는데 터진 것은 오류로 보고한다(조용히 접지 않는다)', async () => {
  const { fetchImpl } = makeFetch(jsonResponse(500, {}));
  const result = await hydrateBoard({ backendBase: 'http://x', fetchImpl, boardId: 'B1' });
  assert.deepEqual(result, { ok: false, status: 'error', httpStatus: 500, error: 'HTTP 500' });
});

test('board_id 없이 부르면 네트워크를 건드리지 않는다', async () => {
  const { calls, fetchImpl } = makeFetch(hydrateResponse([]));
  const result = await hydrateBoard({ backendBase: 'http://x', fetchImpl, boardId: '' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'invalid');
  assert.deepEqual(calls, []);
});

test('빈 응답은 채우지 않는다', async () => {
  const { fetchImpl } = makeFetch(hydrateResponse([]));
  const result = await hydrateBoard({ backendBase: 'http://x', fetchImpl, boardId: 'B1' });
  assert.equal(result.ok, true);
  assert.equal(result.filled, 0);
  assert.deepEqual(result.slot_values, {});
});
