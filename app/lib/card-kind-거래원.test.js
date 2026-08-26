'use strict';

// DOM 빌더(render거래원)는 document가 필요해 node --test 경로에서는 못 돈다
// (card-primitives.test.js와 같은 결) — 이 스위트는 순수 판정(resolveBrokerRanking)만 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveBrokerRanking } = require('./card-kind-거래원');

test('ka10040 매수측 필드 — buy_trde_ori_N/buy_trde_ori_qty_N을 순위행으로 뽑는다', () => {
  const r = resolveBrokerRanking({
    buy_trde_ori_1: '미래에셋증권',
    buy_trde_ori_qty_1: '48210',
    buy_trde_ori_cd_1: '05Y', // 코드는 목업에 없는 필드 — 무시돼야 한다
    buy_trde_ori_2: '키움증권',
    buy_trde_ori_qty_2: '31554',
  });
  assert.equal(r.side, 'buy');
  assert.deepEqual(r.rows, [
    { rank: 1, name: '미래에셋증권', qty: '48210' },
    { rank: 2, name: '키움증권', qty: '31554' },
  ]);
});

test('ka10040 매도측 필드 — sel_trde_ori_N 패턴', () => {
  const r = resolveBrokerRanking({
    sel_trde_ori_1: '모건스탠리',
    sel_trde_ori_qty_1: '52077',
  });
  assert.equal(r.side, 'sell');
  assert.deepEqual(r.rows, [{ rank: 1, name: '모건스탠리', qty: '52077' }]);
});

test('ka10002 매수측 필드 — buy_trde_ori_nm_N/buy_trde_qty_N 패턴(다른 네이밍)', () => {
  const r = resolveBrokerRanking({
    buy_trde_ori_nm_1: '삼성증권',
    buy_trde_ori_1: '삼성증권',
    buy_trde_qty_1: '18902',
  });
  assert.equal(r.side, 'buy');
  assert.deepEqual(r.rows, [{ rank: 1, name: '삼성증권', qty: '18902' }]);
});

test('ka10002 매도측 필드 — sel_trde_ori_nm_N/sel_trde_qty_N 패턴', () => {
  const r = resolveBrokerRanking({
    sel_trde_ori_nm_1: 'JP모간',
    sel_trde_qty_1: '27368',
  });
  assert.equal(r.side, 'sell');
  assert.deepEqual(r.rows, [{ rank: 1, name: 'JP모간', qty: '27368' }]);
});

test('5위까지 순서대로 뽑는다(Paper는 3위까지만 보였지만 실응답은 5위까지)', () => {
  const map = {};
  for (let n = 1; n <= 5; n += 1) {
    map[`buy_trde_ori_${n}`] = `증권사${n}`;
    map[`buy_trde_ori_qty_${n}`] = String(n * 1000);
  }
  const r = resolveBrokerRanking(map);
  assert.equal(r.rows.length, 5);
  assert.equal(r.rows[4].rank, 5);
});

test('이름은 있는데 수량이 없으면 그 순위는 생략한다(필드 단위 생략)', () => {
  const r = resolveBrokerRanking({
    buy_trde_ori_1: '미래에셋증권',
    buy_trde_ori_qty_1: '48210',
    buy_trde_ori_2: '키움증권', // 수량 없음
  });
  assert.deepEqual(r.rows, [{ rank: 1, name: '미래에셋증권', qty: '48210' }]);
});

test('네 패턴 중 아무것도 안 걸리면 null(all-or-nothing, 범용 렌더러로 폴백)', () => {
  assert.equal(resolveBrokerRanking({}), null);
  assert.equal(resolveBrokerRanking({ unrelated_key: '1' }), null);
  assert.equal(resolveBrokerRanking(null), null);
});
