const test = require('node:test');
const assert = require('node:assert/strict');
const { mountPlan, boardIdentityFromEnvelope } = require('./board-mount');
const registry = require('./board-template-registry');

test('CC-03 tab headers retain the original stock when ETF hydration is missing or different', () => {
  const envelope = {
    stk_cd: '066570',
    surface_contract: { board_id: '137X-2', slot_values: [{ slot_id: 's001', value: 'LG전자' }] },
  };
  const identity = boardIdentityFromEnvelope(envelope);
  assert.deepEqual(identity, { name: 'LG전자', code: '066570' });
  for (const boardId of ['137X-2', '2RBO-1', '3DI2-0', '3FR6-0', '15N5-2', '137X-2']) {
    for (const values of [{}, { s001: { missing: 'not_provided' }, s002: '069500' }, { s001: 'KODEX 200 ETF', s002: '069500' }]) {
      const plan = mountPlan(registry.contractFor(boardId), values, { identity });
      assert.equal(plan.assignments.find((slot) => slot.slotId === 's001').text, 'LG전자', boardId);
      assert.equal(plan.assignments.find((slot) => slot.slotId === 's002').text, '066570', boardId);
    }
  }
});

test('identity uses initial surface values or explicit response name without template fallback', () => {
  assert.deepEqual(boardIdentityFromEnvelope({ operation_args: { stk_cd: '066570' }, data: { stk_nm: 'LG전자' } }), { name: 'LG전자', code: '066570' });
  assert.deepEqual(boardIdentityFromEnvelope({ stk_cd: '066570', initial_surface_contract: { board_id: '2RBO-1', slot_values: { s001: 'LG전자' } } }), { name: 'LG전자', code: '066570' });
  assert.deepEqual(boardIdentityFromEnvelope({ stk_cd: '066570', surface_contract: { board_id: '137X-2', slot_values: [] } }), { name: '', code: '066570' });
  assert.deepEqual(boardIdentityFromEnvelope({ surface_contract: { board_id: '13BC-2', slot_values: { s001: '매도' } } }), { name: '', code: '' });
});

test('ranking and sector titles remain unchanged when reached from a stock card', () => {
  for (const boardId of ['2VDA-0', '32S7-0']) {
    const contract = registry.contractFor(boardId);
    const identity = { name: 'LG전자', code: '066570' };
    assert.deepEqual(mountPlan(contract, {}, { identity }), mountPlan(contract, {}));
  }
});

test('CC-04 hoga titles follow the card stock, not the Paper fixture name', () => {
  const identity = { name: 'SK하이닉스', code: '000660' };
  for (const boardId of ['13BC-2', '1JPU-0']) {
    const plan = mountPlan(registry.contractFor(boardId), {}, { identity });
    const s001 = plan.assignments.find((slot) => slot.slotId === 's001');
    assert.equal(s001.text, 'SK하이닉스 통합 호가', boardId);
    assert.equal(s001.text.includes('삼성전자'), false, boardId);
    const stamped = plan.assignments.filter((slot) => String(slot.text).includes('000660')
      || String(slot.text).includes('SK하이닉스'));
    assert.ok(stamped.length >= 1, boardId);
    assert.equal(plan.assignments.some((slot) => String(slot.text).includes('삼성전자')), false, boardId);
    assert.equal(plan.assignments.some((slot) => String(slot.text).includes('005930')), false, boardId);
  }
});
