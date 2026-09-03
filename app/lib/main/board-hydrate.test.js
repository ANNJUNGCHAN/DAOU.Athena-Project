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

test('요청 몸체는 계약이 정한 세 필드뿐이고 빈 값은 싣지 않는다', () => {
  assert.deepEqual(
    buildHydrateBody({ boardId: '2R3M-1', target: '005930', account: '8012344721' }),
    { board_id: '2R3M-1', target: '005930', account: '8012344721' },
  );
  assert.deepEqual(buildHydrateBody({ boardId: ' 2R3M-1 ', target: '  ' }), { board_id: '2R3M-1' });
  assert.throws(() => buildHydrateBody({ target: '005930' }), /board_id/);
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

test('하이드레이션은 계약 경로로 POST하고 slot_values를 표로 돌려준다', async () => {
  const { calls, fetchImpl } = makeFetch(jsonResponse(200, {
    slot_values: [{ slot_id: 'kpi.1.value', value: 12840000 }],
  }));
  const result = await hydrateBoard({
    backendBase: 'http://127.0.0.1:8010',
    fetchImpl,
    boardId: '2R3M-1',
    target: '005930',
  });
  assert.equal(calls[0].url, `http://127.0.0.1:8010${HYDRATE_PATH}`);
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(calls[0].body, { board_id: '2R3M-1', target: '005930' });
  assert.deepEqual(result, {
    ok: true,
    status: 'hydrated',
    board_id: '2R3M-1',
    slot_values: { 'kpi.1.value': 12840000 },
    filled: 1,
  });
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
  const { calls, fetchImpl } = makeFetch(jsonResponse(200, {}));
  const result = await hydrateBoard({ backendBase: 'http://x', fetchImpl, boardId: '' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'invalid');
  assert.deepEqual(calls, []);
});

test('빈 응답은 채우지 않는다', async () => {
  const { fetchImpl } = makeFetch(jsonResponse(200, { slot_values: [] }));
  const result = await hydrateBoard({ backendBase: 'http://x', fetchImpl, boardId: 'B1' });
  assert.equal(result.ok, true);
  assert.equal(result.filled, 0);
  assert.deepEqual(result.slot_values, {});
});
